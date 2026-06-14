"""
AgriTech Sensor Data Ingestion Pipeline
MQTT → Kafka → TimescaleDB

Handles data from hundreds of coffee farms across DakLak, Vietnam.
Each farm has multiple zones, each zone has 6 soil sensors reporting every 5 minutes.
"""

import json
import logging
import os
import signal
import sys
import uuid
from datetime import datetime, timezone
from typing import Optional

import paho.mqtt.client as mqtt
from confluent_kafka import Producer
from pydantic import BaseModel, Field, validator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("ingestion")

# ============================================================
# Configuration
# ============================================================

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "farms/+/zones/+/sensors/+")
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")

KAFKA_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "sensor-raw")
KAFKA_DLQ_TOPIC = os.getenv("KAFKA_DLQ_TOPIC", "sensor-dlq")  # Dead letter queue


# ============================================================
# Data Models
# ============================================================

class SensorReading(BaseModel):
    """Incoming sensor reading from MQTT payload."""
    sensor_id: str
    farm_id: str
    zone_id: str
    sensor_type: str
    reading_value: float
    timestamp: Optional[datetime] = None
    quality_flag: int = Field(default=0, ge=0, le=3)
    battery_level: Optional[float] = Field(default=None, ge=0, le=100)
    signal_strength: Optional[float] = None
    metadata: dict = Field(default_factory=dict)

    @validator("sensor_type")
    def validate_sensor_type(cls, v):
        valid_types = {
            "soil_temperature", "soil_moisture", "ec",
            "nitrogen", "phosphorus", "potassium", "ph", "salinity",
        }
        if v not in valid_types:
            raise ValueError(f"Invalid sensor_type: {v}. Must be one of {valid_types}")
        return v

    @validator("timestamp", pre=True, always=True)
    def set_timestamp(cls, v):
        return v or datetime.now(timezone.utc)

    def to_kafka_message(self) -> bytes:
        """Serialize to JSON for Kafka."""
        return self.json().encode("utf-8")


# ============================================================
# MQTT → Kafka Bridge
# ============================================================

