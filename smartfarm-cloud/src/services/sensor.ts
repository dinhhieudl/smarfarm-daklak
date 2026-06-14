// ============================================================================
// SmartFarm Cloud - Sensor Data Ingestion Service
// ============================================================================
// This is the core data pipeline: receives batched data from edge agents,
// validates it, stores in TimescaleDB, triggers alerts, and broadcasts via WS.
// ============================================================================

import { batchInsertReadings, query } from '../db/pool';
import { getDeviceByEui, updateDeviceStatus } from './device';
import { checkAlerts } from './alert';
import { publish } from './redis';
import { BatchSensorPayload, SensorReading, SensorType, SENSOR_UNITS } from '../types';
import { logger } from '../utils/logger';

interface ValidationResult {
  valid: boolean;
  readings: SensorReading[];
  errors: string[];
  deviceId: string;
  gardenId: string;
}

/**
 * Validate and transform a batch payload into SensorReading objects.
 * - Verifies device exists and belongs to the claimed garden
 * - Verifies zones exist and belong to the garden
 * - Normalizes units
 * - Validates value ranges
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
    if (!validZoneIds.has(r.zone_id)) {
      errors.push(`Invalid zone_id ${r.zone_id} for garden ${payload.garden_id}`);
      continue;
    }

    const expectedUnit = SENSOR_UNITS[r.sensor_type];
    if (r.unit !== expectedUnit) {
      errors.push(`Unit mismatch for ${r.sensor_type}: expected ${expectedUnit}, got ${r.unit}`);
      continue;
    }

    // Value range validation
    const rangeError = validateSensorRange(r.sensor_type, r.value);
    if (rangeError) {
      errors.push(rangeError);
      // Still insert but mark as suspect
    }

    readings.push({
      time: new Date(r.timestamp),
      device_id: device.id,
      garden_id: payload.garden_id,
      zone_id: r.zone_id,
      sensor_type: r.sensor_type,
      value: r.value,
      unit: r.unit,
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
  const ranges: Record<SensorType, [number, number]> = {
    temperature: [-10, 60],       // °C
    moisture: [0, 100],           // %
    ec: [0, 20],                  // mS/cm
    nitrogen: [0, 1000],          // mg/kg
    phosphorus: [0, 500],         // mg/kg
    potassium: [0, 2000],         // mg/kg
    ph: [0, 14],                  // pH
    salinity: [0, 50],            // g/L
  };

  const [min, max] = ranges[sensorType];
  if (value < min || value > max) {
    return `${sensor_type_label(sensorType)} value ${value} outside physical range [${min}, ${max}]`;
  }
  return null;
}

function sensor_type_label(type: SensorType): string {
  const labels: Record<SensorType, string> = {
    temperature: 'Temperature',
    moisture: 'Moisture',
    ec: 'EC',
    nitrogen: 'Nitrogen (N)',
    phosphorus: 'Phosphorus (P)',
    potassium: 'Potassium (K)',
    ph: 'pH',
    salinity: 'Salinity',
  };
  return labels[type] || type;
}

/**
 * Process a validated batch: store in DB, check alerts, broadcast updates.
 * This is the main ingestion pipeline.
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
 * Uses continuous aggregates for larger time ranges automatically.
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
    from = new Date(Date.now() - 86400000), // default: last 24h
    to = new Date(),
    granularity = 'raw',
    limit = 1000,
    offset = 0,
  } = options;

  // Choose the right table/view based on granularity
  let timeCol = 'time';
  let table = 'sensor_readings';
  let selectCols = 'time, zone_id, sensor_type, value, unit, quality';

  if (granularity === '1h') {
    table = 'sensor_hourly';
    selectCols = 'bucket as time, zone_id, sensor_type, avg_value as value, \'avg\' as unit, \'good\' as quality';
  } else if (granularity === '1d') {
    table = 'sensor_daily';
    selectCols = 'bucket as time, zone_id, sensor_type, avg_value as value, \'avg\' as unit, \'good\' as quality';
  } else if (granularity === '5m') {
    // Downsample raw data to 5-minute buckets on the fly
    table = `(
      SELECT time_bucket('5 minutes', time) as time, zone_id, sensor_type,
             AVG(value) as value, 'avg' as unit, 'good' as quality
      FROM sensor_readings
      GROUP BY time_bucket('5 minutes', time), zone_id, sensor_type
    )`;
  }

  const conditions: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  // For raw table, we use garden_id; for aggregates, same
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

  // Time range
  conditions.push(`time >= $${paramIdx++}`);
  params.push(from);
  conditions.push(`time <= $${paramIdx++}`);
  params.push(to);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitParam = paramIdx++;
  const offsetParam = paramIdx++;

  // For 5m subquery, wrap it properly
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
