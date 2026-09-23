'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { USERS, emptyOps, emptyRaw } = require('./constants');

function emptyStore() {
  return {
    vehicles: {},
    audit: [],
    attendance: [],
    meta: {
      createdAt: new Date().toISOString(),
      updatedAt: null,
      label: 'delivery-transformation',
      memoInvoiceNext: 1000,
    },
  };
}

function createStore(filePath) {
  let data = emptyStore();
  const sessions = new Map();

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        data = emptyStore();
        seedDemoIfEmpty();
        save();
        return;
      }
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      data = {
        vehicles: raw.vehicles && typeof raw.vehicles === 'object' ? raw.vehicles : {},
        audit: Array.isArray(raw.audit) ? raw.audit : [],
        attendance: Array.isArray(raw.attendance) ? raw.attendance : [],
        meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : emptyStore().meta,
      };
      if (!Object.keys(data.vehicles).length) {
        seedDemoIfEmpty();
        save();
      }
    } catch (err) {
      console.error('[delivery-transformation] load failed:', err.message);
      data = emptyStore();
      seedDemoIfEmpty();
    }
  }

  function save() {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      data.meta.updatedAt = new Date().toISOString();
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error('[delivery-transformation] save failed:', err.message);
      throw err;
    }
  }

  function seedDemoIfEmpty() {
    const demo = [
      {
        vin: 'JTDTXFORM00000001',
        product: 'CAMRY',
        salesType: 'Cash',
        salesOrder: 'SO-9001',
        salesAdvisor: 'SA Demo',
        userName: 'عميل تجريبي ١',
        phone: '0500000001',
        gtLocation: 'GT-RUH',
        vehicleLocation: 'Yard A',
        employee: 'rasha',
        status: 'جاهز للتسليم',
        carrier: '',
        city: 'الرياض',
      },
      {
        vin: 'JTDTXFORM00000002',
        product: 'LAND CRUISER',
        salesType: 'Lease',
        salesOrder: 'SO-9002',
        salesAdvisor: 'SA Demo',
        userName: 'عميل تجريبي ٢',
        phone: '0500000002',
        gtLocation: 'GT-JED',
        vehicleLocation: 'Yard B',
        employee: 'ruba',
        status: 'Claimed',
        carrier: 'طريق الراسي',
        city: 'جدة',
      },
      {
        vin: 'JTDTXFORM00000003',
        product: 'RAV4',
        salesType: 'Bank',
        salesOrder: 'SO-9003',
        salesAdvisor: 'SA Demo',
        userName: 'عميل تجريبي ٣',
        phone: '0500000003',
        gtLocation: 'GT-DMM',
        vehicleLocation: 'Showroom',
        employee: 'ibrahim',
        status: 'مرور',
        carrier: 'درب الرياض',
        city: 'الدمام',
      },
    ];
    const now = new Date().toISOString();
    for (const d of demo) {
      const emp = USERS.find((u) => u.id === d.employee);
      const vin = d.vin;
      data.vehicles[vin] = {
        vin,
        raw: {
          ...emptyRaw(),
          vin,
          product: d.product,
          salesType: d.salesType,
          salesOrder: d.salesOrder,
          salesAdvisor: d.salesAdvisor,
          userName: d.userName,
          phone: d.phone,
          gtLocation: d.gtLocation,
          vehicleLocation: d.vehicleLocation,
          proformaDate: now.slice(0, 10),
          date: now.slice(0, 10),
          invoiceOwner: d.userName,
          pic: emp ? emp.name : '',
        },
        ops: {
          ...emptyOps(),
          opsStatus: d.status,
          carrier: d.carrier,
          transferCity: d.city,
          assignedEmployeeId: emp ? emp.id : '',
          assignedEmployeeName: emp ? emp.name : '',
          assignedBy: 'seed',
          assignedAt: now,
          updatedAt: now,
          updatedBy: 'seed',
        },
      };
    }
  }

  function getUserByLogin(name) {
    const key = String(name || '').trim().toLowerCase();
    return USERS.find((u) => u.id === key || u.name.toLowerCase() === key) || null;
  }

  function createSession(user) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, {
      userId: user.id,
      name: user.name,
      role: user.role,
      at: Date.now(),
    });
    return token;
  }

  function getSession(token) {
    if (!token) return null;
    const s = sessions.get(String(token).trim());
    if (!s) return null;
    if (Date.now() - s.at > 12 * 60 * 60 * 1000) {
      sessions.delete(token);
      return null;
    }
    s.at = Date.now();
    return s;
  }

  function destroySession(token) {
    sessions.delete(String(token || '').trim());
  }

  function allVehicles() {
    return Object.values(data.vehicles);
  }

  function getVehicle(vin) {
    const key = String(vin || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return data.vehicles[key] || null;
  }

  function upsertVehicle(vinKey, vehicle) {
    data.vehicles[vinKey] = vehicle;
  }

  function deleteVehicle(vinKey) {
    delete data.vehicles[vinKey];
  }

  function pushAudit(entry) {
    data.audit.unshift({
      id: `aud_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      at: new Date().toISOString(),
      ...entry,
    });
    if (data.audit.length > 2000) data.audit.length = 2000;
  }

  load();

  return {
    load,
    save,
    get data() { return data; },
    getUserByLogin,
    createSession,
    getSession,
    destroySession,
    allVehicles,
    getVehicle,
    upsertVehicle,
    deleteVehicle,
    pushAudit,
    filePath,
  };
}

module.exports = { createStore, emptyStore };
