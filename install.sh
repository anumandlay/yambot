#!/usr/bin/env bash
# =============================================================================
# YamBot — one-command VPS installer
# =============================================================================
# Paste on a fresh Ubuntu/Debian VPS (root or sudo):
#
#   curl -fsSL https://raw.githubusercontent.com/anumandlay/yambot/main/install.sh | bash
#
# With a public domain + HTTPS (Caddy / Let's Encrypt):
#
#   curl -fsSL https://raw.githubusercontent.com/anumandlay/yambot/main/install.sh | bash -s -- \
#     --domain bot.example.com --email you@example.com
#
# Options / env:
#   --domain HOST          Public hostname (DNS A record → this VPS)
#   --email EMAIL          Let's Encrypt + admin contact (with --domain)
#   --branch NAME          Git branch to install (default: main)
#   --dir PATH             Install directory (default: /opt/yambot)
#   --no-caddy             Skip Caddy; expose http://IP:8080 only
#   --llm-key KEY          Optional site-wide DEFAULT_LLM_API_KEY
#   --llm-base URL         Optional DEFAULT_LLM_BASE_URL
#   --llm-model NAME       Optional DEFAULT_LLM_MODEL
#   --yes                  Non-interactive (assume defaults)
#   YAMBOT_* env vars override the same flags when set
#
# What it installs: Docker, clones YamBot, writes deploy/.env (secrets),
# builds Compose (Mongo + API + Web + computer-manager + worker images),
# optionally Caddy for HTTPS, then prints the URL to open.
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPO_HTTPS="${YAMBOT_REPO_URL:-https://github.com/anumandlay/yambot.git}"
BRANCH="${YAMBOT_BRANCH:-main}"
INSTALL_DIR="${YAMBOT_INSTALL_DIR:-/opt/yambot}"
DOMAIN="${YAMBOT_DOMAIN:-}"
EMAIL="${YAMBOT_EMAIL:-}"
INSTALL_CADDY=true
LLM_KEY="${DEFAULT_LLM_API_KEY:-}"
LLM_BASE="${DEFAULT_LLM_BASE_URL:-https://api.minimax.io/v1}"
LLM_MODEL="${DEFAULT_LLM_MODEL:-MiniMax-M2.7}"
ASSUME_YES=false

log()  { printf "${CYAN}==>${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}✔${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
die()  { printf "${RED}✖ %s${NC}\n" "$*" >&2; exit 1; }

usage() {
  sed -n '2,35p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --no-caddy) INSTALL_CADDY=false; shift ;;
    --llm-key) LLM_KEY="${2:-}"; shift 2 ;;
    --llm-base) LLM_BASE="${2:-}"; shift 2 ;;
    --llm-model) LLM_MODEL="${2:-}"; shift 2 ;;
    --yes|-y) ASSUME_YES=true; shift ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done

# Piped curl|bash → stdin is not a TTY
if [[ ! -t 0 ]]; then
  ASSUME_YES=true
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif need_cmd sudo; then
    sudo "$@"
  else
    die "Need root or sudo to install system packages / Docker"
  fi
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_LIKE="${ID_LIKE:-}"
  else
    OS_ID=unknown
    OS_LIKE=
  fi
  case "${OS_ID}" in
    ubuntu|debian) ;;
    *)
      case " ${OS_LIKE} " in
        *" debian "*|*" ubuntu "*) ;;
        *)
          warn "Untested OS (${OS_ID}). Continuing anyway — Ubuntu 22.04/24.04 recommended."
          ;;
      esac
      ;;
  esac
}

public_ip() {
  local ip=""
  ip="$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  if [[ -z "$ip" ]]; then
    ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  fi
  if [[ -z "$ip" ]]; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$ip"
}

