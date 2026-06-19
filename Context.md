# Context — Current Development State

> Living status doc. **Update whenever something meaningful changes.** Read first to know exactly where we are.

**Last updated:** 2026-06-15
**Current phase:** ✅ **Phase 6 (Analytics dashboard) DONE & live** (Phases 1–4 + Groups/Assignments also done). Staff **Analytics**: KPIs + trend chart + filterable sessions table + per-session drill-down (transcript + trace timeline) + CSV/JSON export. **Voice runs via local proxy** (`server/start.cmd`). Next: Phase 7 (usage limits) / host the proxy.
**Live app:** **https://astra-voice-training.web.app** — log in: **amrita.mandal / Astra@2026**
**Repo root:** `C:\Users\amrita.mandal\Downloads\astra-voice-training-platform` (prototype reference: `..\xAI Voice API`)

---

## 🔁 Architecture (pivoted to keep it simple + free — Spark plan)
We **dropped Cloud Functions** (they require Blaze) and the emulators (require Java). Internal app → pragmatic setup:
- **Firebase Spark (free):** **Auth** (Email/Password) + **Firestore** (all data incl. sessions/traces/usage) + **Hosting** (SPA). We develop/test against the **live** project (no emulators → no JDK).
- **Auth:** userid + password, where the **userid maps to a hidden internal email** `\<userid>@astra-voice-training.local` (users never see/type it). **Roles live in `users/{uid}.role`** and are enforced by **Firestore Security Rules** (no custom claims, no `credentials` collection — Firebase Auth stores passwords).
- **Client talks straight to Firestore** for all CRUD (rules-enforced). Trainees write their **own** sessions/trace events directly.
- **The only server we'll need** is a **tiny Node xAI proxy** (reuse the prototype `server.js`) — purely to keep the xAI key off the browser (mint ephemeral tokens + `/search`). **Deferred to Phase 3** (voice runtime). Not needed for Phases 1–2.
- **No Blaze, no Cloud Functions, no JDK, no service-account key.**

> The old `functions/` folder (Cloud-Functions auth code) is **parked/superseded** — not deployed, not referenced by `firebase.json`. May be repurposed later for the Phase-3 Node proxy or deleted.

---

## ✅ What's live / done
- **Phase 0:** monorepo (`apps/web` React+Vite+TS+Tailwind, `packages/shared` types, `functions/` parked), Firebase config. Builds green.
- **Phase 1 (auth) — LIVE on Spark:**
  - Web auth: `AuthProvider` (`signInWithEmailAndPassword` via hidden email → reads `users` doc for role/status/mustChangePassword; blocks disabled), route guards (`RequireAuth`/`PublicOnly` + forced change-password), `AppShell`, **Login**, **ChangePassword**, role-based **Home**.
  - **Firestore rules (final)** deployed: role-from-doc model; users read-own/staff, agents read-assigned/write-super, sessions/traces owner-write, catalog staff-write, settings super, audit staff-create.
  - **Email/Password provider enabled** (`firebase deploy --only auth`).
  - **Superadmin seeded** (uid `8jvqLsjefgQ0DJLX4ZFjucOinyx1`) via `scripts/seed-superadmin.mjs` (client SDK, under a temp bootstrap rule that was then removed).
  - **Hosting + rules deployed.** ✅ **Verified e2e:** wrong password rejected; correct login → profile read under final rules → `role=superadmin`. (`scripts/verify-login.mjs`)

- **Phase 1.5 — Admin Users (live):** `routes/admin/Users.tsx` + `lib/userAdmin.ts` (create via Auth REST signUp + `users` doc; list; Disable/Enable; role-gated). Role-based nav in `AppShell`. Verified `scripts/smoke-user.mjs`.
- **Phase 2 — Voice Agent management (LIVE):** `lib/agents.ts` (CRUD), `routes/admin/Agents.tsx` (list/delete), `routes/admin/AgentEditor.tsx` (full config: name/desc/status, model, **system prompt**, **voices** default+allowed, **knowledge base** collectionIds+retrieval, **web-search** toggle, **custom tools** JSON-schema + HTTP binding). Superadmin-only routes/nav. **Seeded a real agent** "Everest Debt Collection Process Trainer" (prompt from prototype Instruction.md, KB → collection_58eb8df0…) — verified create+list under live rules (`scripts/seed-agent.mjs`).

