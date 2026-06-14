"""
Alert Evaluation Engine
Runs periodically (every 5 minutes) to evaluate all active alert rules.
"""

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

import psycopg2
import psycopg2.extras
import redis

logger = logging.getLogger("alerting")

# ============================================================
# Configuration
# ============================================================

DB_DSN = os.getenv("DATABASE_URL", "postgresql://agritech:agritech@localhost:5432/agritech")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Alert deduplication: don't re-alert for the same condition within this window
ALERT_COOLDOWN_MINUTES = int(os.getenv("ALERT_COOLDOWN", "30"))


class Severity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class AlertRule:
    """Definition of an alert rule."""
    name: str
    description: str
    severity: Severity
    query: str  # SQL query that returns alerting rows
    message_template: str  # Python format string for alert message
    cooldown_minutes: int = ALERT_COOLDOWN_MINUTES
    enabled: bool = True


# ============================================================
# Alert Rule Definitions
# ============================================================

ALERT_RULES = [
    # ---- Per-farm threshold alerts ----
    AlertRule(
        name="moisture_critical_low",
        description="Soil moisture critically low (<15%)",
        severity=Severity.CRITICAL,
        query="""
            SELECT sr.farm_id, f.name AS farm_name, sr.zone_id, z.name AS zone_name,
                   'soil_moisture' AS metric, AVG(sr.reading_value) AS current_value,
                   15.0 AS threshold
            FROM sensor_readings sr
            JOIN sensors s ON s.sensor_id = sr.sensor_id
            JOIN zones z ON z.zone_id = sr.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            WHERE s.sensor_type = 'soil_moisture'
                AND sr.time >= NOW() - INTERVAL '15 minutes'
            GROUP BY sr.farm_id, f.name, sr.zone_id, z.name
            HAVING AVG(sr.reading_value) < 15
        """,
        message_template="🚨 CRITICAL: {farm_name} / {zone_name} soil moisture at {current_value:.1f}% (threshold: {threshold}%). Immediate irrigation needed!",
        cooldown_minutes=15,
    ),
    AlertRule(
        name="moisture_warning_low",
        description="Soil moisture low (<25%)",
        severity=Severity.WARNING,
        query="""
            SELECT sr.farm_id, f.name AS farm_name, sr.zone_id, z.name AS zone_name,
                   'soil_moisture' AS metric, AVG(sr.reading_value) AS current_value,
                   25.0 AS threshold
            FROM sensor_readings sr
            JOIN sensors s ON s.sensor_id = sr.sensor_id
            JOIN zones z ON z.zone_id = sr.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            WHERE s.sensor_type = 'soil_moisture'
                AND sr.time >= NOW() - INTERVAL '30 minutes'
            GROUP BY sr.farm_id, f.name, sr.zone_id, z.name
            HAVING AVG(sr.reading_value) < 25
        """,
        message_template="⚠️ WARNING: {farm_name} / {zone_name} soil moisture low at {current_value:.1f}%. Consider irrigation.",
        cooldown_minutes=60,
    ),
    AlertRule(
        name="ph_out_of_range",
        description="Soil pH outside acceptable range (4.5-7.0)",
        severity=Severity.WARNING,
        query="""
            SELECT sr.farm_id, f.name AS farm_name, sr.zone_id, z.name AS zone_name,
                   'ph' AS metric, AVG(sr.reading_value) AS current_value,
                   CASE WHEN AVG(sr.reading_value) < 4.5 THEN 4.5 ELSE 7.0 END AS threshold
            FROM sensor_readings sr
            JOIN sensors s ON s.sensor_id = sr.sensor_id
            JOIN zones z ON z.zone_id = sr.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            WHERE s.sensor_type = 'ph'
                AND sr.time >= NOW() - INTERVAL '1 hour'
            GROUP BY sr.farm_id, f.name, sr.zone_id, z.name
            HAVING AVG(sr.reading_value) < 4.5 OR AVG(sr.reading_value) > 7.0
        """,
        message_template="⚠️ WARNING: {farm_name} / {zone_name} soil pH at {current_value:.1f} (acceptable: 4.5-7.0). Check for acidification or liming needs.",
    ),
    AlertRule(
        name="temperature_extreme",
        description="Soil temperature extreme (<10°C or >38°C)",
        severity=Severity.WARNING,
        query="""
            SELECT sr.farm_id, f.name AS farm_name, sr.zone_id, z.name AS zone_name,
                   'soil_temperature' AS metric, AVG(sr.reading_value) AS current_value,
                   CASE WHEN AVG(sr.reading_value) < 10 THEN 10.0 ELSE 38.0 END AS threshold
            FROM sensor_readings sr
            JOIN sensors s ON s.sensor_id = sr.sensor_id
            JOIN zones z ON z.zone_id = sr.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            WHERE s.sensor_type = 'soil_temperature'
                AND sr.time >= NOW() - INTERVAL '30 minutes'
            GROUP BY sr.farm_id, f.name, sr.zone_id, z.name
            HAVING AVG(sr.reading_value) < 10 OR AVG(sr.reading_value) > 38
        """,
        message_template="🌡️ WARNING: {farm_name} / {zone_name} soil temperature at {current_value:.1f}°C. Root stress likely.",
    ),
    AlertRule(
        name="ec_high",
        description="Electrical conductivity too high (>4.0 mS/cm)",
        severity=Severity.WARNING,
        query="""
            SELECT sr.farm_id, f.name AS farm_name, sr.zone_id, z.name AS zone_name,
                   'ec' AS metric, AVG(sr.reading_value) AS current_value,
                   4.0 AS threshold
            FROM sensor_readings sr
            JOIN sensors s ON s.sensor_id = sr.sensor_id
            JOIN zones z ON z.zone_id = sr.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            WHERE s.sensor_type = 'ec'
                AND sr.time >= NOW() - INTERVAL '1 hour'
            GROUP BY sr.farm_id, f.name, sr.zone_id, z.name
            HAVING AVG(sr.reading_value) > 4.0
        """,
        message_template="🧂 WARNING: {farm_name} / {zone_name} EC at {current_value:.2f} mS/cm (threshold: {threshold}). Possible salt buildup — flush irrigation recommended.",
    ),
    # ---- Sensor health alerts ----
    AlertRule(
        name="sensor_battery_low",
        description="Sensor battery below 20%",
        severity=Severity.INFO,
        query="""
            SELECT sr.farm_id, f.name AS farm_name, sr.zone_id, z.name AS zone_name,
                   'battery' AS metric, AVG(sr.battery_level) AS current_value,
                   20.0 AS threshold
            FROM sensor_readings sr
            JOIN sensors s ON s.sensor_id = sr.sensor_id
            JOIN zones z ON z.zone_id = sr.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            WHERE sr.time >= NOW() - INTERVAL '1 hour'
                AND sr.battery_level IS NOT NULL
            GROUP BY sr.farm_id, f.name, sr.zone_id, z.name
            HAVING AVG(sr.battery_level) < 20
        """,
        message_template="🔋 INFO: {farm_name} / {zone_name} sensor battery at {current_value:.0f}%. Schedule maintenance.",
        cooldown_minutes=360,  # Once per 6 hours
    ),
    AlertRule(
        name="sensor_no_data",
        description="Sensor not reporting for >1 hour",
        severity=Severity.WARNING,
        query="""
            SELECT f.farm_id, f.name AS farm_name, z.zone_id, z.name AS zone_name,
                   'connectivity' AS metric,
                   EXTRACT(EPOCH FROM (NOW() - MAX(sr.time))) / 3600 AS current_value,
                   1.0 AS threshold
            FROM sensors s
            JOIN zones z ON z.zone_id = s.zone_id
            JOIN farms f ON f.farm_id = z.farm_id
            LEFT JOIN sensor_readings sr ON sr.sensor_id = s.sensor_id
            WHERE s.is_active = TRUE
            GROUP BY f.farm_id, f.name, z.zone_id, z.name
            HAVING MAX(sr.time) < NOW() - INTERVAL '1 hour'
                OR MAX(sr.time) IS NULL
        """,
        message_template="📡 WARNING: {farm_name} / {zone_name} has not reported data for {current_value:.0f} hours. Check sensor connectivity.",
        cooldown_minutes=120,
    ),
    # ---- Cross-farm regional alerts ----
    AlertRule(
        name="regional_drought_warning",
        description="Regional drought: >60% of farms with low moisture",
        severity=Severity.CRITICAL,
        query="""
            WITH farm_moisture AS (
                SELECT f.region_id, r.name AS region_name, f.farm_id,
                       AVG(sr.reading_value) AS avg_moisture
                FROM sensor_readings sr
                JOIN sensors s ON s.sensor_id = sr.sensor_id
                JOIN zones z ON z.zone_id = sr.zone_id
                JOIN farms f ON f.farm_id = z.farm_id
                JOIN regions r ON r.region_id = f.region_id
                WHERE s.sensor_type = 'soil_moisture'
                    AND sr.time >= NOW() - INTERVAL '6 hours'
                GROUP BY f.region_id, r.name, f.farm_id
            )
            SELECT
                region_id AS farm_id,
                region_name AS farm_name,
                'regional' AS zone_id,
                region_name AS zone_name,
                'soil_moisture' AS metric,
                AVG(avg_moisture) AS current_value,
                25.0 AS threshold
            FROM farm_moisture
            GROUP BY region_id, region_name
            HAVING COUNT(*) FILTER (WHERE avg_moisture < 25)::float / COUNT(*) > 0.6
        """,
        message_template="🚨 DROUGHT ALERT: {farm_name} region — {current_value:.1f}% average moisture across farms. Regional irrigation coordination needed!",
        cooldown_minutes=120,
    ),
]


