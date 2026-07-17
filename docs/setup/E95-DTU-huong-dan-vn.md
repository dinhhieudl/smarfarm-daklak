# HƯỚNG DẪN SỬ DỤNG E95-DTU SERIES LORAWAN NODE (Dịch từ EBYTE)

> Nguồn: ebyte.com/news/4469.html, ebyte.com/news/4468.html, ebyte.com/news/4463.html

---

## 1. GIỚI THIỆU

E95-DTU(xxxLN22-485) là node电台 LoRaWAN, hỗ trợ:
- CLASS-A / CLASS-C
- OTAA / ABP
- LoRaWAN 1.0.3
- Cổng RS485
- Transparent transmission + Script thu thập dữ liệu

### Thông số kỹ thuật

| Thông số | Giá trị |
|---|---|
| Kích thước | 92×66×30 mm |
| Trọng lượng | 95±2g |
| Nhiệt độ | -40℃ ~ +85℃ |
| Điện áp | DC 8~28V |
| Giao tiếp | RS485 (3.81mm terminal) |
| Baud mặc định | 9600 bps |
| Tần số | EU868/US915/AU915/AS923/IN865/KR920/RU864 |
| Công suất phát | 22 dBm |
| Khoảng cách | ~5km (trống trải) |
| Tốc độ không khí | Tự động thích ứng |

### Đèn LED

| LED | Ý nghĩa |
|---|---|
| POWER | Đỏ - sáng khi có nguồn |
| TXD | Xanh dương - nháy khi phát dữ liệu |
| RXD | Xanh lá - nháy khi nhận dữ liệu |
| LINK | Cam - sáng = đã join network, tắt = chưa join |
| MODE | Sáng = transparent, Tắt = config mode |

### Nút bấm

- **Mode**: Giữ 1s → chuyển transparent/config
- **IAP**: Giữ >2s trước khi cấp nguồn → vào chế độ upgrade firmware

---

## 2. QUY TRÌNH CẤU HÌNH QUA AT COMMAND

### Bước 1: Chuẩn bị

1. Cắm USB-to-RS485 vào cổng RS485 trên E95-DTU
2. Mở XCOM (hoặc serial terminal khác)
3. Baud: 9600, 8N1
4. Gõ `+++` → đợi "OK" → đã vào **config mode**

### Bước 2: Cấu hình OTAA

```
+++                              // Vào config mode
AT+RESTORE                       // Khôi phục mặc định (bỏ qua nếu lần đầu)
AT+REGION=0                      // 0=AS923, 5=EU868, 1=US915...
AT+CDEVEUI=0080E115069C78C4      // Set DevEUI
AT+CAPPEUI=0000000000000000      // Set AppEUI (Join EUI)
AT+CAPPKEY=c70218daa08534a2541d15ea3bc7b7ca  // Set AppKey (16 bytes hex)
AT+CJOIN=1:0                     // OTAA join, không auto-join khi power on
AT+TRANSPARENT                   // Vào transparent mode
```

### Bước 3: Verify

```
AT+REGION=?          // Phải trả về 0:AS923
AT+CDEVEUI=?         // Phải khớp DevEUI đã set
AT+CAPPKEY=?         // Phải khớp AppKey đã set
AT+AS923_BAND=?      // Phải trả về 1 (sub-band 1)
AT+CFREQBANDMASK=?   // Phải đúng AS923 mask
AT+CRX2FQ=?          // Phải là 923200000 (923.2 MHz)
AT+HOTSTART=?        // 0=disabled, 1=enabled
```

### Bước 4: Test

1. Tắt nguồn DC node
2. Chờ 5s → bật lại
3. Đèn **LINK sáng cam** → đã join thành công
4. Gõ bất kỳ text trong XCOM → nhấn Send → data sẽ đi qua LoRa

---

## 3. QUY TRÌNH CẤU HÌNH QUA PHẦN MỀM EBYTE

### Kết nối

1. Cắm USB-to-RS485
2. Mở E95-DTU(xxxLNxx)_Setting V1.0
3. Chọn Baud=9600, COM port đúng, Para=None
4. Nhấn **Open UART**

### Tab: Parameter Cfg → Local Config

