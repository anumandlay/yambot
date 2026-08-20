# PROMPT_LOG.md

## [2026-08-20 17:01] Feature: Multi-agent profiles (create from website)

- **Prompt Provided:** Create agents from the page — each with profile, skill, instructions; also facts, autonomy, success criteria; wire into chats + Chrome execution
- **Architectural Flow:** React Agents UI → Express `/api/agents` + Chat.agentId → Task includes agent snapshot → extension injects agent config into LLM system prompt
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Agent.js`, `backend/src/routes/agents.js`, `backend/src/routes/chats.js`, `backend/src/routes/extension.js`, `backend/src/models/Task.js`, `backend/src/index.js`, `frontend/src/**`, `extension/background/agent.js`

## [2026-08-20 16:15] Change: Auto-click without typing yes

- **Impacted Files:** extension + settings defaults

## [2026-08-20 16:12] Fix: Remove dynamic import() in service worker

- **Impacted Files:** `extension/background/agent.js`
