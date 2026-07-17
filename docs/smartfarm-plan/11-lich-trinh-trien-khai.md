# 11 - LỊCH TRÌNH TRIỂN KHAI

## Tổng Quan 6 Tuần

```
Tuần 1 ──── Tuần 2 ──── Tuần 3 ──── Tuần 4 ──── Tuần 5 ──── Tuần 6
 Chuẩn bị    Gateway    Zone A      Zone B/C    Tinh chỉnh   Go-Live
```

---

## Tuần 1: Chuẩn Bị

### Ngày 1-2: Thu Mua Hardware

| Việc | Chi tiết | Người |
|------|---------|-------|
| Đặt hàng E78-DTU x3 | từ EByte hoặc đại lý | Quản lý |
| Đặt hàng Soil Sensor x3 | RS485, IP68 | Quản lý |
| Đặt hàng Van x3 | DN25, 12V DC | Quản lý |
| Đặt hàng Relay, cable, tủ | Theo BOM | Quản lý |
| Đặt hàng máy chủ | Mini PC hoặc RPi 4/5 4GB | Quản lý |
| Đặt hàng solar kit x3 | Pin+Panel+Controller | Quản lý |

### Ngày 1-2: Setup Server

| Việc | Chi tiết | Người |
|------|---------|-------|
| Cài Ubuntu 22.04 | Trên Mini PC/RPi | Kỹ thuật |
| Cài Docker + Docker Compose | Theo docs | Kỹ thuật |
| Clone repo | `git clone` | Kỹ thuật |
| Tạo .env | Copy .env.example, chỉnh sửa | Kỹ thuật |

### Ngày 3: Docker Stack

| Việc | Chi tiết | Người |
|------|---------|-------|
| docker compose up -d | Khởi động 10 services | Kỹ thuật |
| Kiểm tra services | `docker compose ps` | Kỹ thuật |
| Kiểm tra logs | Tìm error | Kỹ thuật |
| Access ChirpStack | http://localhost:8080 | Kỹ thuật |

### Ngày 3: Cấu Hình ChirpStack

| Việc | Chi tiết | Người |
|------|---------|-------|
| Region AS923 | Enable | Kỹ thuật |
| Device Profile | Soil-Sensor-v1 | Kỹ thuật |
| Application | SmartFarm-DakLak | Kỹ thuật |
| Payload decoder | JavaScript (16 bytes) | Kỹ thuật |

### Ngày 4: Node-RED + InfluxDB

| Việc | Chi tiết | Người |
|------|---------|-------|
| Import Node-RED flow | MQTT → InfluxDB | Kỹ thuật |
| Cấu hình InfluxDB | Token, bucket, org | Kỹ thuật |
| Test data flow | Simulator → Node-RED → InfluxDB | Kỹ thuật |

### Ngày 5: Grafana + Smart Control

| Việc | Chi tiết | Người |
|------|---------|-------|
| Import Grafana dashboard | Soil monitoring panels | Kỹ thuật |
| Cấu hình datasource | InfluxDB connection | Kỹ thuật |
| Setup Smart Control | npm install, npm start | Kỹ thuật |
| Test với simulator | Chạy 50 data points | QA |

**Deliverable Tuần 1:** Server chạy ổn định, simulator hoạt động, dashboard hiển thị data.

---

## Tuần 2: Lắp Đặt Gateway

### Ngày 1: Lắp Cột Antenne

| Việc | Chi tiết | Người |
|------|---------|-------|
| Chọn vị trí | Trung tâm trang trại, thoáng | Quản lý + Kỹ thuật |
| Lắp cột 3m | Inox/thép, chắc chắn | Thợ |
| Hướng antenne | Vertical polarization | Thợ |

### Ngày 2: Lắp Gateway

| Việc | Chi tiết | Người |
|------|---------|-------|
| Lắp E870 vào tủ IP65 | Chắc chắn,防水 | Kỹ thuật |
| Gắn antenne LoRa | **TRƯỚC KHI cắm nguồn** | Kỹ thuật |
| Kết nối Ethernet | Về router/switch | Kỹ thuật |
| Cấp nguồn 12V/2A | Kiểm tra LED | Kỹ thuật |

### Ngày 3: Cấu Hình Gateway

| Việc | Chi tiết | Người |
|------|---------|-------|
| EByte Config Tool | Tìm gateway trên mạng | Kỹ thuật |
| Server Address | IP máy chủ ChirpStack | Kỹ thuật |
| Server Port | 1700 | Kỹ thuật |
| Region | AS923 | Kỹ thuật |
| Coordinates | 12.6667, 108.0500 | Kỹ thuật |

