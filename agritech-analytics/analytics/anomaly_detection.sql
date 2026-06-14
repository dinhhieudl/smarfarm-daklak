-- ============================================================
-- Anomaly Detection Queries
-- Multiple strategies: threshold, z-score, IQR, rate-of-change
-- ============================================================

-- ============================================================
-- 1. THRESHOLD-BASED ALERTS (simple, fast, per-zone)
-- ============================================================
-- Immediate alerts when readings cross hard boundaries

WITH thresholds AS (
    -- Define acceptable ranges per sensor type
    -- In production, these come from the alert_rules table
    SELECT * FROM (VALUES
        ('soil_moisture',    15.0, 80.0),   -- % volumetric
        ('soil_temperature', 10.0, 38.0),   -- °C
        ('ph',               4.5,  7.0),    -- pH units
        ('ec',               0.1,  4.0),    -- mS/cm
        ('nitrogen',         20.0, 200.0),  -- mg/kg
        ('phosphorus',       5.0,  100.0),  -- mg/kg
        ('potassium',        30.0, 300.0),  -- mg/kg
        ('salinity',         0.0,  2.0)     -- g/L
    ) AS t(sensor_type, min_val, max_val)
),
recent_readings AS (
    SELECT
        sr.farm_id,
        sr.zone_id,
        s.sensor_type,
        sr.reading_value,
        sr.time,
        ROW_NUMBER() OVER (
            PARTITION BY sr.zone_id, s.sensor_type
            ORDER BY sr.time DESC
        ) AS rn
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    WHERE sr.time >= NOW() - INTERVAL '15 minutes'  -- last 3 readings
)
SELECT
    rr.farm_id,
    f.name AS farm_name,
    rr.zone_id,
    z.name AS zone_name,
    rr.sensor_type,
    rr.reading_value AS current_value,
    t.min_val AS threshold_min,
    t.max_val AS threshold_max,
    rr.time AS reading_time,
    CASE
        WHEN rr.reading_value < t.min_val THEN 'BELOW_MIN'
        WHEN rr.reading_value > t.max_val THEN 'ABOVE_MAX'
    END AS violation_type,
    CASE
        WHEN rr.reading_value < t.min_val THEN t.min_val - rr.reading_value
        ELSE rr.reading_value - t.max_val
    END AS deviation,
    CASE
        WHEN rr.sensor_type = 'soil_moisture' AND rr.reading_value < 10 THEN 'CRITICAL'
        WHEN rr.sensor_type = 'ph' AND (rr.reading_value < 4.0 OR rr.reading_value > 8.0) THEN 'CRITICAL'
        ELSE 'WARNING'
    END AS severity
FROM recent_readings rr
JOIN thresholds t ON t.sensor_type = rr.sensor_type
JOIN zones z ON z.zone_id = rr.zone_id
JOIN farms f ON f.farm_id = rr.farm_id
WHERE rr.rn <= 3  -- check last 3 readings
    AND (rr.reading_value < t.min_val OR rr.reading_value > t.max_val)
ORDER BY severity, deviation DESC;


-- ============================================================
-- 2. STATISTICAL ANOMALY DETECTION (Z-Score)
-- ============================================================
-- Detects readings that deviate significantly from the farm's own baseline
-- Good for catching sensor drift, unusual weather effects, equipment failure

WITH farm_baseline AS (
    -- 30-day rolling baseline per farm-zone-sensor
    SELECT
        sr.farm_id,
        sr.zone_id,
        s.sensor_type,
        AVG(sr.reading_value) AS baseline_mean,
        STDDEV(sr.reading_value) AS baseline_stddev,
        COUNT(*) AS sample_count
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    WHERE sr.time >= NOW() - INTERVAL '30 days'
        AND sr.time < NOW() - INTERVAL '1 hour'  -- exclude last hour from baseline
    GROUP BY sr.farm_id, sr.zone_id, s.sensor_type
    HAVING COUNT(*) >= 100  -- need sufficient samples
),
recent_anomalies AS (
    SELECT
        sr.farm_id,
        sr.zone_id,
        s.sensor_type,
        sr.reading_value,
        sr.time,
        fb.baseline_mean,
        fb.baseline_stddev,
        CASE
            WHEN fb.baseline_stddev > 0.001  -- avoid div by near-zero
            THEN (sr.reading_value - fb.baseline_mean) / fb.baseline_stddev
            ELSE 0
        END AS z_score
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    JOIN farm_baseline fb ON fb.farm_id = sr.farm_id
        AND fb.zone_id = sr.zone_id
        AND fb.sensor_type = s.sensor_type
    WHERE sr.time >= NOW() - INTERVAL '1 hour'
)
SELECT
    ra.farm_id,
    f.name AS farm_name,
    ra.zone_id,
    z.name AS zone_name,
    ra.sensor_type,
    ROUND(ra.reading_value::numeric, 2) AS current_value,
    ROUND(ra.baseline_mean::numeric, 2) AS baseline_mean,
    ROUND(ra.z_score::numeric, 2) AS z_score,
    CASE
        WHEN ABS(ra.z_score) > 4 THEN 'CRITICAL'
        WHEN ABS(ra.z_score) > 3 THEN 'WARNING'
        WHEN ABS(ra.z_score) > 2.5 THEN 'INFO'
    END AS severity,
    ra.time AS anomaly_time
FROM recent_anomalies ra
JOIN farms f ON f.farm_id = ra.farm_id
JOIN zones z ON z.zone_id = ra.zone_id
WHERE ABS(ra.z_score) > 2.5
ORDER BY ABS(ra.z_score) DESC;


