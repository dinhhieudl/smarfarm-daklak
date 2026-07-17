# 08 - KỊCH BẢN TƯỚI THÔNG MINH

## 1. Quy Tắc Tưới Theo Độ ẩm Đất

```
┌─────────────────────────────────────────────────┐
│            QUY TẮC TƯỚI CHÍNH                   │
├─────────────────────────────────────────────────┤
│                                                 │
│  IF  moisture < moistureMin                     │
│  AND time_since_last_irrigation > cooldownMin   │
│  AND rain_active == false                       │
│  AND current_time NOT IN (11:00-15:00)          │
│  AND system_state != EMERGENCY_STOP             │
│  THEN                                           │
│      → TƯỚI                                     │
│      → duration = calculateDuration(            │
│          soil_deficit,                           │
│          zone_area,                              │
│          flow_rate                               │
│        )                                        │
│      → Open valve + Start pump                  │
│      → Timer countdown                          │
│      → Stop when duration reached               │
│      → OR stop when moisture > moistureMax      │
│      → Write audit log                          │
│                                                 │
│  IF  moisture > moistureMax                     │
│  THEN                                           │
│      → KHÔNG TƯỚI (đã đủ nước)                  │
│                                                 │
│  IF  rain_active == true                        │
│  THEN                                           │
│      → TẠM DỪNG TƯỚI                            │
│      → Chờ mưa tạnh + 30 phút                   │
│      → Resume kiểm tra moisture                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 2. Cấu Hình Tưới Cho Mỗi Zone

### Zone A - Robusta 5000m² (Đất bazan đỏ)

```json
{
  "zone-A": {
    "moistureMin": 30,
    "moistureMax": 65,
    "maxDurationMin": 30,
    "cooldownMin": 120,
    "rainPause": true,
    "rainThreshold": 5,
    "irrigationWindow": {
      "start": "05:00",
      "end": "11:00"
    },
    "notes": "Robusta chịu hạn tốt hơn Arabica, bazan đỏ giữ nước tốt"
  }
}
```

### Zone B - Robusta 3500m² (Đất bazan)

```json
{
  "zone-B": {
    "moistureMin": 35,
    "moistureMax": 60,
    "maxDurationMin": 25,
    "cooldownMin": 120,
    "rainPause": true,
    "rainThreshold": 5,
    "irrigationWindow": {
      "start": "05:00",
      "end": "11:00"
    },
    "notes": "Robusta, đất bazan thường giữ nước kém hơn bazan đỏ"
  }
}
```

### Zone C - Arabica 2000m² (Đất phù sa)

```json
{
  "zone-C": {
    "moistureMin": 40,
    "moistureMax": 70,
    "maxDurationMin": 20,
    "cooldownMin": 180,
    "rainPause": true,
    "rainThreshold": 3,
    "irrigationWindow": {
      "start": "04:30",
      "end": "10:00"
    },
    "notes": "Arabica cần nhiều nước hơn Robusta, nhưng nhạy cảm ngập úng"
  }
}
```

> **So sánh Robusta vs Arabica:**
> - Arabica: moistureMin cao hơn (40 vs 30-35), moistureMax cao hơn (70 vs 60-65)
> - Arabica: cooldown dài hơn (180 vs 120 phút) - nhạy cảm hơn với tưới thừa
> - Arabica: rainThreshold thấp hơn (3 vs 5mm) - nhạy cảm mưa hơn
> - Arabica: cửa sổ tưới sớm hơn (04:30 vs 05:00)

---

## 3. Tính Toán ET0 (Hargreaves-Samani)

### Công Thức

```
ET0 = 0.0023 × (Tmean + 17.8) × √(Tmax - Tmin) × Ra

Trong đó:
  Tmean = (Tmax + Tmin) / 2
  Tmax  = nhiệt độ cao nhất trong ngày
  Tmin  = nhiệt độ thấp nhất trong ngày
  Ra    = radiation extraterrestrial (theo vĩ độ & tháng)
```

### Dữ Liệu Thời Tiết

```
Nguồn: Open-Meteo API (miễn phí)
Tọa độ: 12.6667°N, 108.0500°E (Buôn Ma Thuot)
Cập nhật: Mỗi 6 giờ
API endpoint:
  https://api.open-meteo.com/v1/forecast?
    latitude=12.6667&
    longitude=108.0500&
    daily=temperature_2m_max,temperature_2m_min,precipitation_sum&
    timezone=Asia/Ho_Chi_Minh
```

### Giá Trị Ra Theo Tháng (Buôn Ma Thuot, 12.67°N)

| Tháng | Ra (mm/ngày) | Ghi chú |
|-------|-------------|---------|
| 1 | 4.2 | Đầu mùa khô |
| 2 | 4.8 | Mùa khô |
| 3 | 5.3 | Cuối mùa khô |
| 4 | 5.5 | Giữa mùa khô |
| 5 | 5.2 | Đầu mùa mưa |
| 6 | 4.8 | Mùa mưa |
| 7 | 4.6 | Mùa mưa |
| 8 | 4.8 | Mùa mưa |
| 9 | 4.5 | Cuối mùa mưa |
| 10 | 4.3 | Giữa mưa |
| 11 | 4.0 | Đầu mùa khô |
| 12 | 3.8 | Mùa khô |

### Tính Toán Demand Water

```
Water Demand = ET0 × Kc × Area

Trong đó:
  ET0  = từ Open-Meteo (hoặc tính từ sensor temp)
  Kc   = Coefficient cây cà phê:
         - Robusta: 0.85-1.0
         - Arabica: 0.90-1.1
  Area = Diện tích zone (m²)

