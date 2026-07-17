# 10 - CHI PHÍ DỰ KIẾN

## 1. Chi Phí Hardware (Một Lần)

### 1.1 Gateway (1 bộ)

| Linh kiện | Model | SL | Đơn giá (USD) | Tổng |
|-----------|-------|-----|---------------|------|
| Gateway LoRaWAN | E870-L915LG12 | 1 | $90 | $90 |
| Antenne LoRa 915MHz | SMA Omni 3dBi | 1 | $8 | $8 |
| Nguồn 12V/2A | Adapter 5.5x2.1mm | 1 | $6 | $6 |
| Ethernet Cable | Cat5e 50m | 1 | $7 | $7 |
| Tủ IP65 | 300x200x150mm | 1 | $12 | $12 |
| Cột antenne | Inox 3m | 1 | $15 | $15 |
| **Subtotal** | | | | **$138** |

### 1.2 Mỗi Zone (x3)

| Linh kiện | Model | SL/khu | Đơn giá | Zone A | Zone B | Zone C |
|-----------|-------|--------|---------|--------|--------|--------|
| Node LoRaWAN | E78-DTU(900LN22) | 1 | $30 | $30 | $30 | $30 |
| Soil Sensor | 8-tham-số RS485 | 1 | $40 | $40 | $40 | $40 |
| Antenne SMA | 915MHz 3dBi | 1 | $4 | $4 | $4 | $4 |
| Nguồn 12V/0.5A | Adapter | 1 | $6 | $6 | $6 | $6 |
| Cable RS485 | Cat5 20m | 1 | $5 | $5 | $5 | $5 |
| Relay Module | 1-channel 12V | 1 | $3 | $3 | $3 | $3 |
| Van điện tử | DN25 12V DC | 1 | $15 | $15 | $15 | $15 |
| Tủ IP65 | 200x150x100mm | 1 | $7 | $7 | $7 | $7 |
| **Subtotal** | | | | **$110** | **$110** | **$110** |

**Tổng 3 zones: $330**

### 1.3 Hệ Thống Bơm Tưới

| Linh kiện | Model | SL | Đơn giá | Tổng |
|-----------|-------|-----|---------|------|
| Máy bơm chính | Bơm chìm 12V | 1 | $30 | $30 |
| Máy bơm dự phòng | Bơm chìm 12V | 1 | $30 | $30 |
| Relay 4-channel | 12V trigger 10A | 1 | $7 | $7 |
| Nguồn 12V/10A | Switching PSU | 1 | $12 | $12 |
| ống PE DN25 | 100m | 1 | $20 | $20 |
| ống nhỏ giọt DN16 | 200m | 1 | $15 | $15 |
| Bộ lọc nước | Lọc thô+tinh | 1 | $8 | $8 |
| **Subtotal** | | | | **$122** |

### 1.4 Nguồn Điện Solar (x3 điểm)

| Linh kiện | Model | SL/điểm | Đơn giá | Tổng 3 điểm |
|-----------|-------|---------|---------|------------|
| Pin 12V 7Ah | Lead-acid | 1 | $18 | $54 |
| Tấm pin 15W | 12V | 1 | $15 | $45 |
| Controller | PWM 12V | 1 | $7 | $21 |
| **Subtotal** | | | | **$120** |

### 1.5 Máy Chủ

| Linh kiện | Model | SL | Đơn giá | Tổng |
|-----------|-------|-----|---------|------|
| Mini PC hoặc RPi 4/5 | 4GB RAM, 32GB+ SSD | 1 | $150 | $150 |
| Nguồn + Case | đi kèm | 1 | $0 | $0 |
| **Subtotal** | | | | **$150** |

### 1.6 Vật Tư Phụ

| Hạng mục | Chi phí |
|----------|---------|
| Cable, connectors, đầu nối | $30 |
| Ống nước phụ, co, tê | $25 |
| Băng keo cách điện, zip tie | $10 |
| Bảng điện, CB, ổ cắm | $15 |
| **Subtotal** | **$80** |

