# PROMPT_LOG.md

## [2026-08-20 17:31] Config: Production base URL bot.vughy.com

- **Prompt Provided:** update the base url to bot.vughy.com
- **Architectural Flow:** Vite/API env → `https://bot.vughy.com`; nginx proxies `/api` to API container so one host serves UI + API
- **Impacted Files:** `PROMPT_LOG.md`, `frontend/.env.production`, `backend/.env.production`, `deploy/.env.example`, `deploy/docker-compose.yml`, `deploy/nginx.conf`

## [2026-08-20 17:23] Feature: Agent memory + VPS worker deploy

- **Impacted Files:** agent memory, deploy Compose on VPS
