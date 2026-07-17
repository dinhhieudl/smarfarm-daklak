# SmartFarm DakLak — Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task.

**Goal:** Fix all CRITICAL and HIGH severity issues identified in the comprehensive audit to make the system production-ready.

**Architecture:** Security hardening first (credentials, auth, CORS), then infrastructure fixes (Docker, config), then code quality (bugs, dead code, tests).

**Tech Stack:** Node.js, Docker Compose, Express, Socket.IO, MQTT, InfluxDB, React Native

## Global Constraints
- Node.js 20+ required
- All changes must pass `npm test` (128 tests must remain green)
- ESLint: 0 errors
- Never commit `.env` files or secrets
- Follow existing code style (CommonJS for smart-control/simulator, TypeScript for mobile)

---

## Task 1: Security — Remove Hardcoded Credentials

**Covers:** C-1, C-2, C-3, C-4, C-5, C-6 (smart-control), C-02 through C-08 (infrastructure)

**Files:**
- Modify: `smart-control/server.js:62-64, 101-103`
- Modify: `smart-control/lib/influx.js:8-11`
- Modify: `server/docker-compose.yml:33, 159, 178, 309-312`
- Modify: `server/config/chirpstack.toml:38`
- Modify: `server/config/mosquitto.conf:5`
- Modify: `.env.example`

**Interfaces:**
- Consumes: existing server.js startup logic
- Produces: server crashes on missing env vars in production

- [ ] **Step 1: Fix smart-control JWT_SECRET**

```javascript
// server.js line 62-64 — REPLACE
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('JWT_SECRET environment variable is required in production');
    }
    console.warn('[SECURITY] Using development JWT_SECRET — NOT FOR PRODUCTION');
}
const DEV_JWT_SECRET = 'dev-only-change-me-in-production';
const effectiveSecret = JWT_SECRET || DEV_JWT_SECRET;
```

Then replace all `JWT_SECRET` references with `effectiveSecret` in server.js.

- [ ] **Step 2: Fix smart-control default passwords**

```javascript
// server.js lines 101-103 — REMOVE hardcoded defaults
const DEFAULT_ADMIN_PASS = process.env.ADMIN_PASSWORD;
const DEFAULT_OPERATOR_PASS = process.env.OPERATOR_PASSWORD;
const DEFAULT_VIEWER_PASS = process.env.VIEWER_PASSWORD;

// Filter out undefined passwords
const USERS = [
    DEFAULT_ADMIN_PASS && { username: 'admin', passwordHash: bcrypt.hashSync(DEFAULT_ADMIN_PASS, 10), role: 'admin' },
    DEFAULT_OPERATOR_PASS && { username: 'operator', passwordHash: bcrypt.hashSync(DEFAULT_OPERATOR_PASS, 10), role: 'operator' },
    DEFAULT_VIEWER_PASS && { username: 'viewer', passwordHash: bcrypt.hashSync(DEFAULT_VIEWER_PASS, 10), role: 'viewer' }
].filter(Boolean);
```

- [ ] **Step 3: Fix docker-compose.yml — remove all default passwords**

Replace all `:-default` fallbacks with empty strings that will cause services to fail if not set:

```yaml
# Lines 33, 159, 178, 309-312
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
DOCKER_INFLUXDB_INIT_PASSWORD: ${INFLUXDB_ADMIN_PASSWORD:?INFLUXDB password is required}
SUPERSET_DB_PASSWORD: ${SUPERSET_DB_PASSWORD:?SUPERSET_DB_PASSWORD is required}
JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
ADMIN_PASSWORD: ${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}
OPERATOR_PASSWORD: ${OPERATOR_PASSWORD:?OPERATOR_PASSWORD is required}
VIEWER_PASSWORD: ${VIEWER_PASSWORD:?VIEWER_PASSWORD is required}
```

- [ ] **Step 4: Fix mosquitto.conf — disable anonymous access**

```
# mosquitto.conf — REPLACE line 5
allow_anonymous false
password_file /mosquitto/config/password.txt
listener 1883
listener 9001
protocol websockets
```

- [ ] **Step 5: Fix chirpstack.toml — remove JWT secret default**

```toml
# chirpstack.toml line 38 — REPLACE
secret = "${CHIRPSTACK_JWT_SECRET:?CHIRPSTACK_JWT_SECRET is required}"
```

- [ ] **Step 6: Update .env.example with generation instructions**

