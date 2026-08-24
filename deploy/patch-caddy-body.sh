#!/bin/bash
# @fileoverview Ensures host Caddy allows large worker heartbeat POST bodies (JPEG screenshots).
# Why: default ~1MB limit returns "request entity too large" before traffic reaches nginx/api.
set -euo pipefail

CADDY="${CADDYFILE:-/etc/caddy/Caddyfile}"
[[ -f "${CADDY}" ]] || exit 0
if grep -q 'max_size 10MB' "${CADDY}"; then
  exit 0
fi

python3 - "${CADDY}" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
if "max_size 10MB" in text:
    sys.exit(0)

needle = "bot.vughy.com {"
if needle not in text:
    sys.exit(0)

insert = (
    "bot.vughy.com {\n"
    "\trequest_body {\n"
    "\t\tmax_size 10MB\n"
    "\t}\n"
)
text = text.replace(needle, insert, 1)
path.write_text(text)
print(f"Patched {path} with request_body max_size 10MB")
PY

if command -v systemctl >/dev/null 2>&1; then
  systemctl reload caddy 2>/dev/null || systemctl restart caddy || true
fi
