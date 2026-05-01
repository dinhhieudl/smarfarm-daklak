// ─── Soil Water Balance Model ─────────────────────────
// Mô phỏng cân bằng nước trong đất cho vùng bazan DakLak

/**
 * Soil Water Balance:
 * Δθ/Δt = (Rainfall + Irrigation - ET₀ - Runoff - DeepDrainage) / RootDepth
 *
 * Soil properties (bazan red - DakLak):
 * - Field Capacity (FC): 35-40% VWC
 * - Permanent Wilting Point (PWP): 15-18% VWC
 * - Saturation: 50-55% VWC
 * - Hydraulic conductivity: moderate
 * - Root depth (coffee): 0.6-1.2m
 */

const SOIL_PROFILES = {
  'bazan-red': {
    name: 'Đất bazan đỏ (DakLak)',
    fieldCapacity: 38,        // %VWC
    wiltingPoint: 16,         // %VWC
    saturation: 52,           // %VWC
    saturatedConductivity: 15, // mm/hour (Ksat)
    rootDepthM: 0.8,          // meters
    bulkDensity: 1.35,        // g/cm³
    organicMatter: 3.5,       // %
    // Water release parameters (van Genuchten approx)
    alpha: 0.036,             // 1/cm
    n: 1.56
  },
  'bazan-yellow': {
    name: 'Đất bazan vàng',
    fieldCapacity: 35,
    wiltingPoint: 14,
    saturation: 48,
    saturatedConductivity: 10,
    rootDepthM: 0.7,
    bulkDensity: 1.40,
    organicMatter: 2.0,
    alpha: 0.030,
    n: 1.48
  }
};

/**
 * Update soil moisture based on water balance
 * @param {number} currentMoisture - Current %VWC
 * @param {number} rainfall - Rainfall in mm (this tick)
 * @param {number} irrigationMm - Irrigation in mm (this tick)
 * @param {number} et0 - Reference ET in mm/hour
 * @param {number} temperature - Air temp °C
 * @param {object} soilProfile - Soil properties
 * @param {number} dtHours - Time step in hours
 * @returns {object} { newMoisture, runoff, drainage, et_actual }
 */
function updateSoilMoisture(currentMoisture, rainfall, irrigationMm, et0, temperature, soilProfile, dtHours) {
  const soil = SOIL_PROFILES[soilProfile] || SOIL_PROFILES['bazan-red'];

  const rootDepthMm = soil.rootDepthM * 1000; // convert to mm

  // Current water content in mm
  const currentWaterMm = (currentMoisture / 100) * rootDepthMm;
  const fcWaterMm = (soil.fieldCapacity / 100) * rootDepthMm;
  const satWaterMm = (soil.saturation / 100) * rootDepthMm;
  const pwpWaterMm = (soil.wiltingPoint / 100) * rootDepthMm;

  // ── Infiltration ──
  const totalInput = rainfall + irrigationMm;
  let infiltration = totalInput;
  let runoff = 0;

  // If soil is near saturation, generate runoff
  if (currentWaterMm + totalInput > satWaterMm) {
    runoff = (currentWaterMm + totalInput) - satWaterMm;
    infiltration = totalInput - runoff;
  }

  // ── Deep Drainage ──
  let drainage = 0;
  if (currentWaterMm > fcWaterMm) {
    // Drainage rate proportional to excess above FC
    const excess = currentWaterMm - fcWaterMm;
    drainage = Math.min(excess, soil.saturatedConductivity * dtHours * (excess / fcWaterMm));
  }

  // ── Actual Evapotranspiration ──
  // Stress coefficient: reduces ET when soil is dry
  let stressFactor = 1.0;
  if (currentMoisture < soil.fieldCapacity) {
    const availableWater = currentMoisture - soil.wiltingPoint;
    const totalAvailable = soil.fieldCapacity - soil.wiltingPoint;
    stressFactor = Math.max(0, availableWater / totalAvailable);
  }
  // Temperature effect on ET
  const tempFactor = Math.min(1.5, Math.max(0.3, temperature / 30));
  const et_actual = et0 * stressFactor * tempFactor * dtHours;

  // ── Water Balance ──
  let newWaterMm = currentWaterMm + infiltration - et_actual - drainage;
  newWaterMm = Math.max(pwpWaterMm, Math.min(satWaterMm, newWaterMm));

  // Convert back to %VWC
  const newMoisture = (newWaterMm / rootDepthMm) * 100;

  return {
    newMoisture: Math.max(0, Math.min(100, newMoisture)),
    runoff: Math.max(0, runoff),
    drainage: Math.max(0, drainage),
    et_actual: Math.max(0, et_actual),
    stressFactor
  };
}

