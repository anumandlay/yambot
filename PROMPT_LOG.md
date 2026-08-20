# PROMPT_LOG.md

## [2026-08-20 17:23] Feature: Agent memory + VPS worker deploy

- **Prompt Provided:** Need both agent memory and per-agent Chrome boxes on VPS; use provided server password for deploy (user will rotate later)
- **Architectural Flow:** Agent.memory in Mongo → API/UI + prompt injection; VPS Docker Compose (API/web/mongo + browser worker template per agent)
- **Impacted Files:** `PROMPT_LOG.md`, `backend/src/models/Agent.js`, `backend/src/routes/agents.js`, `backend/src/routes/extension.js`, `frontend/src/pages/AgentEditPage.jsx`, `extension/background/agent.js`, `deploy/**`

## [2026-08-20 17:01] Feature: Multi-agent profiles

- **Impacted Files:** agents CRUD, chats bind agent, extension snapshot prompt
