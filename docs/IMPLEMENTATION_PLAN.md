# Implementation Plan — Astra Voice Training Platform (AVTP)

**Status:** Draft v1.0 · **Related:** [PRD.md](./PRD.md) · [ARCHITECTURE.md](./ARCHITECTURE.md)

This plan is phased and incremental: each phase ends with something runnable and testable. Phases 0–3 deliver a working single‑agent trainee experience on Firebase; 4–7 add catalog, analytics, and governance; 8–9 harden and ship.

**Legend:** 🎯 deliverable · ✅ acceptance · 🔗 depends on · ⏱ rough size (S/M/L).

---

## Phase 0 — Foundations & Project Setup ⏱ M
**Tasks**
1. Create Firebase projects: `avtp-dev`, `avtp-staging`, `avtp-prod` (Auth, Firestore, Functions, Hosting enabled).
2. Monorepo layout:
   ```
   /apps/web        (React+Vite+TS+Tailwind SPA)
   /functions       (Cloud Functions, TS)
   /packages/shared (TS types: Agent, Session, Trace, Catalog, Roles, zod schemas)
   firestore.rules  firestore.indexes.json  firebase.json
   ```
3. Tooling: ESLint/Prettier, Vitest/Jest, Firebase Emulator Suite, GitHub Actions CI (build, test, deploy to dev).
4. Store `XAI_API_KEY` in Secret Manager; wire Functions config.
5. Bootstrap script to create the **first superadmin** (Admin SDK: create Auth user [uid only], `role=superadmin` claim, `users/{uid}` doc, and bcrypt hash in `credentials/{uid}`).

🎯 Empty app deploys to dev; emulators run locally; first superadmin can log in.
✅ CI green; superadmin token shows `role` claim.

---

## Phase 1 — Auth, RBAC & User Management ⏱ L
🔗 Phase 0
**Tasks**
1. **Login UI** (userid + password, **no email**) → **`login` callable** verifies password hash in `credentials/{uid}` (bcrypt) → issues **Firebase Custom Token** w/ role claim → `signInWithCustomToken`. Rate‑limit + lockout; force password change on first login (`changePassword`).
2. **User provisioning**: `userAdmin` callable creates/updates/disables/deletes users — writes `users/{uid}` (+ Auth user, uid only) and the hashed password to `credentials/{uid}`, sets `role` (+ `groups`) custom claim. Only superadmin may create/edit admins/superadmins; **admins manage all trainees and groups (flat scope)**.
3. **Route guards** + role‑aware nav shell (Trainee / Admin / Superadmin areas).
4. **Groups**: CRUD; membership; owner admins.
5. **Firestore Security Rules v1** for `users`, `groups` (+ deny‑by‑default everywhere else).
6. **Audit logging** helper (`auditLogs`).

🎯 Superadmin/admin can provision users & groups; users log in and land in the right area.
✅ A trainee cannot reach admin routes (UI + rules). Creating an admin as an admin is denied server‑side. Rules unit‑tested in emulator.

---

## Phase 2 — Voice Agent Management (Superadmin) ⏱ L
🔗 Phase 1
**Tasks**
1. `agents` data model + zod schema in `/packages/shared`.
2. **Agent editor UI**: name, description, status; **system‑prompt editor** (multiline, version on save → `configHistory`); model + **voices** (default + allowed subset of eve/ara/rex/sal/leo).
3. **KB settings**: collectionIds (multi), retrievalMode, maxNumResults, dedupe, limit.
4. **Custom tools editor**: add tool {name, description, **JSON‑Schema editor** with live validation, binding {url(method/headers/bodyTemplate), timeout}}; enable/disable. URL must be on the superadmin **allow‑list**.
5. **Web search toggle** (and optional X‑search with handles).
6. **Clone / archive / delete**; publish workflow (draft→published).
7. Security rules: `agents` write=superadmin; read=admins + assigned trainees.

🎯 Superadmin creates & publishes "Everest Debt Collection Process Trainer" with prompt + KB + tools + web‑search flag.
✅ Config persists with version history; JSON‑Schema validation blocks bad tool schemas; non‑superadmin cannot mutate agents (rules + function).

---