```bash
# .env.example — Add at top
# Generate secrets before starting:
#   openssl rand -hex 32  # For JWT_SECRET, INFLUXDB_ADMIN_TOKEN, etc.
#   openssl rand -base16 16  # For passwords
```

- [ ] **Step 7: Run tests**

```bash
cd smart-control && npm test
```

Expected: All 100 tests pass

---

## Task 2: Security — Fix Socket.IO Authentication Bypass

**Covers:** C-2 (smart-control), Mobile app Socket.IO auth

**Files:**
- Modify: `smart-control/server.js:24-26, 588-643`
- Modify: `smart-control/middleware/auth.js`

**Interfaces:**
- Consumes: JWT_SECRET from Task 1
- Produces: authenticated WebSocket connections

- [ ] **Step 1: Add Socket.IO auth middleware**

```javascript
// server.js — After io creation (line 26), add:
io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
        return next(new Error('Authentication required'));
    }
    try {
        const decoded = jwt.verify(token, effectiveSecret);
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error('Invalid token'));
    }
});
```

- [ ] **Step 2: Remove per-message auth bypass on control events**

The `socket.on('control')` handler at line 600 currently has no auth check. After Step 1, all connected sockets are authenticated, so this is covered.

- [ ] **Step 3: Update Socket.IO client connection in Smart Control dashboard**

```javascript
// public/index.html or public/js/app.js — Update socket connection
const socket = io({
    auth: { token: localStorage.getItem('auth_token') }
});
```

- [ ] **Step 4: Run tests**

```bash
cd smart-control && npm test
```

---

## Task 3: Security — Fix Helmet and CORS

**Covers:** C-5, C-6 (smart-control)

**Files:**
- Modify: `smart-control/server.js:28-47`

- [ ] **Step 1: Enable CSP with allowlist**

```javascript
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'", "ws:", "wss:"]
        }
    },
    crossOriginEmbedderPolicy: false
}));
```

- [ ] **Step 2: Restrict CORS**

```javascript
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3002'];
```

- [ ] **Step 3: Protect metrics endpoint**

```javascript
app.get('/metrics', authenticateTokenMiddleware, async (req, res) => {
    await metrics.metricsEndpoint(req, res);
});
```

- [ ] **Step 4: Run tests**

---

## Task 4: Fix Dead Code and Duplicate Definitions

**Covers:** H-1, H-2 (smart-control)

**Files:**
- Delete: `smart-control/routes/` (all 8 unused route files)
- Delete: `smart-control/middleware/auth.js` (unused)
- Create: `smart-control/lib/crop-data.js`
- Modify: `smart-control/server.js`
- Modify: `smart-control/lib/advisory.js`
- Modify: `smart-control/lib/predictive-irrigation.js`

- [ ] **Step 1: Delete unused route files**

```bash
rm -rf smart-control/routes/
```

- [ ] **Step 2: Create consolidated crop data module**

```javascript
// lib/crop-data.js
const CROP_STAGES = {
    robusta: {
        name: 'Cà phê Robusta',
        stages: [
            { id: 'dormant', name: 'Nghỉ (Rụng lá)', months: [11, 12, 1], ... },
            // ... all 6 stages from server.js
        ]
    },
    arabica: { ... }
};

function getCurrentStage(crop, date = new Date()) {
    const month = date.getMonth() + 1;
    const cropData = CROP_STAGES[crop];
    if (!cropData) return null;
    return cropData.stages.find(s => s.months.includes(month)) || cropData.stages[0];
}

module.exports = { CROP_STAGES, getCurrentStage };
```

- [ ] **Step 3: Update server.js to use consolidated module**

Replace inline CROP_STAGES and getCurrentStage with:
```javascript
const { CROP_STAGES, getCurrentStage } = require('./lib/crop-data');
```

- [ ] **Step 4: Update lib/advisory.js to import from crop-data**

- [ ] **Step 5: Update lib/predictive-irrigation.js to import getCurrentStage**

- [ ] **Step 6: Run tests**

---

## Task 5: Fix InfluxDB Issues

**Covers:** C-1 (smart-control), H-7, H-8 (smart-control)

**Files:**
- Modify: `smart-control/lib/influx.js`
- Modify: `smart-control/server.js:52-54`

- [ ] **Step 1: Sanitize zoneId in Flux queries**

```javascript
// lib/influx.js — Add sanitization function
function sanitizeZoneId(zoneId) {
    if (typeof zoneId !== 'string') return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(zoneId)) return null;
    return zoneId;
}

// Update queryHistory to use sanitized input
async function queryHistory(zoneId, hours = 24) {
    const safeZone = sanitizeZoneId(zoneId);
    if (!safeZone) return [];
    // ... use safeZone in query
}
```

