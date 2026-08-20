# PROMPT_LOG.md

## [2026-08-20 16:12] Fix: Remove dynamic import() in service worker

- **Prompt Provided:** Failed to sync progress — import() is disallowed on ServiceWorkerGlobalScope
- **Architectural Flow:** agent.js uses static `import { extensionApi } from "./api.js"` instead of dynamic import()
- **Impacted Files:** `PROMPT_LOG.md`, `extension/background/agent.js`

## [2026-08-20 16:08] Fix: Cloud task claimed but agent idle

- **Prompt Provided:** Claimed cloud task but nothing happening
- **Impacted Files:** `extension/background/*`, `backend/src/routes/extension.js`

## [2026-08-20 16:03] Fix: Allow Chrome extension CORS origins

- **Prompt Provided:** CORS blocked for chrome-extension origin
- **Impacted Files:** `backend/src/index.js`

## [2026-08-20 15:54] Feature: Extension email/password login

- **Prompt Provided:** Use login instead of JWT paste
- **Impacted Files:** `extension/**`, `frontend/src/pages/ChatsPage.jsx`

## [2026-08-20 15:40] Feature: YamBot monorepo scaffold + web control plane

- **Prompt Provided:** Full stack YamBot scaffold
- **Impacted Files:** monorepo root
