# PROMPT_LOG.md

## [2026-08-20 18:41] Fix: Blank live screen on about:blank

- **Prompt Provided:** i can see only blank screen
- **Architectural Flow:** Worker boot navigates off `about:blank` to Google (or `YAMBOT_START_URL`) before first screenshot heartbeat
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-20 18:29] Fix: Cloud screen stuck on “Provisioning…”

- **Prompt Provided:** provisioning cloud computer… but cannot see the screen
- **Architectural Flow:** Pin Playwright `1.54.2` to match Docker image browsers; manager recreates containers when start fails (stale network after compose recreate)
- **Impacted Files:** `PROMPT_LOG.md`, `worker/package.json`, `computer-manager/src/index.js`, LiveScreen error surfacing

## [2026-08-20 18:21] Config: Default Minimax LLM settings (server-side)

- **Prompt Provided:** Set LLM API key / MiniMax-M2.7 / https://api.minimax.io/v1 permanently in settings
- **Architectural Flow:** Server `DEFAULT_LLM_*` in deploy `.env` (not git) → API boot seeds all users’ encrypted settings → Settings UI + workers read from Mongo
- **Impacted Files:** `PROMPT_LOG.md`, `backend` env/User/settings/seed, frontend defaults, `deploy/remote-deploy.py`, `.env.example`, gitignored local deploy secrets

## [2026-08-20 18:01] Ops: Always VPS-deploy after git push

- **Prompt Provided:** always deploy on server for each git push; is chrome extension already installed?
- **Architectural Flow:** `deploy/remote-deploy.py` + `.cursorrules` mandate post-push VPS rebuild; cloud boxes use Playwright Chromium (no MV3 extension inside Docker); laptop extension remains optional manual install
- **Impacted Files:** `PROMPT_LOG.md`, `.cursorrules`, `deploy/remote-deploy.py`, `deploy/.deploy.local.env.example`, `.gitignore`

## [2026-08-20 17:53] Feature: Auto-provision cloud computers + interactive live control

- **Prompt Provided:** Auto-create VPS/container on new agent; live screen; interact to fix captchas etc.
- **Architectural Flow:** Agent create (default `runner=cloud`) → worker token + `computer.desired=running` → `computer-manager` (Docker sock) starts `yambot-worker` container → worker token-login + screenshot heartbeat → dashboard LiveScreen click/type → control queue drained by worker Playwright
- **Impacted Files:** Agent model, auth worker-login, agents control + manager routes, `computer-manager/`, worker login/control, LiveScreen interactive UI, docker-compose, PROMPT_LOG

## [2026-08-20 17:47] Feature: Live agent screen on dashboard + clarify cloud computer lifecycle

- **Prompt Provided:** Creating an agent should get own computer+Chrome+extension; also watch live screen from dashboard
- **Architectural Flow:** Clarify create≠auto-provision; worker heartbeats + JPEG screenshots → Agent.liveScreen → dashboard poll `/api/agents/:id/live`; chat UI shows live pane
- **Impacted Files:** `PROMPT_LOG.md`, Agent model, extension heartbeat route, worker screenshot loop, `LiveScreen` UI, Agent/Chat pages

## [2026-08-20 17:35] Feature: Own computer + Chrome per agent (cloud worker)

- **Prompt Provided:** “Own computer + Chrome per agent” — lets do this
- **Architectural Flow:** Agent `runner` (extension|cloud|any) → Task `runner` at enqueue → claim API filters by `agentId` + `claimAs` → Playwright worker with persistent Chromium profile polls only its agent → Compose `worker` service (one container ≈ one agent computer)
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent/Task/extension/agents/chats, `extension` poller, `worker/*`, `deploy/docker-compose*.yml`, `deploy/Dockerfile.worker`, `frontend` Agents UI, `README`/`deploy/README`

## [2026-08-20 17:31] Config: Production base URL bot.vughy.com

- **Prompt Provided:** update the base url to bot.vughy.com
- **Architectural Flow:** Vite/API env → `https://bot.vughy.com`; nginx proxies `/api` to API container so one host serves UI + API
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/.env.production`, `backend/.env.production`, `deploy/.env.example`, `deploy/docker-compose.yml`, `deploy/nginx.conf`

## [2026-08-20 17:23] Feature: Agent memory + VPS worker deploy

- **Impacted Files:** agent memory, deploy Compose on VPS
