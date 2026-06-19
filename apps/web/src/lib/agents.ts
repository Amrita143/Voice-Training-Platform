import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { AgentDoc } from "@avtp/shared";

export type AgentWithId = AgentDoc & { id: string };

export function emptyAgent(uid: string): AgentDoc {
  return {
    name: "",
    description: "",
    status: "draft",
    model: "grok-voice-think-fast-1.0",
    systemPrompt: "",
    promptVersion: 1,
    voices: { default: "rex", allowed: ["rex"] },
    knowledgeBase: {
      enabled: false,
      provider: "custom",
      collectionIds: [],
      maxNumResults: 10,
      retrievalMode: "hybrid",
      dedupe: true,
      limit: 10,
    },
    webSearch: { enabled: false },
    tools: [],
    createdAt: Date.now(),
    createdBy: uid,
  };
}

export async function listAgents(): Promise<AgentWithId[]> {
  const snap = await getDocs(
    query(collection(db, "agents"), orderBy("createdAt", "desc"))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as AgentDoc) }));
}

export async function getAgent(id: string): Promise<AgentWithId | null> {
  const s = await getDoc(doc(db, "agents", id));
  return s.exists() ? { id: s.id, ...(s.data() as AgentDoc) } : null;
}

export async function createAgent(data: AgentDoc): Promise<string> {
  const ref = doc(collection(db, "agents"));
  await setDoc(ref, data);
  return ref.id;
}

export async function updateAgent(
  id: string,
  data: Partial<AgentDoc>
): Promise<void> {
  await setDoc(doc(db, "agents", id), data, { merge: true });
}

export async function deleteAgent(id: string): Promise<void> {
  await deleteDoc(doc(db, "agents", id));
}
