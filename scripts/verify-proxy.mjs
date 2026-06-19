// Verifies the xAI proxy: ID-token auth, /session token mint, /search (deduped).
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const cfg = {
  apiKey: "AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU",
  authDomain: "astra-voice-training.firebaseapp.com",
  projectId: "astra-voice-training",
  appId: "1:79475919948:web:e9e34c8b48d4ba4256f8e9",
};
const app = initializeApp(cfg);
const auth = getAuth(app);
const cred = await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const idToken = await cred.user.getIdToken();
console.log("✓ got Firebase ID token");

const BASE = "http://localhost:8787";

// 1) no token -> 401
let r = await fetch(`${BASE}/session`, { method: "POST" });
console.log(`✓ /session without token -> ${r.status} (expect 401)`);

// 2) /session with token -> ephemeral token
r = await fetch(`${BASE}/session`, {
  method: "POST",
  headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
});
const sess = await r.json();
const tok = sess?.token?.value || sess?.token;
console.log(`✓ /session -> ${r.status}; ephemeral token: ${tok ? String(tok).slice(0, 26) + "…" : JSON.stringify(sess)}`);

// 3) /search with token + Everest collection -> deduped results
r = await fetch(`${BASE}/search`, {
  method: "POST",
  headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: "credit reporting objections",
    collectionIds: ["collection_58eb8df0-2907-4638-9c17-e82815f5aede"],
    retrievalMode: "hybrid",
    limit: 10,
  }),
});
const search = await r.json();
console.log(`✓ /search -> ${r.status}; ${search.results?.length} unique chunks; top score ${search.results?.[0]?.score}`);
console.log("   first chunk:", (search.results?.[0]?.content || "").replace(/\s+/g, " ").slice(0, 90));
process.exit(0);
