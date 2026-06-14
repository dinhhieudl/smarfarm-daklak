// ============================================================================
// SmartFarm Cloud - MQTT Handler (Updated Topic Structure)
// ============================================================================
// Supports two topic patterns:
//   1. Legacy: sensor/farm/{farm_id}/{device_eui}
//   2. New:    smartfarm/{farm_id}/telemetry/{sensor_type}
//              smartfarm/{farm_id}/status/{device_id}
//              smartfarm/{farm_id}/alerts/{alert_type}
// ============================================================================

import mqtt from 'mqtt';
import { config } from '../config';
import { ingestBatch } from './sensor';
import { BatchSensorPayload } from '../types';
import { logger } from '../utils/logger';

let client: mqtt.MqttClient | null = null;

/**
 * Connect to MQTT broker and subscribe to sensor data topics.
 */
export function startMqttIngest(): void {
  const { brokerUrl, username, password, topicPrefix } = config.mqtt;

  logger.info({ brokerUrl }, 'Connecting to MQTT broker for data ingest');

  client = mqtt.connect(brokerUrl, {
    username,
    password,
    clientId: `smartfarm-cloud-${Math.random().toString(16).slice(2, 10)}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    will: {
      topic: 'smartfarm/cloud/status',
      payload: JSON.stringify({ status: 'offline', ts: new Date().toISOString() }),
      qos: 1,
      retain: true,
    },
  });

  client.on('connect', () => {
    logger.info('MQTT connected, subscribing to sensor topics');

    // Subscribe to new topic structure: smartfarm/{farm_id}/telemetry/#
    client!.subscribe(`${topicPrefix}/+/telemetry/#`, { qos: 1 }, (err) => {
      if (err) {
        logger.error({ err }, 'Failed to subscribe to telemetry topics');
        return;
      }
      logger.info({ topic: `${topicPrefix}/+/telemetry/#` }, 'Telemetry subscription active');
    });

    // Subscribe to legacy topic structure: sensor/farm/#
    client!.subscribe('sensor/farm/#', { qos: 1 }, (err) => {
      if (err) {
        logger.error({ err }, 'Failed to subscribe to legacy sensor topics');
        return;
      }
      logger.info('Legacy sensor topic subscription active');
    });

    // Subscribe to device status: smartfarm/{farm_id}/status/#
    client!.subscribe(`${topicPrefix}/+/status/#`, { qos: 0 });

    // Subscribe to device commands ack: smartfarm/{farm_id}/ack/#
    client!.subscribe(`${topicPrefix}/+/ack/#`, { qos: 0 });

    // Publish online status
    client!.publish('smartfarm/cloud/status', JSON.stringify({
      status: 'online',
      ts: new Date().toISOString(),
    }), { qos: 1, retain: true });
  });

  client.on('message', async (topic, payload) => {
    try {
      // Determine topic format and route accordingly
      const parts = topic.split('/');

      if (parts[0] === 'smartfarm') {
        // New format: smartfarm/{farm_id}/telemetry/{sensor_type}
        await handleNewTopicFormat(parts, payload);
      } else if (parts[0] === 'sensor' && parts[1] === 'farm') {
        // Legacy format: sensor/farm/{farm_id}/{device_eui}
        await handleLegacyTopicFormat(parts, payload);
      } else {
        logger.debug({ topic }, 'Ignoring unknown MQTT topic');
      }
    } catch (err) {
      logger.error({ err, topic }, 'Failed to process MQTT message');
    }
  });

  client.on('error', (err) => {
    logger.error({ err }, 'MQTT connection error');
  });

  client.on('offline', () => {
    logger.warn('MQTT client offline');
  });

  client.on('reconnect', () => {
    logger.info('MQTT client reconnecting');
  });
}

/**
 * Handle new topic format: smartfarm/{farm_id}/telemetry/{sensor_type}
 * Payload can be a single reading or a batch.
 */
async function handleNewTopicFormat(parts: string[], payload: Buffer): Promise<void> {
  // parts: ['smartfarm', '{farm_id}', 'telemetry', '{sensor_type}'] or ['smartfarm', '{farm_id}', 'status', '{device_id}']
  if (parts.length < 3) return;

  const farmId = parts[1];
  const category = parts[2];

  if (category === 'telemetry') {
    const sensorType = parts[3]; // optional, can be 'batch' or specific type

    let data: any;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      logger.warn({ topic: parts.join('/') }, 'Invalid JSON in telemetry message');
      return;
    }

    // Handle batch format (primary format from edge agent)
    if (data.batch_id && data.readings) {
      await handleBatchTelemetry(farmId, data);
      return;
    }

    // Handle single reading format
    if (data.sensor_id && data.value !== undefined) {
      await handleSingleTelemetry(farmId, sensorType, data);
      return;
    }

    logger.warn({ topic: parts.join('/') }, 'Unrecognized telemetry payload format');

  } else if (category === 'status') {
    // Device status update
    const deviceId = parts[3];
    let statusData: any;
    try {
      statusData = JSON.parse(payload.toString());
    } catch {
      return;
    }
    logger.debug({ farmId, deviceId, status: statusData.status }, 'Device status update');

  } else if (category === 'ack') {
    // Command acknowledgement
    const commandId = parts[3];
    logger.debug({ farmId, commandId }, 'Command ACK received');
  }
}