-- ============================================================
-- 3. RATE-OF-CHANGE ANOMALY DETECTION
-- ============================================================
-- Catches sudden drops/spikes that might indicate sensor failure,
-- irrigation events, or unusual weather (e.g., flash flood)

WITH reading_changes AS (
    SELECT
        sr.farm_id,
        sr.zone_id,
        s.sensor_type,
        sr.reading_value,
        sr.time,
        LAG(sr.reading_value) OVER w AS prev_value,
        LAG(sr.time) OVER w AS prev_time,
        sr.reading_value - LAG(sr.reading_value) OVER w AS value_change,
        EXTRACT(EPOCH FROM (sr.time - LAG(sr.time) OVER w)) / 60 AS minutes_elapsed
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    WHERE sr.time >= NOW() - INTERVAL '2 hours'
    WINDOW w AS (PARTITION BY sr.sensor_id ORDER BY sr.time)
),
rate_of_change AS (
    SELECT
        *,
        CASE
            WHEN minutes_elapsed > 0 AND minutes_elapsed < 30
            THEN value_change / (minutes_elapsed / 5)  -- normalize to per-5-min rate
            ELSE NULL
        END AS rate_per_5min
    FROM reading_changes
    WHERE prev_value IS NOT NULL
        AND minutes_elapsed > 0
)
SELECT
    farm_id,
    zone_id,
    sensor_type,
    ROUND(reading_value::numeric, 2) AS current_value,
    ROUND(prev_value::numeric, 2) AS previous_value,
    ROUND(value_change::numeric, 2) AS absolute_change,
    ROUND(rate_per_5min::numeric, 4) AS rate_per_interval,
    time AS reading_time,
    CASE
        WHEN sensor_type = 'soil_moisture' AND ABS(rate_per_5min) > 10 THEN 'CRITICAL'
        WHEN sensor_type = 'soil_temperature' AND ABS(rate_per_5min) > 5 THEN 'WARNING'
        WHEN ABS(rate_per_5min) > 3 * (
            SELECT STDDEV(reading_value) FROM sensor_readings
            WHERE sensor_id = sr.sensor_id
                AND time >= NOW() - INTERVAL '7 days'
        ) THEN 'WARNING'
        ELSE 'INFO'
    END AS severity
FROM rate_of_change sr
WHERE rate_per_5min IS NOT NULL
    AND ABS(rate_per_5min) > 5  -- significant change threshold
ORDER BY ABS(rate_per_5min) DESC;


-- ============================================================
-- 4. CROSS-FARM REGIONAL ANOMALY (DROUGHT / FLOOD WARNING)
-- ============================================================
-- If multiple farms in a region show similar anomalies simultaneously,
-- it's likely a regional event (drought, flood, heat wave)

WITH regional_baselines AS (
    SELECT
        f.region_id,
        s.sensor_type,
        AVG(sr.reading_value) AS region_mean,
        STDDEV(sr.reading_value) AS region_stddev
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    JOIN zones z ON z.zone_id = sr.zone_id
    JOIN farms f ON f.farm_id = z.farm_id
    WHERE sr.time >= NOW() - INTERVAL '30 days'
        AND sr.time < NOW() - INTERVAL '24 hours'
    GROUP BY f.region_id, s.sensor_type
),
current_regional AS (
    SELECT
        f.region_id,
        r.name AS region_name,
        s.sensor_type,
        COUNT(DISTINCT f.farm_id) AS farms_reporting,
        AVG(sr.reading_value) AS current_avg,
        -- Count farms with abnormal readings
        COUNT(DISTINCT f.farm_id) FILTER (
            WHERE ABS(
                (sr.reading_value - rb.region_mean) / NULLIF(rb.region_stddev, 0)
            ) > 2
        ) AS anomalous_farms,
        -- Percentage of farms with low moisture
        COUNT(DISTINCT f.farm_id) FILTER (
            WHERE s.sensor_type = 'soil_moisture' AND sr.reading_value < 20
        ) AS dry_farms,
        COUNT(DISTINCT f.farm_id) FILTER (
            WHERE s.sensor_type = 'soil_moisture'
        ) AS moisture_farms
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    JOIN zones z ON z.zone_id = sr.zone_id
    JOIN farms f ON f.farm_id = z.farm_id
    JOIN regions r ON r.region_id = f.region_id
    JOIN regional_baselines rb ON rb.region_id = f.region_id
        AND rb.sensor_type = s.sensor_type
    WHERE sr.time >= NOW() - INTERVAL '24 hours'
    GROUP BY f.region_id, r.name, s.sensor_type
)
SELECT
    region_name,
    sensor_type,
    farms_reporting,
    ROUND(current_avg::numeric, 2) AS current_regional_avg,
    anomalous_farms,
    ROUND((anomalous_farms::numeric / NULLIF(farms_reporting, 0) * 100)::numeric, 1) AS pct_anomalous,
    CASE
        WHEN sensor_type = 'soil_moisture'
            AND dry_farms::numeric / NULLIF(moisture_farms, 0) > 0.6
        THEN 'REGIONAL_DROUGHT_WARNING'
        WHEN anomalous_farms::numeric / NULLIF(farms_reporting, 0) > 0.5
        THEN 'REGIONAL_ANOMALY'
        ELSE NULL
    END AS alert_type
FROM current_regional
WHERE anomalous_farms::numeric / NULLIF(farms_reporting, 0) > 0.3  -- >30% of farms affected
ORDER BY pct_anomalous DESC;
