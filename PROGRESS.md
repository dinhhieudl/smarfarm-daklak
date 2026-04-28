# SmartFarm DakLak - Project Progress

> Cập nhật lần cuối: 2026-04-28 10:03 GMT+8

## Tổng quan dự án

Hệ thống nông nghiệp thông minh (precision agriculture) cho DakLak, Việt Nam.
Dựa trên LoRa/LoRaWAN để thu thập dữ liệu đất (nhiệt độ, độ ẩm, EC, NPK, pH) từ cảm biến ngoài vườn, đẩy lên server để giám sát và cảnh báo.

## Hardware hiện có

| Thiết bị | Model | Trạng thái | Ghi chú |
|----------|-------|------------|---------|
| Gateway | E870-L915LG12 | ✅ Đã có | LoRaWAN, SX1302, AS923 |
| Node (LoRaWAN) | **E78-900TBL-01A** | ✅ Đã có | LoRaWAN dev board, ASR6505, USB |
| Node (LoRaWAN DTU) | E78-DTU(900LN22) | ❌ Không có | DTU version (6601 chip, RS485) — đã ngưng SX |
| Node (Raw LoRa) | E90-DTU(900SL22) | ✅ Đã có | ⚠️ Raw LoRa, không dùng với E870 |
| Sensor | Soil Multi-Parameter | ✅ Đã có | RS485 Modbus, 8 registers |

## Kiến trúc đã xác nhận

**E78-900TBL-01A + E870 = Tương thích LoRaWAN ✅**
- E78-900TBL-01A: LoRaWAN dev board, ASR6505, USB interface
- E870-L915LG12: LoRaWAN gateway, SX1302
- → Cùng LoRaWAN protocol, sẵn sàng test
- ⚠️ Dev board không có Modbus built-in → cần MCU trung gian hoặc test manual
- Chi tiết: `docs/setup/e78-900tbl-at-commands.md`

**E78-DTU(900LN22)**: Phiên bản DTU (đã ngưng SX) với chip 6601 + RS485 tích hợp — KHÔNG có

## Sensor Protocol

- Giao thức: RS485 Modbus RTU
- Địa chỉ mặc định: 0x02
- Baud: 9600-8N1
- Đọc 8 registers từ 0x0000: Temp, Moisture, EC, Salinity, N, P, K, pH
- Command: `02 03 00 00 00 08 [CRC16]`
- Chi tiết: `docs/hardware/soil-multi-parameter-sensor.md`

## Server Stack (Docker)

Đã có `docker-compose.yml` với 7 services:
- ChirpStack v4 (LoRaWAN network server) — :8080
- Node-RED (data processing) — :1880
- InfluxDB 2.7 (time-series DB) — :8086
- Grafana (dashboard) — :3000
- Mosquitto (MQTT) — :1883
- PostgreSQL + Redis (backend)

## File đã hoàn thành

```
smartfarm-daklak/
├── PROGRESS.md                          ← File này
├── README.md                            ← Project overview
├── docs/
│   ├── hardware/
│   │   ├── soil-multi-parameter-sensor.md  ✅ Sensor datasheet (EN)
│   │   ├── E870-L915LG12-gateway.md        ✅ Gateway datasheet (EN)
│   │   ├── E90-DTU-900SL22-node.md         ✅ Node datasheet (EN)
│   │   └── frequency-plan.md               ✅ AS923 frequency plan
│   ├── planning/
│   │   ├── system-architecture.md           ✅ System architecture
│   │   ├── connectivity-plan.md             ✅ Wiring & config
│   │   ├── server-selection.md              ✅ Server comparison
│   │   ├── deployment-guide.md              ✅ Step-by-step deploy guide
│   │   └── two-options-comparison.md        ✅ E78 vs E90 comparison
│   ├── software/
│   │   └── vendor-software-analysis.md      ✅ Vendor software analysis
│   ├── setup/
│   │   ├── chirpstack-setup.md              ✅ ChirpStack install guide
│   │   ├── e78-dtu-at-commands.md           ✅ E78-DTU AT command reference (6601 chip)
│   │   └── e78-900tbl-at-commands.md        ✅ E78-900TBL AT command reference (ASR6505)
│   └── code/
│       └── example_modbus.c                 ✅ Modbus RTU C code
├── server/
│   ├── docker-compose.yml                   ✅ Full server stack
│   ├── setup.bat                            ✅ Windows setup script
│   ├── setup.sh                             ✅ Linux/macOS setup script
│   ├── config/                              ✅ ChirpStack, Mosquitto, Grafana configs
│   │   ├── chirpstack-payload-decoder.js    ✅ Payload decoder (JavaScript)
│   │   └── grafana/alerting/soil-alerts.json ✅ Alert rules (6 rules)
│   └── README.md                            ✅ Server instructions
└── software/
    ├── 查看数据软件/                          ✅ ModScan32 + ModSim32 (diagnostic tools)
    └── stm32f103-mini-system/               ✅ STM32 firmware with Modbus reader
```

## Việc còn lại (TODO)

