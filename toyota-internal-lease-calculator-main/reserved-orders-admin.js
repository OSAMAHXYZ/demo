(function () {
    const STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
    const passKey = 'reserved-orders-admin-pass';
    let orders = [];
    let staff = [];
    let archive = [];
    let audit = [];
    let report = {};
    let alerts = [];
    let alertFields = [];
    let alertProducts = [];
    const BO_ERRORS = [
        ['dup_col_f', 'Duplicate Back Order Number'],
        ['missing_col_j', 'Paid amount missing on CAMRY, LC300, or LC70'],
        ['paid_other_product', 'Paid amount filled on another product'],
        ['sales_type_not_confirmed', 'ALJUF or Bank is not Confirmed'],
        ['rav4_nop_040', 'RAV4 exterior color is 040'],
        ['rav4_sh_forbidden_color', 'RAV4 SH forbidden exterior color'],
        ['rav4_other_sfx_qrs_20', 'RAV4 interior color is 20'],
        ['dup_ship_to', 'Duplicate Ship to Party'],
        ['col_ab_aljre_or_blank', 'Column AB blank or ALJRe'],
        ['camry_nop_00_20', 'CAMRY exterior color is 00 or 20'],
        ['lc300_nop_00_20', 'LC300 exterior color is 00 or 20'],
        ['veloz_nop_s28', 'VELOZ exterior color is S28'],
        ['crown_qrs_20', 'CROWN interior color is 20'],
        ['bad_model_year', 'Model Year is not 2026'],
        ['phone_empty', 'Phone is empty']
    ];
    let editing = '';
    let marketingRequests = [];
    const ALERT_OPS = { equals: 'equals', not_equals: 'does not equal', contains: 'contains', not_contains: 'does not contain', gt: 'greater than', lt: 'less than', empty: 'is empty', not_empty: 'is not empty' };

    const $ = (id) => document.getElementById(id);
    function password() { return sessionStorage.getItem(passKey) || ''; }
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
    function parseLocal(value) {
        const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    function remain(order) {
        const end = parseLocal(order.deadline);
        if (!end) return 'NO ASSIGN DATE';
        const ms = end.getTime() - Date.now();
        if (ms <= 0) return 'EXPIRED';
        const total = Math.floor(ms / 1000);
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    }
    async function api(url, options) {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) { sessionStorage.removeItem(passKey); showGate('Admin password was not accepted.'); throw new Error('unauthorized'); }
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }
    function showGate(message) { $('gate').classList.remove('hidden'); $('admin-app').classList.add('hidden'); $('gate-error').textContent = message || ''; }
    function showApp() { $('gate').classList.add('hidden'); $('admin-app').classList.remove('hidden'); }
    function showPanel(name) {
        document.querySelectorAll('[id^="panel-"]').forEach((panel) => panel.classList.toggle('hidden', panel.id !== 'panel-' + name));
        document.querySelectorAll('#admin-nav button').forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
    }

    // ---- Sales type analysis (column U) · display only ----
    // Names shown under each code. Fill these in to match your codes, e.g. '01': 'Cash'.
    const SALES_TYPE_NAMES = { '01': '', '13': '', '07': '', '08': '' };
    const SALES_TYPE_ORDER = ['01', '13', '07', '08'];
    // Sales types whose cars show the reservation expiry (the deadline the server already sends).
    const EXPIRY_TYPES = new Set(['01']);
    const SHEET_NAMES = { F: 'Order', I: 'Model', J: 'Suffix', K: 'Model year', L: 'VIN', M: 'Ext', N: 'Int', R: 'Vehicle status', S: 'Customer', T: 'Salesman', U: 'Sales type' };
    let salesTypePick = null; // nothing listed until a card is clicked
    let showNoVinRows = false;
    function fieldOf(order, col) {
        const field = (order.fields || []).find((item) => item.col === col || item.label === col);
        return field && field.value != null ? String(field.value).trim() : '';
    }
    function salesTypeOf(order) {
        const raw = fieldOf(order, 'U');
        if (!raw) return '';
        return /^\d$/.test(raw) ? '0' + raw : raw;
    }
    function hasVin(order) {
        const vin = String(order.vin || fieldOf(order, 'L') || '').trim();
        return /^[A-Z0-9]{10,20}$/i.test(vin);
    }
    function carRows() { return orders.filter(hasVin); }
    function expiryText(order) {
        const end = parseLocal(order.deadline);
        if (!end) return 'No assign date';
        return end.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function expiryCells(order) {
        if (!EXPIRY_TYPES.has(salesTypeOf(order))) return '<td class="st-na">—</td><td class="st-na">—</td>';
        return `<td>${esc(expiryText(order))}</td><td class="timer-cell st-timer" data-deadline="${esc(order.deadline || '')}">${esc(remain(order))}</td>`;
    }
    function renderSalesTypes() {
        const cardsBox = $('st-cards');
        if (!cardsBox) return;
        const cars = carRows();
        const counts = {};
        cars.forEach((order) => { const key = salesTypeOf(order) || 'blank'; counts[key] = (counts[key] || 0) + 1; });
        const extra = Object.keys(counts).filter((key) => !SALES_TYPE_ORDER.includes(key)).sort();
        const keys = SALES_TYPE_ORDER.concat(extra);
        const total = cars.length;
        const expired = cars.filter((order) => EXPIRY_TYPES.has(salesTypeOf(order)) && remain(order) === 'EXPIRED').length;
        $('st-meta').textContent = `${total} cars with a VIN in the live sheet · column U` + (expired ? ` · ${expired} reservation${expired === 1 ? '' : 's'} expired` : '');
        const card = (key, label, name, value, tone) => {
            const share = total ? Math.round((value / total) * 100) : 0;
            return `<button type="button" class="st-card ${tone}${salesTypePick === key ? ' is-on' : ''}" data-st="${esc(key)}">
                <span class="st-code">${esc(label)}</span>
                <span class="st-name">${esc(name)}</span>
                <strong>${value}</strong>
                <span class="st-share"><i style="width:${share}%"></i></span>
                <em>${share}% of cars</em>
            </button>`;
        };
        const tones = { '01': 't-red', '13': 't-blue', '07': 't-violet', '08': 't-teal' };
        cardsBox.innerHTML = card('', 'Total', 'All sales types', total, 't-total')
            + keys.map((key) => card(key, key === 'blank' ? 'Blank' : key, key === 'blank' ? 'No sales type' : (SALES_TYPE_NAMES[key] || 'Sales type ' + key) + (EXPIRY_TYPES.has(key) ? ' · has expiry' : ''), counts[key] || 0, tones[key] || 't-grey')).join('');
        renderSalesTypeDetail();
    }
    function renderSalesTypeDetail() {
        const box = $('st-detail');
        if (!box) return;
        if (salesTypePick == null) { box.innerHTML = ''; return; }
        const list = carRows()
            .filter((order) => !salesTypePick || (salesTypeOf(order) || 'blank') === salesTypePick)
            .sort((a, b) => (a.queueNumber || 0) - (b.queueNumber || 0));
        const title = salesTypePick === '' ? 'All cars' : salesTypePick === 'blank' ? 'Cars with no sales type' : `Sales type ${salesTypePick}${SALES_TYPE_NAMES[salesTypePick] ? ' · ' + SALES_TYPE_NAMES[salesTypePick] : ''}`;
        box.innerHTML = `<div class="st-detail-head"><h3>${esc(title)}</h3><span>${list.length} car${list.length === 1 ? '' : 's'}</span></div>
            <div class="st-table"><table><thead><tr><th>Queue</th><th>Status</th><th>Type</th><th>Order</th><th>VIN</th><th>Model</th><th>Customer</th><th>Salesman</th><th>Expiry</th><th>Time left</th></tr></thead><tbody>${
            list.map((order) => `<tr data-open="${esc(order.key)}" class="st-row">
                <td><span class="q-pill">#${order.queueNumber == null ? '—' : order.queueNumber}</span></td>
                <td>${statusPill(order.status)}</td>
                <td><span class="st-type">${esc(salesTypeOf(order) || '—')}</span></td>
                <td>${esc(order.orderNumber || fieldOf(order, 'F') || '—')}</td>
                <td class="mono">${esc(order.vin || fieldOf(order, 'L') || '—')}</td>
                <td>${esc(fieldOf(order, 'I') || order.vehicle || '—')}</td>
                <td>${esc(fieldOf(order, 'S') || order.customerName || '—')}</td>
                <td>${esc(fieldOf(order, 'T') || order.salesAdvisor || '—')}</td>
                ${expiryCells(order)}
            </tr>`).join('') || '<tr><td colspan="10" class="st-na">No cars</td></tr>'
            }</tbody></table></div>`;
    }
    function statusPill(status) {
        const value = String(status || '').trim();
        const tone = value === 'الغاء' ? 'is-bad' : value === 'تم الفوترة' ? 'is-ok' : value === 'محجوز' ? 'is-hold' : value ? 'is-info' : 'is-none';
        return `<span class="s-pill ${tone}">${esc(value || '—')}</span>`;
    }

    function renderOverview() {
        const activeStaff = staff.filter((person) => person.active).length;
        const today = audit.filter((event) => String(event.at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
        $('admin-kpis').innerHTML = [
            ['Current orders', orders.length], ['Archived versions', archive.length], ['Audit events', audit.length],
            ['Employees', staff.length], ['Active employees', activeStaff], ["Today's changes", today]
        ].map(([label, value]) => `<article class="kpi"><em>${label}</em><strong>${value}</strong></article>`).join('');
        const pay = report.paymentBreakdown || {};
        const max = Math.max(1, pay.cash || 0, pay.bank || 0, pay.other || 0, pay.unknown || 0);
        $('pay-bars').innerHTML = ['cash', 'bank', 'other', 'unknown'].map((key) => {
            const value = pay[key] || 0;
            return `<div class="bar"><span>${key}</span><i style="width:${Math.round(value / max * 100)}%"></i><b>${value}</b></div>`;
        }).join('');
        renderSalesTypes();
    }
    function renderOrders() {
        const q = $('admin-search').value.trim().toLowerCase();
        const status = $('admin-status').value;
        const payment = $('admin-payment').value;
        const expiredOnly = $('admin-expired').value === 'expired';
        const rows = orders.filter((order) => {
            if (q && ![order.vin, order.orderNumber, order.salesAdvisor, order.customerName].join(' ').toLowerCase().includes(q)) return false;
            if (status && order.status !== status) return false;
            if (payment && order.paymentKind !== payment) return false;
            if (expiredOnly && remain(order) !== 'EXPIRED') return false;
            return true;
        }).sort((a, b) => (a.queueNumber || 0) - (b.queueNumber || 0));
        $('admin-rows').innerHTML = rows.map((order) => `<tr>
            <td>#${order.queueNumber == null ? '—' : order.queueNumber}</td>
            <td>${esc(order.orderNumber || 'NO ORDER')}</td>
            <td>${esc(order.vin || 'VIN NOT FOUND')}</td>
            <td>${esc(order.salesAdvisor || 'UNASSIGNED')}</td>
            <td>${esc(order.paymentLabel || 'UNKNOWN')}</td>
            <td>${esc(order.status || '')}</td>
            <td class="timer-cell" data-deadline="${esc(order.deadline || '')}">${esc(remain(order))}</td>
            <td><button class="ghost" type="button" data-open="${esc(order.key)}">View</button></td>
        </tr>`).join('');
    }
    function openOrder(key) {
        const order = orders.find((item) => item.key === key);
        if (!order) return;
        const history = (order.history || []).map((item) => `<div><b>${esc(item.changedDisplay || item.changedAt)}</b><br>${esc(item.oldStatus || '')} → ${esc(item.status)} · ${esc(item.changedBy)} · ${esc(item.employeeNumber || '')}</div>`).join('') || '<div>No status changes yet</div>';
        const related = audit.filter((event) => event.vin === order.vin || event.orderNumber === order.orderNumber).slice(0, 30);
        $('drawer').classList.remove('hidden');
        $('drawer').innerHTML = `<button class="ghost" id="close-drawer" type="button">Close</button>
            <h2>Order #${esc(order.orderNumber || 'NO ORDER')}</h2>
            <p>${esc(order.vin)} · ${esc(order.vehicle || '')}<br>Status ${esc(order.status)} · Queue #${order.queueNumber == null ? '—' : order.queueNumber}<br>Deadline ${esc(order.deadline || 'NO ASSIGN DATE')}</p>
            <h3>Status history</h3>${history}
            <h3>Audit</h3>${related.map((event) => `<div>${esc(event.display || event.at)} · ${esc(event.action)} · ${esc(event.user)}</div>`).join('') || '<div>No audit events</div>'}`;
        $('close-drawer').addEventListener('click', () => $('drawer').classList.add('hidden'));
    }
    function renderStaff() {
        $('staff-list').innerHTML = '<h2>Employees</h2>' + staff.map((person) => `<div class="staff-row" style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #e6e8ee;">
            <div><b>${esc(person.name)}</b><br>ID ${esc(person.id)} · ${esc(person.role)} · ${person.active ? 'Active' : 'Inactive'}</div>
            <button class="ghost" type="button" data-edit="${esc(person.recordId)}">Edit</button>
        </div>`).join('');
    }
    function renderArchive() {
        $('archive-rows').innerHTML = archive.slice().reverse().map((item) => `<tr>
            <td>${esc(item.version)}</td><td>${esc(item.display || item.at)}</td><td>${esc(item.uploadedBy)}</td>
            <td>${esc(item.esalesName)}</td><td>${esc(item.boName)}</td><td>${item.reservedOrders || 0}</td>
            <td>${item.matched || 0}</td><td>${item.unmatched || 0}</td>
            <td><button class="ghost" type="button" data-version="${esc(item.version)}">View</button></td>
        </tr>`).join('');
    }
    function renderAudit() {
        const q = $('audit-q').value.trim().toLowerCase();
        const employee = $('audit-employee').value.trim().toLowerCase();
        const action = $('audit-action').value;
        const rows = audit.filter((event) => {
            if (action && event.action !== action) return false;
            if (employee && !`${event.user} ${event.employeeNumber}`.toLowerCase().includes(employee)) return false;
            if (q && !JSON.stringify(event).toLowerCase().includes(q)) return false;
            return true;
        });
        $('audit-rows').innerHTML = rows.map((event) => `<tr>
            <td>${esc(event.display || event.at)}</td><td>${esc(event.user)}<br>${esc(event.employeeNumber)}</td>
            <td>${esc(event.role)}</td><td>${esc(event.action)}</td><td>${esc(event.vin)}</td><td>${esc(event.orderNumber)}</td>
            <td>${esc(event.oldValue)}</td><td>${esc(event.newValue)}</td>
            <td><button class="ghost" type="button" data-audit="${esc(event.at)}">View</button></td>
        </tr>`).join('');
    }
    function renderReport() {
        $('report-body').innerHTML = `<h2>Latest push</h2><p>Reserved VINs ${report.reservedVinCount || 0}<br>Matched ${report.matchedOrders || 0}<br>Unmatched ${report.unmatchedVins || 0}<br>Advisors ${report.salesAdvisorCount || 0}<br>Earliest ${esc(report.earliestAssignDate || '—')}<br>Latest ${esc(report.latestAssignDate || '—')}</p>`;
    }
    function fillAlertFields() {
        const select = $('alert-field');
        if (!select) return;
        const current = select.value;
        select.innerHTML = '<option value="">Choose a BO column</option>' + alertFields.map((field) => `<option value="${esc(field.name)}">${esc(field.name)}</option>`).join('');
        if (current) select.value = current;
        fillAlertValues();
    }
    function fillAlertValues() {
        const field = alertFields.find((item) => item.name === $('alert-field').value);
        $('alert-values').innerHTML = ((field && field.samples) || []).map((value) => `<option value="${esc(value)}"></option>`).join('');
    }
    function fillErrorAlertForm() {
        const type = $('error-alert-type');
        const currentType = type.value;
        type.innerHTML = '<option value="">Choose a BO error</option>' + BO_ERRORS.map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
        if (currentType) type.value = currentType;
        const car = $('error-alert-car');
        const currentCar = car.value;
        car.innerHTML = '<option value="">All cars</option>' + alertProducts.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join('');
        if (currentCar) car.value = currentCar;
    }
    function alertRuleText(rule) {
        if (rule.kind === 'bo_error') {
            const label = rule.errorLabel || (BO_ERRORS.find((item) => item[0] === rule.errorId) || [])[1] || rule.errorId;
            return `BO error · ${label}${rule.product ? ' · ' + rule.product : ' · All cars'}`;
        }
        return `${rule.field} ${ALERT_OPS[rule.operator] || rule.operator} ${rule.operator === 'empty' || rule.operator === 'not_empty' ? '' : rule.value}`;
    }
    function renderAlerts() {
        if (!$('alert-list')) return;
        $('alert-list').innerHTML = `<h2>Alerts employees can see</h2>` + (alerts.length ? alerts.map((rule) => `<article class="panel" style="margin-bottom:10px;">
            <b>${esc(rule.message)}</b>
            <p>${esc(alertRuleText(rule))}</p>
            <p>${rule.kind === 'bo_error' ? 'Message Builder' : 'BO lookup'} · ${esc(rule.tone)} · ${rule.active === false ? 'Off' : 'Active'}</p>
            <button class="ghost" type="button" data-alert-off="${esc(rule.id)}">${rule.active === false ? 'Enable' : 'Disable'}</button>
            <button class="ghost" type="button" data-alert-del="${esc(rule.id)}">Delete</button>
        </article>`).join('') : '<p>No alerts yet. Add one for a BO error, or from a Back Order column.</p>');
    }
    async function saveAlertList(next) {
        const data = await api('/api/reserved-orders/alerts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password(), alerts: next })
        });
        alerts = data.alerts || [];
        renderAlerts();
    }
    function sheetColumns(list) {
        const cols = [];
        const seen = new Set();
        function add(label) {
            const name = String(label || '').trim();
            if (!name || seen.has(name)) return;
            seen.add(name);
            cols.push(name);
        }
        ['Queue', 'Status', 'Updated by', 'Updated at'].forEach(add);
        list.forEach((order) => (order.fields || []).forEach((field) => add(field.label || field.col)));
        if (cols.length === 4) ['Order', 'VIN', 'Advisor', 'Payment', 'Deadline'].forEach(add);
        return cols;
    }
    function sheetValue(order, label) {
        if (label === 'Queue') return order.queueNumber == null ? '' : String(order.queueNumber);
        if (label === 'Status') return order.status || '';
        if (label === 'Updated by') return order.statusChangedBy || '';
        if (label === 'Updated at') return order.statusChangedAt ? (parseLocal(order.statusChangedAt) ? parseLocal(order.statusChangedAt).toLocaleString() : order.statusChangedAt) : '';
        if (label === 'Order') return order.orderNumber || '';
        if (label === 'VIN') return order.vin || '';
        if (label === 'Advisor') return order.salesAdvisor || '';
        if (label === 'Payment') return order.paymentLabel || '';
        if (label === 'Deadline') return order.deadline || '';
        const field = (order.fields || []).find((item) => (item.label || item.col) === label);
        return field && field.value != null ? String(field.value) : '';
    }
    function renderSheet() {
        const box = $('live-sheet');
        if (!box) return;
        const needle = ($('sheet-search') && $('sheet-search').value || '').trim().toLowerCase();
        const cols = sheetColumns(orders);
        const noVin = orders.filter((order) => !hasVin(order)).length;
        const source = showNoVinRows ? orders : orders.filter(hasVin);
        const rows = source.filter((order) => !needle || cols.some((label) => sheetValue(order, label).toLowerCase().includes(needle)));
        const head = (label) => SHEET_NAMES[label] ? `<th title="Column ${esc(label)}"><span class="col-letter">${esc(label)}</span>${esc(SHEET_NAMES[label])}</th>` : `<th>${esc(label)}</th>`;
        const cell = (order, label) => {
            const value = sheetValue(order, label);
            if (label === 'Status') return `<td class="col-status">${statusPill(value)}</td>`;
            if (label === 'Queue') return `<td class="col-queue">${value ? `<span class="q-pill">#${esc(value)}</span>` : ''}</td>`;
            if (label === 'U' && value) return `<td><span class="st-type">${esc(salesTypeOf(order))}</span></td>`;
            return `<td>${esc(value)}</td>`;
        };
        const note = noVin ? `<div class="sheet-novin">${noVin} row${noVin === 1 ? '' : 's'} without a VIN ${showNoVinRows ? 'shown' : 'hidden'} (totals or extra tables in the file) <button type="button" class="ghost" id="sheet-novin-toggle">${showNoVinRows ? 'Hide them' : 'Show them'}</button></div>` : '';
        box.innerHTML = rows.length ? `${note}<table><thead><tr>${cols.map(head).join('')}</tr></thead><tbody>${rows.map((order) => `<tr class="${hasVin(order) ? '' : 'is-novin'}">${cols.map((label) => cell(order, label)).join('')}</tr>`).join('')}</tbody></table>` : `${note}<p class="empty">No live rows yet. Push Stock E-Sales to fill this sheet.</p>`;
    }
    function renderMarketing() {
        const body = $('marketing-rows');
        if (!body) return;
        body.innerHTML = marketingRequests.length
            ? marketingRequests.map((item) => {
                const fields = (item.fields || []).map((field) => `<div><span>${esc(field.label)}</span><b>${esc(field.value)}</b></div>`).join('');
                return `<article class="mkt-card${item.cancelled ? ' is-cancelled' : ''}">
                    <header>
                        <b>Order ${esc(item.orderNumber)}</b>
                        ${item.cancelled ? `<span class="mkt-cancel">Cancelled${item.cancelledDisplay ? ' ' + esc(item.cancelledDisplay) : ''}</span>` : ''}
                        <span>Advisor ${esc(item.advisorName || '—')}</span>
                        <span>Employee ID ${esc(item.employeeNumber || '—')}</span>
                        <span>Sent ${esc(item.display || item.at || '—')}</span>
                    </header>
                    <div class="mkt-fields">${fields || '<div><span>BO file</span><b>No other values on this row</b></div>'}</div>
                </article>`;
            }).join('')
            : '<p class="empty">No marketing orders sent yet.</p>';
    }
    function renderAll() { renderOverview(); renderOrders(); renderSheet(); renderStaff(); renderArchive(); renderAudit(); renderReport(); renderAlerts(); renderMarketing(); }

    async function refresh() {
        const data = await api('/api/reserved-orders/admin?password=' + encodeURIComponent(password()));
        orders = data.orders || [];
        staff = data.staff || [];
        archive = data.archive || [];
        report = data.report || {};
        $('admin-updated').textContent = data.updatedAt ? `Last push ${new Date(data.updatedAt).toLocaleString()}` : 'No live push yet';
        const source = $('push-source');
        if (source) {
            source.textContent = data.esalesName || data.boName
                ? `Live files: Stock E-Sales ${data.esalesName || '—'} · Back Order ${data.boName || '—'}`
                : 'No Stock E-Sales or Back Order pushed yet.';
        }
        const status = $('admin-status');
        const current = status.value;
        status.innerHTML = '<option value="">Status</option>' + STATUSES.map((item) => `<option>${esc(item)}</option>`).join('');
        status.value = current;
        const events = await api('/api/reserved-orders/audit?password=' + encodeURIComponent(password()));
        audit = events.events || [];
        const actions = Array.from(new Set(audit.map((event) => event.action))).sort();
        const selected = $('audit-action').value;
        $('audit-action').innerHTML = '<option value="">Action</option>' + actions.map((item) => `<option>${esc(item)}</option>`).join('');
        $('audit-action').value = selected;
        try {
            const marketing = await api('/api/reserved-orders/marketing?password=' + encodeURIComponent(password()));
            marketingRequests = marketing.requests || [];
        } catch (e) {
            if (e.message === 'unauthorized') throw e;
            marketingRequests = [];
        }
        try {
            const alertData = await api('/api/reserved-orders/alerts?password=' + encodeURIComponent(password()));
            alerts = alertData.alerts || [];
            alertFields = alertData.fields || [];
            alertProducts = alertData.products || [];
            fillAlertFields();
            if ($('error-alert-type')) fillErrorAlertForm();
        } catch (e) { alerts = []; alertFields = []; }
        renderAll();
    }

    $('gate-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        sessionStorage.setItem(passKey, $('admin-password').value);
        $('admin-password').value = '';
        try { await refresh(); showApp(); } catch (e) { if (e.message !== 'unauthorized') $('gate-error').textContent = e.message; }
    });
    $('admin-out').addEventListener('click', () => { sessionStorage.removeItem(passKey); showGate(''); });
    $('admin-nav').addEventListener('click', (event) => { const button = event.target.closest('[data-panel]'); if (button) showPanel(button.dataset.panel); });
    ['admin-search', 'admin-status', 'admin-payment', 'admin-expired'].forEach((id) => $(id).addEventListener('input', renderOrders));
    ['audit-q', 'audit-employee', 'audit-action'].forEach((id) => $(id).addEventListener('input', renderAudit));
    $('admin-rows').addEventListener('click', (event) => { const button = event.target.closest('[data-open]'); if (button) openOrder(button.dataset.open); });
    $('audit-rows').addEventListener('click', (event) => {
        const button = event.target.closest('[data-audit]');
        if (!button) return;
        const eventRow = audit.find((item) => item.at === button.dataset.audit);
        if (!eventRow) return;
        $('drawer').classList.remove('hidden');
        $('drawer').innerHTML = `<button class="ghost" id="close-drawer" type="button">Close</button><h2>${esc(eventRow.action)}</h2><pre>${esc(JSON.stringify(eventRow, null, 2))}</pre>`;
        $('close-drawer').addEventListener('click', () => $('drawer').classList.add('hidden'));
    });
    $('archive-rows').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-version]');
        if (!button) return;
        const data = await api('/api/reserved-orders/archive/' + encodeURIComponent(button.dataset.version) + '?password=' + encodeURIComponent(password()));
        const sample = (data.orders || []).slice(0, 12);
        $('archive-view').innerHTML = `<section class="panel"><h2>${esc(button.dataset.version)}</h2><p>${(data.orders || []).length} orders in this snapshot.</p>${sample.map((order) => `<div>${esc(order.orderNumber)} · ${esc(order.vin)} · ${esc(order.status)}</div>`).join('')}</section>`;
    });
    $('save-staff').addEventListener('click', async () => {
        $('staff-error').textContent = '';
        try {
            await api('/api/reserved-orders/staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: password(),
                    name: $('staff-name').value,
                    id: $('staff-id').value,
                    role: $('staff-role').value,
                    active: $('staff-active').checked,
                    previousRecordId: editing
                })
            });
            editing = '';
            $('staff-name').value = '';
            $('staff-id').value = '';
            $('staff-active').checked = true;
            await refresh();
        } catch (e) { if (e.message !== 'unauthorized') $('staff-error').textContent = e.message; }
    });
    $('staff-list').addEventListener('click', (event) => {
        const button = event.target.closest('[data-edit]');
        if (!button) return;
        const person = staff.find((item) => item.recordId === button.dataset.edit);
        if (!person) return;
        editing = person.recordId;
        $('staff-name').value = person.name;
        $('staff-id').value = person.id;
        $('staff-role').value = person.role || 'employee';
        $('staff-active').checked = person.active !== false;
    });
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = () => reject(new Error('Could not read the file.'));
            reader.readAsDataURL(file);
        });
    }
    if ($('save-error-alert')) $('save-error-alert').addEventListener('click', async () => {
        $('error-alert-error').textContent = '';
        const errorId = $('error-alert-type').value;
        const message = $('error-alert-message').value.trim();
        const known = BO_ERRORS.find((item) => item[0] === errorId);
        if (!known || !message) { $('error-alert-error').textContent = 'Choose a BO error and write the message.'; return; }
        try {
            await saveAlertList(alerts.concat([{
                kind: 'bo_error',
                errorId,
                errorLabel: known[1],
                product: $('error-alert-car').value,
                message,
                tone: $('error-alert-tone').value,
                active: $('error-alert-active').checked
            }]));
            $('error-alert-message').value = '';
        } catch (e) { if (e.message !== 'unauthorized') $('error-alert-error').textContent = e.message; }
    });
    if ($('alert-field')) $('alert-field').addEventListener('change', fillAlertValues);
    if ($('save-alert')) $('save-alert').addEventListener('click', async () => {
        $('alert-error').textContent = '';
        const field = $('alert-field').value;
        const message = $('alert-message').value.trim();
        if (!field || !message) { $('alert-error').textContent = 'Choose a BO column and write the message.'; return; }
        try {
            await saveAlertList(alerts.concat([{
                kind: 'column',
                field,
                operator: $('alert-operator').value,
                value: $('alert-value').value,
                message,
                tone: $('alert-tone').value,
                active: $('alert-active').checked
            }]));
            $('alert-message').value = '';
            $('alert-value').value = '';
        } catch (e) { if (e.message !== 'unauthorized') $('alert-error').textContent = e.message; }
    });
    if ($('alert-list')) $('alert-list').addEventListener('click', async (event) => {
        const del = event.target.closest('[data-alert-del]');
        const off = event.target.closest('[data-alert-off]');
        if (!del && !off) return;
        const id = (del || off).dataset.alertDel || (del || off).dataset.alertOff;
        const next = del ? alerts.filter((rule) => rule.id !== id) : alerts.map((rule) => rule.id === id ? { ...rule, active: rule.active === false } : rule);
        try { await saveAlertList(next); } catch (e) { if (e.message !== 'unauthorized') $('alert-error').textContent = e.message; }
    });
    $('push-live').addEventListener('click', async () => {
        $('push-error').textContent = '';
        const esales = $('esales-file').files[0];
        const bo = $('bo-file').files[0];
        const reserved = $('reserved-file') ? $('reserved-file').files[0] : null;
        if (!esales) { $('push-error').textContent = 'Choose the E-Sales Excel first.'; return; }
        try {
            const body = { password: password(), esalesBase64: await fileToBase64(esales), esalesName: esales.name };
            if (bo) { body.boBase64 = await fileToBase64(bo); body.boName = bo.name; }
            if (reserved) { body.reservedBase64 = await fileToBase64(reserved); body.reservedName = reserved.name; }
            const pushed = await api('/api/reserved-orders/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            if ($('push-report') && pushed.reportSheet) $('push-report').textContent = 'Report Sheet admin now has these files too.';
            await refresh();
            showPanel('overview');
        } catch (e) { if (e.message !== 'unauthorized') $('push-error').textContent = e.message; }
    });
    setInterval(() => {
        document.querySelectorAll('.timer-cell').forEach((cell) => {
            const end = parseLocal(cell.dataset.deadline);
            if (!end) { cell.textContent = 'NO ASSIGN DATE'; return; }
            const ms = end.getTime() - Date.now();
            if (ms <= 0) { cell.textContent = 'EXPIRED'; return; }
            const total = Math.floor(ms / 1000);
            cell.textContent = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        });
    }, 1000);
    if ($('sheet-search')) $('sheet-search').addEventListener('input', renderSheet);
    if ($('live-sheet')) $('live-sheet').addEventListener('click', (event) => {
        if (!event.target.closest('#sheet-novin-toggle')) return;
        showNoVinRows = !showNoVinRows;
        renderSheet();
    });
    if ($('st-cards')) $('st-cards').addEventListener('click', (event) => {
        const card = event.target.closest('[data-st]');
        if (!card) return;
        salesTypePick = card.dataset.st;
        renderSalesTypes();
        const detail = $('st-detail');
        if (detail && detail.scrollIntoView) detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    if ($('st-detail')) $('st-detail').addEventListener('click', (event) => {
        const row = event.target.closest('[data-open]');
        if (row) openOrder(row.dataset.open);
    });
    try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${protocol}//${location.host}`);
        socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if ((msg.type === 'reserved_orders_updated' || msg.type === 'report_sheet_updated') && password()) refresh().catch(() => {});
        });
    } catch (e) { /* the sheet still refreshes on the next manual open */ }
    if (password()) refresh().then(showApp).catch(() => {});
})();