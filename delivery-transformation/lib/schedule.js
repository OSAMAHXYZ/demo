'use strict';

/**
 * VIN schedule / SLA engine.
 * Day 1 is always that VIN's Proforma Date — never the calendar day of the month.
 */

const DEFAULT_SLA = Object.freeze([
  { id: 'psfu', label: 'PSFU', statuses: ['PSFU'], targetDay: 5, enabled: true },
  { id: 'claimed', label: 'CLAIMED', statuses: ['Claimed'], targetDay: 5, enabled: true },
  { id: 'registration', label: 'REGISTRATION', statuses: ['مرور'], dateField: 'registrationIssueDate', targetDay: 6, enabled: true },
  { id: 'center', label: 'CENTER ARRIVAL', statuses: ['جاهز للتسليم'], targetDay: 7, enabled: true },
  { id: 'delivered', label: 'DELIVERED', statuses: ['تم التسليم'], targetDay: 8, enabled: true },
]);

function dayKey(s) {
  const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function addDays(key, n) {
  const k = dayKey(key);
  if (!k) return '';
  const [y, mo, d] = k.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + Number(n || 0)));
  return dt.toISOString().slice(0, 10);
}

function diffDays(from, to) {
  const a = dayKey(from);
  const b = dayKey(to);
  if (!a || !b) return null;
  const [ay, amo, ad] = a.split('-').map(Number);
  const [by, bmo, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bmo - 1, bd) - Date.UTC(ay, amo - 1, ad)) / 86400000);
}

function actualDays(proforma, when) {
  const d = diffDays(proforma, when);
  return d == null ? null : d + 1;
}

function cloneSla(list) {
  return JSON.parse(JSON.stringify(list || DEFAULT_SLA));
}

function normalizeSla(input) {
  const base = cloneSla(DEFAULT_SLA);
  if (!Array.isArray(input) || !input.length) return base;
  const byId = new Map(input.map((x) => [x && x.id, x]));
  return base.map((item) => {
    const src = byId.get(item.id) || {};
    const day = Math.round(Number(src.targetDay));
    return {
      ...item,
      label: String(src.label || item.label).trim() || item.label,
      targetDay: Number.isFinite(day) && day >= 1 ? Math.min(60, day) : item.targetDay,
      enabled: src.enabled === false ? false : true,
      statuses: Array.isArray(src.statuses) && src.statuses.length
        ? src.statuses.map((s) => String(s || '').trim()).filter(Boolean)
        : item.statuses,
      dateField: src.dateField || item.dateField || '',
    };
  });
}

function recordStatusEnter(ops, status, at) {
  const s = String(status || '').trim();
  if (!s || !ops) return false;
  if (!Array.isArray(ops.statusHistory)) ops.statusHistory = [];
  if (ops.statusHistory.some((h) => h && h.status === s)) return false;
  ops.statusHistory.push({ status: s, at: at || new Date().toISOString() });
  return true;
}

function backfillFromAudit(vehicle, auditRows) {
  if (!vehicle || !vehicle.ops) return;
  if (!Array.isArray(vehicle.ops.statusHistory)) vehicle.ops.statusHistory = [];
  const rows = (auditRows || [])
    .filter((a) => a && a.action === 'update' && String(a.newValue || '').startsWith('opsStatus:'))
    .slice()
    .sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  rows.forEach((a) => {
    const status = String(a.newValue || '').replace(/^opsStatus:\s*/, '').trim();
    if (status && status !== '(empty)') recordStatusEnter(vehicle.ops, status, a.at);
  });
  if (vehicle.ops.opsStatus) {
    recordStatusEnter(
      vehicle.ops,
      vehicle.ops.opsStatus,
      vehicle.ops.updatedAt || vehicle.ops.assignedAt || new Date().toISOString(),
    );
  }
}

function firstAchievedAt(vehicle, sla, auditRows) {
  const statuses = new Set((sla.statuses || []).map((s) => s.toLowerCase()));
  const hist = (vehicle.ops && vehicle.ops.statusHistory) || [];
  const fromHist = hist
    .filter((h) => h && statuses.has(String(h.status || '').toLowerCase()))
    .map((h) => dayKey(h.at))
    .filter(Boolean)
    .sort();
  if (fromHist[0]) return { at: fromHist[0], source: 'history' };

  if (sla.dateField && vehicle.ops) {
    const fieldDay = dayKey(vehicle.ops[sla.dateField]);
    if (fieldDay) return { at: fieldDay, source: sla.dateField };
  }

  const fromAudit = (auditRows || [])
    .filter((a) => a && a.action === 'update' && String(a.newValue || '').startsWith('opsStatus:'))
    .map((a) => {
      const status = String(a.newValue || '').replace(/^opsStatus:\s*/, '').trim();
      return { status, at: dayKey(a.at) };
    })
    .filter((x) => x.at && statuses.has(x.status.toLowerCase()))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (fromAudit[0]) return { at: fromAudit[0].at, source: 'audit' };

  const current = String((vehicle.ops && vehicle.ops.opsStatus) || '').trim();
  if (current && statuses.has(current.toLowerCase())) {
    const fallback = dayKey((vehicle.ops && (vehicle.ops.updatedAt || vehicle.ops.assignedAt)) || '');
    if (fallback) return { at: fallback, source: 'inferred' };
  }
  return { at: '', source: '' };
}

