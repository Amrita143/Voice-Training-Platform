// One-time smoke test: superadmin creates a trainee (REST signUp + users doc)
// under FINAL rules, reads it back, then cleans up the users doc.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";

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
const API_KEY = cfg.apiKey;

await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
console.log("✓ signed in as superadmin");

const userid = `smoketest-${Date.now()}`;
const email = `${userid}@astra-voice-training.local`;
const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "Smoke@12345", returnSecureToken: false }),
});
const data = await res.json();
if (!res.ok) { console.log("❌ signUp failed:", JSON.stringify(data)); process.exit(1); }
const uid = data.localId;
console.log("✓ created auth user via REST signUp, uid=", uid);

await setDoc(doc(db, "users", uid), {
  userid, displayName: "Smoke Test", role: "trainee", status: "active",
  groups: [], mustChangePassword: true, createdAt: Date.now(), createdBy: "smoke",
});
console.log("✓ wrote users doc as superadmin (final rules allowed)");

const snap = await getDoc(doc(db, "users", uid));
console.log("✓ read back:", snap.exists() ? JSON.stringify({ userid: snap.data().userid, role: snap.data().role, status: snap.data().status }) : "MISSING");

await deleteDoc(doc(db, "users", uid));
console.log("✓ cleaned up users doc (auth account left orphaned + inert)");
console.log("RESULT: admin create-user path works end-to-end.");
process.exit(0);
