const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const path = require('path');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const helmet = require('helmet');
const influx = require('./lib/influx');
const { PredictiveIrrigation } = require('./lib/predictive-irrigation');
const { getWeather, refreshWeather, getCachedWeather, getSimulatedWeather } = require('./lib/weather');
const scheduler = require('./lib/scheduler');
const auditModule = require('./lib/audit');
const alertsModule = require('./lib/alerts');
const { apiLimiter, authLimiter, controlLimiter, exportLimiter } = require('./lib/rate-limiter');
const { CROP_STAGES, getCurrentStage } = require('./lib/crop-data');
const logger = require('./lib/logger');
const metrics = require('./lib/metrics');

const app = express();
const server = http.createServer(app);
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3002'];

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true }
});

io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
        return next(new Error('Authentication required'));
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.user = decoded;
        next();
    } catch (err) {
        next(new Error('Invalid token'));
    }
});

app.use(helmet({
  contentSecurityPolicy: {
      directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'", "ws:", "wss:"]
      }
  },
  crossOriginEmbedderPolicy: false
}));

const timeout = require('connect-timeout');
app.use(timeout('30s'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(logger.middleware);
app.use(metrics.middleware);

app.get('/metrics', authenticateTokenMiddleware, async (req, res) => {
  await metrics.metricsEndpoint(req, res);
});

const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const APP_ID = 'smartfarm-daklak';
const MQTT_RECONNECT_INTERVAL = 5000;
const MAX_CONTROL_HISTORY = 200;
const MAX_ADVISORY_HISTORY = 100;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET env var is required. Generate with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
}
const JWT_EXPIRY = '24h';

function loadJSON(relPath, fallback) {
  const fullPath = path.join(__dirname, relPath);
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    logger.info('config', `Loaded ${relPath}`);
    return data;
  } catch (err) {
    logger.warn('config', `Failed to load ${relPath}: ${err.message}, using fallback`);
    return fallback;
  }
}

const ZONES = loadJSON('config/zones.json', []);

const actuators = loadJSON('config/actuators.json', {
  'pump-1': { id: 'pump-1', name: 'Bơm chính #1', type: 'pump', state: 'off', autoMode: false, lastChange: null, flowRate: 50 },
  'pump-2': { id: 'pump-2', name: 'Bơm chính #2', type: 'pump', state: 'off', autoMode: false, lastChange: null, flowRate: 30 },
  'valve-1': { id: 'valve-1', name: 'Van khu A', type: 'valve', state: 'closed', autoMode: false, lastChange: null, zone: 'zone-A' },
  'valve-2': { id: 'valve-2', name: 'Van khu B', type: 'valve', state: 'closed', autoMode: false, lastChange: null, zone: 'zone-B' },
  'valve-3': { id: 'valve-3', name: 'Van khu C', type: 'valve', state: 'closed', autoMode: false, lastChange: null, zone: 'zone-C' }
});

const irrigationRules = loadJSON('config/irrigation-rules.json', {
  'zone-A': { enabled: true, moistureMin: 35, moistureMax: 65, maxDurationMin: 30, cooldownMin: 120, rainPause: true, rainThreshold: 5, lastIrrigation: null },
  'zone-B': { enabled: true, moistureMin: 35, moistureMax: 65, maxDurationMin: 25, cooldownMin: 120, rainPause: true, rainThreshold: 5, lastIrrigation: null },
  'zone-C': { enabled: true, moistureMin: 40, moistureMax: 70, maxDurationMin: 20, cooldownMin: 90, rainPause: true, rainThreshold: 5, lastIrrigation: null }
});

const predictiveIrrigation = new PredictiveIrrigation({
  zones: ZONES,
  rules: irrigationRules,
  altitude: 500
});

const DEFAULT_ADMIN_PASS = process.env.ADMIN_PASSWORD;
const DEFAULT_OPERATOR_PASS = process.env.OPERATOR_PASSWORD;
const DEFAULT_VIEWER_PASS = process.env.VIEWER_PASSWORD;

