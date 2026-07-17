# 04 - TRIỂN KHAI PHẦN MỀM

## 1. Yêu Cầu Hệ Thống

| Thành phần | Yêu cầu tối thiểu | Khuyến nghị |
|-----------|-------------------|-------------|
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| SSD | 20 GB | 50 GB |
| Docker | 20.10+ | 24.x |
| Docker Compose | v2.0+ | v2.20+ |
| Node.js | 18+ | 20 LTS |
| Internet | Cần cho setup + weather API | Ổn định |

---

## 2. Cài Đặt Docker Stack

```bash
# 1. Clone repository
git clone https://github.com/dinhhieudl/smartfarm-daklak.git
cd smartfarm-daklak/server

# 2. Tạo file .env
cp ../.env.example ../.env
# Chỉnh sửa .env theo cấu hình mạng

# 3. Khởi động toàn bộ stack
docker compose up -d

# 4. Kiểm tra trạng thái
docker compose ps
# Mong đợi: Tất cả services "Up"

# 5. Kiểm tra logs
docker compose logs -f chirpstack
docker compose logs -f node-red
docker compose logs -f grafana
```

---

## 3. Cấu Hình ChirpStack

### Bước 1: Đăng Nhập
- URL: `http://<server-ip>:8080`
- Username: `admin`
- Password: `admin`

### Bước 2: Cấu Hình Region
```
Menu → Regions → AS923
→ Enabled: Yes
```

### Bước 3: Tạo Device Profile
```
Menu → Device Profiles → Add Device Profile
├── Name: Soil-Sensor-v1
├── Region: AS923
├── MAC Version: LoRaWAN 1.0.3
├── Regional Parameters: RP002 Regional Parameters AS923
├── Supports OTAA: Yes
├── Supports Class A: Yes
├── Supports Class B: No
├── Supports Class C: No
└── Payload codec: Custom JavaScript (xem section 4)
```

### Bước 4: Tạo Application
```
Menu → Applications → Add Application
├── Name: SmartFarm-DakLak
├── Description: Coffee farm soil monitoring
└── Payload codec: Custom JavaScript
```

### Bước 5: Đăng Ký Device (mỗi node)
```
Menu → Applications → SmartFarm-DakLak → Devices → Add Device
├── Name: Zone-A-Node (hoặc B, C)
├── Device EUI: <từ sticker trên E78-DTU>
├── OTAA Application Key: <tự tạo 32 hex chars>
├── Device Profile: Soil-Sensor-v1
├── Join Server: ChirpStack (default)
└── Frequency Plan: AS923
```

---

## 4. Payload Decoder (JavaScript)

```javascript
function decodeUplink(input) {
    var bytes = input.bytes;
    var decoded = {};

    if (bytes.length < 16) {
        return { errors: ['Payload too short, need 16 bytes'] };
    }

    // Register 0: Temperature (signed, /10)
    var tempRaw = (bytes[0] << 8) | bytes[1];
    if (tempRaw > 0x7FFF) tempRaw = tempRaw - 0x10000;
    decoded.temperature = tempRaw / 10.0;

    // Register 1: Moisture (unsigned, /10)
    decoded.moisture = ((bytes[2] << 8) | bytes[3]) / 10.0;

    // Register 2: EC (unsigned)
    decoded.ec = (bytes[4] << 8) | bytes[5];

    // Register 3: Salinity (unsigned)
    decoded.salinity = (bytes[6] << 8) | bytes[7];

    // Register 4: Nitrogen (unsigned)
    decoded.nitrogen = (bytes[8] << 8) | bytes[9];

    // Register 5: Phosphorus (unsigned)
    decoded.phosphorus = (bytes[10] << 8) | bytes[11];

    // Register 6: Potassium (unsigned)
    decoded.potassium = (bytes[12] << 8) | bytes[13];

    // Register 7: pH (unsigned, /10)
    decoded.ph = ((bytes[14] << 8) | bytes[15]) / 10.0;

    return {
        data: decoded,
        warnings: []
    };
}
```

---

## 5. Cấu Hình Gateway Bridge

File `config/gateway-bridge.toml`:

```toml
[mqtt]
server = "tcp://mosquitto:1883"
marshaler = "json"

[event_topic_template]
event_topic_template = "as923/gateway/{{ .GatewayID }}/event/{{ .EventType }}"
state_topic_template = "as923/gateway/{{ .GatewayID }}/state/{{ .StateType }}"
```

> **QUAN TRỌNG:**
> - Phải dùng `marshaler = "json"` (không phải protobuf)
> - Topic phải có prefix `as923/`
> - Field name phải là `event_topic_template` (không phải `event_topic`)

---

## 6. Cấu Hình ChirpStack (chirpstack.toml)

