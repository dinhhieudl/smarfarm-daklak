/**
 * SmartFarm DakLak — Main Application
 * App initialization, Socket.IO, tab switching, theme toggle, login
 */
const App = (() => {
  // ─── State ────────────────────────────────────────────
  let state = {
    zones: [],
    actuators: {},
    zoneSensorData: {},
    irrigationRules: {},
    weather: {},
    cropStages: {},
    controlHistory: [],
    advisories: {}
  };

  let socket = null;
  let currentUser = null;

  // ─── Initialization ──────────────────────────────────
  function init() {
    // Check theme preference
    const savedTheme = localStorage.getItem('sf_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Check auth
    if (API.isAuthenticated()) {
      currentUser = API.getUser();
      showApp();
      connectSocket();
    } else {
      showLogin();
    }

    // Bind events
    bindTabs();
    bindThemeToggle();
    bindLoginForm();
    bindSidebarToggle();

    // Listen for auth events
    window.addEventListener('auth:expired', () => showLogin());
    window.addEventListener('auth:logout', () => showLogin());

    // Expose state for other modules
    window.App = { state, socket };
  }

  // ─── Auth / Login ────────────────────────────────────
  function showLogin() {
    const overlay = document.getElementById('login-overlay');
    const mainApp = document.getElementById('main-app');
    if (overlay) overlay.classList.remove('hidden');
    if (mainApp) mainApp.style.display = 'none';
  }

  function showApp() {
    const overlay = document.getElementById('login-overlay');
    const mainApp = document.getElementById('main-app');
    if (overlay) overlay.classList.add('hidden');
    if (mainApp) mainApp.style.display = '';

    updateUserInfo();
    applyRolePermissions();
  }

  function bindLoginForm() {
    const form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
      const btn = document.getElementById('login-btn');
      const errEl = document.getElementById('login-error');

      if (!username || !password) {
        errEl.textContent = 'Vui lòng nhập đầy đủ thông tin';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Đang đăng nhập...';
      errEl.textContent = '';

      try {
        const data = await API.login(username, password);
        currentUser = data.user || { username };
        showApp();
        connectSocket();
      } catch (err) {
        errEl.textContent = err.message || 'Đăng nhập thất bại';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Đăng nhập';
      }
    });
  }

  function updateUserInfo() {
    const el = document.getElementById('user-info');
    if (!el || !currentUser) return;

    const role = currentUser.role || 'viewer';
    el.innerHTML = `
      <span>👤 ${currentUser.username || 'User'}</span>
      <span class="user-role">${role}</span>
      <button class="logout-btn" onclick="App.logout()">Thoát</button>
    `;
  }

  function applyRolePermissions() {
    const role = currentUser?.role || 'viewer';

    // Tab visibility
    document.querySelectorAll('.tab-btn[data-role]').forEach(btn => {
      const required = btn.dataset.role;
      if (required === 'admin' && role !== 'admin') {
        btn.classList.add('hidden');
      } else if (required === 'operator' && role === 'viewer') {
        btn.classList.add('hidden');
      } else {
        btn.classList.remove('hidden');
      }
    });

    // Element visibility
    document.querySelectorAll('.operator-only').forEach(el => {
      el.classList.toggle('hidden', role === 'viewer');
    });
    document.querySelectorAll('.admin-only').forEach(el => {
      el.classList.toggle('hidden', role !== 'admin');
    });
  }

  function logout() {
    API.logout();
    if (socket) socket.disconnect();
    currentUser = null;
    showLogin();
  }

  // ─── Socket.IO ───────────────────────────────────────
  function connectSocket() {
    const token = API.getToken();
    socket = io({ auth: { token } });
    Dashboard.setSocket(socket);

    socket.on('init', (data) => {
      state = { ...state, ...data };
      window.App.state = state;
      renderAll();
    });

    socket.on('zone_sensor', ({ zoneId, data }) => {
      data.timestamp = Date.now();
      state.zoneSensorData[zoneId] = data;
      Dashboard.renderZoneCards(state);
      Advisory.render(state);
    });

    socket.on('actuator_update', (act) => {
      state.actuators[act.id] = act;
      Dashboard.renderControlPanel(state);
    });

    socket.on('weather_update', (w) => {
      state.weather = w;
      Weather.render(state);
    });

    socket.on('advisory', ({ zoneId, advices, urgency, stage }) => {
      state.advisories[zoneId] = { advices, urgency, stage };
      Advisory.render(state);

      // Show toast for critical advisories
      if (urgency === 'critical') {
        const zone = state.zones.find(z => z.id === zoneId);
        Alerts.show('critical', `Cảnh báo: ${zone?.name || zoneId}`,
          advices[0]?.message || 'Cần kiểm tra ngay', true);
      }
    });

    socket.on('rule_update', ({ zoneId, rule }) => {
      state.irrigationRules[zoneId] = rule;
      Dashboard.renderRuleCards(state, socket);
    });

    socket.on('control_event', (evt) => {
      state.controlHistory.unshift(evt);
      if (state.controlHistory.length > 200) state.controlHistory.pop();
      Audit.render(state);
    });

    socket.on('control_log', (evt) => {
      state.controlHistory.unshift(evt);
      if (state.controlHistory.length > 200) state.controlHistory.pop();
      Audit.render(state);
    });

    socket.on('mqtt_status', (s) => {
      const pill = document.getElementById('pill-mqtt');
      if (pill) {
        pill.className = s.connected ? 'pill ok' : 'pill err';
        pill.innerHTML = `<span class="dot"></span>MQTT ${s.connected ? 'Connected' : 'Disconnected'}`;
      }
    });

    socket.on('alert', (data) => {
      Alerts.fromSocketEvent(data);
    });

    socket.on('connect', () => {
      updateConnectionStatus('ws', true);
    });

    socket.on('disconnect', () => {
      updateConnectionStatus('ws', false);
    });

    window.App.socket = socket;
  }

  function updateConnectionStatus(type, connected) {
    const pill = document.getElementById(`pill-${type}`);
    if (pill) {
      pill.className = connected ? 'pill ok' : 'pill err';
    }
  }

  // ─── Render All ──────────────────────────────────────
  function renderAll() {
    // Show skeletons first, then real content
    Dashboard.renderZoneCardsSkeleton(state.zones.length || 3);
    setTimeout(() => {
      Dashboard.renderZoneCards(state);
      Dashboard.renderControlPanel(state);
      Dashboard.renderRuleCards(state, socket);
      Advisory.render(state);
      Weather.render(state);
      Audit.render(state);
    }, 100);
  }

  // ─── Tab Switching ───────────────────────────────────
  function bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tab = document.getElementById(btn.dataset.tab);
        if (tab) tab.classList.add('active');
      });
    });
  }

  // ─── Theme Toggle ────────────────────────────────────
  function bindThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('sf_theme', next);
      btn.textContent = next === 'dark' ? '🌙' : '☀️';
    });

    // Set initial icon
    const saved = localStorage.getItem('sf_theme') || 'dark';
    btn.textContent = saved === 'dark' ? '🌙' : '☀️';
  }

  // ─── Mobile Sidebar Toggle ───────────────────────────
  function bindSidebarToggle() {
    const btn = document.getElementById('sidebar-toggle');
    const tabs = document.querySelector('.tabs');
    if (!btn || !tabs) return;

    btn.addEventListener('click', () => {
      tabs.classList.toggle('collapsed');
    });
  }

  // ─── Public API ──────────────────────────────────────
  return {
    init,
    logout,
    get state() { return state; },
    get socket() { return socket; }
  };
})();

// ─── Bootstrap ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', App.init);
