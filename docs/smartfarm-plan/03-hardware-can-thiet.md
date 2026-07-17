# 03 - HARDWARE CẦN THIẾT (Bill of Materials)

## 1. Gateway (1 bộ - đặt tại trung tâm trang trại)

| # | Linh kiện | Model / Thông số | SL | Đơn giá (USD) | Ghi chú |
|---|-----------|-----------------|-----|---------------|---------|
| 1 | Gateway LoRaWAN | **EByte E870-L915LG12** | 1 | $80-100 | SX1302, AS923, 27dBm, half-duplex |
| 2 | Antenne LoRa 915MHz | SMA Omni, 3dBi, vertical | 1 | $5-10 | **BẮT BUỘC gắn trước khi cấp nguồn** |
| 3 | Nguồn DC 12V/2A | Adapter 5.5x2.1mm barrel jack | 1 | $5-8 | Hoặc dùng terminal block 12V |
| 4 | Ethernet Cable | Cat5e/Cat6, 50m | 1 | $5-10 | Kết nối về router/switch |
| 5 | Router/Switch | bất kỳ, có RJ45 | 1 | $20-30 | Nếu chưa có (có thể dùng chung) |
| 6 | Tủ chống nước outdoor | IP65, 300x200x150mm | 1 | $10-15 | Đặt ngoài trời |
| 7 | Cột antenne | Inox/thép, cao 3m | 1 | $10-20 | Nâng antenne ≥3m, tránh vật cản kim loại |

**Tổng Gateway: ~$135-195**

### Thông Số E870 Gateway

| Parameter | Giá trị |
|-----------|---------|
| Chipset | Semtech SX1302 |
| Nguồn | DC 8V - 28V (5.5x2.1mm jack) |
| dòng tiêu thụ | 120mA @ 12V |
| TX Power | 27 dBm |
| Khoảng cách | ~3 km (LOS) |
| Duplex | Half-duplex |
| Nhiệt độ hoạt động | -40°C đến +85°C |
| Kích thước | 110 x 105 x 41 mm |
| Trọng lượng | 417g |
| Coating | Chống mốc, chống ẩm, chống muối |
| Ethernet | 10/100 Mbps, Auto MDI/IX |
| WiFi | Dual SMA (2.4 GHz) - tùy chọn |
| LoRa Antenna | 1 SMA connector |
| USB Debug | Có |
| Reset | Nút bấm giữ >5s |

**Lưu ý:** Phiên bản E870-L915LG12-**O** có built-in ChirpStack + Node-RED. Phiên bản thường (không -O) chỉ là packet forwarder, cần server riêng.

---

## 2. Mỗi Khu Vực (x3 khu: A, B, C)

| # | Linh kiện | Model / Thông số | SL/khu | Đơn giá (USD) | Ghi chú |
|---|-----------|-----------------|--------|---------------|---------|
| 1 | Node LoRaWAN | **EByte E78-DTU(900LN22)** | 1 | $25-35 | Chip 6601, OTAA, Class A, RS485+UART |
| 2 | Soil Sensor 8-tham-số | Soil Multi-Parameter RS485 | 1 | $30-50 | IP68, 316L inox probe 60mm |
| 3 | Antenne LoRa SMA | SMA Omni, 915MHz, 3dBi | 1 | $3-5 | Cho E78-DTU |
| 4 | Nguồn DC 12V/0.5A | Adapter hoặc Solar kit | 1 | $5-10 | Hoặc hệ thống pin mặt trời |
| 5 | Cable RS485 | Twisted pair (Cat5 hoặc shielded), 10-30m | 1 | $3-8 | Đảm bảo đúng cực A/B |
| 6 | Relay Module | 1-channel, 12V trigger, 10A | 1 | $2-5 | Điều khiển van điện từ |
| 7 | Van điện từ | DN25, 12V DC, NC/NO | 1 | $10-20 | Van tưới nhỏ giọt |
| 8 | Hộp chống nước outdoor | IP65, 200x150x100mm | 1 | $5-10 | Chứa node + relay |

**Tổng mỗi khu: ~$83-143**
**Tổng 3 khu: ~$250-430**

### Thông Số E78-DTU Node

| Parameter | Giá trị |
|-----------|---------|
| Chip | 6601 (ARM Cortex-M4) |
| Protocol | LoRaWAN 1.0.3 |
| Tần số | 868/915 MHz (AS923) |
| TX Power | 22 dBm (0.16W) |
| Khoảng cách | ~3 km (LOS) |
| Giao tiếp | RS485 + UART |
| Join mode | OTAA / ABP |
| Kích thước | 100 x 84 x 25 mm |
| Trọng lượng | 120g |
| Nguồn | DC 8-28V |

