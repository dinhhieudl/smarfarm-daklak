// ============================================================================
// SmartFarm Cloud - Core Type Definitions (Updated)
// ============================================================================

export interface Tenant {
  id: string;
  name: string;
  email: string;
  plan: 'free' | 'basic' | 'pro' | 'enterprise';
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Garden {
  id: string;
  tenant_id: string;
  cooperative_id?: string;
  name: string;
  latitude: number;
  longitude: number;
  area_hectares: number;
  crop_type: string;
  elevation_m?: number;
  soil_type?: string;
  irrigation_type?: string;
  province?: string;
  district?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface Zone {
  id: string;
  garden_id: string;
  name: string;
  zone_number: number;
  area_hectares?: number;
  soil_type?: string;
  planting_date?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

export interface Device {
  id: string;
  garden_id: string;
  zone_id?: string;
  device_eui: string;
  name: string;
  device_type: 'rpi_gateway' | 'soil_sensor_node' | 'weather_station';
  firmware_version?: string;
  last_seen_at?: Date;
  status: 'online' | 'offline' | 'maintenance';
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ApiKey {
  id: string;
  tenant_id: string;
  garden_id?: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  scopes: string[];
  expires_at?: Date;
  last_used_at?: Date;
  is_active: boolean;
  created_at: Date;
}

// ============================================================================
// USER & AUTH TYPES
// ============================================================================

export interface User {
  id: string;
  phone: string;
  name: string;
  role: 'farmer' | 'manager' | 'consultant' | 'admin';
  zalo_id?: string;
  email?: string;
  avatar_url?: string;
  preferred_lang: string;
  is_active: boolean;
  last_login_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TenantUser {
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  joined_at: Date;
}

export interface OtpSession {
  id: string;
  phone: string;
  otp_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  used: boolean;
  created_at: Date;
}

// ============================================================================
// COOPERATIVE TYPES
// ============================================================================

export interface Cooperative {
  id: string;
  name: string;
  description?: string;
  province: string;
  district?: string;
  commune?: string;
  address?: string;
  contact_phone?: string;
  contact_email?: string;
  member_count: number;
  is_active: boolean;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CooperativeMember {
  cooperative_id: string;
  garden_id: string;
  tenant_id: string;
  role: 'member' | 'board' | 'chairman';
  joined_at: Date;
}

// ============================================================================
// CROP & INPUT TYPES
// ============================================================================

export interface CropSeason {
  id: string;
  garden_id: string;
  zone_id?: string;
  crop_type: string;
  variety?: string;
  planting_date?: string;
  expected_harvest?: string;
  actual_harvest?: string;
  yield_kg?: number;
  yield_kg_ha?: number;
  status: 'planned' | 'active' | 'harvested' | 'abandoned';
  notes?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface FarmInput {
  id: string;
  garden_id: string;
  zone_id?: string;
  season_id?: string;
  input_type: 'fertilizer' | 'pesticide' | 'herbicide' | 'water' | 'mulch' | 'lime' | 'organic';
  product_name?: string;
  quantity?: number;
  unit?: string;
  cost_vnd?: number;
  application_date?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

// ============================================================================
// SENSOR TYPES (Expanded for coffee farming)
// ============================================================================

export interface SensorReading {
  time: Date;
  device_id: string;
  garden_id: string;
  zone_id: string;
  sensor_type: SensorType;
  value: number;
  unit: string;
  quality: 'good' | 'suspect' | 'bad';
  raw_value?: number;
  battery_voltage?: number;
  rssi?: number;
}

export type SensorType =
  | 'soil_moisture'
  | 'soil_temperature'
  | 'soil_ph'
  | 'soil_ec'
  | 'air_temperature'
  | 'air_humidity'
  | 'rainfall'
  | 'light_intensity'
  | 'wind_speed'
  | 'leaf_wetness'
  | 'water_level'
  | 'flow_rate'
  | 'nitrogen'
  | 'phosphorus'
  | 'potassium'
  | 'salinity';

export const SENSOR_UNITS: Record<SensorType, string> = {
  soil_moisture: '%',
  soil_temperature: '°C',
  soil_ph: 'pH',
  soil_ec: 'dS/m',
  air_temperature: '°C',
  air_humidity: '%',
  rainfall: 'mm',
  light_intensity: 'lux',
  wind_speed: 'm/s',
  leaf_wetness: '%',
  water_level: 'mm',
  flow_rate: 'L/min',
  nitrogen: 'mg/kg',
  phosphorus: 'mg/kg',
  potassium: 'mg/kg',
  salinity: 'g/L',
};

export const SENSOR_LABELS: Record<SensorType, string> = {
  soil_moisture: 'Độ ẩm đất',
  soil_temperature: 'Nhiệt độ đất',
  soil_ph: 'pH đất',
  soil_ec: 'Điện dẫn đất',
  air_temperature: 'Nhiệt độ không khí',
  air_humidity: 'Độ ẩm không khí',
  rainfall: 'Lượng mưa',
  light_intensity: 'Cường độ ánh sáng',
  wind_speed: 'Tốc độ gió',
  leaf_wetness: 'Độ ẩm lá',
  water_level: 'Mực nước',
  flow_rate: 'Lưu lượng',
  nitrogen: 'Nitơ (N)',
  phosphorus: 'Phốt pho (P)',
  potassium: 'Kali (K)',
  salinity: 'Độ mặn',
};

// Physical range validation per sensor type
export const SENSOR_RANGES: Record<SensorType, [number, number]> = {
  soil_moisture: [0, 100],
  soil_temperature: [-5, 60],
  soil_ph: [3, 10],
  soil_ec: [0, 20],
  air_temperature: [0, 50],
  air_humidity: [0, 100],
  rainfall: [0, 300],
  light_intensity: [0, 200000],
  wind_speed: [0, 50],
  leaf_wetness: [0, 100],
  water_level: [0, 5000],
  flow_rate: [0, 1000],
  nitrogen: [0, 1000],
  phosphorus: [0, 500],
  potassium: [0, 2000],
  salinity: [0, 50],
};

// ============================================================================
// ALERT TYPES
// ============================================================================

export interface AlertThreshold {
  id: string;
  tenant_id: string;
  garden_id?: string;
  zone_id?: string;
  sensor_type: SensorType;
  min_value?: number;
  max_value?: number;
  severity: 'info' | 'warning' | 'critical';
  is_active: boolean;
  cooldown_minutes: number;
  created_at: Date;
}

export interface Alert {
  id: string;
  threshold_id: string;
  tenant_id: string;
  garden_id: string;
  zone_id: string;
  device_id: string;
  sensor_type: SensorType;
  triggered_value: number;
  threshold_min?: number;
  threshold_max?: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  acknowledged: boolean;
  acknowledged_at?: Date;
  triggered_at: Date;
  resolved_at?: Date;
}

export interface AlertNotification {
  id: string;
  tenant_id: string;
  user_id?: string;
  channel: 'sms' | 'zalo' | 'email' | 'push' | 'webhook';
  target: string;
  is_active: boolean;
  severity_filter: string;
  created_at: Date;
}

// ============================================================================
// WEATHER TYPES
// ============================================================================

export interface WeatherForecast {
  garden_id: string;
  forecast_date: string;
  temp_min_c: number;
  temp_max_c: number;
  humidity_pct: number;
  rainfall_mm: number;
  wind_speed_ms: number;
  condition: string;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface BatchSensorPayload {
  device_eui: string;
  garden_id: string;
  readings: {
    zone_id: string;
    sensor_type: SensorType;
    value: number;
    unit: string;
    quality?: 'good' | 'suspect' | 'bad';
    raw_value?: number;
    timestamp: string;
    battery_voltage?: number;
    rssi?: number;
  }[];
}

export interface QueryParams {
  garden_id?: string;
  zone_id?: string;
  sensor_type?: SensorType;
  from?: string;
  to?: string;
  granularity?: 'raw' | '5m' | '1h' | '1d';
  limit?: number;
  offset?: number;
}

export interface AnalyticsQuery {
  garden_ids?: string[];
  sensor_type: SensorType;
  from: string;
  to: string;
  aggregation: 'avg' | 'min' | 'max' | 'percentile_95';
  group_by: 'garden' | 'zone' | 'crop_type' | 'none';
  compare_with?: 'previous_period' | 'same_period_last_year';
}

export interface WSSubscription {
  type: 'subscribe' | 'unsubscribe';
  garden_id?: string;
  zone_id?: string;
  sensor_types?: SensorType[];
}

export interface WSMessage {
  type: 'sensor_update' | 'alert' | 'device_status' | 'error';
  payload: unknown;
  timestamp: string;
}

// ============================================================================
// PHONE AUTH TYPES
// ============================================================================

export interface SendOtpRequest {
  phone: string;
}

export interface VerifyOtpRequest {
  phone: string;
  otp: string;
  name?: string;  // required on first registration
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
}

export interface JwtPayload {
  sub: string;      // user_id
  phone: string;
  role: string;
  tenant_id?: string;
  iat: number;
  exp: number;
}