const USERS = [
  { username: 'admin', passwordHash: DEFAULT_ADMIN_PASS ? bcrypt.hashSync(DEFAULT_ADMIN_PASS, 10) : '', role: 'admin' },
  { username: 'operator', passwordHash: DEFAULT_OPERATOR_PASS ? bcrypt.hashSync(DEFAULT_OPERATOR_PASS, 10) : '', role: 'operator' },
  { username: 'viewer', passwordHash: DEFAULT_VIEWER_PASS ? bcrypt.hashSync(DEFAULT_VIEWER_PASS, 10) : '', role: 'viewer' }
].filter(u => u.passwordHash);

function authenticateTokenMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  }
}

function authorizeMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }
    next();
  };
}

app.use('/api', apiLimiter);

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login') {
    return next();
  }
  authenticateTokenMiddleware(req, res, next);
});

const zoneSensorData = {};
ZONES.forEach(z => {
  zoneSensorData[z.id] = {
    temperature: 27.5, moisture: 55, ec: 450, salinity: 220,
    nitrogen: 120, phosphorus: 35, potassium: 180, ph: 5.8,
    lastUpdate: null
  };
});

let weatherData = {
  temperature: 30, humidity: 70, rainfall: 0, windSpeed: 8,
  cloudCover: 40, forecast: [], lastUpdate: null, source: 'simulated'
};

const controlHistory = [];
const advisoryHistory = [];
const activeIrrigationTimers = new Map();

function generateAdvisory(zone) {
  const sensor = zoneSensorData[zone.id];
  const stage = getCurrentStage(zone.crop);
  const age = getPlantAge(zone.plantDate);
  const rule = irrigationRules[zone.id];
  const advices = [];
  let urgency = 'info';

  if (!stage) {
    advices.push({ type: 'error', message: 'Không xác định được giai đoạn cây trồng' });
    return { advices, urgency, stage: null };
  }

  if (sensor.moisture < rule.moistureMin) {
    urgency = 'critical';
    advices.push({
      type: 'irrigation', icon: '💧',
      message: `Độ ẩm đất thấp (${sensor.moisture.toFixed(1)}% < ${rule.moistureMin}%). Cần tưới NGAY cho ${zone.name}.`,
      action: `Tưới ${stage.irrigation.frequency} — ${stage.irrigation.notes}`
    });
  } else if (sensor.moisture > rule.moistureMax) {
    urgency = 'warning';
    advices.push({
      type: 'drainage', icon: '🌊',
      message: `Độ ẩm đất cao (${sensor.moisture.toFixed(1)}% > ${rule.moistureMax}%). Kiểm tra thoát nước.`,
      action: 'Mở van thoát nước, kiểm tra hệ thống cống'
    });
  } else {
    advices.push({
      type: 'irrigation', icon: '✅',
      message: `Độ ẩm đất ổn định (${sensor.moisture.toFixed(1)}%). ${stage.irrigation.notes}`,
      action: `Duy trì tưới ${stage.irrigation.frequency}`
    });
  }

  const fert = stage.fertilization;
  const fertIssues = [];
  if (fert.N > 0 && sensor.nitrogen < fert.N * 1.5) fertIssues.push(`N thấp (${sensor.nitrogen}/${fert.N * 2} mg/kg)`);
  if (fert.P > 0 && sensor.phosphorus < fert.P * 1.5) fertIssues.push(`P thấp (${sensor.phosphorus}/${fert.P * 2} mg/kg)`);
  if (fert.K > 0 && sensor.potassium < fert.K * 1.5) fertIssues.push(`K thấp (${sensor.potassium}/${fert.K * 2} mg/kg)`);

  if (fertIssues.length > 0) {
    if (urgency === 'info') urgency = 'warning';
    advices.push({ type: 'fertilization', icon: '🌿', message: `Thiếu dinh dưỡng: ${fertIssues.join(', ')}`, action: fert.notes });
  } else if (fert.N > 0 || fert.P > 0 || fert.K > 0) {
    advices.push({ type: 'fertilization', icon: '✅', message: `Dinh dưỡng đầy đủ cho giai đoạn ${stage.name}`, action: fert.notes });
  }

  if (sensor.ph < 4.5) {
    urgency = 'warning';
    advices.push({ type: 'soil', icon: '⚗️', message: `Đất chua (pH ${sensor.ph.toFixed(1)}). Cà phê cần pH 5.0-6.5.`, action: 'Bón vôi bột (dolomite) 2-3 tấn/ha. Kiểm tra lại sau 2 tuần.' });
  } else if (sensor.ph > 7.0) {
    urgency = 'warning';
    advices.push({ type: 'soil', icon: '⚗️', message: `Đất kiềm (pH ${sensor.ph.toFixed(1)}). Cà phê cần pH 5.0-6.5.`, action: 'Bón lưu huỳnh (S) hoặc phân chua (ammonium sulfate).' });
  }

  if (sensor.ec > 2000) {
    urgency = 'critical';
    advices.push({ type: 'salinity', icon: '🧂', message: `EC cao (${sensor.ec} µS/cm) — đất nhiễm mặn!`, action: 'Tươi xả mặn (leaching), kiểm tra nguồn nước tưới.' });
  }

  if (sensor.temperature > 38) {
    if (urgency === 'info') urgency = 'warning';
    advices.push({ type: 'temperature', icon: '🌡️', message: `Nhiệt độ đất cao (${sensor.temperature.toFixed(1)}°C). Cây có thể bị stress nhiệt.`, action: 'Tươi làm mát, phủ rơm rạ che phủ gốc.' });
  }

  if (weatherData.rainfall > 20) {
    advices.push({ type: 'weather', icon: '🌧️', message: `Mưa lớn (${weatherData.rainfall}mm). Tạm dừng tưới.`, action: 'Kiểm tra thoát nước, gia cố bờ vùng.' });
  } else if (weatherData.temperature > 35 && weatherData.humidity < 40) {
    advices.push({ type: 'weather', icon: '☀️', message: `Nắng nóng (${weatherData.temperature}°C, độ ẩm ${weatherData.humidity}%). Tăng tưới.`, action: 'Tươi sáng sớm hoặc chiều muộn, tránh tưới giữa trưa.' });
  }

  if (stage.risks && stage.risks.length > 0) {
    advices.push({ type: 'risk', icon: '⚠️', message: `Rủi ro giai đoạn ${stage.name}:`, details: stage.risks });
  }

  if (age.months < 12) {
    advices.push({ type: 'info', icon: '🌱', message: `Cây còn non (${age.months} tháng). Chăm sóc đặc biệt: tưới ít nhưng đều, bón phân nhẹ.` });
  } else if (age.years >= 3 && stage.id === 'fruit-set') {
    advices.push({ type: 'info', icon: '☕', message: `Cây ${age.years} năm tuổi — đang trong giai đoạn kiến thiết cơ bản → kinh doanh.` });
  }

  return { advices, urgency, stage };
}

function isFiniteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

function sanitizeSensorValue(val, min, max) {
  const num = parseFloat(val);
  if (!isFiniteNumber(num)) return null;
  return Math.max(min, Math.min(max, num));
}

function checkAutoIrrigation() {
  ZONES.forEach(zone => {
    const rule = irrigationRules[zone.id];
    if (!rule.enabled) return;

    const sensor = zoneSensorData[zone.id];
    const actuator = actuators[zone.valveId];
    const pump = actuators[zone.pumpId];

    if (!actuator || !pump) return;

    if (rule.lastIrrigation) {
      const elapsed = (Date.now() - rule.lastIrrigation) / 60000;
      if (elapsed < rule.cooldownMin) return;
    }

    if (rule.rainPause && weatherData.rainfall > rule.rainThreshold) {
      if (actuator.state === 'open') {
        controlActuator(zone.valveId, 'close', 'auto-rain-pause');
        controlActuator(zone.pumpId, 'off', 'auto-rain-pause');
        clearIrrigationTimer(zone.id);
      }
      return;
    }

    if (sensor.moisture < rule.moistureMin && actuator.state === 'closed') {
      controlActuator(zone.pumpId, 'on', 'auto');
      controlActuator(zone.valveId, 'open', 'auto');
      rule.lastIrrigation = Date.now();

      const evt = {
        type: 'auto-irrigation', zone: zone.id, zoneName: zone.name,
        moisture: sensor.moisture, threshold: rule.moistureMin,
        time: new Date().toISOString()
      };
      controlHistory.unshift(evt);
      if (controlHistory.length > MAX_CONTROL_HISTORY) controlHistory.pop();
      io.emit('control_event', evt);

      clearIrrigationTimer(zone.id);
      const timer = setTimeout(() => {
        if (actuator.state === 'open') {
          controlActuator(zone.valveId, 'close', 'auto-timeout');
          controlActuator(zone.pumpId, 'off', 'auto-timeout');
          io.emit('control_event', { type: 'auto-irrigation-stop', zone: zone.id, reason: 'timeout', time: new Date().toISOString() });
        }
        activeIrrigationTimers.delete(zone.id);
      }, rule.maxDurationMin * 60000);
      activeIrrigationTimers.set(zone.id, timer);
    }

    if (sensor.moisture >= rule.moistureMax && actuator.state === 'open') {
      controlActuator(zone.valveId, 'close', 'auto-target-reached');
      controlActuator(zone.pumpId, 'off', 'auto-target-reached');
      clearIrrigationTimer(zone.id);
      io.emit('control_event', { type: 'auto-irrigation-stop', zone: zone.id, reason: 'target-reached', time: new Date().toISOString() });
    }
  });
}

