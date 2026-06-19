// Usage-limit resolution + enforcement helpers (client-side; Spark has no cron).
// Convention: a limit of 0 (or undefined) means UNLIMITED / disabled.
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import type { GlobalSettings, GroupDoc, UsageLimits, UserDoc } from "@avtp/shared";
import { getGlobalSettings } from "./settings";
import { listLiveSessions } from "./liveSessions";

export interface EffectiveLimits {
  maxSessionMin: number; // 0 = no cap
  maxConcurrent: number; // per-user; 0 = unlimited
  maxConcurrentTotal: number; // platform-wide; 0 = unlimited
  idleTimeoutSec: number; // 0 = off
  perDayMin: number; // 0 = unlimited
  perWeekMin: number;
  perMonthMin: number;
}

export interface StartEvaluation {
  ok: boolean;
  reason?: string;
  limits: EffectiveLimits;
  usedDayMin: number;
  usedWeekMin: number;
  usedMonthMin: number;
  remainingMin: number; // tightest remaining across period limits (Infinity = unlimited)
  sessionCapMin: number; // hard cap for THIS session in minutes (0 = none)
  activeCount: number; // this user's live sessions
  activeTotal: number; // platform-wide live sessions
}

/** Smallest positive value (treating 0/undefined as "unlimited"), else 0. */
function mostRestrictive(values: (number | undefined | null)[]): number {
  const pos = values.filter((v): v is number => typeof v === "number" && v > 0);
  return pos.length ? Math.min(...pos) : 0;
}

function startOfDay(d = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function startOfWeek(d = new Date()): number {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function startOfMonth(d = new Date()): number {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

type SessionLite = { startedAt: number; durationSec?: number; status?: string };

async function getUserSessions(uid: string): Promise<SessionLite[]> {
  // where-only query (no orderBy) avoids a composite index; trainees have modest
  // session counts so fetching all of their own sessions is fine.
  const snap = await getDocs(query(collection(db, "sessions"), where("userId", "==", uid)));
  return snap.docs.map((d) => d.data() as SessionLite);
}

async function getUserGroups(uid: string): Promise<GroupDoc[]> {
  const snap = await getDocs(
    query(collection(db, "groups"), where("memberUids", "array-contains", uid))
  );
  return snap.docs.map((d) => d.data() as GroupDoc);
}

export async function resolveEffectiveLimits(
  uid: string,
  settings?: GlobalSettings
): Promise<EffectiveLimits> {
  const s = settings || (await getGlobalSettings());
  const userSnap = await getDoc(doc(db, "users", uid));
  const user = (userSnap.data() as UserDoc | undefined) || undefined;
  const groups = await getUserGroups(uid);

  const ul = user?.usageLimits || {};
  const groupLimits: UsageLimits[] = groups.map((g) => g.usageLimits || {});
  const def = s.defaultUsageLimits || {};

  const pick = (key: keyof UsageLimits) =>
    mostRestrictive([def[key], ul[key], ...groupLimits.map((g) => g[key])]);

  return {
    maxSessionMin: mostRestrictive([s.maxSessionMinutes, user?.maxSessionMinutes]),
    maxConcurrent: s.maxConcurrentSessionsPerUser || 0,
    maxConcurrentTotal: s.maxConcurrentSessionsTotal || 0,
    idleTimeoutSec: s.idleTimeoutSec || 0,
    perDayMin: pick("perDayMin"),
    perWeekMin: pick("perWeekMin"),
    perMonthMin: pick("perMonthMin"),
  };
}

/** Evaluate whether a user may start a session now, and the cap for this one. */
export async function evaluateStart(uid: string): Promise<StartEvaluation> {
  const settings = await getGlobalSettings();
  const [limits, sessions, live] = await Promise.all([
    resolveEffectiveLimits(uid, settings),
    getUserSessions(uid),
    listLiveSessions(),
  ]);

  const dayStart = startOfDay();
  const weekStart = startOfWeek();
  const monthStart = startOfMonth();
  const minutesSince = (since: number) =>
    sessions
      .filter((s) => s.startedAt >= since)
      .reduce((n, s) => n + (s.durationSec || 0), 0) / 60;

  const usedDayMin = minutesSince(dayStart);
  const usedWeekMin = minutesSince(weekStart);
  const usedMonthMin = minutesSince(monthStart);

  const rem = (limit: number, used: number) => (limit > 0 ? Math.max(0, limit - used) : Infinity);
  const remDay = rem(limits.perDayMin, usedDayMin);
  const remWeek = rem(limits.perWeekMin, usedWeekMin);
  const remMonth = rem(limits.perMonthMin, usedMonthMin);
  const remainingMin = Math.min(remDay, remWeek, remMonth);

  // concurrency from the live-heartbeat collection (stale ones already filtered)
  const activeCount = live.filter((l) => l.userId === uid).length; // this user
  const activeTotal = live.length; // whole platform

  // session cap = tightest finite of (max session length, remaining quota)
  const caps = [limits.maxSessionMin > 0 ? limits.maxSessionMin : Infinity, remainingMin];
  const capFinite = Math.min(...caps);
  const sessionCapMin = Number.isFinite(capFinite) ? Math.floor(capFinite) : 0;

  let ok = true;
  let reason: string | undefined;
  if (remainingMin <= 0) {
    ok = false;
    const which =
      remDay <= 0 ? "daily" : remWeek <= 0 ? "weekly" : "monthly";
    reason = `Your ${which} usage limit has been reached. It resets at the start of the next ${
      which === "daily" ? "day" : which === "weekly" ? "week" : "month"
    }.`;
  } else if (limits.maxConcurrent > 0 && activeCount >= limits.maxConcurrent) {
    ok = false;
    reason =
      limits.maxConcurrent === 1
        ? "You already have a session in progress. End it before starting another."
        : `You've reached the maximum of ${limits.maxConcurrent} concurrent sessions.`;
  } else if (limits.maxConcurrentTotal > 0 && activeTotal >= limits.maxConcurrentTotal) {
    ok = false;
    reason = `The platform is at capacity (${limits.maxConcurrentTotal} sessions in progress). Please try again in a moment.`;
  }

  return {
    ok,
    reason,
    limits,
    usedDayMin,
    usedWeekMin,
    usedMonthMin,
    remainingMin,
    sessionCapMin,
    activeCount,
    activeTotal,
  };
}
