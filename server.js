'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const XLSX = require('xlsx');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'delivery-inventory-data.json');
const TEMPLATE_FILE = path.join(ROOT, 'templates', 'delivery_note_template.docx');
const DELIVERY_CHECK_TEMPLATE_FILE = path.join(ROOT, 'delivery_check_note.docx');
const DELIVERY_CHECK_PDF_FILE = path.join(ROOT, 'delivery_check_note.pdf');
const DELIVERY_CHECK_PREVIEW_IMAGE = path.join(ROOT, 'images', 'delivery-check-note-form.png');
const PORT = Number(process.env.PORT) || 3000;

const AGENTS = new Set(['ياسين', 'الفاضل', 'البراء', 'مستودع', 'warehouse', 'showroom admin', 'سيارات العرض']);
const AGENT_PASSWORD = process.env.DELIVERY_AGENT_PASSWORD || '1234';
const USER_ROLES = Object.freeze({
  ياسين: 'showroom',
  الفاضل: 'agent',
  البراء: 'agent',
  مستودع: 'warehouse',
  warehouse: 'warehouse',
  'showroom admin': 'showroom_admin',
  'سيارات العرض': 'showroom_admin'
});
const SHOWROOM_ADMIN_AGENT = 'showroom admin';
const SHOWROOM_PARKING_SLOTS = Object.freeze(['SR-1', 'SR-2', 'SR-3', 'SR-4', 'SR-5', 'SR-6', 'SR-7']);
const SHOWROOM_PARKING_LABEL = 'Showroom Cars';
const WAREHOUSE_ZONE_CONFIG = Object.freeze({
  A: { total: 40, labelAr: 'استلام' },
  B: { total: 40, labelAr: 'جاهز للتسليم' },
  C: { total: 24, labelAr: 'غسيل وتجهيز' },
  D: { total: 24, labelAr: 'انتظار الفحص' },
  E: { total: 18, labelAr: 'حجز العملاء' },
  F: { total: 12, labelAr: 'التحميل والخروج' }
});
const WAREHOUSE_ZONES = Object.freeze(Object.keys(WAREHOUSE_ZONE_CONFIG));
const MAX_DRAFTS = 2000;

const {
  MUTHAKARA_BRANCH_OPTIONS: DEFAULT_CITIES
} = require('./scripts/muthakara-branch-options.js');
const {
  MUTHAKARA_CUSTOMER_OPTIONS: DEFAULT_COMPANIES
} = require('./scripts/muthakara-customer-options.js');

function normalizeOptionName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function uniqueSorted(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const name = normalizeOptionName(raw);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b, 'ar'));
}

function defaultOptions() {
  return {
    companies: uniqueSorted(DEFAULT_COMPANIES),
    cities: uniqueSorted(DEFAULT_CITIES)
  };
}

const emptyStore = () => ({
  raw: null,
  vehicles: [],
  queue: [],
  drafts: [],
  manualVehicles: [],
  warehouseStock: [],
  showroomParking: [],
  options: defaultOptions(),
  meta: {
    filename: '',
    sheetName: '',
    uploadedAt: null,
    nextDeliveryNoteSeq: 1
  }
});

/** Fixed delivery branch per agent (no manual selection). */
const AGENT_AUTO_BRANCH = Object.freeze({
  الفاضل: 'جدة',
  البراء: 'الرياض'
});

let store = emptyStore();
const wsClients = new Set();

function ensureOptions() {
  if (!store.options || typeof store.options !== 'object') {
    store.options = defaultOptions();
    return;
  }
  if (!Array.isArray(store.options.companies) || !store.options.companies.length) {
    store.options.companies = uniqueSorted(DEFAULT_COMPANIES);
  } else {
    store.options.companies = uniqueSorted(store.options.companies);
  }
  if (!Array.isArray(store.options.cities) || !store.options.cities.length) {
    store.options.cities = uniqueSorted(DEFAULT_CITIES);
  } else {
    store.options.cities = uniqueSorted(store.options.cities);
  }
}

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      store = emptyStore();
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    store = {
      raw: parsed.raw ?? null,
      vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [],
      manualVehicles: Array.isArray(parsed.manualVehicles) ? parsed.manualVehicles : [],
      warehouseStock: Array.isArray(parsed.warehouseStock) ? parsed.warehouseStock : [],
      showroomParking: Array.isArray(parsed.showroomParking) ? parsed.showroomParking : [],
      options: parsed.options && typeof parsed.options === 'object'
        ? {
            companies: Array.isArray(parsed.options.companies) ? parsed.options.companies : [],
            cities: Array.isArray(parsed.options.cities) ? parsed.options.cities : []
          }
        : defaultOptions(),
      meta: {
        filename: parsed.meta?.filename || parsed.filename || '',
        sheetName: parsed.meta?.sheetName || parsed.sheetName || '',
        uploadedAt: parsed.meta?.uploadedAt || parsed.uploadedAt || null,
        nextDeliveryNoteSeq: Number(parsed.meta?.nextDeliveryNoteSeq) || 1
      }
    };
    ensureOptions();
    if (migrateDeliveryNoteFields()) {
      try {
        saveStore();
      } catch (e) {
        console.error('[delivery] migrate save failed:', e.message);
      }
    }
  } catch (err) {
    console.error('[delivery] failed to load store:', err.message);
    store = emptyStore();
  }
}

function saveStore() {
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function broadcastHubUpdate() {
  const payload = JSON.stringify({ type: 'delivery_hub_updated', at: Date.now() });
  for (const client of wsClients) {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch {
        /* ignore */
      }
    }
  }
}

function persistAndBroadcast() {
  saveStore();
  broadcastHubUpdate();
}

function todayIsoRiyadh() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function agentAutoBranch(username) {
  return AGENT_AUTO_BRANCH[String(username || '').trim()] || '';
}

function formatDeliveryNoteNumber(seq) {
  return `DN-${String(Math.max(1, Number(seq) || 1)).padStart(6, '0')}`;
}

function normalizeVehicleStatus(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'display' || v === 'عرض' || v === 'showroom') return 'display';
  if (v === 'delivery' || v === 'تسليم' || v === 'memo' || v === 'delivered') return 'delivery';
  return '';
}

function normalizeIsoDateOnly(raw, fallback) {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (fallback) {
    const f = String(fallback).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(f)) return f.slice(0, 10);
    const dt = new Date(f);
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(dt);
    }
  }
  return todayIsoRiyadh();
}

/** Scan drafts and bump next seq so new DN numbers never collide. */
function syncNextDeliveryNoteSeq() {
  if (!store.meta || typeof store.meta !== 'object') store.meta = {};
  let next = Number(store.meta.nextDeliveryNoteSeq) || 1;
  if (next < 1) next = 1;
  for (const d of store.drafts || []) {
    const n = String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '').trim();
    const m = n.match(/^DN-(\d+)$/i);
    if (m) next = Math.max(next, Number(m[1]) + 1);
  }
  store.meta.nextDeliveryNoteSeq = next;
  return next;
}

function allocateDeliveryNoteNumber() {
  syncNextDeliveryNoteSeq();
  const used = new Set();
  for (const d of store.drafts || []) {
    const n = String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '').trim();
    if (n) used.add(n);
  }
  let seq = Number(store.meta.nextDeliveryNoteSeq) || 1;
  let num;
  do {
    num = formatDeliveryNoteNumber(seq);
    seq += 1;
  } while (used.has(num));
  store.meta.nextDeliveryNoteSeq = seq;
  return num;
}

/**
 * Attach unique deliveryNoteNumber + normalized deliveryNoteDate (and optional
 * manual-entry fields) onto a draft. Does not use VIN as the note identity.
 */
function attachDeliveryNoteMeta(draft, extras = {}) {
  if (!draft || typeof draft !== 'object') return draft;
  if (!draft.payload || typeof draft.payload !== 'object') draft.payload = {};

  const existingNum = String(
    draft.deliveryNoteNumber || draft.payload.deliveryNoteNumber || extras.deliveryNoteNumber || ''
  ).trim();
  const deliveryNoteNumber = existingNum || allocateDeliveryNoteNumber();
  const deliveryNoteDate = normalizeIsoDateOnly(
    extras.deliveryNoteDate
      || draft.printedAt
      || extras.printedAt
      || draft.deliveryNoteDate
      || draft.payload.deliveryNoteDate
      || draft.payload.doc_date
      || draft.payload.transfer_date,
    draft.printedAt || extras.printedAt
  );

  draft.deliveryNoteNumber = deliveryNoteNumber;
  draft.deliveryNoteDate = deliveryNoteDate;
  draft.payload.deliveryNoteNumber = deliveryNoteNumber;
  draft.payload.deliveryNoteDate = deliveryNoteDate;

  const branchEntry = extras.branchEntryDate != null
    ? extras.branchEntryDate
    : (draft.branchEntryDate != null ? draft.branchEntryDate : draft.payload.branchEntryDate);
  if (branchEntry != null && String(branchEntry).trim()) {
    draft.branchEntryDate = normalizeIsoDateOnly(branchEntry, deliveryNoteDate);
    draft.payload.branchEntryDate = draft.branchEntryDate;
  }

  const status = normalizeVehicleStatus(
    extras.vehicleStatus != null
      ? extras.vehicleStatus
      : (draft.vehicleStatus != null ? draft.vehicleStatus : draft.payload.vehicleStatus)
  );
  if (status) {
    draft.vehicleStatus = status;
    draft.payload.vehicleStatus = status;
  }

  const entryAgent = extras.entryAgent != null
    ? extras.entryAgent
    : (draft.entryAgent != null ? draft.entryAgent : draft.assignedTo);
  if (entryAgent != null && String(entryAgent).trim()) {
    draft.entryAgent = String(entryAgent).trim();
    draft.payload.entryAgent = draft.entryAgent;
  }

  const manual = extras.manualEntry != null
    ? Boolean(extras.manualEntry)
    : (draft.manualEntry === true || draft.payload.manualEntry === true);
  if (manual) {
    draft.manualEntry = true;
    draft.payload.manualEntry = true;
  }

  return draft;
}

/** Backfill DN numbers/dates for existing drafts (one-time on load). */
function migrateDeliveryNoteFields() {
  if (!Array.isArray(store.drafts)) store.drafts = [];
  if (!Array.isArray(store.manualVehicles)) store.manualVehicles = [];
  if (!store.meta || typeof store.meta !== 'object') store.meta = {};

  // Ensure auto-branch cities exist in options
  const cities = store.options?.cities || [];
  const needCities = ['جدة', 'الرياض', 'جده'];
  let optionsDirty = false;
  for (const c of needCities) {
    if (!cities.some((x) => normalizeOptionName(x) === c)) {
      cities.push(c);
      optionsDirty = true;
    }
  }
  if (optionsDirty) {
    store.options.cities = uniqueSorted(cities);
  }

  syncNextDeliveryNoteSeq();
  let dirty = optionsDirty;

  // Prefer printedAt for deliveryNoteDate so monthly filters don't mis-bucket old notes
  for (const d of store.drafts || []) {
    if (!d.printedAt) continue;
    const fromPrint = normalizeIsoDateOnly(d.printedAt, d.printedAt);
    if (!fromPrint) continue;
    const current = String(d.deliveryNoteDate || (d.payload && d.payload.deliveryNoteDate) || '').trim().slice(0, 10);
    if (current !== fromPrint) {
      d.deliveryNoteDate = fromPrint;
      if (!d.payload || typeof d.payload !== 'object') d.payload = {};
      d.payload.deliveryNoteDate = fromPrint;
      dirty = true;
    }
  }

  const missing = store.drafts.filter(
    (d) => !String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '').trim()
      || !String(d.deliveryNoteDate || (d.payload && d.payload.deliveryNoteDate) || '').trim()
  );
  if (!missing.length && !dirty) return false;

  missing
    .slice()
    .sort((a, b) => {
      const ta = a.printedAt ? new Date(a.printedAt).getTime() : 0;
      const tb = b.printedAt ? new Date(b.printedAt).getTime() : 0;
      return ta - tb;
    })
    .forEach((d) => attachDeliveryNoteMeta(d));

  return true;
}

function draftMonthKey(draft) {
  const iso = String(
    draft?.deliveryNoteDate
      || (draft?.payload && draft.payload.deliveryNoteDate)
      || ''
  ).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 7);
  if (draft?.printedAt) {
    const dt = new Date(draft.printedAt);
    if (!Number.isNaN(dt.getTime())) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit'
      }).format(dt);
    }
  }
  return '';
}

function computeDeliveryNoteStats(drafts) {
  const list = Array.isArray(drafts) ? drafts : [];
  const vinSet = new Set();
  const stats = {
    deliveryNotes: list.length,
    uniqueVins: 0,
    display: 0,
    delivery: 0,
    warehouse: 0,
    memo: 0,
    showroom: 0,
    byMonth: {}
  };
  for (const d of list) {
    collectDraftVins(d.payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]).forEach((v) => vinSet.add(v));
    const status = normalizeVehicleStatus(d.vehicleStatus || (d.payload && d.payload.vehicleStatus));
    const isSh = Boolean(d.showroomDisplay) || isShowroomDraftPayload(d.payload) || status === 'display';
    const isWh = !isSh && isWarehouseDraftPayload(d.payload);

    if (status === 'display' || (isSh && status !== 'delivery')) stats.display += 1;
    else stats.delivery += 1;

    if (isSh) stats.showroom += 1;
    else if (isWh) stats.warehouse += 1;
    else stats.memo += 1;

    const mk = draftMonthKey(d);
    if (mk) stats.byMonth[mk] = (stats.byMonth[mk] || 0) + 1;
  }
  stats.uniqueVins = vinSet.size;

  const now = todayIsoRiyadh();
  const thisMonth = now.slice(0, 7);
  const [y, m] = thisMonth.split('-').map(Number);
  const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  stats.thisMonth = stats.byMonth[thisMonth] || 0;
  stats.lastMonth = stats.byMonth[last] || 0;
  return stats;
}

function normVin(v) {
  return String(v || '').trim().toUpperCase().replace(/\s+/g, '');
}

function vehicleIndex() {
  const map = new Map();
  for (const v of store.vehicles) {
    const vin = normVin(v.vin);
    if (vin) map.set(vin, v);
  }
  return map;
}

