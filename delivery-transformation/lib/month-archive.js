'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const DELIVERED = new Set(['تم التسليم', 'Claimed', 'تسليم متقدم']);
const CANCELLED = new Set(['الغاء']);

function classify(status) {
  const s = String(status || '').trim();
  if (DELIVERED.has(s)) return 'delivered';
  if (CANCELLED.has(s)) return 'cancelled';
  return 'notDelivered';
}

function monthOfVehicle(v) {
  const d = String((v && v.raw && v.raw.proformaDate) || '').trim();
  const m = d.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : '';
}

function sheetName(name) {
  return String(name || 'Sheet').replace(/[\[\]\\/*?:]/g, ' ').trim().slice(0, 31) || 'Sheet';
}

function appendSheet(wb, name, rows) {
  const data = Array.isArray(rows) && rows.length ? rows : [{ Note: 'No rows' }];
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, sheetName(name));
}

function createMonthArchive({ dir, getVehicles, getPrints, getAudit }) {
  if (!dir) throw new Error('archive dir required');
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');

  function readIndex() {
    try {
      const raw = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      return raw && typeof raw === 'object' ? { months: raw.months || {} } : { months: {} };
    } catch (_e) {
      return { months: {} };
    }
  }

  function writeIndex(idx) {
    const tmp = `${indexFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(idx, null, 2));
    fs.renameSync(tmp, indexFile);
  }

  function snapPath(month) {
    return path.join(dir, `${month}.json`);
  }

  function buildSnapshot(month) {
    const vehicles = (typeof getVehicles === 'function' ? getVehicles() : [])
      .filter((v) => monthOfVehicle(v) === month);
    const prints = (typeof getPrints === 'function' ? getPrints() : [])
      .filter((p) => String((p && p.at) || '').slice(0, 7) === month);
    const audit = (typeof getAudit === 'function' ? getAudit() : [])
      .filter((a) => String((a && a.at) || '').slice(0, 7) === month);

    let delivered = 0;
    let notDelivered = 0;
    let cancelled = 0;
    const cars = vehicles.map((v) => {
      const status = String((v.ops && v.ops.opsStatus) || '').trim();
      const bucket = classify(status);
      if (bucket === 'delivered') delivered += 1;
      else if (bucket === 'cancelled') cancelled += 1;
      else notDelivered += 1;
      return {
        vin: v.vin || '',
        product: (v.raw && v.raw.product) || v.product || '',
        status,
        bucket,
        employee: (v.ops && (v.ops.assignedEmployeeName || v.ops.employee)) || v.employee || '',
        salesType: (v.raw && v.raw.salesType) || '',
        proformaDate: (v.raw && v.raw.proformaDate) || '',
        customer: (v.raw && v.raw.userName) || '',
        carrier: (v.ops && v.ops.carrier) || '',
        city: (v.ops && v.ops.transferCity) || '',
        salesOrder: (v.raw && v.raw.salesOrder) || '',
      };
    });

    const carsCount = cars.length;
    return {
      month,
      savedAt: new Date().toISOString(),
      cars,
      prints: prints.map((p) => ({
        id: p.id || '',
        at: p.at || '',
        kind: p.kind || '',
        company: p.company || '',
        city: p.city || '',
        invoiceNumber: p.invoiceNumber || '',
        printedBy: p.printedBy || '',
        vins: Array.isArray(p.vins) ? p.vins : [],
      })),
      audit: audit.map((a) => ({
        at: a.at || '',
        user: a.user || '',
        vin: a.vin || '',
        action: a.action || '',
        oldValue: a.oldValue || '',
        newValue: a.newValue || '',
      })),
      counts: {
        cars: carsCount,
        delivered,
        notDelivered,
        cancelled,
      },
    };
  }

  function save(month, userName) {
    const ym = String(month || '').trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('Invalid month');
    const idx = readIndex();
    const prev = idx.months[ym];
    if (prev && prev.locked) throw new Error('Month archive is locked');
    const snap = buildSnapshot(ym);
    snap.savedBy = String(userName || 'Admin');
    const tmp = `${snapPath(ym)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2));
    fs.renameSync(tmp, snapPath(ym));
    idx.months[ym] = {
      savedAt: snap.savedAt,
      savedBy: snap.savedBy,
      locked: false,
      counts: snap.counts,
    };
    writeIndex(idx);
    return idx.months[ym];
  }

  function get(month) {
    const ym = String(month || '').trim();
    const idx = readIndex();
    return idx.months[ym] || null;
  }

  function list() {
    const idx = readIndex();
    return Object.keys(idx.months)
      .sort()
      .reverse()
      .map((month) => Object.assign({ month }, idx.months[month]));
  }

  function lock(month) {
    const ym = String(month || '').trim();
    const idx = readIndex();
    if (!idx.months[ym]) throw new Error('Month not archived');
    idx.months[ym].locked = true;
    writeIndex(idx);
    return idx.months[ym];
  }

  function workbook(month) {
    const ym = String(month || '').trim();
    const file = snapPath(ym);
    if (!fs.existsSync(file)) throw new Error('No snapshot for this month');
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    const c = snap.counts || { cars: 0, delivered: 0, notDelivered: 0, cancelled: 0 };
    const sum = (c.delivered || 0) + (c.notDelivered || 0) + (c.cancelled || 0);
    const check = sum === (c.cars || 0) ? 'OK' : 'MISMATCH';
    const wb = XLSX.utils.book_new();
    appendSheet(wb, 'Summary', [
      { Field: 'Month', Value: snap.month || ym },
      { Field: 'Saved at', Value: snap.savedAt || '' },
      { Field: 'Saved by', Value: snap.savedBy || '' },
      { Field: 'Cars', Value: c.cars || 0 },
      { Field: 'Delivered', Value: c.delivered || 0 },
      { Field: 'Not delivered', Value: c.notDelivered || 0 },
      { Field: 'Cancelled', Value: c.cancelled || 0 },
      { Field: 'Check', Value: check },
    ]);
    appendSheet(wb, 'Cars', (snap.cars || []).map((row) => ({
      VIN: row.vin,
      Product: row.product,
      Status: row.status,
      Bucket: row.bucket,
      Employee: row.employee,
      'Sales Type': row.salesType,
      'Proforma Date': row.proformaDate,
      Customer: row.customer,
      Carrier: row.carrier,
      City: row.city,
      'Sales Order': row.salesOrder,
    })));
    const noteRows = [];
    (snap.prints || []).forEach((p) => {
      const vins = Array.isArray(p.vins) && p.vins.length ? p.vins : [{}];
      vins.forEach((x) => {
        noteRows.push({
          Id: p.id,
          At: p.at,
          Kind: p.kind,
          Company: p.company,
          City: p.city,
          Invoice: p.invoiceNumber,
          'Printed by': p.printedBy,
          VIN: (x && x.vin) || '',
        });
      });
    });
    appendSheet(wb, 'Delivery notes', noteRows);
    const carriers = {};
    (snap.cars || []).forEach((row) => {
      const name = String(row.carrier || '').trim() || '(blank)';
      carriers[name] = (carriers[name] || 0) + 1;
    });
    appendSheet(wb, 'Carriers', Object.keys(carriers).sort().map((name) => ({ Company: name, Cars: carriers[name] })));
    const team = {};
    (snap.cars || []).forEach((row) => {
      const name = String(row.employee || '').trim() || '(blank)';
      team[name] = (team[name] || 0) + 1;
    });
    appendSheet(wb, 'Team', Object.keys(team).sort().map((name) => ({ Employee: name, Cars: team[name] })));
    appendSheet(wb, 'Audit', (snap.audit || []).map((a) => ({
      At: a.at,
      User: a.user,
      VIN: a.vin,
      Action: a.action,
      Old: a.oldValue,
      New: a.newValue,
    })));
    return wb;
  }

  function backupCopy(destDir) {
    if (!destDir) return;
    fs.mkdirSync(destDir, { recursive: true });
    fs.readdirSync(dir).forEach((name) => {
      if (name.endsWith('.tmp')) return;
      fs.copyFileSync(path.join(dir, name), path.join(destDir, name));
    });
  }

  function startAutoSave() {
    const tick = () => {
      try {
        const ym = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Riyadh',
          year: 'numeric',
          month: '2-digit',
        }).format(new Date());
        const cur = get(ym);
        if (!(cur && cur.locked)) save(ym, 'System');
        backupCopy(path.join(path.dirname(dir), 'delivery-transformation-archive-backup'));
      } catch (err) {
        console.error('[delivery-transformation] month-archive auto-save failed:', err.message);
      }
    };
    setTimeout(tick, 4000);
    const timer = setInterval(tick, 10 * 60 * 1000);
    if (timer.unref) timer.unref();
    return timer;
  }

  return {
    dir,
    save,
    get,
    list,
    lock,
    workbook,
    startAutoSave,
    backupCopy,
  };
}

function mountMonthArchiveRoutes(app, archive, { requireAdmin, auth } = {}) {
  const gate = [];
  if (auth) gate.push(auth);
  if (requireAdmin) gate.push(requireAdmin);

  app.get('/archive', ...gate, (_req, res) => {
    res.json({ months: archive.list() });
  });

  app.get('/archive/:month', ...gate, (req, res) => {
    const row = archive.get(req.params.month);
    if (!row) return res.status(404).json({ error: 'No snapshot for this month' });
    return res.json({ month: req.params.month, ...row });
  });

  app.post('/archive/:month/save', ...gate, (req, res) => {
    try {
      const who = (req.dtUser && req.dtUser.name) || 'Admin';
      const row = archive.save(req.params.month, who);
      return res.json({ ok: true, month: req.params.month, ...row });
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Could not save archive' });
    }
  });

  app.get('/archive/:month/xlsx', ...gate, (req, res) => {
    try {
      const wb = archive.workbook(req.params.month);
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const name = `DT-Month-${req.params.month}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      return res.send(buf);
    } catch (err) {
      return res.status(404).json({ error: err.message || 'No snapshot for this month' });
    }
  });
}

module.exports = { createMonthArchive, mountMonthArchiveRoutes };
