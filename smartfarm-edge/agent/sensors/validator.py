"""
SmartFarm Edge Agent - Sensor Reading Validator
Validates, enriches, and classifies sensor readings before storage.
"""

import uuid
from datetime import datetime, timezone

# Physical ranges for coffee farming sensors
SENSOR_RANGES = {
    'soil_moisture': (0, 100, '%'),
    'soil_temperature': (-5, 60, '°C'),
    'soil_ph': (3, 10, 'pH'),
    'soil_ec': (0, 20, 'dS/m'),
    'air_temperature': (0, 50, '°C'),
    'air_humidity': (0, 100, '%'),
    'rainfall': (0, 300, 'mm'),
    'light_intensity': (0, 200000, 'lux'),
    'wind_speed': (0, 50, 'm/s'),
    'leaf_wetness': (0, 100, '%'),
    'water_level': (0, 5000, 'mm'),
    'flow_rate': (0, 1000, 'L/min'),
    'nitrogen': (0, 1000, 'mg/kg'),
    'phosphorus': (0, 500, 'mg/kg'),
    'potassium': (0, 2000, 'mg/kg'),
    'salinity': (0, 50, 'g/L'),
    # Legacy names
    'moisture': (0, 100, '%'),
    'temperature': (-10, 60, '°C'),
    'ec': (0, 20, 'mS/cm'),
    'ph': (0, 14, 'pH'),
}


def validate(reading: dict, farm_id: str) -> dict | None:
    """
    Validate and enrich a sensor reading.
    Returns enriched reading dict, or None if invalid.
    """
    sensor_type = reading.get('sensor_type', '')
    value = reading.get('value')

    # Must have sensor_type and value
    if not sensor_type or value is None:
        return None

    try:
        value = float(value)
    except (ValueError, TypeError):
        return None

    # Check for NaN/Inf
    if value != value or value == float('inf') or value == float('-inf'):
        return None

    # Get range for validation
    sensor_range = SENSOR_RANGES.get(sensor_type)
    if sensor_range:
        min_val, max_val, default_unit = sensor_range
        unit = reading.get('unit', default_unit)

        # Range check
        if value < min_val or value > max_val:
            quality = 'suspect'
        else:
            quality = 'good'
    else:
        unit = reading.get('unit', '')
        quality = 'good'

    # Generate IDs if missing
    reading_id = reading.get('reading_id', str(uuid.uuid4()))
    sensor_id = reading.get('sensor_id', f"{sensor_type}_01")
    ts = reading.get('ts', datetime.now(timezone.utc).isoformat())

    return {
        'reading_id': reading_id,
        'sensor_id': sensor_id,
        'sensor_type': sensor_type,
        'value': round(value, 4),
        'unit': unit,
        'quality': quality,
        'field_id': reading.get('field_id'),
        'ts': ts,
        'battery_mv': reading.get('battery_mv'),
        'rssi': reading.get('rssi'),
        '_log': True,
    }
