// Verifies the live login path end-to-end (final rules, real Firebase).
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

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
const email = "amrita.mandal@astra-voice-training.local";

// 1) wrong password must fail
try {
  await signInWithEmailAndPassword(auth, email, "definitely-wrong");
  console.log("❌ wrong password unexpectedly SUCCEEDED");
} catch (e) {
  console.log("✓ wrong password rejected:", e.code);
}

// 2) correct password, then read own user doc under FINAL rules
const cred = await signInWithEmailAndPassword(auth, email, "Astra@2026");
const snap = await getDoc(doc(db, "users", cred.user.uid));
if (!snap.exists()) {
  console.log("❌ user doc not readable / missing");
} else {
  const d = snap.data();
  console.log(`✓ signed in uid=${cred.user.uid}`);
  console.log(`✓ profile read under final rules → role=${d.role} status=${d.status} userid=${d.userid}`);
}
await signOut(auth);
process.exit(0);
