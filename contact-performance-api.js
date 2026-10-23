'use strict';

/**
 * Contact Performance — data flow (single source of truth: Admin Push).
 *
 * 1. Admin page (report-sheet/admin.html) collects two files in the
 *    "CRM export and contact file" card (ContactPerformance.mountAdmin):
 *    the contact file and the CRM export. Nothing is live yet.
 * 2. The existing Push to live button (pushToLive) calls
 *    ContactPerformance.publishDraft(), which sends both files as base64 JSON:
 *      POST /api/contact-performance/preview  { period, publishedBy, contactFile, crmFile }
 *    The server parses and validates both workbooks and stores a draft
 *    (dataset JSON + source files under <dir>/datasets and <dir>/sources).
 *    Invalid files return 422 and never touch the published dataset.
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
const MATCH_COL = 2;
/** Contact-tracking file: employee name is always column E (index 4). */
const EMPLOYEE_NAME_COL = 4;
/** Contact-tracking file: Contacted / Not Contacted status is always column G (index 6). */
const EXPORT_STATUS_COL = 6;
const CONTACTED = new Set(['contacted', 'contact done', 'reached', 'successfully contacted', 'contact successful', 'contact complete', 'already contacted']);
const NOT_CONTACTED = new Set(['not contacted', 'not contact', 'no contact', 'uncontacted', 'not yet contacted', 'not yet contact', 'awaiting contact']);
const IN_PROGRESS = new Set(['in progress', 'inprogress', 'pending', 'follow up', 'followup', 'attempting', 'callback', 'call back', 'scheduled', 'working', 'open']);

