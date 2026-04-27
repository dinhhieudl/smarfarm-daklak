# Deployment Guide - SmartFarm DakLak

> Complete step-by-step deployment from hardware setup to live dashboard
> Last updated: 2026-04-27

---

## ⚠️ CRITICAL: Kiến trúc không tương thích

Trước khi triển khai, cần hiểu một vấn đề quan trọng:

```
┌─────────────┐                          ┌─────────────┐
│  E90-DTU    │  LoRa raw (transparent)  │  E870       │
│  900SL22    │ ──────────────────────▶  │  L915LG12   │
│             │                          │             │
│  NOT LoRaWAN│  ❌ KHÔNG TƯƠNG THÍCH    │  LoRaWAN    │
│  Protocol   │                          │  Only       │
└─────────────┘                          └─────────────┘
```

**Lý do:**
- **E90-DTU(900SL22)** là LoRa radio "trần" — gửi raw LoRa packets, không có LoRaWAN MAC layer
- **E870-L915LG12** là LoRaWAN gateway — chipset SX1302 chỉ demodulate LoRaWAN frames
- Hai thiết bị **nói 2 ngôn ngữ khác nhau** trên cùng tần số

**Giải pháp (chọn 1):**

| Option | Thay đổi | Chi phí | Khuyến nghị |
|--------|----------|---------|-------------|
| **A** | Giữ E870, thay E90-DTU bằng LoRaWAN node (RAK3172, STM32WL, SenseCAP) | ~$15-30/node | ⭐ Khuyến nghị nhất |
| **B** | Giữ E90-DTU, thay E870 bằng raw LoRa gateway (Raspberry Pi + SX1276, hoặc RAK7248) | ~$50-80 | Nếu muốn giữ E90-DTU |
| **C** | Thêm MCU trung gian (STM32 + LoRa module) giữa sensor và gateway | ~$10-20 | DIY, phức tạp hơn |

**Hướng dẫn dưới đây giả định chọn Option A** (giữ E870 gateway, thay node bằng LoRaWAN module).

---

## Tổng quan kiến trúc triển khai

```
                        VƯỜN (Outdoor)                    NHÀ (Indoor)
                   ┌──────────────────────┐         ┌──────────────────────┐
                   │                      │         │                      │
                   │  ┌────────────────┐  │  LoRa   │  ┌────────────────┐  │
                   │  │ Soil Sensor    │  │ AS923   │  │ E870 Gateway   │  │
                   │  │ (Temp/Moisture │  │         │  │ L915LG12       │  │
                   │  │  /EC/NPK/pH)  │  │         │  │                │  │
                   │  └───────┬────────┘  │         │  └───────┬────────┘  │
                   │          │ RS485     │         │          │ Ethernet  │
                   │  ┌───────┴────────┐  │         │  ┌───────┴────────┐  │
                   │  │ LoRaWAN Node   │  │────────▶│  │ Router/Switch  │  │
                   │  │ (RAK3172 or    │  │         │  └───────┬────────┘  │
                   │  │  STM32WL)      │  │         │          │           │
                   │  └───────┬────────┘  │         │          │ WiFi/LAN  │
                   │          │ Power     │         │          │           │
                   │  ┌───────┴────────┐  │         │  ┌───────┴────────┐  │
                   │  │ Solar Panel    │  │         │  │ Laptop/Server  │  │
                   │  │ + Battery      │  │         │  │ (Docker)       │  │
                   │  └────────────────┘  │         │  │                │  │
                   │                      │         │  │ ChirpStack     │  │
                   └──────────────────────┘         │  │ Node-RED       │  │
                                                    │  │ InfluxDB       │  │
                                                    │  │ Grafana        │  │
                                                    │  └────────────────┘  │
                                                    └──────────────────────┘
```

---

## Phase 1: Server Setup (Laptop/Desktop)

### Bước 1.1: Cài Docker

```bash
# Cài Docker (nếu chưa có)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Logout + login lại
```

### Bước 1.2: Clone repo và khởi động server stack

