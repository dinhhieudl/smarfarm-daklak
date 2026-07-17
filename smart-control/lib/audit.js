// SmartFarm DakLak - Audit Log System
// Logs every control action with full context

const fs = require('fs');
const path = require('path');

const MAX_IN_MEMORY = 500;
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

// In-memory buffer (most recent first)
let auditEntries = [];

// Ensure logs directory exists
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Load existing audit entries from file on startup
 */
function loadFromFile() {
  ensureLogDir();
  if (!fs.existsSync(LOG_FILE)) return;

  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    // Load last MAX_IN_MEMORY entries
    const recent = lines.slice(-MAX_IN_MEMORY);
    auditEntries = recent.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean).reverse();
    console.log(`[Audit] Loaded ${auditEntries.length} entries from log file`);
  } catch (err) {
    console.error('[Audit] Failed to load log file:', err.message);
  }
}

/**
 * Append a single entry to the log file (append mode)
 */
function appendToFile(entry) {
  ensureLogDir();
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('[Audit] Failed to write log:', err.message);
  });
}

/**
 * Log a control action
 * @param {Object} params
 * @param {string} params.action - What happened (e.g., 'pump_on', 'valve_close')
 * @param {string} params.actuatorId - Actuator ID
 * @param {string} params.source - 'manual' | 'auto' | 'api'
 * @param {string} params.userId - User ID from JWT or 'anonymous'
 * @param {*} params.previousState - State before action
 * @param {*} params.newState - State after action
 * @param {string} [params.detail] - Extra context
 */
function logAction({ action, actuatorId, source = 'unknown', userId = 'anonymous', previousState, newState, detail }) {
  const entry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    userId,
    action,
    actuatorId,
    source,
    previousState,
    newState,
    detail: detail || null
  };

  // Add to in-memory (newest first)
  auditEntries.unshift(entry);
  if (auditEntries.length > MAX_IN_MEMORY) {
    auditEntries.pop();
  }

  // Persist to file
  appendToFile(entry);

  return entry;
}

/**
 * Get audit entries with optional date filters
 * @param {Object} [filters]
 * @param {string} [filters.from] - ISO date string (inclusive)
 * @param {string} [filters.to] - ISO date string (inclusive)
 * @param {number} [filters.limit] - Max entries to return (default 100)
 */
function getEntries({ from, to, limit = 100 } = {}) {
  let filtered = auditEntries;

  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      filtered = filtered.filter(e => new Date(e.timestamp) >= fromDate);
    }
  }

  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      filtered = filtered.filter(e => new Date(e.timestamp) <= toDate);
    }
  }

  return filtered.slice(0, limit);
}

/**
 * Get total count of entries (optionally filtered)
 */
function getCount({ from, to } = {}) {
  let filtered = auditEntries;
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) {
      filtered = filtered.filter(e => new Date(e.timestamp) >= fromDate);
    }
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) {
      filtered = filtered.filter(e => new Date(e.timestamp) <= toDate);
    }
  }
  return filtered.length;
}

/**
 * Initialize audit system (load existing logs)
 */
function init() {
  loadFromFile();
  console.log('[Audit] System initialized');
}

module.exports = {
  init,
  logAction,
  getEntries,
  getCount
};