rand_hex() {
  if need_cmd openssl; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

install_base_packages() {
  log "Installing base packages (curl, git, ca-certificates)…"
  as_root apt-get update -y
  as_root DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl git ca-certificates gnupg openssl
}

install_docker() {
  if need_cmd docker && docker compose version >/dev/null 2>&1; then
    ok "Docker + Compose already installed"
    return
  fi
  log "Installing Docker Engine + Compose plugin…"
  # Official convenience script — works on Ubuntu/Debian
  curl -fsSL https://get.docker.com | as_root sh
  if need_cmd systemctl; then
    as_root systemctl enable --now docker || true
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    as_root usermod -aG docker "$USER" || true
    warn "Added $USER to docker group — re-login if later docker commands fail without sudo."
  fi
  need_cmd docker || die "Docker install failed"
  docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"
  ok "Docker ready"
}

clone_or_update_repo() {
  log "Installing YamBot → ${INSTALL_DIR} (branch ${BRANCH})…"
  as_root mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    ok "Repo exists — fetching ${BRANCH}"
    as_root git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    as_root git -C "$INSTALL_DIR" checkout -B "$BRANCH" "origin/${BRANCH}"
  else
    if [[ -e "$INSTALL_DIR" ]] && [[ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null || true)" ]]; then
      die "${INSTALL_DIR} exists and is not a YamBot git checkout. Move it or pass --dir PATH"
    fi
    as_root git clone --depth 1 --branch "$BRANCH" "$REPO_HTTPS" "$INSTALL_DIR"
  fi
  # Make install tree readable by the invoking user when installed under /opt
  if [[ "$(id -u)" -ne 0 ]]; then
    as_root chown -R "$USER:$USER" "$INSTALL_DIR" 2>/dev/null || true
  fi
  ok "Source at ${INSTALL_DIR} @ $(git -C "$INSTALL_DIR" rev-parse --short HEAD)"
}

compose() {
  (cd "${INSTALL_DIR}/deploy" && as_root docker compose "$@")
}

write_env_file() {
  local env_file="${INSTALL_DIR}/deploy/.env"
  local public_url cors vite_url jwt crypto pub_ip scheme host_port

  pub_ip="$(public_ip)"
  if [[ -n "$DOMAIN" ]]; then
    scheme="https"
    public_url="https://${DOMAIN}"
    cors="https://${DOMAIN},http://${DOMAIN}"
    vite_url="$public_url"
  else
    INSTALL_CADDY=false
    scheme="http"
    if [[ -z "$pub_ip" ]]; then
      die "Could not detect public IP and no --domain given"
    fi
    public_url="http://${pub_ip}:8080"
    cors="${public_url},http://${pub_ip},http://${pub_ip}:4010"
    vite_url="$public_url"
    warn "No --domain — using ${public_url} (open firewall port 8080)."
  fi

  if [[ -f "$env_file" ]]; then
    ok "Keeping existing deploy/.env (secrets preserved)"
    # Refresh public URLs so domain changes stick on re-run
    as_root sed -i \
      -e "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=${public_url}|" \
      -e "s|^PUBLIC_WEB_URL=.*|PUBLIC_WEB_URL=${public_url}|" \
      -e "s|^CORS_ORIGINS=.*|CORS_ORIGINS=${cors}|" \
      -e "s|^VITE_API_BASE_URL=.*|VITE_API_BASE_URL=${vite_url}|" \
      "$env_file" || true
    if [[ -n "$LLM_KEY" ]]; then
      if grep -q '^DEFAULT_LLM_API_KEY=' "$env_file"; then
        as_root sed -i "s|^DEFAULT_LLM_API_KEY=.*|DEFAULT_LLM_API_KEY=${LLM_KEY}|" "$env_file"
      else
        echo "DEFAULT_LLM_API_KEY=${LLM_KEY}" | as_root tee -a "$env_file" >/dev/null
      fi
    fi
    return
  fi

  jwt="$(rand_hex)"
  crypto="$(rand_hex)"

  log "Writing deploy/.env (new secrets)…"
  as_root tee "$env_file" >/dev/null <<EOF
NODE_ENV=production
PORT=4000
PUBLIC_API_URL=${public_url}
PUBLIC_WEB_URL=${public_url}
CORS_ORIGINS=${cors}
JWT_SECRET=${jwt}
SETTINGS_CRYPTO_KEY=${crypto}
JWT_EXPIRES_IN=7d
VITE_API_BASE_URL=${vite_url}
DOCKER_NETWORK=deploy_default
YAMBOT_API_BASE_URL=http://api:4000
DEFAULT_LLM_BASE_URL=${LLM_BASE}
DEFAULT_LLM_MODEL=${LLM_MODEL}
DEFAULT_LLM_API_KEY=${LLM_KEY}
MEM0_ENABLED=1
MEM0_EMBEDDER_PROVIDER=fastembed
MEM0_EMBEDDER_MODEL=fast-bge-small-en-v1.5
MEM0_EMBEDDING_DIMS=384
EOF
  as_root chmod 600 "$env_file"
  ok "deploy/.env created"
}

install_caddy() {
  if [[ "$INSTALL_CADDY" != true ]]; then
    return
  fi
  if [[ -z "$DOMAIN" ]]; then
    return
  fi
  if [[ -z "$EMAIL" ]]; then
    warn "No --email — Caddy will still try ACME; prefer --email you@example.com"
    EMAIL="admin@${DOMAIN}"
  fi

  log "Installing Caddy for https://${DOMAIN}…"
  if ! need_cmd caddy; then
    as_root apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | as_root gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | as_root tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    as_root apt-get update -y
    as_root DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
  fi

  local caddyfile="/etc/caddy/Caddyfile"
  log "Writing ${caddyfile}"
  as_root tee "$caddyfile" >/dev/null <<EOF
{
	admin off
	email ${EMAIL}
}

${DOMAIN} {
	request_body {
		max_size 10MB
	}
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
EOF

  if need_cmd systemctl; then
    as_root systemctl enable caddy
    as_root systemctl restart caddy
  else
    as_root caddy reload --config "$caddyfile" 2>/dev/null || as_root caddy start --config "$caddyfile" || true
  fi
  ok "Caddy → ${DOMAIN} → 127.0.0.1:8080"
  warn "Point DNS A record for ${DOMAIN} to this VPS before HTTPS will work."
}

build_and_start() {
  log "Building and starting YamBot (first build can take several minutes)…"
  compose up -d --build
  ok "Compose is up"
}

wait_healthy() {
  local url tries=0
  if [[ -n "$DOMAIN" && "$INSTALL_CADDY" == true ]]; then
    url="https://${DOMAIN}/api/health"
  else
    url="http://127.0.0.1:8080/api/health"
  fi
  log "Waiting for API health (${url})…"
  until curl -fsS -o /dev/null --max-time 5 "$url" 2>/dev/null \
    || curl -fsS -o /dev/null --max-time 5 -H "Host: ${DOMAIN:-localhost}" "http://127.0.0.1:8080/api/health" 2>/dev/null; do
    tries=$((tries + 1))
    if [[ $tries -gt 60 ]]; then
      warn "Health check timed out — check: cd ${INSTALL_DIR}/deploy && docker compose ps && docker compose logs api"
      return 0
    fi
    sleep 3
  done
  ok "API healthy"
}

print_summary() {
  local public_url
  if [[ -n "$DOMAIN" ]]; then
    public_url="https://${DOMAIN}"
  else
    public_url="http://$(public_ip):8080"
  fi

  cat <<EOF

${BOLD}${GREEN}YamBot is installed.${NC}

  Open:     ${BOLD}${public_url}${NC}
  Code:     ${INSTALL_DIR}
  Env:      ${INSTALL_DIR}/deploy/.env  (secrets — do not commit)
  Compose:  cd ${INSTALL_DIR}/deploy && docker compose ps

Next steps:
  1. Open the URL and create your account (first user / Settings).
  2. Set an LLM API key in Settings (or re-run with --llm-key).
  3. Create a cloud agent — computer-manager starts its Chromium box.

Update later:
  cd ${INSTALL_DIR} && git pull && cd deploy && docker compose up -d --build

Re-run this installer anytime (keeps deploy/.env secrets):
  curl -fsSL https://raw.githubusercontent.com/anumandlay/yambot/${BRANCH}/install.sh | bash -s -- --domain ${DOMAIN:-YOUR_DOMAIN}

EOF
}

main() {
  printf "\n${BOLD}YamBot installer${NC}\n\n"
  detect_os

  if [[ "$ASSUME_YES" != true ]]; then
    printf "Install YamBot to %s (branch %s)" "$INSTALL_DIR" "$BRANCH"
    if [[ -n "$DOMAIN" ]]; then
      printf " for https://%s" "$DOMAIN"
    fi
    printf "? [Y/n] "
    read -r ans || true
    case "${ans:-Y}" in
      Y|y|yes|"") ;;
      *) die "Aborted" ;;
    esac
  fi

  install_base_packages
  install_docker
  clone_or_update_repo
  write_env_file
  install_caddy
  build_and_start
  wait_healthy
  print_summary
}

main "$@"
