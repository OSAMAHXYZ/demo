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
    snapDate: "",
    movement: "",
    product: "",
    q: "",
    vinQ: "",
    drill: "", // kpi key for VIN list
    ageBucket: "",
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
  function normVin(raw) {
    if (typeof global.extractVinValue === "function") {
      const v = global.extractVinValue(raw);
      if (v) return v;
    }
    return String(raw || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  }
  function parseDate(v) {
    return typeof global.parseDate === "function" ? global.parseDate(v) : null;
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
  function isTargetArea(desc) {
    const t = normHeader(TARGET_SEARCH_AREA);
    const s = normHeader(desc || "");
    if (!s || !t) return false;
    return s === t || s.includes(t);
  }
  function daysBetween(a, b) {
    if (!a || !b) return null;
    const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
      - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    return Math.round(ms / 86400000);
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
  }

  function mapVehicle(v, dateKey, snapId, i) {
    if (typeof global.mapRtlDailyVehicle === "function") {
      const car = global.mapRtlDailyVehicle(v, dateKey, snapId, i);
      const searchArea = (typeof global.dayVehicleSearchArea === "function"
        ? global.dayVehicleSearchArea(v)
        : "") || car.searchAreaDesc || "";
      const agDate = typeof global.dayVehicleAgDate === "function" ? global.dayVehicleAgDate(v) : null;
      const ageRaw = car.ageing;
      const age = ageRaw == null || !Number.isFinite(Number(ageRaw)) ? null : Math.floor(Number(ageRaw));
      return {
        vin: normVin(car.vin),
        product: car.product || "—",
        suffix: car.suffix || "—",
        year: car.year || "",
        ext: car.ext || "",
        int: car.int || "",
        searchArea: searchArea || "",
        isTarget: isTargetArea(searchArea),
        allocationDate: agDate,
        allocationAge: age,
        status: car.status || "",
        secondaryStatus: (v && (v.secondaryStatus || v.secondary_status)) || "",
        deliveryStatus: "",
        location: car.location || "—",
        usage: car.usage || "",
        dateKey,
      };
    }
    return null;
  }

  function snapshotRows(snap, dateKey) {
    const vehicles = (snap && snap.vehicles) || [];
    const byVin = new Map();
    const quality = {
      blankVin: 0,
      duplicateVin: 0,
      missingArea: 0,
      invalidAg: 0,
      ageMismatch: 0,
      multiArea: 0,
    };
    const seen = new Set();
    const fileDate = (() => {
      const parts = String(dateKey).split("-").map(Number);
      if (parts.length === 3 && parts.every(Number.isFinite)) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
      }
      return null;
    })();

    vehicles.forEach((v, i) => {
      const row = mapVehicle(v, dateKey, snap && snap.id, i);
      if (!row) return;
      if (!row.vin) {
        quality.blankVin += 1;
        return;
      }
      if (seen.has(row.vin)) {
        quality.duplicateVin += 1;
        return; // keep first; flag duplicate
      }
      seen.add(row.vin);
      if (!row.searchArea) quality.missingArea += 1;
      if (row.allocationDate && fileDate) {
        const calc = daysBetween(row.allocationDate, fileDate);
        row.calculatedAge = calc;
        if (row.allocationAge != null && calc != null && Math.abs(row.allocationAge - calc) > 1) {
          quality.ageMismatch += 1;
          row.ageMismatch = true;
        }
      } else if (row.allocationDate == null && v) {
        // no AG is allowed; count only if details looked broken is hard — skip
      }
      byVin.set(row.vin, row);
    });

    return { byVin, quality, fileDate, count: byVin.size };
  }

  /**
   * Build full movement model from rtl-daily active-month pack.
   */
  function buildModel(pack, opts) {
    const plan = (opts && opts.plan != null) ? Number(opts.plan) : ALLOCATION_PLAN;
    const days = pack && pack.days && typeof pack.days === "object" ? pack.days : {};
    const dateKeys = Object.keys(days).sort();
    const daily = [];
    const movements = [];
    const vinHistory = new Map(); // vin -> observations[]
    const everAllocated = new Set(); // unique VINs that entered target
    const everSeen = new Set();
    const disappearedEver = new Set();
    const qualityTotals = {
      blankVin: 0,
      duplicateVin: 0,
      missingArea: 0,
      invalidAg: 0,
      ageMismatch: 0,
      duplicateSnapshot: 0,
      snapshotCount: dateKeys.length,
    };
    const corridor = new Map();
    const age0ByArea = new Map();
    let prev = null; // { dateKey, byVin }
    let latestTarget = new Map();

    dateKeys.forEach((dateKey) => {
      const snap = days[dateKey];
      const { byVin, quality, fileDate } = snapshotRows(snap, dateKey);
      qualityTotals.blankVin += quality.blankVin;
      qualityTotals.duplicateVin += quality.duplicateVin;
      qualityTotals.missingArea += quality.missingArea;
      qualityTotals.ageMismatch += quality.ageMismatch;

      const dayStats = {
        dateKey,
        label: fileDate
          ? fileDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
          : dateKey,
        newRes: [],
        transferIn: [],
        transferOut: [],
        disappeared: [],
        reappeared: [],
        stayed: [],
        newVinAny: [],
        resTotal: 0,
        age0Target: 0,
        age0All: 0,
        prevResTotal: prev ? [...prev.byVin.values()].filter((r) => r.isTarget).length : 0,
      };

      // Age 0 by area for this snapshot (latest will overwrite display)
      if (dateKey === dateKeys[dateKeys.length - 1]) {
        age0ByArea.clear();
        byVin.forEach((r) => {
          if (r.allocationAge !== 0) return;
          const area = r.searchArea || "(blank)";
          age0ByArea.set(area, (age0ByArea.get(area) || 0) + 1);
          dayStats.age0All += 1;
          if (r.isTarget) dayStats.age0Target += 1;
        });
      } else {
        byVin.forEach((r) => {
          if (r.allocationAge === 0) {
            dayStats.age0All += 1;
            if (r.isTarget) dayStats.age0Target += 1;
          }
        });
      }

      byVin.forEach((r) => {
        if (r.isTarget) dayStats.resTotal += 1;
        if (!vinHistory.has(r.vin)) vinHistory.set(r.vin, []);
        vinHistory.get(r.vin).push({ ...r, snapshotDate: dateKey });
      });

      if (!prev) {
        byVin.forEach((r) => {
          everSeen.add(r.vin);
          const movementType = r.isTarget ? "NEW ALLOCATION" : "NEW VIN";
          if (r.isTarget) {
            everAllocated.add(r.vin);
            dayStats.newRes.push(r);
          } else {
            dayStats.newVinAny.push(r);
          }
          movements.push(makeMovement(dateKey, null, r, movementType));
        });
      } else {
        const prevMap = prev.byVin;
        const allVins = new Set([...prevMap.keys(), ...byVin.keys()]);
        allVins.forEach((vin) => {
          const a = prevMap.get(vin) || null;
          const b = byVin.get(vin) || null;
          if (!a && b) {
            const wasGone = disappearedEver.has(vin) || (everSeen.has(vin) && !prevMap.has(vin));
            everSeen.add(vin);
            if (wasGone) {
              const mt = b.isTarget ? "RE-APPEARED (RES)" : "RE-APPEARED";
              dayStats.reappeared.push(b);
              if (b.isTarget) {
                everAllocated.add(vin);
                dayStats.transferIn.push(b);
                addCorridor(corridor, a ? a.searchArea : "(re-appeared)", b.searchArea);
              }
              movements.push(makeMovement(dateKey, a, b, mt));
            } else if (b.isTarget) {
              everAllocated.add(vin);
              dayStats.newRes.push(b);
              movements.push(makeMovement(dateKey, null, b, "NEW ALLOCATION"));
            } else {
              dayStats.newVinAny.push(b);
              movements.push(makeMovement(dateKey, null, b, "NEW VIN"));
            }
            return;
          }
          if (a && !b) {
            disappearedEver.add(vin);
            dayStats.disappeared.push(a);
            movements.push(makeMovement(dateKey, a, null, "DISAPPEARED"));
            return;
          }
          if (a && b) {
            everSeen.add(vin);
            if (!a.isTarget && b.isTarget) {
              everAllocated.add(vin);
              dayStats.transferIn.push(b);
              addCorridor(corridor, a.searchArea, b.searchArea);
              movements.push(makeMovement(dateKey, a, b, "TRANSFERRED INTO RES"));
            } else if (a.isTarget && !b.isTarget) {
              dayStats.transferOut.push(b);
              addCorridor(corridor, a.searchArea, b.searchArea);
              movements.push(makeMovement(dateKey, a, b, "TRANSFERRED OUT OF RES"));
            } else if (a.isTarget && b.isTarget) {
              dayStats.stayed.push(b);
              movements.push(makeMovement(dateKey, a, b, "STAYED IN RES"));
            } else if (a.searchArea !== b.searchArea) {
              addCorridor(corridor, a.searchArea, b.searchArea);
              movements.push(makeMovement(dateKey, a, b, "AREA CHANGE"));
            }
          }
        });
      }

      // Reconciliation for target
      const implied = dayStats.prevResTotal
        + dayStats.newRes.length
        + dayStats.transferIn.length
        - dayStats.transferOut.length
        - dayStats.disappeared.filter((r) => r.isTarget).length;
      // Adjust: disappeared counted only if was target
      const disappearedTarget = dayStats.disappeared.filter((r) => r.isTarget).length;
      const impliedRes = dayStats.prevResTotal
        + dayStats.newRes.length
        + dayStats.transferIn.length
        - dayStats.transferOut.length
        - disappearedTarget;
      dayStats.disappearedTarget = disappearedTarget;
      dayStats.impliedRes = impliedRes;
      dayStats.reconDiff = dayStats.resTotal - impliedRes;
      dayStats.reconOk = dayStats.reconDiff === 0;

      daily.push(dayStats);
      latestTarget = new Map([...byVin].filter(([, r]) => r.isTarget));
      prev = { dateKey, byVin };
    });

    // Age 0 table from latest snapshot
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
    const allocated = everAllocated.size;
    const remaining = Math.max(0, plan - allocated);
    const progress = plan > 0 ? allocated / plan : 0;
    const latestDay = daily.length ? daily[daily.length - 1] : null;
    const prevDay = daily.length > 1 ? daily[daily.length - 2] : null;

    // Inventory breakdowns (current RES)
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
      ? [...latestSnap.byVin.values()].filter((r) => r.isTarget && r.allocationAge === 0).length
      : 0;
    const age0Total = latestSnap
      ? [...latestSnap.byVin.values()].filter((r) => r.allocationAge === 0).length
      : 0;

    const qualityScore = Math.max(0, Math.min(100, Math.round(
      100 - Math.min(40, qualityTotals.duplicateVin * 2)
        - Math.min(20, qualityTotals.blankVin)
        - Math.min(20, qualityTotals.missingArea * 0.05)
        - Math.min(20, qualityTotals.ageMismatch * 0.5)
    )));

    return {
      plan,
      target: TARGET_SEARCH_AREA,
      dateKeys,
      latestKey,
      daily,
      movements,
      vinHistory,
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
        remaining,
        progress,
        currentRes,
        age0Target,
        age0Total,
        transferIn: transferInAll.length,
        transferOut: transferOutAll.length,
        net: transferInAll.length - transferOutAll.length,
        disappeared: disappearedAll.length,
        newAlloc: newAllocAll.length,
      },
      lists: {
        allocated: [...everAllocated].map((vin) => {
          const hist = vinHistory.get(vin) || [];
          const last = hist[hist.length - 1];
          return last || { vin };
        }),
        transferIn: transferInAll,
        transferOut: transferOutAll,
        disappeared: disappearedAll,
        newAlloc: newAllocAll,
        current: [...latestTarget.values()],
        age0: latestSnap
          ? [...latestSnap.byVin.values()].filter((r) => r.isTarget && r.allocationAge === 0)
          : [],
      },
      latestDay,
      prevDay,
      quality: qualityTotals,
      qualityScore,
      matrix: buildMatrix(transferInAll, transferOutAll),
    };
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
      vin: (curr && curr.vin) || (prev && prev.vin) || "",
      product: (curr && curr.product) || (prev && prev.product) || "—",
      suffix: (curr && curr.suffix) || (prev && prev.suffix) || "—",
      year: (curr && curr.year) || (prev && prev.year) || "",
      ext: (curr && curr.ext) || (prev && prev.ext) || "",
      int: (curr && curr.int) || (prev && prev.int) || "",
      previousSearchArea: prev ? prev.searchArea : "—",
      currentSearchArea: curr ? curr.searchArea : "—",
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
      ["allocated", "Total Allocated", k.allocated, "Unique VINs ever entered RES", "ok"],
      ["remaining", "Remaining", k.remaining, `${Math.min(100, Math.round(k.progress * 100))}% of plan`, k.remaining ? "warn" : "ok"],
      ["current", "RES Current", k.currentRes, "In latest snapshot", "ok"],
      ["age0", "Age 0 (RES)", k.age0Target, `All areas Age 0: ${num(k.age0Total)}`, "info"],
      ["newAlloc", "New Allocations", k.newAlloc, "First seen as RES", "ok"],
      ["transferIn", "Transfers IN", k.transferIn, "Other area → RES", "info"],
      ["transferOut", "Transfers OUT", k.transferOut, "RES → other area", "warn"],
      ["net", "Net Movement", k.net, "IN − OUT", k.net >= 0 ? "ok" : "bad"],
      ["disappeared", "Disappeared", k.disappeared, "Missing from next snapshot", "bad"],
    ];
    el.innerHTML = items.map(([id, lab, val, sub, cls]) => {
      const active = view.drill === id ? " is-active" : "";
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
      });
    });
  }

  function renderDrill(model) {
    const wrap = $("#pt-drill");
    const table = $("#pt-drill-table");
    const title = $("#pt-drill-title");
    if (!wrap || !table) return;
    if (!view.drill) {
      wrap.hidden = true;
      return;
    }
    const rows = drillRows(model);
    const labels = {
      allocated: "Total allocated (unique VINs ever in RES)",
      current: "Current RES inventory",
      age0: "Age 0 · Retail Electronic Sales",
      newAlloc: "New allocations",
      transferIn: "Transfers INTO RES",
      transferOut: "Transfers OUT OF RES",
      disappeared: "Disappeared",
      net: "Net movement (IN + OUT events)",
    };
    wrap.hidden = false;
    if (title) title.textContent = labels[view.drill] || view.drill;
    if (!rows.length) {
      table.innerHTML = `<p class="foot" style="padding:12px">No VINs in this bucket.</p>`;
      return;
    }
    const isMove = rows[0] && rows[0].movementType;
    table.innerHTML = `<table class="bas-table">
      <thead><tr>
        <th>VIN</th><th>Product</th><th>SFX</th>
        ${isMove ? "<th>From</th><th>To</th><th>Movement</th><th>Snapshot</th>" : "<th>Search Area</th><th>Alloc Date</th><th class=\"num\">Age</th><th>Location</th>"}
      </tr></thead>
      <tbody>${rows.slice(0, 500).map((r) => {
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
          <td>${esc(r.product)}</td>
          <td>${esc(r.suffix)}</td>
          <td>${esc(r.searchArea || "—")}</td>
          <td>${esc(fmtDate(r.allocationDate))}</td>
          <td class="num">${r.allocationAge == null ? "—" : num(r.allocationAge)}</td>
          <td>${esc(r.location || "—")}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
    <p class="foot">${num(rows.length)} VIN(s)</p>`;
  }

  function renderProgress(model) {
    const el = $("#pt-progress");
    if (!el) return;
    const k = model.kpis;
    const pct = Math.min(100, Math.round(k.progress * 1000) / 10);
    const over = k.allocated > k.plan;
    el.innerHTML = `
      <div class="pt-progress-head">
        <strong>Allocation progress</strong>
        <span>${num(k.allocated)} / ${num(k.plan)} · Remaining ${num(k.remaining)}${over ? ` · <span class="badge warn">Over plan +${num(k.allocated - k.plan)}</span>` : ""}</span>
      </div>
      <div class="pt-progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
        <div class="pt-progress-fill" style="width:${pct}%"></div>
      </div>
      <p class="foot" style="margin:8px 0 0">Progress ${pct}%${over ? ` (actual ${(k.progress * 100).toFixed(1)}%)` : ""} · unique VINs allocated to ${esc(TARGET_SEARCH_AREA)}</p>`;
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
      ["RES Vehicles", prev ? prev.resTotal : "—", cur.resTotal],
      ["Age 0 (RES)", prev ? prev.age0Target : "—", cur.age0Target],
      ["New RES Allocations", prev ? prev.newRes.length : "—", cur.newRes.length],
      ["Transfers IN", prev ? prev.transferIn.length : "—", cur.transferIn.length],
      ["Transfers OUT", prev ? prev.transferOut.length : "—", cur.transferOut.length],
      ["Disappeared (was RES)", prev ? (prev.disappearedTarget || 0) : "—", cur.disappearedTarget || 0],
    ];
    el.innerHTML = `
      <div class="pt-y-head">
        <strong>Today vs previous snapshot</strong>
        <span class="hint">${prev ? esc(prev.label) : "—"} → ${esc(cur.label)}</span>
      </div>
      <div class="pt-y-grid">
        ${rows.map(([lab, a, b]) => {
          const delta = (typeof a === "number" && typeof b === "number") ? b - a : null;
          const dCls = delta == null ? "" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
          const dTxt = delta == null ? "" : (delta > 0 ? `+${delta}` : String(delta));
          return `<div class="pt-y-card">
            <span class="lab">${esc(lab)}</span>
            <div class="pt-y-vals"><span>${esc(String(a))}</span><span class="arrow">→</span><strong>${esc(String(b))}</strong>
            ${delta != null ? `<span class="delta ${dCls}">${dTxt}</span>` : ""}</div>
          </div>`;
        }).join("")}
      </div>
      ${cur.reconOk
        ? `<p class="foot" style="margin:10px 0 0"><span class="badge ok">Reconciliation OK</span> · ${num(cur.prevResTotal)} + ${num(cur.newRes.length)} + ${num(cur.transferIn.length)} − ${num(cur.transferOut.length)} − ${num(cur.disappearedTarget || 0)} = ${num(cur.resTotal)}</p>`
        : `<p class="foot" style="margin:10px 0 0"><span class="badge bad">RECONCILIATION ERROR</span> · implied ${num(cur.impliedRes)} · actual ${num(cur.resTotal)} · diff ${cur.reconDiff > 0 ? "+" : ""}${num(cur.reconDiff)}</p>`}`;
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
        <th>Date</th><th class="num">New RES</th><th class="num">Transfers IN</th>
        <th class="num">Transfers OUT</th><th class="num">Disappeared</th>
        <th class="num">RES Total</th><th class="num">Age 0</th><th>Recon</th>
      </tr></thead>
      <tbody>${rows.map((d) => `<tr>
        <td>${esc(d.label)}<div class="foot">${esc(d.dateKey)}</div></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="newRes">${num(d.newRes.length)}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="transferIn">${num(d.transferIn.length)}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="transferOut">${num(d.transferOut.length)}</button></td>
        <td class="num"><button type="button" class="pt-linknum" data-pt-day="${esc(d.dateKey)}" data-pt-bucket="disappeared">${num(d.disappearedTarget || 0)}</button></td>
        <td class="num">${num(d.resTotal)}</td>
        <td class="num">${num(d.age0Target)}</td>
        <td>${d.reconOk ? '<span class="badge ok">OK</span>' : `<span class="badge bad">${d.reconDiff > 0 ? "+" : ""}${num(d.reconDiff)}</span>`}</td>
      </tr>`).join("")}</tbody>
    </table>`;
    $$("[data-pt-bucket]", el).forEach((btn) => {
      btn.addEventListener("click", () => {
        const day = btn.getAttribute("data-pt-day");
        const bucket = btn.getAttribute("data-pt-bucket");
        const slot = (model.daily || []).find((d) => d.dateKey === day);
        if (!slot) return;
        let list = slot[bucket] || [];
        if (bucket === "disappeared") list = (slot.disappeared || []).filter((r) => r.isTarget);
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
          ["Age mismatches", q.ageMismatch],
        ].map(([lab, n]) => `<div class="status-chip" style="cursor:default"><div class="n">${num(n || 0)}</div><div class="l">${esc(lab)}</div></div>`).join("")}
      </div>`;
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
          { label: "New RES", data: daily.map((d) => d.newRes.length), backgroundColor: "#0f766e" },
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
    if (search) {
      search.addEventListener("change", () => {
        view.q = search.value.trim();
        if (lastModel) renderMovements(lastModel);
      });
      search.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          view.q = search.value.trim();
          if (lastModel) renderMovements(lastModel);
        }
      });
    }
    ["pt-f-snap", "pt-f-move", "pt-f-product"].forEach((id) => {
      const el = $(`#${id}`);
      if (!el) return;
      el.addEventListener("change", () => {
        if (id.endsWith("snap")) view.snapDate = el.value;
        if (id.endsWith("move")) view.movement = el.value;
        if (id.endsWith("product")) view.product = el.value;
        if (lastModel) renderMovements(lastModel);
      });
    });
    const clear = $("#pt-clear");
    if (clear) {
      clear.addEventListener("click", () => {
        view.snapDate = "";
        view.movement = "";
        view.product = "";
        view.q = "";
        view.drill = "";
        if (search) search.value = "";
        if (lastModel) {
          fillFilters(lastModel);
          renderAll(lastModel);
        }
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
        }
      });
    }
    const exportBtn = $("#pt-export");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => exportExcel());
    }
    const refreshBtn = $("#pt-refresh");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => {
        render({ force: true });
      });
    }
  }

  function renderAll(model) {
    lastModel = model;
    const empty = $("#pt-empty");
    const dash = $("#pt-dash");
    if (!model.dateKeys.length) {
      if (empty) empty.hidden = false;
      if (dash) dash.hidden = true;
      return;
    }
    if (empty) empty.hidden = true;
    if (dash) dash.hidden = false;
    const hint = $("#pt-live-hint");
    if (hint) {
      hint.textContent = `${model.dateKeys.length} snapshot(s) · latest ${model.latestKey || "—"} · plan ${model.plan} · target ${TARGET_SEARCH_AREA}`;
    }
    fillFilters(model);
    renderKpis(model);
    renderProgress(model);
    renderYesterday(model);
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
      "New RES": d.newRes.length,
      "Transfers IN": d.transferIn.length,
      "Transfers OUT": d.transferOut.length,
      Disappeared: d.disappearedTarget || 0,
      "RES Total": d.resTotal,
      "Age 0": d.age0Target,
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
    view.monthKey = ctx.monthKey;

    let pack = null;
    if (typeof global.ensureRtlActiveMonth === "function") {
      pack = await global.ensureRtlActiveMonth(ctx.monthKey, !!(opts && opts.force));
    } else if (typeof global.getCachedRtlActiveMonth === "function") {
      pack = global.getCachedRtlActiveMonth(ctx.monthKey);
    }

    if (loading) loading.hidden = true;

    if (!pack || !pack.days || !Object.keys(pack.days).length) {
      if (empty) empty.hidden = false;
      if (dash) dash.hidden = true;
      return;
    }

    const model = buildModel(pack, { plan: ALLOCATION_PLAN });
    renderAll(model);
  }

  global.PlanTracker = {
    TARGET_SEARCH_AREA,
    ALLOCATION_PLAN,
    render,
    buildModel,
    view,
  };
})(typeof window !== "undefined" ? window : globalThis);
