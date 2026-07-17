# 09 - KỊCH BẢN TƯ VẤN CÀ PHÊ

## 1. Tổng Quan

Smart Control tự động detect giai đoạn phát triển dựa trên `plantDate` trong config zone. Hệ thống đưa ra khuyến nghị về:
- Bón phân (N, P, K)
- Tưới nước
- Theo dõi đất (pH, EC, NPK)
- Cảnh báo khi vượt ngưỡng

---

## 2. 6 Giai Đoạn Phát Triển

### Giai đoạn 1: Hậu Thu Hậu (Sau 0-2 tháng)

```
Đặc điểm:
├── Cây vừa thu hoạch xong
├── Rễ cần phục hồi
├── Cành cần cắt tỉa
└── Chưa cần nhiều nước

Khuyến nghị:
├── CẮT TỈA: Cành khô, cành bệnh, cành yếu
├── BÓN PHÂN: Lân (P) phục hồi rễ
│   └── Khuyến nghị: 50-80g DAP/cây (hoặc theo NPK test)
├── TƯỚI: Nhẹ nhàng, 30-45% độ ẩm
│   └── 1 lần/tuần, lượng nhỏ
├── THEO DÕI:
│   ├── Độ ẩm đất: 30-45%
│   ├── pH đất: 5.0-6.5
│   └── EC: < 500 μS/cm

Cảnh báo tự động:
├── IF moisture < 25% → "Đất khô quá, tưới bổ sung"
├── IF pH < 5.0 → "Đất quá chua, bón vôi"
└── IF EC > 800 → "EC cao, giảm bón phân"
```

### Giai đoạn 2: Phục Hồi (2-4 tháng)

```
Đặc điểm:
├── Cây bắt đầu phát triển mới
├── Rễ phục hồi, mọc rễ con
├── Lá mới xuất hiện
└── Cần dinh dưỡng cân bằng

Khuyến nghị:
├── BÓN PHÂN: NPK cân bằng (15-15-15 hoặc 16-16-8)
│   └── Khuyến nghị: 100-150g/cây, chia 2 lần
├── TƯỚI: Tăng dần theo sự phát triển
│   └── 40-55% độ ẩm, 1-2 lần/tuần
├── THEO DÕI:
│   ├── Độ ẩm đất: 40-55%
│   ├── EC đất: 200-800 μS/cm
│   ├── N: 40-80 mg/kg
│   ├── P: 20-40 mg/kg
│   └── K: 60-120 mg/kg

Cảnh báo tự động:
├── IF N < 30 → "Độ đạm thấp, bón phân đạm"
├── IF P < 15 → "Độ lân thấp, bón lân"
├── IF K < 60 → "Độ kali thấp, bón kali"
└── IF EC > 1000 → "EC cao, giảm bón phân"
```

### Giai đoạn 3: Phát Triển Sinh Dưỡng (4-8 tháng)

```
Đặc điểm:
├── Cây phát triển mạnh
├── Tán lá rộng
├── Cành nhánh nhiều
└── Cần nhiều đạm (N)

Khuyến nghị:
├── BÓN PHÂN: Tăng đạm (N)
│   └── Khuyến nghị: Urea hoặc SA, 80-120g N/cây
│   └── Chia 2-3 lần, mỗi 2 tháng
├── TƯỚI: Đầy đủ
│   └── 45-60% độ ẩm, 2 lần/tuần
├── THEO DÕI:
│   ├── Độ ẩm đất: 45-60%
│   ├── N: 60-120 mg/kg (quy trọng)
│   ├── P: 20-40 mg/kg
│   ├── K: 80-150 mg/kg
│   └── pH: 5.5-6.5 (lý tưởng cho cà phê)

Cảnh báo tự động:
├── IF N < 40 → "Độ đạm thấp nghiêm trọng"
├── IF N > 200 → "Dư đạm, giảm bón"
├── IF pH < 5.0 → "Đất chua, bón vôi (CaCO3)"
├── IF pH > 7.5 → "Đất kiềm, bón lưu huỳnh (S)"
└── IF moisture < 35 → "Đất khô, tưới ngay"
```

### Giai đoạn 4: Ra Hoa (8-10 tháng)

