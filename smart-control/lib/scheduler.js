// SmartFarm DakLak - Multi-zone Predictive Irrigation Scheduler
// Priority-based scheduling with pump capacity constraints

const { calculateET0, calculateETc, getCropCoefficient } = require('./eto');

// Irrigation windows (minimize evaporation)
const IRRIGATION_WINDOWS = [
  { start: 5, end: 7, label: 'Sáng sớm (5-7h)', efficiency: 0.95 },
  { start: 16, end: 18, label: 'Chiều muộn (16-18h)', efficiency: 0.90 }
];

// Crop value factors (higher = more valuable crop gets priority)
const CROP_VALUE_FACTORS = {
  robusta: 1.0,
  arabica: 1.3 // Arabica is higher value
};

// Pump capacity constraints
const PUMP_CONSTRAINTS = {
  'pump-1': { flowRate: 50, zones: ['zone-A', 'zone-B'] }, // L/min, shared by A+B
  'pump-2': { flowRate: 30, zones: ['zone-C'] }             // L/min, dedicated to C
};

// Schedule history (in-memory, last 7 days)
const MAX_HISTORY_DAYS = 7;
const scheduleHistory = new Map(); // date string → schedule

/**
 * Calculate water stress factor based on current moisture vs target
 * Higher stress = higher priority
 * @param {number} currentMoisture
 * @param {number} targetMoisture
 * @returns {number} stress factor (0-2)
 */
function calculateWaterStress(currentMoisture, targetMoisture) {
  if (currentMoisture >= targetMoisture) return 0;
  const deficit = (targetMoisture - currentMoisture) / targetMoisture;
  return Math.min(2, deficit * 3); // scales 0-2
}

/**
 * Calculate urgency factor
 * Combines moisture deficit, time since last irrigation, and ET demand
 * @param {object} params
 * @returns {number} urgency (0-2)
 */
function calculateUrgency({ currentMoisture, targetMoisture, etc, lastIrrigation, cooldownMin }) {
  // Moisture urgency
  const moistureUrgency = calculateWaterStress(currentMoisture, targetMoisture);

  // Time since last irrigation
  let timeUrgency = 0.5; // default moderate
  if (lastIrrigation) {
    const elapsedMin = (Date.now() - lastIrrigation) / 60000;
    if (elapsedMin < cooldownMin) {
      timeUrgency = 0; // still in cooldown
    } else if (elapsedMin > cooldownMin * 2) {
      timeUrgency = 1.0; // overdue
    }
  }

  // ET demand urgency (higher etc = more water needed)
  const etUrgency = Math.min(1, etc / 8); // normalize: 8mm/day = max urgency

  return Math.min(2, moistureUrgency * 0.5 + timeUrgency * 0.3 + etUrgency * 0.2);
}

/**
 * Calculate priority score for a zone
 * Priority = urgency × crop_value_factor × water_stress_factor
 *
 * @param {object} zone - Zone config
 * @param {object} sensor - Current sensor data
 * @param {object} rule - Irrigation rules
 * @param {object} weather - Current weather data
 * @returns {object} { priority, breakdown, etc, plan }
 */
function calculatePriority(zone, sensor, rule, weather) {
  const targetMoisture = rule.moistureMin ?? 35;

  // Calculate ET₀ and ETc
  const ET0 = calculateET0({
    temperature: weather.temperature,
    humidity: weather.humidity,
    windSpeed: weather.windSpeed,
    cloudCover: weather.cloudCover,
    altitude: 500
  }) || 0;

  const Kc = getCropCoefficient(zone.crop, 'fruit-growth'); // conservative
  const ETc = calculateETc(ET0, Kc) || 0;

  const urgency = calculateUrgency({
    currentMoisture: sensor.moisture,
    targetMoisture,
    etc: ETc,
    lastIrrigation: rule.lastIrrigation,
    cooldownMin: rule.cooldownMin ?? 120
  });

  const cropValueFactor = CROP_VALUE_FACTORS[zone.crop] || 1.0;
  const waterStressFactor = 1 + calculateWaterStress(sensor.moisture, targetMoisture);

  const priority = urgency * cropValueFactor * waterStressFactor;

  // Estimate irrigation volume (rough: 1mm per m² = 1L)
  const moistureDeficit = Math.max(0, targetMoisture + 15 - (sensor.moisture ?? targetMoisture));
  const volumeLiters = Math.round(moistureDeficit * (zone.area ?? 3000) / 100);

  return {
    priority: Math.round(priority * 100) / 100,
    breakdown: {
      urgency: Math.round(urgency * 100) / 100,
      cropValueFactor,
      waterStressFactor: Math.round(waterStressFactor * 100) / 100,
      ET0, Kc, ETc
    },
    plan: {
      targetMoisture,
      volumeLiters,
      ETc
    }
  };
}

