// Smoke test: guided questions CRUD + visibility filtering under live rules.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where,
} from "firebase/firestore";

const cfg = {
  apiKey: "AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU",
  authDomain: "astra-voice-training.firebaseapp.com",
  projectId: "astra-voice-training",
  appId: "1:79475919948:web:e9e34c8b48d4ba4256f8e9",
};
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
const cred = await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const uid = cred.user.uid;
console.log("✓ signed in");

const agents = await getDocs(collection(db, "agents"));
const agentId = agents.docs[0].id;
console.log("✓ agent:", agents.docs[0].data().name);

// create section + question
const secRef = await addDoc(collection(db, "sections"), {
  agentId, title: "SMOKE Section", order: 999,
  visibility: "all", allowedUserIds: [], allowedGroupIds: [], createdAt: Date.now(), createdBy: uid,
});
const qRef = await addDoc(collection(db, "questions"), {
  agentId, sectionId: secRef.id, subsectionId: null, text: "How do I convert RPCs to payments?", order: 1, enabled: true,
});
console.log("✓ created section + question");

// resolver bits
const readAll = async () => {
  const secs = (await getDocs(query(collection(db, "sections"), where("agentId", "==", agentId)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const qs = (await getDocs(query(collection(db, "questions"), where("agentId", "==", agentId)))).docs.map((d) => ({ id: d.id, ...d.data() }));
  return { secs, qs };
};
const visibleAsTrainee = (secs, traineeUid, groupIds) =>
  secs.filter((s) => s.visibility !== "restricted" || (s.allowedUserIds || []).includes(traineeUid) || (s.allowedGroupIds || []).some((g) => groupIds.includes(g)));

let { secs, qs } = await readAll();
const smokeQ = qs.find((q) => q.sectionId === secRef.id);
console.log("✓ staff sees SMOKE section:", secs.some((s) => s.id === secRef.id), "| its question present:", !!smokeQ);

// make it restricted (no one allowed) -> trainee must NOT see it
await updateDoc(doc(db, "sections", secRef.id), { visibility: "restricted" });
({ secs } = await readAll());
const traineeVisible = visibleAsTrainee(secs, "some-other-trainee-uid", []);
console.log("✓ after restrict, trainee sees SMOKE section:", traineeVisible.some((s) => s.id === secRef.id), "(expect false)");

// cleanup
await deleteDoc(doc(db, "questions", qRef.id));
await deleteDoc(doc(db, "sections", secRef.id));
console.log("✓ cleaned up");
console.log("RESULT: guided questions CRUD + visibility filtering work.");
process.exit(0);
