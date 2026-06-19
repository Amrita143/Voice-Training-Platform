/**
 * End-to-end test of ALL limit settings against live Firestore + rules.
 * Creates a throwaway trainee, then for each scenario sets limits (as super),
 * consumes minutes / adds live sessions (as the trainee), and runs the EXACT
 * evaluateStart logic (mirrored from lib/limits.ts) signed in AS THE TRAINEE.
 * Cleans up everything at the end and restores production defaults.
 *
 * Run: node --env-file=server/.env scripts/test-limits.mjs   (XAI key not needed)
 */
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, addDoc, collection, getDocs, query, where,
} from "firebase/firestore";

const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
const API_KEY = cfg.apiKey;
const SUPER = ["amrita.mandal@astra-voice-training.local", "Astra@2026"];
const TEMAIL = "limittest@astra-voice-training.local", TPW = "Test@123456", TUSERID = "limittest";

const asSuper = () => signInWithEmailAndPassword(auth, SUPER[0], SUPER[1]);
const asTrainee = () => signInWithEmailAndPassword(auth, TEMAIL, TPW);

let pass = 0, fail = 0;
const check = (label, cond, extra = "") => { console.log(`  ${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`); cond ? pass++ : fail++; };

// ---------- mirror of lib/limits.ts ----------
const DEFAULTS = { maxSessionMinutes:30, maxConcurrentSessionsPerUser:1, maxConcurrentSessionsTotal:0, idleTimeoutSec:180, defaultUsageLimits:{perDayMin:0,perWeekMin:0,perMonthMin:0} };
const STALE_MS = 50000;
const mostRestrictive = (vals) => { const p = vals.filter((v) => typeof v === "number" && v > 0); return p.length ? Math.min(...p) : 0; };
const sod = () => { const x = new Date(); x.setHours(0,0,0,0); return x.getTime(); };
const sow = () => { const x = new Date(); const d=(x.getDay()+6)%7; x.setDate(x.getDate()-d); x.setHours(0,0,0,0); return x.getTime(); };
const som = () => { const x = new Date(); x.setDate(1); x.setHours(0,0,0,0); return x.getTime(); };
async function getSettings() {
  const s = (await getDoc(doc(db,"settings","global"))).data();
  if (!s) return DEFAULTS;
  return { ...DEFAULTS, ...s, defaultUsageLimits: { ...DEFAULTS.defaultUsageLimits, ...(s.defaultUsageLimits||{}) } };
}
async function evaluateStart(uid) {
  const s = await getSettings();
  const udoc = (await getDoc(doc(db,"users",uid))).data() || {};
  const groups = (await getDocs(query(collection(db,"groups"), where("memberUids","array-contains",uid)))).docs.map(d=>d.data());
  const sessions = (await getDocs(query(collection(db,"sessions"), where("userId","==",uid)))).docs.map(d=>d.data());
  const liveAll = (await getDocs(collection(db,"liveSessions"))).docs.map(d=>d.data());
  const now = Date.now();
  const live = liveAll.filter(x => now - (x.lastSeen||0) < STALE_MS);

  const ul = udoc.usageLimits||{}, gl = groups.map(g=>g.usageLimits||{}), def = s.defaultUsageLimits||{};
  const pick = (k) => mostRestrictive([def[k], ul[k], ...gl.map(g=>g[k])]);
  const limits = {
    maxSessionMin: mostRestrictive([s.maxSessionMinutes, udoc.maxSessionMinutes]),
    maxConcurrent: s.maxConcurrentSessionsPerUser||0,
    maxConcurrentTotal: s.maxConcurrentSessionsTotal||0,
    idleTimeoutSec: s.idleTimeoutSec||0,
    perDayMin: pick("perDayMin"), perWeekMin: pick("perWeekMin"), perMonthMin: pick("perMonthMin"),
  };
  const minsSince = (since) => sessions.filter(x=>x.startedAt>=since).reduce((n,x)=>n+(x.durationSec||0),0)/60;
  const usedDayMin = minsSince(sod()), usedWeekMin = minsSince(sow()), usedMonthMin = minsSince(som());
  const rem = (l,u)=> l>0 ? Math.max(0,l-u) : Infinity;
  const remainingMin = Math.min(rem(limits.perDayMin,usedDayMin), rem(limits.perWeekMin,usedWeekMin), rem(limits.perMonthMin,usedMonthMin));
  const activeCount = live.filter(l=>l.userId===uid).length, activeTotal = live.length;
  const capFinite = Math.min(limits.maxSessionMin>0?limits.maxSessionMin:Infinity, remainingMin);
  const sessionCapMin = Number.isFinite(capFinite) ? Math.floor(capFinite) : 0;
  let ok = true, reason;
  if (remainingMin <= 0) { ok=false; reason="quota"; }
  else if (limits.maxConcurrent>0 && activeCount>=limits.maxConcurrent) { ok=false; reason="per-user concurrent"; }
  else if (limits.maxConcurrentTotal>0 && activeTotal>=limits.maxConcurrentTotal) { ok=false; reason="global concurrent"; }
  return { ok, reason, limits, usedDayMin, remainingMin, sessionCapMin, activeCount, activeTotal };
}
// ---------- helpers ----------
async function setGlobal(patch) { await setDoc(doc(db,"settings","global"), patch, { merge:true }); }
async function setUserLimits(uid, usageLimits, maxSessionMinutes=0) { await setDoc(doc(db,"users",uid), { usageLimits, maxSessionMinutes }, { merge:true }); }
async function seedSession(uid, durationSec) { await addDoc(collection(db,"sessions"), { userId:uid, agentId:"limittest", agentName:"LimitTest", startedAt:Date.now(), endedAt:Date.now(), durationSec, status:"ended", counts:{spoken:0,typed:0,catalogClicks:0,toolCalls:0,errors:0} }); }
async function wipeTrainee(uid) {
  for (const d of (await getDocs(query(collection(db,"sessions"), where("userId","==",uid)))).docs) await deleteDoc(d.ref);
  for (const d of (await getDocs(query(collection(db,"liveSessions"), where("userId","==",uid)))).docs) await deleteDoc(d.ref);
}

