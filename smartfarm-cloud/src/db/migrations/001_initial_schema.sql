-- ============================================================================
-- SmartFarm Cloud - Database Schema (PostgreSQL + TimescaleDB)
-- ============================================================================
-- Run: psql -U smartfarm -d smartfarm_cloud -f 001_initial_schema.sql
-- Requires: CREATE EXTENSION IF NOT EXISTS timescaledb;
-- Requires: CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- ============================================================================
-- TENANTS (Farm Owners / Organizations)
-- ============================================================================
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    plan            VARCHAR(20) NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro', 'enterprise')),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_email ON tenants(email);

-- ============================================================================
-- GARDENS (Individual Farms)
-- ============================================================================
CREATE TABLE gardens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    area_hectares   DOUBLE PRECISION NOT NULL CHECK (area_hectares > 0),
    crop_type       VARCHAR(100) NOT NULL,   -- e.g. 'arabica_coffee', 'robusta_coffee'
    elevation_m     DOUBLE PRECISION,
    soil_type       VARCHAR(100),            -- e.g. 'volcanic_andisol', 'laterite'
    irrigation_type VARCHAR(50)              -- e.g. 'drip', 'sprinkler', 'rainfed'
                    CHECK (irrigation_type IN ('drip', 'sprinkler', 'flood', 'rainfed', 'manual', NULL)),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gardens_tenant ON gardens(tenant_id);
CREATE INDEX idx_gardens_location ON gardens USING GIST (
    ll_to_earth(latitude, longitude)
);

-- ============================================================================
-- ZONES (Sub-areas within a Garden)
-- ============================================================================
CREATE TABLE zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    garden_id       UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    zone_number     INTEGER NOT NULL,
    area_hectares   DOUBLE PRECISION,
    soil_type       VARCHAR(100),
    planting_date   DATE,
    notes           TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(garden_id, zone_number)
);

CREATE INDEX idx_zones_garden ON zones(garden_id);

-- ============================================================================
-- DEVICES (Raspberry Pi Gateways + Sensor Nodes)
-- ============================================================================
CREATE TABLE devices (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    garden_id       UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    zone_id         UUID REFERENCES zones(id) ON DELETE SET NULL,
    device_eui      VARCHAR(16) NOT NULL UNIQUE,  -- LoRaWAN Device EUI (hex)
    name            VARCHAR(255) NOT NULL,
    device_type     VARCHAR(30) NOT NULL
                    CHECK (device_type IN ('rpi_gateway', 'soil_sensor_node')),
    firmware_version VARCHAR(30),
    last_seen_at    TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'offline'
                    CHECK (status IN ('online', 'offline', 'maintenance')),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_garden ON devices(garden_id);
CREATE INDEX idx_devices_zone ON devices(zone_id);
CREATE INDEX idx_devices_eui ON devices(device_eui);
CREATE INDEX idx_devices_status ON devices(status);

-- ============================================================================
-- API KEYS (Per-farm authentication for edge agents)
-- ============================================================================
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    garden_id       UUID REFERENCES gardens(id) ON DELETE CASCADE,  -- null = all gardens
    key_hash        VARCHAR(255) NOT NULL,       -- bcrypt hash of full key
    key_prefix      VARCHAR(8) NOT NULL,         -- first 8 chars for lookup
    name            VARCHAR(255) NOT NULL,
    scopes          TEXT[] NOT NULL DEFAULT '{read}',
    expires_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix) WHERE is_active = true;
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- ============================================================================
-- SENSOR READINGS (TimescaleDB Hypertable - High-volume time-series)
-- ============================================================================
CREATE TABLE sensor_readings (
    time            TIMESTAMPTZ NOT NULL,
    device_id       UUID NOT NULL,
    garden_id       UUID NOT NULL,
    zone_id         UUID NOT NULL,
    sensor_type     VARCHAR(20) NOT NULL,
    value           DOUBLE PRECISION NOT NULL,
    unit            VARCHAR(20) NOT NULL,
    quality         VARCHAR(10) NOT NULL DEFAULT 'good'
                    CHECK (quality IN ('good', 'suspect', 'bad')),
    raw_value       DOUBLE PRECISION,
    battery_voltage DOUBLE PRECISION,
    rssi            DOUBLE PRECISION
);

