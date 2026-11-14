(function () {
    // Employees choose one of only three statuses, and write a note with it.
    const STATUSES = ['Payment', 'In progress', 'Cancelled'];
    const NOT_UPDATED = '__none__'; // filter value for orders that have no status yet
    const MINE = '__mine__';
    // Built from code points so file encoding can never turn this label into mojibake.
    const MARKETING_LABEL = String.fromCharCode(0x0637, 0x0644, 0x0628, 0x0627, 0x062A, 0x20, 0x0627, 0x0644, 0x062A, 0x0633, 0x0648, 0x064A, 0x0642);
    function fixMarketingArabicLabels() {
        document.querySelectorAll('[data-view="marketing"] span, #marketing-board h1').forEach((node) => {
            node.setAttribute('dir', 'rtl');
            node.setAttribute('lang', 'ar');
            node.textContent = MARKETING_LABEL;
        });
    }
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
    let sheetLayout = { order: [], hidden: [] };
    let personalLayout = null; // per-user column order/hidden (this browser only — not admin global)
    let pickedKey = ''; // first click selects the row; second click opens the details drawer
    const EMP_DEFAULT_COLS = ['Salesman name', 'Model year', 'Customer name', 'Status', 'Note', 'Leader note', 'Updated by', 'Order number', 'Product', 'ALJ suffix', 'Exterior color', 'Interior color', 'VIN', 'Expiry date', 'Usage', 'Allocation age', 'Area', 'Share level', 'Queue 1', 'Queue 2', 'Queue 3'];
    const EMP_HEAD_SHORT = {
        'Queue 1': 'Q1', 'Queue 2': 'Q2', 'Queue 3': 'Q3',
        'Salesman name': 'Salesman', Salesman: 'Salesman', 'Customer name': 'Customer', Customer: 'Customer',
        'Updated by': 'Updated', Updated: 'Updated', 'Order number': 'Order #',
        'Model year': 'Year', 'ALJ suffix': 'Suffix', 'Exterior color': 'Ext', 'Interior color': 'Int',
        'Expiry date': 'Expiry', Expiry: 'Expiry', 'Allocation age': 'Age', 'Leader note': 'Leader'
    };
    const EMP_WIDTHS = {
        'Queue 2': 96, 'Queue 1': 96, 'Salesman name': 168, Salesman: 168, 'Queue 3': 96, 'Model year': 56,
        'Customer name': 168, Customer: 168, Status: 110, Note: 140, 'Leader note': 140, 'Updated by': 64, Updated: 64,
        'Order number': 92, Product: 96, 'ALJ suffix': 52, 'Exterior color': 44, 'Interior color': 40, VIN: 148,
        'Expiry date': 128, Expiry: 128, Usage: 56, 'Allocation age': 44, Area: 72, 'Share level': 110
    };
    const EMP_MIN_WIDTHS = {
        'Queue 1': 84, 'Queue 2': 84, 'Queue 3': 84, 'Model year': 56, Year: 56,
        'Salesman name': 96, Salesman: 96, 'Customer name': 96, Customer: 96,
        Status: 108, Note: 88, 'Leader note': 88, Product: 72, VIN: 132, 'Order number': 84,
        'Expiry date': 120, Expiry: 120, Area: 64, 'Share level': 96, 'ALJ suffix': 52
    };
    const EMP_MAX_WIDTHS = {
        'Salesman name': 280, Salesman: 280, 'Customer name': 300, Customer: 300,
        Note: 240, Product: 200, 'Share level': 180, Area: 160
    };
    const EMP_FIT_LABELS = new Set(['Salesman name', 'Salesman', 'Customer name', 'Customer', 'Note', 'Leader note', 'Product', 'Status']);
    const EMP_PAD_N = 14;
    const EMP_PAD_W = 64;
    const EMP_RN_W = 36;
    const EMP_MONO = new Set(['Order number', 'VIN', 'ALJ suffix', 'Exterior color', 'Interior color', 'Area', 'Model year', 'Queue 1', 'Queue 2', 'Queue 3']);
    let empXlWidths = {};
    try { empXlWidths = JSON.parse(localStorage.getItem('ro-sheet-colwidths') || '{}') || {}; } catch (e) { empXlWidths = {}; }
    let empSheetSort = { label: '', dir: '' };
    let empColFilter = { label: '', value: '' };
    let empFreezeOn = true;
    try { empFreezeOn = localStorage.getItem('ro-sheet-freeze') !== '0'; } catch (e) { /* keep */ }
    let empCfOn = false;
    try { empCfOn = localStorage.getItem('ro-sheet-cf') === '1'; } catch (e) { /* keep */ }
    let empXlZoom = 100;
    const empHist = [];
    let empHistI = -1;
    const EMP_SKIP_COLS = new Set();
    const EMP_KNOWN_COLS = new Set([
        'Queue 1', 'Queue 2', 'Queue 3', 'Queue', 'Status', 'Note', 'Leader note', 'Updated by', 'Updated',
        'Salesman name', 'Salesman', 'Customer name', 'Customer', 'Order number', 'Order · VIN',
        'Model year', 'Product', 'Car', 'ALJ suffix', 'Exterior color', 'Interior color', 'VIN',
        'Expiry date', 'Expiry', 'Usage', 'Allocation age', 'Area', 'Share level'
    ]);

    const $ = (id) => document.getElementById(id);
    function pad(n) { return String(n).padStart(2, '0'); }
    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    /* ---------- v2 design helpers (shared with reserved-orders-admin.js) ---------- */
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Slide a pill indicator (.ind / .rail-ind) under the active button of a group.
    function slideIndicator(ind, on) {
        if (!ind || !on) return;
        ind.style.left = on.offsetLeft + 'px'; ind.style.top = on.offsetTop + 'px';
        ind.style.width = on.offsetWidth + 'px'; ind.style.height = on.offsetHeight + 'px';
    }
    // Count a number up from 0 (KPI tiles).
    function countUp(el) {
        const to = Number(el.dataset.to) || 0;
        if (reduceMotion) { el.textContent = to; return; }
        const t0 = performance.now();
        const step = (t) => { const k = Math.min(1, (t - t0) / 650); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
    }
    // Grow bars from 0 to data-w percent on the next frame.
    function growBars(root) {
        requestAnimationFrame(() => requestAnimationFrame(() => (root || document).querySelectorAll('[data-w]').forEach((el) => { el.style.width = el.dataset.w + '%'; })));
    }
    // Replay the section entrance animation.
    function replayView(section) {
        if (!section) return;
        section.classList.remove('view'); void section.offsetWidth; section.classList.add('view');
    }
    // Toast: title, body, dot class (d-ok, d-warn, d-bad).
    function toast(title, body, dot) {
        let box = document.getElementById('toasts');
        if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
        const t = document.createElement('div'); t.className = 'toast';
        t.innerHTML = `<span class="dot ${dot || 'd-ok'}"></span><div><b></b><span></span></div>`;
        t.querySelector('b').textContent = title; t.querySelector('div span').textContent = body || '';
        box.appendChild(t);
        setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 240); }, 3200);
        return t;
    }
    let dataLoadHide;
    function setDataLoad(pct, hint) {
        const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
        const bar = $('data-load-bar');
        const label = $('data-load-pct');
        if (bar) bar.style.width = n + '%';
        if (label) label.textContent = n + '%';
        if (hint && $('data-load-hint')) $('data-load-hint').textContent = hint;
    }
    function showDataLoad(title, hint) {
        const box = $('data-load');
        if (!box) return;
        clearTimeout(dataLoadHide);
        if ($('data-load-title')) $('data-load-title').textContent = title || 'Downloading data';
        setDataLoad(8, hint || 'Getting the live reserved cars…');
        box.classList.remove('hidden');
        requestAnimationFrame(() => box.classList.add('on'));
    }
    function hideDataLoad() {
        const box = $('data-load');
        if (!box) return;
        setDataLoad(100, 'Ready');
        box.classList.remove('on');
        clearTimeout(dataLoadHide);
        dataLoadHide = setTimeout(() => box.classList.add('hidden'), 260);
    }
    const THEME_KEY = 'ro-theme';
    function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
    function applyTheme(mode) {
        const next = mode === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        document.documentElement.style.colorScheme = next;
        const meta = document.querySelector('meta[name="color-scheme"]');
        if (meta) meta.setAttribute('content', next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* storage blocked */ }
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            const day = next === 'dark';
            btn.setAttribute('aria-pressed', day ? 'false' : 'true');
            btn.setAttribute('title', day ? 'Day colors' : 'Night colors');
            btn.setAttribute('aria-label', day ? 'Day colors' : 'Night colors');
            const lab = btn.querySelector('[data-theme-label]');
            if (lab) lab.textContent = day ? 'Day' : 'Night';
        });
    }
    function initTheme() {
        let saved = 'dark';
        try { saved = localStorage.getItem(THEME_KEY) || 'dark'; } catch (e) { /* keep dark */ }
        applyTheme(saved === 'light' ? 'light' : 'dark');
        document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
            if (btn.dataset.bound) return;
            btn.dataset.bound = '1';
            btn.addEventListener('click', () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light'));
        });
    }
    initTheme();
    function fitSheet(wrap) {
        const box = wrap || document.querySelector('#emp-sheet.sheet-wrap, .sheet-wrap');
        const table = box && box.querySelector('.xl-grid');
        if (!box || !table) return;
        const sw = box.clientWidth;
        const sh = box.clientHeight;
        if (sw < 32 || sh < 32) return;
        let tw = Number(table.dataset.nw);
        let th = Number(table.dataset.nh);
        if (!tw || !th) {
            const keep = table.style.zoom;
            table.style.zoom = '1';
            tw = table.scrollWidth;
            th = table.scrollHeight;
            table.dataset.nw = String(tw);
            table.dataset.nh = String(th);
            table.style.zoom = keep || '1';
        }
        if (tw < 8 || th < 8) return;
        table.style.zoom = String((typeof empXlZoom === 'number' ? empXlZoom : 100) / 100);
        box.classList.remove('sheet-fit');
        if (!box._fitObs && typeof ResizeObserver === 'function') {
            box._fitObs = new ResizeObserver(() => fitSheet(box));
            box._fitObs.observe(box);
        }
    }
    function scheduleFitSheet(wrap) {
        requestAnimationFrame(() => requestAnimationFrame(() => fitSheet(wrap || $('emp-sheet'))));
    }
    // Expiry display: countdown text, tone, bar % of the last 72 hours.
    function expInfo(deadlineDate) {
        if (!deadlineDate) return null;
        const left = deadlineDate.getTime() - Date.now();
        let text; let tone;
        if (left <= 0) { text = `Expired ${Math.floor(-left / 3600000)}h ago`; tone = 't-bad'; }
        else {
            const tot = Math.floor(left / 1000); const d = Math.floor(tot / 86400); const r = tot % 86400;
            const p = (n) => String(n).padStart(2, '0');
            text = `${d ? d + 'd ' : ''}${p(Math.floor(r / 3600))}:${p(Math.floor((r % 3600) / 60))}:${p(r % 60)}`;
            tone = left < 86400000 ? 't-warn' : 't-ok';
        }
        return { text, tone, pct: Math.max(0, Math.min(100, (left / (72 * 3600000)) * 100)) };
    }
    const COLOR_HEX = { '040': '#f3f3f0', '218': '#1c1d20', '1G3': '#6c7076', '070': '#ece8de', '3T3': '#8b1c25', '8X8': '#2b3d66', '4V8': '#86684a', '20': '#202022', '10': '#d6c6a6', 'FB20': '#5a3a28' };
    function swatch(code) { const c = String(code || '').trim().toUpperCase(); return `<i style="background:${COLOR_HEX[c] || '#9aa0aa'}" title="${esc(c)}"></i>`; }
    function initials(name) { const w = String(name || '').trim().split(/\s+/).filter(Boolean); if (!w.length) return '–'; return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase(); }
    function timeAgo(date) { if (!date) return ''; const m = Math.round((Date.now() - date.getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' d ago'; }
    function statusPillHtml(value) {
        const s = String(value || '').trim();
        const cls = s === 'Payment' ? 'p-ok' : s === 'In progress' ? 'p-warn' : s === 'Cancelled' ? 'p-bad' : (s ? 'p-warn' : 'p-none');
        return `<span class="pill ${cls}"><span class="dot"></span>${esc(s || 'Not updated')}</span>`;
    }
    function flashRow(key) {
        const row = document.querySelector(`#emp-sheet tr[data-key="${CSS.escape(key)}"]`);
        if (!row) return;
        row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1300);
    }
    function expHtml(deadline, dateLabel, big) {
        const info = expInfo(parseLocal(deadline));
        if (!info) return '<span class="muted-text">No expiry date</span>';
        return `<div class="exp ${info.tone}${big ? ' exp-big' : ''}" data-deadline="${esc(deadline)}"><b>${esc(info.text)}</b><div class="track"><i style="width:${info.pct.toFixed(1)}%"></i></div>${dateLabel ? `<small>${dateLabel}</small>` : ''}</div>`;
    }
    function expiryCompactHtml(order, dateLabel) {
        const deadline = expiryDeadline(order);
        const end = parseLocal(deadline);
        const title = dateLabel || '';
        if (!end) return `<span class="muted-text" title="${esc(title)}">—</span>`;
        const hoursAgo = Math.floor((Date.now() - end.getTime()) / 3600000);
        let pill; let tone;
        if (hoursAgo >= 0) {
            pill = hoursAgo + 'h ago';
            tone = hoursAgo >= 100 ? 'is-old' : 'is-warn';
        } else {
            const left = Math.max(1, Math.ceil(-hoursAgo));
            pill = left + 'h left';
            tone = left < 24 ? 'is-warn' : 'is-ok';
        }
        const date = pad(end.getDate()) + '/' + pad(end.getMonth() + 1);
        return `<span class="exp-line" title="${esc(title || date)}"><span class="exp-pill ${tone}">${esc(pill)}</span><span class="exp-date">${esc(date)}</span></span>`;
    }
    function applySheetDensity(mode) {
        const next = mode === 'comfy' ? 'comfy' : 'compact';
        document.documentElement.setAttribute('data-sheet-density', next);
        try { localStorage.setItem('ro-sheet-density', next); } catch (e) { /* blocked */ }
        const btn = $('emp-xl-density');
        if (btn) btn.classList.toggle('is-on', next === 'comfy');
    }
    try { applySheetDensity(localStorage.getItem('ro-sheet-density') === 'comfy' ? 'comfy' : 'compact'); } catch (e) { applySheetDensity('compact'); }
    // KPI tiles: [label, value, dot class, sub line]. Counts up only when the numbers change.
    function paintKpis(box, tiles) {
        if (!box) return;
        const sig = JSON.stringify(tiles);
        if (box.dataset.sig === sig) return;
        box.dataset.sig = sig;
        box.innerHTML = tiles.map(([label, value, dot, sub]) => `<div class="kpi${dot ? ' k-' + dot.slice(2) : ''}"><span>${dot ? `<span class="dot ${dot}"></span>` : ''}${esc(label)}</span><b class="num" data-to="${Number(value) || 0}">0</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`).join('');
        box.querySelectorAll('[data-to]').forEach(countUp);
    }
    function paintRail() {
        slideIndicator($('rail-ind'), document.querySelector('#app .jump button.nav-on'));
        const top = $('top');
        if (top) document.documentElement.style.setProperty('--toph', top.offsetHeight + 'px');
    }
    const ICONS = {
        orders: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
        messages: '<path d="M4 5h16v11H8l-4 4z"/>',
        errors: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
        overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
        sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
        push: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
        marketing: '<path d="M3 11l15-6v14L3 13z"/><path d="M7 13v5h3"/>',
        builder: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
        link: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
        people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a5 5 0 014 6"/>',
        archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
        audit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
        sold: '<path d="M5 12l5 5 9-10"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
        close: '<path d="M6 6l12 12M18 6L6 18"/>',
        chevron: '<path d="M9 6l6 6-6 6"/>',
        lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
        bell: '<path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8M10 20h4"/>'
    };
    function icon(name, cls) { return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`; }
    function parseLocal(value) {
        const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
    function remainingMs(order) {
        const end = parseLocal(order.deadline);
        return end ? end.getTime() - Date.now() : null;
    }
    function isExpired(order) { const ms = remainingMs(order); return ms != null && ms <= 0; }
    function isCompleted(order) { return order.status === 'تم الفوترة' || order.status === 'Payment'; }
    function isCancelled(order) { return order.status === 'الغاء' || order.status === 'Cancelled'; }
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
        $('session-pill').textContent = `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
        if (left <= 0) endSession('timeout');
    }

    async function loadNames() {
        const data = await fetch('/api/reserved-orders/staff-names').then((res) => res.json()).catch(() => ({ people: [] }));
        const people = data.people || [];
        const options = [
            '<option value="" disabled selected>Select your name…</option>',
            '<option value="__admin__">Shared admin login</option>'
        ].concat(
            people.map((person) => `<option value="${esc(person.recordId)}">${esc(person.name)}${person.role === 'admin' ? ' · Admin' : ''}</option>`)
        );
        const select = $('employee-name');
        if (select) select.innerHTML = options.join('');
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
    async function loadLive(opts) {
        const first = !!(opts && opts.first);
        if (first) showDataLoad('Downloading reserved cars', 'Getting your live sheet…');
        let data;
        try {
            if (first) setDataLoad(22, 'Reading the live cars…');
            const res = await fetch('/api/reserved-orders/live');
            data = await res.json();
            if (!res.ok) throw new Error(data.error || ('Live data request failed (' + res.status + ')'));
        } catch (err) {
            console.error('Reserved Orders load failed:', err);
            orders = [];
            $('cards').innerHTML = '<div class="empty card">Reserved orders could not be loaded.</div>';
            if ($('emp-sheet')) $('emp-sheet').innerHTML = '<div class="empty">Reserved orders could not be loaded. Press Refresh to try again.</div>';
            if (first) hideDataLoad();
            return;
        }
        const next = Array.isArray(data.orders) ? data.orders : [];
        orders = next;
        try { notifyMyNewOrders(); } catch (e) { console.error('New-order alert failed:', e); }
        const stamp = $('updated-at');
        if (stamp) stamp.textContent = data.updatedAt ? `Live data ${new Date(data.updatedAt).toLocaleString()}` : 'Waiting for a live push';
        if (data.sheetLayout) sheetLayout = data.sheetLayout;
        // Fingerprint every order's status/note so peer edits appear immediately without a page refresh.
        let liveSig = 0;
        for (let i = 0; i < next.length; i += 1) {
            const o = next[i] || {};
            const chunk = `${o.key}|${o.status}|${o.statusNote || ''}|${o.statusChangedAt || ''}|${o.leaderNote || ''}`;
            for (let j = 0; j < chunk.length; j += 1) liveSig = ((liveSig << 5) - liveSig + chunk.charCodeAt(j)) | 0;
        }
        const payload = [data.updatedAt || '', next.length, liveSig, STATUSES.join('|'), JSON.stringify(sheetLayout || {})].join('|');
        if (payload === loadLive.last && document.querySelector('#cards .rc-tile, #emp-sheet table')) {
            if (first) hideDataLoad();
            return tickTimers();
        }
        loadLive.last = payload;
        if (first) setDataLoad(70, 'Building your sheet…');
        fillFilters();
        render();
        if (first) hideDataLoad();
    }
    function fillFilters() {
        const status = $('filter-status');
        const advisor = $('filter-advisor');
        const queue = $('filter-queue');
        const product = $('filter-product');
        const area = $('filter-area');
        const keep = [status.value, advisor.value, queue.value, product.value, area.value];
        status.innerHTML = '<option value="">All statuses</option>' + `<option value="${MINE}">Mine</option>` + STATUSES.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('') + `<option value="${NOT_UPDATED}">Not updated</option>`;
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
            else if (status === MINE) { if (!canUpdateOrder(order)) return false; }
            else if (status && statusKey(order.status) !== status) return false;
            if (product && row.Product !== product) return false;
            if (area && row.Area !== area) return false;
            if (advisor && row['Salesman name'] !== advisor) return false;
            if (queue && String(order.boQueuePosition) !== queue) return false;
            return true;
        });
        return sortOrders(list, sort);
    }
    function sortOrders(list, sort) {
        const queuePos = (order) => (order.queueNumber == null ? 9e9 : Number(order.queueNumber));
        const boPos = (order) => (order.boQueuePosition == null ? 9e9 : Number(order.boQueuePosition));
        const mine = new Map(list.map((order) => [order, canUpdateOrder(order)]));
        return list.sort((a, b) => {
            if (mine.get(a) !== mine.get(b)) return mine.get(a) ? -1 : 1;
            if (sort === 'queue-desc') return queuePos(b) - queuePos(a) || boPos(b) - boPos(a);
            if (sort === 'remaining') return (remainingMs(a) ?? 9e15) - (remainingMs(b) ?? 9e15);
            return queuePos(a) - queuePos(b) || boPos(a) - boPos(b);
        });
    }
    function pendingMine() {
        return sortOrders(dataOrders().filter((order) => canUpdateOrder(order) && !statusKey(order.status)), $('sort').value);
    }
    function paintNextPending() {
        const button = $('next-pending');
        if (!button) return;
        const left = pendingMine().length;
        button.hidden = left === 0;
        $('next-pending-count').textContent = left + ' left';
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
        const countOf = (key) => source.filter((order) => (key === NOT_UPDATED ? !statusKey(order.status) : key === MINE ? canUpdateOrder(order) : statusKey(order.status) === key)).length;
        $('kpis').innerHTML = '<span class="ind"></span>' + [
            ['total', 'All', source.length, ''],
            [MINE, 'Mine', countOf(MINE), 'd-you'],
            ['Payment', 'Payment', countOf('Payment'), 'd-ok'],
            ['In progress', 'In progress', countOf('In progress'), 'd-warn'],
            ['Cancelled', 'Cancelled', countOf('Cancelled'), 'd-bad'],
            [NOT_UPDATED, 'Not updated', countOf(NOT_UPDATED), 'd-none']
        ].map(([key, label, value, dot]) => `<button type="button" data-kpi="${key}" aria-pressed="${activeKey === key ? 'true' : 'false'}">${dot ? `<span class="dot ${dot}"></span>` : ''}${label}<i>${value}</i></button>`).join('');
        slideIndicator($('kpis').querySelector('.ind'), $('kpis').querySelector('[aria-pressed="true"]'));
        paintNextPending();
        paintViewMode();
        if (viewMode() === 'sheet') {
            $('cards').innerHTML = '';
            paintSheet(list);
        } else {
            $('cards').innerHTML = list.length ? list.map((order) => tileHtml(order)).join('') : '<div class="empty card">No orders match this view. Clear the search or pick another filter.</div>';
        }
        paintOrderModal();
    }
    function retailMatch(value) {
        const text = String(value || '').trim().toLowerCase();
        return text === 'rtlesal' || text.includes('retail electronic sales');
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
    function isMohammedAlFadel(name) {
        const key = personKey(name);
        return key === 'mohammed al fadel' || key === 'mohammed al fadul';
    }
    function isOrder5Editor(session) {
        if (!session) return false;
        if (session.canEditOrdersStartingWith5) return true;
        return personKey(session.name) === 'reda salah' || isMohammedAlFadel(session.name);
    }
    function isFiveOnlyEditor(session) {
        if (!session) return false;
        if (session.editFiveOnly) return true;
        return isMohammedAlFadel(session.name);
    }
    function canUpdateOrder(order) {
        const session = readSession();
        if (!session || !order) return false;
        if (isFiveOnlyEditor(session)) return orderNumberStartsWith5(order);
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
        const advisor = columnA && !/^(unassigned|salesman name)$/i.test(columnA) ? columnA : fallback;
        if (!advisor || personKey(advisor) === 'unassigned') return false;
        const names = [session.name, session.matchedSalesman].concat(Array.isArray(session.editFor) ? session.editFor : []);
        if (names.some((name) => name && samePerson(name, advisor))) return true;
        return personKey(session.employeeNumber) === personKey(advisor);
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
    function tileHtml(order) {
        const info = tileInfo(order);
        const deadline = columnDeadline(order);
        const img = carImage(info.product, order.vehicle, productName(order));
        const carName = info.product || cleanVehicleName(order.vehicle) || 'Car not named';
        const mine = canUpdateOrder(order);
        const cancelled = isCancelled(order) || statusKey(order.status) === 'Cancelled';
        return `<button type="button" class="rc-tile card${mine ? ' mine' : ''}${cancelled ? ' cancelled' : ''}" data-tile-key="${esc(order.key)}" aria-label="Open details for ${esc(carName)}">
            <span class="rc-top"><span class="q"><b>${order.boQueuePosition == null ? '—' : '#' + esc(String(order.boQueuePosition))}</b></span>${statusPillHtml(statusKey(order.status))}</span>
            <span class="rc-car">
                <span class="rc-thumb">${img ? `<img src="${img}" alt="${esc(carName)}" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.hidden=false"><span class="rc-fallback" hidden>${CAR_ICON}</span>` : `<span class="rc-fallback">${CAR_ICON}</span>`}</span>
                <span class="rc-name"><b dir="auto" title="${esc(carName)}">${esc(carName)}</b>${info.sfx ? `<small dir="auto">${esc(info.sfx)}</small>` : ''}</span>
            </span>
            <span class="person"><span class="av">${esc(info.advisor ? initials(info.advisor) : '–')}</span><span dir="auto" title="${esc(info.advisor || 'Unassigned')}">${esc(mine ? 'You' : (info.advisor || 'Unassigned'))}</span></span>
            ${expHtml(deadline, '', false)}
        </button>`;
    }
    // ---- Live sheet: everyone sees every row; only the salesman of an order can set its status (Payment /
    // In progress / Cancelled), always with a note. A click or Enter on a row opens the drawer. ----
    function viewMode() {
        try { return localStorage.getItem('ro-orders-view') === 'cards' ? 'cards' : 'sheet'; } catch (e) { return 'sheet'; }
    }
    function setViewMode(mode) {
        try { localStorage.setItem('ro-orders-view', mode); } catch (e) { /* storage blocked: only this visit */ }
        render();
    }
    function realText(value) { return isBlankValue(value) ? '' : String(value).replace(/\u00a0/g, ' ').trim(); }
    // value of an RTL Stock column of the order's VIN (L usage, K allocation age, X area)
    function rtlCol(order, letter) {
        const hit = (order.rtlFields || []).find((field) => String(field.col || '').toUpperCase() === letter);
        return hit ? realText(hit.value) : '';
    }
    function rtlByLabel(order, label) {
        const hit = (order.rtlFields || []).find((field) => String(field.label || '').replace(/\s+/g, ' ').trim().toLowerCase() === label);
        return hit ? realText(hit.value) : '';
    }
    function statusKey(value) {
        const text = String(value || '').trim().toLowerCase();
        return STATUSES.find((item) => item.toLowerCase() === text) || '';
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
            Usage: rtlCol(order, 'L'),
            'Allocation age': rtlCol(order, 'K'),
            Area: rtlCol(order, 'X') || realText(order.searchArea),
            'Share level': rtlByLabel(order, 'sharing level') || rtlCol(order, 'H') || realText(order.shareLevel)
        };
    }
    function queueHtml(order) {
        const tiers = order.boTierQueues || [];
        const first = tiers[0];
        const bars = `<div class="tiers" aria-hidden="true">${[0, 1, 2].map((i) => `<span${tiers[i] ? ' class="on"' : ''}></span>`).join('')}</div>`;
        if (!first) return `<span class="ahead-empty" title="No colour choice 1 for this order in the Toyota Back Order file">—</span>${bars}`;
        const pair = [first.exterior, first.interior].filter(Boolean).join(' / ');
        const title = tiers.map((q, i) => (q ? `Choice ${i + 1}: #${q.position} of ${q.size}${q.exterior || q.interior ? ' (' + [q.exterior, q.interior].filter(Boolean).join(' / ') + ')' : ''}` : '')).filter(Boolean).join('\n');
        return `<div class="q" title="${esc(title)}"><b>#${esc(String(first.position))}</b><small>/ ${esc(String(first.size))}</small></div>${pair ? `<div class="q-pair mono">${esc(pair)}</div>` : ''}${bars}`;
    }
    function carCellHtml(values) {
        const sub = [values['ALJ suffix'], values['Model year']].filter(Boolean).map(esc).join(' · ');
        const sw = values['Exterior color'] || values['Interior color']
            ? `<span class="sw">${values['Exterior color'] ? swatch(values['Exterior color']) : ''}${values['Interior color'] ? swatch(values['Interior color']) : ''}</span>`
            : '';
        return `<div class="car"><div><b dir="auto">${esc(values.Product || 'Car not named')}</b><small>${sub}${sw}</small></div></div>`;
    }
    function ageTag(raw) {
        const match = String(raw || '').match(/-?\d+/);
        if (!match) return raw ? `<span class="tag">${esc(raw)}</span>` : '<span class="muted-text">—</span>';
        const n = Number(match[0]);
        return `<span class="tag${n <= 5 ? ' good' : n === 6 ? ' warntag' : ' badtag'}">${n} d</span>`;
    }
    function updatedHtml(order, mine) {
        const who = order.statusNoteBy || order.statusChangedBy || '';
        const at = parseLocal(order.statusChangedAt);
        if (!statusKey(order.status) || (!who && !at)) return '<span class="muted-text">—</span>';
        const self = who && samePerson(who, (readSession() || {}).name);
        return `<div class="upd"><span>${esc(self || (mine && !who) ? 'You' : who || '—')}</span>${at ? `<small title="${esc(statusWhen(order.statusChangedAt))}">${esc(timeAgo(at))}</small>` : ''}</div>`;
    }
    function personalLayoutStorageKey() {
        const session = readSession();
        return 'ro-emp-layout-v1:' + (session && session.recordId ? session.recordId : 'anon');
    }
    function loadPersonalLayout() {
        try {
            const raw = JSON.parse(localStorage.getItem(personalLayoutStorageKey()) || 'null');
            if (raw && Array.isArray(raw.order) && raw.order.length) {
                personalLayout = {
                    order: raw.order.filter(Boolean),
                    hidden: Array.isArray(raw.hidden) ? raw.hidden.filter(Boolean) : []
                };
                return personalLayout;
            }
        } catch (e) { /* ignore */ }
        personalLayout = null;
        return null;
    }
    function savePersonalLayout(next) {
        personalLayout = {
            order: Array.isArray(next && next.order) ? next.order.filter(Boolean) : publishedSheetCols(),
            hidden: Array.isArray(next && next.hidden) ? next.hidden.filter(Boolean) : []
        };
        try { localStorage.setItem(personalLayoutStorageKey(), JSON.stringify(personalLayout)); } catch (e) { /* blocked */ }
    }
    function publishedSheetCols() {
        const mine = personalLayout || loadPersonalLayout();
        const hidden = new Set((mine && mine.hidden && mine.hidden.length ? mine.hidden : sheetLayout.hidden) || []);
        hidden.delete('Queue 1');
        hidden.delete('Queue 2');
        hidden.delete('Queue 3');
        hidden.delete('Queue position');
        hidden.delete('Leader note');
        hidden.delete('Status');
        hidden.delete('Note');
        const fallback = EMP_DEFAULT_COLS.slice();
        const personalOrder = mine && Array.isArray(mine.order) ? mine.order.filter(Boolean) : [];
        const saved = personalOrder.length >= 5
            ? personalOrder
            : (Array.isArray(sheetLayout.order) ? sheetLayout.order.filter(Boolean) : []);
        // Incomplete saved layouts (e.g. only Q1/Q2) must not hide the rest of the sheet.
        const base = saved.length >= 5 ? saved : fallback;
        const queueTail = ['Queue 1', 'Queue 2', 'Queue 3'];
        const rest = base.filter((label) => !queueTail.includes(label));
        // Keep Status / Note / Leader note visible for the employee update flow.
        ['Status', 'Note', 'Leader note'].forEach((label) => {
            if (!rest.includes(label) && !queueTail.includes(label)) rest.push(label);
        });
        const ordered = rest.concat(queueTail.filter((label) => !rest.includes(label)));
        // Keep any known columns the user hasn't listed yet (append, do not drop data columns).
        fallback.forEach((label) => {
            if (!ordered.includes(label) && !hidden.has(label)) ordered.push(label);
        });
        const cols = ordered.filter((label) => EMP_KNOWN_COLS.has(label) && !hidden.has(label) && !EMP_SKIP_COLS.has(label));
        return cols.length ? cols : fallback.filter((label) => !hidden.has(label));
    }
    function paintPickedRow() {
        const box = $('emp-sheet');
        if (!box) return;
        box.querySelectorAll('tbody tr.is-picked').forEach((tr) => tr.classList.remove('is-picked'));
        if (!pickedKey) return;
        const row = box.querySelector(`tbody tr[data-key="${CSS.escape(pickedKey)}"]`);
        if (row) row.classList.add('is-picked');
    }
    function reorderPersonalCol(fromLabel, toLabel) {
        if (!fromLabel || !toLabel || fromLabel === toLabel) return;
        const cols = publishedSheetCols().slice();
        const from = cols.indexOf(fromLabel);
        const to = cols.indexOf(toLabel);
        if (from < 0 || to < 0) return;
        cols.splice(from, 1);
        cols.splice(to, 0, fromLabel);
        const mine = personalLayout || loadPersonalLayout() || { order: cols.slice(), hidden: [] };
        savePersonalLayout({ order: cols, hidden: mine.hidden || [] });
        render();
    }
    function sheetHeadLabel(label) {
        return EMP_HEAD_SHORT[label] || (label === 'Updated by' ? 'Updated' : label);
    }
    function queueOrderAt(order, tier) {
        const list = Array.isArray(order.queueOrders) && order.queueOrders.length
            ? order.queueOrders
            : (Array.isArray(order.ahead) ? order.ahead : []);
        return list[tier - 1] || null;
    }
    // Queue 1 / 2 / 3 = first three BO order numbers for this vehicle (product + suffix + exterior + interior).
    function queueTierHtml(order, n) {
        const item = queueOrderAt(order, n);
        const orderNo = item && item.orderNumber != null ? String(item.orderNumber).trim() : '';
        if (!orderNo) {
            return `<div class="q q-box is-empty" title="No matching back order #${n} for this vehicle (product + suffix + exterior + interior)"><b class="num">—</b></div>`;
        }
        const who = item.salesAdvisor ? String(item.salesAdvisor).trim() : '';
        const size = order.boQueueSize != null ? String(order.boQueueSize) : '';
        const title = `Queue #${n} · order ${orderNo}` + (who ? ` · ${who}` : '') + (size ? ` · ${size} matched` : '') + ' (product + suffix + exterior + interior)';
        return `<div class="q q-box" title="${esc(title)}"><b class="num">${esc(orderNo)}</b></div>`;
    }
    function sheetCellHtml(order, label, values, mine) {
        const pill = statusPillHtml(statusKey(order.status));
        if (label === 'Queue') return queueHtml(order);
        if (label === 'Queue 1') return queueTierHtml(order, 1);
        if (label === 'Queue 2') return queueTierHtml(order, 2);
        if (label === 'Queue 3') return queueTierHtml(order, 3);
        if (label === 'Car') return carCellHtml(values);
        if (label === 'Product') return `<div class="car"><div><b dir="auto">${esc(values.Product || '—')}</b></div></div>`;
        if (label === 'ALJ suffix') return esc(values['ALJ suffix'] || '—');
        if (label === 'Model year') return esc(values['Model year'] || '—');
        if (label === 'Exterior color') return values['Exterior color'] ? `<span class="sw">${swatch(values['Exterior color'])}</span> ${esc(values['Exterior color'])}` : '—';
        if (label === 'Interior color') return values['Interior color'] ? `<span class="sw">${swatch(values['Interior color'])}</span> ${esc(values['Interior color'])}` : '—';
        if (label === 'Customer' || label === 'Customer name') return `<span dir="auto">${esc(values['Customer name'] || '—')}</span>`;
        if (label === 'Order · VIN') return `<b class="num">${esc(values['Order number'] || '—')}</b><br><span class="mono muted-text">${esc(values.VIN || '')}</span>`;
        if (label === 'Order number') return `<b class="num">${esc(values['Order number'] || '—')}</b>`;
        if (label === 'VIN') return `<span class="mono">${esc(values.VIN || '—')}</span>`;
        if (label === 'Salesman' || label === 'Salesman name') {
            const salesman = values['Salesman name'];
            return salesman
                ? `<span class="person"><span class="av">${esc(initials(salesman))}</span><span dir="auto">${esc(mine ? 'You' : salesman)}</span></span>`
                : '<span class="muted-text">Unassigned</span>';
        }
        if (label === 'Expiry' || label === 'Expiry date') {
            const deadline = values['Expiry date'] ? expiryDeadline(order) : '';
            return deadline ? expiryCompactHtml(order, values['Expiry date']) : '<span class="muted-text">—</span>';
        }
        if (label === 'Status') return mine ? `<span class="edit" data-open-order="1">${pill}${icon('chevron', 'chev')}</span>` : pill;
        if (label === 'Note') {
            const note = String(order.statusNote || '').trim();
            return `<div class="note${mine ? ' edit' : ''}" data-open-order="${mine ? '1' : ''}" title="${esc(note)}" dir="auto">${note ? esc(note) : (mine ? 'Click to add note' : '—')}</div>`;
        }
        if (label === 'Leader note') {
            const leader = String(order.leaderNote || '').trim();
            const who = order.leaderNoteBy || 'Admin';
            const title = leader ? (who + (order.leaderNoteDisplay ? ' · ' + order.leaderNoteDisplay : '')) : 'No leader note yet';
            return `<div class="note leader-note" title="${esc(title)}" dir="auto">${leader ? esc(leader) : '—'}</div>`;
        }
        if (label === 'Updated' || label === 'Updated by') return updatedHtml(order, mine);
        if (label === 'Usage') return values.Usage ? `<span class="tag${retailMatch(values.Usage) ? ' good' : ''}">${esc(values.Usage)}</span>` : '<span class="muted-text">—</span>';
        if (label === 'Allocation age') return ageTag(values['Allocation age']);
        if (label === 'Area') return `<span dir="auto">${esc(values.Area || '—')}</span>`;
        if (label === 'Share level') return `<span dir="auto">${esc(values['Share level'] || '—')}</span>`;
        return esc(values[label] || '—');
    }
    let empAutoWidths = {};
    function empMeasurePx(text, font) {
        if (!empMeasurePx.c) empMeasurePx.c = document.createElement('canvas').getContext('2d');
        empMeasurePx.c.font = font || '13px Inter,"IBM Plex Sans Arabic",system-ui,sans-serif';
        return Math.ceil(empMeasurePx.c.measureText(String(text || '')).width);
    }
    function empWidthBounds(label) {
        return { min: EMP_MIN_WIDTHS[label] || 40, max: EMP_MAX_WIDTHS[label] || 200 };
    }
    function empWidth(label) {
        const { min, max } = empWidthBounds(label);
        const saved = Number(empXlWidths[label]);
        if (Number.isFinite(saved) && saved >= min && saved <= max) return Math.round(saved);
        if (empAutoWidths[label]) return empAutoWidths[label];
        return Math.max(min, EMP_WIDTHS[label] || 88);
    }
    function empAutofitCols(cols, rows) {
        const out = {};
        cols.forEach((label) => {
            const { min, max } = empWidthBounds(label);
            const saved = Number(empXlWidths[label]);
            if (Number.isFinite(saved) && saved >= min && saved <= max) {
                out[label] = Math.round(saved);
                return;
            }
            let w = empMeasurePx(sheetHeadLabel(label), '600 11.5px Inter,system-ui,sans-serif') + 28;
            const font = '13px Inter,"IBM Plex Sans Arabic",system-ui,sans-serif';
            const scan = EMP_FIT_LABELS.has(label) ? rows.length : Math.min(rows.length, 80);
            for (let i = 0; i < scan; i += 1) {
                const raw = String(empCellValue(rows[i], label) || '').replace(/\s+/g, ' ').trim();
                if (!raw || raw === '—') continue;
                w = Math.max(w, empMeasurePx(raw.length > 42 ? raw.slice(0, 42) : raw, font) + 18);
                if (w >= max) { w = max; break; }
            }
            out[label] = Math.max(min, Math.min(max, w));
        });
        empAutoWidths = out;
        return out;
    }
    function empFreezeMeta(cols) {
        if (!empFreezeOn) return { cls() { return ''; }, left() { return ''; } };
        const frozen = cols.slice(0, 3);
        const lefts = {};
        let x = EMP_RN_W;
        frozen.forEach((label) => {
            lefts[label] = x;
            x += empWidth(label);
        });
        const last = frozen[frozen.length - 1] || '';
        return {
            cls(label) {
                const i = frozen.indexOf(label);
                if (i < 0) return '';
                return ` xl-fz${i + 1}${label === last ? ' xl-fz-last' : ''}`;
            },
            left(label) {
                return lefts[label] == null ? '' : `;left:${lefts[label]}px`;
            }
        };
    }
    function empColStyle(label, freeze) {
        const w = empWidth(label);
        return `width:${w}px;min-width:${w}px;max-width:${w}px${freeze ? freeze.left(label) : ''}`;
    }
    function empFreezeClass(label, cols) {
        return empFreezeMeta(cols || publishedSheetCols()).cls(label);
    }
    function sheetRowHtml(order, cols, rowNum, freeze) {
        const mine = canUpdateOrder(order);
        const values = sheetValues(order);
        const key = statusKey(order.status);
        const cancelled = key === 'Cancelled' || isCancelled(order);
        const end = parseLocal(expiryDeadline(order));
        const expired = end && end.getTime() <= Date.now();
        const none = !key || (key === 'محجوز' && !order.statusChangedAt && !order.statusChangedBy);
        const classes = [
            'rowlink',
            mine ? 'mine' : '',
            cancelled ? 'row-cancelled' : '',
            expired ? 'is-expired' : '',
            none ? 'is-none' : '',
            key === 'Payment' ? 'is-ok' : '',
            pickedKey && order.key === pickedKey ? 'is-picked' : ''
        ].filter(Boolean).join(' ');
        const pad = `<td class="xl-pad" style="width:${EMP_PAD_W}px;min-width:${EMP_PAD_W}px;max-width:${EMP_PAD_W}px"></td>`.repeat(EMP_PAD_N);
        return `<tr class="${classes}" data-key="${esc(order.key)}" tabindex="0"><th class="xl-rn" scope="row">${rowNum}</th>${cols.map((label) => {
            const html = sheetCellHtml(order, label, values, mine);
            const title = String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const isQueue = label === 'Queue 1' || label === 'Queue 2' || label === 'Queue 3';
            const cls = [freeze.cls(label).trim(), EMP_MONO.has(label) ? 'xl-mono' : '', isQueue ? 'col-q col-tier col-queue' : ''].filter(Boolean).join(' ');
            return `<td class="${esc(cls)}" style="${empColStyle(label, freeze)}" title="${esc(title)}">${html}</td>`;
        }).join('')}${pad}</tr>`;
    }
    function empXlLetter(index) {
        let n = index + 1;
        let out = '';
        while (n > 0) {
            const rem = (n - 1) % 26;
            out = String.fromCharCode(65 + rem) + out;
            n = Math.floor((n - 1) / 26);
        }
        return out;
    }
    const empXlSel = { r: 0, c: 0, r2: 0, c2: 0 };
    function empXlCellText(td) {
        if (!td) return '';
        const clone = td.cloneNode(true);
        clone.querySelectorAll('.av, .sw, .dot, .track, button, svg').forEach((el) => el.remove());
        return String(clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function empSetFormula(text) {
        const formula = $('emp-xl-formula');
        if (!formula) return;
        if ('value' in formula) formula.value = text;
        else formula.textContent = text;
    }
    function copySheetValue(text) {
        const value = String(text || '');
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).catch(() => {});
        if (ok || (navigator.clipboard && navigator.clipboard.writeText)) toast('Copied', value || 'Empty cell', 'd-ok');
        else toast('Copy blocked', 'Select the cell and press Ctrl+C.', 'd-warn');
    }
    function empCellValue(order, label) {
        const values = sheetValues(order);
        if (label === 'Queue 1' || label === 'Queue 2' || label === 'Queue 3') {
            const item = queueOrderAt(order, Number(label.slice(-1)));
            return item && item.orderNumber != null ? String(item.orderNumber).trim() : '';
        }
        if (label === 'Status') return order.status || '';
        if (label === 'Note') return order.statusNote || '';
        if (label === 'Leader note') return order.leaderNote || '';
        if (label === 'Updated' || label === 'Updated by') return order.statusChangedBy || '';
        return String(values[label] || values['Salesman name'] && (label === 'Salesman') && values['Salesman name'] || '').trim();
    }
    function copySelectedEmpCell() {
        const box = $('emp-sheet');
        const rows = empRangeTexts(box, empXlSel);
        if (!rows.length) {
            const td = document.querySelector('#emp-sheet .xl-sel');
            if (!td) return false;
            copySheetValue(empXlCellText(td));
            return true;
        }
        copySheetValue(rows.map((row) => row.join('\t')).join('\n'));
        return true;
    }
    function empRangeTexts(box, sel) {
        const body = box && box.querySelector('.xl-grid tbody');
        if (!body || !sel) return [];
        const r1 = Math.min(sel.r, sel.r2 != null ? sel.r2 : sel.r);
        const r2 = Math.max(sel.r, sel.r2 != null ? sel.r2 : sel.r);
        const c1 = Math.min(sel.c, sel.c2 != null ? sel.c2 : sel.c);
        const c2 = Math.max(sel.c, sel.c2 != null ? sel.c2 : sel.c);
        const out = [];
        for (let r = r1; r <= r2; r += 1) {
            const row = [];
            for (let c = c1; c <= c2; c += 1) {
                const td = body.rows[r] && body.rows[r].cells[c + 1];
                row.push(td ? empXlCellText(td) : '');
            }
            out.push(row);
        }
        return out;
    }
    function empPaintAgg(box, sel) {
        const agg = $('emp-xl-agg');
        if (!agg) return;
        const cells = empRangeTexts(box, sel).flat();
        const nums = cells.map((t) => {
            const n = Number(String(t || '').replace(/,/g, '').trim());
            return /^-?\d+(\.\d+)?$/.test(String(t || '').replace(/,/g, '').trim()) && Number.isFinite(n) ? n : null;
        }).filter((n) => n != null);
        const count = cells.filter((t) => String(t || '').trim()).length;
        const sum = nums.reduce((a, b) => a + b, 0);
        agg.textContent = `Count ${count} · Sum ${nums.length ? sum.toLocaleString('en-GB') : '—'} · Avg ${nums.length ? (sum / nums.length).toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '—'}`;
    }
    function empXlSelect(box, r, c, scroll, r2, c2) {
        const body = box && box.querySelector('.xl-grid tbody');
        const head = box && box.querySelector('.xl-grid thead tr');
        if (!body || !body.rows.length) return;
        const rowMax = body.rows.length - 1;
        const colMax = Math.max(0, body.rows[0].cells.length - 2);
        r = Math.max(0, Math.min(rowMax, r));
        c = Math.max(0, Math.min(colMax, c));
        const endR = r2 == null ? r : Math.max(0, Math.min(rowMax, r2));
        const endC = c2 == null ? c : Math.max(0, Math.min(colMax, c2));
        empXlSel.r = r; empXlSel.c = c; empXlSel.r2 = endR; empXlSel.c2 = endC;
        box.querySelectorAll('.xl-sel, .xl-sel-range').forEach((el) => el.classList.remove('xl-sel', 'xl-sel-range'));
        box.querySelectorAll('.xl-active').forEach((el) => el.classList.remove('xl-active'));
        const rMin = Math.min(r, endR); const rMax = Math.max(r, endR);
        const cMin = Math.min(c, endC); const cMax = Math.max(c, endC);
        for (let rr = rMin; rr <= rMax; rr += 1) {
            const tr = body.rows[rr];
            if (!tr) continue;
            if (tr.cells[0]) tr.cells[0].classList.add('xl-active');
            for (let cc = cMin; cc <= cMax; cc += 1) {
                const td = tr.cells[cc + 1];
                if (td) td.classList.add(rr === r && cc === c ? 'xl-sel' : 'xl-sel-range');
            }
        }
        if (head) for (let cc = cMin; cc <= cMax; cc += 1) if (head.cells[cc + 1]) head.cells[cc + 1].classList.add('xl-active');
        const name = $('emp-xl-name');
        const a1 = empXlLetter(cMin) + (rMin + 1);
        const a2 = empXlLetter(cMax) + (rMax + 1);
        if (name) name.textContent = (rMin === rMax && cMin === cMax) ? a1 : `${a1}:${a2}`;
        const td = body.rows[r] && body.rows[r].cells[c + 1];
        empSetFormula(empXlCellText(td));
        empPaintAgg(box, empXlSel);
        if (scroll && td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function paintSheet(list) {
        const box = $('emp-sheet');
        if (!box) return;
        const mineCount = list.filter(canUpdateOrder).length;
        const cols = publishedSheetCols();
        let rows = list.slice();
        if (empColFilter.label && empColFilter.value) {
            rows = rows.filter((order) => String(empCellValue(order, empColFilter.label) || '').trim() === empColFilter.value);
        }
        if (empSheetSort.label && cols.includes(empSheetSort.label)) {
            const dir = empSheetSort.dir === 'za' ? -1 : 1;
            rows.sort((a, b) => String(empCellValue(a, empSheetSort.label)).localeCompare(String(empCellValue(b, empSheetSort.label)), undefined, { numeric: true, sensitivity: 'base' }) * dir);
        }
        empAutofitCols(cols, rows);
        const freeze = empFreezeMeta(cols);
        let padHead = '';
        for (let i = 0; i < EMP_PAD_N; i += 1) {
            padHead += `<th class="xl-h xl-pad" data-c="${cols.length + i}" style="width:${EMP_PAD_W}px;min-width:${EMP_PAD_W}px;max-width:${EMP_PAD_W}px"><small class="xl-let">${esc(empXlLetter(cols.length + i))}</small><b></b></th>`;
        }
        const heads = `<tr class="xl-heads"><th class="xl-corner" aria-hidden="true"></th>${cols.map((label, i) => {
            const sortCls = empSheetSort.label === label ? (empSheetSort.dir === 'za' ? ' is-desc' : ' is-asc') : '';
            const qCls = (label === 'Queue 1' || label === 'Queue 2' || label === 'Queue 3') ? ' col-q col-tier' : '';
            return `<th class="xl-h${freeze.cls(label)}${sortCls}${qCls}" draggable="true" data-label="${esc(label)}" data-c="${i}" style="${empColStyle(label, freeze)}" title="${esc(sheetHeadLabel(label))} · drag to reorder (your view only)"><small class="xl-let">${esc(empXlLetter(i))}</small><b>${esc(sheetHeadLabel(label))}</b><i class="xl-caret" data-sort="${esc(label)}"></i><span class="xl-resize" data-resize="${esc(label)}"></span></th>`;
        }).join('')}${padHead}</tr>`;
        const colgroup = `<colgroup><col style="width:${EMP_RN_W}px">${cols.map((label) => `<col data-label="${esc(label)}" style="width:${empWidth(label)}px">`).join('')}${`<col class="xl-pad" style="width:${EMP_PAD_W}px">`.repeat(EMP_PAD_N)}</colgroup>`;
        box.innerHTML = rows.length
            ? `<table class="xl-grid sheet-table${empFreezeOn ? '' : ' is-unfrozen'}${empCfOn ? ' is-cf' : ''}">${colgroup}<thead>${heads}</thead><tbody>${rows.map((order, i) => sheetRowHtml(order, cols, i + 1, freeze)).join('')}</tbody></table>`
            : '<div class="empty">No orders match this view. Clear the search or pick another filter.</div>';
        const grid = box.querySelector('.xl-grid');
        if (grid) grid.style.zoom = String(empXlZoom / 100);
        empXlSelect(box, empXlSel.r, empXlSel.c, false, empXlSel.r2, empXlSel.c2);
        paintPickedRow();
        scheduleFitSheet(box);
        const stat = $('emp-xl-stat');
        if (stat) stat.textContent = `${rows.length.toLocaleString('en-GB')} rows × ${cols.length} cols · ${mineCount} yours`;
        if ($('emp-xl-freeze')) $('emp-xl-freeze').classList.toggle('is-on', empFreezeOn);
        if ($('emp-xl-cf')) $('emp-xl-cf').classList.toggle('is-on', empCfOn);
        if ($('emp-xl-zoom-val')) $('emp-xl-zoom-val').textContent = `${empXlZoom}%`;
    }
    function paintViewMode() {
        const sheet = viewMode() === 'sheet';
        const shell = $('admin-app');
        if (shell) shell.classList.toggle('hidden', !sheet);
        $('cards').classList.toggle('hidden', sheet);
        document.body.classList.toggle('cards-on', !sheet);
        const a = $('view-sheet');
        const b = $('view-cards');
        if (a) a.setAttribute('aria-pressed', sheet ? 'true' : 'false');
        if (b) b.setAttribute('aria-pressed', sheet ? 'false' : 'true');
        const seg = $('view-seg');
        if (seg) slideIndicator(seg.querySelector('.ind'), sheet ? a : b);
        if (sheet) scheduleFitSheet($('emp-sheet'));
    }
    // ---- Order drawer: pick a status, write the required note, save. Polling never repaints it while someone types. ----
    let drawerPick = '';
    let drawerDraft = '';
    let drawerDirty = false;
    const PICKS = [
        ['Payment', 'k-Payment', 'd-ok', 'Money received or contract signed'],
        ['In progress', 'k-In', 'd-warn', 'Customer is completing payment'],
        ['Cancelled', 'k-Cancelled', 'd-bad', 'Reservation will be released']
    ];
    function requestStatus(key, status) {
        if (orders.some((item) => item.key === key)) openOrderModal(key, statusKey(status));
    }
    function paintOrderModal(force) {
        const drawer = $('order-modal');
        const body = $('order-modal-body');
        if (!drawer || !body) return;
        const order = openOrderKey ? orders.find((item) => item.key === openOrderKey) : null;
        if (!order) {
            if (drawer.classList.contains('open')) closeOrderModal();
            return;
        }
        const note = $('dr-note');
        if (!force && drawer.classList.contains('open') && note && (document.activeElement === note || drawerDirty)) return;
        const scroller = body.querySelector('.dr-body');
        const scroll = scroller ? scroller.scrollTop : 0;
        body.innerHTML = detailHtml(order);
        if (drawerPick && $('dr-notebox')) {
            body.querySelectorAll('[data-pick]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.pick === drawerPick ? 'true' : 'false'));
            $('dr-pick-name').textContent = drawerPick;
            $('dr-note').value = drawerDraft;
            $('dr-notebox').classList.add('open');
        }
        const nextScroller = body.querySelector('.dr-body');
        if (nextScroller) nextScroller.scrollTop = scroll;
        requestAnimationFrame(() => requestAnimationFrame(() => body.querySelectorAll('.tierline [data-l]').forEach((el) => {
            if (el.tagName === 'EM') el.style.width = el.dataset.l + '%';
            else el.style.left = el.dataset.l + '%';
        })));
        drawer.classList.add('open');
        drawer.setAttribute('aria-hidden', 'false');
        $('order-scrim').classList.add('open');
    }
    function openOrderModal(key, pick) {
        const order = orders.find((item) => item.key === key);
        if (!order) return;
        openOrderKey = key;
        drawerPick = pick && canUpdateOrder(order) ? pick : '';
        drawerDraft = drawerPick && statusKey(order.status) === drawerPick ? String(order.statusNote || '') : '';
        drawerDirty = false;
        paintOrderModal(true);
        setTimeout(() => {
            const target = drawerPick ? $('dr-note') : document.querySelector('#order-modal .rc-close');
            if (target) target.focus({ preventScroll: true });
        }, 30);
    }
    function closeOrderModal() {
        const key = openOrderKey;
        openOrderKey = '';
        drawerPick = '';
        drawerDraft = '';
        drawerDirty = false;
        $('order-modal').classList.remove('open');
        $('order-modal').setAttribute('aria-hidden', 'true');
        $('order-scrim').classList.remove('open');
        const row = key && document.querySelector(`#emp-sheet tr[data-key="${CSS.escape(key)}"]`);
        if (row) row.focus({ preventScroll: true });
    }
    function choosePick(status) {
        const order = orders.find((item) => item.key === openOrderKey);
        if (!order || !canUpdateOrder(order)) return;
        drawerPick = status;
        document.querySelectorAll('#order-modal [data-pick]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.pick === status ? 'true' : 'false'));
        $('dr-pick-name').textContent = status;
        if (!drawerDirty) {
            drawerDraft = statusKey(order.status) === status ? String(order.statusNote || '') : '';
            $('dr-note').value = drawerDraft;
        }
        $('dr-note-err').textContent = '';
        $('dr-notebox').classList.add('open');
        setTimeout(() => $('dr-note').focus(), 60);
    }
    function cancelPick() {
        drawerPick = '';
        drawerDraft = '';
        drawerDirty = false;
        document.querySelectorAll('#order-modal [data-pick]').forEach((button) => button.setAttribute('aria-pressed', 'false'));
        $('dr-notebox').classList.remove('open');
    }
    async function saveDrawer() {
        const order = orders.find((item) => item.key === openOrderKey);
        const button = $('dr-save');
        if (!order || !button || button.disabled) return;
        if (!drawerPick) {
            if ($('dr-note-err')) $('dr-note-err').textContent = 'Choose a status first, then write the note.';
            toast('Choose a status', 'Pick Payment, In progress or Cancelled before saving.', 'd-warn');
            return;
        }
        const text = $('dr-note').value.trim();
        if (!text) {
            $('dr-note-err').textContent = 'Write a note first. It is required with every status.';
            $('dr-note').focus();
            return;
        }
        const key = openOrderKey;
        const status = drawerPick;
        const values = sheetValues(order);
        $('dr-note-err').textContent = '';
        button.disabled = true;
        const error = await changeStatus(key, status, text);
        if (error) {
            if ($('dr-note-err')) $('dr-note-err').textContent = error;
            if ($('dr-save')) $('dr-save').disabled = false;
            return;
        }
        closeOrderModal();
        flashRow(key);
        const dot = status === 'Payment' ? 'd-ok' : status === 'Cancelled' ? 'd-bad' : 'd-warn';
        toast('Saved · ' + status, [values.Product, values['Order number']].filter(Boolean).join(' ') + '. Everyone sees it in the live sheet now.', dot);
        paintNextPending();
    }
    function detailHtml(order) {
        const values = sheetValues(order);
        const mine = canUpdateOrder(order);
        const key = statusKey(order.status);
        const who = order.statusNoteBy || order.statusChangedBy || '';
        const at = parseLocal(order.statusChangedAt);
        const note = String(order.statusNote || '').trim();
        const leader = String(order.leaderNote || '').trim();
        const deadline = values['Expiry date'] ? expiryDeadline(order) : '';
        const fact = (label, value, extra) => `<div><span>${esc(label)}</span><b dir="auto"${extra === 'mono' ? ' class="mono"' : ''}>${isBlankValue(value) ? '—' : esc(value)}${extra && extra !== 'mono' ? extra : ''}</b></div>`;
        const tierLine = (i) => {
            const item = queueOrderAt(order, i + 1);
            const orderNo = item && item.orderNumber != null ? String(item.orderNumber).trim() : '';
            if (!orderNo) return `<div class="tierline"><span>Q${i + 1}</span><span class="muted-text">No match</span><b></b></div>`;
            const who = item.salesAdvisor ? String(item.salesAdvisor).trim() : '';
            const size = order.boQueueSize || 0;
            const pct = size ? Math.max(0, Math.min(100, ((i + 1) / Number(size)) * 100)) : 0;
            return `<div class="tierline" title="${esc(who || orderNo)}"><span>Q${i + 1}</span><span class="rail2"><em data-l="${pct.toFixed(1)}" style="width:0"></em><i data-l="${pct.toFixed(1)}" style="left:0"></i></span><b class="num">${esc(orderNo)}</b></div>`;
        };
        const leaderSec = `<section class="sec">
            <h3>Leader note</h3>
            ${leader
                ? `<div class="cur-note" dir="auto">${esc(leader)}<small>${esc(order.leaderNoteBy || 'Admin')}${order.leaderNoteDisplay ? ' · ' + esc(order.leaderNoteDisplay) : ''}</small></div>`
                : '<p class="hint">No leader note on this order yet. When admin writes one, it appears here and in the live sheet.</p>'}
        </section>`;
        const statusSec = `<section class="sec">
            <h3>Status</h3>
            <div class="cur-status">${statusPillHtml(key)}${key && (who || at) ? `<small>by ${esc(who || '—')}${at ? ' · ' + esc(timeAgo(at)) : ''}</small>` : ''}</div>
            ${note ? `<div class="cur-note" dir="auto">${esc(note)}${at ? `<small>${esc(statusWhen(order.statusChangedAt))}</small>` : ''}</div>` : ''}
            ${mine ? `<p class="hint">Choose a status first, then write the required note. Both appear on the live sheet for everyone.</p>
            <div class="status-picks">${PICKS.map(([name, cls, dot, hint]) => `<button type="button" class="pick ${cls}" data-pick="${esc(name)}" aria-pressed="false"><b><span class="dot ${dot}"></span>${esc(name)}</b><small>${esc(hint)}</small></button>`).join('')}</div>
            <div class="notebox" id="dr-notebox"><div><div class="inner">
                <label for="dr-note">Note for <b id="dr-pick-name"></b> (required, everyone sees it)</label>
                <textarea id="dr-note" maxlength="500" dir="auto" placeholder="Why is it Payment / In progress / Cancelled?"></textarea>
                <div class="err" id="dr-note-err"></div>
                <div class="row-end"><button type="button" class="btn" id="dr-cancel">Cancel</button><button type="button" class="btn primary" id="dr-save">Save status and note</button></div>
            </div></div></div>`
            : `<div class="lock">${icon('lock')}Only ${esc(values['Salesman name'] || 'the assigned salesman')} can update this car.</div>`}
        </section>`;
        return `<div class="dr-head">
                <div><h2 dir="auto">${esc(values.Product || 'Car not named')}${values['ALJ suffix'] ? ` <span class="sfx">${esc(values['ALJ suffix'])}</span>` : ''}</h2>
                <p dir="auto">${esc(values['Customer name'] || 'No customer name')}${values['Order number'] ? ' · order ' + esc(values['Order number']) : ''}</p></div>
                <button type="button" class="x rc-close" aria-label="Close">${icon('close')}</button>
            </div>
            <div class="dr-body">
                ${leaderSec}
                ${statusSec}
                <section class="sec"><h3>Expiry</h3>${deadline ? expHtml(deadline, `Reserved Order File column J · ${esc(values['Expiry date'])}`, true) : '<span class="muted-text">No expiry date</span>'}</section>
                <section class="sec"><h3>Back Order queue</h3>${[0, 1, 2].map(tierLine).join('')}<p class="hint">First three matching back-order numbers for the same product, suffix and colours (BO Order Lookup ranking).</p></section>
                <section class="sec"><h3>Car</h3><div class="facts">
                    ${fact('VIN', values.VIN, 'mono')}
                    ${fact('Model year', values['Model year'])}
                    ${fact('Exterior', values['Exterior color'], values['Exterior color'] ? `<span class="sw">${swatch(values['Exterior color'])}</span>` : '')}
                    ${fact('Interior', values['Interior color'], values['Interior color'] ? `<span class="sw">${swatch(values['Interior color'])}</span>` : '')}
                    ${fact('Usage', values.Usage)}
                    ${fact('Allocation age', values['Allocation age'])}
                    ${fact('Area', values.Area)}
                    ${fact('Share level', values['Share level'])}
                    ${fact('Salesman', values['Salesman name'])}
                </div></section>
            </div>`;
    }
    function tickTimers() {
        paintSession();
        document.querySelectorAll('.exp[data-deadline]').forEach((el) => {
            const info = expInfo(parseLocal(el.dataset.deadline));
            if (!info) return;
            const text = el.querySelector('b');
            if (text && text.textContent !== info.text) text.textContent = info.text;
            const bar = el.querySelector('.track i');
            if (bar) bar.style.width = info.pct.toFixed(1) + '%';
            if (!el.classList.contains(info.tone)) {
                el.classList.remove('t-ok', 't-warn', 't-bad');
                el.classList.add(info.tone);
            }
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
            box.innerHTML = '<p class="empty">No messages from admin yet.</p>';
            return;
        }
        box.innerHTML = items.map((item) => {
            const dated = hasMessageDate(item.message);
            return `<article class="msg-alert card pane">
            <div class="mdetail-head"><small class="muted-line">${esc(item.name)} · ${esc(item.product || 'All cars')} · ${esc(item.column)}</small>${item.sentAt ? '<span class="pill p-ok"><span class="dot"></span>Sent</span>' : '<span class="pill p-none"><span class="dot"></span>Not sent yet</span>'}</div>
            <p><b>${item.affectedOrderCount}</b> found under your name in the BO file. Change ${esc(item.incorrectValue || 'blank')} to ${esc(item.correctValue || '—')}.</p>
            <textarea data-admin-msg="${esc(item.ruleId)}" rows="3" dir="auto">${esc(item.message)}</textarea>
            ${dated ? `<div class="date-step"><span>Deadline</span><button type="button" class="btn sm" data-shift="-1" data-rule="${esc(item.ruleId)}">−1 day</button><button type="button" class="btn sm" data-shift="1" data-rule="${esc(item.ruleId)}">+1 day</button></div>` : ''}
            <div class="row-end">
                <button type="button" class="btn wa-btn" data-open-wa="${esc(item.ruleId)}">Send to WhatsApp</button>
                <button type="button" class="btn primary" data-confirm-sent="${esc(item.ruleId)}">${item.sentAt ? 'Sent again' : 'Mark as sent'}</button>
            </div>
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
        if (!res.ok) { toast('Not saved', 'The message could not be marked as sent. Try again.', 'd-bad'); return; }
        delete mcDrafts[ruleId + '::' + boNumber];
        toast('Marked as sent', boNumber ? 'Order ' + boNumber + '. Admin sees it as sent.' : 'Admin sees it as sent.', 'd-ok');
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
        const builder = name === 'message';
        $('overlay-message').classList.toggle('open', builder);
        $('message-scrim').classList.toggle('open', builder);
        const center = $('mc-center');
        const board = $('order-board');
        const marketing = $('marketing-board');
        const errors = $('order-errors');
        const shown = name === 'orders' ? board : name === 'marketing' ? marketing : name === 'errors' ? errors : (builder ? null : center);
        if (!builder) {
            [center, board, marketing, errors].forEach((section) => { if (section) section.classList.toggle('hidden', section !== shown); });
            document.querySelectorAll('#app .jump button').forEach((button) => button.classList.toggle('nav-on', button.dataset.view === name));
        }
        if (name === 'message') loadAlertRules().then(paintMessageAlerts);
        if (name === 'inbox') paintMyAlerts();
        if (name === 'errors') paintMyAlerts();
        if (name === 'marketing') loadMyMarketing();
        fixMarketingArabicLabels();
        paintRail();
        document.body.classList.toggle('orders-on', name === 'orders');
        document.body.classList.toggle('marketing-on', name === 'marketing');
        if (name === 'marketing') {
            // Ensure the marketing page can scroll from the top on every open.
            requestAnimationFrame(() => {
                const board = $('marketing-board');
                if (board) board.scrollTop = 0;
                try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
            });
        }
        if (shown) replayView(shown);
        if (name === 'orders') requestAnimationFrame(() => {
            slideIndicator($('kpis').querySelector('.ind'), $('kpis').querySelector('[aria-pressed="true"]'));
            paintViewMode();
            scheduleFitSheet($('emp-sheet'));
        });
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
        const open = (boAlerts || [])
            .filter((item) => (item.kind || 'error') !== 'message')
            .reduce((sum, item) => sum + (item.orders || []).filter((order) => (order.status || 'new') === 'new').length, 0);
        badge.hidden = !open;
        badge.textContent = open ? String(open) : '';
    }
    function paintOrderErrors() {
        const list = $('oe-list');
        const summary = $('oe-summary');
        if (!list) return;
        paintOrderErrorBadge();
        const items = (boAlerts || []).filter((item) => (item.kind || 'error') !== 'message');
        const totalOrders = items.reduce((sum, item) => sum + (item.orders || []).length, 0);
        const openOrders = items.reduce((sum, item) => sum + (item.orders || []).filter((order) => (order.status || 'new') !== 'completed').length, 0);
        paintKpis(summary, [['Error types', items.length, 'd-warn', 'Pushed to you'], ['Orders with errors', totalOrders, '', 'Under your name'], ['Still open', openOrders, 'd-bad', 'Not done yet']]);
        if (!items.length) {
            list.innerHTML = '<p class="empty card">No order errors were pushed to you. When admin pushes an error for one of your orders, it appears here.</p>';
            return;
        }
        list.innerHTML = items.map((item) => {
            const orders = item.orders || [];
            const allDone = orders.length > 0 && orders.every((order) => (order.status || 'new') === 'completed');
            const condition = item.conditionText || item.column || 'BO file';
            const rows = orders.map((order) => {
                const state = oeStatusLabel(order);
                const wrong = order.incorrectValue || order.currentValue || 'blank';
                return `<tr>
                    <td><b>${esc(order.boNumber || '—')}</b></td>
                    <td>${esc(order.product || item.product || '—')}</td>
                    <td>${esc(order.deadline || order.orderDate || '—')}</td>
                    <td>${esc(item.column || order.column || '—')}: <b>${esc(wrong)}</b></td>
                    <td><span class="pill ${state.cls === 'is-sent' ? 'p-ok' : state.cls ? 'p-warn' : 'p-bad'}"><span class="dot"></span>${state.label}</span></td>
                </tr>`;
            }).join('');
            return `<article class="oe-card card pane${allDone ? ' is-done' : ''}">
                <div class="mdetail-head">
                    <h2 dir="auto">${esc(item.errorLabel || item.name || 'Order error')}</h2>
                    <span class="pill ${allDone ? 'p-ok' : 'p-bad'}"><span class="dot"></span>${orders.length} order${orders.length === 1 ? '' : 's'}</span>
                </div>
                <p class="muted-line" dir="auto"><b>Condition:</b> ${esc(condition)}</p>
                <div class="fixline"><span class="muted-text">${esc(item.column || 'BO file')}</span><span class="from">${esc(item.incorrectValue || 'blank')}</span>${item.correctValue ? `${icon('chevron')}<span class="to">${esc(item.correctValue)}</span>` : ''}${item.product ? `<span class="muted-text">· ${esc(item.product)}</span>` : ''}</div>
                ${item.message && item.messageMode !== 'perOrder' ? `<div class="cur-note" dir="auto">${esc(item.message)}</div>` : ''}
                <div class="tbl-wrap"><table class="oe-table"><thead><tr><th>Order number</th><th>Car</th><th>Order date</th><th>What is wrong</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No orders listed.</td></tr>'}</tbody></table></div>
                <div class="row-end">
                    ${allDone ? '' : `<button type="button" class="btn" data-oe-viewed="${esc(item.ruleId)}">Mark as viewed</button>`}
                    <button type="button" class="btn" data-oe-open="${esc(item.ruleId)}">Open in Messages</button>
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
        box.innerHTML = `<article class="marketing-card card pane">
            <h2>Order ${esc(order.orderNumber)}</h2>
            <div class="facts marketing-fields">${fields || '<div><span>BO file</span><b>No other values on this row</b></div>'}</div>
            <div class="row-end"><button class="btn primary" id="marketing-send" type="button">Send to admin</button></div>
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
        if (box) box.innerHTML = '';
        note.classList.add('is-thanks');
        note.textContent = `Thank you. Order ${sentNumber} was sent to admin. You can enter another order number.`;
        toast('Sent to admin', 'Order ' + sentNumber + ' is now in the marketing list.', 'd-ok');
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
                const done = item.done === true;
                const stamp = cancelled
                    ? `<span class="pill p-bad"><span class="dot"></span>Cancelled${item.cancelledDisplay ? ' ' + esc(item.cancelledDisplay) : ''}</span>`
                    : done
                        ? `<span class="pill p-ok"><span class="dot"></span>Done${item.doneBy ? ' · ' + esc(item.doneBy) : ''}${item.doneDisplay ? ' · ' + esc(item.doneDisplay) : ''}</span>`
                        : '';
                return `<article class="marketing-card card pane${cancelled ? ' is-cancelled' : ''}${done ? ' is-done' : ''}">
                    <div class="mdetail-head"><h2>Order ${esc(item.orderNumber)}</h2>${stamp}</div>
                    <p class="muted-line">Sent ${esc(item.display || item.at || '—')}${item.product ? ' · ' + esc(item.product) : ''}</p>
                    <div class="facts marketing-fields">${fields || '<div><span>BO file</span><b>No other values saved for this order</b></div>'}</div>
                    ${cancelled || done ? '' : `<div class="row-end"><button class="btn" type="button" data-cancel="${esc(item.id)}" data-order="${esc(item.orderNumber)}">Cancel</button></div>`}
                </article>`;
            }).join('')
            : '<p class="empty card">You have not sent any orders yet.</p>';
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
        toast('Cancelled', 'Order ' + (orderNumber || '') + '. Admin sees it as cancelled.', 'd-bad');
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
        if (!select.value) {
            $('login-error').textContent = 'Select your name first.';
            return;
        }
        if (select.value === '__admin__') {
            sessionStorage.removeItem(sessionKey);
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
        if (data.role === 'admin') {
            sessionStorage.removeItem(sessionKey);
            sessionStorage.removeItem('reserved-orders-admin-pass');
            sessionStorage.setItem('reserved-orders-admin-token', data.token);
            sessionStorage.setItem('reserved-orders-admin-who', JSON.stringify({ name: data.name, recordId: data.recordId }));
            $('employee-id').value = '';
            location.href = 'reserved-orders-admin.html';
            return;
        }
        writeSession({
            token: data.token,
            name: data.name,
            employeeNumber: data.employeeNumber,
            recordId: data.recordId,
            role: data.role || 'employee',
            canEditOrdersStartingWith5: !!data.canEditOrdersStartingWith5,
            editFiveOnly: !!data.editFiveOnly || isMohammedAlFadel(data.name),
            matchedSalesman: (!!data.editFiveOnly || isMohammedAlFadel(data.name)) ? '' : (data.matchedSalesman || ''),
            editFor: (!!data.editFiveOnly || isMohammedAlFadel(data.name)) ? [] : (Array.isArray(data.editFor) ? data.editFor : []),
            last: Date.now()
        });
        $('employee-id').value = '';
        openApp();
        askDesktopAlertsOnce(readSession());
    });
    $('logout').addEventListener('click', () => endSession('logout'));
    ['click', 'keydown', 'input', 'change', 'scroll'].forEach((type) => window.addEventListener(type, touch, { passive: true }));
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
    $('filter-refresh').addEventListener('click', () => { loadLive.last = ''; loadLive({ first: true }); });
    $('kpis').addEventListener('click', (event) => {
        const button = event.target.closest('[data-kpi]');
        if (button) applyKpi(button.dataset.kpi);
    });
    $('cards').addEventListener('click', (event) => {
        const tile = event.target.closest('.rc-tile');
        if (tile) openOrderModal(tile.dataset.tileKey);
    });
    if ($('emp-sheet')) {
        $('emp-sheet').addEventListener('click', (event) => {
            const box = $('emp-sheet');
            const caret = event.target.closest('.xl-caret');
            if (caret) {
                const label = caret.getAttribute('data-sort');
                empSheetSort = { label, dir: empSheetSort.label === label && empSheetSort.dir === 'az' ? 'za' : 'az' };
                render();
                return;
            }
            const td = event.target.closest('.xl-grid tbody td');
            if (td) {
                const tr = td.parentElement;
                if (event.shiftKey) empXlSelect(box, empXlSel.r, empXlSel.c, false, tr.sectionRowIndex, td.cellIndex - 1);
                else empXlSelect(box, tr.sectionRowIndex, td.cellIndex - 1, false);
                const cols = publishedSheetCols();
                const label = cols[td.cellIndex - 1] || '';
                const order = orders.find((item) => item.key === tr.dataset.key);
                const openCell = label === 'Status' || label === 'Note' || event.target.closest('[data-open-order="1"]');
                if (openCell && order && canUpdateOrder(order)) {
                    pickedKey = tr.dataset.key || '';
                    paintPickedRow();
                    openOrderModal(tr.dataset.key, label === 'Status' || label === 'Note' ? statusKey(order.status) : '');
                    return;
                }
                // First click anywhere on the row selects it; second click opens the details bar.
                if (tr.dataset.key && !event.target.closest('select, textarea, input, button, a')) {
                    if (pickedKey && pickedKey === tr.dataset.key) {
                        openOrderModal(tr.dataset.key);
                    } else {
                        pickedKey = tr.dataset.key;
                        paintPickedRow();
                    }
                    box.focus({ preventScroll: true });
                }
                return;
            }
            const rn = event.target.closest('.xl-grid tbody th.xl-rn');
            if (rn) {
                const tr = rn.parentElement;
                empXlSelect(box, tr.sectionRowIndex, empXlSel.c, false);
                if (tr.dataset.key) {
                    if (pickedKey && pickedKey === tr.dataset.key) openOrderModal(tr.dataset.key);
                    else {
                        pickedKey = tr.dataset.key;
                        paintPickedRow();
                    }
                }
                return;
            }
            const col = event.target.closest('.xl-grid thead th[data-c]');
            if (col) empXlSelect(box, empXlSel.r, Number(col.dataset.c) || 0, false);
        });
        $('emp-sheet').addEventListener('dragstart', (event) => {
            const th = event.target.closest('thead th.xl-h[data-label]');
            if (!th || event.target.closest('[data-resize], .xl-caret')) return;
            event.dataTransfer.setData('text/plain', th.getAttribute('data-label') || '');
            event.dataTransfer.effectAllowed = 'move';
            th.classList.add('is-drag');
        });
        $('emp-sheet').addEventListener('dragend', (event) => {
            const th = event.target.closest('thead th.xl-h');
            if (th) th.classList.remove('is-drag');
            $('emp-sheet').querySelectorAll('thead th.is-drop').forEach((el) => el.classList.remove('is-drop'));
        });
        $('emp-sheet').addEventListener('dragover', (event) => {
            const th = event.target.closest('thead th.xl-h[data-label]');
            if (!th) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            $('emp-sheet').querySelectorAll('thead th.is-drop').forEach((el) => el.classList.remove('is-drop'));
            th.classList.add('is-drop');
        });
        $('emp-sheet').addEventListener('drop', (event) => {
            const th = event.target.closest('thead th.xl-h[data-label]');
            if (!th) return;
            event.preventDefault();
            const from = event.dataTransfer.getData('text/plain');
            const to = th.getAttribute('data-label') || '';
            th.classList.remove('is-drop');
            reorderPersonalCol(from, to);
        });
        $('emp-sheet').addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            const box = $('emp-sheet');
            const handle = event.target.closest('[data-resize]');
            if (handle) {
                event.preventDefault();
                const label = handle.getAttribute('data-resize');
                const startX = event.clientX;
                const startW = empWidth(label);
                const { min, max } = empWidthBounds(label);
                const move = (ev) => {
                    empXlWidths[label] = Math.max(min, Math.min(Math.max(max, 420), startW + (ev.clientX - startX)));
                    box.querySelectorAll(`[data-label="${CSS.escape(label)}"]`).forEach((el) => {
                        el.style.width = empXlWidths[label] + 'px';
                        el.style.minWidth = empXlWidths[label] + 'px';
                        el.style.maxWidth = empXlWidths[label] + 'px';
                    });
                };
                const up = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    try { localStorage.setItem('ro-sheet-colwidths', JSON.stringify(empXlWidths)); } catch (e) { /* blocked */ }
                    render();
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
                return;
            }
            const td = event.target.closest('.xl-grid tbody td');
            if (!td) return;
            const startR = td.parentElement.sectionRowIndex;
            const startC = td.cellIndex - 1;
            empXlSelect(box, startR, startC, false);
            const drag = (ev) => {
                const over = document.elementFromPoint(ev.clientX, ev.clientY);
                const cell = over && over.closest && over.closest('#emp-sheet .xl-grid tbody td');
                if (!cell) return;
                empXlSelect(box, startR, startC, false, cell.parentElement.sectionRowIndex, cell.cellIndex - 1);
            };
            const stop = () => { document.removeEventListener('mousemove', drag); document.removeEventListener('mouseup', stop); };
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', stop);
        });
        $('emp-sheet').addEventListener('dblclick', (event) => {
            const tr = event.target.closest('tbody tr[data-key]');
            if (tr) openOrderModal(tr.dataset.key);
        });
        $('emp-sheet').addEventListener('contextmenu', (event) => {
            const td = event.target.closest('.xl-grid tbody td');
            if (!td) return;
            event.preventDefault();
            const tr = td.parentElement;
            empXlSelect($('emp-sheet'), tr.sectionRowIndex, td.cellIndex - 1, false);
            copySelectedEmpCell();
        });
        $('emp-sheet').addEventListener('keydown', (event) => {
            const box = $('emp-sheet');
            if (event.target === box) {
                const move = {
                    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
                    Tab: [0, event.shiftKey ? -1 : 1]
                }[event.key];
                if (move) {
                    event.preventDefault();
                    if (event.shiftKey && event.key.startsWith('Arrow')) {
                        empXlSelect(box, empXlSel.r, empXlSel.c, true, (empXlSel.r2 != null ? empXlSel.r2 : empXlSel.r) + move[0], (empXlSel.c2 != null ? empXlSel.c2 : empXlSel.c) + move[1]);
                    } else empXlSelect(box, empXlSel.r + move[0], empXlSel.c + move[1], true);
                    return;
                }
            }
            if (event.key !== 'Enter') return;
            const tr = event.target.closest('tbody tr[data-key]');
            const row = tr || box.querySelector('.xl-grid tbody')?.rows[empXlSel.r];
            if (!row || !row.dataset.key) return;
            event.preventDefault();
            openOrderModal(row.dataset.key);
        });
    }
    if ($('emp-xl-copy-cell')) $('emp-xl-copy-cell').addEventListener('click', () => copySelectedEmpCell());
    function empSelectedLabel() {
        const cols = publishedSheetCols();
        return cols[empXlSel.c] || cols[0] || '';
    }
    function empPushHist() {
        empHist.splice(empHistI + 1);
        empHist.push({ sort: Object.assign({}, empSheetSort), filter: Object.assign({}, empColFilter), freeze: empFreezeOn, cf: empCfOn, widths: Object.assign({}, empXlWidths) });
        empHistI = empHist.length - 1;
    }
    function empApplyHist(state) {
        if (!state) return;
        empSheetSort = Object.assign({}, state.sort);
        empColFilter = Object.assign({}, state.filter);
        empFreezeOn = !!state.freeze;
        empCfOn = !!state.cf;
        empXlWidths = Object.assign({}, state.widths || {});
        render();
    }
    if ($('emp-xl-undo')) $('emp-xl-undo').addEventListener('click', () => { if (empHistI > 0) { empHistI -= 1; empApplyHist(empHist[empHistI]); } });
    if ($('emp-xl-redo')) $('emp-xl-redo').addEventListener('click', () => { if (empHistI < empHist.length - 1) { empHistI += 1; empApplyHist(empHist[empHistI]); } });
    if ($('emp-xl-sort-az')) $('emp-xl-sort-az').addEventListener('click', () => { empPushHist(); empSheetSort = { label: empSelectedLabel(), dir: 'az' }; render(); });
    if ($('emp-xl-sort-za')) $('emp-xl-sort-za').addEventListener('click', () => { empPushHist(); empSheetSort = { label: empSelectedLabel(), dir: 'za' }; render(); });
    function empOpenFilter(label) {
        const pop = $('emp-xl-filter-pop');
        const list = $('emp-xl-filter-list');
        if (!pop || !list) return;
        pop.dataset.label = label;
        if ($('emp-xl-filter-title')) $('emp-xl-filter-title').textContent = 'Filter · ' + sheetHeadLabel(label);
        const q = ($('emp-xl-filter-q') && $('emp-xl-filter-q').value || '').toLowerCase();
        const values = Array.from(new Set((orders || []).map((order) => String(empCellValue(order, label) || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
        list.innerHTML = values.filter((v) => !q || v.toLowerCase().includes(q)).slice(0, 80).map((v) => `<li><button type="button" data-filter-val="${esc(v)}">${esc(v)}</button></li>`).join('') || '<li class="muted">No values</li>';
        pop.classList.remove('hidden');
        const tool = $('emp-xl-filter');
        const rect = (tool || $('emp-xl-formula-bar')).getBoundingClientRect();
        pop.style.top = (rect.bottom + 6) + 'px';
        pop.style.left = Math.max(8, rect.right - 260) + 'px';
    }
    if ($('emp-xl-filter')) $('emp-xl-filter').addEventListener('click', () => empOpenFilter(empSelectedLabel()));
    if ($('emp-xl-filter-list')) $('emp-xl-filter-list').addEventListener('click', (event) => {
        const btn = event.target.closest('[data-filter-val]');
        if (!btn) return;
        empPushHist();
        empColFilter = { label: $('emp-xl-filter-pop').dataset.label, value: btn.getAttribute('data-filter-val') };
        $('emp-xl-filter-pop').classList.add('hidden');
        render();
    });
    if ($('emp-xl-filter-clear')) $('emp-xl-filter-clear').addEventListener('click', () => { empPushHist(); empColFilter = { label: '', value: '' }; $('emp-xl-filter-pop').classList.add('hidden'); render(); });
    if ($('emp-xl-filter-close')) $('emp-xl-filter-close').addEventListener('click', () => $('emp-xl-filter-pop').classList.add('hidden'));
    if ($('emp-xl-filter-q')) $('emp-xl-filter-q').addEventListener('input', () => empOpenFilter($('emp-xl-filter-pop').dataset.label));
    if ($('emp-xl-freeze')) $('emp-xl-freeze').addEventListener('click', () => { empPushHist(); empFreezeOn = !empFreezeOn; try { localStorage.setItem('ro-sheet-freeze', empFreezeOn ? '1' : '0'); } catch (e) {} render(); });
    if ($('emp-xl-cf')) $('emp-xl-cf').addEventListener('click', () => { empPushHist(); empCfOn = !empCfOn; try { localStorage.setItem('ro-sheet-cf', empCfOn ? '1' : '0'); } catch (e) {} render(); });
    if ($('emp-xl-find')) $('emp-xl-find').addEventListener('click', () => { const input = $('search'); if (input) { input.focus(); try { input.select(); } catch (e) {} } });
    if ($('emp-xl-density')) $('emp-xl-density').addEventListener('click', () => {
        applySheetDensity(document.documentElement.getAttribute('data-sheet-density') === 'comfy' ? 'compact' : 'comfy');
    });
    if ($('emp-xl-export')) $('emp-xl-export').addEventListener('click', () => {
        const table = document.querySelector('#emp-sheet .xl-grid');
        if (!table) return;
        const go = () => { window.XLSX.writeFile(window.XLSX.utils.table_to_book(table, { sheet: 'Live sheet' }), 'reserved-orders.xlsx'); toast('Exported', 'reserved-orders.xlsx', 'd-ok'); };
        if (window.XLSX) { go(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
        s.onload = go;
        s.onerror = () => toast('Export failed', 'Could not load the Excel library.', 'd-bad');
        document.head.appendChild(s);
    });
    if ($('emp-xl-zoom-out')) $('emp-xl-zoom-out').addEventListener('click', () => {
        empXlZoom = Math.max(40, empXlZoom - 10);
        try { localStorage.setItem('ro-emp-zoom', String(empXlZoom)); } catch (e) { /* blocked */ }
        const g = document.querySelector('#emp-sheet .xl-grid');
        if (g) g.style.zoom = String(empXlZoom / 100);
        if ($('emp-xl-zoom-val')) $('emp-xl-zoom-val').textContent = `${empXlZoom}%`;
    });
    if ($('emp-xl-zoom-in')) $('emp-xl-zoom-in').addEventListener('click', () => {
        empXlZoom = Math.min(200, empXlZoom + 10);
        try { localStorage.setItem('ro-emp-zoom', String(empXlZoom)); } catch (e) { /* blocked */ }
        const g = document.querySelector('#emp-sheet .xl-grid');
        if (g) g.style.zoom = String(empXlZoom / 100);
        if ($('emp-xl-zoom-val')) $('emp-xl-zoom-val').textContent = `${empXlZoom}%`;
    });
    if ($('emp-xl-formula')) {
        $('emp-xl-formula').addEventListener('focus', () => { try { $('emp-xl-formula').select(); } catch (e) { /* ignore */ } });
        $('emp-xl-formula').addEventListener('click', () => { try { $('emp-xl-formula').select(); } catch (e) { /* ignore */ } });
    }
    document.addEventListener('keydown', (event) => {
        if (!(event.ctrlKey || event.metaKey)) return;
        if (event.key.toLowerCase() !== 'c' && event.key !== 'Insert') return;
        const typing = event.target.closest('textarea, select, [contenteditable="true"], input:not(#emp-xl-formula):not([readonly])');
        if (typing) return;
        if (!document.querySelector('#emp-sheet .xl-sel')) return;
        event.preventDefault();
        copySelectedEmpCell();
    });
    if ($('next-pending')) $('next-pending').addEventListener('click', () => {
        const next = pendingMine()[0];
        if (next) openOrderModal(next.key);
    });
    if ($('view-sheet')) $('view-sheet').addEventListener('click', () => setViewMode('sheet'));
    if ($('view-cards')) $('view-cards').addEventListener('click', () => setViewMode('cards'));
    if ($('order-modal')) {
        $('order-modal').addEventListener('click', (event) => {
            if (event.target.closest('.rc-close')) { closeOrderModal(); return; }
            const pick = event.target.closest('[data-pick]');
            if (pick) { choosePick(pick.dataset.pick); return; }
            if (event.target.closest('#dr-cancel')) { cancelPick(); return; }
            if (event.target.closest('#dr-save')) saveDrawer();
        });
        $('order-modal').addEventListener('input', (event) => {
            if (event.target.id !== 'dr-note') return;
            drawerDraft = event.target.value;
            drawerDirty = true;
            if (drawerDraft.trim()) $('dr-note-err').textContent = '';
        });
        $('order-modal').addEventListener('keydown', (event) => {
            if (event.target.id === 'dr-note' && event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); saveDrawer(); }
        });
        $('order-scrim').addEventListener('click', closeOrderModal);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && openOrderKey) closeOrderModal();
        });
    }
    document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
    $('message-scrim').addEventListener('click', () => showView('inbox'));
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && $('overlay-message').classList.contains('open')) showView('inbox');
    });
    const repaintIndicators = () => {
        paintRail();
        slideIndicator($('kpis').querySelector('.ind'), $('kpis').querySelector('[aria-pressed="true"]'));
        paintViewMode();
    };
    window.addEventListener('resize', () => { repaintIndicators(); scheduleFitSheet($('emp-sheet')); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(repaintIndicators);
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
    $('msg-copy').addEventListener('click', () => {
        const text = buildMessage();
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => toast('Message copied', 'Paste it in WhatsApp or anywhere else.', 'd-ok')).catch(() => toast('Copy blocked', 'Select the message and press Ctrl+C.', 'd-warn'));
    });
    $('msg-reset').addEventListener('click', () => { ['msg-customer', 'msg-phone', 'msg-note'].forEach((id) => { $(id).value = ''; }); paintMessage(); });

    function mcRows() {
        const rows = [];
        (boAlerts || []).forEach((item) => {
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
    function mcOrderDate(order) {
        return (order && (order.deadline || order.orderDate)) || '';
    }
    function mcOrderMessage(row) {
        if (!row) return '';
        return (row.order && row.order.message) || (row.alert && row.alert.message) || '';
    }
    function mcSoon(order) {
        const match = String(mcOrderDate(order) || '').match(/(\d{1,2})[./](\d{1,2})[./](\d{4})|(\d{4})-(\d{2})-(\d{2})/);
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
            const blob = [row.order.boNumber, row.order.product, row.vin, row.alert.column, row.alert.errorLabel, row.alert.name, mcOrderMessage(row)].join(' ').toLowerCase();
            return !needle || blob.includes(needle);
        });
        const need = rows.filter((row) => mcStatus(row).cls === 'is-need' || mcStatus(row).cls === 'is-viewed').length;
        const sent = rows.filter((row) => mcStatus(row).cls === 'is-sent').length;
        const soon = rows.filter((row) => mcSoon(row.order) && mcStatus(row).cls !== 'is-sent').length;
        paintKpis(summary, [['Needs action', need, 'd-warn', 'Fix and send'], ['Sent', sent, 'd-ok', 'Messages confirmed'], ['Approaching deadlines', soon, 'd-bad', 'Within 3 days']]);
        if (!rows.length) {
            list.innerHTML = '<p class="empty">No messages for your orders yet.</p>';
            $('mc-work').innerHTML = '<p class="empty">When an alert is pushed for your name, the orders appear here.</p>';
            return;
        }
        if (!visible.some((row) => row.key === mcKey)) mcKey = (visible[0] && visible[0].key) || '';
        list.innerHTML = visible.map((row) => {
            const state = mcStatus(row);
            const pill = state.cls === 'is-sent' ? 'p-ok' : state.cls === 'is-need' ? 'p-bad' : 'p-warn';
            const error = row.alert.errorLabel || row.alert.name || row.alert.column || 'Error';
            const when = mcOrderDate(row.order);
            return `<button type="button" class="mitem" aria-current="${row.key === mcKey ? 'true' : 'false'}" data-mc="${esc(row.key)}">
                <b dir="auto">${esc(row.order.product || row.alert.product || 'Vehicle')} · ${esc(row.order.boNumber || '—')}</b>
                <small dir="auto">${esc(error)}${when ? ` · <span class="${mcSoon(row.order) && state.cls !== 'is-sent' ? 'soon' : ''}">${esc(when)}</span>` : ''}</small>
                <span class="pill ${pill}"><span class="dot"></span>${state.label}</span>
            </button>`;
        }).join('') || '<p class="empty">No orders match this search.</p>';
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
        const draft = mcDrafts[row.key] != null ? mcDrafts[row.key] : mcOrderMessage(row);
        const dated = hasMessageDate(draft);
        const when = row.order.at ? new Date(row.order.at).toLocaleString() : '';
        const pill = state.cls === 'is-sent' ? 'p-ok' : state.cls === 'is-need' ? 'p-bad' : 'p-warn';
        work.innerHTML = `<div class="mdetail-head">
                <h2 dir="auto">${esc(row.alert.errorLabel || row.alert.name || row.alert.column || 'Order error')}</h2>
                <span class="pill ${pill}"><span class="dot"></span>${state.label}</span>
            </div>
            <p class="muted-line" dir="auto">${[row.order.product, row.order.boNumber ? 'order ' + row.order.boNumber : '', row.alert.column, row.vin ? 'VIN ' + row.vin : ''].filter(Boolean).map(esc).join(' · ')}</p>
            ${row.alert.conditionText ? `<p class="muted-line" dir="auto"><b>Condition:</b> ${esc(row.alert.conditionText)}</p>` : ''}
            <div class="fixline"><span class="from">${esc(row.order.incorrectValue || row.alert.incorrectValue || 'blank')}</span>${icon('chevron')}<span class="to">${esc(row.order.correctValue || row.alert.correctValue || '—')}</span></div>
            <div class="facts">
                <div><span>BO date</span><b>${esc(mcOrderDate(row.order) || '—')}</b></div>
                <div><span>WhatsApp</span><b class="mono">${esc(phone(row.order.phone) || 'No number in column X')}</b></div>
                <div><span>Saved</span><b>${esc(when || 'Not confirmed')}</b></div>
            </div>
            <label class="field" for="mc-message"><span>Message</span></label>
            <textarea id="mc-message" data-admin-msg="${esc(row.ruleId)}" data-draft-key="${esc(row.key)}" rows="5" dir="auto">${esc(draft)}</textarea>
            ${dated ? `<div class="date-step"><span>Deadline</span><button type="button" class="btn sm" id="mc-minus">−1 day</button><button type="button" class="btn sm" id="mc-plus">+1 day</button></div>` : '<p class="muted-line">This message has no date to adjust.</p>'}
            <div class="wa"><div class="bubble" id="mc-preview" dir="auto"></div></div>
            <div class="row-end">
                <button type="button" class="btn" id="mc-copy">Copy message</button>
                <button type="button" class="btn wa-btn" id="mc-wa">Send to WhatsApp</button>
                <button type="button" class="btn primary" id="mc-sent">${state.cls === 'is-sent' ? 'Confirm sent again' : 'Mark as sent'}</button>
            </div>
            <p class="muted-line" id="mc-note">${esc(mcNotice || 'Send to WhatsApp opens the order phone from column X. Mark as sent only after you press Send there.')}</p>`;
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
            const done = () => { $('mc-note').textContent = 'Message copied.'; toast('Message copied', 'Paste it in WhatsApp or anywhere else.', 'd-ok'); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(field.value).then(done).catch(() => { field.focus(); field.select(); $('mc-note').textContent = 'Message selected. Press Ctrl+C to copy it.'; });
            } else { field.focus(); field.select(); $('mc-note').textContent = 'Message selected. Press Ctrl+C to copy it.'; }
        });
        $('mc-wa').addEventListener('click', () => {
            const digits = openWhatsApp(field.value.trim(), row.order.phone);
            mcNotice = digits
                ? `WhatsApp opened for ${digits}. Mark as sent only after you press Send there.`
                : 'This order has no number in column X. WhatsApp opened without a number.';
            toast('WhatsApp opened', digits ? 'Press Send there, then mark the message as sent.' : 'No number in column X: pick the chat yourself.', digits ? 'd-ok' : 'd-warn');
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
        const card = toast(title, body, 'd-ok');
        card.classList.add('clickable');
        card.addEventListener('click', () => { try { showView(view || 'inbox'); } catch (e) { /* view may not be ready */ } card.remove(); });
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
            box.innerHTML = '<span class="dot d-warn"></span><p><b>Turn on computer pop-up alerts.</b> You will get a pop-up on this computer when admin sends you a message or a new order is assigned to you.</p><button type="button" class="btn" data-alerts="enable">Turn on</button>';
        } else if (state === 'blocked') {
            box.innerHTML = '<span class="dot d-warn"></span><p><b>Computer pop-ups are blocked for this site.</b> Click the lock icon in the address bar, set Notifications to Allow, then reload this page.</p><button type="button" class="btn" data-alerts="dismiss">Dismiss</button>';
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
                return `<article class="emp-notif card pane${item.seen ? ' is-seen' : ''}">
                    <div class="mdetail-head"><b dir="auto">${esc(item.title || 'Notification from admin')}</b><small class="mono muted-text">${esc(at)}</small></div>
                    <p dir="auto">${esc(item.message || '')}</p>
                    ${item.seen ? '' : `<div class="row-end"><button type="button" class="btn sm" data-notif-seen="${esc(item.id)}">Mark as read</button></div>`}
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
        $('who').textContent = session.name;
        $('who-id').textContent = 'ID ' + session.employeeNumber;
        $('who-av').textContent = initials(session.name);
        showView('inbox');
        $('msg-advisor').value = session.name;
        try {
            const z = Number(localStorage.getItem('ro-emp-zoom'));
            if (z >= 40 && z <= 200) empXlZoom = z;
        } catch (e) { /* keep */ }
        loadPersonalLayout();
        loadLive({ first: true });
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
    // Keep the sheet live without a full page refresh (socket first, short poll as backup).
    setInterval(() => { if (readSession()) loadLive(); }, 3000);
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
    fixMarketingArabicLabels();
    loadNames();
    loadCars();
    if (readSession()) openApp();
})();
