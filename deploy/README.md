# VPS deploy notes

## Stack
- `docker compose` in `deploy/`: Mongo + API (:4010) + Web (:80/:8080)
- Agent memory is in Mongo (`agents.memory`)
- **Per-agent cloud computers:** Playwright Chromium workers (`worker/` + `docker-compose.workers.yml`)

## First-time on Ubuntu VPS
```bash
sudo apt update && sudo apt install -y git docker.io docker-compose-v2
sudo usermod -aG docker $USER
# re-login
git clone https://github.com/anumandlay/yambot.git
cd yambot/deploy
cp .env.example .env
# edit .env secrets
docker compose up -d --build
```

## After code push
```bash
cd ~/yambot && git pull
cd deploy && docker compose up -d --build
```

## Own computer per agent (cloud worker)

Each cloud agent gets:
1. `runner: cloud` on the Agents page
2. One Docker worker with that agent's ID + a **persistent Chromium profile volume** (cookies/login state stay on that box)

```bash
# On the website: Agents → edit → Computer = Cloud computer → copy Agent ID
# In deploy/.env:
#   YAMBOT_API_BASE_URL=http://api:4000
#   YAMBOT_EMAIL=you@example.com
#   YAMBOT_PASSWORD=...
#   YAMBOT_AGENT_ID=<paste agent id>
#   YAMBOT_WORKER_NAME=research-bot

cd ~/yambot/deploy
docker compose -f docker-compose.yml -f docker-compose.workers.yml --profile workers up -d --build
```

Duplicate the `worker-agent-1` service in `docker-compose.workers.yml` for more agents (unique service name, volume, and `YAMBOT_AGENT_ID`). Budget ~1–1.5 GB RAM per Chromium.

Local worker without Docker:
```bash
cd worker && npm install && npx playwright install chromium
export YAMBOT_API_BASE_URL=http://localhost:4000
export YAMBOT_EMAIL=... YAMBOT_PASSWORD=... YAMBOT_AGENT_ID=...
export YAMBOT_PROFILE_DIR=./.profiles/agent1
npm start
```

## Security
Rotate the SSH password used during bootstrap. Prefer SSH keys.
Never commit real `YAMBOT_PASSWORD` values.
