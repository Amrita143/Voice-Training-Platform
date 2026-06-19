// Admin user management without a service account (Spark-friendly).
// Create the Auth account via the Identity Toolkit signUp REST endpoint
// (public, gated by the web API key + admin's in-app role), then write the
// users/{uid} profile doc (rules enforce who may create which role).
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { useridToEmail } from "./userid";
import type { Role, UsageLimits } from "@avtp/shared";

const API_KEY = import.meta.env.VITE_FIREBASE_API_KEY;

export interface UserRow {
  uid: string;
  userid: string;
  displayName: string;
  role: Role;
  status: "active" | "disabled";
  createdAt?: number;
  groups?: string[];
  assignedAgentIds?: string[];
  usageLimits?: UsageLimits | null;
  maxSessionMinutes?: number;
}

export async function createUser(input: {
  userid: string;
  displayName: string;
  password: string;
  role: Role;
  createdBy: string;
}): Promise<string> {
  const userid = input.userid.trim();
  if (!userid) throw new Error("Userid is required.");
  if (input.password.length < 8)
    throw new Error("Password must be at least 8 characters.");

  const email = useridToEmail(userid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: input.password,
        returnSecureToken: false,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg: string = data?.error?.message || "SIGNUP_FAILED";
    if (msg.startsWith("EMAIL_EXISTS"))
      throw new Error("That userid is already taken.");
    if (msg.startsWith("WEAK_PASSWORD"))
      throw new Error("Password is too weak (min 6 characters).");
    if (msg.includes("PASSWORD_LOGIN_DISABLED") || msg.includes("ADMIN_ONLY"))
      throw new Error("Email/Password sign-up is disabled on the project.");
    throw new Error(msg);
  }

  const uid: string = data.localId;
  await setDoc(doc(db, "users", uid), {
    userid,
    displayName: input.displayName.trim() || userid,
    role: input.role,
    status: "active",
    groups: [],
    mustChangePassword: true,
    createdAt: Date.now(),
    createdBy: input.createdBy,
  });
  return uid;
}

export async function listUsers(): Promise<UserRow[]> {
  const snap = await getDocs(
    query(collection(db, "users"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<UserRow, "uid">) }));
}

export async function setUserStatus(
  uid: string,
  status: "active" | "disabled"
): Promise<void> {
  await setDoc(doc(db, "users", uid), { status }, { merge: true });
}

export async function setUserAgents(
  uid: string,
  assignedAgentIds: string[]
): Promise<void> {
  await setDoc(doc(db, "users", uid), { assignedAgentIds }, { merge: true });
}

export async function setUserLimits(
  uid: string,
  limits: { usageLimits: UsageLimits | null; maxSessionMinutes: number }
): Promise<void> {
  await setDoc(doc(db, "users", uid), limits, { merge: true });
}
