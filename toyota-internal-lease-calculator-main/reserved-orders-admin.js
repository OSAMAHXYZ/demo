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
    function renderAll() { renderOverview(); renderOrders(); renderStaff(); renderArchive(); renderAudit(); renderReport(); renderAlerts(); }

    async function refresh() {
        const data = await api('/api/reserved-orders/admin?password=' + encodeURIComponent(password()));
        orders = data.orders || [];
        staff = data.staff || [];
        archive = data.archive || [];
        report = data.report || {};
        $('admin-updated').textContent = data.updatedAt ? `Last push ${new Date(data.updatedAt).toLocaleString()}` : 'No live push yet';
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
        if (!esales) { $('push-error').textContent = 'Choose the E-Sales Excel first.'; return; }
        try {
            const body = { password: password(), esalesBase64: await fileToBase64(esales), esalesName: esales.name };
            if (bo) { body.boBase64 = await fileToBase64(bo); body.boName = bo.name; }
            await api('/api/reserved-orders/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
    if (password()) refresh().then(showApp).catch(() => {});
})();
