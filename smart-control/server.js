// SmartFarm DakLak - Smart Control & Advisory Service
// Features: Multi-zone irrigation, pump/valve control, crop advisory, weather integration
// Phase 1: JWT Auth, InfluxDB Persistence, Externalized Config

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mqtt = require('mqtt');
const path = require('path');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const influx = require('./lib/influx');
const { PredictiveIrrigation } = require('./lib/predictive-irrigation');
const { getWeather, refreshWeather, getCachedWeather } = require('./lib/weather');
const scheduler = require('./lib/scheduler');
const auditModule = require('./lib/audit');
const alertsModule = require('./lib/alerts');
const activityLog = require('./lib/activity-log');
const telegram = require('./lib/telegram');
const { apiLimiter, authLimiter, controlLimiter, exportLimiter } = require('./lib/rate-limiter');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '1mb' }));

// ─── CORS Middleware ──────────────────────────────────
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Config ───────────────────────────────────────────
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const APP_ID = 'smartfarm-daklak';
const SIMULATOR_URL = process.env.SIMULATOR_URL || 'http://localhost:3001';
const MQTT_RECONNECT_INTERVAL = 5000;
const MAX_CONTROL_HISTORY = 200;
const MAX_ADVISORY_HISTORY = 100;
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production'
  ? (() => { throw new Error('JWT_SECRET env var is required in production'); })()
  : 'dev-only-change-me-in-production');
const JWT_EXPIRY = '24h';

// ─── Load Externalized Configuration ──────────────────
function loadJSON(relPath, fallback) {
  const fullPath = path.join(__dirname, relPath);
  try {
    const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    console.log(`[Config] Loaded ${relPath}`);
    return data;
  } catch (err) {
    console.warn(`[Config] Failed to load ${relPath}: ${err.message}, using fallback`);
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

// ─── Predictive Irrigation Engine ─────────────────────
const predictiveIrrigation = new PredictiveIrrigation({
  zones: ZONES,
  rules: irrigationRules,
  altitude: 500 // DakLak elevation
});

// ─── Default Users — passwords from env vars, fallback for dev only ──
const DEFAULT_ADMIN_PASS = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'admin123');
const DEFAULT_OPERATOR_PASS = process.env.OPERATOR_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'operator123');
const DEFAULT_VIEWER_PASS = process.env.VIEWER_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'viewer123');

const USERS = [
  { username: 'admin', passwordHash: DEFAULT_ADMIN_PASS ? bcrypt.hashSync(DEFAULT_ADMIN_PASS, 10) : '', role: 'admin' },
  { username: 'operator', passwordHash: DEFAULT_OPERATOR_PASS ? bcrypt.hashSync(DEFAULT_OPERATOR_PASS, 10) : '', role: 'operator' },
  { username: 'viewer', passwordHash: DEFAULT_VIEWER_PASS ? bcrypt.hashSync(DEFAULT_VIEWER_PASS, 10) : '', role: 'viewer' }
].filter(u => u.passwordHash); // Remove users without passwords

// ─── JWT Auth Middleware ───────────────────────────────
function authenticateToken(req, res, next) {
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

// Role-based authorization middleware
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions', code: 'FORBIDDEN' });
    }
    next();
  };
}

// Apply rate limiting to all API routes
app.use('/api', apiLimiter);

// Apply auth to all /api/* routes EXCEPT /api/health and /api/auth/login
app.use('/api', (req, res, next) => {
  // Skip auth for health check and login
  if (req.path === '/health' || req.path === '/auth/login') {
    return next();
  }
  authenticateToken(req, res, next);
});

// ─── Auth Routes ──────────────────────────────────────
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

// ─── Sensor Data Cache (per zone) ─────────────────────
const zoneSensorData = {};
ZONES.forEach(z => {
  zoneSensorData[z.id] = {
    temperature: 27.5, moisture: 55, ec: 450, salinity: 220,
    nitrogen: 120, phosphorus: 35, potassium: 180, ph: 5.8,
    lastUpdate: null
  };
});

