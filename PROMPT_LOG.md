# PROMPT_LOG.md

## [2026-08-20 16:08] Fix: Cloud task claimed but agent idle

- **Prompt Provided:** Claimed cloud task "get latest ai news now" but nothing happening
- **Architectural Flow:** POST claim (no cache) → lock agent → open working tab → require LLM settings → mirror start/steps/errors → fail task if start throws; reclaim stuck running tasks
- **Impacted Files:** `PROMPT_LOG.md`, `extension/background/service-worker.js`, `extension/background/agent.js`, `backend/src/routes/extension.js`

## [2026-08-20 16:03] Fix: Allow Chrome extension CORS origins

- **Prompt Provided:** CORS blocked for origin chrome-extension://…
- **Architectural Flow:** Express CORS allows `chrome-extension://*`
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/index.js`

## [2026-08-20 15:54] Feature: Extension email/password login

- **Prompt Provided:** Use login instead of JWT paste in extension
- **Impacted Files:** `extension/**`, `frontend/src/pages/ChatsPage.jsx`

## [2026-08-20 15:40] Feature: YamBot monorepo scaffold + web control plane

- **Prompt Provided:** Full stack YamBot scaffold
- **Impacted Files:** monorepo root
