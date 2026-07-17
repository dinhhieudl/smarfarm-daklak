# SmartFarm Cà phê DakLak — Kế hoạch Triển khai Chi tiết

> Tài liệu kế hoạch toàn diện: Hardware, Triển khai, và Kịch bản vận hành
> Phiên bản: 1.0 — Tháng 6/2026
> Cập nhật lần cuối: 2026-06-19

---

## Mục lục

- [Phần A: Hardware cần thiết](#phần-a-hardware-cần-thiết)
- [Phần B: Triển khai (Deployment)](#phần-b-triển-khai-deployment)
- [Phần C: Kịch bản vận hành (Scenarios)](#phần-c-kịch-bản-vận-hành-scenarios)

---

# Phần A: Hardware cần thiết

## A.1 Kiến trúc tổng thể

```
                        VƯỜN CÀ PHÊ (Outdoor)              NHÀ/Server (Indoor)
                   ┌──────────────────────────┐        ┌──────────────────────────┐
                   │                          │        │                          │
                   │  ┌────────────────────┐  │        │  ┌────────────────────┐  │
                   │  │ Soil Sensor #1     │  │  LoRa  │  │ E870 Gateway       │  │
                   │  │ (Nhiệt độ/Độ ẩm/  │  │ AS923  │  │ L915LG12           │  │
                   │  │  EC/NPK/pH)       │  │        │  │                    │  │
                   │  └────────┬───────────┘  │        │  └────────┬───────────┘  │
                   │           │ RS485        │        │           │ Ethernet     │
                   │  ┌────────┴───────────┐  │        │  ┌────────┴───────────┐  │
                   │  │ E78 LoRaWAN Node   │  │───────▶│  │ Router/Switch      │  │
                   │  │ (RS485→LoRaWAN)    │  │        │  └────────┬───────────┘  │
                   │  └────────┬───────────┘  │        │           │              │
                   │           │ Power        │        │  ┌────────┴───────────┐  │
                   │  ┌────────┴───────────┐  │        │  │ Laptop/Server      │  │
                   │  │ Solar Panel 15W    │  │        │  │ (Docker Stack)     │  │
                   │  │ + Battery 12V 7Ah  │  │        │  │                    │  │
                   │  └────────────────────┘  │        │  │ • ChirpStack v4    │  │
                   │                          │        │  │ • Node-RED         │  │
                   │  [ × 3 zones ]           │        │  │ • InfluxDB         │  │
                   │                          │        │  │ • Grafana          │  │
                   └──────────────────────────┘        │  │ • Smart Control    │  │
                                                       │  └────────────────────┘  │
                                                       └──────────────────────────┘
```

## A.2 Danh sách thiết bị chi tiết

### Nhóm 1: Cảm biến & Node LoRa (×3 vùng)

| # | Thiết bị | Thông số chính | SL | Giá tham khảo |
|---|----------|---------------|-----|--------------|
| 1 | Soil Sensor RS485 | Đo 8 thông số: Temp, Moisture, EC, Salinity, N, P, K, pH. IP68, probe 316L SS. Modbus-RTU, 9600 baud, addr 0x02 | 3 | ~1.2tr/sensor |
| 2 | E78-DTU(900LN22) | LoRaWAN 1.0.3, AS923, OTAA, RS485+UART, 22dBm TX, ~3km range | 3 | ~1.5tr/node |

**Kết nối mỗi vùng:**

```
E78-DTU(900LN22)              Soil Multi-Parameter Sensor
┌──────────────────┐          ┌──────────────────┐
│ RS485 Terminal   │          │ Cable (2m)       │
│  A (+) ──────────┼── A ────┼── A (yellow)     │
│  B (-) ──────────┼── B ────┼── B (blue)       │
│  GND ────────────┼── GND ──┼── GND (black)    │
│  VCC ────────────┼── 12V ──┼── VCC (red)      │
│                  │          │                  │
│ LoRa Antenna     │          │ Probes → Soil    │
│  ┌───┐           │          │ (cắm xuống đất)  │
│  │915│           │          │                  │
│  └───┘           │          │                  │
└──────────────────┘          └──────────────────┘
```

**Cấu hình E78 Node (AT Commands):**

```
AT+MODE=LORAWAN           # Chế độ LoRaWAN
AT+JOIN=OTAA              # Join OTAA
AT+DEVEUI=<Device EUI>    # Từ ChirpStack
AT+APPEUI=<App EUI>       # Từ ChirpStack
AT+APPKEY=<App Key>       # 16 bytes hex
AT+CLASS=A                # Class A (tiết kiệm pin)
AT+DR=2                   # Data Rate (AS923 DR2 = SF10/125kHz)
AT+PORT=2                 # Uplink port
AT+MODBUS=1               # Bật Modbus polling
AT+MBADDR=0x02            # Địa chỉ sensor
AT+MBFUNC=0x03            # Read Holding Registers
AT+MBREG=0x0000           # Register đầu
AT+MBLEN=8                # Đọc 8 register
AT+MBINTV=300             # Poll mỗi 5 phút
AT+JOIN=1                 # Bắt đầu join
```

### Nhóm 2: Gateway (×1)

| # | Thiết bị | Thông số chính | SL | Giá tham khảo |
|---|----------|---------------|-----|--------------|
| 3 | E870-L915LG12 | SX1302, AS923, 27dBm TX, Ethernet 10/100, WiFi, ~3km | 1 | ~3.5tr |

**Kết nối Gateway:**

```
E870-L915LG12 Gateway
├── DC Power: 12V/2A adapter → barrel jack
├── Ethernet: LAN cable → router/switch
├── LoRa Antenna: SMA → 915MHz antenna (⚠️ PHẢI GẮN TRƯỚC KHI CẤP NGUỒN!)
├── WiFi-M Antenna: SMA → 2.4GHz (tùy chọn)
└── Debug: USB → PC (tùy chọn)
```

### Nhóm 3: Server (×1)

| # | Thiết bị | Thông số khuyến nghị | SL | Chi phí |
|---|----------|---------------------|-----|---------|
| 4 | Laptop/PC | CPU 4 cores+, RAM 8GB+, SSD 256GB+, Ubuntu 22.04 | 1 | Dùng máy có sẵn |

**Docker Stack (8 services):**

| Service | Image | Port | Chức năng |
|---------|-------|------|----------|
| PostgreSQL | postgres:16-alpine | 5432 | Database cho ChirpStack |
| Redis | redis:7-alpine | 6379 | Cache cho ChirpStack |
| Mosquitto | eclipse-mosquitto:2 | 1883 | MQTT broker |
| ChirpStack v4 | chirpstack/chirpstack:4 | 8080 | LoRaWAN network server |
| Gateway Bridge | chirpstack/chirpstack-gateway-bridge:4.1 | 1700/udp | UDP→MQTT bridge |
| Node-RED | nodered/node-red:latest | 1880 | Data processing pipeline |
| InfluxDB | influxdb:2.7 | 8086 | Time-series database |
| Grafana | grafana/grafana:latest | 3005 | Dashboard & monitoring |
| Smart Control | smartfarm-smart-control | 3002 | Điều khiển + Tư vấn |

### Nhóm 4: Thiết bị tưới (Actuators)

| # | Thiết bị | Thông số chính | SL | Giá tham khảo |
|---|----------|---------------|-----|--------------|
| 5 | Bơm nước | 1-2 HP, 30-50 m³/h, 220V AC | 1 | ~2-3tr |
| 6 | Van điện từ DN25 | 12V DC, 2 chiều, 0.02-0.8 MPa | 3 | ~350k/van |
| 7 | Relay module 4 kênh | 3.3V/5V control, 10A/250VAC | 1 | ~80k |

### Nhóm 5: Nguồn điện Solar (cho remote nodes)

| # | Thiết bị | Thông số chính | SL | Giá tham khảo |
|---|----------|---------------|-----|--------------|
| 8 | Solar Panel | 10-20W, 18V | 3 | ~200k/bản |
| 9 | Charge Controller | PWM 12V 5A | 3 | ~100k/bộ |
| 10 | Battery | 12V 7Ah Lead-acid/LiFePO4 | 3 | ~400k/ổ |

### Nhóm 6: Phụ kiện

| # | Thiết bị | Thông số chính | SL | Giá tham khảo |
|---|----------|---------------|-----|--------------|
| 11 | Antenna 915MHz | SMA, Omni, 3dBi+ | 4 | ~100k/antenna |
| 12 | Cáp RS485 | Twisted pair, Cat5 | 50m | ~50k/50m |
| 13 | Cáp Ethernet | Cat5e/Cat6 | 20m | ~50k/20m |
| 14 | Waterproof enclosure | IP65+ outdoor | 3 | ~200k/hộp |
| 15 | Ống bảo vệ cáp | PVC conduit | 50m | ~50k/50m |

## A.3 Power Budget

### Server (Indoor)

| Component | Voltage | Current | Power |
|-----------|---------|---------|-------|
| Gateway E870 | 12V DC | 120mA (TX), 80mA (idle) | ~1.5W idle, ~1.4W TX |
| Laptop/PC | 19V DC | 2-3A | ~40-60W |
| **Tổng indoor** | | | **~45-65W** |

### Remote Node (Outdoor, Solar-powered)

| Component | Voltage | Current | Power |
|-----------|---------|---------|-------|
| E78 Node (TX) | 3.3-12V | 45mA | ~0.5W |
| E78 Node (sleep) | 3.3V | 10µA | ~0.00003W |
| Soil Sensor (measure) | 12V | 25mA | ~0.3W |
| Soil Sensor (idle) | 12V | 3mA | ~0.036W |
| **Tổng node (TX)** | | | **~0.8W** |
| **Tổng node (idle)** | | | **~0.04W** |

### Solar Sizing

Với chu kỳ poll 5 phút/lần, mỗi lần TX ~2 giây:

```
Energy per day (node):
  TX: 288 transmissions × 2s × 0.8W = 4,608 mWh = 4.6 Wh
  Idle: 86,398s × 0.04W = 3,456 Wh → 3.5 Wh
  Sensor measure: 288 × 0.1s × 0.3W = 8.6 mWh ≈ 0.01 Wh
  TOTAL: ~8.1 Wh/day

Solar Panel (15W, 4 hours sun/day):
  Generated: 15W × 4h = 60 Wh/day → MUCH MORE than needed

Battery (12V 7Ah = 84 Wh):
  Autonomy: 84 Wh / 8.1 Wh/day ≈ 10 days without sun
```

**Kết luận:** Solar Panel 10-15W + Battery 12V 7Ah đủ cho 1 node hoạt động liên tục.

## A.4 Sơ đồ tổng thể

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SMARTFARM COFFEE - FULL TOPOLOGY                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ZONE A (Robusta 5000m²)      ZONE B (Arabica 3000m²)             │
│   ┌──────────────┐              ┌──────────────┐                   │
│   │ Soil Sensor  │              │ Soil Sensor  │                   │
│   │ (RS485)      │              │ (RS485)      │                   │
│   └──────┬───────┘              └──────┬───────┘                   │
│          │ RS485                       │ RS485                      │
│   ┌──────┴───────┐              ┌──────┴───────┐                   │
│   │ E78 Node #1  │              │ E78 Node #2  │                   │
│   │ (LoRaWAN)    │              │ (LoRaWAN)    │                   │
│   │ Solar 15W    │              │ Solar 15W    │                   │
│   │ Batt 12V 7Ah │              │ Batt 12V 7Ah │                   │
│   └──────┬───────┘              └──────┬───────┘                   │
│          │ LoRa AS923                  │ LoRa AS923                 │
│          │                             │                            │
│          └──────────┬──────────────────┘                            │
│                     │                                               │
│                     ▼                                               │
│          ┌──────────────────┐                                       │
│          │ E870 Gateway     │                                       │
│          │ L915LG12         │                                       │
│          │ (Ethernet → LAN) │                                       │
│          └────────┬─────────┘                                       │
│                   │                                                 │
│   ZONE C (Robusta 2000m²)    │                                     │
│   ┌──────────────┐           │                                     │
│   │ Soil Sensor  │           │                                     │
│   │ (RS485)      │           │                                     │
│   └──────┬───────┘           │                                     │
│          │ RS485             │                                     │
│   ┌──────┴───────┐           │                                     │
│   │ E78 Node #3  │───────────┘                                     │
│   │ (LoRaWAN)    │                                                  │
│   │ Solar 15W    │                                                  │
│   │ Batt 12V 7Ah │                                                  │
│   └──────────────┘                                                  │
│                                                                     │
│                    ┌─────────────────────────────────────┐          │
│                    │         SERVER (Docker Stack)        │          │
│                    │  ┌─────────────────────────────┐   │          │
│                    │  │ ChirpStack → MQTT → Node-RED │   │          │
│                    │  │     → InfluxDB → Grafana     │   │          │
│                    │  │     → Smart Control (UI)     │   │          │
│                    │  └─────────────────────────────┘   │          │
│                    │                                     │          │
│                    │  ┌─────────────┐  ┌─────────────┐  │          │
│                    │  │ Pump #1     │  │ Valve A/B/C │  │          │
│                    │  │ (220V AC)   │  │ (12V DC)    │  │          │
│                    │  └─────────────┘  └─────────────┘  │          │
│                    └─────────────────────────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

# Phần B: Triển khai (Deployment)

## Phase 0: Chuẩn bị (1-2 ngày)

### Bước 0.1: Mua sắm thiết bị

- [ ] Xác nhận số lượng vùng (zone) cần triển khai
- [ ] Đặt hàng theo BOM (xem `docs/planning/hardware-bom.md`)
- [ ] Chờ giao hàng (thường 3-7 ngày)

### Bước 0.2: Chuẩn bị server

- [ ] Ubuntu 22.04 LTS (khuyến nghị) hoặc Windows với Docker Desktop
- [ ] Docker + Docker Compose cài sẵn
- [ ] Kết nối Ethernet đến router/switch
- [ ] Git clone repo: `git clone https://github.com/dinhhieudl/smartfarm-daklak.git`

### Bước 0.3: Chuẩn bị vùng đất

- [ ] Xác định vị trí lắp sensor (đại diện cho vùng canh tác)
- [ ] Đảm bảo có nguồn điện gần gateway (trong nhà)
- [ ] Xác định vị trí lắp bơm + van
- [ ] Vẽ sơ đồ đường ống tưới

---

## Phase 1: Cài đặt Server (2-3 giờ)

### Bước 1.1: Cài Docker (nếu chưa có)

```bash
# Ubuntu
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Logout + login lại
```

### Bước 1.2: Clone repo & khởi động stack

```bash
cd ~/smartfarm-daklak/server

# Kiểm tra config
ls config/
# chirpstack.toml  region_as923.toml  mosquitto.conf
# grafana/dashboards/  grafana/provisioning/
# node-red-flows.json

# Khởi động
docker compose up -d

# Kiểm tra
docker compose ps
```

### Bước 1.3: Xác minh dịch vụ

| Service | URL | Login |
|---------|-----|-------|
| ChirpStack | http://localhost:8080 | admin/admin |
| Node-RED | http://localhost:1880 | — |
| Grafana | http://localhost:3005 | admin/admin |
| InfluxDB | http://localhost:8086 | admin/admin12345 |
| Smart Control | http://localhost:3002 | — |

### Bước 1.4: Cấu hình ChirpStack

1. Mở http://localhost:8080
2. **Đổi mật khẩu admin** ngay lập tức
3. Tạo **Device Profile**:
   - Tên: `Soil-Sensor-v1`
   - Region: `AS923`
   - MAC version: `1.0.3`
   - Reg. revision: `A`
   - Class: `A`
   - Codec: Custom JavaScript decoder (xem dưới)

### Bước 1.5: Payload Decoder

Trong ChirpStack → Device Profiles → Codec tab:

```javascript
function decodeUplink(input) {
    var bytes = input.bytes;
    var decoded = {};

    if (bytes.length < 16) {
        return { errors: ['Payload too short: ' + bytes.length + ' bytes'] };
    }

    // Register 0: Temperature (signed, ÷10)
    var tempRaw = (bytes[0] << 8) | bytes[1];
    if (tempRaw > 0x7FFF) tempRaw = tempRaw - 0x10000;
    decoded.temperature = tempRaw / 10.0;

    // Register 1: Moisture (unsigned, ÷10)
    decoded.moisture = ((bytes[2] << 8) | bytes[3]) / 10.0;

    // Register 2: EC (unsigned, direct)
    decoded.ec = (bytes[4] << 8) | bytes[5];

    // Register 3: Salinity (unsigned, direct)
    decoded.salinity = (bytes[6] << 8) | bytes[7];

    // Register 4: Nitrogen (unsigned, mg/kg)
    decoded.nitrogen = (bytes[8] << 8) | bytes[9];

    // Register 5: Phosphorus (unsigned, mg/kg)
    decoded.phosphorus = (bytes[10] << 8) | bytes[11];

    // Register 6: Potassium (unsigned, mg/kg)
    decoded.potassium = (bytes[12] << 8) | bytes[13];

    // Register 7: pH (unsigned, ÷10)
    decoded.ph = ((bytes[14] << 8) | bytes[15]) / 10.0;

    return { data: decoded };
}
```

### Bước 1.6: Cấu hình InfluxDB

1. Mở http://localhost:8086
2. Login: `admin` / `admin12345`
3. Bucket: `soil_data` (đã có trong docker-compose)
4. Tạo API Token → copy
5. Org: `smarfarm`

### Bước 1.7: Cấu hình Grafana

1. Mở http://localhost:3005
2. Login: `admin` / `admin`
3. Add Data Source → InfluxDB:
   - URL: `http://influxdb:8086`
   - Token: từ Bước 1.6
   - Org: `smarfarm`
   - Bucket: `soil_data`
4. Import dashboard: `server/config/grafana/dashboards/soil-monitoring.json`

---

## Phase 2: Cấu hình Gateway (30 phút)

### Bước 2.1: Kết nối vật lý

```
E870 Gateway:
├── DC Power: 12V/2A adapter → barrel jack
├── Ethernet: LAN cable → router/switch (cùng mạng với laptop)
├── LoRa Antenna: SMA → 915MHz antenna (⚠️ GẮN TRƯỚC KHI CẤP NGUỒN!)
└── Debug (optional): USB → PC
```

### Bước 2.2: Cấu hình Packet Forwarder

**Cách A: SSH (nếu firmware hỗ trợ)**

```bash
# Tìm IP gateway
nmap -sn 192.168.1.0/24 | grep -i ebyte

# SSH
ssh root@<gateway-ip>

# Sửa config
vi /etc/lora/packet_forwarder/global_conf.json
```

```json
{
    "gateway_conf": {
        "gateway_ID": "<16-char hex từ nhãn gateway>",
        "server_address": "<IP laptop>",
        "serv_port_up": 1700,
        "serv_port_down": 1700,
        "ref_latitude": 12.667,
        "ref_longitude": 108.050,
        "ref_altitude": 500
    }
}
```

**Cách B: EByte Config Tool**

1. Tải EByte RF Setting Tool
2. Kết nối USB
3. Server address = IP laptop, Port = 1700
4. Region = AS923

### Bước 2.3: Xác minh

```bash
# Kiểm tra UDP port 1700
sudo tcpdump -i any port 1700 -n
# Nên thấy UDP packets từ gateway

# ChirpStack UI → Gateways → DakLak-GW-01
# Status: "Connected" (màu xanh)
```

---

## Phase 3: Cấu hình Node & Sensor (1-2 giờ/node)

### Bước 3.1: Test sensor trước khi lắp

```bash
# Dùng Python để test Modbus
python3 -c "
import serial
ser = serial.Serial('/dev/ttyUSB0', 9600, timeout=1)
# Read all 8 registers from address 0x0000
cmd = bytes([0x02, 0x03, 0x00, 0x00, 0x00, 0x08, 0x44, 0x0C])
ser.write(cmd)
response = ser.read(21)
print('Response:', response.hex())
ser.close()
"
```

### Bước 3.2: Cấu hình E78 Node

```bash
# Kết nối E78 qua USB/UART
# Mở terminal (115200 baud)

# Cấu hình LoRaWAN
AT+MODE=LORAWAN
AT+JOIN=OTAA
AT+DEVEUI=<từ ChirpStack>
AT+APPEUI=<từ ChirpStack>
AT+APPKEY=<từ ChirpStack>
AT+CLASS=A
AT+DR=2
AT+PORT=2

# Cấu hình Modbus polling
AT+MODBUS=1
AT+MBADDR=0x02
AT+MBFUNC=0x03
AT+MBREG=0x0000
AT+MBLEN=8
AT+MBINTV=300

# Join network
AT+JOIN=1
# Chờ ~10-30s, kiểm tra:
AT+JOIN?
# Status: Joined
```

### Bước 3.3: Đăng ký Device trong ChirpStack

1. ChirpStack → Applications → Create Application (tên: "SmartFarm")
2. Devices → Create Device:
   - DevEUI: từ E78 (`AT+DEVEUI?`)
   - Device Profile: `Soil-Sensor-v1`
   - App Key: random 16 bytes (copy vào E78)
3. Chờ node join → Status: "Active"

### Bước 3.4: Xác minh data flow

```bash
# Subscribe MQTT
mosquitto_sub -h localhost -t "application/+/device/+/event/up" -v

# Expected output:
# application/1/device/aabbccdd11223344/event/up {"data":"AhMEAAAI...", ...}
```

### Bước 3.5: Lắp đặt vật lý

```
1. Chọn vị trí sensor:
   - Đại diện cho vùng canh tác
   - Tránh bờ rào, gốc cây lớn
   - Cách bơm/đường ống ≥2m

2. Lắp sensor:
   - Đào lỗ nhỏ, vừa probe (60mm)
   - Cắm probe xuống đất, ấn chặt
   - Đảm bảo probe tiếp xúc hoàn toàn với đất

3. Lắp Node + Solar:
   - Gắn E78 trong waterproof enclosure
   - Treo trên cột/cây, cao ≥1.5m
   - Solar panel hướng Nam (Bắc bán cầu)
   - Antenna LoRa hướng lên trên

4. Bảo vệ cáp:
   - Luồn cáp RS485 trong ống PVC
   - Tránh xa khu vực耕作
```

---

## Phase 4: Data Pipeline (1 giờ)

### Bước 4.1: Import Node-RED Flow

1. Mở http://localhost:1880
2. Import flow từ `server/config/node-red-flows.json`
3. Hoặc tạo flow thủ công:

```
[MQTT In]                    [Function: Decode]           [InfluxDB Out]
  topic:                       Parse 16 bytes →             measurement: soil
  application/+/               JSON {temp, moisture,        bucket: soil_data
  device/+/event/up            ec, n, p, k, ph}             org: smarfarm
```

### Bước 4.2: Node-RED Function Node

```javascript
var bytes = Buffer.from(msg.payload, 'base64');
if (bytes.length < 16) return null;

var tempRaw = (bytes[0] << 8) | bytes[1];
if (tempRaw > 0x7FFF) tempRaw = tempRaw - 0x10000;

msg.payload = {
    temperature: tempRaw / 10.0,
    moisture: ((bytes[2] << 8) | bytes[3]) / 10.0,
    ec: (bytes[4] << 8) | bytes[5],
    salinity: (bytes[6] << 8) | bytes[7],
    nitrogen: (bytes[8] << 8) | bytes[9],
    phosphorus: (bytes[10] << 8) | bytes[11],
    potassium: (bytes[12] << 8) | bytes[13],
    ph: ((bytes[14] << 8) | bytes[15]) / 10.0
};
return msg;
```

---

## Phase 5: Dashboard & Monitoring (1 giờ)

### Bước 5.1: Grafana Dashboard

Tạo các panel:

| Panel | Type | Query |
|-------|------|-------|
| Temperature | Gauge (range: -10~50°C) | `from(bucket:"soil_data") \|> range(start:-1h) \|> filter(fn:(r) => r._field=="temperature")` |
| Moisture | Gauge (range: 0~100%) | `filter(fn:(r) => r._field=="moisture")` |
| EC | Stat | `filter(fn:(r) => r._field=="ec")` |
| NPK | Grouped Bar | `filter(fn:(r) => r._field=="nitrogen" or r._field=="phosphorus" or r._field=="potassium")` |
| pH | Gauge (range: 3~9) | `filter(fn:(r) => r._field=="ph")` |

### Bước 5.2: Smart Control Dashboard

Mở http://localhost:3002 — có sẵn:
- Tab Dashboard: Hiển thị trạng thái sensor realtime
- Tab Điều khiển: Bật/tắt bơm/van
- Tab Tư vấn: Khuyến nghị theo giai đoạn cây
- Tab Quy tắc tưới: Cấu hình ngưỡng tự động
- Tab Lịch sử: Nhật ký hoạt động
- Tab Biểu đồ: Chart.js historical charts

### Bước 5.3: Alert Rules (tùy chọn)

Trong Grafana → Alerting → Create alert rule:
- Moisture < 20% → "Đất quá khô, cần tưới"
- Temperature > 40°C → "Nhiệt độ đất quá cao"
- pH < 4.5 or pH > 8.5 → "pH đất bất thường"

---

## Phase 6: Field Deployment (1-2 ngày)

### Bước 6.1: Lắp đặt Gateway

```
1. Chọn vị trí trong nhà, gần nguồn Ethernet
2. Gắn antenna 915MHz (cao ≥3m nếu có thể)
3. Kết nối Ethernet → router
4. Cấp nguồn 12V
5. Kiểm tra ChirpStack: Gateway "Connected"
```

### Bước 6.2: Lắp đặt Nodes

```
1. Lắp sensor vào đất (xem Phase 3, Bước 3.5)
2. Kết nối RS485: E78 ↔ Sensor
3. Gắn Solar panel + Battery
4. Cấp nguồn
5. Chờ E78 join LoRaWAN (~10-30s)
6. Kiểm tra ChirpStack: Device "Active"
```

### Bước 6.3: Lắp đặt Actuators

```
1. Lắp bơm nước tại nguồn nước
2. Lắp van điện tử tại đầu mỗi đường ống
3. Kết nối Relay → Van (12V DC)
4. Kết nối Relay → Bơm (qua Contactor 220V AC)
5. Test thủ công: bật/tắt relay
```

---

## Phase 7: Testing & Validation (1 ngày)

### Bước 7.1: Test end-to-end

```bash
# 1. Gateway online?
curl -s http://localhost:8080/api/gateways | jq '.result[0].lastSeenAt'

# 2. Node joined?
# ChirpStack UI → Devices → Status = "Active"

# 3. Data arriving?
mosquitto_sub -h localhost -t "application/+/device/+/event/up" -v

# 4. Data in InfluxDB?
docker exec sf-influxdb influx query \
  'from(bucket:"soil_data") |> range(start:-1h) |> last()' \
  --org smarfarm --token <token>

# 5. Grafana dashboard?
# Mở http://localhost:3005 → Dashboard

# 6. Smart Control?
# Mở http://localhost:3002 → Login → Dashboard
```

### Bước 7.2: Test irrigation

```bash
# Test bơm thủ công qua API
curl -X POST http://localhost:3002/api/control/pump-1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"state":"on"}'

# Kiểm tra bơm hoạt động
# Tắt sau 30 giây
curl -X POST http://localhost:3002/api/control/pump-1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"state":"off"}'
```

### Bước 7.3: Test tự động

```bash
# Bật auto mode cho zone-A
curl -X POST http://localhost:3002/api/irrigation/zone-A/auto \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled":true}'

# Giảm moisture xuống dưới ngưỡng (dùng simulator)
# Kiểm tra hệ thống tự động tưới
```

---

## Checklist tổng hợp

### Server
- [ ] Docker installed
- [ ] `docker compose up -d` — tất cả containers chạy
- [ ] ChirpStack accessible, password changed
- [ ] Gateway registered in ChirpStack
- [ ] Device Profile created with payload decoder
- [ ] InfluxDB bucket + token configured
- [ ] Grafana data source + dashboard created
- [ ] Smart Control accessible

### Gateway
- [ ] Antenna attached BEFORE power on
- [ ] Ethernet connected
- [ ] Packet forwarder configured
- [ ] Gateway shows "Connected" in ChirpStack

### Node + Sensor
- [ ] Sensor wiring verified (A↔A, B↔B)
- [ ] Sensor Modbus response verified
- [ ] E78 firmware configured (AT commands)
- [ ] E78 frequency set to AS923
- [ ] OTAA credentials match ChirpStack
- [ ] E78 shows "Active" in ChirpStack

### Field
- [ ] Sensor probe fully inserted in soil
- [ ] Cable protected (conduit)
- [ ] Solar panel oriented correctly
- [ ] Gateway antenna ≥3m height
- [ ] Communication range tested
- [ ] Irrigation system tested

---

# Phần C: Kịch bản vận hành (Scenarios)

## C.1 Kịch bản vận hành thường nhật (Daily Operations)

### Mô tả
Hệ thống hoạt động tự động, polling sensor mỗi 5 phút, hiển thị dashboard realtime.

### Flow

```
Mỗi 5 phút:
  1. E78 Node đọc sensor qua RS485 Modbus
  2. E78 gửi data qua LoRaWAN (OTAA uplink)
  3. E870 Gateway nhận → forward đến ChirpStack
  4. ChirpStack decode payload (JavaScript codec)
  5. MQTT publish: application/+/device/+/event/up
  6. Node-RED: decode → write InfluxDB
  7. Smart Control: phân tích → generate advisory
  8. Dashboard cập nhật realtime (WebSocket)
```

### Điều kiện bình thường

| Parameter | Giá trị bình thường | Hành động |
|-----------|---------------------|----------|
| Moisture | 40-60% | Không cần tưới |
| Temperature | 22-32°C | Không cần làm mát |
| EC | 200-800 µS/cm | Đất bình thường |
| pH | 5.0-6.5 | Phù hợp cho cà phê |

### Alert thresholds

| Condition | Level | Action |
|-----------|-------|--------|
| Moisture < 35% | Warning | Khuyến nghị tưới |
| Moisture < 25% | Critical | Tưới ngay |
| Moisture > 65% | Warning | Kiểm tra thoát nước |
| Temperature > 38°C | Warning | Tưới làm mát, phủ rơm |
| EC > 2000 µS/cm | Critical | Tưới xả mặn |
| pH < 4.5 | Warning | Bón vôi dolomite |
| pH > 7.0 | Warning | Bón lưu huỳnh |

---

## C.2 Kịch bản Hạn hán (Drought Scenario)

### Mô tả
10 ngày không mưa, nhiệt độ cao, độ ẩm đất giảm sâu.

### Timeline

| Ngày | Nhiệt độ | Độ ẩm không khí | Mưa | Độ ẩm đất (dự kiến) | Hành động |
|------|----------|----------------|-----|---------------------|----------|
| 1-2 | 33°C | 45% | 0mm | 50% → 45% | Theo dõi |
| 3-4 | 35°C | 40% | 0mm | 45% → 38% | Tăng tưới |
| 5-6 | 37°C | 35% | 0mm | 38% → 30% | Tưới khẩn cấp |
| 7-8 | 39°C | 30% | 0mm | 30% → 22% | Tưới liên tục |
| 9-10 | 40°C | 25% | 0mm | 22% → 15% | Cấp cứu cây |

### Hành động tự động

```
Khi moisture < 35%:
  1. Smart Control phát hiện moisture thấp
  2. Kiểm tra irrigation rule: moistureMin = 35
  3. Kiểm tra cooldown (120 phút từ lần cuối)
  4. Kiểm tra rain pause (mưa > 5mm → dừng)
  5. Nếu tất cả OK → Bật pump-1 + open valve-1
  6. Ghi audit log
  7. Gửi alert: "Cần tưới cho Zone A"

Khi moisture >= 65% (moistureMax):
  1. Tắt pump-1 + close valve-1
  2. Ghi audit log
```

### Lưu ý cho cà phê trong hạn hán

| Giai đoạn | Duy trì moisture | Tần suất tưới | Ghi chú |
|-----------|-----------------|--------------|--------|
| Nghỉ (Nov-Jan) | ≥30% | 2 tuần/lần | Giữ ẩm nhẹ |
| Ra hoa (Feb-Mar) | ≥55% | 1 lần/tuần | Tưới đẫm kích thích ra hoa |
| Đậu quả (Mar-May) | ≥60% | 1-2 lần/tuần | Tưới đều |
| Phát triển quả (May-Aug) | ≥55% | 1-2 lần/tuần | Duy trì |
| Chín (Sep-Oct) | ≥40% | Giảm tưới | Giảm nước cho quả chín đều |

---

## C.3 Kịch bản Mùa mưa (Monsoon Scenario)

### Mô tả
5 ngày mưa liên tục, kiểm tra ngập úng và thoát nước.

### Timeline

| Ngày | Nhiệt độ | Mưa | Độ ẩm đất (dự kiến) | Hành động |
|------|----------|-----|---------------------|----------|
| 1 | 25°C | 15mm | 55% → 65% | Theo dõi |
| 2-3 | 24°C | 45mm | 65% → 80% | Dừng tưới, kiểm tra thoát nước |
| 4 | 23°C | 60mm | 80% → 95% | Nguy cơ ngập úng |
| 5 | 26°C | 10mm | 95% → 85% | Mưa giảm dần |

### Hành động tự động

```
Khi rainfall > rainThreshold (5mm):
  1. rainPause = true
  2. Dừng tất cả irrigation đang chạy
  3. Ghi audit log: "Rain pause activated"
  4. Gửi alert: "Mưa lớn — dừng tưới"

Khi moisture > 65% (moistureMax):
  1. Khuyến nghị kiểm tra thoát nước
  2. Không tưới thêm
```

### Lưu ý cho cà phê trong mùa mưa

| Vấn đề | Dấu hiệu | Hành động |
|--------|----------|----------|
| Ngập úng | Moisture > 85% liên tục | Mở van thoát nước, kiểm tra mương |
| Bệnh thán thư | Độ ẩm cao + nhiệt độ 20-25°C | Phun thuốc phòng trừ |
| Rụng quả non | Mưa lớn khi đậu quả | Không có cách phòng ngừa hiệu quả |
| Nhiễm mặn | EC tăng sau mưa | Tưới xả mặn |

---

## C.4 Kịch bản Nắng nóng cực đoan (Heatwave)

### Mô tả
3 ngày nhiệt độ trên 40°C, kiểm tra stress nhiệt.

### Timeline

| Ngày | Nhiệt độ | Độ ẩm | Mưa | Hành động |
|------|----------|-------|-----|----------|
| 1 | 38°C | 35% | 0mm | Tăng tưới, phủ rơm |
| 2 | 42°C | 25% | 0mm | Tưới sáng sớm + chiều muộn |
| 3 | 40°C | 30% | 0mm | Duy trì tưới |

### Hành động tự động

```
Khi temperature > 38°C:
  1. Cảnh báo stress nhiệt
  2. Khuyến nghị: Tưới làm mát, phủ rơm rạ
  3. Tăng tần suất tưới (nếu auto mode)
```

### Lưu ý cho cà phê trong nắng nóng

| Giai đoạn | Rủi ro | Hành động |
|-----------|--------|----------|
| Ra hoa | Hoa bị cháy | Tưới phun sương sáng sớm |
| Đậu quả | Rụng quả non | Tưới đủ nước, phủ rơm gốc |
| Phát triển quả | Quả nhỏ, kém chất lượng | Tăng kali (K) |
| Chín | Quả bị nứt | Che nắng, tăng tưới |

---

## C.5 Kịch bản Lỗi thiết bị (Fault Scenarios)

### C.5.1: Sensor bị treo (Sensor Stuck)

| Dấu hiệu | Giá trị không thay đổi > 30 phút |
|-----------|--------------------------------|
| Nguyên nhân | Mất điện, connector lỏng, sensor hỏng |
| Hành động | Gửi alert "Sensor lost — kiểm tra Zone X" |
| Recovery | Kiểm tra wiring, thay sensor nếu cần |

### C.5.2: Sensor trôi giá trị (Sensor Drift)

| Dấu hiệu | Giá trị thay đổi bất thường, không theo physics |
|-----------|----------------------------------------------|
| Nguyên nhân | Nhiễu điện từ, tuổi thọ sensor |
| Hành động | Flag data as "uncertain", giảm confidence |
| Recovery | Calibrate lại sensor |

### C.5.3: Gateway mất kết nối (Gateway Down)

| Dấu hiệu | Không có data mới > 10 phút |
|-----------|---------------------------|
| Nguyên nhân | Mất điện, crash, network issue |
| Hành động | Gửi alert "Gateway offline" |
| Recovery | Restart gateway, kiểm tra Ethernet |

### C.5.4: Node mất kết nối (Node Lost)

| Dấu hiệu | Không có data từ 1 node > 30 phút |
|-----------|----------------------------------|
| Nguyên nhân | Mất pin, antenna hỏng, node hỏng |
| Hành động | Gửi alert "Node offline — Zone X" |
| Recovery | Kiểm tra pin, antenna, thay node nếu cần |

### C.5.5: Bơm/Van lỗi (Actuator Fault)

| Dấu hiệu | Bơm không chạy khi nhận lệnh |
|-----------|---------------------------|
| Nguyên nhân | Mất điện, relay hỏng, bơm hỏng |
| Hành động | Gửi alert "Actuator fault — Pump/Van X" |
| Recovery | Kiểm tra relay, thay bơm/van |

---

## C.6 Kịch bản Tối ưu năng lượng (Solar/Battery)

### Mô tả
Node hoạt động bằng solar panel + battery, cần tối ưu năng lượng.

### Chu kỳ hoạt động

```
Mỗi 5 phút:
  1. Wake up (10µA → 45mA trong ~2s)
  2. Đọc sensor qua RS485 (~0.1s, 25mA)
  3. Encode payload (16 bytes)
  4. Gửi LoRaWAN uplink (~2s, 45mA)
  5. Chờ RX window (~1s)
  6. Deep sleep (~45s, 10µA)
```

### Power budget

| Phase | Duration | Current | Energy |
|-------|----------|---------|--------|
| Wake | 10ms | 45mA | 0.00016 Wh |
| Sensor read | 100ms | 25mA | 0.000086 Wh |
| LoRa TX | 2s | 45mA | 0.000025 Wh |
| RX window | 1s | 45mA | 0.000013 Wh |
| Deep sleep | 297s | 10µA | 0.000001 Wh |
| **Total/cycle** | 5 min | | **0.0003 Wh** |
| **Total/day** | 288 cycles | | **0.08 Wh** |

### Battery sizing

```
Battery: 12V 7Ah = 84 Wh
Daily consumption: 0.08 Wh
Autonomy without sun: 84 / 0.08 = 1,050 ngày (!)

Thực tế:_consumption cao hơn do wake-up overhead
Conservative estimate: 30 ngày without sun
```

---

## C.7 Kịch bản Đa vùng (Multi-Zone)

### Mô tả
3 vùng với loại cà phê và quy trình tưới khác nhau.

| Zone | Crops | Area | Moisture Target | Irrigation Rule |
|------|-------|------|----------------|----------------|
| Zone A | Robusta | 5000m² | 35-65% | moistureMin=35, moistureMax=65 |
| Zone B | Arabica | 3000m² | 40-70% | moistureMin=40, moistureMax=70 |
| Zone C | Robusta | 2000m² | 35-65% | moistureMin=35, moistureMax=65 |

### Priority scheduling

```
Nhiều zone cần tưới cùng lúc:
  1. Zone có moisture thấp nhất → ưu tiên cao nhất
  2. Nếu cùng moisture → theo diện tích (lớn hơn trước)
  3. Bơm chạy lần lượt: Zone A (10 phút) → Zone B (8 phút) → Zone C (5 phút)
  4. Cooldown giữa các zone: 5 phút
```

### Config hiện tại (chỉ zone-A)

```json
// smart-control/config/zones.json
[
  {
    "id": "zone-A",
    "name": "Khu A — Cà phê Robusta",
    "area": 5000,
    "crop": "robusta",
    "plantDate": "2024-04-15",
    "soilType": "bazan-red",
    "pumpId": "pump-1",
    "valveId": "valve-1",
    "moistureSensor": "aabbccdd11223344"
  }
]
```

### Cần thêm cho multi-zone

```json
// zones.json (3 zones)
[
  { "id": "zone-A", "name": "Khu A — Robusta", "area": 5000, "crop": "robusta",
    "pumpId": "pump-1", "valveId": "valve-1", "moistureSensor": "aabbccdd11223344" },
  { "id": "zone-B", "name": "Khu B — Arabica", "area": 3000, "crop": "arabica",
    "pumpId": "pump-1", "valveId": "valve-2", "moistureSensor": "bbaaccee22334455" },
  { "id": "zone-C", "name": "Khu C — Robusta", "area": 2000, "crop": "robusta",
    "pumpId": "pump-2", "valveId": "valve-3", "moistureSensor": "ccbbddff33445566" }
]

// actuators.json (2 pumps, 3 valves)
{
  "pump-1": { "id": "pump-1", "name": "Bơm chính #1", "type": "pump", "state": "off", "flowRate": 50 },
  "pump-2": { "id": "pump-2", "name": "Bơm phụ #2", "type": "pump", "state": "off", "flowRate": 30 },
  "valve-1": { "id": "valve-1", "name": "Van khu A", "type": "valve", "state": "closed", "zone": "zone-A" },
  "valve-2": { "id": "valve-2", "name": "Van khu B", "type": "valve", "state": "closed", "zone": "zone-B" },
  "valve-3": { "id": "valve-3", "name": "Van khu C", "type": "valve", "state": "closed", "zone": "zone-C" }
}
```

---

## C.8 Kịch bản Tư vấn cây trồng (Crop Advisory)

### Mô tả
Hệ thống tự động nhận diện giai đoạn cây và đưa ra khuyến nghị.

### Giai đoạn cây cà phê Robusta

| Tháng | Giai đoạn | Moisture Target | Tần suất tưới | Phân bón | Rủi ro |
|-------|-----------|----------------|--------------|---------|--------|
| 11-1 | Nghỉ (Rụng lá) | 30% | 2 tuần/lần | Phân chuồng + vôi | Sâu bệnh, đất khô nứt |
| 2-3 | Ra hoa | 55% | 1 lần/tuần | Lân (P) cao | Mưa trái mùa, thiếu nước |
| 3-5 | Đậu quả | 60% | 1-2 lần/tuần | NPK 20-10-10 | Rụng quả non, thiếu Kali |
| 5-8 | Phát triển quả | 55% | 1-2 lần/tuần | Kali (K) cao | Ngập úng, bệnh thán thư |
| 9-10 | Chín | 40% | Giảm tưới | Kali nhẹ | Quả thối, chín không đều |
| 10-11 | Thu hoạch | 35% | Phục hồi | Phân phục hồi | Thiếu nhân công |

### Giai đoạn cây cà phê Arabica

| Tháng | Giai đoạn | Moisture Target | Tần suất tưới | Phân bón | Rủi ro |
|-------|-----------|----------------|--------------|---------|--------|
| 11-1 | Nghỉ | 30% | 2 tuần/lần | Phân chuồng + vôi | Sâu bệnh |
| 2-3 | Ra hoa | 55% | 1 lần/tuần | Lân cao | Mưa trái mùa |
| 3-4 | Đậu quả | 60% | 1 lần/tuần | NPK 20-10-10 | Rụng quả, bệnh gỉ sắt |
| 4-8 | Phát triển quả | 60% | 2 lần/tuần | Kali cao | Stress nhiệt, thiếu nước |
| 9-10 | Chín | 45% | Giảm | Kali nhẹ | Quả thối nếu mưa |
| 10-11 | Thu hoạch | 35% | Phục hồi | Phục hồi | Nhân công |

### API endpoints cho advisory

```
GET /api/advisory/:zoneId
→ Trả về:
{
  "advices": [
    { "type": "irrigation", "icon": "💧", "message": "...", "action": "..." },
    { "type": "soil", "icon": "⚗️", "message": "...", "action": "..." }
  ],
  "urgency": "info|warning|critical",
  "stage": { "id": "fruit-growth", "name": "Phát triển quả" }
}
```

---

## C.9 Kịch bản Simulator (Test không cần hardware)

### Mô tả
Dùng simulator để test toàn bộ hệ thống mà không cần sensor thật.

### Cài đặt

```bash
cd simulator
npm install
npm start
# Simulator chạy tại http://localhost:3001
```

### Kịch bản có sẵn

| Scenario | Mô tả | Tốc độ |
|----------|-------|--------|
| `normal` | Hoạt động bình thường | 1x |
| `drought_10day` | Hạn hán 10 ngày | 1440x (1 ngày = 1 phút) |
| `monsoon_5day` | Mùa mưa 5 ngày | 1440x |
| `heatwave_3day` | Nắng nóng 3 ngày | 1440x |
| `sensor_fault_sequence` | Chuỗi lỗi cảm biến | 60x |
| `gateway_failure` | Lỗi gateway | 60x |
| `deep_sleep_cycle` | Chu kỳ deep sleep | 360x |
| `full_day_daklak` | 1 ngày đầy đủ | 3600x (24h = 24s) |
| `nutrient_depletion` | Cạn kiệt dinh dưỡng | 1440x |

### Chạy simulator

```bash
# Normal mode
node simulator/server.js

# Chọn scenario qua API
curl -X POST http://localhost:3001/api/scenario \
  -H "Content-Type: application/json" \
  -d '{"scenario": "drought_10day"}'

# Hoặc qua CLI
node simulator/cli.js --scenario drought_10day
```

### Kết nối simulator ↔ smart-control

```bash
# Simulator publishes to MQTT: mqtt://localhost:1883
# Topic: application/smartfarm-daklak/device/aabbccdd11223344/event/up

# Smart Control subscribes và xử lý tự động
```

---

## C.10 Kịch bản Backup & Recovery

### Backup định kỳ

```bash
# Backup InfluxDB
docker exec sf-influxdb influx backup /tmp/backup --org smarfarm --token <token>
docker cp sf-influxdb:/tmp/backup ./backup/influxdb-$(date +%Y%m%d)

# Backup Postgres
docker exec sf-postgres pg_dump -U chirpstack chirpstack > ./backup/postgres-$(date +%Y%m%d).sql

# Backup configs
tar -czf ./backup/config-$(date +%Y%m%d).tar.gz \
  server/config/ smart-control/config/ simulator/
```

### Recovery

```bash
# Restore InfluxDB
docker cp ./backup/influxdb-YYYYMMDD sf-influxdb:/tmp/restore
docker exec sf-influxdb influx restore /tmp/restore --org smarfarm --token <token>

# Restore Postgres
docker exec -i sf-postgres psql -U chirpstack chirpstack < ./backup/postgres-YYYYMMDD.sql
```

---

## Tóm tắt

| Phần | Nội dung | Thời gian ước tính |
|------|----------|-------------------|
| Phần A | Hardware cần thiết | — |
| Phần B Phase 0 | Chuẩn bị | 1-2 ngày |
| Phần B Phase 1 | Cài đặt Server | 2-3 giờ |
| Phần B Phase 2 | Cấu hình Gateway | 30 phút |
| Phần B Phase 3 | Cấu hình Node & Sensor | 1-2 giờ/node |
| Phần B Phase 4 | Data Pipeline | 1 giờ |
| Phần B Phase 5 | Dashboard & Monitoring | 1 giờ |
| Phần B Phase 6 | Field Deployment | 1-2 ngày |
| Phần B Phase 7 | Testing & Validation | 1 ngày |
| **Tổng** | | **5-7 ngày** |
| Phần C | Kịch bản vận hành | Ongoing |

---

> **Tài liệu liên quan:**
> - `docs/planning/hardware-bom.md` — Bill of Materials chi tiết
> - `docs/planning/system-architecture.md` — Kiến trúc hệ thống
> - `docs/planning/connectivity-plan.md` — Kế hoạch kết nối
> - `docs/planning/deployment-guide.md` — Hướng dẫn triển khai
> - `docs/hardware/` — Datasheet các thiết bị