```bash
cd ~/smartfarm-daklak/server

# Kiểm tra file cấu hình đã có sẵn
ls config/
# chirpstack.toml  region_as923.toml  mosquitto.conf
# grafana/dashboards/  grafana/provisioning/
# node-red-flows.json

# Khởi động toàn bộ stack
docker compose up -d

# Kiểm tra tất cả containers đang chạy
docker compose ps
```

### Bước 1.3: Xác minh các dịch vụ

| Service | URL | Login |
|---------|-----|-------|
| ChirpStack | http://localhost:8080 | admin/admin |
| Node-RED | http://localhost:1880 | — |
| Grafana | http://localhost:3000 | admin/admin |
| InfluxDB | http://localhost:8086 | admin/admin12345 |

```bash
# Test MQTT
mosquitto_sub -h localhost -t "application/#" -v &
# (sẽ có data khi sensor hoạt động)
```

### Bước 1.4: Cấu hình ChirpStack

1. Mở http://localhost:8080
2. **Đổi mật khẩu admin** ngay lập tức
3. Tạo **Device Profile**:
   - Tên: `Soil-Sensor-v1`
   - Region: `AS923`
   - MAC version: `1.0.3` (hoặc `1.0.4`)
   - Reg. revision: `A`
   - Class: `A` (nếu sensor chỉ gửi định kỳ)
   - Codec: `Custom JavaScript decoder` (xem Bước 1.5)

4. Tạo **Gateway**:
   - Gateway ID: in trên nhãn E870 (16 hex chars)
   - Tên: `DakLak-GW-01`
   - Region: `AS923`

### Bước 1.5: Viết Payload Decoder (JavaScript)

Trong ChirpStack → Device Profiles → Codec tab:

```javascript
// Decode uplink payload from soil sensor
// Payload: 16 bytes (8 registers × 2 bytes, big-endian)
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
3. Tạo **Bucket**: `soil_data` (đã có trong docker-compose)
4. Tạo **API Token** → copy token để dùng trong Node-RED
5. Org: `smarfarm` (đã cấu hình sẵn)

### Bước 1.7: Cấu hình Grafana

1. Mở http://localhost:3000
2. Login: `admin` / `admin` → đổi mật khẩu
3. **Add Data Source** → InfluxDB:
   - URL: `http://influxdb:8086`
   - Token: token từ Bước 1.6
   - Org: `smarfarm`
   - Bucket: `soil_data`
4. **Import Dashboard**:
   - File: `server/config/grafana/dashboards/soil-monitoring.json`
   - Hoặc tạo dashboard mới với panels:
     - Temperature (gauge + time series)
     - Moisture % (gauge + time series)
     - EC (µS/cm)
     - NPK (grouped bar chart)
     - pH (gauge, range 3-9)

---

## Phase 2: Gateway Setup (E870-L915LG12)

### Bước 2.1: Kết nối vật lý

```
E870 Gateway:
├── DC Power: 12V/1A adapter → barrel jack
├── Ethernet: LAN cable → router/switch (cùng mạng với laptop)
├── LoRa Antenna: SMA connector → 915MHz antenna (QUAN TRỌNG: phải có antenna trước khi cấp nguồn!)
└── Debug (optional): USB → PC
```

⚠️ **CẢNH BÁO: Không bật nguồn E870 mà chưa gắn antenna LoRa! Có thể cháy bộ khuếch đại công suất.**

### Bước 2.2: Cấu hình Packet Forwarder

Cách cấu hình phụ thuộc vào firmware của E870:

**Cách A: SSH vào gateway (nếu firmware hỗ trợ)**
```bash
# Tìm IP của gateway
# (kiểm tra router DHCP lease, hoặc dùng nmap)
nmap -sn 192.168.1.0/24 | grep -i ebyte

# SSH vào gateway (default credentials xem manual)
ssh root@<gateway-ip>

# Cấu hình packet forwarder
vi /etc/lora/packet_forwarder/global_conf.json
```

