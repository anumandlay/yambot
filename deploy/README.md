# VPS deploy notes

## Stack
- `docker compose` in `deploy/`: Mongo + API (:4010) + Web (:80/:8080) + **computer-manager**
- `computer-manager` watches Mongo and auto-starts one Playwright Chromium container per cloud agent
- Live screen + **Take control** (click/type) on the website dashboard

## First-time on Ubuntu VPS
```bash
sudo apt update && sudo apt install -y git docker.io docker-compose-v2
sudo usermod -aG docker $USER
# re-login
git clone https://github.com/anumandlay/yambot.git
cd yambot/deploy
cp .env.example .env
# edit .env secrets (JWT_SECRET, SETTINGS_CRYPTO_KEY)
docker compose up -d --build
```

## After code push
```bash
cd ~/yambot && git pull
cd deploy && docker compose up -d --build
```

## How agent computers work
1. Create an agent on the website (default runner = **cloud**)
2. API stores a worker token + `computer.desired=running`
3. `computer-manager` creates `yambot-agent-<id>` from image `yambot-worker:local`
4. Worker logs in with the token, streams screenshots, claims that agent’s tasks
5. Dashboard → Live screen → enable **Take control** to click/type (captchas, recovery)

RAM: budget ~1–1.5 GB per agent box.

## Manual worker (optional override)
See `docker-compose.workers.yml` / `worker/` if you need a one-off box without the manager.

## Security
- `computer-manager` mounts the Docker socket (powerful) — keep the VPS locked down
- Rotate SSH passwords; prefer SSH keys
- Never commit real secrets in `.env`