| Thông số | Ý nghĩa | Giá trị mẫu |
|---|---|---|
| Baud | Tốc độ UART | 9600 |
| Para | Parity | None |
| Log Level | Mức debug | 0 (tắt) |
| Duty Cycle | ETSI duty cycle | 0 (disabled) |
| TX Power | Công suất phát | 0 (max 22dBm) |
| Rate | Tốc độ không khí | SF12 BW125 |
| Fast Send | Gửi nhanh | 0 (disabled) |

### Tab: Parameter Cfg → LoRaWAN Config

| Thông số | Ý nghĩa | Giá trị mẫu |
|---|---|---|
| Join Delay 1 | Delay RX window 1 | 5000 ms |
| Join Delay 2 | Delay RX window 2 | 6000 ms |
| RX2 Frequency | Tần số RX2 | 923200000 (AS923) |
| Network ID | Network ID | 0 |
| Freq Band Mask | Kênh tần số | 0003:0000... (AS923) |
| Manual Mask | Bật/tắt manual mask | DISABLE |

### Tab: Parameter Cfg → OTAA

| Thông số | Ý nghĩa |
|---|---|
| AppEUI | Join EUI (16 ký tự hex) |
| DEVEUI | Device EUI (16 ký tự hex) |
| APPKEY | Application Key (32 ký tự hex) |
| HotStart | CLOSE=không lưu session, OPEN=lưu session |

### Tab: Parameter Cfg → ABP

| Thông số | Ý nghĩa |
|---|---|
| DEVADDR | Device Address (4 bytes) |
| AppSKey | Application Session Key |
| NwkSKey | Network Session Key |

> Chỉ dùng ABP nếu chọn ABP thay OTAA. Với OTAA, 3 field này tự động điền sau join.

### Tab: Parameter Cfg → Mode Select

| Thông số | Ý nghĩa |
|---|---|
| Communication Rate | Tốc độ không khí (SF/BW) |
| Working Band | Tần số hoạt động (AS923, EU868...) |
| AS923 Sub-band | Sub-band 1~4 |
| Class | CLASS-A hoặc CLASS-C |
| Port | Cổng LoRaWAN |
| ACK Mode | Chế độ xác nhận |
| Join Mode | OTAA hoặc ABP |
| Auto Join | Tự join khi power on |

### Nút chức năng trên phần mềm

| Nút | Ý nghĩa |
|---|---|
| Read | Đọc tham số từ thiết bị |
| Save | Lưu tham số vào flash |
| CFG Mode | Chuyển sang config mode |
| Trans Mode | Chuyển sang transparent mode |
| Reset | Khởi động lại thiết bị |
| Restore | Khôi phục mặc định nhà sản xuất |
| BAT Read | Đọc thông tin pin |
| Local Time | Đặt thời gian |
| Net connection | Kiểm tra kết nối mạng |

---

## 4. AT COMMAND THAM CHIẾR ĐẦY ĐỦ

### Cấu hình cơ bản

| AT Command | Ý nghĩa | Giá trị |
|---|---|---|
| `AT+RESTORE` | Khôi phục mặc định | - |
| `AT+REGION=x` | Đặt region | 0=AS923, 1=US915, 2=CN470, 3=EU433, 4=AU915, 5=EU868, 6=IN865, 7=KR920, 8=RU864 |
| `AT+AS923_BAND=x` | Sub-band AS923 | 1~4 |
| `AT+CDATARATE=x` | Tốc độ data | 0~5 (对应 SF12~SF7) |

### OTAA

| AT Command | Ý nghĩa |
|---|---|
| `AT+CAPPEUI=xxxx` | Set AppEUI (16 hex) |
| `AT+CDEVEUI=xxxx` | Set DevEUI (16 hex) |
| `AT+CAPPKEY=xxxx` | Set AppKey (32 hex) |
| `AT+CJOIN=a:b` | a=0/1 (ABP/OTAA), b=0/1 (không/tự join khi power on) |
| `AT+HOTSTART=x` | 0=disabled, 1=enabled |

### ABP

| AT Command | Ý nghĩa |
|---|---|
| `AT+CDEVADDR=xx:xx:xx:xx` | Set DevAddr |
| `AT+CAPPSKEY=xxxx` | Set AppSKey (32 hex) |
| `AT+CNWKSKEY=xxxx` | Set NwkSKey (32 hex) |

### UART & Network

