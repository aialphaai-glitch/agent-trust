#!/usr/bin/env bash
# ── server-bootstrap.sh ────────────────────────────────────────────────────────
# First-time setup on a fresh Hostinger (or any Debian/Ubuntu) VPS.
# Run as root. Idempotent — safe to re-run.
#
# What it does:
#   1. Updates apt, installs nginx, certbot, git, curl, build tools
#   2. Installs Node.js 22 from NodeSource
#   3. Creates the `atp` system user + directories
#   4. Clones the repo to /opt/atp/agent-trust-protocol (if missing)
#   5. Runs `npm ci` and the full build
#   6. Installs systemd units + nginx configs
#   7. Issues TLS certs via certbot for apex, www, and ledger.
#   8. Starts services
#
# Before running, set REPO_URL below (or export it) if not using origin.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/YOUR_USERNAME/agent-trust-protocol.git}"
APP_DIR="/opt/atp/agent-trust-protocol"
DATA_DIR="/var/lib/atp/ledger"
USER_NAME="atp"
DOMAIN_APEX="aiagenttrust.dev"
DOMAIN_WWW="www.aiagenttrust.dev"
DOMAIN_LEDGER="ledger.aiagenttrust.dev"
ACME_EMAIL="${ACME_EMAIL:-hello@aiagenttrust.dev}"

log() { printf '\033[1;36m[bootstrap]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[bootstrap] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root."

log "apt update + base packages"
apt-get update -y
apt-get install -y --no-install-recommends \
    ca-certificates curl git gnupg build-essential \
    nginx certbot python3-certbot-nginx \
    ufw

log "Node.js 22 (NodeSource)"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
fi
node -v
npm -v

log "system user + dirs"
id -u "$USER_NAME" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$USER_NAME"
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 /opt/atp
install -d -o "$USER_NAME" -g "$USER_NAME" -m 0755 "$DATA_DIR"
install -d -o www-data -g www-data -m 0755 /var/www/certbot

log "clone or update repo"
if [[ ! -d "$APP_DIR/.git" ]]; then
    sudo -u "$USER_NAME" git clone "$REPO_URL" "$APP_DIR"
else
    sudo -u "$USER_NAME" git -C "$APP_DIR" fetch --prune
    sudo -u "$USER_NAME" git -C "$APP_DIR" pull --ff-only
fi

log "install + build"
cd "$APP_DIR"
sudo -u "$USER_NAME" npm ci --no-audit --no-fund
sudo -u "$USER_NAME" npm run build

log "systemd units"
install -m 0644 deploy/systemd/atp-ledger.service /etc/systemd/system/atp-ledger.service
install -m 0644 deploy/systemd/atp-profile.service /etc/systemd/system/atp-profile.service
systemctl daemon-reload

log "start ledger (so we can seed profile state)"
systemctl enable --now atp-ledger.service
sleep 2
systemctl is-active --quiet atp-ledger || die "atp-ledger failed to start — journalctl -u atp-ledger -n 50"

log "seed reference-agent state (first boot only)"
if [[ ! -f "$APP_DIR/examples/reference-agent/state.json" ]]; then
    sudo -u "$USER_NAME" bash -c "cd $APP_DIR/examples/reference-agent && node dist/agent.js"
fi

log "start profile"
systemctl enable --now atp-profile.service
sleep 2
systemctl is-active --quiet atp-profile || die "atp-profile failed to start — journalctl -u atp-profile -n 50"

log "firewall"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "nginx — rate-limit zone + site config"
install -m 0644 deploy/nginx/rate-limit.conf /etc/nginx/conf.d/atp-rate-limit.conf

# Temporary HTTP-only config so certbot can answer the ACME challenge.
cat >/etc/nginx/sites-available/atp-bootstrap.conf <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name aiagenttrust.dev www.aiagenttrust.dev ledger.aiagenttrust.dev;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 'acme bootstrap'; add_header Content-Type text/plain; }
}
EOF
ln -sf /etc/nginx/sites-available/atp-bootstrap.conf /etc/nginx/sites-enabled/atp-bootstrap.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "certbot — issue certs (requires DNS already pointing at this server)"
certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN_APEX" -d "$DOMAIN_WWW" \
    --non-interactive --agree-tos -m "$ACME_EMAIL" --keep-until-expiring
certbot certonly --webroot -w /var/www/certbot \
    -d "$DOMAIN_LEDGER" \
    --non-interactive --agree-tos -m "$ACME_EMAIL" --keep-until-expiring

log "install final nginx site config"
install -m 0644 deploy/nginx/aiagenttrust.dev.conf /etc/nginx/sites-available/aiagenttrust.dev.conf
ln -sf /etc/nginx/sites-available/aiagenttrust.dev.conf /etc/nginx/sites-enabled/aiagenttrust.dev.conf
rm -f /etc/nginx/sites-enabled/atp-bootstrap.conf
nginx -t
systemctl reload nginx

log "done."
log "  profile → https://$DOMAIN_APEX"
log "  badge   → https://$DOMAIN_APEX/badge"
log "  ledger  → https://$DOMAIN_LEDGER/v1/status"
