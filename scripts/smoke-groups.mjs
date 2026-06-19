// Smoke test: groups + assignments under live final rules (superadmin).
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, collection, getDocs, addDoc, doc, getDoc, setDoc, deleteDoc,
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

const cred = await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const uid = cred.user.uid;
console.log("✓ signed in superadmin");

const agentsSnap = await getDocs(collection(db, "agents"));
const agentId = agentsSnap.docs[0]?.id;
console.log("✓ found agent:", agentsSnap.docs[0]?.data().name, agentId);

// 1) create group with member + agent
const gref = await addDoc(collection(db, "groups"), {
  name: "Smoke Batch", description: "throwaway",
  memberUids: [uid], assignedAgentIds: [agentId],
  createdAt: Date.now(), createdBy: uid,
});
const g = await getDoc(doc(db, "groups", gref.id));
console.log("✓ group created+read:", JSON.stringify({ name: g.data().name, members: g.data().memberUids.length, agents: g.data().assignedAgentIds }));

// 2) direct user→agent assignment (then revert)
await setDoc(doc(db, "users", uid), { assignedAgentIds: [agentId] }, { merge: true });
const u = await getDoc(doc(db, "users", uid));
console.log("✓ user.assignedAgentIds set:", JSON.stringify(u.data().assignedAgentIds));
await setDoc(doc(db, "users", uid), { assignedAgentIds: [] }, { merge: true });
console.log("✓ reverted user.assignedAgentIds");

// 3) cleanup group
await deleteDoc(doc(db, "groups", gref.id));
console.log("✓ deleted test group");
console.log("RESULT: groups + assignments path works end-to-end.");
process.exit(0);