function statusLabelFor(item) {
  const vStatus = normalizeVehicleStatus(item.vehicleStatus);
  if (item.agentStatus === 'display' || vStatus === 'display') {
    if (item.agentStatus !== 'delivered') return 'عرض';
  }
  if (item.agentStatus === 'delivered') {
    if (vStatus === 'display' || item.showroomDisplay || item.deliveryMode === 'showroom') {
      return 'عرض الصالة';
    }
    return item.deliveryMode === 'warehouse'
      ? 'تم التسليم في المستودع'
      : 'تم الترحيل';
  }
  const wh = findWarehouseInStock(item.vin);
  if (wh) {
    return `في المستودع · ${wh.slot}`;
  }
  // Added by coordinator — waiting until agent creates the delivery note
  if (item.status === 'available' || !item.agentStatus) {
    return 'Waiting for delivery';
  }
  if (item.agentStatus === 'out_of_delivery') return 'Out for delivery';
  if (item.agentStatus === 'ready_for_delivery') return 'Ready';
  if (item.agentStatus === 'in_stock') {
    return item.assignedTo
      ? `Waiting for delivery · مع ${item.assignedTo}`
      : 'Waiting for delivery';
  }
  return item.assignedTo
    ? `Waiting for delivery · مع ${item.assignedTo}`
    : 'Waiting for delivery';
}

function ensureWarehouseStock() {
  if (!Array.isArray(store.warehouseStock)) store.warehouseStock = [];
}

function ensureShowroomParking() {
  if (!Array.isArray(store.showroomParking)) store.showroomParking = [];
}

function findShowroomParkingInStock(vin) {
  ensureShowroomParking();
  const key = normVin(vin);
  if (!key) return null;
  return store.showroomParking.find((e) => normVin(e.vin) === key && e.status === 'in') || null;
}

function normalizeShowroomParkingSlot(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (SHOWROOM_PARKING_SLOTS.includes(s)) return s;
  const m = s.match(/^(?:SR-?)?([1-7])$/);
  if (m) return `SR-${m[1]}`;
  return '';
}

function enrichShowroomParkingEntry(entry) {
  const vin = normVin(entry.vin);
  const veh = vehicleIndex().get(vin);
  const queueItem = findQueueItem(vin);
  return {
    ...entry,
    vin,
    product: entry.product || veh?.product || veh?.model || queueItem?.product || '',
    plate: entry.plate || veh?.plate || queueItem?.plate || '',
    model: entry.model || veh?.model || entry.product || '',
    label: SHOWROOM_PARKING_LABEL,
    section: 'showroom'
  };
}

function showroomParkingOccupancy() {
  ensureShowroomParking();
  const used = new Map(
    store.showroomParking
      .filter((e) => e.status === 'in')
      .map((e) => [String(e.slot || '').toUpperCase(), enrichShowroomParkingEntry(e)])
  );
  const slots = SHOWROOM_PARKING_SLOTS.map((slot) => ({
    slot,
    free: !used.has(slot),
    entry: used.get(slot) || null
  }));
  return {
    total: SHOWROOM_PARKING_SLOTS.length,
    used: slots.filter((s) => !s.free).length,
    free: slots.filter((s) => s.free).length,
    slots,
    label: SHOWROOM_PARKING_LABEL
  };
}

function findWarehouseInStock(vin) {
  ensureWarehouseStock();
  const key = normVin(vin);
  if (!key) return null;
  return store.warehouseStock.find((e) => normVin(e.vin) === key && e.status === 'in') || null;
}

function warehouseOccupancy() {
  ensureWarehouseStock();
  const used = new Set(
    store.warehouseStock.filter((e) => e.status === 'in').map((e) => String(e.slot || '').toUpperCase())
  );
  const zones = {};
  for (const zone of WAREHOUSE_ZONES) {
    const cfg = WAREHOUSE_ZONE_CONFIG[zone] || { total: 40, labelAr: zone };
    const slots = [];
    for (let i = 1; i <= cfg.total; i += 1) {
      const slot = `${zone}-${i}`;
      slots.push({ slot, free: !used.has(slot) });
    }
    zones[zone] = {
      total: cfg.total,
      labelAr: cfg.labelAr,
      used: slots.filter((s) => !s.free).length,
      free: slots.filter((s) => s.free).length,
      nextSlot: (slots.find((s) => s.free) || {}).slot || null,
      slots
    };
  }
  return zones;
}

function nextFreeSlot(zone) {
  const z = String(zone || '').trim().toUpperCase();
  if (!WAREHOUSE_ZONES.includes(z)) return null;
  const occ = warehouseOccupancy();
  return occ[z]?.nextSlot || null;
}

function enrichWarehouseEntry(entry) {
  const vin = normVin(entry.vin);
  const veh = vehicleIndex().get(vin);
  const queueItem = findQueueItem(vin);
  return {
    ...entry,
    vin,
    product: entry.product || veh?.product || veh?.model || queueItem?.product || '',
    plate: entry.plate || veh?.plate || queueItem?.plate || '',
    inCoordinatorQueue: Boolean(queueItem),
    coordinatorAssignee: queueItem?.assignedTo || '',
    plannedDeliveryMode: queueItem
      ? normalizePlannedDeliveryMode(queueItem.plannedDeliveryMode || queueItem.deliveryType || '')
      : ''
  };
}

function vehicleStatusPaperLabel(status) {
  const s = normalizeVehicleStatus(status);
  if (s === 'display') return 'عرض';
  if (s === 'delivery') return 'تسليم';
  return '';
}

/** Month key YYYY-MM from ISO timestamp (Asia/Riyadh). */
function isoToMonthKey(iso) {
  if (!iso) return '';
  const s = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit'
  }).format(dt);
}

/**
 * Coordinator hides تم الترحيل from previous months once the calendar
 * rolls (from the 1st of the new month onward). Current-month deliveries stay.
 * Display / showroom cars are never month-archived this way.
 */
function queueItemDeliveredMonth(item) {
  if (!item) return '';
  const direct = isoToMonthKey(item.deliveredAt || item.assignedAt || item.addedAt);
  if (direct) return direct;
  // Fall back to newest delivery-note draft for this VIN
  const vin = normVin(item.vin);
  if (!vin) return '';
  let best = '';
  for (const d of store.drafts || []) {
    const vins = collectDraftVins(d.payload, [d.vin, ...(Array.isArray(d.vins) ? d.vins : [])]);
    if (!vins.includes(vin)) continue;
    if (normalizeVehicleStatus(d.vehicleStatus || d.payload?.vehicleStatus) === 'display') continue;
    if (d.showroomDisplay || isShowroomDraftPayload(d.payload)) continue;
    const mk = draftMonthKey(d) || isoToMonthKey(d.printedAt || d.deliveryNoteDate);
    if (mk && mk > best) best = mk;
  }
  return best;
}

function isPriorMonthDelivered(item) {
  if (!item || item.agentStatus !== 'delivered') return false;
  if (normalizeVehicleStatus(item.vehicleStatus) === 'display') return false;
  if (item.showroomDisplay || item.deliveryMode === 'showroom') return false;
  const current = todayIsoRiyadh().slice(0, 7);
  const deliveredMonth = queueItemDeliveredMonth(item);
  // Undated delivered cars: treat as prior once we are past day 1 of a month
  // only if they have no current-month signal — keep visible in current month if unknown
  if (!deliveredMonth) return false;
  return deliveredMonth < current;
}

const NOTES_ARCHIVE_DIR = path.join(ROOT, 'delivery-notes-archive');

function ensureNotesArchiveDir() {
  if (!fs.existsSync(NOTES_ARCHIVE_DIR)) {
    fs.mkdirSync(NOTES_ARCHIVE_DIR, { recursive: true });
  }
}

/** Persist delivery note as DOCX archive (printable document kept forever). */
function archiveDeliveryNoteFile(draft) {
  if (!draft || typeof draft !== 'object') return null;
  try {
    ensureNotesArchiveDir();
    const num = String(draft.deliveryNoteNumber || draft.id || `draft_${Date.now()}`).replace(/[^\w.-]+/g, '_');
    const payload = { ...(draft.payload || {}) };
    if (draft.deliveryNoteNumber) payload.deliveryNoteNumber = draft.deliveryNoteNumber;
    if (draft.vehicleStatus) {
      payload.vehicleStatus = draft.vehicleStatus;
      payload.attachments = [
        String(payload.attachments || '').trim(),
        `الحالة / Status: ${vehicleStatusPaperLabel(draft.vehicleStatus)}`
      ].filter(Boolean).join('\n');
    }
    const buf = generateDocx(payload);
    const filename = `${num}.docx`;
    const abs = path.join(NOTES_ARCHIVE_DIR, filename);
    fs.writeFileSync(abs, buf);
    draft.archiveFile = filename;
    draft.archivePath = `delivery-notes-archive/${filename}`;
    draft.archiveSavedAt = new Date().toISOString();
    draft.pdfSaved = true; // archived printable document (DOCX) for admin
    return draft.archivePath;
  } catch (err) {
    console.error('[archive-note]', err.message);
    return null;
  }
}

const SHOWROOM_SPECIAL_NAME = 'سيارات عرض الصالة';
const SHOWROOM_AGENT = 'ياسين';

function isShowroomDraftPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.showroom_display === true || payload.showroom_group === true) return true;
  if (payload.deliveryMode === 'showroom') return true;
  if (normalizeVehicleStatus(payload.vehicleStatus) === 'display') return true;
  return false;
}

function isWarehouseDraftPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (isShowroomDraftPayload(payload)) return false;
  if (payload.deliveryMode === 'warehouse' || payload.warehouse_group === true) return true;
  const branch = String(payload.branch_to || '').trim();
  if (branch === 'المستودع' || branch === 'في المستودع') return true;
  const company = String(payload.company_rep || '').trim();
  if (company.includes('مستودع') && company !== SHOWROOM_SPECIAL_NAME) return true;
  // Do not treat leftover owner/print fields alone as warehouse — memo forms share those inputs.
  return false;
}

function isWarehouseExportRow(row) {
  const deliveryType = String(pickCol(row, [
    'delivery type', 'delivery mode', 'نوع التسليم', 'section', 'القسم'
  ]) || '').trim().toLowerCase();
  if (deliveryType === 'showroom' || deliveryType.includes('عرض')) return false;
  if (deliveryType === 'warehouse' || deliveryType.includes('مستودع') || deliveryType.includes('warehouse')) {
    return true;
  }
  const companyName = String(pickCol(row, ['company name', 'company', 'اسم الشركة', 'الشركة']) || '').trim();
  if (companyName === 'سيارات عرض الصالة') return false;
  if (companyName === 'مستودع الهاتفية' || (companyName.includes('مستودع') && !companyName.includes('عرض'))) return true;
  const branchTo = String(pickCol(row, ['branch to', 'branch', 'الفرع', 'إلى فرع']) || '').trim();
  if (branchTo === 'المستودع' || branchTo === 'في المستودع') return true;
  const classification = String(pickCol(row, ['classification', 'status label']) || '');
  if (classification.includes('المستودع')) return true;
  return false;
}

/** Collect unique VINs from draft payload cars / vins arrays (+ optional extras). */
function collectDraftVins(draftPayload, extra = []) {
  const fromCars = Array.isArray(draftPayload?.cars)
    ? draftPayload.cars.map((c) => c?.chassis || c?.vin || '')
    : [];
  const fromPayloadVins = Array.isArray(draftPayload?.vins) ? draftPayload.vins : [];
  const fromExtra = Array.isArray(extra) ? extra : [extra];
  return [...new Set(
    [...fromExtra, ...fromPayloadVins, ...fromCars]
      .map((v) => normVin(v))
      .filter(Boolean)
  )];
}

/**
 * Mark VINs as delivered on the coordinator queue (creates queue rows if missing).
 * Shared by agent complete-print and admin draft edit.
 * display status → stays pickable by agents for a later delivery note.
 */
function markVinsDelivered(vins, {
  assignedTo = 'admin',
  warehouseDelivery = false,
  showroomDisplay = false,
  vehicleStatus = '',
  forceAssign = true,
  carMetaByVin = null
} = {}) {
  const byVehicle = vehicleIndex();
  const deliveredItems = [];
  const blocked = [];
  const status = normalizeVehicleStatus(vehicleStatus)
    || (showroomDisplay ? 'display' : 'delivery');
  const isDisplay = status === 'display' || showroomDisplay;
  const nowIso = new Date().toISOString();

  for (const vin of vins) {
    const meta = (carMetaByVin && carMetaByVin.get(vin)) || {};
    let item = findQueueItem(vin);
    if (!item) {
      const veh = byVehicle.get(vin);
      item = enrichFromVehicle({
        vin,
        // Display cars stay available so agents can pick them for a new delivery note
        status: isDisplay ? 'available' : 'claimed',
        agentStatus: isDisplay ? 'display' : 'delivered',
        deliveryMode: isDisplay ? 'showroom' : (warehouseDelivery ? 'warehouse' : ''),
        showroomDisplay: Boolean(isDisplay),
        vehicleStatus: status,
        assignedTo: isDisplay ? '' : (assignedTo || 'admin'),
        assignedAt: nowIso,
        deliveredAt: isDisplay ? '' : nowIso,
        addedAt: nowIso,
        product: meta.product || '',
        model: meta.model || meta.product || '',
        plate: meta.plate || '',
        entryAgent: assignedTo || ''
      }, veh || {});
      store.queue.push(item);
    } else {
      if (
        !forceAssign
        && item.assignedTo
        && assignedTo
        && item.assignedTo !== assignedTo
        && item.agentStatus !== 'delivered'
        && item.agentStatus !== 'display'
      ) {
        blocked.push({ vin, assignedTo: item.assignedTo });
        continue;
      }
      if (isDisplay) {
        item.status = 'available';
        item.agentStatus = 'display';
        item.deliveryMode = 'showroom';
        item.showroomDisplay = true;
        item.vehicleStatus = 'display';
        item.assignedTo = '';
        item.deliveredAt = '';
      } else {
        item.status = 'claimed';
        item.agentStatus = 'delivered';
        item.deliveryMode = warehouseDelivery ? 'warehouse' : '';
        item.showroomDisplay = false;
        item.vehicleStatus = 'delivery';
        if (assignedTo) item.assignedTo = assignedTo;
        item.deliveredAt = nowIso;
      }
      item.assignedAt = nowIso;
      if (meta.product && !item.product) item.product = meta.product;
      if (meta.model && !item.model) item.model = meta.model;
      if (meta.plate && !item.plate) item.plate = meta.plate;
      if (assignedTo) item.entryAgent = assignedTo;
    }
    deliveredItems.push(enrichQueueItem(item));
  }

  return { deliveredItems, blocked };
}

