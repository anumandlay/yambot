# PROMPT_LOG.md

## [2026-08-20 16:15] Change: Auto-click without typing yes

- **Prompt Provided:** Button clicks ask to type yes — want it done automatically
- **Architectural Flow:** `confirmBeforeSubmit` defaults to false; agent only asks when the setting is explicitly enabled
- **Impacted Files:** `PROMPT_LOG.md`, `extension/background/agent.js`, `extension/sidepanel/*`, `frontend/src/pages/SettingsPage.jsx`, `backend/src/models/User.js`, `backend/src/routes/settings.js`, `backend/src/routes/extension.js`

## [2026-08-20 16:12] Fix: Remove dynamic import() in service worker

- **Prompt Provided:** import() disallowed on ServiceWorkerGlobalScope
- **Impacted Files:** `extension/background/agent.js`

## [2026-08-20 16:08] Fix: Cloud task claimed but agent idle

- **Impacted Files:** `extension/background/*`, `backend/src/routes/extension.js`

## [2026-08-20 16:03] Fix: Allow Chrome extension CORS origins

- **Impacted Files:** `backend/src/index.js`

## [2026-08-20 15:54] Feature: Extension email/password login

- **Impacted Files:** `extension/**`, `frontend/src/pages/ChatsPage.jsx`

## [2026-08-20 15:40] Feature: YamBot monorepo scaffold + web control plane

- **Impacted Files:** monorepo root