// ─── Weather Cache (DakLak) ───────────────────────────
let weatherData = {
  temperature: 30, humidity: 70, rainfall: 0, windSpeed: 8,
  cloudCover: 40, forecast: [], lastUpdate: null, source: 'simulated'
};

// ─── Control & Advisory History ───────────────────────
const controlHistory = [];
const advisoryHistory = [];

// ─── Track active irrigation timers for cleanup ───────
const activeIrrigationTimers = new Map();

// ─── Crop Knowledge Base (DakLak Coffee) ──────────────
const CROP_STAGES = {
  robusta: {
    name: 'Cà phê Robusta',
    stages: [
      {
        id: 'dormant', name: 'Nghỉ (Rụng lá)', months: [11, 12, 1], durationDays: 90,
        description: 'Cây rụng lá, nghỉ sinh dưỡng sau vụ thu hoạch',
        irrigation: { target: 30, frequency: '2 tuần/lần', notes: 'Giữ ẩm nhẹ, không tưới nhiều' },
        fertilization: { N: 0, P: 0, K: 0, notes: 'Bón phân chuồng hoai mục + vôi bột' },
        risks: ['Sâu bệnh ẩn trong vỏ cây', 'Đất khô nứt nếu không tưới duy trì']
      },
      {
        id: 'flowering', name: 'Ra hoa', months: [2, 3], durationDays: 45,
        description: 'Cây ra hoa trắng, cần nước kích thích nở hoa đồng đều',
        irrigation: { target: 55, frequency: '1 lần/tuần', notes: 'Tưới đẫm kích thích ra hoa. Thiếu nước = hoa rụng, mất mùa.' },
        fertilization: { N: 40, P: 60, K: 40, notes: 'Bón phân lân (P) để kích thích ra hoa, bón NPK 16-16-8' },
        risks: ['Mưa trái mùa gây rụng hoa', 'Thiếu nước = hoa không nở', 'Sâu đục quả']
      },
      {
        id: 'fruit-set', name: 'Đậu quả', months: [3, 4, 5], durationDays: 60,
        description: 'Quả non bắt đầu phát triển, giai đoạn nhạy cảm nhất',
        irrigation: { target: 60, frequency: '1 lần/tuần', notes: 'Tưới đều đặn, đất khô = rụng quả non hàng loạt' },
        fertilization: { N: 60, P: 30, K: 60, notes: 'Bón NPK 20-10-10 + phân bón lá có chứa Bo, Zn' },
        risks: ['Rụng quả non nếu stress nước', 'Thiếu Kali = quả nhỏ', 'Bệnh gỉ sắt lá']
      },
      {
        id: 'fruit-growth', name: 'Phát triển quả', months: [5, 6, 7, 8], durationDays: 120,
        description: 'Quả lớn dần, tích lũy chất khô bên trong',
        irrigation: { target: 55, frequency: '1-2 lần/tuần', notes: 'Tưới duy trì, mùa mưa có thể giảm tưới' },
        fertilization: { N: 30, P: 20, K: 80, notes: 'Bón Kali (K) cao để quả to, chất lượng tốt. NPK 10-5-20.' },
        risks: ['Mưa nhiều → ngập úng', 'Bệnh thán thư', 'Sâu đục quả']
      },
      {
        id: 'ripening', name: 'Chín', months: [9, 10], durationDays: 60,
        description: 'Quả chuyển từ xanh → đỏ, tích lũy caffeine và đường',
        irrigation: { target: 40, frequency: 'Giảm tưới', notes: 'Giảm nước để quả chín đều, tăng chất lượng' },
        fertilization: { N: 0, P: 0, K: 40, notes: 'Bón Kali nhẹ để quả ngọt hơn. Ngưng phân đạm.' },
        risks: ['Mưa nhiều → quả thối', 'Chín không đều', 'Rụng quả trước thu hoạch']
      },
      {
        id: 'harvest', name: 'Thu hoạch', months: [10, 11], durationDays: 45,
        description: 'Thu hoạch quả chín đỏ, sơ chế',
        irrigation: { target: 35, frequency: 'Tưới nhẹ sau thu hoạch', notes: 'Tưới phục hồi sau thu hoạch' },
        fertilization: { N: 20, P: 20, K: 20, notes: 'Bón phân phục hồi sau thu hoạch' },
        risks: ['Thiếu nhân công thu hoạch', 'Quả rụng mất', 'Sơ chế không kịp → giảm chất lượng']
      }
    ]
  },
  arabica: {
    name: 'Cà phê Arabica',
    stages: [
      {
        id: 'dormant', name: 'Nghỉ', months: [11, 12, 1], durationDays: 90,
        description: 'Giai đoạn nghỉ sau thu hoạch',
        irrigation: { target: 30, frequency: '2 tuần/lần', notes: 'Giữ ẩm nhẹ' },
        fertilization: { N: 0, P: 0, K: 0, notes: 'Bón phân chuồng + vôi' },
        risks: ['Sâu bệnh', 'Đất khô']
      },
      {
        id: 'flowering', name: 'Ra hoa', months: [2, 3], durationDays: 40,
        description: 'Hoa trắng, thơm',
        irrigation: { target: 55, frequency: '1 lần/tuần', notes: 'Tưới đẫm' },
        fertilization: { N: 30, P: 50, K: 30, notes: 'Bón lân kích thích ra hoa' },
        risks: ['Mưa trái mùa', 'Thiếu nước']
      },
      {
        id: 'fruit-set', name: 'Đậu quả', months: [3, 4], durationDays: 50,
        description: 'Quả non phát triển',
        irrigation: { target: 60, frequency: '1 lần/tuần', notes: 'Tưới đều' },
        fertilization: { N: 50, P: 25, K: 50, notes: 'NPK 20-10-10' },
        risks: ['Rụng quả non', 'Bệnh gỉ sắt']
      },
      {
        id: 'fruit-growth', name: 'Phát triển quả', months: [4, 5, 6, 7, 8], durationDays: 150,
        description: 'Quả lớn, Arabica cần nhiều nước hơn Robusta',
        irrigation: { target: 60, frequency: '2 lần/tuần', notes: 'Arabica nhạy cảm thiếu nước hơn Robusta' },
        fertilization: { N: 30, P: 20, K: 70, notes: 'Kali cao cho quả to' },
        risks: ['Nhiệt độ cao → stress', 'Thiếu nước → quả nhỏ']
      },
      {
        id: 'ripening', name: 'Chín', months: [9, 10], durationDays: 60,
        description: 'Quả chín đỏ',
        irrigation: { target: 45, frequency: 'Giảm', notes: 'Giảm nước cho quả chín đều' },
        fertilization: { N: 0, P: 0, K: 30, notes: 'Kali nhẹ' },
        risks: ['Quả thối nếu mưa']
      },
      {
        id: 'harvest', name: 'Thu hoạch', months: [10, 11], durationDays: 45,
        description: 'Thu hái chọn lọc (Arabica chín không đều)',
        irrigation: { target: 35, frequency: 'Phục hồi', notes: 'Tưới phục hồi' },
        fertilization: { N: 20, P: 20, K: 20, notes: 'Phục hồi sau thu hoạch' },
        risks: ['Nhân công', 'Chín không đều']
      }
    ]
  }
};

