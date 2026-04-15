#!/bin/bash
# =============================================================================
# MongoDB Backup Script
#
# Runs mongodump, compresses the output, and retains the last 7 days.
# Zero cost — stores backups on local disk. For offsite, add an az/aws
# upload command at the bottom (commented out as examples).
#
# Usage:
#   Manual:    ./scripts/backup-mongo.sh
#   Cron:      0 2 * * * cd /path/to/backend && ./scripts/backup-mongo.sh >> /var/log/mongo-backup.log 2>&1
#              (runs at 2 AM daily)
#
# For docker-compose deployments, the MONGO_URI defaults to the
# docker-compose service name. Override with env var if different.
# =============================================================================

set -euo pipefail

MONGO_URI="${MONGO_URI:-mongodb://mongodb:27017/cloudportal}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/mongodb}"
RETAIN_DAYS="${RETAIN_DAYS:-7}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="cloudportal_${TIMESTAMP}"

echo "[$(date)] Starting MongoDB backup..."

# Create backup directory
mkdir -p "${BACKUP_DIR}"

# Run mongodump
mongodump --uri="${MONGO_URI}" --out="${BACKUP_DIR}/${BACKUP_NAME}" --quiet

# Compress
cd "${BACKUP_DIR}"
tar -czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}"
rm -rf "${BACKUP_NAME}"

# Calculate size
SIZE=$(du -sh "${BACKUP_NAME}.tar.gz" | cut -f1)
echo "[$(date)] Backup created: ${BACKUP_NAME}.tar.gz (${SIZE})"

# Cleanup old backups (retain last N days)
find "${BACKUP_DIR}" -name "cloudportal_*.tar.gz" -mtime +${RETAIN_DAYS} -delete
REMAINING=$(ls -1 "${BACKUP_DIR}"/cloudportal_*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
echo "[$(date)] Retained ${REMAINING} backup(s) (last ${RETAIN_DAYS} days)"

# ─── Optional: Upload to Azure Blob Storage (uncomment to enable) ────────
# Requires: az cli installed + logged in
# AZURE_CONTAINER="mongodb-backups"
# AZURE_ACCOUNT="yourstorageaccount"
# az storage blob upload \
#   --account-name "${AZURE_ACCOUNT}" \
#   --container-name "${AZURE_CONTAINER}" \
#   --file "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" \
#   --name "${BACKUP_NAME}.tar.gz" \
#   --auth-mode login
# echo "[$(date)] Uploaded to Azure Blob: ${AZURE_CONTAINER}/${BACKUP_NAME}.tar.gz"

# ─── Optional: Upload to AWS S3 (uncomment to enable) ────────────────────
# Requires: aws cli installed + configured
# S3_BUCKET="s3://your-bucket/mongodb-backups"
# aws s3 cp "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" "${S3_BUCKET}/${BACKUP_NAME}.tar.gz"
# echo "[$(date)] Uploaded to S3: ${S3_BUCKET}/${BACKUP_NAME}.tar.gz"

echo "[$(date)] Backup complete."
