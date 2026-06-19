import { HttpsError, CallableRequest } from "firebase-functions/v2/https";

export type Role = "superadmin" | "admin" | "trainee";
export const ROLES: Role[] = ["superadmin", "admin", "trainee"];

export interface Caller {
  uid: string;
  role: Role;
}

/** Require an authenticated caller with a role claim. */
export function requireAuth(req: CallableRequest): Caller {
  const uid = req.auth?.uid;
  const role = req.auth?.token?.role as Role | undefined;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in required.");
  if (!role || !ROLES.includes(role)) {
    throw new HttpsError("permission-denied", "No valid role on this account.");
  }
  return { uid, role };
}

/** Require the caller to hold one of the given roles. */
export function requireRole(req: CallableRequest, roles: Role[]): Caller {
  const caller = requireAuth(req);
  if (!roles.includes(caller.role)) {
    throw new HttpsError("permission-denied", "Insufficient permissions.");
  }
  return caller;
}

/** Normalized lookup key for a userid (case-insensitive, trimmed). */
export const usernameKey = (userid: string): string =>
  String(userid || "").trim().toLowerCase();

export function assertPasswordPolicy(pw: string): void {
  if (!pw || pw.length < 8) {
    throw new HttpsError(
      "invalid-argument",
      "Password must be at least 8 characters."
    );
  }
}

export function assertNonEmpty(value: unknown, field: string): string {
  const s = String(value ?? "").trim();
  if (!s) throw new HttpsError("invalid-argument", `${field} is required.`);
  return s;
}
