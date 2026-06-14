# SmartFarm IoT — Local → Cloud Sync Architecture

**Version:** 1.0  
**Date:** 2026-06-14  
**Status:** Architecture Design  
**Context:** Coffee farm monitoring in DakLak, Vietnam — Raspberry Pi edge appliances → Cloud aggregation platform

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Architecture Overview](#2-architecture-overview)
3. [Sync Protocol](#3-sync-protocol)
4. [API Design](#4-api-design)
5. [Data Model](#5-data-model)
6. [Edge Agent](#6-edge-agent)
7. [Security](#7-security)
8. [Bandwidth Optimization](#8-bandwidth-optimization)
9. [Cloud Platform Components](#9-cloud-platform-components)
10. [Failure Modes & Recovery](#10-failure-modes--recovery)
11. [Deployment & Operations](#11-deployment--operations)
12. [Appendices](#12-appendices)

---

## 1. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Offline-first** | Local RPi is the system of record. Cloud sync is best-effort. Farm operations must never depend on internet. |
| P2 | **Push-only** | Edge pushes to cloud. Cloud never pulls from edge (avoids NAT traversal, firewall issues, respects edge autonomy). |
| P3 | **Eventually consistent** | Cloud data may lag minutes to hours. This is acceptable for agricultural analytics. |
| P4 | **Idempotent writes** | Retrying the same batch twice must not create duplicates. |
| P5 | **Graceful degradation** | If bandwidth drops, reduce sync frequency. If connectivity drops, queue locally. |
| P6 | **Zero-config provisioning** | New RPi boots, connects, auto-registers. No manual cloud setup needed. |
| P7 | **Minimal edge footprint** | Sync agent adds <50MB RAM, <5% CPU to RPi workload. |

---

## 2. Architecture Overview

### 2.1 High-Level Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CLOUD PLATFORM (AWS/GCP/Azure)                   │
│                                                                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │   API        │    │   MQTT       │    │   Device     │              │
│  │   Gateway    │    │   Broker     │    │   Registry   │              │
│  │  (Kong/NGINX)│    │ (EMQX/      │    │              │              │
│  │              │    │  HiveMQ)     │    │              │              │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │
│         │                   │                   │                       │
│         └───────────┬───────┘───────────────────┘                       │
│                     ▼                                                   │
│         ┌───────────────────────┐                                       │
│         │   Ingestion Service   │ ← Validates, enriches, routes        │
│         │   (Go/Rust workers)   │                                       │
│         └───────────┬───────────┘                                       │
│                     ▼                                                   │
│         ┌───────────────────────┐    ┌──────────────┐                   │
│         │   TimescaleDB /       │    │  PostgreSQL  │                   │
│         │   ClickHouse          │    │  (metadata)  │                   │
│         │   (timeseries)        │    │              │                   │
│         └───────────────────────┘    └──────────────┘                   │
│                     ▼                                                   │
│         ┌───────────────────────┐    ┌──────────────┐                   │
│         │   Analytics Engine    │    │  Cloud       │                   │
│         │   (alerts, ML, dash)  │    │  Grafana     │                   │
│         └───────────────────────┘    └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────┘

          ▲  ▲  ▲
          │  │  │  ← TLS-secured MQTT or HTTPS (push-only)
          │  │  │
    ┌─────┘  │  └─────┐
    │        │        │

┌───┴───┐ ┌──┴──┐ ┌──┴───┐
│ RPi   │ │ RPi │ │ RPi  │     ← Each customer's edge appliance
│ Farm  │ │Farm │ │Farm  │
│ #001  │ │#002 │ │#003  │
└───────┘ └─────┘ └──────┘
```

### 2.2 Communication Strategy: Push-only, Store-and-Forward

| Aspect | Decision | Why |
|--------|----------|-----|
| **Direction** | Edge → Cloud only | Cloud never initiates connections to edge (NAT, firewall, security) |
| **Pattern** | Store-and-forward with local queue | Edge stores data locally, forwards when connected |
| **Transport** | MQTT (primary), HTTPS (fallback) | MQTT handles reconnect natively; HTTPS for bulk/backfill |
| **Streaming vs Batch** | Micro-batch (every 60s) | Balances latency vs bandwidth; no persistent connection overhead |

### 2.3 Connection Model

```
Edge Agent                    Cloud
    │                           │
    │──── MQTT CONNECT ────────►│  (TLS 1.3, client cert)
    │◄─── CONNACK ─────────────│
    │                           │
    │──── PUBLISH telemetry ───►│  (every 60s, batched)
    │──── PUBLISH telemetry ───►│
    │                           │
    │◄─── PUBLISH commands ─────│  (config updates, OTA)
    │──── PUBACK ──────────────►│
    │                           │
    │──── PINGREQ/PINGRESP ────│  (keepalive 300s)
    │                           │
    │  [network drops]          │
    │  [queues locally]         │
    │  [reconnects]             │
    │──── PUBLISH (backlog) ───►│
```

---

## 3. Sync Protocol

### 3.1 What to Sync

#### 3.1.1 Telemetry Data (High Frequency)

| Category | Fields | Typical Interval |
|----------|--------|-----------------|
| **Soil Temperature** | value (°C), depth (cm) | 5–15 min |
| **Soil Moisture** | value (%), depth (cm) | 5–15 min |
| **Electrical Conductivity (EC)** | value (dS/m) | 15–30 min |
| **NPK** | nitrogen (mg/kg), phosphorus (mg/kg), potassium (mg/kg) | 30–60 min |
| **pH** | value | 30–60 min |
| **Salinity** | value (g/L) | 30–60 min |
| **Ambient** | temp (°C), humidity (%), light (lux) | 5–15 min |

#### 3.1.2 Metadata (Low Frequency, Change-triggered)

| Category | When |
|----------|------|
| **Device inventory** | On boot, on change (new sensor added/removed) |
| **Garden config** | On change (zone boundaries, crop type, sensor mapping) |
| **Firmware version** | On boot, on update |
| **Network status** | On change (IP, signal strength, carrier) |
| **Calibration data** | On change |

#### 3.1.3 Events (On Occurrence)

| Category | Examples |
|----------|----------|
| **Alerts** | Sensor threshold breach, sensor offline, low battery |
| **System events** | Boot, shutdown, watchdog reset, config change |
| **Control actions** | Irrigation triggered, pump activated (audit trail) |

### 3.2 Sync Frequency & Prioritization

```
Priority 1 (Immediate, within 5s):
  - Critical alerts (sensor failure, threshold breach)
  - Device registration (first boot)

Priority 2 (Normal, every 60s batch):
  - Telemetry readings
  - System health

Priority 3 (Background, hourly or when bandwidth allows):
  - Historical backfill after outage
  - Firmware metadata
  - Configuration sync
```

### 3.3 Message Format

All messages use **Protocol Buffers (protobuf)** for wire efficiency, with JSON as human-readable fallback for debugging.

#### Protobuf Schema — Telemetry Batch

```protobuf
syntax = "proto3";
package smartfarm.sync;

message TelemetryBatch {
  string device_id = 1;          // e.g., "sf-daklak-001"
  int64 batch_id = 2;            // monotonic, for dedup
  int64 generated_at = 3;        // edge timestamp (unix ms)
  repeated TelemetryPoint points = 4;
  CompressionType compression = 5;
  int32 point_count = 6;         // for quick validation
}

message TelemetryPoint {
  string sensor_id = 1;          // e.g., "soil-temp-zone1-a"
  SensorType type = 2;
  int64 timestamp = 3;           // reading timestamp (unix ms)
  double value = 4;
  string unit = 5;               // "°C", "%", "dS/m", etc.
  Quality quality = 6;           // GOOD, SUSPECT, BAD
  map<string, string> tags = 7;  // depth=20cm, zone=north
}

enum SensorType {
  SOIL_TEMP = 0;
  SOIL_MOISTURE = 1;
  EC = 2;
  NPK_N = 3;
  NPK_P = 4;
  NPK_K = 5;
  PH = 6;
  SALINITY = 7;
  AMBIENT_TEMP = 8;
  AMBIENT_HUMIDITY = 9;
  LIGHT = 10;
}

enum Quality {
  GOOD = 0;
  SUSPECT = 1;      // out of expected range
  BAD = 2;          // sensor error
  MISSING = 3;      // no reading
}

enum CompressionType {
  NONE = 0;
  ZSTD = 1;         // preferred
  GZIP = 2;         // fallback
}
```

#### Protobuf Schema — Device Registration

```protobuf
message DeviceRegistration {
  string device_id = 1;
  string hardware_model = 2;     // "rpi-4b", "rpi-5"
  string firmware_version = 3;
  string os_version = 4;
  int64 boot_time = 5;
  NetworkInfo network = 6;
  repeated SensorDescriptor sensors = 7;
  GardenConfig garden = 8;
  string provisioning_token = 9; // one-time token from factory
}

message SensorDescriptor {
  string sensor_id = 1;
  SensorType type = 2;
  string model = 3;              // "TDR-300", "EC-5"
  string protocol = 4;           // "lorawan", "rs485", "i2c"
  string lorawan_dev_eui = 5;
  string zone_id = 6;
  int32 depth_cm = 7;            // for soil sensors
}

message GardenConfig {
  string garden_name = 1;
  string crop_type = 2;          // "arabica", "robusta"
  double area_hectares = 3;
  double latitude = 4;
  double longitude = 5;
  repeated Zone zones = 6;
}

message Zone {
  string zone_id = 1;
  string zone_name = 2;
  double area_hectares = 3;
  string irrigation_method = 4;  // "drip", "sprinkler"
}
```

### 3.4 Compression Strategy

| Condition | Action |
|-----------|--------|
| Batch < 1 KB | No compression (overhead not worth it) |
| Batch 1–100 KB | ZSTD compression (typical 3–5x ratio on sensor data) |
| Batch > 100 KB | ZSTD + consider splitting into chunks |
| Very poor link (< 64 Kbps) | ZSTD max compression level, aggressive batching |

**Expected savings:** A typical 60s batch of 12 sensors × 4 readings = 48 points ≈ 2 KB raw → ~0.5 KB compressed with ZSTD.

### 3.5 Retry & Backoff

```
Attempt 1:  immediate
Attempt 2:  wait 5s
Attempt 3:  wait 15s
Attempt 4:  wait 60s
Attempt 5+: wait 120s (capped)

Max retries per batch: unlimited (keep retrying until successful)
Queue overflow: oldest non-critical data discarded first (critical alerts never dropped)
Queue capacity: 7 days of telemetry ≈ ~50 MB compressed
```

### 3.6 Acknowledgment & Deduplication

```
Edge                              Cloud
  │                                 │
  │── TelemetryBatch {id: 42} ────►│
  │                                 │  ← Cloud checks: have I seen batch_id 42?
  │◄── ACK {batch_id: 42} ────────│     If no: ingest, store ACK
  │                                 │     If yes: skip, still ACK
  │── TelemetryBatch {id: 42} ────►│  ← (retry, network was slow)
  │◄── ACK {batch_id: 42} ────────│  ← Cloud already has it, ACK again
  │                                 │
  │── TelemetryBatch {id: 43} ────►│  ← Next batch
```

**Dedup key:** `(device_id, batch_id)` — globally unique per edge device, monotonically increasing.

---

## 4. API Design

### 4.1 Transport Layer Decision Matrix

| Channel | Use Case | Protocol | Why |
|---------|----------|----------|-----|
| **Primary** | Telemetry sync | MQTT over TLS | Built-in reconnect, QoS, low overhead |
| **Primary** | Device registration | MQTT (request/response) | Same connection, no new channel needed |
| **Fallback** | Bulk backfill | HTTPS POST | Better for large payloads, resumable uploads |
| **Control** | Cloud → Edge commands | MQTT (subscribed topic) | Edge subscribes to command channel |
| **Admin** | Cloud API for dashboards | REST + GraphQL | Standard web API |

### 4.2 MQTT Topic Design

```
# Edge → Cloud (publish)
smartfarm/{device_id}/telemetry          # sensor readings
smartfarm/{device_id}/events             # alerts, system events
smartfarm/{device_id}/registration       # device registration
smartfarm/{device_id}/health             # heartbeat, system health
smartfarm/{device_id}/config/ack         # config change acknowledgment

# Cloud → Edge (subscribe)
smartfarm/{device_id}/commands           # remote commands
smartfarm/{device_id}/config             # configuration pushes
smartfarm/{device_id}/ota                # firmware updates
smartfarm/{device_id}/response           # request/response correlation

# Wildcard subscriptions (cloud-side)
smartfarm/+/telemetry                    # all telemetry
smartfarm/+/events                       # all events
smartfarm/+/registration                 # all registrations
```

### 4.3 MQTT QoS Levels

| Message Type | QoS | Rationale |
|-------------|-----|-----------|
| Telemetry | 1 (at least once) | Dedup on cloud handles duplicates; QoS 2 too expensive |
| Events/Alerts | 1 | Must arrive, dedup handles repeats |
| Registration | 1 | Critical but infrequent |
| Commands (Cloud→Edge) | 1 | Must arrive, edge acknowledges via separate message |
| Health/Heartbeat | 0 (at most once) | Best-effort, next heartbeat replaces |

### 4.4 REST API (Cloud-side, for Admin/Dashboard)

```yaml
# Device Management
GET    /api/v1/devices                    # List all devices (paginated)
GET    /api/v1/devices/{device_id}        # Device detail
PATCH  /api/v1/devices/{device_id}        # Update device metadata
DELETE /api/v1/devices/{device_id}        # Decommission device

# Garden & Zone Management
GET    /api/v1/gardens                    # List gardens
GET    /api/v1/gardens/{garden_id}        # Garden detail
GET    /api/v1/gardens/{garden_id}/zones  # Zones in garden
PATCH  /api/v1/gardens/{garden_id}/zones/{zone_id}  # Update zone

# Telemetry Query
GET    /api/v1/telemetry/{device_id}?from=&to=&sensor_id=&type=  # Query timeseries
GET    /api/v1/telemetry/{device_id}/latest  # Latest readings
GET    /api/v1/telemetry/{device_id}/stats?period=1d  # Aggregates

# Alerts
GET    /api/v1/alerts?device_id=&status=&severity=  # List alerts
PATCH  /api/v1/alerts/{alert_id}          # Acknowledge/resolve

# Firmware & Config
POST   /api/v1/devices/{device_id}/ota    # Trigger OTA update
POST   /api/v1/devices/{device_id}/config # Push config
GET    /api/v1/devices/{device_id}/config # Get current config

# Bulk Operations
POST   /api/v1/telemetry/export           # Export data (CSV/Parquet)
POST   /api/v1/devices/bulk-register      # Bulk device provisioning
```

### 4.5 HTTPS Fallback Endpoint

For when MQTT is unavailable (port blocked, broker down):

```
POST /api/v1/ingest/telemetry
Content-Type: application/x-protobuf
X-Device-ID: sf-daklak-001
X-Batch-ID: 42
X-Compression: zstd
Authorization: Bearer <device-jwt>

<protobuf body>
```

Response:
```json
{
  "status": "accepted",
  "batch_id": 42,
  "points_ingested": 48,
  "next_sync_recommended": "2026-06-14T03:00:00Z"
}
```

---

## 5. Data Model

### 5.1 Multi-Tenant Hierarchy

```
Organization (tenant)
 └── Garden (customer's farm)
      └── Zone (subdivision of garden)
           └── Sensor (physical device)
                └── Reading (timeseries data point)
```

### 5.2 Entity-Relationship Diagram

```
┌──────────────┐
│ Organization │
│──────────────│
│ id (PK)      │
│ name         │
│ plan         │  ← "basic", "pro", "enterprise"
│ created_at   │
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────┐       ┌──────────────────┐
│   Garden     │       │   Device         │
│──────────────│       │──────────────────│
│ id (PK)      │       │ id (PK)          │
│ org_id (FK)  │       │ garden_id (FK)   │
│ name         │       │ hardware_model   │
│ crop_type    │       │ firmware_version │
│ area_ha      │       │ serial_number    │
│ lat, lng     │       │ status           │ ← online/offline/decommissioned
│ address      │       │ last_seen_at     │
│ timezone     │       │ ip_address       │
│ created_at   │       │ provisioned_at   │
└──────┬───────┘       └────────┬─────────┘
       │ 1:N                    │ 1:N
       ▼                        ▼
┌──────────────┐       ┌──────────────────┐
│    Zone      │       │   Sensor         │
│──────────────│       │──────────────────│
│ id (PK)      │       │ id (PK)          │
│ garden_id(FK)│       │ device_id (FK)   │
│ name         │       │ zone_id (FK)     │
│ area_ha      │       │ sensor_type      │
│ crop_variety │       │ model            │
│ soil_type    │       │ protocol         │
│ irrigation   │       │ lorawan_eui      │
└──────────────┘       │ depth_cm         │
                       │ unit             │
                       │ calibration_date │
                       │ status           │
                       └────────┬─────────┘
                                │ 1:N
                                ▼
                       ┌──────────────────┐
                       │   Reading        │  ← Hypertable / TimescaleDB
                       │──────────────────│
                       │ time (PK)        │
                       │ sensor_id (FK/   │
                       │   partition key)  │
                       │ value            │
                       │ quality          │
                       └──────────────────┘
```

### 5.3 SQL Schema (PostgreSQL + TimescaleDB)

```sql
-- Metadata tables (standard PostgreSQL)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    plan VARCHAR(50) DEFAULT 'basic',
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gardens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    crop_type VARCHAR(100),          -- arabica, robusta
    area_hectares DECIMAL(10,2),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    address TEXT,
    timezone VARCHAR(50) DEFAULT 'Asia/Ho_Chi_Minh',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE devices (
    id VARCHAR(64) PRIMARY KEY,       -- "sf-daklak-001"
    garden_id UUID REFERENCES gardens(id) ON DELETE CASCADE,
    hardware_model VARCHAR(100),
    firmware_version VARCHAR(50),
    serial_number VARCHAR(100) UNIQUE,
    status VARCHAR(20) DEFAULT 'provisioning',  -- provisioning, online, offline, decommissioned
    last_seen_at TIMESTAMPTZ,
    ip_address INET,
    provisioned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    garden_id UUID REFERENCES gardens(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    area_hectares DECIMAL(10,2),
    crop_variety VARCHAR(100),
    soil_type VARCHAR(100),
    irrigation_method VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sensors (
    id VARCHAR(128) PRIMARY KEY,      -- "soil-temp-zone1-a"
    device_id VARCHAR(64) REFERENCES devices(id),
    zone_id UUID REFERENCES zones(id),
    sensor_type VARCHAR(50) NOT NULL, -- soil_temp, soil_moisture, ec, npk_n, etc.
    model VARCHAR(100),
    protocol VARCHAR(50),            -- lorawan, rs485, i2c
    lorawan_dev_eui VARCHAR(16),
    depth_cm INTEGER,
    unit VARCHAR(20),
    calibration_date DATE,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id VARCHAR(64) REFERENCES devices(id),
    sensor_id VARCHAR(128) REFERENCES sensors(id),
    alert_type VARCHAR(50) NOT NULL,  -- threshold, offline, sensor_error, battery_low
    severity VARCHAR(20) NOT NULL,    -- info, warning, critical
    message TEXT,
    value DOUBLE PRECISION,
    threshold DOUBLE PRECISION,
    status VARCHAR(20) DEFAULT 'open',  -- open, acknowledged, resolved
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE device_sync_state (
    device_id VARCHAR(64) PRIMARY KEY REFERENCES devices(id),
    last_batch_id BIGINT,
    last_sync_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ,
    pending_points INTEGER DEFAULT 0,
    sync_errors INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_gardens_org ON gardens(org_id);
CREATE INDEX idx_devices_garden ON devices(garden_id);
CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_sensors_device ON sensors(device_id);
CREATE INDEX idx_sensors_zone ON sensors(zone_id);
CREATE INDEX idx_alerts_device ON alerts(device_id, status);
CREATE INDEX idx_alerts_created ON alerts(created_at DESC);
```

### 5.4 TimescaleDB Hypertable

```sql
-- Timeseries table (TimescaleDB hypertable)
CREATE TABLE readings (
    time TIMESTAMPTZ NOT NULL,
    sensor_id VARCHAR(128) NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    quality VARCHAR(20) DEFAULT 'good'
);

-- Convert to hypertable, partition by time (7-day chunks)
SELECT create_hypertable('readings', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Composite index for common query pattern
CREATE INDEX idx_readings_sensor_time ON readings(sensor_id, time DESC);

-- Compression policy (compress chunks older than 7 days)
ALTER TABLE readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'sensor_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('readings', INTERVAL '7 days');

-- Continuous aggregates for fast dashboard queries
CREATE MATERIALIZED VIEW readings_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    sensor_id,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS sample_count
FROM readings
GROUP BY bucket, sensor_id;

CREATE MATERIALIZED VIEW readings_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    sensor_id,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS sample_count
FROM readings
GROUP BY bucket, sensor_id;

-- Retention policy (keep raw data for 2 years)
SELECT add_retention_policy('readings', INTERVAL '2 years');
SELECT add_retention_policy('readings_hourly', INTERVAL '5 years');
SELECT add_retention_policy('readings_daily', INTERVAL '10 years');
```

### 5.5 Data Retention Strategy

| Granularity | Retention | Use Case |
|-------------|-----------|----------|
| Raw readings | 2 years | Detailed analysis, debugging |
| Hourly aggregates | 5 years | Seasonal analysis, trends |
| Daily aggregates | 10 years | Year-over-year comparison |

---

## 6. Edge Agent

### 6.1 Overview

The **SmartFarm Sync Agent** is a lightweight service running on each Raspberry Pi. It is the ONLY component that communicates with the cloud. All other local services (ChirpStack, Node-RED, InfluxDB, Grafana) remain purely local.

```
┌─────────────────────────────────────────────────────────────┐
│                    RASPBERRY PI (Edge)                       │
│                                                             │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌─────────────┐  │
│  │ChirpStack│  │ Mosquitto│  │ Node-RED│  │   Grafana   │  │
│  │(LoRaWAN) │  │  (MQTT)  │  │         │  │             │  │
│  └────┬─────┘  └────┬─────┘  └────┬────┘  └─────────────┘  │
│       │              │             │                         │
│       └──────────────┼─────────────┘                         │
│                      ▼                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                 LOCAL INFLUXDB                       │    │
│  │          (source of truth for all data)              │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │              SMARTFARM SYNC AGENT                    │    │
│  │                                                      │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │    │
│  │  │  Sync    │  │  Queue   │  │  Config &        │  │    │
│  │  │  Engine  │  │  Manager │  │  Device Registry │  │    │
│  │  └────┬─────┘  └────┬─────┘  └────────┬─────────┘  │    │
│  │       │              │                  │            │    │
│  │  ┌────▼──────────────▼──────────────────▼─────────┐ │    │
│  │  │           Transport Layer                       │ │    │
│  │  │     (MQTT client + HTTPS fallback)              │ │    │
│  │  └─────────────────────┬───────────────────────────┘ │    │
│  └────────────────────────┼────────────────────────────┘    │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │ TLS 1.3
                            ▼
                      ┌───────────┐
                      │   CLOUD   │
                      └───────────┘
```

### 6.2 Technology Choice

**Language: Go** (single binary, low memory ~30MB, cross-compile for ARM64)

Alternatives considered:
- Python: higher memory, dependency management on ARM
- Rust: excellent but slower development cycle
- Node.js: already on Pi but higher memory footprint

### 6.3 Core Components

#### 6.3.1 InfluxDB Reader

```go
// Reads from local InfluxDB on a schedule
// Uses Flux query language (InfluxDB 2.x) or InfluxQL (1.x)

type InfluxReader struct {
    client   influxdb.Client
    interval time.Duration
    lastRead time.Time
}

// Query: get all readings since last sync
func (r *InfluxReader) ReadSince(ctx context.Context, since time.Time) ([]Reading, error) {
    query := fmt.Sprintf(`
        from(bucket: "smartfarm")
            |> range(start: %s)
            |> filter(fn: (r) => r._measurement == "soil" or r._measurement == "ambient")
            |> sort(columns: ["_time"])
    `, since.Format(time.RFC3339))
    // ... execute and parse
}
```

#### 6.3.2 Queue Manager (Persistent, Write-Ahead Log)

```go
// SQLite-backed queue for offline resilience
// Survives power loss, agent restart, network outages

type QueueManager struct {
    db *sql.DB  // SQLite WAL mode
}

// Schema
const queueSchema = `
CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER UNIQUE,     -- monotonic, for dedup
    payload BLOB,                -- protobuf bytes (compressed)
    payload_size INTEGER,
    priority INTEGER DEFAULT 2,  -- 1=critical, 2=normal, 3=background
    status TEXT DEFAULT 'pending', -- pending, sent, acked, failed
    created_at INTEGER,          -- unix timestamp
    sent_at INTEGER,
    acked_at INTEGER,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_queue_status ON sync_queue(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_batch ON sync_queue(batch_id);
`

// Queue capacity management
const maxQueueSizeBytes = 50 * 1024 * 1024  // 50 MB
const maxQueueAgeDays = 7

// Eviction: drop oldest non-critical entries when full
// Critical alerts are NEVER dropped
```

#### 6.3.3 Sync Engine

```go
type SyncEngine struct {
    reader    *InfluxReader
    queue     *QueueManager
    transport *Transport
    config    *SyncConfig
}

type SyncConfig struct {
    SyncInterval      time.Duration  // default: 60s
    BatchSize         int            // default: 100 points per batch
    CompressionLevel  int            // ZSTD level (1-22, default: 3)
    MaxRetries        int            // -1 = infinite
    BackoffBase       time.Duration  // 5s
    BackoffMax        time.Duration  // 120s
}

// Main sync loop
func (e *SyncEngine) Run(ctx context.Context) {
    ticker := time.NewTicker(e.config.SyncInterval)
    defer ticker.Stop()

    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            e.syncCycle(ctx)
        }
    }
}

func (e *SyncEngine) syncCycle(ctx context.Context) {
    // 1. Check connectivity
    if !e.transport.IsConnected() {
        e.transport.Reconnect(ctx)
        if !e.transport.IsConnected() {
            return // will retry next cycle
        }
    }

    // 2. Flush any pending queue items first
    e.flushQueue(ctx)

    // 3. Read new data from InfluxDB
    readings, err := e.reader.ReadSince(ctx, e.lastSyncTime)
    if err != nil || len(readings) == 0 {
        return
    }

    // 4. Batch into protobuf messages
    batches := e.batchReadings(readings)

    // 5. Enqueue each batch
    for _, batch := range batches {
        e.queue.Enqueue(ctx, batch)
    }

    // 6. Flush queue (send what we can)
    e.flushQueue(ctx)
}

func (e *SyncEngine) flushQueue(ctx context.Context) {
    for {
        batch, err := e.queue.NextPending(ctx)
        if err != nil || batch == nil {
            break
        }

        err = e.transport.Send(ctx, batch)
        if err != nil {
            e.queue.MarkRetry(ctx, batch.ID, err.Error())
            break // stop flushing, will resume next cycle
        }

        e.queue.MarkSent(ctx, batch.ID)
    }
}
```

#### 6.3.4 Transport Layer

```go
type Transport struct {
    mqttClient mqtt.Client
    httpClient *http.Client
    config     *TransportConfig
    connected  bool
}

type TransportConfig struct {
    MQTTBroker     string        // "mqtts://cloud.smartfarm.vn:8883"
    HTTPFallback   string        // "https://api.smartfarm.vn"
    DeviceID       string
    ClientCert     tls.Certificate
    CACertPool     *x509.CertPool
    KeepAlive      time.Duration // 300s
    ConnectTimeout time.Duration // 30s
}

// Primary: MQTT
func (t *Transport) Send(ctx context.Context, batch *TelemetryBatch) error {
    data, err := proto.Marshal(batch)
    if err != nil {
        return err
    }

    // Compress
    compressed := zstdCompress(data, t.config.CompressionLevel)

    topic := fmt.Sprintf("smartfarm/%s/telemetry", t.config.DeviceID)

    // QoS 1, retain false
    token := t.mqttClient.Publish(topic, 1, false, compressed)
    token.WaitTimeout(10 * time.Second)

    if token.Error() != nil {
        // Fallback to HTTPS
        return t.sendHTTP(ctx, compressed, batch.BatchID)
    }

    return nil
}

// Fallback: HTTPS POST
func (t *Transport) sendHTTP(ctx context.Context, data []byte, batchID int64) error {
    req, _ := http.NewRequestWithContext(ctx, "POST",
        t.config.HTTPFallback+"/api/v1/ingest/telemetry", bytes.NewReader(data))
    req.Header.Set("Content-Type", "application/x-protobuf")
    req.Header.Set("X-Device-ID", t.config.DeviceID)
    req.Header.Set("X-Batch-ID", strconv.FormatInt(batchID, 10))
    req.Header.Set("X-Compression", "zstd")
    req.Header.Set("Authorization", "Bearer "+t.deviceJWT)

    resp, err := t.httpClient.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 && resp.StatusCode != 202 {
        return fmt.Errorf("HTTP %d", resp.StatusCode)
    }
    return nil
}
```

### 6.4 Resource Budget

| Resource | Target | Typical Usage |
|----------|--------|---------------|
| RAM | < 50 MB | ~30 MB (Go runtime + SQLite + MQTT client) |
| CPU | < 5% average | Peaks during batch compress (~15% for 100ms) |
| Disk (queue) | < 100 MB | 7 days of buffered telemetry |
| Disk (agent) | < 30 MB | Single binary + config + TLS certs |
| Network | < 10 KB/s average | Compressed telemetry batches |

### 6.5 Systemd Service

```ini
[Unit]
Description=SmartFarm Sync Agent
After=network-online.target mosquitto.service influxdb.service
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=smartfarm
Group=smartfarm
ExecStart=/usr/local/bin/smartfarm-sync --config /etc/smartfarm/sync-agent.yaml
Restart=always
RestartSec=10
Environment=SMARTFARM_DEVICE_ID=sf-daklak-001

# Resource limits
MemoryMax=100M
CPUQuota=10%

# Security hardening
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
ReadOnlyPaths=/etc/smartfarm
ReadWritePaths=/var/lib/smartfarm-sync

[Install]
WantedBy=multi-user.target
```

### 6.6 Configuration File

```yaml
# /etc/smartfarm/sync-agent.yaml

device:
  id: "sf-daklak-001"            # Set during provisioning
  garden_name: "Nguyen Coffee Farm"

influxdb:
  url: "http://localhost:8086"
  token: "${INFLUXDB_TOKEN}"     # Read from env
  org: "smartfarm"
  bucket: "smartfarm"

sync:
  interval: 60s                  # Normal sync frequency
  degraded_interval: 300s        # When bandwidth is poor
  batch_size: 100                # Points per batch
  max_queue_bytes: 52428800      # 50 MB
  max_queue_age_days: 7

transport:
  primary: mqtt
  fallback: https

  mqtt:
    broker: "mqtts://cloud.smartfarm.vn:8883"
    client_id: "sf-daklak-001"
    keepalive: 300
    connect_timeout: 30
    cert_file: "/etc/smartfarm/certs/client.crt"
    key_file: "/etc/smartfarm/certs/client.key"
    ca_file: "/etc/smartfarm/certs/ca.crt"

  https:
    endpoint: "https://api.smartfarm.vn"
    timeout: 30

compression:
  algorithm: zstd
  level: 3                       # 1 (fast) to 22 (max compression)
  min_size_bytes: 1024           # Don't compress below 1 KB

logging:
  level: info                    # debug, info, warn, error
  file: /var/log/smartfarm/sync-agent.log
  max_size_mb: 10
  max_backups: 3
```

---

## 7. Security

### 7.1 Threat Model

| Threat | Mitigation |
|--------|------------|
| Device impersonation | mTLS with unique client cert per device |
| Data interception | TLS 1.3 for all communications |
| Unauthorized access | API keys + JWT per device, rate limiting |
| Tampered firmware | Signed OTA updates (Ed25519) |
| Data at rest (edge) | Optional: LUKS encryption on SD card |
| Data at rest (cloud) | AES-256 encryption at rest (RDS/S3) |
| Replay attacks | Batch IDs + timestamps with drift detection |
| Cloud compromise | Per-device credentials, principle of least privilege |

### 7.2 Certificate Architecture

```
                    ┌─────────────────┐
                    │   Root CA       │  (offline, HSM)
                    │   SmartFarm CA  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Intermediate   │  (online, but heavily protected)
                    │  Issuing CA     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Device   │  │ Device   │  │ Cloud    │
        │ Cert #001│  │ Cert #002│  │ Server   │
        │          │  │          │  │ Cert     │
        └──────────┘  └──────────┘  └──────────┘
```

### 7.3 Device Provisioning Flow

```
Factory / First Boot:
┌─────────────┐
│  RPi boots  │
└──────┬──────┘
       ▼
┌─────────────────────────┐
│ Generate CSR (device)   │  ← Unique keypair generated on device
│ Send to provisioning API│     CSR includes device serial number
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ Cloud Provisioning API  │  ← Validates provisioning token
│ - Validates token       │     (one-time, from packaging)
│ - Issues client cert    │     Signs CSR with intermediate CA
│ - Assigns device_id     │     Returns signed cert + device_id
│ - Creates garden record │
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ Device stores:          │
│ - client.crt            │
│ - client.key            │
│ - ca.crt                │
│ - device_id             │
│ - sync config           │
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ First sync: registration│  ← Full device inventory + garden config
│ Device is now operational│
└─────────────────────────┘
```

### 7.4 mTLS Configuration

**MQTT Broker (Cloud-side EMQX):**

```hocon
# EMQX listener config
listeners.ssl.default {
  bind = "0.0.0.0:8883"
  max_connections = 10000
  ssl_options {
    cacertfile = "/etc/emqx/certs/ca.crt"
    certfile = "/etc/emqx/certs/server.crt"
    keyfile = "/etc/emqx/certs/server.key"
    verify = verify_peer
    fail_if_no_peer_cert = true
    tls_versions = ["tlsv1.3"]
    ciphers = ["TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256"]
  }
}

# Authentication: client cert CN must match device_id
# Authorization: device can only publish to its own topic
authorization {
  rules = [
    { permission = "allow", action = "publish", topic = "smartfarm/${clientid}/#" }
    { permission = "allow", action = "subscribe", topic = "smartfarm/${clientid}/commands" }
    { permission = "allow", action = "subscribe", topic = "smartfarm/${clientid}/config" }
    { permission = "allow", action = "subscribe", topic = "smartfarm/${clientid}/ota" }
    { permission = "deny", action = "all" }
  ]
}
```

### 7.5 JWT for HTTPS Fallback

```
# Device JWT (issued during provisioning, long-lived, rotated via MQTT command)
Header:  { "alg": "ES256", "typ": "JWT" }
Payload: {
  "sub": "sf-daklak-001",       // device_id
  "iss": "smartfarm-cloud",
  "iat": 1718352000,
  "exp": 1720944000,            // 30 days
  "scope": "telemetry:write events:write"
}
Signature: ES256(private_key, header.payload)
```

### 7.6 Certificate Rotation

```
# Automatic rotation via MQTT command
# Cloud sends rotation command 30 days before expiry
# Edge agent generates new CSR, sends via MQTT, receives new cert

Timeline:
  -90 days: Cert issued
  -30 days: Cloud sends rotation reminder
  -14 days: Cloud sends rotation command
  -7 days:  Cloud sends urgent rotation
  -0 days:  Cert expires, device goes offline
             (manual intervention needed)
```

---

## 8. Bandwidth Optimization

### 8.1 Bandwidth Budget

**Target: < 1 MB/day per device** (typical 4G data plan in Vietnam: 1–3 GB/month)

| Component | Frequency | Points | Raw Size | Compressed | Daily Total |
|-----------|-----------|--------|----------|------------|-------------|
| Telemetry | 60s | 12 sensors | ~2 KB/batch | ~0.5 KB | ~72 KB |
| Events | On-occurrence | ~10/day | ~0.5 KB | ~0.2 KB | ~2 KB |
| Health | 300s | 1 | ~0.1 KB | ~0.05 KB | ~3 KB |
| Registration | On-boot | 1 | ~1 KB | ~0.3 KB | ~0.3 KB |
| **Total** | | | | | **~77 KB/day** |

With generous margin: **< 500 KB/day** including retries, overhead, and occasional backfill.

### 8.2 Delta Sync (Change Detection)

```go
// Only sync readings that have changed since last successful sync
// InfluxDB query with explicit time range

func (r *InfluxReader) ReadDelta(ctx context.Context) ([]Reading, error) {
    lastSync := r.getLastSyncTime()

    query := fmt.Sprintf(`
        from(bucket: "smartfarm")
            |> range(start: %s, stop: now())
            |> filter(fn: (r) => r._measurement == "soil" or r._measurement == "ambient")
            |> sort(columns: ["_time"])
            |> limit(n: 1000)
    `, lastSync.Format(time.RFC3339))

    // Execute query...
}
```

### 8.3 Adaptive Batching

```go
// Adjust batch size and sync frequency based on link quality

type LinkQuality int

const (
    LinkExcellent LinkQuality = iota  // < 50ms RTT, > 1 Mbps
    LinkGood                          // < 200ms RTT, > 256 Kbps
    LinkPoor                          // < 1000ms RTT, > 64 Kbps
    LinkTerrible                      // > 1000ms RTT, or < 64 Kbps
    LinkOffline
)

func (e *SyncEngine) adaptToLinkQuality(quality LinkQuality) {
    switch quality {
    case LinkExcellent:
        e.config.SyncInterval = 60 * time.Second
        e.config.BatchSize = 50
        e.config.CompressionLevel = 1   // fast compression
    case LinkGood:
        e.config.SyncInterval = 60 * time.Second
        e.config.BatchSize = 100
        e.config.CompressionLevel = 3   // balanced
    case LinkPoor:
        e.config.SyncInterval = 300 * time.Second
        e.config.BatchSize = 200        // larger batches, less overhead
        e.config.CompressionLevel = 10  // better compression
    case LinkTerrible:
        e.config.SyncInterval = 600 * time.Second
        e.config.BatchSize = 500        // big batches
        e.config.CompressionLevel = 19  // max useful compression
    case LinkOffline:
        e.config.SyncInterval = 30 * time.Minute // check infrequently
        e.config.BatchSize = 1000
    }
}

// Measure link quality via MQTT ping latency + throughput test
func (t *Transport) measureLinkQuality(ctx context.Context) LinkQuality {
    // Probe with small MQTT ping
    start := time.Now()
    // ... ping
    rtt := time.Since(start)

    switch {
    case rtt < 50*time.Millisecond:
        return LinkExcellent
    case rtt < 200*time.Millisecond:
        return LinkGood
    case rtt < 1*time.Second:
        return LinkPoor
    default:
        return LinkTerrible
    }
}
```

### 8.4 Field-Level Compression (Beyond ZSTD)

For sensor data, use **delta encoding** before ZSTD:

```go
// Delta encoding: store differences between consecutive values
// Sensor values change slowly → deltas are small → compress better

func deltaEncode(values []float64) []int64 {
    deltas := make([]int64, len(values))
    if len(values) == 0 {
        return deltas
    }
    // Store first value as-is (scaled to int)
    deltas[0] = int64(values[0] * 100) // 2 decimal places
    for i := 1; i < len(values); i++ {
        deltas[i] = int64(values[i]*100) - int64(values[i-1]*100)
    }
    return deltas
}

// Typical compression: raw 48 points = 384 bytes
// Delta encoded = ~100 bytes (deltas are small integers)
// ZSTD on top = ~40 bytes
// Total ratio: ~10:1
```

### 8.5 Network-Aware Sync Schedule

```go
// Learn when internet is available (rural areas may have windows)
// and schedule heavy sync during good windows

type NetworkSchedule struct {
    // Historical availability heatmap (hour of day → availability %)
    availability [24]float64

    // Best hours for sync (learned over time)
    bestHours []int
}

// Example: In DakLak, 4G may be best 22:00-06:00 (low congestion)
// Agent learns this and shifts backfill to nighttime
```

---

## 9. Cloud Platform Components

### 9.1 Service Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLOUD PLATFORM                               │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  MQTT Broker  │  │  API Gateway │  │  Device Provisioning │  │
│  │  (EMQX)      │  │  (Kong)      │  │  Service             │  │
│  │              │  │              │  │                      │  │
│  │  - mTLS      │  │  - Rate limit│  │  - Token generation  │  │
│  │  - AuthZ     │  │  - Auth      │  │  - Cert issuance     │  │
│  │  - Topic ACL │  │  - Logging   │  │  - Device registration│  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                  │                     │              │
│         └─────────┬────────┘─────────────────────┘              │
│                   ▼                                              │
│  ┌────────────────────────────────────────────┐                 │
│  │          INGESTION SERVICE                  │                 │
│  │          (Go / Rust workers)                │                 │
│  │                                             │                 │
│  │  1. Validate protobuf schema                │                 │
│  │  2. Deduplicate (device_id, batch_id)       │                 │
│  │  3. Decompress (ZSTD)                       │                 │
│  │  4. Enrich (attach org_id, garden_id, etc.) │                 │
│  │  5. Route to TimescaleDB + alert engine     │                 │
│  └───────────────────┬─────────────────────────┘                 │
│                      │                                           │
│         ┌────────────┼────────────┐                              │
│         ▼            ▼            ▼                              │
│  ┌────────────┐ ┌──────────┐ ┌──────────┐                      │
│  │TimescaleDB │ │PostgreSQL│ │ Redis    │                       │
│  │(timeseries)│ │(metadata)│ │ (cache,  │                       │
│  │            │ │          │ │  dedup)  │                       │
│  └────────────┘ └──────────┘ └──────────┘                       │
│         │            │                                           │
│         ▼            ▼                                           │
│  ┌──────────────────────────┐  ┌──────────────┐                 │
│  │  Analytics & Alerting    │  │  Cloud       │                 │
│  │  - Threshold alerts      │  │  Grafana     │                 │
│  │  - Anomaly detection     │  │  (dashboards)│                 │
│  │  - Crop recommendations  │  │              │                 │
│  └──────────────────────────┘  └──────────────┘                 │
│                                                                  │
│  ┌──────────────────────────┐  ┌──────────────┐                 │
│  │  Web Dashboard (React)   │  │  Mobile API  │                 │
│  │  - Customer portal       │  │  (REST/gRPC) │                 │
│  │  - Admin portal          │  │              │                 │
│  └──────────────────────────┘  └──────────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 Ingestion Service (Detail)

```go
// The ingestion service is the central brain that processes all incoming data

type IngestionService struct {
    mqttSub     MQTTSubscriber
    httpServer  HTTPServer
    dedup       *DedupStore      // Redis-backed
    enricher    *DataEnricher    // Adds org_id, garden_id, zone_id
    writer      *TimescaleWriter
    alerter     *AlertEngine
    metrics     *MetricsCollector
}

func (s *IngestionService) ProcessBatch(ctx context.Context, raw []byte, deviceID string) error {
    // 1. Decompress
    data, err := zstdDecompress(raw)
    if err != nil {
        return err
    }

    // 2. Parse protobuf
    var batch TelemetryBatch
    if err := proto.Unmarshal(data, &batch); err != nil {
        return err
    }

    // 3. Deduplicate
    if s.dedup.Exists(ctx, deviceID, batch.BatchId) {
        s.metrics.Incr("batches.deduplicated")
        return nil // Already processed
    }

    // 4. Validate
    if err := s.validate(&batch); err != nil {
        s.metrics.Incr("batches.invalid")
        return err
    }

    // 5. Enrich with tenant context
    enriched, err := s.enricher.Enrich(ctx, deviceID, &batch)
    if err != nil {
        return err
    }

    // 6. Write to TimescaleDB
    if err := s.writer.WriteBatch(ctx, enriched); err != nil {
        return err
    }

    // 7. Check alert rules
    s.alerter.Evaluate(ctx, enriched)

    // 8. Mark as processed
    s.dedup.Set(ctx, deviceID, batch.BatchId, 24*time.Hour)

    // 9. Update sync state
    s.updateSyncState(ctx, deviceID, batch.BatchId)

    s.metrics.Incr("batches.processed")
    s.metrics.Add("points.processed", float64(len(batch.Points)))

    return nil
}
```

### 9.3 Scaling Considerations

| Scale | Devices | Points/Day | Infrastructure |
|-------|---------|------------|----------------|
| MVP | 10 | 1.2M | Single server (4 vCPU, 16 GB RAM) |
| Growth | 100 | 12M | 2–3 servers + managed DB |
| Scale | 1,000 | 120M | K8s cluster + TimescaleDB multi-node |
| Large | 10,000 | 1.2B | Sharded ingestion + ClickHouse |

---

## 10. Failure Modes & Recovery

### 10.1 Failure Matrix

| Failure | Local Impact | Cloud Impact | Recovery |
|---------|-------------|-------------|----------|
| **Internet down** | None — local works fully | No new data | Edge queues, syncs when back |
| **Cloud MQTT broker down** | None | No ingestion | HTTPS fallback; edge retries |
| **Cloud DB down** | None | No storage | Cloud queues in Redis; replay |
| **RPi SD card corruption** | Local data lost | None | Restore from last cloud sync |
| **RPi power loss** | Brief interruption | None | Agent auto-starts, catches up |
| **Sensor failure** | Alert locally | Alert in cloud | Auto-detect via quality flag |
| **Cloud cert expires** | HTTPS/MQTT rejected | Device offline | Auto-rotation before expiry |
| **Edge agent crash** | Brief sync pause | None | systemd restart, queue intact |

### 10.2 Edge Recovery Scenarios

```
Scenario: 7-day internet outage in DakLak

Day 1-7:  Edge continues normal operation
          Local InfluxDB accumulates all data
          Sync agent queues compressed batches in SQLite
          Queue size: ~77 KB × 7 = ~539 KB (well under 50 MB limit)

Day 8:    Internet restored
          Sync agent detects connectivity
          Begins flushing queue (prioritized: alerts first)
          Full backlog synced in ~5 minutes
          Cloud receives all historical data
          No data loss
```

```
Scenario: SD card corruption, data partially lost

Detection: Agent starts, finds InfluxDB inconsistent
Action:    Agent reports partial data loss to cloud
           Cloud marks device as "recovering"
           Agent re-syncs what it can from InfluxDB
           Cloud fills gaps from queue (if available)
           Dashboard shows "partial data" warning for affected period
```

### 10.3 Cloud-Side Idempotency

```sql
-- Dedup table in Redis
-- Key: dedup:{device_id}:{batch_id}
-- Value: 1
-- TTL: 24 hours

-- Also enforced at DB level as safety net:
ALTER TABLE readings ADD CONSTRAINT readings_dedup
    UNIQUE (time, sensor_id);  -- natural dedup key
```

---

## 11. Deployment & Operations

### 11.1 Edge Deployment (per RPi)

```bash
# Factory provisioning script
#!/bin/bash
set -e

DEVICE_SERIAL=$(cat /proc/cpuinfo | grep Serial | awk '{print $3}')
PROVISIONING_TOKEN="$1"  # From packaging label

# Install agent
sudo dpkg -i smartfarm-sync-agent_*.arm64.deb

# Generate device keypair
openssl ecparam -genkey -name prime256v1 -out /etc/smartfarm/certs/client.key
openssl req -new -key /etc/smartfarm/certs/client.key \
    -out /tmp/device.csr \
    -subj "/CN=${DEVICE_SERIAL}/O=SmartFarm"

# Provision with cloud
RESPONSE=$(curl -s -X POST https://provision.smartfarm.vn/api/v1/provision \
    -H "Authorization: Bearer ${PROVISIONING_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"csr\": \"$(base64 -w0 /tmp/device.csr)\", \"serial\": \"${DEVICE_SERIAL}\"}")

# Store credentials
echo "$RESPONSE" | jq -r '.client_cert' > /etc/smartfarm/certs/client.crt
echo "$RESPONSE" | jq -r '.ca_cert' > /etc/smartfarm/certs/ca.crt
echo "$RESPONSE" | jq -r '.device_id' > /etc/smartfarm/device_id
echo "$RESPONSE" | jq -r '.jwt' > /etc/smartfarm/device.jwt

# Write config
DEVICE_ID=$(echo "$RESPONSE" | jq -r '.device_id')
sed -i "s/sf-daklak-001/${DEVICE_ID}/" /etc/smartfarm/sync-agent.yaml

# Enable and start
sudo systemctl enable smartfarm-sync-agent
sudo systemctl start smartfarm-sync-agent

echo "Provisioned as ${DEVICE_ID}"
```

### 11.2 Monitoring

**Edge-side (local Grafana dashboard):**
- Sync agent health (uptime, queue size, last sync time)
- Network quality (RTT, bandwidth estimate)
- Queue depth over time
- Sync success/failure rate

**Cloud-side:**
- Device fleet status (online/offline/degraded)
- Ingestion throughput (points/sec, batches/sec)
- Dedup rate
- Alert volume
- Per-device sync lag

### 11.3 OTA Updates

```yaml
# Cloud pushes OTA command via MQTT
topic: smartfarm/{device_id}/ota
payload:
  version: "1.2.0"
  url: "https://releases.smartfarm.vn/smartfarm-sync-agent_1.2.0_arm64.deb"
  sha256: "abc123..."
  signature: "ed25519_signature"
  min_firmware: "1.0.0"  # minimum version required
  release_notes: "Bug fixes and compression improvements"
  rollout_percent: 10    # gradual rollout
```

---

## 12. Appendices

### A. Technology Stack Summary

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Edge Agent | Go | Single binary, low memory, ARM64 native |
| Edge Queue | SQLite (WAL) | Embedded, crash-safe, no external deps |
| Wire Format | Protocol Buffers | Compact, schema-evolved, fast |
| Compression | ZSTD | Best ratio/speed for sensor data |
| Edge → Cloud Transport | MQTT 3.1.1/5.0 | Built-in reconnect, QoS, pub/sub |
| Fallback Transport | HTTPS/1.1 | Works through any firewall |
| Cloud MQTT Broker | EMQX | High connection count, good auth/authz |
| Cloud API Gateway | Kong | Rate limiting, auth, logging |
| Cloud Ingestion | Go workers | Matches edge agent, shared proto defs |
| Timeseries DB | TimescaleDB | PostgreSQL-compatible, compression, continuous aggregates |
| Metadata DB | PostgreSQL | Standard, mature, well-understood |
| Cache/Dedup | Redis | Fast, TTL-native |
| Dashboards | Grafana | Already used locally, cloud deployment |
| Web Frontend | React + TypeScript | Customer/admin portal |
| Container Orchestration | Docker Compose (MVP) → K8s (scale) | Progressive complexity |

### B. Key Metrics to Track

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `device.online_count` | Currently connected devices | < 80% of fleet |
| `ingestion.points_per_sec` | Points being ingested | < 10 (normally > 100) |
| `ingestion.batch_dedup_rate` | % batches duplicated | > 20% (network issues) |
| `device.sync_lag_seconds` | Time since last successful sync | > 3600 (1 hour) |
| `queue.depth_bytes` | Edge queue size | > 40 MB (80% capacity) |
| `alert.open_count` | Unresolved alerts | > 100 |
| `mqtt.connection_errors` | MQTT connection failures | > 5/min |

### C. Cost Estimation (AWS, 100 devices)

| Component | Monthly Cost |
|-----------|-------------|
| EC2 (2× t3.medium) | ~$60 |
| RDS PostgreSQL (db.t3.medium) | ~$50 |
| TimescaleDB Cloud (4 GB RAM) | ~$150 |
| ElastiCache Redis (t3.micro) | ~$15 |
| EMQX Cloud (100 connections) | ~$50 |
| S3 (backups, firmware) | ~$5 |
| Data transfer | ~$10 |
| **Total** | **~$340/month** |

### D. Migration Path

```
Phase 1 (MVP):     Single server, Docker Compose, 10 devices
Phase 2 (Growth):  Managed databases, separate ingestion workers, 100 devices
Phase 3 (Scale):   K8s, TimescaleDB multi-node, ClickHouse for analytics, 1000+ devices
```

---

## Summary of Key Design Decisions

| Decision | Choice | Alternative Rejected | Why |
|----------|--------|---------------------|-----|
| Sync direction | Push-only | Push + Pull | NAT traversal issues, security, edge autonomy |
| Transport | MQTT + HTTPS fallback | WebSocket, gRPC | MQTT handles reconnect natively; HTTPS works everywhere |
| Wire format | Protobuf + ZSTD | JSON, MessagePack | 10x smaller than JSON, schema evolution |
| Edge queue | SQLite WAL | In-memory, files | Crash-safe, no external deps, queryable |
| Dedup | Batch ID + Redis | Timestamp-based | Deterministic, no clock skew issues |
| Timeseries DB | TimescaleDB | InfluxDB, ClickHouse | PostgreSQL-compatible, good compression, continuous aggregates |
| Certificate auth | mTLS per device | Shared API key | Per-device revocation, no shared secrets |
| Offline strategy | 7-day local queue | Discard when offline | Agricultural data is valuable, bandwidth is cheap when available |

---

*This architecture ensures that every coffee farm in DakLak operates independently with zero cloud dependency, while seamlessly aggregating data to the cloud whenever connectivity allows. The edge-first design with persistent queuing means no data is ever lost — even during Vietnam's monsoon season when internet can be down for days.*
