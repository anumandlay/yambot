#!/bin/bash
# Start a virtual display, then run the YamBot research scraper.
set -euo pipefail

echo "[entrypoint] cleaning stale Xvfb / Chrome locks"
pkill -f 'Xvfb :99' 2>/dev/null || true
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
# Why: crashed Chrome leaves SingletonLock → exit code 21 on next boot.
if [ -d "${CHROME_PROFILE_DIR:-/data/chrome-profile}" ]; then
  rm -f \
    "${CHROME_PROFILE_DIR}/SingletonLock" \
    "${CHROME_PROFILE_DIR}/SingletonCookie" \
    "${CHROME_PROFILE_DIR}/SingletonSocket" \
    2>/dev/null || true
fi

echo "[entrypoint] starting Xvfb"
Xvfb :99 -screen 0 1280x900x24 -nolisten tcp &
export DISPLAY=:99
sleep 2
echo "[entrypoint] DISPLAY=$DISPLAY — launching scraper"
exec python -u /app/scraper.py
