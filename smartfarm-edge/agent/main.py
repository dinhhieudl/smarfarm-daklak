#!/usr/bin/env python3
"""
SmartFarm Edge Agent - Raspberry Pi Local Controller
=====================================================
Runs on RPi at each farm. Reads sensors, stores locally, syncs to cloud.

Architecture:
  Sensors (LoRa/GPIO) → Edge Agent → Local SQLite → MQTT/REST → Cloud

Features:
  - LoRa sensor reading via serial/GPIO
  - Local SQLite buffer (7 days)
  - MQTT primary sync with REST fallback
  - Local web dashboard (port 8080)
  - SMS alerts via local SIM (optional)
  - Offline-first: works without internet
"""

import asyncio
import signal
import sys
import time
import logging
from pathlib import Path

from agent.config import load_config
from agent.storage.local_db import LocalDatabase
from agent.sensors.lora_reader import LoRaReader
from agent.sync.mqtt_client import MQTTClient
from agent.sync.rest_client import RESTClient
from agent.sync.batch_uploader import BatchUploader
from agent.alerts.engine import AlertEngine
from agent.web.app import start_web_server

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/var/log/smartfarm/agent.log', mode='a'),
    ]
)
logger = logging.getLogger('smartfarm-edge')


class SmartFarmAgent:
    """Main edge agent orchestrator."""

    def __init__(self, config_path: str = None):
        self.config = load_config(config_path)
        self.running = False
        self.db = None
        self.lora = None
        self.mqtt = None
        self.rest = None
        self.uploader = None
        self.alert_engine = None

    async def start(self):
        """Initialize and start all components."""
        logger.info(f"Starting SmartFarm Edge Agent for farm: {self.config.farm_id}")
        self.running = True

        # 1. Local database
        self.db = LocalDatabase(self.config.db_path)
        await self.db.initialize()
        logger.info("Local database initialized")

        # 2. Alert engine (local threshold checking)
        self.alert_engine = AlertEngine(self.config, self.db)

        # 3. Sensor reader (LoRa)
        self.lora = LoRaReader(self.config, self.on_sensor_reading)
        await self.lora.start()
        logger.info(f"LoRa reader started on {self.config.lora_port}")

        # 4. MQTT client (primary sync)
        self.mqtt = MQTTClient(self.config, self.db)
        try:
            await self.mqtt.connect()
            logger.info("MQTT connected")
        except Exception as e:
            logger.warning(f"MQTT connection failed: {e}. Will use REST fallback.")

        # 5. REST client (fallback sync)
        self.rest = RESTClient(self.config)

        # 6. Batch uploader
        self.uploader = BatchUploader(self.config, self.db, self.mqtt, self.rest)
        asyncio.create_task(self.uploader.run_periodic())
        logger.info(f"Batch uploader started (interval: {self.config.sync_interval}s)")

        # 7. Local web dashboard
        await start_web_server(self.config, self.db, port=self.config.web_port)
        logger.info(f"Web dashboard: http://localhost:{self.config.web_port}")

        logger.info("SmartFarm Edge Agent fully started")

        # Keep running
        while self.running:
            await asyncio.sleep(1)

    async def on_sensor_reading(self, reading: dict):
        """Callback when a new sensor reading arrives."""
        # Validate
        reading = self.validate_reading(reading)
        if reading is None:
            return

        # Store locally
        await self.db.insert_reading(reading)

        # Check local alerts
        alert = await self.alert_engine.check(reading)
        if alert:
            logger.warning(f"Alert triggered: {alert['message']}")
            await self.db.insert_alert(alert)
            # Send SMS if configured
            if self.config.sms_enabled:
                await self.alert_engine.send_sms(alert)

        # Log periodically
        if reading.get('_log', False):
            logger.info(
                f"Reading: sensor={reading['sensor_type']} "
                f"value={reading['value']}{reading['unit']} "
                f"quality={reading['quality']}"
            )

    def validate_reading(self, reading: dict) -> dict | None:
        """Validate and enrich a sensor reading."""
        from agent.sensors.validator import validate
        return validate(reading, self.config.farm_id)

    async def stop(self):
        """Graceful shutdown."""
        logger.info("Shutting down SmartFarm Edge Agent...")
        self.running = False

        if self.uploader:
            self.uploader.stop()
        if self.mqtt:
            await self.mqtt.disconnect()
        if self.lora:
            await self.lora.stop()
        if self.db:
            await self.db.close()

        logger.info("Shutdown complete")


async def main():
    config_path = sys.argv[1] if len(sys.argv) > 1 else None
    agent = SmartFarmAgent(config_path)

    # Handle signals
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(agent.stop()))

    try:
        await agent.start()
    except KeyboardInterrupt:
        await agent.stop()
    except Exception as e:
        logger.exception(f"Fatal error: {e}")
        await agent.stop()
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
