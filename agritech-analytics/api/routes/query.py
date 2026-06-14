"""
Analytics Query Routes
Provides time-series data, aggregations, and cross-farm analytics.
"""

import io
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from models import (
    TimeGranularity, SensorType, AnomalyResponse, BenchmarkResponse,
    PaginatedResponse, ReadingResponse,
)

router = APIRouter()

DB_DSN = "postgresql://agritech:agritech@localhost:5432/agritech"


def get_db():
    return psycopg2.connect(DB_DSN, cursor_factory=psycopg2.extras.RealDictCursor)


def get_granularity_table(granularity: TimeGranularity) -> str:
    """Map granularity to the appropriate continuous aggregate table."""
    mapping = {
        TimeGranularity.RAW: "sensor_readings",
        TimeGranularity.FIVE_MIN: "sensor_readings",  # 5-min is the raw interval
        TimeGranularity.HOURLY: "readings_hourly",
        TimeGranularity.DAILY: "readings_daily",
        TimeGranularity.WEEKLY: "readings_weekly",
        TimeGranularity.MONTHLY: "readings_daily",  # We'll bucket in the query
    }
    return mapping.get(granularity, "readings_hourly")


# ============================================================
// Time-Series Data
# ============================================================

@router.get("/timeseries")
async def get_timeseries(
    farm_id: str = Query(..., description="Farm UUID"),
    sensor_type: SensorType = Query(...),
    granularity: TimeGranularity = Query(TimeGranularity.HOURLY),
    start: datetime = Query(default=None),
    end: datetime = Query(default=None),
    zone_id: str = Query(default=None),
):
    """
    Get time-series data for a farm/zone sensor.
    Uses continuous aggregates for fast reads.
    """
    if not start:
        start = datetime.now(timezone.utc) - timedelta(days=7)
    if not end:
        end = datetime.now(timezone.utc)

    table = get_granularity_table(granularity)

    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if table == "sensor_readings":
                # Raw data
                query = """
                    SELECT sr.time, sr.farm_id, sr.zone_id, s.sensor_type,
                           sr.reading_value AS avg_value, sr.quality_flag
                    FROM sensor_readings sr
                    JOIN sensors s ON s.sensor_id = sr.sensor_id
                    WHERE sr.farm_id = %s
                        AND s.sensor_type = %s
                        AND sr.time BETWEEN %s AND %s
                """
                params = [farm_id, sensor_type.value, start, end]

                if zone_id:
                    query += " AND sr.zone_id = %s"
                    params.append(zone_id)

                if granularity == TimeGranularity.FIVE_MIN:
                    # Downsample to 5-min buckets
                    query = query.replace(
                        "sr.time, sr.farm_id, sr.zone_id, s.sensor_type, sr.reading_value AS avg_value, sr.quality_flag",
                        """time_bucket('5 minutes', sr.time) AS time, sr.farm_id, sr.zone_id, s.sensor_type,
                           AVG(sr.reading_value) AS avg_value, 0 AS quality_flag"""
                    )
                    query += " GROUP BY time_bucket('5 minutes', sr.time), sr.farm_id, sr.zone_id, s.sensor_type"

                query += " ORDER BY time"
            else:
                # Continuous aggregate
                time_col = "bucket"
                if granularity == TimeGranularity.MONTHLY:
                    time_col = "time_bucket('1 month', bucket) AS bucket"

                query = f"""
                    SELECT {time_col}, farm_id, zone_id, sensor_type,
                           avg_value, min_value, max_value, sample_count
                    FROM {table}
                    WHERE farm_id = %s
                        AND sensor_type = %s
                        AND bucket BETWEEN %s AND %s
                """
                params = [farm_id, sensor_type.value, start, end]

                if zone_id:
                    query += " AND zone_id = %s"
                    params.append(zone_id)

                if granularity == TimeGranularity.MONTHLY:
                    query = f"""
                        SELECT {time_col}, farm_id, zone_id, sensor_type,
                               AVG(avg_value) AS avg_value, MIN(min_value) AS min_value,
                               MAX(max_value) AS max_value, SUM(sample_count) AS sample_count
                        FROM {table}
                        WHERE farm_id = %s AND sensor_type = %s AND bucket BETWEEN %s AND %s
                    """
                    if zone_id:
                        query += " AND zone_id = %s"
                    query += " GROUP BY time_bucket('1 month', bucket), farm_id, zone_id, sensor_type"

                query += " ORDER BY bucket"

            cur.execute(query, params)
            rows = cur.fetchall()

            # Serialize
            for row in rows:
                for k, v in row.items():
                    if hasattr(v, "isoformat"):
                        row[k] = v.isoformat()
                    elif isinstance(v, (int, float)):
                        row[k] = float(v) if isinstance(v, float) else v

            return {"data": rows, "count": len(rows)}
    finally:
        conn.close()


