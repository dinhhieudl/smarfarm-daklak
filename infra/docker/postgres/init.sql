-- ============================================================
-- TimescaleDB Initialization Script
-- Run on first database startup
-- ============================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================
-- Application Users (least privilege)
-- ============================================================

-- Read-write user for ingestion worker
CREATE USER agritech_app WITH PASSWORD 'CHANGE_ME_APP_PASSWORD';
GRANT CONNECT ON DATABASE agritech TO agritech_app;
GRANT USAGE ON SCHEMA public TO agritech_app;
GRANT CREATE ON SCHEMA public TO agritech_app;

-- Read-only user for API server
CREATE USER agritech_readonly WITH PASSWORD 'CHANGE_ME_READONLY_PASSWORD';
GRANT CONNECT ON DATABASE agritech TO agritech_readonly;
GRANT USAGE ON SCHEMA public TO agritech_readonly;

-- ============================================================
-- Schema: Core Tables
-- ============================================================

-- Farms
CREATE TABLE IF NOT EXISTS farms (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    owner_name      VARCHAR(255),
    province        VARCHAR(100) NOT NULL DEFAULT 'DakLak',
    district        VARCHAR(100),
    latitude        DECIMAL(10, 8),
    longitude       DECIMAL(11, 8),
    elevation_m     DECIMAL(8, 2),
    area_hectares   DECIMAL(10, 2),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Zones within farms
CREATE TABLE IF NOT EXISTS zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    zone_type       VARCHAR(50) DEFAULT 'coffee',  -- coffee, nursery, buffer
    area_hectares   DECIMAL(10, 2),
    coffee_variety  VARCHAR(100),
    planting_year   INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(farm_id, name)
);

CREATE INDEX idx_zones_farm_id ON zones(farm_id);

-- Edge devices (Raspberry Pi)
CREATE TABLE IF NOT EXISTS devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number   VARCHAR(100) UNIQUE NOT NULL,
    zone_id         UUID REFERENCES zones(id) ON DELETE SET NULL,
    farm_id         UUID REFERENCES farms(id) ON DELETE SET NULL,
    firmware_version VARCHAR(50),
    hardware_model  VARCHAR(50) DEFAULT 'Raspberry Pi 4B',
    status          VARCHAR(20) DEFAULT 'active',  -- active, inactive, maintenance
    last_seen_at    TIMESTAMPTZ,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_devices_farm_id ON devices(farm_id);
CREATE INDEX idx_devices_zone_id ON devices(zone_id);
CREATE INDEX idx_devices_serial ON devices(serial_number);

-- Device authentication tokens
CREATE TABLE IF NOT EXISTS device_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    token_hash      VARCHAR(64) NOT NULL,  -- SHA-256 hash
    description     VARCHAR(255),
    expires_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_device_tokens_device_id ON device_tokens(device_id);
CREATE INDEX idx_device_tokens_hash ON device_tokens(token_hash);

-- ============================================================
-- Hypertable: Sensor Readings (Time-series)
-- ============================================================

CREATE TABLE IF NOT EXISTS sensor_readings (
    time            TIMESTAMPTZ NOT NULL,
    device_id       UUID NOT NULL,
    zone_id         UUID NOT NULL,
    farm_id         UUID NOT NULL,
    -- Sensor values
    soil_temp       DECIMAL(5, 2),       -- °C
    soil_moisture   DECIMAL(5, 2),       -- % volumetric water content
    soil_ec         DECIMAL(8, 2),       -- electrical conductivity (µS/cm)
    soil_ph         DECIMAL(4, 2),       -- pH
    soil_salinity   DECIMAL(8, 2),       -- dS/m
    nitrogen        DECIMAL(8, 2),       -- mg/kg
    phosphorus      DECIMAL(8, 2),       -- mg/kg
    potassium       DECIMAL(8, 2),       -- mg/kg
    air_temp        DECIMAL(5, 2),       -- °C
    air_humidity    DECIMAL(5, 2),       -- %
    light_intensity DECIMAL(10, 2),      -- lux
    battery_voltage DECIMAL(4, 2),       -- V
    signal_strength INTEGER,             -- dBm
    -- Metadata
    reading_quality VARCHAR(20) DEFAULT 'good',  -- good, suspect, bad
    raw_payload     JSONB
);

