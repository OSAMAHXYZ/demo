'use strict';

const crypto = require('crypto');

/** Column M and column AG of the RTL worksheet. Used only when that column's header matches. */
const COL = Object.freeze({
  M: 12,
  AG: 32,
  J: 9,
  E: 4,
  B: 1,
  Q: 16,
  L: 11,
});

const RETAIL = 'retail electronic sales';
const FREE_STOCK = 'vehicle allocation completed';

const SPECIAL_LOCATIONS = Object.freeze([
  { id: '7022', label: '7022 Telesales North', key: '7022 telesales north' },
  { id: '7277', label: '7277 eCommerce Sales – Retail', key: '7277 ecommerce sales - retail' },
]);

const RUBA_ID = 'ruba';

function normVin(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

function normName(value) {
  return normText(value);
}

function colLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function headerMatches(label, aliases) {
  const norm = normText(label);
  return !!norm && aliases.some((alias) => normText(alias) === norm);
}

function chooseColumn(headers, aliases, lockedIndex) {
  if (lockedIndex >= 0 && lockedIndex < headers.length && headerMatches(headers[lockedIndex], aliases)) {
    return lockedIndex;
  }
  const idx = headers.findIndex((h) => headerMatches(h, aliases));
  return idx;
}

function cellString(value) {
  if (value == null) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function excelSerialToIso(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num < 20000 || num > 80000) return '';
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(num * 86400000));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY, or an Excel serial. Empty stays empty. Unparseable is invalid. */
function parseDate(value) {
  if (value == null || value === '') return { iso: '', valid: false, empty: true };
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return { iso: value.toISOString().slice(0, 10), valid: true, empty: false };
  }
  if (typeof value === 'number') {
    const iso = excelSerialToIso(value);
    return iso ? { iso, valid: true, empty: false } : { iso: '', valid: false, empty: false };
  }
  const s = String(value).trim();
  if (!s) return { iso: '', valid: false, empty: true };
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return { iso: s.slice(0, 10), valid: true, empty: false };
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    const iso = `${y}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    const check = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(check.getTime()) || check.getUTCDate() !== Number(dmy[1])) {
      return { iso: '', valid: false, empty: false };
    }
    return { iso, valid: true, empty: false };
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const iso = excelSerialToIso(Number(s));
    return iso ? { iso, valid: true, empty: false } : { iso: '', valid: false, empty: false };
  }
  return { iso: '', valid: false, empty: false };
}

function isRuba(viewerId) {
  return String(viewerId || '').trim().toLowerCase() === RUBA_ID;
}

function specialLocation(location) {
  const key = normText(location);
  return SPECIAL_LOCATIONS.find((row) => row.key === key) || null;
}

function isRetail(searchArea) {
  return normText(searchArea) === RETAIL;
}

function isFreeStock(secondary) {
  return normText(secondary) === FREE_STOCK;
}

function salesRawStatus(raw) {
  const src = raw || {};
  const delivered = cellString(src.deliveryDate);
  if (delivered && delivered !== '—' && delivered.toUpperCase() !== 'NA') return 'DELIVERED';
  if (cellString(src.invoiceDate)) return 'INVOICED';
  if (cellString(src.proformaDate)) return 'PROFORMA';
  return '';
}

/**
 * Previous-month proforma stays eligible when it has a proforma date and no invoice date.
 * This matches the existing assignment rule and does not look at city or company records.
 */
function previousMonthEligible(raw, month, prevMonth) {
  const proforma = cellString(raw && raw.proformaDate).slice(0, 7);
  const invoice = cellString(raw && raw.invoiceDate);
  if (!proforma || invoice) return false;
  return proforma === month || proforma === prevMonth;
}

function classifyStock({ row, previous, salesRaw, deliveryNote, viewerId }) {
  const search = cellString(row && (row.searchArea || row.vehicleSearchArea));
  const location = cellString(row && row.location);
  const secondary = cellString(row && row.secondaryStatus);
  const ageRaw = row && row.age != null ? String(row.age).trim() : '';
  const ageNum = ageRaw === '' ? null : Number(ageRaw.replace(/[, ]/g, ''));
  const alloc = cellString(row && row.allocationDate).slice(0, 10);
  const fileDate = cellString(row && row.fileDate).slice(0, 10);
  const prevArea = cellString(previous && previous.searchArea);
  const hadPrevious = !!(previous && (previous.searchArea || previous.location || previous.vin));
  const retail = isRetail(search);
  const wasRetail = isRetail(prevArea);
  const special = specialLocation(location);
  const ruba = isRuba(viewerId);
  const noteOn = !!(deliveryNote && deliveryNote.active);
  const sr = salesRawStatus(salesRaw);
  const warnings = [];

  let stockStatus = 'UNDEFINED / REVIEW REQUIRED';
  let reason = 'Location is not a Stock In location for this user';
  let movement = 'UNCHANGED';

  if (!row) {
    if (noteOn && !ruba) {
      return {
        stockStatus: 'WITH DELIVERY NOTE / STOCK OUT',
        reason: 'VIN left the RTL file. The saved delivery note stays Stock Out and is not a physical delivery.',
        movement: 'MISSING',
        salesRawStatus: sr || '—',
        warnings,
        special: false,
      };
    }
    return {
      stockStatus: 'MISSING FROM RTL',
      reason: 'VIN is not in the latest RTL snapshot. The historical record is kept.',
      movement: 'MISSING',
      salesRawStatus: sr || '—',
      warnings,
      special: false,
    };
  }

  if (sr === 'DELIVERED') {
    stockStatus = 'DELIVERED';
    reason = 'Sales Raw has a delivery date. A delivery note is not required for this status.';
  } else if (noteOn && !ruba && special) {
    stockStatus = 'WITH DELIVERY NOTE / STOCK OUT';
    reason = 'A delivery note is saved. The vehicle stays out of the assignment pool and is not physically delivered.';
  } else if (sr === 'INVOICED') {
    stockStatus = 'INVOICED';
    reason = 'Sales Raw has an invoice date and no delivery date.';
  } else if (sr === 'PROFORMA') {
    stockStatus = 'PROFORMA';
    reason = 'Sales Raw has a proforma date and no invoice or delivery date.';
  } else if (hadPrevious && wasRetail && !retail) {
    stockStatus = 'SWAPPED OUT';
    movement = 'SWAPPED OUT';
    reason = `Moved from Retail Electronic Sales to ${search || location || 'another area'}.`;
  } else if (hadPrevious && prevArea && !wasRetail && retail) {
    stockStatus = 'SWAPPED IN';
    movement = 'SWAPPED IN';
    reason = `Moved into Retail Electronic Sales from ${prevArea}. This is not a new allocation.`;
  } else if (!ruba && special && !noteOn) {
    stockStatus = 'STOCK IN / AVAILABLE';
    reason = `${special.label} is Stock In until a delivery note is saved.`;
  } else if (retail && ageNum === 0 && alloc && fileDate && alloc === fileDate) {
    stockStatus = 'STOCK IN / AVAILABLE';
    reason = 'New Retail Electronic Sales allocation: Search Area is Retail Electronic Sales, allocation age is 0, and the allocation date is the RTL file date.';
  } else if (isFreeStock(secondary)) {
    stockStatus = 'FREE IN MY STOCK';
    reason = 'Secondary Status Description is Vehicle allocation completed.';
  } else if (retail) {
    stockStatus = 'UNDEFINED / REVIEW REQUIRED';
    reason = 'Retail Electronic Sales row is not a new age-0 allocation and is not free stock.';
    if (ageRaw && ageNum !== 0) warnings.push('Allocation age is not 0');
  } else {
    stockStatus = 'UNDEFINED / REVIEW REQUIRED';
    reason = ruba && special
      ? 'Ruba keeps the existing inventory workflow. This location does not change her Stock In rule.'
      : 'No Stock In rule matches this RTL row.';
  }

  if (hadPrevious && movement === 'UNCHANGED') {
    const prevLoc = normText(previous.location);
    const nextLoc = normText(location);
    if (prevLoc && nextLoc && prevLoc !== nextLoc && movement === 'UNCHANGED' && stockStatus !== 'SWAPPED IN' && stockStatus !== 'SWAPPED OUT') {
      movement = 'LOCATION';
    }
  }

  return {
    stockStatus,
    reason,
    movement,
    salesRawStatus: sr || '—',
    warnings,
    special: !!(special && !ruba),
  };
}

function emptyState() {
  return {
    byVin: {},
    snapshots: [],
    failures: [],
    last: null,
    lastFailed: null,
  };
}

function syncHash(rows) {
  const body = (rows || [])
    .map((row) => [
      row.vin,
      row.searchArea || '',
      row.location || '',
      row.allocationDate || '',
      row.age == null ? '' : String(row.age),
      row.secondaryStatus || '',
      row.product || '',
    ].join('\t'))
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(body).digest('hex');
}

function snapshotId(at) {
  return `rtl-${Number(at) || Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Apply one RTL push onto inventory state.
 * The same hash does not add another snapshot or another movement.
 * VINs that leave the file stay in byVin.
 */
function applySync(state, input) {
  const box = state && typeof state === 'object' ? state : emptyState();
  if (!box.byVin || typeof box.byVin !== 'object') box.byVin = {};
  if (!Array.isArray(box.snapshots)) box.snapshots = [];
  if (!Array.isArray(box.failures)) box.failures = [];

  const rows = Array.isArray(input && input.rows) ? input.rows : [];
  const at = input && input.at ? new Date(input.at).toISOString() : new Date().toISOString();
  const hash = syncHash(rows);
  const previousSnap = box.snapshots.length ? box.snapshots[box.snapshots.length - 1] : null;
  if (previousSnap && previousSnap.hash === hash && box.last && box.last.ok) {
    return {
      ok: true,
      duplicate: true,
      state: box,
      snapshot: null,
      summary: {
        ...box.last,
        duplicate: true,
        status: 'already-applied',
        message: 'This RTL push was already applied. No inventory rows or movements were added.',
      },
    };
  }

  const salesByVin = (input && input.salesByVin) || {};
  const notesByVin = (input && input.notesByVin) || {};
  const seen = new Set();
  let matched = 0;
  let swappedIn = 0;
  let swappedOut = 0;
  let missing = 0;
  const movements = [];

  rows.forEach((row) => {
    const vin = normVin(row && row.vin);
    if (!vin) return;
    seen.add(vin);
    const previous = box.byVin[vin] || null;
    if (previous) matched += 1;
    const salesRaw = salesByVin[vin] || null;
    const deliveryNote = notesByVin[vin] || null;
    const base = classifyStock({ row, previous, salesRaw, deliveryNote, viewerId: '' });
    const ruba = classifyStock({ row, previous, salesRaw, deliveryNote, viewerId: RUBA_ID });
    if (base.movement === 'SWAPPED IN') swappedIn += 1;
    if (base.movement === 'SWAPPED OUT') swappedOut += 1;
    const changed = !previous
      || normText(previous.location) !== normText(row.location)
      || normText(previous.searchArea) !== normText(row.searchArea)
      || previous.stockStatus !== base.stockStatus;
    const next = {
      vin,
      product: cellString(row.product),
      specs: cellString(row.specs || [row.suffix, row.year, row.ext, row.int].filter(Boolean).join(' / ')),
      location: cellString(row.location),
      searchArea: cellString(row.searchArea || row.vehicleSearchArea),
      allocationDate: cellString(row.allocationDate),
      age: row.age == null ? '' : String(row.age).trim(),
      secondaryStatus: cellString(row.secondaryStatus),
      employee: cellString((salesRaw && (salesRaw.salesAdvisor || salesRaw.userName)) || (previous && previous.employee) || ''),
      city: cellString((previous && previous.city) || ''),
      company: cellString((previous && previous.company) || ''),
      cityId: (previous && previous.cityId) || '',
      companyId: (previous && previous.companyId) || '',
      stockStatus: base.stockStatus,
      rubaStockStatus: ruba.stockStatus,
      reason: base.reason,
      rubaReason: ruba.reason,
      salesRawStatus: base.salesRawStatus,
      deliveryNoteActive: !!(deliveryNote && deliveryNote.active),
      deliveryNoteNumber: cellString(deliveryNote && deliveryNote.number),
      deliveryNoteAt: cellString(deliveryNote && deliveryNote.at),
      specialLocation: !!specialLocation(row.location),
      previousLocation: previous ? previous.location : '',
      snapshotAt: at,
      movementAt: changed ? at : (previous && previous.movementAt) || at,
      updatedAt: at,
      source: 'rtl-push',
      warnings: base.warnings,
      missing: false,
    };
    if (changed) {
      movements.push({
        vin,
        at,
        from: previous ? previous.stockStatus : '',
        to: base.stockStatus,
        previousLocation: previous ? previous.location : '',
        location: next.location,
        reason: base.movement === 'UNCHANGED' ? 'UPDATED' : base.movement,
      });
    }
    box.byVin[vin] = next;
  });

  Object.keys(box.byVin).forEach((vin) => {
    if (seen.has(vin)) return;
    const previous = box.byVin[vin];
    if (previous.missing) return;
    missing += 1;
    const salesRaw = salesByVin[vin] || null;
    const deliveryNote = notesByVin[vin] || null;
    const fromStatus = previous.stockStatus;
    const base = classifyStock({ row: null, previous, salesRaw, deliveryNote, viewerId: '' });
    const ruba = classifyStock({ row: null, previous, salesRaw, deliveryNote, viewerId: RUBA_ID });
    previous.missing = true;
    previous.stockStatus = base.stockStatus;
    previous.rubaStockStatus = ruba.stockStatus;
    previous.reason = base.reason;
    previous.rubaReason = ruba.reason;
    previous.salesRawStatus = base.salesRawStatus;
    previous.updatedAt = at;
    previous.movementAt = at;
    if (deliveryNote && deliveryNote.active) {
      previous.deliveryNoteActive = true;
      previous.deliveryNoteNumber = cellString(deliveryNote.number) || previous.deliveryNoteNumber;
    }
    movements.push({
      vin,
      at,
      from: fromStatus,
      to: base.stockStatus,
      previousLocation: previous.location,
      location: previous.location,
      reason: 'MISSING',
    });
  });

  const id = snapshotId(Date.parse(at) || Date.now());
  const snapshot = {
    id,
    at,
    pushId: cellString(input && input.pushId) || id,
    fileName: cellString(input && input.fileName),
    source: cellString(input && input.source) || 'admin-push',
    hash,
    by: cellString(input && input.by) || 'Administrator',
    rows: rows.map((row) => ({
      vin: normVin(row.vin),
      product: cellString(row.product),
      location: cellString(row.location),
      searchArea: cellString(row.searchArea || row.vehicleSearchArea),
      allocationDate: cellString(row.allocationDate),
      age: row.age == null ? '' : String(row.age).trim(),
      secondaryStatus: cellString(row.secondaryStatus),
    })),
    movements,
    totals: {
      processed: Number(input && input.processed) || rows.length,
      uniqueVins: rows.length,
      matched,
      duplicates: Number(input && input.duplicates) || 0,
      rejected: Number(input && input.rejected) || 0,
      swappedIn,
      swappedOut,
      missing,
    },
  };
  box.snapshots.push({
    id: snapshot.id,
    at: snapshot.at,
    pushId: snapshot.pushId,
    fileName: snapshot.fileName,
    source: snapshot.source,
    hash,
    by: snapshot.by,
    totals: snapshot.totals,
  });
  const summary = {
    ok: true,
    duplicate: false,
    status: 'applied',
    at,
    snapshotId: snapshot.id,
    pushId: snapshot.pushId,
    fileName: snapshot.fileName,
    processed: snapshot.totals.processed,
    uniqueVins: snapshot.totals.uniqueVins,
    matched,
    duplicates: snapshot.totals.duplicates,
    rejected: snapshot.totals.rejected,
    errors: Array.isArray(input && input.errors) ? input.errors : [],
    swappedIn,
    swappedOut,
    missing,
    movements: movements.length,
    message: `RTL sync applied ${rows.length} unique VINs.`,
  };
  box.last = summary;
  box.lastFailed = null;
  return { ok: true, duplicate: false, state: box, snapshot, summary };
}

function recordFailure(state, failure) {
  const box = state && typeof state === 'object' ? state : emptyState();
  if (!Array.isArray(box.failures)) box.failures = [];
  const entry = {
    at: new Date().toISOString(),
    pushId: cellString(failure && failure.pushId),
    fileName: cellString(failure && failure.fileName),
    message: cellString(failure && failure.message) || 'RTL sync failed',
  };
  box.failures.push(entry);
  box.failures = box.failures.slice(-50);
  box.last = {
    ok: false,
    status: 'failed',
    at: entry.at,
    message: entry.message,
    pushId: entry.pushId,
    fileName: entry.fileName,
  };
  if (failure && Array.isArray(failure.rows)) {
    box.lastFailed = {
      at: entry.at,
      pushId: entry.pushId,
      fileName: entry.fileName,
      message: entry.message,
      rows: failure.rows,
      processed: failure.processed,
      duplicates: failure.duplicates,
      rejected: failure.rejected,
      errors: failure.errors || [],
    };
  }
  return box.last;
}

function rowsFromMatrix(matrix, fileDate) {
  const grid = Array.isArray(matrix) ? matrix : [];
  let headerIdx = 0;
  let best = -1;
  for (let r = 0; r < Math.min(grid.length, 25); r += 1) {
    const row = grid[r] || [];
    let hits = 0;
    row.forEach((cell) => {
      const n = normText(cell);
      if (!n) return;
      if (n === 'vin' || n.includes('vin') || n.includes('chassis')) hits += 2;
      if (n.includes('search area')) hits += 2;
      if (n.includes('allocation date')) hits += 2;
      if (n === 'product' || n.includes('product')) hits += 1;
    });
    if (hits > best) {
      best = hits;
      headerIdx = r;
    }
  }
  const headers = (grid[headerIdx] || []).map((cell, i) => cellString(cell) || `Column ${colLetter(i)}`);
  const vinCol = chooseColumn(headers, ['vin', 'chassis', 'chassis no', 'chassis number'], COL.E);
  const searchCol = chooseColumn(headers, ['search area desc', 'vehicle search area', 'search area'], COL.M);
  const allocCol = chooseColumn(headers, ['allocation date', 'alloc date'], COL.AG);
  const ageCol = chooseColumn(headers, ['age', 'ageing', 'aging', 'allocation age'], COL.J);
  const secondaryCol = chooseColumn(headers, ['secondary status description', 'secondary status desc'], COL.L);
  const locationCol = chooseColumn(headers, ['allocated location', 'location', 'source location'], COL.Q);
  const productCol = chooseColumn(headers, ['product', 'vehicle model', 'model'], COL.B);
  const fileIso = parseDate(fileDate);
  const grouped = new Map();
  let rejected = 0;
  const errors = [];
  for (let r = headerIdx + 1; r < grid.length; r += 1) {
    const line = grid[r] || [];
    if (!line.some((cell) => cellString(cell))) continue;
    const vin = normVin(vinCol >= 0 ? line[vinCol] : '');
    if (!vin) {
      rejected += 1;
      continue;
    }
    const alloc = allocCol >= 0 ? parseDate(line[allocCol]) : { iso: '', valid: false, empty: true };
    if (!alloc.empty && !alloc.valid) errors.push({ vin, row: r + 1, field: 'allocationDate', message: 'Allocation date could not be read' });
    const item = {
      vin,
      product: productCol >= 0 ? cellString(line[productCol]) : '',
      searchArea: searchCol >= 0 ? cellString(line[searchCol]) : '',
      location: locationCol >= 0 ? cellString(line[locationCol]) : '',
      allocationDate: alloc.iso,
      age: ageCol >= 0 ? cellString(line[ageCol]) : '',
      secondaryStatus: secondaryCol >= 0 ? cellString(line[secondaryCol]) : '',
      fileDate: fileIso.iso,
      index: r,
    };
    if (!grouped.has(vin)) grouped.set(vin, []);
    grouped.get(vin).push(item);
  }
  const rows = [];
  let duplicates = 0;
  grouped.forEach((list) => {
    duplicates += Math.max(0, list.length - 1);
    let best = list[0];
    list.forEach((cand) => {
      if (cand.allocationDate && (!best.allocationDate || cand.allocationDate > best.allocationDate)) best = cand;
      else if (cand.allocationDate === best.allocationDate && cand.index > best.index) best = cand;
      else if (!cand.allocationDate && !best.allocationDate && cand.index > best.index) best = cand;
    });
    rows.push(best);
  });
  return {
    rows,
    processed: rows.length + duplicates + rejected,
    uniqueVins: rows.length,
    duplicates,
    rejected,
    errors,
    sheetHeaders: headers,
  };
}

function readRtlSheet(buffer, XLSX, fileDate) {
  if (!buffer || !buffer.length) {
    return { rows: [], processed: 0, uniqueVins: 0, duplicates: 0, rejected: 0, errors: [{ message: 'RTL workbook is empty' }] };
  }
  if (!XLSX) throw new Error('XLSX is required to read an RTL workbook');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const name = (wb.SheetNames || [])[0];
  if (!name) {
    return { rows: [], processed: 0, uniqueVins: 0, duplicates: 0, rejected: 0, errors: [{ message: 'RTL workbook has no worksheet' }] };
  }
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
  const parsed = rowsFromMatrix(matrix, fileDate);
  parsed.sheet = name;
  return parsed;
}

function rankSalesRaw(entry) {
  const raw = (entry && entry.raw) || {};
  const iso = raw.proformaInvalid ? '' : cellString(raw.proformaDate).slice(0, 10);
  return {
    valid: /^\d{4}-\d{2}-\d{2}$/.test(iso),
    iso,
    invalid: raw.proformaInvalid === true,
    index: entry.index,
  };
}

function betterSalesRaw(current, cand) {
  const a = rankSalesRaw(current);
  const b = rankSalesRaw(cand);
  if (b.valid && !a.valid) return true;
  if (b.valid && a.valid && (b.iso > a.iso || (b.iso === a.iso && b.index > a.index))) return true;
  if (!b.valid && !a.valid && b.index > a.index) return true;
  return false;
}

/** One row per VIN. Newest valid proforma date wins. Equal dates keep the last uploaded row. */
function selectSalesRawItems(items) {
  const groups = new Map();
  const invalid = [];
  (items || []).forEach((item, index) => {
    const vin = normVin(item && item.vin);
    if (!vin) return;
    const wrapped = { item, vin, index };
    if (!groups.has(vin)) groups.set(vin, []);
    groups.get(vin).push(wrapped);
    if (item.raw && item.raw.proformaInvalid) invalid.push({ vin, index });
  });
  const selected = [];
  const duplicatePicks = [];
  groups.forEach((list, vin) => {
    let best = list[0];
    list.forEach((cand) => {
      if (betterSalesRaw(best, cand)) best = cand;
    });
    const copy = { ...best.item, vin, raw: { ...(best.item.raw || {}) } };
    delete copy.raw.proformaInvalid;
    selected.push(copy);
    if (list.length > 1) {
      duplicatePicks.push({
        vin,
        count: list.length,
        selectedIndex: best.index,
        selectedProforma: copy.raw.proformaDate || '',
      });
    }
  });
  return {
    items: selected,
    duplicates: (items || []).length - selected.length,
    duplicatePicks,
    invalid,
  };
}

function viewRow(record, viewerId) {
  if (!record) return null;
  const ruba = isRuba(viewerId);
  return {
    vin: record.vin,
    product: record.product || '',
    specs: record.specs || '',
    location: record.location || '',
    searchArea: record.searchArea || '',
    employee: record.employee || '',
    city: record.city || '',
    company: record.company || '',
    stockStatus: ruba ? (record.rubaStockStatus || record.stockStatus) : record.stockStatus,
    reason: ruba ? (record.rubaReason || record.reason) : record.reason,
    salesRawStatus: record.salesRawStatus || '—',
    deliveryNoteStatus: record.deliveryNoteActive ? 'WITH DELIVERY NOTE' : '',
    deliveryNoteNumber: record.deliveryNoteNumber || '',
    proformaStatus: record.salesRawStatus === 'PROFORMA' ? 'PROFORMA' : '',
    invoiceStatus: record.salesRawStatus === 'INVOICED' ? 'INVOICED' : '',
    deliveredStatus: record.salesRawStatus === 'DELIVERED' ? 'DELIVERED' : '',
    swapStatus: record.stockStatus === 'SWAPPED IN' || record.stockStatus === 'SWAPPED OUT' ? record.stockStatus : '',
    snapshotAt: record.snapshotAt || '',
    movementAt: record.movementAt || '',
    updatedAt: record.updatedAt || '',
    source: record.source || '',
    warnings: record.warnings || [],
    missing: !!record.missing,
    available: !ruba && record.stockStatus === 'STOCK IN / AVAILABLE' && !record.deliveryNoteActive,
  };
}

function assertAdmin(role) {
  if (role !== 'admin') {
    const err = new Error('Only an admin can change cities and companies');
    err.status = 403;
    throw err;
  }
}

function orgState(state) {
  const box = state && typeof state === 'object' ? state : { cities: [], companies: [] };
  if (!Array.isArray(box.cities)) box.cities = [];
  if (!Array.isArray(box.companies)) box.companies = [];
  return box;
}

function newOrgId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
}

function saveCity(state, input, role) {
  assertAdmin(role);
  const box = orgState(state);
  const name = cellString(input && input.name);
  if (!name) {
    const err = new Error('City name is required');
    err.status = 400;
    throw err;
  }
  const country = cellString(input && input.country) || 'Saudi Arabia';
  const status = cellString(input && input.status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
  const id = cellString(input && input.id);
  const dup = box.cities.find((city) => city.id !== id && normName(city.name) === normName(name) && normName(city.country || 'Saudi Arabia') === normName(country));
  if (dup) {
    const err = new Error('A city with this name already exists in that country');
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  if (id) {
    const city = box.cities.find((row) => row.id === id);
    if (!city) {
      const err = new Error('City not found');
      err.status = 404;
      throw err;
    }
    city.name = name;
    city.country = country;
    city.status = status;
    city.updatedAt = now;
    return city;
  }
  const city = { id: newOrgId('city'), name, country, status, createdAt: now, updatedAt: now };
  box.cities.push(city);
  return city;
}

function saveCompany(state, input, role) {
  assertAdmin(role);
  const box = orgState(state);
  const name = cellString(input && input.name);
  if (!name) {
    const err = new Error('Company name is required');
    err.status = 400;
    throw err;
  }
  const code = cellString(input && input.code).toUpperCase();
  const cityId = cellString(input && input.cityId);
  const status = cellString(input && input.status).toLowerCase() === 'inactive' ? 'inactive' : 'active';
  const id = cellString(input && input.id);
  if (cityId && !box.cities.some((city) => city.id === cityId)) {
    const err = new Error('Choose a city that already exists');
    err.status = 400;
    throw err;
  }
  if (cityId) {
    const city = box.cities.find((row) => row.id === cityId);
    if (city && city.status !== 'active' && !id) {
      const err = new Error('Inactive cities cannot be selected for a new company');
      err.status = 400;
      throw err;
    }
  }
  if (code && box.companies.some((row) => row.id !== id && row.code && row.code.toUpperCase() === code)) {
    const err = new Error('Company code is already used');
    err.status = 409;
    throw err;
  }
  const sameName = box.companies.find((row) => row.id !== id && normName(row.name) === normName(name) && String(row.cityId || '') === cityId);
  if (sameName) {
    const err = new Error('A company with this name is already linked to that city');
    err.status = 409;
    throw err;
  }
  const now = new Date().toISOString();
  if (id) {
    const company = box.companies.find((row) => row.id === id);
    if (!company) {
      const err = new Error('Company not found');
      err.status = 404;
      throw err;
    }
    company.name = name;
    company.code = code;
    company.cityId = cityId;
    company.status = status;
    company.updatedAt = now;
    return company;
  }
  const company = { id: newOrgId('co'), name, code, cityId, status, createdAt: now, updatedAt: now };
  box.companies.push(company);
  return company;
}

function publicOrg(state) {
  const box = orgState(state);
  const cities = box.cities.map((city) => ({
    ...city,
    companies: box.companies.filter((company) => company.cityId === city.id).map((company) => company.id),
  }));
  const companies = box.companies.map((company) => ({
    ...company,
    cityName: (box.cities.find((city) => city.id === company.cityId) || {}).name || '',
  }));
  return { cities, companies };
}

module.exports = {
  RUBA_ID,
  SPECIAL_LOCATIONS,
  normVin,
  normText,
  parseDate,
  isRuba,
  specialLocation,
  classifyStock,
  emptyState,
  applySync,
  recordFailure,
  syncHash,
  rowsFromMatrix,
  readRtlSheet,
  selectSalesRawItems,
  previousMonthEligible,
  viewRow,
  saveCity,
  saveCompany,
  publicOrg,
  assertAdmin,
};
