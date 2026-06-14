// ============================================================================
// SmartFarm Cloud - Input Validation Schemas (Zod)
// ============================================================================

import { z } from 'zod';

const sensorTypeEnum = z.enum([
  'temperature', 'moisture', 'ec', 'nitrogen',
  'phosphorus', 'potassium', 'ph', 'salinity',
]);

// --- Tenant ---
export const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  plan: z.enum(['free', 'pro', 'enterprise']).default('free'),
});

// --- Garden ---
export const createGardenSchema = z.object({
  name: z.string().min(1).max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  area_hectares: z.number().positive(),
  crop_type: z.string().min(1).max(100),
  elevation_m: z.number().optional(),
  soil_type: z.string().max(100).optional(),
  irrigation_type: z.enum(['drip', 'sprinkler', 'flood', 'rainfed', 'manual']).optional(),
});

// --- Zone ---
export const createZoneSchema = z.object({
  name: z.string().min(1).max(255),
  zone_number: z.number().int().positive(),
  area_hectares: z.number().positive().optional(),
  soil_type: z.string().max(100).optional(),
  planting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});

// --- Device ---
export const createDeviceSchema = z.object({
  garden_id: z.string().uuid(),
  zone_id: z.string().uuid().optional(),
  device_eui: z.string().length(16).regex(/^[0-9a-fA-F]+$/),
  name: z.string().min(1).max(255),
  device_type: z.enum(['rpi_gateway', 'soil_sensor_node']),
  firmware_version: z.string().max(30).optional(),
});

// --- API Key ---
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(255),
  garden_id: z.string().uuid().optional(),
  scopes: z.array(z.enum(['ingest', 'read', 'admin'])).min(1),
  expires_in_days: z.number().int().positive().max(365).optional(),
});

// --- Batch Sensor Ingestion ---
export const sensorReadingSchema = z.object({
  zone_id: z.string().uuid(),
  sensor_type: sensorTypeEnum,
  value: z.number(),
  unit: z.string().min(1).max(20),
  quality: z.enum(['good', 'suspect', 'bad']).default('good'),
  raw_value: z.number().optional(),
  timestamp: z.string().datetime(),
  battery_voltage: z.number().optional(),
  rssi: z.number().optional(),
});

export const batchSensorPayloadSchema = z.object({
  device_eui: z.string().length(16).regex(/^[0-9a-fA-F]+$/),
  garden_id: z.string().uuid(),
  readings: z.array(sensorReadingSchema).min(1).max(5000),
});

// --- Query Params ---
export const queryParamsSchema = z.object({
  garden_id: z.string().uuid().optional(),
  zone_id: z.string().uuid().optional(),
  sensor_type: sensorTypeEnum.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(['raw', '5m', '1h', '1d']).default('raw'),
  limit: z.coerce.number().int().positive().max(10000).default(1000),
  offset: z.coerce.number().int().min(0).default(0),
});

// --- Analytics ---
export const analyticsQuerySchema = z.object({
  garden_ids: z.array(z.string().uuid()).optional(),
  sensor_type: sensorTypeEnum,
  from: z.string().datetime(),
  to: z.string().datetime(),
  aggregation: z.enum(['avg', 'min', 'max', 'percentile_95']).default('avg'),
  group_by: z.enum(['garden', 'zone', 'crop_type', 'none']).default('none'),
  compare_with: z.enum(['previous_period', 'same_period_last_year']).optional(),
});

// --- Alert Threshold ---
export const createThresholdSchema = z.object({
  garden_id: z.string().uuid().optional(),
  zone_id: z.string().uuid().optional(),
  sensor_type: sensorTypeEnum,
  min_value: z.number().optional(),
  max_value: z.number().optional(),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
  cooldown_minutes: z.number().int().positive().default(30),
});

// --- WebSocket Subscription ---
export const wsSubscriptionSchema = z.object({
  type: z.enum(['subscribe', 'unsubscribe']),
  garden_id: z.string().uuid().optional(),
  zone_id: z.string().uuid().optional(),
  sensor_types: z.array(sensorTypeEnum).optional(),
});
