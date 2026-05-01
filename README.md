# 🌱 SmartFarm DakLak

> Hệ thống nông nghiệp thông minh dựa trên LoRaWAN cho vùng cà phê Đắk Lắk, Việt Nam

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Compose-blue.svg)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20+-yellow.svg)](package.json)

---

## 📋 Tổng quan

SmartFarm DakLak là hệ thống giám sát và điều khiển tự động cho nông trại cà phê, sử dụng công nghệ **LoRaWAN** để thu thập dữ liệu cảm biến đất và điều khiển thiết bị tưới từ xa.

### Tính năng chính

- 📡 **Thu thập dữ liệu cảm biến** — Nhiệt độ, độ ẩm, EC, NPK, pH, độ mặn
- 🎛️ **Điều khiển thông minh** — Bơm/van theo 3 khu vực (zones)
- 💧 **Tưới tự động** — Theo ngưỡng độ ẩm + dừng khi mưa
- 🧠 **Tư vấn cây trồng** — Giai đoạn cà phê Robusta/Arabica (6 giai đoạn)
- 🌤️ **Tích hợp thời tiết** — Dự báo DakLak + ảnh hưởng tưới
- 📊 **Dashboard trực quan** — Grafana + Dashboard tùy chỉnh thời gian thực

---

## 🏗️ Kiến trúc hệ thống

```
┌─────────────┐    LoRaWAN    ┌──────────────┐    MQTT    ┌───────────┐
│ Soil Sensor │──────────────▶│   E870       │──────────▶│ Mosquitto │
│ (RS485/Mod  │    AS923      │  Gateway     │           │  Broker   │
│  bus)       │               └──────────────┘           └─────┬─────┘
└─────────────┘                                                │
                                                               ▼
                    ┌──────────────────────────────────────────────┐
                    │              ChirpStack v4                    │
                    │         (LoRaWAN Network Server)              │
                    └──────────────┬───────────────────────────────┘
                                   │ MQTT (decoded JSON)
                                   ▼
                    ┌──────────────────────────────────────────────┐
                    │              Node-RED                         │
                    │    (Data Processing & Routing)                │
                    └──────┬────────────────────┬──────────────────┘
                           │                    │
                           ▼                    ▼
                    ┌─────────────┐    ┌──────────────────┐
                    │  InfluxDB   │    │  Smart Control    │
                    │  (Storage)  │    │  (Irrigation +    │
                    └──────┬──────┘    │   Advisory)       │
                           │           └────────┬─────────┘
                           ▼                    ▼
                    ┌─────────────┐    ┌──────────────────┐
                    │   Grafana   │    │  Simulator UI    │
                    │ (Dashboard) │    │  (localhost:3001) │
                    └─────────────┘    └──────────────────┘
```

---

## 🚀 Cài đặt nhanh