### 1.7 Tổng Hợp Hardware

| Nhóm | Chi phí (USD) | Chi phí (VND) |
|------|--------------|--------------|
| Gateway | $138 | 3,450,000 |
| Zone A | $110 | 2,750,000 |
| Zone B | $110 | 2,750,000 |
| Zone C | $110 | 2,750,000 |
| Hệ thống bơm | $122 | 3,050,000 |
| Nguồn solar x3 | $120 | 3,000,000 |
| Máy chủ | $150 | 3,750,000 |
| Vật tư phụ | $80 | 2,000,000 |
| **TỔNG HARDWARE** | **$940** | **23,500,000** |

---

## 2. Chi Phí Phần Mềm

| Hạng mục | Chi phí | Ghi chú |
|----------|---------|---------|
| Docker | $0 | Miễn phí |
| ChirpStack | $0 | MIT License |
| Node-RED | $0 | Apache 2.0 |
| InfluxDB | $0 | MIT (Community) |
| Grafana | $0 | AGPL (Community) |
| Smart Control | $0 | MIT (tự phát triển) |
| **TỔNG PHẦN MỀM** | **$0** | |

---

## 3. Chi Phí Hàng Tháng

| Hạng mục | Chi phí/tháng | Chi phí/năm | Ghi chú |
|----------|--------------|------------|---------|
| Điện (solar bù) | $3 | $36 | Hệ thống solar chính, bù điện đêm |
| Internet | $7 | $84 | Gói cơ bản, chỉ cần weather API |
| Bảo trì linh kiện | $5 | $60 | Thay relay, cable, phụ kiện |
| **TỔNG THÁNG** | **$15** | **$180** | ~375,000 VND/tháng |

---

## 4. Tổng Chi Phí Dự Kiến

### 4.1 Năm Đầu

| Hạng mục | Chi phí (USD) | Chi phí (VND) |
|----------|--------------|--------------|
| Hardware (một lần) | $940 | 23,500,000 |
| Phần mềm | $0 | 0 |
| Vận hành 12 tháng | $180 | 4,500,000 |
| Nhân công lắp đặt (ước tính) | $200 | 5,000,000 |
| **TỔNG NĂM ĐẦU** | **$1,320** | **33,000,000** |

### 4.2 Các Năm Sau

| Hạng mục | Chi phí/năm (USD) | Chi phí/năm (VND) |
|----------|-------------------|-------------------|
| Vận hành | $180 | 4,500,000 |
| Thay thế linh hao | $50 | 1,250,000 |
| **TỔNG/NĂM** | **$230** | **5,750,000** |

### 4.3 Tổng 5 Năm

| Năm | Chi phí (USD) | Chi phí (VND) |
|-----|--------------|--------------|
| Năm 1 | $1,320 | 33,000,000 |
| Năm 2 | $230 | 5,750,000 |
| Năm 3 | $230 | 5,750,000 |
| Năm 4 | $230 | 5,750,000 |
| Năm 5 | $230 | 5,750,000 |
| **TỔNG 5 NĂM** | **$2,240** | **56,000,000** |

---

## 5. So Sánh Chi Phí

### Với Tưới Thủ Công

| Hạng mục | Thủ công | Smart Farm | Tiết kiệm |
|----------|---------|------------|-----------|
| Nước/tháng | 50,000 L | 30,000 L | 40% |
| Điện bơm/tháng | $15 | $8 | 47% |
| Nhân công/tháng | $100 | $20 | 80% |
| Phân bón/năm | $200 | $150 | 25% |
| **Tổng/năm** | **$1,860** | **$456** | **75%** |

> **Lưu ý:** Chi phí trên là ước tính. Chi phí thực tế thay đổi theo khu vực, thời điểm, và quy mô.
