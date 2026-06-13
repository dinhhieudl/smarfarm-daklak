// lib/eto.js — Reference Evapotranspiration (ET₀) calculation
// FAO Penman-Monteith method (FAO-56)
// https://www.fao.org/3/x0490e/x0490e08.htm

/**
 * Calculate saturation vapor pressure at temperature T (°C)
 * @param {number} T - Air temperature in °C
 * @returns {number} es in kPa
 */
function saturationVaporPressure(T) {
  return 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
}

/**
 * Calculate slope of saturation vapor pressure curve at T
 * @param {number} T - Air temperature in °C
 * @returns {number} Δ in kPa/°C
 */
function slopeVaporPressure(T) {
  const es = saturationVaporPressure(T);
  return (4098 * es) / Math.pow(T + 237.3, 2);
}

/**
 * Calculate psychrometric constant at given altitude
 * @param {number} altitude - Altitude in meters (DakLak ~500m)
 * @returns {number} γ in kPa/°C
 */
function psychrometricConstant(altitude = 500) {
  const P = 101.3 * Math.pow((293 - 0.0065 * altitude) / 293, 5.26);
  return 0.000665 * P;
}

/**
 * Calculate ET₀ using FAO Penman-Monteith equation
 * ET₀ = [0.408Δ(Rn - G) + γ(900/(T+273))u₂(es - ea)] / [Δ + γ(1 + 0.34u₂)]
 *
 * @param {object} params
 * @param {number} params.temperature - Mean air temperature (°C)
 * @param {number} params.humidity - Mean relative humidity (%)
 * @param {number} params.windSpeed - Wind speed at 2m height (m/s)
 * @param {number} params.solarRadiation - Solar radiation (MJ/m²/day). Estimated from cloud cover if not provided.
 * @param {number} params.cloudCover - Cloud cover (%). Used to estimate solar radiation.
 * @param {number} params.altitude - Station altitude (m). Default 500 (DakLak).
 * @returns {number} ET₀ in mm/day
 */
function calculateET0(params) {
  const {
    temperature: T,
    humidity: RH,
    windSpeed: u2 = 2,
    solarRadiation: inputRs,
    cloudCover,
    altitude = 500
  } = params;
  let Rs = inputRs;

  if (T == null || RH == null) return null;

  // Psychrometric constant
  const gamma = psychrometricConstant(altitude);

  // Slope of vapor pressure curve
  const delta = slopeVaporPressure(T);

  // Saturation vapor pressure
  const es = saturationVaporPressure(T);

  // Actual vapor pressure
  const ea = es * (RH / 100);

  // Net radiation (simplified)
  // If solar radiation not provided, estimate from cloud cover
  let Rn;
  if (Rs != null) {
    // Rn ≈ 0.75 * Rs for daily estimates (net shortwave) minus net longwave
    Rn = 0.75 * Rs - 2.0; // Simplified net radiation
  } else if (cloudCover != null) {
    // Estimate solar radiation from cloud cover
    // Clear sky radiation for DakLak (lat ~12.75°N) ≈ 20-25 MJ/m²/day
    const Ra = 22; // Approximate extraterrestrial radiation for DakLak
    const n_N = (100 - cloudCover) / 100; // Sunshine hours ratio
    Rs = (0.25 + 0.50 * n_N) * Ra;
    Rn = 0.75 * Rs - 2.0;
  } else {
    // Default estimate for partly cloudy conditions
    Rn = 10; // MJ/m²/day
  }

  // Soil heat flux (G ≈ 0 for daily calculations)
  const G = 0;

  // Wind speed at 2m (if measured at different height, adjust)
  // Assuming input is already at 2m height

  // FAO Penman-Monteith equation
  const numerator = 0.408 * delta * (Rn - G) + gamma * (900 / (T + 273)) * u2 * (es - ea);
  const denominator = delta + gamma * (1 + 0.34 * u2);

  let ET0 = numerator / denominator;

  // Clamp to reasonable range (0-15 mm/day for tropical regions)
  ET0 = Math.max(0, Math.min(15, ET0));

  return Math.round(ET0 * 100) / 100;
}

/**
 * Calculate crop ET (ETc) = ET₀ × Kc
 * @param {number} ET0 - Reference ET (mm/day)
 * @param {number} Kc - Crop coefficient
 * @returns {number} ETc in mm/day
 */
function calculateETc(ET0, Kc) {
  if (ET0 == null || Kc == null) return null;
  return Math.round(ET0 * Kc * 100) / 100;
}

/**
 * Get crop coefficient (Kc) for coffee at different growth stages
 * Based on FAO-56 Table 12 and coffee-specific literature
 *
 * @param {string} crop - 'robusta' or 'arabica'
 * @param {string} stageId - Growth stage id
 * @returns {number} Kc value
 */
function getCropCoefficient(crop, stageId) {
  const kcValues = {
    robusta: {
      dormant: 0.40,      // Nghỉ - minimal transpiration
      flowering: 0.85,    // Ra hoa - active growth begins
      'fruit-set': 1.00,  // Đậu quả - full canopy, high demand
      'fruit-growth': 1.05, // Phát triển quả - peak water demand
      ripening: 0.80,     // Chín - reducing demand
      harvest: 0.50       // Thu hoạch - post-harvest recovery
    },
    arabica: {
      dormant: 0.35,
      flowering: 0.80,
      'fruit-set': 0.95,
      'fruit-growth': 1.00,
      ripening: 0.75,
      harvest: 0.45
    }
  };

  const cropKc = kcValues[crop];
  if (!cropKc) return 0.8; // Default Kc
  return cropKc[stageId] ?? 0.8;
}

/**
 * Estimate days until next irrigation based on water balance
 * @param {number} currentMoisture - Current soil moisture (%)
 * @param {number} targetMoisture - Target moisture threshold (%)
 * @param {number} ETc - Crop evapotranspiration (mm/day)
 * @param {number} availableWater - Available water capacity of soil (mm/m)
 * @param {number} rootDepth - Effective root depth (m). Default 0.5m for coffee.
 * @returns {number} Estimated days until irrigation needed
 */
function estimateDaysToIrrigation(currentMoisture, targetMoisture, ETc, availableWater = 100, rootDepth = 0.5) {
  if (currentMoisture <= targetMoisture) return 0;
  if (ETc <= 0) return 999;

  // Total available water in root zone (mm)
  const TAW = availableWater * rootDepth;

  // Depletion threshold (typically 50% of TAW for coffee)
  const depletionThreshold = TAW * 0.5;

  // Current moisture above target (percentage points)
  const moistureSurplus = currentMoisture - targetMoisture;

  // Convert moisture surplus to mm of water
  // Rough: 1% moisture ≈ 1mm in top 50cm of soil
  const waterSurplus = moistureSurplus * rootDepth;

  // Days = water surplus / daily ETc
  const days = waterSurplus / ETc;

  return Math.max(0, Math.round(days * 10) / 10);
}

module.exports = {
  calculateET0,
  calculateETc,
  getCropCoefficient,
  estimateDaysToIrrigation,
  saturationVaporPressure,
  slopeVaporPressure,
  psychrometricConstant
};
