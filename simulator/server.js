// SmartFarm DakLak - Dynamic Digital Twin Simulator
// Physics-based soil model, diurnal cycles, fault injection, scenario engine

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const path = require('path');

const env = require('./lib/environment');
const soil = require('./lib/soil');
const { FaultInjector, FAULT_SCENARIOS } = require('./lib/faults');
const { SCENARIOS } = require('./lib/scenarios');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Config ───────────────────────────────────────────
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const APP_ID = 'smartfarm-daklak';
const DEV_EUI = 'aabbccdd11223344';
const MAX_EVENTS = 200;
const MAX_HISTORY = 120;

// ─── Simulation State ─────────────────────────────────
const faultInjector = new FaultInjector();

let simState = {
  // Sensor data (current)
  data: {
    temperature: 27.5, moisture: 55, ec: 450, salinity: 220,
    nitrogen: 120, phosphorus: 35, potassium: 180, ph: 5.8
  },
  // Environment
  env: {
    airTemperature: 30, humidity: 70, rainfall: 0,
    windSpeed: 8, solarRadiation: 400, et0: 0
  },
  // Config
  config: {
    autoMode: false,
    intervalSec: 30,
    scenario: 'normal',
    variation: 2.0,
    usePhysics: true,        // Enable physics-based simulation
    timeAcceleration: 1      // 1x = real time
  },
  // Scenario state
  scenario: {
    active: null,            // scenario key
    phaseIndex: 0,
    phaseTick: 0,
    totalTicks: 0,
    loop: false
  },
  // Actuator feedback (from smart-control via MQTT or API)
  actuators: {
    irrigation: false,       // any zone irrigating
    cooling: false           // spraying/cooling system
  },
  // Statistics
  stats: {
    totalSent: 0,
    totalTicks: 0,
    startTime: Date.now(),
    physicsEnabled: true
  }
};

let events = [];
let tickTimer = null;
let mqttClient = null;
let mqttConnected = false;

// ─── Presets (initial values for scenarios) ────────────
const PRESETS = {
  normal: {
    name: '☕ Đất cà phê DakLak - Bình thường',
    desc: 'Đất bazan đỏ, pH 5.5-6.5, giàu hữu cơ',
    values: { temperature: 27.5, moisture: 55, ec: 450, salinity: 220, nitrogen: 120, phosphorus: 35, potassium: 180, ph: 5.8 }
  },
  drought: {
    name: '☀️ Hạn hán - Thiếu nước',
    desc: 'Mùa khô DakLak (tháng 11-3), đất khô nứt',
    values: { temperature: 38, moisture: 12, ec: 2800, salinity: 1400, nitrogen: 80, phosphorus: 20, potassium: 90, ph: 6.8 }
  },
  flooding: {
    name: '🌧️ Ngập úng - Mưa nhiều',
    desc: 'Mùa mưa DakLak (tháng 5-10), đất ngập nước',
    values: { temperature: 24, moisture: 92, ec: 180, salinity: 80, nitrogen: 45, phosphorus: 15, potassium: 60, ph: 4.2 }
  },
  nutrient_deficient: {
    name: '🍂 Thiếu dinh dưỡng',
    desc: 'Đất bạc màu, NPK thấp, cần bón phân',
    values: { temperature: 28, moisture: 40, ec: 150, salinity: 70, nitrogen: 25, phosphorus: 8, potassium: 40, ph: 5.0 }
  },
  saline: {
    name: '🧂 Đất nhiễm mặn',
    desc: 'Khu vực gần biển hoặc tưới nước mặn',
    values: { temperature: 30, moisture: 45, ec: 4200, salinity: 2100, nitrogen: 60, phosphorus: 12, potassium: 50, ph: 8.2 }
  },
  acidic: {
    name: '⚗️ Đất chua (pH thấp)',
    desc: 'Đất bazan chua tự nhiên, cần bón vôi',
    values: { temperature: 26, moisture: 60, ec: 380, salinity: 190, nitrogen: 90, phosphorus: 28, potassium: 140, ph: 3.8 }
  }
};

