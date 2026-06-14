// ============================================================================
// SmartFarm Cloud - API Routes: Device Management
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate, requireScope, enforceGardenAccess } from '../middleware/auth';
import { createDeviceSchema } from '../../utils/validation';
import * as deviceService from '../../services/device';

const router = Router();
router.use(authenticate);

// GET /api/v1/devices?garden_id=... - List devices for a garden
router.get('/', enforceGardenAccess, async (req: Request, res: Response) => {
  const gardenId = req.query.garden_id as string || req.gardenId;
  if (!gardenId) {
    res.status(400).json({ error: 'garden_id_required' });
    return;
  }

  const devices = await deviceService.listDevices(gardenId, req.query.zone_id as string);
  res.json({ data: devices, count: devices.length });
});

// POST /api/v1/devices - Register a new device
router.post('/', requireScope('admin', 'ingest'), async (req: Request, res: Response) => {
  try {
    const parsed = createDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', details: parsed.error.issues });
      return;
    }

    // Verify garden access
    if (req.gardenId && parsed.data.garden_id !== req.gardenId) {
      res.status(403).json({ error: 'garden_access_denied' });
      return;
    }

    const device = await deviceService.registerDevice(
      parsed.data.garden_id,
      parsed.data.device_eui,
      parsed.data.name,
      parsed.data.device_type,
      parsed.data.zone_id,
      parsed.data.firmware_version
    );

    res.status(201).json(device);
  } catch (err: any) {
    if (err.code === '23505') {
      res.status(409).json({ error: 'duplicate', message: 'Device EUI already registered' });
      return;
    }
    throw err;
  }
});

// GET /api/v1/devices/:id - Get device details
router.get('/:id', async (req: Request, res: Response) => {
  const device = await deviceService.getDeviceById(req.params.id);
  if (!device) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  // Check garden access
  if (req.gardenId && device.garden_id !== req.gardenId) {
    res.status(403).json({ error: 'garden_access_denied' });
    return;
  }

  res.json(device);
});

// PATCH /api/v1/devices/:id/status - Update device status
router.patch('/:id/status', requireScope('admin', 'ingest'), async (req: Request, res: Response) => {
  const { status, battery_voltage, rssi } = req.body;

  if (!['online', 'offline', 'maintenance'].includes(status)) {
    res.status(400).json({ error: 'invalid_status' });
    return;
  }

  const device = await deviceService.getDeviceById(req.params.id);
  if (!device) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  await deviceService.updateDeviceStatus(req.params.id, status, battery_voltage, rssi);
  res.json({ status: 'updated' });
});

export default router;
