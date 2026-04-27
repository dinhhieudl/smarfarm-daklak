# SmartFarm DakLak - Server Setup Guide (Windows)

## Prerequisites

### 1. Install Docker Desktop
- Download: https://www.docker.com/products/docker-desktop/
- Install and enable **WSL2 backend** (recommended)
- Restart PC after installation
- Open Docker Desktop and wait for it to start (green icon in system tray)

### 2. Check Ports
Make sure these ports are **not used** by other applications:

| Port | Service | Check command |
|------|---------|---------------|
| 8080 | ChirpStack | `netstat -an \| findstr :8080` |
| 1880 | Node-RED | `netstat -an \| findstr :1880` |
| 3000 | Grafana | `netstat -an \| findstr :3000` |
| 8086 | InfluxDB | `netstat -an \| findstr :8086` |
| 1700 | LoRa forwarder | `netstat -an \| findstr :1700` |
| 1883 | MQTT | `netstat -an \| findstr :1883` |

### 3. Firewall
Allow Docker through Windows Firewall, or temporarily disable it for testing.

---

## Quick Start

### Step 1: Open terminal in server folder

```powershell
cd path\to\smarfarm-daklak\server
```

### Step 2: Start all services

```powershell
docker compose up -d
```

Or double-click `start.bat`.

### Step 3: Wait ~30 seconds for all services to initialize

Check status:
```powershell
docker compose ps
```

All containers should show "running":
```
sf-postgres     running
sf-redis        running
sf-mosquitto    running
sf-chirpstack   running
sf-nodered      running
sf-influxdb     running
sf-grafana      running
```

### Step 4: Access services

| Service | URL | Credentials |
|---------|-----|-------------|
| **ChirpStack** | http://localhost:8080 | admin / admin |
| **Node-RED** | http://localhost:1880 | (none) |
| **Grafana** | http://localhost:3000 | admin / admin |
| **InfluxDB** | http://localhost:8086 | admin / admin12345 |

---

## Configuration Guide

### Step 5: Configure ChirpStack

1. Open http://localhost:8080
2. Login: `admin` / `admin`
3. **Change password** immediately!

#### Add Gateway
1. Go to **Gateways** → **+ Add Gateway**
2. Fill in:
   - **Gateway ID**: Your E870-L915LG12's MAC address (printed on label)
   - **Name**: `DakLak-GW-01`
   - **Description**: Main gateway
   - **Region**: AS923
3. Save

#### Add Device Profile (for sensor)
1. Go to **Device Profiles** → **+ Add Device Profile**
2. Fill in:
   - **Name**: `Soil-Sensor-Standard`
   - **Region**: AS923
   - **MAC Version**: LoRaWAN 1.0.3
   - **Reg. Params Revision**: A
   - **Max EIRP**: 16
3. Save

### Step 6: Configure E870 Gateway

Connect to the gateway via SSH (USB debug or network):

```bash
# Find gateway IP (check router DHCP table, or use EByte's tool)
# Default: may be 192.168.1.100 or similar

# Edit packet forwarder config
nano /etc/lora/global_conf.json
```

Set:
```json
{
  "gateway_conf": {
    "server_address": "YOUR_LAPTOP_IP",
    "serv_port_up": 1700,
    "serv_port_down": 1700
  }
}
```

**Find your laptop's IP:**
```powershell
ipconfig | findstr "IPv4"
```

Example: `192.168.1.50`

Restart gateway packet forwarder.

### Step 7: Import Node-RED Flow

1. Open http://localhost:1880
2. Click **☰ menu** → **Import**
3. Select `server/config/node-red-flows.json`
4. Click **Import** then **Deploy**
5. The MQTT connection should auto-connect to `mosquitto:1883`

### Step 8: Verify Data Flow

1. Power on E90-DTU with soil sensor
2. In ChirpStack, check **Gateways** → your gateway should show "connected"
3. In Node-RED, check the debug sidebar for incoming data
4. In Grafana, the dashboard should show sensor readings

---

## Architecture

```
[E90-DTU + Sensor]                [E870 Gateway]              [Your Laptop]
  RS485 Modbus       LoRa (AS923)    Packet Fwd     UDP:1700
  ──────────▶   ──────────────▶   ────────────▶   ────────▶
                                                              ┌──────────────┐
                                                              │  ChirpStack  │ :8080
                                                              │  (decode)    │
                                                              └──────┬───────┘
                                                                     │ MQTT
                                                              ┌──────┴───────┐
                                                              │   Mosquitto  │ :1883
                                                              └──────┬───────┘
                                                                     │
                                                              ┌──────┴───────┐
                                                              │   Node-RED   │ :1880
                                                              │  (process)   │
                                                              └──────┬───────┘
                                                                     │
                                                              ┌──────┴───────┐
                                                              │   InfluxDB   │ :8086
                                                              │  (store)     │
                                                              └──────┬───────┘
                                                                     │
                                                              ┌──────┴───────┐
                                                              │   Grafana    │ :3000
                                                              │  (dashboard) │
                                                              └──────────────┘
```

---

## Stopping & Restarting

```powershell
# Stop all
docker compose down

# Stop and delete all data (CAUTION!)
docker compose down -v

# Restart
docker compose restart

# View logs
docker compose logs -f chirpstack
docker compose logs -f nodered
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "port is already allocated" | Stop the conflicting service, or edit `docker-compose.yml` to change port |
| Gateway not connecting | Check firewall allows UDP 1700; verify gateway IP config |
| No data in Node-RED | Check MQTT topic in Node-RED matches ChirpStack MQTT config |
| Docker Desktop won't start | Enable virtualization in BIOS; install WSL2 |
| Containers crash | Check logs: `docker compose logs <service>` |
| Can't access from phone | Use laptop's IP instead of localhost: `http://192.168.x.x:3000` |

---

## Access from Other Devices

To access the dashboard from phone/tablet on same WiFi network:

1. Find laptop IP: `ipconfig` → IPv4 Address (e.g., `192.168.1.50`)
2. Open `http://192.168.1.50:3000` on phone → Grafana dashboard
3. Open `http://192.168.1.50:8080` on phone → ChirpStack

**Note**: Windows Firewall may block. Add exception:
```powershell
# Run as Administrator
netsh advfirewall firewall add rule name="SmartFarm Docker" dir=in action=allow protocol=TCP localport=8080,1880,3000,8086,1883
```
