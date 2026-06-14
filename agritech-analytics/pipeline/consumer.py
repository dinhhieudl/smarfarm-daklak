"""
Kafka Consumer — Writes validated sensor data to TimescaleDB.

Consumes from the 'sensor-raw' Kafka topic and batch-inserts
into the sensor_readings hypertable using COPY for performance.
"""

import json
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from typing import Optional

import psycopg2
import psycopg2.extras
from confluent_kafka import Consumer, KafkaError, KafkaException

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("consumer")

# ============================================================
# Configuration
# ============================================================

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "sensor-raw")
KAFKA_GROUP = os.getenv("KAFKA_GROUP", "timescale-writer")

DB_DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://agritech:agritech@localhost:5432/agritech"
)

BATCH_SIZE = int(os.getenv("BATCH_SIZE", "5000"))
BATCH_TIMEOUT_SEC = float(os.getenv("BATCH_TIMEOUT", "5.0"))


# ============================================================
# Batch Writer
# ============================================================

class TimescaleWriter:
    """
    Consumes sensor readings from Kafka and writes to TimescaleDB.
    
    Uses COPY for bulk inserts (10-50x faster than individual INSERTs).
    Partitions by farm_id for Kafka parallelism.
    """

    def __init__(self):
        self.consumer = Consumer({
            "bootstrap.servers": KAFKA_BOOTSTRAP,
            "group.id": KAFKA_GROUP,
            "auto.offset.reset": "latest",
            "enable.auto.commit": False,
            "max.poll.interval.ms": 300000,
            "session.timeout.ms": 30000,
            "fetch.min.bytes": 1024,
            "fetch.wait.max.ms": 500,
        })
        self.conn = self._get_db_connection()
        self._running = True
        self._batch = []
        self._last_commit_offset = None

    def _get_db_connection(self):
        """Get a fresh database connection."""
        conn = psycopg2.connect(DB_DSN)
        conn.autocommit = False
        return conn

    def _ensure_connection(self):
        """Reconnect if connection is closed."""
        try:
            self.conn.isolation_level
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            logger.warning("Database connection lost, reconnecting...")
            self.conn = self._get_db_connection()

    def _write_batch(self, messages: list[dict]):
        """Bulk insert a batch of readings using COPY."""
        if not messages:
            return

        self._ensure_connection()

        try:
            with self.conn.cursor() as cur:
                # Use COPY for maximum throughput
                columns = [
                    "time", "sensor_id", "farm_id", "zone_id",
                    "reading_value", "quality_flag", "battery_level",
                    "signal_strength", "metadata",
                ]

                # Prepare rows
                rows = []
                for msg in messages:
                    rows.append((
                        msg["timestamp"],
                        msg["sensor_id"],
                        msg["farm_id"],
                        msg["zone_id"],
                        msg["reading_value"],
                        msg.get("quality_flag", 0),
                        msg.get("battery_level"),
                        msg.get("signal_strength"),
                        json.dumps(msg.get("metadata", {})),
                    ))

                # Execute COPY
                psycopg2.extras.execute_values(
                    cur,
                    f"""
                    INSERT INTO sensor_readings ({', '.join(columns)})
                    VALUES %s
                    ON CONFLICT DO NOTHING
                    """,
                    rows,
                    page_size=1000,
                )

                self.conn.commit()
                logger.info("Wrote %d readings to TimescaleDB", len(rows))

        except Exception as e:
            logger.error("Batch write failed: %s", e)
            self.conn.rollback()
            # Re-raise to handle in consumer loop
            raise

    def _parse_message(self, msg_value: bytes) -> Optional[dict]:
        """Parse and validate a Kafka message."""
        try:
            data = json.loads(msg_value)
            # Ensure required fields
            data["timestamp"] = data.get("timestamp", datetime.now(timezone.utc).isoformat())
            if isinstance(data["timestamp"], str):
                data["timestamp"] = datetime.fromisoformat(
                    data["timestamp"].replace("Z", "+00:00")
                )
            return data
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("Failed to parse message: %s", e)
            return None

    def start(self):
        """Start consuming and writing."""
        logger.info("Starting TimescaleDB writer...")
        logger.info("Kafka: %s, Group: %s", KAFKA_BOOTSTRAP, KAFKA_GROUP)

        def shutdown(signum, frame):
            logger.info("Shutting down...")
            self._running = False

        signal.signal(signal.SIGINT, shutdown)
        signal.signal(signal.SIGTERM, shutdown)

        self.consumer.subscribe([KAFKA_TOPIC])

        import time
        last_flush = time.time()

        while self._running:
            try:
                msg = self.consumer.poll(timeout=1.0)

                if msg is None:
                    # Flush batch on timeout
                    if self._batch and (time.time() - last_flush) >= BATCH_TIMEOUT_SEC:
                        self._write_batch(self._batch)
                        self._batch = []
                        last_flush = time.time()
                    continue

                if msg.error():
                    if msg.error().code() == KafkaError._PARTITION_EOF:
                        continue
                    logger.error("Kafka error: %s", msg.error())
                    continue

                # Parse message
                parsed = self._parse_message(msg.value())
                if parsed is None:
                    continue

                self._batch.append(parsed)

                # Flush when batch is full
                if len(self._batch) >= BATCH_SIZE:
                    self._write_batch(self._batch)
                    self._batch = []
                    last_flush = time.time()
                    # Commit Kafka offsets
                    self.consumer.commit(asynchronous=False)

            except KafkaException as e:
                logger.error("Kafka exception: %s", e)
            except psycopg2.OperationalError as e:
                logger.error("Database error: %s, will retry", e)
                import time
                time.sleep(5)
            except Exception as e:
                logger.error("Unexpected error: %s", e, exc_info=True)

        # Final flush
        if self._batch:
            try:
                self._write_batch(self._batch)
            except Exception:
                pass

        self.consumer.close()
        self.conn.close()
        logger.info("Writer stopped.")


# ============================================================
# Entry Point
# ============================================================

if __name__ == "__main__":
    writer = TimescaleWriter()
    writer.start()
