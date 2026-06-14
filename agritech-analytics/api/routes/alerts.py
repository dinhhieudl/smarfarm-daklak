"""
Alert Management Routes
View, acknowledge, and manage alerts.
"""

from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()

DB_DSN = "postgresql://agritech:agritech@localhost:5432/agritech"


def get_db():
    return psycopg2.connect(DB_DSN, cursor_factory=psycopg2.extras.RealDictCursor)


class AcknowledgeRequest(BaseModel):
    acknowledged_by: str


# ============================================================
# List Alerts
# ============================================================

@router.get("/")
async def list_alerts(
    farm_id: str = Query(default=None),
    severity: str = Query(default=None, regex="^(info|warning|critical)$"),
    acknowledged: bool = Query(default=None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    List alerts with optional filtering.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            query = """
                SELECT a.alert_id, a.time, a.farm_id, f.name AS farm_name,
                       a.zone_id, z.name AS zone_name, a.rule_name, a.severity,
                       a.metric, a.current_value, a.threshold, a.message,
                       a.acknowledged, a.acknowledged_by, a.acknowledged_at,
                       a.resolved_at
                FROM alerts a
                LEFT JOIN farms f ON f.farm_id = a.farm_id
                LEFT JOIN zones z ON z.zone_id = a.zone_id
                WHERE 1=1
            """
            params = []

            if farm_id:
                query += " AND a.farm_id = %s"
                params.append(farm_id)
            if severity:
                query += " AND a.severity = %s"
                params.append(severity)
            if acknowledged is not None:
                if acknowledged:
                    query += " AND a.acknowledged = TRUE"
                else:
                    query += " AND a.acknowledged = FALSE AND a.resolved_at IS NULL"

            query += " ORDER BY a.time DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])

            cur.execute(query, params)
            rows = cur.fetchall()

            for row in rows:
                for k, v in row.items():
                    if hasattr(v, "isoformat"):
                        row[k] = v.isoformat()
                    elif isinstance(v, (int, float)):
                        row[k] = float(v) if isinstance(v, float) else v

            # Get total count
            count_query = "SELECT COUNT(*) FROM alerts WHERE 1=1"
            count_params = []
            if farm_id:
                count_query += " AND farm_id = %s"
                count_params.append(farm_id)
            if severity:
                count_query += " AND severity = %s"
                count_params.append(severity)
            if acknowledged is not None:
                if acknowledged:
                    count_query += " AND acknowledged = TRUE"
                else:
                    count_query += " AND acknowledged = FALSE AND resolved_at IS NULL"

            cur.execute(count_query, count_params)
            total = cur.fetchone()["count"]

            return {
                "alerts": rows,
                "total": total,
                "limit": limit,
                "offset": offset,
            }
    finally:
        conn.close()


# ============================================================
# Acknowledge Alert
# ============================================================

@router.post("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: int, req: AcknowledgeRequest):
    """
    Acknowledge an alert (mark as seen by a human).
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                UPDATE alerts
                SET acknowledged = TRUE,
                    acknowledged_by = %s,
                    acknowledged_at = NOW()
                WHERE alert_id = %s AND acknowledged = FALSE
                RETURNING alert_id
            """, (req.acknowledged_by, alert_id))

            if not cur.fetchone():
                raise HTTPException(404, "Alert not found or already acknowledged")

            conn.commit()
            return {"status": "acknowledged", "alert_id": alert_id}
    finally:
        conn.close()


# ============================================================
# Resolve Alert
# ============================================================

@router.post("/{alert_id}/resolve")
async def resolve_alert(alert_id: int):
    """
    Mark an alert as resolved.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                UPDATE alerts
                SET resolved_at = NOW()
                WHERE alert_id = %s AND resolved_at IS NULL
                RETURNING alert_id
            """, (alert_id,))

            if not cur.fetchone():
                raise HTTPException(404, "Alert not found or already resolved")

            conn.commit()
            return {"status": "resolved", "alert_id": alert_id}
    finally:
        conn.close()


# ============================================================
# Alert Statistics
# ============================================================

@router.get("/stats")
async def alert_stats(
    period_days: int = Query(30, ge=1, le=365),
):
    """
    Alert statistics for the dashboard.
    """
    conn = get_db()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT
                    COUNT(*) AS total_alerts,
                    COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
                    COUNT(*) FILTER (WHERE severity = 'warning') AS warning,
                    COUNT(*) FILTER (WHERE severity = 'info') AS info,
                    COUNT(*) FILTER (WHERE acknowledged = FALSE AND resolved_at IS NULL) AS unacknowledged,
                    COUNT(*) FILTER (WHERE resolved_at IS NULL) AS unresolved,
                    COUNT(DISTINCT farm_id) AS farms_affected,
                    -- Top alerting rule
                    MODE() WITHIN GROUP (ORDER BY rule_name) AS most_common_rule,
                    -- Resolution time (avg)
                    AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - time)) / 3600)
                        FILTER (WHERE resolved_at IS NOT NULL) AS avg_resolution_hours
                FROM alerts
                WHERE time >= NOW() - INTERVAL '%s days'
            """ % period_days)
            stats = dict(cur.fetchone())

            for k, v in stats.items():
                if isinstance(v, (int, float)):
                    stats[k] = round(float(v), 2) if v is not None else None
                elif hasattr(v, "isoformat"):
                    stats[k] = v.isoformat()

            # Top 5 alerting farms
            cur.execute("""
                SELECT a.farm_id, f.name AS farm_name, COUNT(*) AS alert_count
                FROM alerts a
                JOIN farms f ON f.farm_id = a.farm_id
                WHERE a.time >= NOW() - INTERVAL '%s days'
                GROUP BY a.farm_id, f.name
                ORDER BY alert_count DESC
                LIMIT 5
            """ % period_days)
            top_farms = cur.fetchall()

            return {"stats": stats, "top_alerting_farms": top_farms}
    finally:
        conn.close()
