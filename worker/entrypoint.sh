#!/bin/bash
# @fileoverview Boot X display + VNC + noVNC + AT-SPI session bus, then the YamBot worker.
# Why: Take control embeds noVNC so the user drives the same Chromium the agent uses.
#      cua-driver Linux AX needs a live D-Bus session + AT-SPI bus (not just apt packages).
set -euo pipefail

export DISPLAY="${DISPLAY:-:99}"
export YAMBOT_HEADED="${YAMBOT_HEADED:-1}"
export YAMBOT_BROWSER_CHANNEL="${YAMBOT_BROWSER_CHANNEL:-chrome}"
# Why: suppress Google API keys infobar only for bundled Chromium (not real Chrome).
if [[ "${YAMBOT_BROWSER_CHANNEL}" == "chromium" || -z "${YAMBOT_BROWSER_CHANNEL}" ]]; then
  export GOOGLE_API_KEY="${GOOGLE_API_KEY:-no}"
  export GOOGLE_DEFAULT_CLIENT_ID="${GOOGLE_DEFAULT_CLIENT_ID:-no}"
  export GOOGLE_DEFAULT_CLIENT_SECRET="${GOOGLE_DEFAULT_CLIENT_SECRET:-no}"
fi

VNC_PORT="${YAMBOT_VNC_PORT:-5900}"
NOVNC_PORT="${YAMBOT_NOVNC_PORT:-6080}"
SCREEN_W="${YAMBOT_VIEWPORT_WIDTH:-1280}"
SCREEN_H="${YAMBOT_VIEWPORT_HEIGHT:-800}"

# Why: dbus/at-spi sockets land under XDG_RUNTIME_DIR; root containers often lack one.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/runtime-root}"
mkdir -p "${XDG_RUNTIME_DIR}"
chmod 700 "${XDG_RUNTIME_DIR}"

echo "[desktop] starting Xvfb ${DISPLAY} ${SCREEN_W}x${SCREEN_H}x24"
# Why: cua-driver window screenshots need MIT-SHM; without it Linux capture backends fail with X11 Match.
Xvfb "${DISPLAY}" -screen 0 "${SCREEN_W}x${SCREEN_H}x24" -ac \
  +extension RANDR +extension GLX +extension MIT-SHM +extension RENDER \
  >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
sleep 0.8
if ! kill -0 "${XVFB_PID}" 2>/dev/null; then
  echo "[desktop] Xvfb failed:" >&2
  cat /tmp/xvfb.log >&2 || true
  exit 1
fi
# Why: some capture paths still choke on SHM Magick/Match — prefer non-SHM fallbacks when available.
export QT_X11_NO_MITSHM="${QT_X11_NO_MITSHM:-0}"
export GDK_BACKEND="${GDK_BACKEND:-x11}"

# Why: cua-driver Linux AX talks AT-SPI over the session bus. Without dbus-launch,
# get_window_state hangs / warns "AT-SPI connect failed: No such file or directory".
export NO_AT_BRIDGE="${NO_AT_BRIDGE:-0}"
export GTK_A11Y="${GTK_A11Y:-1}"
export QT_ACCESSIBILITY="${QT_ACCESSIBILITY:-1}"
export ACCESSIBILITY_ENABLED="${ACCESSIBILITY_ENABLED:-1}"