/**
 * Select the best irrigation window based on current time
 * @returns {object|null} Selected window or null if outside windows
 */
function selectIrrigationWindow() {
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;

  // Find the next available window
  for (const window of IRRIGATION_WINDOWS) {
    if (currentHour >= window.start && currentHour < window.end) {
      return { ...window, status: 'active', selectedAt: now.toISOString() };
    }
  }

  // If outside windows, pick the next one
  for (const window of IRRIGATION_WINDOWS) {
    if (currentHour < window.start) {
      const minutesUntil = (window.start - currentHour) * 60;
      return { ...window, status: 'scheduled', minutesUntil: Math.round(minutesUntil), selectedAt: now.toISOString() };
    }
  }

  // All windows passed today, pick first tomorrow
  const firstWindow = IRRIGATION_WINDOWS[0];
  const hoursUntil = (24 - currentHour) + firstWindow.start;
  return { ...firstWindow, status: 'tomorrow', minutesUntil: Math.round(hoursUntil * 60), selectedAt: now.toISOString() };
}

/**
 * Schedule irrigation across all zones, respecting pump constraints
 *
 * @param {Array} zones - Zone configs
 * @param {object} zoneSensorData - Sensor data by zone id
 * @param {object} irrigationRules - Rules by zone id
 * @param {object} weatherData - Current weather
 * @returns {object} Schedule with prioritized zones
 */
function generateSchedule(zones, zoneSensorData, irrigationRules, weatherData, growthStages, actuators) {
  const now = new Date();
  const window = selectIrrigationWindow();

  // Calculate plans and priorities for each zone
  const zonePlans = zones.map(zone => {
    const sensor = zoneSensorData[zone.id] || {};
    const rule = irrigationRules[zone.id] || {};

    const { priority, breakdown, plan } = calculatePriority(zone, sensor, rule, weatherData);

    // Check if zone can irrigate (cooldown, rain pause, enabled)
    const canIrrigate = checkCanIrrigate(rule, weatherData, actuators || null, zone);

    return {
      zoneId: zone.id,
      zoneName: zone.name,
      crop: zone.crop,
      pumpId: zone.pumpId,
      valveId: zone.valveId,
      plan,
      priority,
      priorityBreakdown: breakdown,
      canIrrigate,
      estimatedDurationMin: estimateDuration(plan, zone),
      estimatedVolumeLiters: plan ? plan.volumeLiters : 0
    };
  });

  // Sort by priority (highest first)
  zonePlans.sort((a, b) => b.priority - a.priority);

  // Assign time slots respecting pump constraints
  const schedule = assignTimeSlots(zonePlans, window, actuators);

  const result = {
    date: now.toISOString().split('T')[0],
    generatedAt: now.toISOString(),
    window,
    zones: schedule,
    summary: {
      totalZones: schedule.length,
      zonesToIrrigate: schedule.filter(z => z.scheduled).length,
      totalVolumeLiters: schedule.filter(z => z.scheduled).reduce((sum, z) => sum + z.estimatedVolumeLiters, 0),
      totalDurationMin: schedule.filter(z => z.scheduled).reduce((sum, z) => sum + z.estimatedDurationMin, 0)
    }
  };

  // Store in history
  storeSchedule(result);

  return result;
}

/**
 * Check if a zone can irrigate (cooldown, rain, enabled, etc.)
 */
