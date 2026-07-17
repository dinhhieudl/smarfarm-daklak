import requests

s = requests.Session()
r = s.post('http://localhost:8088/api/v1/security/login', json={'username':'admin','password':'admin','provider':'db','refresh':True})
token = r.json()['access_token']
s.headers.update({'Authorization': 'Bearer ' + token})

# Test chart 1 data
r = s.get('http://localhost:8088/api/v1/chart/1/data/')
print(f'Chart 1 data status: {r.status_code}')
if r.status_code == 200:
    data = r.json()
    results = data.get('result', [])
    if results:
        print(f'  Data: {results[0].get("data", [])[:1]}')
else:
    print(f'  Error: {r.text[:300]}')
