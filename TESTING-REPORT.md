# 🐛 SmartFarm DakLak — Kiểm thử & Báo cáo lỗi

> **Ngày kiểm thử:** 2026-06-13  
> **Phương pháp:** Deploy local, test toàn bộ REST API, WebSocket, edge cases, security, code review  
> **Tổng quan:** 102 tests executed, 8 bugs found (3 Critical, 3 Medium, 2 Low)

---

## 📊 Tổng quan kết quả

| Category | Tests | Passed | Failed |
|----------|-------|--------|--------|
| Simulator REST API | 21 | 21 | 0 |
| Smart Control REST API | 21 | 21 | 0 |
| Edge Cases & Security | 16 | 13 | 3 |
| Data Integrity & Logic | 19 | 19 | 0 |
| Code Review | 25 | 19 | 6 |
| **TỔNG** | **102** | **93** | **9** |

---

## 🔴 BUGS TÌM THẤY

### BUG #1 — CRITICAL: Import sai tên file (`et0` vs `eto`)
- **File:** `smart-control/server.js` dòng 15
- **Mô tả:** `require('./lib/et0')` (số 0) nhưng file thực tế là `eto.js` (chữ O). Gây crash toàn bộ service.
- **Ảnh hưởng:** Smart Control không khởi động được. Không có symlink workaround thì service chết hoàn toàn.
- **Reproduce:**
  ```bash
  cd smart-control && node server.js
  # Error: Cannot find module './lib/et0'
  ```
- **Fix:** Đổi `require('./lib/et0')` → `require('./lib/eto')`
- **Severity:** 🔴 CRITICAL — Service không chạy được

---

### BUG #2 — CRITICAL: Hardcoded default passwords
- **File:** `smart-control/server.js` dòng ~95
- **Mô tả:** 3 tài khoản mặc định với password đơn giản:
  - `admin` / `admin123`
  - `operator` / `operator123`  
  - `viewer` / `viewer123`
- **Ảnh hưởng:** Bất kỳ ai cũng có thể đăng nhập với quyền admin. Điều khiển được toàn bộ bơm/van.
- **Reproduce:**
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' \
    http://localhost:3002/api/auth/login
  # Returns: 200 OK with JWT token
  ```
- **Fix:** 
  1. Yêu cầu đổi password lần đầu đăng nhập
  2. Hoặc đọc password từ environment variable
  3. Thêm password policy (độ dài, phức tạp)
- **Severity:** 🔴 CRITICAL — Bảo mật, ai cũng có quyền admin

---

### BUG #3 — CRITICAL: JWT Secret hardcoded
- **File:** `smart-control/server.js` dòng ~48
- **Mô tả:** `JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production'`. Nếu không set env var, secret là chuỗi cố định, ai cũng có thể forge JWT token.
- **Ảnh hưởng:** Attacker có thể tạo JWT token hợp lệ mà không cần đăng nhập.
- **Fix:** 
  1. Bắt buộc set `JWT_SECRET` env var, không có default
  2. Hoặc generate random secret khi khởi động (nhưng sẽ invalidate tokens khi restart)
- **Severity:** 🔴 CRITICAL — Bảo mật, có thể bypass auth hoàn toàn

---

### BUG #4 — MEDIUM: CSV Export lỗi duplicate field
- **File:** `smart-control/server.js` dòng ~960
- **Mô tả:** 
  ```javascript
  nitrogen: d.nitrogen || d.nitrogen,  // ← No-op, duplicate
  ```
  Dòng này vô nghĩa — `d.nitrogen || d.nitrogen` luôn trả về `d.nitrogen`. Có thể intended là `d.nitrogen || d.N` hoặc một field name khác.
- **Ảnh hưởng:** Nếu data từ InfluxDB dùng field name khác (ví dụ `N` thay vì `nitrogen`), giá trị sẽ bị null trong CSV export.
- **Fix:** Kiểm tra đúng field name từ InfluxDB response.
- **Severity:** 🟡 MEDIUM — Data loss trong export

---

