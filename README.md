# YamBot

Web control plane + cloud browser agents (always-on Chromium per agent on the VPS).

- **Frontend:** React 19.2.8, Vite 6, React Router 7, Tailwind CSS 4  
- **Backend:** Node.js 24 (ESM), Express, MongoDB/Mongoose  
- **Cloud worker:** Playwright Chromium with a persistent profile (one container ≈ one agent “computer”)  

## Architecture

```
Website (login → agents → chats → goals → live results / Settings)
        │
        ▼
Express API + MongoDB
        │
        └── Cloud workers (Playwright + persistent browser profile per agent)
```

## Local setup

### 1. MongoDB
Run MongoDB locally (default URI `mongodb://127.0.0.1:27017/yambot`).

### 2. Backend
```bash
cd backend
npm install
npm run dev
```
API: http://localhost:4000

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
App: http://localhost:5173

### 4. Cloud computers (auto on VPS)
On production Compose, `computer-manager` starts a Chromium box when you create an agent.
Locally you can run `worker/` manually with `YAMBOT_WORKER_TOKEN` from a recreated agent,
or point at the VPS API.

See `deploy/README.md`.

## Env files (local vs production)

| File | Purpose |
|------|---------|
| `backend/.env.development` | Local API config |
| `backend/.env.production` | Non-secret production defaults (committed) |
| `backend/.env` (untracked on server) | Production secrets overlay (`MONGODB_URI`, `JWT_SECRET`, …) |
| `frontend/.env.development` | `VITE_API_BASE_URL=http://localhost:4000` |
| `frontend/.env.production` | Production API base URL for builds |
| `deploy/.env` (server only) | Compose secrets + worker login |

## Production pull-deploy

```bash
git pull
cd deploy && docker compose up -d --build
# optional workers:
docker compose -f docker-compose.yml -f docker-compose.workers.yml --profile workers up -d --build
```

## Repo

https://github.com/anumandlay/yambot.git
