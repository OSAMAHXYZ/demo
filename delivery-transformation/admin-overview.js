(function () {
  const DELIVERED = new Set(['تم التسليم', 'Claimed', 'تسليم متقدم']);
  const CANCELLED = new Set(['الغاء']);
  const { api, esc, downloadFile, toast } = window.DTX || {};
  if (!api) return;

  function ymNow() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit' }).format(new Date());
  }
  function shiftMonth(ym, delta) {
    const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return ymNow();
    const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function monthOf(v) {
    const d = String((v && v.raw && v.raw.proformaDate) || '').trim();
    const hit = d.match(/^(\d{4}-\d{2})/);
    return hit ? hit[1] : '';
  }
  function bucket(status) {
    const s = String(status || '').trim();
    if (DELIVERED.has(s)) return 'delivered';
    if (CANCELLED.has(s)) return 'cancelled';
    return 'notDelivered';
  }

  let month = ymNow();

  function countsFor(list) {
    const rows = list || [];
    let delivered = 0;
    let notDelivered = 0;
    let cancelled = 0;
    rows.forEach((v) => {
      const b = bucket(v.ops && v.ops.opsStatus);
      if (b === 'delivered') delivered += 1;
      else if (b === 'cancelled') cancelled += 1;
      else notDelivered += 1;
    });
    return { cars: rows.length, delivered, notDelivered, cancelled };
  }

  async function loadOverview() {
    const label = document.getElementById('ov-month');
    if (label) label.textContent = month;
    const data = await api('/admin/overview');
    const all = data.vehicles || [];
    const rows = all.filter((v) => monthOf(v) === month);
    const c = countsFor(rows);
    const set = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = String(n); };
    set('ov-cars', c.cars);
    set('ov-delivered', c.delivered);
    set('ov-open', c.notDelivered);
    set('ov-cancel', c.cancelled);
    const check = document.getElementById('ov-check');
    if (check) {
      const ok = c.cars === c.delivered + c.notDelivered + c.cancelled;
      check.textContent = ok
        ? 'Cars = Delivered + Not delivered + cancelled · OK'
        : 'Cars count does not match the three groups';
      check.classList.toggle('is-bad', !ok);
    }
  }

  async function loadArchive() {
    const tbody = document.getElementById('arch-body');
    const msg = document.getElementById('arch-msg');
    if (!tbody) return;
    try {
      const data = await api('/archive');
      const months = data.months || [];
      tbody.innerHTML = months.length
        ? months.map((row) => `<tr>
            <td>${esc(row.month)}</td>
            <td>${esc((row.savedAt || '').replace('T', ' ').slice(0, 16))}</td>
            <td>${esc(row.savedBy || '')}</td>
            <td>${row.locked ? 'Locked' : 'Open'}</td>
            <td>${esc(row.counts && row.counts.cars != null ? row.counts.cars : '')}</td>
            <td><button type="button" class="btn" data-xlsx="${esc(row.month)}">Extract Excel</button></td>
          </tr>`).join('')
        : '<tr><td colspan="6">No snapshots yet. Save snapshot now.</td></tr>';
      tbody.querySelectorAll('[data-xlsx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ym = btn.getAttribute('data-xlsx');
          downloadFile(`/archive/${ym}/xlsx`, `DT-Month-${ym}.xlsx`).then(() => {
            if (toast) toast('Excel downloaded');
          }).catch((err) => {
            if (msg) msg.textContent = err.message || 'Download failed';
          });
        });
      });
      if (msg) msg.textContent = months.length ? `${months.length} month(s)` : '';
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6">${esc(err.message || 'Could not load archive')}</td></tr>`;
    }
  }

  async function saveNow() {
    const msg = document.getElementById('arch-msg');
    try {
      await api(`/archive/${month}/save`, { method: 'POST', json: {} });
      if (toast) toast(`Saved snapshot · ${month}`);
      if (msg) msg.textContent = `Saved ${month}`;
      await loadArchive();
    } catch (err) {
      if (msg) msg.textContent = err.message || 'Could not save';
    }
  }

  function bind() {
    const prev = document.getElementById('ov-prev');
    const next = document.getElementById('ov-next');
    if (prev) prev.addEventListener('click', () => { month = shiftMonth(month, -1); loadOverview().catch(() => {}); });
    if (next) next.addEventListener('click', () => { month = shiftMonth(month, 1); loadOverview().catch(() => {}); });
    const save = document.getElementById('arch-save');
    if (save) save.addEventListener('click', () => saveNow());
    const extract = document.getElementById('arch-extract');
    if (extract) extract.addEventListener('click', () => {
      downloadFile(`/archive/${month}/xlsx`, `DT-Month-${month}.xlsx`).catch((err) => {
        const msg = document.getElementById('arch-msg');
        if (msg) msg.textContent = err.message || 'Download failed';
      });
    });
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab === 'overview') loadOverview().catch(() => {});
        if (btn.dataset.tab === 'archive') loadArchive().catch(() => {});
      });
    });
  }

  window.DTOverview = { load: loadOverview, loadArchive, saveNow };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