### BUG #5 — MEDIUM: `POST /api/control` trả 200 khi actuator không tồn tại
- **File:** `smart-control/server.js` dòng ~700
- **Mô tả:** Khi gửi `actuatorId: "fake-pump"`, API trả `{"success": false}` với HTTP 200 thay vì 404.
- **Ảnh hưởng:** Client không phân biệt được "actuator không tồn tại" vs "actuator tồn tại nhưng lỗi". Gây confusion khi debug.
- **Reproduce:**
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"actuatorId":"fake-pump","action":"on"}' \
    http://localhost:3002/api/control
  # Returns: 200 {"success":false} — should be 404
  ```
- **Fix:** Kiểm tra `actuators[actuatorId]` tồn tại trước khi gọi `controlActuator()`, trả 404 nếu không tìm thấy.
- **Severity:** 🟡 MEDIUM — API design issue

---

### BUG #6 — MEDIUM: CORS wildcard `*` — không an toàn cho production
- **File:** `smart-control/server.js` dòng ~35 và `simulator/server.js` dòng ~22
- **Mô tả:** `Access-Control-Allow-Origin: *` cho phép bất kỳ domain nào truy cập API.
- **Ảnh hưởng:** Attacker có thể gọi API từ bất kỳ website nào. Kết hợp với hardcoded JWT secret = có thể điều khiển bơm/van từ xa.
- **Fix:** Chỉ cho phép origin cụ thể trong production:
  ```javascript
  const ALLOWED_ORIGINS = process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3002'];
  ```
- **Severity:** 🟡 MEDIUM — Security, nhưng cần kết hợp với auth bypass mới exploit được

---

### BUG #7 — LOW: Simulator không validate input types
- **File:** `simulator/server.js` dòng ~544 (update_param) và `/api/publish`
- **Mô tả:** API chấp nhận mọi kiểu dữ liệu cho sensor values:
  - `{"moisture": true}` → `parseFloat(true)` = NaN → fallback to existing value
  - `{"moisture": [1,2,3]}` → `parseFloat("1,2,3")` = 1 → silently accepted
  - `{"moisture": "<script>alert(1)</script>"}` → `parseFloat(...)` = NaN → fallback
- **Ảnh hưởng:** Không gây crash nhưng là thiếu validation. Trong production có thể gây dữ liệu sai nếu client gửi nhầm kiểu.
- **Fix:** Thêm type check:
  ```javascript
  if (typeof value !== 'number' && typeof value !== 'string') return;
  const num = Number(value);
  if (!Number.isFinite(num)) return;
  ```
- **Severity:** 🟢 LOW — Không crash nhưng thiếu robustness

---

### BUG #8 — LOW: Node-RED decoder thiếu đóng ngoặc `{`
- **File:** `docs/planning/deployment-guide.md` dòng ~230
- **Mô tả:** Code sample Node-RED function node thiếu `}` sau `return null;`:
  ```javascript
  if (bytes.length < 16) {
      node.warn("Payload too short: " + bytes.length);
      return null;
  // ← Missing closing brace!
  ```
- **Ảnh hưởng:** Developer copy-paste code này sẽ gặp syntax error trong Node-RED.
- **Fix:** Thêm `}` sau `return null;`
- **Severity:** 🟢 LOW — Documentation bug, không ảnh hưởng runtime

---

## ⚠️ CẢNH BÁO (không phải bug nhưng cần lưu ý)

### WARNING #1: Không có Rate Limiting
- 50 requests liên tiếp không bị rate limit
- Risk: Brute-force password, DoS

### WARNING #2: MQTT reconnect loop khi không có broker
- Smart Control liên tục reconnect MQTT mỗi 5 giây khi không có broker
- Tạo log spam liên tục: `[MQTT] Error: ... Disconnected, will auto-reconnect...`
- Nên có backoff strategy hoặc limit reconnect attempts

### WARNING #3: Advisory依赖MQTT data flow
- Advisory API sử dụng `zoneSensorData` — chỉ được cập nhật qua MQTT
- Khi MQTT disconnected, advisory luôn trả về giá trị mặc định (55% moisture)
- Không có fallback để cập nhật sensor data qua REST API

### WARNING #4: Weather API hardcoded coordinates
- Open-Meteo call sử dụng DakLak coordinates (12.75, 108.35)
- Không thể deploy cho vùng khác mà không sửa code

### WARNING #5: `totalSent` counter chỉ đếm MQTT sends
- Simulator `totalSent` chỉ tăng khi MQTT publish thành công
- Web UI updates không được đếm → counter luôn = 0 khi MQTT disconnected

---

## 📋 Test Coverage Summary

### Simulator (21/21 passed)
- ✅ Health, Status, Scenarios, Faults endpoints
- ✅ Preset (drought, flooding, saline, acidic, nutrient_deficient)
- ✅ Auto mode on/off
- ✅ Publish sensor data
- ✅ Scenario start/stop
- ✅ Fault inject/clear
- ✅ Actuator feedback
- ✅ Error handling (invalid preset, missing type, invalid actuator key)

### Smart Control (21/21 passed)
- ✅ Health (no auth required)
- ✅ Login (valid, wrong password, missing fields, empty body)
- ✅ Auth enforcement (no token, invalid token)
- ✅ Zones, Actuators, Advisory, Weather, Crop-stages, History
- ✅ Control (pump on/off, valve open/close)
- ✅ Role-based access (viewer=403, operator=200, admin=200)
- ✅ Input validation (invalid action, missing fields, non-string)

### Edge Cases (13/16 passed)
- ✅ SQL injection in username
- ✅ Very long username
- ✅ All-zero sensor values
- ✅ Max sensor values
- ✅ History with limit
- ✅ OPTIONS preflight
- ✅ Expired/empty/malformed JWT tokens
- ❌ XSS in numeric field (accepted without validation)
- ❌ CORS wildcard
- ❌ No rate limiting

### Data Integrity (19/19 passed)
- ✅ Drought/flooding/saline presets set correct values
- ✅ Advisory returns valid urgency and crop stage
- ✅ All 3 zones have advisories
- ✅ Zone has all required fields
- ✅ Actuator state transitions (on/off, open/closed)
- ✅ Weather data (temp, humidity, source)
- ✅ Scenario engine (start/stop)
- ✅ Fault injection (inject/list/clear)

---

## 🎯 Khuyến nghị ưu tiên fix

1. **BUG #1** (et0 vs eto) — Fix ngay, service không chạy được
2. **BUG #2** (default passwords) — Fix trước khi deploy production
3. **BUG #3** (JWT secret) — Fix trước khi deploy production
4. **BUG #4** (CSV export) — Fix khi có thời gian
5. **BUG #5** (actuator 404) — Fix khi có thời gian
6. **BUG #6** (CORS) — Fix trước khi deploy production
7. **BUG #7** (input validation) — Fix khi có thời gian
8. **BUG #8** (Node-RED docs) — Fix khi có thời gian
