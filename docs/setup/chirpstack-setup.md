# ChirpStack Setup Guide - SmartFarm DakLak

## Prerequisites

- Ubuntu 22.04 LTS server (or Debian 12)
- Root or sudo access
- E870-L915LG12 gateway connected to the same network
- Internet access for initial package installation

## Step 1: Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install PostgreSQL
sudo apt install -y postgresql

# Install Redis
sudo apt install -y redis-server

# Install Mosquitto MQTT broker
sudo apt install -y mosquitto mosquitto-clients

# Install Docker (optional, for containerized deployment)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

## Step 2: Install ChirpStack v4

### Option A: Docker Compose (Recommended)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  chirpstack:
    image: chirpstack/chirpstack:4
    container_name: chirpstack
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "1700:1700/udp"
    volumes:
      - ./chirpstack:/etc/chirpstack
      - chirpstack-data:/data
    depends_on:
      - postgres
      - redis
      - mosquitto

  postgres:
    image: postgres:15
    container_name: chirpstack-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: chirpstack
      POSTGRES_PASSWORD: chirpstack
      POSTGRES_DB: chirpstack
    volumes:
      - postgres-data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: chirpstack-redis
    restart: unless-stopped
    volumes:
      - redis-data:/data

  mosquitto:
    image: eclipse-mosquitto:2
    container_name: chirpstack-mosquitto
    restart: unless-stopped
    ports:
      - "1883:1883"
    volumes:
      - ./mosquitto:/mosquitto/config

volumes:
  chirpstack-data:
  postgres-data:
  redis-data:
```

Create ChirpStack config `chirpstack/chirpstack.toml`:

```toml
[logging]
  level = 4

[postgresql]
  dsn = "postgres://chirpstack:chirpstack@postgres/chirpstack?sslmode=disable"

[redis]
  servers = ["redis:6379"]

[integration]
  enabled = ["mqtt"]

  [integration.mqtt]
    server = "tcp://mosquitto:1883"
    json = true

[region_server]
  enabled = true

  [[region_server.configuration]]
    region = "AS923"
    enabled = true
```

Start services:
```bash
docker compose up -d
```

### Option B: Native Installation

```bash
# Download ChirpStack v4
wget https://artifacts.chirpstack.io/downloads/chirpstack/debian/chirpstack_4.x.x_linux_amd64.deb
sudo dpkg -i chirpstack_4.x.x_linux_amd64.deb

# Configure
sudo nano /etc/chirpstack/chirpstack.toml

# Start service
sudo systemctl enable chirpstack
sudo systemctl start chirpstack
```

## Step 3: Access ChirpStack Web UI

1. Open browser: `http://<server-ip>:8080`
2. Default login:
   - Username: `admin`
   - Password: `admin`
3. **Change the default password immediately**

## Step 4: Configure Gateway in ChirpStack

1. Navigate to **Gateways** → **Add Gateway**
2. Fill in:
   - **Gateway ID**: Found on the E870-L915LG12 label (MAC address or serial)
   - **Name**: e.g., "DakLak-GW-01"
   - **Description**: SmartFarm DakLak main gateway
   - **Region**: AS923
3. Save

## Step 5: Configure Packet Forwarder on Gateway

SSH into the E870-L915LG12 gateway (via USB debug or network):

```bash
# Edit packet forwarder configuration
sudo nano /etc/lora/packet_forwarder/global_conf.json
```

Set these parameters:
```json
{
  "gateway_conf": {
    "server_address": "<YOUR_SERVER_IP>",
    "serv_port_up": 1700,
    "serv_port_down": 1700,
    "ref_latitude": 12.6667,
    "ref_longitude": 108.0500,
    "ref_altitude": 500
  }
}
```

Coordinates for DakLak: approximately 12.67°N, 108.05°E (Buon Ma Thuot).

Restart packet forwarder:
```bash
sudo systemctl restart lora-packet-forwarder
```

## Step 6: Install Node-RED

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Node-RED
sudo npm install -g node-red

# Run as service
sudo useradd -r -s /bin/false nodered
sudo nano /etc/systemd/system/nodered.service
```

```ini
[Unit]
Description=Node-RED
After=network.target

[Service]
Type=simple
User=nodered
ExecStart=/usr/bin/node-red --max-old-space-size=512
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable nodered
sudo systemctl start nodered
```

Access Node-RED: `http://<server-ip>:1880`

## Step 7: Install InfluxDB + Grafana

```bash
# InfluxDB
wget https://dl.influxdata.com/influxdb/releases/influxdb2-2.7.x-amd64.deb
sudo dpkg -i influxdb2-2.7.x-amd64.deb
sudo systemctl enable influxdb
sudo systemctl start influxdb

# Grafana
sudo apt install -y apt-transport-https software-properties-common
wget -q -O - https://apt.grafana.com/gpg.key | sudo apt-key add -
echo "deb https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
sudo apt update
sudo apt install -y grafana
sudo systemctl enable grafana-server
sudo systemctl start grafana-server
```

Access:
- InfluxDB: `http://<server-ip>:8086`
- Grafana: `http://<server-ip>:3000` (default: admin/admin)

## Step 8: Create Node-RED Flow for DTU Data

In Node-RED, create a flow to:
1. Subscribe to MQTT topic `gateway/+/rx` (or custom UDP listener)
2. Decode the DTU payload (hex to sensor values)
3. Write to InfluxDB
4. Send alerts if soil moisture is below threshold

Example Node-RED flow:
```
[MQTT In] → [Function: Decode] → [InfluxDB Out]
                         ↓
                  [Dashboard Gauge]
```

## Step 9: Verify End-to-End

1. Power on E90-DTU node with sensor connected
2. Check gateway status in ChirpStack UI (should show "connected")
3. Check MQTT for incoming data: `mosquitto_sub -t "gateway/#" -v`
4. Check InfluxDB for stored data
5. Check Grafana dashboard for visualization

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Gateway not connecting | Check firewall allows UDP port 1700 |
| No data in ChirpStack | Verify gateway packet forwarder config points to correct server IP |
| DTU data not decoded | Check frequency match (must be AS923), verify air rate settings |
| MQTT no messages | Verify Mosquitto is running: `systemctl status mosquitto` |
| Node-RED can't connect | Check MQTT broker address in Node-RED config |
