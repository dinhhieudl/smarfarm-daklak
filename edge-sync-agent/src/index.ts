import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { NetworkMonitor } from './network';
import { SyncStateManager } from './sync-state';
import { QueueManager } from './queue';
import { DataCollector } from './collector';
import { Uploader } from './uploader';
import { HealthChecker } from './health';
import { OtaManager } from './ota';

class EdgeSyncAgent {
  private config;
  private logger;
  private db!: Database.Database;
  private network!: NetworkMonitor;
  private syncState!: SyncStateManager;
  private queue!: QueueManager;
  private collector!: DataCollector;
  private uploader!: Uploader;
  private health!: HealthChecker;
  private ota!: OtaManager;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;

  constructor() {
    this.config = loadConfig();
    this.logger = createLogger(this.config.logging);
  }

  async start(): Promise<void> {
    this.logger.info('=== Edge Sync Agent starting ===', {
      deviceId: this.config.cloud.deviceId,
      version: require('../package.json').version,
      nodeVersion: process.version,
      pid: process.pid,
    });

    // Ensure data directory exists
    const dataDir = path.dirname(this.config.queue.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize SQLite database
    this.db = new Database(this.config.queue.dbPath);

    // Initialize components
    this.network = new NetworkMonitor(this.logger);
    this.syncState = new SyncStateManager(this.db, this.logger);
    this.queue = new QueueManager(this.db, this.logger, this.config.queue);
    this.collector = new DataCollector(
      this.config.influxdb,
      this.syncState,
      this.queue,
      this.logger
    );
    this.uploader = new Uploader(this.config, this.logger);
    this.health = new HealthChecker(this.config, this.queue, this.network, this.logger);
    this.ota = new OtaManager(this.config, this.network, this.logger);

    // Initial network check
    await this.network.check();

    // Initialize uploader (MQTT connect if needed)
    try {
      await this.uploader.init();
    } catch (err: any) {
      this.logger.warn('Uploader init failed (will retry)', { error: err.message });
    }

    // Start periodic tasks
    this.startSyncLoop();
    this.startCleanupLoop();
    this.health.start();
    this.ota.start();

    // Register shutdown handlers
    this.registerShutdownHandlers();

    this.logger.info('Edge Sync Agent started successfully', {
      syncIntervalMs: this.config.sync.intervalMs,
      protocol: this.config.sync.protocol,
      compressionEnabled: this.config.sync.compressionEnabled,
    });
  }

  private startSyncLoop(): void {
    // Run sync immediately, then on interval
    this.runSyncCycle();

    this.syncTimer = setInterval(
      () => this.runSyncCycle(),
      this.config.sync.intervalMs
    );
  }

  private startCleanupLoop(): void {
    // Run cleanup every 6 hours
    this.cleanupTimer = setInterval(
      () => {
        this.queue.cleanup();
        this.purgeOldLogs();
      },
      6 * 60 * 60 * 1000
    );
  }

  private async runSyncCycle(): Promise<void> {
    if (this.shuttingDown) return;

    try {
      // Step 1: Check network
      const netStatus = await this.network.check();
      if (!netStatus.online) {
        this.logger.debug('Offline — skipping sync cycle');
        return;
      }

      // Step 2: Collect new data from InfluxDB
      await this.collector.collectNewData();

      // Step 3: Get pending items from queue
      const pending = this.queue.getPending(this.config.sync.batchSize);
      if (pending.length === 0) {
        this.logger.debug('No pending items to sync');
        return;
      }

      this.logger.info(`Syncing ${pending.length} readings...`);

      // Step 4: Mark as sending
      const ids = pending.map(item => item.id);
      this.queue.markSending(ids);

      // Step 5: Upload
      const result = await this.uploader.upload(pending);

      if (result.success) {
        this.queue.markSent(ids);
        this.logger.info(`Sync complete: ${result.sent} readings uploaded`);
      } else {
        this.queue.markFailed(ids, result.errors.join('; '));
        this.logger.warn(`Sync failed: ${result.errors.join('; ')}`);
      }
    } catch (err: any) {
      this.logger.error('Sync cycle error', { error: err.message, stack: err.stack });
    }
  }

  private purgeOldLogs(): void {
    try {
      const logFile = this.config.logging.file;
      if (fs.existsSync(logFile)) {
        const stat = fs.statSync(logFile);
        if (stat.size > this.config.logging.maxSizeMb * 1024 * 1024 * 2) {
          // Truncate log if it grows too large
          fs.writeFileSync(logFile, '');
          this.logger.info('Log file truncated');
        }
      }
    } catch {}
  }

  private registerShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.shuttingDown) return;
      this.shuttingDown = true;
      this.logger.info(`Received ${signal}, shutting down gracefully...`);

      // Stop timers
      if (this.syncTimer) clearInterval(this.syncTimer);
      if (this.cleanupTimer) clearInterval(this.cleanupTimer);
      this.health.stop();
      this.ota.stop();

      // Flush pending uploads
      try {
        await this.runSyncCycle();
      } catch {}

      // Close connections
      await this.uploader.shutdown();
      this.db.close();

      this.logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
      this.logger.error('Uncaught exception', { error: err.message, stack: err.stack });
      // Don't exit — let systemd restart if needed
    });
    process.on('unhandledRejection', (reason: any) => {
      this.logger.error('Unhandled rejection', { error: reason?.message || reason });
    });
  }
}

// Entry point
async function main() {
  const agent = new EdgeSyncAgent();
  await agent.start();
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
