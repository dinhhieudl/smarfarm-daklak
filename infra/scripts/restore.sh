#!/bin/bash
# ============================================================
# Database Restore Script
# WARNING: This will overwrite the current database!
# ============================================================

set -euo pipefail

# Configuration
S3_BUCKET="${S3_BACKUP_BUCKET:-agritech-backups}"
DB_HOST="${DB_HOST:-timescaledb}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-agritech}"
DB_USER="${DB_SUPERUSER:-postgres}"
RESTORE_DIR="/tmp/restore"

# Check arguments
if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup_timestamp|latest>"
  echo ""
  echo "Available backups:"
  aws s3 ls "s3://${S3_BUCKET}/database/" | awk '{print $2}' | tr -d '/'
  exit 1
fi

BACKUP_ID="$1"
mkdir -p "$RESTORE_DIR"

echo "============================================"
echo "  DATABASE RESTORE"
echo "============================================"
echo "Target: ${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo "Backup: ${BACKUP_ID}"
echo "============================================"
echo ""
echo "⚠️  WARNING: This will overwrite the current database!"
read -p "Type 'RESTORE' to confirm: " CONFIRM

if [ "$CONFIRM" != "RESTORE" ]; then
  echo "Aborted."
  exit 1
fi

# Find backup file
if [ "$BACKUP_ID" = "latest" ]; then
  BACKUP_PATH=$(aws s3 ls "s3://${S3_BUCKET}/database/" | sort | tail -1 | awk '{print $2}' | tr -d '/')
  echo "Latest backup: $BACKUP_PATH"
else
  BACKUP_PATH="$BACKUP_ID"
fi

BACKUP_FILE="${RESTORE_DIR}/agritech_${BACKUP_PATH}.sql.gz"

# Download backup
echo "[$(date)] Downloading backup..."
aws s3 cp "s3://${S3_BUCKET}/database/${BACKUP_PATH}/" "$RESTORE_DIR/" --recursive

# Find the actual file
BACKUP_FILE=$(ls -t ${RESTORE_DIR}/agritech_*.sql.gz | head -1)

if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found"
  exit 1
fi

echo "[$(date)] Backup file: $BACKUP_FILE"
echo "[$(date)] Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Terminate existing connections
echo "[$(date)] Terminating existing connections..."
PGPASSWORD="${DB_SUPERUSER_PASSWORD}" psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"

# Drop and recreate database
echo "[$(date)] Recreating database..."
PGPASSWORD="${DB_SUPERUSER_PASSWORD}" psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};"
PGPASSWORD="${DB_SUPERUSER_PASSWORD}" psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
  -c "CREATE DATABASE ${DB_NAME};"

# Restore
echo "[$(date)] Restoring database (this may take a while)..."
PGPASSWORD="${DB_SUPERUSER_PASSWORD}" pg_restore \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  --verbose \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE" 2>&1 || true

# Verify
echo "[$(date)] Verifying restore..."
TABLE_COUNT=$(PGPASSWORD="${DB_SUPERUSER_PASSWORD}" psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")

echo "[$(date)] Tables restored: $TABLE_COUNT"

# Clean up
rm -rf "$RESTORE_DIR"

echo "[$(date)] Restore completed!"
