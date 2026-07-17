$SUPERSET_URL = "http://localhost:8088"

# Login
$loginResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/security/login" -Method POST -ContentType "application/json" -Body '{"username":"admin","password":"admin","provider":"db","refresh":true}' -UseBasicParsing
$token = ($loginResp.Content | ConvertFrom-Json).access_token
$headers = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }

# Get CSRF token
$csrfResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/security/csrf_token/" -Headers $headers -UseBasicParsing
$csrfToken = ($csrfResp.Content | ConvertFrom-Json).result
$headers["X-CSRFToken"] = $csrfToken

Write-Host "=== Creating InfluxDB Database Connection ==="
$dbBody = @{
    database_name = "InfluxDB SmartFarm"
    sqlalchemy_uri = "influxdb://smarfarm-token-2026@influxdb:8086?org=smarfarm&bucket=soil_data"
    expose_in_sqllab = $true
    allow_run_async = $true
    allow_ctas = $true
    allow_cvas = $true
    allow_dml = $true
} | ConvertTo-Json

try {
    $dbResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/database" -Method POST -Headers $headers -Body $dbBody -UseBasicParsing
    $dbId = ($dbResp.Content | ConvertFrom-Json).id
    Write-Host "Database created: ID=$dbId"
} catch {
    Write-Host "Database creation response: $($_.Exception.Response.StatusCode)"
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $dbResp = $reader.ReadToEnd()
    Write-Host $dbResp
    $dbId = 1
}

Write-Host "`n=== Creating Dataset ==="
$dsBody = @{
    database = $dbId
    schema = "soil_data"
    table_name = "soil"
} | ConvertTo-Json

try {
    $dsResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/dataset" -Method POST -Headers $headers -Body $dsBody -UseBasicParsing
    $dsId = ($dsResp.Content | ConvertFrom-Json).id
    Write-Host "Dataset created: ID=$dsId"
} catch {
    Write-Host "Dataset creation response: $($_.Exception.Response.StatusCode)"
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $dsResp = $reader.ReadToEnd()
    Write-Host $dsResp
    $dsId = 1
}

Write-Host "`n=== Creating Dashboard ==="
$dashBody = @{
    dashboard_title = "SmartFarm DakLak - Soil Monitoring"
    slug = "smartfarm-daklak-soil"
    published = $true
} | ConvertTo-Json

try {
    $dashResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/dashboard" -Method POST -Headers $headers -Body $dashBody -UseBasicParsing
    $dashId = ($dashResp.Content | ConvertFrom-Json).id
    Write-Host "Dashboard created: ID=$dashId"
} catch {
    Write-Host "Dashboard creation response: $($_.Exception.Response.StatusCode)"
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $dashResp = $reader.ReadToEnd()
    Write-Host $dashResp
    $dashId = 1
}

Write-Host "`n=== Creating Charts ==="

# Chart 1: Soil Temperature (Big Number)
$tempBody = @{
    slice_name = "Soil Temperature"
    viz_type = "big_number_total"
    datasource_id = $dsId
    datasource_type = "table"
    params = '{"metric":{"expressionType":"SIMPLE","column":{"column_name":"_value"},"aggregate":"MAX"},"header_font_size":0.4,"subheader_font_size":0.15}'
} | ConvertTo-Json

try {
    $tempResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/chart" -Method POST -Headers $headers -Body $tempBody -UseBasicParsing
    $tempChartId = ($tempResp.Content | ConvertFrom-Json).id
    Write-Host "Temperature chart: ID=$tempChartId"
} catch {
    Write-Host "Temperature chart failed"
    $tempChartId = 0
}

# Chart 2: Soil Moisture (Big Number)
$moistureBody = @{
    slice_name = "Soil Moisture"
    viz_type = "big_number_total"
    datasource_id = $dsId
    datasource_type = "table"
    params = '{"metric":{"expressionType":"SIMPLE","column":{"column_name":"_value"},"aggregate":"MAX"},"header_font_size":0.4,"subheader_font_size":0.15}'
} | ConvertTo-Json

try {
    $moistureResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/chart" -Method POST -Headers $headers -Body $moistureBody -UseBasicParsing
    $moistureChartId = ($moistureResp.Content | ConvertFrom-Json).id
    Write-Host "Moisture chart: ID=$moistureChartId"
} catch {
    Write-Host "Moisture chart failed"
    $moistureChartId = 0
}

# Chart 3: EC (Big Number)
$ecBody = @{
    slice_name = "EC (uS/cm)"
    viz_type = "big_number_total"
    datasource_id = $dsId
    datasource_type = "table"
    params = '{"metric":{"expressionType":"SIMPLE","column":{"column_name":"_value"},"aggregate":"MAX"},"header_font_size":0.4,"subheader_font_size":0.15}'
} | ConvertTo-Json

try {
    $ecResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/chart" -Method POST -Headers $headers -Body $ecBody -UseBasicParsing
    $ecChartId = ($ecResp.Content | ConvertFrom-Json).id
    Write-Host "EC chart: ID=$ecChartId"
} catch {
    Write-Host "EC chart failed"
    $ecChartId = 0
}

# Chart 4: pH (Big Number)
$phBody = @{
    slice_name = "pH"
    viz_type = "big_number_total"
    datasource_id = $dsId
    datasource_type = "table"
    params = '{"metric":{"expressionType":"SIMPLE","column":{"column_name":"_value"},"aggregate":"MAX"},"header_font_size":0.4,"subheader_font_size":0.15}'
} | ConvertTo-Json

