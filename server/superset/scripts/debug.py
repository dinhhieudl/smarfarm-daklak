#!/usr/bin/env python3
"""Debug Superset API"""
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

# Get CSRF
resp = session.get(f"{SUPERSET_URL}/api/v1/security/csrf_token/")
csrf = resp.json()["result"]
print(f"CSRF: {csrf[:20]}...")

# Test database creation with verbose output
headers = {"X-CSRFToken": csrf, "Content-Type": "application/json"}
resp = session.post(f"{SUPERSET_URL}/api/v1/database/", headers=headers, json={
    "database_name": "InfluxDB Test",
    "sqlalchemy_uri": "sqlite:///test.db"
})
print(f"Status: {resp.status_code}")
print(f"Response: {resp.text[:500]}")

# Check what databases exist
resp2 = session.get(f"{SUPERSET_URL}/api/v1/database/")
print(f"\nExisting databases: {resp2.status_code}")
if resp2.status_code == 200:
    for db in resp2.json().get("result", []):
        print(f"  - {db.get('database_name')} (ID: {db.get('id')})")