// ---------- setup ----------
await asSuper();
let uid;
const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email:TEMAIL, password:TPW, returnSecureToken:false }) });
const sud = await su.json();
if (su.ok) { uid = sud.localId; }
else if ((sud.error?.message||"").startsWith("EMAIL_EXISTS")) { const t = await asTrainee(); uid = t.user.uid; await asSuper(); }
else { console.error("signUp failed:", sud); process.exit(1); }
await setDoc(doc(db,"users",uid), { userid:TUSERID, displayName:"Limit Test", role:"trainee", status:"active", groups:[], createdAt:Date.now(), createdBy:"test", usageLimits:null, maxSessionMinutes:0 }, { merge:true });
await wipeTrainee(uid);
await setGlobal({ maxSessionMinutes:0, maxConcurrentSessionsPerUser:0, maxConcurrentSessionsTotal:0, idleTimeoutSec:180, defaultUsageLimits:{perDayMin:0,perWeekMin:0,perMonthMin:0} });
console.log(`Test trainee uid=${uid}\n`);

// ---------- scenarios ----------
console.log("1) All limits 0 (unlimited) → can run");
await asTrainee(); let e = await evaluateStart(uid);
check("not blocked", e.ok === true);
check("no session cap (0)", e.sessionCapMin === 0, `cap=${e.sessionCapMin}`);

console.log("2) Max session length = 2 min → allowed, capped at 2");
await asSuper(); await setGlobal({ maxSessionMinutes:2 });
await asTrainee(); e = await evaluateStart(uid);
check("allowed", e.ok === true);
check("sessionCap = 2", e.sessionCapMin === 2, `cap=${e.sessionCapMin}`);

console.log("3) Per-user concurrent = 1, one live session → BLOCKED");
await asSuper(); await setGlobal({ maxConcurrentSessionsPerUser:1 });
await asTrainee();
await setDoc(doc(db,"liveSessions","limittest-live"), { userId:uid, agentName:"LimitTest", startedAt:Date.now(), lastSeen:Date.now() });
e = await evaluateStart(uid);
check("blocked by per-user concurrency", e.ok === false && e.reason === "per-user concurrent", `reason=${e.reason}`);
await deleteDoc(doc(db,"liveSessions","limittest-live"));

console.log("4) Global concurrent = 1, another user's live session → BLOCKED (platform)");
await asSuper();
await setGlobal({ maxConcurrentSessionsPerUser:0, maxConcurrentSessionsTotal:1 });
await setDoc(doc(db,"liveSessions","super-live"), { userId: auth.currentUser.uid, agentName:"SuperLive", startedAt:Date.now(), lastSeen:Date.now() });
await asTrainee(); e = await evaluateStart(uid);
check("blocked by global concurrency", e.ok === false && e.reason === "global concurrent", `reason=${e.reason}, total=${e.activeTotal}`);
await asSuper(); await deleteDoc(doc(db,"liveSessions","super-live")); await setGlobal({ maxConcurrentSessionsTotal:0 });

console.log("5) Daily limit = 3 min: under → allowed; consume 4 min → BLOCKED");
await asSuper(); await setUserLimits(uid, { perDayMin:3, perWeekMin:0, perMonthMin:0 }, 0);
await setGlobal({ maxSessionMinutes:0 }); // isolate usage from session cap
await asTrainee(); e = await evaluateStart(uid);
check("allowed under limit", e.ok === true && e.remainingMin === 3, `remaining=${e.remainingMin}`);
await seedSession(uid, 240); // 4 minutes today
e = await evaluateStart(uid);
check("blocked after exceeding daily", e.ok === false && e.reason === "quota", `used=${e.usedDayMin.toFixed(1)}m remaining=${e.remainingMin}`);

console.log("6) Group limit tighter than user → most-restrictive wins");
await asSuper();
await wipeTrainee(uid); // reset usage to 0
const gref = await addDoc(collection(db,"groups"), { name:"LimitTest Group", memberUids:[uid], assignedAgentIds:[], usageLimits:{perDayMin:1,perWeekMin:0,perMonthMin:0}, createdAt:Date.now(), createdBy:"test" });
await asTrainee(); e = await evaluateStart(uid);
check("effective daily = 1 (group < user 3)", e.limits.perDayMin === 1, `effDaily=${e.limits.perDayMin}`);
check("allowed with 1 min remaining", e.ok === true && e.remainingMin === 1, `remaining=${e.remainingMin}`);

// ---------- cleanup ----------
await asSuper();
await deleteDoc(gref);
await wipeTrainee(uid);
await setUserLimits(uid, null, 0);
await deleteDoc(doc(db,"users",uid)); // remove test trainee profile (auth account left orphaned & unusable)
await setGlobal({ maxSessionMinutes:30, maxConcurrentSessionsPerUser:1, maxConcurrentSessionsTotal:0, idleTimeoutSec:180, defaultUsageLimits:{perDayMin:0,perWeekMin:0,perMonthMin:0} });
console.log(`\ncleaned up + restored production defaults`);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
