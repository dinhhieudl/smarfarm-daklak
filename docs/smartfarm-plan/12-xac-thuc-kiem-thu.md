# 12 - XÁC THỰC & KIỂM THỬ

## 1. Checklist Kiểm Thử Tổng Hợp

### 1.1 Hardware Tests

| # | Test case | Expected | Actual | Pass/Fail |
|---|-----------|----------|--------|-----------|
| H1 | Gateway powers on with antenna | LED ON, no error | | ☐ |
| H2 | Gateway appears in ChirpStack | Status "Online" | | ☐ |
| H3 | Gateway receives LoRa packets | Packet count > 0 | | ☐ |
| H4 | E78-DTU joins OTAA | Status "Join" | | ☐ |
| H5 | Sensor returns valid temp | 20-40°C | | ☐ |
| H6 | Sensor returns valid moisture | 20-80% VWC | | ☐ |
| H7 | Sensor returns valid EC | 100-2000 μS/cm | | ☐ |
| H8 | Sensor returns valid NPK | N>0, P>0, K>0 | | ☐ |
| H9 | Sensor returns valid pH | 4.0-8.0 | | ☐ |
| H10 | Sensor matches manual test | ±10% | | ☐ |
| H11 | Relay activates on command | Click sound | | ☐ |
| H12 | Valve opens on ON command | Water flow | | ☐ |
| H13 | Valve closes on OFF command | No flow | | ☐ |
| H14 | Pump starts on ON command | Motor runs | | ☐ |
| H15 | Pump stops on OFF command | Motor stops | | ☐ |
| H16 | Solar charges battery | Controller LED | | ☐ |
| H17 | Battery sustains night | 8h without solar | | ☐ |
| H18 | LoRa range > 500m | RSSI > -110 dBm | | ☐ |

### 1.2 Software Tests

| # | Test case | Expected | Actual | Pass/Fail |
|---|-----------|----------|--------|-----------|
| S1 | Docker stack starts | All services "Up" | | ☐ |
| S2 | ChirpStack Web UI accessible | Login page loads | | ☐ |
| S3 | Node-RED flow processes data | Data in debug | | ☐ |
| S4 | InfluxDB stores data | Query returns rows | | ☐ |
| S5 | Grafana shows realtime | Dashboard loads | | ☐ |
| S6 | Smart Control dashboard loads | UI renders | | ☐ |
| S7 | JWT auth works | Login with 3 roles | | ☐ |
| S8 | Irrigation API responds | POST /api/irrigation/start | | ☐ |
| S9 | Advisory generates per zone | 6 stages detected | | ☐ |
| S10 | Alerts trigger at thresholds | Toast notification | | ☐ |
| S11 | Weather API returns data | DakLak coordinates | | ☐ |
| S12 | Data export CSV works | File downloads | | ☐ |
| S13 | Data export JSON works | Valid JSON | | ☐ |
| S14 | 128 unit tests pass | 0 failures | | ☐ |
| S15 | ESLint passes | 0 errors | | ☐ |

### 1.3 Integration Tests

| # | Test case | Expected | Actual | Pass/Fail |
|---|-----------|----------|--------|-----------|
| I1 | Full pipeline: Sensor → Dashboard | Data appears < 30s | | ☐ |
| I2 | Auto-irrigation trigger | Start < 60s after low moisture | | ☐ |
| I3 | Rain pause | Irrigation stops during rain | | ☐ |
| I4 | Multi-zone irrigation | A + B run simultaneously | | ☐ |
| I5 | Emergency stop | All off within 2s | | ☐ |
| I6 | Advisory per crop stage | Correct advice generated | | ☐ |
| I7 | Dashboard all panels render | No "No data" errors | | ☐ |
| I8 | Audit log records all actions | Log entries exist | | ☐ |
| I9 | Rate limiter works | >10 req/s blocked | | ☐ |
| I10 | Login logout cycle | Token invalidated on logout | | ☐ |

---

## 2. Test Cases Chi Tiết

### TC-01: Sensor Reading Accuracy

```
Mục tiêu: Đảm bảo sensor đọc chính xác

Setup:
  - Đặt sensor trong vùng đất có độ ẩm known
  - Dùng tensiometer hoặc lab measurement làm ground truth

Test steps:
  1. Đo thủ công: moisture = 40% VWC (lab)
  2. Đọc từ sensor: moisture = X%
  3. Tính sai số: |X - 40| / 40

Expected:
  - Sai số < 10% (tức 36-44% khi ground truth = 40%)
  
Pass criteria: |sensor - manual| / manual < 0.10
```

### TC-02: LoRa Packet Delivery Rate

