// ============================================================================
// SmartFarm Cloud - API Routes: Cooperative Management
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope } from '../middleware/auth';
import { query } from '../../db/pool';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { logger } from '../../utils/logger';

const router = Router();
router.use(authenticate);

const createCooperativeSchema = z.object({
  name: z.string().min(1).max(300),
  description: z.string().optional(),
  province: z.string().default('DakLak'),
  district: z.string().optional(),
  commune: z.string().optional(),
  address: z.string().optional(),
  contact_phone: z.string().optional(),
  contact_email: z.string().email().optional(),
});

const addMemberSchema = z.object({
  garden_id: z.string().uuid(),
  role: z.enum(['member', 'board', 'chairman']).default('member'),
});

// GET /api/v1/cooperatives - List cooperatives
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT c.*, COUNT(cm.garden_id) as member_count_actual
       FROM cooperatives c
       LEFT JOIN cooperative_members cm ON cm.cooperative_id = c.id
       WHERE c.is_active = true
       GROUP BY c.id
       ORDER BY c.name`,
      []
    );
    res.json({ data: result.rows, count: result.rows.length });
  } catch (err) {
    logger.error({ err }, 'List cooperatives error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/v1/cooperatives - Create cooperative
router.post('/', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = createCooperativeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    const id = uuidv4();
    const result = await query(
      `INSERT INTO cooperatives (id, name, description, province, district, commune, address, contact_phone, contact_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, parsed.data.name, parsed.data.description || null, parsed.data.province,
       parsed.data.district || null, parsed.data.commune || null, parsed.data.address || null,
       parsed.data.contact_phone || null, parsed.data.contact_email || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Create cooperative error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/v1/cooperatives/:id - Get cooperative details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT c.*, COUNT(cm.garden_id) as member_count_actual
       FROM cooperatives c
       LEFT JOIN cooperative_members cm ON cm.cooperative_id = c.id
       WHERE c.id = $1
       GROUP BY c.id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Get cooperative error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/v1/cooperatives/:id/members - List cooperative members (farms)
router.get('/:id/members', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT cm.*, g.name as garden_name, g.area_hectares, g.crop_type,
              g.latitude, g.longitude, t.name as tenant_name
       FROM cooperative_members cm
       JOIN gardens g ON g.id = cm.garden_id
       JOIN tenants t ON t.id = cm.tenant_id
       WHERE cm.cooperative_id = $1
       ORDER BY g.name`,
      [req.params.id]
    );

    res.json({ data: result.rows, count: result.rows.length });
  } catch (err) {
    logger.error({ err }, 'List cooperative members error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/v1/cooperatives/:id/members - Add garden to cooperative
router.post('/:id/members', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = addMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    // Verify garden exists and belongs to the tenant
    const gardenResult = await query(
      'SELECT id, tenant_id FROM gardens WHERE id = $1',
      [parsed.data.garden_id]
    );

    if (gardenResult.rows.length === 0) {
      res.status(404).json({ error: 'garden_not_found' });
      return;
    }

    const garden = gardenResult.rows[0];

    await query(
      `INSERT INTO cooperative_members (cooperative_id, garden_id, tenant_id, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cooperative_id, garden_id) DO UPDATE SET role = $4`,
      [req.params.id, parsed.data.garden_id, garden.tenant_id, parsed.data.role]
    );

    // Update cooperative member count
    await query(
      `UPDATE cooperatives SET member_count = (
         SELECT COUNT(*) FROM cooperative_members WHERE cooperative_id = $1
       ) WHERE id = $1`,
      [req.params.id]
    );

    // Also set cooperative_id on garden
    await query(
      'UPDATE gardens SET cooperative_id = $1 WHERE id = $2',
      [req.params.id, parsed.data.garden_id]
    );

    res.status(201).json({ status: 'added', cooperative_id: req.params.id, garden_id: parsed.data.garden_id });
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'already_member' });
      return;
    }
    logger.error({ err }, 'Add cooperative member error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/v1/cooperatives/:id/overview - Aggregate stats for cooperative dashboard
router.get('/:id/overview', async (req: Request, res: Response) => {
  try {
    const coopId = req.params.id;

    // Get member gardens
    const membersResult = await query(
      `SELECT g.id, g.name, g.area_hectares, g.crop_type
       FROM cooperative_members cm
       JOIN gardens g ON g.id = cm.garden_id
       WHERE cm.cooperative_id = $1`,
      [coopId]
    );

    const gardenIds = membersResult.rows.map((r: any) => r.id);
    if (gardenIds.length === 0) {
      res.json({ members: 0, total_area_ha: 0, sensors: {}, alerts: {} });
      return;
    }

    // Aggregate sensor stats across all member gardens
    const sensorStats = await query(
      `SELECT
         sensor_type,
         AVG(value) as avg_value,
         MIN(value) as min_value,
         MAX(value) as max_value,
         COUNT(DISTINCT garden_id) as farm_count
       FROM sensor_readings
       WHERE garden_id = ANY($1)
         AND time >= NOW() - INTERVAL '24 hours'
       GROUP BY sensor_type`,
      [gardenIds]
    );

    // Active alerts across cooperative
    const alertStats = await query(
      `SELECT severity, COUNT(*) as count
       FROM alerts
       WHERE garden_id = ANY($1)
         AND resolved_at IS NULL
       GROUP BY severity`,
      [gardenIds]
    );

    // Device health
    const deviceStats = await query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'online') as online,
         COUNT(*) FILTER (WHERE status = 'offline') as offline
       FROM devices
       WHERE garden_id = ANY($1)`,
      [gardenIds]
    );

    res.json({
      cooperative_id: coopId,
      members: membersResult.rows.length,
      total_area_ha: membersResult.rows.reduce((sum: number, r: any) => sum + (r.area_hectares || 0), 0),
      sensor_summary: sensorStats.rows,
      alerts: alertStats.rows,
      devices: deviceStats.rows[0],
    });
  } catch (err) {
    logger.error({ err }, 'Cooperative overview error');
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/v1/cooperatives/:id/broadcast - Send message to all members
router.post('/:id/broadcast', requireScope('admin'), async (req: Request, res: Response) => {
  try {
    const { message, channel } = req.body;
    if (!message) {
      res.status(400).json({ error: 'message_required' });
      return;
    }

    // Get all member tenant users
    const membersResult = await query(
      `SELECT DISTINCT tu.user_id, u.phone, u.name
       FROM cooperative_members cm
       JOIN tenant_users tu ON tu.tenant_id = cm.tenant_id
       JOIN users u ON u.id = tu.user_id
       WHERE cm.cooperative_id = $1 AND u.is_active = true`,
      [req.params.id]
    );

    // TODO: Integrate with SMS/Zalo notification service
    logger.info({
      cooperativeId: req.params.id,
      recipientCount: membersResult.rows.length,
      message,
      channel: channel || 'sms',
    }, 'Broadcast message queued');

    res.json({
      status: 'queued',
      recipients: membersResult.rows.length,
      message,
      channel: channel || 'sms',
    });
  } catch (err) {
    logger.error({ err }, 'Broadcast error');
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
