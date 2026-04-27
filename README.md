# SmartFarm DakLak - Knowledge Base

LoRaWAN-based precision agriculture system for DakLak, Vietnam.

## Hardware Inventory

| Component | Model | Role | Status |
|-----------|-------|------|--------|
| Gateway | E870-L915LG12 | LoRaWAN concentrator | ✅ Documented |
| Node (DTU) | E90-DTU(900SL22) | LoRa data radio (sensor bridge) | ✅ Documented |
| Sensor | Soil Moisture Sensor | Field data采集 | ⏳ Pending datasheet |

## Quick Links

- [Hardware Datasheets](docs/hardware/)
- [System Architecture & Planning](docs/planning/)
- [Setup Guides](docs/setup/)

## Project Status

- [x] Hardware documentation collected & translated
- [x] Frequency plan confirmed (AS923 for Vietnam)
- [ ] Sensor datasheet integration
- [ ] Gateway firmware & ChirpStack setup
- [ ] Node configuration & sensor integration
- [ ] Dashboard / data pipeline

## Repository Structure

```
smarfarm-daklak/
├── README.md
├── docs/
│   ├── hardware/
│   │   ├── E870-L915LG12-gateway.md      # Gateway datasheet (EN)
│   │   ├── E90-DTU-900SL22-node.md       # LoRa DTU datasheet (EN)
│   │   └── frequency-plan.md             # Frequency & region config
│   ├── planning/
│   │   ├── system-architecture.md         # Overall architecture
│   │   ├── connectivity-plan.md           # Gateway ↔ Node ↔ Sensor wiring
│   │   └── server-selection.md            # ChirpStack vs alternatives
│   └── setup/
│       └── chirpstack-setup.md            # Step-by-step ChirpStack install
```
