#!/bin/bash
# SmartFarm DakLak - Superset Provisioning Script
# Sets up InfluxDB datasource and dashboard

set -e

SUPERSET_URL="http://localhost:8088"
ADMIN_USER="admin"
ADMIN_PASS="admin"

echo "[1/5] Waiting for Superset to be ready..."
until curl -sf "${SUPERSET_URL}/health" > /dev/null 2>&1; do
  sleep 2
done
echo "Superset is ready!"

echo "[2/5] Getting auth token..."
LOGIN_RESP=$(curl -s -X POST "${SUPERSET_URL}/api/v1/security/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"${ADMIN_USER}\", \"password\": \"${ADMIN_PASS}\", \"provider\": \"db\", \"refresh\": true}")
TOKEN=$(echo $LOGIN_RESP | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
CSRF_TOKEN=$(curl -s -c - "${SUPERSET_URL}/api/v1/security/csrf_token/" \
  -H "Authorization: Bearer ${TOKEN}" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
echo "Token obtained!"

echo "[3/5] Creating InfluxDB database connection..."
DB_RESP=$(curl -s -X POST "${SUPERSET_URL}/api/v1/database" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d '{
    "database_name": "InfluxDB SmartFarm",
    "engine": "influxdb",
    "sqlalchemy_uri": "influxdb://smarfarm-token-2026@influxdb:8086?org=smarfarm&bucket=soil_data",
    "expose_in_sqllab": true,
    "allow_run_async": true,
    "allow_ctas": true,
    "allow_cvas": true,
    "allow_dml": true
  }')
DB_ID=$(echo $DB_RESP | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "Database created with ID: ${DB_ID}"

echo "[4/5] Creating dataset for soil sensor data..."
DS_RESP=$(curl -s -X POST "${SUPERSET_URL}/api/v1/dataset" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"database\": ${DB_ID},
    \"schema\": \"soil_data\",
    \"table_name\": \"soil\"
  }")
DS_ID=$(echo $DS_RESP | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "Dataset created with ID: ${DS_ID}"

echo "[5/5] Importing dashboard..."
# Dashboard import would go here (requires JSON file)
echo "Dashboard import requires manual setup via UI or API"

echo ""
echo "=== Superset Provisioning Complete ==="
echo "URL: ${SUPERSET_URL}"
echo "Login: ${ADMIN_USER} / ${ADMIN_PASS}"
echo ""
echo "Next steps:"
echo "1. Open ${SUPERSET_URL}"
echo "2. Go to Datasets > ${DS_ID}"
echo "3. Create charts for each panel"
echo "4. Assemble into dashboard"