function checkCanIrrigate(rule, weather, actuators, zone) {
  if (!rule.enabled) return { allowed: false, reason: 'disabled' };

  // Cooldown check
  if (rule.lastIrrigation) {
    const elapsed = (Date.now() - rule.lastIrrigation) / 60000;
    if (elapsed < rule.cooldownMin) {
      return { allowed: false, reason: 'cooldown', remainingMin: Math.ceil(rule.cooldownMin - elapsed) };
    }
  }

  // Rain pause
  if (rule.rainPause && weather.rainfall > rule.rainThreshold) {
    return { allowed: false, reason: 'rain-pause', rainfall: weather.rainfall };
  }

  // Actuator state
  if (actuators) {
    const valve = actuators[zone.valveId];
    if (valve && valve.state === 'open') {
      return { allowed: false, reason: 'already-irrigating' };
    }
  }

  return { allowed: true, reason: 'ok' };
}

/**
 * Estimate irrigation duration in minutes
 */
function estimateDuration(plan, zone) {
  if (!plan || !plan.volumeLiters || plan.volumeLiters <= 0) return 0;

  const pumpId = zone.pumpId;
  const pumpConstraint = PUMP_CONSTRAINTS[pumpId];
  const flowRate = pumpConstraint ? pumpConstraint.flowRate : 30;

  return Math.max(5, Math.ceil(plan.volumeLiters / flowRate));
}

/**
 * Assign time slots respecting pump capacity constraints
 * pump-1 (50 L/min) shared by zone-A + zone-B
 * pump-2 (30 L/min) dedicated to zone-C
 */
function assignTimeSlots(zonePlans, window, actuators) {
  const scheduled = [];
  let currentOffsetMin = 0;

  // Track pump usage: pump id → array of { start, end } offsets
  const pumpSchedule = {};

  for (const plan of zonePlans) {
    if (!plan.canIrrigate.allowed) {
      scheduled.push({
        ...plan,
        scheduled: false,
        skipReason: plan.canIrrigate.reason,
        scheduledTime: null
      });
      continue;
    }

    if (plan.estimatedDurationMin <= 0) {
      scheduled.push({
        ...plan,
        scheduled: false,
        skipReason: 'no-water-need',
        scheduledTime: null
      });
      continue;
    }

    // Check if pump is available (no overlap with other zones using same pump)
    const pumpId = plan.pumpId;
    if (!pumpSchedule[pumpId]) pumpSchedule[pumpId] = [];

    // Find earliest slot where this pump is free
    let startOffset = currentOffsetMin;
    for (const slot of pumpSchedule[pumpId]) {
      if (startOffset < slot.end && startOffset + plan.estimatedDurationMin > slot.start) {
        startOffset = slot.end; // wait for pump to be free
      }
    }

    const endOffset = startOffset + plan.estimatedDurationMin;
    pumpSchedule[pumpId].push({ start: startOffset, end: endOffset });

    // Calculate actual time
    const now = new Date();
    const scheduledStart = new Date(now.getTime() + startOffset * 60000);
    const scheduledEnd = new Date(now.getTime() + endOffset * 60000);

    scheduled.push({
      ...plan,
      scheduled: true,
      scheduledTime: {
        start: scheduledStart.toISOString(),
        end: scheduledEnd.toISOString(),
        startOffsetMin: startOffset,
        durationMin: plan.estimatedDurationMin
      }
    });

    // Move offset for next zone (sequential within pump group)
    if (pumpSchedule[pumpId].length > 1) {
      currentOffsetMin = endOffset;
    }
  }

  return scheduled;
}

/**
 * Store schedule in history
 */
function storeSchedule(schedule) {
  const dateKey = schedule.date;
  scheduleHistory.set(dateKey, schedule);

  // Prune old entries
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_HISTORY_DAYS);
  for (const key of scheduleHistory.keys()) {
    if (new Date(key) < cutoff) {
      scheduleHistory.delete(key);
    }
  }
}

/**
 * Get schedule history for past N days
 * @param {number} days - Number of days (default 7)
 * @returns {Array} Past schedules
 */
function getScheduleHistory(days = 7) {
  const result = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateKey = date.toISOString().split('T')[0];

    if (scheduleHistory.has(dateKey)) {
      result.push(scheduleHistory.get(dateKey));
    } else {
      result.push({
        date: dateKey,
        status: 'no-data',
        generatedAt: null,
        zones: []
      });
    }
  }

  return result;
}

module.exports = {
  generateSchedule,
  calculatePriority,
  calculateUrgency,
  calculateWaterStress,
  selectIrrigationWindow,
  getScheduleHistory,
  IRRIGATION_WINDOWS,
  CROP_VALUE_FACTORS,
  PUMP_CONSTRAINTS
};
