# 📱 BÁO CÁO PHÂN TÍCH CODEBASE — SMARTFARM DAKLAK
## Đánh giá khả năng viết App Mobile Android/iOS
### Ngày: 20/06/2026

---

## 1. TỔNG QUAN KIẾN TRÚC

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express + Socket.IO |
| Database | InfluxDB 2.7 (time-series) |
| MQTT | Mosquitto 2 (LoRaWAN data) |
| LoRaWAN | ChirpStack v4 + Gateway E870 |
| Dashboard | Grafana + Custom Web UI |
| Simulator | Physics-based Digital Twin |
| Auth | JWT + bcryptjs |
| Scheduler | node-cron |

### Architecture Layers
```
┌─────────────────────────────────────────────────────────┐
│                    SENSOR LAYER                          │
│  Soil Sensor (RS485/Modbus) → E870 Gateway (LoRaWAN)   │
└──────────────────────┬──────────────────────────────────┘
                       │ LoRaWAN AS923
┌──────────────────────▼──────────────────────────────────┐
│                  PROCESSING LAYER                        │
│  ChirpStack v4 → MQTT → Node-RED → InfluxDB            │
└──────────────────────┬──────────────────────────────────┘
                       │ MQTT (decoded JSON)
┌──────────────────────▼──────────────────────────────────┐
│                 APPLICATION LAYER                        │
│  Smart Control (server.js:3002)                         │
│  ├── REST API (Express)                                 │
│  ├── WebSocket (Socket.IO)                              │
│  ├── Predictive Irrigation Engine                       │
│  ├── Auto Irrigation Logic                              │
│  ├── Crop Advisory (6 stages coffee)                    │
│  └── Weather Integration (Open-Meteo)                   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                    CLIENT LAYER                          │
│  Web Dashboard (localhost:3002)                         │
│  Grafana (localhost:3005)                               │
│  Simulator (localhost:3001)                             │
│  [MOBILE APP — Future]                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. REST API ENDPOINTS

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | No | Login → JWT token |
| GET | `/api/auth/me` | Yes | Current user info |

### Zones & Sensors
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/zones` | Yes | All zones + sensor data + rules + stage |
| GET | `/api/actuators` | Yes | All pumps/valves + state |
| GET | `/api/weather` | Yes | Current weather + 3-day forecast |

### Control
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/control` | admin/operator | Control actuator `{actuatorId, action}` |
| GET | `/api/advisory/:zoneId` | Yes | AI advisory for zone |
| GET | `/api/crop-stages` | Yes | Knowledge base Robusta/Arabica |

### Predictive Irrigation
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/predictive/:zoneId` | Yes | Irrigation recommendation |
| GET | `/api/predictive` | Yes | All zones recommendations |
| GET | `/api/predictive/:zoneId/balance` | Yes | Water balance state |
| GET | `/api/predictive/:zoneId/history` | Yes | Balance history (hours param) |

### Schedule & Export
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/schedule` | Yes | Multi-zone irrigation schedule |
| GET | `/api/schedule/history` | Yes | Schedule history (days param) |
| GET | `/api/export/sensors` | Yes | Export JSON/CSV (from, to, format) |
| GET | `/api/export/audit` | Yes | Export audit log JSON/CSV |

### System
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/system` | Yes | System status (memory, CPU, MQTT, InfluxDB) |
| POST | `/api/weather/refresh` | admin/operator | Force weather refresh |

### Example Responses

**GET /api/zones:**
```json
[
  {
    "id": "zone-A",
    "name": "Khu A — Ca phe Robusta",
    "area": 5000,
    "crop": "robusta",
    "plantDate": "2024-04-15",
    "soilType": "bazan-red",
    "pumpId": "pump-1",
    "valveId": "valve-1",
    "location": { "lat": 12.75, "lng": 108.35 },
    "sensor": {
      "temperature": 27.5,
      "moisture": 55,
      "ec": 450,
      "salinity": 220,
      "nitrogen": 120,
      "phosphorus": 35,
      "potassium": 180,
      "ph": 5.8,
      "lastUpdate": "2026-06-20T10:00:00.000Z"
    },
    "rule": {
      "enabled": true,
      "moistureMin": 35,
      "moistureMax": 65,
      "maxDurationMin": 30,
      "cooldownMin": 120,
      "rainPause": true,
      "rainThreshold": 5
    },
    "stage": {
      "id": "fruit-growth",
      "name": "Phat trien qua",
      "months": [5, 6, 7, 8]
    },
    "plantAge": { "months": 26, "years": 2 }
  }
]
```

---

## 3. SOCKET.IO EVENTS

