/* Delivery Transformation — shared client helpers */
(function (global) {
  const API = '/api/delivery-transformation';
  const TOKEN_KEY = 'dt_xform_token';
  const USER_KEY = 'dt_xform_user';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function na(v) {
    const s = String(v ?? '').trim();
    return s && s !== 'N/A' ? s : '—';
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token || '');
    localStorage.setItem(USER_KEY, JSON.stringify(user || null));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    const token = getToken();
    if (token) headers['X-Delivery-Transform-Token'] = token;
    if (opts.json) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : null;
    if (res.status === 401) {
      clearSession();
      throw new Error('Session expired — sign in again');
    }
    if (!res.ok) throw new Error((data && data.error) || res.statusText);
    return data;
  }

  function statusBadge(s) {
    const v = String(s || '').trim();
    if (!v) return '<span class="badge">—</span>';
    if (v === 'Claimed' || v === 'تم التسليم') return `<span class="badge ok">${esc(v)}</span>`;
    if (v === 'جاهز للتسليم' || v === 'PSFU') return `<span class="badge info">${esc(v)}</span>`;
    return `<span class="badge warn">${esc(v)}</span>`;
  }

  async function downloadFile(path, filename) {
    const headers = {};
    const token = getToken();
    if (token) headers['X-Delivery-Transform-Token'] = token;
    const res = await fetch(`${API}${path}`, { headers });
    if (res.status === 401) {
      clearSession();
      throw new Error('Session expired — sign in again');
    }
    if (!res.ok) {
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('application/json') ? await res.json().catch(() => null) : null;
      throw new Error((data && data.error) || res.statusText || 'Download failed');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function toast(msg) {
    let el = document.getElementById('dt-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dt-toast';
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function requireRole(allowed, redirect) {
    const user = getUser();
    const token = getToken();
    if (!token || !user || !allowed.includes(user.role)) {
      location.href = redirect || './index.html';
      return null;
    }
    return user;
  }

  global.DTX = {
    API,
    esc,
    na,
    api,
    downloadFile,
    getToken,
    getUser,
    setSession,
    clearSession,
    statusBadge,
    toast,
    requireRole,
  };
})(window);
