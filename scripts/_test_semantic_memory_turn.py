"""Upload tightened semanticMemory.js + live test; run on VPS api container."""
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

host = os.environ["YAMBOT_SSH_HOST"]
user = os.environ["YAMBOT_SSH_USER"]
password = os.environ["YAMBOT_SSH_PASSWORD"]
local_js = ROOT / "scripts" / "_test_semantic_memory_remote.mjs"
local_util = ROOT / "backend" / "src" / "utils" / "semanticMemory.js"


def sh_quote(s: str) -> str:
    return "'" + s.replace("'", "'\"'\"'") + "'"


client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(host, username=user, password=password, timeout=30)
sftp = client.open_sftp()
sftp.put(str(local_js), "/tmp/_test_semantic_memory_remote.mjs")
sftp.put(str(local_util), "/tmp/semanticMemory.js")
script = """#!/bin/bash
set -e
cd /home/ubuntu/yambot/deploy
CID=$(docker compose ps -q api)
docker cp /tmp/semanticMemory.js "$CID":/app/src/utils/semanticMemory.js
docker cp /tmp/_test_semantic_memory_remote.mjs "$CID":/app/_test_semantic_memory_remote.mjs
docker exec -w /app "$CID" node /app/_test_semantic_memory_remote.mjs
EC=$?
docker exec "$CID" rm -f /app/_test_semantic_memory_remote.mjs
exit $EC
"""
with sftp.file("/tmp/_sem_run.sh", "w") as f:
    f.write(script)
sftp.close()

_stdin, stdout, stderr = client.exec_command(
    f"echo {sh_quote(password)} | sudo -S bash /tmp/_sem_run.sh", timeout=180
)
sys.stdout.write(stdout.read().decode("utf-8", errors="replace"))
err = stderr.read().decode("utf-8", errors="replace")
for line in err.splitlines():
    if "[sudo]" in line or "password for" in line.lower():
        continue
    if line.strip():
        sys.stderr.write(line + "\n")
code = stdout.channel.recv_exit_status()
client.close()
sys.exit(code)
