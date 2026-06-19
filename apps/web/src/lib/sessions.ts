import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

export interface SessionCounts {
  spoken: number;
  typed: number;
  catalogClicks: number;
  toolCalls: number;
  errors: number;
}

export async function startSession(input: {
  userId: string;
  agentId: string;
  agentName: string;
  voice: string;
}): Promise<string> {
  const ref = await addDoc(collection(db, "sessions"), {
    userId: input.userId,
    agentId: input.agentId,
    agentName: input.agentName,
    startedAt: Date.now(),
    endedAt: null,
    status: "active",
    voiceUsed: input.voice,
    counts: { spoken: 0, typed: 0, catalogClicks: 0, toolCalls: 0, errors: 0 },
  });
  return ref.id;
}

export async function logEvent(
  sessionId: string,
  event: Record<string, unknown>
): Promise<void> {
  await addDoc(collection(db, "sessions", sessionId, "events"), {
    ...event,
    ts: Date.now(),
  });
}

export async function endSession(
  sessionId: string,
  patch: { durationSec: number; counts: SessionCounts; endReason: string }
): Promise<void> {
  await updateDoc(doc(db, "sessions", sessionId), {
    ...patch,
    status: "ended",
    endedAt: Date.now(),
  });
}
