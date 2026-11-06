'use strict';

/**
 * Contact Performance — data flow (single source of truth: Admin Push).
 *
 * 1. Admin page (report-sheet/admin.html) collects the CRM export (sheet
 *    "Export") and, optionally, a separate contact file in the
 *    "CRM export and contact file" card (ContactPerformance.mountAdmin).
 *    Nothing is live yet.
 * 2. The existing Push to live button (pushToLive) calls
 *    ContactPerformance.publishDraft(), which sends the files as base64 JSON:
 *      POST /api/contact-performance/preview  { period, publishedBy, crmFile, contactFile? }
 *    Columns are mapped by header name. Contact status comes from the
 *    export's "Initial Contact" column; a contact file, when given, overrides
 *    it per Lead Number. The reporting period is the month of the Created
 *    Dates in the export. Invalid files return 422 and never touch the
 *    published dataset.
 *      POST /api/contact-performance/publish { draftId }
 *    The draft becomes the active publication for its period. Publications
 *    are kept as historical snapshots (store.json: publications, byPeriod,
 *    activeId, audit). A repeat push of the same files for the same period
 *    returns { duplicate: true } and creates no new snapshot.
 * 3. The dashboard (report-sheet/contact-performance.js) only reads:
 *      GET /api/contact-performance/meta
 *      GET /api/contact-performance/summary?publication=<id>&filters…
 *      GET /api/contact-performance/leads?…  and /leads/:recordId
 *    After a successful publish the server broadcasts
 *    "contact_performance_updated" over the report-sheet WebSocket, which
 *    data-store.js turns into a "contact-performance-updated" window event;
 *    the dashboard reloads. It also polls meta every 45s. A failed refresh
 *    keeps the last published numbers on screen.
 * Storage: <PERSISTENT_ROOT>/contact-performance/{store.json,datasets,sources}.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 100000;
const CONTACTED = new Set(['contacted', 'contact done', 'reached', 'successfully contacted', 'contact successful', 'contact complete', 'already contacted']);
const NOT_CONTACTED = new Set(['not contacted', 'not contact', 'no contact', 'uncontacted', 'not yet contacted', 'not yet contact', 'awaiting contact']);
const IN_PROGRESS = new Set(['in progress', 'inprogress', 'pending', 'follow up', 'followup', 'attempting', 'callback', 'call back', 'scheduled', 'working', 'open']);
const LEAD_KINDS = new Set(['export', 'matched', 'contact_only']);
const NO_SOURCE = 'Not set';

const EMPLOYEE_ALIASES = ['employee responsible', 'responsible employee', 'employee name', 'sales advisor', 'advisor', 'advisor name', 'sales consultant'];
const EXPORT_FIELDS = {
  leadNumber: ['lead number', 'lead no', 'lead #', 'lead id'],
  employeeName: EMPLOYEE_ALIASES,
  initialContact: ['initial contact', 'initial contact status', 'first contact', 'first contact status'],
  createdDate: ['created date', 'date created', 'create date', 'created on'],
  source: ['source', 'lead source'],
  status: ['status', 'crm status', 'lead status'],
  leadType: ['lead type'],
  centre: ['centre name', 'center name', 'centre', 'center', 'branch', 'showroom', 'showroom name'],
};
const CONTACT_FILE_FIELDS = {
  leadNumber: ['lead number', 'lead no', 'lead #', 'lead id', 'transaction no', 'transaction number', 'transaction #'],
  contactStatus: ['initial contact', 'initial contact status', 'contact status', 'first contact', 'first contact status', 'contact result'],
  employeeName: EMPLOYEE_ALIASES,
  prospect: ['prospect', 'prospect name', 'customer', 'customer name'],
  model: ['model', 'vehicle model'],
  telephone: ['telephone', 'telephone no', 'phone', 'phone no', 'mobile', 'mobile no', 'mobile number'],
};

function normHeader(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/[.:#]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normName(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
}

function clip(value, max) {
  const text = value == null ? '' : String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) : text;
}

function cleanId(value) {
  let text = String(value == null ? '' : value).trim().replace(/^'/, '');
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, '');
  return text.trim();
}

function normalizeId(value, cell) {
  if (cell && (cell.t === 's' || cell.t === 'str') && cell.v != null && String(cell.v).trim() !== '') {
    return cleanId(cell.v);
  }
  if (cell && typeof cell.w === 'string' && /^0\d+$/.test(cell.w.trim())) return cell.w.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Math.abs(value - Math.round(value)) > 1e-6) return '';
    return String(Math.round(value));
  }
  return cleanId(value);
}

/** Export "Initial Contact": only these three values count; anything else is unknown. */
function classifyInitialContact(raw) {
  const compact = String(raw == null ? '' : raw).toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  if (compact === 'contacted') return 'contacted';
  if (compact === 'not contacted') return 'not_contacted';
  if (compact === 'in progress' || compact === 'inprogress') return 'in_progress';
  return 'unknown';
}