class SensorIngestionPipeline:
    """
    Bridges MQTT sensor data to Kafka for durable processing.
    
    MQTT topic pattern: farms/{farm_id}/zones/{zone_id}/sensors/{sensor_type}
    Payload: JSON with reading_value, timestamp, battery_level, etc.
    """

    def __init__(self):
        self.producer = Producer({
            "bootstrap.servers": KAFKA_BOOTSTRAP,
            "acks": "all",
            "retries": 3,
            "linger.ms": 50,  # Batch small messages
            "compression.type": "snappy",
            "enable.idempotence": True,
        })
        self.mqtt_client = mqtt.Client(
            client_id=f"agritech-ingestion-{uuid.uuid4().hex[:8]}",
            clean_session=True,
        )
        if MQTT_USERNAME:
            self.mqtt_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)

        self.mqtt_client.on_connect = self._on_connect
        self.mqtt_client.on_message = self._on_message
        self.mqtt_client.on_disconnect = self._on_disconnect

        self._running = True
        self._message_count = 0
        self._error_count = 0

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            logger.info("Connected to MQTT broker, subscribing to %s", MQTT_TOPIC)
            client.subscribe(MQTT_TOPIC, qos=1)
        else:
            logger.error("MQTT connection failed with code %d", rc)

    def _on_disconnect(self, client, userdata, rc):
        if rc != 0:
            logger.warning("Unexpected MQTT disconnect (rc=%d), will auto-reconnect", rc)

    def _on_message(self, client, userdata, msg):
        """Process incoming MQTT message and forward to Kafka."""
        try:
            # Parse topic: farms/{farm_id}/zones/{zone_id}/sensors/{sensor_type}
            parts = msg.topic.split("/")
            if len(parts) != 6:
                logger.warning("Malformed topic: %s", msg.topic)
                return

            farm_id = parts[1]
            zone_id = parts[3]
            sensor_type = parts[5]

            # Parse payload
            payload = json.loads(msg.payload)
            payload.update({
                "farm_id": farm_id,
                "zone_id": zone_id,
                "sensor_type": sensor_type,
            })

            # Infer sensor_id from zone + type if not provided
            if "sensor_id" not in payload:
                payload["sensor_id"] = str(uuid.uuid5(
                    uuid.NAMESPACE_DNS,
                    f"{zone_id}:{sensor_type}"
                ))

            reading = SensorReading(**payload)

            # Validate ranges (soft validation, flag but don't reject)
            reading = self._quality_check(reading)

            # Produce to Kafka
            self.producer.produce(
                topic=KAFKA_TOPIC,
                key=reading.farm_id.encode("utf-8"),  # Partition by farm_id
                value=reading.to_kafka_message(),
                timestamp=int(reading.timestamp.timestamp() * 1000),
                callback=self._delivery_callback,
            )
            self.producer.poll(0)  # Trigger callbacks

            self._message_count += 1
            if self._message_count % 10000 == 0:
                logger.info("Processed %d messages", self._message_count)

        except Exception as e:
            logger.error("Failed to process message on %s: %s", msg.topic, e)
            self._error_count += 1
            # Send to dead letter queue
            self._send_to_dlq(msg.topic, msg.payload, str(e))

    def _quality_check(self, reading: SensorReading) -> SensorReading:
        """Apply soft quality checks and flag suspicious readings."""
        range_checks = {
            "soil_moisture": (0, 100),
            "soil_temperature": (-10, 60),
            "ph": (2, 12),
            "ec": (0, 20),
            "nitrogen": (0, 1000),
            "phosphorus": (0, 500),
            "potassium": (0, 1000),
            "salinity": (0, 20),
        }

        if reading.sensor_type in range_checks:
            min_val, max_val = range_checks[reading.sensor_type]
            if not (min_val <= reading.reading_value <= max_val):
                reading.quality_flag = 2  # bad
                logger.warning(
                    "Out-of-range reading: %s = %f (expected %f-%f) for sensor %s",
                    reading.sensor_type, reading.reading_value,
                    min_val, max_val, reading.sensor_id,
                )
            elif reading.battery_level is not None and reading.battery_level < 15:
                reading.quality_flag = 1  # suspect (low battery)

        return reading

    def _delivery_callback(self, err, msg):
        if err:
            logger.error("Kafka delivery failed: %s", err)
            self._error_count += 1

    def _send_to_dlq(self, topic: str, payload: bytes, error: str):
        """Send failed messages to dead letter queue for later analysis."""
        dlq_message = json.dumps({
            "original_topic": topic,
            "original_payload": payload.decode("utf-8", errors="replace"),
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).encode("utf-8")
        self.producer.produce(KAFKA_DLQ_TOPIC, value=dlq_message)

    def start(self):
        """Start the ingestion pipeline."""
        logger.info("Starting AgriTech ingestion pipeline...")
        logger.info("MQTT: %s:%d → Kafka: %s", MQTT_BROKER, MQTT_PORT, KAFKA_TOPIC)

        def shutdown(signum, frame):
            logger.info("Shutting down...")
            self._running = False
            self.mqtt_client.disconnect()
            self.producer.flush(timeout=10)

        signal.signal(signal.SIGINT, shutdown)
        signal.signal(signal.SIGTERM, shutdown)

        self.mqtt_client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        self.mqtt_client.loop_forever()


# ============================================================
# Alternative: HTTP Ingestion Endpoint
# ============================================================

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse

http_app = FastAPI(title="Sensor Ingestion API")


@http_app.post("/v1/readings")
async def ingest_reading(reading: SensorReading, background_tasks: BackgroundTasks):
    """
    Accept sensor readings via HTTP POST.
    For devices that can't use MQTT (e.g., GSM-based sensors).
    """
    # Validate and quality-check
    try:
        reading = SensorIngestionPipeline._quality_check(None, reading)
    except Exception:
        pass  # Pipeline instance not needed for static method

    # Async produce to Kafka
    background_tasks.add_task(_produce_to_kafka, reading)

    return JSONResponse(
        status_code=202,
        content={"status": "accepted", "sensor_id": reading.sensor_id},
    )


@http_app.post("/v1/readings/batch")
async def ingest_batch(readings: list[SensorReading], background_tasks: BackgroundTasks):
    """Batch ingestion for periodic bulk uploads."""
    if len(readings) > 10000:
        raise HTTPException(400, "Batch size exceeds maximum of 10,000")

    background_tasks.add_task(_produce_batch_to_kafka, readings)

    return JSONResponse(
        status_code=202,
        content={"status": "accepted", "count": len(readings)},
    )


async def _produce_to_kafka(reading: SensorReading):
    """Produce a single reading to Kafka (background task)."""
    producer = Producer({"bootstrap.servers": KAFKA_BOOTSTRAP})
    producer.produce(
        KAFKA_TOPIC,
        key=reading.farm_id.encode("utf-8"),
        value=reading.to_kafka_message(),
    )
    producer.flush(timeout=5)


async def _produce_batch_to_kafka(readings: list[SensorReading]):
    """Produce a batch to Kafka (background task)."""
    producer = Producer({
        "bootstrap.servers": KAFKA_BOOTSTRAP,
        "linger.ms": 100,
        "compression.type": "snappy",
    })
    for reading in readings:
        producer.produce(
            KAFKA_TOPIC,
            key=reading.farm_id.encode("utf-8"),
            value=reading.to_kafka_message(),
        )
    producer.flush(timeout=30)


# ============================================================
# Entry Point
# ============================================================

if __name__ == "__main__":
    if "--http" in sys.argv:
        import uvicorn
        uvicorn.run(http_app, host="0.0.0.0", port=8000)
    else:
        pipeline = SensorIngestionPipeline()
        pipeline.start()
