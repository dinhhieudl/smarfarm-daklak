#!/bin/bash
# SmartFarm DakLak - Superset Full Provisioning
# Creates InfluxDB datasource, datasets, charts, and dashboard

set -e

SUPERSET_URL="http://localhost:8088"
ADMIN_USER="admin"
ADMIN_PASS="admin"

echo "=========================================="
echo " SmartFarm DakLak - Superset Provisioning"
echo "=========================================="

# Wait for Superset
echo "[1/8] Waiting for Superset..."
until curl -sf "${SUPERSET_URL}/health" > /dev/null 2>&1; do
  sleep 3
done
echo "Superset is ready!"

# Get auth token
echo "[2/8] Authenticating..."
LOGIN_RESP=$(curl -s -X POST "${SUPERSET_URL}/api/v1/security/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"${ADMIN_USER}\", \"password\": \"${ADMIN_PASS}\", \"provider\": \"db\", \"refresh\": true}")
TOKEN=$(echo $LOGIN_RESP | python3 -c "import sys, json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo $LOGIN_RESP | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

CSRF_RESP=$(curl -s -c - "${SUPERSET_URL}/api/v1/security/csrf_token/" \
  -H "Authorization: Bearer ${TOKEN}")
CSRF_TOKEN=$(echo $CSRF_RESP | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
echo "Authenticated!"

# Create InfluxDB database connection
echo "[3/8] Creating InfluxDB connection..."
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
DB_ID=$(echo $DB_RESP | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo $DB_RESP | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "Database created: ID=${DB_ID}"

# Create dataset
echo "[4/8] Creating dataset..."
DS_RESP=$(curl -s -X POST "${SUPERSET_URL}/api/v1/dataset" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"database\": ${DB_ID},
    \"schema\": \"soil_data\",
    \"table_name\": \"soil\"
  }")
DS_ID=$(echo $DS_RESP | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo $DS_RESP | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "Dataset created: ID=${DS_ID}"

# Create Gauge Charts
echo "[5/8] Creating gauge charts..."

# Temperature Gauge
curl -s -X POST "${SUPERSET_URL}/api/v1/chart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"slice_name\": \"Soil Temperature\",
    \"viz_type\": \"gauge_chart\",
    \"datasource_id\": ${DS_ID},
    \"datasource_type\": \"table\",
    \"params\": \"{\\\"row_limit\\\": 1, \\\"groupby\\\": [], \\\"metric\\\": {\\\"expressionType\\\": \\\"SIMPLE\\\", \\\"column\\\": {\\\"column_name\\\": \\\"_value\\\"}, \\\"aggregate\\\": \\\"MAX\\\"}, \\\"min_val\\\": -10, \\\"max_val\\\": 60, \\\"start_angle\\\": -125, \\\"end_angle\\\": 125, \\\"font_size\\\": 15, \\\"show_pointer\\\": true, \\\"show_axis_tick\\\": true, \\\"show_split_line\\\": true, \\\"split_number\\\": 10, \\\"overlap\\\": true, \\\"roundCap\\\": true, \\\"animation\\\": true}\"
  }" > /dev/null 2>&1 && echo "  - Temperature gauge: OK" || echo "  - Temperature gauge: FAILED"

# Moisture Gauge
curl -s -X POST "${SUPERSET_URL}/api/v1/chart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"slice_name\": \"Soil Moisture\",
    \"viz_type\": \"gauge_chart\",
    \"datasource_id\": ${DS_ID},
    \"datasource_type\": \"table\",
    \"params\": \"{\\\"row_limit\\\": 1, \\\"groupby\\\": [], \\\"metric\\\": {\\\"expressionType\\\": \\\"SIMPLE\\\", \\\"column\\\": {\\\"column_name\\\": \\\"_value\\\"}, \\\"aggregate\\\": \\\"MAX\\\"}, \\\"min_val\\\": 0, \\\"max_val\\\": 100, \\\"start_angle\\\": -125, \\\"end_angle\\\": 125, \\\"font_size\\\": 15, \\\"show_pointer\\\": true, \\\"show_axis_tick\\\": true, \\\"show_split_line\\\": true, \\\"split_number\\\": 10, \\\"overlap\\\": true, \\\"roundCap\\\": true, \\\"animation\\\": true}\"
  }" > /dev/null 2>&1 && echo "  - Moisture gauge: OK" || echo "  - Moisture gauge: FAILED"

# EC Gauge
curl -s -X POST "${SUPERSET_URL}/api/v1/chart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"slice_name\": \"EC (uS/cm)\",
    \"viz_type\": \"gauge_chart\",
    \"datasource_id\": ${DS_ID},
    \"datasource_type\": \"table\",
    \"params\": \"{\\\"row_limit\\\": 1, \\\"groupby\\\": [], \\\"metric\\\": {\\\"expressionType\\\": \\\"SIMPLE\\\", \\\"column\\\": {\\\"column_name\\\": \\\"_value\\\"}, \\\"aggregate\\\": \\\"MAX\\\"}, \\\"min_val\\\": 0, \\\"max_val\\\": 5000, \\\"start_angle\\\": -125, \\\"end_angle\\\": 125, \\\"font_size\\\": 15, \\\"show_pointer\\\": true, \\\"show_axis_tick\\\": true, \\\"show_split_line\\\": true, \\\"split_number\\\": 10, \\\"overlap\\\": true, \\\"roundCap\\\": true, \\\"animation\\\": true}\"
  }" > /dev/null 2>&1 && echo "  - EC gauge: OK" || echo "  - EC gauge: FAILED"

# pH Gauge
curl -s -X POST "${SUPERSET_URL}/api/v1/chart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"slice_name\": \"pH\",
    \"viz_type\": \"gauge_chart\",
    \"datasource_id\": ${DS_ID},
    \"datasource_type\": \"table\",
    \"params\": \"{\\\"row_limit\\\": 1, \\\"groupby\\\": [], \\\"metric\\\": {\\\"expressionType\\\": \\\"SIMPLE\\\", \\\"column\\\": {\\\"column_name\\\": \\\"_value\\\"}, \\\"aggregate\\\": \\\"MAX\\\"}, \\\"min_val\\\": 0, \\\"max_val\\\": 14, \\\"start_angle\\\": -125, \\\"end_angle\\\": 125, \\\"font_size\\\": 15, \\\"show_pointer\\\": true, \\\"show_axis_tick\\\": true, \\\"show_split_line\\\": true, \\\"split_number\\\": 14, \\\"overlap\\\": true, \\\"roundCap\\\": true, \\\"animation\\\": true}\"
  }" > /dev/null 2>&1 && echo "  - pH gauge: OK" || echo "  - pH gauge: FAILED"

