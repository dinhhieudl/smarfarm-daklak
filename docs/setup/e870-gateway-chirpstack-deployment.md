# E870 Gateway + ChirpStack v4 — Kinh nghiệm triển khai thực tế

> Ngày: 2026-06-13  
> Tác giả: Tôm 🦐 (AI assistant) + Hieu Nguyen  
> Gateway: E870-L915LG12 (EByte, SX1302, AS923)  
> Server: ChirpStack v4.17.0 + Gateway Bridge v4.1

---

## Tóm tắt

Tài liệu ghi lại quá trình debug và kết nối thành công gateway LoRaWAN E870-L915LG12 với ChirpStack v4 chạy trên Docker (Windows). Bao gồm các vấn đề gặp phải, nguyên nhân, và cách khắc phục.

---

## Kiến trúc hệ thống

```
E870 Gateway (192.168.31.144)
    │
    │ UDP port 1700 (Semtech packet forwarder)
    ▼
ChirpStack Gateway Bridge (Docker: sf-gateway-bridge)
    │
    │ MQTT (mosquitto:1883)
    │ Topic: as923/gateway/{ID}/event/+
    ▼
ChirpStack v4 (Docker: sf-chirpstack)
    │
    │ MQTT integration
    ▼
Node-RED / Smart-Control / Grafana
```

---

## Bước triển khai

### 1. Cấu hình vật lý E870

- **Nguồn:** DC 8-28V (jack 5.5×2.1mm)
- **Antenna:** Gắn antenna LoRa 915MHz **TRƯỚC** khi cấp nguồn
- **Mạng:** Cắm WAN port vào router (không cắm trực tiếp vào PC)
- **IP:** Router cấp DHCP — tìm qua scan mạng hoặc check DHCP lease

### 2. Cấu hình Packet Forwarder trên E870

Truy cập web UI: `http://<gateway-ip>` (default: admin/admin)

| Parameter | Value |
|-----------|-------|
| Server address | `<IP máy chạy ChirpStack>` |
| Server port | `1700` |
| Gateway ID | `70B3D52026021439` (in trên nhãn) |
| Region | `AS923` |
| Center frequency 1 | `920600000` |
| Center frequency 2 | `921400000` |

→ Nhấn **Save** → **Reboot** gateway

### 3. Deploy ChirpStack + Gateway Bridge

#### docker-compose.yml (trích)

```yaml
# ChirpStack
chirpstack:
  image: chirpstack/chirpstack:4
  ports:
    - "8080:8080"
  volumes:
    - ./config/chirpstack.toml:/etc/chirpstack/chirpstack.toml
    - ./config/region_as923.toml:/etc/chirpstack/region_as923.toml

# Gateway Bridge (UDP → MQTT)
chirpstack-gateway-bridge:
  image: chirpstack/chirpstack-gateway-bridge:4.1
  ports:
    - "1700:1700/udp"
  volumes:
    - ./config/gateway-bridge.toml:/etc/chirpstack-gateway-bridge/chirpstack-gateway-bridge.toml
```

#### chirpstack.toml

```toml
[logging]
  level = "info"
  format = "text"

[postgresql]
  dsn = "postgres://chirpstack:***@postgres/chirpstack?sslmode=disable"

[redis]
  url = "redis://redis:6379"

[network]
  enabled_regions = ["as923"]

[integration]
  enabled = ["mqtt"]
  [integration.mqtt]
    server = "tcp://mosquitto:1883"
    json = true

[gateway]
  allow_unknown_gateways = true

[api]
  bind = "0.0.0.0:8080"
  secret = "..."

[monitoring]
  bind = "0.0.0.0:8081"
```

#### region_as923.toml

```toml
[[regions]]
  id = "as923"
  description = "AS923"
  common_name = "AS923"

  [regions.gateway]
    force_gws_private = false

    [regions.gateway.backend]
      enabled = "mqtt"

      [regions.gateway.backend.mqtt]
        topic_prefix = "as923"
        share_name = "chirpstack"
        server = "tcp://mosquitto:1883"
        qos = 0
        clean_session = false

  [[regions.gateway.channels]]
    frequency = 923200000
    bandwidth = 125000
    modulation = "LORA"
    spreading_factors = [7, 8, 9, 10, 11, 12]

  # ... thêm các channel 923400000 - 924600000

  [regions.rx1]
    delay = 1
    frequency_offset = 0

  [regions.rx2]
    frequency = 923200000
    dr = 2
```

#### gateway-bridge.toml

```toml
marshaler = "json"

[backend]
  type = "semtech_udp"
  udp_bind = "0.0.0.0:1700"
  skip_crc_check = false

[integration]
  type = "mqtt"

  [integration.mqtt]
    event_topic_template = "as923/gateway/{{ .GatewayID }}/event/{{ .EventType }}"
    state_topic_template = "as923/gateway/{{ .GatewayID }}/state/{{ .StateType }}"
    command_topic_template = "as923/gateway/{{ .GatewayID }}/command/#"
    client_id = "chirpstack-gateway-bridge"
    state_retained = true

  [integration.mqtt.auth]
    type = "generic"

  [integration.mqtt.auth.generic]
    servers = ["tcp://mosquitto:1883"]
```

### 4. Đăng ký Gateway trên ChirpStack

1. Mở `http://localhost:8080` → Login: admin/admin
2. Gateways → Add Gateway
3. Gateway ID: `70B3D52026021439`
4. Name: `DakLak-GW-01`
5. Region: AS923 (auto-detect từ gateway backend)
6. Save

### 5. Verify

