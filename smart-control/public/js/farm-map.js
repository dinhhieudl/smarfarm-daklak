/**
 * SmartFarm DakLak — Farm Map Module
 * Interactive SVG farm map with real-time sensor overlays
 */
const FarmMap = (() => {
  let selectedZone = null;
  let tooltipEl = null;

  // Zone layout coordinates (relative % for responsive SVG)
  const ZONE_LAYOUT = {
    'zone-A': { x: 10, y: 15, w: 35, h: 55, label: 'Khu A', color: '#4caf50' },
    'zone-B': { x: 50, y: 10, w: 40, h: 40, label: 'Khu B', color: '#2196f3' },
    'zone-C': { x: 50, y: 55, w: 40, h: 35, label: 'Khu C', color: '#ff9800' }
  };

  // Pump/valve positions
  const ACTUATOR_POS = {
    'pump-1':   { x: 48, y: 35, icon: '🔌', label: 'Bơm #1' },
    'pump-2':   { x: 48, y: 72, icon: '🔌', label: 'Bơm #2' },
    'valve-1':  { x: 30, y: 42, icon: '🔧', label: 'Van A' },
    'valve-2':  { x: 70, y: 30, icon: '🔧', label: 'Van B' },
    'valve-3':  { x: 70, y: 68, icon: '🔧', label: 'Van C' }
  };

  // Pipe paths connecting pumps to valves
  const PIPES = [
    { from: 'pump-1', to: 'valve-1', path: 'M 48 35 L 30 42' },
    { from: 'pump-1', to: 'valve-2', path: 'M 48 35 L 70 30' },
    { from: 'pump-2', to: 'valve-3', path: 'M 48 72 L 70 68' }
  ];

  function createTooltip() {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'map-tooltip';
    tooltipEl.className = 'map-tooltip';
    document.body.appendChild(tooltipEl);
  }

  function showTooltip(evt, html) {
    createTooltip();
    tooltipEl.innerHTML = html;
    tooltipEl.style.display = 'block';
    tooltipEl.style.left = (evt.clientX + 12) + 'px';
    tooltipEl.style.top = (evt.clientY - 10) + 'px';
  }

  function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
  }

  function getMoistureColor(moisture) {
    if (moisture == null) return '#666';
    if (moisture < 20) return '#e53935';
    if (moisture < 35) return '#ff9800';
    if (moisture < 65) return '#4caf50';
    if (moisture < 80) return '#2196f3';
    return '#1565c0';
  }

  function getMoistureLabel(moisture) {
    if (moisture == null) return 'Không có dữ liệu';
    if (moisture < 20) return '🔴 Cực khô — Cần tưới NGAY';
    if (moisture < 35) return '🟠 Khô — Nên tưới sớm';
    if (moisture < 65) return '🟢 Tốt — Đủ ẩm';
    if (moisture < 80) return '🔵 Ẩm — Kiểm tra thoát nước';
    return '🔵 Ngập — Nguy hiểm';
  }

  function renderZone(zone, sensor, stage, advisory) {
    const layout = ZONE_LAYOUT[zone.id];
    if (!layout) return '';

    const moisture = sensor?.moisture;
    const fillColor = getMoistureColor(moisture);
    const opacity = 0.25 + (moisture != null ? (moisture / 100) * 0.35 : 0.2);
    const urgency = advisory?.urgency || 'info';
    const borderColor = urgency === 'critical' ? '#e53935' : urgency === 'warning' ? '#f9a825' : layout.color;

    return `
      <g class="farm-zone" data-zone="${zone.id}" style="cursor:pointer"
         onmouseenter="FarmMap.onZoneHover(evt, '${zone.id}')"
         onmouseleave="FarmMap.hideTooltip()"
         onclick="FarmMap.selectZone('${zone.id}')">
        <rect x="${layout.x}%" y="${layout.y}%" width="${layout.w}%" height="${layout.h}%" rx="8"
              fill="${fillColor}" fill-opacity="${opacity}"
              stroke="${borderColor}" stroke-width="${urgency === 'critical' ? 3 : 1.5}"
              ${urgency === 'critical' ? 'stroke-dasharray="6 3"' : ''}>
          ${urgency === 'critical' ? '<animate attributeName="stroke-dashoffset" from="0" to="18" dur="1s" repeatCount="indefinite"/>' : ''}
        </rect>
        <text x="${layout.x + layout.w / 2}%" y="${layout.y + 8}%" text-anchor="middle"
              fill="${layout.color}" font-size="11" font-weight="700">${layout.label}</text>
        <text x="${layout.x + layout.w / 2}%" y="${layout.y + 16}%" text-anchor="middle"
              fill="var(--text2)" font-size="8">${zone.crop === 'robusta' ? '☕ Robusta' : '☕ Arabica'}</text>
        ${moisture != null ? `
          <text x="${layout.x + layout.w / 2}%" y="${layout.y + 28}%" text-anchor="middle"
                fill="${fillColor}" font-size="20" font-weight="700">${moisture.toFixed(1)}%</text>
          <text x="${layout.x + layout.w / 2}%" y="${layout.y + 36}%" text-anchor="middle"
                fill="var(--text3)" font-size="7">Độ ẩm</text>
        ` : ''}
        ${sensor?.temperature != null ? `
          <text x="${layout.x + layout.w / 2}%" y="${layout.y + 46}%" text-anchor="middle"
                fill="var(--orange)" font-size="12" font-weight="600">${sensor.temperature.toFixed(1)}°C</text>
        ` : ''}
        ${stage ? `
          <text x="${layout.x + layout.w / 2}%" y="${layout.y + layout.h - 6}%" text-anchor="middle"
                fill="var(--text3)" font-size="7">🌱 ${stage.name}</text>
        ` : ''}
      </g>
    `;
  }

  function renderActuator(actuator, pos) {
    const isOn = actuator?.state === 'on' || actuator?.state === 'open';
    const glowColor = isOn ? '#00e676' : 'transparent';
    return `
      <g class="farm-actuator" data-id="${actuator?.id}">
        <circle cx="${pos.x}%" cy="${pos.y}%" r="12" fill="${isOn ? '#1b5e20' : '#333'}"
                stroke="${isOn ? '#00e676' : '#666'}" stroke-width="1.5"/>
        ${isOn ? `<circle cx="${pos.x}%" cy="${pos.y}%" r="16" fill="none" stroke="${glowColor}" stroke-width="1" opacity="0.4">
          <animate attributeName="r" from="12" to="20" dur="1.5s" repeatCount="indefinite"/>
          <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite"/>
        </circle>` : ''}
        <text x="${pos.x}%" y="${pos.y + 1.5}%" text-anchor="middle" font-size="10">${pos.icon}</text>
        <text x="${pos.x}%" y="${pos.y + 5}%" text-anchor="middle" fill="var(--text3)" font-size="6">${pos.label}</text>
      </g>
    `;
  }

  function renderPipe(pipe, actuators) {
    const fromAct = actuators[pipe.from];
    const toAct = actuators[pipe.to];
    const isActive = (fromAct?.state === 'on') && (toAct?.state === 'open');
    return `
      <path d="${pipe.path}" fill="none"
            stroke="${isActive ? '#00e676' : '#3a3a3a'}" stroke-width="${isActive ? 3 : 1.5}"
            stroke-linecap="round" stroke-dasharray="${isActive ? 'none' : '4 4'}">
        ${isActive ? '<animate attributeName="stroke-dashoffset" from="0" to="-8" dur="0.5s" repeatCount="indefinite"/>' : ''}
      </path>
    `;
  }

  function renderLegend() {
    return `
      <g transform="translate(2, 88)">
        <text x="0" y="0" fill="var(--text3)" font-size="7" font-weight="600">Độ ẩm đất:</text>
        ${[
          { color: '#e53935', label: '<20% Cực khô' },
          { color: '#ff9800', label: '20-35% Khô' },
          { color: '#4caf50', label: '35-65% Tốt' },
          { color: '#2196f3', label: '65-80% Ẩm' },
          { color: '#1565c0', label: '>80% Ngập' }
        ].map((item, i) => `
          <rect x="${i * 19}%" y="3" width="8" height="6" rx="1" fill="${item.color}" opacity="0.7"/>
          <text x="${i * 19 + 1.5}%" y="13" fill="var(--text3)" font-size="5">${item.label}</text>
        `).join('')}
      </g>
    `;
  }

  function render(state) {
    const container = document.getElementById('tab-map');
    if (!container) return;

    injectStyles();

    const zones = state.zones || [];
    const sensors = state.zoneSensorData || {};
    const actuators = state.actuators || {};
    const stages = state.cropStages || {};
    const advisories = state.advisories || {};

    container.innerHTML = `
      <div class="map-container">
        <div class="map-header">
          <div class="map-title">🗺️ Bản đồ nông trại — DakLak</div>
          <div class="map-legend-inline">
            <span class="legend-dot" style="background:#4caf50"></span>Tốt
            <span class="legend-dot" style="background:#ff9800"></span>Khô
            <span class="legend-dot" style="background:#e53935"></span>Cực khô
            <span class="legend-dot" style="background:#2196f3"></span>Ẩm
          </div>
        </div>

        <div class="map-wrapper">
          <svg viewBox="0 0 100 100" class="farm-svg" id="farm-svg">
            <!-- Background -->
            <rect width="100" height="100" fill="var(--bg)" rx="8"/>

            <!-- Grid lines -->
            ${Array.from({length: 10}, (_, i) => `
              <line x1="${i * 10}%" y1="0" x2="${i * 10}%" y2="100%" stroke="var(--border)" stroke-width="0.2" opacity="0.3"/>
              <line x1="0" y1="${i * 10}%" x2="100%" y2="${i * 10}%" stroke="var(--border)" stroke-width="0.2" opacity="0.3"/>
            `).join('')}

            <!-- Pipes (behind zones) -->
            ${PIPES.map(p => renderPipe(p, actuators)).join('')}

            <!-- Zones -->
            ${zones.map(zone => {
              const sensor = sensors[zone.id];
              const stage = getCurrentStage(zone.crop, stages);
              const advisory = advisories[zone.id];
              return renderZone(zone, sensor, stage, advisory);
            }).join('')}

            <!-- Actuators -->
            ${Object.entries(ACTUATOR_POS).map(([id, pos]) => renderActuator(actuators[id], pos)).join('')}

            <!-- Compass -->
            <g transform="translate(92, 5)">
              <circle cx="0" cy="0" r="4" fill="none" stroke="var(--text3)" stroke-width="0.3"/>
              <text x="0" y="-1" text-anchor="middle" fill="var(--red)" font-size="4" font-weight="700">N</text>
              <line x1="0" y1="-3" x2="0" y2="3" stroke="var(--text3)" stroke-width="0.2"/>
              <line x1="-3" y1="0" x2="3" y2="0" stroke="var(--text3)" stroke-width="0.2"/>
            </g>

            ${renderLegend()}
          </svg>
        </div>

        <!-- Zone detail panel -->
        <div class="map-detail" id="map-detail">
          ${renderZoneDetail(selectedZone, state)}
        </div>
      </div>
    `;
  }

  function renderZoneDetail(zoneId, state) {
    if (!zoneId) {
      return '<div class="map-detail-empty">👆 Nhấp vào khu vực trên bản đồ để xem chi tiết</div>';
    }

    const zone = (state.zones || []).find(z => z.id === zoneId);
    if (!zone) return '';

    const sensor = state.zoneSensorData?.[zoneId] || {};
    const rule = state.irrigationRules?.[zoneId] || {};
    const advisory = state.advisories?.[zoneId];
    const stage = getCurrentStage(zone.crop, state.cropStages || {});

    return `
      <div class="detail-header">
        <span class="detail-zone-name" style="color:${ZONE_LAYOUT[zoneId]?.color || '#4caf50'}">${zone.name}</span>
        <button class="detail-close" onclick="FarmMap.selectZone(null)">✕</button>
      </div>

      <div class="detail-grid">
        <div class="detail-sensor">
          <span class="ds-icon">💧</span>
          <span class="ds-val" style="color:${getMoistureColor(sensor.moisture)}">${sensor.moisture?.toFixed(1) ?? '--'}%</span>
          <span class="ds-label">Độ ẩm</span>
        </div>
        <div class="detail-sensor">
          <span class="ds-icon">🌡️</span>
          <span class="ds-val" style="color:var(--orange)">${sensor.temperature?.toFixed(1) ?? '--'}°C</span>
          <span class="ds-label">Nhiệt độ</span>
        </div>
        <div class="detail-sensor">
          <span class="ds-icon">⚡</span>
          <span class="ds-val" style="color:var(--gold)">${sensor.ec ?? '--'}</span>
          <span class="ds-label">EC µS/cm</span>
        </div>
        <div class="detail-sensor">
          <span class="ds-icon">🧪</span>
          <span class="ds-val" style="color:var(--cyan)">${sensor.ph?.toFixed(1) ?? '--'}</span>
          <span class="ds-label">pH</span>
        </div>
      </div>

      ${stage ? `
        <div class="detail-stage">
          🌱 <strong>${stage.name}</strong> — ${stage.description || ''}
        </div>
      ` : ''}

      ${advisory ? `
        <div class="detail-advisory ${advisory.urgency}">
          ${advisory.advices.slice(0, 3).map(a => `<div class="da-item">${a.icon} ${a.message}</div>`).join('')}
        </div>
      ` : ''}

      <div class="detail-meta">
        <div>📐 Diện tích: <strong>${zone.area?.toLocaleString()} m²</strong></div>
        <div>☕ Giống: <strong>${zone.crop === 'robusta' ? 'Robusta' : 'Arabica'}</strong></div>
        <div>⚙️ Auto: <strong>${rule.enabled ? '🟢 Bật' : '🔴 Tắt'}</strong></div>
        <div>💧 Ngưỡng: <strong>${rule.moistureMin}-${rule.moistureMax}%</strong></div>
      </div>
    `;
  }

  function getCurrentStage(crop, cropStages) {
    const month = new Date().getMonth() + 1;
    const stages = cropStages?.[crop]?.stages || [];
    return stages.find(s => s.months.includes(month)) || stages[0];
  }

  function selectZone(zoneId) {
    selectedZone = zoneId;
    const detail = document.getElementById('map-detail');
    if (detail && window.App?.state) {
      detail.innerHTML = renderZoneDetail(zoneId, window.App.state);
    }
    // Highlight selected zone in SVG
    document.querySelectorAll('.farm-zone').forEach(el => {
      const id = el.dataset.zone;
      el.style.opacity = (zoneId && id !== zoneId) ? '0.4' : '1';
    });
  }

  function onZoneHover(evt, zoneId) {
    const state = window.App?.state;
    if (!state) return;
    const zone = (state.zones || []).find(z => z.id === zoneId);
    const sensor = state.zoneSensorData?.[zoneId] || {};
    if (!zone) return;

    showTooltip(evt, `
      <div style="font-weight:700;color:${ZONE_LAYOUT[zoneId]?.color}">${zone.name}</div>
      <div>💧 ${sensor.moisture?.toFixed(1) ?? '--'}% · 🌡️ ${sensor.temperature?.toFixed(1) ?? '--'}°C</div>
      <div>⚡ EC: ${sensor.ec ?? '--'} · 🧪 pH: ${sensor.ph?.toFixed(1) ?? '--'}</div>
      <div style="font-size:.7rem;color:var(--text3);margin-top:4px">${getMoistureLabel(sensor.moisture)}</div>
    `);
  }

  function injectStyles() {
    if (document.getElementById('farmmap-styles')) return;
    const style = document.createElement('style');
    style.id = 'farmmap-styles';
    style.textContent = `
      .map-container { padding: 20px; }
      .map-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
      .map-title { font-size: 1.1rem; font-weight: 700; color: var(--green); }
      .map-legend-inline { display: flex; gap: 12px; align-items: center; font-size: .75rem; color: var(--text3); }
      .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 3px; }
      .map-wrapper { background: var(--bg2); border: 1px solid var(--border); border-radius: 12px; padding: 8px; margin-bottom: 16px; }
      .farm-svg { width: 100%; height: auto; min-height: 300px; }
      .farm-zone { transition: opacity 0.3s; }

      .map-tooltip {
        display: none; position: fixed; z-index: 1000;
        background: var(--bg2); border: 1px solid var(--border); border-radius: 8px;
        padding: 10px 14px; font-size: .8rem; box-shadow: 0 4px 16px rgba(0,0,0,.3);
        pointer-events: none; max-width: 250px;
      }

      .map-detail {
        background: var(--bg2); border: 1px solid var(--border); border-radius: 12px;
        padding: 16px; min-height: 120px;
      }
      .map-detail-empty { text-align: center; color: var(--text3); padding: 30px; font-size: .85rem; }
      .detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
      .detail-zone-name { font-size: 1.1rem; font-weight: 700; }
      .detail-close { background: none; border: 1px solid var(--border); border-radius: 6px; color: var(--text); cursor: pointer; padding: 4px 10px; font-size: .9rem; min-width: 44px; min-height: 44px; }
      .detail-close:hover { background: var(--bg3); }

      .detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
      .detail-sensor { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px; text-align: center; }
      .ds-icon { font-size: 1.2rem; display: block; margin-bottom: 4px; }
      .ds-val { font-size: 1.1rem; font-weight: 700; display: block; }
      .ds-label { font-size: .6rem; color: var(--text3); display: block; margin-top: 2px; }

      .detail-stage { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px; font-size: .8rem; margin-bottom: 10px; color: var(--text2); }
      .detail-advisory { border-radius: 8px; padding: 10px; margin-bottom: 10px; font-size: .75rem; }
      .detail-advisory.info { background: #1565c020; border: 1px solid #1565c040; }
      .detail-advisory.warning { background: #e6510020; border: 1px solid #e6510040; }
      .detail-advisory.critical { background: #b71c1c20; border: 1px solid #b71c1c40; }
      .da-item { padding: 3px 0; }

      .detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: .75rem; color: var(--text2); }
      .detail-meta strong { color: var(--text); }

      @media (max-width: 767px) {
        .detail-grid { grid-template-columns: repeat(2, 1fr); }
        .detail-meta { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  return {
    render,
    selectZone,
    onZoneHover,
    hideTooltip
  };
})();
