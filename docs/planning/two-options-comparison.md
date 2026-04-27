# Hai Phương Án Triển Khai - SmartFarm DakLak

> Cập nhật: 2026-04-27
> Hardware: E870-L915LG12 (gateway) + Soil Sensor (RS485 Modbus)

---

## So sánh tổng quan

| | **Phương án A: E78** | **Phương án B: E90-DTU** |
|---|---|---|
| **Node** | E78-DTU(900LN22) — LoRaWAN node | E90-DTU(900SL22) — Raw LoRa radio |
| **Gateway** | E870-L915LG12 ✅ giữ nguyên | E870 ❌ → phải thay bằng raw LoRa GW |
| **Protocol** | LoRaWAN (chuẩn) | Raw LoRa (transparent) |
| **Chi phí thêm** | ~$25-35 (mua E78-DTU) | ~$50-80 (mua raw LoRa gateway mới) |
| **Độ phức tạp** | Thấp (plug & play) | Trung bình (cần config thêm) |
| **Tính năng** | OTAA, ADR, confirmed uplink, duty cycle | Point-to-point, đơn giản, không có MAC layer |
| **Khuyến nghị** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## Phương án A: Dùng E78 (Khuyến nghị)

### E78 là gì?

E78 là dòng sản phẩm LoRaWAN của Ebyte, gồm nhiều biến thể:

| Sản phẩm | Loại | Chip | Giao tiếp | Ghi chú |
|----------|------|------|-----------|---------|
| **E78-DTU(900LN22)** | DTU hoàn chỉnh | 6601 (Cortex-M4) | RS485, UART | ⭐ **Chọn cái này** |
| E78-900M22S1A | Module SMD | ASR6505 | UART, SPI | Cần thiết kế PCB |
| E78-900TBL-01A | Test board | ASR6505 | USB | Chỉ để đánh giá |

### E78-DTU(900LN22) Specs

```
┌─────────────────────────────────────────────────┐
│  E78-DTU(900LN22)                                │
│                                                  │
│  Chip:        6601 (ARM Cortex-M4)              │
│  Protocol:    LoRaWAN 1.0.3                      │
│  Frequency:   868/915 MHz (AS923 compatible)     │
│  TX Power:    22 dBm (0.16W)                     │
│  Range:       ~3 km (line of sight)              │
│  Interface:   RS485 + UART                       │
│  Size:        100 × 84 × 25 mm                  │
│  Weight:      120g                               │
│  Join:        OTAA / ABP                         │
│  Features:    Modbus passthrough, AT command     │
└─────────────────────────────────────────────────┘
```

### Kiến trúc

```
VƯỜN                              NHÀ
┌──────────────────────┐    ┌──────────────────────┐
│ Soil Sensor          │    │ E870 Gateway         │
│ (RS485 Modbus)       │    │ (LoRaWAN)            │
│                      │    │                      │
│  VCC GND A B         │    │  LoRa Antenna        │
│  └──┬──┘ │ │         │    │  ┌───┐               │
│     │    │ │  RS485   │    │  │915│               │
│     │    │ │          │    │  └───┘               │
│  ┌──┴────┴─┴──┐      │    │  Ethernet → Router   │
│  │ E78-DTU    │      │    └──────────┬───────────┘
│  │ (900LN22)  │      │               │
│  │            │ LoRa │               │ LAN
│  │ LoRaWAN ◄──┼──────┼───────────────┘
│  │ OTAA join  │      │
│  │ RS485 ◄────┤      │    ┌──────────────────────┐
│  └────────────┘      │    │ Laptop (Docker)      │
│                      │    │                      │
│  Solar + Battery     │    │ ChirpStack ← E870    │
└──────────────────────┘    │ Node-RED → InfluxDB  │
                            │ Grafana Dashboard    │
                            └──────────────────────┘
```

### Tại sao E78 tương thích với E870?

```
E78-DTU                              E870 Gateway
┌──────────┐                         ┌──────────┐
│ LoRaWAN  │   LoRaWAN Protocol      │ LoRaWAN  │
│ Stack    │ ◀═══════════════════════▶│ Stack    │
│ (6601)   │   AS923 frequency       │ (SX1302) │
│          │   OTAA join             │          │
│ "Nói     │   Uplink/Downlink       │ "Nói     │
│  LoRaWAN"│                         │  LoRaWAN"│
└──────────┘                         └──────────┘
     ✅ CÙNG NGÔN NGỮ — TƯƠNG THÍCH
```

### Triển khai chi tiết

**Bước 1: Cấu hình E78-DTU**

Kết nối E78-DTU vào PC qua RS485/USB adapter, dùng AT command:

```
AT+MODE=LORAWAN           // Chế độ LoRaWAN
AT+JOIN=OTAA              // OTAA join mode
AT+DEVEUI=xxxxxxxx        // DevEUI (16 hex, từ ChirpStack)
AT+APPEUI=xxxxxxxx        // AppEUI (16 hex)
AT+APPKEY=xxxxxxxxxxxxxxxx // AppKey (32 hex)
AT+CLASS=A                // Class A (tiết kiệm pin)
AT+DR=2                   // Data Rate (AS923 DR2)
AT+PORT=2                 // Uplink port
AT+TXC=2                  // Số lần retry
AT+JOIN=1                 // Bắt đầu join
```

**Bước 2: Cấu hình Modbus polling**

E78-DTU hỗ trợ Modbus passthrough — tự động đọc sensor RS485 và gửi qua LoRaWAN:

```
AT+MODBUS=1               // Bật Modbus polling
AT+MBADDR=0x02            // Sensor address
AT+MBFUNC=0x03            // Read Holding Registers
AT+MBREG=0x0000           // Start register
AT+MBLEN=8                // Số registers
AT+MBINTV=300             // Poll mỗi 300 giây (5 phút)
```

**Bước 3: Đăng ký trong ChirpStack**

1. Applications → SmartFarm → Devices → Create
2. DevEUI: lấy từ `AT+DEVEUI?`
3. Device Profile: Soil-Sensor-v1 (đã tạo trước)
4. AppKey: copy vào AT+APPKEY

**Bước 4: Verify**

```bash
# Gateway connected?
curl http://localhost:8080/api/gateways | jq '.result[0].lastSeenAt'

# Device joined?
# ChirpStack UI → Devices → Status = Active

# Data flowing?
mosquitto_sub -h localhost -t "application/+/device/+/event/up" -v
```

### Ưu điểm

- **Tương thích E870**: Cùng LoRaWAN protocol, plug & play
- **RS485 tích hợp**: Kết nối sensor trực tiếp, không cần MAX485
- **Modbus polling tự động**: Không cần MCU trung gian
- **OTAA + ADR**: Tự động tối ưu data rate và công suất
- **Confirmed uplink**: Đảm bảo data đến server
- **Cùng nhà Ebyte**: Hỗ trợ kỹ thuật 1 nguồn

---

## Phương án B: Giữ E90-DTU + Thay Gateway

### Vấn đề

```
E90-DTU                              E870 Gateway
┌──────────┐                         ┌──────────┐
│ Raw LoRa │   Raw LoRa packets      │ LoRaWAN  │
│ (SX1262) │ ════════════════╳═══════▶│ (SX1302) │
│          │   ❌ KHÔNG TƯƠNG THÍCH   │          │
│ "Nói     │                          │ "Chỉ hiểu│
│  LoRa"   │                          │  LoRaWAN"│
└──────────┘                         └──────────┘

Giải pháp: Thay E870 bằng raw LoRa gateway
```

### Raw LoRa Gateway options

| Gateway | Chip | Giá | Ghi chú |
|---------|------|-----|---------|
| **Raspberry Pi + SX1276 HAT** | SX1276 | ~$50-60 | Phổ biến nhất, nhiều tài liệu |
| **RAK7248** (WisGate Edge Lite 2) | SX1302 + raw mode | ~$80 | Hỗ trợ cả LoRaWAN và raw |
| **ESP32 + SX1276** | SX1276 | ~$15-20 | Rẻ nhất, tự build |
| **Ebyte E90-DTU(900SL30)** | SX1262 | ~$35 | Cùng dòng E90, làm gateway |

### Kiến trúc

```
VƯỜN                              NHÀ
┌──────────────────────┐    ┌──────────────────────┐
│ Soil Sensor          │    │ Raw LoRa Gateway     │
│ (RS485 Modbus)       │    │ (RPi + SX1276 HAT)   │
│                      │    │                      │
│  ┌────────────────┐  │    │  LoRa Antenna        │
│  │ E90-DTU        │  │    │  ┌───┐               │
│  │ (900SL22)      │  │    │  │915│               │
│  │                │  │    │  └───┘               │
│  │ Raw LoRa ◀─────┼──┼────┼──▶ SX1276           │
│  │ Transparent    │  │    │  │                   │
│  │ RS485 ◀────────┤  │    │  RPi GPIO           │
│  └────────────────┘  │    │  │                   │
│                      │    │  Python/C listener   │
│  Solar + Battery     │    │  │                   │
└──────────────────────┘    │  MQTT publish        │
                            │  → Mosquitto         │
                            └──────────┬───────────┘
                                       │ LAN
                            ┌──────────┴───────────┐
                            │ Laptop (Docker)      │
                            │                      │
                            │ Mosquitto (MQTT)     │
                            │ Node-RED → InfluxDB  │
                            │ Grafana Dashboard    │
                            │ (Không cần ChirpStack│
                            │  vì không có LoRaWAN)│
                            └──────────────────────┘
```

### Triển khai chi tiết