function normalizePlannedDeliveryMode(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'warehouse' || v === 'مستودع' || v === 'wh') return 'warehouse';
  if (v === 'memo' || v === 'delivery' || v === 'ترحيل' || v === 'transfer') return 'memo';
  return '';
}

/** True when queue item has no real delivery company (needs coordinator assign). */
function isUnassignedDeliveryCompany(item) {
  const c = String(item?.deliveryCompany || item?.company || '').trim();
  if (!c) return true;
  const key = c.toLowerCase().replace(/\s+/g, ' ');
  return key === 'بدون شركة'
    || key === 'بدون الشركه'
    || key === 'unassigned'
    || key === 'no company'
    || key === 'none'
    || key === '-';
}

function enrichQueueItem(item) {
  const vin = normVin(item.vin);
  const veh = vehicleIndex().get(vin);
  const deliveredMonth = queueItemDeliveredMonth(item);
  const archivedFromCoordinator = isPriorMonthDelivered(item);
  const wh = findWarehouseInStock(vin);
  const enriched = {
    ...item,
    vin,
    product: item.product || veh?.product || veh?.model || '',
    model: item.model || veh?.model || veh?.product || '',
    gt: item.gt || veh?.gt || '',
    location: item.location || veh?.location || '',
    plate: item.plate || veh?.plate || '',
    imageUrl: item.imageUrl || veh?.imageUrl || '',
    customerName: item.customerName || veh?.customerName || '',
    phone: item.phone || veh?.phone || '',
    deliveryCompany: item.deliveryCompany || item.company || '',
    company: item.deliveryCompany || item.company || '',
    plannedDeliveryMode: normalizePlannedDeliveryMode(item.plannedDeliveryMode || item.deliveryType || '')
      || (item.deliveryMode === 'warehouse' && item.agentStatus !== 'delivered' ? 'warehouse' : '')
      || '',
    vehicleStatus: normalizeVehicleStatus(item.vehicleStatus) || item.vehicleStatus || '',
    deliveredMonth,
    archivedFromCoordinator,
    warehouseInStock: Boolean(wh),
    warehouseSlot: wh?.slot || '',
    warehouseZone: wh?.zone || '',
    warehouseStockedInAt: wh?.stockedInAt || '',
    statusLabel: statusLabelFor(item)
  };
  return enriched;
}

function computeStats() {
  const stats = {
    total: store.queue.length,
    available: 0,
    in_stock: 0,
    ready_for_delivery: 0,
    out_of_delivery: 0,
    delivered: 0,
    drafts: store.drafts.length
  };
  for (const item of store.queue) {
    if (item.status === 'available') {
      stats.available += 1;
      continue;
    }
    const st = item.agentStatus || '';
    if (st === 'in_stock') stats.in_stock += 1;
    else if (st === 'ready_for_delivery') stats.ready_for_delivery += 1;
    else if (st === 'out_of_delivery') stats.out_of_delivery += 1;
    else if (st === 'delivered') stats.delivered += 1;
  }
  return stats;
}

function buildDashboard() {
  const productCounts = new Map();
  for (const v of store.vehicles) {
    const p = String(v.product || v.model || '').trim() || '—';
    productCounts.set(p, (productCounts.get(p) || 0) + 1);
  }
  const topProducts = [...productCounts.entries()]
    .map(([product, count]) => ({ product, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);

  return {
    totalVehicles: store.vehicles.length,
    uniqueProducts: productCounts.size,
    uploadedAt: store.meta.uploadedAt,
    filename: store.meta.filename,
    sheetName: store.meta.sheetName,
    topProducts
  };
}

function authenticateAgent(username, password) {
  let user = String(username || '').trim();
  const lower = user.toLowerCase();
  if (lower === 'warehouse' || lower === 'wh') user = 'warehouse';
  if (user === 'مستودع' || lower === 'mustawda') user = 'مستودع';
  if (lower === 'showroom admin' || lower === 'showroomadmin' || lower === 'showroom cars' || user === 'سيارات العرض') {
    user = SHOWROOM_ADMIN_AGENT;
  }
  if (!AGENTS.has(user)) return { ok: false, error: 'اسم المستخدم غير معروف' };
  const pass = String(password || '').trim();
  if (pass !== String(AGENT_PASSWORD).trim()) {
    return { ok: false, error: 'كلمة المرور غير صحيحة' };
  }
  const role = USER_ROLES[user] || 'agent';
  return { ok: true, username: user, role };
}

function findQueueItem(vin) {
  const key = normVin(vin);
  return store.queue.find((q) => normVin(q.vin) === key) || null;
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

  // 1) Exact normalized header match
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    const hit = entries.find((e) => e.norm === a);
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }

  // 2) Starts-with / contains (token-aware) — supports "VIN No.", "GT Location", etc.
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    if (!a) continue;
    const hit = entries.find((e) => {
      if (!e.norm || e.norm === a) return false;
      if (e.norm.startsWith(`${a} `) || e.norm.endsWith(` ${a}`) || e.norm.includes(` ${a} `)) return true;
      // short keys like vin / gt: match headers that begin with them ("vin no", "gt location")
      if (a.length <= 3) return e.norm.startsWith(`${a} `) || e.norm.startsWith(a);
      return e.norm.includes(a);
    });
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  return '';
}

function enrichFromVehicle(item, veh) {
  if (!veh) {
    return {
      ...item,
      product: '',
      model: '',
      gt: '',
      location: '',
      plate: item.plate || '',
      imageUrl: item.imageUrl || '',
      customerName: item.customerName || '',
      phone: item.phone || ''
    };
  }
  return {
    ...item,
    product: veh.product || '',
    model: veh.model || veh.product || '',
    gt: veh.gt || '',
    location: veh.location || '',
    plate: veh.plate || item.plate || '',
    imageUrl: veh.imageUrl || item.imageUrl || '',
    customerName: veh.customerName || item.customerName || '',
    phone: veh.phone || item.phone || ''
  };
}

function queuePriority(item) {
  if (item.agentStatus === 'delivered') return 5;
  if (item.agentStatus === 'out_of_delivery') return 4;
  if (item.agentStatus === 'ready_for_delivery') return 3;
  if (item.agentStatus === 'in_stock') return 2;
  if (item.status === 'claimed') return 1;
  return 0;
}

/** Keep one row per VIN (prefer active assignment over available). */
function dedupeQueue(queue) {
  const best = new Map();
  for (const raw of queue || []) {
    const vin = normVin(raw.vin);
    if (!vin) continue;
    const item = { ...raw, vin };
    const prev = best.get(vin);
    if (!prev || queuePriority(item) > queuePriority(prev)) {
      best.set(vin, item);
    }
  }
  return Array.from(best.values());
}

function refreshQueueFromVehicles() {
  const byVin = vehicleIndex();
  let matched = 0;
  let missing = 0;
  store.queue = dedupeQueue(store.queue).map((item) => {
    const veh = byVin.get(normVin(item.vin));
    if (veh) matched += 1;
    else missing += 1;
    return enrichFromVehicle(item, veh);
  });
  return { matched, missing, total: store.queue.length };
}

function parseDataUrl(fileData) {
  const raw = String(fileData || '');
  const m = raw.match(/^data:[^;]+;base64,(.+)$/i);
  const b64 = m ? m[1] : raw;
  return Buffer.from(b64, 'base64');
}

function sheetRows(wb, name) {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function findSheetName(wb, aliases) {
  const names = wb.SheetNames || [];
  for (const alias of aliases) {
    const a = normalizeHeader(alias);
    const hit = names.find((n) => normalizeHeader(n) === a || normalizeHeader(n).includes(a));
    if (hit) return hit;
  }
  return '';
}

function normalizeExcelDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value || '').trim();
  if (!s || s === '#' || /^n\/?a$/i.test(s)) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (mdy) {
    let y = Number(mdy[3]);
    if (y < 100) y += 2000;
    const month = String(Number(mdy[1])).padStart(2, '0');
    const day = String(Number(mdy[2])).padStart(2, '0');
    if (Number(month) > 12 && Number(day) <= 12) {
      // D/M/YYYY fallback
      return `${y}-${String(Number(mdy[2])).padStart(2, '0')}-${String(Number(mdy[1])).padStart(2, '0')}`;
    }
    return `${y}-${month}-${day}`;
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return '';
}

function pickExactishCol(row, aliases) {
  // Prefer exact / starts-with matches; avoid grabbing "* Date" columns for short keys like plate
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
    if (!a || a.length < 4) continue;
    const hit = entries.find((e) => {
      if (!e.norm || e.norm === a) return false;
      if (/\bdate\b|تاريخ/.test(e.norm) && !/\bdate\b|تاريخ/.test(a)) return false;
      return e.norm.startsWith(`${a} `) || e.norm.endsWith(` ${a}`) || e.norm.includes(` ${a} `);
    });
    if (hit && row[hit.orig] != null && String(row[hit.orig]).trim() !== '') {
      return String(row[hit.orig]).trim();
    }
  }
  return '';
}

const VIN_ALIASES = [
  'vin no', 'vin no.', 'vin number', 'vin#', 'vin',
  'chassis', 'chassis / vin', 'chassis/vin', 'chassis no', 'chassis no.',
  'chassis number', 'شاسيه', 'رقم الشاسيه', 'frame', 'frame no'
];

function rowToVehicle(row) {
  const vin = normVin(pickCol(row, VIN_ALIASES));
  if (!vin || vin.length < 5) return null;
  if (!/[A-HJ-NPR-Z0-9]/i.test(vin)) return null;

  const product = pickCol(row, ['product', 'product name', 'وصف', 'المنتج', 'الطراز']);
  // Exact "Model" only — never "Model Year"
  const modelExact = (() => {
    const keys = Object.keys(row || {});
    for (const k of keys) {
      if (normalizeHeader(k) === 'model' && row[k] != null && String(row[k]).trim() !== '') {
        return String(row[k]).trim();
      }
    }
    return '';
  })();
  const model = modelExact || product;
  const gt = pickCol(row, ['gt location', 'gt status', 'gt code', 'gtcode', 'gt_code', 'gt']);
  const location = pickCol(row, [
    'gt location', 'stock location', 'storage location', 'location',
    'warehouse', 'yard', 'الموقع', 'المستودع'
  ]);
  const plate = pickExactishCol(row, ['plate', 'plate no', 'plate number', 'veh plate', 'لوحة', 'رقم اللوحة']);
  const customerName = pickCol(row, ['customer name', 'customer', 'اسم العميل', 'العميل']);
  const phone = pickCol(row, [
    'contact no', 'contact no.', 'contact number', 'contact',
    'phone', 'phone no', 'phone number', 'mobile', 'mobile no', 'mobile number',
    'tel', 'telephone', 'هاتف', 'جوال', 'رقم الجوال', 'رقم الهاتف'
  ]);
  const imageUrl = pickCol(row, ['image', 'image url', 'imageurl', 'photo', 'صورة']);
  const suffix = pickCol(row, ['suffix', 'ext', 'color', 'model year']);
  const proformaDate = normalizeExcelDate(pickCol(row, [
    'proforma date', 'proforma', 'pro forma date', 'تاريخ البروفورما', 'تاريخ العرض'
  ]));
  const invoiceDate = normalizeExcelDate(pickCol(row, [
    'invoice date', 'inv date', 'billing date', 'تاريخ الفاتورة', 'تاريخ الفاتوره'
  ]));
  const deliveryNoteDate = normalizeExcelDate(pickCol(row, [
    'delivery note date', 'delivery date', 'dn date', 'muthakara date',
    'transfer date', 'تاريخ المذكرة', 'تاريخ مذكرة الترحيل', 'تاريخ الترحيل'
  ]));

  return {
    vin,
    product: product || model,
    model: model || product,
    gt,
    location,
    plate: plate === '#' ? '' : plate,
    customerName,
    phone: phone === '#' ? '' : phone,
    imageUrl,
    suffix,
    proformaDate,
    invoiceDate,
    deliveryNoteDate
  };
}

/** Admin export workbook (Vehicle Inventory / Print Drafts / Coordinator Queue). */
function isDeliveryExportWorkbook(wb, filename) {
  const names = (wb.SheetNames || []).map((n) => normalizeHeader(n));
  const fileHint = normalizeHeader(filename || '');
  if (/delivery[\s_-]*export|admin[\s_-]*export|تصدير|archive|أرشيف/i.test(fileHint)) return true;
  return names.some((n) =>
    n.includes('vehicle inventory')
    || n.includes('print draft')
    || n.includes('coordinator queue')
    || (n.includes('سجل') && n.includes('مركبات'))
    || n.includes('مسودات')
    || (n.includes('قائمة') && (n.includes('شاس') || n.includes('coordinator')))
  );
}

function finishRestoreExport(buffer, filename, res) {
  const parsed = parseSalesWorkbook(buffer, filename || 'delivery_export.xlsx');
  const fileLooksExport = /delivery[\s_-]*export|admin[\s_-]*export|تصدير|archive|أرشيف/i.test(String(filename || ''));
  const hasDrafts = Array.isArray(parsed.drafts) && parsed.drafts.length > 0;
  const hasQueue = Array.isArray(parsed.queue) && parsed.queue.length > 0;
  const fullArchive = Boolean(parsed.isExport || fileLooksExport || hasDrafts || hasQueue);

  if (!parsed.vehicles.length && !hasDrafts) {
    return res.status(400).json({
      error: 'الملف لا يحتوي على مركبات أو مسودات. استخدم delivery_export_….xlsx من تصدير اللوحة، أو ارفع Sales Raw من زر «رفع Sales Raw».'
    });
  }

  if (!fullArchive && !fileLooksExport) {
    const refresh = applyParsedInventory(parsed, { replaceDrafts: false, replaceQueue: false });
    persistAndBroadcast();
    return res.json({
      ok: true,
      mode: 'inventory_only',
      imported: parsed.vehicles.length,
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      sheetName: parsed.sheetName,
      filename: parsed.filename,
      queueRefreshed: refresh.total,
      note: 'تم استيراد المركبات فقط — لاستيراد المسودات والقائمة استخدم ملف delivery_export'
    });
  }

  const refresh = applyParsedInventory(parsed, { replaceDrafts: true, replaceQueue: true });
  persistAndBroadcast();
  return res.json({
    ok: true,
    mode: 'full',
    imported: parsed.vehicles.length,
    draftsImported: (parsed.drafts || []).length,
    queueImported: (parsed.queue || []).length,
    sheetName: parsed.sheetName,
    filename: parsed.filename,
    queueRefreshed: refresh.total
  });
}

