-- ============================================================
-- Benchmarking Queries
-- Compare individual farms against peers
-- ============================================================

-- ============================================================
-- 1. FARM PERFORMANCE RANKING WITHIN REGION
-- ============================================================
-- Ranks farms by sensor metrics for the current crop stage

WITH current_stage AS (
    SELECT stage_name, start_date, end_date
    FROM crop_stages
    WHERE farm_id = :target_farm_id
        AND year = EXTRACT(YEAR FROM NOW())
        AND NOW()::date BETWEEN start_date AND end_date
    LIMIT 1
),
farm_stage_avgs AS (
    SELECT
        f.farm_id,
        f.name AS farm_name,
        f.region_id,
        r.name AS region_name,
        s.sensor_type,
        AVG(sr.reading_value) AS stage_avg
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    JOIN zones z ON z.zone_id = sr.zone_id
    JOIN farms f ON f.farm_id = z.farm_id
    JOIN regions r ON r.region_id = f.region_id
    JOIN current_stage cs ON TRUE
    WHERE sr.time >= cs.start_date::timestamptz
        AND sr.time < (cs.end_date + INTERVAL '1 day')::timestamptz
        AND f.region_id = (SELECT region_id FROM farms WHERE farm_id = :target_farm_id)
    GROUP BY f.farm_id, f.name, f.region_id, r.name, s.sensor_type
),
ranked AS (
    SELECT
        *,
        RANK() OVER (PARTITION BY region_id, sensor_type ORDER BY stage_avg) AS rank_in_region,
        COUNT(*) OVER (PARTITION BY region_id, sensor_type) AS total_farms,
        ROUND(stage_avg::numeric, 2) AS value
    FROM farm_stage_avgs
)
SELECT
    farm_id,
    farm_name,
    region_name,
    sensor_type,
    value AS stage_avg,
    rank_in_region,
    total_farms,
    ROUND((rank_in_region::numeric / total_farms * 100)::numeric, 1) AS percentile,
    CASE
        WHEN rank_in_region <= total_farms * 0.1 THEN '🟢 Top 10%'
        WHEN rank_in_region <= total_farms * 0.25 THEN '🟡 Top 25%'
        WHEN rank_in_region >= total_farms * 0.9 THEN '🔴 Bottom 10%'
        WHEN rank_in_region >= total_farms * 0.75 THEN '🟠 Bottom 25%'
        ELSE '⚪ Average'
    END AS performance_tier
FROM ranked
WHERE farm_id = :target_farm_id
ORDER BY sensor_type;


-- ============================================================
-- 2. SIMILAR FARMS COMPARISON
-- ============================================================
-- Find farms with similar characteristics and compare outcomes

WITH target AS (
    SELECT * FROM farms WHERE farm_id = :target_farm_id
),
similar_farms AS (
    SELECT
        f.farm_id,
        f.name,
        f.area_hectares,
        f.coffee_variety,
        f.elevation_m,
        -- Similarity score (simple weighted distance)
        (
            ABS(COALESCE(f.elevation_m, 0) - COALESCE(t.elevation_m, 0)) / 100.0 * 0.3 +
            CASE WHEN f.coffee_variety = t.coffee_variety THEN 0 ELSE 0.4 END +
            ABS(COALESCE(f.area_hectares, 0) - COALESCE(t.area_hectares, 0)) / 5.0 * 0.3
        ) AS similarity_score
    FROM farms f, target t
    WHERE f.farm_id != t.farm_id
        AND f.region_id = t.region_id
        AND f.is_active = TRUE
    ORDER BY similarity_score
    LIMIT 20
),
comparison_data AS (
    SELECT
        sf.farm_id,
        sf.name,
        sf.similarity_score,
        s.sensor_type,
        AVG(sr.reading_value) AS avg_30d,
        yr.yield_kg_per_ha
    FROM similar_farms sf
    JOIN zones z ON z.farm_id = sf.farm_id
    JOIN sensors s ON s.zone_id = z.zone_id
    LEFT JOIN sensor_readings sr ON sr.zone_id = z.zone_id
        AND sr.time >= NOW() - INTERVAL '30 days'
    LEFT JOIN yield_records yr ON yr.farm_id = sf.farm_id
        AND yr.year = EXTRACT(YEAR FROM NOW()) - 1
    GROUP BY sf.farm_id, sf.name, sf.similarity_score, s.sensor_type, yr.yield_kg_per_ha
),
target_data AS (
    SELECT
        s.sensor_type,
        AVG(sr.reading_value) AS target_avg_30d
    FROM sensor_readings sr
    JOIN sensors s ON s.sensor_id = sr.sensor_id
    WHERE sr.farm_id = :target_farm_id
        AND sr.time >= NOW() - INTERVAL '30 days'
    GROUP BY s.sensor_type
)
SELECT
    cd.name AS peer_farm,
    ROUND(cd.similarity_score::numeric, 3) AS similarity,
    cd.sensor_type,
    ROUND(cd.avg_30d::numeric, 2) AS peer_avg,
    ROUND(td.target_avg_30d::numeric, 2) AS target_avg,
    ROUND((cd.avg_30d - td.target_avg_30d)::numeric, 2) AS difference,
    cd.yield_kg_per_ha AS peer_last_yield