// ─── Utility Functions ────────────────────────────────

function getCurrentStage(crop, date = new Date()) {
  const month = date.getMonth() + 1;
  const cropData = CROP_STAGES[crop];
  if (!cropData) return null;
  return cropData.stages.find(s => s.months.includes(month)) || cropData.stages[0];
}

function getPlantAge(plantDate) {
  const planted = new Date(plantDate);
  const now = new Date();
  if (isNaN(planted.getTime())) return { months: 0, years: 0 };
  const months = (now.getFullYear() - planted.getFullYear()) * 12 + (now.getMonth() - planted.getMonth());
  return { months, years: Math.floor(months / 12) };
}

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

  // Moisture Advisory
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

  // Fertilization Advisory
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

  // pH Advisory
  if (sensor.ph < 4.5) {
    urgency = 'warning';
    advices.push({ type: 'soil', icon: '⚗️', message: `Đất chua (pH ${sensor.ph.toFixed(1)}). Cà phê cần pH 5.0-6.5.`, action: 'Bón vôi bột (dolomite) 2-3 tấn/ha. Kiểm tra lại sau 2 tuần.' });
  } else if (sensor.ph > 7.0) {
    urgency = 'warning';
    advices.push({ type: 'soil', icon: '⚗️', message: `Đất kiềm (pH ${sensor.ph.toFixed(1)}). Cà phê cần pH 5.0-6.5.`, action: 'Bón lưu huỳnh (S) hoặc phân chua (ammonium sulfate).' });
  }

  // EC/Salinity Advisory
  if (sensor.ec > 2000) {
    urgency = 'critical';
    advices.push({ type: 'salinity', icon: '🧂', message: `EC cao (${sensor.ec} µS/cm) — đất nhiễm mặn!`, action: 'Tưới xả mặn (leaching), kiểm tra nguồn nước tưới.' });
  }

  // Temperature Advisory
  if (sensor.temperature > 38) {
    if (urgency === 'info') urgency = 'warning';
    advices.push({ type: 'temperature', icon: '🌡️', message: `Nhiệt độ đất cao (${sensor.temperature.toFixed(1)}°C). Cây có thể bị stress nhiệt.`, action: 'Tưới làm mát, phủ rơm rạ che phủ gốc.' });
  }

  // Weather-based Advisory
  if (weatherData.rainfall > 20) {
    advices.push({ type: 'weather', icon: '🌧️', message: `Mưa lớn (${weatherData.rainfall}mm). Tạm dừng tưới.`, action: 'Kiểm tra thoát nước, gia cố bờ vùng.' });
  } else if (weatherData.temperature > 35 && weatherData.humidity < 40) {
    advices.push({ type: 'weather', icon: '☀️', message: `Nắng nóng (${weatherData.temperature}°C, độ ẩm ${weatherData.humidity}%). Tăng tưới.`, action: 'Tưới sáng sớm hoặc chiều muộn, tránh tưới giữa trưa.' });
  }

  // Stage-specific risks
  if (stage.risks && stage.risks.length > 0) {
    advices.push({ type: 'risk', icon: '⚠️', message: `Rủi ro giai đoạn ${stage.name}:`, details: stage.risks });
  }

  // Plant age advisory
  if (age.months < 12) {
    advices.push({ type: 'info', icon: '🌱', message: `Cây còn non (${age.months} tháng). Chăm sóc đặc biệt: tưới ít nhưng đều, bón phân nhẹ.` });
  } else if (age.years >= 3 && stage.id === 'fruit-set') {
    advices.push({ type: 'info', icon: '☕', message: `Cây ${age.years} năm tuổi — đang trong giai đoạn kiến thiết cơ bản → kinh doanh.` });
  }

  return { advices, urgency, stage };
}

