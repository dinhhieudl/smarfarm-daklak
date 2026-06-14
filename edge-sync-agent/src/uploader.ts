import fetch from 'node-fetch';
import * as mqtt from 'mqtt';
import * as pako from 'pako';
import * as winston from 'winston';
import { Config } from './config';
import { QueueItem } from './queue';

export interface UploadResult {
  success: boolean;
  sent: number;
  failed: number;
  errors: string[];
}

export class Uploader {
  private logger: winston.Logger;
  private config: Config;
  private mqttClient: mqtt.MqttClient | null = null;
  private mqttConnected = false;
  private retryCount = 0;

  constructor(config: Config, logger: winston.Logger) {
    this.config = config;
    this.logger = logger.child({ component: 'uploader' });
  }

  async init(): Promise<void> {
    if (this.config.sync.protocol === 'mqtt') {
      await this.connectMqtt();
    }
  }

  private async connectMqtt(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.config.cloud.mqttEndpoint;
      this.logger.info(`Connecting to MQTT broker: ${url}`);

      this.mqttClient = mqtt.connect(url, {
        username: this.config.cloud.deviceId,
        password: this.config.cloud.apiKey,
        clientId: `edge-${this.config.cloud.deviceId}`,
        clean: true,
        connectTimeout: 10000,
        reconnectPeriod: 30000,
        keepalive: 60,
      });

      this.mqttClient.on('connect', () => {
        this.mqttConnected = true;
        this.retryCount = 0;
        this.logger.info('MQTT connected');
        resolve();
      });

      this.mqttClient.on('error', (err) => {
        this.logger.error('MQTT error', { error: err.message });
        if (!this.mqttConnected) reject(err);
      });

      this.mqttClient.on('offline', () => {
        this.mqttConnected = false;
        this.logger.warn('MQTT offline');
      });

      this.mqttClient.on('reconnect', () => {
        this.retryCount++;
        this.logger.info(`MQTT reconnecting (attempt ${this.retryCount})`);
      });
    });
  }

  async upload(items: QueueItem[]): Promise<UploadResult> {
    if (items.length === 0) {
      return { success: true, sent: 0, failed: 0, errors: [] };
    }

    const payload = this.buildPayload(items);

    if (this.config.sync.protocol === 'mqtt') {
      return this.uploadMqtt(items, payload);
    }
    return this.uploadHttp(items, payload);
  }

  private buildPayload(items: QueueItem[]): any {
    return {
      deviceId: this.config.cloud.deviceId,
      timestamp: new Date().toISOString(),
      readings: items.map(item => ({
        id: item.id,
        deviceId: item.device_id,
        timestamp: item.timestamp,
        measurement: item.measurement,
        fields: JSON.parse(item.fields),
        tags: JSON.parse(item.tags || '{}'),
      })),
    };
  }

  private compressPayload(payload: any): Buffer {
    const json = JSON.stringify(payload);
    if (!this.config.sync.compressionEnabled) {
      return Buffer.from(json, 'utf-8');
    }
    const compressed = pako.gzip(json);
    this.logger.debug(`Compressed ${json.length} bytes → ${compressed.length} bytes (${Math.round((1 - compressed.length / json.length) * 100)}% reduction)`);
    return Buffer.from(compressed);
  }

  private async uploadHttp(items: QueueItem[], payload: any): Promise<UploadResult> {
    const body = this.compressPayload(payload);
    const maxRetries = this.config.sync.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Device-Id': this.config.cloud.deviceId,
          'X-Reading-Count': String(items.length),
          'Authorization': `Bearer ${this.config.cloud.apiKey}`,
        };

        if (this.config.sync.compressionEnabled) {
          headers['Content-Encoding'] = 'gzip';
        }

        const response = await fetch(this.config.cloud.endpoint, {
          method: 'POST',
          headers,
          body,
          timeout: 30000,
        });

        if (response.ok) {
          this.retryCount = 0;
          this.logger.info(`Uploaded ${items.length} readings via HTTPS`, {
            status: response.status,
            sizeBytes: body.length,
          });
          return { success: true, sent: items.length, failed: 0, errors: [] };
        }

        const errorText = await response.text().catch(() => 'unknown');
        this.logger.warn(`Upload failed (HTTP ${response.status})`, {
          attempt: attempt + 1,
          error: errorText,
        });

        if (response.status === 401 || response.status === 403) {
          // Auth errors shouldn't retry
          return {
            success: false,
            sent: 0,
            failed: items.length,
            errors: [`Auth error: ${response.status}`],
          };
        }

        if (attempt < maxRetries) {
          await this.backoff(attempt);
        }
      } catch (err: any) {
        this.logger.warn(`Upload error (attempt ${attempt + 1}/${maxRetries + 1})`, {
          error: err.message,
        });
        if (attempt < maxRetries) {
          await this.backoff(attempt);
        }
      }
    }

    return {
      success: false,
      sent: 0,
      failed: items.length,
      errors: ['Max retries exceeded'],
    };
  }

  private async uploadMqtt(items: QueueItem[], payload: any): Promise<UploadResult> {
    if (!this.mqttClient || !this.mqttConnected) {
      this.logger.warn('MQTT not connected, falling back to HTTP');
      return this.uploadHttp(items, payload);
    }

    const topic = this.config.cloud.mqttTopic.replace('{deviceId}', this.config.cloud.deviceId);
    const body = this.compressPayload(payload);

    return new Promise((resolve) => {
      this.mqttClient!.publish(
        topic,
        body,
        {
          qos: 1, // At least once delivery
          retain: false,
          properties: {
            messageExpiryInterval: 3600,
            userProperties: {
              deviceId: this.config.cloud.deviceId,
              count: String(items.length),
            },
          },
        },
        (err) => {
          if (err) {
            this.logger.error('MQTT publish failed', { error: err.message });
            resolve({
              success: false,
              sent: 0,
              failed: items.length,
              errors: [err.message],
            });
          } else {
            this.logger.info(`Published ${items.length} readings via MQTT`, {
              topic,
              sizeBytes: body.length,
            });
            resolve({
              success: true,
              sent: items.length,
              failed: 0,
              errors: [],
            });
          }
        }
      );
    });
  }

  private async backoff(attempt: number): Promise<void> {
    const base = this.config.sync.initialBackoffMs;
    const max = this.config.sync.maxBackoffMs;
    // Exponential backoff with full jitter
    const expBackoff = Math.min(base * Math.pow(2, attempt), max);
    const jitter = Math.random() * expBackoff;
    const delay = Math.round(jitter);
    this.logger.debug(`Backing off ${delay}ms (attempt ${attempt + 1})`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async shutdown(): Promise<void> {
    if (this.mqttClient) {
      this.mqttClient.end(true);
      this.mqttClient = null;
    }
  }

  isConnected(): boolean {
    if (this.config.sync.protocol === 'mqtt') {
      return this.mqttConnected;
    }
    return true; // HTTP is always "connected"
  }
}
