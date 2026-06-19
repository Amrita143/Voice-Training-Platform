// Analytics data layer (Spark-friendly: reads straight from Firestore under
// rules — staff may read all sessions/events). Aggregation happens client-side.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as qlimit,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "../firebase";

export interface SessionCounts {
  spoken: number;
  typed: number;
  catalogClicks: number;
  toolCalls: number;
  errors: number;
}

export interface SessionRow {
  id: string;
  userId: string;
  agentId: string;
  agentName: string;
  startedAt: number;
  endedAt?: number | null;
  durationSec?: number;
  status: string;
  voiceUsed?: string;
  counts?: SessionCounts;
  endReason?: string;
}

export interface TraceRow {
  id: string;
  ts: number;
  type: string;
  role?: string;
  text?: string;
  via?: string;
  questionId?: string;
  sectionId?: string;
  tool?: {
    name?: string;
    status?: string;
    query?: string | null;
    resultCount?: number | null;
    args?: unknown;
    results?: { content: string; score?: number; fileId?: string }[] | null;
    resultPreview?: string | null;
    latencyMs?: number | null;
    httpStatus?: number | null;
    error?: string | null;
  };
}

/** Most recent sessions (newest first). Single-field index on startedAt. */
export async function listSessions(max = 1000): Promise<SessionRow[]> {
  const snap = await getDocs(
    query(collection(db, "sessions"), orderBy("startedAt", "desc"), qlimit(max))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SessionRow, "id">) }));
}

export async function getSession(id: string): Promise<SessionRow | null> {
  const s = await getDoc(doc(db, "sessions", id));
  return s.exists() ? { id: s.id, ...(s.data() as Omit<SessionRow, "id">) } : null;
}

/** Full trace (transcript + tool calls + catalog clicks) in chronological order. */
export async function getSessionEvents(sessionId: string): Promise<TraceRow[]> {
  const snap = await getDocs(
    query(collection(db, "sessions", sessionId, "events"), orderBy("ts", "asc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TraceRow, "id">) }));
}

// ---- formatting helpers ---------------------------------------------------

export function fmtDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function fmtDateTime(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const sum = (a: number, b: number) => a + b;
export function totalDurationSec(rows: SessionRow[]): number {
  return rows.map((r) => r.durationSec || 0).reduce(sum, 0);
}
export function sumCount(rows: SessionRow[], key: keyof SessionCounts): number {
  return rows.map((r) => r.counts?.[key] || 0).reduce(sum, 0);
}

/** Bucket sessions per calendar day in [fromTs, toTs]. */
export function bucketByDay(
  rows: SessionRow[],
  fromTs: number,
  toTs: number
): { label: string; key: string; count: number; minutes: number }[] {
  const buckets = new Map<string, { count: number; minutes: number }>();
  const dayKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const out: { label: string; key: string; count: number; minutes: number }[] = [];
  const cur = new Date(fromTs);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(toTs);
  end.setHours(0, 0, 0, 0);
  // guard against runaway ranges
  let guard = 0;
  while (cur.getTime() <= end.getTime() && guard < 400) {
    const key = `${cur.getFullYear()}-${cur.getMonth()}-${cur.getDate()}`;
    buckets.set(key, { count: 0, minutes: 0 });
    out.push({
      key,
      label: `${cur.getMonth() + 1}/${cur.getDate()}`,
      count: 0,
      minutes: 0,
    });
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  for (const r of rows) {
    const b = buckets.get(dayKey(r.startedAt));
    if (b) {
      b.count++;
      b.minutes += (r.durationSec || 0) / 60;
    }
  }
  for (const o of out) {
    const b = buckets.get(o.key)!;
    o.count = b.count;
    o.minutes = Math.round(b.minutes);
  }
  return out;
}

// ---- export helpers -------------------------------------------------------

export function toCsv(
  rows: Record<string, unknown>[],
  cols: { key: string; label: string }[]
): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.map((c) => esc(c.label)).join(",");
  const body = rows
    .map((r) => cols.map((c) => esc(r[c.key])).join(","))
    .join("\n");
  return head + "\n" + body;
}

export function downloadFile(name: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
