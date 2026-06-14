// ============================================================================
// SmartFarm Cloud - Cross-Farm Analytics Engine
// ============================================================================
// Provides aggregate insights across all farms for a tenant:
// - Cross-farm comparisons
// - Trend analysis
// - Anomaly detection (statistical outliers)
// - Benchmarking by crop type / region
// ============================================================================

import { query } from '../db/pool';
import { cacheGet, cacheSet } from './redis';
import { AnalyticsQuery, SensorType } from '../types';
import { logger } from '../utils/logger';

const ANALYTICS_CACHE_TTL = 300; // 5 minutes

/**
 * Cross-farm analytics: aggregate sensor data across multiple gardens.
 * Supports grouping by garden, zone, crop_type, or none (total aggregate).
 */
export async function crossFarmAnalytics(
  tenantId: string,
  params: AnalyticsQuery
): Promise<{
  data: Array<{
    group_key: string;
    sensor_type: string;
    aggregation: string;
    value: number;
    reading_count: number;
    period: { from: string; to: string };
  }>;
  comparison?: Array<{
    group_key: string;
    value: number;
    change_percent: number;
  }>;
}> {
  // Cache key based on query params
  const cacheKey = `analytics:${tenantId}:${JSON.stringify(params)}`;
  const cached = await cacheGet<any>(cacheKey);
  if (cached) return cached;

  const { garden_ids, sensor_type, from, to, aggregation, group_by } = params;

  // Build the aggregation expression
  let aggExpr: string;
  switch (aggregation) {
    case 'min':
      aggExpr = 'MIN(value)';
      break;
    case 'max':
      aggExpr = 'MAX(value)';
      break;
    case 'percentile_95':
      aggExpr = 'PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)';
      break;
    default:
      aggExpr = 'AVG(value)';
  }

  // Build GROUP BY expression
  let groupExpr: string;
  let selectGroup: string;
  switch (group_by) {
    case 'garden':
      groupExpr = 'sr.garden_id';
      selectGroup = 'g.name as group_key';
      break;
    case 'zone':
      groupExpr = 'sr.garden_id, sr.zone_id';
      selectGroup = "g.name || ' / ' || z.name as group_key";
      break;
    case 'crop_type':
      groupExpr = 'g.crop_type';
      selectGroup = 'g.crop_type as group_key';
      break;
    default:
      groupExpr = "'all'";
      selectGroup = "'all' as group_key";
  }

  // Main query using continuous aggregate (sensor_hourly) for performance
  let gardenFilter = '';
  const params_sql: any[] = [tenantId, sensor_type, from, to];
  let paramIdx = 5;

  if (garden_ids && garden_ids.length > 0) {
    const placeholders = garden_ids.map(() => `$${paramIdx++}`).join(', ');
    gardenFilter = `AND sr.garden_id IN (${placeholders})`;
    params_sql.push(...garden_ids);
  }

  const sql = `
    WITH farm_data AS (
      SELECT
        ${groupExpr} as grp,
        ${aggExpr} as agg_value,
        COUNT(*) as reading_count
      FROM sensor_hourly sr
      JOIN gardens g ON g.id = sr.garden_id
      LEFT JOIN zones z ON z.id = sr.zone_id
      WHERE g.tenant_id = $1
        AND sr.sensor_type = $2
        AND sr.bucket >= $3
        AND sr.bucket <= $4
        ${gardenFilter}
      GROUP BY ${groupExpr}
    )
    SELECT
      ${selectGroup},
      fd.agg_value,
      fd.reading_count
    FROM farm_data fd
    JOIN gardens g ON g.id = (
      SELECT id FROM gardens WHERE tenant_id = $1 LIMIT 1
    )
    LEFT JOIN zones z ON z.garden_id = g.id
    ORDER BY fd.agg_value DESC
  `;

  // Simplified query without the awkward join
  const simpleSql = `
    SELECT
      ${group_by === 'crop_type' ? "g.crop_type as group_key" :
        group_by === 'zone' ? "g.name || ' / ' || z.name as group_key" :
        group_by === 'garden' ? 'g.name as group_key' :
        "'all' as group_key"},
      ${aggExpr} as value,
      COUNT(*) as reading_count
    FROM sensor_hourly sr
    JOIN gardens g ON g.id = sr.garden_id
    LEFT JOIN zones z ON z.id = sr.zone_id
    WHERE g.tenant_id = $1
      AND sr.sensor_type = $2
      AND sr.bucket >= $3
      AND sr.bucket <= $4
      ${gardenFilter}
    GROUP BY ${group_by === 'crop_type' ? 'g.crop_type' :
               group_by === 'zone' ? 'g.name, z.name' :
               group_by === 'garden' ? 'g.name' :
               "'all'"}
    ORDER BY value DESC
  `;

  const result = await query(simpleSql, params_sql);

  const data = result.rows.map((row: any) => ({
    group_key: row.group_key,
    sensor_type,
    aggregation,
    value: parseFloat(row.value),
    reading_count: parseInt(row.reading_count),
    period: { from, to },
  }));

  let comparison: any[] | undefined;

  // Optional: compare with previous period or same period last year
  if (params.compare_with && data.length > 0) {
    const fromDt = new Date(from);
    const toDt = new Date(to);
    const duration = toDt.getTime() - fromDt.getTime();

    let compFrom: Date, compTo: Date;
    if (params.compare_with === 'previous_period') {
      compFrom = new Date(fromDt.getTime() - duration);
      compTo = fromDt;
    } else {
      compFrom = new Date(fromDt);
      compFrom.setFullYear(compFrom.getFullYear() - 1);
      compTo = new Date(toDt);
      compTo.setFullYear(compTo.getFullYear() - 1);
    }

    const compParams = { ...params, from: compFrom.toISOString(), to: compTo.toISOString(), compare_with: undefined };
    const compResult = await crossFarmAnalytics(tenantId, compParams);

    comparison = data.map((d) => {
      const prev = compResult.data.find((c) => c.group_key === d.group_key);
      const prevVal = prev?.value || 0;
      const changePercent = prevVal > 0 ? ((d.value - prevVal) / prevVal) * 100 : 0;
      return {
        group_key: d.group_key,
        value: prevVal,
        change_percent: Math.round(changePercent * 100) / 100,
      };
    });
  }

  const output = { data, comparison };
  await cacheSet(cacheKey, output, ANALYTICS_CACHE_TTL);
  return output;
}

