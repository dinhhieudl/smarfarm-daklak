# SmartFarm DakLak: The Complete Technical Guide

> A deep-dive into building an IoT smart farming system for coffee cultivation in Vietnam's Central Highlands

---

# Part I: Foundation

---

# Chapter 1: Why Smart Farming?

## 1.1 The Problem

Vietnam is the world's second-largest coffee producer, with over 600,000 hectares of coffee plantations concentrated in the Central Highlands (Tây Nguyên). Đắk Lắk alone accounts for roughly 20% of national coffee output. Yet most farms still rely on **manual irrigation decisions** — a farmer walks through the field, feels the soil, and decides whether to turn on the pump.

This approach has critical weaknesses:

- **Over-irrigation**: Wastes water, leaches nutrients, increases disease risk
- **Under-irrigation**: Stresses plants, reduces yield, especially during flowering and fruit set
- **No historical data**: Decisions are based on memory, not measurement
- **Labor intensive**: Requires someone physically present at the farm
- **Late response**: By the time wilting is visible, damage is already done

A coffee plant's water needs vary dramatically across its 12-month growth cycle. During the dormant phase (November–January), it needs minimal water. During fruit set (March–May), even brief water stress can cause mass fruit drop — destroying an entire season's yield.

## 1.2 The Vision

SmartFarm DakLak envisions a system where:

1. **Sensors continuously measure** soil conditions at root depth (temperature, moisture, EC, pH, NPK)
2. **Data flows wirelessly** from field to server via LoRaWAN (kilometer-range, low-power)
3. **A server processes** the data, applies crop-specific knowledge, and generates recommendations
4. **Irrigation happens automatically** — pumps and valves turn on/off based on soil moisture thresholds
5. **Farmers monitor and control** everything from their phone, anywhere in the world
6. **The system learns** from weather patterns and crop growth stages to optimize water usage

## 1.3 Technology Choices

Why these specific technologies?

| Choice | Rationale |
|--------|-----------|
| **LoRaWAN** | 1-3km range, ultra-low power (solar-powered nodes), no cellular subscription |
| **RS485 Modbus** | Industry-standard sensor interface, reliable over long cables |
| **MQTT** | Lightweight publish/subscribe protocol, perfect for IoT |
| **Docker** | Consistent deployment, easy scaling, service isolation |
| **InfluxDB** | Purpose-built for time-series sensor data |
| **Node-RED** | Visual data pipeline, easy to modify without coding |
| **React Native** | Cross-platform mobile app (iOS + Android from one codebase) |
| **Open-Meteo** | Free weather API, no API key required |

---

# Chapter 2: System Architecture

## 2.1 The Big Picture

The system has four distinct layers:

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 4: USER INTERFACE                   │
│  Mobile App (React Native)    Web Dashboard (Express)       │
│  iOS / Android                localhost:3002                 │
└──────────────────────┬──────────────────────┬───────────────┘
                       │ REST API + Socket.IO  │
┌──────────────────────┴──────────────────────┴───────────────┐
│                    LAYER 3: APPLICATION                      │
│  Smart Control (Node.js)       Simulator (Node.js)          │
│  - Auto irrigation             - Digital twin               │
│  - Crop advisory               - Physics engine             │
│  - Predictive scheduling       - Fault injection            │
│  - Weather integration         - Scenario engine            │
│  - Audit logging                                             │
└──────────────────────┬──────────────────────┬───────────────┘
                       │ MQTT                   │
┌──────────────────────┴──────────────────────┴───────────────┐
│                    LAYER 2: DATA PLATFORM                    │
│  Mosquitto        ChirpStack       Node-RED                  │
│  (MQTT Broker)    (LoRaWAN NS)     (Data Pipeline)          │
│  InfluxDB         Grafana          Superset    Prometheus    │
│  (Time-Series)    (Dashboard)      (BI)        (Monitoring)  │
└──────────────────────┬──────────────────────┬───────────────┘
                       │ UDP (1700)            │
┌──────────────────────┴──────────────────────┴───────────────┐
│                    LAYER 1: FIELD HARDWARE                   │
│  Gateway (E870-L915LG12)      Node (RAK3172)               │
│  LoRaWAN Packet Forwarder     LoRaWAN End Device            │
│       ↕ LoRa AS923            ↕ RS485 Modbus                │
│                          Soil Sensor (8-in-1)                │
└─────────────────────────────────────────────────────────────┘
```

## 2.2 Service Inventory

The system runs 12 containers in Docker Compose:

| # | Container | Image | Port | Purpose |
|---|-----------|-------|------|---------|
| 1 | sf-postgres | postgres:16-alpine | 5432 | ChirpStack database |
| 2 | sf-redis | redis:7-alpine | 6379 | ChirpStack cache |
| 3 | sf-mosquitto | eclipse-mosquitto:2 | 1883, 9001 | MQTT message broker |
| 4 | sf-chirpstack | chirpstack/chirpstack:4 | 8080 | LoRaWAN network server |
| 5 | sf-gateway-bridge | chirpstack/chirpstack-gateway-bridge:4.1 | 1700/udp | UDP→MQTT bridge |
| 6 | sf-nodered | nodered/node-red:latest | 1880 | Data processing |
| 7 | sf-influxdb | influxdb:2.7 | 8086 | Time-series database |
| 8 | sf-smart-control | built from smart-control/ | 3002 | Core application |
| 9 | sf-superset-app | apache/superset:4.1.1 | 8088 | BI dashboard |
| 10 | sf-superset-db | postgres:16-alpine | 5434 | Superset database |
| 11 | sf-superset-redis | redis:7-alpine | 6381 | Superset cache |
| 12 | sf-prometheus | prom/prometheus:latest | 9091 | System monitoring |

Plus 2 standalone Node.js applications:
- **Simulator** (port 3001) — Digital twin
- **Mobile App** (React Native) — Phone interface

## 2.3 Dependency Chain

```
postgres ──────┐
redis ─────────┤
mosquitto ─────┼──▶ chirpstack ──▶ nodered ──▶ influxdb
               │                                    ↑
               └──▶ smart-control ──────────────────┘
                                    ──▶ grafana (reads influxdb)
               gateway-bridge ──▶ mosquitto
```

The startup order matters: PostgreSQL, Redis, and Mosquitto must be healthy before ChirpStack starts. ChirpStack must be running before Node-RED can process its output. Smart Control depends only on Mosquitto.

## 2.4 Data Flow Diagram

### Uplink (Sensor → User)

```
Soil Sensor
  │ RS485 Modbus RTU (9600 baud, 16 bytes)
  ▼
RAK3172 LoRaWAN Node
  │ LoRa AS923 (923.2 MHz, 2.4 kbps)
  │ OTAA Join → Encrypted uplink
  ▼
E870-L915LG12 Gateway
  │ Semtech UDP Packet Forwarder (port 1700)
  ▼
ChirpStack Gateway Bridge
  │ UDP → MQTT conversion
  ▼
ChirpStack Network Server
  │ LoRaWAN MAC decode
  │ JavaScript codec decode
  │ Output: JSON { temperature, moisture, ec, ... }
  ▼
Mosquitto MQTT Broker
  │ Topic: application/smartfarm-daklak/device/{devEUI}/event/up
  ├──▶ Smart Control (processes, stores, acts)
  ├──▶ Node-RED (routes to InfluxDB)
  │         ▼
  │     InfluxDB (stores time-series)
  │         ▼
  │     Grafana / Superset (visualizes)
  │
  └──▶ Mobile App (via REST API + Socket.IO)
```

### Downlink (User → Actuator)

```
Mobile App / Web Dashboard
  │ POST /api/control { actuatorId: 'valve-1', action: 'open' }
  ▼
Smart Control
  │ Updates in-memory state
  │ Publishes MQTT command
  │ Writes to InfluxDB (audit trail)
  │ Emits Socket.IO event
  ▼
Mosquitto MQTT Broker
  │ Topic: application/smartfarm-daklak/device/actuator/{id}/command
  ▼
LoRaWAN Node (Class C / receiver mode)
  │ Decodes command
  │ Activates relay
  ▼
Pump/Valve actuated
```

---

# Chapter 3: Hardware Deep Dive

## 3.1 Soil Multi-Parameter Sensor

This is the "eyes" of the system, buried at root depth in the coffee plantation.

### 3.1.1 What It Measures

| Parameter | Symbol | Range | Resolution | Accuracy | Unit |
|-----------|--------|-------|-----------|----------|------|
| Soil Temperature | temperature | -40 to 80 | 0.1 | ±0.5°C @ 25°C | °C |
| Soil Moisture | moisture | 0–100 | 0.1 | ±3% (10–40%) @ 25°C | %VWC |
| Electrical Conductivity | EC | 0–20,000 | 1 | ±3% FS (0–10k) | µS/cm |
| Salinity | salinity | Derived from EC | — | — | ppm |
| Nitrogen | N | 0–500 | 1 | — | mg/kg |
| Phosphorus | P | 0–200 | 1 | — | mg/kg |
| Potassium | K | 0–500 | 1 | — | mg/kg |
| Soil Acidity | pH | 3–9 | 0.1 | — | pH |

### 3.1.2 Measurement Principles

Each parameter uses a different physical principle:

**Temperature** — NTC thermistor with 12-bit ADC. The thermistor's resistance changes predictably with temperature. A 12-bit ADC gives 4096 discrete levels across the measurement range.

**Moisture** — Frequency Domain Reflectometry (FDR). The sensor emits an electromagnetic signal into the soil. The dielectric constant of soil changes with water content (water has ε≈80, dry soil ε≈4). By measuring the signal's frequency shift, the sensor calculates volumetric water content (VWC).

**EC** — Complementary PWM excitation with bridge circuit, temperature-compensated to 25°C. An alternating current is applied to the soil, and the voltage drop is measured. Higher dissolved salt content = higher conductivity. Temperature compensation ensures readings are consistent regardless of soil temperature.

**pH** — Zinc-aluminum galvanic cell. Soil acid/alkali generates a voltage across electrodes. The voltage is logarithmically proportional to hydrogen ion concentration (pH).

**NPK** — Derived from EC and other readings using calibration algorithms. This is an approximation — laboratory analysis is still needed for precise NPK values, but the sensor provides useful relative trends.

### 3.1.3 Physical Specifications

| Property | Value |
|----------|-------|
| Probe Length | 60mm, Ø3mm |
| Probe Material | 316L Stainless Steel |
| Seal Material | ABS + epoxy resin |
| Waterproof Rating | IP68 (fully submersible) |
| Cable Length | 2m standard (customizable to 1200m) |
| Dimensions | 140 × 45 × 15 mm |

The 316L stainless steel probe is critical — it resists corrosion from acidic soil (common in coffee-growing regions) and the epoxy seal prevents water ingress that would destroy the electronics.

### 3.1.4 Power Consumption

| Variant | Supply | Static Current | Measuring Current | Max Current |
|---------|--------|---------------|-------------------|-------------|
| RS485 | 3.3–24V | 3 mA | 25 mA | 35 mA |
| RS485 (Ultra-low power) | 3.3–24V | **0.07 mA** | 25 mA | 35 mA |
| Analog (4-20mA) | 3.3–24V | 10 mA | 25 mA | 50 mA |

The ultra-low-power variant (70µA static) is ideal for solar-powered deployments — it can operate for months on a small battery.

### 3.1.5 RS485 Wiring

```
Wire Color  Function
──────────  ────────
Red         VCC (3.3–24V DC)
Black       GND
Yellow      RS485-A (+)
Blue        RS485-B (-)
```

**Critical**: A and B must be connected correctly (A↔A, B↔B). Reversing them will cause communication failure but won't damage the sensor.

### 3.1.6 Modbus Communication

The sensor uses Modbus RTU protocol at 9600 baud (8N1 — 8 data bits, no parity, 1 stop bit).

**Reading all 8 registers:**

```
Master (Node) → Sensor:
02 03 00 00 00 08 44 0C
│  │  │        │     └─ CRC16
│  │  │        └─ Register count: 8
│  │  └─ Start register: 0x0000
│  └─ Function: 0x03 (Read Holding Registers)
└─ Slave address: 0x02

Sensor → Master:
02 03 10 [16 bytes data] [CRC16]
         │
         ├─ Byte 0-1:  Temperature (signed, ÷10)
         ├─ Byte 2-3:  Moisture (unsigned, ÷10)
         ├─ Byte 4-5:  EC (unsigned, direct)
         ├─ Byte 6-7:  Salinity (unsigned)
         ├─ Byte 8-9:  Nitrogen (unsigned, mg/kg)
         ├─ Byte 10-11: Phosphorus (unsigned, mg/kg)
         ├─ Byte 12-13: Potassium (unsigned, mg/kg)
         └─ Byte 14-15: pH (unsigned, ÷10)
```

**Temperature decoding (signed 16-bit, two's complement):**

If register value > 0x7FFF (32767), the temperature is negative:

```
temperature = -(0xFFFF - value + 1) / 10.0

Example: 0xFFDD
0xFFFF - 0xFFDD + 1 = 0x0023 = 35
35 / 10 = 3.5
Result: -3.5°C
```

## 3.2 LoRaWAN Node (RAK3172)

### 3.2.1 Why RAK3172?

The RAK3172 is based on STM32WLE5 chip — a single-chip LoRaWAN solution. Key advantages:

- **AT Command Set**: No firmware programming needed for basic operation
- **LoRaWAN 1.0.3**: Full compliance with OTAA, ADR, confirmed uplinks
- **RS485 Interface**: Direct connection to soil sensor
- **Low Power**: Deep sleep mode for battery operation
- **Cost**: ~$15 per unit

### 3.2.2 Configuration

```
# LoRaWAN configuration (AT commands)
AT+NJM=1                    # OTAA join mode
AT+DEVEUI=<16-char hex>     # Device EUI (from ChirpStack)
AT+APPEUI=<16-char hex>     # Application EUI
AT+APPKEY=<32-char hex>     # App Key (16 bytes, random)
AT+CLASS=A                  # Class A (lowest power)
AT+DR=2                     # Data Rate (AS923 DR2 = SF10/125kHz)
AT+BAND=7                   # AS923 band

# Join network
AT+JOIN=1

# Send data (every 5 minutes)
# Read Modbus → encode → send via LoRaWAN
AT+SEND=2:<hex payload>
```

### 3.2.3 Power Budget

| State | Current | Duration | Energy per Cycle |
|-------|---------|----------|-----------------|
| Deep Sleep | 2 µA | 295 sec | 0.0006 mAh |
| Wake + Read Sensor | 30 mA | 3 sec | 0.025 mAh |
| LoRa TX (SF10) | 45 mA | 0.5 sec | 0.006 mAh |
| LoRa RX Window | 12 mA | 2 sec | 0.007 mAh |
| **Total per cycle** | — | 300 sec (5 min) | **0.039 mAh** |

With a 12V 7Ah battery: 7000 mAh ÷ 0.039 mAh/cycle = **179,487 cycles** = ~417 days without recharging. Solar panel easily maintains this.

## 3.3 Gateway (E870-L915LG12)

### 3.3.1 Role

The gateway is a **LoRaWAN packet forwarder**. It:

1. Receives LoRa RF packets from nodes (up to 3km away)
2. Demodulates the LoRa signals
3. Forwards them as UDP packets to ChirpStack

### 3.3.2 Specifications

| Property | Value |
|----------|-------|
| LoRa Chipset | SX1302 (concentrator) |
| Frequency | AS923 (923.2 MHz) |
| Channels | 8 simultaneous |
| Range | 2–5 km ( LOS), 1–3 km (obstructed) |
| Power | DC 8–28V (12V/1A adapter) |
| Network | Ethernet (WAN) + WiFi |
| Antennas | LoRa SMA + WiFi SMA |

### 3.3.3 Packet Forwarder Configuration

```json
{
  "gateway_conf": {
    "gateway_ID": "<16-char hex from label>",
    "server_address": "<server IP>",
    "serv_port_up": 1700,
    "serv_port_down": 1700,
    "ref_latitude": 12.667,
    "ref_longitude": 108.050,
    "ref_altitude": 500
  }
}
```

### 3.3.4 Critical Warning

**NEVER power on the E870 without the LoRa antenna attached!** The SX1302 chipset will reflect RF energy back into the power amplifier and burn it out. Always attach the 915MHz antenna first.

## 3.4 Solar Power System

For remote field deployment without grid power:

```
┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────┐
│  Solar   │───▶│   Charge     │───▶│ Battery  │───▶│ Node +   │
│  Panel   │    │  Controller  │    │ 12V 7Ah  │    │ Sensor   │
│  10-20W  │    │  (PWM/MPPT)  │    │          │    │          │
└──────────┘    └──────────────┘    └──────────┘    └──────────┘
```

**Component sizing:**

| Component | Specification | Reason |
|-----------|--------------|--------|
| Solar Panel | 10–20W, 12V | Node consumes ~0.04 mAh/cycle × 288 cycles/day = 11 mAh/day. Panel produces ~3Ah/day in DakLak |
| Battery | 12V 7Ah lead-acid or LiFePO4 | Stores 3–5 days of autonomy |
| Charge Controller | PWM or MPPT, 12V | Prevents overcharging |
| Autonomy | 3–5 days without sun | Battery capacity ÷ daily consumption |

---

# Part II: Software Platform

---

# Chapter 4: Docker Infrastructure

## 4.1 Docker Compose Architecture

The entire server stack runs on Docker Compose with health checks and dependency chains:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chirpstack"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s

  mosquitto:
    image: eclipse-mosquitto:2
    healthcheck:
      test: ["CMD", "mosquitto_sub", "-t", "$$SYS/#", "-C", "1", "-W", "3"]
      interval: 10s

  chirpstack:
    image: chirpstack/chirpstack:4
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      mosquitto: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "--spider", "http://localhost:8080"]
      interval: 30s
```

