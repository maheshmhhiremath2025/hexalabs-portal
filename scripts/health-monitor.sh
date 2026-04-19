#!/usr/bin/env bash
# GetLabs prod health monitor — runs from cron every 10 min.
#
# Sends email alert on STATE CHANGE only (ok→fail OR fail→ok). Silent if
# state hasn't changed since last tick — otherwise inbox floods when
# something's broken for hours. First-ever run records baseline silently.
#
# Each check writes its current state to /var/lib/getlabs-monitor/state/<name>.
# Changes trigger exactly one email. Recoveries also email (so you know
# a problem cleared without having to check the dashboard).
#
# Replaces the older resource-monitor.sh (disk cleanup behavior preserved).

set +e  # never exit mid-script; always run all checks

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEND_ALERT="$SCRIPT_DIR/send-alert.js"
STATE_DIR="/var/lib/getlabs-monitor/state"
LOG="/var/log/getlabs-monitor.log"
mkdir -p "$STATE_DIR"

# node needs to be on PATH for cron — nvm puts it outside the default cron PATH
if ! command -v node >/dev/null 2>&1; then
  NODE_BIN="$(ls -t /root/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)"
  [ -n "$NODE_BIN" ] && export PATH="$(dirname "$NODE_BIN"):$PATH"
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# alert_on_change <check_name> <"ok"|"fail"> <subject_on_change> <body_on_change>
alert_on_change() {
  local name="$1" curr="$2" subject="$3" body="$4"
  local sf="$STATE_DIR/$name"
  local prev
  prev="$(cat "$sf" 2>/dev/null)"
  if [ -z "$prev" ]; then
    # First time we see this check — record silently, don't alert
    echo "$curr" > "$sf"
    log "init $name=$curr"
    return
  fi
  if [ "$prev" != "$curr" ]; then
    echo "$curr" > "$sf"
    log "CHANGE $name: $prev -> $curr"
    node "$SEND_ALERT" "$subject" "$body" 2>&1 | tee -a "$LOG" >/dev/null
  fi
}

# ─── check 1: backend /health ────────────────────────────────────────────
if curl -s --max-time 5 http://127.0.0.1:8001/health | grep -q '"status":"healthy"'; then
  alert_on_change backend ok "Backend RECOVERED" "Backend /health is responding again."
else
  alert_on_change backend fail "Backend DOWN" \
    "Backend /health not responding at http://127.0.0.1:8001/health. Check: pm2 list; pm2 logs synergific-backend --err --lines 30"
fi

# ─── check 1b: PUBLIC URL reachability (what customers actually see) ─────
# Was added after a 2026-04-19 incident where /etc/nginx/sites-enabled/
# getlabs.cloud.broken coexisted with the live config, causing
# intermittent 404s on https://getlabs.cloud/. Local /health returned
# healthy the whole time because it bypassed nginx. Now we also test
# from the outside (via the public domain) to catch nginx-level issues.
PUBLIC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 https://getlabs.cloud/ || echo "000")
if [ "$PUBLIC_STATUS" = "200" ]; then
  alert_on_change public_site ok "Public site RECOVERED" "https://getlabs.cloud/ is returning 200 again."
else
  alert_on_change public_site fail "Public site BROKEN (HTTP $PUBLIC_STATUS)" \
    "https://getlabs.cloud/ returned HTTP $PUBLIC_STATUS — customers cannot reach the login page. Check nginx first: nginx -t; nginx -T 2>&1 | grep -i warn; ls /etc/nginx/sites-enabled/"
fi

# ─── check 1c: nginx config warnings (catches duplicate server_names) ────
# grep -c exits 1 when there are no matches (still prints "0") — use `|| true`
# to swallow the exit code without appending extra output to the var.
NGINX_WARN_OUTPUT=$(nginx -t 2>&1 | grep -iE "warn|conflict" || true)
if [ -z "$NGINX_WARN_OUTPUT" ]; then
  alert_on_change nginx_warn ok "nginx config RECOVERED" "nginx -t is clean again."
else
  alert_on_change nginx_warn fail "nginx config has warnings" \
    "nginx -t reported warnings. Likely a duplicate server_name or stale file in sites-enabled/ (never use .broken/.old/.bak rename — remove the symlink instead). Details: $(echo "$NGINX_WARN_OUTPUT" | head -3)"
fi

# ─── check 2: PM2 restart count jumped since last tick ───────────────────
CURR_RESTARTS=$(pm2 jlist 2>/dev/null | node -e '
  let d = "";
  process.stdin.on("data", c => d += c);
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(d || "[]");
      const p = j.find(x => x.name === "synergific-backend");
      console.log(p ? p.pm2_env.restart_time : 0);
    } catch (e) { console.log(0); }
  });
