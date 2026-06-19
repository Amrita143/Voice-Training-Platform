// Verifies the guide load (sections + subsections + questions) reads cleanly,
// and that a subsection can be created/read (the previously-missing rule).
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, addDoc, deleteDoc, doc, query, where } from "firebase/firestore";

const cfg = {
  apiKey: "AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU",
  authDomain: "astra-voice-training.firebaseapp.com",
  projectId: "astra-voice-training",
  appId: "1:79475919948:web:e9e34c8b48d4ba4256f8e9",
};
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const agents = await getDocs(collection(db, "agents"));
const agentId = (agents.docs.find((d) => /everest/i.test(d.data().name)) || agents.docs[0]).id;

// the exact Promise.all the UI does
const [secs, subs, qs] = await Promise.all([
  getDocs(query(collection(db, "sections"), where("agentId", "==", agentId))),
  getDocs(query(collection(db, "subsections"), where("agentId", "==", agentId))),
  getDocs(query(collection(db, "questions"), where("agentId", "==", agentId))),
]);
console.log(`✓ guide load OK — sections:${secs.size} subsections:${subs.size} questions:${qs.size}`);

// create + read + delete a subsection (was previously denied)
const ref = await addDoc(collection(db, "subsections"), { agentId, sectionId: secs.docs[0]?.id || "x", title: "SMOKE SUB", order: 99 });
const back = await getDocs(query(collection(db, "subsections"), where("agentId", "==", agentId)));
console.log("✓ subsection create+read OK, count now:", back.size);
await deleteDoc(doc(db, "subsections", ref.id));
console.log("✓ cleaned up. RESULT: subsections rule fixed; guide loads.");
process.exit(0);
