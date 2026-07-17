#!/usr/bin/env python3
"""
SmartFarm DakLak - Superset Auto-Provisioning
Updates existing dashboard with charts
"""

import requests
import json

SUPERSET_URL = "http://localhost:8088"

def main():
    print("=" * 50)
    print("SmartFarm DakLak - Superset Dashboard Setup")
    print("=" * 50)

    # Login
    session = requests.Session()
    resp = session.post(f"{SUPERSET_URL}/api/v1/security/login", json={
        "username": "admin", "password": "admin", "provider": "db", "refresh": True
    })
    token = resp.json()["access_token"]
    session.headers.update({"Authorization": f"Bearer {token}"})

    resp = session.get(f"{SUPERSET_URL}/api/v1/security/csrf_token/")
    csrf = resp.json()["result"]
    session.headers.update({"X-CSRFToken": csrf, "Content-Type": "application/json"})
    print("Authenticated")

    # Get existing charts
    print("\nFetching charts...")
    resp = session.get(f"{SUPERSET_URL}/api/v1/chart/")
    charts = {}
    if resp.status_code == 200:
        for chart in resp.json().get("result", []):
            charts[chart["slice_name"]] = chart["id"]
            print(f"  {chart['slice_name']}: ID={chart['id']}")

    # Get dashboard
    print("\nFetching dashboard...")
    resp = session.get(f"{SUPERSET_URL}/api/v1/dashboard/")
    dash_id = None
    if resp.status_code == 200:
        for d in resp.json().get("result", []):
            if "Soil Monitoring" in d.get("dashboard_title", ""):
                dash_id = d["id"]
                print(f"  Dashboard: {d['dashboard_title']} (ID={dash_id})")

    if not dash_id:
        print("  No dashboard found!")
        return

    # Build position layout
    position = {
        "DASHBOARD_VERSION_KEY": "v2",
        "ROOT_ID": {"type": "ROOT", "id": "ROOT_ID", "children": ["GRID_ID"]},
        "GRID_ID": {"type": "GRID", "id": "GRID_ID", "children": ["ROW-1", "ROW-2", "ROW-3"]},
        "ROW-1": {"type": "ROW", "id": "ROW-1", "children": [], "meta": {"background": "BACKGROUND_TRANSPARENT"}},
        "ROW-2": {"type": "ROW", "id": "ROW-2", "children": [], "meta": {"background": "BACKGROUND_TRANSPARENT"}},
        "ROW-3": {"type": "ROW", "id": "ROW-3", "children": [], "meta": {"background": "BACKGROUND_TRANSPARENT"}}
    }

    # KPI charts to ROW-1
    kpi_names = ["Average Temperature", "Average Moisture", "Average EC", "Average pH"]
    for name in kpi_names:
        if name in charts:
            key = f"CHART-{charts[name]}"
            position["ROW-1"]["children"].append(key)
            position[key] = {"type": "CHART", "id": key, "children": [], "meta": {"chartId": charts[name], "width": 6, "height": 50, "sliceName": name}}

    # Time series to ROW-2
    ts_names = ["Sensor Trends", "NPK Levels"]
    for name in ts_names:
        if name in charts:
            key = f"CHART-{charts[name]}"
            position["ROW-2"]["children"].append(key)
            position[key] = {"type": "CHART", "id": key, "children": [], "meta": {"chartId": charts[name], "width": 12, "height": 50, "sliceName": name}}

    # Table to ROW-3
    if "Recent Readings" in charts:
        key = f"CHART-{charts['Recent Readings']}"
        position["ROW-3"]["children"].append(key)
        position[key] = {"type": "CHART", "id": key, "children": [], "meta": {"chartId": charts["Recent Readings"], "width": 24, "height": 50, "sliceName": "Recent Readings"}}

    # Update dashboard
    print("\nUpdating dashboard layout...")
    resp = session.put(f"{SUPERSET_URL}/api/v1/dashboard/{dash_id}", json={
        "position_json": json.dumps(position),
        "json_metadata": json.dumps({
            "refresh_frequency": 30,
            "color_scheme": "supersetColors"
        })
    })

    if resp.status_code == 200:
        print("  Layout updated successfully!")
    else:
        print(f"  Error: {resp.status_code} - {resp.text[:200]}")

    # Summary
    print("\n" + "=" * 50)
    print("DASHBOARD READY!")
    print("=" * 50)
    print(f"URL:       {SUPERSET_URL}")
    print(f"Login:     admin / admin")
    print(f"Dashboard: {SUPERSET_URL}/superset/dashboard/{dash_id}/")
    print(f"Charts:    {len(charts)}")
    print("=" * 50)

if __name__ == "__main__":
    main()
