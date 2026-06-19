# Astra Voice Training Platform (AVTP)

Multi-agent, role-based voice-training platform powered by the xAI Grok Voice Agent API, on Firebase.

> **New here? Read [`Context.md`](./Context.md) first** for exactly where development stands, then [`CLAUDE.md`](./CLAUDE.md) for the rules/constraints. Full specs in [`docs/`](./docs).

## Monorepo layout
```
apps/web         React + Vite + TS + Tailwind SPA (trainee runtime, admin console, dashboard)
functions        Firebase Cloud Functions (TS): auth/login, ephemeral tokens, KB search, tool runner, usage
packages/shared  Shared TypeScript types/contracts used across web + functions
docs/            PRD, ARCHITECTURE, IMPLEMENTATION_PLAN
firestore.rules  Security rules (locked down in Phase 0; role-aware from Phase 1)
firebase.json    Hosting + Functions + Firestore + Emulators config
```
> `functions` is intentionally **not** an npm workspace (Firebase deploy needs its own `node_modules`). Install it with `npm run install:functions`.

## Prerequisites
- Node 20+ (this machine: `C:\Users\amrita.mandal\Downloads\node-v22.16.0-win-x64\node-v22.16.0-win-x64`)
- Firebase CLI (`npx -y firebase-tools@latest ...`), authenticated as the project owner
- Firebase project: **`astra-voice-training`**

## Getting started
```bash
npm install                 # installs workspaces (apps/web, packages/shared)
npm run install:functions   # installs functions deps
npm run build:shared        # build shared types
npm run dev:web             # run the SPA (Vite)
npm run emulators           # run Firebase emulators (auth, functions, firestore, hosting)
```

## Configuration
- **Web:** copy `apps/web/.env.example` → `apps/web/.env.local` and fill the Firebase web config (from `firebase apps:sdkconfig`).
- **Functions secret:** set the xAI key — `firebase functions:secrets:set XAI_API_KEY` (never commit it).

## Run & verify Phase 1 login locally (emulators)
> Requires **Java (JDK 11+)** for the Auth + Firestore emulators (e.g. Temurin). Node 22 standalone is used for npm.

```powershell
# 0) one-time: ensure Java is on PATH  (java -version)
$node="C:\Users\amrita.mandal\Downloads\node-v22.16.0-win-x64\node-v22.16.0-win-x64"; $env:Path="$node;"+$env:Path

# 1) start emulators (Auth, Functions, Firestore, Hosting, UI on :4000)
cd <repo root>
& "$node\npx.cmd" -y firebase-tools@latest emulators:start

# 2) in a SECOND terminal — build functions + seed the superadmin into the emulator
cd functions
& "$node\npm.cmd" run build
$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; $env:FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099"; $env:GCLOUD_PROJECT="astra-voice-training"
& "$node\npm.cmd" run seed         # seeds amrita.mandal / Astra@2026

# 3) in a THIRD terminal — run the web app  (apps/web/.env.local has VITE_USE_EMULATORS=true)
cd apps/web
& "$node\npm.cmd" run dev          # http://localhost:5173  → log in
```

**Cloud alternative (no Java):** enable **Blaze** on `astra-voice-training`, then `firebase deploy` (functions + rules + hosting) and seed via a one-time bootstrap. Ask Claude to wire this path.

## Status
- **Phase 0:** ✅ done. **Phase 1 (auth/RBAC):** backend + login UI built, typechecks/builds green; live login e2e pending a local JVM (or Blaze deploy). See [`Context.md`](./Context.md).