function clearIrrigationTimer(zoneId) {
  const timer = activeIrrigationTimers.get(zoneId);
  if (timer) {
    clearTimeout(timer);
    activeIrrigationTimers.delete(zoneId);
  }
}

function controlActuator(actuatorId, action, source = 'manual') {
  const act = actuators[actuatorId];
  if (!act) return false;

  const prevState = act.state;

  if (act.type === 'pump') {
    act.state = (action === 'on') ? 'on' : 'off';
  } else if (act.type === 'valve') {
    act.state = (action === 'open') ? 'open' : 'closed';
  } else {
    return false;
  }

  act.lastChange = new Date().toISOString();

  const topic = `application/${APP_ID}/device/actuator/${actuatorId}/command`;
  const payload = { actuatorId, type: act.type, action: act.state, source, timestamp: act.lastChange };
  if (mqttClient && mqttConnected) {
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
  }

  influx.writeControlEvent(actuatorId, action, source, prevState, act.state);

  io.emit('actuator_update', { id: actuatorId, ...act });
  addControlEvent(`${act.name}: ${prevState} → ${act.state} (${source})`);

  return true;
}

function addControlEvent(message) {
  const evt = { level: 'info', message, time: new Date().toISOString() };
  io.emit('control_log', evt);
}

let mqttClient = null;
let mqttConnected = false;
let mqttReconnectTimer = null;

function connectMQTT() {
  if (mqttClient) {
    mqttClient.removeAllListeners();
    mqttClient.end(true);
  }

  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: 'smartfarm-control-' + Math.random().toString(16).slice(2, 8),
    clean: true,
    connectTimeout: 3000,
    reconnectPeriod: MQTT_RECONNECT_INTERVAL,
    keepalive: 60
  });

  mqttClient.on('connect', () => {
    mqttConnected = true;
    if (mqttReconnectTimer) { clearTimeout(mqttReconnectTimer); mqttReconnectTimer = null; }
    mqttClient.subscribe(`application/${APP_ID}/device/+/event/up`, { qos: 0 });
    io.emit('mqtt_status', { connected: true });
    addControlEvent('MQTT connected');
    logger.info('mqtt', 'Connected', { url: MQTT_URL });
  });

  mqttClient.on('message', (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      if (payload.object) {
        const devEUI = payload.devEUI;
        const zone = ZONES.find(z => z.moistureSensor === devEUI);
        if (zone) {
          const sensorData = { ...payload.object, lastUpdate: new Date().toISOString() };
          zoneSensorData[zone.id] = sensorData;
          io.emit('zone_sensor', { zoneId: zone.id, data: sensorData });

          influx.writeSensorData(zone.id, payload.object);

          try {
            const currentWeather = weatherData;
            const stageId = predictiveIrrigation.getCurrentStage(zone.crop);
            const predResult = predictiveIrrigation.processSensorData(
              zone.id, payload.object, currentWeather, zone.crop, stageId
            );
            if (predResult) {
              io.emit('predictive_update', { zoneId: zone.id, ...predResult });
            }
          } catch (e) {
          }
        }
      }
    } catch (e) {
      logger.warn('mqtt', 'Parse error', { error: e.message });
    }
  });

  mqttClient.on('error', (err) => {
    mqttConnected = false;
    io.emit('mqtt_status', { connected: false, error: err.message });
    logger.error('mqtt', 'Connection error', { error: err.message });
  });

  mqttClient.on('close', () => {
    mqttConnected = false;
    io.emit('mqtt_status', { connected: false });
    logger.warn('mqtt', 'Disconnected, will auto-reconnect...');
  });

  mqttClient.on('reconnect', () => {
    logger.info('mqtt', 'Reconnecting...');
  });
}

