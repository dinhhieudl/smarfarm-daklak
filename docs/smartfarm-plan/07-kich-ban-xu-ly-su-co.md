# 07 - KỊCH BẢN XỬ LÝ SỰ CỐ

## 1. Bảng Xử Lý Sự Cố

| # | Sự cố | Nguyên nhân | Dấu hiệu | Xử lý |
|---|--------|------------|----------|--------|
| 1 | **Gateway offline** | Mất nguồn, mất Ethernet | ChirpStack: Gateway "Offline" | Kiểm tra nguồn, Ethernet, restart gateway |
| 2 | **Node không join** | Sai DevEUI/AppKey, sai frequency | ChirpStack: Device "Joining" loop | Verify AT commands, kiểm tra region AS923 |
| 3 | **Data sai giá trị** | Sai byte order, sensor lỗi | Giá trị quá cao/thấp bất thường | Kiểm tra big-endian decode, test Modbus trực tiếp |
| 4 | **Sensor timeout** | Sai baud rate, sai address | Giá trị giữ nguyên cũ (stale) | Verify baud=9600, addr=0x02, check wiring |
| 5 | **Van không mở** | Relay lỗi, nguồn không đủ | Lệnh ON nhưng van không mở | Test relay thủ công, kiểm tra nguồn 12V |
| 6 | **Máy bơm không chạy** | Relay lỗi, bơm hỏng | Van mở nhưng không có nước | Test bơm trực tiếp, kiểm tra điện |
| 7 | **Dashboard không hiện data** | InfluxDB down, Node-RED flow lỗi | Grafana "No data" | Kiểm tra InfluxDB, restart Node-RED |
| 8 | **Tưới liên tục (lặp)** | Logic tưới lỗi, sensor stuck | Bơm chạy không dừng | Kiểm tra Smart Control logs, emergency stop |
| 9 | **LoRa mất kết nối** | Antenne hỏng, vật cản | RSSI < -120 dBm, packet loss > 10% | Kiểm tra antenne, nâng cao hơn |
| 10 | **Mất điện kéo dài** | Pin solar hết | Hệ thống chết | Nguồn bổ sung, pin dự phòng |

---

## 2. Chi Tiết Xử Lý Từng Sự Cố

### Sự Cố 1: Gateway Offline

```
Triệu chứng:
  - ChirpStack Web UI: Gateway status "Offline"
  - Không có uplink packet mới

Kiểm tra:
  1. Ping gateway IP: ping 192.168.x.x
  2. Nếu không ping được:
     ├── Kiểm tra nguồn 12V (đo bằng VOM)
     ├── Kiểm tra Ethernet cable
     └── Kiểm tra LED trên gateway
  3. Nếu ping được nhưng ChirpStack không thấy:
     ├── Kiểm tra firewall: sudo ufw allow 1700/udp
     ├── Kiểm tra packet forwarder config
     └── Restart gateway bridge: docker compose restart gateway-bridge

Xử lý:
  - Nếu mất nguồn: cấp lại nguồn
  - Nếu mất Ethernet: kiểm tra cable, router
  - Nếu lỗi config: reconfigure qua EByte Config Tool
```

### Sự Cố 2: Node Không Join

```
Triệu chứng:
  - ChirpStack: Device status "Joining" hoặc "Join request received" liên tục
  - Không có data mới

Kiểm tra:
  1. AT+JOIN? → "not joined"
  2. Kiểm tra AT commands:
     AT+DEVEUI? → So sánh với ChirpStack device EUI
     AT+APPKEY? → So sánh với ChirpStack app key
     AT+BAND?   → Phải là 7 (AS923)
  3. Kiểm tra antenne node
  4. Kiểm tra khoảng cách đến gateway (< 3km)

Xử lý:
  - Sai DevEUI/AppKey: nhập lại đúng AT commands
  - Sai band: AT+BAND=7
  - Antenne hỏng: thay antenne
  - Quá xa: di chuyển node closer hoặc tăng DR
```

### Sự Cố 3: Data Sai Giá Trị

```
Triệu chứng:
  - Nhiệt độ: -100°C hoặc 500°C (bất thường)
  - Độ ẩm: > 100% hoặc < 0%
  - EC: 0 hoặc 65535 (max value)

Kiểm tra:
  1. Decode thủ công 16-byte payload
  2. Kiểm tra byte order: big-endian hay little-endian?
  3. Kiểm tra signed vs unsigned cho temperature

Xử lý:
  - Sai byte order: sửa payload decoder
  - Sai signed/unsigned: kiểm tra register 0 (temp)
  - Sensor thực sự lỗi: thay sensor
```

