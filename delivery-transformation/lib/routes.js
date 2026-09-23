'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const {
  STATUSES,
  YES_NO,
  CARRIERS,
  TRANSFER_CITIES,
  USERS,
  PIC_ALIASES,
  emptyOps,
  emptyRaw,
} = require('./constants');
const { createStore } = require('./store');
const { parseDeliverySheet, parseSalesRaw } = require('./importer');

const RAW_UPLOAD_LIMIT = '80mb';

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isManager(role) {
  return role === 'admin' || role === 'hanouf';
}

/** Employees + Hanouf can receive VINs. */
function isAssignable(u) {
  return !!(u && (u.role === 'employee' || u.role === 'hanouf'));
}

function findAssignable(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  const id = PIC_ALIASES[key] || key;
  return USERS.find((u) => isAssignable(u) && (u.id === id || u.name.toLowerCase() === key)) || null;
}

function canUploadSalesRaw(sessionUser) {
  if (!sessionUser) return false;
  if (isManager(sessionUser.role)) return true;
  const u = USERS.find((x) => x.id === sessionUser.userId);
  return !!(u && u.canUploadSalesRaw);
}

/** Current month in Riyadh (UTC+3), e.g. "2026-09". */
function currentMonthKey() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** Today in Riyadh (UTC+3), e.g. "2026-09-23". */
function todayKey() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inMonth(v, month) {
  return [
    v.raw && v.raw.proformaDate,
    v.raw && v.raw.date,
    v.ops && v.ops.assignedAt,
  ].some((d) => String(d || '').slice(0, 7) === month);
}

function isDelivered(v) {
  const s = v && v.ops && v.ops.opsStatus;
  return s === 'Claimed' || s === 'تم التسليم';
}

function findEmployeeByPic(pic) {
  return findAssignable(pic);
}

function canEditVehicle(v, viewer) {
  const role = viewer && viewer.role;
  if (isManager(role)) return true;
  if (role === 'employee') return !!(v && v.ops && v.ops.assignedEmployeeId === viewer.userId);
  return false;
}

function isCoordinatorPrinted(v) {
  return !!(v && v.ops && String(v.ops.coordinatorPrintedAt || '').trim());
}

function publicVehicle(v, viewer) {
  if (!v) return null;
  const role = viewer && viewer.role;
  const raw = { ...(v.raw || {}) };
  // Coordinator sees VIN details + transfer city (for print branch). No other employee ops.
  const ops = role === 'coordinator'
    ? { transferCity: String((v.ops && v.ops.transferCity) || '').trim() }
    : { ...(v.ops || {}) };
  return {
    vin: v.vin,
    raw,
    ops,
    canEdit: canEditVehicle(v, viewer),
    viewerRole: role || '',
  };
}

