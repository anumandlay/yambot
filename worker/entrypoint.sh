#!/bin/bash
# @fileoverview Boot X display + VNC + noVNC, then the YamBot Playwright worker.
# Why: Take control embeds noVNC so the user drives the same Chromium the agent uses.
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export YAMBOT_HEADED="${YAMBOT_HEADED:-1}"
# Why: silence "Google API keys are missing" infobar in headed Chromium on noVNC.
export GOOGLE_API_KEY="${GOOGLE_API_KEY:-no}"
export GOOGLE_DEFAULT_CLIENT_ID="${GOOGLE_DEFAULT_CLIENT_ID:-no}"
export GOOGLE_DEFAULT_CLIENT_SECRET="${GOOGLE_DEFAULT_CLIENT_SECRET:-no}"

VNC_PORT="${YAMBOT_VNC_PORT:-5900}"
NOVNC_PORT="${YAMBOT_NOVNC_PORT:-6080}"
SCREEN_W="${YAMBOT_VIEWPORT_WIDTH:-1280}"
SCREEN_H="${YAMBOT_VIEWPORT_HEIGHT:-800}"

echo "[desktop] starting Xvfb ${DISPLAY} ${SCREEN_W}x${SCREEN_H}x24"
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_W}x${SCREEN_H}x24" -ac +extension RANDR +extension GLX >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
sleep 0.8
if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
  echo "[desktop] Xvfb failed:" >&2
  cat /tmp/xvfb.log >&2 || true
  exit 1
fi

echo "[desktop] starting fluxbox"
fluxbox >/tmp/fluxbox.log 2>&1 &
sleep 0.3

echo "[desktop] starting x11vnc on :${VNC_PORT}"
x11vnc -display "${DISPLAY}" -forever -shared -rfbport "${VNC_PORT}" -localhost -nopw \
  -xkb -repeat -cursor most -o /tmp/x11vnc.log >/tmp/x11vnc.out 2>&1 &
sleep 0.5

NOVNC_WEB="${NOVNC_WEB:-/usr/share/novnc}"
if [[ ! -d "${NOVNC_WEB}" ]]; then
  NOVNC_WEB="/usr/share/novnc"
fi
echo "[desktop] starting noVNC/websockify on :${NOVNC_PORT} (web=${NOVNC_WEB})"
websockify --web="${NOVNC_WEB}" "0.0.0.0:${NOVNC_PORT}" "127.0.0.1:${VNC_PORT}" \
  >/tmp/websockify.log 2>&1 &
sleep 0.4

# Why: after container recreate, leftover SingletonLock / .lock files from the
# previous Chromium host make headed launch fail with “profile in use”.
PROFILE_DIR="${YAMBOT_PROFILE_DIR:-${YAMBOT_BROWSER_PROFILE:-/data/browser-profile}}"
if [[ -d "${PROFILE_DIR}" ]]; then
  echo "[desktop] clearing Chromium singleton locks in ${PROFILE_DIR}"
  rm -f "${PROFILE_DIR}/SingletonLock" \
        "${PROFILE_DIR}/SingletonCookie" \
        "${PROFILE_DIR}/SingletonSocket" \
        "${PROFILE_DIR}/lockfile" 2>/dev/null || true
fi

echo "[desktop] ready — launching worker (headed=${YAMBOT_HEADED})"
exec node src/index.js
