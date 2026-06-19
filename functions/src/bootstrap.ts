/**
 * One-time superadmin bootstrap (cloud — no ADC needed).
 *
 * Guarded two ways: (1) a shared token (BOOTSTRAP_TOKEN secret), and
 * (2) it refuses if a superadmin already exists (self-disables after first use).
 *
 * Usage (after deploy + secrets set):
 *   POST https://<region>-astra-voice-training.cloudfunctions.net/bootstrapSuperadmin
 *   header: x-bootstrap-token: <token>
 *   body (optional): { "userid": "...", "password": "...", "name": "..." }
 * Defaults: amrita.mandal / Astra@2026.
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import bcrypt from "bcryptjs";

export const BOOTSTRAP_TOKEN = defineSecret("BOOTSTRAP_TOKEN");

export const bootstrapSuperadmin = onRequest(
  { secrets: [BOOTSTRAP_TOKEN] },
  async (req, res) => {
    const provided = req.get("x-bootstrap-token") || (req.query.token as string);
    if (!provided || provided !== BOOTSTRAP_TOKEN.value()) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const db = admin.firestore();
    const auth = admin.auth();

    const existing = await db
      .collection("users")
      .where("role", "==", "superadmin")
      .limit(1)
      .get();
    if (!existing.empty) {
      res.status(409).json({ error: "a superadmin already exists" });
      return;
    }

    const body = (req.body || {}) as Record<string, string>;
    const userid = (body.userid || "amrita.mandal").trim();
    const password = body.password || "Astra@2026";
    const displayName = body.name || "Amrita Mandal";
    const key = userid.toLowerCase();

    const rec = await auth.createUser({ displayName });
    await auth.setCustomUserClaims(rec.uid, { role: "superadmin" });
    const passwordHash = await bcrypt.hash(password, 10);
    const now = Date.now();

    const batch = db.batch();
    batch.set(db.collection("users").doc(rec.uid), {
      userid,
      displayName,
      role: "superadmin",
      status: "active",
      groups: [],
      mustChangePassword: false,
      createdAt: now,
      createdBy: "bootstrap-fn",
    });
    batch.set(db.collection("credentials").doc(rec.uid), {
      passwordHash,
      failedAttempts: 0,
      lockedUntil: 0,
      updatedAt: now,
    });
    batch.set(db.collection("usernames").doc(key), { uid: rec.uid });
    await batch.commit();

    res.json({ ok: true, uid: rec.uid, userid });
  }
);
