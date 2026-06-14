import Database from 'better-sqlite3';
import * as winston from 'winston';

export interface SyncState {
  deviceId: string;
  lastSyncedTimestamp: string;
  lastSyncedId: string;
  totalSynced: number;
  lastSyncTime: string;
}

export class SyncStateManager {
  private db: Database.Database;
  private logger: winston.Logger;

  constructor(db: Database.Database, logger: winston.Logger) {
    this.db = db;
    this.logger = logger.child({ component: 'sync-state' });
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        device_id TEXT PRIMARY KEY,
        last_synced_timestamp TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
        last_synced_id TEXT NOT NULL DEFAULT '',
        total_synced INTEGER NOT NULL DEFAULT 0,
        last_sync_time TEXT NOT NULL DEFAULT ''
      )
    `);
  }

  getState(deviceId: string): SyncState {
    const row = this.db.prepare(
      'SELECT * FROM sync_state WHERE device_id = ?'
    ).get(deviceId) as any;

    if (row) {
      return {
        deviceId: row.device_id,
        lastSyncedTimestamp: row.last_synced_timestamp,
        lastSyncedId: row.last_synced_id,
        totalSynced: row.total_synced,
        lastSyncTime: row.last_sync_time,
      };
    }

    // Return default state for new device
    return {
      deviceId,
      lastSyncedTimestamp: '1970-01-01T00:00:00.000Z',
      lastSyncedId: '',
      totalSynced: 0,
      lastSyncTime: '',
    };
  }

  updateState(deviceId: string, timestamp: string, dataId: string, count: number): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO sync_state (device_id, last_synced_timestamp, last_synced_id, total_synced, last_sync_time)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        last_synced_timestamp = CASE
          WHEN excluded.last_synced_timestamp > sync_state.last_synced_timestamp
          THEN excluded.last_synced_timestamp
          ELSE sync_state.last_synced_timestamp
        END,
        last_synced_id = excluded.last_synced_id,
        total_synced = sync_state.total_synced + excluded.total_synced,
        last_sync_time = excluded.last_sync_time
    `).run(deviceId, timestamp, dataId, count, now);

    this.logger.debug('Sync state updated', {
      deviceId,
      timestamp,
      count,
      totalSynced: this.getState(deviceId).totalSynced,
    });
  }

  getAllStates(): SyncState[] {
    const rows = this.db.prepare('SELECT * FROM sync_state').all() as any[];
    return rows.map(row => ({
      deviceId: row.device_id,
      lastSyncedTimestamp: row.last_synced_timestamp,
      lastSyncedId: row.last_synced_id,
      totalSynced: row.total_synced,
      lastSyncTime: row.last_sync_time,
    }));
  }
}