function parseVehiclesFromRows(rows) {
  const found = [];
  const seen = new Set();
  for (const row of rows || []) {
    const veh = rowToVehicle(row);
    if (!veh) continue;
    if (seen.has(veh.vin)) continue;
    seen.add(veh.vin);
    found.push(veh);
  }
  return found;
}

/** Sales Raw column P (0-based index 15) = Proforma Date when header name is missing. */
function extractVinFromArrayLine(headerRow, line) {
  const headers = Array.isArray(headerRow) ? headerRow : [];
  const cells = Array.isArray(line) ? line : [];
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeader(String(headers[i] || ''));
    if (!h) continue;
    const isVinCol = VIN_ALIASES.some((a) => {
      const alias = normalizeHeader(a);
      return alias && (h === alias || h.includes(alias) || alias.includes(h));
    });
    if (isVinCol) {
      const v = normVin(String(cells[i] || ''));
      if (v) return v;
    }
  }
  for (const cell of cells) {
    const v = normVin(String(cell || ''));
    if (v && v.length >= 11) return v;
  }
  return '';
}

function backfillProformaColumnP(wb, sheetName, vehicles) {
  const sheet = wb && wb.Sheets ? wb.Sheets[sheetName] : null;
  if (!sheet || !Array.isArray(vehicles) || !vehicles.length) return;
  const rowsArr = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (!rowsArr.length) return;
  const headerRow = rowsArr[0] || [];
  const byVin = new Map(vehicles.map((v) => [normVin(v.vin), v]));
  const COL_P = 15;
  for (let i = 1; i < rowsArr.length; i++) {
    const line = rowsArr[i];
    const vin = extractVinFromArrayLine(headerRow, line);
    if (!vin) continue;
    const veh = byVin.get(vin);
    if (!veh || veh.proformaDate) continue;
    const raw = line[COL_P];
    if (raw != null && String(raw).trim() !== '') {
      veh.proformaDate = normalizeExcelDate(raw);
    }
  }
}

function isShowroomExportRow(row) {
  const deliveryType = String(pickCol(row, [
    'delivery type', 'delivery mode', 'نوع التسليم', 'section', 'القسم', 'flag'
  ]) || '').trim().toLowerCase();
  if (deliveryType === 'showroom' || deliveryType.includes('عرض')) return true;
  const companyName = String(pickCol(row, ['company name', 'company', 'اسم الشركة', 'الشركة']) || '').trim();
  if (companyName === 'سيارات عرض الصالة') return true;
  return false;
}

function buildDraftPayloadFromExportRow(row, veh) {
  const today = new Date().toISOString().slice(0, 10);
  // Export maps: Company Name ← payload.company_rep, Company Rep ← payload.customer_name
  // Warehouse exports use Company Name = مستودع الهاتفية, Branch To = في المستودع
  // Showroom exports use Company Name = سيارات عرض الصالة
  const companyName = pickCol(row, ['company name', 'company', 'اسم الشركة', 'الشركة']);
  const companyRep = pickCol(row, ['company rep', 'rep', 'مندوب الشركة', 'المندوب']);
  const branchTo = pickCol(row, ['branch to', 'branch', 'الفرع', 'إلى فرع']);
  const plate = pickCol(row, ['plate', 'plate no', 'لوحة']) || (veh && veh.plate) || '';
  const product = pickCol(row, ['product', 'model']) || (veh && (veh.product || veh.model)) || '';
  const vin = normVin(pickCol(row, VIN_ALIASES) || (veh && veh.vin));
  const printedAt = pickCol(row, ['printed at', 'printed', 'تاريخ الطباعة']);
  const docDate = printedAt && /^\d{4}-\d{2}-\d{2}/.test(printedAt)
    ? printedAt.slice(0, 10)
    : today;
  const isSh = isShowroomExportRow(row);
  const isWh = !isSh && isWarehouseExportRow(row);

  const cars = Array.from({ length: 10 }, () => emptyCarSlot());
  cars[0] = {
    model: product,
    chassis: vin,
    plate: plate === '#' ? '' : plate,
    remarks: pickCol(row, ['remarks', 'notes', 'ملاحظات']) || ''
  };

  const payload = {
    doc_date: docDate,
    invoice_number: '',
    dep_hour: '',
    dep_minute: '',
    customer_name: companyRep || '',
    company_rep: isSh ? (companyRep || companyName) : (isWh ? 'مستودع الهاتفية' : companyName),
    transfer_date: docDate,
    corresponding_date: docDate,
    day_name: arabicWeekdayName(docDate),
    trailer_number: '',
    car_count: vin ? '1' : '',
    branch_to: isWh ? 'المستودع' : branchTo,
    attachments: '',
    cars
  };

  if (isSh) {
    payload.deliveryMode = 'showroom';
    payload.showroom_display = true;
    payload.showroom_group = true;
    payload.showroom_label = SHOWROOM_SPECIAL_NAME;
    payload.typed_company = companyRep || companyName || '';
  } else if (isWh) {
    payload.deliveryMode = 'warehouse';
    payload.warehouse_group = true;
    payload.warehouse = {
      owner_name: companyRep || companyName || '',
      user_phone: pickCol(row, ['phone', 'هاتف']) || ''
    };
  }

  return payload;
}

function parsePrintDraftsFromRows(rows) {
  const drafts = [];
  for (const row of rows || []) {
    const vin = normVin(pickCol(row, VIN_ALIASES));
    if (!vin) continue;
    const product = pickCol(row, ['product', 'model']);
    const assignedTo = pickCol(row, ['assigned to', 'agent', 'المسؤول']) || 'admin';
    const companyName = pickCol(row, ['company name', 'company', 'اسم الشركة']);
    const idRaw = pickCol(row, ['draft id', 'id', 'draft']);
    const id = idRaw || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const printedAt = pickCol(row, ['printed at', 'printed']) || new Date().toISOString();
    const payload = buildDraftPayloadFromExportRow(row, { vin, product, plate: pickCol(row, ['plate']) });
    drafts.push({
      id,
      printedAt,
      vin,
      product,
      model: product,
      assignedTo: isShowroomDraftPayload(payload) ? (assignedTo || SHOWROOM_AGENT) : assignedTo,
      customerName: companyName || pickCol(row, ['company rep', 'customer']) || '',
      plate: pickCol(row, ['plate']) || '',
      gt: pickCol(row, ['gt']) || '',
      location: pickCol(row, ['location']) || '',
      showroomDisplay: isShowroomDraftPayload(payload),
      payload
    });
  }
  return drafts;
}

function parseQueueFromRows(rows) {
  const queue = [];
  const seen = new Set();
  for (const row of rows || []) {
    const vin = normVin(pickCol(row, VIN_ALIASES));
    if (!vin || seen.has(vin)) continue;
    seen.add(vin);
    const status = pickCol(row, ['status']) || 'available';
    const agentStatus = pickCol(row, ['agent status']) || '';
    const assignedTo = pickCol(row, ['assigned to']) || '';
    const deliveryModeRaw = String(pickCol(row, ['delivery mode', 'delivery type']) || '').trim().toLowerCase();
    const isWh = deliveryModeRaw === 'warehouse'
      || isWarehouseExportRow(row);
    queue.push({
      vin,
      status: status === 'claimed' || assignedTo ? 'claimed' : 'available',
      agentStatus,
      deliveryMode: isWh ? 'warehouse' : (deliveryModeRaw === 'memo' ? '' : ''),
      assignedTo,
      addedAt: pickCol(row, ['added at']) || new Date().toISOString(),
      assignedAt: pickCol(row, ['assigned at']) || '',
      product: pickCol(row, ['product', 'model']) || '',
      model: pickCol(row, ['model', 'product']) || '',
      gt: pickCol(row, ['gt']) || '',
      location: pickCol(row, ['location']) || '',
      plate: pickCol(row, ['plate']) || '',
      customerName: pickCol(row, ['customer', 'customer name']) || '',
      imageUrl: ''
    });
  }
  return queue;
}

function parseSalesFromWorkbook(wb, filename) {
  // Prefer admin export "Vehicle Inventory", then Sales Raw, then any sheet with VINs
  const inventorySheet = findSheetName(wb, ['vehicle inventory', 'inventory', 'vehicles']);
  const sheetOrder = [
    ...(inventorySheet ? [inventorySheet] : []),
    ...wb.SheetNames.filter((n) => /sales\s*raw/i.test(n)),
    ...wb.SheetNames.filter((n) => /raw/i.test(n) && !/sales\s*raw/i.test(n)),
    ...wb.SheetNames.filter((n) => {
      const norm = normalizeHeader(n);
      return !/raw/i.test(n)
        && norm !== normalizeHeader(inventorySheet)
        && !norm.includes('print draft')
        && !norm.includes('coordinator queue')
        && norm !== 'products'
        && norm !== 'summary';
    })
  ];
  const sheets = [...new Set(sheetOrder.length ? sheetOrder : wb.SheetNames)];
  if (!sheets.length) throw new Error('لا توجد أوراق في الملف');

  let preferred = sheets[0];
  let rows = [];
  let vehicles = [];
  let headers = [];

  for (const name of sheets) {
    const sheetRowsData = sheetRows(wb, name);
    if (!sheetRowsData.length) continue;
    const found = parseVehiclesFromRows(sheetRowsData);
    if (found.length) {
      preferred = name;
      rows = sheetRowsData;
      vehicles = found;
      backfillProformaColumnP(wb, name, vehicles);
      headers = Object.keys(sheetRowsData[0] || {});
      break;
    }
    if (!headers.length && sheetRowsData[0]) headers = Object.keys(sheetRowsData[0]);
  }

  if (!vehicles.length) {
    if (isDeliveryExportWorkbook(wb, filename)) {
      for (const name of wb.SheetNames || []) {
        const sheetRowsData = sheetRows(wb, name);
        if (!sheetRowsData.length) continue;
        const found = parseVehiclesFromRows(sheetRowsData);
        if (found.length) {
          preferred = name;
          rows = sheetRowsData;
          vehicles = found;
          backfillProformaColumnP(wb, name, vehicles);
          headers = Object.keys(sheetRowsData[0] || {});
          break;
        }
      }
    }
  }

  if (!vehicles.length) {
    const headerHint = headers.length ? ` · الأعمدة: ${headers.slice(0, 12).join(' | ')}` : '';
    throw new Error(`لم يتم العثور على أرقام شاسيه في الملف${headerHint}`);
  }

  const result = {
    vehicles,
    sheetName: preferred,
    filename: filename || '',
    rawRows: rows.slice(0, 5000),
    drafts: [],
    queue: [],
    isExport: isDeliveryExportWorkbook(wb, filename)
  };

  if (result.isExport) {
    const draftsSheet = findSheetName(wb, [
      'print drafts', 'print draft', 'drafts', 'مسودات الطباعة', 'مسودات', 'print'
    ]);
    const queueSheet = findSheetName(wb, [
      'coordinator queue', 'queue', 'قائمة الشاسيه', 'القائمة', 'coordinator'
    ]);
    if (draftsSheet) result.drafts = parsePrintDraftsFromRows(sheetRows(wb, draftsSheet));
    if (queueSheet) result.queue = parseQueueFromRows(sheetRows(wb, queueSheet));
  } else {
    // Pasted Print Drafts grid (single sheet with Draft ID / Company Name columns)
    const headerKeys = Object.keys(rows[0] || {}).map((h) => normalizeHeader(h));
    const looksLikeDrafts = headerKeys.some((h) => h.includes('draft id') || h === 'company name' || h.includes('branch to'));
    if (looksLikeDrafts && headerKeys.some((h) => h.includes('chassis') || h.includes('vin'))) {
      result.drafts = parsePrintDraftsFromRows(rows);
      result.isExport = true;
    }
  }

  return result;
}

function parseSalesWorkbook(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return parseSalesFromWorkbook(wb, filename);
}

/** Paste from Excel clipboard (TSV) or CSV text → same vehicle structure as file upload. */
function parseSalesText(text, filename) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) throw new Error('الصق بيانات Excel أولاً');

  const firstLine = raw.split(/\r?\n/)[0] || '';
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const FS = tabCount >= 1 && tabCount >= commaCount ? '\t' : ',';
  const wb = XLSX.read(raw, { type: 'string', FS, cellDates: true });
  return parseSalesFromWorkbook(wb, filename || 'pasted-excel.tsv');
}

function applyParsedInventory(parsed, { replaceDrafts = false, replaceQueue = false } = {}) {
  store.vehicles = parsed.vehicles;
  store.raw = {
    filename: parsed.filename,
    sheetName: parsed.sheetName,
    rowCount: parsed.rawRows.length,
    sample: parsed.rawRows.slice(0, 20)
  };
  store.meta = {
    filename: parsed.filename,
    sheetName: parsed.sheetName,
    uploadedAt: new Date().toISOString(),
    nextDeliveryNoteSeq: Number(store.meta?.nextDeliveryNoteSeq) || 1
  };

  if (replaceDrafts || (Array.isArray(parsed.drafts) && parsed.drafts.length)) {
    store.drafts = Array.isArray(parsed.drafts) ? parsed.drafts.slice(0, MAX_DRAFTS) : [];
    migrateDeliveryNoteFields();
  }
  if (replaceQueue || (Array.isArray(parsed.queue) && parsed.queue.length)) {
    store.queue = Array.isArray(parsed.queue) ? dedupeQueue(parsed.queue) : [];
  }

  return refreshQueueFromVehicles();
}

