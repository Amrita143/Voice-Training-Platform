import * as admin from "firebase-admin";

export interface AuditEntry {
  actorUid: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

/** Append an immutable audit record. Best-effort (never throws to caller). */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await admin
      .firestore()
      .collection("auditLogs")
      .add({ ...entry, ts: Date.now() });
  } catch (e) {
    console.error("audit write failed", e);
  }
}
