import requests
import json

SUPERSET_URL = "http://localhost:8088"

# Login
s = requests.Session()
r = s.post(f"{SUPERSET_URL}/api/v1/security/login", json={'username':'admin','password':'admin','provider':'db','refresh':True})
token = r.json()['access_token']
s.headers.update({'Authorization': f'Bearer {token}'})
r = s.get(f"{SUPERSET_URL}/api/v1/security/csrf_token/")
csrf = r.json()['result']
s.headers.update({'X-CSRFToken': csrf, 'Content-Type': 'application/json'})

# Delete old charts
print("Deleting old charts...")
for chart_id in range(1, 8):
    r = s.delete(f"{SUPERSET_URL}/api/v1/chart/{chart_id}")
    print(f"  Chart {chart_id}: {r.status_code}")

# Delete old dashboard
print("Deleting old dashboard...")
r = s.delete(f"{SUPERSET_URL}/api/v1/dashboard/1")
print(f"  Dashboard 1: {r.status_code}")

# Delete old dataset
print("Deleting old dataset...")
r = s.delete(f"{SUPERSET_URL}/api/v1/dataset/1")
print(f"  Dataset 1: {r.status_code}")

# Create dataset
print("\nCreating dataset...")
r = s.post(f"{SUPERSET_URL}/api/v1/dataset/", json={
    "database": 2,
    "schema": "public",
    "table_name": "soil_readings"
})
print(f"  Status: {r.status_code}")
if r.status_code in [200, 201]:
    ds_id = r.json()["id"]
    print(f"  Dataset ID: {ds_id}")
else:
    print(f"  Error: {r.text[:200]}")
    ds_id = 1

# Create charts with proper datasource
print("\nCreating charts...")
charts = {}

chart_configs = [
    ("Average Temperature", "big_number_total", {"column_name": "temperature"}, "AVG"),
    ("Average Moisture", "big_number_total", {"column_name": "moisture"}, "AVG"),
    ("Average EC", "big_number_total", {"column_name": "ec"}, "AVG"),
    ("Average pH", "big_number_total", {"column_name": "ph"}, "AVG"),
]

for name, viz_type, column, aggregate in chart_configs:
    params = {
        "metric": {
            "expressionType": "SIMPLE",
            "column": column,
            "aggregate": aggregate,
            "label": f"avg_{column['column_name']}"
        },
        "header_font_size": 0.4,
        "subheader_font_size": 0.15,
        "y_axis_format": "SMART_NUMBER"
    }
    
    query_context = {
        "datasource": {"id": ds_id, "type": "table"},
        "queries": [{
            "columns": [],
            "metrics": [{
                "expressionType": "SIMPLE",
                "column": column,
                "aggregate": aggregate,
                "label": f"avg_{column['column_name']}"
            }],
            "row_limit": 1
        }]
    }
    
    r = s.post(f"{SUPERSET_URL}/api/v1/chart/", json={
        "slice_name": name,
        "viz_type": viz_type,
        "datasource_id": ds_id,
        "datasource_type": "table",
        "params": json.dumps(params),
        "query_context": json.dumps(query_context)
    })
    
    if r.status_code in [200, 201]:
        charts[name] = r.json()["id"]
        print(f"  {name}: ID={charts[name]}")
    else:
        print(f"  {name}: FAILED ({r.status_code})")

# Create time series chart
ts_params = {
    "x_axis": "timestamp",
    "time_grain_sqla": "PT1H",
    "metrics": [
        {"expressionType": "SIMPLE", "column": {"column_name": "temperature"}, "aggregate": "AVG", "label": "Temperature"},
        {"expressionType": "SIMPLE", "column": {"column_name": "moisture"}, "aggregate": "AVG", "label": "Moisture"}
    ],
    "row_limit": 1000,
    "show_legend": True,
    "rich_tooltip": True
}

ts_query = {
    "datasource": {"id": ds_id, "type": "table"},
    "queries": [{
        "columns": [{"sqlExpression": "timestamp", "label": "timestamp", "expressionType": "SQL"}],
        "metrics": [
            {"expressionType": "SIMPLE", "column": {"column_name": "temperature"}, "aggregate": "AVG", "label": "Temperature"},
            {"expressionType": "SIMPLE", "column": {"column_name": "moisture"}, "aggregate": "AVG", "label": "Moisture"}
        ],
        "row_limit": 1000,
        "time_range": "No filter"
    }]
}

