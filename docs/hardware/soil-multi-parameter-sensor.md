# Soil Multi-Parameter Sensor - Datasheet (EN)

> Source: Chinese manual v2.1, translated to English
> Product: Soil Temperature / Moisture / EC / NPK / pH Sensor

## Overview

A multi-parameter soil sensor that measures **temperature, moisture (humidity), electrical conductivity (EC), nitrogen (N), phosphorus (P), potassium (K), salinity, and pH**. Designed for precision agriculture, environmental monitoring, and smart irrigation systems.

## Measurement Principles

| Parameter | Principle |
|-----------|-----------|
| **Temperature** | NTC thermistor with 12-bit ADC |
| **Moisture** | FDR (Frequency Domain Reflectometry) — measures soil dielectric constant for accurate volumetric water content |
| **EC (Electrical Conductivity)** | Complementary PWM excitation with bridge circuit, temperature-compensated to 25°C |
| **pH** | Zinc-aluminum galvanic cell — soil acid/alkali generates voltage on electrodes |
| **NPK** | Derived from EC and other sensor readings (see register map) |
| **Salinity** | Derived from temperature-compensated EC |

## Key Features

1. Compact design, high precision, good consistency, multi-level peripheral management for low power
2. Fully sealed — can be directly buried in soil, corrosion resistant
3. Real-time monitoring at different soil depths
4. Minimal soil-type influence, wide regional applicability
5. High resolution, complementary PWM excitation cancels temperature and common-mode interference
6. Ultra-low power variant: as low as **70µA** static current
7. Wide supply range: **3.3V ~ 24V DC**
8. Temperature probe inside hollow steel needle (1mm bore, 50% thicker wall than competitors), more sensitive and durable

## Physical Specifications

| Parameter | Value |
|-----------|-------|
| **Probe Length** | 60mm, Ø3mm |
| **Probe Material** | 316L Stainless Steel |
| **Seal Material** | ABS engineering plastic + epoxy resin |
| **Waterproof Rating** | IP68 |
| **Cable** | 2m standard (customizable up to 1200m) |
| **Dimensions** | 140 × 45 × 15 mm |

## Electrical Specifications

### Power

| Supply Voltage | Max Impedance |
|---------------|---------------|
| 9V | 125Ω |
| 12V | 250Ω |
| 20V | 500Ω |
| 24V | >500Ω |

### Power Consumption

| Variant | Supply | Static Current | Measuring Current | Max Current |
|---------|--------|---------------|-------------------|-------------|
| **RS485** | 3.3–24V | 3 mA | 25 mA | 35 mA |
| **RS485 (Ultra-low power)** | 3.3–24V | **0.07 mA** | 25 mA | 35 mA |
| **Analog (4-20mA)** | 3.3–24V | 10 mA | 25 mA | 50 mA |

## Measurement Specifications

| Parameter | Range | Resolution | Accuracy |
|-----------|-------|-----------|----------|
| **Soil Temperature** | -40°C ~ 80°C | 0.1°C | ±0.5°C @ 25°C |
| **Soil Moisture** | 0 ~ 100% VWC | 0.1% | ±3% (10–40%) @ 25°C, loam |
| **EC** | 0 ~ 20,000 µS/cm | 1 µS/cm | ±3% FS (0–10k); ±5% FS (10k–20k) @ 60% RH, 25°C, loam |
| **pH** | 3 ~ 9 pH | 0.1 pH | — |
| **Salinity** | Derived from EC | — | — |
| **N/P/K** | mg/kg | — | — |

## Communication Interface

### RS485 Modbus-RTU (Default)

| Parameter | Value |
|-----------|-------|
| **Protocol** | Modbus-RTU |
| **Default Address** | 0x02 |
| **Baud Rate** | 9600 (configurable: 1200–38400) |
| **Data Bits** | 8 |
| **Parity** | None |
| **Stop Bits** | 1 |

### Modbus Register Map

#### Configuration Registers (Read/Write)

| Register | Content | Operation | Description |
|----------|---------|-----------|-------------|
| 0080H | Address | R/W | Device address (1–247, 0x00 = broadcast) |
| 0081H | Baud Rate | R/W | 1200, 2400, 4800, 9600, 19200, 38400 |
| 0082H | Parity | R/W | 2=Even, 1=Odd |
| 0083H | Data Bits | R/W | 8, 9 |
| 0084H | Stop Bits | R/W | 1, 2 |
| 00BFH | Analog Ch1 Low | R/W | Temperature low limit (min -20.0°C) |
| 00C0H | Analog Ch1 High | R/W | Temperature high limit (max 80.0°C) |
| 00C1H | Analog Ch2 Low | R/W | Humidity low limit (0.0%) |
| 00C2H | Analog Ch2 High | R/W | Humidity high limit (100.0%) |

