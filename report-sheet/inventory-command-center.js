/**
 * Inventory Command Center — data layer
 *
 * Sources (Admin Push slots ↔ Excel workbooks):
 *   backorder  → Back Orders *.xlsx
 *   rtl        → rtlstock / RTL Stock
 *   central    → central.xlsx / Stock Central
 *   sales      → Sales Raw Data - TeleSales *.xlsx
 *   accessories→ accessoriessss.xlsx (row counts / DQ only)
 *   allocation → Stock E-Sales plan (Admin E-Sales values / allocation-plan-data.js)
 *
 * Matching rule (documented):
 *   Config key = Product | ALJ Suffix | Model Year | Exterior | Interior
 *   - Product/suffix normalized (trim, upper, Fortuner first-2-letter suffix when product is Fortuner)
 *   - Colors compacted via colorKey (A-Z0-9 only)
 *   - Year as trimmed string
 *   - VIN is unique within each stock source; duplicate VINs counted once per source for Available Stock
 *   - BO units: one row = one unit (qty field used when present)
 *   - Sales Raw TeleSales typically has Product + Model Year only (no suffix/colors).
 *     Sales & velocity therefore join on Product (+ Year when both sides have year),
 *     and are attributed to every config row under that product/year.
 *   - E-Sales stock joins on Product + Suffix only (allocation plan leaf).
 */
