/**
 * SmartFarm DakLak — Dashboard Module
 * Zone cards, sensor gauges, actuator controls
 */
const Dashboard = (() => {
  // Crop stage colors
  const STAGE_COLORS = {
    dormant: '#616161',
    flowering: '#fff176',
    'fruit-set': '#81c784',
    'fruit-growth': '#4caf50',
    ripening: '#e53935',
    harvest: '#ff9800'
  };

  // Sensor threshold configs
  const SENSOR_THRESHOLDS = {
    moisture: { good: [30, 70], warn: [20, 80] },
    temperature: { good: [18, 35], warn: [10, 40] },
    ec: { good: [200, 1200], warn: [100, 2000] },
    ph: { good: [5.5, 7.0], warn: [4.5, 8.0] }
  };

  function getThresholdClass(sensorType, value) {
    if (value == null) return '';
    const t = SENSOR_THRESHOLDS[sensorType];
    if (!t) return '';
    if (value < t.good[0] || value > t.good[1]) {
      if (value < t.warn[0] || value > t.warn[1]) return 'threshold-critical';
      return 'threshold-warning';
    }
    return 'threshold-good';
  }

  function createGaugeSVG(value, min, max, color) {
    const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
    const r = 42;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - pct);
    return `
      <svg viewBox="0 0 100 100">
        <circle class="gauge-bg" cx="50" cy="50" r="${r}" />
        <circle class="gauge-fill" cx="50" cy="50" r="${r}"
          stroke="${color}"
          stroke-dasharray="${circ}"
          stroke-dashoffset="${offset}" />
      </svg>
    `;
  }

  function renderSensorGauge(label, icon, value, unit, sensorType, min, max, color) {
    const threshold = getThresholdClass(sensorType, value);
    const displayVal = value != null ? (Number.isInteger(value) ? value : value.toFixed(1)) : '--';
    const gaugeColor = threshold === 'threshold-critical' ? 'var(--red)' :
                       threshold === 'threshold-warning' ? 'var(--gold)' : color;

    return `
      <div class="sensor-item">
        <div class="s-label">${icon} ${label}</div>
        ${value != null ? `
          <div class="sensor-gauge">
            ${createGaugeSVG(value, min, max, gaugeColor)}
            <div class="gauge-text">
              <span class="gauge-value ${threshold}" style="color:${gaugeColor}">${displayVal}</span>
              <span class="gauge-label">${unit}</span>
            </div>
          </div>
        ` : `
          <div class="sensor-gauge">
            ${createGaugeSVG(0, 0, 1, 'var(--border)')}
            <div class="gauge-text">
              <span class="gauge-value">--</span>
              <span class="gauge-label">${unit}</span>
            </div>
          </div>
        `}
      </div>
    `;
  }

  function getCurrentStage(crop, cropStages) {
    const month = new Date().getMonth() + 1;
    const stages = cropStages[crop]?.stages || [];
    return stages.find(s => s.months.includes(month)) || stages[0];
  }

  function renderTimeline(crop, activeStageId, cropStages) {
    const stages = cropStages[crop]?.stages || [];
    if (!stages.length) return '';

    return `
      <div class="timeline">
        ${stages.map(s => `
          <div class="timeline-stage ${s.id === activeStageId ? 'active' : ''}"
            style="background:${STAGE_COLORS[s.id] || '#666'}"
            title="${s.name} (${s.months.map(m => 'T' + m).join(', ')})">
            ${s.name.split(' ')[0]}
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderZoneCards(state) {
    const container = document.getElementById('zone-cards');
    if (!container) return;

    container.innerHTML = state.zones.map(zone => {
      const sensor = state.zoneSensorData[zone.id] || {};
      const stage = getCurrentStage(zone.crop, state.cropStages);
      const rule = state.irrigationRules[zone.id] || {};
      const advisory = state.advisories[zone.id];
      const urgencyClass = advisory ? advisory.urgency : 'info';
      const lastUpdate = sensor.timestamp ? new Date(sensor.timestamp).toLocaleTimeString('vi-VN') : null;

      return `
        <div class="card zone-card ${urgencyClass === 'critical' ? 'advisory-card critical' : urgencyClass === 'warning' ? 'advisory-card warning' : 'advisory-card'}">
          <div class="zone-header">
            <span class="zone-name">${zone.name}</span>
            <span class="zone-badge">${stage ? stage.name : '--'}</span>
          </div>
          <div class="zone-meta">
            ${zone.crop === 'robusta' ? '☕ Robusta' : '☕ Arabica'} · ${zone.area}m² · ${rule.enabled ? '🟢 Auto tưới' : '🔴 Thủ công'}
          </div>
          <div class="sensor-grid">
            ${renderSensorGauge('Độ ẩm', '💧', sensor.moisture, '%VWC', 'moisture', 0, 100, 'var(--blue)')}
            ${renderSensorGauge('Nhiệt độ', '🌡️', sensor.temperature, '°C', 'temperature', 0, 50, 'var(--orange)')}
            ${renderSensorGauge('EC', '⚡', sensor.ec, 'µS/cm', 'ec', 0, 2000, 'var(--gold)')}
            ${renderSensorGauge('pH', '🧪', sensor.ph, 'pH', 'ph', 0, 14, 'var(--cyan)')}
          </div>
          ${lastUpdate ? `<div class="last-update">🕐 Cập nhật: ${lastUpdate}</div>` : ''}
          ${advisory && advisory.advices.length > 0 ? `
            <div style="font-size:.75rem;padding:8px;background:var(--bg);border-radius:8px;border:1px solid var(--border);margin-top:8px">
              ${advisory.advices.slice(0, 2).map(a => `<div style="margin-bottom:3px">${a.icon} ${a.message}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  function renderZoneCardsSkeleton(count) {
    const container = document.getElementById('zone-cards');
    if (!container) return;

    container.innerHTML = Array.from({ length: count || 3 }, () => `
      <div class="card zone-card">
        <div class="zone-header">
          <div class="skeleton skeleton-text" style="width:120px;height:16px"></div>
          <div class="skeleton skeleton-text short" style="width:60px;height:14px"></div>
        </div>
        <div class="skeleton skeleton-text" style="width:200px;height:10px;margin-bottom:12px"></div>
        <div class="sensor-grid">
          ${Array.from({ length: 4 }, () => `
            <div class="sensor-item">
              <div class="skeleton skeleton-text" style="width:50px;height:8px;margin:0 auto 8px"></div>
              <div class="skeleton skeleton-circle" style="width:80px;height:80px"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }

  function renderControlPanel(state) {
    const container = document.getElementById('control-panel');
    if (!container) return;

    const pumps = Object.values(state.actuators).filter(a => a.type === 'pump');
    const valves = Object.values(state.actuators).filter(a => a.type === 'valve');

    container.innerHTML = `
      <div class="card operator-only">
        <div class="card-title"><span class="icon">🔌</span> Bơm nước</div>
        ${pumps.map(p => `
          <div class="actuator-row">
            <div class="actuator-info">
              <span class="actuator-icon ${p.state === 'on' ? 'pump-on' : ''}">🔌</span>
              <div>
                <div class="actuator-name">${p.name}</div>
                <div class="actuator-status">${p.state === 'on' ? '🟢 Đang chạy' : '🔴 Tắt'} · Lưu lượng: ${p.flowRate} L/phút</div>
              </div>
            </div>
            <button class="actuator-btn ${p.state === 'on' ? 'btn-on' : 'btn-off'}"
              onclick="Dashboard.toggleActuator('${p.id}', '${p.state === 'on' ? 'off' : 'on'}')">
              ${p.state === 'on' ? 'TẮT' : 'BẬT'}
            </button>
          </div>
        `).join('')}
      </div>

      <div class="card operator-only">
        <div class="card-title"><span class="icon">🔧</span> Van tưới khu vực</div>
        ${valves.map(v => `
          <div class="actuator-row">
            <div class="actuator-info">
              <span class="actuator-icon ${v.state === 'open' ? 'valve-open' : ''}">🔧</span>
              <div>
                <div class="actuator-name">${v.name}</div>
                <div class="actuator-status">${v.state === 'open' ? '🟢 Đang mở' : '🔴 Đóng'} · Khu: ${v.zone || '--'}</div>
              </div>
            </div>
            <button class="actuator-btn ${v.state === 'open' ? 'btn-on' : 'btn-off'}"
              onclick="Dashboard.toggleActuator('${v.id}', '${v.state === 'open' ? 'close' : 'open'}')">
              ${v.state === 'open' ? 'ĐÓNG' : 'MỞ'}
            </button>
          </div>
        `).join('')}
      </div>

      <div class="card operator-only">
        <div class="card-title"><span class="icon">🚀</span> Tưới nhanh theo khu</div>
        ${state.zones.map(z => `
          <div class="actuator-row">
            <div class="actuator-info">
              <span class="actuator-icon">💧</span>
              <div>
                <div class="actuator-name">${z.name}</div>
                <div class="actuator-status">Bật bơm + mở van khu vực</div>
              </div>
            </div>
            <button class="actuator-btn btn-off" onclick="Dashboard.quickIrrigate('${z.id}')">TƯỚI NGAY</button>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderRuleCards(state, socket) {
    const container = document.getElementById('rule-cards');
    if (!container) return;

    container.innerHTML = state.zones.map(zone => {
      const rule = state.irrigationRules[zone.id] || {};
      return `
        <div class="card admin-only">
          <div class="card-title"><span class="icon">⚙️</span> ${zone.name}</div>
          <div class="rule-form">
            <div class="rule-row">
              <label>Auto tưới</label>
              <label class="toggle">
                <input type="checkbox" ${rule.enabled ? 'checked' : ''} onchange="Dashboard.toggleAuto('${zone.id}', this.checked)">
                <span class="slider"></span>
              </label>
            </div>
            <div class="rule-row">
              <label>Độ ẩm tối thiểu</label>
              <input type="number" id="r-min-${zone.id}" value="${rule.moistureMin || 35}" min="10" max="90">
              <span class="unit">%VWC</span>
            </div>
            <div class="rule-row">
              <label>Độ ẩm tối đa</label>
              <input type="number" id="r-max-${zone.id}" value="${rule.moistureMax || 65}" min="20" max="95">
              <span class="unit">%VWC</span>
            </div>
            <div class="rule-row">
              <label>Thời gian tưới tối đa</label>
              <input type="number" id="r-dur-${zone.id}" value="${rule.maxDurationMin || 30}" min="5" max="120">
              <span class="unit">phút</span>
            </div>
            <div class="rule-row">
              <label>Nghỉ giữa 2 lần tưới</label>
              <input type="number" id="r-cd-${zone.id}" value="${rule.cooldownMin || 120}" min="30" max="720">
              <span class="unit">phút</span>
            </div>
            <div class="rule-row">
              <label>Dừng tưới khi mưa</label>
              <label class="toggle">
                <input type="checkbox" ${rule.rainPause ? 'checked' : ''} id="r-rain-${zone.id}">
                <span class="slider"></span>
              </label>
            </div>
            <button class="save-btn" onclick="Dashboard.saveRule('${zone.id}')">💾 Lưu quy tắc</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Actions
  let _socket = null;

  function setSocket(socket) {
    _socket = socket;
  }

  function toggleActuator(id, action) {
    if (_socket) _socket.emit('control', { actuatorId: id, action });
  }

  function quickIrrigate(zoneId, state) {
    if (!_socket) return;
    const zone = (state || window.App?.state || {}).zones?.find(z => z.id === zoneId);
    if (!zone) return;
    _socket.emit('control', { actuatorId: zone.pumpId, action: 'on' });
    setTimeout(() => {
      _socket.emit('control', { actuatorId: zone.valveId, action: 'open' });
    }, 500);
  }

  function toggleAuto(zoneId, enabled) {
    if (_socket) _socket.emit('set_auto_mode', { zoneId, enabled });
  }

  function saveRule(zoneId) {
    if (!_socket) return;
    const rule = {
      moistureMin: parseFloat(document.getElementById(`r-min-${zoneId}`).value),
      moistureMax: parseFloat(document.getElementById(`r-max-${zoneId}`).value),
      maxDurationMin: parseInt(document.getElementById(`r-dur-${zoneId}`).value),
      cooldownMin: parseInt(document.getElementById(`r-cd-${zoneId}`).value),
      rainPause: document.getElementById(`r-rain-${zoneId}`).checked
    };
    _socket.emit('update_rule', { zoneId, rule });
  }

  return {
    renderZoneCards,
    renderZoneCardsSkeleton,
    renderControlPanel,
    renderRuleCards,
    setSocket,
    toggleActuator,
    quickIrrigate,
    toggleAuto,
    saveRule
  };
})();