### Sự Cố 8: Tưới Liên Tục (Emergency)

```
⚠️ NGHIÊM TRỌNG: Bơm chạy không dừng có thể gây ngập, lãng phí nước

Triệu chứng:
  - Bơm/van vẫn ON sau maxDurationMin
  - Tưới lặp lại liên tục không có cooldown

Nguyên nhân:
  - Smart Control crash giữa chừng
  - Sensor đọc sai (moisture luôn thấp)
  - Logic tưới bug

Xử lý NGAY LẬP TỨC:
  1. Gửi emergency stop:
     POST http://<server>:3002/api/irrigation/emergency-stop
  2. Nếu API không hoạt động:
     ├── Tắt relay nguồn (ngắt circuit breaker)
     └── Hoặc tắt nguồn bơm thủ công
  3. Kiểm tra audit log:
     GET http://<server>:3002/api/audit?limit=50
  4. Xác định nguyên nhân:
     ├── Sensor lỗi → reboot node, test Modbus
     ├── Logic lỗi → check irrigation-rules.json
     └── Relay kẹt → ngắt nguồn relay thủ công
  5. Sửa lỗi trước khi resume
```

---

## 3. Emergency Stop - Hướng Dẫn Chi Tiết

### 3.1 Cách 1: API Call
```bash
curl -X POST http://<server>:3002/api/irrigation/emergency-stop \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json"
```

**Kết quả:**
- Tất cả bơm: OFF
- Tất cả van: OFF (NC - normally closed)
- Audit log: ghi nhận "EMERGENCY STOP"
- Dashboard: hiển thị alert "Emergency Stop Activated"

### 3.2 Cách 2: Physical Override
```
1. Tìm bảng điện / relay module
2. Tắt CB (circuit breaker) cho bơm
3. Hoặc rút dây nguồn relay
4. Verify: bơm dừng, van đóng
```

### 3.3 Sau Emergency Stop
```
1. Xác định nguyên nhân (xem section 2, sự cố 8)
2. Sửa lỗi
3. Test lại từng zone:
   - Zone A: POST /api/irrigation/start { "zoneId": "zone-A", "durationMin": 1 }
   - Verify: van mở, bơm chạy, tắt đúng hạn
4. Lặp lại cho Zone B, C
5. Resume vận hành bình thường
6. Ghi nhận sự cố vào audit log
```

---

## 4. Khôi Phục Sau Sự Cố

### 4.1 Restart Toàn Bộ Stack
```bash
docker compose restart
# Kiểm tra
docker compose ps
```

### 4.2 Khôi Phục InfluxDB (Nếu Corrupt)
```bash
docker compose stop influxdb
docker compose rm influxdb
rm -rf influxdb-data/*
docker compose up -d influxdb
# Node-RED sẽ tự động ghi data mới
# Data cũ sẽ mất (đã backup hàng tháng)
```

### 4.3 Khôi Phục Node-RED Flow
```bash
# Import lại flow từ file config
# Mở Node-RED UI → Menu → Import → Chọn config/node-red-flows.json
```

### 4.4 Khôi Phục ChirpStack Config
```bash
# Re-import chirpstack.toml
docker compose restart chirpstack
# Re-register devices trên Web UI nếu cần
```

### 4.5 Khôi Phục Gateway Config
```
1. Mở EByte Config Tool
2. Kết nối gateway
3. Reconfigure:
   - Server Address: <IP máy chủ>
   - Server Port: 1700
   - Region: AS923
4. Apply & Restart gateway
```

---

## 5. Bảng Troubleshooting Nhanh

| Vấn đề | Kiểm tra đầu tiên | Lệnh/Thao tác |
|--------|-------------------|---------------|
| Gateway không start | Antenne đã gắn? | Kiểm tra vật lý |
| Node không join | DevEUI đúng? | `AT+DEVEUI?` |
| Data = 0 | Sensor có power? | Đo VCC sensor |
| Data sai | Byte order? | Decode thủ công |
| Van không mở | Relay có trigger? | Đo ON/OFF relay |
| Bơm không chạy | Nguồn 12V có? | Đo VOM |
| Dashboard trống | InfluxDB có data? | `docker compose logs influxdb` |
| MQTT không có data | Mosquitto chạy? | `mosquitto_sub -h localhost -t '#' -C 1` |
| ChirpStack error | Config đúng? | `docker compose logs chirpstack` |
| Node-RED flow dừng | Import lại flow? | Node-RED UI → Import |