- [ ] **Step 2: Fix writeApi.close() on shutdown**

```javascript
// lib/influx.js — Update flush function
function flush() {
    if (writeApi) {
        writeApi.flush().catch(() => {});
        writeApi.close().catch(() => {});
    }
}
```

- [ ] **Step 3: Run tests**

---

## Task 6: Fix Logger and Audit Module

**Covers:** H-4, H-5 (smart-control)

**Files:**
- Modify: `smart-control/lib/logger.js`
- Modify: `smart-control/lib/audit.js`

- [ ] **Step 1: Add log rotation to logger.js**

```javascript
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const LOG_DIR = path.join(__dirname, '..', 'logs');

function rotateLogFile(filePath) {
    try {
        const stats = fs.statSync(filePath);
        if (stats.size > MAX_LOG_SIZE) {
            const archive = filePath.replace('.log', `-${Date.now()}.log`);
            fs.renameSync(filePath, archive);
        }
    } catch {}
}
```

- [ ] **Step 2: Convert audit.js to async writes**

```javascript
// lib/audit.js — Replace appendFileSync with appendFile
const fs = require('fs').promises;

async function appendToFile(entry) {
    try {
        await fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n');
    } catch (err) {
        console.error('[Audit] Failed to write log:', err.message);
    }
}
```

- [ ] **Step 3: Run tests**

---

## Task 7: Fix WaterBalance Predict Threshold

**Covers:** H-9 (smart-control)

**Files:**
- Modify: `smart-control/lib/water-balance.js`
- Modify: `smart-control/lib/predictive-irrigation.js`

- [ ] **Step 1: Add moistureMin parameter to WaterBalance**

```javascript
class WaterBalance {
    constructor(config) {
        // ... existing code
        this.moistureMin = config.moistureMin ?? 35;
    }

    predict(ETc, expectedRain = 0, hoursAhead = 24) {
        // ... existing code
        return {
            predictedMoisture,
            needsIrrigation: predictedMoisture < this.moistureMin, // Use instance value
            daysToWilting
        };
    }
}
```

- [ ] **Step 2: Pass moistureMin when creating WaterBalance instances**

```javascript
// predictive-irrigation.js constructor
this.balances[zone.id] = new WaterBalance({
    zoneId: zone.id,
    initialMoisture: (rule.moistureMin + rule.moistureMax) / 2,
    fieldCapacity: rule.moistureMax ?? 65,
    wiltingPoint: (rule.moistureMin ?? 35) - 10,
    moistureMin: rule.moistureMin ?? 35, // ADD THIS
    rootDepth: 0.5,
    availableWater: 100
});
```

- [ ] **Step 3: Run tests**

---

## Task 8: Fix Simulator Critical Bugs

**Covers:** C1, C2, C3, C4 (simulator)

**Files:**
- Modify: `simulator/server.js:258-266`
- Modify: `simulator/lib/environment.js:47-72`
- Modify: `simulator/lib/soil.js:94-95`

- [ ] **Step 1: Fix scenario-physics interaction**

```javascript
// simulator/server.js — In tick(), check if scenario is active
function tick() {
    scenarioTick();

    if (simState.config.usePhysics && !simState.scenario.active) {
        physicsTick();
    } else if (simState.scenario.active) {
        // Apply scenario weather without physics override
        applyVariation();
    }
    // ... rest of tick
}
```

- [ ] **Step 2: Fix ET0 unit conversion**

```javascript
// simulator/lib/environment.js line 51
const Ra = solarRadiation / 277.78; // W/m² → MJ/m²/hour (correct: /277.78 not /1000)
```

- [ ] **Step 3: Remove double-counted temperature factor**

```javascript
// simulator/lib/soil.js lines 94-95 — REMOVE tempFactor
// const tempFactor = Math.min(1.5, Math.max(0.3, temperature / 30));
const et_actual = et0 * stressFactor * dtHours; // Remove tempFactor
```

- [ ] **Step 4: Run simulator tests**

```bash
cd simulator && npm test
```

---

## Task 9: Fix Configuration Files

**Covers:** H-3, H-10 (infrastructure), project-level config issues

