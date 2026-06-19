import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { listAgents, type AgentWithId } from "./agents";
import type { AgentDoc, Role } from "@avtp/shared";

// Agents a user can train with.
// Staff: all published agents (can test any). Trainee: direct + group assignments.
export async function getMyAgents(uid: string, role: Role): Promise<AgentWithId[]> {
  if (role === "superadmin" || role === "admin") {
    return (await listAgents()).filter((a) => a.status === "published");
  }
  const ids = new Set<string>();
  const u = await getDoc(doc(db, "users", uid));
  ((u.data()?.assignedAgentIds as string[]) || []).forEach((id) => ids.add(id));
  const gsnap = await getDocs(
    query(collection(db, "groups"), where("memberUids", "array-contains", uid))
  );
  gsnap.forEach((g) =>
    ((g.data().assignedAgentIds as string[]) || []).forEach((id) => ids.add(id))
  );

  const out: AgentWithId[] = [];
  for (const id of ids) {
    const s = await getDoc(doc(db, "agents", id));
    if (s.exists() && s.data().status === "published") {
      out.push({ id: s.id, ...(s.data() as AgentDoc) });
    }
  }
  return out;
}
