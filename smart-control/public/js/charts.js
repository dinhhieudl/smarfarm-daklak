/**
 * SmartFarm DakLak — Charts Module
 * Historical sensor data visualization using Chart.js
 */
const Charts = (() => {
  let charts = {};
  let currentZone = 'zone-A';
  let currentHours = 24;
  let isLoading = false;

  // Chart color scheme
  const COLORS = {
    moisture: { line: '#2196f3', bg: 'rgba(33,150,243,0.1)' },
    temperature: { line: '#ff9800', bg: 'rgba(255,152,0,0.1)' },
    ec: { line: '#ffd600', bg: 'rgba(255,214,0,0.1)' },
    ph: { line: '#00bcd4', bg: 'rgba(0,188,212,0.1)' },
    nitrogen: { line: '#4caf50', bg: 'rgba(76,175,80,0.1)' },
    phosphorus: { line: '#e91e63', bg: 'rgba(233,30,99,0.1)' },
    potassium: { line: '#9c27b0', bg: 'rgba(156,39,176,0.1)' },
    salinity: { line: '#795548', bg: 'rgba(121,85,72,0.1)' }
  };

  const SENSOR_LABELS = {
    moisture: 'Độ ẩm (%VWC)',
    temperature: 'Nhiệt độ (°C)',
    ec: 'EC (µS/cm)',
    ph: 'pH',
    nitrogen: 'Nitrogen (mg/kg)',
    phosphorus: 'Phosphorus (mg/kg)',
    potassium: 'Potassium (mg/kg)',
    salinity: 'Salinity (mg/kg)'
  };

  /**
   * Render the charts tab UI
   */
  function render(state) {
    const container = document.getElementById('tab-charts');
    if (!container) return;

    const zones = state.zones || [];

    container.innerHTML = `
      <div class="charts-controls">
        <div class="charts-select-group">
          <label>📍 Khu vực:</label>
          <select id="chart-zone-select" onchange="Charts.onZoneChange(this.value)">
            ${zones.map(z => `<option value="${z.id}" ${z.id === currentZone ? 'selected' : ''}>${z.name}</option>`).join('')}
          </select>
        </div>
        <div class="charts-select-group">
          <label>⏱️ Thời gian:</label>
          <select id="chart-hours-select" onchange="Charts.onHoursChange(this.value)">
            <option value="6" ${currentHours === 6 ? 'selected' : ''}>6 giờ</option>
            <option value="24" ${currentHours === 24 ? 'selected' : ''}>24 giờ</option>
            <option value="72" ${currentHours === 72 ? 'selected' : ''}>3 ngày</option>
            <option value="168" ${currentHours === 168 ? 'selected' : ''}>7 ngày</option>
          </select>
        </div>
        <button class="charts-refresh-btn" onclick="Charts.refresh()" ${isLoading ? 'disabled' : ''}>
          ${isLoading ? '⏳ Đang tải...' : '🔄 Làm mới'}
        </button>
      </div>

      <div class="grid grid-2" id="charts-grid">
        <div class="card chart-card">
          <div class="card-title"><span class="icon">💧</span> Độ ẩm & Nhiệt độ</div>
          <div class="chart-container"><canvas id="chart-moisture-temp"></canvas></div>
        </div>
        <div class="card chart-card">
          <div class="card-title"><span class="icon">⚡</span> EC & Salinity</div>
          <div class="chart-container"><canvas id="chart-ec-salinity"></canvas></div>
        </div>
        <div class="card chart-card">
          <div class="card-title"><span class="icon">🧪</span> pH</div>
          <div class="chart-container"><canvas id="chart-ph"></canvas></div>
        </div>
        <div class="card chart-card">
          <div class="card-title"><span class="icon">🌿</span> NPK (Dinh dưỡng)</div>
          <div class="chart-container"><canvas id="chart-npk"></canvas></div>
        </div>
      </div>
    `;

    // Add chart styles
    injectStyles();

    // Load data and render charts
    loadAndRender();
  }

  /**
   * Inject chart-specific CSS
   */
  function injectStyles() {
    if (document.getElementById('charts-styles')) return;
    const style = document.createElement('style');
    style.id = 'charts-styles';
    style.textContent = `
      .charts-controls {
        display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
        margin-bottom: 16px; padding: 12px 16px;
        background: var(--card-bg); border-radius: 12px;
        border: 1px solid var(--border);
      }
      .charts-select-group { display: flex; align-items: center; gap: 8px; }
      .charts-select-group label { font-size: .85rem; color: var(--text-secondary); white-space: nowrap; }
      .charts-select-group select {
        padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border);
        background: var(--bg); color: var(--text); font-size: .85rem;
      }
      .charts-refresh-btn {
        padding: 6px 16px; border-radius: 8px; border: 1px solid var(--border);
        background: var(--bg); color: var(--text); cursor: pointer; font-size: .85rem;
        transition: background .2s;
      }
      .charts-refresh-btn:hover { background: var(--border); }
      .charts-refresh-btn:disabled { opacity: .5; cursor: not-allowed; }
      .chart-card { min-height: 300px; }
      .chart-container { position: relative; width: 100%; height: 250px; }
      .chart-container canvas { width: 100% !important; height: 100% !important; }
      .chart-loading { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-secondary); }
      .chart-empty { display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-secondary); font-style: italic; }
    `;
    document.head.appendChild(style);
  }

  /**
   * Load data from API and render charts
   */
  async function loadAndRender() {
    isLoading = true;
    updateRefreshButton();

    try {
      const data = await API.getHistory(currentZone, currentHours);
      if (data && data.length > 0) {
        renderCharts(data);
      } else {
        renderEmpty();
      }
    } catch (err) {
      console.warn('[Charts] Failed to load data:', err.message);
      renderEmpty();
    } finally {
      isLoading = false;
      updateRefreshButton();
    }
  }

  /**
   * Render all charts with data
   */
  function renderCharts(data) {
    // Destroy existing charts
    Object.values(charts).forEach(c => { if (c && c.destroy) c.destroy(); });
    charts = {};

    const labels = data.map(d => {
      const t = new Date(d.time || d.timestamp);
      return t.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    });

    // Moisture + Temperature (dual axis)
    charts.moistureTemp = createDualAxisChart('chart-moisture-temp', labels, [
      {
        label: SENSOR_LABELS.moisture,
        data: data.map(d => d.moisture),
        borderColor: COLORS.moisture.line,
        backgroundColor: COLORS.moisture.bg,
        yAxisID: 'y',
        fill: true
      },
      {
        label: SENSOR_LABELS.temperature,
        data: data.map(d => d.temperature),
        borderColor: COLORS.temperature.line,
        backgroundColor: COLORS.temperature.bg,
        yAxisID: 'y1',
        fill: false
      }
    ], {
      y: { position: 'left', title: { display: true, text: 'Độ ẩm (%VWC)' }, min: 0, max: 100 },
      y1: { position: 'right', title: { display: true, text: 'Nhiệt độ (°C)' }, grid: { drawOnChartArea: false } }
    });

    // EC + Salinity
    charts.ecSalinity = createChart('chart-ec-salinity', labels, [
      { label: SENSOR_LABELS.ec, data: data.map(d => d.ec), borderColor: COLORS.ec.line, backgroundColor: COLORS.ec.bg, fill: true },
      { label: SENSOR_LABELS.salinity, data: data.map(d => d.salinity), borderColor: COLORS.salinity.line, backgroundColor: COLORS.salinity.bg, fill: true }
    ]);

    // pH
    charts.ph = createChart('chart-ph', labels, [
      { label: SENSOR_LABELS.ph, data: data.map(d => d.ph), borderColor: COLORS.ph.line, backgroundColor: COLORS.ph.bg, fill: true }
    ], { y: { min: 3, max: 9 } });

    // NPK
    charts.npk = createChart('chart-npk', labels, [
      { label: SENSOR_LABELS.nitrogen, data: data.map(d => d.nitrogen), borderColor: COLORS.nitrogen.line, fill: false },
      { label: SENSOR_LABELS.phosphorus, data: data.map(d => d.phosphorus), borderColor: COLORS.phosphorus.line, fill: false },
      { label: SENSOR_LABELS.potassium, data: data.map(d => d.potassium), borderColor: COLORS.potassium.line, fill: false }
    ]);
  }

  /**
   * Create a single-axis chart
   */
  function createChart(canvasId, labels, datasets, extraScales = {}) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const textColor = isDark ? '#aaa' : '#666';

    return new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { color: textColor, font: { size: 11 } } },
          tooltip: { backgroundColor: isDark ? '#333' : '#fff', titleColor: isDark ? '#fff' : '#333', bodyColor: isDark ? '#ddd' : '#555', borderColor: gridColor, borderWidth: 1 }
        },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
          y: { ticks: { color: textColor }, grid: { color: gridColor }, ...extraScales.y },
          ...Object.fromEntries(Object.entries(extraScales).filter(([k]) => k !== 'y'))
        },
        elements: { point: { radius: 1.5, hoverRadius: 5 }, line: { tension: 0.3, borderWidth: 2 } }
      }
    });
  }

  /**
   * Create a dual-axis chart
   */
  function createDualAxisChart(canvasId, labels, datasets, scalesConfig) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;

    const ctx = canvas.getContext('2d');
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const textColor = isDark ? '#aaa' : '#666';

    return new Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', labels: { color: textColor, font: { size: 11 } } },
          tooltip: { backgroundColor: isDark ? '#333' : '#fff', titleColor: isDark ? '#fff' : '#333', bodyColor: isDark ? '#ddd' : '#555', borderColor: gridColor, borderWidth: 1 }
        },
        scales: {
          x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
          y: { ...scalesConfig.y, ticks: { color: textColor }, grid: { color: gridColor } },
          y1: { ...scalesConfig.y1, ticks: { color: textColor }, grid: { drawOnChartArea: false } }
        },
        elements: { point: { radius: 1.5, hoverRadius: 5 }, line: { tension: 0.3, borderWidth: 2 } }
      }
    });
  }

  /**
   * Render empty state
   */
  function renderEmpty() {
    Object.values(charts).forEach(c => { if (c && c.destroy) c.destroy(); });
    charts = {};

    ['chart-moisture-temp', 'chart-ec-salinity', 'chart-ph', 'chart-npk'].forEach(id => {
      const canvas = document.getElementById(id);
      if (canvas) {
        const container = canvas.parentElement;
        container.innerHTML = '<div class="chart-empty">📭 Chưa có dữ liệu lịch sử. Bật chế độ tự động để thu thập dữ liệu.</div>';
      }
    });
  }

  /**
   * Update refresh button state
   */
  function updateRefreshButton() {
    const btn = document.querySelector('.charts-refresh-btn');
    if (btn) {
      btn.disabled = isLoading;
      btn.textContent = isLoading ? '⏳ Đang tải...' : '🔄 Làm mới';
    }
  }

  /**
   * Event handlers
   */
  function onZoneChange(zoneId) {
    currentZone = zoneId;
    loadAndRender();
  }

  function onHoursChange(hours) {
    currentHours = parseInt(hours);
    loadAndRender();
  }

  function refresh() {
    loadAndRender();
  }

  return {
    render,
    refresh,
    onZoneChange,
    onHoursChange
  };
})();
