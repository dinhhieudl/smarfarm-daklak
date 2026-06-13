# Hướng dẫn thêm một "Khu" (Zone) mới

> Mỗi khu (zone) = 1 sensor node LoRa + 1 van tưới + rules riêng  
> File này hướng dẫn từ giả lập (simulator) đến thật (hardware)

---

## Tổng quan flow

```
┌─────────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  Sensor Node    │────▶│   Gateway    │────▶│  ChirpStack   │────▶│  Node-RED    │
│  (LoRa + soil)  │     │  (E870)      │     │  (Network S)  │     │  (Decode)    │
└─────────────────┘     └──────────────┘     └───────────────┘     └──────┬───────┘
                                                                          │ MQTT
                                                                          ▼
                                                                   ┌──────────────┐
                                                                   │ Smart-Control│
                                                                   │  (Dashboard) │
                                                                   └──────────────┘
```

**Mỗi khu cần config ở 5 chỗ:**

| # | Chỗ | File/UI | Mô tả |
|---|------|---------|-------|
| 1 | Simulator | `simulator/server.js` | DevEUI + sensor offsets |
| 2 | Smart-Control zones | `smart-control/config/zones.json` | Tên, diện tích, crop, sensor |
| 3 | Smart-Control rules | `smart-control/config/irrigation-rules.json` | Rules tưới |
| 4 | Smart-Control actuators | `smart-control/config/actuators.json` | Van + bơm |
| 5 | ChirpStack | Web UI → Applications | Register device LoRa |

---

## Bước chi tiết

### Bước 1 — Chọn DevEUI

Mỗi sensor node LoRa có 1 DevEUI duy nhất (16 ký tự hex).

- **Giả lập:** Tự đặt, VD: `aabbccdd11223348`
- **Thật:** Đọc trên chip LoRa (STM32 + SX1276/SX1262), hoặc sticker trên PCB

### Bước 2 — Thêm vào Simulator

File: `simulator/server.js` → mảng `ZONE_SENSORS`

```js
const ZONE_SENSORS = [
  // ... các zone hiện có ...
  {
    devEUI: 'aabbccdd11223348',   // DevEUI mới
    zoneId: 'zone-B',              // ID định danh
    name: 'Khu B',                 // Tên hiển thị
    crop: 'robusta',               // robusta | arabica | catimor
    soilType: 'bazan-red',         // bazan-red | bazan-yellow
    offsets: {                     // Chênh lệch so với base data
      temperature: -0.5,           // °C
      moisture: 3,                 // %
      ec: -20,                     // µS/cm
      ph: 0.1,
      nitrogen: -5,                // mg/kg
      phosphorus: 2,
      potassium: -10
    }
  }
];
```

**Offsets là gì?**
- Simulator có 1 bộ data gốc (base)
- Mỗi zone = base + offsets → giả lập đất khác nhau giữa các khu
- VD: Khu A đất bazan đỏ → EC cao, Khu C đất bazan vàng → EC thấp hơn

### Bước 3 — Khai báo zone trong Smart-Control

#### 3a. `smart-control/config/zones.json`

```json
{
  "id": "zone-B",
  "name": "Khu B — Cà phê Robusta",
  "area": 3500,                    // Diện tích (m²)
  "crop": "robusta",
  "plantDate": "2023-06-01",
  "soilType": "bazan-red",
  "pumpId": "pump-1",              // Bơm nào phục vụ khu này
  "valveId": "valve-2",            // Van nào
  "moistureSensor": "aabbccdd11223348",  // DevEUI
  "location": { "lat": 12.76, "lng": 108.36 }
}
```

#### 3b. `smart-control/config/irrigation-rules.json`

```json
{
  "zone-B": {
    "enabled": true,
    "moistureMin": 35,        // Dưới 35% → tưới
    "moistureMax": 65,        // Trên 65% → dừng
    "maxDurationMin": 25,     // Tưới tối đa 25 phút
    "cooldownMin": 120,       // Nghỉ 2h giữa 2 lần tưới
    "rainPause": true,        // Dừng tưới nếu mưa
    "rainThreshold": 5,       // mm mưa → dừng tưới
    "lastIrrigation": null
  }
}
```

#### 3c. `smart-control/config/actuators.json`

```json
{
  "valve-2": {
    "id": "valve-2",
    "name": "Van khu B",
    "type": "valve",
    "state": "closed",
    "autoMode": false,
    "lastChange": null,
    "zone": "zone-B"
  }
}
```

Nếu khu mới dùng bơm mới → thêm cả pump entry.

### Bước 4 — Register device trên ChirpStack

1. Mở `http://localhost:8080` → Login
2. Vào **Applications** → chọn app (VD: `smartfarm-daklak`)
3. **Add Device**
   - DevEUI: `aabbccdd11223348`
   - Name: `soil-sensor-zone-B`
   - Device profile: chọn profile phù hợp (OTAA/ABP)
4. Set **Application Key** (nếu dùng OTAA)

### Bước 5 — Rebuild & Restart

```bash
cd server/

# Rebuild simulator + smart-control
docker compose up -d --build simulator smart-control

# Restart (nếu không rebuild)
docker compose restart simulator smart-control
```

### Bước 6 — Verify

```bash
# 1. Simulator có publish data không?
docker logs sf-simulator --tail 5

# 2. MQTT có data zone mới?
docker exec sf-mosquitto mosquitto_sub -h localhost \
  -t "application/smartfarm-daklak/device/aabbccdd11223348/event/up" -v -C 1 -W 10

# 3. Smart-control nhận zone mới?
docker logs sf-smart-control --tail 5
# → Phải thấy "Zones: 2" (hoặc nhiều hơn)

# 4. Dashboard hiện zone mới?
# Mở http://localhost:3002 → kiểm tra
```

---

## Checklist nhanh

- [ ] Chọn DevEUI
- [ ] Thêm `ZONE_SENSORS` trong `simulator/server.js`
- [ ] Thêm zone trong `smart-control/config/zones.json`
- [ ] Thêm rules trong `smart-control/config/irrigation-rules.json`
- [ ] Thêm valve/pump trong `smart-control/config/actuators.json`
- [ ] Register device trên ChirpStack (nếu dùng device thật)
- [ ] `docker compose up -d --build simulator smart-control`
- [ ] Verify trên dashboard

---

## Troubleshooting

| Vấn đề | Nguyên nhân | Fix |
|--------|-------------|-----|
| Dashboard không hiện zone mới | Chưa rebuild smart-control | `docker compose up -d --build smart-control` |
| MQTT không có data | Simulator chưa restart | `docker compose restart simulator` |
| ChirpStack không nhận | DevEUI chưa register | Thêm device trên ChirpStack UI |
| Data zone mới = zone A | Sai offsets hoặc quên set | Check `ZONE_SENSORS[].offsets` |
