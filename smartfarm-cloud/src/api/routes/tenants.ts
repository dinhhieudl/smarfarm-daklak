// ============================================================================
// SmartFarm Cloud - API Routes: Tenant & Garden Management
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope, enforceGardenAccess } from '../middleware/auth';
import { createGardenSchema, createZoneSchema, createTenantSchema } from '../../utils/validation';
import * as deviceService from '../../services/device';
import { query } from '../../db/pool';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Tenant ---

// POST /api/v1/tenants - Create a new tenant (admin only)
router.post('/', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = createTenantSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const { name, email, plan } = parsed.data;
    const id = uuidv4();

    const result = await query(
      `INSERT INTO tenants (id, name, email, plan)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, name, email, plan]
    );

    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === '23505') { // unique violation
      res.status(409).json({ error: 'duplicate', message: 'Email already registered' });
      return;
    }
    throw err;
  }
});

// GET /api/v1/tenants/:id - Get tenant details
router.get('/:id', async (req: Request, res: Response) => {
  // Users can only see their own tenant
  if (req.params.id !== req.tenantId && !req.scopes?.includes('admin')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const result = await query('SELECT * FROM tenants WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(result.rows[0]);
});

// --- Gardens ---

// GET /api/v1/gardens - List gardens for authenticated tenant
router.get('/', async (req: Request, res: Response) => {
  const gardens = await deviceService.listGardens(req.tenantId!);
  res.json({ data: gardens, count: gardens.length });
});

// POST /api/v1/gardens - Create a garden
router.post('/', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = createGardenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const garden = await deviceService.createGarden(req.tenantId!, parsed.data);
    res.status(201).json(garden);
  } catch (err) {
    throw err;
  }
});

// GET /api/v1/gardens/:id - Get garden details
router.get('/:id', enforceGardenAccess, async (req: Request, res: Response) => {
  const result = await query(
    'SELECT * FROM gardens WHERE id = $1 AND tenant_id = $2',
    [req.params.id, req.tenantId]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(result.rows[0]);
});

// --- Zones ---

// GET /api/v1/gardens/:gardenId/zones - List zones for a garden
router.get('/:gardenId/zones', enforceGardenAccess, async (req: Request, res: Response) => {
  const zones = await deviceService.listZones(req.params.gardenId);
  res.json({ data: zones, count: zones.length });
});

// POST /api/v1/gardens/:gardenId/zones - Create a zone
router.post('/:gardenId/zones', requireScope('admin'), enforceGardenAccess, async (req: Request, res: Response) => {
  try {
    const parsed = createZoneSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const zone = await deviceService.createZone(req.params.gardenId, parsed.data);
    res.status(201).json(zone);
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'duplicate', message: 'Zone number already exists in this garden' });
      return;
    }
    throw err;
  }
});

export default router;
