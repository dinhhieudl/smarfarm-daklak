// SmartFarm DakLak — Activity Log Module
// Track farm activities: planting, fertilizing, spraying, harvesting, maintenance

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'activities.json');
const MAX_ACTIVITIES = 500;

let activities = [];
let idCounter = 0;

// Activity type definitions
const ACTIVITY_TYPES = {
  planting: { icon: '🌱', label: 'Trồng', color: '#4caf50' },
  fertilizing: { icon: '🌿', label: 'Bón phân', color: '#8bc34a' },
  spraying: { icon: '🧪', label: 'Phun thuốc', color: '#ff9800' },
  irrigating: { icon: '💧', label: 'Tưới nước', color: '#2196f3' },
  harvesting: { icon: '🧺', label: 'Thu hoạch', color: '#e53935' },
  pruning: { icon: '✂️', label: 'Tỉa cành', color: '#795548' },
  mulching: { icon: '🍂', label: 'Phủ rơm', color: '#8d6e63' },
  soil_test: { icon: '🧪', label: 'Xét nghiệm đất', color: '#9c27b0' },
  pest_control: { icon: '🐛', label: 'Trừ sâu bệnh', color: '#f44336' },
  maintenance: { icon: '🔧', label: 'Bảo trì', color: '#607d8b' },
  other: { icon: '📝', label: 'Khác', color: '#9e9e9e' }
};

function init() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      activities = data.activities || [];
      idCounter = data.idCounter || activities.length;
      console.log(`[ActivityLog] Loaded ${activities.length} activities`);
    }
  } catch (err) {
    console.warn('[ActivityLog] Failed to load data:', err.message);
  }
}

function save() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify({ activities, idCounter }, null, 2));
  } catch (err) {
    console.warn('[ActivityLog] Failed to save:', err.message);
  }
}

function addActivity({ type, zoneId, title, description, quantity, unit, product, cost, user }) {
  idCounter++;
  const activity = {
    id: `act-${idCounter}`,
    type: type || 'other',
    zoneId: zoneId || null,
    title: title || '',
    description: description || '',
    quantity: quantity != null ? parseFloat(quantity) : null,
    unit: unit || null,
    product: product || null,
    cost: cost != null ? parseFloat(cost) : null,
    user: user || 'system',
    timestamp: new Date().toISOString()
  };

  activities.unshift(activity);
  if (activities.length > MAX_ACTIVITIES) activities.pop();
  save();
  return activity;
}

function getActivities({ zoneId, type, from, to, limit = 50 } = {}) {
  let filtered = activities;

  if (zoneId) filtered = filtered.filter(a => a.zoneId === zoneId);
  if (type) filtered = filtered.filter(a => a.type === type);
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate.getTime())) filtered = filtered.filter(a => new Date(a.timestamp) >= fromDate);
  }
  if (to) {
    const toDate = new Date(to);
    if (!isNaN(toDate.getTime())) filtered = filtered.filter(a => new Date(a.timestamp) <= toDate);
  }

  return filtered.slice(0, Math.min(limit, MAX_ACTIVITIES));
}

function getActivity(id) {
  return activities.find(a => a.id === id) || null;
}

function deleteActivity(id) {
  const idx = activities.findIndex(a => a.id === id);
  if (idx === -1) return false;
  activities.splice(idx, 1);
  save();
  return true;
}

function getStats(days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const recent = activities.filter(a => new Date(a.timestamp) >= cutoff);
  const byType = {};
  const byZone = {};
  let totalCost = 0;

  recent.forEach(a => {
    byType[a.type] = (byType[a.type] || 0) + 1;
    if (a.zoneId) byZone[a.zoneId] = (byZone[a.zoneId] || 0) + 1;
    if (a.cost) totalCost += a.cost;
  });

  return { total: recent.length, byType, byZone, totalCost, days };
}

module.exports = {
  init,
  addActivity,
  getActivities,
  getActivity,
  deleteActivity,
  getStats,
  ACTIVITY_TYPES
};
