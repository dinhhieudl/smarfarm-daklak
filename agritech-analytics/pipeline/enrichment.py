"""
Data Enrichment Pipeline
Enriches raw sensor readings with crop stage, weather context, and derived metrics.
Runs as a periodic batch job (every hour via Airflow or pg_cron).
"""

import logging
from datetime import date, datetime, timezone
from typing import Optional

import psycopg2
import psycopg2.extras

logger = logging.getLogger("enrichment")

# ============================================================
# Crop Stage Detection
# ============================================================

# DakLak coffee crop calendar (Robusta-dominant)
# These are defaults; individual farms can override via crop_stages table
DEFAULT_CROP_CALENDAR = {
    "rest":        {"start_month": 11, "start_day": 1,  "end_month": 1, "end_day": 31},
    "flowering":   {"start_month": 2,  "start_day": 1,  "end_month": 3, "end_day": 31},
    "fruiting":    {"start_month": 3,  "start_day": 15, "end_month": 5, "end_day": 31},
    "development": {"start_month": 6,  "start_day": 1,  "end_month": 8, "end_day": 31},
    "ripening":    {"start_month": 9,  "start_day": 1,  "end_month": 10, "end_day": 31},
    "harvest":     {"start_month": 10, "start_day": 15, "end_month": 11, "end_day": 15},
}

# Optimal ranges per crop stage for coffee (DakLak region)
STAGE_OPTIMAL_RANGES = {
    "rest": {
        "soil_moisture": (20, 40),
        "soil_temperature": (18, 28),
        "ph": (5.0, 6.5),
        "ec": (0.2, 1.5),
    },
    "flowering": {
        "soil_moisture": (50, 70),
        "soil_temperature": (20, 30),
        "ph": (5.5, 6.5),
        "ec": (0.5, 2.0),
    },
    "fruiting": {
        "soil_moisture": (55, 75),
        "soil_temperature": (20, 32),
        "ph": (5.5, 6.5),
        "ec": (0.8, 2.5),
    },
    "development": {
        "soil_moisture": (45, 65),
        "soil_temperature": (22, 35),
        "ph": (5.0, 6.5),
        "ec": (0.5, 2.0),
    },
    "ripening": {
        "soil_moisture": (30, 50),
        "soil_temperature": (20, 30),
        "ph": (5.0, 6.5),
        "ec": (0.3, 1.5),
    },
    "harvest": {
        "soil_moisture": (25, 45),
        "soil_temperature": (18, 28),
        "ph": (5.0, 6.5),
        "ec": (0.2, 1.0),
    },
}


def get_crop_stage(farm_id: str, target_date: date, conn) -> Optional[str]:
    """Determine the current crop stage for a farm."""
    with conn.cursor() as cur:
        # Check if farm has custom crop calendar
        cur.execute("""
            SELECT stage_name
            FROM crop_stages
            WHERE farm_id = %s
                AND year = %s
                AND %s BETWEEN start_date AND end_date
            LIMIT 1
        """, (farm_id, target_date.year, target_date))
        
        row = cur.fetchone()
        if row:
            return row[0]

    # Fall back to default calendar
    for stage_name, dates in DEFAULT_CROP_CALENDAR.items():
        month = target_date.month
        day = target_date.day
        start_month = dates["start_month"]
        start_day = dates["start_day"]
        end_month = dates["end_month"]
        end_day = dates["end_day"]

        if start_month > end_month:  # Wraps around year (e.g., rest: Nov-Jan)
            if (month >= start_month and day >= start_day) or \
               (month <= end_month and day <= end_day):
                return stage_name
        else:
            if (month == start_month and day >= start_day) or \
               (month == end_month and day <= end_day) or \
               (start_month < month < end_month):
                return stage_name

    return None


def get_stage_deviation(sensor_type: str, value: float, stage: str) -> Optional[float]:
    """
    Calculate how far a reading deviates from the optimal range for the crop stage.
    Returns deviation as a percentage (0 = perfect, >0 = outside optimal).
    """
    if stage not in STAGE_OPTIMAL_RANGES:
        return None
    if sensor_type not in STAGE_OPTIMAL_RANGES[stage]:
        return None

    opt_min, opt_max = STAGE_OPTIMAL_RANGES[stage][sensor_type]
    opt_mid = (opt_min + opt_max) / 2
    opt_range = opt_max - opt_min

    if opt_range == 0:
        return 0.0

    if value < opt_min:
        return (opt_min - value) / opt_range * 100
    elif value > opt_max:
        return (value - opt_max) / opt_range * 100
    else:
        return 0.0


# ============================================================
# Derived Metrics
# ============================================================

