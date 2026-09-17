'use strict';

const express = require('express');
const XLSX = require('xlsx');
const {
  STATUSES,
  COMPLETED_STATUS,
  YES_NO,
  CARRIERS,
  TRANSFER_CITIES,
  EMPLOYEE_NAMES,
  USERS,
  HEADER_MAP,
  OPS_FIELDS,
} = require('./constants');
const { createStore } = require('./store');

function na(v) {
  const s = String(v == null ? '' : v).trim();
  return s || 'N/A';
}

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickCol(row, aliases) {
  const keys = Object.keys(row || {});
  const entries = keys.map((k) => ({ orig: k, norm: normalizeHeader(k) }));
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    const hit = entries.find((e) => e.norm === a);
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    const hit = entries.find((e) => {
      if (!e.norm || e.norm === a) return false;
      if (e.norm.startsWith(`${a} `) || e.norm.endsWith(` ${a}`) || e.norm.includes(` ${a} `)) return true;
      if (a.length <= 3) return e.norm.startsWith(`${a} `) || e.norm.startsWith(a);
      return e.norm.includes(a);
    });
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  return '';
}

function excelSerialToIso(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  // Excel serial date (UTC-ish)
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(num * 86400000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return excelSerialToIso(value);
  }
  const s = String(value).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const day = String(m[1]).padStart(2, '0');
    const mon = String(m[2]).padStart(2, '0');
    return `${y}-${mon}-${day}`;
  }
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToIso(Number(s));
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return '';
}

function todayIso(tzOffsetMinutes) {
  // Default Asia/Riyadh (+3) when no offset provided
  const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 180;
  const now = new Date(Date.now() + offset * 60000);
  return now.toISOString().slice(0, 10);
}

function isYesNo(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'yes' || s === 'y' || s === 'نعم' || s === '1' || s === 'true') return 'Yes';
  if (s === 'no' || s === 'n' || s === 'لا' || s === '0' || s === 'false') return 'No';
  return '';
}

function emptyOps() {
  return {
    guestSentDate: '',
    signatureReceivedDate: '',
    accountsSentDate: '',
    accountsApprovalDate: '',
    vin1502: '',
    opsStatus: '',
    trafficFile: '',
    trafficFeesOps: '',
    insuranceOps: '',
    registrationIssueDate: '',
    transferCity: '',
    carrier: '',
    notes: '',
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    assignedBy: '',
    assignedAt: '',
    updatedBy: '',
    updatedAt: '',
  };
}

function mapRawRow(row) {
  const raw = {};
  for (const [key, aliases] of Object.entries(HEADER_MAP)) {
    raw[key] = pickCol(row, aliases);
  }
  raw.proformaDate = normalizeDate(raw.proformaDate);
  raw.deliveryDate = normalizeDate(raw.deliveryDate);
  raw.registrationDate = normalizeDate(raw.registrationDate);
  raw.date = normalizeDate(raw.date) || raw.date;
  return raw;
}

function publicVehicle(v) {
  if (!v) return null;
  return {
    vin: v.vin,
    raw: {
      date: na(v.raw.date),
      salesOrder: na(v.raw.salesOrder),
      product: na(v.raw.product),
      pic: na(v.raw.pic),
      salesType: na(v.raw.salesType),
      invoiceOwner: na(v.raw.invoiceOwner),
      userName: na(v.raw.userName),
      salesAdvisor: na(v.raw.salesAdvisor),
      proformaDate: na(v.raw.proformaDate),
      deliveryDate: na(v.raw.deliveryDate),
      gtLocation: na(v.raw.gtLocation),
      vehicleLocation: na(v.raw.vehicleLocation),
      phone: na(v.raw.phone),
      status: na(v.raw.status),
      traffic: na(v.raw.traffic),
      trafficFees: na(v.raw.trafficFees),
      insurance: na(v.raw.insurance),
      registrationDate: na(v.raw.registrationDate),
    },
    ops: { ...emptyOps(), ...v.ops },
    createdAt: v.createdAt,
    rawUpdatedAt: v.rawUpdatedAt,
    lastUploadId: v.lastUploadId || '',
  };
}

function canSeeAll(role) {
  return role === 'admin' || role === 'hanouf';
}

