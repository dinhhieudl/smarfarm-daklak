// ============================================================================
// SmartFarm Cloud - Alert Service
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool';
import { publish } from './redis';
import { SensorReading, Alert, AlertThreshold, SensorType } from '../types';
import { logger } from '../utils/logger';

/**
 * Check incoming readings against active alert thresholds.
 * Returns triggered alerts.
 * Respects cooldown period to avoid alert storms.
 */
export async function checkAlerts(readings: SensorReading[]): Promise<Alert[]> {
  const triggered: Alert[] = [];

  // Group readings by garden + zone + sensor_type for efficient threshold lookup
  const grouped = new Map<string, SensorReading[]>();
  for (const r of readings) {
    const key = `${r.garden_id}:${r.zone_id}:${r.sensor_type}`;
    const arr = grouped.get(key) || [];
    arr.push(r);
    grouped.set(key, arr);
  }

  for (const [key, groupReadings] of grouped) {
    const [gardenId, zoneId, sensorType] = key.split(':');

    // Find matching thresholds
    // Match: exact zone, garden-level (zone_id IS NULL), or tenant-level (garden_id IS NULL)
    const thresholdResult = await query<AlertThreshold>(
      `SELECT at2.* FROM alert_thresholds at2
       JOIN gardens g ON g.id = $1
       WHERE at2.sensor_type = $2
         AND at2.is_active = true
         AND (
           (at2.garden_id = $1 AND at2.zone_id = $3) OR  -- exact match
           (at2.garden_id = $1 AND at2.zone_id IS NULL) OR -- garden-level
           (at2.garden_id IS NULL AND at2.zone_id IS NULL AND at2.tenant_id = g.tenant_id) -- tenant-level
         )
       ORDER BY at2.zone_id NULLS LAST, at2.garden_id NULLS LAST
       LIMIT 1`,
      [gardenId, sensorType, zoneId]
    );

    if (thresholdResult.rows.length === 0) continue;

    const threshold = thresholdResult.rows[0];

    // Check cooldown: don't re-alert within cooldown_minutes
    const cooldownCheck = await query(
      `SELECT id FROM alerts
       WHERE threshold_id = $1
         AND triggered_at > NOW() - INTERVAL '${threshold.cooldown_minutes} minutes'
         AND resolved_at IS NULL
       LIMIT 1`,
      [threshold.id]
    );

    if (cooldownCheck.rows.length > 0) continue;

    // Check latest reading against threshold
    const latest = groupReadings[groupReadings.length - 1];
    let breached = false;

    if (threshold.min_value !== null && latest.value < threshold.min_value) {
      breached = true;
    }
    if (threshold.max_value !== null && latest.value > threshold.max_value) {
      breached = true;
    }

    if (breached) {
      const alert = await createAlert(threshold, latest);
      if (alert) {
        triggered.push(alert);
      }
    }
  }

  return triggered;
}

/**
 * Create and persist an alert, then broadcast it.
 */
async function createAlert(
  threshold: AlertThreshold,
  reading: SensorReading
): Promise<Alert | null> {
  const id = uuidv4();
  const direction =
    threshold.min_value !== null && reading.value < threshold.min_value!
      ? 'below minimum'
      : 'above maximum';

  const message = `${sensorLabel(reading.sensor_type)} ${direction}: ` +
    `${reading.value} ${reading.unit} (threshold: ` +
    `${threshold.min_value ?? '-∞'}–${threshold.max_value ?? '∞'} ${reading.unit})`;

  const result = await query<Alert>(
    `INSERT INTO alerts
       (id, threshold_id, tenant_id, garden_id, zone_id, device_id,
        sensor_type, triggered_value, threshold_min, threshold_max,
        severity, message)
     SELECT $1, $2, g.tenant_id, $3, $4, $5, $6, $7, $8, $9, $10, $11
     FROM gardens g WHERE g.id = $3
     RETURNING *`,
    [
      id, threshold.id, reading.garden_id, reading.zone_id, reading.device_id,
      reading.sensor_type, reading.value, threshold.min_value, threshold.max_value,
      threshold.severity, message,
    ]
  );

  if (result.rows.length === 0) return null;

  const alert = result.rows[0];

  // Broadcast alert via Redis pub/sub
  publish('alerts', {
    type: 'alert',
    payload: alert,
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error({ err }, 'Failed to broadcast alert'));

  logger.warn(
    { alertId: id, severity: threshold.severity, gardenId: reading.garden_id, message },
    'Alert triggered'
  );

  return alert;
}

/**
 * Get alerts for a tenant with optional filters
 */
export async function getAlerts(
  tenantId: string,
  options: {
    gardenId?: string;
    severity?: string;
    acknowledged?: boolean;
    unresolvedOnly?: boolean;
    limit?: number;
    offset?: number;
  } = {}
) {
  const conditions: string[] = ['tenant_id = $1'];
  const params: any[] = [tenantId];
  let idx = 2;

  if (options.gardenId) {
    conditions.push(`garden_id = $${idx++}`);
    params.push(options.gardenId);
  }
  if (options.severity) {
    conditions.push(`severity = $${idx++}`);
    params.push(options.severity);
  }
  if (options.acknowledged !== undefined) {
    conditions.push(`acknowledged = $${idx++}`);
    params.push(options.acknowledged);
  }
  if (options.unresolvedOnly) {
    conditions.push('resolved_at IS NULL');
  }

  const limit = options.limit || 50;
  const offset = options.offset || 0;

  const sql = `
    SELECT * FROM alerts
    WHERE ${conditions.join(' AND ')}
    ORDER BY triggered_at DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Acknowledge an alert
 */
export async function acknowledgeAlert(alertId: string, tenantId: string): Promise<boolean> {
  const result = await query(
    `UPDATE alerts SET acknowledged = true, acknowledged_at = NOW()
     WHERE id = $1 AND tenant_id = $2 AND acknowledged = false`,
    [alertId, tenantId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Create an alert threshold
 */
export async function createThreshold(
  tenantId: string,
  data: {
    garden_id?: string;
    zone_id?: string;
    sensor_type: SensorType;
    min_value?: number;
    max_value?: number;
    severity?: string;
    cooldown_minutes?: number;
  }
): Promise<AlertThreshold> {
  const id = uuidv4();
  const result = await query<AlertThreshold>(
    `INSERT INTO alert_thresholds
       (id, tenant_id, garden_id, zone_id, sensor_type, min_value, max_value, severity, cooldown_minutes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id, tenantId, data.garden_id || null, data.zone_id || null,
     data.sensor_type, data.min_value ?? null, data.max_value ?? null,
     data.severity || 'warning', data.cooldown_minutes || 30]
  );
  return result.rows[0];
}

function sensorLabel(type: SensorType): string {
  const labels: Record<string, string> = {
    temperature: 'Temperature', moisture: 'Moisture', ec: 'EC',
    nitrogen: 'Nitrogen', phosphorus: 'Phosphorus', potassium: 'Potassium',
    ph: 'pH', salinity: 'Salinity',
  };
  return labels[type] || type;
}
