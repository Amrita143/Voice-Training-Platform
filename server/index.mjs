// AVTP xAI proxy — the only backend. Holds the xAI key; the browser never sees it.
// Endpoints (all require a valid Firebase ID token, verified WITHOUT a service
// account — token verification only needs the project id):
//   GET  /health
//   POST /session  -> mint a realtime ephemeral token
//   POST /search   -> proxy xAI documents/search (per-agent collections), de-duped
//   POST /tool     -> execute a custom tool's HTTP binding
import express from "express";
import cors from "cors";
import admin from "firebase-admin";

const PORT = process.env.PORT || 8787;
const XAI_API_KEY = process.env.XAI_API_KEY;
const PROJECT_ID = process.env.GCLOUD_PROJECT || "astra-voice-training";
const AUTH_DISABLED = process.env.AUTH_DISABLED === "true"; // dev escape hatch only

const CLIENT_SECRETS_URL = "https://api.x.ai/v1/realtime/client_secrets";
const DOCUMENTS_SEARCH_URL = "https://api.x.ai/v1/documents/search";

admin.initializeApp({ projectId: PROJECT_ID });

// Don't let an unexpected error take the whole proxy down.
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://astra-voice-training.web.app",
  "https://astra-voice-training.firebaseapp.com",
];

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: (origin, cb) =>
      !origin || ALLOWED_ORIGINS.includes(origin)
        ? cb(null, true)
        : cb(null, true), // internal app: permissive; tighten if needed
  })
);

// --- Firebase ID-token verification (no service account required) ---------
async function requireAuth(req, res, next) {
  if (AUTH_DISABLED) return next();
  const h = req.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch (e) {
    res.status(401).json({ error: "Invalid token", detail: String(e?.message || e) });
  }
}

app.get("/health", (_req, res) => res.json({ ok: true, service: "avtp-xai-proxy" }));

// Mint a short-lived realtime ephemeral token.
app.post("/session", requireAuth, async (_req, res) => {
  if (!XAI_API_KEY) return res.status(500).json({ error: "XAI_API_KEY not set" });
  try {
    const r = await fetch(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expires_after: { seconds: 600 } }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "token mint failed", detail: await r.text() });
    res.json({ token: await r.json() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Knowledge-base search (per-agent collections), de-duped by chunk_id.
app.post("/search", requireAuth, async (req, res) => {
  if (!XAI_API_KEY) return res.status(500).json({ error: "XAI_API_KEY not set" });
  const query = String(req.body?.query || "").trim();
  const collectionIds = Array.isArray(req.body?.collectionIds) ? req.body.collectionIds : [];
  const retrievalMode = req.body?.retrievalMode || "hybrid";
  const limit = Number(req.body?.limit) || 10;
  if (!query) return res.status(400).json({ error: "Missing 'query'" });
  if (collectionIds.length === 0) return res.status(400).json({ error: "Missing 'collectionIds'" });

  try {
    const r = await fetch(DOCUMENTS_SEARCH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${XAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        source: { collection_ids: collectionIds },
        retrieval_mode: { type: retrievalMode },
        limit,
      }),
    });
    if (!r.ok) return res.status(r.status).json({ error: "documents/search failed", detail: await r.text() });
    const data = await r.json();

    // De-dupe by chunk_id (hybrid returns each chunk twice).
    const seen = new Set();
    const results = [];
    for (const m of data.matches || []) {
      if (seen.has(m.chunk_id)) continue;
      seen.add(m.chunk_id);
      results.push({ content: m.chunk_content, score: m.score, fileId: m.file_id });
    }
    res.json({ query, results });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Execute a custom tool's HTTP binding. (Internal app: minimal; add URL
// allow-listing here for stricter control.)
app.post("/tool", requireAuth, async (req, res) => {
  const { url, method = "POST", headers = {}, body } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing tool 'url'" });
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(10000),
    });
    const text = await r.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    res.json({ status: r.status, body: parsed });
  } catch (err) {
    res.status(502).json({ error: "tool execution failed", detail: String(err) });
  }
});

const server = app.listen(PORT, () => {
  console.log(`AVTP xAI proxy on http://localhost:${PORT} (project ${PROJECT_ID})`);
  if (!XAI_API_KEY) console.warn("WARNING: XAI_API_KEY not set.");
  if (AUTH_DISABLED) console.warn("WARNING: AUTH_DISABLED=true — token verification OFF.");
});
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(
      `\n[!] Port ${PORT} is already in use — the proxy is probably already running in another window.\n` +
        `    Close that window (or change PORT in server/.env), then run this again.\n`
    );
  } else {
    console.error("Server error:", e);
  }
  process.exit(1);
});