Ví dụ Zone A (Robusta, 5000m², tháng 3):
  ET0 = 5.3 mm/ngày
  Kc  = 0.9
  Demand = 5.3 × 0.9 × 5000 = 23,850 L/ngày
         = ~16.5 L/phút (nếu tưới 24h)
         = ~33 L/phút (nếu tưới 12h, 05:00-17:00)
```

---

## 4. Lịch Tưới Theo Giai Đoạn Cây Cà Phê

### 4.1 Robusta (Chu kỳ 12-14 tháng)

| Giai đoạn | Thời gian | Độ ẩm mục tiêu | Tần suất tưới | Ghi chú |
|-----------|-----------|----------------|--------------|---------|
| **Hậu thu hoạch** | Tháng 0-2 | 30-45% | Không tưới | Thời kỳ nghỉ, phục hồi rễ |
| **Phục hồi** | Tháng 2-4 | 40-55% | 1 lần/tuần | Bón phân lân, phục hồi |
| **Phát triển** | Tháng 4-8 | 45-60% | 2 lần/tuần | Tăng dần theo sinh trưởng |
| **Ra hoa** | Tháng 8-10 | 35-50% | Ít tưới (stress nước) | Kích thích ra hoa |
| **Đậu quả** | Tháng 10-12 | 45-60% | 2-3 lần/tuần | Giai đoạn nhạy cảm nhất |
| **Chín quả** | Tháng 12-14 | 35-50% | Ít tưới hơn | Giảm nước, tăng đường |

### 4.2 Arabica (Chu kỳ 12-14 tháng)

| Giai đoạn | Thời gian | Độ ẩm mục tiêu | Tần suất tưới | Ghi chú |
|-----------|-----------|----------------|--------------|---------|
| **Hậu thu hoạch** | Tháng 0-2 | 35-50% | Không tưới | Tương tự Robusta |
| **Phục hồi** | Tháng 2-4 | 45-60% | 1-2 lần/tuần | Arabica cần nước hơn |
| **Phát triển** | Tháng 4-8 | 50-65% | 2-3 lần/tuần | Sinh trưởng mạnh |
| **Ra hoa** | Tháng 8-10 | 40-55% | 1 lần/tuần | Stress nước nhẹ |
| **Đậu quả** | Tháng 10-12 | 50-65% | 3 lần/tuần | Rất nhạy cảm nước |
| **Chín quả** | Tháng 12-14 | 40-55% | 1-2 lần/tuần | Giảm nước |

---

## 5. Các Chế Độ Tưới Đặc Biệt

### 5.1 Chế Độ Mùa Khô (Nov-Apr)

```
Đặc điểm: Không mưa, nhiệt độ cao, hơi nước bốc hơi nhanh

Chiến lược:
├── Tăng tần suất tưới (3-4 lần/tuần)
├── Tưới vào sáng sớm (04:30-07:00) và chiều muộn (16:00-18:00)
├── Tránh tưới giữa trưa (11:00-15:00) - bốc hơi nhanh
├──_monitor ET0 daily, tăng duration nếu ET0 > 6mm/ngày
└── Theo dõi moisture closely (2h intervals nếu có thể)
```

### 5.2 Chế Độ Mùa Mưa (May-Oct)

```
Đặc điểm: Mưa thường xuyên, đất ẩm, ngập úng có thể xảy ra

Chiến lược:
├── Giảm tưới hoặc KHÔNG tưới
├── Rain pause tự động (threshold: 3-5mm)
├── Theo dõi moisture: nếu > 70% → KHÔNG tưới
├── Kiểm tra drainage: nước có chảy đúng không?
├── Theo dõi EC: mưa pha loãng EC → cần bón bổ sung
└── Sau mưa lớn: kiểm tra ngập úng
```

### 5.3 Chế Độ Nắng Nóng Cực Đoan (Heatwave)

```
Đặc điểm: Temperature > 35°C, ET0 > 8mm/ngày

Chiến lược:
├── Tưới SỚM HƠN (04:00-06:00)
├── Tăng duration (tối đa maxDurationMin)
├── Tăng tần suất (2 lần/ngày nếu cần)
├── Theo dõi moisture liên tục
├── Cân nhắc bổ sung nước cho rễ (deep watering)
└── Nếu có thể: che nắng cho cây non
```

### 5.4 Chế Độ Dự Phòng (Fallback)

```
Khi hệ thống tự động gặp sự cố:
├── Chuyển sang chế độ thủ công
├── Tưới theo lịch cố định (scheduler):
│   ├── Mùa khô: 05:00, 30 phút/ngày
│   ├── Mùa mưa: 05:00, 15 phút/ngày (hoặc không tưới)
│   └── Theo giai đoạn cây: xem section 4
├── Operator manually control qua UI
└── Khi hệ thống phục hồi → chuyển lại auto mode
```

---

## 6. Công Thức Tính Thời Gian Tưới

```
Duration (phút) = (moistureDeficit × zone_area × soil_depth) / (flow_rate × efficiency)

Trong đó:
  moistureDeficit = (moistureMax - currentMoisture) / 100
  zone_area       = Diện tích zone (m²)
  soil_depth      = Độ sâu rễ (0.3m cho cà phê)
  flow_rate       = Lưu lượng bơm (L/phút)
  efficiency      = Hiệu suất tưới nhỏ giọt (0.85-0.95)

Ví dụ Zone A:
  moistureDeficit = (65 - 25) / 100 = 0.40
  zone_area       = 5000 m²
  soil_depth      = 0.3m
  flow_rate       = 50 L/phút
  efficiency      = 0.9

  Duration = (0.40 × 5000 × 0.3) / (50 × 0.9)
           = 600 / 45
           = 13.3 phút

  → Set duration = 15 phút (round up, có buffer)
  → Verify: maxDurationMin = 30 (an toàn)
```
