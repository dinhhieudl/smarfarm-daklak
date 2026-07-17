# 05 - TRIỂN KHAI HARDWARE HIỆN TRƯỜNG

## 1. Chuẩn Bị Trước Khi Lắp

### 1.1 Kiểm Tra Gateway E870

```
⚠️ CẢNH BÁO: TUYỆT ĐỐI KHÔNG cấp nguồn khi chưa gắn antenne LoRa!
   → Có thể hỏng chip SX1302
```

**Quy trình kiểm tra:**
1. Gắn antenne LoRa 915MHz vào SMA connector
2. Cắm Ethernet cable vào router
3. Cắm nguồn 12V/2A
4. Chờ 30s cho gateway khởi động
5. Mở **EByte Config Tool** trên laptop cùng mạng
6. Tìm gateway trên mạng (thông thường: 192.168.x.x)
7. Kiểm tra:
   - Gateway ID: `70B3D52026021439` (ghi lại!)
   - LED Status: ON = bình thường
   - Ethernet link: OK

**Cấu hình Packet Forwarder:**
```
Server Address: <IP của máy chủ ChirpStack>
Server Port: 1700
Region: AS923
Center Frequency 1: 920600000
Center Frequency 2: 921400000
Coordinates: 12.6667, 108.0500
Altitude: 500m
```

### 1.2 Kiểm Tra Node E78-DTU

**Kết nối debug:**
- Dùng RS485-to-USB adapter
- Serial terminal: 9600 baud, 8N1

**AT Commands kiểm tra:**
```
AT                   → OK
AT+MODE=LORAWAN      → OK
AT+BAND?             → 7 (AS923)
AT+CLASS=A           → OK
AT+DR?               → 2 (DR2 = SF10/125kHz)
AT+JOIN?             → "not joined" (chưa join)
AT+RSSI?             → RSSI hiện tại
AT+SNR?              → SNR hiện tại
```

### 1.3 Kiểm Tra Soil Sensor

**Kết nối:**
```
Sensor RS485:  A(+) ←→ Yellow wire
               B(-) ←→ Blue wire
               GND  ←→ Black wire
               VCC  ←→ Red wire (12V)
```

**Modbus Test:**
```python
# Gửi query đọc 8 registers
request = bytes.fromhex('02 03 00 00 00 08 44 0C')
# Kỳ vọng nhận 21 bytes (16 data + 5 CRC)
```

**Kiểm tra giá trị hợp lý:**
| Tham số | Giá trị kỳ vọng | Nếu sai |
|---------|----------------|---------|
| Nhiệt độ | 20-40°C | Kiểm tra byte order |
| Độ ẩm | 20-80% VWC | Kiểm tra wiring |
| EC | 100-2000 μS/cm | Kiểm tra calibration |
| pH | 4.5-7.5 | Kiểm tra sensor |

---

## 2. Quy Trình Lắp Đặt Mỗi Khu Vực

### Bước 1: Lắp Sensor

1. Chọn vị trí **representative** của khu vực
   - Không đặt quá gần bờ, quá gần đường ống
   - Đặt giữa khu vực, nơi đất đại diện nhất
2. Đào lỗ nhỏ vừa probe
3. Chọc probe sensor xuống đất
   - **Phải chọc sâu 60mm** (độ sâu probe)
   - **Không được có khoảng trống** quanh probe
   - Đảm bảo probe tiếp xúc đất hoàn toàn
4. Đặt sensor ngay ngắn, không nghiêng
5. Che chắn phần thân sensor (có thể dùng ống PVC cắt đôi)
6. Để probe tiếp xúc đất, thân sensor trên mặt đất

### Bước 2: Lắp Node E78-DTU

1. Đặt node trong tủ chống nước IP65
2. Kết nối RS485 từ sensor vào node
   - A(+) ↔ Yellow (sensor)
   - B(-) ↔ Blue (sensor)
   - GND ↔ Black (sensor)
   - VCC ↔ Red (sensor, 12V)
3. Gắn antenne LoRa (cách kim loại ≥10cm)
4. Cấp nguồn 12V
5. Đặt tủ ở vị trí:
   - Cao hơn mặt đất (tránh ngập nước)
   - Gần sensor (giữ cable ngắn)
   - Thuận tiện bảo trì

### Bước 3: Lắp Van Tưới

1. Cắt ống nước DN25 tại vị trí nhánh
2. Lắp van điện tử theo hướng dòng chảy (có mũi tên trên van)
3. Kết nối dây relay:
   - Relay IN ← GPIO từ controller
   - Relay OUT → Van (+), GND → Van (-)
4. Kiểm tra van hoạt động:
   - Gửi lệnh ON từ Smart Control
   - Verify van mở (nghe tiếng kêu, kiểm tra dòng nước)
   - Gửi lệnh OFF
   - Verify van đóng

### Bước 4: Lắp Nguồn Solar (Nếu Cần)

```
┌──────────────┐
│ Tấm Pin 10W  │
│   12V DC     │
└──────┬───────┘
       │ (+,-)
       ▼
┌──────────────┐
│ PWM/MPPT     │
│ Controller   │
├──────────────┤
│ Battery ←────│── Pin 12V 7Ah
│ Load    ─────│──→ E78-DTU + Sensor + Relay
└──────────────┘
```

