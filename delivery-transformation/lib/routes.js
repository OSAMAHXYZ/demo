'use strict';

const express = require('express');
const path = require('path');
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

/** Current month in Riyadh (UTC+3), e.g. "2026-09". */
function currentMonthKey() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

function findEmployeeByPic(pic) {
  const key = String(pic || '').trim().toLowerCase();
  if (!key) return null;
  const id = PIC_ALIASES[key] || key;
  return USERS.find((u) => u.role === 'employee' && (u.id === id || u.name.toLowerCase() === key)) || null;
}

function canEditVehicle(v, viewer) {
  const role = viewer && viewer.role;
  if (isManager(role)) return true;
  if (role === 'employee') return !!(v && v.ops && v.ops.assignedEmployeeId === viewer.userId);
  return false;
}

function publicVehicle(v, viewer) {
  if (!v) return null;
  const role = viewer && viewer.role;
  const raw = { ...(v.raw || {}) };
  // Coordinator sees the VIN and its vehicle details, never the employee's ops entry
  const ops = role === 'coordinator' ? {} : { ...(v.ops || {}) };
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

  router.get('/meta', (_req, res) => {
    res.json({
      module: 'delivery-transformation',
      isolated: true,
      statuses: STATUSES,
      carriers: CARRIERS,
      transferCities: TRANSFER_CITIES,
      yesNo: YES_NO,
      users: USERS.map((u) => ({ id: u.id, name: u.name, role: u.role })),
      employees: USERS.filter((u) => u.role === 'employee').map((u) => ({
        id: u.id,
        name: u.name,
      })),
      currentMonth: currentMonthKey(),
      imports: store.data.meta.imports || {},
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
    res.json({
      user: {
        id: req.dtUser.userId,
        name: req.dtUser.name,
        role: req.dtUser.role,
      },
    });
  });

  /** Live Sheet — every role can list; edit only admin/employee via PATCH */
  router.get('/live-sheet', auth, (req, res) => {
    const q = String((req.query && req.query.q) || '').trim().toLowerCase();
    const isCoordinator = req.dtUser.role === 'coordinator';
    let list = store.allVehicles();
    if (q) {
      list = list.filter((v) => {
        const hay = [
          v.vin,
          v.raw && v.raw.salesOrder,
          v.raw && v.raw.product,
          v.raw && v.raw.salesType,
          v.raw && v.raw.userName,
          ...(isCoordinator ? [] : [
            v.ops && v.ops.opsStatus,
            v.ops && v.ops.carrier,
            v.ops && v.ops.transferCity,
            v.ops && v.ops.assignedEmployeeName,
          ]),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    const month = String((req.query && req.query.month) || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      list = list.filter((v) => [
        v.raw && v.raw.proformaDate,
        v.raw && v.raw.date,
        v.ops && v.ops.assignedAt,
      ].some((d) => String(d || '').slice(0, 7) === month));
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
        if (emp && !v.ops.assignedEmployeeId) {
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
    requireRole('admin', 'hanouf'),
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
      };
      parsed.items.forEach((item) => {
        const v = store.getVehicle(item.vin);
        if (!v) {
          summary.notOnSheet += 1;
          return;
        }
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
        newValue: `${summary.matched} matched · ${summary.updated} updated · ${summary.notOnSheet} not on Live Sheet`,
      });
      store.save();
      return res.json({ ok: true, summary });
    }
  );

  router.get('/vehicles/:vin', auth, (req, res) => {
    const v = store.getVehicle(req.params.vin);
    if (!v) return res.status(404).json({ error: 'VIN not found' });
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
    const emp = USERS.find((u) => u.id === empId && u.role === 'employee') || null;
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
        const emp = empId
          ? USERS.find((u) => u.id === empId && u.role === 'employee')
          : null;
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
    const emp = USERS.find((u) => u.role === 'employee'
      && (u.id === target || u.name.toLowerCase() === target));
    if (!vins.length) return res.status(400).json({ error: 'Select at least one VIN' });
    if (!emp) return res.status(400).json({ error: 'Unknown employee' });
    const now = new Date().toISOString();
    const results = vins.map((vin) => {
      const v = store.getVehicle(vin);
      if (!v) return { vin, ok: false, error: 'VIN not found' };
      if (!canEditVehicle(v, req.dtUser)) return { vin, ok: false, error: 'Not your VIN' };
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

  router.get('/audit', auth, requireRole('admin'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json({ rows: (store.data.audit || []).slice(0, limit) });
  });

  return { router, store };
}

module.exports = { createDeliveryTransformationRouter };
