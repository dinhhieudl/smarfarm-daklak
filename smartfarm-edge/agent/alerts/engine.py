"""
SmartFarm Edge Agent - Local Alert Engine
Evaluates sensor readings against thresholds locally (no cloud needed).
Sends SMS alerts when thresholds are breached.
"""

import uuid
import logging
from datetime import datetime, timezone

logger = logging.getLogger('smartfarm-edge.alerts')

# Default thresholds for coffee farming in DakLak
DEFAULT_THRESHOLDS = {
    'soil_moisture': {'min': 20, 'max': 85, 'severity': 'warning'},
    'soil_temperature': {'min': 10, 'max': 40, 'severity': 'warning'},
    'air_temperature': {'min': 10, 'max': 38, 'severity': 'warning'},
    'air_humidity': {'min': 30, 'max': 95, 'severity': 'info'},
    'rainfall': {'min': None, 'max': 100, 'severity': 'warning'},  # heavy rain
    'soil_ph': {'min': 5.0, 'max': 7.0, 'severity': 'warning'},
    'soil_ec': {'min': 0.3, 'max': 4.0, 'severity': 'info'},
}


class AlertEngine:
    """Local alert evaluation engine."""

    def __init__(self, config, db):
        self.config = config
        self.db = db
        self.thresholds = {**DEFAULT_THRESHOLDS, **(config.alert_thresholds or {})}
        self._cooldown = {}  # sensor_type -> last_alert_ts
        self._cooldown_seconds = 1800  # 30 minutes

    async def check(self, reading: dict) -> dict | None:
        """
        Check a reading against thresholds.
        Returns alert dict if threshold breached, None otherwise.
        """
        sensor_type = reading.get('sensor_type', '')
        value = reading.get('value')
        if value is None:
            return None

        threshold = self.thresholds.get(sensor_type)
        if not threshold:
            return None

        # Check cooldown
        now = datetime.now(timezone.utc).isoformat()
        last_alert = self._cooldown.get(sensor_type)
        if last_alert:
            from datetime import datetime as dt
            try:
                last_dt = dt.fromisoformat(last_alert)
                if (dt.now(timezone.utc) - last_dt).total_seconds() < self._cooldown_seconds:
                    return None
            except (ValueError, TypeError):
                pass

        # Check thresholds
        breached = False
        direction = ''

        if threshold.get('min') is not None and value < threshold['min']:
            breached = True
            direction = 'below minimum'
        if threshold.get('max') is not None and value > threshold['max']:
            breached = True
            direction = 'above maximum'

        if not breached:
            return None

        # Create alert
        alert = {
            'alert_id': str(uuid.uuid4()),
            'alert_type': 'threshold',
            'severity': threshold.get('severity', 'warning'),
            'sensor_id': reading.get('sensor_id'),
            'sensor_type': sensor_type,
            'value': value,
            'threshold': threshold['min'] if direction == 'below minimum' else threshold['max'],
            'message': (
                f"⚠️ {sensor_type} {direction}: "
                f"{value}{reading.get('unit', '')} "
                f"(threshold: {threshold.get('min', '-∞')}–{threshold.get('max', '∞')})"
            ),
        }

        # Update cooldown
        self._cooldown[sensor_type] = now

        logger.warning(f"Alert: {alert['message']}")
        return alert

    async def send_sms(self, alert: dict):
        """Send SMS alert via local SIM card."""
        if not self.config.sms_enabled or not self.config.sms_phone:
            return

        message = f"[SmartFarm] {alert['message']}"

        try:
            if self.config.sms_provider == 'serial':
                await self._send_at_sms(message)
            elif self.config.sms_provider == 'console':
                logger.info(f"[SMS] To: {self.config.sms_phone} | {message}")
            else:
                logger.warning(f"Unknown SMS provider: {self.config.sms_provider}")
        except Exception as e:
            logger.error(f"SMS send failed: {e}")

    async def _send_at_sms(self, message: str):
        """Send SMS via AT commands (USB modem)."""
        import serial
        port = self.config.get('sms_serial_port', '/dev/ttyUSB1')
        try:
            with serial.Serial(port, 115200, timeout=5) as ser:
                ser.write(b'AT+CMGF=1\r')
                ser.read(100)
                ser.write(f'AT+CMGS="{self.config.sms_phone}"\r'.encode())
                ser.read(100)
                ser.write(message.encode() + b'\x1a')  # Ctrl+Z to send
                ser.read(200)
                logger.info(f"SMS sent to {self.config.sms_phone}")
        except Exception as e:
            logger.error(f"AT SMS error: {e}")
