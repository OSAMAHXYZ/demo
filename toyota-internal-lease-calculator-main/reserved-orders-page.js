(function () {
    // Employees choose one of only three statuses, and write a note with it.
    const STATUSES = ['Payment', 'In progress', 'Cancelled'];
    const NOT_UPDATED = '__none__'; // filter value for orders that have no status yet
    const CARS = [
        ['Camry', 'images/cars/camry.png'], ['Corolla', 'images/cars/corolla.png'], ['Crown', 'images/cars/crown.png'],
        ['Fortuner', 'images/cars/fortuner.png'], ['Highlander', 'images/cars/highlander.png'], ['Hilux', 'images/cars/hilux double cab.png'],
        ['Land Cruiser', 'images/cars/land cruiser.png'], ['Prado', 'images/cars/prado.png'], ['RAV4', 'images/cars/rav4.png'],
        ['Raize', 'images/cars/raize.png'], ['Yaris', 'images/cars/yaris.png'], ['Innova', 'images/cars/innova.png'],
        ['Veloz', 'images/cars/veloz.png'], ['Urban Cruiser', 'images/cars/urban cruiser.png'], ['Corolla Cross', 'images/cars/corolla cross.png'],
        ['GR86', 'images/cars/gr86.png']
    ];
    // Extra names for the pictures in images/cars (used only to find a picture). The longest matching name wins,
    // so "Corolla Cross" is not shown as "Corolla" and "Hilux Single Cab" is not shown as the double cab.
    const CAR_IMAGE_ALIASES = [
        ['Hilux Double Cab', 'images/cars/hilux double cab.png'], ['Hilux Single Cab', 'images/cars/Hilux single cab.png'],
        ['Land Cruiser Hardtop', 'images/cars/land cruiser hard top.png'], ['Land Cruiser Hard Top', 'images/cars/land cruiser hard top.png'],
        ['Land Cruiser Pickup', 'images/cars/land cruiser pickup.png'], ['Land Cruiser Prado', 'images/cars/prado.png'],
        ['LC300 HEV', 'images/cars/lc300 hev max.png'], ['LC300', 'images/cars/land cruiser.png'], ['LC 300', 'images/cars/land cruiser.png'],
        ['Coaster', 'images/cars/coaster.png'], ['Hiace Bus', 'images/cars/hiace bus.png'], ['Hiace Van', 'images/cars/hiace van.png'],
        ['Hiace', 'images/cars/hiace van.png'], ['Lite Ace', 'images/cars/lite ace.png'], ['Supra', 'images/cars/supra.png'],
        ['Lexus ES', 'images/cars/lexus es.png'], ['Lexus IS', 'images/cars/lexus is.png'], ['Lexus NX', 'images/cars/lexus nx.png'],
        ['Lexus RX', 'images/cars/lexus rx.png'], ['Lexus UX', 'images/cars/lexus ux.png'],
        ['Hilux Single', 'images/cars/Hilux single cab.png'], ['Hilux DC', 'images/cars/hilux double cab.png'], ['Hilux SC', 'images/cars/Hilux single cab.png']
    ];
    const CAR_ICON = '<svg class="car-icon" viewBox="0 0 64 32" width="46" height="23" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 22v-5l6-2 7-7h22l9 7 9 2v5"/><path d="M5 22h5M19 22h26M54 22h5"/><circle cx="14.5" cy="23" r="4.5"/><circle cx="49.5" cy="23" r="4.5"/><path d="M19 15h27"/></svg>';
    const IDLE_MS = 30 * 60 * 1000;
    const sessionKey = 'reserved-orders-session';
    let orders = [];
    let carsData = {};
    let alertRules = [];
    let boAlerts = [];
    let mcKey = '';
    let mcQuery = '';
    let mcNotice = '';
    const mcDrafts = {};
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
        if (ms == null) return '';
        if (ms <= 0) return 'EXPIRED';
        const total = Math.floor(ms / 1000);
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    }
    function timerLabel(dateText, ms) {
        if (!dateText) return 'No Expiry Date';
        const remain = formatRemain(ms);
        return remain ? `${dateText} ( ${remain} )` : dateText;
    }
    // Green until 4h past expiry; yellow from 4–8h overdue; red after 8h overdue.
    function timerClass(ms) {
        if (ms == null) return '';
        if (ms > -4 * 3600000) return 'ok';
        if (ms > -8 * 3600000) return 'soon';
        return 'expired';
    }
    function isExpired(order) { const ms = remainingMs(order); return ms != null && ms <= 0; }
    function isCompleted(order) { return order.status === 'تم الفوترة' || order.status === 'Payment'; }
    function isCancelled(order) { return order.status === 'الغاء' || order.status === 'Cancelled'; }
    function isActive(order) { return !isExpired(order) && !isCompleted(order) && !isCancelled(order); }
    function isSoon(order) {
        if (isCancelled(order) || isCompleted(order)) return false;
        const ms = remainingMs(order);
        return ms != null && ms <= -4 * 3600000 && ms > -8 * 3600000;
    }
    function hasNoAssign(order) { return remainingMs(order) == null; }
    function queueLabel(n) {
        if (n == null || n === '') return '#—';
        const num = Number(n);
        return '#' + (Number.isFinite(num) ? pad(num) : n);
    }
    function badge(status) {
        if (status === 'تم الفوترة' || status === 'Payment') return 'done';
        if (status === 'الغاء' || status === 'Cancelled') return 'cancel';
        if (status === 'محجوز' || status === 'In progress' || status === 'انتظار تحويل' || status === 'انتظار رد الضيف') return 'wait';
        return '';
    }
    function show(value, missing) { return value ? value : missing; }
    function carImage() {
        // Try each name given (product, vehicle, ...) until one matches a picture; longest matching car name wins.
        for (let i = 0; i < arguments.length; i += 1) {
            const text = String(arguments[i] || '').toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            let best = null;
            CAR_IMAGE_ALIASES.concat(CARS).forEach(([label, src]) => {
                const key = label.toLowerCase();
                if (text.includes(key) && (!best || key.length > best.len)) best = { len: key.length, src };
            });
            if (best) return best.src;
        }
        return '';
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
        try { notifyMyNewOrders(); } catch (e) { console.error('New-order alert failed:', e); }
        const stamp = $('updated-at');
        if (stamp) stamp.textContent = data.updatedAt ? `Live data ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for a live push';
        const payload = [data.updatedAt || '', next.length, next[0] && next[0].statusChangedAt || '', next[0] && next[0].status || '', STATUSES.join('|')].join('|');
        if (payload === loadLive.last && document.querySelector('#cards .rc-tile, #emp-sheet .xl-grid')) return tickTimers();
        loadLive.last = payload;
        fillFilters();
        render();
    }
    function fillFilters() {
        const status = $('filter-status');
        const advisor = $('filter-advisor');
        const queue = $('filter-queue');
        const product = $('filter-product');
        const area = $('filter-area');
        const keep = [status.value, advisor.value, queue.value, product.value, area.value];
        status.innerHTML = '<option value="">All statuses</option>' + STATUSES.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('') + `<option value="${NOT_UPDATED}">Not updated</option>`;
        // Filters list exactly what the sheet columns show (salesman = column A, product = column E, area = RTL column N).
        const rows = dataOrders().map((order) => sheetValues(order));
        const distinct = (key) => Array.from(new Set(rows.map((row) => row[key]).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));
        advisor.innerHTML = '<option value="">All salesmen</option>' + distinct('Salesman name').map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
        const queues = Array.from(new Set(dataOrders().map((order) => order.boQueuePosition).filter((n) => n != null))).sort((a, b) => a - b);
        queue.innerHTML = '<option value="">All queues</option>' + queues.map((n) => `<option value="${n}">#${n}</option>`).join('');
        product.innerHTML = '<option value="">All cars</option>' + distinct('Product').map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
        const areas = distinct('Area');
        area.innerHTML = '<option value="">All areas</option>' + areas.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
        restoreSelect(status, keep[0]);
        restoreSelect(advisor, keep[1]);
        restoreSelect(queue, keep[2]);
        restoreSelect(product, keep[3]);
        restoreSelect(area, keep[4]);
    }
    function visibleOrders() {
        const q = $('search').value.trim().toLowerCase();
        const status = chosen('filter-status');
        const product = chosen('filter-product');
        const area = chosen('filter-area');
        const advisor = chosen('filter-advisor');
        const queue = chosen('filter-queue');
        const sort = $('sort').value;
        const list = dataOrders().filter((order) => {
            const row = sheetValues(order);
            if (q && ![row.VIN, row['Order number'], row['Customer name'], row['Salesman name'], row.Product, order.statusNote].join(' ').toLowerCase().includes(q)) return false;
            if (status === NOT_UPDATED) { if (statusKey(order.status)) return false; }
            else if (status && statusKey(order.status) !== status) return false;
            if (product && row.Product !== product) return false;
            if (area && row.Area !== area) return false;
            if (advisor && row['Salesman name'] !== advisor) return false;
            if (queue && String(order.boQueuePosition) !== queue) return false;
            return true;
        });
        const pos = (order) => (order.boQueuePosition == null ? 9e9 : Number(order.boQueuePosition));
        list.sort((a, b) => {
            if (sort === 'queue-desc') return (b.boQueuePosition == null ? -1 : Number(b.boQueuePosition)) - (a.boQueuePosition == null ? -1 : Number(a.boQueuePosition));
            if (sort === 'remaining') return (remainingMs(a) ?? 9e15) - (remainingMs(b) ?? 9e15);
            return pos(a) - pos(b) || (a.queueNumber || 0) - (b.queueNumber || 0);
        });
        return list;
    }
    function activeKpi() {
        const extras = $('search').value.trim() || chosen('filter-product') || chosen('filter-area') || chosen('filter-advisor') || chosen('filter-queue');
        if (extras) return '';
        const status = chosen('filter-status');
        if (!status) return 'total';
        return status;
    }
    function clearFilters() {
        ['search', 'filter-status', 'filter-product', 'filter-area', 'filter-advisor', 'filter-queue'].forEach((id) => { $(id).value = ''; });
        $('sort').value = 'queue-asc';
    }
    function applyKpi(kind) {
        clearFilters();
        if (kind === 'total') { render(); return; }
        $('filter-status').value = kind;
        render();
    }
    function render() {
        const list = visibleOrders();
        const source = dataOrders();
        const activeKey = activeKpi();
        const countOf = (key) => source.filter((order) => (key === NOT_UPDATED ? !statusKey(order.status) : statusKey(order.status) === key)).length;
        $('kpis').innerHTML = [
            ['total', 'All reserved', source.length, ''],
            ['Payment', 'Payment', countOf('Payment'), 'ok'],
            ['In progress', 'In progress', countOf('In progress'), 'warn'],
            ['Cancelled', 'Cancelled', countOf('Cancelled'), 'bad'],
            [NOT_UPDATED, 'Not updated', countOf(NOT_UPDATED), 'info']
        ].map(([key, label, value, cls]) => `<button type="button" class="kpi ${cls}${activeKey === key ? ' on' : ''}" data-kpi="${key}"><em>${label}</em><strong>${value}</strong></button>`).join('');
        paintViewMode();
        if (viewMode() === 'sheet') {
            $('cards').innerHTML = '';
            paintSheet(list);
        } else {
            $('cards').classList.toggle('rc-grid', list.length > 0);
            $('cards').innerHTML = list.length ? list.map((order) => tileHtml(order)).join('') : '<div class="empty">No reserved orders match this view.</div>';
        }
        paintOrderModal();
    }
    function retailMatch(value) {
        const text = String(value || '').trim().toLowerCase();
        return text === 'rtlesal' || text.includes('retail electronic sales');
    }
    function ageValue(days) {
        if (days == null || days === '' || Number.isNaN(Number(days))) return '<span class="flag">—</span>';
        const n = Number(days);
        const tone = n <= 5 ? 'good' : n === 6 ? 'warn' : 'bad';
        return `<span class="flag ${tone}">${n}d</span>`;
    }
    function toneValue(value, good) {
        return `<span class="flag ${good ? 'good' : 'bad'}">${esc(value)}</span>`;
    }
    function dataOrders() {
        return orders.filter((order) => !isSheetHeader(order));
    }
    function byCol(order, letter) {
        const want = String(letter || '').toUpperCase();
        const hit = sourceFields(order).find((field) => {
            const label = String(field.label || '').trim().toUpperCase();
            const col = String(field.col || '').trim().toUpperCase();
            return label === want || col === want;
        });
        if (!hit || isBlankValue(hit.value)) return '';
        return String(hit.value).replace(/\u00a0/g, ' ').trim();
    }
    function columnText(order, letter) {
        const value = byCol(order, letter);
        if (/^(product|alj suffix|model year|age|assign date|salesman name|sharing levels|vehicle search area)$/i.test(value)) return '';
        return value;
    }
    function looksLikeVinText(value) {
        return /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(String(value || '').trim());
    }
    function looksLikeDateText(value) {
        const text = String(value || '').trim();
        return /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text) || /^\d{4}-\d{2}-\d{2}/.test(text);
    }
    function isReservedFileOrder(order) {
        if (!order) return false;
        // Duplicate VIN in both files → treat as E-Sales (expiry still comes from Reserved).
        if (order.inEsales === true) return false;
        if (Array.isArray(order.esalesFields) && order.esalesFields.length) return false;
        if (order.inEsales === false || order.fromReservedFile) return true;
        if (order.inReservedFile) return true;
        return false;
    }
    function reservedField(order, letter) {
        const want = String(letter || '').toUpperCase();
        const pools = [order && order.reservedFields, order && order.fields];
        for (let p = 0; p < pools.length; p++) {
            const fields = Array.isArray(pools[p]) ? pools[p] : [];
            const hit = fields.find((field) => String(field.col || '').trim().toUpperCase() === want);
            if (!hit || isBlankValue(hit.value)) continue;
            return String(hit.value).replace(/\u00a0/g, ' ').trim();
        }
        return '';
    }
    function productOnly(product, sfx) {
        const name = String(product || '').trim();
        const suffix = String(sfx || '').trim();
        if (!name || !suffix) return name;
        if (name.toLowerCase().endsWith(' ' + suffix.toLowerCase())) return name.slice(0, name.length - suffix.length).trim();
        return name;
    }
    function areaText(order) {
        if (isReservedFileOrder(order)) return '';
        const fromB = columnText(order, 'B');
        if (fromB) return fromB;
        const first = sourceFields(order)[0];
        if (!first) return '';
        const label = String(first.label || '').trim();
        if (/^[A-Z]{1,3}$/.test(label)) return '';
        const value = String(first.value || '').replace(/\u00a0/g, ' ').trim();
        if (isBlankValue(value) || /^vehicle search area$/i.test(value)) return '';
        return value;
    }
    function isSheetHeader(order) {
        return columnText(order, 'I').toLowerCase() === '' && byCol(order, 'I').toLowerCase() === 'product' && /model year/i.test(byCol(order, 'K'));
    }
    function dateText(raw) {
        const iso = String(raw || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!iso) return String(raw || '').trim();
        return `${iso[3]}.${iso[2]}.${iso[1]}`;
    }
    function assignText(order) {
        if (isReservedFileOrder(order)) return order.assignDisplay || '';
        const raw = columnText(order, 'G');
        if (raw && !looksLikeVinText(raw) && !/^[A-Z0-9]{2,4}$/i.test(raw)) return dateText(raw);
        return order.assignDisplay || '';
    }
    function expiryText(order) {
        if (!isBlankValue(order.expiryDisplay)) {
            return String(order.expiryDisplay).replace(/\u00a0/g, ' ').trim();
        }
        if (!isBlankValue(order.expiryDate)) {
            const parsed = parseLocal(order.expiryDate);
            if (parsed) {
                const p = (n) => String(n).padStart(2, '0');
                return `${p(parsed.getDate())}.${p(parsed.getMonth() + 1)}.${parsed.getFullYear()}`;
            }
            const iso = String(order.expiryDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
            return String(order.expiryDate).trim();
        }
        if (isReservedFileOrder(order)) {
            const fromJ = reservedField(order, 'J');
            return looksLikeDateText(fromJ) || fromJ ? fromJ : '';
        }
        return '';
    }
    function expiryDeadline(order) {
        const raw = order.expiryDate || '';
        if (parseLocal(raw)) return raw;
        const iso = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T23:59:59`;
        const display = expiryText(order);
        const dmy = String(display).match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
        if (dmy) {
            const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
            const p = (n) => String(n).padStart(2, '0');
            return `${year}-${p(dmy[2])}-${p(dmy[1])}T23:59:59`;
        }
        return '';
    }
    function columnDeadline(order) {
        const fromExpiry = expiryDeadline(order);
        if (fromExpiry) return fromExpiry;
        if (order.deadline) return order.deadline;
        const raw = columnText(order, 'G');
        const iso = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!iso) return '';
        const date = new Date(+iso[1], +iso[2] - 1, +iso[3], order.paymentHours || 48);
        const p = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
    }
    function ageHtml(raw) {
        const match = String(raw || '').match(/-?\d+/);
        if (!match) return esc(raw);
        const n = Number(match[0]);
        const tone = n <= 5 ? 'good' : n === 6 ? 'warn' : 'bad';
        return `<span class="flag ${tone}">${n}d</span>`;
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
    function sourceFields(order) {
        if (isReservedFileOrder(order) && Array.isArray(order.reservedFields) && order.reservedFields.length) {
            return order.reservedFields;
        }
        return Array.isArray(order.fields) ? order.fields : [];
    }
    function isBlankValue(value) {
        const text = String(value == null ? '' : value).replace(/\u00a0/g, ' ').trim();
        return !text || text === '—' || text === '-' || text === '–' || /^n\/?a$/i.test(text);
    }
    function fieldText(order, test) {
        const hit = sourceFields(order).find((field) => {
            const label = String(field.label || '').replace(/\u00a0/g, ' ').trim().toLowerCase();
            return label && test(label) && !isBlankValue(field.value);
        });
        return hit ? String(hit.value).replace(/\u00a0/g, ' ').trim() : '';
    }
    function firstText(order, current, test) {
        if (!isBlankValue(current)) return String(current).replace(/\u00a0/g, ' ').trim();
        return fieldText(order, test);
    }
    function sfxValue(order) {
        return fieldText(order, (label) => label === 'sfx' || label === 'suffix' || label.includes('suffix') || /\bsfx\b/.test(label));
    }
    function cleanVehicleName(value) {
        const text = String(value == null ? '' : value).trim();
        return !text || text === '—' || looksLikeVinText(text) ? '' : text;
    }
    function productName(order) {
        const sfx = sfxValue(order);
        let vehicle = firstText(order, order.vehicle, (label) => label === 'product' || label === 'vehicle' || label === 'car' || label === 'المنتج');
        if (sfx && vehicle.endsWith(' ' + sfx)) vehicle = vehicle.slice(0, -(sfx.length + 1)).trim();
        return isBlankValue(vehicle) ? '' : vehicle;
    }
    function meta(label, valueHtml, plain) {
        if (isBlankValue(plain)) return '';
        return `<div class="meta"><span>${esc(label)}</span><b dir="auto">${valueHtml}</b></div>`;
    }
    function aheadHtml(order) {
        const ahead = Array.isArray(order.ahead) ? order.ahead : [];
        if (!ahead.length) return '<span class="ahead-empty">No orders ahead</span>';
        return `<div class="ahead-list">${ahead.map((item) => {
            const orderNo = item.orderNumber && item.orderNumber !== 'NO ORDER' ? item.orderNumber : '';
            const who = item.salesAdvisor || '';
            const text = ['#' + (item.queueNumber == null ? ahead.length : item.queueNumber), orderNo, who].filter(Boolean).join(' ');
            return `<b title="${esc(text)}">${esc(text)}</b>`;
        }).join('')}</div>`;
    }
    function excelFieldsHtml(order) {
        const fields = sourceFields(order).filter((field) => !isBlankValue(field.value));
        const body = fields.length
            ? fields.map((field) => {
                const tone = fieldTone(field.label, field.value);
                return `<div class="excel-field${tone ? ' ' + tone : ''}"><span dir="auto" title="${esc(field.label)}">${esc(field.label)}</span><b dir="auto" title="${esc(field.value)}">${esc(field.value)}</b></div>`;
            }).join('')
            : '<div class="excel-field"><span>Source</span><b>No values on this order</b></div>';
        return `<div class="excel-row hidden">${body}</div>`;
    }
    function statusWhen(value) {
        const date = parseLocal(value);
        if (!date) return String(value || '');
        return date.toLocaleString('en-GB', {
            timeZone: 'Asia/Riyadh',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }) + ' (Saudi)';
    }
    function personKey(value) {
        return String(value || '').replace(/\u00a0/g, ' ').replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }
    function orderNumberStartsWith5(order) {
        return String(order && order.orderNumber || '').trim().startsWith('5');
    }
    function isOrder5Editor(session) {
        if (!session) return false;
        if (session.canEditOrdersStartingWith5) return true;
        const key = personKey(session.name);
        return key === 'reda salah' || key === 'mohammed al fadul';
    }
    function canUpdateOrder(order) {
        const session = readSession();
        if (!session || !order) return false;
        if (isOrder5Editor(session) && orderNumberStartsWith5(order)) return true;
        // The row belongs to the "Salesman name" shown in the sheet (column A of the Reserved Order File).
        const pools = [order.reservedFields, order.fromReservedFile ? order.fields : null];
        let columnA = '';
        pools.forEach((pool) => {
            if (columnA) return;
            const hit = (Array.isArray(pool) ? pool : []).find((field) => String(field.col || '').trim().toUpperCase() === 'A');
            columnA = hit ? realText(hit.value) : '';
        });
        const fallback = isReservedFileOrder(order) ? order.salesAdvisor : (columnText(order, 'T') || order.salesAdvisor);
        const advisor = personKey(columnA && !/^(unassigned|salesman name)$/i.test(columnA) ? columnA : fallback);
        if (!advisor || advisor === 'unassigned') return false;
        if (samePerson(session.name, advisor)) return true;
        return personKey(session.employeeNumber) === advisor;
    }
    // Same name ignoring case, dots, extra spaces and word order (the server uses the same rule).
    function samePerson(a, b) {
        const x = personKey(a);
        const y = personKey(b);
        if (!x || !y) return false;
        if (x === y) return true;
        if (x.split(' ').sort().join(' ') === y.split(' ').sort().join(' ')) return true;
        return shortNameOf(x, y) || shortNameOf(y, x);
    }
    // "Samaher Al Amri" in the sheet = login "Samaher Abdulmoghni Al Amri": same first and last name and every
    // word of the short name is in the full name ("Al Asseri" and "Alasseri" count as the same word).
    function nameWords(key) {
        return key.replace(/\b(al|el)\s+(?=\S)/g, '$1').split(' ').filter(Boolean);
    }
    function shortNameOf(shortKey, fullKey) {
        const short = nameWords(shortKey);
        const full = nameWords(fullKey);
        if (short.length < 2 || short.length > full.length) return false;
        if (short[0] !== full[0] || short[short.length - 1] !== full[full.length - 1]) return false;
        return short.every((word) => full.includes(word));
    }
    // ---- Small order tiles: car + employee. Click opens the full card (same markup, same status select). ----
    let openOrderKey = '';
    function tileInfo(order) {
        const reservedOnly = isReservedFileOrder(order);
        let sfx;
        let product;
        let advisor;
        if (reservedOnly) {
            sfx = reservedField(order, 'F');
            const rawProduct = reservedField(order, 'E') || (!looksLikeVinText(order.vehicle) ? order.vehicle : '');
            product = productOnly(rawProduct, sfx);
            advisor = reservedField(order, 'A') || order.salesAdvisor || '';
        } else {
            sfx = columnText(order, 'J');
            if (looksLikeDateText(sfx)) sfx = '';
            product = productOnly(columnText(order, 'I'), sfx);
            if (looksLikeVinText(product)) product = productName(order) || '';
            advisor = columnText(order, 'T');
        }
        if (!advisor || String(advisor).toLowerCase() === 'unassigned') advisor = '';
        return { product, sfx, advisor };
    }
    function personInitials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!parts.length) return '?';
        return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }
    function tileHtml(order) {
        const info = tileInfo(order);
        const deadline = columnDeadline(order);
        const ms = remainingMs(deadline ? Object.assign({}, order, { deadline }) : order);
        const img = carImage(info.product, order.vehicle, productName(order));
        const carName = info.product || cleanVehicleName(order.vehicle) || 'Car not named';
        const timeText = ms == null ? 'No timer' : (ms <= 0 ? 'EXPIRED' : formatRemain(ms) + ' left');
        const tone = ms == null ? '' : timerClass(ms);
        return `<button type="button" class="rc-tile${isExpired(order) ? ' expired' : ''}${isCancelled(order) ? ' cancelled' : ''}" data-tile-key="${esc(order.key)}" aria-label="Open details for ${esc(carName)}">
            <span class="rc-top"><span class="rc-q" title="Back Order queue position">${order.boQueuePosition == null ? '—' : '#' + esc(String(order.boQueuePosition))}</span>${sheetStatusPill(order)}</span>
            <span class="rc-car">
                <span class="rc-thumb">${img ? `<img src="${img}" alt="${esc(carName)}" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="rc-fallback" hidden>${CAR_ICON}</span>` : `<span class="rc-fallback">${CAR_ICON}</span>`}</span>
                <span class="rc-name"><b dir="auto" title="${esc(carName)}">${esc(carName)}</b>${info.sfx ? `<small dir="auto">${esc(info.sfx)}</small>` : ''}</span>
            </span>
            <span class="rc-foot">
                <span class="rc-who${info.advisor ? '' : ' none'}"><span class="rc-av">${esc(info.advisor ? personInitials(info.advisor) : '–')}</span><span dir="auto" title="${esc(info.advisor || 'Unassigned')}">${esc(info.advisor || 'Unassigned')}</span></span>
                <span class="rc-time ${tone}" data-deadline="${esc(deadline || '')}">${esc(timeText)}</span>
            </span>
        </button>`;
    }
    // ---- Excel-style sheet: same look as the admin Live sheet. Everyone sees every row; only the advisor of an
    // order can set its status (Payment / In progress / Cancelled) and must write a note with it. Double-click a row
    // for the full card. ----
    const SHEET_COLS = ['Queue position', 'Order status', 'Note', 'Updated', 'Salesman name', 'Customer name', 'Order number', 'Model year', 'Product', 'ALJ suffix', 'Exterior color', 'Interior color', 'VIN', 'Expiry date', 'RTL status', 'Allocation age', 'Area', 'Share level'];
    const sheetSel = { r: 0, c: 0 };
    function viewMode() {
        try { return localStorage.getItem('ro-orders-view') === 'cards' ? 'cards' : 'sheet'; } catch (e) { return 'sheet'; }
    }
    function setViewMode(mode) {
        try { localStorage.setItem('ro-orders-view', mode); } catch (e) { /* storage blocked: only this visit */ }
        render();
    }
    function sheetLetter(index) {
        let n = index + 1;
        let out = '';
        while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); }
        return out;
    }
    function realText(value) { return isBlankValue(value) ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
    // value of an RTL Stock column of the order's VIN (M status, K allocation age, N area, H share level)
    function rtlCol(order, letter) {
        const hit = (order.rtlFields || []).find((field) => String(field.col || '').toUpperCase() === letter);
        return hit ? realText(hit.value) : '';
    }
    function statusKey(value) {
        const text = String(value || '').trim().toLowerCase();
        return STATUSES.find((item) => item.toLowerCase() === text) || '';
    }
    function statusOptionsHtml(current) {
        const key = statusKey(current);
        return (key ? '' : '<option value="" selected disabled>Choose status…</option>')
            + STATUSES.map((item) => `<option value="${esc(item)}"${item === key ? ' selected' : ''}>${esc(item)}</option>`).join('');
    }
    function sheetValues(order) {
        const info = tileInfo(order);
        const pick = (letter) => realText(reservedField(order, letter));
        const vinText = pick('I');
        const orderNo = pick('C') || (order.orderNumber && order.orderNumber !== 'NO ORDER' ? String(order.orderNumber) : '');
        return {
            'Salesman name': pick('A') || info.advisor,
            'Customer name': pick('B') || realText(order.customerName),
            'Order number': orderNo,
            'Model year': pick('D') || realText(order.modelYear),
            Product: pick('E') || info.product || cleanVehicleName(order.vehicle),
            'ALJ suffix': pick('F') || info.sfx,
            'Exterior color': pick('G') || realText(order.exterior),
            'Interior color': pick('H') || realText(order.interior),
            VIN: looksLikeVinText(vinText) ? vinText : (looksLikeVinText(order.vin) ? String(order.vin).trim() : ''),
            'Expiry date': expiryText(order) || pick('J'),
            'RTL status': rtlCol(order, 'M'),
            'Allocation age': rtlCol(order, 'K'),
            Area: rtlCol(order, 'N') || realText(order.searchArea),
            'Share level': rtlCol(order, 'H') || realText(order.shareLevel)
        };
    }
    function sheetStatusPill(order) {
        const key = statusKey(order.status);
        const tone = key === 'Cancelled' ? 'is-bad' : key === 'Payment' ? 'is-ok' : key === 'In progress' ? 'is-hold' : 'is-none';
        return `<span class="s-pill ${tone}">${esc(key || 'Not updated')}</span>`;
    }
    function sheetCell(order, label, values, mine) {
        if (label === 'Queue position') {
            const pos = order.boQueuePosition;
            if (pos == null) return '<td class="col-queue" title="Not found in the Toyota Back Order file"><span class="ahead-empty">—</span></td>';
            const size = order.boQueueSize != null ? `<small class="q-of"> / ${esc(String(order.boQueueSize))}</small>` : '';
            return `<td class="col-queue" title="Back Order queue position"><span class="q-pill">#${esc(String(pos))}</span>${size}</td>`;
        }
        if (label === 'Order status') {
            if (!mine) return `<td class="col-status">${sheetStatusPill(order)}</td>`;
            return `<td class="col-status"><select class="xl-status-select admin-status-select" data-key="${esc(order.key)}" aria-label="Choose the status of your order">${statusOptionsHtml(order.status)}</select></td>`;
        }
        if (label === 'Note') {
            const note = String(order.statusNote || '').trim();
            const edit = mine && statusKey(order.status)
                ? `<button type="button" class="xl-note-edit" data-key="${esc(order.key)}" title="Edit the note" aria-label="Edit the note">&#9998;</button>`
                : '';
            return `<td class="col-note" title="${esc(note)}">${note ? `<span class="xl-note-text" dir="auto">${esc(note)}</span>` : '<span class="ahead-empty">—</span>'}${edit}</td>`;
        }
        if (label === 'Updated') {
            const who = order.statusNoteBy || order.statusChangedBy || '';
            const when = order.statusChangedAt ? statusWhen(order.statusChangedAt) : (order.statusNoteDisplay || order.statusChangedDisplay || '');
            if (!statusKey(order.status) || (!who && !when)) return '<td class="col-updated-by"><span class="ahead-empty">—</span></td>';
            return `<td class="col-updated-by">${who ? `<b>${esc(who)}</b>` : ''}${when ? `<span class="saudi-time">${esc(when)}</span>` : ''}</td>`;
        }
        if (label === 'RTL status') {
            const value = values['RTL status'];
            return value ? `<td class="col-source"><span class="source-pill is-both">${esc(value)}</span></td>` : '<td class="col-source"></td>';
        }
        if (label === 'Salesman name') return `<td class="col-advisor">${values[label] ? (mine ? `<b>${esc(values[label])}</b>` : esc(values[label])) : ''}</td>`;
        const value = values[label] == null ? '' : values[label];
        const plain = String(value).trim();
        return `<td${/^-?\d[\d,]*(\.\d+)?$/.test(plain) && plain.length < 12 ? ' class="xl-num"' : ''}>${esc(value)}</td>`;
    }
    function paintSheet(list) {
        const box = $('emp-sheet');
        if (!box) return;
        const cols = SHEET_COLS;
        const keepTop = box.scrollTop;
        const keepLeft = box.scrollLeft;
        const mineCount = list.filter(canUpdateOrder).length;
        if (!list.length) {
            box.innerHTML = '<p class="empty">No reserved orders match this view.</p>';
        } else {
            const rows = list.map((order, rowIndex) => {
                const mine = canUpdateOrder(order);
                const values = sheetValues(order);
                const classes = [mine ? 'is-mine' : '', statusKey(order.status) === 'Cancelled' || isCancelled(order) ? 'row-cancelled' : ''].filter(Boolean).join(' ');
                return `<tr class="${classes}" data-key="${esc(order.key)}"><th class="xl-rn" data-r="${rowIndex}">${rowIndex + 2}</th>${cols.map((label) => sheetCell(order, label, values, mine)).join('')}</tr>`;
            }).join('');
            box.innerHTML = `<table class="xl-grid"><thead>
                <tr class="xl-letters"><th class="xl-corner"></th>${cols.map((label, index) => `<th class="xl-col" data-c="${index}">${sheetLetter(index)}</th>`).join('')}</tr>
                <tr class="xl-head"><th class="xl-rn">1</th>${cols.map((label) => `<th class="xl-h">${esc(label)}</th>`).join('')}</tr>
            </thead><tbody>${rows}</tbody></table>`;
        }
        box.scrollTop = keepTop;
        box.scrollLeft = keepLeft;
        const stat = $('emp-xl-stat');
        if (stat) stat.textContent = `${list.length.toLocaleString('en-GB')} rows × ${cols.length} columns · ${mineCount} yours`;
        sheetSelect(sheetSel.r, sheetSel.c, false);
    }
    function sheetSelect(r, c, scroll) {
        const box = $('emp-sheet');
        const body = box && box.querySelector('.xl-grid tbody');
        if (!body || !body.rows.length) return;
        r = Math.max(0, Math.min(body.rows.length - 1, r));
        c = Math.max(0, Math.min(body.rows[0].cells.length - 2, c));
        sheetSel.r = r;
        sheetSel.c = c;
        box.querySelectorAll('.xl-sel, .xl-active').forEach((el) => el.classList.remove('xl-sel', 'xl-active'));
        const tr = body.rows[r];
        const td = tr && tr.cells[c + 1];
        if (!td) return;
        td.classList.add('xl-sel');
        if (tr.cells[0]) tr.cells[0].classList.add('xl-active');
        const letters = box.querySelector('.xl-letters');
        if (letters && letters.cells[c + 1]) letters.cells[c + 1].classList.add('xl-active');
        const name = $('emp-xl-name');
        if (name) name.textContent = sheetLetter(c) + (r + 2);
        const formula = $('emp-xl-formula');
        if (formula) {
            const select = td.querySelector('select');
            formula.textContent = select ? select.value : String(td.textContent || '').replace(/\s+/g, ' ').trim();
        }
        if (scroll) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function paintViewMode() {
        const sheet = viewMode() === 'sheet';
        const shell = $('admin-app');
        if (shell) shell.classList.toggle('hidden', !sheet);
        $('cards').classList.toggle('hidden', sheet);
        const a = $('view-sheet');
        const b = $('view-cards');
        if (a) { a.classList.toggle('is-on', sheet); a.setAttribute('aria-pressed', sheet ? 'true' : 'false'); }
        if (b) { b.classList.toggle('is-on', !sheet); b.setAttribute('aria-pressed', sheet ? 'false' : 'true'); }
    }
    // ---- Note dialog: choosing a status always asks for a note first; nothing is saved until the note is written. ----
    let noteTarget = null;
    function requestStatus(key, status, select) {
        const order = orders.find((item) => item.key === key);
        if (!order || !statusKey(status)) { if (select) render(); return; }
        const chosen = statusKey(status);
        noteTarget = { key, status: chosen };
        const modal = $('note-modal');
        if (!modal) { changeStatus(key, chosen, ''); return; }
        $('note-modal-status').textContent = chosen;
        $('note-modal-order').textContent = [order.orderNumber && order.orderNumber !== 'NO ORDER' ? 'Order ' + order.orderNumber : '', looksLikeVinText(order.vin) ? order.vin : ''].filter(Boolean).join(' · ');
        $('note-text').value = statusKey(order.status) === chosen ? String(order.statusNote || '') : '';
        $('note-error').textContent = '';
        $('note-save').disabled = false;
        modal.classList.remove('hidden');
        setTimeout(() => { try { $('note-text').focus(); } catch (e) { /* ignore */ } }, 30);
    }
    function closeNoteDialog() {
        const modal = $('note-modal');
        if (modal) modal.classList.add('hidden');
        noteTarget = null;
        render();            // puts every status dropdown back to what is saved
    }
    async function saveNoteDialog() {
        if (!noteTarget) return;
        const text = $('note-text').value.trim();
        if (!text) { $('note-error').textContent = 'Write a note first. It is required with every status.'; return; }
        $('note-save').disabled = true;
        const error = await changeStatus(noteTarget.key, noteTarget.status, text);
        if (error) { $('note-error').textContent = error; $('note-save').disabled = false; return; }
        $('note-modal').classList.add('hidden');
        noteTarget = null;
    }
    function paintOrderModal() {
        const modal = $('order-modal');
        const body = $('order-modal-body');
        if (!modal || !body) return;
        const order = openOrderKey ? orders.find((item) => item.key === openOrderKey) : null;
        if (!order) {
            openOrderKey = '';
            modal.classList.add('hidden');
            body.innerHTML = '';
            return;
        }
        const panel = modal.querySelector('.overlay-panel');
        const scroll = panel ? panel.scrollTop : 0;
        const wasExpanded = Boolean(body.querySelector('.excel-row:not(.hidden)'));
        body.innerHTML = detailHtml(order);
        if (wasExpanded) {
            const row = body.querySelector('.excel-row');
            const toggle = body.querySelector('.bo-toggle');
            if (row) row.classList.remove('hidden');
            if (toggle) { toggle.setAttribute('aria-expanded', 'true'); toggle.textContent = 'Hide Full BO Details'; }
        }
        modal.classList.remove('hidden');
        if (panel) panel.scrollTop = scroll;
    }
    function openOrderModal(key) {
        openOrderKey = key;
        paintOrderModal();
        const close = document.querySelector('#order-modal .rc-close');
        if (close) close.focus({ preventScroll: true });
    }
    function closeOrderModal() {
        openOrderKey = '';
        paintOrderModal();
    }
    // Order details dialog: the same information as the sheet columns, nothing else.
    function detailHtml(order) {
        const values = sheetValues(order);
        const mine = canUpdateOrder(order);
        const key = statusKey(order.status);
        const carName = values.Product || 'Car not named';
        const img = carImage(values.Product, order.vehicle, productName(order));
        const pos = order.boQueuePosition;
        const queue = pos == null ? '—' : '#' + pos + (order.boQueueSize != null ? ' / ' + order.boQueueSize : '');
        const who = order.statusNoteBy || order.statusChangedBy || '';
        const when = order.statusChangedAt ? statusWhen(order.statusChangedAt) : (order.statusNoteDisplay || order.statusChangedDisplay || '');
        const note = String(order.statusNote || '').trim();
        const item = (label, value) => `<div class="rd-item"><span>${esc(label)}</span><b dir="auto">${isBlankValue(value) ? '—' : esc(value)}</b></div>`;
        const grid = [
            item('Queue position', queue),
            item('Salesman name', values['Salesman name']),
            item('Customer name', values['Customer name']),
            item('Order number', values['Order number']),
            item('Model year', values['Model year']),
            item('Product', values.Product),
            item('ALJ suffix', values['ALJ suffix']),
            item('Exterior color', values['Exterior color']),
            item('Interior color', values['Interior color']),
            item('VIN', values.VIN),
            item('Expiry date', values['Expiry date']),
            item('RTL status', values['RTL status']),
            item('Allocation age', values['Allocation age']),
            item('Area', values.Area),
            item('Share level', values['Share level'])
        ].join('');
        const statusBox = mine
            ? `<select class="rd-status-select" data-key="${esc(order.key)}" aria-label="Choose the status of your order">${statusOptionsHtml(order.status)}</select>${key ? `<button type="button" class="rd-note-edit" data-key="${esc(order.key)}">Edit note</button>` : ''}`
            : `${sheetStatusPill(order)}<small class="rd-lock">Only ${esc(values['Salesman name'] || 'the assigned salesman')} can update this order</small>`;
        return `<article class="rd${isCancelled(order) || key === 'Cancelled' ? ' cancelled' : ''}">
            <header class="rd-head">
                <div class="rd-thumb">${img ? `<img src="${img}" alt="${esc(carName)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="rd-fallback" hidden>${CAR_ICON}</span>` : `<span class="rd-fallback">${CAR_ICON}</span>`}</div>
                <div class="rd-title"><h3 dir="auto">${esc(carName)}${values['ALJ suffix'] ? ` <small>${esc(values['ALJ suffix'])}</small>` : ''}</h3><span dir="auto">${esc(values['Customer name'] || '')}</span></div>
            </header>
            <div class="rd-grid">${grid}</div>
            <section class="rd-status">
                <h4>Order status</h4>
                <div class="rd-status-row">${statusBox}</div>
                <p class="rd-note" dir="auto">${note ? esc(note) : '<span class="muted">No note yet.</span>'}</p>
                ${key && (who || when) ? `<small class="rd-updated">Updated by <b>${esc(who || '—')}</b>${when ? ` · ${esc(when)}` : ''}</small>` : ''}
            </section>
        </article>`;
    }
    function cardHtml(order) {
        const deadline = columnDeadline(order);
        const ms = remainingMs(deadline ? Object.assign({}, order, { deadline }) : order);
        const hours = order.paymentHours || 48;
        const reservedOnly = isReservedFileOrder(order);
        let sfx;
        let product;
        let year;
        let ageRaw;
        let area;
        let share;
        let colors;
        let advisor;
        if (reservedOnly) {
            // Reserved Order File layout: E product, F sfx, D year, G/H colors, B name, C order, I VIN, J expiry.
            sfx = reservedField(order, 'F');
            const rawProduct = reservedField(order, 'E') || (!looksLikeVinText(order.vehicle) ? order.vehicle : '');
            product = productOnly(rawProduct, sfx);
            year = reservedField(order, 'D') || order.modelYear || '';
            ageRaw = '';
            area = '';
            share = '';
            colors = [reservedField(order, 'G') || order.exterior, reservedField(order, 'H') || order.interior]
                .filter((item) => !isBlankValue(item)).join(' / ');
            advisor = '';
        } else {
            sfx = columnText(order, 'J');
            if (looksLikeDateText(sfx)) sfx = '';
            product = productOnly(columnText(order, 'I'), sfx);
            if (looksLikeVinText(product)) product = productName(order) || '';
            year = columnText(order, 'K');
            ageRaw = columnText(order, 'P');
            area = areaText(order);
            share = columnText(order, 'C');
            colors = [columnText(order, 'M'), columnText(order, 'N')].filter((item) => !isBlankValue(item)).join(' / ');
            advisor = columnText(order, 'T');
        }
        const expiryOn = expiryText(order);
        const customer = reservedOnly
            ? (firstText(order, order.customerName, (label) => label === 'name' || label === 'customer' || label === 'customer name' || label === 'العميل') || reservedField(order, 'B'))
            : firstText(order, order.customerName, (label) => label === 'customer' || label === 'customer name' || label === 'العميل');
        const img = carImage(product, order.vehicle, productName(order));
        const assigned = Boolean(advisor && String(advisor).toLowerCase() !== 'unassigned');
        const orderLabel = order.orderNumber && order.orderNumber !== 'NO ORDER' ? 'ORDER #' + order.orderNumber : '#NO ORDER';
        const vin = show(order.vin, 'VIN NOT FOUND');
        const initial = product ? product.slice(0, 1) : '';
        const specs = [
            meta('Product', esc(product), product),
            meta('SFX', esc(sfx), sfx),
            meta('Model year', esc(year), year),
            meta('Reservation age', ageHtml(ageRaw), ageRaw),
            meta('Area', toneValue(area, retailMatch(area)), area),
            meta('Share level', toneValue(share, retailMatch(share)), share),
            meta('Colors', esc(colors), colors)
        ].join('');
        return `<article class="order-block${isExpired(order) ? ' expired' : ''}${isCancelled(order) ? ' cancelled' : ''}">
            <div class="lane${isExpired(order) ? ' expired' : ''}${specs ? '' : ' no-specs'}" data-key="${esc(order.key)}">
            <div class="lane-id">
                <div class="qmark">${queueLabel(order.queueNumber)}</div>
                <div class="thumb">${img ? `<img class="car" src="${img}" alt="${esc(product)}" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="thumb-fallback" hidden>${CAR_ICON}</span>` : `<span class="thumb-fallback">${CAR_ICON}</span>`}</div>
                <b dir="auto" title="${esc(orderLabel)}">${esc(orderLabel)}</b>
                <span class="muted" dir="auto" title="${esc(vin)}">VIN ${esc(vin)}</span>
                ${isBlankValue(customer) ? '' : `<span class="muted" dir="auto" title="${esc(customer)}">${esc(customer)}</span>`}
            </div>
            ${specs ? `<div class="lane-mid">${specs}</div>` : ''}
            <div class="lane-assign">
                <span class="assign-pill ${assigned ? 'on' : 'off'}">${assigned ? 'Assigned' : 'Unassigned'}</span>
                ${assigned ? meta('Advisor', esc(advisor), advisor) : ''}
                ${expiryOn ? meta('Expiry date', esc(expiryOn), expiryOn) : ''}
                ${(!reservedOnly && order.paymentLabel && order.paymentLabel !== 'UNKNOWN') ? meta('Payment', esc(order.paymentLabel), order.paymentLabel) : ''}
                <div class="meta ahead-meta"><span>Upcoming queue</span>${aheadHtml(order)}</div>
            </div>
            <div class="lane-side">
                <div class="timer ${timerClass(ms)}" data-deadline="${esc(deadline || '')}" data-date="${esc(expiryOn || '')}">${esc(timerLabel(expiryOn, ms))}</div>
                <span class="muted time-left">${ms == null ? 'No timer' : (ms <= 0 ? 'EXPIRED' : formatRemain(ms) + ' left')}</span>
                <span class="muted">${hours} HOURS</span>
                <div class="status-glow">
                    <span class="badge ${badge(order.status)}" dir="auto">${esc(order.status || 'محجوز')}</span>
                    <small>${esc(order.statusChangedBy || 'No update yet')}${order.statusChangedAt ? ' · ' + esc(statusWhen(order.statusChangedAt)) : ''}</small>
                </div>
                ${canUpdateOrder(order)
                    ? `<div class="status-row"><select class="status-select" aria-label="Choose status">${statusOptionsHtml(order.status)}</select></div>`
                    : '<p class="status-lock">Only the assigned advisor can update</p>'}
            </div>
            </div>
            ${notesHtml(order)}
            <button class="bo-toggle" type="button" aria-expanded="false">View Full BO Details</button>
            ${excelFieldsHtml(order)}
        </article>`;
    }
    function notesHtml(order) {
        const leader = String(order.leaderNote || '').trim();
        return `<section class="order-notes" data-notes-key="${esc(order.key)}">
            <div class="note-block leader-note">
                <h4>Leader note</h4>
                ${leader
                    ? `<p dir="auto">${esc(leader)}</p><small>${esc(order.leaderNoteBy || 'Admin')}${order.leaderNoteDisplay ? ' · ' + esc(order.leaderNoteDisplay) : ''}</small>`
                    : '<p class="muted">No leader note from admin yet.</p>'}
            </div>
        </section>`;
    }
    function tickTimers() {
        paintSession();
        document.querySelectorAll('.rc-tile .rc-time').forEach((el) => {
            const end = parseLocal(el.dataset.deadline);
            const ms = end ? end.getTime() - Date.now() : null;
            el.textContent = ms == null ? 'No timer' : (ms <= 0 ? 'EXPIRED' : formatRemain(ms) + ' left');
            el.className = `rc-time ${ms == null ? '' : timerClass(ms)}`;
            const tile = el.closest('.rc-tile');
            if (tile && !tile.classList.contains('cancelled')) tile.classList.toggle('expired', ms != null && ms <= 0);
        });
        document.querySelectorAll('.timer').forEach((el) => {
            const end = parseLocal(el.dataset.deadline);
            const ms = end ? end.getTime() - Date.now() : null;
            el.textContent = timerLabel(el.dataset.date || '', ms);
            el.className = `timer ${timerClass(ms)}`;
            const left = el.parentElement && el.parentElement.querySelector('.time-left');
            if (left) left.textContent = ms == null ? 'No timer' : (ms <= 0 ? 'EXPIRED' : formatRemain(ms) + ' left');
            const card = el.closest('.lane');
            const expired = ms != null && ms <= 0;
            if (card) card.classList.toggle('expired', expired);
            const block = el.closest('.order-block');
            if (block && !block.classList.contains('cancelled')) block.classList.toggle('expired', expired);
        });
    }
    // Saves the status together with its note. Returns '' on success or the error text.
    async function changeStatus(key, status, note) {
        const session = readSession();
        if (!session) { endSession('logout'); return 'Session ended.'; }
        const res = await fetch('/api/reserved-orders/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, key, status, note: note || '' })
        });
        if (res.status === 401) { endSession('logout'); return 'Session expired. Sign in again.'; }
        touch();
        let error = '';
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            error = data.error || 'Only the assigned advisor can update this order.';
        }
        loadLive.last = '';
        await loadLive();
        if (error) {
            const lock = document.querySelector(`[data-key="${CSS.escape(key)}"] .status-lock`);
            if (lock) lock.textContent = error;
            const bar = $('emp-sheet-msg');
            if (bar) bar.textContent = error;
        }
        return error;
    }
    async function loadAlertRules() {
        try {
            const data = await fetch('/api/reserved-orders/alert-rules').then((res) => res.json());
            alertRules = data.alerts || [];
        } catch (e) { alertRules = []; }
    }
    async function paintMessageAlerts() {
        const box = $('msg-alert-list');
        const session = readSession();
        if (!box || !session) return;
        const res = await fetch('/api/reserved-orders/my-bo-corrections?token=' + encodeURIComponent(session.token));
        const data = res.ok ? await res.json().catch(() => ({})) : {};
        const items = data.alerts || [];
        if (!items.length) {
            box.innerHTML = '<p class="muted">No messages from admin yet.</p>';
            return;
        }
        box.innerHTML = items.map((item) => {
            const dated = hasMessageDate(item.message);
            return `<article class="msg-alert ${item.sentAt ? 'sent' : 'warning'}">
            <small>${esc(item.name)} · ${esc(item.product || 'All cars')} · ${esc(item.column)}</small>
            <p><b>${item.affectedOrderCount}</b> found under your name in the BO file. Change ${esc(item.incorrectValue || 'blank')} to ${esc(item.correctValue || '—')}.</p>
            <textarea data-admin-msg="${esc(item.ruleId)}" rows="3">${esc(item.message)}</textarea>
            ${dated ? `<div class="date-step"><span>Deadline</span><button type="button" data-shift="-1" data-rule="${esc(item.ruleId)}">−</button><button type="button" data-shift="1" data-rule="${esc(item.ruleId)}">+</button></div>` : ''}
            <p>${item.sentAt ? 'Sent' : 'Not sent yet'}</p>
            <button type="button" data-open-wa="${esc(item.ruleId)}">Open WhatsApp</button>
            <button type="button" data-confirm-sent="${esc(item.ruleId)}">${item.sentAt ? 'Sent again' : 'Mark as sent'}</button>
        </article>`;
        }).join('');
        box.querySelectorAll('[data-open-wa]').forEach((button) => button.addEventListener('click', () => openWhatsApp(messageText(button.dataset.openWa))));
        box.querySelectorAll('[data-confirm-sent]').forEach((button) => button.addEventListener('click', () => confirmSent(button.dataset.confirmSent, '', messageText(button.dataset.confirmSent))));
        box.querySelectorAll('[data-shift]').forEach((button) => button.addEventListener('click', () => {
            const field = box.querySelector(`[data-admin-msg="${CSS.escape(button.dataset.rule)}"]`);
            if (!field) return;
            field.value = shiftMessageDates(field.value, Number(button.dataset.shift) || 0);
        }));
    }
    function hasMessageDate(text) {
        return /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/.test(String(text || ''));
    }
    function shiftMessageDates(text, delta) {
        return String(text || '').replace(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g, (match, day, month, year, isoYear, isoMonth, isoDay) => {
            const date = year
                ? new Date(Number(year), Number(month) - 1, Number(day))
                : new Date(Number(isoYear), Number(isoMonth) - 1, Number(isoDay));
            if (Number.isNaN(date.getTime())) return match;
            date.setDate(date.getDate() + delta);
            const dd = String(date.getDate()).padStart(2, '0');
            const mm = String(date.getMonth() + 1).padStart(2, '0');
            const yyyy = String(date.getFullYear());
            return year ? `${dd}.${mm}.${yyyy}` : `${yyyy}-${mm}-${dd}`;
        });
    }
    function messageText(ruleId) {
        const field = document.querySelector(`#mc-work [data-admin-msg="${CSS.escape(ruleId)}"]`)
            || document.querySelector(`[data-admin-msg="${CSS.escape(ruleId)}"]`);
        return field ? field.value.trim() : '';
    }
    function openWhatsApp(text, number) {
        if (!text) return '';
        const digits = phone(number != null ? number : ($('msg-phone') ? $('msg-phone').value : ''));
        window.open((digits ? `https://wa.me/${digits}?text=` : 'https://wa.me/?text=') + encodeURIComponent(text), '_blank', 'noopener');
        return digits;
    }
    async function confirmSent(ruleId, boNumber, text) {
        const session = readSession();
        if (!session || !text) return;
        const res = await fetch('/api/reserved-orders/my-bo-corrections/sent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, ruleId, boNumber, message: text })
        });
        if (!res.ok) return;
        delete mcDrafts[ruleId + '::' + boNumber];
        await paintMyAlerts();
        paintMessageAlerts();
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
                ...((local && local.expiryDisplay) ? [{ label: 'Expiry date', value: local.expiryDisplay }] : []),
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
        if (!$('vehicles')) return;
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
        const preview = $('msg-preview');
        preview.textContent = text || 'Select a car and model to generate the message.';
        preview.classList.toggle('ar', $('msg-lang').value === 'ar' || $('msg-lang').value === 'both');
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
        let digits = String(raw || '').replace(/\D/g, '');
        if (!digits) return '';
        if (digits.startsWith('00')) digits = digits.slice(2);
        if (digits.startsWith('0')) return '966' + digits.slice(1);
        if (digits.startsWith('966')) return digits;
        if (digits.length === 9 && digits.startsWith('5')) return '966' + digits;
        return digits;
    }

    function showView(name) {
        $('overlay-message').classList.toggle('hidden', name !== 'message');
        const center = $('mc-center');
        const board = $('order-board');
        const marketing = $('marketing-board');
        const errors = $('order-errors');
        if (center) center.classList.toggle('hidden', name === 'orders' || name === 'marketing' || name === 'errors');
        if (board) board.classList.toggle('hidden', name !== 'orders');
        if (marketing) marketing.classList.toggle('hidden', name !== 'marketing');
        if (errors) errors.classList.toggle('hidden', name !== 'errors');
        document.querySelectorAll('#app .jump button').forEach((button) => button.classList.toggle('nav-on', button.dataset.view === name));
        if (name === 'message') loadAlertRules().then(paintMessageAlerts);
        if (name === 'inbox') paintMyAlerts();
        if (name === 'errors') paintMyAlerts();
        if (name === 'marketing') loadMyMarketing();
    }
    function oeStatusLabel(order) {
        const status = (order && order.status) || 'new';
        if (status === 'completed') return { label: 'Done', cls: 'is-sent' };
        if (status === 'in_progress') return { label: 'In progress', cls: 'is-progress' };
        if (status === 'viewed') return { label: 'Viewed', cls: 'is-viewed' };
        return { label: 'Needs action', cls: '' };
    }
    function paintOrderErrorBadge() {
        const badge = $('oe-badge');
        if (!badge) return;
        const open = boAlerts.reduce((sum, item) => sum + (item.orders || []).filter((order) => (order.status || 'new') === 'new').length, 0);
        badge.hidden = !open;
        badge.textContent = open ? String(open) : '';
    }
    function paintOrderErrors() {
        const list = $('oe-list');
        const summary = $('oe-summary');
        if (!list) return;
        paintOrderErrorBadge();
        const items = boAlerts || [];
        const totalOrders = items.reduce((sum, item) => sum + (item.orders || []).length, 0);
        const openOrders = items.reduce((sum, item) => sum + (item.orders || []).filter((order) => (order.status || 'new') !== 'completed').length, 0);
        if (summary) {
            summary.innerHTML = `
            <article class="is-need"><span>Error types pushed to you</span><strong>${items.length}</strong></article>
            <article class="is-soon"><span>Your orders with errors</span><strong>${totalOrders}</strong></article>
            <article class="is-sent"><span>Still open</span><strong>${openOrders}</strong></article>`;
        }
        if (!items.length) {
            list.innerHTML = '<p class="mc-empty">No order errors were pushed to you. When admin pushes an error for one of your orders, it appears here.</p>';
            return;
        }
        list.innerHTML = items.map((item) => {
            const orders = item.orders || [];
            const allDone = orders.length > 0 && orders.every((order) => (order.status || 'new') === 'completed');
            const rows = orders.map((order) => {
                const state = oeStatusLabel(order);
                const wrong = order.currentValue != null && order.currentValue !== '' ? order.currentValue : (order.incorrectValue || 'blank');
                return `<tr>
                    <td><b>${esc(order.boNumber || '—')}</b></td>
                    <td>${esc(order.product || item.product || '—')}</td>
                    <td>${esc(order.orderDate || '—')}</td>
                    <td>${esc(item.column || order.column || '—')}: <b>${esc(wrong)}</b></td>
                    <td><span class="oe-status ${state.cls}">${state.label}</span></td>
                </tr>`;
            }).join('');
            return `<article class="oe-card${allDone ? ' is-done' : ''}">
                <div class="oe-card-head">
                    <h2>${esc(item.name || 'Order error')}</h2>
                    <span class="oe-status ${allDone ? 'is-sent' : ''}">${orders.length} order${orders.length === 1 ? '' : 's'}</span>
                </div>
                <p class="oe-what">In <b>${esc(item.column || 'the BO file')}</b>, the value <b>${esc(item.incorrectValue || 'blank')}</b> is wrong${item.correctValue ? ` — it should be <span class="oe-fix">${esc(item.correctValue)}</span>` : ''}.${item.product ? ` Car: ${esc(item.product)}.` : ''}</p>
                ${item.message ? `<div class="oe-msg">${esc(item.message)}</div>` : ''}
                <div style="overflow:auto;"><table class="oe-table"><thead><tr><th>Order number</th><th>Car</th><th>Order date</th><th>What is wrong</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No orders listed.</td></tr>'}</tbody></table></div>
                <div class="oe-actions">
                    ${allDone ? '' : `<button type="button" data-oe-viewed="${esc(item.ruleId)}">Mark as viewed</button>`}
                    <button type="button" data-oe-open="${esc(item.ruleId)}">Open in Messages</button>
                </div>
            </article>`;
        }).join('');
        list.querySelectorAll('[data-oe-viewed]').forEach((button) => button.addEventListener('click', () => markAlert(button.dataset.oeViewed, 'viewed', '')));
        list.querySelectorAll('[data-oe-open]').forEach((button) => button.addEventListener('click', () => showView('inbox')));
    }
    let marketingHit = null;
    function paintMarketing(order) {
        const box = $('marketing-result');
        if (!box) return;
        if (!order) { box.innerHTML = ''; return; }
        const fields = (order.fields || []).map((field) => `<div><span>${esc(field.label)}</span><b title="${esc(field.value)}">${esc(field.value)}</b></div>`).join('');
        box.innerHTML = `<article class="marketing-card">
            <h2>Order ${esc(order.orderNumber)}</h2>
            <div class="marketing-fields">${fields || '<div><span>BO file</span><b>No other values on this row</b></div>'}</div>
            <button class="solid" id="marketing-send" type="button">Send to admin</button>
        </article>`;
        $('marketing-send').addEventListener('click', sendMarketing);
    }
    async function checkMarketing(event) {
        event.preventDefault();
        const session = readSession();
        if (!session) return endSession('logout');
        const note = $('marketing-note');
        const query = $('marketing-order').value.trim();
        marketingHit = null;
        paintMarketing(null);
        note.classList.remove('is-thanks', 'is-cancel');
        note.textContent = 'Checking the BO file…';
        const res = await fetch('/api/reserved-orders/marketing/lookup?token=' + encodeURIComponent(session.token) + '&q=' + encodeURIComponent(query));
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) return endSession('logout');
        touch();
        if (!res.ok) { note.textContent = data.error || 'Could not check the BO file.'; return; }
        if (!data.found) { note.textContent = 'This order number is not in the BO file.'; return; }
        marketingHit = data.order;
        note.textContent = 'This order is in the BO file. Send it to admin if it is the right one.';
        paintMarketing(data.order);
    }
    async function sendMarketing() {
        const session = readSession();
        if (!session || !marketingHit) return;
        const note = $('marketing-note');
        const res = await fetch('/api/reserved-orders/marketing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, orderNumber: marketingHit.orderNumber })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) return endSession('logout');
        touch();
        if (!res.ok) {
            note.classList.remove('is-thanks');
            note.textContent = data.error || 'Could not send this order.';
            return;
        }
        const sentNumber = marketingHit.orderNumber;
        marketingHit = null;
        const input = $('marketing-order');
        if (input) input.value = '';
        const box = $('marketing-result');
        if (box) box.innerHTML = `<article class="marketing-card marketing-thanks"><h2>Thank you</h2><p>Order ${esc(sentNumber)} was sent to admin. Enter another order number.</p></article>`;
        note.classList.add('is-thanks');
        note.textContent = `Thank you. Order ${sentNumber} was sent to admin. You can enter another order number.`;
        loadMyMarketing();
    }
    function paintMyMarketing(requests) {
        const list = $('marketing-sent-list');
        if (!list) return;
        const rows = Array.isArray(requests) ? requests : [];
        list.innerHTML = rows.length
            ? rows.map((item) => {
                const fields = (item.fields || []).map((field) => `<div><span>${esc(field.label)}</span><b title="${esc(field.value)}">${esc(field.value)}</b></div>`).join('');
                const cancelled = item.cancelled === true;
                return `<article class="marketing-card${cancelled ? ' is-cancelled' : ''}">
                    <h2>Order ${esc(item.orderNumber)}</h2>
                    <p class="marketing-sent-meta">Sent ${esc(item.display || item.at || '—')}${item.product ? ' · ' + esc(item.product) : ''}${cancelled ? `<span class="marketing-cancel-label">Cancelled${item.cancelledDisplay ? ' ' + esc(item.cancelledDisplay) : ''}</span>` : ''}</p>
                    <div class="marketing-fields">${fields || '<div><span>BO file</span><b>No other values saved for this order</b></div>'}</div>
                    ${cancelled ? '' : `<button class="ghost" type="button" data-cancel="${esc(item.id)}" data-order="${esc(item.orderNumber)}">Cancel</button>`}
                </article>`;
            }).join('')
            : '<p class="marketing-note">You have not sent any orders yet.</p>';
    }
    async function loadMyMarketing() {
        const session = readSession();
        const list = $('marketing-sent-list');
        if (!session || !list) return;
        const res = await fetch('/api/reserved-orders/marketing/mine?token=' + encodeURIComponent(session.token));
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) return endSession('logout');
        if (!res.ok) return;
        paintMyMarketing(data.requests || []);
    }
    async function cancelMarketing(id, orderNumber) {
        const session = readSession();
        if (!session || (!id && !orderNumber)) return;
        const note = $('marketing-note');
        const res = await fetch('/api/reserved-orders/marketing/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: session.token, id, orderNumber })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) return endSession('logout');
        touch();
        if (!res.ok) {
            if (note) {
                note.classList.remove('is-thanks', 'is-cancel');
                note.textContent = data.error || 'Could not cancel this order.';
            }
            loadMyMarketing();
            return;
        }
        if (note) {
            note.classList.remove('is-thanks');
            note.classList.add('is-cancel');
            note.textContent = `Order ${orderNumber || ''} was cancelled. Admin will see it as cancelled.`;
        }
        loadMyMarketing();
    }
    const togglePass = $('toggle-pass');
    if (togglePass) togglePass.addEventListener('click', () => {
        const input = $('employee-id');
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        togglePass.textContent = show ? 'Hide' : 'Show';
    });
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
        writeSession({
            token: data.token,
            name: data.name,
            employeeNumber: data.employeeNumber,
            recordId: data.recordId,
            canEditOrdersStartingWith5: !!data.canEditOrdersStartingWith5,
            last: Date.now()
        });
        $('employee-id').value = '';
        openApp();
        askDesktopAlertsOnce(readSession());
    });
    $('logout').addEventListener('click', () => endSession('logout'));
    ['click', 'keydown', 'input', 'change', 'scroll'].forEach((type) => window.addEventListener(type, touch, { passive: true }));
    document.addEventListener('change', (event) => {
        const select = event.target.closest('.status-select');
        if (!select) return;
        const card = select.closest('.lane');
        if (!card) return;
        requestStatus(card.dataset.key, select.value, select);
    });
    ['search', 'filter-status', 'filter-product', 'filter-area', 'filter-advisor', 'filter-queue', 'sort'].forEach((id) => {
        $(id).addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(render, 120); });
        $(id).addEventListener('change', render);
    });
    const mcSearch = $('mc-search');
    if (mcSearch) mcSearch.addEventListener('input', () => {
        const current = document.querySelector('#mc-work [data-admin-msg]');
        if (current) mcDrafts[current.dataset.draftKey] = current.value;
        mcQuery = mcSearch.value;
        paintMessageCenter();
    });
    $('filter-clear').addEventListener('click', () => { clearFilters(); render(); });
    $('filter-refresh').addEventListener('click', () => { loadLive.last = ''; loadLive(); });
    $('kpis').addEventListener('click', (event) => {
        const button = event.target.closest('[data-kpi]');
        if (button) applyKpi(button.dataset.kpi);
    });
    function toggleBoDetails(event) {
        const toggle = event.target.closest('.bo-toggle');
        if (!toggle) return;
        const row = toggle.nextElementSibling;
        if (!row || !row.classList.contains('excel-row')) return;
        const collapsed = row.classList.toggle('hidden');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.textContent = collapsed ? 'View Full BO Details' : 'Hide Full BO Details';
    }
    $('cards').addEventListener('click', (event) => {
        const tile = event.target.closest('.rc-tile');
        if (tile) openOrderModal(tile.dataset.tileKey);
    });
    // Sheet: click selects a cell, double-click opens the full card, the status select (own orders only) saves.
    if ($('emp-sheet')) {
        $('emp-sheet').addEventListener('click', (event) => {
            const td = event.target.closest('tbody td');
            if (!td) return;
            const tr = td.parentElement;
            sheetSelect(tr.sectionRowIndex, td.cellIndex - 1, false);
        });
        $('emp-sheet').addEventListener('dblclick', (event) => {
            if (event.target.closest('select')) return;
            const tr = event.target.closest('tbody tr');
            if (tr && tr.dataset.key) openOrderModal(tr.dataset.key);
        });
        $('emp-sheet').addEventListener('change', (event) => {
            const select = event.target.closest('.xl-status-select');
            if (select) requestStatus(select.dataset.key, select.value, select);
        });
        $('emp-sheet').addEventListener('click', (event) => {
            const edit = event.target.closest('.xl-note-edit');
            if (!edit) return;
            const order = orders.find((item) => item.key === edit.dataset.key);
            if (order && statusKey(order.status)) requestStatus(order.key, order.status, null);
        });
        $('emp-sheet').addEventListener('keydown', (event) => {
            if (event.target.closest('select')) return;
            const moves = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
            if (!moves[event.key]) return;
            event.preventDefault();
            sheetSelect(sheetSel.r + moves[event.key][0], sheetSel.c + moves[event.key][1], true);
        });
    }
    if ($('note-modal')) {
        $('note-save').addEventListener('click', saveNoteDialog);
        $('note-cancel').addEventListener('click', closeNoteDialog);
        $('note-modal').addEventListener('click', (event) => { if (event.target === $('note-modal')) closeNoteDialog(); });
        $('note-text').addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveNoteDialog(); }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !$('note-modal').classList.contains('hidden')) closeNoteDialog();
        });
    }
    if ($('view-sheet')) $('view-sheet').addEventListener('click', () => setViewMode('sheet'));
    if ($('view-cards')) $('view-cards').addEventListener('click', () => setViewMode('cards'));
    if ($('order-modal')) {
        $('order-modal').addEventListener('change', (event) => {
            const select = event.target.closest('.rd-status-select');
            if (select) requestStatus(select.dataset.key, select.value, select);
        });
        $('order-modal').addEventListener('click', (event) => {
            const edit = event.target.closest('.rd-note-edit');
            if (edit) {
                const target = orders.find((item) => item.key === edit.dataset.key);
                if (target && statusKey(target.status)) requestStatus(target.key, target.status, null);
                return;
            }
            if (event.target === $('order-modal') || event.target.closest('.rc-close')) { closeOrderModal(); return; }
            toggleBoDetails(event);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && openOrderKey) closeOrderModal();
        });
    }
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
    if ($('marketing-form')) $('marketing-form').addEventListener('submit', checkMarketing);
    if ($('marketing-sent-list')) $('marketing-sent-list').addEventListener('click', (event) => {
        const button = event.target.closest('[data-cancel]');
        if (!button || button.disabled) return;
        button.disabled = true;
        cancelMarketing(button.dataset.cancel, button.dataset.order);
    });
    if ($('marketing-order')) $('marketing-order').addEventListener('input', () => {
        marketingHit = null;
        paintMarketing(null);
        const note = $('marketing-note');
        if (note) {
            note.classList.remove('is-thanks', 'is-cancel');
            note.textContent = 'Enter the order number. If it is in the BO file, you can send it to admin.';
        }
    });
    if ($('lookup-form')) $('lookup-form').addEventListener('submit', (event) => { event.preventDefault(); lookup($('lookup-q').value.trim()); });
    if ($('vehicles')) $('vehicles').addEventListener('click', (event) => { const button = event.target.closest('.vehicle'); if (button) showVehicle(button); });
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

    function mcRows() {
        const rows = [];
        boAlerts.forEach((item) => {
            (item.orders || []).forEach((order) => {
                const reserved = dataOrders().find((row) => String(row.orderNumber) === String(order.boNumber));
                rows.push({
                    key: item.ruleId + '::' + order.boNumber,
                    ruleId: item.ruleId,
                    alert: item,
                    order,
                    vin: reserved && reserved.vin ? reserved.vin : ''
                });
            });
        });
        return rows;
    }
    function mcStatus(row) {
        const status = row.order.status || 'new';
        if (status === 'completed') return { label: 'Sent', cls: 'is-sent' };
        if (status === 'in_progress') return { label: 'In progress', cls: 'is-progress' };
        if (status === 'viewed') return { label: 'Viewed', cls: 'is-viewed' };
        return { label: 'Needs action', cls: 'is-need' };
    }
    function mcSoon(order) {
        const match = String(order.orderDate || '').match(/(\d{1,2})[./](\d{1,2})[./](\d{4})|(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return false;
        const date = match[3]
            ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
            : new Date(Number(match[4]), Number(match[5]) - 1, Number(match[6]));
        const days = (date.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000;
        return days <= 3;
    }
    function paintMessageCenter() {
        const summary = $('mc-summary');
        const list = $('mc-orders');
        if (!summary || !list) return;
        const rows = mcRows();
        const needle = mcQuery.trim().toLowerCase();
        const visible = rows.filter((row) => {
            const blob = [row.order.boNumber, row.order.product, row.vin, row.alert.column, row.alert.name, row.alert.message].join(' ').toLowerCase();
            return !needle || blob.includes(needle);
        });
        const need = rows.filter((row) => mcStatus(row).cls === 'is-need' || mcStatus(row).cls === 'is-viewed').length;
        const sent = rows.filter((row) => mcStatus(row).cls === 'is-sent').length;
        const soon = rows.filter((row) => mcSoon(row.order) && mcStatus(row).cls !== 'is-sent').length;
        summary.innerHTML = `
            <article class="is-need"><span>Needs action</span><strong>${need}</strong></article>
            <article class="is-sent"><span>Sent messages</span><strong>${sent}</strong></article>
            <article class="is-soon"><span>Approaching deadlines</span><strong>${soon}</strong></article>`;
        if (!rows.length) {
            list.innerHTML = '<p class="mc-empty">No messages for your orders yet.</p>';
            $('mc-work').innerHTML = '<p class="mc-empty">When an alert is pushed for your name, the orders appear here.</p>';
            return;
        }
        if (!visible.some((row) => row.key === mcKey)) mcKey = (visible[0] && visible[0].key) || '';
        list.innerHTML = visible.map((row) => {
            const state = mcStatus(row);
            return `<button type="button" class="mc-card${row.key === mcKey ? ' is-on' : ''}" data-mc="${esc(row.key)}">
                <b>${esc(row.order.product || row.alert.product || 'Vehicle')}</b>
                <span>Order ${esc(row.order.boNumber || '—')}</span>
                <span>${row.vin ? 'VIN ' + esc(row.vin) : esc(row.alert.column || 'Error')}</span>
                <span class="${mcSoon(row.order) && state.cls !== 'is-sent' ? 'is-soon' : ''}">${esc(row.order.orderDate || 'No BO date')}</span>
                <em class="${state.cls}">${state.label}</em>
            </button>`;
        }).join('') || '<p class="mc-empty">No orders match this search.</p>';
        list.querySelectorAll('[data-mc]').forEach((button) => button.addEventListener('click', () => {
            const current = document.querySelector('#mc-work [data-admin-msg]');
            if (current) mcDrafts[current.dataset.draftKey] = current.value;
            mcKey = button.dataset.mc;
            paintMessageCenter();
        }));
        paintMessageWork(rows.find((row) => row.key === mcKey));
    }
    function paintMessageWork(row) {
        const work = $('mc-work');
        if (!work) return;
        if (!row) {
            work.innerHTML = '<p class="mc-empty">Select an order to read and send its message.</p>';
            return;
        }
        const state = mcStatus(row);
        const draft = mcDrafts[row.key] != null ? mcDrafts[row.key] : row.alert.message;
        const dated = hasMessageDate(draft);
        const when = row.order.at ? new Date(row.order.at).toLocaleString() : '';
        work.innerHTML = `<div class="mc-detail">
            <div class="mc-detail-head">
                <div>
                    <h2>${esc(row.order.product || 'Order')} · ${esc(row.order.boNumber || '—')}</h2>
                    <p>${row.vin ? 'VIN ' + esc(row.vin) + ' · ' : ''}${esc(row.alert.name && row.alert.name !== row.alert.column ? row.alert.name + ' · ' + (row.alert.column || 'Error') : (row.alert.column || row.alert.name || 'Error'))}</p>
                </div>
                <em class="${state.cls}">${state.label}</em>
            </div>
            <div class="mc-facts">
                <span>Incorrect<b>${esc(row.alert.incorrectValue || 'blank')}</b></span>
                <span>Correct<b>${esc(row.order.correctValue || row.alert.correctValue || '—')}</b></span>
                <span>BO date<b>${esc(row.order.orderDate || '—')}</b></span>
                <span>Saved<b>${esc(when || 'Not confirmed')}</b></span>
                <span>WhatsApp<b>${esc(phone(row.order.phone) || 'No number in column X')}</b></span>
            </div>
            <label class="mc-editor"><span>Message</span>
                <textarea id="mc-message" data-admin-msg="${esc(row.ruleId)}" data-draft-key="${esc(row.key)}" rows="5">${esc(draft)}</textarea>
            </label>
            ${dated ? `<div class="date-step"><span>Deadline</span><button type="button" id="mc-minus">−1 day</button><button type="button" id="mc-plus">+1 day</button></div>` : '<p class="mc-note">This message has no date to adjust.</p>'}
            <div class="mc-preview-box"><div class="wa-bubble" id="mc-preview"></div></div>
            <div class="mc-actions">
                <button type="button" id="mc-wa">Open WhatsApp</button>
                <button type="button" class="ghost" id="mc-copy">Copy message</button>
                <button type="button" class="solid" id="mc-sent">${state.cls === 'is-sent' ? 'Confirm sent again' : 'Mark as sent'}</button>
            </div>
            <p class="mc-note" id="mc-note">${esc(mcNotice || 'Opening WhatsApp does not mark the message as sent.')}</p>
        </div>`;
        const field = $('mc-message');
        const paint = () => {
            mcDrafts[row.key] = field.value;
            $('mc-preview').textContent = field.value;
        };
        paint();
        field.addEventListener('input', paint);
        const shift = (delta) => { field.value = shiftMessageDates(field.value, delta); paint(); };
        if ($('mc-minus')) $('mc-minus').addEventListener('click', () => shift(-1));
        if ($('mc-plus')) $('mc-plus').addEventListener('click', () => shift(1));
        mcNotice = '';
        $('mc-copy').addEventListener('click', () => {
            const done = () => { $('mc-note').textContent = 'Message copied.'; };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(field.value).then(done).catch(() => { field.focus(); field.select(); $('mc-note').textContent = 'Message selected. Press Ctrl+C to copy it.'; });
            } else { field.focus(); field.select(); $('mc-note').textContent = 'Message selected. Press Ctrl+C to copy it.'; }
        });
        $('mc-wa').addEventListener('click', () => {
            const digits = openWhatsApp(field.value.trim(), row.order.phone);
            mcNotice = digits
                ? `WhatsApp opened for ${digits}. Mark as sent only after you press Send there.`
                : 'This order has no number in column X. WhatsApp opened without a number.';
            if (row.order.status === 'new' || row.order.status === 'viewed') markAlert(row.ruleId, 'in_progress', row.order.boNumber);
            else paintMessageCenter();
        });
        $('mc-sent').addEventListener('click', () => confirmSent(row.ruleId, row.order.boNumber, field.value.trim()));
    }
    // ---- Laptop (desktop) pop-up notifications ----
    // Uses only the browser's own Notification API: nothing is sent to email, chat apps or any outside service.
    // Fires for messages admin sends to this employee (Notifications + BO / order-error messages).
    const NOTIFIED_CAP = 300;
    // Pop-ups outside the browser need a browser that supports them and an https (or localhost) page.
    function desktopSupported() { return typeof window !== 'undefined' && 'Notification' in window && window.isSecureContext !== false; }
    // Fallback for everyone else (blocked, not asked yet, old browser, plain-http address): the same alert as a card
    // inside this page, so every user still gets the alert while the page is open.
    function showPageToast(title, body, view) {
        let box = document.getElementById('ro-toasts');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ro-toasts';
            box.setAttribute('role', 'status');
            box.setAttribute('aria-live', 'polite');
            document.body.appendChild(box);
        }
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'ro-toast';
        const strong = document.createElement('b');
        strong.textContent = title;
        const text = document.createElement('span');
        text.textContent = body || '';
        card.appendChild(strong);
        card.appendChild(text);
        const close = () => { card.remove(); };
        card.addEventListener('click', () => { try { showView(view || 'inbox'); } catch (e) { /* view may not be ready */ } close(); });
        box.appendChild(card);
        while (box.children.length > 4) box.firstChild.remove();
        setTimeout(close, 12000);
    }
    function notifiedStoreKey(session) { return 'ro-desktop-notified-v1-' + (session && (session.recordId || session.employeeNumber) || 'x'); }
    function readNotified(session) {
        try { return JSON.parse(localStorage.getItem(notifiedStoreKey(session)) || 'null'); } catch (e) { return null; }
    }
    function writeNotified(session, list) {
        try { localStorage.setItem(notifiedStoreKey(session), JSON.stringify(list.slice(-NOTIFIED_CAP))); } catch (e) { /* storage full or blocked */ }
    }
    function paintDesktopButton() {
        paintAlertsBanner();
        const button = $('notif-toggle');
        if (!button) return;
        button.hidden = false; // always shown, so every user can switch alerts on
        if (!desktopSupported()) {
            button.classList.remove('is-blocked');
            button.classList.add('is-on');
            button.textContent = 'Page alerts on';
            button.title = 'This browser or address cannot show pop-ups outside the page. Alerts appear inside this page while it is open. Click to see a test.';
            return;
        }
        const permission = Notification.permission;
        button.classList.toggle('is-on', permission === 'granted');
        button.classList.toggle('is-blocked', permission === 'denied');
        if (permission === 'granted') {
            button.textContent = 'Laptop alerts on';
            button.title = 'You get a pop-up on this laptop when admin sends you a message. Click to send a test.';
        } else if (permission === 'denied') {
            button.textContent = 'Laptop alerts blocked';
            button.title = 'Notifications are blocked for this site. Allow them in the browser address-bar site settings, then reload.';
        } else {
            button.textContent = 'Enable laptop alerts';
            button.title = 'Get a pop-up on this laptop when admin sends you a message.';
        }
    }
    function showDesktopNotification(title, body, tag, view) {
        if (!desktopSupported() || Notification.permission !== 'granted') { showPageToast(title, body, view); return; }
        try {
            // requireInteraction keeps the pop-up on screen until the person clicks or closes it.
            const note = new Notification(title, { body, tag, renotify: false, requireInteraction: true, icon: 'images/logo/toyota.png', dir: 'auto' });
            note.onclick = () => {
                window.focus();
                try { showView(view || 'inbox'); } catch (e) { /* view may not be ready */ }
                note.close();
            };
        } catch (e) { showPageToast(title, body, view); /* some browsers only allow notifications from a service worker */ }
    }
    // First run for a person only records what already exists (no flood of old items); later runs pop up the new ones.
    function pushDesktopAlerts(session, candidates) {
        if (!session || !candidates.length) return;
        const stored = readNotified(session);
        const seenKeys = Array.isArray(stored) ? stored : null;
        const known = new Set(seenKeys || []);
        const fresh = candidates.filter((item) => !known.has(item.key));
        if (!fresh.length) { if (!seenKeys) writeNotified(session, []); return; }
        if (seenKeys) {
            if (fresh.length > 3) {
                showDesktopNotification(`${fresh.length} new messages from admin`, fresh.slice(0, 3).map((item) => item.title).join(' · ') + ' …', 'ro-batch');
            } else {
                fresh.forEach((item) => showDesktopNotification(item.title, item.body, item.key));
            }
        }
        writeNotified(session, Array.from(known).concat(fresh.map((item) => item.key)));
    }
    function desktopCandidates(notifications, alerts) {
        const list = [];
        (notifications || []).filter((item) => !item.seen).forEach((item) => {
            list.push({ key: 'n:' + item.id, title: item.title || 'Notification from admin', body: String(item.message || '').slice(0, 180) });
        });
        (alerts || []).forEach((alert) => {
            (alert.orders || []).filter((order) => !order.status || order.status === 'new').forEach((order) => {
                list.push({
                    key: 'a:' + alert.ruleId + '::' + order.boNumber,
                    title: 'Admin message · order ' + order.boNumber,
                    body: String(alert.name || alert.message || 'Open Messages to read and send it.').slice(0, 180)
                });
            });
        });
        return list;
    }
    function paintUnreadTitle(count) {
        const base = document.title.replace(/^\(\d+\)\s*/, '');
        document.title = count > 0 ? `(${count}) ${base}` : base;
    }
    async function toggleDesktopAlerts() {
        if (!desktopSupported()) {
            showPageToast('Page alerts are on', 'Pop-ups outside the browser are not available here, so admin messages will appear inside this page while it is open.');
            return;
        }
        if (Notification.permission === 'default') {
            try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
            paintDesktopButton();
            if (Notification.permission === 'granted') showDesktopNotification('Laptop alerts are on', 'You will get a pop-up here when admin sends you a message.', 'ro-test');
            else showPageToast('Laptop pop-ups are off', 'Admin messages will still appear inside this page. To get laptop pop-ups, allow notifications for this site in the browser address bar.');
            return;
        }
        if (Notification.permission === 'denied') {
            showPageToast('Laptop alerts are blocked', 'Click the lock icon in the address bar, set Notifications to Allow, then reload this page. Until then messages appear inside this page.');
            return;
        }
        showDesktopNotification('Test notification', 'This is how admin messages will appear on this laptop.', 'ro-test');
        paintDesktopButton();
    }
    // Every user is asked to allow computer pop-ups: right after sign-in (a click, so browsers allow it), again on the
    // first click of every later visit while it is still undecided, and a banner at the top stays until they decide.
    let askedThisVisit = false;
    function afterPermissionChoice() {
        paintDesktopButton();
        if (desktopSupported() && Notification.permission === 'granted') {
            showDesktopNotification('Computer pop-ups are on', 'You will get a pop-up here for admin messages and new orders assigned to you.', 'ro-test');
        }
    }
    function askDesktopAlertsOnce(session) {
        if (!desktopSupported() || Notification.permission !== 'default' || !session || askedThisVisit) return;
        askedThisVisit = true;
        try {
            const pending = Notification.requestPermission();
            if (pending && typeof pending.then === 'function') pending.then(afterPermissionChoice, afterPermissionChoice);
            else afterPermissionChoice();
        } catch (e) { askedThisVisit = false; }
    }
    document.addEventListener('click', () => {
        if (readSession() && !$('app').classList.contains('hidden')) askDesktopAlertsOnce(readSession());
    }, true);
    function paintAlertsBanner() {
        const box = $('alerts-banner');
        if (!box) return;
        const session = readSession();
        let state = 'hidden';
        if (session && desktopSupported()) {
            if (Notification.permission === 'default') state = 'ask';
            else if (Notification.permission === 'denied') {
                let dismissed = false;
                try { dismissed = sessionStorage.getItem('ro-alerts-blocked-dismissed') === '1'; } catch (e) { /* ignore */ }
                if (!dismissed) state = 'blocked';
            }
        }
        box.hidden = state === 'hidden';
        box.dataset.state = state;
        if (state === 'ask') {
            box.innerHTML = '<span><b>Turn on computer pop-up alerts.</b> You will get a pop-up on this computer when admin sends you a message or a new order is assigned to you.</span><button type="button" class="solid" data-alerts="enable">Turn on</button>';
        } else if (state === 'blocked') {
            box.innerHTML = '<span><b>Computer pop-ups are blocked for this site.</b> Click the lock icon in the address bar, set Notifications to Allow, then reload this page.</span><button type="button" class="ghost" data-alerts="dismiss">Dismiss</button>';
        } else {
            box.innerHTML = '';
        }
    }
    if ($('alerts-banner')) $('alerts-banner').addEventListener('click', (event) => {
        const button = event.target.closest('[data-alerts]');
        if (!button) return;
        if (button.dataset.alerts === 'dismiss') {
            try { sessionStorage.setItem('ro-alerts-blocked-dismissed', '1'); } catch (e) { /* ignore */ }
            paintAlertsBanner();
            return;
        }
        askedThisVisit = false;
        askDesktopAlertsOnce(readSession());
    });
    // A new order in this person's name (after the first visit) gets its own pop-up.
    function notifyMyNewOrders() {
        const session = readSession();
        const all = dataOrders();
        if (!session || !all.length) return;
        const mine = all.filter(canUpdateOrder);
        const storeKey = 'ro-my-orders-v1-' + (session.recordId || session.employeeNumber || 'x');
        let known = null;
        try { known = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) { known = null; }
        try { localStorage.setItem(storeKey, JSON.stringify(mine.map((order) => order.key))); } catch (e) { /* storage blocked */ }
        if (!Array.isArray(known)) return;          // first visit only records what already exists
        const seen = new Set(known);
        const fresh = mine.filter((order) => !seen.has(order.key));
        if (!fresh.length) return;
        const describe = (order) => {
            const values = sheetValues(order);
            return [values.Product, values['Order number'] ? 'order ' + values['Order number'] : '', values.VIN].filter(Boolean).join(' · ');
        };
        if (fresh.length > 3) showDesktopNotification(`${fresh.length} new reserved orders for you`, fresh.slice(0, 3).map(describe).join(' | ') + ' …', 'ro-new-batch', 'orders');
        else fresh.forEach((order) => showDesktopNotification('New reserved order for you', describe(order), 'ro-new:' + order.key, 'orders'));
    }
    async function paintMyAlerts() {
        const session = readSession();
        if (!session) return;
        const res = await fetch('/api/reserved-orders/my-bo-corrections?token=' + encodeURIComponent(session.token));
        if (!res.ok) return;
        const data = await res.json();
        boAlerts = data.alerts || [];
        paintMessageCenter();
        paintOrderErrors();
        paintEmpNotifications();
    }
    async function paintEmpNotifications() {
        const box = $('emp-notifications');
        const session = readSession();
        if (!box || !session) return;
        try {
            const res = await fetch('/api/reserved-orders/my-notifications?token=' + encodeURIComponent(session.token));
            if (!res.ok) return;
            const data = await res.json();
            const items = data.notifications || [];
            const candidates = desktopCandidates(items, boAlerts);
            pushDesktopAlerts(session, candidates);
            paintUnreadTitle(candidates.length);
            box.hidden = !items.length;
            if (!items.length) { box.innerHTML = ''; return; }
            box.innerHTML = items.map((item) => {
                const at = item.at ? new Date(item.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
                return `<article class="emp-notif${item.seen ? ' is-seen' : ''}">
                    <div class="emp-notif-head"><b>${esc(item.title || 'Notification from admin')}</b><span>${esc(at)}</span></div>
                    <p>${esc(item.message || '')}</p>
                    ${item.seen ? '' : `<button type="button" data-notif-seen="${esc(item.id)}">Mark as read</button>`}
                </article>`;
            }).join('');
            box.querySelectorAll('[data-notif-seen]').forEach((button) => button.addEventListener('click', async () => {
                const current = readSession();
                if (!current) return;
                await fetch('/api/reserved-orders/my-notifications/seen', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: current.token, id: button.dataset.notifSeen })
                });
                paintEmpNotifications();
            }));
        } catch (e) { /* notifications stay hidden offline */ }
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
        showView('inbox');
        $('who').textContent = session.name;
        $('who-id').textContent = 'ID: ' + session.employeeNumber;
        $('msg-advisor').value = session.name;
        loadLive();
        loadVehicles();
        paintMyAlerts();
        paintDesktopButton();
        askDesktopAlertsOnce(session);
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
    // Safety net when the live socket is down: re-check admin messages every 30 s, repaint only if something changed.
    let lastMessagesStamp = '';
    setInterval(async () => {
        const session = readSession();
        if (!session) return;
        try {
            const [mine, notes] = await Promise.all([
                fetch('/api/reserved-orders/my-bo-corrections?token=' + encodeURIComponent(session.token)).then((res) => (res.ok ? res.text() : '')),
                fetch('/api/reserved-orders/my-notifications?token=' + encodeURIComponent(session.token)).then((res) => (res.ok ? res.text() : ''))
            ]);
            const stamp = mine + '|' + notes;
            if (lastMessagesStamp && stamp !== lastMessagesStamp) paintMyAlerts();
            lastMessagesStamp = stamp;
        } catch (e) { /* offline: try again next tick */ }
    }, 15000);
    if ($('notif-toggle')) $('notif-toggle').addEventListener('click', toggleDesktopAlerts);
    paintDesktopButton();
    loadNames();
    loadCars();
    if (readSession()) openApp();
})();
