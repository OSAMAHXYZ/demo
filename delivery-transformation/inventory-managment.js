/* Inventory Management — Ruba / الفاضل / البراء */
(() => {
  const { api, esc, getToken, getUser, setSession, clearSession } = window.DTX;

  const ALLOWED = [
    { id: 'ruba', name: 'Ruba' },
    { id: 'alfadel', name: 'الفاضل' },
    { id: 'albara', name: 'البراء' },
  ];

  const $ = (id) => document.getElementById(id);
  const state = {
    view: 'all',
    q: '',
    pool: [],
    selected: new Set(),
    poll: null,
    user: null,
  };

  function showApp(on) {
    $('login-screen').classList.toggle('hidden', on);
    $('app').classList.toggle('is-on', on);
  }

  function canUse(user) {
    return !!(user && (user.canInventory || ALLOWED.some((u) => u.id === user.id)));
  }

  function fillLogin() {
    $('login-user').innerHTML = '<option value="">— Choose user —</option>'
      + ALLOWED.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    $('login-pills').innerHTML = ALLOWED.map((u) => (
      `<button type="button" data-id="${esc(u.id)}">${esc(u.name)}</button>`
    )).join('');
    $('login-pills').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      $('login-user').value = btn.dataset.id;
      $$('login-pills button').forEach((b) => b.classList.toggle('active', b === btn));
    });
  }

  function $$(sel) {
    return [...document.querySelectorAll(sel)];
  }

  async function login() {
    $('login-error').textContent = '';
    const username = $('login-user').value;
    if (!username) {
      $('login-error').textContent = 'Choose Ruba, الفاضل, or البراء';
      return;
    }
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: { username, password: $('login-pass').value },
      });
      if (!canUse(data.user)) {
        $('login-error').textContent = 'This page is only for Ruba, الفاضل, and البراء';
        return;
      }
      setSession(data.token, data.user);
      enter(data.user);
    } catch (err) {
      $('login-error').textContent = err.message || 'Sign in failed';
    }
  }

  function logout() {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    stopPoll();
    location.reload();
  }

  function enter(user) {
    state.user = user;
    $('side-name').textContent = user.name;
    showApp(true);
    load().catch((e) => { $('login-error').textContent = e.message; });
    startPoll();
  }

  function startPoll() {
    stopPoll();
    state.poll = setInterval(() => load({ silent: true }).catch(() => {}), 4000);
  }

  function stopPoll() {
    if (state.poll) { clearInterval(state.poll); state.poll = null; }
  }

  function applyPayload(data) {
    state.pool = data.pool || [];
    const keep = new Set(state.pool.map((r) => r.vin));
    state.selected.forEach((vin) => { if (!keep.has(vin)) state.selected.delete(vin); });
    $('kpi-row').innerHTML = [
      kpi('Open VINs', data.total || 0),
      kpi('Unclaimed', data.unclaimed || 0),
      kpi('My stock', data.mine || 0),
      ...(data.users || []).map((u) => kpi(u.name, u.stockIn != null ? u.stockIn : (Array.isArray(u.stock) ? u.stock.length : (u.stock || 0)))),
    ].join('');
    render();
  }

  function kpi(label, n) {
    return `<div class="kpi"><span>${esc(label)}</span><strong>${esc(n)}</strong></div>`;
  }

  async function load() {
    const data = await api('/inventory');
    applyPayload(data);
  }

  function filtered() {
    const q = state.q.trim().toLowerCase();
    const me = state.user && state.user.id;
    return state.pool.filter((r) => {
      if (state.view === 'mine' && r.stockOwnerId !== me) return false;
      if (state.view === 'open' && r.stockOwnerId) return false;
      if (!q) return true;
      const hay = [r.vin, r.product, r.salesType, r.customer, r.employee, r.stockOwner, r.source]
        .join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function render() {
    const rows = filtered();
    const me = state.user && state.user.id;
    $('empty').classList.toggle('hidden', rows.length > 0);
    $('rows').innerHTML = rows.map((r) => {
      const mine = r.stockOwnerId === me;
      const checked = state.selected.has(r.vin) ? ' checked' : '';
      const action = mine
        ? `<button type="button" class="row-btn release" data-act="release" data-vin="${esc(r.vin)}">Release</button>`
        : `<button type="button" class="row-btn claim" data-act="claim" data-vin="${esc(r.vin)}">To my stock</button>`;
      return `<tr class="${mine ? 'mine' : ''}">
        <td class="chk"><input type="checkbox" data-vin="${esc(r.vin)}"${checked} /></td>
        <td><strong>${esc(r.vin)}</strong></td>
        <td>${esc(r.product || '—')}</td>
        <td>${esc(r.salesType || '—')}</td>
        <td>${esc(r.proformaDate || '—')}</td>
        <td>${esc(r.customer || '—')}</td>
        <td>${esc(r.employee || '—')}</td>
        <td><span class="badge ${r.source === 'raw' ? 'warn' : 'info'}">${r.source === 'raw' ? 'Sales Raw' : 'Live Sheet'}</span></td>
        <td>${r.stockOwner ? `<span class="badge ok">${esc(r.stockOwner)}</span>` : '<span class="badge">Open</span>'}</td>
        <td>${action}</td>
      </tr>`;
    }).join('');
    syncCheckAll();
  }

  function syncCheckAll() {
    const boxes = $$('#rows input[type="checkbox"]');
    $('check-all').checked = boxes.length > 0 && boxes.every((b) => b.checked);
  }

  function selectedVins() {
    return [...state.selected];
  }

  async function claim(vins) {
    if (!vins.length) return;
    const data = await api('/inventory/claim', { method: 'POST', json: { vins } });
    applyPayload(data);
  }

  async function release(vins) {
    if (!vins.length) return;
    const data = await api('/inventory/release', { method: 'POST', json: { vins } });
    applyPayload(data);
  }

  function bind() {
    $('login-btn').addEventListener('click', login);
    $('login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('logout-btn').addEventListener('click', logout);
    $('refresh-btn').addEventListener('click', () => load().catch((e) => alert(e.message)));
    $('search').addEventListener('input', () => {
      state.q = $('search').value;
      render();
    });
    $('view-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab');
      if (!btn) return;
      state.view = btn.dataset.view;
      $$('#view-tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
    $('claim-btn').addEventListener('click', () => {
      claim(selectedVins()).catch((e) => alert(e.message));
    });
    $('release-btn').addEventListener('click', () => {
      release(selectedVins()).catch((e) => alert(e.message));
    });
    $('check-all').addEventListener('change', () => {
      const on = $('check-all').checked;
      filtered().forEach((r) => {
        if (on) state.selected.add(r.vin);
        else state.selected.delete(r.vin);
      });
      render();
    });
    $('rows').addEventListener('change', (e) => {
      const box = e.target.closest('input[type="checkbox"][data-vin]');
      if (!box) return;
      if (box.checked) state.selected.add(box.dataset.vin);
      else state.selected.delete(box.dataset.vin);
      syncCheckAll();
    });
    $('rows').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const vin = btn.dataset.vin;
      const run = btn.dataset.act === 'release' ? release([vin]) : claim([vin]);
      run.catch((err) => alert(err.message));
    });
  }

  async function boot() {
    fillLogin();
    bind();
    if (getToken() && getUser()) {
      try {
        const me = await api('/auth/me');
        if (!canUse(me.user)) {
          showApp(false);
          return;
        }
        setSession(getToken(), me.user);
        enter(me.user);
        return;
      } catch {
        clearSession();
      }
    }
    showApp(false);
  }

  boot().catch((e) => { $('login-error').textContent = e.message; });
})();
