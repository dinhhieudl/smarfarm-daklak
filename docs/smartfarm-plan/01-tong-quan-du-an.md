# 01 - TỔNG QUAN DỰ ÁN

## 1. Mục Tiêu

Xây dựng hệ thống nông nghiệp thông minh (Smart Farm) áp dụng cho vùng trồng cà phê tại **Đắk Lắk**, sử dụng công nghệ **LoRaWAN** để:
- Giám sát điều kiện đất real-time (nhiệt độ, độ ẩm, EC, NPK, pH)
- Tự động hóa tưới tiêu theo nhu cầu thực tế của cây
- Tư vấn chăm sóc cà phê theo từng giai đoạn phát triển
- Giảm lãng phí nước, tăng năng suất cà phê

## 2. Phạm Vi

### 2.1 Địa điểm
- **Vị trí:** Buôn Ma Thuột, Đắk Lắk, Việt Nam
- **Tọa độ:** 12.6667°N, 108.0500°E
- **Độ cao:** ~500m so với mực nước biển
- **Khí hậu:** Nhiệt đới gió mùa, 2 mùa rõ rệt (khô: Nov-Apr, mưa: May-Oct)
- **Nhiệt độ trung bình:** 22-28°C
- **Lượng mưa trung bình:** 1,500-2,500mm/năm

### 2.2 Diện Tích & Khu Vực

| Khu | Diện tích | Loại cà phê | Đặc điểm đất |
|-----|-----------|-------------|-------------|
| A | 5,000 m² | Robusta | Đất bazan đỏ |
| B | 3,500 m² | Robusta | Đất bazan |
| C | 2,000 m² | Arabica | Đất phù sa |
| **Tổng** | **10,500 m²** | | |

### 2.3 Số Lượng Thiết Bị

| Thiết bị | Số lượng | Vai trò |
|----------|----------|---------|
| Gateway LoRaWAN | 1 | Tập hợp dữ liệu từ các node |
| Node LoRaWAN (E78-DTU) | 3 | Đọc sensor, gửi data qua LoRa |
| Soil Sensor 8-tham-số | 3 | Đo nhiệt độ, độ ẩm, EC, NPK, pH |
| Van tưới điện tử | 3 | Điều khiển nước tưới từng khu |
| Máy bơm nước | 2 | Bơm chính + dự phòng |
| Relay module | 1 | Điều khiển bơm + van |

## 3. Tính Năng Chính

### 3.1 Giám Sát Đất (Soil Monitoring)
- **8 tham số:** Nhiệt độ, Độ ẩm (% VWC), EC (μS/cm), Độ mặn, N (mg/kg), P (mg/kg), K (mg/kg), pH
- **Tần suất:** Mỗi 5 phút (cấu hình được)
- **Lưu trữ:** InfluxDB time-series, giữ 1 năm
- **Hiển thị:** Grafana dashboard realtime + lịch sử

### 3.2 Tự Động Tưới (Auto Irrigation)
- Tưới theo ngưỡng độ ẩm đất (min/max per zone)
- Dự báo tưới dựa trên ET0 (Hargreaves-Samani) + weather API
- Tự động dừng khi mưa
- Cooldown chống tưới thừa
- Cửa sổ tưới (tránh 11:00-15:00)

### 3.3 Tư Vấn Cà Phê (Crop Advisory)
- Tự động detect giai đoạn phát triển (6 giai đoạn)
- Khuyến nghị bón phân theo NPK hiện tại
- Cảnh báo pH, EC ngoài ngưỡng
- Phân biệt Robusta & Arabica

### 3.4 Cảnh Báo (Alerting)
- Ngưỡng đất: độ ẩm, nhiệt độ, pH, EC
- Hệ thống: sensor offline, gateway offline
- Tưới: bơm chạy bất thường
- Gửi toast notification trên dashboard

### 3.5 Dashboard
- Web UI responsive (mobile-first)
- Dark/Light theme
- Chart.js historical charts
- Login với 3 vai trò (admin/operator/viewer)
- Audit log toàn bộ hành động

### 3.6 Dự Phòng
- ChirpStack chạy local (không cần internet cho LoRaWAN)
- Rain pause tự động
- Emergency stop一键tắt tất cả bơm/van
- Power: solar + pin dự phòng

## 4. Công Nghệ Sử Dụng

| Thành phần | Công nghệ | Phiên bản |
|-----------|-----------|----------|
| LoRaWAN | AS923 band, DR2 (SF10/125kHz) | 1.0.3 |
| Gateway | EByte E870-L915LG12 (SX1302) | - |
| Node | EByte E78-DTU(900LN22) | Chip 6601 |
| Sensor | Soil Multi-Parameter RS485 | IP68, 316L inox |
| Network Server | ChirpStack v4 | 4.x |
| MQTT Broker | Eclipse Mosquitto | 2.x |
| Data Pipeline | Node-RED | Latest |
| Time-Series DB | InfluxDB | 2.7 |
| Dashboard | Grafana | Latest |
| Backend | Node.js + Express | 20 LTS |
| Frontend | Vanilla JS + Chart.js | - |
| Container | Docker + Docker Compose | 20.10+ |
| Testing | Jest | 30.4 |
| Linting | ESLint (flat config) | 10.5 |

## 5. Limitation & Rủi Ro

| Rủi ro | Mức độ | Giải pháp |
|--------|--------|----------|
| Mất internet | Cao (DakLak nông thôn) | Hệ thống chạy local, internet chỉ cần cho weather API |
| Mất điện | Trung bình | Solar + pin 12V/7Ah, UPS cho máy chủ |
| Mùa mưa gây ngập | Trung bằng | Sensor IP68, tủ IP65, chống ngập |
| LoRa mất kết nối | Thấp | Antenne cao ≥3m, DR2 (SF10), retry |
| Sensor hỏng | Thấp | 316L inox, IP68, bảo hành 1 năm |
| Gateway hỏng | Thấp | E870 rated -40°C đến +85°C |
