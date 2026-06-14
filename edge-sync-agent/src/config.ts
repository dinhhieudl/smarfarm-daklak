import * as fs from 'fs';
import * as path from 'path';

export interface Config {
  influxdb: {
    url: string;
    token: string;
    org: string;
    bucket: string;
    measurement: string;
  };
  cloud: {
    endpoint: string;
    mqttEndpoint: string;
    mqttTopic: string;
    apiKey: string;
    deviceId: string;
  };
  sync: {
    intervalMs: number;
    batchSize: number;
    maxRetries: number;
    initialBackoffMs: number;
    maxBackoffMs: number;
    compressionEnabled: boolean;
    protocol: 'https' | 'mqtt';
  };
  queue: {
    dbPath: string;
    maxSize: number;
    retentionDays: number;
  };
  health: {
    intervalMs: number;
    endpoint: string;
  };
  ota: {
    checkIntervalMs: number;
    endpoint: string;
    downloadDir: string;
  };
  logging: {
    level: string;
    file: string;
    maxSizeMb: number;
    maxFiles: number;
  };
}

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

export function loadConfig(configDir?: string): Config {
  const baseDir = configDir || path.join(__dirname, '..', 'config');
  const defaultPath = path.join(baseDir, 'default.json');
  const envPath = path.join(baseDir, `${process.env.NODE_ENV || 'production'}.json`);

  let config: any = {};
  if (fs.existsSync(defaultPath)) {
    config = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
  }
  if (fs.existsSync(envPath)) {
    const envConfig = JSON.parse(fs.readFileSync(envPath, 'utf-8'));
    config = deepMerge(config, envConfig);
  }

  // Environment variable overrides (highest priority)
  if (process.env.INFLUXDB_URL) config.influxdb.url = process.env.INFLUXDB_URL;
  if (process.env.INFLUXDB_TOKEN) config.influxdb.token = process.env.INFLUXDB_TOKEN;
  if (process.env.INFLUXDB_ORG) config.influxdb.org = process.env.INFLUXDB_ORG;
  if (process.env.INFLUXDB_BUCKET) config.influxdb.bucket = process.env.INFLUXDB_BUCKET;
  if (process.env.CLOUD_ENDPOINT) config.cloud.endpoint = process.env.CLOUD_ENDPOINT;
  if (process.env.CLOUD_MQTT_ENDPOINT) config.cloud.mqttEndpoint = process.env.CLOUD_MQTT_ENDPOINT;
  if (process.env.CLOUD_API_KEY) config.cloud.apiKey = process.env.CLOUD_API_KEY;
  if (process.env.DEVICE_ID) config.cloud.deviceId = process.env.DEVICE_ID;
  if (process.env.SYNC_INTERVAL_MS) config.sync.intervalMs = parseInt(process.env.SYNC_INTERVAL_MS, 10);
  if (process.env.SYNC_BATCH_SIZE) config.sync.batchSize = parseInt(process.env.SYNC_BATCH_SIZE, 10);
  if (process.env.SYNC_PROTOCOL) config.sync.protocol = process.env.SYNC_PROTOCOL as 'https' | 'mqtt';
  if (process.env.QUEUE_DB_PATH) config.queue.dbPath = process.env.QUEUE_DB_PATH;
  if (process.env.LOG_LEVEL) config.logging.level = process.env.LOG_LEVEL;

  return config as Config;
}
