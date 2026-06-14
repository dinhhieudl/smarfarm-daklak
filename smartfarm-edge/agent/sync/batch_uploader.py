"""
SmartFarm Edge Agent - Batch Uploader
Periodically reads unsynced data from local DB and uploads to cloud.
"""

import asyncio
import uuid
import logging
from datetime import datetime, timezone

logger = logging.getLogger('smartfarm-edge.uploader')


class BatchUploader:
    """Periodically syncs local data to cloud via MQTT (primary) or REST (fallback)."""

    def __init__(self, config, db, mqtt_client, rest_client):
        self.config = config
        self.db = db
        self.mqtt = mqtt_client
        self.rest = rest_client
        self._running = False
        self._task = None

    async def run_periodic(self):
        """Run sync loop at configured interval."""
        self._running = True
        logger.info(f"Batch uploader started (interval: {self.config.sync_interval}s)")

        while self._running:
            try:
                await self.sync_cycle()
            except Exception as e:
                logger.error(f"Sync cycle error: {e}")

            await asyncio.sleep(self.config.sync_interval)

    def stop(self):
        """Stop the upload loop."""
        self._running = False

    async def sync_cycle(self):
        """Execute one sync cycle: read unsynced → upload → mark synced."""
        # 1. Get unsynced readings
        readings = await self.db.get_unsynced_readings(self.config.sync_batch_size)
        if not readings:
            logger.debug("No unsynced readings")
            return

        logger.info(f"Syncing {len(readings)} readings...")

        # 2. Try MQTT first
        success = False
        if self.mqtt and self.mqtt.connected:
            success = await self.mqtt.publish_batch(readings)
            if success:
                await self.db.log_sync(
                    batch_id=str(uuid.uuid4()),
                    status='mqtt_ok',
                    count=len(readings)
                )

        # 3. Fallback to REST if MQTT failed
        if not success:
            logger.info("MQTT unavailable, falling back to REST API")
            result = await self.rest.upload_batch(readings)
            success = result.get('success', False)

            if success:
                await self.db.log_sync(
                    batch_id=str(uuid.uuid4()),
                    status='rest_ok',
                    count=len(readings)
                )
            else:
                await self.db.log_sync(
                    batch_id=str(uuid.uuid4()),
                    status='failed',
                    count=len(readings),
                    error=result.get('error', 'Unknown error')
                )

        # 4. Update sync status
        reading_ids = [r['reading_id'] for r in readings]
        if success:
            await self.db.mark_synced(reading_ids)
            logger.info(f"Successfully synced {len(readings)} readings")
        else:
            await self.db.mark_sync_failed(reading_ids)
            logger.warning(f"Failed to sync {len(readings)} readings")

    async def force_sync(self):
        """Trigger an immediate sync cycle."""
        logger.info("Force sync triggered")
        await self.sync_cycle()