function createDeliveryTransformationRouter(opts = {}) {
  const router = express.Router();
  const password = String(opts.password || '1234').trim();
  const dataFile = opts.dataFile
    || path.join(opts.root || process.cwd(), 'delivery-transformation-data.json');
  const store = createStore(dataFile);

  function peekMemoInvoice() {
    const n = Number(store.data.meta && store.data.meta.memoInvoiceNext);
    return Number.isFinite(n) && n >= 1000 ? Math.floor(n) : 1000;
  }

  function consumeMemoInvoice() {
    const n = peekMemoInvoice();
    if (!store.data.meta || typeof store.data.meta !== 'object') {
      store.data.meta = { memoInvoiceNext: n + 1 };
    } else {
      store.data.meta.memoInvoiceNext = n + 1;
    }
    store.save();
    return n;
  }

  function auth(req, res, next) {
    const token = String(
      req.headers['x-delivery-transform-token']
      || req.headers['x-dt-token']
      || (req.body && req.body.token)
      || (req.query && req.query.token)
      || ''
    ).trim();
    const session = store.getSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    req.dtToken = token;
    req.dtUser = session;
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

  function normalizePhone(value) {
    const ar = '٠١٢٣٤٥٦٧٨٩';
    return String(value || '')
      .trim()
      .replace(/[٠-٩]/g, (d) => String(ar.indexOf(d)))
      .replace(/[^\d+]/g, '');
  }

  router.post('/attendance', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim();
    const company = String((req.body && req.body.company) || '').trim();
    const phone = normalizePhone(req.body && req.body.phone);
    if (name.length < 2) {
      return res.status(400).json({ error: 'أدخل الاسم' });
    }
    if (!CARRIERS.includes(company)) {
      return res.status(400).json({ error: 'اختر الشركة من القائمة' });
    }
    if (phone.replace(/\D/g, '').length < 9) {
      return res.status(400).json({ error: 'أدخل رقم جوال صحيح' });
    }
    if (!Array.isArray(store.data.attendance)) store.data.attendance = [];
    const entry = {
      id: `att_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      at: new Date().toISOString(),
      name,
      company,
      phone,
    };
    store.data.attendance.unshift(entry);
    if (store.data.attendance.length > 5000) store.data.attendance.length = 5000;
    store.save();
    return res.json({ ok: true, entry });
  });

  const ATTEND_HOLD_MS = 2 * 60 * 60 * 1000;

  function attendanceRows() {
    if (!Array.isArray(store.data.attendance)) store.data.attendance = [];
    return store.data.attendance;
  }

  function attendanceOpen(entry, viewerId) {
    if (!entry || entry.usedAt) return false;
    if (!entry.heldBy) return true;
    const heldAt = Date.parse(entry.heldAt || '') || 0;
    if (heldAt && Date.now() - heldAt > ATTEND_HOLD_MS) {
      entry.heldBy = '';
      entry.heldAt = '';
      return true;
    }
    return entry.heldBy === viewerId;
  }

  function normalizeCityKey(value) {
    return String(value || '')
      .trim()
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  function isOpenCityForAllCompanies(city) {
    const key = normalizeCityKey(city);
    if (!key) return true;
    if (key === 'الرياض' || key === 'جده') return true;
    return key.includes('اوتومول') || key.includes('automall');
  }

  function requestCity(req) {
    return String((req.query && req.query.city) || (req.body && req.body.city) || '').trim();
  }

  function printedCarsByCompanyForCity(city) {
    const want = normalizeCityKey(city);
    const counts = new Map();
    if (!want) return counts;
    store.allVehicles().forEach((v) => {
      if (!isCoordinatorPrinted(v) || !v.ops) return;
      if (String(v.ops.coordinatorPrintKind || '') === 'warehouse') return;
      const company = String(v.ops.coordinatorPrintCompany || '').trim();
      if (!company) return;
      const printedCity = normalizeCityKey(v.ops.coordinatorPrintCity || v.ops.transferCity);
      if (printedCity !== want) return;
      counts.set(company, (counts.get(company) || 0) + 1);
    });
    return counts;
  }

  function attendanceAvailablePayload(viewerId, city) {
    const groups = new Map();
    attendanceRows().forEach((entry) => {
      if (!attendanceOpen(entry, viewerId)) return;
      const company = String(entry.company || '').trim();
      if (!company) return;
      if (!groups.has(company)) groups.set(company, { company, available: 0, people: [] });
      const g = groups.get(company);
      const mine = entry.heldBy === viewerId;
      if (!mine) g.available += 1;
      g.people.push({
        id: entry.id,
        name: entry.name,
        phone: entry.phone,
        held: mine,
      });
    });
    let list = [...groups.values()]
      .filter((g) => g.available > 0 || g.people.some((p) => p.held))
      .sort((a, b) => a.company.localeCompare(b.company, 'ar'));
    if (!isOpenCityForAllCompanies(city)) {
      const counts = printedCarsByCompanyForCity(city);
      const competing = list.filter((g) => g.available > 0);
      if (competing.length) {
        let min = Infinity;
        competing.forEach((g) => {
          const n = counts.get(g.company) || 0;
          if (n < min) min = n;
        });
        list = list.filter((g) => {
          if (g.people.some((p) => p.held)) return true;
          return g.available > 0 && (counts.get(g.company) || 0) === min;
        });
      }
    }
    return list;
  }

  function releaseHoldsFor(viewerId, exceptId) {
    attendanceRows().forEach((entry) => {
      if (entry.heldBy === viewerId && entry.id !== exceptId && !entry.usedAt) {
        entry.heldBy = '';
        entry.heldAt = '';
      }
    });
  }

  router.get('/attendance/available', auth, (req, res) => {
    if (req.dtUser.role !== 'coordinator' && req.dtUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ companies: attendanceAvailablePayload(req.dtUser.userId, requestCity(req)) });
  });

  router.post('/attendance/hold', auth, (req, res) => {
    if (req.dtUser.role !== 'coordinator' && req.dtUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const id = String((req.body && req.body.id) || '').trim();
    const entry = attendanceRows().find((e) => e.id === id);
    if (!entry || entry.usedAt) {
      return res.status(404).json({ error: 'لا يوجد حضور متاح لهذا الاسم' });
    }
    if (entry.heldBy && entry.heldBy !== req.dtUser.userId) {
      const heldAt = Date.parse(entry.heldAt || '') || 0;
      if (!heldAt || Date.now() - heldAt <= ATTEND_HOLD_MS) {
        return res.status(409).json({ error: 'هذا الاسم محجوز الآن' });
      }
    }
    releaseHoldsFor(req.dtUser.userId, id);
    entry.heldBy = req.dtUser.userId;
    entry.heldAt = new Date().toISOString();
    store.save();
    return res.json({
      ok: true,
      entry: { id: entry.id, name: entry.name, company: entry.company, phone: entry.phone },
      companies: attendanceAvailablePayload(req.dtUser.userId, requestCity(req)),
    });
  });

  router.post('/attendance/release', auth, (req, res) => {
    if (req.dtUser.role !== 'coordinator' && req.dtUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    releaseHoldsFor(req.dtUser.userId, '');
    store.save();
    return res.json({ ok: true, companies: attendanceAvailablePayload(req.dtUser.userId, requestCity(req)) });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      module: 'delivery-transformation',
      isolated: true,
      statuses: STATUSES,
      carriers: CARRIERS,
      transferCities: TRANSFER_CITIES,
      yesNo: YES_NO,
      users: USERS.map((u) => ({ id: u.id, name: u.name, role: u.role })),
      employees: vacationList(),
      currentMonth: currentMonthKey(),
      today: todayKey(),
      imports: store.data.meta.imports || {},
      pendingAssignments: Object.keys(store.data.meta.pendingAssignments || {}).length,
      memoInvoiceNext: peekMemoInvoice(),
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
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        canUploadSalesRaw: canUploadSalesRaw({ userId: user.id, role: user.role }),
      },
    });
  });

  router.post('/auth/logout', auth, (req, res) => {
    store.destroySession(req.dtToken);
    res.json({ ok: true });
  });

  router.get('/auth/me', auth, (req, res) => {
    res.json({
      user: {
        id: req.dtUser.userId,
        name: req.dtUser.name,
        role: req.dtUser.role,
        canUploadSalesRaw: canUploadSalesRaw(req.dtUser),
      },
    });
  });

  router.get('/print-invoice', auth, (_req, res) => {
    res.json({ next: peekMemoInvoice() });
  });

  router.post('/print-invoice', auth, (req, res) => {
    if (req.dtUser.role !== 'coordinator' && req.dtUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const invoiceNumber = consumeMemoInvoice();
    store.pushAudit({
      user: req.dtUser.name,
      action: 'print_invoice',
      oldValue: String(invoiceNumber),
      newValue: String(invoiceNumber + 1),
      vin: String((req.body && req.body.vin) || ''),
    });
    return res.json({
      ok: true,
      invoiceNumber,
      next: peekMemoInvoice(),
    });
  });

  router.post('/print-complete', auth, (req, res) => {
    if (req.dtUser.role !== 'coordinator' && req.dtUser.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const raw = Array.isArray(req.body && req.body.vins)
      ? req.body.vins
      : [req.body && req.body.vin];
    const kind = String((req.body && req.body.kind) || 'memo').trim() || 'memo';
    const now = new Date().toISOString();
    const printCompany = String((req.body && req.body.company) || '').trim();
    const printCity = String((req.body && req.body.city) || '').trim();
    const attendanceId = String((req.body && req.body.attendanceId) || '').trim();
    if (attendanceId) {
      const att = attendanceRows().find((e) => e.id === attendanceId);
      if (att && !att.usedAt) {
        att.usedAt = now;
        att.usedBy = req.dtUser.name;
        att.heldBy = '';
        att.heldAt = '';
      }
    }
    const marked = [];
    raw.forEach((item) => {
      const v = store.getVehicle(item);
      if (!v) return;
      if (!v.ops) v.ops = emptyOps();
      v.ops.coordinatorPrintedAt = now;
      v.ops.coordinatorPrintedBy = req.dtUser.name;
      v.ops.coordinatorPrintKind = kind;
      if (kind === 'warehouse') {
        v.ops.coordinatorPrintCompany = '';
        v.ops.coordinatorPrintCity = '';
      } else {
        v.ops.coordinatorPrintCompany = printCompany;
        v.ops.coordinatorPrintCity = printCity || String((v.ops.transferCity || '')).trim();
      }
      marked.push(v.vin);
      store.pushAudit({
        vin: v.vin,
        user: req.dtUser.name,
        action: 'coordinator_print',
        oldValue: '',
        newValue: kind,
      });
    });
    if (marked.length) store.save();
    return res.json({ ok: true, vins: marked });
  });

  /** Live Sheet — every role can list; edit only admin/employee via PATCH */
  router.get('/live-sheet', auth, (req, res) => {
    const q = String((req.query && req.query.q) || '').trim().toLowerCase();
    const isCoordinator = req.dtUser.role === 'coordinator';
    let list = store.allVehicles();
    if (isCoordinator) {
      list = list.filter((v) => !isCoordinatorPrinted(v));
    }
    if (q) {
      list = list.filter((v) => {
        const hay = [
          v.vin,
          v.raw && v.raw.salesOrder,
          v.raw && v.raw.product,
          v.raw && v.raw.salesType,
          v.raw && v.raw.userName,
          v.ops && v.ops.transferCity,
          ...(isCoordinator ? [] : [
            v.ops && v.ops.opsStatus,
            v.ops && v.ops.carrier,
            v.ops && v.ops.assignedEmployeeName,
          ]),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    const month = String((req.query && req.query.month) || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      list = list.filter((v) => inMonth(v, month));
    }
    if (!isCoordinator) {
      const eq = (val, pick) => {
        const want = String(val || '').trim().toLowerCase();
        if (!want) return;
        list = list.filter((v) => String(pick(v) || '').trim().toLowerCase() === want);
      };
      eq(req.query.employee, (v) => v.ops && v.ops.assignedEmployeeName);
      eq(req.query.status, (v) => v.ops && v.ops.opsStatus);
      if (req.query.carrier === '__empty__') {
        list = list.filter((v) => !String((v.ops && v.ops.carrier) || '').trim());
      } else {
        eq(req.query.carrier, (v) => v.ops && v.ops.carrier);
      }
    }
    const statusRank = (v) => {
      const i = STATUSES.indexOf(String((v.ops && v.ops.opsStatus) || ''));
      return i === -1 ? STATUSES.length : i;
    };
    list.sort((a, b) => (isCoordinator ? 0 : statusRank(a) - statusRank(b))
      || String(a.vin).localeCompare(String(b.vin)));
    const byStatus = {};
    const byEmployee = {};
    const byCarrier = {};
    const bySalesType = {};
    list.forEach((v) => {
      const st = (v.ops && v.ops.opsStatus) || '(blank)';
      byStatus[st] = (byStatus[st] || 0) + 1;
      const emp = (v.ops && v.ops.assignedEmployeeName) || '(unassigned)';
      byEmployee[emp] = (byEmployee[emp] || 0) + 1;
      const car = String((v.ops && v.ops.carrier) || '').trim() || '(empty)';
      byCarrier[car] = (byCarrier[car] || 0) + 1;
      const stype = (v.raw && v.raw.salesType) || '(blank)';
      bySalesType[stype] = (bySalesType[stype] || 0) + 1;
    });
    res.json({
      at: new Date().toISOString(),
      total: list.length,
      byStatus: isCoordinator ? {} : byStatus,
      byEmployee: isCoordinator ? {} : byEmployee,
      byCarrier: isCoordinator ? {} : byCarrier,
      bySalesType,
      readOnly: isCoordinator,
      imports: store.data.meta.imports || {},
      rows: list.map((v) => publicVehicle(v, req.dtUser)),
    });
  });

  function uploadedFile(req) {
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    let filename = String(req.headers['x-filename'] || 'upload.xlsx');
    try { filename = decodeURIComponent(filename); } catch (_) { /* keep raw */ }
    return { buf, filename };
  }

  /** New VINs from Sales Raw (Proforma Date = today) waiting for Hanouf to confirm. */
  function pendingMap() {
    if (!store.data.meta.pendingAssignments) store.data.meta.pendingAssignments = {};
    return store.data.meta.pendingAssignments;
  }

  /** meta.vacations: { employeeId: { until: 'YYYY-MM-DD' | '', by, at } } — empty until = until turned off. */
  function onVacation(empId) {
    const v = (store.data.meta.vacations || {})[empId];
    if (!v) return false;
    return !v.until || v.until >= todayKey();
  }

  function vacationList() {
    const all = store.data.meta.vacations || {};
    return USERS.filter(isAssignable).map((u) => ({
      id: u.id,
      name: u.name,
      onVacation: onVacation(u.id),
      until: onVacation(u.id) ? (all[u.id].until || '') : '',
    }));
  }

  function recordImport(kind, summary) {
    if (!store.data.meta.imports) store.data.meta.imports = {};
    store.data.meta.imports[kind] = summary;
  }

  /**
   * Hanouf uploads the delivery sheet — only rows whose proforma date is in the
   * current month are applied. Existing employee entries are never overwritten.
   */
  router.post(
    '/upload',
    express.raw({ limit: RAW_UPLOAD_LIMIT, type: '*/*' }),
    auth,
    requireRole('admin', 'hanouf'),
    (req, res) => {
      const { buf, filename } = uploadedFile(req);
      if (!buf || !buf.length) return res.status(400).json({ error: 'Upload an Excel file' });
      let parsed;
      try {
        parsed = parseDeliverySheet(buf);
      } catch (err) {
        return res.status(400).json({ error: `Could not read the file: ${err.message}` });
      }
      if (!parsed.items.length) {
        return res.status(400).json({ error: 'No VIN column / VIN rows found in this file' });
      }

      const month = currentMonthKey();
      const now = new Date().toISOString();
      const seen = new Set();
      const summary = {
        at: now,
        by: req.dtUser.name,
        filename,
        sheet: parsed.sheet,
        month,
        rows: parsed.items.length,
        created: 0,
        updated: 0,
        assigned: 0,
        skippedVacation: 0,
        skippedOtherMonth: 0,
        skippedNoDate: 0,
        duplicates: 0,
      };

      parsed.items.forEach((item) => {
        if (seen.has(item.vin)) {
          summary.duplicates += 1;
          return;
        }
        seen.add(item.vin);
        const proforma = item.raw.proformaDate || item.raw.date || '';
        if (!proforma) {
          summary.skippedNoDate += 1;
          return;
        }
        if (proforma.slice(0, 7) !== month) {
          summary.skippedOtherMonth += 1;
          return;
        }

        let v = store.getVehicle(item.vin);
        const isNew = !v;
        if (isNew) {
          v = { vin: item.vin, raw: { ...emptyRaw(), vin: item.vin }, ops: { ...emptyOps() } };
        }
        Object.entries(item.raw).forEach(([k, val]) => {
          if (val) v.raw[k] = val;
        });
        if (!v.raw.proformaDate) v.raw.proformaDate = proforma;
        Object.entries(item.ops).forEach(([k, val]) => {
          if (val && !String(v.ops[k] || '').trim()) v.ops[k] = val;
        });
        const emp = findEmployeeByPic(item.raw.pic);
        if (emp && !v.ops.assignedEmployeeId && onVacation(emp.id)) summary.skippedVacation += 1;
        else if (emp && !v.ops.assignedEmployeeId) {
          v.ops.assignedEmployeeId = emp.id;
          v.ops.assignedEmployeeName = emp.name;
          v.ops.assignedBy = req.dtUser.name;
          v.ops.assignedAt = now;
          summary.assigned += 1;
        }
        v.ops.updatedAt = now;
        v.ops.updatedBy = req.dtUser.name;
        store.upsertVehicle(item.vin, v);
        if (isNew) summary.created += 1;
        else summary.updated += 1;
      });

      recordImport('lastUpload', summary);
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'upload_vins',
        oldValue: filename,
        newValue: `${month}: ${summary.created} new · ${summary.updated} updated · ${summary.skippedOtherMonth} other month skipped`,
      });
      store.save();
      return res.json({ ok: true, summary });
    }
  );

  /**
   * Hanouf uploads Sales Raw — refreshes vehicle details on every matching VIN
   * (all months), so every user sees the same data.
   */
  router.post(
    '/sales-raw',
    express.raw({ limit: RAW_UPLOAD_LIMIT, type: '*/*' }),
    auth,
    (req, res, next) => (canUploadSalesRaw(req.dtUser)
      ? next()
      : res.status(403).json({ error: 'Forbidden for this role' })),
    (req, res) => {
      const { buf, filename } = uploadedFile(req);
      if (!buf || !buf.length) return res.status(400).json({ error: 'Upload an Excel file' });
      let parsed;
      try {
        parsed = parseSalesRaw(buf);
      } catch (err) {
        return res.status(400).json({ error: `Could not read the file: ${err.message}` });
      }
      if (!parsed.items.length) {
        return res.status(400).json({ error: 'No VIN rows found in this Sales Raw file' });
      }

      const now = new Date().toISOString();
      const summary = {
        at: now,
        by: req.dtUser.name,
        filename,
        sheet: parsed.sheet,
        layout: parsed.layout,
        rows: parsed.items.length,
        matched: 0,
        updated: 0,
        notOnSheet: 0,
        today: todayKey(),
        todayNew: 0,
        todayOnSystem: 0,
        assignable: 0,
        skippedNoProforma: 0,
        skippedInvoiced: 0,
        skippedOnSystem: 0,
        duplicates: parsed.duplicates || 0,
      };
      const pending = pendingMap();
      parsed.items.forEach((item) => {
        const v = store.getVehicle(item.vin);
        const hasProforma = !!String((item.raw && item.raw.proformaDate) || '').trim();
        const hasInvoice = !!String((item.raw && item.raw.invoiceDate) || '').trim();
        const canAssign = hasProforma && !hasInvoice;
        const isToday = item.raw.proformaDate === summary.today;
        if (!v) {
          summary.notOnSheet += 1;
          if (!hasProforma) summary.skippedNoProforma += 1;
          else if (hasInvoice) summary.skippedInvoiced += 1;
          else {
            summary.assignable += 1;
            if (isToday) summary.todayNew += 1;
            pending[item.vin] = {
              vin: item.vin,
              raw: { ...emptyRaw(), ...(pending[item.vin] ? pending[item.vin].raw : {}), ...item.raw, vin: item.vin },
              uploadedBy: req.dtUser.name,
              uploadedAt: now,
              filename,
            };
          }
          return;
        }
        if (canAssign) summary.skippedOnSystem += 1;
        if (isToday) summary.todayOnSystem += 1;
        summary.matched += 1;
        let changed = false;
        Object.entries(item.raw).forEach(([k, val]) => {
          if (val && String(v.raw[k] || '') !== val) {
            v.raw[k] = val;
            changed = true;
          }
        });
        if (changed) {
          v.rawUpdatedAt = now;
          store.upsertVehicle(item.vin, v);
          summary.updated += 1;
        }
      });

      recordImport('lastSalesRaw', summary);
      store.pushAudit({
        vin: '',
        user: req.dtUser.name,
        action: 'upload_sales_raw',
        oldValue: filename,
        newValue: `${summary.matched} matched · ${summary.updated} updated · ${summary.assignable} to Assignment (P filled · V empty)`,
      });
      store.save();
      summary.pendingTotal = Object.keys(pending).length;
      return res.json({ ok: true, summary });
    }
  );

  router.get('/vehicles/:vin', auth, (req, res) => {
    const v = store.getVehicle(req.params.vin);
    if (!v) return res.status(404).json({ error: 'VIN not found' });
    if (req.dtUser.role === 'coordinator' && isCoordinatorPrinted(v)) {
      return res.status(404).json({ error: 'VIN already printed' });
    }
    return res.json({ vehicle: publicVehicle(v, req.dtUser) });
  });

  /** Admin overview — all details */
  router.get('/admin/overview', auth, requireRole('admin'), (req, res) => {
    const list = store.allVehicles();
    res.json({
      at: new Date().toISOString(),
      total: list.length,
      audit: (store.data.audit || []).slice(0, 100),
      meta: store.data.meta,
      vehicles: list.map((v) => publicVehicle(v, req.dtUser)),
    });
  });

  router.post('/vehicles', auth, requireRole('admin'), (req, res) => {
    const body = req.body || {};
    const vin = normVin(body.vin);
    if (!vin || vin.length < 8) {
      return res.status(400).json({ error: 'Valid VIN required' });
    }
    if (store.getVehicle(vin)) {
      return res.status(409).json({ error: 'VIN already exists' });
    }
    const empId = String(body.assignedEmployeeId || '').trim().toLowerCase();
    const emp = findAssignable(empId);
    const now = new Date().toISOString();
    const vehicle = {
      vin,
      raw: {
        ...emptyRaw(),
        vin,
        product: String(body.product || '').trim(),
        salesType: String(body.salesType || '').trim(),
        salesOrder: String(body.salesOrder || '').trim(),
        salesAdvisor: String(body.salesAdvisor || '').trim(),
        userName: String(body.userName || body.customer || '').trim(),
        phone: String(body.phone || '').trim(),
        gtLocation: String(body.gtLocation || '').trim(),
        vehicleLocation: String(body.vehicleLocation || '').trim(),
        invoiceOwner: String(body.invoiceOwner || '').trim(),
        proformaDate: String(body.proformaDate || '').trim() || now.slice(0, 10),
        date: now.slice(0, 10),
        pic: emp ? emp.name : '',
      },
      ops: {
        ...emptyOps(),
        opsStatus: String(body.opsStatus || '').trim(),
        carrier: String(body.carrier || '').trim(),
        transferCity: String(body.transferCity || '').trim(),
        notes: String(body.notes || '').trim(),
        assignedEmployeeId: emp ? emp.id : '',
        assignedEmployeeName: emp ? emp.name : '',
        assignedBy: req.dtUser.name,
        assignedAt: emp ? now : '',
        updatedAt: now,
        updatedBy: req.dtUser.name,
      },
    };
    store.upsertVehicle(vin, vehicle);
    store.pushAudit({
      vin,
      user: req.dtUser.name,
      action: 'create_vin',
      oldValue: '',
      newValue: vin,
    });
    store.save();
    return res.json({ ok: true, vehicle: publicVehicle(vehicle, req.dtUser) });
  });

  router.patch('/vehicles/:vin', auth, (req, res) => {
    if (req.dtUser.role === 'coordinator') {
      return res.status(403).json({
        error: 'Coordinator can view Live Sheet VINs only — no employee entry edits',
      });
    }
    if (!isManager(req.dtUser.role) && req.dtUser.role !== 'employee') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const key = normVin(req.params.vin);
    const v = store.getVehicle(key);
    if (!v) return res.status(404).json({ error: 'VIN not found' });
    if (!canEditVehicle(v, req.dtUser)) {
      return res.status(403).json({ error: 'You can only edit VINs assigned to you' });
    }
    if (!v.ops) v.ops = emptyOps();
    if (!v.raw) v.raw = emptyRaw();

    const body = req.body || {};
    const changes = [];

    const setOps = (field, next) => {
      const oldVal = v.ops[field] == null ? '' : String(v.ops[field]);
      const newVal = next == null ? '' : String(next);
      if (oldVal === newVal) return;
      v.ops[field] = newVal;
      changes.push({ field, oldVal, newVal });
    };

    if (Object.prototype.hasOwnProperty.call(body, 'opsStatus')) {
      const s = String(body.opsStatus || '').trim();
      if (s && !STATUSES.includes(s)) {
        return res.status(400).json({ error: `Invalid status: ${s}` });
      }
      setOps('opsStatus', s);
    }
    for (const f of [
      'guestSentDate', 'signatureReceivedDate', 'accountsSentDate',
      'accountsApprovalDate', 'registrationIssueDate', 'transferCity',
      'carrier', 'notes', 'guestCenter',
    ]) {
      if (Object.prototype.hasOwnProperty.call(body, f)) setOps(f, body[f]);
    }
    for (const f of ['vin1502', 'trafficFile', 'trafficFeesOps', 'insuranceOps']) {
      if (Object.prototype.hasOwnProperty.call(body, f)) {
        const s = String(body[f] || '').trim();
        if (s && !YES_NO.includes(s)) {
          return res.status(400).json({ error: `${f} must be Yes/No` });
        }
        setOps(f, s);
      }
    }

    if (req.dtUser.role === 'admin') {
      if (Object.prototype.hasOwnProperty.call(body, 'assignedEmployeeId')) {
        const empId = String(body.assignedEmployeeId || '').trim().toLowerCase();
        const emp = empId ? findAssignable(empId) : null;
        const old = v.ops.assignedEmployeeName || '';
        v.ops.assignedEmployeeId = emp ? emp.id : '';
        v.ops.assignedEmployeeName = emp ? emp.name : '';
        v.ops.assignedBy = emp ? req.dtUser.name : '';
        v.ops.assignedAt = emp ? (v.ops.assignedAt || new Date().toISOString()) : '';
        if (old !== (v.ops.assignedEmployeeName || '')) {
          changes.push({
            field: 'assignedEmployee',
            oldVal: old || '(unassigned)',
            newVal: v.ops.assignedEmployeeName || '(unassigned)',
          });
        }
      }
      for (const f of [
        'product', 'salesType', 'salesOrder', 'salesAdvisor', 'userName',
        'phone', 'gtLocation', 'vehicleLocation', 'invoiceOwner', 'proformaDate',
      ]) {
        if (Object.prototype.hasOwnProperty.call(body, f)) {
          const oldVal = v.raw[f] == null ? '' : String(v.raw[f]);
          const newVal = String(body[f] == null ? '' : body[f]).trim();
          if (oldVal !== newVal) {
            v.raw[f] = newVal;
            changes.push({ field: `raw.${f}`, oldVal, newVal });
          }
        }
      }
    }

    if (!changes.length) {
      return res.json({
        ok: true,
        saved: false,
        vehicle: publicVehicle(v, req.dtUser),
      });
    }

    v.ops.updatedBy = req.dtUser.name;
    v.ops.updatedAt = new Date().toISOString();
    store.upsertVehicle(key, v);
    changes.forEach((c) => {
      store.pushAudit({
        vin: key,
        user: req.dtUser.name,
        action: 'update',
        oldValue: `${c.field}: ${c.oldVal || '(empty)'}`,
        newValue: `${c.field}: ${c.newVal || '(empty)'}`,
      });
    });
    store.save();
    return res.json({
      ok: true,
      saved: true,
      vehicle: publicVehicle(v, req.dtUser),
      lastUpdated: v.ops.updatedAt,
    });
  });

  router.post('/reassign', auth, requireRole('admin', 'hanouf', 'employee'), (req, res) => {
    const body = req.body || {};
    const vins = Array.isArray(body.vins) ? body.vins.map(normVin).filter(Boolean) : [];
    const target = String(body.employee || '').trim().toLowerCase();
    const emp = findAssignable(target);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    if (!emp) return res.status(400).json({ error: 'Unknown employee' });
    if (onVacation(emp.id)) return res.status(400).json({ error: `${emp.name} is on vacation` });
    const now = new Date().toISOString();
    const results = vins.map((vin) => {
      const v = store.getVehicle(vin);
      if (!v) return { vin, ok: false, error: 'VIN not found' };
      if (v.ops.assignedEmployeeId === emp.id) return { vin, ok: false, error: 'Already assigned' };
      const old = v.ops.assignedEmployeeName || '';
      v.ops.assignedEmployeeId = emp.id;
      v.ops.assignedEmployeeName = emp.name;
      v.ops.assignedBy = req.dtUser.name;
      v.ops.assignedAt = now;
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = now;
      store.upsertVehicle(vin, v);
      store.pushAudit({
        vin,
        user: req.dtUser.name,
        action: 'reassign',
        oldValue: old || '(unassigned)',
        newValue: emp.name,
      });
      return { vin, ok: true };
    });
    store.save();
    return res.json({ ok: true, results });
  });

  function selectedVins(req) {
    const body = req.body || {};
    return Array.isArray(body.vins) ? [...new Set(body.vins.map(normVin).filter(Boolean))] : [];
  }

  /** Unassign selected VINs (they stay on the Live Sheet with no employee). */
  router.post('/unassign', auth, requireRole('admin', 'hanouf', 'employee'), (req, res) => {
    const vins = selectedVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const now = new Date().toISOString();
    const results = vins.map((vin) => {
      const v = store.getVehicle(vin);
      if (!v) return { vin, ok: false, error: 'VIN not found' };
      const old = v.ops.assignedEmployeeName || '';
      if (!v.ops.assignedEmployeeId) return { vin, ok: false, error: 'Not assigned' };
      v.ops.assignedEmployeeId = '';
      v.ops.assignedEmployeeName = '';
      v.ops.assignedBy = req.dtUser.name;
      v.ops.assignedAt = now;
      v.ops.updatedBy = req.dtUser.name;
      v.ops.updatedAt = now;
      store.upsertVehicle(vin, v);
      store.pushAudit({
        vin, user: req.dtUser.name, action: 'unassign', oldValue: old, newValue: '(unassigned)',
      });
      return { vin, ok: true };
    });
    store.save();
    return res.json({ ok: true, results });
  });

  /** Remove selected VINs from the Live Sheet; a full snapshot is kept in the audit log. */
  router.post('/remove', auth, requireRole('admin', 'hanouf', 'employee'), (req, res) => {
    const vins = selectedVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const results = vins.map((vin) => {
      const v = store.getVehicle(vin);
      if (!v) return { vin, ok: false, error: 'VIN not found' };
      store.deleteVehicle(vin);
      store.pushAudit({
        vin, user: req.dtUser.name, action: 'remove_vin', oldValue: JSON.stringify(v), newValue: '',
      });
      return { vin, ok: true };
    });
    store.save();
    return res.json({ ok: true, results });
  });

  router.delete('/vehicles/:vin', auth, requireRole('admin'), (req, res) => {
    const key = normVin(req.params.vin);
    if (!store.getVehicle(key)) return res.status(404).json({ error: 'VIN not found' });
    store.deleteVehicle(key);
    store.pushAudit({
      vin: key,
      user: req.dtUser.name,
      action: 'delete_vin',
      oldValue: key,
      newValue: '',
    });
    store.save();
    return res.json({ ok: true });
  });

  // ——— Assignment: auto-suggest by sales type, Hanouf confirms ———
  function canViewAssignment(u) {
    return isManager(u && u.role) || canUploadSalesRaw(u);
  }

  /**
   * Keep unique pending VINs that have Proforma Date (column P) and no Invoice Date (column V),
   * and that are not already on the system. Auto-split evenly by sales type.
   */
  function buildAssignmentView() {
    const today = todayKey();
    const pending = pendingMap();
    let dropped = false;
    Object.keys(pending).forEach((vin) => {
      const raw = pending[vin].raw || {};
      const hasProforma = !!String(raw.proformaDate || '').trim();
      const hasInvoice = !!String(raw.invoiceDate || '').trim();
      if (store.getVehicle(vin) || !hasProforma || hasInvoice) {
        delete pending[vin];
        dropped = true;
      }
    });
    if (dropped) store.save();

    const employees = USERS.filter(isAssignable);
    const available = employees.filter((u) => !onVacation(u.id));
    const month = currentMonthKey();
    const typeLabel = (t) => String(t || '').trim() || '(blank)';
    const byType = {};
    const total = {};
    employees.forEach((u) => { byType[u.id] = {}; total[u.id] = 0; });
    store.allVehicles().forEach((v) => {
      const id = v.ops && v.ops.assignedEmployeeId;
      if (!(id in total) || !inMonth(v, month)) return;
      const t = typeLabel(v.raw && v.raw.salesType);
      byType[id][t] = (byType[id][t] || 0) + 1;
      total[id] += 1;
    });
    const before = JSON.parse(JSON.stringify(byType));

    const rows = Object.values(pending)
      .sort((a, b) => typeLabel(a.raw.salesType).localeCompare(typeLabel(b.raw.salesType)) || a.vin.localeCompare(b.vin))
      .map((p) => {
        const t = typeLabel(p.raw.salesType);
        const pick = available.reduce((best, u) => {
          if (!best) return u;
          const a = byType[u.id][t] || 0;
          const b = byType[best.id][t] || 0;
          return a < b || (a === b && total[u.id] < total[best.id]) ? u : best;
        }, null);
        if (pick) {
          byType[pick.id][t] = (byType[pick.id][t] || 0) + 1;
          total[pick.id] += 1;
        }
        return {
          vin: p.vin,
          salesType: t,
          proformaDate: p.raw.proformaDate,
          suggestedEmployeeId: pick ? pick.id : '',
          suggestedEmployeeName: pick ? pick.name : '',
        };
      });

    const types = new Set();
    employees.forEach((u) => Object.keys(byType[u.id]).forEach((t) => types.add(t)));
    const vac = vacationList();
    return {
      today,
      month,
      rows,
      salesTypes: [...types].sort((a, b) => a.localeCompare(b)),
      employees: employees.map((u) => {
        const x = vac.find((e) => e.id === u.id);
        return {
          id: u.id,
          name: u.name,
          bySalesType: before[u.id],
          afterBySalesType: byType[u.id],
          onVacation: x.onVacation,
          vacationUntil: x.until,
        };
      }),
    };
  }

  /** Hanouf marks an employee on / off vacation: { employeeId, onVacation, until } */
  router.put('/vacation', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const body = req.body || {};
    const emp = findAssignable(body.employeeId);
    if (!emp) return res.status(400).json({ error: 'Unknown employee' });
    const until = /^\d{4}-\d{2}-\d{2}$/.test(String(body.until || '')) ? body.until : '';
    if (!store.data.meta.vacations) store.data.meta.vacations = {};
    const was = onVacation(emp.id);
    if (body.onVacation) {
      store.data.meta.vacations[emp.id] = { until, by: req.dtUser.name, at: new Date().toISOString() };
    } else {
      delete store.data.meta.vacations[emp.id];
    }
    store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'set_vacation',
      field: emp.name,
      oldValue: was ? 'vacation' : 'working',
      newValue: body.onVacation ? `vacation${until ? ` until ${until}` : ''}` : 'working',
    });
    store.save();
    return res.json({ ok: true, ...buildAssignmentView(), canConfirm: true });
  });

  router.get('/assignment', auth, (req, res) => {
    if (!canViewAssignment(req.dtUser)) return res.status(403).json({ error: 'Forbidden for this role' });
    return res.json({ ...buildAssignmentView(), canConfirm: isManager(req.dtUser.role) });
  });

  /** Hanouf confirms the automatic split. { all: true } or { vins: [...] } uses the even-by-sales-type pick. */
  router.post('/assignment/confirm', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const view = buildAssignmentView();
    const want = req.body && req.body.all
      ? view.rows.map((r) => r.vin)
      : Array.isArray(req.body && req.body.vins) ? req.body.vins.map(normVin).filter(Boolean)
        : Array.isArray(req.body && req.body.items) ? req.body.items.map((it) => normVin(it && it.vin)).filter(Boolean)
          : [];
    const pick = new Map(view.rows.map((r) => [r.vin, r.suggestedEmployeeId]));
    const items = want.map((vin) => ({ vin, employeeId: pick.get(vin) || '' }));
    if (!items.length) return res.status(400).json({ error: 'Nothing to confirm' });
    const pending = pendingMap();
    const now = new Date().toISOString();
    const results = items.map((it) => {
      const vin = normVin(it && it.vin);
      const p = pending[vin];
      if (!p) return { vin, ok: false, error: 'Not pending' };
      if (store.getVehicle(vin)) { delete pending[vin]; return { vin, ok: false, error: 'Already on the system' }; }
      const emp = findAssignable(it && it.employeeId);
      if (!emp) return { vin, ok: false, error: 'Choose an employee' };
      if (onVacation(emp.id)) return { vin, ok: false, error: `${emp.name} is on vacation` };
      store.upsertVehicle(vin, {
        vin,
        raw: { ...emptyRaw(), ...p.raw, vin },
        ops: {
          ...emptyOps(),
          assignedEmployeeId: emp.id,
          assignedEmployeeName: emp.name,
          assignedBy: req.dtUser.name,
          assignedAt: now,
          updatedAt: now,
          updatedBy: req.dtUser.name,
        },
        createdAt: now,
        createdBy: req.dtUser.name,
        rawUpdatedAt: now,
      });
      delete pending[vin];
      store.pushAudit({
        vin, user: req.dtUser.name, action: 'confirm_assignment', oldValue: '(new · sales raw)', newValue: emp.name,
      });
      return { vin, ok: true, employee: emp.name };
    });
    store.save();
    return res.json({ ok: true, results, ...buildAssignmentView(), canConfirm: true });
  });

  router.post('/assignment/dismiss', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const vins = selectedVins(req);
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    const pending = pendingMap();
    let removed = 0;
    vins.forEach((vin) => {
      if (!pending[vin]) return;
      delete pending[vin];
      removed += 1;
      store.pushAudit({ vin, user: req.dtUser.name, action: 'dismiss_assignment', oldValue: 'pending', newValue: '' });
    });
    store.save();
    return res.json({ ok: true, removed, ...buildAssignmentView(), canConfirm: true });
  });

  function monthParam(val) {
    const m = String(val || '').trim().slice(0, 7);
    return /^\d{4}-\d{2}$/.test(m) ? m : currentMonthKey();
  }

  function monthTargets(month) {
    const all = store.data.meta.targets || {};
    return all[month] || {};
  }

  /** Per-employee count by sales type + total vs. monthly target (Hanouf / Admin). */
  router.get('/team-performance', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const month = monthParam(req.query.month);
    const targets = monthTargets(month);
    const employees = USERS.filter(isAssignable);
    const rows = new Map(employees.map((u) => [u.id, {
      id: u.id, name: u.name, bySalesType: {}, total: 0, delivered: 0,
    }]));
    const salesTypes = new Set();
    let unassigned = 0;
    store.allVehicles().forEach((v) => {
      if (!inMonth(v, month)) return;
      const row = rows.get(v.ops && v.ops.assignedEmployeeId);
      if (!row) { unassigned += 1; return; }
      const stype = String((v.raw && v.raw.salesType) || '').trim() || '(blank)';
      salesTypes.add(stype);
      row.bySalesType[stype] = (row.bySalesType[stype] || 0) + 1;
      row.total += 1;
      if (isDelivered(v)) row.delivered += 1;
    });
    const pct = (n, t) => (t > 0 ? Math.round((n / t) * 100) : null);
    const list = [...rows.values()].map((r) => {
      const target = Number(targets[r.id]) || 0;
      return {
        ...r,
        target,
        achPct: pct(r.total, target),
        deliveredPct: pct(r.delivered, target),
      };
    });
    const sum = (k) => list.reduce((s, r) => s + (r[k] || 0), 0);
    const totals = {
      bySalesType: {},
      total: sum('total'),
      delivered: sum('delivered'),
      target: sum('target'),
    };
    list.forEach((r) => Object.entries(r.bySalesType).forEach(([k, n]) => {
      totals.bySalesType[k] = (totals.bySalesType[k] || 0) + n;
    }));
    totals.achPct = pct(totals.total, totals.target);
    totals.deliveredPct = pct(totals.delivered, totals.target);
    res.json({
      month,
      currentMonth: currentMonthKey(),
      salesTypes: [...salesTypes].sort((a, b) => (totals.bySalesType[b] || 0) - (totals.bySalesType[a] || 0)),
      rows: list,
      totals,
      unassigned,
    });
  });

  /** Save monthly targets: { month, targets: { employeeId: number } } */
  router.put('/targets', auth, requireRole('admin', 'hanouf'), (req, res) => {
    const body = req.body || {};
    const month = monthParam(body.month);
    const input = body.targets && typeof body.targets === 'object' ? body.targets : {};
    if (!store.data.meta.targets) store.data.meta.targets = {};
    const current = { ...(store.data.meta.targets[month] || {}) };
    const changes = [];
    Object.entries(input).forEach(([id, val]) => {
      const emp = findAssignable(id);
      if (!emp) return;
      const n = Math.max(0, Math.round(Number(val) || 0));
      if ((Number(current[id]) || 0) === n) return;
      changes.push({ emp, old: Number(current[id]) || 0, n });
      if (n) current[id] = n;
      else delete current[id];
    });
    store.data.meta.targets[month] = current;
    changes.forEach(({ emp, old, n }) => store.pushAudit({
      vin: '',
      user: req.dtUser.name,
      action: 'set_target',
      field: `${month} · ${emp.name}`,
      oldValue: String(old),
      newValue: String(n),
    }));
    if (changes.length) store.save();
    return res.json({ ok: true, month, targets: current, changed: changes.length });
  });

  router.get('/audit', auth, requireRole('admin'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json({ rows: (store.data.audit || []).slice(0, limit) });
  });

  return { router, store };
}

module.exports = { createDeliveryTransformationRouter };
