#!/usr/bin/env bash
# ── deploy.sh ─────────────────────────────────────────────────────────────────
# Run from your laptop to push an update to the VPS.
#
# Usage:
#   SSH_HOST=root@your-server.example.com ./deploy/scripts/deploy.sh
#
# Optional env:
#   SSH_PORT=22
#   APP_DIR=/opt/atp/agent-trust-protocol
#
# What it does:
#   1. rsyncs working copy to the server (excluding node_modules/dist/data/state)
#   2. installs deps, builds, reloads systemd units if they changed
#   3. restarts services, runs a health check
set -euo pipefail

SSH_HOST="${SSH_HOST:?set SSH_HOST, e.g. root@srv-123.hstgr.cloud}"
SSH_PORT="${SSH_PORT:-22}"
APP_DIR="${APP_DIR:-/opt/atp/agent-trust-protocol}"
LOCAL_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }

log "syncing code → $SSH_HOST:$APP_DIR"
rsync -avz --delete \
    -e "ssh -p $SSH_PORT" \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude 'examples/reference-agent/state.json' \
    --exclude 'data' \
    "$LOCAL_DIR/" "$SSH_HOST:$APP_DIR/"

log "install + build on server"
ssh -p "$SSH_PORT" "$SSH_HOST" bash -s <<EOF
set -euo pipefail
cd $APP_DIR
sudo -u atp npm ci --no-audit --no-fund
sudo -u atp npm run build

# Reinstall systemd units only if they changed
if ! cmp -s deploy/systemd/atp-ledger.service /etc/systemd/system/atp-ledger.service; then
    install -m 0644 deploy/systemd/atp-ledger.service /etc/systemd/system/atp-ledger.service
    systemctl daemon-reload
fi
if ! cmp -s deploy/systemd/atp-profile.service /etc/systemd/system/atp-profile.service; then
    install -m 0644 deploy/systemd/atp-profile.service /etc/systemd/system/atp-profile.service
    systemctl daemon-reload
fi

# Reinstall nginx configs if changed, reload
if ! cmp -s deploy/nginx/aiagenttrust.dev.conf /etc/nginx/sites-available/aiagenttrust.dev.conf; then
    install -m 0644 deploy/nginx/aiagenttrust.dev.conf /etc/nginx/sites-available/aiagenttrust.dev.conf
    nginx -t && systemctl reload nginx
fi

systemctl restart atp-ledger.service
sleep 1
systemctl restart atp-profile.service
sleep 1
systemctl is-active --quiet atp-ledger || { journalctl -u atp-ledger -n 40 --no-pager; exit 1; }
systemctl is-active --quiet atp-profile || { journalctl -u atp-profile -n 40 --no-pager; exit 1; }
EOF

log "healthcheck"
if curl -fsS --max-time 10 "https://aiagenttrust.dev/api/profile" >/dev/null; then
    log "profile OK"
else
    log "profile DOWN — check: ssh $SSH_HOST journalctl -u atp-profile -n 50"
    exit 1
fi
if curl -fsS --max-time 10 "https://ledger.aiagenttrust.dev/v1/status" >/dev/null; then
    log "ledger OK"
else
    log "ledger DOWN — check: ssh $SSH_HOST journalctl -u atp-ledger -n 50"
    exit 1
fi

log "done — https://aiagenttrust.dev"