- [x] ~~Mua E78-DTU(900LN22)~~ → Đã có
- [x] Viết payload decoder JavaScript → `server/config/chirpstack-payload-decoder.js`
- [x] Cấu hình Node-RED flow (MQTT → Decode → InfluxDB) → `server/config/node-red-flows.json`
- [x] Tạo Grafana dashboard → `server/config/grafana/dashboards/soil-monitoring.json`
- [x] Cài alert rules (moisture, pH, temp, EC, sensor offline) → `server/config/grafana/alerting/soil-alerts.json`
- [x] E78-DTU AT command reference → `docs/setup/e78-dtu-at-commands.md`
- [x] Setup script (Windows + Linux) → `server/setup.bat` + `server/setup.sh`
- [ ] Test sensor với ModScan32 (commissioning) — **cần hardware**
- [ ] Cấu hình E78-900TBL: AT command cho LoRaWAN join — **cần hardware**
- [ ] **Chọn phương án tích hợp sensor** (xem bên dưới) — **chờ quyết định**
- [ ] Register gateway + device trong ChirpStack — **cần deploy server**
- [ ] Deploy server (docker compose up -d trên laptop)
- [ ] Lắp sensor + node ngoài vườn (solar power) — **cần hardware**
- [ ] Kiểm tra end-to-end data flow — **cần toàn bộ hệ thống**

## ⚠️ E78-900TBL-01A: 3 phương án tích hợp sensor

> Dev board (ASR6505) **không có Modbus polling built-in** như DTU version.
> Cần thêm 1 lớp xử lý giữa sensor RS485 và board LoRaWAN.

### Option A: MAX485 module nối trực tiếp E78 board

```
Soil Sensor ←RS485→ MAX485 module ←UART→ E78-900TBL (UART pins)
```

- **Ưu điểm**: Đơn giản, rẻ (~$2), không cần MCU thứ 2
- **Nhược điểm**: Cần code firmware cho ASR6505 (đọc UART + Modbus), không có sẵn
- **Phù hợp**: Nghiên cứu, test nhanh
- **Chi phí**: ~$2 (MAX485 module)

### Option B: STM32 trung gian (firmware đã có trong repo)

```
Soil Sensor ←RS485(UART2)→ STM32F103 ←UART1→ E78-900TBL (UART pins)
```

- **Ưu điểm**: Firmware Modbus đã có sẵn (`software/stm32f103-mini-system/`), RT-Thread RTOS, đã test
- **Nhược điểm**: Thêm board STM32, thêm nguồn điện, phức tạp hơn
- **Phù hợp**: Production prototype, nhiều sensor trên 1 bus
- **Chi phí**: ~$5-8 (STM32 Blue Pill + MAX485)

### Option C: Giữ E78 cho test, mua RAK3172 cho production

```
Soil Sensor ←RS485→ RAK3172 (built-in) ←LoRaWAN→ E870
E78-900TBL chỉ dùng để test LoRaWAN join, không connect sensor
```

- **Ưu điểm**: RAK3172 có RS485 + Modbus built-in, AT command, production-ready, tài liệu tốt
- **Nhược điểm**: Phải mua thêm (~$12/node), E78 chỉ dùng cho dev/test
- **Phù hợp**: Triển khai thật, dễ scale
- **Chi phí**: ~$12/node (RAK3172 breakout board)

### Bảng so sánh

| Tiêu chí | A: MAX485 direct | B: STM32 + MAX485 | C: RAK3172 |
|----------|-----------------|-------------------|------------|
| Chi phí thêm | ~$2 | ~$5-8 | ~$12/node |
| Độ phức tạp | Trung bình | Cao | Thấp |
| Firmware có sẵn | ❌ Tự viết | ✅ Có trong repo | ✅ AT command |
| Modbus support | ❌ Tự code | ✅ Đã có | ✅ Built-in |
| Production ready | ❌ | ⚠️ Prototype | ✅ |
| Dễ scale | ❌ | ❌ | ✅ (thêm device) |

**Khuyến nghị**: Option C (RAK3172) cho production, Option A/B cho test/learn.

## Session Context (cho AI)

- Repo clone tại: `/root/.openclaw/workspace/smartfarm-daklak`
- GitHub: `https://github.com/dinhhieudl/smartfarm-daklak`
- Toàn bộ tài liệu đã được dịch sang tiếng Anh
- Firmware STM32 (RT-Thread) đọc sensor qua RS485 UART2, addr 0x02, poll 5s
- ModScan32 là tool shareware để test sensor (3.5 min limit)
- **Hardware đã có: E870 gateway + E78-900TBL-01A dev board + Soil sensor**
- E78-900TBL-01A: LoRaWAN dev board, ASR6505 chip, USB interface, KHÔNG có Modbus built-in
- E78-DTU(900LN22) KHÔNG có — đã ngưng SX, board của user là phiên bản dev board (900TBL)
- E90-DTU(900SL22) cũng có nhưng KHÔNG dùng với E870 (raw LoRa, không LoRaWAN)
- E870 dùng Semtech SX1302, chỉ nhận LoRaWAN frames
- Server: Docker Compose với 7 services (ChirpStack, Node-RED, InfluxDB, Grafana, Mosquitto, PostgreSQL, Redis)