function classify({ proforma, targetDay, actualAt, today }) {
  const targetDate = addDays(proforma, targetDay - 1);
  if (!proforma || !targetDate) {
    return {
      result: 'NO DATA',
      zone: 'empty',
      targetDate: '',
      actualAt: '',
      actualDays: null,
      label: 'No Proforma Date',
      daysLate: null,
      daysRemaining: null,
    };
  }
  if (actualAt) {
    const days = actualDays(proforma, actualAt);
    const late = diffDays(targetDate, actualAt);
    if (late > 0) {
      return {
        result: 'LATE',
        zone: 'red',
        targetDate,
        actualAt,
        actualDays: days,
        label: `${late} day${late === 1 ? '' : 's'} late`,
        daysLate: late,
        daysRemaining: 0,
      };
    }
    if (late === 0) {
      return {
        result: 'ON TIME',
        zone: 'green',
        targetDate,
        actualAt,
        actualDays: days,
        label: `Day ${days}`,
        daysLate: 0,
        daysRemaining: 0,
      };
    }
    return {
      result: 'ON TRACK',
      zone: 'green',
      targetDate,
      actualAt,
      actualDays: days,
      label: `Day ${days}`,
      daysLate: 0,
      daysRemaining: Math.abs(late),
    };
  }
  const remain = diffDays(today, targetDate);
  if (remain > 0) {
    return {
      result: 'PENDING',
      zone: 'green',
      targetDate,
      actualAt: '',
      actualDays: null,
      label: `${remain} day${remain === 1 ? '' : 's'} remaining`,
      daysLate: null,
      daysRemaining: remain,
    };
  }
  if (remain === 0) {
    return {
      result: 'DUE TODAY',
      zone: 'green',
      targetDate,
      actualAt: '',
      actualDays: null,
      label: 'Due today',
      daysLate: 0,
      daysRemaining: 0,
    };
  }
  const overdue = Math.abs(remain);
  return {
    result: 'LATE',
    zone: 'red',
    targetDate,
    actualAt: '',
    actualDays: null,
    label: `${overdue} day${overdue === 1 ? '' : 's'} overdue`,
    daysLate: overdue,
    daysRemaining: 0,
  };
}

function computeVinSla(vehicle, sla, today, auditRows) {
  const proforma = dayKey(vehicle.raw && vehicle.raw.proformaDate);
  const hit = firstAchievedAt(vehicle, sla, auditRows);
  const row = classify({
    proforma,
    targetDay: sla.targetDay,
    actualAt: hit.at,
    today,
  });
  return {
    slaId: sla.id,
    slaLabel: sla.label,
    targetDay: sla.targetDay,
    proforma,
    source: hit.source,
    vin: vehicle.vin,
    employee: (vehicle.ops && vehicle.ops.assignedEmployeeName) || '',
    status: (vehicle.ops && vehicle.ops.opsStatus) || '',
    ...row,
  };
}

function computeDashboard({ vehicles, slaItems, today, month, audit }) {
  const items = normalizeSla(slaItems).filter((s) => s.enabled);
  const auditByVin = {};
  (audit || []).forEach((a) => {
    const vin = String((a && a.vin) || '').trim().toUpperCase();
    if (!vin) return;
    if (!auditByVin[vin]) auditByVin[vin] = [];
    auditByVin[vin].push(a);
  });

  const pool = (vehicles || []).filter((v) => {
    const p = dayKey(v.raw && v.raw.proformaDate);
    if (!p) return false;
    if (month && p.slice(0, 7) !== month) return false;
    return true;
  });

  const bySla = items.map((sla) => {
    const rows = pool.map((v) => {
      backfillFromAudit(v, auditByVin[v.vin] || []);
      return computeVinSla(v, sla, today, auditByVin[v.vin] || []);
    });
    const green = rows.filter((r) => r.zone === 'green').length;
    const red = rows.filter((r) => r.zone === 'red').length;
    const onTime = rows.filter((r) => r.result === 'ON TIME').length;
    const onTrack = rows.filter((r) => r.result === 'ON TRACK').length;
    const pending = rows.filter((r) => r.result === 'PENDING' || r.result === 'DUE TODAY').length;
    const late = rows.filter((r) => r.result === 'LATE').length;
    return {
      id: sla.id,
      label: sla.label,
      targetDay: sla.targetDay,
      statuses: sla.statuses,
      total: rows.length,
      green,
      red,
      onTime,
      onTrack,
      pending,
      late,
      rows,
    };
  });

  const focus = bySla[0] || { total: 0, green: 0, red: 0 };
  return {
    today,
    month,
    noProforma: (vehicles || []).filter((v) => {
      const p = dayKey(v.raw && v.raw.proformaDate);
      if (p) return false;
      if (!month) return true;
      return String((v.raw && v.raw.date) || (v.ops && v.ops.assignedAt) || '').slice(0, 7) === month;
    }).length,
    totals: {
      vins: pool.length,
      green: bySla.reduce((s, x) => s + x.green, 0),
      red: bySla.reduce((s, x) => s + x.red, 0),
    },
    sla: bySla,
    focusId: focus.id || '',
    calendar: computeVsndCalendar({ vehicles: pool, today, month, slaItems: items }),
  };
}

