// Seeds a starter Guided Questions catalog for the Everest agent (idempotent:
// skips if the agent already has any sections). Run as superadmin.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, addDoc, query, where } from "firebase/firestore";

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

const agentsSnap = await getDocs(collection(db, "agents"));
const everest = agentsSnap.docs.find((d) => /everest/i.test(d.data().name)) || agentsSnap.docs[0];
const agentId = everest.id;
console.log("agent:", everest.data().name);

const existing = await getDocs(query(collection(db, "sections"), where("agentId", "==", agentId)));
if (!existing.empty) {
  console.log(`Agent already has ${existing.size} section(s) — skipping seed.`);
  process.exit(0);
}

const CATALOG = [
  {
    title: "Call Handling",
    questions: [
      "I'm not able to convert right-party contacts into payments — how do I do that effectively?",
      "How do I handle a consumer who says 'I'll think about it' and keeps stalling?",
      "What's the best way to take control of the call early without sounding aggressive?",
      "A consumer says they have no money today — how do I probe for resources?",
    ],
  },
  {
    title: "Compliance",
    questions: [
      "Walk me through the correct call-opening order.",
      "The consumer's spouse answered and we're in a non-spousal state — what can I say?",
      "When can I mention possible legal action without violating compliance?",
    ],
  },
  {
    title: "Objections & Rebuttals",
    questions: [
      "Consumer says 'I had insurance, this should've been covered' — what do I say?",
      "Consumer says the car was repossessed so they don't owe anything — how do I respond?",
      "Consumer says 'send me something in writing first' — how do I keep momentum?",
    ],
  },
];

let sOrder = 1;
for (const sec of CATALOG) {
  const secRef = await addDoc(collection(db, "sections"), {
    agentId, title: sec.title, order: sOrder++,
    visibility: "all", allowedUserIds: [], allowedGroupIds: [], createdAt: Date.now(), createdBy: uid,
  });
  let qOrder = 1;
  for (const text of sec.questions) {
    await addDoc(collection(db, "questions"), {
      agentId, sectionId: secRef.id, subsectionId: null, text, order: qOrder++, enabled: true,
    });
  }
  console.log(`  + ${sec.title} (${sec.questions.length} questions)`);
}
console.log("✓ seeded starter Guided Questions catalog.");
process.exit(0);