**Files:**
- Modify: `smart-control/config/zones.json`
- Modify: `smart-control/config/actuators.json`
- Modify: `smart-control/config/irrigation-rules.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update zones.json with all 3 zones**

```json
[
    {
        "id": "zone-A",
        "name": "Khu A",
        "area": 3000,
        "crop": "robusta",
        "plantDate": "2024-03-15",
        "soilType": "bazan-red",
        "pumpId": "pump-1",
        "valveId": "valve-1",
        "moistureSensor": "aabbccdd11223344",
        "location": { "lat": 12.753, "lng": 108.048 }
    },
    {
        "id": "zone-B",
        "name": "Khu B",
        "area": 2500,
        "crop": "robusta",
        "plantDate": "2024-06-20",
        "soilType": "bazan-red",
        "pumpId": "pump-1",
        "valveId": "valve-2",
        "moistureSensor": "bbccdd1122334455",
        "location": { "lat": 12.755, "lng": 108.050 }
    },
    {
        "id": "zone-C",
        "name": "Khu C",
        "area": 2000,
        "crop": "arabica",
        "plantDate": "2024-01-10",
        "soilType": "bazan-red",
        "pumpId": "pump-2",
        "valveId": "valve-3",
        "moistureSensor": "ccdd112233445566",
        "location": { "lat": 12.751, "lng": 108.052 }
    }
]
```

- [ ] **Step 2: Update actuators.json with all 5 actuators**

```json
{
    "pump-1": { "id": "pump-1", "name": "Bơm chính #1", "type": "pump", "state": "off", "autoMode": false, "lastChange": null, "flowRate": 50 },
    "pump-2": { "id": "pump-2", "name": "Bơm chính #2", "type": "pump", "state": "off", "autoMode": false, "lastChange": null, "flowRate": 30 },
    "valve-1": { "id": "valve-1", "name": "Van khu A", "type": "valve", "state": "closed", "autoMode": false, "lastChange": null, "zone": "zone-A" },
    "valve-2": { "id": "valve-2", "name": "Van khu B", "type": "valve", "state": "closed", "autoMode": false, "lastChange": null, "zone": "zone-B" },
    "valve-3": { "id": "valve-3", "name": "Van khu C", "type": "valve", "state": "closed", "autoMode": false, "lastChange": null, "zone": "zone-C" }
}
```

- [ ] **Step 3: Update irrigation-rules.json with all 3 zones**

```json
{
    "zone-A": { "enabled": true, "moistureMin": 35, "moistureMax": 65, "maxDurationMin": 30, "cooldownMin": 120, "rainPause": true, "rainThreshold": 5, "lastIrrigation": null },
    "zone-B": { "enabled": true, "moistureMin": 35, "moistureMax": 65, "maxDurationMin": 25, "cooldownMin": 120, "rainPause": true, "rainThreshold": 5, "lastIrrigation": null },
    "zone-C": { "enabled": true, "moistureMin": 40, "moistureMax": 70, "maxDurationMin": 20, "cooldownMin": 90, "rainPause": true, "rainThreshold": 5, "lastIrrigation": null }
}
```

- [ ] **Step 4: Update .gitignore**

Add:
```
server/superset/.env
*.epub
SESSION_CONTEXT.md
SESSION_PROMPT.md
query_avy_debt.py
AUDIT-REPORT.md
COMPREHENSIVE-AUDIT-2026.md
TESTING-REPORT.md
smart-control/logs/
```

- [ ] **Step 5: Run tests**

---

## Task 10: Fix Docker Security and Configuration

**Covers:** H-01, H-05, H-06, H-09, H-10, MI-01 (infrastructure)

**Files:**
- Modify: `server/docker-compose.yml`

- [ ] **Step 1: Add resource limits to all services**

```yaml
services:
  postgres:
    # ... existing config
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '1.0'

  redis:
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'

  influxdb:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '1.0'
```

- [ ] **Step 2: Pin image versions**

```yaml
nodered:
    image: nodered/node-red:4.0  # Pin version

prometheus:
    image: prom/prometheus:v2.53.0  # Pin version
```

- [ ] **Step 3: Add Docker networks**

```yaml
networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
  mqtt:
    driver: bridge
```

- [ ] **Step 4: Remove unnecessary port mappings**

```yaml
postgres:
    # REMOVE: ports: ["5432:5432"]

superset-db:
    # REMOVE: ports: ["5434:5432"]

superset-redis:
    # REMOVE: ports: ["6381:6379"]
```

- [ ] **Step 5: Add logging configuration**

```yaml
services:
  # Add to each service:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 6: Run docker compose config to validate**