**Bước 1: Cấu hình E90-DTU**

Dùng EByte RF Setting Tool:

| Parameter | Value |
|-----------|-------|
| Frequency | 923.2 MHz (AS923) |
| Air Rate | 2.4 kbps |
| TX Power | 22 dBm |
| Packet Length | 128 bytes |
| Baud Rate | 9600 (match sensor) |
| Mode | Transparent |
| Address | 0x0001 |

**Bước 2: Build Raw LoRa Gateway (RPi + SX1276)**

```bash
# Cài đặt trên Raspberry Pi
sudo apt update && sudo apt install -y python3-pip mosquitto

# Cài SX1276 library
pip3 install pyLoRa RPi.GPIO paho-mqtt

# Script listener (Python)
```

```python
# gateway_listener.py
from pyLoRa import LoRa
import paho.mqtt.client as mqtt
import json, time, base64

# MQTT setup
mqtt_client = mqtt.Client()
mqtt_client.connect("localhost", 1883)

# LoRa setup (SX1276 on SPI)
lora = LoRa(freq=923200000, sf=7, bw=125000, cr="4/5")

while True:
    payload = lora.recv()
    if payload:
        # Forward to MQTT
        msg = {
            "gateway": "rpi-gw-01",
            "rssi": lora.rssi,
            "snr": lora.snr,
            "data": base64.b64encode(payload).decode(),
            "timestamp": int(time.time())
        }
        mqtt_client.publish("lora/sensor/soil", json.dumps(msg))
        print(f"Received: {len(payload)} bytes, RSSI={lora.rssi}")
```

**Bước 3: Node-RED Flow**

```
[MQTT In]                  [Function: Decode]         [InfluxDB Out]
  topic:                    Parse raw bytes →           measurement: soil
  lora/sensor/soil          JSON {temp, moisture,       bucket: soil_data
       │                    ec, n, p, k, ph}            org: smarfarm
       │                         │
       └─────────────────────────┼───────────────────────┘
                                 │
                           [Debug Output]
```

**Bước 4: Data Format**

E90-DTU transparent mode → sensor Modbus response đi qua nguyên vẹn:

```
E90-DTU gửi: 02 03 10 [16 bytes data] [CRC16]
                  │
                  └── 21 bytes nguyên vẹn (Modbus response)
                      Node-RED decode giống hệt Phương án A
```

### Nhược điểm

- **Phải mua gateway mới** (~$50-80)
- **Không có LoRaWAN features**: không OTAA, không ADR, không confirmed uplink
- **Phải tự viết gateway listener** (Python/C)
- **Không có ChirpStack**: phải dùng MQTT + Node-RED xử lý trực tiếp
- **Khó scale**: thêm sensor = thêm tần số/địa chỉ, không có network management
- **E870 bị bỏ phí** (đã mua rồi)

---

## Bảng quyết định

| Tiêu chí | E78 (Phương án A) | E90 + RPi (Phương án B) |
|----------|-------------------|-------------------------|
| **Tương thích E870** | ✅ Có | ❌ Không |
| **Chi phí thêm** | ~$25-35 | ~$50-80 |
| **Độ phức tạp** | Thấp (AT command) | Trung bình (Python code) |
| **Protocol** | LoRaWAN 1.0.3 | Raw LoRa |
| **OTAA join** | ✅ | ❌ |
| **ADR (tự tối ưu)** | ✅ | ❌ |
| **Confirmed uplink** | ✅ | ❌ |
| **Modbus tích hợp** | ✅ Tự polling | ❌ Phải tự xử lý |
| **ChirpStack** | ✅ Dùng được | ❌ Không dùng được |
| **Scale (nhiều node)** | Dễ (thêm device) | Khó (cần config freq/addr) |
| **Bảo mật** | AES-128 (LoRaWAN) | Không mã hóa |
| **Phạm vi** | ~3 km | ~5 km (nhưng không có gateway management) |

---

## Khuyến nghị

**Phương án A (E78-DTU) là lựa chọn rõ ràng:**

1. **Giữ nguyên E870** — không bỏ phí gateway đã mua
2. **Rẻ hơn** — chỉ cần mua E78-DTU (~$25-35), không cần mua gateway mới
3. **Đơn giản hơn** — AT command config, không cần code Python
4. **Chuẩn hơn** — LoRaWAN protocol, có OTAA, ADR, confirmed uplink
5. **Dễ scale** — thêm sensor = thêm E78-DTU, register trong ChirpStack
6. **Bảo mật** — AES-128 encryption mặc định

**Nếu vẫn muốn dùng E90-DTU**: Phương án B khả thi nhưng tốn kém hơn, phức tạp hơn, và không có các tính năng của LoRaWAN. Chỉ nên chọn nếu đã có sẵn raw LoRa gateway hoặc muốn giữ lại toàn bộ hardware đã mua.
