/* Delivery Transformation — employee app (same layout & flow as deliveryteam) */
(() => {
  const { api, esc, getToken, getUser, setSession, clearSession } = window.DTX;

  const state = {
    user: null,
    meta: null,
    view: 'dashboard',
    monthFilter: '',
    liveFilters: { q: '', employee: '', status: '', month: '', carrier: '' },
    myFilters: { q: '', status: '' },
    liveFingerprint: '',
    liveTimer: null,
    reassignVins: new Set(),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function na(v) {
    const s = String(v ?? '').trim();
    return s && s !== 'N/A' ? s : 'N/A';
  }

  function isAdmin() {
    return !!(state.user && state.user.role === 'admin');
  }

  /** Admin + Hanouf: see and edit every VIN, upload VINs and Sales Raw. */
  function isManager() {
    return !!(state.user && (state.user.role === 'admin' || state.user.role === 'hanouf'));
  }

  function formatWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  function renderImports(imports) {
    const raw = (imports && imports.lastSalesRaw) || null;
    const pill = $('#raw-status-pill');
    if (pill) {
      pill.classList.toggle('is-empty', !raw);
      pill.classList.toggle('is-fresh', !!raw
        && Date.now() - new Date(raw.at).getTime() < 24 * 60 * 60 * 1000);
      $('#raw-status-time').textContent = raw ? formatWhen(raw.at) : 'Not uploaded';
      pill.title = raw ? `Sales Raw by ${raw.by} · ${raw.filename}` : 'Sales Raw not uploaded yet';
    }
    const rawCard = $('#sales-raw-last');
    if (rawCard) {
      rawCard.textContent = raw
        ? `${formatWhen(raw.at)} · ${raw.by} · ${raw.filename} · ${raw.updated} VIN(s) updated`
        : 'Not uploaded yet';
    }
    const up = (imports && imports.lastUpload) || null;
    const upCard = $('#upload-last');
    if (upCard) {
      upCard.textContent = up
        ? `${formatWhen(up.at)} · ${up.by} · ${up.filename} · ${up.month}: ${up.created} new, ${up.updated} updated`
        : 'Not uploaded yet';
    }
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
    if (v === 'تم التسليم') return 'row-status-delivered';
    if (v === 'جاهز للتسليم') return 'row-status-ready';
    if (v === 'مرور') return 'row-status-traffic';
    if (v === 'رجوع مرور') return 'row-status-traffic-return';
    if (v === 'معلقة') return 'row-status-pending';
    if (v === 'الغاء') return 'row-status-cancel';
    return '';
  }

  function statusBadge(s) {
    const v = String(s || '').trim();
    if (!v) return '<span class="badge">—</span>';
    if (v === 'Claimed') return `<span class="badge info">${esc(v)}</span>`;
    if (v === 'PSFU') return `<span class="badge ok">${esc(v)}</span>`;
    if (v === 'تم التسليم') return `<span class="badge yellow">${esc(v)}</span>`;
    if (v === 'جاهز للتسليم') return `<span class="badge orange">${esc(v)}</span>`;
    if (v === 'مرور') return `<span class="badge">${esc(v)}</span>`;
    if (v === 'رجوع مرور') return `<span class="badge purple">${esc(v)}</span>`;
    if (v === 'معلقة') return `<span class="badge navy">${esc(v)}</span>`;
    if (v === 'الغاء') return `<span class="badge bad">${esc(v)}</span>`;
    return `<span class="badge warn">${esc(v)}</span>`;
  }

  const FIELD_LABELS = {
    opsStatus: 'Status',
    guestSentDate: 'إرسال الضيف',
    signatureReceivedDate: 'استلام التواقيع',
    accountsSentDate: 'إرسال للحسابات',
    accountsApprovalDate: 'موافقة الحسابات',
    vin1502: 'VIN 1502',
    trafficFile: 'ملف المرور',
    trafficFeesOps: 'Traffic Fees',
    insuranceOps: 'Insurance',
    registrationIssueDate: 'إصدار الاستمارة',
    transferCity: 'مدينة الترحيل',
    carrier: 'الناقل',
    notes: 'ملاحظات',
    guestCenter: 'Guest Exp',
  };

  function isMine(r) {
    return !!(state.user && r && r.ops && r.ops.assignedEmployeeId === state.user.id);
  }

  function isDone(r) {
    const s = r && r.ops && r.ops.opsStatus;
    return s === 'Claimed' || s === 'تم التسليم';
  }

  function employeeNames() {
    return ((state.meta && state.meta.employees) || []).map((e) => e.name);
  }

  // ——— Editable cells ———
  function editableControl(vin, field, type, value) {
    const v = value == null ? '' : String(value);
    const common = `class="cell-edit" data-vin="${esc(vin)}" data-field="${esc(field)}"`;
    const options = (list, placeholder) => `<option value="">${placeholder}</option>${list.map((s) =>
      `<option value="${esc(s)}" ${v === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}`;
    if (type === 'status') return `<select ${common}>${options(state.meta.statuses || [], '—')}</select>`;
    if (type === 'yn') return `<select ${common}>${options(['Yes', 'No'], '—')}</select>`;
    if (type === 'date') return `<input type="date" ${common} value="${esc(v)}" />`;
    if (type === 'city') return `<input list="edit-city-list" ${common} value="${esc(v)}" placeholder="City…" />`;
    if (type === 'carrier') return `<select ${common}>${options(state.meta.carriers || [], '— الناقل —')}</select>`;
    if (type === 'notes') return `<input type="text" ${common} value="${esc(v)}" placeholder="Notes…" style="min-width:140px" />`;
    return esc(v || '—');
  }

  function readOnlyValue(type, value) {
    if (type === 'status') return `<span class="cell-status">${statusBadge(value)}</span>`;
    if (type === 'yn') return ynBadge(value);
    if (type === 'notes') return esc(String(value || '').slice(0, 40));
    return esc(na(value));
  }

  function ensureDatalists() {
    if ($('#edit-city-list')) return;
    const dl = document.createElement('datalist');
    dl.id = 'edit-city-list';
    dl.innerHTML = ((state.meta && state.meta.transferCities) || [])
      .map((c) => `<option value="${esc(c)}"></option>`).join('');
    document.body.appendChild(dl);
  }

  async function saveCellEdit(el) {
    const vin = el.dataset.vin;
    const field = el.dataset.field;
    if (!vin || !field) return;
    el.classList.add('is-saving');
    try {
      await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: { [field]: el.value } });
      el.classList.remove('is-saving');
      el.classList.add('is-saved');
      if (field === 'opsStatus') {
        const tr = el.closest('tr');
        if (tr) {
          tr.className = tr.className.split(' ').filter((c) => !c.startsWith('row-status-')).join(' ');
          const cls = statusRowClass(el.value);
          if (cls) tr.classList.add(cls);
        }
      }
      const toast = (state.view === 'live' ? $('#live-save-toast') : $('#my-save-toast'));
      if (toast) {
        toast.hidden = false;
        toast.textContent = `Saved ✓ ${FIELD_LABELS[field] || field} · ${new Date().toLocaleTimeString()}`;
        setTimeout(() => { toast.hidden = true; }, 2200);
      }
      setTimeout(() => el.classList.remove('is-saved'), 1200);
    } catch (err) {
      el.classList.remove('is-saving');
      alert(err.message || 'Save failed');
    }
  }

  function bindEditableCells(tableEl) {
    $$('.cell-edit', tableEl).forEach((el) => el.addEventListener('change', () => saveCellEdit(el)));
  }

  // ——— Nav / views ———
  function navItems() {
    return [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'live', label: 'Live Sheet' },
      { id: 'my', label: isManager() ? 'All VINs' : 'My VINs' },
      ...(isManager() ? [
        { id: 'upload', label: 'Upload VINs' },
        { id: 'sales-raw', label: 'Sales Raw' },
      ] : []),
    ];
  }

  function renderNav() {
    const nav = $('#side-nav');
    const links = isAdmin()
      ? `<p class="sec">Admin</p>
         <button type="button" data-href="admin.html">Admin page</button>
         <button type="button" data-href="coordinator.html">Coordinator view</button>`
      : '';
    nav.innerHTML = `<p class="sec">Menu</p>${navItems().map((i) =>
      `<button type="button" data-view="${i.id}" class="${state.view === i.id ? 'active' : ''}">${esc(i.label)}</button>`
    ).join('')}${links}`;
    $$('#side-nav button[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('#side-nav button[data-href]').forEach((b) => b.addEventListener('click', () => { location.href = b.dataset.href; }));
    $('#side-name').textContent = state.user.name;
    $('#side-role').textContent = state.user.role;
  }

  function setView(view) {
    state.view = view;
    if (state.liveTimer) {
      clearInterval(state.liveTimer);
      state.liveTimer = null;
    }
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${view}`));
    renderNav();
    const titles = {
      dashboard: ['Dashboard', 'Delivery Control Tower'],
      live: ['Live Sheet', 'All teammates’ schedules · Sales Type (cash / bank)'],
      my: isManager()
        ? ['All VINs', 'Every VIN · edit · hand over to an employee']
        : ['My VINs', 'Your schedule · edit your work · الناقل'],
      upload: ['Upload VINs', `Delivery sheet · only Proforma Date in ${state.meta.currentMonth || 'this month'}`],
      'sales-raw': ['Sales Raw', 'Refreshes vehicle details on every VIN · everyone sees the update time'],
    };
    const t = titles[view] || ['Delivery Transformation', ''];
    $('#page-title').textContent = t[0];
    $('#page-sub').textContent = t[1];
    refreshView();
    if (view === 'live') {
      state.liveTimer = setInterval(() => loadLiveSheet({ silent: true }).catch(() => {}), 5000);
    }
  }

  async function refreshView() {
    try {
      if (state.view === 'dashboard') await loadDashboard();
      if (state.view === 'live') await loadLiveSheet();
      if (state.view === 'my') await loadMy();
      if (state.view === 'upload' || state.view === 'sales-raw') await loadImportPanels();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to load');
    }
  }

  async function fetchLive(params) {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const data = await api(`/live-sheet${qs.toString() ? `?${qs}` : ''}`);
    renderImports(data.imports);
    return data;
  }

  // ——— Upload VINs / Sales Raw (Hanouf / Admin) ———
  async function loadImportPanels() {
    state.meta = await api('/meta');
    $('#upload-month').textContent = state.meta.currentMonth || 'this month';
    renderImports(state.meta.imports);
  }

  async function sendFile(path, file) {
    const res = await fetch(`${window.DTX.API}${path}`, {
      method: 'POST',
      headers: {
        'X-Delivery-Transform-Token': getToken(),
        'X-Filename': encodeURIComponent(file.name),
        'Content-Type': 'application/octet-stream',
      },
      body: await file.arrayBuffer(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  async function doUpload(file) {
    if (!file) return;
    const box = $('#upload-summary');
    box.hidden = false;
    box.innerHTML = `<p class="hint">Uploading ${esc(file.name)}…</p>`;
    try {
      const { summary: s } = await sendFile('/upload', file);
      box.innerHTML = `
        <p><b>Sheet used:</b> ${esc(s.sheet)} · <b>Month applied:</b> ${esc(s.month)}</p>
        <div class="summary-grid">
          <div><strong>${s.rows}</strong><span>Rows read</span></div>
          <div><strong>${s.created}</strong><span>New VINs</span></div>
          <div><strong>${s.updated}</strong><span>VINs updated</span></div>
          <div><strong>${s.assigned}</strong><span>Assigned from PIC</span></div>
          <div><strong>${s.skippedOtherMonth}</strong><span>Skipped · other month</span></div>
          <div><strong>${s.skippedNoDate}</strong><span>Skipped · no proforma date</span></div>
        </div>`;
      await loadImportPanels();
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  async function doSalesRaw(file) {
    if (!file) return;
    const box = $('#sales-raw-summary');
    box.hidden = false;
    box.innerHTML = `<p class="hint">Uploading ${esc(file.name)}…</p>`;
    try {
      const { summary: s } = await sendFile('/sales-raw', file);
      box.innerHTML = `
        <p><b>Sales Raw applied</b> · ${esc(s.sheet)} · ${esc(s.filename)}</p>
        <div class="summary-grid">
          <div><strong>${s.rows}</strong><span>Rows read</span></div>
          <div><strong>${s.matched}</strong><span>VINs matched</span></div>
          <div><strong>${s.updated}</strong><span>VINs with new details</span></div>
          <div><strong>${s.notOnSheet}</strong><span>Not on Live Sheet</span></div>
        </div>`;
      await loadImportPanels();
    } catch (err) {
      box.innerHTML = `<p style="color:var(--red)">${esc(err.message)}</p>`;
    }
  }

  function wireDrop(dropSel, inputSel, handler) {
    const drop = $(dropSel);
    const input = $(inputSel);
    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      handler(input.files[0]);
      input.value = '';
    });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
      handler(e.dataTransfer.files[0]);
    });
  }

  function myWorkload(rows) {
    const mine = isManager() ? rows : rows.filter(isMine);
    const completed = mine.filter(isDone).length;
    const bySalesType = {};
    const byStatus = {};
    mine.forEach((r) => {
      const t = r.raw.salesType || '(blank)';
      bySalesType[t] = (bySalesType[t] || 0) + 1;
      const s = r.ops.opsStatus || '';
      byStatus[s] = (byStatus[s] || 0) + 1;
    });
    return {
      rows: mine,
      assigned: mine.length,
      completed,
      remaining: mine.length - completed,
      progress: mine.length ? Math.round((completed / mine.length) * 100) : 0,
      bySalesType,
      byStatus,
    };
  }

  // ——— Dashboard ———
  async function loadDashboard() {
    const month = state.monthFilter || '';
    const monthInp = $('#dash-month');
    if (monthInp && monthInp.value !== month) monthInp.value = month;
    $('#dash-month-hint').textContent = month ? `Showing ${month}` : 'Showing all months';

    const data = await fetchLive({ month });
    const w = myWorkload(data.rows || []);
    const kpis = [
      [isManager() ? 'All VINs' : 'Assigned to me', w.assigned, ''],
      ['Completed (Claimed)', w.completed, 'ok'],
      ['Remaining', w.remaining, 'warn'],
      ['Progress %', `${w.progress}%`, 'info'],
    ];
    $('#dash-kpis').innerHTML = kpis.map(([l, v, cls]) =>
      `<article class="kpi ${cls}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`
    ).join('');

    const by = w.byStatus;
    $('#dash-pipeline').innerHTML = [
      ['Assigned', w.assigned],
      ['PSFU', by.PSFU || 0],
      ['Ready', by['جاهز للتسليم'] || 0],
      ['Delivered / Claimed', w.completed],
    ].map(([l, n]) => `<div class="pipe-step"><strong>${esc(n)}</strong><span>${esc(l)}</span></div>`).join('');

    const mix = Object.entries(w.bySalesType).sort((a, b) => b[1] - a[1]);
    $('#dash-sales-types').innerHTML = mix.length
      ? mix.map(([k, n]) =>
        `<button type="button" class="status-chip" disabled><div class="n">${n}</div><div class="l">${esc(k)}</div></button>`
      ).join('')
      : '<p class="hint">No sales types in this period</p>';

    const statuses = (state.meta && state.meta.statuses) || [];
    $('#dash-status').innerHTML = statuses.map((s) =>
      `<button type="button" class="status-chip" data-status="${esc(s)}"><div class="n">${by[s] || 0}</div><div class="l">${esc(s)}</div></button>`
    ).join('') + (by['']
      ? `<button type="button" class="status-chip" data-status=""><div class="n">${by['']}</div><div class="l">(no status)</div></button>`
      : '');
    $$('#dash-status .status-chip').forEach((b) => b.addEventListener('click', () => {
      if (!b.dataset.status) return;
      state.liveFilters = {
        ...state.liveFilters,
        status: b.dataset.status,
        month: state.monthFilter || '',
        employee: isManager() ? '' : state.user.name,
      };
      setView('live');
    }));
  }

  // ——— Live Sheet ———
  async function loadLiveSheet({ silent = false } = {}) {
    const f = state.liveFilters;
    const data = await fetchLive(f);
    const rows = data.rows || [];
    const fingerprint = JSON.stringify(rows.map((r) => [r.vin, r.ops.updatedAt, r.ops.assignedEmployeeId]));
    const changed = fingerprint !== state.liveFingerprint;
    state.liveFingerprint = fingerprint;

    const empSel = $('#live-employee');
    if (empSel && !empSel.dataset.filled) {
      empSel.innerHTML = `<option value="">All employees</option>${employeeNames().map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
      empSel.dataset.filled = '1';
    }
    if (empSel) empSel.value = f.employee || '';

    const statusSel = $('#live-status');
    if (statusSel && !statusSel.dataset.filled) {
      statusSel.innerHTML = `<option value="">All statuses</option>${(state.meta.statuses || []).map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
      statusSel.dataset.filled = '1';
    }
    if (statusSel) statusSel.value = f.status || '';

    const monthInp = $('#live-month');
    if (monthInp && monthInp.value !== (f.month || '')) monthInp.value = f.month || '';

    const carrierSel = $('#live-carrier');
    if (carrierSel && document.activeElement !== carrierSel) {
      const byCar = data.byCarrier || {};
      const all = [...new Set([...(state.meta.carriers || []),
        ...Object.keys(byCar).filter((k) => k && k !== '(empty)')])];
      carrierSel.innerHTML = `<option value="">All الناقل</option>
        <option value="__empty__"${f.carrier === '__empty__' ? ' selected' : ''}>بدون ناقل (فارغ)</option>
        ${all.map((c) => `<option value="${esc(c)}"${f.carrier === c ? ' selected' : ''}>${esc(c)}${byCar[c] != null ? ` (${byCar[c]})` : ''}</option>`).join('')}`;
    }

    const chips = $('#live-chips');
    if (chips) {
      const byEmp = data.byEmployee || {};
      const bySt = data.byStatus || {};
      const byCar = data.byCarrier || {};
      chips.innerHTML = [
        `<span class="live-chip"><b>${data.total || 0}</b> VINs</span>`,
        ...Object.keys(byEmp).map((k) => `<button type="button" class="live-chip emp-filter ${f.employee === k ? 'active' : ''}" data-emp="${esc(k)}">${esc(k)} <b>${byEmp[k]}</b></button>`),
        ...Object.entries(byCar).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => {
          const key = k === '(empty)' ? '__empty__' : k;
          return `<button type="button" class="live-chip carrier-filter ${f.carrier === key ? 'active' : ''}" data-carrier="${esc(key)}">${esc(k === '(empty)' ? 'بدون ناقل' : k)} <b>${n}</b></button>`;
        }),
        ...Object.entries(data.bySalesType || {}).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) =>
          `<span class="live-chip">${esc(k)} <b>${n}</b></span>`),
        ...Object.keys(bySt).filter((k) => k !== '(blank)').slice(0, 8).map((k) =>
          `<button type="button" class="live-chip status-filter ${f.status === k ? 'active' : ''}" data-status="${esc(k)}">${esc(k)} <b>${bySt[k]}</b></button>`),
      ].join('');
      const toggle = (key, val) => {
        state.liveFilters[key] = state.liveFilters[key] === val ? '' : val;
        loadLiveSheet().catch((e) => alert(e.message));
      };
      $$('.status-filter', chips).forEach((b) => b.addEventListener('click', () => toggle('status', b.dataset.status)));
      $$('.emp-filter', chips).forEach((b) => b.addEventListener('click', () => toggle('employee', b.dataset.emp)));
      $$('.carrier-filter', chips).forEach((b) => b.addEventListener('click', () => toggle('carrier', b.dataset.carrier)));
    }

    const meta = $('#live-meta-text');
    if (meta) {
      const monthNote = f.month ? ` · ${f.month}` : ' · all months';
      meta.textContent = `${data.total || 0} VINs${monthNote} · live · last sync ${new Date(data.at || Date.now()).toLocaleTimeString()}${changed && silent ? ' · updated' : ''}`;
    }
    const dot = $('#live-dot');
    if (dot) {
      dot.classList.toggle('pulse', changed || !silent);
      setTimeout(() => dot.classList.remove('pulse'), 900);
    }

    if (!changed && silent) return;
    const table = $('#live-table');
    const active = document.activeElement;
    if (silent && active && active.classList && active.classList.contains('cell-edit') && table.contains(active)) return;

    ensureDatalists();
    const cell = (r, field, type) => (r.canEdit
      ? editableControl(r.vin, field, type, r.ops[field])
      : readOnlyValue(type, r.ops[field]));

    const cols = [
      { key: 'num', label: '#', html: (_r, i) => i + 1 },
      { key: 'employee', label: 'Employee', html: (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>` },
      { key: 'status', label: 'Status', html: (r) => cell(r, 'opsStatus', 'status') },
      { key: 'vin', label: 'VIN', html: (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>` },
      { key: 'proforma', label: 'Proforma', html: (r) => esc(na(r.raw.proformaDate)) },
      { key: 'order', label: 'Order', html: (r) => esc(na(r.raw.salesOrder)) },
      { key: 'product', label: 'Product', html: (r) => esc(na(r.raw.product)) },
      { key: 'salestype', label: 'Sales Type', html: (r) => esc(na(r.raw.salesType)) },
      { key: 'sa', label: 'S/A', html: (r) => esc(na(r.raw.salesAdvisor)) },
      { key: 'guest', label: 'Guest Exp', html: (r) => cell(r, 'guestCenter', 'yn') },
      { key: 'gt', label: 'GT Loc', html: (r) => esc(na(r.raw.gtLocation)) },
      { key: 'veh', label: 'Veh Loc', html: (r) => esc(na(r.raw.vehicleLocation)) },
      { key: 'guestsent', label: 'إرسال الضيف', html: (r) => cell(r, 'guestSentDate', 'date') },
      { key: 'sig', label: 'استلام التواقيع', html: (r) => cell(r, 'signatureReceivedDate', 'date') },
      { key: 'accsent', label: 'إرسال للحسابات', html: (r) => cell(r, 'accountsSentDate', 'date') },
      { key: 'accok', label: 'موافقة الحسابات', html: (r) => cell(r, 'accountsApprovalDate', 'date') },
      { key: 'vin1502', label: 'VIN 1502', html: (r) => cell(r, 'vin1502', 'yn') },
      { key: 'traffic', label: 'ملف المرور', html: (r) => cell(r, 'trafficFile', 'yn') },
      { key: 'fees', label: 'Traffic Fees', html: (r) => cell(r, 'trafficFeesOps', 'yn') },
      { key: 'ins', label: 'Insurance', html: (r) => cell(r, 'insuranceOps', 'yn') },
      { key: 'reg', label: 'إصدار الاستمارة', html: (r) => cell(r, 'registrationIssueDate', 'date') },
      { key: 'city', label: 'مدينة الترحيل', html: (r) => cell(r, 'transferCity', 'city') },
      { key: 'carrier', label: 'الناقل', html: (r) => cell(r, 'carrier', 'carrier') },
      { key: 'notes', label: 'ملاحظات', html: (r) => cell(r, 'notes', 'notes') },
      { key: 'updated', label: 'Updated', html: (r) => esc((r.ops.updatedAt || '').replace('T', ' ').slice(0, 19) || '—') },
      { key: 'by', label: 'By', html: (r) => esc(na(r.ops.updatedBy)) },
    ];

    table.innerHTML = `<thead><tr>${cols.map((c) => `<th class="col-${c.key}">${esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${statusRowClass(r.ops.opsStatus)}" data-vin="${esc(r.vin)}">${cols.map((c) =>
        `<td class="col-${c.key}">${c.html(r, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">No VINs on the Live Sheet yet.</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindEditableCells(table);
  }

  // ——— My VINs ———
  function scheduleColumns() {
    return [
      ['Proforma', (r) => esc(na(r.raw.proformaDate))],
      ['Order', (r) => esc(na(r.raw.salesOrder))],
      ['VIN', (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['Sales Type', (r) => esc(na(r.raw.salesType))],
      ['Product', (r) => esc(na(r.raw.product))],
      ['S/A', (r) => esc(na(r.raw.salesAdvisor))],
      ['GT Loc', (r) => esc(na(r.raw.gtLocation))],
      ['Veh Loc', (r) => esc(na(r.raw.vehicleLocation))],
      ['Guest Exp', (r) => editableControl(r.vin, 'guestCenter', 'yn', r.ops.guestCenter)],
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
    ];
  }

  async function loadMy() {
    const statusSel = $('#my-status');
    if (statusSel && !statusSel.dataset.filled) {
      statusSel.innerHTML = `<option value="">All statuses</option>${(state.meta.statuses || []).map((s) =>
        `<option value="${esc(s)}">${esc(s)}</option>`).join('')}`;
      statusSel.dataset.filled = '1';
    }
    const data = await fetchLive({
      q: state.myFilters.q,
      status: state.myFilters.status,
      employee: isManager() ? '' : state.user.name,
    });
    const w = myWorkload(data.rows || []);
    const typeKpis = Object.entries(w.bySalesType).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([l, v]) => [l, v, 'info']);
    $('#my-kpis').innerHTML = [
      ['Assigned', w.assigned, ''],
      ['Completed', w.completed, 'ok'],
      ['Remaining', w.remaining, 'warn'],
      ['Progress %', `${w.progress}%`, 'info'],
      ...typeKpis,
    ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');

    ensureDatalists();
    const cols = scheduleColumns();
    const selected = state.reassignVins;
    const table = $('#my-table');
    table.innerHTML = `<thead><tr><th></th>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>
      <tbody>${w.rows.map((r) => {
        const checked = selected.has(r.vin) ? 'checked' : '';
        return `<tr class="${statusRowClass(r.ops.opsStatus)} ${checked ? 'selected' : ''}" data-vin="${esc(r.vin)}">
          <td><input class="checkbox vin-select-check" type="checkbox" data-vin="${esc(r.vin)}" ${checked} /></td>
          ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}
        </tr>`;
      }).join('') || `<tr><td colspan="${cols.length + 1}">No VINs assigned to you yet.</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindEditableCells(table);
    $$('.vin-select-check', table).forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.dataset.vin);
      else selected.delete(cb.dataset.vin);
      cb.closest('tr').classList.toggle('selected', cb.checked);
      updateMyReassignBar();
    }));
    $('#my-pager').innerHTML = `<span>${w.assigned} VIN(s) · all on this page</span>`;

    const targets = $('#my-reassign-targets');
    targets.innerHTML = employeeNames()
      .filter((n) => n !== state.user.name)
      .map((n) => `<button type="button" class="btn reassign-target-btn" data-emp="${esc(n)}">→ ${esc(n)}</button>`)
      .join('');
    $$('.reassign-target-btn', targets).forEach((b) => b.addEventListener('click', () => {
      reassignSelected(b.dataset.emp).catch((e) => alert(e.message));
    }));
    updateMyReassignBar();
  }

  function updateMyReassignBar() {
    $('#my-reassign-count').textContent = String(state.reassignVins.size);
  }

  async function reassignSelected(toEmployee) {
    const vins = [...state.reassignVins];
    if (!vins.length) return alert('Select at least one VIN first');
    if (!confirm(`Reassign ${vins.length} VIN(s) to ${toEmployee}?`)) return;
    const res = await api('/reassign', { method: 'POST', json: { vins, employee: toEmployee } });
    const ok = (res.results || []).filter((r) => r.ok).length;
    const fail = (res.results || []).filter((r) => !r.ok);
    alert(`Reassigned ${ok} VIN(s) to ${toEmployee}${fail.length ? `\n${fail.length} failed` : ''}`);
    state.reassignVins.clear();
    await loadMy();
  }

  // ——— VIN drawer ———
  function buildDrawerHtml(v, readOnly) {
    const statuses = state.meta.statuses || [];
    const cities = state.meta.transferCities || [];
    const carriers = state.meta.carriers || [];
    const ro = (label, val) => `<div class="field"><label>${esc(label)}</label><input value="${esc(na(val))}" readonly /></div>`;
    const yn = (key, label, val) => (readOnly ? ro(label, val)
      : `<div class="field"><label>${esc(label)}</label>
        <div class="yn" data-yn="${key}">
          <button type="button" class="yes ${val === 'Yes' ? 'active' : ''}" data-v="Yes">🟢 YES</button>
          <button type="button" class="no ${val === 'No' ? 'active' : ''}" data-v="No">🔴 NO</button>
        </div></div>`);
    const dt = (key, label, val) => (readOnly ? ro(label, val)
      : `<div class="field"><label>${esc(label)}</label><input type="date" data-ops="${key}" value="${esc(val || '')}" /></div>`);
    const sel = (key, label, list, val, placeholder) => (readOnly ? ro(label, val)
      : `<div class="field"><label>${esc(label)}</label>
        <select data-ops="${key}"><option value="">${placeholder}</option>${list.map((s) =>
          `<option value="${esc(s)}" ${val === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>`);

    return `
      <div class="drawer-head">
        <div>
          <h2>${esc(na(v.raw.product))}</h2>
          <div class="meta-row">
            <span class="badge info">${esc(v.vin)}</span>
            <span class="badge">${esc(na(v.raw.salesOrder))}</span>
            ${statusBadge(v.ops.opsStatus)}
            <span class="badge">${esc(na(v.ops.assignedEmployeeName))}</span>
            ${readOnly ? '<span class="badge warn">View only</span>' : ''}
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
            ['Sales Type', v.raw.salesType], ['S/A', v.raw.salesAdvisor],
            ['GT Location', v.raw.gtLocation], ['Vehicle Location', v.raw.vehicleLocation],
            ['PIC', v.raw.pic],
          ].map(([l, val]) => ro(l, val)).join('')}
        </div>
        <div class="card">
          <h2>Delivery information${readOnly ? ' (teammate — view only)' : ''}</h2>
          <p class="hint">${readOnly ? 'Only the assigned employee can edit this VIN' : 'Employee updates · saves immediately'}</p>
          <div id="save-line" class="save-toast" hidden>Saved ✓</div>
          ${dt('guestSentDate', 'تاريخ إرسال الضيف', v.ops.guestSentDate)}
          ${sel('guestCenter', 'Guest Exp', ['Yes', 'No'], v.ops.guestCenter, '—')}
          ${dt('signatureReceivedDate', 'تاريخ استلام التواقيع من الضيف', v.ops.signatureReceivedDate)}
          ${dt('accountsSentDate', 'تاريخ إرسال الملف للحسابات', v.ops.accountsSentDate)}
          ${dt('accountsApprovalDate', 'تاريخ موافقة الحسابات', v.ops.accountsApprovalDate)}
          ${sel('opsStatus', 'Status', statuses, v.ops.opsStatus, '—')}
          ${yn('vin1502', 'Current VIN 1502?', v.ops.vin1502)}
          ${yn('trafficFile', 'ملف المرور', v.ops.trafficFile)}
          ${yn('trafficFeesOps', 'Traffic Fees', v.ops.trafficFeesOps)}
          ${yn('insuranceOps', 'Insurance', v.ops.insuranceOps)}
          ${dt('registrationIssueDate', 'تاريخ إصدار الاستمارة', v.ops.registrationIssueDate)}
          ${readOnly ? ro('مدينة الترحيل', v.ops.transferCity) : `<div class="field"><label>مدينة الترحيل</label>
            <input list="city-list" data-ops="transferCity" value="${esc(v.ops.transferCity || '')}" placeholder="Search city…" />
            <datalist id="city-list">${cities.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
          </div>`}
          ${sel('carrier', 'الناقل', carriers, v.ops.carrier, '— الناقل —')}
          ${readOnly
            ? `<div class="field"><label>ملاحظات</label><textarea readonly>${esc(v.ops.notes || '')}</textarea></div>`
            : `<div class="field"><label>ملاحظات</label><textarea data-ops="notes" rows="3">${esc(v.ops.notes || '')}</textarea></div>`}
          <p class="hint" id="last-updated">Last updated: ${esc(v.ops.updatedAt || '—')}</p>
        </div>
      </div>`;
  }

  async function openVin(vin) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    const back = $('#vin-drawer-back');
    const drawer = $('#vin-drawer');
    const readOnly = !v.canEdit;
    drawer.innerHTML = buildDrawerHtml(v, readOnly);
    back.classList.add('open');
    const close = () => {
      back.classList.remove('open');
      refreshView();
    };
    $('#drawer-close', drawer).onclick = close;
    back.onclick = (e) => { if (e.target === back) close(); };
    if (readOnly) return;

    async function savePatch(patch) {
      try {
        const res = await api(`/vehicles/${encodeURIComponent(vin)}`, { method: 'PATCH', json: patch });
        const line = $('#save-line', drawer);
        if (line) {
          line.hidden = false;
          line.textContent = `Saved ✓ · ${new Date(res.lastUpdated || Date.now()).toLocaleTimeString()}`;
          setTimeout(() => { line.hidden = true; }, 2500);
        }
        const last = $('#last-updated', drawer);
        if (last && res.lastUpdated) last.textContent = `Last updated: ${res.lastUpdated}`;
      } catch (err) {
        alert(err.message || 'Save failed');
      }
    }
    $$('[data-ops]', drawer).forEach((el) => el.addEventListener('change', () => savePatch({ [el.dataset.ops]: el.value })));
    $$('[data-yn]', drawer).forEach((group) => {
      $$('button', group).forEach((b) => b.addEventListener('click', () => {
        $$('button', group).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        savePatch({ [group.dataset.yn]: b.dataset.v });
      }));
    });
  }

  // ——— Session ———
  function showApp() {
    $('#login-screen').style.display = 'none';
    $('#app').classList.add('is-on');
    if (isManager()) {
      $('#live-edit-hint').textContent = `${state.user.name} can edit every VIN directly on this sheet.`;
    }
    setView('dashboard');
  }

  function logout() {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    location.reload();
  }

  async function login() {
    $('#login-error').textContent = '';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: { username: $('#login-user').value, password: $('#login-pass').value },
      });
      if (data.user.role === 'coordinator') {
        setSession(data.token, data.user);
        location.href = 'coordinator.html';
        return;
      }
      setSession(data.token, data.user);
      state.user = data.user;
      showApp();
    } catch (err) {
      $('#login-error').textContent = err.message || 'Login failed';
    }
  }

  async function boot() {
    state.meta = await api('/meta');
    const users = (state.meta.users || []).filter((u) => u.role === 'employee' || u.role === 'hanouf');
    $('#login-user').innerHTML = users.map((u) =>
      `<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.role)})</option>`).join('');
    $('#login-pills').innerHTML = users.map((u) =>
      `<button type="button" data-u="${esc(u.id)}">${esc(u.name)}</button>`).join('');
    $$('#login-pills button').forEach((b) => b.addEventListener('click', () => {
      $('#login-user').value = b.dataset.u;
      $$('#login-pills button').forEach((x) => x.classList.toggle('active', x === b));
    }));

    if (getToken() && getUser()) {
      try {
        const me = await api('/auth/me');
        if (me.user.role === 'coordinator') {
          location.href = 'coordinator.html';
          return;
        }
        state.user = me.user;
        showApp();
      } catch {
        clearSession();
      }
    }
  }

  // ——— Events ———
  $('#login-btn').addEventListener('click', login);
  $('#login-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('#logout-btn').addEventListener('click', logout);
  $('#refresh-btn').addEventListener('click', refreshView);
  $('#global-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    state.liveFilters.q = e.target.value.trim();
    if ($('#live-q')) $('#live-q').value = state.liveFilters.q;
    setView('live');
  });
  $('#dash-month').addEventListener('change', (e) => { state.monthFilter = e.target.value; loadDashboard(); });
  $('#dash-month-all').addEventListener('click', () => { state.monthFilter = ''; loadDashboard(); });

  let liveQTimer;
  $('#live-q').addEventListener('input', (e) => {
    clearTimeout(liveQTimer);
    liveQTimer = setTimeout(() => { state.liveFilters.q = e.target.value.trim(); loadLiveSheet(); }, 250);
  });
  $('#live-month').addEventListener('change', (e) => { state.liveFilters.month = e.target.value; loadLiveSheet(); });
  $('#live-employee').addEventListener('change', (e) => { state.liveFilters.employee = e.target.value; loadLiveSheet(); });
  $('#live-status').addEventListener('change', (e) => { state.liveFilters.status = e.target.value; loadLiveSheet(); });
  $('#live-carrier').addEventListener('change', (e) => { state.liveFilters.carrier = e.target.value; loadLiveSheet(); });
  $('#live-refresh').addEventListener('click', () => loadLiveSheet());

  let myQTimer;
  $('#my-q').addEventListener('input', (e) => {
    clearTimeout(myQTimer);
    myQTimer = setTimeout(() => { state.myFilters.q = e.target.value.trim(); loadMy(); }, 250);
  });
  $('#my-status').addEventListener('change', (e) => { state.myFilters.status = e.target.value; loadMy(); });
  $('#my-clear').addEventListener('click', () => {
    state.myFilters = { q: '', status: '' };
    $('#my-q').value = '';
    $('#my-status').value = '';
    loadMy();
  });
  $('#my-reassign-clear').addEventListener('click', () => {
    state.reassignVins.clear();
    loadMy();
  });
  wireDrop('#upload-drop', '#upload-file', doUpload);
  wireDrop('#sales-raw-drop', '#sales-raw-file', doSalesRaw);

  boot().catch((e) => { $('#login-error').textContent = e.message; });
})();
