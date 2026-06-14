-- ============================================================
-- Cross-Farm Analytics Queries
-- For DakLak coffee farm monitoring platform
-- ============================================================

-- ============================================================
-- 1. AVERAGE SOIL CONDITIONS BY REGION & CROP STAGE
-- ============================================================
-- Joins sensor data with crop stage calendar to analyze
-- how soil conditions vary across growing phases

WITH farm_stage AS (
    SELECT
        f.farm_id,
        f.name AS farm_name,
        r.name AS region_name,
        cs.stage_name,
        cs.start_date,
        cs.end_date
    FROM farms f
    JOIN regions r ON r.region_id = f.region_id
    JOIN crop_stages cs ON cs.farm_id = f.farm_id
    WHERE cs.year = EXTRACT(YEAR FROM NOW())
),
stage_readings AS (
    SELECT
        fs.region_name,
        fs.stage_name,
        s.sensor_type,
        sr.reading_value,
        sr.time
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    JOIN farm_stage fs ON fs.farm_id = sr.farm_id
        AND sr.time >= fs.start_date::timestamptz
        AND sr.time < (fs.end_date + INTERVAL '1 day')::timestamptz
    WHERE sr.time >= NOW() - INTERVAL '1 year'
)
SELECT
    region_name,
    stage_name,
    sensor_type,
    COUNT(*) AS readings,
    ROUND(AVG(reading_value)::numeric, 2) AS avg_value,
    ROUND(MIN(reading_value)::numeric, 2) AS min_value,
    ROUND(MAX(reading_value)::numeric, 2) AS max_value,
    ROUND(STDDEV(reading_value)::numeric, 3) AS stddev,
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY reading_value)::numeric, 2) AS median
FROM stage_readings
GROUP BY region_name, stage_name, sensor_type
ORDER BY region_name,
    CASE stage_name
        WHEN 'rest' THEN 1
        WHEN 'flowering' THEN 2
        WHEN 'fruiting' THEN 3
        WHEN 'development' THEN 4
        WHEN 'ripening' THEN 5
        WHEN 'harvest' THEN 6
    END,
    sensor_type;


-- ============================================================
-- 2. ANOMALY DETECTION — Which farms have abnormal readings?
-- ============================================================
-- Uses Z-score method: flag readings > 2σ from the regional mean

WITH current_readings AS (
    -- Get latest daily averages per zone
    SELECT
        sr.farm_id,
        sr.zone_id,
        s.sensor_type,
        AVG(sr.reading_value) AS current_avg
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    WHERE sr.time >= NOW() - INTERVAL '24 hours'
    GROUP BY sr.farm_id, sr.zone_id, s.sensor_type
),
regional_stats AS (
    -- Regional baseline from daily aggregates
    SELECT
        f.region_id,
        rd.sensor_type,
        AVG(rd.region_avg) AS regional_mean,
        STDDEV(rd.region_avg) AS regional_stddev
    FROM regional_daily rd
    JOIN farms f ON f.farm_id = rd.farm_id   -- Note: regional_daily has region_id directly
    WHERE rd.bucket >= NOW() - INTERVAL '30 days'
    GROUP BY f.region_id, rd.sensor_type
),
anomalies AS (
    SELECT
        cr.farm_id,
        cr.zone_id,
        cr.sensor_type,
        cr.current_avg,
        rs.regional_mean,
        rs.regional_stddev,
        CASE
            WHEN rs.regional_stddev > 0
            THEN (cr.current_avg - rs.regional_mean) / rs.regional_stddev
            ELSE 0
        END AS z_score
    FROM current_readings cr
    JOIN zones z ON z.zone_id = cr.zone_id
    JOIN farms f ON f.farm_id = z.farm_id
    JOIN regional_stats rs ON rs.region_id = f.region_id
        AND rs.sensor_type = cr.sensor_type
)
SELECT
    a.farm_id,
    f.name AS farm_name,
    r.name AS region_name,
    a.zone_id,
    z.name AS zone_name,
    a.sensor_type,
    ROUND(a.current_avg::numeric, 2) AS current_value,
    ROUND(a.regional_mean::numeric, 2) AS regional_avg,
    ROUND(a.z_score::numeric, 2) AS z_score,
    CASE
        WHEN ABS(a.z_score) > 3 THEN 'CRITICAL'
        WHEN ABS(a.z_score) > 2.5 THEN 'WARNING'
        WHEN ABS(a.z_score) > 2 THEN 'INFO'
    END AS severity,
    CASE
        WHEN a.z_score > 0 THEN 'ABOVE_NORMAL'
        ELSE 'BELOW_NORMAL'
    END AS direction