# Create Time Series Charts
echo "[6/8] Creating time series charts..."

# NPK Time Series
curl -s -X POST "${SUPERSET_URL}/api/v1/chart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"slice_name\": \"NPK (mg/kg)\",
    \"viz_type\": \"echarts_timeseries_line\",
    \"datasource_id\": ${DS_ID},
    \"datasource_type\": \"table\",
    \"params\": \"{\\\"x_axis\\\": \\\"_time\\\", \\\"time_grain_sqla\\\": \\\"PT5M\\\", \\\"metrics\\\": [{\\\"expressionType\\\": \\\"SIMPLE\\\", \\\"column\\\": {\\\"column_name\\\": \\\"_value\\\"}, \\\"aggregate\\\": \\\"AVG\\\", \\\"label\\\": \\\"NPK\\\"}], \\\"groupby\\\": [{\\\"expressionType\\\": \\\"SQL\\\", \\\"sqlExpression\\\": \\\"CASE WHEN _field = 'nitrogen' THEN 'N' WHEN _field = 'phosphorus' THEN 'P' WHEN _field = 'potassium' THEN 'K' END\\\", \\\"label\\\": \\\"nutrient\\\"}], \\\"row_limit\\\": 10000, \\\"truncate_metric\\\": true, \\\"show_legend\\\": true, \\\"legendType\\\": \\\"scroll\\\", \\\"legendOrientation\\\": \\\"top\\\", \\\"rich_tooltip\\\": true, \\\"tooltipTimeFormat\\\": \\\"%Y-%m-%d %H:%M\\\", \\\"y_axis_format\\\": \\\"SMART_NUMBER\\\"}\"
  }" > /dev/null 2>&1 && echo "  - NPK timeseries: OK" || echo "  - NPK timeseries: FAILED"

