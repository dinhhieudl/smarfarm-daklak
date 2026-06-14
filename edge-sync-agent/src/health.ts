import * as os from 'os';
import * as fs from 'fs';
import fetch from 'node-fetch';
import * as winston from 'winston';
import { Config } from './config';
import { QueueManager } from './queue';
import { NetworkMonitor } from './network';

export interface HealthReport {
  deviceId: string;
  timestamp: string;
  uptime: number;
  memory: {
    totalMb: number;
    usedMb: number;
    freeMb: number;
    processRssMb: number;
  };
  cpu: {
    loadAvg: number[];
    usagePercent: number;
  };
  disk: {
    totalGb: number;
    usedGb: number;
    freeGb: number;
  };
  network: {
    online: boolean;
    interface: string;
    ip: string;
  };
  queue: {
    pending: number;
    sending: number;
    failed: number;
    total: number;
  };
  agent: {
    version: string;
    pid: number;
    nodeVersion: string;
  };
}

export class HealthChecker {
  private logger: winston.Logger;
  private config: Config;
  private queue: QueueManager;
  private network: NetworkMonitor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime: number;

  constructor(
    config: Config,
    queue: QueueManager,
    network: NetworkMonitor,
    logger: winston.Logger
  ) {
    this.config = config;
    this.queue = queue;
    this.network = network;
    this.logger = logger.child({ component: 'health' });
    this.startTime = Date.now();
  }

  start(): void {
    this.timer = setInterval(() => this.report(), this.config.health.intervalMs);
    this.logger.info('Health checker started', {
      intervalMs: this.config.health.intervalMs,
    });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  buildReport(): HealthReport {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const processMem = process.memoryUsage();

    // Disk usage (for the data directory)
    let diskInfo = { totalGb: 0, usedGb: 0, freeGb: 0 };
    try {
      const dataDir = './data';
      if (fs.existsSync(dataDir)) {
        const stats = fs.statfsSync(dataDir);
        diskInfo = {
          totalGb: Math.round((stats.blocks * stats.bsize) / (1024 ** 3) * 100) / 100,
          freeGb: Math.round((stats.bavail * stats.bsize) / (1024 ** 3) * 100) / 100,
          usedGb: Math.round(((stats.blocks - stats.bavail) * stats.bsize) / (1024 ** 3) * 100) / 100,
        };
      }
    } catch {}

    const netStatus = this.network.getLastStatus();
    const queueStats = this.queue.getStats();

    return {
      deviceId: this.config.cloud.deviceId,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      memory: {
        totalMb: Math.round(totalMem / (1024 ** 2)),
        usedMb: Math.round(usedMem / (1024 ** 2)),
        freeMb: Math.round(freeMem / (1024 ** 2)),
        processRssMb: Math.round(processMem.rss / (1024 ** 2)),
      },
      cpu: {
        loadAvg: os.loadavg(),
        usagePercent: Math.round((os.loadavg()[0] / os.cpus().length) * 100),
      },
      disk: diskInfo,
      network: {
        online: netStatus?.online ?? false,
        interface: netStatus?.interface ?? 'unknown',
        ip: netStatus?.ip ?? 'unknown',
      },
      queue: queueStats,
      agent: {
        version: require('../package.json').version,
        pid: process.pid,
        nodeVersion: process.version,
      },
    };
  }

  async report(): Promise<void> {
    const report = this.buildReport();

    this.logger.info('Health report', {
      memoryMb: report.memory.processRssMb,
      cpuPercent: report.cpu.usagePercent,
      queuePending: report.queue.pending,
      networkOnline: report.network.online,
    });

    // Log warnings
    if (report.memory.processRssMb > 45) {
      this.logger.warn(`Memory usage high: ${report.memory.processRssMb}MB (limit: 50MB)`);
    }
    if (report.queue.pending > 10000) {
      this.logger.warn(`Queue depth high: ${report.queue.pending} pending items`);
    }
    if (report.queue.failed > 1000) {
      this.logger.warn(`${report.queue.failed} permanently failed items in queue`);
    }
    if (report.disk.freeGb < 1) {
      this.logger.warn(`Disk space critically low: ${report.disk.freeGb}GB free`);
    }

    // Send to cloud if online
    if (this.network.isOnline()) {
      try {
        await fetch(this.config.health.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.cloud.apiKey}`,
          },
          body: JSON.stringify(report),
          timeout: 10000,
        });
      } catch (err: any) {
        this.logger.debug('Health report upload failed', { error: err.message });
      }
    }
  }
}
