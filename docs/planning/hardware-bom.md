# Bill of Materials (BOM) — SmartFarm DakLak Coffee

> Danh sách thiết bị cần thiết cho hệ thống SmartFarm cà phê
> Giá tham khảo Việt Nam (VNĐ) — tháng 6/2026

---

## Tổng quan chi phí

| Hạng mục | Số lượng | Tổng chi phí (VNĐ) |
|----------|----------|-------------------|
| Cảm biến đất + Node LoRa | 3 bộ | ~9,000,000 |
| Gateway LoRaWAN | 1 | ~3,500,000 |
| Server (Laptop/PC cũ) | 1 | ~0 (dùng máy có sẵn) |
| Thiết bị tưới (bơm + van) | 1 bộ | ~5,000,000 |
| Nguồn điện & Solar | 3 bộ | ~6,000,000 |
| Phụ kiện & vật tư | — | ~2,000,000 |
| **TỔNG** | | **~25,500,000** |

---

## 1. Cảm biến đất (Soil Multi-Parameter Sensor)

| Thông số | Giá trị |
|----------|---------|
| **Mô hình** | Soil Temperature/Moisture/EC/NPK/pH Sensor |
| **Giao tiếp** | RS485 Modbus-RTU |
| **Đo được** | Nhiệt độ (-40~80°C), Độ ẩm (0~100% VWC), EC (0~20,000 µS/cm), pH (3~9), N/P/K (mg/kg) |
| **Điện áp** | 3.3~24V DC |
| **Dòng điện** | 3mA tĩnh, 25mA đo (RS485) |
| **Kết nối** | 4 dây: VCC (đỏ), GND (đen), RS485-A (vàng), RS485-B (xanh) |
| **Probe** | 316L Stainless Steel, Ø3mm, dài 60mm |
| **Chống nước** | IP68 |
| **Cáp** | 2m (có thể đặt hàng đến 1200m) |
| **Địa chỉ Modbus** | Default 0x02 |
| **Baud rate** | Default 9600 |
| **Số lượng** | 3 (mỗi vùng 1 sensor) |
| **Giá tham khảo** | ~800,000 - 1,500,000 VNĐ/sensor |
| **Mua** | Shopee/Tiki/Taobao — tìm "RS485 soil sensor NPK pH" |

---

## 2. LoRaWAN Node (Ebyte E78-DTU 900LN22)

| Thông số | Giá trị |
|----------|---------|
| **Mô hình** | E78-DTU(900LN22) |
| **Chip** | 6601 (ARM Cortex-M4) |
| **Protocol** | LoRaWAN 1.0.3 |
| **Tần số** | AS923 (920-925 MHz) |
| **TX Power** | 22 dBm |
| **Tầm xa** | ~3 km (line of sight) |
| **Giao tiếp** | RS485 + UART |
| **Kích thước** | 100 × 84 × 25 mm |
| **Trọng lượng** | 120g |
| **Số lượng** | 3 (mỗi vùng 1 node) |
| **Giá tham khảo** | ~1,200,000 - 1,800,000 VNĐ/node |
| **Mua** | https://detail.tmall.com/item.htm?id=597799343037 |

### Cấu hình AT Command (chỉ cần cài 1 lần)

```
AT+MODE=LORAWAN
AT+JOIN=OTAA
AT+DEVEUI=<từ ChirpStack>
AT+APPEUI=<từ ChirpStack>
AT+APPKEY=<từ ChirpStack>
AT+CLASS=A
AT+DR=2          # AS923 DR2 = SF10/125kHz
AT+PORT=2
AT+MODBUS=1
AT+MBADDR=0x02
AT+MBFUNC=0x03
AT+MBREG=0x0000
AT+MBLEN=8
AT+MBINTV=300    # 5 phút/lần
```

---

## 3. Gateway LoRaWAN (Ebyte E870-L915LG12)

| Thông số | Giá trị |
|----------|---------|
| **Mô hình** | E870-L915LG12 |
| **Chipset** | Semtech SX1302 |
| **Điện áp** | DC 8V ~ 28V |
| **Dòng điện** | 120mA @ 12V |
| **TX Power** | 27 dBm |
| **Tầm xa** | ~3 km |
| **Ethernet** | 10/100 Mbps WAN |
| **WiFi** | 2.4 GHz (2 antenna SMA) |
| **LoRa** | 1 antenna SMA |
| **Nhiệt độ** | -40°C to +85°C |
| **Kích thước** | 110 × 105 × 41 mm |
| **Số lượng** | 1 |
| **Giá tham khảo** | ~3,000,000 - 4,000,000 VNĐ |
| **Mua** | https://detail.tmall.com/item.htm?id=667696115203 |

### Lưu ý quan trọng

⚠️ **Phải gắn antenna LoRa TRƯỚC KHI cấp nguồn!** Có thể cháy bộ khuếch đại công suất.

---

## 4. Server (Laptop/PC)

| Thông số | Khuyến nghị |
|----------|------------|
| **CPU** | 4 cores+ (Intel i5/AMD Ryzen 5 trở lên) |
| **RAM** | 8GB+ (16GB khuyến nghị) |
| **Storage** | 256GB+ SSD |
| **OS** | Ubuntu 22.04 LTS hoặc Windows với Docker Desktop |
| **Network** | Ethernet (kết nối gateway) |
| **Số lượng** | 1 |
| **Giá** | Dùng máy có sẵn (~0 VNĐ) |

---

## 5. Thiết bị tưới (Actuators)

### 5.1 Bơm nước (Water Pump)

