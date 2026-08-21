#!/bin/bash
# Start a virtual display, then run the YamBot research scraper.
set -euo pipefail
echo "[entrypoint] starting Xvfb"
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp &
export DISPLAY=:99
sleep 2
echo "[entrypoint] DISPLAY=$DISPLAY — launching scraper"
exec python -u /app/scraper.py
