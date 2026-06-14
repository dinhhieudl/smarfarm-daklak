// ============================================================================
// SmartFarm Cloud - Sensor Data Ingestion Service (Updated)
// ============================================================================

import { batchInsertReadings, query } from '../db/pool';
import { getDeviceByEui, updateDeviceStatus } from './device';
import { checkAlerts } from './alert';
import { publish } from './redis';
import { BatchSensorPayload, SensorReading, SensorType, SENSOR_UNITS, SENSOR_RANGES } from '../types';
import { logger } from '../utils/logger';

interface ValidationResult {
  valid: boolean;
  readings: SensorReading[];
  errors: string[];
  deviceId: string;
  gardenId: string;
}

/**
 * Map legacy sensor type names to canonical types
 */
function normalizeSensorType(raw: string): SensorType {
  const mapping: Record<string, SensorType> = {
    'moisture': 'soil_moisture',
    'temperature': 'air_temperature',
    'ec': 'soil_ec',
    'ph': 'soil_ph',
    'temp': 'air_temperature',
    'humidity': 'air_humidity',
    'rain': 'rainfall',
    'light': 'light_intensity',
    'wind': 'wind_speed',
    'leaf': 'leaf_wetness',
    'soil_temp': 'soil_temperature',
    'soil_moisture': 'soil_moisture',
    'soil_temperature': 'soil_temperature',
    'soil_ph': 'soil_ph',
    'soil_ec': 'soil_ec',
    'air_temperature': 'air_temperature',
    'air_humidity': 'air_humidity',
    'rainfall': 'rainfall',
    'light_intensity': 'light_intensity',
    'wind_speed': 'wind_speed',
    'leaf_wetness': 'leaf_wetness',
    'water_level': 'water_level',
    'flow_rate': 'flow_rate',
    'nitrogen': 'nitrogen',
    'n': 'nitrogen',
    'phosphorus': 'phosphorus',
    'p': 'phosphorus',
    'potassium': 'potassium',
    'k': 'potassium',
    'salinity': 'salinity',
  };
  return (mapping[raw.toLowerCase()] || raw) as SensorType;
}

/**
 * Validate and transform a batch payload into SensorReading objects.
 */
export async function validateBatch(payload: BatchSensorPayload): Promise<ValidationResult> {
  const errors: string[] = [];

  // 1. Look up device by EUI
  const device = await getDeviceByEui(payload.device_eui);
  if (!device) {
    return {
      valid: false,
      readings: [],
      errors: [`Unknown device EUI: ${payload.device_eui}`],
      deviceId: '',
      gardenId: payload.garden_id,
    };
  }

  if (device.garden_id !== payload.garden_id) {
    return {
      valid: false,
      readings: [],
      errors: [`Device ${payload.device_eui} does not belong to garden ${payload.garden_id}`],
      deviceId: device.id,
      gardenId: payload.garden_id,
    };
  }

  // 2. Fetch valid zone IDs for this garden
  const zonesResult = await query(
    'SELECT id FROM zones WHERE garden_id = $1',
    [payload.garden_id]
  );
  const validZoneIds = new Set(zonesResult.rows.map((r: any) => r.id));

  // 3. Validate and transform each reading
  const readings: SensorReading[] = [];

  for (const r of payload.readings) {
    // Zone validation (allow 'default' zone for edge agents)
    if (r.zone_id !== 'default' && !validZoneIds.has(r.zone_id)) {
      // Try to find or create a default zone
      if (validZoneIds.size === 0) {
        // No zones defined - skip zone validation
      } else {
        errors.push(`Invalid zone_id ${r.zone_id} for garden ${payload.garden_id}`);
        continue;
      }
    }

    // Normalize sensor type
    const sensorType = normalizeSensorType(r.sensor_type);

    // Get expected unit (fallback to provided unit)
    const expectedUnit = SENSOR_UNITS[sensorType];
    const unit = r.unit || expectedUnit || '';

    // Value range validation
    const rangeError = validateSensorRange(sensorType, r.value);

    readings.push({
      time: new Date(r.timestamp),
      device_id: device.id,
      garden_id: payload.garden_id,
      zone_id: r.zone_id === 'default' ? (zonesResult.rows[0]?.id || r.zone_id) : r.zone_id,
      sensor_type: sensorType,
      value: r.value,
      unit: unit,
      quality: rangeError ? 'suspect' : (r.quality || 'good'),
      raw_value: r.raw_value,
      battery_voltage: r.battery_voltage,
      rssi: r.rssi,
    });
  }

  return {
    valid: readings.length > 0,
    readings,
    errors,
    deviceId: device.id,
    gardenId: payload.garden_id,
  };
}

/**
 * Validate sensor value ranges (physical limits for soil sensors in coffee farms)
 */
function validateSensorRange(sensorType: SensorType, value: number): string | null {
  const range = SENSOR_RANGES[sensorType];
  if (!range) return null;

  const [min, max] = range;
  if (value < min || value > max) {
    return `${sensorType} value ${value} outside physical range [${min}, ${max}]`;
  }
  return null;
}

