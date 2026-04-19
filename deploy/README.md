# ATP — Deployment (v0.1 sandbox)

This directory contains everything needed to run the reference deployment of
Agent Trust Protocol on a fresh Debian/Ubuntu VPS (tested on Hostinger KVM).

```
deploy/
├── scripts/
│   ├── server-bootstrap.sh   # first-time setup, run as root on the VPS
│   └── deploy.sh             # run from your laptop to push updates
├── systemd/
│   ├── atp-ledger.service    # federated ledger on :4545
│   └── atp-profile.service   # reference-agent profile on :4546
└── nginx/
    ├── aiagenttrust.dev.conf # TLS vhost: apex+www → profile, ledger.* → ledger
    └── rate-limit.conf       # 10 r/s per-IP zone used by the ledger vhost
```

## What you end up with

- `https://aiagenttrust.dev` and `https://www.aiagenttrust.dev` → the reference
  agent's trust profile (reads from the ledger, renders signed attestations).
- `https://aiagenttrust.dev/badge` → the embeddable badge.
- `https://ledger.aiagenttrust.dev/v1/status` → the ledger's public API.
- Both services managed by systemd, auto-restart on failure, logs in the journal.
- TLS from Let's Encrypt, auto-renewing via the `certbot.timer` installed by
  the `certbot` package.
- Data persisted to `/var/lib/atp/ledger/` as append-only JSONL (replayed on
  startup — surviving restarts).

## Prerequisites

1. **A VPS** — 1 vCPU / 1 GB RAM is plenty at v0.1 scale.
2. **A domain** — this guide assumes `aiagenttrust.dev`. If yours is different,
   search-and-replace in `deploy/nginx/aiagenttrust.dev.conf` and
   `deploy/scripts/server-bootstrap.sh` before running.
3. **SSH access as root** (or a sudoer that can become root).
4. **Git repo reachable from the VPS** — easiest is a public GitHub URL. If
   private, set up a deploy key before running the bootstrap.

## Step 1 — DNS

Point three records at the VPS's public IPv4 address. Use a low TTL
(300s) so you can correct mistakes quickly.

| Type | Name    | Value            | TTL |
|------|---------|------------------|-----|
| A    | @       | `YOUR_VPS_IPV4`  | 300 |
| A    | www     | `YOUR_VPS_IPV4`  | 300 |
| A    | ledger  | `YOUR_VPS_IPV4`  | 300 |

Optional, if you have IPv6:

| Type | Name    | Value            | TTL |
|------|---------|------------------|-----|
| AAAA | @       | `YOUR_VPS_IPV6`  | 300 |
| AAAA | www     | `YOUR_VPS_IPV6`  | 300 |
| AAAA | ledger  | `YOUR_VPS_IPV6`  | 300 |

Wait until all three resolve. On your laptop:

```bash
dig +short aiagenttrust.dev
dig +short www.aiagenttrust.dev
dig +short ledger.aiagenttrust.dev
```

All three must return your server's IP before the next step — Let's Encrypt
will try to hit each name and fail the whole bootstrap if any are unresolved.

## Step 2 — First-time bootstrap (on the VPS, as root)

SSH into the server, clone the repo to a temporary location, and run
the bootstrap script. It's idempotent — safe to re-run if something fails
partway through.

```bash
ssh root@YOUR_VPS_HOST
# optional: set a non-default repo URL or ACME email
export REPO_URL="https://github.com/YOUR_USERNAME/agent-trust-protocol.git"
export ACME_EMAIL="you@example.com"

curl -fsSL "$REPO_URL/raw/main/deploy/scripts/server-bootstrap.sh" -o /root/bootstrap.sh
chmod +x /root/bootstrap.sh
/root/bootstrap.sh
```

What the script does, in order:

1. `apt update` + installs nginx, certbot, git, build-essential, ufw.
2. Installs Node.js 22 from NodeSource.
3. Creates the `atp` system user (no login shell) and the directories
   `/opt/atp/` and `/var/lib/atp/ledger/`.
4. Clones (or pulls) the repo to `/opt/atp/agent-trust-protocol`.
5. Runs `npm ci` and `npm run build` as the `atp` user.
6. Installs the two systemd units, starts the ledger, seeds the
   reference-agent's state file on first boot, then starts the profile.
7. Enables ufw for ports 22/80/443.
8. Installs a temporary HTTP-only nginx config so certbot's webroot
   challenge can succeed, then requests certificates for the apex, www,
   and ledger hostnames.
9. Swaps in the final TLS nginx config and reloads.

## Step 3 — Verify

```bash
# on your laptop
curl -fsS https://aiagenttrust.dev/api/profile | jq '.verified_count,.score'
curl -fsS https://ledger.aiagenttrust.dev/v1/status | jq '.committed_batches'
```

You should see a non-zero `verified_count` and a committed batch. Open
`https://aiagenttrust.dev/` in a browser — you should see the reference
agent's profile with the orange "v0.1 SANDBOX" banner, a list of
attestations, and the cryptographic seal.

## Step 4 — Day-to-day updates (from your laptop)

Once bootstrapped, push changes from your working copy with:

```bash
SSH_HOST=root@YOUR_VPS_HOST ./deploy/scripts/deploy.sh
```

Optional env knobs:

- `SSH_PORT=2222` — if you moved SSH off 22.
- `APP_DIR=/opt/atp/agent-trust-protocol` — override if you installed elsewhere.

What it does:

1. `rsync` your working copy to the server (excludes `node_modules`,
   `dist`, `.git`, `data`, and the reference agent's local `state.json`
   so your local dev state never clobbers the live one).
2. SSH in, run `npm ci && npm run build` as the `atp` user.
3. Reinstall systemd units only if the files actually changed.
4. Reinstall the nginx site config only if it changed (and `nginx -t`
   first, so a bad config can't take the site down).
5. Restart `atp-ledger` then `atp-profile`, assert both came up via
   `systemctl is-active`, dump journal on failure.
6. Two public healthchecks — `/api/profile` on the apex and
   `/v1/status` on the ledger. Non-zero exit if either fails.

## Operational notes

- **Logs:** `journalctl -u atp-ledger -f` and `journalctl -u atp-profile -f`.
- **Data:** `/var/lib/atp/ledger/dids.jsonl` and `.../attestations.jsonl`.
  Back these up with any normal tool (rsync, restic, tarsnap). They're
  plain JSON Lines — human-readable, append-only.
- **Resetting the sandbox:** stop the services, `rm` the two JSONL
  files, `rm /opt/atp/agent-trust-protocol/examples/reference-agent/state.json`,
  start the services again. The profile will re-register and re-issue
  its reference attestations.
- **TLS renewal:** handled automatically by `certbot.timer`. Check with
  `systemctl list-timers | grep certbot`.
- **Rate limit:** the ledger vhost caps each IP at 10 req/s with a burst
  of 20. Tune in `deploy/nginx/aiagenttrust.dev.conf` (`limit_req zone=...`)
  once you see real traffic.
- **Ledger body cap:** 64 KB. Attestations are small signed JSON; this
  is a cheap DoS guard. Adjust `client_max_body_size` if you add larger
  credential types.

## What this is not

This is a **v0.1 sandbox**. It runs all five ledger operator keys on the
same machine — the M-of-N threshold is cryptographically real but not
operationally meaningful until the operators are independent parties.
The data directory is a single-node file, not a replicated log. Treat
attestations as **illustrative**, not load-bearing for any downstream
trust decision. The banner on the profile page says as much; don't
remove it until those properties actually hold.
