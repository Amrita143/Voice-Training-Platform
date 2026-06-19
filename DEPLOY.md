# Deploying AVTP with CI/CD

After this is set up, **`git push` to `main` redeploys the whole app automatically.**

## What gets deployed (two independent pipelines, both triggered by a push)

| Piece | Where | How |
|---|---|---|
| **Web app** (`apps/web`) + **Firestore rules** | Firebase Hosting | **GitHub Actions** (`.github/workflows/deploy.yml`) |
| **xAI proxy** (`server/`) — mints tokens, proxies search | **Railway** (Node service) | Railway auto-deploy from the same repo (`server/railway.json`) |

> The proxy must be hosted for voice to work on the live site for everyone. On the
> Spark plan there are no Cloud Functions, so we use a tiny external Node host (Railway).
> The browser only ever gets short-lived ephemeral tokens — the **xAI key stays on the proxy**.

---

## One-time setup

### 1. Put the repo on GitHub
```bash
cd astra-voice-training-platform
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<you>/astra-voice-training-platform.git
git push -u origin main
```
Secrets are safe: `.gitignore` excludes `server/.env`, `apps/web/.env.local`, and any
service-account JSON. The committed `apps/web/.env.production` holds only the **public**
Firebase web config (not a secret).

### 2. Give GitHub Actions permission to deploy to Firebase
The workflow accepts **either** secret below — pick one.

> Note: `firebase init hosting:github` tries to auto-create a service account via the
> GCP IAM API and can fail with `Service account ... does not exist` (404) when the
> IAM API isn't enabled / you can't create SAs. Use one of these instead:

**Option A — CI token (simplest, no IAM/service account):**
```bash
npx -y firebase-tools@latest login:ci
```
Authorize in the browser; it prints a token. In GitHub: repo **Settings → Secrets and
variables → Actions → New repository secret**, name **`FIREBASE_TOKEN`**, paste the token.

**Option B — Service account (more "proper", not deprecated):**
1. Google Cloud Console → **IAM & Admin → Service Accounts** (project `astra-voice-training`)
   → **Create service account** (e.g. `github-deployer`).
2. Grant it the **Firebase Admin** role (`roles/firebase.admin` — covers hosting + rules).
   If a deploy later complains about a missing permission, also add **Service Usage Consumer**.
3. Open the SA → **Keys → Add key → JSON** → download.
4. GitHub repo secret named **`FIREBASE_SERVICE_ACCOUNT`** = the entire JSON.

(If `init hosting:github` had already written its own `.github/workflows/firebase-*.yml`,
delete it so only `deploy.yml` runs.)

Done — push to `main` now builds and deploys the web app + rules.

### 3. Host the xAI proxy on Railway
1. Sign in at railway.com with GitHub.
2. **New Project → Deploy from GitHub repo** → pick `Voice-Training-Platform`.
3. Open the service → **Settings → Source** → set **Root Directory = `server`**
   (the repo is a monorepo; this points Railway at the proxy). It picks up
   `server/railway.json` (start `node index.mjs`, health check `/health`).
4. **Settings → Variables** → add:
   - `XAI_API_KEY` = your xAI key (from `server/.env`)
   - `GCLOUD_PROJECT` = `astra-voice-training`
   (Railway injects `PORT` automatically; the proxy reads it.)
5. **Settings → Networking → Generate Domain** → you get a public URL, e.g.
   `https://voice-training-platform-production.up.railway.app`.
   Check it: open `<that-url>/health` → `{"ok":true,...}`.

### 4. Point the live site at the hosted proxy
Edit `apps/web/.env.production`:
```
VITE_API_BASE=https://<your-railway-domain>.up.railway.app
```
Commit + push → GitHub Actions rebuilds the web app against the hosted proxy.

---

## Day-to-day

Just commit and push:
```bash
git add -A && git commit -m "…" && git push
```
- **Web/rules** → GitHub Actions builds + deploys to `https://astra-voice-training.web.app`.
- **Proxy** (`server/` changes) → Render auto-redeploys.

Watch runs under the repo's **Actions** tab and in the Render dashboard.

---

## Notes & gotchas
- **Railway** doesn't sleep, so there's no cold-start delay before voice (good for
  this app). It's usage-based on the ~$5/mo Hobby plan (no permanent free tier).
  Railway auto-redeploys the proxy on every push that touches `server/`. Alternatives:
  Render (free tier but sleeps), Fly.io, or Cloud Run (needs Blaze billing).
- **Manual deploy still works** any time (no CI): from the repo root
  `npm run build:shared && npm run build:web` then
  `npx -y firebase-tools@latest deploy --only hosting,firestore:rules --project astra-voice-training`.
- **Don't commit secrets.** `server/.env` (xAI key) and `apps/web/.env.local` are
  git-ignored; set those values in Render / locally only.
- **Indexes:** if you ever add composite Firestore indexes, add `firestore:indexes`
  to the deploy `--only` list in the workflow.
