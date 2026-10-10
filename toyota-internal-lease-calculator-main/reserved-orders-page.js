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
    let alertRules = [];
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
    function chosen(id) {
        const value = String($(id).value || '').trim();
        if (!value || value.toLowerCase() === 'all') return '';
        return value;
    }
    function restoreSelect(select, value) {
        const wanted = value && Array.from(select.options).some((opt) => opt.value === value) ? value : '';
        select.value = wanted;
    }
    async function loadLive() {
        let data;
        try {
            const res = await fetch('/api/reserved-orders/live');
            data = await res.json();
            if (!res.ok) throw new Error(data.error || ('Live data request failed (' + res.status + ')'));
        } catch (err) {
            console.error('Reserved Orders load failed:', err);
            orders = [];
            $('cards').innerHTML = '<div class="empty">Reserved orders could not be loaded.</div>';
            return;
        }
        const next = Array.isArray(data.orders) ? data.orders : [];
        orders = next;
        const stamp = $('updated-at');
        if (stamp) stamp.textContent = data.updatedAt ? `Live data ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for a live push';
        const payload = [data.updatedAt || '', next.length, next[0] && next[0].statusChangedAt || '', next[0] && next[0].status || ''].join('|');
        if (payload === loadLive.last && document.querySelector('#cards .lane')) return tickTimers();
        loadLive.last = payload;
        fillFilters();
        render();
    }
    function fillFilters() {
        const status = $('filter-status');
        const advisor = $('filter-advisor');
        const queue = $('filter-queue');
        const keep = [status.value, advisor.value, queue.value];
        status.innerHTML = '<option value="">All</option>' + STATUSES.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
        const advisors = Array.from(new Set(orders.map((order) => order.salesAdvisor).filter((name) => name && name !== 'UNASSIGNED'))).sort();
        const unassigned = orders.some((order) => order.salesAdvisor === 'UNASSIGNED') ? '<option value="UNASSIGNED">UNASSIGNED</option>' : '';
        advisor.innerHTML = '<option value="">All</option>' + advisors.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('') + unassigned;
        const queues = Array.from(new Set(orders.map((order) => order.queueNumber).filter((n) => n != null))).sort((a, b) => a - b);
        queue.innerHTML = '<option value="">All</option>' + queues.map((n) => `<option value="${n}">#${n}</option>`).join('');
        restoreSelect(status, keep[0]);
        restoreSelect(advisor, keep[1]);
        restoreSelect(queue, keep[2]);
    }
    function visibleOrders() {
        const q = $('search').value.trim().toLowerCase();
        const status = chosen('filter-status');
        const payment = chosen('filter-payment');
        const advisor = chosen('filter-advisor');
        const queue = chosen('filter-queue');
        const state = chosen('filter-state');
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
            ['Total reserved', orders.length, ''],
            ['Active orders', orders.filter(isActive).length, 'ok'],
            ['Expired', expired, 'bad'],
            ['Completed / invoiced', orders.filter(isCompleted).length, 'ok'],
            ['Approaching deadline', soon, 'warn']
        ].map(([label, value, cls]) => `<article class="kpi ${cls}"><em>${label}</em><strong>${value}</strong></article>`).join('');
        const leaders = queueLeaderHtml();
        $('cards').innerHTML = list.length ? list.map((order) => cardHtml(order, leaders)).join('') : '<div class="empty">No reserved orders match this view.</div>';
    }
    function queueLeaderHtml() {
        const found = new Map();
        orders.forEach((item) => {
            const n = Number(item.queueNumber);
            if ((n === 1 || n === 2 || n === 3) && !found.has(n)) found.set(n, item);
        });
        return [1, 2, 3].map((n) => {
            const item = found.get(n);
            const advisor = !item ? '—' : (item.salesAdvisor || 'UNASSIGNED');
            return `<b>#${n} ${esc(advisor)}</b>`;
        }).join('');
    }
    function retailMatch(value) {
        const text = String(value || '').trim().toLowerCase();
        return text === 'rtlesal' || text.includes('retail electronic sales');
    }
    function ageFlag(days) {
        if (days == null || days === '' || Number.isNaN(Number(days))) return '<span class="flag">Age —</span>';
        const n = Number(days);
        const tone = n <= 5 ? 'good' : n === 6 ? 'warn' : 'bad';
        return `<span class="flag ${tone}">Age ${n}d</span>`;
    }
    function stockFlag(label, value) {
        const shown = value && value !== '—' ? value : '—';
        return `<span class="flag ${retailMatch(shown) ? 'good' : 'bad'}">${label} ${esc(shown)}</span>`;
    }
    function fieldTone(label, value) {
        const name = String(label || '').toLowerCase();
        if (/search area|share|sharing/.test(name)) return retailMatch(value) ? 'good' : 'bad';
        if (/allocation ag|vin allocation|^age$|ageing|aging/.test(name)) {
            const match = String(value || '').match(/-?\d+/);
            if (!match) return '';
            const n = Number(match[0]);
            return n <= 5 ? 'good' : n === 6 ? 'warn' : 'bad';
        }
        return '';
    }
    function excelFieldsHtml(order) {
        const fields = Array.isArray(order.fields) ? order.fields : [];
        if (!fields.length) return '';
        return `<div class="excel-row">${fields.map((field) => {
            const tone = fieldTone(field.label, field.value);
            return `<div class="excel-field${tone ? ' ' + tone : ''}"><span>${esc(field.label)}</span><b>${esc(field.value || '—')}</b></div>`;
        }).join('')}</div>`;
    }
    function cardHtml(order, leaders) {
        const ms = remainingMs(order);
        const hours = order.paymentHours || 48;
        const img = carImage(order.vehicle);
        return `<article class="order-block${isExpired(order) ? ' expired' : ''}">
            <div class="lane${isExpired(order) ? ' expired' : ''}" data-key="${esc(order.key)}">
            <div class="lane-id"><div class="qmark">#${order.queueNumber == null ? '—' : order.queueNumber}</div>${img ? `<img class="car" src="${img}" alt="" onerror="this.style.display='none'">` : ''}</div>
            <div><b>${esc(order.orderNumber && order.orderNumber !== 'NO ORDER' ? 'ORDER #' + order.orderNumber : '#NO ORDER')}</b><span class="vin-line"><span class="muted">VIN ${esc(show(order.vin, 'VIN NOT FOUND'))}</span>${ageFlag(order.allocationAging)}</span><span class="muted">${esc(order.customerName || '—')}</span></div>
            <div><b>${esc(order.vehicle || '—')}</b><span class="muted">${esc(order.modelYear || '—')}</span><span class="muted">${esc(order.exterior || '—')} / ${esc(order.interior || '—')}</span>${stockFlag('Area', order.searchArea)}${stockFlag('Share', order.shareLevel)}</div>
            <div><b>${esc(show(order.salesAdvisor, 'UNASSIGNED'))}</b><span class="muted">${esc(show(order.paymentLabel, 'UNKNOWN'))}</span><span class="muted">${esc(order.assignDisplay || 'NO ASSIGN DATE')}</span></div>
            <div class="queue-top"><span class="muted">Ahead</span>${leaders}</div>
            <div><div class="timer ${timerClass(ms)}" data-deadline="${esc(order.deadline || '')}">${formatRemain(ms)}</div><span class="muted">${hours} HOURS</span></div>
            <div><span class="badge ${badge(order.status)}">${esc(order.status || 'محجوز')}</span><div class="status-row"><select class="status-select" aria-label="Change status">${STATUSES.map((status) => `<option${status === order.status ? ' selected' : ''}>${esc(status)}</option>`).join('')}</select></div></div>
            </div>
            ${excelFieldsHtml(order)}
        </article>`;
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

    async function loadAlertRules() {
        try {
            const data = await fetch('/api/reserved-orders/alert-rules').then((res) => res.json());
            alertRules = data.alerts || [];
        } catch (e) { alertRules = []; }
    }
    function paintMessageAlerts() {
        const box = $('msg-alert-list');
        if (!box) return;
        const car = String($('msg-car') && $('msg-car').value || '').trim().toLowerCase();
        const rules = alertRules.filter((rule) => {
            if (rule.kind !== 'bo_error' || rule.active === false || !rule.message) return false;
            if (!car || !rule.product) return true;
            const product = String(rule.product).toLowerCase();
            return product === car || car.includes(product) || product.includes(car);
        });
        box.innerHTML = rules.length ? rules.map((rule) => `<div class="msg-alert ${esc(rule.tone || 'info')}" role="alert"><small>${esc(rule.errorLabel || 'BO error')}${rule.product ? ' · ' + esc(rule.product) : ''}</small>${esc(rule.message)}</div>`).join('') : '<p class="muted">No alerts from admin for this view.</p>';
    }
    function alertMatches(rule, bag) {
        if (!rule || rule.kind === 'bo_error') return false;
        const left = String(bag[String(rule.field || '').toLowerCase()] == null ? '' : bag[String(rule.field || '').toLowerCase()]).trim();
        const right = String(rule.value || '').trim();
        const op = rule.operator || 'equals';
        if (op === 'empty') return !left;
        if (op === 'not_empty') return !!left;
        const a = left.toLowerCase();
        const b = right.toLowerCase();
        if (op === 'equals') return a === b;
        if (op === 'not_equals') return a !== b;
        if (op === 'contains') return b ? a.includes(b) : false;
        if (op === 'not_contains') return b ? !a.includes(b) : true;
        const na = Number(left.replace(/,/g, ''));
        const nb = Number(right.replace(/,/g, ''));
        if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
        if (op === 'gt') return na > nb;
        if (op === 'lt') return na < nb;
        return false;
    }
    function paintAlerts(bo, query) {
        const box = $('lookup-alerts');
        if (!box) return;
        const bag = {};
        const details = (bo && bo.details) || {};
        Object.keys(details).forEach((key) => { bag[String(key).toLowerCase()] = details[key]; });
        const values = (bo && bo.queue && bo.queue.values) || {};
        Object.keys(values).forEach((key) => {
            const name = String(key).toLowerCase();
            if (bag[name] == null || bag[name] === '') bag[name] = values[key];
        });
        const hits = bo ? alertRules.filter((rule) => alertMatches(rule, bag)) : [];
        box.innerHTML = hits.map((rule) => `<div class="bo-alert ${esc(rule.tone || 'info')}" role="alert">${esc(rule.message)}</div>`).join('');
        if (query) {
            fetch('/api/reserved-orders/alerts/match?q=' + encodeURIComponent(query))
                .then((res) => res.json())
                .then((data) => {
                    const extra = (data.alerts || []).filter((rule) => !hits.some((hit) => hit.message === rule.message));
                    if (!extra.length) return;
                    box.insertAdjacentHTML('beforeend', extra.map((rule) => `<div class="bo-alert ${esc(rule.tone || 'info')}" role="alert">${esc(rule.message)}</div>`).join(''));
                })
                .catch(() => {});
        }
    }
    function pushedFacts(title, pairs) {
        const chips = pairs.filter((item) => item && item.label).map((item) => `<div><span>${esc(item.label)}</span><strong class="${esc(item.tone || '')}">${esc(item.value || '—')}</strong></div>`).join('');
        return chips ? `<h4>${esc(title)}</h4><div class="bo-facts">${chips}</div>` : '';
    }
    async function lookup(query) {
        const box = $('lookup-result');
        paintAlerts(null);
        if (!query) { box.innerHTML = ''; return; }
        let pushed = null;
        try {
            const res = await fetch('/api/reserved-orders/lookup?q=' + encodeURIComponent(query));
            if (res.ok) pushed = await res.json();
        } catch (e) { pushed = null; }
        const local = (pushed && pushed.order) || orders.find((order) => order.vin === query.toUpperCase().replace(/\s/g, '') || String(order.orderNumber) === query);
        const orderNumber = local && local.orderNumber && local.orderNumber !== 'NO ORDER' ? local.orderNumber : query;
        let bo = pushed && pushed.bo ? { orderNumber: pushed.bo.orderNumber, details: pushed.bo.details || {} } : null;
        try {
            const res = await fetch('/api/bo-data/order/' + encodeURIComponent(orderNumber));
            if (res.ok) {
                const extra = await res.json();
                if (!bo) bo = extra;
                else bo.queue = extra.queue;
            }
        } catch (e) { /* Report Sheet push supplies the row when this API is absent */ }
        const details = (bo && bo.details) || {};
        const queue = bo && bo.queue && bo.queue.queueResult;
        const values = (bo && bo.queue && bo.queue.values) || {};
        if (!local && !bo) {
            box.innerHTML = '<div class="bo-result"><h3>No match</h3><p>No reserved order or back order matched that VIN or order number.</p></div>';
            paintAlerts(null, query);
            return;
        }
        paintAlerts(bo, query);
        const age = local && local.allocationAging != null ? local.allocationAging : null;
        const ageTone = age == null ? '' : (age <= 5 ? 'good' : (age === 6 ? 'warn' : 'bad'));
        const boPairs = Object.keys(details).map((key) => ({ label: key, value: details[key] == null || details[key] === '' ? '—' : details[key] }));
        box.innerHTML = `<div class="bo-result"><h3>${esc((bo && bo.orderNumber) || orderNumber)}</h3>
            <p>E-Sales, Back Order, and RTL from the latest Report Sheet push.</p>
            ${pushedFacts('E-Sales', [
                { label: 'Order', value: local && local.orderNumber },
                { label: 'VIN', value: local && local.vin },
                { label: 'Vehicle', value: (local && local.vehicle) || values.product || (pushed && pushed.bo && pushed.bo.vehicle) },
                { label: 'Advisor', value: local && local.salesAdvisor },
                { label: 'Payment', value: local && local.paymentLabel },
                { label: 'Assign date', value: local && (local.assignDisplay || local.assignDate) },
                { label: 'Search area', value: local && local.searchArea },
                { label: 'Share level', value: local && local.shareLevel }
            ])}
            ${pushedFacts('RTL', [{ label: 'Allocation aging', value: age == null ? '—' : age + ' days', tone: ageTone }])}
            ${pushedFacts('Back Order', boPairs.length ? boPairs : [
                { label: 'Vehicle', value: values.product || (pushed && pushed.bo && pushed.bo.vehicle) },
                { label: 'Exterior', value: values.extColor1 || (pushed && pushed.bo && pushed.bo.exterior) },
                { label: 'Interior', value: values.intColor1 || (pushed && pushed.bo && pushed.bo.interior) },
                { label: 'BO queue', value: queue && queue.position ? '#' + queue.position + ' of ' + queue.totalQueueSize : '' },
                { label: 'Orders ahead', value: queue && queue.ordersAhead != null ? queue.ordersAhead : '' }
            ])}
        </div>`;
    }
    async function loadVehicles() {
        let products = [];
        try {
            const pushed = await fetch('/api/reserved-orders/bo-products');
            if (pushed.ok) products = (await pushed.json()).products || [];
        } catch (e) { products = []; }
        if (!products.length) {
            try {
                const res = await fetch('/api/bo-data/taxonomy');
                if (res.ok) products = (await res.json()).products || [];
            } catch (e) { products = []; }
        }
        const source = products.length ? products.map((item) => [item.product, item.rowCount, item.suffixes || []]) : CARS.map(([name]) => [name, 0, []]);
        $('vehicles').innerHTML = source.map(([name, count, suffixes]) => {
            const img = carImage(name);
            const suffixCount = Array.isArray(suffixes) ? suffixes.length : 0;
            return `<button class="product-card vehicle" type="button" data-name="${esc(name)}" data-suffixes="${esc(JSON.stringify(suffixes))}">
                <div class="pc-pill">${count || 0} on order</div>
                <div class="pc-img-wrap">${img ? `<img src="${img}" alt="" onerror="this.style.display='none'">` : ''}<div class="pc-fallback"${img ? ' style="display:none"' : ''}>${esc(name)}</div></div>
                <div class="pc-name">${esc(name)}</div>
                <div class="pc-meta">${suffixCount === 1 ? '1 suffix' : suffixCount + ' suffixes'}</div>
            </button>`;
        }).join('');
    }
    function showVehicle(button) {
        document.querySelectorAll('#vehicles .product-card').forEach((card) => card.classList.toggle('selected', card === button));
        let suffixes = [];
        try { suffixes = JSON.parse(button.dataset.suffixes || '[]'); } catch (e) { suffixes = []; }
        $('vehicle-detail').innerHTML = `<div class="bo-result"><h3>${esc(button.dataset.name)}</h3><p>${suffixes.length ? suffixes.map((item) => esc(item.suffix || item) + (item.rowCount ? ' · ' + item.rowCount : '')).join('<br>') : 'No suffix breakdown until a Back Order file is uploaded.'}</p></div>`;
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
        paintMessageAlerts();
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
        document.querySelectorAll('#app .jump button').forEach((button) => button.classList.toggle('nav-on', button.dataset.view === name));
        if (name === 'lookup') { loadVehicles(); loadAlertRules(); }
        if (name === 'message') loadAlertRules().then(paintMessageAlerts);
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

    async function paintMyAlerts() {
        const box = $('my-bo-alerts');
        const session = readSession();
        if (!box || !session) return;
        const res = await fetch('/api/reserved-orders/my-bo-corrections?token=' + encodeURIComponent(session.token));
        if (!res.ok) return;
        const data = await res.json();
        const items = data.alerts || [];
        box.innerHTML = items.map((item) => `<article class="my-alert">
            <h3>BO Correction Required</h3>
            <p><b>${esc(item.name)}</b> · ${esc(item.product || 'All cars')} · ${esc(item.column)}</p>
            <p>Incorrect: ${esc(item.incorrectValue || 'blank')} · Correct: ${esc(item.correctValue || '—')} · Orders: ${item.affectedOrderCount}</p>
            <p>${esc(item.message)}</p>
            <p>Status: ${esc(item.status)}</p>
            <button type="button" data-my-orders="${esc(item.ruleId)}">View My Orders</button>
            <button type="button" data-my-status="viewed" data-rule="${esc(item.ruleId)}">Viewed</button>
            <button type="button" data-my-status="in_progress" data-rule="${esc(item.ruleId)}">In Progress</button>
            <button type="button" data-my-status="completed" data-rule="${esc(item.ruleId)}">Completed</button>
            <div id="my-orders-${esc(item.ruleId)}"></div>
        </article>`).join('');
        box.querySelectorAll('[data-my-orders]').forEach((button) => button.addEventListener('click', () => {
            const item = items.find((row) => row.ruleId === button.dataset.myOrders);
            const target = document.getElementById('my-orders-' + item.ruleId);
            target.innerHTML = `<table class="br-table"><thead><tr><th>Back Order Number</th><th>Product</th><th>Model Year</th><th>Current</th><th>Correct</th><th>Order Date</th><th></th></tr></thead><tbody>
                ${(item.orders || []).map((order) => `<tr><td>${esc(order.boNumber)}</td><td>${esc(order.product)}</td><td>${esc(order.modelYear)}</td><td>${esc(order.currentValue)}</td><td>${esc(order.correctValue)}</td><td>${esc(order.orderDate)}</td><td><button type="button" data-order-done="${esc(item.ruleId)}" data-bo="${esc(order.boNumber)}">Completed</button></td></tr>`).join('')}
            </tbody></table>`;
            markAlert(item.ruleId, 'viewed');
            target.querySelectorAll('[data-order-done]').forEach((done) => done.addEventListener('click', () => markAlert(done.dataset.orderDone, 'completed', done.dataset.bo)));
        }));
        box.querySelectorAll('[data-my-status]').forEach((button) => button.addEventListener('click', () => markAlert(button.dataset.rule, button.dataset.myStatus)));
    }
    async function markAlert(ruleId, status, boNumber) {
        const session = readSession();
        if (!session) return;
        await fetch('/api/reserved-orders/my-bo-corrections/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: session.token, ruleId, status, boNumber }) });
        paintMyAlerts();
    }
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
        paintMyAlerts();
        if (clock) clearInterval(clock);
        clock = setInterval(tickTimers, 1000);
    }
    try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${protocol}//${location.host}`);
        socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'reserved_orders_updated' || msg.type === 'report_sheet_updated') { loadLive(); paintMyAlerts(); }
        });
    } catch (e) { /* polling remains */ }
    setInterval(() => { if (readSession()) loadLive(); }, 8000);
    loadNames();
    loadCars();
    if (readSession()) openApp();
})();