| Thông số | Giá trị |
|----------|---------|
| **Loại** | Bơm chìm hoặc bơm ly tâm |
| **Công suất** | 1-2 HP (750-1500W) |
| **Lưu lượng** | 30-50 m³/h |
| **Điện áp** | 220V AC |
| **Số lượng** | 1-2 |
| **Giá tham khảo** | ~1,500,000 - 3,000,000 VNĐ/bơm |
| **Mua** | Liên hệ đại lý bơm nước nông nghiệp |

### 5.2 Van điện tử (Solenoid Valve)

| Thông số | Giá trị |
|----------|---------|
| **Loại** | Van điện từ 2 chiều |
| **Kích thước** | DN25 (1") hoặc DN50 (2") |
| **Điện áp** | 12V DC hoặc 220V AC |
| **Áp lực** | 0.02-0.8 MPa |
| **Số lượng** | 3 (mỗi vùng 1 van) |
| **Giá tham khảo** | ~200,000 - 500,000 VNĐ/van |
| **Mua** | Shopee/Tiki — tìm "van điện từ tưới tự động" |

### 5.3 Relay Module (Điều khiển bơm/van từ Node)

| Thông số | Giá trị |
|----------|---------|
| **Loại** | Relay module 4 kênh |
| **Điện áp điều khiển** | 3.3V/5V DC |
| **Công suất relay** | 10A/250VAC, 10A/30VDC |
| **Số lượng** | 1 |
| **Giá tham khảo** | ~50,000 - 100,000 VNĐ |
| **Mua** | Shopee — tìm "relay module 4 kênh" |

---

## 6. Nguồn điện

### 6.1 Grid Power (Server + Gateway)

| Thiết bị | Thông số | Số lượng | Giá (VNĐ) |
|----------|----------|----------|-----------|
| Adapter 12V/2A | DC 5.5×2.1mm | 2 | ~100,000/bộ |
| UPS mini | 12V 7Ah battery | 1 | ~500,000 |

### 6.2 Solar Power (Remote Nodes)

| Thiết bị | Thông số | Số lượng | Giá (VNĐ) |
|----------|----------|----------|-----------|
| Solar Panel | 10W-20W, 18V | 3 | ~200,000/bản |
| Charge Controller | PWM 12V 5A | 3 | ~100,000/bộ |
| Battery | 12V 7Ah Lead-acid hoặc LiFePO4 | 3 | ~400,000/ổ |
| Battery Box | Waterproof enclosure | 3 | ~100,000/hộp |
| **Tổng solar** | | | **~2,400,000** |

---

## 7. Phụ kiện & vật tư

| Thiết bị | Thông số | Số lượng | Giá (VNĐ) |
|----------|----------|----------|-----------|
| Antenna 915MHz | SMA, Omni, 3dBi+ | 4 | ~100,000/antenna |
| Cáp RS485 | Twisted pair, Cat5 | 50m | ~50,000/50m |
| Cáp Ethernet | Cat5e/Cat6 | 20m | ~50,000/20m |
| Waterproof enclosure | IP65+ cho outdoor | 3 | ~200,000/hộp |
| Ống bảo vệ cáp | PVC conduit | 50m | ~50,000/50m |
| Keo chống nước | Silicone sealant | 2 | ~50,000/tuýp |
| Tắc kê + ốc vít | — | 1 bộ | ~50,000 |
| **Tổng phụ kiện** | | | **~1,000,000** |

---

## 8. Tổng hợp chi phí

| # | Hạng mục | SL | Đơn giá (VNĐ) | Thành tiền (VNĐ) |
|---|----------|-----|---------------|-----------------|
| 1 | Soil Sensor RS485 NPK pH | 3 | 1,200,000 | 3,600,000 |
| 2 | E78-DTU(900LN22) LoRaWAN Node | 3 | 1,500,000 | 4,500,000 |
| 3 | E870-L915LG12 Gateway | 1 | 3,500,000 | 3,500,000 |
| 4 | Bơm nước 1HP | 1 | 2,000,000 | 2,000,000 |
| 5 | Van điện từ DN25 | 3 | 350,000 | 1,050,000 |
| 6 | Relay module 4 kênh | 1 | 80,000 | 80,000 |
| 7 | Solar Panel 15W | 3 | 200,000 | 600,000 |
| 8 | Charge Controller PWM | 3 | 100,000 | 300,000 |
| 9 | Battery 12V 7Ah | 3 | 400,000 | 1,200,000 |
| 10 | Adapter 12V/2A | 2 | 100,000 | 200,000 |
| 11 | Antenna 915MHz | 4 | 100,000 | 400,000 |
| 12 | Cáp RS485 + Ethernet | — | — | 200,000 |
| 13 | Waterproof enclosure | 3 | 200,000 | 600,000 |
| 14 | Phụ kiện khác | — | — | 500,000 |
| | **TỔNG CỘNG** | | | **~18,730,000** |

> **Lưu ý**: Chi phí không bao gồm nhân công lắp đặt và chi phí vận chuyển.
> Giá có thể thay đổi tùy thời điểm và nhà cung cấp.

---

## 9. Nhà cung cấp tham khảo Việt Nam

| Thiết bị | Nguồn mua |
|----------|-----------|
| Soil Sensor RS485 | Shopee.vn, Tiki.vn, Taobao |
| Ebyte (E78, E870) | shopee.vn (tìm "Ebyte E78"), tmall.com |
| Relay module | shopee.vn |
| Solar panel | shopee.vn, các cửa hàng năng lượng mặt trời |
| Bơm nước | Đại lý bơm Pentax, Shimizu, Wilo |
| Van điện từ | shopee.vn (tìm "van điện từ tưới tiêu") |
| Waterproof enclosure | shopee.vn (tìm "hộp chống nước IP65") |