' 2>/dev/null)
CURR_RESTARTS="${CURR_RESTARTS:-0}"
PREV_RESTARTS="$(cat "$STATE_DIR/pm2_restarts" 2>/dev/null || echo "")"
if [ -n "$PREV_RESTARTS" ] && [ "$CURR_RESTARTS" -gt "$PREV_RESTARTS" ]; then
  JUMP=$((CURR_RESTARTS - PREV_RESTARTS))
  log "ALERT pm2 restarts jumped $PREV_RESTARTS -> $CURR_RESTARTS"
  node "$SEND_ALERT" "Backend crashed $JUMP time(s) in last 10min" \
    "PM2 restart count went from $PREV_RESTARTS to $CURR_RESTARTS. Likely a new bug or flaky client. Inspect: pm2 logs synergific-backend --err --lines 80" 2>&1 >> "$LOG"
fi
echo "$CURR_RESTARTS" > "$STATE_DIR/pm2_restarts"

# ─── check 3: 10 healthy workers ─────────────────────────────────────────
W_COUNT=$(docker ps --filter "name=dockerfiles-worker" --filter "status=running" -q 2>/dev/null | wc -l)
if [ "$W_COUNT" -ge 10 ]; then
  alert_on_change workers ok "Workers RECOVERED" "All 10 dockerfiles-worker-* running again."
else
  alert_on_change workers fail "Workers DEGRADED ($W_COUNT/10 running)" \
    "Only $W_COUNT of 10 dockerfiles-worker containers are running. Check: docker ps --filter name=dockerfiles-worker"
fi

# ─── check 4: mongo ping ─────────────────────────────────────────────────
if docker exec mongodb mongosh --quiet --eval "db.runCommand({ping:1}).ok" userdb 2>/dev/null | grep -q 1; then
  alert_on_change mongo ok "MongoDB RECOVERED" "MongoDB is responding again."
else
  alert_on_change mongo fail "MongoDB DOWN" \
    "MongoDB not responding to ping. Check: docker logs mongodb --tail 50"
fi

# ─── check 5: redis ping ─────────────────────────────────────────────────
if docker exec redis redis-cli ping 2>/dev/null | grep -q PONG; then
  alert_on_change redis ok "Redis RECOVERED" "Redis is responding again."
else
  alert_on_change redis fail "Redis DOWN" \
    "Redis not responding. Check: docker logs redis --tail 50"
fi

# ─── check 6: disk free (also auto-prune when low — preserved from old script) ─
DISK_FREE_GB=$(df / --output=avail | tail -1 | awk '{print int($1/1024/1024)}')
if [ "${DISK_FREE_GB:-0}" -lt 50 ]; then
  alert_on_change disk fail "Disk LOW (${DISK_FREE_GB}GB free)" \
    "Disk free is ${DISK_FREE_GB}GB. Auto-pruning docker images; check /var/log/getlabs-monitor.log for result."
  docker system prune -f --volumes 2>/dev/null | tail -3 >> "$LOG"
  docker image prune -a --filter 'until=72h' -f 2>/dev/null | tail -3 >> "$LOG"
else
  alert_on_change disk ok "Disk RECOVERED (${DISK_FREE_GB}GB free)" "Disk is back to ${DISK_FREE_GB}GB free."
fi

# ─── check 7: available RAM ──────────────────────────────────────────────
RAM_FREE_MB=$(free -m | awk '/Mem:/{print $7}')
if [ "${RAM_FREE_MB:-0}" -lt 4096 ]; then
  alert_on_change ram fail "RAM LOW (${RAM_FREE_MB}MB free)" "Available RAM is ${RAM_FREE_MB}MB."
else
  alert_on_change ram ok "RAM RECOVERED (${RAM_FREE_MB}MB free)" "RAM is back to ${RAM_FREE_MB}MB free."
fi

# ─── check 8: 15-min load average ────────────────────────────────────────
LOAD15=$(awk '{print $3}' /proc/loadavg)
LOAD_INT=${LOAD15%.*}
if [ "${LOAD_INT:-0}" -ge 8 ]; then
  alert_on_change load fail "Load HIGH ($LOAD15)" "15-min load average is $LOAD15 — server under stress."
else
  alert_on_change load ok "Load RECOVERED ($LOAD15)" "15-min load is back to $LOAD15."
fi

log "tick complete"