const CONTACT_FIELDS = {
  leadNumber: ['lead number', 'lead no', 'lead #', 'lead id'],
  initialContact: ['initial contact', 'first contact', 'initial contact status', 'first contact status'],
  employeeName: ['employee responsible', 'responsible employee', 'employee name', 'advisor', 'advisor name', 'sales advisor', 'salesman', 'sales consultant', 'employee', 'agent', 'agent name', 'user', 'user name'],
  createdDate: ['created date', 'date created', 'create date', 'created on'],
  status: ['status', 'contact status', 'lead status', 'crm contact status', 'export status', 'contact result', 'result'],
  source: ['source', 'lead source'],
  centre: ['centre name', 'center name', 'centre', 'center', 'branch', 'showroom', 'showroom name'],
  leadType: ['lead type'],
};
const CRM_FIELDS = {
  transactionNo: ['transaction no', 'transaction no.', 'transaction number', 'transaction #', 'txn no', 'txn number', 'lead number', 'lead no', 'lead #', 'lead id'],
  prospect: ['prospect', 'prospect name', 'customer', 'customer name'],
  model: ['model', 'vehicle model'],
  status: ['crm status', 'status'],
  employeeName: ['employee responsible', 'responsible employee', 'employee name', 'advisor', 'advisor name', 'sales advisor', 'salesman', 'sales consultant', 'employee'],
  telephone: ['telephone', 'telephone no', 'telephone no.', 'phone', 'phone no', 'mobile', 'mobile no', 'mobile number'],
  employeeNumber: ['employee number', 'employee no', 'employee no.', 'emp no', 'employee id'],
  centre: ['centre', 'center', 'centre name', 'center name', 'branch', 'showroom', 'showroom name'],
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

function classifyContactStatus(raw) {
  const compact = normHeader(raw).replace(/[_-]+/g, ' ');
  if (!compact) return 'missing';
  if (NOT_CONTACTED.has(compact) || /not[\s-]+contact/.test(compact) || compact.includes('no contact') || compact.includes('not reached') || compact.includes('uncontact')) return 'not_contacted';
  if (CONTACTED.has(compact) || compact.includes('contacted') || compact === 'contact' || (compact.includes('reached') && !compact.includes('not'))) return 'contacted';
  if (IN_PROGRESS.has(compact)) return 'in_progress';
  return 'unknown';
}

function classifyInitialContact(raw) {
  const compact = normHeader(raw).replace(/[_-]+/g, ' ');
  if (!compact) return 'missing';
  if (/^(no|n|false|0)$/.test(compact)) return 'not_contacted';
  if (/^(yes|y|true|1)$/.test(compact)) return 'contacted';
  return classifyContactStatus(raw);
}

function headerMatches(label, aliases) {
  const norm = normHeader(label);
  return !!norm && aliases.some((alias) => normHeader(alias) === norm);
}

function chooseTrackedColumn(labels, namedCol, aliases, lockedIndex) {
  if (lockedIndex >= 0 && headerMatches(labels[lockedIndex], aliases)) return lockedIndex;
  if (namedCol >= 0) return namedCol;
  return -1;
}

function fmtDate(date) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${date.getFullYear()}`;
}

function parseDateText(text) {
  const value = String(text || '').trim();
  let match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
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

function dateFromCell(cell, XLSX) {
  if (!cell || cell.v == null || cell.v === '') return { display: '', sort: 0, invalid: false };
  if (cell.v instanceof Date) {
    if (Number.isNaN(cell.v.getTime())) return { display: clip(cell.w, 40), sort: 0, invalid: true };
    return { display: fmtDate(cell.v), sort: cell.v.getTime(), invalid: false };
  }
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    const formatted = typeof cell.w === 'string' ? cell.w.trim() : '';
    const fmt = String(cell.z || '');
    const looksDate = (/[ydm]/i.test(fmt) && !/^[#0.]+$/.test(fmt)) || /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(formatted);
    if (looksDate && XLSX && XLSX.SSF && typeof XLSX.SSF.parse_date_code === 'function') {
      const parsed = XLSX.SSF.parse_date_code(cell.v);
      if (parsed && parsed.y > 1900 && parsed.y < 2100) {
        const date = new Date(parsed.y, parsed.m - 1, parsed.d);
        return { display: fmtDate(date), sort: date.getTime(), invalid: false };
      }
    }
  }
  const text = cellText(cell);
  const parsed = parseDateText(text);
  if (parsed) return { display: fmtDate(parsed), sort: parsed.getTime(), invalid: false };
  return { display: clip(text, 40), sort: 0, invalid: !!text };
}

function cellText(cell) {
  if (!cell || cell.v == null || cell.v === '') return '';
  if (cell.v instanceof Date && !Number.isNaN(cell.v.getTime())) return fmtDate(cell.v);
  if (typeof cell.w === 'string' && cell.w.trim()) return cell.w.trim();
  return String(cell.v).trim();
}

function findColumn(headers, aliases) {
  const norms = headers.map(normHeader);
  for (const alias of aliases) {
    const wanted = normHeader(alias);
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

function sheetHasHeader(ws, XLSX, aliases) {
  if (!ws || !XLSX) return false;
  try {
    return !!locateHeader(sheetMatrix(ws, XLSX), aliases);
  } catch (err) {
    return false;
  }
}

function pickSheet(wb, role, XLSX) {
  const names = (wb && wb.SheetNames) || [];
  if (!names.length) return { error: 'The file has no worksheet.' };
  if (role === 'contact') {
    const exact = names.find((name) => normHeader(name) === 'export');
    if (exact) return { name: exact };
    const found = names.find((name) => sheetHasHeader(wb.Sheets[name], XLSX, CONTACT_FIELDS.leadNumber));
    if (found) {
      return {
        name: found,
        warning: names.length === 1
          ? `Worksheet "${found}" was used. The expected worksheet name is Export.`
          : `Worksheet "${found}" was used because it contains Lead Number. The expected worksheet name is Export.`,
      };
    }
    if (names.length === 1) {
      return { name: names[0], warning: `Worksheet "${names[0]}" was used. The expected worksheet name is Export.` };
    }
    return { error: `Expected an Export worksheet with a Lead Number header. Found: ${names.join(', ')}.` };
  }
  const found = names.find((name) => sheetHasHeader(wb.Sheets[name], XLSX, CRM_FIELDS.transactionNo));
  if (found && found !== names[0]) {
    return { name: found, warning: `Worksheet "${found}" was used because it contains the lead identifier.` };
  }
  return { name: names[0] };
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

function parseTable(buffer, filename, role, XLSX) {
  const opened = readWorkbook(buffer, filename, XLSX);
  if (opened.error) return { errors: [opened.error], warnings: [], rows: [] };
  const picked = pickSheet(opened.wb, role, XLSX);
  if (picked.error) return { errors: [picked.error], warnings: [], rows: [] };
  const warnings = picked.warning ? [picked.warning] : [];
  if (opened.encoding && opened.encoding !== 'workbook') {
    const delimiter = opened.delimiter === '\t' ? 'tab' : opened.delimiter;
    warnings.push(`Read as ${opened.encoding}${delimiter ? `, delimiter ${delimiter}` : ''}.`);
  }
  const ws = opened.wb.Sheets[picked.name];
  const matrix = sheetMatrix(ws, XLSX);
  const fields = role === 'contact' ? CONTACT_FIELDS : CRM_FIELDS;
  const idKey = role === 'contact' ? 'leadNumber' : 'transactionNo';
  const aliases = Object.keys(fields).reduce((list, key) => list.concat(fields[key]), []);
  const located = locateHeader(matrix, aliases);
  if (!located) {
    return { errors: ['No header row was found, so column C could not be matched.'], warnings, rows: [], sheetName: picked.name };
  }
  const columns = {};
  Object.keys(fields).forEach((key) => {
    columns[key] = findColumn(located.labels, fields[key]);
  });
  const namedCol = columns[idKey];
  columns[idKey] = chooseTrackedColumn(located.labels, namedCol, fields[idKey], MATCH_COL);
  const columnCHeader = located.labels[MATCH_COL] || '';
  if (columns[idKey] === MATCH_COL && namedCol >= 0 && namedCol !== MATCH_COL) {
    warnings.push(`The named identifier is not in column C. Matching uses column C${columnCHeader ? ` ("${columnCHeader}")` : ''}.`);
  } else if (columns[idKey] >= 0 && columns[idKey] !== MATCH_COL) {
    const header = located.labels[columns[idKey]] || 'identifier';
    warnings.push(`Matching uses "${header}" from the header row.`);
  } else if (columns[idKey] < 0) {
    warnings.push('No identifier header was found.');
  }
  if (role === 'contact') {
    const namedStatus = columns.status;
    const namedEmployee = columns.employeeName;
    const hasColG = located.labels.length > EXPORT_STATUS_COL;
    const hasColE = located.labels.length > EMPLOYEE_NAME_COL;
    // Always lock Contacted / Not Contacted to column G when the sheet has that column.
    columns.status = hasColG ? EXPORT_STATUS_COL : namedStatus;
    // Always lock employee name to column E when the sheet has that column.
    columns.employeeName = hasColE ? EMPLOYEE_NAME_COL : namedEmployee;
    const statusHeader = String(located.labels[EXPORT_STATUS_COL] || '').trim();
    const employeeHeader = String(located.labels[EMPLOYEE_NAME_COL] || '').trim();
    if (columns.status === EXPORT_STATUS_COL) {
      warnings.push(`Contact status (Contacted / Not Contacted) is read from column G${statusHeader ? ` ("${statusHeader}")` : ''}.`);
      if (namedStatus >= 0 && namedStatus !== EXPORT_STATUS_COL) {
        warnings.push(`Ignored other status column "${located.labels[namedStatus] || 'status'}".`);
      }
    } else if (columns.status >= 0) {
      warnings.push(`Contact status is read from "${located.labels[columns.status] || 'status'}" (file has no column G).`);
    } else {
      warnings.push('Contact status column was not found. Initial Contact is used when it is filled in.');
    }
    if (columns.employeeName === EMPLOYEE_NAME_COL) {
      warnings.push(`Employee name is read from column E${employeeHeader ? ` ("${employeeHeader}")` : ''}.`);
      if (namedEmployee >= 0 && namedEmployee !== EMPLOYEE_NAME_COL) {
        warnings.push(`Ignored other employee column "${located.labels[namedEmployee] || 'employee'}".`);
      }
    } else if (columns.employeeName < 0) {
      warnings.push('Column not found: Employee Responsible (column E). Matched leads use the CRM employee when that column is present.');
    }
  }
  ['initialContact', 'createdDate', 'source', 'centre', 'leadType'].forEach((key) => {
    if (role === 'contact' && columns[key] < 0) warnings.push(`Column not found: ${CONTACT_FIELDS[key][0]}.`);
  });
  if (role === 'crm') {
    ['prospect', 'model', 'status', 'employeeName', 'telephone', 'employeeNumber', 'centre'].forEach((key) => {
      if (columns[key] < 0) warnings.push(`Column not found: ${CRM_FIELDS[key][0]}.`);
    });
  }
  const rows = [];
  let invalidDates = 0;
  for (let i = located.index + 1; i < matrix.length; i += 1) {
    if (rows.length >= MAX_ROWS) {
      return { errors: [`The file has more than ${MAX_ROWS.toLocaleString('en-GB')} data rows. Split the export before publishing.`], warnings, rows: [], sheetName: picked.name };
    }
    const line = matrix[i];
    const idCell = line[role === 'contact' ? columns.leadNumber : columns.transactionNo] || null;
    const key = normalizeId(idCell && idCell.v, idCell);
    if (role === 'contact') {
      const created = dateFromCell(columns.createdDate >= 0 ? line[columns.createdDate] : null, XLSX);
      if (created.invalid) invalidDates += 1;
      const statusRaw = columns.status >= 0 ? clip(cellText(line[columns.status]), 120) : '';
      const initialContact = columns.initialContact >= 0 ? clip(cellText(line[columns.initialContact]), 120) : '';
      let bucket = classifyContactStatus(statusRaw);
      if (bucket === 'missing' && initialContact) {
        const fromInitial = classifyInitialContact(initialContact);
        if (fromInitial !== 'missing') bucket = fromInitial;
      }
      rows.push({
        key,
        leadNumber: key,
        initialContact,
        employeeName: columns.employeeName >= 0 ? clip(cellText(line[columns.employeeName]), 160) : '',
        createdDisplay: created.display,
        createdSort: created.sort,
        statusRaw,
        bucket,
        source: columns.source >= 0 ? clip(cellText(line[columns.source]), 160) : '',
        centre: columns.centre >= 0 ? clip(cellText(line[columns.centre]), 160) : '',
        leadType: columns.leadType >= 0 ? clip(cellText(line[columns.leadType]), 160) : '',
      });
    } else {
      const fieldsOut = {};
      located.labels.forEach((labelText, index) => {
        if (!labelText || Object.values(columns).includes(index)) return;
        if (Object.keys(fieldsOut).length >= 12) return;
        const value = clip(cellText(line[index]), 300);
        if (value) fieldsOut[clip(labelText, 80)] = value;
      });
      rows.push({
        key,
        transactionNo: key,
        prospect: columns.prospect >= 0 ? clip(cellText(line[columns.prospect]), 180) : '',
        model: columns.model >= 0 ? clip(cellText(line[columns.model]), 120) : '',
        statusRaw: columns.status >= 0 ? clip(cellText(line[columns.status]), 160) : '',
        employeeName: columns.employeeName >= 0 ? clip(cellText(line[columns.employeeName]), 160) : '',
        employeeNumber: columns.employeeNumber >= 0 ? normalizeId(line[columns.employeeNumber] && line[columns.employeeNumber].v, line[columns.employeeNumber]) : '',
        telephone: columns.telephone >= 0 ? clip(cellText(line[columns.telephone]), 40) : '',
        centre: columns.centre >= 0 ? clip(cellText(line[columns.centre]), 160) : '',
        fields: fieldsOut,
      });
    }
  }
  if (invalidDates) warnings.push(`${invalidDates} created date${invalidDates === 1 ? '' : 's'} could not be read and were kept as text.`);
  const withKey = rows.filter((row) => row.key).length;
  if (!withKey) {
    const idHeader = columns[idKey] >= 0 ? String(located.labels[columns[idKey]] || '').trim() : '';
    const headers = located.labels.map((label) => String(label || '').trim()).filter(Boolean).slice(0, 24);
    const where = idHeader ? `"${idHeader}"` : 'Column C';
    return {
      errors: [`${where} in the ${role === 'contact' ? 'contact-tracking file' : 'CRM export'} has no values to match. Publication has been blocked. Headers found: ${headers.join(', ') || 'none'}.`],
      warnings,
      rows: [],
      sheetName: picked.name,
      columns,
    };
  }
  return {
    errors: [],
    warnings,
    rows,
    sheetName: picked.name,
    columns,
    encoding: opened.encoding || '',
    delimiter: opened.delimiter || '',
  };
}

function groupRows(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    if (!groups.has(row.key)) groups.set(row.key, []);
    groups.get(row.key).push(row);
  });
  return groups;
}

function resolveGroup(group, signature) {
  if (group.length === 1) return { row: group[0], extra: 0, unresolved: false };
  const sigs = new Set(group.map(signature));
  if (sigs.size === 1) {
    const sorted = group.slice().sort((a, b) => (b.createdSort || 0) - (a.createdSort || 0));
    return { row: sorted[0], extra: group.length - 1, unresolved: false };
  }
  return { row: null, extra: group.length, unresolved: true };
}

function employeeKeyFor(number, name) {
  const num = cleanId(number);
  if (num) return `num:${num}`;
  const person = normName(name);
  if (person) return `name:${person}`;
  return '';
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

function buildDataset(contactParsed, crmParsed) {
  const errors = [...(contactParsed.errors || []), ...(crmParsed.errors || [])];
  const warnings = [...(contactParsed.warnings || []), ...(crmParsed.warnings || [])];
  if (errors.length) {
    return { errors, warnings, records: [], reconciliation: null };
  }
  const contactGroups = groupRows((contactParsed.rows || []).filter((row) => row.key));
  const crmGroups = groupRows((crmParsed.rows || []).filter((row) => row.key));
  const contactMissing = (contactParsed.rows || []).filter((row) => !row.key).length;
  const crmMissing = (crmParsed.rows || []).filter((row) => !row.key).length;
  const contactResolved = new Map();
  const crmResolved = new Map();
  let contactDuplicateKeys = 0;
  let crmDuplicateKeys = 0;
  let contactDuplicateRows = 0;
  let crmDuplicateRows = 0;
  let contactUnresolved = 0;
  let crmUnresolved = 0;
  const duplicateSamples = [];

  contactGroups.forEach((group, key) => {
    const resolved = resolveGroup(group, (row) => [row.bucket, normName(row.employeeName), row.centre, row.statusRaw].join('|'));
    if (group.length > 1) {
      contactDuplicateKeys += 1;
      contactDuplicateRows += group.length - 1;
    }
    if (resolved.unresolved) {
      contactUnresolved += 1;
      if (duplicateSamples.length < 30) duplicateSamples.push({ source: 'Contact tracking', key });
      return;
    }
    contactResolved.set(key, resolved.row);
  });
  crmGroups.forEach((group, key) => {
    const resolved = resolveGroup(group, (row) => [normHeader(row.statusRaw), cleanId(row.employeeNumber), normName(row.employeeName), row.centre].join('|'));
    if (group.length > 1) {
      crmDuplicateKeys += 1;
      crmDuplicateRows += group.length - 1;
    }
    if (resolved.unresolved) {
      crmUnresolved += 1;
      if (duplicateSamples.length < 30) duplicateSamples.push({ source: 'CRM', key });
      return;
    }
    crmResolved.set(key, resolved.row);
  });
  if (contactUnresolved || crmUnresolved) {
    warnings.push(`${contactUnresolved + crmUnresolved} duplicate key${contactUnresolved + crmUnresolved === 1 ? '' : 's'} could not be resolved and ${contactUnresolved + crmUnresolved === 1 ? 'was' : 'were'} left out of the match. Review them before treating the totals as complete.`);
  }
  if (contactMissing || crmMissing) {
    warnings.push(`${contactMissing + crmMissing} row${contactMissing + crmMissing === 1 ? '' : 's'} with a blank identifier ${contactMissing + crmMissing === 1 ? 'was' : 'were'} kept in reconciliation and not matched.`);
  }

  const records = [];
  const unknownStatuses = new Map();
  const employeeIssues = [];
  let employeeIssueCount = 0;
  let matched = 0;
  let crmOnly = 0;
  let contactOnly = 0;
  let unknownStatus = 0;

  crmResolved.forEach((crm, key) => {
    const contact = contactResolved.get(key) || null;
    const contactConflict = contactGroups.has(key) && !contact;
    // Prefer contact-file column E for the person name when present; CRM fills gaps.
    const employeeName = (contact && contact.employeeName) || crm.employeeName || '';
    const employeeNumber = crm.employeeNumber || '';
    const employeeKey = employeeKeyFor(employeeNumber, employeeName);
    if (contactConflict) {
      records.push({
        id: recId('duplicate', key, 0),
        matchKind: 'duplicate',
        leadNumber: key,
        transactionNo: crm.transactionNo,
        prospect: crm.prospect,
        model: crm.model,
        employeeName,
        employeeNumber,
        employeeKey,
        centre: crm.centre || '',
        leadSource: '',
        leadType: '',
        initialContact: '',
        contactStatusRaw: 'Duplicate key',
        bucket: 'unknown',
        crmStatus: crm.statusRaw || '',
        createdDisplay: '',
        createdSort: 0,
        telephone: crm.telephone || '',
        fields: { Note: 'This column C value matches more than one contact row and those rows do not agree, so it was not matched.' },
      });
      return;
    }
    if (contact) {
      matched += 1;
      if (contact.bucket === 'unknown' || contact.bucket === 'missing') {
        unknownStatus += 1;
        const label = contact.statusRaw || '(blank)';
        unknownStatuses.set(label, (unknownStatuses.get(label) || 0) + 1);
      }
      if (contact.employeeName && crm.employeeName && normName(contact.employeeName) !== normName(crm.employeeName)) {
        employeeIssueCount += 1;
        if (employeeIssues.length < 20) employeeIssues.push({ key, contactName: contact.employeeName, crmName: crm.employeeName });
      }
      records.push({
        id: recId('matched', key, 0),
        matchKind: 'matched',
        leadNumber: contact.leadNumber,
        transactionNo: crm.transactionNo,
        prospect: crm.prospect,
        model: crm.model,
        employeeName,
        employeeNumber,
        employeeKey,
        advisorName: contact.employeeName || employeeName,
        centre: crm.centre || contact.centre || '',
        leadSource: contact.source || '',
        leadType: contact.leadType || '',
        initialContact: contact.initialContact || '',
        contactStatusRaw: contact.statusRaw || '',
        bucket: contact.bucket,
        crmStatus: crm.statusRaw || '',
        createdDisplay: contact.createdDisplay || '',
        createdSort: contact.createdSort || 0,
        telephone: crm.telephone || '',
        fields: crm.fields || {},
      });
    } else {
      crmOnly += 1;
      records.push({
        id: recId('crm', key, 0),
        matchKind: 'crm_only',
        leadNumber: '',
        transactionNo: crm.transactionNo,
        prospect: crm.prospect,
        model: crm.model,
        employeeName,
        employeeNumber,
        employeeKey,
        centre: crm.centre || '',
        leadSource: '',
        leadType: '',
        initialContact: '',
        contactStatusRaw: '',
        bucket: 'unmatched',
        crmStatus: crm.statusRaw || '',
        createdDisplay: '',
        createdSort: 0,
        telephone: crm.telephone || '',
        fields: crm.fields || {},
      });
    }
  });
  contactResolved.forEach((contact, key) => {
    if (crmResolved.has(key)) return;
    contactOnly += 1;
    const employeeKey = employeeKeyFor('', contact.employeeName);
    records.push({
      id: recId('contact', key, 0),
      matchKind: 'contact_only',
      leadNumber: contact.leadNumber,
      transactionNo: '',
      prospect: '',
      model: '',
      employeeName: contact.employeeName || '',
      employeeNumber: '',
      employeeKey,
      advisorName: contact.employeeName || '',
      centre: contact.centre || '',
      leadSource: contact.source || '',
      leadType: contact.leadType || '',
      initialContact: contact.initialContact || '',
      contactStatusRaw: contact.statusRaw || '',
      bucket: contact.bucket,
      crmStatus: '',
      createdDisplay: contact.createdDisplay || '',
      createdSort: contact.createdSort || 0,
      telephone: '',
      fields: {},
    });
  });

  const reconciliation = {
    crmUnique: crmResolved.size,
    contactUnique: contactResolved.size,
    matched,
    crmOnly,
    contactOnly,
    crmDuplicateKeys,
    contactDuplicateKeys,
    crmDuplicateRows,
    contactDuplicateRows,
    crmMissingId: crmMissing,
    contactMissingId: contactMissing,
    crmUnresolved,
    contactUnresolved,
    unknownStatus,
    unknownStatuses: Array.from(unknownStatuses.entries()).slice(0, 20).map(([status, count]) => ({ status, count })),
    employeeIssueCount,
    employeeIssues,
    duplicateSamples,
    equation: `${matched} matched + ${crmOnly} unmatched = ${matched + crmOnly} unique CRM leads`,
  };
  const columns = {
    centre: (contactParsed.columns && contactParsed.columns.centre >= 0) || (crmParsed.columns && crmParsed.columns.centre >= 0),
    source: !!(contactParsed.columns && contactParsed.columns.source >= 0),
    leadType: !!(contactParsed.columns && contactParsed.columns.leadType >= 0),
    crmStatus: !!(crmParsed.columns && crmParsed.columns.status >= 0),
    employeeNumber: !!(crmParsed.columns && crmParsed.columns.employeeNumber >= 0),
    initialContact: !!(contactParsed.columns && contactParsed.columns.initialContact >= 0),
    model: !!(crmParsed.columns && crmParsed.columns.model >= 0),
    prospect: !!(crmParsed.columns && crmParsed.columns.prospect >= 0),
  };
  return {
    errors,
    warnings,
    records,
    reconciliation,
    columns,
    contactSheet: contactParsed.sheetName || '',
    crmSheet: crmParsed.sheetName || '',
    contactRows: (contactParsed.rows || []).length,
    crmRows: (crmParsed.rows || []).length,
  };
}

function bucketLabel(bucket) {
  if (bucket === 'contacted') return 'Contacted';
  if (bucket === 'not_contacted') return 'Not Contacted';
  if (bucket === 'in_progress') return 'In Progress';
  if (bucket === 'missing') return 'Unknown/Missing Status';
  if (bucket === 'unknown') return 'Unknown/Missing Status';
  if (bucket === 'unmatched') return 'Unmatched — No Contact Record';
  return 'Unknown/Missing Status';
}

function passesScope(record, query) {
  if (query.employee && record.employeeKey !== query.employee) return false;
  if (query.centre && record.centre !== query.centre) return false;
  if (query.source && record.leadSource !== query.source) return false;
  if (query.leadType && record.leadType !== query.leadType) return false;
  if (query.q) {
    const hay = `${record.leadNumber} ${record.transactionNo} ${record.prospect} ${record.telephone}`.toLowerCase();
    if (!hay.includes(query.q)) return false;
  }
  return true;
}

function passesCrm(record, query) {
  if (query.crm && (record.crmStatus || '(blank)') !== query.crm) return false;
  return true;
}

function passesContact(record, contact) {
  if (!contact) return record.matchKind === 'matched' || record.matchKind === 'crm_only';
  if (contact === 'contacted') return record.matchKind === 'matched' && record.bucket === 'contacted';
  if (contact === 'not_contacted') return record.matchKind === 'matched' && record.bucket === 'not_contacted';
  if (contact === 'in_progress') return record.matchKind === 'matched' && record.bucket === 'in_progress';
  if (contact === 'unknown') return record.matchKind === 'matched' && (record.bucket === 'unknown' || record.bucket === 'missing');
  if (contact === 'matched') return record.matchKind === 'matched';
  if (contact === 'unmatched') return record.matchKind === 'crm_only';
  if (contact === 'contact_only') return record.matchKind === 'contact_only';
  if (contact === 'duplicate') return record.matchKind === 'duplicate';
  if (contact === 'missing_id') return record.matchKind === 'missing_id';
  return true;
}

function rate(contacted, matched) {
  if (!matched) return null;
  return Math.round((contacted / matched) * 1000) / 10;
}

function advisorShare(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function advisorAchievement(records, query) {
  const seen = new Set();
  const groups = new Map();
  (records || []).forEach((record) => {
    if (!passesScope(record, query) || !passesCrm(record, query)) return;
    if (record.matchKind !== 'matched' && record.matchKind !== 'contact_only') return;
    const lead = cleanId(record.leadNumber);
    if (!lead) return;
    if (seen.has(lead)) return;
    const bucket = record.bucket === 'missing' ? 'unknown' : record.bucket;
    if (bucket !== 'contacted' && bucket !== 'not_contacted' && bucket !== 'in_progress' && bucket !== 'unknown') return;
    seen.add(lead);
    const rawName = clip(record.advisorName || record.employeeName, 160);
    const person = normName(rawName);
    const key = person ? `name:${person}` : 'name:unassigned';
    if (!groups.has(key)) {
      groups.set(key, { key, names: [], contacted: 0, notContacted: 0, inProgress: 0, unknown: 0 });
    }
    const row = groups.get(key);
    if (rawName) row.names.push(rawName);
    if (bucket === 'contacted') row.contacted += 1;
    else if (bucket === 'not_contacted') row.notContacted += 1;
    else if (bucket === 'in_progress') row.inProgress += 1;
    else row.unknown += 1;
  });
  return Array.from(groups.values()).map((row) => {
    const total = row.contacted + row.notContacted + row.inProgress + row.unknown;
    return {
      key: row.key,
      name: displayName(row.names) || 'Unassigned',
      contacted: row.contacted,
      notContacted: row.notContacted,
      inProgress: row.inProgress,
      unknown: row.unknown,
      total,
      ach: advisorShare(row.contacted, total),
      notContactedPct: advisorShare(row.notContacted, total),
      inProgressPct: advisorShare(row.inProgress, total),
    };
  }).sort((a, b) => (b.ach == null ? -1 : b.ach) - (a.ach == null ? -1 : a.ach) || b.total - a.total || a.name.localeCompare(b.name));
}

function summarize(dataset, query) {
  const records = dataset.records || [];
  const optionQuery = { ...query, employee: '' };
  const optionScoped = records.filter((record) => passesScope(record, optionQuery) && passesCrm(record, query));
  const scoped = records.filter((record) => passesScope(record, query));
  const crmScoped = scoped.filter((record) => passesCrm(record, query));
  const universe = crmScoped.filter((record) => record.matchKind === 'matched' || record.matchKind === 'crm_only');
  const matchedRows = universe.filter((record) => record.matchKind === 'matched');
  const contacted = matchedRows.filter((record) => record.bucket === 'contacted').length;
  const exportContacted = (dataset.records || []).filter((record) => (record.matchKind === 'matched' || record.matchKind === 'contact_only') && record.bucket === 'contacted').length;
  const exportNotContacted = (dataset.records || []).filter((record) => (record.matchKind === 'matched' || record.matchKind === 'contact_only') && record.bucket === 'not_contacted').length;
  const notContacted = matchedRows.filter((record) => record.bucket === 'not_contacted').length;
  const inProgress = matchedRows.filter((record) => record.bucket === 'in_progress').length;
  const unknown = matchedRows.filter((record) => record.bucket === 'unknown' || record.bucket === 'missing').length;
  const unmatched = universe.filter((record) => record.matchKind === 'crm_only').length;
  const distribution = [
    { key: 'contacted', label: 'Contacted', count: exportContacted, crmPct: true },
    { key: 'not_contacted', label: 'Not Contacted', count: exportNotContacted, crmPct: true },
    { key: 'in_progress', label: 'In Progress', count: inProgress },
    { key: 'unknown', label: 'Unknown/Missing Status', count: unknown },
    { key: 'unmatched', label: 'Unmatched — No Contact Record', count: unmatched },
  ];
  const distTotal = distribution.reduce((sum, item) => sum + item.count, 0);
  distribution.forEach((item) => {
    if (item.crmPct) item.pct = rate(item.count, universe.length) || 0;
    else item.pct = distTotal ? Math.round((item.count / distTotal) * 1000) / 10 : 0;
    delete item.crmPct;
  });
  const crmCounts = new Map();
  scoped.filter((record) => record.matchKind === 'matched' || record.matchKind === 'crm_only').forEach((record) => {
    const label = record.crmStatus || '(blank)';
    crmCounts.set(label, (crmCounts.get(label) || 0) + 1);
  });
  const crmBars = Array.from(crmCounts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const byEmployee = new Map();
  universe.forEach((record) => {
    const key = record.employeeKey || 'name:unassigned';
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        key,
        names: [],
        number: record.employeeNumber || '',
        matched: 0,
        contacted: 0,
        notContacted: 0,
        inProgress: 0,
      });
    }
    const row = byEmployee.get(key);
    if (record.employeeName) row.names.push(record.employeeName);
    if (record.employeeNumber) row.number = record.employeeNumber;
    if (record.matchKind !== 'matched') return;
    row.matched += 1;
    if (record.bucket === 'contacted') row.contacted += 1;
    else if (record.bucket === 'not_contacted') row.notContacted += 1;
    else if (record.bucket === 'in_progress') row.inProgress += 1;
  });
  const employees = Array.from(byEmployee.values()).map((row) => ({
    key: row.key,
    name: displayName(row.names) || 'Unassigned',
    number: row.number || '',
    matched: row.matched,
    contacted: row.contacted,
    notContacted: row.notContacted,
    inProgress: row.inProgress,
    contactRate: rate(row.contacted, row.matched),
    ach: null,
  }));
  employees.sort((a, b) => (b.contactRate == null ? -1 : b.contactRate) - (a.contactRate == null ? -1 : a.contactRate) || b.matched - a.matched || b.contacted - a.contacted || a.name.localeCompare(b.name));
  employees.forEach((row, index) => { row.rank = index + 1; });

  const optionUniverse = optionScoped.filter((record) => record.matchKind === 'matched' || record.matchKind === 'crm_only');
  const optionMatched = optionUniverse.filter((record) => record.matchKind === 'matched');
  const optionEmployees = new Map();
  optionUniverse.forEach((record) => {
    const key = record.employeeKey || 'name:unassigned';
    if (!optionEmployees.has(key)) optionEmployees.set(key, { key, names: [], number: record.employeeNumber || '' });
    if (record.employeeName) optionEmployees.get(key).names.push(record.employeeName);
    if (record.employeeNumber) optionEmployees.get(key).number = record.employeeNumber;
  });
  const options = {
    employees: Array.from(optionEmployees.values())
      .map((row) => {
        const name = displayName(row.names) || 'Unassigned';
        return { key: row.key, label: row.number ? `${name} · ${row.number}` : name };
      })
      .sort((a, b) => a.label.localeCompare(b.label)),
    centres: uniqueValues(optionUniverse.map((row) => row.centre)),
    sources: uniqueValues(optionMatched.map((row) => row.leadSource)),
    leadTypes: uniqueValues(optionMatched.map((row) => row.leadType)),
    crmStatuses: uniqueValues(optionUniverse.map((row) => row.crmStatus)),
  };
  return {
    kpis: {
      totalCrm: universe.length,
      matched: matchedRows.length,
      contacted,
      notContacted,
      inProgress,
      unknown,
      contactRate: rate(contacted, matchedRows.length),
      exportContacted,
      contactedOfCrm: rate(exportContacted, universe.length),
      exportNotContacted,
      notContactedOfCrm: rate(exportNotContacted, universe.length),
    },
    distribution,
    crmBars,
    employees,
    advisors: advisorAchievement(records, query),
    options,
    columns: dataset.columns || {},
    reconciliation: dataset.reconciliation || null,
  };
}

function uniqueValues(values) {
  return Array.from(new Set(values.map((value) => clip(value, 160)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
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
    employeeName: record.employeeName,
    employeeNumber: record.employeeNumber,
    centre: record.centre,
    leadSource: record.leadSource,
    leadType: record.leadType,
    initialContact: record.initialContact,
    contactStatus: bucketLabel(record.bucket),
    contactStatusRaw: record.contactStatusRaw,
    bucket: record.bucket,
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
  return 'No contact file and CRM export are stored. On Admin, drop both files under CRM & Contact, then click Push to live.';
}

function readDiagnostics(parsed) {
  const rows = parsed && Array.isArray(parsed.rows) ? parsed.rows : [];
  return {
    sheet: parsed && parsed.sheetName ? parsed.sheetName : '',
    rows: rows.length,
    withId: rows.filter((row) => row.key).length,
    columns: parsed && parsed.columns ? parsed.columns : {},
    errors: parsed && parsed.errors ? parsed.errors.length : 0,
  };
}

function logContactRead(action, contactParsed, crmParsed) {
  console.log(`[contact-performance] ${action} ${JSON.stringify({
    contact: readDiagnostics(contactParsed),
    crm: readDiagnostics(crmParsed),
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
    if (!dataset) {
      console.log(`[contact-performance] summary empty ${JSON.stringify({ activeId: store.activeId || '', requested: id || '', publications: store.publications.length })}`);
      return res.json({
        empty: true,
        kpis: null,
        distribution: [],
        crmBars: [],
        employees: [],
        advisors: [],
        options: {},
        reconciliation: null,
        diagnostic: {
          published: false,
          publications: store.publications.length,
          contactFile: false,
          crmFile: false,
          message: unpublishedMessage(),
        },
      });
    }
    const summary = summarize(dataset, readQuery(req));
    const pub = store.publications.find((item) => item.id === id) || null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      empty: false,
      publicationId: id,
      period: pub ? pub.period : '',
      publishedAt: pub ? pub.at : 0,
      contactFile: pub ? pub.contactFile : '',
      crmFile: pub ? pub.crmFile : '',
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
    const period = String(body.period || '');
    if (!/^\d{4}-\d{2}$/.test(period)) return res.status(400).json({ error: 'Choose a reporting period as YYYY-MM.' });
    const contactFile = decodeFile(body.contactFile);
    const crmFile = decodeFile(body.crmFile);
    if (contactFile.error) return res.status(400).json({ error: contactFile.error });
    if (crmFile.error) return res.status(400).json({ error: crmFile.error });
    const store = readStore();
    audit(store, 'upload_started', `Validation started for ${period}.`);
    const contactParsed = parseTable(contactFile.buf, contactFile.name, 'contact', XLSX);
    const crmParsed = parseTable(crmFile.buf, crmFile.name, 'crm', XLSX);
    logContactRead('preview', contactParsed, crmParsed);
    const dataset = buildDataset(contactParsed, crmParsed);
    if (dataset.errors.length) {
      audit(store, 'publication_failed', dataset.errors[0].slice(0, 180));
      writeStore(store);
      return res.status(422).json({
        error: 'Publication has been blocked.',
        errors: dataset.errors,
        warnings: dataset.warnings,
        diagnostics: { contact: readDiagnostics(contactParsed), crm: readDiagnostics(crmParsed) },
      });
    }
    const hash = contentHash(contactFile.buf, crmFile.buf);
    const existing = store.publications.find((item) => item.period === period && item.hash === hash);
    if (existing) {
      audit(store, 'publication_duplicate', `Same files already live for ${period}. No new snapshot created.`, existing.id);
      writeStore(store);
      return res.json({
        ok: true,
        duplicate: true,
        existingId: existing.id,
        period,
        contactFile: existing.contactFile,
        crmFile: existing.crmFile,
        contactRows: dataset.contactRows,
        crmRows: dataset.crmRows,
        warnings: dataset.warnings,
        reconciliation: dataset.reconciliation,
        counts: publicCounts(dataset),
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
      contactFile: contactFile.name,
      crmFile: crmFile.name,
      status: 'draft',
      counts: publicCounts(dataset),
      warnings: dataset.warnings.slice(0, 40),
      contactSheet: dataset.contactSheet,
      crmSheet: dataset.crmSheet,
    };
    fs.mkdirSync(path.join(sourceDir, id), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, id, 'contact' + path.extname(contactFile.name).slice(0, 6)), contactFile.buf);
    fs.writeFileSync(path.join(sourceDir, id, 'crm' + path.extname(crmFile.name).slice(0, 6)), crmFile.buf);
    const tmp = path.join(dataDir, `${id}.json.tmp`);
    fs.writeFileSync(tmp, JSON.stringify({
      records: dataset.records,
      reconciliation: dataset.reconciliation,
      columns: dataset.columns,
    }));
    fs.renameSync(tmp, path.join(dataDir, `${id}.json`));
    cache.set(id, { records: dataset.records, reconciliation: dataset.reconciliation, columns: dataset.columns });
    store.drafts = [draft];
    audit(store, 'validation_completed', `Validation passed for ${period}. ${dataset.reconciliation.matched} matched.`, id);
    writeStore(store);
    res.json({
      ok: true,
      draftId: id,
      period,
      contactFile: contactFile.name,
      crmFile: crmFile.name,
      contactSheet: dataset.contactSheet,
      crmSheet: dataset.crmSheet,
      contactRows: dataset.contactRows,
      crmRows: dataset.crmRows,
      warnings: dataset.warnings,
      reconciliation: dataset.reconciliation,
      counts: draft.counts,
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
      audit(store, 'publication_duplicate', `Same files already live for ${draft.period}. No new snapshot created.`, existing.id);
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
      crmUnique: rec.crmUnique || 0,
      contactUnique: rec.contactUnique || 0,
      matched: rec.matched || 0,
      crmOnly: rec.crmOnly || 0,
      contactOnly: rec.contactOnly || 0,
      duplicates: (rec.crmUnresolved || 0) + (rec.contactUnresolved || 0),
      missingIds: (rec.crmMissingId || 0) + (rec.contactMissingId || 0),
    };
  }

  function readQuery(req) {
    const q = req.query || {};
    return {
      employee: clip(q.employee, 180),
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
  chooseTrackedColumn,
  normalizeId,
  parseTable,
  buildDataset,
  summarize,
  listLeads,
  passwordOk,
};
