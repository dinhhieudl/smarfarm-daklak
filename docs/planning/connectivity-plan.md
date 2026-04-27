# Connectivity Plan - Gateway ↔ Node ↔ Sensor

## Physical Wiring Diagrams

### Node (E90-DTU 900SL22) ↔ Sensor Connection

```
┌──────────────────────┐                    ┌──────────────────────┐
│     E90-DTU          │                    │   Soil Sensor        │
│     (900SL22)        │                    │   (RS485 Modbus)     │
│                      │                    │                      │
│  ┌────────────────┐  │    RS485 (A/B)     │  ┌────────────────┐  │
│  │ 3.81mm Terminal│──┼─── A ────────────▶│──│ Terminal A     │  │
│  │ Block          │──┼─── B ────────────▶│──│ Terminal B     │  │
│  └────────────────┘  │                    │  └────────────────┘  │
│                      │                    │                      │
│  ┌────────────────┐  │    Power (12V)     │  ┌────────────────┐  │
│  │ DC Jack /      │──┼─── +12V ─────────▶│──│ VCC (+)        │  │
│  │ Terminal Block │──┼─── GND ──────────▶│──│ GND (-)        │  │
│  └────────────────┘  │                    │  └────────────────┘  │
│                      │                    │                      │
│  ┌────────────────┐  │                    │                      │
│  │ DIP Switches   │  │  Set to:          │                      │
│  │ (Mode Select)  │  │  Transparent mode │                      │
│  └────────────────┘  │                    │                      │
└──────────────────────┘                    └──────────────────────┘
```

### Gateway (E870-L915LG12) Wiring

```
┌─────────────────────────────────────────────────────────┐
│                    E870-L915LG12 Gateway                 │
│                                                          │
│  Power:  DC 8-28V (barrel jack or terminal block)        │
│          Use 12V/1A adapter                              │
│                                                          │
│  Network: WAN port ──── Ethernet cable ──── Router/Switch│
│                                                          │
│  Antennas:                                               │
│    LoRa   ──── SMA connector ──── 915MHz antenna         │
│    WiFi-M ──── SMA connector ──── 2.4GHz antenna         │
│    WiFi-D ──── SMA connector ──── 2.4GHz antenna (opt.)  │
│                                                          │
│  Debug:  USB port ──── USB cable ──── PC                 │
│                                                          │
│  Reset:  Hold Restore button >5s for factory reset       │
└─────────────────────────────────────────────────────────┘
```

## Wiring Details

### RS485 Connection (Node ↔ Sensor)

RS485 uses a differential pair (A and B). Use **twisted pair cable** (Cat5 or shielded twisted pair recommended).

| DTU Terminal | Wire | Sensor Terminal | Notes |
|-------------|------|-----------------|-------|
| A (+) | Twisted pair + | A (+) or Data+ | Match polarity |
| B (-) | Twisted pair - | B (-) or Data- | Match polarity |
| GND | Ground wire | GND | Common ground reference |

**Cable length**: Up to 1200m for RS485 at low baud rates. For agricultural fields, keep under 500m for reliability.

### Power Connections

**For Grid-Powered Installation:**
- Gateway: 12V/1A DC adapter → barrel jack
- Node: 12V/0.5A DC adapter → barrel jack or terminal block
- Sensor: Powered from node's RS485 bus (if supported) or separate 12V supply

**For Solar-Powered Remote Nodes:**
```
┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────┐
│  Solar   │───▶│   Charge     │───▶│ Battery  │───▶│ E90-DTU  │
│  Panel   │    │  Controller  │    │ 12V 7Ah  │    │ 900SL22  │
│  10-20W  │    │  (PWM/MPPT)  │    │          │    │          │
└──────────┘    └──────────────┘    └──────────┘    └──────────┘
                                                         │
                                                    RS485│
                                                         ▼
                                                    ┌──────────┐
                                                    │  Sensor  │
                                                    └──────────┘
```

## Configuration Parameters

### E90-DTU(900SL22) Settings (via EByte RF Tool)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Frequency | 923.2 MHz | AS923 channel 0 (MUST CHANGE from default 868.125) |
| Channel | Match gateway | Both must be on same channel |
| Air Rate | 2.4 kbps | Default, good balance of range/reliability |
| TX Power | 22 dBm | Maximum for this module |
| Packet Length | 128 bytes | Suitable for sensor data |
| Baud Rate | 9600 | Match sensor Modbus baud rate |
| Data Bits | 8 | Standard |
| Parity | None | Standard |
| Stop Bits | 1 | Standard |
| Mode | Transparent | Pass-through serial data |
| Address | 0x0001 | Unique per node (0x0001, 0x0002, ...) |

### E870-L915LG12 Gateway Settings

| Parameter | Value | Notes |
|-----------|-------|-------|
| Region | AS923 | Vietnam frequency plan |
| Mode | Packet Forwarder | Forward to application server |
| Server Address | Local IP of ChirpStack server | e.g., 192.168.1.100 |
| Server Port | 1700 | Standard Semtech UDP forwarder port |
| WiFi | Configure SSID/password | For management access |
| Ethernet | DHCP or static IP | Connect to local network |

## Multi-Node Topology

For multiple field sensors, use **address-based multiplexing**:

```
Gateway (1) ◀── LoRa ──▶ Node(0x0001) ── RS485 ──▶ Sensor Zone A
                       ──▶ Node(0x0002) ── RS485 ──▶ Sensor Zone B
                       ──▶ Node(0x0003) ── RS485 ──▶ Sensor Zone C
                       ──▶ ...
```

Each node has a unique address. The application server identifies nodes by their LoRa address field in the received packet.

## Antenna Placement

### Gateway Antenna
- **Height**: Mount LoRa antenna as high as possible (minimum 3m above ground)
- **Orientation**: Vertical polarization (standard for LoRa)
- **Clearance**: Avoid metal structures within 1m of antenna
- **Outdoor**: Use outdoor-rated antenna with weatherproof connector

### Node Antenna
- **Position**: Near the sensor, but elevated if possible
- **Cable**: Keep antenna cable short (<2m) to minimize signal loss
- **Grounding**: Ensure proper grounding for outdoor installations

## Pre-Deployment Checklist

- [ ] Reconfigure E90-DTU frequency from 868.125 MHz to AS923 (923.2 MHz)
- [ ] Match air rate between gateway and all nodes
- [ ] Set unique address for each node
- [ ] Verify RS485 wiring polarity (A↔A, B↔B)
- [ ] Configure sensor Modbus address and register map
- [ ] Test communication range at deployment site
- [ ] Verify gateway network connectivity to server
- [ ] Test end-to-end data flow: sensor → node → gateway → server
