(function () {
    const STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
    const CARS = [
        ['Camry', 'images/cars/camry.png'], ['Corolla', 'images/cars/corolla.png'], ['Crown', 'images/cars/crown.png'],
        ['Fortuner', 'images/cars/fortuner.png'], ['Highlander', 'images/cars/highlander.png'], ['Hilux', 'images/cars/hilux.png'],
        ['Land Cruiser', 'images/cars/land cruiser.png'], ['Prado', 'images/cars/prado.png'], ['RAV4', 'images/cars/rav4.png'],
        ['Raize', 'images/cars/raize.png'], ['Yaris', 'images/cars/yaris.png'], ['Innova', 'images/cars/innova.png'],
        ['Veloz', 'images/cars/veloz.png'], ['Urban Cruiser', 'images/cars/urban cruiser.png'], ['Corolla Cross', 'images/cars/corolla cross.png'],
        ['GR86', 'images/cars/gr86.png']
    ];
    const IDLE_MS = 3 * 60 * 1000;
    const sessionKey = 'reserved-orders-session';
    let orders = [];
    let carsData = {};
    let searchTimer = null;
    let clock = null;

    const $ = (id) => document.getElementById(id);
    function pad(n) { return String(n).padStart(2, '0'); }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }
    function parseLocal(value) {
        const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
    function remainingMs(order) {
        const end = parseLocal(order.deadline);
        return end ? end.getTime() - Date.now() : null;
    }
    function formatRemain(ms) {
        if (ms == null) return 'NO ASSIGN DATE';
        if (ms <= 0) return 'EXPIRED';
        const total = Math.floor(ms / 1000);
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    }
    function timerClass(ms) {
        if (ms == null) return '';
        if (ms <= 0) return 'expired';
        if (ms <= 6 * 3600000) return 'soon';
        return 'ok';
    }
    function isExpired(order) { const ms = remainingMs(order); return ms != null && ms <= 0; }
    function isCompleted(order) { return order.status === 'تم الفوترة'; }
    function isCancelled(order) { return order.status === 'الغاء'; }
    function isActive(order) { return !isExpired(order) && !isCompleted(order) && !isCancelled(order); }
    function badge(status) {
        if (status === 'تم الفوترة') return 'done';
        if (status === 'الغاء') return 'cancel';
        if (status === 'محجوز' || status === 'انتظار تحويل' || status === 'انتظار رد الضيف') return 'wait';
        return '';
    }
    function show(value, missing) { return value ? value : missing; }
    function carImage(name) {
        const text = String(name || '').toLowerCase();
        const hit = CARS.find(([label]) => text.includes(label.toLowerCase()));
        return hit ? hit[1] : '';
    }
    function readSession() { try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch (e) { return null; } }
    function writeSession(data) { sessionStorage.setItem(sessionKey, JSON.stringify(data)); }

    async function endSession(reason) {
        const session = readSession();
        sessionStorage.removeItem(sessionKey);
        document.body.classList.remove('dash');
        if (session && session.token) {
            await fetch('/api/reserved-orders/logout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: session.token, reason })
            }).catch(() => {});
        }
        if (clock) clearInterval(clock);
        $('login').classList.remove('hidden');
        $('app').classList.add('hidden');
        $('employee-id').value = '';
    }
    function touch() {
        const session = readSession();
        if (!session || $('app').classList.contains('hidden')) return;
        session.last = Date.now();
        writeSession(session);
        paintSession();
    }
    function paintSession() {
        const session = readSession();
        if (!session) return;
        const left = Math.max(0, IDLE_MS - (Date.now() - session.last));
        const total = Math.ceil(left / 1000);
        $('session-pill').textContent = `Session: ${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
        if (left <= 0) endSession('timeout');
    }

    async function loadNames() {
        const data = await fetch('/api/reserved-orders/staff-names').then((res) => res.json()).catch(() => ({ people: [] }));
        const people = data.people || [];
        const options = ['<option value="__admin__">Admin</option>'].concat(
            people.map((person) => `<option value="${esc(person.recordId)}">${esc(person.name)}</option>`)
        );
        $('employee-name').innerHTML = options.join('');
    }
    async function loadLive() {
        const data = await fetch('/api/reserved-orders/live').then((res) => res.json());
        const next = data.orders || [];
        const payload = (data.updatedAt || '') + next.length + (next[0] && next[0].statusChangedAt || '');
        orders = next;
        $('updated-at').textContent = data.updatedAt ? `Live data ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for a live push';
        if (payload === loadLive.last && document.querySelector('.order')) return tickTimers();
        loadLive.last = payload;
        fillFilters();
        render();
    }
    function fillFilters() {
        const status = $('filter-status');
        const advisor = $('filter-advisor');
        const queue = $('filter-queue');
        const keep = [status.value, advisor.value, queue.value];
        status.innerHTML = '<option value="">Status</option>' + STATUSES.map((item) => `<option>${esc(item)}</option>`).join('');
        const advisors = Array.from(new Set(orders.map((order) => order.salesAdvisor).filter(Boolean))).sort();
        advisor.innerHTML = '<option value="">Sales advisor</option>' + advisors.map((item) => `<option>${esc(item)}</option>`).join('');
        const queues = Array.from(new Set(orders.map((order) => order.queueNumber).filter((n) => n != null))).sort((a, b) => a - b);
        queue.innerHTML = '<option value="">Queue</option>' + queues.map((n) => `<option value="${n}">#${n}</option>`).join('');
        status.value = keep[0]; advisor.value = keep[1]; queue.value = keep[2];
    }
    function visibleOrders() {
        const q = $('search').value.trim().toLowerCase();
        const status = $('filter-status').value;
        const payment = $('filter-payment').value;
        const advisor = $('filter-advisor').value;
        const queue = $('filter-queue').value;
        const state = $('filter-state').value;
        const sort = $('sort').value;
        const list = orders.filter((order) => {
            if (q && ![order.vin, order.orderNumber, order.customerName, order.salesAdvisor].join(' ').toLowerCase().includes(q)) return false;
            if (status && order.status !== status) return false;
            if (payment && order.paymentKind !== payment) return false;
            if (advisor && order.salesAdvisor !== advisor) return false;
            if (queue && String(order.queueNumber) !== queue) return false;
            if (state === 'expired' && !isExpired(order)) return false;
            if (state === 'active' && !isActive(order)) return false;
            return true;
        });
        list.sort((a, b) => {
            if (sort === 'queue-desc') return (b.queueNumber || 0) - (a.queueNumber || 0);
            if (sort === 'assign-asc') return String(a.assignDate).localeCompare(String(b.assignDate));
            if (sort === 'assign-desc') return String(b.assignDate).localeCompare(String(a.assignDate));
            if (sort === 'remaining') return (remainingMs(a) ?? 9e15) - (remainingMs(b) ?? 9e15);
            return (a.queueNumber || 0) - (b.queueNumber || 0);
        });
        return list;
    }
    function render() {
        const list = visibleOrders();
        const expired = orders.filter(isExpired).length;
        const soon = orders.filter((order) => isActive(order) && (remainingMs(order) || 0) > 0 && remainingMs(order) <= 6 * 3600000).length;
        $('kpis').innerHTML = [
            ['Total', orders.length, ''],
            ['Active', orders.filter(isActive).length, 'ok'],
            ['Expired', expired, 'bad'],
            ['Invoiced', orders.filter(isCompleted).length, 'ok'],
            ['Deadline', soon, 'warn']
        ].map(([label, value, cls]) => `<article class="kpi ${cls}"><em>${label}</em><strong>${value}</strong></article>`).join('');
        const top = list.slice(0, 3);
        $('cards').innerHTML = top.length ? top.map(cardHtml).join('') : '<div class="empty">No reserved orders match this view.</div>';
        if (!$('overlay-all').classList.contains('hidden')) renderAll(list);
    }
    function cardHtml(order) {
        const ms = remainingMs(order);
        const hours = order.paymentHours || 48;
        const img = carImage(order.vehicle);
        const ahead = (order.ahead || []).slice(0, 3).map((item) => `#${item.queueNumber} ${esc(item.orderNumber || 'NO ORDER')}`).join(' · ') || 'None ahead';
        return `<article class="lane${isExpired(order) ? ' expired' : ''}" data-key="${esc(order.key)}">
            <div><div class="qmark">#${order.queueNumber == null ? '—' : order.queueNumber}</div>${img ? `<img class="car" src="${img}" alt="" onerror="this.style.display='none'">` : ''}</div>
            <div><b>ORDER #${esc(order.orderNumber || 'NO ORDER')}</b><span class="muted">VIN ${esc(show(order.vin, 'VIN NOT FOUND'))}</span><span class="muted">${esc(order.customerName || '—')}</span></div>
            <div><b>${esc(order.vehicle || '—')}</b><span class="muted">${esc(order.modelYear || '—')}</span><span class="muted">${esc(order.exterior || '—')} / ${esc(order.interior || '—')}</span></div>
            <div><b>${esc(show(order.salesAdvisor, 'UNASSIGNED'))}</b><span class="muted">${esc(show(order.paymentLabel, 'UNKNOWN'))}</span><span class="muted">${esc(order.assignDisplay || 'NO ASSIGN DATE')}</span></div>
            <div><span class="muted">Next</span><b>${ahead}</b></div>
            <div><div class="timer ${timerClass(ms)}" data-deadline="${esc(order.deadline || '')}">${formatRemain(ms)}</div><span class="muted">${hours} HOURS</span></div>
            <div><span class="badge ${badge(order.status)}">${esc(order.status || 'محجوز')}</span><div class="status-row"><select class="status-select" aria-label="Change status">${STATUSES.map((status) => `<option${status === order.status ? ' selected' : ''}>${esc(status)}</option>`).join('')}</select></div></div>
        </article>`;
    }
    function renderAll(list) {
        const rows = list || visibleOrders();
        $('all-rows').innerHTML = rows.map(cardHtml).join('') || '<div class="empty">No reserved orders match this view.</div>';
    }
    function tickTimers() {
        paintSession();
        document.querySelectorAll('.timer').forEach((el) => {
            const end = parseLocal(el.dataset.deadline);
            const ms = end ? end.getTime() - Date.now() : null;
            el.textContent = formatRemain(ms);
            el.className = `timer ${timerClass(ms)}`;
            const card = el.closest('.lane');
            if (card) card.classList.toggle('expired', ms != null && ms <= 0);
        });
    }
    async function changeStatus(key, status) {
        const session = readSession();
        if (!session) return endSession('logout');
        const res = await fetch('/api/reserved-orders/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, key, status })
        });
        if (res.status === 401) return endSession('logout');
        touch();
        loadLive.last = '';
        await loadLive();
    }

    async function lookup(query) {
        const box = $('lookup-result');
        const local = orders.find((order) => order.vin === query.toUpperCase().replace(/\s/g, '') || String(order.orderNumber) === query);
        const orderNumber = local && local.orderNumber && local.orderNumber !== 'NO ORDER' ? local.orderNumber : query;
        let bo = null;
        try {
            const res = await fetch('/api/bo-data/order/' + encodeURIComponent(orderNumber));
            if (res.ok) bo = await res.json();
        } catch (e) { bo = null; }
        const details = (bo && bo.details) || {};
        const queue = bo && bo.queue && bo.queue.queueResult;
        const values = (bo && bo.queue && bo.queue.values) || {};
        if (!local && !bo) {
            box.innerHTML = '<div class="lookup-result">No reserved order or back order matched that VIN or order number.</div>';
            return;
        }
        box.innerHTML = `<div class="lookup-result"><strong>${esc((bo && bo.orderNumber) || orderNumber)}</strong>
            <div class="facts" style="margin-top:10px;">
                <div><span>Vehicle</span><strong>${esc(values.product || (local && local.vehicle) || details.Product || '—')}</strong></div>
                <div><span>Suffix</span><strong>${esc(values.suffix || '—')}</strong></div>
                <div><span>Exterior</span><strong>${esc(values.extColor1 || (local && local.exterior) || '—')}</strong></div>
                <div><span>Interior</span><strong>${esc(values.intColor1 || (local && local.interior) || '—')}</strong></div>
                <div><span>Payment</span><strong>${esc((local && local.paymentLabel) || '—')}</strong></div>
                <div><span>Advisor</span><strong>${esc((local && local.salesAdvisor) || '—')}</strong></div>
                <div><span>BO queue</span><strong>${queue && queue.position ? '#' + queue.position + ' of ' + queue.totalQueueSize : '—'}</strong></div>
                <div><span>Orders ahead</span><strong>${queue && queue.ordersAhead != null ? queue.ordersAhead : '—'}</strong></div>
            </div></div>`;
    }
    async function loadVehicles() {
        let products = [];
        try {
            const res = await fetch('/api/bo-data/taxonomy');
            if (res.ok) products = (await res.json()).products || [];
        } catch (e) { products = []; }
        const source = products.length ? products.map((item) => [item.product, item.rowCount, item.suffixes || []]) : CARS.map(([name]) => [name, 0, []]);
        $('vehicles').innerHTML = source.slice(0, 18).map(([name, count, suffixes]) => {
            const img = carImage(name);
            return `<button class="vehicle" type="button" data-name="${esc(name)}" data-suffixes="${esc(JSON.stringify(suffixes))}"><img src="${img}" alt="" onerror="this.style.display='none'"><b>${esc(name)}</b><span>${count || 0} orders</span></button>`;
        }).join('');
    }
    function showVehicle(button) {
        let suffixes = [];
        try { suffixes = JSON.parse(button.dataset.suffixes || '[]'); } catch (e) { suffixes = []; }
        $('vehicle-detail').innerHTML = `<div class="vehicle-detail"><strong>${esc(button.dataset.name)}</strong><p>${suffixes.length ? suffixes.map((item) => esc(item.suffix || item) + (item.rowCount ? ' · ' + item.rowCount : '')).join('<br>') : 'No suffix breakdown until a Back Order file is uploaded.'}</p></div>`;
    }

    function price(n) { return Number(n || 0).toLocaleString('en-US'); }
    function buildMessage() {
        const car = $('msg-car').value;
        const model = (carsData[car] || [])[Number($('msg-model').value)];
        if (!car || !model) return '';
        const customer = $('msg-customer').value.trim();
        const advisor = $('msg-advisor').value.trim() || 'Toyota Sales';
        const note = $('msg-note').value.trim();
        const type = $('msg-type').value;
        const lang = $('msg-lang').value;
        const arType = { followup: 'شكراً لتواصلك معنا', quote: 'هذا عرض السعر', showroom: 'ندعوك لزيارة المعرض', finance: 'يمكننا ترتيب التقسيط أو التأجير' }[type];
        const enType = { followup: 'Thank you for speaking with us', quote: 'Here is the price', showroom: 'You are invited to the showroom', finance: 'We can arrange finance or lease options' }[type];
        const ar = `السلام عليكم ${customer}،\n${arType} بخصوص تويوتا ${car} — ${model.name}.\nالسعر ${price(model.price)} ريال.${note ? '\n' + note : ''}\nمع تحيات ${advisor}`;
        const en = `Hello ${customer},\n${enType} for the Toyota ${car} — ${model.name}.\nPrice ${price(model.price)} SAR.${note ? '\n' + note : ''}\nRegards, ${advisor}`;
        if (lang === 'ar') return ar;
        if (lang === 'en') return en;
        return ar + '\n\n' + en;
    }
    function paintMessage() {
        const text = buildMessage();
        $('msg-preview').textContent = text || 'Select a car and model to generate the message.';
        const car = $('msg-car').value;
        const img = carImage(car);
        $('msg-preview-car').innerHTML = car ? `${img ? `<img src="${img}" alt="" onerror="this.style.display='none'">` : ''}<div><strong>Toyota ${esc(car)}</strong></div>` : '';
    }
    async function loadCars() {
        try {
            const data = await fetch('cars-catalog.json').then((res) => res.json());
            carsData = data;
        } catch (e) { carsData = {}; }
        $('msg-car').innerHTML = '<option value="">Select car</option>' + Object.keys(carsData).sort().map((name) => `<option>${esc(name)}</option>`).join('');
    }
    function fillModels() {
        const models = carsData[$('msg-car').value] || [];
        $('msg-model').innerHTML = models.map((model, index) => `<option value="${index}">${esc(model.name)} — ${price(model.price)} SAR</option>`).join('');
        paintMessage();
    }
    function phone(raw) {
        const digits = String(raw || '').replace(/\D/g, '');
        if (!digits) return '';
        if (digits.startsWith('0')) return '966' + digits.slice(1);
        if (digits.startsWith('966')) return digits;
        return digits;
    }

    function showView(name) {
        $('overlay-lookup').classList.toggle('hidden', name !== 'lookup');
        $('overlay-message').classList.toggle('hidden', name !== 'message');
        if (name !== 'all') $('overlay-all').classList.add('hidden');
        document.querySelectorAll('#app .jump button').forEach((button) => button.classList.toggle('nav-on', button.dataset.view === name));
        if (name === 'lookup') loadVehicles();
    }
    $('login-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        $('login-error').textContent = '';
        const select = $('employee-name');
        const password = $('employee-id').value;
        if (select.value === '__admin__') {
            if (password !== '1234') { $('login-error').textContent = 'Admin password was not accepted.'; return; }
            sessionStorage.removeItem(sessionKey);
            sessionStorage.setItem('reserved-orders-admin-pass', '1234');
            $('employee-id').value = '';
            location.href = 'reserved-orders-admin.html';
            return;
        }
        const res = await fetch('/api/reserved-orders/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recordId: select.value, name: select.selectedOptions[0] ? select.selectedOptions[0].textContent : '', password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { $('login-error').textContent = data.error || 'Could not sign in.'; return; }
        writeSession({ token: data.token, name: data.name, employeeNumber: data.employeeNumber, recordId: data.recordId, last: Date.now() });
        $('employee-id').value = '';
        openApp();
    });
    $('logout').addEventListener('click', () => endSession('logout'));
    ['click', 'keydown', 'input', 'change', 'scroll'].forEach((type) => window.addEventListener(type, touch, { passive: true }));
    document.addEventListener('change', (event) => {
        const select = event.target.closest('.status-select');
        if (!select) return;
        const card = select.closest('.lane');
        if (!card) return;
        changeStatus(card.dataset.key, select.value);
    });
    ['search', 'filter-status', 'filter-payment', 'filter-advisor', 'filter-queue', 'filter-state', 'sort'].forEach((id) => {
        $(id).addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
        $(id).addEventListener('change', render);
    });
    $('view-all').addEventListener('click', () => { renderAll(); $('overlay-all').classList.remove('hidden'); });
    $('close-all').addEventListener('click', () => $('overlay-all').classList.add('hidden'));
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
    $('lookup-form').addEventListener('submit', (event) => { event.preventDefault(); lookup($('lookup-q').value.trim()); });
    $('vehicles').addEventListener('click', (event) => { const button = event.target.closest('.vehicle'); if (button) showVehicle(button); });
    ['msg-customer', 'msg-advisor', 'msg-phone', 'msg-type', 'msg-lang', 'msg-note', 'msg-model'].forEach((id) => $(id).addEventListener('input', paintMessage));
    $('msg-car').addEventListener('change', fillModels);
    $('msg-wa').addEventListener('click', () => {
        const text = buildMessage();
        if (!text) return;
        const number = phone($('msg-phone').value);
        window.open((number ? `https://wa.me/${number}?text=` : 'https://wa.me/?text=') + encodeURIComponent(text), '_blank', 'noopener');
    });
    $('msg-copy').addEventListener('click', () => { const text = buildMessage(); if (text) navigator.clipboard.writeText(text).catch(() => {}); });
    $('msg-reset').addEventListener('click', () => { ['msg-customer', 'msg-phone', 'msg-note'].forEach((id) => { $(id).value = ''; }); paintMessage(); });

    function openApp() {
        const session = readSession();
        if (!session || Date.now() - session.last >= IDLE_MS) return endSession('timeout');
        $('login').classList.add('hidden');
        $('app').classList.remove('hidden');
        document.body.classList.add('dash');
        showView('orders');
        $('who').textContent = session.name;
        $('who-id').textContent = 'ID: ' + session.employeeNumber;
        $('msg-advisor').value = session.name;
        loadLive();
        loadVehicles();
        if (clock) clearInterval(clock);
        clock = setInterval(tickTimers, 1000);
    }
    try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${protocol}//${location.host}`);
        socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'reserved_orders_updated' || msg.type === 'report_sheet_updated') loadLive();
        });
    } catch (e) { /* polling remains */ }
    setInterval(() => { if (readSession()) loadLive(); }, 8000);
    loadNames();
    loadCars();
    if (readSession()) openApp();
})();
