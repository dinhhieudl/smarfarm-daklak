"""
SmartFarm Edge Agent - REST API Client (Fallback sync channel)
Used when MQTT broker is unreachable.
"""

import json
import logging
from datetime import datetime, timezone

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

try:
    import urllib.request
    import urllib.error
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = True  # always available

logger = logging.getLogger('smartfarm-edge.rest')


class RESTClient:
    """REST API client for cloud sync fallback."""

    def __init__(self, config):
        self.config = config
        self.base_url = config.cloud_api_url.rstrip('/')
        self.api_key = config.cloud_api_key
        self.timeout = 30

    async def upload_batch(self, readings: list[dict]) -> dict:
        """
        Upload a batch of readings via REST API.
        POST /api/v1/sensors/ingest
        """
        payload = {
            "device_eui": self.config.device_id,
            "garden_id": self.config.farm_id,
            "readings": [
                {
                    "zone_id": r.get('field_id', 'default'),
                    "sensor_type": r['sensor_type'],
                    "value": r['value'],
                    "unit": r['unit'],
                    "quality": r.get('quality', 'good'),
                    "timestamp": r['ts'],
                    "battery_voltage": r.get('battery_mv'),
                    "rssi": r.get('rssi'),
                }
                for r in readings
            ]
        }

        url = f"{self.base_url}/sensors/ingest"
        headers = {
            'X-API-Key': self.api_key,
            'Content-Type': 'application/json',
        }

        try:
            if HAS_HTTPX:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                    resp.raise_for_status()
                    data = resp.json()
                    logger.info(f"REST upload OK: {data.get('total_inserted', 0)} readings")
                    return {'success': True, 'data': data}
            else:
                # Fallback to urllib (blocking, but works without httpx)
                req = urllib.request.Request(
                    url,
                    data=json.dumps(payload).encode(),
                    headers=headers,
                    method='POST'
                )
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    data = json.loads(resp.read())
                    logger.info(f"REST upload OK: {data.get('total_inserted', 0)} readings")
                    return {'success': True, 'data': data}

        except Exception as e:
            logger.error(f"REST upload failed: {e}")
            return {'success': False, 'error': str(e)}

    async def check_health(self) -> bool:
        """Check if cloud API is reachable."""
        try:
            url = f"{self.base_url.replace('/api/v1', '')}/health"
            if HAS_HTTPX:
                async with httpx.AsyncClient(timeout=5) as client:
                    resp = await client.get(url)
                    return resp.status_code == 200
            else:
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    return resp.status_code == 200
        except Exception:
            return False
