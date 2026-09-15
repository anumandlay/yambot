#!/usr/bin/env python3
"""
@fileoverview Reinstall host Caddy and restore bot.vughy.com TLS after a VPS wipe.
Purpose: YamBot docker only binds :8080/:4010; public HTTPS needs host Caddy on :80/:443.
Inputs: deploy/.deploy.local.env (SSH), deploy/Caddyfile.host
Downstream: https://bot.vughy.com
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_ENV = ROOT / "deploy" / ".deploy.local.env"
CADDYFILE_SRC = ROOT / "deploy" / "Caddyfile.host"


def load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        if key.strip() and key.strip() not in os.environ:
            os.environ[key.strip()] = val.strip().strip("'").strip('"')


def main() -> int:
    load_dotenv_file(DEPLOY_ENV)
    password = os.environ.get("YAMBOT_SSH_PASSWORD", "")
    if not password:
        print("Missing YAMBOT_SSH_PASSWORD", file=sys.stderr)
        return 1
    if not CADDYFILE_SRC.is_file():
        print(f"Missing {CADDYFILE_SRC}", file=sys.stderr)
        return 1

    host = os.environ.get("YAMBOT_SSH_HOST", "15.204.242.239")
    user = os.environ.get("YAMBOT_SSH_USER", "ubuntu")
    caddyfile = CADDYFILE_SRC.read_text(encoding="utf-8")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host,
        username=user,
        password=password,
        timeout=45,
        allow_agent=False,
        look_for_keys=False,
    )

    def run(cmd: str, timeout: int = 900) -> tuple[int, str]:
        print(f"$ {cmd[:200]}")
        _, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
        text = (stdout.read() + stderr.read()).decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        print(text[-12000:])
        return code, text

    sudo = f"echo '{password}' | sudo -S bash -lc"

    code, _ = run(
        f"{sudo} '"
        "set -e; "
        "export DEBIAN_FRONTEND=noninteractive; "
        "if ! command -v caddy >/dev/null 2>&1; then "
        "  apt-get update -y; "
        "  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl; "
        "  curl -1sLf \"https://dl.cloudsmith.io/public/caddy/stable/gpg.key\" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg; "
        "  curl -1sLf \"https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt\" | tee /etc/apt/sources.list.d/caddy-stable.list; "
        "  apt-get update -y; "
        "  apt-get install -y caddy; "
        "fi; "
        "caddy version; "
        "id caddy || useradd --system --home /var/lib/caddy --shell /usr/sbin/nologin caddy; "
        "mkdir -p /etc/caddy /var/lib/caddy; "
        "chown -R caddy:caddy /var/lib/caddy"
        "'",
        timeout=900,
    )
    if code != 0:
        print("Caddy install failed", file=sys.stderr)
        client.close()
        return 1

    sftp = client.open_sftp()
    tmp = "/home/ubuntu/Caddyfile.yambot"
    with sftp.file(tmp, "w") as f:
        f.write(caddyfile)
    sftp.close()

    run(
        f"{sudo} 'install -o root -g root -m 644 /home/ubuntu/Caddyfile.yambot /etc/caddy/Caddyfile "
        "&& rm -f /home/ubuntu/Caddyfile.yambot && caddy validate --config /etc/caddy/Caddyfile'"
    )
    run(
        f"{sudo} 'systemctl enable caddy; systemctl restart caddy; sleep 3; "
        "systemctl is-active caddy; ss -lntp | grep -E \":(80|443)\\b\" || true'"
    )
    run(
        "sleep 4; "
        "curl -sS -m 20 https://bot.vughy.com/api/health; echo; "
        "curl -sS -m 20 -o /dev/null -w 'https_bot:%{http_code}\\n' https://bot.vughy.com/"
    )
    client.close()
    print("HOST CADDY OK — https://bot.vughy.com")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
