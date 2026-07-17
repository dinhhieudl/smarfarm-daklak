import requests

s = requests.Session()
r = s.post('http://localhost:8088/api/v1/security/login', json={'username':'admin','password':'admin','provider':'db','refresh':True})
token = r.json()['access_token']
s.headers.update({'Authorization': 'Bearer ' + token})
r = s.get('http://localhost:8088/api/v1/security/csrf_token/')
csrf = r.json()['result']
s.headers.update({'X-CSRFToken': csrf, 'Content-Type': 'application/json'})

# Check databases
r = s.get('http://localhost:8088/api/v1/database/')
print('=== Databases ===')
for db in r.json().get('result', []):
    db_id = db['id']
    db_name = db['database_name']
    print(f'  ID={db_id}: {db_name}')

# Check datasets
r = s.get('http://localhost:8088/api/v1/dataset/')
print('\n=== Datasets ===')
for ds in r.json().get('result', []):
    ds_id = ds['id']
    ds_name = ds['table_name']
    db_info = ds.get('database', {})
    db_id = db_info.get('id', '?') if isinstance(db_info, dict) else '?'
    print(f'  ID={ds_id}: {ds_name} (database_id={db_id})')

# Check chart details
r = s.get('http://localhost:8088/api/v1/chart/1')
print('\n=== Chart 1 (Average Temperature) ===')
if r.status_code == 200:
    c = r.json().get('result', {})
    print(f'  datasource_id: {c.get("datasource_id")}')
    print(f'  datasource_type: {c.get("datasource_type")}')
    print(f'  viz_type: {c.get("viz_type")}')
    print(f'  params: {c.get("params", "")[:200]}')

# Test SQL query on database 2
print('\n=== Testing SQL on SmartFarm PostgreSQL ===')
r = s.post('http://localhost:8088/api/v1/chart/data', json={
    "datasource": {"id": 1, "type": "table"},
    "queries": [{"columns": ["temperature"], "metrics": [{"expressionType": "SIMPLE", "column": {"column_name": "temperature"}, "aggregate": "AVG"}], "row_limit": 10}]
})
print(f'  Status: {r.status_code}')
if r.status_code != 200:
    print(f'  Error: {r.text[:300]}')
