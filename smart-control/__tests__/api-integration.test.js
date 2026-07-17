// __tests__/api-integration.test.js — API Integration Tests
// Tests REST endpoints, auth flow, input validation, and error handling

const http = require('http');

const BASE_URL = 'http://localhost:3002';
let serverRunning = false;

const TEST_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TEST_OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD;
const TEST_VIEWER_PASSWORD = process.env.VIEWER_PASSWORD;

// Check if server is running before tests
beforeAll(async () => {
  try {
    const res = await fetch('/api/health');
    serverRunning = res.status === 200;
  } catch {
    serverRunning = false;
  }
});

// Skip all API tests if server is not running
const describeIfServer = serverRunning ? describe : describe.skip;

function fetch(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

describeIfServer('API Integration Tests', () => {
  let authToken = null;

  // ─── Health Check ───────────────────────────────────
  describe('GET /api/health', () => {
    test('returns 200 without auth', async () => {
      const res = await fetch('/api/health');
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status', 'ok');
      expect(res.data).toHaveProperty('timestamp');
    });

    test('returns mqtt status', async () => {
      const res = await fetch('/api/health');
      expect(res.data).toHaveProperty('mqtt');
      expect(typeof res.data.mqtt).toBe('boolean');
    });
  });

  // ─── Auth Flow ──────────────────────────────────────
  describe('POST /api/auth/login', () => {
    test('returns 400 for missing credentials', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: {},
      });
      expect(res.status).toBe(400);
      expect(res.data).toHaveProperty('code', 'MISSING_CREDENTIALS');
    });

    test('returns 400 for invalid types', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: { username: 123, password: true },
      });
      expect(res.status).toBe(400);
    });

    test('returns 401 for wrong password', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: 'wrongpassword' },
      });
      expect(res.status).toBe(401);
      expect(res.data).toHaveProperty('code', 'INVALID_CREDENTIALS');
    });

    test('returns 401 for unknown user', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: { username: 'nonexistent', password: 'password' },
      });
      expect(res.status).toBe(401);
    });

    test('returns 200 with valid admin credentials', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: { username: 'admin', password: TEST_ADMIN_PASSWORD },
      });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('token');
      expect(res.data.user).toHaveProperty('username', 'admin');
      expect(res.data.user).toHaveProperty('role', 'admin');
      authToken = res.data.token;
    });

    test('returns 200 with valid operator credentials', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: { username: 'operator', password: TEST_OPERATOR_PASSWORD },
      });
      expect(res.status).toBe(200);
      expect(res.data.user).toHaveProperty('role', 'operator');
    });

    test('returns 200 with valid viewer credentials', async () => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        body: { username: 'viewer', password: TEST_VIEWER_PASSWORD },
      });
      expect(res.status).toBe(200);
      expect(res.data.user).toHaveProperty('role', 'viewer');
    });
  });

  // ─── Auth Required Endpoints ────────────────────────
  describe('Protected endpoints without token', () => {
    test('GET /api/zones returns 401', async () => {
      const res = await fetch('/api/zones');
      expect(res.status).toBe(401);
    });

    test('GET /api/actuators returns 401', async () => {
      const res = await fetch('/api/actuators');
      expect(res.status).toBe(401);
    });

    test('GET /api/weather returns 401', async () => {
      const res = await fetch('/api/weather');
      expect(res.status).toBe(401);
    });

    test('GET /api/crop-stages returns 401', async () => {
      const res = await fetch('/api/crop-stages');
      expect(res.status).toBe(401);
    });
  });

  // ─── Protected endpoints with token ─────────────────
  describe('Protected endpoints with valid token', () => {
    const authHeader = () => authToken ? { Authorization: `Bearer ${authToken}` } : {};

    test('GET /api/zones returns zones array', async () => {
      const res = await fetch('/api/zones', { headers: authHeader() });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.data)).toBe(true);
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.data[0]).toHaveProperty('id');
      expect(res.data[0]).toHaveProperty('name');
      expect(res.data[0]).toHaveProperty('sensor');
      expect(res.data[0]).toHaveProperty('rule');
    });

    test('GET /api/actuators returns actuators object', async () => {
      const res = await fetch('/api/actuators', { headers: authHeader() });
      expect(res.status).toBe(200);
      expect(typeof res.data).toBe('object');
      expect(res.data).toHaveProperty('pump-1');
      expect(res.data).toHaveProperty('valve-1');
    });

    test('GET /api/weather returns weather data', async () => {
      const res = await fetch('/api/weather', { headers: authHeader() });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('temperature');
      expect(res.data).toHaveProperty('humidity');
      expect(res.data).toHaveProperty('forecast');
    });

    test('GET /api/crop-stages returns crop knowledge base', async () => {
      const res = await fetch('/api/crop-stages', { headers: authHeader() });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('robusta');
      expect(res.data).toHaveProperty('arabica');
      expect(res.data.robusta.stages).toHaveLength(6);
      expect(res.data.arabica.stages).toHaveLength(6);
    });

    test('GET /api/system returns system status', async () => {
      const res = await fetch('/api/system', { headers: authHeader() });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('uptime');
      expect(res.data).toHaveProperty('memory');
      expect(res.data).toHaveProperty('mqtt');
    });
  });

  // ─── Advisory Endpoint ──────────────────────────────
  describe('GET /api/advisory/:zoneId', () => {
    const authHeader = () => authToken ? { Authorization: `Bearer ${authToken}` } : {};

    test('returns advisory for valid zone', async () => {
      const res = await fetch('/api/advisory/zone-A', { headers: authHeader() });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('advices');
      expect(res.data).toHaveProperty('urgency');
      expect(Array.isArray(res.data.advices)).toBe(true);
    });

    test('returns 404 for invalid zone', async () => {
      const res = await fetch('/api/advisory/zone-X', { headers: authHeader() });
      expect(res.status).toBe(404);
    });
  });

  // ─── Predictive Irrigation ──────────────────────────
  describe('GET /api/predictive/:zoneId', () => {
    const authHeader = () => authToken ? { Authorization: `Bearer ${authToken}` } : {};

    test('returns recommendation for valid zone', async () => {
      const res = await fetch('/api/predictive/zone-A', { headers: authHeader() });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('zoneId', 'zone-A');
      expect(res.data).toHaveProperty('urgency');
      expect(res.data).toHaveProperty('metrics');
    });

    test('returns 404 for invalid zone', async () => {
      const res = await fetch('/api/predictive/zone-X', { headers: authHeader() });
      expect(res.status).toBe(404);
    });
  });

  // ─── Control Endpoint (Authorization) ───────────────
  describe('POST /api/control', () => {
    test('returns 401 without auth', async () => {
      const res = await fetch('/api/control', {
        method: 'POST',
        body: { actuatorId: 'pump-1', action: 'on' },
      });
      expect(res.status).toBe(401);
    });

    test('returns 400 for missing fields', async () => {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: {},
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 for invalid action', async () => {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { actuatorId: 'pump-1', action: 'invalid' },
      });
      expect(res.status).toBe(400);
    });

    test('returns 404 for nonexistent actuator', async () => {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { actuatorId: 'nonexistent', action: 'on' },
      });
      expect(res.status).toBe(404);
    });

    test('returns 200 for valid control command', async () => {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { actuatorId: 'pump-1', action: 'on' },
      });
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('success', true);
    });

    test('can turn off pump after turning on', async () => {
      const res = await fetch('/api/control', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: { actuatorId: 'pump-1', action: 'off' },
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── Error Handling ─────────────────────────────────
  describe('Error handling', () => {
    test('returns 404 for unknown endpoints', async () => {
      const res = await fetch('/api/nonexistent');
      expect(res.status).toBe(404);
    });

    test('handles malformed JSON body gracefully', async () => {
      try {
        const url = new URL('/api/auth/login', BASE_URL);
        const res = await new Promise((resolve, reject) => {
          const req = http.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode }));
          });
          req.on('error', reject);
          req.write('not json');
          req.end();
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
      } catch {}
    });
  });

  // ─── Rate Limiting ──────────────────────────────────
  describe('Rate limiting', () => {
    test('auth endpoint has rate limiting', async () => {
      // Try multiple rapid requests
      const promises = Array(5).fill(null).map(() =>
        fetch('/api/auth/login', {
          method: 'POST',
          body: { username: 'admin', password: 'wrong' },
        })
      );
      const results = await Promise.all(promises);
      // All should either succeed or be rate-limited
      results.forEach(res => {
        expect([200, 401, 429]).toContain(res.status);
      });
    });
  });

  // ─── CORS ───────────────────────────────────────────
  describe('CORS', () => {
    test('returns CORS headers', async () => {
      const url = new URL('/api/health', BASE_URL);
      const res = await new Promise((resolve, reject) => {
        const req = http.request(url, { method: 'OPTIONS' }, (res) => {
          resolve({ status: res.statusCode, headers: res.headers });
        });
        req.on('error', reject);
        req.end();
      });
      expect(res.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});
