# System Architecture - SmartFarm DakLak

## High-Level Architecture

```
┌─────────────────┐     LoRa (AS923)     ┌──────────────────┐     Ethernet/WiFi     ┌─────────────────┐
│   SOIL SENSOR   │ ──── RS485/TTL ────▶ │   E90-DTU NODE   │ ────── LoRa ────────▶ │ E870-L915LG12   │
│   (Pending)     │                       │  (900SL22)       │                       │    GATEWAY      │
└─────────────────┘                       └──────────────────┘                       └────────┬────────┘
                                                                                              │
                                                                              ┌───────────────┼───────────────┐
                                                                              │               │               │
                                                                              ▼               ▼               ▼
                                                                       ┌──────────┐   ┌──────────┐   ┌──────────┐
                                                                       │ChirpStack│   │ Node-RED │   │ Database │
                                                                       │  Server  │   │  Flows   │   │(InfluxDB)│
                                                                       └─────┬────┘   └─────┬────┘   └─────┬────┘
                                                                             │              │              │
                                                                             └──────────────┼──────────────┘
                                                                                             │
                                                                                             ▼
                                                                                      ┌──────────┐
                                                                                      │Dashboard │
                                                                                      │(Grafana) │
                                                                                      └──────────┘
```

## Component Roles

### 1. Sensor Layer (Field)
- **Soil Moisture Sensor**: Measures soil moisture, temperature, and optionally EC (electrical conductivity)
- **Interface**: RS485 Modbus RTU or analog 4-20mA (pending datasheet)
- **Power**: Solar panel + battery or direct DC power
- **Deployment**: Buried at crop root depth, one per monitoring zone

### 2. Node Layer (E90-DTU 900SL22)
- **Role**: Bridge between sensor (serial) and gateway (LoRa)
- **Function**: Reads sensor data via RS485, packages it, transmits over LoRa
- **Protocol**: Transparent serial-to-LoRa bridge (point-to-point)
- **Not a LoRaWAN end device** — this is a LoRa DTU, not a LoRaWAN node
- **Power**: 12V DC (solar + battery recommended for field deployment)

### 3. Gateway Layer (E870-L915LG12)
- **Role**: Receives LoRa packets from nodes, forwards to network server
- **Function**: LoRa packet forwarder (semtech UDP protocol)
- **Connectivity**: Ethernet (WAN) to local server or cloud
- **Power**: DC 8–28V (12V adapter or PoE splitter)

### 4. Server Layer
- **ChirpStack**: LoRaWAN network server — handles device registration, OTAA/ABP join, downlink scheduling
- **Node-RED**: Data processing pipeline — parse payloads, apply transformations, trigger alerts
- **InfluxDB**: Time-series database for sensor data storage
- **Grafana**: Visualization dashboard for monitoring soil conditions

## Data Flow

```
1. Sensor reads soil data (moisture, temp)
2. Sensor sends data via RS485 Modbus RTU to E90-DTU
3. E90-DTU transmits data over LoRa (AS923, transparent mode)
4. E870-L915LG12 gateway receives LoRa packet
5. Gateway forwards packet via UDP to ChirpStack server
6. ChirpStack decodes payload, stores in database
7. Node-RED processes data, applies rules (irrigation alerts, etc.)
8. Grafana displays real-time dashboard
```

## Important Design Consideration: LoRa DTU vs LoRaWAN

The **E90-DTU(900SL22)** is a **LoRa transparent data radio**, NOT a LoRaWAN-compliant end device. This means:

- **Option A (Recommended)**: Run the gateway in **packet forwarder mode** and use a simple UDP listener/application server instead of full LoRaWAN stack. The DTU sends raw LoRa packets, gateway forwards them.
- **Option B**: Use ChirpStack in a simplified configuration that accepts raw LoRa payloads without full LoRaWAN MAC layer (requires custom application integration).
- **Option C**: Replace DTU with LoRaWAN-compliant end nodes in future for full LoRaWAN stack benefits (OTAA, adaptive data rate, confirmed uplinks, etc.)

**Recommendation for initial deployment**: Option A — use the gateway as a packet forwarder with a lightweight application server. This avoids LoRaWAN protocol complexity while the DTU operates in transparent mode.

## Network Topology

```
                    ┌──────────────┐
                    │   Server     │
                    │ (ChirpStack  │
                    │  + Node-RED) │
                    └──────┬───────┘
                           │ Ethernet
                    ┌──────┴───────┐
                    │   Gateway    │
                    │ E870-L915    │
                    │   LG12      │
                    └──────┬───────┘
                           │ LoRa (AS923)
              ┌────────────┼────────────┐
              │            │            │
        ┌─────┴─────┐ ┌───┴─────┐ ┌────┴─────┐
        │  Node #1  │ │ Node #2 │ │ Node #N  │
        │ E90-DTU   │ │ E90-DTU │ │ E90-DTU  │
        │ 900SL22   │ │ 900SL22 │ │ 900SL22  │
        └─────┬─────┘ └───┬─────┘ └────┬─────┘
              │           │            │
        ┌─────┴─────┐ ┌───┴─────┐ ┌────┴─────┐
        │  Sensor   │ │ Sensor  │ │  Sensor  │
        │ (Soil)    │ │ (Soil)  │ │ (Soil)   │
        └───────────┘ └─────────┘ └──────────┘
```

## Power Budget

| Component | Voltage | Current (TX) | Current (Idle) | Recommended Power |
|-----------|---------|-------------|----------------|-------------------|
| Gateway E870-L915LG12 | 12V DC | ~120 mA | ~80 mA | 12V/1A adapter |
| Node E90-DTU(900SL22) | 12V DC | ~45 mA | ~10 mA | 12V/0.5A or solar |
| Soil Sensor | TBD | TBD | TBD | Depends on sensor |

### Solar Power for Remote Nodes

For field deployment without grid power:
- **Battery**: 12V 7Ah lead-acid or 3.7V LiFePO4 with boost converter
- **Solar Panel**: 10W–20W (depends on transmission interval)
- **Charge Controller**: PWM or MPPT for 12V battery
- **Estimated autonomy**: 3–5 days without sun (with 10-min reporting interval)
