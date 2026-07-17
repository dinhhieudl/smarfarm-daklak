import requests

s = requests.Session()
r = s.post('http://localhost:8088/api/v1/security/login', json={'username':'admin','password':'admin','provider':'db','refresh':True})
token = r.json()['access_token']
s.headers.update({'Authorization': 'Bearer ' + token})

# Test chart 8 data
r = s.get('http://localhost:8088/api/v1/chart/8/data/')
print(f'Chart 8 data: {r.status_code}')
if r.status_code == 200:
    data = r.json()
    results = data.get('result', [])
    if results:
        print(f'  Value: {results[0].get("data", [])[:1]}')

# Test chart 12 (time series)
r = s.get('http://localhost:8088/api/v1/chart/12/data/')
print(f'Chart 12 data: {r.status_code}')
if r.status_code == 200:
    data = r.json()
    results = data.get('result', [])
    if results:
        d = results[0].get('data', [])
        print(f'  Rows: {len(d)}')
