/**
 * SmartFarm DakLak — Weather Module
 * Weather widget rendering
 */
const Weather = (() => {
  function render(state) {
    const w = state.weather || {};
    const grid = document.getElementById('weather-grid');
    const forecast = document.getElementById('forecast-list');

    if (grid) {
      grid.innerHTML = `
        <div class="weather-item"><div class="w-icon">🌡️</div><div class="w-value">${w.temperature?.toFixed(1) || '--'}°C</div><div class="w-label">Nhiệt độ</div></div>
        <div class="weather-item"><div class="w-icon">💧</div><div class="w-value">${w.humidity?.toFixed(0) || '--'}%</div><div class="w-label">Độ ẩm</div></div>
        <div class="weather-item"><div class="w-icon">🌧️</div><div class="w-value">${w.rainfall?.toFixed(1) || '0'} mm</div><div class="w-label">Mưa</div></div>
        <div class="weather-item"><div class="w-icon">💨</div><div class="w-value">${w.windSpeed?.toFixed(0) || '--'} km/h</div><div class="w-label">Gió</div></div>
        <div class="weather-item"><div class="w-icon">☁️</div><div class="w-value">${w.cloudCover?.toFixed(0) || '--'}%</div><div class="w-label">Mây</div></div>
      `;
    }

    if (forecast) {
      forecast.innerHTML = (w.forecast || []).map(f => `
        <div class="forecast-row">
          <span>${f.day}</span>
          <span>${f.desc}</span>
          <span>🌡️ ${f.temp}°C</span>
          <span>🌧️ ${f.rain}mm</span>
        </div>
      `).join('');
    }

    // Update weather pill status
    const pill = document.getElementById('pill-weather');
    if (pill) {
      const ok = w.temperature != null;
      pill.className = ok ? 'pill ok' : 'pill err';
      pill.innerHTML = `<span class="dot"></span>Weather`;
    }
  }

  return { render };
})();