```
Mục tiêu: Đảm bảo LoRa reliable

Setup:
  - Gateway đã online
  - Node ở vị trí deployment thực tế

Test steps:
  1. Configure node gửi 100 packet (mỗi 10s)
  2. Đếm packet nhận được trên ChirpStack
  3. Tính delivery rate = received / 100

Expected:
  - Delivery rate > 95% (tại khoảng cách < 1km)
  - RSSI > -120 dBm
  - SNR > -10 dB

Pass criteria: delivered_count / total_count > 0.95
```

### TC-03: Irrigation Auto-Trigger

```
Mục tiêu: Verify tự động tưới khi đất khô

Setup:
  - Zone A configured
  - moistureMin = 30%
  - Cooldown đã hết

Test steps:
  1. Đặt sensor trong vùng đất khô (moisture ~25%)
  2. Đợi Smart Control đọc data (5 phút)
  3. Ghi nhận thời gian trigger irrigation
  4. Verify: valve mở, bơm chạy

Expected:
  - Auto-irrigation starts within 60 seconds sau khi moisture < 30%
  - Valve mở, bơm chạy
  - Duration theo calculate

Pass criteria: irrigation_start_time - trigger_time < 60s
```

### TC-04: Rain Pause Functionality

```
Mục tiêu: Verify tưới dừng khi mưa

Setup:
  - Đang tưới (bơm ON)
  - rainPause = true
  - rainThreshold = 5mm

Test steps:
  1. Simulate rainfall > 5mm (hoặc chờ mưa thật)
  2. Verify: bơm tắt, van đóng
  3. Chờ mưa tạnh + 30 phút
  4. Verify: kiểm tra moisture, resume nếu cần

Expected:
  - Bơm tắt trong 10s sau khi mưa detected
  - Không tưới trong suốt mưa + 30 phút buffer
  - Resume tưới sau khi hết rain pause

Pass criteria: No irrigation during rain + 30min buffer
```

### TC-05: Emergency Stop

```
Mục tiêu: Verify emergency stop hoạt động

Setup:
  - Đang tưới (bơm ON, van OPEN)

Test steps:
  1. POST /api/irrigation/emergency-stop
  2. Ghi nhận thời gian
  3. Verify: bơm OFF, van CLOSED
  4. Verify: audit log ghi nhận

Expected:
  - Tất cả actuators OFF trong 2 giây
  - Audit log: "EMERGENCY STOP" entry
  - Dashboard: alert "Emergency Stop Activated"

Pass criteria: all_actuators_off within 2000ms
```

---

## 3. Performance Targets

| Metric | Target | Cách đo |
|--------|--------|---------|
| Sensor reading interval | 5 min | AT+MBINTV=300 |
| End-to-end latency | < 30s | Sensor → Dashboard |
| Gateway packet loss | < 5% | ChirpStack statistics |
| Dashboard load time | < 3s | Browser developer tools |
| Irrigation response time | < 60s | Trigger → valve open |
| System uptime | > 99% | Monthly monitoring |
| Data retention | 1 year | InfluxDB retention policy |
| API response time | < 200ms | Average over 100 requests |
| MQTT message latency | < 5s | Publish → subscribe |

---

## 4. Alert Rules (Grafana)

| Alert | Condition | Severity | Action |
|-------|----------|----------|--------|
| Sensor Offline | No data > 15 min | Critical | Notification |
| Gateway Offline | Not seen > 5 min | Critical | Notification |
| Soil Too Dry | Moisture < 15% | Critical | Auto-irrigate |
| Soil Too Wet | Moisture > 85% | Warning | Check drainage |
| Temperature High | Soil temp > 40°C | Warning | Log |
| pH Extreme | pH < 4.5 or > 8.5 | Warning | Log + advisory |
| EC High | EC > 1500 μS/cm | Warning | Reduce fertilize |
| NPK Low | N<30, P<15, K<60 | Info | Advisory |
| Irrigation Failed | Pump ON but no flow | Critical | Emergency stop |
| Disk Full | InfluxDB > 80% | Warning | Cleanup old data |

---

## 5. Monitoring Dashboard

### System Health Panel

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| Docker containers | 10/10 running | 8-9 running | < 8 running |
| CPU usage | < 50% | 50-80% | > 80% |
| RAM usage | < 60% | 60-85% | > 85% |
| Disk usage | < 60% | 60-80% | > 80% |
| MQTT connections | All nodes connected | 1 node lost | > 1 node lost |
| InfluxDB write rate | Normal | Slow | Failed |

### Data Quality Panel

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| Packet delivery | > 95% | 85-95% | < 85% |
| Data freshness | < 10 min old | 10-30 min old | > 30 min old |
| Sensor range | Within bounds | 1 outlier | Multiple outliers |
| Null values | 0% | < 5% | > 5% |
