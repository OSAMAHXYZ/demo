(() => {
  const { api, downloadFile, esc, toast, getToken, getUser, setSession, clearSession } = window.DTX;

  const $ = (id) => document.getElementById(id);

  function isCollector(user) {
    return !!(user && (user.id === 'collector' || user.role === 'admin'));
  }

  function showCollector(user) {
    $('collector-gate').classList.add('hidden');
    $('collector-app').classList.remove('hidden');
    startApp(user);
  }

  async function collectorLogin() {
    $('collector-error').textContent = '';
    try {
      const data = await api('/auth/collector', {
        method: 'POST',
        json: { password: $('collector-pass').value },
      });
      setSession(data.token, data.user);
      showCollector(data.user);
    } catch (err) {
      $('collector-error').textContent = err.message || 'Could not open collector';
    }
  }

  $('collector-btn').addEventListener('click', collectorLogin);
  $('collector-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') collectorLogin(); });

  (async function bootGate() {
    if (getToken() && isCollector(getUser())) {
      try {
        const me = await api('/auth/me');
        if (isCollector(me.user)) {
          showCollector(me.user);
          return;
        }
      } catch {
        clearSession();
      }
    }
  }());

  let started = false;
  function startApp(user) {
  if (started) return;
  started = true;
  const CITY_COLORS = ['#0b2a44', '#1769a8', '#0d6b3c', '#b45309', '#7c3aed', '#eb0a1e', '#0e7490', '#854d0e'];

  let dash = null;
  let perf = null;
  let empMonth = '';
  let kpiOpenId = '';
  let kpiData = null;
  let kpiExpanded = false;
  let kpiDetailKey = '';
  let slaDash = null;
  let backup = null;
  let dashTimer = null;
  let dashInFlight = false;
  let pdfQuery = '';

  DTXLive.wireHeader(user);
  if ($('who')) $('who').textContent = 'Collector';

  function fmtWhen(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  }

  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  }

  function stayText(person) {
    const start = Date.parse(person.arrivedAt);
    if (!start) return '—';
    if (person.leftAt) return fmtDur(Date.parse(person.leftAt) - start);
    return `still here · ${fmtDur(Date.now() - start)}`;
  }

  function tickClock() {
    const el = $('live-clock');
    if (el) el.textContent = new Date().toLocaleString();
    if (!dash) return;
    dash.companies.forEach((c) => {
      c.people.filter((p) => p.status === 'present').forEach((p) => {
        const cell = document.querySelector(`[data-stay="${p.id}"]`);
        if (cell) cell.textContent = stayText(p);
      });
    });
  }

  function maxOf(list, key) {
    return Math.max(1, ...list.map((x) => Number(x[key]) || 0));
  }

  function allDrivers() {
    const rows = [];
    (dash.companies || []).forEach((c) => {
      (c.people || []).forEach((p) => rows.push({ ...p, company: c.company }));
    });
    return rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'present' ? -1 : 1;
      return (Date.parse(b.arrivedAt) || 0) - (Date.parse(a.arrivedAt) || 0);
    });
  }

  function openAllDrivers() {
    const people = allDrivers();
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>Drivers</h2>
          <p class="sub">${dash.present} present now · ${dash.left} left · click any company chart for company-only view</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap" style="max-height:70vh">
        <table class="data">
          <thead><tr><th>Driver</th><th>Company</th><th>Arrived</th><th>Left</th><th>Stay</th><th>VIN</th><th>City</th></tr></thead>
          <tbody>${people.map((p) => `
            <tr>
              <td><b>${esc(p.name)}</b></td>
              <td>${esc(p.company || '—')}</td>
              <td>${esc(fmtWhen(p.arrivedAt))}</td>
              <td class="${p.leftAt ? 'gone' : 'stay'}">${p.leftAt ? esc(fmtWhen(p.leftAt)) : 'Still here'}</td>
              <td data-stay="${esc(p.id)}">${esc(stayText(p))}</td>
              <td class="detail-vin">${esc((p.vins || []).join(', ') || '—')}</td>
              <td>${esc(p.city || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="7">No drivers have checked in yet.</td></tr>'}</tbody>
        </table>
      </div>`);
  }

  function renderKpis() {
    const host = $('dash-kpis');
    host.innerHTML = `
      <button type="button" class="kpi kpi-click" id="kpi-drivers" title="Open every driver · arrive, leave, company, VIN">
        <strong><span class="stay">${esc(dash.present)}</span><span class="kpi-split"> / </span><span class="gone">${esc(dash.left)}</span></strong>
        <span>Present now / Drivers left</span>
      </button>
      <div class="kpi"><strong>${esc(dash.notes)}</strong><span>Delivery notes</span></div>
      <div class="kpi"><strong>${esc(dash.memos)}</strong><span>Memos</span></div>`;
    const btn = $('kpi-drivers');
    if (btn) btn.addEventListener('click', openAllDrivers);
    $('dash-sync').textContent = new Date(dash.at).toLocaleTimeString();
  }

  function renderBackup() {
    const meta = $('backup-meta');
    if (!meta) return;
    if (!backup) {
      meta.textContent = 'Backup status unavailable';
      return;
    }
    const last = backup.lastAt ? fmtWhen(backup.lastAt) : 'not saved yet';
    const next = backup.nextAt ? fmtWhen(backup.nextAt) : '—';
    const snap = backup.snapshot || {};
    const live = backup.live || {};
    meta.textContent = `Last saved ${last} · next scan ${next} · snapshot ${snap.vehicles || 0} VINs · live ${live.vehicles || 0} VINs`;
  }

  function renderAttendance() {
    const host = $('attend-chart');
    const rows = (dash.companies || []).filter((c) => c.arrived || c.notes);
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No attendance or printed notes yet. Drivers check in on attendance.html; notes come from coordinator print.</p>';
      return;
    }
    const max = Math.max(1, ...rows.map((c) => Math.max(c.arrived, c.notes)));
    host.innerHTML = rows.map((c) => {
      const presentW = (c.present / max) * 100;
      const leftW = (c.left / max) * 100;
      return `<button type="button" class="chart-row" data-company="${esc(c.company)}">
        <span class="name">${esc(c.company)}</span>
        <span class="bar" title="${c.present} present · ${c.left} left">
          <i class="present" style="width:${presentW}%"></i>
          <i class="left" style="width:${leftW}%"></i>
        </span>
        <span class="meta">${c.present} in · ${c.notes} VIN</span>
      </button>`;
    }).join('');
    host.querySelectorAll('[data-company]').forEach((b) => {
      b.addEventListener('click', () => openCompany(b.dataset.company));
    });
  }

  function renderUsers() {
    const host = $('user-chart');
    const rows = dash.coordinators || [];
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No delivery notes printed yet.</p>';
      return;
    }
    const max = maxOf(rows, 'notes');
    host.innerHTML = rows.map((u) => `
      <div class="chart-row" style="cursor:default">
        <span class="name">${esc(u.name)}</span>
        <span class="bar"><i class="user" style="width:${(u.notes / max) * 100}%"></i></span>
        <span class="meta">${u.notes} note${u.notes === 1 ? '' : 's'}</span>
      </div>`).join('');
  }

  function renderCities() {
    const host = $('city-chart');
    const rows = dash.companyCities || [];
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No company city deliveries yet.</p>';
      return;
    }
    const max = maxOf(rows, 'total');
    host.innerHTML = rows.map((c) => {
      const segs = (c.cities || []).map((city, i) => {
        const w = (city.count / Math.max(c.total, 1)) * 100;
        const color = CITY_COLORS[i % CITY_COLORS.length];
        return `<i class="stack-seg" style="width:${w}%;background:${color}" title="${esc(city.city)} · ${city.count}"></i>`;
      }).join('');
      return `<button type="button" class="chart-row" data-city-co="${esc(c.company)}">
        <span class="name">${esc(c.company)}</span>
        <span class="bar">${segs}</span>
        <span class="meta">${c.total}</span>
      </button>`;
    }).join('');
    host.querySelectorAll('[data-city-co]').forEach((b) => {
      b.addEventListener('click', () => openCompanyCities(b.dataset.cityCo));
    });
  }

  function monthLabel(ym) {
    if (!/^\d{4}-\d{2}$/.test(String(ym || ''))) return '';
    const [y, m] = ym.split('-').map(Number);
    const name = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', { month: 'long', timeZone: 'UTC' });
    return name;
  }

  function achText(pct) {
    if (pct == null || !Number.isFinite(Number(pct))) return '—';
    return `${Math.round(Number(pct))}%`;
  }

  function empGap(r) {
    const mtd = Number(r.total) || 0;
    const target = Number(r.target) || 0;
    return {
      mtd,
      target,
      remaining: Math.max(0, target - mtd),
      span: Math.max(target, mtd, 0),
      pct: r.achPct,
    };
  }

  function renderEmployees() {
    const host = $('emp-chart');
    const kpis = $('emp-kpis');
    const tbody = $('emp-table-body');
    if (!host) return;
    const monthInp = $('emp-month');
    if (monthInp && perf && perf.month && monthInp.value !== perf.month) monthInp.value = perf.month;
    if ($('emp-month-hint') && perf) {
      const label = monthLabel(perf.month);
      $('emp-month-hint').textContent = perf.month === perf.currentMonth
        ? `${label || perf.month} MTD · day 1 → today`
        : `${label || perf.month} · full month`;
    }
    if (!perf) {
      if (kpis) kpis.innerHTML = '';
      host.innerHTML = '<p class="chart-empty">Could not load employee MTD / target data.</p>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="5">Could not load employee data.</td></tr>';
      return;
    }
    const rows = [...(perf.rows || [])].sort((a, b) => {
      const ap = a.achPct == null ? -1 : a.achPct;
      const bp = b.achPct == null ? -1 : b.achPct;
      return bp - ap || String(a.name).localeCompare(String(b.name));
    });
    const t = perf.totals || {};
    const team = empGap(t);
    if (kpis) {
      kpis.innerHTML = `
        <div class="kpi"><strong>${esc(team.target || 0)}</strong><span>Team target</span></div>
        <div class="kpi"><strong class="stay">${esc(team.mtd || 0)}</strong><span>MTD total</span></div>
        <div class="kpi"><strong class="sla-late-n">${esc(team.remaining || 0)}</strong><span>Still to target</span></div>
        <div class="kpi"><strong>${esc(achText(t.achPct))}</strong><span>Team Ach%</span></div>`;
    }
    if (!rows.length) {
      host.innerHTML = '<p class="chart-empty">No employees yet. Anyone on employee.html appears here automatically once targets are managed by Hanouf.</p>';
      if (tbody) tbody.innerHTML = '<tr><td colspan="5">No employees yet.</td></tr>';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => empGap(r).span), team.span || 0);
    host.innerHTML = rows.map((r) => {
      const g = empGap(r);
      const greenW = (g.mtd / max) * 100;
      const redW = (g.remaining / max) * 100;
      const targetLabel = g.target ? `Target ${g.target}` : 'No target';
      return `<button type="button" class="chart-row sla-row" data-emp="${esc(r.id)}" title="Open Overall KPI for ${esc(r.name)}">
        <span class="name">${esc(r.name)}<small>${esc(targetLabel)}</small></span>
        <span class="bar" title="${g.mtd} MTD · ${g.remaining} to target · ${achText(g.pct)}">
          <i class="present" style="width:${greenW}%"></i>
          <i class="sla-late" style="width:${redW}%"></i>
        </span>
        <span class="meta">${g.mtd} MTD · ${g.remaining} to target · ${achText(g.pct)}</span>
      </button>`;
    }).join('') + `
      <div class="chart-row sla-row" style="cursor:default">
        <span class="name">Team<small>Target ${team.target || '—'}</small></span>
        <span class="bar" title="${team.mtd} MTD · ${team.remaining} to target">
          <i class="present" style="width:${(team.mtd / max) * 100}%"></i>
          <i class="sla-late" style="width:${(team.remaining / max) * 100}%"></i>
        </span>
        <span class="meta">${team.mtd} MTD · ${team.remaining} to target · ${achText(t.achPct)}</span>
      </div>`;
    host.querySelectorAll('[data-emp]').forEach((b) => {
      b.addEventListener('click', () => openEmployeeKpi(b.dataset.emp));
    });

    if (tbody) {
      tbody.innerHTML = rows.map((r) => {
        const g = empGap(r);
        return `<tr class="emp-table-row" data-emp="${esc(r.id)}" title="Open Overall KPI">
          <td><b>${esc(r.name)}</b></td>
          <td class="num">${g.target || '—'}</td>
          <td class="num">${g.mtd}</td>
          <td class="num">${g.remaining}</td>
          <td class="num">${achText(g.pct)}</td>
        </tr>`;
      }).join('') + `
        <tr class="emp-table-team">
          <td><b>Team</b></td>
          <td class="num">${team.target || '—'}</td>
          <td class="num">${team.mtd}</td>
          <td class="num">${team.remaining}</td>
          <td class="num">${achText(t.achPct)}</td>
        </tr>`;
      tbody.querySelectorAll('[data-emp]').forEach((el) => {
        el.addEventListener('click', () => openEmployeeKpi(el.dataset.emp));
      });
    }
  }

  function fmtPct(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return `${Math.round(Number(n) * 100) / 100}%`;
  }

  function ringSvg(pct, status) {
    const r = 54;
    const circ = 2 * Math.PI * r;
    const p = pct == null ? 0 : Math.max(0, Math.min(100, Number(pct)));
    const off = circ * (1 - p / 100);
    return `<svg viewBox="0 0 132 132" class="ekpi-svg ekpi-${status || 'empty'}" aria-hidden="true">
      <circle class="ekpi-track" cx="66" cy="66" r="${r}"></circle>
      <circle class="ekpi-fill" cx="66" cy="66" r="${r}"
        stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}"></circle>
    </svg>`;
  }

  function showEmpList() {
    kpiOpenId = '';
    kpiExpanded = false;
    kpiDetailKey = '';
    if ($('emp-kpi-view')) $('emp-kpi-view').hidden = true;
    if ($('emp-list-view')) $('emp-list-view').hidden = false;
  }

  async function openEmployeeKpi(id, { keepExpand = false } = {}) {
    kpiOpenId = id;
    if (!keepExpand) {
      kpiExpanded = false;
      kpiDetailKey = '';
    }
    if ($('emp-list-view')) $('emp-list-view').hidden = true;
    if ($('emp-kpi-view')) $('emp-kpi-view').hidden = false;
    await loadEmployeeKpi();
  }

  async function loadEmployeeKpi() {
    if (!kpiOpenId) return;
    const month = ($('ekpi-month') && $('ekpi-month').value) || empMonth || '';
    const qs = `?employeeId=${encodeURIComponent(kpiOpenId)}${month ? `&month=${encodeURIComponent(month)}` : ''}`;
    kpiData = await api(`/kpi/employee${qs}`);
    empMonth = kpiData.month || empMonth;
    renderEmployeeKpi();
  }

  function renderEmployeeKpi() {
    const d = kpiData;
    if (!d || !d.employee) return;
    const empSel = $('ekpi-emp');
    if (empSel) {
      const roster = d.roster || [];
      if (empSel.options.length !== roster.length) {
        empSel.innerHTML = roster.map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
      }
      empSel.value = d.employee.id;
    }
    if ($('ekpi-month') && d.month) $('ekpi-month').value = d.month;
    const o = d.overall || {};
    $('ekpi-overall-val').textContent = o.available ? fmtPct(o.pct) : '—';
    $('ekpi-overall').className = `ekpi-overall ekpi-${o.status || 'empty'}${kpiExpanded ? ' is-open' : ''}`;
    $('ekpi-overall').setAttribute('aria-expanded', kpiExpanded ? 'true' : 'false');
    $('ekpi-ring').innerHTML = ringSvg(o.pct, o.status || 'empty');
    const monthNote = d.month === d.currentMonth ? `${d.month} · this month` : (d.month || '');
    $('ekpi-hint').textContent = `${d.employee.name} · ${monthNote} · ${d.counts.vinCount} VIN · ${d.counts.delivered} delivered · target ${d.counts.target || '—'}`;
    $('ekpi-overall-note').textContent = o.message
      || (o.notes && o.notes.length ? o.notes.join(' ') : (kpiExpanded ? 'Click again to collapse' : 'Click to see the four KPI components'));

    const keys = ['leadTime', 'achievement', 'contribution', 'psfu'];
    const br = $('ekpi-breakdown');
    br.hidden = !kpiExpanded;
    if (kpiExpanded) {
      br.innerHTML = keys.map((k) => {
        const x = d.kpis[k];
        if (!x) return '';
        return `<button type="button" class="ekpi-card ekpi-${x.status}${kpiDetailKey === k ? ' is-open' : ''}" data-kpi="${k}">
          <span class="ekpi-card-top">
            <b>${esc(x.short)}</b>
            <strong>${x.available ? fmtPct(x.kpiPct) : 'No data'}</strong>
          </span>
          <span class="ekpi-bar"><i style="width:${x.available ? Math.min(x.kpiPct || 0, 100) : 0}%"></i></span>
          <span class="ekpi-card-meta">${esc(x.actualLabel)} · weight ${x.weight}%</span>
        </button>`;
      }).join('');
      br.querySelectorAll('[data-kpi]').forEach((b) => {
        b.addEventListener('click', () => {
          kpiDetailKey = kpiDetailKey === b.dataset.kpi ? '' : b.dataset.kpi;
          renderEmployeeKpi();
        });
      });
    }
    const host = $('ekpi-detail');
    const x = kpiDetailKey && d.kpis[kpiDetailKey];
    if (!x || !kpiExpanded) {
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    const scoreLine = x.score == null ? '—' : `${x.score} / ${x.maxScore}`;
    host.innerHTML = `
      <h3>${esc(x.name)}</h3>
      ${x.message ? `<p class="ekpi-warn">${esc(x.message)}</p>` : ''}
      <dl class="ekpi-dl">
        <div><dt>Actual</dt><dd>${esc(x.actualLabel)}</dd></div>
        <div><dt>Rule</dt><dd>${esc(x.targetRule || '—')}</dd></div>
        <div><dt>Score</dt><dd>${esc(scoreLine)}</dd></div>
        <div><dt>KPI</dt><dd>${x.available ? fmtPct(x.kpiPct) : 'No data'}</dd></div>
        <div><dt>Weight</dt><dd>${x.weight}%</dd></div>
        <div><dt>Weighted contribution</dt><dd>${x.contribution == null ? '—' : fmtPct(x.contribution)}</dd></div>
      </dl>`;
  }

  function readWeightForm() {
    const weights = {};
    const enabled = {};
    document.querySelectorAll('.wgt-input').forEach((el) => { weights[el.dataset.k] = Number(el.value) || 0; });
    document.querySelectorAll('.wgt-on').forEach((el) => { enabled[el.dataset.k] = el.checked; });
    return { weights, enabled };
  }

  function updateWeightTotal() {
    const { weights, enabled } = readWeightForm();
    const total = Object.keys(weights).reduce((s, k) => s + (enabled[k] ? Number(weights[k]) || 0 : 0), 0);
    if ($('weight-total')) $('weight-total').textContent = `${total}%`;
    if ($('weight-error')) {
      $('weight-error').textContent = total === 100 ? '' : `Total must be 100% (now ${total}%).`;
      $('weight-error').classList.toggle('ekpi-err', total !== 100);
    }
  }

  function renderWeightForm(data) {
    const keys = data.keys || ['leadTime', 'achievement', 'contribution', 'psfu'];
    $('weight-body').innerHTML = keys.map((k) => `
      <tr>
        <td>${esc((data.meta && data.meta[k] && data.meta[k].name) || k)}</td>
        <td><input type="number" min="0" max="100" step="1" class="wgt-input" data-k="${k}" value="${data.weights[k]}" /></td>
        <td><input type="checkbox" class="wgt-on" data-k="${k}" ${data.enabled[k] ? 'checked' : ''} /></td>
      </tr>`).join('');
    document.querySelectorAll('.wgt-input').forEach((el) => el.addEventListener('input', updateWeightTotal));
    document.querySelectorAll('.wgt-on').forEach((el) => el.addEventListener('change', updateWeightTotal));
    updateWeightTotal();
  }

  async function loadWeights() {
    renderWeightForm(await api('/kpi/weights'));
  }

  async function saveWeights() {
    $('weight-error').textContent = '';
    try {
      await api('/kpi/weights', { method: 'PUT', json: readWeightForm() });
      toast('KPI weights saved');
      updateWeightTotal();
      if (kpiOpenId) await loadEmployeeKpi();
    } catch (err) {
      $('weight-error').textContent = err.message || 'Could not save';
      $('weight-error').classList.add('ekpi-err');
    }
  }

  function printHaystack(p) {
    const vins = (p.vins || []).map((v) => [v.vin, v.product, v.customer].join(' ')).join(' ');
    const snap = p.snapshot || {};
    return [
      p.invoiceNumber, p.company, p.city, p.printedBy, p.kind, p.at,
      snap.customer_name, snap.company_rep, snap.branch_to, vins,
    ].join(' ').toLowerCase();
  }

  function filteredPrints() {
    const q = pdfQuery.trim().toLowerCase();
    const rows = dash && dash.prints ? dash.prints : [];
    if (!q) return rows;
    return rows.filter((p) => printHaystack(p).includes(q));
  }

  function renderPrints() {
    const host = $('pdf-list');
    if (!host) return;
    const all = (dash && dash.prints) || [];
    const rows = filteredPrints();
    if (!all.length) {
      host.innerHTML = '<p class="chart-empty">No delivery-note copies yet. They appear here after coordinator print.</p>';
      return;
    }
    if (!rows.length) {
      host.innerHTML = `<p class="chart-empty">No copies match “${esc(pdfQuery)}”.</p>`;
      return;
    }
    host.innerHTML = rows.map((p) => {
      const vins = (p.vins || []).map((v) => v.vin || v).join(', ');
      const kind = p.kind === 'warehouse' ? 'Warehouse' : 'Delivery note';
      return `<article class="pdf-item" data-print-id="${esc(p.id)}">
        <b>${esc(kind)}${p.invoiceNumber ? ` · #${esc(p.invoiceNumber)}` : ''}</b>
        <span>${esc(p.company || '—')} · ${esc(p.city || '—')}</span><br />
        <span class="detail-vin">${esc(vins || '—')}</span><br />
        <span>${esc(p.printedBy || '')} · ${esc(fmtWhen(p.at))}</span>
        <div class="pdf-item-actions">
          <button type="button" class="btn" data-extract="${esc(p.id)}">Extract PDF</button>
        </div>
      </article>`;
    }).join('');
    host.querySelectorAll('[data-extract]').forEach((b) => {
      b.addEventListener('click', () => extractPrints([b.dataset.extract]));
    });
  }

  function splitDateParts(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: m[1], m: m[2], d: m[3] } : { y: '', m: '', d: '' };
  }

  function overlayPositionStyle(tag, x, y, w, h) {
    let left = `${x * 100}%`;
    if (/^wh_chassis/.test(tag)) left = `${x * 100}%`;
    else if (/_chassis$/.test(tag)) left = `calc(${x * 100}% + 15.9mm)`;
    if (/_model$/.test(tag)) left = `calc(${x * 100}% + 4mm)`;
    if (/_plate$/.test(tag)) left = `calc(${x * 100}% + 10.6mm)`;
    return `left:${left};top:${y * 100}%;width:${w * 100}%;height:${h * 100}%`;
  }

  function snapshotFromPrint(p) {
    if (p.snapshot && typeof p.snapshot === 'object') return p.snapshot;
    const day = String(p.at || '').slice(0, 10);
    const cars = (p.vins || []).map((v) => ({
      model: v.product || '',
      chassis: v.vin || v,
      plate: '',
      remarks: '',
    }));
    return {
      doc_date: day,
      invoice_number: p.invoiceNumber || '',
      customer_name: (p.vins && p.vins[0] && p.vins[0].customer) || '',
      company_rep: p.company || '',
      transfer_date: day,
      corresponding_date: day,
      car_count: String(cars.length || ''),
      branch_to: p.city || '',
      cars,
      warehouse: {},
    };
  }

  function overlayData(p) {
    const body = snapshotFromPrint(p);
    if (p.kind === 'warehouse') {
      const vins = (body.cars || []).map((c) => String(c.chassis || '').trim()).filter(Boolean);
      const wh = body.warehouse || {};
      return {
        wh_owner_name: wh.owner_name || body.customer_name || '',
        wh_user_name: wh.user_name || '',
        wh_user_phone: wh.user_phone || '',
        wh_user_id: wh.user_id || '',
        wh_print_date: (wh.print_date || body.doc_date || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1'),
        wh_print_time: wh.print_time || '',
        wh_chassis: vins[0] || '',
        wh_chassis_2: vins[1] || '',
        wh_chassis_3: vins[2] || '',
        wh_chassis_4: vins[3] || '',
        wh_chassis_5: vins[4] || '',
      };
    }
    const doc = splitDateParts(body.doc_date);
    const transfer = splitDateParts(body.transfer_date || body.doc_date);
    const corr = splitDateParts(body.corresponding_date || body.doc_date);
    const data = {
      date_d: doc.d, date_m: doc.m, date_y: doc.y,
      invoice_number: body.invoice_number || p.invoiceNumber || '',
      dep_hour: body.dep_hour || '',
      dep_minute: body.dep_minute || '',
      customer_name: body.customer_name || '',
      company_rep: body.company_rep || p.company || '',
      transfer_d: transfer.d, transfer_m: transfer.m, transfer_y: transfer.y,
      corresponding_d: corr.d, corresponding_m: corr.m, corresponding_y: corr.y,
      day_name: body.day_name || '',
      trailer_number: body.trailer_number || '',
      car_count: body.car_count || String((p.vins || []).length || ''),
      branch_to: body.branch_to || p.city || '',
      attachments: body.attachments || '',
    };
    const cars = Array.isArray(body.cars) ? body.cars : [];
    for (let i = 1; i <= 10; i++) {
      const row = cars[i - 1] || {};
      data[`car${i}_model`] = row.model || '';
      data[`car${i}_chassis`] = row.chassis || '';
      data[`car${i}_plate`] = row.plate || '';
      data[`car${i}_remarks`] = row.remarks || '';
    }
    return data;
  }

  function buildPrintSheet(p) {
    const warehouse = p.kind === 'warehouse';
    const layout = warehouse
      ? (typeof CHECK_NOTE_FIELDS !== 'undefined' ? CHECK_NOTE_FIELDS : [])
      : (typeof MUTHAKARA_FIELDS !== 'undefined' ? MUTHAKARA_FIELDS : []);
    const cover = !warehouse && typeof INVOICE_NUMBER_COVER !== 'undefined' ? INVOICE_NUMBER_COVER : null;
    const coverHtml = cover
      ? `<div class="overlay-cover" style="left:${cover[0] * 100}%;top:${cover[1] * 100}%;width:${cover[2] * 100}%;height:${cover[3] * 100}%"></div>`
      : '';
    const data = overlayData(p);
    const fields = layout.map(([tag, x, y, w, h, align]) => {
      const invoiceCls = tag === 'invoice_number' ? ' overlay-field--invoice' : '';
      const chassisCls = /chassis/.test(tag) ? ' overlay-field--chassis' : '';
      return `<div class="overlay-field align-${align || 'end'}${invoiceCls}${chassisCls}" style="${overlayPositionStyle(tag, x, y, w, h)}">${esc(data[tag] || '')}</div>`;
    }).join('');
    const src = warehouse
      ? '../images/delivery-check-note-form.png'
      : '../images/muthakara-tarhil-form.png';
    const fallback = warehouse
      ? ''
      : '../toyota-internal-lease-calculator-main/images/muthakara-tarhil-form.png';
    return `<div class="print-sheet print-copy"><img src="${src}" alt=""${fallback ? ` onerror="this.onerror=null;this.src='${fallback}'"` : ''} />
      <div class="overlay-layer">${coverHtml}${fields}</div></div>`;
  }

  function extractPrints(ids) {
    const set = new Set(ids || []);
    const rows = ((dash && dash.prints) || []).filter((p) => set.has(p.id));
    if (!rows.length) {
      alert('No PDF copies to extract.');
      return;
    }
    const existing = document.getElementById('printCopies');
    if (existing) existing.remove();
    const box = document.createElement('div');
    box.id = 'printCopies';
    box.innerHTML = rows.map(buildPrintSheet).join('');
    document.body.insertBefore(box, document.body.firstChild);
    const imgs = [...box.querySelectorAll('img')];
    Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((done) => {
      img.onload = () => done();
      img.onerror = () => done();
    })))).then(() => {
      const finish = () => {
        window.removeEventListener('afterprint', finish);
        if (box.parentNode) box.remove();
      };
      window.addEventListener('afterprint', finish);
      window.print();
    });
  }

  function closeDrawer() {
    $('detail-back').classList.remove('open');
  }

  function openDrawer(html) {
    $('detail-drawer').innerHTML = html;
    $('detail-back').classList.add('open');
    const close = $('detail-close');
    if (close) close.onclick = closeDrawer;
  }

  function openCompany(name) {
    const c = (dash.companies || []).find((x) => x.company === name);
    if (!c) return;
    const people = (c.people || []).slice().sort((a, b) => (Date.parse(b.arrivedAt) || 0) - (Date.parse(a.arrivedAt) || 0));
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(c.company)}</h2>
          <p class="sub">${c.present} present · ${c.left} left · ${c.notes} VIN on notes</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <h3 style="margin:0 0 8px;font-size:.85rem">Drivers — arrive / leave</h3>
      <div class="table-wrap" style="max-height:40vh;margin-bottom:14px">
        <table class="data">
          <thead><tr><th>Name</th><th>Phone</th><th>Arrived</th><th>Left</th><th>Stay</th><th>VIN</th><th>City</th></tr></thead>
          <tbody>${people.map((p) => `
            <tr>
              <td><b>${esc(p.name)}</b></td>
              <td>${esc(p.phone || '—')}</td>
              <td>${esc(fmtWhen(p.arrivedAt))}</td>
              <td class="${p.leftAt ? 'gone' : 'stay'}">${p.leftAt ? esc(fmtWhen(p.leftAt)) : 'Still here'}</td>
              <td data-stay="${esc(p.id)}">${esc(stayText(p))}</td>
              <td class="detail-vin">${esc((p.vins || []).join(', ') || '—')}</td>
              <td>${esc(p.city || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="7">No check-ins for this company yet.</td></tr>'}</tbody>
        </table>
      </div>
      <h3 style="margin:0 0 8px;font-size:.85rem">VINs on delivery notes</h3>
      <div class="table-wrap" style="max-height:28vh">
        <table class="data">
          <thead><tr><th>VIN</th><th>Product</th><th>Customer</th><th>City</th><th>Printed</th><th>By</th></tr></thead>
          <tbody>${(c.vins || []).map((v) => `
            <tr>
              <td class="detail-vin">${esc(v.vin)}</td>
              <td>${esc(v.product || '—')}</td>
              <td>${esc(v.customer || '—')}</td>
              <td>${esc(v.city || '—')}</td>
              <td>${esc(fmtWhen(v.printedAt))}</td>
              <td>${esc(v.printedBy || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="6">No delivery notes for this company yet.</td></tr>'}</tbody>
        </table>
      </div>`);
  }

  function openCompanyCities(name) {
    const c = (dash.companyCities || []).find((x) => x.company === name);
    if (!c) return;
    openDrawer(`
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(c.company)}</h2>
          <p class="sub">${c.total} car${c.total === 1 ? '' : 's'} · click a city row is not needed — all details below</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      ${(c.cities || []).map((city, i) => `
        <div class="card" style="margin-bottom:10px;box-shadow:none">
          <h2 style="display:flex;justify-content:space-between">
            <span>${esc(city.city)}</span>
            <span style="color:${CITY_COLORS[i % CITY_COLORS.length]}">${city.count}</span>
          </h2>
          <div class="table-wrap" style="max-height:200px">
            <table class="data">
              <thead><tr><th>VIN</th><th>Product</th><th>Printed</th><th>By</th></tr></thead>
              <tbody>${(city.vins || []).map((v) => `
                <tr>
                  <td class="detail-vin">${esc(v.vin)}</td>
                  <td>${esc(v.product || '—')}</td>
                  <td>${esc(fmtWhen(v.printedAt))}</td>
                  <td>${esc(v.printedBy || '—')}</td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`).join('')}`);
  }

  function resultClass(result) {
    if (result === 'LATE') return 'gone';
    if (result === 'ON TIME' || result === 'ON TRACK') return 'stay';
    return '';
  }

  function shiftMonth(ym, delta) {
    const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return ym;
    const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
    return dt.toISOString().slice(0, 7);
  }

  function syncMonthInputs() {
    ['emp-month', 'sla-month', 'ekpi-month'].forEach((id) => {
      const el = $(id);
      if (el && empMonth && el.value !== empMonth) el.value = empMonth;
    });
  }

  function setDashMonth(ym) {
    empMonth = ym || '';
    syncMonthInputs();
    return loadDash();
  }

  function renderSchedule() {
    const host = $('sla-chart');
    const summary = $('vsnd-summary');
    const monthLbl = $('vsnd-month-label');
    if (!host) return;
    syncMonthInputs();
    if (!slaDash) {
      if (summary) summary.innerHTML = '';
      if (monthLbl) monthLbl.textContent = '—';
      host.innerHTML = '<p class="chart-empty">Could not load VSND schedule.</p>';
      return;
    }
    const cal = slaDash.calendar;
    if (!cal || !cal.rows) {
      host.innerHTML = '<p class="chart-empty">No calendar data for this month.</p>';
      return;
    }
    const label = monthLabel(cal.month) || cal.month;
    if (monthLbl) monthLbl.textContent = `${label} ${String(cal.month || '').slice(0, 4)}`.trim();
    if (summary) {
      summary.innerHTML = `
        <div class="vsnd-pill vsnd-pill-ok">
          <span class="vsnd-pill-ico" aria-hidden="true">🚚</span>
          <div>
            <span class="vsnd-pill-lbl">Delivered (تم التسليم)</span>
            <strong>${esc(cal.delivered || 0)}</strong>
            <em>Current Month</em>
          </div>
        </div>
        <div class="vsnd-pill vsnd-pill-bad">
          <span class="vsnd-pill-ico" aria-hidden="true">⏳</span>
          <div>
            <span class="vsnd-pill-lbl">Not Delivered (VSND)</span>
            <strong>${esc(cal.notDelivered || 0)}</strong>
            <em>Current Month</em>
          </div>
        </div>`;
    }

    const headers = cal.dayHeaders || [];
    const headCells = headers.map((h) => `
      <th class="vsnd-day ${h.future ? 'is-future' : ''}${h.day === cal.todayDay ? ' is-today' : ''}">
        <b>${h.day}</b><small>${esc(h.weekday)}</small>
      </th>`).join('');

    const body = (cal.rows || []).map((r) => {
        const cells = (r.days || []).map((n, i) => {
        const zone = (r.zones && r.zones[i]) || 'empty';
        const future = zone === 'future';
        const show = future ? '—' : (n || 0);
        const clickable = !future && n > 0;
        return `<td class="vsnd-cell tone-${esc(r.tone)} zone-${esc(zone)}${clickable ? ' is-hit' : ''}">
          <button type="button" class="vsnd-val" data-status="${esc(r.status)}" data-day="${i + 1}" ${clickable ? '' : 'disabled'}>${esc(show)}</button>
        </td>`;
      }).join('');
      return `<tr class="vsnd-row tone-${esc(r.tone)}">
        <th class="vsnd-status">
          <span class="vsnd-ico" aria-hidden="true">${r.icon || '•'}</span>
          <span class="vsnd-status-lbl">${esc(r.label)}</span>
        </th>
        ${cells}
        <td class="vsnd-total">
          <button type="button" class="vsnd-total-btn" data-status="${esc(r.status)}" data-day="">${esc(r.total || 0)}</button>
        </td>
      </tr>`;
    }).join('');

    const footDays = (cal.dayTotals || []).map((n, i) => {
      const future = headers[i] && headers[i].future;
      return `<td class="vsnd-foot-day${future ? ' is-future' : ''}">${future ? '—' : esc(n || 0)}</td>`;
    }).join('');

    host.innerHTML = `
      <table class="vsnd-table">
        <thead>
          <tr>
            <th class="vsnd-status-h">Status</th>
            ${headCells}
            <th class="vsnd-total-h">Total</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <th class="vsnd-status">Total</th>
            ${footDays}
            <td class="vsnd-grand"><span>${esc(cal.grandTotal || 0)}</span></td>
          </tr>
        </tfoot>
      </table>`;

    host.querySelectorAll('.vsnd-val[data-status], .vsnd-total-btn[data-status]').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.disabled) return;
        openVsndCell(el.dataset.status, el.dataset.day ? Number(el.dataset.day) : 0);
      });
    });
  }

  function openVsndCell(status, day) {
    const cal = slaDash && slaDash.calendar;
    if (!cal) return;
    const rows = (cal.vins || []).filter((v) => {
      if (status && v.status !== status) return false;
      if (day && Number(v.day) !== Number(day)) return false;
      return true;
    }).sort((a, b) => String(a.vin).localeCompare(String(b.vin)));
    const title = day ? `${status} · Day ${day}` : status;
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(title)}</h2>
          <p class="sub">${esc(monthLabel(cal.month) || cal.month)} · ${rows.length} VIN(s) · by Proforma date</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap" style="max-height:70vh">
        <table class="data">
          <thead><tr><th>VIN</th><th>Product</th><th>Employee</th><th>Proforma</th><th>Status</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td class="detail-vin">${esc(r.vin)}</td>
              <td>${esc(r.product || '—')}</td>
              <td>${esc(r.employee || '—')}</td>
              <td>${esc(r.proforma || '—')}</td>
              <td>${esc(r.status || '—')}</td>
            </tr>`).join('') || '<tr><td colspan="5">No VINs in this cell.</td></tr>'}</tbody>
        </table>
      </div>`);
  }

  function openSla(id) {
    const s = ((slaDash && slaDash.sla) || []).find((x) => x.id === id);
    if (!s) return;
    const rows = (s.rows || []).slice().sort((a, b) => {
      if (a.zone !== b.zone) return a.zone === 'red' ? -1 : 1;
      return String(a.vin).localeCompare(String(b.vin));
    });
    openDrawer(`
      <div class="drawer-head" style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px">
        <div>
          <h2>${esc(s.label)}</h2>
          <p class="sub">Target Day ${s.targetDay} from each VIN’s Proforma · ${s.green} on plan · ${s.red} late</p>
        </div>
        <button type="button" class="btn" id="detail-close">Close</button>
      </div>
      <div class="table-wrap" style="max-height:70vh">
        <table class="data">
          <thead><tr><th>VIN</th><th>Employee</th><th>Proforma</th><th>Target</th><th>Actual</th><th>Result</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr>
              <td class="detail-vin">${esc(r.vin)}</td>
              <td>${esc(r.employee || '—')}</td>
              <td>${esc(r.proforma || '—')}</td>
              <td>${esc(r.targetDate || '—')}</td>
              <td>${esc(r.actualAt || '—')}</td>
              <td class="${resultClass(r.result)}"><b>${esc(r.result)}</b><br /><span class="hint">${esc(r.label)}</span></td>
            </tr>`).join('') || '<tr><td colspan="6">No VINs with a Proforma Date this month.</td></tr>'}</tbody>
        </table>
      </div>`);
  }

  function renderSlaForm(data) {
    const host = $('sla-body');
    if (!host) return;
    host.innerHTML = (data.items || []).map((x) => `
      <tr>
        <td><b>${esc(x.label)}</b></td>
        <td>${esc((x.statuses || []).join(', '))}</td>
        <td><input type="number" min="1" max="60" step="1" class="wgt-input sla-day" data-id="${esc(x.id)}" value="${x.targetDay}" /></td>
        <td><input type="checkbox" class="sla-on" data-id="${esc(x.id)}" ${x.enabled ? 'checked' : ''} /></td>
      </tr>`).join('');
  }

  async function loadSlaConfig() {
    renderSlaForm(await api('/schedule/config'));
  }

  async function saveSlaConfig() {
    if ($('sla-error')) $('sla-error').textContent = '';
    const items = [...document.querySelectorAll('.sla-day')].map((el) => ({
      id: el.dataset.id,
      targetDay: Number(el.value),
      enabled: !!(document.querySelector(`.sla-on[data-id="${el.dataset.id}"]`) || {}).checked,
    }));
    try {
      await api('/schedule/config', { method: 'PUT', json: { items } });
      toast('Schedule saved');
      await loadDash();
    } catch (err) {
      if ($('sla-error')) {
        $('sla-error').textContent = err.message || 'Could not save';
        $('sla-error').classList.add('ekpi-err');
      }
    }
  }

  async function loadDash({ silent = false } = {}) {
    if (silent && dashInFlight) return;
    dashInFlight = true;
    try {
      const monthQs = empMonth ? `?month=${encodeURIComponent(empMonth)}` : '';
      const [dashData, perfData, slaData, backupData] = await Promise.all([
        api('/admin/dashboard'),
        api(`/team-performance${monthQs}`).catch(() => null),
        api(`/schedule/dashboard${monthQs}`).catch(() => null),
        api('/backup').catch(() => null),
      ]);
      dash = dashData;
      if (perfData) {
        perf = perfData;
        empMonth = perfData.month || empMonth;
      }
      if (slaData) {
        slaDash = slaData;
        empMonth = slaData.month || empMonth;
      }
      if (backupData) backup = backupData;
      syncMonthInputs();
      renderKpis();
      renderBackup();
      renderAttendance();
      renderUsers();
      renderCities();
      renderEmployees();
      renderSchedule();
      renderPrints();
      if (kpiOpenId) loadEmployeeKpi().catch(() => {});
    } finally {
      dashInFlight = false;
    }
  }

  async function addList(type, form) {
    const name = String(form.name.value || '').trim();
    if (!name) return;
    try {
      await api('/admin/lists', { method: 'POST', json: { type, name } });
      form.reset();
      toast(`${type === 'company' ? 'Company' : 'City'} added`);
      $('list-hint').textContent = `Added ${name}. Attendance and coordinator lists updated.`;
      await loadDash();
    } catch (err) {
      alert(err.message || 'Could not add');
    }
  }

  function setTab(tab) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.panel-tab').forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
    if (tab === 'weights') loadWeights().catch((err) => { if ($('weight-error')) $('weight-error').textContent = err.message; });
    if (tab === 'schedule') loadSlaConfig().catch((err) => { if ($('sla-error')) $('sla-error').textContent = err.message; });
  }

  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('detail-back').addEventListener('click', (e) => { if (e.target === $('detail-back')) closeDrawer(); });
  const empMonthInp = $('emp-month');
  if (empMonthInp) {
    empMonthInp.addEventListener('change', (e) => {
      setDashMonth(e.target.value || '').catch((err) => alert(err.message));
    });
  }
  const slaMonthInp = $('sla-month');
  if (slaMonthInp) {
    slaMonthInp.addEventListener('change', (e) => {
      setDashMonth(e.target.value || '').catch((err) => alert(err.message));
    });
  }
  if ($('vsnd-prev')) {
    $('vsnd-prev').addEventListener('click', () => {
      setDashMonth(shiftMonth(empMonth || (slaDash && slaDash.month) || '', -1)).catch((err) => alert(err.message));
    });
  }
  if ($('vsnd-next')) {
    $('vsnd-next').addEventListener('click', () => {
      setDashMonth(shiftMonth(empMonth || (slaDash && slaDash.month) || '', 1)).catch((err) => alert(err.message));
    });
  }
  if ($('ekpi-back')) $('ekpi-back').addEventListener('click', showEmpList);
  if ($('ekpi-emp')) {
    $('ekpi-emp').addEventListener('change', (e) => {
      if (e.target.value) openEmployeeKpi(e.target.value, { keepExpand: kpiExpanded }).catch((err) => alert(err.message));
    });
  }
  if ($('ekpi-month')) {
    $('ekpi-month').addEventListener('change', (e) => {
      empMonth = e.target.value || empMonth;
      if (kpiOpenId) loadEmployeeKpi().catch((err) => alert(err.message));
    });
  }
  if ($('ekpi-overall')) {
    $('ekpi-overall').addEventListener('click', () => {
      kpiExpanded = !kpiExpanded;
      if (!kpiExpanded) kpiDetailKey = '';
      renderEmployeeKpi();
    });
  }
  if ($('weight-save')) $('weight-save').addEventListener('click', () => saveWeights());
  if ($('sla-save')) $('sla-save').addEventListener('click', () => saveSlaConfig());
  async function runExport(path, filename) {
    try {
      await downloadFile(path, filename);
      toast('Excel downloaded');
    } catch (err) {
      alert(err.message || 'Could not extract Excel');
    }
  }
  if ($('xls-live')) {
    $('xls-live').addEventListener('click', () => runExport('/export/live-sheet', 'DT-Live-Sheet.xlsx'));
  }
  if ($('xls-admin')) {
    $('xls-admin').addEventListener('click', () => {
      const month = ($('ekpi-month') && $('ekpi-month').value) || empMonth || '';
      const qs = month ? `?month=${encodeURIComponent(month)}` : '';
      runExport(`/export/admin${qs}`, 'DT-Admin.xlsx');
    });
  }
  if ($('backup-save')) {
    $('backup-save').addEventListener('click', async () => {
      $('backup-hint').textContent = 'Saving…';
      try {
        backup = await api('/backup', { method: 'POST' });
        renderBackup();
        $('backup-hint').textContent = 'Snapshot saved.';
        toast('Snapshot saved');
      } catch (err) {
        $('backup-hint').textContent = err.message || 'Could not save';
      }
    });
  }
  if ($('backup-restore')) {
    $('backup-restore').addEventListener('click', async () => {
      const when = backup && backup.lastAt ? fmtWhen(backup.lastAt) : 'the last snapshot';
      if (!confirm(`Restore employee.html and coordinator.html from ${when}? Current live data will be replaced.`)) return;
      $('backup-hint').textContent = 'Restoring…';
      try {
        backup = await api('/backup/restore', { method: 'POST' });
        renderBackup();
        await loadDash();
        $('backup-hint').textContent = `Restored ${when}.`;
        toast('Last data restored');
      } catch (err) {
        $('backup-hint').textContent = err.message || 'Could not restore';
      }
    });
  }
  $('pdf-min').addEventListener('click', () => $('pdf-win').classList.toggle('is-min'));
  $('pdf-search').addEventListener('input', (e) => {
    pdfQuery = e.target.value || '';
    renderPrints();
  });
  $('pdf-extract-all').addEventListener('click', () => {
    extractPrints(filteredPrints().map((p) => p.id));
  });
  $('add-company-form').addEventListener('submit', (e) => { e.preventDefault(); addList('company', e.target); });
  $('add-city-form').addEventListener('submit', (e) => { e.preventDefault(); addList('city', e.target); });

  setInterval(tickClock, 1000);
  tickClock();
  loadDash().catch((e) => alert(e.message));
  dashTimer = setInterval(() => {
    if (document.hidden) return;
    loadDash({ silent: true }).catch(() => {});
  }, 2000);

  // ——— VIN tools (existing admin sheet) ———
  (async function vinTools() {
    const meta = await DTXLive.loadMeta();
    $('add-employee').innerHTML = '<option value="">— Unassigned —</option>'
      + (meta.employees || []).map((e) => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');

    function bars(el, counts) {
      const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
      const max = Math.max(1, ...entries.map((e) => e[1]));
      el.innerHTML = entries.map(([k, n]) => `
        <div style="display:grid;grid-template-columns:120px 1fr 32px;gap:8px;align-items:center;margin:4px 0;font-size:.8rem">
          <span>${esc(k)}</span>
          <span style="height:8px;border-radius:4px;background:#e6edf4;overflow:hidden">
            <span style="display:block;height:100%;width:${(n / max) * 100}%;background:#143a5c"></span>
          </span>
          <b>${n}</b>
        </div>`).join('') || '<span class="hint">—</span>';
    }

    async function loadAll() {
      const q = $('search').value.trim();
      const [live, audit] = await Promise.all([
        api(`/live-sheet${q ? `?q=${encodeURIComponent(q)}` : ''}`),
        api('/audit?limit=100'),
      ]);
      const rows = live.rows || [];
      const assigned = rows.filter((r) => r.ops.assignedEmployeeId).length;
      const withCarrier = rows.filter((r) => String(r.ops.carrier || '').trim()).length;
      $('kpis').innerHTML = [
        ['Total VINs', live.total],
        ['Assigned', assigned],
        ['Unassigned', rows.length - assigned],
        ['With الناقل', withCarrier],
      ].map(([l, n]) => `<div class="kpi"><strong>${n}</strong><span>${esc(l)}</span></div>`).join('');
      bars($('by-status'), live.byStatus);
      bars($('by-employee'), live.byEmployee);
      bars($('by-carrier'), live.byCarrier);
      $('live-meta').textContent = `${live.total} VINs · synced ${new Date(live.at).toLocaleTimeString()}`;
      DTXLive.renderTable($('live-table'), rows, {
        mode: 'admin',
        onOpen: (vin) => DTXLive.openDrawer(vin, { mode: 'admin', onSaved: loadAll }),
      });
      $('audit-table').innerHTML = `<thead><tr><th>Time</th><th>User</th><th>VIN</th><th>Action</th><th>Old</th><th>New</th></tr></thead>
        <tbody>${(audit.rows || []).map((a) => `<tr>
          <td>${esc(String(a.at || '').replace('T', ' ').slice(0, 19))}</td>
          <td>${esc(a.user)}</td><td>${esc(a.vin)}</td><td>${esc(a.action)}</td>
          <td>${esc(a.oldValue)}</td><td>${esc(a.newValue)}</td></tr>`).join('')
          || '<tr><td colspan="6">No changes yet.</td></tr>'}</tbody>`;
    }

    $('add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api('/vehicles', { method: 'POST', json: body });
        e.target.reset();
        toast('VIN added');
        loadAll();
      } catch (err) {
        alert(err.message);
      }
    });
    let t;
    $('search').addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(loadAll, 250);
    });
    $('refresh-btn').addEventListener('click', loadAll);
    loadAll().catch((e) => console.error(e));
  }());

  window.addEventListener('beforeunload', () => { if (dashTimer) clearInterval(dashTimer); });
  }
})();
