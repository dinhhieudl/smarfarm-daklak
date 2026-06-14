"""
SmartFarm Edge Agent - Local SQLite Database
Buffers sensor readings locally before cloud sync.
"""

import sqlite3
import uuid
import json
from datetime import datetime, timedelta
from pathlib import Path


class LocalDatabase:
    """SQLite database for local sensor data buffering."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = None

    async def initialize(self):
        """Create database and tables if they don't exist."""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)

        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")

        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS readings (
                reading_id    TEXT PRIMARY KEY,
                sensor_id     TEXT NOT NULL,
                sensor_type   TEXT NOT NULL,
                value         REAL NOT NULL,
                unit          TEXT NOT NULL,
                quality       TEXT DEFAULT 'good',
                field_id      TEXT,
                ts            TEXT NOT NULL,
                synced        INTEGER DEFAULT 0,
                sync_attempts INTEGER DEFAULT 0,
                battery_mv    INTEGER,
                rssi          INTEGER,
                created_at    TEXT DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_readings_synced
                ON readings(synced, ts);
            CREATE INDEX IF NOT EXISTS idx_readings_sensor
                ON readings(sensor_id, ts);
            CREATE INDEX IF NOT EXISTS idx_readings_type
                ON readings(sensor_type, ts);

            CREATE TABLE IF NOT EXISTS alerts (
                alert_id      TEXT PRIMARY KEY,
                alert_type    TEXT NOT NULL,
                severity      TEXT NOT NULL,
                sensor_id     TEXT,
                sensor_type   TEXT,
                value         REAL,
                threshold     REAL,
                message       TEXT NOT NULL,
                sent_sms      INTEGER DEFAULT 0,
                created_at    TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sync_log (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id      TEXT,
                status        TEXT NOT NULL,
                readings_count INTEGER,
                error         TEXT,
                created_at    TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS device_status (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                uptime_s      INTEGER,
                cpu_temp_c    REAL,
                memory_pct    REAL,
                disk_pct      REAL,
                wifi_signal   INTEGER,
                created_at    TEXT DEFAULT (datetime('now'))
            );
        """)

        self.conn.commit()

        # Cleanup old data (keep only buffer_days)
        await self.cleanup_old_data()

    async def insert_reading(self, reading: dict):
        """Insert a sensor reading into local buffer."""
        reading_id = reading.get('reading_id', str(uuid.uuid4()))
        self.conn.execute(
            """INSERT OR IGNORE INTO readings
               (reading_id, sensor_id, sensor_type, value, unit, quality,
                field_id, ts, battery_mv, rssi)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                reading_id,
                reading['sensor_id'],
                reading['sensor_type'],
                reading['value'],
                reading['unit'],
                reading.get('quality', 'good'),
                reading.get('field_id'),
                reading['ts'],
                reading.get('battery_mv'),
                reading.get('rssi'),
            )
        )
        self.conn.commit()

    async def insert_alert(self, alert: dict):
        """Insert a local alert."""
        self.conn.execute(
            """INSERT INTO alerts
               (alert_id, alert_type, severity, sensor_id, sensor_type,
                value, threshold, message)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                alert.get('alert_id', str(uuid.uuid4())),
                alert['alert_type'],
                alert['severity'],
                alert.get('sensor_id'),
                alert.get('sensor_type'),
                alert.get('value'),
                alert.get('threshold'),
                alert['message'],
            )
        )
        self.conn.commit()

    async def get_unsynced_readings(self, limit: int = 500) -> list[dict]:
        """Get readings that haven't been synced to cloud yet."""
        cursor = self.conn.execute(
            """SELECT * FROM readings
               WHERE synced = 0 AND sync_attempts < 3
               ORDER BY ts ASC
               LIMIT ?""",
            (limit,)
        )
        return [dict(row) for row in cursor.fetchall()]

    async def mark_synced(self, reading_ids: list[str]):
        """Mark readings as successfully synced."""
        if not reading_ids:
            return
        placeholders = ','.join('?' * len(reading_ids))
        self.conn.execute(
            f"UPDATE readings SET synced = 1 WHERE reading_id IN ({placeholders})",
            reading_ids
        )
        self.conn.commit()

    async def mark_sync_failed(self, reading_ids: list[str]):
        """Increment sync attempt counter for failed readings."""
        if not reading_ids:
            return
        placeholders = ','.join('?' * len(reading_ids))
        self.conn.execute(
            f"UPDATE readings SET sync_attempts = sync_attempts + 1 WHERE reading_id IN ({placeholders})",
            reading_ids
        )
        self.conn.commit()

    async def get_stats(self) -> dict:
        """Get database statistics."""
        stats = {}

        cursor = self.conn.execute("SELECT COUNT(*) FROM readings")
        stats['total_readings'] = cursor.fetchone()[0]

        cursor = self.conn.execute("SELECT COUNT(*) FROM readings WHERE synced = 0")
        stats['unsynced_readings'] = cursor.fetchone()[0]

        cursor = self.conn.execute("SELECT COUNT(*) FROM alerts WHERE created_at > datetime('now', '-24 hours')")
        stats['alerts_24h'] = cursor.fetchone()[0]

        cursor = self.conn.execute(
            """SELECT sensor_type, COUNT(*) as count,
                      MAX(value) as latest, MAX(ts) as last_ts
               FROM readings
               GROUP BY sensor_type"""
        )
        stats['sensors'] = [dict(row) for row in cursor.fetchall()]

        return stats

    async def get_recent_readings(self, sensor_type: str = None, limit: int = 100) -> list[dict]:
        """Get recent readings for web dashboard."""
        if sensor_type:
            cursor = self.conn.execute(
                "SELECT * FROM readings WHERE sensor_type = ? ORDER BY ts DESC LIMIT ?",
                (sensor_type, limit)
            )
        else:
            cursor = self.conn.execute(
                "SELECT * FROM readings ORDER BY ts DESC LIMIT ?",
                (limit,)
            )
        return [dict(row) for row in cursor.fetchall()]

    async def get_recent_alerts(self, limit: int = 50) -> list[dict]:
        """Get recent alerts."""
        cursor = self.conn.execute(
            "SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?",
            (limit,)
        )
        return [dict(row) for row in cursor.fetchall()]

    async def log_sync(self, batch_id: str, status: str, count: int, error: str = None):
        """Log a sync attempt."""
        self.conn.execute(
            "INSERT INTO sync_log (batch_id, status, readings_count, error) VALUES (?, ?, ?, ?)",
            (batch_id, status, count, error)
        )
        self.conn.commit()

    async def cleanup_old_data(self, days: int = 7):
        """Remove data older than buffer_days."""
        cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
        self.conn.execute("DELETE FROM readings WHERE ts < ? AND synced = 1", (cutoff,))
        self.conn.execute("DELETE FROM alerts WHERE created_at < ?", (cutoff,))
        self.conn.execute("DELETE FROM sync_log WHERE created_at < ?", (cutoff,))
        self.conn.commit()

    async def close(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
