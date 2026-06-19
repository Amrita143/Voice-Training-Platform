// Live-session presence for PLATFORM-WIDE concurrency. Each active session keeps
// a heartbeat doc that any signed-in user can read (to count global concurrency).
// Stale docs (no recent heartbeat — e.g. a crashed tab) are ignored by count.
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";

export const HEARTBEAT_MS = 20000;
export const STALE_MS = 50000; // 2+ missed heartbeats = stale

export interface LiveSession {
  id: string;
  userId: string;
  agentId?: string;
  agentName?: string;
  startedAt: number;
  lastSeen: number;
}

export async function listLiveSessions(): Promise<LiveSession[]> {
  const snap = await getDocs(collection(db, "liveSessions"));
  const now = Date.now();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<LiveSession, "id">) }))
    .filter((x) => now - (x.lastSeen || 0) < STALE_MS);
}

export async function startLive(
  sessionId: string,
  info: { userId: string; agentId?: string; agentName?: string }
): Promise<void> {
  const now = Date.now();
  await setDoc(doc(db, "liveSessions", sessionId), { ...info, startedAt: now, lastSeen: now });
}

export async function heartbeat(sessionId: string, userId: string): Promise<void> {
  // merge keeps userId (rules require request.resource.data.userId == me on update)
  await setDoc(doc(db, "liveSessions", sessionId), { userId, lastSeen: Date.now() }, { merge: true });
}

export async function endLive(sessionId: string): Promise<void> {
  await deleteDoc(doc(db, "liveSessions", sessionId)).catch(() => {});
}

/** Clean up this user's own leaked heartbeat docs (from previously crashed tabs). */
export async function cleanupOwnLive(userId: string): Promise<void> {
  try {
    const snap = await getDocs(
      query(collection(db, "liveSessions"), where("userId", "==", userId))
    );
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    /* best-effort */
  }
}
