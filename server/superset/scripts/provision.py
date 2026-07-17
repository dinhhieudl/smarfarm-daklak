#!/usr/bin/env python3
"""
SmartFarm DakLak - Superset Auto-Provisioning
Uses PostgreSQL for metadata + creates dashboard
"""

import requests
import json
import time
import sys

SUPERSET_URL = "http://localhost:8088"
ADMIN_USER = "admin"
ADMIN_PASS = "admin"

def main():
    print("=" * 50)
    print("SmartFarm DakLak - Superset Auto-Provisioning")
    print("=" * 50)

    # Wait for Superset
    print("\nWaiting for Superset...")
    session = requests.Session()
    for i in range(30):
        try:
            resp = session.get(f"{SUPERSET_URL}/health", timeout=5)
            if resp.status_code == 200:
                print("Superset ready!")
                break
        except:
            pass
        time.sleep(2)
    else:
        print("Superset not ready")
        sys.exit(1)

    # Login
    print("\n[1/4] Authenticating...")
    resp = session.post(f"{SUPERSET_URL}/api/v1/security/login", json={
        "username": ADMIN_USER, "password": ADMIN_PASS, "provider": "db", "refresh": True
    })
    token = resp.json()["access_token"]
    session.headers.update({"Authorization": f"Bearer {token}"})

    resp = session.get(f"{SUPERSET_URL}/api/v1/security/csrf_token/")
    csrf = resp.json()["result"]
    session.headers.update({"X-CSRFToken": csrf, "Content-Type": "application/json"})
    print("  Authenticated")

    # Create PostgreSQL connection to existing database
    print("\n[2/4] Creating PostgreSQL connection...")
    resp = session.post(f"{SUPERSET_URL}/api/v1/database/", json={
        "database_name": "SmartFarm PostgreSQL",
        "sqlalchemy_uri": "postgresql://chirpstack:chirpstack@postgres:5432/chirpstack",
        "expose_in_sqllab": True,
        "allow_run_async": True,
        "allow_ctas": True,
        "allow_cvas": True,
        "allow_dml": True
    })

    if resp.status_code in [200, 201]:
        db_id = resp.json()["id"]
        print(f"  Database created: ID={db_id}")
    else:
        print(f"  Error: {resp.status_code} - {resp.text[:200]}")
        # Try to find existing
        resp2 = session.get(f"{SUPERSET_URL}/api/v1/database/")
        if resp2.status_code == 200:
            for db in resp2.json().get("result", []):
                if "PostgreSQL" in db.get("database_name", "") or "SmartFarm" in db.get("database_name", ""):
                    db_id = db["id"]
                    print(f"  Using existing: ID={db_id}")
                    break
            else:
                db_id = 1
        else:
            db_id = 1

    # Create chart using existing database with SQL query
    print("\n[3/4] Creating charts...")

    # First, create a simple table with sensor data
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS soil_readings (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP DEFAULT NOW(),
        zone VARCHAR(50),
        temperature REAL,
        moisture REAL,
        ec REAL,
        ph REAL,
        nitrogen REAL,
        phosphorus REAL,
        potassium REAL
    );

    INSERT INTO soil_readings (zone, temperature, moisture, ec, ph, nitrogen, phosphorus, potassium)
    SELECT
        'zone-A',
        25 + RANDOM() * 10,
        40 + RANDOM() * 30,
        300 + RANDOM() * 400,
        5.5 + RANDOM() * 1.5,
        100 + RANDOM() * 100,
        30 + RANDOM() * 40,
        150 + RANDOM() * 100
    FROM generate_series(1, 100);
    """

    # Execute via SQL Lab API
    resp = session.post(f"{SUPERSET_URL}/api/v1/sqllab/execute/", json={
        "database_id": db_id,
        "sql": create_table_sql,
        "runAsync": False,
        "schema": "public"
    })
    if resp.status_code in [200, 201]:
        print("  Sensor data table created")
    else:
        print(f"  Table creation: {resp.status_code}")

    # Create dataset
    resp = session.post(f"{SUPERSET_URL}/api/v1/dataset/", json={
        "database": db_id,
        "schema": "public",
        "table_name": "soil_readings"
    })

    if resp.status_code in [200, 201]:
        ds_id = resp.json()["id"]
        print(f"  Dataset created: ID={ds_id}")
    else:
        print(f"  Dataset error: {resp.status_code}")
        ds_id = 1

    # Create charts
    charts = {}

    chart_configs = [
        ("Average Temperature", "big_number_total", {"metric": {"expressionType": "SIMPLE", "column": {"column_name": "temperature"}, "aggregate": "AVG", "label": "avg_temp"}, "header_font_size": 0.4}),
        ("Average Moisture", "big_number_total", {"metric": {"expressionType": "SIMPLE", "column": {"column_name": "moisture"}, "aggregate": "AVG", "label": "avg_moisture"}, "header_font_size": 0.4}),
        ("Average EC", "big_number_total", {"metric": {"expressionType": "SIMPLE", "column": {"column_name": "ec"}, "aggregate": "AVG", "label": "avg_ec"}, "header_font_size": 0.4}),
        ("Average pH", "big_number_total", {"metric": {"expressionType": "SIMPLE", "column": {"column_name": "ph"}, "aggregate": "AVG", "label": "avg_ph"}, "header_font_size": 0.4, "y_axis_format": ".1f"}),
        ("Sensor Trends", "echarts_timeseries_line", {"x_axis": "timestamp", "time_grain_sqla": "PT1H", "metrics": [{"expressionType": "SIMPLE", "column": {"column_name": "temperature"}, "aggregate": "AVG", "label": "Temperature"}, {"expressionType": "SIMPLE", "column": {"column_name": "moisture"}, "aggregate": "AVG", "label": "Moisture"}], "row_limit": 1000, "show_legend": True}),
        ("NPK Levels", "echarts_timeseries_line", {"x_axis": "timestamp", "time_grain_sqla": "PT1H", "metrics": [{"expressionType": "SIMPLE", "column": {"column_name": "nitrogen"}, "aggregate": "AVG", "label": "N"}, {"expressionType": "SIMPLE", "column": {"column_name": "phosphorus"}, "aggregate": "AVG", "label": "P"}, {"expressionType": "SIMPLE", "column": {"column_name": "potassium"}, "aggregate": "AVG", "label": "K"}], "row_limit": 1000, "show_legend": True}),
        ("Recent Readings", "table", {"all_columns": ["timestamp", "zone", "temperature", "moisture", "ec", "ph", "nitrogen", "phosphorus", "potassium"], "order_by_cols": [["timestamp", False]], "row_limit": 50, "table_timestamp_format": "%Y-%m-%d %H:%M:%S", "page_length": 20, "include_search": True})
    ]

    for name, viz_type, params in chart_configs:
        resp = session.post(f"{SUPERSET_URL}/api/v1/chart/", json={
            "slice_name": name,
            "viz_type": viz_type,
            "datasource_id": ds_id,
            "datasource_type": "table",
            "params": json.dumps(params)
        })
        if resp.status_code in [200, 201]:
            charts[name] = resp.json()["id"]
            print(f"  {name}: ID={charts[name]}")
        else:
            print(f"  {name}: FAILED ({resp.status_code})")

    # Create dashboard
    print("\n[4/4] Creating dashboard...")
    resp = session.post(f"{SUPERSET_URL}/api/v1/dashboard/", json={
        "dashboard_title": "SmartFarm DakLak - Soil Monitoring",
        "slug": "smartfarm-daklak-soil",
        "published": True
    })

    if resp.status_code in [200, 201]:
        dash_id = resp.json()["id"]
        print(f"  Dashboard created: ID={dash_id}")

        # Build layout
        position = {
            "DASHBOARD_VERSION_KEY": "v2",
            "ROOT_ID": {"type": "ROOT", "id": "ROOT_ID", "children": ["GRID_ID"]},
            "GRID_ID": {"type": "GRID", "id": "GRID_ID", "children": ["ROW-1", "ROW-2", "ROW-3"]},
            "ROW-1": {"type": "ROW", "id": "ROW-1", "children": [], "meta": {"background": "BACKGROUND_TRANSPARENT"}},
            "ROW-2": {"type": "ROW", "id": "ROW-2", "children": [], "meta": {"background": "BACKGROUND_TRANSPARENT"}},
            "ROW-3": {"type": "ROW", "id": "ROW-3", "children": [], "meta": {"background": "BACKGROUND_TRANSPARENT"}}
        }

        # KPI charts
        for name in ["Average Temperature", "Average Moisture", "Average EC", "Average pH"]:
            if name in charts:
                key = f"CHART-{charts[name]}"
                position["ROW-1"]["children"].append(key)
                position[key] = {"type": "CHART", "id": key, "children": [], "meta": {"chartId": charts[name], "width": 6, "height": 50, "sliceName": name}}

        # Time series
        for name in ["Sensor Trends", "NPK Levels"]:
            if name in charts:
                key = f"CHART-{charts[name]}"
                position["ROW-2"]["children"].append(key)
                position[key] = {"type": "CHART", "id": key, "children": [], "meta": {"chartId": charts[name], "width": 12, "height": 50, "sliceName": name}}

        # Table
        if "Recent Readings" in charts:
            key = f"CHART-{charts['Recent Readings']}"
            position["ROW-3"]["children"].append(key)
            position[key] = {"type": "CHART", "id": key, "children": [], "meta": {"chartId": charts["Recent Readings"], "width": 24, "height": 50, "sliceName": "Recent Readings"}}

        # Update dashboard
        resp = session.put(f"{SUPERSET_URL}/api/v1/dashboard/{dash_id}", json={
            "json_metadata": {
                "position_json": json.dumps(position),
                "refresh_frequency": 30,
                "color_scheme": "supersetColors"
            }
        })
        print(f"  Layout updated: {resp.status_code}")
    else:
        print(f"  Dashboard failed: {resp.status_code}")
        dash_id = None

    # Summary
    print("\n" + "=" * 50)
    print("PROVISIONING COMPLETE!")
    print("=" * 50)
    print(f"URL:       {SUPERSET_URL}")
    print(f"Login:     {ADMIN_USER} / {ADMIN_PASS}")
    if dash_id:
        print(f"Dashboard: {SUPERSET_URL}/superset/dashboard/{dash_id}/")
    print(f"Charts:    {len(charts)} created")
    print("=" * 50)

if __name__ == "__main__":
    main()
