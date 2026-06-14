// ============================================================================
// SmartFarm Cloud - API Routes: Crop Seasons & Farm Inputs
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope, enforceGardenAccess } from '../middleware/auth';
import { query } from '../../db/pool';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { logger } from '../../utils/logger';

const router = Router();
router.use(authenticate);

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createSeasonSchema = z.object({
  garden_id: z.string().uuid(),
  zone_id: z.string().uuid().optional(),
  crop_type: z.string().min(1).max(50),
  variety: z.string().max(100).optional(),
  planting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected_harvest: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});

const createInputSchema = z.object({
  garden_id: z.string().uuid(),
  zone_id: z.string().uuid().optional(),
  season_id: z.string().uuid().optional(),
  input_type: z.enum(['fertilizer', 'pesticide', 'herbicide', 'water', 'mulch', 'lime', 'organic']),
  product_name: z.string().max(300).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().max(20).optional(),
  cost_vnd: z.number().int().positive().optional(),
  application_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});

// ============================================================================
// CROP SEASONS
// ============================================================================

// GET /api/v1/seasons?garden_id=... - List crop seasons
router.get('/seasons', async (req: Request, res: Response) => {
  try {
    const gardenId = req.query.garden_id as string;
    let sql = `
      SELECT cs.*, g.name as garden_name
      FROM crop_seasons cs
      JOIN gardens g ON g.id = cs.garden_id
      WHERE g.tenant_id = $1
    `;
    const params: any[] = [req.tenantId];

    if (gardenId) {
      sql += ' AND cs.garden_id = $2';
      params.push(gardenId);
    }

    sql += ' ORDER BY cs.planting_date DESC NULLS LAST, cs.created_at DESC';

    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rows.length });
  } catch (err) {
    logger.error({ err }, 'List seasons error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/v1/seasons - Create crop season
router.post('/seasons', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = createSeasonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    // Verify garden access
    if (req.gardenId && parsed.data.garden_id !== req.gardenId) {
      res.status(403).json({ error: 'garden_access_denied' });
      return;
    }

    const id = uuidv4();
    const result = await query(
      `INSERT INTO crop_seasons (id, garden_id, zone_id, crop_type, variety, planting_date, expected_harvest, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [id, parsed.data.garden_id, parsed.data.zone_id || null, parsed.data.crop_type,
       parsed.data.variety || null, parsed.data.planting_date || null,
       parsed.data.expected_harvest || null, parsed.data.notes || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create season error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// PATCH /api/v1/seasons/:id - Update crop season (e.g., mark harvested)
router.patch('/seasons/:id', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const { status, actual_harvest, yield_kg, yield_kg_ha, notes } = req.body;

    const result = await query(
      `UPDATE crop_seasons SET
         status = COALESCE($1, status),
         actual_harvest = COALESCE($2, actual_harvest),
         yield_kg = COALESCE($3, yield_kg),
         yield_kg_ha = COALESCE($4, yield_kg_ha),
         notes = COALESCE($5, notes),
         updated_at = NOW()
       WHERE id = $6
         AND garden_id IN (SELECT id FROM gardens WHERE tenant_id = $7)
       RETURNING *`,
      [status || null, actual_harvest || null, yield_kg || null,
       yield_kg_ha || null, notes || null, req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Update season error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ============================================================================
// FARM INPUTS (Phân bón, thuốc, nước...)
// ============================================================================

// GET /api/v1/inputs?garden_id=...&input_type=... - List inputs
router.get('/', async (req: Request, res: Response) => {
  try {
    const gardenId = req.query.garden_id as string;
    const inputType = req.query.input_type as string;
    const seasonId = req.query.season_id as string;
    const from = req.query.from as string;
    const to = req.query.to as string;

    let sql = `
      SELECT i.*, g.name as garden_name, z.name as zone_name
      FROM inputs i
      JOIN gardens g ON g.id = i.garden_id
      LEFT JOIN zones z ON z.id = i.zone_id
      WHERE g.tenant_id = $1
    `;
    const params: any[] = [req.tenantId];
    let idx = 2;

    if (gardenId) { sql += ` AND i.garden_id = $${idx++}`; params.push(gardenId); }
    if (inputType) { sql += ` AND i.input_type = $${idx++}`; params.push(inputType); }
    if (seasonId) { sql += ` AND i.season_id = $${idx++}`; params.push(seasonId); }
    if (from) { sql += ` AND i.application_date >= $${idx++}`; params.push(from); }
    if (to) { sql += ` AND i.application_date <= $${idx++}`; params.push(to); }

    sql += ' ORDER BY i.application_date DESC NULLS LAST, i.created_at DESC';

    const result = await query(sql, params);
    res.json({ data: result.rows, count: result.rows.length });
  } catch (err) {
    logger.error({ err }, 'List inputs error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/v1/inputs - Record farm input
router.post('/', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = createInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    if (req.gardenId && parsed.data.garden_id !== req.gardenId) {
      res.status(403).json({ error: 'garden_access_denied' });
      return;
    }

    const id = uuidv4();
    const result = await query(
      `INSERT INTO inputs (id, garden_id, zone_id, season_id, input_type, product_name, quantity, unit, cost_vnd, application_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [id, parsed.data.garden_id, parsed.data.zone_id || null, parsed.data.season_id || null,
       parsed.data.input_type, parsed.data.product_name || null, parsed.data.quantity || null,
       parsed.data.unit || null, parsed.data.cost_vnd || null, parsed.data.application_date || null,
       parsed.data.notes || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create input error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/v1/inputs/summary?garden_id=... - Input cost summary
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const gardenId = req.query.garden_id as string;
    const periodDays = parseInt(req.query.period_days as string) || 365;

    let sql = `
      SELECT
        i.input_type,
        COUNT(*) as application_count,
        SUM(i.quantity) as total_quantity,
        SUM(i.cost_vnd) as total_cost_vnd,
        AVG(i.cost_vnd) as avg_cost_vnd
      FROM inputs i
      JOIN gardens g ON g.id = i.garden_id
      WHERE g.tenant_id = $1
        AND i.application_date >= NOW() - INTERVAL '${periodDays} days'
    `;
    const params: any[] = [req.tenantId];

    if (gardenId) {
      sql += ' AND i.garden_id = $2';
      params.push(gardenId);
    }

    sql += ' GROUP BY i.input_type ORDER BY total_cost_vnd DESC';

    const result = await query(sql, params);

    const totalCost = result.rows.reduce((sum: number, r: any) => sum + (parseInt(r.total_cost_vnd) || 0), 0);

    res.json({
      data: result.rows,
      total_cost_vnd: totalCost,
      period_days: periodDays,
    });
  } catch (err) {
    logger.error({ err }, 'Input summary error');
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