// ─── Physics-Based Tick ───────────────────────────────
function physicsTick() {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const month = now.getMonth() + 1;

  // ── Update environment ──
  const airTemp = env.getDiurnalTemperature(hour, month);
  const solar = env.getSolarRadiation(hour);
  const wind = env.getWindSpeed(hour, month);
  const humidity = env.getDiurnalHumidity(hour, month, simState.env.rainfall);

  // Rain model
  const rainProb = env.getRainfallProbability(hour, month);
  const rainfall = env.generateRainfall(rainProb);

  // ET₀ calculation
  const et0 = env.getET0(airTemp, humidity, wind, solar);

  simState.env = { airTemperature: airTemp, humidity, rainfall, windSpeed: wind, solarRadiation: solar, et0 };

  // ── Irrigation effect ──
  let irrigationMm = 0;
  if (simState.actuators.irrigation) {
    irrigationMm = 8; // ~8mm per tick when irrigating (typical drip rate)
  }

  // ── Cooling effect ──
  let coolingDelta = 0;
  if (simState.actuators.cooling) {
    coolingDelta = -3; // spraying system drops temp ~3°C
  }

  // ── Update soil moisture (water balance) ──
  const moistResult = soil.updateSoilMoisture(
    simState.data.moisture, rainfall, irrigationMm,
    et0, airTemp, 'bazan-red', simState.config.intervalSec / 3600
  );
  simState.data.moisture = moistResult.newMoisture;

  // ── Update soil temperature ──
  simState.data.temperature = soil.updateSoilTemperature(
    airTemp + coolingDelta, simState.data.temperature, 10,
    simState.config.intervalSec / 3600
  );

  // ── Update EC ──
  simState.data.ec = soil.updateEC(
    simState.data.ec, simState.data.moisture, rainfall, irrigationMm, 450
  );

  // ── Update pH ──
  simState.data.ph = soil.updatePH(simState.data.ph, rainfall, 5.8);

  // ── Update NPK ──
  simState.data.nitrogen = soil.updateNPK(simState.data.nitrogen, rainfall, irrigationMm, 0.3, 120);
  simState.data.phosphorus = soil.updateNPK(simState.data.phosphorus, rainfall, irrigationMm, 0.1, 35);
  simState.data.potassium = soil.updateNPK(simState.data.potassium, rainfall, irrigationMm, 0.2, 180);

  // ── Salinity tracks EC ──
  simState.data.salinity = Math.round(simState.data.ec * 0.5);
}

// ─── Scenario Tick ────────────────────────────────────
function scenarioTick() {
  const sc = simState.scenario;
  if (!sc.active) return;

  const scenario = SCENARIOS[sc.active];
  if (!scenario) {
    stopScenario();
    return;
  }

  const phase = scenario.phases[sc.phaseIndex];
  if (!phase) {
    if (scenario.loop) {
      sc.phaseIndex = 0;
      sc.phaseTick = 0;
      return;
    }
    addEvent('info', `✅ Scenario "${scenario.name}" completed`);
    stopScenario();
    return;
  }

  // Apply phase overrides
  if (phase.setWeather) {
    Object.assign(simState.env, phase.setWeather);
  }
  if (phase.setSoil) {
    Object.assign(simState.data, phase.setSoil);
  }

  // Apply fault if specified
  if (phase.applyFault && sc.phaseTick === 0) {
    const faultDef = FAULT_SCENARIOS[phase.applyFault];
    if (faultDef) {
      faultDef.faults.forEach(f => faultInjector.addFault({ ...f, durationTicks: phase.durationTicks }));
      addEvent('warning', `🔧 Fault activated: ${faultDef.name}`);
    }
  }

  // Log phase transition
  if (sc.phaseTick === 0) {
    addEvent('info', `📍 Phase: ${phase.name} — ${phase.notes || ''}`);
  }

  sc.phaseTick++;
  if (sc.phaseTick >= phase.durationTicks) {
    sc.phaseIndex++;
    sc.phaseTick = 0;
  }

  sc.totalTicks++;
}

