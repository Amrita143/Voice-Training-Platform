/**
 * Seed the first superadmin into LIVE Firebase (Spark) using the client SDK.
 * Requires the TEMP-BOOTSTRAP rule (self-create users doc) to be deployed.
 * Run from repo root:  node scripts/seed-superadmin.mjs
 */
import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU",
  authDomain: "astra-voice-training.firebaseapp.com",
  projectId: "astra-voice-training",
  storageBucket: "astra-voice-training.firebasestorage.app",
  messagingSenderId: "79475919948",
  appId: "1:79475919948:web:e9e34c8b48d4ba4256f8e9",
};

const USERID = process.env.SA_USERID || "amrita.mandal";
const PASSWORD = process.env.SA_PASSWORD || "Astra@2026";
const NAME = process.env.SA_NAME || "Amrita Mandal";
const email = `${USERID.toLowerCase()}@astra-voice-training.local`;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let cred;
try {
  cred = await createUserWithEmailAndPassword(auth, email, PASSWORD);
  console.log("created auth user");
} catch (e) {
  if (e.code === "auth/email-already-in-use") {
    cred = await signInWithEmailAndPassword(auth, email, PASSWORD);
    console.log("auth user already existed; signed in");
  } else {
    throw e;
  }
}

const uid = cred.user.uid;
await setDoc(
  doc(db, "users", uid),
  {
    userid: USERID,
    displayName: NAME,
    role: "superadmin",
    status: "active",
    groups: [],
    mustChangePassword: false,
    createdAt: Date.now(),
    createdBy: "seed",
  },
  { merge: true }
);

console.log(`✓ Seeded superadmin "${USERID}" (uid=${uid}).`);
process.exit(0);
