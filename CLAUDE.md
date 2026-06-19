# CLAUDE.md — Astra Voice Training Platform (AVTP)

> **Read [Context.md](./Context.md) FIRST, every session.** It is the single source of truth for *where development currently stands* — what's done, what's in progress, what's next. **Keep it updated** after any meaningful progress (finished a phase/task, made a decision, hit a blocker). Anyone (human or agent) should be able to read Context.md and know exactly where we are.

## What this project is
This folder (`astra-voice-training-platform`) is **the platform** — a full multi‑agent, role‑based voice‑training app on **Firebase** (monorepo: `apps/web`, `functions`, `packages/shared`).

- **Reference prototype** lives in the sibling folder **`..\xAI Voice API\`**: a working single‑agent xAI Voice Agent app — `server.js`, `voice-client.js`, `index.html`, `pcm-worklet.js`, `Instruction.md`. We **port from it** (ephemeral‑token minting, `/search` proxy, `VoiceClient`). Don't edit the prototype unless asked.
- **The platform we're building** — specs live in **`docs/`**:
   - [docs/PRD.md](./docs/PRD.md) — product requirements
   - [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — system design, data model, security
   - [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) — phased build plan

## Hard constraints & conventions (do not violate)
- **KB retrieval (TWO supported modes, per-agent `knowledgeBase.provider`):**
  - **`"custom"`** — our **`search_knowledge_base`** function tool → backend `POST /v1/documents/search`; client-executed, full chunk capture, **de-dup** by `chunk_id` (hybrid returns each chunk twice). Can fire multiple search turns.
  - **`"xai_file_search"`** — xAI's **server-side** retrieval. Register `{ type: "file_search", vector_store_ids: [collectionIds], max_num_results }` in `session.update`. xAI searches **during generation** and surfaces a trailing **`collections_search`** `function_call` item (its `arguments.search_request` is **double-stringified** JSON) — **no `function_call_output`, no `collections://` citations**. **Never execute it client-side** (don't send `function_call_output`/`response.create` for server tools, or you spawn a runaway extra response). We replay the query against the proxy `/search` only to log chunks for the trace.
  - ⚠️ **CORRECTION:** `file_search` is **NOT broken** — the old failure (*"invalid type: map, expected a string"*) was a wrong tool shape. The correct realtime shape is `vector_store_ids: [string]` (OpenAI-compatible). Verified working on our exact handshake via `scripts/sim-filesearch.mjs`. Reference: `..\xai-cookbook\voice-examples\agent\web\xai\backend-nodejs`.
- **Plan = Firebase SPARK (free).** **No Cloud Functions, no Blaze, no emulators/JDK.** Develop/test against the **live** project. The only server is a **tiny Node xAI proxy** (Phase 3, reuse prototype `server.js`) to keep the xAI key off the browser (ephemeral token + `/search`). `functions/` is **parked/unused**.
- **Secrets:** the `XAI_API_KEY` is **server‑side only** (the Node proxy, Phase 3). The browser only ever gets a short‑lived **ephemeral token**.
- **Auth:** Firebase **Email/Password**, where the **userid maps to a hidden internal email** `\<userid>@astra-voice-training.local` (users never see/type it). **Roles live in `users/{uid}.role`** and are enforced by **Firestore Security Rules** (NO custom claims, NO `credentials` collection — Firebase Auth holds passwords). Client talks straight to Firestore (rules-enforced); trainees write their own session/trace docs.
- **Roles:** `superadmin` (everything), `admin` (**flat scope — manages ALL trainees + groups + Guided Questions + assignments + all analytics**, but NOT agents/settings/limits/other admins), `trainee` (assigned agents + assigned Guided Questions only).
- **Guided Questions** = the curated clickable‑question feature: **Learning Tracks → Sections → Questions**.
- **Voices:** eve, ara, rex, sal, leo (per‑agent allowed subset).
- **Privacy:** store transcripts + traces, **never audio**.
- **Usage limits:** enforced **server‑side** (per user / process / group × day/week/month), most‑restrictive‑wins.
- **Stack:** React + Vite + TypeScript + Tailwind (SPA) · **Firebase Spark**: Auth + Firestore + Hosting (+ a tiny Node xAI proxy in Phase 3).
- **Deploy:** the Firebase **MCP `firebase_deploy` fails on hosting** here → deploy via **CLI**: `& "<node22>\npx.cmd" -y firebase-tools@latest deploy --only firestore,hosting --project astra-voice-training`.

## Environment notes
- **Node (user's):** `C:\Users\amrita.mandal\Downloads\node-v22.16.0-win-x64\node-v22.16.0-win-x64` (has `npx.cmd`).
- **Firebase MCP:** added at **user scope**; tools are `mcp__firebase__*`. Authenticated as **astraglobal247@gmail.com**.
- **Shell:** Windows PowerShell (use PowerShell syntax). The prototype server runs with `npm start` (loads `.env` via `node --env-file=.env`).
- **npm is broken via the global `nvm4w` shim** (errors on another user's AppData) — always use the standalone Node 22 above (prepend to PATH, call its `npm.cmd`/`node.exe`).
- **No Java/JVM installed** → the Firebase Auth + Firestore **emulators can't run here** until a JDK 11+ is installed. Until then, verify auth via build/typecheck; live login e2e needs local JDK **or** a Blaze deploy.
- Firebase CLI runs via the node path above: `"...\npx.cmd" -y firebase-tools@latest <cmd>`.
- **Run the voice feature locally:** start the xAI proxy → `cd server` then `npm start` (key in `server/.env`, runs on `:8787`); start the web → `cd apps/web` then `npm run dev` (`:5173`, `VITE_API_BASE=http://localhost:8787`). Open http://localhost:5173 → Train. The deployed site needs the proxy **hosted** (set `VITE_API_BASE` in `.env.production`).

## Working agreements
- Don't expose secrets to the client. Don't trust the client for authz/usage — enforce in Functions + Firestore rules.
- Before outward/cloud actions (create Firebase project, deploy), confirm with the user.
- After finishing a task or phase, **update Context.md** (status, date, next steps).
