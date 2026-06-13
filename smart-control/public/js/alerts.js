/**
 * SmartFarm DakLak — Alerts Module
 * Real-time alert toast/banner notifications
 */
const Alerts = (() => {
  let alertCount = 0;
  const MAX_TOASTS = 5;

  function createContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function getIcon(severity) {
    switch (severity) {
      case 'critical': return '🚨';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  }

  function show(severity, title, message, persistent) {
    const container = createContainer();

    // Limit visible toasts
    const existing = container.querySelectorAll('.toast:not(.dismissing)');
    if (existing.length >= MAX_TOASTS) {
      dismiss(existing[0]);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${severity || 'info'}`;
    toast.innerHTML = `
      <span class="toast-icon">${getIcon(severity)}</span>
      <div class="toast-body">
        <div class="toast-title">${title || 'Notification'}</div>
        <div class="toast-msg">${message || ''}</div>
      </div>
      <button class="toast-close" onclick="Alerts.dismiss(this.parentElement)">✕</button>
    `;

    container.appendChild(toast);
    updateBadge(1);

    // Auto-dismiss non-critical after 10s
    if (!persistent && severity !== 'critical') {
      setTimeout(() => dismiss(toast), 10000);
    }

    return toast;
  }

  function dismiss(toast) {
    if (!toast || toast.classList.contains('dismissing')) return;
    toast.classList.add('dismissing');
    setTimeout(() => {
      toast.remove();
      updateBadge(-1);
    }, 300);
  }

  function updateBadge(delta) {
    alertCount = Math.max(0, alertCount + delta);
    const badge = document.getElementById('alert-badge-count');
    if (badge) {
      badge.textContent = alertCount;
      badge.classList.toggle('hidden', alertCount === 0);
    }
  }

  function clearAll() {
    const container = document.getElementById('toast-container');
    if (container) {
      container.querySelectorAll('.toast').forEach(t => dismiss(t));
    }
  }

  function fromSocketEvent(data) {
    const severity = data.severity || data.urgency || 'info';
    const title = data.title || data.type || 'Alert';
    const message = data.message || data.msg || '';
    show(severity, title, message);
  }

  return {
    show,
    dismiss,
    clearAll,
    fromSocketEvent
  };
})();