```json
{
    "gateway_conf": {
        "gateway_ID": "<16-char hex ID từ nhãn gateway>",
        "server_address": "<IP laptop của bạn>",
        "serv_port_up": 1700,
        "serv_port_down": 1700,
        "ref_latitude": 12.667,
        "ref_longitude": 108.050,
        "ref_altitude": 500
    }
}
```

**Cách B: Dùng EByte Config Tool qua USB**
1. Tải EByte RF Setting Tool từ ebyte.com
2. Kết nối gateway qua USB
3. Cấu hình server address = IP laptop
4. Cổng UDP = 1700
5. Region = AS923

### Bước 2.3: Xác minh gateway kết nối

```bash
# Trên laptop - kiểm tra UDP port 1700
sudo tcpdump -i any port 1700 -n
# Nên thấy UDP packets từ gateway IP

# Trên ChirpStack UI → Gateways → DakLak-GW-01
# Status nên hiển thị "Connected" (màu xanh)
```

---

## Phase 3: Node Setup (LoRaWAN Node)

### Bước 3.1: Chọn LoRaWAN Node

Gợi ý (chọn 1):

| Node | Chip | Giao tiếp | Giá | Ưu điểm |
|------|------|-----------|-----|---------|
| **RAK3172** | STM32WLE5 | UART, RS485 breakout | ~$12 | Rất dễ dùng, AT command, SDK tốt |
| **RAK4631** | nRF52840 + SX1262 | UART, I2C, SPI | ~$20 | WisBlock ecosystem, nhiều module mở rộng |
| **SenseCAP S2100** | — | RS485, 4-20mA | ~$35 | Đóng gói sẵn, IP66, có RS485 tích hợp |
| **STM32WL** | STM32WLE5 | UART, SPI | ~$8 | Rẻ nhất, nhưng cần tự code firmware |

**Khuyến nghị: RAK3172** — có AT command set, dễ tích hợp RS485 Modbus, tài liệu phong phú.

### Bước 3.2: Kết nối Node ↔ Sensor

```
┌──────────────────┐          ┌──────────────────┐
│  LoRaWAN Node    │          │  Soil Sensor     │
│  (RAK3172)       │          │                  │
│                  │  RS485   │                  │
│  TX  ────────────┼── A ────┼── A              │
│  RX  ────────────┼── B ────┼── B              │
│  GND ────────────┼── GND ──┼── GND            │
│  VCC ────────────┼── 12V ──┼── VCC            │
│                  │          │                  │
│  LoRa Antenna    │          │  Probes (trong   │
│  ┌─────────┐     │          │   đất)           │
│  │ 915MHz  │     │          │                  │
│  └─────────┘     │          │                  │
└──────────────────┘          └──────────────────┘

Nếu node không có RS485 tích hợp:
┌──────────────────┐     ┌──────────┐     ┌──────────────────┐
│  LoRaWAN Node    │     │ MAX485   │     │  Soil Sensor     │
│  UART TX ────────┼────▶│ DI       │     │                  │
│  UART RX ◀───────┼─────│ RO       │     │                  │
│  GPIO  ──────────┼────▶│ DE/RE    │     │                  │
│                  │     │          │────▶│  RS485 A/B       │
└──────────────────┘     └──────────┘     └──────────────────┘
```

### Bước 3.3: Firmware cho LoRaWAN Node

**Nếu dùng RAK3172 (AT Command mode):**

```c
// RAK3172 AT Command sequence để join LoRaWAN và gửi data

// 1. Cấu hình LoRaWAN (chỉ 1 lần)
AT+NJM=1                    // OTAA join mode
AT+DEVEUI=<your-dev-eui>    // Device EUI từ ChirpStack
AT+APPEUI=<your-app-eui>    // Application EUI
AT+APPKEY=<your-app-key>    // App Key (16 bytes)
AT+CLASS=A                  // Class A
AT+DR=2                     // Data Rate (AS923 DR2 = SF10/125kHz)
AT+BAND=7                   // AS923 band

// 2. Join network
AT+JOIN=1

// 3. Gửi sensor data (mỗi 5 phút)
// Read Modbus → encode 16 bytes → send via LoRaWAN
AT+SEND=2:020300000008440C
// (hex payload = Modbus response, port 2)
```