function createDeliveryTeamRouter(opts) {
  const filePath = opts.filePath;
  const password = String(opts.password || '1234').trim();
  const store = createStore(filePath);
  const router = express.Router();

  function auth(req, res, next) {
    const header = req.headers['x-delivery-team-token']
      || req.headers.authorization
      || '';
    let token = String(header).trim();
    if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
    if (!token && req.body && req.body.token) token = String(req.body.token).trim();
    if (!token && req.query && req.query.token) token = String(req.query.token).trim();
    const session = store.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized — please sign in' });
    req.dtUser = session;
    req.dtToken = token;
    return next();
  }

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!req.dtUser || !roles.includes(req.dtUser.role)) {
        return res.status(403).json({ error: 'Forbidden for this role' });
      }
      return next();
    };
  }

  function scopedVehicles(user) {
    const all = store.allVehicles();
    if (canSeeAll(user.role)) return all;
    return all.filter((v) => v.ops && v.ops.assignedEmployeeId === user.userId);
  }

  function assertVinAccess(req, res, vin) {
    const key = normVin(vin);
    const v = store.getVehicle(key);
    if (!v) {
      res.status(404).json({ error: 'VIN not found' });
      return null;
    }
    if (!canSeeAll(req.dtUser.role) && v.ops.assignedEmployeeId !== req.dtUser.userId) {
      res.status(403).json({ error: 'You do not have access to this VIN' });
      return null;
    }
    return v;
  }

  router.get('/meta', (_req, res) => {
    res.json({
      statuses: STATUSES,
      carriers: CARRIERS,
      transferCities: TRANSFER_CITIES,
      yesNo: YES_NO,
      employees: EMPLOYEE_NAMES,
      users: USERS.map((u) => ({ id: u.id, name: u.name, role: u.role })),
      completedStatus: COMPLETED_STATUS,
    });
  });

  router.post('/auth/login', (req, res) => {
    const user = store.getUserByLogin(req.body && req.body.username);
    if (!user) return res.status(401).json({ error: 'Unknown user' });
    const pass = String((req.body && req.body.password) || '').trim();
    if (pass !== password) return res.status(401).json({ error: 'Invalid password' });
    const token = store.createSession(user);
    return res.json({
      ok: true,
      token,
      user: { id: user.id, name: user.name, role: user.role },
    });
  });

  router.post('/auth/logout', auth, (req, res) => {
    store.destroySession(req.dtToken);
    res.json({ ok: true });
  });

  router.get('/auth/me', auth, (req, res) => {
    res.json({ user: { id: req.dtUser.userId, name: req.dtUser.name, role: req.dtUser.role } });
  });

  function applyFilters(list, q) {
    let out = list.slice();
    const search = String(q.q || q.search || '').trim().toLowerCase();
    if (search) {
      out = out.filter((v) => {
        const hay = [
          v.vin,
          v.raw.salesOrder,
          v.raw.product,
          v.ops.assignedEmployeeName,
          v.ops.opsStatus,
          v.raw.invoiceOwner,
          v.raw.userName,
          v.raw.salesAdvisor,
          v.raw.phone,
          v.ops.transferCity,
          v.ops.carrier,
          v.raw.gtLocation,
          v.raw.vehicleLocation,
        ].join(' ').toLowerCase();
        return hay.includes(search);
      });
    }
    const eq = (field, val) => {
      if (!val) return;
      const want = String(val).trim().toLowerCase();
      out = out.filter((v) => String(field(v) || '').trim().toLowerCase() === want);
    };
    eq((v) => v.ops.assignedEmployeeName || v.ops.assignedEmployeeId, q.employee);
    eq((v) => v.raw.product, q.product);
    eq((v) => v.raw.salesType, q.salesType);
    eq((v) => v.ops.opsStatus, q.status);
    eq((v) => v.raw.vehicleLocation, q.vehicleLocation);
    eq((v) => v.raw.gtLocation, q.gtLocation);
    eq((v) => v.ops.transferCity, q.transferCity);
    eq((v) => v.ops.carrier, q.carrier);
    eq((v) => v.ops.trafficFile, q.trafficFile);
    eq((v) => v.ops.trafficFeesOps, q.trafficFees);
    eq((v) => v.ops.insuranceOps, q.insurance);
    eq((v) => v.ops.vin1502, q.vin1502);
    if (q.assigned === 'yes') out = out.filter((v) => !!v.ops.assignedEmployeeId);
    if (q.assigned === 'no') out = out.filter((v) => !v.ops.assignedEmployeeId);
    if (q.proforma === 'today') {
      const today = todayIso(Number(q.tzOffset));
      out = out.filter((v) => v.raw.proformaDate === today);
    }
    if (q.date) {
      const d = normalizeDate(q.date) || String(q.date).slice(0, 10);
      out = out.filter((v) => v.raw.proformaDate === d || v.raw.date === d);
    }
    return out;
  }

  function sortVehicles(list, sort, dir) {
    const key = String(sort || 'proformaDate');
    const desc = String(dir || 'desc').toLowerCase() === 'desc';
    const getter = {
      vin: (v) => v.vin,
      product: (v) => v.raw.product,
      salesOrder: (v) => v.raw.salesOrder,
      proformaDate: (v) => v.raw.proformaDate,
      status: (v) => v.ops.opsStatus,
      employee: (v) => v.ops.assignedEmployeeName,
      updatedAt: (v) => v.ops.updatedAt || v.rawUpdatedAt || '',
    }[key] || ((v) => v.raw.proformaDate);
    return list.slice().sort((a, b) => {
      const av = String(getter(a) || '');
      const bv = String(getter(b) || '');
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return desc ? -cmp : cmp;
    });
  }

  router.get('/vehicles', auth, (req, res) => {
    let list = scopedVehicles(req.dtUser);
    list = applyFilters(list, req.query || {});
    list = sortVehicles(list, req.query.sort, req.query.dir);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
    const total = list.length;
    const start = (page - 1) * limit;
    const slice = list.slice(start, start + limit).map(publicVehicle);
    res.json({
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      rows: slice,
    });
  });

  router.get('/vehicles/:vin', auth, (req, res) => {
    const v = assertVinAccess(req, res, req.params.vin);
    if (!v) return undefined;
    return res.json({ vehicle: publicVehicle(v) });
  });

  router.get('/dashboard', auth, (req, res) => {
    const all = scopedVehicles(req.dtUser);
    const today = todayIso(Number(req.query.tzOffset));
    const todays = all.filter((v) => v.raw.proformaDate === today);
    const assigned = all.filter((v) => v.ops.assignedEmployeeId);
    const unassigned = all.filter((v) => !v.ops.assignedEmployeeId);
    const byStatus = {};
    STATUSES.forEach((s) => { byStatus[s] = 0; });
    all.forEach((v) => {
      const s = v.ops.opsStatus;
      if (s && byStatus[s] != null) byStatus[s] += 1;
    });
    const claimed = byStatus[COMPLETED_STATUS] || 0;
    const employees = EMPLOYEE_NAMES.map((name) => {
      const id = name.toLowerCase();
      const mine = all.filter((v) => v.ops.assignedEmployeeId === id);
      const done = mine.filter((v) => v.ops.opsStatus === COMPLETED_STATUS);
      const rem = mine.length - done.length;
      const pct = mine.length ? Math.round((done.length / mine.length) * 100) : 0;
      return { id, name, assigned: mine.length, claimed: done.length, remaining: rem, progress: pct };
    });

    const mine = canSeeAll(req.dtUser.role)
      ? null
      : (() => {
        const rows = all;
        const done = rows.filter((v) => v.ops.opsStatus === COMPLETED_STATUS);
        return {
          assigned: rows.length,
          completed: done.length,
          remaining: rows.length - done.length,
          progress: rows.length ? Math.round((done.length / rows.length) * 100) : 0,
        };
      })();

    res.json({
      today,
      totals: {
        total: all.length,
        todaysProformas: todays.length,
        assigned: assigned.length,
        unassigned: unassigned.length,
        claimed,
        psfu: byStatus.PSFU || 0,
        ready: byStatus['جاهز للتسليم'] || 0,
        delivered: byStatus['تم التسليم'] || 0,
      },
      byStatus,
      pipeline: {
        todaysProformas: todays.length,
        assigned: assigned.length,
        psfu: byStatus.PSFU || 0,
        ready: byStatus['جاهز للتسليم'] || 0,
        delivered: (byStatus['تم التسليم'] || 0) + claimed,
      },
      employees,
      myWorkload: mine,
    });
  });

  router.get('/todays-proformas', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const today = todayIso(Number(req.query.tzOffset));
    const rows = store.allVehicles()
      .filter((v) => v.raw.proformaDate === today)
      .map(publicVehicle);
    res.json({ today, total: rows.length, rows });
  });

  router.get('/unassigned', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const todayOnly = String(req.query.today || '') === '1';
    const today = todayIso(Number(req.query.tzOffset));
    let list = store.allVehicles().filter((v) => !v.ops.assignedEmployeeId);
    if (todayOnly) list = list.filter((v) => v.raw.proformaDate === today);
    list = sortVehicles(list, 'proformaDate', 'desc');
    res.json({ total: list.length, rows: list.map(publicVehicle) });
  });

  /** Resolve a submitted VIN list for Hanouf display-before-assign. */
  router.post('/resolve-vins', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const rawList = Array.isArray(req.body.vins) ? req.body.vins : String(req.body.vins || '').split(/[\s,;]+/);
    const keys = [];
    const seen = new Set();
    rawList.forEach((v) => {
      const key = normVin(v);
      if (!key || seen.has(key)) return;
      seen.add(key);
      keys.push(key);
    });
    if (!keys.length) return res.status(400).json({ error: 'Submit at least one VIN' });

    const found = [];
    const missing = [];
    keys.forEach((key) => {
      const v = store.getVehicle(key);
      if (v) found.push(publicVehicle(v));
      else missing.push(key);
    });
    return res.json({
      total: found.length,
      missing,
      rows: found,
    });
  });

  // Upload handler is mounted on the main app BEFORE express.json (binary Excel).
  function uploadHandler(req, res) {
    const header = req.headers['x-delivery-team-token'] || req.headers.authorization || '';
    let token = String(header).trim();
    if (/^bearer\s+/i.test(token)) token = token.replace(/^bearer\s+/i, '').trim();
    const session = store.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized — please sign in' });
    if (!['admin', 'hanouf'].includes(session.role)) {
      return res.status(403).json({ error: 'Only Hanouf / Admin can upload Raw Data' });
    }
    req.dtUser = session;

    try {
      const buf = req.body;
      if (!Buffer.isBuffer(buf) || !buf.length) {
        return res.status(400).json({ error: 'Invalid file — empty upload' });
      }
      const filename = decodeURIComponent(String(req.headers['x-filename'] || 'raw-data.xlsx'));
      let workbook;
      try {
        workbook = XLSX.read(buf, { type: 'buffer', cellDates: true, raw: false });
      } catch (e) {
        return res.status(400).json({ error: `Invalid file — ${e.message || 'cannot parse Excel'}` });
      }
      const sheetNames = workbook.SheetNames || [];
      if (!sheetNames.length) {
        return res.status(400).json({ error: 'No worksheet found in workbook' });
      }
      // CRITICAL: first worksheet only
      const sheetName = sheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) return res.status(400).json({ error: 'First worksheet is missing' });

      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true, cellDates: true });
      if (!matrix.length) {
        return res.status(400).json({ error: 'First worksheet is empty' });
      }

      let headerIdx = 0;
      let bestHits = -1;
      const vinAliases = HEADER_MAP.vin.map(normalizeHeader);
      const pfAliases = HEADER_MAP.proformaDate.map(normalizeHeader);
      for (let i = 0; i < Math.min(matrix.length, 30); i += 1) {
        const cells = (matrix[i] || []).map((c) => normalizeHeader(c));
        if (!cells.some(Boolean)) continue;
        const hits = cells.filter((c) => vinAliases.some((a) => c === a || c.includes(a))
          || pfAliases.some((a) => c === a || c.includes(a))
          || c.includes('product')
          || c.includes('sales order')).length;
        if (hits > bestHits) {
          bestHits = hits;
          headerIdx = i;
        }
        if (hits >= 2) break;
      }
      const headerRow = matrix[headerIdx] || [];
      const headers = headerRow.map((h, i) => {
        const t = String(h == null ? '' : h).trim();
        return t || `Column ${i + 1}`;
      });
      const hasVin = headers.some((h) => {
        const n = normalizeHeader(h);
        return vinAliases.some((a) => n === a || n.includes(a));
      });
      if (!hasVin) {
        return res.status(400).json({ error: 'Missing VIN column — expected Chassis / VIN header on first worksheet' });
      }

      const today = todayIso(Number(req.headers['x-tz-offset']) || 180);
      let rowsProcessed = 0;
      let newVins = 0;
      let updatedVins = 0;
      let todaysProformas = 0;
      let duplicateInFile = 0;
      const errors = [];
      const seenInFile = new Set();
      const uploadId = `up_${Date.now()}`;

      for (let r = headerIdx + 1; r < matrix.length; r += 1) {
        const line = matrix[r] || [];
        if (line.every((c) => String(c == null ? '' : c).trim() === '')) continue;
        const obj = {};
        headers.forEach((h, i) => { obj[h] = line[i] != null ? line[i] : ''; });
        const raw = mapRawRow(obj);
        const vinKey = normVin(raw.vin);
        if (!vinKey) {
          errors.push({ row: r + 1, error: 'Missing VIN' });
          continue;
        }
        if (seenInFile.has(vinKey)) duplicateInFile += 1;
        seenInFile.add(vinKey);
        rowsProcessed += 1;

        const existing = store.getVehicle(vinKey);
        if (!existing) {
          store.upsertVehicle(vinKey, {
            vin: vinKey,
            raw: { ...raw, vin: vinKey },
            ops: emptyOps(),
            createdAt: new Date().toISOString(),
            rawUpdatedAt: new Date().toISOString(),
            lastUploadId: uploadId,
          });
          newVins += 1;
        } else {
          existing.raw = { ...raw, vin: vinKey };
          existing.rawUpdatedAt = new Date().toISOString();
          existing.lastUploadId = uploadId;
          existing.ops = { ...emptyOps(), ...existing.ops };
          OPS_FIELDS.forEach((f) => {
            if (existing.ops[f] == null) existing.ops[f] = '';
          });
          store.upsertVehicle(vinKey, existing);
          updatedVins += 1;
        }
        if (raw.proformaDate === today) todaysProformas += 1;
      }

      store.pushUpload({
        id: uploadId,
        filename,
        sheetName,
        rowsProcessed,
        newVins,
        updatedVins,
        todaysProformas,
        duplicateVins: duplicateInFile,
        errors: errors.slice(0, 50),
        uploadedBy: req.dtUser.name,
      });
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'upload_raw_data',
        oldValue: '',
        newValue: `${filename} · sheet «${sheetName}» · ${rowsProcessed} rows`,
      });
      store.save();

      return res.json({
        ok: true,
        sheetName,
        filename,
        summary: {
          rowsProcessed,
          newVins,
          updatedVins,
          todaysProformas,
          duplicateVins: duplicateInFile,
          errors: errors.slice(0, 50),
          errorCount: errors.length,
        },
      });
    } catch (err) {
      console.error('[delivery-team/upload]', err);
      return res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }

  // ——— Assignment ———
  router.post('/assign', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vins = Array.isArray(req.body.vins) ? req.body.vins : [req.body.vin];
    const employeeName = String(req.body.employee || '').trim();
    const emp = USERS.find((u) => u.role === 'employee'
      && (u.name.toLowerCase() === employeeName.toLowerCase() || u.id === employeeName.toLowerCase()));
    if (!emp) return res.status(400).json({ error: 'Select a valid employee (Rasha / Ruba / Ibrahim / Abdullah)' });

    const results = [];
    vins.forEach((rawVin) => {
      const key = normVin(rawVin);
      const v = store.getVehicle(key);
      if (!v) {
        results.push({ vin: key, ok: false, error: 'Not found' });
        return;
      }
      const old = v.ops.assignedEmployeeName || '';
      v.ops.assignedEmployeeId = emp.id;
      v.ops.assignedEmployeeName = emp.name;
      v.ops.assignedBy = req.dtUser.name;
      v.ops.assignedAt = new Date().toISOString();
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(key, v);
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: old ? 'reassign' : 'assign',
        oldValue: old || '(unassigned)',
        newValue: emp.name,
      });
      results.push({ vin: key, ok: true, employee: emp.name });
    });
    store.save();
    res.json({ ok: true, results });
  });

  router.post('/unassign', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vins = Array.isArray(req.body.vins) ? req.body.vins : [req.body.vin];
    vins.forEach((rawVin) => {
      const key = normVin(rawVin);
      const v = store.getVehicle(key);
      if (!v) return;
      const old = v.ops.assignedEmployeeName || '';
      v.ops.assignedEmployeeId = '';
      v.ops.assignedEmployeeName = '';
      v.ops.assignedBy = '';
      v.ops.assignedAt = '';
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: 'unassign',
        oldValue: old,
        newValue: '(unassigned)',
      });
    });
    store.save();
    res.json({ ok: true });
  });

  // ——— Ops update (employee / admin / hanouf) ———
  router.patch('/vehicles/:vin', auth, (req, res) => {
    const v = assertVinAccess(req, res, req.params.vin);
    if (!v) return undefined;
    const body = req.body || {};
    const allowed = {
      guestSentDate: (x) => normalizeDate(x),
      signatureReceivedDate: (x) => normalizeDate(x),
      accountsSentDate: (x) => normalizeDate(x),
      accountsApprovalDate: (x) => normalizeDate(x),
      registrationIssueDate: (x) => normalizeDate(x),
      vin1502: (x) => isYesNo(x) || (['Yes', 'No', ''].includes(String(x)) ? String(x) : ''),
      opsStatus: (x) => {
        const s = String(x || '').trim();
        if (!s) return '';
        if (!STATUSES.includes(s)) throw new Error(`Invalid status: ${s}`);
        return s;
      },
      trafficFile: (x) => isYesNo(x) || (YES_NO.includes(String(x)) ? String(x) : ''),
      trafficFeesOps: (x) => isYesNo(x) || (YES_NO.includes(String(x)) ? String(x) : ''),
      insuranceOps: (x) => isYesNo(x) || (YES_NO.includes(String(x)) ? String(x) : ''),
      transferCity: (x) => {
        const s = String(x || '').trim();
        if (!s) return '';
        if (!TRANSFER_CITIES.includes(s)) throw new Error('Invalid transfer city');
        return s;
      },
      carrier: (x) => {
        const s = String(x || '').trim();
        if (!s) return '';
        if (!CARRIERS.includes(s)) throw new Error('Invalid carrier');
        return s;
      },
      notes: (x) => String(x == null ? '' : x),
    };

    try {
      Object.keys(allowed).forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(body, field)) return;
        const oldVal = v.ops[field] == null ? '' : String(v.ops[field]);
        const newVal = allowed[field](body[field]);
        if (String(newVal) === oldVal) return;
        v.ops[field] = newVal;
        store.pushAudit({
          vin: v.vin,
          user: req.dtUser.name,
          action: `update_${field}`,
          oldValue: oldVal || '(empty)',
          newValue: String(newVal) || '(empty)',
        });
      });
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = new Date().toISOString();
      store.upsertVehicle(v.vin, v);
      store.save();
      return res.json({ ok: true, saved: true, vehicle: publicVehicle(v), lastUpdated: v.ops.updatedAt });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Update failed' });
    }
  });

  router.get('/audit', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vin = normVin(req.query.vin || '');
    let list = store.data.audit || [];
    if (vin) list = list.filter((a) => a.vin === vin);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(20, Number(req.query.limit) || 50));
    const total = list.length;
    const rows = list.slice((page - 1) * limit, (page - 1) * limit + limit);
    res.json({ total, page, limit, rows });
  });

  router.get('/export', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const rows = sortVehicles(store.allVehicles(), 'proformaDate', 'desc').map((v) => ({
      'Proforma Invoice Date': v.raw.proformaDate || '',
      'Sales Order Number': v.raw.salesOrder || '',
      VIN: v.vin,
      Product: v.raw.product || '',
      'Sales Type': v.raw.salesType || '',
      'Invoice Owner': v.raw.invoiceOwner || '',
      'User Name': v.raw.userName || '',
      'S/A': v.raw.salesAdvisor || '',
      'GT Location': v.raw.gtLocation || '',
      'Vehicle Location': v.raw.vehicleLocation || '',
      'Phone Number': v.raw.phone || '',
      'Assigned Employee': v.ops.assignedEmployeeName || '',
      'Guest Sent Date': v.ops.guestSentDate || '',
      'Signature Received Date': v.ops.signatureReceivedDate || '',
      'File Sent to Accounts': v.ops.accountsSentDate || '',
      'Accounts Approval Date': v.ops.accountsApprovalDate || '',
      'Current VIN 1502': v.ops.vin1502 || '',
      Status: v.ops.opsStatus || '',
      'Traffic File': v.ops.trafficFile || '',
      'Traffic Fees': v.ops.trafficFeesOps || '',
      Insurance: v.ops.insuranceOps || '',
      'Registration Issue Date': v.ops.registrationIssueDate || '',
      'Transfer City': v.ops.transferCity || '',
      Carrier: v.ops.carrier || '',
      Notes: v.ops.notes || '',
      'Assigned By': v.ops.assignedBy || '',
      'Assigned Date': v.ops.assignedAt || '',
      'Last Updated': v.ops.updatedAt || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!autofilter'] = { ref: ws['!ref'] || 'A1' };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Delivery Team');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'export_excel',
      oldValue: '',
      newValue: `${rows.length} VINs`,
    });
    store.save();
    const fname = `delivery-team-export-${todayIso()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.send(buf);
  });

  return { router, store, uploadHandler };
}

module.exports = { createDeliveryTeamRouter };