// ─── Input Validation Helpers ─────────────────────────
function isFiniteNumber(val) {
  return typeof val === 'number' && Number.isFinite(val);
}

function sanitizeSensorValue(val, min, max) {
  const num = parseFloat(val);
  if (!isFiniteNumber(num)) return null;
  return Math.max(min, Math.min(max, num));
}

// ─── Auto Irrigation Logic ────────────────────────────
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

  // Publish MQTT command
  const topic = `application/${APP_ID}/device/actuator/${actuatorId}/command`;
  const payload = { actuatorId, type: act.type, action: act.state, source, timestamp: act.lastChange };
  if (mqttClient && mqttConnected) {
    mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
  }

  // Write to InfluxDB
  influx.writeControlEvent(actuatorId, action, source, prevState, act.state);

  io.emit('actuator_update', { id: actuatorId, ...act });
  addControlEvent(`${act.name}: ${prevState} → ${act.state} (${source})`);

  return true;
}

// ─── Control Events ───────────────────────────────────
function addControlEvent(message) {
  const evt = { level: 'info', message, time: new Date().toISOString() };
  io.emit('control_log', evt);
}

// ─── MQTT with Auto-Reconnect ─────────────────────────
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
    console.log('[MQTT] Connected to', MQTT_URL);
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

          // Write sensor data to InfluxDB
          influx.writeSensorData(zone.id, payload.object);

          // Update predictive irrigation water balance
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
            // Non-critical: log and continue
          }
        }
      }
    } catch (e) {
      console.warn('[MQTT] Parse error:', e.message);
    }
  });

  mqttClient.on('error', (err) => {
    mqttConnected = false;
    io.emit('mqtt_status', { connected: false, error: err.message });
    console.error('[MQTT] Error:', err.message);
  });

  mqttClient.on('close', () => {
    mqttConnected = false;
    io.emit('mqtt_status', { connected: false });
    console.warn('[MQTT] Disconnected, will auto-reconnect...');
  });

  mqttClient.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
  });
}

