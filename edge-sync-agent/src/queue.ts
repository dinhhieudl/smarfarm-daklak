import Database from 'better-sqlite3';
import * as winston from 'winston';
import { Config } from './config';

export interface QueueItem {
  id: number;
  deviceId: string;
  timestamp: string;
  measurement: string;
  fields: string;   // JSON string
  tags: string;     // JSON string
  attempts: number;
  status: 'pending' | 'sending' | 'failed' | 'sent';
  createdAt: string;
  lastAttempt: string | null;
  error: string | null;
}

export class QueueManager {
  private db: Database.Database;
  private logger: winston.Logger;
  private config: Config['queue'];

  constructor(db: Database.Database, logger: winston.Logger, config: Config['queue']) {
    this.db = db;
    this.logger = logger.child({ component: 'queue' });
    this.config = config;
    this.init();
  }

  private init(): void {
    // WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -8000'); // 8MB cache

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        measurement TEXT NOT NULL,
        fields TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '{}',
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_attempt TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_queue_status
        ON sync_queue(status, created_at);

      CREATE INDEX IF NOT EXISTS idx_queue_device
        ON sync_queue(device_id, timestamp);

      CREATE INDEX IF NOT EXISTS idx_queue_timestamp
        ON sync_queue(timestamp);
    `);
  }

  enqueue(deviceId: string, timestamp: string, measurement: string, fields: Record<string, any>, tags: Record<string, string> = {}): number {
    const stmt = this.db.prepare(`
      INSERT INTO sync_queue (device_id, timestamp, measurement, fields, tags)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(deviceId, timestamp, measurement, JSON.stringify(fields), JSON.stringify(tags));
    return result.lastInsertRowid as number;
  }

  enqueueBatch(items: Array<{
    deviceId: string;
    timestamp: string;
    measurement: string;
    fields: Record<string, any>;
    tags: Record<string, string>;
  }>): number {
    const stmt = this.db.prepare(`
      INSERT INTO sync_queue (device_id, timestamp, measurement, fields, tags)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((items: typeof items) => {
      let count = 0;
      for (const item of items) {
        stmt.run(item.deviceId, item.timestamp, item.measurement, JSON.stringify(item.fields), JSON.stringify(item.tags));
        count++;
      }
      return count;
    });

    const count = insertMany(items);
    this.logger.debug(`Enqueued ${count} items to sync queue`);
    return count;
  }

  getPending(limit: number = 100): QueueItem[] {
    return this.db.prepare(`
      SELECT * FROM sync_queue
      WHERE status = 'pending'
      ORDER BY timestamp ASC
      LIMIT ?
    `).all(limit) as QueueItem[];
  }

  markSending(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE sync_queue
      SET status = 'sending', last_attempt = datetime('now'), attempts = attempts + 1
      WHERE id IN (${placeholders})
    `).run(...ids);
  }

  markSent(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE sync_queue
      SET status = 'sent'
      WHERE id IN (${placeholders})
    `).run(...ids);
  }

  markFailed(ids: number[], error: string): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE sync_queue
      SET status = 'pending', error = ?
      WHERE id IN (${placeholders}) AND attempts < ?
    `).run(error, ...ids, this.config.maxSize > 0 ? 10 : 10);

    // Mark as permanently failed after max retries
    this.db.prepare(`
      UPDATE sync_queue
      SET status = 'failed', error = ?
      WHERE id IN (${placeholders}) AND attempts >= 10
    `).run(error, ...ids);
  }

  cleanup(): number {
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - this.config.retentionDays);

    const result = this.db.prepare(`
      DELETE FROM sync_queue
      WHERE status = 'sent' AND created_at < ?
    `).run(retentionDate.toISOString());

    // Also clean permanently failed items older than 2x retention
    const failedDate = new Date();
    failedDate.setDate(failedDate.getDate() - this.config.retentionDays * 2);
    this.db.prepare(`
      DELETE FROM sync_queue
      WHERE status = 'failed' AND created_at < ?
    `).run(failedDate.toISOString());

    if (result.changes > 0) {
      this.logger.info(`Cleaned up ${result.changes} old queue entries`);
    }
    return result.changes;
  }

  getStats(): { pending: number; sending: number; failed: number; sent: number; total: number } {
    const row = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        COUNT(*) as total
      FROM sync_queue
    `).get() as any;

    return {
      pending: row?.pending || 0,
      sending: row?.sending || 0,
      failed: row?.failed || 0,
      sent: row?.sent || 0,
      total: row?.total || 0,
    };
  }

  purgeSent(): number {
    const result = this.db.prepare(`
      DELETE FROM sync_queue WHERE status = 'sent'
    `).run();
    return result.changes;
  }
}
