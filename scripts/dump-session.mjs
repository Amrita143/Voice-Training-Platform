// Dumps the most recent session(s) — full transcript + trace — so we can compare
// the STORED data against what was displayed live. Read-only.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, limit, orderBy, query } from "firebase/firestore";
const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");

const snap = await getDocs(query(collection(db,"sessions"), orderBy("startedAt","desc"), limit(8)));
console.log("=== RECENT SESSIONS ===");
snap.docs.forEach((d,i)=>{ const s=d.data(); console.log(`[${i}] ${new Date(s.startedAt).toLocaleString()} | ${s.agentName} | dur=${s.durationSec||0}s | counts=${JSON.stringify(s.counts||{})} | id=${d.id}`); });

const target = snap.docs[0];               // most recent = the one under test
const s = target.data();
const start = s.startedAt;
const rel = (ts)=>{ const t=Math.max(0,Math.round((ts-start)/1000)); return `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`; };
console.log(`\n=== DUMP session ${target.id} (${new Date(start).toLocaleString()}) ===`);
const ev = await getDocs(query(collection(db,"sessions",target.id,"events"), orderBy("ts","asc")));
console.log(`events: ${ev.size}\n`);
ev.docs.forEach((d)=>{
  const e = d.data();
  if (e.type === "tool_call") {
    const t = e.tool||{};
    const nchunks = Array.isArray(t.results) ? t.results.length : (t.results===null?"null":"none");
    console.log(`[${rel(e.ts)}] TOOL ${t.name} status=${t.status} q="${t.query||""}" count=${t.resultCount} chunks=${nchunks} lat=${t.latencyMs}ms`);
  } else {
    const who = e.type === "user_msg" ? (e.via==="text"?"USER(typed)":"USER(spoken)") : e.type === "assistant_msg" ? "COACH" : e.type === "catalog_click" ? "USER(guided)" : e.type.toUpperCase();
    console.log(`[${rel(e.ts)}] ${who}: ${JSON.stringify(e.text||"")}`);
  }
});
process.exit(0);