### Ngày 4: Verify Gateway

| Việc | Chi tiết | Người |
|------|---------|-------|
| ChirpStack | Gateway status "Online" | Kỹ thuật |
| Gateway Bridge | Logs không lỗi | Kỹ thuật |
| MQTT | Có packet từ gateway | Kỹ thuật |
| Firewall | Port 1700/udp open | Kỹ thuật |

### Ngày 5: LoRa Range Test

| Việc | Chi tiết | Người |
|------|---------|-------|
| Đặt node test ở 100m | Gửi 10 packet | Kỹ thuật |
| Đặt node test ở 500m | Gửi 10 packet | Kỹ thuật |
| Đặt node test ở 1km | Gửi 10 packet | Kỹ thuật |
| Ghi nhận RSSI, SNR, packet loss | Bảng đo | Kỹ thuật |

**Deliverable Tuần 2:** Gateway online, LoRa hoạt động trong phạm vi 1km+.

---

## Tuần 3: Zone A Pilot

### Ngày 1: Lắp Sensor

| Việc | Chi tiết | Người |
|------|---------|-------|
| Chọn vị trí | Representative của khu A | Quản lý |
| Lắp probe | Depth 60mm, không khoảng trống | Kỹ thuật |
| Che chắn | PVC hoặc hộp bảo vệ | Kỹ thuật |

### Ngày 2: Lắp Node

| Việc | Chi tiết | Người |
|------|---------|-------|
| Lắp E78-DTU trong tủ | IP65 outdoor | Kỹ thuật |
| Kết nối RS485 | A↔Yellow, B↔Blue | Kỹ thuật |
| Gắn antenne | SMA 915MHz | Kỹ thuật |
| Cấp nguồn | 12V adapter hoặc solar | Kỹ thuật |

### Ngày 3: Cấu Hình Node

| Việc | Chi tiết | Người |
|------|---------|-------|
| AT commands | DEVEUI, APPKEY, Modbus | Kỹ thuật |
| OTAA Join | AT+JOIN=1, chờ joined | Kỹ thuật |
| Verify RSSI | > -120 dBm | Kỹ thuật |
| Verify data | ChirpStack hiển thị data | Kỹ thuật |

### Ngày 4: Verify Pipeline

| Việc | Chi tiết | Người |
|------|---------|-------|
| ChirpStack | Device "Join", data received | Kỹ thuật |
| Node-RED | Flow xử lý data | Kỹ thuật |
| InfluxDB | Data stored | Kỹ thuật |
| Grafana | Dashboard hiển thị | Kỹ thuật |

### Ngày 5: Lắp Van + Test Tưới

| Việc | Chi tiết | Người |
|------|---------|-------|
| Lắp van DN25 | Theo hướng dòng chảy | Thợ |
| Kết nối relay | E78-DTU → Relay → Van | Kỹ thuật |
| Test ON/OFF | Từ Smart Control API | Kỹ thuật |
| Verify van | Mở/đóng đúng | Kỹ thuật |
| Test tưới 5 phút | Verify nước chảy | QA |

**Deliverable Tuần 3:** Zone A hoạt động hoàn chỉnh (sensor → gateway → dashboard → tưới).

---

## Tuần 4: Mở Rộng Zone B & C

### Ngày 1-2: Zone B

| Việc | Chi tiết | Người |
|------|---------|-------|
| Lắp sensor + node | Zone B (Robusta 3500m²) | Kỹ thuật |
| Cấu hình AT commands | DevEUI_B, AppKey_B | Kỹ thuật |
| Verify data pipeline | End-to-end | Kỹ thuật |
| Lắp van + test | Van-2, ON/OFF | Kỹ thuật |

### Ngày 3-4: Zone C

| Việc | Chi tiết | Người |
|------|---------|-------|
| Lắp sensor + node | Zone C (Arabica 2000m²) | Kỹ thuật |
| Cấu hình AT commands | DevEUI_C, AppKey_C | Kỹ thuật |
| Verify data pipeline | End-to-end | Kỹ thuật |
| Lắp van + test | Van-3, ON/OFF | Kỹ thuật |

### Ngày 5: Config Multi-Zone

| Việc | Chi tiết | Người |
|------|---------|-------|
| Update zones.json | Thêm zone B, C | Kỹ thuật |
| Update actuators.json | Thêm valve-2, valve-3 | Kỹ thuật |
| Update irrigation-rules.json | Rules cho B, C | Kỹ thuật |
| Test multi-zone | Tưới A + B đồng thời | QA |

