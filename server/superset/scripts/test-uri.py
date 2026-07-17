#!/usr/bin/env python3
"""Test InfluxDB URI formats"""
import requests
import json

SUPERSET_URL = "http://localhost:8088"

# Login
session = requests.Session()
resp = session.post(f"{SUPERSET_URL}/api/v1/security/login", json={
    "username": "admin", "password": "admin", "provider": "db", "refresh": True
})
token = resp.json()["access_token"]
session.headers.update({"Authorization": f"Bearer {token}"})

resp = session.get(f"{SUPERSET_URL}/api/v1/security/csrf_token/")
csrf = resp.json()["result"]
headers = {"X-CSRFToken": csrf, "Content-Type": "application/json"}

# Try different URI formats
uris = [
    "influxdb://smarfarm-token-2026@influxdb:8086?org=smarfarm&bucket=soil_data",
    "influxdb://admin:admin12345@influxdb:8086?org=smarfarm&bucket=soil_data",
    "influxdb://admin:admin12345@influxdb:8086/soil_data",
    "http://influxdb:8086?org=smarfarm&bucket=soil_data",
]

for i, uri in enumerate(uris):
    print(f"\nTrying URI {i+1}: {uri[:50]}...")
    resp = session.post(f"{SUPERSET_URL}/api/v1/database/", headers=headers, json={
        "database_name": f"InfluxDB Test {i+1}",
        "sqlalchemy_uri": uri,
        "expose_in_sqllab": True
    })
    print(f"  Status: {resp.status_code}")
    if resp.status_code not in [200, 201]:
        print(f"  Error: {resp.text[:200]}")
    else:
        print(f"  Success: ID={resp.json().get('id')}")
        break