The `condition: service_healthy` ensures a service only starts after its dependencies pass health checks. This prevents race conditions (e.g., ChirpStack trying to connect to PostgreSQL before it's ready).

## 4.2 Persistent Storage

| Volume | Purpose | Typical Size | Backup Priority |
|--------|---------|-------------|----------------|
| postgres-data | ChirpStack device registry | ~50 MB/year | High |
| redis-data | ChirpStack session cache | ~10 MB | Low (rebuilt on restart) |
| mosquitto-data | MQTT message persistence | ~100 MB | Medium |
| nodered-data | Node-RED flow definitions | ~5 MB | High |
| influxdb-data | All sensor readings | ~500 MB/year | Critical |
| prometheus-data | System metrics | ~200 MB | Low |

**InfluxDB is the most critical** — it contains the historical sensor data. Regular backups:

```bash
docker exec sf-influxdb influx backup /tmp/backup --org smarfarm --token <token>
docker cp sf-influxdb:/tmp/backup ./backups/influxdb-$(date +%Y%m%d)
```

## 4.3 Networking

All containers communicate via Docker's internal bridge network. External access is through mapped ports:

```
External Access:
  localhost:1883  → Mosquitto (MQTT)
  localhost:1880  → Node-RED
  localhost:3001  → Simulator
  localhost:3002  → Smart Control
  localhost:8080  → ChirpStack
  localhost:8086  → InfluxDB
  localhost:8088  → Superset
  localhost:9091  → Prometheus

Internal (Docker network):
  chirpstack → postgres:5432
  chirpstack → redis:6379
  chirpstack → mosquitto:1883
  nodered → mosquitto:1883
  smart-control → mosquitto:1883
  gateway-bridge → mosquitto:1883
```

---

# Chapter 5: ChirpStack Network Server

## 5.1 What ChirpStack Does

ChirpStack v4 is the **brain of the LoRaWAN network**. It handles:

1. **Device Management**: Registration, OTAA join, session keys
2. **MAC Layer Processing**: Frame validation, ADR, duty cycle enforcement
3. **Payload Decoding**: JavaScript codec converts binary → JSON
4. **Integration**: Routes decoded data to MQTT
5. **Web UI**: Device management, monitoring, debugging

## 5.2 Configuration Deep Dive

```toml
# chirpstack.toml

[logging]
  level = 4  # 0=OFF, 1=ERROR, 2=WARN, 3=INFO, 4=DEBUG

[postgresql]
  dsn = "postgres://chirpstack:chirpstack@postgres/chirpstack?sslmode=disable"

[redis]
  servers = ["redis:6379"]

[integration]
  enabled = ["mqtt"]

  [integration.mqtt]
    server = "tcp://mosquitto:1883"
    json = true  # Publish as JSON (not protobuf)

[region_server]
  enabled = true
  [[region_server.configuration]]
    region = "AS923"
    enabled = true
```

## 5.3 Device Profile

A Device Profile defines how a device communicates:

| Setting | Value | Meaning |
|---------|-------|---------|
| Region | AS923 | Vietnamese frequency plan |
| MAC Version | 1.0.3 | LoRaWAN 1.0.3 |
| Regional Parameters | A | AS923 channel plan |
| Class | A | Bidirectional, lowest power |
| Rx1 Delay | 1 second | First receive window delay |
| Rx2 Data Rate | DR0 (SF12/125kHz) | Second receive window |
| ADR | Enabled | Adaptive Data Rate |

## 5.4 Application & Device Setup

```
Application: SmartFarm
├── Device: soil-sensor-zone-A
│   ├── DevEUI: aabbccdd11223344
│   ├── Device Profile: Soil-Sensor-v1
│   ├── App Key: [random 32-char hex]
│   └── Status: Active (joined)
│
├── Device: soil-sensor-zone-B
│   ├── DevEUI: bbccdd1122334455
│   └── ...
│
└── Device: soil-sensor-zone-C
    ├── DevEUI: ccdd112233445566
    └── ...
```

## 5.5 Payload Decoder

The JavaScript decoder runs inside ChirpStack and converts raw bytes to JSON:

```javascript
function decodeUplink(input) {
    var bytes = input.bytes;
    if (bytes.length < 16) {
        return { errors: ['Payload too short: ' + bytes.length] };
    }

    var decoded = {};

    // Temperature: signed 16-bit, ÷10
    var tempRaw = (bytes[0] << 8) | bytes[1];
    if (tempRaw > 0x7FFF) tempRaw = tempRaw - 0x10000;
    decoded.temperature = tempRaw / 10.0;

    // Moisture: unsigned 16-bit, ÷10
    decoded.moisture = ((bytes[2] << 8) | bytes[3]) / 10.0;

    // EC: unsigned 16-bit, direct
    decoded.ec = (bytes[4] << 8) | bytes[5];

    // Salinity: unsigned 16-bit
    decoded.salinity = (bytes[6] << 8) | bytes[7];

    // Nitrogen: unsigned 16-bit, mg/kg
    decoded.nitrogen = (bytes[8] << 8) | bytes[9];

    // Phosphorus: unsigned 16-bit, mg/kg
    decoded.phosphorus = (bytes[10] << 8) | bytes[11];

    // Potassium: unsigned 16-bit, mg/kg
    decoded.potassium = (bytes[12] << 8) | bytes[13];

    // pH: unsigned 16-bit, ÷10
    decoded.ph = ((bytes[14] << 8) | bytes[15]) / 10.0;

    return { data: decoded };
}
```

---

# Chapter 6: MQTT Message Broker

## 6.1 MQTT in SmartFarm

MQTT (Message Queuing Telemetry Transport) is the central nervous system connecting all services. It follows a publish/subscribe model:

```
Publisher → MQTT Broker → Subscriber(s)

Example:
ChirpStack ──publish──▶ Broker ──subscribe──▶ Smart Control
                    ──subscribe──▶ Node-RED
```

## 6.2 Topic Structure

```
application/smartfarm-daklak/device/{devEUI}/event/up
└──┬──┘  └────────┬────────┘  └───┬───┘ └──┬───┘ └──┬───┘
   │              │                │        │        │
   App ID      App name         Device   Event    Direction
```

**Command topic:**
```
application/smartfarm-daklak/device/actuator/{actuatorId}/command
```

## 6.3 QoS Levels

| Level | Name | Guarantee | Use Case |
|-------|------|-----------|----------|
| 0 | At most once | Fire and forget | Sensor data (loss tolerable) |
| 1 | At least once | May duplicate | Actuator commands (must arrive) |
| 2 | Exactly once | Guaranteed, no duplicate | Financial transactions (rare) |

Smart Control uses QoS 0 for sensor data (high frequency, loss tolerable) and QoS 1 for actuator commands (critical, must arrive).

## 6.4 Mosquitto Configuration

```
listener 1883
listener 9001
protocol websockets
max_connections -1
max_inflight_messages 20
max_queued_messages 1000
message_size_limit 0
```

## 6.5 Message Flow Example

```
1. Sensor reads: temp=27.5, moisture=55, ec=450

2. Node sends 16 bytes via LoRa:
   [01][13][02][26][01][C2][00][DC][00][78][00][23][00][B4][00][3A]

3. ChirpStack decodes to JSON:
   {
     "applicationId": "smartfarm-daklak",
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
     "rxInfo": [{ "gatewayID": "e870-01", "rssi": -65 }],
     "time": "2026-07-16T10:30:00Z"
   }

4. Published to MQTT topic:
   application/smartfarm-daklak/device/aabbccdd11223344/event/up

5. Smart Control receives, processes, stores:
   - Updates zoneSensorData['zone-A']
   - Writes to InfluxDB
   - Runs auto-irrigation check
   - Emits Socket.IO event to dashboard
```

---

# Chapter 7: Node-RED Data Pipeline

## 7.1 What Node-RED Does

Node-RED is a visual programming tool for wiring together IoT services. In SmartFarm, it acts as a **data pipeline** between ChirpStack and InfluxDB.

## 7.2 Flow Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  MQTT In     │────▶│  Function:   │────▶│  InfluxDB    │
│              │     │  Process     │     │  Out         │
│  Topic:      │     │              │     │              │
│  application/│     │  - Extract   │     │  Bucket:     │
│  #           │     │    object    │     │  soil_data   │
│              │     │  - Add zone  │     │              │
│              │     │    tag       │     │  Measurement:│
│              │     │  - Validate  │     │  sensor_data │
└──────────────┘     └──────────────┘     └──────────────┘
                            │
                     ┌──────┴──────┐
                     │  Debug      │
                     │  (console)  │
                     └─────────────┘
```

## 7.3 Function Node: Data Processing

```javascript
// Node-RED function node
var payload = msg.payload;

if (payload && payload.object) {
    // Validate data ranges
    var data = payload.object;
    if (data.temperature < -40 || data.temperature > 80) return null;
    if (data.moisture < 0 || data.moisture > 100) return null;
    if (data.ec < 0 || data.ec > 20000) return null;

    // Extract device name as zone identifier
    var zone = payload.deviceName || 'unknown';

    msg.payload = {
        temperature: data.temperature,
        moisture: data.moisture,
        ec: data.ec,
        salinity: data.salinity || (data.ec * 0.5),
        nitrogen: data.nitrogen,
        phosphorus: data.phosphorus,
        potassium: data.potassium,
        ph: data.ph,
        zone: zone,
        timestamp: payload.time || new Date().toISOString()
    };

    return msg;
}
return null;
```

## 7.4 InfluxDB Output Node

Configuration:
- **URL**: http://influxdb:8086
- **Token**: smarfarm-token-2026
- **Organization**: smarfarm
- **Bucket**: soil_data
- **Measurement**: sensor_data
- **Tags**: zone (from msg.payload.zone)
- **Fields**: temperature, moisture, ec, salinity, nitrogen, phosphorus, potassium, ph

---

# Chapter 8: InfluxDB Time-Series Database

## 8.1 Why InfluxDB?

InfluxDB is purpose-built for time-series data. Key advantages over traditional databases:

- **Automatic timestamping**: Every data point gets a nanosecond-precision timestamp
- **Efficient compression**: Time-series data compresses 10:1 or better
- **Flux query language**: Powerful time-based queries
- **Continuous queries**: Automatic downsampling for long-term storage
- **Retention policies**: Auto-delete old data

## 8.2 Data Model

```
Organization: smarfarm
Bucket: soil_data

Measurement: sensor_data
Tags:
  - zone: "zone-A" | "zone-B" | "zone-C"
Fields:
  - temperature (float)
  - moisture (float)
  - ec (float)
  - salinity (float)
  - nitrogen (float)
  - phosphorus (float)
  - potassium (float)
  - ph (float)

Measurement: control_event
Tags:
  - actuator: "pump-1" | "valve-1" | etc.
  - source: "manual" | "auto" | "api" | "auto-rain-pause"
Fields:
  - action (string)
  - prevState (string)
  - newState (string)
```

## 8.3 Flux Query Examples

**Last hour of sensor data for zone-A:**

```flux
from(bucket: "soil_data")
  |> range(start: -1h)
  |> filter(fn: (r) => r["_measurement"] == "sensor_data")
  |> filter(fn: (r) => r["zone"] == "zone-A")
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)
```

**Hourly average temperature for the past week:**

```flux
from(bucket: "soil_data")
  |> range(start: -7d)
  |> filter(fn: (r) => r["_field"] == "temperature")
  |> aggregateWindow(every: 1h, fn: mean)
```

**Control events in the last 24 hours:**

```flux
from(bucket: "soil_data")
  |> range(start: -24h)
  |> filter(fn: (r) => r["_measurement"] == "control_event")
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
```

## 8.4 Smart Control Integration

Smart Control connects to InfluxDB via `@influxdata/influxdb-client`:

```javascript
// lib/influx.js
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

let writeApi = null;
let queryApi = null;

function init() {
    if (!INFLUXDB_TOKEN) {
        console.log('[InfluxDB] No token, using in-memory fallback');
        return;
    }
    const client = new InfluxDB({ url: INFLUXDB_URL, token: INFLUXDB_TOKEN });
    writeApi = client.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET, 'ns');
    queryApi = client.getQueryApi(INFLUXDB_ORG);
    influxAvailable = true;
}

function writeSensorData(zoneId, sensorData) {
    if (!influxAvailable) return;
    const point = new Point('sensor_data')
        .tag('zone', zoneId)
        .timestamp(new Date());
    ['temperature','moisture','ec','salinity','nitrogen','phosphorus','potassium','ph']
        .forEach(f => {
            if (sensorData[f] != null) point.floatField(f, sensorData[f]);
        });
    writeApi.writePoint(point);
}
```

---

# Part III: Smart Control — The Brain

---

# Chapter 9: Smart Control Architecture

## 9.1 Overview

Smart Control is the **core application** — a Node.js server that:

1. Receives sensor data from MQTT
2. Stores it in InfluxDB
3. Runs auto-irrigation logic every minute
4. Generates crop advisory every 5 minutes
5. Fetches weather data every 30 minutes
6. Serves REST API for dashboard and mobile app
7. Pushes real-time events via Socket.IO

## 9.2 Module Architecture

```
smart-control/
├── server.js                  # Entry point (1077 lines)
│   ├── Express HTTP server
│   ├── Socket.IO WebSocket server
│   ├── MQTT client
│   ├── Cron jobs
│   └── REST API routes
│
├── lib/
│   ├── eto.js                # ET₀ calculation (FAO-56)
│   ├── water-balance.js      # Soil water balance model
│   ├── predictive-irrigation.js  # Predictive irrigation
│   ├── scheduler.js          # Multi-zone priority scheduler
│   ├── weather.js            # Open-Meteo API
│   ├── influx.js             # InfluxDB client
│   ├── alerts.js             # Alert system
│   ├── audit.js              # Audit log
│   ├── rate-limiter.js       # API rate limiting
│   └── logger.js             # Structured logging
│
├── middleware/
│   └── auth.js               # JWT authentication
│
├── config/
│   ├── zones.json            # Zone definitions
│   ├── actuators.json        # Pump/valve config
│   └── irrigation-rules.json # Per-zone rules
│
└── public/
    └── index.html            # Dashboard UI
```

## 9.3 In-Memory State

Smart Control maintains critical state in memory:

```javascript
// Current sensor readings per zone
const zoneSensorData = {
    'zone-A': {
        temperature: 27.5,
        moisture: 55.0,
        ec: 450,
        salinity: 220,
        nitrogen: 120,
        phosphorus: 35,
        potassium: 180,
        ph: 5.8,
        lastUpdate: '2026-07-16T10:30:00Z'
    },
    'zone-B': { /* ... */ },
    'zone-C': { /* ... */ }
};

// Actuator states
const actuators = {
    'pump-1': { id: 'pump-1', name: 'Bơm chính #1', type: 'pump',
                state: 'off', autoMode: false, lastChange: null, flowRate: 50 },
    'pump-2': { id: 'pump-2', name: 'Bơm chính #2', type: 'pump',
                state: 'off', autoMode: false, lastChange: null, flowRate: 30 },
    'valve-1': { id: 'valve-1', name: 'Van khu A', type: 'valve',
                 state: 'closed', autoMode: false, lastChange: null, zone: 'zone-A' },
    'valve-2': { /* ... */ },
    'valve-3': { /* ... */ }
};

// Irrigation rules per zone
const irrigationRules = {
    'zone-A': {
        enabled: true,
        moistureMin: 35,
        moistureMax: 65,
        maxDurationMin: 30,
        cooldownMin: 120,
        rainPause: true,
        rainThreshold: 5,
        lastIrrigation: null
    }
};
```

## 9.4 Cron Schedule

```javascript
// Every minute: check auto-irrigation
cron.schedule('*/1 * * * *', () => { checkAutoIrrigation(); });

// Every 30 minutes: update weather
cron.schedule('*/30 * * * *', () => { updateWeather(); });

// Every 5 minutes: generate advisory
cron.schedule('*/5 * * * *', () => {
    ZONES.forEach(zone => {
        const advisory = generateAdvisory(zone);
        io.emit('advisory', { zoneId: zone.id, ...advisory });
    });
});
```

## 9.5 MQTT Connection

```javascript
function connectMQTT() {
    mqttClient = mqtt.connect(MQTT_URL, {
        clientId: 'smartfarm-control-' + Math.random().toString(16).slice(2, 8),
        clean: true,
        connectTimeout: 3000,
        reconnectPeriod: 5000,
        keepalive: 60
    });

    mqttClient.on('connect', () => {
        // Subscribe to all device uplinks
        mqttClient.subscribe(`application/${APP_ID}/device/+/event/up`);
    });

    mqttClient.on('message', (topic, message) => {
        const payload = JSON.parse(message.toString());
        if (payload.object) {
            const devEUI = payload.devEUI;
            const zone = ZONES.find(z => z.moistureSensor === devEUI);
            if (zone) {
                zoneSensorData[zone.id] = payload.object;
                influx.writeSensorData(zone.id, payload.object);
                io.emit('zone_sensor', { zoneId: zone.id, data: payload.object });
            }
        }
    });
}
```

## 9.6 Socket.IO Events

When a WebSocket client connects:

```javascript
io.on('connection', (socket) => {
    // Send initial state
    socket.emit('init', {
        zones: ZONES,
        actuators,
        zoneSensorData,
        irrigationRules,
        weather: weatherData,
        cropStages: CROP_STAGES,
        controlHistory: controlHistory.slice(0, 50),
        mqttConnected
    });

    // Send current advisories
    ZONES.forEach(zone => {
        socket.emit('advisory', { zoneId: zone.id, ...generateAdvisory(zone) });
    });

    // Handle control commands
    socket.on('control', ({ actuatorId, action }) => {
        const success = controlActuator(actuatorId, action, 'manual');
        socket.emit('control_result', { actuatorId, action, success });
    });

    // Handle auto mode toggle
    socket.on('set_auto_mode', ({ zoneId, enabled }) => {
        irrigationRules[zoneId].enabled = enabled;
        io.emit('rule_update', { zoneId, rule: irrigationRules[zoneId] });
    });
});
```

---

# Chapter 10: Auto Irrigation Logic

## 10.1 The Decision Algorithm

Every 60 seconds, `checkAutoIrrigation()` runs for each zone:

```javascript
function checkAutoIrrigation() {
    ZONES.forEach(zone => {
        const rule = irrigationRules[zone.id];
        if (!rule.enabled) return;

        const sensor = zoneSensorData[zone.id];
        const actuator = actuators[zone.valveId];
        const pump = actuators[zone.pumpId];

        // 1. Cooldown check
        if (rule.lastIrrigation) {
            const elapsed = (Date.now() - rule.lastIrrigation) / 60000;
            if (elapsed < rule.cooldownMin) return; // Still in cooldown
        }

        // 2. Rain pause
        if (rule.rainPause && weatherData.rainfall > rule.rainThreshold) {
            if (actuator.state === 'open') {
                controlActuator(zone.valveId, 'close', 'auto-rain-pause');
                controlActuator(zone.pumpId, 'off', 'auto-rain-pause');
            }
            return;
        }

        // 3. Start irrigation if soil is dry
        if (sensor.moisture < rule.moistureMin && actuator.state === 'closed') {
            controlActuator(zone.pumpId, 'on', 'auto');
            controlActuator(zone.valveId, 'open', 'auto');
            rule.lastIrrigation = Date.now();

            // Set max duration timer
            const timer = setTimeout(() => {
                controlActuator(zone.valveId, 'close', 'auto-timeout');
                controlActuator(zone.pumpId, 'off', 'auto-timeout');
            }, rule.maxDurationMin * 60000);
            activeIrrigationTimers.set(zone.id, timer);
        }

        // 4. Stop irrigation if target reached
        if (sensor.moisture >= rule.moistureMax && actuator.state === 'open') {
            controlActuator(zone.valveId, 'close', 'auto-target-reached');
            controlActuator(zone.pumpId, 'off', 'auto-target-reached');
        }
    });
}
```

## 10.2 State Machine

```
                    ┌──────────────┐
                    │              │
        ┌──────────│   INACTIVE   │──────────┐
        │          │              │          │
        │          └──────────────┘          │
        │ moisture < min                     │ moisture >= max
        │ AND no rain                        │ OR timeout
        │ AND cooldown passed                │ OR rain detected
        │                                    │
        ▼                                    │
┌──────────────┐                    ┌────────┴───────┐
│              │                    │                │
│  IRRIGATING  │───────────────────▶│    STOPPED     │
│              │                    │                │
└──────────────┘                    └────────────────┘
```

## 10.3 Safety Features

### Max Duration Timer
Every irrigation starts a `setTimeout`. After `maxDurationMin` minutes, the pump/valve automatically shuts off — even if the moisture sensor fails.

### Cooldown Period
After irrigation stops, a cooldown of `cooldownMin` minutes must pass before the next irrigation. This prevents rapid cycling.

### Rain Pause
If rainfall exceeds `rainThreshold` mm, irrigation stops immediately and cannot restart until rainfall drops below threshold.

### Manual Override
Users can toggle `enabled` on/off per zone via Socket.IO or REST API. This immediately stops any active irrigation.

---

# Chapter 11: Predictive Irrigation (ET₀ Model)

## 11.1 Reference Evapotranspiration (ET₀)

ET₀ represents the water loss from a reference grass surface. SmartFarm calculates it using the **FAO Penman-Monteith equation** — the international standard:

```
ET₀ = [0.408Δ(Rn - G) + γ(900/(T+273))u₂(es - ea)] / [Δ + γ(1 + 0.34u₂)]
```

Where:
- **T** = Mean air temperature (°C)
- **RH** = Relative humidity (%)
- **u₂** = Wind speed at 2m (m/s)
- **Rn** = Net radiation (MJ/m²/day)
- **G** = Soil heat flux (≈0 for daily)
- **Δ** = Slope of vapor pressure curve
- **γ** = Psychrometric constant

### Implementation

```javascript
// lib/eto.js
function calculateET0({ temperature, humidity, windSpeed, cloudCover, altitude }) {
    if (temperature == null || humidity == null) return null;

    const gamma = psychrometricConstant(altitude); // ~0.067 kPa/°C at 500m
    const delta = slopeVaporPressure(temperature);
    const es = saturationVaporPressure(temperature);
    const ea = es * (humidity / 100);

    // Estimate solar radiation from cloud cover
    const Ra = 22; // Extraterrestrial radiation for DakLak (12.75°N)
    const n_N = (100 - cloudCover) / 100;
    const Rs = (0.25 + 0.50 * n_N) * Ra;
    const Rn = 0.75 * Rs - 2.0;

    const numerator = 0.408 * delta * Rn +
        gamma * (900 / (temperature + 273)) * windSpeed * (es - ea);
    const denominator = delta + gamma * (1 + 0.34 * windSpeed);

    let ET0 = numerator / denominator;
    return Math.max(0, Math.min(15, ET0)); // Clamp 0-15 mm/day
}
```

## 11.2 Crop Coefficients (Kc)

Each growth stage has a different water demand:

| Stage | Robusta Kc | Arabica Kc | Meaning |
|-------|-----------|-----------|---------|
| Dormant | 0.40 | 0.35 | Minimal transpiration |
| Flowering | 0.85 | 0.80 | Active growth begins |
| Fruit Set | 1.00 | 0.95 | Full canopy, high demand |
| Fruit Growth | 1.05 | 1.00 | Peak water demand |
| Ripening | 0.80 | 0.75 | Reducing demand |
| Harvest | 0.50 | 0.45 | Post-harvest recovery |

**ETc = ET₀ × Kc** — Actual crop water need.

## 11.3 Water Balance Model

```javascript
class WaterBalance {
    constructor({ zoneId, initialMoisture, fieldCapacity, wiltingPoint, rootDepth }) {
        this.moisture = initialMoisture;
        this.fieldCapacity = fieldCapacity;   // e.g., 38% for bazan-red soil
        this.wiltingPoint = wiltingPoint;     // e.g., 16%
        this.rootDepth = rootDepth;           // e.g., 0.8m
    }

