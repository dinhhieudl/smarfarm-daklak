// SmartFarm DakLak - Reference Evapotranspiration (ET₀) Calculator
// Implements Hargreaves-Samani simplified equation
// ET₀ = 0.0023 × (Tmean + 17.8) × (Tmax - Tmin)^0.5 × Ra
// Ra = extraterrestrial radiation estimated from latitude and day of year

const LATITUDE = 12.75; // DakLak, Vietnam (degrees North)

/**
 * Get day of year (1-366)
 * @param {Date} [date]
 * @returns {number}
 */
function getDayOfYear(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

/**
 * Calculate extraterrestrial radiation (Ra) in MJ/m²/day
 * Based on FAO-56 Allen et al. (1998)
 * @param {number} latitude - Latitude in degrees
 * @param {number} dayOfYear - Day of year (1-366)
 * @returns {number} Ra in MJ/m²/day
 */
function calculateRa(latitude = LATITUDE, dayOfYear = null) {
  if (dayOfYear === null) dayOfYear = getDayOfYear();

  const latRad = (Math.PI / 180) * latitude;

  // Solar declination (radians)
  const dr = 1 + 0.033 * Math.cos(2 * Math.PI * dayOfYear / 365);
  const delta = 0.409 * Math.sin(2 * Math.PI * dayOfYear / 365 - 1.39);

  // Sunset hour angle
  const ws = Math.acos(-Math.tan(latRad) * Math.tan(delta));

  // Extraterrestrial radiation (MJ/m²/day)
  const Gsc = 0.0820; // Solar constant (MJ/m²/min)
  const Ra = (24 * 60 / Math.PI) * Gsc * dr *
    (ws * Math.sin(latRad) * Math.sin(delta) +
     Math.cos(latRad) * Math.cos(delta) * Math.sin(ws));

  return Math.max(0, Ra);
}

/**
 * Calculate ET₀ using Hargreaves-Samani equation
 * ET₀ = 0.0023 × (Tmean + 17.8) × (Tmax - Tmin)^0.5 × Ra
 *
 * @param {object} params
 * @param {number} params.temperature - Current/mean temperature (°C)
 * @param {number} [params.tempMax] - Maximum temperature (°C). Defaults to temperature + 3
 * @param {number} [params.tempMin] - Minimum temperature (°C). Defaults to temperature - 3
 * @param {number} [params.humidity] - Relative humidity (%), used for adjustment
 * @param {number} [params.windSpeed] - Wind speed at 2m height (m/s), used for adjustment
 * @param {number} [params.solarRadiation] - Solar radiation (MJ/m²/day), replaces Ra estimation if provided
 * @param {Date} [params.date] - Date for day-of-year calculation
 * @returns {object} { et0, method, inputs, breakdown }
 */
function calculateET0({ temperature, tempMax, tempMin, humidity, windSpeed, solarRadiation, date }) {
  // Validate required input
  if (temperature == null || typeof temperature !== 'number' || !Number.isFinite(temperature)) {
    return { et0: 0, method: 'invalid', error: 'Temperature is required and must be a finite number' };
  }

  // Default temp range if not provided (±3°C from mean)
  if (tempMax == null) tempMax = temperature + 3;
  if (tempMin == null) tempMin = temperature - 3;

  // Ensure tempMax > tempMin
  if (tempMax <= tempMin) {
    tempMax = temperature + 1;
    tempMin = temperature - 1;
  }

  const Tmean = temperature;
  const dayOfYear = getDayOfYear(date || new Date());

  // Extraterrestrial radiation
  const Ra = solarRadiation || calculateRa(LATITUDE, dayOfYear);

  // Hargreaves-Samani equation
  const tempRange = Math.sqrt(Math.max(0.1, tempMax - tempMin));
  const et0_hargreaves = 0.0023 * (Tmean + 17.8) * tempRange * Ra;

  // Clamp to reasonable range (0-15 mm/day for tropical regions)
  const et0 = Math.max(0, Math.min(15, et0_hargreaves));

  return {
    et0: Math.round(et0 * 100) / 100,
    method: 'hargreaves-samani',
    inputs: {
      temperature: Tmean,
      tempMax,
      tempMin,
      humidity: humidity ?? null,
      windSpeed: windSpeed ?? null,
      latitude: LATITUDE,
      dayOfYear,
      Ra: Math.round(Ra * 100) / 100
    },
    breakdown: {
      tempTerm: Math.round((Tmean + 17.8) * 100) / 100,
      rangeTerm: Math.round(tempRange * 100) / 100,
      radiation: Math.round(Ra * 100) / 100,
      rawET0: Math.round(et0_hargreaves * 100) / 100
    }
  };
}

/**
 * Calculate crop evapotranspiration (ETc)
 * ETc = ET₀ × Kc
 *
 * Kc values for coffee (DakLak):
 * - dormant: 0.7
 * - flowering: 0.95
 * - fruit-set: 1.05
 * - fruit-growth: 1.1
 * - ripening: 0.9
 * - harvest: 0.8
 */
const KC_VALUES = {
  dormant: 0.7,
  flowering: 0.95,
  'fruit-set': 1.05,
  'fruit-growth': 1.1,
  ripening: 0.9,
  harvest: 0.8
};

/**
 * Calculate crop evapotranspiration (ETc)
 * @param {number} et0 - Reference evapotranspiration (mm/day)
 * @param {string} growthStage - Crop growth stage id
 * @returns {object} { etc, kc, stage }
 */
function calculateETc(et0, growthStage) {
  const kc = KC_VALUES[growthStage] || 0.85; // default Kc if stage unknown
  const etc = et0 * kc;

  return {
    etc: Math.round(etc * 100) / 100,
    kc,
    stage: growthStage,
    kcSource: KC_VALUES[growthStage] ? 'table' : 'default'
  };
}

/**
 * Calculate irrigation water requirement
 * IR = ETc - effective rainfall - soil moisture deficit
 *
 * @param {object} params
 * @param {number} params.etc - Crop evapotranspiration (mm/day)
 * @param {number} [params.effectiveRainfall=0] - Effective rainfall (mm)
 * @param {number} [params.currentMoisture=50] - Current soil moisture (%)
 * @param {number} [params.targetMoisture=60] - Target soil moisture (%)
 * @param {number} [params.soilDepth=30] - Root zone depth (cm)
 * @returns {object} { irrigationNeed, breakdown }
 */
function calculateIrrigationNeed({ etc, effectiveRainfall = 0, currentMoisture = 50, targetMoisture = 60, soilDepth = 30 }) {
  // Soil moisture deficit (mm equivalent)
  const moistureDeficit = Math.max(0, (targetMoisture - currentMoisture) * soilDepth * 0.1);

  // Net irrigation need (mm)
  const netNeed = Math.max(0, etc - effectiveRainfall + moistureDeficit);

  return {
    irrigationNeed: Math.round(netNeed * 100) / 100,
    irrigationLitersPerM2: Math.round(netNeed * 100) / 100,
    breakdown: {
      etc: Math.round(etc * 100) / 100,
      effectiveRainfall: Math.round(effectiveRainfall * 100) / 100,
      moistureDeficit: Math.round(moistureDeficit * 100) / 100,
      currentMoisture,
      targetMoisture,
      soilDepth
    }
  };
}

/**
 * Full irrigation plan for a zone
 */
function getIrrigationPlan(zone, sensor, weather, growthStage) {
  const et0Result = calculateET0({
    temperature: weather.temperature || sensor.temperature || 28,
    humidity: weather.humidity,
    windSpeed: weather.windSpeed
  });

  const etcResult = calculateETc(et0Result.et0, growthStage);
  const effectiveRainfall = (weather.rainfall || 0) * 0.75;

  const stageTargets = {
    dormant: 30, flowering: 55, 'fruit-set': 60,
    'fruit-growth': 55, ripening: 40, harvest: 35
  };
  const targetMoisture = stageTargets[growthStage] || 55;

  const needResult = calculateIrrigationNeed({
    etc: etcResult.etc,
    effectiveRainfall,
    currentMoisture: sensor.moisture || 50,
    targetMoisture
  });

  const areaM2 = zone.area || 1000;
  const volumeLiters = needResult.irrigationLitersPerM2 * areaM2;

  return {
    zoneId: zone.id,
    zoneName: zone.name,
    crop: zone.crop,
    growthStage,
    timestamp: new Date().toISOString(),
    et0: et0Result,
    etc: etcResult,
    irrigation: {
      ...needResult,
      volumeLiters: Math.round(volumeLiters),
      areaM2,
      targetMoisture
    },
    recommendation: getRecommendation(needResult.irrigationNeed, weather.rainfall || 0, sensor.moisture, targetMoisture)
  };
}

function getRecommendation(irrigationNeed, rainfall, currentMoisture, targetMoisture) {
  if (rainfall > 20) {
    return { action: 'skip', reason: 'Mưa lớn — tạm dừng tưới', priority: 'low' };
  }
  if (currentMoisture >= targetMoisture) {
    return { action: 'none', reason: 'Độ ẩm đất đạt mục tiêu', priority: 'none' };
  }
  if (irrigationNeed > 10) {
    return { action: 'irrigate', reason: `Cần tưới ${irrigationNeed.toFixed(1)} mm`, priority: 'high' };
  }
  if (irrigationNeed > 3) {
    return { action: 'irrigate', reason: `Nên tưới ${irrigationNeed.toFixed(1)} mm`, priority: 'medium' };
  }
  return { action: 'monitor', reason: 'Nhu cầu nước thấp, theo dõi thêm', priority: 'low' };
}

module.exports = {
  calculateET0, calculateETc, calculateIrrigationNeed,
  getIrrigationPlan, calculateRa, getDayOfYear, KC_VALUES, LATITUDE
};
