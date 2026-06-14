#!/bin/bash
# ============================================================
# Database Backup Script
# Run via cron or AWS Systems Manager
# ============================================================
# Cron: 0 3 * * * /opt/agritech/scripts/backup.sh
# ============================================================

set -euo pipefail

# Configuration
BACKUP_DIR="/tmp/backups"
S3_BUCKET="${S3_BACKUP_BUCKET:-agritech-backups}"
DB_HOST="${DB_HOST:-timescaledb}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-agritech}"
DB_USER="${DB_SUPERUSER:-postgres}"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/agritech_${TIMESTAMP}.sql.gz"
METRICS_FILE="/tmp/backup_metrics.prom"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# -----------------------------------------------------------
# Step 1: Create database dump
# -----------------------------------------------------------
echo "[$(date)] Dumping database..."
PGPASSWORD="${DB_SUPERUSER_PASSWORD}" pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --format=custom \
  --compress=9 \
  --verbose \
  --file="$BACKUP_FILE" 2>&1

BACKUP_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE")
echo "[$(date)] Backup size: $(numfmt --to=iec-i "$BACKUP_SIZE")"

# -----------------------------------------------------------
# Step 2: Upload to S3
# -----------------------------------------------------------
echo "[$(date)] Uploading to S3..."
aws s3 cp "$BACKUP_FILE" "s3://${S3_BUCKET}/database/${TIMESTAMP}/" \
  --sse aws:kms \
  --storage-class STANDARD_IA

echo "[$(date)] Upload complete"

# -----------------------------------------------------------
# Step 3: Verify backup integrity
# -----------------------------------------------------------
echo "[$(date)] Verifying backup..."
if pg_restore --list "$BACKUP_FILE" > /dev/null 2>&1; then
  echo "[$(date)] Backup verification: PASSED"
  BACKUP_STATUS=1
else
  echo "[$(date)] Backup verification: FAILED"
  BACKUP_STATUS=0
fi

# -----------------------------------------------------------
# Step 4: Clean up old local backups
# -----------------------------------------------------------
echo "[$(date)] Cleaning old local backups..."
find "$BACKUP_DIR" -name "agritech_*.sql.gz" -mtime +${RETENTION_DAYS} -delete

# -----------------------------------------------------------
# Step 5: Clean up old S3 backups (keep 30 days)
# -----------------------------------------------------------
echo "[$(date)] Cleaning old S3 backups..."
CUTOFF_DATE=$(date -d "-30 days" +%Y%m%d 2>/dev/null || date -v-30d +%Y%m%d)
aws s3 ls "s3://${S3_BUCKET}/database/" | while read -r line; do
  FOLDER_DATE=$(echo "$line" | awk '{print $2}' | tr -d '/')
  if [[ "$FOLDER_DATE" < "$CUTOFF_DATE" ]]; then
    echo "  Deleting s3://${S3_BUCKET}/database/${FOLDER_DATE}/"
    aws s3 rm "s3://${S3_BUCKET}/database/${FOLDER_DATE}/" --recursive
  fi
done

# -----------------------------------------------------------
# Step 6: Write Prometheus metrics
# -----------------------------------------------------------
cat > "$METRICS_FILE" << EOF
# HELP agritech_backup_last_success_timestamp Last successful backup timestamp
# TYPE agritech_backup_last_success_timestamp gauge
agritech_backup_last_success_timestamp $(date +%s)
# HELP agritech_backup_last_size_bytes Last backup size in bytes
# TYPE agritech_backup_last_size_bytes gauge
agritech_backup_last_size_bytes ${BACKUP_SIZE}
# HELP agritech_backup_last_status Last backup status (1=success, 0=failure)
# TYPE agritech_backup_last_status gauge
agritech_backup_last_status ${BACKUP_STATUS}
# HELP agritech_backup_duration_seconds Backup duration in seconds
# TYPE agritech_backup_duration_seconds gauge
agritech_backup_duration_seconds $SECONDS
EOF

# Copy metrics to node-exporter textfile directory
cp "$METRICS_FILE" /var/lib/node_exporter/textfile_collector/backup.prom

# Clean up
rm -f "$BACKUP_FILE"

echo "[$(date)] Backup completed in ${SECONDS}s"
echo "[$(date)] Status: $( [ $BACKUP_STATUS -eq 1 ] && echo 'SUCCESS' || echo 'FAILURE' )"

exit $( [ $BACKUP_STATUS -eq 1 ] && echo 0 || echo 1 )