-- Convert to hypertable (partition by time, 1-day chunks)
SELECT create_hypertable('sensor_readings', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Enable compression for older chunks (after 7 days)
ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, zone_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('sensor_readings', INTERVAL '7 days', if_not_exists => TRUE);

-- Retention policy: drop raw data after 2 years
SELECT add_retention_policy('sensor_readings', INTERVAL '730 days', if_not_exists => TRUE);

-- ============================================================
-- Continuous Aggregates (Materialized Views)
-- ============================================================

-- Hourly aggregates
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    device_id,
    zone_id,
    farm_id,
    AVG(soil_temp)       AS avg_soil_temp,
    MIN(soil_temp)       AS min_soil_temp,
    MAX(soil_temp)       AS max_soil_temp,
    AVG(soil_moisture)   AS avg_soil_moisture,
    MIN(soil_moisture)   AS min_soil_moisture,
    MAX(soil_moisture)   AS max_soil_moisture,
    AVG(soil_ec)         AS avg_soil_ec,
    AVG(soil_ph)         AS avg_soil_ph,
    AVG(soil_salinity)   AS avg_soil_salinity,
    AVG(nitrogen)        AS avg_nitrogen,
    AVG(phosphorus)      AS avg_phosphorus,
    AVG(potassium)       AS avg_potassium,
    AVG(air_temp)        AS avg_air_temp,
    AVG(air_humidity)    AS avg_air_humidity,
    COUNT(*)             AS reading_count
FROM sensor_readings
GROUP BY bucket, device_id, zone_id, farm_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sensor_hourly',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

-- Daily aggregates
CREATE MATERIALIZED VIEW sensor_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    device_id,
    zone_id,
    farm_id,
    AVG(soil_temp)       AS avg_soil_temp,
    MIN(soil_temp)       AS min_soil_temp,
    MAX(soil_temp)       AS max_soil_temp,
    AVG(soil_moisture)   AS avg_soil_moisture,
    AVG(soil_ec)         AS avg_soil_ec,
    AVG(soil_ph)         AS avg_soil_ph,
    AVG(soil_salinity)   AS avg_soil_salinity,
    AVG(nitrogen)        AS avg_nitrogen,
    AVG(phosphorus)      AS avg_phosphorus,
    AVG(potassium)       AS avg_potassium,
    AVG(air_temp)        AS avg_air_temp,
    AVG(air_humidity)    AS avg_air_humidity,
    COUNT(*)             AS reading_count
FROM sensor_readings
GROUP BY bucket, device_id, zone_id, farm_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sensor_daily',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists   => TRUE
);

-- ============================================================
-- Sync Status Tracking
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_log (
    id              BIGSERIAL,
    device_id       UUID NOT NULL,
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    records_count   INTEGER NOT NULL,
    payload_size_bytes INTEGER,
    sync_method     VARCHAR(20) NOT NULL,  -- mqtt, https
    status          VARCHAR(20) NOT NULL,  -- success, partial, failed
    error_message   TEXT,
    duration_ms     INTEGER,
    PRIMARY KEY (id, synced_at)
);

SELECT create_hypertable('sync_log', 'synced_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

SELECT add_retention_policy('sync_log', INTERVAL '180 days', if_not_exists => TRUE);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_sensor_readings_device_time ON sensor_readings (device_id, time DESC);
CREATE INDEX idx_sensor_readings_farm_time ON sensor_readings (farm_id, time DESC);
CREATE INDEX idx_sensor_readings_zone_time ON sensor_readings (zone_id, time DESC);
CREATE INDEX idx_sync_log_device ON sync_log (device_id, synced_at DESC);

-- ============================================================
-- Grants
-- ============================================================

-- App user permissions
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO agritech_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agritech_app;

-- Read-only user permissions
GRANT SELECT ON ALL TABLES IN SCHEMA public TO agritech_readonly;
