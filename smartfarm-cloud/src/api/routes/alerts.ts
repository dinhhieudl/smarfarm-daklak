// ============================================================================
// SmartFarm Cloud - API Routes: Alerts & Thresholds
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope } from '../middleware/auth';
import { createThresholdSchema } from '../../utils/validation';
import * as alertService from '../../services/alert';

const router = Router();
router.use(authenticate);

// --- Thresholds ---

// POST /api/v1/alerts/thresholds - Create alert threshold
router.post('/thresholds', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = createThresholdSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const threshold = await alertService.createThreshold(req.tenantId!, parsed.data);
    res.status(201).json(threshold);
  } catch (err) {
    throw err;
  }
});

// GET /api/v1/alerts/thresholds - List thresholds
router.get('/thresholds', async (req: Request, res: Response) => {
  const { query } = require('../../db/pool');
  const gardenId = req.query.garden_id as string;

  let sql = 'SELECT * FROM alert_thresholds WHERE tenant_id = $1';
  const params: any[] = [req.tenantId];

  if (gardenId) {
    sql += ' AND (garden_id = $2 OR garden_id IS NULL)';
    params.push(gardenId);
  }

  sql += ' ORDER BY created_at DESC';
  const result = await query(sql, params);
  res.json({ data: result.rows, count: result.rows.length });
});

// DELETE /api/v1/alerts/thresholds/:id - Delete threshold
router.delete('/thresholds/:id', requireScope('admin'), async (req: Request, res: Response) => {
  const { query } = require('../../db/pool');
  const result = await query(
    'DELETE FROM alert_thresholds WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );

  if (result.rowCount === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({ status: 'deleted' });
});

// --- Alerts ---

// GET /api/v1/alerts - List alerts with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const alerts = await alertService.getAlerts(req.tenantId!, {
      gardenId: req.query.garden_id as string,
      severity: req.query.severity as string,
      acknowledged: req.query.acknowledged === 'true' ? true : req.query.acknowledged === 'false' ? false : undefined,
      unresolvedOnly: req.query.unresolved === 'true',
      limit: parseInt(req.query.limit as string) || 50,
      offset: parseInt(req.query.offset as string) || 0,
    });

    res.json({ data: alerts, count: alerts.length });
  } catch (err) {
    throw err;
  }
});

// PATCH /api/v1/alerts/:id/acknowledge - Acknowledge an alert
router.patch('/:id/acknowledge', async (req: Request, res: Response) => {
  const success = await alertService.acknowledgeAlert(req.params.id, req.tenantId!);
  if (!success) {
    res.status(404).json({ error: 'not_found_or_already_acknowledged' });
    return;
  }
  res.json({ status: 'acknowledged' });
});

export default router;
