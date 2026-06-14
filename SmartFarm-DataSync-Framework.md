# SmartFarm — Framework Đồng Bộ Dữ Liệu & Tổ Chức Dữ Liệu

**Phiên bản:** 1.0  
**Ngày:** 14/06/2026  
**Phạm vi:** Kiến trúc đẩy dữ liệu từ Local (RPi tại nông trại) lên Cloud, mô hình dữ liệu, và chiến lược lưu trữ.

---

## Mục Lục

1. [Tổng Quan Kiến Trúc](#1-tổng-quan-kiến-trúc)
2. [Luồng Dữ Liệu](#2-luồng-dữ-liệu)
3. [Giao Thức Đồng Bộ](#3-giao-thức-đồng-bộ)
4. [Chiến Lược Sync Offline-First](#4-chiến-lược-sync-offline-first)
5. [Mô Hình Dữ Liệu](#5-mô-hình-dữ-liệu)
6. [Tổ Chức Database](#6-tổ-chức-database)
7. [Schema Chi Tiết](#7-schema-chi-tiết)
8. [API Design](#8-api-design)
9. [Bảo Mật & Xác Thực](#9-bảo-mật--xác-thực)
10. [Xử Lý Edge Cases](#10-xử-lý-edge-cases)
11. [Công Nghệ Khuyến Nghị](#11-công-nghệ-khuyến-nghị)

---

## 1. Tổng Quan Kiến Trúc

```
┌─────────────────────────────────────────────────────────────────┐
│                        NÔNG TRẠI (LOCAL)                        │
│                                                                 │
│  ┌──────────┐  LoRa  ┌──────────┐  GPIO/I2C  ┌──────────────┐ │
│  │ Cảm biến  │──────▶│ Gateway  │───────────▶│ Raspberry Pi │ │
│  │ (nhiều)   │  868MHz│ (RPi)    │            │  Edge Agent  │ │
│  └──────────┘        └──────────┘            └──────┬───────┘ │
│                                                      │         │
│                                              ┌───────┴───────┐ │
│                                              │ Local SQLite  │ │
│                                              │ (buffer/batch)│ │
│                                              └───────┬───────┘ │
│                                                      │         │
│                                              ┌───────┴───────┐ │
│                                              │  Local Web UI │ │
│                                              │  (port 8080)  │ │
│                                              └───────────────┘ │
└──────────────────────────────────┬──────────────────────────────┘
                                   │
                    4G / WiFi (intermittent)
                    MQTT (primary) + REST (fallback)
                                   │
┌──────────────────────────────────▼──────────────────────────────┐
│                          CLOUD                                  │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ MQTT Broker  │───▶│ Ingestion    │───▶│ TimescaleDB /    │  │
│  │ (EMQX/       │    │ Service      │    │ PostgreSQL       │  │
│  │  Mosquitto)  │    │ (validate,   │    │ (time-series +   │  │
│  └──────────────┘    │  transform)  │    │  relational)     │  │
│                      └──────────────┘    └────────┬─────────┘  │
│                                                   │             │
│  ┌──────────────┐    ┌──────────────┐    ┌────────▼─────────┐  │
│  │ Alert        │◀───│ Analytics    │◀───│ Redis            │  │
│  │ Engine       │    │ Service      │    │ (cache, realtime)│  │
│  │ (SMS/Zalo)   │    └──────────────┘    └──────────────────┘  │
│  └──────────────┘                                               │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ API Gateway  │◀───│ Auth Service │    │ Object Storage   │  │
│  │ (REST/       │    │ (JWT + API   │    │ (S3/MinIO -      │  │
│  │  GraphQL)    │    │  keys)       │    │  photos, exports)│  │
│  └──────────────┘    └──────────────┘    └──────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Nguyên Tắc Thiết Kế Cốt Lõi

| Nguyên tắc | Mô tả |
|-----------|-------|
| **Offline-first** | Hệ thống phải hoạt động đầy đủ khi mất internet. Dữ liệu buffer cục bộ, sync khi có mạng |
| **Edge compute** | Xử lý càng nhiều càng tốt ở RPi (lọc, aggregate, cảnh báo) trước khi đẩy lên cloud |
| **Idempotent** | Gửi lại dữ liệu không tạo bản trùng. Mỗi record có ID duy nhất |
| **Batch > Stream** | Với kết nối chập chờn, batch upload hiệu quả hơn stream liên tục |
| **Graceful degradation** | Nếu cloud không可达, local vẫn hoạt động. Nếu cảm biến chết, các cảm biến khác vẫn chạy |

---

## 2. Luồng Dữ Liệu

### 2.1 Chiều Local → Cloud (Uplink - Chính)

```
Cảm biến đọc → Edge Agent xử lý → Local DB lưu → Batch uploader → MQTT publish → Cloud ingest → TimescaleDB
```

**Chi tiết từng bước:**

```
1. Cảm biến đọc (mỗi 5-15 phút)
   └─▶ LoRa packet → Gateway → parse → raw reading

2. Edge Agent xử lý
   └─▶ Validate (giá trị hợp lệ? trong khoảng?)
   └─▶ Enrich (gắn sensor_id, farm_id, timestamp)
   └─▶ Local alert check (nếu vượt ngưỡng → SMS ngay)
   └─▶ Lưu vào local SQLite

3. Batch Uploader (mỗi 1-6 giờ, hoặc khi có kết nối)
   └─▶ Đọc từ local DB WHERE synced = FALSE
   └─▶ Gom batch (tối đa 500 readings/batch)
   └─▶ MQTT publish với QoS 1 (at-least-once)
   └─▶ Đánh dấu synced = TRUE khi broker ACK

4. Cloud Ingestion Service
   └─▶ Validate schema
   └─▶ Dedup (check unique reading_id)
   └─▶ Transform → canonical format
   └─▶ INSERT INTO TimescaleDB
   └─▶ Trigger alert engine nếu cần
```

### 2.2 Chiều Cloud → Local (Downlink - Phụ)

```
Cloud API → MQTT command topic → Edge Agent nhận → Thực thi → ACK
```

**Các lệnh downlink:**
- Cập nhật ngưỡng cảnh báo
- Thay đổi tần suất đọc cảm biến
- Khởi động lại cảm biến
- Cập nhật firmware
- Đồng bộ cấu hình farm

### 2.3 Chiều Local → User (Trực tiếp)

```
RPi web server (port 8080) → Browser trên cùng mạng WiFi
```

**Không cần cloud để xem data realtime tại nông trại.**

---

## 3. Giao Thức Đồng Bộ

### 3.1 MQTT (Primary Channel)

**Tại sao MQTT?**
- Lightweight: header chỉ 2 bytes, phù hợp bandwidth hạn chế
- QoS levels: 0 (at-most-once), 1 (at-least-once), 2 (exactly-once)
- Persistent session: không mất message khi mất kết nối tạm thời
- Pub/Sub model: phù hợp IoT
- Widely supported: Mosquitto, EMQX, AWS IoT Core, HiveMQ

**Topic structure:**

```
smartfarm/
├── {farm_id}/
│   ├── telemetry/          # Dữ liệu cảm biến (uplink)
│   │   └── {sensor_type}   # soil_moisture, temperature, humidity, rain, light
│   ├── status/             # Trạng thái thiết bị
│   │   └── {device_id}     # online/offline, battery, signal
│   ├── alerts/             # Cảnh báo cục bộ đã trigger
│   │   └── {alert_type}    # threshold_breach, sensor_fault
│   ├── commands/           # Lệnh từ cloud (downlink)
│   │   └── {command_type}  # config_update, firmware_update
│   └── ack/                # Xác nhận lệnh
│       └── {command_id}
```

**Ví dụ message telemetry:**

```json
// Topic: smartfarm/farm_001/telemetry/soil_moisture
{
  "batch_id": "uuid-v4",
  "farm_id": "farm_001",
  "device_id": "rpi_001",
  "readings": [
    {
      "reading_id": "uuid-v4",
      "sensor_id": "soil_01",
      "sensor_type": "soil_moisture",
      "value": 42.5,
      "unit": "%",
      "quality": "good",
      "ts": "2026-06-14T02:30:00Z"
    },
    {
      "reading_id": "uuid-v4",
      "sensor_id": "soil_02",
      "sensor_type": "soil_moisture",
      "value": 38.1,
      "unit": "%",
      "quality": "good",
      "ts": "2026-06-14T02:30:00Z"
    }
  ],
  "meta": {
    "rpi_uptime_s": 86400,
    "signal_rssi": -75,
    "battery_pct": null,
    "firmware_version": "1.2.3"
  }
}
```

### 3.2 REST API (Fallback + Management)

**Khi dùng REST:**
- Đăng ký/đăng nhập thiết bị
- Upload batch khi MQTT broker không可达
- Quản lý cấu hình (không real-time)
- Xuất dữ liệu, báo cáo
- Upload ảnh (sâu bệnh, GPS)

### 3.3 So Sánh & Quyết Định

| Tiêu chí | MQTT | REST | Webhook |
|----------|------|------|---------|
| **Real-time** | ✅ Tốt nhất | ❌ Polling | ✅ Push |
| **Bandwidth** | ✅ Rất thấp | ⚠️ Cao hơn | ⚠️ Trung bình |
| **Offline buffer** | ✅ Built-in (persistent session) | ❌ Phải tự implement | ❌ Phải tự implement |
| **Complexity** | ⚠️ Cần broker | ✅ Đơn giản | ✅ Đơn giản |
| **Fallback** | REST | MQTT | MQTT |

**Quyết định:** MQTT primary, REST fallback. Edge Agent tự động切换 khi MQTT fail.

---

## 4. Chiến Lược Sync Offline-First

### 4.1 Local Storage trên RPi

```sql
-- SQLite schema trên RPi (edge)

CREATE TABLE readings (
    reading_id    TEXT PRIMARY KEY,    -- UUID v4
    sensor_id     TEXT NOT NULL,
    sensor_type   TEXT NOT NULL,
    value         REAL NOT NULL,
    unit          TEXT NOT NULL,
    quality       TEXT DEFAULT 'good', -- good, suspect, invalid
    ts            TEXT NOT NULL,       -- ISO 8601 UTC
    synced        INTEGER DEFAULT 0,  -- 0=chưa sync, 1=đã sync
    sync_attempts INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_readings_synced ON readings(synced, ts);
CREATE INDEX idx_readings_sensor ON readings(sensor_id, ts);

-- Buffer tối đa 7 ngày dữ liệu, auto-cleanup
-- Với 6 sensors, đọc mỗi 10 phút = ~6000 records/ngày ≈ 42K records/tuần
-- SQLite handle thoải mái ở quy mô này
```

### 4.2 Sync State Machine

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  PENDING │────▶│  SENDING │────▶│   SENT   │────▶│   ACKED  │
│ (synced=0)│     │ (in-flight)│    │ (awaiting)│    │ (synced=1)│
└──────────┘     └─────┬────┘     └──────────┘     └──────────┘
                       │
                       │ fail
                       ▼
                 ┌──────────┐     ┌──────────┐
                 │  RETRY   │────▶│  FAILED  │
                 │ (attempts│     │ (>3 tries│
                 │  < 3)    │     │  → alert)│
                 └──────────┘     └──────────┘
```

### 4.3 Batch Upload Logic

```python
# Pseudocode cho BatchUploader trên RPi

class BatchUploader:
    BATCH_SIZE = 500          # max readings per batch
    SYNC_INTERVAL = 3600      # 1 giờ (bình thường)
    RETRY_INTERVAL = 300      # 5 phút (khi fail)
    MAX_RETRIES = 3

    def sync_cycle(self):
        # 1. Kiểm tra kết nối
        if not self.check_connectivity():
            return  # chờ lần sau

        # 2. Lấy batch chưa sync
        batch = db.query("""
            SELECT * FROM readings
            WHERE synced = 0 AND sync_attempts < 3
            ORDER BY ts ASC
            LIMIT ?
        """, [self.BATCH_SIZE])

        if not batch:
            return  # không có gì để sync

        # 3. Gửi qua MQTT
        payload = self.build_batch_payload(batch)
        success = mqtt_client.publish(
            topic=f"smartfarm/{FARM_ID}/telemetry/batch",
            payload=json.dumps(payload),
            qos=1  # at-least-once
        )

        if success:
            # 4. Đánh dấu đã sync
            reading_ids = [r['reading_id'] for r in batch]
            db.execute("""
                UPDATE readings SET synced = 1
                WHERE reading_id IN (?)
            """, reading_ids)
        else:
            # 5. Tăng retry count
            db.execute("""
                UPDATE readings
                SET sync_attempts = sync_attempts + 1
                WHERE reading_id IN (?)
            """, [r['reading_id'] for r in batch])

    def check_connectivity(self):
        """Kiểm tra MQTT broker reachable"""
        try:
            mqtt_client.ping()
            return True
        except:
            # Fallback: thử REST API
            try:
                requests.get(CLOUD_HEALTH_URL, timeout=5)
                return True  # sẽ dùng REST fallback
            except:
                return False
```

### 4.4 Conflict Resolution

**Không có conflict!** Dữ liệu IoT là append-only (chỉ thêm, không sửa). Mỗi reading có ID duy nhất và timestamp. Cloud chỉ cần dedup theo `reading_id`.

```
Local tạo reading → gán UUID → lưu local → sync lên cloud
Cloud nhận → check reading_id đã tồn tại?
  ├── Chưa → INSERT
  └── Rồi → SKIP (idempotent)
```

---

## 5. Mô Hình Dữ Liệu

### 5.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    Farm      │1────N│   Device    │1────N│   Sensor    │
│              │       │  (RPi/GW)   │       │             │
└──────┬──────┘       └─────────────┘       └──────┬──────┘
       │                                           │
       │1                                          │1
       │                                           │
       │N          ┌─────────────┐                │N
┌──────┴──────┐    │   Field     │       ┌────────┴────────┐
│    User     │N──1│  (ruộng)    │1────N│    Reading       │
│             │    │             │       │  (time-series)   │
└─────────────┘    └──────┬──────┘       └─────────────────┘
                          │
                          │1
                          │
                   ┌──────┴──────┐
                   │ CropSeason  │
                   │ (mùa vụ)    │
                   └─────────────┘
```

### 5.2 Các Entity Chính

| Entity | Mô tả | Ví dụ |
|--------|-------|-------|
| **Farm** | Nông trại, đơn vị tổ chức cao nhất | "Nông trại Anh Ba - Buôn Ma Thuột" |
| **Field** | Thửa ruộng trong nông trại | "Ruộng phía Bắc", "Ruộng đồi" |
| **Device** | Thiết bị phần cứng (RPi, gateway) | "RPi-001", "Gateway-A" |
| **Sensor** | Cảm biến gắn trên thiết bị | "Soil-01", "Temp-01" |
| **Reading** | Một lần đọc từ cảm biến | 42.5% moisture @ 10:30 |
| **CropSeason** | Mùa vụ canh tác | "Vụ 2025-2026" |
| **User** | Người dùng hệ thống | Anh Ba, Chị Hoa |
| **Alert** | Cảnh báo đã trigger | "Độ ẩm đất thấp nguy hiểm" |
| **Input** | Đầu vào nông nghiệp (phân bón, thuốc) | "50kg NPK 16-16-8" |

---

## 6. Tổ Chức Database

### 6.1 Cloud Database Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLOUD DATABASES                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  PostgreSQL + TimescaleDB Extension               │  │
│  │                                                   │  │
│  │  ┌─────────────┐  ┌──────────────────────────┐   │  │
│  │  │ Relational  │  │ Time-Series (Hypertable) │   │  │
│  │  │ Tables:     │  │                          │   │  │
│  │  │ - farms     │  │ - readings               │   │  │
│  │  │ - fields    │  │ - device_status           │   │  │
│  │  │ - devices   │  │ - alerts_log              │   │  │
│  │  │ - sensors   │  │                          │   │  │
│  │  │ - users     │  │ Tự động partition theo    │   │  │
│  │  │ - crops     │  │ thời gian (1 partition/   │   │  │
│  │  │ - inputs    │  │ tuần)                    │   │  │
│  │  └─────────────┘  └──────────────────────────┘   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌──────────────────┐  ┌────────────────────────────┐  │
│  │  Redis            │  │  MinIO (S3-compatible)     │  │
│  │  - Session cache  │  │  - Ảnh sâu bệnh            │  │
│  │  - Real-time      │  │  - Exports (PDF, CSV)      │  │
│  │    sensor values  │  │  - Firmware binaries       │  │
│  │  - Rate limiting  │  │  - Satellite imagery       │  │
│  └──────────────────┘  └────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Tại sao TimescaleDB?

| Tiêu chí | TimescaleDB | InfluxDB | MongoDB | PostgreSQL thuần |
|----------|-------------|----------|---------|-----------------|
| Time-series optimization | ✅ Hypertable, auto-partition | ✅ Tốt nhất | ⚠️ Cần custom index | ❌ Manual partition |
| SQL compatible | ✅ PostgreSQL syntax | ❌ Flux/InfluxQL | ❌ MQL | ✅ |
| Join relational data | ✅ (cùng DB) | ❌ (phải query riêng) | ⚠️ Lookup | ✅ |
| Compression | ✅ 90-95% cho old data | ✅ | ⚠️ | ❌ |
| Retention policy | ✅ Auto-drop old chunks | ✅ | ❌ Manual | ❌ Manual |
| Community/support | ✅ Large | ✅ Large | ✅ Large | ✅ Largest |
| Operational complexity | ✅ Chỉ 1 DB engine | ⚠️ Thêm 1 engine | ⚠️ Thêm 1 engine | ✅ |

**Quyết định:** TimescaleDB extension trên PostgreSQL = time-series + relational trong 1 engine. Giản lược运维.

### 6.3 Data Retention Policy

| Data type | Raw retention | Aggregated retention | Ghi chú |
|-----------|--------------|---------------------|---------|
| Sensor readings (raw) | 90 ngày | — | Drop chunks sau 90 ngày |
| Hourly aggregates | 1 năm | — | Rollup từ raw |
| Daily aggregates | Vĩnh viễn | — | Dùng cho AI/ML, báo cáo |
| Device status | 30 ngày | — | Ít giá trị lâu dài |
| Alerts | 1 năm | — | Compliance, audit |
| Photos | 6 tháng | — | S3 lifecycle → Glacier |
| Farm/field/sensor metadata | Vĩnh viễn | — | Relational, nhỏ |

```sql
-- TimescaleDB: tự động xóa data cũ
SELECT add_retention_policy('readings_raw', INTERVAL '90 days');

-- Tạo continuous aggregate (hourly)
CREATE MATERIALIZED VIEW readings_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    sensor_id,
    sensor_type,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS sample_count
FROM readings_raw
GROUP BY bucket, sensor_id, sensor_type;

-- Retention cho aggregate
SELECT add_retention_policy('readings_hourly', INTERVAL '1 year');
```

---

## 7. Schema Chi Tiết

### 7.1 Relational Tables (PostgreSQL)

```sql
-- ============================================
-- FARM & ORGANIZATION
-- ============================================

CREATE TABLE farms (
    farm_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(200) NOT NULL,
    owner_user_id UUID NOT NULL,
    location      GEOGRAPHY(POINT, 4326),  -- PostGIS: [lng, lat]
    area_ha       DECIMAL(10,2),
    address       TEXT,
    province      VARCHAR(50) DEFAULT 'DakLak',
    district      VARCHAR(50),
    commune       VARCHAR(50),
    elevation_m   SMALLINT,
    soil_type     VARCHAR(50),             -- basalt, alluvial, etc.
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE fields (
    field_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id       UUID REFERENCES farms(farm_id),
    name          VARCHAR(100) NOT NULL,
    boundary      GEOGRAPHY(POLYGON, 4326),  -- PostGIS polygon
    area_ha       DECIMAL(8,2),
    slope_deg     SMALLINT,
    elevation_m   SMALLINT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DEVICES & SENSORS
-- ============================================

CREATE TABLE devices (
    device_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id       UUID REFERENCES farms(farm_id),
    device_type   VARCHAR(20) NOT NULL,   -- 'rpi', 'gateway', 'sensor_node'
    device_model  VARCHAR(50),            -- 'rpi4b', 'rak7268', 'sensecap'
    serial_number VARCHAR(100) UNIQUE,
    firmware_ver  VARCHAR(20),
    install_date  DATE,
    install_location GEOGRAPHY(POINT, 4326),
    status        VARCHAR(20) DEFAULT 'active', -- active, inactive, maintenance
    last_seen     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sensors (
    sensor_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     UUID REFERENCES devices(device_id),
    field_id      UUID REFERENCES fields(field_id),
    sensor_type   VARCHAR(30) NOT NULL,   -- xem enum bên dưới
    model         VARCHAR(50),
    unit          VARCHAR(10) NOT NULL,
    min_value     DECIMAL(10,2),
    max_value     DECIMAL(10,2),
    accuracy      DECIMAL(5,2),
    install_depth_cm SMALLINT,            -- cho soil sensor
    status        VARCHAR(20) DEFAULT 'active',
    calibration_date DATE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enum sensor_type
CREATE TYPE sensor_type AS ENUM (
    'soil_moisture',      -- % volumetric water content
    'soil_temperature',   -- °C
    'soil_ph',            -- pH
    'soil_ec',            -- dS/m (electrical conductivity)
    'air_temperature',    -- °C
    'air_humidity',       -- % RH
    'rainfall',           -- mm
    'light_intensity',    -- lux hoặc PAR
    'wind_speed',         -- m/s
    'leaf_wetness',       -- % 
    'water_level',        -- mm (cho ao hồ/tưới)
    'flow_rate'           -- L/min (cảm biến lưu lượng)
);

-- ============================================
-- USERS & ACCESS
-- ============================================

CREATE TABLE users (
    user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         VARCHAR(15) UNIQUE NOT NULL, -- SĐT Việt Nam
    name          VARCHAR(100) NOT NULL,
    role          VARCHAR(20) NOT NULL,        -- owner, manager, worker, consultant
    zalo_id       VARCHAR(50),
    email         VARCHAR(100),
    preferred_lang VARCHAR(5) DEFAULT 'vi',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE farm_users (
    farm_id       UUID REFERENCES farms(farm_id),
    user_id       UUID REFERENCES users(user_id),
    role          VARCHAR(20) NOT NULL,        -- owner, manager, viewer, worker
    PRIMARY KEY (farm_id, user_id)
);

-- ============================================
-- CROP & SEASON
-- ============================================

CREATE TABLE crop_seasons (
    season_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id       UUID REFERENCES farms(farm_id),
    field_id      UUID REFERENCES fields(field_id),
    crop_type     VARCHAR(30) NOT NULL,        -- robusta, arabica, pepper, durian
    variety       VARCHAR(50),                 -- TR4, Catimor, etc.
    planting_date DATE,
    expected_harvest DATE,
    actual_harvest DATE,
    yield_kg      DECIMAL(10,2),
    yield_kg_ha   DECIMAL(8,2),
    status        VARCHAR(20) DEFAULT 'active', -- active, harvested, abandoned
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INPUTS (phân bón, thuốc, nước)
-- ============================================

CREATE TABLE inputs (
    input_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id       UUID REFERENCES farms(farm_id),
    field_id      UUID REFERENCES fields(field_id),
    season_id     UUID REFERENCES crop_seasons(season_id),
    input_type    VARCHAR(20) NOT NULL,        -- fertilizer, pesticide, herbicide, water, mulch
    product_name  VARCHAR(200),
    quantity      DECIMAL(10,2),
    unit          VARCHAR(20),                 -- kg, L, m3
    cost_vnd      BIGINT,
    application_date DATE,
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.2 Time-Series Tables (TimescaleDB)

```sql
-- ============================================
-- SENSOR READINGS (Time-Series)
-- ============================================

CREATE TABLE readings_raw (
    ts            TIMESTAMPTZ NOT NULL,
    reading_id    UUID NOT NULL,            -- dedup key
    farm_id       UUID NOT NULL,
    field_id      UUID,
    sensor_id     UUID NOT NULL,
    sensor_type   VARCHAR(30) NOT NULL,
    value         DECIMAL(12,4) NOT NULL,
    unit          VARCHAR(10) NOT NULL,
    quality       VARCHAR(10) DEFAULT 'good', -- good, suspect, invalid
    PRIMARY KEY (ts, reading_id)
);

-- Chuyển thành hypertable (TimescaleDB magic)
SELECT create_hypertable('readings_raw', 'ts',
    chunk_time_interval => INTERVAL '1 day'
);

-- Index cho query phổ biến
CREATE INDEX idx_readings_farm_sensor ON readings_raw (farm_id, sensor_type, ts DESC);
CREATE INDEX idx_readings_field ON readings_raw (field_id, ts DESC);
CREATE INDEX idx_readings_sensor ON readings_raw (sensor_id, ts DESC);

-- Compression: giảm 90-95% storage cho data cũ hơn 7 ngày
ALTER TABLE readings_raw SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'farm_id, sensor_id',
    timescaledb.compress_orderby = 'ts DESC'
);

SELECT add_compression_policy('readings_raw', INTERVAL '7 days');

-- ============================================
-- DEVICE STATUS (Time-Series)
-- ============================================

CREATE TABLE device_status (
    ts            TIMESTAMPTZ NOT NULL,
    device_id     UUID NOT NULL,
    farm_id       UUID NOT NULL,
    status        VARCHAR(20) NOT NULL,     -- online, offline, error
    uptime_s      INTEGER,
    cpu_temp_c    DECIMAL(5,2),
    memory_pct    DECIMAL(5,2),
    disk_pct      DECIMAL(5,2),
    signal_rssi   SMALLINT,
    signal_snr    DECIMAL(5,2),
    battery_pct   SMALLINT,
    PRIMARY KEY (ts, device_id)
);

SELECT create_hypertable('device_status', 'ts',
    chunk_time_interval => INTERVAL '1 day'
);

-- ============================================
-- ALERTS LOG (Time-Series)
-- ============================================

CREATE TABLE alerts_log (
    ts            TIMESTAMPTZ NOT NULL,
    alert_id      UUID NOT NULL,
    farm_id       UUID NOT NULL,
    alert_type    VARCHAR(30) NOT NULL,     -- threshold, anomaly, sensor_fault, device_offline
    severity      VARCHAR(10) NOT NULL,     -- info, warning, critical
    sensor_id     UUID,
    field_id      UUID,
    message_vi    TEXT NOT NULL,             -- thông báo tiếng Việt
    message_en    TEXT,
    value         DECIMAL(12,4),
    threshold     DECIMAL(12,4),
    acknowledged  BOOLEAN DEFAULT FALSE,
    ack_user_id   UUID,
    ack_ts        TIMESTAMPTZ,
    PRIMARY KEY (ts, alert_id)
);

SELECT create_hypertable('alerts_log', 'ts',
    chunk_time_interval => INTERVAL '7 days'
);
```

### 7.3 Continuous Aggregates (Tự động rollup)

```sql
-- ============================================
-- HOURLY AGGREGATES
-- ============================================
CREATE MATERIALIZED VIEW readings_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    farm_id,
    field_id,
    sensor_id,
    sensor_type,
    AVG(value) AS avg_val,
    MIN(value) AS min_val,
    MAX(value) AS max_val,
    STDDEV(value) AS stddev_val,
    COUNT(*) AS samples,
    -- Tính percentile cho phân tích phân bố
    percentile_cont(0.5) WITHIN GROUP (ORDER BY value) AS median_val
FROM readings_raw
GROUP BY bucket, farm_id, field_id, sensor_id, sensor_type;

-- Auto-refresh mỗi 1 giờ
SELECT add_continuous_aggregate_policy('readings_hourly',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour'
);

-- ============================================
-- DAILY AGGREGATES
-- ============================================
CREATE MATERIALIZED VIEW readings_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', ts) AS bucket,
    farm_id,
    field_id,
    sensor_id,
    sensor_type,
    AVG(value) AS avg_val,
    MIN(value) AS min_val,
    MAX(value) AS max_val,
    COUNT(*) AS samples
FROM readings_raw
GROUP BY bucket, farm_id, field_id, sensor_id, sensor_type;

-- Daily aggregates giữ vĩnh viễn (không add retention policy)
```

---

## 8. API Design

### 8.1 REST API Endpoints

```
Base URL: https://api.smartfarm.vn/v1

# ============================================
# AUTHENTICATION
# ============================================
POST   /auth/register          # Đăng ký (phone + OTP)
POST   /auth/login             # Đăng nhập (phone + OTP)
POST   /auth/refresh           # Refresh token
POST   /auth/device/register   # Đăng ký thiết bị RPi
POST   /auth/device/token      # Lấy JWT cho thiết bị

# ============================================
# FARMS
# ============================================
GET    /farms                   # Danh sách nông trại của user
POST   /farms                   # Tạo nông trại mới
GET    /farms/{farm_id}         # Chi tiết nông trại
PUT    /farms/{farm_id}         # Cập nhật nông trại
GET    /farms/{farm_id}/dashboard  # Dashboard tổng hợp

# ============================================
# FIELDS
# ============================================
GET    /farms/{farm_id}/fields          # Danh sách ruộng
POST   /farms/{farm_id}/fields          # Tạo ruộng mới
GET    /farms/{farm_id}/fields/{id}     # Chi tiết ruộng
PUT    /farms/{farm_id}/fields/{id}     # Cập nhật ruộng

# ============================================
# DEVICES & SENSORS
# ============================================
GET    /farms/{farm_id}/devices         # Danh sách thiết bị
POST   /farms/{farm_id}/devices         # Đăng ký thiết bị mới
GET    /devices/{device_id}/status      # Trạng thái thiết bị
GET    /devices/{device_id}/sensors     # Cảm biến trên thiết bị
POST   /devices/{device_id}/command     # Gửi lệnh (downlink)

# ============================================
# READINGS (Time-Series Data)
# ============================================
GET    /farms/{farm_id}/readings
  ?sensor_type=soil_moisture
  &field_id=xxx
  &from=2026-06-01T00:00:00Z
  &to=2026-06-14T23:59:59Z
  &granularity=raw|hourly|daily
  &limit=1000

GET    /farms/{farm_id}/readings/latest
  # Giá trị mới nhất của tất cả cảm biến

GET    /farms/{farm_id}/readings/stats
  ?sensor_type=soil_moisture
  &period=7d
  # Thống kê: avg, min, max, trend

# Batch upload (REST fallback khi MQTT fail)
POST   /farms/{farm_id}/readings/batch
  # Body: { "readings": [...] }

# ============================================
# ALERTS
# ============================================
GET    /farms/{farm_id}/alerts
  ?status=active|acknowledged|all
  &severity=warning|critical
POST   /farms/{farm_id}/alerts/{id}/ack    # Xác nhận cảnh báo
GET    /alerts/config                       # Xem cấu hình ngưỡng
PUT    /alerts/config                       # Cập nhật ngưỡng

# ============================================
# INPUTS (Phân bón, thuốc, nước)
# ============================================
GET    /farms/{farm_id}/inputs
POST   /farms/{farm_id}/inputs
GET    /farms/{farm_id}/inputs/summary      # Tổng hợp chi phí theo mùa

# ============================================
# COOPERATIVE (Enterprise)
# ============================================
GET    /cooperatives/{coop_id}/farms        # Danh sách nông trại thành viên
GET    /cooperatives/{coop_id}/overview     # Tổng quan tất cả nông trại
GET    /cooperatives/{coop_id}/anomalies    # Phát hiện bất thường
POST   /cooperatives/{coop_id}/broadcast    # Gửi thông báo hàng loạt

# ============================================
# EXPORTS
# ============================================
GET    /farms/{farm_id}/export/csv
GET    /farms/{farm_id}/export/pdf
GET    /farms/{farm_id}/export/compliance   # Báo cáo chứng nhận
```

### 8.2 MQTT ↔ REST Sync Flow

```
BÌNH THƯỜNG (có internet):
  RPi → MQTT → Cloud Ingest → DB
  User → REST API → DB → Response

MẤT KẾ NỐI MQTT:
  RPi → buffer local SQLite
  RPi → (khi có internet) → REST /readings/batch → Cloud Ingest → DB

MẤT HOÀN TOÀN INTERNET:
  RPi → buffer local SQLite
  RPi → Local Web UI (user xem trực tiếp)
  RPi → (khi internet恢复) → batch upload
```

---

## 9. Bảo Mật & Xác Thực

### 9.1 Device Authentication (RPi → Cloud)

```
┌──────────┐                    ┌──────────────┐
│  RPi     │───register────────▶│ Auth Service │
│  (new)   │    (serial + key)  │              │
│          │◀──device_token─────│              │
└──────────┘    (JWT, 90 days)  └──────────────┘
     │
     │ Sau đó mọi request:
     │ Header: Authorization: Bearer {device_token}
     │
     │ MQTT:
     │ Username: {device_id}
     │ Password: {device_token}
     │ Topic ACL: smartfarm/{farm_id}/#
```

### 9.2 User Authentication

```
Phone + OTP (SMS) → JWT access_token (1h) + refresh_token (30d)
Zalo Login → OAuth2 → JWT
```

### 9.3 Data Encryption

| Layer | Phương thức |
|-------|------------|
| Transit (RPi↔Cloud) | TLS 1.3 (MQTT over TLS, HTTPS) |
| Transit (LoRa sensor↔Gateway) | LoRa AES-128 encryption |
| At rest (Cloud DB) | PostgreSQL TDE hoặc disk encryption |
| At rest (Local RPi) | LUKS full disk encryption (optional, recommended) |

### 9.4 MQTT Topic ACL

```
# Device chỉ được publish/subscribe topic của farm mình
# Ví dụ device thuộc farm_001:

ALLOW smartfarm/farm_001/telemetry/*  PUBLISH
ALLOW smartfarm/farm_001/status/*     PUBLISH
ALLOW smartfarm/farm_001/alerts/*     PUBLISH
ALLOW smartfarm/farm_001/commands/*   SUBSCRIBE
ALLOW smartfarm/farm_001/ack/*        PUBLISH

DENY smartfarm/+/telemetry/*          PUBLISH  # không được farm khác
DENY smartfarm/+/commands/*           SUBSCRIBE
```

---

## 10. Xử Lý Edge Cases

### 10.1 Bảng Xử Lý

| Tình huống | Xử lý |
|-----------|--------|
| **RPi mất internet > 7 ngày** | Local buffer giữ 7 ngày data. Khi có internet, batch upload toàn bộ. Nếu > 7 ngày, data cũ nhất bị overwrite (FIFO) |
| **Cảm biến trả giá trị bất thường** | Edge Agent validate range. Nếu ngoài [min, max] → đánh quality="invalid", vẫn lưu nhưng flag |
| **Gửi trùng dữ liệu** | Cloud dedup theo reading_id. Idempotent |
| **MQTT broker down** | RPi auto-fallback sang REST API. Khi MQTT恢复, chuyển lại |
| **RPi reboot/power loss** | SQLite WAL mode → data không mất. Agent auto-start on boot (systemd) |
| **Nhiều RPi cùng farm** | Mỗi RPi có device_id riêng. Farm có thể có nhiều device |
| **Cảm biến offline** | Edge Agent detect sensor timeout → alert user → skip sensor, các sensor khác vẫn chạy |
| **Cloud DB full** | TimescaleDB retention policy tự drop old chunks. Disk monitoring alert |
| **User thay đổi RPi** | Đăng ký device mới, sensor mới. Data history giữ nguyên theo farm_id |
| **Clock drift trên RPi** | NTP sync mỗi 6 giờ. Timestamps có timezone offset, cloud normalize về UTC |

### 10.2 Data Quality Pipeline

```
Raw reading → Validate → Enrich → Classify → Store
                │           │         │
                ▼           ▼         ▼
           Range check   Add farm   quality =
           Type check    metadata   good/suspect/invalid
           Rate check    Add geo    
```

```python
# Validation rules cho từng sensor type
VALIDATION_RULES = {
    'soil_moisture': {'min': 0, 'max': 100, 'unit': '%', 'max_change_per_min': 5},
    'soil_temperature': {'min': -5, 'max': 60, 'unit': '°C', 'max_change_per_min': 2},
    'air_temperature': {'min': 0, 'max': 50, 'unit': '°C', 'max_change_per_min': 3},
    'air_humidity': {'min': 0, 'max': 100, 'unit': '%', 'max_change_per_min': 10},
    'rainfall': {'min': 0, 'max': 200, 'unit': 'mm', 'max_change_per_min': 50},
    'soil_ph': {'min': 3, 'max': 10, 'unit': 'pH', 'max_change_per_min': 0.5},
    'light_intensity': {'min': 0, 'max': 200000, 'unit': 'lux', 'max_change_per_min': None},
}
```

---

## 11. Công Nghệ Khuyến Nghị

### 11.1 Stack Tổng Thể

| Layer | Công nghệ | Lý do |
|-------|----------|-------|
| **Edge Runtime** | Python 3.11 + systemd | Raspberry Pi OS mặc định có Python. systemd auto-restart |
| **Edge DB** | SQLite 3 (WAL mode) | Nhẹ, zero-config, ổn định, đủ cho 7 ngày buffer |
| **Edge Web UI** | Flask hoặc FastAPI + HTMX | Nhẹ, server-rendered, không cần JS framework |
| **MQTT Broker** | EMQX (open-source) hoặc Mosquitto | EMQX scale tốt hơn, ACL management tốt. Mosquitto nếu budget tight |
| **Cloud API** | FastAPI (Python) hoặc Go | FastAPI nhanh develop, Go nếu cần performance |
| **Database** | PostgreSQL 15+ + TimescaleDB | 1 engine cho cả relational + time-series |
| **Cache** | Redis | Real-time sensor values, session, rate limiting |
| **Object Storage** | MinIO (self-hosted) hoặc S3 | Ảnh, exports, firmware |
| **Auth** | Custom JWT + phone OTP | Đơn giản, không cần OAuth complexity |
| **Message Queue** | Redis Streams hoặc NATS | Giữa ingestion service và processing workers |
| **Monitoring** | Prometheus + Grafana | Metrics, alerts cho hệ thống cloud |

### 11.2 Edge Agent Structure (Python)

```
smartfarm-edge/
├── agent/
│   ├── __init__.py
│   ├── main.py              # Entry point, scheduler
│   ├── config.py             # Đọc cấu hình
│   ├── sensors/
│   │   ├── lora_reader.py    # Đọc LoRa packets
│   │   ├── gpio_reader.py    # Đọc GPIO trực tiếp
│   │   └── validator.py      # Validate readings
│   ├── storage/
│   │   ├── local_db.py       # SQLite operations
│   │   └── buffer.py         # Buffer management
│   ├── sync/
│   │   ├── mqtt_client.py    # MQTT publisher
│   │   ├── rest_client.py    # REST fallback
│   │   └── batch_uploader.py # Batch logic
│   ├── alerts/
│   │   ├── engine.py         # Local alert evaluation
│   │   └── sms_sender.py     # SMS qua SIM
│   └── web/
│       ├── app.py            # Flask/FastAPI web UI
│       ├── templates/        # HTML templates
│       └── static/           # CSS, JS
├── config.yaml               # Cấu hình (farm_id, thresholds, sync interval)
├── requirements.txt
├── smartfarm-agent.service   # systemd unit file
└── install.sh                # Script cài đặt
```

### 11.3 Deployment Architecture

```
┌─────────────────────────────────────────────────────┐
│  RPi (per farm)                                     │
│                                                     │
│  systemd services:                                  │
│  ├── smartfarm-agent.service    (main edge agent)   │
│  ├── smartfarm-web.service      (local web UI)      │
│  └── mosquitto.service          (local MQTT broker)  │
│                                                     │
│  Optional: local Mosquitto làm message bus giữa     │
│  LoRa gateway process và edge agent                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Cloud (single server hoặc k8s)                     │
│                                                     │
│  Docker Compose (đơn giản) hoặc Kubernetes (scale): │
│  ├── emqx (MQTT broker)                             │
│  ├── smartfarm-api (FastAPI)                        │
│  ├── smartfarm-ingest (MQTT → DB worker)            │
│  ├── smartfarm-alerts (alert engine)                │
│  ├── postgresql + timescaledb                       │
│  ├── redis                                          │
│  ├── minio                                          │
│  └── nginx (reverse proxy + TLS)                    │
└─────────────────────────────────────────────────────┘
```

### 11.4 Chi Phí Infrastructure (Ước tính)

| Component | Option 1: VPS đơn | Option 2: Cloud managed |
|-----------|-------------------|----------------------|
| Server | 1× VPS 4GB RAM, 2 vCPU (~$20/tháng) | AWS/GCP ~$50-100/tháng |
| Database | PostgreSQL trên cùng VPS | RDS ~$30-50/tháng |
| MQTT Broker | EMQX trên cùng VPS | AWS IoT Core ~$1-5/tháng per device |
| Storage | 50GB SSD (~$5/tháng) | S3 ~$5/tháng |
| **Tổng** | **~$25-30/tháng** | **~$100-200/tháng** |

**Khuyến nghị:** Bắt đầu với VPS đơn (Option 1). Scale khi có >500 farms.

---

## Tóm Tắt Quyết Định Thiết Kế

| Quyết định | Lựa chọn | Lý do |
|-----------|----------|-------|
| Giao thức primary | MQTT | Lightweight, QoS, persistent session |
| Giao thức fallback | REST | Đơn giản, debug dễ |
| Local storage | SQLite (WAL) | Nhẹ, ổn định, zero-config |
| Cloud DB | PostgreSQL + TimescaleDB | 1 engine, SQL quen thuộc, time-series optimization |
| Data model | Farm→Field→Sensor→Reading | Phù hợp domain cà phê, hỗ trợ multi-field |
| Sync strategy | Batch upload, at-least-once | Ổn với kết nối chập chờn, idempotent dedup |
| Retention raw data | 90 ngày | Cân bằng storage cost vs. analytical value |
| Aggregation | Continuous aggregates (hourly, daily) | Auto-rollup, query nhanh cho dashboard |
| Auth device | JWT (90-day token) | Đơn giản, không cần cert management |
| Edge compute | Validate + alert + aggregate ở RPi | Giảm bandwidth, alert nhanh không cần cloud |

---

*Tài liệu kỹ thuật cho đội phát triển. Cần review và điều chỉnh theo yêu cầu cụ thể khi triển khai.*
