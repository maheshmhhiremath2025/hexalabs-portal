#!/usr/bin/env bash
# GetLabs portal deploy script — pulls latest, rebuilds frontend, reinstalls
# backend deps, restarts PM2.
#
# Run on the prod server as root from the repo root:
#   bash scripts/deploy.sh
#
# Per the project's server rules:
#   - Frontend builds ONLY from /root/synergific-portal/.../frontend/
#     The dist/ is symlinked to /var/www/. NEVER build from /var/www/.
#   - Mongoose strict mode strips unknown fields, so model + DB must be in sync
#     before deploying schema changes.
#   - Backend (PM2 on host) and worker (Docker) Redis URLs differ — script
#     never touches that config.
#
# Exits non-zero on any failure (set -e).

set -euo pipefail

# Resolve script location → repo root, regardless of CWD when invoked
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$REPO_ROOT/portal.synergificsoftware.com/frontend"
BACKEND_DIR="$REPO_ROOT/dockerfiles/backend"

# Override these with env vars if your setup differs:
#   PM2_BACKEND_NAME=myapi bash scripts/deploy.sh
PM2_BACKEND_NAME="${PM2_BACKEND_NAME:-all}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SKIP_GIT="${SKIP_GIT:-0}"          # set to 1 to skip git pull (e.g. local-only changes)
SKIP_FRONTEND="${SKIP_FRONTEND:-0}" # set to 1 if only backend changed
SKIP_BACKEND="${SKIP_BACKEND:-0}"   # set to 1 if only frontend changed

log()   { printf '\033[1;34m[deploy %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn()  { printf '\033[1;33m[deploy %s] WARN:\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
error() { printf '\033[1;31m[deploy %s] ERROR:\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }

# Print summary on exit (success or failure)
trap 'rc=$?; if [ $rc -eq 0 ]; then log "Deploy completed successfully"; else error "Deploy FAILED at step above (exit $rc)"; fi' EXIT

log "Repo root: $REPO_ROOT"
cd "$REPO_ROOT"

# ─── 1. Git pull ──────────────────────────────────────────────────────────────
if [ "$SKIP_GIT" = "1" ]; then
  warn "SKIP_GIT=1 — not pulling latest"
else
  log "Pulling latest from origin/$GIT_BRANCH..."
  # Stash any uncommitted changes so the pull doesn't abort. Restore them after.
  STASH_REF=""
  if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Uncommitted changes detected — stashing before pull"
    git stash push -u -m "deploy.sh auto-stash $(date +%s)" >/dev/null
    STASH_REF="$(git stash list | head -1 | cut -d: -f1)"
  fi
  git fetch origin "$GIT_BRANCH"
  git reset --hard "origin/$GIT_BRANCH"
  if [ -n "$STASH_REF" ]; then
    warn "Stashed local changes are still in $STASH_REF — review with 'git stash list'"
  fi
fi

# ─── 2. Frontend build ────────────────────────────────────────────────────────
if [ "$SKIP_FRONTEND" = "1" ]; then
  warn "SKIP_FRONTEND=1 — not rebuilding frontend"
else
  log "Frontend: installing deps in $FRONTEND_DIR"
  cd "$FRONTEND_DIR"
  # Use ci when lockfile is present + matches package.json (faster, deterministic).
  # Fall back to install if ci would fail (e.g. lockfile drift after manual edits).
  if [ -f package-lock.json ]; then
    npm ci --no-audit --no-fund || {
      warn "npm ci failed — falling back to npm install (lockfile may be out of sync)"
      npm install --no-audit --no-fund
    }
  else
    npm install --no-audit --no-fund
  fi

  log "Frontend: building production bundle"
  npm run build
  log "Frontend: built. dist/ is at $FRONTEND_DIR/dist (symlinked to /var/www/)"
fi

# ─── 3. Backend deps ──────────────────────────────────────────────────────────
if [ "$SKIP_BACKEND" = "1" ]; then
  warn "SKIP_BACKEND=1 — not reinstalling backend deps"
else
  log "Backend: installing deps in $BACKEND_DIR"
  cd "$BACKEND_DIR"
  # Backend's package-lock.json is gitignored, so fall back to install always.
  npm install --no-audit --no-fund --omit=dev

  # ─── 4. PM2 restart ─────────────────────────────────────────────────────────
  if ! command -v pm2 >/dev/null 2>&1; then
    error "pm2 not found in PATH — install it (npm i -g pm2) or restart the backend manually"
    exit 1
  fi

  log "Restarting PM2 process: $PM2_BACKEND_NAME"
  pm2 restart "$PM2_BACKEND_NAME" --update-env
  pm2 save >/dev/null 2>&1 || true   # persist process list in case server reboots
fi

# ─── 5. Health check ──────────────────────────────────────────────────────────
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8001/health}"
log "Hitting $HEALTH_URL ..."
sleep 2  # give backend a moment to bind the port
if command -v curl >/dev/null 2>&1; then
  HTTP_CODE=$(curl -s -o /tmp/deploy-health.json -w "%{http_code}" "$HEALTH_URL" || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    log "Health OK ($HTTP_CODE) — $(cat /tmp/deploy-health.json)"
  else
    warn "Health check returned $HTTP_CODE — check 'pm2 logs $PM2_BACKEND_NAME' for errors"
    [ -s /tmp/deploy-health.json ] && warn "Body: $(cat /tmp/deploy-health.json)"
  fi
  rm -f /tmp/deploy-health.json
else
  warn "curl not found — skipping health check"
fi

log "Done."