**Deliverable Tuần 4:** 3 zones hoạt động, multi-zone irrigation test.

---

## Tuần 5: Tinh Chỉnh

### Ngày 1: Calibrate Sensor

| Việc | Chi tiết | Người |
|------|---------|-------|
| Lấy mẫu đất | Tại vị trí sensor mỗi zone | Quản lý |
| Đo trong lab | Moisture, pH, EC | Lab |
| So sánh | Sensor vs Lab result | Kỹ thuật |
| Điều chỉnh | Offset/calibration factor | Kỹ thuật |

### Ngày 2: Tinh Chỉnh Irrigation Rules

| Việc | Chi tiết | Người |
|------|---------|-------|
| Review moisture data | 1 tuần gần nhất | Kỹ thuật |
| Điều chỉnh moistureMin/Max | Theo thực tế | Kỹ thuật |
| Điều chỉnh maxDuration | Theo flow rate thực | Kỹ thuật |
| Test auto-irrigation | Verify trigger | QA |

### Ngày 3: Alerts + Advisory

| Việc | Chi tiết | Người |
|------|---------|-------|
| Test alert thresholds | Moisture < 20% | QA |
| Test advisory | 6 giai đoạn cà phê | QA |
| Test weather API | Open-Meteo data | QA |
| Test audit log | Tất cả hành động | QA |

### Ngày 4: Dashboard Tuning

| Việc | Chi tiết | Người |
|------|---------|-------|
| Grafana panels | Điều chỉnh gauge ranges | Kỹ thuật |
| Smart Control UI | Responsive check | Kỹ thuật |
| Dark/Light theme | Test trên mobile | QA |
| Performance | Load time < 3s | QA |

### Ngày 5: User Training

| Việc | Chi tiết | Người |
|------|---------|-------|
| Hướng dẫn operator | Cách đọc dashboard | Quản lý |
| Hướng dẫn tưới thủ công | API endpoints | Quản lý |
| Hướng dẫn xem alerts | Cách xử lý | Quản lý |
| Hướng dẫn backup | Backup InfluxDB | Kỹ thuật |

**Deliverable Tuần 5:** Hệ thống tinh chỉnh, user được training.

---

## Tuần 6: Go-Live

### Ngày 1-2: Chạy 24/7

| Việc | Chi tiết | Người |
|------|---------|-------|
| Disable simulator | Chuyển sang data thật | Kỹ thuật |
| Monitor 24h | Logs, dashboard, alerts | Kỹ thuật |
| Fix bugs | Nếu có | Kỹ thuật |
| Verify irrigation | Auto-trigger hoạt động | QA |

### Ngày 3: Stress Test

| Việc | Chi tiết | Người |
|------|---------|-------|
| Test emergency stop | POST /api/irrigation/emergency-stop | QA |
| Test rain pause | Simulate rain | QA |
| Test power outage | Tắt nguồn, reboot | QA |
| Test gateway disconnect | Tắt Ethernet, verify reconnect | QA |

### Ngày 4: Documentation

| Việc | Chi tiết | Người |
|------|---------|-------|
| Cập nhật README | Hướng dẫn sử dụng | Kỹ thuật |
| Cập nhật DEPLOY.md | Deployment guide | Kỹ thuật |
| Viết user manual | Hướng dẫn operator | Quản lý |
| Backup configs | zones.json, rules, flows | Kỹ thuật |

### Ngày 5: Handover

| Việc | Chi tiết | Người |
|------|---------|-------|
| Demo cho chủ trang trại | Toàn bộ tính năng | Quản lý |
| Bàn giao tài khoản | Admin/Operator credentials | Kỹ thuật |
| Bàn giao documentation | Tất cả docs | Kỹ thuật |
| Plan bảo trì | Lịch bảo trì định kỳ | Quản lý |

**Deliverable Tuần 6:** Hệ thống go-live, documentation hoàn chỉnh, handover.

---

## Bảng Theo Dõi Tiến Độ

| Tuần | Trạng thái | Ghi chú |
|------|-----------|---------|
| Tuần 1: Chuẩn bị | ☐ | |
| Tuần 2: Gateway | ☐ | |
| Tuần 3: Zone A Pilot | ☐ | |
| Tuần 4: Zone B/C | ☐ | |
| Tuần 5: Tinh chỉnh | ☐ | |
| Tuần 6: Go-Live | ☐ | |