```toml
[network]
  enabled_regions = ["as923"]

[integration]
  enabled = ["mqtt"]
  [integration.mqtt]
    server = "tcp://mosquitto:1883"
    json = true
```

> **Lưu ý:** Dùng `[network]` không phải `[network_server]` cho ChirpStack v4.17+

---

## 7. Cấu Hình Node-RED

### Flow Chính
```
MQTT In (topic: application/+/device/+/event/up)
    → Function (parse JSON, extract sensor data)
    → Function (validate ranges, add zone_id)
    → InfluxDB Out (bucket: soil_data, measurement: soil_readings)
    → Debug (xem data realtime)
```

### Cấu Hình InfluxDB Connection
```
Host: influxdb
Port: 8086
Token: <INFLUX_TOKEN>
Organization: smartfarm
Bucket: soil_data
```

---

## 8. Cấu Hình Grafana

### DataSource
```
Type: InfluxDB
URL: http://influxdb:8086
Database: soil_data
Organization: smartfarm
Token: <INFLUX_TOKEN>
```

### Dashboard Panels

| # | Panel | Loại | Alert |
|---|-------|------|-------|
| 1 | Nhiệt độ đất | Gauge (0-60°C) | > 40°C |
| 2 | Độ ẩm đất | Gauge (0-100%) | < 20% |
| 3 | Độ dẫn điện EC | Stat (μS/cm) | > 1500 |
| 4 | NPK | Bar chart (N, P, K) | N<30, P<15, K<60 |
| 5 | pH | Gauge (0-14) | < 4.5 hoặc > 8.5 |
| 6 | Biểu đồ lịch sử | Time series (all, 24h) | - |

---

## 9. Cấu Hình Smart Control

### Khởi Động
```bash
cd smart-control
npm install
npm start    # Port 3002

cd ../simulator
npm install
npm start    # Port 3001 (dev/test)
```

### Tài Khoản Mặc Định

| Username | Password | Role | Quyền |
|----------|----------|------|-------|
| admin | admin123 | Admin | Toàn quyền |
| operator | operator123 | Operator | Điều khiển tưới |
| viewer | viewer123 | Viewer | Chỉ xem |

### Config Files

**zones.json** - Cấu hình khu vực:
```json
{
  "zones": [
    {
      "id": "zone-A",
      "name": "Khu A - Robusta 5000m²",
      "area": 5000,
      "crop": "robusta",
      "plantDate": "2024-03-01",
      "soilType": "bazan-red",
      "pumpId": "pump-1",
      "valveId": "valve-1",
      "moistureSensor": "aabbccdd11223344"
    },
    {
      "id": "zone-B",
      "name": "Khu B - Robusta 3500m²",
      "area": 3500,
      "crop": "robusta",
      "plantDate": "2024-06-01",
      "soilType": "bazan",
      "pumpId": "pump-1",
      "valveId": "valve-2",
      "moistureSensor": "aabbccdd11223345"
    },
    {
      "id": "zone-C",
      "name": "Khu C - Arabica 2000m²",
      "area": 2000,
      "crop": "arabica",
      "plantDate": "2024-01-15",
      "soilType": "alluvial",
      "pumpId": "pump-1",
      "valveId": "valve-3",
      "moistureSensor": "aabbccdd11223346"
    }
  ]
}
```

**actuators.json** - Cấu hình thiết bị:
```json
{
  "pumps": [
    { "id": "pump-1", "name": "Máy bơm chính", "type": "pump", "gpio": 17, "maxDurationMin": 60 }
  ],
  "valves": [
    { "id": "valve-1", "name": "Van Khu A", "type": "valve", "gpio": 22, "zoneId": "zone-A" },
    { "id": "valve-2", "name": "Van Khu B", "type": "valve", "gpio": 23, "zoneId": "zone-B" },
    { "id": "valve-3", "name": "Van Khu C", "type": "valve", "gpio": 24, "zoneId": "zone-C" }
  ]
}
```

**irrigation-rules.json** - Quy tắc tưới:
```json
{
  "zone-A": {
    "moistureMin": 30,
    "moistureMax": 65,
    "maxDurationMin": 30,
    "cooldownMin": 120,
    "rainPause": true,
    "rainThreshold": 5
  },
  "zone-B": {
    "moistureMin": 35,
    "moistureMax": 60,
    "maxDurationMin": 25,
    "cooldownMin": 120,
    "rainPause": true,
    "rainThreshold": 5
  },
  "zone-C": {
    "moistureMin": 40,
    "moistureMax": 70,
    "maxDurationMin": 20,
    "cooldownMin": 180,
    "rainPause": true,
    "rainThreshold": 3
  }
}
```
