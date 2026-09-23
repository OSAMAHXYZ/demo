(() => {
  const { api, esc, toast, getToken, getUser, setSession, clearSession } = window.DTX;

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

  async function loadDash({ silent = false } = {}) {
    if (silent && dashInFlight) return;
    dashInFlight = true;
    try {
      dash = await api('/admin/dashboard');
      renderKpis();
      renderAttendance();
      renderUsers();
      renderCities();
      renderPrints();
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
  }

  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('detail-back').addEventListener('click', (e) => { if (e.target === $('detail-back')) closeDrawer(); });
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