```bash
cd server && docker compose config --quiet
```

---

## Task 11: Fix Alert Persistence

**Covers:** H-3 (smart-control)

**Files:**
- Modify: `smart-control/lib/alerts.js`

- [ ] **Step 1: Add file persistence to alerts**

```javascript
const fs = require('fs').promises;
const ALERTS_FILE = path.join(__dirname, '..', 'logs', 'alerts.json');

async function persistAlerts() {
    try {
        await fs.writeFile(ALERTS_FILE, JSON.stringify(alerts, null, 2));
    } catch {}
}

async function loadAlerts() {
    try {
        const data = await fs.readFile(ALERTS_FILE, 'utf8');
        alerts = JSON.parse(data);
        alertIdCounter = alerts.length > 0
            ? Math.max(...alerts.map(a => parseInt(a.id.split('-')[2]) || 0)) + 1
            : 0;
    } catch {}
}
```

- [ ] **Step 2: Call persistAlerts after createAlert**

```javascript
function createAlert({ ... }) {
    // ... existing code
    alerts.unshift(alert);
    if (alerts.length > MAX_ALERTS) alerts.pop();
    persistAlerts(); // Add this
    return alert;
}
```

- [ ] **Step 3: Run tests**

---

## Task 12: Add Missing Tests for Critical Paths

**Covers:** Test coverage gaps identified in audit

**Files:**
- Create: `smart-control/__tests__/influx.test.js`
- Create: `smart-control/__tests__/water-balance.test.js`
- Create: `simulator/__tests__/eto.test.js`
- Create: `simulator/__tests__/soil-temperature.test.js`

- [ ] **Step 1: Write InfluxDB sanitization tests**

```javascript
// __tests__/influx.test.js
const { sanitizeZoneId } = require('../lib/influx');

describe('InfluxDB Sanitization', () => {
    test('accepts valid zone IDs', () => {
        expect(sanitizeZoneId('zone-A')).toBe('zone-A');
        expect(sanitizeZoneId('zone_1')).toBe('zone_1');
    });

    test('rejects injection attempts', () => {
        expect(sanitizeZoneId('zone"; DROP TABLE')).toBeNull();
        expect(sanitizeZoneId('<script>alert(1)</script>')).toBeNull();
    });

    test('rejects non-string input', () => {
        expect(sanitizeZoneId(null)).toBeNull();
        expect(sanitizeZoneId(undefined)).toBeNull();
        expect(sanitizeZoneId(123)).toBeNull();
    });
});
```

- [ ] **Step 2: Write WaterBalance predict tests**

```javascript
// __tests__/water-balance.test.js
const { WaterBalance } = require('../lib/water-balance');

describe('WaterBalance.predict', () => {
    test('uses zone moistureMin threshold', () => {
        const wb = new WaterBalance({
            zoneId: 'zone-C',
            initialMoisture: 45,
            fieldCapacity: 70,
            wiltingPoint: 30,
            moistureMin: 40, // zone-C specific
            rootDepth: 0.5,
            availableWater: 100
        });

        const result = wb.predict(4.0, 0, 24);
        // At 45% with ETc=4.0, should drop below 40 in ~24h
        expect(result.needsIrrigation).toBe(true);
    });
});
```

- [ ] **Step 3: Write ET₀ unit tests for simulator**

```javascript
// simulator/__tests__/eto.test.js
const { getET0 } = require('../lib/environment');

describe('ET₀ Calculation', () => {
    test('produces reasonable values for tropical conditions', () => {
        const et0 = getET0(30, 70, 2, 500);
        expect(et0).toBeGreaterThan(0);
        expect(et0).toBeLessThan(15); // Max reasonable hourly ET
    });

    test('increases with temperature', () => {
        const et0_cold = getET0(20, 70, 2, 300);
        const et0_hot = getET0(40, 70, 2, 800);
        expect(et0_hot).toBeGreaterThan(et0_cold);
    });

    test('decreases with humidity', () => {
        const et0_dry = getET0(30, 30, 2, 500);
        const et0_humid = getET0(30, 90, 2, 500);
        expect(et0_dry).toBeGreaterThan(et0_humid);
    });
});
```

- [ ] **Step 4: Write soil temperature tests**

