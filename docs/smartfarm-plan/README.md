# SMARTFARM DAKLAK - PLAN CHI TIẾT
## Hệ Thống Nông Nghiệp Thông Minh Cho Cà Phê - Dak Lak

---

## MỤC LỤC

| File | Nội dung |
|------|----------|
| [01-tong-quan-du-an.md](01-tong-quan-du-an.md) | Mục tiêu, phạm vi, tính năng |
| [02-kien-truc-he-thong.md](02-kien-truc-he-thong.md) | Kiến trúc 4 lớp, sơ đồ, luồng dữ liệu |
| [03-hardware-can-thiet.md](03-hardware-can-thiet.md) | Bill of Materials chi tiết |
| [04-trien-khai-phan-mem.md](04-trien-khai-phan-mem.md) | Docker, ChirpStack, Node-RED, Grafana |
| [05-trien-khai-hardware.md](05-trien-khai-hardware.md) | Lắp đặt hiện trường, wiring, AT commands |
| [06-kich-ban-van-hanh.md](06-kich-ban-van-hanh.md) | Khởi động, bình thường, tắt, bảo trì |
| [07-kich-ban-xu-ly-su-co.md](07-kich-ban-xu-ly-su-co.md) | 10 sự cố + emergency stop |
| [08-kich-ban-tui-thong-minh.md](08-kich-ban-tui-thong-minh.md) | Quy tắc tưới, ET0, lịch tưới |
| [09-kich-ban-tu-van-ca-phe.md](09-kich-ban-tu-van-ca-phe.md) | 6 giai đoạn Robusta/Arabica + cảnh báo NPK |
| [10-chi-phi-du-kien.md](10-chi-phi-du-kien.md) | BOM giá, vận hành, tổng năm đầu |
| [11-lich-trinh-trien-khai.md](11-lich-trinh-trien-khai.md) | 6 tuần triển khai chi tiết |
| [12-xac-thuc-kiem-thu.md](12-xac-thuc-kiem-thu.md) | Checklist, test cases, performance |

---

## Cấu Trúc Thư Mục

```
docs/smartfarm-plan/
├── README.md                          # File này
├── 01-tong-quan-du-an.md              # Mục tiêu, phạm vi, tính năng
├── 02-kien-truc-he-thong.md           # Kiến trúc 4 lớp, sơ đồ, luồng dữ liệu
├── 03-hardware-can-thiet.md           # Bill of Materials chi tiết
├── 04-trien-khai-phan-mem.md          # Docker, ChirpStack, Node-RED, Grafana
├── 05-trien-khai-hardware.md          # Lắp đặt hiện trường, wiring, AT commands
├── 06-kich-ban-van-hanh.md            # Khởi động, bình thường, tắt, bảo trì
├── 07-kich-ban-xu-ly-su-co.md         # 10 sự cố + emergency stop
├── 08-kich-ban-tui-thong-minh.md      # Quy tắc tưới, ET0, lịch tưới
├── 09-kich-ban-tu-van-ca-phe.md       # 6 giai đoạn Robusta/Arabica + NPK
├── 10-chi-phi-du-kien.md              # Chi phí hardware, vận hành, tổng 5 năm
├── 11-lich-trinh-trien-khai.md        # 6 tuần triển khai chi tiết
└── 12-xac-thuc-kiem-thu.md           # Checklist, test cases, performance
```

---

## Tóm Tắt Nhanh

| Hạng mục | Giá trị |
|----------|---------|
| Vị trí | Buôn Ma Thuột, Đắk Lắk (12.67°N, 108.05°E) |
| Diện tích | 3 khu, 10,500 m² (Robusta + Arabica) |
| Công nghệ | LoRaWAN AS923, ChirpStack v4, Docker |
| Chi phí năm đầu | ~$858 (~21,450,000 VND) |
| Thời gian triển khai | 6 tuần |
| Hardware chính | E870 Gateway, E78-DTU Nodes, Soil Sensor 8-tham-số |
| Dịch vụ | 10 Docker containers |
| Tests | 128 unit tests, 0 failures |

*Tạo: 2026-06-19 | Dự án: SmartFarm DakLak v2.0*
