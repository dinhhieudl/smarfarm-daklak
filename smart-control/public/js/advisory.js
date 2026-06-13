/**
 * SmartFarm DakLak — Advisory Module
 * Crop advisory display
 */
const Advisory = (() => {
  const STAGE_COLORS = {
    dormant: '#616161',
    flowering: '#fff176',
    'fruit-set': '#81c784',
    'fruit-growth': '#4caf50',
    ripening: '#e53935',
    harvest: '#ff9800'
  };

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

  function render(state) {
    const container = document.getElementById('advisory-cards');
    if (!container) return;

    container.innerHTML = state.zones.map(zone => {
      const advisory = state.advisories[zone.id];
      if (!advisory) return '<div class="card"><div class="empty">Đang phân tích...</div></div>';

      const stage = advisory.stage;
      return `
        <div class="card advisory-card ${advisory.urgency === 'critical' ? 'critical' : advisory.urgency === 'warning' ? 'warning' : ''}">
          <div class="card-title">
            <span class="icon">🧠</span> ${zone.name}
          </div>

          ${stage ? `
            <div style="margin-bottom:12px">
              <div style="font-size:.85rem;font-weight:600;color:var(--green);margin-bottom:4px">
                🌱 Giai đoạn: ${stage.name}
              </div>
              <div style="font-size:.75rem;color:var(--text2)">${stage.description}</div>
              ${renderTimeline(zone.crop, stage.id, state.cropStages)}
            </div>
          ` : ''}

          ${advisory.advices.map(a => `
            <div class="advisory-item">
              <span class="advisory-icon">${a.icon}</span>
              <div class="advisory-text">
                <div class="advisory-msg">${a.message}</div>
                ${a.action ? `<div class="advisory-action">💡 ${a.action}</div>` : ''}
                ${a.details ? `<div style="font-size:.7rem;color:var(--text3);margin-top:3px">${a.details.map(d => '• ' + d).join('<br>')}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }).join('');
  }

  return { render };
})();