**Nếu tự viết firmware (STM32WL / Arduino):**

```c
// Pseudo-code cho sensor polling + LoRaWAN send

void loop() {
    // 1. Đọc sensor qua RS485 Modbus
    SoilSensorData_t data;
    readSoilSensor(&data);  // Modbus RTU: 02 03 00 00 00 08

    // 2. Encode thành 16 bytes
    uint8_t payload[16];
    encodePayload(&data, payload);

    // 3. Gửi qua LoRaWAN (OTAA, confirmed uplink)
    lora_send(payload, 16, 2);  // port 2

    // 4. Sleep 5 phút
    low_power_sleep(300000);
}
```

### Bước 3.4: Đăng ký Device trong ChirpStack

1. ChirpStack → Applications → Create Application (tên: "SmartFarm")
2. Devices → Create Device:
   - DevEUI: từ node (in nhãn hoặc `AT+DEVEUI?`)
   - Device Profile: `Soil-Sensor-v1` (tạo ở Bước 1.4)
   - App Key: random 16 bytes (copy vào node config)
3. Chờ node join (OTAA) → Status chuyển sang "Active"

### Bước 3.5: Xác minh data flow

```bash
# Subscribe MQTT để xem raw data
mosquitto_sub -h localhost -t "application/+/device/+/event/up" -v

# Expected output:
# application/1/device/xxxx/event/up {"data":"AhMEAAAI...", ...}
```

---

## Phase 4: Data Pipeline (Node-RED)

### Bước 4.1: Import Node-RED Flow

1. Mở http://localhost:1880
2. Import flow từ file `server/config/node-red-flows.json`
3. Hoặc tạo flow thủ công:

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

### Bước 4.2: Node-RED Function Node (Decode)

```javascript
// Input: msg.payload = base64 encoded sensor data
// Output: msg.payload = JSON object

var bytes = Buffer.from(msg.payload, 'base64');

if (bytes.length < 16) {
    node.warn("Payload too short: " + bytes.length);
    return null;

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

### Bước 4.3: Node-RED → InfluxDB Config

```
InfluxDB Out node:
  - URL: http://influxdb:8086
  - Token: <token từ Bước 1.6>
  - Org: smarfarm
  - Bucket: soil_data
  - Measurement: soil
  - Fields: temperature, moisture, ec, salinity, nitrogen, phosphorus, potassium, ph
```

---

## Phase 5: Monitoring (Grafana)

### Bước 5.1: Tạo Dashboard

Panels gợi ý:

| Panel | Type | Query |
|-------|------|-------|
| Temperature | Gauge (range: -10~50°C) | `from(bucket: "soil_data") \|> range(start: -1h) \|> filter(fn: (r) => r._field == "temperature")` |
| Moisture | Gauge (range: 0~100%) | `filter(fn: (r) => r._field == "moisture")` |
| EC | Stat | `filter(fn: (r) => r._field == "ec")` |
| NPK | Grouped Bar | `filter(fn: (r) => r._field == "nitrogen" or r._field == "phosphorus" or r._field == "potassium")` |
| pH | Gauge (range: 3~9) | `filter(fn: (r) => r._field == "ph")` |
| All params | Time Series | Multiple fields on same chart |

### Bước 5.2: Alert Rules (tùy chọn)

Trong Grafana → Alerting → Create alert rule:
- Moisture < 20% → "Đất quá khô, cần tưới"
- Temperature > 40°C → "Nhiệt độ đất quá cao"
- pH < 4.5 or pH > 8.5 → "pH đất bất thường"

---

## Phase 6: Field Deployment

### Bước 6.1: Vật lý lắp đặt

```
                    ┌─ Antenna 915MHz (cao ≥3m)
                    │
    ┌───────────────┼───────────────┐
    │   E870        │               │
    │   Gateway ────┤── Ethernet ─── Router ─── Laptop
    │   (trong nhà) │               │
    └───────────────┘               │
                                    │
           ~~~~~~~~~~ LoRa ~~~~~~~~~│~~~~ (tầm 1-3km)
                                    │
    ┌───────────────────────────────┘
    │
    │   ┌─────────────────────┐
    │   │ E90-DTU / LoRa Node │ (ngoài vườn)
    │   │ + Solar Panel       │
    │   └────────┬────────────┘
    │            │ RS485 (2m cable)
    │   ┌────────┴────────────┐
    │   │ Soil Sensor         │
    │   │ (cắm xuống đất)     │
    │   │ Probe 60mm depth    │
    │   └─────────────────────┘