def calculate_derived_metrics(conn, target_date: date):
    """
    Calculate derived/aggregated metrics for a given date.
    These are stored in a derived_metrics table for fast dashboard queries.
    """
    logger.info("Calculating derived metrics for %s", target_date)

    with conn.cursor() as cur:
        # 1. Soil Health Index per zone (composite score 0-100)
        cur.execute("""
            INSERT INTO soil_health_index (date, zone_id, farm_id, health_score, components)
            SELECT
                %s::date AS date,
                z.zone_id,
                z.farm_id,
                -- Composite score (weighted average of normalized metrics)
                ROUND((
                    COALESCE(moisture_score, 0) * 0.30 +
                    COALESCE(ph_score, 0) * 0.20 +
                    COALESCE(ec_score, 0) * 0.20 +
                    COALESCE(nutrient_score, 0) * 0.30
                )::numeric, 1) AS health_score,
                jsonb_build_object(
                    'moisture', moisture_score,
                    'ph', ph_score,
                    'ec', ec_score,
                    'nutrients', nutrient_score,
                    'crop_stage', cs.stage_name
                ) AS components
            FROM zones z
            JOIN farms f ON f.farm_id = z.farm_id
            LEFT JOIN LATERAL (
                SELECT
                    -- Moisture score: ideal 40-60%, penalize extremes
                    GREATEST(0, 100 - ABS(AVG(CASE WHEN s.sensor_type = 'soil_moisture'
                        THEN rd.avg_value END) - 50) * 2) AS moisture_score,
                    -- pH score: ideal 5.5-6.5
                    GREATEST(0, 100 - ABS(AVG(CASE WHEN s.sensor_type = 'ph'
                        THEN rd.avg_value END) - 6.0) * 50) AS ph_score,
                    -- EC score: ideal 0.5-2.0
                    GREATEST(0, 100 - ABS(AVG(CASE WHEN s.sensor_type = 'ec'
                        THEN rd.avg_value END) - 1.25) * 40) AS ec_score,
                    -- Nutrient score: average of N, P, K normalized
                    GREATEST(0, (
                        COALESCE(GREATEST(0, 100 - ABS(AVG(CASE WHEN s.sensor_type = 'nitrogen'
                            THEN rd.avg_value END) - 100) * 0.5), 50) +
                        COALESCE(GREATEST(0, 100 - ABS(AVG(CASE WHEN s.sensor_type = 'phosphorus'
                            THEN rd.avg_value END) - 40) * 1.0), 50) +
                        COALESCE(GREATEST(0, 100 - ABS(AVG(CASE WHEN s.sensor_type = 'potassium'
                            THEN rd.avg_value END) - 150) * 0.3), 50)
                    ) / 3) AS nutrient_score
                FROM readings_daily rd
                JOIN sensors s ON s.zone_id = z.zone_id
                WHERE rd.bucket = %s::date
                    AND rd.zone_id = z.zone_id
            ) scores ON TRUE
            LEFT JOIN LATERAL (
                SELECT stage_name FROM crop_stages
                WHERE farm_id = z.farm_id
                    AND year = EXTRACT(YEAR FROM %s::date)
                    AND %s::date BETWEEN start_date AND end_date
                LIMIT 1
            ) cs ON TRUE
            ON CONFLICT (date, zone_id) DO UPDATE SET
                health_score = EXCLUDED.health_score,
                components = EXCLUDED.components
        """, (target_date, target_date, target_date, target_date))

        # 2. Water Stress Index (for irrigation recommendations)
        cur.execute("""
            INSERT INTO water_stress_index (date, zone_id, farm_id, stress_level, recommendation)
            SELECT
                %s::date,
                z.zone_id,
                z.farm_id,
                CASE
                    WHEN avg_moisture < 15 THEN 'severe'
                    WHEN avg_moisture < 25 THEN 'moderate'
                    WHEN avg_moisture < 35 THEN 'mild'
                    ELSE 'none'
                END AS stress_level,
                CASE
                    WHEN avg_moisture < 15 THEN 'URGENT: Irrigate immediately'
                    WHEN avg_moisture < 25 THEN 'Schedule irrigation within 24h'
                    WHEN avg_moisture < 35 THEN 'Monitor closely, consider irrigation'
                    ELSE 'No action needed'
                END AS recommendation
            FROM zones z
            LEFT JOIN LATERAL (
                SELECT AVG(rd.avg_value) AS avg_moisture
                FROM readings_daily rd
                WHERE rd.zone_id = z.zone_id
                    AND rd.sensor_type = 'soil_moisture'
                    AND rd.bucket >= %s::date - INTERVAL '3 days'
            ) moisture ON TRUE
            ON CONFLICT (date, zone_id) DO UPDATE SET
                stress_level = EXCLUDED.stress_level,
                recommendation = EXCLUDED.recommendation
        """, (target_date, target_date))

        conn.commit()
        logger.info("Derived metrics calculated for %s", target_date)


# ============================================================
# Airflow DAG (for scheduling)
# ============================================================

def create_airflow_dag():
    """
    Create Airflow DAG for the enrichment pipeline.
    Install this in your Airflow dags/ folder.
    """
    from airflow import DAG
    from airflow.operators.python import PythonOperator
    from datetime import timedelta

    default_args = {
        "owner": "agritech",
        "depends_on_past": False,
        "start_date": datetime(2024, 1, 1),
        "retries": 2,
        "retry_delay": timedelta(minutes=5),
    }

    dag = DAG(
        "agritech_enrichment",
        default_args=default_args,
        description="Enrich sensor data with crop stages and derived metrics",
        schedule_interval="0 1 * * *",  # Run at 1 AM daily
        catchup=False,
        tags=["agritech", "enrichment"],
    )

    def run_enrichment(**context):
        conn = psycopg2.connect(os.getenv("DATABASE_URL"))
        target_date = context["ds"]  # Airflow execution date
        calculate_derived_metrics(conn, target_date)
        conn.close()

    enrichment_task = PythonOperator(
        task_id="calculate_derived_metrics",
        python_callable=run_enrichment,
        dag=dag,
    )

    return dag
