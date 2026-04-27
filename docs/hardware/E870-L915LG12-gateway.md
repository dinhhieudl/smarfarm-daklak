# E870-L915LG12 - LoRaWAN Gateway Module

> Source: https://www.ebyte.com/product/1845.html
> Translated from Chinese to English

## Overview

The E870-L915LG12 is a **half-duplex LoRaWAN standard protocol gateway** module based on the **Semtech SX1302** concentrator chip. It supports multiple regional frequency plans and is designed for industrial IoT applications.

The product enclosure is coated with **conformal coating** providing anti-mold, anti-humidity, and anti-salt-fog protection — suitable for harsh agricultural environments.

## Key Specifications

| Parameter | Value |
|-----------|-------|
| **Chipset** | Semtech SX1302 |
| **Operating Voltage** | DC 8V ~ 28V |
| **Current Consumption** | 120mA @ 12V (room temperature) |
| **TX Power** | 27 dBm |
| **Communication Range** | ~3 km (line of sight) |
| **Duplex Mode** | Half-duplex |
| **Operating Temperature** | -40°C to +85°C |
| **Storage Temperature** | -40°C to +85°C |
| **Operating Humidity** | 5% ~ 95% |
| **Storage Humidity** | 1% ~ 95% |
| **Dimensions** | 110 × 105 × 41 mm |
| **Weight** | 417 ± 5 g |

## Supported Frequency Plans

| Region File | Frequency Band |
|-------------|---------------|
| US915 | 902–928 MHz |
| AU915 | 915–928 MHz |
| AS923 | 920–925 MHz |
| KR920 | 920–923 MHz |

## Pin Definitions

| Pin # | Name | Description |
|-------|------|-------------|
| 1 | DC | Power supply DC 8–28V, standard 5.5×2.1mm barrel jack |
| 2 | DC-IN+ | Power supply DC 8–28V, terminal block positive |
| 3 | DC-IN- | Power supply DC 8–28V, terminal block negative |
| 4 | (Reserved) | Not connected |
| 5 | USB | USB debug interface |
| 6 | Restore | Press and hold >5 seconds to factory reset |
| 7 | WAN/LAN | WAN port, Ethernet 10/100Mbps, Auto MDI/MDIX |
| 8 | WIFI-M Antenna | WiFi antenna SMA connector |
| 9 | WIFI-D Antenna | WiFi antenna SMA connector |
| 10 | LoRa Antenna | LoRa antenna SMA connector |

## Interfaces

- **Ethernet**: 10/100 Mbps WAN port with Auto MDI/MDIX
- **USB**: Debug interface
- **WiFi**: Dual SMA antenna connectors (2.4 GHz)
- **LoRa**: Single SMA antenna connector
- **Power**: DC barrel jack (5.5×2.1mm) or terminal block (8–28V)
- **Reset**: Physical button (hold >5s for factory reset)

## Series Variants

| Model | Freq. Band | TX Power | Range | Notes |
|-------|-----------|----------|-------|-------|
| E870-L915LG12 | US915/AU915/AS923/KR920 | 27 dBm | 3 km | **This model** |
| E870-L470LG12 | CN470 (470–510 MHz) | 27 dBm | 3 km | China band |
| E870-L868LG12 | EU868/IN865/RU864 | 27 dBm | 3 km | Europe band |
| E870-L915LG12-O | US915/AU915/AS923/KR920 | 27 dBm | 3 km | **Open-source variant with built-in ChirpStack + Node-RED** |

## Important Notes

1. **The "-O" variant (E870-L915LG12-O)** has built-in ChirpStack server and Node-RED — may be preferable for standalone deployment.
2. The standard variant (this model) acts as a pure packet forwarder and requires an external LoRaWAN network server (e.g., ChirpStack, TTN).
3. For outdoor deployment, ensure proper enclosure with IP65+ rating despite the conformal coating.

## PDF Datasheet

Download: https://www.ebyte.com/downpdf/1845.html

## Purchase

https://detail.tmall.com/item.htm?id=667696115203
