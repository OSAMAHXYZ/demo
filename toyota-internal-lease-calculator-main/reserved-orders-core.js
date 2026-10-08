/**
 * Reserved Orders dataset builder.
 * Queue ranking is a replaceable stand-in — swap calculateQueueNumber
 * when the real queue algorithm is provided. Do not hardcode queue numbers.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const STATUSES = [
    'تم الفوترة',
    'الغاء',
    'موظف',
    'محجوز',
    'انتظار تحويل',
    'انتظار رد الضيف',
    'efc',
    'b2c',
    'التزام زميل اخر',
    'DB',
    'ابيان',
    'ان اساين'
];

const STATUS_SET = new Set(STATUSES.map((s) => s.toLowerCase()));

const COL = { order: 5, product: 8, suffix: 9, vin: 11, exterior: 12, interior: 13 };

function pad2(n) {
    return String(n).padStart(2, '0');
}

function localStamp(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function displayStamp(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    let h = date.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(h)}:${pad2(date.getMinutes())} ${ap}`;
}

function parseLocalStamp(value) {
    const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (date.getFullYear() !== +m[1] || date.getMonth() !== +m[2] - 1 || date.getDate() !== +m[3]) return null;
    return date;
}

function parseDottedDmy(value) {
    if (typeof value !== 'string') return null;
    const s = value.trim();
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp][Mm]))?)?$/);
    if (!m) return null;
    const day = +m[1];
    const month = +m[2];
    const year = +m[3];
    let hh = m[4] != null ? +m[4] : 0;
    const mi = m[5] != null ? +m[5] : 0;
    const ss = m[6] != null ? +m[6] : 0;
    const ap = (m[7] || '').toLowerCase();
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    if (month < 1 || month > 12 || day < 1 || day > 31 || hh > 23 || mi > 59 || ss > 59) return null;
    const date = new Date(year, month - 1, day, hh, mi, ss);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
}

function serialToLocalDate(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 20000 || n > 80000) return null;
    const utc = new Date(Math.round((n - 25569) * 86400 * 1000));
    if (Number.isNaN(utc.getTime())) return null;
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds());
}

function parseExcelDate(value) {
    if (value == null || value === '') return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return new Date(value.getFullYear(), value.getMonth(), value.getDate(), value.getHours(), value.getMinutes(), value.getSeconds());
    }
    if (typeof value === 'number') return serialToLocalDate(value);
    const text = String(value).trim();
    if (!text) return null;
    const dotted = parseDottedDmy(text);
    if (dotted) return dotted;
    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (slash) {
        const day = +slash[1];
        const month = +slash[2];
        const year = +slash[3];
        const hh = slash[4] != null ? +slash[4] : 0;
        const mi = slash[5] != null ? +slash[5] : 0;
        const ss = slash[6] != null ? +slash[6] : 0;
        const date = new Date(year, month - 1, day, hh, mi, ss);
        if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    }
    if (/^\d+(\.\d+)?$/.test(text)) return serialToLocalDate(Number(text));
    return null;
}

function normalizeVin(value) {
    return String(value == null ? '' : value).trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(value) {
    const text = String(value == null ? '' : value).trim();
    return text;
}

function normalizePayment(value) {
    const raw = cleanText(value);
    if (!raw) return { kind: 'unknown', label: 'UNKNOWN', hours: 48 };
    const folded = raw.toLowerCase().replace(/[_./-]+/g, ' ').replace(/\s+/g, ' ').trim();
    const bank = /\b(bank|banking|finance|financing|loan|credit)\b|تمويل|بنك|مصرف/.test(folded);
    const cash = /\b(cash|cod)\b|نقد/.test(folded);
    if (bank && !cash) return { kind: 'bank', label: raw, hours: 72 };
    if (cash) return { kind: 'cash', label: raw, hours: 48 };
    return { kind: 'other', label: raw, hours: 48 };
}

function normalizeStatus(value) {
    const text = cleanText(value);
    if (!text) return 'محجوز';
    const hit = STATUSES.find((s) => s.toLowerCase() === text.toLowerCase());
    return hit || 'محجوز';
}

function unzip(buffer) {
    const files = new Map();
    let eocd = -1;
    const start = Math.max(0, buffer.length - 66000);
    for (let i = buffer.length - 22; i >= start; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Could not read the Excel file.');
    const count = buffer.readUInt16LE(eocd + 10);
    let cursor = buffer.readUInt32LE(eocd + 16);
    for (let n = 0; n < count; n++) {
        if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
        const method = buffer.readUInt16LE(cursor + 10);
        const compSize = buffer.readUInt32LE(cursor + 20);
        const nameLen = buffer.readUInt16LE(cursor + 28);
        const extraLen = buffer.readUInt16LE(cursor + 30);
        const commentLen = buffer.readUInt16LE(cursor + 32);
        const localOffset = buffer.readUInt32LE(cursor + 42);
        const name = buffer.slice(cursor + 46, cursor + 46 + nameLen).toString('utf8');
        const localNameLen = buffer.readUInt16LE(localOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressed = buffer.slice(dataStart, dataStart + compSize);
        const raw = method === 0 ? compressed : zlib.inflateRawSync(compressed);
        files.set(name.replace(/\\/g, '/'), raw);
        cursor += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

function xmlText(value) {
    return String(value || '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function columnIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

function sharedStrings(xml) {
    const out = [];
    String(xml || '').split(/<si\b[^>]*>/).slice(1).forEach((block) => {
        const body = block.split('</si>')[0];
        const parts = [];
        const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let match;
        while ((match = re.exec(body))) parts.push(xmlText(match[1]));
        out.push(parts.join(''));
    });
    return out;
}

function parseSheetXml(xml, strings) {
    const rows = [];
    const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(xml))) {
        const row = [];
        const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cellMatch;
        while ((cellMatch = cellRe.exec(rowMatch[2]))) {
            const attrs = cellMatch[1];
            const body = cellMatch[2] || '';
            const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
            if (!ref) continue;
            const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
            let value = '';
            if (type === 'inlineStr') {
                const parts = [];
                const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
                let text;
                while ((text = re.exec(body))) parts.push(xmlText(text[1]));
                value = parts.join('');
            } else {
                const raw = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
                if (raw == null) value = '';
                else if (type === 's') value = strings[Number(raw)] || '';
                else if (type === 'str') value = xmlText(raw);
                else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
                else value = xmlText(raw);
            }
            row[columnIndex(ref)] = value;
        }
        rows[Number(rowMatch[1]) - 1] = row;
    }
    return rows.map((row) => row || []);
}

function readXlsxGrids(buffer) {
    const files = unzip(buffer);
    const workbook = files.get('xl/workbook.xml');
    if (!workbook) throw new Error('Could not read the Excel workbook.');
    const workbookXml = workbook.toString('utf8');
    const rels = (files.get('xl/_rels/workbook.xml.rels') || Buffer.from('')).toString('utf8');
    const strings = sharedStrings((files.get('xl/sharedStrings.xml') || Buffer.from('')).toString('utf8'));
    const targets = new Map();
    const relRe = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"/g;
    let rel;
    while ((rel = relRe.exec(rels))) targets.set(rel[1], rel[2]);
    const sheets = [];
    const sheetRe = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"/g;
    let sheet;
    while ((sheet = sheetRe.exec(workbookXml))) {
        const target = String(targets.get(sheet[2]) || '').replace(/^\/?xl\//, '');
        const path = target.startsWith('xl/') ? target : `xl/${target}`;
        const xml = files.get(path);
        sheets.push({ name: xmlText(sheet[1]), grid: xml ? parseSheetXml(xml.toString('utf8'), strings) : [] });
    }
    return sheets;
}

function parseCsvGrid(buffer) {
    let text = buffer.toString('utf8');
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.toString('utf16le');
    else if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i += 1; }
                else quoted = false;
            } else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',' || ch === '\t' || ch === ';') { row.push(cell); cell = ''; }
        else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

function sheetGridsFromBuffer(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return readXlsxGrids(buf);
    return [{ name: 'المحجوز E-Sales', grid: parseCsvGrid(buf) }];
}

function pickReservedSheet(sheets) {
    let best = null;
    let bestScore = 0;
    (sheets || []).forEach((sheet) => {
        const name = String(sheet.name || '').toLowerCase().replace(/\s+/g, ' ');
        const reserved = name.includes('المحجوز') || name.includes('محجوز');
        const esales = name.includes('e-sales') || name.includes('esales') || name.includes('e sales');
        const score = reserved && esales ? 2 : reserved ? 1 : 0;
        if (score > bestScore) {
            best = sheet;
            bestScore = score;
        }
    });
    return best;
}

function headerText(value) {
    return String(value == null ? '' : value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function findHeaderIndex(patterns, headers) {
    for (let i = 0; i < headers.length; i++) {
        const text = headerText(headers[i]);
        if (!text) continue;
        if (patterns.some((p) => p.test(text))) return i;
    }
    return -1;
}

function detectHeaderRow(grid) {
    const limit = Math.min(grid.length, 40);
    for (let r = 0; r < limit; r++) {
        const row = grid[r] || [];
        const joined = row.map((cell) => headerText(cell)).join(' | ');
        if (/vin|chassis|order|payment|advisor|assign|created|customer/.test(joined) || joined.includes('محجوز') || joined.includes('طلب')) {
            return r;
        }
    }
    return 0;
}

function cell(row, index) {
    if (index == null || index < 0) return '';
    return (row || [])[index];
}

function extractReservedRows(grid) {
    const headerIdx = detectHeaderRow(grid);
    const headers = grid[headerIdx] || [];
    const vinCol = findHeaderIndex([/\bvin\b/, /chassis/, /رقم الهيكل/], headers);
    const orderCol = findHeaderIndex([/order\s*(no|number|#)?/, /sales\s*order/, /رقم الطلب/, /^bo$/], headers);
    const productCol = findHeaderIndex([/product/, /model/, /vehicle/, /car/], headers);
    const suffixCol = findHeaderIndex([/suffix/, /\bsfx\b/], headers);
    const exteriorCol = findHeaderIndex([/exterior/, /ext(erior)?\s*color/, /ext colour/], headers);
    const interiorCol = findHeaderIndex([/interior/, /int(erior)?\s*color/], headers);
    const yearCol = findHeaderIndex([/model\s*year/, /\byear\b/, /سنة/], headers);
    const advisorCol = findHeaderIndex([/sales\s*advisor/, /advisor/, /salesman/, /consultant/, /مستشار/], headers);
    const customerCol = findHeaderIndex([/customer\s*name/, /customer/, /guest/, /العميل/], headers);
    const createdCol = findHeaderIndex([/created\s*date/, /order\s*created/, /order\s*date/, /creation/], headers);
    const assignCol = findHeaderIndex([/assign(?:ment|ed)?\s*date/, /order\s*assign/, /allocation\s*date/], headers);
    const paymentCol = findHeaderIndex([/payment\s*type/, /payment/, /finance\s*type/, /طريقة الدفع/], headers);
    const statusCol = findHeaderIndex([/^status$/, /current\s*status/, /الحالة/], headers);

    const rows = [];
    for (let r = headerIdx + 1; r < grid.length; r++) {
        const line = grid[r] || [];
        if (!line.some((v) => cleanText(v))) continue;
        rows.push({
            rowIndex: r + 1,
            vin: cell(line, vinCol >= 0 ? vinCol : COL.vin),
            orderNumber: cell(line, orderCol >= 0 ? orderCol : COL.order),
            vehicle: cell(line, productCol >= 0 ? productCol : COL.product),
            suffix: cell(line, suffixCol >= 0 ? suffixCol : COL.suffix),
            exterior: cell(line, exteriorCol >= 0 ? exteriorCol : COL.exterior),
            interior: cell(line, interiorCol >= 0 ? interiorCol : COL.interior),
            modelYear: yearCol >= 0 ? cell(line, yearCol) : '',
            salesAdvisor: advisorCol >= 0 ? cell(line, advisorCol) : '',
            customerName: customerCol >= 0 ? cell(line, customerCol) : '',
            createdRaw: createdCol >= 0 ? cell(line, createdCol) : '',
            assignRaw: assignCol >= 0 ? cell(line, assignCol) : '',
            paymentRaw: paymentCol >= 0 ? cell(line, paymentCol) : '',
            statusRaw: statusCol >= 0 ? cell(line, statusCol) : ''
        });
    }
    return { headerIdx, rows };
}

function boColumn(headers, patterns) {
    return findHeaderIndex(patterns, headers);
}

function indexBackOrder(boRows, boHeaders) {
    const headers = boHeaders && boHeaders.length ? boHeaders : Object.keys((boRows && boRows[0]) || {});
    const vinCol = boColumn(headers, [/\bvin\b/, /chassis/, /رقم الهيكل/]);
    const orderCol = boColumn(headers, [/order\s*(no|number|#)?/, /sales\s*order/, /رقم الطلب/]);
    const advisorCol = boColumn(headers, [/sales\s*advisor/, /advisor/, /salesman/, /consultant/]);
    const customerCol = boColumn(headers, [/customer\s*name/, /customer/, /guest/]);
    const paymentCol = boColumn(headers, [/payment\s*type/, /payment/, /finance/]);
    const assignCol = boColumn(headers, [/assign(?:ment|ed)?\s*date/, /order\s*assign/, /allocation\s*date/]);
    const createdCol = boColumn(headers, [/created\s*date/, /order\s*created/, /reservation/]);
    const vehicleCol = boColumn(headers, [/product/, /model/, /vehicle/]);
    const yearCol = boColumn(headers, [/model\s*year/, /\byear\b/]);
    const exteriorCol = boColumn(headers, [/exterior/, /ext(erior)?\s*color/]);
    const interiorCol = boColumn(headers, [/interior/, /int(erior)?\s*color/]);
    const byVin = new Map();
    const byOrder = new Map();

    function read(row, index, key) {
        if (index >= 0 && headers[index] != null && row[headers[index]] != null && row[headers[index]] !== '') return row[headers[index]];
        if (row[key] != null && row[key] !== '') return row[key];
        return '';
    }

    (boRows || []).forEach((row, index) => {
        const item = {
            index,
            vin: normalizeVin(read(row, vinCol, 'vin')),
            orderNumber: cleanText(read(row, orderCol, 'orderNumber')),
            salesAdvisor: cleanText(read(row, advisorCol, 'salesAdvisor')),
            customerName: cleanText(read(row, customerCol, 'customerName')),
            paymentRaw: read(row, paymentCol, 'payment'),
            assignRaw: read(row, assignCol, 'assignDate'),
            createdRaw: read(row, createdCol, 'createdDate'),
            vehicle: cleanText(read(row, vehicleCol, 'vehicle')),
            modelYear: cleanText(read(row, yearCol, 'modelYear')),
            exterior: cleanText(read(row, exteriorCol, 'exterior')),
            interior: cleanText(read(row, interiorCol, 'interior'))
        };
        if (item.vin) byVin.set(item.vin, item);
        if (item.orderNumber) byOrder.set(item.orderNumber.toLowerCase(), item);
    });
    return { byVin, byOrder };
}

function prefer(primary, fallback) {
    const a = cleanText(primary);
    return a || cleanText(fallback);
}

function compareQueuePlaceholder(a, b) {
    const ad = parseLocalStamp(a.assignDate);
    const bd = parseLocalStamp(b.assignDate);
    if (ad && bd && ad.getTime() !== bd.getTime()) return ad.getTime() - bd.getTime();
    if (ad && !bd) return -1;
    if (!ad && bd) return 1;
    return String(a.vin || '').localeCompare(String(b.vin || ''));
}

const queueRankCache = new WeakMap();

/**
 * Temporary queue rank. Replace this whole function with the real algorithm.
 * Stand-in: earlier Order Assign Date ranks first; missing dates go last; VIN breaks ties.
 * Returns a 1-based position. It does not invent a fixed queue number.
 */
