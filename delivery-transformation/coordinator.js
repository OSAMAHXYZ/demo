/* Delivery Transformation coordinator — Delivery_pdf workspace + read-only VIN details */
(() => {
  const { api, esc, na, getToken, getUser, setSession, clearSession } = window.DTX;

  const $ = (id) => document.getElementById(id);
  let rows = [];
  let poll = null;

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
    poll = setInterval(() => loadWorkspace({ silent: true }).catch(() => {}), 15000);
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
    return `<button type="button" class="fleet-card fleet-card--actionable" data-vin="${esc(r.vin)}" data-product="${esc(product)}" data-company="${esc(type)}">
      <div class="fc-body">
        <div class="fc-vin">${esc(r.vin)}</div>
        <div class="fc-product">${esc(product)}</div>
        <div class="fc-meta">${[r.raw.salesOrder ? `طلب ${r.raw.salesOrder}` : '', loc].filter(Boolean).join(' · ') || '—'}</div>
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
      const hay = [card.dataset.vin, card.dataset.product, card.dataset.company]
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
      availEl.innerHTML = groupBySalesType(rows).map(([type, items]) => {
        const expand = items.length > 8
          ? '<button type="button" class="fleet-expand-btn" data-expand>عرض الكل</button>' : '';
        return `<div class="fleet-company-group">
          <div class="fleet-company-head">
            <div class="fleet-company-name">${esc(type)}<span class="fleet-company-badge">نوع البيع</span></div>
            <div style="display:flex;align-items:center;gap:8px">
              ${expand}
              <div class="fleet-company-count">${items.length} سيارة</div>
            </div>
          </div>
          <div class="fleet-grid">${items.map(fleetCard).join('')}</div>
        </div>`;
      }).join('');
      availEl.querySelectorAll('[data-expand]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const group = btn.closest('.fleet-company-group');
          const open = group.classList.toggle('is-expanded');
          btn.textContent = open ? 'طي القائمة' : 'عرض الكل';
        });
      });
      availEl.querySelectorAll('.fleet-card').forEach((card) => {
        card.addEventListener('click', () => openDetail(card.dataset.vin));
      });
    }
    filterFleet();
  }

  function fill(id, val) {
    const el = $(id);
    if (el) el.value = val && String(val).trim() && val !== 'N/A' ? String(val) : '';
  }

  function previewRow(label, value) {
    const v = na(value);
    return `<div class="preview-row"><span>${esc(label)}</span><b>${esc(v)}</b></div>`;
  }

  async function openDetail(vin) {
    const { vehicle: v } = await api(`/vehicles/${encodeURIComponent(vin)}`);
    fill('doc_date', v.raw.proformaDate);
    fill('invoice_number', v.raw.salesOrder);
    fill('sales_type', v.raw.salesType);
    fill('sales_advisor', v.raw.salesAdvisor);
    fill('company_rep', v.raw.invoiceOwner);
    fill('customer_name', v.raw.userName);
    fill('phone', v.raw.phone);
    fill('gt_location', v.raw.gtLocation);
    fill('vehicle_location', v.raw.vehicleLocation);
    fill('invoice_date', v.raw.invoiceDate);
    $('carsBody').innerHTML = `<tr>
      <td>١</td>
      <td>${esc(na(v.raw.product))}</td>
      <td class="vin-ltr">${esc(v.vin)}</td>
      <td>${esc(na(v.raw.salesOrder))}</td>
      <td>${esc(na(v.raw.salesType))}</td>
    </tr>`;
    $('previewRows').innerHTML = [
      previewRow('الشاسية', v.vin),
      previewRow('الموديل', v.raw.product),
      previewRow('الطلب', v.raw.salesOrder),
      previewRow('نوع البيع', v.raw.salesType),
      previewRow('العميل', v.raw.userName),
      previewRow('مالك الفاتورة', v.raw.invoiceOwner),
      previewRow('الهاتف', v.raw.phone),
      previewRow('موقع GT', v.raw.gtLocation),
      previewRow('موقع المركبة', v.raw.vehicleLocation),
      previewRow('البروفورما', v.raw.proformaDate),
    ].join('');
    showView('detail');
  }

  async function boot() {
    const meta = await api('/meta');
    const users = (meta.users || []).filter((u) => u.role === 'coordinator' || u.role === 'admin');
    $('loginUser').innerHTML = '<option value="">— اختر الاسم —</option>'
      + users.map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');

    $('btnLogin').addEventListener('click', login);
    $('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
    $('btnLogout').addEventListener('click', logout);
    $('btnBackWorkspace').addEventListener('click', () => {
      showView('workspace');
      loadWorkspace().catch(() => {});
    });
    $('brandHome').addEventListener('click', (e) => {
      e.preventDefault();
      showView('workspace');
    });
    $('availableVinSearch').addEventListener('input', filterFleet);

    if (getToken() && getUser()) {
      try {
        const me = await api('/auth/me');
        if (me.user.role !== 'coordinator' && me.user.role !== 'admin') {
          location.href = 'index.html';
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