### Yêu cầu

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose v2+
- [Node.js](https://nodejs.org/) 20+ (cho Simulator & Smart Control standalone)

### 1. Clone repository

```bash
git clone https://github.com/dinhhieudl/smartfarm-daklak.git
cd smartfarm-daklak
```

### 2. Cấu hình môi trường

```bash
cp .env.example .env
# Chỉnh sửa .env với giá trị thực (password, token...)
```

### 3. Khởi động Server Stack

```bash
cd server
docker compose up -d
```

### 4. Chạy Simulator (mô phỏng dữ liệu cảm biến)

```bash
cd simulator
npm install
npm start
# → Mở http://localhost:3001
```

### 5. Chạy Smart Control (điều khiển & tư vấn)

```bash
cd smart-control
npm install
npm start
# → Mở http://localhost:3002
```

---

## 🌐 Các dịch vụ

| Service | URL | Mô tả |
|---------|-----|-------|
| **Smart Control** | http://localhost:3002 | 🎛️ Điều khiển bơm/van + Tư vấn thông minh |
| **Simulator** | http://localhost:3001 | 📊 Mô phỏng dữ liệu cảm biến |
| **ChirpStack** | http://localhost:8080 | 📡 LoRaWAN Network Server (admin/admin) |
| **Node-RED** | http://localhost:1880 | 🔄 Data Processing |
| **Grafana** | http://localhost:3005 | 📈 Dashboard & Monitoring (admin/admin) |
| **InfluxDB** | http://localhost:8086 | 💾 Time-Series Database |

---

## 📂 Cấu trúc thư mục

```
smartfarm-daklak/
├── README.md                    # Tài liệu này
├── .env.example                 # Template cấu hình môi trường
├── .gitignore
├── DEPLOY.md                    # Hướng dẫn deploy chi tiết
├── docs/
│   ├── hardware/                # Datasheet phần cứng
│   │   ├── E870-L915LG12-gateway.md
│   │   ├── E78-DTU-900LN22-node.md
│   │   ├── E90-DTU-900SL22-node.md
│   │   ├── soil-multi-parameter-sensor.md
│   │   └── frequency-plan.md
│   ├── planning/                # Kiến trúc & kế hoạch
│   │   ├── system-architecture.md
│   │   ├── connectivity-plan.md
│   │   ├── deployment-guide.md
│   │   └── server-selection.md
│   ├── setup/                   # Hướng dẫn cài đặt
│   │   ├── chirpstack-setup.md
│   │   ├── e78-dtu-at-commands.md
│   │   └── e78-900tbl-at-commands.md
│   └── code/                    # Ví dụ code
│       └── example_modbus.c
├── server/
│   ├── docker-compose.yml       # Full stack Docker
│   ├── config/
│   │   ├── mosquitto.conf       # MQTT broker config
│   │   ├── chirpstack.toml      # LoRaWAN server config
│   │   ├── region_as923.toml    # AS923 region config
│   │   ├── node-red-flows.json  # Node-RED data pipeline
│   │   └── grafana/             # Grafana dashboards & provisioning
│   ├── setup.sh / setup.bat     # Setup scripts
│   ├── start.bat / stop.bat     # Windows control scripts
│   └── README.md
├── simulator/                   # 📊 Sensor Simulator
│   ├── server.js                # Express + Socket.IO + MQTT publisher
│   ├── package.json
│   ├── .dockerignore
│   └── public/
│       └── index.html           # Simulator Web UI
├── smart-control/               # 🎛️ Smart Control & Advisory
│   ├── server.js                # Control logic, crop KB, weather, auto irrigation
│   ├── package.json
│   ├── Dockerfile
│   ├── .dockerignore
│   └── public/
│       └── index.html           # Control Dashboard UI
└── software/                    # Vendor tools (ModScan32, ModSim32)
```

---

## 🌡️ Cảm biến hỗ trợ

Cảm biến đa thông số đất (Soil Multi-Parameter):

| Thông số | Ký hiệu | Đơn vị | Phạm vi |
|----------|----------|--------|---------|
| Nhiệt độ | temperature | °C | -10 ~ 60 |
| Độ ẩm đất | moisture | %VWC | 0 ~ 100 |
| Độ dẫn điện | EC | µS/cm | 0 ~ 10000 |
| Độ mặn | salinity | ppm | 0 ~ 5000 |
| Nitrogen | N | mg/kg | 0 ~ 500 |
| Phosphorus | P | mg/kg | 0 ~ 200 |
| Potassium | K | mg/kg | 0 ~ 500 |
| Độ chua | pH | pH | 0 ~ 14 |

---

## ☕ Giai đoạn cà phê

Hệ thống tư vấn dựa trên 6 giai đoạn sinh trưởng:

| Giai đoạn | Tháng | Tưới | Phân bón chính |
|-----------|-------|------|----------------|
| 🌑 Nghỉ | 11-1 | 2 tuần/lần | Phân chuồng + vôi |
| 🌸 Ra hoa | 2-3 | 1 lần/tuần | Lân (P) cao |
| 🫛 Đậu quả | 3-5 | 1 lần/tuần | NPK 20-10-10 |
| 🫘 Phát triển | 5-8 | 1-2 lần/tuần | Kali (K) cao |
| 🔴 Chín | 9-10 | Giảm tưới | Kali nhẹ |
| 🧺 Thu hoạch | 10-11 | Phục hồi | NPK cân bằng |

---

## 🔧 API Reference

### Smart Control API (`localhost:3002`)

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/zones` | Danh sách khu vực + dữ liệu cảm biến |
| GET | `/api/actuators` | Trạng thái bơm/van |
| POST | `/api/control` | Điều khiển bơm/van `{actuatorId, action}` |
| GET | `/api/advisory/:zoneId` | Tư vấn cho khu vực |
| GET | `/api/weather` | Dữ liệu thời tiết |
| GET | `/api/crop-stages` | Knowledge base giai đoạn cây trồng |
| GET | `/api/history` | Nhật ký điều khiển |
| GET | `/api/health` | Health check |

### Simulator API (`localhost:3001`)

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/status` | Trạng thái simulator |
| POST | `/api/publish` | Gửi dữ liệu cảm biến tùy chỉnh |
| GET | `/api/health` | Health check |

---

## 🛡️ Bảo mật

### Production Checklist

- [ ] Thay đổi tất cả password mặc định trong `.env`
- [ ] Tạo InfluxDB token mới: `openssl rand -hex 32`
- [ ] Tạo ChirpStack JWT secret mới: `openssl rand -hex 32`
- [ ] Bật MQTT authentication trong `mosquitto.conf`
- [ ] Đặt firewall cho các port (5432, 6379, 8086)
- [ ] Sử dụng HTTPS với reverse proxy (nginx/caddy)

---

## 📖 Tài liệu

- [Hướng dẫn Deploy](DEPLOY.md)
- [Kiến trúc hệ thống](docs/planning/system-architecture.md)
- [Kế hoạch kết nối](docs/planning/connectivity-plan.md)
- [Cài đặt ChirpStack](docs/setup/chirpstack-setup.md)
- [AT Commands E78-DTU](docs/setup/e78-dtu-at-commands.md)
- [Datasheet cảm biến](docs/hardware/soil-multi-parameter-sensor.md)

---

## 🤝 Đóng góp

1. Fork repository
2. Tạo feature branch: `git checkout -b feature/ten-feature`
3. Commit: `git commit -m "feat: them ten-feature"`
4. Push: `git push origin feature/ten-feature`
5. Tạo Pull Request

### Quy tắc commit

Sử dụng [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — Tính năng mới
- `fix:` — Sửa lỗi
- `docs:` — Tài liệu
- `refactor:` — Tái cấu trúc code
- `perf:` — Tối ưu hiệu suất
- `test:` — Thêm test
- `chore:` — Công việc khác

---

## 📄 License

MIT License. Xem [LICENSE](LICENSE) để biết thêm chi tiết.
