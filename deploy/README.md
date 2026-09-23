# VPS deploy notes

## One-command install (new VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/anumandlay/yambot/experiment/install.sh | bash -s -- \
  --domain bot.example.com \
  --email you@example.com
```

IP-only (no HTTPS): omit `--domain` → `http://YOUR_IP:8080`.

## Stack
- `docker compose` in `deploy/`: Mongo + API (:4010) + Web (:80/:8080) + **computer-manager**
- `computer-manager` watches Mongo and auto-starts one Playwright Chromium container per cloud agent
- Live screen + **Take control** (click/type) on the website dashboard

## First-time on Ubuntu VPS
```bash
sudo apt update && sudo apt install -y git docker.io docker-compose-v2
sudo usermod -aG docker $USER
# re-login
# From your laptop (preferred): python deploy/remote-deploy.py
# Then restore public HTTPS (host Caddy owns :80/:443 → docker :8080):
python deploy/restore-host-caddy.py
```

Caddyfile template: `deploy/Caddyfile.host` (`bot.vughy.com` → `127.0.0.1:8080`). Without host Caddy, only raw ports `:8080` / `:4010` work — the public URL will not open.

## After code push
```bash
cd ~/yambot && git pull
cd deploy && docker compose up -d --build
```

## How agent computers work
1. Create an agent on the website (default runner = **cloud**)
2. API stores a worker token + `computer.desired=running`
3. `computer-manager` creates `yambot-agent-<id>` from `yambot-worker:local` (Playwright Chromium on Xvfb)
4. Worker logs in with the token, streams screenshots, claims that agent’s tasks
5. Dashboard → Live screen → enable **Take control** to click/type (captchas, recovery)

**CUA (website agents):** Same Playwright box. Chat “using cua” (or `/cua`) sets `computerUseMode=cua`. Otherwise `auto` — after **2** failed recoverable locator attempts the worker activates CUA (cua-driver MCP + SOM/element clicks when AT-SPI is up, Playwright vision fallback). Worker entrypoint starts a D-Bus session + AT-SPI bus; Chrome launches with `--force-renderer-accessibility`. Full XFCE images are not used for this path.

RAM: Playwright boxes ~3 GB limit each.

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
