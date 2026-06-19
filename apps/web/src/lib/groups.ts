import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { GroupDoc } from "@avtp/shared";

export type GroupRow = GroupDoc & { id: string };

export async function listGroups(): Promise<GroupRow[]> {
  const snap = await getDocs(
    query(collection(db, "groups"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as GroupDoc) }));
}

export async function createGroup(input: {
  name: string;
  description?: string;
  createdBy: string;
}): Promise<string> {
  const ref = await addDoc(collection(db, "groups"), {
    name: input.name.trim(),
    description: input.description?.trim() || "",
    memberUids: [],
    assignedAgentIds: [],
    createdAt: Date.now(),
    createdBy: input.createdBy,
  });
  return ref.id;
}

export async function updateGroup(
  id: string,
  patch: Partial<GroupDoc>
): Promise<void> {
  await setDoc(doc(db, "groups", id), patch, { merge: true });
}

export async function deleteGroup(id: string): Promise<void> {
  await deleteDoc(doc(db, "groups", id));
}
