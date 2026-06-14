// ============================================================================
// SmartFarm Cloud - API Key Authentication Service
// ============================================================================

import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { query, withTransaction } from '../db/pool';
import { cacheGet, cacheSet, cacheDelete } from './redis';
import { ApiKey } from '../types';
import { logger } from '../utils/logger';

const BCRYPT_ROUNDS = 12;
const CACHE_TTL = 300; // 5 minutes

/**
 * Generate a new API key.
 * Format: sf_<random_32_chars>
 * We store: bcrypt(full_key) and the first 8 chars as prefix for fast lookup
 */
export function generateApiKey(): { fullKey: string; prefix: string } {
  const randomPart = crypto.randomBytes(24).toString('hex');
  const fullKey = `sf_${randomPart}`;
  const prefix = fullKey.substring(0, 8);
  return { fullKey, prefix };
}

/**
 * Create a new API key for a tenant
 */
export async function createApiKey(
  tenantId: string,
  name: string,
  scopes: string[],
  gardenId?: string,
  expiresInDays?: number
): Promise<{ apiKey: ApiKey; fullKey: string }> {
  const { fullKey, prefix } = generateApiKey();
  const keyHash = await bcrypt.hash(fullKey, BCRYPT_ROUNDS);
  const id = uuidv4();

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86400000)
    : null;

  await query(
    `INSERT INTO api_keys (id, tenant_id, garden_id, key_hash, key_prefix, name, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, tenantId, gardenId || null, keyHash, prefix, name, scopes, expiresAt]
  );

  const apiKey: ApiKey = {
    id,
    tenant_id: tenantId,
    garden_id: gardenId,
    key_hash: keyHash,
    key_prefix: prefix,
    name,
    scopes,
    expires_at: expiresAt,
    last_used_at: undefined,
    is_active: true,
    created_at: new Date(),
  };

  logger.info({ tenantId, keyId: id, name, scopes }, 'API key created');
  return { apiKey, fullKey };
}

/**
 * Validate an API key and return its associated data.
 * Uses prefix for fast DB lookup, then bcrypt compare.
 * Results cached in Redis for 5 minutes.
 */
export async function validateApiKey(
  fullKey: string
): Promise<{ valid: boolean; tenantId?: string; gardenId?: string; scopes?: string[] }> {
  // Check cache first
  const cacheKey = `apikey:${fullKey.substring(0, 16)}`;
  const cached = await cacheGet<{ tenantId: string; gardenId?: string; scopes: string[] }>(cacheKey);
  if (cached) {
    return { valid: true, ...cached };
  }

  // Lookup by prefix
  const prefix = fullKey.substring(0, 8);
  const result = await query<ApiKey>(
    `SELECT * FROM api_keys
     WHERE key_prefix = $1 AND is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [prefix]
  );

  if (result.rows.length === 0) {
    return { valid: false };
  }

  // bcrypt compare against all matching keys (rare: prefix collision)
  for (const row of result.rows) {
    const match = await bcrypt.compare(fullKey, row.key_hash);
    if (match) {
      // Update last_used_at asynchronously (don't block)
      query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch(
        (err) => logger.warn({ err, keyId: row.id }, 'Failed to update last_used_at')
      );

      const data = { tenantId: row.tenant_id, gardenId: row.garden_id, scopes: row.scopes };
      await cacheSet(cacheKey, data, CACHE_TTL);
      return { valid: true, ...data };
    }
  }

  return { valid: false };
}

/**
 * Revoke (deactivate) an API key
 */
export async function revokeApiKey(keyId: string, tenantId: string): Promise<boolean> {
  const result = await query(
    'UPDATE api_keys SET is_active = false WHERE id = $1 AND tenant_id = $2',
    [keyId, tenantId]
  );
  if (result.rowCount && result.rowCount > 0) {
    await cacheDelete(`apikey:${keyId}`);
    logger.info({ keyId, tenantId }, 'API key revoked');
    return true;
  }
  return false;
}

/**
 * List all API keys for a tenant (returns sanitized data - no hashes)
 */
export async function listApiKeys(tenantId: string): Promise<
  Omit<ApiKey, 'key_hash'>[]
> {
  const result = await query(
    `SELECT id, tenant_id, garden_id, key_prefix, name, scopes, expires_at,
            last_used_at, is_active, created_at
     FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return result.rows;
}
