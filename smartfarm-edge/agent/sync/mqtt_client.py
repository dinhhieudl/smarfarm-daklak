"""
SmartFarm Edge Agent - MQTT Client
Primary sync channel to cloud. Publishes telemetry in framework format.
"""

import json
import asyncio
import uuid
from datetime import datetime, timezone
import logging

try:
    import aiomqtt
    HAS_AIOMQTT = True
except ImportError:
    HAS_AIOMQTT = False

try:
    import paho.mqtt.client as paho
    HAS_PAHO = True
except ImportError:
    HAS_PAHO = False

logger = logging.getLogger('smartfarm-edge.mqtt')


class MQTTClient:
    """MQTT client for publishing telemetry to cloud broker."""

    def __init__(self, config, db):
        self.config = config
        self.db = db
        self.client = None
        self.connected = False
        self._use_paho = HAS_PAOMQTT if HAS_AIOMQTT else HAS_PAHO

    async def connect(self):
        """Connect to MQTT broker."""
        if not HAS_AIOMQTT and not HAS_PAHO:
            logger.warning("No MQTT library installed. Using REST fallback only.")
            return

        try:
            if HAS_PAHO:
                self._connect_paho()
            else:
                await self._connect_aiomqtt()
        except Exception as e:
            logger.error(f"MQTT connect failed: {e}")
            self.connected = False
            raise

    def _connect_paho(self):
        """Connect using paho-mqtt (synchronous wrapper)."""
        self.client = paho.Client(
            client_id=f"edge-{self.config.device_id}-{uuid.uuid4().hex[:8]}",
            clean_session=True,
        )

        if self.config.mqtt_username:
            self.client.username_pw_set(
                self.config.mqtt_username,
                self.config.mqtt_password
            )

        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect

        # Parse broker URL
        broker = self.config.mqtt_broker.replace('mqtt://', '').replace('mqtts://', '')
        host, port = broker.split(':') if ':' in broker else (broker, 1883)

        self.client.connect(host, int(port), keepalive=60)
        self.client.loop_start()
        self.connected = True

    async def _connect_aiomqtt(self):
        """Connect using aiomqtt (async)."""
        broker = self.config.mqtt_broker.replace('mqtt://', '').replace('mqtts://', '')
        host, port = broker.split(':') if ':' in broker else (broker, 1883)

        self.client = aiomqtt.Client(
            hostname=host,
            port=int(port),
            username=self.config.mqtt_username or None,
            password=self.config.mqtt_password or None,
            identifier=f"edge-{self.config.device_id}-{uuid.uuid4().hex[:8]}",
        )
        await self.client.connect()
        self.connected = True

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            logger.info("MQTT connected (paho)")
            self.connected = True
        else:
            logger.error(f"MQTT connect failed with code {rc}")

    def _on_disconnect(self, client, userdata, rc):
        logger.warning(f"MQTT disconnected (rc={rc})")
        self.connected = False

    async def publish_batch(self, readings: list[dict]) -> bool:
        """
        Publish a batch of readings in the framework format.

        Topic: smartfarm/{farm_id}/telemetry/batch
        Payload:
        {
            "batch_id": "uuid",
            "farm_id": "farm_001",
            "device_id": "rpi_001",
            "readings": [
                {
                    "reading_id": "uuid",
                    "sensor_id": "soil_01",
                    "sensor_type": "soil_moisture",
                    "value": 42.5,
                    "unit": "%",
                    "quality": "good",
                    "ts": "2026-06-14T02:30:00Z"
                }
            ],
            "meta": {
                "rpi_uptime_s": 86400,
                "signal_rssi": -75,
                "firmware_version": "1.0.0"
            }
        }
        """
        if not self.connected:
            return False

        batch_id = str(uuid.uuid4())
        topic = f"smartfarm/{self.config.farm_id}/telemetry/batch"

        payload = {
            "batch_id": batch_id,
            "farm_id": self.config.farm_id,
            "device_id": self.config.device_id,
            "readings": [
                {
                    "reading_id": r.get('reading_id', str(uuid.uuid4())),
                    "sensor_id": r.get('sensor_id', ''),
                    "sensor_type": r['sensor_type'],
                    "value": r['value'],
                    "unit": r['unit'],
                    "quality": r.get('quality', 'good'),
                    "field_id": r.get('field_id'),
                    "ts": r['ts'],
                }
                for r in readings
            ],
            "meta": {
                "batch_id": batch_id,
                "firmware_version": "1.0.0",
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        }

        try:
            message = json.dumps(payload)

            if HAS_PAHO and hasattr(self.client, 'publish'):
                result = self.client.publish(topic, message, qos=1)
                success = result.rc == 0
            elif HAS_AIOMQTT and hasattr(self.client, 'publish'):
                await self.client.publish(topic, message, qos=1)
                success = True
            else:
                success = False

            if success:
                logger.info(f"Published batch {batch_id} ({len(readings)} readings) to {topic}")
            else:
                logger.error(f"Failed to publish batch {batch_id}")

            return success

        except Exception as e:
            logger.error(f"MQTT publish error: {e}")
            self.connected = False
            return False

    async def publish_status(self, status: dict):
        """Publish device status."""
        if not self.connected:
            return

        topic = f"smartfarm/{self.config.farm_id}/status/{self.config.device_id}"
        try:
            message = json.dumps(status)
            if HAS_PAHO and hasattr(self.client, 'publish'):
                self.client.publish(topic, message, qos=0)
        except Exception as e:
            logger.error(f"Status publish error: {e}")

    async def disconnect(self):
        """Disconnect from MQTT broker."""
        try:
            if self.client:
                if HAS_PAHO and hasattr(self.client, 'loop_stop'):
                    self.client.loop_stop()
                    self.client.disconnect()
                elif HAS_AIOMQTT and hasattr(self.client, 'disconnect'):
                    await self.client.disconnect()
            self.connected = False
            logger.info("MQTT disconnected")
        except Exception as e:
            logger.error(f"MQTT disconnect error: {e}")
