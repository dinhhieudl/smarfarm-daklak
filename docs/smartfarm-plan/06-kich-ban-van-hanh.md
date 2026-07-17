# 06 - KỊCH BẢN VẬN HÀNH

## 1. Kịch Bản Khởi Động Hệ Thống

### Bước 1: Cấp Nguồn Gateway (Trước)
```
1. Kiểm tra antenne LoRa đã gắn ✓
2. Cắm Ethernet cable vào router ✓
3. Cấp nguồn 12V/2A cho E870
4. Chờ 30s cho gateway khởi động
5. Kiểm tra:
   ├── LED Status: ON = bình thường
   ├── Ethernet: link active
   └── Trên ChirpStack: Gateway appears "Online"
```

### Bước 2: Khởi Động Docker Stack
```bash
cd smartfarm-daklak/server
docker compose up -d

# Chờ ~60s cho tất cả services ready
docker compose ps
# Mong đợi: Tất cả "Up"

# Kiểm tra từng service
docker compose logs chirpstack | tail -5    # "started"
docker compose logs mosquitto | tail -5    # "listening"
docker compose logs grafana | tail -5      # "HTTP Server Listen"
```

### Bước 3: Bật Nodes
```
1. Bật nguồn E78-DTU tại Khu A
2. Chờ OTAA join (~30s-2 phút)
3. Kiểm tra trên ChirpStack:
   ├── Device: "Join" status
   └── First uplink received
4. Lặp lại cho Khu B, Khu C
```

### Bước 4: Kiểm Tra Toàn Bộ
```
1. Mở Grafana dashboard → thấy data realtime từ 3 zones
2. Mở Smart Control UI → thấy 3 zones active
3. Test tưới thủ công:
   POST http://<server>:3002/api/irrigation/start
   Body: { "zoneId": "zone-A", "durationMin": 1 }
4. Verify: van mở, bơm chạy
5. Verify: audit log ghi nhận hành động
```

---

## 2. Kịch Bản Bình Thường (Normal Operation)

```
Mỗi 5 phút (300 giây):
│
├── [1] E78-DTU đọc 8 tham số từ soil sensor
│   └── Modbus RTU: query 02 03 00 00 00 08 44 0C
│
├── [2] E78-DTU gửi payload 16 bytes qua LoRa
│   └── AS923, DR2 (SF10/125kHz), AES-128
│
├── [3] E870 Gateway nhận → forward UDP
│   └── Port 1700 → Gateway Bridge
│
├── [4] Gateway Bridge convert → MQTT
│   └── Topic: as923/gateway/{GW_ID}/event/up
│
├── [5] ChirpStack decode payload
│   └── 16 bytes → {temp, moisture, ec, salinity, n, p, k, ph}
│
├── [6] Node-RED parse + validate
│   └── Write to InfluxDB: bucket=soil_data
│
├── [7] Smart Control xử lý
│   ├── Đọc data từ MQTT/InfluxDB
│   ├── Kiểm tra ngưỡng độ ẩm (moistureMin/Max per zone)
│   ├── Tính ET0 từ weather API (nếu cần)
│   ├── Quyết định tưới:
│   │   ├── IF moisture < moistureMin → TƯỚI
│   │   ├── IF moisture > moistureMax → KHÔNG TƯỚI
│   │   ├── IF rain_active → TẠM DỪNG
│   │   └── IF cooldown < 120min → CHỜ
│   ├── Điều khiển pump/valve (nếu tưới)
│   └── Cập nhật dashboard
│
└── [8] Dashboard hiển thị
    ├── Grafana: historical charts update
    └── Smart Control UI: realtime gauges update
```

---

## 3. Kịch Bản Tắt Hệ Thống

```
Bước 1: Tắt nodes TRƯỚC
├── Tắt nguồn E78-DTU tại mỗi khu
├── Đợi 1 phút để ChirpStack detect disconnect
└── Verify: Device status → "Offline"

Bước 2: Tắt Smart Control & Simulator
├── Ctrl+C (nếu chạy manual)
└── Hoặc: docker compose stop smart-control simulator

Bước 3: Tắt Docker Stack
├── docker compose down
└── Kiểm tra: docker compose ps → tất cả exited

Bước 4: Tắt Gateway CUỐI CÙNG
├── Tắt nguồn E870
└── Tháo antenne (nếu vận chuyển)
```

> **LƯU Ý:** Luôn tắt nodes TRƯỚC, gateway SAU. Nếu tắt gateway trước, nodes sẽ retry join liên tục, lãng phí pin.

---

## 4. Bảo Trì Định Kỳ

### 4.1 Hàng Ngày

| Thời điểm | Công việc | Cách thực hiện |
|-----------|----------|---------------|
| Sáng | Kiểm tra dashboard | Mở Grafana, xem data 24h gần nhất |
| Sáng | Kiểm tra alerts | Xem có alert nào active không |
| Chiều | Kiểm tra tưới | Verify tưới đã chạy đúng lịch |

### 4.2 Hàng Tuần

| Ngày | Công việc | Cách thực hiện |
|------|----------|---------------|
| Thứ 2 | Kiểm tra physical | Sensor có bị lệch? Cáp có bị đứt? |
| Thứ 2 | Kiểm tra van | Test ON/OFF từng van |
| Thứ 5 | Kiểm tra gateway | Verify ChirpStack, packet loss |
| Thứ 5 | Review audit log | Có hành động bất thường? |

### 4.3 Hàng Tháng

| Tuần | Công việc | Cách thực hiện |
|------|----------|---------------|
| Tuần 1 | Backup InfluxDB | `docker compose exec influxdb influx backup /tmp/backup` |
| Tuần 1 | Backup ChirpStack DB | `docker compose exec postgres pg_dump -U chirpstack chirpstack > backup.sql` |
| Tuần 2 | Update Docker images | `docker compose pull && docker compose up -d` |
| Tuần 2 | Kiểm tra disk usage | `docker system df` |
| Tuần 3 | Calibrate sensor | So sánh với measurement thủ công |
| Tuần 3 | Review irrigation rules | Điều chỉnh moistureMin/Max nếu cần |
| Tuần 4 | Kiểm tra solar | Panel có bị bẩn? Controller LED bình thường? |

### 4.4 Hàng Quý (3 tháng)

| Công việc | Cách thực hiện |
|----------|---------------|
| Calibrate sensor chi tiết | Lấy mẫu đất, đo trong lab, so sánh |
| Kiểm tra antenne | Đảm bảo không bị lỏng, oxi hóa |
| Kiểm tra ống nước | Có bị rò rỉ, tắc nghẽn? |
| Review performance | Packet loss rate, uptime, response time |

### 4.5 Hàng Năm

| Công việc | Cách thực hiện |
|----------|---------------|
| Thay pin solar | Lead-acid: thay sau 2-3 năm |
| Deep clean sensor | Rút probe, vệ sinh, calibration lại |
| Update firmware | Gateway, ChirpStack, Node-RED |
| Review toàn bộ | Đánh giá hiệu suất, nâng cấp nếu cần |
