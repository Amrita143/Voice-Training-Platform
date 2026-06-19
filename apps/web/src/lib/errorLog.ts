// Lightweight error logging so superadmins can see what's failing (xAI rate
// limits, network/auth errors, tool failures). Writes to `errorLogs` (staff read).
import { addDoc, collection, getDocs, limit as qlimit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";

export type ErrorSource = "voice" | "session" | "search" | "tool" | "app";
export type ErrorCode = "rate_limit" | "network" | "auth" | "error";

export interface ErrorLogRow {
  id: string;
  ts: number;
  userId?: string;
  userid?: string;
  source: ErrorSource;
  code: ErrorCode;
  message: string;
  detail?: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
}

/** Classify a raw error message into a coarse code (helps spot rate limits). */
export function classifyError(raw: string): ErrorCode {
  const m = raw.toLowerCase();
  if (/rate.?limit|429|too many requests|quota|insufficient_quota|overloaded|capacity/.test(m))
    return "rate_limit";
  if (/failed to fetch|networkerror|err_connection|load failed|timeout|ecconn/.test(m))
    return "network";
  if (/401|403|unauthorized|forbidden|permission|invalid token|auth/.test(m)) return "auth";
  return "error";
}

export async function logError(input: {
  source: ErrorSource;
  message: string;
  detail?: string;
  code?: ErrorCode;
  userId?: string;
  userid?: string;
  agentId?: string;
  agentName?: string;
  sessionId?: string;
}): Promise<void> {
  try {
    const message = (input.message || "Unknown error").slice(0, 500);
    const doc: Record<string, unknown> = {
      ts: Date.now(),
      source: input.source,
      code: input.code || classifyError(message + " " + (input.detail || "")),
      message,
    };
    // only include defined fields (Firestore rejects undefined)
    for (const k of ["detail", "userId", "userid", "agentId", "agentName", "sessionId"] as const) {
      const v = input[k];
      if (v != null && v !== "") doc[k] = String(v).slice(0, 1000);
    }
    await addDoc(collection(db, "errorLogs"), doc);
  } catch {
    /* logging must never throw */
  }
}

export async function listErrorLogs(max = 200): Promise<ErrorLogRow[]> {
  const snap = await getDocs(
    query(collection(db, "errorLogs"), orderBy("ts", "desc"), qlimit(max))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ErrorLogRow, "id">) }));
}
