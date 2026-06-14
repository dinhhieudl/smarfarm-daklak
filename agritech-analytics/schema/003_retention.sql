-- ============================================================
-- Data Retention Policies
-- Raw data: 90 days → hourly avg: 1 year → daily avg: forever
-- ============================================================

-- 1. Raw data: drop chunks older than 90 days
SELECT add_retention_policy('sensor_readings',
    drop_after => INTERVAL '90 days',
    if_not_exists => TRUE
);

SELECT add_retention_policy('weather_readings',
    drop_after => INTERVAL '90 days',
    if_not_exists => TRUE
);

-- 2. Hourly aggregates: keep 1 year
SELECT add_retention_policy('readings_hourly',
    drop_after => INTERVAL '1 year',
    if_not_exists => TRUE
);

-- 3. Weekly aggregates: keep 2 years (useful for multi-year trend analysis)
SELECT add_retention_policy('readings_weekly',
    drop_after => INTERVAL '2 years',
    if_not_exists => TRUE
);

-- 4. Daily aggregates and regional_daily: NO retention policy (kept forever)
-- readings_daily and regional_daily are kept indefinitely.

-- 5. Compression: compress older chunks to save storage
-- Raw data: compress after 7 days
SELECT add_compression_policy('sensor_readings',
    compress_after => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Hourly: compress after 30 days
SELECT add_compression_policy('readings_hourly',
    compress_after => INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Daily: compress after 90 days
SELECT add_compression_policy('readings_daily',
    compress_after => INTERVAL '90 days',
    if_not_exists => TRUE
);

-- Weather: compress after 7 days
SELECT add_compression_policy('weather_readings',
    compress_after => INTERVAL '7 days',
    if_not_exists => TRUE
);


-- ============================================================
-- S3 archival policy (application-level, triggered by pg_cron)
-- Archive raw data to S3/MinIO before retention drops it
-- ============================================================

-- pg_cron job: archive raw data older than 80 days (runs weekly)
-- This is a placeholder; actual implementation is in Python (pipeline/archival.py)
-- SELECT cron.schedule('archive-raw-data', '0 2 * * 0',
--     $$SELECT archive_raw_to_s3(NOW() - INTERVAL '90 days', NOW() - INTERVAL '80 days')$$
-- );

-- Refresh latest_readings materialized view every 5 minutes
-- SELECT cron.schedule('refresh-latest', '*/5 * * * *',
--     $$SELECT refresh_latest_readings()$$
-- );
