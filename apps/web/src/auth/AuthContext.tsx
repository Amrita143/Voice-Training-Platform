import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { useridToEmail } from "../lib/userid";
import type { Role } from "@avtp/shared";

export interface AuthUser {
  uid: string;
  role: Role;
  displayName: string;
  userid: string;
  mustChangePassword: boolean;
}

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (userid: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (newPassword: string, oldPassword?: string) => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

async function loadProfile(uid: string): Promise<AuthUser | null> {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, unknown>;
  if (d.status === "disabled") {
    const err = new Error("This account is disabled.");
    (err as { code?: string }).code = "account-disabled";
    throw err;
  }
  return {
    uid,
    role: (d.role as Role) ?? "trainee",
    displayName: (d.displayName as string) || "",
    userid: (d.userid as string) || "",
    mustChangePassword: !!d.mustChangePassword,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      try {
        const profile = await loadProfile(fbUser.uid);
        if (!profile) {
          await signOut(auth);
          setUser(null);
        } else {
          setUser(profile);
        }
      } catch {
        await signOut(auth);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const login = async (userid: string, password: string) => {
    await signInWithEmailAndPassword(auth, useridToEmail(userid), password);
    // onAuthStateChanged loads the profile (and signs out disabled accounts).
  };

  const logout = async () => {
    await signOut(auth);
  };

  const changePassword = async (newPassword: string, oldPassword?: string) => {
    const cur = auth.currentUser;
    if (!cur) throw new Error("Not signed in.");
    if (oldPassword && cur.email) {
      const cred = EmailAuthProvider.credential(cur.email, oldPassword);
      await reauthenticateWithCredential(cur, cred);
    }
    await updatePassword(cur, newPassword);
    await updateDoc(doc(db, "users", cur.uid), { mustChangePassword: false });
    setUser((u) => (u ? { ...u, mustChangePassword: false } : u));
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, changePassword }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
