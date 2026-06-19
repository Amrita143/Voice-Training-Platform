// Smoke test: session + trace writes under live rules (owner create, staff cleanup).
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, collection, addDoc, doc, updateDoc, getDoc, getDocs, deleteDoc,
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

// create session (as owner)
const sref = await addDoc(collection(db, "sessions"), {
  userId: uid, agentId: "smoke", agentName: "SMOKE TEST",
  startedAt: Date.now(), endedAt: null, status: "active", voiceUsed: "rex",
  counts: { spoken: 0, typed: 0, catalogClicks: 0, toolCalls: 0, errors: 0 },
});
console.log("✓ session created:", sref.id);

// append trace events
await addDoc(collection(db, "sessions", sref.id, "events"), { type: "user_msg", role: "user", text: "hi", ts: Date.now() });
await addDoc(collection(db, "sessions", sref.id, "events"), { type: "tool_call", tool: { name: "search_knowledge_base", resultCount: 5 }, ts: Date.now() });
console.log("✓ wrote 2 trace events");

// end session
await updateDoc(doc(db, "sessions", sref.id), {
  status: "ended", endedAt: Date.now(), durationSec: 12,
  counts: { spoken: 1, typed: 0, catalogClicks: 0, toolCalls: 1, errors: 0 }, endReason: "user",
});
const s = await getDoc(doc(db, "sessions", sref.id));
const ev = await getDocs(collection(db, "sessions", sref.id, "events"));
console.log("✓ session ended:", JSON.stringify({ status: s.data().status, durationSec: s.data().durationSec, events: ev.size }));

// cleanup (staff delete)
for (const d of ev.docs) await deleteDoc(d.ref);
await deleteDoc(doc(db, "sessions", sref.id));
console.log("✓ cleaned up");
console.log("RESULT: session + trace write path works end-to-end.");
process.exit(0);