### Thông Số Soil Sensor

| Parameter | Giá trị |
|-----------|---------|
| Đo được | Nhiệt độ, Độ ẩm, EC, Salinity, N, P, K, pH |
| Nhiệt độ | -40°C ~ 80°C, ±0.5°C @25°C |
| Độ ẩm | 0 ~ 100% VWC, ±3% (10-40%) @25°C |
| EC | 0 ~ 20,000 μS/cm, ±3% FS (0-10k) |
| pH | 3 ~ 9 pH |
| Probe | 316L Stainless Steel, 60mm x 3mm |
| Waterproof | IP68 |
| Cable | 2m tiêu chuẩn (tùy chỉnh đến 1200m) |
| Nguồn | 3.3-24V DC |
| Dòng standby | 3 mA (RS485), 0.07 mA (ultra-low power) |
| Dòng đo | 25 mA |
| Modbus | 9600 baud, 8N1, addr mặc định 0x02 |

### Bảng Register Modbus

| Register | Nội dung | Định dạng | Đơn vị |
|----------|----------|-----------|--------|
| 0 | Nhiệt độ | signed, /10 | °C |
| 1 | Độ ẩm | unsigned, /10 | % VWC |
| 2 | EC | unsigned, trực tiếp | μS/cm |
| 3 | Độ mặn | unsigned, trực tiếp | - |
| 4 | Nitrogen (N) | unsigned, trực tiếp | mg/kg |
| 5 | Phosphorus (P) | unsigned, trực tiếp | mg/kg |
| 6 | Potassium (K) | unsigned, trực tiếp | mg/kg |
| 7 | pH | unsigned, /10 | pH |

### Wiring Diagram (RS485)

```
Soil Sensor                    E78-DTU Node
┌──────────┐                  ┌──────────┐
│  Red ────│──── 12V ────────│── VCC    │
│  Black ──│──── GND ────────│── GND    │
│  Yellow ─│──── RS485-A(+) ─│── A(+)   │
│  Blue ───│──── RS485-B(-) ─│── B(-)   │
└──────────┘                  └──────────┘
```

**LƯU Ý QUAN TRỌNG:**
- PHẢI nối đúng cực: A(+)↔A(+), B(-)↔B(-)
- Dùng twisted pair cable (Cat5 hoặc shielded)
- Khoảng cách tối đa: 1200m (tại baud thấp), khuyến nghị <500m
- Tránh đặt cable song song với nguồn điện mạnh

---

## 3. Hệ Thống Bơm Tưới (Chung)

| # | Linh kiện | Model / Thông số | SL | Đơn giá (USD) | Ghi chú |
|---|-----------|-----------------|-----|---------------|---------|
| 1 | Máy bơm nước | Bơm chìm 12V/24V hoặc bơm ly tâm | 2 | $20-40/chiếc | 1 bơm chính + 1 dự phòng |
| 2 | Relay Module 4-channel | 12V trigger, 10A/relay | 1 | $5-10 | Điều khiển bơm + van |
| 3 | Bộ nguồn 12V/10A | Switching PSU | 1 | $10-15 | Cấp nguồn cho relay, bơm |
| 4 | Ống nước PE | DN25, 100m | 1 | $15-25 | Đường ống chính |
| 5 | Ống nhỏ giọt | DN16, 200m | 1 | $10-20 | Đường ống nhánh |
| 6 | Bộ lọc nước | Lọc thô + lọc tinh | 1 | $5-10 | Bảo vệ van, bơm |

**Tổng hệ thống bơm: ~$85-160**

---

## 4. Nguồn Điện (Nếu Không Có Điện Mạng)

| # | Linh kiện | Model / Thông số | SL/điểm | Đơn giá (USD) | Ghi chú |
|---|-----------|-----------------|---------|---------------|---------|
| 1 | Pin ắc quy | 12V 7Ah Lead-acid | 1 | $15-20 | Lưu trữ năng lượng |
| 2 | Tấm pin mặt trời | 10W-20W, 12V | 1 | $10-20 | Sạc pin |
| 3 | Bộ sạc Controller | PWM/MPPT 12V | 1 | $5-10 | Bảo vệ pin, tối ưu sạc |

**Tổng nguồn điện mỗi điểm: ~$30-50**

### Tính Toán Power Budget