(function (global) {
  const CONFIG = {
    /** Stock coverage bands */
    coverage: {
      criticalMax: 0.5, // < 0.50 Critical
      atRiskMax: 1.0, // < 1.00 At Risk
      balancedMax: 1.5, // < 1.50 Balanced; >= Healthy / Overstock by velocity
    },
    /** Quadrant split defaults (overridden by data medians when autoThresholds=true) */
    quadrants: {
      autoThresholds: true,
      coverageSplit: 1.0,
      velocitySplit: null, // set from median when null + auto
    },
    /** Demand pressure weights (documented formula below) */
    demand: {
      boWeight: 0.55,
      velocityWeight: 0.35,
      scarcityWeight: 0.1,
    },
    /** Ageing (days) considered high */
    ageing: {
      highDays: 30,
    },
    /** Bubble radius mapping for Chart.js */
    bubble: {
      minR: 6,
      maxR: 28,
    },
    pageSize: 50,
  };

  /**
   * Demand Pressure (0–100):
   *   pressure = 100 * (
   *     wBo * norm(BO) +
   *     wVel * norm(velocity) +
   *     wScarce * (1 - clamp(coverage / 2, 0, 1))
   *   )
   * where norm(x) = x / max(x) across the current dataset (0 if max=0).
   */

  function upperTrim(v) {
    return String(v ?? "").trim().toUpperCase();
  }

  function compact(v) {
    return upperTrim(v).replace(/[^A-Z0-9]/g, "");
  }

  function colorKey(v) {
    return compact(v);
  }

  function isFortuner(product) {
    return compact(product).includes("FORTUNER");
  }

  function normalizeSuffix(product, suffix) {
    const s = String(suffix ?? "").trim();
    if (!s || s === "—") return s || "";
    if (!isFortuner(product)) return upperTrim(s);
    const c = compact(s);
    return c ? c.slice(0, 2) : upperTrim(s);
  }

  function normalizeYear(y) {
    const s = String(y ?? "").trim();
    if (!s) return "";
    const m = s.match(/(20\d{2}|19\d{2})/);
    return m ? m[1] : s;
  }

  function display(v, fallback) {
    const s = String(v ?? "").trim();
    return s || fallback || "—";
  }

  function toNum(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const n = Number(String(v).replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : 0;
  }

  function safeDiv(num, den) {
    if (!den || !Number.isFinite(den) || den === 0) return null;
    if (!Number.isFinite(num)) return null;
    return num / den;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function median(arr) {
    const a = (arr || []).filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
    if (!a.length) return 0;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  function parseLooseDate(v) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
    if (v == null || v === "") return null;
    if (typeof v === "number" && Number.isFinite(v)) {
      // Excel serial (approximate)
      if (v > 20000 && v < 80000) {
        const epoch = Date.UTC(1899, 11, 30);
        const d = new Date(epoch + Math.round(v) * 86400000);
        return Number.isNaN(d.getTime()) ? null : d;
      }
    }
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function configParts(row, helpers) {
    const product = upperTrim(row.product || row.Product || "");
    const suffix = normalizeSuffix(product, row.suffix || row.sfx || row["Alj Suffix"] || "");
    const year = normalizeYear(row.year || row["Model Year"] || row.modelYear || "");
    const ext = colorKey(row.ext || row.exterior || row["Exterior Color"] || "");
    const intc = colorKey(row.int || row.interior || row["Interior Color"] || "");
    const vin = helpers && helpers.extractVin
      ? helpers.extractVin(row.vin || row.VIN || "")
      : upperTrim(row.vin || row.VIN || "");
    return { product, suffix, year, ext, int: intc, vin };
  }

  function keyAtLevel(parts, level) {
    // 0 product → 1 +suffix → 2 +year → 3 +ext → 4 +int
    const bits = [parts.product || "_"];
    if (level >= 1) bits.push(parts.suffix || "_");
    if (level >= 2) bits.push(parts.year || "_");
    if (level >= 3) bits.push(parts.ext || "_");
    if (level >= 4) bits.push(parts.int || "_");
    return bits.join("|");
  }

  function salesJoinKey(parts) {
    // Sales Raw usually lacks suffix/colors — Product + Year when year present
    if (parts.year) return `P:${parts.product}|Y:${parts.year}`;
    return `P:${parts.product}`;
  }

  function esalesKey(product, suffix) {
    return `${compact(product) || upperTrim(product)}|${normalizeSuffix(product, suffix)}`;
  }

  function coverageStatus(coverage, velocity, velocitySplit, cfg) {
    const c = cfg.coverage;
    if (coverage == null) {
      // No BO → infinite coverage conceptually; classify by velocity
      if (velocity >= velocitySplit) return "Healthy";
      return "Overstock";
    }
    if (coverage < c.criticalMax) return "Critical";
    if (coverage < c.atRiskMax) return "At Risk";
    if (coverage < c.balancedMax) return "Balanced";
    if (velocity < velocitySplit) return "Overstock";
    return "Healthy";
  }

  function quadrantOf(coverage, velocity, covSplit, velSplit) {
    const cov = coverage == null ? Infinity : coverage;
    const highCov = cov >= covSplit;
    const highVel = velocity >= velSplit;
    if (!highCov && highVel) return "CRITICAL";
    if (highCov && highVel) return "FAST_MOVING";
    if (highCov && !highVel) return "OVERSTOCK";
    return "WATCH";
  }

  function recommendedAction(status, quadrant) {
    if (status === "Critical" || quadrant === "CRITICAL") {
      return "Prioritize allocation / expedite supply / review BO priority";
    }
    if (status === "At Risk") {
      return "Monitor replenishment / protect allocation for confirmed BO";
    }
    if (status === "Overstock" || quadrant === "OVERSTOCK") {
      return "Push sales / campaign / review allocation / consider transfer";
    }
    if (quadrant === "FAST_MOVING" || status === "Healthy") {
      return "Maintain inventory / monitor replenishment";
    }
    if (status === "Balanced") return "Maintain balance / watch demand";
    return "Monitor closely";
  }

  function aggregateUnits(map, key, add) {
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, {
        key,
        backOrders: 0,
        availableStock: 0,
        rtlStock: 0,
        centralStock: 0,
        eSalesStock: 0,
        sales: 0,
        ageingSum: 0,
        ageingCount: 0,
        vins: new Set(),
        products: new Set(),
        suffixes: new Set(),
        years: new Set(),
        exts: new Set(),
        ints: new Set(),
        sample: null,
      });
    }
    add(map.get(key));
  }

  function pickLabel(set, fallback) {
    const vals = [...set].filter((x) => x && x !== "_");
    if (!vals.length) return fallback || "—";
    if (vals.length === 1) return vals[0];
    return `${vals[0]} (+${vals.length - 1})`;
  }

  /**
   * @param {object} input
   * @param {object[]} input.boRows - mapped BO {product,suffix,year,ext,int,qty?}
   * @param {object[]} input.rtlRows - mapped stock
   * @param {object[]} input.centralRows - mapped stock
   * @param {object[]} input.salesRows - sales with product, year, dates
   * @param {object[]} input.allocationLeaves - {product,sfx,allocation}
   * @param {number} [input.periodDays]
   * @param {object} [input.configOverrides]
   * @param {number} [input.drillLevel] 0..4
   * @param {object} [input.helpers] { extractVin, boQty }
   */
  function build(input) {
    const cfg = {
      ...CONFIG,
      coverage: { ...CONFIG.coverage, ...(input.configOverrides && input.configOverrides.coverage) },
      quadrants: { ...CONFIG.quadrants, ...(input.configOverrides && input.configOverrides.quadrants) },
      demand: { ...CONFIG.demand, ...(input.configOverrides && input.configOverrides.demand) },
      ageing: { ...CONFIG.ageing, ...(input.configOverrides && input.configOverrides.ageing) },
      bubble: { ...CONFIG.bubble, ...(input.configOverrides && input.configOverrides.bubble) },
    };
    const level = clamp(Number(input.drillLevel) || 0, 0, 4);
    const helpers = input.helpers || {};
    const boQty = helpers.boQty || (() => 1);

    const dq = {
      sourceRows: {
        backorder: (input.boRows || []).length,
        rtl: (input.rtlRows || []).length,
        central: (input.centralRows || []).length,
        sales: (input.salesRows || []).length,
        accessories: (input.accessoryRows || []).length,
        allocationLeaves: (input.allocationLeaves || []).length,
      },
      duplicateVins: 0,
      missingProduct: 0,
      missingSuffix: 0,
      missingYear: 0,
      missingExt: 0,
      missingInt: 0,
      matchedConfigs: 0,
      unmatchedBoKeys: 0,
      unmatchedStockKeys: 0,
    };

    // --- Sales period days ---
    let periodDays = Number(input.periodDays) || 0;
    const saleDates = [];
    (input.salesRows || []).forEach((r) => {
      const d = parseLooseDate(r.deliveryDate || r.proformaDate || r.date);
      if (d) saleDates.push(d.getTime());
    });
    if (!periodDays && saleDates.length) {
      const min = Math.min(...saleDates);
      const max = Math.max(...saleDates);
      periodDays = Math.max(1, Math.round((max - min) / 86400000) + 1);
    }
    if (!periodDays) periodDays = 30;

    // --- E-Sales map (product+suffix) ---
    const eSalesMap = new Map();
    (input.allocationLeaves || []).forEach((leaf) => {
      if (!leaf || leaf.kind === "total") return;
      const product = leaf.product || "";
      const suffix = leaf.sfx || leaf.suffix || "";
      const k = esalesKey(product, suffix);
      eSalesMap.set(k, (eSalesMap.get(k) || 0) + (Number(leaf.allocation) || 0));
    });

    // --- Sales counts by product(+year) ---
    const salesMap = new Map();
    (input.salesRows || []).forEach((r) => {
      const product = upperTrim(r.product || r.Product || r.model || "");
      if (!product) {
        dq.missingProduct += 1;
        return;
      }
      const year = normalizeYear(r.year || r["Model Year"] || r.modelYear || "");
      const parts = { product, year };
      const kExact = salesJoinKey(parts);
      const kProd = `P:${product}`;
      const qty = Math.max(1, toNum(r.qty) || 1);
      salesMap.set(kExact, (salesMap.get(kExact) || 0) + qty);
      if (year) salesMap.set(kProd, (salesMap.get(kProd) || 0) + qty);
    });

    const buckets = new Map();

    function touchMeta(b, parts) {
      if (parts.product) b.products.add(parts.product);
      if (parts.suffix) b.suffixes.add(parts.suffix);
      if (parts.year) b.years.add(parts.year);
      if (parts.ext) b.exts.add(parts.ext);
      if (parts.int) b.ints.add(parts.int);
      if (!b.sample) b.sample = { ...parts };
    }

    // BO
    (input.boRows || []).forEach((r) => {
      const parts = configParts(r, helpers);
      if (!parts.product) {
        dq.missingProduct += 1;
        return;
      }
      if (!parts.suffix) dq.missingSuffix += 1;
      if (!parts.year) dq.missingYear += 1;
      if (!parts.ext) dq.missingExt += 1;
      if (!parts.int) dq.missingInt += 1;
      const key = keyAtLevel(parts, level);
      const qty = Math.max(1, toNum(r.qty) || boQty(r) || 1);
      aggregateUnits(buckets, key, (b) => {
        b.backOrders += qty;
        touchMeta(b, parts);
      });
    });

    // Stock helper
    function ingestStock(rows, sourceField) {
      const seenVin = new Set();
      (rows || []).forEach((r) => {
        const parts = configParts(r, helpers);
        if (!parts.product) {
          dq.missingProduct += 1;
          return;
        }
        if (!parts.suffix) dq.missingSuffix += 1;
        if (!parts.year) dq.missingYear += 1;
        if (!parts.ext) dq.missingExt += 1;
        if (!parts.int) dq.missingInt += 1;

        const vin = parts.vin;
        if (vin) {
          const vk = `${sourceField}:${vin}`;
          if (seenVin.has(vk)) {
            dq.duplicateVins += 1;
            return;
          }
          seenVin.add(vk);
        }

        const key = keyAtLevel(parts, level);
        const age = toNum(r.ageing != null ? r.ageing : r.aging);
        aggregateUnits(buckets, key, (b) => {
          b.availableStock += 1;
          if (sourceField === "rtl") b.rtlStock += 1;
          else b.centralStock += 1;
          if (vin) b.vins.add(vin);
          if (Number.isFinite(age) && age >= 0) {
            b.ageingSum += age;
            b.ageingCount += 1;
          }
          touchMeta(b, parts);
        });
      });
    }
    ingestStock(input.rtlRows, "rtl");
    ingestStock(input.centralRows, "central");

    // Attach E-Sales + Sales to buckets
    buckets.forEach((b) => {
      const product = pickLabel(b.products, b.sample && b.sample.product);
      const suffix = pickLabel(b.suffixes, b.sample && b.sample.suffix);
      const year = pickLabel(b.years, b.sample && b.sample.year);

      // E-Sales: sum matching leaves under this bucket
      let eSales = 0;
      if (level === 0) {
        eSalesMap.forEach((v, k) => {
          if (k.startsWith((compact(product) || product) + "|")) eSales += v;
        });
      } else {
        eSales = eSalesMap.get(esalesKey(product, suffix)) || 0;
        // If multi-suffix label, sum all suffixes in set
        if (b.suffixes.size > 1) {
          eSales = 0;
          b.suffixes.forEach((sfx) => {
            eSales += eSalesMap.get(esalesKey(product, sfx)) || 0;
          });
        }
      }
      b.eSalesStock = eSales;

      const skYear = year && year !== "—" ? salesJoinKey({ product, year }) : null;
      const skProd = `P:${product}`;
      let sales = 0;
      if (skYear && salesMap.has(skYear)) sales = salesMap.get(skYear);
      else sales = salesMap.get(skProd) || 0;
      // Avoid double-counting product sales across many year buckets at product level:
      // at level 0 product-only, use product key only
      if (level === 0) sales = salesMap.get(skProd) || sales;
      b.sales = sales;
    });

    // Also create buckets that only exist in E-Sales / Sales? Skip — focus demand vs stock from BO+stock.

    const coverages = [];
    const velocities = [];
    let rows = [...buckets.values()].map((b) => {
      const product = pickLabel(b.products, "—");
      const suffix = level >= 1 ? pickLabel(b.suffixes, "—") : "—";
      const year = level >= 2 ? pickLabel(b.years, "—") : "—";
      const ext = level >= 3 ? pickLabel(b.exts, "—") : "—";
      const intc = level >= 4 ? pickLabel(b.ints, "—") : "—";
      const coverage = safeDiv(b.availableStock, b.backOrders);
      const velocity = b.sales / periodDays;
      const ageing = b.ageingCount ? b.ageingSum / b.ageingCount : null;
      if (coverage != null) coverages.push(coverage);
      velocities.push(velocity);
      return {
        id: b.key,
        product,
        suffix,
        year,
        ext,
        int: intc,
        backOrders: b.backOrders,
        availableStock: b.availableStock,
        rtlStock: b.rtlStock,
        centralStock: b.centralStock,
        eSalesStock: b.eSalesStock,
        sales: b.sales,
        salesVelocity: velocity,
        stockCoverage: coverage,
        allocationAgeing: ageing,
        vinCount: b.vins.size,
      };
    });

    // Drop empty noise (no BO and no stock)
    rows = rows.filter((r) => r.backOrders > 0 || r.availableStock > 0);

    const maxBo = Math.max(0, ...rows.map((r) => r.backOrders));
    const maxVel = Math.max(0, ...rows.map((r) => r.salesVelocity));
    // Coverage split defaults to 1.0 (stock covers BO). Velocity split uses data median when auto.
    const covSplit = cfg.quadrants.coverageSplit != null
      ? cfg.quadrants.coverageSplit
      : 1.0;
    const velSplit = cfg.quadrants.autoThresholds
      ? (cfg.quadrants.velocitySplit != null ? cfg.quadrants.velocitySplit : (median(velocities) || 0))
      : (cfg.quadrants.velocitySplit != null ? cfg.quadrants.velocitySplit : 0);

    rows = rows.map((r) => {
      const covNorm = r.stockCoverage == null ? 1 : clamp(r.stockCoverage / 2, 0, 1);
      const scarcity = 1 - covNorm;
      const pressure =
        100 *
        (cfg.demand.boWeight * (maxBo ? r.backOrders / maxBo : 0) +
          cfg.demand.velocityWeight * (maxVel ? r.salesVelocity / maxVel : 0) +
          cfg.demand.scarcityWeight * scarcity);
      const inventoryStatus = coverageStatus(r.stockCoverage, r.salesVelocity, velSplit, cfg);
      const quadrant = quadrantOf(r.stockCoverage, r.salesVelocity, covSplit, velSplit);
      const demandStatus =
        pressure >= 70 ? "High" : pressure >= 40 ? "Moderate" : "Low";
      return {
        ...r,
        demandPressure: Math.round(pressure * 10) / 10,
        demandStatus,
        inventoryStatus,
        quadrant,
        recommendedAction: recommendedAction(inventoryStatus, quadrant),
        stockCoverageDisplay: r.stockCoverage == null ? "∞ (no BO)" : Math.round(r.stockCoverage * 100) / 100,
      };
    });

    dq.matchedConfigs = rows.filter((r) => r.backOrders > 0 && r.availableStock > 0).length;
    dq.unmatchedBoKeys = rows.filter((r) => r.backOrders > 0 && r.availableStock === 0).length;
    dq.unmatchedStockKeys = rows.filter((r) => r.availableStock > 0 && r.backOrders === 0).length;

    const totalBo = rows.reduce((s, r) => s + r.backOrders, 0);
    const totalStock = rows.reduce((s, r) => s + r.availableStock, 0);
    const totalSales = rows.reduce((s, r) => s + r.sales, 0);
    // Avoid double-counting sales across config rows that share product sales attribution
    const salesSeen = new Set();
    let uniqueSales = 0;
    rows.forEach((r) => {
      const sk = level === 0 ? `P:${r.product}` : `P:${r.product}|Y:${r.year}`;
      if (salesSeen.has(sk)) return;
      salesSeen.add(sk);
      uniqueSales += r.sales;
    });

    const kpis = {
      totalBackOrders: totalBo,
      availableStock: totalStock,
      stockCoveragePct: totalBo ? (totalStock / totalBo) * 100 : null,
      totalSales: uniqueSales || totalSales,
      salesVelocity: (uniqueSales || totalSales) / periodDays,
      criticalVehicles: rows.filter((r) => r.inventoryStatus === "Critical" || r.quadrant === "CRITICAL").length,
      slowMovingVehicles: rows.filter((r) => r.quadrant === "OVERSTOCK" || r.inventoryStatus === "Overstock").length,
      overstockVehicles: rows.filter((r) => r.inventoryStatus === "Overstock").length,
      periodDays,
      coverageSplit: covSplit,
      velocitySplit: velSplit,
    };

    const insights = buildInsights(rows, kpis);

    return {
      config: cfg,
      drillLevel: level,
      rows,
      kpis,
      insights,
      dataQuality: dq,
      matchingNotes: [
        "Config key: Product | Suffix | Year | Ext | Int (level-dependent)",
        "Stock VINs deduped per source; BO rows counted as units",
        "Sales join: Product (+ Model Year when available) — Sales Raw often lacks suffix/colors",
        "E-Sales join: Product + Suffix from allocation plan",
        `Quadrant splits: coverage ${covSplit.toFixed(2)}, velocity ${velSplit.toFixed(3)}/day`,
      ],
    };
  }

  function buildInsights(rows, kpis) {
    const byBo = [...rows].sort((a, b) => b.backOrders - a.backOrders).slice(0, 5);
    const critical = [...rows]
      .filter((r) => r.inventoryStatus === "Critical" || r.quadrant === "CRITICAL")
      .sort((a, b) => b.demandPressure - a.demandPressure)
      .slice(0, 5);
    const ageing = [...rows]
      .filter((r) => r.allocationAgeing != null)
      .sort((a, b) => b.allocationAgeing - a.allocationAgeing)
      .slice(0, 5);
    const slow = [...rows]
      .filter((r) => r.availableStock > 0)
      .sort((a, b) => a.salesVelocity - b.salesVelocity || b.allocationAgeing - a.allocationAgeing)
      .slice(0, 5);
    const highCov = [...rows]
      .filter((r) => r.stockCoverage != null)
      .sort((a, b) => b.stockCoverage - a.stockCoverage)
      .slice(0, 5);
    const bestSell = [...rows].sort((a, b) => b.sales - a.sales).slice(0, 5);

    const label = (r) => [r.product, r.suffix !== "—" ? r.suffix : null, r.year !== "—" ? r.year : null]
      .filter(Boolean)
      .join(" · ");

    return [
      {
        id: "demand",
        title: "Highest demand (BO)",
        items: byBo.map((r) => `${label(r)} — BO ${r.backOrders}, stock ${r.availableStock}`),
      },
      {
        id: "critical",
        title: "Most critical shortages",
        items: critical.map((r) => `${label(r)} — coverage ${r.stockCoverageDisplay}, pressure ${r.demandPressure}`),
      },
      {
        id: "ageing",
        title: "Highest allocation ageing",
        items: ageing.map((r) => `${label(r)} — ${Math.round(r.allocationAgeing)}d · stock ${r.availableStock}`),
      },
      {
        id: "slow",
        title: "Slowest-moving inventory",
        items: slow.map((r) => `${label(r)} — vel ${r.salesVelocity.toFixed(2)}/d · stock ${r.availableStock}`),
      },
      {
        id: "overcov",
        title: "Unusually high stock coverage",
        items: highCov.map((r) => `${label(r)} — coverage ${r.stockCoverageDisplay}`),
      },
      {
        id: "bestsellers",
        title: "Best-selling models (period)",
        items: bestSell.map((r) => `${label(r)} — sales ${r.sales}, vel ${r.salesVelocity.toFixed(2)}/d`),
      },
      {
        id: "summary",
        title: "Period snapshot",
        items: [
          `BO ${kpis.totalBackOrders} · Stock ${kpis.availableStock} · Coverage ${kpis.stockCoveragePct == null ? "n/a" : kpis.stockCoveragePct.toFixed(0) + "%"}`,
          `Sales ${kpis.totalSales} over ${kpis.periodDays}d · Velocity ${kpis.salesVelocity.toFixed(2)}/day`,
          `Critical ${kpis.criticalVehicles} · Slow/Overstock ${kpis.slowMovingVehicles}`,
        ],
      },
    ];
  }

  function filterRows(rows, filters) {
    const f = filters || {};
    const q = String(f.search || "").trim().toLowerCase();
    return (rows || []).filter((r) => {
      if (f.product && r.product !== f.product) return false;
      if (f.suffix && r.suffix !== f.suffix) return false;
      if (f.year && r.year !== f.year) return false;
      if (f.ext && r.ext !== f.ext) return false;
      if (f.int && r.int !== f.int) return false;
      if (f.inventoryStatus && r.inventoryStatus !== f.inventoryStatus) return false;
      if (f.demandStatus && r.demandStatus !== f.demandStatus) return false;
      if (f.quadrant && r.quadrant !== f.quadrant) return false;
      if (f.ageingMin != null && f.ageingMin !== "" && (r.allocationAgeing == null || r.allocationAgeing < Number(f.ageingMin))) return false;
      if (f.ageingMax != null && f.ageingMax !== "" && (r.allocationAgeing == null || r.allocationAgeing > Number(f.ageingMax))) return false;
      if (f.coverageMin != null && f.coverageMin !== "") {
        const c = r.stockCoverage == null ? Infinity : r.stockCoverage;
        if (c < Number(f.coverageMin)) return false;
      }
      if (f.coverageMax != null && f.coverageMax !== "") {
        const c = r.stockCoverage == null ? Infinity : r.stockCoverage;
        if (c > Number(f.coverageMax)) return false;
      }
      if (q) {
        const hay = `${r.product} ${r.suffix} ${r.year} ${r.ext} ${r.int} ${r.inventoryStatus} ${r.recommendedAction}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function bubbleRadius(stock, maxStock, cfg) {
    const b = cfg.bubble || CONFIG.bubble;
    if (!maxStock) return b.minR;
    const t = Math.sqrt(stock / maxStock);
    return b.minR + t * (b.maxR - b.minR);
  }

  function toChartPoints(rows, mode, cfg) {
    const maxStock = Math.max(1, ...rows.map((r) => r.availableStock));
    return rows.map((r) => {
      const x = mode === "ageing"
        ? (r.allocationAgeing == null ? 0 : r.allocationAgeing)
        : (r.stockCoverage == null ? (r.availableStock > 0 ? 3 : 0) : Math.min(r.stockCoverage, 5));
      const y = r.salesVelocity;
      return {
        x,
        y,
        r: bubbleRadius(r.availableStock, maxStock, cfg || CONFIG),
        rowId: r.id,
        meta: r,
      };
    });
  }

  function rowsToExcel(rows) {
    return (rows || []).map((r) => ({
      Product: r.product,
      Suffix: r.suffix,
      "Model Year": r.year,
      Exterior: r.ext,
      Interior: r.int,
      "Back Orders": r.backOrders,
      "Available Stock": r.availableStock,
      "E-Sales Stock": r.eSalesStock,
      Sales: r.sales,
      "Sales Velocity": Math.round(r.salesVelocity * 1000) / 1000,
      "Stock Coverage": r.stockCoverageDisplay,
      "Allocation Ageing": r.allocationAgeing == null ? "" : Math.round(r.allocationAgeing * 10) / 10,
      "Demand Pressure": r.demandPressure,
      "Inventory Status": r.inventoryStatus,
      Quadrant: r.quadrant,
      "Recommended Action": r.recommendedAction,
    }));
  }

  global.InventoryCommandCenter = {
    CONFIG,
    build,
    filterRows,
    toChartPoints,
    rowsToExcel,
    normalizeSuffix,
    keyAtLevel,
    configParts,
  };
})(typeof window !== "undefined" ? window : globalThis);