```
Đặc điểm:
├── Cây bắt đầu phân hóa mầm hoa
├── Cần KALI (K) và LÂN (P) nhiều hơn
├── Giảm ĐẠM (N) để kích thích ra hoa
└── Stress nước nhẹ có thể kích thích ra hoa

Khuyến nghị:
├── BÓN PHÂN: GIẢM N, TĂNG K + P
│   └── Khuyến nghị: KCl (0-0-60), 50-80g K₂O/cây
│   └── + Lân (0-46-0): 30-50g P₂O₅/cây
├── TƯỚI: Hạn chế nhẹ (stress nước)
│   └── 35-50% độ ẩm, 1 lần/tuần
│   └── KHÔNG tưới quá nhiều → cây không ra hoa
├── THEO DÕI:
│   ├── Độ ẩm đất: 35-50% (hơi khô)
│   ├── Nhiệt độ: 20-25°C lý tưởng cho ra hoa
│   ├── K: 100-180 mg/kg
│   └── P: 25-50 mg/kg

Cảnh báo tự động:
├── IF K < 80 → "Thiếu kali, ảnh hưởng ra hoa"
├── IF moisture > 55 → "Đất quá ẩm, giảm tưới để kích ra hoa"
├── IF temp > 35°C → "Nhiệt độ cao, cây stress"
└── IF N > 150 → "Dư đạm, ức chế ra hoa"
```

### Giai đoạn 5: Nở Hoa & Đậu Quả (10-12 tháng)

```
Đặc điểm:
├── Hoa nở, ong thụ phấn
├── Quả non bắt đầu hình thành
├── Giai đoạn NHẠY CẢM NHẤT với nước
└── Thiếu nước → rụng hoa, rụng quả non

Khuyến nghị:
├── BÓN PHÂN: KCl tăng cường + NPK nhẹ
│   └── Khuyến nghị: NPK 15-5-20, 100-150g/cây
│   └── Bón ngay sau khi hoa rụng
├── TƯỚI: ĐẦY ĐỦ NHẤT
│   └── 45-60% độ ẩm, 2-3 lần/tuần
│   └── TUYỆT ĐỐI KHÔNG để đất khô trong giai đoạn này
├── THEO DÕI:
│   ├── Độ ẩm đất: 45-60% (quan trọng nhất)
│   ├── EC: 300-600 μS/cm
│   ├── K: 100-180 mg/kg
│   └── Quan sát: hoa có rụng nhiều không?

Cảnh báo tự động:
├── IF moisture < 30% → "CẢNH BÁO: Đất khô, tưới NGAY! Hoa sẽ rụng"
├── IF moisture < 20% → "NGUY HIỂM: Đất khô nghiêm trọng"
├── IF K < 80 → "Thiếu kali, quả non sẽ rụng"
└── IF EC > 1000 → "EC cao, ảnh hưởng đậu quả"
```

### Giai đoạn 6: Chín & Thu Hoạch (12-14 tháng)

```
Đặc điểm:
├── Quả chuyển màu (xanh → vàng → đỏ)
├── Hàm lượng đường tăng
├── Cần giảm nước để tập trung chất lượng
└── Thu hoạch khi quả đỏ đậm

Khuyến nghị:
├── BÓN PHÂN: KHÔNG bón phân trước thu hoạch 1 tháng
│   └── Nếu cần: NPK nhẹ, liều thấp
├── TƯỚI: Giảm dần
│   └── 30-45% độ ẩm, 1 lần/tuần
│   └── Giảm nước để tăng hàm lượng đường trong quả
├── THEO DÕI:
│   ├── Độ ẩm đất: 30-45%
│   ├── Màu quả: theo dõi quá trình chín
│   └── Thời tiết: mưa lớn trước thu hoạch → bệnh nấm

Cảnh báo tự động:
├── IF rainfall > 20mm → "Mưa lớn, nguy cơ bệnh nấm trên quả"
├── IF moisture > 60 → "Đất quá ẩm trước thu hoạch, giảm tưới"
└── IF temp < 15°C → "Nhiệt độ thấp, quá trình chín chậm"
```

---

## 3. Hệ Thống Cảnh Báo NPK

### Bảng Ngưỡng