# ============================================================
# Alert Engine
# ============================================================

class AlertEngine:
    """
    Evaluates alert rules against TimescaleDB and dispatches notifications.
    Uses Redis for alert deduplication and cooldown tracking.
    """

    def __init__(self):
        self.conn = psycopg2.connect(DB_DSN)
        self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        self.notifiers = []  # Registered notification dispatchers

    def register_notifier(self, notifier):
        """Register a notification dispatcher (webhook, SMS, email, etc.)."""
        self.notifiers.append(notifier)

    def _is_in_cooldown(self, rule_name: str, entity_key: str, cooldown_minutes: int) -> bool:
        """Check if this alert is still in cooldown period."""
        cache_key = f"alert:cooldown:{rule_name}:{entity_key}"
        return self.redis.exists(cache_key)

    def _set_cooldown(self, rule_name: str, entity_key: str, cooldown_minutes: int):
        """Set cooldown for an alert."""
        cache_key = f"alert:cooldown:{rule_name}:{entity_key}"
        self.redis.setex(cache_key, cooldown_minutes * 60, "1")

    def evaluate_rule(self, rule: AlertRule) -> list[dict]:
        """Evaluate a single alert rule and return triggered alerts."""
        if not rule.enabled:
            return []

        try:
            with self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(rule.query)
                rows = cur.fetchall()
        except Exception as e:
            logger.error("Failed to evaluate rule '%s': %s", rule.name, e)
            return []

        alerts = []
        for row in rows:
            entity_key = f"{row.get('farm_id', '')}:{row.get('zone_id', '')}"

            # Check cooldown
            if self._is_in_cooldown(rule.name, entity_key, rule.cooldown_minutes):
                continue

            # Format alert message
            try:
                message = rule.message_template.format(**row)
            except KeyError:
                message = f"[{rule.name}] Alert triggered: {json.dumps(row, default=str)}"

            alert = {
                "rule_name": rule.name,
                "severity": rule.severity.value,
                "farm_id": str(row.get("farm_id", "")),
                "zone_id": str(row.get("zone_id", "")),
                "metric": row.get("metric", ""),
                "current_value": float(row.get("current_value", 0)),
                "threshold": float(row.get("threshold", 0)),
                "message": message,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            alerts.append(alert)

            # Set cooldown
            self._set_cooldown(rule.name, entity_key, rule.cooldown_minutes)

        return alerts

    def run_evaluation_cycle(self):
        """Run all alert rules and dispatch notifications."""
        logger.info("Starting alert evaluation cycle...")
        all_alerts = []

        for rule in ALERT_RULES:
            alerts = self.evaluate_rule(rule)
            if alerts:
                logger.info("Rule '%s' triggered %d alerts", rule.name, len(alerts))
                all_alerts.extend(alerts)

        if not all_alerts:
            logger.info("No alerts triggered.")
            return

        # Persist alerts to database
        self._persist_alerts(all_alerts)

        # Dispatch notifications
        for alert in all_alerts:
            for notifier in self.notifiers:
                try:
                    notifier.send(alert)
                except Exception as e:
                    logger.error("Notification dispatch failed (%s): %s", notifier.__class__.__name__, e)

        logger.info("Evaluation complete: %d total alerts dispatched.", len(all_alerts))

    def _persist_alerts(self, alerts: list[dict]):
        """Save alerts to the database for history."""
        try:
            with self.conn.cursor() as cur:
                for alert in alerts:
                    cur.execute("""
                        INSERT INTO alerts (
                            time, farm_id, zone_id, rule_name, severity,
                            metric, current_value, threshold, message,
                            notification_sent
                        ) VALUES (
                            NOW(), %s, %s, %s, %s, %s, %s, %s, %s, TRUE
                        )
                    """, (
                        alert["farm_id"] or None,
                        alert["zone_id"] or None,
                        alert["rule_name"],
                        alert["severity"],
                        alert["metric"],
                        alert["current_value"],
                        alert["threshold"],
                        alert["message"],
                    ))
            self.conn.commit()
        except Exception as e:
            logger.error("Failed to persist alerts: %s", e)
            self.conn.rollback()

    def close(self):
        self.conn.close()
        self.redis.close()


# ============================================================
# Entry point
# ============================================================

if __name__ == "__main__":
    from notifications import WebhookNotifier, SMSNotifier

    engine = AlertEngine()
    engine.register_notifier(WebhookNotifier())
    # engine.register_notifier(SMSNotifier())  # Uncomment when configured

    engine.run_evaluation_cycle()
    engine.close()
