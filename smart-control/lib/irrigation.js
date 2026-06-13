// Irrigation logic - extracted for testability

/**
 * Check if irrigation should be triggered for a zone
 * @param {object} sensor - Current sensor data { moisture }
 * @param {object} rule - Irrigation rule { enabled, moistureMin, moistureMax, cooldownMin, rainPause, rainThreshold, lastIrrigation }
 * @param {object} weather - Weather data { rainfall }
 * @param {object} actuator - Actuator state { state: 'open'|'closed' }
 * @returns {object} { shouldIrrigate, reason }
 */
function shouldStartIrrigation(sensor, rule, weather, actuator) {
  if (!rule.enabled) {
    return { shouldIrrigate: false, reason: 'disabled' };
  }

  // Cooldown check
  if (rule.lastIrrigation) {
    const elapsed = (Date.now() - rule.lastIrrigation) / 60000;
    if (elapsed < rule.cooldownMin) {
      return { shouldIrrigate: false, reason: 'cooldown' };
    }
  }

  // Rain pause check
  if (rule.rainPause && weather.rainfall > rule.rainThreshold) {
    return { shouldIrrigate: false, reason: 'rain-pause' };
  }

  // Moisture check
  if (sensor.moisture < rule.moistureMin && actuator.state === 'closed') {
    return { shouldIrrigate: true, reason: 'moisture-low' };
  }

  return { shouldIrrigate: false, reason: 'moisture-ok' };
}

/**
 * Check if irrigation should stop (target reached)
 * @param {object} sensor - Current sensor data { moisture }
 * @param {object} rule - Irrigation rule { moistureMax }
 * @param {object} actuator - Actuator state { state: 'open'|'closed' }
 * @returns {boolean}
 */
function shouldStopIrrigation(sensor, rule, actuator) {
  return sensor.moisture >= rule.moistureMax && actuator.state === 'open';
}

/**
 * Check if rain should pause active irrigation
 * @param {object} weather - Weather data { rainfall }
 * @param {object} rule - Irrigation rule { rainPause, rainThreshold }
 * @param {object} actuator - Actuator state { state }
 * @returns {boolean}
 */
function shouldPauseForRain(weather, rule, actuator) {
  return rule.rainPause && weather.rainfall > rule.rainThreshold && actuator.state === 'open';
}

/**
 * Validate and sanitize sensor values
 * @param {*} val - Input value
 * @param {number} min - Minimum allowed
 * @param {number} max - Maximum allowed
 * @returns {number|null}
 */
function sanitizeSensorValue(val, min, max) {
  const num = parseFloat(val);
  if (typeof num !== 'number' || !Number.isFinite(num)) return null;
  return Math.max(min, Math.min(max, num));
}

module.exports = {
  shouldStartIrrigation,
  shouldStopIrrigation,
  shouldPauseForRain,
  sanitizeSensorValue
};