# ============================================================
// Cross-Farm Analytics
# ============================================================

@router.get("/anomalies")
async def detect_anomalies(
    z_threshold: float = Query(2.5, ge=1.0, le=5.0),
    sensor_type: SensorType = Query(default=None),
    region_id: int = Query(default=None),
):
    """
    Detect farms with anomalous readings using Z-score method.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            query = """
                WITH farm_baseline AS (
                    SELECT sr.farm_id, sr.zone_id, s.sensor_type,
                           AVG(sr.reading_value) AS baseline_mean,
                           STDDEV(sr.reading_value) AS baseline_stddev
                    FROM sensor_readings sr
                    JOIN sensors s ON s.sensor_id = sr.sensor_id
                    WHERE sr.time >= NOW() - INTERVAL '30 days'
                        AND sr.time < NOW() - INTERVAL '1 hour'
                    GROUP BY sr.farm_id, sr.zone_id, s.sensor_type
                    HAVING COUNT(*) >= 100
                ),
                recent AS (
                    SELECT sr.farm_id, sr.zone_id, s.sensor_type,
                           AVG(sr.reading_value) AS current_avg
                    FROM sensor_readings sr
                    JOIN sensors s ON s.sensor_id = sr.sensor_id
                    WHERE sr.time >= NOW() - INTERVAL '1 hour'
                    GROUP BY sr.farm_id, sr.zone_id, s.sensor_type
                )
                SELECT r.farm_id, f.name AS farm_name, r.zone_id, z.name AS zone_name,
                       r.sensor_type, r.current_avg, b.baseline_mean, b.baseline_stddev,
                       CASE WHEN b.baseline_stddev > 0.001
                           THEN (r.current_avg - b.baseline_mean) / b.baseline_stddev
                           ELSE 0 END AS z_score,
                       NOW() AS detected_at
                FROM recent r
                JOIN farm_baseline b ON b.farm_id = r.farm_id
                    AND b.zone_id = r.zone_id AND b.sensor_type = r.sensor_type
                JOIN zones z ON z.zone_id = r.zone_id
                JOIN farms f ON f.farm_id = r.farm_id
                WHERE 1=1
            """
            params = []

            if sensor_type:
                query += " AND r.sensor_type = %s"
                params.append(sensor_type.value)
            if region_id:
                query += " AND f.region_id = %s"
                params.append(region_id)

            query += f" AND ABS(CASE WHEN b.baseline_stddev > 0.001 THEN (r.current_avg - b.baseline_mean) / b.baseline_stddev ELSE 0 END) > %s"
            params.append(z_threshold)
            query += " ORDER BY ABS(z_score) DESC LIMIT 100"

            cur.execute(query, params)
            rows = cur.fetchall()

            for row in rows:
                row["z_score"] = round(float(row["z_score"]), 2)
                row["current_avg"] = round(float(row["current_avg"]), 2)
                row["baseline_mean"] = round(float(row["baseline_mean"]), 2)
                row["severity"] = (
                    "CRITICAL" if abs(row["z_score"]) > 4
                    else "WARNING" if abs(row["z_score"]) > 3
                    else "INFO"
                )
                for k, v in row.items():
                    if hasattr(v, "isoformat"):
                        row[k] = v.isoformat()

            return {"anomalies": rows, "count": len(rows), "z_threshold": z_threshold}
    finally:
        conn.close()


@router.get("/benchmark")
async def benchmark_farm(
    farm_id: str = Query(...),
    period_days: int = Query(30, ge=7, le=365),
):
    """
    Benchmark a farm against its regional averages.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                WITH farm_daily AS (
                    SELECT time_bucket('1 day', sr.time) AS day, s.sensor_type,
                           AVG(sr.reading_value) AS farm_avg
                    FROM sensor_readings sr
                    JOIN sensors s ON s.sensor_id = sr.sensor_id
                    WHERE sr.farm_id = %s
                        AND sr.time >= NOW() - INTERVAL '%s days'
                    GROUP BY day, s.sensor_type
                ),
                region_daily AS (
                    SELECT rd.bucket AS day, rd.sensor_type,
                           rd.region_avg, rd.region_stddev, rd.region_p25, rd.region_median, rd.region_p75
                    FROM regional_daily rd
                    JOIN farms f ON f.region_id = rd.region_id
                    WHERE f.farm_id = %s
                        AND rd.bucket >= NOW() - INTERVAL '%s days'
                )
                SELECT fd.sensor_type,
                       ROUND(AVG(fd.farm_avg)::numeric, 2) AS farm_avg,
                       ROUND(AVG(rd.region_avg)::numeric, 2) AS region_avg,
                       ROUND(AVG(rd.region_median)::numeric, 2) AS region_median,
                       ROUND((COUNT(*) FILTER (WHERE fd.farm_avg < rd.region_avg)::numeric
                              / NULLIF(COUNT(*), 0) * 100)::numeric, 1) AS percentile_rank
                FROM farm_daily fd
                JOIN region_daily rd ON rd.day = fd.day AND rd.sensor_type = fd.sensor_type
                GROUP BY fd.sensor_type
                ORDER BY fd.sensor_type
            """, (farm_id, period_days, farm_id, period_days))
            rows = cur.fetchall()

            for row in rows:
                for k, v in row.items():
                    if isinstance(v, (int, float)):
                        row[k] = float(v)
                    elif hasattr(v, "isoformat"):
                        row[k] = v.isoformat()

            return {"farm_id": farm_id, "period_days": period_days, "benchmarks": rows}
    finally:
        conn.close()


@router.get("/seasonal-trends")
async def seasonal_trends(
    region_id: int = Query(default=None),
    sensor_type: SensorType = Query(default=None),
    years: int = Query(3, ge=1, le=10),
):
    """
    Monthly seasonal trends across all farms.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            query = """
                SELECT time_bucket('1 month', sr.time) AS month,
                       f.region_id, r.name AS region_name, s.sensor_type,
                       AVG(sr.reading_value) AS monthly_avg,
                       COUNT(DISTINCT sr.farm_id) AS farms_reporting
                FROM sensor_readings sr
                JOIN sensors s ON s.sensor_id = sr.sensor_id
                JOIN zones z ON z.zone_id = sr.zone_id
                JOIN farms f ON f.farm_id = z.farm_id
                JOIN regions r ON r.region_id = f.region_id
                WHERE sr.time >= NOW() - INTERVAL '%s years'
            """
            params = [years]

            if region_id:
                query += " AND f.region_id = %s"
                params.append(region_id)
            if sensor_type:
                query += " AND s.sensor_type = %s"
                params.append(sensor_type.value)

            query += """
                GROUP BY month, f.region_id, r.name, s.sensor_type
                ORDER BY month
            """
            cur.execute(query, params)
            rows = cur.fetchall()

            for row in rows:
                for k, v in row.items():
                    if isinstance(v, (int, float)):
                        row[k] = float(v)
                    elif hasattr(v, "isoformat"):
                        row[k] = v.isoformat()

            return {"trends": rows, "count": len(rows)}
    finally:
        conn.close()


