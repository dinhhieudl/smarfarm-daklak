# 🌱 SmartFarm DakLak — Digital Twin Simulator Guide

> Hệ thống mô phỏng động (Dynamic Digital Twin) cho nông trại cà phê DakLak

---

## 📋 Mục lục

1. [Tổng quan](#tổng-quan)
2. [Cài đặt](#cài-đặt)
3. [Kiến trúc mô phỏng](#kiến-trúc-mô-phỏng)
4. [Physics Engine](#physics-engine)
5. [Scenarios (Kịch bản)](#scenarios)
6. [Fault Injection (Giả lập lỗi)](#fault-injection)
7. [REST API](#rest-api)
8. [CLI](#cli)
9. [CI/CD Integration](#cicd-integration)
10. [Tùy chỉnh](#tùy-chỉnh)

---

## Tổng quan

Simulator này không chỉ phát dữ liệu ngẫu nhiên — nó là một **Digital Twin** mô phỏng vật lý thực tế:

- ☀️ **Chu kỳ ngày/đêm**: Nhiệt độ tăng từ 8h, đỉnh 14h, giảm đêm
- 💧 **Cân bằng nước đất**: ET₀ (bay hơi) + thấm + thoát nước
- 🌧️ **Mô hình mưa**: Xác suất mưa chiều cao (đặc trưng DakLak)
- 🔄 **Feedback loop**: Relay tưới BẬT → độ ẩm tăng dần
- 🔧 **Fault injection**: Packet loss, sensor stuck, garbage data
- 🎬 **Scenario engine**: Kịch bản 10 ngày hạn hán, mùa mưa, v.v.

---

## Cài đặt

```bash
cd simulator
npm install
npm start
# → http://localhost:3001

# CLI
node cli.js help
```

---

## Kiến trúc mô phỏng

```
┌─────────────────────────────────────────────────────────┐
│                    TICK ENGINE                           │
│                                                         │
│  ┌───────────────┐    ┌──────────────┐                  │
│  │  Environment   │    │    Soil      │                  │
│  │    Model       │───▶│   Water      │                  │
│  │               │    │  Balance     │                  │
│  │ • Diurnal     │    │              │                  │
│  │   temp cycle  │    │ • Infiltrate │                  │
│  │ • Solar       │    │ • ET₀ drain  │                  │
│  │   radiation   │    │ • Capillary  │                  │
│  │ • Rain model  │    │ • Runoff     │                  │
│  │ • Wind        │    │              │                  │
│  └───────┬───────┘    └──────┬───────┘                  │
│          │                   │                          │
│          ▼                   ▼                          │
│  ┌──────────────────────────────────────────────┐       │
│  │           Actuator Feedback                   │       │
│  │  Irrigation ON → +8mm water → moisture ↑      │       │
│  │  Cooling ON   → -3°C air → soil temp ↓        │       │
│  └──────────────────┬───────────────────────────┘       │
│                     ▼                                   │
│  ┌──────────────────────────────────────────────┐       │
│  │           Fault Injection Layer               │       │
│  │  packet_loss | sensor_stuck | garbage_data    │       │
│  │  gateway_down | drift | intermittent          │       │
│  └──────────────────┬───────────────────────────┘       │
│                     ▼                                   │
│              MQTT Publish → ChirpStack                   │
└─────────────────────────────────────────────────────────┘
```

---

## Physics Engine

### Mô hình nhiệt độ theo giờ (DakLak)

```
T(hour) = T_mean + T_amplitude × sin(2π × (hour - 14) / 24)

Mùa khô (Nov-Apr): T_mean = 30°C, amplitude = 7°C
Mùa mưa (May-Oct): T_mean = 26°C, amplitude = 4°C
```

Nhiệt độ đất lag ~2 giờ so với không khí và bị giảm biên độ.

### Cân bằng nước trong đất

```
Δθ = (Rain + Irrigation - ET₀ - Runoff - Drainage) / RootDepth

ET₀ = f(Radiation, Temperature, Humidity, Wind)  [Hargreaves-Samani]

Stress Factor:
  - FC (38%): không stress
  - PWP (16%): stress tối đa, ET₀ × 0
```

### Mô hình EC

```
EC_new = EC_current × (moisture_ratio ^ -0.5) - leaching(rain) + baseline_pull
```

EC tăng khi đất khô (hiệu ứng cô đặc), giảm khi mưa (rửa trôi).

---

## Scenarios

### Danh sách kịch bản có sẵn

| Key | Tên | Mô tả |
|-----|-----|-------|
| `drought_10day` | ☀️ Hạn hán 10 ngày | Không mưa, nhiệt độ tăng dần → test ngưỡng cảnh báo |
| `monsoon_5day` | 🌧️ Mùa mưa 5 ngày | Mưa liên tục → test ngập úng |
| `heatwave_3day` | 🌡️ Nắng nóng 3 ngày | 40°C+ → test stress nhiệt |
| `sensor_fault_sequence` | 🔧 Chuỗi lỗi cảm biến | Treo → trôi → rác → phục hồi |
| `gateway_failure` | 💥 Lỗi Gateway | Mất kết nối 20 phút |
| `deep_sleep_cycle` | 💤 Deep Sleep E90 | Node ngủ 95% thời gian |
| `full_day_daklak` | ☕ 1 ngày DakLak | 24h với chu kỳ thực tế |
| `nutrient_depletion` | 🍂 Cạn kiệt dinh dưỡng | 30 ngày mưa rửa trôi NPK |

### Chạy scenario qua API

```bash
# Bắt đầu
curl -X POST http://localhost:3001/api/scenario/start \
  -H 'Content-Type: application/json' \
  -d '{"scenario": "drought_10day"}'

# Dừng
curl -X POST http://localhost:3001/api/scenario/stop

# Xem trạng thái
curl http://localhost:3001/api/scenarios
```

### Chạy scenario qua CLI

```bash
node cli.js scenarios                    # Liệt kê
node cli.js scenario-start drought_10day  # Bắt đầu
node cli.js scenario-stop                 # Dừng
```

### Chạy scenario qua Dashboard

1. Mở http://localhost:3001
2. Chọn tab **Scenarios** ở sidebar
3. Click vào kịch bản muốn chạy
4. Theo dõi Event Log để xem tiến trình

---

## Fault Injection

### Các loại lỗi có sẵn

| Key | Loại | Mô tả |
|-----|------|-------|
| `lora_packet_loss` | 📡 Packet Loss 30% | Mất 30% gói tin LoRa |
| `lora_heavy_loss` | 📡 Packet Loss 70% | Mất 70% gói tin |
| `sensor_stuck` | 🔧 Cảm biến treo | Giá trị đứng yên |
| `sensor_drift` | 📏 Trôi giá trị | Nhiệt độ +0.5°C/tick |
| `gateway_failure` | 💥 Gateway crash | Không gửi data |
| `garbage_data` | 🗑️ Data rác | Giá trị out-of-range |
| `intermittent_gateway` | 🔌 Chập chờn | Mất kết nối định kỳ |
| `ec_sensor_offset` | ⚡ EC sai số | EC +500 µS/cm |

### Inject fault qua API

```bash
# Inject packet loss 50% trong 50 ticks
curl -X POST http://localhost:3001/api/fault/inject \
  -H 'Content-Type: application/json' \
  -d '{"type": "packet_loss", "params": {"rate": 0.5}, "durationTicks": 50}'

# Clear all faults
curl -X POST http://localhost:3001/api/fault/clear
```

### Inject fault qua CLI

```bash
node cli.js faults                      # Liệt kê
node cli.js fault-inject packet_loss 50  # Inject
node cli.js fault-clear                 # Clear
```

---

## REST API

### Simulation Control

| Method | Endpoint | Body | Mô tả |
|--------|----------|------|--------|
| GET | `/api/status` | - | Trạng thái tổng quan |
| POST | `/api/publish` | `{sensor: value}` | Gửi 1 lần |
| POST | `/api/auto` | `{enabled: bool}` | Bật/tắt auto |
| POST | `/api/preset` | `{preset: name}` | Áp dụng preset |
| POST | `/api/actuator` | `{key, value}` | Set actuator feedback |

### Scenario Control

| Method | Endpoint | Body | Mô tả |
|--------|----------|------|--------|
| GET | `/api/scenarios` | - | Liệt kê kịch bản |
| POST | `/api/scenario/start` | `{scenario: key}` | Bắt đầu |
| POST | `/api/scenario/stop` | - | Dừng |

### Fault Control

| Method | Endpoint | Body | Mô tả |
|--------|----------|------|--------|
| GET | `/api/faults` | - | Liệt kê loại lỗi |
| POST | `/api/fault/inject` | `{type, params, duration}` | Inject lỗi |
| POST | `/api/fault/clear` | - | Clear tất cả |

### Health

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/health` | Health check |

---

## CLI

```bash
# Trạng thái
node cli.js status

# Kịch bản
node cli.js scenarios
node cli.js scenario-start drought_10day
node cli.js scenario-stop

# Lỗi
node cli.js faults
node cli.js fault-inject sensor_stuck 30
node cli.js fault-clear

# Preset
node cli.js preset drought
node cli.js preset normal

# Auto mode
node cli.js auto on
node cli.js auto off

# Publish once
node cli.js publish
```

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Simulator Test
on: [push, pull_request]

jobs:
  test-simulator:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: cd simulator && npm install

      - name: Start simulator
        run: cd simulator && node server.js &
        env:
          MQTT_URL: mqtt://localhost:1883

      - name: Wait for startup
        run: sleep 3

      - name: Run health check
        run: curl -f http://localhost:3001/api/health

      - name: Test scenario API
        run: |
          curl -s http://localhost:3001/api/scenarios | jq .
          curl -X POST http://localhost:3001/api/scenario/start \
            -H 'Content-Type: application/json' \
            -d '{"scenario": "drought_10day"}'
          sleep 5
          curl -X POST http://localhost:3001/api/scenario/stop

      - name: Test fault injection
        run: |
          curl -X POST http://localhost:3001/api/fault/inject \
            -H 'Content-Type: application/json' \
            -d '{"type": "packet_loss", "durationTicks": 5}'
          curl -X POST http://localhost:3001/api/fault/clear

      - name: Test presets
        run: |
          for preset in normal drought flooding saline; do
            curl -X POST http://localhost:3001/api/preset \
              -H 'Content-Type: application/json' \
              -d "{\"preset\": \"$preset\"}"
          done

      - name: Run CLI tests
        run: |
          cd simulator
          node cli.js status
          node cli.js scenarios
          node cli.js faults
```

### Test Script (package.json)

```json
{
  "scripts": {
    "start": "node server.js",
    "test": "node test.js",
    "test:scenarios": "node test-scenarios.js",
    "cli": "node cli.js"
  }
}
```

---

## Tùy chỉnh

### Thêm scenario mới

Sửa `lib/scenarios.js`, thêm entry mới:

```javascript
my_custom_scenario: {
  name: '🎬 Kịch bản tùy chỉnh',
  description: 'Mô tả...',
  timeAcceleration: 1440,
  phases: [
    { name: 'Phase 1', durationTicks: 5, setWeather: { temperature: 35 }, notes: '...' },
    { name: 'Phase 2', durationTicks: 3, setSoil: { moisture: 20 }, notes: '...' }
  ]
}
```

### Thêm fault type mới

Sửa `lib/faults.js`, thêm case trong `processTick()`:

```javascript
case 'my_custom_fault': {
  // Custom fault logic
  break;
}
```

### Điều chỉnh vật lý đất

Sửa `lib/soil.js`, thay đổi `SOIL_PROFILES`:

```javascript
'my-soil': {
  name: 'Đất thịt nhẹ',
  fieldCapacity: 30,
  wiltingPoint: 12,
  saturation: 45,
  // ...
}
```

---

## Tham khảo

- [FAO-56: Crop Evapotranspiration](https://www.fao.org/3/x0490e/x0490e00.htm)
- [Van Genuchten Soil Model](https://en.wikipedia.org/wiki/Water_retention_curve)
- [Hargreaves-Samani ET₀](https://en.wikipedia.org/wiki/Hargreaves_equation)
- [DakLak Climate Data](https://weatherspark.com/y/1275/Average-Weather-in-Buon-Ma-Thuot-Vietnam-Year-Round)
