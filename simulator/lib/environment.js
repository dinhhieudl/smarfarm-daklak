// ─── Environment Model ────────────────────────────────
// Mô phỏng môi trường DakLak: chu kỳ ngày/đêm, mưa, bức xạ mặt trời

/**
 * DakLak climate model
 * - Vĩ độ: 12.75°N (nhiệt đới, cận xích đạo)
 * - Mùa khô: Nov-Apr, mùa mưa: May-Oct
 * - Nhiệt độ đỉnh: 14:00, đáy: 05:00
 */

// Diurnal temperature model (sinusoidal approximation)
// T(t) = T_mean + T_amplitude * sin(2π * (t - phase_shift) / 24)
function getDiurnalTemperature(hour, month, baseTemp = null) {
  const isRainy = month >= 5 && month <= 10;

  // Mean temperature by season
  const T_mean = baseTemp || (isRainy ? 26 : 30);
  // Amplitude: dry season has wider swing
  const T_amplitude = isRainy ? 4 : 7;
  // Phase shift: peak at 14:00 (hour 14), trough at 05:00
  const phase_shift = 14;

  const temp = T_mean + T_amplitude * Math.sin(2 * Math.PI * (hour - phase_shift) / 24);

  // Add small random cloud effect
  const cloudEffect = isRainy ? (Math.random() - 0.5) * 3 : (Math.random() - 0.5) * 1.5;

  return temp + cloudEffect;
}

// Solar radiation model (W/m²)
function getSolarRadiation(hour) {
  // Sunrise ~05:30, Sunset ~18:00 (DakLak, near equator)
  if (hour < 5.5 || hour > 18) return 0;

  // Bell curve centered at solar noon (12:00)
  const solarNoon = 12;
  const dayLength = 12.5; // hours
  const maxRadiation = 900; // W/m² tropical noon

  const x = (hour - solarNoon) / (dayLength / 2);
  return maxRadiation * Math.exp(-2 * x * x);
}

// Reference Evapotranspiration (ET₀) - Simplified Penman-Monteith
// Returns mm/hour
function getET0(temperature, humidity, windSpeed, solarRadiation) {
  // Simplified Hargreaves-Samani equation
  // ET₀ = 0.0023 * (T_mean + 17.8) * (T_max - T_min)^0.5 * Ra
  // We use hourly approximation:
  const Ra = solarRadiation / 1000; // Convert W/m² to MJ/m²/hour (approx /3.6)
  const delta = 0.409 * Math.sin(2 * Math.PI * (getDayOfYear() / 365) - 1.39); // solar declination

  // Latent heat of vaporization
  const lambda = 2.501 - 0.002361 * temperature; // MJ/kg

  // Psychrometric constant
  const gamma = 0.000665 * 101.3; // kPa/°C (approx at sea level)

  // Saturation vapor pressure slope
  const es = 0.6108 * Math.exp(17.27 * temperature / (temperature + 237.3));
  const Delta = 4098 * es / Math.pow(temperature + 237.3, 2);

  // Simplified: radiation component dominates
  const Rn = 0.75 * Ra; // Net radiation (simplified)
  const G = 0; // Soil heat flux (negligible hourly)

  const et0 = (0.408 * Delta * (Rn - G) + gamma * (37 / (temperature + 273)) * windSpeed * (es - es * humidity / 100)) /
              (Delta + gamma * (1 + 0.34 * windSpeed));

  return Math.max(0, et0); // mm/hour
}

function getDayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now - start) / 86400000);
}

// Rain model for DakLak
function getRainfallProbability(hour, month) {
  const isRainy = month >= 5 && month <= 10;
  if (!isRainy) return 0;

  // Higher probability in afternoon (convective rain)
  let prob = 0.05; // base 5% per tick
  if (hour >= 13 && hour <= 18) prob = 0.25; // 25% in afternoon
  if (hour >= 10 && hour < 13) prob = 0.10;

  return prob;
}

function generateRainfall(probability) {
  if (Math.random() > probability) return 0;
  // Exponential distribution: most rain events are light, some heavy
  const intensity = -Math.log(1 - Math.random()) * 5; // mm, mean ~5mm
  return Math.min(80, intensity); // cap at 80mm per tick
}

// Humidity model (inversely related to temperature)
function getDiurnalHumidity(hour, month, rainfall = 0) {
  const isRainy = month >= 5 && month <= 10;
  const base = isRainy ? 80 : 55;

  // Humidity inversely tracks temperature
  const amplitude = isRainy ? 10 : 20;
  const phase_shift = 14; // lowest at peak temp

  let humidity = base - amplitude * Math.sin(2 * Math.PI * (hour - phase_shift) / 24);

  // Rain increases humidity
  if (rainfall > 0) humidity = Math.min(100, humidity + rainfall * 0.5);

  return Math.max(20, Math.min(100, humidity + (Math.random() - 0.5) * 3));
}

// Wind model
function getWindSpeed(hour, month) {
  const isRainy = month >= 5 && month <= 10;
  const base = isRainy ? 8 : 5;
  const peak = isRainy ? 15 : 12;

  // Wind peaks in afternoon
  const factor = Math.sin(Math.PI * Math.max(0, hour - 6) / 14);
  const wind = base + (peak - base) * Math.max(0, factor);

  return wind + (Math.random() - 0.5) * 3;
}

module.exports = {
  getDiurnalTemperature,
  getSolarRadiation,
  getET0,
  getRainfallProbability,
  generateRainfall,
  getDiurnalHumidity,
  getWindSpeed,
  getDayOfYear
};
