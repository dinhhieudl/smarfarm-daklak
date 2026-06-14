import { InfluxDB, QueryApi } from '@influxdata/influxdb-client';
import * as winston from 'winston';
import { Config } from './config';
import { SyncStateManager } from './sync-state';
import { QueueManager } from './queue';

export interface SensorReading {
  deviceId: string;
  timestamp: string;
  measurement: string;
  fields: Record<string, any>;
  tags: Record<string, string>;
}

export class DataCollector {
  private influx: InfluxDB;
  private queryApi: QueryApi;
  private logger: winston.Logger;
  private config: Config['influxdb'];
  private syncState: SyncStateManager;
  private queue: QueueManager;

  constructor(
    config: Config['influxdb'],
    syncState: SyncStateManager,
    queue: QueueManager,
    logger: winston.Logger
  ) {
    this.config = config;
    this.syncState = syncState;
    this.queue = queue;
    this.logger = logger.child({ component: 'collector' });

    this.influx = new InfluxDB({
      url: config.url,
      token: config.token || undefined,
    });
    this.queryApi = this.influx.getQueryApi(config.org);
  }

  async collectNewData(deviceFilter?: string): Promise<number> {
    const devices = deviceFilter ? [deviceFilter] : await this.getDevices();
    let totalCollected = 0;

    for (const deviceId of devices) {
      try {
        const count = await this.collectDeviceData(deviceId);
        totalCollected += count;
      } catch (err: any) {
        this.logger.error(`Failed to collect data for device ${deviceId}`, {
          error: err.message,
        });
      }
    }

    if (totalCollected > 0) {
      this.logger.info(`Collected ${totalCollected} new readings from ${devices.length} devices`);
    }
    return totalCollected;
  }

  private async getDevices(): Promise<string[]> {
    const flux = `
      import "influxdata/influxdb/schema"
      schema.measurements(bucket: "${this.config.bucket}")
    `;

    const devices: string[] = [];
    return new Promise((resolve, reject) => {
      this.queryApi.queryRows(flux, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          // Extract device ID from the measurement name or tags
          // This assumes measurements are named per device or we query distinct device tags
          devices.push(o._value as string);
        },
        error(error) {
          reject(error);
        },
        complete() {
          // If no device-specific measurements, query distinct device IDs
          if (devices.length === 0) {
            resolve(['default']);
          } else {
            resolve([...new Set(devices)]);
          }
        },
      });
    });
  }

  private async collectDeviceData(deviceId: string): Promise<number> {
    const state = this.syncState.getState(deviceId);
    const lastSynced = state.lastSyncedTimestamp;

    // Flux query: get data newer than last synced timestamp
    const flux = `
      from(bucket: "${this.config.bucket}")
        |> range(start: time(v: "${lastSynced}"))
        |> filter(fn: (r) => r._measurement == "${this.config.measurement}")
        |> filter(fn: (r) => r.device_id == "${deviceId}" or r.devEUI == "${deviceId}")
        |> sort(columns: ["_time"])
        |> limit(n: 1000)
    `;

    const readings: SensorReading[] = [];

    return new Promise((resolve, reject) => {
      this.queryApi.queryRows(flux, {
        next(row, tableMeta) {
          const o = tableMeta.toObject(row);
          const timestamp = o._time as string;

          // Build reading
          const existing = readings.find(r => r.timestamp === timestamp);
          if (existing) {
            existing.fields[o._field as string] = o._value;
          } else {
            const reading: SensorReading = {
              deviceId,
              timestamp,
              measurement: o._measurement as string || 'soil',
              fields: { [o._field as string]: o._value },
              tags: {},
            };
            // Extract known tags
            if (o.device_id) reading.tags.device_id = o.device_id as string;
            if (o.devEUI) reading.tags.devEUI = o.devEUI as string;
            if (o.field) reading.tags.field = o.field as string;
            readings.push(reading);
          }
        },
        error(error) {
          reject(error);
        },
        complete: () => {
          if (readings.length === 0) {
            resolve(0);
            return;
          }

          // Enqueue to local persistent queue
          this.queue.enqueueBatch(
            readings.map(r => ({
              deviceId: r.deviceId,
              timestamp: r.timestamp,
              measurement: r.measurement,
              fields: r.fields,
              tags: r.tags,
            }))
          );

          // Update sync state
          const lastReading = readings[readings.length - 1];
          this.syncState.updateState(
            deviceId,
            lastReading.timestamp,
            `batch-${Date.now()}`,
            readings.length
          );

          resolve(readings.length);
        },
      });
    });
  }
}