async function updateWeather() {
  try {
    const data = await getWeather();
    if (data) {
      weatherData = data;
      io.emit('weather_update', weatherData);
      return;
    }
  } catch (err) {
    logger.warn('weather', 'Real API failed, using simulated', { error: err.message });
  }

  weatherData = getSimulatedWeather();
  io.emit('weather_update', weatherData);
}

const cronJobs = [];
cronJobs.push(cron.schedule('*/1 * * * *', () => { checkAutoIrrigation(); }));
cronJobs.push(cron.schedule('*/30 * * * *', () => { updateWeather(); }));
cronJobs.push(cron.schedule('*/5 * * * *', () => {
  ZONES.forEach(zone => {
    const advisory = generateAdvisory(zone);
    io.emit('advisory', { zoneId: zone.id, ...advisory });
  });
}));

io.on('connection', (socket) => {
  socket.emit('init', {
    zones: ZONES, actuators, zoneSensorData, irrigationRules,
    weather: weatherData, cropStages: CROP_STAGES,
    controlHistory: controlHistory.slice(0, 50), mqttConnected
  });

  ZONES.forEach(zone => {
    const advisory = generateAdvisory(zone);
    socket.emit('advisory', { zoneId: zone.id, ...advisory });
  });

  socket.on('control', ({ actuatorId, action }) => {
    if (!actuatorId || !action) return;
    const validActions = ['on', 'off', 'open', 'close'];
    if (!validActions.includes(action)) return;
    const success = controlActuator(actuatorId, action, 'manual');
    socket.emit('control_result', { actuatorId, action, success });
  });

  socket.on('set_auto_mode', ({ zoneId, enabled }) => {
    if (!zoneId || typeof enabled !== 'boolean') return;
    if (irrigationRules[zoneId]) {
      irrigationRules[zoneId].enabled = enabled;
      if (!enabled) clearIrrigationTimer(zoneId);
      io.emit('rule_update', { zoneId, rule: irrigationRules[zoneId] });
      addControlEvent(`Auto irrigation ${zoneId}: ${enabled ? 'BẬT' : 'TẮT'}`);
    }
  });

  socket.on('update_rule', ({ zoneId, rule }) => {
    if (!zoneId || !rule || !irrigationRules[zoneId]) return;
    const sanitized = {};
    if (rule.moistureMin != null) sanitized.moistureMin = sanitizeSensorValue(rule.moistureMin, 0, 100);
    if (rule.moistureMax != null) sanitized.moistureMax = sanitizeSensorValue(rule.moistureMax, 0, 100);
    if (rule.maxDurationMin != null) sanitized.maxDurationMin = sanitizeSensorValue(rule.maxDurationMin, 1, 480);
    if (rule.cooldownMin != null) sanitized.cooldownMin = sanitizeSensorValue(rule.cooldownMin, 10, 1440);
    if (rule.rainThreshold != null) sanitized.rainThreshold = sanitizeSensorValue(rule.rainThreshold, 0, 200);
    if (typeof rule.rainPause === 'boolean') sanitized.rainPause = rule.rainPause;
    if (sanitized.moistureMin != null && sanitized.moistureMax != null && sanitized.moistureMin >= sanitized.moistureMax) {
      sanitized.moistureMax = sanitized.moistureMin + 10;
    }
    Object.assign(irrigationRules[zoneId], sanitized);
    io.emit('rule_update', { zoneId, rule: irrigationRules[zoneId] });
    addControlEvent(`Cập nhật quy tắc tưới ${zoneId}`);
  });

  socket.on('request_advisory', ({ zoneId }) => {
    const zone = ZONES.find(z => z.id === zoneId);
    if (zone) {
      const advisory = generateAdvisory(zone);
      socket.emit('advisory', { zoneId, ...advisory });
    }
  });

  socket.on('refresh_weather', () => { updateWeather(); });
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required', code: 'MISSING_CREDENTIALS' });
  }

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Invalid credential types', code: 'INVALID_INPUT' });
  }

  const user = USERS.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  const validPassword = bcrypt.compareSync(password, user.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  const token = jwt.sign(
    { username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  res.json({
    token,
    user: { username: user.username, role: user.role },
    expiresIn: JWT_EXPIRY
  });
});

app.get('/api/zones', (req, res) => {
  res.json(ZONES.map(z => ({
    ...z,
    sensor: zoneSensorData[z.id],
    rule: irrigationRules[z.id],
    stage: getCurrentStage(z.crop),
    plantAge: getPlantAge(z.plantDate)
  })));
});

app.get('/api/actuators', (req, res) => res.json(actuators));

app.post('/api/control', controlLimiter, authorizeMiddleware('admin', 'operator'), (req, res) => {
  const { actuatorId, action } = req.body || {};
  if (!actuatorId || !action) {
    return res.status(400).json({ error: 'Missing actuatorId or action', code: 'MISSING_FIELDS' });
  }
  if (typeof actuatorId !== 'string' || typeof action !== 'string') {
    return res.status(400).json({ error: 'actuatorId and action must be strings', code: 'INVALID_INPUT' });
  }
  const validActions = ['on', 'off', 'open', 'close'];
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: `Invalid action. Must be one of: ${validActions.join(', ')}`, code: 'INVALID_ACTION' });
  }
  if (!actuators[actuatorId]) {
    return res.status(404).json({ error: `Actuator '${actuatorId}' not found`, code: 'ACTUATOR_NOT_FOUND' });
  }
  const success = controlActuator(actuatorId, action, 'api');
  res.json({ success, actuator: actuators[actuatorId] });
});