r = s.post(f"{SUPERSET_URL}/api/v1/chart/", json={
    "slice_name": "Sensor Trends",
    "viz_type": "echarts_timeseries_line",
    "datasource_id": ds_id,
    "datasource_type": "table",
    "params": json.dumps(ts_params),
    "query_context": json.dumps(ts_query)
})
if r.status_code in [200, 201]:
    charts["Sensor Trends"] = r.json()["id"]
    print(f"  Sensor Trends: ID={charts['Sensor Trends']}")

# Create NPK chart
npk_params = {
    "x_axis": "timestamp",
    "time_grain_sqla": "PT1H",
    "metrics": [
        {"expressionType": "SIMPLE", "column": {"column_name": "nitrogen"}, "aggregate": "AVG", "label": "N"},
        {"expressionType": "SIMPLE", "column": {"column_name": "phosphorus"}, "aggregate": "AVG", "label": "P"},
        {"expressionType": "SIMPLE", "column": {"column_name": "potassium"}, "aggregate": "AVG", "label": "K"}
    ],
    "row_limit": 1000,
    "show_legend": True
}

npk_query = {
    "datasource": {"id": ds_id, "type": "table"},
    "queries": [{
        "columns": [{"sqlExpression": "timestamp", "label": "timestamp", "expressionType": "SQL"}],
        "metrics": [
            {"expressionType": "SIMPLE", "column": {"column_name": "nitrogen"}, "aggregate": "AVG", "label": "N"},
            {"expressionType": "SIMPLE", "column": {"column_name": "phosphorus"}, "aggregate": "AVG", "label": "P"},
            {"expressionType": "SIMPLE", "column": {"column_name": "potassium"}, "aggregate": "AVG", "label": "K"}
        ],
        "row_limit": 1000,
        "time_range": "No filter"
    }]
}

r = s.post(f"{SUPERSET_URL}/api/v1/chart/", json={
    "slice_name": "NPK Levels",
    "viz_type": "echarts_timeseries_line",
    "datasource_id": ds_id,
    "datasource_type": "table",
    "params": json.dumps(npk_params),
    "query_context": json.dumps(npk_query)
})
if r.status_code in [200, 201]:
    charts["NPK Levels"] = r.json()["id"]
    print(f"  NPK Levels: ID={charts['NPK Levels']}")

# Create table chart
table_params = {
    "all_columns": ["timestamp", "zone", "temperature", "moisture", "ec", "ph", "nitrogen", "phosphorus", "potassium"],
    "order_by_cols": [["timestamp", False]],
    "row_limit": 50,
    "table_timestamp_format": "%Y-%m-%d %H:%M:%S",
    "page_length": 20,
    "include_search": True
}

table_query = {
    "datasource": {"id": ds_id, "type": "table"},
    "queries": [{
        "columns": ["timestamp", "zone", "temperature", "moisture", "ec", "ph", "nitrogen", "phosphorus", "potassium"],
        "metrics": [],
        "row_limit": 50,
        "order_desc": True,
        "orderby": [["timestamp", False]]
    }]
}

r = s.post(f"{SUPERSET_URL}/api/v1/chart/", json={
    "slice_name": "Recent Readings",
    "viz_type": "table",
    "datasource_id": ds_id,
    "datasource_type": "table",
    "params": json.dumps(table_params),
    "query_context": json.dumps(table_query)
})
if r.status_code in [200, 201]:
    charts["Recent Readings"] = r.json()["id"]
    print(f"  Recent Readings: ID={charts['Recent Readings']}")

# Create dashboard
print("\nCreating dashboard...")
r = s.post(f"{SUPERSET_URL}/api/v1/dashboard/", json={
    "dashboard_title": "SmartFarm DakLak - Soil Monitoring",
    "slug": "smartfarm-daklak-soil",
    "published": True
})
print(f"  Status: {r.status_code}")
if r.status_code in [200, 201]:
    dash_id = r.json()["id"]
    print(f"  Dashboard ID: {dash_id}")
else:
    print(f"  Error: {r.text[:200]}")
    dash_id = 1

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
r = s.put(f"{SUPERSET_URL}/api/v1/dashboard/{dash_id}", json={
    "position_json": json.dumps(position),
    "json_metadata": json.dumps({"refresh_frequency": 30})
})
print(f"\nDashboard layout update: {r.status_code}")

# Summary
print("\n" + "=" * 50)
print("DASHBOARD READY!")
print("=" * 50)
print(f"URL:       {SUPERSET_URL}")
print(f"Login:     admin / admin")
print(f"Dashboard: {SUPERSET_URL}/superset/dashboard/{dash_id}/")
print(f"Charts:    {len(charts)}")
print("=" * 50)