    update({ ETc, rainfall, irrigation, hoursElapsed }) {
        const daysElapsed = hoursElapsed / 24;

        // Water lost to evapotranspiration
        const etLoss = ETc * daysElapsed;

        // Water gained
        const waterGain = rainfall + irrigation;

        // Total water capacity in root zone (mm)
        const totalCapacity = this.availableWater * this.rootDepth;

        // Convert net water change to moisture percentage
        const moistureChange = ((waterGain - etLoss) / totalCapacity) * 100;

        // Update and clamp
        this.moisture += moistureChange;
        this.moisture = Math.max(this.wiltingPoint, Math.min(this.fieldCapacity, this.moisture));

        return { moisture: this.moisture, depletion: this.fieldCapacity - this.moisture };
    }

    predict(ETc, expectedRain, hoursAhead) {
        const daysAhead = hoursAhead / 24;
        const totalCapacity = this.availableWater * this.rootDepth;
        const netChange = ((expectedRain - ETc * daysAhead) / totalCapacity) * 100;
        const predicted = Math.max(this.wiltingPoint, this.moisture + netChange);

        return {
            predictedMoisture: predicted,
            needsIrrigation: predicted < 35,
            daysToWilting: (this.moisture - this.wiltingPoint) / 100 * totalCapacity / ETc
        };
    }
}
```

## 11.4 Prediction Logic

```javascript
function getRecommendation(zoneId, sensorData, weather, cropType, stageId) {
    const ET0 = calculateET0(weather);
    const Kc = getCropCoefficient(cropType, stageId);
    const ETc = ET0 * Kc;

    const currentMoisture = sensorData.moisture;
    const prediction24h = balance.predict(ETc, weather.forecast[0].rain, 24);
    const daysToIrrigation = estimateDaysToIrrigation(currentMoisture, moistureMin, ETc);

    let urgency, reason;

    if (currentMoisture < moistureMin) {
        urgency = 'critical';
        reason = `Moisture ${currentMoisture}% below minimum ${moistureMin}%`;
    } else if (prediction24h.needsIrrigation) {
        urgency = 'needed';
        reason = `Predicted moisture ${prediction24h.predictedMoisture}% in 24h`;
    } else if (daysToIrrigation <= 2) {
        urgency = 'soon';
        reason = `~${daysToIrrigation} days until irrigation needed`;
    } else {
        urgency = 'none';
        reason = `Stable, ${daysToIrrigation} days to next irrigation`;
    }

    // Rain delay
    if (weather.forecast[1].rain > moistureMin) {
        recommendedAction.action = 'delay-rain';
    }

    return { urgency, reason, metrics: { ET0, Kc, ETc, daysToIrrigation } };
}
```

---

# Chapter 12: Multi-Zone Scheduler

## 12.1 Priority Calculation

When multiple zones need irrigation simultaneously, the scheduler uses a priority score:

```
Priority = Urgency × CropValueFactor × WaterStressFactor
```

Where:
- **Urgency** = f(moisture deficit, time since last irrigation, ET demand)
- **CropValueFactor**: Robusta = 1.0, Arabica = 1.3 (higher value crop gets priority)
- **WaterStressFactor** = 1 + (target - current) / target

## 12.2 Pump Capacity Constraints

```
Pump 1 (50 L/min): Shared by zone-A and zone-B
Pump 2 (30 L/min): Dedicated to zone-C
```

The scheduler assigns time slots to avoid pump overload:

```javascript
function assignTimeSlots(zonePlans, window, actuators) {
    const pumpSchedule = {}; // pumpId → [{ start, end }]

    for (const plan of sortedByPriority) {
        const pumpId = plan.pumpId;
        let startOffset = currentOffset;

        // Find earliest slot where pump is free
        for (const slot of pumpSchedule[pumpId]) {
            if (startOffset < slot.end && startOffset + duration > slot.start) {
                startOffset = slot.end;
            }
        }

        // Assign slot
        pumpSchedule[pumpId].push({ start: startOffset, end: startOffset + duration });
    }
}
```

## 12.3 Irrigation Windows

To minimize evaporation, irrigation is scheduled during optimal windows:

| Window | Time | Efficiency |
|--------|------|-----------|
| Morning | 05:00–07:00 | 95% |
| Afternoon | 16:00–18:00 | 90% |

---

# Chapter 13: Crop Advisory System

## 13.1 Knowledge Base

The advisory system embeds **expert knowledge** about Vietnamese coffee cultivation:

### Robusta Growth Cycle

| Month | Stage | Water Need | Fertilizer | Key Risks |
|-------|-------|-----------|-----------|-----------|
| 11–1 | Dormant | 2 weeks/cycle | Manure + lime | Pest hiding in bark |
| 2–3 | Flowering | 1×/week, heavy | High P (NPK 16-16-8) | Late rain drops flowers |
| 3–5 | Fruit Set | 1×/week, consistent | NPK 20-10-10 + Bo, Zn | Water stress → mass fruit drop |
| 5–8 | Fruit Growth | 1-2×/week | High K (NPK 10-5-20) | Waterlogging, anthracnose |
| 9–10 | Ripening | Reduce irrigation | Light K, no nitrogen | Rain → fruit rot |
| 10–11 | Harvest | Post-harvest recovery | Balanced NPK | Labor shortage |

### Arabica Differences
- Higher water demand during fruit growth (Kc = 1.00 vs 1.05)
- Earlier flowering (shorter dormant period)
- Selective harvest needed (ripens unevenly)

## 13.2 Advisory Generation

```javascript
function generateAdvisory(zone) {
    const sensor = zoneSensorData[zone.id];
    const stage = getCurrentStage(zone.crop);
    const rule = irrigationRules[zone.id];
    const advices = [];
    let urgency = 'info';

    // 1. Moisture check
    if (sensor.moisture < rule.moistureMin) {
        urgency = 'critical';
        advices.push({
            type: 'irrigation',
            message: `Moisture ${sensor.moisture.toFixed(1)}% < ${rule.moistureMin}%. Irrigate NOW.`,
            action: stage.irrigation.notes
        });
    } else if (sensor.moisture > rule.moistureMax) {
        urgency = 'warning';
        advices.push({
            type: 'drainage',
            message: `Moisture ${sensor.moisture.toFixed(1)}% > ${rule.moistureMax}%. Check drainage.`,
        });
    }

    // 2. Nutrient check (NPK)
    const fert = stage.fertilization;
    if (fert.N > 0 && sensor.nitrogen < fert.N * 1.5) {
        advices.push({ type: 'fertilization', message: `N low: ${sensor.nitrogen}/${fert.N * 2} mg/kg` });
    }

    // 3. pH check
    if (sensor.ph < 4.5) {
        advices.push({ type: 'soil', message: `Acidic soil pH ${sensor.ph}. Apply lime (dolomite) 2-3 t/ha.` });
    } else if (sensor.ph > 7.0) {
        advices.push({ type: 'soil', message: `Alkaline soil pH ${sensor.ph}. Apply sulfur.` });
    }

    // 4. EC (salinity) check
    if (sensor.ec > 2000) {
        urgency = 'critical';
        advices.push({ type: 'salinity', message: `EC ${sensor.ec} µS/cm — SALINE! Leach immediately.` });
    }

    // 5. Temperature stress
    if (sensor.temperature > 38) {
        advices.push({ type: 'temperature', message: `Soil temp ${sensor.temperature}°C. Apply mulch.` });
    }

    // 6. Weather-based
    if (weatherData.rainfall > 20) {
        advices.push({ type: 'weather', message: `Heavy rain ${weatherData.rainfall}mm. Pause irrigation.` });
    }

    // 7. Plant age context
    if (age.months < 12) {
        advices.push({ type: 'info', message: `Young plant (${age.months}mo). Light but frequent care.` });
    }

    return { advices, urgency, stage };
}
```

---

# Chapter 14: Weather Integration

## 14.1 Open-Meteo API

SmartControl fetches weather from **Open-Meteo** — a free, open-source weather API:

```
https://api.open-meteo.com/v1/forecast
  ?latitude=12.75
  &longitude=108.35
  &current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,cloud_cover
  &daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode
  &forecast_days=3
  &timezone=Asia/Ho_Chi_Minh
```

## 14.2 Weather Code Mapping

Open-Meteo uses WMO weather codes:

| Code | Vietnamese | English |
|------|-----------|---------|
| 0 | Trời quang | Clear sky |
| 1 | Ít mây | Mainly clear |
| 2 | Mây rải rác | Partly cloudy |
| 3 | Nhiều mây | Overcast |
| 45, 48 | Sương mù | Fog |
| 51–55 | Mưa phùn | Drizzle |
| 61–65 | Mưa | Rain |
| 80–82 | Mưa rào | Rain showers |
| 95–99 | Giông bão | Thunderstorm |

## 14.3 Caching Strategy

```javascript
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

async function getWeather() {
    const now = Date.now();

    // Return cache if valid
    if (cachedWeather && (now - lastFetchTime) < CACHE_DURATION_MS) {
        return cachedWeather;
    }

    // Try API
    const apiData = await fetchWeatherFromAPI();
    if (apiData) {
        cachedWeather = apiData;
        lastFetchTime = now;
        return cachedWeather;
    }

    // Fallback: simulated weather based on season
    if (!cachedWeather) {
        cachedWeather = getSimulatedWeather();
    }
    return cachedWeather;
}
```

## 14.4 Simulated Weather Fallback

When the API is unavailable (no internet, API down), SmartControl generates realistic weather:

```javascript
function getSimulatedWeather() {
    const month = new Date().getMonth() + 1;
    const isRainy = month >= 5 && month <= 10;

    return {
        temperature: isRainy ? 25 + Math.random() * 5 : 28 + Math.random() * 8,
        humidity: isRainy ? 75 + Math.random() * 20 : 50 + Math.random() * 20,
        rainfall: isRainy ? (Math.random() > 0.5 ? Math.random() * 30 : 0) : 0,
        forecast: [
            { day: 'Hôm nay', temp: 28, rain: isRainy ? 15 : 0, desc: 'Mưa rào' },
            { day: 'Ngày mai', temp: 29, rain: isRainy ? 8 : 0, desc: 'Mưa nhẹ' },
            { day: 'Ngày kia', temp: 30, rain: isRainy ? 20 : 0, desc: 'Mưa vừa' }
        ],
        source: 'simulated'
    };
}
```

---

# Part IV: Simulator — Digital Twin

---

# Chapter 15: Physics Engine

## 15.1 Why a Physics Engine?

The simulator doesn't just generate random numbers. It uses **real soil physics** to create realistic sensor data. This means:

- **Diurnal temperature cycles** follow sinusoidal patterns
- **Soil moisture** responds to rainfall, irrigation, and evapotranspiration
- **EC increases** as soil dries (concentration effect)
- **NPK depletes** from plant uptake and rain leaching
- **pH drifts** slightly with heavy rainfall

## 15.2 Soil Water Balance Model

The core equation:

```
Δθ/Δt = (Rainfall + Irrigation - ET₀ - Runoff - DeepDrainage) / RootDepth
```

For DakLak's **bazan-red soil** (laterite):

```javascript
SOIL_PROFILES = {
    'bazan-red': {
        name: 'Đất bazan đỏ (DakLak)',
        fieldCapacity: 38,        // %VWC — max water soil holds
        wiltingPoint: 16,         // %VWC — below this, plants can't extract water
        saturation: 52,           // %VWC — soil is fully saturated
        saturatedConductivity: 15, // mm/hour — how fast water drains
        rootDepthM: 0.8,          // meters — coffee root zone
        bulkDensity: 1.35,        // g/cm³
        organicMatter: 3.5        // %
    }
};
```

### Moisture Update Logic

```javascript
function updateSoilMoisture(currentMoisture, rainfall, irrigationMm, et0, temperature, soilProfile, dtHours) {
    const soil = SOIL_PROFILES[soilProfile];
    const rootDepthMm = soil.rootDepthM * 1000;

    // Current water content in mm
    const currentWaterMm = (currentMoisture / 100) * rootDepthMm;
    const satWaterMm = (soil.saturation / 100) * rootDepthMm;
    const fcWaterMm = (soil.fieldCapacity / 100) * rootDepthMm;
    const pwpWaterMm = (soil.wiltingPoint / 100) * rootDepthMm;

    // Infiltration (with runoff if near saturation)
    const totalInput = rainfall + irrigationMm;
    let infiltration = totalInput;
    let runoff = 0;
    if (currentWaterMm + totalInput > satWaterMm) {
        runoff = (currentWaterMm + totalInput) - satWaterMm;
        infiltration = totalInput - runoff;
    }

    // Deep drainage (above field capacity)
    let drainage = 0;
    if (currentWaterMm > fcWaterMm) {
        drainage = Math.min(
            currentWaterMm - fcWaterMm,
            soil.saturatedConductivity * dtHours
        );
    }

    // Actual ET (reduced by water stress)
    let stressFactor = 1.0;
    if (currentMoisture < soil.fieldCapacity) {
        stressFactor = Math.max(0,
            (currentMoisture - soil.wiltingPoint) / (soil.fieldCapacity - soil.wiltingPoint)
        );
    }
    const et_actual = et0 * stressFactor * Math.min(1.5, temperature / 30) * dtHours;

    // Water balance
    let newWaterMm = currentWaterMm + infiltration - et_actual - drainage;
    newWaterMm = Math.max(pwpWaterMm, Math.min(satWaterMm, newWaterMm));

    return { newMoisture: (newWaterMm / rootDepthMm) * 100, runoff, drainage, et_actual };
}
```

## 15.3 Temperature Model

Soil temperature follows a **damped sinusoidal** pattern — it lags behind air temperature and has smaller amplitude:

```javascript
function updateSoilTemperature(airTemperature, currentSoilTemp, depthCm, dtHours) {
    const tau = 6; // hours — soil responds slowly
    const coupling = 1 - Math.exp(-dtHours / tau);

    // Soil trends toward (air temp - 2°C), with lag
    const targetTemp = airTemperature - 2;
    return currentSoilTemp + coupling * (targetTemp - currentSoilTemp)
           + (Math.random() - 0.5) * 0.3; // sensor noise
}
```

## 15.4 EC Model

Electrical conductivity increases when soil dries (ions become concentrated) and decreases when it rains (leaching):

```javascript
function updateEC(currentEC, moisture, rainfall, irrigationMm, baseEC) {
    const moistureRatio = moisture / 55; // normalize to "normal"
    const concentrationFactor = moistureRatio < 1
        ? 1 + (1 - moistureRatio) * 0.5  // drying → EC up
        : 1 - (moistureRatio - 1) * 0.2;  // wetting → EC down

    const leaching = (rainfall + irrigationMm) * 2; // rain reduces EC
    const baselinePull = (baseEC - currentEC) * 0.01; // slow return to normal

    return currentEC * concentrationFactor - leaching + baselinePull;
}
```

## 15.5 NPK Model

```javascript
function updateNPK(current, rainfall, irrigationMm, plantUptakeRate, baseValues) {
    const uptake = plantUptakeRate;       // Plants consume nutrients
    const leachFactor = (rainfall + irrigationMm) * 0.3; // Rain washes away
    const mineralization = 0.5;           // Slow release from organic matter
    const baselinePull = (baseValues - current) * 0.005; // Return to baseline

    return current - uptake - leachFactor + mineralization + baselinePull;
}
```

## 15.6 Environment Model

### Diurnal Temperature

```javascript
function getDiurnalTemperature(hour, month) {
    const isRainy = month >= 5 && month <= 10;
    const T_mean = isRainy ? 26 : 30;
    const T_amplitude = isRainy ? 4 : 7; // dry season has wider swing

    // Sinusoidal: peak at 14:00, trough at 05:00
    return T_mean + T_amplitude * Math.sin(2 * Math.PI * (hour - 14) / 24);
}
```

### Solar Radiation

```javascript
function getSolarRadiation(hour) {
    // Sunrise ~05:30, Sunset ~18:00 (DakLak, near equator)
    if (hour < 5.5 || hour > 18) return 0;

    // Bell curve centered at solar noon
    const x = (hour - 12) / 6.25;
    return 900 * Math.exp(-2 * x * x); // W/m²
}
```

### Rainfall Probability

```javascript
function getRainfallProbability(hour, month) {
    const isRainy = month >= 5 && month <= 10;
    if (!isRainy) return 0;

    // Convective rain most likely in afternoon
    if (hour >= 13 && hour <= 18) return 0.25; // 25%
    if (hour >= 10 && hour < 13) return 0.10;  // 10%
    return 0.05;                                // 5%
}
```

---

# Chapter 16: Scenario Engine

## 16.1 What Are Scenarios?

Scenarios are **time-based simulation sequences** that test the system under various conditions. Each scenario has phases that execute in order, with configurable time acceleration.

## 16.2 Available Scenarios

### Drought (10 Days)

Simulates a severe drought over 10 days (compressed to 10 minutes at 1440× speed):

| Phase | Days | Weather | Soil Moisture | Notes |
|-------|------|---------|--------------|-------|
| Begins | 1–2 | 33°C, no rain | 50% | Starting to dry |
| Drying | 3–4 | 35°C, no rain | 40% | EC rising |
| Critical | 5–6 | 37°C, no rain | 30% | Below threshold |
| Severe | 7–8 | 39°C, no rain | 20% | Plants wilting |
| Extreme | 9–10 | 40°C, no rain | 12% | Saline soil |

### Monsoon (5 Days)

Simulates continuous heavy rain:

| Phase | Rainfall | Temperature | Humidity | Notes |
|-------|----------|------------|---------|-------|
| Light rain | 15mm | 25°C | 85% | Rain begins |
| Heavy rain | 45mm | 24°C | 92% | Flooding risk |
| Peak | 60mm | 23°C | 95% | Maximum flood |
| Easing | 10mm | 26°C | 80% | Rain subsides |

### Full Day DakLak

Simulates a complete 24-hour cycle (compressed to 24 seconds):

```
00:00–06:00 Night:  22°C, 85% humidity, no rain
06:00–10:00 Morning: 26°C, 70% humidity — irrigation window
10:00–14:00 Noon:   35°C, 50% humidity — peak ET
14:00–18:00 Afternoon: 30°C, 75% humidity, 25mm rain
18:00–24:00 Evening: 25°C, 80% humidity, 5mm rain
```

### Sensor Fault Sequence

Tests fault detection:

1. **Normal operation** (2 min)
2. **Sensor freeze** (2 min) — values stuck
3. **Sensor drift** (2 min) — values drift after thaw
4. **Garbage data** (2 min) — random bytes
5. **Recovery** (2 min) — sensor resets

## 16.3 Fault Injection

The FaultInjector can simulate:

| Fault | Behavior | Duration |
|-------|----------|----------|
| sensor_stuck | All values freeze at current | Configurable |
| sensor_drift | Values slowly drift from actual | Configurable |
| garbage_data | Random bytes replace data | Configurable |
| gateway_failure | MQTT connection drops | Configurable |

---

# Part V: User Interfaces

---

# Chapter 17: Web Dashboard

## 17.1 Layout

The Smart Control dashboard (localhost:3002) has:

- **Sidebar**: Navigation (Zones, Control, Advisory, Weather, Schedule, System)
- **Main area**: Dynamic content based on selected section
- **Alert toasts**: Real-time notifications (bottom-right)
- **Header**: MQTT status, login/logout

## 17.2 Components

### Sensor Gauges (8 circular gauges)

Each gauge shows one parameter with color-coded thresholds:

```
Temperature:  Green (15–30°C) → Yellow (30–38°C) → Red (>38°C)
Moisture:     Red (<20%) → Yellow (20–35%) → Green (35–65%) → Yellow (65–85%) → Red (>85%)
EC:           Green (<1000) → Yellow (1000–2000) → Red (>2000)
pH:           Yellow (<4.5) → Green (4.5–6.5) → Yellow (>6.5)
```

### Zone Cards

Each zone shows:
- Name and crop type
- Current sensor readings
- Growth stage
- Last update time
- Online/Offline status badge
- Quick action buttons (irrigate, advisory)

### Actuator Control Panel

Shows pump and valve states with toggle buttons:
- Pump 1 (50 L/min) — ON/OFF
- Pump 2 (30 L/min) — ON/OFF
- Valve 1 (Zone A) — OPEN/CLOSED
- Valve 2 (Zone B) — OPEN/CLOSED
- Valve 3 (Zone C) — OPEN/CLOSED

### Advisory Panel

Real-time advice with urgency indicators:
- **Critical** (red): Irrigate NOW
- **Warning** (yellow): Action needed
- **Info** (blue): Status update

### Weather Card

Shows current conditions and 3-day forecast:
- Temperature, humidity, rainfall, wind
- Weather description in Vietnamese
- Forecast for tomorrow and day after

### Historical Charts (Chart.js)

4 chart types:
1. **Moisture + Temperature** (dual-axis line chart)
2. **EC + Salinity** (line chart)
3. **pH** (line chart)
4. **NPK** (grouped bar chart)

---

# Chapter 18: Mobile App

## 18.1 Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Framework | React Native + Expo | SDK 52 |
| Language | TypeScript | 5.x |
| State Management | Zustand | 4.x |
| Server State | React Query | 5.x |
| Navigation | React Navigation | 6.x |
| Real-time | Socket.IO Client | 4.x |
| HTTP Client | Axios | 1.x |
| Charts | react-native-gifted-charts | 1.x |
| Notifications | Expo Notifications | — |

## 18.2 Screen Flow

```
LoginScreen
    │ (JWT token stored)
    ▼
