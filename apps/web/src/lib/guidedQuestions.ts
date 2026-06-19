// Guided Questions: per-agent curated prompts, organized Section -> Subsection -> Question,
// with selective visibility (a section is shown to everyone, or only to chosen trainees/groups).
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase";
import type { Role } from "@avtp/shared";

export type Visibility = "all" | "restricted";

export interface Section {
  id: string;
  agentId: string;
  title: string;
  order: number;
  visibility: Visibility;
  allowedUserIds: string[];
  allowedGroupIds: string[];
}
export interface Subsection {
  id: string;
  agentId: string;
  sectionId: string;
  title: string;
  order: number;
}
export interface Question {
  id: string;
  agentId: string;
  sectionId: string;
  subsectionId: string | null;
  text: string;
  order: number;
  enabled: boolean;
}

const bySort = <T extends { order: number }>(a: T, b: T) => a.order - b.order;

// ---- reads ----
export async function listSections(agentId: string): Promise<Section[]> {
  const s = await getDocs(query(collection(db, "sections"), where("agentId", "==", agentId)));
  return s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Section, "id">) })).sort(bySort);
}
export async function listSubsections(agentId: string): Promise<Subsection[]> {
  const s = await getDocs(query(collection(db, "subsections"), where("agentId", "==", agentId)));
  return s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subsection, "id">) })).sort(bySort);
}
export async function listQuestions(agentId: string): Promise<Question[]> {
  const s = await getDocs(query(collection(db, "questions"), where("agentId", "==", agentId)));
  return s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Question, "id">) })).sort(bySort);
}

// ---- writes (staff only, per rules) ----
export async function createSection(agentId: string, title: string, order: number, by: string) {
  return (
    await addDoc(collection(db, "sections"), {
      agentId,
      title,
      order,
      visibility: "all" as Visibility,
      allowedUserIds: [],
      allowedGroupIds: [],
      createdAt: Date.now(),
      createdBy: by,
    })
  ).id;
}
export async function updateSection(id: string, patch: Partial<Section>) {
  await setDoc(doc(db, "sections", id), patch, { merge: true });
}
export async function deleteSection(id: string) {
  await deleteDoc(doc(db, "sections", id));
}

export async function createSubsection(agentId: string, sectionId: string, title: string, order: number) {
  return (await addDoc(collection(db, "subsections"), { agentId, sectionId, title, order })).id;
}
export async function updateSubsection(id: string, patch: Partial<Subsection>) {
  await setDoc(doc(db, "subsections", id), patch, { merge: true });
}
export async function deleteSubsection(id: string) {
  await deleteDoc(doc(db, "subsections", id));
}

export async function createQuestion(
  agentId: string,
  sectionId: string,
  subsectionId: string | null,
  text: string,
  order: number
) {
  return (
    await addDoc(collection(db, "questions"), {
      agentId,
      sectionId,
      subsectionId: subsectionId || null,
      text,
      order,
      enabled: true,
    })
  ).id;
}
export async function updateQuestion(id: string, patch: Partial<Question>) {
  await setDoc(doc(db, "questions", id), patch, { merge: true });
}
export async function deleteQuestion(id: string) {
  await deleteDoc(doc(db, "questions", id));
}

// ---- trainee resolution (visibility-filtered tree) ----
export async function getMyGroupIds(uid: string): Promise<string[]> {
  const s = await getDocs(query(collection(db, "groups"), where("memberUids", "array-contains", uid)));
  return s.docs.map((d) => d.id);
}

export interface GuideSub extends Subsection {
  questions: Question[];
}
export interface GuideSection extends Section {
  subsections: GuideSub[];
  looseQuestions: Question[];
}

export async function resolveVisibleGuide(
  agentId: string,
  uid: string,
  role: Role
): Promise<GuideSection[]> {
  const isStaff = role !== "trainee";
  const [sections, subs, questions, groupIds] = await Promise.all([
    listSections(agentId),
    listSubsections(agentId),
    listQuestions(agentId),
    isStaff ? Promise.resolve([] as string[]) : getMyGroupIds(uid),
  ]);

  const canSee = (s: Section) =>
    isStaff ||
    s.visibility !== "restricted" ||
    (s.allowedUserIds || []).includes(uid) ||
    (s.allowedGroupIds || []).some((g) => groupIds.includes(g));

  const tree = sections.filter(canSee).map((s) => {
    const subsections: GuideSub[] = subs
      .filter((x) => x.sectionId === s.id)
      .map((ss) => ({
        ...ss,
        questions: questions.filter((q) => q.sectionId === s.id && q.subsectionId === ss.id && q.enabled),
      }));
    const looseQuestions = questions.filter((q) => q.sectionId === s.id && !q.subsectionId && q.enabled);
    return { ...s, subsections, looseQuestions };
  });
  // hide sections with nothing visible
  return tree.filter((s) => s.looseQuestions.length || s.subsections.some((ss) => ss.questions.length));
}