```

### Bước 6.2: Lắp sensor

1. **Chọn vị trí**: đại diện cho khu vực canh tác, tránh bờ rào, gốc cây
2. **Đào lỗ nhỏ**: nông, vừa probe (60mm)
3. **Cắm sensor**: probe 316L stainless steel vào đất, ấn chặt
4. **Đảm bảo probe tiếp xúc hoàn toàn** với đất (không có khe hở)
5. **Cáp RS485**: luồn trên cao hoặc chôn ống bảo vệ, tránh bị cắt

### Bước 6.3: Nguồn điện cho Node

**Option A: Nguồn điện trực tiếp** (nếu gần nhà)
- 12V DC adapter qua cáp điện

**Option B: Solar** (nếu xa nhà)
```
Solar Panel 10W ──▶ Charge Controller PWM ──▶ Battery 12V 7Ah ──▶ E90-DTU + Sensor
```

### Bước 6.4: Kiểm tra cuối cùng

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

# 5. Grafana dashboard showing data?
# Mở http://localhost:3000 → Dashboard
```

---

## Troubleshooting

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Gateway không kết nối | Firewall block UDP 1700 | `sudo ufw allow 1700/udp` |
| Node không join | Sai AppKey/DevEUI | Kiểm tra lại credentials trong ChirpStack |
| Node không join | Tần số không khớp | Verify E90-DTU freq = AS923 (923.2 MHz) |
| Sensor trả về 0 | Sai Modbus address | Dùng ModScan32 test trực tiếp, verify addr=0x02 |
| Sensor timeout | Sai baud rate | Sensor default = 9600, verify node UART config |
| Data sai giá trị | Byte order mismatch | Check decoder: big-endian vs little-endian |
| Grafana no data | InfluxDB token sai | Regenerate token, update Node-RED config |
| Phạm vi LoRa ngắn | Antenna không đúng | Dùng antenna 915MHz, đặt cao ≥3m, LOS |

---

## Checklist triển khai

### Server
- [ ] Docker installed
- [ ] `docker compose up -d` — all 7 containers running
- [ ] ChirpStack accessible, password changed
- [ ] Gateway registered in ChirpStack
- [ ] Device Profile created with payload decoder
- [ ] InfluxDB bucket + token configured
- [ ] Grafana data source + dashboard created

### Gateway
- [ ] Antenna attached BEFORE power on
- [ ] Ethernet connected to same network as laptop
- [ ] Packet forwarder configured (server IP = laptop IP, port 1700)
- [ ] Gateway shows "Connected" in ChirpStack

### Node + Sensor
- [ ] Sensor wiring verified (A↔A, B↔B, VCC, GND)
- [ ] Sensor Modbus response verified (ModScan32 or multimeter)
- [ ] Node firmware flashed / AT commands configured
- [ ] Node frequency set to AS923 (923.2 MHz)
- [ ] Node OTAA credentials match ChirpStack device config
- [ ] Node shows "Active" in ChirpStack

### Field
- [ ] Sensor probe fully inserted in soil
- [ ] Cable protected (conduit or overhead)
- [ ] Solar panel oriented south (if used)
- [ ] Gateway antenna ≥3m height, clear of metal
- [ ] Communication range tested at deployment site