```bash
# Check gateway last_seen_at
docker exec sf-postgres psql -U chirpstack -d chirpstack \
  -c "SELECT gateway_id, name, last_seen_at FROM gateway;"

# Check MQTT traffic
docker exec sf-mosquitto mosquitto_sub -h localhost -t "as923/#" -v

# Check Gateway Bridge logs
docker logs sf-gateway-bridge --tail 10

# Check ChirpStack logs
docker logs sf-chirpstack --tail 10
```

---

## Vấn đề gặp phải & Cách khắc phục

### 1. Gateway cắm trực tiếp vào PC → không có DHCP

**Triệu chứng:** Ethernet adapter có IP `169.254.x.x` (APIPA), ping gateway không được.

**Nguyên nhân:** Gateway WAN port mong kết nối qua router, không phải trực tiếp vào PC.

**Fix:** Cắm gateway vào router. Router cấp DHCP tự động.

---

### 2. ChirpStack v4 không có UDP backend tích hợp

**Triệu chứng:** ChirpStack container không listen UDP 1700. Gateway gửi data nhưng ChirpStack không nhận.

**Nguyên nhân:** ChirpStack v4 (khác v3) không tích hợp UDP packet forwarder backend. Cần Gateway Bridge trung gian.

**Fix:** Thêm `chirpstack-gateway-bridge` service vào docker-compose.

---

### 3. Gateway Bridge publish sai MQTT topic format

**Triệu chứng:** Gateway Bridge publish `gateway/{ID}/event/stats` nhưng ChirpStack subscribe `as923/gateway/+/event/+`.

**Nguyên nhân:** ChirpStack v4 yêu cầu topic prefix theo region (`as923/`). Gateway Bridge config thiếu prefix.

**Fix:** Config `event_topic_template` với `as923/` prefix:
```toml
event_topic_template = "as923/gateway/{{ .GatewayID }}/event/{{ .EventType }}"
```

---

### 4. Gateway Bridge gửi Protobuf thay vì JSON

**Triệu chứng:** MQTT message content là binary, không phải JSON readable.

**Nguyên nhân:** Default `marshaler = "protobuf"`. Config `json = true` trong `[integration.mqtt]` không đúng field.

**Fix:** Set `marshaler = "json"` ở top-level config:
```toml
marshaler = "json"
```

---

### 5. chirpstack.toml dùng format cũ

**Triệu chứng:** ChirpStack không load region config → không subscribe MQTT → gateway `last_seen_at` = NULL.

**Nguyên nhân:** `chirpstack.toml` dùng `[network_server]` và `[[region_server.configuration]]` (format cũ). ChirpStack v4.17 cần `[network]` với `enabled_regions`.

**Fix:** Sửa `chirpstack.toml`:
```toml
# OLD (sai)
[network_server]
  enabled_regions = ["as923"]
[region_server]
  [[region_server.configuration]]
    region = "AS923"

# NEW (đúng)
[network]
  enabled_regions = ["as923"]
```

---

### 6. Gateway Bridge config dùng sai field names

**Triệu chứng:** Gateway Bridge không publish đúng topic template.

**Nguyên nhân:** Config dùng `event_topic` và `command_topic` nhưng Gateway Bridge v4 expect `event_topic_template` và `command_topic_template`.

**Fix:** Dùng đúng field names:
```toml
event_topic_template = "as923/gateway/{{ .GatewayID }}/event/{{ .EventType }}"
state_topic_template = "as923/gateway/{{ .GatewayID }}/state/{{ .StateType }}"
command_topic_template = "as923/gateway/{{ .GatewayID }}/command/#"
```

---

## Checklist triển khai nhanh

- [ ] Gắn antenna LoRa trước khi cấp nguồn
- [ ] Cắm gateway vào router (không cắm trực tiếp PC)
- [ ] Tìm IP gateway (scan hoặc DHCP lease)
- [ ] Cấu hình packet forwarder: server address, port 1700, region AS923
- [ ] Deploy docker-compose với cả ChirpStack + Gateway Bridge
- [ ] Config `chirpstack.toml` đúng format v4.17 (`[network]`, không phải `[network_server]`)
- [ ] Config `region_as923.toml` với `[regions.gateway.backend]` MQTT
- [ ] Config `gateway-bridge.toml` với `marshaler = "json"` và topic prefix `as923/`
- [ ] Mở firewall UDP 1700 (nếu cần)
- [ ] Đăng ký gateway trên ChirpStack web UI
- [ ] Verify `last_seen_at` update trong database

---

## Debug commands

```bash
# Gateway connectivity
ping <gateway-ip>
curl http://<gateway-ip>

# Docker container status
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# ChirpStack gateway status
docker exec sf-postgres psql -U chirpstack -d chirpstack \
  -c "SELECT gateway_id, name, last_seen_at FROM gateway;"

# MQTT traffic
docker exec sf-mosquitto mosquitto_sub -h localhost -t "as923/#" -v

# UDP listener test
docker exec sf-gateway-bridge sh -c "netstat -tuln | grep 1700"

# Gateway Bridge logs
docker logs sf-gateway-bridge --tail 20

# ChirpStack logs
docker logs sf-chirpstack --tail 20
```

---

## References

- [ChirpStack v4 Documentation](https://www.chirpstack.io/docs/)
- [ChirpStack Gateway Bridge](https://www.chirpstack.io/gateway-bridge/)
- [E870-L915LG12 Datasheet](https://www.ebyte.com/downpdf/1845.html)
- [LoRaWAN Regional Parameters - AS923](https://resources.lora-alliance.org/technical-specifications/rp2-1-0-3-lorawan-regional-parameters)
