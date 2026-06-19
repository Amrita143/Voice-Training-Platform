// Verifies the dashboard's data path: staff can list sessions and read a
// session's events subcollection under live rules.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, limit, orderBy, query } from "firebase/firestore";
const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");

const snap = await getDocs(query(collection(db,"sessions"), orderBy("startedAt","desc"), limit(50)));
console.log(`✓ sessions readable — count: ${snap.size}`);
let i = 0;
for (const d of snap.docs.slice(0, 5)) {
  const s = d.data();
  console.log(`  • ${new Date(s.startedAt).toLocaleString()} | ${s.agentName} | user=${String(s.userId).slice(0,8)} | dur=${s.durationSec||0}s | status=${s.status} | counts=${JSON.stringify(s.counts||{})}`);
  i++;
}
if (snap.size) {
  const first = snap.docs[0];
  const ev = await getDocs(query(collection(db,"sessions",first.id,"events"), orderBy("ts","asc")));
  const byType = {};
  ev.docs.forEach(e => { const t = e.data().type; byType[t] = (byType[t]||0)+1; });
  console.log(`✓ events readable for ${first.id} — count: ${ev.size}, byType: ${JSON.stringify(byType)}`);
}
console.log("RESULT: analytics data path OK");
process.exit(0);