| AT Command | Ý nghĩa |
|---|---|
| `AT+UART=a:b` | a=baud index (0=1200..7=115200), b=parity (0=None,1=Even,2=Odd) |
| `AT+LOGLEVEL=x` | Mức log (0=tắt) |
| `AT+DUTYCYCLE=x` | ETSI duty cycle (0=disabled) |
| `AT+CTXP=x` | Công suất phát (0=max 22dBm) |
| `AT+CADR=x` | ADR (0=disabled, 1=enabled) |
| `AT+FASTSEND=x` | Gửi nhanh (0=disabled) |

### LoRaWAN Advanced

| AT Command | Ý nghĩa |
|---|---|
| `AT+CFREQBANDMASK=xxxx` | Frequency band mask |
| `AT+CMANUALMASK=x` | Manual mask (0=auto, 1=manual) |
| `AT+CJN1DL=xxxx` | Join delay RX1 (ms) |
| `AT+CJN2DL=xxxx` | Join delay RX2 (ms) |
| `AT+CRX2FQ=xxxxxxx` | RX2 frequency (Hz) |
| `AT+CNWKID=x` | Network ID |
| `AT+CCLASS=x` | Class (A/B/C) |

### Mode

| AT Command | Ý nghĩa |
|---|---|
| `+++` | Vào config mode |
| `AT+TRANSPARENT` | Vào transparent mode |
| `AT+SENDCFG=x:y` | x=buffer size, y=mode |

### Query (thêm `?` để đọc)

```
AT+REGION=?           // Đọc region hiện tại
AT+CDEVEUI=?          // Đọc DevEUI
AT+CAPPEUI=?          // Đọc AppEUI
AT+CAPPKEY=?          // Đọc AppKey
AT+AS923_BAND=?       // Đọc AS923 sub-band
AT+CFREQBANDMASK=?    // Đọc frequency mask
AT+CRX2FQ=?           // Đọc RX2 frequency
AT+HOTSTART=?         // Đọc hotstart mode
AT+CJOIN=?            // Đọc join config
AT+CCLASS=?           // Đọc class
AT+CDATARATE=?        // Đọc data rate
AT+UART=?             // Đọc UART config
AT+SENDCFG=?          // Đọc send config
```

---

## 5. FIRMWARE UPGRADE

1. Tải firmware từ trang sản phẩm EBYTE
2. Tắt nguồn E95-DTU
3. Nhấn giữ nút **IAP** >2 giây
4. Giữ IAP → cấp nguồn DC
5. Mở phần mềm EBYTE → tab **Firmware Upgrade**
6. Nhấn **Open File** → chọn file firmware
7. Nhấn **Start Download** → chờ progress 100%
8. Tắt → mở lại cổng serial

---

## 6. SCRIPT MODE (Thu thập dữ liệu tự động)

E95-DTU hỗ trợ script để tự động đọc sensor RS485 theo chu kỳ và gửi qua LoRaWAN.

### Cấu hình

1. Mở phần mềm EBYTE → tab **Script Control → Script Config**
2. Double-click dòng cần cấu hình
3. Điền địa chỉ Modbus, hàm đọc, chu kỳ (giây)
4. Nhấn **Write** → Enable script

Script sẽ tự động:
- Đọc data từ sensor qua RS485/Modbus
- Gói thành LoRaWAN payload
- Gửi theo chu kỳ cấu hình
- Gateway nhận → ChirpStack decode → Node-RED xử lý → InfluxDB lưu → Grafana hiển thị

---

## 7. TROUBLESHOOTING

| Vấn đề | Nguyên nhân | Giải pháp |
|---|---|---|
| Đèn POWER không sáng | Không có nguồn | Kiểm tra adapter DC 8-28V |
| LINK không sáng | Chưa join network | Kiểm tra AT+CJOIN=1:0 đã set |
| LINK không sáng | Region không khớp | Verify AT+REGION và gateway cùng AS923 |
| LINK không sáng | AppKey sai | Verify AT+CAPPKEY khớp ChirpStack |
| TXD không nháy | Node không ở transparent mode | Nhấn Mode → đèn MODE sáng |
| TXD không nháy | Chưa có data trên serial | Gửi data từ XCOM trước |
| JOIN FAILED | Gateway không nhận | Kiểm tra E870 region = AS923 |
| JOIN FAILED | AppKey không khớp | So sánh AppKey node vs ChirpStack |
| Data không đến server | Node-RED chưa chạy | `docker start sf-nodered` |
| Data không đến server | MQTT topic sai | Kiểm tra ChirpStack MQTT integration |