function calculateQueueNumber(order, allOrders) {
    let ranked = queueRankCache.get(allOrders);
    if (!ranked) {
        ranked = allOrders.slice().sort(compareQueuePlaceholder);
        queueRankCache.set(allOrders, ranked);
    }
    const index = ranked.findIndex((item) => item.key === order.key);
    return index < 0 ? null : index + 1;
}

function applyQueue(orders) {
    const list = orders.map((order) => ({ ...order, queueNumber: calculateQueueNumber(order, orders) }));
    return list.map((order) => {
        const ahead = list
            .filter((item) => item.queueNumber != null && order.queueNumber != null && item.queueNumber < order.queueNumber)
            .sort((a, b) => b.queueNumber - a.queueNumber)
            .slice(0, 3)
            .sort((a, b) => a.queueNumber - b.queueNumber)
            .map((item) => ({
                queueNumber: item.queueNumber,
                orderNumber: item.orderNumber,
                vin: item.vin,
                vehicle: item.vehicle,
                salesAdvisor: item.salesAdvisor,
                paymentLabel: item.paymentLabel
            }));
        return { ...order, ahead };
    });
}

function buildReservedDataset({ sheets, boRows, boHeaders, previous }) {
    const sheet = pickReservedSheet(sheets);
    if (!sheet) {
        return {
            ok: false,
            error: 'Reserved sheet not found. Expected a sheet named المحجوز E-Sales.',
            orders: [],
            report: emptyReport()
        };
    }
    const extracted = extractReservedRows(sheet.grid || []);
    const backOrder = indexBackOrder(boRows, boHeaders);
    const previousByKey = new Map();
    (previous || []).forEach((order) => {
        if (order && order.key) previousByKey.set(order.key, order);
        if (order && order.vin) previousByKey.set(`vin:${order.vin}`, order);
    });

    const byVin = new Map();
    const noVin = [];
    let duplicateVinRows = 0;
    let missingVin = 0;

    extracted.rows.forEach((row) => {
        const vin = normalizeVin(row.vin);
        const bo = (vin && backOrder.byVin.get(vin)) || backOrder.byOrder.get(cleanText(row.orderNumber).toLowerCase()) || null;
        if (!vin) {
            missingVin += 1;
            noVin.push(row);
            return;
        }
        const assign = parseExcelDate(prefer(row.assignRaw, bo && bo.assignRaw));
        const created = parseExcelDate(prefer(row.createdRaw, bo && bo.createdRaw));
        const payment = normalizePayment(prefer(row.paymentRaw, bo && bo.paymentRaw));
        const key = `vin:${vin}`;
        const prev = previousByKey.get(key);
        const record = {
            key,
            vin,
            orderNumber: prefer(row.orderNumber, bo && bo.orderNumber) || 'NO ORDER',
            salesAdvisor: prefer(row.salesAdvisor, bo && bo.salesAdvisor) || 'UNASSIGNED',
            customerName: prefer(row.customerName, bo && bo.customerName),
            vehicle: [prefer(row.vehicle, bo && bo.vehicle), cleanText(row.suffix)].filter(Boolean).join(' ').trim(),
            modelYear: prefer(row.modelYear, bo && bo.modelYear),
            exterior: prefer(row.exterior, bo && bo.exterior),
            interior: prefer(row.interior, bo && bo.interior),
            createdDate: localStamp(created),
            createdDisplay: displayStamp(created),
            assignDate: localStamp(assign),
            assignDisplay: displayStamp(assign),
            paymentKind: payment.kind,
            paymentLabel: payment.kind === 'unknown' ? 'UNKNOWN' : payment.label,
            paymentHours: payment.hours,
            deadline: assign ? localStamp(new Date(assign.getTime() + payment.hours * 3600000)) : '',
            status: prev ? normalizeStatus(prev.status) : normalizeStatus(row.statusRaw),
            statusChangedBy: prev ? prev.statusChangedBy || '' : '',
            statusChangedAt: prev ? prev.statusChangedAt || '' : '',
            history: Array.isArray(prev && prev.history) ? prev.history : [],
            matchedBackOrder: Boolean(bo),
            sourceRow: row.rowIndex
        };
        if (byVin.has(vin)) duplicateVinRows += 1;
        const existing = byVin.get(vin);
        if (!existing || record.sourceRow >= existing.sourceRow) byVin.set(vin, record);
    });

    noVin.forEach((row, index) => {
        const orderNumber = cleanText(row.orderNumber);
        const bo = backOrder.byOrder.get(orderNumber.toLowerCase()) || null;
        const assign = parseExcelDate(prefer(row.assignRaw, bo && bo.assignRaw));
        const created = parseExcelDate(prefer(row.createdRaw, bo && bo.createdRaw));
        const payment = normalizePayment(prefer(row.paymentRaw, bo && bo.paymentRaw));
        const key = orderNumber ? `order:${orderNumber.toLowerCase()}` : `missing:${index}`;
        const prev = previousByKey.get(key);
        if (byVin.has(key)) return;
        noVinKeysSet(byVin, key, {
            key,
            vin: 'VIN NOT FOUND',
            orderNumber: orderNumber || (bo && bo.orderNumber) || 'NO ORDER',
            salesAdvisor: prefer(row.salesAdvisor, bo && bo.salesAdvisor) || 'UNASSIGNED',
            customerName: prefer(row.customerName, bo && bo.customerName),
            vehicle: [prefer(row.vehicle, bo && bo.vehicle), cleanText(row.suffix)].filter(Boolean).join(' ').trim(),
            modelYear: prefer(row.modelYear, bo && bo.modelYear),
            exterior: prefer(row.exterior, bo && bo.exterior),
            interior: prefer(row.interior, bo && bo.interior),
            createdDate: localStamp(created),
            createdDisplay: displayStamp(created),
            assignDate: localStamp(assign),
            assignDisplay: displayStamp(assign),
            paymentKind: payment.kind,
            paymentLabel: payment.kind === 'unknown' ? 'UNKNOWN' : payment.label,
            paymentHours: payment.hours,
            deadline: assign ? localStamp(new Date(assign.getTime() + payment.hours * 3600000)) : '',
            status: prev ? normalizeStatus(prev.status) : normalizeStatus(row.statusRaw),
            statusChangedBy: prev ? prev.statusChangedBy || '' : '',
            statusChangedAt: prev ? prev.statusChangedAt || '' : '',
            history: Array.isArray(prev && prev.history) ? prev.history : [],
            matchedBackOrder: Boolean(bo),
            sourceRow: row.rowIndex
        });
    });

    const orders = applyQueue(Array.from(byVin.values()));
    const advisors = new Set(orders.map((o) => o.salesAdvisor).filter((n) => n && n !== 'UNASSIGNED'));
    const paymentBreakdown = { cash: 0, bank: 0, other: 0, unknown: 0 };
    orders.forEach((o) => { paymentBreakdown[o.paymentKind] = (paymentBreakdown[o.paymentKind] || 0) + 1; });
    const assignDates = orders.map((o) => parseLocalStamp(o.assignDate)).filter(Boolean).sort((a, b) => a - b);
    const matched = orders.filter((o) => o.matchedBackOrder).length;
    const report = {
        sheetName: sheet.name,
        reservedVinCount: orders.filter((o) => o.vin && o.vin !== 'VIN NOT FOUND').length,
        orderCount: orders.length,
        matchedOrders: matched,
        unmatchedVins: orders.length - matched,
        missingVinRows: missingVin,
        duplicateVinRows,
        salesAdvisorCount: advisors.size,
        paymentBreakdown,
        earliestAssignDate: assignDates.length ? displayStamp(assignDates[0]) : '',
        latestAssignDate: assignDates.length ? displayStamp(assignDates[assignDates.length - 1]) : '',
        sampleDeadlines: orders.slice(0, 5).map((o) => ({
            vin: o.vin,
            orderNumber: o.orderNumber,
            payment: o.paymentLabel,
            hours: o.paymentHours,
            assign: o.assignDisplay || 'NO ASSIGN DATE',
            deadline: o.deadline ? displayStamp(parseLocalStamp(o.deadline)) : 'NO ASSIGN DATE'
        })),
        sampleQueue: orders.slice().sort((a, b) => a.queueNumber - b.queueNumber).slice(0, 5).map((o) => ({
            queueNumber: o.queueNumber,
            vin: o.vin,
            orderNumber: o.orderNumber,
            assign: o.assignDisplay || 'NO ASSIGN DATE'
        }))
    };
    return { ok: true, orders, report };
}

