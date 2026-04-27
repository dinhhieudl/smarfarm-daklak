/**
 * Soil Multi-Parameter Sensor - Modbus RTU Reader (Example)
 *
 * Reads 8 registers (temperature, moisture, EC, salinity, N, P, K, pH)
 * from the soil sensor via RS485 Modbus-RTU.
 *
 * Platform: Adapt as needed (STM32, Arduino, Raspberry Pi, etc.)
 *
 * Wiring:
 *   RS485-A (+) → Sensor A (yellow wire)
 *   RS485-B (-) → Sensor B (blue wire)
 *   VCC (3.3-24V) → Sensor red wire
 *   GND → Sensor black wire
 */

#include <stdint.h>
#include <string.h>

/* ---------- CRC16 (Modbus) ---------- */

/**
 * Calculate Modbus CRC16
 * @param data  Pointer to data buffer
 * @param length  Number of bytes
 * @return CRC16 value (big-endian: high byte first)
 */
uint16_t MOD_CRC16(uint8_t *data, uint16_t length)
{
    uint8_t i;
    uint16_t crc = 0xFFFF;

    while (length--) {
        crc ^= *data++;
        for (i = 0; i < 8; i++) {
            if (crc & 0x01)
                crc = (crc >> 1) ^ 0xA001;
            else
                crc = crc >> 1;
        }
    }
    return (crc = ((crc & 0xFF) << 8) | (crc >> 8));
}

/* ---------- Byte Order Conversion ---------- */

/**
 * Convert 2-byte buffer to short with byte order handling
 * @param buf   Pointer to 2-byte buffer
 * @param type  Byte order (1234=big-endian, 2143=swap, 3412=swap, 4321=little-endian)
 * @return Converted 16-bit value
 */
void *charbuf2short(uint8_t *buf, const short type)
{
    uint8_t data[2] = {0, 0};
    if (type == 12) {
        data[0] = buf[0];
        data[1] = buf[1];
    } else {
        data[0] = buf[1];
        data[1] = buf[0];
    }
    return data;
}

/* ---------- Build Modbus Read Command ---------- */

/**
 * Build a Modbus RTU read holding registers (function 0x03) command
 *
 * @param tx_buf    Output buffer (must be at least 8 bytes)
 * @param address   Slave device address (0x01-0xFE, 0x00=broadcast)
 * @param reg_addr  Starting register address
 * @param reg_count Number of registers to read
 */
void modbus_read_registers(uint8_t *tx_buf, uint8_t address,
                           uint16_t reg_addr, uint16_t reg_count)
{
    uint16_t crc;

    tx_buf[0] = address;
    tx_buf[1] = 0x03;               // Function: Read Holding Registers
    tx_buf[2] = (reg_addr >> 8);    // Register address high byte
    tx_buf[3] = reg_addr;           // Register address low byte
    tx_buf[4] = (reg_count >> 8);   // Register count high byte
    tx_buf[5] = reg_count;          // Register count low byte

    crc = MOD_CRC16(tx_buf, 6);
    tx_buf[6] = (crc >> 8);         // CRC high byte
    tx_buf[7] = crc;                // CRC low byte

    // Send tx_buf[0..7] via RS485 UART (8 bytes total)
    // UART_Send(tx_buf, 8);
}

/* ---------- Parse Sensor Response ---------- */

typedef struct {
    float temperature;   // °C
    float moisture;      // % VWC
    uint16_t ec;         // µS/cm
    uint16_t salinity;
    uint16_t nitrogen;   // mg/kg
    uint16_t phosphorus; // mg/kg
    uint16_t potassium;  // mg/kg
    float ph;            // pH units
} SoilSensorData_t;

/**
 * Parse the Modbus response from the soil sensor
 *
 * @param rx_buf    Response buffer from sensor
 * @param rx_len    Response length (should be 21 bytes for 8 registers)
 * @param data      Output parsed data structure
 * @return 0 on success, -1 on CRC error
 */
int parse_sensor_response(uint8_t *rx_buf, uint16_t rx_len, SoilSensorData_t *data)
{
    uint16_t crc_calc, crc_recv;
    uint16_t raw;

    // Verify minimum length: 1(addr) + 1(func) + 1(len) + 16(data) + 2(crc) = 21
    if (rx_len < 21) return -1;

    // Verify CRC
    crc_calc = MOD_CRC16(rx_buf, rx_len - 2);
    crc_recv = (rx_buf[rx_len - 2] << 8) | rx_buf[rx_len - 1];
    if (crc_calc != crc_recv) return -1;

    // Verify function code
    if (rx_buf[1] != 0x03) return -1;

    // Register 0: Soil Temperature (signed, ÷10)
    raw = (rx_buf[3] << 8) | rx_buf[4];
    if (raw > 0x7FFF)
        data->temperature = -(float)(0xFFFF - raw + 1) / 10.0f;
    else
        data->temperature = (float)raw / 10.0f;

    // Register 1: Soil Moisture (unsigned, ÷10)
    raw = (rx_buf[5] << 8) | rx_buf[6];
    data->moisture = (float)raw / 10.0f;

    // Register 2: EC (unsigned, direct)
    data->ec = (rx_buf[7] << 8) | rx_buf[8];

    // Register 3: Salinity (unsigned, direct)
    data->salinity = (rx_buf[9] << 8) | rx_buf[10];

    // Register 4: Nitrogen (unsigned, direct, mg/kg)
    data->nitrogen = (rx_buf[11] << 8) | rx_buf[12];

    // Register 5: Phosphorus (unsigned, direct, mg/kg)
    data->phosphorus = (rx_buf[13] << 8) | rx_buf[14];

    // Register 6: Potassium (unsigned, direct, mg/kg)
    data->potassium = (rx_buf[15] << 8) | rx_buf[16];

    // Register 7: pH (unsigned, ÷10)
    raw = (rx_buf[17] << 8) | rx_buf[18];
    data->ph = (float)raw / 10.0f;

    return 0;
}

/* ---------- Example Usage ---------- */

/*
 * Complete read cycle:
 *
 * 1. Build Modbus read command:
 *    modbus_read_registers(tx_buf, 0x02, 0x0000, 8);
 *    // Sensor address 0x02, read 8 registers starting at 0x0000
 *
 * 2. Send via RS485 UART:
 *    RS485_Send(tx_buf, 8);
 *
 * 3. Wait for response (~50ms timeout):
 *    RS485_Receive(rx_buf, &rx_len, 50);
 *
 * 4. Parse response:
 *    SoilSensorData_t sensor;
 *    if (parse_sensor_response(rx_buf, rx_len, &sensor) == 0) {
 *        printf("Temp: %.1f°C\n", sensor.temperature);
 *        printf("Moisture: %.1f%%\n", sensor.moisture);
 *        printf("EC: %d µS/cm\n", sensor.ec);
 *        printf("N: %d mg/kg\n", sensor.nitrogen);
 *        printf("P: %d mg/kg\n", sensor.phosphorus);
 *        printf("K: %d mg/kg\n", sensor.potassium);
 *        printf("pH: %.1f\n", sensor.ph);
 *    }
 */
