import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, deleteDoc } from "firebase/firestore";
const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const junk = ["g1Aj1nh1NcyQpEH0dgeO", "kNnOkRspFiBxXrP3thzQ", "mcwuYlgiU7KIZsnmN5NL"];
for (const id of junk) { await deleteDoc(doc(db, "sections", id)); console.log("deleted section", id); }
console.log("✓ removed", junk.length, "junk sections");
process.exit(0);
