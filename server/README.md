# Server Stack

Docker Compose stack cho SmartFarm DakLak.

## Services

| Service | Image | Port | Mô tả |
|---------|-------|------|--------|
| PostgreSQL | postgres:16-alpine | 5432 | ChirpStack database |
| Redis | redis:7-alpine | 6379 | ChirpStack cache |
| Mosquitto | eclipse-mosquitto:2 | 1883, 9001 | MQTT broker |
| ChirpStack | chirpstack/chirpstack:4 | 8080, 1700/udp | LoRaWAN server |
| Node-RED | nodered/node-red:latest | 1880 | Data processing |
| InfluxDB | influxdb:2.7 | 8086 | Time-series storage |
| Grafana | grafana/grafana:latest | 3005 | Dashboard |
| Smart Control | (build from ../smart-control) | 3002 | Control & advisory |

## Quick Start

```bash
# 1. Copy environment config
cp ../.env.example ../.env
# Edit ../.env with your values

# 2. Start all services
docker compose up -d

# 3. Check status
docker compose ps

# 4. View logs
docker compose logs -f

# 5. Stop all services
docker compose down
```

## Windows

```cmd
setup.bat    :: First-time setup
start.bat    :: Start all services
stop.bat     :: Stop all services
reset.bat    :: Reset all data (destructive!)
```

## Default Credentials

| Service | User | Password |
|---------|------|----------|
| ChirpStack | admin | admin |
| Grafana | admin | admin |
| InfluxDB | admin | admin12345 |
| PostgreSQL | chirpstack | chirpstack |

⚠️ **Change these in production!** See `../.env.example`.

## Data Pipeline

```
Simulator/Device → MQTT → ChirpStack → Node-RED → InfluxDB → Grafana
                                              ↓
                                        Smart Control → Actuators
```

## Troubleshooting

```bash
# Check service health
docker compose ps

# Restart specific service
docker compose restart chirpstack

# View logs
docker compose logs -f nodered

# Reset everything
docker compose down -v
docker compose up -d
```
