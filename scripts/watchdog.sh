#!/bin/bash
# Watchdog — runs every 2 min, auto-recovers crashed services.
# Now also emails on recovery events so you know auto-healing happened.
LOG=/var/log/watchdog.log
TS=$(date '+%Y-%m-%d %H:%M:%S')
SEND=/root/synergific-portal/scripts/send-alert.js

notify() {
  /root/.nvm/versions/node/v22.22.2/bin/node "$SEND" "Auto-recovery: $1" "$2" >/dev/null 2>&1 &
}

# 1. Backend (PM2)
if ! pm2 list 2>/dev/null | grep -q 'online.*synergific-backend'; then
  echo "[$TS] Backend DOWN — restarting" >> $LOG
  cd /root/synergific-portal/dockerfiles/backend && pm2 start index.js --name synergific-backend 2>&1 >> $LOG
  notify "Backend" "Watchdog restarted synergific-backend. Check pm2 logs for crash cause."
fi

# 2. Redis
if ! docker exec redis redis-cli ping 2>/dev/null | grep -q PONG; then
  echo "[$TS] Redis DOWN — restarting" >> $LOG
  docker rm -f redis 2>/dev/null
  docker run -d --name redis --restart unless-stopped redis:latest 2>&1 >> $LOG
  sleep 2
  docker network connect dockerfiles_app_network redis 2>/dev/null
  notify "Redis" "Watchdog restarted Redis container. Active Bull jobs may have been lost."
fi

# 3. Workers — ALERT ONLY (auto-restart removed; was pointing at broken compose file)
WORKERS_UP=$(docker ps --filter "name=dockerfiles-worker" --filter "status=running" -q | wc -l)
if [ "$WORKERS_UP" -lt 5 ]; then
  WSTATE=/var/lib/getlabs-monitor/state/watchdog_workers
  mkdir -p $(dirname "$WSTATE")
  if [ "$(cat "$WSTATE" 2>/dev/null)" != "low" ]; then
    echo "low" > "$WSTATE"
    echo "[$TS] Workers LOW ($WORKERS_UP/10) — manual restart needed" >> $LOG
    notify "Workers LOW ($WORKERS_UP/10)" "Only $WORKERS_UP of 10 dockerfiles-worker containers running. Manual restart needed. Check: docker ps --filter name=dockerfiles-worker"
  fi
else
  echo "ok" > /var/lib/getlabs-monitor/state/watchdog_workers 2>/dev/null
fi

# 4. MongoDB
if ! docker exec mongodb mongosh --quiet --eval 'db.runCommand({ping:1}).ok' userdb 2>/dev/null | grep -q 1; then
  echo "[$TS] MongoDB DOWN — restarting" >> $LOG
  docker restart mongodb 2>&1 >> $LOG
  notify "MongoDB" "Watchdog restarted MongoDB container. Check docker logs mongodb for crash cause."
fi

# 5. Nginx
if ! systemctl is-active --quiet nginx; then
  echo "[$TS] Nginx DOWN — restarting" >> $LOG
  systemctl restart nginx 2>&1 >> $LOG
  notify "Nginx" "Watchdog restarted nginx. Check journalctl -u nginx for crash cause."
fi

# 6. Guacamole
if ! docker ps --format '{{.Names}}' | grep -q guacamole; then
  echo "[$TS] Guacamole DOWN — restarting" >> $LOG
  docker start guacamole guacd guac-db 2>&1 >> $LOG
  notify "Guacamole" "Watchdog restarted Guacamole stack. Students connected via RDP may have been disconnected."
fi

# 7. Frontend check
if [ ! -f /var/www/portal.synergificsoftware.com/frontend/dist/index.html ]; then
  echo "[$TS] Frontend MISSING — redeploying" >> $LOG
  cd /root/synergific-portal/portal.synergificsoftware.com/frontend && npm run build 2>&1 >> $LOG
  cp -r dist/* /var/www/portal.synergificsoftware.com/frontend/dist/
  notify "Frontend" "Watchdog rebuilt frontend because dist/index.html was missing."
fi
