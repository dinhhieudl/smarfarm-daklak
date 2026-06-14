// ============================================================================
// SmartFarm Cloud - Database Migration Runner
// ============================================================================

import { pool } from './pool';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

async function migrate() {
  logger.info('Running database migrations...');

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(255) NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Get list of applied migrations
  const applied = await pool.query('SELECT name FROM _migrations ORDER BY id');
  const appliedSet = new Set(applied.rows.map((r: any) => r.name));

  // Read migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      logger.info({ migration: file }, 'Already applied, skipping');
      continue;
    }

    logger.info({ migration: file }, 'Applying migration...');
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      logger.info({ migration: file }, 'Migration applied successfully');
    } catch (err: any) {
      logger.error({ migration: file, err: err.message }, 'Migration failed');
      throw err;
    }
  }

  logger.info('All migrations completed');
  await pool.end();
}

migrate().catch((err) => {
  logger.fatal({ err }, 'Migration failed');
  process.exit(1);
});