function arabicWeekdayName(isoDate) {
  const names = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const dt = new Date(`${String(isoDate).trim()}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  return names[dt.getDay()] || '';
}

function emptyCarSlot() {
  return { model: '', chassis: '', plate: '', remarks: '' };
}

/** Build print drafts from inventory vehicles (group by customer, max 10 cars / memo). */
function createPdfDraftsFromVehicles(vehicles, { assignedTo = 'admin' } = {}) {
  const list = (vehicles || []).filter((v) => normVin(v.vin));
  if (!list.length) throw new Error('لا توجد مركبات لتوليد PDF');

  const groups = new Map();
  for (const v of list) {
    const company = String(v.customerName || '').trim();
    const key = company || `__solo_${normVin(v.vin)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }

  const today = new Date().toISOString().slice(0, 10);
  const dayName = arabicWeekdayName(today);
  const created = [];

  for (const [, cars] of groups) {
    for (let offset = 0; offset < cars.length; offset += 10) {
      const chunk = cars.slice(offset, offset + 10);
      const company = String(chunk[0].customerName || '').trim();
      const carRows = chunk.map((c) => ({
        model: c.product || c.model || '',
        chassis: normVin(c.vin),
        plate: c.plate || '',
        remarks: ''
      }));
      while (carRows.length < 10) carRows.push(emptyCarSlot());

      const payload = {
        doc_date: today,
        invoice_number: '',
        dep_hour: '',
        dep_minute: '',
        customer_name: '',
        company_rep: company,
        transfer_date: today,
        corresponding_date: today,
        day_name: dayName,
        trailer_number: '',
        car_count: String(chunk.length),
        branch_to: '',
        attachments: '',
        cars: carRows
      };

      const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const draft = {
        id,
        printedAt: new Date().toISOString(),
        vin: normVin(chunk[0].vin),
        vins: chunk.map((c) => normVin(c.vin)).filter(Boolean),
        product: chunk[0].product || '',
        model: chunk[0].model || chunk[0].product || '',
        assignedTo,
        customerName: company,
        plate: chunk[0].plate || '',
        gt: chunk[0].gt || '',
        location: chunk[0].location || '',
        payload
      };
      attachDeliveryNoteMeta(draft, {
        entryAgent: assignedTo,
        vehicleStatus: 'delivery'
      });
      archiveDeliveryNoteFile(draft);
      store.drafts.unshift(draft);
      created.push({
        id: draft.id,
        vin: draft.vin,
        deliveryNoteNumber: draft.deliveryNoteNumber,
        carCount: chunk.length,
        company: company || '—'
      });
    }
  }

  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;
  return created;
}

function splitIsoDate(iso) {
  const s = String(iso || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { d: '', m: '', y: '' };
  return { d: m[3], m: m[2], y: m[1] };
}

function toHijriParts(isoDate) {
  try {
    if (!isoDate) return { d: '', m: '', y: '' };
    const dt = new Date(`${String(isoDate).trim()}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return { d: '', m: '', y: '' };
    const fmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      numberingSystem: 'latn'
    });
    const parts = fmt.formatToParts(dt) || [];
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return {
      d: String(get('day')).padStart(2, '0'),
      m: String(get('month')).padStart(2, '0'),
      y: String(get('year'))
    };
  } catch {
    return { d: '', m: '', y: '' };
  }
}

function flattenDeliveryNote(payload) {
  const p = payload || {};
  const doc = splitIsoDate(p.doc_date);
  const transfer = splitIsoDate(p.transfer_date || p.doc_date);
  const corresponding = toHijriParts(p.corresponding_date || p.transfer_date || p.doc_date);
  const cars = Array.isArray(p.cars) ? p.cars : [];
  const data = {
    date_d: doc.d,
    date_m: doc.m,
    date_y: doc.y,
    memo_number: p.invoice_number || '',
    dep_hour: p.dep_hour || '',
    dep_minute: p.dep_minute || '',
    customer_name: p.customer_name || '',
    company_rep: p.company_rep || '',
    transfer_d: transfer.d,
    transfer_m: transfer.m,
    transfer_y: transfer.y,
    corresponding_d: corresponding.d,
    corresponding_m: corresponding.m,
    corresponding_y: corresponding.y,
    day_name: p.day_name || '',
    trailer_number: p.trailer_number || '',
    car_count: p.car_count || '',
    branch_to: p.branch_to || '',
    attachments: p.attachments || '',
    transport_rep_sign: '',
    warehouse_supervisor_sign: '',
    recipient_name: '',
    recipient_signature: '',
    recipient_date: '',
    rec_hour: '',
    rec_minute: ''
  };
  for (let i = 1; i <= 10; i += 1) {
    const row = cars[i - 1] || {};
    data[`car${i}_model`] = row.model || '';
    data[`car${i}_chassis`] = row.chassis || '';
    data[`car${i}_plate`] = row.plate || '';
    data[`car${i}_remarks`] = row.remarks || '';
  }
  return data;
}

function generateDocxWithTemplate(templateFile, payload) {
  if (!fs.existsSync(templateFile)) {
    throw new Error(`قالب Word غير موجود (${path.basename(templateFile)})`);
  }
  const content = fs.readFileSync(templateFile);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => ''
  });
  doc.render(flattenDeliveryNote(payload));
  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });
}

function generateDocx(payload) {
  return generateDocxWithTemplate(TEMPLATE_FILE, payload);
}

function generateDeliveryCheckDocx(payload) {
  return generateDocxWithTemplate(DELIVERY_CHECK_TEMPLATE_FILE, payload);
}

function getDeliveryCheckPdfBuffer() {
  if (!fs.existsSync(DELIVERY_CHECK_PDF_FILE)) {
    throw new Error('ملف delivery_check_note.pdf غير موجود');
  }
  return fs.readFileSync(DELIVERY_CHECK_PDF_FILE);
}

// ——— HTTP app ———
const app = express();

/** Binary upload — avoids base64 JSON bloat (Railway/proxy size limits). Must be before express.json. */
app.post('/api/delivery-inventory/restore-export-bin', express.raw({ limit: '80mb', type: '*/*' }), (req, res) => {
  try {
    const filename = decodeURIComponent(String(req.headers['x-filename'] || 'delivery_export.xlsx'));
    if (!req.body || !Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'ملف التصدير مطلوب' });
    }
    return finishRestoreExport(req.body, filename, res);
  } catch (err) {
    console.error('[restore-export-bin]', err);
    return res.status(500).json({ error: err.message || 'فشل استيراد الأرشيف' });
  }
});

app.use(express.json({ limit: '80mb' }));

app.post('/api/delivery-coordinator/auth', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  return res.json({ ok: true, username: auth.username, role: auth.role });
});

app.get('/api/warehouse/stock', (_req, res) => {
  ensureWarehouseStock();
  const inStock = store.warehouseStock
    .filter((e) => e.status === 'in')
    .map(enrichWarehouseEntry)
    .sort((a, b) => String(a.slot).localeCompare(String(b.slot), 'en'));
  res.json({
    stock: inStock,
    history: store.warehouseStock.slice(-200).map(enrichWarehouseEntry),
    zones: warehouseOccupancy(),
    zoneNames: WAREHOUSE_ZONES
  });
});

app.post('/api/warehouse/stock-in', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'warehouse') {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لإدخال المستودع' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin || vin.length < 8) {
    return res.status(400).json({ error: 'رقم الشاسيه غير صالح — راجع القراءة وصحّحها' });
  }

  let zone = String(req.body?.zone || '').trim().toUpperCase();
  if (!WAREHOUSE_ZONES.includes(zone)) {
    return res.status(400).json({ error: 'اختر منطقة صالحة (A–F)' });
  }

  let slot = String(req.body?.slot || '').trim().toUpperCase();
  if (slot) {
    const m = slot.match(/^([A-F])-?(\d{1,3})$/i);
    if (!m) return res.status(400).json({ error: 'مكان الوقوف غير صالح — مثال: A-1' });
    zone = m[1].toUpperCase();
    slot = `${zone}-${Number(m[2])}`;
    const zoneMax = WAREHOUSE_ZONE_CONFIG[zone]?.total || 40;
    if (Number(m[2]) < 1 || Number(m[2]) > zoneMax) {
      return res.status(400).json({ error: `رقم الموقف يجب أن يكون بين 1 و ${zoneMax} للمنطقة ${zone}` });
    }
  } else {
    slot = nextFreeSlot(zone);
    if (!slot) return res.status(409).json({ error: `المنطقة ${zone} ممتلئة` });
  }

  ensureWarehouseStock();
  const existing = findWarehouseInStock(vin);
  if (existing) {
    return res.status(409).json({
      error: `هذا الشاسيه موجود مسبقاً في ${existing.slot}`,
      entry: enrichWarehouseEntry(existing)
    });
  }

  const slotTaken = store.warehouseStock.find(
    (e) => e.status === 'in' && String(e.slot).toUpperCase() === slot
  );
  if (slotTaken) {
    return res.status(409).json({
      error: `الموقف ${slot} مشغول بالشاسيه ${slotTaken.vin}`
    });
  }

  const veh = vehicleIndex().get(vin);
  const queueItem = findQueueItem(vin);
  const now = new Date().toISOString();
  const entry = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vin,
    zone,
    slot,
    status: 'in',
    stockedInAt: now,
    stockedOutAt: '',
    stockedInBy: auth.username,
    stockedOutBy: '',
    product: veh?.product || veh?.model || queueItem?.product || String(req.body?.product || '').trim(),
    plate: veh?.plate || queueItem?.plate || String(req.body?.plate || '').trim()
  };
  store.warehouseStock.push(entry);
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichWarehouseEntry(entry),
    inCoordinatorQueue: Boolean(queueItem),
    zones: warehouseOccupancy()
  });
});

app.post('/api/warehouse/stock-out', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'warehouse') {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لإدخال المستودع' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin) return res.status(400).json({ error: 'رقم الشاسيه مطلوب' });

  const entry = findWarehouseInStock(vin);
  if (!entry) {
    return res.status(404).json({ error: 'هذا الشاسيه غير موجود في ساحة المستودع' });
  }

  entry.status = 'out';
  entry.stockedOutAt = new Date().toISOString();
  entry.stockedOutBy = auth.username;
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichWarehouseEntry(entry),
    zones: warehouseOccupancy()
  });
});

app.get('/api/showroom-parking/stock', (_req, res) => {
  ensureShowroomParking();
  res.json({
    stock: store.showroomParking
      .filter((e) => e.status === 'in')
      .map(enrichShowroomParkingEntry)
      .sort((a, b) => String(a.slot).localeCompare(String(b.slot), 'en')),
    history: store.showroomParking.slice(-100).map(enrichShowroomParkingEntry),
    occupancy: showroomParkingOccupancy(),
    slots: [...SHOWROOM_PARKING_SLOTS],
    label: SHOWROOM_PARKING_LABEL
  });
});

app.post('/api/showroom-parking/stock-in', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'showroom_admin') {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لموقف سيارات العرض' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin || vin.length < 8) {
    return res.status(400).json({ error: 'رقم الشاسيه غير صالح' });
  }

  let slot = normalizeShowroomParkingSlot(req.body?.slot);
  if (!slot) {
    const occ = showroomParkingOccupancy();
    const free = occ.slots.find((s) => s.free);
    if (!free) return res.status(409).json({ error: 'موقف العرض ممتلئ (7 أماكن)' });
    slot = free.slot;
  }

  ensureShowroomParking();
  const existing = findShowroomParkingInStock(vin);
  if (existing) {
    return res.status(409).json({
      error: `هذا الشاسيه موجود مسبقاً في ${existing.slot}`,
      code: 'already_parked',
      entry: enrichShowroomParkingEntry(existing),
      conflictSlot: existing.slot
    });
  }

  const slotTaken = store.showroomParking.find(
    (e) => e.status === 'in' && String(e.slot).toUpperCase() === slot
  );
  if (slotTaken) {
    return res.status(409).json({
      error: `الموقف ${slot} مشغول بالشاسيه ${slotTaken.vin}`,
      code: 'slot_taken',
      takenBy: slotTaken.vin
    });
  }

  const queueItem = findQueueItem(vin);
  const forcePark = Boolean(req.body?.forcePark || req.body?.forceReassign);
  if (queueItem && !isUnassignedDeliveryCompany(queueItem) && !forcePark) {
    const company = String(queueItem.deliveryCompany || queueItem.company || '').trim();
    return res.status(409).json({
      error: `هذا الشاسيه معيّن لشركة ${company || 'أخرى'} — أكّد لإدخاله في موقف العرض`,
      code: 'queue_company_conflict',
      conflict: {
        vin,
        company: company || 'بدون شركة',
        status: queueItem.status || '',
        assignedTo: queueItem.assignedTo || ''
      }
    });
  }

  const veh = vehicleIndex().get(vin);
  const now = new Date().toISOString();
  const entry = {
    id: `sr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vin,
    slot,
    zone: 'SR',
    status: 'in',
    stockedInAt: now,
    stockedOutAt: '',
    stockedInBy: auth.username,
    stockedOutBy: '',
    product: veh?.product || veh?.model || queueItem?.product || String(req.body?.product || '').trim(),
    model: veh?.model || String(req.body?.model || '').trim(),
    plate: veh?.plate || queueItem?.plate || String(req.body?.plate || '').trim(),
    section: 'showroom',
    label: SHOWROOM_PARKING_LABEL
  };
  store.showroomParking.push(entry);
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichShowroomParkingEntry(entry),
    occupancy: showroomParkingOccupancy()
  });
});

app.post('/api/showroom-parking/stock-out', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  if (auth.role !== 'showroom_admin' && auth.username !== SHOWROOM_AGENT) {
    return res.status(403).json({ error: 'هذا الحساب غير مخصص لموقف سيارات العرض' });
  }

  const vin = normVin(req.body?.vin);
  if (!vin) return res.status(400).json({ error: 'رقم الشاسيه مطلوب' });

  const entry = findShowroomParkingInStock(vin);
  if (!entry) {
    return res.status(404).json({ error: 'هذا الشاسيه غير موجود في موقف العرض' });
  }

  entry.status = 'out';
  entry.stockedOutAt = new Date().toISOString();
  entry.stockedOutBy = auth.username;
  persistAndBroadcast();
  res.json({
    ok: true,
    entry: enrichShowroomParkingEntry(entry),
    occupancy: showroomParkingOccupancy()
  });
});

app.get('/api/delivery-options', (_req, res) => {
  ensureOptions();
  res.json({
    companies: store.options.companies,
    cities: store.options.cities
  });
});

app.post('/api/delivery-options/:kind', (req, res) => {
  const kind = String(req.params.kind || '');
  if (kind !== 'companies' && kind !== 'cities') {
    return res.status(400).json({ error: 'نوع القائمة غير معروف' });
  }
  ensureOptions();
  const name = normalizeOptionName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const list = store.options[kind];
  const exists = list.some((x) => x.toLowerCase() === name.toLowerCase());
  if (exists) return res.status(409).json({ error: 'هذا الاسم موجود مسبقاً', [kind]: list });
  list.push(name);
  store.options[kind] = uniqueSorted(list);
  persistAndBroadcast();
  res.json({ ok: true, name, [kind]: store.options[kind] });
});

