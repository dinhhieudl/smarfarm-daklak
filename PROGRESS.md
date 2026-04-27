# SmartFarm DakLak - Project Progress

> Cập nhật lần cuối: 2026-04-27 23:00 GMT+8

## Tổng quan dự án

Hệ thống nông nghiệp thông minh (precision agriculture) cho DakLak, Việt Nam.
Dựa trên LoRa/LoRaWAN để thu thập dữ liệu đất (nhiệt độ, độ ẩm, EC, NPK, pH) từ cảm biến ngoài vườn, đẩy lên server để giám sát và cảnh báo.

## Hardware hiện có

| Thiết bị | Model | Trạng thái | Ghi chú |
|----------|-------|------------|---------|
| Gateway | E870-L915LG12 | ✅ Đã mua | LoRaWAN, SX1302, AS923 |
| Node (DTU) | E90-DTU(900SL22) | ✅ Đã mua | ⚠️ Raw LoRa, KHÔNG tương thích E870 |
| Sensor | Soil Multi-Parameter | ✅ Đã mua | RS485 Modbus, 8 registers |

## Vấn đề kiến trúc đã phát hiện

**E90-DTU và E870 KHÔNG tương thích:**
- E90-DTU gửi raw LoRa (transparent radio, không MAC layer)
- E870 chỉ nhận LoRaWAN frames (chipset SX1302)
- → Cần thay E90 bằng LoRaWAN node

## Khuyến nghị hardware

Mua thêm **E78-DTU(900LN22)** (~$25-35):
- LoRaWAN node của Ebyte, RS485 tích hợp, chip 6601 Cortex-M4
- Tương thích E870, OTAA join, Modbus tự polling
- Chi tiết: `docs/planning/two-options-comparison.md`

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
│   │   └── chirpstack-setup.md              ✅ ChirpStack install guide
│   └── code/
│       └── example_modbus.c                 ✅ Modbus RTU C code
├── server/
│   ├── docker-compose.yml                   ✅ Full server stack
│   ├── config/                              ✅ ChirpStack, Mosquitto, Grafana configs
│   └── README.md                            ✅ Server instructions
└── software/
    ├── 查看数据软件/                          ✅ ModScan32 + ModSim32 (diagnostic tools)
    └── stm32f103-mini-system/               ✅ STM32 firmware with Modbus reader
```

## Việc còn lại (TODO)

- [ ] Mua E78-DTU(900LN22)
- [ ] Test sensor với ModScan32 (commissioning)
- [ ] Cấu hình E78-DTU: AT command cho LoRaWAN join + Modbus polling
- [ ] Register gateway + device trong ChirpStack
- [ ] Viết payload decoder JavaScript trong ChirpStack
- [ ] Cấu hình Node-RED flow: MQTT → Decode → InfluxDB
- [ ] Tạo Grafana dashboard với panels cho từng thông số
- [ ] Deploy server (docker compose up -d trên laptop)
- [ ] Lắp sensor + node ngoài vườn (solar power)
- [ ] Kiểm tra end-to-end data flow
- [ ] Cài alert rules (moisture < 20%, pH bất thường)

## Session Context (cho AI)

- Repo clone tại: `/root/.openclaw/workspace/smartfarm-daklak`
- GitHub: `https://github.com/dinhhieudl/smartfarm-daklak`
- Toàn bộ tài liệu đã được dịch sang tiếng Anh
- Firmware STM32 (RT-Thread) đọc sensor qua RS485 UART2, addr 0x02, poll 5s
- ModScan32 là tool shareware để test sensor (3.5 min limit)
- E90-DTU default freq = 868.125 MHz, CẦN chuyển sang AS923 (923.2 MHz)
- E870 dùng Semtech SX1302, chỉ nhận LoRaWAN frames