// ─── Main Simulation Tick ─────────────────────────────
function tick() {
  // 1. Run scenario if active
  scenarioTick();

  // 2. Run physics engine (if enabled)
  if (simState.config.usePhysics) {
    physicsTick();
  }

  // 3. Apply variation/noise
  applyVariation();

  // 4. Apply fault injection
  const faultResult = faultInjector.processTick({ ...simState.data });

  // 5. Check events
  checkEvents();

  // 6. Publish (if not blocked by fault)
  if (faultResult.shouldPublish) {
    publishSensorData(faultResult.modifiedData);
  } else {
    // Still emit to web clients even if MQTT blocked
    io.emit('sensor_update', {
      data: faultResult.modifiedData,
      timestamp: new Date().toISOString(),
      sent: simState.stats.totalSent,
      mqttConnected,
      fault: true
    });
  }

  simState.stats.totalTicks++;

  // Emit environment data
  io.emit('env_update', simState.env);
  io.emit('scenario_status', getScenarioStatus());
  io.emit('fault_status', { active: faultInjector.listFaults(), stats: faultInjector.getStats() });
}

function applyVariation() {
  const v = simState.config.variation / 100;
  const d = simState.data;
  d.temperature += (Math.random() - 0.5) * 2 * v * 2;
  d.moisture += (Math.random() - 0.5) * 2 * v * 1;
  d.ec += (Math.random() - 0.5) * 2 * v * 20;
  d.salinity += (Math.random() - 0.5) * 2 * v * 10;
  d.nitrogen += (Math.random() - 0.5) * 2 * v * 5;
  d.phosphorus += (Math.random() - 0.5) * 2 * v * 2;
  d.potassium += (Math.random() - 0.5) * 2 * v * 5;
  d.ph += (Math.random() - 0.5) * 2 * v * 0.1;

  // Clamp
  const ranges = { temperature: [-10, 60], moisture: [0, 100], ec: [0, 10000], salinity: [0, 5000], nitrogen: [0, 500], phosphorus: [0, 200], potassium: [0, 500], ph: [0, 14] };
  for (const [k, [min, max]] of Object.entries(ranges)) {
    d[k] = Math.max(min, Math.min(max, d[k]));
  }
}

// ─── MQTT ─────────────────────────────────────────────
function connectMQTT() {
  if (mqttClient) { mqttClient.removeAllListeners(); mqttClient.end(true); }

  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: 'smartfarm-simulator-' + Math.random().toString(16).slice(2, 8),
    clean: true, connectTimeout: 3000, reconnectPeriod: 5000, keepalive: 60
  });

  mqttClient.on('connect', () => {
    mqttConnected = true;
    // Subscribe to actuator commands for feedback loop
    mqttClient.subscribe(`application/${APP_ID}/device/actuator/+/command`);
    io.emit('mqtt_status', { connected: true });
    addEvent('info', 'MQTT connected');
  });

  mqttClient.on('message', (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      // Detect irrigation ON
      if (payload.type === 'valve' && payload.action === 'open') {
        simState.actuators.irrigation = true;
        addEvent('info', `💧 Irrigation detected: ${payload.actuatorId} opened`);
      }
      if (payload.type === 'valve' && payload.action === 'closed') {
        // Check if any valve is still open — simplified
        simState.actuators.irrigation = false;
        addEvent('info', `💧 Irrigation stopped: ${payload.actuatorId} closed`);
      }
    } catch {}
  });

  mqttClient.on('error', () => { mqttConnected = false; });
  mqttClient.on('close', () => { mqttConnected = false; });
  mqttClient.on('reconnect', () => {});
}