#### Data Registers (Read-only, starting at 0x0000, length 8)

| Register | Content | Data Format |
|----------|---------|-------------|
| 0 | Soil Temperature | Signed 16-bit, ÷10 → °C (negative: two's complement) |
| 1 | Soil Moisture | Unsigned 16-bit, ÷10 → %VWC |
| 2 | EC (µS/cm) | Unsigned 16-bit, direct value |
| 3 | Salinity | Unsigned 16-bit |
| 4 | Nitrogen (N) | Unsigned 16-bit, mg/kg |
| 5 | Phosphorus (P) | Unsigned 16-bit, mg/kg |
| 6 | Potassium (K) | Unsigned 16-bit, mg/kg |
| 7 | pH | Unsigned 16-bit, ÷10 → pH |

## Modbus Query Examples

### Read All Data (8 registers from address 0x0000)

**Request (Master → Slave):**
```
Address: 0x00 (broadcast) or specific address
Function: 0x03 (Read Holding Registers)
Start Register: 0x0000
Register Count: 0x0008
CRC16: auto-calculated
```

Example (address 0x00): `00 03 00 00 00 08 45 DD`

**Response (Slave → Master):**
```
Address: 0x01
Function: 0x03
Data Length: 0x10 (16 bytes)
Register 0: 0xFFDD → Temperature: -3.5°C
Register 1: 0x0164 → Moisture: 35.6%
Register 2: 0x0320 → EC: 800 µS/cm
Register 3: 0x0190 → Salinity: 400
Register 4: 0x0164 → Nitrogen: 356 mg/kg
Register 5: 0x0164 → Phosphorus: 356 mg/kg
Register 6: 0x0164 → Potassium: 356 mg/kg
Register 7: 0x0046 → pH: 7.0
CRC16: A7B5
```

### Change Device Address (e.g., 0x02 → 0x01)

**Request:** `02 10 00 80 00 01 02 00 01 75 C0`

### Change Baud Rate (e.g., 9600 → 19200)

**Request:** `00 10 00 81 00 01 02 19 20 BF 99`

> Use broadcast address 0x00 if original address is unknown (only one sensor on bus at a time).

## Temperature Data Conversion

### Negative Temperature (Two's Complement)

If register value > 0x7FFF:
```
temperature = -(0xFFFF - value + 1) / 10.0
```

Example: Register = 0xFFDD
```
0xFFFF - 0xFFDD + 1 = 0x0023 = 35
35 / 10 = 3.5
Result: -3.5°C
```

### Positive Temperature

```
temperature = value / 10.0
```

## Analog Output Conversion (4-20mA)

Formula:
```
S = (A - 4) / 16 × (Range_High - Range_Low) + Range_Low
```

Where:
- S = measured value (e.g., temperature in °C)
- A = current reading in mA
- Range_High/Low = configured analog range

Example: Range -20°C ~ 80°C, A = 12mA
```
S = (12 - 4) / 16 × (80 - (-20)) + (-20)
S = 0.5 × 100 - 20 = 30°C
```

## Application Areas

- Water-saving agricultural irrigation
- Weather monitoring
- Environmental monitoring
- Greenhouse / polytunnel farming
- Flower & vegetable cultivation
- Grassland & pasture management
- Rapid soil testing
- Plant cultivation & research
- Scientific experiments

## Cautions

1. Read the full manual before use
2. Do NOT insert probes into stones or hard soil clumps (may damage probes)
3. Do NOT pull the cable when removing sensor from soil
4. Ensure full probe insertion for accurate measurement
5. Warranty: 12 months from shipping date (non-human damage)

## Wiring (RS485)

| Wire Color | Function |
|-----------|----------|
| Red | VCC (3.3–24V DC) |
| Black | GND |
| Yellow | RS485-A (+) |
| Blue | RS485-B (-) |

*Note: Wire colors may vary. Verify with multimeter if unsure.*

## Example Code

See [example_modbus.c](../code/example_modbus.c) for a complete Modbus RTU read implementation in C.

## PDF / Original Document

Original manual: `土壤多参数传感器说明书V2.1.docx` (Chinese)