### Server → Client (Real-time updates)
| Event | Data | Description |
|-------|------|-------------|
| `init` | Full state object | On connect: zones, actuators, sensorData, rules, weather, cropStages, controlHistory, mqttConnected |
| `zone_sensor` | `{zoneId, data}` | Real-time sensor update per zone |
| `actuator_update` | `{id, state, autoMode, lastChange}` | Actuator state change |
| `control_log` | `{level, message, time}` | Control event log |
| `control_event` | `{type, zone, moisture, threshold, time}` | Auto irrigation events |
| `weather_update` | Weather data object | Weather refresh |
| `advisory` | `{zoneId, advices[], urgency, stage}` | AI advisory per zone |
| `mqtt_status` | `{connected}` | MQTT connection status |
| `rule_update` | `{zoneId, rule}` | Irrigation rule change |
| `predictive_update` | `{zoneId, ET0, Kc, ETc, ...}` | Predictive irrigation update |
| `config_update` | Config object | Simulator config change |
| `event` | `{level, message, time}` | Simulator events |

### Client → Server (Commands)
| Event | Data | Description |
|-------|------|-------------|
| `control` | `{actuatorId, action}` | Control actuator (on/off/open/close) |
| `set_auto_mode` | `{zoneId, enabled}` | Toggle auto irrigation |
| `update_rule` | `{zoneId, rule}` | Update irrigation rules |
| `request_advisory` | `{zoneId}` | Request advisory for zone |
| `refresh_weather` | — | Force weather refresh |

---

## 4. AUTH FLOW

```
1. POST /api/auth/login
   Request:  { username: "admin", password: "admin123" }
   Response: { token: "eyJhbG...", user: { username: "admin", role: "admin" }, expiresIn: "24h" }

2. GET /api/zones (with auth)
   Header:   Authorization: Bearer eyJhbG...
   Response: [ ...zones with sensor data... ]

3. Role-based access:
   - admin:    full access (control, config)
   - operator: control access (no config)
   - viewer:   read-only
```

---

## 5. DATA MODEL

### Zone
```json
{
  "id": "zone-A",
  "name": "Khu A — Ca phe Robusta",
  "area": 5000,
  "crop": "robusta",           // or "arabica"
  "plantDate": "2024-04-15",
  "soilType": "bazan-red",
  "pumpId": "pump-1",
  "valveId": "valve-1",
  "moistureSensor": "aabbccdd11223344",  // DevEUI
  "location": { "lat": 12.75, "lng": 108.35 }
}
```

### Sensor Data (8 parameters)
```json
{
  "temperature": 27.5,   // °C (-10 to 60)
  "moisture": 55,        // %VWC (0-100)
  "ec": 450,             // µS/cm (0-10000)
  "salinity": 220,       // ppm (0-5000)
  "nitrogen": 120,       // mg/kg (0-500)
  "phosphorus": 35,      // mg/kg (0-200)
  "potassium": 180,      // mg/kg (0-500)
  "ph": 5.8              // pH (0-14)
}
```

### Actuator
```json
{
  "id": "pump-1",
  "name": "Bom chinh #1",
  "type": "pump",         // or "valve"
  "state": "off",         // pump: on/off, valve: open/closed
  "autoMode": false,
  "lastChange": null,
  "flowRate": 50
}
```

### Irrigation Rule
```json
{
  "enabled": true,
  "moistureMin": 35,
  "moistureMax": 65,
  "maxDurationMin": 30,
  "cooldownMin": 120,
  "rainPause": true,
  "rainThreshold": 5
}
```

### Crop Stages (Robusta example)
| Stage | Months | Irrigation Target | Fertilization |
|-------|--------|-------------------|---------------|
| Dormant | 11-1 | 30% | Phan chuong + voi |
| Flowering | 2-3 | 55% | NPK 16-16-8, P cao |
| Fruit-set | 3-5 | 60% | NPK 20-10-10 + Bo, Zn |
| Fruit-growth | 5-8 | 55% | NPK 10-5-20, K cao |
| Ripening | 9-10 | 40% | Kali nhe |
| Harvest | 10-11 | 35% | NPK can bang |

---

## 6. DOMAIN LOGIC

### Predictive Irrigation Engine
- **ET0 Calculation**: Penman-Monteith simplified (temperature, humidity, wind, cloud cover, altitude)
- **Crop Coefficient (Kc)**: Per stage per crop (Robusta/Arabica)
- **Water Balance**: Field capacity, wilting point, root depth
- **24h Prediction**: Predict moisture in 24h with forecast rain
- **Decision**: none → soon → needed → critical
- **Rain Delay**: If forecast rain > threshold, delay irrigation

