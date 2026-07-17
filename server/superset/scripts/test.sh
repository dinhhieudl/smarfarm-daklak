#!/bin/bash
# SmartFarm DakLak - Superset Integration Test

set -e

SUPERSET_URL="http://localhost:8088"
PASS=0
FAIL=0

echo "=========================================="
echo " SmartFarm DakLak - Superset Test Suite"
echo "=========================================="

# Test 1: Superset Health
echo -n "[1/7] Superset health check... "
if curl -sf "${SUPERSET_URL}/health" > /dev/null 2>&1; then
  echo "PASS"
  PASS=$((PASS+1))
else
  echo "FAIL"
  FAIL=$((FAIL+1))
fi

# Test 2: Login
echo -n "[2/7] Authentication... "
LOGIN_RESP=$(curl -s -X POST "${SUPERSET_URL}/api/v1/security/login" \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin", "provider": "db", "refresh": true}')
if echo $LOGIN_RESP | grep -q "access_token"; then
  echo "PASS"
  PASS=$((PASS+1))
  TOKEN=$(echo $LOGIN_RESP | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
else
  echo "FAIL"
  FAIL=$((FAIL+1))
  TOKEN=""
fi

# Test 3: API Access
echo -n "[3/7] API access... "
if [ -n "$TOKEN" ] && curl -sf -H "Authorization: Bearer ${TOKEN}" "${SUPERSET_URL}/api/v1/database" > /dev/null 2>&1; then
  echo "PASS"
  PASS=$((PASS+1))
else
  echo "FAIL"
  FAIL=$((FAIL+1))
fi

# Test 4: InfluxDB Connection
echo -n "[4/7] InfluxDB connection... "
CSRF_TOKEN=$(curl -s -c - "${SUPERSET_URL}/api/v1/security/csrf_token/" \
  -H "Authorization: Bearer ${TOKEN}" | grep -o '"result":"[^"]*"' | cut -d'"' -f4)
DB_RESP=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${SUPERSET_URL}/api/v1/database")
if echo $DB_RESP | grep -q "InfluxDB"; then
  echo "PASS"
  PASS=$((PASS+1))
else
  echo "FAIL"
  FAIL=$((FAIL+1))
fi

# Test 5: Datasets
echo -n "[5/7] Datasets... "
DS_RESP=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${SUPERSET_URL}/api/v1/dataset")
if echo $DS_RESP | grep -q "soil"; then
  echo "PASS"
  PASS=$((PASS+1))
else
  echo "FAIL"
  FAIL=$((FAIL+1))
fi

# Test 6: Charts
echo -n "[6/7] Charts... "
CHART_RESP=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${SUPERSET_URL}/api/v1/chart")
if echo $CHART_RESP | grep -q "gauge_chart\|timeseries\|table"; then
  echo "PASS"
  PASS=$((PASS+1))
else
  echo "FAIL"
  FAIL=$((FAIL+1))
fi

# Test 7: Dashboard
echo -n "[7/7] Dashboard... "
DASH_RESP=$(curl -s -H "Authorization: Bearer ${TOKEN}" "${SUPERSET_URL}/api/v1/dashboard")
if echo $DASH_RESP | grep -q "SmartFarm"; then
  echo "PASS"
  PASS=$((PASS+1))
else
  echo "FAIL"
  FAIL=$((FAIL+1))
fi

echo ""
echo "=========================================="
echo " Results: ${PASS} passed, ${FAIL} failed"
echo "=========================================="

if [ $FAIL -gt 0 ]; then
  exit 1
fi
