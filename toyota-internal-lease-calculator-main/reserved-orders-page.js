(function () {
    const STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
    const IDLE_MS = 3 * 60 * 1000;
    const sessionKey = 'reserved-orders-session';
    let orders = [];
    let updatedAt = '';
    let idleTimer = null;
    let clock = null;

    const login = document.getElementById('login');
    const app = document.getElementById('app');
    const nameSelect = document.getElementById('employee-name');
    const idInput = document.getElementById('employee-id');
    const loginError = document.getElementById('login-error');

    function pad(n) { return String(n).padStart(2, '0'); }
    function parseLocal(value) {
        const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
    function remainingMs(order) {
        const end = parseLocal(order.deadline);
        if (!end) return null;
        return end.getTime() - Date.now();
    }
    function formatRemain(ms) {
        if (ms == null) return 'NO ASSIGN DATE';
        if (ms <= 0) return 'EXPIRED';
        const total = Math.floor(ms / 1000);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return `${pad(h)}:${pad(m)}:${pad(s)}`;
    }
    function isExpired(order) {
        const ms = remainingMs(order);
        return ms != null && ms <= 0;
    }
    function isCompleted(order) { return order.status === 'تم الفوترة'; }
    function isCancelled(order) { return order.status === 'الغاء'; }
    function isActive(order) { return !isExpired(order) && !isCompleted(order) && !isCancelled(order); }
    function badgeClass(status) {
        if (status === 'تم الفوترة') return 'done';
        if (status === 'الغاء') return 'cancel';
        if (status === 'محجوز' || status === 'انتظار تحويل' || status === 'انتظار رد الضيف') return 'wait';
        if (status === 'efc' || status === 'b2c' || status === 'DB') return 'hold';
        return '';
    }
    function show(value, missing) { return value ? value : missing; }

    function readSession() {
        try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch (e) { return null; }
    }
    function writeSession(data) { sessionStorage.setItem(sessionKey, JSON.stringify(data)); }
    function clearSession() { sessionStorage.removeItem(sessionKey); }

    function touch() {
        const session = readSession();
        if (!session) return;
        session.last = Date.now();
        writeSession(session);
        paintSession();
    }
    function paintSession() {
        const session = readSession();
        const pill = document.getElementById('session-pill');
        if (!session || !pill) return;
        const left = Math.max(0, IDLE_MS - (Date.now() - session.last));
        const total = Math.ceil(left / 1000);
        pill.textContent = `Session: ${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
        if (left <= 0) signOut();
    }
    function signOut() {
        clearSession();
        if (clock) clearInterval(clock);
        login.classList.remove('hidden');
        app.classList.add('hidden');
        idInput.value = '';
    }

    async function loadNames() {
        const res = await fetch('/api/reserved-orders/staff-names');
        const data = await res.json();
        const names = data.names || [];
        nameSelect.innerHTML = names.length
            ? names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
            : '<option value="">No active employees</option>';
    }
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    let lastPayload = '';
    async function loadLive() {
        const res = await fetch('/api/reserved-orders/live');
        const data = await res.json();
        const next = data.orders || [];
        const stamp = data.updatedAt || '';
        const payload = stamp + JSON.stringify(next);
        orders = next;
        updatedAt = stamp;
        const label = document.getElementById('updated-at');
        if (label) label.textContent = updatedAt ? `Live data ${new Date(updatedAt).toLocaleString()}` : 'Waiting for a live push';
        if (payload === lastPayload) return;
        lastPayload = payload;
        fillFilters();
        render();
    }

    function fillFilters() {
        const status = document.getElementById('filter-status');
        const advisor = document.getElementById('filter-advisor');
        const queue = document.getElementById('filter-queue');
        const statusValue = status.value;
        const advisorValue = advisor.value;
        const queueValue = queue.value;
        status.innerHTML = '<option value="">Status</option>' + STATUSES.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
        const advisors = Array.from(new Set(orders.map((o) => o.salesAdvisor).filter(Boolean))).sort();
        advisor.innerHTML = '<option value="">Sales advisor</option>' + advisors.map((item) => `<option>${escapeHtml(item)}</option>`).join('');
        const queues = Array.from(new Set(orders.map((o) => o.queueNumber).filter((n) => n != null))).sort((a, b) => a - b);
        queue.innerHTML = '<option value="">Queue</option>' + queues.map((n) => `<option value="${n}">#${n}</option>`).join('');
        status.value = statusValue;
        advisor.value = advisorValue;
        queue.value = queueValue;
    }

    function visibleOrders() {
        const q = document.getElementById('search').value.trim().toLowerCase();
        const status = document.getElementById('filter-status').value;
        const payment = document.getElementById('filter-payment').value;
        const advisor = document.getElementById('filter-advisor').value;
        const queue = document.getElementById('filter-queue').value;
        const state = document.getElementById('filter-state').value;
        const sort = document.getElementById('sort').value;
        let list = orders.filter((order) => {
            if (q) {
                const blob = [order.vin, order.orderNumber, order.customerName, order.salesAdvisor].join(' ').toLowerCase();
                if (!blob.includes(q)) return false;
            }
            if (status && order.status !== status) return false;
            if (payment && order.paymentKind !== payment) return false;
            if (advisor && order.salesAdvisor !== advisor) return false;
            if (queue && String(order.queueNumber) !== queue) return false;
            if (state === 'expired' && !isExpired(order)) return false;
            if (state === 'active' && !isActive(order)) return false;
            return true;
        });
        list.sort((a, b) => {
            if (sort === 'assign') return String(a.assignDate).localeCompare(String(b.assignDate));
            if (sort === 'remaining') return (remainingMs(a) ?? Number.MAX_SAFE_INTEGER) - (remainingMs(b) ?? Number.MAX_SAFE_INTEGER);
            if (sort === 'order') return String(a.orderNumber).localeCompare(String(b.orderNumber));
            if (sort === 'advisor') return String(a.salesAdvisor).localeCompare(String(b.salesAdvisor));
            return (a.queueNumber || 0) - (b.queueNumber || 0);
        });
        return list;
    }

    function render() {
        const list = visibleOrders();
        const expired = orders.filter(isExpired).length;
        const completed = orders.filter(isCompleted).length;
        const active = orders.filter(isActive).length;
        const soon = orders.filter((order) => {
            const ms = remainingMs(order);
            return isActive(order) && ms != null && ms > 0 && ms <= 6 * 3600000;
        }).length;
        document.getElementById('kpis').innerHTML = [
            ['Total reserved', orders.length, ''],
            ['Active orders', active, 'ok'],
            ['Expired orders', expired, 'bad'],
            ['Completed / invoiced', completed, 'ok'],
            ['Approaching deadline', soon, 'warn']
        ].map(([label, value, cls]) => `<article class="kpi ${cls}"><em>${label}</em><strong>${value}</strong></article>`).join('');

        const cards = document.getElementById('cards');
        if (!list.length) {
            cards.innerHTML = '<div class="empty">No reserved orders match this view.</div>';
            return;
        }
        cards.innerHTML = list.map((order) => {
            const ms = remainingMs(order);
            const expiredCard = ms != null && ms <= 0;
            const soonCard = ms != null && ms > 0 && ms <= 6 * 3600000;
            const ahead = (order.ahead || []).map((item, index) =>
                `<li><strong>${index + 1}. #${item.queueNumber} — Order ${escapeHtml(item.orderNumber || 'NO ORDER')}</strong><br>VIN ${escapeHtml(item.vin)} · ${escapeHtml(item.vehicle || 'Vehicle')} · ${escapeHtml(item.salesAdvisor || 'UNASSIGNED')}</li>`
            ).join('');
            return `<article class="order${expiredCard ? ' expired' : ''}" data-key="${escapeHtml(order.key)}">
                <div class="order-main">
                    <div class="order-head">
                        <h2 class="order-no">ORDER #${escapeHtml(order.orderNumber || 'NO ORDER')}</h2>
                        <span class="badge ${badgeClass(order.status)}">${escapeHtml(order.status || 'محجوز')}</span>
                    </div>
                    <div class="meta">
                        <div><span>VIN</span><strong>${escapeHtml(show(order.vin, 'VIN NOT FOUND'))}</strong></div>
                        <div><span>Vehicle</span><strong>${escapeHtml(order.vehicle || '—')} ${order.modelYear ? '(' + escapeHtml(order.modelYear) + ')' : ''}</strong></div>
                        <div><span>Sales advisor</span><strong>${escapeHtml(show(order.salesAdvisor, 'UNASSIGNED'))}</strong></div>
                        <div><span>Customer</span><strong>${escapeHtml(order.customerName || '—')}</strong></div>
                        <div><span>Exterior / interior</span><strong>${escapeHtml(order.exterior || '—')} / ${escapeHtml(order.interior || '—')}</strong></div>
                        <div><span>Payment</span><strong>${escapeHtml(show(order.paymentLabel, 'UNKNOWN'))}</strong></div>
                        <div><span>Created</span><strong>${escapeHtml(order.createdDisplay || '—')}</strong></div>
                        <div><span>Queue</span><strong class="queue-line">#${order.queueNumber == null ? '—' : order.queueNumber}</strong></div>
                        <div><span>Current status</span><strong>${escapeHtml(order.status || 'محجوز')}</strong></div>
                    </div>
                    <div class="ahead"><span class="side-label">Next in queue</span><ol>${ahead || '<li>No orders ahead</li>'}</ol></div>
                </div>
                <div class="order-side">
                    <span class="side-label">Time remaining</span>
                    <div class="timer${expiredCard ? ' expired' : soonCard ? ' soon' : ''}" data-deadline="${escapeHtml(order.deadline || '')}">${formatRemain(ms)}</div>
                    <span class="side-label">Assigned</span>
                    <strong>${escapeHtml(order.assignDisplay || 'NO ASSIGN DATE')}</strong>
                    <div class="status-row">
                        <select class="status-select" aria-label="Change status">
                            ${STATUSES.map((status) => `<option${status === order.status ? ' selected' : ''}>${escapeHtml(status)}</option>`).join('')}
                        </select>
                    </div>
                    <p class="side-label" style="margin-top:10px;">${order.statusChangedBy ? 'Updated by ' + escapeHtml(order.statusChangedBy) : ''}</p>
                </div>
            </article>`;
        }).join('');
    }

    async function changeStatus(key, status) {
        const session = readSession();
        if (!session) return signOut();
        const res = await fetch('/api/reserved-orders/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, key, status })
        });
        if (res.status === 401) return signOut();
        if (!res.ok) return;
        touch();
        await loadLive();
    }

    function connectLive() {
        try {
            const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const socket = new WebSocket(`${protocol}//${location.host}`);
            socket.addEventListener('message', (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'reserved_orders_updated' || msg.type === 'report_sheet_updated') loadLive();
                } catch (e) { /* ignore other broadcasts */ }
            });
        } catch (e) { /* polling still runs */ }
        setInterval(() => { if (readSession()) loadLive(); }, 8000);
    }

    document.getElementById('login-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        loginError.textContent = '';
        const res = await fetch('/api/reserved-orders/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nameSelect.value, password: idInput.value })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            loginError.textContent = data.error || 'Could not sign in.';
            return;
        }
        writeSession({ token: data.token, name: data.name, last: Date.now() });
        idInput.value = '';
        openApp();
    });
    document.getElementById('logout').addEventListener('click', signOut);
    ['click', 'keydown', 'input', 'change', 'scroll'].forEach((type) => {
        window.addEventListener(type, () => { if (readSession() && !app.classList.contains('hidden')) touch(); }, { passive: true });
    });
    document.getElementById('cards').addEventListener('change', (event) => {
        const select = event.target.closest('.status-select');
        if (!select) return;
        const card = select.closest('.order');
        changeStatus(card.dataset.key, select.value);
    });
    ['search', 'filter-status', 'filter-payment', 'filter-advisor', 'filter-queue', 'filter-state', 'sort'].forEach((id) => {
        document.getElementById(id).addEventListener('input', render);
        document.getElementById(id).addEventListener('change', render);
    });

    function tickTimers() {
        paintSession();
        document.querySelectorAll('.timer').forEach((el) => {
            const end = parseLocal(el.dataset.deadline);
            const ms = end ? end.getTime() - Date.now() : null;
            el.textContent = formatRemain(ms);
            el.classList.toggle('expired', ms != null && ms <= 0);
            el.classList.toggle('soon', ms != null && ms > 0 && ms <= 6 * 3600000);
            const card = el.closest('.order');
            if (card) card.classList.toggle('expired', ms != null && ms <= 0);
        });
        const expired = orders.filter(isExpired).length;
        const soon = orders.filter((order) => {
            const ms = remainingMs(order);
            return isActive(order) && ms != null && ms > 0 && ms <= 6 * 3600000;
        }).length;
        const active = orders.filter(isActive).length;
        const nodes = document.querySelectorAll('#kpis strong');
        if (nodes[1]) nodes[1].textContent = String(active);
        if (nodes[2]) nodes[2].textContent = String(expired);
        if (nodes[4]) nodes[4].textContent = String(soon);
    }
    function openApp() {
        const session = readSession();
        if (!session || Date.now() - session.last >= IDLE_MS) return signOut();
        login.classList.add('hidden');
        app.classList.remove('hidden');
        document.getElementById('who').textContent = session.name;
        loadLive();
        if (clock) clearInterval(clock);
        clock = setInterval(tickTimers, 1000);
        paintSession();
    }

    loadNames();
    connectLive();
    if (readSession()) openApp();
})();
