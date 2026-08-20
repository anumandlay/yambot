# PROMPT_LOG.md

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