/**
 * Handle batch telemetry in the framework format:
 * {
 *   batch_id: "uuid",
 *   farm_id: "farm_001",
 *   device_id: "rpi_001",
 *   readings: [
 *     { reading_id, sensor_id, sensor_type, value, unit, quality, ts },
 *     ...
 *   ],
 *   meta: { rpi_uptime_s, signal_rssi, battery_pct, firmware_version }
 * }
 */
async function handleBatchTelemetry(farmId: string, data: any): Promise<void> {
  const deviceEui = data.device_id || data.device_eui || 'unknown';

  // Transform to our internal BatchSensorPayload format
  const payload: BatchSensorPayload = {
    device_eui: deviceEui,
    garden_id: farmId,
    readings: (data.readings || []).map((r: any) => ({
      zone_id: r.zone_id || r.field_id || 'default',
      sensor_type: mapSensorType(r.sensor_type),
      value: r.value,
      unit: r.unit,
      quality: r.quality || 'good',
      raw_value: r.raw_value,
      timestamp: r.ts || r.timestamp,
      battery_voltage: data.meta?.battery_voltage,
      rssi: data.meta?.signal_rssi || r.rssi,
    })),
  };

  logger.info(
    { farmId, deviceEui, readingCount: payload.readings.length },
    'Batch telemetry received (new format)'
  );

  const result = await ingestBatch(payload);

  if (result.inserted > 0) {
    logger.info({ deviceEui, inserted: result.inserted }, 'Batch ingested');
  }

  // Send ACK back
  if (client) {
    client.publish(`smartfarm/${farmId}/ack/${data.batch_id || 'batch'}`, JSON.stringify({
      status: result.inserted > 0 ? 'ok' : 'error',
      inserted: result.inserted,
      errors: result.errors,
      alerts: result.alerts,
      ts: new Date().toISOString(),
    }), { qos: 0 });
  }
}

/**
 * Handle single telemetry reading
 */
async function handleSingleTelemetry(farmId: string, sensorType: string, data: any): Promise<void> {
  const payload: BatchSensorPayload = {
    device_eui: data.device_id || data.gateway_id || 'unknown',
    garden_id: farmId,
    readings: [{
      zone_id: data.zone_id || data.field_id || 'default',
      sensor_type: mapSensorType(sensorType || data.sensor_type),
      value: data.value,
      unit: data.unit || '',
      quality: data.quality || 'good',
      timestamp: data.ts || data.timestamp || new Date().toISOString(),
      battery_voltage: data.battery_voltage,
      rssi: data.rssi,
    }],
  };

  await ingestBatch(payload);
}

/**
 * Map various sensor type names to our canonical types
 */
function mapSensorType(raw: string): any {
  const mapping: Record<string, string> = {
    'moisture': 'soil_moisture',
    'soil_moisture': 'soil_moisture',
    'temp': 'air_temperature',
    'temperature': 'air_temperature',
    'air_temperature': 'air_temperature',
    'soil_temp': 'soil_temperature',
    'soil_temperature': 'soil_temperature',
    'humidity': 'air_humidity',
    'air_humidity': 'air_humidity',
    'rain': 'rainfall',
    'rainfall': 'rainfall',
    'light': 'light_intensity',
    'light_intensity': 'light_intensity',
    'wind': 'wind_speed',
    'wind_speed': 'wind_speed',
    'leaf': 'leaf_wetness',
    'leaf_wetness': 'leaf_wetness',
    'ec': 'soil_ec',
    'soil_ec': 'soil_ec',
    'ph': 'soil_ph',
    'soil_ph': 'soil_ph',
    'nitrogen': 'nitrogen',
    'n': 'nitrogen',
    'phosphorus': 'phosphorus',
    'p': 'phosphorus',
    'potassium': 'potassium',
    'k': 'potassium',
    'salinity': 'salinity',
  };

  return mapping[raw.toLowerCase()] || raw;
}

/**
 * Handle legacy topic format: sensor/farm/{farm_id}/{device_eui}
 */
async function handleLegacyTopicFormat(parts: string[], payload: Buffer): Promise<void> {
  if (parts.length < 4) return;

  const farmId = parts[2];
  const deviceEui = parts[3];

  let data: BatchSensorPayload;
  try {
    data = JSON.parse(payload.toString());
  } catch {
    logger.warn({ topic: parts.join('/') }, 'Invalid JSON in legacy sensor message');
    return;
  }

  data.device_eui = deviceEui.toLowerCase();
  data.garden_id = farmId;

  logger.info(
    { deviceEui, farmId, readingCount: data.readings?.length },
    'Legacy MQTT batch received'
  );

  const result = await ingestBatch(data);

  if (result.inserted > 0) {
    logger.info({ deviceEui, inserted: result.inserted }, 'Legacy batch ingested');
  }

  // ACK
  if (client) {
    client.publish(`cloud/ack/${deviceEui}`, JSON.stringify({
      status: result.inserted > 0 ? 'ok' : 'error',
      inserted: result.inserted,
      errors: result.errors,
      alerts: result.alerts,
      ts: new Date().toISOString(),
    }), { qos: 0 });
  }
}

/**
 * Gracefully disconnect MQTT
 */
export async function stopMqttIngest(): Promise<void> {
  if (client) {
    client.publish('smartfarm/cloud/status', JSON.stringify({
      status: 'offline',
      ts: new Date().toISOString(),
    }), { qos: 1, retain: true });

    await client.endAsync();
    client = null;
    logger.info('MQTT client disconnected');
  }
}
