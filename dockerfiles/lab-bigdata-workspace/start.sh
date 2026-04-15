#!/bin/bash
# =============================================================================
# start.sh — bootstrap + service orchestration for lab-bigdata-workspace
#
# Responsibilities:
#   1. Initialize MySQL data dir on first start
#   2. Initialize Kafka KRaft metadata on first start
#   3. Flip supervisord autostart flags based on ENABLE_* env vars
#   4. Hand off to supervisord
#
# Env var knobs (all default to sensible values for a 3-day big-data course):
#   ENABLE_SSH         = false  (use the browser terminal instead)
#   ENABLE_KAFKA       = true
#   ENABLE_SPARK       = true
#   ENABLE_CASSANDRA   = false  (heavy; enable only if the course needs it)
#   ENABLE_JUPYTER     = false
#   LAB_PASSWORD       = Welcome1234!  (password for the 'lab' user)
# =============================================================================
set -euo pipefail

ENABLE_SSH="${ENABLE_SSH:-false}"
ENABLE_KAFKA="${ENABLE_KAFKA:-true}"
ENABLE_SPARK="${ENABLE_SPARK:-true}"
ENABLE_CASSANDRA="${ENABLE_CASSANDRA:-false}"
ENABLE_JUPYTER="${ENABLE_JUPYTER:-false}"
LAB_PASSWORD="${LAB_PASSWORD:-Welcome1234!}"

log() { echo "[start.sh] $*"; }

# ---------------------------------------------------------------------------
# 1. Apply the lab user password if overridden at runtime.
# ---------------------------------------------------------------------------
echo "lab:${LAB_PASSWORD}" | chpasswd

# ---------------------------------------------------------------------------
# 2. MySQL bootstrap — first start only.
# ---------------------------------------------------------------------------
if [ ! -d /var/lib/mysql/mysql ]; then
  log "Initializing MySQL data dir…"
  mysqld --initialize-insecure --user=mysql --datadir=/var/lib/mysql
  chown -R mysql:mysql /var/lib/mysql
fi

# Start MySQL transiently so we can seed a lab database/user before supervisor
# takes over.
log "Starting MySQL briefly to seed lab database…"
mysqld --user=mysql --datadir=/var/lib/mysql --bind-address=127.0.0.1 --daemonize

# Wait until it accepts connections (max ~10s)
for i in {1..20}; do
  if mysqladmin ping --silent 2>/dev/null; then break; fi
  sleep 0.5
done

if mysqladmin ping --silent 2>/dev/null; then
  mysql -uroot <<SQL || true
    CREATE DATABASE IF NOT EXISTS labdb;
    CREATE USER IF NOT EXISTS 'lab'@'localhost' IDENTIFIED BY '${LAB_PASSWORD}';
    GRANT ALL PRIVILEGES ON labdb.* TO 'lab'@'localhost';
    FLUSH PRIVILEGES;
SQL
  log "MySQL lab database ready (user=lab, db=labdb)"
fi

# Stop the transient instance; supervisor will restart it.
mysqladmin -uroot shutdown 2>/dev/null || true
sleep 1

# ---------------------------------------------------------------------------
# 3. Kafka KRaft bootstrap — first start only.
# ---------------------------------------------------------------------------
if [ "${ENABLE_KAFKA}" = "true" ] && [ ! -f /tmp/kraft-combined-logs/meta.properties ]; then
  log "Formatting Kafka KRaft metadata…"
  CLUSTER_ID=$(/opt/kafka/bin/kafka-storage.sh random-uuid)
  /opt/kafka/bin/kafka-storage.sh format -t "$CLUSTER_ID" -c /opt/kafka/config/kraft/server.properties
  log "Kafka KRaft formatted with cluster id $CLUSTER_ID"
fi

# ---------------------------------------------------------------------------
# 4. Flip supervisord autostart flags based on env vars.
# ---------------------------------------------------------------------------
# We edit the supervisord config in place before supervisord boots. This
# avoids the need for a dynamic process group.
flip_autostart() {
  local program=$1
  local enabled=$2
  local value="false"
  [ "$enabled" = "true" ] && value="true"
  # Match the [program:xxx] block and set autostart within it
  sed -i "/^\[program:${program}\]/,/^\[/{s/^autostart=.*/autostart=${value}/}" \
      /etc/supervisor/conf.d/lab.conf
}

flip_autostart sshd "${ENABLE_SSH}"
flip_autostart kafka "${ENABLE_KAFKA}"
flip_autostart spark-master "${ENABLE_SPARK}"
flip_autostart spark-worker "${ENABLE_SPARK}"
flip_autostart cassandra "${ENABLE_CASSANDRA}"
flip_autostart jupyter "${ENABLE_JUPYTER}"

log "Service matrix:"
log "  ttyd (browser terminal): ON  (always)"
log "  mysql:                    ON  (always)"
log "  sshd:                     ${ENABLE_SSH}"
log "  kafka:                    ${ENABLE_KAFKA}"
log "  spark-master + worker:    ${ENABLE_SPARK}"
log "  cassandra:                ${ENABLE_CASSANDRA}"
log "  jupyter:                  ${ENABLE_JUPYTER}"

# ---------------------------------------------------------------------------
# 5. Print the welcome banner and hand off to supervisord.
# ---------------------------------------------------------------------------
cat /etc/motd 2>/dev/null || true

log "Starting supervisord…"
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
