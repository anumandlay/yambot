# PROMPT_LOG.md

## [2026-08-21 00:22] Feature: Multi-strategy element locators

- **Prompt Provided:** Use advanced targeting (option 1): ref → role+name → label → CSS → XPath
- **Architectural Flow:** Snapshot adds role/cssHint; click/type/select resolve via fallback chain in worker pageDom + extension content; LLM schema documents optional locators
- **Impacted Files:** `PROMPT_LOG.md`, `worker` actions/pageDom/agent, `extension` shared/actions + content + background/agent

## [2026-08-21 00:13] UI: Sticky mobile dock + Stop agent

- **Prompt Provided:** instruction box and live screen sticky at bottom on mobile; Stop button to stop the agent
- **Architectural Flow:** ChatDetail sticky bottom dock (LiveScreen + goal); POST `/api/chats/:id/stop` cancels active tasks; worker checks cancelled each step and exits
- **Impacted Files:** `PROMPT_LOG.md`, `frontend` ChatDetailPage + LiveScreen compact, `backend` chats/extension, `worker/src/agent.js`

## [2026-08-20 20:58] Fix: JSON parse still failing + stale worker boxes

- **Prompt Provided:** still got the same unexpected non-whitespace character after JSON error
- **Architectural Flow:** Lenient JSON parse (slice at error position); LLM HTTP body also lenient; computer-manager recreates agent containers when worker image Id changes so fixes actually load
- **Impacted Files:** `PROMPT_LOG.md`, `worker` actions/llm/agent, `extension` shared/actions + llm, `computer-manager/src/index.js`

## [2026-08-20 20:50] Fix: Agent stops on JSON parse trailing characters

- **Prompt Provided:** unexpected non-whitespace character after JSON; agent stops working
- **Architectural Flow:** Balanced first-object JSON extract (ignore trailing prose); normalize multimodal LLM content; on parse failure wait+retry instead of aborting the task
- **Impacted Files:** `PROMPT_LOG.md`, `worker` actions/llm/agent, `extension` shared/actions + llm + agent

## [2026-08-20 19:41] Feature: Per-agent SMTP email identity

- **Prompt Provided:** give SMTP email to the agent on create/edit so agent uses email as a human
- **Architectural Flow:** Agent.email (encrypted SMTP + IMAP) → dashboard form + test send → workers call `/api/extension/email/send|check` → LLM actions `send_email` / `check_email`
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model/routes/agentEmail/extension, `frontend` AgentEdit/AgentsPage, worker + extension actions/agent loops, `backend/package.json`

## [2026-08-20 19:33] Feature: Free-text skill + per-agent scheduler

- **Prompt Provided:** scheduler for every agent; remove skill dropdown — write skill in a textbox
- **Architectural Flow:** Agent.skill is free text; Agent.schedule (enabled/goal/interval/dailyAt) → API `startAgentScheduler` ticks → enqueues Task into “Schedule · {name}” chat; skips if agent busy
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model/routes/scheduler/index, `frontend` AgentEditPage/AgentsPage, worker + extension skill prompt

## [2026-08-20 19:19] Feature: Delete agent + System containers/CPU page

- **Prompt Provided:** option to delete agent; page listing all containers + system processor charts
- **Architectural Flow:** Agents list Delete → API stops container via computer-manager then removes Mongo doc; `/system` polls `/api/system/overview` → manager Docker inventory + CPU/mem charts
- **Impacted Files:** `PROMPT_LOG.md`, `computer-manager` httpApi, `backend` system routes + agents delete, `frontend` SystemPage/AgentsPage/App/AppHeader, `deploy/docker-compose.yml`

## [2026-08-20 19:12] Config: Remove max steps — agents run unlimited

- **Prompt Provided:** remove max steps; agent can work unlimited
- **Architectural Flow:** Cloud worker + extension loops until `finish`/abort (no step ceiling); Max steps removed from Settings/Agent UI/sidepanel; prompts say unlimited
- **Impacted Files:** `PROMPT_LOG.md`, `worker/src/agent.js`, `extension/background/agent.js`, `extension/sidepanel/*`, `frontend` Settings + AgentEdit, `backend` Agent/User/settings/agents/extension

## [2026-08-20 19:09] Fix: Mobile page scroll for chat history

- **Prompt Provided:** on mobile cannot scroll up to see chat history; keep page scroller
- **Architectural Flow:** Chat messages expand in document flow (no nested max-height box); auto-scroll only after user send, not on poll
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`

## [2026-08-20 18:56] Feature: Human mouse/keyboard takeover + give control back

- **Prompt Provided:** use mouse and keyboard on live computer for captcha etc., then give control back to the agent
- **Architectural Flow:** Dashboard Take control → `computer.humanControl` → worker pauses LLM loop / skips claims while still applying click/key/scroll queue; Give control back clears flag and agent resumes
- **Impacted Files:** `PROMPT_LOG.md`, `backend` Agent model + agents/control + extension heartbeat, `worker` agent/index, `frontend/src/components/LiveScreen.jsx`

## [2026-08-20 18:50] UI: Live screen above goal + fullscreen zoom

- **Prompt Provided:** live screen above goal/instructions textbox; zoom in for full size
- **Architectural Flow:** Chat detail single column — messages → LiveScreen → goal form; LiveScreen `Zoom in` toggles fixed fullscreen (Esc to exit)
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/src/pages/ChatDetailPage.jsx`, `frontend/src/components/LiveScreen.jsx`

## [2026-08-20 18:44] UI: Mobile-responsive dashboard pass

- **Prompt Provided:** make the webpage responsive
- **Architectural Flow:** Mobile-first padding/stacking; sticky scrollable nav; chat shows live screen first on small screens; 44px touch targets; overflow-x + safe-area
- **Impacted Files:** `PROMPT_LOG.md`, `frontend` AppHeader, ChatDetail, LiveScreen, Chats/Agents/Settings/Login/Register, `index.css`, `index.html`

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