/**
 * Update soil temperature (simplified heat transfer)
 * Soil temperature lags air temperature and has dampened amplitude
 */
function updateSoilTemperature(airTemperature, currentSoilTemp, depthCm = 10, dtHours = 1) {
  // Thermal diffusivity of soil (m²/s) - typical for moist clay loam
  const alpha = 5e-7;

  // Damping depth increases with depth
  const dampingDepth = Math.sqrt(2 * alpha * 86400 / Math.PI); // daily damping depth

  // Time constant for soil-atmosphere coupling
  const tau = 6; // hours (soil responds slowly)
  const coupling = 1 - Math.exp(-dtHours / tau);

  // Soil temp trends toward air temp but with lag
  const targetTemp = airTemperature - 2; // soil is typically slightly cooler
  const newSoilTemp = currentSoilTemp + coupling * (targetTemp - currentSoilTemp);

  return newSoilTemp + (Math.random() - 0.5) * 0.3; // small sensor noise
}

/**
 * Update EC based on moisture and fertilization
 * EC increases when soil dries (concentration effect)
 * EC decreases with rainfall (leaching)
 */
function updateEC(currentEC, moisture, rainfall, irrigationMm, baseEC = 450) {
  // Concentration effect: EC increases as moisture decreases
  const moistureRatio = moisture / 55; // normalize to "normal" moisture
  const concentrationFactor = moistureRatio < 1 ? 1 + (1 - moistureRatio) * 0.5 : 1 - (moistureRatio - 1) * 0.2;

  // Leaching: rain/irrigation reduces EC
  const leaching = (rainfall + irrigationMm) * 2; // EC drops ~2 per mm

  // Slow return to baseline
  const baselinePull = (baseEC - currentEC) * 0.01;

  let newEC = currentEC * concentrationFactor - leaching + baselinePull;
  return Math.max(50, Math.min(8000, newEC));
}

/**
 * Update pH based on moisture, rainfall, and soil buffering
 */
function updatePH(currentPH, rainfall, basePH = 5.8) {
  // Rain is slightly acidic (pH ~5.6), heavy rain can lower soil pH
  let delta = 0;
  if (rainfall > 10) delta -= 0.02;
  if (rainfall > 30) delta -= 0.03;

  // Slow return to baseline
  delta += (basePH - currentPH) * 0.005;

  return Math.max(3.0, Math.min(9.0, currentPH + delta + (Math.random() - 0.5) * 0.02));
}

/**
 * Update NPK based on plant uptake, leaching, and mineralization
 */
function updateNPK(current, rainfall, irrigationMm, plantUptakeRate, baseValues) {
  // Plant uptake (proportional to moisture availability)
  const uptake = plantUptakeRate;

  // Leaching (N and K are mobile, P is less mobile)
  const leachFactor = (rainfall + irrigationMm) * 0.3;

  // Slow mineralization from organic matter
  const mineralization = 0.5; // mg/kg per tick

  // Return toward baseline
  const baselinePull = (baseValues - current) * 0.005;

  return Math.max(5, Math.min(600, current - uptake - leachFactor + mineralization + baselinePull));
}

module.exports = {
  SOIL_PROFILES,
  updateSoilMoisture,
  updateSoilTemperature,
  updateEC,
  updatePH,
  updateNPK
};
