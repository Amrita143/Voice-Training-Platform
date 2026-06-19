// Verifies Firestore accepts the enriched tool_call trace (nested args object +
// array-of-maps chunks) and that it reads back intact. Uses a throwaway session
// owned by the superadmin, then cleans up.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, collection, addDoc, getDocs, deleteDoc, doc, orderBy, query,
} from "firebase/firestore";
const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
const { user } = await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");

// throwaway session owned by me
const sref = await addDoc(collection(db, "sessions"), {
  userId: user.uid, agentId: "verify", agentName: "VERIFY (delete me)",
  startedAt: Date.now(), endedAt: null, status: "active", voiceUsed: "rex",
  counts: { spoken: 0, typed: 0, catalogClicks: 0, toolCalls: 1, errors: 0 },
});

// the exact enriched tool_call shape Train.tsx now writes
const toolEvent = {
  ts: Date.now(),
  type: "tool_call",
  tool: {
    name: "search_knowledge_base",
    status: "done",
    query: "pre-legal account opening compliance",
    args: { query: "pre-legal account opening compliance" },
    resultCount: 2,
    results: [
      { content: "Chunk one content about pre-legal review.", score: 0.913, fileId: "file_abc" },
      { content: "Chunk two: never say sue or garnish.", score: 0.557 },
    ],
    resultPreview: null,
    latencyMs: 184,
    httpStatus: null,
    error: null,
  },
};
await addDoc(collection(db, "sessions", sref.id, "events"), toolEvent);
console.log("✓ wrote enriched tool_call event");

const ev = await getDocs(query(collection(db, "sessions", sref.id, "events"), orderBy("ts", "asc")));
const back = ev.docs[0].data();
console.log("✓ read back — chunks:", back.tool.results.length,
  "| score#1:", back.tool.results[0].score,
  "| fileId#1:", back.tool.results[0].fileId,
  "| args.query:", back.tool.args.query,
  "| latencyMs:", back.tool.latencyMs);

// cleanup
for (const d of ev.docs) await deleteDoc(doc(db, "sessions", sref.id, "events", d.id));
await deleteDoc(doc(db, "sessions", sref.id));
console.log("✓ cleaned up. RESULT: enriched trace write/read OK");
process.exit(0);
