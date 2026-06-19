# Product Requirements Document — Astra Voice Training Platform (AVTP)

**Status:** Draft v1.0
**Owner:** Astra
**Last updated:** 2026-06-12
**Related docs:** [ARCHITECTURE.md](./ARCHITECTURE.md) · [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md)

---

## 1. Overview & Vision

Astra Voice Training Platform (AVTP) is a web application for **creating, managing, and delivering AI voice‑agent training** at scale. A superadmin can stand up a new, fully‑configured voice trainer — for any process/portfolio (e.g., *"Everest Debt Collection Process Trainer"*) — in a few clicks: provide a system prompt, attach a knowledge base, attach custom tools, toggle web search, name it, and publish.

Trainees log in and practice with their assigned voice agent through a clean voice‑first interface. They can **speak or type**; the agent **always answers in voice**. To make training effortless, each agent surfaces a curated, clickable **Guided Questions** of prewritten questions organized into Learning Tracks — a trainee clicks a question and the agent answers and coaches them through it, with normal follow‑up conversation thereafter.

Every session is recorded as structured data (transcripts + full execution traces, **no audio**) with timestamps and duration, surfaced in an analytics dashboard with filtering and export. Access is governed by a role‑based system (superadmin / admin / trainee), and superadmins enforce usage/time limits per user, per process, and per group. Firebase is the system of record.

> **Design north star:** minimal, clean, fast — the same aesthetic as the current prototype, extended into a full product.

---

## 2. Goals & Non‑Goals

### 2.1 Goals
- **G1** — Spin up a new, fully configured voice agent in <5 minutes from the admin UI, no code.
- **G2** — Deliver a frictionless trainee experience: voice + text + one‑click guided questions.
- **G3** — Capture complete, queryable session records (transcripts + traces) for coaching/QA.
- **G4** — Enforce role‑based access and per‑user/process/group usage limits reliably.
- **G5** — Keep the API key and all privileged actions server‑side; never expose secrets to the browser.
- **G6** — Reliable knowledge‑base retrieval despite xAI's broken built‑in `file_search` (see §9).

