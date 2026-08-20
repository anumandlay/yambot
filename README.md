# YamBot

Web control plane + browser agents (Chrome extension and/or always-on cloud Chromium per agent).

- **Frontend:** React 19.2.8, Vite 6, React Router 7, Tailwind CSS 4  
- **Backend:** Node.js 24 (ESM), Express, MongoDB/Mongoose  
- **Extension:** Chrome MV3 worker on your laptop  
- **Cloud worker:** Playwright Chromium with a persistent profile (one container ≈ one agent “computer”)  

## Architecture

```
Website (login → agents → chats → goals → live results / Settings)
        │
        ▼
Express API + MongoDB  (tasks tagged runner: extension|cloud|any)
        │
        ├── Chrome extension (claimAs=extension)
        └── Cloud workers     (claimAs=cloud + agentId; persistent browser profile)
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

### 4. Extension (laptop runner)
1. `chrome://extensions` → Load unpacked → `extension/`
2. Website: register/login → **Settings** → save LLM key  
3. Agents → set runner to **My Chrome** or **Any**  
4. Extension Settings → API `http://localhost:4000` + login  
5. Send a goal in a chat; keep Chrome open

### 5. Cloud computers (auto on VPS)
On production Compose, `computer-manager` starts a Chromium box when you create an agent
(default runner = cloud). Locally you can still run `worker/` manually with
`YAMBOT_WORKER_TOKEN` from a recreated agent, or point at the VPS API.

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