function publishSensorData(data) {
  const d = data || simState.data;
  const topic = `application/${APP_ID}/device/${DEV_EUI}/event/up`;

  const payload = {
    applicationId: APP_ID, applicationName: 'SmartFarm',
    deviceName: 'soil-sensor-01', devEUI: DEV_EUI,
    fCnt: simState.stats.totalSent, fPort: 2, data: '',
    object: {
      temperature: Math.round(d.temperature * 10) / 10,
      moisture: Math.round(d.moisture * 10) / 10,
      ec: Math.round(d.ec), salinity: Math.round(d.salinity),
      nitrogen: Math.round(d.nitrogen), phosphorus: Math.round(d.phosphorus),
      potassium: Math.round(d.potassium), ph: Math.round(d.ph * 10) / 10
    },
    rxInfo: [{ gatewayID: 'e870-gateway-01', rssi: -65 - Math.floor(Math.random() * 20), loRaSNR: 7.5 + Math.random() * 3 }],
    txInfo: { frequency: 923200000, dr: 2 },
    time: new Date().toISOString()
  };

  if (mqttClient && mqttConnected) {
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 0 });
    simState.stats.totalSent++;
  }

  io.emit('sensor_update', {
    data: { ...d }, timestamp: new Date().toISOString(),
    sent: simState.stats.totalSent, mqttConnected
  });
}

// ─── Events ───────────────────────────────────────────
function checkEvents() {
  const d = simState.data;
  if (d.moisture < 20) addEvent('critical', `💧 Độ ẩm đất thấp: ${d.moisture.toFixed(1)}%`);
  if (d.moisture > 85) addEvent('warning', `💧 Độ ẩm đất cao: ${d.moisture.toFixed(1)}%`);
  if (d.temperature > 40) addEvent('warning', `🌡️ Nhiệt độ đất cao: ${d.temperature.toFixed(1)}°C`);
  if (d.temperature < 10) addEvent('warning', `🌡️ Nhiệt độ đất thấp: ${d.temperature.toFixed(1)}°C`);
  if (d.ph < 4.5) addEvent('warning', `🧪 pH đất chua: ${d.ph.toFixed(1)}`);
  if (d.ph > 8.0) addEvent('warning', `🧪 pH đất kiềm: ${d.ph.toFixed(1)}`);
  if (d.ec > 3000) addEvent('critical', `⚡ EC cao: ${d.ec} µS/cm — Đất nhiễm mặn!`);
  if (d.nitrogen < 50) addEvent('info', `🌿 Nitrogen thấp: ${d.nitrogen} mg/kg`);
  if (d.potassium < 80) addEvent('info', `🌿 Kali thấp: ${d.potassium} mg/kg`);
}

function addEvent(level, message) {
  const evt = { level, message, time: new Date().toISOString() };
  events.unshift(evt);
  if (events.length > MAX_EVENTS) events.pop();
  io.emit('event', evt);
}

// ─── Scenario Management ──────────────────────────────
function startScenario(scenarioKey) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) return false;

  stopScenario();
  simState.scenario.active = scenarioKey;
  simState.scenario.phaseIndex = 0;
  simState.scenario.phaseTick = 0;
  simState.scenario.totalTicks = 0;
  simState.scenario.loop = scenario.loop || false;
  simState.config.scenario = scenarioKey;

  if (scenario.timeAcceleration) {
    simState.config.timeAcceleration = scenario.timeAcceleration;
    // Adjust tick interval: faster ticks for accelerated scenarios
    const baseInterval = simState.config.intervalSec * 1000;
    const newInterval = Math.max(100, baseInterval / scenario.timeAcceleration);
    restartTickTimer(newInterval);
  }

  addEvent('info', `🎬 Scenario started: ${scenario.name}`);
  io.emit('config_update', simState.config);
  return true;
}

function stopScenario() {
  simState.scenario.active = null;
  simState.scenario.phaseIndex = 0;
  simState.scenario.phaseTick = 0;
  simState.config.scenario = 'normal';
  simState.config.timeAcceleration = 1;

  faultInjector.clearAll();
  restartTickTimer(simState.config.intervalSec * 1000);
  io.emit('config_update', simState.config);
}

function getScenarioStatus() {
  const sc = simState.scenario;
  const scenario = sc.active ? SCENARIOS[sc.active] : null;
  return {
    active: sc.active,
    name: scenario?.name || null,
    phaseIndex: sc.phaseIndex,
    phaseName: scenario?.phases[sc.phaseIndex]?.name || null,
    phaseTick: sc.phaseTick,
    phaseDuration: scenario?.phases[sc.phaseIndex]?.durationTicks || 0,
    totalTicks: sc.totalTicks,
    loop: sc.loop
  };
}