| Tham số | Thiếu hụt | Lý tưởng | Dư thừa | Đơn vị |
|---------|-----------|----------|---------|--------|
| Nitrogen (N) | < 30 | 60-120 | > 200 | mg/kg |
| Phosphorus (P) | < 15 | 20-50 | > 80 | mg/kg |
| Potassium (K) | < 60 | 80-180 | > 250 | mg/kg |
| pH | < 5.0 | 5.5-6.5 | > 7.5 | pH |
| EC | < 100 | 200-800 | > 1500 | μS/cm |

### Tự Động Cảnh Báo

```
NITROGEN:
├── < 30 mg/kg  → WARNING: "Độ đạm đất thấp, bón phân đạm (Urea, SA)"
├── 30-60       → INFO: "Độ đạm trung bình thấp, cân nhắc bón thêm"
├── 60-120      → OK: "Độ đạm lý tưởng"
├── 120-200     → INFO: "Độ đạm cao, theo dõi"
└── > 200       → WARNING: "Dư đạm, giảm bón, nguy cơ cháy rễ"

PHOSPHORUS:
├── < 15 mg/kg  → WARNING: "Độ lân thấp, bón lân (DAP, SSP)"
├── 15-25       → INFO: "Độ lân trung bình thấp"
├── 25-50       → OK: "Độ lân lý tưởng"
└── > 50        → INFO: "Độ lân cao, không cần bón thêm"

POTASSIUM:
├── < 60 mg/kg  → WARNING: "Độ kali thấp, bón kali (KCl, K₂SO₄)"
├── 60-100      → INFO: "Đ度 kali trung bình thấp"
├── 100-180     → OK: "Độ kali lý tưởng"
└── > 180       → INFO: "Độ kali cao, theo dõi"

pH:
├── < 4.5       → CRITICAL: "Đất quá chua, BẮT BUỘC bón vôi (CaCO3)"
├── 4.5-5.0     → WARNING: "Đất chua, nên bón vôi"
├── 5.0-5.5     → INFO: "Đất hơi chua, theo dõi"
├── 5.5-6.5     → OK: "pH lý tưởng cho cà phê"
├── 6.5-7.0     → INFO: "Đất hơi kiềm, theo dõi"
├── 7.0-7.5     → WARNING: "Đất kiềm, bón lưu huỳnh (S)"
└── > 7.5       → CRITICAL: "Đất quá kiềm, ảnh hưởng nghiêm trọng"

EC:
├── < 100       → INFO: "EC thấp, đất nghèo khoáng chất"
├── 100-500     → OK: "EC lý tưởng"
├── 500-1000    → INFO: "EC trung bình cao"
├── 1000-1500   → WARNING: "EC cao, giảm bón phân"
└── > 1500      → CRITICAL: "EC rất cao, đất bị mặn, nguy hại rễ"
```

---

## 4. Khuyến Nghị Bón Phân Theo Mùa

### Lịch Bón Phân Hàng Năm (Robusta)

| Thời điểm | Loại phân | Lượng/cây | Mục đích |
|-----------|----------|----------|---------|
| Tháng 2 (Hậu thu hoạch) | DAP (18-46-0) | 50-80g | Phục hồi rễ |
| Tháng 4 (Phục hồi) | NPK 15-15-15 | 100-150g | Cân bằng dinh dưỡng |
| Tháng 6 (Phát triển) | Urea (46-0-0) | 80-100g | Tăng sinh trưởng |
| Tháng 8 (Ra hoa) | KCl (0-0-60) | 50-80g | Kích thích ra hoa |
| Tháng 10 (Đậu quả) | NPK 15-5-20 | 100-150g | Phát triển quả |
| Tháng 12 (Chín quả) | KHÔNG BÓN | - | Tăng chất lượng |

### Lịch Bón Phân Hàng Năm (Arabica)

| Thời điểm | Loại phân | Lượng/cây | Mục đích |
|-----------|----------|----------|---------|
| Tháng 2 | DAP | 40-60g | Phục hồi rễ |
| Tháng 4 | NPK 16-16-8 | 80-120g | Cân bằng |
| Tháng 6 | Urea | 60-80g | Sinh trưởng |
| Tháng 8 | KCl + Lân | 40-60g K + 30-40g P | Ra hoa |
| Tháng 10 | NPK 15-5-20 | 80-120g | Đậu quả |
| Tháng 12 | KHÔNG BÓN | - | Chín quả |

> **Lưu ý:** Đây là khuyến nghị chial. Cần điều chỉnh theo kết quả NPK test thực tế từ mỗi zone.