### Auto Irrigation Logic
- Check every 1 minute (cron)
- Moisture < min → open valve + pump
- Moisture >= max → close valve + pump
- Rain pause (rainfall > threshold)
- Cooldown between irrigations
- Max duration timeout

### Weather Integration
- **API**: Open-Meteo (free, no key needed)
- **Coordinates**: Lat 12.75, Lon 108.35 (Dak Lak)
- **Cache**: 30 minutes
- **Fallback**: Simulated weather based on seasonal patterns
- **Data**: temperature, humidity, rainfall, windSpeed, cloudCover, 3-day forecast

---

## 7. MOBILE APP READINESS ASSESSMENT

| Criteria | Score | Notes |
|----------|-------|-------|
| API Readiness | 8/10 | REST + Socket.IO, missing: registration, push endpoint |
| Auth Flow | 7/10 | JWT OK, missing: refresh token, password change |
| Real-time | 9/10 | Socket.IO events rich, sensor + advisory real-time |
| Offline Support | 3/10 | No offline mode, no local cache — build from scratch |
| Push Notifications | 2/10 | No push — need FCM/APNs integration |
| Data Model | 9/10 | Well-structured, 8 sensor params, crop stages |
| Documentation | 7/10 | README good, API implicit in code |

**Overall: 7.0/10 — VIẾT ĐƯỢC, cần bổ sung một số tính năng**

---

## 8. MVP FEATURES

### MUST HAVE (MVP)
1. **Dashboard** — Real-time sensor data (NPK, pH, EC, moisture, temp)
2. **Zone Map** — GPS map with zone locations
3. **Irrigation Control** — Remote pump/valve on/off
4. **Advisory** — AI recommendations per coffee growth stage
5. **Weather** — Current weather + 3-day forecast
6. **Notifications** — Alerts: low moisture, heavy rain, high EC

### NICE TO HAVE
7. **Charts** — Historical sensor data charts (InfluxDB)
8. **Auto Mode** — Toggle auto irrigation
9. **Crop Calendar** — Growth stage timeline
10. **Export** — CSV export

### FUTURE
11. **Multi-farm** — Multiple farm management
12. **Camera** — IP camera integration
13. **Chatbot** — AI advisor chat

---

## 9. RECOMMENDED ARCHITECTURE

### Framework: React Native + Expo
- Shared TypeScript with backend
- Expo OTA updates
- Large community, mature ecosystem

### State Management
- **Zustand**: Auth, settings (simple state)
- **React Query**: Server state (API calls, caching, sync)

### Navigation: React Navigation
- Tab 1: Dashboard (sensor data)
- Tab 2: Zones (map + list)
- Tab 3: Control (actuators)
- Tab 4: Advisory (AI recommendations)
- Tab 5: Settings

### API Layer
- **REST**: axios + React Query (polling 30s)
- **WebSocket**: socket.io-client (real-time sensor)
- **Auth**: SecureStore (Expo) for JWT token

### Background Services
- **expo-notifications**: Push notifications
- **expo-task-manager**: Background MQTT
- **expo-location**: GPS for zone map

---

## 10. EFFORT ESTIMATION

### MVP (10 features)
| Phase | Duration |
|-------|----------|
| UI/UX Design | 2 weeks |
| Core screens (5 tabs) | 4 weeks |
| API integration | 2 weeks |
| Real-time + Push | 2 weeks |
| Testing | 1 week |
| **Total** | **11 weeks (~3 months)** |
| **Team** | **2 React Native devs** |

### Full App (13 features)
| Phase | Duration |
|-------|----------|
| Everything above | 11 weeks |
| Multi-farm + Camera + Chatbot | 9 weeks |
| **Total** | **20 weeks (~5 months)** |
| **Team** | **2-3 devs** |

---

## 11. KEY FINDINGS

### Strengths for Mobile
- Full REST API with 15+ endpoints
- Socket.IO real-time for sensor data
- Rich domain logic (coffee stages, predictive irrigation)
- GPS coordinates in zone data
- Weather integration ready

### Gaps to Address
1. **Refresh Token** — Current JWT has no refresh mechanism
2. **Push Notifications** — Need FCM (Android) + APNs (iOS) setup
3. **Offline Mode** — No local caching, need SQLite/AsyncStorage
4. **User Registration** — Only hardcoded users, no self-registration
5. **Password Management** — No change/forgot password

### Recommendation
**Proceed with React Native + Expo MVP.** The backend is well-structured and ready. Focus on:
1. Add refresh token to API
2. Add push notification endpoint
3. Build mobile app with 6 MVP features
4. Deploy pilot at Dak Lak farm

---

*Report generated by Senior Dev Team — 20/06/2026*
