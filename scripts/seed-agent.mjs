// Seeds the "Everest Debt Collection Process Trainer" agent into live Firestore
// (as superadmin), using the prototype's Instruction.md as the system prompt.
import { readFileSync } from "fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";

const cfg = {
  apiKey: "AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU",
  authDomain: "astra-voice-training.firebaseapp.com",
  projectId: "astra-voice-training",
  storageBucket: "astra-voice-training.firebasestorage.app",
  messagingSenderId: "79475919948",
  appId: "1:79475919948:web:e9e34c8b48d4ba4256f8e9",
};
const app = initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);

const cred = await signInWithEmailAndPassword(
  auth,
  "amrita.mandal@astra-voice-training.local",
  "Astra@2026"
);
console.log("✓ signed in as superadmin");

const prompt = readFileSync(
  "C:/Users/amrita.mandal/Downloads/xAI Voice API/Instruction.md",
  "utf8"
);

const agent = {
  name: "Everest Debt Collection Process Trainer",
  description:
    "Voice coach that trains collection agents on the Everest / DNF Associates process.",
  status: "published",
  model: "grok-voice-think-fast-1.0",
  systemPrompt: prompt,
  promptVersion: 1,
  voices: { default: "rex", allowed: ["rex", "eve", "ara", "sal", "leo"] },
  knowledgeBase: {
    enabled: true,
    collectionIds: ["collection_58eb8df0-2907-4638-9c17-e82815f5aede"],
    maxNumResults: 10,
    retrievalMode: "hybrid",
    dedupe: true,
    limit: 10,
  },
  webSearch: { enabled: false },
  tools: [],
  createdAt: Date.now(),
  createdBy: cred.user.uid,
};

const ref = await addDoc(collection(db, "agents"), agent);
console.log(`✓ created agent (id=${ref.id}, prompt ${prompt.length} chars)`);

const snap = await getDocs(query(collection(db, "agents"), orderBy("createdAt", "desc")));
console.log(`✓ agents in project: ${snap.size}`);
snap.docs.forEach((d) =>
  console.log(`   - ${d.data().name} [${d.data().status}] KB=${d.data().knowledgeBase?.enabled}`)
);
process.exit(0);