app.delete('/api/delivery-options/:kind', (req, res) => {
  const kind = String(req.params.kind || '');
  if (kind !== 'companies' && kind !== 'cities') {
    return res.status(400).json({ error: 'نوع القائمة غير معروف' });
  }
  ensureOptions();
  const name = normalizeOptionName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
  const before = store.options[kind].length;
  store.options[kind] = store.options[kind].filter((x) => x.toLowerCase() !== name.toLowerCase());
  if (store.options[kind].length === before) {
    return res.status(404).json({ error: 'الاسم غير موجود', [kind]: store.options[kind] });
  }
  persistAndBroadcast();
  res.json({ ok: true, name, [kind]: store.options[kind] });
});

app.get('/api/delivery-inventory', (_req, res) => {
  res.json({
    vehicles: store.vehicles,
    dashboard: buildDashboard()
  });
});

app.delete('/api/delivery-inventory', (_req, res) => {
  const options = store.options || defaultOptions();
  store = emptyStore();
  store.options = options;
  ensureOptions();
  persistAndBroadcast();
  res.json({ dashboard: buildDashboard() });
});

app.post('/api/delivery-inventory/upload', (req, res) => {
  try {
    const { fileData, filename } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'الملف مطلوب' });
    const buffer = parseDataUrl(fileData);
    const parsed = parseSalesWorkbook(buffer, filename);
    if (!parsed.vehicles.length) {
      return res.status(400).json({ error: 'لم يتم العثور على أرقام شاسيه في الملف' });
    }
    const refresh = applyParsedInventory(parsed);
    persistAndBroadcast();
    res.json({
      imported: parsed.vehicles.length,
      vehicles: parsed.vehicles.slice(0, 200),
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      isExport: Boolean(parsed.isExport),
      sheetName: parsed.sheetName,
      queueRefreshed: refresh.total,
      matchedUpdated: refresh.matched,
      notInNewFile: refresh.missing
    });
  } catch (err) {
    console.error('[upload]', err);
    res.status(500).json({ error: err.message || 'فشل رفع الملف' });
  }
});

/**
 * Admin restore from delivery_export_*.xlsx
 * (Vehicle Inventory + Print Drafts + Coordinator Queue).
 */
app.post('/api/delivery-inventory/restore-export', (req, res) => {
  try {
    const { fileData, filename } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'ملف التصدير مطلوب' });
    const buffer = parseDataUrl(fileData);
    return finishRestoreExport(buffer, filename || 'delivery_export.xlsx', res);
  } catch (err) {
    console.error('[restore-export]', err);
    res.status(500).json({ error: err.message || 'فشل استيراد الأرشيف' });
  }
});

/**
 * Merge Proforma / Invoice (+ delivery note) dates from Sales Raw onto existing
 * inventory by VIN — keeps drafts/queue intact.
 */
app.post('/api/delivery-inventory/merge-dates', (req, res) => {
  try {
    const { fileData, filename } = req.body || {};
    if (!fileData) return res.status(400).json({ error: 'ملف Sales Raw مطلوب' });
    const buffer = parseDataUrl(fileData);
    const parsed = parseSalesWorkbook(buffer, filename || 'Sales Raw Data.xlsx');
    if (parsed.isExport) {
      return res.status(400).json({
        error: 'ارفع ملف Sales Raw (ليس delivery_export) لتحديث تواريخ البروفورما/الفاتورة'
      });
    }
    if (!parsed.vehicles.length) {
      return res.status(400).json({ error: 'لم يتم العثور على مركبات في الملف' });
    }

    const incoming = new Map(parsed.vehicles.map((v) => [normVin(v.vin), v]));
    let updated = 0;
    let added = 0;
    const seen = new Set();

    store.vehicles = store.vehicles.map((v) => {
      const vin = normVin(v.vin);
      seen.add(vin);
      const src = incoming.get(vin);
      if (!src) return v;
      updated += 1;
      return {
        ...v,
        proformaDate: src.proformaDate || v.proformaDate || '',
        invoiceDate: src.invoiceDate || v.invoiceDate || '',
        deliveryNoteDate: src.deliveryNoteDate || v.deliveryNoteDate || '',
        customerName: v.customerName || src.customerName || '',
        phone: src.phone || v.phone || '',
        product: v.product || src.product || '',
        model: v.model || src.model || '',
        gt: v.gt || src.gt || '',
        location: v.location || src.location || '',
        plate: v.plate || src.plate || ''
      };
    });

    for (const [vin, src] of incoming) {
      if (seen.has(vin)) continue;
      store.vehicles.push(src);
      added += 1;
    }

    store.meta = {
      ...store.meta,
      datesMergedFrom: parsed.filename || filename || 'Sales Raw',
      datesMergedAt: new Date().toISOString()
    };
    const refresh = refreshQueueFromVehicles();
    persistAndBroadcast();
    res.json({
      ok: true,
      updated,
      added,
      withProforma: store.vehicles.filter((v) => v.proformaDate).length,
      withInvoice: store.vehicles.filter((v) => v.invoiceDate).length,
      totalVehicles: store.vehicles.length,
      queueRefreshed: refresh.total
    });
  } catch (err) {
    console.error('[merge-dates]', err);
    res.status(500).json({ error: err.message || 'فشل دمج التواريخ' });
  }
});

/** Paste Excel cells (TSV/CSV) → same inventory parse as file upload. */
app.post('/api/delivery-inventory/paste', (req, res) => {
  try {
    const text = req.body?.text;
    const filename = req.body?.filename || 'pasted-excel.tsv';
    const parsed = parseSalesText(text, filename);
    if (!parsed.vehicles.length && !(parsed.drafts || []).length) {
      return res.status(400).json({ error: 'لم يتم العثور على أرقام شاسيه في النص الملصق' });
    }
    if (!parsed.vehicles.length && (parsed.drafts || []).length) {
      // Drafts-only paste: keep existing vehicles, replace drafts
      store.drafts = parsed.drafts.slice(0, MAX_DRAFTS);
      persistAndBroadcast();
      return res.json({
        imported: 0,
        vehicles: [],
        draftsImported: parsed.drafts.length,
        queueImported: 0,
        isExport: true,
        sheetName: parsed.sheetName
      });
    }
    const refresh = applyParsedInventory(parsed);
    persistAndBroadcast();
    res.json({
      imported: parsed.vehicles.length,
      vehicles: parsed.vehicles,
      draftsImported: (parsed.drafts || []).length,
      queueImported: (parsed.queue || []).length,
      isExport: Boolean(parsed.isExport),
      sheetName: parsed.sheetName,
      queueRefreshed: refresh.total,
      matchedUpdated: refresh.matched,
      notInNewFile: refresh.missing
    });
  } catch (err) {
    console.error('[paste]', err);
    res.status(500).json({ error: err.message || 'فشل قراءة البيانات الملصقة' });
  }
});

/**
 * Create print drafts (مذكرة ترحيل) from inventory / selected VINs.
 * Groups by customer name, max 10 cars per PDF draft.
 */
app.post('/api/delivery-inventory/create-pdf-drafts', (req, res) => {
  try {
    const vins = Array.isArray(req.body?.vins)
      ? req.body.vins.map(normVin).filter(Boolean)
      : null;
    let vehicles = store.vehicles.slice();
    if (vins && vins.length) {
      const want = new Set(vins);
      vehicles = vehicles.filter((v) => want.has(normVin(v.vin)));
    }
    if (!vehicles.length) {
      return res.status(400).json({
        error: vins?.length
          ? 'لم يتم العثور على الشاسيه المحدد في المخزون'
          : 'لا توجد بيانات مركبات — الصق أو ارفع Excel أولاً'
      });
    }
    const created = createPdfDraftsFromVehicles(vehicles, { assignedTo: 'admin' });
    persistAndBroadcast();
    res.json({
      created: created.length,
      drafts: created,
      draftsTotal: store.drafts.length
    });
  } catch (err) {
    console.error('[create-pdf-drafts]', err);
    res.status(500).json({ error: err.message || 'فشل توليد مسودات PDF' });
  }
});

app.get('/api/delivery-inventory/vehicles', (req, res) => {
  const search = String(req.query.search || '').trim().toUpperCase();
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  const exclude = new Set(
    String(req.query.exclude || '')
      .split(',')
      .map(normVin)
      .filter(Boolean)
  );
  let list = store.vehicles.filter((v) => {
    const vin = normVin(v.vin);
    if (!vin || exclude.has(vin)) return false;
    if (!search) return true;
    const hay = `${vin} ${v.product || ''} ${v.plate || ''} ${v.gt || ''} ${v.location || ''} ${v.phone || ''} ${v.customerName || ''}`.toUpperCase();
    return hay.includes(search);
  });
  list = list.slice(0, limit);
  res.json({ vehicles: list });
});

app.get('/api/delivery-coordinator/queue', (req, res) => {
  const admin = String(req.query.admin || '') === '1';
  const username = String(req.query.username || '').trim();

  // Always serve a unique VIN list enriched from the latest raw inventory
  const deduped = dedupeQueue(store.queue);
  if (deduped.length !== store.queue.length) {
    store.queue = deduped;
    saveStore();
  }

  // Backfill warehouse delivery label from warehouse drafts
  const warehouseVins = new Set();
  for (const d of store.drafts || []) {
    if (!isWarehouseDraftPayload(d.payload || {})) continue;
    const list = [
      ...(Array.isArray(d.vins) ? d.vins : []),
      d.vin,
      ...((d.payload && d.payload.vins) || [])
    ];
    list.forEach((v) => {
      const n = normVin(v);
      if (n) warehouseVins.add(n);
    });
  }
  for (const item of store.queue) {
    if (item.agentStatus === 'delivered' && !item.deliveryMode && warehouseVins.has(normVin(item.vin))) {
      item.deliveryMode = 'warehouse';
    }
  }

  let queue = store.queue.map(enrichQueueItem);

  // Agents also see display-status cars (from ياسين) to convert into a delivery note
  if (!admin && username) {
    queue = queue.filter(
      (q) => q.status === 'available'
        || q.assignedTo === username
        || q.agentStatus === 'display'
        || normalizeVehicleStatus(q.vehicleStatus) === 'display'
    );
  }

  // Coordinator page: hide تم الترحيل from prior months (from the 1st of each new month).
  // Admin dashboard keeps full history (do not pass coordinator=1).
  const forCoordinator = String(req.query.coordinator || '') === '1';
  if (forCoordinator) {
    queue = queue.filter((q) => !isPriorMonthDelivered(q));
  }

  if (admin) {
    ensureWarehouseStock();
    ensureShowroomParking();
    return res.json({
      queue,
      stats: computeStats(),
      drafts: store.drafts,
      deliveryNoteStats: computeDeliveryNoteStats(store.drafts || []),
      manualVehicles: store.manualVehicles || [],
      warehouseStock: store.warehouseStock.filter((e) => e.status === 'in').map(enrichWarehouseEntry),
      warehouseZones: warehouseOccupancy(),
      showroomParking: store.showroomParking.filter((e) => e.status === 'in').map(enrichShowroomParkingEntry),
      showroomParkingOccupancy: showroomParkingOccupancy(),
      rawUploaded: Boolean(store.vehicles.length || store.meta.uploadedAt)
    });
  }

  if (forCoordinator) {
    ensureWarehouseStock();
    ensureShowroomParking();
    return res.json({
      queue,
      warehouseStock: store.warehouseStock.filter((e) => e.status === 'in').map(enrichWarehouseEntry),
      warehouseZones: warehouseOccupancy(),
      showroomParking: store.showroomParking.filter((e) => e.status === 'in').map(enrichShowroomParkingEntry),
      showroomParkingOccupancy: showroomParkingOccupancy()
    });
  }

  res.json({ queue });
});

app.post('/api/delivery-coordinator/submit-vins', (req, res) => {
  if (!store.vehicles.length) {
    return res.status(400).json({ error: 'ارفع البيانات الخام (Excel) أولاً قبل إضافة الشاسيه' });
  }

  const vins = Array.isArray(req.body?.vins) ? req.body.vins : [];
  const plannedDeliveryMode = normalizePlannedDeliveryMode(
    req.body?.plannedDeliveryMode || req.body?.deliveryMode || req.body?.deliveryType
  );
  if (!plannedDeliveryMode) {
    return res.status(400).json({ error: 'اختر نوع التسليم: ترحيل أو مستودع' });
  }

  ensureOptions();
  let deliveryCompany = String(req.body?.company || req.body?.deliveryCompany || req.body?.company_rep || '').trim();
  if (plannedDeliveryMode === 'warehouse') {
    deliveryCompany = deliveryCompany || 'مستودع الهاتفية';
  } else if (!deliveryCompany) {
    return res.status(400).json({ error: 'اختر شركة التوصيل للشاسيه' });
  }

  // Keep company in options list if new
  if (deliveryCompany && plannedDeliveryMode === 'memo') {
    const exists = (store.options.companies || []).some(
      (x) => String(x).toLowerCase() === deliveryCompany.toLowerCase()
    );
    if (!exists) {
      store.options.companies = uniqueSorted([...(store.options.companies || []), deliveryCompany]);
    }
  }

  store.queue = dedupeQueue(store.queue);
  const byVin = vehicleIndex();
  let added = 0;
  let reassigned = 0;
  let skipped = 0;
  const missingVins = [];
  const alreadyInWarehouse = [];
  const conflicts = [];
  const alreadySameCompany = [];
  const forceReassign = Boolean(req.body?.forceReassign || req.body?.allowReassign);
  const seenBatch = new Set();
  const now = new Date().toISOString();

  for (const raw of vins) {
    const vin = normVin(raw);
    if (!vin) {
      skipped += 1;
      continue;
    }
    if (seenBatch.has(vin)) {
      skipped += 1;
      continue;
    }
    seenBatch.add(vin);

    const existingItem = findQueueItem(vin);
    if (existingItem) {
      const prevCompany = String(existingItem.deliveryCompany || existingItem.company || '').trim();
      const sameCompany = prevCompany
        && deliveryCompany
        && prevCompany.toLowerCase() === deliveryCompany.toLowerCase();

      // No company yet → always open for assign
      if (isUnassignedDeliveryCompany(existingItem) && deliveryCompany) {
        existingItem.deliveryCompany = deliveryCompany;
        existingItem.company = deliveryCompany;
        existingItem.plannedDeliveryMode = plannedDeliveryMode;
        reassigned += 1;
        const wh = findWarehouseInStock(vin);
        if (wh) {
          alreadyInWarehouse.push({ vin, slot: wh.slot, zone: wh.zone });
        }
        continue;
      }

      // Already on this company
      if (sameCompany) {
        alreadySameCompany.push({ vin, company: prevCompany });
        skipped += 1;
        continue;
      }

      // Duplicate in another company — reassign only if coordinator confirmed
      if (forceReassign && deliveryCompany) {
        existingItem.deliveryCompany = deliveryCompany;
        existingItem.company = deliveryCompany;
        existingItem.plannedDeliveryMode = plannedDeliveryMode;
        reassigned += 1;
        const wh = findWarehouseInStock(vin);
        if (wh) {
          alreadyInWarehouse.push({ vin, slot: wh.slot, zone: wh.zone });
        }
        continue;
      }

      conflicts.push({
        vin,
        company: prevCompany || 'بدون شركة',
        status: existingItem.status || '',
        assignedTo: existingItem.assignedTo || ''
      });
      skipped += 1;
      continue;
    }

    const veh = byVin.get(vin);
    if (!veh) {
      missingVins.push(vin);
      skipped += 1;
      continue;
    }

    const wh = findWarehouseInStock(vin);
    if (wh) {
      alreadyInWarehouse.push({ vin, slot: wh.slot, zone: wh.zone });
    }

    const base = {
      vin,
      status: 'available',
      agentStatus: '',
      assignedTo: '',
      addedAt: now,
      assignedAt: '',
      deliveryCompany,
      plannedDeliveryMode,
      company: deliveryCompany
    };
    store.queue.push(enrichFromVehicle(base, veh));
    added += 1;
  }

  persistAndBroadcast();
  res.json({
    added,
    reassigned,
    skipped,
    notInInventory: missingVins.length,
    missingVins,
    alreadyInWarehouse,
    conflicts,
    alreadySameCompany,
    forceReassign,
    deliveryCompany,
    plannedDeliveryMode
  });
});