FROM comparison_data cd
JOIN target_data td ON td.sensor_type = cd.sensor_type
ORDER BY cd.similarity_score, cd.sensor_type;


-- ============================================================
-- 3. HISTORICAL YIELD vs SOIL QUALITY SCORECARD
-- ============================================================

WITH farm_scores AS (
    SELECT
        f.farm_id,
        f.name,
        r.name AS region_name,
        -- Soil quality score (composite metric)
        ROUND((
            -- Moisture score (ideal: 40-60%)
            GREATEST(0, 100 - ABS(AVG(sr.reading_value) FILTER (WHERE s.sensor_type = 'soil_moisture') - 50) * 2)
            -- pH score (ideal: 5.5-6.5)
            + GREATEST(0, 100 - ABS(AVG(sr.reading_value) FILTER (WHERE s.sensor_type = 'ph') - 6.0) * 50)
            -- EC score (ideal: 0.5-2.0)
            + GREATEST(0, 100 - ABS(AVG(sr.reading_value) FILTER (WHERE s.sensor_type = 'ec') - 1.25) * 40)
        ) / 3.0)::numeric, 1) AS soil_quality_score,
        -- Latest yield
        MAX(yr.yield_kg_per_ha) FILTER (WHERE yr.year = EXTRACT(YEAR FROM NOW()) - 1) AS last_yield,
        -- Average yield
        AVG(yr.yield_kg_per_ha) AS avg_yield
    FROM farms f
    JOIN regions r ON r.region_id = f.region_id
    JOIN zones z ON z.farm_id = f.farm_id
    JOIN sensors s ON s.zone_id = z.zone_id
    JOIN sensor_readings sr ON sr.sensor_id = s.sensor_id
        AND sr.time >= NOW() - INTERVAL '90 days'
    LEFT JOIN yield_records yr ON yr.farm_id = f.farm_id
    WHERE f.is_active = TRUE
    GROUP BY f.farm_id, f.name, r.name
)
SELECT
    name AS farm_name,
    region_name,
    soil_quality_score,
    last_yield AS last_year_yield_kg_ha,
    ROUND(avg_yield::numeric, 0) AS avg_yield_kg_ha,
    RANK() OVER (ORDER BY soil_quality_score DESC) AS quality_rank,
    RANK() OVER (ORDER BY last_yield DESC NULLS LAST) AS yield_rank,
    CASE
        WHEN soil_quality_score >= 80 AND last_yield >= 2500 THEN '⭐ Excellent'
        WHEN soil_quality_score >= 60 AND last_yield >= 2000 THEN '✅ Good'
        WHEN soil_quality_score >= 40 THEN '⚠️ Needs Attention'
        ELSE '🔴 At Risk'
    END AS overall_rating
FROM farm_scores
ORDER BY soil_quality_score DESC;