/**
 * Anomaly detection: find readings that are statistical outliers
 * (>2 std deviations from the mean for that zone/sensor combo)
 */
export async function detectAnomalies(
  tenantId: string,
  gardenId: string,
  sensorType: SensorType,
  from: Date,
  to: Date
): Promise<Array<{
  time: string;
  zone_id: string;
  value: number;
  z_score: number;
  mean: number;
  stddev: number;
}>> {
  const result = await query(
    `WITH stats AS (
       SELECT zone_id, AVG(value) as mean, STDDEV(value) as stddev
       FROM sensor_readings sr
       JOIN gardens g ON g.id = sr.garden_id
       WHERE g.tenant_id = $1
         AND sr.garden_id = $2
         AND sr.sensor_type = $3
         AND sr.time >= $4
         AND sr.time <= $5
       GROUP BY zone_id
     )
     SELECT
       sr.time,
       sr.zone_id,
       sr.value,
       ABS(sr.value - s.mean) / NULLIF(s.stddev, 0) as z_score,
       s.mean,
       s.stddev
     FROM sensor_readings sr
     JOIN stats s ON s.zone_id = sr.zone_id
     JOIN gardens g ON g.id = sr.garden_id
     WHERE g.tenant_id = $1
       AND sr.garden_id = $2
       AND sr.sensor_type = $3
       AND sr.time >= $4
       AND sr.time <= $5
       AND ABS(sr.value - s.mean) / NULLIF(s.stddev, 0) > 2.0
     ORDER BY z_score DESC
     LIMIT 100`,
    [tenantId, gardenId, sensorType, from, to]
  );

  return result.rows.map((r: any) => ({
    time: r.time,
    zone_id: r.zone_id,
    value: parseFloat(r.value),
    z_score: parseFloat(r.z_score),
    mean: parseFloat(r.mean),
    stddev: parseFloat(r.stddev),
  }));
}

/**
 * Get summary statistics for a garden dashboard
 */