@router.get("/correlation")
async def weather_soil_correlation(
    region_id: int = Query(default=None),
    period_days: int = Query(365, ge=30, le=730),
):
    """
    Correlation between weather and soil conditions.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            query = """
                WITH daily_weather AS (
                    SELECT time_bucket('1 day', time) AS day, region_id,
                           AVG(temperature_c) AS avg_temp, SUM(rainfall_mm) AS total_rain,
                           AVG(humidity_pct) AS avg_humidity
                    FROM weather_readings
                    WHERE time >= NOW() - INTERVAL '%s days'
                    GROUP BY day, region_id
                ),
                daily_soil AS (
                    SELECT rd.bucket AS day, rd.region_id, rd.sensor_type, rd.region_avg
                    FROM regional_daily rd
                    WHERE rd.bucket >= NOW() - INTERVAL '%s days'
                )
                SELECT dw.region_id, r.name AS region_name, ds.sensor_type,
                       ROUND(CORR(dw.avg_temp, ds.region_avg)::numeric, 4) AS corr_temperature,
                       ROUND(CORR(dw.total_rain, ds.region_avg)::numeric, 4) AS corr_rainfall,
                       ROUND(CORR(dw.avg_humidity, ds.region_avg)::numeric, 4) AS corr_humidity,
                       COUNT(*) AS data_points
                FROM daily_weather dw
                JOIN daily_soil ds ON ds.day = dw.day AND ds.region_id = dw.region_id
                JOIN regions r ON r.region_id = dw.region_id
            """
            params = [period_days, period_days]

            if region_id:
                query += " WHERE dw.region_id = %s"
                params.append(region_id)

            query += " GROUP BY dw.region_id, r.name, ds.sensor_type ORDER BY dw.region_id, ds.sensor_type"
            cur.execute(query, params)
            rows = cur.fetchall()

            for row in rows:
                for k, v in row.items():
                    if isinstance(v, (int, float)):
                        row[k] = float(v)

            return {"correlations": rows, "count": len(rows)}
    finally:
        conn.close()


@router.get("/fleet-health")
async def fleet_health():
    """
    Overview of all farms — data freshness, sensor health, active alerts.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT f.farm_id, f.name AS farm_name, r.name AS region_name,
                       f.area_hectares, f.coffee_variety,
                       COUNT(DISTINCT z.zone_id) AS zone_count,
                       COUNT(DISTINCT s.sensor_id) AS sensor_count,
                       MAX(l.last_reading_at) AS latest_reading,
                       EXTRACT(EPOCH FROM (NOW() - MAX(l.last_reading_at))) / 3600 AS hours_since_last,
                       COUNT(*) FILTER (WHERE l.battery_level < 20) AS low_battery_sensors,
                       (SELECT COUNT(*) FROM alerts a
                        WHERE a.farm_id = f.farm_id
                        AND a.resolved_at IS NULL) AS active_alerts
                FROM farms f
                JOIN regions r ON r.region_id = f.region_id
                JOIN zones z ON z.farm_id = f.farm_id
                JOIN sensors s ON s.zone_id = z.zone_id
                LEFT JOIN latest_readings l ON l.sensor_id = s.sensor_id
                WHERE f.is_active = TRUE
                GROUP BY f.farm_id, f.name, r.name, f.area_hectares, f.coffee_variety
                ORDER BY hours_since_last DESC NULLS LAST
            """)
            rows = cur.fetchall()

            for row in rows:
                for k, v in row.items():
                    if isinstance(v, (int, float)):
                        row[k] = float(v)
                    elif hasattr(v, "isoformat"):
                        row[k] = v.isoformat()

            return {"farms": rows, "count": len(rows)}
    finally:
        conn.close()