// ─── Weather Fetch (Open-Meteo API with simulated fallback) ──
async function updateWeather() {
  try {
    const data = await getWeather();
    if (data) {
      weatherData = data;
      io.emit('weather_update', weatherData);
      return;
    }
  } catch (err) {
    console.warn('[Weather] Real API failed, using simulated:', err.message);
  }

  // Fallback to simulated
  const month = new Date().getMonth() + 1;
  const isRainy = month >= 5 && month <= 10;
  weatherData = {
    temperature: isRainy ? 25 + Math.random() * 5 : 28 + Math.random() * 8,
    humidity: isRainy ? 75 + Math.random() * 20 : 50 + Math.random() * 20,
    rainfall: isRainy ? (Math.random() > 0.5 ? Math.random() * 30 : 0) : 0,
    windSpeed: 5 + Math.random() * 10,
    cloudCover: isRainy ? 60 + Math.random() * 30 : 20 + Math.random() * 30,
    forecast: [
      { day: 'Hôm nay', temp: 28, rain: isRainy ? 15 : 0, desc: isRainy ? 'Mưa rào' : 'Nắng' },
      { day: 'Ngày mai', temp: 29, rain: isRainy ? 8 : 0, desc: isRainy ? 'Mưa nhẹ' : 'Ít mây' },
      { day: 'Ngày kia', temp: 30, rain: isRainy ? 20 : 0, desc: isRainy ? 'Mưa vừa' : 'Nắng' }
    ],
    lastUpdate: new Date().toISOString(),
    source: 'simulated'
  };
  io.emit('weather_update', weatherData);
}

// ─── Scheduled Tasks ──────────────────────────────────
const cronJobs = [];

cronJobs.push(cron.schedule('*/1 * * * *', () => { checkAutoIrrigation(); }));
cronJobs.push(cron.schedule('*/30 * * * *', () => { updateWeather(); }));
cronJobs.push(cron.schedule('*/5 * * * *', () => {
  ZONES.forEach(zone => {
    const advisory = generateAdvisory(zone);
    io.emit('advisory', { zoneId: zone.id, ...advisory });

    // Send Telegram alerts for critical/warning advisories
    if (advisory.urgency === 'critical' || advisory.urgency === 'warning') {
      const urgentAdvice = advisory.advices.find(a => a.type === 'irrigation' || a.type === 'salinity' || a.type === 'temperature');
      if (urgentAdvice) {
        telegram.sendAlert(advisory.urgency, urgentAdvice.message, urgentAdvice.action || '', zone.name).catch(() => {});
      }
    }
  });
}));