/** Update company / planned delivery mode for available (or any) queue VINs. */
app.post('/api/delivery-coordinator/assign-meta', (req, res) => {
  const vins = Array.isArray(req.body?.vins) ? req.body.vins : [req.body?.vin];
  const plannedDeliveryMode = normalizePlannedDeliveryMode(
    req.body?.plannedDeliveryMode || req.body?.deliveryMode || req.body?.deliveryType
  );
  if (!plannedDeliveryMode) {
    return res.status(400).json({ error: 'اختر نوع التسليم: ترحيل أو مستودع' });
  }

  ensureOptions();
  let deliveryCompany = String(req.body?.company || req.body?.deliveryCompany || req.body?.company_rep || '').trim();
  if (plannedDeliveryMode === 'warehouse') {
    deliveryCompany = deliveryCompany || 'مستودع الهاتفية';
  } else if (!deliveryCompany) {
    return res.status(400).json({ error: 'اختر شركة التوصيل' });
  }

  if (deliveryCompany && plannedDeliveryMode === 'memo') {
    const exists = (store.options.companies || []).some(
      (x) => String(x).toLowerCase() === deliveryCompany.toLowerCase()
    );
    if (!exists) {
      store.options.companies = uniqueSorted([...(store.options.companies || []), deliveryCompany]);
    }
  }

  const updated = [];
  const missing = [];
  for (const raw of vins) {
    const vin = normVin(raw);
    if (!vin) continue;
    const item = findQueueItem(vin);
    if (!item) {
      missing.push(vin);
      continue;
    }
    item.plannedDeliveryMode = plannedDeliveryMode;
    item.deliveryCompany = deliveryCompany;
    item.company = deliveryCompany;
    updated.push(enrichQueueItem(item));
  }
  if (!updated.length) return res.status(404).json({ error: 'لم يتم تحديث أي شاسيه', missing });
  persistAndBroadcast();
  res.json({ ok: true, updated, missing, deliveryCompany, plannedDeliveryMode });
});

app.post('/api/delivery-coordinator/claim', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const vin = normVin(req.body?.vin);
  const agentStatus = String(req.body?.agentStatus || 'in_stock').trim() || 'in_stock';
  const item = findQueueItem(vin);
  if (!item) return res.status(404).json({ error: 'الشاسيه غير موجود في القائمة' });
  if (item.status !== 'available' && item.assignedTo && item.assignedTo !== auth.username) {
    return res.status(409).json({ error: 'الشاسيه محجوز لموظف آخر' });
  }

  item.status = 'claimed';
  item.agentStatus = agentStatus;
  item.assignedTo = auth.username;
  item.assignedAt = new Date().toISOString();
  persistAndBroadcast();
  res.json({ item: enrichQueueItem(item) });
});

app.post('/api/delivery-coordinator/set-status', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const vin = normVin(req.body?.vin);
  const agentStatus = String(req.body?.agentStatus || '').trim();
  if (!agentStatus) return res.status(400).json({ error: 'الحالة مطلوبة' });

  const item = findQueueItem(vin);
  if (!item) return res.status(404).json({ error: 'الشاسيه غير موجود' });
  if (item.assignedTo && item.assignedTo !== auth.username) {
    return res.status(403).json({ error: 'غير مسموح — الشاسيه مع موظف آخر' });
  }

  item.status = 'claimed';
  item.agentStatus = agentStatus;
  item.assignedTo = auth.username;
  persistAndBroadcast();
  res.json({ item: enrichQueueItem(item) });
});

app.post('/api/delivery-coordinator/release', (req, res) => {
  const vin = normVin(req.body?.vin);
  const item = findQueueItem(vin);
  if (!item) return res.status(404).json({ error: 'الشاسيه غير موجود' });

  item.status = 'available';
  item.agentStatus = '';
  item.assignedTo = '';
  item.assignedAt = '';
  persistAndBroadcast();
  res.json({ ok: true, item: enrichQueueItem(item) });
});

app.post('/api/delivery-coordinator/complete-print', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const draftPayload = req.body?.draft || {};
  const primaryVin = normVin(req.body?.vin);
  const fromBody = Array.isArray(req.body?.vins) ? req.body.vins : [];
  const vins = collectDraftVins(draftPayload, [primaryVin, ...fromBody]);
  if (!vins.length) return res.status(400).json({ error: 'الشاسيه مطلوب' });

  let showroomDisplay = Boolean(
    req.body?.showroomDisplay
    || isShowroomDraftPayload(draftPayload)
  );
  // ياسين default remains showroom unless payload sets delivery status
  if (auth.username === SHOWROOM_AGENT) {
    const vs = normalizeVehicleStatus(draftPayload.vehicleStatus || req.body?.vehicleStatus);
    if (vs === 'delivery') showroomDisplay = false;
    else if (vs === 'display' || !vs) showroomDisplay = true;
  }
  const warehouseDelivery = !showroomDisplay && isWarehouseDraftPayload(draftPayload);
  const vehicleStatus = normalizeVehicleStatus(draftPayload.vehicleStatus || req.body?.vehicleStatus)
    || (showroomDisplay ? 'display' : 'delivery');

  const statusPaper = vehicleStatusPaperLabel(vehicleStatus);
  if (statusPaper) {
    const tag = `الحالة / Status: ${statusPaper}`;
    const prev = String(draftPayload.attachments || '').trim();
    if (!prev.includes(tag)) {
      draftPayload.attachments = [prev, tag].filter(Boolean).join('\n');
    }
    draftPayload.vehicleStatus = vehicleStatus;
    draftPayload.vehicle_status_label = statusPaper;
  }

  const carMetaByVin = new Map();
  (Array.isArray(draftPayload.cars) ? draftPayload.cars : []).forEach((c) => {
    const vin = normVin(c?.chassis || c?.vin);
    if (!vin) return;
    carMetaByVin.set(vin, {
      product: String(c.model || '').trim(),
      model: String(c.model || '').trim(),
      plate: String(c.plate || '').trim()
    });
  });

  const convertingDisplay = vins.some((vin) => {
    const item = findQueueItem(vin);
    return item && (item.agentStatus === 'display' || normalizeVehicleStatus(item.vehicleStatus) === 'display');
  });

  const { deliveredItems, blocked } = markVinsDelivered(vins, {
    assignedTo: auth.username,
    warehouseDelivery,
    showroomDisplay,
    vehicleStatus,
    // Allow agents to convert display cars into a new delivery note
    forceAssign: showroomDisplay || convertingDisplay || auth.username === SHOWROOM_AGENT,
    carMetaByVin
  });
  if (blocked.length) {
    const b = blocked[0];
    return res.status(403).json({
      error: `غير مسموح — الشاسيه ${b.vin} مع موظف آخر (${b.assignedTo})`
    });
  }
  if (!deliveredItems.length) {
    return res.status(400).json({ error: 'لم يتم ترحيل أي شاسيه' });
  }

  const primary = deliveredItems[0];
  const typedCompany = String(draftPayload.company_rep || '').trim();
  const autoBranch = agentAutoBranch(auth.username);
  if (autoBranch && !warehouseDelivery) {
    draftPayload.branch_to = autoBranch;
  }
  const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    printedAt: new Date().toISOString(),
    vin: primary.vin,
    vins,
    product: primary.product || carMetaByVin.get(primary.vin)?.product || '',
    model: primary.model || primary.product || '',
    assignedTo: auth.username,
    customerName: showroomDisplay
      ? (typedCompany || SHOWROOM_SPECIAL_NAME)
      : (typedCompany || draftPayload?.warehouse?.owner_name || primary.customerName || ''),
    plate: primary.plate || '',
    gt: primary.gt || '',
    location: primary.location || '',
    showroomDisplay: Boolean(showroomDisplay),
    vehicleStatus,
    payload: {
      ...draftPayload,
      branch_to: warehouseDelivery
        ? (draftPayload.branch_to || 'المستودع')
        : (autoBranch || draftPayload.branch_to || ''),
      warehouse_group: warehouseDelivery,
      deliveryMode: showroomDisplay ? 'showroom' : (warehouseDelivery ? 'warehouse' : ''),
      showroom_display: Boolean(showroomDisplay),
      showroom_group: Boolean(showroomDisplay),
      showroom_label: showroomDisplay ? SHOWROOM_SPECIAL_NAME : undefined,
      typed_company: showroomDisplay ? typedCompany : undefined,
      vehicleStatus,
      vins
    }
  };
  attachDeliveryNoteMeta(draft, {
    entryAgent: auth.username,
    vehicleStatus,
    branchEntryDate: draftPayload.branchEntryDate || '',
    manualEntry: Boolean(draftPayload.manualEntry)
  });
  archiveDeliveryNoteFile(draft);
  store.drafts.unshift(draft);
  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;

  persistAndBroadcast();
  res.json({
    ok: true,
    draftId: id,
    deliveryNoteNumber: draft.deliveryNoteNumber,
    deliveryNoteDate: draft.deliveryNoteDate,
    archivePath: draft.archivePath || null,
    pdfSaved: Boolean(draft.pdfSaved),
    vins,
    deliveredCount: deliveredItems.length,
    showroomDisplay: Boolean(showroomDisplay),
    vehicleStatus,
    statusLabel: showroomDisplay
      ? 'عرض'
      : (warehouseDelivery ? 'تم التسليم في المستودع' : 'تم الترحيل'),
    item: primary,
    items: deliveredItems
  });
});

app.get('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const draft = store.drafts.find((d) => d.id === id);
  if (!draft) return res.status(404).json({ error: 'المسودة غير موجودة' });
  res.json({ draft });
});

/** Admin edit: update delivery-note draft payload / meta; sync all cars as delivered. */
app.patch('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const idx = store.drafts.findIndex((d) => d.id === id);
  if (idx < 0) return res.status(404).json({ error: 'المسودة غير موجودة' });

  const body = req.body || {};
  const draft = { ...store.drafts[idx] };
  const markDelivered = body.markDelivered !== false;

  if (body.payload && typeof body.payload === 'object') {
    draft.payload = { ...(draft.payload || {}), ...body.payload };
    if (Array.isArray(body.payload.cars)) {
      draft.payload.cars = body.payload.cars;
    }
  }

  const vins = collectDraftVins(draft.payload, [draft.vin, ...(Array.isArray(draft.vins) ? draft.vins : [])]);
  draft.vins = vins;
  if (!draft.payload || typeof draft.payload !== 'object') draft.payload = {};
  draft.payload.vins = vins;

  const firstCar = (draft.payload.cars || []).find((c) => c && (c.chassis || c.vin));
  if (firstCar?.chassis || firstCar?.vin) {
    draft.vin = normVin(firstCar.chassis || firstCar.vin) || draft.vin;
  }
  if (firstCar?.model) {
    draft.product = firstCar.model;
    draft.model = firstCar.model;
  }
  if (firstCar?.plate != null) draft.plate = firstCar.plate;
  if (draft.payload.company_rep) draft.customerName = draft.payload.company_rep;

  if (body.assignedTo != null) draft.assignedTo = String(body.assignedTo);
  if (body.customerName != null) draft.customerName = String(body.customerName);
  if (body.product != null) {
    draft.product = String(body.product);
    draft.model = String(body.product);
  }
  draft.updatedAt = new Date().toISOString();

  // Prefer explicit mode from admin editor (memo vs warehouse UI).
  let warehouseDelivery = false;
  if (body.deliveryMode === 'warehouse' || body.warehouseDelivery === true) {
    warehouseDelivery = true;
  } else if (body.deliveryMode === 'memo' || body.deliveryMode === '' || body.warehouseDelivery === false) {
    warehouseDelivery = false;
  } else {
    warehouseDelivery = isWarehouseDraftPayload(draft.payload);
  }

  if (!draft.payload || typeof draft.payload !== 'object') draft.payload = {};
  if (warehouseDelivery) {
    draft.payload.warehouse_group = true;
    draft.payload.deliveryMode = 'warehouse';
  } else {
    draft.payload.warehouse_group = false;
    draft.payload.deliveryMode = '';
  }

  let deliveredCount = 0;
  let deliveredItems = [];
  if (markDelivered && vins.length) {
    const result = markVinsDelivered(vins, {
      assignedTo: draft.assignedTo || 'admin',
      warehouseDelivery,
      forceAssign: true
    });
    deliveredItems = result.deliveredItems;
    deliveredCount = deliveredItems.length;
  }

  store.drafts[idx] = draft;
  persistAndBroadcast();
  res.json({
    ok: true,
    draft,
    vins,
    deliveredCount,
    deliveryMode: warehouseDelivery ? 'warehouse' : 'memo',
    statusLabel: warehouseDelivery ? 'تم التسليم في المستودع' : 'تم الترحيل',
    items: deliveredItems
  });
});

