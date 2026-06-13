/**
 * SmartFarm DakLak — Audit Module
 * Audit log / control history viewer
 */
const Audit = (() => {
  function render(state) {
    const log = document.getElementById('history-log');
    if (!log) return;

    if (state.controlHistory.length === 0) {
      log.innerHTML = '<div class="empty">Chưa có sự kiện nào</div>';
      return;
    }

    log.innerHTML = state.controlHistory.slice(0, 100).map(evt => {
      const time = new Date(evt.time).toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const severity = evt.severity || 'info';
      const severityClass = `severity-${severity}`;
      return `
        <div class="history-item">
          <span class="history-time">${time}</span>
          <span class="history-severity ${severityClass}">${severity}</span>
          <span class="history-msg">${evt.message || evt.type || JSON.stringify(evt)}</span>
        </div>
      `;
    }).join('');
  }

  return { render };
})();