app.get('/api/advisory/:zoneId', (req, res) => {
  const zoneId = req.params.zoneId;
  if (typeof zoneId !== 'string' || zoneId.length > 50) {
    return res.status(400).json({ error: 'Invalid zoneId', code: 'INVALID_INPUT' });
  }
  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found', code: 'NOT_FOUND' });
  res.json({ zone: zone.id, ...generateAdvisory(zone) });
});

app.get('/api/weather', (req, res) => res.json(weatherData));

app.get('/api/crop-stages', (req, res) => res.json(CROP_STAGES));

app.get('/api/history', async (req, res) => {
  if (influx.isAvailable()) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const zone = req.query.zone;
      const limit = Math.min(parseInt(req.query.limit) || 100, 1000);

      if (zone) {
        const data = await influx.queryHistory(zone, hours);
        return res.json(data.slice(0, limit));
      }

      const allData = [];
      for (const z of ZONES) {
        const data = await influx.queryHistory(z.id, hours);
        allData.push(...data);
      }
      allData.sort((a, b) => new Date(b.time) - new Date(a.time));
      return res.json(allData.slice(0, limit));
    } catch (err) {
      logger.warn('api', 'InfluxDB query failed, falling back to in-memory', { error: err.message });
    }
  }

  const limit = Math.min(parseInt(req.query.limit) || 100, MAX_CONTROL_HISTORY);
  res.json(controlHistory.slice(0, limit));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

app.get('/api/predictive/:zoneId', (req, res) => {
  const zoneId = req.params.zoneId;
  if (typeof zoneId !== 'string' || zoneId.length > 50) {
    return res.status(400).json({ error: 'Invalid zoneId', code: 'INVALID_INPUT' });
  }
  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found', code: 'NOT_FOUND' });

  const sensor = zoneSensorData[zoneId];
  if (!sensor) return res.status(404).json({ error: 'No sensor data for zone', code: 'NO_DATA' });

  const stageId = predictiveIrrigation.getCurrentStage(zone.crop);
  const recommendation = predictiveIrrigation.getRecommendation(zoneId, sensor, weatherData, zone.crop, stageId);
  res.json(recommendation);
});

app.get('/api/predictive', (req, res) => {
  const stageId = (crop) => predictiveIrrigation.getCurrentStage(crop);
  const recommendations = ZONES.map(zone => {
    const sensor = zoneSensorData[zone.id];
    if (!sensor) return null;
    return predictiveIrrigation.getRecommendation(zone.id, sensor, weatherData, zone.crop, stageId(zone.crop));
  }).filter(Boolean);
  res.json(recommendations);
});

