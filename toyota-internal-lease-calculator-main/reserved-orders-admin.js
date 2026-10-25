(function () {
    const STATUSES = ['تم الفوترة', 'الغاء', 'موظف', 'محجوز', 'انتظار تحويل', 'انتظار رد الضيف', 'efc', 'b2c', 'التزام زميل اخر', 'DB', 'ابيان', 'ان اساين'];
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
    function remain(order) {
        const end = parseLocal(orderDeadline(order));
        if (!end) return 'NO ASSIGN DATE';
        const ms = end.getTime() - Date.now();
        if (ms <= 0) return 'EXPIRED';
        const total = Math.floor(ms / 1000);
        return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
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
    const SHEET_NAMES = { F: 'Order', I: 'Model', J: 'Suffix', K: 'Model year', L: 'VIN', M: 'Ext', N: 'Int', R: 'Vehicle status', S: 'Customer', T: 'Salesman', U: 'Sales type' };
    // Reserved Order File uses a different Excel layout than E-Sales — never reuse SHEET_NAMES above.
    const RESERVED_SHEET_NAMES = {
        A: 'Area', B: 'Name', C: 'Order NO.', D: 'Model Year', E: 'Product',
        F: 'SFX', G: 'Exterior Color', H: 'Interior Color', I: 'VIN', J: 'Expiry'
    };
    const RESERVED_COL_ORDER = ['B', 'C', 'I', 'E', 'D', 'F', 'G', 'H', 'J'];
    const MERGED_COL_ORDER = ['Source', 'VIN', 'Order', 'Customer', 'Product', 'Model Year', 'SFX', 'Exterior', 'Interior', 'Advisor', 'Payment', 'Area'];
    let salesTypePick = null; // nothing listed until a card is clicked
    let showNoVinRows = false;
    let sheetSource = 'esales';
    const SHEET_NOTES = {
        esales: 'Columns and rows from the Stock E-Sales push. BO ahead shows the first 3 orders in front in the same Back Order product / suffix / color queue.',
        reserved: 'Columns and rows from the Reserved Order File push. BO ahead uses the same Back Order queue rules as BO Order Lookup.',
        merged: 'One row per VIN. If the VIN is in both files, Stock E-Sales info is kept and only Expiry comes from the Reserved Order File. Reserved-only rows stay separate.'
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
                Area: ''
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
                Area: firstReal(order.searchArea, fieldValueFromList(esales, 'B'), fieldValueFromList(esales, 'A'))
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
        const end = parseLocal(order.deadline);
        if (!end) return 'No assign date';
        return end.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function expiryCells(order) {
        if (!EXPIRY_TYPES.has(salesTypeOf(order))) return '<td class="st-na">—</td><td class="st-na">—</td>';
        return `<td>${esc(expiryText(order))}</td><td class="timer-cell st-timer" data-deadline="${esc(order.deadline || '')}">${esc(remain(order))}</td>`;
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
            list.map((order) => `<tr data-open="${esc(order.key)}" class="st-row">
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
            return `<tr>
            <td>#${order.queueNumber == null ? '—' : order.queueNumber}</td>
            <td>${esc(order.orderNumber || 'NO ORDER')}</td>
            <td>${esc(order.vin || 'VIN NOT FOUND')}</td>
            <td>${esc(order.salesAdvisor || 'UNASSIGNED')}</td>
            <td>${paymentCell(order)}</td>
            <td class="col-status">${statusSelectHtml(order)}</td>
            <td class="timer-cell" data-deadline="${esc(deadline)}">${esc(remain(order))}</td>
            <td>${order.leaderNote || (order.teamNotes && order.teamNotes.length) ? '<span class="s-pill is-info" title="Has notes">Notes</span> ' : ''}<button class="ghost" type="button" data-open="${esc(order.key)}">View</button></td>
        </tr>`;
        }).join('');
    }
    function openOrder(key) {
        const order = orders.find((item) => item.key === key);
        if (!order) return;
        const history = (order.history || []).map((item) => `<div><b>${esc(item.changedDisplay || item.changedAt)}</b><br>${esc(item.oldStatus || '')} → ${esc(item.status)} · ${esc(item.changedBy)} · ${esc(item.employeeNumber || '')}</div>`).join('') || '<div>No status changes yet</div>';
        const related = audit.filter((event) => event.vin === order.vin || event.orderNumber === order.orderNumber).slice(0, 30);
        const teamNotes = (order.teamNotes || []).map((note) => `<div class="note-item"><header><b>${esc(note.by || 'Team')}</b><span>${esc(note.updatedDisplay || note.display || '')}</span></header><p dir="auto">${esc(note.text || '')}</p></div>`).join('') || '<div class="muted">No team notes yet.</div>';
        $('drawer').classList.remove('hidden');
        $('drawer').innerHTML = `<button class="ghost" id="close-drawer" type="button">Close</button>
            <h2>Order #${esc(order.orderNumber || 'NO ORDER')}</h2>
            <p>${esc(order.vin)} · ${esc(order.vehicle || '')}<br>Status ${esc(order.status)} · Queue #${order.queueNumber == null ? '—' : order.queueNumber}<br>Deadline ${esc(order.deadline || 'NO ASSIGN DATE')}</p>
            <h3>Leader note</h3>
            <p class="muted">Visible to the whole team on the employee page.</p>
            <textarea id="leader-note-input" rows="4" maxlength="2000" placeholder="Write a leader note for this order">${esc(order.leaderNote || '')}</textarea>
            <div style="display:flex;gap:8px;margin:8px 0 16px;align-items:center;">
                <button class="solid" type="button" id="leader-note-save">Save leader note</button>
                <button class="ghost" type="button" id="leader-note-clear">Clear</button>
                <span class="muted" id="leader-note-feedback"></span>
            </div>
            <h3>Team notes</h3>
            <div class="mkt-fields">${teamNotes}</div>
            <h3>Status history</h3>${history}
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
            const meta = ['Queue', 'Status', 'BO ahead', 'Expiry'];
            const titles = { Expiry: 'Expiry', Source: 'Source' };
            MERGED_COL_ORDER.forEach((label) => { titles[label] = label; });
            // Keep every merged column so non-duplicate rows with blanks still appear.
            return { cols: meta.concat(MERGED_COL_ORDER), titles };
        }
        const meta = source === 'reserved'
            ? ['Queue', 'Status', 'BO ahead', 'Expiry']
            : ['Queue', 'Status', 'BO ahead', 'Updated by', 'Updated at'];
        const titles = {};
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
        }
        if (!excel.length) {
            return source === 'reserved'
                ? meta.concat(['Order', 'VIN', 'Product', 'Model Year'])
                : meta.concat(['Order', 'VIN', 'Advisor', 'Payment', 'Deadline']);
        }
        return { cols: meta.concat(excel), titles };
    }
    function sheetValue(order, label, source) {
        if (label === 'Queue') return order.queueNumber == null ? '' : String(order.queueNumber);
        if (label === 'Status') return order.status || '';
        if (label === 'BO ahead') return aheadText(order);
        if (label === 'Updated by') return order.statusChangedBy || '';
        if (label === 'Updated at') return order.statusChangedAt ? (parseLocal(order.statusChangedAt) ? parseLocal(order.statusChangedAt).toLocaleString() : order.statusChangedAt) : '';
        if (label === 'Expiry') {
            if (source === 'merged') return order.mergedExpiry || '';
            if (order.expiryDisplay) return order.expiryDisplay;
            if (order.expiryDate) {
                const parsed = parseLocal(order.expiryDate);
                return parsed ? parsed.toLocaleDateString('en-GB') : order.expiryDate;
            }
            const j = orderSheetFields(order, source).find((item) => String(item.col || '').toUpperCase() === 'J');
            return j && j.value != null && j.value !== '—' ? String(j.value) : '';
        }
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
        const field = orderSheetFields(order, source).find((item) => String(item.col || '').toUpperCase() === String(label || '').toUpperCase()
            || (item.label || item.col) === label);
        return field && field.value != null ? String(field.value) : '';
    }
    function setSheetSource(next) {
        sheetSource = next === 'reserved' || next === 'merged' ? next : 'esales';
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
        renderSheet();
    }
    function renderOneSheet(box, source, list) {
        if (!box) return;
        const needle = ($('sheet-search') && $('sheet-search').value || '').trim().toLowerCase();
        const packed = sheetColumns(list, source);
        const cols = Array.isArray(packed) ? packed : packed.cols;
        const titles = Array.isArray(packed) ? {} : (packed.titles || {});
        const noVin = list.filter((order) => !hasVin(order)).length;
        // Merged sheet keeps non-duplicate rows even when some fields are empty.
        const visible = source === 'merged'
            ? (showNoVinRows ? list : list.filter((order) => hasVin(order) || orderInSheet(order, 'esales') || orderInSheet(order, 'reserved')))
            : (showNoVinRows ? list : list.filter(hasVin));
        const rows = visible.filter((order) => !needle || cols.some((label) => sheetValue(order, label, source).toLowerCase().includes(needle)));
        const head = (label) => {
            const named = source === 'merged'
                ? (titles[label] || label)
                : source === 'reserved'
                    ? (titles[label] || RESERVED_SHEET_NAMES[label] || label)
                    : (SHEET_NAMES[label] || titles[label] || label);
            if (/^[A-Z]{1,3}$/.test(label) && named && source !== 'merged') {
                return `<th title="Column ${esc(label)}"><span class="col-letter">${esc(label)}</span>${esc(named)}</th>`;
            }
            return `<th>${esc(named || label)}</th>`;
        };
        const cell = (order, label) => {
            const value = sheetValue(order, label, source);
            if (label === 'Status') {
                if (source === 'merged' && order.key) {
                    return `<td class="col-status">${statusSelectHtml(order)}</td>`;
                }
                return `<td class="col-status">${statusPill(value)}</td>`;
            }
            if (label === 'Queue') return `<td class="col-queue">${value ? `<span class="q-pill">#${esc(value)}</span>` : ''}</td>`;
            if (label === 'BO ahead') return aheadCellHtml(order);
            if (label === 'Source') {
                const tone = value === 'Both' ? 'is-both' : value === 'Reserved' ? 'is-reserved' : 'is-esales';
                return `<td class="col-source"><span class="source-pill ${tone}">${esc(value || '—')}</span></td>`;
            }
            if (label === 'U' && value) {
                const st = /^\d$/.test(value) ? '0' + value : value;
                return `<td><span class="st-type">${esc(st)}</span></td>`;
            }
            return `<td>${esc(value)}</td>`;
        };
        const emptyMsg = source === 'merged'
            ? 'No merged rows yet. Push Stock E-Sales and/or the Reserved Order File.'
            : source === 'reserved'
                ? 'No Reserved Order File rows yet. Push the Reserved Order File on Data push.'
                : 'No Stock E-Sales rows yet. Push Stock E-Sales to fill this sheet.';
        const note = noVin ? `<div class="sheet-novin">${noVin} row${noVin === 1 ? '' : 's'} without a VIN ${showNoVinRows ? 'shown' : 'hidden'} (totals or extra tables in the file) <button type="button" class="ghost sheet-novin-toggle">${showNoVinRows ? 'Hide them' : 'Show them'}</button></div>` : '';
        box.innerHTML = rows.length
            ? `${note}<table><thead><tr>${cols.map(head).join('')}</tr></thead><tbody>${rows.map((order) => `<tr class="${hasVin(order) ? '' : 'is-novin'}">${cols.map((label) => cell(order, label)).join('')}</tr>`).join('')}</tbody></table>`
            : `${note}<p class="empty">${emptyMsg}</p>`;
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
    function renderAll() { renderOverview(); renderOrders(); renderSold(); renderSheet(); renderStaff(); renderArchive(); renderAudit(); renderReport(); renderAlerts(); renderMarketing(); }

    async function refresh() {
        const data = await api('/api/reserved-orders/admin?password=' + encodeURIComponent(password()));
        orders = data.orders || [];
        sold = data.sold || [];
        staff = data.staff || [];
        archive = data.archive || [];
        report = data.report || {};
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
            if (!end) { cell.textContent = 'NO ASSIGN DATE'; return; }
            const ms = end.getTime() - Date.now();
            if (ms <= 0) { cell.textContent = 'EXPIRED'; return; }
            const total = Math.floor(ms / 1000);
            cell.textContent = `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
        });
    }, 1000);
    if ($('sheet-search')) $('sheet-search').addEventListener('input', renderSheet);
    document.querySelectorAll('.sheet-source').forEach((button) => {
        button.addEventListener('click', () => setSheetSource(button.dataset.sheet));
    });
    ['live-sheet-esales', 'live-sheet-reserved', 'live-sheet-merged'].forEach((id) => {
        const box = $(id);
        if (!box) return;
        box.addEventListener('click', (event) => {
            if (!event.target.closest('.sheet-novin-toggle')) return;
            showNoVinRows = !showNoVinRows;
            renderSheet();
        });
    });
    async function adminSetStatus(key, status, selectEl) {
        if (!key || !status) return;
        try {
            selectEl.disabled = true;
            await api('/api/reserved-orders/admin/status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password(), key, status })
            });
            const order = orders.find((item) => item.key === key);
            if (order) {
                order.status = status;
                order.statusChangedBy = 'Admin';
                order.statusChangedAt = new Date().toISOString().slice(0, 19);
            }
            selectEl.dataset.prev = status;
            selectEl.classList.add('is-saved');
            setTimeout(() => selectEl.classList.remove('is-saved'), 900);
            renderOrders();
            renderSalesTypes();
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