// ─── Tick Timer ───────────────────────────────────────
function restartTickTimer(intervalMs) {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(tick, intervalMs);
}

function startAutoMode() {
  simState.config.autoMode = true;
  restartTickTimer(simState.config.intervalSec * 1000);
  tick(); // immediate first tick
  addEvent('info', `▶ Auto mode started: mỗi ${simState.config.intervalSec}s`);
}

function stopAutoMode() {
  simState.config.autoMode = false;
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  addEvent('info', '⏸ Auto mode stopped');
}

// ─── WebSocket ────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('init', {
    data: { ...simState.data },
    config: { ...simState.config },
    env: { ...simState.env },
    events: events.slice(0, 50),
    presets: Object.entries(PRESETS).map(([k, v]) => ({ key: k, ...v })),
    mqttConnected,
    totalSent: simState.stats.totalSent,
    scenario: getScenarioStatus(),
    faults: faultInjector.listFaults(),
    faultStats: faultInjector.getStats()
  });

  socket.on('update_param', ({ param, value }) => {
    if (!simState.data.hasOwnProperty(param)) return;
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return;
    simState.data[param] = num;
    io.emit('sensor_update', { data: { ...simState.data }, timestamp: new Date().toISOString(), sent: simState.stats.totalSent, mqttConnected });
  });

  socket.on('apply_preset', (presetKey) => {
    const preset = PRESETS[presetKey];
    if (preset) {
      Object.assign(simState.data, { ...preset.values });
      simState.config.scenario = presetKey;
      io.emit('sensor_update', { data: { ...simState.data }, timestamp: new Date().toISOString(), sent: simState.stats.totalSent, mqttConnected });
      io.emit('config_update', simState.config);
      addEvent('info', `📋 Applied preset: ${preset.name}`);
    }
  });

  socket.on('set_auto', (enabled) => {
    if (enabled) startAutoMode(); else stopAutoMode();
    io.emit('config_update', simState.config);
  });

  socket.on('set_interval', (sec) => {
    const val = parseInt(sec);
    if (!Number.isFinite(val)) return;
    simState.config.intervalSec = Math.max(1, Math.min(300, val));
    if (simState.config.autoMode) restartTickTimer(simState.config.intervalSec * 1000);
    io.emit('config_update', simState.config);
  });

  socket.on('set_variation', (v) => {
    const val = parseFloat(v);
    if (!Number.isFinite(val)) return;
    simState.config.variation = Math.max(0, Math.min(20, val));
    io.emit('config_update', simState.config);
  });

  socket.on('set_physics', (enabled) => {
    simState.config.usePhysics = !!enabled;
    simState.stats.physicsEnabled = simState.config.usePhysics;
    addEvent('info', `🔧 Physics engine: ${enabled ? 'ON' : 'OFF'}`);
    io.emit('config_update', simState.config);
  });

  socket.on('send_once', () => { tick(); });

  // Scenario controls
  socket.on('start_scenario', (scenarioKey) => {
    const ok = startScenario(scenarioKey);
    if (!ok) socket.emit('error', { message: `Unknown scenario: ${scenarioKey}` });
  });

  socket.on('stop_scenario', () => { stopScenario(); });

  // Fault controls
  socket.on('inject_fault', ({ type, durationTicks, params }) => {
    const id = faultInjector.addFault({ type, params: params || {}, durationTicks: durationTicks || 30 });
    addEvent('warning', `🔧 Fault injected: ${type} (${id})`);
    socket.emit('fault_injected', { id, type });
  });

  socket.on('clear_faults', () => {
    faultInjector.clearAll();
    addEvent('info', '🔧 All faults cleared');
  });

  // Actuator feedback (manual override from simulator UI)
  socket.on('set_actuator', ({ key, value }) => {
    if (simState.actuators.hasOwnProperty(key)) {
      simState.actuators[key] = !!value;
      addEvent('info', `⚙️ Actuator ${key}: ${value ? 'ON' : 'OFF'}`);
    }
  });
});

