/* Delivery Transformation coordinator — Live Sheet + Delivery_pdf print */
(() => {
  const { api, esc, na, getToken, getUser, setSession, clearSession } = window.DTX;

  const $ = (id) => document.getElementById(id);
  const AR_NUMS = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠'];
  const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

  let rows = [];
  let poll = null;
  let overlayReady = false;
  let printMode = 'sheet';
  let transferCities = [];
  let vinPickerMode = 'open-warehouse';
  let activeVinRow = null;
  let attendanceCompanies = [];
  let claimedAttendanceId = '';
  let lastAttendanceCity = '';
  let cityReloadTimer = null;
  const fieldEls = {};

  function showView(name) {
    $('gateLogin').classList.toggle('hidden', name !== 'login');
    $('agentWorkspace').classList.toggle('hidden', name !== 'workspace');
    $('mainApp').classList.toggle('hidden', name !== 'detail');
    document.body.classList.toggle('workspace-mode', name === 'workspace');
    document.body.classList.toggle('app-mode', name === 'detail');
    if (name === 'workspace') startPoll();
    else stopPoll();
  }

  function stopPoll() {
    if (poll) { clearInterval(poll); poll = null; }
  }

  function startPoll() {
    stopPoll();
    poll = setInterval(() => loadWorkspace({ silent: true }).catch(() => {}), 5000);
  }

  function logout() {
    api('/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    location.reload();
  }

  async function login() {
    const status = $('loginStatus');
    status.textContent = '';
    status.className = 'ws-toast';
    try {
      const data = await api('/auth/login', {
        method: 'POST',
        json: { username: $('loginUser').value, password: $('loginPass').value },
      });
      if (data.user.role !== 'coordinator' && data.user.role !== 'admin') {
        status.className = 'ws-toast err';
        status.textContent = 'هذا المستخدم ليس منسق تسليم';
        return;
      }
      setSession(data.token, data.user);
      enterApp(data.user);
    } catch (err) {
      status.className = 'ws-toast err';
      status.textContent = err.message || 'فشل الدخول';
    }
  }

  function enterApp(user) {
    $('loggedAs').textContent = user.name;
    $('adminLink').hidden = user.role !== 'admin';
    $('empLink').hidden = user.role !== 'admin';
    showView('workspace');
    loadWorkspace().catch((e) => alert(e.message));
  }

  function fleetCard(r) {
    const product = r.raw.product || '—';
    const type = r.raw.salesType || '';
    const loc = r.raw.vehicleLocation || r.raw.gtLocation || '';
    const city = (r.ops && r.ops.transferCity) || '';
    return `<button type="button" class="fleet-card fleet-card--actionable" data-vin="${esc(r.vin)}" data-product="${esc(product)}" data-company="${esc(type)}" data-order="${esc(r.raw.salesOrder || '')}" data-customer="${esc(r.raw.userName || '')}" data-phone="${esc(r.raw.phone || '')}" data-city="${esc(city)}">
      <div class="fc-body">
        <div class="fc-vin">${esc(r.vin)}</div>
        <div class="fc-product">${esc(product)}</div>
        <div class="fc-meta">${[r.raw.salesOrder ? `طلب ${r.raw.salesOrder}` : '', city || loc].filter(Boolean).join(' · ') || '—'}</div>
        <span class="fc-badge">${esc(type || 'متاح')}</span>
      </div>
    </button>`;
  }

  function groupBySalesType(list) {
    const groups = new Map();
    list.forEach((r) => {
      const key = String((r.raw && r.raw.salesType) || '').trim() || 'بدون نوع بيع';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar'));
  }

  function filterFleet() {
    const input = $('availableVinSearch');
    const countEl = $('availableVinSearchCount');
    const emptyEl = $('availableVinSearchEmpty');
    const availEl = $('availableFleet');
    const q = String(input.value || '').trim().toUpperCase().replace(/\s+/g, '');
    availEl.classList.toggle('is-searching', Boolean(q));
    const cards = [...availEl.querySelectorAll('.fleet-card')];
    let visible = 0;
    cards.forEach((card) => {
      const hay = [card.dataset.vin, card.dataset.product, card.dataset.company, card.dataset.order, card.dataset.customer, card.dataset.phone, card.dataset.city]
        .join(' ').toUpperCase().replace(/\s+/g, '');
      const match = !q || hay.includes(q);
      card.classList.toggle('fleet-card--hidden', !match);
      if (match) visible += 1;
    });
    availEl.querySelectorAll('.fleet-company-group').forEach((group) => {
      const vis = [...group.querySelectorAll('.fleet-card')].filter((c) => !c.classList.contains('fleet-card--hidden'));
      group.classList.toggle('fleet-company-group--hidden', !vis.length);
      const count = group.querySelector('.fleet-company-count');
      const total = group.querySelectorAll('.fleet-card').length;
      if (count) count.textContent = q ? `${vis.length} من ${total}` : `${total} سيارة`;
    });
    countEl.textContent = q ? `${visible} نتيجة` : `${cards.length} سيارة`;
    emptyEl.classList.toggle('hidden', visible > 0 || !q);
    const missingBtn = $('btnMissingVin');
    if (missingBtn) missingBtn.classList.toggle('is-highlight', Boolean(q) && visible === 0);
    const table = $('coordLiveTable');
    if (table) {
      table.querySelectorAll('tbody tr[data-vin]').forEach((tr) => {
        const card = availEl.querySelector(`.fleet-card[data-vin="${CSS.escape(tr.dataset.vin)}"]`);
        tr.style.display = card && card.classList.contains('fleet-card--hidden') ? 'none' : '';
      });
    }
  }

  async function loadWorkspace({ silent = false } = {}) {
    const live = await api('/live-sheet');
    rows = live.rows || [];
    const withPhone = rows.filter((r) => r.raw.phone).length;
    const types = new Set(rows.map((r) => (r.raw.salesType || '').trim()).filter(Boolean));
    $('wsStats').innerHTML = `
      <div class="ws-stat ws-stat--avail"><span>شاسيه</span><b>${live.total || 0}</b></div>
      <div class="ws-stat ws-stat--stock"><span>أنواع البيع</span><b>${types.size}</b></div>
      <div class="ws-stat ws-stat--ready"><span>بهاتف</span><b>${withPhone}</b></div>
      <div class="ws-stat"><span>آخر مزامنة</span><b style="font-size:.85rem">${new Date(live.at || Date.now()).toLocaleTimeString()}</b></div>`;
    $('livePill').classList.toggle('off', silent);

    const availEl = $('availableFleet');
    if (!rows.length) {
      availEl.innerHTML = '<div class="ws-empty"><strong>لا توجد سيارات</strong>انتظر رفع Sales Raw أو VINs</div>';
    } else {
      availEl.innerHTML = groupBySalesType(rows).map(([type, items]) => `<div class="fleet-company-group is-expanded">
          <div class="fleet-company-head">
            <div class="fleet-company-name">${esc(type)}<span class="fleet-company-badge">نوع البيع</span></div>
            <div class="fleet-company-count">${items.length} سيارة</div>
          </div>
          <div class="fleet-grid">${items.map(fleetCard).join('')}</div>
        </div>`).join('');
      availEl.querySelectorAll('.fleet-card').forEach((card) => {
        card.addEventListener('click', () => openDetail(card.dataset.vin));
      });
    }
    renderLiveTable(rows);
    filterFleet();
  }

  function renderLiveTable(list) {
    const table = $('coordLiveTable');
    const hint = $('liveSheetHint');
    if (hint) hint.textContent = `${list.length} شاسيه · انقر للطباعة`;
    const cols = [
      ['#', (_r, i) => i + 1],
      ['VIN', (r) => `<button type="button" class="vin-ltr coord-vin" data-vin="${esc(r.vin)}">${esc(r.vin)}</button>`],
      ['Proforma', (r) => esc(na(r.raw.proformaDate))],
      ['Order', (r) => esc(na(r.raw.salesOrder))],
      ['Product', (r) => esc(na(r.raw.product))],
      ['Sales Type', (r) => esc(na(r.raw.salesType))],
      ['Customer', (r) => esc(na(r.raw.userName))],
      ['Invoice Owner', (r) => esc(na(r.raw.invoiceOwner))],
      ['Phone', (r) => (r.raw.phone ? `<a class="phone-link" href="tel:${esc(r.raw.phone)}">${esc(r.raw.phone)}</a>` : '—')],
      ['S/A', (r) => esc(na(r.raw.salesAdvisor))],
      ['GT Loc', (r) => esc(na(r.raw.gtLocation))],
      ['Veh Loc', (r) => esc(na(r.raw.vehicleLocation))],
      ['مدينة الترحيل', (r) => esc(na(r.ops && r.ops.transferCity))],
    ];
    table.innerHTML = `<thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead>
      <tbody>${list.map((r, i) => `<tr data-vin="${esc(r.vin)}">${cols.map((c) => `<td>${c[1](r, i)}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${cols.length}">لا توجد شاسيهات على Live Sheet</td></tr>`}</tbody>`;
    table.querySelectorAll('tr[data-vin], .coord-vin').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openDetail(el.dataset.vin);
      });
    });
  }

  function fill(id, val) {
    const el = $(id);
    if (el) el.value = val && String(val).trim() && val !== 'N/A' ? String(val) : '';
  }

  function toIsoDate(value) {
    const s = String(value || '').trim();
    if (!s || s === 'N/A') return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (dmy) {
      let y = Number(dmy[3]);
      if (y < 100) y += 2000;
      return `${y}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    }
    return '';
  }

  function getSaudiTodayIso() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
  }

  function getSaudiWeekdayIndex(isoDate) {
    const iso = String(isoDate || getSaudiTodayIso()).trim();
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Riyadh',
      weekday: 'short',
    }).format(new Date(`${iso}T12:00:00+03:00`));
    return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekday] ?? 0;
  }

  function arabicDayName(isoDate) {
    const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    return days[getSaudiWeekdayIndex(isoDate)];
  }

  function splitDateParts(value) {
    if (!value) return { d: '', m: '', y: '' };
    const s = String(value).trim();
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return { y: iso[1], m: iso[2], d: iso[3] };
    const dmy = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
    if (dmy) return { d: dmy[1], m: dmy[2], y: dmy[3] };
    return { d: '', m: '', y: '' };
  }

  function toArabicIndicDigits(s) {
    return String(s).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
  }

  function toHijriPartsFromIso(isoDate) {
    try {
      if (!isoDate) return { d: '', m: '', y: '' };
      const dt = new Date(`${String(isoDate).trim()}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return { d: '', m: '', y: '' };
      const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        numberingSystem: 'latn',
      });
      const parts = fmt.formatToParts(dt) || [];
      const get = (type) => parts.find((p) => p.type === type)?.value || '';
      return {
        d: toArabicIndicDigits(String(get('day')).padStart(2, '0')),
        m: toArabicIndicDigits(String(get('month')).padStart(2, '0')),
        y: toArabicIndicDigits(String(get('year'))),
      };
    } catch (_) {
      return { d: '', m: '', y: '' };
    }
  }

  function selectedAttendanceName() {
    const sel = $('customer_name');
    const opt = sel && sel.selectedOptions && sel.selectedOptions[0];
    return (opt && (opt.dataset.name || opt.textContent) || '').trim();
  }

  function companyLabel(company, available) {
    return `${company} — هناك ${available} متوفر`;
  }

  function renderAttendanceSelects(keepNameId) {
    const companyEl = $('company_rep');
    const nameEl = $('customer_name');
    const currentCompany = companyEl.value;
    companyEl.innerHTML = '<option value="">— اختر من الحضور —</option>'
      + attendanceCompanies.map((g) =>
        `<option value="${esc(g.company)}">${esc(companyLabel(g.company, g.available))}</option>`
      ).join('');
    if (currentCompany && attendanceCompanies.some((g) => g.company === currentCompany)) {
      companyEl.value = currentCompany;
    } else {
      companyEl.value = '';
    }
    renderAttendanceNames(keepNameId);
  }

  function renderAttendanceNames(keepNameId) {
    const nameEl = $('customer_name');
    const company = $('company_rep').value;
    const group = attendanceCompanies.find((g) => g.company === company);
    const people = (group && group.people) || [];
    const counts = {};
    people.forEach((p) => { counts[p.name] = (counts[p.name] || 0) + 1; });
    nameEl.innerHTML = '<option value="">— اختر الاسم من الحضور —</option>'
      + people.map((p) => {
        const extra = counts[p.name] > 1 && p.phone ? ` · ${p.phone}` : '';
        return `<option value="${esc(p.id)}" data-name="${esc(p.name)}">${esc(p.name)}${esc(extra)}</option>`;
      }).join('');
    if (keepNameId && people.some((p) => p.id === keepNameId)) nameEl.value = keepNameId;
    else nameEl.value = '';
  }

  function attendanceCity() {
    return String($('branch_to').value || '').trim();
  }

  async function loadAttendanceOptions(keepNameId) {
    if (isWarehouse()) return;
    lastAttendanceCity = attendanceCity();
    const q = lastAttendanceCity ? `?city=${encodeURIComponent(lastAttendanceCity)}` : '';
    const data = await api(`/attendance/available${q}`);
    attendanceCompanies = data.companies || [];
    renderAttendanceSelects(keepNameId || claimedAttendanceId);
    updatePreview();
  }

  async function holdAttendance(id) {
    if (!id) return;
    const data = await api('/attendance/hold', {
      method: 'POST',
      json: { id, city: attendanceCity() },
    });
    claimedAttendanceId = data.entry && data.entry.id || id;
    attendanceCompanies = data.companies || attendanceCompanies;
    renderAttendanceSelects(claimedAttendanceId);
    updatePreview();
  }

  async function releaseAttendanceHold() {
    if (!claimedAttendanceId) return;
    claimedAttendanceId = '';
    try {
      const data = await api('/attendance/release', {
        method: 'POST',
        json: { city: attendanceCity() },
      });
      attendanceCompanies = data.companies || attendanceCompanies;
    } catch (_) { /* ignore */ }
  }

  function onCityForAttendanceChanged() {
    if (isWarehouse()) return;
    clearTimeout(cityReloadTimer);
    cityReloadTimer = setTimeout(async () => {
      if (attendanceCity() === lastAttendanceCity) return;
      if (claimedAttendanceId) await releaseAttendanceHold();
      await loadAttendanceOptions();
    }, 250);
  }

  function setPrintStatus(msg, type) {
    const el = $('printStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status no-print' + (type ? ` ${type}` : '');
  }

  function buildCarRows() {
    const body = $('carsBody');
    body.innerHTML = AR_NUMS.map((n, i) => `
      <tr>
        <td class="row-no">${n}</td>
        <td><input name="car_model_${i}" data-field="model" data-row="${i}" aria-label="Model row ${i + 1}"></td>
        <td><input name="car_chassis_${i}" data-field="chassis" data-row="${i}" class="chassis-pick vin-ltr" placeholder="${i === 0 ? '' : 'انقر للاختيار'}" aria-label="Chassis row ${i + 1}" readonly></td>
        <td><input name="car_plate_${i}" data-field="plate" data-row="${i}" aria-label="Plate row ${i + 1}"></td>
        <td><input name="car_remarks_${i}" data-field="remarks" data-row="${i}" aria-label="Remarks row ${i + 1}"></td>
      </tr>
    `).join('');
    body.querySelectorAll('input').forEach((el) => {
      el.addEventListener('input', () => {
        syncCarCount();
        updatePreview();
      });
    });
    body.querySelectorAll('.chassis-pick').forEach((el) => {
      el.addEventListener('click', () => {
        const row = parseInt(el.dataset.row, 10);
        if (Number.isNaN(row)) return;
        if (printMode === 'manual') return;
        openAddVinPicker(row);
      });
    });
  }

  function getSelectedVins(exceptRow) {
    const form = $('deliveryForm');
    return AR_NUMS.map((_, i) => {
      if (i === exceptRow) return '';
      const el = form.querySelector(`[name="car_chassis_${i}"]`);
      return el && el.value ? el.value.trim().toUpperCase() : '';
    }).filter(Boolean);
  }

  function countFilledChassis() {
    const form = $('deliveryForm');
    return AR_NUMS.reduce((n, _x, i) => {
      const el = form.querySelector(`[name="car_chassis_${i}"]`);
      return n + (el && el.value.trim() ? 1 : 0);
    }, 0);
  }

  function syncCarCount() {
    const n = countFilledChassis();
    $('car_count').value = n ? String(n) : '';
  }

  function isWarehouse() {
    return printMode === 'warehouse';
  }

  function overlayPositionStyle(tag, x, y, w, h) {
    let left = `${x * 100}%`;
    const top = `${y * 100}%`;
    if (/^wh_chassis/.test(tag)) left = `${x * 100}%`;
    else if (/_chassis$/.test(tag)) left = `calc(${x * 100}% + 15.9mm)`;
    if (/_model$/.test(tag)) left = `calc(${x * 100}% + 4mm)`;
    if (/_plate$/.test(tag)) left = `calc(${x * 100}% + 10.6mm)`;
    return `left:${left};top:${top};width:${w * 100}%;height:${h * 100}%`;
  }

  function buildOverlay() {
    const overlayFields = $('overlayFields');
    const warehouse = isWarehouse() && typeof CHECK_NOTE_FIELDS !== 'undefined';
    const layout = warehouse ? CHECK_NOTE_FIELDS : (typeof MUTHAKARA_FIELDS !== 'undefined' ? MUTHAKARA_FIELDS : []);
    if (!overlayFields || !layout.length) return;
    Object.keys(fieldEls).forEach((k) => { delete fieldEls[k]; });
    let coverHtml = '';
    if (!warehouse) {
      const cover = typeof MEMO_NUMBER_COVER !== 'undefined' ? MEMO_NUMBER_COVER : [0.050, 0.122, 0.146, 0.036];
      const [cx, cy, cw, ch] = cover;
      coverHtml = `<div class="overlay-cover" aria-hidden="true" style="left:${cx * 100}%;top:${cy * 100}%;width:${cw * 100}%;height:${ch * 100}%"></div>`;
    }
    overlayFields.innerHTML = coverHtml + layout.map(([tag, x, y, w, h, align]) => {
      const dateCls = /^date_[dmy]$/.test(tag) ? ' overlay-field--header-date' : '';
      const invoiceCls = tag === 'invoice_number' ? ' overlay-field--invoice' : '';
      const chassisCls = /chassis/.test(tag) ? ' overlay-field--chassis' : '';
      const cls = `overlay-field align-${align || 'end'}${dateCls}${invoiceCls}${chassisCls}`;
      return `<div class="${cls}" data-tag="${tag}" style="${overlayPositionStyle(tag, x, y, w, h)}"></div>`;
    }).join('');
    overlayFields.querySelectorAll('.overlay-field').forEach((el) => {
      fieldEls[el.dataset.tag] = el;
    });
    overlayReady = true;
  }

  function collectPayload() {
    const form = $('deliveryForm');
    const fd = new FormData(form);
    const cars = AR_NUMS.map((_, i) => ({
      model: fd.get(`car_model_${i}`)?.trim() || '',
      chassis: fd.get(`car_chassis_${i}`)?.trim() || '',
      plate: fd.get(`car_plate_${i}`)?.trim() || '',
      remarks: fd.get(`car_remarks_${i}`)?.trim() || '',
    }));
    const filled = countFilledChassis();
    return {
      doc_date: fd.get('doc_date'),
      invoice_number: fd.get('invoice_number')?.trim(),
      dep_hour: fd.get('dep_hour')?.trim(),
      dep_minute: fd.get('dep_minute')?.trim(),
      customer_name: selectedAttendanceName() || fd.get('customer_name')?.trim(),
      company_rep: fd.get('company_rep')?.trim() || '',
      attendanceId: claimedAttendanceId,
      transfer_date: fd.get('transfer_date') || fd.get('doc_date'),
      corresponding_date: fd.get('corresponding_date') || fd.get('transfer_date') || fd.get('doc_date'),
      day_name: fd.get('day_name')?.trim(),
      trailer_number: fd.get('trailer_number')?.trim(),
      car_count: String(filled || fd.get('car_count')?.trim() || ''),
      branch_to: fd.get('branch_to')?.trim() || '',
      attachments: fd.get('attachments')?.trim(),
      warehouse: {
        owner_name: fd.get('wh_owner_name')?.trim(),
        user_name: fd.get('wh_user_name')?.trim(),
        user_phone: fd.get('wh_user_phone')?.trim(),
        user_id: fd.get('wh_user_id')?.trim(),
        print_date: fd.get('wh_print_date')?.trim(),
        print_time: fd.get('wh_print_time')?.trim(),
      },
      cars,
    };
  }

  function formatWhPrintDate(iso) {
    const s = String(iso || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
  }

  function formatWhPrintTime(value) {
    const raw = String(value || '').trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
      const parts = raw.split(':');
      return `${String(parts[0]).padStart(2, '0')}:${String(parts[1]).padStart(2, '0')}:${String(parts[2] || '00').padStart(2, '0')}`;
    }
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
    } catch (_) {
      return '';
    }
  }

  function buildCheckNoteOverlayData(body) {
    const wh = body.warehouse || {};
    const vins = [];
    const seen = new Set();
    (body.cars || []).forEach((c) => {
      const vin = String(c && c.chassis || '').trim().toUpperCase();
      if (!vin || seen.has(vin)) return;
      seen.add(vin);
      vins.push(vin);
    });
    const owner = wh.owner_name || body.customer_name || '';
    return {
      wh_owner_name: owner,
      wh_user_name: wh.user_name || '',
      wh_user_phone: wh.user_phone || '',
      wh_user_id: wh.user_id || '',
      wh_print_date: formatWhPrintDate(wh.print_date || body.doc_date || ''),
      wh_print_time: formatWhPrintTime(wh.print_time),
      wh_chassis: vins[0] || '',
      wh_chassis_2: vins[1] || '',
      wh_chassis_3: vins[2] || '',
      wh_chassis_4: vins[3] || '',
      wh_chassis_5: vins[4] || (vins.length > 5 ? `+${vins.length - 4} أخرى` : ''),
    };
  }

  function buildFlatData(body) {
    const docDate = splitDateParts(body.doc_date);
    const transferDate = splitDateParts(body.transfer_date || body.doc_date);
    const correspondingIso = body.corresponding_date || body.transfer_date || body.doc_date;
    const correspondingDate = splitDateParts(correspondingIso);
    const correspondingHijri = toHijriPartsFromIso(correspondingIso);
    const data = {
      date_d: docDate.d,
      date_m: docDate.m,
      date_y: docDate.y,
      invoice_number: body.invoice_number || '',
      dep_hour: body.dep_hour || '',
      dep_minute: body.dep_minute || '',
      customer_name: body.customer_name || '',
      company_rep: body.company_rep || '',
      transfer_d: transferDate.d,
      transfer_m: transferDate.m,
      transfer_y: transferDate.y,
      corresponding_d: correspondingHijri.d || correspondingDate.d,
      corresponding_m: correspondingHijri.m || correspondingDate.m,
      corresponding_y: correspondingHijri.y || correspondingDate.y,
      day_name: body.day_name || '',
      trailer_number: body.trailer_number || '',
      car_count: body.car_count || '',
      branch_to: body.branch_to || '',
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

  function updatePreview() {
    if (!overlayReady) buildOverlay();
    const payload = collectPayload();
    const data = isWarehouse() ? buildCheckNoteOverlayData(payload) : buildFlatData(payload);
    Object.keys(fieldEls).forEach((tag) => {
      fieldEls[tag].textContent = data[tag] || '';
    });
  }

  function setTodayDates() {
    const today = getSaudiTodayIso();
    $('doc_date').value = today;
    $('transfer_date').value = today;
    $('corresponding_date').value = today;
    $('day_name').value = arabicDayName(today);
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const hour = timeParts.find((p) => p.type === 'hour')?.value || '';
    const minute = timeParts.find((p) => p.type === 'minute')?.value || '';
    $('dep_hour').value = hour === '24' ? '00' : hour;
    $('dep_minute').value = minute;
    if ($('wh_print_date')) $('wh_print_date').value = today;
    if ($('wh_print_time')) {
      const now = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
      $('wh_print_time').value = now;
    }
    updatePreview();
  }

  function syncDayFromTransferDate() {
    const transfer = $('transfer_date').value || $('doc_date').value || getSaudiTodayIso();
    $('day_name').value = arabicDayName(transfer);
    updatePreview();
  }

  function validatePrintFields() {
    if (!countFilledChassis()) {
      setPrintStatus(isWarehouse() || printMode === 'manual' ? 'أدخل رقم الشاسيه قبل الطباعة' : 'لا يوجد رقم شاسيه للطباعة', 'err');
      return false;
    }
    if (isWarehouse()) return true;
    const company = String($('company_rep').value || '').trim();
    const branch = String($('branch_to').value || '').trim();
    const invoice = String($('invoice_number').value || '').trim();
    const attach = String($('attachments').value || '').trim();
    if (!invoice) {
      setPrintStatus('أدخل رقم الفاتورة قبل الطباعة', 'err');
      $('invoice_number').focus();
      return false;
    }
    if (!company) {
      setPrintStatus('اختر الشركة من الحضور قبل الطباعة', 'err');
      $('company_rep').focus();
      return false;
    }
    if (!selectedAttendanceName()) {
      setPrintStatus('اختر الاسم من الحضور قبل الطباعة', 'err');
      $('customer_name').focus();
      return false;
    }
    if (!branch) {
      setPrintStatus(
        printMode === 'manual' ? 'اختر الفرع / المدينة قبل الطباعة' : 'لا توجد مدينة ترحيل على Live Sheet لهذا الشاسيه',
        'err'
      );
      if (printMode === 'manual') $('branch_to').focus();
      return false;
    }
    if (printMode === 'manual' && attach !== 'صالة عرض' && attach !== 'تسليم') {
      setPrintStatus('اختر المرفق: صالة عرض أو تسليم', 'err');
      return false;
    }
    return true;
  }

  async function doPrintA4() {
    if (!validatePrintFields()) return;
    const printedVins = getSelectedVins();
    let invoiceNumber = '';
    if (!isWarehouse()) {
      try {
        const issued = await api('/print-invoice', { method: 'POST', json: { vin: printedVins[0] || '' } });
        invoiceNumber = String(issued.invoiceNumber || '');
        fill('invoice_number', invoiceNumber);
      } catch (err) {
        setPrintStatus(err.message || 'فشل إصدار رقم المذكرة', 'err');
        return;
      }
    }
    try {
      await api('/print-complete', {
        method: 'POST',
        json: {
          vins: printedVins,
          kind: isWarehouse() ? 'warehouse' : 'memo',
          attendanceId: isWarehouse() ? '' : claimedAttendanceId,
          company: isWarehouse() ? '' : String($('company_rep').value || '').trim(),
          city: isWarehouse() ? '' : attendanceCity(),
          invoiceNumber,
        },
      });
      if (!isWarehouse()) claimedAttendanceId = '';
    } catch (err) {
      setPrintStatus(err.message || 'فشل تحديث قائمة المنسق', 'err');
      return;
    }
    buildOverlay();
    updatePreview();
    const cleanupPrintCopies = () => {
      const existing = document.getElementById('printCopies');
      if (existing) existing.remove();
    };
    cleanupPrintCopies();
    const printSheet = $('printSheet');
    const copiesContainer = document.createElement('div');
    copiesContainer.id = 'printCopies';
    for (let i = 0; i < 3; i++) {
      const clone = printSheet.cloneNode(true);
      clone.classList.add('print-copy');
      clone.removeAttribute('id');
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      copiesContainer.appendChild(clone);
    }
    document.body.insertBefore(copiesContainer, document.body.firstChild);
    const finish = () => {
      cleanupPrintCopies();
      window.removeEventListener('afterprint', finish);
      setPrintMode('sheet');
      resetPrintForm();
      closeVinModal();
      const search = $('availableVinSearch');
      if (search) search.value = '';
      showView('workspace');
      loadWorkspace().catch(() => {});
    };
    const waitImages = Promise.all([...copiesContainer.querySelectorAll('img')].map((img) => (
      img.complete ? Promise.resolve() : new Promise((done) => {
        img.onload = () => done();
        img.onerror = () => done();
      })
    )));
    window.addEventListener('afterprint', finish);
    setPrintStatus('جاري فتح نافذة الطباعة — ٣ صفحات A4…', 'ok');
    waitImages.then(() => {
      requestAnimationFrame(() => window.print());
    });
  }

  function fillBranchList() {
    const list = $('branch-list');
    if (!list) return;
    list.innerHTML = transferCities.map((c) => `<option value="${esc(c)}"></option>`).join('');
  }

  function syncAttachmentChoice() {
    const picked = document.querySelector('input[name="attach_opt"]:checked');
    if (printMode === 'manual') fill('attachments', picked ? picked.value : '');
    updatePreview();
  }

  function setPrintMode(mode) {
    printMode = mode === 'manual' || mode === 'warehouse' ? mode : 'sheet';
    const manual = printMode === 'manual';
    const warehouse = printMode === 'warehouse';
    const branch = $('branch_to');
    const attach = $('attachments');
    const chassis0 = document.querySelector('[name="car_chassis_0"]');
    document.body.classList.toggle('warehouse-form-mode', warehouse);
    document.body.classList.toggle('manual-form-mode', manual);
    $('warehouseTopFields').classList.toggle('hidden', !warehouse);
    branch.readOnly = !manual;
    if (manual) branch.removeAttribute('readonly');
    else branch.setAttribute('readonly', '');
    $('branchReq').classList.toggle('hidden', !manual);
    $('attachReq').classList.toggle('hidden', !manual);
    attach.classList.toggle('hidden', manual);
    $('attachmentsManual').classList.toggle('hidden', !manual);
    document.querySelectorAll('#carsBody [data-field="chassis"]').forEach((el) => {
      const row = parseInt(el.dataset.row, 10);
      el.readOnly = !manual;
      el.placeholder = manual ? 'اكتب رقم الشاسية' : 'انقر للاختيار';
    });
    $('navTitle').textContent = warehouse ? 'التسليم في المستودع' : 'مذكرة ترحيل السيارات';
    $('printHeroTitle').textContent = warehouse ? 'قائمة فحص السيارات وقت التسليم' : 'مذكرة ترحيل السيارات';
    $('printHeroHint').textContent = warehouse
      ? 'نموذج المستودع · ابحث الشاسيه ثم راجع البيانات واطبع'
      : manual
        ? 'السيارة غير موجودة في البحث · اكتب الشركة والفرع يدوياً · المرفق صالة عرض أو تسليم'
        : 'اكتب اسم الشركة · الفرع من مدينة الترحيل على Live Sheet · رقم المذكرة تلقائي من 1000';
    $('carsHint').textContent = manual
      ? 'اكتب الموديل ورقم الشاسية يدوياً — بدون اختيار من Live Sheet'
      : 'انقر أي صف شاسيه لاختيار سيارة من Live Sheet';
    $('previewTitle').textContent = warehouse ? 'معاينة قائمة فحص التسليم' : 'معاينة مذكرة الترحيل';
    const img = $('previewFormImage');
    img.src = warehouse
      ? '../images/delivery-check-note-form.png'
      : '../images/muthakara-tarhil-form.png';
    img.alt = warehouse ? 'قائمة فحص السيارات وقت التسليم' : 'مذكرة ترحيل';
    $('btnPrint').textContent = warehouse ? '🖨 طباعة قائمة الفحص' : '🖨 طباعة A4';
    $('btnPrint2').textContent = warehouse ? '🖨 طباعة قائمة الفحص' : '🖨 طباعة A4';
    if (!manual) {
      document.querySelectorAll('input[name="attach_opt"]').forEach((el) => { el.checked = false; });
    }
    overlayReady = false;
    buildOverlay();
  }

  function resetPrintForm() {
    $('deliveryForm').reset();
    buildCarRows();
    setPrintStatus('');
  }

  async function peekInvoice() {
    try {
      const peek = await api('/print-invoice');
      fill('invoice_number', String(peek.next || 1000));
    } catch {
      fill('invoice_number', '1000');
    }
  }

  function fillTodayTimes() {
    const today = getSaudiTodayIso();
    fill('transfer_date', today);
    fill('corresponding_date', today);
    fill('day_name', arabicDayName(today));
    const timeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    $('dep_hour').value = (timeParts.find((p) => p.type === 'hour')?.value || '').replace('24', '00');
    $('dep_minute').value = timeParts.find((p) => p.type === 'minute')?.value || '';
    if ($('wh_print_date')) $('wh_print_date').value = today;
    if ($('wh_print_time')) {
      $('wh_print_time').value = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Riyadh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date());
    }
    return today;
  }

  function closeVinModal() {
    $('vinModal').classList.remove('open');
    activeVinRow = null;
  }

  function renderVinModal(query) {
    const q = String(query || '').trim().toUpperCase().replace(/\s+/g, '');
    const exclude = new Set(vinPickerMode === 'add-row' ? getSelectedVins(activeVinRow) : []);
    const list = rows.filter((r) => {
      const vin = String(r.vin || '').toUpperCase();
      if (exclude.has(vin)) return false;
      if (!q) return true;
      const hay = [
        r.vin,
        r.raw && r.raw.product,
        r.raw && r.raw.salesOrder,
        r.raw && r.raw.userName,
        r.raw && r.raw.phone,
      ].join(' ').toUpperCase().replace(/\s+/g, '');
      return hay.includes(q);
    });
    const grid = $('vinModalGrid');
    if (!list.length) {
      grid.innerHTML = '<p class="vin-empty">لا توجد شاسيهات من Live Sheet مطابقة</p>';
      return;
    }
    grid.innerHTML = list.map((r) => `
      <button type="button" class="vin-card" data-vin="${esc(r.vin)}">
        <div class="vin-no">${esc(r.vin)}</div>
        <div class="vin-product">${esc(r.raw.product || '—')}</div>
        <div class="vin-meta">${esc([r.raw.salesOrder, r.raw.userName, r.ops && r.ops.transferCity].filter(Boolean).join(' · ') || '—')}</div>
      </button>
    `).join('');
    grid.querySelectorAll('.vin-card').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (vinPickerMode === 'add-row') {
          applyPickedVin(btn.dataset.vin);
          return;
        }
        closeVinModal();
        openWarehouseDetail(btn.dataset.vin).catch((e) => alert(e.message));
      });
    });
  }

  function applyPickedVin(vin) {
    const row = rows.find((r) => String(r.vin || '').toUpperCase() === String(vin || '').toUpperCase());
    if (!row || activeVinRow == null) {
      closeVinModal();
      return;
    }
    const form = $('deliveryForm');
    const chassis = form.querySelector(`[name="car_chassis_${activeVinRow}"]`);
    const model = form.querySelector(`[name="car_model_${activeVinRow}"]`);
    if (chassis) chassis.value = row.vin;
    if (model) model.value = (row.raw && row.raw.product) || '';
    if (activeVinRow === 0 && printMode === 'sheet') {
      fill('branch_to', (row.ops && row.ops.transferCity) || '');
      loadAttendanceOptions().catch(() => {});
    }
    closeVinModal();
    syncCarCount();
    updatePreview();
  }

  function openAddVinPicker(rowIndex) {
    vinPickerMode = 'add-row';
    activeVinRow = rowIndex;
    $('vinModalTitle').textContent = 'أضف سيارة من Live Sheet';
    $('vinModalSearch').value = '';
    renderVinModal('');
    $('vinModal').classList.add('open');
    setTimeout(() => $('vinModalSearch').focus(), 40);
  }

  function openWarehouseSearch() {
    vinPickerMode = 'open-warehouse';
    activeVinRow = null;
    $('vinModalTitle').textContent = 'التسليم في المستودع — ابحث عن الشاسيه';
    $('vinModalSearch').value = '';
    renderVinModal('');
    $('vinModal').classList.add('open');
    setTimeout(() => $('vinModalSearch').focus(), 40);
  }

  async function openWarehouseDetail(vin) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    resetPrintForm();
    setPrintMode('warehouse');
    fill('doc_date', fillTodayTimes());
    fill('wh_owner_name', v.raw.invoiceOwner || v.raw.userName);
    fill('wh_user_name', v.raw.userName);
    fill('wh_user_phone', v.raw.phone);
    fill('wh_user_id', '');
    const form = $('deliveryForm');
    form.querySelector('[name="car_model_0"]').value = v.raw.product || '';
    form.querySelector('[name="car_chassis_0"]').value = v.vin || '';
    form.querySelector('[name="car_chassis_0"]').readOnly = true;
    syncCarCount();
    buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
  }

  async function openManualDetail() {
    resetPrintForm();
    setPrintMode('manual');
    fill('doc_date', fillTodayTimes());
    fill('company_rep', '');
    fill('customer_name', '');
    fill('branch_to', '');
    fill('attachments', '');
    claimedAttendanceId = '';
    await loadAttendanceOptions();
    await peekInvoice();
    syncCarCount();
    if (!overlayReady) buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
    $('company_rep').focus();
  }

  async function openDetail(vin) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    resetPrintForm();
    setPrintMode('sheet');
    const today = fillTodayTimes();
    const docDate = toIsoDate(v.raw.proformaDate) || today;
    fill('doc_date', docDate);
    fill('company_rep', '');
    fill('customer_name', '');
    fill('branch_to', (v.ops && v.ops.transferCity) || '');
    claimedAttendanceId = '';
    await loadAttendanceOptions();
    const form = $('deliveryForm');
    form.querySelector('[name="car_model_0"]').value = v.raw.product || '';
    form.querySelector('[name="car_chassis_0"]').value = v.vin || '';
    form.querySelector('[name="car_chassis_0"]').readOnly = true;
    await peekInvoice();
    syncCarCount();
    if (!overlayReady) buildOverlay();
    updatePreview();
    showView('detail');
    window.scrollTo(0, 0);
  }

  function bindPrintForm() {
    buildCarRows();
    buildOverlay();
    const form = $('deliveryForm');
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);
    $('transfer_date').addEventListener('change', syncDayFromTransferDate);
    $('doc_date').addEventListener('change', () => {
      if (!$('transfer_date').value) $('transfer_date').value = $('doc_date').value;
      syncDayFromTransferDate();
    });
    document.querySelectorAll('input[name="attach_opt"]').forEach((el) => {
      el.addEventListener('change', syncAttachmentChoice);
    });
    $('branch_to').addEventListener('change', onCityForAttendanceChanged);
    $('branch_to').addEventListener('input', onCityForAttendanceChanged);
    $('company_rep').addEventListener('change', async () => {
      if (claimedAttendanceId) await releaseAttendanceHold();
      renderAttendanceNames('');
      updatePreview();
    });
    $('customer_name').addEventListener('change', async () => {
      const id = $('customer_name').value;
      if (!id) {
        await releaseAttendanceHold();
        await loadAttendanceOptions();
        return;
      }
      try {
        await holdAttendance(id);
      } catch (err) {
        setPrintStatus(err.message || 'تعذر اختيار الاسم', 'err');
        await loadAttendanceOptions();
      }
    });
    $('btnPrint').addEventListener('click', doPrintA4);
    $('btnPrint2').addEventListener('click', doPrintA4);
    $('btnToday').addEventListener('click', setTodayDates);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      doPrintA4();
    });
  }

  async function boot() {
    const meta = await api('/meta');
    transferCities = meta.transferCities || [];
    fillBranchList();
    const users = (meta.users || []).filter((u) => u.role === 'coordinator');
    $('loginUser').innerHTML = '<option value="">— اختر الاسم —</option>'
      + users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');

    $('btnLogin').addEventListener('click', login);
    $('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('btnLogout').addEventListener('click', logout);
    $('btnBackWorkspace').addEventListener('click', () => {
      releaseAttendanceHold().finally(() => {
        setPrintMode('sheet');
        showView('workspace');
        loadWorkspace().catch(() => {});
      });
    });
    $('brandHome').addEventListener('click', (e) => {
      e.preventDefault();
      releaseAttendanceHold().finally(() => {
        setPrintMode('sheet');
        showView('workspace');
      });
    });
    $('availableVinSearch').addEventListener('input', filterFleet);
    $('btnMissingVin').addEventListener('click', () => openManualDetail().catch((e) => alert(e.message)));
    $('btnMissingVinEmpty').addEventListener('click', () => openManualDetail().catch((e) => alert(e.message)));
    $('btnWarehouse').addEventListener('click', () => {
      if (!rows.length) loadWorkspace().then(openWarehouseSearch).catch((e) => alert(e.message));
      else openWarehouseSearch();
    });
    $('vinModalClose').addEventListener('click', closeVinModal);
    $('vinModal').addEventListener('click', (e) => { if (e.target === $('vinModal')) closeVinModal(); });
    $('vinModalSearch').addEventListener('input', () => renderVinModal($('vinModalSearch').value));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('vinModal').classList.contains('open')) closeVinModal();
    });
    bindPrintForm();

    if (getToken() && getUser()) {
      try {
        const me = await api('/auth/me');
        if (me.user.role !== 'coordinator' && me.user.role !== 'admin') {
          showView('login');
          return;
        }
        enterApp(me.user);
        return;
      } catch {
        clearSession();
      }
    }
    showView('login');
  }

  boot().catch((e) => { $('loginStatus').textContent = e.message; });
})();
