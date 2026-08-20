# VPS deploy notes

## Stack
- `docker compose` in `deploy/`: Mongo + API (:4000) + Web (:80)
- Agent memory is in Mongo (`agents.memory`)
- Per-agent Chrome boxes: duplicate worker services later (RAM-heavy)

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

## Security
Rotate the SSH password used during bootstrap. Prefer SSH keys.
