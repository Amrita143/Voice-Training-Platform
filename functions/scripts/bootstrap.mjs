/**
 * Bootstrap the first superadmin. Idempotent (skips if the userid exists).
 *
 * EMULATOR (recommended for dev) — start emulators first, then:
 *   $env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"
 *   $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"
 *   $env:GCLOUD_PROJECT="astra-voice-training"
 *   node scripts/bootstrap.mjs
 *
 * PRODUCTION — requires Application Default Credentials:
 *   gcloud auth application-default login   (or set GOOGLE_APPLICATION_CREDENTIALS)
 *   $env:GCLOUD_PROJECT="astra-voice-training"; node scripts/bootstrap.mjs
 *
 * Overridable via env: SA_USERID, SA_PASSWORD, SA_NAME.
 */
import admin from "firebase-admin";
import bcrypt from "bcryptjs";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "astra-voice-training";
const USERID = process.env.SA_USERID || "amrita.mandal";
const PASSWORD = process.env.SA_PASSWORD || "Astra@2026";
const DISPLAY = process.env.SA_NAME || "Amrita Mandal";

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();
const key = USERID.trim().toLowerCase();
const now = Date.now();

const usingEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
console.log(
  `Bootstrapping superadmin "${USERID}" on project ${PROJECT_ID} ` +
    `(${usingEmulator ? "EMULATOR" : "PRODUCTION"})...`
);

const existing = await db.collection("usernames").doc(key).get();
if (existing.exists) {
  console.log(`✓ userid "${USERID}" already exists (uid=${existing.get("uid")}). Nothing to do.`);
  process.exit(0);
}

const userRecord = await auth.createUser({ displayName: DISPLAY });
const uid = userRecord.uid;
await auth.setCustomUserClaims(uid, { role: "superadmin" });

const passwordHash = await bcrypt.hash(PASSWORD, 10);
const batch = db.batch();
batch.set(db.collection("users").doc(uid), {
  userid: USERID,
  displayName: DISPLAY,
  role: "superadmin",
  status: "active",
  groups: [],
  mustChangePassword: false,
  createdAt: now,
  createdBy: "bootstrap",
});
batch.set(db.collection("credentials").doc(uid), {
  passwordHash,
  failedAttempts: 0,
  lockedUntil: 0,
  updatedAt: now,
});
batch.set(db.collection("usernames").doc(key), { uid });
await batch.commit();

console.log(`✓ Seeded superadmin "${USERID}" (uid=${uid}).`);
process.exit(0);