app.get('/api/predictive/:zoneId/balance', (req, res) => {
  const zoneId = req.params.zoneId;
  if (typeof zoneId !== 'string' || zoneId.length > 50) {
    return res.status(400).json({ error: 'Invalid zoneId', code: 'INVALID_INPUT' });
  }
  const state = predictiveIrrigation.getBalanceState(zoneId);
  if (!state) return res.status(404).json({ error: 'Zone not found', code: 'NOT_FOUND' });
  res.json(state);
});

app.get('/api/predictive/:zoneId/history', (req, res) => {
  const zoneId = req.params.zoneId;
  if (typeof zoneId !== 'string' || zoneId.length > 50) {
    return res.status(400).json({ error: 'Invalid zoneId', code: 'INVALID_INPUT' });
  }
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const history = predictiveIrrigation.getBalanceHistory(zoneId, hours);
  res.json(history);
});

app.post('/api/weather/refresh', authorizeMiddleware('admin', 'operator'), async (req, res) => {
  try {
    const data = await refreshWeather();
    if (data) {
      weatherData = data;
      io.emit('weather_update', weatherData);
      res.json({ success: true, source: data.source });
    } else {
      res.json({ success: false, message: 'Weather API unavailable, using cached data' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh weather', code: 'WEATHER_ERROR' });
  }
});

app.get('/api/irrigation-plan/:zoneId', (req, res) => {
  const zoneId = req.params.zoneId;
  if (typeof zoneId !== 'string' || zoneId.length > 50) {
    return res.status(400).json({ error: 'Invalid zoneId', code: 'INVALID_INPUT' });
  }

  const zone = ZONES.find(z => z.id === zoneId);
  if (!zone) return res.status(404).json({ error: 'Zone not found', code: 'NOT_FOUND' });

  const sensor = zoneSensorData[zoneId] || {};
  const stage = getCurrentStage(zone.crop);
  const stageId = stage ? stage.id : 'dormant';

  const recommendation = predictiveIrrigation.getRecommendation(zoneId, sensor, weatherData, zone.crop, stageId);
  res.json(recommendation);
});

app.get('/api/schedule', (req, res) => {
  const schedule = scheduler.generateSchedule(
    ZONES, zoneSensorData, irrigationRules, weatherData
  );
  res.json(schedule);
});

app.get('/api/schedule/history', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const history = scheduler.getScheduleHistory(days);
  res.json(history);
});

function jsonToCsv(rows, columns) {
  if (!rows || rows.length === 0) return columns.join(',') + '\n';
  const header = columns.join(',');
  const lines = rows.map(row =>
    columns.map(col => {
      const val = row[col];
      if (val == null) return '';
      if (typeof val === 'string' && (val.includes(',') || val.includes('"') || val.includes('\n'))) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return String(val);
    }).join(',')
  );
  return header + '\n' + lines.join('\n') + '\n';
}

app.get('/api/export/sensors', exportLimiter, async (req, res) => {
  const format = (req.query.format || 'json').toLowerCase();
  const from = req.query.from;
  const to = req.query.to;

  let data = [];

  if (influx.isAvailable()) {
    try {
      const hours = 24;
      for (const zone of ZONES) {
        const history = await influx.queryHistory(zone.id, hours);
        data.push(...history.map(h => ({ zoneId: zone.id, ...h })));
      }
    } catch (err) {
      logger.warn('export', 'InfluxDB query failed, falling back to in-memory', { error: err.message });
    }
  }

  if (data.length === 0) {
    for (const zone of ZONES) {
      const sensor = zoneSensorData[zone.id];
      if (sensor) {
        data.push({
          timestamp: sensor.lastUpdate || new Date().toISOString(),
          zoneId: zone.id,
          temperature: sensor.temperature,
          moisture: sensor.moisture,
          ec: sensor.ec,
          salinity: sensor.salinity,
          nitrogen: sensor.nitrogen,
          phosphorus: sensor.phosphorus,
          potassium: sensor.potassium,
          ph: sensor.ph
        });
      }
    }
  }

  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      data = data.filter(d => new Date(d.timestamp || d.time) >= fromDate);
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      data = data.filter(d => new Date(d.timestamp || d.time) <= toDate);
    }
  }

  data.sort((a, b) => new Date(a.timestamp || a.time) - new Date(b.timestamp || b.time));

  if (format === 'csv') {
    const columns = ['timestamp', 'zoneId', 'temperature', 'moisture', 'ec', 'salinity', 'nitrogen', 'phosphorus', 'potassium', 'ph'];
    const normalized = data.map(d => ({
      timestamp: d.timestamp || d.time,
      zoneId: d.zoneId,
      temperature: d.temperature,
      moisture: d.moisture,
      ec: d.ec,
      salinity: d.salinity,
      nitrogen: d.nitrogen || d.N,
      phosphorus: d.phosphorus,
      potassium: d.potassium,
      ph: d.ph
    }));
    const csv = jsonToCsv(normalized, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sensors-export-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csv);
  }

  res.json(data);
});