```
Thiết bị tiêu thụ (tại mỗi điểm sensor + node):

E78-DTU:
  - TX (45mA @ 12V) × 2s/300s = 0.3 mA trung bình
  - Standby: 10 mA
  → Trung bình: ~10.3 mA

Soil Sensor:
  - Đo (25mA) × 5s/300s = 0.42 mA trung bình
  - Standby: 3 mA
  → Trung bình: ~3.4 mA

Relay (khi active):
  - 80mA @ 12V × thời gian tưới
  → Negligible nếu tưới ít

TỔNG TIÊU THỤ TRUNG BÌNH: ~14 mA @ 12V = 0.168W

Pin 12V 7Ah = 7000 mAh
  → 7000 / 14 = ~500 giờ = ~21 ngày tự chủ

Pin 10W solar充电 (8h nắng/ngày):
  → 10W × 8h / 12V = ~6,667 mAh/ngày
  → Đủ bù trừ những ngày mưa liên tục
```

---

## 5. Sơ Đồ Bố Trí Hiện Trường

```
                    ☀️ Nắng (Solar Panel)
                      │
    ┌─────────────────┴─────────────────┐
    │         TRẠM GATEWAY              │
    │  ┌──────────┐  ┌──────────────┐   │
    │  │ E870 GW  │  │ Router/Modem │   │
    │  │ + Antenne│  │  (Internet)  │   │
    │  │  3m cao  │  └──────────────┘   │
    │  └──────────┘                      │
    └─────────────────┬─────────────────┘
                      │ Ethernet
                      ▼
    ┌─────────────────────────────────────┐
    │       MÁY CHỦ (Mini PC / RPi)      │
    │  Docker: 8 services                 │
    │  Ports: 8080, 1880, 8086, 3005,    │
    │         3002, 1883, 6379, 5432     │
    └─────────────────────────────────────┘

              ┌───────────┐
              │  KHU A    │
              │ Robusta   │
              │ 5000 m²   │
              │ ┌───────┐ │
              │ │ E78   │ │
              │ │ Node  │ │
              │ │ +Sens │ │
              │ └───────┘ │
              │  ┌─────┐  │
              │  │Van-1│  │
              │  └──┬──┘  │
              └─────┼─────┘
                    │
              ┌─────┼─────┐
              │     │     │
    ┌─────────┴┐ ┌──┴───┐ ┌┴─────────┐
    │  KHU B   │ │ PUMP │ │  KHU C   │
    │ Robusta  │ │CHÍNH │ │ Arabica  │
    │ 3500 m²  │ │ +DỰ  │ │ 2000 m²  │
    │ ┌──────┐ │ │PHÒNG│ │ ┌──────┐ │
    │ │ E78  │ │ └─────┘ │ │ E78  │ │
    │ │+Sens │ │          │ │+Sens │ │
    │ └──────┘ │          │ └──────┘ │
    │  ┌─────┐ │          │  ┌─────┐ │
    │  │Van-2│ │          │  │Van-3│ │
    │  └──┬──┘ │          │  └──┬──┘ │
    └─────┼────┘          └─────┼────┘
          │                     │
          └─────────┬───────────┘
                    │
              ┌─────┴─────┐
              │  Nguồn    │
              │  điện +    │
              │  Solar     │
              └───────────┘
```

---

## 6. Bảng Giá Tổng Hợp

| Nhóm | Chi phí (USD) | Chi phí (VND) |
|------|--------------|--------------|
| Gateway (1 bộ) | $135-195 | 3,375,000 - 4,875,000 |
| Khu A (Robusta 5000m²) | $83-143 | 2,075,000 - 3,575,000 |
| Khu B (Robusta 3500m²) | $83-143 | 2,075,000 - 3,575,000 |
| Khu C (Arabica 2000m²) | $83-143 | 2,075,000 - 3,575,000 |
| Hệ thống bơm tưới | $85-160 | 2,125,000 - 4,000,000 |
| Nguồn điện solar x3 | $90-150 | 2,250,000 - 3,750,000 |
| Máy chủ (Mini PC/RPi) | $100-200 | 2,500,000 - 5,000,000 |
| Vật tư phụ (cable, ống, tủ) | $50-100 | 1,250,000 - 2,500,000 |
| **TỔNG CỘNG** | **$710-1,235** | **17,750,000 - 30,875,000** |

> **Lưu ý:** Chi phí chưa bao gồm nhân công lắp đặt, đất đai, và chi phí vận hành hàng tháng.
