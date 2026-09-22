#!/usr/bin/env python3
"""Scrub ephemeral curated MEMORY entries on VPS Mongo via api container."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

ROOT = Path(__file__).resolve().parents[1]
for line in (ROOT / "deploy" / ".deploy.local.env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    os.environ[k.strip()] = v.strip().strip('"').strip("'")

local_js = ROOT / "scripts" / "_scrub_ephemeral_curated_remote.mjs"


def sh_quote(s: str) -> str:
    return "'" + s.replace("'", "'\"'\"'") + "'"


client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(
    os.environ["YAMBOT_SSH_HOST"],
    username=os.environ["YAMBOT_SSH_USER"],
    password=os.environ["YAMBOT_SSH_PASSWORD"],
    timeout=30,
)
sftp = client.open_sftp()
sftp.put(str(local_js), "/tmp/_scrub_ephemeral_curated_remote.mjs")
script = """#!/bin/bash
set -e
cd /home/ubuntu/yambot/deploy
CID=$(docker compose ps -q api)
docker cp /tmp/_scrub_ephemeral_curated_remote.mjs "$CID":/app/_scrub_ephemeral_curated_remote.mjs
docker exec -w /app "$CID" node /app/_scrub_ephemeral_curated_remote.mjs
docker exec "$CID" rm -f /app/_scrub_ephemeral_curated_remote.mjs
"""
with sftp.file("/tmp/_scrub_ephemeral_curated_run.sh", "w") as f:
    f.write(script)
sftp.close()
password = os.environ["YAMBOT_SSH_PASSWORD"]
_stdin, stdout, stderr = client.exec_command(
    f"echo {sh_quote(password)} | sudo -S bash /tmp/_scrub_ephemeral_curated_run.sh",
    timeout=120,
)
sys.stdout.write(stdout.read().decode("utf-8", errors="replace"))
err = stderr.read().decode("utf-8", errors="replace")
for line in err.splitlines():
    if "[sudo]" in line or "password for" in line.lower():
        continue
    if line.strip():
        sys.stderr.write(line + "\n")
client.close()
