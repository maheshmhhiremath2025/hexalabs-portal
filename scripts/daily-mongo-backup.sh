#!/bin/bash
BACKUP_DIR=/root/mongo_backups
DATE=$(date +%Y%m%d_%H%M)
mkdir -p $BACKUP_DIR

echo "[$DATE] Starting MongoDB backup..."
docker exec mongodb mongodump --db userdb --out /tmp/backup_$DATE 2>&1
docker cp mongodb:/tmp/backup_$DATE $BACKUP_DIR/backup_$DATE
docker exec mongodb rm -rf /tmp/backup_$DATE

# Keep only last 7 days of backups
ls -dt $BACKUP_DIR/backup_* | tail -n +8 | xargs rm -rf 2>/dev/null

echo "[$DATE] Backup complete: $BACKUP_DIR/backup_$DATE"
ls -lh $BACKUP_DIR/backup_$DATE/userdb/*.bson | wc -l
echo " collections backed up"
