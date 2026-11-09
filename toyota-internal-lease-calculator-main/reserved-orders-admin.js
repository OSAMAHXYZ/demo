(function () {
    let STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
    const passKey = 'reserved-orders-admin-pass';
    const tokenKey = 'reserved-orders-admin-token';
    const whoKey = 'reserved-orders-admin-who';
    let orders = [];
    let sold = [];
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
    function adminToken() { return sessionStorage.getItem(tokenKey) || ''; }
    function authFields() {
        const out = {};
        const pass = password();
        const token = adminToken();
        if (pass) out.password = pass;
        if (token) out.token = token;
        return out;
    }
    function withAuthUrl(url) {
        const parts = Object.keys(authFields()).map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(authFields()[key]));
        if (!parts.length) return url;
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + parts.join('&');
    }
    function clearAdminAuth() {
        sessionStorage.removeItem(passKey);
        sessionStorage.removeItem(tokenKey);
        sessionStorage.removeItem(whoKey);
    }
    function paintAdminWho() {
        let name = 'Admin';
        let role = 'Full access';
        let av = 'AD';
        try {
            const saved = JSON.parse(sessionStorage.getItem(whoKey) || 'null');
            if (saved && saved.name) {
                name = saved.name;
                role = 'Admin page';
                av = initials(name);
            }
        } catch (e) { /* keep default */ }
        if ($('admin-who-name')) $('admin-who-name').textContent = name;
        if ($('admin-who-role')) $('admin-who-role').textContent = role;
        if ($('admin-who-av')) $('admin-who-av').textContent = av;
    }
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

    /* ---------- v2 design helpers (shared with reserved-orders-page.js) ---------- */
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
        const cls = s === 'Payment' || s === 'تم الفوترة' ? 'p-ok' : s === 'Cancelled' || s === 'الغاء' ? 'p-bad' : s === 'In progress' ? 'p-warn' : (s ? 'p-warn' : 'p-none');
        const label = !s || (s === 'محجوز' && arguments[1] === 'none') ? 'Not updated' : s;
        return `<span class="pill ${cls}"><span class="dot"></span>${esc(label || 'Not updated')}</span>`;
    }
    function expHtml(deadline, dateLabel, big) {
        const info = expInfo(parseLocal(deadline));
        if (!info) return '<span class="muted-text">No expiry date</span>';
        return `<div class="exp ${info.tone}${big ? ' exp-big' : ''}" data-deadline="${esc(deadline)}"><b>${esc(info.text)}</b><div class="track"><i style="width:${info.pct.toFixed(1)}%"></i></div>${dateLabel ? `<small>${dateLabel}</small>` : ''}</div>`;
    }
    function flashRow(key) {
        const row = document.querySelector(`#live-sheet-merged tr[data-key="${CSS.escape(key)}"], #st-detail tr[data-open="${CSS.escape(key)}"]`);
        if (!row) return;
        row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1300);
    }
    function paintAdminRail() {
        const on = Array.from(document.querySelectorAll('#admin-nav button')).find((button) => button.classList.contains('active') && button.offsetParent);
        slideIndicator($('admin-rail-ind'), on);
        const top = $('admin-top');
        if (top) document.documentElement.style.setProperty('--toph', top.offsetHeight + 'px');
    }
    function closeDrawer() {
        const drawer = $('drawer');
        if (drawer) drawer.classList.remove('open', 'hidden');
        if ($('admin-scrim')) $('admin-scrim').classList.remove('open');
    }
    function showDrawer(html) {
        const drawer = $('drawer');
        drawer.classList.remove('hidden');
        drawer.innerHTML = html;
        drawer.classList.add('open');
        if ($('admin-scrim')) $('admin-scrim').classList.add('open');
        const close = $('close-drawer');
        if (close) close.addEventListener('click', closeDrawer);
        if (close) setTimeout(() => close.focus({ preventScroll: true }), 30);
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
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
    }
    function pad(n) { return String(n).padStart(2, '0'); }
    function orderDeadline(order) {
        if (order && order.deadline && parseLocal(order.deadline)) return order.deadline;
        if (order && order.expiryDate && parseLocal(order.expiryDate)) return order.expiryDate;
        const iso = String(order && order.expiryDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T23:59:59`;
        const display = String(order && order.expiryDisplay || '').trim();
        const dmy = display.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
        if (dmy) {
            const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
            return `${year}-${pad(dmy[2])}-${pad(dmy[1])}T23:59:59`;
        }
        return order && order.deadline || '';
    }
    // Deadline for the Live sheet "Expiry date" timer: only the Reserved Order File expiry (column J).
    function expiryDeadlineOf(order) {
        if (order && order.expiryDate && parseLocal(order.expiryDate)) return order.expiryDate;
        const iso = String(order && order.expiryDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T23:59:59`;
        const display = String(order && order.expiryDisplay || '').trim();
        const dmy = display.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
        if (!dmy) return '';
        const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
        return `${year}-${pad(dmy[2])}-${pad(dmy[1])}T23:59:59`;
    }
    function expiryCountdown(ms) {
        if (ms == null) return '';
        if (ms <= 0) return 'Expired';
        const total = Math.floor(ms / 1000);
        const days = Math.floor(total / 86400);
        const rest = total % 86400;
        return `${days ? days + 'd ' : ''}${pad(Math.floor(rest / 3600))}:${pad(Math.floor((rest % 3600) / 60))}:${pad(rest % 60)}`;
    }
    function expiryTone(ms) {
        if (ms == null) return '';
        if (ms <= 0) return 'is-bad';
        return ms < 86400000 ? 'is-warn' : 'is-ok';
    }
    function remainMs(order) {
        const end = parseLocal(orderDeadline(order));
        return end ? end.getTime() - Date.now() : null;
    }
    function remain(order) {
        const ms = remainMs(order);
        if (ms == null) return 'NO ASSIGN DATE';
        if (ms <= 0) return 'EXPIRED';
        const total = Math.floor(ms / 1000);
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    }
    // Green until 4h past expiry; yellow from 4–8h overdue; red after another 4h (8h+ overdue).
    function timerTone(ms) {
        if (ms == null) return '';
        if (ms > -4 * 3600000) return 'is-ok';
        if (ms > -8 * 3600000) return 'is-warn';
        return 'is-bad';
    }
    function isCancelledStatus(order) {
        const value = String(order && order.status || '').trim().toLowerCase();
        return value === 'الغاء' || value === 'cancelled';
    }
    // The three statuses employees choose, plus any status the admin adds in Settings (the old built-in list is not offered).
    const EMPLOYEE_STATUS_LIST = ['Payment', 'In progress', 'Cancelled'];
    const OLD_STATUSES = new Set(['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'db', 'ابيان', 'ان اساين']);
    function offeredStatuses() {
        const added = STATUSES.filter((item) => !OLD_STATUSES.has(String(item).trim().toLowerCase()) && !EMPLOYEE_STATUS_LIST.some((s) => s.toLowerCase() === String(item).trim().toLowerCase()));
        return EMPLOYEE_STATUS_LIST.concat(added);
    }
    function employeeStatusKey(value) {
        const text = String(value || '').trim().toLowerCase();
        return EMPLOYEE_STATUS_LIST.find((item) => item.toLowerCase() === text) || '';
    }
    function formatExpiryDate(order) {
        if (order && order.expiryDisplay && String(order.expiryDisplay).trim()) return String(order.expiryDisplay).trim();
        if (order && order.expiryDate && parseLocal(order.expiryDate)) {
            return parseLocal(order.expiryDate).toLocaleString('en-GB', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            });
        }
        const end = parseLocal(orderDeadline(order));
        if (!end) return '—';
        return end.toLocaleString('en-GB', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    }
    function statusSelectHtml(order) {
        const raw = order.status || '';
        const value = employeeStatusKey(raw) || raw;
        const list = offeredStatuses();
        const options = list.map((item) => {
            const selected = item === value ? ' selected' : '';
            return `<option value="${esc(item)}"${selected}>${esc(item)}</option>`;
        }).join('');
        // Not updated yet (or an older status that is no longer offered): show it as the current choice.
        const extra = !value
            ? '<option value="" selected disabled>Not updated</option>'
            : (!list.includes(value) ? `<option value="${esc(value)}" selected>${esc(value)}</option>` : '');
        return `<select class="admin-status-select" data-key="${esc(order.key)}" data-prev="${esc(value)}" title="Change status" aria-label="Change status">${extra}${options}</select>`;
    }
    function paymentCell(order) {
        const label = String(order.paymentLabel || '').trim();
        if (label && label.toUpperCase() !== 'UNKNOWN') return esc(label);
        const salesType = fieldOf(order, 'U') || fieldValueFromList(orderSheetFields(order, 'esales'), 'U');
        if (salesType) {
            const st = /^\d$/.test(salesType) ? '0' + salesType : salesType;
            return esc(`Type ${st}`);
        }
        return '—';
    }
    function isRealVin(order) {
        const vin = String(order && order.vin || '').trim();
        return /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(vin);
    }
    async function api(url, options) {
        const opts = options ? Object.assign({}, options) : {};
        if (opts.body && typeof opts.body === 'string') {
            try {
                const parsed = JSON.parse(opts.body);
                opts.body = JSON.stringify(Object.assign({}, authFields(), parsed));
            } catch (e) { /* leave body as-is */ }
        }
        const res = await fetch(withAuthUrl(url), opts);
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
            clearAdminAuth();
            showGate('Sign in was not accepted.');
            throw new Error('unauthorized');
        }
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    }
    function showGate(message) { $('gate').classList.remove('hidden'); $('admin-app').classList.add('hidden'); $('gate-error').textContent = message || ''; }
    function showApp() { $('gate').classList.add('hidden'); $('admin-app').classList.remove('hidden'); paintAdminWho(); requestAnimationFrame(paintAdminRail); }
    function showPanel(name) {
        document.querySelectorAll('[id^="panel-"]').forEach((panel) => panel.classList.toggle('hidden', panel.id !== 'panel-' + name));
        document.querySelectorAll('#admin-nav button').forEach((button) => button.classList.toggle('active', button.dataset.panel === name));
        requestAnimationFrame(() => requestAnimationFrame(paintAdminRail));
        replayView($('panel-' + name));
        if (!reduceMotion) window.scrollTo({ top: 0, behavior: 'smooth' });
        else window.scrollTo(0, 0);
    }

    // ---- Sales type analysis (column U) · display only ----
    // Names shown under each code. Fill these in to match your codes, e.g. '01': 'Cash'.
    const SALES_TYPE_NAMES = { '01': '', '13': '', '07': '', '08': '' };
    const SALES_TYPE_ORDER = ['01', '13', '07', '08'];
    // Sales types whose cars show the reservation expiry (the deadline the server already sends).
    const EXPIRY_TYPES = new Set(['01']);
    const SHEET_NAMES = {
        B: 'Area', C: 'Share level', F: 'Order', I: 'Model', J: 'Suffix', K: 'Model year',
        L: 'VIN', M: 'Ext', N: 'Int', R: 'Vehicle status', S: 'Customer', T: 'Salesman', U: 'Sales type'
    };
    // Reserved Order File uses a different Excel layout than E-Sales — never reuse SHEET_NAMES above.
    const RESERVED_SHEET_NAMES = {
        A: 'Area', B: 'Name', C: 'Order NO.', D: 'Model Year', E: 'Product',
        F: 'SFX', G: 'Exterior Color', H: 'Interior Color', I: 'VIN', J: 'Expiry'
    };
    const RESERVED_COL_ORDER = ['B', 'C', 'I', 'E', 'D', 'F', 'G', 'H', 'J'];
    // Live sheet columns. A-J come from the pushed Reserved Order File (A salesman, B customer, C order, D model year,
    // E product, F suffix, G exterior, H interior, I VIN, J expiry). The four RTL columns come from the pushed
    // RTL Stock row of the same VIN (M status, K allocation age, N area, H share level). Same columns as the employee page.
    const MERGED_COL_ORDER = ['Salesman name', 'Customer name', 'Order number', 'Model year', 'Product', 'ALJ suffix', 'Exterior color', 'Interior color', 'VIN', 'Expiry date', 'Usage', 'Allocation age', 'Area', 'Share level'];
    const MERGED_META_COLS = ['Queue 1', 'Queue 2', 'Queue 3', 'Status', 'Note', 'Updated by'];
    function retailOk(value) {
        const text = String(value || '').replace(/\u00a0/g, ' ').trim().toLowerCase();
        if (!text || text === '—' || text === '-') return false;
        return text === 'rtlesal' || text.includes('retail electronic sales');
    }
    function isAreaOrShareLabel(label) {
        const key = String(label || '').trim().toLowerCase();
        return key === 'area' || key === 'share level' || key === 'share' || key === 'sharing level'
            || key === 'search area' || key === 'b' || key === 'c';
    }
    let salesTypePick = null; // nothing listed until a card is clicked
    let showNoVinRows = false;
    let sheetSource = 'merged'; // E-Sales and Reserved Order File sheets are hidden; only the Merged sheet is shown
    const sheetFilter = { chip: '', salesman: '', product: '', area: '', expiry: '' };
    const SHEET_NOTES = {
        esales: 'Columns and rows from the Stock E-Sales push. BO ahead shows the first 3 orders in front in the same Back Order product / suffix / color queue.',
        reserved: 'Columns and rows from the Reserved Order File push. BO ahead uses the same Back Order queue rules as BO Order Lookup.',
        merged: 'One row per VIN of the Reserved Order File, matched with RTL Stock and ranked against the Toyota Back Order file. Click a row to change its status.'
    };
    function fieldOf(order, col) {
        const field = (order.fields || []).find((item) => item.col === col || item.label === col);
        return field && field.value != null ? String(field.value).trim() : '';
    }
    function isBlankSheetValue(value) {
        const text = String(value == null ? '' : value).trim();
        return !text || text === '—' || text === '-';
    }
    function isPlaceholderValue(value) {
        const text = String(value == null ? '' : value).trim().toLowerCase();
        return !text || text === '—' || text === '-' || text === 'unassigned' || text === 'unknown'
            || text === 'no order' || text === 'vin not found';
    }
    function fieldValueFromList(fields, letter) {
        const want = String(letter || '').toUpperCase();
        const hit = (fields || []).find((item) => String(item.col || '').toUpperCase() === want);
        if (!hit || hit.value == null) return '';
        const text = String(hit.value).trim();
        return text === '—' || text === '-' ? '' : text;
    }
    function orderInSheet(order, source) {
        if (source === 'merged') {
            return orderInSheet(order, 'esales') || orderInSheet(order, 'reserved');
        }
        if (source === 'reserved') {
            if (order.inReservedFile != null) return Boolean(order.inReservedFile);
            return Boolean(order.fromReservedFile);
        }
        if (order.inEsales != null) return Boolean(order.inEsales);
        return !order.fromReservedFile;
    }
    function orderSheetFields(order, source) {
        if (source === 'merged') return Array.isArray(order.mergedFields) ? order.mergedFields : [];
        if (source === 'reserved') {
            if (Array.isArray(order.reservedFields)) return order.reservedFields;
            if (order.fromReservedFile) return order.fields || [];
            return [];
        }
        if (Array.isArray(order.esalesFields)) return order.esalesFields;
        if (order.inEsales === false) return [];
        return order.fields || [];
    }
    function looksLikeDateText(value) {
        const text = String(value || '').trim();
        return /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text) || /^\d{4}-\d{2}-\d{2}/.test(text);
    }
    function looksLikeVinText(value) {
        return /^[A-HJ-NPR-Z0-9]{11,17}$/i.test(String(value || '').trim());
    }
    function cleanProductText(value) {
        const text = String(value == null ? '' : value).trim();
        if (!text || looksLikeVinText(text) || looksLikeDateText(text) || isPlaceholderValue(text)) return '';
        return text;
    }
    function cleanPersonText(value) {
        const text = String(value == null ? '' : value).trim();
        if (!text || isPlaceholderValue(text) || looksLikeVinText(text) || looksLikeDateText(text)) return '';
        return text;
    }
    function cleanOrderText(value) {
        const text = String(value == null ? '' : value).trim();
        if (!text || isPlaceholderValue(text)) return '';
        return text;
    }
    function firstReal() {
        for (let i = 0; i < arguments.length; i += 1) {
            const text = String(arguments[i] == null ? '' : arguments[i]).trim();
            if (text && !isPlaceholderValue(text)) return text;
        }
        return '';
    }
    function formatExpiryValue(order, reservedFields) {
        if (order && order.expiryDisplay && !isPlaceholderValue(order.expiryDisplay)) return String(order.expiryDisplay).trim();
        if (order && order.expiryDate) {
            const parsed = parseLocal(order.expiryDate);
            if (parsed) return parsed.toLocaleDateString('en-GB');
            if (!isPlaceholderValue(order.expiryDate) && !String(order.expiryDate).includes('T')) return String(order.expiryDate).trim();
        }
        const fromJ = fieldValueFromList(reservedFields, 'J');
        return looksLikeDateText(fromJ) || fromJ ? fromJ : '';
    }
    function combineOrdersByVin(a, b) {
        const aE = orderInSheet(a, 'esales');
        const bE = orderInSheet(b, 'esales');
        const aR = orderInSheet(a, 'reserved');
        const bR = orderInSheet(b, 'reserved');
        const esalesSide = aE ? a : bE ? b : null;
        const reservedSide = aR ? a : bR ? b : null;
        // Duplicate VIN: one row — all Stock E-Sales info, expiry only from Reserved File.
        if (esalesSide && reservedSide) {
            return Object.assign({}, esalesSide, {
                inEsales: true,
                inReservedFile: true,
                fromReservedFile: false,
                esalesFields: esalesSide.esalesFields || esalesSide.fields || [],
                reservedFields: reservedSide.reservedFields || reservedSide.fields || [],
                fields: esalesSide.esalesFields || esalesSide.fields || esalesSide.fields || [],
                expiryDisplay: reservedSide.expiryDisplay || esalesSide.expiryDisplay || '',
                expiryDate: reservedSide.expiryDate || esalesSide.expiryDate || '',
                ahead: (Array.isArray(esalesSide.ahead) && esalesSide.ahead.length ? esalesSide.ahead : null)
                    || (Array.isArray(reservedSide.ahead) && reservedSide.ahead.length ? reservedSide.ahead : null)
                    || esalesSide.ahead || [],
                boQueuePosition: esalesSide.boQueuePosition != null ? esalesSide.boQueuePosition : reservedSide.boQueuePosition,
                boQueueSize: esalesSide.boQueueSize != null ? esalesSide.boQueueSize : reservedSide.boQueueSize,
                boOrdersAhead: esalesSide.boOrdersAhead != null ? esalesSide.boOrdersAhead : reservedSide.boOrdersAhead,
                boTierQueues: (esalesSide.boTierQueues || []).some(Boolean) ? esalesSide.boTierQueues : reservedSide.boTierQueues
            });
        }
        const base = esalesSide || reservedSide || a;
        return Object.assign({}, base, {
            inEsales: aE || bE,
            inReservedFile: aR || bR,
            fromReservedFile: !esalesSide && Boolean((a && a.fromReservedFile) || (b && b.fromReservedFile)),
            esalesFields: (esalesSide && (esalesSide.esalesFields || esalesSide.fields)) || [],
            reservedFields: (reservedSide && (reservedSide.reservedFields || reservedSide.fields)) || [],
            vin: firstReal(a.vin, b.vin),
            expiryDisplay: (reservedSide && reservedSide.expiryDisplay) || a.expiryDisplay || b.expiryDisplay || '',
            expiryDate: (reservedSide && reservedSide.expiryDate) || a.expiryDate || b.expiryDate || ''
        });
    }
    // One value of the pushed Reserved Order File row (columns A to J), same lookup the employee page uses.
    function reservedPick(order, letter) {
        const want = String(letter || '').toUpperCase();
        const pools = [order && order.reservedFields, order && order.fields];
        for (let p = 0; p < pools.length; p += 1) {
            const fields = Array.isArray(pools[p]) ? pools[p] : [];
            const hit = fields.find((field) => String(field.col || '').trim().toUpperCase() === want);
            if (!hit || isBlankSheetValue(hit.value)) continue;
            return String(hit.value).replace(/\u00a0/g, ' ').trim();
        }
        return '';
    }
    function buildMergedOrder(order) {
        const reserved = orderSheetFields(order, 'reserved');
        const pick = (letter) => reservedPick(order, letter);
        const vinPick = pick('I');
        const eVin = fieldValueFromList(orderSheetFields(order, 'esales'), 'L');
        const vin = firstReal(
            looksLikeVinText(vinPick) ? vinPick : '',
            looksLikeVinText(order.vin) ? order.vin : '',
            looksLikeVinText(eVin) ? eVin : ''
        );
        const suffixRaw = pick('F');
        const suffix = (!looksLikeDateText(suffixRaw) && !looksLikeVinText(suffixRaw)) ? suffixRaw : '';
        let product = firstReal(cleanProductText(pick('E')), cleanProductText(order.vehicle));
        if (product && suffix && product.toLowerCase().endsWith(' ' + suffix.toLowerCase())) product = product.slice(0, product.length - suffix.length).trim();
        const values = {
            'Salesman name': firstReal(cleanPersonText(pick('A')), cleanPersonText(order.salesAdvisor)),
            'Customer name': firstReal(cleanPersonText(pick('B')), cleanPersonText(order.customerName)),
            'Order number': firstReal(cleanOrderText(pick('C')), cleanOrderText(order.orderNumber)),
            'Model year': firstReal(pick('D'), order.modelYear),
            Product: product,
            'ALJ suffix': suffix,
            'Exterior color': firstReal(pick('G'), order.exterior),
            'Interior color': firstReal(pick('H'), order.interior),
            VIN: vin,
            'Expiry date': firstReal(formatExpiryValue(order, reserved), pick('J')),
            Usage: rtlValue(order, 'L'),
            'Allocation age': rtlValue(order, 'K'),
            Area: firstReal(rtlValue(order, 'X'), order.searchArea),
            'Share level': firstReal(rtlByLabel(order, 'sharing level'), rtlValue(order, 'H'), order.shareLevel)
        };
        const mergedFields = MERGED_COL_ORDER.map((label) => ({
            label,
            col: label,
            value: values[label] == null ? '' : values[label]
        }));
        return Object.assign({}, order, {
            mergedExpiry: values['Expiry date'],
            mergedFields,
            vin: vin || order.vin
        });
    }
    function buildMergedList(list) {
        const byVin = new Map();
        (list || []).forEach((order) => {
            if (!orderInSheet(order, 'merged')) return;
            const vin = String(order.vin || fieldValueFromList(orderSheetFields(order, 'esales'), 'L')
                || fieldValueFromList(orderSheetFields(order, 'reserved'), 'I') || '').trim().toUpperCase();
            if (!looksLikeVinText(vin)) return;
            if (byVin.has(vin)) byVin.set(vin, combineOrdersByVin(byVin.get(vin), order));
            else byVin.set(vin, order);
        });
        return Array.from(byVin.values())
            .map(buildMergedOrder)
            .sort((a, b) => {
                const pa = a.boQueuePosition == null ? 9e9 : Number(a.boQueuePosition);
                const pb = b.boQueuePosition == null ? 9e9 : Number(b.boQueuePosition);
                return pa - pb || (a.queueNumber || 0) - (b.queueNumber || 0);
            });
    }
    function salesTypeOf(order) {
        const raw = fieldOf(order, 'U') || fieldValueFromList(orderSheetFields(order, 'esales'), 'U');
        if (!raw) return '';
        const text = String(raw).trim();
        if (/^\d$/.test(text)) return '0' + text;
        if (/^\d+\.0+$/.test(text)) return String(parseInt(text, 10)).padStart(2, '0');
        return text;
    }
    function hasVin(order) {
        const vin = String(order.vin || fieldOf(order, 'L') || fieldValueFromList(orderSheetFields(order, 'esales'), 'L') || '').trim();
        return /^[A-Z0-9]{10,20}$/i.test(vin);
    }
    function carRows() { return orders.filter(hasVin); }
    function expiryText(order) {
        return formatExpiryDate(order);
    }
    function expiryCells(order) {
        if (!EXPIRY_TYPES.has(salesTypeOf(order))) return '<td class="st-na">—</td><td class="st-na">—</td>';
        const deadline = orderDeadline(order);
        const ms = remainMs(order);
        return `<td>${esc(expiryText(order))}</td><td class="timer-cell st-timer ${timerTone(ms)}" data-deadline="${esc(deadline || '')}">${esc(remain(order))}</td>`;
    }
    // ---- Overview: the three statuses employees choose (plus "Not updated"), from the same rows as the Live sheet ----
    function isNotUpdated(order) {
        const raw = String(order && order.status || '').trim();
        if (!raw) return true;
        return (raw === 'محجوز' || raw.toLowerCase() === 'reserved') && !String(order.statusChangedAt || '').trim() && !String(order.statusChangedBy || '').trim();
    }
    function statusBucket(order) {
        if (isNotUpdated(order)) return 'none';
        return employeeStatusKey(order.status) || (String(order.status || '').trim() ? 'other' : 'none');
    }
    function renderSalesTypes() {
        const cardsBox = $('st-cards');
        if (!cardsBox) return;
        const rows = buildMergedList(orders);
        const counts = { 'Payment': 0, 'In progress': 0, 'Cancelled': 0, none: 0, other: 0 };
        rows.forEach((order) => { counts[statusBucket(order)] += 1; });
        const total = rows.length;
        $('st-meta').textContent = `${total} car${total === 1 ? '' : 's'} in the Live sheet (one per VIN of the Reserved Order File)`;
        const chip = (key, label, value, dot) => `<button type="button" data-st="${esc(key)}" aria-pressed="${salesTypePick === key ? 'true' : 'false'}">${dot ? `<span class="dot ${dot}"></span>` : ''}${esc(label)}<i>${value}</i></button>`;
        cardsBox.classList.add('chips');
        cardsBox.innerHTML = '<span class="ind"></span>'
            + chip('', 'All', total, '')
            + chip('Payment', 'Payment', counts.Payment, 'd-ok')
            + chip('In progress', 'In progress', counts['In progress'], 'd-warn')
            + chip('Cancelled', 'Cancelled', counts.Cancelled, 'd-bad')
            + chip('none', 'Not updated', counts.none, 'd-none')
            + (counts.other ? chip('other', 'Other', counts.other, 'd-you') : '');
        const stack = $('st-stack');
        if (stack && total) {
            stack.innerHTML = `<i class="s-ok" data-w="${Math.round(counts.Payment / total * 100)}"></i><i class="s-warn" data-w="${Math.round(counts['In progress'] / total * 100)}"></i><i class="s-bad" data-w="${Math.round(counts.Cancelled / total * 100)}"></i><i class="s-none" data-w="${Math.round(counts.none / total * 100)}"></i>`;
            growBars(stack);
        }
        slideIndicator(cardsBox.querySelector('.ind'), cardsBox.querySelector('[aria-pressed="true"]'));
        const soon = $('st-expiring');
        if (soon) {
            const cutoff = Date.now() + 86400000;
            const list = rows.filter((order) => isNotUpdated(order)).map((order) => {
                const deadline = expiryDeadlineOf(order);
                const end = parseLocal(deadline);
                return { order, end, deadline };
            }).filter((item) => item.end && item.end.getTime() <= cutoff).sort((a, b) => a.end - b.end);
            soon.innerHTML = list.length
                ? list.map((item) => {
                    const name = sheetValue(item.order, 'Product', 'merged') || item.order.vehicle || 'Car';
                    const who = sheetValue(item.order, 'Salesman name', 'merged') || item.order.salesAdvisor || '—';
                    const num = sheetValue(item.order, 'Order number', 'merged') || item.order.orderNumber || '';
                    return `<button type="button" class="salesman" data-open="${esc(item.order.key)}"><span class="person"><span class="av">${esc(initials(who))}</span><span dir="auto">${esc(name)} · ${esc(who)}${num ? ' · ' + esc(num) : ''}</span></span>${expHtml(item.deadline, '', false)}</button>`;
                }).join('')
                : '<p class="muted">None in the next 24 hours.</p>';
        }
        renderSalesTypeDetail();
    }
    function renderSalesTypeDetail() {
        const box = $('st-detail');
        if (!box) return;
        if (salesTypePick == null) { box.innerHTML = ''; return; }
        const list = buildMergedList(orders).filter((order) => !salesTypePick || statusBucket(order) === salesTypePick);
        const title = salesTypePick === '' ? 'All cars' : salesTypePick === 'none' ? 'Cars with no status yet' : salesTypePick === 'other' ? 'Cars with a status added by admin' : `Status: ${salesTypePick}`;
        const cell = (order, label) => esc(sheetValue(order, label, 'merged') || '—');
        box.innerHTML = `<div class="st-detail-head"><h3>${esc(title)}</h3><span>${list.length} car${list.length === 1 ? '' : 's'}</span></div>
            <div class="st-table"><table><thead><tr><th>Queue position</th><th>Status</th><th>Note</th><th>Salesman name</th><th>Customer name</th><th>Order number</th><th>Product</th><th>VIN</th><th>Expiry date</th></tr></thead><tbody>${
            list.map((order) => `<tr data-open="${esc(order.key)}" class="st-row${isCancelledStatus(order) ? ' row-cancelled' : ''}">
                <td>${order.boQueuePosition == null ? '—' : `<span class="q-pill">#${esc(String(order.boQueuePosition))}</span>`}</td>
                <td>${statusPill(order.status)}</td>
                <td dir="auto">${cell(order, 'Note')}</td>
                <td>${cell(order, 'Salesman name')}</td>
                <td>${cell(order, 'Customer name')}</td>
                <td>${cell(order, 'Order number')}</td>
                <td>${cell(order, 'Product')}</td>
                <td class="mono">${cell(order, 'VIN')}</td>
                <td>${cell(order, 'Expiry date')}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="st-na">No cars</td></tr>'
            }</tbody></table></div>`;
    }
    function statusPill(status) {
        const value = employeeStatusKey(status) || String(status || '').trim();
        if (!value || value === 'محجوز') return statusPillHtml('', 'none');
        return statusPillHtml(value);
    }

    function renderOverview() {
        const rows = buildMergedList(orders);
        const count = (key) => rows.filter((order) => statusBucket(order) === key).length;
        const activeStaff = staff.filter((person) => person.active).length;
        const today = audit.filter((event) => String(event.at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
        const none = count('none');
        const expiredNone = rows.filter((order) => isNotUpdated(order) && remain(order) === 'EXPIRED').length;
        const total = rows.length || 1;
        const tiles = [
            ['Reserved cars', rows.length, '', 'From the latest push'],
            ['Payment', count('Payment'), 'd-ok', Math.round(count('Payment') / total * 100) + '% of cars'],
            ['In progress', count('In progress'), 'd-warn', 'Customer paying'],
            ['Cancelled', count('Cancelled'), 'd-bad', 'To release'],
            ['Not updated', none, 'd-none', expiredNone + ' expired']
        ];
        $('admin-kpis').innerHTML = tiles.map(([label, value, dot, sub]) =>
            `<article class="kpi${dot ? ' k-' + dot.slice(2) : ''}"><span>${dot ? `<span class="dot ${dot}"></span>` : ''}${esc(label)}</span><b class="num" data-to="${value}">0</b><small>${esc(sub)}</small></article>`
        ).join('');
        $('admin-kpis').querySelectorAll('[data-to]').forEach(countUp);
        const meta = $('ov-head-meta');
        if (meta) meta.textContent = `${activeStaff} active employees · ${today} changes today`;
        const alert = $('ov-alert');
        if (alert) {
            alert.innerHTML = none
                ? `<div class="alertline"><span class="dot d-warn"></span><p><b>${none} cars have no status yet</b>, ${expiredNone} of them already past expiry.</p><button class="btn" type="button" data-notify-pending>Notify salesmen</button></div>`
                : '';
        }
        const bySales = new Map();
        rows.forEach((order) => {
            const name = sheetValue(order, 'Salesman name', 'merged') || 'No salesman';
            const entry = bySales.get(name) || { total: 0, done: 0 };
            entry.total += 1;
            if (statusBucket(order) !== 'none') entry.done += 1;
            bySales.set(name, entry);
        });
        const list = Array.from(bySales.entries()).sort((a, b) => (a[1].done / a[1].total) - (b[1].done / b[1].total) || b[1].total - a[1].total);
        $('pay-bars').innerHTML = list.map(([name, entry]) => {
            const pct = entry.total ? Math.round(entry.done / entry.total * 100) : 0;
            return `<div class="salesman"><span class="person"><span class="av">${esc(initials(name))}</span>${esc(name)}</span><span class="meter"><i class="${pct === 100 ? 'full' : ''}" data-w="${pct}"></i></span><b>${entry.done}/${entry.total}</b></div>`;
        }).join('') || '<div class="salesman"><span>No cars</span><span class="meter"><i data-w="0"></i></span><b>0</b></div>';
        growBars($('pay-bars'));
        renderSalesTypes();
    }
    function renderOrders() {
        const q = $('admin-search').value.trim().toLowerCase();
        const status = $('admin-status').value;
        const payment = $('admin-payment').value;
        const expiredOnly = $('admin-expired').value === 'expired';
        const rows = orders.filter((order) => {
            if (!isRealVin(order)) return false;
            if (q && ![order.vin, order.orderNumber, order.salesAdvisor, order.customerName].join(' ').toLowerCase().includes(q)) return false;
            if (status && order.status !== status) return false;
            if (payment && order.paymentKind !== payment) return false;
            if (expiredOnly && remain(order) !== 'EXPIRED') return false;
            return true;
        }).sort((a, b) => (a.queueNumber || 0) - (b.queueNumber || 0));
        $('admin-rows').innerHTML = rows.map((order) => {
            const deadline = orderDeadline(order);
            const ms = remainMs(order);
            return `<tr class="${isCancelledStatus(order) ? 'row-cancelled' : ''}">
            <td>#${order.queueNumber == null ? '—' : order.queueNumber}</td>
            <td>${esc(order.orderNumber || 'NO ORDER')}</td>
            <td>${esc(order.vin || 'VIN NOT FOUND')}</td>
            <td>${esc(order.salesAdvisor || 'UNASSIGNED')}</td>
            <td>${paymentCell(order)}</td>
            <td class="col-status">${statusSelectHtml(order)}</td>
            <td class="col-expiry">${esc(formatExpiryDate(order))}</td>
            <td class="timer-cell ${timerTone(ms)}" data-deadline="${esc(deadline)}">${esc(remain(order))}</td>
            <td>${order.statusChangedBy ? `<div><b>${esc(order.statusChangedBy)}</b><br><small class="saudi-time">${esc(order.statusChangedDisplay || order.statusChangedAt || '')}</small></div>` : ''}${order.leaderNote ? '<span class="s-pill is-info" title="Has leader note">Note</span> ' : ''}<button class="ghost" type="button" data-open="${esc(order.key)}">View</button></td>
        </tr>`;
        }).join('');
    }
    function openOrder(key) {
        const order = orders.find((item) => item.key === key);
        if (!order) return;
        const history = (order.history || []).slice().reverse().map((item) => `<div class="status-history-row">
            <b>${esc(item.changedBy || '—')}${item.employeeNumber ? ' · ' + esc(item.employeeNumber) : ''}</b>
            <span class="saudi-time">${esc(item.changedDisplay || item.changedAt || '—')}</span>
            <div>${esc(item.oldStatus || '—')} → <strong>${esc(item.status || '—')}</strong></div>
        </div>`).join('') || '<div>No status changes yet</div>';
        const related = audit.filter((event) => event.vin === order.vin || event.orderNumber === order.orderNumber).slice(0, 30);
        const lastBy = order.statusChangedBy
            ? `${order.statusChangedBy}${order.statusChangedEmployeeNumber ? ' · ' + order.statusChangedEmployeeNumber : ''}`
            : '';
        const lastAt = order.statusChangedDisplay
            || (parseLocal(order.statusChangedAt)
                ? parseLocal(order.statusChangedAt).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' (Saudi)'
                : (order.statusChangedAt || ''));
        const product = sheetValue(order, 'Product', 'merged') || order.vehicle || 'Car not named';
        const suffix = sheetValue(order, 'ALJ suffix', 'merged') || '';
        const customer = sheetValue(order, 'Customer name', 'merged') || order.customerName || 'No customer name';
        const orderNo = sheetValue(order, 'Order number', 'merged') || order.orderNumber || '';
        const deadline = expiryDeadlineOf(order);
        const current = employeeStatusKey(order.status) || (isNotUpdated(order) ? '' : String(order.status || '').trim());
        const picks = offeredStatuses().map((name) => {
            const cls = name === 'Payment' ? 'k-Payment' : name === 'Cancelled' ? 'k-Cancelled' : 'k-In';
            const dot = name === 'Payment' ? 'd-ok' : name === 'Cancelled' ? 'd-bad' : 'd-warn';
            return `<button type="button" class="pick ${cls}" data-admin-pick="${esc(name)}" data-key="${esc(order.key)}" aria-pressed="${name === current ? 'true' : 'false'}"><b><span class="dot ${dot}"></span>${esc(name)}</b></button>`;
        }).join('');
        const tierLine = (i) => {
            const q = (order.boTierQueues || [])[i];
            if (!q) return `<div class="tierline"><span>Choice ${i + 1}</span><span class="muted-text">No colour choice</span><b></b></div>`;
            const pct = q.size ? Math.max(0, Math.min(100, (Number(q.position) / Number(q.size)) * 100)) : 0;
            return `<div class="tierline"><span>Choice ${i + 1}</span><span class="rail2"><em data-l="${pct.toFixed(1)}" style="width:0"></em><i data-l="${pct.toFixed(1)}" style="left:0"></i></span><b>#${esc(String(q.position))} / ${esc(String(q.size))}</b></div>`;
        };
        const fact = (label, value, extra) => `<div><span>${esc(label)}</span><b dir="auto"${extra === 'mono' ? ' class="mono"' : ''}>${value ? esc(value) : '—'}${extra && extra !== 'mono' ? extra : ''}</b></div>`;
        showDrawer(`<div class="dr-head"><div><h2 dir="auto">${esc(product)}${suffix ? ` <span class="sfx">${esc(suffix)}</span>` : ''}</h2><p dir="auto">${esc(customer)}${orderNo ? ' · order ' + esc(orderNo) : ''}</p></div><button class="x" id="close-drawer" type="button" aria-label="Close">${icon('close')}</button></div>
            <div class="dr-body">
                <section class="sec"><h3>Status</h3>
                    <div class="cur-status">${statusPill(order.status)}${lastBy || lastAt ? `<small>by ${esc(lastBy || '—')}${lastAt ? ' · ' + esc(lastAt) : ''}</small>` : ''}</div>
                    ${order.statusNote ? `<div class="cur-note" dir="auto">${esc(order.statusNote)}<small>Note from the salesman</small></div>` : ''}
                    <div class="status-picks">${picks}</div>
                </section>
                <section class="sec"><h3>Leader note</h3>
                    <textarea id="leader-note-input" rows="3" maxlength="2000" placeholder="Write a leader note for this order">${esc(order.leaderNote || '')}</textarea>
                    <div class="row-end">
                        <button class="btn" type="button" id="leader-note-clear">Clear</button>
                        <button class="btn primary" type="button" id="leader-note-save">Save leader note</button>
                    </div>
                    <span class="muted" id="leader-note-feedback"></span>
                </section>
                <section class="sec"><h3>Expiry</h3>${deadline ? expHtml(deadline, 'Reserved Order File column J · ' + esc(formatExpiryDate(order)), true) : '<span class="muted-text">No expiry date</span>'}</section>
                <section class="sec"><h3>Back Order queue</h3>${[0, 1, 2].map(tierLine).join('')}<p class="hint">Position among orders for the same product, suffix and colours. Lower is sooner.</p></section>
                <section class="sec"><h3>Car</h3><div class="facts">
                    ${fact('VIN', sheetValue(order, 'VIN', 'merged') || order.vin, 'mono')}
                    ${fact('Model year', sheetValue(order, 'Model year', 'merged') || order.modelYear)}
                    ${fact('Exterior', sheetValue(order, 'Exterior color', 'merged'), sheetValue(order, 'Exterior color', 'merged') ? `<span class="sw">${swatch(sheetValue(order, 'Exterior color', 'merged'))}</span>` : '')}
                    ${fact('Interior', sheetValue(order, 'Interior color', 'merged'), sheetValue(order, 'Interior color', 'merged') ? `<span class="sw">${swatch(sheetValue(order, 'Interior color', 'merged'))}</span>` : '')}
                    ${fact('Usage', sheetValue(order, 'Usage', 'merged'))}
                    ${fact('Allocation age', sheetValue(order, 'Allocation age', 'merged'))}
                    ${fact('Area', sheetValue(order, 'Area', 'merged'))}
                    ${fact('Share level', sheetValue(order, 'Share level', 'merged'))}
                    ${fact('Salesman', sheetValue(order, 'Salesman name', 'merged') || order.salesAdvisor)}
                </div></section>
                <section class="sec"><h3>Status history (Saudi time)</h3>${history}</section>
                <section class="sec"><h3>Audit</h3>${related.map((event) => `<div class="status-history-row"><b>${esc(event.user)}</b><span class="saudi-time">${esc(event.display || event.at)}</span><div>${esc(event.action)}</div></div>`).join('') || '<div>No audit events</div>'}</section>
            </div>`);
        requestAnimationFrame(() => requestAnimationFrame(() => $('drawer').querySelectorAll('.tierline [data-l]').forEach((el) => {
            if (el.tagName === 'EM') el.style.width = el.dataset.l + '%';
            else el.style.left = el.dataset.l + '%';
        })));
        $('drawer').querySelectorAll('[data-admin-pick]').forEach((button) => {
            button.addEventListener('click', () => adminSetStatus(button.dataset.key, button.dataset.adminPick));
        });
        const saveLeader = async (text) => {
            const feedback = $('leader-note-feedback');
            if (feedback) feedback.textContent = 'Saving…';
            try {
                const data = await api('/api/reserved-orders/admin/leader-note', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: password(), key: order.key, note: text })
                });
                const next = data.order || {};
                order.leaderNote = next.leaderNote || '';
                order.leaderNoteBy = next.leaderNoteBy || '';
                order.leaderNoteAt = next.leaderNoteAt || '';
                order.leaderNoteDisplay = next.leaderNoteDisplay || '';
                if (feedback) feedback.textContent = text ? 'Saved.' : 'Cleared.';
            } catch (e) {
                if (feedback) feedback.textContent = e.message || 'Could not save.';
            }
        };
        if ($('leader-note-save')) {
            $('leader-note-save').addEventListener('click', () => saveLeader(($('leader-note-input') || {}).value || ''));
        }
        if ($('leader-note-clear')) {
            $('leader-note-clear').addEventListener('click', () => {
                if ($('leader-note-input')) $('leader-note-input').value = '';
                saveLeader('');
            });
        }
    }
    function clearStaffForm() {
        editing = '';
        if ($('staff-name')) $('staff-name').value = '';
        if ($('staff-id')) $('staff-id').value = '';
        if ($('staff-role')) $('staff-role').value = 'employee';
        if ($('staff-active')) $('staff-active').checked = true;
        if ($('staff-form-title')) $('staff-form-title').textContent = 'Add person';
        if ($('save-staff')) $('save-staff').textContent = 'Save person';
        if ($('staff-error')) $('staff-error').textContent = '';
    }
    function renderStaff() {
        const list = $('staff-list');
        if (!list) return;
        const rows = staff.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        list.innerHTML = '<h2>People</h2>' + (rows.length
            ? rows.map((person) => {
                const admin = person.role === 'admin';
                return `<div class="staff-row">
                    <div>
                        <b dir="auto">${esc(person.name)}</b>
                        <small>ID ${esc(person.id || '—')}</small>
                        <div class="staff-meta">
                            <span class="pill ${admin ? 'p-info' : 'p-none'}"><span class="dot"></span>${admin ? 'Admin page' : 'Employee page'}</span>
                            <span class="tag${person.active !== false ? ' good' : ''}">${person.active !== false ? 'Active' : 'Inactive'}</span>
                        </div>
                    </div>
                    <button class="btn sm" type="button" data-edit="${esc(person.recordId)}">Edit</button>
                </div>`;
            }).join('')
            : '<p class="empty">No people yet. Add the first person on the left.</p>');
    }
    function renderArchive() {
        $('archive-rows').innerHTML = archive.slice().reverse().map((item) => `<tr>
            <td>${esc(item.version)}</td><td>${esc(item.display || item.at)}</td><td>${esc(item.uploadedBy)}</td>
            <td>${esc(item.esalesName)}</td><td>${esc(item.boName)}</td><td>${item.reservedOrders || 0}</td>
            <td>${item.matched || 0}</td><td>${item.unmatched || 0}</td>
            <td><button class="ghost" type="button" data-version="${esc(item.version)}">View</button></td>
        </tr>`).join('');
    }
    function auditSourceLabel(source) {
        const key = String(source || '').trim().toLowerCase();
        if (key === 'report-sheet-admin' || key === 'report-sheet') return 'Report Sheet admin';
        if (key === 'reserved-admin' || key === 'reserved-orders-admin') return 'Reserved Orders admin';
        if (key === 'admin-push') return 'Admin push';
        if (!key) return '—';
        return String(source);
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
            <td>${esc(event.display || event.at)}</td>
            <td>${esc(event.user)}<br>${esc(event.employeeNumber || '')}</td>
            <td>${esc(event.role || '')}</td>
            <td>${esc(event.action || '')}</td>
            <td class="col-audit-source">${esc(auditSourceLabel(event.source))}</td>
            <td>${esc(event.vin || '')}</td>
            <td>${esc(event.orderNumber || '')}</td>
            <td>${esc(event.oldValue || '')}</td>
            <td>${esc(event.newValue || '')}</td>
            <td class="col-audit-details" title="${esc(event.details || '')}">${esc(event.details || '')}</td>
            <td><button class="ghost" type="button" data-audit="${esc(event.at)}">View</button></td>
        </tr>`).join('');
    }
    function renderReport() {
        $('report-body').innerHTML = `<h2>Latest push</h2><p>Reserved VINs ${report.reservedVinCount || 0}<br>New VINs ${report.reservedFileAddedVins || 0}<br>Changed, status cleared ${report.reservedFileChangedVins || 0}<br>Unchanged, status kept ${report.reservedFileKeptVins || 0}<br>Matched ${report.matchedOrders || 0}<br>Unmatched ${report.unmatchedVins || 0}<br>Advisors ${report.salesAdvisorCount || 0}<br>Earliest ${esc(report.earliestAssignDate || '—')}<br>Latest ${esc(report.latestAssignDate || '—')}</p>`;
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
    function colIndex(letter) {
        const text = String(letter || '').toUpperCase();
        let n = 0;
        for (let i = 0; i < text.length; i += 1) n = n * 26 + (text.charCodeAt(i) - 64);
        return n;
    }
    function normalizeReservedTitle(col, label) {
        const letter = String(col || '').toUpperCase();
        const text = String(label || '').trim();
        const lower = text.toLowerCase();
        if (letter === 'I' && (!text || /^model$/i.test(text) || /^i$/i.test(text) || /vin|chassis|هيكل/.test(lower))) return 'VIN';
        if (letter === 'J' && (!text || /suffix|sfx|^j$/i.test(lower) || /expir|انتهاء|صلاحية|valid|date/.test(lower))) return 'Expiry';
        if (letter === 'F' && (/^order$/i.test(text) || /^f$/i.test(text))) return 'SFX';
        return text;
    }
    function aheadText(order) {
        const ahead = Array.isArray(order.ahead) ? order.ahead : [];
        if (!ahead.length) return '';
        return ahead.map((item) => {
            const rank = item.boPosition != null ? item.boPosition : item.queueNumber;
            const orderNo = item.orderNumber && item.orderNumber !== 'NO ORDER' ? item.orderNumber : '';
            const who = item.salesAdvisor || '';
            return ['#' + (rank == null ? '' : rank), orderNo, who].filter(Boolean).join(' ');
        }).join(' · ');
    }
    function aheadCellHtml(order) {
        const ahead = Array.isArray(order.ahead) ? order.ahead : [];
        if (!ahead.length) {
            return '<td class="col-ahead"><span class="ahead-empty">—</span></td>';
        }
        const chips = ahead.map((item) => {
            const rank = item.boPosition != null ? item.boPosition : item.queueNumber;
            const orderNo = item.orderNumber && item.orderNumber !== 'NO ORDER' ? String(item.orderNumber) : '';
            const who = item.salesAdvisor || '';
            const title = ['#' + (rank == null ? '' : rank), orderNo, who].filter(Boolean).join(' ');
            return `<span class="ahead-chip" title="${esc(title)}"><b>#${esc(String(rank == null ? '' : rank))}</b>${orderNo ? `<span>${esc(orderNo)}</span>` : ''}${who ? `<i>${esc(who)}</i>` : ''}</span>`;
        }).join('');
        let meta = '';
        if (order.boQueuePosition != null) {
            meta = `<span class="ahead-pos">BO #${esc(String(order.boQueuePosition))}${order.boQueueSize != null ? '/' + esc(String(order.boQueueSize)) : ''}</span>`;
        } else if (order.boQueueSize != null) {
            meta = `<span class="ahead-pos">BO queue · ${esc(String(order.boQueueSize))}</span>`;
        }
        return `<td class="col-ahead"><div class="ahead-stack">${meta}<div class="ahead-chips">${chips}</div></div></td>`;
    }
    function sheetColumns(list, source) {
        if (source === 'merged') {
            // Only the columns the team asked for, in the same order as the employee page. Leader note is the admin-only extra.
            const titles = { 'Updated by': 'Updated', 'Leader note': 'Leader note' };
            MERGED_META_COLS.concat(MERGED_COL_ORDER).forEach((label) => { if (!titles[label]) titles[label] = label; });
            return { cols: MERGED_META_COLS.concat(MERGED_COL_ORDER, ['Leader note']), titles };
        }
        const meta = source === 'reserved'
            ? ['Queue', 'Status', 'Leader note', 'Updated by', 'BO ahead', 'Expiry', 'Time left']
            : ['Queue', 'Status', 'Leader note', 'Updated by', 'BO ahead', 'Expiry', 'Time left'];
        const titles = {
            Expiry: 'Expiry date',
            'Time left': 'Time left',
            'Leader note': 'Leader note',
            'Updated by': 'Updated by'
        };
        const letters = new Set();
        list.forEach((order) => orderSheetFields(order, source).forEach((field) => {
            const col = String(field.col || '').trim().toUpperCase();
            const label = String(field.label || '').trim();
            if (!col) return;
            letters.add(col);
            if (!titles[col]) {
                titles[col] = source === 'reserved'
                    ? (normalizeReservedTitle(col, label) || RESERVED_SHEET_NAMES[col] || label)
                    : label;
            }
        }));
        const hasValue = (col) => list.some((order) => {
            const value = sheetValue(order, col, source);
            return value && value !== '—';
        });
        let excel = [...letters].filter(hasValue).sort((a, b) => colIndex(a) - colIndex(b));
        if (source === 'reserved') {
            const preferred = RESERVED_COL_ORDER.filter((col) => letters.has(col) && hasValue(col));
            const rest = excel.filter((col) => !preferred.includes(col));
            // J is shown as the Expiry meta column — drop the duplicate Excel letter column.
            excel = preferred.concat(rest).filter((col) => col !== 'J');
            titles.Expiry = 'Expiry';
        } else {
            // Keep Area (B) and Share level (C) visible together on Stock E-Sales.
            ['B', 'C'].forEach((col) => {
                if (!letters.has(col)) letters.add(col);
                if (!titles[col]) titles[col] = SHEET_NAMES[col] || col;
            });
            const preferred = ['B', 'C'].filter((col) => letters.has(col));
            const rest = excel.filter((col) => !preferred.includes(col));
            excel = preferred.concat(rest);
            titles.B = titles.B || 'Area';
            titles.C = titles.C || 'Share level';
        }
        if (!excel.length) {
            return source === 'reserved'
                ? meta.concat(['Order', 'VIN', 'Product', 'Model Year'])
                : meta.concat(['Order', 'VIN', 'Advisor', 'Payment', 'Area', 'Share level', 'Deadline']);
        }
        return { cols: meta.concat(excel), titles };
    }
    function rtlValue(order, col) {
        const want = String(col || '').toUpperCase();
        const hit = (order && Array.isArray(order.rtlFields) ? order.rtlFields : []).find((field) => String(field.col || '').toUpperCase() === want);
        if (!hit || hit.value == null) return '';
        const text = String(hit.value).trim();
        return text === '—' ? '' : text;
    }
    function rtlByLabel(order, label) {
        const hit = (order && Array.isArray(order.rtlFields) ? order.rtlFields : []).find((field) => String(field.label || '').replace(/\s+/g, ' ').trim().toLowerCase() === label);
        if (!hit || hit.value == null) return '';
        const text = String(hit.value).trim();
        return text === '—' ? '' : text;
    }
    function sheetValue(order, label, source) {
        const tierMatch = /^Queue ([123])$/.exec(label);
        if (tierMatch) {
            const q = (order.boTierQueues || [])[Number(tierMatch[1]) - 1];
            return q ? `${q.position} / ${q.size}` : '';
        }
        if (label === 'Queue position') {
            if (order.boQueuePosition == null) return '';
            return String(order.boQueuePosition) + (order.boQueueSize != null ? ' / ' + order.boQueueSize : '');
        }
        if (label === 'Queue') return order.queueNumber == null ? '' : String(order.queueNumber);
        if (label === 'Status') return order.status || '';
        if (label === 'Leader note') return order.leaderNote || '';
        if (label === 'Employee note' || label === 'Note') return order.statusNote || '';
        if (label === 'BO ahead') return aheadText(order);
        if (label === 'Updated by' || label === 'Team notes' || label === 'Updated at') {
            const who = order.statusChangedBy || '';
            const id = order.statusChangedEmployeeNumber || '';
            const when = order.statusChangedDisplay
                || (parseLocal(order.statusChangedAt)
                    ? parseLocal(order.statusChangedAt).toLocaleString('en-GB', {
                        timeZone: 'Asia/Riyadh',
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    }) + ' (Saudi)'
                    : (order.statusChangedAt || ''));
            if (!who && !when) return '';
            return [who ? (id ? `${who} · ${id}` : who) : '', when].filter(Boolean).join(' · ');
        }
        if (label === 'Expiry') {
            if (source === 'merged' && order.mergedExpiry) return order.mergedExpiry;
            return formatExpiryDate(order);
        }
        if (label === 'Time left') return remain(order);
        if (source === 'merged') {
            if (label === 'Source') return order.mergeSource || '';
            if (String(label).startsWith('rtl:')) return rtlValue(order, String(label).slice(4));
            const merged = (order.mergedFields || []).find((item) => item.label === label || item.col === label);
            if (merged) return merged.value == null || merged.value === '—' ? '' : String(merged.value);
            return '';
        }
        if (label === 'Order') return order.orderNumber || '';
        if (label === 'VIN') return order.vin || '';
        if (label === 'Advisor') return order.salesAdvisor || '';
        if (label === 'Payment') return order.paymentLabel || '';
        if (label === 'Deadline') return order.deadline || '';
        if (label === 'Product') return order.vehicle || '';
        if (label === 'Model Year') return order.modelYear || '';
        if (label === 'Area' || label === 'B') {
            return firstReal(order.searchArea, fieldValueFromList(orderSheetFields(order, source), 'B'), fieldValueFromList(orderSheetFields(order, source), 'A'));
        }
        if (label === 'Share level' || label === 'C') {
            return firstReal(order.shareLevel, fieldValueFromList(orderSheetFields(order, source), 'C'));
        }
        const field = orderSheetFields(order, source).find((item) => String(item.col || '').toUpperCase() === String(label || '').toUpperCase()
            || (item.label || item.col) === label);
        return field && field.value != null ? String(field.value) : '';
    }
    function setSheetSource(next) {
        sheetSource = 'merged'; // the E-Sales and Reserved Order File sheets are hidden from the Live sheet
        document.querySelectorAll('.sheet-source').forEach((button) => {
            const on = button.dataset.sheet === sheetSource;
            button.classList.toggle('active', on);
            button.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        const esalesBox = $('live-sheet-esales');
        const reservedBox = $('live-sheet-reserved');
        const mergedBox = $('live-sheet-merged');
        if (esalesBox) esalesBox.classList.toggle('hidden', sheetSource !== 'esales');
        if (reservedBox) reservedBox.classList.toggle('hidden', sheetSource !== 'reserved');
        if (mergedBox) mergedBox.classList.toggle('hidden', sheetSource !== 'merged');
        const note = $('sheet-note');
        if (note) note.textContent = SHEET_NOTES[sheetSource] || SHEET_NOTES.esales;
        const search = $('sheet-search');
        if (search) {
            search.placeholder = sheetSource === 'reserved'
                ? 'Search Reserved Order File'
                : sheetSource === 'merged'
                    ? 'Search merged sheet'
                    : 'Search Stock E-Sales';
        }
        const fileName = $('xl-filename');
        if (fileName) {
            fileName.textContent = sheetSource === 'reserved' ? 'Reserved Order File.xlsx'
                : sheetSource === 'merged' ? 'Merged sheet.xlsx' : 'Stock E-Sales.xlsx';
        }
        renderSheet();
    }
    function sheetRemainMs(order) {
        const end = parseLocal(expiryDeadlineOf(order));
        return end ? end.getTime() - Date.now() : null;
    }
    function restoreSelect(select, value) {
        if (!select) return;
        const wanted = value && Array.from(select.options).some((opt) => opt.value === value) ? value : '';
        select.value = wanted;
    }
    function distinctSheet(list, source, label) {
        return Array.from(new Set(list.map((order) => String(sheetValue(order, label, source) || '').trim()).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }
    function fillSheetFilters(list) {
        const chips = $('sheet-chips');
        if (chips) {
            const counts = { Payment: 0, 'In progress': 0, Cancelled: 0, none: 0, other: 0 };
            list.forEach((order) => { counts[statusBucket(order)] += 1; });
            const total = list.length;
            const chip = (key, label, value, dot) => `<button type="button" data-sheet-chip="${esc(key)}" aria-pressed="${sheetFilter.chip === key ? 'true' : 'false'}">${dot ? `<span class="dot ${dot}"></span>` : ''}${esc(label)}<i>${value}</i></button>`;
            chips.innerHTML = '<span class="ind"></span>'
                + chip('', 'All', total, '')
                + chip('Payment', 'Payment', counts.Payment, 'd-ok')
                + chip('In progress', 'In progress', counts['In progress'], 'd-warn')
                + chip('Cancelled', 'Cancelled', counts.Cancelled, 'd-bad')
                + chip('none', 'Not updated', counts.none, 'd-none')
                + (counts.other ? chip('other', 'Other', counts.other, 'd-you') : '');
            slideIndicator(chips.querySelector('.ind'), chips.querySelector('[aria-pressed="true"]'));
        }
        const salesman = $('sheet-filter-salesman');
        const product = $('sheet-filter-product');
        const area = $('sheet-filter-area');
        const keep = [sheetFilter.salesman, sheetFilter.product, sheetFilter.area, sheetFilter.expiry];
        if (salesman) {
            salesman.innerHTML = '<option value="">All salesmen</option>' + distinctSheet(list, 'merged', 'Salesman name').map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
            restoreSelect(salesman, keep[0]);
            sheetFilter.salesman = salesman.value;
        }
        if (product) {
            product.innerHTML = '<option value="">All cars</option>' + distinctSheet(list, 'merged', 'Product').map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
            restoreSelect(product, keep[1]);
            sheetFilter.product = product.value;
        }
        if (area) {
            area.innerHTML = '<option value="">All areas</option>' + distinctSheet(list, 'merged', 'Area').map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
            restoreSelect(area, keep[2]);
            sheetFilter.area = area.value;
        }
        const expiry = $('sheet-filter-expiry');
        if (expiry) {
            restoreSelect(expiry, keep[3]);
            sheetFilter.expiry = expiry.value;
        }
    }
    function orderMatchesSheetFilter(order, source) {
        if (sheetFilter.chip === 'none' && !isNotUpdated(order)) return false;
        if (sheetFilter.chip && sheetFilter.chip !== 'none' && statusBucket(order) !== sheetFilter.chip) return false;
        if (sheetFilter.salesman && sheetValue(order, 'Salesman name', source) !== sheetFilter.salesman) return false;
        if (sheetFilter.product && sheetValue(order, 'Product', source) !== sheetFilter.product) return false;
        if (sheetFilter.area && sheetValue(order, 'Area', source) !== sheetFilter.area) return false;
        if (sheetFilter.expiry) {
            const ms = sheetRemainMs(order);
            if (sheetFilter.expiry === 'expired' && !(ms != null && ms <= 0)) return false;
            if (sheetFilter.expiry === 'soon' && !(ms != null && ms > 0 && ms < 86400000)) return false;
        }
        return true;
    }
    function renderOneSheet(box, source, list) {
        if (!box) return;
        const needle = ($('sheet-search') && $('sheet-search').value || '').trim().toLowerCase();
        const packed = sheetColumns(list, source);
        const allCols = Array.isArray(packed) ? packed : packed.cols;
        const titles = Array.isArray(packed) ? {} : (packed.titles || {});
        const colName = (label) => (source === 'merged'
            ? (titles[label] || label)
            : source === 'reserved'
                ? (titles[label] || RESERVED_SHEET_NAMES[label] || label)
                : (SHEET_NAMES[label] || titles[label] || label));
        xlInfo[source] = { all: allCols.slice(), name: colName };
        // The admin can hide and reorder columns (Columns button / right-click a header); only the visible ones render.
        const cols = xlVisibleCols(source, allCols);
        const hiddenCount = allCols.length - cols.length;
        const noVin = list.filter((order) => !hasVin(order)).length;
        // Merged sheet keeps non-duplicate rows even when some fields are empty.
        const visible = source === 'merged'
            ? (showNoVinRows ? list : list.filter((order) => hasVin(order) || orderInSheet(order, 'esales') || orderInSheet(order, 'reserved')))
            : (showNoVinRows ? list : list.filter(hasVin));
        const rows = visible.filter((order) => {
            if (!orderMatchesSheetFilter(order, source)) return false;
            if (!needle) return true;
            return cols.some((label) => sheetValue(order, label, source).toLowerCase().includes(needle));
        });
        const head = (label) => {
            const named = colName(label);
            if (/^[A-Z]{1,3}$/.test(label) && named && source !== 'merged') {
                return `<th class="xl-h" draggable="true" data-label="${esc(label)}" title="Drag to reorder this column for everyone">${esc(named)}<span class="col-letter">${esc(label)}</span></th>`;
            }
            return `<th class="xl-h" draggable="true" data-label="${esc(label)}" title="Drag to reorder this column for everyone">${esc(named || label)}</th>`;
        };
        const cell = (order, label) => {
            const value = sheetValue(order, label, source);
            if (label === 'Status') {
                const pill = statusPill(order.status);
                if (source === 'merged' && order.key) {
                    return `<td class="col-status"><span class="edit">${pill}${icon('chevron', 'chev')}</span></td>`;
                }
                return `<td class="col-status">${pill}</td>`;
            }
            if (label === 'Leader note') {
                const key = order.key || '';
                return `<td class="col-notes col-leader-note">
                    <textarea class="sheet-leader-note" data-key="${esc(key)}" data-prev="${esc(order.leaderNote || '')}" rows="2" maxlength="2000" placeholder="Leader note for the team">${esc(order.leaderNote || '')}</textarea>
                    <button type="button" class="btn sm sheet-leader-save" data-key="${esc(key)}">Save</button>
                    ${order.leaderNoteDisplay ? `<small>${esc(order.leaderNoteBy || 'Admin')} · ${esc(order.leaderNoteDisplay)}</small>` : ''}
                </td>`;
            }
            if (label === 'Updated by' || label === 'Team notes' || label === 'Updated at') {
                const who = order.statusChangedBy || '';
                const id = order.statusChangedEmployeeNumber || '';
                const when = order.statusChangedDisplay
                    || (parseLocal(order.statusChangedAt)
                        ? parseLocal(order.statusChangedAt).toLocaleString('en-GB', {
                            timeZone: 'Asia/Riyadh',
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                        }) + ' (Saudi)'
                        : (order.statusChangedAt || ''));
                if (!who && !when) return '<td class="col-updated-by"><span class="muted-text">—</span></td>';
                return `<td class="col-updated-by upd">${who ? `<span>${esc(who)}</span>` : ''}${when ? `<small>${esc(when)}</small>` : ''}</td>`;
            }
            const tierMatch = /^Queue ([123])$/.exec(label);
            if (tierMatch) {
                const tier = Number(tierMatch[1]);
                const q = (order.boTierQueues || [])[tier - 1];
                if (!q) return `<td class="col-queue col-tier" title="No colour choice ${tier} for this order in the Toyota Back Order file"><span class="muted-text">—</span></td>`;
                const pair = [q.exterior, q.interior].filter(Boolean).join(' / ');
                return `<td class="col-queue col-tier" title="Colour choice ${tier}${pair ? ' (' + esc(pair) + ')' : ''}: position ${esc(String(q.position))} of ${esc(String(q.size))}"><div class="q"><b>#${esc(String(q.position))}</b><small>/ ${esc(String(q.size))}</small></div>${pair ? `<span class="q-pair">${esc(pair)}</span>` : ''}</td>`;
            }
            if (label === 'Queue position') {
                if (order.boQueuePosition == null) return '<td class="col-queue" title="Not found in the Toyota Back Order file"><span class="ahead-empty">—</span></td>';
                const size = order.boQueueSize != null ? `<small class="q-of"> / ${esc(String(order.boQueueSize))}</small>` : '';
                return `<td class="col-queue" title="Back Order queue position"><span class="q-pill">#${esc(String(order.boQueuePosition))}</span>${size}</td>`;
            }
            if (label === 'Note') {
                return `<td class="col-note"><div class="note" title="${esc(value)}" dir="auto">${value ? esc(value) : '—'}</div></td>`;
            }
            if (label === 'Salesman name') return `<td class="col-advisor">${value ? `<span class="person"><span class="av">${esc(initials(value))}</span>${esc(value)}</span>` : ''}</td>`;
            if (label === 'Usage') return value ? `<td class="col-source"><span class="tag${retailOk(value) ? ' good' : ''}">${esc(value)}</span></td>` : '<td class="col-source"></td>';
            if (label === 'Expiry date') {
                const deadline = value ? expiryDeadlineOf(order) : '';
                if (!parseLocal(deadline)) return `<td class="col-expiry">${esc(value || '—')}</td>`;
                return `<td class="col-expiry">${expHtml(deadline, esc(value), false)}</td>`;
            }
            if (label === 'Queue') return `<td class="col-queue">${value ? `<span class="q-pill">#${esc(value)}</span>` : ''}</td>`;
            if (label === 'Expiry') return `<td class="col-expiry">${esc(value || '—')}</td>`;
            if (label === 'Time left') {
                const ms = remainMs(order);
                return `<td class="timer-cell ${timerTone(ms)}" data-deadline="${esc(orderDeadline(order) || '')}">${esc(value || '—')}</td>`;
            }
            if (label === 'BO ahead') return aheadCellHtml(order);
            if (label === 'Source') {
                const tone = value === 'Both' ? 'is-both' : value === 'Reserved' ? 'is-reserved' : 'is-esales';
                return `<td class="col-source"><span class="source-pill ${tone}">${esc(value || '—')}</span></td>`;
            }
            if (label === 'RTL stock') {
                if (!value) return '<td class="col-source"></td>';
                const tone = value === 'In RTL stock' ? 'is-both' : 'is-reserved';
                return `<td class="col-source"><span class="source-pill ${tone}">${esc(value)}</span></td>`;
            }
            if (label === 'U' && value) {
                const st = /^\d$/.test(value) ? '0' + value : value;
                return `<td><span class="st-type">${esc(st)}</span></td>`;
            }
            const title = (source === 'merged' ? label : (SHEET_NAMES[label] || titles[label] || label));
            if (source !== 'merged' && (isAreaOrShareLabel(label) || isAreaOrShareLabel(title))) {
                if (!value) return `<td class="cell-retail cell-retail-empty"></td>`;
                const ok = retailOk(value);
                return `<td class="cell-retail ${ok ? 'cell-retail-ok' : 'cell-retail-bad'}">${esc(value)}</td>`;
            }
            const plain = String(value == null ? '' : value).trim();
            return `<td${/^-?\d[\d,]*(\.\d+)?$/.test(plain) && plain.length < 12 ? ' class="xl-num"' : ''}>${esc(value)}</td>`;
        };
        const emptyMsg = !list.length
            ? (source === 'merged'
                ? 'No rows yet. Push the Reserved Order File and the RTL Stock on Data push.'
                : source === 'reserved'
                    ? 'No Reserved Order File rows yet. Push the Reserved Order File on Data push.'
                    : 'No Stock E-Sales rows yet. Push Stock E-Sales to fill this sheet.')
            : 'No rows match these filters. Clear search or pick another filter.';
        const note = noVin ? `${noVin} row${noVin === 1 ? '' : 's'} without a VIN ${showNoVinRows ? 'shown' : 'hidden'} <button type="button" class="sheet-novin-toggle">${showNoVinRows ? 'Hide them' : 'Show them'}</button>` : '';
        // Virtual Excel grid: column letters (A, B, C…), row 1 = the header row, numbered rows below.
        const letters = `<tr class="xl-letters"><th class="xl-corner" aria-hidden="true"></th>${cols.map((label, i) => `<th class="xl-col" data-c="${i}">${xlLetter(i)}</th>`).join('')}</tr>`;
        const heads = `<tr class="xl-heads"><th class="xl-corner">1</th>${cols.map(head).join('')}</tr>`;
        box.innerHTML = rows.length
            ? `<table class="xl-grid"><thead>${letters}${heads}</thead><tbody>${rows.map((order, index) => {
                const classes = [
                    'rowlink',
                    hasVin(order) ? '' : 'is-novin',
                    isCancelledStatus(order) ? 'row-cancelled' : ''
                ].filter(Boolean).join(' ');
                return `<tr class="${classes}" data-key="${esc(order.key || '')}" tabindex="0"><th class="xl-rn" scope="row">${index + 2}</th>${cols.map((label) => cell(order, label)).join('')}</tr>`;
            }).join('')}</tbody></table>`
            : `<p class="empty">${emptyMsg}</p>`;
        const grid = box.querySelector('.xl-grid');
        if (grid && xlZoom !== 100) grid.style.zoom = String(xlZoom / 100);
        if (source === sheetSource) {
            const stat = $('xl-stat');
            if (stat) stat.textContent = (rows.length ? `${rows.length.toLocaleString('en-GB')} rows × ${cols.length} columns` : 'No data')
                + (hiddenCount > 0 ? ` · ${hiddenCount} hidden` : '');
            xlRenderColsPop();
            xlPaintLayoutState();
            const novin = $('xl-novin');
            if (novin) novin.innerHTML = note;
        }
        xlRestoreSelection(box, source);
    }
    // ---- Virtual Excel helpers (selection, formula bar, zoom) ----
    let xlZoom = 100;
    const xlSelected = {};
    function xlLetter(index) {
        let n = index + 1;
        let out = '';
        while (n > 0) {
            const rem = (n - 1) % 26;
            out = String.fromCharCode(65 + rem) + out;
            n = Math.floor((n - 1) / 26);
        }
        return out;
    }
    function xlCellText(td) {
        if (!td) return '';
        const select = td.querySelector('select');
        if (select) return select.value || '';
        const area = td.querySelector('textarea');
        if (area) return area.value || '';
        return String(td.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function xlSelect(box, r, c, scroll) {
        const source = box && box.dataset.source;
        const body = box && box.querySelector('.xl-grid tbody');
        if (!body || !body.rows.length) return;
        const rowMax = body.rows.length - 1;
        const colMax = body.rows[0].cells.length - 2;
        r = Math.max(0, Math.min(rowMax, r));
        c = Math.max(0, Math.min(colMax, c));
        xlSelected[source] = { r, c };
        box.querySelectorAll('.xl-sel').forEach((el) => el.classList.remove('xl-sel'));
        box.querySelectorAll('.xl-active').forEach((el) => el.classList.remove('xl-active'));
        const tr = body.rows[r];
        const td = tr && tr.cells[c + 1];
        if (!td) return;
        td.classList.add('xl-sel');
        if (tr.cells[0]) tr.cells[0].classList.add('xl-active');
        const letters = box.querySelector('.xl-letters');
        if (letters && letters.cells[c + 1]) letters.cells[c + 1].classList.add('xl-active');
        const name = $('xl-name');
        if (name) name.textContent = xlLetter(c) + (r + 2);
        const formula = $('xl-formula');
        if (formula) formula.textContent = xlCellText(td);
        if (scroll) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function xlRestoreSelection(box, source) {
        const sel = xlSelected[source];
        if (sel) xlSelect(box, sel.r, sel.c, false);
        else if (source === sheetSource) {
            const name = $('xl-name');
            const formula = $('xl-formula');
            if (name) name.textContent = 'A1';
            if (formula) formula.textContent = '';
        }
    }
    // ---- Sheet layout: hide / reorder columns, then Save layout (kept in this browser) ----
    const XL_LAYOUT_KEY = 'ro-live-sheet-layout-v2'; // v2: the sheet now has the team's own column set
    const xlInfo = {};
    let xlSaved = {};
    let xlDraft = {};
    let xlFlash = '';
    let xlServer = {};
    const xlColDrag = { label: '', moved: false };
    function xlCopy(value) { return JSON.parse(JSON.stringify(value || {})); }
    function xlNorm(all) {
        const out = {};
        Object.keys(all || {}).sort().forEach((source) => {
            const layout = all[source] || {};
            const hidden = (layout.hidden || []).slice().sort();
            const order = layout.order || [];
            if (hidden.length || order.length) out[source] = { hidden, order };
        });
        return out;
    }
    (function xlLoadLayouts() {
        try { xlSaved = xlNorm(JSON.parse(localStorage.getItem(XL_LAYOUT_KEY) || '{}')); } catch (e) { xlSaved = {}; }
        xlDraft = xlCopy(xlSaved);
    })();
    function xlLayout(source) {
        if (!xlDraft[source]) xlDraft[source] = { hidden: [], order: [] };
        return xlDraft[source];
    }
    const renamedCol = (label) => {
        if (label === 'RTL status') return ['Usage'];
        if (label === 'Queue position') return ['Queue 1', 'Queue 2', 'Queue 3'];
        return [label];
    };
    function xlOrdered(source, all) {
        const known = new Set(all);
        const saved = (xlLayout(source).order || []).flatMap(renamedCol).filter((label) => known.has(label));
        return saved.concat(all.filter((label) => !saved.includes(label)));
    }
    function xlVisibleCols(source, all) {
        const hidden = new Set((xlLayout(source).hidden || []).flatMap(renamedCol));
        const shown = xlOrdered(source, all).filter((label) => !hidden.has(label));
        return shown.length ? shown : all.slice();
    }
    function xlDirty() { return JSON.stringify(xlNorm(xlDraft)) !== JSON.stringify(xlNorm(xlSaved)); }
    function applyServerLayout(data, asSaved) {
        const next = { merged: { hidden: (data && data.hidden) || [], order: (data && data.order) || [] } };
        xlServer = { hidden: next.merged.hidden.slice(), order: next.merged.order.slice() };
        if (asSaved) {
            xlSaved = xlNorm(next);
            xlDraft = xlCopy(xlSaved);
            try { localStorage.setItem(XL_LAYOUT_KEY, JSON.stringify(xlSaved)); } catch (e) { /* storage blocked */ }
        }
    }
    function xlPaintLayoutState() {
        const state = $('xl-layout-state');
        const save = $('xl-save-layout');
        const dirty = xlDirty();
        const published = !dirty
            && JSON.stringify(xlNorm(xlSaved)) === JSON.stringify(xlNorm({ merged: xlServer }))
            && !!(xlServer && (xlServer.updatedAt || (xlServer.order && xlServer.order.length) || (xlServer.hidden && xlServer.hidden.length)));
        if (state) {
            state.textContent = dirty
                ? 'Unsaved layout changes'
                : (xlFlash || (published ? 'Live for everyone' : 'Not submitted yet · employees still see the default sheet'));
            state.classList.toggle('is-dirty', dirty);
        }
        if (save) {
            save.disabled = !dirty && published;
            save.classList.toggle('is-dirty', dirty);
        }
        const btn = $('xl-cols-btn');
        if (btn) {
            const info = xlInfo[sheetSource];
            const hidden = info ? info.all.length - xlVisibleCols(sheetSource, info.all).length : 0;
            const label = btn.querySelector('.mono');
            if (label) label.textContent = hidden > 0 ? `(${hidden} hidden)` : '';
        }
    }
    function xlAfterLayoutChange() {
        xlFlash = '';
        renderSheet();
        xlPaintLayoutState();
    }
    function xlSetHidden(source, label, hide) {
        const info = xlInfo[source];
        if (!info) return;
        const layout = xlLayout(source);
        const hidden = new Set(layout.hidden || []);
        if (hide) {
            // Always keep at least one column on screen.
            if (info.all.length - hidden.size <= 1) return;
            hidden.add(label);
        } else {
            hidden.delete(label);
        }
        layout.hidden = Array.from(hidden);
        xlAfterLayoutChange();
    }
    function xlMove(source, label, direction) {
        const info = xlInfo[source];
        if (!info) return;
        const layout = xlLayout(source);
        const hidden = new Set(layout.hidden || []);
        const ordered = xlOrdered(source, info.all);
        const from = ordered.indexOf(label);
        if (from < 0) return;
        let to = from + direction;
        // Swap with the next column that is actually on screen so the move is visible.
        while (to >= 0 && to < ordered.length && !hidden.has(label) && hidden.has(ordered[to])) to += direction;
        if (to < 0 || to >= ordered.length) return;
        ordered[from] = ordered[to];
        ordered[to] = label;
        layout.order = ordered;
        xlAfterLayoutChange();
    }
    async function xlSaveLayout() {
        const info = xlInfo[sheetSource];
        if (info) xlLayout(sheetSource).order = xlOrdered(sheetSource, info.all);
        xlSaved = xlNorm(xlDraft);
        xlDraft = xlCopy(xlSaved);
        const merged = xlDraft.merged || xlSaved.merged || { hidden: [], order: [] };
        try { localStorage.setItem(XL_LAYOUT_KEY, JSON.stringify(xlSaved)); } catch (e) { /* storage blocked */ }
        try {
            const data = await api('/api/reserved-orders/admin/sheet-layout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    password: password(),
                    order: merged.order || (info ? info.all : []),
                    hidden: merged.hidden || []
                })
            });
            applyServerLayout(data, true);
            xlFlash = 'Live for everyone';
            toast('Layout submitted', 'Employees and this admin page now use these columns.', 'd-ok');
        } catch (e) {
            xlFlash = e.message || 'Could not submit';
            toast('Could not submit', xlFlash, 'd-bad');
        }
        xlPaintLayoutState();
    }
    function xlResetLayout() {
        delete xlDraft[sheetSource];
        xlAfterLayoutChange();
    }
    function xlReorderTo(source, fromLabel, toLabel) {
        if (!fromLabel || fromLabel === toLabel) return;
        const info = xlInfo[source];
        if (!info) return;
        const ordered = xlOrdered(source, info.all);
        const from = ordered.indexOf(fromLabel);
        const to = ordered.indexOf(toLabel);
        if (from < 0 || to < 0) return;
        ordered.splice(from, 1);
        ordered.splice(to, 0, fromLabel);
        xlLayout(source).order = ordered;
        xlAfterLayoutChange();
    }
    function xlToggleColsPop(force) {
        const pop = $('xl-cols-pop');
        const btn = $('xl-cols-btn');
        if (!pop) return;
        const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
        pop.classList.toggle('hidden', !open);
        pop.classList.toggle('open', open);
        if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) xlRenderColsPop();
    }
    function xlRenderColsPop() {
        const pop = $('xl-cols-pop');
        const list = $('xl-cols-list');
        if (!pop || !list || pop.classList.contains('hidden')) return;
        const info = xlInfo[sheetSource];
        if (!info) { list.innerHTML = ''; return; }
        const title = $('xl-cols-title');
        if (title) title.textContent = `Columns · ${sheetSource === 'reserved' ? 'Reserved Order File' : sheetSource === 'merged' ? 'Merged sheet' : 'E-Sales'}`;
        const hidden = new Set(xlLayout(sheetSource).hidden || []);
        const ordered = xlOrdered(sheetSource, info.all);
        const shownCount = ordered.filter((label) => !hidden.has(label)).length;
        const q = (($('xl-cols-q') && $('xl-cols-q').value) || '').trim().toLowerCase();
        const scroll = list.scrollTop;
        list.innerHTML = ordered.map((label, index) => {
            const name = String(info.name(label) || label);
            if (q && !`${name} ${label}`.toLowerCase().includes(q)) return '';
            const isHidden = hidden.has(label);
            const letter = /^[A-Z]{1,3}$/.test(label) && sheetSource !== 'merged' ? `<small>col ${esc(label)}</small>` : '';
            return `<li class="${isHidden ? 'is-hidden' : ''}" data-label="${esc(label)}" draggable="true">
                <button type="button" class="grip" draggable="true" aria-label="Drag ${esc(name)}" title="Drag to reorder">⋮⋮</button>
                <label><input type="checkbox" data-xl-toggle${isHidden ? '' : ' checked'}${!isHidden && shownCount <= 1 ? ' disabled' : ''}><span>${esc(name)}</span>${letter}</label>
                <button type="button" data-xl-move="-1" aria-label="Move ${esc(name)} up"${index === 0 ? ' disabled' : ''}>&#8593;</button>
                <button type="button" data-xl-move="1" aria-label="Move ${esc(name)} down"${index === ordered.length - 1 ? ' disabled' : ''}>&#8595;</button>
            </li>`;
        }).join('') || '<li class="xl-cols-none">No column matches.</li>';
        list.scrollTop = scroll;
    }
    function xlCloseCtx() {
        const ctx = $('xl-ctx');
        if (ctx) ctx.classList.add('hidden');
    }
    function xlOpenCtx(event, source, label) {
        const ctx = $('xl-ctx');
        if (!ctx) return;
        const info = xlInfo[source];
        const name = info ? String(info.name(label) || label) : label;
        ctx.dataset.source = source;
        ctx.dataset.label = label;
        const title = ctx.querySelector('.xl-ctx-title');
        if (title) title.textContent = name;
        ctx.classList.remove('hidden');
        const width = ctx.offsetWidth || 190;
        const height = ctx.offsetHeight || 150;
        ctx.style.left = Math.max(4, Math.min(event.clientX, window.innerWidth - width - 8)) + 'px';
        ctx.style.top = Math.max(4, Math.min(event.clientY, window.innerHeight - height - 8)) + 'px';
    }
    function renderSheet() {
        const esalesList = orders.filter((order) => orderInSheet(order, 'esales'));
        const reservedList = orders.filter((order) => orderInSheet(order, 'reserved'));
        const mergedList = buildMergedList(orders);
        const esalesCount = $('sheet-count-esales');
        const reservedCount = $('sheet-count-reserved');
        const mergedCount = $('sheet-count-merged');
        if (esalesCount) esalesCount.textContent = String(esalesList.filter(hasVin).length);
        if (reservedCount) reservedCount.textContent = String(reservedList.filter(hasVin).length);
        if (mergedCount) mergedCount.textContent = String(mergedList.length);
        fillSheetFilters(mergedList);
        renderOneSheet($('live-sheet-esales'), 'esales', esalesList);
        renderOneSheet($('live-sheet-reserved'), 'reserved', reservedList);
        renderOneSheet($('live-sheet-merged'), 'merged', mergedList);
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
    function soldTone(kind) {
        if (kind === 'delivered') return 'p-ok';
        if (kind === 'proforma') return 'p-info';
        return 'p-none';
    }
    function openSoldDetail(vin) {
        const item = sold.find((row) => String(row.vin || '').toUpperCase() === String(vin || '').toUpperCase());
        if (!item) return;
        const rtlFields = (item.rtlRow || []).map((field) => `<div><span>${esc(field.label)}</span><b>${esc(field.value)}</b></div>`).join('');
        const salesFields = (item.salesRow || []).map((field) => `<div><span>${esc(field.label)}</span><b>${esc(field.value)}</b></div>`).join('');
        const tone = soldTone(item.soldKind);
        showDrawer(`<div class="dr-head"><div><h2>Sold VIN ${esc(item.vin || '')}</h2><p>${esc(item.orderNumber || '—')}</p></div><button class="x" id="close-drawer" type="button" aria-label="Close">${icon('close')}</button></div><div class="dr-body">
            <p><span class="pill ${tone}"><span class="dot"></span>${esc(item.soldLabel || item.soldKind || 'Sold')}</span>
            · Order ${esc(item.orderNumber || '—')} · Advisor ${esc(item.salesAdvisor || '—')}<br>
            Last status ${esc(item.lastStatus || item.status || '—')} · Removed ${esc(item.removedDisplay || item.removedAt || '—')}</p>
            <h3>Where it is</h3>
            <p>${item.rtlFound
                ? `Found in RTL Stock${item.rtlSheetName ? ' · ' + esc(item.rtlSheetName) : ''}${item.rtlRowIndex ? ' · row ' + esc(String(item.rtlRowIndex)) : ''}${item.rtlSearchArea ? ' · area ' + esc(item.rtlSearchArea) : ''}`
                : 'Not found in the current RTL Stock file.'}</p>
            <p>${item.salesFound
                ? `Found in Sales Raw${item.salesSheetName ? ' · ' + esc(item.salesSheetName) : ''}${item.invoiceDate ? ' · invoice (col V) ' + esc(item.invoiceDate) : ' · no invoice date in column V (proforma)'}${item.proformaDate ? ' · proforma ' + esc(item.proformaDate) : ''}`
                : 'Not found in the current Sales Raw file.'}</p>
            <h3>RTL row</h3>
            <div class="facts">${rtlFields || `<div><span>RTL</span><b>${esc(item.rtlDescription || 'No RTL row captured')}</b></div>`}</div>
            <h3>Sales Raw row</h3>
            <div class="facts">${salesFields || `<div><span>Sales Raw</span><b>${esc(item.salesDescription || 'No Sales Raw row captured')}</b></div>`}</div>
        </div>`);
    }
    function renderSold() {
        const box = $('sold-rows');
        if (!box) return;
        const q = ($('sold-search') && $('sold-search').value || '').trim().toLowerCase();
        const kind = ($('sold-kind') && $('sold-kind').value) || '';
        const rows = sold.filter((item) => {
            if (kind && item.soldKind !== kind) return false;
            if (!q) return true;
            return [item.vin, item.orderNumber, item.salesAdvisor, item.customerName, item.soldLabel, item.lastStatus]
                .join(' ').toLowerCase().includes(q);
        });
        const meta = $('sold-meta');
        if (meta) {
            const delivered = sold.filter((item) => item.soldKind === 'delivered').length;
            const proforma = sold.filter((item) => item.soldKind === 'proforma').length;
            meta.textContent = `${sold.length} sold VIN${sold.length === 1 ? '' : 's'} · ${delivered} delivered · ${proforma} proforma · click Where to open the RTL / Sales Raw row`;
        }
        box.innerHTML = rows.length
            ? rows.map((item) => `<tr>
                <td><span class="pill ${soldTone(item.soldKind)}"><span class="dot"></span>${esc(item.soldLabel || item.soldKind || 'Sold')}</span></td>
                <td class="mono">${esc(item.vin || '—')}</td>
                <td>${esc(item.orderNumber || '—')}</td>
                <td>${esc(item.salesAdvisor || '—')}</td>
                <td>${esc(item.lastStatus || item.status || '—')}</td>
                <td>${esc(item.invoiceDate || '—')}</td>
                <td>${esc(item.removedDisplay || item.removedAt || '—')}</td>
                <td><button class="ghost" type="button" data-sold="${esc(item.vin || '')}">Where</button></td>
            </tr>`).join('')
            : '<tr><td colspan="8" class="st-na">No sold VINs yet. They appear when a push removes a VIN that is still in RTL or Sales Raw.</td></tr>';
    }
    function renderStatusSettings() {
        const list = $('status-list');
        if (!list) return;
        list.innerHTML = STATUSES.map((item) => {
            const locked = item === 'محجوز';
            return `<li>
                <span dir="auto">${esc(item)}</span>
                ${locked
                    ? '<small class="muted">default</small>'
                    : `<button class="btn sm" type="button" data-remove-status="${esc(item)}">Remove</button>`}
            </li>`;
        }).join('');
    }
    function renderAll() { renderOverview(); renderOrders(); renderSold(); renderSheet(); renderStaff(); renderArchive(); renderAudit(); renderReport(); renderAlerts(); renderMarketing(); renderStatusSettings(); }

    async function refresh() {
        const data = await api('/api/reserved-orders/admin?password=' + encodeURIComponent(password()));
        orders = data.orders || [];
        sold = data.sold || [];
        staff = data.staff || [];
        archive = data.archive || [];
        report = data.report || {};
        if (Array.isArray(data.statuses) && data.statuses.length) STATUSES = data.statuses;
        if (data.sheetLayout) {
            const published = (data.sheetLayout.order && data.sheetLayout.order.length)
                || (data.sheetLayout.hidden && data.sheetLayout.hidden.length)
                || data.sheetLayout.updatedAt;
            if (published && !xlDirty()) applyServerLayout(data.sheetLayout, true);
            else xlServer = { hidden: data.sheetLayout.hidden || [], order: data.sheetLayout.order || [] };
        }
        $('admin-updated').textContent = data.updatedAt ? `Last push ${new Date(data.updatedAt).toLocaleString()}` : 'No live push yet';
        const source = $('push-source');
        if (source) {
            const rep = data.report || {};
            const rtlCheck = rep.rtlRows != null
                ? ` · VINs found in RTL Stock ${rep.rtlMatched || 0} of ${(rep.rtlMatched || 0) + (rep.rtlMissing || 0)}`
                : '';
            source.textContent = data.rtlName || data.boName
                ? `Live files: RTL Stock ${data.rtlName || '—'} · Back Order ${data.boName || '—'}${rtlCheck}`
                : 'No RTL Stock or Back Order pushed yet.';
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

    async function fillGateStaff() {
        const user = $('admin-user');
        if (user && !user.value.trim()) user.value = 'admin';
    }
    $('gate-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        $('gate-error').textContent = '';
        const name = (($('admin-user') && $('admin-user').value) || 'admin').trim();
        const secret = $('admin-password').value;
        $('admin-password').value = '';
        try {
            const res = await fetch('/api/reserved-orders/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password: secret })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'User or password is not valid.');
            if (data.role !== 'admin') throw new Error('This login is for the employee page.');
            sessionStorage.removeItem(passKey);
            sessionStorage.setItem(tokenKey, data.token);
            sessionStorage.setItem(whoKey, JSON.stringify({ name: data.name, recordId: data.recordId }));
            await refresh();
            showApp();
        } catch (e) {
            if (e.message !== 'unauthorized') $('gate-error').textContent = e.message;
        }
    });
    $('admin-out').addEventListener('click', () => { clearAdminAuth(); showGate(''); fillGateStaff(); });
    $('admin-app').addEventListener('click', (event) => {
        const button = event.target.closest('[data-panel]');
        if (button && !event.target.closest('#pending-modal')) showPanel(button.dataset.panel);
    });
    ['admin-search', 'admin-status', 'admin-payment', 'admin-expired'].forEach((id) => $(id).addEventListener('input', renderOrders));
    ['sold-search', 'sold-kind'].forEach((id) => { if ($(id)) $(id).addEventListener('input', renderSold); });
    ['audit-q', 'audit-employee', 'audit-action'].forEach((id) => $(id).addEventListener('input', renderAudit));
    $('admin-rows').addEventListener('click', (event) => { const button = event.target.closest('[data-open]'); if (button) openOrder(button.dataset.open); });
    if ($('sold-rows')) {
        $('sold-rows').addEventListener('click', (event) => {
            const button = event.target.closest('[data-sold]');
            if (button) openSoldDetail(button.dataset.sold);
        });
    }
    $('admin-rows').addEventListener('change', (event) => {
        const select = event.target.closest('.admin-status-select');
        if (!select) return;
        if (select.value === select.dataset.prev) return;
        adminSetStatus(select.dataset.key, select.value, select);
    });
    async function saveStatusList(action, status) {
        const err = $('status-error');
        if (err) err.textContent = '';
        try {
            const data = await api('/api/reserved-orders/admin/statuses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password(), action, status })
            });
            if (Array.isArray(data.statuses) && data.statuses.length) STATUSES = data.statuses;
            if ($('status-new')) $('status-new').value = '';
            renderStatusSettings();
            renderOrders();
            renderSheet();
            const filter = $('admin-status');
            if (filter) {
                const current = filter.value;
                filter.innerHTML = '<option value="">Status</option>' + STATUSES.map((item) => `<option>${esc(item)}</option>`).join('');
                filter.value = current;
            }
        } catch (e) {
            if (err) err.textContent = e.message || 'Could not update statuses.';
        }
    }
    if ($('status-add')) {
        $('status-add').addEventListener('click', () => {
            const value = (($('status-new') || {}).value || '').trim();
            if (!value) {
                if ($('status-error')) $('status-error').textContent = 'Enter a status name.';
                return;
            }
            saveStatusList('add', value);
        });
    }
    if ($('status-new')) {
        $('status-new').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                if ($('status-add')) $('status-add').click();
            }
        });
    }
    if ($('status-list')) {
        $('status-list').addEventListener('click', (event) => {
            const button = event.target.closest('[data-remove-status]');
            if (!button) return;
            const name = button.dataset.removeStatus;
            if (!name || name === 'محجوز') return;
            if (!confirm(`Remove status "${name}"? Orders already using it keep that status until changed.`)) return;
            saveStatusList('remove', name);
        });
    }
    $('audit-rows').addEventListener('click', (event) => {
        const button = event.target.closest('[data-audit]');
        if (!button) return;
        const eventRow = audit.find((item) => item.at === button.dataset.audit);
        if (!eventRow) return;
        showDrawer(`<div class="dr-head"><div><h2>${esc(eventRow.action)}</h2></div><button class="x" id="close-drawer" type="button" aria-label="Close">${icon('close')}</button></div><div class="dr-body"><pre class="cur-note">${esc(JSON.stringify(eventRow, null, 2))}</pre></div>`);
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
        const name = $('staff-name').value.trim();
        const id = $('staff-id').value.trim();
        const role = $('staff-role').value === 'admin' ? 'admin' : 'employee';
        if (!name || !id) {
            $('staff-error').textContent = 'Enter a name and an employee ID.';
            return;
        }
        try {
            await api('/api/reserved-orders/staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    id,
                    role,
                    active: $('staff-active').checked,
                    previousRecordId: editing
                })
            });
            const page = role === 'admin' ? 'admin page' : 'employee page';
            toast(editing ? 'Person saved' : 'Person added', name + ' opens the ' + page + '.', 'd-ok');
            clearStaffForm();
            await refresh();
            fillGateStaff();
        } catch (e) { if (e.message !== 'unauthorized') $('staff-error').textContent = e.message; }
    });
    if ($('staff-cancel')) $('staff-cancel').addEventListener('click', clearStaffForm);
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
        if ($('staff-form-title')) $('staff-form-title').textContent = 'Edit person';
        if ($('save-staff')) $('save-staff').textContent = 'Save changes';
        $('staff-name').focus();
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
    function markPushSteps(upto, cls) {
        document.querySelectorAll('#push-steps li').forEach((li, i) => {
            li.classList.remove('run', 'done', 'fail');
            if (i < upto) li.classList.add('done');
            else if (i === upto) li.classList.add(cls || 'run');
        });
    }
    $('push-live').addEventListener('click', async () => {
        $('push-error').textContent = '';
        const rtl = $('rtl-file').files[0];
        const reserved = $('reserved-file') ? $('reserved-file').files[0] : null;
        if (!rtl && !reserved) { $('push-error').textContent = 'Choose the RTL Stock and/or the Reserved Order File first.'; return; }
        const button = $('push-live');
        button.disabled = true;
        let step = 0;
        markPushSteps(0, 'run');
        const tick = setInterval(() => { if (step < 2) { step += 1; markPushSteps(step, 'run'); } }, 700);
        try {
            const body = { password: password() };
            if (rtl) { body.rtlBase64 = await fileToBase64(rtl); body.rtlName = rtl.name; }
            if (reserved) { body.reservedBase64 = await fileToBase64(reserved); body.reservedName = reserved.name; }
            const pushed = await api('/api/reserved-orders/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            clearInterval(tick);
            document.querySelectorAll('#push-steps li').forEach((li) => { li.classList.remove('run', 'fail'); li.classList.add('done'); });
            const report = pushed || {};
            const smalls = document.querySelectorAll('#push-steps li small');
            if (smalls[0]) smalls[0].textContent = (report.reservedVinCount || orders.length || '') + ' rows';
            if (smalls[1]) smalls[1].textContent = (report.matchedOrders != null ? report.matchedOrders + ' of ' + (report.reservedVinCount || '') : '') + '';
            if (smalls[2]) smalls[2].textContent = 'queues ranked';
            if (smalls[3]) smalls[3].textContent = 'Live now';
            if ($('push-report')) {
                $('push-report').innerHTML = `<section class="card pane"><h2>Push report</h2>
                    <div class="report">
                        <div><span>New VINs</span><b>${report.reservedFileAddedVins || 0}</b></div>
                        <div><span>Changed so status cleared</span><b>${report.reservedFileChangedVins || 0}</b></div>
                        <div><span>Unchanged so status kept</span><b>${report.reservedFileKeptVins || 0}</b></div>
                        <div><span>Moved to Sold VINs</span><b>${report.soldCaptured || 0}</b></div>
                    </div>
                    <button class="btn" type="button" data-panel="overview">Open overview</button>
                </section>`;
            }
            toast('Live sheet updated', (report.reservedVinCount || 0) + ' VINs published.', 'd-ok');
            await refresh();
        } catch (e) {
            clearInterval(tick);
            const running = document.querySelector('#push-steps li.run') || document.querySelector('#push-steps li:last-child');
            if (running) { running.classList.remove('run'); running.classList.add('fail'); }
            if (e.message !== 'unauthorized') $('push-error').textContent = e.message;
        } finally { button.disabled = false; }
    });
    setInterval(() => {
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
        document.querySelectorAll('.xl-expiry').forEach((cell) => {
            const end = parseLocal(cell.dataset.expiry);
            if (!end) return;
            const ms = end.getTime() - Date.now();
            const left = cell.querySelector('.xl-expiry-left');
            if (left) left.textContent = expiryCountdown(ms);
            cell.classList.remove('is-ok', 'is-warn', 'is-bad');
            const tone = expiryTone(ms);
            if (tone) cell.classList.add(tone);
        });
        document.querySelectorAll('.timer-cell').forEach((cell) => {
            const end = parseLocal(cell.dataset.deadline);
            if (!end) {
                cell.textContent = 'NO ASSIGN DATE';
                cell.classList.remove('is-ok', 'is-warn', 'is-bad');
                return;
            }
            const ms = end.getTime() - Date.now();
            cell.classList.remove('is-ok', 'is-warn', 'is-bad');
            const tone = timerTone(ms);
            if (tone) cell.classList.add(tone);
            if (ms <= 0) { cell.textContent = 'EXPIRED'; return; }
            const total = Math.floor(ms / 1000);
            cell.textContent = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        });
    }, 1000);
    if ($('sheet-search')) $('sheet-search').addEventListener('input', renderSheet);
    ['sheet-filter-salesman', 'sheet-filter-product', 'sheet-filter-area', 'sheet-filter-expiry'].forEach((id) => {
        if (!$(id)) return;
        $(id).addEventListener('change', () => {
            if (id === 'sheet-filter-salesman') sheetFilter.salesman = $(id).value;
            if (id === 'sheet-filter-product') sheetFilter.product = $(id).value;
            if (id === 'sheet-filter-area') sheetFilter.area = $(id).value;
            if (id === 'sheet-filter-expiry') sheetFilter.expiry = $(id).value;
            renderSheet();
        });
    });
    if ($('sheet-chips')) $('sheet-chips').addEventListener('click', (event) => {
        const button = event.target.closest('[data-sheet-chip]');
        if (!button) return;
        sheetFilter.chip = button.dataset.sheetChip || '';
        renderSheet();
    });
    if ($('sheet-filter-clear')) $('sheet-filter-clear').addEventListener('click', () => {
        sheetFilter.chip = '';
        sheetFilter.salesman = '';
        sheetFilter.product = '';
        sheetFilter.area = '';
        sheetFilter.expiry = '';
        if ($('sheet-search')) $('sheet-search').value = '';
        ['sheet-filter-salesman', 'sheet-filter-product', 'sheet-filter-area', 'sheet-filter-expiry'].forEach((id) => { if ($(id)) $(id).value = ''; });
        renderSheet();
    });
    document.querySelectorAll('.sheet-source').forEach((button) => {
        button.addEventListener('click', () => setSheetSource(button.dataset.sheet));
    });
    async function adminSaveLeaderNote(key, text, button) {
        if (!key) return;
        try {
            if (button) button.disabled = true;
            const data = await api('/api/reserved-orders/admin/leader-note', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password(), key, note: text })
            });
            const next = data.order || {};
            const order = orders.find((item) => item.key === key);
            if (order) {
                order.leaderNote = next.leaderNote || '';
                order.leaderNoteBy = next.leaderNoteBy || '';
                order.leaderNoteAt = next.leaderNoteAt || '';
                order.leaderNoteDisplay = next.leaderNoteDisplay || '';
            }
            const area = button && button.closest('td');
            const input = area && area.querySelector('.sheet-leader-note');
            if (input) input.dataset.prev = next.leaderNote || '';
            if (button) {
                button.textContent = 'Saved';
                setTimeout(() => { button.textContent = 'Save'; }, 900);
            }
            renderOrders();
        } catch (e) {
            if (e.message !== 'unauthorized') alert(e.message || 'Could not save leader note.');
        } finally {
            if (button) button.disabled = false;
        }
    }
    ['live-sheet-esales', 'live-sheet-reserved', 'live-sheet-merged'].forEach((id) => {
        const box = $(id);
        if (!box) return;
        box.addEventListener('click', (event) => {
            const save = event.target.closest('.sheet-leader-save');
            if (save) {
                const cell = save.closest('td');
                const input = cell && cell.querySelector('.sheet-leader-note');
                adminSaveLeaderNote(save.dataset.key, input ? input.value : '', save);
                return;
            }
            // Click a cell to select it (like Excel); controls inside cells keep working normally.
            const td = event.target.closest('.xl-grid tbody td');
            if (td) {
                const tr = td.parentElement;
                xlSelect(box, tr.sectionRowIndex, td.cellIndex - 1, false);
                if (!event.target.closest('select, textarea, input, button, a')) box.focus({ preventScroll: true });
                return;
            }
            const rn = event.target.closest('.xl-grid tbody th.xl-rn');
            if (rn) { xlSelect(box, rn.parentElement.sectionRowIndex, (xlSelected[box.dataset.source] || { c: 0 }).c, false); return; }
            const col = event.target.closest('.xl-grid .xl-col');
            if (col) xlSelect(box, (xlSelected[box.dataset.source] || { r: 0 }).r, Number(col.dataset.c) || 0, false);
        });
        box.addEventListener('keydown', (event) => {
            if (event.target !== box) {
                // Inside a cell control: Escape returns to the grid.
                if (event.key === 'Escape') box.focus({ preventScroll: true });
                return;
            }
            const sel = xlSelected[box.dataset.source] || { r: 0, c: 0 };
            const move = {
                ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
                Enter: [event.shiftKey ? -1 : 1, 0], Tab: [0, event.shiftKey ? -1 : 1],
                PageUp: [-15, 0], PageDown: [15, 0]
            }[event.key];
            if (move) {
                event.preventDefault();
                xlSelect(box, sel.r + move[0], sel.c + move[1], true);
            } else if (event.key === 'Home') {
                event.preventDefault();
                xlSelect(box, event.ctrlKey ? 0 : sel.r, 0, true);
            } else if (event.key === 'End') {
                event.preventDefault();
                const body = box.querySelector('.xl-grid tbody');
                xlSelect(box, event.ctrlKey && body ? body.rows.length - 1 : sel.r, 9999, true);
            } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
                const td = box.querySelector('.xl-sel');
                if (td && navigator.clipboard) navigator.clipboard.writeText(xlCellText(td)).catch(() => {});
            }
        });
    });
    // No-VIN toggle now lives in the Excel status bar.
    const xlPanel = $('panel-sheet');
    if (xlPanel) xlPanel.addEventListener('click', (event) => {
        if (!event.target.closest('.sheet-novin-toggle')) return;
        showNoVinRows = !showNoVinRows;
        renderSheet();
    });
    // Layout controls: Columns popover, Save / Reset, right-click menu on column headers.
    if ($('xl-cols-btn')) $('xl-cols-btn').addEventListener('click', (event) => { event.stopPropagation(); xlToggleColsPop(); });
    if ($('xl-cols-close')) $('xl-cols-close').addEventListener('click', () => xlToggleColsPop(false));
    if ($('xl-cols-q')) $('xl-cols-q').addEventListener('input', xlRenderColsPop);
    if ($('xl-cols-showall')) $('xl-cols-showall').addEventListener('click', () => {
        xlLayout(sheetSource).hidden = [];
        xlAfterLayoutChange();
    });
    if ($('xl-save-layout')) $('xl-save-layout').addEventListener('click', xlSaveLayout);
    if ($('xl-reset-layout')) $('xl-reset-layout').addEventListener('click', xlResetLayout);
    if ($('xl-cols-list')) {
        $('xl-cols-list').addEventListener('change', (event) => {
            const box = event.target.closest('[data-xl-toggle]');
            const row = event.target.closest('li[data-label]');
            if (box && row) xlSetHidden(sheetSource, row.dataset.label, !box.checked);
        });
        $('xl-cols-list').addEventListener('click', (event) => {
            const move = event.target.closest('[data-xl-move]');
            const row = event.target.closest('li[data-label]');
            if (move && row && !move.disabled) xlMove(sheetSource, row.dataset.label, Number(move.dataset.xlMove));
        });
        let xlDragLabel = '';
        $('xl-cols-list').addEventListener('dragstart', (event) => {
            const row = event.target.closest('li[data-label]');
            if (!row) return;
            xlDragLabel = row.dataset.label;
            row.classList.add('is-drag');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', xlDragLabel);
        });
        $('xl-cols-list').addEventListener('dragend', () => {
            xlDragLabel = '';
            $('xl-cols-list').querySelectorAll('.is-drag, .is-over').forEach((el) => el.classList.remove('is-drag', 'is-over'));
        });
        $('xl-cols-list').addEventListener('dragover', (event) => {
            const row = event.target.closest('li[data-label]');
            if (!row || !xlDragLabel) return;
            event.preventDefault();
            $('xl-cols-list').querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
            row.classList.add('is-over');
        });
        $('xl-cols-list').addEventListener('drop', (event) => {
            const row = event.target.closest('li[data-label]');
            event.preventDefault();
            if (row && xlDragLabel) xlReorderTo(sheetSource, xlDragLabel, row.dataset.label);
            xlDragLabel = '';
        });
    }
    if ($('xl-cols-pop')) $('xl-cols-pop').addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', (event) => {
        if (!event.target.closest('#xl-ctx')) xlCloseCtx();
        const pop = $('xl-cols-pop');
        if (pop && !pop.classList.contains('hidden') && !event.target.closest('#xl-cols-pop, #xl-cols-btn')) xlToggleColsPop(false);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        xlCloseCtx();
        xlToggleColsPop(false);
    });
    window.addEventListener('scroll', xlCloseCtx, true);
    ['live-sheet-esales', 'live-sheet-reserved', 'live-sheet-merged'].forEach((id) => {
        const box = $(id);
        if (!box) return;
        box.addEventListener('contextmenu', (event) => {
            const th = event.target.closest('.xl-grid thead th[data-label]');
            if (!th) return;
            event.preventDefault();
            xlOpenCtx(event, box.dataset.source, th.dataset.label);
        });
        box.addEventListener('dragstart', (event) => {
            const th = event.target.closest('.xl-grid .xl-h[data-label]');
            if (!th) return;
            xlColDrag.label = th.dataset.label;
            xlColDrag.moved = false;
            th.classList.add('is-drag');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', xlColDrag.label);
        });
        box.addEventListener('dragend', () => {
            xlColDrag.label = '';
            box.querySelectorAll('.is-drag, .is-over').forEach((el) => el.classList.remove('is-drag', 'is-over'));
            setTimeout(() => { xlColDrag.moved = false; }, 50);
        });
        box.addEventListener('dragover', (event) => {
            const th = event.target.closest('.xl-grid .xl-h[data-label]');
            if (!th || !xlColDrag.label) return;
            event.preventDefault();
            box.querySelectorAll('.xl-h.is-over').forEach((el) => el.classList.remove('is-over'));
            th.classList.add('is-over');
        });
        box.addEventListener('drop', (event) => {
            const th = event.target.closest('.xl-grid .xl-h[data-label]');
            event.preventDefault();
            if (!th || !xlColDrag.label) return;
            const from = xlColDrag.label;
            const to = th.dataset.label;
            xlColDrag.label = '';
            if (from === to) return;
            xlColDrag.moved = true;
            xlReorderTo(box.dataset.source, from, to);
            if (xlDirty()) xlSaveLayout();
        });
    });
    if ($('xl-ctx')) $('xl-ctx').addEventListener('click', (event) => {
        const button = event.target.closest('[data-act]');
        const ctx = $('xl-ctx');
        if (!button || !ctx) return;
        const source = ctx.dataset.source;
        const label = ctx.dataset.label;
        xlCloseCtx();
        if (button.dataset.act === 'hide') xlSetHidden(source, label, true);
        else if (button.dataset.act === 'left') xlMove(source, label, -1);
        else if (button.dataset.act === 'right') xlMove(source, label, 1);
        else if (button.dataset.act === 'showall') { xlLayout(source).hidden = []; xlAfterLayoutChange(); }
    });
    window.addEventListener('beforeunload', (event) => {
        if (!xlDirty()) return;
        event.preventDefault();
        event.returnValue = '';
    });
    const xlZoomInput = $('xl-zoom');
    if (xlZoomInput) xlZoomInput.addEventListener('input', () => {
        xlZoom = Number(xlZoomInput.value) || 100;
        const label = $('xl-zoom-val');
        if (label) label.textContent = `${xlZoom}%`;
        document.querySelectorAll('#panel-sheet .xl-grid').forEach((grid) => { grid.style.zoom = String(xlZoom / 100); });
    });
    // ---- Notify employees who have not updated their reserved orders on reserved-orders.html ----
    const PENDING_LOG_KEY = 'ro-pending-notified-v1';
    function advisorKey(value) {
        return String(value == null ? '' : value).replace(/\u00a0/g, ' ').replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    }
    function isPendingUpdate(order) {
        if (!isRealVin(order)) return false;
        const status = String(order.status || '').trim();
        if (status === 'تم الفوترة' || status === 'الغاء') return false;
        // "Not updated" = nobody has ever changed the status of this order from the employee page or admin.
        return !String(order.statusChangedAt || '').trim() && !String(order.statusChangedBy || '').trim();
    }
    function pendingGroups(expiredOnly) {
        const people = new Map();
        staff.filter((person) => person.active !== false && person.name && person.recordId)
            .forEach((person) => people.set(advisorKey(person.name), person));
        const groups = new Map();
        orders.filter(isPendingUpdate).forEach((order) => {
            const advisor = String(order.salesAdvisor || '').trim();
            const key = advisorKey(advisor);
            if (!key || key === 'unassigned') return;
            const expired = remain(order) === 'EXPIRED';
            if (expiredOnly && !expired) return;
            if (!groups.has(key)) {
                const person = people.get(key) || null;
                groups.set(key, { key, name: person ? person.name : advisor, recordId: person ? person.recordId : '', orders: [], expired: 0 });
            }
            const group = groups.get(key);
            group.orders.push(order);
            if (expired) group.expired += 1;
        });
        return Array.from(groups.values()).sort((a, b) => (b.recordId ? 1 : 0) - (a.recordId ? 1 : 0) || b.orders.length - a.orders.length || a.name.localeCompare(b.name));
    }
    function pendingLog() {
        try { return JSON.parse(localStorage.getItem(PENDING_LOG_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function ago(ms) {
        const minutes = Math.round(ms / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;
        const hours = Math.round(minutes / 60);
        return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
    }
    function pendingMessage(group, intro) {
        const nums = group.orders.map((order) => order.orderNumber && order.orderNumber !== 'NO ORDER' ? order.orderNumber : '').filter(Boolean);
        const shown = nums.slice(0, 8).join(', ');
        const more = nums.length > 8 ? ` and ${nums.length - 8} more` : '';
        const count = group.orders.length;
        return `${intro.trim()} You have ${count} reserved order${count === 1 ? '' : 's'} with no status update${group.expired ? ` (${group.expired} expired)` : ''}${shown ? `: ${shown}${more}` : ''}.`;
    }
    function paintPendingModal() {
        const list = $('pending-list');
        if (!list) return;
        const groups = pendingGroups($('pending-expired-only') && $('pending-expired-only').checked);
        const log = pendingLog();
        const reachable = groups.filter((group) => group.recordId);
        const help = $('pending-help');
        if (help) {
            help.textContent = groups.length
                ? `${groups.reduce((sum, group) => sum + group.orders.length, 0)} order(s) across ${groups.length} advisor(s) have never had a status update. ${reachable.length} can be notified.`
                : 'Every assigned order already has a status update. Nobody needs a reminder.';
        }
        list.innerHTML = groups.map((group) => {
            const last = group.recordId && log[group.recordId] ? `<small>Last notified ${esc(ago(Date.now() - log[group.recordId]))}</small>` : '';
            return `<label class="checkrow${group.recordId ? '' : ' is-locked'}" data-record="${esc(group.recordId)}" data-key="${esc(group.key)}">
                <input type="checkbox" class="pn-check"${group.recordId ? ' checked' : ' disabled'}>
                <span class="person"><span class="av">${esc(initials(group.name))}</span><span dir="auto">${esc(group.name)}</span></span>
                ${group.recordId ? '' : '<small class="muted">No login account</small>'}${last}
                <em>${group.orders.length} cars</em>
                ${group.expired ? `<span style="color:var(--bad)">${group.expired} expired</span>` : ''}
            </label>`;
        }).join('');
        const send = $('pending-send');
        if (send) send.disabled = !reachable.length;
        const error = $('pending-error');
        if (error) error.textContent = '';
    }
    function openPendingModal() {
        const modal = $('pending-modal');
        if (!modal) return;
        modal.classList.add('open');
        modal.classList.remove('hidden');
        paintPendingModal();
    }
    function closePendingModal() {
        const modal = $('pending-modal');
        if (modal) { modal.classList.remove('open'); }
    }
    async function sendPendingNotices() {
        const send = $('pending-send');
        const error = $('pending-error');
        const intro = ($('pending-intro') && $('pending-intro').value.trim()) || 'Please update the status of your reserved orders on the Reserved Orders page.';
        const groups = pendingGroups($('pending-expired-only') && $('pending-expired-only').checked);
        const chosen = Array.from(document.querySelectorAll('#pending-list .checkrow, #pending-list .pn-row')).filter((row) => {
            const box = row.querySelector('.pn-check');
            return box && box.checked && !box.disabled;
        }).map((row) => groups.find((group) => group.key === row.dataset.key)).filter(Boolean);
        if (!chosen.length) { if (error) error.textContent = 'Choose at least one employee.'; return; }
        if (send) { send.disabled = true; send.textContent = 'Sending…'; }
        const log = pendingLog();
        const failed = [];
        let sent = 0;
        for (const group of chosen) {
            try {
                await api('/api/reserved-orders/notifications', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'Update your reserved orders', message: pendingMessage(group, intro), recordIds: [group.recordId] })
                });
                log[group.recordId] = Date.now();
                sent += 1;
            } catch (e) {
                if (e.message === 'unauthorized') return;
                failed.push(group.name);
            }
        }
        try { localStorage.setItem(PENDING_LOG_KEY, JSON.stringify(log)); } catch (e) { /* ignore */ }
        if (send) { send.textContent = 'Send again to selected'; }
        paintPendingModal();
        if (error) {
            error.classList.toggle('ok', !failed.length);
            error.textContent = failed.length
                ? `Sent to ${sent}. Could not notify: ${failed.join(', ')}.`
                : `Notified ${sent} employee${sent === 1 ? '' : 's'}. They see it on their Reserved Orders page and as a laptop alert if enabled.`;
        }
        if (!failed.length && sent) toast('Reminder sent to ' + sent + ' salesmen', 'They see it on their page and as a laptop pop-up.', 'd-ok');
    }
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-notify-pending]')) {
            openPendingModal();
            if (document.querySelector('#pending-list .pn-check:checked')) sendPendingNotices();
            return;
        }
        const modal = $('pending-modal');
        if (!modal || !modal.classList.contains('open')) return;
        if (event.target === modal || event.target.closest('#pending-close')) closePendingModal();
        else if (event.target.closest('#pending-all')) {
            document.querySelectorAll('#pending-list .pn-check:not(:disabled)').forEach((box) => { box.checked = true; });
        } else if (event.target.closest('#pending-none')) {
            document.querySelectorAll('#pending-list .pn-check').forEach((box) => { box.checked = false; });
        } else if (event.target.closest('#pending-send')) sendPendingNotices();
    });
    if ($('pending-expired-only')) $('pending-expired-only').addEventListener('change', paintPendingModal);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePendingModal(); });
    async function adminSetStatus(key, status, selectEl) {
        if (!key || !status) return;
        try {
            if (selectEl) selectEl.disabled = true;
            const data = await api('/api/reserved-orders/admin/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password(), key, status })
            });
            const order = orders.find((item) => item.key === key);
            const next = data.order || {};
            if (order) {
                order.status = next.status || status;
                order.statusChangedBy = next.statusChangedBy || 'Admin';
                order.statusChangedEmployeeNumber = next.statusChangedEmployeeNumber || '';
                order.statusChangedAt = next.statusChangedAt || '';
                order.statusChangedDisplay = next.statusChangedDisplay || '';
                if (Array.isArray(next.history)) order.history = next.history;
            }
            if (selectEl) {
                selectEl.dataset.prev = status;
                selectEl.classList.add('is-saved');
                setTimeout(() => selectEl.classList.remove('is-saved'), 900);
            }
            closeDrawer();
            flashRow(key);
            toast('Saved · ' + status, (order && (order.vehicle || order.orderNumber) || '') + '', status === 'Payment' ? 'd-ok' : status === 'Cancelled' ? 'd-bad' : 'd-warn');
            renderOrders();
            renderSalesTypes();
            renderSheet();
            renderOverview();
        } catch (e) {
            if (selectEl && selectEl.dataset.prev != null) selectEl.value = selectEl.dataset.prev;
            if (e.message !== 'unauthorized') toast('Could not save', e.message || 'Could not update status.', 'd-bad');
        } finally {
            if (selectEl) selectEl.disabled = false;
        }
    }
    const mergedBox = $('live-sheet-merged');
    if (mergedBox) {
        mergedBox.addEventListener('change', (event) => {
            const select = event.target.closest('.admin-status-select');
            if (!select) return;
            if (select.value === select.dataset.prev) return;
            adminSetStatus(select.dataset.key, select.value, select);
        });
        mergedBox.addEventListener('click', (event) => {
            if (xlColDrag.moved) { xlColDrag.moved = false; return; }
            if (event.target.closest('textarea, button, input, select, a, .xl-h, .xl-letters')) return;
            const row = event.target.closest('tr[data-key]');
            if (row && row.dataset.key) openOrder(row.dataset.key);
        });
        mergedBox.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const row = event.target.closest('tr[data-key]');
            if (row && row.dataset.key) openOrder(row.dataset.key);
        });
    }
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
    if ($('st-expiring')) $('st-expiring').addEventListener('click', (event) => {
        const row = event.target.closest('[data-open]');
        if (row) openOrder(row.dataset.open);
    });
    if ($('admin-scrim')) $('admin-scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeDrawer();
    });
    window.addEventListener('resize', paintAdminRail);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(paintAdminRail);
    function bindDrop(box, input) {
        if (!box || !input) return;
        const label = box.querySelector('small');
        const paint = () => {
            const file = input.files && input.files[0];
            box.classList.toggle('ready', !!file);
            if (label) label.textContent = file ? (file.name + ' · ' + Math.round(file.size / 1024) + ' KB') : 'Choose a file';
        };
        input.addEventListener('change', paint);
        ['dragenter', 'dragover'].forEach((name) => box.addEventListener(name, (event) => { event.preventDefault(); box.classList.add('ready'); }));
        box.addEventListener('dragleave', () => { if (!(input.files && input.files[0])) box.classList.remove('ready'); });
        box.addEventListener('drop', (event) => {
            event.preventDefault();
            if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
                input.files = event.dataTransfer.files;
                paint();
            }
        });
    }
    bindDrop($('drop-reserved'), $('reserved-file'));
    bindDrop($('drop-rtl'), $('rtl-file'));
    try {
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(`${protocol}//${location.host}`);
        socket.addEventListener('message', (event) => {
            const msg = JSON.parse(event.data);
            if ((msg.type === 'reserved_orders_updated' || msg.type === 'report_sheet_updated') && (password() || adminToken())) refresh().catch(() => {});
        });
    } catch (e) { /* the sheet still refreshes on the next manual open */ }
    fillGateStaff();
    if (password() || adminToken()) refresh().then(showApp).catch(() => { fillGateStaff(); });
})();