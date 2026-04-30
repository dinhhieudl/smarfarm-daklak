# SESSION_CONTEXT.md - SmartFarm DakLak

## Hệ thống hiện tại

### Kiến trúc tổng thể
```
Cảm biến đất → E90-DTU (LoRa) → E870 Gateway → ChirpStack → Node-RED → InfluxDB → Grafana
                                                                      ↕
                                                              Smart Control Service
                                                              (Điều khiển + Tư vấn)
```

### Phần cứng đã có
- Gateway: E870-L915LG12 (LoRaWAN concentrator)
- Node: E78-DTU(900LN22) — LoRaWAN node (RS485 bridge)
- Node: E90-DTU(900SL22) — LoRa data radio (backup)
- Cảm biến: Soil Multi-Parameter (Temp/Moisture/EC/NPK/pH)

### Docker Stack (server/docker-compose.yml)
| Service | Port | Vai trò |
|---------|------|---------|
| ChirpStack | 8080 | LoRaWAN Network Server |
| Node-RED | 1880 | Data Processing |
| InfluxDB | 8086 | Time-Series DB |
| Grafana | 3005 | Dashboard |
| Mosquitto | 1883 | MQTT Broker |
| Smart Control | 3002 | 🆕 Điều khiển + Tư vấn |

### Simulator (simulator/)
- Web UI: http://localhost:3001
- Publish soil data qua MQTT theo format ChirpStack v4
- 6 scenario presets: Normal, Drought, Flooding, Nutrient Deficient, Saline, Acidic
- 8 thông số: Temperature, Moisture, EC, Salinity, N, P, K, pH

## 🆕 Tính năng mới: Smart Control & Advisory (smart-control/)

### Dashboard: http://localhost:3002

#### 1. Điều khiển thông minh
- **3 Zones**: Khu A (Robusta 5000m²), Khu B (Robusta 3500m²), Khu C (Arabica 2000m²)
- **5 Actuators**: 2 bơm chính + 3 van khu vực
- **Điều khiển thủ công**: Bật/tắt bơm, mở/đóng van qua web UI
- **Quick Irrigate**: Tưới nhanh 1 click (bật bơm + mở van khu vực)
- **MQTT Downlink**: Publish control commands qua ChirpStack → LoRa → E90-DTU → Actuator

#### 2. Tưới tự động (Auto Irrigation)
- **Ngưỡng độ ẩm**: Tưới khi moisture < min, dừng khi > max
- **Rain Pause**: Dừng tưới tự động khi mưa > ngưỡng (mm)
- **Cooldown**: Nghỉ giữa 2 lần tưới (phút)
- **Timeout**: Tắt bơm sau thời gian tưới tối đa
- **Rule Editor**: Cấu hình riêng cho từng zone

#### 3. Tư vấn thông minh theo giai đoạn cây trồng
- **Cà phê Robusta**: 6 giai đoạn (Nghỉ → Ra hoa → Đậu quả → Phát triển → Chín → Thu hoạch)
- **Cà phê Arabica**: 6 giai đoạn tương tự (nhạy cảm nước hơn)
- **Tư vấn tưới**: Tần suất, lưu lượng, thời điểm phù hợp
- **Tư vấn bón phân**: NPK recommendation theo giai đoạn
- **Cảnh báo rủi ro**: Sâu bệnh, thời tiết, stress cây trồng
- **Timeline trực quan**: Hiển thị giai đoạn hiện tại trên timeline

#### 4. Thời tiết DakLak
- Nhiệt độ, độ ẩm, mưa, gió, mây
- Dự báo 3 ngày
- Tích hợp vào quyết định tưới (dừng khi mưa, tăng khi nắng nóng)

### REST API
- `GET /api/zones` — Danh sách zones + sensor data + stage
- `GET /api/actuators` — Trạng thái tất cả actuators
- `POST /api/control` — Điều khiển actuator {actuatorId, action}
- `GET /api/advisory/:zoneId` — Tư vấn cho zone
- `GET /api/weather` — Thời tiết hiện tại
- `GET /api/crop-stages` — Knowledge base giai đoạn cây trồng

## Kế hoạch tiếp theo
- [ ] Gateway firmware & ChirpStack setup (cần hardware)
- [ ] Node configuration (reconfigure DTU từ 868MHz → AS923)
- [ ] Sensor ↔ Node RS485 wiring & Modbus test
- [ ] Tích hợp Open-Meteo API cho thời tiết thực
- [ ] Thêm ESP32 relay controller cho bơm/van thực
- [ ] Mobile app / PWA cho remote control
