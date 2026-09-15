#!/bin/bash
# @fileoverview Boot Cua XFCE (supervisord) then the YamBot Playwright worker on DISPLAY=:1.
# Why: Take control should show the full Cua desktop, not a second Xvfb. YamBot still drives
# Chrome via Playwright; cua-driver MCP is not used in this v1.
set -euo pipefail

export DISPLAY="${DISPLAY:-:1}"
export YAMBOT_HEADED="${YAMBOT_HEADED:-1}"
export YAMBOT_BROWSER_CHANNEL="${YAMBOT_BROWSER_CHANNEL:-chrome}"
export YAMBOT_CUA="${YAMBOT_CUA:-1}"

NOVNC_PORT="${YAMBOT_NOVNC_PORT:-6080}"
SUPERVISOR_CONF="${CUA_SUPERVISOR_CONF:-/etc/supervisor/supervisord.conf}"

echo "[cua] starting Cua desktop stack (DISPLAY=${DISPLAY})"
if [[ -x /usr/bin/supervisord && -f "${SUPERVISOR_CONF}" ]]; then
  if ! pgrep -x supervisord >/dev/null 2>&1; then
    /usr/bin/supervisord -c "${SUPERVISOR_CONF}" >/tmp/supervisord.log 2>&1 &
  fi
else
  echo "[cua] supervisord missing — Cua desktop may not start" >&2
fi

echo "[cua] waiting for X ${DISPLAY}"
X_SOCK="/tmp/.X11-unix/X${DISPLAY#:}"
for i in $(seq 1 90); do
  if [[ -S "${X_SOCK}" ]]; then
    echo "[cua] display socket ready after ${i}s"
    break
  fi
  sleep 1
  if [[ "${i}" -eq 90 ]]; then
    echo "[cua] timed out waiting for ${X_SOCK}" >&2
    cat /tmp/supervisord.log 2>/dev/null || true
  fi
done

# Why: Cua's X session is owned by the cua user; YamBot worker runs as root.
if command -v xhost >/dev/null 2>&1; then
  xhost +SI:localuser:root >/dev/null 2>&1 || xhost +local: >/dev/null 2>&1 || true
fi

# Why: YamBot desktopProxy always hits :6080; Cua VNC is typically :5901 (fallback :5900).
wait_tcp() {
  local port="$1"
  for _ in $(seq 1 45); do
    if (echo >/dev/tcp/127.0.0.1/"${port}") >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

VNC_PORT=5901
if wait_tcp 5901; then
  VNC_PORT=5901
elif wait_tcp 5900; then
  VNC_PORT=5900
else
  echo "[cua] no VNC on 5901/5900 yet; websockify will retry via kernel" >&2
fi

NOVNC_WEB="${NOVNC_WEB:-/usr/share/novnc}"
if [[ ! -d "${NOVNC_WEB}" ]]; then
  NOVNC_WEB="/usr/share/novnc"
fi
echo "[cua] starting YamBot noVNC on :${NOVNC_PORT} → 127.0.0.1:${VNC_PORT}"
if command -v websockify >/dev/null 2>&1; then
  websockify --web="${NOVNC_WEB}" "0.0.0.0:${NOVNC_PORT}" "127.0.0.1:${VNC_PORT}" \
    >/tmp/websockify.log 2>&1 &
elif command -v socat >/dev/null 2>&1; then
  # Fallback: TCP-forward Cua's own noVNC (6901) if websockify is missing.
  socat TCP-LISTEN:"${NOVNC_PORT}",bind=0.0.0.0,fork,reuseaddr TCP:127.0.0.1:6901 \
    >/tmp/socat-novnc.log 2>&1 &
else
  echo "[cua] neither websockify nor socat found — Take control will fail" >&2
fi

PROFILE_DIR="${YAMBOT_PROFILE_DIR:-${YAMBOT_BROWSER_PROFILE:-/data/browser-profile}}"
echo "[cua] preparing browser profile in ${PROFILE_DIR} (channel=${YAMBOT_BROWSER_CHANNEL})"
mkdir -p "${PROFILE_DIR}"
cd /app
node src/bootProfile.js

echo "[cua] ready — launching worker (headed=${YAMBOT_HEADED} display=${DISPLAY})"
exec node src/index.js
