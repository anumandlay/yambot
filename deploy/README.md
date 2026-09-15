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
3. `computer-manager` creates `yambot-agent-<id>` from `yambot-worker:local` (Playwright) or `yambot-cua:local` (Cua XFCE) based on `computer.engine`
4. Worker logs in with the token, streams screenshots, claims that agent’s tasks
5. Dashboard → Live screen → enable **Take control** to click/type (captchas, recovery)

RAM: Playwright boxes ~3 GB limit each. Cua boxes ~4 GB — enable on **one or two** agents only on the current VPS. Existing agents stay on Playwright unless you change **Desktop engine** on the agent page.

Cua is a per-agent YamBot container, not the shared OpenMausBot `openmausbot-computer` VM. The LLM still drives Chrome with Playwright; cua-driver MCP is not wired yet.

## Manual worker (optional override)
See `docker-compose.workers.yml` / `worker/` if you need a one-off box without the manager.

## OpenMausBot sidecar (same VPS, not Docker)

Installed next to YamBot so we can compare the two products. It does **not** bind :80/:443 (those stay with host Caddy for `bot.vughy.com`).

- Service user: `maus` (`~/.openmausbot`)
- systemd: `openmausbot.service` → loopback `127.0.0.1:8799` (webhooks `:8800`)
- Public URL: `https://open.vughy.com` (old sslip.io URL 301s here)
- Sign-in: emailed code for `anumandlayamunesh007@gmail.com`, or `sudo -iu maus openmausbot pair`
- Official `serve --tunnel` (`https://c-….openmausbot.com`) failed: control plane signed in but issued no public address
- Caddy `admin off` means `systemctl reload caddy` fails; after Caddyfile edits use `sudo systemctl restart caddy`
- Preserve the `open.vughy.com` site block in `/etc/caddy/Caddyfile` across YamBot deploys

```bash
sudo systemctl status openmausbot
sudo journalctl -u openmausbot -f
curl -s https://open.vughy.com/api/health
```

## Security
- `computer-manager` mounts the Docker socket (powerful) — keep the VPS locked down
- Rotate SSH passwords; prefer SSH keys
- Never commit real secrets in `.env`
