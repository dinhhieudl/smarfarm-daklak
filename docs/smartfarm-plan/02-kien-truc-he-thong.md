# 02 - KIẾN TRÚC HỆ THỐNG

## 1. Kiến Trúc Tổng Thể (4 Lớp)

```
┌─────────────────────────────────────────────────────────────────┐
│                     LỚP 4: HIỂN THỊ                            │
│                                                                 │
│   Grafana Dashboard (:3005)    Smart Control UI (:3002)         │
│   ├── Historical charts        ├── Login (JWT, 3 roles)         │
│   ├── Realtime gauges          ├── Dashboard realtime           │
│   ├── Alert panels             ├── Irrigation control           │
│   └── Export (CSV/JSON)        ├── Crop advisory                │
│                                ├── Audit log                    │
│                                └── Weather display              │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTP / WebSocket
┌───────────────────────────────┴─────────────────────────────────┐
│                     LỚP 3: XỬ LÝ DỮ LIỆU                      │
│                                                                 │
│  Node-RED (:1880)           InfluxDB (:8086)     PostgreSQL     │
│  ├── MQTT subscribe         ├── soil_data bucket  (:5432)      │
│  ├── Parse & validate       ├── 1 year retention  ChirpStack DB│
│  └── Write to InfluxDB      └── Flux queries                     │
│                                                                 │
│  Smart Control (:3002)       ChirpStack v4 (:8080)              │
│  ├── Irrigation engine       ├── Device management              │
│  ├── ET0 calculator          ├── OTAA join server                │
│  ├── Advisory engine         ├── Payload decoder                 │
│  ├── Alert system            └── MQTT integration                │
│  └── Weather API                                             │
│                                                                 │
│  Mosquitto MQTT (:1883)                                         │
│  └── Central message bus                                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │ MQTT
┌───────────────────────────────┴─────────────────────────────────┐
│                     LỚP 2: GATEWAY                              │
│                                                                 │
│  E870-L915LG12 (LoRaWAN Gateway)                               │
│  ├── SX1302 Concentrator, AS923 band                           │
│  ├── TX Power: 27 dBm                                          │
│  ├── Packet Forwarder → UDP port 1700                           │
│  ├── Gateway Bridge (Docker) → MQTT                             │
│  └── Gateway ID: 70B3D52026021439                               │
│                                                                 │
│  Gateway Bridge (Docker container)                              │
│  ├── marshaler = "json" (không phải protobuf)                   │
│  ├── Topic: as923/gateway/{GW_ID}/event/up                      │
│  └── Chuyển UDP → MQTT                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ LoRa RF (923.2-924.6 MHz)
┌───────────────────────────────┴─────────────────────────────────┐
│                  LỚP 1: CẢM BIẾN & ĐIỀU KHIỂN                 │
│                                                                 │
│  E78-DTU Node (x3 zones)           Pump/Valve Controller        │
│  ├── LoRaWAN 1.0.3, OTAA, Class A  ├── 2 bơm chính + dự phòng │
│  ├── RS485 → Soil Sensor            ├── 3 van khu vực           │
│  ├── Tự đọc Modbus mỗi 5 phút       └── Điều khiển qua API      │
│  └── Gửi 16-byte payload qua LoRa                                │
│                                                                 │
│  Soil Sensor (x3)                                                   │
│  ├── 8 tham số: Temp, Moisture, EC, Salinity, N, P, K, pH      │
│  ├── Modbus RTU, 9600 baud, addr 0x02                            │
│  ├── IP68, probe 316L inox 60mm                                  │
│  └── Cable RS485 (twisted pair, ≤500m)                           │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Luồng Dữ Liệu Chi Tiết

```
[1] Soil Sensor (RS485 Modbus RTU)
    │ Query: 02 03 00 00 00 08 44 0C
    │ Response: 21 bytes (16 data + 5 CRC)
    │ 8 tham số: Temp(2B) + Moisture(2B) + EC(2B) + Salinity(2B)
    │            + N(2B) + P(2B) + K(2B) + pH(2B)
    ▼
[2] E78-DTU Node (LoRaWAN)
    │ AT+MBINTV=300 (đọc mỗi 300s = 5 phút)
    │ Mã hóa payload: 16 bytes big-endian
    │ AES-128 encryption (LoRaWAN)
    │ Gửi confirmed/unconfirmed uplink
    ▼
[3] E870 Gateway (LoRa RF → UDP)
    │ AS923 band, 8 channels (923.2-924.6 MHz)
    │ DR2 = SF10/125kHz (default)
    │ Semtech UDP protocol, port 1700
    │ Forward packet lên Gateway Bridge
    ▼
[4] Gateway Bridge (Docker container)
    │ Nhận UDP packet
    │ Convert sang JSON (marshaler = "json")
    │ Publish MQTT: as923/gateway/{GW_ID}/event/up
    ▼
[5] Mosquitto MQTT Broker
    │ Central message bus
    │ Topic routing cho ChirpStack + Node-RED
    ▼
[6] ChirpStack v4 (LoRaWAN Network Server)
    │ Verify DevEUI, AppKey (OTAA join)
    │ Decode payload: 16 bytes → {temp, moisture, ec, salinity, n, p, k, ph}
    │ Publish MQTT: application/{app_id}/device/{dev_id}/event/up
    ▼
[7] Node-RED (Data Pipeline)
    │ Subscribe MQTT topic
    │ Parse JSON, validate ranges
    │ Transform: add timestamp, zone_id
    │ Write to InfluxDB: bucket=soil_data, measurement=soil_readings
    ▼
