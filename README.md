# YamBot

Web control plane + Chrome browser agent.

- **Frontend:** React 19.2.8, Vite 6, React Router 7, Tailwind CSS 4  
- **Backend:** Node.js 24 (ESM), Express, MongoDB/Mongoose  
- **Extension:** Chrome MV3 worker that executes goals on real tabs  

## Architecture

```
Website (login → chats → goals → live results / Settings for LLM)
        │
        ▼
Express API + MongoDB
        │
        ▼
Chrome extension (polls tasks, uses server LLM settings, reports events)
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

### 4. Extension
1. `chrome://extensions` → Load unpacked → `extension/`
2. Website: register/login → **Settings** → save LLM key  
3. Chats → **Copy login token**  
4. Extension Settings → API `http://localhost:4000` + paste token → Save  
5. Send a goal in a chat; keep Chrome open

## Env files (local vs production)

| File | Purpose |
|------|---------|
| `backend/.env.development` | Local API config |
| `backend/.env.production` | Non-secret production defaults (committed) |
| `backend/.env` (untracked on server) | Production secrets overlay (`MONGODB_URI`, `JWT_SECRET`, …) |
| `frontend/.env.development` | `VITE_API_BASE_URL=http://localhost:4000` |
| `frontend/.env.production` | Production API base URL for builds |

Replace `YOUR_PRODUCTION_API_HOST` / `YOUR_PRODUCTION_WEB_HOST` with your real URLs, then push. On the server: pull, keep secret `.env`, rebuild frontend, restart API.

## Production pull-deploy

```bash
git pull
cd backend && npm install && npm run start:prod
cd frontend && npm install && npm run build
# serve frontend/dist behind nginx / CDN
```

## Repo

https://github.com/anumandlay/yambot.git
