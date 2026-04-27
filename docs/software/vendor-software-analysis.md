# Vendor-Provided Software Analysis - SmartFarm DakLak

> Analyzed: 2026-04-27
> Source: `software/` directory — provided by sensor vendor

## Overview

The vendor supplied **two software components**:

| # | Directory | Purpose |
|---|-----------|---------|
| 1 | `查看数据软件/` | ModScan32 + ModSim32 — Windows Modbus diagnostic tools |
| 2 | `stm32f103-mini-system/` | STM32F103 firmware with RT-Thread RTOS + Modbus RTU reader |

---

## 1. 查看数据软件 — ModScan32 / ModSim32 (WinTECH Software)

### What It Is

A pair of **Windows Modbus diagnostic applications** from WinTECH Software (USA):

- **ModScan32** — Modbus **master** device simulator. Polls slave devices, displays register data in real-time.
- **ModSim32** — Modbus **slave** device simulator. Simulates a sensor by hosting configurable register data.

### Key Capabilities

| Feature | ModScan32 | ModSim32 |
|---------|-----------|----------|
| Role | Master (queries slaves) | Slave (responds to masters) |
| Protocol | Modbus RTU & ASCII | Modbus RTU & ASCII |
| Function Codes | 01-06, 15, 16 | 01-06, 15, 16 |
| Connection | COM port, modem, TCP/IP | COM port, TCP/IP |
| Data Capture | Text file, database (MS Access) | — |
| OLE Automation | Yes (VBA scripting) | — |
| Display Formats | Binary, Decimal, Hex, Float | — |
| Test Scripts | Yes (`.csv` format) | — |

### Included Files

```
查看数据软件/
├── ModScan32.exe          # Main Modbus master app (Chinese localized)
├── ModScan32.chm          # Help file
├── ModScan32.tlb          # OLE type library
├── ModScan32Ex.vbp/vbw    # VB6 project files
├── modbusm.dll            # Modbus driver DLL
├── 英文版文件/             # English version
│   ├── ModScan32.exe
│   └── modbusm.dll
├── 汉化版文件/             # Chinese localized version
│   ├── ModScan32.exe
│   └── modbusm.dll
├── Modsim32/              # Slave simulator
│   ├── ModSim32.exe
│   ├── Modbusl.dll
│   └── 注册码.TXT         # Registration code
├── example1.csv           # Test script example
├── Book1.xls              # Sample data spreadsheet
├── ScanGuide.txt          # Comprehensive user manual
└── *.bmp                  # UI resource images
```

### How to Use with Soil Sensor

1. Connect PC to RS485 bus (via USB-to-RS485 adapter)
2. Open ModScan32
3. Configure: Device ID = `0x02`, Baud = `9600`, Data Bits = `8`, Parity = `None`, Stop Bits = `1`
4. Set: Function = `03 - Read Holding Registers`, Address = `0000`, Length = `8`
5. Click Connect → sensor data appears in real-time
6. Display format: select "Decimal" or "Hex" for raw register values

### My Assessment

- **Shareware** — 3.5-minute time limit per session unless registered ($64.95). Registration code included in `注册码.TXT`.
- **Diagnostic tool only** — not meant for production data collection. Use for initial sensor testing, commissioning, and troubleshooting.
- **Windows-only** — no Linux/macOS support. For headless/production, use the STM32 firmware or direct Modbus libraries instead.
- **Legacy software** — WinTECH's last update era ~2000s. Still functional but no modern UI.

---

## 2. stm32f103-mini-system — STM32 Firmware (BSP)

### What It Is

A **complete BSP (Board Support Package)** for the STM32F103C8T6 "Blue Pill" mini-system board, running **RT-Thread RTOS v4.0.1**. The vendor customized it with a **Modbus RTU reader** that polls the soil sensor.

### Board Specifications

| Spec | Value |
|------|-------|
| MCU | STM32F103C8T6 (ARM Cortex-M3) |
| Clock | 72 MHz |
| Flash | 64 KB |
| RAM | 20 KB |
| Debug | SWD |
| LED | 1× Yellow (PC13) |
| UART | UART1 (debug), UART2 (sensor RS485) |

### Project Structure

```
stm32f103-mini-system/
├── applications/
│   ├── main.c              # Entry point: LED blink + start UART2 sensor polling
│   └── Modbus..c           # ★ Core: Modbus RTU master for soil sensor
├── board/
│   ├── board.c             # Board init
│   └── CubeMX_Config/      # STM32 HAL + CMSIS drivers
├── rt-thread/              # RT-Thread RTOS v4.0.1 source
├── libraries/              # STM32F1xx HAL library
├── rtconfig.h/.py          # RT-Thread configuration
├── project.uvprojx         # Keil MDK5 project
├── project.eww             # IAR project
└── Kconfig/.config         # Build configuration
```

### Firmware Architecture

```
┌──────────────────────────────────────────────┐
│                   main.c                      │
│  ┌──────────┐  ┌──────────────────────────┐  │
│  │ LED Blink│  │  uart2_sample()           │  │
│  │ (PC13)   │  │  ┌────────────────────┐   │  │
│  │ 500ms    │  │  │ serial2_thread     │   │  │
│  │ toggle   │  │  │ (Modbus polling)   │   │  │
│  └──────────┘  │  └────────┬───────────┘   │  │
│                │           │                │  │
│                │  ┌────────▼───────────┐    │  │
│                │  │ UART2GET_MODEBUS() │    │  │
│                │  │ (RS485 Modbus RTU) │    │  │
│                │  └────────────────────┘    │  │
│                └──────────────────────────┘  │
└──────────────────────────────────────────────┘
         │                          ▲
         ▼                          │
   ┌───────────┐            ┌───────┴──────┐
   │ RS485 Bus │◄──────────►│ Soil Sensor  │
   │ (UART2)   │  9600-8N1  │ Addr: 0x02   │
   │ PA1=EN    │            │ 8 registers  │
   └───────────┘            └──────────────┘
```

