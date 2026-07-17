import requests

s = requests.Session()
r = s.post('http://localhost:8088/api/v1/security/login', json={'username':'admin','password':'admin','provider':'db','refresh':True})
token = r.json()['access_token']
s.headers.update({'Authorization': 'Bearer ' + token})
r = s.get('http://localhost:8088/api/v1/security/csrf_token/')
csrf = r.json()['result']
s.headers.update({'X-CSRFToken': csrf, 'Content-Type': 'application/json'})

# Associate all charts with dashboard 2
for chart_id in [8, 9, 10, 11, 12, 13, 14]:
    r = s.put(f'http://localhost:8088/api/v1/chart/{chart_id}', json={
        'dashboards': [2]
    })
    print(f'Chart {chart_id}: {r.status_code}')

# Check dashboard
r = s.get('http://localhost:8088/api/v1/dashboard/2')
d = r.json().get('result', {})
print(f'\nDashboard charts: {d.get("charts", [])}')
