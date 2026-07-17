import requests
import json

s = requests.Session()
r = s.post('http://localhost:8088/api/v1/security/login', json={'username':'admin','password':'admin','provider':'db','refresh':True})
token = r.json()['access_token']
s.headers.update({'Authorization': 'Bearer ' + token})
r = s.get('http://localhost:8088/api/v1/security/csrf_token/')
csrf = r.json()['result']
s.headers.update({'X-CSRFToken': csrf, 'Content-Type': 'application/json'})

# Check chart 8 dashboards field
r = s.get('http://localhost:8088/api/v1/chart/8')
c = r.json().get('result', {})
print('Chart 8 dashboards:', c.get('dashboards', []))

# Try to update chart 8 with dashboard_id
r = s.put('http://localhost:8088/api/v1/chart/8', json={
    'dashboards': [2]
})
print(f'Update chart 8 dashboards: {r.status_code}')

# Check dashboard again
r = s.get('http://localhost:8088/api/v1/dashboard/2')
d = r.json().get('result', {})
print('Dashboard charts after update:', d.get('charts', []))