/**
 * Process a validated batch: store in DB, check alerts, broadcast updates.
 */
export async function ingestBatch(
  payload: BatchSensorPayload
): Promise<{ inserted: number; errors: string[]; alerts: string[] }> {
  // 1. Validate
  const validation = await validateBatch(payload);
  if (!validation.valid) {
    logger.warn(
      { deviceEui: payload.device_eui, errors: validation.errors },
      'Batch validation failed'
    );
    return { inserted: 0, errors: validation.errors, alerts: [] };
  }

  // 2. Update device status to online
  const lastReading = validation.readings[validation.readings.length - 1];
  await updateDeviceStatus(
    validation.deviceId,
    'online',
    lastReading.battery_voltage,
    lastReading.rssi
  );

  // 3. Batch insert into TimescaleDB hypertable
  const insertData = validation.readings.map((r) => ({
    time: r.time,
    device_id: r.device_id,
    garden_id: r.garden_id,
    zone_id: r.zone_id,
    sensor_type: r.sensor_type,
    value: r.value,
    unit: r.unit,
    quality: r.quality,
    raw_value: r.raw_value,
    battery_voltage: r.battery_voltage,
    rssi: r.rssi,
  }));

  const inserted = await batchInsertReadings(insertData);

  logger.info(
    { deviceEui: payload.device_eui, inserted, gardenId: payload.garden_id },
    'Sensor batch ingested'
  );

  // 4. Check alert thresholds (async - don't block response)
  const alertResults: string[] = [];
  checkAlerts(validation.readings)
    .then((alerts) => {
      alerts.forEach((a) => alertResults.push(a.id));
    })
    .catch((err) => logger.error({ err }, 'Alert check failed'));

  // 5. Broadcast via Redis pub/sub for real-time WebSocket clients
  publish('sensor:updates', {
    type: 'sensor_update',
    garden_id: payload.garden_id,
    device_eui: payload.device_eui,
    readings: validation.readings.map((r) => ({
      zone_id: r.zone_id,
      sensor_type: r.sensor_type,
      value: r.value,
      unit: r.unit,
      time: r.time.toISOString(),
    })),
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error({ err }, 'Redis publish failed'));

  return { inserted, errors: validation.errors, alerts: alertResults };
}

/**
 * Query sensor data for a specific garden/zone/time range.
 */
export async function querySensorData(
  gardenId: string,
  options: {
    zoneId?: string;
    sensorType?: SensorType;
    from?: Date;
    to?: Date;
    granularity?: 'raw' | '5m' | '1h' | '1d';
    limit?: number;
    offset?: number;
  } = {}
) {
  const {
    zoneId,
    sensorType,
    from = new Date(Date.now() - 86400000),
    to = new Date(),
    granularity = 'raw',
    limit = 1000,
    offset = 0,
  } = options;

  let table = 'sensor_readings';
  let selectCols = 'time, zone_id, sensor_type, value, unit, quality';

  if (granularity === '1h') {
    table = 'sensor_hourly';
    selectCols = 'bucket as time, zone_id, sensor_type, avg_value as value, \'avg\' as unit, \'good\' as quality';
  } else if (granularity === '1d') {
    table = 'sensor_daily';
    selectCols = 'bucket as time, zone_id, sensor_type, avg_value as value, \'avg\' as unit, \'good\' as quality';
  } else if (granularity === '5m') {
    table = `(
      SELECT time_bucket('5 minutes', time) as time, zone_id, sensor_type,
             AVG(value) as value, 'avg' as unit, 'good' as quality
      FROM sensor_readings
      WHERE garden_id = $1
      GROUP BY time_bucket('5 minutes', time), zone_id, sensor_type
    )`;
  }

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  if (granularity === 'raw' || granularity === '5m') {
    if (granularity === 'raw') {
      conditions.push(`garden_id = $${paramIdx++}`);
      params.push(gardenId);
    }
  } else {
    conditions.push(`garden_id = $${paramIdx++}`);
    params.push(gardenId);
  }

  if (zoneId) {
    conditions.push(`zone_id = $${paramIdx++}`);
    params.push(zoneId);
  }
  if (sensorType) {
    conditions.push(`sensor_type = $${paramIdx++}`);
    params.push(sensorType);
  }

  conditions.push(`time >= $${paramIdx++}`);
  params.push(from);
  conditions.push(`time <= $${paramIdx++}`);
  params.push(to);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitParam = paramIdx++;
  const offsetParam = paramIdx++;

  let sql: string;
  if (granularity === '5m') {
    sql = `
      SELECT ${selectCols} FROM ${table} AS sub
      ${whereClause}
      ORDER BY time DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
  } else {
    sql = `
      SELECT ${selectCols} FROM ${table}
      ${whereClause}
      ORDER BY time DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;
  }

  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows;
}
