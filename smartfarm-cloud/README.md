# SmartFarm Cloud Backend

IoT cloud platform for aggregating soil sensor data from multiple coffee farms.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SmartFarm Cloud Backend                       │
│                                                                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │  MQTT     │   │  REST    │   │ WebSocket│   │ Background│    │
│  │  Ingest   │   │  API     │   │ Server   │   │ Services  │    │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘    │
│       │              │              │              │            │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐      │
│  │              Service Layer (Business Logic)           │      │
│  │  auth │ device │ sensor │ alert │ analytics │ redis  │      │
│  └────┬──────────────┬──────────────┬───────────────────┘      │
│       │              │              │                           │
│  ┌────┴─────┐   ┌────┴─────┐   ┌────┴─────┐                  │
│  │TimescaleDB│   │  Redis   │   │  Mosquitto│                  │
│  │(PostgreSQL│   │  (Cache  │   │  (MQTT    │                  │
│  │ +TSDB)    │   │  +PubSub)│   │  Broker)  │                  │
│  └──────────┘   └──────────┘   └──────────┘                  │
└─────────────────────────────────────────────────────────────────┘
        ▲                                            ▲
        │            MQTT / REST API                 │
        │                                            │
   ┌────┴────┐                                  ┌───┴────┐
   │  Edge   │                                  │Dashboard│
   │  Agents │                                  │  (Web)  │
   │  (RPi)  │                                  │         │
   └─────────┘                                  └────────┘
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **API Server** | Node.js + TypeScript + Express | Async I/O ideal for IoT ingestion; strong typing |
| **Time-Series DB** | TimescaleDB (PostgreSQL extension) | Hypertables, continuous aggregates, compression, retention policies |
| **Cache / Pub-Sub** | Redis | API key caching, rate limiting, real-time WS broadcasts |
| **MQTT Broker** | Mosquitto | Lightweight, battle-tested; receives data from ChirpStack/edge |
| **WebSocket** | ws (native) | Real-time dashboard updates with Redis pub/sub fan-out |
| **Validation** | Zod | Type-safe schema validation for all inputs |
| **Auth** | bcrypt + API keys | Per-farm keys with scope-based access control |

## Quick Start

### 1. Start infrastructure

```bash
docker compose up -d
```

This starts TimescaleDB, Redis, and Mosquitto.

### 2. Install dependencies & build

```bash
npm install
npm run build
```

### 3. Run migrations

```bash
npm run migrate
```

### 4. Seed demo data (optional)

```bash
npm run seed
```

This creates a demo tenant, 2 farms, 7 zones, 8 devices, alert thresholds, and 7 days of sample sensor data. The API key is printed in the output.

### 5. Start the server

```bash
# Development (with hot reload)
npm run dev

# Production
npm start
```

The server starts on `http://localhost:3000`.

## API Authentication

All API endpoints (except `/health`) require an API key in the `X-API-Key` header:

```
X-API-Key: sf_<64_hex_chars>
```

API keys are scoped:
- `ingest` — Upload sensor data
- `read` — Query data, view dashboards
- `admin` — Manage tenants, gardens, devices, keys

## API Endpoints

### Health Check

```
GET /health
```

### Tenants & Gardens

```
POST   /api/v1/tenants                    — Create tenant (admin)
GET    /api/v1/tenants/:id                — Get tenant
GET    /api/v1/gardens                    — List gardens
POST   /api/v1/gardens                    — Create garden (admin)
GET    /api/v1/gardens/:id                — Get garden
GET    /api/v1/gardens/:id/zones          — List zones
POST   /api/v1/gardens/:id/zones          — Create zone (admin)
```

### Devices

```
GET    /api/v1/devices?garden_id=...      — List devices
POST   /api/v1/devices                    — Register device (admin/ingest)
GET    /api/v1/devices/:id                — Get device
PATCH  /api/v1/devices/:id/status         — Update status
```

### Sensor Data

```
POST   /api/v1/sensors/ingest             — Batch upload (ingest scope)
GET    /api/v1/sensors/data               — Query data
GET    /api/v1/sensors/latest             — Latest readings per sensor
```

#### Ingest (from edge agent)

```bash
curl -X POST http://localhost:3000/api/v1/sensors/ingest \
  -H "X-API-Key: sf_..." \
  -H "Content-Type: application/json" \
  -d '{
    "device_eui": "0004a30b00e1c2d1",
    "garden_id": "...",
    "readings": [
      {
        "zone_id": "...",
        "sensor_type": "moisture",
        "value": 55.3,
        "unit": "%",
        "quality": "good",
        "timestamp": "2024-01-15T10:30:00Z",
        "battery_voltage": 3.3,
        "rssi": -67
      }
    ]
  }'
```

#### Query

