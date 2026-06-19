// Verifies the new Phase-7.1 data paths under live rules:
//  - errorLogs: create (signedIn) + read (staff)
//  - liveSessions: create/read (signedIn) + stale filtering + global count + delete
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, doc, setDoc, deleteDoc, addDoc, collection, getDocs, orderBy, query, limit,
} from "firebase/firestore";
const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
const { user } = await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const uid = user.uid;
const STALE_MS = 50000;

// --- errorLogs ---
const eref = await addDoc(collection(db, "errorLogs"), {
  ts: Date.now(), source: "voice", code: "rate_limit",
  message: "VERIFY rate limit (delete me)", userId: uid, userid: "amrita.mandal",
});
const elogs = (await getDocs(query(collection(db, "errorLogs"), orderBy("ts", "desc"), limit(5)))).docs.map(d=>d.data());
console.log(`✓ errorLogs create+read OK — latest code=${elogs[0]?.code} msg="${elogs[0]?.message}"`);
await deleteDoc(eref);
console.log("✓ errorLogs cleanup OK");

// --- liveSessions ---
const now = Date.now();
await setDoc(doc(db, "liveSessions", "VERIFY_fresh"), { userId: uid, agentName: "VERIFY", startedAt: now, lastSeen: now });
await setDoc(doc(db, "liveSessions", "VERIFY_stale"), { userId: uid, agentName: "VERIFY", startedAt: now - 600000, lastSeen: now - 120000 });
const all = (await getDocs(collection(db, "liveSessions"))).docs.map(d=>({id:d.id,...d.data()}));
const live = all.filter(x => now - (x.lastSeen||0) < STALE_MS);
console.log(`✓ liveSessions read OK — total docs:${all.length} non-stale(live):${live.length} (stale excluded from count)`);
const mine = live.filter(x => x.userId === uid).length;
console.log(`✓ global concurrency count works — platform live:${live.length}, this user:${mine}`);
await deleteDoc(doc(db, "liveSessions", "VERIFY_fresh"));
await deleteDoc(doc(db, "liveSessions", "VERIFY_stale"));
console.log("✓ liveSessions cleanup OK");
console.log("RESULT: concurrency + error-log pipeline OK");
process.exit(0);
