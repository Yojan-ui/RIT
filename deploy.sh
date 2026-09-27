#!/usr/bin/env bash
# Deploy SecureMailScope on a fresh Ubuntu VM: Docker + Caddy (automatic HTTPS) + the app.
#
# First run (DNS for DOMAIN must already point at this VM; ports 80/443 open):
#   sudo DOMAIN=scan.example.com ACME_EMAIL=you@example.com \
#        ANTHROPIC_API_KEY=sk-ant-... SCAN_RATE_PER_MINUTE=100 SCAN_BURST=100 \
#        bash deploy.sh
#
# Later runs pull the latest code and rebuild; settings are remembered, so plain
# `sudo bash deploy.sh` is enough. Any variable passed again overrides the stored value.
#
# Optional: BRANCH (default main), REPO_URL, APP_DIR (default /opt/securemailscope),
#           API_RATE_PER_MINUTE, API_BURST, MAX_CONCURRENT_SCANS.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Yojan-ui/SECUREMAILSCOPE.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/securemailscope}"
CADDY_ENV=/etc/caddy/securemailscope.env

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }

# ---- Preconditions ------------------------------------------------------------
[[ $EUID -eq 0 ]] || die "Run as root: sudo DOMAIN=... bash deploy.sh"
# shellcheck disable=SC1091
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "This script targets Ubuntu (found: ${PRETTY_NAME:-unknown})."

# DOMAIN / ACME_EMAIL may come from a previous run.
if [[ -z "${DOMAIN:-}" && -f "$CADDY_ENV" ]]; then
  # shellcheck disable=SC1090
  . "$CADDY_ENV"
fi
[[ -n "${DOMAIN:-}" ]] || die "Set DOMAIN, e.g. sudo DOMAIN=scan.example.com ACME_EMAIL=you@example.com bash deploy.sh"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "DOMAIN '$DOMAIN' doesn't look like a hostname."
[[ -n "${ACME_EMAIL:-}" ]] || warn "ACME_EMAIL not set: certificates still work, but you won't get expiry notices."

export DEBIAN_FRONTEND=noninteractive

# ---- Base packages ------------------------------------------------------------
log "Installing base packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https >/dev/null

# ---- Docker Engine + Compose plugin (official repository) ------------------------
if docker compose version >/dev/null 2>&1; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null

# ---- Caddy (official repository) --------------------------------------------------
if command -v caddy >/dev/null 2>&1; then
  log "Caddy already installed: $(caddy version | head -1)"
else
  log "Installing Caddy"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# ---- Firewall ----------------------------------------------------------------------
# Only adjust ufw if it's already on; enabling it here could lock you out of SSH.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  log "Opening ports 80 and 443 in ufw"
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

# The STARTTLS probe needs outbound port 25. Warn (don't fail): the rest of the app works.
if timeout 6 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' 2>/dev/null; then
  log "Outbound port 25 is open"
else
  warn "Outbound port 25 appears blocked: STARTTLS checks will show as 'not measured'. Ask your provider to unblock it."
fi

# ---- Code -------------------------------------------------------------------------
if [[ -d "$APP_DIR/.git" ]]; then
  log "Updating $APP_DIR ($BRANCH)"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  # Fast-forward only: never silently discard local changes on the server.
  git -C "$APP_DIR" merge --ff-only --quiet "origin/$BRANCH" \
    || die "$APP_DIR has local changes or diverged from origin/$BRANCH; resolve them and re-run."
else
  log "Cloning $REPO_URL ($BRANCH) into $APP_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
[[ -f "$APP_DIR/docker-compose.yml" && -f "$APP_DIR/Caddyfile" ]] \
  || die "$BRANCH has no docker-compose.yml/Caddyfile. Deploy the 3D build branch: BRANCH=securemailscope-3d-terminal"

# ---- App settings (.env next to docker-compose.yml; root-only, never committed) -------
ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
set_env() { # set_env KEY VALUE: add or replace KEY=VALUE in .env
  local key=$1 value=$2
  if grep -q "^${key}=" "$ENV_FILE"; then
    grep -v "^${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" && cat "$ENV_FILE.tmp" > "$ENV_FILE" && rm -f "$ENV_FILE.tmp"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
}
for key in ANTHROPIC_API_KEY SCAN_RATE_PER_MINUTE SCAN_BURST API_RATE_PER_MINUTE API_BURST MAX_CONCURRENT_SCANS; do
  if [[ -n "${!key:-}" ]]; then
    set_env "$key" "${!key}"
  fi
done
grep -q "^ANTHROPIC_API_KEY=." "$ENV_FILE" \
  || warn "ANTHROPIC_API_KEY not set: narratives will use the rule-based writer."

# ---- Build and start the app ---------------------------------------------------------
log "Building and starting the app (docker compose up -d --build)"
docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" up -d --build --remove-orphans

log "Waiting for the app on 127.0.0.1:8000"
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:8000/api/health >/dev/null || die "App did not become healthy: docker compose -f $APP_DIR/docker-compose.yml logs"

# ---- Caddy: config + environment for the systemd service -------------------------------
log "Configuring Caddy for https://$DOMAIN"
umask 077
printf 'DOMAIN=%s\nACME_EMAIL=%s\n' "$DOMAIN" "${ACME_EMAIL:-}" > "$CADDY_ENV"
umask 022
chown root:caddy "$CADDY_ENV" && chmod 640 "$CADDY_ENV"
mkdir -p /etc/systemd/system/caddy.service.d /var/log/caddy
chown caddy:caddy /var/log/caddy
cat > /etc/systemd/system/caddy.service.d/securemailscope.conf <<EOF
[Service]
EnvironmentFile=$CADDY_ENV
EOF
install -m 644 "$APP_DIR/Caddyfile" /etc/caddy/Caddyfile
DOMAIN="$DOMAIN" ACME_EMAIL="${ACME_EMAIL:-}" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null \
  || die "Caddyfile failed validation"
systemctl daemon-reload
systemctl enable caddy >/dev/null
systemctl restart caddy

log "Done. SecureMailScope: https://$DOMAIN"
cat <<EOF
  - Caddy fetches the TLS certificate on the first request; the domain's DNS must point here.
  - App logs:   docker compose -f $APP_DIR/docker-compose.yml logs -f
  - Caddy logs: journalctl -u caddy -f   (access log: /var/log/caddy/securemailscope.log)
  - Update:     sudo bash $APP_DIR/deploy.sh
EOF
