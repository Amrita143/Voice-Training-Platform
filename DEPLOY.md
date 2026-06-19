# Deploying AVTP with CI/CD

After this is set up, **`git push` to `main` redeploys the whole app automatically.**

## What gets deployed (two independent pipelines, both triggered by a push)

| Piece | Where | How |
|---|---|---|
| **Web app** (`apps/web`) + **Firestore rules** | Firebase Hosting | **GitHub Actions** (`.github/workflows/deploy.yml`) |
| **xAI proxy** (`server/`) — mints tokens, proxies search | A Node host (**Render** free tier) | Render auto-deploy from the same repo |

> The proxy must be hosted for voice to work on the live site for everyone. On the
> Spark plan there are no Cloud Functions, so we use a tiny external Node host.
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
Easiest (auto-creates a correctly-scoped service account + the GitHub secret):
```bash
# from the repo root, using the standalone Node 22 npx:
npx -y firebase-tools@latest init hosting:github
```
- Choose the existing repo, **don't** overwrite the workflow we ship.
- It creates a service account and stores it as a repo secret. **Rename that secret
  (or copy its value) to `FIREBASE_SERVICE_ACCOUNT`** — that's the name our workflow reads.

Manual alternative: Firebase Console → ⚙ Project settings → **Service accounts** →
**Generate new private key** → in GitHub: repo **Settings → Secrets and variables →
Actions → New repository secret**, name `FIREBASE_SERVICE_ACCOUNT`, paste the whole JSON.
(The SA needs Firebase Hosting Admin + Cloud Datastore/Firestore roles; the
`init hosting:github` path sets these for you.)

Done — push to `main` now builds and deploys the web app + rules.

### 3. Host the xAI proxy on Render
1. Create a free account at render.com and connect your GitHub.
2. **New → Blueprint** → pick this repo. It reads `render.yaml` and creates the
   `avtp-xai-proxy` web service (root dir `server/`, start `node index.mjs`).
3. In the service's **Environment**, set **`XAI_API_KEY`** (the value from `server/.env`).
   `GCLOUD_PROJECT` is already set by the blueprint. (Render injects `PORT` automatically.)
4. Deploy. Note the URL, e.g. `https://avtp-xai-proxy.onrender.com`. Check it:
   `https://avtp-xai-proxy.onrender.com/health` → `{"ok":true,...}`.

### 4. Point the live site at the hosted proxy
Edit `apps/web/.env.production`:
```
VITE_API_BASE=https://avtp-xai-proxy.onrender.com
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
- **Render free tier sleeps** after ~15 min idle → the first "Start" after a quiet
  period waits ~30–60s while it wakes. Upgrade to a paid instance (or add an
  uptime pinger hitting `/health`) if that matters. Alternatives: Railway, Fly.io,
  or Cloud Run (Cloud Run needs Blaze billing).
- **Manual deploy still works** any time (no CI): from the repo root
  `npm run build:shared && npm run build:web` then
  `npx -y firebase-tools@latest deploy --only hosting,firestore:rules --project astra-voice-training`.
- **Don't commit secrets.** `server/.env` (xAI key) and `apps/web/.env.local` are
  git-ignored; set those values in Render / locally only.
- **Indexes:** if you ever add composite Firestore indexes, add `firestore:indexes`
  to the deploy `--only` list in the workflow.