if [[ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  if command -v dbus-launch >/dev/null 2>&1; then
    # shellcheck disable=SC2046
    eval "$(dbus-launch --sh-syntax)"
    export DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID
    echo "[desktop] dbus session started (${DBUS_SESSION_BUS_ADDRESS})"
  else
    echo "[desktop] WARNING: dbus-launch missing — AT-SPI / CUA element capture will be degraded" >&2
  fi
else
  echo "[desktop] dbus session reused (${DBUS_SESSION_BUS_ADDRESS})"
fi

# Why: persist for docker exec / debug probes; worker already inherits via export+exec.
{
  echo "export DBUS_SESSION_BUS_ADDRESS=$(printf %q "${DBUS_SESSION_BUS_ADDRESS:-}")"
  echo "export DBUS_SESSION_BUS_PID=$(printf %q "${DBUS_SESSION_BUS_PID:-}")"
  echo "export XDG_RUNTIME_DIR=$(printf %q "${XDG_RUNTIME_DIR:-}")"
  echo "export NO_AT_BRIDGE=0"
  echo "export GTK_A11Y=1"
  echo "export QT_ACCESSIBILITY=1"
  echo "export ACCESSIBILITY_ENABLED=1"
  echo "export DISPLAY=$(printf %q "${DISPLAY}")"
} >/tmp/yambot-desktop.env
chmod 644 /tmp/yambot-desktop.env

ATSPI_LAUNCHER=""
for candidate in \
  /usr/libexec/at-spi-bus-launcher \
  /usr/lib/at-spi2-core/at-spi-bus-launcher
do
  if [[ -x "${candidate}" ]]; then
    ATSPI_LAUNCHER="${candidate}"
    break
  fi
done
if [[ -n "${ATSPI_LAUNCHER}" ]]; then
  echo "[desktop] starting AT-SPI bus (${ATSPI_LAUNCHER})"
  "${ATSPI_LAUNCHER}" --launch-immediately >/tmp/at-spi-bus.log 2>&1 &
  sleep 0.5
else
  echo "[desktop] WARNING: at-spi-bus-launcher not found — CUA SOM/AX may fail" >&2
fi

# Why: prove the a11y bus is reachable before Chrome/cua-driver start.
if command -v dbus-send >/dev/null 2>&1 && [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  if dbus-send --session --dest=org.a11y.Bus --type=method_call --print-reply \
      /org/a11y/bus org.a11y.Bus.GetAddress >/tmp/a11y-bus.txt 2>/tmp/a11y-bus.err; then
    echo "[desktop] AT-SPI a11y bus ready"
  else
    echo "[desktop] AT-SPI a11y bus not ready yet (activation on first use): $(tr '\n' ' ' </tmp/a11y-bus.err | head -c 200)"
  fi
fi

echo "[desktop] starting fluxbox"
fluxbox >/tmp/fluxbox.log 2>&1 &
sleep 0.3

# Why: CUA mode glides the real X pointer; ensure a visible cursor theme on bare Xvfb.
if command -v xsetroot >/dev/null 2>&1; then
  xsetroot -cursor_name left_ptr >/dev/null 2>&1 || true
fi

# Why: x11vnc can SIGSEGV under load (Zoom reconnect / MIT-SHM / damage); without a
# restart loop, websockify stays up but Zoom shows "Failed to connect to server".
echo "[desktop] starting x11vnc supervisor on :${VNC_PORT}"
(
  while true; do
    # -noxdamage / -noshm: avoid common Xvfb segfault paths; -cursor arrow is stabler than "most"
    x11vnc -display "${DISPLAY}" -forever -shared -rfbport "${VNC_PORT}" -localhost -nopw \
      -xkb -repeat -cursor arrow -noxdamage -noshm -wait 10 -defer 10 \
      -o /tmp/x11vnc.log >>/tmp/x11vnc.out 2>&1
    code=$?
    echo "[desktop] x11vnc exited code=${code} — restarting in 1s" >>/tmp/x11vnc.out
    sleep 1
  done
) &
sleep 0.8
if ! ss -lntp 2>/dev/null | grep -q ":${VNC_PORT}" && ! netstat -lntp 2>/dev/null | grep -q ":${VNC_PORT}"; then
  echo "[desktop] WARNING: x11vnc not listening on :${VNC_PORT} yet — Zoom may fail until it comes up" >&2
  tail -20 /tmp/x11vnc.log >&2 || true
fi

NOVNC_WEB="${NOVNC_WEB:-/usr/share/novnc}"
if [[ ! -d "${NOVNC_WEB}" ]]; then
  NOVNC_WEB="/usr/share/novnc"
fi
echo "[desktop] starting noVNC/websockify on :${NOVNC_PORT} (web=${NOVNC_WEB})"
(
  while true; do
    websockify --web="${NOVNC_WEB}" "0.0.0.0:${NOVNC_PORT}" "127.0.0.1:${VNC_PORT}" \
      >>/tmp/websockify.log 2>&1
    echo "[desktop] websockify exited — restarting in 1s" >>/tmp/websockify.log
    sleep 1
  done
) &
sleep 0.4

# Why: corrupted persistent profiles show "Something went wrong when opening your profile"
# and orphan Chromium processes stack multiple windows on the live screen.
PROFILE_DIR="${YAMBOT_PROFILE_DIR:-${YAMBOT_BROWSER_PROFILE:-/data/browser-profile}}"
echo "[desktop] preparing browser profile in ${PROFILE_DIR} (channel=${YAMBOT_BROWSER_CHANNEL})"
cd /app
node src/bootProfile.js

# Why: binary only — serve starts lazily when CUA mode activates (chat "using cua" or 2 fails).
if command -v cua-driver >/dev/null 2>&1; then
  echo "[desktop] cua-driver present: $(cua-driver --version 2>/dev/null || echo ok)"
else
  echo "[desktop] cua-driver not installed — CUA uses Playwright click_at/type_at only"
fi

echo "[desktop] ready — launching worker (headed=${YAMBOT_HEADED})"
exec node src/index.js