function noVinKeysSet(map, key, record) {
    map.set(key, record);
}

function emptyReport() {
    return {
        reservedVinCount: 0,
        orderCount: 0,
        matchedOrders: 0,
        unmatchedVins: 0,
        missingVinRows: 0,
        duplicateVinRows: 0,
        salesAdvisorCount: 0,
        paymentBreakdown: { cash: 0, bank: 0, other: 0, unknown: 0 },
        earliestAssignDate: '',
        latestAssignDate: '',
        sampleDeadlines: [],
        sampleQueue: []
    };
}

function publicOrder(order) {
    const copy = { ...order };
    delete copy.history;
    return copy;
}

function rowsFromGrid(grid) {
    const source = grid || [];
    if (!source.length) return { headers: [], rows: [] };
    let headerIdx = 0;
    const limit = Math.min(source.length, 30);
    for (let r = 0; r < limit; r++) {
        const joined = (source[r] || []).map((cell) => headerText(cell)).join(' ');
        if (/vin|order|payment|advisor|customer/.test(joined)) { headerIdx = r; break; }
    }
    const headers = (source[headerIdx] || []).map((header, index) => cleanText(header) || `Column_${index + 1}`);
    const rows = source.slice(headerIdx + 1).filter((row) => (row || []).some((cell) => cleanText(cell))).map((row) => {
        const obj = {};
        headers.forEach((header, index) => { obj[header] = row[index] ?? ''; });
        return obj;
    });
    return { headers, rows };
}

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fallback;
    }
}