# All Parameters Time Series
curl -s -X POST "${SUPERSET_URL}/api/v1/chart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"slice_name\": \"All Parameters (24h)\",
    \"viz_type\": \"echarts_timeseries_line\",
    \"datasource_id\": ${DS_ID},
    \"datasource_type\": \"table\",
    \"params\": \"{\\\"x_axis\\\": \\\"_time\\\", \\\"time_grain_sqla\\\": \\\"PT5M\\\", \\\"metrics\\\": [{\\\"expressionType\\\": \\\"SIMPLE\\\", \\\"column\\\": {\\\"column_name\\\": \\\"_value\\\"}, \\\"aggregate\\\": \\\"AVG\\\", \\\"label\\\": \\\"value\\\"}], \\\"groupby\\\": [{\\\"expressionType\\\": \\\"SQL\\\", \\\"sqlExpression\\\": \\\"CASE WHEN _field = 'temperature' THEN 'Temperature' WHEN _field = 'moisture' THEN 'Moisture' WHEN _field = 'ph' THEN 'pH' END\\\", \\\"label\\\": \\\"parameter\\\"}], \\\"row_limit\\\": 10000, \\\"truncate_metric\\\": true, \\\"show_legend\\\": true, \\\"legendType\\\": \\\"scroll\\\", \\\"legendOrientation\\\": \\\"top\\\", \\\"rich_tooltip\\\": true, \\\"tooltipTimeFormat\\\": \\\"%Y-%m-%d %H:%M\\\", \\\"y_axis_format\\\": \\\"SMART_NUMBER\\\"}\"
  }" > /dev/null 2>&1 && echo "  - All parameters timeseries: OK" || echo "  - All parameters timeseries: FAILED"

# Create Table Chart
echo "[7/8] Creating table chart..."
curl -s -X POST "${SUPERSET_URL}/api/v1/chart" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d "{
    \"slice_name\": \"Latest Readings\",
    \"viz_type\": \"table\",
    \"datasource_id\": ${DS_ID},
    \"datasource_type\": \"table\",
    \"params\": \"{\\\"all_columns\\\": [\\\"_time\\\", \\\"_field\\\", \\\"_value\\\"], \\\"order_by_cols\\\": [[\\\"_time\\\", false]], \\\"row_limit\\\": 100, \\\"table_timestamp_format\\\": \\\"%Y-%m-%d %H:%M:%S\\\", \\\"page_length\\\": 20, \\\"include_search\\\": true, \\\"show_cell_bars\\\": true}\"
  }" > /dev/null 2>&1 && echo "  - Table chart: OK" || echo "  - Table chart: FAILED"

# Create Dashboard
echo "[8/8] Creating dashboard..."
DASH_RESP=$(curl -s -X POST "${SUPERSET_URL}/api/v1/dashboard" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: ${CSRF_TOKEN}" \
  -d '{
    "dashboard_title": "SmartFarm DakLak - Soil Monitoring",
    "slug": "smartfarm-daklak-soil",
    "published": true
  }')
DASH_ID=$(echo $DASH_RESP | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo $DASH_RESP | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "Dashboard created: ID=${DASH_ID}"

echo ""
echo "=========================================="
echo " Provisioning Complete!"
echo "=========================================="
echo " URL:      ${SUPERSET_URL}"
echo " Login:    ${ADMIN_USER} / ${ADMIN_PASS}"
echo " Database: ID=${DB_ID}"
echo " Dataset:  ID=${DS_ID}"
echo " Dashboard: ID=${DASH_ID}"
echo ""
echo " Next steps:"
echo " 1. Open ${SUPERSET_URL}"
echo " 2. Go to Dashboards > SmartFarm DakLak"
echo " 3. Add charts to dashboard"
echo " 4. Configure auto-refresh (30s)"
echo "=========================================="
