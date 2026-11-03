(function () {
    let STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
    const passKey = 'reserved-orders-admin-pass';
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
    function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
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
        return String(order && order.status || '').trim() === 'الغاء';
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
        const value = order.status || '';
        const options = STATUSES.map((item) => {
            const selected = item === value ? ' selected' : '';
            return `<option value="${esc(item)}"${selected}>${esc(item)}</option>`;
        }).join('');
        const extra = value && !STATUSES.includes(value)
            ? `<option value="${esc(value)}" selected>${esc(value)}</option>`
            : '';
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
    const MERGED_COL_ORDER = ['Source', 'VIN', 'Order', 'Customer', 'Product', 'Model Year', 'SFX', 'Exterior', 'Interior', 'Advisor', 'Payment', 'Area', 'Share level'];
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
    const SHEET_NOTES = {
        esales: 'Columns and rows from the Stock E-Sales push. BO ahead shows the first 3 orders in front in the same Back Order product / suffix / color queue.',
        reserved: 'Columns and rows from the Reserved Order File push. BO ahead uses the same Back Order queue rules as BO Order Lookup.',
        merged: 'One row per VIN. If the VIN is in both files, Stock E-Sales info is kept and only Expiry comes from the Reserved Order File. Change Status here or on Orders — employees see it live. Add new statuses in Settings. Leader note is admin-only. Updated by shows who changed status and when (Saudi time).'
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
                boOrdersAhead: esalesSide.boOrdersAhead != null ? esalesSide.boOrdersAhead : reservedSide.boOrdersAhead
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
    function buildMergedOrder(order) {
        const inE = orderInSheet(order, 'esales');
        const inR = orderInSheet(order, 'reserved');
        const esales = orderSheetFields(order, 'esales');
        const reserved = orderSheetFields(order, 'reserved');
        const eProduct = cleanProductText(fieldValueFromList(esales, 'I'));
        const eSuffixRaw = fieldValueFromList(esales, 'J');
        const eSuffix = (!looksLikeDateText(eSuffixRaw) && !looksLikeVinText(eSuffixRaw)) ? eSuffixRaw : '';
        const eVin = fieldValueFromList(esales, 'L');
        const rVin = fieldValueFromList(reserved, 'I');
        const rProduct = cleanProductText(fieldValueFromList(reserved, 'E'));
        const rSuffix = fieldValueFromList(reserved, 'F');
        const vin = firstReal(
            looksLikeVinText(order.vin) ? order.vin : '',
            looksLikeVinText(eVin) ? eVin : '',
            looksLikeVinText(rVin) ? rVin : ''
        );
        // Reserved-only → Reserved columns. E-Sales or Both → Stock E-Sales info only; expiry from Reserved.
        let values;
        if (inR && !inE) {
            values = {
                Source: 'Reserved',
                VIN: vin,
                Order: cleanOrderText(fieldValueFromList(reserved, 'C')) || cleanOrderText(order.orderNumber),
                Customer: cleanPersonText(fieldValueFromList(reserved, 'B')) || cleanPersonText(order.customerName),
                Product: rProduct,
                'Model Year': firstReal(fieldValueFromList(reserved, 'D'), order.modelYear),
                SFX: rSuffix,
                Exterior: firstReal(fieldValueFromList(reserved, 'G')),
                Interior: firstReal(fieldValueFromList(reserved, 'H')),
                Advisor: '',
                Payment: '',
                Area: '',
                'Share level': ''
            };
        } else {
            values = {
                Source: inE && inR ? 'Both' : 'E-Sales',
                VIN: vin,
                Order: cleanOrderText(order.orderNumber) || cleanOrderText(fieldValueFromList(esales, 'F')),
                Customer: cleanPersonText(order.customerName) || cleanPersonText(fieldValueFromList(esales, 'S')),
                Product: eProduct || cleanProductText(order.vehicle),
                'Model Year': firstReal(order.modelYear, fieldValueFromList(esales, 'K')),
                SFX: eSuffix,
                Exterior: firstReal(order.exterior, fieldValueFromList(esales, 'M')),
                Interior: firstReal(order.interior, fieldValueFromList(esales, 'N')),
                Advisor: cleanPersonText(order.salesAdvisor) || cleanPersonText(fieldValueFromList(esales, 'T')),
                Payment: firstReal(
                    (order.paymentLabel && String(order.paymentLabel).toUpperCase() !== 'UNKNOWN') ? order.paymentLabel : ''
                ),
                Area: firstReal(order.searchArea, fieldValueFromList(esales, 'B'), fieldValueFromList(esales, 'A')),
                'Share level': firstReal(order.shareLevel, fieldValueFromList(esales, 'C'))
            };
        }
        const expiry = inR ? formatExpiryValue(order, reserved) : '';
        const mergedFields = MERGED_COL_ORDER.map((label) => ({
            label,
            col: label,
            value: values[label] == null ? '' : values[label]
        }));
        return Object.assign({}, order, {
            mergeSource: values.Source,
            mergedExpiry: expiry,
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
                const rank = { Both: 0, 'E-Sales': 1, Reserved: 2 };
                const d = (rank[a.mergeSource] != null ? rank[a.mergeSource] : 9) - (rank[b.mergeSource] != null ? rank[b.mergeSource] : 9);
                if (d) return d;
                return (a.queueNumber || 0) - (b.queueNumber || 0);
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
            list.map((order) => `<tr data-open="${esc(order.key)}" class="st-row${isCancelledStatus(order) ? ' row-cancelled' : ''}">
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
        // Mirror Sales type analysis (column U) — Stock E-Sales has no Payment column,
        // so the old cash/bank report stayed Unknown for every row.
        const typeCounts = {};
        carRows().forEach((order) => {
            const key = salesTypeOf(order) || 'blank';
            typeCounts[key] = (typeCounts[key] || 0) + 1;
        });
        const typeKeys = SALES_TYPE_ORDER.concat(
            Object.keys(typeCounts).filter((key) => !SALES_TYPE_ORDER.includes(key)).sort()
        ).filter((key) => typeCounts[key]);
        const typeMax = Math.max(1, ...typeKeys.map((key) => typeCounts[key] || 0));
        $('pay-bars').innerHTML = typeKeys.map((key) => {
            const value = typeCounts[key] || 0;
            const label = key === 'blank'
                ? 'Blank'
                : (SALES_TYPE_NAMES[key] ? `${key} · ${SALES_TYPE_NAMES[key]}` : `Type ${key}`);
            return `<div class="bar"><span>${esc(label)}</span><i style="width:${Math.round(value / typeMax * 100)}%"></i><b>${value}</b></div>`;
        }).join('') || '<div class="bar"><span>No cars</span><i style="width:0%"></i><b>0</b></div>';
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
            : '—';
        const lastAt = order.statusChangedDisplay
            || (parseLocal(order.statusChangedAt)
                ? parseLocal(order.statusChangedAt).toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' (Saudi)'
                : (order.statusChangedAt || '—'));
        $('drawer').classList.remove('hidden');
        $('drawer').innerHTML = `<button class="ghost" id="close-drawer" type="button">Close</button>
            <h2>Order #${esc(order.orderNumber || 'NO ORDER')}</h2>
            <p>${esc(order.vin)} · ${esc(order.vehicle || '')}<br>Status ${esc(order.status)} · Queue #${order.queueNumber == null ? '—' : order.queueNumber}<br>Expiry ${esc(formatExpiryDate(order))} · Time left ${esc(remain(order))}</p>
            <p><b>Last status change:</b> ${esc(lastBy)} · <span class="saudi-time">${esc(lastAt)}</span></p>
            <h3>Leader note</h3>
            <p class="muted">Only admin can write notes. Employees can read this on their page.</p>
            <textarea id="leader-note-input" rows="4" maxlength="2000" placeholder="Write a leader note for this order">${esc(order.leaderNote || '')}</textarea>
            <div style="display:flex;gap:8px;margin:8px 0 16px;align-items:center;">
                <button class="solid" type="button" id="leader-note-save">Save leader note</button>
                <button class="ghost" type="button" id="leader-note-clear">Clear</button>
                <span class="muted" id="leader-note-feedback"></span>
            </div>
            <h3>Status history (Saudi time)</h3>${history}
            <h3>Audit</h3>${related.map((event) => `<div>${esc(event.display || event.at)} · ${esc(event.action)} · ${esc(event.user)}</div>`).join('') || '<div>No audit events</div>'}`;
        $('close-drawer').addEventListener('click', () => $('drawer').classList.add('hidden'));
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
            const meta = ['Queue', 'Status', 'Leader note', 'Updated by', 'BO ahead', 'Expiry', 'Time left'];
            const titles = {
                Expiry: 'Expiry date',
                'Time left': 'Time left',
                Source: 'Source',
                'Leader note': 'Leader note',
                'Updated by': 'Updated by'
            };
            MERGED_COL_ORDER.forEach((label) => { titles[label] = label; });
            // Keep every merged column so non-duplicate rows with blanks still appear.
            return { cols: meta.concat(MERGED_COL_ORDER), titles };
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
    function sheetValue(order, label, source) {
        if (label === 'Queue') return order.queueNumber == null ? '' : String(order.queueNumber);
        if (label === 'Status') return order.status || '';
        if (label === 'Leader note') return order.leaderNote || '';
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
        const rows = visible.filter((order) => !needle || cols.some((label) => sheetValue(order, label, source).toLowerCase().includes(needle)));
        const head = (label) => {
            const named = colName(label);
            if (/^[A-Z]{1,3}$/.test(label) && named && source !== 'merged') {
                return `<th class="xl-h" data-label="${esc(label)}" title="Source column ${esc(label)}">${esc(named)}<span class="col-letter">${esc(label)}</span></th>`;
            }
            return `<th class="xl-h" data-label="${esc(label)}">${esc(named || label)}</th>`;
        };
        const cell = (order, label) => {
            const value = sheetValue(order, label, source);
            if (label === 'Status') {
                if (source === 'merged' && order.key) {
                    return `<td class="col-status">${statusSelectHtml(order)}</td>`;
                }
                return `<td class="col-status">${statusPill(value)}</td>`;
            }
            if (label === 'Leader note') {
                const key = order.key || '';
                return `<td class="col-notes col-leader-note">
                    <textarea class="sheet-leader-note" data-key="${esc(key)}" data-prev="${esc(order.leaderNote || '')}" rows="2" maxlength="2000" placeholder="Leader note for the team">${esc(order.leaderNote || '')}</textarea>
                    <button type="button" class="ghost sheet-leader-save" data-key="${esc(key)}">Save</button>
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
                if (!who && !when) return '<td class="col-updated-by"><span class="ahead-empty">—</span></td>';
                return `<td class="col-updated-by">
                    ${who ? `<b>${esc(who)}</b>${id ? `<small>${esc(id)}</small>` : ''}` : ''}
                    ${when ? `<span class="saudi-time">${esc(when)}</span>` : ''}
                </td>`;
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
            if (label === 'U' && value) {
                const st = /^\d$/.test(value) ? '0' + value : value;
                return `<td><span class="st-type">${esc(st)}</span></td>`;
            }
            const title = (source === 'merged' ? label : (SHEET_NAMES[label] || titles[label] || label));
            if (isAreaOrShareLabel(label) || isAreaOrShareLabel(title)) {
                if (!value) return `<td class="cell-retail cell-retail-empty"></td>`;
                const ok = retailOk(value);
                return `<td class="cell-retail ${ok ? 'cell-retail-ok' : 'cell-retail-bad'}">${esc(value)}</td>`;
            }
            const plain = String(value == null ? '' : value).trim();
            return `<td${/^-?\d[\d,]*(\.\d+)?$/.test(plain) && plain.length < 12 ? ' class="xl-num"' : ''}>${esc(value)}</td>`;
        };
        const emptyMsg = source === 'merged'
            ? 'No merged rows yet. Push Stock E-Sales and/or the Reserved Order File.'
            : source === 'reserved'
                ? 'No Reserved Order File rows yet. Push the Reserved Order File on Data push.'
                : 'No Stock E-Sales rows yet. Push Stock E-Sales to fill this sheet.';
        const note = noVin ? `${noVin} row${noVin === 1 ? '' : 's'} without a VIN ${showNoVinRows ? 'shown' : 'hidden'} <button type="button" class="sheet-novin-toggle">${showNoVinRows ? 'Hide them' : 'Show them'}</button>` : '';
        // Virtual Excel grid: column letters (A, B, C…), row 1 = the header row, numbered rows below.
        box.innerHTML = rows.length
            ? `<table class="xl-grid"><thead>
                <tr class="xl-letters"><th class="xl-corner"></th>${cols.map((label, index) => `<th class="xl-col" data-c="${index}" data-label="${esc(label)}" title="Right-click to hide or move this column">${xlLetter(index)}</th>`).join('')}</tr>
                <tr class="xl-head"><th class="xl-rn">1</th>${cols.map(head).join('')}</tr>
            </thead><tbody>${rows.map((order, rowIndex) => {
                const classes = [
                    hasVin(order) ? '' : 'is-novin',
                    isCancelledStatus(order) ? 'row-cancelled' : ''
                ].filter(Boolean).join(' ');
                return `<tr class="${classes}"><th class="xl-rn" data-r="${rowIndex}">${rowIndex + 2}</th>${cols.map((label) => cell(order, label)).join('')}</tr>`;
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
    const XL_LAYOUT_KEY = 'ro-live-sheet-layout-v1';
    const xlInfo = {};
    let xlSaved = {};
    let xlDraft = {};
    let xlFlash = '';
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
    function xlOrdered(source, all) {
        const known = new Set(all);
        const saved = (xlLayout(source).order || []).filter((label) => known.has(label));
        return saved.concat(all.filter((label) => !saved.includes(label)));
    }
    function xlVisibleCols(source, all) {
        const hidden = new Set(xlLayout(source).hidden || []);
        const shown = xlOrdered(source, all).filter((label) => !hidden.has(label));
        return shown.length ? shown : all.slice();
    }
    function xlDirty() { return JSON.stringify(xlNorm(xlDraft)) !== JSON.stringify(xlNorm(xlSaved)); }
    function xlPaintLayoutState() {
        const state = $('xl-layout-state');
        const save = $('xl-save-layout');
        const dirty = xlDirty();
        if (state) {
            state.textContent = dirty ? 'Unsaved layout changes' : (xlFlash || 'Layout saved');
            state.classList.toggle('is-dirty', dirty);
        }
        if (save) {
            save.disabled = !dirty;
            save.classList.toggle('is-dirty', dirty);
        }
        const btn = $('xl-cols-btn');
        if (btn) {
            const info = xlInfo[sheetSource];
            const hidden = info ? info.all.length - xlVisibleCols(sheetSource, info.all).length : 0;
            const label = btn.querySelector('span');
            if (label) label.textContent = hidden > 0 ? `Columns (${hidden} hidden)` : 'Columns';
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
    function xlSaveLayout() {
        xlSaved = xlNorm(xlDraft);
        xlDraft = xlCopy(xlSaved);
        try {
            localStorage.setItem(XL_LAYOUT_KEY, JSON.stringify(xlSaved));
            xlFlash = 'Layout saved';
        } catch (e) {
            xlFlash = 'Could not save in this browser';
        }
        xlPaintLayoutState();
    }
    function xlResetLayout() {
        delete xlDraft[sheetSource];
        xlAfterLayoutChange();
    }
    function xlToggleColsPop(force) {
        const pop = $('xl-cols-pop');
        const btn = $('xl-cols-btn');
        if (!pop) return;
        const open = typeof force === 'boolean' ? force : pop.classList.contains('hidden');
        pop.classList.toggle('hidden', !open);
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
            return `<li class="${isHidden ? 'is-hidden' : ''}" data-label="${esc(label)}">
                <label><input type="checkbox" data-xl-toggle${isHidden ? '' : ' checked'}${!isHidden && shownCount <= 1 ? ' disabled' : ''}><span>${esc(name)}</span>${letter}</label>
                <button type="button" data-xl-move="-1" aria-label="Move ${esc(name)} left"${index === 0 ? ' disabled' : ''}>&#8593;</button>
                <button type="button" data-xl-move="1" aria-label="Move ${esc(name)} right"${index === ordered.length - 1 ? ' disabled' : ''}>&#8595;</button>
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
        if (kind === 'delivered') return 'is-ok';
        if (kind === 'proforma') return 'is-info';
        return 'is-none';
    }
    function openSoldDetail(vin) {
        const item = sold.find((row) => String(row.vin || '').toUpperCase() === String(vin || '').toUpperCase());
        if (!item) return;
        const rtlFields = (item.rtlRow || []).map((field) => `<div><span>${esc(field.label)}</span><b>${esc(field.value)}</b></div>`).join('');
        const salesFields = (item.salesRow || []).map((field) => `<div><span>${esc(field.label)}</span><b>${esc(field.value)}</b></div>`).join('');
        $('drawer').classList.remove('hidden');
        $('drawer').innerHTML = `<button class="ghost" id="close-drawer" type="button">Close</button>
            <h2>Sold VIN ${esc(item.vin || '')}</h2>
            <p><span class="s-pill ${soldTone(item.soldKind)}">${esc(item.soldLabel || item.soldKind || 'Sold')}</span>
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
            <div class="mkt-fields">${rtlFields || `<div><span>RTL</span><b>${esc(item.rtlDescription || 'No RTL row captured')}</b></div>`}</div>
            <h3>Sales Raw row</h3>
            <div class="mkt-fields">${salesFields || `<div><span>Sales Raw</span><b>${esc(item.salesDescription || 'No Sales Raw row captured')}</b></div>`}</div>`;
        $('close-drawer').addEventListener('click', () => $('drawer').classList.add('hidden'));
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
                <td><span class="s-pill ${soldTone(item.soldKind)}">${esc(item.soldLabel || item.soldKind || 'Sold')}</span></td>
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
                    : `<button class="ghost" type="button" data-remove-status="${esc(item)}">Remove</button>`}
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
            return `<label class="pn-row${group.recordId ? '' : ' is-locked'}" data-record="${esc(group.recordId)}" data-key="${esc(group.key)}">
                <input type="checkbox" class="pn-check"${group.recordId ? ' checked' : ' disabled'}>
                <span class="pn-name"><b dir="auto">${esc(group.name)}</b>${group.recordId ? '' : '<small>No login account in Employees, cannot be notified</small>'}${last}</span>
                <span class="pn-count"><b>${group.orders.length}</b> pending${group.expired ? ` · <em>${group.expired} expired</em>` : ''}</span>
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
        modal.classList.remove('hidden');
        paintPendingModal();
    }
    function closePendingModal() {
        const modal = $('pending-modal');
        if (modal) modal.classList.add('hidden');
    }
    async function sendPendingNotices() {
        const send = $('pending-send');
        const error = $('pending-error');
        const intro = ($('pending-intro') && $('pending-intro').value.trim()) || 'Please update the status of your reserved orders on the Reserved Orders page.';
        const groups = pendingGroups($('pending-expired-only') && $('pending-expired-only').checked);
        const chosen = Array.from(document.querySelectorAll('#pending-list .pn-row')).filter((row) => {
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
        if (send) { send.textContent = 'Notify selected'; }
        paintPendingModal();
        if (error) {
            error.classList.toggle('ok', !failed.length);
            error.textContent = failed.length
                ? `Sent to ${sent}. Could not notify: ${failed.join(', ')}.`
                : `Notified ${sent} employee${sent === 1 ? '' : 's'}. They see it on their Reserved Orders page and as a laptop alert if enabled.`;
        }
    }
    document.addEventListener('click', (event) => {
        if (event.target.closest('[data-notify-pending]')) { openPendingModal(); return; }
        const modal = $('pending-modal');
        if (!modal || modal.classList.contains('hidden')) return;
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
            selectEl.disabled = true;
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
            selectEl.dataset.prev = status;
            selectEl.classList.add('is-saved');
            setTimeout(() => selectEl.classList.remove('is-saved'), 900);
            renderOrders();
            renderSalesTypes();
            renderSheet();
        } catch (e) {
            if (selectEl.dataset.prev != null) selectEl.value = selectEl.dataset.prev;
            if (e.message !== 'unauthorized') alert(e.message || 'Could not update status.');
        } finally {
            selectEl.disabled = false;
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