```bash
# Last 24h of moisture data, hourly granularity
curl "http://localhost:3000/api/v1/sensors/data?garden_id=...&sensor_type=moisture&granularity=1h" \
  -H "X-API-Key: sf_..."
```

### Analytics

```
POST   /api/v1/analytics/query            — Cross-farm analytics
GET    /api/v1/analytics/garden/:id/summary    — Dashboard summary
GET    /api/v1/analytics/garden/:id/anomalies  — Anomaly detection
GET    /api/v1/analytics/garden/:id/benchmark  — Crop type benchmarking
```

#### Cross-Farm Query

```bash
curl -X POST http://localhost:3000/api/v1/analytics/query \
  -H "X-API-Key: sf_..." \
  -d '{
    "sensor_type": "moisture",
    "from": "2024-01-01T00:00:00Z",
    "to": "2024-01-15T00:00:00Z",
    "aggregation": "avg",
    "group_by": "crop_type",
    "compare_with": "previous_period"
  }'
```

### Alerts

```
POST   /api/v1/alerts/thresholds          — Create threshold (admin)
GET    /api/v1/alerts/thresholds          — List thresholds
DELETE /api/v1/alerts/thresholds/:id      — Delete threshold (admin)
GET    /api/v1/alerts                     — List alerts
PATCH  /api/v1/alerts/:id/acknowledge     — Acknowledge alert
```

### API Keys

```
POST   /api/v1/apikeys                    — Create key (admin)
GET    /api/v1/apikeys                    — List keys
DELETE /api/v1/apikeys/:id                — Revoke key (admin)
```

## WebSocket (Real-time Dashboard)

Connect to `ws://localhost:3000/ws`:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

// 1. Authenticate
ws.send(JSON.stringify({
  type: 'auth',
  api_key: 'sf_...'
}));

// 2. Subscribe to updates
ws.send(JSON.stringify({
  type: 'subscribe',
  garden_id: '...',
  sensor_types: ['moisture', 'temperature']
}));

// 3. Receive real-time data
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // msg.type: 'sensor_update' | 'alert' | 'device_status'
  console.log(msg);
};
```

## Database Schema (Key Tables)

```
tenants ──┬── gardens ──┬── zones
           │            ├── devices
           │            └── sensor_readings (TimescaleDB hypertable)
           ├── api_keys
           └── alert_thresholds ──── alerts
```

### Time-Series Optimizations

- **Hypertable**: `sensor_readings` partitioned by day
- **Compression**: Auto-compresses data older than 7 days (~10x savings)
- **Continuous Aggregates**: Hourly and daily rollups auto-materialized
- **Retention Policy**: Raw data auto-dropped after 90 days (rollups kept)

## Edge Agent → Cloud Data Flow

```
┌─────────────┐     MQTT      ┌─────────────┐
│  RPi Edge   │──────────────▶│  Mosquitto   │
│  Agent      │               │  Broker      │
└─────────────┘               └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │  MQTT       │
                              │  Ingest     │
                              │  Handler    │
                              └──────┬──────┘
                                     │
                              ┌──────▼──────┐
                              │  Validate   │
                              │  + Store    │
                              │  + Alert    │
                              └──────┬──────┘
                                     │
                     ┌───────────────┼───────────────┐
                     │               │               │
              ┌──────▼──────┐ ┌──────▼──────┐ ┌─────▼─────┐
              │ TimescaleDB │ │   Redis     │ │ WebSocket │
              │             │ │  Pub/Sub    │ │ Broadcast │
              └─────────────┘ └─────────────┘ └───────────┘
```

## Production Deployment

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@host:5432/smartfarm_cloud
REDIS_URL=redis://host:6379
JWT_SECRET=<64-char-random-string>
MQTT_PASSWORD=<strong-password>

# Optional
PORT=3000
DB_POOL_SIZE=20
RATE_LIMIT_MAX_REQUESTS=100
LOG_LEVEL=info
CORS_ORIGIN=https://dashboard.yourdomain.com
```

### Scaling Considerations

1. **API servers**: Stateless — horizontal scale behind load balancer
2. **TimescaleDB**: Add read replicas for analytics queries
3. **Redis**: Use Redis Cluster for high availability
4. **MQTT**: Use MQTT bridge for multi-region deployments
5. **Rate limits**: Adjust per plan tier (free: 60/min, pro: 300/min, enterprise: unlimited)

### Security Checklist

- [ ] Change all default passwords
- [ ] Set `JWT_SECRET` to a random 64+ char string
- [ ] Enable TLS on MQTT broker
- [ ] Set `CORS_ORIGIN` to your dashboard domain
- [ ] Use network policies to restrict database/redis access
- [ ] Enable PostgreSQL SSL connections
- [ ] Set up monitoring (Prometheus + Grafana)
- [ ] Configure log aggregation (ELK / Loki)

## License

Proprietary — SmartFarm AgriTech