// Daily summary at 7:00 AM
cronJobs.push(cron.schedule('0 7 * * *', () => {
  telegram.sendDailySummary(ZONES, zoneSensorData, weatherData, null).catch(() => {});
  console.log('[Cron] Daily summary sent to Telegram');
}));

// ─── WebSocket (Socket.IO) ────────────────────────────
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

// ─── REST API ─────────────────────────────────────────

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

app.post('/api/control', controlLimiter, authorize('admin', 'operator'), (req, res) => {
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
  // Try InfluxDB first, fall back to in-memory
  if (influx.isAvailable()) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      const zone = req.query.zone;
      const limit = Math.min(parseInt(req.query.limit) || 100, 1000);

      if (zone) {
        const data = await influx.queryHistory(zone, hours);
        return res.json(data.slice(0, limit));
      }

      // All zones: query each and merge
      const allData = [];
      for (const z of ZONES) {
        const data = await influx.queryHistory(z.id, hours);
        allData.push(...data);
      }
      allData.sort((a, b) => new Date(b.time) - new Date(a.time));
      return res.json(allData.slice(0, limit));
    } catch (err) {
      console.warn('[API] InfluxDB query failed, falling back to in-memory:', err.message);
    }
  }

  // In-memory fallback
  const limit = Math.min(parseInt(req.query.limit) || 100, MAX_CONTROL_HISTORY);
  res.json(controlHistory.slice(0, limit));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

// ─── Predictive Irrigation API ────────────────────────

// Get irrigation recommendation for a zone
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

// Get recommendations for all zones
app.get('/api/predictive', (req, res) => {
  const stageId = (crop) => predictiveIrrigation.getCurrentStage(crop);
  const recommendations = ZONES.map(zone => {
    const sensor = zoneSensorData[zone.id];
    if (!sensor) return null;
    return predictiveIrrigation.getRecommendation(zone.id, sensor, weatherData, zone.crop, stageId(zone.crop));
  }).filter(Boolean);
  res.json(recommendations);
});

// Get water balance state for a zone
app.get('/api/predictive/:zoneId/balance', (req, res) => {
  const zoneId = req.params.zoneId;
  if (typeof zoneId !== 'string' || zoneId.length > 50) {
    return res.status(400).json({ error: 'Invalid zoneId', code: 'INVALID_INPUT' });
  }
  const state = predictiveIrrigation.getBalanceState(zoneId);
  if (!state) return res.status(404).json({ error: 'Zone not found', code: 'NOT_FOUND' });
  res.json(state);
});

// Get water balance history for a zone
app.get('/api/predictive/:zoneId/history', (req, res) => {
  const zoneId = req.params.zoneId;
  if (typeof zoneId !== 'string' || zoneId.length > 50) {
    return res.status(400).json({ error: 'Invalid zoneId', code: 'INVALID_INPUT' });
  }
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const history = predictiveIrrigation.getBalanceHistory(zoneId, hours);
  res.json(history);
});

