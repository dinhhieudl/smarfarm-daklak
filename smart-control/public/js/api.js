/**
 * SmartFarm DakLak — API Module
 * Fetch wrapper with JWT auth support
 */
const API = (() => {
  const BASE = '/api';

  function getToken() {
    return localStorage.getItem('sf_token');
  }

  function setToken(token) {
    localStorage.setItem('sf_token', token);
  }

  function clearToken() {
    localStorage.removeItem('sf_token');
    localStorage.removeItem('sf_user');
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('sf_user') || 'null');
    } catch {
      return null;
    }
  }

  function setUser(user) {
    localStorage.setItem('sf_user', JSON.stringify(user));
  }

  async function request(path, opts = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const res = await fetch(`${BASE}${path}`, { ...opts, headers });

      if (res.status === 401 || res.status === 403) {
        clearToken();
        window.dispatchEvent(new CustomEvent('auth:expired'));
        throw new Error('Authentication expired');
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${body}`);
      }

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('json')) return res.json();
      return res.text();
    } catch (err) {
      if (err.message === 'Authentication expired') throw err;
      console.error(`[API] ${path}:`, err);
      throw err;
    }
  }

  async function login(username, password) {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Login failed');
    }

    const data = await res.json();
    setToken(data.token);
    setUser(data.user || { username });
    return data;
  }

  function logout() {
    clearToken();
    window.dispatchEvent(new CustomEvent('auth:logout'));
  }

  function isAuthenticated() {
    return !!getToken();
  }

  return {
    request,
    login,
    logout,
    getToken,
    getUser,
    isAuthenticated,
    getHistory: (zone, hours = 24, limit = 200) =>
      request(`/history?zone=${zone}&hours=${hours}&limit=${limit}`)
  };
})();
