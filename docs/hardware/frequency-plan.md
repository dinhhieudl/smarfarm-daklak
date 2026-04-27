# Frequency Plan for Vietnam (DakLak)

## Selected Plan: AS923

Vietnam falls under the **AS923** LoRaWAN regional frequency plan.

### AS923 Channel Plan

| Channel | Frequency (MHz) | Direction |
|---------|-----------------|-----------|
| 0 | 923.2 | Uplink |
| 1 | 923.4 | Uplink |
| 2 | 923.6 | Uplink |
| 3 | 923.8 | Uplink |
| 4 | 924.0 | Uplink |
| 5 | 924.2 | Uplink |
| 6 | 924.4 | Uplink |
| 7 | 924.6 | Uplink |
| RX1 | 923.2 | Downlink |
| RX2 | 923.2 | Downlink |

### Why AS923?

1. **Regulatory**: Vietnam's radio regulations align with ITU Region 3, AS923 band.
2. **Hardware support**: Both E870-L915LG12 gateway and E90-DTU(900SL22) node support AS923 frequencies (within 902–928 MHz range).
3. **ChirpStack default**: AS923 is a well-supported region file in ChirpStack.

### ⚠️ Frequency Mismatch Warning

The **E90-DTU(900SL22)** defaults to **868.125 MHz** (EU868 band).

**You MUST reconfigure the DTU to operate within the AS923 frequency range (923.2–924.6 MHz) before deployment.**

Configuration steps:
1. Connect the DTU to PC via RS232/USB adapter
2. Open EByte's configuration tool (EByte RF Setting Tool)
3. Set the center frequency to a valid AS923 channel (e.g., 923.2 MHz)
4. Set channel number accordingly
5. Match air rate and other parameters across gateway and all nodes
6. Write settings and reboot

### Alternative: AS923-1 Sub-band

For ChirpStack, you may use **AS923-1** (also called AS923 Group 1) which is the most common sub-band:
- Uplink: 923.2 – 924.6 MHz
- Downlink: 923.2 MHz

### LoRaWAN Parameters for AS923

| Parameter | Value |
|-----------|-------|
| Max EIRP | 16 dBm (can be higher with sub-band variants) |
| Duty Cycle | No mandatory duty cycle (but recommended <1%) |
| Default DR | DR2 (SF10/125kHz) |
| RX1 Delay | 1 second |
| RX2 DR | DR8 (SF12/500kHz) |