/** Status × calendar-day grid (VSND Schedule) — Proforma day of month × current ops status. */
const VSND_ROWS = Object.freeze([
  { status: 'Claimed', label: 'CLAIMED', tone: 'claimed', icon: '✓' },
  { status: 'PSFU', label: 'PSFU', tone: 'psfu', icon: '🚚' },
  { status: 'تم التسليم', label: 'تم التسليم', tone: 'delivered', icon: '🚗' },
  { status: 'جاهز للتسليم', label: 'جاهز للتسليم', tone: 'ready', icon: '📦' },
  { status: 'تسليم متقدم', label: 'تسليم متقدم', tone: 'advance', icon: '🚐' },
  { status: 'صادرة', label: 'صادر', tone: 'issued', icon: '📋' },
  { status: 'مرور', label: 'مرور', tone: 'traffic', icon: '📄' },
  { status: 'بطاقة', label: 'بطاقة', tone: 'card', icon: '🪪' },
  { status: 'فسح', label: 'فسح', tone: 'clearance', icon: '🏢' },
  { status: 'معلقة', label: 'معلقة', tone: 'hold', icon: '⏸' },
  { status: 'الغاء', label: 'الغاء', tone: 'cancel', icon: '✕' },
]);

function daysInMonth(ym) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return 31;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

function weekdayShort(ym, day) {
  const m = String(ym || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, day));
  return dt.toLocaleString('en', { weekday: 'short', timeZone: 'UTC' });
}

function computeVsndCalendar({ vehicles, today, month, slaItems }) {
  const ym = month || String(today || '').slice(0, 7);
  const days = daysInMonth(ym);
  const todayDay = String(today || '').slice(0, 7) === ym
    ? Number(String(today).slice(8, 10))
    : days;
  const psfuSla = (slaItems || []).find((s) => s.id === 'psfu') || { targetDay: 5 };
  const psfuTarget = Number(psfuSla.targetDay) || 5;

  const rows = VSND_ROWS.map((meta) => ({
    ...meta,
    days: Array.from({ length: days }, () => 0),
    total: 0,
  }));
  const byStatus = new Map(rows.map((r) => [r.status, r]));
  const dayTotals = Array.from({ length: days }, () => 0);
  let delivered = 0;
  let notDelivered = 0;
  const vinIndex = [];

  (vehicles || []).forEach((v) => {
    const p = dayKey(v.raw && v.raw.proformaDate);
    if (!p || p.slice(0, 7) !== ym) return;
    const day = Number(p.slice(8, 10));
    if (!day || day < 1 || day > days) return;
    const status = String((v.ops && v.ops.opsStatus) || '').trim();
    const row = byStatus.get(status);
    const entry = {
      vin: v.vin,
      employee: (v.ops && v.ops.assignedEmployeeName) || '',
      status,
      proforma: p,
      day,
      product: (v.raw && v.raw.product) || '',
    };
    vinIndex.push(entry);
    if (status === 'تم التسليم') delivered += 1;
    else notDelivered += 1;
    dayTotals[day - 1] += 1;
    if (!row) return;
    row.days[day - 1] += 1;
    row.total += 1;
  });

  const dayHeaders = Array.from({ length: days }, (_, i) => ({
    day: i + 1,
    weekday: weekdayShort(ym, i + 1),
    future: i + 1 > todayDay,
  }));

  return {
    month: ym,
    today,
    todayDay,
    days,
    dayHeaders,
    psfuTarget,
    delivered,
    notDelivered,
    grandTotal: delivered + notDelivered,
    dayTotals,
    rows: rows.map((r) => {
      const psfuGreenUntil = Math.max(10, psfuTarget * 2);
      const zones = r.days.map((n, i) => {
        const day = i + 1;
        if (day > todayDay) return 'future';
        if (r.status === 'PSFU') return day <= psfuGreenUntil ? 'ok' : 'late';
        if (!n) return 'empty';
        return 'ok';
      });
      return {
        status: r.status,
        label: r.label,
        tone: r.tone,
        icon: r.icon,
        days: r.days,
        zones,
        total: r.total,
      };
    }),
    vins: vinIndex,
  };
}

module.exports = {
  DEFAULT_SLA,
  VSND_ROWS,
  dayKey,
  addDays,
  diffDays,
  actualDays,
  normalizeSla,
  recordStatusEnter,
  backfillFromAudit,
  computeVinSla,
  computeDashboard,
  computeVsndCalendar,
};