```javascript
// simulator/__tests__/soil-temperature.test.js
const { updateSoilTemperature } = require('../lib/soil');

describe('Soil Temperature', () => {
    test('lags behind air temperature', () => {
        const airTemp = 35;
        const soilTemp = 25;
        const result = updateSoilTemperature(airTemp, soilTemp, 10, 1);
        // Should move toward air temp but not reach it in 1 hour
        expect(result).toBeGreaterThan(soilTemp);
        expect(result).toBeLessThan(airTemp);
    });

    test('stays within physical bounds', () => {
        let temp = 25;
        for (let i = 0; i < 100; i++) {
            temp = updateSoilTemperature(35, temp, 10, 1);
        }
        expect(temp).toBeGreaterThan(-10);
        expect(temp).toBeLessThan(60);
    });
});
```

- [ ] **Step 5: Run all tests**

```bash
cd smart-control && npm test
cd ../simulator && npm test
```

Expected: All tests pass (128 + new tests)

---

## Task 13: Fix Mobile App Critical Issues

**Covers:** Socket.IO auth, Error Boundary, offline support

**Files:**
- Modify: `smartfarm-mobile/src/hooks/useSocket.ts`
- Modify: `smartfarm-mobile/src/api/client.ts`
- Create: `smartfarm-mobile/src/components/ErrorBoundary.tsx`
- Modify: `smartfarm-mobile/App.tsx`

- [ ] **Step 1: Add Socket.IO authentication**

```typescript
// src/hooks/useSocket.ts
const socket = io(API_URL, {
    auth: { token: await AsyncStorage.getItem('auth_token') },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
});
```

- [ ] **Step 2: Create ErrorBoundary component**

```tsx
// src/components/ErrorBoundary.tsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError) {
            return (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                    <Text style={{ fontSize: 18, marginBottom: 10 }}>Đã xảy ra lỗi</Text>
                    <Text style={{ color: '#666', marginBottom: 20 }}>{this.state.error?.message}</Text>
                    <TouchableOpacity onPress={() => this.setState({ hasError: false, error: null })}>
                        <Text style={{ color: '#1a5c2e' }}>Thử lại</Text>
                    </TouchableOpacity>
                </View>
            );
        }
        return this.props.children;
    }
}
```

- [ ] **Step 3: Wrap App in ErrorBoundary**

```tsx
// App.tsx
import { ErrorBoundary } from './src/components/ErrorBoundary';

export default function App() {
    return (
        <ErrorBoundary>
            <NavigationContainer>
                {/* ... existing app */}
            </NavigationContainer>
        </ErrorBoundary>
    );
}
```

- [ ] **Step 4: Fix 401 interceptor**

```typescript
// src/api/client.ts
client.interceptors.response.use(
    (response) => response,
    async (error) => {
        if (error.response?.status === 401) {
            await AsyncStorage.removeItem('auth_token');
            useAuthStore.getState().logout(); // ADD THIS
        }
        return Promise.reject(error);
    }
);
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd smartfarm-mobile && npx tsc --noEmit
```

---

## Task 14: Add Request Timeout

**Covers:** H-12 (smart-control)

**Files:**
- Modify: `smart-control/server.js`

- [ ] **Step 1: Add timeout middleware**

```javascript
// server.js — After helmet middleware
const timeout = require('connect-timeout');
app.use(timeout('30s'));
```

- [ ] **Step 2: Add to package.json**

```json
"connect-timeout": "^1.3.0"
```

- [ ] **Step 3: Run tests**

---

## Task 15: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all smart-control tests**

```bash
cd smart-control && npm test
```

Expected: All tests pass

- [ ] **Step 2: Run all simulator tests**

```bash
cd simulator && npm test
```

Expected: All tests pass

- [ ] **Step 3: Run ESLint**

```bash
npx eslint smart-control/server.js smart-control/lib/*.js simulator/server.js simulator/lib/*.js
```

Expected: 0 errors

- [ ] **Step 4: Run TypeScript check for mobile**

```bash
cd smartfarm-mobile && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: Validate Docker Compose**

```bash
cd server && docker compose config --quiet
```

Expected: No errors

- [ ] **Step 6: Commit all changes**

```bash
git add -A
git commit -m "fix: critical security and code quality fixes from audit

- Remove all hardcoded credentials and default passwords
- Add Socket.IO JWT authentication
- Enable Helmet CSP and restrict CORS
- Fix InfluxDB query injection vulnerability
- Fix simulator ET0 calculation errors
- Remove dead code and consolidate crop data
- Add missing tests for critical paths
- Update configuration files for 3 zones
- Add Docker resource limits and version pinning
- Add ErrorBoundary to mobile app
- Fix log rotation and audit persistence"
```