FROM anomalies a
JOIN farms f ON f.farm_id = a.farm_id
JOIN zones z ON z.zone_id = a.zone_id
JOIN regions r ON r.region_id = f.region_id
WHERE ABS(a.z_score) > 2
ORDER BY ABS(a.z_score) DESC;


-- ============================================================
-- 3. SEASONAL TRENDS ACROSS ALL FARMS
-- ============================================================
-- Monthly averages over the past 3 years, for trend analysis

WITH monthly AS (
    SELECT
        time_bucket('1 month', sr.time) AS month,
        f.region_id,
        r.name AS region_name,
        s.sensor_type,
        AVG(sr.reading_value) AS monthly_avg,
        COUNT(DISTINCT sr.farm_id) AS farms_reporting
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    JOIN zones z ON z.zone_id = sr.zone_id
    JOIN farms f ON f.farm_id = z.farm_id
    JOIN regions r ON r.region_id = f.region_id
    WHERE sr.time >= NOW() - INTERVAL '3 years'
    GROUP BY month, f.region_id, r.name, s.sensor_type
)
SELECT
    month,
    region_name,
    sensor_type,
    farms_reporting,
    ROUND(monthly_avg::numeric, 2) AS avg_value,
    -- Year-over-year change
    ROUND((monthly_avg - LAG(monthly_avg, 12) OVER (
        PARTITION BY region_name, sensor_type ORDER BY month
    ))::numeric, 2) AS yoy_change,
    -- Month-over-month change
    ROUND((monthly_avg - LAG(monthly_avg, 1) OVER (
        PARTITION BY region_name, sensor_type ORDER BY month
    ))::numeric, 2) AS mom_change,
    -- 3-month moving average
    ROUND(AVG(monthly_avg) OVER (
        PARTITION BY region_name, sensor_type
        ORDER BY month
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    )::numeric, 2) AS moving_avg_3m
FROM monthly
ORDER BY region_name, sensor_type, month;


-- ============================================================
-- 4. CORRELATION: Weather ↔ Soil Conditions ↔ Yield
-- ============================================================

-- 4a. Weather–Soil Correlation (Pearson r)
-- Correlates daily weather metrics with daily soil averages per region

WITH daily_weather AS (
    SELECT
        time_bucket('1 day', time) AS day,
        region_id,
        AVG(temperature_c) AS avg_temp,
        SUM(rainfall_mm) AS total_rain,
        AVG(humidity_pct) AS avg_humidity,
        AVG(solar_radiation) AS avg_solar
    FROM weather_readings
    WHERE time >= NOW() - INTERVAL '1 year'
    GROUP BY day, region_id
),
daily_soil AS (
    SELECT
        rd.bucket AS day,
        rd.region_id,
        rd.sensor_type,
        rd.region_avg
    FROM regional_daily rd
    WHERE rd.bucket >= NOW() - INTERVAL '1 year'
)
SELECT
    dw.region_id,
    r.name AS region_name,
    ds.sensor_type,
    -- Correlation: temperature ↔ soil metric
    ROUND(CORR(dw.avg_temp, ds.region_avg)::numeric, 4) AS corr_temperature,
    -- Correlation: rainfall ↔ soil metric
    ROUND(CORR(dw.total_rain, ds.region_avg)::numeric, 4) AS corr_rainfall,
    -- Correlation: humidity ↔ soil metric
    ROUND(CORR(dw.avg_humidity, ds.region_avg)::numeric, 4) AS corr_humidity,
    -- Correlation: solar radiation ↔ soil metric
    ROUND(CORR(dw.avg_solar, ds.region_avg)::numeric, 4) AS corr_solar,
    COUNT(*) AS data_points
FROM daily_weather dw
JOIN daily_soil ds ON ds.day = dw.day AND ds.region_id = dw.region_id
JOIN regions r ON r.region_id = dw.region_id
GROUP BY dw.region_id, r.name, ds.sensor_type
ORDER BY dw.region_id, ds.sensor_type;


-- 4b. Soil Conditions ↔ Yield Correlation
-- Averages soil conditions during key growth periods and correlates with yield

WITH season_avgs AS (
    SELECT
        f.farm_id,
        f.name AS farm_name,
        yr.year,
        yr.yield_kg_per_ha,
        cs.stage_name,
        s.sensor_type,
        AVG(sr.reading_value) AS stage_avg
    FROM yield_records yr
    JOIN farms f ON f.farm_id = yr.farm_id
    JOIN crop_stages cs ON cs.farm_id = yr.farm_id AND cs.year = yr.year
    JOIN sensor_readings sr ON sr.farm_id = f.farm_id
        AND sr.time >= cs.start_date::timestamptz
        AND sr.time < (cs.end_date + INTERVAL '1 day')::timestamptz
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    WHERE yr.year >= EXTRACT(YEAR FROM NOW()) - 3
    GROUP BY f.farm_id, f.name, yr.year, yr.yield_kg_per_ha, cs.stage_name, s.sensor_type
)
SELECT
    stage_name,
    sensor_type,
    ROUND(CORR(stage_avg, yield_kg_per_ha)::numeric, 4) AS yield_correlation,
    COUNT(DISTINCT farm_id) AS farms,
    COUNT(DISTINCT year) AS years
