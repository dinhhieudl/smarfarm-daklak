// SmartFarm DakLak - Alert/Notification System
// Monitors sensor data and actuator states for threshold violations

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const ALERTS_FILE = path.join(__dirname, '..', 'logs', 'alerts.json');

const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes cooldown
const MAX_ALERTS = 100;

// In-memory alert store
let alerts = [];
let alertIdCounter = 0;

// Cooldown tracking: key = ruleId + severity → last triggered timestamp
let cooldownMap = new Map();

async function persistAlerts() {
  try {
    const dir = path.dirname(ALERTS_FILE);
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    await fs.writeFile(ALERTS_FILE, JSON.stringify(alerts, null, 2));
  } catch {}
}

async function loadAlerts() {
  try {
    const data = await fs.readFile(ALERTS_FILE, 'utf8');
    alerts = JSON.parse(data);
    if (alerts.length > 0) {
      const maxId = Math.max(...alerts.map(a => {
        const match = a.id.match(/alert-(\d+)-/);
        return match ? parseInt(match[1]) : 0;
      }));
      alertIdCounter = maxId + 1;
    }
  } catch {}
}

async function init() {
  await loadAlerts();
}

/**
 * Check if an alert is in cooldown
 */
function isInCooldown(ruleId, zoneId) {
  const key = `${ruleId}:${zoneId}`;
  const lastTriggered = cooldownMap.get(key);
  if (!lastTriggered) return false;
  return (Date.now() - lastTriggered) < COOLDOWN_MS;
}

/**
 * Set cooldown for an alert
 */
function setCooldown(ruleId, zoneId) {
  const key = `${ruleId}:${zoneId}`;
  cooldownMap.set(key, Date.now());
}

/**
 * Evaluate sensor data against all alert rules for a zone
 * @param {string} zoneId
 * @param {Object} sensor - Sensor data for the zone
 * @returns {Array} New alerts triggered
 */
function evaluateSensor(zoneId, sensor) {
  const newAlerts = [];

  for (const rule of ALERT_RULES) {
    try {
      if (rule.condition(sensor) && !isInCooldown(rule.id, zoneId)) {
        const alert = createAlert({
          ruleId: rule.id,
          severity: rule.severity,
          title: rule.name,
          message: rule.message(sensor),
          zoneId,
          source: 'sensor'
        });
        newAlerts.push(alert);
        setCooldown(rule.id, zoneId);
      }
    } catch (err) {
      // Skip rule evaluation errors silently
    }
  }

  return newAlerts;
}

/**
 * Check pump duration alerts
 * @param {string} actuatorId
 * @param {string} state - 'on' or 'off'
 * @param {number|null} lastChange - timestamp of last state change
 * @param {number} maxDurationMin - max allowed duration in minutes
 * @returns {Object|null} Alert if pump running too long
 */
function checkPumpDuration(actuatorId, state, lastChange, maxDurationMin) {
  if (state !== 'on' || !lastChange) return null;

  const runningMinutes = (Date.now() - new Date(lastChange).getTime()) / 60000;
  if (runningMinutes > maxDurationMin && !isInCooldown('pump-duration', actuatorId)) {
    const alert = createAlert({
      ruleId: 'pump-duration',
      severity: 'warning',
      title: 'Bơm chạy quá lâu',
      message: `${actuatorId} đã chạy ${Math.round(runningMinutes)} phút — vượt quá giới hạn ${maxDurationMin} phút.`,
      zoneId: actuatorId,
      source: 'actuator'
    });
    setCooldown('pump-duration', actuatorId);
    return alert;
  }
  return null;
}

/**
 * Create and store a new alert
 */
function createAlert({ ruleId, severity, title, message, zoneId, source }) {
  alertIdCounter++;
  const alert = {
    id: `alert-${Date.now()}-${alertIdCounter}`,
    ruleId,
    severity, // 'info' | 'warning' | 'critical'
    title,
    message,
    zoneId,
    source,
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgedAt: null,
    timestamp: new Date().toISOString()
  };

  // Add to store (newest first)
  alerts.unshift(alert);
  if (alerts.length > MAX_ALERTS) {
    alerts.pop();
  }

  console.log(`[Alert][${severity.toUpperCase()}] ${title}: ${message}`);
  persistAlerts();
  return alert;
}

/**
 * Acknowledge an alert by ID
 * @param {string} alertId
 * @param {string} userId - Who acknowledged it
 * @returns {Object|null} Updated alert or null if not found
 */
function acknowledge(alertId, userId = 'anonymous') {
  const alert = alerts.find(a => a.id === alertId);
  if (!alert) return null;

  alert.acknowledged = true;
  alert.acknowledgedBy = userId;
  alert.acknowledgedAt = new Date().toISOString();

  return alert;
}

/**
 * Get all alerts with optional filters
 * @param {Object} [filters]
 * @param {string} [filters.severity] - Filter by severity
 * @param {boolean} [filters.unacknowledgedOnly] - Only unacknowledged
 * @param {number} [filters.limit] - Max results (default 100)
 */
function getAlerts({ severity, unacknowledgedOnly = false, limit = 100 } = {}) {
  let filtered = alerts;

  if (severity) {
    filtered = filtered.filter(a => a.severity === severity);
  }
  if (unacknowledgedOnly) {
    filtered = filtered.filter(a => !a.acknowledged);
  }

  return filtered.slice(0, limit);
}

/**
 * Get alert count by severity
 */
function getSummary() {
  return {
    total: alerts.length,
    critical: alerts.filter(a => a.severity === 'critical' && !a.acknowledged).length,
    warning: alerts.filter(a => a.severity === 'warning' && !a.acknowledged).length,
    info: alerts.filter(a => a.severity === 'info' && !a.acknowledged).length,
    unacknowledged: alerts.filter(a => !a.acknowledged).length
  };
}

module.exports = {
  evaluateSensor,
  checkPumpDuration,
  acknowledge,
  getAlerts,
  getSummary,
  createAlert,
  loadAlerts,
  init
};
