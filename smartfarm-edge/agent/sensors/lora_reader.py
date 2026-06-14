"""
SmartFarm Edge Agent - LoRa Sensor Reader
Reads sensor data from LoRa modules via serial/GPIO.
Supports common LoRa protocols and raw serial data.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger('smartfarm-edge.lora')


class LoRaReader:
    """Reads sensor data from LoRa modules."""

    def __init__(self, config, callback):
        self.config = config
        self.callback = callback
        self.running = False
        self.serial_conn = None

    async def start(self):
        """Start reading from LoRa serial port."""
        self.running = True

        try:
            import serial
            self.serial_conn = serial.Serial(
                port=self.config.lora_port,
                baudrate=self.config.lora_baud,
                timeout=1
            )
            logger.info(f"LoRa serial opened: {self.config.lora_port}")

            # Start reading loop
            asyncio.create_task(self._read_loop())

        except ImportError:
            logger.warning("pyserial not installed. LoRa reader disabled.")
            logger.info("Install with: pip install pyserial")
            # Start mock reader for development
            asyncio.create_task(self._mock_read_loop())

        except Exception as e:
            logger.error(f"LoRa init failed: {e}")
            logger.info("Starting mock reader for development")
            asyncio.create_task(self._mock_read_loop())

    async def _read_loop(self):
        """Read and parse LoRa packets from serial."""
        import serial

        buffer = b''
        while self.running:
            try:
                if self.serial_conn and self.serial_conn.in_waiting:
                    data = self.serial_conn.read(self.serial_conn.in_waiting)
                    buffer += data

                    # Try to parse complete lines
                    while b'\n' in buffer:
                        line, buffer = buffer.split(b'\n', 1)
                        line = line.decode('utf-8', errors='ignore').strip()
                        if line:
                            reading = self._parse_line(line)
                            if reading:
                                await self.callback(reading)

                await asyncio.sleep(0.1)

            except Exception as e:
                logger.error(f"LoRa read error: {e}")
                await asyncio.sleep(1)

    def _parse_line(self, line: str) -> dict | None:
        """
        Parse a LoRa serial line into a sensor reading.
        Supports multiple formats:
          - JSON: {"sensor_id":"soil_01","type":"soil_moisture","value":42.5}
          - CSV: soil_01,soil_moisture,42.5,%,0x01
          - Custom: ADDR:01 TYPE:moisture VAL:42.5
        """
        try:
            # Try JSON first
            if line.startswith('{'):
                data = json.loads(line)
                return {
                    'sensor_id': data.get('sensor_id', data.get('id', '')),
                    'sensor_type': data.get('type', data.get('sensor_type', '')),
                    'value': float(data.get('value', data.get('val', 0))),
                    'unit': data.get('unit', ''),
                    'ts': data.get('ts', datetime.now(timezone.utc).isoformat()),
                    'battery_mv': data.get('battery'),
                    'rssi': data.get('rssi'),
                    'field_id': data.get('field'),
                }

            # Try CSV
            parts = line.split(',')
            if len(parts) >= 4:
                return {
                    'sensor_id': parts[0].strip(),
                    'sensor_type': parts[1].strip(),
                    'value': float(parts[2].strip()),
                    'unit': parts[3].strip(),
                    'ts': datetime.now(timezone.utc).isoformat(),
                    'field_id': parts[4].strip() if len(parts) > 4 else None,
                }

            # Try key-value
            if 'TYPE:' in line or 'VAL:' in line:
                kv = {}
                for part in line.split():
                    if ':' in part:
                        k, v = part.split(':', 1)
                        kv[k.upper()] = v

                return {
                    'sensor_id': f"lora_{kv.get('ADDR', '00')}",
                    'sensor_type': kv.get('TYPE', ''),
                    'value': float(kv.get('VAL', 0)),
                    'unit': kv.get('UNIT', ''),
                    'ts': datetime.now(timezone.utc).isoformat(),
                }

            logger.debug(f"Unparseable line: {line}")
            return None

        except (ValueError, json.JSONDecodeError, KeyError) as e:
            logger.debug(f"Parse error for line '{line}': {e}")
            return None

    async def _mock_read_loop(self):
        """Mock sensor reader for development/testing."""
        import random
        import math

        logger.info("Mock sensor reader started (for development)")

        sensor_types = [
            ('soil_moisture', '%', 45, 15),
            ('soil_temperature', '°C', 25, 5),
            ('air_temperature', '°C', 28, 6),
            ('air_humidity', '%', 70, 15),
            ('rainfall', 'mm', 0, 2),
            ('soil_ph', 'pH', 6.2, 0.5),
        ]

        cycle = 0
        while self.running:
            cycle += 1
            hour_of_day = (cycle % 144) * 10 / 60  # simulate day cycle

            for i, (sensor_type, unit, base, amplitude) in enumerate(sensor_types):
                # Add daily cycle (peaks at noon)
                daily_factor = math.sin((hour_of_day - 6) * math.pi / 12)
                noise = random.gauss(0, amplitude * 0.1)
                value = base + daily_factor * amplitude * 0.3 + noise

                # Special: rainfall is usually 0, occasionally spikes
                if sensor_type == 'rainfall':
                    value = max(0, random.gauss(0, 3) if random.random() < 0.05 else 0)

                reading = {
                    'sensor_id': f"mock_{sensor_type}_{i:02d}",
                    'sensor_type': sensor_type,
                    'value': round(value, 2),
                    'unit': unit,
                    'ts': datetime.now(timezone.utc).isoformat(),
                    'field_id': f"field_{(i % 2) + 1}",
                    'quality': 'good',
                }

                await self.callback(reading)

            # Read every 10 minutes (600 seconds), but for mock: every 30 seconds
            await asyncio.sleep(30)

    async def stop(self):
        """Stop the reader."""
        self.running = False
        if self.serial_conn:
            try:
                self.serial_conn.close()
            except Exception:
                pass
        logger.info("LoRa reader stopped")
