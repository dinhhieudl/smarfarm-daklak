// ============================================================================
// SmartFarm Cloud - Redis Client (Caching + Pub/Sub)
// ============================================================================

import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

// Main connection for caching
export const redis = new Redis(config.redis.url, {
  keyPrefix: config.redis.keyPrefix,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

// Separate connection for pub/sub (Redis requires dedicated connection)
export const redisSub = new Redis(config.redis.url, {
  keyPrefix: config.redis.keyPrefix,
  maxRetriesPerRequest: 3,
});

redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));
redisSub.on('error', (err) => logger.error({ err }, 'Redis subscriber error'));
redis.on('connect', () => logger.info('Redis connected'));
redisSub.on('connect', () => logger.info('Redis subscriber connected'));

// Cache helpers with TTL
export async function cacheGet<T>(key: string): Promise<T | null> {
  const data = await redis.get(key);
  if (!data) return null;
  return JSON.parse(data);
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDelete(key: string): Promise<void> {
  await redis.del(key);
}

export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  const keys = await redis.keys(`*${pattern}*`);
  if (keys.length > 0) {
    // keys already have prefix, but KEYS returns full prefixed keys
    // DEL needs unprefixed keys since client has keyPrefix
    const unprefixed = keys.map(k => k.replace(config.redis.keyPrefix, ''));
    await redis.del(...unprefixed);
  }
}

// Pub/Sub for real-time WebSocket broadcasts
export async function publish(channel: string, message: unknown): Promise<void> {
  await redis.publish(channel, JSON.stringify(message));
}

export async function subscribe(
  channel: string,
  handler: (message: unknown) => void
): Promise<void> {
  await redisSub.subscribe(channel);
  redisSub.on('message', (ch, message) => {
    if (ch === channel) {
      try {
        handler(JSON.parse(message));
      } catch (err) {
        logger.error({ err, channel }, 'Failed to parse Redis pub/sub message');
      }
    }
  });
}

// Rate limiting with sliding window
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;

  const multi = redis.multi();
  multi.zremrangebyscore(key, 0, windowStart);
  multi.zadd(key, now.toString(), `${now}-${Math.random()}`);
  multi.zcard(key);
  multi.expire(key, Math.ceil(windowMs / 1000));

  const results = await multi.exec();
  const count = (results?.[2]?.[1] as number) ?? 0;

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
  };
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
  await redisSub.quit();
}
