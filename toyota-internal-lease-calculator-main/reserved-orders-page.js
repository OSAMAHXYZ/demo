(function () {
    let STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
    const CARS = [
        ['Camry', 'images/cars/camry.png'], ['Corolla', 'images/cars/corolla.png'], ['Crown', 'images/cars/crown.png'],
        ['Fortuner', 'images/cars/fortuner.png'], ['Highlander', 'images/cars/highlander.png'], ['Hilux', 'images/cars/hilux.png'],
        ['Land Cruiser', 'images/cars/land cruiser.png'], ['Prado', 'images/cars/prado.png'], ['RAV4', 'images/cars/rav4.png'],
        ['Raize', 'images/cars/raize.png'], ['Yaris', 'images/cars/yaris.png'], ['Innova', 'images/cars/innova.png'],
        ['Veloz', 'images/cars/veloz.png'], ['Urban Cruiser', 'images/cars/urban cruiser.png'], ['Corolla Cross', 'images/cars/corolla cross.png'],
        ['GR86', 'images/cars/gr86.png']
    ];
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
    function isSoon(order) {
        if (!isActive(order)) return false;
        const ms = remainingMs(order);
        return ms != null && ms > 0 && ms <= 6 * 3600000;
    }
    function hasNoAssign(order) { return remainingMs(order) == null; }
    function queueLabel(n) {
        if (n == null || n === '') return '#—';
        const num = Number(n);
        return '#' + (Number.isFinite(num) ? pad(num) : n);
    }
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
        if (Array.isArray(data.statuses) && data.statuses.length) STATUSES = data.statuses;
        const stamp = $('updated-at');
        if (stamp) stamp.textContent = data.updatedAt ? `Live data ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for a live push';
        const payload = [data.updatedAt || '', next.length, next[0] && next[0].statusChangedAt || '', next[0] && next[0].status || '', STATUSES.join('|')].join('|');
        if (payload === loadLive.last && document.querySelector('#cards .lane')) return tickTimers();
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
        status.innerHTML = '<option value="">All statuses</option>' + STATUSES.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
        const advisors = Array.from(new Set(orders.map((order) => order.salesAdvisor).filter((name) => name && name !== 'UNASSIGNED'))).sort();
        const unassigned = orders.some((order) => order.salesAdvisor === 'UNASSIGNED') ? '<option value="UNASSIGNED">UNASSIGNED</option>' : '';
        advisor.innerHTML = '<option value="">All advisors</option>' + advisors.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('') + unassigned;
        const queues = Array.from(new Set(orders.map((order) => order.queueNumber).filter((n) => n != null))).sort((a, b) => a - b);
        queue.innerHTML = '<option value="">All queues</option>' + queues.map((n) => `<option value="${n}">${queueLabel(n)}</option>`).join('');
        const products = Array.from(new Set(orders.map((order) => order.vehicle).filter((name) => name && name !== '—'))).sort();
        product.innerHTML = '<option value="">All cars</option>' + products.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
        const areas = Array.from(new Set(orders.map((order) => order.searchArea).filter((name) => name && name !== '—'))).sort();
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
        const payment = chosen('filter-payment');
        const product = chosen('filter-product');
        const area = chosen('filter-area');
        const advisor = chosen('filter-advisor');
        const queue = chosen('filter-queue');
        const state = chosen('filter-state');
        const sort = $('sort').value;
        const list = dataOrders().filter((order) => {
            if (q && ![order.vin, order.orderNumber, order.customerName, order.salesAdvisor].join(' ').toLowerCase().includes(q)) return false;
            if (status && order.status !== status) return false;
            if (payment && order.paymentKind !== payment) return false;
            if (product && order.vehicle !== product) return false;
            if (area && order.searchArea !== area) return false;
            if (advisor && order.salesAdvisor !== advisor) return false;
            if (queue && String(order.queueNumber) !== queue) return false;
            if (state === 'expired' && !isExpired(order)) return false;
            if (state === 'active' && !isActive(order)) return false;
            if (state === 'soon' && !isSoon(order)) return false;
            if (state === 'nodate' && !hasNoAssign(order)) return false;
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
    function activeKpi() {
        const extras = $('search').value.trim() || chosen('filter-payment') || chosen('filter-product') || chosen('filter-area') || chosen('filter-advisor') || chosen('filter-queue');
        if (extras) return '';
        const status = chosen('filter-status');
        const state = chosen('filter-state');
        if (!status && !state) return 'total';
        if (!status && state === 'active') return 'active';
        if (!status && state === 'expired') return 'expired';
        if (!status && state === 'soon') return 'soon';
        if (status === 'تم الفوترة' && !state) return 'completed';
        return '';
    }
    function clearFilters() {
        ['search', 'filter-status', 'filter-payment', 'filter-product', 'filter-area', 'filter-advisor', 'filter-queue', 'filter-state'].forEach((id) => { $(id).value = ''; });
        $('sort').value = 'queue-asc';
    }
    function applyKpi(kind) {
        clearFilters();
        if (kind === 'active') $('filter-state').value = 'active';
        if (kind === 'expired') $('filter-state').value = 'expired';
        if (kind === 'completed') $('filter-status').value = 'تم الفوترة';
        if (kind === 'soon') $('filter-state').value = 'soon';
        render();
    }
    function render() {
        const list = visibleOrders();
        const source = dataOrders();
        const soon = source.filter(isSoon).length;
        const activeKey = activeKpi();
        $('kpis').innerHTML = [
            ['total', 'Total Reserved', source.length, ''],
            ['active', 'Active Orders', source.filter(isActive).length, 'ok'],
            ['expired', 'Expired', source.filter(isExpired).length, 'bad'],
            ['completed', 'Completed / Invoiced', source.filter(isCompleted).length, 'info'],
            ['soon', 'Approaching Deadline', soon, 'warn']
        ].map(([key, label, value, cls]) => `<button type="button" class="kpi ${cls}${activeKey === key ? ' on' : ''}" data-kpi="${key}"><em>${label}</em><strong>${value}</strong></button>`).join('');
        $('cards').innerHTML = list.length ? list.map((order) => cardHtml(order)).join('') : '<div class="empty">No reserved orders match this view.</div>';
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
        const advisor = personKey(columnText(order, 'T') || order.salesAdvisor);
        if (!advisor || advisor === 'unassigned') return false;
        if (personKey(session.name) === advisor) return true;
        return personKey(session.employeeNumber) === advisor;
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
        const img = carImage(product);
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
                <div class="thumb">${img ? `<img class="car" src="${img}" alt="" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="thumb-fallback" hidden>${esc(initial)}</span>` : (initial ? `<span class="thumb-fallback">${esc(initial)}</span>` : '')}</div>
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
                <span class="muted">${hours} HOURS</span>
                <div class="status-glow">
                    <span class="badge ${badge(order.status)}" dir="auto">${esc(order.status || 'محجوز')}</span>
                    <small>${esc(order.statusChangedBy || 'No update yet')}${order.statusChangedAt ? ' · ' + esc(statusWhen(order.statusChangedAt)) : ''}</small>
                </div>
                ${canUpdateOrder(order)
                    ? `<div class="status-row"><select class="status-select" aria-label="Change status">${STATUSES.map((status) => `<option value="${esc(status)}"${status === order.status ? ' selected' : ''}>${esc(status)}</option>`).join('')}${order.status && !STATUSES.includes(order.status) ? `<option value="${esc(order.status)}" selected>${esc(order.status)}</option>` : ''}</select></div>`
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
        document.querySelectorAll('.timer').forEach((el) => {
            const end = parseLocal(el.dataset.deadline);
            const ms = end ? end.getTime() - Date.now() : null;
            el.textContent = timerLabel(el.dataset.date || '', ms);
            el.className = `timer ${timerClass(ms)}`;
            const card = el.closest('.lane');
            const expired = ms != null && ms <= 0;
            if (card) card.classList.toggle('expired', expired);
            const block = el.closest('.order-block');
            if (block) block.classList.toggle('expired', expired);
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
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const note = document.querySelector(`[data-key="${CSS.escape(key)}"] .status-lock`);
            if (note) note.textContent = data.error || 'Only the assigned advisor can update this order.';
        }
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
    ['search', 'filter-status', 'filter-payment', 'filter-product', 'filter-area', 'filter-advisor', 'filter-queue', 'filter-state', 'sort'].forEach((id) => {
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
    $('cards').addEventListener('click', (event) => {
        const toggle = event.target.closest('.bo-toggle');
        if (!toggle) return;
        const row = toggle.nextElementSibling;
        if (!row || !row.classList.contains('excel-row')) return;
        const collapsed = row.classList.toggle('hidden');
        toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        toggle.textContent = collapsed ? 'View Full BO Details' : 'Hide Full BO Details';
    });
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
