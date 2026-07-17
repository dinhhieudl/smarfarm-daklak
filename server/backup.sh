#!/bin/bash
# SmartFarm DakLak Backup Script
BACKUP_DIR="/backups/smartfarm/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# InfluxDB backup
docker exec sf-influxdb influx backup /tmp/influx-backup --org smarfarm --token "${INFLUXDB_TOKEN:-smarfarm-token-2026}"
docker cp sf-influxdb:/tmp/influx-backup "$BACKUP_DIR/influxdb"

# PostgreSQL backup
docker exec sf-postgres pg_dump -U chirpstack chirpstack > "$BACKUP_DIR/postgres.sql"

# Node-RED flows
docker cp sf-nodered:/data/flows.json "$BACKUP_DIR/nodered-flows.json"

# Compress
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

echo "Backup completed: $BACKUP_DIR.tar.gz"