function attachReservedOrders(app, options) {
    const liveFile = path.join(options.storeDir, 'reserved-orders-live.json');
    const staffFile = path.join(options.storeDir, 'reserved-orders-staff.json');
    const sessions = new Map();

    function loadLive() {
        const data = readJson(liveFile, null);
        if (!data || !Array.isArray(data.orders)) return { updatedAt: '', report: {}, orders: [] };
        return data;
    }
    function saveLive(data) {
        fs.mkdirSync(options.storeDir, { recursive: true });
        fs.writeFileSync(liveFile, JSON.stringify(data, null, 2), 'utf8');
    }
    function loadStaff() {
        const data = readJson(staffFile, []);
        return Array.isArray(data) ? data : [];
    }
    function saveStaff(data) {
        fs.mkdirSync(options.storeDir, { recursive: true });
        fs.writeFileSync(staffFile, JSON.stringify(data, null, 2), 'utf8');
    }
    function notify() {
        if (typeof options.broadcast === 'function') options.broadcast(loadLive().updatedAt || '');
    }
    function adminPassword(req) {
        return String(req.body?.password || req.query?.password || '');
    }
    function requireAdmin(req, res) {
        if (adminPassword(req) === String(options.adminPassword || '')) return true;
        res.status(401).json({ error: 'Unauthorized: Invalid password' });
        return false;
    }
    function sessionUser(token) {
        const session = sessions.get(String(token || ''));
        if (!session) return null;
        const person = loadStaff().find((item) => item.id === session.employeeId && item.active !== false);
        return person ? { name: person.name, employeeId: person.id } : null;
    }
    function backOrderFromBuffer(buffer) {
        if (!buffer || !buffer.length) return { headers: [], rows: [] };
        const sheets = sheetGridsFromBuffer(buffer);
        let best = sheets[0] || { grid: [] };
        let bestScore = -1;
        sheets.forEach((sheet) => {
            const sample = (sheet.grid || []).slice(0, 20).map((row) => (row || []).map((cell) => headerText(cell)).join(' ')).join(' ');
            let score = 0;
            if (sample.includes('vin')) score += 2;
            if (sample.includes('order')) score += 1;
            if (sample.includes('payment')) score += 1;
            if (score > bestScore) { best = sheet; bestScore = score; }
        });
        return rowsFromGrid(best.grid);
    }
    function publish(sheets, bo, names, previous) {
        const built = buildReservedDataset({
            sheets,
            boRows: bo.rows,
            boHeaders: bo.headers,
            previous: previous || loadLive().orders || []
        });
        if (!built.ok) return built;
        const live = {
            updatedAt: new Date().toISOString(),
            esalesName: names.esalesName || '',
            boName: names.boName || '',
            report: built.report,
            orders: built.orders
        };
        saveLive(live);
        notify();
        return built;
    }

    app.get('/api/reserved-orders/staff-names', (req, res) => {
        const names = loadStaff().filter((person) => person.active !== false && person.name).map((person) => person.name).sort((a, b) => a.localeCompare(b));
        res.json({ names });
    });
    app.post('/api/reserved-orders/login', (req, res) => {
        const name = String(req.body?.name || '').trim();
        const password = String(req.body?.password || '').trim();
        const person = loadStaff().find((item) => item.active !== false && item.name === name);
        if (!person || password !== String(person.id)) return res.status(401).json({ error: 'Name or employee ID is not valid.' });
        const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        sessions.set(token, { employeeId: person.id });
        res.json({ token, name: person.name });
    });
    app.get('/api/reserved-orders/live', (req, res) => {
        const live = loadLive();
        res.json({ updatedAt: live.updatedAt || '', report: live.report || {}, orders: (live.orders || []).map(publicOrder) });
    });
    app.post('/api/reserved-orders/status', (req, res) => {
        const user = sessionUser(req.body?.token);
        if (!user) return res.status(401).json({ error: 'Session expired. Sign in again.' });
        const rawStatus = String(req.body?.status || '').trim();
        if (!STATUS_SET.has(rawStatus.toLowerCase())) return res.status(400).json({ error: 'Unknown status.' });
        const live = loadLive();
        const order = (live.orders || []).find((item) => item.key === String(req.body?.key || ''));
        if (!order) return res.status(404).json({ error: 'Order not found.' });
        const now = new Date();
        order.status = normalizeStatus(rawStatus);
        order.statusChangedBy = user.name;
        order.statusChangedAt = localStamp(now);
        order.history = Array.isArray(order.history) ? order.history : [];
        order.history.push({ status: order.status, changedBy: user.name, changedAt: order.statusChangedAt, changedDisplay: displayStamp(now) });
        live.updatedAt = now.toISOString();
        saveLive(live);
        notify();
        res.json({ ok: true, order: publicOrder(order) });
    });
    app.post('/api/reserved-orders/push', (req, res) => {
        try {
            if (!requireAdmin(req, res)) return;
            if (!req.body?.esalesBase64) return res.status(400).json({ error: 'Upload the E-Sales file first.' });
            const sheets = sheetGridsFromBuffer(Buffer.from(String(req.body.esalesBase64), 'base64'));
            const bo = req.body.boBase64
                ? backOrderFromBuffer(Buffer.from(String(req.body.boBase64), 'base64'))
                : (typeof options.readStoredBackOrder === 'function' ? options.readStoredBackOrder() : { headers: [], rows: [] });
            const built = publish(sheets, bo, { esalesName: req.body.esalesName, boName: req.body.boName || (req.body.boBase64 ? '' : 'admin-back-order') });
            if (!built.ok) return res.status(400).json({ error: built.error, report: built.report });
            res.json({ ok: true, updatedAt: loadLive().updatedAt, report: built.report });
        } catch (e) {
            res.status(500).json({ error: e.message || 'Could not read the Excel file.' });
        }
    });
    app.get('/api/reserved-orders/admin', (req, res) => {
        if (!requireAdmin(req, res)) return;
        const live = loadLive();
        res.json({
            updatedAt: live.updatedAt || '',
            esalesName: live.esalesName || '',
            boName: live.boName || '',
            report: live.report || {},
            orders: live.orders || [],
            staff: loadStaff().map((person) => ({ name: person.name, id: person.id, active: person.active !== false }))
        });
    });
    app.post('/api/reserved-orders/staff', (req, res) => {
        if (!requireAdmin(req, res)) return;
        const name = String(req.body?.name || '').trim();
        const id = String(req.body?.id || '').trim();
        const active = req.body?.active !== false;
        const previousId = String(req.body?.previousId || id).trim();
        if (!name || !id) return res.status(400).json({ error: 'Employee name and ID are required.' });
        const staff = loadStaff();
        const index = staff.findIndex((person) => String(person.id) === previousId);
        if (index >= 0) {
            if (id !== previousId && staff.some((person) => String(person.id) === id)) return res.status(400).json({ error: 'That employee ID is already used.' });
            staff[index] = { name, id, active };
        } else if (staff.some((person) => String(person.id) === id)) {
            return res.status(400).json({ error: 'That employee ID is already used.' });
        } else staff.push({ name, id, active });
        saveStaff(staff);
        res.json({ ok: true, staff: staff.map((person) => ({ name: person.name, id: person.id, active: person.active !== false })) });
    });

    return {
        refreshFromBuffers(esalesBuffer, boBuffer, names) {
            if (!esalesBuffer || !esalesBuffer.length) return null;
            const sheets = sheetGridsFromBuffer(esalesBuffer);
            const bo = backOrderFromBuffer(boBuffer);
            return publish(sheets, bo, names || {});
        }
    };
}

module.exports = {
    STATUSES,
    STATUS_SET,
    parseDottedDmy,
    parseExcelDate,
    parseLocalStamp,
    displayStamp,
    localStamp,
    normalizeVin,
    normalizePayment,
    normalizeStatus,
    sheetGridsFromBuffer,
    calculateQueueNumber,
    buildReservedDataset,
    publicOrder,
    attachReservedOrders
};
