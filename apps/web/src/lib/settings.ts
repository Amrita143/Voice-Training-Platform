import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import type { GlobalSettings } from "@avtp/shared";

// A value of 0 means "unlimited / disabled" everywhere in the limits system.
export const DEFAULT_SETTINGS: GlobalSettings = {
  maxSessionMinutes: 30,
  maxConcurrentSessionsPerUser: 1,
  maxConcurrentSessionsTotal: 0,
  idleTimeoutSec: 180,
  defaultUsageLimits: { perDayMin: 0, perWeekMin: 0, perMonthMin: 0 },
};

export async function getGlobalSettings(): Promise<GlobalSettings> {
  const s = await getDoc(doc(db, "settings", "global"));
  if (!s.exists()) return DEFAULT_SETTINGS;
  const d = s.data() as Partial<GlobalSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    defaultUsageLimits: { ...DEFAULT_SETTINGS.defaultUsageLimits, ...(d.defaultUsageLimits || {}) },
  };
}

export async function saveGlobalSettings(
  patch: Partial<GlobalSettings>,
  uid: string
): Promise<void> {
  await setDoc(
    doc(db, "settings", "global"),
    { ...patch, updatedAt: Date.now(), updatedBy: uid },
    { merge: true }
  );
}