AppNavigator (Bottom Tabs)
├── DashboardTab → DashboardScreen
│   └── SensorCard × 8
│   └── WeatherCard
│   └── AdvisoryCard
│
├── ZonesTab → ZonesScreen
│   └── ZoneCard × N
│   └── ZoneMap (optional)
│
├── ControlTab → ControlScreen
│   └── ActuatorCard × 5
│   └── Auto mode toggle
│
├── AdvisoryTab → AdvisoryScreen
│   └── CropStageCard
│   └── PredictiveCard
│   └── FertilizationAdvice
│
└── SettingsTab → SettingsScreen
    └── Profile
    └── Notifications
    └── About
```

## 18.3 State Management (Zustand)

```typescript
// stores/farmStore.ts
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
    controlActuator: (id: string, action: string) => Promise<boolean>;
    updateSensorData: (zoneId: string, data: any) => void;
    updateWeather: (data: WeatherData) => void;
}
```

## 18.4 Real-time Updates

The mobile app connects to Smart Control via Socket.IO:

```typescript
// hooks/useSocket.ts
useEffect(() => {
    const socket = io(API_URL);

    socket.on('zone_sensor', ({ zoneId, data }) => {
        farmStore.getState().updateSensorData(zoneId, data);
    });

    socket.on('weather_update', (data) => {
        farmStore.getState().updateWeather(data);
    });

    socket.on('advisory', ({ zoneId, ...advisory }) => {
        farmStore.getState().updateAdvisory(zoneId, advisory);
    });

    socket.on('actuator_update', (data) => {
        farmStore.getState().updateActuator(data.id, data);
    });

    return () => socket.disconnect();
}, []);
```

## 18.5 Build & Deploy

```bash
# Development
npx expo start

# Android APK
eas build --platform android --profile development

# Production
eas build --platform android --profile production
eas build --platform ios --profile production

# Submit to stores
eas submit --platform android  # Google Play
eas submit --platform ios      # App Store
```

---

# Part VI: Operations & Security

---

# Chapter 19: Authentication & Authorization

## 19.1 JWT Authentication

```javascript
// Login flow
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = USERS.find(u => u.username === username);

    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
        { username: user.username, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
    );

    res.json({ token, user: { username, role }, expiresIn: '24h' });
});
```

## 19.2 Role-Based Access Control

| Role | Permissions | Default Password |
|------|-----------|-----------------|
| admin | Full access: CRUD, control, config | admin123 |
| operator | Control + Read: can irrigate, view data | operator123 |
| viewer | Read only: dashboard, advisory | viewer123 |

## 19.3 Middleware Chain

```javascript
// Apply rate limiting to all /api routes
app.use('/api', apiLimiter);

// Apply auth to all /api except health and login
app.use('/api', (req, res, next) => {
    if (req.path === '/health' || req.path === '/auth/login') {
        return next();
    }
    authenticateTokenMiddleware(req, res, next);
});

// Control endpoints require admin or operator
app.post('/api/control', controlLimiter, authorizeMiddleware('admin', 'operator'), ...);
```

## 19.4 Rate Limiting

| Endpoint | Limit | Window | Purpose |
|----------|-------|--------|---------|
| /api/auth/login | 10 | 15 min | Prevent brute force |
| /api/* (general) | 120 | 1 min | General API protection |
| /api/control | 30 | 1 min | Limit actuator spam |
| /api/export/* | 10 | 1 min | Prevent data dumps |

Implementation uses in-memory sliding window:

```javascript
class RateLimiter {
    constructor(windowMs, maxRequests) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.requests = new Map();
    }

    middleware(req, res, next) {
        const key = req.ip;
        const now = Date.now();
        const windowStart = now - this.windowMs;

        // Clean old entries
        const hits = (this.requests.get(key) || []).filter(t => t > windowStart);
        this.requests.set(key, hits);

        if (hits.length >= this.maxRequests) {
            return res.status(429).json({ error: 'Too many requests' });
        }

        hits.push(now);
        next();
    }
}
```

---

# Chapter 20: Audit & Alert Systems

## 20.1 Audit Log

Every control action is logged with full context:

```javascript
function logAction({ action, actuatorId, source, userId, previousState, newState, detail }) {
    const entry = {
        id: `audit-${Date.now()}-${random}`,
        timestamp: new Date().toISOString(),
        userId,
        action,
        actuatorId,
        source,       // 'manual' | 'auto' | 'api' | 'auto-rain-pause'
        previousState,
        newState,
        detail
    };

    auditEntries.unshift(entry);
    appendToFile(entry); // Persist to logs/audit.log
}
```

**Log format** (JSONL):
```json
{"id":"audit-1721123456-abc123","timestamp":"2026-07-16T10:30:00Z","userId":"admin","action":"valve_open","actuatorId":"valve-1","source":"manual","previousState":"closed","newState":"open"}
```

## 20.2 Alert System

| Rule | Severity | Condition | Message |
|------|----------|-----------|---------|
| moisture-critical | critical | moisture < 20% | "URGENT: Soil moisture dangerously low!" |
| moisture-warning | warning | 20% ≤ moisture < 30% | "Soil moisture low, irrigate soon" |
| ec-critical | critical | ec > 3000 | "SALINE: EC too high, leach immediately" |
| ph-warning-low | warning | ph < 4.0 | "Soil too acidic, apply lime" |
| ph-warning-high | warning | ph > 8.0 | "Soil too alkaline, apply sulfur" |
| temperature-critical | critical | temp > 40°C | "Heat stress! Apply mulch, irrigate" |

**Cooldown**: 15 minutes between repeated alerts for the same rule + zone.

---

# Chapter 21: Monitoring & Observability

## 21.1 Prometheus Metrics

Smart Control exposes a `/metrics` endpoint in Prometheus format:

```
# HELP smartfarm_mqtt_connected MQTT connection status
# TYPE smartfarm_mqtt_connected gauge
smartfarm_mqtt_connected 1

# HELP smartfarm_zone_moisture Current soil moisture by zone
# TYPE smartfarm_zone_moisture gauge
smartfarm_zone_moisture{zone="zone-A"} 55.0
smartfarm_zone_moisture{zone="zone-B"} 52.3
smartfarm_zone_moisture{zone="zone-C"} 58.1

# HELP smartfarm_irrigation_total Total irrigation events
# TYPE smartfarm_irrigation_total counter
smartfarm_irrigation_total{zone="zone-A",source="auto"} 47
smartfarm_irrigation_total{zone="zone-B",source="manual"} 12
```

## 21.2 System Health Endpoint

```json
// GET /api/system
{
    "uptime": { "seconds": 86400, "formatted": "1d 0h 0m 0s" },
    "memory": { "rss": "45.2 MB", "heapUsed": "28.1 MB", "heapTotal": "36.8 MB" },
    "mqtt": { "connected": true },
    "influxdb": { "connected": true },
    "zones": {
        "active": 3,
        "lastIrrigations": {
            "zone-A": "2026-07-16T05:30:00Z",
            "zone-B": "2026-07-15T16:45:00Z",
            "zone-C": "2026-07-16T06:00:00Z"
        }
    },
    "alerts": { "total": 3, "critical": 0, "warning": 2, "unacknowledged": 2 }
}
```

## 21.3 Structured Logging

Smart Control uses a custom logger with levels:

```javascript
// logger.js
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level, category, message, data) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        category,  // 'mqtt', 'api', 'irrigation', 'weather', etc.
        message,
        ...data
    };
    console.log(JSON.stringify(entry));
}

logger.info('startup', 'SmartFarm started', { port: 3002, zones: 3 });
logger.warn('mqtt', 'Disconnected, reconnecting...');
logger.error('express', 'Unhandled error', { error: err.message });
```

---

# Part VII: Deployment & Troubleshooting

---

# Chapter 22: Production Deployment

## 22.1 Pre-Deployment Checklist

### Server
- [ ] Docker installed (20.10+)
- [ ] Docker Compose v2 installed
- [ ] Node.js 18+ installed
- [ ] All default passwords changed in `.env`
- [ ] InfluxDB token regenerated
- [ ] ChirpStack JWT secret regenerated
- [ ] MQTT authentication enabled
- [ ] Firewall configured

### Gateway
- [ ] Antenna attached BEFORE power on
- [ ] Ethernet connected to same network as server
- [ ] Packet forwarder configured (correct server IP)
- [ ] Gateway shows "Connected" in ChirpStack

### Node + Sensor
- [ ] Sensor wiring verified (A↔A, B↔B)
- [ ] Sensor Modbus response verified
- [ ] Node firmware flashed / AT commands configured
- [ ] Node frequency set to AS923 (923.2 MHz)
- [ ] Node OTAA credentials match ChirpStack

### Field
- [ ] Sensor probe fully inserted in soil
- [ ] Cable protected (conduit or overhead)
- [ ] Solar panel oriented south
- [ ] Gateway antenna ≥3m height
- [ ] Communication range tested

## 22.2 Docker Compose Deployment

```bash
# 1. Clone
git clone https://github.com/dinhhieudl/smartfarm-daklak.git
cd smartfarm-daklak

# 2. Configure environment
cp .env.example .env
nano .env  # Change passwords!

# 3. Start server stack
cd server
docker compose up -d

# 4. Wait for services
sleep 30

# 5. Verify all containers running
docker compose ps

# 6. Configure ChirpStack
# - Open http://localhost:8080
# - Change admin password
# - Create Device Profile
# - Create Application + Devices

# 7. Import Node-RED flow
# - Open http://localhost:1880
# - Import config/node-red-flows.json
# - Configure InfluxDB connection
# - Deploy

# 8. Import Grafana dashboard
# - Open http://localhost:3000
# - Add InfluxDB data source
# - Import config/grafana/dashboards/soil-monitoring.json

# 9. Start Simulator
cd ../simulator
npm install && npm start

# 10. Start Smart Control
cd ../smart-control
npm install && npm start

# 11. Test
# Open http://localhost:3001 (Simulator)
# Open http://localhost:3002 (Smart Control)
# Open http://localhost:3000 (Grafana)
```

## 22.3 Firewall Rules

```bash
# Ubuntu/Debian
sudo ufw allow 1883/tcp   # MQTT
sudo ufw allow 8080/tcp   # ChirpStack
sudo ufw allow 1880/tcp   # Node-RED
sudo ufw allow 3000/tcp   # Grafana
sudo ufw allow 3002/tcp   # Smart Control
sudo ufw allow 8086/tcp   # InfluxDB
sudo ufw allow 1700/udp   # LoRa packet forwarder
```

## 22.4 Reverse Proxy (Nginx)

For production with HTTPS:

```nginx
server {
    listen 443 ssl;
    server_name smartfarm.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/smartfarm.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/smartfarm.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

# Chapter 23: Troubleshooting Guide

## 23.1 Common Issues

| Problem | Possible Cause | Solution |
|---------|---------------|----------|
| Gateway shows "Disconnected" | Firewall blocking UDP 1700 | `sudo ufw allow 1700/udp` |
| Node won't join (OTAA) | Wrong AppKey/DevEUI | Verify credentials match ChirpStack |
| No data in MQTT | Node frequency mismatch | Set node to AS923 (923.2 MHz) |
| Sensor returns all zeros | Wrong Modbus address | Use ModScan32 to test, verify addr=0x02 |
| Sensor timeout | Wrong baud rate | Default is 9600, verify node UART config |
| Data values wrong | Byte order mismatch | Check big-endian vs little-endian in decoder |
| Grafana shows no data | InfluxDB token wrong | Regenerate token, update Node-RED config |
| Smart Control can't connect to MQTT | Mosquitto not running | `docker logs sf-mosquitto` |
| LoRa range too short | Antenna issue | Use 915MHz antenna, mount ≥3m high, LOS |
| Auto-irrigation not triggering | Disabled in rules | Check `irrigationRules[zone].enabled` |
| Weather shows "simulated" | No internet / API down | Check Open-Meteo API availability |
| Mobile app can't connect | Wrong API URL | Check `EXPO_PUBLIC_API_URL` in `.env` |

## 23.2 Diagnostic Commands

```bash
# Check all containers
docker compose ps

# Check specific service logs
docker logs sf-chirpstack --tail 50
docker logs sf-mosquitto --tail 50
docker logs sf-smart-control --tail 50

# Test MQTT connectivity
mosquitto_sub -h localhost -t "application/#" -v

# Test InfluxDB
docker exec sf-influxdb influx query \
  'from(bucket:"soil_data") |> range(start:-1h) |> last()' \
  --org smarfarm --token <token>

# Test ChirpStack API
curl -s http://localhost:8080/api/devices | jq .

# Check gateway status
curl -s http://localhost:8080/api/gateways | jq '.result[0].lastSeenAt'

# Test Smart Control health
curl -s http://localhost:3002/api/health | jq .

# Check Node-RED logs
docker logs sf-nodered --tail 20
```

## 23.3 Performance Tuning

### InfluxDB

```bash
# Check disk usage
docker exec sf-influxdb du -sh /var/lib/influxdb2

# Compact database
docker exec sf-influxdb influx compact

# Check write performance
docker exec sf-influxdb influx query 'from(bucket:"soil_data") |> range(start:-1h) |> count()'
```

### MQTT

```bash
# Check connection count
mosquitto_sub -h localhost -t '$SYS/clients/connected' -C 1

# Check message rate
mosquitto_sub -h localhost -t '$SYS/messages/received' -C 1
```

### Smart Control Memory

```bash
# Check Node.js memory
curl -s http://localhost:3002/api/system | jq '.memory'
```

---

# Part VIII: Advanced Topics

---

# Chapter 24: The LoRa DTU Compatibility Problem

## 24.1 The Issue

This is the **single most important technical issue** in the project's hardware layer.

```
┌─────────────┐                          ┌─────────────┐
│  E90-DTU    │  LoRa raw (transparent)  │  E870       │
│  900SL22    │ ──────────────────────▶  │  L915LG12   │
│             │                          │             │
│  NOT LoRaWAN│  ❌ INCOMPATIBLE         │  LoRaWAN    │
│  Protocol   │                          │  Only       │
└─────────────┘                          └─────────────┘
```

**Why they're incompatible:**

- **E90-DTU**: Uses LoRa in "transparent mode" — it sends raw RF packets without any LoRaWAN MAC layer. Think of it as a walkie-talkie — it just sends raw bytes over radio.

- **E870-L915LG12**: Uses SX1302 chipset which is a LoRaWAN concentrator — it can only demodulate LoRaWAN-compliant frames. It expects proper LoRaWAN headers, MIC (Message Integrity Code), and frame structure.

- **Result**: The E870 physically receives the RF signal, but cannot decode it because the packet format doesn't match LoRaWAN specifications.

## 24.2 Solutions

### Option A: Replace E90-DTU with LoRaWAN Node (Recommended)

| Component | Model | Cost | Difficulty |
|-----------|-------|------|-----------|
| LoRaWAN Node | RAK3172 | ~$15 | Easy (AT commands) |
| Alternative | STM32WL | ~$8 | Medium (needs firmware) |
| Alternative | SenseCAP S2100 | ~$35 | Easy (pre-built) |

**RAK3172 advantages:**
- Full LoRaWAN 1.0.3 compliance
- AT command set (no firmware coding needed)
- Built-in RS485 interface
- OTAA join support
- Excellent documentation

### Option B: Replace E870 with Raw LoRa Gateway

| Component | Model | Cost | Difficulty |
|-----------|-------|------|-----------|
| Gateway | RAK7248 | ~$80 | Medium |
| DIY | Raspberry Pi + SX1276 | ~$50 | Hard |

### Option C: Add MCU Bridge

Place an MCU (STM32 + LoRa module) between the sensor and gateway to convert transparent LoRa to LoRaWAN frames.

**Recommendation**: Option A — it's the cheapest, easiest, and most maintainable.

---

# Chapter 25: Data Export & Analytics

## 25.1 Sensor Data Export

```bash
# Export as JSON
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3002/api/export/sensors?format=json&hours=24"

# Export as CSV
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3002/api/export/sensors?format=csv&hours=168" \
  -o sensors-export.csv

# Export with date filter
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3002/api/export/sensors?format=csv&from=2026-07-01&to=2026-07-16"
```

## 25.2 Audit Log Export

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3002/api/export/audit?format=csv&limit=5000" \
  -o audit-export.csv
```

## 25.3 CSV Format

```csv
timestamp,zoneId,temperature,moisture,ec,salinity,nitrogen,phosphorus,potassium,ph
2026-07-16T10:30:00Z,zone-A,27.5,55.0,450,220,120,35,180,5.8
2026-07-16T10:30:00Z,zone-B,28.1,52.3,480,240,115,32,175,5.9
```

---

# Chapter 26: API Complete Reference

## 26.1 Authentication

### POST /api/auth/login

```json
// Request
{ "username": "admin", "password": "admin123" }

// Response 200
{
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "username": "admin", "role": "admin" },
    "expiresIn": "24h"
}

// Response 401
{ "error": "Invalid credentials", "code": "INVALID_CREDENTIALS" }
```

### GET /api/auth/me

```json
// Headers: Authorization: Bearer <token>
// Response 200
{ "username": "admin", "role": "admin" }
```

## 26.2 Zones

### GET /api/zones

```json
// Response 200
[
    {
        "id": "zone-A",
        "name": "Khu A",
        "area": 3000,
        "crop": "robusta",
        "plantDate": "2024-03-15",
        "soilType": "bazan-red",
        "sensor": {
            "temperature": 27.5,
            "moisture": 55.0,
            "ec": 450,
            "salinity": 220,
            "nitrogen": 120,
            "phosphorus": 35,
            "potassium": 180,
            "ph": 5.8,
            "lastUpdate": "2026-07-16T10:30:00Z"
        },
        "rule": {
            "enabled": true,
            "moistureMin": 35,
            "moistureMax": 65,
            "maxDurationMin": 30,
            "cooldownMin": 120
        },
        "stage": {
            "id": "fruit-growth",
            "name": "Phát triển quả",
            "months": [5, 6, 7, 8]
        },
        "plantAge": { "months": 28, "years": 2 }
    }
]
```

## 26.3 Control

### POST /api/control

```json
// Headers: Authorization: Bearer <token> (admin/operator only)
// Request
{ "actuatorId": "valve-1", "action": "open" }