### 2.2 Non‑Goals (v1)
- Storing or playing back **audio** recordings (transcripts only).
- Building our own STT/TTS or LLM (we use xAI's Voice Agent API).
- Public/self‑serve signup (users are provisioned by admins/superadmin).
- Real‑time multi‑party calls or human‑agent handoff.
- Mobile native apps (responsive web only).
- In‑app collection/document *ingestion* UI is **Phase 2+ / optional** (MVP attaches existing `collection_id`s; see Open Questions).

---

## 3. Personas & Roles

| Persona | Who | Primary jobs |
|---|---|---|
| **Superadmin** | Platform owner (Astra) | Everything: manage voice agents, users (all roles), catalogs, usage limits, global settings, view all analytics. |
| **Admin** | Trainer / team lead | Manage Guided Questions (Learning Tracks/sections/questions), manage trainees (create trainee accounts, group them), control **assignments** (which agents + which catalog content each trainee/group sees), view analytics for their scope. |
| **Trainee** | Agent‑in‑training | Log in, interact with assigned voice agent(s) via voice/text, use assigned guided questions, see own history. |

### 3.1 RBAC permission matrix

| Capability | Superadmin | Admin | Trainee |
|---|:--:|:--:|:--:|
| Create/edit/delete **voice agents** & their config | ✅ | ❌ | ❌ |
| Attach KB / tools / web‑search toggle on agents | ✅ | ❌ | ❌ |
| Create/edit/delete **users** (any role) | ✅ | ❌ | ❌ |
| Create/edit/delete **trainee** users | ✅ | ✅ | ❌ |
| Create/edit/delete **admin/superadmin** users | ✅ | ❌ | ❌ |
| Manage **groups** | ✅ | ✅ | ❌ |
| Create/edit/delete/reorder **catalog** (tracks/sections/questions) | ✅ | ✅ | ❌ |
| **Assign** agents & catalog visibility to trainees/groups | ✅ | ✅ | ❌ |
| Set **usage limits** (per user/process/group, daily/weekly/monthly) | ✅ | ❌ (view only) | ❌ |
| Global **settings** (xAI keys, defaults, retention) | ✅ | ❌ | ❌ |
| View **analytics** — all sessions | ✅ | ✅ all trainees | own only |
| **Export** session data | ✅ | ✅ all trainees | own only (optional) |
| Interact with a voice agent (run sessions) | ✅ (any) | ✅ (any, for testing) | ✅ (assigned only) |

> Admin scope is **flat**: any admin can manage **all trainees and all groups** (create/edit/disable trainee accounts, manage groups, manage Guided Questions, assign agents/catalog visibility, and view/export all trainee sessions). Admins **cannot** manage other admins/superadmins, voice agents, global settings, or usage limits — those are **superadmin‑only**. Groups remain useful for bulk assignment and group usage limits.

---

## 4. Terminology

| Term | Meaning |
|---|---|
| **Voice Agent** | A configured Grok voice trainer: name, description, system prompt, voice(s), model, KB settings, tools, web‑search flag, status. |
| **Knowledge Base (KB)** | An xAI **Collection** (vector store) referenced by `collection_id`, searched via our `search_knowledge_base` tool. |
| **Guided Questions** *(the curated‑question feature)* | The curated, clickable question library shown to trainees (organized as Learning Tracks → Sections → Questions). |
| **Learning Track** | Top‑level grouping in the catalog (e.g., *Call Handling*, *Compliance*, *Negotiation*). |
| **Section / Sub‑section** | Nested grouping inside a track. |
| **Guided Question** | A prewritten prompt a trainee clicks to ask the agent. |
| **Session** | One continuous interaction between a trainee and an agent (connect → disconnect). |
| **Transcript** | Ordered text of user + assistant turns within a session. |
| **Trace** | Structured timeline of events in a session incl. tool calls, arguments, results, timings, question‑clicks. |
| **Group** | A set of trainees for bulk assignment and group usage limits. |
| **Usage Limit** | Allocated training minutes (per user / process / group; daily/weekly/monthly). |

> **Feature name (confirmed):** the curated‑question feature is called **"Guided Questions"**, organized as **Learning Tracks → Sections → Questions**. (Alternatives considered: "Coaching Catalog", "Prompt Library", "Playbook", "Question Bank".)

---

## 5. Functional Requirements

### F1 — Authentication & User Provisioning
- **F1.1** **Userid + password** login (no public signup). Created/managed by superadmin/admin. **Implemented (Spark pivot):** Firebase **Email/Password** where the userid maps to a **hidden internal email** the user never sees/types; **roles in `users/{uid}.role`** enforced by Firestore rules. *(Supersedes the earlier custom-token/Cloud-Function plan — see [Context.md](../Context.md).)*
- **F1.2** Superadmin/Admin can **create** users: set userid, temporary password, role, display name, group(s), assigned agents, assigned catalog scope, usage limits.
- **F1.3** Force password change on first login; password reset by admin/superadmin.
- **F1.4** Deactivate/reactivate and delete users; deletion preserves historical session records (anonymizable).
- **F1.5** Session/token expiry, logout, and "remember me" within policy.

### F2 — Role‑Based Access Control
- **F2.1** Three roles (superadmin, admin, trainee) enforced **both** in UI and server‑side (custom claims + Firestore Security Rules + Cloud Functions).
- **F2.2** Trainees can only see/run **assigned** agents and **assigned** catalog content; cannot reach admin areas.
- **F2.3** Admins can act on **all trainees and groups** (flat scope); they cannot touch admin/superadmin accounts, voice‑agent configs, settings, or usage limits.
- **F2.4** All privileged mutations validated server‑side regardless of client.

### F3 — Voice Agent Management (Superadmin)
Create/edit/clone/delete/publish agents with configurable fields:
- **F3.1** Name (e.g., "Everest Debt Collection Process Trainer"), description, status (Draft/Published/Archived).
- **F3.2** **System prompt** (the agent instructions) — rich multiline editor with versioning.
- **F3.3** **Model** (e.g., `grok-voice-think-fast-1.0`) and **voice** settings: default voice + the subset of the 5 Grok voices (eve, ara, rex, sal, leo) trainees may pick from.
- **F3.4** **Knowledge base settings**: one or more `collection_id`s, `max_num_results`, `retrieval_mode` (hybrid/semantic/keyword), result de‑dup + limit (see §9). Attaching a KB auto‑enables the `search_knowledge_base` tool.
- **F3.5** **Custom tools**: add tools by name + description + **JSON Schema** for parameters + an execution binding (HTTP endpoint, method, auth, payload mapping). Multiple tools per agent; enable/disable individually.
- **F3.6** **Web search toggle** (on/off) → adds xAI `web_search` tool. *(Optional: X search toggle with allowed handles.)*
- **F3.7** Turn‑detection/VAD and other advanced settings with sensible defaults.
- **F3.8** Validation + a **"Test agent"** sandbox (run the agent before publishing).
- **F3.9** Audit trail of config changes (who/when/what).

### F4 — Knowledge Base Retrieval
- **F4.1** Retrieval uses the platform's `search_knowledge_base` custom tool → backend proxy → xAI `POST /v1/documents/search` (the **working** path; the built‑in realtime `file_search` is broken — see §9).
- **F4.2** Per‑agent retrieval config (collections, mode, max results) is applied at query time.
- **F4.3** Results are **de‑duplicated** and capped to N unique chunks (hybrid returns duplicate pairs — see §9).
- **F4.4** Every retrieval (query + returned chunks + scores) is logged to the session trace.

### F5 — Custom Tools & Web Search
- **F5.1** When an agent has custom tools/KB/web‑search enabled, the runtime registers the corresponding tool definitions in `session.update`.
- **F5.2** Custom tool calls are executed by a **server‑side tool runner** (Cloud Function) per the agent's binding; results returned to the model as `function_call_output`.
- **F5.3** Tool execution is sandboxed, time‑limited, allow‑listed by URL, and fully traced.

### F6 — Trainee Voice + Text Experience
- **F6.1** Voice‑first conversation (mic in, voice out) using the assigned agent.
- **F6.2** **Text chat** alongside voice: trainee can type; **the agent always replies in voice** (+ on‑screen transcript).
- **F6.3** **Voice picker** limited to the agent's allowed voices.
- **F6.4** Live transcript of both sides; on‑screen **tool‑activity indicator** during retrieval/tool use.
- **F6.5** Barge‑in (interrupt) supported as in the prototype.
- **F6.6** Clear session controls (start/end), connection status, and remaining‑time indicator (see F10).

### F7 — Guided Questions (curated clickable prompts)
- **F7.1** Trainee UI shows assigned **Learning Tracks → Sections → Guided Questions** in an **organized, scrollable sidebar**.
- **F7.2** Clicking a question **injects it into the live conversation** as the trainee's message; the agent answers in voice exactly as if asked. Normal follow‑ups continue.
- **F7.3** If no session is active, clicking a question **auto‑starts** a session then asks it.
- **F7.4** Each click is logged to the trace (with question id + track/section context).
- **F7.5** **Catalog management** (admin/superadmin): full CRUD + **reordering** of tracks/sections/questions; attach a catalog (or specific tracks/sections) to one or more agents; control **visibility** per trainee/group.
- **F7.6** Catalog edits reflect on the relevant agent interface (near real‑time).
- **F7.7** Optional metadata per question: difficulty, tags, expected concept, "recommended next."

### F8 — Sessions, Traces & Transcripts
- **F8.1** Persist every session: ids (user, agent), **start/end timestamps**, **duration (minutes)**, voice used, entry mode counts (spoken vs typed vs catalog‑click), status, end reason.
- **F8.2** Persist **full transcript** (ordered turns with role + text + timestamps).
- **F8.3** Persist **detailed trace**: each tool call (name, arguments, status, latency, returned results/chunks), each response, errors, and catalog clicks — in chronological order.
- **F8.4** **No audio** is stored.
- **F8.5** Records are immutable once finalized; retention configurable by superadmin.

### F9 — Analytics Dashboard
- **F9.1** Overview KPIs: total sessions, active trainees, total/avg training minutes, sessions per agent, tool‑usage counts, period trends.
- **F9.2** **Sessions table** with **filters**: date range, trainee, group, agent/process, role, duration, contains‑tool‑call, contains‑errors.
- **F9.3** **Session detail** view: metadata + transcript + **trace timeline** (tool calls and results inline).
- **F9.4** **Per‑user** and **per‑agent** rollups (minutes used vs allocated, frequency).
- **F9.5** **Export** filtered results (CSV + JSON); single‑session export.
- **F9.6** Scope respects RBAC (superadmin & **admin see all trainees**; trainee sees own).

### F10 — Usage Restrictions / Time Limits
- **F10.1** Superadmin sets allocations of training **minutes** per **user**, per **process/agent (or portfolio)**, and per **group**, with **daily / weekly / monthly** windows.
- **F10.2** Limits enforced **server‑side**: block session start when the applicable limit is exhausted; warn the trainee as they approach it; auto‑end (graceful) when exhausted mid‑session.
- **F10.3** Most‑restrictive‑wins when multiple limits apply (user vs group vs process).
- **F10.4** Counters reset on period boundaries (timezone‑aware).
- **F10.5** Dashboard surfaces usage vs allocation; superadmin can grant overrides/top‑ups.

### F11 — Settings (Superadmin)
- **F11.1** xAI credentials/model defaults, default voices, retention period, timezone, branding.
- **F11.2** Default usage policies and group definitions.
- **F11.3** Feature flags (e.g., enable X search, enable in‑app KB ingestion).

### F12 — Design / UX Requirements
- **F12.1** Minimal, clean, dark‑first aesthetic consistent with the current prototype; responsive.
- **F12.2** Fast perceived performance; optimistic UI for admin CRUD; skeleton loaders.
- **F12.3** Accessible (WCAG 2.1 AA): keyboard nav, focus states, ARIA for the live transcript, captions of spoken output via on‑screen transcript.
- **F12.4** Clear empty/error/permission states; consistent component library.

---

## 6. Key User Stories (acceptance highlights)

- **US‑SA‑1** *As a superadmin*, I create a "Everest Debt Collection Process Trainer" by entering a name, description, system prompt, selecting collection `collection_58eb…`, enabling web search off, adding a custom "lookup_account" tool schema, choosing allowed voices, and publishing — and it appears for assigned trainees. ✔ when a trainee can run it end‑to‑end.
- **US‑AD‑1** *As an admin*, I add a Learning Track "Call Handling" with the question "I can't convert right‑party contacts into payments — how do I do that effectively?", reorder it above another, and assign it to Group "Batch‑A". ✔ when Batch‑A trainees see it in order and clicking it gets a voice answer.
- **US‑TR‑1** *As a trainee*, I click a guided question and the agent coaches me in voice; I then type a follow‑up and still hear a voice reply. ✔ when both turns appear in transcript and the session is recorded.
- **US‑SA‑2** *As a superadmin*, I open the dashboard, filter sessions to "last 7 days, Group Batch‑A, Everest agent", open one session, read the transcript and see the `search_knowledge_base` calls + returned chunks in the trace, and export CSV. ✔ when export matches the filtered set.
- **US‑SA‑3** *As a superadmin*, I cap each trainee to 60 min/day on the Everest process; a trainee who used 60 min is blocked from starting and sees the reason. ✔ when enforcement is server‑side.

---

## 7. Non‑Functional Requirements

- **Security:** API key only in Cloud Functions/Secret Manager; browser uses short‑lived ephemeral tokens; all writes authorized server‑side; least‑privilege Firestore rules; tool‑runner URL allow‑list; audit logging of privileged actions.
- **Privacy:** No audio stored; transcripts/traces may contain sensitive training content — encrypted at rest (Firebase default), access‑controlled, retention‑bounded, exportable/deletable per policy.
- **Reliability:** Graceful handling of WS disconnects (optional resumption within 30 min); idempotent session finalization; no lost trace events (batched + retried writes).
- **Performance:** Voice round‑trip governed by xAI; UI interactions <100 ms; dashboard queries paginated + indexed.
- **Scalability:** Hundreds of concurrent trainees; Firestore modeled to avoid hot‑spots; functions stateless/autoscaled.
- **Browser support:** Latest Chrome/Edge/Safari/Firefox; mic permission UX; HTTPS required (WebRTC/AudioWorklet).
- **Observability:** Function logs, error reporting, usage metrics, audit trail.

---

## 8. Data Retention & Compliance
- Transcripts/traces retained for a superadmin‑configured window (default 12 months), then purged or anonymized.
- Right‑to‑be‑forgotten: delete a user's PII while retaining anonymized aggregates.
- Exports access‑controlled and logged.

---

## 9. Critical Technical Constraints (carried from prototype findings)
- **C1 — Built‑in `file_search` is broken in the realtime API.** It surfaces a `collections_search` function whose `search_request` arg is typed `string` but described as a JSON object; the model emits a map → server returns *"invalid type: map, expected a string"* → no retrieval (it hallucinates or stalls). **Mitigation:** use a **custom `search_knowledge_base` function tool** → backend `POST /v1/documents/search`. (Verified working at 0.99+ relevance.)
- **C2 — Hybrid search returns duplicate chunks.** `retrieval_mode: hybrid` returns each chunk twice (semantic+keyword fusion), so `limit:10` ≈ 5 unique. **Mitigation:** de‑dup by `chunk_id` and/or raise limit.
- **C3 — Chunking is small** (1024 bytes, 200 overlap) → state‑specific facts can split from headers. **Mitigation (KB side):** larger chunks/overlap on re‑index; **(runtime):** multi‑query retrieval.
- **C4 — Context is per‑session** (server‑side conversation; auto‑attended). Cross‑reconnect continuity needs `resumption` (30‑min idle expiry) or client replay; for analytics we capture from the event stream (no audio).
- **C5 — Voices:** eve, ara, rex, sal, leo (mid‑session switch is best‑effort/undocumented).

---

## 10. Resolved Decisions & Remaining Questions

**Resolved (confirmed by product owner, 2026‑06‑12):**
1. ✅ **Login identity:** **plain userid + password**, created/managed by superadmin/admin. **No email aliasing.** Implemented via backend login → **Firebase Custom Token** + role claim (see Architecture §5.1 / §7).
2. ✅ **KB ingestion scope:** MVP **attaches existing `collection_id`s** only; in‑app document upload/collection creation is deferred (future).
3. ✅ **Admin scoping:** **flat** — any admin manages **all trainees and groups** (and Guided Questions, assignments, and all trainee analytics). Admins cannot manage admins/superadmins, agents, settings, or usage limits.
4. ✅ **Naming:** the curated‑question feature is called **"Guided Questions"** (organized as **Learning Tracks → Sections → Questions**).
5. ✅ **Database / stack:** **Firebase** (Auth + Firestore + Cloud Functions + Hosting + Secret Manager) with a **React + Vite + TypeScript + Tailwind** SPA.

> **Tooling note:** the Firebase **MCP server** is being enabled (add at **user scope** + restart the session). Regardless of MCP, Firebase resources are created/managed via the **Firebase CLI + Admin/Client SDKs in code** — MCP is only a convenience layer.

**Remaining (sensible defaults applied; flag if you disagree):**
- **Custom tool execution:** generic HTTP tool runner with per‑tool auth + superadmin URL allow‑list. *Any non‑HTTP tools needed?*
- **Usage‑window timezone:** portal‑level timezone (set in global settings). *OK vs per‑user?*
- **Multi‑tenant:** single org (Astra) assumed; multi‑org is future.

---

## 11. Out of Scope (v1) / Future
- In‑app collection/document ingestion & re‑chunking UI.
- Auto‑scoring/grading of trainee performance from transcripts (AI QA rubric) — strong future feature.
- Human‑in‑the‑loop review/annotation of sessions.
- SSO/SAML, multi‑org tenancy, billing.
- Native mobile apps; offline mode.

---

## 12. Success Metrics
- Time to create+publish a new agent < 5 min.
- ≥ 95% of trainee KB questions answered from the knowledge base (grounded, no hallucination) — measured via trace.
- 100% of sessions captured with transcript + trace.
- Zero secret leakage; all privileged writes server‑authorized.
- Trainee task success & weekly active trainees trending up.

---

*Sources for context‑maintenance & API behavior:* [xAI Voice Agent API docs](https://docs.x.ai/developers/model-capabilities/audio/voice-agent), [xAI Collections / documents search](https://docs.x.ai/developers/rest-api-reference/collections), [xAI Voice overview](https://docs.x.ai/docs/guides/voice).