## Phase 3 — Trainee Runtime (Voice + Text) on the Platform ⏱ L
🔗 Phase 2 · *(ports the current prototype)*
**Tasks**
1. **`mintEphemeralToken` function**: verify assignment + usage (stub until Phase 7) → read agent config → mint xAI ephemeral token → create `sessions/{id}` (active) → return `{token, sessionConfig}` (prompt, voice list, **resolved tools to register**).
2. **`searchKnowledgeBase` function**: `POST /v1/documents/search` with agent KB config; **de‑dup by chunk_id**; return top‑N unique; log retrieval to trace.
3. **`runTool` function**: execute custom tool binding (allow‑listed HTTP, timeout, size cap); log to trace.
4. **Port `VoiceClient.ts`** from `voice-client.js`: mic→PCM16→WS, playback, barge‑in, `sendText`, `setVoice`; register tools from `sessionConfig`; handle `response.function_call_arguments.done` → route to `searchKnowledgeBase`/`runTool` → `function_call_output` + `response.create`; enable `resumption`.
5. **Trainee UI**: connection status, transcript, **voice picker (allowed only)**, **text composer (voice‑always replies)**, **tool‑activity indicator**.
6. **Event capture → `appendTrace`** (batched): user/assistant transcripts, tool calls/results, errors.

🎯 An assigned trainee runs a full voice+text session with working KB retrieval; transcript+trace stored.
✅ Typed message → voice reply; KB question answered grounded (trace shows `search_knowledge_base` + chunks); no API key in browser (only ephemeral token).

---

## Phase 4 — Guided Questions (Guided Questions) ⏱ L
🔗 Phase 3
**Tasks**
1. Data model: `catalogs`, `tracks`, `sections`, `questions` (+ order fields).
2. **Admin catalog manager**: CRUD tracks/sections/questions; **drag‑and‑drop reorder**; tags/difficulty/conceptHint; enable/disable.
3. **Assignment & visibility**: attach catalog/tracks/sections to agents; control per‑trainee/group `catalogScope`; denormalize for fast trainee reads.
4. **Trainee sidebar**: organized, **scrollable** Tracks→Sections→Questions for assigned scope; realtime updates via Firestore listeners.
5. **Click‑to‑ask**: clicking a question → `VoiceClient.sendText(text)` (auto‑start session if idle) → agent answers in voice; log `catalog_click` to trace.
6. Rules: catalog write=admin+superadmin; read=trainee scoped.

🎯 Admin builds "Call Handling" track with sample questions; assigned trainee clicks one and gets coached in voice; follow‑ups work.
✅ Reordering reflects on trainee UI; trainee only sees assigned content; each click recorded with questionId/trackId.

---

## Phase 5 — Sessions, Traces & Transcripts (hardening) ⏱ M
🔗 Phase 3
**Tasks**
1. **`finalizeSession`**: on stop/disconnect compute `durationSec`, set status/endReason, counts; idempotent.
2. **Scheduled sweep**: finalize sessions stuck "active" past TTL.
3. Robust **batched/retried** trace writes; ordering guarantees; bounded `raw` payloads.
4. Transcript aggregation (denormalized for quick display) + per‑session counts.
5. Retention fields; ensure **no audio** anywhere.

🎯 Every session reliably finalized with accurate duration; complete ordered trace.
✅ Kill the tab mid‑session → sweep finalizes it; trace contains all turns + tool events in order.

---

## Phase 6 — Analytics Dashboard ⏱ L
🔗 Phase 5
**Tasks**
1. **KPI overview**: total sessions, active trainees, total/avg minutes, sessions per agent, tool‑usage, trend charts.
2. **Sessions table** + **filters** (date range, trainee, group, agent/process, role, duration, has‑tool‑call, has‑errors); pagination + composite indexes.
3. **Session detail**: metadata + transcript + **trace timeline** (tool calls & results inline).
4. **Per‑user / per‑agent rollups** (minutes used vs allocated).
5. **Export** (`exportSessions`): CSV + JSON of filtered set; single‑session export.
6. RBAC scoping (superadmin & admin = all trainees, trainee = own).
7. *(Scale option)* scheduled `dailyStats` rollups.

🎯 Superadmin filters, drills into a session, sees transcript+trace, exports CSV.
✅ Export matches filters; admin sees all trainees (trainee sees own); charts match raw counts.

---

## Phase 7 — Usage Restrictions & Settings ⏱ M
🔗 Phase 3, 6
**Tasks**
1. **Limit config UI** (superadmin): per user / process(agent) / group, daily/weekly/monthly minutes; group limits.
2. **`usageCounters`** model + transactional increment in `finalizeSession`.
3. **`usageGuard`** function: compute remaining (most‑restrictive‑wins); wire into `mintEphemeralToken` (pre‑start deny) and **heartbeat** (mid‑session) → graceful auto‑end.
4. **Remaining‑time meter** + warnings in trainee UI.
5. **Overrides/top‑ups**; timezone‑aware buckets; dashboard usage‑vs‑allocation views.
6. **Global settings**: retention, defaults, branding, feature flags.