- **Groups + assignments (LIVE):** `lib/groups.ts` + `routes/admin/Groups.tsx` (create/edit/delete groups; pick members; assign agents to a group). `Users.tsx` has a per-user **Assign agents** modal (`setUserAgents`). Rules updated: agents read = staff or **published** (UI filters to assigned); groups read = staff or **member**. Trainee effective agents (Phase 3) = `user.assignedAgentIds` ∪ (assignedAgentIds of groups where they're a member). Verified `scripts/smoke-groups.mjs`.

- **Phase 3 — Trainee voice runtime (BUILT):**
  - **`server/`** — standalone **xAI proxy** (the only backend): `/session` (mint ephemeral token), `/search` (per-agent collections, **de-duped**), `/tool` (custom-tool HTTP). Verifies **Firebase ID tokens with no service account** (`verifyIdToken` + projectId). Holds `XAI_API_KEY`. Runs on `:8787`. **Verified** `scripts/verify-proxy.mjs` (401 w/o token; token mint; 5 unique chunks).
  - Web: `runtime/VoiceClient.ts` (ported from prototype — mic↔voice, text→voice, voice picker, KB + web_search + custom tools via proxy), `lib/myAgents.ts` (resolve direct+group assignments), `lib/sessions.ts` (session + trace writes), `routes/trainee/MyAgents.tsx` + `Train.tsx`, routes/nav ("Train"). `pcm-worklet.js` in `apps/web/public`.
  - **Sessions + traces written to Firestore** (owner-create; staff-delete) — **verified** `scripts/smoke-session.mjs`. This feeds the Phase-6 dashboard.
  - ⚠️ **Not yet verifiable here:** the actual in-browser mic conversation (needs mic). Protocol-level behavior was proven in the prototype; the proxy + data paths are verified. **To try voice:** run `server/` (`npm start`, key already in `server/.env`) + `apps/web` (`npm run dev`) → open http://localhost:5173 → Train → Everest → Start. (`VITE_API_BASE=http://localhost:8787`.)

- **Phase 4 — Guided Questions (LIVE):** `lib/guidedQuestions.ts` (Sections→Subsections→Questions per agent + `resolveVisibleGuide`), `routes/admin/GuidedQuestions.tsx` (admin editor: agent picker, section CRUD + reorder, **per-section visibility** All/Restricted→pick trainees+groups, subsections, questions CRUD/reorder/enable). Trainee `Train.tsx` shows a **left sidebar** of their visible sections/questions; clicking **injects into the live session** (`VoiceClient.sendText`, auto-starts if idle) and logs a `catalog_click`. Rules: sections/subsections/questions read=signedIn, write=staff (visibility enforced in-app, like agents). Verified `scripts/smoke-guided.mjs` (CRUD + visibility filter). **Seeded** a starter catalog for Everest (Call Handling / Compliance / Objections & Rebuttals — 10 questions) via `scripts/seed-guided.mjs`.
  - 🐞 **Fix (2026-06-15):** the `subsections` collection had **no Firestore rule** → default-deny made the combined guide load (sections+subsections+questions) fail with *"Missing or insufficient permissions"* in BOTH the admin editor and the trainee sidebar (which looked like "can't create sections / guided questions don't display"). Added `match /subsections/{id}` (read=signedIn, write=staff), deployed, verified (`scripts/verify-guide-load.mjs`). Also cleaned 3 junk sections created during the failed attempts (`scripts/cleanup-guided.mjs`).

- **Phase 6 — Analytics dashboard (LIVE):** `lib/analytics.ts` (`listSessions`/`getSession`/`getSessionEvents` + format/bucket/CSV helpers — staff read all under rules, aggregation client-side), `routes/admin/Dashboard.tsx` (9 KPIs: sessions, active trainees, training time, avg session, spoken, typed, tool calls, guided clicks, errors · **filters**: date range 7/30/90/all + agent + trainee + status + search + errors-only · **per-day trend bars** sessions|minutes · **sortable sessions table** by date/duration · **CSV + JSON export** of the filtered set), `routes/admin/SessionDetail.tsx` (`/dashboard/:id`: metadata + count chips + **transcript & trace timeline** — chat bubbles for spoken/typed/guided turns, centered meta-rows for tool calls/errors, relative timestamps · **export transcript .txt / JSON**). Nav "Analytics" (staff). **Verified** `scripts/verify-analytics.mjs` (30 live sessions readable + events subcollection readable). No new rules/indexes needed (single-field `startedAt`/`ts` orderings).
  - 🔬 **Trace enrichment + transcript fixes (2026-06-15):**
    - **VoiceClient:** `ToolUse` now carries `args`, `results` (KB chunks: content≤2000c + score + fileId, ≤12), `resultPreview` (custom-tool response ≤4000c), `latencyMs`, `httpStatus`, `error`. `_handleToolCall` populates them; **web_search** (xAI server-side tool) captured best-effort from `response.output_item.added/.done` (query + preview; shapes read defensively). `safePreview()` caps/guards.
    - **Transcript truncation fixed:** (1) **server_vad** widened (`silence_duration_ms: 800`, `prefix_padding_ms: 300`, `threshold: 0.5`) so a mid-sentence pause no longer commits the turn early & fragments the trainee's question; (2) on barge-in (`speech_started`) the **in-flight Coach segment is finalized** before clearing (interrupted speech is no longer dropped); (3) finalize **keeps the longer** of accumulated-vs-final text so a short final `transcript` can't shrink a message (Train.tsx `upsert`). Empty barge-in finals are skipped.
    - **Train.tsx `onToolUse`** logs the full `tool_call` payload (all `?? null`, no `undefined` → Firestore-safe); web_search shows its own spinner label.
    - **SessionDetail:** tool-call rows are **expandable** (▸/▾ + "Expand all tool calls") → query, arguments (JSON), **retrieved chunks** (#, score, fileId, full content), result preview, HTTP status, latency, errors.
    - **Verified:** `scripts/verify-trace-write.mjs` (nested args + array-of-maps chunks write/read OK under live rules).
    - ⚠️ **Applies to NEW sessions only** — the 30 existing sessions were logged before this and never stored chunks/args; their transcripts/old tool rows stay as captured.

### Key prototype findings
- ~~xAI built-in `file_search` is broken~~ **CORRECTED (2026-06-17):** `file_search` **works** in realtime — the old error was a wrong tool shape. Correct shape: `{ type:"file_search", vector_store_ids:[ids], max_num_results }`. We now support **both** retrieval modes per agent (`knowledgeBase.provider`: `"custom"` = our `search_knowledge_base` fn; `"xai_file_search"` = server-side). See the dedicated section below + `CLAUDE.md`.
- Custom `search_knowledge_base` → `POST /v1/documents/search`; de-dup hybrid duplicates; chunks small (multi-query helps).

### 🚦 Phase 7.1 — Global concurrency + error logging (2026-06-18, LIVE)
- **Platform-wide concurrency** (all users combined): new `maxConcurrentSessionsTotal` setting. Counting needs cross-user visibility (trainees can't read others' `sessions`), so added a **`liveSessions` heartbeat collection** (`lib/liveSessions.ts`): each live session writes a doc {userId, agentId, agentName, startedAt, lastSeen}, heartbeats every 20s, deletes on end. Rules: read=signedIn (any client counts global), create/update own, delete own/staff. **Stale docs (no heartbeat >50s) are excluded from counts** (crash-safe). `evaluateStart` now counts concurrency from `liveSessions` (per-user `activeCount` + platform `activeTotal`) and blocks on either cap. Train arms/clears the heartbeat in start/finalize.
- **Error logging:** `errorLogs` collection (rules: create=signedIn, read=staff, update/delete=super). `lib/errorLog.ts` (`logError` + `classifyError` → rate_limit/network/auth/error). Train logs from `onError` (voice/session) and tool/search failures with full context (user, agent, session). **Viewer:** `routes/admin/ErrorLogs.tsx` → nav "Error Logs" (staff), `/errors`; code-filter chips, links to the session in Analytics.
- Verified `scripts/verify-concurrency-errors.mjs` (errorLogs create/read, liveSessions read + stale filtering + global/per-user count + cleanup).

### 🚦 Phase 7 — Settings & usage limits (2026-06-18, LIVE)
Client-side enforcement (Spark: no cron). **0 = unlimited/off everywhere.**
- **Global settings** (`settings/global`, superadmin): `maxSessionMinutes`, `maxConcurrentSessionsPerUser`, `idleTimeoutSec`, `defaultUsageLimits{perDay/Week/MonthMin}`. Page: `routes/admin/Settings.tsx` → nav "Settings & Limits" (super). Rules: `settings` read=signedIn (trainees read to self-enforce), write=super.
- **Per-user limits** (admin): Users → "Limits" modal (`setUserLimits`) — usageLimits + `maxSessionMinutes` override. **Per-group limits** (admin): Groups editor → per-day/week/month fields.
- **Resolution** (`lib/limits.ts` `resolveEffectiveLimits` + `evaluateStart`): **most-restrictive wins** across global default / user / member-groups; usage = sum of own sessions' durationSec in current day/week/month (calendar).
- **Enforcement in `Train.tsx`:** on start → `evaluateStart` blocks if quota exhausted or concurrent ≥ max (stale actives ignored). During session → **session cap** = min(maxSession, remaining quota) auto-ends (`endReason:"limit"`, ~60s warning); **idle timeout** auto-ends (`endReason:"timeout"`, reset on any transcript/tool). Header shows "up to X min · Y min left today"; banners for warn/ended.
- `lib/settings.ts` (DEFAULT_SETTINGS, get/save). Verified `scripts/verify-limits.mjs` (settings write/read, self queries, math + blocking). **Production defaults set:** maxSession 30m, concurrent 1, idle 180s, usage unlimited.
- ⚠️ Enforcement is client-side (honest/visible, per the internal-app security posture). Hardening (proxy-side quota check) is a future option.

### ✨ Polish round (2026-06-18) — guided interrupt, analytics multi-filter + report
- **Guided/typed input now interrupts the agent.** `VoiceClient.sendText` calls a new `interrupt()` → `response.cancel` (gated by an `_activeResponses` counter so it never throws "no active response") + clear playback + suppress old audio. So clicking a guided question (or typing) mid-answer replaces the current response instead of queuing. Voice barge-in unchanged (server auto-interrupt).
- **Removed `language_hint: "en"`** from session.update (per user).
- **Analytics (`Dashboard.tsx`) — combinable filters + report:**
  - **Custom date range** (from/to date inputs) alongside 7d/30d/90d/all; all filters AND together.
  - **Multi-select agents** (toggle chips; none = all) — "a group of agents".
  - **Guided‑question & transcript report:** "Build report" fetches each filtered session's events (`getSessionEvents`) and shows a table of guided questions used — **clicks + distinct trainees** — plus summary (total clicks, distinct questions, total time). Exports: **Guided CSV**, **Transcripts .txt** (all filtered sessions, readable), **Transcripts JSON** (session+events). Report auto-clears when filters change.
  - Existing per-session export + filtered sessions CSV/JSON unchanged.

### 🎙️ Voice runtime fixes round 2 (2026-06-17, from user's real event log)
Analyzed the cookbook's actual realtime event log. Root causes + fixes:
- **Duplicate trainee turns** — the SAME `item_id` is committed **twice** (server VAD re-commits on a pause; the transcript GROWS), and `response.created` fires twice (first response superseded). My finalize-on-`response.created` logged the partial AND the full → two turns. **Fix:** finalize the user turn on the agent's **first `output_audio_transcript.delta`** (real speech), not `response.created`; `_setUserItem` **replaces** by `item_id`. Validated against the exact recorded sequence → **1 clean turn** (`scripts/sim-consolidate.mjs` PASS).
- **"Cancellation failed: no active response found"** error — caused by our `response.cancel`. **Removed it** (the reference never sends it; the server auto-interrupts on server_vad). Natural interruption only — **no interrupt button**.
- **Interrupted audio kept playing** — now on `speech_started` we clear playback **and set `_suppressAudio`** to drop any further audio from the interrupted response until the next `response.created`.
- **Language misfire ("Hallå/Hej")** — added `audio.input.transcription.language_hint: "en"`.
- ⚠️ Still needs a real mic test; if barge-in is still flaky it's environmental (speaker echo) → headphones.

### 🎙️ Runtime aligned with xAI cookbook reference (2026-06-17) — barge-in + transcripts
After studying the cookbook **web client** (`..\xai-cookbook\voice-examples\agent\web\client\src`: `App.tsx`, `hooks/useWebSocket.ts`, `hooks/useAudioStream.ts`), `VoiceClient.ts` was aligned to the proven reference:
- **Handshake** → OpenAI-compatible subprotocol `["realtime","openai-insecure-api-key.<token>","openai-beta.realtime-v1"]` (was `xai-client-secret.<token>`). Verified (text) that `?model=` + `file_search` still work (`scripts/sim-filesearch.mjs`). **Likely root cause of barge-in failing** — server auto-interrupt behaves correctly on this handshake.
- **`turn_detection`** → bare `{ type: "server_vad" }` (removed my threshold/silence overrides; reference default handles barge-in).
- **Playback** → **queue, one chunk at a time** (`_playNext`); `_clearPlayback` drops the queue + stops the current chunk → true barge-in (fixes "audio queued: old answer plays fully, new answer waits"). (Was: all chunks scheduled ahead on a playHead.)
- **User transcript** → consolidate ALL user items since the last response into ONE turn (`_setUserItem`/`_finalizeUserTurn`, fed by `conversation.item.added` input_audio transcript **and** `input_audio_transcription.*`, finalized on `response.created`). Fixes fragmented trainee turns ("Okay, uh.").
- Kept: file_search/custom-tool handling, server-tool record-only + chunk replay, **assistant authoritative transcript from `response.done`**, `response.cancel` on barge-in.
- ⚠️ **Mic behavior can't be tested headless** — needs a real session. Tradeoff: queue playback may be marginally less gapless but is robustly interruptible (the reference's choice).

### 🔎 Retrieval: custom tool vs xAI server-side file_search (2026-06-17)
- **Studied** the xAI cookbook (`..\xai-cookbook\voice-examples\agent\web\xai\backend-nodejs` — `src/index.ts`, `test-collection-search.mjs`, `replay-conversation.mjs`, `logs/`) + the [voice-agent docs](https://docs.x.ai/developers/model-capabilities/audio/voice-agent).
- **How server-side file_search behaves in realtime:** register `{type:"file_search", vector_store_ids, max_num_results}`. The model searches **during generation**; emits a trailing **`collections_search`** `function_call` item (no `function_call_output`, no `collections://` citations). `arguments` = `{"search_request":"{\"query\":\"…\",\"limit\":10}"}` (**double-stringified**). One grounded answer per turn (vs the custom path, which can fire 3 parallel searches → our old `response.create`-per-tool produced 3–4 chatty segments).
- **Verified on OUR handshake** (`xai-client-secret.<token>` + `?model=grok-voice-think-fast-1.0`) via `scripts/sim-filesearch.mjs`: drove the Everest roleplay over text → `collections_search` fired each turn, grounded answers, **zero errors**.
- **Implemented:** per-agent `knowledgeBase.provider` (AgentEditor selector). `VoiceClient`: registers file_search when `xai_file_search`; **guards `_handleToolCall` to execute only client tools** (server tools never executed → fixes the runaway extra `response.create`); detects `collections_search` on `output_item.added/.done`, records it **read-only**, and **replays the query against proxy `/search`** to capture chunks for the trace.

---

## 🔒 Decisions (current)
1. **Auth:** Firebase **Email/Password with hidden internal email**; **roles in Firestore + rules** (no custom claims). *(Supersedes the earlier custom-token plan — chosen for Spark simplicity.)*
2. **KB:** existing `collection_id`s only.
3. **Admin scope:** **flat** — admins manage ALL trainees/groups/Guided Questions/assignments/analytics; not agents/settings/limits/other admins.
4. **Feature name:** **Guided Questions** (Learning Tracks → Sections → Questions).
5. **Stack:** React+Vite+TS+Tailwind + **Firebase Spark** (Auth/Firestore/Hosting). Tiny Node xAI proxy in Phase 3.

---

## 🔥 Firebase status
- Project **`astra-voice-training`** (#79475919948), **Spark (no billing)**. Auth user: astraglobal247@gmail.com.
- Web app `AVTP Web` registered; config in `apps/web/.env.local`.
- **Email/Password enabled.** Firestore rules + indexes deployed. Hosting deployed.

---

## ⏭️ Roadmap / next steps
1. ✅ **Admin Users UI — DONE & live.** `apps/web/src/routes/admin/Users.tsx` + `lib/userAdmin.ts`: create trainee/admin/superadmin (role-gated; admin→trainee only) via Identity Toolkit `accounts:signUp` (web API key, no SA) → writes `users/{uid}` doc; list + Disable/Enable (status flag). App shell now has role-based nav (Home / Users). **Verified end-to-end** via `scripts/smoke-user.mjs`. *(Hard-delete of an auth account + admin password-reset need the optional tiny server — deferred.)*
2. ✅ **Phase 2: Voice Agent management — DONE & live.**
3. ✅ **Phase 3: trainee voice runtime — BUILT** (see above).
4. ✅ **Groups + assignments — DONE & live.**
5. **CI/CD set up (2026-06-18)** — see **`DEPLOY.md`**. `git push` to `main` →
   (a) GitHub Actions (`.github/workflows/deploy.yml`) builds + deploys **web + firestore rules** to Firebase (auth via repo secret `FIREBASE_TOKEN` from `firebase login:ci`, OR `FIREBASE_SERVICE_ACCOUNT`); (b) **Railway** (`server/railway.json`, Root Directory `server`) auto-deploys the **proxy** (set `XAI_API_KEY` + `GCLOUD_PROJECT` in Railway vars). Proxy start is portable (`--env-file-if-exists`). Public Firebase web config is committed in `apps/web/.env.production` so CI can build; set `VITE_API_BASE` there to the Railway proxy URL once hosted. GitHub repo: `Amrita143/Voice-Training-Platform`. CI build verified locally. **Proxy LIVE on Railway:** `https://avtp-xai-proxy-production.up.railway.app` (verified `/health`=200, `/session`=401 without token). `VITE_API_BASE` set to it in `.env.production`. **Remaining TODO by user:** ensure `FIREBASE_TOKEN` secret is added, then `git push` to trigger the web deploy pointing at the Railway proxy. Note: deploy via `git push` (CI has no `.env.local`); a *local* `npm run deploy` would bake `.env.local`'s `localhost` proxy instead.
6. ✅ **Phase 4 — Guided Questions — DONE & live.**
7. ✅ **Phase 6 — Analytics dashboard — DONE & live.** Staff "Analytics": KPIs + per-day trend + filterable/sortable sessions table + per-session drill-down (full transcript + trace timeline) + CSV/JSON/transcript export. (`Dashboard.tsx`, `SessionDetail.tsx`, `lib/analytics.ts`; verified `scripts/verify-analytics.mjs`.)
8. ✅ **Phase 7 — Settings & usage limits — DONE & live.** Global settings (super) + per-user/group overrides; most-restrictive-wins; in-app enforcement (start gate + session cap + idle timeout). See the Phase 7 section above.
9. **Firestore rules tests** — live client-SDK checks (emulator needs JDK).

## ⚙️ Environment gotchas (important)
- **Voice needs the xAI proxy RUNNING.** If `server/` isn't up on `:8787`, every "Start" fails (Connecting → Idle). The Train page now shows a red error in that case. **Run the proxy in the user's OWN terminal** (`server/start.cmd`, or `node --env-file=.env index.mjs`) so it persists — a proxy started inside Claude's background tasks gets killed between turns. (Symptom we hit: voice worked, then proxy died, then all Starts failed for every role.)
- **npm broken via global `nvm4w`** → use standalone **Node 22** (`...\node-v22.16.0-win-x64\...`) for npm/node.
- **No Java** → can't run Firebase emulators here; we develop against **live** Spark instead.
- **Firebase MCP `firebase_deploy` fails on hosting** ("not in a project directory") → **deploy via CLI**: `& "<node22>\npx.cmd" -y firebase-tools@latest deploy --only firestore,hosting --project astra-voice-training`.

## 🗺️ File map (platform)
- `apps/web/src`: `firebase.ts`, `auth/AuthContext.tsx`, `lib/userid.ts`, `lib/errors.ts`, `routes/{Login,ChangePassword,Home}.tsx`, `components/AppShell.tsx`, `App.tsx`
  - Analytics: `lib/analytics.ts`, `routes/admin/Dashboard.tsx`, `routes/admin/SessionDetail.tsx`
- `packages/shared/src/index.ts` (types)
- `firestore.rules` (final, deployed), `firestore.indexes.json`, `firebase.json`, `.firebaserc`
- `scripts/seed-superadmin.mjs`, `scripts/verify-login.mjs`
- `functions/` — **parked** (old Cloud-Functions auth code, not used)
- Docs: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, `CLAUDE.md`, this file
