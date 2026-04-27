# E90-DTU(900SL22) - LoRa Data Transfer Unit

> Source: https://www.ebyte.com/product/513.html
> Translated from Chinese to English

## Overview

The E90-DTU(900SL22) is an **industrial-grade LoRa data radio** (DTU = Data Transfer Unit) using military-grade LoRa spread-spectrum modulation. It provides transparent RS232/RS485 serial-to-LoRa bridging, designed for long-range, interference-resistant data transmission.

The product enclosure is coated with **conformal coating** providing anti-mold, anti-humidity, and anti-salt-fog protection.

## Key Specifications

### RF Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| **Operating Frequency** | 850.125 ~ 930.125 MHz | Default: 868.125 MHz |
| **TX Power** | 22 dBm | ~160 mW |
| **Air Data Rate** | 0.3k ~ 62.5 kbps | Factory default: 2.4 kbps |
| **Reference Range** | ~5 km | Open field, line of sight |

### Hardware Parameters

| Parameter | Value |
|-----------|-------|
| **Dimensions** | 82 × 62 × 25 mm (excluding SMA) |
| **Antenna** | SMA-K connector (female thread, male pin) |
| **Communication Interface** | RS232 (DB9 female) / RS485 (3.81mm terminal block) |
| **Channels** | 81, half-duplex |
| **Buffer Size** | 1000 bytes (configurable packet split: 32/64/128/240 bytes) |

### Electrical Parameters

| Parameter | Min | Typical | Max | Unit | Condition |
|-----------|-----|---------|-----|------|-----------|
| Supply Voltage | 8 | 12 | 28 | V | Recommended: 12V or 24V |
| TX Current | — | 45 | — | mA | @ 22 dBm (160 mW) |
| Standby Current | — | 10 | — | mA | — |
| Operating Temp | -40 | 20 | +85 | °C | — |
| Operating Humidity | 10 | 60 | 90 | % | — |
| Storage Temp | -40 | 20 | +125 | °C | — |

## Pin/Interface Definitions

| # | Name | Description |
|---|------|-------------|
| 1 | DB-9 Female | RS-232 interface (standard RS-232) |
| 2 | 3.81mm Terminal Block | RS-485 interface + power input (screw terminal) |
| 3 | PWR LED | Red, illuminated when power is connected |
| 4 | TXD LED | Yellow, blinks when transmitting data |
| 5 | RXD LED | Yellow, blinks when receiving data |
| 6 | DC Power Jack | Barrel jack, outer Ø5.5mm, inner Ø2.5mm |
| 7 | DIP Switch | Operating mode control switches |
| 8 | Antenna | SMA-K (female thread, male pin), 50Ω impedance |

## Operating Modes

The DIP switches on the module control the operating mode. Key modes include:

- **Transparent Transmission**: Data sent via serial is transparently relayed over LoRa and vice versa.
- **Fixed-point Transmission**: Address-based point-to-point or point-to-multipoint communication.
- **Broadcast Mode**: All modules on the same channel receive the data.

## Configuration

- **Channel Setting**: 81 channels available within the frequency range
- **Address Setting**: Network address can be configured for grouping
- **Packet Length**: Configurable split at 32/64/128/240 bytes
- **Air Rate / Spreading Factor**: Configurable via EByte's configuration tool (spreading factor is auto-set based on air rate selection)
- **Data Encryption**: Supported

## Common Issues (FAQ)

1. **No AUX pin** — Cannot programmatically determine TX completion; observe TX LED.
2. **Latency** — ~100ms from serial input to RF output; varies with air rate and data length.
3. **SF Configuration** — Spreading factor is automatically set based on selected air rate; cannot be manually overridden.
4. **RS232 ↔ RS485** — Ensure matching parameters (baud rate, parity) on both ends before testing.
5. **Buffer Limit** — 512-byte buffer; do not exceed. Aging test confirmed 2-day continuous operation.
6. **No Mesh** — Does NOT support mesh networking. Use polling-based point-to-point for multi-node setups.

## Series Variants (900 MHz Band)

| Model | TX Power | Range | Chip | Notes |
|-------|----------|-------|------|-------|
| E90-DTU(900SL22) | 22 dBm | 5 km | SX1262 | **This model** |
| E90-DTU(900SL30) | 30 dBm | 10 km | SX1262 | Higher power variant |
| E90-DTU(900L20)-V8 | 20 dBm | 5 km | — | Newer version |
| E90-DTU(900L30)-V8 | 30 dBm | 8 km | — | Newer version |
| E90-DTU(900SL33) | 33 dBm | 16 km | — | High power, data encryption |
| E90-DTU(900SL42) | 42 dBm | 30 km | — | Very high power |

## PDF Datasheet

Download: https://www.ebyte.com/downpdf/513.html

## Purchase

https://detail.tmall.com/item.htm?id=597799343037
