# SmartFarm Edge Sync Agent

Offline-first IoT data synchronization agent for Raspberry Pi. Pushes sensor data from local InfluxDB to cloud platform over unreliable 4G/WiFi connections.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Raspberry Pi                        │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ ChirpStack│  │ Mosquitto│  │   Node-RED       │  │
│  │ (LoRaWAN) │→ │  (MQTT)  │→ │  (Processing)    │  │
│  └──────────┘  └──────────┘  └────────┬─────────┘  │
│                                        │            │
│                              ┌─────────▼─────────┐  │
│                              │     InfluxDB       │  │
│                              │   (Local Store)    │  │
│                              └─────────┬─────────┘  │
│                                        │            │
│  ┌─────────────────────────────────────▼─────────┐  │
│  │           Edge Sync Agent                      │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │  │
│  │  │Collector │→│  Queue   │→│   Uploader   │  │  │
│  │  │(InfluxDB)│ │ (SQLite) │ │(HTTPS/MQTT)  │  │  │
│  │  └──────────┘ └──────────┘ └──────┬───────┘  │  │
│  │  ┌──────────┐ ┌──────────┐       │           │  │
│  │  │ Network  │ │  Health  │       │           │  │
│  │  │ Monitor  │ │ Checker  │       │           │  │
│  │  └──────────┘ └──────────┘       │           │  │
│  │  ┌──────────┐                    │           │  │
│  │  │   OTA    │                    │           │  │
│  │  │ Manager  │                    │           │  │
│  │  └──────────┘                    │           │  │
│  └──────────────────────────────────┼───────────┘  │
│                                     │              │
└─────────────────────────────────────┼──────────────┘
                                      │
                              ┌───────▼───────┐
                              │  Cloud API    │
                              │  (HTTPS/MQTT) │
                              └───────────────┘
```

## Features

- **Offline-first**: Queues data in SQLite when cloud is unreachable
- **Dual transport**: HTTPS (primary) or MQTT with automatic fallback
- **Compression**: gzip compression reduces bandwidth by ~80%
- **Exponential backoff**: With jitter to avoid thundering herd
- **OTA updates**: Remote firmware update with rollback
- **Health monitoring**: Reports device status, memory, CPU, disk, queue depth
- **Resource constrained**: < 50MB RAM, < 25% CPU on RPi
- **Graceful shutdown**: Flushes pending data before exit
- **Data retention**: Automatic cleanup of old synced data

## Quick Start

### 1. Install on Raspberry Pi

```bash
# Clone to RPi
scp -r edge-sync-agent/ pi@rpi:/opt/
ssh pi@rpi

# Install dependencies
cd /opt/edge-sync-agent
npm install

# Configure
cp .env.example .env
nano .env  # Fill in your cloud API key and device ID

# Build
npm run build

# Test run
npm start
```

### 2. Install as systemd Service

```bash
# Copy service file
sudo cp edge-sync-agent.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable edge-sync-agent
sudo systemctl start edge-sync-agent

# Check status
sudo systemctl status edge-sync-agent
journalctl -u edge-sync-agent -f
```

### 3. Docker Deployment

```bash
docker build -t edge-sync-agent .
docker run -d \
  --name edge-sync \
  --restart unless-stopped \
  -v /opt/edge-sync-agent/data:/app/data \
  -v /opt/edge-sync-agent/.env:/app/.env:ro \
  --memory=80m \
  --cpus=0.5 \
  edge-sync-agent
```

## Configuration

All configuration via environment variables (`.env`) or `config/default.json`:

| Variable | Default | Description |
|----------|---------|-------------|
| `INFLUXDB_URL` | `http://localhost:8086` | Local InfluxDB URL |
| `INFLUXDB_TOKEN` | — | InfluxDB auth token |
| `INFLUXDB_ORG` | `smartfarm` | InfluxDB organization |
| `INFLUXDB_BUCKET` | `sensors` | InfluxDB bucket name |
| `CLOUD_ENDPOINT` | `https://api.smartfarm.vn/v1/sync` | Cloud sync API |
| `CLOUD_MQTT_ENDPOINT` | `mqtts://mqtt.smartfarm.vn:8883` | Cloud MQTT broker |
| `CLOUD_API_KEY` | — | Device API key |
| `DEVICE_ID` | `rpi-edge-001` | Unique device identifier |
| `SYNC_INTERVAL_MS` | `300000` (5 min) | Sync frequency |
| `SYNC_BATCH_SIZE` | `100` | Max readings per upload |
| `SYNC_PROTOCOL` | `https` | Transport: `https` or `mqtt` |
| `LOG_LEVEL` | `info` | Logging level |

## Resource Usage

Target limits for Raspberry Pi (tested on RPi 4, 1GB RAM):

| Metric | Limit | Typical |
|--------|-------|---------|
| RAM | 50 MB | 25-35 MB |
| CPU | 25% | < 5% |
| Disk | 100 MB | 10-50 MB |
| Network | < 1 MB/min | ~200 KB/min |

## How It Works

### Sync Cycle (every 5 minutes)

1. **Network check** — DNS lookup to verify connectivity
2. **Collect** — Query InfluxDB for new readings since last sync
3. **Queue** — Persist readings to local SQLite database
4. **Upload** — Send batched, compressed data to cloud
5. **Confirm** — Mark successful items; retry failed ones with backoff

### Offline Behavior

When cloud is unreachable:
- Data continues collecting from InfluxDB into SQLite queue
- No data loss — everything persisted locally
- Automatic retry with exponential backoff (1s → 5min)
- Queue depth monitoring alerts at 10,000+ items
- Old synced data auto-cleaned after 30 days

### OTA Update Flow

1. Agent periodically checks cloud for updates
2. Downloads new version with SHA256 verification
3. Backs up current installation
4. Applies update and installs dependencies
5. Restarts via systemd (automatic)
6. Rolls back on failure

## Monitoring

### Health Endpoint

Agent reports to cloud every 60 seconds:

```json
{
  "deviceId": "rpi-edge-001",
  "uptime": 86400,
  "memory": { "processRssMb": 32 },
  "cpu": { "usagePercent": 3 },
  "queue": { "pending": 42, "failed": 0 },
  "network": { "online": true, "ip": "192.168.1.100" }
}
```

### Logs

```bash
# Real-time logs
journalctl -u edge-sync-agent -f

# Log file
tail -f /opt/edge-sync-agent/data/logs/edge-sync.log
```

### Grafana Dashboard

Import the included dashboard to monitor:
- Sync throughput (readings/min)
- Queue depth over time
- Upload success rate
- Network connectivity
- Memory/CPU usage
