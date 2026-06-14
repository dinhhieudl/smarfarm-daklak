"""
Alert Rules — declarative rule definitions.
Loaded by the alert engine and can be managed via API.
"""

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import psycopg2

DB_DSN = os.getenv("DATABASE_URL", "postgresql://agritech:agritech@localhost:5432/agritech")


@dataclass
class ThresholdRule:
    """Simple threshold-based alert rule."""
    name: str
    sensor_type: str
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    severity: str = "warning"
    window_minutes: int = 15
    cooldown_minutes: int = 30
    description: str = ""

    def to_sql(self) -> str:
        conditions = []
        if self.min_value is not None:
            conditions.append(f"AVG(sr.reading_value) < {self.min_value}")
        if self.max_value is not None:
            conditions.append(f"AVG(sr.reading_value) > {self.max_value}")

        having_clause = " OR ".join(conditions)

        return f"""
            SELECT sr.farm_id, f.name AS farm_name, sr.zone_id, z.name AS zone_name,
                   '{self.sensor_type}' AS metric,
                   AVG(sr.reading_value) AS current_value,
                   {self.min_value or self.max_value} AS threshold
            FROM sensor_readings sr
            JOIN sensors s ON s.sensor_id = sr.sensor_id
            JOIN zones z ON z.zone_id = sr.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            WHERE s.sensor_type = '{self.sensor_type}'
                AND sr.time >= NOW() - INTERVAL '{self.window_minutes} minutes'
            GROUP BY sr.farm_id, f.name, sr.zone_id, z.name
            HAVING {having_clause}
        """


# ============================================================
# Default Rule Set for DakLak Coffee
# ============================================================

DEFAULT_RULES = [
    ThresholdRule(
        name="moisture_critical_low",
        sensor_type="soil_moisture",
        min_value=15,
        severity="critical",
        window_minutes=15,
        cooldown_minutes=15,
        description="Soil moisture critically low — immediate irrigation needed",
    ),
    ThresholdRule(
        name="moisture_warning_low",
        sensor_type="soil_moisture",
        min_value=25,
        severity="warning",
        window_minutes=30,
        cooldown_minutes=60,
        description="Soil moisture approaching critical level",
    ),
    ThresholdRule(
        name="moisture_high",
        sensor_type="soil_moisture",
        max_value=85,
        severity="warning",
        window_minutes=30,
        cooldown_minutes=60,
        description="Soil moisture very high — check drainage",
    ),
    ThresholdRule(
        name="ph_too_acidic",
        sensor_type="ph",
        min_value=4.5,
        severity="warning",
        window_minutes=60,
        cooldown_minutes=120,
        description="Soil too acidic — consider liming",
    ),
    ThresholdRule(
        name="ph_too_alkaline",
        sensor_type="ph",
        max_value=7.0,
        severity="warning",
        window_minutes=60,
        cooldown_minutes=120,
        description="Soil too alkaline — check for over-liming",
    ),
    ThresholdRule(
        name="temperature_cold",
        sensor_type="soil_temperature",
        min_value=10,
        severity="warning",
        window_minutes=30,
        cooldown_minutes=60,
        description="Soil temperature too low — root activity reduced",
    ),
    ThresholdRule(
        name="temperature_hot",
        sensor_type="soil_temperature",
        max_value=38,
        severity="warning",
        window_minutes=30,
        cooldown_minutes=60,
        description="Soil temperature too high — root stress risk",
    ),
    ThresholdRule(
        name="ec_high",
        sensor_type="ec",
        max_value=4.0,
        severity="warning",
        window_minutes=60,
        cooldown_minutes=120,
        description="Electrical conductivity high — salt buildup risk",
    ),
    ThresholdRule(
        name="salinity_high",
        sensor_type="salinity",
        max_value=2.0,
        severity="critical",
        window_minutes=60,
        cooldown_minutes=60,
        description="Salinity too high — immediate leaching needed",
    ),
]


def load_rules_from_db() -> list[ThresholdRule]:
    """Load custom rules from database (farm-specific overrides)."""
    try:
        conn = psycopg2.connect(DB_DSN)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT rule_name, sensor_type, min_value, max_value,
                       severity, window_minutes, cooldown_minutes, description
                FROM alert_rules
                WHERE enabled = TRUE
            """)
            rules = []
            for row in cur.fetchall():
                rules.append(ThresholdRule(
                    name=row[0],
                    sensor_type=row[1],
                    min_value=row[2],
                    max_value=row[3],
                    severity=row[4],
                    window_minutes=row[5] or 15,
                    cooldown_minutes=row[6] or 30,
                    description=row[7] or "",
                ))
        conn.close()
        return rules
    except Exception:
        return []


def get_all_rules() -> list[ThresholdRule]:
    """Get all active rules (defaults + custom DB rules)."""
    db_rules = load_rules_from_db()
    # DB rules override defaults with the same name
    db_names = {r.name for r in db_rules}
    defaults = [r for r in DEFAULT_RULES if r.name not in db_names]
    return defaults + db_rules
