#!/usr/bin/env python3
"""
@fileoverview Deploy YamBot to the VPS after git push.
Purpose: Upload current tree (SCP tarball — private GitHub cannot be pulled bare)
and `docker compose up -d --build` while preserving server `deploy/.env` secrets.
Inputs: env YAMBOT_SSH_HOST, YAMBOT_SSH_USER, YAMBOT_SSH_PASSWORD
        or file deploy/.deploy.local.env (gitignored).
Downstream: VPS containers mongo/api/web/computer-manager/worker-image.
"""

from __future__ import annotations

import os
import secrets
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_ENV = ROOT / "deploy" / ".deploy.local.env"


def load_dotenv_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = val


def main() -> int:
    load_dotenv_file(DEPLOY_ENV)
    host = os.environ.get("YAMBOT_SSH_HOST", "15.204.242.239")
    user = os.environ.get("YAMBOT_SSH_USER", "ubuntu")
    password = os.environ.get("YAMBOT_SSH_PASSWORD", "")
    if not password:
        print(
            "Missing YAMBOT_SSH_PASSWORD. Create deploy/.deploy.local.env "
            "(see .deploy.local.env.example) or export the var.",
            file=sys.stderr,
        )
        return 1

    try:
        import paramiko
        from scp import SCPClient
    except ImportError:
        print("Install deps: pip install paramiko scp", file=sys.stderr)
        return 1

    exclude_dirs = {
        "node_modules",
        ".git",
        "dist",
        "coverage",
        ".profiles",
        "__pycache__",
    }

    tgz = Path(tempfile.gettempdir()) / "yambot-deploy.tgz"
    print(f"Packing {ROOT} → {tgz}")
    with tarfile.open(tgz, "w:gz") as tar:
        for path in ROOT.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT)
            parts = set(rel.parts)
            if parts & exclude_dirs:
                continue
            if any(p in exclude_dirs for p in rel.parts):
                continue
            if rel.name.endswith(".tgz"):
                continue
            tar.add(path, arcname=str(rel))

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting {user}@{host} …")
    client.connect(
        host,
        username=user,
        password=password,
        timeout=45,
        allow_agent=False,
        look_for_keys=False,
    )

    def run(cmd: str, timeout: int = 1800) -> str:
        print(f"$ {cmd[:160]}")
        _stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=True)
        out = stdout.read().decode(errors="replace")
        err = stderr.read().decode(errors="replace")
        code = stdout.channel.recv_exit_status()
        text = (out + err)[-8000:]
        print(text)
        if code != 0:
            raise RuntimeError(f"exit {code}: {cmd}")
        return out

    # Why: some VPS images only have the legacy `docker-compose` binary, not the plugin.
    compose_check = run(
        f"echo '{password}' | sudo -S bash -lc "
        "'(docker compose version >/dev/null 2>&1 && echo PLUGIN) "
        "|| (docker-compose version >/dev/null 2>&1 && echo LEGACY) "
        "|| echo NONE'"
    )
    if "PLUGIN" in compose_check:
        compose = "docker compose"
    elif "LEGACY" in compose_check:
        compose = "docker-compose"
    else:
        raise RuntimeError("Neither `docker compose` nor `docker-compose` found on VPS")
    print(f"Using compose command: {compose}")

    # Preserve secrets
    sftp = client.open_sftp()
    old_env = ""
    try:
        with sftp.file("/home/ubuntu/yambot/deploy/.env", "r") as f:
            old_env = f.read().decode()
    except OSError:
        pass

    def keep(key: str, default: str) -> str:
        for line in old_env.splitlines():
            if line.startswith(key + "="):
                return line.split("=", 1)[1]
        return default

    jwt = keep("JWT_SECRET", secrets.token_hex(32))
    crypto = keep("SETTINGS_CRYPTO_KEY", secrets.token_hex(32))
    llm_key = os.environ.get("DEFAULT_LLM_API_KEY") or keep("DEFAULT_LLM_API_KEY", "")
    llm_base = os.environ.get("DEFAULT_LLM_BASE_URL") or keep(
        "DEFAULT_LLM_BASE_URL", "https://api.minimax.io/v1"
    )
    llm_model = os.environ.get("DEFAULT_LLM_MODEL") or keep(
        "DEFAULT_LLM_MODEL", "MiniMax-M2.7"
    )
    superadmin_email = keep("SUPERADMIN_BOOTSTRAP_EMAIL", "")
    superadmin_password = keep("SUPERADMIN_BOOTSTRAP_PASSWORD", "")
    superadmin_name = keep("SUPERADMIN_BOOTSTRAP_NAME", "Platform Admin")
    superadmin_emails = keep("SUPERADMIN_EMAILS", "")
    stripe_secret = keep("STRIPE_SECRET_KEY", "")
    stripe_webhook = keep("STRIPE_WEBHOOK_SECRET", "")
    public_web_url = keep("PUBLIC_WEB_URL", "https://bot.vughy.com")
    env_body = (
        "NODE_ENV=production\n"
        "PORT=4000\n"
        "PUBLIC_API_URL=https://bot.vughy.com\n"
        "CORS_ORIGINS=https://bot.vughy.com,http://bot.vughy.com\n"
        f"JWT_SECRET={jwt}\n"
        f"SETTINGS_CRYPTO_KEY={crypto}\n"
        "JWT_EXPIRES_IN=7d\n"
        "VITE_API_BASE_URL=https://bot.vughy.com\n"
        "DOCKER_NETWORK=deploy_default\n"
        "YAMBOT_API_BASE_URL=http://api:4000\n"
        f"DEFAULT_LLM_BASE_URL={llm_base}\n"
        f"DEFAULT_LLM_MODEL={llm_model}\n"
        f"DEFAULT_LLM_API_KEY={llm_key}\n"
        f"SUPERADMIN_BOOTSTRAP_EMAIL={superadmin_email}\n"
        f"SUPERADMIN_BOOTSTRAP_PASSWORD={superadmin_password}\n"
        f"SUPERADMIN_BOOTSTRAP_NAME={superadmin_name}\n"
        f"SUPERADMIN_EMAILS={superadmin_emails}\n"
        f"STRIPE_SECRET_KEY={stripe_secret}\n"
        f"STRIPE_WEBHOOK_SECRET={stripe_webhook}\n"
        f"PUBLIC_WEB_URL={public_web_url}\n"
    )

    run("mkdir -p ~/yambot")
    # Why: upload the new tarball before `compose down` so a transfer failure
    # cannot leave production containers stopped with nothing to bring back up.
    with SCPClient(client.get_transport(), socket_timeout=600) as scp:
        scp.put(str(tgz), "/home/ubuntu/yambot-deploy.tgz")
    run(
        f"echo '{password}' | sudo -S bash -lc "
        f"'cd /home/ubuntu/yambot/deploy && {compose} down' || true"
    )
    # Why: research-scraper removed from compose — remove orphaned container + volume from older deploys.
    run(
        f"echo '{password}' | sudo -S bash -lc "
        "'docker rm -f deploy-research-scraper-1 2>/dev/null || true; "
        "docker volume rm deploy_yambot_research_chrome 2>/dev/null || true'"
    )
    run("rm -rf ~/yambot/* && tar -xzf ~/yambot-deploy.tgz -C ~/yambot")

    with sftp.file("/home/ubuntu/yambot/deploy/.env", "w") as f:
        f.write(env_body)
    sftp.close()

    up_cmd = (
        f"echo '{password}' | sudo -S bash -lc "
        f"'cd /home/ubuntu/yambot/deploy && {compose} up -d --build'"
    )
    try:
        run(up_cmd, timeout=2400)
    except RuntimeError:
        print("Retry without host port 80 binding…")
        run("sed -i '/- \\\"80:80\\\"/d' ~/yambot/deploy/docker-compose.yml || true")
        run(up_cmd, timeout=2400)

    run(
        f"echo '{password}' | sudo -S bash -lc "
        f"'cd /home/ubuntu/yambot/deploy && {compose} ps'"
    )
    run(
        f"echo '{password}' | sudo -S bash -lc "
        "'chmod +x /home/ubuntu/yambot/deploy/patch-caddy-body.sh && "
        "/home/ubuntu/yambot/deploy/patch-caddy-body.sh' || true"
    )
    run(
        "sleep 8; curl -s -H 'Host: bot.vughy.com' http://127.0.0.1:8080/api/health; echo; "
        "curl -s -o /dev/null -w 'web8080:%{http_code}\\n' -H 'Host: bot.vughy.com' http://127.0.0.1:8080/"
    )
    client.close()
    print("DEPLOY OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