// Valid actions: "on", "off", "open", "close"
// Response 200
{
    "success": true,
    "actuator": {
        "id": "valve-1",
        "name": "Van khu A",
        "type": "valve",
        "state": "open",
        "lastChange": "2026-07-16T10:35:00Z"
    }
}
```

## 26.4 Advisory

### GET /api/advisory/:zoneId

```json
// Response 200
{
    "zoneId": "zone-A",
    "advices": [
        {
            "type": "irrigation",
            "icon": "✅",
            "message": "Độ ẩm đất ổn định (55.0%). Duy trì tưới 1-2 lần/tuần",
            "action": "Tươi duy trì, mùa mưa có thể giảm tưới"
        },
        {
            "type": "fertilization",
            "icon": "🌿",
            "message": "Dinh dưỡng đầy đủ cho giai đoạn Phát triển quả",
            "action": "Bón Kali (K) cao để quả to, chất lượng tốt. NPK 10-5-20."
        }
    ],
    "urgency": "info",
    "stage": { "id": "fruit-growth", "name": "Phát triển quả" }
}
```

## 26.5 Weather

### GET /api/weather

```json
// Response 200
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
    "lastUpdate": "2026-07-16T10:30:00Z",
    "source": "open-meteo"
}
```

## 26.6 Predictive Irrigation

### GET /api/predictive/:zoneId

```json
// Response 200
{
    "zoneId": "zone-A",
    "urgency": "soon",
    "reason": "Còn ~2.5 ngày trước khi cần tưới (ET₀=4.2mm/ngày)",
    "rainDelay": false,
    "recommendedAction": {
        "action": "monitor",
        "zone": "zone-A",
        "estimatedDays": 2.5
    },
    "metrics": {
        "ET0": 4.2,
        "Kc": 1.05,
        "ETc": 4.41,
        "currentMoisture": 55.0,
        "predictedMoisture24h": 52.3,
        "daysToWilting": 8.7,
        "daysToIrrigation": 2.5
    }
}
```

## 26.7 Schedule

### GET /api/schedule

```json
// Response 200
{
    "date": "2026-07-16",
    "generatedAt": "2026-07-16T10:30:00Z",
    "window": {
        "start": 5, "end": 7,
        "label": "Sáng sớm (5-7h)",
        "efficiency": 0.95,
        "status": "scheduled",
        "minutesUntil": 420
    },
    "zones": [
        {
            "zoneId": "zone-C",
            "priority": 1.85,
            "scheduled": true,
            "scheduledTime": {
                "start": "2026-07-16T05:00:00Z",
                "end": "2026-07-16T05:20:00Z",
                "durationMin": 20
            },
            "estimatedVolumeLiters": 600
        }
    ],
    "summary": {
        "totalZones": 3,
        "zonesToIrrigate": 1,
        "totalVolumeLiters": 600,
        "totalDurationMin": 20
    }
}
```

---

# Chapter 27: Future Roadmap

## 27.1 Near-Term (1-3 months)

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| High | Replace E90-DTU with RAK3172 | 1 week | Enables real hardware |
| High | HTTPS with Let's Encrypt | 2 days | Production security |
| High | Email/SMS/Zalo notifications | 1 week | Farmer awareness |
| Medium | User management CRUD | 3 days | Multi-user support |
| Medium | InfluxDB integration testing | 3 days | Data reliability |

## 27.2 Medium-Term (3-6 months)

| Task | Description |
|------|------------|
| Historical analytics | Long-term trend analysis, yield correlation |
| Crop calendar integration | Vietnamese lunar calendar for planting schedules |
| Multi-farm support | Farm → Zone → Device hierarchy |
| Yield prediction | Machine learning based on sensor history |

## 27.3 Long-Term (6-12 months)

| Task | Description |
|------|------------|
| AI advisory | Beyond rule-based, using LLM for complex recommendations |
| Government integration | Connect to agricultural databases |
| Edge computing | Process data on gateway for offline operation |
| Marketplace | Connect farmers with buyers based on predicted yield |

---

# Appendices

---

# Appendix A: Configuration Files Reference

## zones.json

```json
[
    {
        "id": "zone-A",
        "name": "Khu A",
        "area": 3000,
        "crop": "robusta",
        "plantDate": "2024-03-15",
        "soilType": "bazan-red",
        "pumpId": "pump-1",
        "valveId": "valve-1",
        "moistureSensor": "aabbccdd11223344",
        "location": { "lat": 12.753, "lng": 108.048 }
    }
]
```

## actuators.json

```json
{
    "pump-1": { "id": "pump-1", "name": "Bơm chính #1", "type": "pump",
                "state": "off", "autoMode": false, "lastChange": null, "flowRate": 50 },
    "pump-2": { "id": "pump-2", "name": "Bơm chính #2", "type": "pump",
                "state": "off", "autoMode": false, "lastChange": null, "flowRate": 30 },
    "valve-1": { "id": "valve-1", "name": "Van khu A", "type": "valve",
                 "state": "closed", "autoMode": false, "lastChange": null, "zone": "zone-A" },
    "valve-2": { "id": "valve-2", "name": "Van khu B", "type": "valve",
                 "state": "closed", "autoMode": false, "lastChange": null, "zone": "zone-B" },
    "valve-3": { "id": "valve-3", "name": "Van khu C", "type": "valve",
                 "state": "closed", "autoMode": false, "lastChange": null, "zone": "zone-C" }
}
```

## irrigation-rules.json

```json
{
    "zone-A": {
        "enabled": true,
        "moistureMin": 35,
        "moistureMax": 65,
        "maxDurationMin": 30,
        "cooldownMin": 120,
        "rainPause": true,
        "rainThreshold": 5,
        "lastIrrigation": null
    },
    "zone-B": {
        "enabled": true,
        "moistureMin": 35,
        "moistureMax": 65,
        "maxDurationMin": 25,
        "cooldownMin": 120,
        "rainPause": true,
        "rainThreshold": 5,
        "lastIrrigation": null
    },
    "zone-C": {
        "enabled": true,
        "moistureMin": 40,
        "moistureMax": 70,
        "maxDurationMin": 20,
        "cooldownMin": 90,
        "rainPause": true,
        "rainThreshold": 5,
        "lastIrrigation": null
    }
}
```

---

# Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **LoRaWAN** | Long Range Wide Area Network — LPWAN protocol for IoT |
| **OTAA** | Over-The-Air Activation — secure device join method |
| **ABP** | Activation By Personalization — pre-configured join |
| **ADR** | Adaptive Data Rate — optimizes spreading factor |
| **SF** | Spreading Factor — LoRa modulation parameter (SF7–SF12) |
| **RSSI** | Received Signal Strength Indicator (dBm) |
| **SNR** | Signal-to-Noise Ratio (dB) |
| **Modbus RTU** | Industrial serial communication protocol |
| **RS485** | Differential serial communication standard |
| **MQTT** | Message Queuing Telemetry Transport |
| **ET₀** | Reference Evapotranspiration (FAO standard) |
| **ETc** | Crop Evapotranspiration = ET₀ × Kc |
| **Kc** | Crop Coefficient — water demand factor |
| **VWC** | Volumetric Water Content (%) |
| **EC** | Electrical Conductivity (µS/cm) |
| **NPK** | Nitrogen, Phosphorus, Potassium |
| **OTAA** | Over-The-Air Activation |
| **JWT** | JSON Web Token |
| **Socket.IO** | Real-time bidirectional communication |
| **Digital Twin** | Virtual replica of a physical system |

---

# Appendix C: ChirpStack API Quick Reference

```bash
# List devices
curl -H "Authorization: Bearer <jwt>" http://localhost:8080/api/devices

# Get device status
curl -H "Authorization: Bearer <jwt>" http://localhost:8080/api/devices/{devEUI}

# List gateways
curl -H "Authorization: Bearer <jwt>" http://localhost:8080/api/gateways

# Get gateway stats
curl -H "Authorization: Bearer <jwt>" http://localhost:8080/api/gateways/{gatewayID}/stats

# List applications
curl -H "Authorization: Bearer <jwt>" http://localhost:8080/api/applications
```

---

# Appendix D: Development Setup

```bash
# Clone both repos
git clone https://github.com/dinhhieudl/smartfarm-daklak.git
git clone https://github.com/dinhhieudl/smartfarm-mobile.git

# Smart Control
cd smartfarm-daklak/smart-control
npm install
npm test          # Run 100 tests
npm start         # Start on port 3002

# Simulator
cd ../simulator
npm install
npm test          # Run 28 tests
npm start         # Start on port 3001

# Mobile App
cd ../../smartfarm-mobile
npm install
npx expo start    # Start Expo dev server

# Run tests
npm test                    # All tests
npx tsc --noEmit           # TypeScript check
```

---

# Appendix E: Environment Variables

```bash
# Smart Control (.env)
MQTT_URL=mqtt://localhost:1883
PORT=3002
NODE_ENV=production
JWT_SECRET=<random-64-hex>
ADMIN_PASSWORD=<secure-password>
OPERATOR_PASSWORD=<secure-password>
VIEWER_PASSWORD=<secure-password>
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=<influxdb-token>
INFLUXDB_ORG=smarfarm
INFLUXDB_BUCKET=soil_data

# Simulator (.env)
MQTT_URL=mqtt://localhost:1883
PORT=3001

# Mobile App (.env)
EXPO_PUBLIC_API_URL=http://<server-ip>:3002
```

---

---

# Part IX: Deep Technical References

---

# Chapter 28: LoRaWAN Protocol Deep Dive

## 28.1 LoRa Modulation

LoRa (Long Range) uses **Chirp Spread Spectrum (CSS)** modulation. A "chirp" is a signal whose frequency increases (up-chirp) or decreases (down-chirp) linearly over time.

### Spreading Factor (SF)

The Spreading Factor determines how many chirps represent one bit:

| SF | Chirps/Bit | Duration/bit (125kHz) | Sensitivity | Range | Data Rate |
|----|-----------|----------------------|-------------|-------|-----------|
| SF7 | 128 | 1.024 ms | -123 dBm | Short | 5.47 kbps |
| SF8 | 256 | 2.048 ms | -126 dBm | Medium | 3.13 kbps |
| SF9 | 512 | 4.096 ms | -129 dBm | Medium | 1.76 kbps |
| SF10 | 1024 | 8.192 ms | -132 dBm | Long | 0.98 kbps |
| SF11 | 2048 | 16.384 ms | -134.5 dBm | Very Long | 0.54 kbps |
| SF12 | 4096 | 32.768 ms | -137 dBm | Maximum | 0.29 kbps |

**SmartFarm uses SF10 (DR2)** — a good balance between range and data rate for agricultural sensors.

### Bandwidth

LoRa bandwidth determines the frequency range used:
- **125 kHz**: Standard, longest range
- **250 kHz**: Higher data rate, shorter range
- **500 kHz**: Highest data rate, shortest range

SmartFarm uses **125 kHz** for maximum range in open field conditions.

### Coding Rate

Forward Error Correction (FRC) adds redundancy:
- **4/5**: 20% overhead (default)
- **4/6**: 33% overhead
- **4/7**: 43% overhead
- **4/8**: 56% overhead (most robust)

SmartFarm uses **4/5** for normal operation.

## 28.2 LoRaWAN MAC Layer

The LoRaWAN MAC layer adds:

### Frame Structure

```
┌──────────────────────────────────────────────────────────────┐
│ MHDR (1 byte)                                                │
│ ├─ MType (3 bits): Message Type                              │
│ │   000 = Join Request                                       │
│ │   001 = Join Accept                                        │
│ │   010 = Unconfirmed Data Up                                │
│ │   011 = Unconfirmed Data Down                              │
│ │   100 = Confirmed Data Up                                  │
│ │   101 = Confirmed Data Down                                │
│ │   110 = RFU                                                │
│ │   111 = Proprietary                                        │
│ ├─ RFU (3 bits)                                              │
│ └─ Maj (2 bits): Major Version                               │
├──────────────────────────────────────────────────────────────┤
│ FHDR (7 bytes)                                               │
│ ├─ DevAddr (4 bytes): Device Address                         │
│ ├─ FCtrl (1 byte): Frame Control                             │
│ │   ├─ ADR: Adaptive Data Rate                               │
│ │   ├─ ACK: Acknowledgment                                   │
│ │   └─ FPending: More data pending                           │
│ ├─ FCnt (2 bytes): Frame Counter                             │
│ └─ FOpts (0-15 bytes): MAC Commands                          │
├──────────────────────────────────────────────────────────────┤
│ FPort (1 byte, optional)                                     │
│ ├─ 0: MAC commands only                                      │
│ └─ 1-223: Application data                                   │
├──────────────────────────────────────────────────────────────┤
│ FRMPayload (0-N bytes, encrypted)                            │
│ └─ AES-128 encrypted application data                        │
├──────────────────────────────────────────────────────────────┤
│ MIC (4 bytes)                                                │
│ └─ Message Integrity Code (CMAC)                             │
└──────────────────────────────────────────────────────────────┘
```

### Join Process (OTAA)

```
Device                          Network Server
  │                                    │
  │  JoinRequest                       │
  │  (DevEUI, AppEUI, DevNonce)        │
  │  ────────────────────────────────▶ │
  │                                    │
  │  ┌─────── Validate DevEUI ───────┐ │
  │  │ Look up AppKey                │ │
  │  │ Generate session keys         │ │
  │  └──────────────────────────────┘ │
  │                                    │
  │  JoinAccept                        │
  │  (AppNonce, NetID, DevAddr,        │
  │   DLSettings, RxDelay)             │
  │  ◀──────────────────────────────── │
  │                                    │
  │  ┌─────── Derive Session Keys ───┐ │
  │  │ NwkSKey = aes128(AppKey,      │ │
  │  │   0x01 | AppNonce | NetID      │ │
  │  │   | DevNonce | pad)            │ │
  │  │ AppSKey = aes128(AppKey,       │ │
  │  │   0x02 | AppNonce | NetID      │ │
  │  │   | DevNonce | pad)            │ │
  │  └──────────────────────────────┘ │
  │                                    │
  │  Device is now joined!             │
```

### Adaptive Data Rate (ADR)

ADR dynamically adjusts SF and TX power based on link quality:

```
Signal Quality Decision:
  RSSI > -100 dBm AND SNR > 7 dB → Decrease SF (faster, less power)
  RSSI < -120 dBm OR SNR < 0 dB → Increase SF (slower, more range)

Example progression:
  SF10 → SF9 → SF8 → SF7 (good signal, optimizing for speed)
  SF10 → SF11 → SF12 (poor signal, maximizing range)
```

## 28.3 Frequency Plan (AS923)

Vietnam uses AS923 frequency plan:

| Channel | Uplink (MHz) | Downlink (MHz) |
|---------|-------------|----------------|
| 0 | 923.20 | 923.20 |
| 1 | 923.40 | 923.40 |
| 2 | 923.60 | 923.60 |
| 3 | 923.80 | 923.80 |
| 4 | 924.00 | 924.00 |
| 5 | 924.20 | 924.20 |
| 6 | 924.40 | 924.40 |
| 7 | 924.60 | 924.60 |

**Duty Cycle**: 1% per channel (AS923). This means a device can transmit for 1 second out of every 100 seconds per channel. With 8 channels, effective duty cycle is 8%.

**Maximum EIRP**: 16 dBm (40 mW) for AS923.

---

# Chapter 29: Modbus Protocol Details

## 29.1 Modbus RTU Frame Format

Modbus RTU (Remote Terminal Unit) uses binary encoding over serial:

### Request Frame (Master → Slave)

```
┌──────────┬──────────┬──────────────┬──────────┬──────────┬──────────┐
│ Address  │ Function │ Data         │ CRC      │ CRC      │          │
│ (1 byte) │ (1 byte) │ (N bytes)    │ Low      │ High     │          │
└──────────┴──────────┴──────────────┴──────────┴──────────┴──────────┘
```

### Response Frame (Slave → Master)

```
┌──────────┬──────────┬──────────────┬──────────┬──────────┐
│ Address  │ Function │ Byte Count   │ Data     │ CRC      │
│ (1 byte) │ (1 byte) │ (1 byte)     │ (N bytes)│ (2 bytes)│
└──────────┴──────────┴──────────────┴──────────┴──────────┘
```

## 29.2 Modbus Functions Used

### Function 0x03 — Read Holding Registers

```
Request:
  Slave Address: 0x02
  Function Code: 0x03
  Starting Register: 0x0000 (2 bytes)
  Number of Registers: 0x0008 (2 bytes)
  CRC16: auto-calculated

Full hex: 02 03 00 00 00 08 44 0C

Response:
  Slave Address: 0x02
  Function Code: 0x03
  Byte Count: 0x10 (16 bytes)
  Register 0 (Temp): 0x0113 → 275 → 27.5°C
  Register 1 (Moist): 0x0226 → 550 → 55.0%
  Register 2 (EC): 0x01C2 → 450
  Register 3 (Sal): 0x00DC → 220
  Register 4 (N): 0x0078 → 120
  Register 5 (P): 0x0023 → 35
  Register 6 (K): 0x00B4 → 180
  Register 7 (pH): 0x003A → 58 → 5.8
  CRC16: auto-calculated
```

### Function 0x10 — Write Multiple Registers

**Change device address (0x02 → 0x01):**
```
Request: 02 10 00 80 00 01 02 00 01 75 C0
         │  │  │        │     │     └─ CRC
         │  │  │        │     └─ New address: 0x0001
         │  │  │        └─ Count: 1 register
         │  │  └─ Register: 0x0080 (address config)
         │  └─ Function: 0x10 (Write Multiple)
         └─ Current address: 0x02
```

**Change baud rate (9600 → 19200):**
```
Request: 00 10 00 81 00 01 02 19 20 BF 99
         │  │  │        │     │     └─ CRC
         │  │  │        │     └─ Baud: 0x1920 = 6432? No...
         │  │  │        └─ Count: 1
         │  │  └─ Register: 0x0081 (baud rate config)
         │  └─ Function: 0x10
         └─ Broadcast: 0x00
```

**Note**: Use broadcast address 0x00 when original address is unknown (only one sensor on bus).

## 29.3 CRC16 Calculation (Modbus)

```c
// Modbus CRC16 (polynomial 0xA001)
uint16_t modbus_crc16(uint8_t *data, uint8_t length) {
    uint16_t crc = 0xFFFF;
    for (uint8_t i = 0; i < length; i++) {
        crc ^= data[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x0001) {
                crc = (crc >> 1) ^ 0xA001;
            } else {
                crc >>= 1;
            }
        }
    }
    return crc; // Low byte first
}
```

## 29.4 Common Modbus Errors

| Exception Code | Meaning | Cause |
|---------------|---------|-------|
| 0x01 | Illegal Function | Unsupported function code |
| 0x02 | Illegal Data Address | Register doesn't exist |
| 0x03 | Illegal Data Value | Value out of range |
| 0x04 | Slave Device Failure | Internal error |
| 0x06 | NAK | Write rejected |

---

# Chapter 30: Node-RED Configuration Guide

## 30.1 Importing the Flow

1. Open Node-RED at `http://localhost:1880`
2. Click the hamburger menu (top-right) → Import
3. Select "Clipboard" tab
4. Paste the contents of `server/config/node-red-flows.json`
5. Click "Import"
6. Click "Deploy"

## 30.2 Flow Components

### MQTT In Node

```
Server: mosquitto:1883
Topic: application/smartfarm-daklak/device/+/event/up
QoS: 0
Output: parsed JSON object
```

### Function Node: Data Processing

```javascript
// Validate and transform sensor data
var payload = msg.payload;

if (!payload || !payload.object) {
    node.warn("No object in payload");
    return null;
}

var data = payload.object;

// Range validation
var ranges = {
    temperature: [-40, 80],
    moisture: [0, 100],
    ec: [0, 20000],
    salinity: [0, 10000],
    nitrogen: [0, 500],
    phosphorus: [0, 200],
    potassium: [0, 500],
    ph: [0, 14]
};

for (var key in ranges) {
    if (data[key] === undefined || data[key] === null) continue;
    var [min, max] = ranges[key];
    if (data[key] < min || data[key] > max) {
        node.warn("Value out of range: " + key + " = " + data[key]);
        return null;
    }
}

// Build output
msg.payload = {
    temperature: parseFloat(data.temperature) || 0,
    moisture: parseFloat(data.moisture) || 0,
    ec: parseInt(data.ec) || 0,
    salinity: parseInt(data.salinity) || 0,
    nitrogen: parseInt(data.nitrogen) || 0,
    phosphorus: parseInt(data.phosphorus) || 0,
    potassium: parseInt(data.potassium) || 0,
    ph: parseFloat(data.ph) || 0,
    zone: payload.deviceName || "unknown",
    timestamp: payload.time || new Date().toISOString()
};

return msg;
```

### InfluxDB Out Node

```
Server: http://influxdb:8086
Token: smarfarm-token-2026
Organization: smarfarm
Bucket: soil_data
Measurement: sensor_data
Timestamp: msg.payload.timestamp
Tags:
  - zone: msg.payload.zone
Fields:
  - temperature: msg.payload.temperature
  - moisture: msg.payload.moisture
  - ec: msg.payload.ec
  - salinity: msg.payload.salinity
  - nitrogen: msg.payload.nitrogen
  - phosphorus: msg.payload.phosphorus
  - potassium: msg.payload.potassium
  - ph: msg.payload.ph
```

## 30.3 Debug Node

Add a Debug node to see data in the sidebar:

```
Output: complete msg object
To: debug tab
```

This is invaluable for troubleshooting — you can see exactly what data is flowing through the pipeline.

## 30.4 Node-RED Dashboard (Optional)

For a quick dashboard without Grafana, install `node-red-dashboard`:

```bash
cd /data
npm install node-red-dashboard
# Restart Node-RED
```

Add dashboard nodes:
- **Gauge**: Temperature, Moisture
- **Chart**: Time series
- **Text**: Advisory messages
- **Button**: Manual control

---

# Chapter 31: InfluxDB Schema Design

## 31.1 Measurement Design

SmartFarm uses two measurements:

### sensor_data

```
measurement: sensor_data
tags:
  zone: string (zone-A, zone-B, zone-C)
fields:
  temperature: float
  moisture: float
  ec: float
  salinity: float
  nitrogen: float
  phosphorus: float
  potassium: float
  ph: float
timestamp: nanosecond precision
```

### control_event

```
measurement: control_event
tags:
  actuator: string (pump-1, valve-1, etc.)
  source: string (manual, auto, api, auto-rain-pause)
fields:
  action: string (on, off, open, close)
  prevState: string
  newState: string
timestamp: nanosecond precision
```

## 31.2 Retention Policy

For production, configure retention to manage data growth:

```flux
// Keep raw data for 90 days
influx bucket update -n soil_data -r 90d

// Create downsampling task for long-term storage
import "influxdata/influxdb"
option task = {name: "downsample_hourly", every: 1h}

from(bucket: "soil_data")
  |> range(start: -2h)
  |> filter(fn: (r) => r["_measurement"] == "sensor_data")
  |> aggregateWindow(every: 1h, fn: mean)
  |> to(bucket: "soil_data_hourly", org: "smarfarm")
```

## 31.3 Query Optimization

**Use tags for filtering** (tags are indexed):

```flux
// ✅ Good: Filter by tag first
from(bucket: "soil_data")
  |> filter(fn: (r) => r["zone"] == "zone-A")  // Tag filter (fast)
  |> filter(fn: (r) => r["_field"] == "temperature")  // Field filter

// ❌ Bad: Filter by field first
from(bucket: "soil_data")
  |> filter(fn: (r) => r["_field"] == "temperature")  // Field filter (slow)
  |> filter(fn: (r) => r["zone"] == "zone-A")  // Tag filter
```

