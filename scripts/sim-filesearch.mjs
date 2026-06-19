/**
 * Verifies xAI server-side file_search (collections_search) works on OUR realtime
 * handshake (subprotocol `xai-client-secret.<token>` + ?model=) using the REAL
 * Everest agent config from Firestore. Drives the user's roleplay over TEXT and
 * logs the event stream — proving whether file_search fires and how it surfaces.
 *
 * Run:  node --env-file=server/.env scripts/sim-filesearch.mjs
 * (server/.env provides XAI_API_KEY.)
 */
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const XAI_API_KEY = process.env.XAI_API_KEY;
if (!XAI_API_KEY) { console.error("❌ XAI_API_KEY missing (run with --env-file=server/.env)"); process.exit(1); }
const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";

const cfg = { apiKey:"AIzaSyANr0bu6QuzNPNkn74H12pUPzcbaYSIpPU", authDomain:"astra-voice-training.firebaseapp.com", projectId:"astra-voice-training", appId:"1:79475919948:web:e9e34c8b48d4ba4256f8e9" };
const app = initializeApp(cfg); const auth = getAuth(app); const db = getFirestore(app);
await signInWithEmailAndPassword(auth, "amrita.mandal@astra-voice-training.local", "Astra@2026");
const agents = (await getDocs(collection(db, "agents"))).docs.map((d) => ({ id: d.id, ...d.data() }));
const a = agents.find((x) => /everest/i.test(x.name)) || agents[0];
const MODEL = a.model;
const COLLECTIONS = a.knowledgeBase?.collectionIds || [];
console.log(`Agent: "${a.name}"  model=${MODEL}  collections=${JSON.stringify(COLLECTIONS)}`);
if (!COLLECTIONS.length) { console.error("❌ agent has no collectionIds"); process.exit(1); }

const TURNS = [
  "Hello?",
  "can you please provide me all the answers of credit reporting related objections?",
  "can you please describe the payment authorization script?",
  "how to handle objections like send me a letter, then I'll get back to you?",
];

const ts = () => new Date().toISOString().substring(11, 23);
const log = (...m) => console.log(`[${ts()}]`, ...m);

// mint ephemeral token (same as our proxy /session)
const tr = await fetch(CLIENT_SECRETS_URL, { method: "POST", headers: { Authorization: `Bearer ${XAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ expires_after: { seconds: 600 } }) });
if (!tr.ok) { console.error("❌ token mint failed", tr.status, await tr.text()); process.exit(1); }
const tok = await tr.json();
const token = tok.value || tok.client_secret?.value || tok.secret || tok;

const url = `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(MODEL)}`;
// OpenAI-compatible handshake (matches xAI cookbook reference)
const ws = new WebSocket(url, ["realtime", `openai-insecure-api-key.${token}`, "openai-beta.realtime-v1"]);

const parseSearch = (argStr) => { try { const o = JSON.parse(argStr || "{}"); const r = typeof o.search_request === "string" ? JSON.parse(o.search_request) : o.search_request; return r || o; } catch { return {}; } };

let qi = -1, answer = "", searches = [], errored = false, configured = false, ready = false;
const send = (o) => { ws.send(JSON.stringify(o)); log("→", o.type); };
const askNext = () => {
  qi++;
  if (qi >= TURNS.length) { log("🏁 done"); ws.close(); return; }
  answer = ""; searches = [];
  console.log("\n" + "█".repeat(70)); log(`TURN ${qi + 1} USER: ${TURNS[qi]}`); console.log("█".repeat(70));
  send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: TURNS[qi] }] } });
  send({ type: "response.create" });
};

ws.onopen = () => log(`✅ WS open (subprotocol=${ws.protocol || "n/a"})`);
ws.onmessage = (ev) => {
  let m; try { m = JSON.parse(ev.data); } catch { return; }
  const t = m.type;
  if (t === "response.output_audio_transcript.delta" || t === "response.output_text.delta") { answer += m.delta || ""; return; }
  if (t === "response.output_audio.delta") return;
  if (t === "ping") return;

  if (t === "error") { errored = true; log("❌ ERROR:", JSON.stringify(m.error || m)); }
  else if ((t === "response.output_item.done" || t === "response.function_call_arguments.done") && (m.item?.type === "function_call" || m.name)) {
    const name = m.item?.name || m.name;
    const args = m.item?.arguments ?? m.arguments;
    if (name === "collections_search" || name === "file_search") {
      const q = parseSearch(args).query;
      if (t === "response.output_item.done") { searches.push(q); log(`🔎 collections_search query=${JSON.stringify(q)}`); }
    }
  } else log("←", t);

  if ((t === "session.created" || t === "conversation.created") && !configured) {
    configured = true;
    send({ type: "session.update", session: {
      instructions: a.systemPrompt,
      voice: a.voices?.default || "rex",
      turn_detection: null,
      audio: { input: { format: { type: "audio/pcm", rate: 24000 }, transcription: { model: "grok-transcribe" } }, output: { format: { type: "audio/pcm", rate: 24000 } } },
      tools: [{ type: "file_search", vector_store_ids: COLLECTIONS, max_num_results: 10 }],
    } });
  }
  if (t === "session.updated" && !ready) { ready = true; log(`⚙️ session.updated — file_search attached to ${COLLECTIONS.join(",")}`); askNext(); }
  if (t === "response.done") {
    log(`💬 ANSWER (${answer.length} chars): ${answer.slice(0, 220)}${answer.length > 220 ? "…" : ""}`);
    log(`   searches this turn: ${searches.length ? searches.map((s) => JSON.stringify(s)).join(", ") : "none"}`);
    setTimeout(askNext, 300);
  }
};
ws.onerror = (e) => log("❌ WS error:", e?.message || String(e));
ws.onclose = (e) => { log(`🔌 closed code=${e.code} reason=${e.reason || "n/a"}`); console.log(`\nRESULT: file_search on our handshake → ${errored ? "ERROR (see above)" : "WORKS ✅"}`); process.exit(0); };
setTimeout(() => { log("⏱️ safety timeout"); try { ws.close(); } catch {} }, 180000);