### Key Code Analysis — `Modbus..c`

**Sensor Configuration Table:**
```c
const rt_uint8_t __485DefluatTbale[][4] = {
    {2, 0, 8},  // Address=0x02, StartReg=0x0000, Length=8
};
```
- Default sensor address: **0x02**
- Reads **8 registers** starting at **0x0000** (all sensor data in one poll)
- Polling interval: **5 seconds** (`rt_thread_mdelay(5*1000)`)

**Modbus Communication Flow:**
1. Build Modbus RTU request: `02 03 00 00 00 08 [CRC16]`
2. Enable RS485 TX (PA1 HIGH), send 8 bytes, disable TX (PA1 LOW)
3. Wait for response with 100ms timeout per byte
4. Verify CRC16, verify slave address match
5. Parse 16 bytes of data (8 registers × 2 bytes)
6. Store in `SenData[32]` array

**Data Parsing:**
```c
data = *(short*)charbuf2short(&Ultrasonic_Data[3+k*2], 21);
```
- Type `21` = byte-swapped (little-endian) 16-bit conversion
- Temperature: signed 16-bit, ÷10 → °C
- Moisture: unsigned 16-bit, ÷10 → %VWC
- EC: unsigned 16-bit, direct µS/cm
- pH: unsigned 16-bit, ÷10 → pH units

**Robustness Features:**
- CRC16 verification on every response
- 3 retries per poll (`for(x=0;x<3;x++)`)
- Response filtering: scans for slave address byte to handle leading garbage data
- Length verification: checks `Ultrasonic_Data[2] == length*2`

### Build Environment

| IDE | Project File |
|-----|-------------|
| Keil MDK5 | `project.uvprojx` |
| IAR EWARM | `project.eww` |
| GCC + SCons | `SConstruct` |
| RT-Thread ENV | `menuconfig` → `pkgs --update` → `scons` |

---

## 3. Additional Software — Server Stack

The repo also contains a **complete server-side Docker Compose stack** (not from vendor, but part of the project):

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| PostgreSQL | postgres:16 | 5432 | ChirpStack database |
| Redis | redis:7 | 6379 | ChirpStack cache |
| Mosquitto | eclipse-mosquitto:2 | 1883 | MQTT broker |
| ChirpStack | chirpstack/chirpstack:4 | 8080, 1700/udp | LoRaWAN network server |
| Node-RED | nodered/node-red | 1880 | Data processing |
| InfluxDB | influxdb:2.7 | 8086 | Time-series storage |
| Grafana | grafana/grafana | 3000 | Dashboard |

Default access:
- ChirpStack: `http://localhost:8080` (admin/admin)
- Node-RED: `http://localhost:1880`
- Grafana: `http://localhost:3000` (admin/admin)

---

## 4. Sensor Protocol Quick Reference

### Modbus RTU Command (Read All Data)

```
TX: 02 03 00 00 00 08 [CRC16]
     │  │  └──────┘  └──┘
     │  │    Start=0   Count=8
     │  Function 03 (Read Holding Registers)
     Slave Address 0x02
```

### Response (21 bytes)

```
RX: 02 03 10 [16 data bytes] [CRC16]
     │  │  │
     │  │  Data length = 0x10 (16 bytes)
     │  Function 03
     Slave Address

Data bytes (big-endian, 2 bytes each):
  [0-1]   Temperature  (signed, ÷10 → °C)
  [2-3]   Moisture     (unsigned, ÷10 → %VWC)
  [4-5]   EC           (unsigned, direct µS/cm)
  [6-7]   Salinity     (unsigned, direct)
  [8-9]   Nitrogen N   (unsigned, mg/kg)
  [10-11] Phosphorus P (unsigned, mg/kg)
  [12-13] Potassium K  (unsigned, mg/kg)
  [14-15] pH           (unsigned, ÷10 → pH)
```

### Negative Temperature (Two's Complement)

```
If value > 0x7FFF:
  temperature = -(0xFFFF - value + 1) / 10.0
```

---

## 5. Recommendations & Observations

### Vendor Software Quality
- **ModScan32/ModSim32**: Standard industrial tools, well-documented, but outdated (shareware era). Good for commissioning.
- **STM32 Firmware**: Clean, functional code. RT-Thread is a solid RTOS choice. The Modbus implementation is robust with retries and CRC checking.

### Limitations Found
1. **No LoRa integration in STM32 firmware** — the firmware only reads sensor via RS485. LoRa transmission (E90-DTU) is handled separately by the DTU's transparent bridge mode.
2. **Single sensor support** — default config table has only 1 sensor (address 0x02). Multi-sensor requires modifying `__485DefluatTbale`.
3. **No data persistence on node** — sensor data is held in RAM (`SenData[32]`), no local storage if LoRa link fails.
4. **ModScan32 is Windows-only** — for Linux-based field laptops, use `mbpoll` or `pymodbus` instead.

### Next Steps
- [ ] Test sensor with ModScan32 via USB-to-RS485 adapter (commissioning)
- [ ] Verify all 8 register values match expected soil conditions
- [ ] Consider extending STM32 firmware for multi-sensor bus
- [ ] Integrate sensor data encoding for LoRa payload (DTU transparent mode)