[8] InfluxDB (Time-Series Database)
    │ Store: timestamp, zone_id, temp, moisture, ec, salinity, n, p, k, ph
    │ Retention: 1 year
    │ Query: Flux language
    ▼
[9] Smart Control Service
    │ Đọc data từ MQTT/InfluxDB
    │ Tính toán:
    │   ├── Kiểm tra ngưỡng độ ẩm (moistureMin/Max per zone)
    │   ├── Tính ET0 từ weather API (Open-Meteo)
    │   ├── Quyết định tưới (IF moisture < min AND cooldown OK)
    │   └── Generate advisory (6 giai đoạn cà phê)
    │ Điều khiển:
    │   ├── POST → Relay → ON/OFF pump + valve
    │   └── Ghi audit log
    ▼
[10] Dashboard (Hiển thị)
     ├── Grafana: historical charts, alerts, gauges
     └── Smart Control UI: realtime, control, advisory
```

## 3. Bảng Cổng Dịch Vụ Docker

| # | Dịch vụ | Image | Port(s) | Chức năng |
|---|---------|-------|---------|-----------|
| 1 | PostgreSQL | postgres:16-alpine | 5432 | Database cho ChirpStack |
| 2 | Redis | redis:7-alpine | 6379 | Cache cho ChirpStack |
| 3 | Mosquitto | eclipse-mosquitto:2 | 1883 | MQTT Broker |
| 4 | ChirpStack v4 | chirpstack/chirpstack:4 | 8080 | LoRaWAN Network Server |
| 5 | Gateway Bridge | chirpstack/gateway-bridge:4.1 | 1700/udp | UDP→MQTT bridge |
| 6 | Node-RED | nodered/node-red:latest | 1880 | Data processing pipeline |
| 7 | InfluxDB | influxdb:2.7 | 8086 | Time-series database |
| 8 | Grafana | grafana/grafana:latest | 3005 | Dashboard & monitoring |
| 9 | Smart Control | custom (Node.js) | 3002 | Irrigation + Advisory |
| 10 | Simulator | custom (Node.js) | 3001 | Dev/test sensor simulation |

### Ports cần mở Firewall

```bash
sudo ufw allow 1700/udp    # LoRa packet forwarder
sudo ufw allow 1883/tcp    # MQTT
sudo ufw allow 8080/tcp    # ChirpStack Web UI
sudo ufw allow 1880/tcp    # Node-RED
sudo ufw allow 8086/tcp    # InfluxDB
sudo ufw allow 3005/tcp    # Grafana
sudo ufw allow 3002/tcp    # Smart Control
sudo ufw allow 3001/tcp    # Simulator (dev only)
```

## 4. AS923 Frequency Plan

| Channel | Tần số (MHz) | Chiều | Bandwidth | SF |
|---------|-------------|-------|-----------|-----|
| 0 | 923.2 | Uplink | 125 kHz | SF7-SF12 |
| 1 | 923.4 | Uplink | 125 kHz | SF7-SF12 |
| 2 | 923.6 | Uplink | 125 kHz | SF7-SF12 |
| 3 | 923.8 | Uplink | 125 kHz | SF7-SF12 |
| 4 | 924.0 | Uplink | 125 kHz | SF7-SF12 |
| 5 | 924.2 | Uplink | 125 kHz | SF7-SF12 |
| 6 | 924.4 | Uplink | 125 kHz | SF7-SF12 |
| 7 | 924.6 | Uplink | 125 kHz | SF7-SF12 |
| RX1 | 923.2 | Downlink | 125 kHz | DR8 (SF12) |
| RX2 | 923.2 | Downlink | 500 kHz | DR8 (SF12) |

### Tham Số Quan Trọng

| Parameter | Giá trị |
|-----------|---------|
| Max EIRP | 16 dBm |
| Duty Cycle | Không bắt buộc (khuyến nghị <1%) |
| Default DR | DR2 (SF10/125kHz) |
| RX1 Delay | 1 giây |
| RX2 DR | DR8 (SF12/500kHz) |
| Default RX2 freq | 923.2 MHz |

## 5. MQTT Topic Structure

```
# LoRaWAN uplink (ChirpStack → Node-RED)
application/{app_id}/device/{dev_id}/event/up

# Gateway events (Gateway Bridge → ChirpStack)
as923/gateway/{gateway_id}/event/{event_type}
as923/gateway/{gateway_id}/state/{state_type}

# Smart Control → Pump/Valve (nếu dùng MQTT cho actuators)
smartfarm/{zone_id}/actuator/{actuator_id}/command
smartfarm/{zone_id}/actuator/{actuator_id}/status

# Alerts
smartfarm/alerts/{zone_id}
```

## 6. Data Schema (InfluxDB)

### Measurement: soil_readings

| Field | Type | Unit | Mô tả |
|-------|------|------|-------|
| temperature | float | °C | Nhiệt độ đất |
| moisture | float | % VWC | Độ ẩm thể tích |
| ec | int | μS/cm | Độ dẫn điện |
| salinity | int | - | Độ mặn |
| nitrogen | int | mg/kg | Nitrogen (N) |
| phosphorus | int | mg/kg | Phosphorus (P) |
| potassium | int | mg/kg | Potassium (K) |
| ph | float | pH | Độ axit/kiềm |

### Tags

| Tag | Type | Mô tả |
|-----|------|-------|
| zone_id | string | "zone-A", "zone-B", "zone-C" |
| device_eui | string | DevEUI của node |
| crop_type | string | "robusta", "arabica" |

### Retention Policy
- Duration: 365 days (1 năm)
- Shard Group Duration: 7 days
- Replication Factor: 1
