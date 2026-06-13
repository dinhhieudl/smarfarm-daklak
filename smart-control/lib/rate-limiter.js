// SmartFarm DakLak - Rate Limiter Middleware
// In-memory sliding window rate limiter (no external dependencies)

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 minute
const DEFAULT_MAX_REQUESTS = 60;     // 60 requests per window

// Store: key → { count, resetTime, hits[] }
const store = new Map();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, 5 * 60 * 100);

/**
 * Create rate limiter middleware
 * @param {object} options
 * @param {number} [options.windowMs=60000] - Time window in ms
 * @param {number} [options.max=60] - Max requests per window
 * @param {string} [options.keyPrefix='rl'] - Key prefix for store
 * @param {function} [options.keyGenerator] - Custom key generator (req) => string
 * @param {string} [options.message] - Error message
 * @returns {function} Express middleware
 */
function createRateLimiter({
  windowMs = DEFAULT_WINDOW_MS,
  max = DEFAULT_MAX_REQUESTS,
  keyPrefix = 'rl',
  keyGenerator,
  message = 'Too many requests, please try again later'
} = {}) {
  return (req, res, next) => {
    const key = keyGenerator
      ? keyGenerator(req)
      : `${keyPrefix}:${req.ip || req.connection.remoteAddress || 'unknown'}`;

    const now = Date.now();
    let entry = store.get(key);

    // Reset window if expired
    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (entry.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        error: message,
        code: 'RATE_LIMITED',
        retryAfter: resetSeconds
      });
    }

    next();
  };
}

// Pre-configured limiters for different endpoint types
const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,          // 120 req/min for general API
  keyPrefix: 'api'
});

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,           // 10 login attempts per 15 min
  keyPrefix: 'auth',
  keyGenerator: (req) => `auth:${req.ip || req.connection.remoteAddress}:${req.body?.username || 'unknown'}`,
  message: 'Too many login attempts, please try again in 15 minutes'
});

const controlLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,           // 30 control actions per min
  keyPrefix: 'ctrl'
});

const exportLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,           // 10 exports per min (heavy operations)
  keyPrefix: 'export'
});

module.exports = {
  createRateLimiter,
  apiLimiter,
  authLimiter,
  controlLimiter,
  exportLimiter
};