FROM season_avgs
GROUP BY stage_name, sensor_type
HAVING COUNT(*) >= 10
ORDER BY ABS(CORR(stage_avg, yield_kg_per_ha)) DESC;


-- ============================================================
-- 5. BENCHMARKING: Compare a Farm Against Regional Averages
-- ============================================================
-- Parameter: :target_farm_id (UUID of the farm to benchmark)

WITH target_farm AS (
    SELECT farm_id, region_id, name FROM farms WHERE farm_id = :target_farm_id
),
farm_daily AS (
    SELECT
        time_bucket('1 day', sr.time) AS day,
        s.sensor_type,
        AVG(sr.reading_value) AS farm_avg
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    WHERE sr.farm_id = :target_farm_id
        AND sr.time >= NOW() - INTERVAL '30 days'
    GROUP BY day, s.sensor_type
),
region_daily AS (
    SELECT
        rd.bucket AS day,
        rd.sensor_type,
        rd.region_avg,
        rd.region_stddev,
        rd.region_p25,
        rd.region_median,
        rd.region_p75
    FROM regional_daily rd
    JOIN target_farm tf ON tf.region_id = rd.region_id
    WHERE rd.bucket >= NOW() - INTERVAL '30 days'
)
SELECT
    fd.sensor_type,
    ROUND(AVG(fd.farm_avg)::numeric, 2) AS farm_30d_avg,
    ROUND(AVG(rd.region_avg)::numeric, 2) AS region_30d_avg,
    ROUND(AVG(rd.region_median)::numeric, 2) AS region_30d_median,
    ROUND(AVG(rd.region_p25)::numeric, 2) AS region_25th_pct,
    ROUND(AVG(rd.region_p75)::numeric, 2) AS region_75th_pct,
    -- Percentile rank of this farm within region
    ROUND(
        (COUNT(*) FILTER (WHERE fd.farm_avg < rd.region_avg)::numeric
        / NULLIF(COUNT(*), 0) * 100)::numeric, 1
    ) AS percentile_rank,
    -- How many stddevs from regional mean
    ROUND(AVG(
        CASE WHEN rd.region_stddev > 0
            THEN (fd.farm_avg - rd.region_avg) / rd.region_stddev
            ELSE 0
        END
    )::numeric, 2) AS avg_z_score,
    CASE
        WHEN AVG(fd.farm_avg) > AVG(rd.region_p75) THEN 'ABOVE_75TH'
        WHEN AVG(fd.farm_avg) > AVG(rd.region_median) THEN 'ABOVE_MEDIAN'
        WHEN AVG(fd.farm_avg) > AVG(rd.region_p25) THEN 'BELOW_MEDIAN'
        ELSE 'BELOW_25TH'
    END AS performance_band
FROM farm_daily fd
JOIN region_daily rd ON rd.day = fd.day AND rd.sensor_type = fd.sensor_type
GROUP BY fd.sensor_type
ORDER BY fd.sensor_type;


-- ============================================================
-- 6. FLEET HEALTH DASHBOARD — Quick farm overview
-- ============================================================

SELECT
    f.farm_id,
    f.name AS farm_name,
    r.name AS region_name,
    f.area_hectares,
    f.coffee_variety,
    COUNT(DISTINCT z.zone_id) AS zone_count,
    COUNT(DISTINCT s.sensor_id) AS sensor_count,
    -- Data freshness
    MAX(l.last_reading_at) AS latest_reading,
    EXTRACT(EPOCH FROM (NOW() - MAX(l.last_reading_at))) / 3600 AS hours_since_last,
    -- Sensor health
    COUNT(*) FILTER (WHERE l.battery_level < 20) AS low_battery_sensors,
    COUNT(*) FILTER (WHERE l.quality_flag > 0) AS suspect_readings
FROM farms f
JOIN regions r ON r.region_id = f.region_id
JOIN zones z ON z.farm_id = f.farm_id
JOIN sensors s ON s.zone_id = z.zone_id
LEFT JOIN latest_readings l ON l.sensor_id = s.sensor_id
WHERE f.is_active = TRUE
GROUP BY f.farm_id, f.name, r.name, f.area_hectares, f.coffee_variety
ORDER BY hours_since_last DESC NULLS LAST;