**Use aggregateWindow for time-based aggregation**:

```flux
// ✅ Good: Aggregate before limit
from(bucket: "soil_data")
  |> range(start: -7d)
  |> filter(fn: (r) => r["_field"] == "moisture")
  |> aggregateWindow(every: 1h, fn: mean)
  |> limit(n: 168)  // 7 days × 24 hours

// ❌ Bad: Limit before aggregate
from(bucket: "soil_data")
  |> range(start: -7d)
  |> filter(fn: (r) => r["_field"] == "moisture")
  |> limit(n: 168)  // Only gets 168 raw points, then aggregates them
  |> aggregateWindow(every: 1h, fn: mean)
```

## 31.4 InfluxDB Capacity Planning

| Data Point | Size (compressed) | Points/Day | Daily Size | Annual Size |
|------------|------------------|------------|-----------|-------------|
| sensor_data | ~50 bytes | 2,880 (per zone) × 3 zones | ~432 KB | ~158 MB |
| control_event | ~80 bytes | ~50 | ~4 KB | ~1.5 MB |
| **Total** | — | — | ~436 KB | ~160 MB |

With compression, actual disk usage is typically 10–20% of raw size.

---

# Chapter 32: Smart Control Module Deep Dive

## 32.1 Weather Module (lib/weather.js)

### Open-Meteo API Integration

```javascript
const DAKLAK_LAT = 12.75;
const DAKLAK_LON = 108.35;
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

async function fetchWeatherFromAPI() {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', DAKLAK_LAT);
    url.searchParams.set('longitude', DAKLAK_LON);
    url.searchParams.set('current', [
        'temperature_2m',
        'relative_humidity_2m',
        'precipitation',
        'wind_speed_10m',
        'cloud_cover'
    ].join(','));
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode');
    url.searchParams.set('forecast_days', '3');
    url.searchParams.set('timezone', 'Asia/Ho_Chi_Minh');

    const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (!response.ok) throw new Error(`API returned ${response.status}`);
    return parseWeatherData(await response.json());
}
```

### Weather Code Mapping

```javascript
const weatherCodes = {
    0: 'Trời quang',           // Clear sky
    1: 'Ít mây',              // Mainly clear
    2: 'Mây rải rác',         // Partly cloudy
    3: 'Nhiều mây',           // Overcast
    45: 'Sương mù',           // Fog
    48: 'Sương mù đóng băng', // Depositing rime fog
    51: 'Mưa phùn nhẹ',       // Light drizzle
    53: 'Mưa phùn',           // Moderate drizzle
    55: 'Mưa phùn nặng',      // Dense drizzle
    61: 'Mưa nhẹ',            // Slight rain
    63: 'Mưa vừa',            // Moderate rain
    65: 'Mưa to',             // Heavy rain
    71: 'Tuyết nhẹ',          // Slight snowfall
    73: 'Tuyết vừa',          // Moderate snowfall
    75: 'Tuyết to',           // Heavy snowfall
    80: 'Mưa rào nhẹ',        // Slight rain showers
    81: 'Mưa rào',            // Moderate rain showers
    82: 'Mưa rào to',         // Violent rain showers
    95: 'Giông bão',          // Thunderstorm
    96: 'Giông bão + mưa đá nhỏ', // Thunderstorm with slight hail
    99: 'Giông bão + mưa đá to'   // Thunderstorm with heavy hail
};
```

## 32.2 Rate Limiter Module (lib/rate-limiter.js)

```javascript
class RateLimiter {
    constructor(windowMs, maxRequests) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.requests = new Map(); // IP → timestamps[]
    }

    middleware(req, res, next) {
        const key = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        const windowStart = now - this.windowMs;

        // Get existing hits, filter to current window
        let hits = this.requests.get(key);
        if (!hits) {
            hits = [];
            this.requests.set(key, hits);
        }

        // Remove old entries
        while (hits.length > 0 && hits[0] <= windowStart) {
            hits.shift();
        }

        // Check limit
        if (hits.length >= this.maxRequests) {
            const retryAfter = Math.ceil((hits[0] + this.windowMs - now) / 1000);
            res.setHeader('Retry-After', retryAfter);
            return res.status(429).json({
                error: 'Too many requests',
                retryAfter,
                limit: this.maxRequests,
                windowMs: this.windowMs
            });
        }

        // Record this request
        hits.push(now);
        next();
    }
}

// Preset limiters
const apiLimiter = new RateLimiter(60 * 1000, 120);      // 120/min
const authLimiter = new RateLimiter(15 * 60 * 1000, 10);  // 10/15min
const controlLimiter = new RateLimiter(60 * 1000, 30);    // 30/min
const exportLimiter = new RateLimiter(60 * 1000, 10);     // 10/min
```

## 32.3 Logger Module (lib/logger.js)

```javascript
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'];

function formatArgs(args) {
    return args.map(a => {
        if (typeof a === 'object') return JSON.stringify(a);
        return String(a);
    }).join(' ');
}

function log(level, category, message, data) {
    if (LEVELS[level] < MIN_LEVEL) return;

    const entry = {
        timestamp: new Date().toISOString(),
        level: level.toUpperCase(),
        category,
        message,
        ...(data || {})
    };

    const output = `[${entry.timestamp}] [${entry.level}] [${category}] ${message}`;
    if (data) console.log(output, JSON.stringify(data));
    else console.log(output);
}

module.exports = {
    debug: (cat, msg, data) => log('debug', cat, msg, data),
    info: (cat, msg, data) => log('info', cat, msg, data),
    warn: (cat, msg, data) => log('warn', cat, msg, data),
    error: (cat, msg, data) => log('error', cat, msg, data),
    middleware: (req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            log('info', 'http', `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        });
        next();
    }
};
```

---

# Chapter 33: Simulator Physics Equations

## 33.1 Diurnal Temperature Model

The temperature follows a sinusoidal pattern with seasonal modulation:

```
T(t) = T_mean + T_amplitude × sin(2π × (t - φ) / 24) + noise

Where:
  T_mean = mean daily temperature
    - Rainy season (May-Oct): 26°C
    - Dry season (Nov-Apr): 30°C
  T_amplitude = temperature range
    - Rainy: ±4°C
    - Dry: ±7°C
  φ = phase shift = 14 (peak at 14:00)
  noise = random cloud effect (±1.5°C dry, ±3°C rainy)
```

## 33.2 Solar Radiation Model

```
Rs(t) = Rs_max × exp(-2 × ((t - t_noon) / σ)²)

Where:
  Rs_max = 900 W/m² (tropical noon)
  t_noon = 12:00 (solar noon)
  σ = day_length / 2 = 6.25 hours
  Day length ≈ 12.5 hours (equatorial region)
```

## 33.3 Reference Evapotranspiration (Simplified)

The Hargreaves-Samani approximation for hourly ET₀:

```
ET₀_hourly = 0.408 × Δ × (Rn - G) + γ × (37 / (T + 273)) × u₂ × (es - ea)
             ─────────────────────────────────────────────────────────────────
                              Δ + γ × (1 + 0.34 × u₂)

Where:
  Δ = slope of saturation vapor pressure curve
    = 4098 × es / (T + 237.3)²
  es = saturation vapor pressure
    = 0.6108 × exp(17.27 × T / (T + 237.3))
  ea = actual vapor pressure = es × RH/100
  γ = psychrometric constant ≈ 0.067 kPa/°C at 500m altitude
  Rn = net radiation ≈ 0.75 × Rs - 2.0
  G = soil heat flux ≈ 0 (hourly)
  u₂ = wind speed at 2m
```

## 33.4 Soil Moisture Water Balance

```
Δθ = (P + I - ET_a - D - R) / Z_r

Where:
  θ = volumetric water content (VWC)
  P = precipitation (mm)
  I = irrigation (mm)
  ET_a = actual evapotranspiration (mm)
  D = deep drainage (mm)
  R = surface runoff (mm)
  Z_r = root zone depth (mm) = 800mm for coffee

Actual ET (reduced by water stress):
  ET_a = ET₀ × Ks × f_temp
  Ks = min(1, (θ - θ_pwp) / (θ_fc - θ_pwp))  // Stress coefficient
  f_temp = min(1.5, max(0.3, T_air / 30))       // Temperature factor

Runoff (when near saturation):
  R = max(0, θ_current + P + I - θ_sat) × Z_r

Deep drainage (above field capacity):
  D = min(θ_current - θ_fc, Ksat × dt × (θ_current / θ_fc))
```

## 33.5 EC Dynamics

```
EC_new = EC_current × C_factor - L_factor + B_factor

Where:
  C_factor = concentration factor
    If θ < θ_normal: 1 + (1 - θ/θ_normal) × 0.5  // Drying → EC up
    If θ ≥ θ_normal: 1 - (θ/θ_normal - 1) × 0.2   // Wetting → EC down
  L_factor = leaching = (P + I) × 2                 // Rain reduces EC
  B_factor = baseline pull = (EC_base - EC_current) × 0.01  // Return to normal
```

## 33.6 NPK Dynamics

```
NPK_new = NPK_current - U - L + M + B

Where:
  U = plant uptake rate (constant per tick)
    N: 0.3 mg/kg/tick, P: 0.1, K: 0.2
  L = leaching = (P + I) × 0.3
  M = mineralization = 0.5 mg/kg/tick (slow release from organic matter)
  B = baseline pull = (NPK_base - NPK_current) × 0.005
```

---

# Chapter 34: Mobile App Component Architecture

## 34.1 Component Hierarchy

```
App.tsx
└── AppNavigator.tsx
    ├── AuthStack
    │   └── LoginScreen.tsx
    │       ├── TextInput (username)
    │       ├── TextInput (password)
    │       └── Button (Login)
    │
    └── MainTabs
        ├── DashboardTab
        │   └── DashboardScreen.tsx
        │       ├── SensorCard.tsx (×8)
        │       │   ├── CircularGauge
        │       │   ├── ValueText
        │       │   └── StatusBadge
        │       ├── WeatherCard.tsx
        │       │   ├── CurrentTemp
        │       │   ├── ForecastRow (×3)
        │       │   └── RainProbability
        │       ├── AdvisoryCard.tsx
        │       │   ├── UrgencyBadge
        │       │   ├── AdviceItem (×N)
        │       │   └── StageInfo
        │       └── StatusBadge.tsx (MQTT)
        │
        ├── ZonesTab
        │   └── ZonesScreen.tsx
        │       ├── ZoneCard.tsx (×N)
        │       │   ├── ZoneName
        │       │   ├── CropType
        │       │   ├── SensorSummary
        │       │   └── LastUpdate
        │       └── ZoneMap.tsx (optional)
        │
        ├── ControlTab
        │   └── ControlScreen.tsx
        │       ├── ActuatorCard.tsx (×5)
        │       │   ├── ActuatorName
        │       │   ├── StateBadge (ON/OFF)
        │       │   └── ToggleButton
        │       └── AutoModeToggle.tsx
        │
        ├── AdvisoryTab
        │   └── AdvisoryScreen.tsx
        │       ├── CropStageCard.tsx
        │       │   ├── StageName
        │       │   ├── Description
        │       │   ├── WaterNeed
        │       │   └── FertilizerAdvice
        │       ├── PredictiveCard.tsx
        │       │   ├── UrgencyIndicator
        │       │   ├── ET0Value
        │       │   ├── DaysToIrrigation
        │       │   └── RainForecast
        │       └── FertilizationAdvice.tsx
        │
        └── SettingsTab
            └── SettingsScreen.tsx
                ├── ProfileSection
                ├── NotificationSettings
                └── AboutSection
```

## 34.2 API Client (src/api/client.ts)

```typescript
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3002';

const client = axios.create({
    baseURL: API_URL,
    timeout: 10000,
    headers: { 'Content-Type': 'application/json' }
});

// Request interceptor: attach JWT
client.interceptors.request.use(async (config) => {
    const token = await AsyncStorage.getItem('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Response interceptor: handle 401
client.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401) {
            await AsyncStorage.removeItem('auth_token');
            // Redirect to login
        }
        return Promise.reject(error);
    }
);

export default client;
```

## 34.3 Socket.IO Hook (src/hooks/useSocket.ts)

```typescript
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useFarmStore } from '../stores/farmStore';
import { API_URL } from '../constants';

export function useSocket() {
    const socketRef = useRef<Socket | null>(null);
    const store = useFarmStore();

    useEffect(() => {
        const socket = io(API_URL, {
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            store.setMqttConnected(true);
        });

        socket.on('disconnect', () => {
            store.setMqttConnected(false);
        });

        socket.on('init', (data) => {
            // Initialize all state
            store.zones = data.zones;
            store.actuators = data.actuators;
            store.weather = data.weather;
        });

        socket.on('zone_sensor', ({ zoneId, data }) => {
            store.updateSensorData(zoneId, data);
        });

        socket.on('actuator_update', (data) => {
            store.updateActuator(data.id, data);
        });

        socket.on('weather_update', (data) => {
            store.updateWeather(data);
        });

        socket.on('advisory', ({ zoneId, ...advisory }) => {
            store.updateAdvisory(zoneId, advisory);
        });

        socket.on('mqtt_status', ({ connected }) => {
            store.setMqttConnected(connected);
        });

        return () => {
            socket.disconnect();
        };
    }, []);

    return socketRef;
}
```

---

# Chapter 35: Security Best Practices

## 35.1 Authentication Security

### Password Hashing

```javascript
const bcrypt = require('bcryptjs');
const SALT_ROUNDS = 10;

// Hash on user creation
const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);

// Verify on login
const isValid = bcrypt.compareSync(inputPassword, storedHash);
```

### JWT Security

```javascript
// Sign with strong secret
const JWT_SECRET = process.env.JWT_SECRET; // 64+ char random hex

// Short expiry
const token = jwt.sign(
    { username, role },
    JWT_SECRET,
    { expiresIn: '24h' }  // Not 7d, not 30d
);

// Verify on every request
function authenticateToken(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });

    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}
```

## 35.2 Network Security

### Firewall Rules

```bash
# Only allow necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (restricted)
sudo ufw allow from 192.168.1.0/24 to any port 22

# MQTT (internal only)
sudo ufw allow from 192.168.1.0/24 to any port 1883

# ChirpStack (internal only)
sudo ufw allow from 192.168.1.0/24 to any port 8080

# Smart Control (with HTTPS)
sudo ufw allow 443/tcp

# LoRa Gateway (UDP)
sudo ufw allow 1700/udp
```

### Docker Security

```yaml
# docker-compose.yml security best practices
services:
  postgres:
    # Don't expose to host in production
    # ports: ["5432:5432"]  # Remove this
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}  # Use .env, not hardcoded

  smart-control:
    read_only: true  # Read-only filesystem
    tmpfs: /tmp      # Writable tmp
    security_opt:
      - no-new-privileges:true
```

## 35.3 Data Security

### Encrypt Sensitive Data

```javascript
// Don't log passwords
logger.info('auth', 'Login attempt', { username });  // ✅
logger.info('auth', 'Login attempt', { username, password });  // ❌

// Don't expose tokens in URLs
// ✅ Header: Authorization: Bearer <token>
// ❌ Query: ?token=<token>

// Sanitize user input
function sanitizeInput(input) {
    if (typeof input !== 'string') return null;
    return input.replace(/[<>]/g, '').trim().slice(0, 1000);
}
```

### Backup Encryption

```bash
# Encrypt backups
gpg --symmetric --cipher-algo AES256 backup.tar.gz
# Decrypt
gpg --decrypt backup.tar.gz.gpg > backup.tar.gz
```

---

# Chapter 36: Performance Optimization

## 36.1 MQTT Optimization

### Connection Pooling

```javascript
// Reuse MQTT connection (don't create new ones)
const mqttClient = mqtt.connect(MQTT_URL, {
    clientId: 'smartfarm-control-' + randomHex(6),
    clean: true,
    connectTimeout: 3000,
    reconnectPeriod: 5000,
    keepalive: 60
});
```

### Message Batching

```javascript
// Instead of writing each point individually
function writeSensorDataBatch(zoneData) {
    const points = zoneData.map(({ zoneId, data }) =>
        new Point('sensor_data')
            .tag('zone', zoneId)
            .floatField('temperature', data.temperature)
            .floatField('moisture', data.moisture)
    );
    writeApi.writePoints(points);  // Batch write
}
```

## 36.2 InfluxDB Optimization

### Use Appropriate Precision

```javascript
// Use seconds instead of nanoseconds for non-critical data
const writeApi = client.getWriteApi(org, bucket, 's');  // Not 'ns'
```

### Batch Writes

```javascript
// Buffer points and flush periodically
writeApi.useDefaultBatch({ flushInterval: 10000 });  // Flush every 10s
```

## 36.3 Node.js Optimization

### Memory Management

```javascript
// Limit in-memory history
const MAX_CONTROL_HISTORY = 200;
const MAX_EVENTS = 200;

if (controlHistory.length > MAX_CONTROL_HISTORY) {
    controlHistory.pop();  // Remove oldest
}
```

### Efficient Loops

```javascript
// ✅ Use forEach for simple iteration
zones.forEach(zone => processZone(zone));

// ✅ Use for...of for async operations
for (const zone of zones) {
    await processZoneAsync(zone);
}

// ❌ Don't use for...in on arrays
for (const i in zones) { /* slow */ }
```

---

# Chapter 37: Backup & Recovery

## 37.1 Backup Strategy

| Data | Method | Frequency | Retention |
|------|--------|-----------|-----------|
| InfluxDB | `influx backup` | Daily | 30 days |
| PostgreSQL | `pg_dump` | Weekly | 4 weeks |
| Node-RED flows | File copy | On change | Last 5 versions |
| Config files | Git | On change | Forever |
| Audit logs | File copy | Daily | 90 days |

## 37.2 Backup Scripts

```bash
#!/bin/bash
# backup.sh - SmartFarm DakLak backup

BACKUP_DIR="/backups/smartfarm/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# 1. InfluxDB backup
docker exec sf-influxdb influx backup /tmp/influx-backup \
    --org smarfarm --token "$INFLUXDB_TOKEN"
docker cp sf-influxdb:/tmp/influx-backup "$BACKUP_DIR/influxdb"

# 2. PostgreSQL backup
docker exec sf-postgres pg_dump -U chirpstack chirpstack > "$BACKUP_DIR/postgres.sql"

# 3. Node-RED flows
docker cp sf-nodered:/data/flows.json "$BACKUP_DIR/nodered-flows.json"

# 4. Config files
cp -r server/config/ "$BACKUP_DIR/config"

# 5. Compress
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

# 6. Cleanup old backups (keep 30 days)
find /backups/smartfarm -name "*.tar.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR.tar.gz"
```

## 37.3 Recovery Procedure

```bash
# 1. Restore InfluxDB
docker cp /backups/smartfarm/20260716/influxdb sf-influxdb:/tmp/restore
docker exec sf-influxdb influx restore /tmp/restore \
    --org smarfarm --token "$INFLUXDB_TOKEN"

# 2. Restore PostgreSQL
docker exec -i sf-postgres psql -U chirpstack chirpstack < postgres.sql

# 3. Restore Node-RED flows
docker cp nodered-flows.json sf-nodered:/data/flows.json
docker restart sf-nodered
```

---

# Chapter 38: Scaling to Multiple Zones

## 38.1 Current Architecture (3 Zones)

```
Gateway 1 (E870) ──┬── Node 1 (zone-A) ── Sensor A
                   ├── Node 2 (zone-B) ── Sensor B
                   └── Node 3 (zone-C) ── Sensor C
```

## 38.2 Scaling to 10+ Zones

### Option A: Single Gateway, More Nodes

```
Gateway 1 (E870) ──┬── Node 1 (zone-A)
                   ├── Node 2 (zone-B)
                   ├── Node 3 (zone-C)
                   ├── ...
                   └── Node 10 (zone-J)
```

**Limitations**:
- SX1302 handles 8 simultaneous channels
- Duty cycle: 1% per channel × 8 = 8% total
- At 5-min interval: 10 nodes × 12 messages/hour = 120 messages/hour (within limits)

### Option B: Multiple Gateways

```
Gateway 1 (E870) ──┬── Node 1-3 (zone-A-C)
Gateway 2 (E870) ──┬── Node 4-6 (zone-D-F)
Gateway 3 (E870) ──┬── Node 7-10 (zone-G-J)
```

**Benefits**:
- Higher capacity
- Better coverage (each gateway covers different area)
- Redundancy

### Option C: Hybrid (Recommended)

```
Gateway 1 (E870, main house) ──┬── Node 1-5 (nearby zones)
                               └── Node 6-10 (medium range)

