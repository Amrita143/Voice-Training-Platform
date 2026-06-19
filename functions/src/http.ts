import { onRequest } from "firebase-functions/v2/https";

export const health = onRequest((_req, res) => {
  res.json({ ok: true, service: "avtp-functions", phase: 1 });
});

// Hosting rewrites /api/** here.
export const api = onRequest((req, res) => {
  if (req.path === "/api/health" || req.path === "/health") {
    res.json({ ok: true });
    return;
  }
  res.status(404).json({ error: "not found", path: req.path });
});
