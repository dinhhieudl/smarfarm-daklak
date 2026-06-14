// ============================================================================
// SmartFarm Cloud - Database Connection Pool
// ============================================================================

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

export const pool = new Pool({
  connectionString: config.db.url,
  max: config.db.poolSize,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

pool.on('connect', () => {
  logger.debug('New database connection established');
});

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    logger.warn({ text: text.substring(0, 100), duration }, 'Slow query detected');
  }

  return result;
}

export async function getClient(): Promise<PoolClient> {
  return pool.connect();
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

// TimescaleDB-specific: batch insert for high throughput
export async function batchInsertReadings(
  readings: Array<{
    time: Date;
    device_id: string;
    garden_id: string;
    zone_id: string;
    sensor_type: string;
    value: number;
    unit: string;
    quality: string;
    raw_value?: number;
    battery_voltage?: number;
    rssi?: number;
  }>
): Promise<number> {
  if (readings.length === 0) return 0;

  const values: any[] = [];
  const placeholders: string[] = [];

  readings.forEach((r, i) => {
    const offset = i * 11;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
    );
    values.push(
      r.time, r.device_id, r.garden_id, r.zone_id,
      r.sensor_type, r.value, r.unit, r.quality,
      r.raw_value ?? null, r.battery_voltage ?? null, r.rssi ?? null
    );
  });

  const sql = `
    INSERT INTO sensor_readings
      (time, device_id, garden_id, zone_id, sensor_type, value, unit, quality, raw_value, battery_voltage, rssi)
    VALUES ${placeholders.join(', ')}
  `;

  const result = await pool.query(sql, values);
  return result.rowCount ?? 0;
}
