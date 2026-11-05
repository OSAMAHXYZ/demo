/**
 * Zone Tracker — Plan Tracker's Retail Electronic Sales counting rules run for every zone.
 * Zone = Search Area Desc (dayVehicleSearchArea / car.searchAreaDesc). Sharing Level is only a column + filter.
 * Data source: Data Uploader RTL daily snapshots (/api/rtl-daily/active-month), via helpers exposed by
 * renderZoneTrackerPanel() in index.html.
 */
(function (global) {
  "use strict";

  const RES_ZONE = "Retail Electronic Sales";
  const NOT_IN_FILE = "(not in day file)";
  const BLANK_ZONE = "(No search area)";
  const USAGE_COLS = [
    ["sales", "Sales"],
    ["showroom", "Showroom Display"],
    ["fast", "Fast Moving Stock"],
    ["damaged", "Damaged B+C"],
    ["other", "Other usage"],
  ];
  const STATUS_LABELS = { delivered: "Delivered", proforma: "Proforma", free: "Free in stock" };
  const KIND_LABELS = {
    received: "Received",
    "transfer-in": "Transfer in",
    "moved-out": "Moved out",
    free: "Free stock",
  };

  const view = {
    monthKey: "",
    monthLocked: false,
    mode: "cumulative",
    day: 0,
    zone: "",
    sharing: "",
    product: "",
    sfx: "",
    usage: "",
    status: "",
    q: "",
    moveKind: "",
  };
  const charts = {};
  let lastModel = null;
  let uiBound = false;
  let drills = [];
  let modalRows = [];

  /* ---------- small helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
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
  /** isRetailElectronicSales generalised: one key per zone so case/spacing never split a zone. */
  function zoneKey(desc) {
    return normHeader(desc || "");
  }
  function isResKey(key) {
    const t = zoneKey(RES_ZONE);
    return key === t || String(key || "").includes(t);
  }
  function vinOf(car) {
    const ex = typeof global.extractVinValue === "function" ? global.extractVinValue(car && car.vin) : "";
    if (ex) return ex;
    return typeof global.upperTrim === "function"
      ? global.upperTrim(car && car.vin)
      : String((car && car.vin) || "").trim().toUpperCase();
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtShort(d) {
    return d instanceof Date && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : "";
  }
  function usageKey(u) {
    const n = normHeader(u);
    if (!n) return "other";
    if (n.includes("showroom") || n.includes("display")) return "showroom";
    if (n.includes("fast moving") || n.includes("fms")) return "fast";
    if (n.includes("damag")) return "damaged";
    if (n.includes("sale")) return "sales";
    return "other";
  }
  function sharingOf(v) {
    if (typeof global.dayVehicleField !== "function") return "";
    return global.dayVehicleField(v, ["sharingLevel", "sharing level", "share level", "stock sharing level"]) || "";
  }
  function isDev() {
    try {
      const h = String(location.hostname || "");
      return h === "localhost" || h === "127.0.0.1" || /[?&]ztdebug=1\b/.test(location.search)
        || localStorage.getItem("zt_debug") === "1";
    } catch (_) {
      return false;
    }
  }

  /** Same month context Plan Tracker uses; other months count every day of that month. */
  function monthCtx(mk) {
    const cur = typeof global.basMonthContext === "function" ? global.basMonthContext() : null;
    if (cur && cur.monthKey === mk) return { ...cur, isCurrent: true };
    const [y, m] = mk.split("-").map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const curKey = cur ? cur.monthKey : "";
    const future = curKey && mk > curKey;
    const today = new Date(y, m - 1, daysInMonth);
    return {
      y,
      m: m - 1,
      monthKey: mk,
      monthLabel: new Date(y, m - 1, 1).toLocaleString("en", { month: "long", year: "numeric" }),
      daysInMonth,
      todayDay: future ? 0 : daysInMonth,
      today,
      isCurrent: false,
    };
  }

  /* ---------- counting engine ---------- */
  function emptyZone(key, label) {
    return {
      key,
      label,
      received: [],
      free: [],
      transferIn: [],
      movedOut: [],
      late: [],
      current: [],
    };
  }

  function buildZoneModel(pack, ctx) {
    const dayFiles = pack && pack.days && typeof pack.days === "object" ? pack.days : {};
    const keys = Object.keys(dayFiles).sort();
    let salesLookup = new Map();
    try {
      if (typeof global.buildSalesVinLookup === "function") salesLookup = global.buildSalesVinLookup();
    } catch (_) { /* Sales Raw optional */ }
    const salesCache = new Map();
    const salesOf = (vin) => {
      if (salesCache.has(vin)) return salesCache.get(vin);
      const s = typeof global.basDaySalesBucket === "function"
        ? global.basDaySalesBucket(vin, salesLookup)
        : { bucket: "free", label: STATUS_LABELS.free };
      salesCache.set(vin, s);
      return s;
    };

    const zones = new Map();
    const zoneOf = (key, label) => {
      if (!zones.has(key)) zones.set(key, emptyZone(key, label || key || BLANK_ZONE));
      return zones.get(key);
    };
    const firstZoneByVin = new Map();
    const lastZoneByVin = new Map();
    const everInZone = new Map();
    const dayTot = Array(32).fill(0);
    const fileDays = [];
    const events = [];
    let prevZoneOf = new Map();
    let latest = null;

    keys.forEach((dateKey) => {
      if (String(dateKey).slice(0, 7) !== ctx.monthKey) return;
      const dayNum = Number(String(dateKey).slice(8, 10));
      if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > ctx.daysInMonth || dayNum > ctx.todayDay) return;
      const snap = dayFiles[dateKey];
      const vehicles = (snap && snap.vehicles) || [];
      const thisZoneOf = new Map();

      vehicles.forEach((v, i) => {
        const car = global.mapRtlDailyVehicle(v, dateKey, snap && snap.id, i);
        const vin = vinOf(car);
        if (!vin || thisZoneOf.has(vin)) return;
        const zoneRaw = (typeof global.dayVehicleSearchArea === "function" ? global.dayVehicleSearchArea(v) : "")
          || car.searchAreaDesc || "";
        const zk = zoneKey(zoneRaw);
        const zone = zoneOf(zk, String(zoneRaw).trim() || BLANK_ZONE);
        const agDate = typeof global.dayVehicleAgDate === "function" ? global.dayVehicleAgDate(v) : null;
        const age = car.ageing == null || !Number.isFinite(car.ageing) ? null : Math.floor(car.ageing);
        const leaf = typeof global.matchRtlToAllocLeaf === "function" ? global.matchRtlToAllocLeaf(car) : null;
        const base = {
          vin,
          product: leaf ? leaf.product : (car.product || "—"),
          suffix: leaf ? leaf.sfx : (car.suffix || "—"),
          rawProduct: car.product || "—",
          rawSuffix: car.suffix || "—",
          seg: leaf ? leaf.seg : "—",
          leafId: leaf ? leaf.id : "",
          year: car.year || "",
          ext: car.ext || "",
          int: car.int || "",
          age,
          agDate,
          agLabel: fmtShort(agDate),
          location: car.location || "—",
          status: car.status || "",
          usage: car.usage || "—",
          usageKey: usageKey(car.usage),
          sharing: sharingOf(v) || "—",
          zoneKey: zk,
          zone: zone.label,
          day: dayNum,
          dateKey,
        };
        thisZoneOf.set(vin, base);
        if (!firstZoneByVin.has(vin)) firstZoneByVin.set(vin, zk);
        if (age === 0) dayTot[dayNum] += 1;

        let seen = everInZone.get(zk);
        if (!seen) {
          seen = new Set();
          everInZone.set(zk, seen);
        }
        if (seen.has(vin)) return;
        seen.add(vin);

        if (firstZoneByVin.get(vin) !== zk) {
          const prev = prevZoneOf.get(vin);
          const ev = {
            ...base,
            kind: "transfer-in",
            fromZone: prev ? prev.zone : (lastZoneByVin.get(vin) || "(other zone)"),
            toZone: zone.label,
          };
          zone.transferIn.push(ev);
          events.push(ev);
        } else if (age === 0 && global.basAgSameAsFileDay(agDate, dayNum, ctx)) {
          const ev = {
            ...base,
            kind: "received",
            arrivalKind: "new-zone",
            collectionDay: dayNum,
            isTodayArrival: dayNum === ctx.todayDay,
            fromZone: "",
            toZone: zone.label,
          };
          zone.received.push(ev);
          events.push(ev);
        } else {
          const ev = {
            ...base,
            kind: "free",
            arrivalKind: "free-stock",
            collectionDay: global.basScheduleDayFromAg(agDate, dayNum, ctx),
            fromZone: "",
            toZone: zone.label,
          };
          zone.free.push(ev);
          events.push(ev);
        }
      });

      prevZoneOf.forEach((prev, vin) => {
        const now = thisZoneOf.get(vin);
        if (now && now.zoneKey === prev.zoneKey) return;
        const ev = now
          ? {
            ...now,
            product: now.product !== "—" ? now.product : prev.product,
            suffix: now.suffix !== "—" ? now.suffix : prev.suffix,
            kind: "moved-out",
            fromZoneKey: prev.zoneKey,
            fromZone: prev.zone,
            toZone: now.zone,
          }
          : {
            ...prev,
            day: dayNum,
            dateKey,
            kind: "moved-out",
            fromZoneKey: prev.zoneKey,
            fromZone: prev.zone,
            toZone: NOT_IN_FILE,
          };
        zoneOf(prev.zoneKey).movedOut.push(ev);
        events.push(ev);
      });

      thisZoneOf.forEach((b, vin) => lastZoneByVin.set(vin, b.zone));
      prevZoneOf = thisZoneOf;
      latest = { dateKey, day: dayNum, rows: thisZoneOf, fileName: (snap && snap.fileName) || "" };
      fileDays.push({
        day: dayNum,
        dateKey,
        label: new Date(ctx.y, ctx.m, dayNum).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        count: thisZoneOf.size,
        tot: dayTot[dayNum],
        fileName: (snap && snap.fileName) || "",
      });
    });

    const todayKey = `${ctx.monthKey}-${pad2(ctx.todayDay)}`;
    const lateFile = latest && (latest.dateKey === todayKey || !ctx.isCurrent) ? latest : null;
    if (latest) {
      latest.rows.forEach((r) => {
        const s = salesOf(r.vin);
        const row = { ...r, salesBucket: s.bucket, salesLabel: s.label, proformaDate: s.proformaDate, invoiceDate: s.invoiceDate };
        const zone = zoneOf(r.zoneKey);
        zone.current.push(row);
        if (lateFile && r.leafId && r.age != null && r.age >= 1) zone.late.push({ ...row, kind: "late", isLate: true });
      });
    }
    events.forEach((ev) => {
      const s = salesOf(ev.vin);
      ev.salesBucket = s.bucket;
      ev.salesLabel = s.label;
    });

    return {
      ctx,
      pack,
      zones,
      events,
      fileDays,
      dayTot,
      latest,
      lateFile,
      todayKey,
      refreshedAt: new Date(),
    };
  }

  /* ---------- plan lines ---------- */
  function emptyLine(id, seg, product, sfx, allocation) {
    const usage = {};
    USAGE_COLS.forEach(([k]) => { usage[k] = []; });
    return { id, seg, product, sfx, allocation, received: [], late: [], now: [], usage };
  }

  function buildPlanLines(model, zoneKeys, pred) {
    const values = global.allocationValues || {};
    const byLeaf = new Map();
    (global.ALLOCATION_ROWS || []).forEach((leaf) => {
      if (!leaf || leaf.kind !== "leaf") return;
      byLeaf.set(leaf.id, emptyLine(leaf.id, leaf.seg || "—", leaf.product || "—", leaf.sfx || "—", Number(values[leaf.id]) || 0));
    });
    const none = emptyLine("__none__", "—", "(no plan line)", "—", 0);
    const lineOf = (c) => (c.leafId && byLeaf.get(c.leafId)) || none;
    zoneKeys.forEach((zk) => {
      const z = model.zones.get(zk);
      if (!z) return;
      z.received.filter(pred).forEach((c) => lineOf(c).received.push(c));
      z.late.filter(pred).forEach((c) => lineOf(c).late.push(c));
      z.current.filter(pred).forEach((c) => {
        const line = lineOf(c);
        line.now.push(c);
        line.usage[c.usageKey].push(c);
      });
    });
    const rows = [...byLeaf.values()]
      .filter((r) => !view.product || r.product === view.product)
      .filter((r) => !view.sfx || r.sfx === view.sfx)
      .filter((r) => r.allocation > 0 || r.received.length || r.late.length || r.now.length)
      .sort((a, b) => String(a.seg).localeCompare(String(b.seg))
        || String(a.product).localeCompare(String(b.product))
        || String(a.sfx).localeCompare(String(b.sfx)));
    if (none.received.length || none.late.length || none.now.length) rows.push(none);
    return rows;
  }

  /* ---------- dev-only cross-check against Plan Tracker's RES schedule ---------- */
  function devAssertRes(model) {
    if (!isDev() || typeof global.buildBasMonthlyData !== "function") return;
    const cur = typeof global.basMonthContext === "function" ? global.basMonthContext() : null;
    if (!cur || cur.monthKey !== model.ctx.monthKey) return;
    if (typeof global.getCachedRtlActiveMonth === "function" && global.getCachedRtlActiveMonth(cur.monthKey) !== model.pack) return;
    let ref;
    try {
      ref = global.buildBasMonthlyData();
    } catch (err) {
      console.warn("[ZoneTracker] RES check skipped", err);
      return;
    }
    const resKeys = [...model.zones.keys()].filter(isResKey);
    const sum = (field) => resKeys.reduce((s, k) => s + model.zones.get(k)[field].length, 0);
    const lines = buildPlanLines(model, resKeys, () => true);
    const byId = new Map(lines.map((r) => [r.id, r]));
    const lineDiff = [];
    (ref.rows || []).forEach((r) => {
      const mine = byId.get(r.id);
      const mtd = mine ? mine.received.length : 0;
      const late = mine ? mine.late.length : 0;
      if (mtd !== r.mtd || late !== r.late) lineDiff.push({ id: r.id, product: r.product, sfx: r.sfx, planTracker: { mtd: r.mtd, late: r.late }, zoneTracker: { mtd, late } });
    });
    const refIds = new Set((ref.rows || []).map((r) => r.id));
    lines.forEach((r) => {
      if (r.id === "__none__" || refIds.has(r.id) || (!r.received.length && !r.late.length)) return;
      lineDiff.push({ id: r.id, product: r.product, sfx: r.sfx, planTracker: { mtd: 0, late: 0 }, zoneTracker: { mtd: r.received.length, late: r.late.length } });
    });
    const check = {
      received: [(ref.retailArrivalCars || []).length, sum("received")],
      free: [(ref.freeStockCars || []).length, sum("free")],
      moved: [(ref.movedOutCars || []).length, sum("movedOut")],
      late: [(ref.lateCars || []).length, sum("late")],
    };
    const bad = Object.entries(check).filter(([, [a, b]]) => a !== b);
    console.assert(!bad.length && !lineDiff.length, "[ZoneTracker] RES zone differs from Plan Tracker", { check, lineDiff });
    if (!bad.length && !lineDiff.length) console.info("[ZoneTracker] RES zone matches Plan Tracker", check);
  }

  /* ---------- filters ---------- */
  function selectedZoneKeys(model) {
    if (view.zone && model.zones.has(view.zone)) return [view.zone];
    return [...model.zones.keys()];
  }
  function carPred(c) {
    if (view.sharing && c.sharing !== view.sharing) return false;
    if (view.product && c.product !== view.product) return false;
    if (view.sfx && c.suffix !== view.sfx) return false;
    if (view.usage && c.usageKey !== view.usage) return false;
    if (view.status && c.salesBucket !== view.status) return false;
    if (view.q) {
      const hay = `${c.vin} ${c.product} ${c.rawProduct} ${c.suffix} ${c.zone} ${c.sharing}`.toLowerCase();
      if (!hay.includes(view.q)) return false;
    }
    return true;
  }
  function evDay(ev) {
    return ev.collectionDay != null ? ev.collectionDay : ev.day;
  }
  function activeDay(model) {
    if (view.day) return view.day;
    return model.latest ? model.latest.day : 0;
  }
  function inPeriod(model, ev) {
    if (view.mode !== "daily") return true;
    return evDay(ev) === activeDay(model);
  }
  function zoneList(model, field, zoneKeys, periodic) {
    const out = [];
    zoneKeys.forEach((zk) => {
      const z = model.zones.get(zk);
      if (!z) return;
      z[field].forEach((c) => {
        if (!carPred(c)) return;
        if (periodic && !inPeriod(model, c)) return;
        out.push(c);
      });
    });
    return out;
  }

  /* ---------- rendering ---------- */
  function drillBtn(n, title, rows, cls) {
    if (!n) return `<span class="zt-zero">0</span>`;
    const id = drills.push({ title, rows }) - 1;
    return `<button type="button" class="pt-linknum${cls ? ` ${cls}` : ""}" data-zt-drill="${id}">${num(n)}</button>`;
  }

  function zoneBadge(ev) {
    if (ev.kind === "transfer-in") return { cls: "warn", text: `New to zone · was ${ev.fromZone || "other zone"}` };
    if (ev.kind === "moved-out") return { cls: "bad", text: `Moved out · now ${ev.toZone || "—"}` };
    if (ev.kind === "received") return { cls: "ok", text: `Age 0 same-day · day ${ev.collectionDay}${ev.agLabel ? ` · AG ${ev.agLabel}` : ""}` };
    if (ev.kind === "free") return { cls: "info", text: `Free stock · age ${ev.age != null ? ev.age : "?"}d` };
    if (ev.kind === "late") return { cls: "warn", text: `Late · age ${ev.age}d` };
    return { cls: "na", text: "In zone" };
  }

  function fillSelect(id, values, current, allLabel, labelOf) {
    const el = document.getElementById(id);
    if (!el) return;
    const opts = [`<option value="">${esc(allLabel)}</option>`].concat(values.map((v) =>
      `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(labelOf ? labelOf(v) : v)}</option>`));
    el.innerHTML = opts.join("");
    el.value = values.includes(current) ? current : "";
  }

  function fillFilters(model) {
    const zones = [...model.zones.values()].sort((a, b) => a.label.localeCompare(b.label));
    fillSelect("zt-f-zone", zones.map((z) => z.key), view.zone, "All zones", (k) => model.zones.get(k).label);
    const all = [];
    model.zones.forEach((z) => { all.push(...z.current, ...z.received, ...z.free, ...z.transferIn, ...z.movedOut); });
    const uniq = (f) => [...new Set(all.map(f).filter((x) => x && x !== "—"))].sort();
    fillSelect("zt-f-sharing", uniq((c) => c.sharing), view.sharing, "All sharing levels");
    fillSelect("zt-f-product", uniq((c) => c.product), view.product, "All products");
    fillSelect("zt-f-sfx", uniq((c) => (!view.product || c.product === view.product ? c.suffix : "")), view.sfx, "All SFX");
    fillSelect("zt-f-usage", USAGE_COLS.map(([k]) => k), view.usage, "All usage", (k) => USAGE_COLS.find((u) => u[0] === k)[1]);
    fillSelect("zt-f-status", Object.keys(STATUS_LABELS), view.status, "All statuses", (k) => STATUS_LABELS[k]);
    const daySel = document.getElementById("zt-day");
    if (daySel) {
      daySel.innerHTML = model.fileDays.slice().reverse().map((d, i) =>
        `<option value="${i === 0 ? 0 : d.day}">${i === 0 ? `Latest · ${esc(d.label)}` : `Day ${d.day} · ${esc(d.label)}`}</option>`).join("");
      daySel.value = String(view.day && model.fileDays.some((d) => d.day === view.day) ? view.day : 0);
      daySel.disabled = view.mode !== "daily";
    }
    $$("[data-zt-mode]").forEach((b) => b.classList.toggle("is-on", b.getAttribute("data-zt-mode") === view.mode));
  }

  function renderKpis(model, zoneKeys) {
    const host = $("#zt-kpis");
    if (!host) return;
    const periodLabel = view.mode === "daily" ? `Day ${activeDay(model)}` : "MTD";
    const current = zoneList(model, "current", zoneKeys, false);
    const received = zoneList(model, "received", zoneKeys, true);
    const transferIn = zoneList(model, "transferIn", zoneKeys, true);
    const movedOut = zoneList(model, "movedOut", zoneKeys, true);
    const free = zoneList(model, "free", zoneKeys, true);
    const late = zoneList(model, "late", zoneKeys, false);
    const fileLabel = model.latest ? `File ${model.latest.dateKey}` : "No file";
    const scope = view.zone && model.zones.get(view.zone) ? model.zones.get(view.zone).label : "All zones";
    const cards = [
      ["current", "Cars in zone today", current, `${fileLabel} · ${scope}`],
      ["received", `Received ${periodLabel}`, received, "Age 0 · AG = file day · first zone"],
      ["transfer", "Transfers in", transferIn, `${periodLabel} · seen first in another zone`],
      ["moved", "Moved out", movedOut, `${periodLabel} · left the zone`],
      ["free", "Free stock", free, `${periodLabel} · already in zone when first seen`],
      ["late", "Late (age ≥ 1)", late, model.lateFile ? "Matched to a plan line" : "Needs today's file"],
    ];
    host.innerHTML = cards.map(([key, label, rows, sub]) => {
      const id = drills.push({ title: `${label} · ${scope}`, rows }) - 1;
      return `<button type="button" class="pt-kpi zt-kpi zt-tone-${key}" data-zt-drill="${id}">
        <span>${esc(label)}</span>
        <strong>${num(rows.length)}</strong>
        <b>${esc(sub)}</b>
      </button>`;
    }).join("");
  }

  function destroyChart(id) {
    if (charts[id]) {
      try { charts[id].destroy(); } catch (_) { /* ignore */ }
      delete charts[id];
    }
  }
  function makeChart(id, cfg) {
    const canvas = document.getElementById(id);
    destroyChart(id);
    if (!canvas || typeof global.Chart === "undefined") return null;
    cfg.options = cfg.options || {};
    cfg.options.animation = false;
    cfg.options.maintainAspectRatio = false;
    charts[id] = new global.Chart(canvas, cfg);
    return charts[id];
  }
  const AXIS = { ticks: { color: "#A9B9D0", font: { size: 11 } }, grid: { color: "rgba(42,58,82,.6)" } };

  function renderZoneChart(model) {
    const note = $("#zt-zone-chart-note");
    const day = activeDay(model);
    if (note) note.textContent = view.mode === "daily" ? `Day ${day} only` : "Month to date";
    const data = [...model.zones.values()].map((z) => ({
      key: z.key,
      label: z.label,
      n: z.received.filter((c) => carPred(c) && inPeriod(model, c)).length,
    })).filter((d) => d.n > 0 || d.key === view.zone).sort((a, b) => b.n - a.n);
    const empty = $("#zt-zone-chart-empty");
    if (empty) empty.hidden = data.length > 0;
    makeChart("zt-chart-zones", {
      type: "bar",
      data: {
        labels: data.map((d) => d.label),
        datasets: [{
          label: "Received",
          data: data.map((d) => d.n),
          backgroundColor: data.map((d) => (d.key === view.zone ? "#EB0A1E" : isResKey(d.key) ? "#3B82F6" : "#64748B")),
          borderRadius: 6,
          maxBarThickness: 46,
        }],
      },
      options: {
        indexAxis: data.length > 8 ? "y" : "x",
        plugins: { legend: { display: false } },
        scales: { x: AXIS, y: { ...AXIS, beginAtZero: true } },
        onClick: (_e, els) => {
          if (!els || !els.length) return;
          const d = data[els[0].index];
          if (!d) return;
          view.zone = view.zone === d.key ? "" : d.key;
          renderAll(lastModel);
        },
      },
    });
  }

  function renderDailyChart(model, zoneKeys, lines) {
    const dim = model.ctx.daysInMonth;
    const perDay = Array(dim + 1).fill(0);
    zoneList(model, "received", zoneKeys, false).forEach((c) => {
      const d = evDay(c);
      if (d >= 1 && d <= dim) perDay[d] += 1;
    });
    const labels = [];
    const bars = [];
    const cum = [];
    let run = 0;
    for (let d = 1; d <= dim; d += 1) {
      labels.push(String(d));
      run += perDay[d];
      const past = d <= model.ctx.todayDay;
      bars.push(past ? (view.mode === "cumulative" ? run : perDay[d]) : null);
      cum.push(past ? run : null);
    }
    const plan = lines.filter((r) => r.id !== "__none__").reduce((s, r) => s + r.allocation, 0);
    const title = $("#zt-daily-title");
    const scope = view.zone && model.zones.get(view.zone) ? model.zones.get(view.zone).label : "All zones";
    if (title) title.textContent = `Daily received · ${scope}`;
    const note = $("#zt-daily-note");
    if (note) note.textContent = `${num(run)} received · plan ${num(plan)} · ${view.mode === "cumulative" ? "bars cumulative" : "bars per day"}`;
    makeChart("zt-chart-daily", {
      data: {
        labels,
        datasets: [
          { type: "bar", label: view.mode === "cumulative" ? "Received (cumulative)" : "Received per day", data: bars, backgroundColor: "#3B82F6", borderRadius: 4, order: 3 },
          { type: "line", label: "Cumulative", data: cum, borderColor: "#10B981", backgroundColor: "#10B981", pointRadius: 2, tension: 0.2, order: 1 },
          { type: "line", label: "Total allocation", data: labels.map(() => plan), borderColor: "#EB0A1E", borderDash: [6, 4], pointRadius: 0, order: 2 },
        ],
      },
      options: {
        plugins: {
          legend: { labels: { color: "#A9B9D0", boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              footer: (items) => {
                const d = Number(items && items[0] && items[0].label);
                return d && model.dayTot[d] != null ? `Tot (age 0, any zone): ${model.dayTot[d]}` : "";
              },
            },
          },
        },
        scales: { x: AXIS, y: { ...AXIS, beginAtZero: true } },
      },
    });
  }

  function renderMatrix(model) {
    const host = $("#zt-matrix");
    if (!host) return;
    const zones = [...model.zones.values()];
    const cells = new Map();
    const prodTotals = new Map();
    zones.forEach((z) => {
      z.current.filter(carPred).forEach((c) => {
        const k = `${z.key}\u0000${c.product}`;
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(c);
        prodTotals.set(c.product, (prodTotals.get(c.product) || 0) + 1);
      });
    });
    const products = [...prodTotals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
    const rows = zones.map((z) => ({ z, rows: z.current.filter(carPred) }))
      .filter((r) => r.rows.length || r.z.key === view.zone)
      .sort((a, b) => b.rows.length - a.rows.length);
    if (!rows.length) {
      host.innerHTML = `<p class="zt-empty-note">No cars in today's file for these filters.</p>`;
      return;
    }
    const grand = rows.reduce((s, r) => s + r.rows.length, 0);
    host.innerHTML = `<table class="pt-table zt-table zt-matrix">
      <thead><tr><th>Zone</th>${products.map((p) => `<th class="num">${esc(p)}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${rows.map(({ z, rows: list }) => `<tr class="zt-zone-row${z.key === view.zone ? " is-on" : ""}" data-zt-zone="${esc(z.key)}">
        <th scope="row">${esc(z.label)}${isResKey(z.key) ? ' <span class="badge ok">RES</span>' : ""}</th>
        ${products.map((p) => {
          const list2 = cells.get(`${z.key}\u0000${p}`) || [];
          return `<td class="num">${drillBtn(list2.length, `${z.label} · ${p} · in zone today`, list2)}</td>`;
        }).join("")}
        <td class="num zt-strong">${drillBtn(list.length, `${z.label} · in zone today`, list)}</td>
      </tr>`).join("")}</tbody>
      <tfoot><tr class="pt-total"><th>Total</th>${products.map((p) => {
        const list3 = rows.flatMap((r) => cells.get(`${r.z.key}\u0000${p}`) || []);
        return `<td class="num">${drillBtn(list3.length, `${p} · all zones · in zone today`, list3)}</td>`;
      }).join("")}<td class="num zt-strong">${drillBtn(grand, "All zones · in zone today", rows.flatMap((r) => r.rows))}</td></tr></tfoot>
    </table>`;
  }

  function renderPlanLines(model, lines) {
    const host = $("#zt-plan");
    if (!host) return;
    const scope = view.zone && model.zones.get(view.zone) ? model.zones.get(view.zone).label : "All zones";
    const title = $("#zt-plan-title");
    if (title) title.textContent = `Selected zone by model & SFX · ${scope}`;
    const usageCols = USAGE_COLS.filter(([k]) => k !== "other" || lines.some((r) => r.usage.other.length));
    if (!lines.length) {
      host.innerHTML = `<p class="zt-empty-note">No plan lines for these filters.</p>`;
      return;
    }
    const tot = { allocation: 0, received: [], late: [], now: [], usage: {} };
    usageCols.forEach(([k]) => { tot.usage[k] = []; });
    lines.forEach((r) => {
      tot.allocation += r.allocation;
      tot.received.push(...r.received);
      tot.late.push(...r.late);
      tot.now.push(...r.now);
      usageCols.forEach(([k]) => tot.usage[k].push(...r.usage[k]));
    });
    const remCell = (alloc, rec) => {
      const rem = alloc - rec;
      const cls = rem > 0 ? "pt-gap-left" : rem < 0 ? "pt-gap-over" : "pt-gap-ok";
      return `<td class="num ${cls}">${num(rem)}</td>`;
    };
    const label = (r) => `${r.product} ${r.sfx !== "—" ? r.sfx : ""}`.trim();
    host.innerHTML = `<table class="pt-table zt-table">
      <thead><tr>
        <th>Seg</th><th>Product</th><th>SFX</th><th class="num">Allocation</th><th class="num">Received MTD</th>
        <th class="num">Remaining to plan</th><th class="num">Late</th><th class="num">In zone now</th>
        ${usageCols.map(([, l]) => `<th class="num">${esc(l)}</th>`).join("")}
      </tr></thead>
      <tbody>${lines.map((r) => `<tr${r.id === "__none__" ? ' class="zt-none-row"' : ""}>
        <td>${esc(r.seg)}</td><td>${esc(r.product)}</td><td>${esc(r.sfx)}</td>
        <td class="num">${num(r.allocation)}</td>
        <td class="num">${drillBtn(r.received.length, `${label(r)} · received MTD · ${scope}`, r.received)}</td>
        ${r.id === "__none__" ? "<td class=\"num\">—</td>" : remCell(r.allocation, r.received.length)}
        <td class="num">${drillBtn(r.late.length, `${label(r)} · late · ${scope}`, r.late)}</td>
        <td class="num">${drillBtn(r.now.length, `${label(r)} · in zone now · ${scope}`, r.now)}</td>
        ${usageCols.map(([k, l]) => `<td class="num">${drillBtn(r.usage[k].length, `${label(r)} · ${l} · ${scope}`, r.usage[k])}</td>`).join("")}
      </tr>`).join("")}</tbody>
      <tfoot><tr class="pt-total">
        <td colspan="3">Total</td>
        <td class="num">${num(tot.allocation)}</td>
        <td class="num">${drillBtn(tot.received.length, `Received MTD · ${scope}`, tot.received)}</td>
        ${remCell(tot.allocation, tot.received.filter((c) => c.leafId).length)}
        <td class="num">${drillBtn(tot.late.length, `Late · ${scope}`, tot.late)}</td>
        <td class="num">${drillBtn(tot.now.length, `In zone now · ${scope}`, tot.now)}</td>
        ${usageCols.map(([k, l]) => `<td class="num">${drillBtn(tot.usage[k].length, `${l} · ${scope}`, tot.usage[k])}</td>`).join("")}
      </tr></tfoot>
    </table>`;
  }

  function movementRows(model, zoneKeys) {
    const keys = new Set(zoneKeys);
    return model.events.filter((ev) => {
      const zk = ev.kind === "moved-out" ? ev.fromZoneKey : ev.zoneKey;
      if (!keys.has(zk)) return false;
      if (view.moveKind && ev.kind !== view.moveKind) return false;
      if (!inPeriod(model, ev)) return false;
      return carPred(ev);
    }).sort((a, b) => evDay(b) - evDay(a) || String(a.vin).localeCompare(String(b.vin)));
  }

  function renderMovements(model, zoneKeys) {
    const host = $("#zt-moves");
    if (!host) return;
    const rows = movementRows(model, zoneKeys);
    const chips = $("#zt-move-kinds");
    if (chips) {
      chips.innerHTML = [["", "All"], ...Object.entries(KIND_LABELS)].map(([k, l]) =>
        `<button type="button" data-zt-kind="${k}" class="${view.moveKind === k ? "is-on" : ""}">${esc(l)}</button>`).join("");
    }
    const count = $("#zt-moves-count");
    if (count) count.textContent = `${num(rows.length)} event(s)${view.mode === "daily" ? ` · day ${activeDay(model)}` : " · month to date"}`;
    if (!rows.length) {
      host.innerHTML = `<p class="zt-empty-note">No movements for these filters.</p>`;
      return;
    }
    const shown = rows.slice(0, 400);
    host.innerHTML = `<table class="pt-table zt-table">
      <thead><tr><th>VIN</th><th>Product</th><th>SFX</th><th>From zone</th><th></th><th>To zone</th><th class="num">Day</th><th class="num">Age</th><th>AG date</th><th>Badge</th></tr></thead>
      <tbody>${shown.map((ev) => {
        const b = zoneBadge(ev);
        return `<tr>
          <td class="mono">${esc(ev.vin)}</td><td>${esc(ev.product)}</td><td>${esc(ev.suffix)}</td>
          <td>${esc(ev.fromZone || "—")}</td><td class="zt-arrow">→</td><td>${esc(ev.toZone || "—")}</td>
          <td class="num">${num(evDay(ev))}</td><td class="num">${ev.age == null ? "—" : num(ev.age)}</td>
          <td>${esc(ev.agLabel || "—")}</td><td><span class="badge ${b.cls}">${esc(b.text)}</span></td>
        </tr>`;
      }).join("")}</tbody>
    </table>${rows.length > shown.length ? `<p class="zt-empty-note">Showing ${num(shown.length)} of ${num(rows.length)} · Excel export has every row.</p>` : ""}`;
  }

  function unmatchedGroups(model, zoneKeys) {
    const groups = new Map();
    const add = (c, field) => {
      if (c.leafId) return;
      const k = `${c.rawProduct}\u0000${c.rawSuffix}`;
      if (!groups.has(k)) groups.set(k, { product: c.rawProduct, sfx: c.rawSuffix, received: [], now: [] });
      groups.get(k)[field].push(c);
    };
    zoneKeys.forEach((zk) => {
      const z = model.zones.get(zk);
      if (!z) return;
      z.received.filter(carPred).forEach((c) => add(c, "received"));
      z.current.filter(carPred).forEach((c) => add(c, "now"));
    });
    return [...groups.values()].sort((a, b) => (b.received.length + b.now.length) - (a.received.length + a.now.length)
      || a.product.localeCompare(b.product));
  }

  function renderUnmatched(model, zoneKeys) {
    const host = $("#zt-unmatched");
    if (!host) return;
    const groups = unmatchedGroups(model, zoneKeys);
    const count = $("#zt-unmatched-count");
    if (count) count.textContent = groups.length ? `${num(groups.length)} product + SFX` : "All matched";
    if (!groups.length) {
      host.innerHTML = `<p class="zt-empty-note">Every car matched a plan line.</p>`;
      return;
    }
    host.innerHTML = `<table class="pt-table zt-table">
      <thead><tr><th>Product</th><th>SFX</th><th class="num">Received MTD</th><th class="num">In zone now</th></tr></thead>
      <tbody>${groups.map((g) => `<tr>
        <td>${esc(g.product)}</td><td>${esc(g.sfx)}</td>
        <td class="num">${drillBtn(g.received.length, `${g.product} ${g.sfx} · no plan line · received`, g.received)}</td>
        <td class="num">${drillBtn(g.now.length, `${g.product} ${g.sfx} · no plan line · in zone now`, g.now)}</td>
      </tr>`).join("")}</tbody>
    </table>`;
  }

  function renderAll(model) {
    if (!model) return;
    lastModel = model;
    drills = [];
    const empty = $("#zt-empty");
    const dash = $("#zt-dash");
    const monthLabel = model.ctx.monthLabel || model.ctx.monthKey;
    $$(".zt-month-label").forEach((el) => { el.textContent = monthLabel; });
    if (!model.fileDays.length) {
      if (empty) empty.hidden = false;
      if (dash) dash.hidden = true;
      const note = $("#zt-empty-month");
      if (note) note.textContent = `No RTL day files for ${monthLabel}.`;
      return;
    }
    if (empty) empty.hidden = true;
    if (dash) dash.hidden = false;
    if (view.zone && !model.zones.has(view.zone)) view.zone = "";

    const hint = $("#zt-live-hint");
    if (hint) {
      hint.textContent = `${model.fileDays.length} day file(s) · latest ${model.latest.dateKey} · ${model.zones.size} zones · zone = Search Area Desc`;
    }
    const updated = $("#zt-updated");
    if (updated) {
      updated.textContent = model.refreshedAt.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }
    fillFilters(model);
    const zoneKeys = selectedZoneKeys(model);
    const lines = buildPlanLines(model, zoneKeys, carPred);
    renderKpis(model, zoneKeys);
    renderZoneChart(model);
    renderDailyChart(model, zoneKeys, lines);
    renderMatrix(model);
    renderPlanLines(model, lines);
    renderMovements(model, zoneKeys);
    renderUnmatched(model, zoneKeys);
    if (!$("#zt-modal").hidden) paintModal();
  }

  /* ---------- drill-down modal ---------- */
  function openDrill(spec) {
    if (!spec) return;
    modalRows = spec.rows || [];
    const modal = $("#zt-modal");
    $("#zt-modal-title").textContent = spec.title || "VINs";
    const q = $("#zt-modal-q");
    if (q) q.value = "";
    modal.hidden = false;
    paintModal();
  }
  function paintModal() {
    const q = String(($("#zt-modal-q") || {}).value || "").trim().toLowerCase();
    const rows = q
      ? modalRows.filter((r) => `${r.vin} ${r.product} ${r.suffix} ${r.zone} ${r.sharing}`.toLowerCase().includes(q))
      : modalRows;
    $("#zt-modal-sub").textContent = `${num(rows.length)} VIN(s)`;
    $("#zt-modal-body").innerHTML = rows.length ? rows.map((r) => {
      const b = zoneBadge(r);
      return `<tr>
        <td class="mono">${esc(r.vin)}</td><td>${esc(r.product)}</td><td>${esc(r.suffix)}</td>
        <td>${esc(r.kind === "moved-out" ? `${r.fromZone} → ${r.toZone}` : r.zone)}</td>
        <td>${esc(r.sharing || "—")}</td><td>${esc(r.usage || "—")}</td>
        <td class="num">${r.age == null ? "—" : num(r.age)}</td><td>${esc(r.agLabel || "—")}</td>
        <td class="num">${num(evDay(r))}</td>
        <td>${esc(r.salesLabel || "—")}</td>
        <td><span class="badge ${b.cls}">${esc(b.text)}</span></td>
      </tr>`;
    }).join("") : `<tr><td colspan="11" class="zt-empty-note">No VINs.</td></tr>`;
  }

  /* ---------- Excel ---------- */
  function exportExcel() {
    const model = lastModel;
    if (!model || !model.fileDays.length || typeof global.XLSX === "undefined" || typeof global.appendObjectSheet !== "function") {
      if (typeof global.setStatus === "function") global.setStatus("Nothing to export", "err");
      return;
    }
    const XLSX = global.XLSX;
    const wb = XLSX.utils.book_new();
    const zones = [...model.zones.values()].sort((a, b) => a.label.localeCompare(b.label));
    const cnt = (list, periodic) => list.filter((c) => carPred(c) && (!periodic || inPeriod(model, c))).length;
    global.appendObjectSheet(wb, "Summary per zone", zones.map((z) => {
      const cur = z.current.filter(carPred);
      return {
        Zone: z.label,
        "Cars in zone today": cur.length,
        [view.mode === "daily" ? `Received day ${activeDay(model)}` : "Received MTD"]: cnt(z.received, true),
        "Transfers in": cnt(z.transferIn, true),
        "Moved out": cnt(z.movedOut, true),
        "Free stock": cnt(z.free, true),
        "Late (age >= 1)": cnt(z.late, false),
        Delivered: cur.filter((c) => c.salesBucket === "delivered").length,
        Proforma: cur.filter((c) => c.salesBucket === "proforma").length,
        "Free in stock": cur.filter((c) => c.salesBucket === "free").length,
      };
    }));
    const prodSet = new Set();
    zones.forEach((z) => z.current.filter(carPred).forEach((c) => prodSet.add(c.product)));
    const products = [...prodSet].sort();
    global.appendObjectSheet(wb, "Zone x model", zones.map((z) => {
      const out = { Zone: z.label };
      const cur = z.current.filter(carPred);
      products.forEach((p) => { out[p] = cur.filter((c) => c.product === p).length; });
      out.Total = cur.length;
      return out;
    }).filter((r) => r.Total > 0));
    const zoneKeys = selectedZoneKeys(model);
    global.appendObjectSheet(wb, "Plan lines", buildPlanLines(model, zoneKeys, carPred).map((r) => {
      const out = {
        Seg: r.seg,
        Product: r.product,
        SFX: r.sfx,
        Allocation: r.allocation,
        "Received MTD": r.received.length,
        "Remaining to plan": r.id === "__none__" ? "" : r.allocation - r.received.length,
        Late: r.late.length,
        "In zone now": r.now.length,
      };
      USAGE_COLS.forEach(([k, l]) => { out[l] = r.usage[k].length; });
      return out;
    }));
    const carRow = (r) => ({
      VIN: r.vin,
      Product: r.product,
      SFX: r.suffix,
      "RTL product": r.rawProduct,
      "RTL SFX": r.rawSuffix,
      "Plan line": r.leafId ? `${r.seg} · ${r.product} · ${r.suffix}` : "(no plan line)",
      Zone: r.zone,
      "Sharing level": r.sharing,
      Usage: r.usage,
      Age: r.age == null ? "" : r.age,
      "AG date": r.agLabel,
      "File day": r.dateKey,
      Status: r.salesLabel || "",
      Location: r.location,
    });
    global.appendObjectSheet(wb, "Movements", movementRows(model, zoneKeys).map((ev) => ({
      Event: KIND_LABELS[ev.kind] || ev.kind,
      Day: evDay(ev),
      "From zone": ev.fromZone || "",
      "To zone": ev.toZone || "",
      Badge: zoneBadge(ev).text,
      ...carRow(ev),
    })));
    const vinList = [];
    zoneKeys.forEach((zk) => {
      const z = model.zones.get(zk);
      if (z) z.current.filter(carPred).forEach((c) => vinList.push(carRow(c)));
    });
    global.appendObjectSheet(wb, "VIN list", vinList);
    global.appendObjectSheet(wb, "Daily", model.fileDays.map((d) => {
      const out = { Day: d.day, File: d.dateKey, "File name": d.fileName, "Unique VINs": d.count, "Tot (age 0, any zone)": d.tot };
      out.Received = zoneList(model, "received", zoneKeys, false).filter((c) => evDay(c) === d.day).length;
      return out;
    }));
    global.appendObjectSheet(wb, "No plan line", unmatchedGroups(model, zoneKeys).map((g) => ({
      Product: g.product,
      SFX: g.sfx,
      "Received MTD": g.received.length,
      "In zone now": g.now.length,
    })));
    const stamp = typeof global.excelFileStamp === "function" ? global.excelFileStamp() : model.ctx.monthKey;
    global.downloadWorkbook(wb, `Zone-Tracker-${model.ctx.monthKey}-${stamp}`);
    if (typeof global.setStatus === "function") global.setStatus("Zone Tracker Excel exported", "ok");
  }

  /* ---------- UI wiring ---------- */
  function shiftMonth(delta) {
    const m = /^(\d{4})-(\d{2})$/.exec(view.monthKey || "");
    const now = new Date();
    const d = new Date(m ? Number(m[1]) : now.getFullYear(), (m ? Number(m[2]) - 1 : now.getMonth()) + delta, 1);
    view.monthKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    view.monthLocked = true;
    view.day = 0;
    render({ monthKey: view.monthKey });
  }
  function thisMonth() {
    view.monthLocked = false;
    view.day = 0;
    render({});
  }

  function bindUi() {
    if (uiBound) return;
    const root = $("#panel-zonetracker");
    if (!root) return;
    uiBound = true;
    root.addEventListener("click", (e) => {
      const t = e.target.closest("button, tr[data-zt-zone]");
      if (!t || !root.contains(t)) return;
      if (t.hasAttribute("data-zt-drill")) {
        openDrill(drills[Number(t.getAttribute("data-zt-drill"))]);
        return;
      }
      if (t.matches("tr[data-zt-zone]")) {
        const k = t.getAttribute("data-zt-zone");
        view.zone = view.zone === k ? "" : k;
        renderAll(lastModel);
        return;
      }
      if (t.hasAttribute("data-zt-mode")) {
        view.mode = t.getAttribute("data-zt-mode");
        renderAll(lastModel);
        return;
      }
      if (t.hasAttribute("data-zt-kind")) {
        view.moveKind = t.getAttribute("data-zt-kind");
        renderAll(lastModel);
        return;
      }
      if (t.hasAttribute("data-zt-close")) {
        $("#zt-modal").hidden = true;
        return;
      }
      switch (t.id) {
        case "zt-month-prev": case "zt-empty-prev": shiftMonth(-1); break;
        case "zt-month-next": shiftMonth(1); break;
        case "zt-month-now": case "zt-empty-now": thisMonth(); break;
        case "zt-refresh": case "zt-empty-refresh": render({ force: true, monthKey: view.monthLocked ? view.monthKey : "" }); break;
        case "zt-export": exportExcel(); break;
        case "zt-clear":
          Object.assign(view, { zone: "", sharing: "", product: "", sfx: "", usage: "", status: "", q: "", moveKind: "" });
          if ($("#zt-q")) $("#zt-q").value = "";
          renderAll(lastModel);
          break;
        default: break;
      }
    });
    const filters = { "zt-f-zone": "zone", "zt-f-sharing": "sharing", "zt-f-product": "product", "zt-f-sfx": "sfx", "zt-f-usage": "usage", "zt-f-status": "status" };
    Object.entries(filters).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        view[key] = el.value;
        if (key === "product") view.sfx = "";
        renderAll(lastModel);
      });
    });
    const day = $("#zt-day");
    if (day) day.addEventListener("change", () => { view.day = Number(day.value) || 0; renderAll(lastModel); });
    const q = $("#zt-q");
    let qt = 0;
    if (q) {
      q.addEventListener("input", () => {
        clearTimeout(qt);
        qt = setTimeout(() => { view.q = q.value.trim().toLowerCase(); renderAll(lastModel); }, 200);
      });
    }
    const mq = $("#zt-modal-q");
    if (mq) mq.addEventListener("input", paintModal);
    const modal = $("#zt-modal");
    if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal && !modal.hidden) modal.hidden = true;
    });
  }

  async function render(opts) {
    bindUi();
    const loading = $("#zt-loading");
    if (loading) loading.hidden = false;
    const cur = typeof global.basMonthContext === "function" ? global.basMonthContext() : null;
    const now = new Date();
    const curKey = (cur && cur.monthKey) || `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    let mk = curKey;
    if (opts && opts.monthKey) {
      mk = opts.monthKey;
    } else if (view.monthLocked && view.monthKey) {
      mk = view.monthKey;
    } else {
      view.monthLocked = false;
    }
    view.monthKey = mk;
    let pack = null;
    if (typeof global.ensureRtlActiveMonth === "function") {
      pack = await global.ensureRtlActiveMonth(mk, !!(opts && opts.force));
    } else if (typeof global.getCachedRtlActiveMonth === "function") {
      pack = global.getCachedRtlActiveMonth(mk);
    }
    if (loading) loading.hidden = true;
    if (view.monthKey !== mk) return;
    const model = buildZoneModel(pack || { month: mk, days: {} }, monthCtx(mk));
    renderAll(model);
    devAssertRes(model);
  }

  global.ZoneTracker = {
    render,
    buildZoneModel,
    buildPlanLines,
    zoneKey,
    view,
    getModel: () => lastModel,
    exportExcel,
  };
})(typeof window !== "undefined" ? window : globalThis);
