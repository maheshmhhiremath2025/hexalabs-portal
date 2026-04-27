#!/bin/bash
# Alert if disk < 50GB free or RAM < 4GB free
DISK_FREE_GB=$(df / --output=avail | tail -1 | awk '{print int($1/1024/1024)}')
RAM_FREE_MB=$(free -m | awk '/Mem:/{print $7}')

if [ $DISK_FREE_GB -lt 50 ]; then
  echo "[ALERT] Disk critically low: ${DISK_FREE_GB}GB free. Cleaning..."
  docker system prune -f --volumes 2>/dev/null
  docker image prune -a --filter 'until=72h' -f 2>/dev/null
fi

if [ $RAM_FREE_MB -lt 4096 ]; then
  echo "[ALERT] RAM critically low: ${RAM_FREE_MB}MB free."
fi
