/**
 * Plan Tracker — Retail Electronic Sales Allocation & Movement Control Tower
 * Data source: Data Uploader RTL daily snapshots (/api/rtl-daily/active-month)
 */
(function (global) {
  "use strict";

  const TARGET_SEARCH_AREA = "Retail Electronic Sales";
  const ALLOCATION_PLAN = 315;
  const PT_CHARTS = {};

  const view = {
    monthKey: "",
    monthLocked: false,
    snapDate: "",
    movement: "",
    product: "",
    sfx: "",
    year: "",
    status: "",
    area: "",
    tab: "all",
    mode: "daily",
    q: "",
    vinQ: "",
    vinPin: null,
    drill: "", // kpi key for VIN list
    ageBucket: "",
    scheduleTitle: "",
    scheduleList: null,
  };

  let lastModel = null;
  let uiBound = false;

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }
  function esc(s) {
    return typeof global.escapeHtml === "function" ? global.escapeHtml(s) : String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(n) {
    return typeof global.formatNumber === "function" ? global.formatNumber(n) : String(n == null ? 0 : n);
  }
  function normHeader(s) {
    return typeof global.normHeader === "function"
      ? global.normHeader(s)
      : String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  /** Unique VIN key: string → trim → alnum uppercase. Blank → "". */
  function normalizeVin(raw) {
    if (typeof global.extractVinValue === "function") {
      const v = global.extractVinValue(raw);
      if (v) return String(v).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    }
    return String(raw == null ? "" : raw).trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }
  /** @deprecated alias */
  function normVin(raw) {
    return normalizeVin(raw);
  }
  function parseDate(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
    if (typeof global.parseDate === "function") return global.parseDate(v);
    if (v == null || v === "") return null;
    const s = String(v).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function fmtDate(d) {
    if (!d) return "—";
    if (typeof global.formatRvDate === "function") {
      const s = global.formatRvDate(d);
      if (s && s !== "—" && s !== "N/A") return s;
    }
    try {
      const dt = d instanceof Date ? d : parseDate(d);
      if (!dt) return "—";
      return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return "—";
    }
  }
  /** RES = Search Area contains "Retail Electronic Sales" (normalized). */
  function isRES(vehicleOrArea) {
    const desc = typeof vehicleOrArea === "string"
      ? vehicleOrArea
      : (vehicleOrArea && (vehicleOrArea.searchArea || vehicleOrArea.searchAreaDesc)) || "";
    const t = normHeader(TARGET_SEARCH_AREA);
    const s = normHeader(desc || "");
    if (!s || !t) return false;
    return s === t || s.includes(t);
  }
  function isTargetArea(desc) {
    return isRES(desc);
  }
  function daysBetween(a, b) {
    if (!a || !b) return null;
    const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
      - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    return Math.round(ms / 86400000);
  }

  function fileDateFromKey(dateKey) {
    const parts = String(dateKey || "").split("-").map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return null;
  }

  function ymdKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  /**
   * Calendar gaps between the first and last RTL file.
   * A file with zero allocations is not a gap.
   */
  function missingSnapshotDates(dateKeys) {
    const keys = (dateKeys || []).filter((k) => fileDateFromKey(k)).slice().sort();
    if (keys.length < 2) return [];
    const have = new Set(keys);
    const missing = [];
    const start = fileDateFromKey(keys[0]);
    const end = fileDateFromKey(keys[keys.length - 1]);
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cursor <= last) {
      const key = ymdKey(cursor);
      if (!have.has(key)) missing.push(key);
      cursor.setDate(cursor.getDate() + 1);
    }
    return missing;
  }

  function sameCalendarDay(a, b) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false;
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
    return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate();
  }

  function isAge0(row) {
    const age = row && row.allocationAge;
    return age != null && Number.isFinite(age) && Math.floor(age) === 0;
  }

  /**
   * Allocation Date YYYY-MM (empty if unknown).
   */
  function allocationMonthKey(row) {
    if (row && row.allocationDate instanceof Date && !Number.isNaN(row.allocationDate.getTime())) {
      const d = row.allocationDate;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    }
    return "";
  }

  /**
   * True 315 plan receipt candidate (snapshot rules only — firstArea checked by caller).
   * RES + Age 0 + Allocation Date === RTL file calendar day.
   */
  function isPlanScheduleReceipt(row, dateKey) {
    if (!row || !isRES(row)) return false;
    if (!isAge0(row)) return false;
    const observeKey = dateKey || row.dateKey || "";
    const fileDate = fileDateFromKey(observeKey);
    if (!fileDate) return false;
    if (!(row.allocationDate instanceof Date) || Number.isNaN(row.allocationDate.getTime())) return false;
    return sameCalendarDay(row.allocationDate, fileDate);
  }

  /**
   * New-car day for a VIN in one RTL file.
   * RES, and allocation age equals the calendar days from the allocation date to this file.
   * Age 0 on the file day stays on that day. Age 1 on the next file belongs to the day before.
   */
  function newCarCreditKey(row, fileDateKey) {
    if (!row || !row.vin || !isRES(row)) return "";
    const fileDate = fileDateFromKey(fileDateKey || row.dateKey || "");
    if (!fileDate) return "";
    if (!(row.allocationDate instanceof Date) || Number.isNaN(row.allocationDate.getTime())) return "";
    const age = row.allocationAge;
    if (age == null || !Number.isFinite(Number(age)) || Number(age) < 0) return "";
    const gap = daysBetween(row.allocationDate, fileDate);
    if (gap == null || gap < 0 || Math.floor(Number(age)) !== gap) return "";
    return ymdKey(row.allocationDate);
  }

  /**
   * Free stock: RES + Age 0 + Allocation Date before the active month.
   * Independent of 315. Does NOT use age≥1 as a substitute.
   */
  function isPriorMonthFreeStock(row, monthKey) {
    if (!row || !isRES(row) || !monthKey) return false;
    if (!isAge0(row)) return false;
    const mk = allocationMonthKey(row);
    return !!(mk && mk < monthKey);
  }

  /** Attach Sales Raw Col P (proforma) / Col V (delivered) onto VIN rows. */
  function enrichRowsWithSalesRaw(rows) {
    if (typeof global.buildSalesVinLookup !== "function" || typeof global.resolveAaSalesStatus !== "function") {
      return;
    }
    let lookup;
    try {
      lookup = global.buildSalesVinLookup();
    } catch (_) {
      return;
    }
    (rows || []).forEach((r) => {
      if (!r || !r.vin) return;
      const sales = global.resolveAaSalesStatus(r.vin, lookup);
      r.proformaDate = sales.proformaDate || null;
      r.invoiceDate = sales.invoiceDate || sales.deliveryDate || null;
      r.salesKind = sales.kind || "none";
      r.salesLabel = sales.label || "—";
      if (sales.kind === "delivered") r.deliveryStatus = "Delivered";
      else if (sales.kind === "proforma") r.deliveryStatus = "Proforma";
      else if (sales.kind === "sales") r.deliveryStatus = "In Sales Raw";
      else r.deliveryStatus = "Not in Sales Raw";
    });
  }

  /** @deprecated */
  function isThisMonthReceipt(row) {
    return isPlanScheduleReceipt(row, row && row.dateKey);
  }
  /** @deprecated */
  function isPlanReceipt(row, dateKey) {
    return isPlanScheduleReceipt(row, dateKey);
  }

  function ageBucket(age) {
    if (age == null || !Number.isFinite(age)) return "blank";
    const n = Math.floor(age);
    if (n <= 0) return "0";
    if (n === 1) return "1";
    if (n === 2) return "2";
    if (n === 3) return "3";
    if (n === 4) return "4";
    if (n === 5) return "5";
    if (n < 10) return "6-9";
    return "10+";
  }
  function destroyChart(id) {
    if (PT_CHARTS[id]) {
      try { PT_CHARTS[id].destroy(); } catch (_) { /* ignore */ }
      delete PT_CHARTS[id];
    }
  }
  function makeChart(id, cfg) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof global.Chart === "undefined") return;
    destroyChart(id);
    PT_CHARTS[id] = new global.Chart(canvas, cfg);
    if (id === "pt-chart-status") placeDonutMid();
  }

  function placeDonutMid() {
    const chart = PT_CHARTS["pt-chart-status"];
    const mid = document.getElementById("pt-donut-mid");
    if (!chart || !mid || !chart.canvas) return;
    const arcs = (chart.getDatasetMeta(0).data || []).filter((arc) => arc && Number.isFinite(arc.x));
    const area = chart.chartArea || {};
    const x = arcs.length ? arcs[0].x : (area.left + area.right) / 2;
    const y = arcs.length ? arcs[0].y : (area.top + area.bottom) / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const canvas = chart.canvas;
    mid.style.left = `${canvas.offsetLeft + x}px`;
    mid.style.top = `${canvas.offsetTop + y}px`;
    mid.style.right = "auto";
    mid.style.bottom = "auto";
    mid.style.width = "max-content";
    mid.style.transform = "translate(-50%, -50%)";
  }

  function mapVehicle(v, dateKey, snapId, i) {
    if (typeof global.mapRtlDailyVehicle === "function") {
      const car = global.mapRtlDailyVehicle(v, dateKey, snapId, i);
      const searchArea = (typeof global.dayVehicleSearchArea === "function"
        ? global.dayVehicleSearchArea(v)
        : "") || car.searchAreaDesc || car.searchArea || "";
      const agDate = typeof global.dayVehicleAgDate === "function"
        ? global.dayVehicleAgDate(v)
        : (car.allocationDate instanceof Date ? car.allocationDate : parseDate(car.allocationDate || car.agDate));
      const ageRaw = car.ageing != null ? car.ageing : car.allocationAge;
      const age = ageRaw == null || ageRaw === "" || !Number.isFinite(Number(ageRaw))
        ? null
        : Math.floor(Number(ageRaw));
      const search = searchArea || "";
      return {
        vin: normalizeVin(car.vin),
        product: car.product || "—",
        suffix: car.suffix || "—",
        year: car.year || "",
        ext: car.ext || "",
        int: car.int || "",
        searchArea: search,
        isTarget: isRES(search),
        allocationDate: agDate instanceof Date && !Number.isNaN(agDate.getTime()) ? agDate : null,
        allocationAge: age,
        status: car.status || "",
        secondaryStatus: rtlSecondaryStatus(v),
        deliveryStatus: "",
        location: car.location || "—",
        usage: car.usage || "",
        dateKey,
      };
    }
    // Plain-object fallback (tests / offline)
    if (!v || typeof v !== "object") return null;
    const search = String(v.searchArea || v.searchAreaDesc || "").trim();
    const ageRaw = v.allocationAge != null ? v.allocationAge : v.age;
    const age = ageRaw == null || ageRaw === "" || !Number.isFinite(Number(ageRaw))
      ? null
      : Math.floor(Number(ageRaw));
    const ag = v.allocationDate instanceof Date
      ? v.allocationDate
      : parseDate(v.allocationDate || v.agDate || v.AG);
    return {
      vin: normalizeVin(v.vin || v.VIN),
      product: v.product || "—",
      suffix: v.suffix || v.sfx || "—",
      year: v.year || "",
      ext: v.ext || "",
      int: v.int || "",
      searchArea: search,
      isTarget: isRES(search),
      allocationDate: ag instanceof Date && !Number.isNaN(ag.getTime()) ? ag : null,
      allocationAge: age,
      status: v.status || "",
      secondaryStatus: rtlSecondaryStatus(v),
      deliveryStatus: "",
      location: v.location || "—",
      usage: v.usage || "",
      dateKey,
    };
  }

  function snapshotRows(snap, dateKey) {
    const vehicles = (snap && snap.vehicles) || [];
    const byVin = new Map();
    const quality = {
      blankVin: 0,
      duplicateVin: 0,
      missingArea: 0,
      invalidAge: 0,
      missingAllocationDate: 0,
      invalidAllocationDate: 0,
      ageMismatch: 0,
      conflictingRecords: 0,
      multiArea: 0,
    };
    const fileDate = fileDateFromKey(dateKey);
    const conflictSeen = new Map(); // vin -> first searchArea|age signature

    vehicles.forEach((v, i) => {
      const row = mapVehicle(v, dateKey, snap && snap.id, i);
      if (!row) return;
      if (!row.vin) {
        quality.blankVin += 1;
        return;
      }
      if (byVin.has(row.vin)) {
        quality.duplicateVin += 1;
        const first = byVin.get(row.vin);
        const sig = `${row.searchArea}|${row.allocationAge}|${allocationMonthKey(row)}`;
        const firstSig = conflictSeen.get(row.vin) || `${first.searchArea}|${first.allocationAge}|${allocationMonthKey(first)}`;
        if (sig !== firstSig) quality.conflictingRecords += 1;
        return; // ONE VIN = ONE VEHICLE — keep first
      }
      conflictSeen.set(row.vin, `${row.searchArea}|${row.allocationAge}|${allocationMonthKey(row)}`);
      if (!row.searchArea) quality.missingArea += 1;
      if (row.allocationAge == null) quality.invalidAge += 1;
      if (!row.allocationDate) {
        quality.missingAllocationDate += 1;
      } else if (!(row.allocationDate instanceof Date) || Number.isNaN(row.allocationDate.getTime())) {
        quality.invalidAllocationDate += 1;
      }
      if (row.allocationDate && fileDate) {
        const calc = daysBetween(row.allocationDate, fileDate);
        row.calculatedAge = calc;
        if (row.allocationAge != null && calc != null && Math.abs(row.allocationAge - calc) > 1) {
          quality.ageMismatch += 1;
          row.ageMismatch = true;
        }
      }
      byVin.set(row.vin, row);
    });

    return { byVin, quality, fileDate, count: byVin.size };
  }

  /**
   * Build full movement model from rtl-daily active-month pack.
   * Daily RES Age 0 ≠ 315 plan receipts — never conflate them.
   */
  function buildModel(pack, opts) {
    const plan = (opts && opts.plan != null) ? Number(opts.plan) : ALLOCATION_PLAN;
    const days = pack && pack.days && typeof pack.days === "object" ? pack.days : {};
    const dateKeys = Object.keys(days).sort();
    const ctx = typeof global.basMonthContext === "function" ? global.basMonthContext() : null;
    const monthKey = (pack && pack.month)
      || (ctx && ctx.monthKey)
      || (dateKeys[0] ? String(dateKeys[0]).slice(0, 7) : "");

    const daily = [];
    const movements = [];
    const vinHistory = new Map();
    const planReceiptVins = new Set();
    const freeStockVins = new Set();
    const freeStockMeta = new Map();
    const planReceiptMeta = new Map(); // vin -> row at credit time (frozen)
    const everEnteredRes = new Set();
    const everSeen = new Set();
    const disappearedEver = new Set();
    const firstSeenDateByVin = new Map();
    const firstAreaByVin = new Map();
    const firstRecordByVin = new Map();

    const qualityTotals = {
      blankVin: 0,
      duplicateVin: 0,
      missingArea: 0,
      invalidAge: 0,
      missingAllocationDate: 0,
      invalidAllocationDate: 0,
      ageMismatch: 0,
      conflictingRecords: 0,
      unmatchedProductSfx: 0,
      duplicateSnapshot: 0,
      snapshotCount: dateKeys.length,
    };
    const corridor = new Map();
    const age0ByArea = new Map();
    let prev = null;
    let latestTarget = new Map();

    const noteFirstSeen = (vin, row, dateKey) => {
      if (!vin || !row) return;
      if (!firstSeenDateByVin.has(vin)) {
        firstSeenDateByVin.set(vin, dateKey);
        firstAreaByVin.set(vin, row.searchArea || "");
        firstRecordByVin.set(vin, { ...row });
      }
    };

    const firstAreaWasRes = (vin) => {
      const first = firstAreaByVin.get(vin);
      if (first == null || first === "") return false;
      return isRES(first);
    };

    /**
     * Credit plan / free stock once. Transfer-in never credits plan.
     * Historical freeze: only evaluates the observation row for its own dateKey.
     */
    const tryCredit = (vin, row, dateKey, dayStats, creditOpts) => {
      if (!row || !vin) return "";
      if (creditOpts && creditOpts.fromOtherArea) return "";
      if (planReceiptVins.has(vin) || freeStockVins.has(vin)) return "";
      if (!isRES(row) && !(creditOpts && creditOpts.wasRes)) return "";
      const asRes = { ...row, isTarget: true, searchArea: row.searchArea || TARGET_SEARCH_AREA };
      const observeKey = (creditOpts && creditOpts.observeKey) || row.dateKey || dateKey;

      if (isPlanScheduleReceipt(asRes, observeKey)) {
        if (!firstAreaWasRes(vin)) return "";
        planReceiptVins.add(vin);
        planReceiptMeta.set(vin, asRes);
        dayStats.planReceipts.push(asRes);
        return "plan";
      }
      if (isPriorMonthFreeStock(asRes, monthKey)) {
        freeStockVins.add(vin);
        freeStockMeta.set(vin, asRes);
        dayStats.freeStock.push(asRes);
        return "free";
      }
      return "";
    };

    dateKeys.forEach((dateKey) => {
      const snap = days[dateKey];
      const { byVin, quality } = snapshotRows(snap, dateKey);
      qualityTotals.blankVin += quality.blankVin;
      qualityTotals.duplicateVin += quality.duplicateVin;
      qualityTotals.missingArea += quality.missingArea;
      qualityTotals.invalidAge += quality.invalidAge;
      qualityTotals.missingAllocationDate += quality.missingAllocationDate;
      qualityTotals.invalidAllocationDate += quality.invalidAllocationDate;
      qualityTotals.ageMismatch += quality.ageMismatch;
      qualityTotals.conflictingRecords += quality.conflictingRecords;

      const fileDate = fileDateFromKey(dateKey);
      const dayStats = {
        dateKey,
        label: fileDate
          ? fileDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
          : dateKey,
        newRes: [],           // first-seen RES appearances (recon: New RES)
        planReceipts: [],     // true 315 receipts this day (frozen)
        freeStock: [],
        transferIn: [],
        transferOut: [],
        disappeared: [],
        reappeared: [],
        stayed: [],
        stayedOutside: [],
        carryover: [],
        newVinAny: [],
        dailyUniqueRESAge0List: [],
        resTotal: 0,
        dailyUniqueRESAge0: 0,
        age0Target: 0,        // alias of dailyUniqueRESAge0 (UI)
        age0All: 0,
        age0ResFrozen: 0,     // alias
        prevResTotal: prev ? [...prev.byVin.values()].filter((r) => r.isTarget).length : 0,
        newPlanAllocations: 0,
        freeStockCount: 0,
        cumulativePlanAllocations: 0,
        remaining: 0,
        progress: 0,
      };

      // First-seen maps BEFORE crediting (same-day first area can establish RES)
      byVin.forEach((r) => {
        noteFirstSeen(r.vin, r, dateKey);
        everSeen.add(r.vin);
      });

      // Daily unique RES Age 0 — independent of 315 rules
      byVin.forEach((r) => {
        if (r.allocationAge === 0) dayStats.age0All += 1;
        if (isRES(r) && isAge0(r)) {
          dayStats.dailyUniqueRESAge0 += 1;
          dayStats.age0Target += 1;
          dayStats.age0ResFrozen += 1;
          dayStats.dailyUniqueRESAge0List.push(r);
        }
        if (r.isTarget) dayStats.resTotal += 1;
        if (!vinHistory.has(r.vin)) vinHistory.set(r.vin, []);
        vinHistory.get(r.vin).push({ ...r, snapshotDate: dateKey });
      });

      if (dateKey === dateKeys[dateKeys.length - 1]) {
        age0ByArea.clear();
        byVin.forEach((r) => {
          if (r.allocationAge !== 0) return;
          const area = r.searchArea || "(blank)";
          age0ByArea.set(area, (age0ByArea.get(area) || 0) + 1);
        });
      }

      if (!prev) {
        byVin.forEach((r) => {
          if (r.isTarget) {
            everEnteredRes.add(r.vin);
            dayStats.newRes.push(r); // opening RES = New RES for recon
            const bucket = tryCredit(r.vin, r, dateKey, dayStats);
            if (bucket === "plan") {
              movements.push(makeMovement(dateKey, null, r, "NEW ALLOCATION"));
            } else if (bucket === "free") {
              dayStats.carryover.push(r);
              dayStats.stayed.push(r);
              movements.push(makeMovement(dateKey, null, r, "FREE STOCK / PRIOR MONTH"));
            } else {
              dayStats.carryover.push(r);
              dayStats.stayed.push(r);
              movements.push(makeMovement(dateKey, null, r, "STAYED IN RES"));
            }
          } else {
            dayStats.newVinAny.push(r);
            dayStats.stayedOutside.push(r);
            movements.push(makeMovement(dateKey, null, r, "STAYED OUTSIDE RES"));
          }
        });
      } else {
        const prevMap = prev.byVin;
        const allVins = new Set([...prevMap.keys(), ...byVin.keys()]);
        allVins.forEach((vin) => {
          const a = prevMap.get(vin) || null;
          const b = byVin.get(vin) || null;

          if (!a && b) {
            const wasGone = disappearedEver.has(vin);
            noteFirstSeen(vin, b, dateKey);
            if (wasGone) {
              dayStats.reappeared.push(b);
              if (b.isTarget) {
                everEnteredRes.add(vin);
                dayStats.newRes.push(b);
                const bucket = tryCredit(vin, b, dateKey, dayStats);
                if (bucket === "plan") {
                  /* credited */
                } else if (bucket === "free") {
                  /* free */
                } else if (!firstAreaWasRes(vin)) {
                  dayStats.transferIn.push(b);
                  addCorridor(corridor, "(re-appeared)", b.searchArea);
                }
              }
              movements.push(makeMovement(dateKey, null, b, b.isTarget ? "RE-APPEARED" : "RE-APPEARED"));
              return;
            }

            if (b.isTarget) {
              everEnteredRes.add(vin);
              dayStats.newRes.push(b);
              const bucket = tryCredit(vin, b, dateKey, dayStats);
              if (bucket === "plan") {
                movements.push(makeMovement(dateKey, null, b, "NEW ALLOCATION"));
              } else if (bucket === "free") {
                dayStats.carryover.push(b);
                movements.push(makeMovement(dateKey, null, b, "FREE STOCK / PRIOR MONTH"));
              } else if (!firstAreaWasRes(vin)) {
                // Should not happen for first-seen — first area is this record
                dayStats.transferIn.push(b);
                addCorridor(corridor, "(first seen)", b.searchArea);
                movements.push(makeMovement(dateKey, null, b, "TRANSFERRED INTO RES"));
              } else {
                dayStats.stayed.push(b);
                movements.push(makeMovement(dateKey, null, b, "STAYED IN RES"));
              }
            } else {
              dayStats.newVinAny.push(b);
              dayStats.stayedOutside.push(b);
              movements.push(makeMovement(dateKey, null, b, "STAYED OUTSIDE RES"));
            }
            return;
          }

          if (a && !b) {
            disappearedEver.add(vin);
            // Do NOT re-evaluate plan from later days — historical freeze.
            // Only try credit using the LAST observation's own date (already processed).
            dayStats.disappeared.push(a);
            movements.push(makeMovement(dateKey, a, null, "DISAPPEARED"));
            return;
          }

          if (a && b) {
            if (!a.isTarget && b.isTarget) {
              // Transfer into RES — NEVER a plan receipt (firstArea was non-RES)
              everEnteredRes.add(vin);
              dayStats.transferIn.push(b);
              addCorridor(corridor, a.searchArea, b.searchArea);
              tryCredit(vin, b, dateKey, dayStats, { fromOtherArea: true });
              movements.push(makeMovement(dateKey, a, b, "TRANSFERRED INTO RES"));
            } else if (a.isTarget && !b.isTarget) {
              everEnteredRes.add(vin);
              dayStats.transferOut.push(b);
              addCorridor(corridor, a.searchArea, b.searchArea);
              movements.push(makeMovement(dateKey, a, b, "TRANSFERRED OUT OF RES"));
            } else if (a.isTarget && b.isTarget) {
              dayStats.stayed.push(b);
              // May still qualify if earlier days missed age-0 same-day (rare); uses TODAY's row
              tryCredit(vin, b, dateKey, dayStats);
              movements.push(makeMovement(dateKey, a, b, "STAYED IN RES"));
            } else {
              dayStats.stayedOutside.push(b);
              if (a.searchArea !== b.searchArea) {
                addCorridor(corridor, a.searchArea, b.searchArea);
              }
              movements.push(makeMovement(dateKey, a, b, "STAYED OUTSIDE RES"));
            }
          }
        });
      }

      // Reconciliation: Expected = Yesterday + New RES + Transfer IN − Transfer OUT − Disappeared RES
      const disappearedRES = dayStats.disappeared.filter((r) => r.isTarget);
      const disappearedTarget = disappearedRES.length;
      const newResCount = dayStats.newRes.length;
      const impliedRes = dayStats.prevResTotal
        + newResCount
        + dayStats.transferIn.length
        - dayStats.transferOut.length
        - disappearedTarget;

      // VIN-level recon reasons when mismatch
      const reconReasons = [];
      if (prev) {
        const expectedSet = new Set();
        prev.byVin.forEach((r, vin) => {
          if (r.isTarget) expectedSet.add(vin);
        });
        dayStats.newRes.forEach((r) => expectedSet.add(r.vin));
        dayStats.transferIn.forEach((r) => expectedSet.add(r.vin));
        dayStats.transferOut.forEach((r) => expectedSet.delete(r.vin));
        disappearedRES.forEach((r) => expectedSet.delete(r.vin));

        const actualSet = new Set();
        byVin.forEach((r, vin) => {
          if (r.isTarget) actualSet.add(vin);
        });
        expectedSet.forEach((vin) => {
          if (!actualSet.has(vin)) {
            reconReasons.push({ vin, reason: "expected RES but missing from today's RES set" });
          }
        });
        actualSet.forEach((vin) => {
          if (!expectedSet.has(vin)) {
            reconReasons.push({ vin, reason: "in today's RES but not explained by yesterday+new+in−out−gone" });
          }
        });
      }

      dayStats.disappearedTarget = disappearedTarget;
      dayStats.disappearedRES = disappearedTarget;
      dayStats.impliedRes = impliedRes;
      dayStats.expectedRES = impliedRes;
      dayStats.actualRES = dayStats.resTotal;
      dayStats.reconDiff = dayStats.resTotal - impliedRes;
      dayStats.reconOk = dayStats.reconDiff === 0;
      dayStats.reconReasons = reconReasons;

      dayStats.newPlanAllocations = dayStats.planReceipts.length;
      dayStats.freeStockCount = dayStats.freeStock.length;
      dayStats.cumulativePlanAllocations = planReceiptVins.size;
      dayStats.remaining = Math.max(0, plan - planReceiptVins.size);
      dayStats.progress = plan > 0 ? planReceiptVins.size / plan : 0;
      dayStats.currentRES = dayStats.resTotal;
      dayStats.transferredIntoRES = dayStats.transferIn.length;
      dayStats.transferredOutOfRES = dayStats.transferOut.length;
      // One daily row per RTL file. Allocation count never decides whether the date exists.
      const storedDate = String((snap && (snap.asOfDate || snap.date)) || "");
      dayStats.fileName = String((snap && snap.fileName) || "");
      dayStats.storedDate = /^\d{4}-\d{2}-\d{2}/.test(storedDate) ? storedDate.slice(0, 10) : dateKey;
      dayStats.sheetUsed = String((snap && snap.sheetName) || "Sheet 1");
      dayStats.totalRows = Array.isArray(snap && snap.vehicles) ? snap.vehicles.length : 0;
      dayStats.uniqueVins = byVin.size;
      dayStats.resRows = [];
      dayStats.fileDayReceipts = [];
      byVin.forEach((r) => {
        if (isRES(r)) dayStats.resRows.push(r);
        if (isPlanScheduleReceipt(r, dateKey)) dayStats.fileDayReceipts.push(r);
      });

      daily.push(dayStats);
      latestTarget = new Map([...byVin].filter(([, r]) => r.isTarget));
      prev = { dateKey, byVin };
    });

    const latestKey = dateKeys.length ? dateKeys[dateKeys.length - 1] : "";
    const latestSnap = latestKey ? snapshotRows(days[latestKey], latestKey) : null;
    if (latestSnap) {
      age0ByArea.clear();
      latestSnap.byVin.forEach((r) => {
        if (r.allocationAge !== 0) return;
        const area = r.searchArea || "(blank)";
        age0ByArea.set(area, (age0ByArea.get(area) || 0) + 1);
      });
    }

    const currentRes = latestTarget.size;
    const allocated = planReceiptVins.size;
    const freeStock = freeStockVins.size;
    const totalReceived = allocated + freeStock;
    const remaining = Math.max(0, plan - allocated);
    const progress = plan > 0 ? allocated / plan : 0;
    const latestDay = daily.length ? daily[daily.length - 1] : null;
    const prevDay = daily.length > 1 ? daily[daily.length - 2] : null;

    const byProduct = new Map();
    const bySuffix = new Map();
    const byAge = new Map();
    const byExt = new Map();
    const byStatus = new Map();
    latestTarget.forEach((r) => {
      byProduct.set(r.product, (byProduct.get(r.product) || 0) + 1);
      bySuffix.set(r.suffix, (bySuffix.get(r.suffix) || 0) + 1);
      const ab = ageBucket(r.allocationAge);
      byAge.set(ab, (byAge.get(ab) || 0) + 1);
      byExt.set(r.ext || "—", (byExt.get(r.ext || "—") || 0) + 1);
      byStatus.set(r.status || "—", (byStatus.get(r.status || "—") || 0) + 1);
    });

    const transferInAll = movements.filter((m) => m.movementType === "TRANSFERRED INTO RES");
    const transferOutAll = movements.filter((m) => m.movementType === "TRANSFERRED OUT OF RES");
    const disappearedAll = movements.filter((m) => m.movementType === "DISAPPEARED");
    const newAllocAll = movements.filter((m) => m.movementType === "NEW ALLOCATION");

    const age0Target = latestSnap
      ? [...latestSnap.byVin.values()].filter((r) => isRES(r) && isAge0(r)).length
      : 0;
    const age0Total = latestSnap
      ? [...latestSnap.byVin.values()].filter((r) => r.allocationAge === 0).length
      : 0;

    // Unmatched product/SFX among plan receipts (for quality)
    if (typeof global.matchRtlToAllocLeaf === "function") {
      planReceiptMeta.forEach((r) => {
        const leaf = global.matchRtlToAllocLeaf({ product: r.product, suffix: r.suffix });
        if (!leaf) qualityTotals.unmatchedProductSfx += 1;
      });
    }

    const qualityScore = Math.max(0, Math.min(100, Math.round(
      100 - Math.min(40, qualityTotals.duplicateVin * 2)
        - Math.min(20, qualityTotals.blankVin)
        - Math.min(15, qualityTotals.missingArea * 0.05)
        - Math.min(15, qualityTotals.ageMismatch * 0.5)
        - Math.min(10, qualityTotals.conflictingRecords * 2)
    )));

    const lists = {
      allocated: [...planReceiptVins].map((vin) => planReceiptMeta.get(vin) || (vinHistory.get(vin) || []).slice(-1)[0] || { vin }),
      freeStock: [...freeStockVins].map((vin) => freeStockMeta.get(vin) || (vinHistory.get(vin) || []).slice(-1)[0] || { vin }),
      transferIn: transferInAll,
      transferOut: transferOutAll,
      disappeared: disappearedAll,
      newAlloc: newAllocAll,
      current: [...latestTarget.values()],
      age0: latestSnap
        ? [...latestSnap.byVin.values()].filter((r) => isRES(r) && isAge0(r))
        : [],
      everEntered: [...everEnteredRes].map((vin) => {
        const hist = vinHistory.get(vin) || [];
        return hist[hist.length - 1] || { vin };
      }),
    };

    const dayByKey = new Map(daily.map((d) => [d.dateKey, d]));
    const chartExtraDays = [];
    const extraByKey = new Map();
    const creditedVin = new Set();
    daily.forEach((d) => {
      (d.resRows || []).forEach((r) => {
        const credit = newCarCreditKey(r, d.dateKey);
        if (!credit || credit === d.dateKey) return;
        const mark = `${r.vin}|${credit}`;
        if (creditedVin.has(mark)) return;
        creditedVin.add(mark);
        let target = dayByKey.get(credit);
        if (!target) {
          target = extraByKey.get(credit);
          if (!target) {
            const creditDate = fileDateFromKey(credit);
            target = {
              dateKey: credit,
              label: creditDate
                ? creditDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                : credit,
              fileDayReceipts: [],
              carriedOnly: true,
            };
            extraByKey.set(credit, target);
            chartExtraDays.push(target);
          }
        }
        if ((target.fileDayReceipts || []).some((x) => x.vin === r.vin)) return;
        target.fileDayReceipts.push(r);
      });
    });

    enrichRowsWithSalesRaw(lists.allocated);
    enrichRowsWithSalesRaw(lists.freeStock);
    enrichRowsWithSalesRaw(lists.current);
    enrichRowsWithSalesRaw(lists.age0);
    daily.forEach((d) => {
      enrichRowsWithSalesRaw(d.planReceipts);
      enrichRowsWithSalesRaw(d.fileDayReceipts);
      enrichRowsWithSalesRaw(d.resRows);
      enrichRowsWithSalesRaw(d.transferOut);
      enrichRowsWithSalesRaw(d.transferIn);
      enrichRowsWithSalesRaw(d.newRes);
      enrichRowsWithSalesRaw(d.dailyUniqueRESAge0List);
    });
    chartExtraDays.forEach((d) => enrichRowsWithSalesRaw(d.fileDayReceipts));
    const missingDates = missingSnapshotDates(dateKeys);
    const rtlFiles = daily.map((d) => ({
      fileName: d.fileName || "",
      dateKey: d.dateKey,
      storedDate: d.storedDate || d.dateKey,
      sheetUsed: d.sheetUsed || "Sheet 1",
      totalRows: d.totalRows || 0,
      uniqueVins: d.uniqueVins || 0,
      res: (d.resRows || []).length,
      allocation: (d.planReceipts || []).length,
    }));

    const planTrackerDebug = daily.map((d) => ({
      date: d.dateKey,
      dailyUniqueRESAge0: d.dailyUniqueRESAge0,
      planReceipts: d.planReceipts.map((r) => r.vin),
      planReceiptCount: d.planReceipts.length,
      freeStock: d.freeStock.map((r) => r.vin),
      freeStockCount: d.freeStock.length,
      transferredIntoRES: d.transferIn.map((r) => r.vin),
      transferredOutOfRES: d.transferOut.map((r) => r.vin),
      disappearedRES: (d.disappeared || []).filter((r) => r.isTarget).map((r) => r.vin),
      currentRES: d.resTotal,
      cumulativePlanReceipts: d.cumulativePlanAllocations,
      remaining: d.remaining,
      progress: d.progress,
      reconciliation: {
        expectedRES: d.expectedRES,
        actualRES: d.actualRES,
        difference: d.reconDiff,
        ok: d.reconOk,
        reasons: d.reconReasons || [],
      },
    }));

    const model = {
      plan,
      target: TARGET_SEARCH_AREA,
      monthKey,
      dateKeys,
      latestKey,
      daily,
      chartExtraDays,
      missingDates,
      rtlFiles,
      movements,
      vinHistory,
      firstSeenDateByVin,
      firstAreaByVin,
      firstRecordByVin,
      planReceiptVins,
      freeStockVins,
      corridor: [...corridor.entries()].map(([k, n]) => ({ path: k, count: n })).sort((a, b) => b.count - a.count),
      age0ByArea: [...age0ByArea.entries()].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count),
      inventory: {
        byProduct: mapToSorted(byProduct),
        bySuffix: mapToSorted(bySuffix),
        byAge: mapToSorted(byAge, ["0", "1", "2", "3", "4", "5", "6-9", "10+", "blank"]),
        byExt: mapToSorted(byExt),
        byStatus: mapToSorted(byStatus),
        rows: [...latestTarget.values()],
      },
      kpis: {
        plan,
        allocated,
        freeStock,
        totalReceived,
        remaining,
        progress,
        currentRes,
        age0Target,
        age0Total,
        dailyUniqueRESAge0: age0Target,
        transferIn: transferInAll.length,
        transferOut: transferOutAll.length,
        net: transferInAll.length - transferOutAll.length,
        disappeared: disappearedAll.length,
        newAlloc: newAllocAll.length,
      },
      lists,
      latestDay,
      prevDay,
      quality: qualityTotals,
      qualityScore,
      matrix: buildMatrix(transferInAll, transferOutAll),
      planTrackerDebug,
    };

    lastModel = model;
    try {
      global.planTrackerDebug = planTrackerDebug;
      global.planTrackerModel = model;
      if (!(opts && opts.silent) && typeof console !== "undefined" && console.info) {
        console.info("[PlanTracker] planTrackerDebug", planTrackerDebug);
        console.info("[PlanTracker] KPIs", {
          allocated,
          freeStock,
          totalReceived,
          remaining,
          progress,
          dailyUniqueRESAge0: age0Target,
          currentRes,
        });
      }
    } catch (_) { /* ignore */ }

    return model;
  }

  function mapToSorted(map, order) {
    const arr = [...map.entries()].map(([k, v]) => ({ key: k, count: v }));
    if (order) {
      arr.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    } else {
      arr.sort((a, b) => b.count - a.count);
    }
    return arr;
  }

  function addCorridor(map, from, to) {
    const a = from || "(blank)";
    const b = to || "(blank)";
    const key = `${a} → ${b}`;
    map.set(key, (map.get(key) || 0) + 1);
  }

  function makeMovement(dateKey, prev, curr, movementType) {
    return {
      snapshotDate: dateKey,
      date: dateKey,
      vin: (curr && curr.vin) || (prev && prev.vin) || "",
      product: (curr && curr.product) || (prev && prev.product) || "—",
      suffix: (curr && curr.suffix) || (prev && prev.suffix) || "—",
      year: (curr && curr.year) || (prev && prev.year) || "",
      ext: (curr && curr.ext) || (prev && prev.ext) || "",
      int: (curr && curr.int) || (prev && prev.int) || "",
      previousSearchArea: prev ? prev.searchArea : "—",
      currentSearchArea: curr ? curr.searchArea : "—",
      previousArea: prev ? prev.searchArea : "—",
      currentArea: curr ? curr.searchArea : "—",
      previousIsRES: !!(prev && prev.isTarget),
      currentIsRES: !!(curr && curr.isTarget),
      previousAllocationDate: prev ? prev.allocationDate : null,
      currentAllocationDate: curr ? curr.allocationDate : null,
      previousAllocationAge: prev ? prev.allocationAge : null,
      currentAllocationAge: curr ? curr.allocationAge : null,
      movementType,
      previousStatus: prev ? prev.status : "",
      currentStatus: curr ? curr.status : "",
      location: (curr && curr.location) || (prev && prev.location) || "—",
    };
  }

  function buildMatrix(ins, outs) {
    const areas = new Set([TARGET_SEARCH_AREA]);
    [...ins, ...outs].forEach((m) => {
      if (m.previousSearchArea && m.previousSearchArea !== "—") areas.add(m.previousSearchArea);
      if (m.currentSearchArea && m.currentSearchArea !== "—") areas.add(m.currentSearchArea);
    });
    const cols = [...areas].slice(0, 8);
    const grid = {};
    cols.forEach((from) => {
      grid[from] = {};
      cols.forEach((to) => { grid[from][to] = 0; });
    });
    ins.forEach((m) => {
      const from = m.previousSearchArea;
      const to = m.currentSearchArea;
      if (grid[from] && grid[from][to] != null) grid[from][to] += 1;
    });
    outs.forEach((m) => {
      const from = m.previousSearchArea;
      const to = m.currentSearchArea;
      if (grid[from] && grid[from][to] != null) grid[from][to] += 1;
    });
    return { cols, grid };
  }

  function filteredMovements(model) {
    let rows = model.movements || [];
    if (view.snapDate) rows = rows.filter((r) => r.snapshotDate === view.snapDate);
    if (view.movement) rows = rows.filter((r) => r.movementType === view.movement);
    if (view.product) rows = rows.filter((r) => r.product === view.product);
    const q = String(view.q || "").trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const hay = `${r.vin} ${r.product} ${r.suffix} ${r.previousSearchArea} ${r.currentSearchArea} ${r.movementType}`.toLowerCase();
        return hay.includes(q);
      });
    }
    // Default focus: movements involving target (unless filter says otherwise)
    if (!view.movement && !q) {
      rows = rows.filter((r) =>
        r.movementType !== "STAYED IN RES"
        && r.movementType !== "AREA CHANGE"
        && (
          r.movementType.includes("RES")
          || r.movementType === "NEW ALLOCATION"
          || r.movementType === "DISAPPEARED"
          || r.movementType.startsWith("RE-APPEARED")
          || isTargetArea(r.previousSearchArea)
          || isTargetArea(r.currentSearchArea)
        )
      );
    }
    return rows;
  }

  function drillRows(model) {
    const key = view.drill;
    if (!key || !model) return [];
    if (key === "allocated") return model.lists.allocated;
    if (key === "freeStock") return model.lists.freeStock || [];
    if (key === "totalReceived") {
      return [...(model.lists.allocated || []), ...(model.lists.freeStock || [])];
    }
    if (key === "remaining") return []; // conceptual
    if (key === "current") return model.lists.current;
    if (key === "age0") return model.lists.age0;
    if (key === "transferIn") return model.lists.transferIn;
    if (key === "transferOut") return model.lists.transferOut;
    if (key === "disappeared") return model.lists.disappeared;
    if (key === "newAlloc") return model.lists.newAlloc;
    if (key === "net") return [...model.lists.transferIn, ...model.lists.transferOut];
    return [];
  }

  function renderKpis(model) {
    const el = $("#pt-kpis");
    if (!el) return;
    const k = model.kpis;
    const items = [
      ["plan", "Allocation Plan", k.plan, `Target ${esc(TARGET_SEARCH_AREA)}`, ""],
      ["allocated", "This month allocated", k.allocated, `True 315 receipts · RES · Age 0 · AG = file day · first seen as RES`, "ok"],
      ["freeStock", "Free stock (prior month)", k.freeStock || 0, "RES · Age 0 · AG before this month · excluded from 315", "warn"],
      ["totalReceived", "Total received", k.totalReceived || (k.allocated + (k.freeStock || 0)), "Allocated + free stock (not transfers / daily RES)", "info"],
      ["remaining", "Remaining", k.remaining, `${Math.min(100, Math.round(k.progress * 100))}% of plan`, k.remaining ? "warn" : "ok"],
      ["current", "RES Current", k.currentRes, "Unique RES VINs in latest snapshot", "ok"],
      ["age0", "Daily RES Age 0", k.age0Target, `Latest snapshot · independent of 315 · all areas Age 0: ${num(k.age0Total)}`, "info"],
      ["newAlloc", "New Allocations", k.newAlloc, "NEW ALLOCATION movements (true plan receipts)", "ok"],
      ["transferIn", "Transfers IN", k.transferIn, "Other area → RES (never counted as 315)", "info"],
      ["transferOut", "Transfers OUT", k.transferOut, "RES → other area", "warn"],
      ["net", "Net Movement", k.net, "IN − OUT", k.net >= 0 ? "ok" : "bad"],
      ["disappeared", "Disappeared", k.disappeared, "Missing from next snapshot", "bad"],
    ];
    el.innerHTML = items.map(([id, lab, val, sub, cls]) => {
      const active = (view.drill === id || (id === "totalReceived" && view.drill === "progress")) ? " is-active" : "";
      const clickable = id !== "plan" && id !== "remaining";
      const tag = clickable ? "button" : "article";
      const attrs = clickable
        ? `type="button" data-pt-kpi="${id}"`
        : `data-pt-kpi="${id}"`;
      return `<${tag} class="bo-kpi pt-kpi${active}${cls ? ` ${cls}` : ""}" ${attrs}>
        <div class="lab">${lab}</div>
        <div class="val">${num(val)}</div>
        <div class="sub">${sub}</div>
      </${tag}>`;
    }).join("");

    $$("[data-pt-kpi]", el).forEach((btn) => {
      if (btn.tagName !== "BUTTON") return;
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-pt-kpi") || "";
        view.drill = view.drill === id ? "" : id;
        renderDrill(model);
        renderKpis(model);
        renderProgress(model);
      });
    });
  }

  function totalReceivedRows(model) {
    const seen = new Set();
    const rows = [];
    [...(model.lists.allocated || []), ...(model.lists.freeStock || [])].forEach((r) => {
      if (!r || !r.vin || seen.has(r.vin)) return;
      seen.add(r.vin);
      const inPlan = (model.lists.allocated || []).some((x) => x && x.vin === r.vin);
      rows.push({
        ...r,
        bucket: inPlan ? "This month" : "Free stock",
      });
    });
    return rows;
  }

  function productBreakdown(rows) {
    const byProduct = new Map();
    const byModel = new Map(); // product + suffix
    (rows || []).forEach((r) => {
      const product = r.product || "—";
      const sfx = r.suffix || "—";
      const modelKey = `${product} · ${sfx}`;
      byProduct.set(product, (byProduct.get(product) || 0) + 1);
      byModel.set(modelKey, (byModel.get(modelKey) || 0) + 1);
    });
    return {
      byProduct: [...byProduct.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
      byModel: [...byModel.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    };
  }

  function renderDrill(model) {
    const wrap = $("#pt-drill");
    const table = $("#pt-drill-table");
    const title = $("#pt-drill-title");
    if (!wrap || !table) return;
    if (!view.drill) {
      wrap.hidden = true;
      view.scheduleList = null;
      view.scheduleTitle = "";
      return;
    }

    if (view.drill === "schedule") {
      const rows = Array.isArray(view.scheduleList) ? view.scheduleList : [];
      wrap.hidden = false;
      if (title) title.textContent = view.scheduleTitle || "Schedule VINs";
      if (!rows.length) {
        table.innerHTML = `<p class="foot" style="padding:12px">No VINs in this cell.</p>`;
        try { wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) { /* ignore */ }
        return;
      }
      table.innerHTML = `<table class="bas-table">
        <thead><tr>
          <th>VIN</th><th>Product</th><th>SFX</th><th>Alloc Date</th>
          <th class="num">Age</th><th>Search Area</th><th>Location</th><th>Sales Raw</th>
        </tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="mono">${esc(r.vin)}</td>
          <td>${esc(r.product || "—")}</td>
          <td>${esc(r.suffix || "—")}</td>
          <td>${esc(fmtDate(r.allocationDate))}</td>
          <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
          <td>${esc(r.searchArea || "—")}</td>
          <td>${esc(r.location || "—")}</td>
          <td>${esc(r.deliveryStatus || r.salesLabel || "—")}</td>
        </tr>`).join("")}</tbody>
      </table>
      <p class="foot">${num(rows.length)} VIN(s) · Col P = Proforma · Col V = Delivered</p>`;
      try { wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) { /* ignore */ }
      return;
    }

    const isProgress = view.drill === "progress" || view.drill === "totalReceived";
    const rows = isProgress ? totalReceivedRows(model) : drillRows(model);
    const labels = {
      progress: "All received VINs · product & model totals",
      allocated: "RES · Col J = 0 · AG = file day · first seen as RES (toward 315)",
      freeStock: "Free stock · prior / last month Allocation Date",
      totalReceived: "Total received (this month + free stock · excludes transfers in)",
      current: "Current RES inventory",
      age0: "Age 0 · Retail Electronic Sales",
      newAlloc: "New allocations · first seen as RES",
      transferIn: "Transfers INTO RES (from other area · not counted as received)",
      transferOut: "Transfers OUT OF RES (gone from me → other area)",
      disappeared: "Disappeared",
      net: "Net movement (IN + OUT events)",
    };
    wrap.hidden = false;
    if (title) title.textContent = labels[view.drill] || view.drill;
    if (!rows.length) {
      table.innerHTML = `<p class="foot" style="padding:12px">No VINs in this bucket.</p>`;
      return;
    }

    let summaryHtml = "";
    if (isProgress || view.drill === "allocated" || view.drill === "freeStock" || view.drill === "current") {
      const br = productBreakdown(rows);
      summaryHtml = `
        <div class="pt-drill-summary">
          <div class="pt-drill-summary-card">
            <h4>By product <span class="badge">${num(br.byProduct.length)}</span></h4>
            <table class="bas-table"><thead><tr><th>Product</th><th class="num">VINs</th></tr></thead>
            <tbody>${br.byProduct.map((r) => `<tr><td>${esc(r.key)}</td><td class="num"><b>${num(r.count)}</b></td></tr>`).join("")}
            <tr class="bas-row-total"><td><b>Total</b></td><td class="num"><b>${num(rows.length)}</b></td></tr>
            </tbody></table>
          </div>
          <div class="pt-drill-summary-card">
            <h4>By product · model (SFX) <span class="badge">${num(br.byModel.length)}</span></h4>
            <table class="bas-table"><thead><tr><th>Product · SFX</th><th class="num">VINs</th></tr></thead>
            <tbody>${br.byModel.map((r) => `<tr><td>${esc(r.key)}</td><td class="num"><b>${num(r.count)}</b></td></tr>`).join("")}
            <tr class="bas-row-total"><td><b>Total</b></td><td class="num"><b>${num(rows.length)}</b></td></tr>
            </tbody></table>
          </div>
        </div>`;
    }

    const isMove = !isProgress && rows[0] && rows[0].movementType;
    const showBucket = isProgress;
    table.innerHTML = `${summaryHtml}
      <h4 class="pt-drill-vin-head">VIN list · ${num(rows.length)}</h4>
      <table class="bas-table">
      <thead><tr>
        <th>VIN</th><th>Product</th><th>SFX</th>
        ${isMove ? "<th>From</th><th>To</th><th>Movement</th><th>Snapshot</th>"
          : `${showBucket ? "" : "<th>Search Area</th>"}<th>Alloc Date</th><th class="num">Age</th>${showBucket ? "<th>Bucket</th>" : ""}<th>Location</th><th>Sales Raw</th>`}
      </tr></thead>
      <tbody>${rows.slice(0, 800).map((r) => {
        if (isMove) {
          return `<tr>
            <td class="mono">${esc(r.vin)}</td>
            <td>${esc(r.product)}</td>
            <td>${esc(r.suffix)}</td>
            <td>${esc(r.previousSearchArea)}</td>
            <td>${esc(r.currentSearchArea)}</td>
            <td><span class="badge">${esc(r.movementType)}</span></td>
            <td>${esc(r.snapshotDate)}</td>
          </tr>`;
        }
        return `<tr>
          <td class="mono">${esc(r.vin)}</td>
          <td>${esc(r.product || "—")}</td>
          <td>${esc(r.suffix || "—")}</td>
          ${showBucket ? "" : `<td>${esc(r.searchArea || "—")}</td>`}
          <td>${esc(fmtDate(r.allocationDate))}</td>
          <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
          ${showBucket ? `<td><span class="badge ${r.bucket === "This month" ? "ok" : "warn"}">${esc(r.bucket || "—")}</span></td>` : ""}
          <td>${esc(r.location || "—")}</td>
          <td>${esc(r.deliveryStatus || r.salesLabel || "—")}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
    <p class="foot">${num(rows.length)} VIN(s)${rows.length > 800 ? " · showing first 800" : ""} · Col P = Proforma · Col V = Delivered</p>`;

    try { wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) { /* ignore */ }
  }

  function renderProgress(model) {
    const el = $("#pt-progress");
    if (!el) return;
    const k = model.kpis;
    const pct = Math.min(100, Math.round(k.progress * 1000) / 10);
    const over = k.allocated > k.plan;
    const free = k.freeStock || 0;
    const total = k.totalReceived != null ? k.totalReceived : (k.allocated + free);
    const active = (view.drill === "progress" || view.drill === "totalReceived") ? " is-active" : "";
    el.innerHTML = `
      <button type="button" class="pt-progress-btn${active}" id="pt-progress-open" title="Click to see all VINs and product totals">
        <div class="pt-progress-head">
          <strong>Allocation progress</strong>
          <span>${num(k.allocated)} / ${num(k.plan)} · Remaining ${num(k.remaining)}${over ? ` · <span class="badge warn">Over plan +${num(k.allocated - k.plan)}</span>` : ""}</span>
        </div>
        <div class="pt-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="pt-progress-fill" style="width:${pct}%"></div>
        </div>
        <p class="foot" style="margin:8px 0 0">
          This month ${num(k.allocated)} · Free stock ${num(free)} · <strong>Total received ${num(total)}</strong>
          · Progress ${pct}%
          · <span class="pt-progress-hint">Click for all VINs · product &amp; model totals</span>
        </p>
      </button>`;
    const btn = $("#pt-progress-open");
    if (btn) {
      btn.addEventListener("click", () => {
        view.drill = view.drill === "progress" ? "" : "progress";
        renderDrill(model);
        renderProgress(model);
        renderKpis(model);
      });
    }
  }

  function monthLength(monthKey) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
    if (!m) return 31;
    return new Date(Number(m[1]), Number(m[2]), 0).getDate();
  }

  function emptyDayVins() {
    const arr = Array(32);
    for (let i = 0; i < 32; i += 1) arr[i] = [];
    return arr;
  }

  function adminPlanTotal() {
    const rows = global.ALLOCATION_ROWS || [];
    const values = global.allocationValues || {};
    let sum = 0;
    let any = false;
    rows.forEach((r) => {
      if (!r || r.kind !== "leaf") return;
      any = true;
      sum += Number(values[r.id]) || 0;
    });
    return any ? sum : ALLOCATION_PLAN;
  }

  function buildScheduleRows(model) {
    const allocRows = global.ALLOCATION_ROWS || [];
    const values = global.allocationValues || {};
    const matchLeaf = typeof global.matchRtlToAllocLeaf === "function"
      ? global.matchRtlToAllocLeaf
      : () => null;
    const byLeaf = new Map();
    const unmatched = {
      id: "__unmatched__",
      seg: "—",
      product: "(unmatched)",
      sfx: "—",
      allocation: 0,
      dayCounts: Array(32).fill(0),
      dayVins: emptyDayVins(),
      mtd: 0,
      mtdVins: [],
      seen: new Set(),
    };

    allocRows.forEach((leaf) => {
      if (leaf.kind !== "leaf") return;
      byLeaf.set(leaf.id, {
        id: leaf.id,
        seg: leaf.seg || "—",
        product: leaf.product || "—",
        sfx: leaf.sfx || "—",
        allocation: Number(values[leaf.id]) || 0,
        dayCounts: Array(32).fill(0),
        dayVins: emptyDayVins(),
        mtd: 0,
        mtdVins: [],
        seen: new Set(),
      });
    });

    (model.daily || []).forEach((day) => {
      const snapDay = Number(String(day.dateKey).slice(8, 10));
      const list = (day.planReceipts && day.planReceipts.length)
        ? day.planReceipts
        : [];
      list.forEach((r) => {
        const vin = r.vin;
        if (!vin) return;
        // Only age-0 RES with AG on this file day (already filtered into planReceipts)
        if (!isPlanScheduleReceipt(r, day.dateKey)) return;
        const placeDay = snapDay;
        const dim = monthLength(model.monthKey);
        if (!Number.isFinite(placeDay) || placeDay < 1 || placeDay > dim) return;

        const leaf = matchLeaf({ product: r.product, suffix: r.suffix });
        const row = leaf && byLeaf.has(leaf.id) ? byLeaf.get(leaf.id) : unmatched;
        if (row.seen.has(vin)) return;
        row.seen.add(vin);
        row.dayCounts[placeDay] += 1;
        row.dayVins[placeDay].push(r);
        row.mtd += 1;
        row.mtdVins.push(r);
      });
    });

    const rows = [...byLeaf.values()]
      .filter((r) => r.allocation > 0 || r.mtd > 0)
      .sort((a, b) => String(a.seg).localeCompare(String(b.seg))
        || String(a.product).localeCompare(String(b.product))
        || String(a.sfx).localeCompare(String(b.sfx)));
    if (unmatched.mtd > 0) rows.push(unmatched);
    return rows;
  }

  function showScheduleVinDrill(model, list, titleText) {
    view.scheduleTitle = titleText || "Schedule VINs";
    view.scheduleList = Array.isArray(list) ? list : [];
    view.vinPin = new Set(view.scheduleList.map((r) => r && r.vin).filter(Boolean));
    view.tab = "all";
    view.status = "";
    const modal = $("#pt-schedule-modal");
    if (modal) modal.hidden = true;
    if (isTower()) {
      const cc = controlCenter(model);
      const byVin = new Map(cc.register.map((r) => [r.vin, r]));
      const rows = view.scheduleList.map((r) => byVin.get(r.vin) || r).filter(Boolean);
      openVinResults(titleText || "Schedule VINs", `${rows.length} VIN(s) from this schedule cell`, rows);
      return;
    }
    view.drill = "schedule";
    renderDrill(model);
    renderKpis(model);
    renderProgress(model);
  }

  function scheduleCellButton(n, attrs, extraCls) {
    if (!n) return "";
    return `<button type="button" class="pt-linknum pt-sched-num${extraCls ? ` ${extraCls}` : ""}" ${attrs}>${num(n)}</button>`;
  }

  function renderSchedule(model) {
    const tableEl = $("#pt-schedule-table");
    const footEl = $("#pt-schedule-foot");
    if (!tableEl) return;
    let rows = buildScheduleRows(model);
    if (view.product) rows = rows.filter((r) => r.product === view.product);
    if (view.sfx) rows = rows.filter((r) => r.sfx === view.sfx);
    model.scheduleRows = rows;
    const dim = monthLength(model.monthKey);
    const ctx = typeof global.basMonthContext === "function" ? global.basMonthContext() : null;
    const sameMonth = !!(ctx && ctx.monthKey && ctx.monthKey === model.monthKey);
    const todayDay = sameMonth && ctx.todayDay ? ctx.todayDay : 0;

    if (!rows.length) {
      tableEl.innerHTML = `<p class="foot" style="padding:12px">No plan-schedule rows yet. Upload day RTL files and set the Admin allocation plan.</p>`;
      if (footEl) footEl.textContent = "";
      return;
    }

    const dayHeaders = Array.from({ length: dim }, (_, i) => {
      const day = i + 1;
      const cls = day === todayDay ? "bas-day-col is-today" : day > todayDay ? "bas-day-col is-future" : "bas-day-col";
      return `<th class="${cls}">${day}</th>`;
    }).join("");

    const body = rows.map((r) => {
      const rowGap = r.allocation - r.mtd;
      const gapCls = rowGap > 0 ? "bas-gap-pos" : rowGap < 0 ? "bas-gap-neg" : "";
      const rowId = esc(r.id);
      const dayCells = Array.from({ length: dim }, (_, i) => {
        const day = i + 1;
        const n = r.dayCounts[day] || 0;
        const cls = day === todayDay ? "is-today" : "";
        return `<td class="num bas-day-cell ${cls}${n ? " has-val is-clickable" : ""}">${scheduleCellButton(n, `data-pt-sched-row="${rowId}" data-pt-sched-day="${day}"`)}</td>`;
      }).join("");
      return `<tr>
        <td>${esc(r.seg)}</td>
        <td>${esc(r.product)}</td>
        <td>${esc(r.sfx)}</td>
        <td class="num">${num(r.allocation)}</td>
        ${dayCells}
        <td class="num${r.mtd ? " has-val is-clickable" : ""}"><b>${scheduleCellButton(r.mtd, `data-pt-sched-row="${rowId}" data-pt-sched-day="mtd"`) || num(r.mtd)}</b></td>
        <td class="num ${gapCls}">${rowGap > 0 ? "+" : ""}${num(rowGap)}</td>
      </tr>`;
    }).join("");

    const totals = rows.reduce((acc, r) => {
      acc.mtd += r.mtd;
      acc.alloc += r.allocation;
      for (let d = 1; d <= dim; d += 1) {
        acc.days[d] = (acc.days[d] || 0) + (r.dayCounts[d] || 0);
        if (!acc.dayVins[d]) acc.dayVins[d] = [];
        (r.dayVins[d] || []).forEach((v) => acc.dayVins[d].push(v));
      }
      (r.mtdVins || []).forEach((v) => acc.mtdVins.push(v));
      return acc;
    }, { mtd: 0, alloc: 0, days: {}, dayVins: emptyDayVins(), mtdVins: [] });
    model.scheduleTotals = totals;

    const totalDayCells = Array.from({ length: dim }, (_, i) => {
      const day = i + 1;
      const n = totals.days[day] || 0;
      return `<td class="num bas-day-cell${n ? " has-val is-clickable" : ""}"><b>${scheduleCellButton(n, `data-pt-sched-row="__total__" data-pt-sched-day="${day}"`, "pt-sched-total") || ""}</b></td>`;
    }).join("");
    const totalGap = totals.alloc - totals.mtd;

    tableEl.innerHTML = `<table class="bas-table bas-month-grid">
      <thead><tr>
        <th>Seg</th><th>Product</th><th>SFX</th><th>Plan</th>
        ${dayHeaders}
        <th>MTD</th><th>Gap</th>
      </tr></thead>
      <tbody>${body}
      <tr class="bas-row-total">
        <td colspan="3"><b>Total</b></td>
        <td class="num"><b>${num(totals.alloc)}</b></td>
        ${totalDayCells}
        <td class="num${totals.mtd ? " has-val is-clickable" : ""}"><b>${scheduleCellButton(totals.mtd, `data-pt-sched-row="__total__" data-pt-sched-day="mtd"`, "pt-sched-total") || num(totals.mtd)}</b></td>
        <td class="num"><b>${totalGap > 0 ? "+" : ""}${num(totalGap)}</b></td>
      </tr>
      </tbody>
    </table>`;

    if (footEl) {
      footEl.textContent = `${num(totals.mtd)} age-0 same-day RES receipts (first seen as RES) · plan ${num(totals.alloc)} · gap ${totalGap > 0 ? "+" : ""}${num(totalGap)} · day totals frozen from each RTL file · click any number for VINs`;
    }

    $$("[data-pt-sched-row]", tableEl).forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rowId = btn.getAttribute("data-pt-sched-row") || "";
        const dayKey = btn.getAttribute("data-pt-sched-day") || "";
        let list = [];
        let label = "";
        if (rowId === "__total__") {
          if (dayKey === "mtd") {
            list = (model.scheduleTotals && model.scheduleTotals.mtdVins) || [];
            label = `Total · all MTD receipts · ${num(list.length)} VIN(s)`;
          } else {
            const day = Number(dayKey);
            list = (model.scheduleTotals && model.scheduleTotals.dayVins && model.scheduleTotals.dayVins[day]) || [];
            label = `Total · day ${day} · ${num(list.length)} VIN(s)`;
          }
        } else {
          const row = (model.scheduleRows || []).find((r) => r.id === rowId);
          if (!row) return;
          const prodLabel = row.product === "(unmatched)"
            ? "Unmatched"
            : `${row.product} · ${row.sfx}`;
          if (dayKey === "mtd") {
            list = row.mtdVins || [];
            label = `${prodLabel} · MTD · ${num(list.length)} VIN(s)`;
          } else {
            const day = Number(dayKey);
            list = (row.dayVins && row.dayVins[day]) || [];
            label = `${prodLabel} · day ${day} · ${num(list.length)} VIN(s)`;
          }
        }
        showScheduleVinDrill(model, list, label);
      });
    });
  }

  function renderFreeStock(model) {
    const totalEl = $("#pt-free-stock-total");
    const tableEl = $("#pt-free-stock-table");
    const footEl = $("#pt-free-stock-foot");
    const rows = (model.lists && model.lists.freeStock) || [];
    if (totalEl) totalEl.textContent = num(rows.length);
    if (!tableEl) return;
    if (!rows.length) {
      tableEl.innerHTML = `<p class="foot" style="padding:12px">No prior-month RES VINs — all receipts are in this month’s plan count.</p>`;
      if (footEl) footEl.textContent = "";
      return;
    }
    tableEl.innerHTML = `<table class="bas-table">
      <thead><tr>
        <th>VIN</th><th>Product</th><th>SFX</th><th>Alloc Date</th><th class="num">Age</th>
        <th>Search Area</th><th>Location</th><th>Status</th>
      </tr></thead>
      <tbody>${rows.slice(0, 400).map((r) => `<tr>
        <td class="mono">${esc(r.vin)}</td>
        <td>${esc(r.product || "—")}</td>
        <td>${esc(r.suffix || "—")}</td>
        <td>${esc(fmtDate(r.allocationDate))}</td>
        <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
        <td>${esc(r.searchArea || "—")}</td>
        <td>${esc(r.location || "—")}</td>
        <td>${esc(r.status || "—")}</td>
      </tr>`).join("")}</tbody>
    </table>`;
    if (footEl) {
      footEl.textContent = `${num(rows.length)} unique prior-month VIN(s) · excluded from 315 · total received = this month ${num(model.kpis.allocated)} + free stock ${num(rows.length)} = ${num(model.kpis.totalReceived)}`;
    }
  }

  function renderYesterday(model) {
    const el = $("#pt-yesterday");
    if (!el) return;
    const cur = model.latestDay;
    const prev = model.prevDay;
    if (!cur) {
      el.innerHTML = `<p class="foot">Upload day RTL files in Data Uploader to compare snapshots.</p>`;
      return;
    }
    const rows = [
      ["RES", prev ? prev.resTotal : "—", cur.resTotal],
      ["RES Age 0", prev ? (prev.dailyUniqueRESAge0 != null ? prev.dailyUniqueRESAge0 : prev.age0Target) : "—", cur.dailyUniqueRESAge0 != null ? cur.dailyUniqueRESAge0 : cur.age0Target],
      ["Plan alloc", prev ? (prev.newPlanAllocations != null ? prev.newPlanAllocations : ((prev.planReceipts && prev.planReceipts.length) || 0)) : "—", cur.newPlanAllocations != null ? cur.newPlanAllocations : ((cur.planReceipts && cur.planReceipts.length) || 0)],
      ["IN", prev ? prev.transferIn.length : "—", cur.transferIn.length],
      ["OUT", prev ? prev.transferOut.length : "—", cur.transferOut.length],
      ["Gone", prev ? (prev.disappearedTarget || 0) : "—", cur.disappearedTarget || 0],
    ];
    el.innerHTML = `
      <div class="pt-y-head">
        <strong>Today vs previous</strong>
        <span class="hint">${prev ? esc(prev.label) : "—"} → ${esc(cur.label)}</span>
      </div>
      <div class="pt-y-grid">
        ${rows.map(([lab, a, b]) => {
          const delta = (typeof a === "number" && typeof b === "number") ? b - a : null;
          const dCls = delta == null ? "" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
          const dTxt = delta == null ? "" : (delta > 0 ? `+${delta}` : String(delta));
          return `<div class="pt-y-card" title="${esc(lab)}">
            <span class="lab">${esc(lab)}</span>
            <div class="pt-y-vals"><span>${esc(String(a))}</span><span class="arrow">→</span><strong>${esc(String(b))}</strong>
            ${delta != null ? `<span class="delta ${dCls}">${dTxt}</span>` : ""}</div>
          </div>`;
        }).join("")}
      </div>
      ${cur.reconOk
        ? `<p class="foot pt-y-foot"><span class="badge ok">OK</span> · Expected RES = ${num(cur.prevResTotal)} + New ${num(cur.newRes.length)} + IN ${num(cur.transferIn.length)} − OUT ${num(cur.transferOut.length)} − Gone ${num(cur.disappearedTarget || 0)} = ${num(cur.resTotal)}</p>`
        : `<p class="foot pt-y-foot"><span class="badge bad">ERROR</span> · Expected ${num(cur.expectedRES != null ? cur.expectedRES : cur.impliedRes)} vs Actual ${num(cur.actualRES != null ? cur.actualRES : cur.resTotal)} (${cur.reconDiff > 0 ? "+" : ""}${num(cur.reconDiff)})${(cur.reconReasons || []).length ? ` · ${(cur.reconReasons || []).slice(0, 3).map((r) => esc(r.vin)).join(", ")}` : ""}</p>`}`;
  }

  function renderDailyTable(model) {
    const el = $("#pt-daily-table");
    if (!el) return;
    const rows = model.daily || [];
    if (!rows.length) {
      el.innerHTML = `<p class="foot" style="padding:12px">No snapshots yet.</p>`;
      return;
    }
    el.innerHTML = `<table class="bas-table">
      <thead><tr>
        <th>Date</th>
        <th class="num" title="Unique RES Age 0 in this day's file (≠ 315)">RES Age 0</th>
        <th class="num" title="True 315 plan receipts this day">Plan alloc</th>
        <th class="num">Free stock</th>
        <th class="num">Transfers IN</th>
        <th class="num">Transfers OUT</th>
        <th class="num">Disappeared</th>
        <th class="num">Current RES</th>
        <th class="num">Cumulative</th>
        <th class="num">Remaining</th>
        <th>Recon</th>
      </tr></thead>
      <tbody>${rows.map((d) => {
        const reconTitle = d.reconOk
          ? "OK"
          : `Expected ${d.expectedRES} vs actual ${d.actualRES}`
            + ((d.reconReasons || []).slice(0, 5).map((r) => `\n${r.vin}: ${r.reason}`).join("") || "");
        return `<tr>
        <td>${esc(d.label)}<div class="foot">${esc(d.dateKey)}</div></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="dailyUniqueRESAge0List">${num(d.dailyUniqueRESAge0 != null ? d.dailyUniqueRESAge0 : d.age0Target)}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="planReceipts">${num(d.newPlanAllocations != null ? d.newPlanAllocations : ((d.planReceipts && d.planReceipts.length) || 0))}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="freeStock">${num(d.freeStockCount != null ? d.freeStockCount : ((d.freeStock && d.freeStock.length) || 0))}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="transferIn">${num(d.transferIn.length)}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="transferOut">${num(d.transferOut.length)}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="disappeared">${num(d.disappearedTarget || 0)}</button></td>
        <td class="num">${num(d.resTotal)}</td>
        <td class="num">${num(d.cumulativePlanAllocations != null ? d.cumulativePlanAllocations : 0)}</td>
        <td class="num">${num(d.remaining != null ? d.remaining : 0)}</td>
        <td title="${esc(reconTitle)}">${d.reconOk ? '<span class="badge ok">OK</span>' : `<span class="badge bad">${d.reconDiff > 0 ? "+" : ""}${num(d.reconDiff)}</span>`}</td>
      </tr>`;
      }).join("")}</tbody>
    </table>`;
    $$("[data-pt-bucket]", el).forEach((btn) => {
      btn.addEventListener("click", () => {
        const day = btn.getAttribute("data-pt-day");
        const bucket = btn.getAttribute("data-pt-bucket");
        const slot = (model.daily || []).find((d) => d.dateKey === day);
        if (!slot) return;
        let list = slot[bucket] || [];
        if (bucket === "disappeared") list = (slot.disappeared || []).filter((r) => r.isTarget);
        if (bucket === "newRes" && slot.planReceipts && slot.planReceipts.length) list = slot.planReceipts;
        view.drill = "day-" + bucket;
        const wrap = $("#pt-drill");
        const table = $("#pt-drill-table");
        const title = $("#pt-drill-title");
        if (wrap) wrap.hidden = false;
        if (title) title.textContent = `${slot.label} · ${bucket}`;
        if (table) {
          table.innerHTML = `<table class="bas-table"><thead><tr><th>VIN</th><th>Product</th><th>SFX</th><th>Search Area</th><th>Alloc Date</th><th class="num">Age</th></tr></thead>
            <tbody>${list.map((r) => `<tr>
              <td class="mono">${esc(r.vin)}</td><td>${esc(r.product)}</td><td>${esc(r.suffix)}</td>
              <td>${esc(r.searchArea || "—")}</td><td>${esc(fmtDate(r.allocationDate))}</td>
              <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
            </tr>`).join("") || '<tr><td colspan="6">None</td></tr>'}</tbody></table>`;
        }
        try { wrap && wrap.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) { /* ignore */ }
      });
    });
  }

  function renderAge0(model) {
    const el = $("#pt-age0-table");
    if (!el) return;
    const rows = model.age0ByArea || [];
    const total = rows.reduce((s, r) => s + r.count, 0);
    el.innerHTML = `<table class="bas-table">
      <thead><tr><th>Search Area</th><th class="num">Age 0</th></tr></thead>
      <tbody>${rows.map((r) => `<tr class="${isTargetArea(r.area) ? "bas-row-above" : ""}">
        <td>${esc(r.area)}${isTargetArea(r.area) ? ' <span class="badge ok">Target</span>' : ""}</td>
        <td class="num">${num(r.count)}</td>
      </tr>`).join("")}
      <tr><td><strong>Total</strong></td><td class="num"><strong>${num(total)}</strong></td></tr>
      </tbody></table>
      <p class="foot">Age 0 is not the same as Retail Electronic Sales — Search Area is checked separately.</p>`;
  }

  function renderCorridor(model) {
    const el = $("#pt-corridor");
    if (!el) return;
    const rows = (model.corridor || []).slice(0, 25);
    if (!rows.length) {
      el.innerHTML = `<p class="foot">No transfer corridors yet.</p>`;
      return;
    }
    el.innerHTML = `<table class="bas-table">
      <thead><tr><th>From → To</th><th class="num">VINs</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.path)}</td><td class="num">${num(r.count)}</td></tr>`).join("")}</tbody>
    </table>`;
  }

  function renderMatrix(model) {
    const el = $("#pt-matrix");
    if (!el) return;
    const { cols, grid } = model.matrix || { cols: [], grid: {} };
    if (!cols.length) {
      el.innerHTML = `<p class="foot">No area-to-area transfers yet.</p>`;
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table class="bas-table pt-matrix-table">
      <thead><tr><th>From \\ To</th>${cols.map((c) => `<th>${esc(c.length > 18 ? c.slice(0, 16) + "…" : c)}</th>`).join("")}</tr></thead>
      <tbody>${cols.map((from) => `<tr>
        <th scope="row">${esc(from.length > 22 ? from.slice(0, 20) + "…" : from)}</th>
        ${cols.map((to) => {
          const n = grid[from] && grid[from][to] ? grid[from][to] : 0;
          const hl = from === to ? "pt-matrix-diag" : (n ? "pt-matrix-hit" : "");
          return `<td class="num ${hl}">${from === to ? "—" : num(n)}</td>`;
        }).join("")}
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  function renderMovements(model) {
    const el = $("#pt-move-table");
    if (!el) return;
    const rows = filteredMovements(model).slice().reverse().slice(0, 400);
    el.innerHTML = `<table class="bas-table">
      <thead><tr>
        <th>Snapshot</th><th>VIN</th><th>Product</th><th>SFX</th>
        <th>Previous Area</th><th>Current Area</th>
        <th>Prev AG</th><th>Curr AG</th><th>Movement</th><th>Status</th>
      </tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.snapshotDate)}</td>
        <td class="mono">${esc(r.vin)}</td>
        <td>${esc(r.product)}</td>
        <td>${esc(r.suffix)}</td>
        <td>${esc(r.previousSearchArea)}</td>
        <td>${esc(r.currentSearchArea)}</td>
        <td>${esc(fmtDate(r.previousAllocationDate))}</td>
        <td>${esc(fmtDate(r.currentAllocationDate))}</td>
        <td><span class="badge">${esc(r.movementType)}</span></td>
        <td>${esc(r.currentStatus || r.previousStatus || "—")}</td>
      </tr>`).join("") || '<tr><td colspan="10">No movements match filters.</td></tr>'}</tbody>
    </table>
    <p class="foot" id="pt-move-foot">${num(rows.length)} movement row(s) shown</p>`;
  }

  function renderQuality(model) {
    const el = $("#pt-quality");
    if (!el) return;
    const q = model.quality || {};
    el.innerHTML = `
      <div class="pt-quality-score"><span class="n">${num(model.qualityScore)}</span><span class="l">Data quality score</span></div>
      <div class="status-grid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">
        ${[
          ["Snapshots", q.snapshotCount],
          ["Blank VINs", q.blankVin],
          ["Duplicate VINs", q.duplicateVin],
          ["Missing Search Area", q.missingArea],
          ["Invalid Age", q.invalidAge],
          ["Missing AG", q.missingAllocationDate],
          ["Invalid AG", q.invalidAllocationDate],
          ["Age mismatches", q.ageMismatch],
          ["Conflicting records", q.conflictingRecords],
          ["Unmatched Product/SFX", q.unmatchedProductSfx],
        ].map(([lab, n]) => `<div class="status-chip" style="cursor:default"><div class="n">${num(n || 0)}</div><div class="l">${esc(lab)}</div></div>`).join("")}
      </div>
      <p class="foot">Quality flags never inflate KPI counts — duplicates keep the first VIN only.</p>`;
  }

  function renderVinSearch(model) {
    const el = $("#pt-vin-result");
    if (!el) return;
    const q = normVin(view.vinQ);
    if (!q) {
      el.innerHTML = `<p class="foot">Enter a VIN to see its full snapshot history.</p>`;
      return;
    }
    const hist = model.vinHistory.get(q);
    if (!hist || !hist.length) {
      el.innerHTML = `<p class="foot">VIN <span class="mono">${esc(q)}</span> not found in uploaded day snapshots.</p>`;
      return;
    }
    el.innerHTML = `<h4 class="pt-vin-title">VIN · ${esc(q)}</h4>
      <table class="bas-table">
        <thead><tr><th>Snapshot</th><th>Search Area</th><th>Alloc Date</th><th class="num">Age</th><th>Product</th><th>SFX</th><th>Status</th><th>Location</th></tr></thead>
        <tbody>${hist.map((r, i) => {
          let move = i === 0 ? "Initial" : "";
          if (i > 0) {
            const p = hist[i - 1];
            if (!p.isTarget && r.isTarget) move = "TRANSFER IN";
            else if (p.isTarget && !r.isTarget) move = "TRANSFER OUT";
            else if (p.isTarget && r.isTarget) move = "STAYED";
            else if (p.searchArea !== r.searchArea) move = "AREA CHANGE";
            else move = "—";
          }
          return `<tr class="${r.isTarget ? "bas-row-above" : ""}">
            <td>${esc(r.snapshotDate || r.dateKey)}</td>
            <td>${esc(r.searchArea || "—")}${r.isTarget ? ' <span class="badge ok">RES</span>' : ""}</td>
            <td>${esc(fmtDate(r.allocationDate))}</td>
            <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
            <td>${esc(r.product)}</td>
            <td>${esc(r.suffix)}</td>
            <td>${esc(r.status || "—")} <span class="badge">${esc(move)}</span></td>
            <td>${esc(r.location || "—")}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
  }

  function renderInventory(model) {
    const el = $("#pt-inventory");
    if (!el) return;
    const inv = model.inventory;
    const block = (title, rows) => `
      <div class="pt-inv-block">
        <h4>${esc(title)}</h4>
        <table class="bas-table"><thead><tr><th>Value</th><th class="num">VINs</th></tr></thead>
        <tbody>${(rows || []).slice(0, 12).map((r) => `<tr><td>${esc(r.key)}</td><td class="num">${num(r.count)}</td></tr>`).join("")
          || "<tr><td colspan='2'>None</td></tr>"}</tbody></table>
      </div>`;
    el.innerHTML = block("By Allocation Age", inv.byAge)
      + block("By Product", inv.byProduct)
      + block("By Suffix", inv.bySuffix)
      + block("By Exterior", inv.byExt)
      + block("By Status", inv.byStatus);
  }

  function renderCharts(model) {
    const Chart = global.Chart;
    if (!Chart) return;
    const daily = model.daily || [];
    const labels = daily.map((d) => d.label);
    const font = { family: "'Outfit', 'Segoe UI', sans-serif", size: 11 };

    makeChart("pt-chart-daily", {
      type: "bar",
      data: {
        labels,
          datasets: [
          { label: "Plan receipts", data: daily.map((d) => (d.planReceipts && d.planReceipts.length) || 0), backgroundColor: "#0f766e" },
          { label: "RES Age 0", data: daily.map((d) => (d.dailyUniqueRESAge0 != null ? d.dailyUniqueRESAge0 : d.age0Target)), backgroundColor: "#64748b" },
          { label: "Transfer IN", data: daily.map((d) => d.transferIn.length), backgroundColor: "#0284c7" },
          { label: "Transfer OUT", data: daily.map((d) => d.transferOut.length), backgroundColor: "#d97706" },
          { label: "Disappeared", data: daily.map((d) => d.disappearedTarget || 0), backgroundColor: "#eb0a1e" },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { font, boxWidth: 10 } } },
        scales: { x: { ticks: { font } }, y: { beginAtZero: true, ticks: { font, precision: 0 } } },
      },
    });

    makeChart("pt-chart-res", {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "RES Total",
          data: daily.map((d) => d.resTotal),
          borderColor: "#0b1f33",
          backgroundColor: "rgba(11,31,51,0.08)",
          fill: true,
          tension: 0.25,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { font } }, y: { beginAtZero: true, ticks: { font, precision: 0 } } },
      },
    });

    const ageRows = model.inventory.byAge || [];
    makeChart("pt-chart-age", {
      type: "bar",
      data: {
        labels: ageRows.map((r) => r.key),
        datasets: [{
          label: "RES VINs",
          data: ageRows.map((r) => r.count),
          backgroundColor: "#64748b",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { font } }, y: { beginAtZero: true, ticks: { font, precision: 0 } } },
      },
    });

    const k = model.kpis;
    makeChart("pt-chart-plan", {
      type: "doughnut",
      data: {
        labels: ["Allocated", "Remaining"],
        datasets: [{
          data: [k.allocated, Math.max(0, k.remaining)],
          backgroundColor: ["#0f766e", "#e2e8f0"],
          borderWidth: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        plugins: { legend: { position: "bottom", labels: { font, boxWidth: 10 } } },
      },
    });
  }

  function fillFilters(model) {
    const snap = $("#pt-f-snap");
    const move = $("#pt-f-move");
    const prod = $("#pt-f-product");
    if (snap) {
      const cur = view.snapDate;
      snap.innerHTML = `<option value="">All snapshots</option>`
        + (model.dateKeys || []).map((k) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(k)}</option>`).join("");
    }
    if (move) {
      const types = [...new Set((model.movements || []).map((m) => m.movementType))].sort();
      const cur = view.movement;
      move.innerHTML = `<option value="">Key movements</option>`
        + types.map((t) => `<option value="${esc(t)}"${t === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
    }
    if (prod) {
      const products = [...new Set((model.movements || []).map((m) => m.product).filter(Boolean))].sort();
      const cur = view.product;
      prod.innerHTML = `<option value="">All products</option>`
        + products.map((p) => `<option value="${esc(p)}"${p === cur ? " selected" : ""}>${esc(p)}</option>`).join("");
    }
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    const search = $("#pt-search");
    const repaint = () => {
      if (!lastModel) return;
      const sc = $("#pt-vin-scroll");
      if (sc) sc.scrollTop = 0;
      if (isTower()) renderTower(lastModel);
      else renderMovements(lastModel);
    };
    if (search) {
      search.addEventListener("input", () => {
        view.q = search.value.trim();
        view.vinPin = null;
        repaint();
      });
    }
    ["pt-f-product", "pt-f-sfx", "pt-f-year", "pt-f-status", "pt-f-area"].forEach((id) => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener("change", () => {
        if (id === "pt-f-product") view.product = el.value;
        if (id === "pt-f-sfx") view.sfx = el.value;
        if (id === "pt-f-year") view.year = el.value;
        if (id === "pt-f-status") {
          view.status = el.value;
          view.tab = view.status ? statusToTab(view.status) : "all";
        }
        if (id === "pt-f-area") view.area = el.value;
        view.vinPin = null;
        repaint();
      });
    });
    const clear = $("#pt-clear");
    const clear2 = $("#pt-clear-2");
    const runClear = () => {
        view.snapDate = "";
        view.movement = "";
        view.product = "";
        view.sfx = "";
        view.year = "";
        view.status = "";
        view.area = "";
        view.tab = "all";
        view.q = "";
        view.drill = "";
        view.vinPin = null;
        if (search) search.value = "";
        repaint();
    };
    if (clear) clear.addEventListener("click", runClear);
    if (clear2) clear2.addEventListener("click", runClear);
    const dark = $("#pt-dark");
    if (dark) {
      dark.addEventListener("click", () => {
        const dash = $("#pt-dash");
        if (!dash) return;
        dash.classList.toggle("is-dark");
        dark.textContent = dash.classList.contains("is-dark") ? "Light" : "Dark";
      });
    }
    const dashOpen = $("#pt-dash");
    if (dashOpen) dashOpen.classList.add("is-wide");
    const exitBtn = $("#pt-exit");
    if (exitBtn) {
      exitBtn.addEventListener("click", () => {
        if (typeof global.switchReportPanel === "function") global.switchReportPanel("salesreport");
      });
    }
    const vinBtn = $("#pt-vin-go");
    const vinInput = $("#pt-vin-q");
    const runVin = () => {
      view.vinQ = vinInput ? vinInput.value.trim() : "";
      if (lastModel) renderVinSearch(lastModel);
    };
    if (vinBtn) vinBtn.addEventListener("click", runVin);
    if (vinInput) {
      vinInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") runVin();
      });
    }
    const closeDrill = $("#pt-drill-close");
    if (closeDrill) {
      closeDrill.addEventListener("click", () => {
        view.drill = "";
        if (lastModel) {
          renderDrill(lastModel);
          renderKpis(lastModel);
          renderProgress(lastModel);
        }
      });
    }
    const exportBtn = $("#pt-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => exportExcel());
    }
    const debugBtn = $("#pt-export-debug");
    if (debugBtn) {
      debugBtn.addEventListener("click", () => {
        const modal = document.getElementById("pt-recon-modal");
        if (modal) {
          liftPtOverlay(modal);
          modal.hidden = false;
          syncPtCharts();
        }
      });
    }
    const refreshBtn = $("#pt-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        render({ force: true });
      });
    }
    const prev = $("#pt-month-prev");
    const nowBtn = $("#pt-month-now");
    const next = $("#pt-month-next");
    if (prev) prev.addEventListener("click", () => shiftMonth(-1));
    if (next) next.addEventListener("click", () => shiftMonth(1));
    if (nowBtn) {
      nowBtn.addEventListener("click", () => {
        view.monthLocked = false;
        view.vinPin = null;
        render({ force: true });
      });
    }
    const mode = $("#pt-mode");
    if (mode) {
      mode.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pt-mode]");
        if (!btn || !lastModel) return;
        view.mode = btn.getAttribute("data-pt-mode") || "daily";
        renderTower(lastModel);
      });
    }
    const tabs = $("#pt-tabs");
    if (tabs) {
      tabs.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pt-tab]");
        if (!btn || !lastModel) return;
        view.tab = btn.getAttribute("data-pt-tab") || "all";
        view.status = tabToStatus(view.tab);
        const sc = $("#pt-vin-scroll");
        if (sc) sc.scrollTop = 0;
        renderTower(lastModel);
      });
    }
    const kpis = $("#pt-kpis");
    if (kpis) {
      kpis.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pt-kpi]");
        if (!btn || !lastModel) return;
        const key = btn.getAttribute("data-pt-kpi");
        const map = { stock: "My Stock", proforma: "Proforma", delivered: "Delivered", swapped: "Swapped" };
        if (!map[key]) return;
        view.status = view.status === map[key] ? "" : map[key];
        view.tab = view.status ? statusToTab(view.status) : "all";
        const sc = $("#pt-vin-scroll");
        if (sc) sc.scrollTop = 0;
        renderTower(lastModel);
      });
    }
    const product = $("#pt-product");
    if (product) {
      product.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pt-product]");
        if (!btn || !lastModel) return;
        const name = btn.getAttribute("data-pt-product") || "";
        view.product = view.product === name ? "" : name;
        view.vinPin = null;
        renderTower(lastModel);
      });
    }
    const sfx = $("#pt-sfx");
    if (sfx) {
      sfx.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pt-sfx]");
        if (!btn || !lastModel) return;
        const name = btn.getAttribute("data-pt-sfx") || "";
        view.sfx = view.sfx === name ? "" : name;
        view.vinPin = null;
        renderTower(lastModel);
      });
    }
    ["pt-vin-modal-q", "pt-vin-modal-product", "pt-vin-modal-sfx", "pt-vin-modal-status", "pt-vin-modal-date"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", paintVinModal);
      el.addEventListener("change", paintVinModal);
    });
    const vinModal = $("#pt-vin-modal");
    if (vinModal) {
      vinModal.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pt-vin]");
        if (!btn) return;
        openVinDrawer(btn.getAttribute("data-pt-vin"));
      });
    }
    document.addEventListener("click", (e) => {
      const vinOpen = e.target.closest("[data-pt-open]");
      if (vinOpen && lastModel) {
        openFromSpec(vinOpen.getAttribute("data-pt-open"), vinOpen.getAttribute("data-pt-arg") || "");
      }
      const expand = e.target.closest("[data-pt-expand]");
      if (expand && lastModel) {
        const which = expand.getAttribute("data-pt-expand");
        const host = {
          product: "#pt-product",
          sfx: "#pt-sfx",
          count: "#pt-daily-count",
          register: "#pt-vin-scroll",
          status: "#pt-card-status .pt-donut",
          daily: "#pt-card-daily .pt-chart",
        }[which];
        const title = {
          product: "Product allocation",
          sfx: "SFX plan progress",
          count: "Daily VIN count",
          register: "Received VINs",
          status: "My allocation status",
          daily: "Daily plan vs my allocation",
        }[which] || "Detail";
        const modal = $("#pt-expand-modal");
        const h = $("#pt-expand-title");
        const body = $("#pt-expand-body");
        if (h) h.textContent = title;
        if (body) {
          if (which === "daily" || which === "year" || which === "status") {
            body.innerHTML = which === "status"
              ? `<div class="pt-indicators">
                  <button type="button" class="pt-ind" data-pt-open="delivered"><span>Delivered</span></button>
                  <button type="button" class="pt-ind" data-pt-open="proforma"><span>Proforma</span></button>
                  <button type="button" class="pt-ind" data-pt-open="stock"><span>My stock</span></button>
                  <button type="button" class="pt-ind" data-pt-open="swapped"><span>Swapped out</span></button>
                </div>`
              : `<p class="pt-drawer-meta">Click a date or a model year on the chart to open its VINs.</p>`;
          } else {
            const src = host ? document.querySelector(host) : null;
            body.innerHTML = src ? src.innerHTML : "";
          }
        }
        if (modal) {
          liftPtOverlay(modal);
          modal.hidden = false;
          syncPtCharts();
        }
      }
      const open = e.target.closest("[id='pt-schedule-open'], #pt-quality-open, #pt-recon-open");
      if (open && lastModel) {
        const id = open.id === "pt-schedule-open" ? "pt-schedule-modal"
          : open.id === "pt-quality-open" ? "pt-quality-modal" : "pt-recon-modal";
        const modal = document.getElementById(id);
        if (modal) {
          liftPtOverlay(modal);
          modal.hidden = false;
          syncPtCharts();
        }
      }
      const close = e.target.closest("[data-pt-close]");
      if (close) {
        const modal = document.getElementById(close.getAttribute("data-pt-close"));
        if (modal) modal.hidden = true;
      }
      if (e.target.classList && e.target.classList.contains("pt-modal")) e.target.hidden = true;
      if (close || (e.target.classList && e.target.classList.contains("pt-modal"))) syncPtCharts();
    });
    const drawerClose = $("#pt-drawer-close");
    if (drawerClose) {
      drawerClose.addEventListener("click", () => {
        const drawer = $("#pt-drawer");
        if (drawer) drawer.hidden = true;
        syncPtCharts();
      });
    }
  }

  function isTower() {
    const dash = $("#pt-dash");
    return !!(dash && dash.classList.contains("pt-tower"));
  }

  function leafOf(row) {
    if (!row) return null;
    if (Object.prototype.hasOwnProperty.call(row, "_leaf")) return row._leaf;
    const fn = global.matchRtlToAllocLeaf;
    const leaf = typeof fn === "function" ? fn({ product: row.product, suffix: row.suffix }) : null;
    row._leaf = leaf || null;
    return row._leaf;
  }

  function rowProduct(r) {
    if (r && r.leafProduct) return r.leafProduct;
    const leaf = leafOf(r);
    return leaf ? leaf.product : ((r && r.product) || "");
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function receiptChartDays(model) {
    const days = ((model && model.daily) || []).filter((d) => d && d.dateKey);
    const extras = ((model && model.chartExtraDays) || []).filter((d) => d && d.dateKey);
    return days.concat(extras).sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
  }

  function currentMonthReceiptDays(model) {
    const month = currentMonthKey();
    return receiptChartDays(model).filter((d) => String(d.dateKey).slice(0, 7) === month);
  }

  function adminProductName(r) {
    const leaf = leafOf(r);
    if (leaf && leaf.product) return leaf.product;
    return (r && r.product) || "(unmatched)";
  }

  function rowSfx(r) {
    if (r && r.leafSfx) return r.leafSfx;
    const leaf = leafOf(r);
    return leaf ? leaf.sfx : ((r && r.suffix) || "");
  }

  /**
   * Status priority: Delivered (Sales Raw col V) > Proforma (col P) > Swapped > My Stock.
   * Swap requires a later snapshot in this month whose Search Area is not Retail Electronic Sales.
   */
  function classifyVinStatus(receipt, history) {
    const hist = Array.isArray(history) ? history : [];
    const receiptKey = String((receipt && receipt.dateKey) || "");
    let swap = null;
    hist.forEach((h) => {
      if (!h) return;
      const snap = String(h.snapshotDate || h.dateKey || "");
      if (!snap || (receiptKey && snap <= receiptKey)) return;
      if (isRES(h)) return;
      if (!swap || snap < swap.snapshotDate) {
        swap = {
          snapshotDate: snap,
          searchArea: h.searchArea || h.searchAreaDesc || "",
          location: h.location || "",
        };
      }
    });
    const invoice = receipt && (receipt.invoiceDate || receipt.deliveryDate);
    const proforma = receipt && receipt.proformaDate;
    const delivered = !!(receipt && (receipt.salesKind === "delivered" || (invoice && parseDate(invoice))));
    const isProforma = !delivered && !!(receipt && (receipt.salesKind === "proforma" || (proforma && parseDate(proforma))));
    let status = "My Stock";
    if (delivered) status = "Delivered";
    else if (isProforma) status = "Proforma";
    else if (swap) status = "Swapped";
    return { status, swap, conflict: !!swap && (delivered || isProforma) };
  }

  function buildControlCenter(model) {
    const src = model || {};
    const history = src.vinHistory || new Map();
    const values = global.allocationValues || {};
    const register = ((src.lists && src.lists.allocated) || []).map((r) => {
      const cls = classifyVinStatus(r, history.get(r.vin) || []);
      const leaf = leafOf(r);
      return Object.assign({}, r, {
        statusKey: cls.status,
        swapDate: cls.swap ? cls.swap.snapshotDate : "",
        swapArea: cls.swap ? cls.swap.searchArea : "",
        swapLocation: cls.swap ? cls.swap.location : "",
        statusConflict: cls.conflict,
        seg: leaf ? (leaf.seg || "—") : "—",
        leafId: leaf ? leaf.id : "",
        leafProduct: leaf ? leaf.product : (r.product || "—"),
        leafSfx: leaf ? leaf.sfx : (r.suffix || "—"),
        planQty: leaf ? (Number(values[leaf.id]) || 0) : 0,
      });
    });
    const resAge0 = new Set();
    (src.daily || []).forEach((d) => {
      (d.dailyUniqueRESAge0List || []).forEach((r) => {
        if (r && r.vin) resAge0.add(r.vin);
      });
    });
    const counts = { Delivered: 0, Proforma: 0, "My Stock": 0, Swapped: 0 };
    register.forEach((r) => { counts[r.statusKey] = (counts[r.statusKey] || 0) + 1; });
    let laterCount = 0;
    history.forEach((hist) => {
      if (hist && hist.length > 1) laterCount += 1;
    });
    const statusSum = counts.Delivered + counts.Proforma + counts["My Stock"] + counts.Swapped;
    const unmatchedSales = register.filter((r) => !r.salesKind || r.salesKind === "none").length;
    const conflicts = register.filter((r) => r.statusConflict).length;
    const warnings = [];
    if (statusSum !== register.length) {
      warnings.push(`Status total ${statusSum} does not equal within-allocation receipts ${register.length}.`);
    }
    if (conflicts) warnings.push(`${conflicts} VIN(s) are Delivered or Proforma and also move out of Retail Electronic Sales later.`);
    if (unmatchedSales) warnings.push(`${unmatchedSales} received VIN(s) are missing from Sales Raw.`);
    if (laterCount) warnings.push(`${laterCount} VIN(s) appear again in a later RTL snapshot.`);
    return {
      register,
      counts,
      statusSum,
      laterCount,
      unmatchedSales,
      conflicts,
      missingProduct: register.filter((r) => !r.product || r.product === "—").length,
      missingSfx: register.filter((r) => !r.suffix || r.suffix === "—").length,
      warnings,
    };
  }

  let ccModel = null;
  let ccCache = null;
  function controlCenter(model) {
    if (model && ccModel === model && ccCache) return ccCache;
    ccCache = buildControlCenter(model);
    ccModel = model;
    return ccCache;
  }

  function scopeMatch(r) {
    if (!r) return false;
    if (view.product && rowProduct(r) !== view.product) return false;
    if (view.sfx && rowSfx(r) !== view.sfx) return false;
    if (view.year && String(r.year || "") !== String(view.year)) return false;
    if (view.area) {
      const area = normHeader(r.searchArea || r.searchAreaDesc || "");
      if (!area.includes(normHeader(view.area))) return false;
    }
    if (view.q) {
      const q = String(view.q).trim().toUpperCase();
      const blob = [
        normalizeVin(r.vin),
        r.product, r.suffix, rowProduct(r), rowSfx(r),
      ].join(" ").toUpperCase();
      if (!blob.includes(q)) return false;
    }
    if (view.vinPin && view.vinPin.size && !view.vinPin.has(r.vin)) return false;
    return true;
  }

  function todayDateKey(monthKey) {
    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (mk !== monthKey) return "";
    return `${mk}-${String(now.getDate()).padStart(2, "0")}`;
  }

  function tabToStatus(tab) {
    if (tab === "stock") return "Stock";
    if (tab === "reserved") return "Reserved";
    if (tab === "proforma") return "Proforma";
    if (tab === "delivered") return "Delivered";
    if (tab === "swapped") return "Swapped out";
    if (tab === "in") return "Swapped in";
    return "";
  }

  function statusToTab(status) {
    if (status === "Stock" || status === "My Stock") return "stock";
    if (status === "Reserved") return "reserved";
    if (status === "Proforma") return "proforma";
    if (status === "Delivered") return "delivered";
    if (status === "Swapped out" || status === "Swapped") return "swapped";
    if (status === "Swapped in") return "in";
    return "all";
  }

  function gapInfo(plan, mtd) {
    const gap = plan - mtd;
    if (gap > 0) return { n: gap, cls: "pt-gap-left", word: "left" };
    if (gap < 0) return { n: Math.abs(gap), cls: "pt-gap-over", word: "over" };
    return { n: 0, cls: "pt-gap-ok", word: "done" };
  }

  function fillSelect(id, values, current, allLabel) {
    const el = document.getElementById(id);
    if (!el) return;
    const list = [...values].filter((v) => v != null && String(v) !== "").map(String);
    const uniq = [...new Set(list)].sort((a, b) => a.localeCompare(b));
    el.innerHTML = `<option value="">${esc(allLabel)}</option>`
      + uniq.map((v) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`).join("");
  }

  let vinPaintRows = [];
  const VIN_ROW_H = 28;

  function statusPill(status) {
    const cls = status === "Delivered" ? "ok"
      : status === "Proforma" ? "pro"
        : status === "Reserved" ? "reserved"
          : (status === "Swapped" || status === "Swapped out" || status === "Swapped in") ? "swap"
            : "stock";
    return `<span class="pt-pill pt-pill-${cls}">${esc(status || "—")}</span>`;
  }

  function laterSwapInfo(model, row) {
    const creditKey = creditDayOf(row);
    const hist = (model.vinHistory && model.vinHistory.get(row && row.vin)) || [];
    let hit = null;
    hist.forEach((h) => {
      if (!h) return;
      const snap = String(h.snapshotDate || h.dateKey || "");
      if (!snap || !creditKey || snap <= creditKey || isRES(h)) return;
      if (!hit || snap < hit.date) hit = { date: snap, area: h.searchArea || h.searchAreaDesc || "" };
    });
    return hit;
  }

  function presentReceiptRow(model, row, kind) {
    const flags = classifyWithinFlags(model, row);
    const swap = kind === "in" ? null : laterSwapInfo(model, row);
    const leaf = leafOf(row);
    const hist = (model.vinHistory && model.vinHistory.get(row && row.vin)) || [];
    let statusKey = "Reserved";
    if (flags.delivered) statusKey = "Delivered";
    else if (kind === "in") statusKey = "Swapped in";
    else if (flags.stock) statusKey = "Stock";
    else if (flags.proforma) statusKey = "Proforma";
    const sales = salesRawForVin(row && row.vin);
    const colVDate = (sales && (sales.invoiceDate || sales.deliveryDate)) || row.invoiceDate || row.deliveryDate || null;
    return Object.assign({}, row, {
      statusKey,
      colVDelivered: !!flags.delivered,
      invoiceDate: flags.delivered ? colVDate : (row.invoiceDate || null),
      secondaryStatus: secondaryText(row, hist) || row.secondaryStatus || "",
      leafProduct: (leaf && leaf.product) || row.product || "—",
      leafSfx: (leaf && leaf.sfx) || row.suffix || "—",
      planQty: leaf ? (Number((global.allocationValues || {})[leaf.id]) || 0) : (Number(row.planQty) || 0),
      swapArea: swap ? swap.area : "",
      swapDate: swap ? swap.date : "",
    });
  }

  function paintVinWindow() {
    const sc = $("#pt-vin-scroll");
    const body = $("#pt-vin-body");
    const spacer = $("#pt-vin-spacer");
    if (!sc || !body) return;
    const rows = vinPaintRows;
    const total = rows.length;
    const h = sc.clientHeight || 160;
    const start = Math.max(0, Math.floor(sc.scrollTop / VIN_ROW_H) - 2);
    const count = Math.ceil(h / VIN_ROW_H) + 8;
    const slice = rows.slice(start, start + count);
    if (spacer) spacer.style.height = `${Math.max(total, 1) * VIN_ROW_H}px`;
    body.style.transform = `translateY(${start * VIN_ROW_H}px)`;
    body.innerHTML = slice.map((r) => `<tr style="height:${VIN_ROW_H}px">
      <td>${esc(r.dateKey || "—")}</td>
      <td><button type="button" class="pt-vin-btn" data-pt-vin="${esc(r.vin)}">${esc(r.vin)}</button></td>
      <td>${esc(r.leafProduct || r.product || "—")}</td>
      <td>${esc(r.leafSfx || r.suffix || "—")}</td>
      <td>${esc(r.year || "—")}</td>
      <td class="num">${r.planQty ? num(r.planQty) : "—"}</td>
      <td>${esc(fmtDate(r.allocationDate))}</td>
      <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
      <td>${esc(r.searchArea || "—")}</td>
      <td>${statusPill(r.statusKey)}</td>
      <td>${esc(fmtDate(r.invoiceDate))}</td>
      <td>${esc(r.secondaryStatus || "—")}</td>
      <td>${r.swapArea ? `${esc(r.swapArea)} · ${esc(r.swapDate)}` : "—"}</td>
    </tr>`).join("") || `<tr><td colspan="13">No VINs for this filter.</td></tr>`;
  }

  function openVinDrawer(vin) {
    if (!lastModel) return;
    const key = normalizeVin(vin);
    const cc = controlCenter(lastModel);
    const rec = cc.register.find((r) => r.vin === key) || null;
    const hist = (lastModel.vinHistory && lastModel.vinHistory.get(key)) || [];
    const drawer = $("#pt-drawer");
    const title = $("#pt-drawer-title");
    const body = $("#pt-drawer-body");
    if (title) title.textContent = key || "VIN";
    if (body) {
      const receiptKey = rec ? rec.dateKey : "";
      const lines = hist.map((h) => {
        const snap = h.snapshotDate || h.dateKey || "";
        let step = "MY STOCK";
        if (rec && rec.statusKey === "Swapped In") step = isRES(h) ? "SWAPPED IN" : "OTHER AREA";
        else if (isPlanScheduleReceipt(h, snap) || (receiptKey && snap === receiptKey && isRES(h) && isAge0(h))) step = "MY ALLOCATION";
        else if (!isRES(h)) step = "SWAPPED OUT";
        return `<li><b>${esc(snap || "—")}</b><span>${esc(h.searchArea || "—")}</span><span>Allocation age ${h.allocationAge == null ? "—" : esc(h.allocationAge)}</span><em>${step}</em></li>`;
      }).join("");
      const sec = secondaryText(rec, hist);
      const totals = monthStatusTotals(lastModel);
      const withinHit = totals.within.find((r) => r.vin === key);
      const inHit = totals.swappedIn.find((r) => r.vin === key);
      const shown = withinHit
        ? presentReceiptRow(lastModel, withinHit, "within")
        : (inHit ? presentReceiptRow(lastModel, inHit, "in") : null);
      const stockLine = shown ? shown.statusKey : "—";
      body.innerHTML = `
        <p class="pt-drawer-id">${esc(key)}</p>
        <p>${esc(rec ? (rec.leafProduct || rec.product) : (hist[0] && hist[0].product) || "")} · ${esc(rec ? (rec.leafSfx || rec.suffix) : (hist[0] && hist[0].suffix) || "")} · ${esc(rec ? rec.year : (hist[0] && hist[0].year) || "—")}</p>
        <h4>Current status</h4>
        <p>${statusPill(shown ? shown.statusKey : "—")}</p>
        <h4>VIN journey</h4>
        <ol class="pt-timeline">${lines || "<li>No daily RTL history.</li>"}</ol>
        <h4>Sales Raw</h4>
        <p class="pt-drawer-meta">Proforma date ${esc(fmtDate(rec && rec.proformaDate))}</p>
        <p class="pt-drawer-meta">Delivery date ${esc(fmtDate(rec && rec.invoiceDate))}</p>
        <h4>Secondary status</h4>
        <p class="pt-drawer-meta">${esc(sec || "—")}</p>
        <h4>Classification</h4>
        <p class="pt-drawer-meta">${esc(stockLine)}</p>`;
    }
    if (drawer) {
      liftPtOverlay(drawer);
      drawer.hidden = false;
      syncPtCharts();
    }
  }

  function shiftMonth(delta) {
    const base = view.monthKey || "";
    const m = /^(\d{4})-(\d{2})$/.exec(base);
    const now = new Date();
    const y = m ? Number(m[1]) : now.getFullYear();
    const mo = m ? Number(m[2]) - 1 : now.getMonth();
    const d = new Date(y, mo + delta, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    view.monthLocked = true;
    view.monthKey = mk;
    view.vinPin = null;
    render({ force: true, monthKey: mk });
  }

  /**
   * My Stock VINs: still Retail Electronic Sales, not delivered or proforma.
   * Includes receipts from any day, plus current RES vehicles whose allocation date is not today.
   */
  function myStockRows(model, register) {
    const src = model || {};
    const reg = Array.isArray(register) ? register : (controlCenter(src).register || []);
    const fromRegister = reg.filter((r) => r && r.statusKey === "My Stock");
    const known = new Set(reg.map((r) => r && r.vin).filter(Boolean));
    const values = global.allocationValues || {};
    const extras = [];
    ((src.lists && src.lists.current) || []).forEach((r) => {
      if (!r || !r.vin || known.has(r.vin) || !isRES(r)) return;
      const hist = (src.vinHistory && src.vinHistory.get(r.vin)) || [];
      const first = hist[0] || r;
      const receiptKey = first.snapshotDate || first.dateKey || r.dateKey || "";
      const cls = classifyVinStatus({
        ...r,
        dateKey: receiptKey,
        salesKind: r.salesKind,
        invoiceDate: r.invoiceDate,
        proformaDate: r.proformaDate,
      }, hist);
      if (cls.status !== "My Stock") return;
      const leaf = leafOf(r);
      extras.push(Object.assign({}, first, r, {
        dateKey: receiptKey,
        statusKey: "My Stock",
        swapDate: "",
        swapArea: "",
        swapLocation: "",
        statusConflict: false,
        seg: leaf ? (leaf.seg || "—") : "—",
        leafId: leaf ? leaf.id : "",
        leafProduct: leaf ? leaf.product : (r.product || "—"),
        leafSfx: leaf ? leaf.sfx : (r.suffix || "—"),
        planQty: leaf ? (Number(values[leaf.id]) || 0) : 0,
        stockOnly: true,
      }));
      known.add(r.vin);
    });
    return fromRegister.concat(extras);
  }

  function secondaryText(row, hist) {
    const last = hist && hist.length ? hist[hist.length - 1] : null;
    return String((last && last.secondaryStatus) || (row && row.secondaryStatus) || "");
  }

  function isVehicleAllocationCompleted(text) {
    return normHeader(text).includes("vehicle allocation completed");
  }

  /** Other area first, Retail Electronic Sales later. Not a plan receipt. */
  function swappedInList(model, register) {
    const known = new Set((register || []).map((r) => r && r.vin).filter(Boolean));
    const history = (model && model.vinHistory) || new Map();
    const out = [];
    history.forEach((hist, vin) => {
      if (!hist || hist.length < 2 || known.has(vin) || isRES(hist[0])) return;
      const hit = hist.find((h, i) => i > 0 && isRES(h));
      if (!hit) return;
      out.push(Object.assign({}, hit, {
        vin,
        dateKey: hit.snapshotDate || hit.dateKey || "",
        statusKey: "Swapped In",
        leafProduct: hit.product || "—",
        leafSfx: hit.suffix || "—",
        secondaryStatus: hit.secondaryStatus || "",
      }));
    });
    return out;
  }

  function towerPack(model) {
    const cc = controlCenter(model);
    const scoped = cc.register.filter(scopeMatch);
    const history = (model && model.vinHistory) || new Map();
    const stock = scoped.filter((r) => r.statusKey === "My Stock").map((r) => {
      const sec = secondaryText(r, history.get(r.vin));
      return Object.assign({}, r, {
        secondaryStatus: sec,
        stockKind: isVehicleAllocationCompleted(sec) ? "Free" : "Undefined",
      });
    });
    const received = new Map();
    (model.daily || []).forEach((d) => {
      (d.dailyUniqueRESAge0List || []).forEach((r) => {
        if (r && r.vin && scopeMatch(r) && !received.has(r.vin)) received.set(r.vin, r);
      });
    });
    return {
      cc,
      scoped,
      stock,
      free: stock.filter((r) => r.stockKind === "Free"),
      undef: stock.filter((r) => r.stockKind === "Undefined"),
      swappedIn: swappedInList(model, cc.register).filter(scopeMatch),
      received: [...received.values()],
      history,
    };
  }

  let modalRows = [];

  function vinResultRow(r) {
    const sec = r.secondaryStatus || "";
    return `<tr data-pt-vin="${esc(r.vin)}">
      <td><button type="button" class="pt-vin-btn" data-pt-vin="${esc(r.vin)}">${esc(r.vin || "—")}</button></td>
      <td>${esc(r.leafProduct || r.product || "—")}</td>
      <td>${esc(r.leafSfx || r.suffix || "—")}</td>
      <td>${esc(r.year || "—")}</td>
      <td>${esc(r.dateKey || "—")}</td>
      <td>${esc(fmtDate(r.allocationDate))}</td>
      <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
      <td>${esc(r.searchArea || "—")}</td>
      <td>${statusPill(r.statusKey)}</td>
      <td>${esc(sec || "—")}</td>
    </tr>`;
  }

  function paintVinModal() {
    const body = $("#pt-vin-modal-body");
    if (!body) return;
    const q = String(($("#pt-vin-modal-q") || {}).value || "").trim().toUpperCase();
    const product = ($("#pt-vin-modal-product") || {}).value || "";
    const sfx = ($("#pt-vin-modal-sfx") || {}).value || "";
    const status = ($("#pt-vin-modal-status") || {}).value || "";
    const date = ($("#pt-vin-modal-date") || {}).value || "";
    const rows = modalRows.filter((r) => {
      if (product && (r.leafProduct || r.product || "") !== product) return false;
      if (sfx && (r.leafSfx || r.suffix || "") !== sfx) return false;
      if (status && (r.statusKey || "") !== status) return false;
      if (date && (r.dateKey || "") !== date) return false;
      if (q && !String(r.vin || "").toUpperCase().includes(q)) return false;
      return true;
    });
    body.innerHTML = rows.map(vinResultRow).join("") || `<tr><td colspan="10">No VINs in this result.</td></tr>`;
    const sub = $("#pt-vin-modal-sub");
    if (sub) {
      const base = sub.getAttribute("data-base") || "";
      sub.textContent = `${base}${base ? " · " : ""}${num(rows.length)} shown`;
    }
  }

  function fillModalSelect(id, values, label) {
    const el = document.getElementById(id);
    if (!el) return;
    const uniq = [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b));
    el.innerHTML = `<option value="">${esc(label)}</option>` + uniq.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  }

  function liftPtOverlay(el) {
    const dash = document.getElementById("pt-dash");
    if (el && dash && el.parentElement === dash) dash.appendChild(el);
  }

  function syncPtCharts() {
    const dash = document.getElementById("pt-dash");
    if (!dash) return;
    const open = dash.querySelector(".pt-modal:not([hidden]), .pt-drawer:not([hidden])");
    dash.querySelectorAll("#pt-chart-daily, #pt-chart-status").forEach((canvas) => {
      canvas.style.visibility = open ? "hidden" : "";
    });
  }

  function openVinResults(title, sub, rows) {
    modalRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
    const modal = $("#pt-vin-modal");
    const h = $("#pt-vin-modal-title");
    const s = $("#pt-vin-modal-sub");
    if (h) h.textContent = `${title} · ${num(modalRows.length)} VIN${modalRows.length === 1 ? "" : "s"}`;
    if (s) {
      s.setAttribute("data-base", sub || "");
      s.textContent = sub || "";
    }
    fillModalSelect("pt-vin-modal-product", modalRows.map((r) => r.leafProduct || r.product), "Product");
    fillModalSelect("pt-vin-modal-sfx", modalRows.map((r) => r.leafSfx || r.suffix), "SFX");
    fillModalSelect("pt-vin-modal-status", modalRows.map((r) => r.statusKey), "Status");
    fillModalSelect("pt-vin-modal-date", modalRows.map((r) => r.dateKey), "Date");
    ["pt-vin-modal-q", "pt-vin-modal-product", "pt-vin-modal-sfx", "pt-vin-modal-status", "pt-vin-modal-date"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    paintVinModal();
    if (modal) {
      liftPtOverlay(modal);
      modal.hidden = false;
      syncPtCharts();
    }
  }

  function numBtn(n, spec, extra, cls) {
    const attrs = extra ? ` ${extra}` : "";
    const klass = cls ? `pt-num ${cls}` : "pt-num";
    return `<button type="button" class="${klass}" data-pt-open="${esc(spec)}"${attrs}>${num(n)}</button>`;
  }

  function emptySfxBucket() {
    return { within: [], delivered: [], proforma: [], reserved: [], stock: [], swappedOut: [], swappedIn: [] };
  }

  /** Secondary status description → one bucket. Anything not listed is Reserved. */
  const SECONDARY_STATUS_CLASS = {
    "dio completed": "proforma",
    "dio started": "proforma",
    "pro forma invoice created": "proforma",
    "pro forma invoice created damage block": "proforma",
    "sales order released by sales manager": "proforma",
    "vehicle registered": "proforma",
    "vehicle reserved": "proforma",
    "sales order created": "reserved",
    "sales order created veh damaged": "reserved",
    "vehicle assigned to cust damage block": "reserved",
    "vehicle allocation completed": "stock",
    "vehicle damaged": "stock",
    "vehicle freeze from s000": "stock",
  };

  function secondaryStatusClass(text) {
    const key = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return SECONDARY_STATUS_CLASS[key] || "reserved";
  }

  function descriptionFromDetails(details) {
    if (!details || typeof details !== "object") return "";
    const keys = Object.keys(details);
    for (let i = 0; i < keys.length; i += 1) {
      const name = normHeader(keys[i]);
      if (!name.includes("secondary status")) continue;
      if (!name.includes("desc") && !name.includes("description")) continue;
      const val = String(details[keys[i]] || "").trim();
      if (val) return val;
    }
    return "";
  }

  function rtlSecondaryStatus(v) {
    const described = descriptionFromDetails(v && v.details);
    if (described) return described;
    return String((v && (v.secondaryStatus || v.secondary_status)) || "");
  }

  function hasSalesRawDelivery(row) {
    if (!row) return false;
    if (row.salesKind === "delivered") return true;
    const invoice = row.invoiceDate || row.deliveryDate;
    return !!(invoice && parseDate(invoice));
  }

  let salesLookupMemo = undefined;
  function resetSalesLookup() {
    salesLookupMemo = undefined;
  }

  /** Admin Push Sales Raw for one VIN. Column V date is delivery. */
  function salesRawForVin(vin) {
    if (salesLookupMemo === undefined) {
      salesLookupMemo = null;
      if (typeof global.buildSalesVinLookup === "function" && typeof global.resolveAaSalesStatus === "function") {
        try { salesLookupMemo = global.buildSalesVinLookup(); } catch (_) { salesLookupMemo = null; }
      }
    }
    if (!salesLookupMemo || !vin || typeof global.resolveAaSalesStatus !== "function") return null;
    return global.resolveAaSalesStatus(vin, salesLookupMemo);
  }

  function hasSalesRawColV(row) {
    const sales = salesRawForVin(row && row.vin);
    if (sales) {
      const invoice = sales.invoiceDate || sales.deliveryDate;
      return sales.kind === "delivered" || !!(invoice && parseDate(invoice));
    }
    return hasSalesRawDelivery(row);
  }

  function sfxBucketId(row) {
    const leaf = leafOf(row);
    if (leaf && leaf.id) return leaf.id;
    const leaves = global.ALLOCATION_ROWS || [];
    const pk = normHeader(row && row.product);
    const sk = normHeader(row && row.suffix);
    const hit = leaves.find((item) => item && item.kind === "leaf"
      && normHeader(item.product) === pk
      && normHeader(item.sfx) === sk);
    return hit ? hit.id : "__unmatched__";
  }

  function creditDayOf(row) {
    return newCarCreditKey(row, row && row.dateKey) || String((row && row.dateKey) || "");
  }

  function laterLeftRes(model, vin, creditKey) {
    const hist = (model.vinHistory && model.vinHistory.get(vin)) || [];
    return hist.some((h) => {
      if (!h) return false;
      const snap = String(h.snapshotDate || h.dateKey || "");
      return !!(snap && creditKey && snap > creditKey && !isRES(h));
    });
  }

  function classifyWithinFlags(model, row) {
    const hist = (model.vinHistory && model.vinHistory.get(row.vin)) || [];
    const kind = secondaryStatusClass(secondaryText(row, hist));
    return {
      delivered: hasSalesRawColV(row),
      proforma: kind === "proforma",
      stock: kind === "stock",
      reserved: kind === "reserved",
      swappedOut: laterLeftRes(model, row.vin, creditDayOf(row)),
    };
  }

  function pushClassified(bucket, row, flags) {
    bucket.within.push(row);
    if (flags.delivered) bucket.delivered.push(row);
    if (flags.proforma) bucket.proforma.push(row);
    if (flags.reserved) bucket.reserved.push(row);
    if (flags.stock) bucket.stock.push(row);
    if (flags.swappedOut) bucket.swappedOut.push(row);
  }

  function eachSwappedIn(model, month, visit) {
    const monthFileDays = ((model && model.daily) || [])
      .map((d) => d && d.dateKey)
      .filter((key) => key && String(key).slice(0, 7) === month)
      .sort();
    const firstFile = monthFileDays[0] || "";
    const history = (model && model.vinHistory) || new Map();
    history.forEach((hist, vin) => {
      if (!vin || !hist || !hist.length) return;
      const resSnap = hist.find((h) => h && String(h.snapshotDate || h.dateKey || "").slice(0, 7) === month && isRES(h));
      if (!resSnap || !scopeMatch(resSnap)) return;
      const firstRes = hist.find((h) => h && isRES(h));
      const firstResDate = String((firstRes && (firstRes.snapshotDate || firstRes.dateKey)) || "");
      const priorNonRes = hist.some((h) => {
        const snap = String((h && (h.snapshotDate || h.dateKey)) || "");
        return !!(snap && firstResDate && snap < firstResDate && !isRES(h));
      });
      const addedLater = !!(firstFile && firstResDate > firstFile && firstResDate.slice(0, 7) === month);
      if (!priorNonRes && !addedLater) return;
      visit(Object.assign({}, resSnap, { vin, dateKey: firstResDate }));
    });
  }

  /**
   * SFX plan progress for one month.
   * Within = daily new-car VINs, matched on product + suffix.
   * Delivered = Sales Raw column V has a date.
   * Proforma, Reserved, and Stock come from the latest RTL secondary status description.
   * Any secondary status that is not listed is Reserved.
   * Swapped out = a later RTL day whose search area is not Retail Electronic Sales.
   * Swapped in = a VIN added to Retail Electronic Sales that is not a new car.
   */
  function buildSfxBuckets(model, monthKey) {
    const buckets = new Map();
    const take = (id) => {
      if (!buckets.has(id)) buckets.set(id, emptySfxBucket());
      return buckets.get(id);
    };
    const month = monthKey || currentMonthKey();
    const withinVins = new Set();
    receiptChartDays(model).filter((d) => d && String(d.dateKey).slice(0, 7) === month).forEach((day) => {
      (day.fileDayReceipts || []).forEach((row) => {
        if (!row || !row.vin || !scopeMatch(row) || withinVins.has(row.vin)) return;
        withinVins.add(row.vin);
        pushClassified(take(sfxBucketId(row)), row, classifyWithinFlags(model, row));
      });
    });
    eachSwappedIn(model, month, (row) => {
      if (withinVins.has(row.vin)) return;
      take(sfxBucketId(row)).swappedIn.push(row);
    });
    return buckets;
  }

  /** Same checks as SFX plan progress, totaled for each day. */
  function buildDayBuckets(model, monthKey) {
    const buckets = new Map();
    const take = (id) => {
      if (!buckets.has(id)) buckets.set(id, emptySfxBucket());
      return buckets.get(id);
    };
    const month = monthKey || currentMonthKey();
    const withinVins = new Set();
    receiptChartDays(model).filter((d) => d && String(d.dateKey).slice(0, 7) === month).forEach((day) => {
      const bucket = take(day.dateKey);
      (day.fileDayReceipts || []).forEach((row) => {
        if (!row || !row.vin || !scopeMatch(row) || withinVins.has(row.vin)) return;
        withinVins.add(row.vin);
        pushClassified(bucket, row, classifyWithinFlags(model, row));
      });
    });
    eachSwappedIn(model, month, (row) => {
      if (withinVins.has(row.vin) || !row.dateKey) return;
      take(row.dateKey).swappedIn.push(row);
    });
    return buckets;
  }

  function monthStatusTotals(model, monthKey) {
    const out = emptySfxBucket();
    buildDayBuckets(model, monthKey).forEach((bucket) => {
      Object.keys(out).forEach((key) => {
        out[key] = out[key].concat(bucket[key] || []);
      });
    });
    return out;
  }

  function rowsForOpen(spec, arg) {
    if (!lastModel) return { title: "VINs", sub: "", rows: [] };
    const pack = towerPack(lastModel);
    const key = String(spec || "");
    const totals = monthStatusTotals(lastModel);
    const kpi = {
      plan: ["Monthly plan", "Admin allocation target. This number is plan units, not VINs.", []],
      allocation: ["My allocation", "New cars this month", totals.within],
      received: ["Received / RES", "New cars this month", totals.within],
      delivered: ["Delivered", "Sales Raw column V", totals.delivered],
      proforma: ["Proforma", "Secondary status · DIO, pro-forma, registered, or reserved", totals.proforma],
      reserved: ["Reserved", "Secondary status · sales order created, damage block, or any other status", totals.reserved],
      stock: ["Stock", "Secondary status · allocation completed, vehicle damaged, or freeze", totals.stock],
      swapped: ["Swapped out", "A later RTL day is not Retail Electronic Sales", totals.swappedOut],
      in: ["Swapped in", "Added to Retail Electronic Sales · not a new car", totals.swappedIn],
      free: ["Free in my stock", "Secondary status · Vehicle allocation completed", pack.free],
      undef: ["Undefined", "My stock · secondary status is not Vehicle allocation completed", pack.undef],
    };
    if (kpi[key]) return { title: kpi[key][0], sub: kpi[key][1], rows: kpi[key][2] };
    if (key === "day") {
      const [dateKey, metric] = String(arg || "").split("~");
      const day = receiptChartDays(lastModel).find((d) => d.dateKey === dateKey)
        || (lastModel.daily || []).find((d) => d.dateKey === dateKey);
      const bucket = buildDayBuckets(lastModel).get(dateKey) || emptySfxBucket();
      const resRows = ((day && day.resRows) || []).filter(scopeMatch);
      const map = {
        res: resRows,
        allocation: bucket.within,
        within: bucket.within,
        delivered: bucket.delivered,
        proforma: bucket.proforma,
        reserved: bucket.reserved,
        stock: bucket.stock,
        swapped: bucket.swappedOut,
        swappedOut: bucket.swappedOut,
        in: bucket.swappedIn,
        swappedIn: bucket.swappedIn,
      };
      const label = (day && day.label) || dateKey;
      const titles = {
        res: ["RES", "Retail Electronic Sales in this RTL file"],
        allocation: ["My allocation", "New cars credited to this day"],
        delivered: ["Delivered", "Sales Raw column V"],
        proforma: ["Proforma", "Secondary status · DIO, pro-forma, registered, or reserved"],
        reserved: ["Reserved", "Secondary status · sales order created, damage block, or any other status"],
        stock: ["Stock", "Secondary status · allocation completed, vehicle damaged, or freeze"],
        swapped: ["Swapped out", "A later RTL day is not Retail Electronic Sales"],
        in: ["Swapped in", "Added to Retail Electronic Sales · not a new car"],
      };
      const named = titles[metric] || [metric || "VINs", dateKey];
      return { title: `${label} · ${named[0]}`, sub: named[1], rows: map[metric] || bucket.within };
    }
    if (key === "allocstatus") {
      const metric = String(arg || "within");
      const totals = monthStatusTotals(lastModel);
      const titles = {
        within: ["Allocation", "New cars this month"],
        delivered: ["Delivered", "Sales Raw column V"],
        proforma: ["Proforma", "Secondary status · DIO, pro-forma, registered, or reserved"],
        reserved: ["Reserved", "Secondary status · sales order created, damage block, or any other status"],
        stock: ["Stock", "Secondary status · allocation completed, vehicle damaged, or freeze"],
        swappedOut: ["Swapped out", "A later RTL day is not Retail Electronic Sales"],
        swappedIn: ["Swapped in", "Added to Retail Electronic Sales · not a new car"],
      };
      const named = titles[metric] || titles.within;
      return { title: named[0], sub: named[1], rows: totals[metric] || totals.within };
    }
    if (key === "product") {
      const [name, which] = String(arg || "").split("~");
      const rows = [];
      currentMonthReceiptDays(lastModel).forEach((day) => {
        (day.fileDayReceipts || []).forEach((r) => {
          if (!scopeMatch(r) || adminProductName(r) !== name) return;
          rows.push(r);
        });
      });
      if (which === "gap") {
        return { title: `${name} · gap`, sub: "Plan is the Admin Push target. These are the received VINs through the last submitted RTL day.", rows };
      }
      return { title: `${name} · received`, sub: `${currentMonthKey()} · Retail Electronic Sales · age matches the days since the allocation date`, rows };
    }
    if (key === "sfx") {
      const [id, metric] = String(arg || "").split("~");
      const buckets = buildSfxBuckets(lastModel);
      const bucket = buckets.get(id) || emptySfxBucket();
      const titles = {
        within: "Within",
        delivered: "Delivered · Sales Raw column V",
        proforma: "Proforma · secondary status",
        reserved: "Reserved · secondary status",
        stock: "Stock · secondary status",
        swappedOut: "Swapped out",
        swappedIn: "Swapped in",
      };
      return { title: `SFX · ${titles[metric] || "Within"}`, sub: id, rows: bucket[metric] || bucket.within };
    }
    if (key === "year") {
      const y = String(arg || "");
      return { title: `Model year ${y}`, sub: "Allocation VINs for this model year", rows: pack.scoped.filter((r) => String(r.year || "—") === y) };
    }
    return { title: "VINs", sub: "", rows: [] };
  }

  function openFromSpec(spec, arg) {
    const hit = rowsForOpen(spec, arg);
    openVinResults(hit.title, hit.sub, hit.rows);
  }

  function renderTower(model) {
    resetSalesLookup();
    if (!model) return;
    const dash = $("#pt-dash");
    if (!dash) return;
    const pack = towerPack(model);
    const cc = pack.cc;
    const scoped = pack.scoped;
    const schedAll = buildScheduleRows(model);
    const sched = schedAll.filter((r) => (!view.product || r.product === view.product) && (!view.sfx || r.sfx === view.sfx));
    const plan = sched.reduce((s, r) => s + (Number(r.allocation) || 0), 0);
    const statusTotals = monthStatusTotals(model);
    const within = statusTotals.within.length;
    const received = statusTotals.within.length;
    const counts = { Delivered: 0, Proforma: 0, "My Stock": 0, Swapped: 0 };
    scoped.forEach((r) => { counts[r.statusKey] = (counts[r.statusKey] || 0) + 1; });
    counts["My Stock"] = pack.stock.length;
    const stockAll = pack.stock;
    const gap = gapInfo(plan, within);
    const hint = $("#pt-live-hint");
    if (hint) {
      const label = model.monthKey || "—";
      hint.textContent = `${label} · Retail Electronic Sales (RTL)`;
    }
    const updated = $("#pt-updated");
    if (updated) {
      const stamp = model.refreshedAt instanceof Date ? model.refreshedAt : new Date();
      updated.textContent = stamp.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    const products = new Set(schedAll.map((r) => r.product).filter((p) => p && p !== "(unmatched)"));
    cc.register.forEach((r) => { if (r.leafProduct && r.leafProduct !== "—") products.add(r.leafProduct); });
    stockAll.forEach((r) => { if (r.leafProduct && r.leafProduct !== "—") products.add(r.leafProduct); });
    const sfxes = new Set();
    schedAll.forEach((r) => { if (r.sfx && r.sfx !== "—") sfxes.add(r.sfx); });
    const years = new Set();
    const areas = new Set();
    cc.register.forEach((r) => {
      if (r.year) years.add(String(r.year));
      if (r.searchArea) areas.add(r.searchArea);
    });
    stockAll.forEach((r) => {
      if (r.year) years.add(String(r.year));
      if (r.searchArea) areas.add(r.searchArea);
    });
    fillSelect("pt-f-product", products, view.product, "All products");
    fillSelect("pt-f-sfx", sfxes, view.sfx, "All SFX");
    fillSelect("pt-f-year", years, view.year, "All years");
    fillSelect("pt-f-area", areas, view.area, "All search areas");
    const statusEl = $("#pt-f-status");
    if (statusEl) {
      const cur = view.status;
      statusEl.innerHTML = `<option value="">All statuses</option>`
        + ["Proforma", "Reserved", "Stock", "Delivered", "Swapped out", "Swapped in"].map((s) => `<option value="${s}"${s === cur ? " selected" : ""}>${s}</option>`).join("");
    }
    $$("#pt-mode [data-pt-mode]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-pt-mode") === (view.mode || "daily"));
    });

    const monthLabel = $("#pt-month-label");
    if (monthLabel) monthLabel.textContent = model.monthKey || "Month";
    const kpis = [
      ["plan", "Monthly plan", plan, "Admin Push"],
      ["allocation", "My allocation", within, "New cars this month"],
      ["received", "Received / RES", received, "New cars this month"],
      ["delivered", "Delivered", statusTotals.delivered.length, "Sales Raw col V"],
      ["proforma", "Proforma", statusTotals.proforma.length, "Secondary status"],
      ["stock", "Stock", statusTotals.stock.length, "My stock · secondary status"],
      ["swapped", "Swapped out", statusTotals.swappedOut.length, "Later day left RES"],
    ];
    const kpiHost = $("#pt-kpis");
    if (kpiHost) {
      kpiHost.innerHTML = kpis.map(([key, label, value, sub]) => `<button type="button" class="pt-kpi pt-tone-${key}" data-pt-open="${key}">
          <span>${esc(label)}</span><strong>${num(value)}</strong><em>${esc(sub)}</em>
          ${key === "allocation" ? `<b class="${gap.cls}">${gap.word === "done" ? "Completed" : gap.word === "over" ? `Over ${num(gap.n)}` : `Gap ${num(gap.n)}`}</b>` : ""}
        </button>`).join("");
    }
    const indHost = $("#pt-indicators");
    if (indHost) {
      const inds = [
        ["reserved", "Reserved", statusTotals.reserved.length, ""],
        ["in", "Swapped in", statusTotals.swappedIn.length, statusTotals.swappedIn.length ? "is-swap-in" : ""],
      ];
      indHost.innerHTML = inds.map(([key, label, value, cls]) => `<button type="button" class="pt-ind${cls ? ` ${cls}` : ""}" data-pt-open="${key}"><span>${esc(label)}</span><strong>${num(value)}</strong></button>`).join("");
    }

    const byProduct = new Map();
    sched.forEach((r) => {
      if (!r || r.product === "(unmatched)") return;
      const g = byProduct.get(r.product) || { product: r.product, plan: 0, mtd: 0 };
      g.plan += Number(r.allocation) || 0;
      byProduct.set(r.product, g);
    });
    const submittedDays = currentMonthReceiptDays(model);
    submittedDays.forEach((d) => {
      (d.fileDayReceipts || []).forEach((r) => {
        if (!scopeMatch(r)) return;
        const key = adminProductName(r);
        const g = byProduct.get(key) || { product: key, plan: 0, mtd: 0 };
        g.mtd += 1;
        byProduct.set(key, g);
      });
    });
    const prodHost = $("#pt-product");
    if (prodHost) {
      const rows = [...byProduct.values()].filter((r) => r.plan > 0 || r.mtd > 0)
        .sort((a, b) => String(a.product).localeCompare(String(b.product)));
      prodHost.innerHTML = `<table class="pt-table"><thead><tr><th>Product</th><th>Plan</th><th>Received</th><th>%</th><th>Gap</th></tr></thead><tbody>${
        rows.map((r) => {
          const g = gapInfo(r.plan, r.mtd);
          const pct = r.plan ? `${Math.round((r.mtd / r.plan) * 1000) / 10}%` : "—";
          return `<tr><td><button type="button" class="pt-link" data-pt-open="product" data-pt-arg="${esc(r.product)}~all">${esc(r.product)}</button></td>
            <td class="num">${num(r.plan)}</td><td class="num">${numBtn(r.mtd, "product", `data-pt-arg="${esc(r.product)}~allocation"`)}</td><td class="num">${pct}</td>
            <td class="num ${g.cls}">${numBtn(g.n, "product", `data-pt-arg="${esc(r.product)}~gap"`)}</td></tr>`;
        }).join("") || `<tr><td colspan="5">No Admin plan or receipts for this filter.</td></tr>`
      }</tbody></table>`;
    }

    const sfxHost = $("#pt-sfx");
    if (sfxHost) {
      const sfxBuckets = buildSfxBuckets(model);
      sfxHost.innerHTML = `<table class="pt-table"><thead><tr>
        <th>SFX</th><th>Plan</th><th>Within</th><th>Delivered</th><th>Proforma</th><th>Reserved</th><th>Stock</th><th>Swapped out</th><th>Swapped in</th><th>%</th>
      </tr></thead><tbody>${
        sched.map((r) => {
          const bucket = sfxBuckets.get(r.id) || emptySfxBucket();
          const pct = r.allocation ? `${Math.round((bucket.within.length / r.allocation) * 1000) / 10}%` : "—";
          const id = r.id || "";
          const arg = (metric) => `data-pt-arg="${esc(id)}~${metric}"`;
          return `<tr><td><button type="button" class="pt-link" data-pt-open="sfx" data-pt-arg="${esc(id)}~within">${esc(r.product)} ${esc(r.sfx)}</button></td>
            <td class="num">${num(r.allocation)}</td>
            <td class="num">${numBtn(bucket.within.length, "sfx", arg("within"))}</td>
            <td class="num">${numBtn(bucket.delivered.length, "sfx", arg("delivered"))}</td>
            <td class="num">${numBtn(bucket.proforma.length, "sfx", arg("proforma"))}</td>
            <td class="num">${numBtn(bucket.reserved.length, "sfx", arg("reserved"))}</td>
            <td class="num">${numBtn(bucket.stock.length, "sfx", arg("stock"))}</td>
            <td class="num">${numBtn(bucket.swappedOut.length, "sfx", arg("swappedOut"))}</td>
            <td class="num">${numBtn(bucket.swappedIn.length, "sfx", arg("swappedIn"), bucket.swappedIn.length ? "is-swap-in" : "")}</td>
            <td class="num">${pct}</td></tr>`;
        }).join("") || `<tr><td colspan="10">No SFX rows.</td></tr>`
      }</tbody></table>`;
    }

    const monthKey = currentMonthKey();
    const days = currentMonthReceiptDays(model);
    const labels = days.map((d) => d.label);
    const fileDayRows = (d) => (d.fileDayReceipts || []).filter((r) => scopeMatch(r));
    const allocDaily = days.map((d) => fileDayRows(d).length);
    let runA = 0;
    const cumA = allocDaily.map((n) => { runA += n; return runA; });
    const cumulative = view.mode === "cumulative";
    const missing = model.missingDates || [];
    const note = $("#pt-chart-note");
    if (note) {
      note.textContent = days.length
        ? `${monthKey} · new cars · Retail Electronic Sales · age 0 on the file day, plus later files where age matches the days since the allocation date`
        : `No RTL file submitted for ${monthKey}`;
    }
    const planLine = (label, color, dash) => ({
      type: "line",
      label,
      data: days.map(() => plan),
      borderColor: color,
      borderDash: dash,
      pointRadius: 0,
      yAxisID: "plan",
      order: 0,
    });
    const datasets = [
      {
        type: "bar",
        label: "New cars",
        data: allocDaily,
        backgroundColor: "#2563EB",
        hoverBackgroundColor: "#3B82F6",
        borderRadius: 3,
        order: 2,
      },
    ];
    if (cumulative) {
      datasets.push({
        type: "line",
        label: "Cumulative allocation",
        data: cumA,
        borderColor: "#3B82F6",
        backgroundColor: "#3B82F6",
        tension: 0.2,
        pointRadius: 2,
        order: 1,
      });
      datasets.push(planLine("Admin plan", "#2563EB", [4, 3]));
      datasets.push(planLine("Cumulative plan", "#3B82F6", [1, 3]));
    }
    makeChart("pt-chart-daily", {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 8, bottom: 2, left: 4 } },
        plugins: {
          legend: {
            position: "bottom",
            align: "center",
            labels: { boxWidth: 10, padding: 12, font: { size: 10 }, color: "#64748B" },
          },
          tooltip: {
            backgroundColor: "#FFFFFF",
            titleColor: "#172033",
            bodyColor: "#172033",
            borderColor: "#DCE3EC",
            borderWidth: 1,
          },
        },
        scales: Object.assign({
          x: {
            ticks: { align: "center", crossAlign: "center", font: { size: 9 }, maxRotation: 0, autoSkip: false, color: "#64748B" },
            grid: { color: "rgba(229, 231, 235, 0.8)" },
            border: { color: "#E5E7EB" },
          },
          y: {
            beginAtZero: true,
            position: "left",
            ticks: { align: "center", crossAlign: "center", precision: 0, font: { size: 10 }, color: "#64748B" },
            grid: { color: "rgba(229, 231, 235, 0.8)" },
            border: { color: "#E5E7EB" },
          },
        }, cumulative ? {
          plan: {
            beginAtZero: true,
            position: "right",
            grid: { drawOnChartArea: false },
            ticks: { align: "center", crossAlign: "center", precision: 0, font: { size: 10 }, color: "#64748B" },
            border: { color: "#E5E7EB" },
          },
        } : {}),
        onClick: (_evt, els) => {
          if (!els.length) return;
          const day = days[els[0].index];
          if (!day) return;
          openVinResults(
            `${day.label} · new cars`,
            "Retail Electronic Sales · age 0 on this file day, or a later file whose age points back to this allocation date",
            fileDayRows(day)
          );
        },
      },
    });

    const statusSlices = [
      { key: "delivered", label: "Delivered", n: statusTotals.delivered.length, color: "#16A34A" },
      { key: "proforma", label: "Proforma", n: statusTotals.proforma.length, color: "#7C3AED" },
      { key: "reserved", label: "Reserved", n: statusTotals.reserved.length, color: "#2563EB" },
      { key: "stock", label: "Stock", n: statusTotals.stock.length, color: "#F59E0B" },
      { key: "swappedOut", label: "Swapped out", n: statusTotals.swappedOut.length, color: "#DC2626" },
      { key: "swappedIn", label: "Swapped in", n: statusTotals.swappedIn.length, color: "#EF4444" },
    ];
    makeChart("pt-chart-status", {
      type: "doughnut",
      data: {
        labels: statusSlices.map((s) => s.label),
        datasets: [{
          data: statusSlices.map((s) => s.n),
          backgroundColor: statusSlices.map((s) => s.color),
          borderColor: "#FFFFFF",
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        layout: { padding: { top: 4, right: 4, bottom: 0, left: 4 } },
        onResize() { placeDonutMid(); },
        animation: { onComplete() { placeDonutMid(); } },
        plugins: {
          legend: {
            position: "bottom",
            align: "center",
            labels: {
              boxWidth: 8,
              padding: 10,
              font: { size: 10 },
              color: "#64748B",
              generateLabels(chart) {
                const dataset = chart.data.datasets[0];
                return chart.data.labels.map((label, i) => ({
                  text: `${label} ${dataset.data[i]}`,
                  fillStyle: dataset.backgroundColor[i],
                  strokeStyle: dataset.backgroundColor[i],
                  lineWidth: 0,
                  hidden: false,
                  index: i,
                }));
              },
            },
          },
        },
        onClick: (_evt, els) => {
          if (!els.length) return;
          const slice = statusSlices[els[0].index];
          if (slice) openFromSpec("allocstatus", slice.key);
        },
      },
    });
    const mid = $("#pt-donut-mid");
    if (mid) mid.innerHTML = `<strong>${num(statusTotals.within.length)}</strong><span>Total</span>`;
    placeDonutMid();

    const dayHost = $("#pt-daily-count");
    if (dayHost) {
      const dayBuckets = buildDayBuckets(model);
      const cell = (n, dateKey, metric, cls) => `<td class="num">${numBtn(n, "day", `data-pt-arg="${esc(dateKey)}~${metric}"`, cls || "")}</td>`;
      const body = days.map((d) => {
        const bucket = dayBuckets.get(d.dateKey) || emptySfxBucket();
        const resN = (d.resRows || []).filter((r) => scopeMatch(r)).length;
        return `<tr><td>${esc(d.label)}</td><td class="num">—</td>
          ${cell(resN, d.dateKey, "res")}
          ${cell(bucket.within.length, d.dateKey, "allocation")}
          ${cell(bucket.delivered.length, d.dateKey, "delivered")}
          ${cell(bucket.proforma.length, d.dateKey, "proforma")}
          ${cell(bucket.reserved.length, d.dateKey, "reserved")}
          ${cell(bucket.stock.length, d.dateKey, "stock")}
          ${cell(bucket.swappedOut.length, d.dateKey, "swapped")}
          ${cell(bucket.swappedIn.length, d.dateKey, "in", bucket.swappedIn.length ? "is-swap-in" : "")}</tr>`;
      }).join("");
      const missingRow = missing.length
        ? `<tr><td colspan="10">Missing RTL snapshot: ${esc(missing.join(", "))}</td></tr>`
        : "";
      dayHost.innerHTML = `<table class="pt-table"><thead><tr>
        <th>Day</th><th>Plan</th><th>RES</th><th>My allocation</th><th>Delivered</th><th>Proforma</th><th>Reserved</th><th>Stock</th>
        <th>Swapped out</th><th>Swapped in</th>
      </tr></thead><tbody>${body || `<tr><td colspan="10">No RTL files for this month.</td></tr>`}${missingRow}
      </tbody></table>`;
    }

    const todayKey = todayDateKey(model.monthKey);
    const allocationRows = statusTotals.within.map((r) => presentReceiptRow(model, r, "within"));
    const inRows = statusTotals.swappedIn.map((r) => presentReceiptRow(model, r, "in"));
    const byVin = new Map(allocationRows.map((r) => [r.vin, r]));
    const pick = (list) => list.map((r) => byVin.get(r.vin)).filter(Boolean);
    const stockRows = pick(statusTotals.stock);
    const reservedRows = pick(statusTotals.reserved);
    const swappedRows = pick(statusTotals.swappedOut);
    const todayRows = allocationRows.filter((r) => creditDayOf(r) === todayKey);
    const allRows = allocationRows.concat(inRows);
    const deliveredRows = allRows.filter((r) => r.colVDelivered);
    const proformaRows = pick(statusTotals.proforma);
    const tabCounts = {
      all: allRows.length,
      allocation: allocationRows.length,
      today: todayRows.length,
      stock: stockRows.length,
      reserved: reservedRows.length,
      proforma: proformaRows.length,
      delivered: deliveredRows.length,
      swapped: swappedRows.length,
      in: inRows.length,
    };
    const tabs = $("#pt-tabs");
    if (tabs) {
      const defs = [
        ["all", "All"],
        ["allocation", "My allocation"],
        ["today", "Today"],
        ["stock", "Stock"],
        ["reserved", "Reserved"],
        ["proforma", "Proforma"],
        ["delivered", "Delivered"],
        ["swapped", "Swapped out"],
        ["in", "Swapped in"],
      ];
      tabs.innerHTML = defs.map(([id, label]) => `<button type="button" class="${view.tab === id ? "is-on" : ""}" data-pt-tab="${id}">${label} (${num(tabCounts[id] || 0)})</button>`).join("");
    }
    const pin = $("#pt-pin");
    if (pin) {
      if (view.vinPin && view.vinPin.size) {
        pin.hidden = false;
        pin.textContent = view.scheduleTitle || `${view.vinPin.size} schedule VIN(s)`;
      } else pin.hidden = true;
    }
    let tableRows = allRows;
    if (view.tab === "allocation") tableRows = allocationRows;
    else if (view.tab === "today") tableRows = todayRows;
    else if (view.tab === "stock") tableRows = stockRows;
    else if (view.tab === "reserved") tableRows = reservedRows;
    else if (view.tab === "proforma") tableRows = proformaRows;
    else if (view.tab === "delivered") tableRows = deliveredRows;
    else if (view.tab === "swapped") tableRows = swappedRows;
    else if (view.tab === "in") tableRows = inRows;
    vinPaintRows = tableRows;
    const sc = $("#pt-vin-scroll");
    paintVinWindow();

    const q = model.quality || {};
    const qBody = $("#pt-quality-body");
    if (qBody) {
      const items = [
        ["Unique within-allocation VINs", within],
        ["Duplicate VIN observations", q.duplicateVin || 0],
        ["Missing VIN", q.blankVin || 0],
        ["Missing product", cc.missingProduct],
        ["Missing SFX", cc.missingSfx],
        ["Missing allocation date", q.missingAllocationDate || 0],
        ["Missing search area", q.missingArea || 0],
        ["Invalid allocation age", q.invalidAge || 0],
        ["Sales Raw unmatched", cc.unmatchedSales],
      ];
      qBody.innerHTML = `<ul class="pt-q-list">${items.map(([l, n]) => `<li><span>${esc(l)}</span><b>${num(n)}</b></li>`).join("")}</ul>`;
    }
    const qBtn = $("#pt-quality-open");
    if (qBtn) qBtn.textContent = `Quality ${num(model.qualityScore || 0)}`;

    const recon = $("#pt-recon-body");
    if (recon) {
      const unmatched = schedAll.find((r) => r.id === "__unmatched__");
      const notReceived = schedAll.filter((r) => r.id !== "__unmatched__" && r.allocation > 0 && r.mtd === 0).length;
      const files = model.rtlFiles || [];
      const lines = [
        `RTL file count ${num(files.length)}`,
        `Loaded daily files ${num(days.length)}`,
        `Missing dates ${missing.length ? missing.join(", ") : "none"}`,
        `Admin plan ${num(plan)}`,
        `RES age 0 unique ${num(received)}`,
        `Within allocation ${num(within)}`,
        `Status total ${num(counts.Delivered + counts.Proforma + counts["My Stock"] + counts.Swapped)}`,
        `Plan gap ${gap.word === "over" ? "over " : ""}${num(gap.n)} (${gap.word})`,
      ];
      const warns = cc.warnings.slice();
      if (unmatched && unmatched.mtd) warns.push(`${unmatched.mtd} within-allocation VIN(s) do not match an Admin product + SFX.`);
      if (notReceived) warns.push(`${notReceived} Admin SFX row(s) have a plan and zero receipts.`);
      if (q.duplicateVin) warns.push(`${q.duplicateVin} duplicate VIN observation(s) inside a daily file. The first row is kept.`);
      if (q.missingAllocationDate) warns.push(`${q.missingAllocationDate} row(s) have no allocation date.`);
      if (q.invalidAge) warns.push(`${q.invalidAge} row(s) have a blank allocation age.`);
      missing.forEach((k) => warns.push(`MISSING RTL SNAPSHOT: ${k}`));
      const fileRows = files.map((f) => `<tr>
        <td>${esc(f.fileName || "—")}</td>
        <td>${esc(f.dateKey)}</td>
        <td>${esc(f.sheetUsed || "Sheet 1")}</td>
        <td class="num">${num(f.totalRows)}</td>
        <td class="num">${num(f.uniqueVins)}</td>
        <td class="num">${num(f.res)}</td>
        <td class="num">${num(f.allocation)}</td>
      </tr>`).join("");
      recon.innerHTML = `<ul class="pt-q-list">${lines.map((l) => `<li><span>${esc(l)}</span></li>`).join("")}</ul>
        <h4>RTL files found this month</h4>
        <div class="pt-scroll">
          <table class="pt-table"><thead><tr>
            <th>File</th><th>Detected date</th><th>Worksheet</th><th>Rows</th><th>Unique VINs</th><th>RES</th><th>My allocation</th>
          </tr></thead><tbody>${fileRows || `<tr><td colspan="7">No RTL files loaded.</td></tr>`}</tbody></table>
        </div>
        <h4>Warnings</h4>
        <ul class="pt-warn">${warns.length ? warns.map((w) => `<li>${esc(w)}</li>`).join("") : "<li>No warnings on this filter.</li>"}</ul>`;
    }

    renderSchedule(model);
    if (sc && !sc.dataset.bound) {
      sc.dataset.bound = "1";
      sc.addEventListener("scroll", () => paintVinWindow());
      sc.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-pt-vin]");
        if (!btn) return;
        openVinDrawer(btn.getAttribute("data-pt-vin"));
      });
    }
    syncPtCharts();
  }

  function renderAll(model) {
    lastModel = model;
    const empty = $("#pt-empty");
    const dash = $("#pt-dash");
    if (isTower()) {
      if (empty) empty.hidden = true;
      if (dash) dash.hidden = false;
      renderTower(model);
      return;
    }
    if (!model.dateKeys.length) {
      if (empty) empty.hidden = false;
      if (dash) dash.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (dash) dash.hidden = false;
    const hint = $("#pt-live-hint");
    if (hint) {
      hint.textContent = `${model.dateKeys.length} snapshot(s) · ${model.monthKey || "—"} · latest ${model.latestKey || "—"} · this month ${model.kpis.allocated} · free stock ${model.kpis.freeStock || 0} · total ${model.kpis.totalReceived || 0} · plan ${model.plan}`;
    }
    fillFilters(model);
    renderKpis(model);
    renderProgress(model);
    renderFreeStock(model);
    renderYesterday(model);
    renderSchedule(model);
    renderDailyTable(model);
    renderAge0(model);
    renderCorridor(model);
    renderMatrix(model);
    renderMovements(model);
    renderQuality(model);
    renderVinSearch(model);
    renderInventory(model);
    renderDrill(model);
    renderCharts(model);
  }

  function exportExcel() {
    if (!lastModel || typeof global.XLSX === "undefined") {
      if (typeof global.setStatus === "function") global.setStatus("Nothing to export", "err");
      return;
    }
    const XLSX = global.XLSX;
    const wb = XLSX.utils.book_new();
    const daily = (lastModel.daily || []).map((d) => ({
      Date: d.dateKey,
      "Daily RES Age 0": d.dailyUniqueRESAge0 != null ? d.dailyUniqueRESAge0 : d.age0Target,
      "Plan Allocations": d.newPlanAllocations != null ? d.newPlanAllocations : ((d.planReceipts && d.planReceipts.length) || 0),
      "Free Stock": d.freeStockCount != null ? d.freeStockCount : ((d.freeStock && d.freeStock.length) || 0),
      "Transfers IN": d.transferIn.length,
      "Transfers OUT": d.transferOut.length,
      "Disappeared RES": d.disappearedTarget || 0,
      "Current RES": d.resTotal,
      "Cumulative Plan": d.cumulativePlanAllocations != null ? d.cumulativePlanAllocations : 0,
      Remaining: d.remaining != null ? d.remaining : 0,
      "Progress %": d.progress != null ? Math.round(d.progress * 1000) / 10 : 0,
      "Expected RES": d.expectedRES != null ? d.expectedRES : d.impliedRes,
      "Actual RES": d.actualRES != null ? d.actualRES : d.resTotal,
      ReconDiff: d.reconDiff,
    }));
    const moves = filteredMovements(lastModel).map((r) => ({
      Snapshot: r.snapshotDate,
      VIN: r.vin,
      Product: r.product,
      Suffix: r.suffix,
      Year: r.year,
      "Previous Area": r.previousSearchArea,
      "Current Area": r.currentSearchArea,
      "Prev Alloc Date": fmtDate(r.previousAllocationDate),
      "Curr Alloc Date": fmtDate(r.currentAllocationDate),
      "Prev Age": r.previousAllocationAge,
      "Curr Age": r.currentAllocationAge,
      Movement: r.movementType,
      Status: r.currentStatus || r.previousStatus,
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(daily), "Daily");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(moves), "Movements");
    const sched = (lastModel.scheduleRows || buildScheduleRows(lastModel)).map((r) => {
      const out = {
        Seg: r.seg,
        Product: r.product,
        SFX: r.sfx,
        Plan: r.allocation,
        MTD: r.mtd,
        Gap: r.allocation - r.mtd,
      };
      for (let d = 1; d <= monthLength(lastModel.monthKey); d += 1) out[`D${d}`] = r.dayCounts[d] || 0;
      return out;
    });
    if (sched.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sched), "Schedule");
    const freeRows = (lastModel.lists.freeStock || []).map((r) => ({
      VIN: r.vin,
      Product: r.product,
      Suffix: r.suffix,
      "Alloc Date": fmtDate(r.allocationDate),
      Age: r.allocationAge,
      "Search Area": r.searchArea,
      Location: r.location,
      Status: r.status,
      Bucket: "Free stock · prior month",
    }));
    if (freeRows.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(freeRows), "Free Stock");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      (lastModel.lists.current || []).map((r) => ({
        VIN: r.vin,
        Product: r.product,
        Suffix: r.suffix,
        "Alloc Date": fmtDate(r.allocationDate),
        Age: r.allocationAge,
        Location: r.location,
        Status: r.status,
      }))
    ), "Current RES");
    XLSX.writeFile(wb, `plan-tracker-${lastModel.latestKey || "export"}.xlsx`);
    if (typeof global.setStatus === "function") global.setStatus("Plan Tracker Excel exported", "ok");
  }

  async function render(opts) {
    bindUi();
    const empty = $("#pt-empty");
    const dash = $("#pt-dash");
    const loading = $("#pt-loading");
    if (loading) loading.hidden = false;

    let ctx = typeof global.basMonthContext === "function" ? global.basMonthContext() : null;
    if (!ctx || !ctx.monthKey) {
      const now = new Date();
      const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      ctx = { monthKey: mk, monthLabel: mk };
    }
    let mk = ctx.monthKey;
    if (opts && opts.monthKey) {
      mk = opts.monthKey;
      view.monthKey = mk;
      view.monthLocked = true;
    } else if (view.monthLocked && view.monthKey) {
      mk = view.monthKey;
    } else {
      view.monthLocked = false;
      view.monthKey = ctx.monthKey;
      mk = ctx.monthKey;
    }

    let pack = null;
    if (typeof global.ensureRtlActiveMonth === "function") {
      pack = await global.ensureRtlActiveMonth(mk, !!(opts && opts.force));
    } else if (typeof global.getCachedRtlActiveMonth === "function") {
      pack = global.getCachedRtlActiveMonth(mk);
    }

    if (loading) loading.hidden = true;

    const model = buildModel(pack || { month: mk, days: {} }, { plan: adminPlanTotal() });
    if (!model.monthKey) model.monthKey = mk;
    model.refreshedAt = new Date();
    renderAll(model);
  }

  function exportPlanTrackerDebug() {
    const debug = (lastModel && lastModel.planTrackerDebug) || global.planTrackerDebug || [];
    const blob = new Blob([JSON.stringify(debug, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `plan-tracker-debug-${(lastModel && lastModel.latestKey) || "export"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (typeof global.setStatus === "function") global.setStatus("planTrackerDebug JSON exported", "ok");
    return debug;
  }

  global.PlanTracker = {
    TARGET_SEARCH_AREA,
    ALLOCATION_PLAN,
    render,
    buildModel,
    buildScheduleRows,
    buildControlCenter,
    myStockRows,
    swappedInList,
    isVehicleAllocationCompleted,
    buildSfxBuckets,
    buildDayBuckets,
    monthStatusTotals,
    classifyVinStatus,
    normalizeVin,
    isRES,
    isPlanScheduleReceipt,
    isPriorMonthFreeStock,
    exportPlanTrackerDebug,
    getDebug: () => (lastModel && lastModel.planTrackerDebug) || global.planTrackerDebug || [],
    getModel: () => lastModel,
    view,
  };
})(typeof window !== "undefined" ? window : globalThis);