/** Separate contact file: broader wording is accepted. */
function classifyContactStatus(raw) {
  const compact = normHeader(raw).replace(/[_-]+/g, ' ');
  if (!compact) return 'missing';
  if (/^(no|n|false|0)$/.test(compact)) return 'not_contacted';
  if (/^(yes|y|true|1)$/.test(compact)) return 'contacted';
  if (NOT_CONTACTED.has(compact) || /not[\s-]+contact/.test(compact) || compact.includes('no contact') || compact.includes('not reached') || compact.includes('uncontact')) return 'not_contacted';
  if (CONTACTED.has(compact) || compact.includes('contacted') || compact === 'contact' || (compact.includes('reached') && !compact.includes('not'))) return 'contacted';
  if (IN_PROGRESS.has(compact)) return 'in_progress';
  return 'unknown';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function fmtDate(date) {
  return `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function isoDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateText(text) {
  const value = String(text || '').trim();
  let match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    return null;
  }
  match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
  }
  return null;
}

function cellText(cell) {
  if (!cell || cell.v == null || cell.v === '') return '';
  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) return fmtDate(cell.v);
  if (typeof cell.w === 'string' && cell.w.trim()) return cell.w.trim();
  return String(cell.v).trim();
}

function dateFromCell(cell, XLSX) {
  const none = { display: '', sort: 0, iso: '', invalid: false };
  if (!cell || cell.v == null || cell.v === '') return none;
  if (cell.v instanceof Date) {
    if (Number.isNaN(cell.v.getTime())) return { ...none, display: clip(cell.w, 40), invalid: true };
    const shown = parseDateText(typeof cell.w === 'string' ? cell.w.trim() : '');
    if (shown) return { display: fmtDate(shown), sort: shown.getTime(), iso: isoDate(shown), invalid: false };
    const local = new Date(cell.v.getFullYear(), cell.v.getMonth(), cell.v.getDate());
    return { display: fmtDate(local), sort: local.getTime(), iso: isoDate(local), invalid: false };
  }
  if (typeof cell.v === 'number' && Number.isFinite(cell.v) && XLSX && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
    const formatted = typeof cell.w === 'string' ? cell.w.trim() : '';
    const parsedText = parseDateText(formatted);
    if (parsedText) return { display: fmtDate(parsedText), sort: parsedText.getTime(), iso: isoDate(parsedText), invalid: false };
    const fmt = String(cell.z || '');
    if (/[ydm]/i.test(fmt) && !/^[#0.]+$/.test(fmt)) {
      const parsed = XLSX.SSF.parse_date_code(cell.v);
      if (parsed && parsed.y > 1900 && parsed.y < 2100) {
        const date = new Date(parsed.y, parsed.m - 1, parsed.d);
        return { display: fmtDate(date), sort: date.getTime(), iso: isoDate(date), invalid: false };
      }
    }
  }
  const text = cellText(cell);
  const parsed = parseDateText(text);
  if (parsed) return { display: fmtDate(parsed), sort: parsed.getTime(), iso: isoDate(parsed), invalid: false };
  return { ...none, display: clip(text, 40), invalid: !!text };
}

function findColumn(headers, aliases) {
  const norms = headers.map((label) => normHeader(label).replace(/\s+/g, ''));
  for (const alias of aliases) {
    const wanted = normHeader(alias).replace(/\s+/g, '');
    const index = norms.findIndex((header) => header === wanted);
    if (index >= 0) return index;
  }
  return -1;
}

/** Same files pushed again for the same period must not create a second snapshot. */
function contentHash(contactBuf, crmBuf) {
  const hash = crypto.createHash('sha256');
  hash.update(contactBuf || Buffer.alloc(0));
  hash.update(Buffer.from('\n--crm--\n'));
  hash.update(crmBuf || Buffer.alloc(0));
  return hash.digest('hex');
}

function passwordOk(given, expected) {
  const left = Buffer.from(String(given || ''));
  const right = Buffer.from(String(expected || ''));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(right, right);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function safeName(name) {
  return String(name || 'file').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 180) || 'file';
}

function extOf(name) {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : '';
}

function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.slice(2).toString('utf16le'), encoding: 'utf-16le' };
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sliced = buf.slice(2);
    const swapped = Buffer.alloc(sliced.length - (sliced.length % 2));
    for (let i = 0; i + 1 < sliced.length; i += 2) {
      swapped[i] = sliced[i + 1];
      swapped[i + 1] = sliced[i];
    }
    return { text: swapped.toString('utf16le'), encoding: 'utf-16be' };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'utf-8' };
  }
  const utf8 = buf.toString('utf8');
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad > 8) return { text: buf.toString('latin1'), encoding: 'latin1' };
  return { text: utf8, encoding: 'utf-8' };
}

function detectDelimiter(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestScore = -1;
  candidates.forEach((delimiter) => {
    const counts = lines.map((line) => line.split(delimiter).length);
    if (!counts.length) return;
    const sorted = counts.slice().sort((a, b) => a - b);
    const mode = sorted[Math.floor(sorted.length / 2)] || 0;
    const stable = counts.filter((count) => count === mode).length;
    const score = mode > 1 ? stable * 20 + mode : 0;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  });
  return best;
}

function sheetMatrix(ws, XLSX) {
  if (!ws || !ws['!ref'] || !XLSX || !XLSX.utils) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = [];
    let any = false;
    for (let c = 0; c <= range.e.c; c += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] || null;
      if (cell && cell.v != null && cell.v !== '') any = true;
      row.push(cell);
    }
    if (any) rows.push(row);
  }
  return rows;
}

function readWorkbook(buffer, filename, XLSX) {
  const ext = extOf(filename);
  const allowed = ['xlsx', 'xls', 'csv', 'txt'];
  if (ext && !allowed.includes(ext)) {
    return { error: `Unsupported file type .${ext}. Use .xlsx, .xls, .csv, or .txt.` };
  }
  if (!buffer || !buffer.length) return { error: 'The file is empty.' };
  if (buffer.length > MAX_BYTES) return { error: 'The file is larger than 30 MB.' };
  const head = buffer.slice(0, 16).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    return { error: 'This file is not a spreadsheet export.' };
  }
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf;
  if (zip || ole || ext === 'xlsx' || ext === 'xls') {
    if (!zip && !ole) return { error: 'The workbook could not be read. Upload the original .xlsx or .xls file.' };
    try {
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      return { wb, encoding: 'workbook', delimiter: '' };
    } catch (err) {
      return { error: `The workbook could not be read (${err.message || 'invalid file'}).` };
    }
  }
  const decoded = decodeText(buffer);
  if (!decoded.text.trim()) return { error: 'The file has no rows.' };
  const delimiter = detectDelimiter(decoded.text);
  try {
    const wb = XLSX.read(decoded.text, { type: 'string', FS: delimiter, cellDates: true });
    return { wb, encoding: decoded.encoding, delimiter };
  } catch (err) {
    return { error: `The export could not be read (${err.message || 'unsupported delimiter or encoding'}).` };
  }
}

function headerLabels(row) {
  return row.map((cell) => cellText(cell));
}

function locateHeader(matrix, requiredAliases) {
  const limit = Math.min(matrix.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const labels = headerLabels(matrix[i]);
    if (findColumn(labels, requiredAliases) >= 0) return { index: i, labels };
  }
  return null;
}

function pickSheet(wb, XLSX, idAliases) {
  const names = (wb && wb.SheetNames) || [];
  if (!names.length) return { error: 'The file has no worksheet.' };
  const hasHeader = (name) => {
    try { return !!locateHeader(sheetMatrix(wb.Sheets[name], XLSX), idAliases); } catch (err) { return false; }
  };
  const exact = names.find((name) => normHeader(name) === 'export');
  if (exact && hasHeader(exact)) return { name: exact };
  const found = names.find(hasHeader);
  if (found) return { name: found, warning: `Worksheet "${found}" was used. The expected worksheet name is Export.` };
  return { error: `No worksheet has a Lead Number header. Found: ${names.join(', ')}.` };
}

function isFooterRow(line) {
  const first = line.find((cell) => cell && cell.v != null && String(cell.v).trim() !== '');
  return !!first && /^applied filters/i.test(cellText(first));
}

/**
 * Reads the CRM export ("Export" sheet) or the optional contact file.
 * Every column is located by its header name; position is never assumed.
 */
function parseLeadSheet(buffer, filename, role, XLSX) {
  const fields = role === 'export' ? EXPORT_FIELDS : CONTACT_FILE_FIELDS;
  const label = role === 'export' ? 'CRM export' : 'contact file';
  const opened = readWorkbook(buffer, filename, XLSX);
  if (opened.error) return { errors: [`${label}: ${opened.error}`], warnings: [], rows: [] };
  const picked = pickSheet(opened.wb, XLSX, fields.leadNumber);
  if (picked.error) return { errors: [`${label}: ${picked.error}`], warnings: [], rows: [] };
  const warnings = picked.warning ? [`${label}: ${picked.warning}`] : [];
  const matrix = sheetMatrix(opened.wb.Sheets[picked.name], XLSX);
  const located = locateHeader(matrix, fields.leadNumber);
  const columns = {};
  Object.keys(fields).forEach((key) => {
    columns[key] = located ? findColumn(located.labels, fields[key]) : -1;
  });
  const errors = [];
  if (role === 'export') {
    if (columns.employeeName < 0) errors.push('CRM export: the "Employee Responsible" column was not found.');
    ['initialContact', 'createdDate', 'source', 'status', 'leadType', 'centre'].forEach((key) => {
      if (columns[key] < 0) warnings.push(`CRM export: column not found: ${EXPORT_FIELDS[key][0]}.`);
    });
  } else if (columns.contactStatus < 0) {
    errors.push('Contact file: no contact status column (Initial Contact or Contact Status) was found.');
  }
  if (errors.length) return { errors, warnings, rows: [], sheetName: picked.name, columns };

  const text = (line, key, max) => (columns[key] >= 0 ? clip(cellText(line[columns[key]]), max) : '');
  const rows = [];
  const skipped = { footer: 0, noLead: 0, noEmployee: 0 };
  let invalidDates = 0;
  for (let i = located.index + 1; i < matrix.length; i += 1) {
    const line = matrix[i];
    if (isFooterRow(line)) {
      skipped.footer += 1;
      continue;
    }
    if (rows.length >= MAX_ROWS) {
      return { errors: [`${label}: more than ${MAX_ROWS.toLocaleString('en-GB')} data rows. Split the export before publishing.`], warnings, rows: [], sheetName: picked.name, columns };
    }
    const idCell = line[columns.leadNumber] || null;
    const key = normalizeId(idCell && idCell.v, idCell);
    if (!key) {
      skipped.noLead += 1;
      continue;
    }
    if (role === 'export') {
      const employeeName = text(line, 'employeeName', 160);
      if (!employeeName) {
        skipped.noEmployee += 1;
        continue;
      }
      const created = dateFromCell(columns.createdDate >= 0 ? line[columns.createdDate] : null, XLSX);
      if (created.invalid) invalidDates += 1;
      const initialContact = text(line, 'initialContact', 120);
      rows.push({
        key,
        employeeName,
        initialContact,
        bucket: classifyInitialContact(initialContact),
        createdDisplay: created.display,
        createdSort: created.sort,
        createdIso: created.iso,
        source: text(line, 'source', 160),
        crmStatus: text(line, 'status', 160),
        leadType: text(line, 'leadType', 160),
        centre: text(line, 'centre', 160),
      });
    } else {
      const statusRaw = text(line, 'contactStatus', 120);
      rows.push({
        key,
        statusRaw,
        bucket: classifyContactStatus(statusRaw),
        employeeName: text(line, 'employeeName', 160),
        prospect: text(line, 'prospect', 180),
        model: text(line, 'model', 120),
        telephone: text(line, 'telephone', 40),
      });
    }
  }
  if (invalidDates) warnings.push(`${label}: ${invalidDates} created date${invalidDates === 1 ? '' : 's'} could not be read.`);
  if (!rows.length) {
    const headers = located.labels.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 24);
    return {
      errors: [`${label}: no rows with a Lead Number${role === 'export' ? ' and an Employee Responsible' : ''} were found. Headers found: ${headers.join(', ') || 'none'}.`],
      warnings,
      rows: [],
      sheetName: picked.name,
      columns,
    };
  }
  return { errors: [], warnings, rows, skipped, sheetName: picked.name, columns };
}

function displayName(values) {
  const counts = new Map();
  values.forEach((value) => {
    const text = clip(value, 160);
    if (!text) return;
    counts.set(text, (counts.get(text) || 0) + 1);
  });
  let best = '';
  let bestCount = -1;
  counts.forEach((count, text) => {
    if (count > bestCount) {
      best = text;
      bestCount = count;
    }
  });
  return best;
}

function recId(kind, key, index) {
  return Buffer.from(`${kind}:${key}:${index}`).toString('base64url');
}

function advisorKey(name) {
  const person = normName(name);
  return person ? `name:${person}` : 'name:unassigned';
}

/**
 * Builds the published dataset from the CRM export, deduplicated on Lead
 * Number (first row wins). A contact file, when given, replaces the contact
 * status of the leads it recognises.
 */
function buildExportDataset(exportParsed, contactParsed) {
  const errors = [...(exportParsed.errors || []), ...((contactParsed && contactParsed.errors) || [])];
  const warnings = [...(exportParsed.warnings || []), ...((contactParsed && contactParsed.warnings) || [])];
  if (errors.length) return { errors, warnings, records: [], reconciliation: null };
  if (!contactParsed && exportParsed.columns.initialContact < 0) {
    return {
      errors: ['CRM export: the "Initial Contact" column was not found, so contact status cannot be read. Add that column or push a contact file with it.'],
      warnings,
      records: [],
      reconciliation: null,
    };
  }
  const overlay = new Map();
  if (contactParsed) {
    contactParsed.rows.forEach((row) => {
      if (!overlay.has(row.key)) overlay.set(row.key, row);
    });
  }
  const seen = new Set();
  const records = [];
  const unknownStatuses = new Map();
  let duplicates = 0;
  let overlayMatched = 0;
  const totals = { contacted: 0, notContacted: 0, inProgress: 0, unknown: 0 };
  const months = new Map();
  exportParsed.rows.forEach((row) => {
    if (seen.has(row.key)) {
      duplicates += 1;
      return;
    }
    seen.add(row.key);
    const extra = overlay.get(row.key) || null;
    let bucket = row.bucket;
    let statusRaw = row.initialContact;
    if (extra) {
      overlayMatched += 1;
      if (extra.bucket !== 'missing' && extra.bucket !== 'unknown') {
        bucket = extra.bucket;
        statusRaw = extra.statusRaw;
      }
    }
    if (bucket === 'contacted') totals.contacted += 1;
    else if (bucket === 'not_contacted') totals.notContacted += 1;
    else if (bucket === 'in_progress') totals.inProgress += 1;
    else {
      totals.unknown += 1;
      const label = statusRaw || '(blank)';
      unknownStatuses.set(label, (unknownStatuses.get(label) || 0) + 1);
    }
    if (row.createdIso) {
      const month = row.createdIso.slice(0, 7);
      months.set(month, (months.get(month) || 0) + 1);
    }
    records.push({
      id: recId('lead', row.key, 0),
      matchKind: 'export',
      leadNumber: row.key,
      transactionNo: '',
      prospect: extra ? extra.prospect : '',
      model: extra ? extra.model : '',
      employeeName: row.employeeName,
      employeeNumber: '',
      employeeKey: advisorKey(row.employeeName),
      advisorName: row.employeeName,
      centre: row.centre,
      leadSource: row.source,
      leadType: row.leadType,
      initialContact: row.initialContact,
      contactStatusRaw: statusRaw,
      bucket,
      crmStatus: row.crmStatus,
      createdDisplay: row.createdDisplay,
      createdSort: row.createdSort,
      createdIso: row.createdIso,
      telephone: extra ? extra.telephone : '',
      fields: {},
    });
  });
  if (duplicates) warnings.push(`${duplicates} repeated Lead Number row${duplicates === 1 ? ' was' : 's were'} ignored (first row kept).`);
  if (totals.unknown) warnings.push(`${totals.unknown} lead${totals.unknown === 1 ? ' has' : 's have'} an unrecognised contact status and ${totals.unknown === 1 ? 'is' : 'are'} counted as unknown, not as not contacted.`);
  const skipped = exportParsed.skipped || { footer: 0, noLead: 0, noEmployee: 0 };
  if (skipped.noEmployee) warnings.push(`${skipped.noEmployee} row${skipped.noEmployee === 1 ? '' : 's'} without an Employee Responsible ${skipped.noEmployee === 1 ? 'was' : 'were'} skipped.`);
  let period = '';
  let best = -1;
  months.forEach((count, month) => {
    if (count > best || (count === best && month > period)) {
      period = month;
      best = count;
    }
  });
  if (months.size > 1) warnings.push(`Created Dates span ${months.size} months; the reporting period is ${period}, the month with the most leads.`);
  const advisors = new Set(records.map((record) => record.employeeKey)).size;
  const reconciliation = {
    rows: exportParsed.rows.length,
    leads: records.length,
    advisors,
    ...totals,
    duplicates,
    skippedNoLead: skipped.noLead,
    skippedNoEmployee: skipped.noEmployee,
    footerRows: skipped.footer,
    contactFileRows: contactParsed ? contactParsed.rows.length : 0,
    overlayMatched,
    unknownStatuses: Array.from(unknownStatuses.entries()).slice(0, 20).map(([status, count]) => ({ status, count })),
    equation: `${records.length} leads = ${totals.contacted} contacted + ${totals.notContacted} not contacted + ${totals.inProgress} in progress + ${totals.unknown} unknown`,
  };
  const columns = {
    centre: exportParsed.columns.centre >= 0,
    source: exportParsed.columns.source >= 0,
    leadType: exportParsed.columns.leadType >= 0,
    crmStatus: exportParsed.columns.status >= 0,
    initialContact: exportParsed.columns.initialContact >= 0,
    createdDate: exportParsed.columns.createdDate >= 0,
    prospect: !!(contactParsed && contactParsed.columns.prospect >= 0),
    model: !!(contactParsed && contactParsed.columns.model >= 0),
  };
  return {
    errors: [],
    warnings,
    records,
    reconciliation,
    columns,
    period,
    exportSheet: exportParsed.sheetName || '',
    contactSheet: contactParsed ? contactParsed.sheetName || '' : '',
  };
}

function bucketLabel(bucket) {
  if (bucket === 'contacted') return 'Contacted';
  if (bucket === 'not_contacted') return 'Not Contacted';
  if (bucket === 'in_progress') return 'In Progress';
  if (bucket === 'unmatched') return 'Unmatched — No Contact Record';
  return 'Unknown';
}

function bucketOf(record) {
  const bucket = record.bucket;
  return bucket === 'contacted' || bucket === 'not_contacted' || bucket === 'in_progress' ? bucket : 'unknown';
}

function isLeadRecord(record) {
  return LEAD_KINDS.has(record.matchKind) && !!cleanId(record.leadNumber);
}

function advisorOf(record) {
  return clip(record.advisorName || record.employeeName, 160);
}

function sourceOf(record) {
  return clip(record.leadSource, 160) || NO_SOURCE;
}

function dayOf(record) {
  if (record.createdIso) return record.createdIso;
  if (record.createdSort) return isoDate(new Date(record.createdSort));
  const parsed = parseDateText(record.createdDisplay);
  return parsed ? isoDate(parsed) : '';
}

function passesScope(record, query) {
  if (query.advisor && advisorKey(advisorOf(record)) !== query.advisor) return false;
  if (query.centre && record.centre !== query.centre) return false;
  if (query.source && sourceOf(record) !== query.source) return false;
  if (query.leadType && record.leadType !== query.leadType) return false;
  if (query.q) {
    const hay = `${record.leadNumber} ${record.transactionNo} ${record.prospect} ${record.telephone} ${advisorOf(record)}`.toLowerCase();
    if (!hay.includes(query.q)) return false;
  }
  return true;
}

function passesCrm(record, query) {
  if (query.crm && (record.crmStatus || '(blank)') !== query.crm) return false;
  return true;
}

function passesContact(record, contact) {
  const lead = isLeadRecord(record);
  if (!contact) return lead || record.matchKind === 'crm_only';
  if (contact === 'contacted' || contact === 'not_contacted' || contact === 'in_progress') return lead && record.bucket === contact;
  if (contact === 'unknown') return lead && bucketOf(record) === 'unknown';
  if (contact === 'unmatched') return record.matchKind === 'crm_only';
  return true;
}

function rate(contacted, total) {
  if (!total) return null;
  return Math.round((contacted / total) * 1000) / 10;
}

function uniqueValues(values) {
  return Array.from(new Set(values.map((value) => clip(value, 160)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

/**
 * Everything the dashboard draws, from one publication. Per-advisor daily
 * and source arrays ([contacted, notContacted, inProgress] aligned with
 * days[] and sources[]) let the page refocus without another request.
 */
function summarize(dataset, query) {
  const q = query || {};
  const scope = { ...q, advisor: '' };
  const seen = new Set();
  const leads = [];
  (dataset.records || []).forEach((record) => {
    if (!isLeadRecord(record)) return;
    const lead = cleanId(record.leadNumber);
    if (seen.has(lead)) return;
    seen.add(lead);
    if (passesScope(record, scope) && passesCrm(record, q)) leads.push(record);
  });

  const daySet = new Set();
  const sourceCounts = new Map();
  leads.forEach((record) => {
    const day = dayOf(record);
    if (day) daySet.add(day);
    const source = sourceOf(record);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  });
  const days = Array.from(daySet).sort();
  const sources = Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source]) => source);
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const sourceIndex = new Map(sources.map((source, index) => [source, index]));

  const totals = { total: 0, contacted: 0, notContacted: 0, inProgress: 0, unknown: 0 };
  const groups = new Map();
  leads.forEach((record) => {
    const name = advisorOf(record) || 'Unassigned';
    const key = advisorKey(name);
    let row = groups.get(key);
    if (!row) {
      row = {
        key,
        names: [],
        total: 0,
        contacted: 0,
        notContacted: 0,
        inProgress: 0,
        unknown: 0,
        daily: days.map(() => [0, 0, 0]),
        sources: sources.map(() => [0, 0, 0]),
      };
      groups.set(key, row);
    }
    row.names.push(name);
    row.total += 1;
    totals.total += 1;
    const bucket = bucketOf(record);
    const slot = bucket === 'contacted' ? 0 : bucket === 'not_contacted' ? 1 : bucket === 'in_progress' ? 2 : -1;
    if (slot === 0) { row.contacted += 1; totals.contacted += 1; }
    else if (slot === 1) { row.notContacted += 1; totals.notContacted += 1; }
    else if (slot === 2) { row.inProgress += 1; totals.inProgress += 1; }
    else { row.unknown += 1; totals.unknown += 1; }
    if (slot < 0) return;
    const day = dayIndex.get(dayOf(record));
    if (day != null) row.daily[day][slot] += 1;
    row.sources[sourceIndex.get(sourceOf(record))][slot] += 1;
  });

  const employees = Array.from(groups.values()).map((row) => ({
    key: row.key,
    name: displayName(row.names) || 'Unassigned',
    total: row.total,
    contacted: row.contacted,
    notContacted: row.notContacted,
    inProgress: row.inProgress,
    unknown: row.unknown,
    contactRate: rate(row.contacted, row.total),
    daily: row.daily,
    sources: row.sources,
  }));
  const ratio = (row) => (row.total ? row.contacted / row.total : -1);
  employees.sort((a, b) => ratio(b) - ratio(a) || b.total - a.total || a.name.localeCompare(b.name));
  employees.forEach((row, index) => { row.rank = index + 1; });
  const rates = employees.filter((row) => row.total).map((row) => row.contacted / row.total);
  const kpis = { ...totals, contactRate: rate(totals.contacted, totals.total) };
  const team = {
    ...kpis,
    advisors: employees.length,
    avgRate: rates.length ? Math.round((rates.reduce((sum, value) => sum + value, 0) / rates.length) * 1000) / 10 : null,
  };

  const allLeads = (dataset.records || []).filter(isLeadRecord);
  const options = {
    advisors: employees.map((row) => ({ key: row.key, label: row.name })).sort((a, b) => a.label.localeCompare(b.label)),
    centres: uniqueValues(allLeads.map((row) => row.centre)),
    sources: uniqueValues(allLeads.map(sourceOf)),
    leadTypes: uniqueValues(allLeads.map((row) => row.leadType)),
    crmStatuses: uniqueValues(allLeads.map((row) => row.crmStatus)),
  };
  return {
    kpis,
    team,
    employees,
    days,
    sources,
    options,
    columns: dataset.columns || {},
    reconciliation: dataset.reconciliation || null,
  };
}

function listLeads(dataset, query) {
  const records = (dataset.records || [])
    .filter((record) => passesScope(record, query) && passesCrm(record, query) && passesContact(record, query.contact));
  const sort = ['leadNumber', 'transactionNo', 'prospect', 'model', 'employeeName', 'centre', 'leadSource', 'leadType', 'bucket', 'crmStatus', 'createdSort'].includes(query.sort)
    ? query.sort
    : 'createdSort';
  const dir = query.dir === 'asc' ? 1 : -1;
  const sorted = records.slice().sort((a, b) => {
    const av = a[sort] == null ? '' : a[sort];
    const bv = b[sort] == null ? '' : b[sort];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const page = Math.max(1, Number(query.page) || 1);
  const start = (page - 1) * pageSize;
  const rows = sorted.slice(start, start + pageSize).map(publicLead);
  return { total: sorted.length, page, pageSize, rows };
}

function publicLead(record) {
  return {
    id: record.id,
    matchKind: record.matchKind,
    leadNumber: record.leadNumber,
    transactionNo: record.transactionNo,
    prospect: record.prospect,
    model: record.model,
    employeeName: advisorOf(record) || record.employeeName,
    employeeNumber: record.employeeNumber,
    centre: record.centre,
    leadSource: record.leadSource,
    leadType: record.leadType,
    initialContact: record.initialContact,
    contactStatus: bucketLabel(record.bucket),
    contactStatusRaw: record.contactStatusRaw,
    bucket: record.bucket === 'missing' ? 'unknown' : record.bucket,
    crmStatus: record.crmStatus,
    createdDate: record.createdDisplay,
  };
}

function publicDetail(record) {
  return {
    ...publicLead(record),
    telephone: record.telephone || '',
    fields: record.fields || {},
  };
}

function emptyStore() {
  return { activeId: '', byPeriod: {}, publications: [], drafts: [], audit: [] };
}

function unpublishedMessage() {
  return 'Nothing is published yet. On the Admin page, drop the CRM export (sheet "Export") under Contact Performance, then click Push to live.';
}

function readDiagnostics(parsed) {
  const rows = parsed && Array.isArray(parsed.rows) ? parsed.rows : [];
  return {
    sheet: parsed && parsed.sheetName ? parsed.sheetName : '',
    rows: rows.length,
    columns: parsed && parsed.columns ? parsed.columns : {},
    skipped: parsed && parsed.skipped ? parsed.skipped : null,
    errors: parsed && parsed.errors ? parsed.errors.length : 0,
  };
}

function logContactRead(action, exportParsed, contactParsed) {
  console.log(`[contact-performance] ${action} ${JSON.stringify({
    export: readDiagnostics(exportParsed),
    contact: contactParsed ? readDiagnostics(contactParsed) : null,
  })}`);
}

function attachContactPerformance(app, options) {
  const dir = options.dir;
  const password = String(options.password || '');
  const XLSX = options.XLSX;
  const broadcast = typeof options.broadcast === 'function' ? options.broadcast : () => {};
  const cache = new Map();
  fs.mkdirSync(dir, { recursive: true });
  const storePath = path.join(dir, 'store.json');
  const dataDir = path.join(dir, 'datasets');
  const sourceDir = path.join(dir, 'sources');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });

  function readStore() {
    try {
      if (!fs.existsSync(storePath)) return emptyStore();
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      return {
        activeId: String(parsed.activeId || ''),
        byPeriod: parsed.byPeriod && typeof parsed.byPeriod === 'object' ? parsed.byPeriod : {},
        publications: Array.isArray(parsed.publications) ? parsed.publications : [],
        drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
        audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      };
    } catch (err) {
      return emptyStore();
    }
  }

  function writeStore(store) {
    const tmp = `${storePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, storePath);
  }

  function audit(store, event, message, publicationId) {
    store.audit.unshift({
      at: Date.now(),
      event,
      message: clip(message, 240),
      publicationId: publicationId || '',
    });
    store.audit = store.audit.slice(0, 400);
  }

  function loadDataset(id) {
    if (!id || !/^cp_[a-z0-9]+$/i.test(id)) return null;
    if (cache.has(id)) return cache.get(id);
    const fp = path.join(dataDir, `${id}.json`);
    if (!fs.existsSync(fp)) return null;
    const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
    cache.set(id, parsed);
    if (cache.size > 3) cache.delete(cache.keys().next().value);
    return parsed;
  }

  function requireAdmin(req, res) {
    const given = req.get('x-admin-password') || (req.body && req.body.password) || '';
    if (!passwordOk(given, password)) {
      res.status(401).json({ error: 'Admin password required.' });
      return false;
    }
    return true;
  }

  function publicationMeta(item) {
    return {
      id: item.id,
      period: item.period,
      at: item.at,
      contactFile: item.contactFile,
      crmFile: item.crmFile,
      counts: item.counts,
      active: item.id === readStore().activeId,
    };
  }

  function decodeFile(entry) {
    if (!entry || !entry.base64) return { error: 'Choose a file first.' };
    const name = safeName(entry.name || 'upload');
    let buf;
    try { buf = Buffer.from(String(entry.base64), 'base64'); } catch (err) { return { error: 'The upload could not be read.' }; }
    if (!buf.length) return { error: `${name} is empty.` };
    return { name, buf };
  }

  app.get('/api/contact-performance/meta', (_req, res) => {
    const store = readStore();
    const active = store.publications.find((item) => item.id === store.activeId) || null;
    const failed = store.audit.find((entry) => entry.event === 'publication_failed') || null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      activeId: store.activeId || '',
      publishedAt: active ? active.at : 0,
      period: active ? active.period : '',
      contactFile: active ? active.contactFile : '',
      crmFile: active ? active.crmFile : '',
      counts: active ? (active.counts || null) : null,
      warnings: active ? (active.warnings || []) : [],
      lastError: failed ? { at: failed.at, message: failed.message } : null,
      diagnostic: {
        published: Boolean(store.activeId),
        publications: store.publications.length,
        contactFile: Boolean(active && active.contactFile),
        crmFile: Boolean(active && active.crmFile),
        message: store.activeId ? '' : unpublishedMessage(),
      },
      periods: Object.keys(store.byPeriod).sort().map((period) => {
        const item = store.publications.find((row) => row.id === store.byPeriod[period]);
        return item ? { id: item.id, period: item.period, at: item.at, contactFile: item.contactFile, crmFile: item.crmFile } : null;
      }).filter(Boolean),
    });
  });

  app.get('/api/contact-performance/summary', (req, res) => {
    const store = readStore();
    const id = String(req.query.publication || store.byPeriod[req.query.period] || store.activeId || '');
    const dataset = loadDataset(id);
    res.setHeader('Cache-Control', 'no-store');
    if (!dataset) {
      console.log(`[contact-performance] summary empty ${JSON.stringify({ activeId: store.activeId || '', requested: id || '', publications: store.publications.length })}`);
      return res.json({
        empty: true,
        kpis: null,
        team: null,
        employees: [],
        days: [],
        sources: [],
        options: {},
        reconciliation: null,
        diagnostic: {
          published: false,
          publications: store.publications.length,
          message: unpublishedMessage(),
        },
      });
    }
    const summary = summarize(dataset, readQuery(req));
    const pub = store.publications.find((item) => item.id === id) || null;
    res.json({
      empty: false,
      publicationId: id,
      period: pub ? pub.period : '',
      publishedAt: pub ? pub.at : 0,
      fileName: pub ? (pub.crmFile || pub.contactFile || '') : '',
      contactFile: pub ? pub.contactFile || '' : '',
      crmFile: pub ? pub.crmFile || '' : '',
      counts: pub ? (pub.counts || null) : null,
      warnings: pub ? (pub.warnings || []) : [],
      active: id === store.activeId,
      ...summary,
    });
  });

  app.get('/api/contact-performance/leads', (req, res) => {
    const store = readStore();
    const id = String(req.query.publication || store.byPeriod[req.query.period] || store.activeId || '');
    const dataset = loadDataset(id);
    if (!dataset) return res.json({ total: 0, page: 1, pageSize: 25, rows: [] });
    res.setHeader('Cache-Control', 'no-store');
    res.json(listLeads(dataset, readQuery(req)));
  });

  app.get('/api/contact-performance/leads/:recordId', (req, res) => {
    const store = readStore();
    const id = String(req.query.publication || store.activeId || '');
    const dataset = loadDataset(id);
    if (!dataset) return res.status(404).json({ error: 'No published dataset.' });
    const record = (dataset.records || []).find((item) => item.id === req.params.recordId);
    if (!record) return res.status(404).json({ error: 'Record not found.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicDetail(record));
  });

  app.post('/api/contact-performance/preview', (req, res) => {
    const body = req.body || {};
    const fallbackPeriod = /^\d{4}-\d{2}$/.test(String(body.period || '')) ? String(body.period) : '';
    if (!body.crmFile || !body.crmFile.base64) {
      return res.status(400).json({ error: 'Add the CRM export (sheet "Export") first. The contact file is optional.' });
    }
    const crmFile = decodeFile(body.crmFile);
    if (crmFile.error) return res.status(400).json({ error: crmFile.error });
    const contactFile = body.contactFile && body.contactFile.base64 ? decodeFile(body.contactFile) : null;
    if (contactFile && contactFile.error) return res.status(400).json({ error: contactFile.error });
    const store = readStore();
    audit(store, 'upload_started', `Validation started for ${crmFile.name}.`);
    const exportParsed = parseLeadSheet(crmFile.buf, crmFile.name, 'export', XLSX);
    const contactParsed = contactFile ? parseLeadSheet(contactFile.buf, contactFile.name, 'contact', XLSX) : null;
    logContactRead('preview', exportParsed, contactParsed);
    const dataset = buildExportDataset(exportParsed, contactParsed);
    if (dataset.errors.length) {
      audit(store, 'publication_failed', dataset.errors[0].slice(0, 180));
      writeStore(store);
      return res.status(422).json({
        error: 'Publication has been blocked.',
        errors: dataset.errors,
        warnings: dataset.warnings,
        diagnostics: { export: readDiagnostics(exportParsed), contact: contactParsed ? readDiagnostics(contactParsed) : null },
      });
    }
    const now = new Date();
    const period = dataset.period || fallbackPeriod || `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    if (!dataset.period) dataset.warnings.push(`No Created Dates could be read; the reporting period is ${period}.`);
    const hash = contentHash(contactFile ? contactFile.buf : null, crmFile.buf);
    const counts = publicCounts(dataset);
    const existing = store.publications.find((item) => item.period === period && item.hash === hash);
    if (existing) {
      audit(store, 'publication_duplicate', `Same file already live for ${period}. No new snapshot created.`, existing.id);
      writeStore(store);
      return res.json({
        ok: true,
        duplicate: true,
        existingId: existing.id,
        period,
        contactFile: existing.contactFile,
        crmFile: existing.crmFile,
        warnings: dataset.warnings,
        reconciliation: dataset.reconciliation,
        counts,
      });
    }
    const id = `cp_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const previous = store.drafts[0];
    if (previous && previous.id) removePublicationFiles(previous.id);
    const draft = {
      id,
      period,
      hash,
      at: Date.now(),
      by: clip(body.publishedBy || 'Administrator', 80) || 'Administrator',
      contactFile: contactFile ? contactFile.name : '',
      crmFile: crmFile.name,
      status: 'draft',
      counts,
      warnings: dataset.warnings.slice(0, 40),
      contactSheet: dataset.contactSheet,
      crmSheet: dataset.exportSheet,
    };
    fs.mkdirSync(path.join(sourceDir, id), { recursive: true });
    if (contactFile) fs.writeFileSync(path.join(sourceDir, id, 'contact' + path.extname(contactFile.name).slice(0, 6)), contactFile.buf);
    fs.writeFileSync(path.join(sourceDir, id, 'crm' + path.extname(crmFile.name).slice(0, 6)), crmFile.buf);
    const stored = { records: dataset.records, reconciliation: dataset.reconciliation, columns: dataset.columns };
    const tmp = path.join(dataDir, `${id}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(stored));
    fs.renameSync(tmp, path.join(dataDir, `${id}.json`));
    cache.set(id, stored);
    store.drafts = [draft];
    audit(store, 'validation_completed', `Validation passed for ${period}. ${dataset.reconciliation.leads} leads.`, id);
    writeStore(store);
    res.json({
      ok: true,
      draftId: id,
      period,
      contactFile: draft.contactFile,
      crmFile: crmFile.name,
      contactSheet: dataset.contactSheet,
      crmSheet: dataset.exportSheet,
      warnings: dataset.warnings,
      reconciliation: dataset.reconciliation,
      counts,
    });
  });

  app.post('/api/contact-performance/publish', (req, res) => {
    const draftId = String((req.body && req.body.draftId) || '');
    const store = readStore();
    const draft = store.drafts.find((item) => item.id === draftId);
    if (!draft) return res.status(404).json({ error: 'Validate the files again. This preview is no longer available.' });
    if (!loadDataset(draftId)) return res.status(409).json({ error: 'The validated dataset is missing. Run validation again.' });
    const existing = draft.hash
      ? store.publications.find((item) => item.period === draft.period && item.hash === draft.hash)
      : null;
    if (existing) {
      removePublicationFiles(draft.id);
      cache.delete(draft.id);
      store.drafts = store.drafts.filter((item) => item.id !== draft.id);
      audit(store, 'publication_duplicate', `Same file already live for ${draft.period}. No new snapshot created.`, existing.id);
      writeStore(store);
      return res.json({ ok: true, duplicate: true, id: existing.id, at: existing.at, period: existing.period });
    }
    const publication = { ...draft, status: 'published', at: Date.now() };
    store.publications.unshift(publication);
    store.publications = store.publications.slice(0, 60);
    store.byPeriod[publication.period] = publication.id;
    store.activeId = publication.id;
    store.drafts = [];
    audit(store, 'publication_succeeded', `Published ${publication.period}.`, publication.id);
    writeStore(store);
    broadcast(publication.at);
    res.json({ ok: true, id: publication.id, at: publication.at, period: publication.period });
  });

  app.post('/api/contact-performance/cancel', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const draftId = String((req.body && req.body.draftId) || '');
    const store = readStore();
    const draft = store.drafts.find((item) => item.id === draftId);
    if (!draft) return res.json({ ok: true });
    removePublicationFiles(draft.id);
    cache.delete(draft.id);
    store.drafts = store.drafts.filter((item) => item.id !== draft.id);
    audit(store, 'upload_cancelled', 'Preview cancelled. The published dataset was not changed.', draft.id);
    writeStore(store);
    res.json({ ok: true });
  });

  app.get('/api/contact-performance/history', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const store = readStore();
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      activeId: store.activeId,
      publications: store.publications.map((item) => ({
        ...publicationMeta(item),
        by: item.by || 'Administrator',
        status: item.status || 'published',
        warnings: item.warnings || [],
        contactSheet: item.contactSheet || '',
        active: item.id === store.activeId,
      })),
      audit: store.audit,
    });
  });

  app.get('/api/contact-performance/publication/:id', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const store = readStore();
    const item = store.publications.find((row) => row.id === req.params.id) || store.drafts.find((row) => row.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Publication not found.' });
    const dataset = loadDataset(item.id);
    res.json({
      ...publicationMeta(item),
      by: item.by || 'Administrator',
      warnings: item.warnings || [],
      contactSheet: item.contactSheet || '',
      reconciliation: dataset ? dataset.reconciliation : null,
      active: item.id === store.activeId,
    });
  });

  app.post('/api/contact-performance/rollback', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = String((req.body && req.body.publicationId) || '');
    const store = readStore();
    const item = store.publications.find((row) => row.id === id);
    if (!item) return res.status(404).json({ error: 'Publication not found.' });
    if (!loadDataset(id)) return res.status(409).json({ error: 'That dataset file is no longer on the server.' });
    store.activeId = id;
    if (item.period) store.byPeriod[item.period] = id;
    audit(store, 'rollback_completed', `Active dataset set to ${item.period}.`, id);
    writeStore(store);
    broadcast(Date.now());
    res.json({ ok: true, id, period: item.period });
  });

  app.get('/api/contact-performance/source/:id/:which', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const which = req.params.which === 'crm' ? 'crm' : req.params.which === 'contact' ? 'contact' : '';
    if (!which || !/^cp_[a-z0-9]+$/i.test(req.params.id)) return res.status(404).json({ error: 'File not found.' });
    const folder = path.join(sourceDir, req.params.id);
    if (!fs.existsSync(folder)) return res.status(404).json({ error: 'File not found.' });
    const file = fs.readdirSync(folder).find((name) => name.startsWith(which));
    if (!file) return res.status(404).json({ error: 'File not found.' });
    const store = readStore();
    const meta = store.publications.find((item) => item.id === req.params.id) || store.drafts.find((item) => item.id === req.params.id);
    const downloadName = (meta && meta[which === 'crm' ? 'crmFile' : 'contactFile']) || file;
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(downloadName)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(folder, file));
  });

  function removePublicationFiles(id) {
    if (!/^cp_[a-z0-9]+$/i.test(id)) return;
    const dataFile = path.join(dataDir, `${id}.json`);
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
    const folder = path.join(sourceDir, id);
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
  }

  function publicCounts(dataset) {
    const rec = dataset.reconciliation || {};
    return {
      leads: rec.leads || 0,
      advisors: rec.advisors || 0,
      contacted: rec.contacted || 0,
      notContacted: rec.notContacted || 0,
      inProgress: rec.inProgress || 0,
      unknown: rec.unknown || 0,
      duplicates: rec.duplicates || 0,
      skipped: (rec.skippedNoLead || 0) + (rec.skippedNoEmployee || 0),
      contactFileRows: rec.contactFileRows || 0,
    };
  }

  function readQuery(req) {
    const q = req.query || {};
    return {
      advisor: clip(q.advisor, 180),
      centre: clip(q.centre, 160),
      source: clip(q.source, 160),
      leadType: clip(q.leadType, 160),
      crm: clip(q.crm, 160),
      contact: clip(q.contact, 40),
      q: clip(q.q, 80).toLowerCase(),
      sort: clip(q.sort, 40),
      dir: q.dir === 'asc' ? 'asc' : 'desc',
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 25,
    };
  }
}

module.exports = {
  attachContactPerformance,
  contentHash,
  classifyContactStatus,
  classifyInitialContact,
  normalizeId,
  parseLeadSheet,
  buildExportDataset,
  summarize,
  listLeads,
  passwordOk,
};