try {
    $phResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/chart" -Method POST -Headers $headers -Body $phBody -UseBasicParsing
    $phChartId = ($phResp.Content | ConvertFrom-Json).id
    Write-Host "pH chart: ID=$phChartId"
} catch {
    Write-Host "pH chart failed"
    $phChartId = 0
}

# Chart 5: Time Series (All Parameters)
$tsBody = @{
    slice_name = "Sensor Readings (24h)"
    viz_type = "echarts_timeseries_line"
    datasource_id = $dsId
    datasource_type = "table"
    params = '{"x_axis":"_time","time_grain_sqla":"PT5M","metrics":[{"expressionType":"SIMPLE","column":{"column_name":"_value"},"aggregate":"AVG","label":"value"}],"groupby":[{"expressionType":"SQL","sqlExpression":"CASE WHEN _field = ''temperature'' THEN ''Temp'' WHEN _field = ''moisture'' THEN ''Moisture'' WHEN _field = ''ph'' THEN ''pH'' END","label":"parameter"}],"row_limit":10000,"show_legend":true,"rich_tooltip":true}'
} | ConvertTo-Json

try {
    $tsResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/chart" -Method POST -Headers $headers -Body $tsBody -UseBasicParsing
    $tsChartId = ($tsResp.Content | ConvertFrom-Json).id
    Write-Host "Time series chart: ID=$tsChartId"
} catch {
    Write-Host "Time series chart failed"
    $tsChartId = 0
}

# Chart 6: Table (Latest Readings)
$tableBody = @{
    slice_name = "Latest Readings"
    viz_type = "table"
    datasource_id = $dsId
    datasource_type = "table"
    params = '{"all_columns":["_time","_field","_value"],"row_limit":100,"table_timestamp_format":"%Y-%m-%d %H:%M:%S","page_length":20,"include_search":true}'
} | ConvertTo-Json

try {
    $tableResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/chart" -Method POST -Headers $headers -Body $tableBody -UseBasicParsing
    $tableChartId = ($tableResp.Content | ConvertFrom-Json).id
    Write-Host "Table chart: ID=$tableChartId"
} catch {
    Write-Host "Table chart failed"
    $tableChartId = 0
}

Write-Host "`n=== Updating Dashboard Layout ==="
$positionJson = @{
    DASHBOARD_VERSION_KEY = "v2"
    ROOT_ID = @{ type = "ROOT"; id = "ROOT_ID"; children = @("GRID_ID") }
    GRID_ID = @{ type = "GRID"; id = "GRID_ID"; children = @("ROW-1", "ROW-2") }
    "ROW-1" = @{ type = "ROW"; id = "ROW-1"; children = @("CHART-$tempChartId", "CHART-$moistureChartId", "CHART-$ecChartId", "CHART-$phChartId"); meta = @{ background = "BACKGROUND_TRANSPARENT" } }
    "ROW-2" = @{ type = "ROW"; id = "ROW-2"; children = @("CHART-$tsChartId", "CHART-$tableChartId"); meta = @{ background = "BACKGROUND_TRANSPARENT" } }
    "CHART-$tempChartId" = @{ type = "CHART"; id = "CHART-$tempChartId"; children = @(); meta = @{ chartId = $tempChartId; width = 6; height = 50; sliceName = "Soil Temperature" } }
    "CHART-$moistureChartId" = @{ type = "CHART"; id = "CHART-$moistureChartId"; children = @(); meta = @{ chartId = $moistureChartId; width = 6; height = 50; sliceName = "Soil Moisture" } }
    "CHART-$ecChartId" = @{ type = "CHART"; id = "CHART-$ecChartId"; children = @(); meta = @{ chartId = $ecChartId; width = 6; height = 50; sliceName = "EC" } }
    "CHART-$phChartId" = @{ type = "CHART"; id = "CHART-$phChartId"; children = @(); meta = @{ chartId = $phChartId; width = 6; height = 50; sliceName = "pH" } }
    "CHART-$tsChartId" = @{ type = "CHART"; id = "CHART-$tsChartId"; children = @(); meta = @{ chartId = $tsChartId; width = 12; height = 50; sliceName = "Time Series" } }
    "CHART-$tableChartId" = @{ type = "CHART"; id = "CHART-$tableChartId"; children = @(); meta = @{ chartId = $tableChartId; width = 12; height = 50; sliceName = "Table" } }
} | ConvertTo-Json -Depth 10

$dashUpdateBody = @{
    json_metadata = @{ position_json = $positionJson }
} | ConvertTo-Json -Depth 10

try {
    $updateResp = Invoke-WebRequest -Uri "$SUPERSET_URL/api/v1/dashboard/$dashId" -Method PUT -Headers $headers -Body $dashUpdateBody -UseBasicParsing
    Write-Host "Dashboard layout updated"
} catch {
    Write-Host "Dashboard update failed: $($_.Exception.Response.StatusCode)"
}

Write-Host "`n=========================================="
Write-Host " Provisioning Complete!"
Write-Host "=========================================="
Write-Host " URL:      $SUPERSET_URL"
Write-Host " Login:    admin / admin"
Write-Host " Dashboard: $SUPERSET_URL/superset/dashboard/$dashId/"
Write-Host "=========================================="