🎯 Trainee blocked at limit with clear reason; mid‑session exhaustion ends gracefully; superadmin can top‑up.
✅ Enforcement holds even if client tampered (server‑side); counters reset on period boundaries.

---

## Phase 8 — Design Polish, A11y & Hardening ⏱ M
🔗 all
**Tasks**
1. Apply the minimal/clean design system end‑to‑end; empty/error/permission states; skeletons; toasts.
2. **Accessibility** (WCAG AA): keyboard nav, focus rings, ARIA live region for transcript, color contrast.
3. **Security review**: finalize Firestore rules (deny‑by‑default), rules tests, tool‑runner allow‑list, ephemeral‑token TTL, rate limits, input validation (zod) on all functions.
4. **Resilience**: WS reconnect with `resumption`; retry/backoff; offline/permission UX for mic.
5. **Test suites**: unit (functions, rules), integration (emulator), E2E (Playwright: login→session→catalog→dashboard), load test on trace writes.

🎯 Production‑quality UX + verified security + green test matrix.
✅ Rules tests cover every role×collection; E2E happy paths pass; a11y audit passes.

---

## Phase 9 — Deployment, Docs & Handoff ⏱ S
🔗 Phase 8
**Tasks**
1. Deploy to staging → UAT with real agents/catalogs → prod.
2. Seed prod: first superadmin, default settings, the Everest agent + catalog.
3. Runbooks: rotate `XAI_API_KEY`, manage URL allow‑list, retention, restore.
4. Admin & trainee user guides; onboarding checklist.

🎯 Live on prod with documentation and runbooks.
✅ Superadmin completes the "create agent → assign → trainee trains → review session" loop in prod.

---

## Cross‑Cutting Workstreams (run throughout)
- **Shared types/schemas** (`/packages/shared`, zod) — single source of truth for client+functions.
- **Security rules** — extend every phase; never ship a collection without rules + tests.
- **Telemetry** — function logs, error reporting, cost counters from day one.
- **Seed/migration scripts** — settings, roles, demo data.

---

## Suggested Build Order (critical path)
`Phase 0 → 1 → 2 → 3` (usable single‑agent trainer) → `4` (catalog) → `5 → 6` (sessions+dashboard) → `7` (limits) → `8 → 9` (harden+ship).

## Effort Snapshot
| Phase | Size |
|---|---|
| 0 Foundations | M |
| 1 Auth/RBAC/Users | L |
| 2 Agent management | L |
| 3 Trainee runtime | L |
| 4 Guided Questions | L |
| 5 Sessions/traces | M |
| 6 Dashboard | L |
| 7 Usage limits | M |
| 8 Polish/a11y/hardening | M |
| 9 Deploy/docs | S |

---

## Definition of Done (system)
- Superadmin creates/configures/publishes agents (prompt, KB, tools, web‑search) in a few clicks.
- Admin manages catalog + trainees + assignments + visibility; superadmin manages everything incl. limits.
- Trainee trains via voice+text, uses guided questions, always hears voice replies.
- Every session stored with timestamps, duration, transcript, and full trace (no audio).
- Dashboard with filters + export; RBAC enforced server‑side.
- Usage limits enforced (user/process/group × day/week/month); secrets never in browser.
- KB retrieval works via the custom `search_knowledge_base` path (built‑in `file_search` avoided).

---

## Immediate Next Actions (pre‑Phase‑0)
**Decisions locked (2026‑06‑12):** plain userid+password (no email) · KB = existing `collection_ids` · **admin = flat (manages all trainees & groups)** · feature name = **Guided Questions** (Learning Tracks → Sections → Questions) · stack = React+Tailwind+Firebase. Firebase **MCP: add at `user` scope + restart session**; provisioning via Firebase CLI/SDK regardless.

1. Provision Firebase project(s) and install/login `firebase-tools` (since MCP is unavailable).
2. (Optional) Fix the Firebase MCP server separately if direct MCP management is wanted.
3. Scaffold the monorepo (Phase 0); port the prototype's ephemeral‑token + `/search` + `VoiceClient`.
4. Confirm the two remaining defaults (non‑HTTP tools? usage timezone) — otherwise proceed with defaults.
