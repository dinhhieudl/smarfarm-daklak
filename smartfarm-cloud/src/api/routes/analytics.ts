// ============================================================================
// SmartFarm Cloud - API Routes: Cross-Farm Analytics
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope } from '../middleware/auth';
import { analyticsQuerySchema } from '../../utils/validation';
import { crossFarmAnalytics, detectAnomalies, gardenSummary, benchmarkGarden } from '../../services/analytics';
import { SensorType } from '../../types';

const router = Router();
router.use(authenticate);

// POST /api/v1/analytics/query - Cross-farm analytics query
router.post('/query', requireScope('read'), async (req: Request, res: Response) => {
  try {
    const parsed = analyticsQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const result = await crossFarmAnalytics(req.tenantId!, {
      ...parsed.data,
      sensor_type: parsed.data.sensor_type as SensorType,
    });
    res.json(result);
  } catch (err) {
    throw err;
  }
});

// GET /api/v1/analytics/garden/:id/summary - Garden dashboard summary
router.get('/garden/:id/summary', async (req: Request, res: Response) => {
  const periodHours = parseInt(req.query.period_hours as string) || 24;

  try {
    const summary = await gardenSummary(req.tenantId!, req.params.id, periodHours);
    res.json(summary);
  } catch (err) {
    throw err;
  }
});

// GET /api/v1/analytics/garden/:id/anomalies - Detect anomalies
router.get('/garden/:id/anomalies', requireScope('read'), async (req: Request, res: Response) => {
  const { sensor_type, from, to } = req.query;

  if (!sensor_type || !from || !to) {
    res.status(400).json({
      error: 'missing_params',
      message: 'sensor_type, from, and to are required',
    });
    return;
  }

  try {
    const anomalies = await detectAnomalies(
      req.tenantId!,
      req.params.id,
      sensor_type as SensorType,
      new Date(from as string),
      new Date(to as string)
    );
    res.json({ data: anomalies, count: anomalies.length });
  } catch (err) {
    throw err;
  }
});

// GET /api/v1/analytics/garden/:id/benchmark - Benchmark against crop type average
router.get('/garden/:id/benchmark', requireScope('read'), async (req: Request, res: Response) => {
  const { sensor_type, period_days } = req.query;

  if (!sensor_type) {
    res.status(400).json({ error: 'sensor_type_required' });
    return;
  }

  try {
    const result = await benchmarkGarden(
      req.tenantId!,
      req.params.id,
      sensor_type as SensorType,
      parseInt(period_days as string) || 30
    );
    res.json(result);
  } catch (err) {
    throw err;
  }
});

export default router;