Gateway 2 (E870, field station) ── Node 11-20 (distant zones)
```

## 38.3 Multi-Zone Configuration

### zones.json (Expanded)

```json
[
    {"id": "zone-A", "name": "Khu A - Robusta", "crop": "robusta",
     "pumpId": "pump-1", "valveId": "valve-1", "moistureSensor": "aabbccdd11223344"},
    {"id": "zone-B", "name": "Khu B - Robusta", "crop": "robusta",
     "pumpId": "pump-1", "valveId": "valve-2", "moistureSensor": "bbccdd1122334455"},
    {"id": "zone-C", "name": "Khu C - Arabica", "crop": "arabica",
     "pumpId": "pump-2", "valveId": "valve-3", "moistureSensor": "ccdd112233445566"},
    {"id": "zone-D", "name": "Khu D - Robusta", "crop": "robusta",
     "pumpId": "pump-3", "valveId": "valve-4", "moistureSensor": "dd11223344556677"},
    {"id": "zone-E", "name": "Khu E - Robusta", "crop": "robusta",
     "pumpId": "pump-3", "valveId": "valve-5", "moistureSensor": "1122334455667788"}
]
```

### Pump Capacity Planning

```
Pump 1 (50 L/min): Zone A + Zone B (shared)
Pump 2 (30 L/min): Zone C (dedicated)
Pump 3 (50 L/min): Zone D + Zone E (shared)

Total irrigation capacity: 130 L/min
Max simultaneous irrigation: 2 zones per pump
Total daily irrigation: ~50,000 L (for 5 hectares)
```

---

# Chapter 39: Integration Examples

## 39.1 Zalo Notification Integration

Vietnam's most popular messaging app:

```javascript
// lib/notifications.js
const ZALO_API = 'https://openapi.zalo.me/v3.0/oa/message';

async function sendZaloNotification(phoneNumber, message) {
    const response = await fetch(ZALO_API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'access_token': process.env.ZALO_OA_TOKEN
        },
        body: JSON.stringify({
            recipient: { phone_number: phoneNumber },
            message: { text: message }
        })
    });
    return response.json();
}

// Usage in alert system
async function notifyFarmer(alert) {
    const message = `[SmartFarm] ${alert.severity.toUpperCase()}: ${alert.message}`;
    await sendZaloNotification(FARMER_PHONE, message);
}
```

## 39.2 Telegram Bot Integration

```javascript
// lib/telegram-bot.js
const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// /status command
bot.onText(/\/status/, async (msg) => {
    const zones = await fetchZones();
    const text = zones.map(z =>
        `${z.name}: ${z.sensor.moisture}% moisture, ${z.sensor.temperature}°C`
    ).join('\n');
    bot.sendMessage(msg.chat.id, `🌱 SmartFarm Status:\n${text}`);
});

// /irrigate zone-A command
bot.onText(/\/irrigate (.+)/, async (msg, match) => {
    const zoneId = match[1];
    await controlActuator(`valve-${zoneId.split('-')[1]}`, 'open');
    bot.sendMessage(msg.chat.id, `💧 Irrigating ${zoneId}`);
});

// Alert notification
bot.on('alert', (alert) => {
    bot.sendMessage(CHAT_ID, `⚠️ ${alert.message}`);
});
```

## 39.3 Webhook Integration

```javascript
// Expose webhook endpoint
app.post('/api/webhook/:service', (req, res) => {
    const { service } = req.params;
    const data = req.body;

    switch (service) {
        case 'ifttt':
            // Trigger IFTTT webhook
            triggerIFTTT(data.event, data.data);
            break;
        case 'n8n':
            // Forward to n8n workflow
            forwardTon8n(data);
            break;
        default:
            return res.status(404).json({ error: 'Unknown service' });
    }

    res.json({ ok: true });
});
```

---

# Chapter 40: Glossary Complete

| Term | Full Name | Definition |
|------|-----------|-----------|
| **ADR** | Adaptive Data Rate | LoRaWAN feature that adjusts SF and TX power based on link quality |
| **ABP** | Activation By Personalization | LoRaWAN join method with pre-configured keys |
| **CSS** | Chirp Spread Spectrum | LoRa modulation technique |
| **DevEUI** | Device Extended Unique Identifier | 64-bit device address |
| **DR** | Data Rate | LoRaWAN data rate index (DR0-DR5) |
| **EC** | Electrical Conductivity | Measure of soil salinity (µS/cm) |
| **EIRP** | Effective Isotropic Radiated Power | Total transmitted power including antenna gain |
| **ET₀** | Reference Evapotranspiration | Water loss from reference grass surface |
| **ETc** | Crop Evapotranspiration | Actual crop water need = ET₀ × Kc |
| **FC** | Field Capacity | Maximum water soil holds against gravity |
| **FDR** | Frequency Domain Reflectometry | Moisture measurement technique |
| **Kc** | Crop Coefficient | Ratio of crop ET to reference ET |
| **LoRa** | Long Range | RF modulation technology |
| **LoRaWAN** | LoRa Wide Area Network | Network protocol built on LoRa |
| **MIC** | Message Integrity Code | LoRaWAN frame authentication |
| **Modbus** | — | Industrial serial communication protocol |
| **MQTT** | Message Queuing Telemetry Transport | Lightweight IoT messaging protocol |
| **NPK** | Nitrogen, Phosphorus, Potassium | Primary plant nutrients |
| **OTAA** | Over-The-Air Activation | LoRaWAN join method with dynamic keys |
| **PWP** | Permanent Wilting Point | Soil moisture below which plants cannot extract water |
| **RS485** | — | Differential serial communication standard |
| **SF** | Spreading Factor | LoRa modulation parameter (SF7-SF12) |
| **VWC** | Volumetric Water Content | Percentage of soil volume occupied by water |

---

---

# Part X: Practical Guides

---

# Chapter 41: Grafana Dashboard Creation

## 41.1 Adding InfluxDB Data Source

1. Open Grafana at `http://localhost:3000`
2. Login: admin / admin (change on first login)
3. Navigate to **Configuration → Data Sources → Add data source**
4. Select **InfluxDB**
5. Configure:

| Setting | Value |
|---------|-------|
| Name | SmartFarm InfluxDB |
| URL | http://influxdb:8086 |
| Access | Server (proxy) |
| Organization | smarfarm |
| Token | smarfarm-token-2026 |
| Default Bucket | soil_data |
| Flux | Enable |

6. Click **Save & Test** — should show "Data source is working"

## 41.2 Import Dashboard

1. Navigate to **Dashboards → Import**
2. Click **Upload JSON file**
3. Select `server/config/grafana/dashboards/soil-monitoring.json`
4. Select the InfluxDB data source created above
5. Click **Import**

## 41.3 Creating Panels from Scratch

### Temperature Gauge

```flux
from(bucket: "soil_data")
  |> range(start: -5m)
  |> filter(fn: (r) => r["_measurement"] == "sensor_data")
  |> filter(fn: (r) => r["zone"] == "zone-A")
  |> filter(fn: (r) => r["_field"] == "temperature")
  |> last()
```

Panel settings:
- Type: **Gauge**
- Min: -10
- Max: 50
- Thresholds: Green (15-30), Yellow (30-38), Red (>38)

### Moisture Time Series

```flux
from(bucket: "soil_data")
  |> range(start: -24h)
  |> filter(fn: (r) => r["_measurement"] == "sensor_data")
  |> filter(fn: (r) => r["_field"] == "moisture")
  |> aggregateWindow(every: 5m, fn: mean)
  |> yield(name: "moisture")
```

Panel settings:
- Type: **Time series**
- Y-axis: 0-100%
- Thresholds: Red (<20), Yellow (20-35), Green (35-65), Yellow (65-85), Red (>85)

### NPK Bar Chart

```flux
from(bucket: "soil_data")
  |> range(start: -1h)
  |> filter(fn: (r) => r["_measurement"] == "sensor_data")
  |> filter(fn: (r) => r["zone"] == "zone-A")
  |> filter(fn: (r) => r["_field"] == "nitrogen" or r["_field"] == "phosphorus" or r["_field"] == "potassium")
  |> last()
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
```

Panel settings:
- Type: **Bar chart**
- Bar width: 50%
- Colors: Blue (N), Green (P), Orange (K)

### Control Events Table

```flux
from(bucket: "soil_data")
  |> range(start: -24h)
  |> filter(fn: (r) => r["_measurement"] == "control_event")
  |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 50)
```

Panel settings:
- Type: **Table**
- Columns: time, actuator, source, action, prevState, newState

## 41.4 Dashboard Variables

Create template variables for dynamic filtering:

| Variable | Label | Query |
|----------|-------|-------|
| zone | Zone | `import "influxdata/influxdb" from(bucket:"soil_data") \|> range(start:-1h) \|> filter(fn:(r) => r.zone != "") \|> distinct(column:"zone")` |
| timeRange | Time Range | `1h, 6h, 24h, 7d, 30d` |

Use in queries: `filter(fn: (r) => r["zone"] == "$zone")`

---

# Chapter 42: Detailed Wiring Diagrams

## 42.1 Node ↔ Sensor Connection

```
┌─────────────────────────────────────────────────────────────────┐
│                    E90-DTU / RAK3172 Node                        │
│                                                                  │
│  ┌────────────────┐                                             │
│  │  Terminal Block │                                             │
│  │                 │                                             │
│  │  A (+)  ────────┼──── Yellow wire ──── A (+)  Sensor         │
│  │  B (-)  ────────┼──── Blue wire   ──── B (-)  Sensor         │
│  │  GND    ────────┼──── Black wire  ──── GND    Sensor         │
│  │  VCC    ────────┼──── Red wire    ──── VCC    Sensor         │
│  └────────────────┘                                             │
│                                                                  │
│  ┌────────────────┐                                             │
│  │ Power Input     │                                             │
│  │ DC Jack 12V     │                                             │
│  └────────────────┘                                             │
│                                                                  │
│  ┌────────────────┐                                             │
│  │ LoRa Antenna    │ 915MHz SMA connector                       │
│  │ (MUST attach   │ before power on!                            │
│  │  before power) │                                             │
│  └────────────────┘                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Cable Specifications

| Property | Value |
|----------|-------|
| Type | Twisted pair (Cat5 or shielded) |
| Maximum length | 500m (recommended), 1200m (theoretical) |
| Gauge | 22-24 AWG |
| Shielding | Recommended for runs >100m |

### RS485 Wiring Rules

1. **A↔A, B↔B**: Never cross A and B
2. **Twisted pair**: Use the twisted pairs from Cat5 cable
3. **Common ground**: Connect GND between all devices
4. **Termination**: Add 120Ω resistor at both ends for runs >100m
5. **No stubs**: Keep cable runs clean, avoid T-junctions

## 42.2 Gateway Wiring

```
┌─────────────────────────────────────────────────────────────┐
│                    E870-L915LG12 Gateway                      │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐                     │
│  │ DC Power Jack   │  │ WAN Port       │                     │
│  │ 12V/1A adapter  │  │ Ethernet cable │                     │
│  └────────────────┘  │ to router/     │                     │
│                      │ switch         │                     │
│  ┌────────────────┐  └────────────────┘                     │
│  │ LoRa Antenna    │                                         │
│  │ SMA connector   │  ⚠️ MUST attach before power on!       │
│  │ 915MHz outdoor  │                                         │
│  └────────────────┘                                         │
│                                                              │
│  ┌────────────────┐  ┌────────────────┐                     │
│  │ WiFi Antenna    │  │ USB Debug Port │                     │
│  │ (optional)      │  │ (configuration)│                     │
│  └────────────────┘  └────────────────┘                     │
│                                                              │
│  ┌────────────────┐                                         │
│  │ Restore Button  │ Hold >5s for factory reset             │
│  └────────────────┘                                         │
└─────────────────────────────────────────────────────────────┘
```

## 42.3 Solar Power System Wiring

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Solar Panel  │    │  Charge      │    │  Battery     │      │
│  │  10-20W       │    │  Controller  │    │  12V 7Ah     │      │
│  │  18V output   │    │  PWM/MPPT    │    │  Lead-acid   │      │
│  │               │    │              │    │  or LiFePO4  │      │
│  │  ┌─────┐      │    │  ┌─────┐     │    │  ┌─────┐     │      │
│  │  │ + ──┼──────┼────┼──│ PV+ │     │    │  │ + ──┼─────┼────▶│ 12V+
│  │  │ - ──┼──────┼────┼──│ PV- │     │    │  │ - ──┼─────┼────▶│ GND
│  │  └─────┘      │    │  │ BAT+│─────┼────┼──│ +   │     │      │
│  │               │    │  │ BAT-│─────┼────┼──│ -   │     │      │
│  └──────────────┘    │  └─────┘     │    │  └─────┘     │      │
│                      └──────────────┘    └──────────────┘      │
│                            │                                    │
│                            │ 12V DC output                      │
│                            ▼                                    │
│                      ┌──────────────┐                          │
│                      │  Node +      │                          │
│                      │  Sensor      │                          │
│                      └──────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

# Chapter 43: Testing Methodology

## 43.1 Test Structure

SmartFarm has **128 tests** across two applications:

### Smart Control (100 tests)

```
smart-control/
├── __tests__/
│   ├── advisory.test.js         # 15 tests - Crop advisory logic
│   ├── auto-irrigation.test.js  # 18 tests - Auto irrigation state machine
│   ├── validation.test.js       # 12 tests - Input validation
│   ├── eto.test.js              # 15 tests - ET₀ calculation accuracy
│   ├── scheduler.test.js        # 12 tests - Priority scheduler
│   ├── weather.test.js          # 10 tests - Weather API + fallback
│   ├── alerts.test.js           # 10 tests - Alert threshold system
│   └── integration.test.js      # 8 tests - End-to-end API tests
```

### Simulator (28 tests)

```
simulator/
├── __tests__/
│   ├── soil-model.test.js       # 18 tests - Soil physics accuracy
│   └── environment.test.js      # 10 tests - Environment model
```

## 43.2 Running Tests

```bash
# Smart Control tests
cd smart-control
npm test

# Output:
#   ✓ Advisory: generates irrigation advice when moisture low (12ms)
#   ✓ Advisory: generates drainage advice when moisture high (8ms)
#   ✓ Advisory: generates fertilizer advice for each growth stage (15ms)
#   ✓ Auto-irrigation: starts when moisture below threshold (5ms)
#   ✓ Auto-irrigation: stops when moisture reaches target (5ms)
#   ✓ Auto-irrigation: respects cooldown period (3ms)
#   ✓ Auto-irrigation: pauses during rain (4ms)
#   ✓ ET₀: calculates correct value for DakLak climate (8ms)
#   ...
#
# Test Suites: 8 passed, 8 total
# Tests:       100 passed, 100 total

# Simulator tests
cd ../simulator
npm test

# Output:
#   ✓ Soil: moisture increases with rainfall (5ms)
#   ✓ Soil: moisture decreases with ET (4ms)
#   ✓ Soil: runoff occurs near saturation (3ms)
#   ✓ Soil: drainage above field capacity (4ms)
#   ✓ Environment: temperature follows diurnal cycle (6ms)
#   ✓ Environment: solar radiation peaks at noon (5ms)
#   ...
#
# Test Suites: 2 passed, 2 total
# Tests:       28 passed, 28 total
```

## 43.3 Test Coverage Goals

| Module | Target Coverage | Current |
|--------|----------------|---------|
| eto.js | 90% | 95% |
| water-balance.js | 85% | 88% |
| predictive-irrigation.js | 80% | 82% |
| scheduler.js | 80% | 85% |
| alerts.js | 85% | 90% |
| weather.js | 75% | 78% |
| soil.js (simulator) | 80% | 83% |
| environment.js | 75% | 77% |

## 43.4 Writing New Tests

Example: Testing the advisory system

```javascript
// __tests__/advisory.test.js
const { generateAdvisory } = require('../lib/advisory');

describe('Advisory System', () => {
    test('generates irrigation advice when moisture is low', () => {
        const zone = { id: 'zone-A', crop: 'robusta' };
        const sensor = { moisture: 25, temperature: 28, ec: 400, ph: 5.8,
                        nitrogen: 120, phosphorus: 35, potassium: 180 };
        const weather = { rainfall: 0 };
        const rule = { moistureMin: 35, moistureMax: 65 };

        const result = generateAdvisory(zone, sensor, weather, rule);

        expect(result.urgency).toBe('critical');
        expect(result.advices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'irrigation',
                    message: expect.stringContaining('moisture')
                })
            ])
        );
    });

    test('generates fertilizer advice for deficient NPK', () => {
        const zone = { id: 'zone-A', crop: 'robusta' };
        const sensor = { moisture: 55, temperature: 28, ec: 400, ph: 5.8,
                        nitrogen: 20, phosphorus: 5, potassium: 30 };
        const weather = { rainfall: 0 };
        const rule = { moistureMin: 35, moistureMax: 65 };

        const result = generateAdvisory(zone, sensor, weather, rule);

        expect(result.advices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'fertilization',
                    message: expect.stringContaining('N')
                })
            ])
        );
    });
});
```

---

# Chapter 44: CI/CD Pipeline

## 44.1 GitHub Actions Configuration

```yaml
# .github/workflows/ci.yml
name: SmartFarm CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        working-directory: smart-control
        run: npm ci
      - name: Run ESLint
        working-directory: smart-control
        run: npm run lint

  test-smart-control:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        working-directory: smart-control
        run: npm ci
      - name: Run tests
        working-directory: smart-control
        run: npm test

  test-simulator:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        working-directory: simulator
        run: npm ci
      - name: Run tests
        working-directory: simulator
        run: npm test

  build-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Check TypeScript
        working-directory: smart-control
        run: npx tsc --noEmit
