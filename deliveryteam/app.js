/* global fetch */
(() => {
  const API = '/api/delivery-team';
  const TOKEN_KEY = 'delivery_team_token_v1';
  const USER_KEY = 'delivery_team_user_v1';

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: null,
    meta: null,
    view: 'dashboard',
    filters: { q: '', status: '', employee: '', page: 1, limit: 40 },
    selectedVins: new Set(),
    reassignVins: new Set(),
    reassignFrom: '',
    reassignRows: [],
    assignPool: [],
    assignDisplay: [],
    assignEmployee: '',
    editsTimer: null,
    liveTimer: null,
    liveFilters: { q: '', employee: '', status: '' },
    liveFingerprint: '',
    tzOffset: -new Date().getTimezoneOffset(),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function na(v) {
    const s = String(v ?? '').trim();
    return s && s !== 'N/A' ? s : 'N/A';
  }

  function ynBadge(v) {
    const s = String(v || '').trim();
    if (s === 'Yes') return '<span class="badge ok">🟢 Yes</span>';
    if (s === 'No') return '<span class="badge bad">🔴 No</span>';
    return '<span class="badge">—</span>';
  }

  function statusRowClass(s) {
    const v = String(s || '').trim();
    if (v === 'Claimed') return 'row-status-claimed';
    if (v === 'PSFU') return 'row-status-psfu';
    if (v === 'جاهز للتسليم') return 'row-status-ready';
    if (v === 'مرور') return 'row-status-traffic';
    if (v === 'رجوع مرور') return 'row-status-traffic-return';
    if (v === 'الغاء') return 'row-status-cancel';
    return '';
  }

  function statusBadge(s) {
    const v = String(s || '').trim();
    if (!v) return '<span class="badge">—</span>';
    if (v === 'Claimed') return `<span class="badge info">${esc(v)}</span>`;
    if (v === 'PSFU' || v === 'تم التسليم') return `<span class="badge ok">${esc(v)}</span>`;
    if (v === 'جاهز للتسليم') return `<span class="badge warn">${esc(v)}</span>`;
    if (v === 'مرور') return `<span class="badge">${esc(v)}</span>`;
    if (v === 'رجوع مرور') return `<span class="badge purple">${esc(v)}</span>`;
    if (v === 'الغاء' || v === 'معلقة') return `<span class="badge bad">${esc(v)}</span>`;
    return `<span class="badge warn">${esc(v)}</span>`;
  }

  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (state.token) headers['X-Delivery-Team-Token'] = state.token;
    if (opts.json) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.json);
    }
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (res.status === 401) {
      logout(true);
      throw new Error('Session expired');
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }
    if (!res.ok) throw new Error(res.statusText);
    return res;
  }

  function canManage() {
    return state.user && (state.user.role === 'admin' || state.user.role === 'hanouf');
  }

  function navItems() {
    const items = [
      { id: 'dashboard', label: 'Dashboard', roles: ['admin', 'hanouf', 'employee'] },
      { id: 'live', label: 'Live Sheet', roles: ['admin', 'hanouf'] },
      { id: 'today', label: "Today's Vehicles", roles: ['admin', 'hanouf'] },
      { id: 'my', label: 'My VINs', roles: ['employee', 'admin', 'hanouf'] },
      { id: 'assign', label: 'Assignment', roles: ['admin', 'hanouf'] },
      { id: 'all', label: 'All Vehicles', roles: ['admin', 'hanouf'] },
      { id: 'upload', label: 'Upload Raw Data', roles: ['admin', 'hanouf'] },
      { id: 'audit', label: 'Audit Log', roles: ['admin', 'hanouf'] },
    ];
    return items.filter((i) => i.roles.includes(state.user.role));
  }

  function renderNav() {
    const nav = $('#side-nav');
    nav.innerHTML = `<p class="sec">Menu</p>` + navItems().map((i) =>
      `<button type="button" data-view="${i.id}" class="${state.view === i.id ? 'active' : ''}">${esc(i.label)}</button>`
    ).join('');
    $$('#side-nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#side-name').textContent = state.user.name;
    $('#side-role').textContent = state.user.role;
    $('#export-btn').hidden = !canManage();
  }

  function setView(view) {
    state.view = view;
    if (state.editsTimer) {
      clearInterval(state.editsTimer);
      state.editsTimer = null;
    }
    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = null;
    }
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${view}`));
    renderNav();
    const titles = {
      dashboard: ['Dashboard', 'Delivery Control Tower'],
      live: ['Live Sheet', 'Excel-style board · all assigned VINs · updates every few seconds'],
      today: ["Today's Vehicles", 'Proforma Date = today'],
      my: ['My VINs', 'Edit your assigned vehicles — changes go to Admin live'],
      assign: ['Assignment', 'Hanouf assignment board'],
      all: ['All Vehicles', 'Full fleet · filters · export'],
      upload: ['Upload Raw Data', 'First worksheet only'],
      audit: ['Audit Log', 'Full history of every edit'],
    };
    const t = titles[view] || ['Delivery Team', ''];
    $('#page-title').textContent = t[0];
    $('#page-sub').textContent = t[1];
    refreshView();
    if (view === 'dashboard' && canManage()) {
      state.editsTimer = setInterval(() => {
        loadDashboard().catch(() => {});
      }, 8000);
    }
    if (view === 'live' && canManage()) {
      state.liveTimer = setInterval(() => {
        loadLiveSheet({ silent: true }).catch(() => {});
      }, 5000);
    }
  }

  async function refreshView() {
    try {
      if (state.view === 'dashboard') await loadDashboard();
      if (state.view === 'live') await loadLiveSheet();
      if (state.view === 'today') await loadToday();
      if (state.view === 'my') await loadMy();
      if (state.view === 'assign') await loadAssign();
      if (state.view === 'all') await loadAll();
      if (state.view === 'audit') await loadAudit();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to load');
    }
  }

  async function loadLiveSheet({ silent = false } = {}) {
    const f = state.liveFilters;
    const params = new URLSearchParams();
    params.set('tzOffset', String(state.tzOffset));
    params.set('sort', 'updatedAt');
    params.set('dir', 'desc');
    if (f.q) params.set('q', f.q);
    if (f.employee) params.set('employee', f.employee);
    if (f.status) params.set('status', f.status);
    const data = await api(`/live-sheet?${params}`);
    const rows = data.rows || [];
    const fingerprint = JSON.stringify(rows.map((r) => [
      r.vin,
      r.ops.opsStatus,
      r.ops.assignedEmployeeName,
      r.ops.carrier,
      r.ops.updatedAt,
      r.ops.notes,
      r.ops.guestSentDate,
      r.ops.signatureReceivedDate,
      r.ops.accountsSentDate,
      r.ops.accountsApprovalDate,
      r.ops.vin1502,
      r.ops.trafficFile,
      r.ops.trafficFeesOps,
      r.ops.insuranceOps,
      r.ops.registrationIssueDate,
      r.ops.transferCity,
    ]));
    const changed = fingerprint !== state.liveFingerprint;
    state.liveFingerprint = fingerprint;

    const statusSel = $('#live-status');
    if (statusSel && !statusSel.dataset.filled) {
      const statuses = (state.meta && state.meta.statuses) || [];
      statusSel.innerHTML = `<option value="">All statuses</option>${statuses.map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`
      ).join('')}`;
      statusSel.value = f.status || '';
      statusSel.dataset.filled = '1';
    }

    const chips = $('#live-chips');
    if (chips) {
      const byEmp = data.byEmployee || {};
      const bySt = data.byStatus || {};
      chips.innerHTML = [
        `<span class="live-chip"><b>${data.total || 0}</b> assigned</span>`,
        ...Object.keys(byEmp).map((k) => `<span class="live-chip">${esc(k)} <b>${byEmp[k]}</b></span>`),
        ...Object.keys(bySt).filter((k) => k !== '(blank)').slice(0, 8).map((k) =>
          `<button type="button" class="live-chip status-filter ${f.status === k ? 'active' : ''}" data-status="${esc(k)}">${esc(k)} <b>${bySt[k]}</b></button>`
        ),
      ].join('');
      $$('.live-chip.status-filter', chips).forEach((b) => b.addEventListener('click', () => {
        state.liveFilters.status = state.liveFilters.status === b.dataset.status ? '' : b.dataset.status;
        if ($('#live-status')) $('#live-status').value = state.liveFilters.status;
        loadLiveSheet().catch((e) => alert(e.message));
      }));
    }

    const meta = $('#live-meta-text');
    const dot = $('#live-dot');
    if (meta) {
      const t = new Date(data.at || Date.now()).toLocaleTimeString();
      meta.textContent = `${data.total || 0} assigned VINs · live · last sync ${t}${changed && silent ? ' · updated' : ''}`;
    }
    if (dot) {
      dot.classList.toggle('pulse', !!changed || !silent);
      setTimeout(() => dot && dot.classList.remove('pulse'), 900);
    }

    if (!changed && silent) return;

    const cols = [
      ['#', (_r, i) => i + 1],
      ['Employee', (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>`],
      ['Status', (r) => statusBadge(r.ops.opsStatus)],
      ['VIN', (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['Proforma', (r) => na(r.raw.proformaDate)],
      ['Order', (r) => na(r.raw.salesOrder)],
      ['Product', (r) => na(r.raw.product)],
      ['Sales Type', (r) => na(r.raw.salesType)],
      ['Invoice Owner', (r) => na(r.raw.invoiceOwner)],
      ['Customer', (r) => na(r.raw.userName)],
      ['S/A', (r) => na(r.raw.salesAdvisor)],
      ['Phone', (r) => na(r.raw.phone)],
      ['GT Loc', (r) => na(r.raw.gtLocation)],
      ['Veh Loc', (r) => na(r.raw.vehicleLocation)],
      ['إرسال الضيف', (r) => na(r.ops.guestSentDate)],
      ['استلام التواقيع', (r) => na(r.ops.signatureReceivedDate)],
      ['إرسال للحسابات', (r) => na(r.ops.accountsSentDate)],
      ['موافقة الحسابات', (r) => na(r.ops.accountsApprovalDate)],
      ['VIN 1502', (r) => ynBadge(r.ops.vin1502)],
      ['ملف المرور', (r) => ynBadge(r.ops.trafficFile)],
      ['Traffic Fees', (r) => ynBadge(r.ops.trafficFeesOps)],
      ['Insurance', (r) => ynBadge(r.ops.insuranceOps)],
      ['إصدار الاستمارة', (r) => na(r.ops.registrationIssueDate)],
      ['مدينة الترحيل', (r) => na(r.ops.transferCity)],
      ['الناقل', (r) => na(r.ops.carrier)],
      ['ملاحظات', (r) => esc(r.ops.notes || '')],
      ['Updated', (r) => esc((r.ops.updatedAt || '').replace('T', ' ').slice(0, 19) || '—')],
      ['By', (r) => na(r.ops.updatedBy)],
    ];

    const table = $('#live-table');
    table.innerHTML = `<thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => {
        const statusCls = statusRowClass(r.ops.opsStatus);
        return `<tr class="${statusCls}" data-vin="${esc(r.vin)}">${cols.map((c) =>
          `<td>${c[1](r, i)}</td>`
        ).join('')}</tr>`;
      }).join('') || `<tr><td colspan="${cols.length}">No assigned VINs yet. Use Assignment to assign vehicles.</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
  }

  async function loadDashboard() {
    const d = await api(`/dashboard?tzOffset=${state.tzOffset}`);
    const t = d.totals || {};
    const kpis = canManage()
      ? [
        ['Total vehicles', t.total, ''],
        ["Today's proformas", t.todaysProformas, 'info'],
        ['Assigned', t.assigned, 'ok'],
        ['Unassigned', t.unassigned, t.unassigned ? 'warn' : 'ok'],
        ['Claimed', t.claimed, 'ok'],
        ['PSFU', t.psfu, 'info'],
        ['Ready for delivery', t.ready, 'info'],
        ['Delivered', t.delivered, 'ok'],
      ]
      : [
        ['Assigned to me', d.myWorkload?.assigned || 0, ''],
        ['Completed (Claimed)', d.myWorkload?.completed || 0, 'ok'],
        ['Remaining', d.myWorkload?.remaining || 0, 'warn'],
        ['Progress %', `${d.myWorkload?.progress || 0}%`, 'info'],
      ];
    $('#dash-kpis').innerHTML = kpis.map(([l, v, cls]) =>
      `<article class="kpi ${cls}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`
    ).join('');

    const p = d.pipeline || {};
    $('#dash-pipeline').innerHTML = [
      ["Today's Proformas", p.todaysProformas],
      ['Assigned', p.assigned],
      ['PSFU', p.psfu],
      ['Ready', p.ready],
      ['Delivered / Claimed', p.delivered],
    ].map(([l, n]) => `<div class="pipe-step"><strong>${esc(n)}</strong><span>${esc(l)}</span></div>`).join('');

    const empCard = $('#dash-emp-card');
    if (!canManage()) {
      empCard.hidden = true;
    } else {
      empCard.hidden = false;
      const rows = d.employees || [];
      $('#dash-emp-table').innerHTML = `<thead><tr><th>Employee</th><th class="num">Assigned</th><th class="num">Claimed</th><th class="num">Remaining</th><th class="num">Progress %</th></tr></thead>
        <tbody>${rows.map((e) => `<tr data-emp="${esc(e.name)}" style="cursor:pointer">
          <td><b>${esc(e.name)}</b></td>
          <td class="num">${e.assigned}</td>
          <td class="num">${e.claimed}</td>
          <td class="num">${e.remaining}</td>
          <td class="num">${e.progress}%</td>
        </tr>`).join('')}</tbody>`;
      $$('#dash-emp-table tr[data-emp]').forEach((tr) => {
        tr.addEventListener('click', () => {
          state.filters.employee = tr.dataset.emp;
          state.filters.page = 1;
          setView('all');
        });
      });
    }

    const by = d.byStatus || {};
    const statuses = (state.meta && state.meta.statuses) || Object.keys(by);
    $('#dash-status').innerHTML = statuses.map((s) =>
      `<button type="button" class="status-chip" data-status="${esc(s)}"><div class="n">${by[s] || 0}</div><div class="l">${esc(s)}</div></button>`
    ).join('');
    $$('#dash-status .status-chip').forEach((b) => b.addEventListener('click', () => {
      state.filters.status = b.dataset.status;
      state.filters.page = 1;
      setView(canManage() ? 'all' : 'my');
    }));

    renderRecentEdits(d.recentEdits || []);
  }

  function fieldLabel(action) {
    const map = {
      guestSentDate: 'تاريخ إرسال الضيف',
      signatureReceivedDate: 'تاريخ استلام التواقيع',
      accountsSentDate: 'إرسال للحسابات',
      accountsApprovalDate: 'موافقة الحسابات',
      registrationIssueDate: 'إصدار الاستمارة',
      opsStatus: 'Status',
      vin1502: 'VIN 1502',
      trafficFile: 'ملف المرور',
      trafficFeesOps: 'Traffic Fees',
      insuranceOps: 'Insurance',
      transferCity: 'مدينة الترحيل',
      carrier: 'الناقل',
      notes: 'ملاحظات',
      assign: 'Assigned',
      reassign: 'Reassigned',
    };
    if (map[action]) return map[action];
    if (String(action).startsWith('update_')) return map[action.slice(7)] || action.slice(7);
    return action;
  }

  function editableControl(vin, field, type, value) {
    const v = value == null ? '' : String(value);
    const common = `class="cell-edit" data-vin="${esc(vin)}" data-field="${esc(field)}"`;
    if (type === 'status') {
      const statuses = (state.meta && state.meta.statuses) || [];
      return `<select ${common}><option value="">—</option>${statuses.map((s) =>
        `<option value="${esc(s)}" ${v === s ? 'selected' : ''}>${esc(s)}</option>`
      ).join('')}</select>`;
    }
    if (type === 'yn') {
      return `<select ${common}>
        <option value="">—</option>
        <option value="Yes" ${v === 'Yes' ? 'selected' : ''}>🟢 Yes</option>
        <option value="No" ${v === 'No' ? 'selected' : ''}>🔴 No</option>
      </select>`;
    }
    if (type === 'date') {
      return `<input type="date" ${common} value="${esc(v)}" />`;
    }
    if (type === 'city') {
      return `<input list="edit-city-list" ${common} value="${esc(v)}" placeholder="City…" />`;
    }
    if (type === 'carrier') {
      const carriers = (state.meta && state.meta.carriers) || [];
      return `<select ${common}><option value="">— الناقل —</option>${carriers.map((c) =>
        `<option value="${esc(c)}" ${v === c ? 'selected' : ''}>${esc(c)}</option>`
      ).join('')}</select>`;
    }
    if (type === 'notes') {
      return `<input type="text" ${common} value="${esc(v)}" placeholder="Notes…" style="min-width:140px" />`;
    }
    return esc(v || '—');
  }

  function scheduleColumns({ editable = false, carrierEditable = false } = {}) {
    const cols = [
      ['Proforma', (r) => na(r.raw.proformaDate)],
      ['Order', (r) => na(r.raw.salesOrder)],
      ['VIN', (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['Sales Type', (r) => na(r.raw.salesType)],
      ['Product', (r) => na(r.raw.product)],
      ['Invoice Owner', (r) => na(r.raw.invoiceOwner)],
      ['Customer Name', (r) => na(r.raw.userName)],
      ['S/A', (r) => na(r.raw.salesAdvisor)],
      ['GT Loc', (r) => na(r.raw.gtLocation)],
      ['Veh Loc', (r) => na(r.raw.vehicleLocation)],
      ['Phone', (r) => na(r.raw.phone)],
    ];
    if (editable) {
      cols.push(
        ['Status', (r) => editableControl(r.vin, 'opsStatus', 'status', r.ops.opsStatus)],
        ['إرسال الضيف', (r) => editableControl(r.vin, 'guestSentDate', 'date', r.ops.guestSentDate)],
        ['استلام التواقيع', (r) => editableControl(r.vin, 'signatureReceivedDate', 'date', r.ops.signatureReceivedDate)],
        ['إرسال للحسابات', (r) => editableControl(r.vin, 'accountsSentDate', 'date', r.ops.accountsSentDate)],
        ['موافقة الحسابات', (r) => editableControl(r.vin, 'accountsApprovalDate', 'date', r.ops.accountsApprovalDate)],
        ['VIN 1502', (r) => editableControl(r.vin, 'vin1502', 'yn', r.ops.vin1502)],
        ['ملف المرور', (r) => editableControl(r.vin, 'trafficFile', 'yn', r.ops.trafficFile)],
        ['Traffic Fees', (r) => editableControl(r.vin, 'trafficFeesOps', 'yn', r.ops.trafficFeesOps)],
        ['Insurance', (r) => editableControl(r.vin, 'insuranceOps', 'yn', r.ops.insuranceOps)],
        ['إصدار الاستمارة', (r) => editableControl(r.vin, 'registrationIssueDate', 'date', r.ops.registrationIssueDate)],
        ['مدينة الترحيل', (r) => editableControl(r.vin, 'transferCity', 'city', r.ops.transferCity)],
        ['الناقل', (r) => editableControl(r.vin, 'carrier', 'carrier', r.ops.carrier)],
        ['ملاحظات', (r) => editableControl(r.vin, 'notes', 'notes', r.ops.notes)],
        ['Open', (r) => `<button type="button" class="btn vin-link" data-vin="${esc(r.vin)}">Full edit</button>`],
      );
    } else {
      cols.push(
        ['Status', (r) => statusBadge(r.ops.opsStatus)],
        ['إرسال الضيف', (r) => na(r.ops.guestSentDate)],
        ['استلام التواقيع', (r) => na(r.ops.signatureReceivedDate)],
        ['إرسال للحسابات', (r) => na(r.ops.accountsSentDate)],
        ['موافقة الحسابات', (r) => na(r.ops.accountsApprovalDate)],
        ['VIN 1502', (r) => ynBadge(r.ops.vin1502)],
        ['ملف المرور', (r) => ynBadge(r.ops.trafficFile)],
        ['Traffic Fees', (r) => ynBadge(r.ops.trafficFeesOps)],
        ['Insurance', (r) => ynBadge(r.ops.insuranceOps)],
        ['إصدار الاستمارة', (r) => na(r.ops.registrationIssueDate)],
        ['مدينة الترحيل', (r) => na(r.ops.transferCity)],
        ['الناقل', (r) => (carrierEditable
          ? editableControl(r.vin, 'carrier', 'carrier', r.ops.carrier)
          : na(r.ops.carrier))],
        ['ملاحظات', (r) => esc((r.ops.notes || '').slice(0, 40))],
        ['Employee', (r) => na(r.ops.assignedEmployeeName)],
      );
    }
    return cols;
  }

  async function saveCellEdit(el) {
    const vin = el.dataset.vin;
    const field = el.dataset.field;
    const value = el.value;
    if (!vin || !field) return;
    el.classList.add('is-saving');
    try {
      await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: { [field]: value } });
      el.classList.remove('is-saving');
      el.classList.add('is-saved');
      if (field === 'opsStatus') {
        const tr = el.closest('tr');
        if (tr) {
          tr.classList.remove(
            'row-status-claimed', 'row-status-psfu', 'row-status-ready',
            'row-status-traffic', 'row-status-traffic-return', 'row-status-cancel'
          );
          const cls = statusRowClass(value);
          if (cls) tr.classList.add(cls);
          tr.dataset.status = value || '';
        }
      }
      const toast = $('#my-save-toast');
      if (toast) {
        toast.hidden = false;
        toast.textContent = `Saved ✓ ${fieldLabel(field)} · ${new Date().toLocaleTimeString()}`;
        setTimeout(() => { toast.hidden = true; }, 2200);
      }
      setTimeout(() => el.classList.remove('is-saved'), 1200);
    } catch (err) {
      el.classList.remove('is-saving');
      alert(err.message || 'Save failed');
    }
  }

  function bindEditableCells(tableEl) {
    $$('.cell-edit', tableEl).forEach((el) => {
      el.addEventListener('change', () => saveCellEdit(el));
      if (el.tagName === 'INPUT' && el.type === 'text') {
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            saveCellEdit(el);
          }
        });
      }
    });
  }

  function fillCarrierLists() {
    const carriers = (state.meta && state.meta.carriers) || [];
    const html = carriers.map((c) => `<option value="${esc(c)}"></option>`).join('');
    ['#edit-carrier-list', '#all-carrier-list', '#assign-carrier-list'].forEach((sel) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    });
    const bulk = $('#assign-bulk-carrier');
    if (bulk && bulk.tagName === 'SELECT' && !bulk.dataset.filled) {
      bulk.innerHTML = `<option value="">— اختر الناقل —</option>${carriers.map((c) =>
        `<option value="${esc(c)}">${esc(c)}</option>`
      ).join('')}`;
      bulk.dataset.filled = '1';
    }
  }

  function renderScheduleTable(tableEl, rows, {
    selectable = false,
    editable = false,
    carrierEditable = false,
    selectionSet = null,
  } = {}) {
    const selected = selectionSet || state.selectedVins;
    const cols = scheduleColumns({ editable, carrierEditable });
    const head = `<thead><tr>${selectable ? '<th></th>' : ''}${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows.map((r) => {
      const statusCls = statusRowClass(r.ops.opsStatus);
      const checked = selected.has(r.vin) ? 'checked' : '';
      return `<tr class="${statusCls} ${checked ? 'selected' : ''}" data-vin="${esc(r.vin)}" data-status="${esc(r.ops.opsStatus || '')}">
        ${selectable ? `<td><input class="checkbox vin-select-check" type="checkbox" data-vin="${esc(r.vin)}" ${checked} /></td>` : ''}
        ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}
      </tr>`;
    }).join('')}</tbody>`;
    tableEl.innerHTML = head + body;
    $$('.vin-link', tableEl).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    if (editable || carrierEditable) bindEditableCells(tableEl);
    if (selectable) {
      $$('.vin-select-check', tableEl).forEach((cb) => cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.dataset.vin);
        else selected.delete(cb.dataset.vin);
        cb.closest('tr').classList.toggle('selected', cb.checked);
        updateMyReassignBar();
        updateLaneReassignCount();
      }));
    }
  }

  function otherEmployees(exceptName) {
    const all = ['Rasha', 'Ruba', 'Ibrahim', 'Abdullah'];
    const skip = String(exceptName || '').trim().toLowerCase();
    return all.filter((n) => n.toLowerCase() !== skip);
  }

  function updateMyReassignBar() {
    const countEl = $('#my-reassign-count');
    if (countEl) countEl.textContent = String(state.reassignVins.size);
  }

  function updateLaneReassignCount() {
    const countEl = $('#lane-reassign-count');
    if (countEl) countEl.textContent = String(state.reassignVins.size);
  }

  function renderReassignTargets(container, exceptName, onPick) {
    if (!container) return;
    const targets = otherEmployees(exceptName);
    container.innerHTML = targets.map((name) =>
      `<button type="button" class="btn reassign-target-btn" data-emp="${esc(name)}">→ ${esc(name)}</button>`
    ).join('');
    $$('.reassign-target-btn', container).forEach((b) => b.addEventListener('click', () => onPick(b.dataset.emp)));
  }

  async function reassignSelected(toEmployee, { clearPanel = false } = {}) {
    const vins = [...state.reassignVins];
    if (!vins.length) return alert('Select at least one VIN first');
    if (!toEmployee) return alert('Choose an employee');
    if (!confirm(`Reassign ${vins.length} VIN(s) to ${toEmployee}?`)) return;
    const res = await api('/reassign', { method: 'POST', json: { vins, employee: toEmployee } });
    const ok = (res.results || []).filter((r) => r.ok).length;
    const fail = (res.results || []).filter((r) => !r.ok);
    alert(`Reassigned ${ok} VIN(s) to ${toEmployee}${fail.length ? `\n${fail.length} failed` : ''}`);
    state.reassignVins.clear();
    if (clearPanel) {
      state.reassignFrom = '';
      state.reassignRows = [];
      const panel = $('#lane-reassign-panel');
      if (panel) panel.hidden = true;
    }
    if (state.view === 'my') await loadMy();
    else if (state.view === 'assign') await loadAssign();
    else await refreshView();
  }

  function renderRecentEdits(edits) {
    const card = $('#dash-edits-card');
    const table = $('#dash-edits-table');
    if (!card || !table) return;
    if (!canManage()) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const rows = edits || [];
    if (!rows.length) {
      table.innerHTML = `<tbody><tr><td>No employee edits yet. Changes on assigned VINs will appear here live.</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `<thead><tr><th>Time</th><th>Employee</th><th>VIN</th><th>Field</th><th>From</th><th>To</th></tr></thead>
      <tbody>${rows.map((a) => `<tr>
        <td>${esc((a.at || '').replace('T', ' ').slice(0, 19))}</td>
        <td><b>${esc(a.user)}</b></td>
        <td>${a.vin ? `<button type="button" class="vin-link" data-vin="${esc(a.vin)}">${esc(a.vin)}</button>` : '—'}</td>
        <td>${esc(fieldLabel(a.action))}</td>
        <td>${esc(a.oldValue)}</td>
        <td><b>${esc(a.newValue)}</b></td>
      </tr>`).join('')}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
  }

  function filterQuery(extra = {}) {
    const p = new URLSearchParams();
    p.set('tzOffset', String(state.tzOffset));
    p.set('page', String(state.filters.page || 1));
    p.set('limit', String(state.filters.limit || 40));
    if (state.filters.q) p.set('q', state.filters.q);
    if (state.filters.status) p.set('status', state.filters.status);
    if (state.filters.employee) p.set('employee', state.filters.employee);
    Object.entries(extra).forEach(([k, v]) => { if (v != null && v !== '') p.set(k, v); });
    return p.toString();
  }

  function renderPager(el, pack, onPage) {
    if (!el) return;
    el.innerHTML = `<span>${pack.total} rows · page ${pack.page}/${pack.pages}</span>
      <button type="button" class="btn" ${pack.page <= 1 ? 'disabled' : ''} data-p="${pack.page - 1}">Prev</button>
      <button type="button" class="btn" ${pack.page >= pack.pages ? 'disabled' : ''} data-p="${pack.page + 1}">Next</button>`;
    $$('button[data-p]', el).forEach((b) => b.addEventListener('click', () => onPage(Number(b.dataset.p))));
  }

  function buildToolbar(el, { showEmployee = true } = {}) {
    const statuses = (state.meta && state.meta.statuses) || [];
    el.innerHTML = `
      <input type="search" data-f="q" placeholder="Search…" value="${esc(state.filters.q)}" />
      <select data-f="status"><option value="">All statuses</option>${statuses.map((s) => `<option ${state.filters.status === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      ${showEmployee && canManage() ? `<select data-f="employee"><option value="">All employees</option>${['Rasha', 'Ruba', 'Ibrahim', 'Abdullah'].map((s) => `<option ${state.filters.employee === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
      <button type="button" class="btn" data-clear>Clear filters</button>
    `;
    $$('[data-f]', el).forEach((inp) => {
      const ev = inp.tagName === 'SELECT' ? 'change' : 'keydown';
      inp.addEventListener(ev, (e) => {
        if (ev === 'keydown' && e.key !== 'Enter') return;
        state.filters[inp.dataset.f] = inp.value;
        state.filters.page = 1;
        refreshView();
      });
    });
    $('[data-clear]', el)?.addEventListener('click', () => {
      state.filters = { q: '', status: '', employee: '', page: 1, limit: 40 };
      refreshView();
    });
  }

  async function loadToday() {
    fillCarrierLists();
    const data = await api(`/todays-proformas?tzOffset=${state.tzOffset}`);
    renderScheduleTable($('#today-table'), data.rows || [], { carrierEditable: canManage() });
  }

  async function loadMy() {
    buildToolbar($('#my-toolbar'), { showEmployee: false });
    const cities = (state.meta && state.meta.transferCities) || [];
    const carriers = (state.meta && state.meta.carriers) || [];
    const cityList = $('#edit-city-list');
    const carrierList = $('#edit-carrier-list');
    if (cityList) cityList.innerHTML = cities.map((c) => `<option value="${esc(c)}"></option>`).join('');
    if (carrierList) carrierList.innerHTML = carriers.map((c) => `<option value="${esc(c)}"></option>`).join('');
    fillCarrierLists();

    const pack = await api(`/vehicles?${filterQuery()}`);
    if (state.user.role === 'employee') {
      const dash = await api(`/dashboard?tzOffset=${state.tzOffset}`);
      const w = dash.myWorkload || {};
      $('#my-kpis').innerHTML = [
        ['Assigned', w.assigned, ''],
        ['Completed', w.completed, 'ok'],
        ['Remaining', w.remaining, 'warn'],
        ['Progress %', `${w.progress}%`, 'info'],
      ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${l}</div><div class="val">${v}</div></article>`).join('');
    } else {
      $('#my-kpis').innerHTML = '';
    }
    renderScheduleTable($('#my-table'), pack.rows || [], {
      editable: true,
      selectable: true,
      selectionSet: state.reassignVins,
    });
    renderPager($('#my-pager'), pack, (p) => { state.filters.page = p; loadMy(); });
    const except = state.user.role === 'employee' ? state.user.name : '';
    renderReassignTargets($('#my-reassign-targets'), except, (emp) => {
      reassignSelected(emp).catch((e) => alert(e.message));
    });
    updateMyReassignBar();
  }

  async function loadAll() {
    buildToolbar($('#all-toolbar'), { showEmployee: true });
    fillCarrierLists();
    const pack = await api(`/vehicles?${filterQuery()}`);
    renderScheduleTable($('#all-table'), pack.rows || [], { carrierEditable: canManage() });
    renderPager($('#all-pager'), pack, (p) => { state.filters.page = p; loadAll(); });
  }

  async function loadAssign() {
    state.selectedVins.clear();
    fillCarrierLists();
    await loadAssignPool(true);
    renderAssignDisplay();
    const dash = await api(`/dashboard?tzOffset=${state.tzOffset}`);
    $('#assign-lanes').innerHTML = (dash.employees || []).map((e) =>
      `<div class="lane" data-emp="${esc(e.name)}">
        <div class="lane-top">
          <div>
            <h4>${esc(e.name)}</h4>
            <div class="count">${e.assigned} assigned · ${e.remaining} remaining · ${e.progress}%</div>
          </div>
          <button type="button" class="btn lane-select-btn" data-emp="${esc(e.name)}" ${e.assigned ? '' : 'disabled'}>
            Select VINs
          </button>
        </div>
      </div>`
    ).join('');
    $$('.lane-select-btn').forEach((b) => b.addEventListener('click', () => {
      openLaneReassign(b.dataset.emp).catch((e) => alert(e.message));
    }));
    if (state.reassignFrom) {
      await openLaneReassign(state.reassignFrom);
    } else {
      const panel = $('#lane-reassign-panel');
      if (panel) panel.hidden = true;
    }
  }

  async function openLaneReassign(employeeName) {
    state.reassignFrom = employeeName;
    state.reassignVins.clear();
    const prevEmp = state.filters.employee;
    const prevPage = state.filters.page;
    const prevLimit = state.filters.limit;
    state.filters.employee = employeeName;
    state.filters.page = 1;
    state.filters.limit = 200;
    let data;
    try {
      data = await api(`/vehicles?${filterQuery()}`);
    } finally {
      state.filters.employee = prevEmp;
      state.filters.page = prevPage;
      state.filters.limit = prevLimit;
    }
    state.reassignRows = data.rows || [];
    const panel = $('#lane-reassign-panel');
    panel.hidden = false;
    $('#lane-reassign-title').textContent = `${employeeName} · select VINs to reassign`;
    $('#lane-reassign-hint').textContent = `${state.reassignRows.length} VIN(s) currently with ${employeeName}`;
    renderScheduleTable($('#lane-reassign-table'), state.reassignRows, {
      selectable: true,
      selectionSet: state.reassignVins,
    });
    renderReassignTargets($('#lane-reassign-targets'), employeeName, (emp) => {
      reassignSelected(emp, { clearPanel: true }).catch((e) => alert(e.message));
    });
    updateLaneReassignCount();
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadAssignPool(todayOnly) {
    const data = await api(`/unassigned?tzOffset=${state.tzOffset}${todayOnly ? '&today=1' : ''}`);
    state.assignPool = data.rows || [];
    renderAssignPool();
    $('#assign-pool-hint').textContent = todayOnly
      ? `${state.assignPool.length} today’s unassigned · check VINs then Submit & display`
      : `${state.assignPool.length} unassigned · check VINs then Submit & display`;
  }

  function renderAssignPool() {
    const q = String($('#assign-pool-search')?.value || '').trim().toLowerCase();
    let rows = state.assignPool || [];
    if (q) {
      rows = rows.filter((r) =>
        `${r.vin} ${r.raw.product} ${r.raw.salesOrder} ${r.raw.salesType}`.toLowerCase().includes(q)
      );
    }
    const cols = [
      ['VIN', (r) => esc(r.vin)],
      ['Product', (r) => na(r.raw.product)],
      ['Sales Type', (r) => na(r.raw.salesType)],
      ['Proforma', (r) => na(r.raw.proformaDate)],
      ['Status', (r) => statusBadge(r.ops.opsStatus)],
      ['Currently', (r) => na(r.ops.assignedEmployeeName)],
    ];
    const head = `<thead><tr><th></th>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows.map((r) => {
      const checked = state.selectedVins.has(r.vin) ? 'checked' : '';
      return `<tr class="${checked ? 'selected' : ''}">
        <td><input class="checkbox assign-pool-check" type="checkbox" data-vin="${esc(r.vin)}" ${checked} /></td>
        ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}
      </tr>`;
    }).join('') || '<tr><td colspan="7">No unassigned VINs in this pool.</td></tr>'}</tbody>`;
    $('#assign-pool-table').innerHTML = head + body;
    $$('.assign-pool-check').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) state.selectedVins.add(cb.dataset.vin);
      else state.selectedVins.delete(cb.dataset.vin);
      cb.closest('tr').classList.toggle('selected', cb.checked);
    }));
  }

  function parseVinPaste(text) {
    return String(text || '')
      .split(/[\s,;]+/)
      .map((v) => v.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);
  }

  async function submitVinsForDisplay() {
    const fromChecks = [...state.selectedVins];
    const fromPaste = parseVinPaste($('#assign-vin-input').value);
    const vins = [...new Set([...fromChecks, ...fromPaste])];
    if (!vins.length) {
      alert('Select VINs from the pool and/or paste VINs, then Submit & display.');
      return;
    }
    const data = await api('/resolve-vins', { method: 'POST', json: { vins } });
    state.assignDisplay = data.rows || [];
    if (data.missing && data.missing.length) {
      alert(`${data.missing.length} VIN(s) not found in Raw Data:\n${data.missing.slice(0, 12).join('\n')}`);
    }
    if (!state.assignDisplay.length) {
      alert('None of the submitted VINs were found. Upload Raw Data first.');
      return;
    }
    state.selectedVins.clear();
    $('#assign-vin-input').value = '';
    renderAssignPool();
    renderAssignDisplay();
    $('#assign-step-2').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderAssignDisplay() {
    const empty = $('#assign-display-empty');
    const body = $('#assign-display-body');
    const rows = state.assignDisplay || [];
    if (!rows.length) {
      empty.hidden = false;
      body.hidden = true;
      $('#assign-confirm-btn').disabled = true;
      return;
    }
    empty.hidden = true;
    body.hidden = false;
    $('#assign-display-count').textContent = String(rows.length);
    fillCarrierLists();
    renderScheduleTable($('#assign-display-table'), rows, { selectable: false, carrierEditable: true });
    updateAssignConfirmState();
  }

  function updateAssignConfirmState() {
    const emp = state.assignEmployee;
    const has = (state.assignDisplay || []).length > 0;
    $('#assign-confirm-btn').disabled = !(emp && has);
    const carrier = String($('#assign-bulk-carrier')?.value || '').trim();
    $('#assign-picked-label').textContent = emp
      ? `Selected: ${emp}${carrier ? ` · الناقل: ${carrier}` : ''} · ${state.assignDisplay.length} VIN(s)`
      : 'No employee selected';
    $$('.assign-emp-btn').forEach((b) => b.classList.toggle('active', b.dataset.emp === emp));
    const carrierBtn = $('#assign-carrier-btn');
    if (carrierBtn) carrierBtn.disabled = !(has && carrier);
  }

  async function doAssign() {
    const employee = state.assignEmployee;
    const vins = (state.assignDisplay || []).map((r) => r.vin);
    const carrier = String($('#assign-bulk-carrier')?.value || '').trim();
    if (!employee) return alert('Choose an employee first');
    if (!vins.length) return alert('Submit & display VINs first');
    const res = await api('/assign', { method: 'POST', json: { vins, employee, carrier: carrier || undefined } });
    const ok = (res.results || []).filter((r) => r.ok).length;
    alert(`Assigned ${ok} VIN(s) to ${employee}${carrier ? ` · الناقل: ${carrier}` : ''}`);
    state.assignDisplay = [];
    state.assignEmployee = '';
    if ($('#assign-bulk-carrier')) $('#assign-bulk-carrier').value = '';
    await loadAssign();
  }

  async function doAssignCarrier() {
    const vins = (state.assignDisplay || []).map((r) => r.vin);
    const carrier = String($('#assign-bulk-carrier')?.value || '').trim();
    if (!vins.length) return alert('Submit & display VINs first');
    if (!carrier) return alert('اختر الناقل أولاً');
    const res = await api('/assign-carrier', { method: 'POST', json: { vins, carrier } });
    const ok = (res.results || []).filter((r) => r.ok).length;
    alert(`تم تعيين الناقل «${carrier}» لـ ${ok} VIN(s)`);
    // refresh displayed rows with updated carrier
    const data = await api('/resolve-vins', { method: 'POST', json: { vins } });
    state.assignDisplay = data.rows || [];
    renderAssignDisplay();
  }

  async function loadAudit() {
    const vin = $('#audit-vin').value.trim();
    const page = state.filters.page || 1;
    const pack = await api(`/audit?page=${page}&limit=50${vin ? `&vin=${encodeURIComponent(vin)}` : ''}`);
    $('#audit-table').innerHTML = `<thead><tr><th>Time</th><th>VIN</th><th>User</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
      <tbody>${(pack.rows || []).map((a) => `<tr>
        <td>${esc((a.at || '').replace('T', ' ').slice(0, 19))}</td>
        <td>${esc(a.vin || '—')}</td>
        <td>${esc(a.user)}</td>
        <td>${esc(a.action)}</td>
        <td>${esc(a.oldValue)}</td>
        <td>${esc(a.newValue)}</td>
      </tr>`).join('')}</tbody>`;
    renderPager($('#audit-pager'), { ...pack, pages: Math.max(1, Math.ceil(pack.total / pack.limit)) }, (p) => {
      state.filters.page = p;
      loadAudit();
    });
  }

  async function openVin(vin) {
    const data = await api(`/vehicles/${encodeURIComponent(vin)}`);
    const v = data.vehicle;
    const back = $('#vin-drawer-back');
    const drawer = $('#vin-drawer');
    const statuses = (state.meta && state.meta.statuses) || [];
    const cities = (state.meta && state.meta.transferCities) || [];
    const carriers = (state.meta && state.meta.carriers) || [];

    drawer.innerHTML = buildDrawerHtml(v, statuses, cities, carriers);
    back.classList.add('open');
    $('#drawer-close', drawer).onclick = () => back.classList.remove('open');
    back.onclick = (e) => { if (e.target === back) back.classList.remove('open'); };

    async function savePatch(patch) {
      try {
        const res = await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: patch });
        const line = $('#save-line', drawer);
        line.hidden = false;
        line.textContent = `Saved ✓ · ${new Date(res.lastUpdated).toLocaleTimeString()}`;
        $('#last-updated', drawer).textContent = `Last updated: ${res.lastUpdated}`;
        setTimeout(() => { line.hidden = true; }, 2500);
      } catch (err) {
        alert(err.message || 'Save failed');
      }
    }

    $$('[data-ops]', drawer).forEach((el) => {
      el.addEventListener('change', () => savePatch({ [el.dataset.ops]: el.value }));
    });
    $$('[data-yn]', drawer).forEach((group) => {
      $$('button', group).forEach((b) => b.addEventListener('click', () => {
        $$('button', group).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        savePatch({ [group.dataset.yn]: b.dataset.v });
      }));
    });
  }

  function buildDrawerHtml(v, statuses, cities, carriers) {
    const yn = (key, label, val) => `<div class="field"><label>${esc(label)}</label>
      <div class="yn" data-yn="${key}">
        <button type="button" class="yes ${val === 'Yes' ? 'active' : ''}" data-v="Yes">🟢 YES</button>
        <button type="button" class="no ${val === 'No' ? 'active' : ''}" data-v="No">🔴 NO</button>
      </div></div>`;
    const dt = (key, label, val) => `<div class="field"><label>${esc(label)}</label><input type="date" data-ops="${key}" value="${esc(val || '')}" /></div>`;
    return `
      <div class="drawer-head">
        <div>
          <h2>${esc(na(v.raw.product))}</h2>
          <div class="meta-row">
            <span class="badge info">${esc(v.vin)}</span>
            <span class="badge">${esc(na(v.raw.salesOrder))}</span>
            ${statusBadge(v.ops.opsStatus)}
            <span class="badge">${esc(na(v.ops.assignedEmployeeName))}</span>
          </div>
        </div>
        <button type="button" class="btn" id="drawer-close">Close</button>
      </div>
      <div class="detail-grid">
        <div class="card">
          <h2>Vehicle information</h2>
          <p class="hint">Raw Data (read-only)</p>
          ${[
            ['Proforma Date', v.raw.proformaDate], ['Sales Order', v.raw.salesOrder],
            ['Sales Type', v.raw.salesType], ['Invoice Owner', v.raw.invoiceOwner],
            ['Customer Name', v.raw.userName], ['S/A', v.raw.salesAdvisor],
            ['GT Location', v.raw.gtLocation], ['Vehicle Location', v.raw.vehicleLocation],
            ['Phone', v.raw.phone], ['PIC', v.raw.pic],
          ].map(([l, val]) => `<div class="field"><label>${esc(l)}</label><input value="${esc(na(val))}" readonly /></div>`).join('')}
        </div>
        <div class="card">
          <h2>Delivery information</h2>
          <p class="hint">Employee updates · saves immediately</p>
          <div id="save-line" class="save-toast" hidden>Saved ✓</div>
          ${dt('guestSentDate', 'تاريخ إرسال الضيف', v.ops.guestSentDate)}
          ${dt('signatureReceivedDate', 'تاريخ استلام التواقيع من الضيف', v.ops.signatureReceivedDate)}
          ${dt('accountsSentDate', 'تاريخ إرسال الملف للحسابات', v.ops.accountsSentDate)}
          ${dt('accountsApprovalDate', 'تاريخ موافقة الحسابات', v.ops.accountsApprovalDate)}
          <div class="field"><label>Status</label>
            <select data-ops="opsStatus"><option value="">—</option>${statuses.map((s) => `<option ${v.ops.opsStatus === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
          </div>
          ${yn('vin1502', 'Current VIN 1502?', v.ops.vin1502)}
          ${yn('trafficFile', 'ملف المرور', v.ops.trafficFile)}
          ${yn('trafficFeesOps', 'Traffic Fees', v.ops.trafficFeesOps)}
          ${yn('insuranceOps', 'Insurance', v.ops.insuranceOps)}
          ${dt('registrationIssueDate', 'تاريخ إصدار الاستمارة', v.ops.registrationIssueDate)}
          <div class="field"><label>مدينة الترحيل</label>
            <input list="city-list" data-ops="transferCity" value="${esc(v.ops.transferCity || '')}" placeholder="Search city…" />
            <datalist id="city-list">${cities.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          </div>
          <div class="field"><label>الناقل</label>
            <input list="carrier-list" data-ops="carrier" value="${esc(v.ops.carrier || '')}" placeholder="Search carrier…" />
            <datalist id="carrier-list">${carriers.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          </div>
          <div class="field"><label>ملاحظات</label>
            <textarea data-ops="notes">${esc(v.ops.notes || '')}</textarea>
          </div>
          <p class="hint" id="last-updated">Last updated: ${esc(v.ops.updatedAt || '—')}</p>
        </div>
      </div>`;
  }

  async function doUpload(file) {
    if (!file) return;
    const summary = $('#upload-summary');
    summary.hidden = false;
    summary.innerHTML = `<p class="hint">Uploading ${esc(file.name)}…</p>`;
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        headers: {
          'X-Delivery-Team-Token': state.token,
          'X-Filename': encodeURIComponent(file.name),
          'X-Tz-Offset': String(state.tzOffset),
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      const s = data.summary;
      summary.innerHTML = `
        <p><b>Sheet used:</b> ${esc(data.sheetName)} <span class="hint">(first worksheet only)</span></p>
        <div class="summary-grid">
          <div><strong>${s.rowsProcessed}</strong><span>Rows processed</span></div>
          <div><strong>${s.newVins}</strong><span>New VINs</span></div>
          <div><strong>${s.updatedVins}</strong><span>Updated VINs</span></div>
          <div><strong>${s.todaysProformas}</strong><span>Today's proformas</span></div>
          <div><strong>${s.duplicateVins}</strong><span>Duplicate VINs</span></div>
          <div><strong>${s.errorCount}</strong><span>Errors</span></div>
        </div>
        ${s.errors && s.errors.length ? `<p class="hint" style="color:var(--red);margin-top:10px">${s.errors.slice(0, 8).map((e) => `Row ${e.row}: ${esc(e.error)}`).join(' · ')}</p>` : ''}`;
    } catch (err) {
      summary.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  async function doExport() {
    const res = await api('/export');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `delivery-team-export.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showApp() {
    $('#login-screen').style.display = 'none';
    $('#app').classList.add('is-on');
    renderNav();
    if (state.user.role === 'hanouf') setView('live');
    else if (canManage()) setView('dashboard');
    else setView('my');
  }

  function logout(silent) {
    state.token = '';
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    $('#app').classList.remove('is-on');
    $('#login-screen').style.display = '';
    if (!silent) location.reload();
  }

  async function login() {
    const username = $('#login-user').value;
    const password = $('#login-pass').value;
    $('#login-error').textContent = '';
    try {
      const data = await api('/auth/login', { method: 'POST', json: { username, password } });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message || 'Login failed';
    }
  }

  async function boot() {
    state.meta = await (await fetch(`${API}/meta`)).json();
    const users = state.meta.users || [];
    $('#login-user').innerHTML = users.map((u) => `<option value="${esc(u.name)}">${esc(u.name)} (${esc(u.role)})</option>`).join('');
    $('#login-pills').innerHTML = users.map((u) =>
      `<button type="button" data-u="${esc(u.name)}">${esc(u.name)}</button>`
    ).join('');
    $$('#login-pills button').forEach((b) => b.addEventListener('click', () => {
      $('#login-user').value = b.dataset.u;
      $$('#login-pills button').forEach((x) => x.classList.toggle('active', x === b));
    }));

    if (state.token) {
      try {
        const me = await api('/auth/me');
        state.user = me.user;
        showApp();
        return;
      } catch {
        logout(true);
      }
    }
  }

  // Events
  $('#login-btn').addEventListener('click', login);
  $('#login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#logout-btn').addEventListener('click', () => logout());
  $('#refresh-btn').addEventListener('click', refreshView);
  $('#export-btn').addEventListener('click', () => doExport().catch((e) => alert(e.message)));
  $('#assign-submit-btn')?.addEventListener('click', () => submitVinsForDisplay().catch((e) => alert(e.message)));
  $('#assign-confirm-btn')?.addEventListener('click', () => doAssign().catch((e) => alert(e.message)));
  $('#assign-carrier-btn')?.addEventListener('click', () => doAssignCarrier().catch((e) => alert(e.message)));
  $('#assign-bulk-carrier')?.addEventListener('change', () => updateAssignConfirmState());
  $('#assign-load-today')?.addEventListener('click', () => loadAssignPool(true).catch((e) => alert(e.message)));
  $('#assign-load-all-unassigned')?.addEventListener('click', () => loadAssignPool(false).catch((e) => alert(e.message)));
  $('#assign-clear-display')?.addEventListener('click', () => {
    state.assignDisplay = [];
    state.assignEmployee = '';
    renderAssignDisplay();
  });
  $('#my-reassign-clear')?.addEventListener('click', () => {
    state.reassignVins.clear();
    loadMy().catch((e) => alert(e.message));
  });
  $('#lane-reassign-close')?.addEventListener('click', () => {
    state.reassignFrom = '';
    state.reassignRows = [];
    state.reassignVins.clear();
    $('#lane-reassign-panel').hidden = true;
  });
  $('#lane-reassign-clear')?.addEventListener('click', () => {
    state.reassignVins.clear();
    renderScheduleTable($('#lane-reassign-table'), state.reassignRows, {
      selectable: true,
      selectionSet: state.reassignVins,
    });
    updateLaneReassignCount();
  });
  $('#lane-reassign-select-all')?.addEventListener('click', () => {
    (state.reassignRows || []).forEach((r) => state.reassignVins.add(r.vin));
    renderScheduleTable($('#lane-reassign-table'), state.reassignRows, {
      selectable: true,
      selectionSet: state.reassignVins,
    });
    updateLaneReassignCount();
  });
  $('#assign-pool-search')?.addEventListener('input', () => renderAssignPool());
  $$('.assign-emp-btn').forEach((b) => b.addEventListener('click', () => {
    state.assignEmployee = b.dataset.emp;
    updateAssignConfirmState();
  }));
  $('#dash-edits-refresh')?.addEventListener('click', () => loadDashboard().catch((e) => alert(e.message)));
  $('#live-refresh')?.addEventListener('click', () => loadLiveSheet().catch((e) => alert(e.message)));
  $('#live-q')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    state.liveFilters.q = e.target.value.trim();
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#live-employee')?.addEventListener('change', (e) => {
    state.liveFilters.employee = e.target.value;
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#live-status')?.addEventListener('change', (e) => {
    state.liveFilters.status = e.target.value;
    loadLiveSheet().catch((err) => alert(err.message));
  });
  $('#audit-refresh').addEventListener('click', () => { state.filters.page = 1; loadAudit(); });
  $('#audit-vin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.filters.page = 1; loadAudit(); }
  });
  $('#global-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    state.filters.q = e.target.value.trim();
    state.filters.page = 1;
    setView(canManage() ? 'all' : 'my');
  });

  const drop = $('#upload-drop');
  const fileInput = $('#upload-file');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => doUpload(fileInput.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
    doUpload(e.dataTransfer.files[0]);
  });

  boot().catch((err) => {
    console.error(err);
    $('#login-error').textContent = 'Cannot reach server';
  });
})();