-- Convert to TimescaleDB hypertable (partitioned by time)
SELECT create_hypertable('sensor_readings', 'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Composite indexes for common queries
CREATE INDEX idx_readings_garden_time ON sensor_readings(garden_id, time DESC);
CREATE INDEX idx_readings_zone_time ON sensor_readings(zone_id, time DESC);
CREATE INDEX idx_readings_device_time ON sensor_readings(device_id, time DESC);
CREATE INDEX idx_readings_type_time ON sensor_readings(sensor_type, time DESC);
CREATE INDEX idx_readings_garden_type_time ON sensor_readings(garden_id, sensor_type, time DESC);

-- Enable compression after 7 days (massive storage savings)
ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'garden_id, zone_id, sensor_type',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy('sensor_readings', INTERVAL '7 days', if_not_exists => TRUE);

-- Continuous aggregate: hourly rollups per zone per sensor type
CREATE MATERIALIZED VIEW sensor_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    garden_id,
    zone_id,
    sensor_type,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS reading_count,
    STDDEV(value) AS stddev_value
FROM sensor_readings
GROUP BY bucket, garden_id, zone_id, sensor_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sensor_hourly',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Continuous aggregate: daily rollups
CREATE MATERIALIZED VIEW sensor_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    garden_id,
    zone_id,
    sensor_type,
    AVG(value) AS avg_value,
    MIN(value) AS min_value,
    MAX(value) AS max_value,
    COUNT(*) AS reading_count
FROM sensor_readings
GROUP BY bucket, garden_id, zone_id, sensor_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sensor_daily',
    start_offset    => INTERVAL '30 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Retention policy: drop raw data older than 90 days (hourly/daily rollups kept)
SELECT add_retention_policy('sensor_readings', INTERVAL '90 days', if_not_exists => TRUE);

-- ============================================================================
-- ALERT THRESHOLDS
-- ============================================================================
CREATE TABLE alert_thresholds (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    garden_id       UUID REFERENCES gardens(id) ON DELETE CASCADE,
    zone_id         UUID REFERENCES zones(id) ON DELETE CASCADE,
    sensor_type     VARCHAR(20) NOT NULL,
    min_value       DOUBLE PRECISION,
    max_value       DOUBLE PRECISION,
    severity        VARCHAR(10) NOT NULL DEFAULT 'warning'
                    CHECK (severity IN ('info', 'warning', 'critical')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    cooldown_minutes INTEGER NOT NULL DEFAULT 30,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (min_value IS NOT NULL OR max_value IS NOT NULL)
);

CREATE INDEX idx_thresholds_tenant ON alert_thresholds(tenant_id);
CREATE INDEX idx_thresholds_garden ON alert_thresholds(garden_id);

-- ============================================================================
-- ALERTS (Triggered when thresholds are breached)
-- ============================================================================
CREATE TABLE alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    threshold_id    UUID REFERENCES alert_thresholds(id) ON DELETE SET NULL,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    garden_id       UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    zone_id         UUID NOT NULL,
    device_id       UUID NOT NULL,
    sensor_type     VARCHAR(20) NOT NULL,
    triggered_value DOUBLE PRECISION NOT NULL,
    threshold_min   DOUBLE PRECISION,
    threshold_max   DOUBLE PRECISION,
    severity        VARCHAR(10) NOT NULL
                    CHECK (severity IN ('info', 'warning', 'critical')),
    message         TEXT NOT NULL,
    acknowledged    BOOLEAN NOT NULL DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_alerts_tenant ON alerts(tenant_id, triggered_at DESC);
CREATE INDEX idx_alerts_unresolved ON alerts(tenant_id, acknowledged, resolved_at)
    WHERE resolved_at IS NULL;

-- ============================================================================
-- DEVICE STATUS LOG (track connectivity history)
-- ============================================================================
CREATE TABLE device_status_log (
    time            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id       UUID NOT NULL,
    status          VARCHAR(20) NOT NULL,
    battery_voltage DOUBLE PRECISION,
    rssi            DOUBLE PRECISION,
    firmware_version VARCHAR(30),
    metadata        JSONB DEFAULT '{}'
);

SELECT create_hypertable('device_status_log', 'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX idx_device_status_device ON device_status_log(device_id, time DESC);

-- Retain device logs for 30 days
SELECT add_retention_policy('device_status_log', INTERVAL '30 days', if_not_exists => TRUE);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_gardens_updated_at
    BEFORE UPDATE ON gardens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON devices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
