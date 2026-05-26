#!/bin/bash
# guacd Auto-Scaler for Guacamole
# Monitors guacd container load and adjusts replicas automatically
# Deployed as a systemd timer running every 2 minutes

set -uo pipefail

LOG_FILE="/var/log/guacd-autoscaler.log"
COMPOSE_DIR="/opt/guacamole"
COMPOSE_FILE="$COMPOSE_DIR/docker-compose.yml"

# Scaling thresholds
MIN_REPLICAS=1
MAX_REPLICAS=$(( $(nproc) * 2 ))
if [ "$MAX_REPLICAS" -lt 2 ]; then MAX_REPLICAS=2; fi

# CPU thresholds (percentage per replica, averaged)
SCALE_UP_CPU=60
SCALE_DOWN_CPU=20

# Memory thresholds
SCALE_UP_MEM=70

# Connection-based scaling: each guacd handles ~40 sessions comfortably
SESSIONS_PER_REPLICA=40

# Cooldown: don't scale more than once every 3 minutes
COOLDOWN_FILE="/tmp/guacd-autoscaler-lastscale"
COOLDOWN_SECONDS=180

log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE"
}

get_current_replicas() {
    docker ps --filter "ancestor=guacamole/guacd" --format "{{.ID}}" 2>/dev/null | wc -l | tr -d ' '
}

get_avg_cpu() {
    local stats
    stats=$(docker stats --no-stream --format "{{.Name}} {{.CPUPerc}}" 2>/dev/null | grep "guacamole-guacd-")
    if [ -z "$stats" ]; then
        echo "0"
        return
    fi
    local total=0
    local count=0
    while IFS= read -r line; do
        local cpu
        cpu=$(echo "$line" | awk '{print $2}' | tr -d '%')
        if [ -n "$cpu" ]; then
            total=$(awk "BEGIN {print $total + $cpu}")
            count=$((count + 1))
        fi
    done <<< "$stats"
    if [ "$count" -eq 0 ]; then
        echo "0"
    else
        awk "BEGIN {printf \"%.0f\", $total / $count}"
    fi
}

get_avg_mem_percent() {
    local stats
    stats=$(docker stats --no-stream --format "{{.Name}} {{.MemPerc}}" 2>/dev/null | grep "guacamole-guacd-")
    if [ -z "$stats" ]; then
        echo "0"
        return
    fi
    local total=0
    local count=0
    while IFS= read -r line; do
        local mem_pct
        mem_pct=$(echo "$line" | awk '{print $2}' | tr -d '%')
        if [ -n "$mem_pct" ]; then
            total=$(awk "BEGIN {print $total + $mem_pct}")
            count=$((count + 1))
        fi
    done <<< "$stats"
    if [ "$count" -eq 0 ]; then
        echo "0"
    else
        awk "BEGIN {printf \"%.0f\", $total / $count}"
    fi
}

get_active_sessions() {
    local total=0
    for cid in $(docker ps -q --filter "ancestor=guacamole/guacd" 2>/dev/null); do
        local conns
        conns=$(docker exec "$cid" sh -c 'cat /proc/net/tcp 2>/dev/null | tail -n +2 | wc -l' 2>/dev/null || echo "0")
        total=$((total + conns))
    done
    echo "$total"
}

check_cooldown() {
    if [ -f "$COOLDOWN_FILE" ]; then
        local last now diff
        last=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo "0")
        now=$(date +%s)
        diff=$((now - last))
        if [ "$diff" -lt "$COOLDOWN_SECONDS" ]; then
            return 1
        fi
    fi
    return 0
}

set_cooldown() {
    date +%s > "$COOLDOWN_FILE"
}

scale_to() {
    local target=$1
    local reason=$2

    if ! check_cooldown; then
        log "COOLDOWN: Wanted to scale to $target ($reason) but in cooldown period"
        return
    fi

    log "SCALING: $current_replicas -> $target replicas ($reason)"
    cd "$COMPOSE_DIR"
    docker compose -f "$COMPOSE_FILE" up -d --scale guacd="$target" --no-recreate 2>>"$LOG_FILE"

    if [ $? -eq 0 ]; then
        log "SUCCESS: Scaled guacd to $target replicas"
        set_cooldown
    else
        log "ERROR: Failed to scale guacd to $target"
    fi
}

# === Main Logic ===

current_replicas=$(get_current_replicas)
if [ -z "$current_replicas" ] || [ "$current_replicas" -eq 0 ] 2>/dev/null; then
    log "WARNING: No running guacd containers found. Starting 1 replica."
    cd "$COMPOSE_DIR"
    docker compose -f "$COMPOSE_FILE" up -d --scale guacd=1 2>>"$LOG_FILE"
    log "Started 1 guacd replica"
    exit 0
fi

avg_cpu=$(get_avg_cpu)
avg_mem=$(get_avg_mem_percent)
active_sessions=$(get_active_sessions)

# Calculate desired replicas based on sessions
if [ "$active_sessions" -gt 0 ]; then
    session_based_replicas=$(( (active_sessions + SESSIONS_PER_REPLICA - 1) / SESSIONS_PER_REPLICA ))
else
    session_based_replicas=1
fi

log "STATUS: replicas=$current_replicas avg_cpu=${avg_cpu}% avg_mem=${avg_mem}% sessions=$active_sessions session_target=$session_based_replicas"

desired=$current_replicas
reason="none"

# Scale UP conditions
if [ "$avg_cpu" -gt "$SCALE_UP_CPU" ] 2>/dev/null; then
    desired=$((current_replicas + 1))
    reason="high-cpu(${avg_cpu}%>${SCALE_UP_CPU}%)"
elif [ "$avg_mem" -gt "$SCALE_UP_MEM" ] 2>/dev/null; then
    desired=$((current_replicas + 1))
    reason="high-mem(${avg_mem}%>${SCALE_UP_MEM}%)"
elif [ "$session_based_replicas" -gt "$current_replicas" ]; then
    desired=$session_based_replicas
    reason="session-demand(${active_sessions}sessions)"
fi

# Scale DOWN conditions (only if no scale-up triggered)
if [ "$desired" -eq "$current_replicas" ]; then
    if [ "$avg_cpu" -lt "$SCALE_DOWN_CPU" ] 2>/dev/null && \
       [ "$current_replicas" -gt "$session_based_replicas" ] && \
       [ "$current_replicas" -gt "$MIN_REPLICAS" ]; then
        desired=$((current_replicas - 1))
        if [ "$desired" -lt "$session_based_replicas" ]; then desired=$session_based_replicas; fi
        reason="low-cpu(${avg_cpu}%<${SCALE_DOWN_CPU}%)"
    fi
fi

# Enforce bounds
if [ "$desired" -lt "$MIN_REPLICAS" ]; then desired=$MIN_REPLICAS; fi
if [ "$desired" -gt "$MAX_REPLICAS" ]; then desired=$MAX_REPLICAS; fi

# Apply scaling if needed
if [ "$desired" -ne "$current_replicas" ]; then
    scale_to "$desired" "$reason"
else
    log "NO-CHANGE: $current_replicas replicas is optimal"
fi
