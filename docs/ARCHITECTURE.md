# Architecture & System Design — Astra Voice Training Platform (AVTP)

**Status:** Draft v1.0 · **Related:** [PRD.md](./PRD.md) · [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

> ⚠️ **IMPLEMENTATION PIVOT (2026-06-12) — [Context.md](../Context.md) is the current truth.** To stay on the **free Spark plan** (internal app), we **dropped Cloud Functions** (and Blaze/JDK/emulators). Current build: **Firebase Email/Password** auth where the **userid maps to a hidden internal email**; **roles in `users/{uid}.role`** enforced by **Firestore Security Rules** (no custom claims, no `credentials` collection); the **client talks directly to Firestore**; the only backend is a **tiny Node xAI proxy** (Phase 3) for the xAI key. The Cloud-Functions design below is **superseded** — keep it as reference for the secret/usage *concepts* (which move into the Node proxy / client-with-rules).

---

## 1. How xAI Maintains Conversation Context (research summary)

This drove several design decisions, so it's documented first.

- A realtime **session** = one WebSocket connection. The server holds a **`conversation`** object made of ordered **`conversation.item`** entries: `message` (user/assistant), `function_call`, and `function_call_output`.
- The model **automatically attends to all prior items** in the session — you do **not** resend history with each turn. Each `response.create` conditions on the accumulated conversation.
- **Context lifetime = the WS connection.** Close it → context is gone, unless **resumption** is used.
- **`resumption: { enabled: true }`** caches each turn; on reconnect you pass `?conversation_id=<id>` (from the `conversation.created` event) and re‑send `resumption.enabled:true`; the server **replays** cached `conversation.item.created` events (user+assistant transcripts, tool calls, tool outputs). **History expires after 30 min idle.** Both sides must opt in.
- No documented context‑window size/truncation.

**Implications for AVTP:**
1. **We do not need a server to relay audio** — the browser talks directly to xAI over WS using a short‑lived ephemeral token. (API key stays server‑side.)
2. **Within a training session, context is automatic.** We rely on the live session for coherence (including catalog‑click follow‑ups, which are just `message` items).
3. **For analytics we capture from the event stream** (transcripts, tool calls, tool outputs) — everything we need is already there; **no audio** required.
4. **Optional resilience:** enable `resumption` so a dropped connection within 30 min keeps context. Long‑term "resume yesterday's session" is **out of scope v1** (would require client replay of stored items).

---

## 2. High‑Level Architecture

```
                       ┌───────────────────────────────────────────────┐
                       │                  Browser (SPA)                 │
                       │  React + Vite + TS + Tailwind                  │
                       │                                                │
                       │  • Auth UI (userid/pw)   • Admin console       │
                       │  • Trainee runtime  ┌───────────────────────┐  │
                       │    (voice + text +  │ VoiceClient (WS)       │  │
                       │     catalog sidebar)│  mic→PCM→ws; ws→spkr   │  │
                       │  • Dashboard        │  event stream capture  │  │
                       └─────────┬───────────┴───────────┬───────────┘  │
                                 │ HTTPS (Firebase SDK)   │ WSS (ephemeral token)
                                 │                        │
            ┌────────────────────▼─────────┐     ┌────────▼─────────────────────┐
            │  Firebase                     │     │   xAI Voice Agent API         │
            │  • Auth (email‑alias + claims)│     │   wss://api.x.ai/v1/realtime  │
            │  • Firestore (system of rec.) │     │   (direct browser ↔ xAI)      │
            │  • Hosting (SPA)              │     └───────────────────────────────┘
            │  • Cloud Functions (backend)  │
            │     - mintEphemeralToken      │ Bearer XAI_API_KEY      ┌───────────┐
            │     - searchKnowledgeBase ────┼─────────────────────────▶ xAI REST  │
            │     - runTool (tool runner)  ─┼───────► allow‑listed     │ /documents│
            │     - userAdmin (Admin SDK)   │         external APIs    │  /search  │
            │     - usageGuard / finalize   │                          │ client_   │
            │     - exportSessions          │                          │ secrets   │
            │  • Secret Manager (XAI key)   │                          └───────────┘
            └───────────────────────────────┘
```

**Trust boundary:** the **XAI_API_KEY never reaches the browser**. The browser receives only a 10‑minute ephemeral token (minted by `mintEphemeralToken`) and uses it as a WS subprotocol. All retrieval and tool execution go through Cloud Functions that authenticate the Firebase user, check RBAC + usage, then call xAI/external APIs.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite + TypeScript + Tailwind CSS** | Fast, component‑driven, matches "minimal/clean" goal; easy to port the prototype's `voice-client.js`. |
| State/data | **TanStack Query + Firestore listeners** | Realtime catalog/agent updates; cached reads. |
| Auth | **Firebase Auth via Custom Tokens** (plain userid+password, no email) + **custom claims** | Admin‑provisioned userid login + role enforcement. |
| Database | **Cloud Firestore** | Realtime, rules‑based security, scales, fits document model. |
| Backend | **Cloud Functions for Firebase (Node 20 + TS)** | Secret‑holding, privileged ops, tool runner, token minting. |
| Secrets | **Secret Manager** (via Functions) | Store `XAI_API_KEY`. |
| Hosting | **Firebase Hosting** (+ CDN) | SPA + rewrites to functions. |
| Audio | **Web Audio API / AudioWorklet** (ported from prototype) | 24 kHz PCM16 capture/playback. |
| Charts | **Recharts** (or similar) | Dashboard KPIs. |

---

## 4. Component Breakdown

### 4.1 Frontend modules
- **`auth/`** — login, session, password change, route guards by role (from custom claims).
- **`runtime/VoiceClient.ts`** — ported `GrokVoiceClient`: mic capture, WS lifecycle, playback, **event‑stream capture** (transcripts, tool calls), `sendText`, `setVoice`, tool‑call handling (calls `searchKnowledgeBase`/`runTool`), trace emitter.
- **`runtime/TraineeApp`** — voice+text UI, voice picker (agent‑allowed), **Guided Questions sidebar**, tool indicator, remaining‑time meter.
- **`admin/agents`** — agent CRUD + config forms (prompt editor, KB picker, tool schema editor, web‑search toggle, voices, test sandbox).
- **`admin/catalog`** — tracks/sections/questions CRUD + drag‑reorder + assignment/visibility.
- **`admin/users`** — user & group management, assignments, usage limits.
- **`dashboard/`** — KPIs, sessions table + filters, session detail (transcript + trace timeline), export.
- **`settings/`** — superadmin global settings.

### 4.2 Cloud Functions (backend API)
| Function | Trigger | Role checks | Purpose |
|---|---|---|---|
| `login` | HTTPS callable (public) | n/a (rate‑limited) | Verify userid + password hash (`credentials/{uid}`); issue **Firebase Custom Token** with role claim. |
| `changePassword` | HTTPS callable | self | Set/rotate own password hash; clears `mustChangePassword`. |
| `mintEphemeralToken` | HTTPS callable | trainee+; agent assigned; **usage not exhausted** | Returns xAI ephemeral token + the agent's resolved session config (prompt, voice list, tools to register). Creates a `session` doc (status=active, start time). |
| `searchKnowledgeBase` | HTTPS callable | session owner | Proxy to `POST /v1/documents/search` with agent's KB config; **de‑dups** chunks; logs retrieval to trace. |
| `runTool` | HTTPS callable | session owner; tool belongs to agent | Executes a custom tool (allow‑listed HTTP binding); returns result; logs to trace. |
| `appendTrace` | HTTPS callable / batched | session owner | Persists transcript turns + trace events (batched). |
| `finalizeSession` | HTTPS callable + scheduled sweep | session owner / system | Marks session ended, computes duration, increments usage counters atomically. |
| `usageGuard` | HTTPS callable | self | Returns remaining minutes for applicable limits; used pre‑start and on heartbeat. |
| `userAdmin` | HTTPS callable | superadmin (any role); **admin (trainees only — all of them, not admins/superadmins)** | Create/update/disable/delete users via Admin SDK; set role custom claims. |
| `exportSessions` | HTTPS callable | superadmin & admin = all trainees; trainee = own | Generates CSV/JSON export of filtered sessions. |
| `onUserDelete` / `scheduledRetention` | trigger/cron | system | Retention purge/anonymize. |

### 4.3 xAI integrations
- **Realtime WS** (browser ↔ xAI) with ephemeral token; `session.update` carries prompt, voice, `turn_detection`, audio formats, and the **tool set** resolved from agent config:
  - `search_knowledge_base` (custom function) **if** a KB is attached,
  - each enabled **custom tool** (function with its JSON Schema),
  - `web_search` (built‑in) **if** toggled on,
  - *(optional)* `x_search`.
- **Documents search REST** (`/v1/documents/search`) via `searchKnowledgeBase` (the working retrieval path).
- **Ephemeral tokens** (`/v1/realtime/client_secrets`) via `mintEphemeralToken`.

---

## 5. Key Data Flows

### 5.1 Login & RBAC (plain userid + password — no email)
1. User enters **userid + password** → SPA calls the **`login`** Cloud Function.
2. `login` looks up `users` by `userid`, verifies the password hash (bcrypt/scrypt) stored in a **non‑client‑readable `credentials/{uid}`** doc, then mints a **Firebase Custom Token** carrying the **`role`** (+ optional `groups`) claim.
3. SPA calls `signInWithCustomToken(token)` → gets a Firebase ID token with the role claim. Route guards + Firestore Security Rules + Functions all read `request.auth.token.role`.
4. First login → `mustChangePassword` forces a password reset (via `userAdmin`/`changePassword` function). `login` is rate‑limited with lockout on repeated failures.

> **Why custom tokens:** gives real userid/password auth (admin‑provisioned, no email) while still leveraging Firebase Auth sessions + claims for Firestore rules. No `<userid>@domain` aliasing.

### 5.2 Start a session
1. Trainee opens an assigned agent → SPA calls **`mintEphemeralToken({agentId})`**.
2. Function verifies assignment + **usage remaining** (`usageGuard`), reads agent config, creates `sessions/{id}` (active), returns `{ token, sessionConfig }`.
3. SPA opens WS to xAI with the token; sends `session.update` (prompt, voice, tools, `resumption:true`); starts mic.

### 5.3 Tool call (knowledge base / custom)
1. Model emits `response.function_call_arguments.done` (`name`, `arguments`, `call_id`).
2. SPA routes:
   - `search_knowledge_base` → callable **`searchKnowledgeBase`** → xAI `/documents/search` → de‑dup → results.
   - custom tool → callable **`runTool`** → external API.
3. SPA sends `conversation.item.create { function_call_output }` + `response.create`.
4. Function **logs** {tool, args, results, latency} to the session trace. Model answers in voice.

> Server‑side tools (`web_search`) execute inside xAI; their use is inferred/logged from the event stream.

### 5.4 Guided question click (Guided Questions)
1. Trainee clicks a question → if no session, auto‑start (5.2).
2. SPA `VoiceClient.sendText(questionText)` → `conversation.item.create {input_text}` + `response.create`.
3. Trace logs a `catalog_click` event (questionId, trackId). Agent answers in voice; follow‑ups normal.

### 5.5 Trace & transcript capture
- `VoiceClient` listens to: `response.output_audio_transcript.delta/done` (assistant), `conversation.item.input_audio_transcription.completed` (spoken user), typed inputs, tool events, errors.
- Events are **buffered and flushed** via `appendTrace` (batched, retried) to `sessions/{id}/events/*` and aggregated transcript.
- No audio bytes are persisted.

### 5.6 End session & usage accounting
- On stop/disconnect/timeout → **`finalizeSession`**: set `endedAt`, compute `durationSec`, atomically **increment** `usageCounters` (user, agent/process, group × day/week/month).
- A **scheduled sweep** finalizes sessions abandoned without a clean close.

### 5.7 Usage enforcement
- Pre‑start: `mintEphemeralToken` denies if any applicable limit exhausted (most‑restrictive‑wins).
- Mid‑session **heartbeat** (e.g., every 60 s) calls `usageGuard`; on exhaustion SPA shows warning then gracefully ends and finalizes.

---

## 6. Firestore Data Model

> Conventions: collection names plural; timestamps as Firestore `Timestamp`; ids auto unless noted. Subcollections for high‑volume children (events).

```
credentials/{uid}          // DENY-ALL in rules; Functions/Admin SDK only
  passwordHash, algo:"bcrypt", failedAttempts, lockedUntil, updatedAt

users/{uid}
  userid, displayName, role: "superadmin"|"admin"|"trainee",
  status: "active"|"disabled", groups: [groupId],   // flat admin scope: no per-admin ownership
  assignedAgentIds: [agentId],            // trainee
  catalogScope: { trackIds:[], sectionIds:[], questionIds:[] } | "all",
  usageLimits: { perDayMin, perWeekMin, perMonthMin } | null,  // user-level overrides
  createdAt, createdBy, mustChangePassword: bool

groups/{groupId}
  name, description, memberUids:[uid], ownerAdminUids:[uid],
  usageLimits: { perDayMin, perWeekMin, perMonthMin } | null,
  assignedAgentIds:[agentId], catalogScope:{...}|"all", createdAt, createdBy

agents/{agentId}
  name, description, status:"draft"|"published"|"archived",
  model, systemPrompt, promptVersion,
  voices: { default:"rex", allowed:["rex","eve","ara","sal","leo"] },
  turnDetection: {...}, audio: {...},
  knowledgeBase: { enabled, collectionIds:[...], maxNumResults, retrievalMode, dedupe:true, limit },
  webSearch: { enabled, },  xSearch:{ enabled, allowedHandles:[] },
  tools: [                                  // custom tools
    { id, name, description, enabled,
      parameters: <JSON Schema>,
      binding: { type:"http", url, method, headersRef, bodyTemplate, timeoutMs } } ],
  usageLimits: { perDayMin, perWeekMin, perMonthMin } | null,   // per-process limits
  createdAt, createdBy, updatedAt, updatedBy

agents/{agentId}/configHistory/{versionId}   // audit of config changes

catalogs/{catalogId}                          // a Learning Track set (often 1 per agent/process)
  name, description, createdBy

tracks/{trackId}
  catalogId, title, order, description

sections/{sectionId}
  trackId, parentSectionId|null, title, order

questions/{questionId}
  sectionId, trackId, text, order,
  tags:[], difficulty, conceptHint, enabled, createdBy, updatedAt

assignments/{assignmentId}                    // who sees which agent + catalog scope
  subjectType:"user"|"group", subjectId,
  agentIds:[...], catalogScope:{trackIds,sectionIds,questionIds}|"all",
  createdBy, createdAt
  // (denormalized onto users/groups for fast trainee reads)

sessions/{sessionId}
  userId, agentId, agentName, processTag,
  startedAt, endedAt|null, durationSec, status:"active"|"ended"|"aborted",
  voiceUsed, counts:{ spoken, typed, catalogClicks, toolCalls, errors },
  endReason:"user"|"limit"|"disconnect"|"timeout",
  transcriptSummary?, conversationId?           // xAI conversation id (resumption)

sessions/{sessionId}/events/{eventId}          // ordered trace
  ts, type:"user_msg"|"assistant_msg"|"catalog_click"|
          "tool_call"|"tool_result"|"error"|"system",
  role?, text?, questionId?, trackId?,
  tool?:{ name, args, status, latencyMs, resultPreview, resultRef? },
  raw? (bounded)

usageCounters/{counterId}                       // id = `${scope}:${subjectId}:${period}:${bucket}`
  scope:"user"|"group"|"process", subjectId, period:"day"|"week"|"month",
  bucket:"2026-06-12"|"2026-W24"|"2026-06", usedSec, updatedAt

settings/global
  timezone, retentionDays, defaultModel, defaultVoices, branding,
  featureFlags:{ xSearch, kbIngestion }, defaultUsageLimits

auditLogs/{logId}
  actorUid, action, targetType, targetId, before?, after?, ts
```

**Indexes (composite):** sessions by `(userId, startedAt)`, `(agentId, startedAt)`, `(status, startedAt)`; questions by `(sectionId, order)`; sections by `(trackId, order)`; tracks by `(catalogId, order)`; usageCounters by id (point reads).

**Hot‑spot avoidance:** usage counters are sharded by period bucket and incremented via transactions/`FieldValue.increment`; trace events are append‑only in a subcollection.

---

## 7. Security Model

- **Auth:** **plain userid + password** → backend `login` verifies a bcrypt/scrypt hash in `credentials/{uid}` and issues a **Firebase Custom Token**; **no email**. **Roles in custom claims** (`role`, optional `groups`) set by `userAdmin` via Admin SDK; refreshed on role change. `credentials/*` is **deny‑all** in rules (Functions/Admin SDK only); `login` is rate‑limited with lockout.
- **Firestore Security Rules** (enforced server‑side by Firebase):
  - `agents`, `settings`, `usageCounters`, `auditLogs` → **write: superadmin only**; agents read: assigned trainees + admins.
  - `tracks/sections/questions/catalogs` → write: admin+superadmin; read: trainees only for **assigned scope**.
  - `users/groups` → superadmin full (any role); **admin: read/write all trainees & groups, but NOT admin/superadmin user docs**; trainee reads own doc only.
  - `sessions/{id}` → create/read own (trainee); **admin & superadmin read all**; **events written only via Functions** (or owner‑append with strict shape).
- **Cloud Functions** re‑check role + ownership + assignment + usage on every privileged call (never trust client).
- **Secrets:** `XAI_API_KEY` in Secret Manager, used only by functions. Browser gets **ephemeral tokens** (10 min).
- **Tool runner safety:** custom‑tool HTTP bindings restricted to a **superadmin‑maintained URL allow‑list**, with timeouts, size caps, and secret references (never inline secrets in client‑readable docs).
- **PII:** transcripts access‑controlled; export + retention governed; deletion supported.

---

## 8. xAI Integration Details

- **Connect:** `wss://api.x.ai/v1/realtime?model=<model>` (+ `&conversation_id=` on resume); subprotocol `xai-client-secret.<ephemeral>`.
- **`session.update`** built from agent config: `instructions` (system prompt), `voice` (trainee‑selected within allowed), `turn_detection: server_vad`, `audio` (24 kHz PCM16 in/out + transcription), `resumption:{enabled:true}`, and `tools[]`.
- **Tools registration logic:**
  - KB attached → register `search_knowledge_base` function (`{query}` schema).
  - Each enabled custom tool → register as `function` with its JSON Schema.
  - `webSearch.enabled` → add `{type:"web_search"}`. *(optional `x_search`.)*
- **Retrieval (`searchKnowledgeBase`):** `POST /v1/documents/search` `{ query, source:{collection_ids}, retrieval_mode:{type}, limit }`; then **de‑dup by `chunk_id`**, keep top‑N unique; return `{content, score, file_id}` list.
- **Why custom KB tool, not built‑in `file_search`:** built‑in returns *"invalid type: map, expected a string"* and never executes (see PRD §9 C1). Verified working: custom tool path retrieves at 0.99+.
- **Voices:** eve, ara, rex, sal, leo (agent‑restricted subset).

---

## 9. Usage Metering Design
- Counters keyed `scope:subjectId:period:bucket` (e.g., `user:U123:day:2026-06-12`, `process:AGENT9:week:2026-W24`, `group:G1:month:2026-06`).
- `finalizeSession` increments **all applicable** counters by `durationSec` in one transaction.
- Limit check resolves all applicable limits and applies **most‑restrictive‑wins**; remaining = min(allocation − used) across scopes.
- Period buckets computed in the portal timezone; resets are implicit (new bucket id).
- Overrides/top‑ups: superadmin writes an allowance doc that adds to allocation.

---

## 10. Observability, Cost & Scale
- **Logging/metrics:** Cloud Functions logs + Error Reporting; per‑function latency; xAI call counts/cost surfaced in dashboard.
- **Cost levers:** ephemeral‑token TTL, retrieval `limit`/dedupe, retention window, batched trace writes.
- **Scale:** stateless functions autoscale; Firestore reads paginated; trace writes batched; dashboard aggregates via precomputed rollups (optional `dailyStats` collection via scheduled function for large volumes).

---

## 11. Environments & Deployment
- **Environments:** `dev`, `staging`, `prod` Firebase projects; config via env + Secret Manager.
- **CI/CD:** build SPA → Firebase Hosting; deploy Functions + rules + indexes; preview channels for PRs.
- **Tooling note:** the Firebase **MCP server** must be added at **`user` scope** and the session restarted to be usable here; regardless, Firebase provisioning/deploys use the **Firebase CLI (`firebase-tools`)** and the **Admin/Client SDKs in code** (MCP is a convenience layer only).
- **Migrations:** Firestore is schemaless; use versioned seed/migration scripts for settings, roles, and the first superadmin bootstrap.
- **Prototype reuse:** current `server.js` (ephemeral token + `/search`) becomes `mintEphemeralToken` + `searchKnowledgeBase`; `voice-client.js` becomes `runtime/VoiceClient.ts`; `Instruction.md` becomes per‑agent `systemPrompt` content.

---

## 12. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| xAI built‑in KB stays broken | Custom `search_knowledge_base` path (already verified). |
| Lost trace events on disconnect | Batched + retried `appendTrace`; scheduled finalize sweep. |
| Usage bypass via client | Enforced in `mintEphemeralToken`/`usageGuard`/`finalizeSession`. |
| Secret leakage | Key only in Secret Manager; browser gets ephemeral tokens. |
| Hybrid duplicate chunks reduce recall | De‑dup + raise limit in `searchKnowledgeBase`. |
| Catalog/agent edits not reflecting | Firestore realtime listeners on trainee runtime. |
