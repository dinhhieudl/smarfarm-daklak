// ============================================================================
// SmartFarm Cloud - API Routes: Sensor Data Ingestion & Query
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope, enforceGardenAccess } from '../middleware/auth';
import { ingestionRateLimiter } from '../middleware/rateLimiter';
import { batchSensorPayloadSchema, queryParamsSchema } from '../../utils/validation';
import { ingestBatch, querySensorData } from '../../services/sensor';
import { SensorType } from '../../types';

const router = Router();
router.use(authenticate);

// POST /api/v1/sensors/ingest - Batch sensor data upload (from edge agents)
router.post(
  '/ingest',
  requireScope('ingest'),
  ingestionRateLimiter(),
  async (req: Request, res: Response) => {
    try {
      // Support both single payload and array of payloads
      const payloads = Array.isArray(req.body) ? req.body : [req.body];
      const results = [];

      for (const payload of payloads) {
        const parsed = batchSensorPayloadSchema.safeParse(payload);
        if (!parsed.success) {
          results.push({
            device_eui: payload.device_eui || 'unknown',
            status: 'error',
            errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
          });
          continue;
        }

        // Garden access check
        if (req.gardenId && parsed.data.garden_id !== req.gardenId) {
          results.push({
            device_eui: parsed.data.device_eui,
            status: 'error',
            errors: ['Garden access denied'],
          });
          continue;
        }

        const result = await ingestBatch({
          ...parsed.data,
          readings: parsed.data.readings.map((r: any) => ({
            ...r,
            sensor_type: r.sensor_type as SensorType,
          })),
        });
        results.push({
          device_eui: parsed.data.device_eui,
          status: result.inserted > 0 ? 'ok' : 'error',
          inserted: result.inserted,
          errors: result.errors,
          alerts: result.alerts,
        });
      }

      const allOk = results.every((r) => r.status === 'ok');
      const totalInserted = results.reduce((sum, r) => sum + (r.inserted || 0), 0);

      res.status(allOk ? 200 : 207).json({
        status: allOk ? 'ok' : 'partial',
        total_inserted: totalInserted,
        results,
      });
    } catch (err) {
      throw err;
    }
  }
);

// GET /api/v1/sensors/data - Query sensor data
router.get('/data', enforceGardenAccess, async (req: Request, res: Response) => {
  try {
    const parsed = queryParamsSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const { garden_id, zone_id, sensor_type, from, to, granularity, limit, offset } = parsed.data;

    // Must specify garden_id (or have one from API key)
    const targetGarden = garden_id || req.gardenId;
    if (!targetGarden) {
      res.status(400).json({ error: 'garden_id_required', message: 'garden_id query param is required' });
      return;
    }

    const data = await querySensorData(targetGarden, {
      zoneId: zone_id,
      sensorType: sensor_type as SensorType | undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      granularity,
      limit,
      offset,
    });

    res.json({
      data,
      count: data.length,
      garden_id: targetGarden,
      granularity,
    });
  } catch (err) {
    throw err;
  }
});

// GET /api/v1/sensors/latest - Get latest readings for a garden (all sensors)
router.get('/latest', enforceGardenAccess, async (req: Request, res: Response) => {
  const gardenId = (req.query.garden_id as string) || req.gardenId;
  if (!gardenId) {
    res.status(400).json({ error: 'garden_id_required' });
    return;
  }

  const { pool } = require('../../db/pool');
  const result = await pool.query(
    `SELECT DISTINCT ON (zone_id, sensor_type)
       time, zone_id, sensor_type, value, unit, quality, battery_voltage, rssi
     FROM sensor_readings
     WHERE garden_id = $1
     ORDER BY zone_id, sensor_type, time DESC`,
    [gardenId]
  );

  res.json({ data: result.rows, garden_id: gardenId });
});

export default router;
