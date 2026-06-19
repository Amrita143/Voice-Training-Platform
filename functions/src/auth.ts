import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import bcrypt from "bcryptjs";
import {
  requireAuth,
  requireRole,
  usernameKey,
  assertPasswordPolicy,
  assertNonEmpty,
  ROLES,
  Role,
} from "./util";
import { writeAudit } from "./audit";

const BCRYPT_ROUNDS = 10;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

const db = () => admin.firestore();
const now = () => Date.now();

// ---------------------------------------------------------------------------
// login — public. Verify userid+password, return a Firebase Custom Token.
// ---------------------------------------------------------------------------
export const login = onCall(async (req) => {
  const userid = assertNonEmpty(req.data?.userid, "userid");
  const password = assertNonEmpty(req.data?.password, "password");
  const key = usernameKey(userid);

  const invalid = () =>
    new HttpsError("unauthenticated", "Invalid userid or password.");

  const unameSnap = await db().collection("usernames").doc(key).get();
  if (!unameSnap.exists) throw invalid();
  const uid = unameSnap.get("uid") as string;

  const credRef = db().collection("credentials").doc(uid);
  const credSnap = await credRef.get();
  if (!credSnap.exists) throw invalid();

  const lockedUntil = (credSnap.get("lockedUntil") as number) || 0;
  if (lockedUntil > now()) {
    throw new HttpsError(
      "resource-exhausted",
      "Too many failed attempts. Try again later."
    );
  }

  const userSnap = await db().collection("users").doc(uid).get();
  if (!userSnap.exists) throw invalid();
  if (userSnap.get("status") === "disabled") {
    throw new HttpsError("permission-denied", "This account is disabled.");
  }

  const hash = credSnap.get("passwordHash") as string;
  const ok = hash ? await bcrypt.compare(password, hash) : false;
  if (!ok) {
    const failed = ((credSnap.get("failedAttempts") as number) || 0) + 1;
    const update: Record<string, unknown> = { failedAttempts: failed };
    if (failed >= MAX_FAILED) update.lockedUntil = now() + LOCK_MS;
    await credRef.set(update, { merge: true });
    throw invalid();
  }

  // success
  await credRef.set({ failedAttempts: 0, lockedUntil: 0 }, { merge: true });
  const role = userSnap.get("role") as Role;
  const customToken = await admin.auth().createCustomToken(uid, { role });
  return {
    customToken,
    role,
    mustChangePassword: !!userSnap.get("mustChangePassword"),
  };
});