app.get('/api/export/audit', exportLimiter, (req, res) => {
  const format = (req.query.format || 'json').toLowerCase();
  const from = req.query.from;
  const to = req.query.to;
  const limit = Math.min(parseInt(req.query.limit) || 1000, 5000);

  const entries = auditModule.getEntries({ from, to, limit });

  if (format === 'csv') {
    const columns = ['id', 'timestamp', 'userId', 'action', 'actuatorId', 'source', 'previousState', 'newState', 'detail'];
    const csv = jsonToCsv(entries, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-export-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csv);
  }

  res.json(entries);
});

app.get('/api/system', (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  const lastIrrigations = {};
  ZONES.forEach(zone => {
    const rule = irrigationRules[zone.id];
    lastIrrigations[zone.id] = rule.lastIrrigation ? new Date(rule.lastIrrigation).toISOString() : null;
  });

  const alertSummary = alertsModule.getSummary();
  const cachedWeather = getCachedWeather();

  res.json({
    uptime: {
      seconds: Math.floor(process.uptime()),
      formatted: formatUptime(process.uptime())
    },
    memory: {
      rss: formatBytes(memUsage.rss),
      heapUsed: formatBytes(memUsage.heapUsed),
      heapTotal: formatBytes(memUsage.heapTotal),
      external: formatBytes(memUsage.external)
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system
    },
    mqtt: {
      connected: mqttConnected,
      lastMessageTime: null
    },
    influxdb: {
      connected: influx.isAvailable()
    },
    zones: {
      active: ZONES.length,
      lastIrrigations
    },
    alerts: alertSummary,
    weather: {
      lastUpdate: cachedWeather ? cachedWeather.lastUpdate : null,
      source: cachedWeather ? cachedWeather.source : 'none',
      status: cachedWeather ? 'ok' : 'no-data'
    },
    timestamp: new Date().toISOString()
  });
});

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.max(0, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mqtt: mqttConnected,
    influxdb: influx.isAvailable(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.use((err, req, res, _next) => {
  logger.error('express', 'Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

function gracefulShutdown(signal) {
  logger.info('shutdown', `[${signal}] Shutting down gracefully...`);
  cronJobs.forEach(job => job.stop());
  activeIrrigationTimers.forEach((timer) => clearTimeout(timer));
  activeIrrigationTimers.clear();
  influx.flush();
  if (mqttClient) mqttClient.end(true);
  server.close(() => {
    logger.info('shutdown', 'HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => { logger.error('shutdown', 'Forced exit after timeout'); process.exit(1); }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => { logger.error('fatal', 'Uncaught exception', { error: err.message, stack: err.stack }); gracefulShutdown('uncaughtException'); });
process.on('unhandledRejection', (reason) => { logger.warn('fatal', 'Unhandled rejection', { reason: String(reason) }); });

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  logger.info('startup', 'SmartFarm DakLak - Smart Control started', {
    port: PORT,
    mqtt: MQTT_URL,
    zones: ZONES.length,
    actuators: Object.keys(actuators).length,
    influxdb: influx.isAvailable() ? 'connected' : 'disabled'
  });
  connectMQTT();
  updateWeather();
  influx.init();
  auditModule.init();
});
server.timeout = 30000;