**Lắp đặt:**
1. Đặt tấm pin nơi có nắng trực tiếp (tránh bóng cây)
2. Hướng pin về phía Nam (Bắc bán cầu)
3. Góc nghiêng ~15-20° (phù hợp vĩ độ 12.67°N)
4. Kết nối: Panel → Controller → Battery → Load
5. Kiểm tra controller LED: Charging = đang sạc

---

## 3. Cấu Hình E78-DTU Cho Mỗi Zone

### Zone A - Robusta 5000m²

```
AT+MODE=LORAWAN          → OK
AT+JOIN=OTAA             → OK
AT+DEVEUI=<DevEUI_A>     → OK    (từ sticker E78-DTU)
AT+APPEUI=<AppEUI>       → OK    (giống nhau cho tất cả)
AT+APPKEY=<AppKey_A>     → OK    (riêng cho mỗi device)
AT+CLASS=A               → OK
AT+DR=2                  → OK    (AS923 DR2 = SF10/125kHz)
AT+BAND=7                → OK    (AS923)
AT+PORT=2                → OK
AT+TXC=2                 → OK
AT+MODBUS=1              → OK    (bật Modbus polling)
AT+MBADDR=0x02           → OK    (sensor address)
AT+MBFUNC=0x03           → OK    (Read Holding Registers)
AT+MBREG=0x0000          → OK    (start register)
AT+MBLEN=8               → OK    (8 registers)
AT+MBINTV=300            → OK    (mỗi 5 phút)
AT+JOIN=1                → OK    (bắt đầu join)
```

**Verify join:**
```
AT+JOIN?                 → "joined" (sau 30s-2 phút)
AT+RSSI?                 → > -120 dBm
AT+SNR?                  → > -10 dB
```

### Zone B - Robusta 3500m²

```
(Mirror Zone A, thay đổi:)
AT+DEVEUI=<DevEUI_B>     → Device EUI khác
AT+APPKEY=<AppKey_B>     → App Key khác
```

### Zone C - Arabica 2000m²

```
(Mirror Zone A, thay đổi:)
AT+DEVEUI=<DevEUI_C>     → Device EUI khác
AT+APPKEY=<AppKey_C>     → App Key khác
```

> **Lưu ý:** Mỗi node có DevEUI và AppKey riêng, nhưng cùng AppEUI, Modbus address (0x02), và interval (300s).

---

## 4. Kiểm Tra Kết Nối Từ Máy Chủ

```bash
# Kiểm tra Gateway đang forward packet
docker compose logs gateway-bridge | grep "uplink"

# Kiểm tra ChirpStack nhận data
docker compose logs chirpstack | grep "device"

# Kiểm tra Node-RED flow hoạt động
# Mở http://<server>:1880 → kiểm tra flow có data

# Kiểm tra InfluxDB có data
curl -H "Authorization: Token <INFLUX_TOKEN>" \
  "http://localhost:8086/api/v2/query?org=smartfarm" \
  --data-urlencode 'query=from(bucket:"soil_data") |> range(start:-1h) |> limit(n:5)'

# Kiểm tra Grafana có data
# Mở http://<server>:3005 → Dashboard → kiểm tra panels
```

---

## 5. Wiring Diagrams

### 5.1 Mỗi Zone (Node + Sensor + Relay + Van)

```
                    ┌─────────────────┐
                    │   E78-DTU Node  │
                    │                 │
┌──────────┐ RS485 │  A(+) ←─────── Yellow (Sensor)
│  Soil    │───────│  B(-) ←─────── Blue (Sensor)
│  Sensor  │       │  GND  ←─────── Black (Sensor)
│          │       │  VCC  ←─────── Red (Sensor)
│  IP68    │       │                 │
│  Probe   │       │  Relay OUT ────→ Van (+)
└──────────┘       │  GND ─────────→ Van (-)
                   │                 │
                   │  DC 12V IN ←── Nguồn
                   │  Antenne SMA ← Antenne 915MHz
                   └─────────────────┘
```

### 5.2 Relay Module

```
┌─────────────────┐
│  Relay Module   │
│                 │
│  VCC ←───── 12V│
│  GND ←───── GND│
│  IN  ←───── GPIO (từ controller hoặc manual switch)
│  COM ─────→ Van (+)
│  NO  ─────→ Van (-)    (NC = normally closed, NO = normally open)
└─────────────────┘
```

### 5.3 Hệ Thống Bơm

```
┌──────────┐      ┌──────────┐      ┌──────────┐
│  Nguồn   │──────│  Relay   │──────│  Máy bơm │
│  12V/10A │      │  Module  │      │  12V/24V │
└──────────┘      │  4-ch    │      └─────┬────┘
                  │          │            │
                  │ CH1 ────│──→ Pump-1 (chính)
                  │ CH2 ────│──→ Pump-2 (dự phòng)
                  │ CH3 ────│──→ Valve-1 (Khu A)
                  │ CH4 ────│──→ Valve-2 (Khu B)
                  │          │    Valve-3 dùng node E78
                  └──────────┘
```

> **Lưu ý:** Valve-3 (Khu C) được điều khiển trực tiếp từ E78-DTU node, không qua relay module chung.