// ─── REST API ─────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    mqttConnected, totalSent: simState.stats.totalSent,
    config: simState.config, data: simState.data, env: simState.env,
    uptime: process.uptime(), totalTicks: simState.stats.totalTicks,
    scenario: getScenarioStatus(), faults: faultInjector.getStats()
  });
});

app.get('/api/scenarios', (req, res) => {
  const list = {};
  for (const [k, v] of Object.entries(SCENARIOS)) {
    list[k] = { name: v.name, description: v.description, phases: v.phases?.length, timeAcceleration: v.timeAcceleration, loop: v.loop };
  }
  res.json({ scenarios: list, active: simState.scenario.active });
});

app.post('/api/scenario/start', (req, res) => {
  const { scenario } = req.body || {};
  if (!scenario || !SCENARIOS[scenario]) return res.status(400).json({ error: 'Unknown scenario' });
  const ok = startScenario(scenario);
  res.json({ ok, scenario, timeAcceleration: SCENARIOS[scenario].timeAcceleration });
});

app.post('/api/scenario/stop', (req, res) => {
  stopScenario();
  res.json({ ok: true, message: 'Scenario stopped' });
});

app.get('/api/faults', (req, res) => {
  res.json({ faultScenarios: FAULT_SCENARIOS, activeFaults: faultInjector.listFaults() });
});

app.post('/api/fault/inject', (req, res) => {
  const { type, durationTicks, params } = req.body || {};
  if (!type) return res.status(400).json({ error: 'Missing fault type' });
  const id = faultInjector.addFault({ type, params: params || {}, durationTicks: durationTicks || 30 });
  addEvent('warning', `🔧 Fault injected: ${type}`);
  res.json({ ok: true, faultId: id, type });
});

app.post('/api/fault/clear', (req, res) => {
  faultInjector.clearAll();
  res.json({ ok: true });
});

app.post('/api/preset', (req, res) => {
  const { preset } = req.body || {};
  if (!preset || !PRESETS[preset]) return res.status(400).json({ error: 'Unknown preset' });
  Object.assign(simState.data, PRESETS[preset].values);
  simState.config.scenario = preset;
  res.json({ ok: true, data: simState.data });
});

app.post('/api/auto', (req, res) => {
  const { enabled } = req.body || {};
  if (enabled) startAutoMode(); else stopAutoMode();
  res.json({ ok: true, autoMode: simState.config.autoMode });
});

app.post('/api/publish', (req, res) => {
  const body = req.body || {};
  Object.keys(body).forEach(k => {
    if (simState.data.hasOwnProperty(k)) simState.data[k] = parseFloat(body[k]) || simState.data[k];
  });
  tick();
  res.json({ ok: true, sent: simState.stats.totalSent, data: simState.data });
});

app.post('/api/actuator', (req, res) => {
  const { key, value } = req.body || {};
  if (simState.actuators.hasOwnProperty(key)) {
    simState.actuators[key] = !!value;
    res.json({ ok: true, actuators: simState.actuators });
  } else {
    res.status(400).json({ error: 'Unknown actuator key' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', mqtt: mqttConnected, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─── Graceful Shutdown ────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);
  stopAutoMode();
  if (mqttClient) mqttClient.end(true);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => { console.error('[FATAL]', err); gracefulShutdown('uncaughtException'); });
process.on('unhandledRejection', (r) => console.error('[WARN]', r));

// ─── Start ────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🌱 SmartFarm DakLak — Digital Twin Simulator`);
  console.log(`   Web UI:       http://localhost:${PORT}`);
  console.log(`   MQTT:         ${MQTT_URL}`);
  console.log(`   Physics:      ${simState.config.usePhysics ? 'ON' : 'OFF'}`);
  console.log(`   Scenarios:    ${Object.keys(SCENARIOS).length} available`);
  console.log(`   Fault types:  ${Object.keys(FAULT_SCENARIOS).length} available`);
  console.log(`   CLI:          node cli.js help\n`);
  connectMQTT();
});
