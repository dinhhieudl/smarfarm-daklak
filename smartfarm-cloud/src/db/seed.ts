// ============================================================================
// SmartFarm Cloud - Seed Data (Development / Demo)
// ============================================================================

import { pool } from './pool';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { logger } from '../utils/logger';

async function seed() {
  logger.info('Seeding database with demo data...');

  // --- Tenant ---
  const tenantId = uuidv4();
  await pool.query(
    `INSERT INTO tenants (id, name, email, plan) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [tenantId, 'Coffee Mountain Co.', 'admin@coffeemountain.co', 'pro']
  );
  logger.info({ tenantId }, 'Created demo tenant');

  // --- API Key (for edge agents) ---
  const demoApiKey = 'sf_demo_key_1234567890abcdef12345678';
  const keyHash = await bcrypt.hash(demoApiKey, 12);
  const keyId = uuidv4();
  await pool.query(
    `INSERT INTO api_keys (id, tenant_id, key_hash, key_prefix, name, scopes)
     VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
    [keyId, tenantId, keyHash, demoApiKey.substring(0, 8), 'Edge Agent Key', ['ingest', 'read', 'admin']]
  );
  logger.info({ apiKey: demoApiKey }, 'Created demo API key (save this!)');

  // --- Garden 1: Arabica Farm ---
  const garden1Id = uuidv4();
  await pool.query(
    `INSERT INTO gardens (id, tenant_id, name, latitude, longitude, area_hectares, crop_type, elevation_m, soil_type, irrigation_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    [garden1Id, tenantId, 'Finca La Montaña', 9.9281, -84.0756, 15.5, 'arabica_coffee', 1450, 'volcanic_andisol', 'drip']
  );

  // --- Garden 2: Robusta Farm ---
  const garden2Id = uuidv4();
  await pool.query(
    `INSERT INTO gardens (id, tenant_id, name, latitude, longitude, area_hectares, crop_type, elevation_m, soil_type, irrigation_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT DO NOTHING`,
    [garden2Id, tenantId, 'Riverside Robusta', 10.0123, -84.1234, 22.0, 'robusta_coffee', 800, 'laterite', 'sprinkler']
  );

  // --- Zones for Garden 1 ---
  const zones1: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const zoneId = uuidv4();
    zones1.push(zoneId);
    await pool.query(
      `INSERT INTO zones (id, garden_id, name, zone_number, area_hectares, soil_type)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [zoneId, garden1Id, `Zone ${i} - Block ${String.fromCharCode(64 + i)}`, i, 3.875, 'volcanic_andisol']
    );
  }

  // --- Zones for Garden 2 ---
  const zones2: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const zoneId = uuidv4();
    zones2.push(zoneId);
    await pool.query(
      `INSERT INTO zones (id, garden_id, name, zone_number, area_hectares, soil_type)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [zoneId, garden2Id, `Zone ${i} - Section ${i}`, i, 7.33, 'laterite']
    );
  }

  // --- Devices ---
  const devices = [
    { garden: garden1Id, zone: zones1[0], eui: '0004a30b00e1c2d0', name: 'RPi Gateway 01', type: 'rpi_gateway' },
    { garden: garden1Id, zone: zones1[0], eui: '0004a30b00e1c2d1', name: 'Soil Sensor A1', type: 'soil_sensor_node' },
    { garden: garden1Id, zone: zones1[1], eui: '0004a30b00e1c2d2', name: 'Soil Sensor A2', type: 'soil_sensor_node' },
    { garden: garden1Id, zone: zones1[2], eui: '0004a30b00e1c2d3', name: 'Soil Sensor B1', type: 'soil_sensor_node' },
    { garden: garden1Id, zone: zones1[3], eui: '0004a30b00e1c2d4', name: 'Soil Sensor B2', type: 'soil_sensor_node' },
    { garden: garden2Id, zone: zones2[0], eui: '0004a30b00e1c2e0', name: 'RPi Gateway 02', type: 'rpi_gateway' },
    { garden: garden2Id, zone: zones2[0], eui: '0004a30b00e1c2e1', name: 'Soil Sensor C1', type: 'soil_sensor_node' },
    { garden: garden2Id, zone: zones2[1], eui: '0004a30b00e1c2e2', name: 'Soil Sensor C2', type: 'soil_sensor_node' },
  ];

  for (const d of devices) {
    const deviceId = uuidv4();
    await pool.query(
      `INSERT INTO devices (id, garden_id, zone_id, device_eui, name, device_type, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'online') ON CONFLICT DO NOTHING`,
      [deviceId, d.garden, d.zone, d.eui, d.name, d.type]
    );
  }

  // --- Alert Thresholds ---
  const thresholds = [
    { garden: garden1Id, sensor: 'moisture', min: 20, max: 80, severity: 'warning' },
    { garden: garden1Id, sensor: 'temperature', min: 10, max: 35, severity: 'critical' },
    { garden: garden1Id, sensor: 'ph', min: 5.5, max: 7.0, severity: 'warning' },
    { garden: garden2Id, sensor: 'moisture', min: 25, max: 85, severity: 'warning' },
    { garden: garden2Id, sensor: 'ec', min: 0.5, max: 4.0, severity: 'info' },
  ];

  for (const t of thresholds) {
    await pool.query(
      `INSERT INTO alert_thresholds (id, tenant_id, garden_id, sensor_type, min_value, max_value, severity, cooldown_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING`,
      [uuidv4(), tenantId, t.garden, t.sensor, t.min, t.max, t.severity, 30]
    );
  }

  // --- Generate sample sensor data (last 7 days) ---
  logger.info('Generating sample sensor data (this may take a moment)...');

  const sensorTypes = ['temperature', 'moisture', 'ec', 'ph', 'nitrogen', 'potassium'] as const;
  const baseValues: Record<string, number> = {
    temperature: 22, moisture: 55, ec: 1.8, ph: 6.2, nitrogen: 120, potassium: 180,
  };

  const allZones = [...zones1, ...zones2];
  const readings: any[] = [];

  // Generate 7 days of data, 1 reading per hour per sensor per zone
  for (let day = 7; day >= 0; day--) {
    for (let hour = 0; hour < 24; hour++) {
      const ts = new Date();
      ts.setDate(ts.getDate() - day);
      ts.setHours(hour, 0, 0, 0);

      for (const zoneId of allZones) {
        for (const sensorType of sensorTypes) {
          const base = baseValues[sensorType];
          // Add realistic variation: daily cycle + random noise
          const hourFactor = Math.sin((hour - 6) * Math.PI / 12); // peaks at noon
          const noise = (Math.random() - 0.5) * base * 0.1;
          const value = Math.round((base + hourFactor * base * 0.15 + noise) * 100) / 100;

          const gardenId = zones1.includes(zoneId) ? garden1Id : garden2Id;
          const deviceEui = zones1.includes(zoneId)
            ? devices.find(d => d.zone === zoneId)?.eui || devices[1].eui
            : devices.find(d => d.zone === zoneId)?.eui || devices[6].eui;

          const unitMap: Record<string, string> = {
            temperature: '°C', moisture: '%', ec: 'mS/cm',
            ph: 'pH', nitrogen: 'mg/kg', potassium: 'mg/kg',
          };

          readings.push(
            `('${ts.toISOString()}', (SELECT id FROM devices WHERE device_eui = '${deviceEui}'), '${gardenId}', '${zoneId}', '${sensorType}', ${value}, '${unitMap[sensorType]}', 'good')`
          );
        }
      }
    }
  }

  // Batch insert (in chunks to avoid query size limits)
  const chunkSize = 500;
  for (let i = 0; i < readings.length; i += chunkSize) {
    const chunk = readings.slice(i, i + chunkSize);
    const sql = `
      INSERT INTO sensor_readings (time, device_id, garden_id, zone_id, sensor_type, value, unit, quality)
      VALUES ${chunk.join(', ')}
    `;
    await pool.query(sql);
  }

  logger.info({ readingCount: readings.length }, 'Sample sensor data generated');
  logger.info('Seed completed successfully!');
  logger.info('');
  logger.info('=== Demo Credentials ===');
  logger.info(`API Key: ${demoApiKey}`);
  logger.info(`Tenant ID: ${tenantId}`);
  logger.info(`Garden 1 ID: ${garden1Id}`);
  logger.info(`Garden 2 ID: ${garden2Id}`);
  logger.info('========================');

  await pool.end();
}

seed().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});
