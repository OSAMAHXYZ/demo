(function () {
    const STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
    const passKey = 'reserved-orders-admin-pass';
    let orders = [];
    let editingId = '';

    function password() { return sessionStorage.getItem(passKey) || ''; }
    function parseLocal(value) {
        const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
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
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = () => reject(new Error('Could not read the file.'));
            reader.readAsDataURL(file);
        });
    }

    async function api(url, options) {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            sessionStorage.removeItem(passKey);
            showGate('Admin password was not accepted.');
            throw new Error('unauthorized');
        }
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }

    function showGate(message) {
        document.getElementById('gate').classList.remove('hidden');
        document.getElementById('admin-app').classList.add('hidden');
        document.getElementById('gate-error').textContent = message || '';
    }
    function showApp() {
        document.getElementById('gate').classList.add('hidden');
        document.getElementById('admin-app').classList.remove('hidden');
    }

    function paintReport(report) {
        if (!report) return;
        const pay = report.paymentBreakdown || {};
        document.getElementById('push-report').innerHTML = [
            ['Reserved VINs', report.reservedVinCount],
            ['Orders', report.orderCount],
            ['Matched to Back Order', report.matchedOrders],
            ['Unmatched', report.unmatchedVins],
            ['Missing VIN rows', report.missingVinRows],
            ['Duplicate VIN rows skipped', report.duplicateVinRows],
            ['Sales advisors', report.salesAdvisorCount],
            ['Cash / Bank / Other / Unknown', `${pay.cash || 0} / ${pay.bank || 0} / ${pay.other || 0} / ${pay.unknown || 0}`],
            ['Earliest assign', report.earliestAssignDate || '—'],
            ['Latest assign', report.latestAssignDate || '—']
        ].map(([k, v]) => `<div>${escapeHtml(k)}: <b>${escapeHtml(v)}</b></div>`).join('');
    }

    function render() {
        const q = document.getElementById('admin-search').value.trim().toLowerCase();
        const status = document.getElementById('admin-status').value;
        const payment = document.getElementById('admin-payment').value;
        const expiredOnly = document.getElementById('admin-expired').value === 'expired';
        const rows = orders.filter((order) => {
            if (q && ![order.vin, order.orderNumber, order.salesAdvisor].join(' ').toLowerCase().includes(q)) return false;
            if (status && order.status !== status) return false;
            if (payment && order.paymentKind !== payment) return false;
            if (expiredOnly && remain(order) !== 'EXPIRED') return false;
            return true;
        }).sort((a, b) => (a.queueNumber || 0) - (b.queueNumber || 0));
        document.getElementById('admin-rows').innerHTML = rows.map((order) => {
            const history = (order.history || []).map((item) =>
                `<div>${escapeHtml(item.status)} · ${escapeHtml(item.changedBy)} · ${escapeHtml(item.changedDisplay || item.changedAt)}</div>`
            ).join('') || '<div>No status changes yet</div>';
            return `<tr>
                <td>#${order.queueNumber == null ? '—' : order.queueNumber}</td>
                <td>${escapeHtml(order.orderNumber || 'NO ORDER')}</td>
                <td>${escapeHtml(order.vin || 'VIN NOT FOUND')}</td>
                <td>${escapeHtml(order.salesAdvisor || 'UNASSIGNED')}</td>
                <td>${escapeHtml(order.paymentLabel || 'UNKNOWN')}</td>
                <td>${escapeHtml(order.status || '')}</td>
                <td class="timer-cell" data-deadline="${escapeHtml(order.deadline || '')}">${escapeHtml(remain(order))}</td>
                <td class="history">${history}</td>
            </tr>`;
        }).join('');
    }

    function renderStaff(staff) {
        document.getElementById('staff-list').innerHTML = (staff || []).map((person) =>
            `<div class="staff-row">
                <div><b>${escapeHtml(person.name)}</b><br><span>${person.active ? 'Active' : 'Inactive'}</span></div>
                <button class="ghost" type="button" data-edit="${escapeHtml(person.id)}" data-name="${escapeHtml(person.name)}" data-active="${person.active ? '1' : '0'}">Edit</button>
            </div>`
        ).join('');
    }

    async function refresh() {
        const data = await api('/api/reserved-orders/admin?password=' + encodeURIComponent(password()));
        orders = data.orders || [];
        document.getElementById('admin-updated').textContent = data.updatedAt ? `Last push ${new Date(data.updatedAt).toLocaleString()}` : 'No live push yet';
        const status = document.getElementById('admin-status');
        const current = status.value;
        status.innerHTML = '<option value="">Status</option>' + STATUSES.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
        status.value = current;
        paintReport(data.report);
        renderStaff(data.staff);
        render();
    }

    document.getElementById('gate-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        sessionStorage.setItem(passKey, document.getElementById('admin-password').value);
        document.getElementById('admin-password').value = '';
        try {
            await refresh();
            showApp();
        } catch (e) {
            if (e.message !== 'unauthorized') document.getElementById('gate-error').textContent = e.message;
        }
    });
    document.getElementById('admin-out').addEventListener('click', () => {
        sessionStorage.removeItem(passKey);
        showGate('');
    });
    document.getElementById('push-live').addEventListener('click', async () => {
        const error = document.getElementById('push-error');
        error.textContent = '';
        const esales = document.getElementById('esales-file').files[0];
        const bo = document.getElementById('bo-file').files[0];
        if (!esales) { error.textContent = 'Choose the E-Sales Excel first.'; return; }
        try {
            const body = {
                password: password(),
                esalesBase64: await fileToBase64(esales),
                esalesName: esales.name
            };
            if (bo) {
                body.boBase64 = await fileToBase64(bo);
                body.boName = bo.name;
            }
            const data = await api('/api/reserved-orders/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            paintReport(data.report);
            await refresh();
        } catch (e) {
            if (e.message !== 'unauthorized') error.textContent = e.message;
        }
    });
    document.getElementById('save-staff').addEventListener('click', async () => {
        const error = document.getElementById('staff-error');
        error.textContent = '';
        try {
            await api('/api/reserved-orders/staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: password(),
                    name: document.getElementById('staff-name').value,
                    id: document.getElementById('staff-id').value,
                    previousId: editingId || document.getElementById('staff-id').value,
                    active: document.getElementById('staff-active').checked
                })
            });
            editingId = '';
            document.getElementById('staff-name').value = '';
            document.getElementById('staff-id').value = '';
            document.getElementById('staff-active').checked = true;
            await refresh();
        } catch (e) {
            if (e.message !== 'unauthorized') error.textContent = e.message;
        }
    });
    document.getElementById('staff-list').addEventListener('click', (event) => {
        const button = event.target.closest('[data-edit]');
        if (!button) return;
        editingId = button.dataset.edit;
        document.getElementById('staff-name').value = button.dataset.name;
        document.getElementById('staff-id').value = button.dataset.edit;
        document.getElementById('staff-active').checked = button.dataset.active === '1';
    });
    ['admin-search', 'admin-status', 'admin-payment', 'admin-expired'].forEach((id) => {
        document.getElementById(id).addEventListener('input', render);
        document.getElementById(id).addEventListener('change', render);
    });
    setInterval(() => {
        if (document.getElementById('admin-app').classList.contains('hidden')) return;
        document.querySelectorAll('.timer-cell').forEach((cell) => {
            const end = parseLocal(cell.dataset.deadline);
            if (!end) { cell.textContent = 'NO ASSIGN DATE'; return; }
            const ms = end.getTime() - Date.now();
            if (ms <= 0) { cell.textContent = 'EXPIRED'; return; }
            const total = Math.floor(ms / 1000);
            cell.textContent = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        });
    }, 1000);

    if (password()) {
        refresh().then(showApp).catch(() => {});
    }
})();
