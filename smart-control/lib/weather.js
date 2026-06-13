// SmartFarm DakLak - Real Weather API Integration
// Uses Open-Meteo API (free, no key needed) for DakLak coordinates

const DAKLAK_LAT = 12.75;
const DAKLAK_LON = 108.35;
const CACHE_DURATION_MS = 30 * 60 * 1000; // 30 minutes

const WEATHER_PARAMS = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'wind_speed_10m',
  'cloud_cover'
].join(',');

// Cache
let cachedWeather = null;
let lastFetchTime = 0;

/**
 * Fetch current weather + 3-day forecast from Open-Meteo
 * Returns structured weather data or null on failure
 */
async function fetchWeatherFromAPI() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', DAKLAK_LAT);
  url.searchParams.set('longitude', DAKLAK_LON);
  url.searchParams.set('current', WEATHER_PARAMS);
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode');
  url.searchParams.set('forecast_days', '3');
  url.searchParams.set('timezone', 'Asia/Ho_Chi_Minh');

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10000) // 10s timeout
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo API returned ${response.status}`);
    }

    const data = await response.json();
    return parseWeatherData(data);
  } catch (err) {
    console.error('[Weather] API fetch failed:', err.message);
    return null;
  }
}

/**
 * Parse Open-Meteo response into our weather format
 */
function parseWeatherData(data) {
  const current = data.current || {};
  const daily = data.daily || {};

  // Map weather codes to descriptions
  const weatherCodes = {
    0: 'Trời quang', 1: 'Ít mây', 2: 'Mây rải rác', 3: 'Nhiều mây',
    45: 'Sương mù', 48: 'Sương mù đóng băng',
    51: 'Mưa phùn nhẹ', 53: 'Mưa phùn', 55: 'Mưa phùn nặng',
    61: 'Mưa nhẹ', 63: 'Mưa vừa', 65: 'Mưa to',
    71: 'Tuyết nhẹ', 73: 'Tuyết vừa', 75: 'Tuyết to',
    80: 'Mưa rào nhẹ', 81: 'Mưa rào', 82: 'Mưa rào to',
    95: 'Giông bão', 96: 'Giông bão + mưa đá nhỏ', 99: 'Giông bão + mưa đá to'
  };

  // Build 3-day forecast
  const forecast = [];
  const days = ['Hôm nay', 'Ngày mai', 'Ngày kia'];
  if (daily.time && daily.time.length > 0) {
    for (let i = 0; i < Math.min(3, daily.time.length); i++) {
      const code = daily.weathercode ? daily.weathercode[i] : 0;
      forecast.push({
        day: days[i] || daily.time[i],
        date: daily.time[i],
        tempMax: daily.temperature_2m_max ? daily.temperature_2m_max[i] : null,
        tempMin: daily.temperature_2m_min ? daily.temperature_2m_min[i] : null,
        temp: daily.temperature_2m_max ? Math.round((daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2) : null,
        rain: daily.precipitation_sum ? daily.precipitation_sum[i] : 0,
        weatherCode: code,
        desc: weatherCodes[code] || 'Không xác định'
      });
    }
  }

  return {
    temperature: current.temperature_2m ?? null,
    humidity: current.relative_humidity_2m ?? null,
    rainfall: current.precipitation ?? 0,
    windSpeed: current.wind_speed_10m ?? null,
    cloudCover: current.cloud_cover ?? null,
    forecast,
    lastUpdate: new Date().toISOString(),
    source: 'open-meteo'
  };
}

/**
 * Simulated weather fallback (based on DakLak seasonal patterns)
 */
function getSimulatedWeather() {
  const month = new Date().getMonth() + 1;
  const isRainy = month >= 5 && month <= 10;

  return {
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
}

/**
 * Get weather data (cached or fresh fetch)
 * Falls back to simulated data if API fails
 */
async function getWeather() {
  const now = Date.now();

  // Return cache if still valid
  if (cachedWeather && (now - lastFetchTime) < CACHE_DURATION_MS) {
    return cachedWeather;
  }

  // Try fetching from API
  const apiData = await fetchWeatherFromAPI();

  if (apiData) {
    cachedWeather = apiData;
    lastFetchTime = now;
    console.log('[Weather] Fetched from Open-Meteo API');
    return cachedWeather;
  }

  // Fallback to simulated
  if (!cachedWeather) {
    cachedWeather = getSimulatedWeather();
    lastFetchTime = now;
    console.log('[Weather] Using simulated data (API unavailable)');
  }

  return cachedWeather;
}

/**
 * Force refresh weather (bypasses cache)
 */
async function refreshWeather() {
  lastFetchTime = 0;
  return getWeather();
}

/**
 * Get cached weather without fetching (returns null if no cache)
 */
function getCachedWeather() {
  return cachedWeather;
}

module.exports = {
  getWeather,
  refreshWeather,
  getCachedWeather,
  getSimulatedWeather,
  CACHE_DURATION_MS
};
