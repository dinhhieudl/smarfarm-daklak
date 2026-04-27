# Server Selection - ChirpStack vs Alternatives

## Recommendation: ChirpStack (Local Deployment)

**ChirpStack is the recommended LoRaWAN network server for SmartFarm DakLak.**

## Why ChirpStack?

| Criteria | ChirpStack | TTN (The Things Network) | AWS IoT Core | Helium |
|----------|-----------|-------------------------|--------------|--------|
| **Self-hosted** | ✅ Yes | ❌ Cloud only | ❌ Cloud only | ❌ Decentralized |
| **Cost** | Free (open source) | Free (limited) / Paid | Pay-per-use | Paid |
| **Data sovereignty** | ✅ Full control | ❌ Third-party servers | ❌ AWS servers | ❌ Third-party |
| **Internet required** | ❌ No (local only) | ✅ Yes | ✅ Yes | ✅ Yes |
| **Latency** | ✅ Very low (local) | ⚠️ Depends on internet | ⚠️ Depends on internet | ⚠️ Variable |
| **Vietnam compatible** | ✅ AS923 supported | ✅ AS923 supported | ✅ AS923 supported | ⚠️ Limited coverage |
| **Ease of setup** | ⚠️ Moderate | ✅ Easy | ⚠️ Complex | ✅ Easy |
| **Customization** | ✅ Full API | ⚠️ Limited | ✅ Full | ⚠️ Limited |

## Key Advantages for DakLak Deployment

### 1. Local-First Architecture
- DakLak has intermittent internet connectivity in rural areas
- ChirpStack runs entirely on local server — no internet needed for core operation
- Data is stored locally, accessible even during internet outages

### 2. Data Sovereignty
- All sensor data stays on your infrastructure
- No third-party data processing
- Compliant with Vietnamese data regulations

### 3. Cost
- 100% open source (MIT license)
- No per-device fees
- No per-message fees
- Only hardware cost (server)

### 4. Flexibility
- Full REST API for custom integrations
- MQTT integration for real-time data
- Supports OTAA and ABP activation
- Built-in device profiles and codec support

## ⚠️ Important Caveat: DTU vs LoRaWAN End Device

The **E90-DTU(900SL22)** is a **LoRa transparent data radio**, not a LoRaWAN-compliant end device. This affects how ChirpStack is used:

### Option A: Gateway as Packet Forwarder + Custom App Server (RECOMMENDED)
```
E90-DTU ──LoRa──▶ E870 Gateway ──UDP──▶ Custom App Server (Node-RED)
                                    (bypass ChirpStack LoRaWAN MAC)
```
- Gateway runs Semtech packet forwarder
- Raw LoRa packets forwarded via UDP to custom application
- Node-RED parses and processes data
- Simplest setup, works immediately with DTU

### Option B: ChirpStack with Custom Codec
```
E90-DTU ──LoRa──▶ E870 Gateway ──UDP──▶ ChirpStack ──MQTT──▶ Node-RED
```
- Register device in ChirpStack with custom device profile
- Write custom codec to decode DTU payload format
- More complex but provides device management UI

### Option C: Future Migration to LoRaWAN End Devices
```
LoRaWAN Sensor ──LoRaWAN──▶ E870 Gateway ──UDP──▶ ChirpStack (full LoRaWAN)
```
- Replace E90-DTU with LoRaWAN-compliant end nodes
- Full LoRaWAN stack: OTAA, ADR, confirmed uplinks
- Best long-term architecture

**Recommendation**: Start with **Option A** for immediate deployment. Plan migration to **Option C** when budget allows.

## ChirpStack Version

Use **ChirpStack v4** (latest stable):
- Single binary deployment
- Built-in PostgreSQL and Redis dependencies
- MQTT integration via embedded broker or external Mosquitto
- REST API and gRPC API
- Web UI for device management

## Server Hardware Requirements

### Minimum (for <50 nodes)
| Component | Specification |
|-----------|---------------|
| CPU | 2 cores (x86_64 or ARM64) |
| RAM | 2 GB |
| Storage | 20 GB SSD |
| OS | Ubuntu 22.04 LTS / Debian 12 |
| Network | 1x Ethernet (100 Mbps) |

### Recommended (for 50-200 nodes)
| Component | Specification |
|-----------|---------------|
| CPU | 4 cores |
| RAM | 4 GB |
| Storage | 50 GB SSD |
| OS | Ubuntu 22.04 LTS |
| Network | 1x Gigabit Ethernet |

### Deployment Options
1. **Mini PC** (Intel NUC, Beelink, etc.) — recommended for DakLak
2. **Raspberry Pi 4/5** (4GB+) — low power, sufficient for small deployments
3. **VPS** (cloud) — if internet is reliable (not recommended for rural DakLak)
4. **Existing server** — if available at the farm/office

## Software Stack

| Component | Purpose | Port |
|-----------|---------|------|
| ChirpStack v4 | LoRaWAN network server | 8080 (web), 1700 (UDP fwd) |
| PostgreSQL | ChirpStack database | 5432 |
| Redis | ChirpStack cache | 6379 |
| Mosquitto | MQTT broker | 1883 |
| Node-RED | Data processing & automation | 1880 |
| InfluxDB | Time-series data storage | 8086 |
| Grafana | Dashboard & visualization | 3000 |

## Alternative: E870-L915LG12-O (Built-in ChirpStack)

The **-O variant** of the gateway has ChirpStack and Node-RED **built-in**:
- No separate server needed
- Runs ChirpStack directly on the gateway
- Suitable for single-gateway, small deployments
- Limitation: resource-constrained (limited RAM/CPU on gateway)

**If you already own the standard E870-L915LG12 (non-O)**, you need a separate server.
