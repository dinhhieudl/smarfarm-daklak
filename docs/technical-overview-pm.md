# SmartFarm DakLak — Tổng Quan Kỹ Thuật Dành Cho Project Manager

> **Phiên bản:** 1.0 | **Cập nhật:** 2026-07-16
> **Mục tiêu:** Giúp PM hiểu sâu cách hệ thống vận hành ở khía cạnh kỹ thuật, từ phần cứng ngoài đồng đến phần mềm trên server, từ luồng dữ liệu đến logic điều khiển tự động.

---

## Mục Lục

1. [Tổng quan dự án](#1-tổng-quan-dự-án)
2. [Kiến trúc hệ thống — Big Picture](#2-kiến-trúc-hệ-thống--big-picture)
3. [Phần cứng — Tầng cảm biến ngoài đồng](#3-phần-cứng--tầng-cảm-biên-ngoài-đồng)
4. [Mạng LoRaWAN — Cách dữ liệu đi từ đồng đến server](#4-mạng-lorawan--cách-dữ-liệu-đi-từ-đồng-đến-server)
5. [Server Stack — Docker Compose](#5-server-stack--docker-compose)
6. [ChirpStack — Network Server](#6-chirpstack--network-server)
7. [MQTT Broker (Mosquitto)](#7-mqtt-broker-mosquitto)
8. [Node-RED — Data Processing Pipeline](#8-node-red--data-processing-pipeline)
9. [InfluxDB — Time-Series Database](#9-influxdb--time-series-database)
10. [Smart Control — Trí tuệ điều khiển](#10-smart-control--trí-tuệ-điều-khiển)
11. [Simulator — Digital Twin](#11-simulator--digital-twin)
12. [Dashboard & Visualization](#12-dashboard--visualization)
13. [Mobile App — React Native](#13-mobile-app--react-native)
14. [Luồng dữ liệu end-to-end](#14-luồng-dữ-liệu-end-to-end)
15. [Logic tưới tự động (Auto Irrigation)](#15-logic-tưới-tự-động-auto-irrigation)
16. [Dự báo tưới (Predictive Irrigation)](#16-dự-báo-tưới-predictive-irrigation)
17. [Tư vấn cây trồng (Advisory System)](#17-tư-vấn-cây-trồng-advisory-system)
18. [Thời tiết real-time](#18-thời-tiết-real-time)
19. [Hệ thống cảnh báo (Alerts)](#19-hệ-thống-cảnh-báo-alerts)
20. [Bảo mật & Phân quyền](#20-bảo-mật--phân-quyền)
21. [Mô phỏng môi trường (Physics Engine)](#21-mô-phỏng-môi-trường-physics-engine)
22. [Kịch bản mô phỏng (Scenarios)](#22-kịch-bản-mô-phỏng-scenarios)
23. [API Reference](#23-api-reference)
24. [Triển khai thực tế (Deployment)](#24-triển-khai-thực-te-deployment)
25. [Kiến trúc vấn đề quan trọng: LoRa DTU vs LoRaWAN](#25-kiến-trúc-vấn-đề-quan-trọng-lora-dtu-vs-lorawan)
26. [Lịch sử phát triển & Trạng thái hiện tại](#26-lịch-sử-phát-triển--trạng-thái-hiện-tại)
27. [Lộ trình & Việc còn lại](#27-lộ-trình--việc-còn-lại)

---

## 1. Tổng quan dự án

### 1.1 SmartFarm DakLak là gì?

SmartFarm DakLak là **hệ thống nông nghiệp thông minh** được thiết kế đặc biệt cho vùng cà phê Tây Nguyên (Đắk Lắk, Việt Nam). Hệ thống kết hợp:

- **IoT phần cứng**: Cảm biến đất đa thông số kết nối qua LoRaWAN
- **Nền tảng server**: 10+ dịch vụ Docker hoạt động song song
- **Trí tuệ nhân tạo**: Hệ thống tư vấn dựa trên tri thức cây trồng cà phê (Robusta & Arabica)
- **Điều khiển tự động**: Tưới nước thông minh theo độ ẩm đất + dự báo thời tiết
- **Mobile app**: Ứng dụng di động theo dõi và điều khiển từ xa

### 1.2 Mục tiêu kinh doanh

- **Tối ưu nước tưới**: Giảm 30-50% nước so với tưới thủ công
- **Tăng năng suất**: Đảm bảo cà phê đủ nước đúng giai đoạn sinh trưởng
- **Giảm nhân công**: Tự động hóa việc theo dõi và điều khiển bơm/van
- **Phòng ngừa rủi ro**: Cảnh báo sớm khi đất khô, nhiễm mặn, hoặc thiếu dinh dưỡng

### 1.3 Phạm vi hệ thống

| Thành phần | Mô tả | Trạng thái |
|-----------|-------|-----------|
| Cảm biến đất (soil sensor) | Đo 8 thông số: nhiệt độ, độ ẩm, EC, NPK, pH, độ mặn | ✅ Hoạt động (simulator) |
| Gateway LoRaWAN (E870) | Nhận dữ liệu từ sensor qua LoRa | ✅ Cấu hình xong |
| Node LoRa (E90-DTU / RAK3172) | Đọc sensor, gửi qua LoRa | ⚠️ Cần thay bằng LoRaWAN node |
| ChirpStack v4 | Network server LoRaWAN | ✅ Dockerized |
| MQTT (Mosquitto) | Message broker giữa các service | ✅ Dockerized |
| Node-RED | Xử lý dữ liệu, routing | ✅ Dockerized |
| InfluxDB | Lưu trữ time-series | ✅ Dockerized |
| Smart Control | Điều khiển + Tư vấn | ✅ Hoạt động (100 tests) |
| Simulator | Digital twin mô phỏng | ✅ Hoạt động (28 tests) |
| Grafana/Superset | Dashboard trực quan | ✅ Dockerized |
| Mobile App | Ứng dụng di động | ✅ React Native + Expo |
| Prometheus | Monitoring hệ thống | ✅ Dockerized |

---

## 2. Kiến trúc hệ thống — Big Picture

### 2.1 Sơ đồ tổng thể

```
                        VƯỜN (Outdoor)                    NHÀ (Indoor)
                   ┌──────────────────────┐         ┌──────────────────────┐
                   │                      │         │                      │
                   │  ┌────────────────┐  │  LoRa   │  ┌────────────────┐  │
                   │  │ Soil Sensor    │  │ AS923   │  │ E870 Gateway   │  │
                   │  │ (8 thông số)  │  │         │  │ L915LG12       │  │
                   │  └───────┬────────┘  │         │  └───────┬────────┘  │
                   │          │ RS485     │         │          │ Ethernet  │
                   │  ┌───────┴────────┐  │         │  ┌───────┴────────┐  │
                   │  │ LoRaWAN Node   │  │────────▶│  │ Router/Switch  │  │
                   │  │ (RAK3172)      │  │         │  └───────┬────────┘  │
                   │  └───────┬────────┘  │         │          │           │
                   │          │ Solar     │         │  ┌───────┴────────┐  │
                   │  ┌───────┴────────┐  │         │  │ Server (Docker)│  │
                   │  │ Solar Panel    │  │         │  │                │  │
                   │  │ + Battery      │  │         │  │ ChirpStack     │  │
                   │  └────────────────┘  │         │  │ Node-RED       │  │
                   │                      │         │  │ InfluxDB       │  │
                   └──────────────────────┘         │  │ Smart Control  │  │
                                                    │  │ Simulator      │  │
                                                    │  │ Grafana        │  │
                                                    │  │ Prometheus     │  │
                                                    │  └────────────────┘  │
                                                    └──────────────────────┘
                                                              │
                                                    ┌─────────┴─────────┐
                                                    │   Mobile App      │
                                                    │ (React Native)    │
                                                    │   iOS / Android   │
                                                    └───────────────────┘
```

### 2.2 10 Dịch vụ Docker

Hệ thống chạy trên **Docker Compose** với 10+ container:

| # | Container | Vai trò | Port |
|---|-----------|---------|------|
| 1 | sf-postgres | Database cho ChirpStack | 5432 |
| 2 | sf-redis | Cache cho ChirpStack | 6379 |
| 3 | sf-mosquitto | MQTT Broker | 1883, 9001 |
| 4 | sf-chirpstack | LoRaWAN Network Server | 8080 |
| 5 | sf-gateway-bridge | UDP → MQTT converter | 1700/udp |
| 6 | sf-nodered | Data processing pipeline | 1880 |
| 7 | sf-influxdb | Time-series database | 8086 |
| 8 | sf-smart-control | Điều khiển + Tư vấn | 3002 |
| 9 | sf-superset-app | Dashboard BI | 8088 |
| 10 | sf-prometheus | Monitoring | 9091 |

### 2.3 Tần số hoạt động

| Dịch vụ | Tần số cập nhật | Ghi chú |
|---------|----------------|---------|
| Sensor → Gateway | Mỗi 30 giây | Tùy cấu hình node |
| Smart Control auto-irrigation check | Mỗi 1 phút | Cron job |
| Weather refresh | Mỗi 30 phút | Open-Meteo API |
| Advisory generation | Mỗi 5 phút | Per zone |
| Simulator tick | Mỗi 30 giây (cấu hình được) | Physics-based |

---

## 3. Phần cứng — Tầng cảm biến ngoài đồng

### 3.1 Cảm biến đất đa thông số (Soil Multi-Parameter Sensor)

Đây là thiết bị "mắt" của hệ thống — cắm thẳng xuống đất để đo liên tục.

**Thông số đo được:**

| Thông số | Ký hiệu | Phạm vi | Độ chính xác | Đơn vị |
|----------|----------|---------|-------------|--------|
| Nhiệt độ đất | temperature | -40 ~ 80°C | ±0.5°C | °C |
| Độ ẩm đất | moisture | 0 ~ 100% | ±3% | %VWC |
| Độ dẫn điện | EC | 0 ~ 20,000 | ±3% FS | µS/cm |
| Độ mặn | salinity | Từ EC | — | ppm |
| Nitrogen | N | 0 ~ 500 | — | mg/kg |
| Phosphorus | P | 0 ~ 200 | — | mg/kg |
| Potassium | K | 0 ~ 500 | — | mg/kg |
| Độ chua | pH | 3 ~ 9 | ±0.1 | pH |

**Thông số vật lý:**

- **Probe**: 316L Stainless Steel, Ø3mm, dài 60mm
- **Chống nước**: IP68 (chôn trong đất)
- **Cáp**: 2m tiêu chuẩn (có thể đặt hàng tới 1200m)
- **Giao tiếp**: RS485 Modbus-RTU
- **Điện áp**: 3.3V ~ 24V DC
- **Mã thiết bị mặc định**: 0x02

**Cách hoạt động:**

```
Cảm biến (trong đất)
    │
    │ RS485 Modbus RTU (9600 baud, 8N1)
    │ Cable: 2m (tối đa 500m ngoài đồng)
    │
    ▼
Node LoRa (RAK3172 hoặc E90-DTU)
    │
    │ LoRa AS923 (923.2 MHz)
    │ Tốc độ không khí: 2.4 kbps
    │ Công suất phát: 22 dBm
    │
    ▼
Gateway E870-L915LG12
    │
    │ Ethernet → WiFi/LAN
    │
    ▼
Server (ChirpStack → MQTT → Smart Control)
```

### 3.2 Quy trình đọc dữ liệu Modbus

Node gửi lệnh Modbus đọc 8 register (16 bytes):

```
Request:  02 03 00 00 00 08 44 0C
          │  │  │        │     └─ CRC16
          │  │  │        └─ Số register: 8
          │  │  └─ Register bắt đầu: 0x0000
          │  └─ Function: 0x03 (Read Holding Registers)
          └─ Địa chỉ sensor: 0x02

Response: 02 03 10 [16 bytes data] CRC16
          └─ 8 register × 2 bytes = 16 bytes
```

**Decode 16 bytes:**

```
Byte 0-1:  Temperature (signed, ÷10)
Byte 2-3:  Moisture (unsigned, ÷10)
Byte 4-5:  EC (unsigned, direct)
Byte 6-7:  Salinity (unsigned)
Byte 8-9:  Nitrogen (unsigned)
Byte 10-11: Phosphorus (unsigned)
Byte 12-13: Potassium (unsigned)
Byte 14-15: pH (unsigned, ÷10)
```

### 3.3 Nguồn điện ngoài đồng

**Lựa chọn A: Nguồn trực tiếp** (gần nhà)
```
12V DC Adapter → Cáp điện → Node + Sensor
```

**Lựa chọn B: Nguồn mặt trời** (xa nhà)
```
Solar Panel 10-20W → Charge Controller (PWM/MPPT) → Battery 12V 7Ah → Node + Sensor
```

**Thời gian hoạt động tự chủ**: 3-5 ngày không nắng (với interval gửi 10 phút).

---

## 4. Mạng LoRaWAN — Cách dữ liệu đi từ đồng đến server

### 4.1 Tại sao LoRaWAN?

- **Phạm vi**: 1-3 km trong điều kiện đồng ruộng (LOS)
- **Tiết kiệm năng lượng**: Node có thể chạy bằng pin mặt trời
- **Xuyên vật cản**: Tốt hơn WiFi/Radio thông thường
- **Phù hợp**: Nông nghiệp, nơi không có mạng internet

### 4.2 Tần số AS923

Việt Nam sử dụng vùng tần số **AS923** (923.2 MHz). Đây là频段 được cấp phép cho IoT tại Đông Nam Á.

### 4.3 Ma lỗi quan trọng: LoRa DTU vs LoRaWAN

Đây là **vấn đề kỹ thuật quan trọng nhất** cần hiểu:

```
┌─────────────┐                          ┌─────────────┐
│  E90-DTU    │  LoRa raw (transparent)  │  E870       │
│  900SL22    │ ──────────────────────▶  │  L915LG12   │
│             │                          │             │
│  NOT LoRaWAN│  ❌ KHÔNG TƯƠNG THÍCH    │  LoRaWAN    │
│  Protocol   │                          │  Only       │
└─────────────┘                          └─────────────┘
```

**E90-DTU (900SL22)** là LoRa radio "trần" — gửi raw LoRa packets, không có LoRaWAN MAC layer.

**E870-L915LG12** là LoRaWAN gateway — chipset SX1302 chỉ demodulate LoRaWAN frames.

**Giải pháp**: Thay E90-DTU bằng LoRaWAN node như RAK3172 (~$15-30/node).

### 4.4 Cấu trúc packet LoRaWAN

```
┌──────────────────────────────────────────────────┐
│ LoRaWAN Frame                                    │
├──────────────────────────────────────────────────┤
│ MHDR (1 byte)     │ FHDR (7 bytes) │ FPort │  │
│                    │ DevAddr(4)     │ (1)   │  │
│                    │ FCtrl(1)       │       │  │
│                    │ FCnt(2)        │       │  │
│                    │ FOpts(0-15)    │       │  │
├──────────────────────────────────────────────────┤
│ FRMPayload: 16 bytes (cảm biến data)              │
│ [Temp(2) Moist(2) EC(2) Sal(2) N(2) P(2) K(2) pH(2)] │
├──────────────────────────────────────────────────┤
│ MIC (4 bytes)     │ Integrity Check              │
└──────────────────────────────────────────────────┘
```

---

## 5. Server Stack — Docker Compose

### 5.1 Tổng quan

Toàn bộ server chạy trên Docker Compose, mỗi dịch vụ là một container riêng biệt. Điều này giúp:

- **Isolation**: Mỗi service chạy riêng, không ảnh hưởng nhau
- **Scalability**: Có thể scale từng service riêng
- **Maintainability**: Dễ upgrade, backup, restore
- **Reproducibility**: Deploy giống hệt trên mọi máy

### 5.2 Docker Compose Configuration

```yaml
#server/docker-compose.yml — Tóm tắt cấu hình
services:
  postgres:        # PostgreSQL 16 — DB cho ChirpStack
    ports: 5432
    volumes: postgres-data

  redis:           # Redis 7 — Cache cho ChirpStack
    ports: 6379
    volumes: redis-data

  mosquitto:       # Eclipse Mosquitto 2 — MQTT Broker
    ports: 1883, 9001

  chirpstack:      # ChirpStack v4 — LoRaWAN Server
    ports: 8080
    depends_on: postgres, redis, mosquitto

  chirpstack-gateway-bridge:  # UDP → MQTT bridge
    ports: 1700/udp
    depends_on: mosquitto

  nodered:         # Node-RED — Data Pipeline
    ports: 1880
    depends_on: mosquitto, chirpstack

  influxdb:        # InfluxDB 2.7 — Time-series DB
    ports: 8086

  superset-app:    # Apache Superset 4.1 — BI Dashboard
    ports: 8088
    depends_on: superset-db, superset-redis

  smart-control:   # Smart Control — Core Logic
    ports: 3002
    depends_on: mosquitto
    build: ../smart-control

  prometheus:      # Prometheus — Monitoring
    ports: 9091
```

### 5.3 Dependency Chain

```
postgres ──┐
redis ─────┤
mosquitto ─┼──▶ chirpstack ──▶ nodered
           │
           └──▶ smart-control
                gateway-bridge ──▶ mosquitto
```

### 5.4 Persistent Volumes

| Volume | Mục đích | Dung lượng ước tính |
|--------|----------|-------------------|
| postgres-data | ChirpStack DB | ~50 MB/năm |
| redis-data | ChirpStack cache | ~10 MB |
| mosquitto-data | MQTT message store | ~100 MB |
| nodered-data | Node-RED flows | ~5 MB |
| influxdb-data | Sensor data time-series | ~500 MB/năm |
| superset_home | Superset config | ~50 MB |
| prometheus-data | Monitoring metrics | ~200 MB |

---

## 6. ChirpStack — Network Server

### 6.1 ChirpStack là gì?

ChirpStack v4 là **LoRaWAN Network Server mã nguồn mở**. Nhiệm vụ chính:

- **Quản lý thiết bị**: Đăng ký, join (OTAA/ABP), quản lý DevEUI/AppKey
- **Decode payload**: Chuyển binary sensor data → JSON
- **Adaptive Data Rate (ADR)**: Tối ưu tốc độ dữ liệu
- **Confirm uplink**: Đảm bảo packet đến nơi
- **Xuất dữ liệu**: Publish lên MQTT broker

### 6.2 Cấu hình chính

```toml
#chirpstack.toml
[postgresql]
  dsn = "postgres://chirpstack:chirpstack@postgres/chirpstack"

[redis]
  servers = ["redis:6379"]

[integration]
  enabled = ["mqtt"]
  [integration.mqtt]
    server = "tcp://mosquitto:1883"
    json = true

[region_server]
  enabled = true
  [[region_server.configuration]]
    region = "AS923"
    enabled = true
```

### 6.3 Payload Decoder

ChirpStack sử dụng JavaScript codec để decode binary payload:

```javascript
function decodeUplink(input) {
    var bytes = input.bytes;
    var decoded = {};

    // Register 0: Temperature (signed, ÷10)
    var tempRaw = (bytes[0] << 8) | bytes[1];
    if (tempRaw > 0x7FFF) tempRaw = tempRaw - 0x10000;
    decoded.temperature = tempRaw / 10.0;

    // Register 1: Moisture (unsigned, ÷10)
    decoded.moisture = ((bytes[2] << 8) | bytes[3]) / 10.0;

    // Register 2: EC (unsigned, direct)
    decoded.ec = (bytes[4] << 8) | bytes[5];

    // ... (tương tự cho salinity, N, P, K, pH)

    return { data: decoded };
}
```

### 6.4 MQTT Topic Structure

Sau khi decode, ChirpStack publish lên MQTT:

```
application/{app_id}/device/{dev_eui}/event/up

Ví dụ:
application/smartfarm-daklak/device/aabbccdd11223344/event/up
```

**Payload structure:**

```json
{
  "applicationId": "smartfarm-daklak",
  "deviceName": "soil-sensor-zone-A",
  "devEUI": "aabbccdd11223344",
  "object": {
    "temperature": 27.5,
    "moisture": 55.0,
    "ec": 450,
    "salinity": 220,
    "nitrogen": 120,
    "phosphorus": 35,
    "potassium": 180,
    "ph": 5.8
  },
  "rxInfo": [{
    "gatewayID": "e870-gateway-01",
    "rssi": -65,
    "loRaSNR": 8.2
  }],
  "txInfo": {
    "frequency": 923200000,
    "dr": 2
  },
  "time": "2026-07-16T10:30:00Z"
}
```

---

## 7. MQTT Broker (Mosquitto)

### 7.1 Vai trò của MQTT

MQTT (Message Queuing Telemetry Transport) là "hệ thần kinh trung ương" kết nối tất cả dịch vụ:

```
ChirpStack ──MQTT──▶ Node-RED ──▶ InfluxDB
                  ──▶ Smart Control ──▶ Dashboard
Gateway Bridge ──MQTT──▶ ChirpStack
Simulator ──MQTT──▶ Smart Control
Smart Control ──MQTT──▶ Actuators (bơm/van)
```

### 7.2 MQTT Topics trong hệ thống

| Topic | Publisher | Subscriber | Nội dung |
|-------|-----------|------------|---------|
| `application/smartfarm-daklak/device/+/event/up` | ChirpStack | Smart Control, Node-RED | Sensor data |
| `application/smartfarm-daklak/device/actuator/+/command` | Smart Control | Simulator | Điều khiển bơm/van |

### 7.3 QoS (Quality of Service)

- **QoS 0**: Fire and forget (sensor data — tolerates loss)
- **QoS 1**: At least once (actuator commands — must arrive)
- **QoS 2**: Exactly once (rarely used)

### 7.4 MQTT Retained Messages & Last Will

Hệ thống sử dụng:
- **Clean session**: true (mỗi lần connect lấy session mới)
- **Keepalive**: 60 giây
- **Auto-reconnect**: 5 giây

---

## 8. Node-RED — Data Processing Pipeline

### 8.1 Node-RED là gì?

Node-RED là công cụ **visual programming** dựa trên flow, được phát triển bởi IBM. Trong SmartFarm, Node-RED đóng vai trò **data processing pipeline** — nhận dữ liệu từ MQTT, xử lý, và gửi đến InfluxDB.

### 8.2 Flow trong hệ thống

```
[MQTT In]                    [Function: Decode]           [InfluxDB Out]
  topic:                       Parse 16 bytes →             measurement: soil
  application/+/               JSON {temp, moisture,        bucket: soil_data
  device/+/event/up            ec, n, p, k, ph}             org: smarfarm
       │                            │                            │
       └────────────────────────────┼────────────────────────────┘
                                    │
                              [Debug Output]
                              (console log)
```

### 8.3 Decode Function trong Node-RED

```javascript
// Input: msg.payload (JSON từ ChirpStack)
// Output: msg.payload (JSON cho InfluxDB)

var payload = msg.payload;
if (payload.object) {
    msg.payload = {
        temperature: payload.object.temperature,
        moisture: payload.object.moisture,
        ec: payload.object.ec,
        salinity: payload.object.salinity,
        nitrogen: payload.object.nitrogen,
        phosphorus: payload.object.phosphorus,
        potassium: payload.object.potassium,
        ph: payload.object.ph,
        zone: payload.deviceName
    };
    return msg;
}
return null;
```

---

## 9. InfluxDB — Time-Series Database

### 9.1 Tại sao InfluxDB?

InfluxDB là database chuyên dụng cho **dữ liệu time-series** — dữ liệu có timestamp, đến liên tục theo thời gian. Phù hợp cho:

- Dữ liệu cảm biến (mỗi 30 giây)
- Logs sự kiện
- Metrics monitoring

### 9.2 Cấu trúc Bucket

```
Organization: smarfarm
Bucket: soil_data
Retention: unlimited

Measurements:
├── sensor_data (tag: zone)
│   ├── temperature (float)
│   ├── moisture (float)
│   ├── ec (float)
│   ├── salinity (float)
│   ├── nitrogen (float)
│   ├── phosphorus (float)
│   ├── potassium (float)
│   └── ph (float)
│
└── control_event (tag: actuator, source)
    ├── action (string)
    ├── prevState (string)
    └── newState (string)
```

### 9.3 Flux Query Examples

```flux
// Lấy dữ liệu 1 giờ gần nhất cho zone-A
from(bucket: "soil_data")
  |> range(start: -1h)
  |> filter(fn: (r) => r["_measurement"] == "sensor_data")
  |> filter(fn: (r) => r["zone"] == "zone-A")
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")

// Tính trung bình nhiệt độ theo giờ
from(bucket: "soil_data")
  |> range(start: -24h)
  |> filter(fn: (r) => r["_field"] == "temperature")
  |> aggregateWindow(every: 1h, fn: mean)
```

### 9.4 Smart Control kết nối InfluxDB

Smart Control sử dụng `@influxdata/influxdb-client` để:

- **Viết sensor data**: Mỗi lần nhận data từ MQTT
- **Viết control event**: Mỗi lần điều khiển bơm/van
- **Đọc lịch sử**: Cho dashboard và export

---

## 10. Smart Control — Trí tuệ điều khiển

### 10.1 Tổng quan

Smart Control là **"bộ não"** của hệ thống. Đây là Node.js application (Express + Socket.IO) thực hiện:

- Nhận dữ liệu cảm biến từ MQTT
- Lưu vào InfluxDB
- Chạy logic tưới tự động
- Tạo tư vấn cây trồng
- Cung cấp REST API cho Dashboard và Mobile App
- Phát WebSocket events real-time

### 10.2 Kiến trúc module

```
smart-control/
├── server.js                 # Entry point, Express app, MQTT, Socket.IO
├── lib/
│   ├── eto.js               # ET₀ calculation (FAO Penman-Monteith)
│   ├── water-balance.js     # Soil water balance model
│   ├── predictive-irrigation.js  # Predictive irrigation scheduler
│   ├── scheduler.js         # Multi-zone priority-based scheduler
│   ├── weather.js           # Open-Meteo API integration
│   ├── influx.js            # InfluxDB persistence layer
│   ├── alerts.js            # Alert/threshold system
│   ├── audit.js             # Audit log system
│   ├── rate-limiter.js      # API rate limiting
│   └── logger.js            # Structured logging
├── middleware/
│   └── auth.js              # JWT authentication
├── config/
│   ├── zones.json           # Zone definitions
│   ├── actuators.json       # Pump/valve config
│   └── irrigation-rules.json # Irrigation rules per zone
└── public/
    └── index.html           # Dashboard UI
```

### 10.3 Dữ liệu trong bộ nhớ (In-Memory State)

Smart Control duy trì state trong bộ nhớ:

```javascript
// Dữ liệu cảm biến theo khu vực
zoneSensorData = {
  'zone-A': { temperature: 27.5, moisture: 55, ec: 450, ... },
  'zone-B': { temperature: 28.0, moisture: 52, ec: 480, ... },
  'zone-C': { temperature: 26.8, moisture: 58, ec: 420, ... }
}

// Trạng thái bơm/van
actuators = {
  'pump-1': { state: 'off', flowRate: 50 },
  'pump-2': { state: 'off', flowRate: 30 },
  'valve-1': { state: 'closed', zone: 'zone-A' },
  'valve-2': { state: 'closed', zone: 'zone-B' },
  'valve-3': { state: 'closed', zone: 'zone-C' }
}

// Quy tắc tưới tự động
irrigationRules = {
  'zone-A': { enabled: true, moistureMin: 35, moistureMax: 65, maxDurationMin: 30, ... },
  'zone-B': { enabled: true, moistureMin: 35, moistureMax: 65, maxDurationMin: 25, ... },
  'zone-C': { enabled: true, moistureMin: 40, moistureMax: 70, maxDurationMin: 20, ... }
}

// Thời tiết hiện tại
weatherData = {
  temperature: 30, humidity: 70, rainfall: 0, ...
}
```

### 10.4 Cron Jobs

| Cron | Tần số | Nhiệm vụ |
|------|--------|----------|
| `*/1 * * * *` | Mỗi 1 phút | Kiểm tra tưới tự động |
| `*/30 * * * *` | Mỗi 30 phút | Cập nhật thời tiết |
| `*/5 * * * *` | Mỗi 5 phút | Tạo tư vấn cho từng zone |

### 10.5 MQTT Connection

```javascript
// Subscribe sensor data
mqttClient.subscribe(`application/${APP_ID}/device/+/event/up`);

// Publish actuator commands
mqttClient.publish(
  `application/${APP_ID}/device/actuator/${actuatorId}/command`,
  JSON.stringify({ actuatorId, type, action, source, timestamp }),
  { qos: 1 }
);
```

---

## 11. Simulator — Digital Twin

### 11.1 Simulator là gì?

Simulator là **Digital Twin** — bản sao ảo của cảm biến ngoài đồng. Nó:

- **Tạo dữ liệu giả lập** giống thật (physics-based)
- **Publish lên MQTT** đúng format như sensor thật
- **Cho phép test** mà không cần phần cứng thật
- **Mô phỏng lỗi** (fault injection) để test hệ thống

### 11.2 Physics Engine

Simulator sử dụng **mô hình vật lý thực** thay vì random:

```
┌─────────────────────────────────────────────────┐
│              Physics-Based Simulation            │
├─────────────────────────────────────────────────┤
│                                                  │
│  1. Mô hình chu kỳ ngày/đêm (Diurnal Cycle)     │
│     - Nhiệt độ: sin wave, đỉnh 14h, đáy 5h      │
│     - Độ ẩm: nghịch với nhiệt độ                │
│     - Bức xạ mặt trời: bell curve               │
│                                                  │
│  2. Mô hình nước trong đất (Soil Water Balance)  │
│     Δθ/Δt = (Rain + Irrigation - ET₀ - Drain)   │
│     Properties: FC, PWP, Ksat, root depth        │
│                                                  │
│  3. Mô hình ET₀ (Penman-Monteith simplified)     │
│     ET₀ = f(T, RH, wind, solar radiation)       │
│                                                  │
│  4. Mô hình EC (Concentration + Leaching)        │
│     EC tăng khi đất khô, giảm khi mưa            │
│                                                  │
│  5. Mô hình pH (Buffering + Rainfall acid)       │
│     pH giảm khi mưa nhiều (mưa có tính axit)     │
│                                                  │
│  6. Mô hình NPK (Uptake + Leaching + Mineral)   │
│     NPK giảm do cây hút + rửa trôi              │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 11.3 Soil Properties (Đất Bazan DakLak)

```javascript
SOIL_PROFILES = {
  'bazan-red': {
    name: 'Đất bazan đỏ (DakLak)',
    fieldCapacity: 38,      // % VWC
    wiltingPoint: 16,       // % VWC
    saturation: 52,         // % VWC
    saturatedConductivity: 15, // mm/hour
    rootDepthM: 0.8,        // meters
    bulkDensity: 1.35,      // g/cm³
    organicMatter: 3.5      // %
  }
}
```

### 11.4 Preset (Kịch bản có sẵn)

| Preset | Mô tả | Giá trị mô phỏng |
|--------|-------|----------------|
| normal | Bình thường | Moisture 55%, pH 5.8, EC 450 |
| drought | Hạn hán | Moisture 12%, EC 2800, pH 6.8 |
| flooding | Ngập úng | Moisture 92%, EC 180, pH 4.2 |
| nutrient_deficient | Thiếu dinh dưỡng | N=25, P=8, K=40 |
| saline | Nhiễm mặn | EC 4200, salinity 2100 |
| acidic | Đất chua | pH 3.8 |

### 11.5 Fault Injection

Simulator có thể mô phỏng lỗi:

| Lỗi | Mô tả | Ảnh hưởng |
|------|-------|----------|
| sensor_stuck | Cảm biến treo | Giá trị đứng yên |
| sensor_drift | Cảm biến trôi | Giá trị lệch dần |
| garbage_data | Dữ liệu rác | Random bytes |
| gateway_failure | Gateway crash | Mất kết nối |

### 11.6 Scenario Engine

Scenario là **kịch bản mô phỏng tự động** chạy theo timeline:

| Scenario | Thời gian | Acceleration | Mô tả |
|----------|-----------|-------------|-------|
| drought_10day | 10 ngày | 1440x | Hạn hán cực đoan |
| monsoon_5day | 5 ngày | 1440x | Mùa mưa liên tục |
| heatwave_3day | 3 ngày | 1440x | Nắng nóng cực đoan |
| full_day_daklak | 24h | 3600x | 1 ngày đầy đủ |
| sensor_fault_sequence | ~2h | 60x | Chuỗi lỗi cảm biến |
| nutrient_depletion | 30 ngày | 1440x | Cạn kiệt NPK |

---

## 12. Dashboard & Visualization

### 12.1 Grafana Dashboard

Grafana hiển thị dữ liệu real-time từ InfluxDB:

| Panel | Loại | Nội dung |
|-------|------|---------|
| Temperature | Gauge + Time Series | Nhiệt độ đất |
| Moisture | Gauge + Time Series | Độ ẩm đất |
| EC | Stat | Độ dẫn điện |
| NPK | Grouped Bar | N-P-K |
| pH | Gauge (3-9) | Độ chua |

### 12.2 Apache Superset

Superset được dùng cho **phân tích BI nâng cao**:
- Dashboard tùy chỉnh
- Phân tích xu hướng theo mùa
- So sánh giữa các zone

### 12.3 Smart Control Dashboard (localhost:3002)

Dashboard web của Smart Control bao gồm:

- **Sensor Gauges**: 8 vòng tròn hiển thị 8 thông số
- **Zone Cards**: Thông tin từng khu vực
- **Actuator Control**: Bật/tắt bơm/van
- **Advisory Panel**: Tư vấn real-time
- **Weather Card**: Thời tiết hiện tại
- **Charts**: Biểu đồ lịch sử (Chart.js)
- **Alert Toasts**: Thông báo cảnh báo

---

## 13. Mobile App — React Native

### 13.1 Tech Stack

| Thành phần | Công nghệ |
|-----------|-----------|
| Framework | React Native + Expo |
| Language | TypeScript |
| State | Zustand + React Query |
| Navigation | React Navigation |
| Real-time | Socket.IO |
| API | Axios (REST) |
| Notifications | Expo Notifications |
| Charts | react-native-gifted-charts |

### 13.2 Screens

| Screen | Mô tả |
|--------|-------|
| LoginScreen | Đăng nhập (JWT) |
| DashboardScreen | Tổng quan sensor data |
| ZonesScreen | Danh sách + bản đồ khu vực |
| ControlScreen | Điều khiển bơm/van |
| AdvisoryScreen | Tư vấn AI theo giai đoạn |
| SettingsScreen | Cài đặt |

### 13.3 State Management (Zustand)

```typescript
// farmStore.ts
interface FarmState {
  zones: Zone[];
  actuators: Record<string, Actuator>;
  weather: WeatherData | null;
  advisories: Record<string, AdvisoryResponse>;
  recommendations: Record<string, PredictiveRecommendation>;
  mqttConnected: boolean;

  fetchZones: () => Promise<void>;
  fetchActuators: () => Promise<void>;
  fetchWeather: () => Promise<void>;
  controlActuator: (actuatorId: string, action: string) => Promise<boolean>;
  updateSensorData: (zoneId: string, data: any) => void;
  // ...
}
```

### 13.4 Real-time Events (Socket.IO)

Mobile app nhận events real-time:

| Event | Nội dung | Nguồn |
|-------|---------|-------|
| `zone_sensor` | Cập nhật sensor data | Smart Control |
| `actuator_update` | Trạng thái bơm/van thay đổi | Smart Control |
| `weather_update` | Cập nhật thời tiết | Smart Control |
| `advisory` | Tư vấn mới | Smart Control |
| `mqtt_status` | Trạng thái MQTT | Smart Control |

---

## 14. Luồng dữ liệu end-to-end

### 14.1 Luồng dữ liệu cảm biến (Uplink)

```
① Cảm biến đo đất (8 thông số)
   │
② RS485 Modbus RTU → Node LoRa (RAK3172)
   │  Encode: 16 bytes binary
   │
③ LoRa AS923 (923.2 MHz, 2.4 kbps)
   │  Phạm vi: 1-3 km
   │
④ Gateway E870 nhận packet
   │  Forward qua UDP (port 1700)
   │
⑤ ChirpStack Gateway Bridge
   │  UDP → MQTT
   │
⑥ ChirpStack Network Server
   │  Decode LoRaWAN frame
   │  Apply JavaScript codec
   │  Output: JSON
   │
⑦ Mosquitto MQTT Broker
   │  Topic: application/smartfarm-daklak/device/+/event/up
   │
⑧ Smart Control (subscriber)
   │  Update zoneSensorData
   │  Write to InfluxDB
   │  Run predictive irrigation
   │  Emit Socket.IO event
   │
⑨ Node-RED (subscriber)
   │  Process & route
   │  Write to InfluxDB (backup path)
   │
⑩ Dashboard (Grafana / Smart Control UI)
   │  Display real-time data
   │
⑪ Mobile App (via REST API + Socket.IO)
   │  Display on phone
```

### 14.2 Luồng điều khiển (Downlink)

```
① User bấm nút trên Dashboard/Mobile App
   │
② REST API: POST /api/control { actuatorId: 'valve-1', action: 'open' }
   │
③ Smart Control: controlActuator()
   │  Update actuators state
   │  Publish MQTT command
   │  Write to InfluxDB (control_event)
   │  Emit Socket.IO 'actuator_update'
   │
④ MQTT Broker
   │  Topic: application/smartfarm-daklak/device/actuator/valve-1/command
   │
⑤ Node LoRa (receiver mode)
   │  Decode command
   │  Activate relay
   │
⑥ Van mở → nước chảy
```

### 14.3 Luồng tưới tự động

```
① Cron job (mỗi 1 phút): checkAutoIrrigation()
   │
② Kiểm tra mỗi zone:
   │  ├── enabled? (tưới tự động có bật không?)
   │  ├── cooldown? (đã hết thời gian chờ chưa?)
   │  ├── rain pause? (đang mưa không?)
   │  └── moisture < moistureMin? (đất khô chưa?)
   │
③ Nếu đủ điều kiện:
   │  ├── Bật pump (controlActuator('pump-1', 'on', 'auto'))
   │  ├── Mở valve (controlActuator('valve-1', 'open', 'auto'))
   │  ├── Bắt đầu timer (maxDurationMin)
   │  └── Emit control_event
   │
④ Timer chạy hoặc moisture >= moistureMax:
   │  ├── Tắt pump
   │  ├── Đóng valve
   │  └── Emit control_event
```

---

## 15. Logic tưới tự động (Auto Irrigation)

### 15.1 Quy tắc tưới

Mỗi khu vực (zone) có quy tắc riêng:

```javascript
irrigationRules = {
  'zone-A': {
    enabled: true,          // Tưới tự động có bật không?
    moistureMin: 35,        // Dưới ngưỡng này → tưới
    moistureMax: 65,        // Trên ngưỡng này → dừng tưới
    maxDurationMin: 30,     // Tối đa tưới 30 phút
    cooldownMin: 120,       // Sau khi tưới, chờ 2h mới tưới lại
    rainPause: true,        // Tự động dừng khi mưa
    rainThreshold: 5        // Mưa > 5mm mới dừng
  }
}
```

### 15.2 State Machine của bơm/van

```
                  ┌──────────┐
                  │  OFF/    │
                  │ CLOSED   │
                  └────┬─────┘
                       │ moisture < min
                       │ AND cooldown passed
                       │ AND no rain
                       ▼
                  ┌──────────┐
                  │  ON/     │
                  │ OPEN     │
                  └────┬─────┘
                       │ moisture >= max
                       │ OR timeout (maxDuration)
                       │ OR rain detected
                       ▼
                  ┌──────────┐
                  │  OFF/    │
                  │ CLOSED   │
                  └──────────┘
```

### 15.3 Safety Features

- **Max Duration Timer**: Tự động tắt bơm sau `maxDurationMin` phút
- **Cooldown Period**: Sau khi tưới xong, chờ `cooldownMin` phút mới tưới lại
- **Rain Pause**: Khi mưa > `rainThreshold` mm, tự động dừng tưới
- **Manual Override**: User có thể tắt tưới tự động bất kỳ lúc nào

---

## 16. Dự báo tưới (Predictive Irrigation)

### 16.1 Tổng quan

Predictive Irrigation sử dụng **mô hình vật lý** để dự báo khi nào cần tưới, thay vì chỉ phản ứng khi đất khô.

### 16.2 ET₀ — Evapotranspiration tham chiếu

ET₀ là lượng nước bốc hơi từ mặt đất + thoát hơi nước từ cây. Được tính theo **FAO Penman-Monteith** (tiêu chuẩn quốc tế):

```
ET₀ = [0.408Δ(Rn - G) + γ(900/(T+273))u₂(es - ea)] / [Δ + γ(1 + 0.34u₂)]

Trong đó:
- T: Nhiệt độ không khí (°C)
- RH: Độ ẩm tương đối (%)
- u₂: Tốc độ gió (m/s)
- Rn: Bức xạ ròng (MJ/m²/day)
- G: Flux nhiệt đất (≈0)
```

### 16.3 Kc — Hệ số cây trồng

Mỗi giai đoạn sinh trưởng có Kc khác nhau:

| Giai đoạn | Robusta Kc | Arabica Kc |
|-----------|-----------|------------|
| Nghỉ (dormant) | 0.40 | 0.35 |
| Ra hoa (flowering) | 0.85 | 0.80 |
| Đậu quả (fruit-set) | 1.00 | 0.95 |
| Phát triển quả | 1.05 | 1.00 |
| Chín (ripening) | 0.80 | 0.75 |
| Thu hoạch (harvest) | 0.50 | 0.45 |

**ETc = ET₀ × Kc** (Lượng nước thực tế cây cần)

### 16.4 Water Balance Model

```javascript
// Cân bằng nước trong đất
Δθ = (Rainfall + Irrigation - ETc - Drainage) / RootDepth

// Field Capacity: 38% (đất giữ nước tối đa)
// Wilting Point: 16% (cây không hút được nước)
// Root Depth: 0.8m
```

### 16.5 Quyết định tưới

```
IF moisture < moistureMin → CRITICAL: Tưới ngay
IF predictedMoisture_24h < moistureMin → NEEDED: Tưới trong 24h
IF daysToIrrigation <= 2 → SOON: Theo dõi sát
IF forecastRain > threshold → DELAY: Dời tưới vì sắp mưa
ELSE → NONE: Ổn định
```

---

## 17. Tư vấn cây trồng (Advisory System)

### 17.1 Knowledge Base — 6 Giai đoạn cà phê

Hệ thống tư vấn dựa trên **tri thức chuyên gia cà phê** cho 6 giai đoạn:

**Giai đoạn 1: Nghỉ (Tháng 11-1)**
- Tưới: 2 tuần/lần, giữ ẩm nhẹ
- Phân: Chuồng hoai + vôi bột
- Rủi ro: Sâu bệnh ẩn trong vỏ cây

**Giai đoạn 2: Ra hoa (Tháng 2-3)**
- Tưới: 1 lần/tuần, tưới đẫm
- Phân: Lân (P) cao, NPK 16-16-8
- Rủi ro: Mưa trái mùa gây rụng hoa

**Giai đoạn 3: Đậu quả (Tháng 3-5)**
- Tưới: 1 lần/tuần, đều đặn
- Phân: NPK 20-10-10 + phân bón lá (Bo, Zn)
- Rủi ro: Rụng quả non nếu stress nước

**Giai đoạn 4: Phát triển quả (Tháng 5-8)**
- Tưới: 1-2 lần/tuần
- Phân: Kali (K) cao — NPK 10-5-20
- Rủi ro: Ngập úng, bệnh thán thư

**Giai đoạn 5: Chín (Tháng 9-10)**
- Tưới: Giảm tưới
- Phân: Kali nhẹ, ngưng đạm
- Rủi ro: Quả thối nếu mưa

**Giai đoạn 6: Thu hoạch (Tháng 10-11)**
- Tưới: Phục hồi sau thu hoạch
- Phân: NPK cân bằng
- Rủi ro: Thiếu nhân công

### 17.2 Logic tạo tư vấn

```javascript
function generateAdvisory(zone) {
  const sensor = zoneSensorData[zone.id];
  const stage = getCurrentStage(zone.crop); // Theo tháng
  const advices = [];

  // 1. Kiểm tra độ ẩm
  if (sensor.moisture < rule.moistureMin) {
    advices.push({ type: 'irrigation', message: 'Cần tưới NGAY' });
  }

  // 2. Kiểm tra dinh dưỡng NPK
  if (sensor.nitrogen < fert.N * 1.5) {
    advices.push({ type: 'fertilization', message: 'Thiếu Nitrogen' });
  }

  // 3. Kiểm tra pH
  if (sensor.ph < 4.5) {
    advices.push({ type: 'soil', message: 'Đất chua, cần bón vôi' });
  }

  // 4. Kiểm tra EC
  if (sensor.ec > 2000) {
    advices.push({ type: 'salinity', message: 'Đất nhiễm mặn!' });
  }

  // 5. Kiểm tra thời tiết
  if (weatherData.rainfall > 20) {
    advices.push({ type: 'weather', message: 'Mưa lớn, tạm dừng tưới' });
  }

  // 6. Tuổi cây
  if (age.months < 12) {
    advices.push({ type: 'info', message: 'Cây non, chăm sóc đặc biệt' });
  }

  return { advices, urgency, stage };
}
```

---

## 18. Thời tiết real-time

### 18.1 Open-Meteo API

Smart Control kết nối **Open-Meteo API** (miễn phí, không cần API key) cho tọa độ DakLak:

```
Latitude: 12.75°N
Longitude: 108.35°E
Timezone: Asia/Ho_Chi_Minh
```

### 18.2 Dữ liệu nhận được

```json
{
  "temperature": 30,
  "humidity": 70,
  "rainfall": 0,
  "windSpeed": 8,
  "cloudCover": 40,
  "forecast": [
    { "day": "Hôm nay", "temp": 28, "rain": 15, "desc": "Mưa rào" },
    { "day": "Ngày mai", "temp": 29, "rain": 8, "desc": "Mưa nhẹ" },
    { "day": "Ngày kia", "temp": 30, "rain": 20, "desc": "Mưa vừa" }
  ],
  "source": "open-meteo"
}
```

### 18.3 Fallback Strategy

Nếu Open-Meteo API không khả dụng, hệ thống tự động chuyển sang **simulated weather** dựa trên mùa:

```javascript
// Mùa mưa (tháng 5-10): nhiệt độ thấp, mưa nhiều
// Mùa khô (tháng 11-4): nhiệt độ cao, ít mưa
const isRainy = month >= 5 && month <= 10;
weatherData = {
  temperature: isRainy ? 25 + random*5 : 28 + random*8,
  rainfall: isRainy ? random*30 : 0
};
```

### 18.4 Cache Strategy

- **Cache duration**: 30 phút
- **Force refresh**: POST /api/weather/refresh
- **Last resort**: Simulated data

---

## 19. Hệ thống cảnh báo (Alerts)

### 19.1 Alert Rules

| Rule ID | Tên | Severity | Điều kiện |
|---------|-----|----------|-----------|
| moisture-critical | Độ ẩm cực thấp | critical | moisture < 20% |
| moisture-warning | Độ ẩm thấp | warning | 20% ≤ moisture < 30% |
| ec-critical | EC cao (nhiễm mặn) | critical | ec > 3000 µS/cm |
| ph-warning-low | pH quá thấp | warning | ph < 4.0 |
| ph-warning-high | pH quá cao | warning | ph > 8.0 |
| temperature-critical | Nhiệt độ cao | critical | temperature > 40°C |
| pump-duration | Bơm chạy quá lâu | warning | Chạy > maxDurationMin |

### 19.2 Cooldown Mechanism

Mỗi alert có **cooldown 15 phút** — sau khi trigger, không trigger lại trong 15 phút:

```javascript
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

function isInCooldown(ruleId, zoneId) {
  const key = `${ruleId}:${zoneId}`;
  const lastTriggered = cooldownMap.get(key);
  return (Date.now() - lastTriggered) < COOLDOWN_MS;
}
```

### 19.3 Alert Severity

- **critical**: Cần hành động ngay (tưới NGAY, xả mặn NGAY)
- **warning**: Cần chú ý (nên tưới sớm, kiểm tra pH)
- **info**: Thông tin (nitrogen thấp, kali thấp)

---

## 20. Bảo mật & Phân quyền

### 20.1 JWT Authentication

```javascript
// Login: POST /api/auth/login
// Response: { token, user: { username, role }, expiresIn: '24h' }

// Protected routes: Authorization: Bearer <token>
```

### 20.2 Role-Based Access Control

| Role | Quyền | Ví dụ |
|------|-------|-------|
| admin | Full access | Quản lý user, cấu hình, điều khiển |
| operator | Control + Read | Điều khiển bơm/van, xem dữ liệu |
| viewer | Read only | Chỉ xem dashboard |

### 20.3 API Rate Limiting

| Endpoint | Giới hạn | Window |
|----------|---------|--------|
| /api/auth/login | 10 requests | 15 phút |
| /api/* (chung) | 120 requests | 1 phút |
| /api/control | 30 requests | 1 phút |
| /api/export/* | 10 requests | 1 phút |

### 20.4 Security Checklist (Production)

- [ ] Thay đổi tất cả password mặc định
- [ ] Tạo InfluxDB token mới
- [ ] Tạo ChirpStack JWT secret mới
- [ ] Bật MQTT authentication
- [ ] Đặt firewall cho các port
- [ ] Sử dụng HTTPS với reverse proxy

---

## 21. Mô phỏng môi trường (Physics Engine)

### 21.1 Mô hình nhiệt độ theo chu kỳ ngày/đêm

```
T(t) = T_mean + T_amplitude × sin(2π × (t - 14) / 24)

- Mùa mưa: T_mean = 26°C, amplitude = 4°C
- Mùa khô: T_mean = 30°C, amplitude = 7°C
- Đỉnh: 14:00, Đáy: 05:00
```

### 21.2 Mô hình bức xạ mặt trời

```
Rs(hour) = 900 × exp(-2 × ((hour - 12) / 6.25)²) W/m²

- Mặt trời mọc: 05:30
- Mặt trời lặn: 18:00
- Đỉnh: 12:00 (900 W/m²)
```

### 21.3 Mô hình mưa

```javascript
// Xác suất mưa theo giờ (mùa mưa)
if (hour >= 13 && hour <= 18) prob = 0.25; // 25% — mưa chiều (typical DakLak)
if (hour >= 10 && hour < 13) prob = 0.10; // 10%

// Cường độ mưa: exponential distribution
intensity = -ln(1 - random) × 5; // mm, mean ~5mm
```

### 21.4 Mô hình nước trong đất

```
Δθ = (Rainfall + Irrigation - ET₀ - Runoff - Drainage) / RootDepth

Runoff: Khi đất gần bão hòa (> saturation)
Drainage: Khi nước > Field Capacity
ET₀: Phụ thuộc vào nhiệt độ, độ ẩm, gió, bức xạ
```

---

## 22. Kịch bản mô phỏng (Scenarios)

### 22.1 Tại sao cần Scenario?

Scenario cho phép **test hệ thống** trong điều kiện cực đoan mà không cần chờ sự kiện thật:

- **Hạn hán 10 ngày**: Kiểm tra cảnh báo khô đất + logic tưới
- **Mùa mưa 5 ngày**: Kiểm tra ngập úng + rain pause
- **Nắng nóng 3 ngày**: Kiểm tra stress nhiệt + nhu cầu tưới tăng
- **Lỗi cảm biến**: Kiểm tra fault detection
- **Lỗi gateway**: Kiểm tra data gap handling

### 22.2 Time Acceleration

| Scenario | Acceleration | Nghĩa |
|----------|-------------|-------|
| 1440x | 1 ngày = 1 phút thực | Nhìn thấy 10 ngày trong 10 phút |
| 3600x | 1 ngày = 24 giây | Nhìn thấy 1 ngày trong 24 giây |
| 60x | 1 phút = 1 giây | Test lỗi cảm biến realtime |

---

## 23. API Reference

### 23.1 Smart Control API (localhost:3002)

**Authentication:**

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| POST | /api/auth/login | No | Đăng nhập, lấy JWT |
| GET | /api/auth/me | Yes | Thông tin user hiện tại |

**Zones & Sensors:**

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | /api/zones | Yes | Danh sách zone + sensor data |
| GET | /api/advisory/:zoneId | Yes | Tư vấn cho zone |
| GET | /api/predictive/:zoneId | Yes | Dự báo tưới cho zone |
| GET | /api/predictive | Yes | Dự báo tưới tất cả zone |

**Control:**

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | /api/actuators | Yes | Danh sách bơm/van |
| POST | /api/control | Yes (admin/operator) | Điều khiển bơm/van |

**Weather & Schedule:**

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | /api/weather | Yes | Thời tiết hiện tại |
| POST | /api/weather/refresh | Yes | Force refresh weather |
| GET | /api/schedule | Yes | Lịch tưới đề xuất |
| GET | /api/schedule/history | Yes | Lịch sử lịch tưới |

**Data & Export:**

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | /api/history | Yes | Lịch sử điều khiển |
| GET | /api/export/sensors | Yes | Export sensor data (JSON/CSV) |
| GET | /api/export/audit | Yes | Export audit log (JSON/CSV) |

**System:**

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | /api/health | No | Health check |
| GET | /api/system | Yes | System status |
| GET | /api/crop-stages | Yes | Knowledge base giai đoạn cây |

### 23.2 Socket.IO Events

| Event | Direction | Nội dung |
|-------|-----------|---------|
| `init` | Server → Client | Khởi tạo: zones, actuators, weather |
| `zone_sensor` | Server → Client | Cập nhật sensor data |
| `actuator_update` | Server → Client | Trạng thái bơm/van thay đổi |
| `weather_update` | Server → Client | Cập nhật thời tiết |
| `advisory` | Server → Client | Tư vấn mới |
| `control_event` | Server → Client | Sự kiện điều khiển |
| `mqtt_status` | Server → Client | Trạng thái MQTT |
| `control` | Client → Server | Điều khiển bơm/van |
| `set_auto_mode` | Client → Server | Bật/tắt tưới tự động |
| `update_rule` | Client → Server | Cập nhật quy tắc tưới |
| `request_advisory` | Client → Server | Yêu cầu tư vấn |

---

## 24. Triển khai thực tế (Deployment)

### 24.1 Yêu cầu hệ thống

| Phần mềm | Version | Ghi chú |
|----------|---------|---------|
| Docker | 20.10+ | Container engine |
| Docker Compose | v2.0+ | Multi-container orchestration |
| Node.js | 18+ | Cho Simulator & Smart Control |
| Git | 2.0+ | Version control |

### 24.2 Hardware Requirement

| Thành phần | Số lượng | Chi phí ước tính |
|-----------|---------|-----------------|
| E870-L915LG12 Gateway | 1 | ~$100 |
| RAK3172 LoRaWAN Node | 3 (per zone) | ~$45 |
| Soil Sensor (8-in-1) | 3 | ~$150 |
| Solar Panel 10W | 3 | ~$60 |
| Battery 12V 7Ah | 3 | ~$45 |
| Server (laptop/PC) | 1 | Existing |

**Tổng chi phí phần cứng ước tính**: ~$400

### 24.3 Quy trình Deploy

```bash
# Bước 1: Clone repo
git clone https://github.com/dinhhieudl/smartfarm-daklak.git
cd smartfarm-daklak

# Bước 2: Khởi động server stack
cd server
docker compose up -d

# Bước 3: Cấu hình ChirpStack
# - Tạo Device Profile
# - Tạo Application
# - Tạo Device (DevEUI)

# Bước 4: Import Node-RED flow
# - Mở http://localhost:1880
# - Import flow từ config/

# Bước 5: Cấu hình Grafana
# - Thêm InfluxDB data source
# - Import dashboard

# Bước 6: Khởi động Simulator
cd ../simulator && npm install && npm start

# Bước 7: Khởi động Smart Control
cd ../smart-control && npm install && npm start

# Bước 8: Kiểm tra
# - Mở http://localhost:3001 (Simulator)
# - Mở http://localhost:3002 (Smart Control)
# - Mở http://localhost:3000 (Grafana)
```

### 24.4 Port Map

| Port | Service | Protocol |
|------|---------|---------|
| 5432 | PostgreSQL | TCP |
| 6379 | Redis | TCP |
| 1700 | Gateway Bridge | UDP |
| 1880 | Node-RED | HTTP |
| 1883 | MQTT Broker | TCP |
| 3001 | Simulator | HTTP |
| 3002 | Smart Control | HTTP |
| 8080 | ChirpStack | HTTP/gRPC |
| 8086 | InfluxDB | HTTP |
| 8088 | Superset | HTTP |
| 9091 | Prometheus | HTTP |

---

## 25. Kiến trúc vấn đề quan trọng: LoRa DTU vs LoRaWAN

### 25.1 Vấn đề

Hệ thống hiện tại có **không tương thích** giữa:

- **E90-DTU (900SL22)**: LoRa radio "trần" — gửi raw LoRa packets
- **E870-L915LG12**: LoRaWAN gateway — chỉ hiểu LoRaWAN frames

### 25.2 Giải pháp đề xuất

| Option | Thay đổi | Chi phí | Khuyến nghị |
|--------|----------|---------|-------------|
| **A** | Giữ E870, thay E90-DTU bằng RAK3172 | ~$15-30/node | ⭐ Khuyến nghị |
| **B** | Giữ E90-DTU, thay E870 bằng raw LoRa gateway | ~$50-80 | Nếu muốn giữ E90 |
| **C** | Thêm MCU trung gian | ~$10-20 | DIY, phức tạp |

### 25.3 Hướng dẫn Option A (Khuyến nghị)

1. Mua RAK3172 (~$15)
2. Flash firmware LoRaWAN (AT command mode)
3. Kết nối RAK3172 với sensor qua RS485
4. Cấu hình OTAA: DevEUI + AppKey trong ChirpStack
5. Node tự động join network và gửi data

---

## 26. Lịch sử phát triển & Trạng thái hiện tại

### 26.1 Sprint History

| Phase | Mô tả | Tests | Files |
|-------|-------|-------|-------|
| Phase 1 | Auth + InfluxDB + Config | - | ~10 |
| Phase 2 | Weather API + Alerts + Audit | - | ~8 |
| Phase 3 | Frontend Refactor | - | ~15 |
| Phase 4 | Testing + CI/CD | 128 | ~10 |
| Phase 5 | Predictive Irrigation | - | ~8 |
| Phase 6 | Rate Limit + Charts + Multi-zone | - | ~5 |

**Tổng**: 53 files, 18,132 insertions, 2,400 deletions

### 26.2 Test Results

```
Smart Control: 8 suites, 100 tests ✅
Simulator:     2 suites,  28 tests ✅
Total:         128 tests passing
ESLint:        0 errors, 6 warnings
```

### 26.3 Trạng thái hiện tại

| Thành phần | Trạng thái |
|-----------|-----------|
| Server Stack (Docker) | ✅ Hoàn thành |
| Smart Control Core | ✅ Hoàn thành |
| Simulator (Digital Twin) | ✅ Hoàn thành |
| Mobile App | ✅ Hoàn thành |
| Hardware Integration | ⚠️ Cần thay E90-DTU |
| Production Deploy | ⚠️ Cần cấu hình bảo mật |
| Monitoring (Prometheus) | ✅ Hoàn thành |

---

## 27. Lộ trình & Việc còn lại

### 27.1 Ưu tiên cao

- [ ] Thay E90-DTU bằng LoRaWAN node (RAK3172)
- [ ] HTTPS/TLS với reverse proxy (nginx/caddy)
- [ ] Email/SMS/Zalo notification
- [ ] Test InfluxDB với dữ liệu thật
- [ ] User management CRUD

### 27.2 Ưu tiên trung bình

- [ ] Historical analytics charts (Chart.js)
- [ ] Crop calendar (lịch âm Việt Nam)
- [ ] Yield prediction
- [ ] Multi-farm support

### 27.3 Ưu tiên thấp

- [ ] Machine learning advisory
- [ ] Integration với cơ quan nông nghiệp
- [ ] Vietnamese UI localization

---

## Tổng kết

SmartFarm DakLak là hệ thống **IoT nông nghiệp thông minh** toàn diện, bao gồm:

1. **Phần cứng**: Cảm biến đất 8 thông số + Gateway LoRaWAN + Node solar-powered
2. **Phần mềm server**: 10+ Docker containers (ChirpStack, MQTT, Node-RED, InfluxDB, Smart Control, Grafana, Superset, Prometheus)
3. **Trí tuệ**: ET₀ calculation, predictive irrigation, crop advisory, auto irrigation
4. **Ứng dụng**: Dashboard web + Mobile app (React Native)
5. **Mô phỏng**: Digital twin với physics engine + scenario engine

Hệ thống đã hoàn thiện phần mềm (128 tests, 6 phases), đang chờ tích hợp phần cứng thật và deploy production.

---

*Document này được tạo tự động từ source code và documentation của dự án SmartFarm DakLak.*
