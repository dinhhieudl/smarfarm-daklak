"""
SmartFarm Edge Agent - Configuration
"""

import os
import yaml
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    """Edge agent configuration loaded from YAML + env vars."""

    # Farm identity
    farm_id: str = ''
    device_id: str = ''
    cloud_api_key: str = ''

    # Cloud endpoints
    cloud_api_url: str = 'https://api.smartfarm.vn/v1'
    mqtt_broker: str = 'mqtt://localhost:1883'
    mqtt_username: str = ''
    mqtt_password: str = ''

    # Local storage
    db_path: str = '/var/smartfarm/data/readings.db'
    buffer_days: int = 7

    # Sync settings
    sync_interval: int = 3600        # seconds between batch uploads
    sync_batch_size: int = 500       # max readings per batch
    sync_max_retries: int = 3

    # LoRa settings
    lora_port: str = '/dev/ttyUSB0'
    lora_baud: int = 115200

    # Sensor config
    read_interval: int = 600         # seconds between sensor reads (10 min)
    sensors: list = field(default_factory=list)

    # Web dashboard
    web_port: int = 8080
    web_enabled: bool = True

    # Alerts
    sms_enabled: bool = False
    sms_provider: str = 'console'    # console, serial, at
    sms_phone: str = ''              # phone for alert SMS
    alert_thresholds: dict = field(default_factory=dict)

    # Timezone
    timezone: str = 'Asia/Ho_Chi_Minh'


def load_config(config_path: str = None) -> Config:
    """Load config from YAML file, with env var overrides."""
    config = Config()

    # Default config path
    if config_path is None:
        config_path = os.environ.get(
            'SMARTFARM_CONFIG',
            '/etc/smartfarm/config.yaml'
        )

    # Load YAML if exists
    config_file = Path(config_path)
    if config_file.exists():
        with open(config_file) as f:
            data = yaml.safe_load(f) or {}

        # Map YAML keys to config fields
        for key, value in data.items():
            if hasattr(config, key):
                setattr(config, key, value)

    # Environment variable overrides (takes precedence)
    env_map = {
        'SMARTFARM_FARM_ID': 'farm_id',
        'SMARTFARM_DEVICE_ID': 'device_id',
        'SMARTFARM_CLOUD_API_KEY': 'cloud_api_key',
        'SMARTFARM_CLOUD_API_URL': 'cloud_api_url',
        'SMARTFARM_MQTT_BROKER': 'mqtt_broker',
        'SMARTFARM_MQTT_USERNAME': 'mqtt_username',
        'SMARTFARM_MQTT_PASSWORD': 'mqtt_password',
        'SMARTFARM_DB_PATH': 'db_path',
        'SMARTFARM_SYNC_INTERVAL': ('sync_interval', int),
        'SMARTFARM_LORA_PORT': 'lora_port',
        'SMARTFARM_WEB_PORT': ('web_port', int),
    }

    for env_key, field_info in env_map.items():
        value = os.environ.get(env_key)
        if value is not None:
            if isinstance(field_info, tuple):
                field_name, cast = field_info
                setattr(config, field_name, cast(value))
            else:
                setattr(config, field_info, value)

    # Validate required fields
    if not config.farm_id:
        raise ValueError("farm_id is required. Set via config.yaml or SMARTFARM_FARM_ID env")

    if not config.cloud_api_key:
        raise ValueError("cloud_api_key is required. Set via config.yaml or SMARTFARM_CLOUD_API_KEY env")

    return config