// Refresh weather from Open-Meteo API
app.post('/api/weather/refresh', authorize('admin', 'operator'), async (req, res) => {
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

// ─── Phase 5: ET₀-based Irrigation Plan ───────────────
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

// ─── Phase 5: Multi-zone Schedule ─────────────────────
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

// ─── Phase 5: Data Export ─────────────────────────────
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

  // Try InfluxDB first
  if (influx.isAvailable()) {
    try {
      const hours = 24;
      for (const zone of ZONES) {
        const history = await influx.queryHistory(zone.id, hours);
        data.push(...history.map(h => ({ zoneId: zone.id, ...h })));
      }
    } catch (err) {
      console.warn('[Export] InfluxDB query failed, falling back to in-memory:', err.message);
    }
  }

  // Fallback: in-memory sensor data snapshot
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

  // Filter by date range
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

  // Sort by time
  data.sort((a, b) => new Date(a.timestamp || a.time) - new Date(b.timestamp || b.time));

  if (format === 'csv') {
    const columns = ['timestamp', 'zoneId', 'temperature', 'moisture', 'ec', 'salinity', 'nitrogen', 'phosphorus', 'potassium', 'ph'];
    // Normalize timestamp field
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

// ─── Phase 5: System Health Dashboard ─────────────────
app.get('/api/system', (req, res) => {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  // Last irrigation times per zone
  const lastIrrigations = {};
  ZONES.forEach(zone => {
    const rule = irrigationRules[zone.id];
    lastIrrigations[zone.id] = rule.lastIrrigation ? new Date(rule.lastIrrigation).toISOString() : null;
  });

  // Active alerts count
  const alertSummary = alertsModule.getSummary();

  // Weather module status
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
      lastMessageTime: null // tracked internally, not exposed separately
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
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Health check endpoint (no auth required)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mqtt: mqttConnected,
    influxdb: influx.isAvailable(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ─── Activity Log API ─────────────────────────────────

app.get('/api/activities', (req, res) => {
  const { zoneId, type, from, to, limit } = req.query;
  const activities = activityLog.getActivities({
    zoneId, type, from, to,
    limit: Math.min(parseInt(limit) || 50, 500)
  });
  res.json(activities);
});

app.post('/api/activities', authorize('admin', 'operator'), (req, res) => {
  const { type, zoneId, title, description, quantity, unit, product, cost } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title is required', code: 'MISSING_TITLE' });
  }
  const activity = activityLog.addActivity({
    type, zoneId, title: title.trim(),
    description: description?.trim(), quantity, unit,
    product: product?.trim(), cost,
    user: req.user?.username || 'unknown'
  });

  // Notify via Telegram
  const zone = ZONES.find(z => z.id === zoneId);
  telegram.sendActivityNotification(activity, zone?.name).catch(() => {});

  // Emit via Socket.IO
  io.emit('activity_new', activity);

  res.json(activity);
});

app.delete('/api/activities/:id', authorize('admin'), (req, res) => {
  const ok = activityLog.deleteActivity(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Activity not found', code: 'NOT_FOUND' });
  res.json({ success: true });
});

app.get('/api/activities/stats', (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  res.json(activityLog.getStats(days));
});

// ─── Telegram Status API ──────────────────────────────

app.get('/api/telegram/status', (req, res) => {
  res.json(telegram.getStatus());
});

// ─── Error Handler ────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Express] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

// ─── Graceful Shutdown ────────────────────────────────
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  cronJobs.forEach(job => job.stop());
  activeIrrigationTimers.forEach((timer) => clearTimeout(timer));
  activeIrrigationTimers.clear();
  influx.flush();
  if (mqttClient) mqttClient.end(true);
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => { console.error('[Shutdown] Forced exit after timeout'); process.exit(1); }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => { console.error('[FATAL] Uncaught exception:', err); gracefulShutdown('uncaughtException'); });
process.on('unhandledRejection', (reason) => { console.error('[WARN] Unhandled rejection:', reason); });

// ─── Start ────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
server.listen(PORT, () => {
  console.log(`\n🎛️  SmartFarm DakLak - Smart Control`);
  console.log(`   Dashboard:  http://localhost:${PORT}`);
  console.log(`   MQTT:       ${MQTT_URL}`);
  console.log(`   Zones:      ${ZONES.length}`);
  console.log(`   Actuators:  ${Object.keys(actuators).length}`);
  console.log(`   InfluxDB:   ${influx.isAvailable() ? 'connected' : 'disabled (in-memory fallback)'}\n`);
  connectMQTT();
  updateWeather();
  influx.init();
  auditModule.init();
  activityLog.init();
  telegram.init();
});
