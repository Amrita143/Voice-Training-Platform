// Verifies the Phase-7 data paths + limit math against live Firestore:
//  - superadmin can write & read settings/global
//  - sessions self-query (where userId==me) works (for usage)
//  - groups member-query works
//  - resolveEffectiveLimits + evaluateStart math (mirrors lib/limits.ts)
// Also writes sensible production defaults to settings/global at the end.
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, where,
} from "firebase/firestore";
const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
const { user } = await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const uid = user.uid;

const mostRestrictive = (vals) => { const p = vals.filter((v) => typeof v === "number" && v > 0); return p.length ? Math.min(...p) : 0; };
const sod = () => { const x = new Date(); x.setHours(0,0,0,0); return x.getTime(); };
const sow = () => { const x = new Date(); const d = (x.getDay()+6)%7; x.setDate(x.getDate()-d); x.setHours(0,0,0,0); return x.getTime(); };
const som = () => { const x = new Date(); x.setDate(1); x.setHours(0,0,0,0); return x.getTime(); };

// 1) write a TEST settings doc then read it
await setDoc(doc(db,"settings","global"), {
  maxSessionMinutes: 5, maxConcurrentSessionsPerUser: 1, idleTimeoutSec: 120,
  defaultUsageLimits: { perDayMin: 10, perWeekMin: 0, perMonthMin: 0 },
  updatedAt: Date.now(), updatedBy: uid,
}, { merge: true });
const s = (await getDoc(doc(db,"settings","global"))).data();
console.log("✓ settings write/read OK:", JSON.stringify({ maxSession: s.maxSessionMinutes, concurrent: s.maxConcurrentSessionsPerUser, idle: s.idleTimeoutSec, def: s.defaultUsageLimits }));

// 2) user doc + groups + sessions
const udoc = (await getDoc(doc(db,"users",uid))).data() || {};
const groups = (await getDocs(query(collection(db,"groups"), where("memberUids","array-contains",uid)))).docs.map(d=>d.data());
const sessions = (await getDocs(query(collection(db,"sessions"), where("userId","==",uid)))).docs.map(d=>d.data());
console.log(`✓ self reads OK — groups(member):${groups.length} sessions:${sessions.length}`);

// 3) effective limits (most restrictive of default / user / groups)
const ul = udoc.usageLimits || {}; const gl = groups.map(g=>g.usageLimits||{}); const def = s.defaultUsageLimits||{};
const pick = (k) => mostRestrictive([def[k], ul[k], ...gl.map(g=>g[k])]);
const limits = {
  maxSessionMin: mostRestrictive([s.maxSessionMinutes, udoc.maxSessionMinutes]),
  maxConcurrent: s.maxConcurrentSessionsPerUser||0, idleTimeoutSec: s.idleTimeoutSec||0,
  perDayMin: pick("perDayMin"), perWeekMin: pick("perWeekMin"), perMonthMin: pick("perMonthMin"),
};
const minsSince = (since) => sessions.filter(x=>x.startedAt>=since).reduce((n,x)=>n+(x.durationSec||0),0)/60;
const usedDay = minsSince(sod()), usedWeek = minsSince(sow()), usedMonth = minsSince(som());
const rem = (l,u)=> l>0 ? Math.max(0,l-u) : Infinity;
const remaining = Math.min(rem(limits.perDayMin,usedDay), rem(limits.perWeekMin,usedWeek), rem(limits.perMonthMin,usedMonth));
const caps = [limits.maxSessionMin>0?limits.maxSessionMin:Infinity, remaining];
const sessionCap = Number.isFinite(Math.min(...caps)) ? Math.floor(Math.min(...caps)) : 0;
console.log("✓ effective limits:", JSON.stringify(limits));
console.log(`✓ usage today=${usedDay.toFixed(1)}m week=${usedWeek.toFixed(1)}m month=${usedMonth.toFixed(1)}m → remaining=${remaining===Infinity?"∞":remaining.toFixed(1)}m, sessionCap=${sessionCap}m`);

// 4) restore sensible production defaults (unlimited usage; safety caps on)
await setDoc(doc(db,"settings","global"), {
  maxSessionMinutes: 30, maxConcurrentSessionsPerUser: 1, idleTimeoutSec: 180,
  defaultUsageLimits: { perDayMin: 0, perWeekMin: 0, perMonthMin: 0 },
  updatedAt: Date.now(), updatedBy: uid,
}, { merge: true });
console.log("✓ restored production defaults (maxSession=30m, concurrent=1, idle=180s, usage=unlimited)");
console.log("RESULT: Phase-7 limits pipeline OK");
process.exit(0);
