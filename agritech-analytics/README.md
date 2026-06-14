# AgriTech Coffee Farm Analytics Platform — DakLak, Vietnam

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA SOURCES                                  │
│  Coffee Farms (100s) → Zones (5-20/farm) → Sensors (6/zone)        │
│  Each sensor reports every 5 min = ~172,800 data points/farm/day    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ MQTT / HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     INGESTION LAYER                                  │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────┐                 │
│  │ MQTT     │→│ Apache Kafka │→│ Schema        │                  │
│  │ Broker   │  │ (partitioned │  │ Validation    │                  │
│  │ (Eclipse │  │  by farm_id) │  │ & Enrichment  │                  │
│  │ Mosquitto)│  └──────┬───────┘  └───────┬───────┘                 │
│  └──────────┘         │                   │                         │
└───────────────────────┼───────────────────┼─────────────────────────┘
                        │                   │
                        ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     STORAGE LAYER                                    │
│                                                                      │
│  ┌───────────────────────┐  ┌──────────────────────────┐           │
│  │ TimescaleDB           │  │ Object Storage (S3/MinIO)│           │
│  │ ┌───────────────────┐ │  │ - Raw data archive       │           │
│  │ │ sensor_readings   │ │  │ - CSV/Excel exports      │           │
│  │ │ (hypertable, 90d) │ │  │ - ML feature sets        │           │
│  │ ├───────────────────┤ │  └──────────────────────────┘           │
│  │ │ readings_hourly   │ │                                          │
│  │ │ (cont. agg, 1yr)  │ │  ┌──────────────────────────┐           │
│  │ ├───────────────────┤ │  │ Redis                     │           │
│  │ │ readings_daily    │ │  │ - Alert state cache       │           │
│  │ │ (cont. agg, ∞)   │ │  │ - Real-time dashboard     │           │
│  │ ├───────────────────┤ │  │ - Rate limiting           │           │
│  │ │ farms, zones,     │ │  └──────────────────────────┘           │
│  │ │ crop_stages, etc. │ │                                          │
│  │ └───────────────────┘ │                                          │
│  └───────────────────────┘                                          │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  PROCESSING / ANALYTICS LAYER                        │
│                                                                      │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────────────┐    │
│  │ TimescaleDB  │  │ Apache Airflow│  │ Analytics API (FastAPI)│    │
│  │ Continuous   │  │ DAGs:         │  │ - /query endpoints    │    │
│  │ Aggregates   │  │ - Hourly jobs │  │ - /export endpoints   │    │
│  │ (auto-rollup)│  │ - Anomaly det │  │ - /alerts endpoints   │    │
│  │              │  │ - Correlation │  │ - /ml/predict         │    │
│  └──────────────┘  │ - Retention   │  └───────────────────────┘    │
│                     └───────────────┘                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Alerting Engine                                               │   │
│  │ - Threshold evaluator (per-zone)                              │   │
│  │ - Anomaly detector (cross-farm, z-score based)                │   │
│  │ - Notification dispatcher → Webhook / SMS / Email / Push      │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Volume Estimates

| Metric | Value |
|--------|-------|
| Farms | 500 (target) |
| Zones per farm | 10 (avg) |
| Sensors per zone | 6 (temp, moisture, EC, N, P, K+pH+salinity) |
| Report frequency | Every 5 minutes |
| Data points per farm/day | 17,280 |
| Total data points/day | 8,640,000 |
| Raw row size | ~200 bytes |
| Daily storage (raw) | ~1.7 GB |
| 90-day raw storage | ~150 GB |

## Files

```
agritech-analytics/
├── README.md
├── schema/
│   ├── 001_init.sql              # TimescaleDB schema + hypertables
│   ├── 002_continuous_aggs.sql   # Continuous aggregation policies
│   └── 003_retention.sql         # Data retention policies
├── analytics/
│   ├── cross_farm_queries.sql    # All cross-farm analytics queries
│   ├── anomaly_detection.sql     # Anomaly detection queries
│   └── benchmarking.sql          # Farm benchmarking queries
├── pipeline/
│   ├── ingestion.py              # Kafka producer (MQTT → Kafka)
│   ├── consumer.py               # Kafka consumer (Kafka → TimescaleDB)
│   └── enrichment.py             # Data enrichment & crop stage detection
├── alerting/
│   ├── engine.py                 # Alert evaluation engine
│   ├── rules.py                  # Alert rule definitions
│   └── notifications.py          # Notification dispatchers
├── api/
│   ├── main.py                   # FastAPI application
│   ├── routes/
│   │   ├── query.py              # Analytics query endpoints
│   │   ├── export.py             # CSV/Excel export endpoints
│   │   └── alerts.py             # Alert management endpoints
│   └── models.py                 # Pydantic models
├── ml/
│   ├── features.py               # Feature engineering
│   └── yield_prediction.py       # Yield prediction model
├── docker-compose.yml            # Local dev stack
└── requirements.txt
```
