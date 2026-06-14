-- ============================================================
-- AgriTech Coffee Farm Analytics — TimescaleDB Schema
-- Target: TimescaleDB 2.x on PostgreSQL 15+
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- REFERENCE TABLES (regular tables, not hypertables)
-- ============================================================

-- Regions in DakLak
CREATE TABLE regions (
    region_id       SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,       -- e.g., "Buôn Ma Thuột", "Cư M'gar"
    district        VARCHAR(100),
    province        VARCHAR(100) DEFAULT 'Đắk Lắk',
    geom            GEOMETRY(Polygon, 4326),      -- boundary polygon
    avg_elevation_m NUMERIC(6,2),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Coffee farms
CREATE TABLE farms (
    farm_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id       INT REFERENCES regions(region_id),
    name            VARCHAR(200) NOT NULL,
    owner_name      VARCHAR(200),
    area_hectares   NUMERIC(8,2),
    latitude        NUMERIC(10,7),
    longitude       NUMERIC(10,7),
    elevation_m     NUMERIC(6,2),
    coffee_variety  VARCHAR(100),                 -- e.g., "Robusta", "Arabica", "Catimor"
    planting_year   INT,
    irrigation_type VARCHAR(50),                  -- "drip", "sprinkler", "rain-fed", "manual"
    is_active       BOOLEAN DEFAULT TRUE,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_farms_region ON farms(region_id);
CREATE INDEX idx_farms_location ON farms USING GIST(
    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
);

-- Zones within a farm
CREATE TABLE zones (
    zone_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id         UUID REFERENCES farms(farm_id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,        -- e.g., "Zone A - North Slope"
    area_hectares   NUMERIC(6,2),
    soil_type       VARCHAR(100),                 -- "basalt", "laterite", "alluvial"
    slope_degrees   NUMERIC(5,2),
    shade_cover_pct NUMERIC(5,2),                 -- percentage of shade tree coverage
    tree_age_years  INT,
    tree_density    INT,                          -- trees per hectare
    latitude        NUMERIC(10,7),
    longitude       NUMERIC(10,7),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_zones_farm ON zones(farm_id);

-- Sensors installed in zones
CREATE TABLE sensors (
    sensor_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id         UUID REFERENCES zones(zone_id) ON DELETE CASCADE,
    sensor_type     VARCHAR(50) NOT NULL,         -- "soil_temperature", "soil_moisture", "ec", "nitrogen", "phosphorus", "potassium", "ph", "salinity"
    unit            VARCHAR(20) NOT NULL,         -- "°C", "%", "mS/cm", "mg/kg", "pH", "g/L"
    manufacturer    VARCHAR(100),
    model           VARCHAR(100),
    install_depth_cm INT,                         -- soil depth of sensor
    calibration_date DATE,
    is_active       BOOLEAN DEFAULT TRUE,
    metadata        JSONB DEFAULT '{}',
    installed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sensors_zone ON sensors(zone_id);
CREATE INDEX idx_sensors_type ON sensors(sensor_type);

-- Crop stage calendar (per farm, per year)
-- Coffee crop stages in DakLak (Robusta-dominant):
--   Rest:       November - January
--   Flowering:  February - March
--   Fruiting:   March - May
--   Development: May - August
--   Ripening:   September - October
--   Harvest:    October - November
CREATE TABLE crop_stages (
    stage_id        SERIAL PRIMARY KEY,
    farm_id         UUID REFERENCES farms(farm_id),
    year            INT NOT NULL,
    stage_name      VARCHAR(50) NOT NULL,         -- "rest", "flowering", "fruiting", "development", "ripening", "harvest"
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(farm_id, year, stage_name)
);

CREATE INDEX idx_crop_stages_farm_year ON crop_stages(farm_id, year);

-- ============================================================
-- TIME-SERIES DATA (TimescaleDB Hypertables)
-- ============================================================

-- Raw sensor readings — partitioned by time (5-min intervals)
CREATE TABLE sensor_readings (
    time            TIMESTAMPTZ NOT NULL,
    sensor_id       UUID NOT NULL,
    farm_id         UUID NOT NULL,
    zone_id         UUID NOT NULL,
    reading_value   NUMERIC(12,4) NOT NULL,
    quality_flag    SMALLINT DEFAULT 0,           -- 0=good, 1=suspect, 2=bad, 3=estimated
    battery_level   NUMERIC(5,2),                 -- sensor battery %
    signal_strength NUMERIC(5,2),                 -- RSSI in dBm
    metadata        JSONB DEFAULT '{}'
);

-- Convert to hypertable, partitioned by time (7-day chunks)
SELECT create_hypertable(
    'sensor_readings',
    'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Composite index for common query patterns
CREATE INDEX idx_readings_sensor_time ON sensor_readings(sensor_id, time DESC);
CREATE INDEX idx_readings_farm_time ON sensor_readings(farm_id, time DESC);
CREATE INDEX idx_readings_zone_time ON sensor_readings(zone_id, time DESC);

-- Add compression policy for older chunks
ALTER TABLE sensor_readings SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'farm_id, zone_id, sensor_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Weather data (external source: Open-Meteo or local weather stations)
CREATE TABLE weather_readings (
    time            TIMESTAMPTZ NOT NULL,
    region_id       INT NOT NULL,
    station_id      VARCHAR(50),
    temperature_c   NUMERIC(5,2),                 -- air temperature
    humidity_pct    NUMERIC(5,2),                 -- relative humidity
    rainfall_mm     NUMERIC(8,2),                 -- precipitation
    wind_speed_kmh  NUMERIC(6,2),
    solar_radiation NUMERIC(8,2),                 -- W/m²
    et_reference    NUMERIC(6,2),                 -- reference evapotranspiration (mm)
    metadata        JSONB DEFAULT '{}'
);

SELECT create_hypertable(
    'weather_readings',
    'time',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

CREATE INDEX idx_weather_region_time ON weather_readings(region_id, time DESC);

-- Yield records (annual, per farm)
CREATE TABLE yield_records (
    record_id       SERIAL PRIMARY KEY,
    farm_id         UUID REFERENCES farms(farm_id),
    year            INT NOT NULL,
    yield_kg_per_ha NUMERIC(10,2),
    total_yield_kg  NUMERIC(12,2),
    harvest_start   DATE,
    harvest_end     DATE,
    quality_grade   VARCHAR(20),                  -- "grade1", "grade2", "specialty"
    cupping_score   NUMERIC(4,1),                 -- SCA score if available
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(farm_id, year)
);

-- Alert history
CREATE TABLE alerts (
    alert_id        BIGSERIAL PRIMARY KEY,
    time            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    farm_id         UUID,
    zone_id         UUID,
    rule_name       VARCHAR(100) NOT NULL,
    severity        VARCHAR(20) NOT NULL,         -- "info", "warning", "critical"
    metric          VARCHAR(50),
    current_value   NUMERIC(12,4),
    threshold       NUMERIC(12,4),
    message         TEXT NOT NULL,
    acknowledged    BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(100),
    acknowledged_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    notification_sent BOOLEAN DEFAULT FALSE,
    metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_alerts_farm ON alerts(farm_id, time DESC);
CREATE INDEX idx_alerts_unresolved ON alerts(resolved_at) WHERE resolved_at IS NULL;

-- Materialized view for dashboard: latest reading per sensor
CREATE MATERIALIZED VIEW latest_readings AS
SELECT DISTINCT ON (sr.sensor_id)
    sr.sensor_id,
    sr.farm_id,
    sr.zone_id,
    s.sensor_type,
    sr.reading_value,
    sr.time AS last_reading_at,
    sr.quality_flag,
    sr.battery_level
FROM sensor_readings sr
JOIN sensors s ON s.sensor_id = sr.sensor_id
ORDER BY sr.sensor_id, sr.time DESC;

CREATE UNIQUE INDEX idx_latest_readings_sensor ON latest_readings(sensor_id);

-- Refresh function (call via pg_cron or application)
CREATE OR REPLACE FUNCTION refresh_latest_readings()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY latest_readings;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE sensor_readings IS 'Raw sensor data, 5-min interval. Retained 90 days.';
COMMENT ON TABLE weather_readings IS 'Weather station data, hourly. Retained 90 days.';
COMMENT ON TABLE yield_records IS 'Annual coffee yield per farm.';
COMMENT ON TABLE alerts IS 'Alert history for all notification channels.';