// ---------------------------------------------------------------------------
// changePassword — self-service.
// ---------------------------------------------------------------------------
export const changePassword = onCall(async (req) => {
  const { uid } = requireAuth(req);
  const newPassword = assertNonEmpty(req.data?.newPassword, "newPassword");
  assertPasswordPolicy(newPassword);

  const credRef = db().collection("credentials").doc(uid);
  const credSnap = await credRef.get();
  const oldPassword = req.data?.oldPassword as string | undefined;
  if (oldPassword) {
    const hash = credSnap.get("passwordHash") as string;
    const ok = hash ? await bcrypt.compare(oldPassword, hash) : false;
    if (!ok) throw new HttpsError("permission-denied", "Old password is incorrect.");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await credRef.set(
    { passwordHash, failedAttempts: 0, lockedUntil: 0, updatedAt: now() },
    { merge: true }
  );
  await db()
    .collection("users")
    .doc(uid)
    .set({ mustChangePassword: false }, { merge: true });
  await writeAudit({ actorUid: uid, action: "changePassword", targetType: "user", targetId: uid });
  return { ok: true };
});

// ---------------------------------------------------------------------------
// userAdmin — provisioning. superadmin: any role; admin: trainees only.
// actions: create | setStatus | setPassword | delete
// ---------------------------------------------------------------------------
export const userAdmin = onCall(async (req) => {
  const caller = requireRole(req, ["superadmin", "admin"]);
  const action = assertNonEmpty(req.data?.action, "action");

  // Admins may only act on trainees and may not create non-trainee accounts.
  const ensureAdminMayTargetRole = (targetRole: Role) => {
    if (caller.role === "admin" && targetRole !== "trainee") {
      throw new HttpsError(
        "permission-denied",
        "Admins can only manage trainee accounts."
      );
    }
  };

  if (action === "create") {
    const userid = assertNonEmpty(req.data?.userid, "userid");
    const displayName = assertNonEmpty(req.data?.displayName, "displayName");
    const password = assertNonEmpty(req.data?.password, "password");
    const role = assertNonEmpty(req.data?.role, "role") as Role;
    if (!ROLES.includes(role)) throw new HttpsError("invalid-argument", "Invalid role.");
    ensureAdminMayTargetRole(role);
    assertPasswordPolicy(password);

    const key = usernameKey(userid);
    const unameRef = db().collection("usernames").doc(key);
    if ((await unameRef.get()).exists) {
      throw new HttpsError("already-exists", "That userid is already taken.");
    }

    const userRecord = await admin.auth().createUser({ displayName });
    const uid = userRecord.uid;
    await admin.auth().setCustomUserClaims(uid, { role });

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const batch = db().batch();
    batch.set(db().collection("users").doc(uid), {
      userid,
      displayName,
      role,
      status: "active",
      groups: Array.isArray(req.data?.groups) ? req.data.groups : [],
      mustChangePassword: true,
      createdAt: now(),
      createdBy: caller.uid,
    });
    batch.set(db().collection("credentials").doc(uid), {
      passwordHash,
      failedAttempts: 0,
      lockedUntil: 0,
      updatedAt: now(),
    });
    batch.set(unameRef, { uid });
    await batch.commit();

    await writeAudit({ actorUid: caller.uid, action: "user.create", targetType: "user", targetId: uid, details: { userid, role } });
    return { uid };
  }

  // remaining actions operate on an existing uid
  const uid = assertNonEmpty(req.data?.uid, "uid");
  const targetSnap = await db().collection("users").doc(uid).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "User not found.");
  const targetRole = targetSnap.get("role") as Role;
  ensureAdminMayTargetRole(targetRole);

  if (action === "setStatus") {
    const status = assertNonEmpty(req.data?.status, "status");
    if (status !== "active" && status !== "disabled") {
      throw new HttpsError("invalid-argument", "status must be active|disabled.");
    }
    await admin.auth().updateUser(uid, { disabled: status === "disabled" });
    await db().collection("users").doc(uid).set({ status }, { merge: true });
    await writeAudit({ actorUid: caller.uid, action: "user.setStatus", targetType: "user", targetId: uid, details: { status } });
    return { ok: true };
  }

  if (action === "setPassword") {
    const password = assertNonEmpty(req.data?.password, "password");
    assertPasswordPolicy(password);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await db().collection("credentials").doc(uid).set(
      { passwordHash, failedAttempts: 0, lockedUntil: 0, updatedAt: now() },
      { merge: true }
    );
    await db().collection("users").doc(uid).set({ mustChangePassword: true }, { merge: true });
    await writeAudit({ actorUid: caller.uid, action: "user.setPassword", targetType: "user", targetId: uid });
    return { ok: true };
  }

  if (action === "delete") {
    const userid = targetSnap.get("userid") as string;
    try {
      await admin.auth().deleteUser(uid);
    } catch (e) {
      console.error("auth delete failed (continuing)", e);
    }
    const batch = db().batch();
    batch.delete(db().collection("users").doc(uid));
    batch.delete(db().collection("credentials").doc(uid));
    if (userid) batch.delete(db().collection("usernames").doc(usernameKey(userid)));
    await batch.commit();
    await writeAudit({ actorUid: caller.uid, action: "user.delete", targetType: "user", targetId: uid });
    return { ok: true };
  }

  throw new HttpsError("invalid-argument", `Unknown action: ${action}`);
});
