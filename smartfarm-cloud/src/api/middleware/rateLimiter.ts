// ============================================================================
// SmartFarm Cloud - Rate Limiting Middleware (Redis-backed sliding window)
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { checkRateLimit } from '../../services/redis';
import { config } from '../../config';

/**
 * Per-tenant rate limiter using Redis sliding window.
 * Uses the API key prefix as the rate limit key.
 */
export function rateLimiter(limitOverride?: number) {
  const limit = limitOverride ?? config.rateLimit.maxRequests;
  const windowMs = config.rateLimit.windowMs;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = (req.headers['x-api-key'] as string) || req.ip || 'unknown';
    const rateLimitKey = `ratelimit:${key.substring(0, 16)}`;

    const { allowed, remaining } = await checkRateLimit(rateLimitKey, limit, windowMs);

    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + windowMs) / 1000));

    if (!allowed) {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Please slow down.',
        retry_after_ms: windowMs,
      });
      return;
    }

    next();
  };
}

/**
 * Higher rate limit for data ingestion endpoints
 * (edge devices send batches every 5-15 min but may retry)
 */
export function ingestionRateLimiter() {
  return rateLimiter(120); // 120 requests per window (generous for retries)
}
