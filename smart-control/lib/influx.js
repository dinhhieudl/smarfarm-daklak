// lib/influx.js — InfluxDB persistence layer (optional, graceful fallback)
const { InfluxDB, Point, WriteApi } = require('@influxdata/influxdb-client');

let writeApi = null;
let queryApi = null;
let influxAvailable = false;

const INFLUXDB_URL = process.env.INFLUXDB_URL || 'http://localhost:8086';
const INFLUXDB_TOKEN = process.env.INFLUXDB_TOKEN || '';
const INFLUXDB_ORG = process.env.INFLUXDB_ORG || 'smartfarm';
const INFLUXDB_BUCKET = process.env.INFLUXDB_BUCKET || 'soil_data';

function sanitizeZoneId(zoneId) {
  if (typeof zoneId !== 'string') return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(zoneId)) return null;
  return zoneId;
}

function init() {
  if (!INFLUXDB_TOKEN) {
    console.log('[InfluxDB] No token configured, persistence disabled (in-memory fallback active)');
    return;
  }

  try {
    const client = new InfluxDB({ url: INFLUXDB_URL, token: INFLUXDB_TOKEN });
    writeApi = client.getWriteApi(INFLUXDB_ORG, INFLUXDB_BUCKET, 'ns');
    queryApi = client.getQueryApi(INFLUXDB_ORG);
    influxAvailable = true;
    console.log(`[InfluxDB] Connected to ${INFLUXDB_URL}, bucket: ${INFLUXDB_BUCKET}`);
  } catch (err) {
    console.warn('[InfluxDB] Failed to initialize:', err.message);
    influxAvailable = false;
  }
}

/**
 * Write sensor data point to InfluxDB
 * @param {string} zoneId
 * @param {object} sensorData - { temperature, moisture, ec, salinity, nitrogen, phosphorus, potassium, ph }
 */
function writeSensorData(zoneId, sensorData) {
  if (!influxAvailable || !writeApi) return;

  try {
    const point = new Point('sensor_data')
      .tag('zone', zoneId)
      .timestamp(new Date());

    const fields = ['temperature', 'moisture', 'ec', 'salinity', 'nitrogen', 'phosphorus', 'potassium', 'ph'];
    fields.forEach(f => {
      if (sensorData[f] != null && typeof sensorData[f] === 'number') {
        point.floatField(f, sensorData[f]);
      }
    });

    writeApi.writePoint(point);
  } catch (err) {
    console.warn('[InfluxDB] writeSensorData error:', err.message);
  }
}

/**
 * Write control event to InfluxDB
 * @param {string} actuatorId
 * @param {string} action
 * @param {string} source
 * @param {string} prevState
 * @param {string} newState
 */
function writeControlEvent(actuatorId, action, source, prevState, newState) {
  if (!influxAvailable || !writeApi) return;

  try {
    const point = new Point('control_event')
      .tag('actuator', actuatorId)
      .tag('source', source)
      .stringField('action', action)
      .stringField('prevState', prevState)
      .stringField('newState', newState)
      .timestamp(new Date());

    writeApi.writePoint(point);
  } catch (err) {
    console.warn('[InfluxDB] writeControlEvent error:', err.message);
  }
}

/**
 * Query sensor history for a zone (last N hours, default 24h)
 * @param {string} zoneId
 * @param {number} hours
 * @returns {Promise<Array>}
 */
async function queryHistory(zoneId, hours = 24) {
  const safeZone = sanitizeZoneId(zoneId);
  if (!safeZone) return [];
  if (!influxAvailable || !queryApi) return [];

  const rangeStart = `-${hours}h`;
  const flux = `
    from(bucket: "${INFLUXDB_BUCKET}")
      |> range(start: ${rangeStart})
      |> filter(fn: (r) => r["_measurement"] == "sensor_data")
      |> filter(fn: (r) => r["zone"] == "${safeZone}")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 1000)
  `;

  return new Promise((resolve) => {
    const results = [];
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        results.push({
          time: obj._time,
          temperature: obj.temperature,
          moisture: obj.moisture,
          ec: obj.ec,
          salinity: obj.salinity,
          nitrogen: obj.nitrogen,
          phosphorus: obj.phosphorus,
          potassium: obj.potassium,
          ph: obj.ph
        });
      },
      error(err) {
        console.warn('[InfluxDB] queryHistory error:', err.message);
        resolve([]);
      },
      complete() {
        resolve(results);
      }
    });
  });
}

/**
 * Query control events history (last N hours, default 24h)
 * @param {number} hours
 * @returns {Promise<Array>}
 */
async function queryControlEvents(hours = 24) {
  if (!influxAvailable || !queryApi) return [];

  const rangeStart = `-${hours}h`;
  const flux = `
    from(bucket: "${INFLUXDB_BUCKET}")
      |> range(start: ${rangeStart})
      |> filter(fn: (r) => r["_measurement"] == "control_event")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 500)
  `;

  return new Promise((resolve) => {
    const results = [];
    queryApi.queryRows(flux, {
      next(row, tableMeta) {
        const obj = tableMeta.toObject(row);
        results.push({
          time: obj._time,
          actuator: obj.actuator,
          source: obj.source,
          action: obj.action,
          prevState: obj.prevState,
          newState: obj.newState
        });
      },
      error(err) {
        console.warn('[InfluxDB] queryControlEvents error:', err.message);
        resolve([]);
      },
      complete() {
        resolve(results);
      }
    });
  });
}

function isAvailable() {
  return influxAvailable;
}

function flush() {
  if (writeApi) {
    writeApi.flush().catch(() => {});
    writeApi.close().catch(() => {});
  }
}

module.exports = { init, writeSensorData, writeControlEvent, queryHistory, queryControlEvents, isAvailable, flush, sanitizeZoneId };