export async function gardenSummary(
  tenantId: string,
  gardenId: string,
  periodHours: number = 24
): Promise<{
  sensors: Array<{
    sensor_type: string;
    zone_count: number;
    latest_value: number | null;
    avg_value: number;
    min_value: number;
    max_value: number;
    trend: 'rising' | 'falling' | 'stable';
  }>;
  device_count: number;
  online_devices: number;
  active_alerts: number;
  total_readings: number;
}> {
  // Sensor summaries
  const sensorResult = await query(
    `SELECT
       sr.sensor_type,
       COUNT(DISTINCT sr.zone_id) as zone_count,
       (SELECT value FROM sensor_readings
        WHERE garden_id = $1 AND sensor_type = sr.sensor_type
        ORDER BY time DESC LIMIT 1) as latest_value,
       AVG(sr.value) as avg_value,
       MIN(sr.value) as min_value,
       MAX(sr.value) as max_value
     FROM sensor_readings sr
     WHERE sr.garden_id = $1
       AND sr.time >= NOW() - INTERVAL '${periodHours} hours'
     GROUP BY sr.sensor_type`,
    [gardenId]
  );

  // Trend: compare last 6h avg vs previous 6h
  const sensors = [];
  for (const row of sensorResult.rows) {
    const trendResult = await query(
      `WITH recent AS (
         SELECT AVG(value) as avg_val
         FROM sensor_readings
         WHERE garden_id = $1 AND sensor_type = $2
           AND time >= NOW() - INTERVAL '6 hours'
       ),
       previous AS (
         SELECT AVG(value) as avg_val
         FROM sensor_readings
         WHERE garden_id = $1 AND sensor_type = $2
           AND time >= NOW() - INTERVAL '12 hours'
           AND time < NOW() - INTERVAL '6 hours'
       )
       SELECT
         r.avg_val as recent_avg,
         p.avg_val as previous_avg
       FROM recent r, previous p`,
      [gardenId, row.sensor_type]
    );

    let trend: 'rising' | 'falling' | 'stable' = 'stable';
    if (trendResult.rows.length > 0) {
      const { recent_avg, previous_avg } = trendResult.rows[0];
      if (recent_avg && previous_avg) {
        const diff = (recent_avg - previous_avg) / previous_avg;
        if (diff > 0.05) trend = 'rising';
        else if (diff < -0.05) trend = 'falling';
      }
    }

    sensors.push({
      sensor_type: row.sensor_type,
      zone_count: parseInt(row.zone_count),
      latest_value: row.latest_value ? parseFloat(row.latest_value) : null,
      avg_value: parseFloat(row.avg_value),
      min_value: parseFloat(row.min_value),
      max_value: parseFloat(row.max_value),
      trend,
    });
  }

  // Device stats
  const deviceResult = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'online') as online
     FROM devices WHERE garden_id = $1`,
    [gardenId]
  );

  // Active alerts
  const alertResult = await query(
    `SELECT COUNT(*) as count FROM alerts
     WHERE garden_id = $1 AND tenant_id = $2 AND resolved_at IS NULL`,
    [gardenId, tenantId]
  );

  // Total readings in period
  const readingsResult = await query(
    `SELECT COUNT(*) as count FROM sensor_readings
     WHERE garden_id = $1 AND time >= NOW() - INTERVAL '${periodHours} hours'`,
    [gardenId]
  );

  return {
    sensors,
    device_count: parseInt(deviceResult.rows[0].total),
    online_devices: parseInt(deviceResult.rows[0].online),
    active_alerts: parseInt(alertResult.rows[0].count),
    total_readings: parseInt(readingsResult.rows[0].count),
  };
}

/**
 * Benchmarking: compare a garden against all farms with the same crop type
 */
export async function benchmarkGarden(
  tenantId: string,
  gardenId: string,
  sensorType: SensorType,
  periodDays: number = 30
): Promise<{
  garden_value: number;
  crop_avg: number;
  crop_min: number;
  crop_max: number;
  percentile: number;
  crop_type: string;
}> {
  const result = await query(
    `WITH garden_val AS (
       SELECT AVG(value) as val
       FROM sensor_readings sr
       WHERE sr.garden_id = $1
         AND sr.sensor_type = $2
         AND sr.time >= NOW() - INTERVAL '${periodDays} days'
     ),
     crop_stats AS (
       SELECT
         g.crop_type,
         AVG(sr.value) as avg_val,
         MIN(sr.value) as min_val,
         MAX(sr.value) as max_val,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY sr.value) as median
       FROM sensor_readings sr
       JOIN gardens g ON g.id = sr.garden_id
       WHERE g.crop_type = (SELECT crop_type FROM gardens WHERE id = $1)
         AND sr.sensor_type = $2
         AND sr.time >= NOW() - INTERVAL '${periodDays} days'
       GROUP BY g.crop_type
     ),
     garden_rank AS (
       SELECT
         g.id,
         AVG(sr.value) as avg_val,
         PERCENT_RANK() OVER (ORDER BY AVG(sr.value)) as pct_rank
       FROM sensor_readings sr
       JOIN gardens g ON g.id = sr.garden_id
       WHERE g.crop_type = (SELECT crop_type FROM gardens WHERE id = $1)
         AND sr.sensor_type = $2
         AND sr.time >= NOW() - INTERVAL '${periodDays} days'
       GROUP BY g.id
     )
     SELECT
       gv.val as garden_value,
       cs.avg_val as crop_avg,
       cs.min_val as crop_min,
       cs.max_val as crop_max,
       gr.pct_rank as percentile,
       cs.crop_type
     FROM garden_val gv, crop_stats cs, garden_rank gr
     WHERE gr.id = $1`,
    [gardenId, sensorType]
  );

  if (result.rows.length === 0) {
    return { garden_value: 0, crop_avg: 0, crop_min: 0, crop_max: 0, percentile: 0, crop_type: '' };
  }

  const row = result.rows[0];
  return {
    garden_value: parseFloat(row.garden_value),
    crop_avg: parseFloat(row.crop_avg),
    crop_min: parseFloat(row.crop_min),
    crop_max: parseFloat(row.crop_max),
    percentile: Math.round(parseFloat(row.percentile) * 100),
    crop_type: row.crop_type,
  };
}