app.delete('/api/delivery-coordinator/drafts/:draftId', (req, res) => {
  const id = String(req.params.draftId || '').trim();
  const before = store.drafts.length;
  store.drafts = store.drafts.filter((d) => d.id !== id);
  if (store.drafts.length === before) {
    return res.status(404).json({ error: 'المسودة غير موجودة' });
  }
  persistAndBroadcast();
  res.json({ ok: true, draftsTotal: store.drafts.length });
});

/** Manual vehicle entry (ياسين / showroom admin) — creates a new delivery note. */
app.post('/api/delivery-manual/vehicles', (req, res) => {
  const auth = authenticateAgent(req.body?.username, req.body?.password);
  if (!auth.ok) return res.status(401).json({ error: auth.error });

  const isYassin = auth.username === SHOWROOM_AGENT;
  const isShowroomAdmin = auth.role === 'showroom_admin' || auth.username === SHOWROOM_ADMIN_AGENT;
  if (!isYassin && !isShowroomAdmin) {
    return res.status(403).json({ error: 'الإدخال اليدوي متاح لياسين أو Showroom Admin فقط' });
  }

  const vehicle = String(req.body?.vehicle || req.body?.product || '').trim();
  const vin = normVin(req.body?.vin);
  const model = String(req.body?.model || vehicle || '').trim();
  const plate = String(req.body?.plate || '').trim();
  const branch = String(req.body?.branch || req.body?.branch_to || '').trim();
  const branchEntryDate = normalizeIsoDateOnly(req.body?.branchEntryDate, todayIsoRiyadh());
  const vehicleStatus = normalizeVehicleStatus(req.body?.vehicleStatus);

  if (!vehicle) return res.status(400).json({ error: 'Vehicle / Product مطلوب' });
  if (!vin) return res.status(400).json({ error: 'VIN / Chassis مطلوب' });
  if (!branch) return res.status(400).json({ error: 'Branch مطلوب' });
  if (!branchEntryDate) return res.status(400).json({ error: 'Entry Date مطلوب' });
  if (!vehicleStatus) {
    return res.status(400).json({ error: 'Status مطلوب (display|delivery)' });
  }

  // Showroom admin: only cars currently in the 7 parking places
  let parkingEntry = null;
  if (isShowroomAdmin) {
    parkingEntry = findShowroomParkingInStock(vin);
    if (!parkingEntry) {
      return res.status(403).json({
        error: 'يمكن إصدار مذكرة فقط لسيارات موقف العرض (7 أماكن) الخاصة بهذا الحساب'
      });
    }
  }

  // Ensure branch is available in city options (do not block on list mismatch)
  ensureOptions();
  if (!store.options.cities.some((c) => normalizeOptionName(c) === branch)) {
    store.options.cities = uniqueSorted([...store.options.cities, branch]);
  }

  const isDisplay = vehicleStatus === 'display';
  const today = todayIsoRiyadh();
  const dayName = arabicWeekdayName(today);
  const statusPaper = vehicleStatusPaperLabel(vehicleStatus);
  const carRows = [{ model: model || vehicle, chassis: vin, plate, remarks: statusPaper ? `الحالة: ${statusPaper}` : '' }];
  while (carRows.length < 10) carRows.push(emptyCarSlot());

  const companyLabel = isDisplay
    ? (isShowroomAdmin ? SHOWROOM_PARKING_LABEL : SHOWROOM_SPECIAL_NAME)
    : (String(req.body?.company || '').trim() || '');

  const draftPayload = {
    doc_date: today,
    deliveryNoteDate: today,
    branchEntryDate,
    vehicleStatus,
    vehicle_status_label: statusPaper,
    manualEntry: true,
    entryAgent: auth.username,
    invoice_number: '',
    dep_hour: '',
    dep_minute: '',
    customer_name: auth.username,
    company_rep: companyLabel,
    transfer_date: today,
    corresponding_date: today,
    day_name: dayName,
    trailer_number: '',
    car_count: '1',
    branch_to: branch,
    attachments: statusPaper ? `الحالة / Status: ${statusPaper}` : '',
    cars: carRows,
    vins: [vin],
    showroom_display: isDisplay,
    showroom_group: isDisplay || isShowroomAdmin,
    deliveryMode: isDisplay || isShowroomAdmin ? 'showroom' : 'memo',
    showroom_label: isDisplay || isShowroomAdmin ? (isShowroomAdmin ? SHOWROOM_PARKING_LABEL : SHOWROOM_SPECIAL_NAME) : undefined,
    showroom_parking: Boolean(isShowroomAdmin),
    showroom_parking_slot: parkingEntry?.slot || ''
  };

  const carMetaByVin = new Map([[vin, {
    product: vehicle || parkingEntry?.product,
    model: model || vehicle || parkingEntry?.model,
    plate: plate || parkingEntry?.plate || ''
  }]]);
  const { deliveredItems, blocked } = markVinsDelivered([vin], {
    assignedTo: auth.username,
    warehouseDelivery: false,
    showroomDisplay: isDisplay || isShowroomAdmin,
    vehicleStatus,
    forceAssign: true,
    carMetaByVin
  });
  if (blocked.length) {
    return res.status(403).json({
      error: `غير مسموح — الشاسيه مع موظف آخر (${blocked[0].assignedTo})`
    });
  }

  // Historical vehicle entry (append — never overwrite prior VIN records)
  if (!Array.isArray(store.manualVehicles)) store.manualVehicles = [];
  const vehicleRecord = {
    id: `man_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    vin,
    product: vehicle,
    model: model || vehicle,
    plate,
    branch,
    branchEntryDate,
    vehicleStatus,
    manualEntry: true,
    entryAgent: auth.username,
    showroomParking: Boolean(isShowroomAdmin),
    showroomParkingSlot: parkingEntry?.slot || '',
    createdAt: new Date().toISOString()
  };
  store.manualVehicles.unshift(vehicleRecord);

  const id = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id,
    printedAt: new Date().toISOString(),
    vin,
    vins: [vin],
    product: vehicle,
    model: model || vehicle,
    plate,
    assignedTo: auth.username,
    customerName: companyLabel || (isDisplay ? SHOWROOM_SPECIAL_NAME : ''),
    showroomDisplay: isDisplay || isShowroomAdmin,
    manualEntry: true,
    branchEntryDate,
    vehicleStatus,
    entryAgent: auth.username,
    showroomParking: Boolean(isShowroomAdmin),
    showroomParkingSlot: parkingEntry?.slot || '',
    payload: draftPayload
  };
  attachDeliveryNoteMeta(draft, {
    entryAgent: auth.username,
    vehicleStatus,
    branchEntryDate,
    manualEntry: true,
    deliveryNoteDate: today
  });
  archiveDeliveryNoteFile(draft);
  vehicleRecord.deliveryNoteNumber = draft.deliveryNoteNumber;
  vehicleRecord.draftId = draft.id;
  vehicleRecord.archivePath = draft.archivePath || '';

  store.drafts.unshift(draft);
  if (store.drafts.length > MAX_DRAFTS) store.drafts.length = MAX_DRAFTS;

  // Showroom admin delivery: free the parking slot when status is delivery
  if (isShowroomAdmin && parkingEntry && vehicleStatus === 'delivery') {
    parkingEntry.status = 'out';
    parkingEntry.stockedOutAt = new Date().toISOString();
    parkingEntry.stockedOutBy = auth.username;
  }

  persistAndBroadcast();
  res.json({
    ok: true,
    vehicle: vehicleRecord,
    draftId: draft.id,
    deliveryNoteNumber: draft.deliveryNoteNumber,
    deliveryNoteDate: draft.deliveryNoteDate,
    archivePath: draft.archivePath || null,
    pdfSaved: Boolean(draft.pdfSaved),
    vehicleStatus,
    statusLabel: isDisplay ? 'عرض' : 'تم الترحيل',
    branch,
    branchEntryDate,
    parkingSlot: parkingEntry?.slot || '',
    occupancy: isShowroomAdmin ? showroomParkingOccupancy() : undefined,
    item: deliveredItems[0] || null,
    draft
  });
});

app.get('/api/delivery-manual/vehicles', (req, res) => {
  const list = Array.isArray(store.manualVehicles) ? store.manualVehicles : [];
  const vin = normVin(req.query.vin);
  const filtered = vin ? list.filter((v) => normVin(v.vin) === vin) : list;
  res.json({ vehicles: filtered, total: filtered.length });
});

app.get('/api/delivery-notes', (req, res) => {
  const month = String(req.query.month || '').trim(); // YYYY-MM or "all"
  const vin = normVin(req.query.vin);
  let drafts = (store.drafts || []).slice();
  if (vin) {
    drafts = drafts.filter((d) => collectDraftVins(d.payload, [d.vin, ...(d.vins || [])]).includes(vin));
  }
  if (month && month !== 'all') {
    drafts = drafts.filter((d) => draftMonthKey(d) === month);
  }
  const stats = computeDeliveryNoteStats(drafts);
  const allStats = computeDeliveryNoteStats(store.drafts || []);
  res.json({
    drafts,
    stats,
    allStats,
    months: Object.keys(allStats.byMonth || {}).sort().reverse()
  });
});

/** Ensure all drafts have archived files (admin backfill). */
app.post('/api/delivery-notes/archive-missing', (_req, res) => {
  let saved = 0;
  let failed = 0;
  for (const d of store.drafts || []) {
    const hasFile = d.archiveFile
      && fs.existsSync(path.join(NOTES_ARCHIVE_DIR, path.basename(d.archiveFile)));
    if (hasFile) continue;
    if (archiveDeliveryNoteFile(d)) saved += 1;
    else failed += 1;
  }
  persistAndBroadcast();
  res.json({ ok: true, saved, failed, total: (store.drafts || []).length });
});

app.get('/api/delivery-notes/vin/:vin', (req, res) => {
  const vin = normVin(req.params.vin);
  if (!vin) return res.status(400).json({ error: 'VIN مطلوب' });
  const drafts = (store.drafts || []).filter((d) =>
    collectDraftVins(d.payload, [d.vin, ...(d.vins || [])]).includes(vin)
  );
  drafts.sort((a, b) => {
    const ta = a.printedAt ? new Date(a.printedAt).getTime() : 0;
    const tb = b.printedAt ? new Date(b.printedAt).getTime() : 0;
    return ta - tb;
  });
  res.json({
    vin,
    count: drafts.length,
    drafts,
    product: drafts[0]?.product || drafts[0]?.model || ''
  });
});

app.get('/api/delivery-notes/:deliveryNoteNumber', (req, res) => {
  const num = String(req.params.deliveryNoteNumber || '').trim();
  if (!num) return res.status(400).json({ error: 'deliveryNoteNumber مطلوب' });
  const draft = (store.drafts || []).find((d) =>
    String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '') === num
    || String(d.id || '') === num
  );
  if (!draft) return res.status(404).json({ error: 'مذكرة التسليم غير موجودة' });
  res.json({ draft });
});

/** Download archived delivery-note document (DOCX printable archive). */
app.get('/api/delivery-notes/:deliveryNoteNumber/file', (req, res) => {
  const num = String(req.params.deliveryNoteNumber || '').trim();
  const draft = (store.drafts || []).find((d) =>
    String(d.deliveryNoteNumber || (d.payload && d.payload.deliveryNoteNumber) || '') === num
    || String(d.id || '') === num
  );
  if (!draft) return res.status(404).json({ error: 'مذكرة التسليم غير موجودة' });

  let abs = '';
  if (draft.archiveFile) {
    abs = path.join(NOTES_ARCHIVE_DIR, path.basename(draft.archiveFile));
  }
  if (!abs || !fs.existsSync(abs)) {
    archiveDeliveryNoteFile(draft);
    saveStore();
    abs = draft.archiveFile
      ? path.join(NOTES_ARCHIVE_DIR, path.basename(draft.archiveFile))
      : '';
  }
  if (!abs || !fs.existsSync(abs)) {
    return res.status(404).json({ error: 'ملف المذكرة غير محفوظ بعد' });
  }
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${path.basename(abs)}"`
  );
  res.sendFile(abs);
});

app.post('/api/delivery-note/generate', (req, res) => {
  try {
    const buf = generateDocx(req.body || {});
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="muthakara_tarhil_${Date.now()}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error('[generate]', err);
    res.status(500).json({ error: err.message || 'فشل إنشاء الملف' });
  }
});

app.post('/api/delivery-note/generate-check-note', (req, res) => {
  try {
    // Prefer the PDF form (اسامة12) when available; fall back to Word template.
    if (fs.existsSync(DELIVERY_CHECK_PDF_FILE)) {
      const buf = getDeliveryCheckPdfBuffer();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="delivery_check_note_${Date.now()}.pdf"`);
      return res.send(buf);
    }
    const buf = generateDeliveryCheckDocx(req.body || {});
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="delivery_check_note_${Date.now()}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error('[generate-check-note]', err);
    res.status(500).json({ error: err.message || 'فشل إنشاء ملف delivery_check_note' });
  }
});

app.get('/api/delivery-note/check-note-preview', (_req, res) => {
  if (!fs.existsSync(DELIVERY_CHECK_PREVIEW_IMAGE)) {
    return res.status(404).json({ error: 'Warehouse preview image not found' });
  }
  res.sendFile(DELIVERY_CHECK_PREVIEW_IMAGE);
});

// Serve React admin dashboard (built assets)
const adminDist = path.join(ROOT, 'admin-app', 'dist');
if (fs.existsSync(adminDist)) {
  app.use('/admin-app', express.static(adminDist, {
    setHeaders(res, filePath) {
      if (/\.(html|js|css)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  }));
  app.get('/admin-app/*', (_req, res) => {
    res.sendFile(path.join(adminDist, 'index.html'));
  });
}

// Static files (hub UI + assets)
app.use(express.static(ROOT, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    // HTML must never stick in the browser — admin filter UI changes were invisible under cache.
    if (/\.html?$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return;
    }
    if (/\.(js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

loadStore();

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  wsClients.add(socket);
  socket.send(JSON.stringify({ type: 'delivery_hub_updated', at: Date.now() }));
  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
});

server.listen(PORT, () => {
  console.log(`[delivery] listening on http://localhost:${PORT}`);
  console.log(`[delivery] agents password: ${AGENT_PASSWORD}`);
  console.log(`[delivery] data file: ${DATA_FILE}`);
});
