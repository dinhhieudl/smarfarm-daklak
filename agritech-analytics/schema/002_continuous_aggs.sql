-- ============================================================
-- TimescaleDB Continuous Aggregations
-- These automatically roll up raw data into hourly/daily/weekly summaries
-- ============================================================

-- ============================================================
-- 1. HOURLY AGGREGATION
-- ============================================================
CREATE MATERIALIZED VIEW readings_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', sr.time) AS bucket,
    sr.farm_id,
    sr.zone_id,
    s.sensor_type,
    COUNT(*)                       AS sample_count,
    AVG(sr.reading_value)          AS avg_value,
    MIN(sr.reading_value)          AS min_value,
    MAX(sr.reading_value)          AS max_value,
    STDDEV(sr.reading_value)       AS stddev_value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sr.reading_value) AS median_value,
    -- Quality metrics
    COUNT(*) FILTER (WHERE sr.quality_flag = 0) AS good_samples,
    COUNT(*) FILTER (WHERE sr.quality_flag = 1) AS suspect_samples,
    COUNT(*) FILTER (WHERE sr.quality_flag = 2) AS bad_samples,
    -- Sensor health
    AVG(sr.battery_level)          AS avg_battery,
    AVG(sr.signal_strength)        AS avg_signal
FROM sensor_readings sr
JOIN sensors s ON s.sensor_id = sr.sensor_id
GROUP BY bucket, sr.farm_id, sr.zone_id, s.sensor_type
WITH NO DATA;

-- Auto-refresh policy: run every hour, covering last 3 hours (catch-up window)
SELECT add_continuous_aggregate_policy('readings_hourly',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

-- Index for fast lookups
CREATE INDEX idx_hourly_farm_bucket ON readings_hourly(farm_id, bucket DESC);
CREATE INDEX idx_hourly_zone_type_bucket ON readings_hourly(zone_id, sensor_type, bucket DESC);


-- ============================================================
-- 2. DAILY AGGREGATION
-- ============================================================
CREATE MATERIALIZED VIEW readings_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', sr.time) AS bucket,
    sr.farm_id,
    sr.zone_id,
    s.sensor_type,
    COUNT(*)                       AS sample_count,
    AVG(sr.reading_value)          AS avg_value,
    MIN(sr.reading_value)          AS min_value,
    MAX(sr.reading_value)          AS max_value,
    STDDEV(sr.reading_value)       AS stddev_value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sr.reading_value) AS median_value,
    PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY sr.reading_value) AS p10_value,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY sr.reading_value) AS p90_value,
    -- Daily range
    MAX(sr.reading_value) - MIN(sr.reading_value) AS daily_range,
    -- Trend: compare first half vs second half of day
    AVG(sr.reading_value) FILTER (WHERE EXTRACT(HOUR FROM sr.time) < 12) AS avg_am,
    AVG(sr.reading_value) FILTER (WHERE EXTRACT(HOUR FROM sr.time) >= 12) AS avg_pm
FROM sensor_readings sr
JOIN sensors s ON s.sensor_id = sr.sensor_id
GROUP BY bucket, sr.farm_id, sr.zone_id, s.sensor_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('readings_daily',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists   => TRUE
);

CREATE INDEX idx_daily_farm_bucket ON readings_daily(farm_id, bucket DESC);
CREATE INDEX idx_daily_zone_type_bucket ON readings_daily(zone_id, sensor_type, bucket DESC);


-- ============================================================
-- 3. WEEKLY AGGREGATION
-- ============================================================
CREATE MATERIALIZED VIEW readings_weekly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 week', sr.time) AS bucket,
    sr.farm_id,
    sr.zone_id,
    s.sensor_type,
    COUNT(*)                       AS sample_count,
    AVG(sr.reading_value)          AS avg_value,
    MIN(sr.reading_value)          AS min_value,
    MAX(sr.reading_value)          AS max_value,
    STDDEV(sr.reading_value)       AS stddev_value,
    -- Week-over-week change (use LAG in queries against this view)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sr.reading_value) AS median_value
FROM sensor_readings sr
JOIN sensors s ON s.sensor_id = sr.sensor_id
GROUP BY bucket, sr.farm_id, sr.zone_id, s.sensor_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('readings_weekly',
    start_offset    => INTERVAL '2 weeks',
    end_offset      => INTERVAL '1 week',
    schedule_interval => INTERVAL '1 week',
    if_not_exists   => TRUE
);


-- ============================================================
-- 4. CROSS-FARM REGIONAL DAILY (for benchmarking)
-- ============================================================
CREATE MATERIALIZED VIEW regional_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', sr.time) AS bucket,
    f.region_id,
    s.sensor_type,
    COUNT(DISTINCT sr.farm_id)     AS farm_count,
    COUNT(*)                       AS sample_count,
    AVG(sr.reading_value)          AS region_avg,
    MIN(sr.reading_value)          AS region_min,
    MAX(sr.reading_value)          AS region_max,
    STDDEV(sr.reading_value)       AS region_stddev,
    PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY sr.reading_value) AS region_p25,
    PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY sr.reading_value) AS region_median,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY sr.reading_value) AS region_p75
FROM sensor_readings sr
JOIN sensors s ON s.sensor_id = sr.sensor_id
JOIN zones z ON z.zone_id = sr.zone_id
JOIN farms f ON f.farm_id = z.farm_id
GROUP BY bucket, f.region_id, s.sensor_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('regional_daily',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists   => TRUE
);

CREATE INDEX idx_regional_daily_region ON regional_daily(region_id, sensor_type, bucket DESC);
