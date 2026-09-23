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
    selected: new Set(),
    selInfo: {},
    rowIndex: {},
    liveOnlySelected: false,
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

  function canUploadSalesRaw() {
    return isManager() || !!(state.user && state.user.canUploadSalesRaw);
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
      ...(canUploadSalesRaw() ? [{
        id: 'assignment',
        label: `Assignment${state.meta && state.meta.pendingAssignments ? ` (${state.meta.pendingAssignments})` : ''}`,
      }] : []),
      ...(isManager() ? [
        { id: 'targets', label: 'Team Targets' },
        { id: 'upload', label: 'Upload VINs' },
      ] : []),
      ...(canUploadSalesRaw() ? [{ id: 'sales-raw', label: 'Sales Raw' }] : []),
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
        : ['My VINs', 'Your schedule · edit your work'],
      assignment: ['Assignment', 'VIN numbers only · Proforma Date (column P) filled · Invoice Date (column V) empty · no duplicate VINs'],
      targets: ['Team Targets', 'Each employee · VINs by sales type · total · target · Ach%'],
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
      if (state.view === 'targets') await loadTargets();
      if (state.view === 'assignment') await loadAssignment();
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
    (data.rows || []).forEach((r) => { state.rowIndex[r.vin] = r; });
    rememberSelInfo(data.rows || []);
    return data;
  }

  // ——— Selected VINs (every user · kept in view while working) ———
  function selKey() {
    return `dt_xform_sel_${state.user ? state.user.id : ''}`;
  }

  function loadSelection() {
    try {
      const saved = JSON.parse(localStorage.getItem(selKey()) || '{}');
      state.selected = new Set(Array.isArray(saved.vins) ? saved.vins : []);
      state.selInfo = saved.info && typeof saved.info === 'object' ? saved.info : {};
    } catch {
      state.selected = new Set();
      state.selInfo = {};
    }
  }

  function saveSelection() {
    const info = {};
    state.selected.forEach((vin) => { if (state.selInfo[vin]) info[vin] = state.selInfo[vin]; });
    state.selInfo = info;
    localStorage.setItem(selKey(), JSON.stringify({ vins: [...state.selected], info }));
  }

  function rememberSelInfo(rows) {
    let touched = false;
    rows.forEach((r) => {
      if (!state.selected.has(r.vin)) return;
      state.selInfo[r.vin] = {
        product: r.raw.product || '',
        employee: r.ops.assignedEmployeeName || '',
        status: r.ops.opsStatus || '',
      };
      touched = true;
    });
    if (touched) saveSelection();
  }

  function setSelected(vin, on) {
    if (on) state.selected.add(vin);
    else state.selected.delete(vin);
    if (on && state.rowIndex[vin]) rememberSelInfo([state.rowIndex[vin]]);
    saveSelection();
    $$(`tr[data-vin="${CSS.escape(vin)}"]`).forEach((tr) => {
      tr.classList.toggle('selected', on);
      const cb = $('input.sel-check', tr);
      if (cb) cb.checked = on;
    });
    renderSelBars();
  }

  function renderSelBars() {
    ['#live-sel-bar', '#my-sel-bar'].forEach((sel) => {
      const el = $(sel);
      if (el) renderSelBar(el, sel === '#live-sel-bar');
    });
  }

  function renderSelBar(el, isLive) {
    const vins = [...state.selected];
    if (!el.dataset.wired) wireSelBar(el);
    if (!vins.length) {
      el.classList.remove('has-sel');
      el.innerHTML = '<span class="hint">Tick ☐ next to any VIN to keep it here while you work · then assign, unassign or remove it.</span>';
      return;
    }
    el.classList.add('has-sel');
    const away = new Set(((state.meta && state.meta.employees) || []).filter((e) => e.onVacation).map((e) => e.name));
    const others = employeeNames().filter((n) => n !== state.user.name);
    const assignBtn = (name, label, extra = '') => (away.has(name)
      ? `<button type="button" class="btn sel-assign ${extra}" disabled title="${esc(name)} is on vacation">${esc(label)} 🌴</button>`
      : `<button type="button" class="btn sel-assign ${extra}" data-emp="${esc(name)}">${esc(label)}</button>`);
    const meBtn = (state.user.role === 'employee' || state.user.role === 'hanouf')
      ? assignBtn(state.user.name, '→ Me', 'me') : '';
    el.innerHTML = `
      <div class="sel-head">
        <strong>${vins.length}</strong> VIN(s) selected
        ${isLive ? `<label class="sel-only"><input type="checkbox" class="sel-only-cb" ${state.liveOnlySelected ? 'checked' : ''} /> Show only selected</label>` : ''}
        <button type="button" class="btn sel-clear">Clear</button>
      </div>
      <div class="sel-chips">${vins.map((vin) => {
        const i = state.selInfo[vin] || {};
        return `<span class="sel-chip">
          <button type="button" class="sel-open" data-vin="${esc(vin)}" title="Open">${esc(vin)}</button>
          <small>${esc(i.product || '')}${i.employee ? ` · ${esc(i.employee)}` : ' · unassigned'}${i.status ? ` · ${esc(i.status)}` : ''}</small>
          <button type="button" class="sel-x" data-vin="${esc(vin)}" title="Unselect">×</button>
        </span>`;
      }).join('')}</div>
      <div class="sel-actions">
        <span class="lbl">Assign to:</span>
        ${meBtn}
        ${others.map((n) => assignBtn(n, `→ ${n}`)).join('')}
        <span class="sel-sep"></span>
        <button type="button" class="btn sel-unassign">Unassign</button>
        <button type="button" class="btn sel-remove">Remove from sheet</button>
      </div>`;
  }

  function wireSelBar(el) {
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.classList.contains('sel-open')) openVin(b.dataset.vin).catch((err) => alert(err.message));
      else if (b.classList.contains('sel-x')) setSelected(b.dataset.vin, false);
      else if (b.classList.contains('sel-clear')) clearSelection();
      else if (b.classList.contains('sel-assign')) selAction('assign', b.dataset.emp);
      else if (b.classList.contains('sel-unassign')) selAction('unassign');
      else if (b.classList.contains('sel-remove')) selAction('remove');
    });
    el.addEventListener('change', (e) => {
      if (!e.target.classList.contains('sel-only-cb')) return;
      state.liveOnlySelected = e.target.checked;
      state.liveFingerprint = '';
      loadLiveSheet().catch((err) => alert(err.message));
    });
  }

  function clearSelection() {
    state.selected.clear();
    state.liveOnlySelected = false;
    saveSelection();
    $$('tr.selected').forEach((tr) => tr.classList.remove('selected'));
    $$('input.sel-check').forEach((cb) => { cb.checked = false; });
    state.liveFingerprint = '';
    refreshView();
  }

  async function selAction(kind, employee) {
    const vins = [...state.selected];
    if (!vins.length) return;
    const n = vins.length;
    const ask = {
      assign: `Assign ${n} VIN(s) to ${employee}?`,
      unassign: `Unassign ${n} VIN(s)? They stay on the Live Sheet with no employee.`,
      remove: `Remove ${n} VIN(s) from the Live Sheet for everyone?\n\n${vins.join('\n')}`,
    }[kind];
    if (!confirm(ask)) return;
    try {
      const res = kind === 'assign'
        ? await api('/reassign', { method: 'POST', json: { vins, employee } })
        : await api(`/${kind}`, { method: 'POST', json: { vins } });
      const results = res.results || [];
      const ok = results.filter((r) => r.ok);
      const fail = results.filter((r) => !r.ok);
      if (kind === 'remove') ok.forEach((r) => state.selected.delete(r.vin));
      saveSelection();
      const verb = { assign: `assigned to ${employee}`, unassign: 'unassigned', remove: 'removed' }[kind];
      alert(`${ok.length} VIN(s) ${verb}${fail.length
        ? `\n${fail.length} skipped:\n${fail.map((f) => `${f.vin} — ${f.error}`).join('\n')}` : ''}`);
    } catch (err) {
      alert(err.message || 'Action failed');
    }
    state.liveFingerprint = '';
    refreshView();
  }

  // ——— Assignment (VIN numbers only · auto-split evenly by sales type) ———
  async function loadAssignment(data) {
    const d = data || await api('/assignment');
    state.asg = d;
    if (!state.asgSel) state.asgSel = new Set();
    const live = new Set(d.rows.map((r) => r.vin));
    [...state.asgSel].forEach((v) => { if (!live.has(v)) state.asgSel.delete(v); });
    state.meta.pendingAssignments = d.rows.length;
    renderNav();

    const can = !!d.canConfirm;
    const away = new Set((d.employees || []).filter((e) => e.onVacation).map((e) => e.id));
    if (state.meta.employees) {
      state.meta.employees = state.meta.employees.map((e) => ({ ...e, onVacation: away.has(e.id) }));
    }
    $('#asg-kpis').innerHTML = [
      ['Ready to assign', d.rows.length, d.rows.length ? 'warn' : 'ok'],
      ['Unique VINs', d.rows.length, ''],
    ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');

    $('#asg-actions').style.display = can && d.rows.length ? '' : 'none';
    const list = $('#asg-table');
    list.innerHTML = d.rows.length
      ? d.rows.map((r) => `<button type="button" class="asg-vin ${state.asgSel.has(r.vin) ? 'selected' : ''}" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`).join('')
      : '<p class="hint">No unique VINs with Proforma Date (column P) filled and Invoice Date (column V) empty.</p>';
    $$('.asg-vin', list).forEach((b) => b.addEventListener('click', () => {
      if (!can) return;
      if (state.asgSel.has(b.dataset.vin)) state.asgSel.delete(b.dataset.vin);
      else state.asgSel.add(b.dataset.vin);
      b.classList.toggle('selected');
    }));
    renderAssignmentBalance();
  }

  function renderAssignmentBalance() {
    const d = state.asg;
    const can = !!d.canConfirm;
    const types = d.salesTypes || [];
    const cell = (now, after) => (now === after
      ? `<td class="num">${now}</td>`
      : `<td class="num">${now} <span class="asg-after">→ ${after}</span></td>`);
    $('#asg-map-table').innerHTML = `<thead><tr><th>Employee</th>${types.map((t) => `<th>${esc(t)}</th>`).join('')}<th>Total</th><th>Vacation 🌴</th></tr></thead>
      <tbody>${(d.employees || []).map((e) => {
        const nowT = types.reduce((s, t) => s + ((e.bySalesType && e.bySalesType[t]) || 0), 0);
        const afterT = types.reduce((s, t) => s + ((e.afterBySalesType && e.afterBySalesType[t]) || 0), 0);
        return `<tr class="${e.onVacation ? 'is-vacation' : ''}">
        <td><b>${esc(e.name)}</b>${e.onVacation ? ' <span class="badge warn">On vacation</span>' : ''}</td>
        ${types.map((t) => cell((e.bySalesType && e.bySalesType[t]) || 0, (e.afterBySalesType && e.afterBySalesType[t]) || 0)).join('')}
        ${cell(nowT, afterT)}
        <td class="vac-cell">
          <label class="vac-toggle"><input type="checkbox" class="checkbox vac-cb" data-emp="${esc(e.id)}"
            ${e.onVacation ? 'checked' : ''} ${can ? '' : 'disabled'} /> ${e.onVacation ? 'On vacation' : 'Working'}</label>
          ${can ? `<label class="vac-until">until <input type="date" class="vac-date" data-emp="${esc(e.id)}" value="${esc(e.vacationUntil || '')}"
            min="${esc(d.today)}" title="Leave empty = until you turn it off" /></label>`
            : (e.vacationUntil ? `<span class="hint">until ${esc(e.vacationUntil)}</span>` : '')}
        </td>
      </tr>`;
      }).join('')}</tbody>`;
    const setVac = async (empId, on, until) => {
      const res = await api('/vacation', { method: 'PUT', json: { employeeId: empId, onVacation: on, until } });
      await loadAssignment(res);
    };
    $$('.vac-cb').forEach((cb) => cb.addEventListener('change', () => {
      const date = $(`.vac-date[data-emp="${cb.dataset.emp}"]`);
      setVac(cb.dataset.emp, cb.checked, date ? date.value : '').catch((err) => alert(err.message));
    }));
    $$('.vac-date').forEach((inp) => inp.addEventListener('change', () => {
      const cb = $(`.vac-cb[data-emp="${inp.dataset.emp}"]`);
      if (!inp.value && !cb.checked) return;
      setVac(inp.dataset.emp, true, inp.value).catch((err) => alert(err.message));
    }));
  }

  async function confirmAssignments() {
    if (!state.asg.rows.length) return alert('Nothing to assign');
    if (!confirm(`Assign ${state.asg.rows.length} VIN(s) automatically so each employee has the same number in every sales type?`)) return;
    const res = await api('/assignment/confirm', { method: 'POST', json: { all: true } });
    const ok = (res.results || []).filter((r) => r.ok);
    const fail = (res.results || []).filter((r) => !r.ok);
    state.asgSel.clear();
    alert(`${ok.length} VIN(s) assigned and added to the Live Sheet${fail.length
      ? `\n${fail.length} skipped:\n${fail.map((f) => `${f.vin} — ${f.error}`).join('\n')}` : ''}`);
    await loadAssignment(res);
  }

  async function dismissAssignments() {
    const vins = [...state.asgSel];
    if (!vins.length) return alert('Tick at least one VIN');
    if (!confirm(`Dismiss ${vins.length} VIN(s)? They will not be added to the Live Sheet.\n\n${vins.join('\n')}`)) return;
    const res = await api('/assignment/dismiss', { method: 'POST', json: { vins } });
    state.asgSel.clear();
    await loadAssignment(res);
  }

  // ——— Team Targets (Hanouf / Admin) ———
  function achCell(pct) {
    if (pct == null) return '<span class="hint">no target</span>';
    const cls = pct >= 100 ? 'ok' : pct >= 70 ? 'warn' : 'bad';
    return `<div class="ach ach-${cls}"><div class="ach-bar"><span style="width:${Math.min(pct, 100)}%"></span></div><b>${pct}%</b></div>`;
  }

  async function loadTargets() {
    const inp = $('#tgt-month');
    if (!state.targetMonth) state.targetMonth = state.meta.currentMonth;
    if (inp.value !== state.targetMonth) inp.value = state.targetMonth;
    const basis = $('#tgt-basis').value;
    const data = await api(`/team-performance?month=${encodeURIComponent(state.targetMonth)}`);
    state.targetData = data;
    const types = data.salesTypes || [];
    const t = data.totals;
    const pctKey = basis === 'delivered' ? 'deliveredPct' : 'achPct';
    $('#tgt-hint').textContent = `Showing ${data.month}${data.month === data.currentMonth ? ' (this month)' : ''}`;

    $('#tgt-kpis').innerHTML = [
      ['Team VINs', t.total, ''],
      ['Delivered / Claimed', t.delivered, 'ok'],
      ['Team target', t.target || '—', 'info'],
      ['Team Ach%', t[pctKey] == null ? '—' : `${t[pctKey]}%`,
        t[pctKey] == null ? '' : t[pctKey] >= 100 ? 'ok' : t[pctKey] >= 70 ? 'warn' : 'bad'],
    ].map(([l, v, c]) => `<article class="kpi ${c}"><div class="lbl">${esc(l)}</div><div class="val">${esc(v)}</div></article>`).join('');

    const head = `<thead><tr><th>Employee</th>${types.map((s) => `<th>${esc(s)}</th>`).join('')}
      <th>Total</th><th>Delivered</th><th>Target</th><th>Ach%</th></tr></thead>`;
    const body = (data.rows || []).map((r) => `<tr>
        <td><b>${esc(r.name)}</b></td>
        ${types.map((s) => `<td class="num">${r.bySalesType[s] || 0}</td>`).join('')}
        <td class="num"><b>${r.total}</b></td>
        <td class="num">${r.delivered}</td>
        <td><input type="number" min="0" step="1" class="tgt-input" data-emp="${esc(r.id)}" value="${r.target || ''}" placeholder="0" /></td>
        <td>${achCell(r[pctKey])}</td>
      </tr>`).join('');
    const foot = `<tfoot><tr><td><b>Total</b></td>
      ${types.map((s) => `<td class="num"><b>${t.bySalesType[s] || 0}</b></td>`).join('')}
      <td class="num"><b>${t.total}</b></td><td class="num"><b>${t.delivered}</b></td>
      <td class="num"><b>${t.target || '—'}</b></td><td>${achCell(t[pctKey])}</td></tr></tfoot>`;
    $('#tgt-table').innerHTML = `${head}<tbody>${body}</tbody>${foot}`;
    $('#tgt-unassigned').textContent = data.unassigned
      ? `${data.unassigned} VIN(s) this month are not assigned to any employee` : '';
  }

  async function saveTargets() {
    const targets = {};
    $$('#tgt-table .tgt-input').forEach((el) => { targets[el.dataset.emp] = el.value; });
    const res = await api('/targets', { method: 'PUT', json: { month: state.targetMonth, targets } });
    const toast = $('#tgt-save-toast');
    toast.hidden = false;
    toast.textContent = `Saved ✓ targets for ${res.month} · ${new Date().toLocaleTimeString()}`;
    setTimeout(() => { toast.hidden = true; }, 2500);
    await loadTargets();
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
          <div><strong>${s.skippedVacation || 0}</strong><span>Not assigned · PIC on vacation</span></div>
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
          <div><strong>${s.assignable || 0}</strong><span>To Assignment · P filled · V empty</span></div>
          <div><strong>${s.skippedInvoiced || 0}</strong><span>Skipped · has Invoice Date (V)</span></div>
          <div><strong>${s.skippedOnSystem || 0}</strong><span>Skipped · already on system</span></div>
          <div><strong>${s.duplicates || 0}</strong><span>Duplicate VINs ignored</span></div>
        </div>
        ${s.assignable ? `<p style="margin-top:10px"><b>${s.assignable}</b> unique VIN(s) with Proforma Date and no Invoice Date
          ${isManager() ? 'are waiting for your confirmation.' : 'were sent to Hanouf to confirm the assignment.'}
          <button type="button" class="btn" id="go-assignment">Open Assignment</button></p>` : ''}`;
      const go = $('#go-assignment');
      if (go) go.addEventListener('click', () => setView('assignment'));
      await loadImportPanels();
      renderNav();
      if (s.assignable && isManager()
        && confirm(`${s.assignable} unique VIN(s) have a Proforma Date and no Invoice Date (column V).\n\nReview and assign them now?`)) {
        setView('assignment');
      }
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

    const roster = (state.meta && state.meta.employees) || [];
    const byEmp = {};
    roster.forEach((e) => {
      byEmp[e.id] = {
        id: e.id,
        name: e.name,
        onVacation: !!e.onVacation,
        vacationUntil: e.until || '',
        total: 0,
        delivered: 0,
        bySalesType: {},
      };
    });
    let unassigned = 0;
    (data.rows || []).forEach((r) => {
      const id = r.ops && r.ops.assignedEmployeeId;
      const row = byEmp[id];
      if (!row) { unassigned += 1; return; }
      row.total += 1;
      if (isDone(r)) row.delivered += 1;
      const t = (r.raw && r.raw.salesType) || '(blank)';
      row.bySalesType[t] = (row.bySalesType[t] || 0) + 1;
    });
    const cards = Object.values(byEmp).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    $('#dash-employees').innerHTML = cards.map((e) => {
      const types = Object.entries(e.bySalesType).sort((a, b) => b[1] - a[1]);
      return `<button type="button" class="emp-card ${e.onVacation ? 'is-vacation' : ''}" data-emp="${esc(e.name)}">
        <div class="emp-card-top">
          <strong>${esc(e.name)}</strong>
          ${e.onVacation ? `<span class="badge warn">Vacation${e.vacationUntil ? ` · ${esc(e.vacationUntil)}` : ''}</span>` : ''}
        </div>
        <div class="emp-card-got"><b>${e.total}</b><span>VIN(s) got</span></div>
        <div class="emp-card-meta">${e.delivered} delivered · ${e.total - e.delivered} remaining</div>
        <div class="emp-card-types">${types.length
          ? types.map(([t, n]) => `<span><b>${n}</b> ${esc(t)}</span>`).join('')
          : '<span class="hint">No VINs</span>'}</div>
      </button>`;
    }).join('') + (unassigned
      ? `<div class="emp-card is-empty"><strong>Unassigned</strong><div class="emp-card-got"><b>${unassigned}</b><span>VIN(s)</span></div></div>`
      : '');
    $$('#dash-employees .emp-card[data-emp]').forEach((b) => b.addEventListener('click', () => {
      state.liveFilters = { ...state.liveFilters, employee: b.dataset.emp, month: state.monthFilter || '', status: '' };
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

    renderSelBars();
    if (!changed && silent) return;
    const table = $('#live-table');
    const active = document.activeElement;
    if (silent && active && active.classList && active.classList.contains('cell-edit') && table.contains(active)) return;

    ensureDatalists();
    const cell = (r, field, type) => (r.canEdit && field !== 'carrier'
      ? editableControl(r.vin, field, type, r.ops[field])
      : readOnlyValue(type, r.ops[field]));

    const cols = [
      {
        key: 'num',
        label: '<input type="checkbox" class="checkbox sel-all" title="Select all shown" />',
        raw: true,
        html: (r, i) => `<label class="sel-cell"><input type="checkbox" class="checkbox sel-check" data-vin="${esc(r.vin)}" ${state.selected.has(r.vin) ? 'checked' : ''} /><span>${i + 1}</span></label>`,
      },
      { key: 'employee', label: 'Employee', html: (r) => `<b>${esc(na(r.ops.assignedEmployeeName))}</b>` },
      { key: 'status', label: 'Status', html: (r) => cell(r, 'opsStatus', 'status') },
      { key: 'vin', label: 'VIN', html: (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>` },
      { key: 'proforma', label: 'Proforma', html: (r) => esc(na(r.raw.proformaDate)) },
      { key: 'order', label: 'Order', html: (r) => esc(na(r.raw.salesOrder)) },
      { key: 'product', label: 'Product', html: (r) => esc(na(r.raw.product)) },
      { key: 'salestype', label: 'Sales Type', html: (r) => esc(na(r.raw.salesType)) },
      { key: 'customer', label: 'Customer', html: (r) => `<span title="${esc(r.raw.userName || '')}">${esc(na(r.raw.userName))}</span>` },
      { key: 'owner', label: 'Invoice Owner', html: (r) => `<span title="${esc(r.raw.invoiceOwner || '')}">${esc(na(r.raw.invoiceOwner))}</span>` },
      { key: 'phone', label: 'Phone', html: (r) => (r.raw.phone
        ? `<a href="tel:${esc(r.raw.phone)}" class="phone-link">${esc(r.raw.phone)}</a>` : 'N/A') },
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

    const shown = state.liveOnlySelected ? rows.filter((r) => state.selected.has(r.vin)) : rows;
    table.innerHTML = `<thead><tr>${cols.map((c) => `<th class="col-${c.key}">${c.raw ? c.label : esc(c.label)}</th>`).join('')}</tr></thead>
      <tbody>${shown.map((r, i) => `<tr class="${statusRowClass(r.ops.opsStatus)}${state.selected.has(r.vin) ? ' selected' : ''}" data-vin="${esc(r.vin)}">${cols.map((c) =>
        `<td class="col-${c.key}">${c.html(r, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">${state.liveOnlySelected ? 'None of the selected VINs match these filters.' : 'No VINs on the Live Sheet yet.'}</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindEditableCells(table);
    bindSelChecks(table, shown);
  }

  function bindSelChecks(table, rows) {
    $$('.sel-check', table).forEach((cb) => cb.addEventListener('change', () => setSelected(cb.dataset.vin, cb.checked)));
    const all = $('.sel-all', table);
    if (!all) return;
    all.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.vin));
    all.addEventListener('change', () => {
      rows.forEach((r) => {
        if (all.checked) state.selected.add(r.vin);
        else state.selected.delete(r.vin);
      });
      rememberSelInfo(rows);
      saveSelection();
      $$('.sel-check', table).forEach((cb) => {
        cb.checked = all.checked;
        cb.closest('tr').classList.toggle('selected', all.checked);
      });
      renderSelBars();
    });
  }

  // ——— My VINs ———
  function scheduleColumns() {
    return [
      ['Proforma', (r) => esc(na(r.raw.proformaDate))],
      ['Order', (r) => esc(na(r.raw.salesOrder))],
      ['VIN', (r) => `<button type="button" class="vin-link" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['Sales Type', (r) => esc(na(r.raw.salesType))],
      ['Customer', (r) => esc(na(r.raw.userName))],
      ['Invoice Owner', (r) => esc(na(r.raw.invoiceOwner))],
      ['Phone', (r) => (r.raw.phone ? `<a href="tel:${esc(r.raw.phone)}" class="phone-link">${esc(r.raw.phone)}</a>` : 'N/A')],
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
      ['الناقل', (r) => readOnlyValue('carrier', r.ops.carrier)],
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
    const selected = state.selected;
    const table = $('#my-table');
    table.innerHTML = `<thead><tr><th><input type="checkbox" class="checkbox sel-all" title="Select all shown" /></th>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead>
      <tbody>${w.rows.map((r) => {
        const checked = selected.has(r.vin) ? 'checked' : '';
        return `<tr class="${statusRowClass(r.ops.opsStatus)} ${checked ? 'selected' : ''}" data-vin="${esc(r.vin)}">
          <td><input class="checkbox sel-check" type="checkbox" data-vin="${esc(r.vin)}" ${checked} /></td>
          ${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}
        </tr>`;
      }).join('') || `<tr><td colspan="${cols.length + 1}">No VINs assigned to you yet.</td></tr>`}</tbody>`;
    $$('.vin-link', table).forEach((b) => b.addEventListener('click', () => openVin(b.dataset.vin)));
    bindEditableCells(table);
    bindSelChecks(table, w.rows);
    $('#my-pager').innerHTML = `<span>${w.assigned} VIN(s) · all on this page</span>`;
    renderSelBars();
  }

  // ——— VIN drawer ———
  function buildDrawerHtml(v, readOnly) {
    const statuses = state.meta.statuses || [];
    const cities = state.meta.transferCities || [];
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
            ['Customer Name', v.raw.userName], ['Invoice Owner', v.raw.invoiceOwner],
            ['Phone', v.raw.phone],
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
          ${ro('الناقل', v.ops.carrier)}
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
    loadSelection();
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
  const fail = (err) => alert(err.message || 'Failed');
  $('#asg-confirm-all').addEventListener('click', () => confirmAssignments().catch(fail));
  $('#asg-dismiss').addEventListener('click', () => dismissAssignments().catch(fail));
  $('#tgt-month').addEventListener('change', (e) => {
    state.targetMonth = e.target.value || state.meta.currentMonth;
    loadTargets().catch((err) => alert(err.message));
  });
  $('#tgt-month-now').addEventListener('click', () => {
    state.targetMonth = state.meta.currentMonth;
    loadTargets().catch((err) => alert(err.message));
  });
  $('#tgt-basis').addEventListener('change', () => loadTargets().catch((err) => alert(err.message)));
  $('#tgt-save').addEventListener('click', () => saveTargets().catch((err) => alert(err.message)));
  $('#tgt-table').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('tgt-input')) saveTargets().catch((err) => alert(err.message));
  });
  wireDrop('#upload-drop', '#upload-file', doUpload);
  wireDrop('#sales-raw-drop', '#sales-raw-file', doSalesRaw);

  boot().catch((e) => { $('#login-error').textContent = e.message; });
})();
