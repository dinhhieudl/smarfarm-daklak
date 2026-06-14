// ============================================================================
// SmartFarm Cloud - Device Management Service
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool';
import { cacheGet, cacheSet, cacheDelete } from './redis';
import { Device } from '../types';
import { logger } from '../utils/logger';

const CACHE_TTL = 600; // 10 minutes

/**
 * Register a new device
 */
export async function registerDevice(
  gardenId: string,
  deviceEui: string,
  name: string,
  deviceType: 'rpi_gateway' | 'soil_sensor_node' | 'weather_station',
  zoneId?: string,
  firmwareVersion?: string
): Promise<Device> {
  const id = uuidv4();

  const result = await query<Device>(
    `INSERT INTO devices (id, garden_id, zone_id, device_eui, name, device_type, firmware_version, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'offline')
     RETURNING *`,
    [id, gardenId, zoneId || null, deviceEui.toLowerCase(), name, deviceType, firmwareVersion || null]
  );

  const device = result.rows[0];
  await cacheSet(`device:eui:${deviceEui.toLowerCase()}`, device, CACHE_TTL);

  logger.info({ deviceId: id, deviceEui, gardenId }, 'Device registered');
  return device;
}

/**
 * Get device by EUI (with cache)
 */
export async function getDeviceByEui(deviceEui: string): Promise<Device | null> {
  const cacheKey = `device:eui:${deviceEui.toLowerCase()}`;
  const cached = await cacheGet<Device>(cacheKey);
  if (cached) return cached;

  const result = await query<Device>(
    'SELECT * FROM devices WHERE device_eui = $1',
    [deviceEui.toLowerCase()]
  );

  if (result.rows.length === 0) return null;

  const device = result.rows[0];
  await cacheSet(cacheKey, device, CACHE_TTL);
  return device;
}

/**
 * Get device by ID
 */
export async function getDeviceById(deviceId: string): Promise<Device | null> {
  const result = await query<Device>(
    'SELECT * FROM devices WHERE id = $1',
    [deviceId]
  );
  return result.rows[0] || null;
}

/**
 * List devices for a garden
 */
export async function listDevices(
  gardenId: string,
  zoneId?: string
): Promise<Device[]> {
  let sql = 'SELECT * FROM devices WHERE garden_id = $1';
  const params: any[] = [gardenId];

  if (zoneId) {
    sql += ' AND zone_id = $2';
    params.push(zoneId);
  }

  sql += ' ORDER BY name';
  const result = await query<Device>(sql, params);
  return result.rows;
}

/**
 * Update device status (called when data arrives or on timeout)
 */
export async function updateDeviceStatus(
  deviceId: string,
  status: 'online' | 'offline' | 'maintenance',
  batteryVoltage?: number,
  rssi?: number
): Promise<void> {
  await query(
    `UPDATE devices SET status = $1, last_seen_at = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [status, deviceId]
  );

  // Log status change
  await query(
    `INSERT INTO device_status_log (device_id, status, battery_voltage, rssi)
     VALUES ($1, $2, $3, $4)`,
    [deviceId, status, batteryVoltage || null, rssi || null]
  );

  // Invalidate cache
  await cacheDelete(`device:id:${deviceId}`);
}

/**
 * Get devices that haven't checked in within the threshold
 */
export async function getStaleDevices(thresholdMinutes: number = 30): Promise<Device[]> {
  const result = await query<Device>(
    `SELECT * FROM devices
     WHERE status = 'online'
       AND last_seen_at < NOW() - INTERVAL '${thresholdMinutes} minutes'`
  );
  return result.rows;
}

/**
 * List all gardens for a tenant
 */
export async function listGardens(tenantId: string) {
  const result = await query(
    'SELECT * FROM gardens WHERE tenant_id = $1 ORDER BY name',
    [tenantId]
  );
  return result.rows;
}

/**
 * Create a new garden
 */
export async function createGarden(
  tenantId: string,
  data: {
    name: string;
    latitude: number;
    longitude: number;
    area_hectares: number;
    crop_type: string;
    elevation_m?: number;
    soil_type?: string;
    irrigation_type?: string;
  }
) {
  const id = uuidv4();
  const result = await query(
    `INSERT INTO gardens (id, tenant_id, name, latitude, longitude, area_hectares, crop_type, elevation_m, soil_type, irrigation_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [id, tenantId, data.name, data.latitude, data.longitude, data.area_hectares,
     data.crop_type, data.elevation_m || null, data.soil_type || null, data.irrigation_type || null]
  );
  return result.rows[0];
}

/**
 * Create a zone within a garden
 */
export async function createZone(
  gardenId: string,
  data: { name: string; zone_number: number; area_hectares?: number; soil_type?: string; planting_date?: string; notes?: string }
) {
  const id = uuidv4();
  const result = await query(
    `INSERT INTO zones (id, garden_id, name, zone_number, area_hectares, soil_type, planting_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [id, gardenId, data.name, data.zone_number, data.area_hectares || null,
     data.soil_type || null, data.planting_date || null, data.notes || null]
  );
  return result.rows[0];
}

/**
 * List zones for a garden
 */
export async function listZones(gardenId: string) {
  const result = await query(
    'SELECT * FROM zones WHERE garden_id = $1 ORDER BY zone_number',
    [gardenId]
  );
  return result.rows;
}