```

## 44.2 ESLint Configuration

```javascript
// eslint.config.js
module.exports = [
    {
        files: ['**/*.js'],
        rules: {
            'no-unused-vars': 'warn',
            'no-console': 'off',      // Allow console.log in IoT apps
            'no-process-exit': 'error',
            'eqeqeq': 'error',
            'no-var': 'error',
            'prefer-const': 'warn',
            'no-throw-literal': 'error'
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs'
        }
    }
];
```

---

# Chapter 45: Frequently Asked Questions

## 45.1 General

**Q: How much does the hardware cost?**

A: Approximately $400 for a 3-zone setup:
- Gateway (E870): ~$100
- 3× LoRaWAN Nodes (RAK3172): ~$45
- 3× Soil Sensors: ~$150
- 3× Solar Systems: ~$105

**Q: How far can the LoRa signal go?**

A: In open field conditions (line-of-sight), up to 3-5 km. In obstructed conditions (trees, buildings), typically 1-3 km. The gateway antenna should be mounted at least 3m high for best range.

**Q: How often does the sensor send data?**

A: Configurable, typically every 5 minutes. This balances data freshness with battery life. With 5-minute intervals and solar power, the system can run indefinitely.

**Q: Can I use the system without the hardware?**

A: Yes! The Simulator acts as a Digital Twin that generates realistic sensor data. You can run the entire system on your laptop with simulated data.

**Q: Does the system work offline?**

A: Partially. The Smart Control server works offline (auto-irrigation, advisory). Weather data requires internet, but falls back to simulated seasonal data. The mobile app needs network connection to the server.

## 45.2 Technical

**Q: Why use MQTT instead of HTTP for sensor data?**

A: MQTT is designed for IoT:
- **Lightweight**: 2-byte header vs HTTP's hundreds of bytes
- **Persistent connection**: No TCP handshake overhead per message
- **Pub/Sub**: Multiple services can subscribe to the same data
- **QoS**: Built-in delivery guarantees
- **Retained messages**: New subscribers get the last value immediately

**Q: Why InfluxDB instead of PostgreSQL for sensor data?**

A: Time-series databases are optimized for:
- **High write throughput**: Millions of points per second
- **Automatic timestamping**: Every point gets nanosecond precision
- **Time-based queries**: "Give me the last 24 hours" is a native operation
- **Compression**: Time-series data compresses 10:1 or better
- **Retention policies**: Auto-delete old data

**Q: How does the auto-irrigation handle sensor failures?**

A: Multiple safety mechanisms:
1. **Max duration timer**: Pump automatically shuts off after maxDurationMin
2. **Cooldown period**: Prevents rapid cycling
3. **Rain pause**: Stops irrigation during rain
4. **Manual override**: Users can disable auto-irrigation per zone

**Q: Can I add more zones?**

A: Yes. Add entries to `zones.json`, `actuators.json`, and `irrigation-rules.json`. Each zone needs a unique sensor DevEUI registered in ChirpStack.

## 45.3 Troubleshooting

**Q: My sensor returns all zeros**

A: Common causes:
1. Wrong Modbus address (default is 0x02)
2. Wrong baud rate (default is 9600)
3. Reversed A/B wiring
4. Sensor not powered

Use ModScan32 to test the sensor directly.

**Q: Gateway shows "Disconnected" in ChirpStack**

A: Check:
1. Gateway is powered on with antenna attached
2. Ethernet cable connected
3. Packet forwarder configured with correct server IP
4. Firewall allows UDP port 1700

**Q: Smart Control can't connect to MQTT**

A: Check:
1. Mosquitto container is running: `docker ps | grep mosquitto`
2. MQTT port is accessible: `mosquitto_sub -h localhost -t "$SYS/#" -C 1`
3. Smart Control logs show connection attempts

**Q: Mobile app shows "Network Error"**

A: Check:
1. API server is running on port 3002
2. Phone and server are on same network
3. `EXPO_PUBLIC_API_URL` points to correct IP
4. Firewall allows port 3002

---

# Appendix F: Complete API Response Examples

## F.1 GET /api/zones (Full Response)

```json
[
    {
        "id": "zone-A",
        "name": "Khu A",
        "area": 3000,
        "crop": "robusta",
        "plantDate": "2024-03-15",
        "soilType": "bazan-red",
        "pumpId": "pump-1",
        "valveId": "valve-1",
        "moistureSensor": "aabbccdd11223344",
        "location": {
            "lat": 12.753,
            "lng": 108.048
        },
        "sensor": {
            "temperature": 27.5,
            "moisture": 55.0,
            "ec": 450,
            "salinity": 220,
            "nitrogen": 120,
            "phosphorus": 35,
            "potassium": 180,
            "ph": 5.8,
            "lastUpdate": "2026-07-16T10:30:00.000Z"
        },
        "rule": {
            "enabled": true,
            "moistureMin": 35,
            "moistureMax": 65,
            "maxDurationMin": 30,
            "cooldownMin": 120,
            "rainPause": true,
            "rainThreshold": 5,
            "lastIrrigation": 1721101800000
        },
        "stage": {
            "id": "fruit-growth",
            "name": "Phát triển quả",
            "months": [5, 6, 7, 8],
            "durationDays": 120,
            "description": "Quả lớn dần, tích lũy chất khô bên trong",
            "irrigation": {
                "target": 55,
                "frequency": "1-2 lần/tuần",
                "notes": "Tươi duy trì, mùa mưa có thể giảm tưới"
            },
            "fertilization": {
                "N": 30,
                "P": 20,
                "K": 80,
                "notes": "Bón Kali (K) cao để quả to, chất lượng tốt. NPK 10-5-20."
            },
            "risks": ["Mưa nhiều → ngập úng", "Bệnh thán thư", "Sâu đục quả"]
        },
        "plantAge": {
            "months": 28,
            "years": 2
        }
    }
]
```

## F.2 GET /api/schedule (Full Response)

```json
{
    "date": "2026-07-16",
    "generatedAt": "2026-07-16T10:30:00.000Z",
    "window": {
        "start": 5,
        "end": 7,
        "label": "Sáng sớm (5-7h)",
        "efficiency": 0.95,
        "status": "scheduled",
        "minutesUntil": 420,
        "selectedAt": "2026-07-16T10:30:00.000Z"
    },
    "zones": [
        {
            "zoneId": "zone-C",
            "zoneName": "Khu C",
            "crop": "arabica",
            "pumpId": "pump-2",
            "valveId": "valve-3",
            "plan": {
                "targetMoisture": 40,
                "volumeLiters": 600,
                "ETc": 3.8
            },
            "priority": 1.85,
            "priorityBreakdown": {
                "urgency": 1.2,
                "cropValueFactor": 1.3,
                "waterStressFactor": 1.19,
                "ET0": 4.2,
                "Kc": 0.9,
                "ETc": 3.8
            },
            "canIrrigate": {
                "allowed": true,
                "reason": "ok"
            },
            "scheduled": true,
            "scheduledTime": {
                "start": "2026-07-16T05:00:00.000Z",
                "end": "2026-07-16T05:20:00.000Z",
                "startOffsetMin": 0,
                "durationMin": 20
            },
            "estimatedDurationMin": 20,
            "estimatedVolumeLiters": 600
        },
        {
            "zoneId": "zone-A",
            "zoneName": "Khu A",
            "crop": "robusta",
            "pumpId": "pump-1",
            "valveId": "valve-1",
            "plan": {
                "targetMoisture": 35,
                "volumeLiters": 900,
                "ETc": 4.4
            },
            "priority": 0.85,
            "canIrrigate": {
                "allowed": false,
                "reason": "cooldown",
                "remainingMin": 45
            },
            "scheduled": false,
            "skipReason": "cooldown"
        }
    ],
    "summary": {
        "totalZones": 3,
        "zonesToIrrigate": 1,
        "totalVolumeLiters": 600,
        "totalDurationMin": 20
    }
}
```

---

# Appendix G: Changelog

## Version 1.0 (2026-07-16)

### Added
- JWT authentication with role-based access control
- InfluxDB persistence for sensor data and control events
- Open-Meteo weather API integration
- Alert system with threshold monitoring
- Audit logging for all control actions
- Predictive irrigation scheduler (ET₀-based)
- Multi-zone priority scheduler
- Rate limiting on API endpoints
- Mobile app (React Native + Expo)
- Historical charts (Chart.js)
- Data export (CSV/JSON)
- System health endpoint
- 128 automated tests
- GitHub Actions CI/CD
- Prometheus metrics endpoint

### Changed
- Modularized dashboard into 8 components
- Responsive mobile-first design
- Dark/Light theme support

### Fixed
- Duplicate variable declarations
- Input validation gaps
- MQTT reconnection handling

---

*This complete technical guide was generated from the SmartFarm DakLak source code, documentation, and hardware specifications. Version 1.0, July 2026.*

*Repository: https://github.com/dinhhieudl/smartfarm-daklak*
*Mobile App: https://github.com/dinhhieudl/smartfarm-mobile*

---

# Part XI: Reference Materials

---

# Chapter 46: ET₀ Calculation Worked Examples

## 46.1 Example: Hot Dry Day in DakLak (March)

**Given:**
- Temperature: 35°C
- Relative Humidity: 40%
- Wind Speed: 3 m/s
- Cloud Cover: 20%
- Altitude: 500m

**Step 1: Saturation Vapor Pressure (es)**

```
es = 0.6108 × exp(17.27 × T / (T + 237.3))
es = 0.6108 × exp(17.27 × 35 / (35 + 237.3))
es = 0.6108 × exp(604.45 / 272.3)
es = 0.6108 × exp(2.219)
es = 0.6108 × 9.197
es = 5.617 kPa
```

**Step 2: Actual Vapor Pressure (ea)**

```
ea = es × RH / 100
ea = 5.617 × 40 / 100
ea = 2.247 kPa
```

**Step 3: Slope of Vapor Pressure Curve (Δ)**

```
Δ = 4098 × es / (T + 237.3)²
Δ = 4098 × 5.617 / (35 + 237.3)²
Δ = 23019.5 / 74147.3
Δ = 0.310 kPa/°C
```

**Step 4: Psychrometric Constant (γ)**

```
P = 101.3 × ((293 - 0.0065 × 500) / 293)^5.26
P = 101.3 × (289.75 / 293)^5.26
P = 101.3 × 0.989^5.26
P = 101.3 × 0.944
P = 95.6 kPa

γ = 0.000665 × P
γ = 0.000665 × 95.6
γ = 0.0636 kPa/°C
```

**Step 5: Net Radiation (Rn)**

```
Ra = 22 MJ/m²/day (extraterrestrial for DakLak)
n_N = (100 - 20) / 100 = 0.8 (sunshine fraction)
Rs = (0.25 + 0.50 × 0.8) × 22 = 0.65 × 22 = 14.3 MJ/m²/day
Rn = 0.75 × 14.3 - 2.0 = 10.725 MJ/m²/day
```

**Step 6: ET₀**

```
Numerator = 0.408 × 0.310 × 10.725 + 0.0636 × (37 / 308) × 3 × (5.617 - 2.247)
         = 0.408 × 0.310 × 10.725 + 0.0636 × 0.1201 × 3 × 3.37
         = 1.361 + 0.771
         = 2.132

Denominator = 0.310 + 0.0636 × (1 + 0.34 × 3)
            = 0.310 + 0.0636 × 2.02
            = 0.310 + 0.1285
            = 0.4385

ET₀ = 2.132 / 0.4385 = 4.86 mm/day
```

**Result: ET₀ = 4.86 mm/day** — This is a high evaporation day, typical for March in DakLak during the dry season.

## 46.2 Example: Cool Rainy Day (July)

**Given:**
- Temperature: 24°C
- Relative Humidity: 85%
- Wind Speed: 2 m/s
- Cloud Cover: 70%
- Rainfall: 15mm

**Step 1-4 (same formulas):**

```
es = 0.6108 × exp(17.27 × 24 / (24 + 237.3)) = 2.985 kPa
ea = 2.985 × 85 / 100 = 2.537 kPa
Δ = 4098 × 2.985 / (24 + 237.3)² = 0.176 kPa/°C
γ = 0.0636 kPa/°C
```

**Step 5: Net Radiation**

```
n_N = (100 - 70) / 100 = 0.3
Rs = (0.25 + 0.50 × 0.3) × 22 = 0.40 × 22 = 8.8 MJ/m²/day
Rn = 0.75 × 8.8 - 2.0 = 4.6 MJ/m²/day
```

**Step 6: ET₀**

```
Numerator = 0.408 × 0.176 × 4.6 + 0.0636 × (37 / 297) × 2 × (2.985 - 2.537)
         = 0.330 + 0.068
         = 0.398

Denominator = 0.176 + 0.0636 × (1 + 0.34 × 2)
            = 0.176 + 0.107
            = 0.283

ET₀ = 0.398 / 0.283 = 1.41 mm/day
```

**Result: ET₀ = 1.41 mm/day** — Low evaporation, typical for rainy season.

## 46.3 Crop Water Need (ETc) Examples

| Scenario | ET₀ | Kc | ETc | Daily Water (3000m²) |
|----------|-----|-----|-----|---------------------|
| Hot dry, Robusta flowering | 4.86 | 0.85 | 4.13 mm | 12,390 L |
| Cool rainy, Robusta dormant | 1.41 | 0.40 | 0.56 mm | 1,680 L |
| Hot dry, Arabica fruit growth | 4.86 | 1.00 | 4.86 mm | 14,580 L |
| Moderate, Robusta fruit set | 3.20 | 1.00 | 3.20 mm | 9,600 L |

---

# Chapter 47: Hardware Comparison Guide

## 47.1 LoRaWAN Nodes Comparison

| Feature | RAK3172 | RAK4631 | SenseCAP S2100 | STM32WL |
|---------|---------|---------|----------------|---------|
| **Chip** | STM32WLE5 | nRF52840 + SX1262 | — | STM32WLE5 |
| **LoRaWAN** | 1.0.3 | 1.0.3 | 1.0.3 | 1.0.3 |
| **Interface** | UART, RS485 | UART, I2C, SPI | RS485, 4-20mA | UART, SPI |
| **Price** | ~$15 | ~$20 | ~$35 | ~$8 |
| **Power** | 3.3V | 3.3V | 5-24V | 3.3V |
| **AT Commands** | ✅ | ✅ | ✅ | ❌ (firmware needed) |
| **Documentation** | Excellent | Excellent | Good | Limited |
| **Difficulty** | Easy | Easy | Easy | Medium |
| **RS485 Built-in** | ✅ | ❌ (breakout) | ✅ | ❌ |
| **Recommended** | ⭐ Best | Good | Pre-built option | DIY only |

## 47.2 Gateway Comparison

| Feature | E870-L915LG12 | RAK7248 | Kerlink iFemtoCell |
|---------|---------------|---------|-------------------|
| **Chipset** | SX1302 | SX1302 | SX1301 |
| **Channels** | 8 | 8 | 8 |
| **Frequency** | AS923 | Configurable | Configurable |
| **Price** | ~$100 | ~$80 | ~$500 |
| **Power** | 12V DC | PoE / 12V | PoE |
| **Outdoor** | Yes (IP65) | Yes (IP67) | Yes (IP67) |
| **Interface** | Ethernet, WiFi | Ethernet, WiFi | Ethernet |
| **Packet Forwarder** | ✅ | ✅ | ✅ |
| **LoRaWAN Server** | ❌ (needs ChirpStack) | ❌ | Built-in |

## 47.3 Soil Sensor Comparison

| Feature | SmartFarm 8-in-1 | Sentek Drill & Drop | TEROS 12 |
|---------|-----------------|---------------------|----------|
| **Parameters** | 8 (T, M, EC, NPK, pH, Salinity) | 3 (M, EC, T) | 3 (M, EC, T) |
| **Interface** | RS485 Modbus | SDI-12 | SDI-12 |
| **Probe** | 60mm, Ø3mm | 100mm, Ø20mm | 100mm, Ø8mm |
| **Accuracy (M)** | ±3% | ±2% | ±2% |
| **Price** | ~$50 | ~$300 | ~$400 |
| **NPK Measurement** | ✅ (estimated) | ❌ | ❌ |
| **pH Measurement** | ✅ | ❌ | ❌ |
| **IP Rating** | IP68 | IP68 | IP68 |
| **Best For** | Budget, multi-parameter | Research, accuracy | Research, accuracy |

---

# Chapter 48: Deployment Scenarios

## 48.1 Scenario A: Small Farm (1-2 Hectares)

**Setup:**
- 1 Gateway (E870) — in farmhouse
- 2-3 Sensors — one per zone
- 2-3 Nodes (RAK3172) — solar powered
- 1 Server — laptop or Raspberry Pi

**Cost:** ~$300-400

```
                    ┌──────────────┐
                    │  Farmhouse   │
                    │  ┌────────┐  │
                    │  │Gateway │  │
                    │  │(E870)  │  │
                    │  └────┬───┘  │
                    │       │      │
                    │  ┌────┴───┐  │
                    │  │Laptop/ │  │
                    │  │RPi     │  │
                    │  │Server  │  │
                    │  └────────┘  │
                    └──────────────┘
                           │
                    ~~~~~~~LoRa~~~~~~~~
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴─────┐ ┌───┴─────┐
        │  Node 1   │ │ Node 2  │ │ Node 3  │
        │  + Solar  │ │ + Solar │ │ + Solar │
        │  + Sensor │ │ + Sensor│ │ + Sensor│
        └───────────┘ └─────────┘ └─────────┘
          Zone A        Zone B      Zone C
```

## 48.2 Scenario B: Medium Farm (5-10 Hectares)

**Setup:**
- 2 Gateways — for coverage
- 5-10 Sensors — one per zone
- 5-10 Nodes — solar powered
- 1 Server — dedicated laptop or mini-PC
- 1 UPS — for power stability

**Cost:** ~$800-1200

```
                    ┌──────────────────────────────┐
                    │        Main House             │
                    │  ┌────────┐  ┌────────┐      │
                    │  │Gateway1│  │Gateway2│      │
                    │  │(E870)  │  │(E870)  │      │
                    │  └────┬───┘  └────┬───┘      │
                    │       │           │           │
                    │  ┌────┴───────────┴────┐     │
                    │  │    Server (PC)       │     │
                    │  │  + UPS               │     │
                    │  └─────────────────────┘     │
                    └──────────────────────────────┘
                           │              │
                    ~~~~~~~LoRa~~~~~  ~~~~LoRa~~~~~
                           │              │
          ┌────────────────┤        ┌──────┤
          │                │        │      │
    ┌─────┴──┐  ┌─────┴──┐  ┌─────┴──┐ ┌─────┴──┐
    │Node 1-3│  │Node 4-5│  │Node 6-8│ │Node 9-10│
    │+ Solar │  │+ Solar │  │+ Solar │ │+ Solar  │
    │+ Sensor│  │+ Sensor│  │+ Sensor│ │+ Sensor │
    └────────┘  └────────┘  └────────┘ └─────────┘
     Zone A-C    Zone D-E    Zone F-G   Zone H-J
```

## 48.3 Scenario C: Large Plantation (50+ Hectares)

**Setup:**
- 5-10 Gateways — mesh coverage
- 50+ Sensors — comprehensive monitoring
- 50+ Nodes — solar powered
- 1 Server — dedicated server or cloud VM
- Redundant power — solar + battery + generator backup
- Multiple SIM cards — for cellular backup

**Cost:** ~$5000-10000

```
                    ┌──────────────────────────────────┐
                    │        Control Center              │
                    │  ┌──────────────────────────────┐ │
                    │  │    Cloud Server (AWS/GCP)     │ │
                    │  │    or On-premise Server       │ │
                    │  │                               │ │
                    │  │  ChirpStack + Smart Control   │ │
                    │  │  InfluxDB + Grafana           │ │
                    │  └──────────────────────────────┘ │
                    └──────────────────────────────────┘
                              │        │
                    ┌─────────┘        └─────────┐
                    │                            │
              ┌─────┴─────┐              ┌───────┴─────┐
              │ Gateway 1-3│              │ Gateway 4-5 │
              │ (North)    │              │ (South)     │
              └─────┬─────┘              └───────┬─────┘
                    │                            │
           ┌────────┤                  ┌────────┤
           │        │                  │        │
     ┌─────┴──┐ ┌───┴──┐          ┌───┴──┐ ┌───┴──┐
     │Node 1-20│ │Node  │          │Node  │ │Node  │
     │Field A  │ │21-30 │          │31-40 │ │41-50 │
     │         │ │Field B│         │Field C│ │Field D│
     └─────────┘ └──────┘          └──────┘ └──────┘
```

---

# Chapter 49: Performance Benchmarks

## 49.1 Smart Control Performance

| Metric | Value | Notes |
|--------|-------|-------|
| API Response Time | <50ms | p95 for GET endpoints |
| MQTT Message Processing | <10ms | Per message |
| Auto-irrigation Check | <100ms | All zones combined |
| Advisory Generation | <50ms | Per zone |
| Memory Usage | ~45MB | Steady state |
| CPU Usage | <5% | On modern laptop |
| Max Concurrent Users | 50+ | WebSocket connections |

## 49.2 Simulator Performance

| Metric | Value | Notes |
|--------|-------|-------|
| Tick Interval (default) | 30 seconds | Configurable |
| Tick Processing Time | <5ms | Physics + MQTT publish |
| MQTT Publish Time | <2ms | Per zone |
| Memory Usage | ~30MB | Steady state |
| Max Time Acceleration | 3600x | 1 day = 24 seconds |

## 49.3 InfluxDB Performance

| Metric | Value | Notes |
|--------|-------|-------|
| Write Throughput | >10,000 points/sec | Single node |
| Query Latency (1h) | <50ms | With proper indexing |
| Query Latency (7d) | <200ms | Aggregation query |
| Storage per Day | ~400KB | 3 zones × 2880 points |
| Compression Ratio | 10:1 | Time-series optimized |

## 49.4 LoRa Performance

| Metric | Value | Conditions |
|--------|-------|-----------|
| Range (LOS) | 3-5 km | Open field, gateway at 3m |
| Range (Obstructed) | 1-3 km | Trees, buildings |
| Packet Delivery Rate | >99% | SF10, clear conditions |
| Latency | <1 second | TX to server |
| Battery Life | >1 year | 5-min interval, solar |

---

# Chapter 50: Glossary Vietnamese-English

| Tiếng Việt | English | Giải thích |
|-----------|---------|-----------|
| Độ ẩm đất | Soil moisture | Lượng nước trong đất (%VWC) |
| Nhiệt độ đất | Soil temperature | Nhiệt độ tại rễ cây (°C) |
| Độ dẫn điện | Electrical Conductivity (EC) | Đo độ mặn trong đất (µS/cm) |
| Độ chua | pH | Đo axit/kiềm trong đất |
| Nitrogen (N) | Nitrogen | Dinh dưỡng cho lá |
| Phosphorus (P) | Phosphorus | Dinh dưỡng cho hoa và rễ |
| Potassium (K) | Potassium | Dinh dưỡng cho quả |
| Bơm nước | Water pump | Thiết bị bơm nước tưới |
| Van nước | Water valve | Van điều khiển nước |
| Tưới tự động | Automatic irrigation | Tưới theo cảm biến |
| Tưới thủ công | Manual irrigation | Tưới bằng tay |
| Mùa khô | Dry season | Tháng 11-4 |
| Mùa mưa | Rainy season | Tháng 5-10 |
| Cà phê Robusta | Robusta coffee | Loại cà phê phổ biến |
| Cà phê Arabica | Arabica coffee | Loại cà phê cao cấp |
| Giai đoạn sinh trưởng | Growth stage | Các giai đoạn phát triển |
| Ra hoa | Flowering | Giai đoạn ra hoa |
| Đậu quả | Fruit set | Giai đoạn quả non |
| Phát triển quả | Fruit growth | Giai đoạn quả lớn |
| Chín | Ripening | Giai đoạn quả chín |
| Thu hoạch | Harvest | Giai đoạn thu hoạch |
| Nghỉ | Dormant | Giai đoạn nghỉ sau thu hoạch |
| Phân bón | Fertilizer | Phân NPK, phân chuồng |
| Bón vôi | Apply lime | Chống đất chua |
| Xả mặn | Leaching | Rửa mặn cho đất |
| Đất bazan | Basalt soil | Đất đỏ Tây Nguyên |

---

*End of SmartFarm DakLak: The Complete Technical Guide*

*Total: 50 Chapters, ~100 pages*

*Generated: July 2026*
