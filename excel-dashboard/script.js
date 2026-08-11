/**
 * Excel Dashboard — Backorder + RTL Stock + Central Stock matching
 * Implements Power Query logic:
 *   1) All stock matched   (BO ↔ Central, color dictionary FIFO)
 *   2) Daily stock matched (BO ↔ RTL, year + padded colors FIFO)
 *   3) Full control        (Central unique VIN + BO + RTL VIN check)
 */
(function () {
  "use strict";

  const ACCEPT =
    ".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
  const MAX_TABLE_RENDER = 5000;

  const SLOT_DEFS = [
    {
      id: "backorder",
      n: 1,
      title: "Backorder",
      blurb: "BO + fleet BO — first sheet only",
      kicker: "BO+ fleetBO",
    },
    {
      id: "rtl",
      n: 2,
      title: "RTL Stock",
      blurb: "Available retail stock — first sheet",
      kicker: "All Retail",
    },
    {
      id: "central",
      n: 3,
      title: "Central Stock",
      blurb: "All / central stock — first sheet",
      kicker: "all stock",
    },
  ];

  const HEADER_ALIASES = {
    product: ["product", "model"],
    suffix: ["alj suffix", "suffix", "tmc suffix"],
    year: ["model year", "year", "my"],
    extBo: ["exterior color  1", "exterior color 1", "exterior color", "ext color"],
    intBo: ["interior color 1", "interior color", "inter color 1"],
    extStock: ["exterior color", "exterior color  1", "exterior color 1", "ext color"],
    intStock: ["interior color", "interior color 1", "inter color 1"],
    vin: ["vin", "vehicle identification number"],
    boNumber: ["back order number", "backorder number", "bo number"],
    salesman: ["salesman name", "salesman"],
    orderDate: ["order date"],
    confirm: ["confirm flag", "confirm"],
    custGroup: ["cust group"],
    dpr: ["dpr"],
    paid: ["المبلغ المدفوع", "paid", "amount"],
    grade: ["grade (vc)", "grade"],
    item: ["item"],
    currentLocation: ["current location", "gt location", "location"],
    secondaryStatus: ["secondary status"],
    storageLocation: ["storage location"],
    sharing: ["sharing level", "sharing levels", "sharing level.1"],
    transmission: ["transmission"],
    brand: ["brand"],
    modelYearStock: ["model year", "year", "my"],
    allocationAgeing: ["allocation ageing", "age"],
    secondaryStatusDesc: [
      "secondary status descripiton",
      "secondary status description",
      "secondary status desc",
    ],
    usageDescription: ["usage description", "vehicle usage descr.", "usage"],
    allocatedLocation: ["allocated location"],
    pioAcc: ["pio acc comp date"],
    damageCategory: ["damage category"],
    supplierModelCodeDesc: ["supplier model code description"],
    distributionChannel: ["distribution channel"],
    mileage: ["mileage"],
    division: ["division"],
    shipNumber: ["ship number"],
    tmcSuffix: ["tmc suffix"],
    allocationDate: ["allocation date"],
    ndcGrDate: ["ndc gr date"],
    ndcGrAge: ["ndc gr age"],
    pipelineIndicator: ["pipeline indicator"],
    gtLocation: ["gt location"],
    transferDate: ["transfer date"],
    notification: ["notification"],
    licensePlate: ["license plate number"],
    vehicleSearchArea: ["vehicle search area"],
    searchAreaDesc: ["search area desc"],
    supplierModelCode: ["supplier model code", "model code"],
    primaryStatus: ["primary status"],
    primaryStatusDesc: ["primary status description", "primary status desc"],
    internalVehicleNumber: ["internal vehicle number"],
  };

  /** @type {Record<string, { file: File|null, rows: object[], name: string }>} */
  const slots = {
    backorder: emptySlot(),
    rtl: emptySlot(),
    central: emptySlot(),
  };

  const results = {
    allStock: [],
    daily: [],
    fullControl: [],
  };

  const ui = {
    1: { search: "", sortCol: null, sortDir: 1 },
    2: { search: "", filter: "", sortCol: null, sortDir: 1 },
    3: { search: "", boFilter: "", rtlFilter: "", sortCol: null, sortDir: 1 },
  };

  let colors = null;
  let exteriorMaster = [];
  let interiorMaster = [];

  function emptySlot() {
    return { file: null, rows: [], name: "" };
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setStatus(text, kind) {
    const el = $("#global-status");
    el.textContent = text;
    el.className = "status-pill" + (kind ? ` ${kind}` : "");
  }

  function showError(msg) {
    const el = $("#error-banner");
    el.hidden = !msg;
    el.textContent = msg || "";
    if (msg) setStatus("Error", "error");
  }

  function setLoading(on, text) {
    const banner = $("#load-banner");
    banner.hidden = !on;
    if (text) $("#load-text").textContent = text;
    if (on) setStatus("Matching…", "busy");
  }

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cellToString(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date) {
      const y = v.getFullYear();
      const m = String(v.getMonth() + 1).padStart(2, "0");
      const d = String(v.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function upperTrim(v) {
    return String(v == null ? "" : v).trim().toUpperCase();
  }

  function removeDashSpace(v) {
    return upperTrim(v).replace(/[-\s]/g, "");
  }

  function padExterior3(v) {
    return upperTrim(v).padStart(3, "0");
  }

  function lastToken(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s) return "";
    const parts = s.split(/\s+/);
    return parts[parts.length - 1] || "";
  }

  function normHeader(h) {
    return String(h || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function detectFileType(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (name.endsWith(".csv") || type.includes("csv") || type === "text/plain") return "csv";
    if (name.endsWith(".xls") && !name.endsWith(".xlsx")) return "xls";
    if (name.endsWith(".xlsx") || type.includes("spreadsheet") || type.includes("excel")) return "xlsx";
    return "unknown";
  }

  function validateFile(file) {
    if (detectFileType(file) === "unknown") {
      return `Unsupported file “${file.name}”. Use .xlsx, .xls, or .csv.`;
    }
    return null;
  }

  function buildFieldGetter(sampleRow) {
    const normKeys = Object.keys(sampleRow || {}).map((k) => ({ raw: k, n: normHeader(k) }));
    const cache = {};
    return function get(row, aliasKey) {
      if (!(aliasKey in cache)) {
        const aliases = HEADER_ALIASES[aliasKey] || [aliasKey];
        let found = null;
        for (const alias of aliases) {
          found = normKeys.find((k) => k.n === alias) || normKeys.find((k) => k.n.includes(alias));
          if (found) break;
        }
        cache[aliasKey] = found ? found.raw : null;
      }
      const key = cache[aliasKey];
      return key ? row[key] : "";
    };
  }

  function parseOrderDate(v) {
    if (v == null || v === "") return Number.MAX_SAFE_INTEGER;
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getTime();
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v > 20000 && v < 100000) return Date.UTC(1899, 11, 30) + v * 86400000;
      return v;
    }
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  }

  /**
   * Power Query: List.First(List.Select(Master, c => Text.Contains(text, c)))
   * Master is sorted Order.Descending.
   */
  function firstContainedCode(text, masterSortedDesc) {
    const hay = upperTrim(text);
    if (!hay) return null;
    for (const code of masterSortedDesc) {
      if (code && hay.includes(code)) return code;
    }
    return null;
  }

  function buildMastersFromColors() {
    const ext = (colors && colors.exterior && colors.exterior.all
      ? colors.exterior.all()
      : []
    )
      .map((e) => upperTrim(e.code))
      .filter(Boolean)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    const intc = (colors && colors.interior && colors.interior.all
      ? colors.interior.all()
      : []
    )
      .map((e) => upperTrim(e.code))
      .filter(Boolean)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

    exteriorMaster = ext;
    interiorMaster = intc;
  }

  async function readFileToWorkbook(file) {
    const kind = detectFileType(file);
    const buffer = await file.arrayBuffer();
    if (kind === "csv") {
      const text = new TextDecoder("utf-8").decode(buffer);
      return XLSX.read(text, { type: "string", FS: ",", cellDates: true });
    }
    return XLSX.read(buffer, { type: "array", cellDates: true });
  }

  const HEADER_MARKERS = [
    "product",
    "vin",
    "vehicle identification number",
    "alj suffix",
    "exterior color",
    "interior color",
    "model year",
    "back order number",
    "salesman name",
  ];

  /**
   * Read the first sheet, but detect the real header row.
   * ALJ exports often put a blank/title row above headers (Region / Product / VIN…),
   * which otherwise becomes __EMPTY_* columns and kills all matching.
   */
  function firstSheetRows(workbook) {
    const name = workbook.SheetNames[0];
    if (!name) return [];
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      defval: "",
      blankrows: false,
      raw: true,
      cellDates: true,
    });
    if (!matrix.length) return [];

    let headerIdx = 0;
    let bestHits = -1;
    const scanLimit = Math.min(matrix.length, 40);
    for (let i = 0; i < scanLimit; i += 1) {
      const cells = (matrix[i] || []).map((c) => normHeader(c));
      if (!cells.some(Boolean)) continue;
      const hits = HEADER_MARKERS.filter((m) =>
        cells.some((c) => c === m || c.includes(m))
      ).length;
      if (hits > bestHits) {
        bestHits = hits;
        headerIdx = i;
      }
      if (hits >= 3) break;
    }

    const headerRow = matrix[headerIdx] || [];
    const headers = headerRow.map((h, i) => {
      const label = cellToString(h).trim();
      return label || `Column ${i + 1}`;
    });
    const seen = {};
    const uniqueHeaders = headers.map((h) => {
      if (!seen[h]) {
        seen[h] = 1;
        return h;
      }
      seen[h] += 1;
      return `${h} (${seen[h]})`;
    });

    const rows = [];
    for (let r = headerIdx + 1; r < matrix.length; r += 1) {
      const line = matrix[r] || [];
      if (line.every((c) => cellToString(c).trim() === "")) continue;
      // Skip repeated header / title rows mixed into the body
      const asText = line.map((c) => normHeader(c));
      const looksLikeHeader =
        HEADER_MARKERS.filter((m) => asText.some((c) => c === m || c.includes(m)))
          .length >= 3;
      if (looksLikeHeader) continue;

      const obj = {};
      uniqueHeaders.forEach((h, i) => {
        obj[h] = line[i] != null ? line[i] : "";
      });
      rows.push(obj);
    }
    return rows;
  }

  /** Exterior for daily match: code → pad3; name → dictionary code → pad3. */
  function dailyExteriorCode(value) {
    const raw = cellToString(value).trim();
    if (!raw) return "";
    if (/^[A-Z0-9]{2,4}$/i.test(raw)) return padExterior3(raw);
    if (colors) {
      const code = colors.resolveExteriorCode(raw);
      if (code) return padExterior3(code);
    }
    const contained = firstContainedCode(raw, exteriorMaster);
    if (contained) return padExterior3(contained);
    return padExterior3(raw);
  }

  /** Interior for daily match: numeric code or dictionary name. */
  function dailyInteriorCode(value) {
    const raw = cellToString(value).trim();
    if (!raw) return "";
    if (/^\d{1,3}$/.test(raw)) return upperTrim(raw);
    if (colors) {
      const code = colors.resolveInteriorCode(raw);
      if (code) return upperTrim(code);
    }
    const contained = firstContainedCode(raw, interiorMaster);
    return contained || upperTrim(raw);
  }

  // ─────────────────────────────────────────────────────────────
  // Matching engines (Power Query ports)
  // ─────────────────────────────────────────────────────────────

  function runAllStockMatched(boRows, centralRows) {
    const getBo = buildFieldGetter(boRows[0] || {});
    const getCen = buildFieldGetter(centralRows[0] || {});

    const bos = boRows.map((r, idx) => {
      const product = upperTrim(getBo(r, "product"));
      const suffix = removeDashSpace(getBo(r, "suffix"));
      const extText = upperTrim(getBo(r, "extBo"));
      const intText = upperTrim(getBo(r, "intBo"));
      const exteriorCode = firstContainedCode(extText, exteriorMaster);
      const interiorCode = firstContainedCode(intText, interiorMaster);
      return {
        idx,
        product,
        suffix,
        exteriorCode,
        interiorCode,
        extText,
        intText,
        salesman: getBo(r, "salesman"),
        boNumber: getBo(r, "boNumber"),
        orderDate: getBo(r, "orderDate"),
        orderTs: parseOrderDate(getBo(r, "orderDate")),
        confirm: getBo(r, "confirm"),
        custGroup: getBo(r, "custGroup"),
        dpr: getBo(r, "dpr"),
        paid: getBo(r, "paid"),
        modelYear: getBo(r, "year"),
        item: getBo(r, "item"),
        key: [product, suffix, exteriorCode, interiorCode].join("|"),
      };
    });

    const stocks = centralRows.map((r, idx) => {
      const product = upperTrim(getCen(r, "product"));
      const suffix = removeDashSpace(getCen(r, "suffix"));
      const extText = upperTrim(getCen(r, "extStock"));
      const intText = upperTrim(getCen(r, "intStock"));
      const exteriorCode = firstContainedCode(extText, exteriorMaster);
      const interiorCode = firstContainedCode(intText, interiorMaster);
      const vin = cellToString(getCen(r, "vin")).trim();
      return {
        idx,
        product,
        suffix,
        exteriorCode,
        interiorCode,
        extText,
        intText,
        vin,
        modelYear: getCen(r, "modelYearStock"),
        transmission: getCen(r, "transmission"),
        grade: getCen(r, "grade"),
        allocationAgeing: getCen(r, "allocationAgeing"),
        secondaryStatusDesc: getCen(r, "secondaryStatusDesc"),
        usageDescription: getCen(r, "usageDescription"),
        allocatedLocation: getCen(r, "allocatedLocation"),
        currentLocation: getCen(r, "currentLocation"),
        secondaryStatus: getCen(r, "secondaryStatus"),
        storageLocation: getCen(r, "storageLocation"),
        pioAcc: getCen(r, "pioAcc"),
        damageCategory: getCen(r, "damageCategory"),
        sharing: getCen(r, "sharing"),
        supplierModelCodeDesc: getCen(r, "supplierModelCodeDesc"),
        distributionChannel: getCen(r, "distributionChannel"),
        mileage: getCen(r, "mileage"),
        division: getCen(r, "division"),
        shipNumber: getCen(r, "shipNumber"),
        tmcSuffix: getCen(r, "tmcSuffix"),
        brand: getCen(r, "brand"),
        allocationDate: getCen(r, "allocationDate"),
        ndcGrDate: getCen(r, "ndcGrDate"),
        ndcGrAge: getCen(r, "ndcGrAge"),
        pipelineIndicator: getCen(r, "pipelineIndicator"),
        gtLocation: getCen(r, "gtLocation"),
        transferDate: getCen(r, "transferDate"),
        notification: getCen(r, "notification"),
        licensePlate: getCen(r, "licensePlate"),
        vehicleSearchArea: getCen(r, "vehicleSearchArea"),
        searchAreaDesc: getCen(r, "searchAreaDesc"),
        supplierModelCode: getCen(r, "supplierModelCode"),
        primaryStatus: getCen(r, "primaryStatus"),
        primaryStatusDesc: getCen(r, "primaryStatusDesc"),
        internalVehicleNumber: getCen(r, "internalVehicleNumber"),
        key: [product, suffix, exteriorCode, interiorCode].join("|"),
      };
    });

    const sortedBo = bos.slice().sort((a, b) => a.orderTs - b.orderTs || a.idx - b.idx);
    const sortedStock = stocks
      .slice()
      .sort((a, b) => String(a.vin).localeCompare(String(b.vin), undefined, { numeric: true }));

    const stockPools = new Map();
    sortedStock.forEach((s) => {
      if (!stockPools.has(s.key)) stockPools.set(s.key, []);
      stockPools.get(s.key).push({ ...s, used: false });
    });

    const boGroups = new Map();
    sortedBo.forEach((b) => {
      if (!boGroups.has(b.key)) boGroups.set(b.key, []);
      boGroups.get(b.key).push(b);
    });
    const boIndex = new Map();
    boGroups.forEach((arr) => arr.forEach((b, i) => boIndex.set(b.idx, i + 1)));

    const out = [];
    sortedBo.forEach((bo) => {
      const pool = stockPools.get(bo.key) || [];
      const stock = pool.find((s) => !s.used && s.vin);
      if (!stock) return;
      stock.used = true;
      const stockIndex = pool.indexOf(stock) + 1;
      out.push({
        Product: bo.product,
        "Alj Suffix": bo.suffix,
        "Salesman Name": cellToString(bo.salesman),
        "Back Order Number": cellToString(bo.boNumber),
        "Order Date": cellToString(bo.orderDate),
        "Confirm Flag": cellToString(bo.confirm),
        "Cust Group": cellToString(bo.custGroup),
        DPR: cellToString(bo.dpr),
        "المبلغ المدفوع": cellToString(bo.paid),
        "Model Year": cellToString(bo.modelYear),
        "Exterior Color  1": bo.extText,
        "Interior Color 1": bo.intText,
        Item: cellToString(bo.item),
        BO_Index: boIndex.get(bo.idx),
        "Stock.VIN": stock.vin,
        "Stock.Model Year": cellToString(stock.modelYear),
        "Stock.Transmission": cellToString(stock.transmission),
        "Stock.Grade": cellToString(stock.grade),
        "Stock.Exterior Color": stock.extText,
        "Stock.Interior Color": stock.intText,
        "Stock.Allocation Ageing": cellToString(stock.allocationAgeing),
        "Stock.Secondary Status Descripiton": cellToString(stock.secondaryStatusDesc),
        "Stock.Usage Description": cellToString(stock.usageDescription),
        "Stock.Allocated Location": cellToString(stock.allocatedLocation),
        "Stock.Current Location": cellToString(stock.currentLocation),
        "Stock.Secondary Status": cellToString(stock.secondaryStatus),
        "Stock.Storage Location": cellToString(stock.storageLocation),
        "Stock.PIO ACC Comp Date": cellToString(stock.pioAcc),
        "Stock.Damage Category": cellToString(stock.damageCategory),
        "Stock.Sharing Level": cellToString(stock.sharing),
        "Stock.Supplier Model Code Description": cellToString(stock.supplierModelCodeDesc),
        "Stock.Distribution Channel": cellToString(stock.distributionChannel),
        "Stock.Mileage": cellToString(stock.mileage),
        "Stock.Division": cellToString(stock.division),
        "Stock.Ship Number": cellToString(stock.shipNumber),
        "Stock.TMC Suffix": cellToString(stock.tmcSuffix),
        "Stock.Brand": cellToString(stock.brand),
        "Stock.Allocation date": cellToString(stock.allocationDate),
        "Stock.NDC GR Date": cellToString(stock.ndcGrDate),
        "Stock.NDC GR Age": cellToString(stock.ndcGrAge),
        "Stock.Pipeline Indicator": cellToString(stock.pipelineIndicator),
        "Stock.Gt Location": cellToString(stock.gtLocation),
        "Stock.Transfer Date": cellToString(stock.transferDate),
        "Stock.Notification": cellToString(stock.notification),
        "Stock.License Plate Number": cellToString(stock.licensePlate),
        "Stock.Vehicle Search Area": cellToString(stock.vehicleSearchArea),
        "Stock.Search Area Desc": cellToString(stock.searchAreaDesc),
        "Stock.Supplier Model Code": cellToString(stock.supplierModelCode),
        "Stock.Primary Status": cellToString(stock.primaryStatus),
        "Stock.Primary Status Description": cellToString(stock.primaryStatusDesc),
        "Stock.Internal Vehicle Number": cellToString(stock.internalVehicleNumber),
        "Stock.Stock_Index": stockIndex,
      });
    });

    return out;
  }

  function quantityStatus(boCount, stockCount) {
    if (boCount == null) return "NO BO";
    if (stockCount == null || stockCount === 0) return "NO STOCK";
    if (boCount > stockCount) return "BO > STOCK";
    if (boCount < stockCount) return "STOCK > BO";
    return "BALANCED";
  }

  function runDailyStockMatched(boRows, rtlRows) {
    const getBo = buildFieldGetter(boRows[0] || {});
    const getRtl = buildFieldGetter(rtlRows[0] || {});

    const bos = boRows.map((r, idx) => {
      const product = upperTrim(getBo(r, "product"));
      const suffix = upperTrim(getBo(r, "suffix"));
      const year = String(getBo(r, "year") ?? "");
      const ext = dailyExteriorCode(getBo(r, "extBo"));
      const intc = dailyInteriorCode(getBo(r, "intBo"));
      return {
        idx,
        product,
        suffix,
        year,
        ext,
        int: intc,
        key: [product, suffix, year, ext, intc].join("|"),
        salesman: getBo(r, "salesman"),
        boNumber: getBo(r, "boNumber"),
        orderDate: getBo(r, "orderDate"),
        orderTs: parseOrderDate(getBo(r, "orderDate")),
        confirm: getBo(r, "confirm"),
        custGroup: getBo(r, "custGroup"),
        dpr: getBo(r, "dpr"),
        paid: getBo(r, "paid"),
        grade: getBo(r, "grade"),
        item: getBo(r, "item"),
        raw: r,
      };
    });

    const stocks = rtlRows.map((r, idx) => {
      const product = upperTrim(getRtl(r, "product"));
      const suffix = upperTrim(getRtl(r, "suffix"));
      const year = String(getRtl(r, "year") ?? "");
      const ext = dailyExteriorCode(getRtl(r, "extStock"));
      const intc = dailyInteriorCode(getRtl(r, "intStock"));
      const vin = cellToString(getRtl(r, "vin")).trim();
      return {
        idx,
        product,
        suffix,
        year,
        ext,
        int: intc,
        vin,
        key: [product, suffix, year, ext, intc].join("|"),
        raw: r,
      };
    });

    const sortedBo = bos.slice().sort((a, b) => a.orderTs - b.orderTs || a.idx - b.idx);
    const sortedStock = stocks
      .slice()
      .sort((a, b) => String(a.vin).localeCompare(String(b.vin), undefined, { numeric: true }));

    const stockPools = new Map();
    sortedStock.forEach((s) => {
      if (!stockPools.has(s.key)) stockPools.set(s.key, []);
      stockPools.get(s.key).push({ ...s, used: false });
    });

    const boCountMap = new Map();
    const stockCountMap = new Map();
    bos.forEach((b) => boCountMap.set(b.key, (boCountMap.get(b.key) || 0) + 1));
    stocks.forEach((s) => stockCountMap.set(s.key, (stockCountMap.get(s.key) || 0) + 1));

    const out = [];
    sortedBo.forEach((bo) => {
      const pool = stockPools.get(bo.key) || [];
      const hit = pool.find((s) => !s.used && s.vin);
      if (hit) hit.used = true;

      const stockCount = stockCountMap.has(bo.key) ? stockCountMap.get(bo.key) : null;
      const boCount = boCountMap.has(bo.key) ? boCountMap.get(bo.key) : null;

      const stockCols = {};
      if (hit && hit.raw) {
        Object.keys(hit.raw).forEach((k) => {
          const nk = normHeader(k);
          if (
            nk === "product" ||
            nk === "alj suffix" ||
            nk === "model year" ||
            nk === "exterior color" ||
            nk === "interior color" ||
            nk === "stock_index"
          ) {
            return;
          }
          stockCols[`Stock.${k}`] = cellToString(hit.raw[k]);
        });
      }

      out.push({
        Product: bo.product,
        "Alj Suffix": bo.suffix,
        "Salesman Name": cellToString(bo.salesman),
        "Back Order Number": cellToString(bo.boNumber),
        "Order Date": cellToString(bo.orderDate),
        "Confirm Flag": cellToString(bo.confirm),
        "Cust Group": cellToString(bo.custGroup),
        DPR: cellToString(bo.dpr),
        "المبلغ المدفوع": cellToString(bo.paid),
        "Model Year": bo.year,
        "Exterior Color  1": bo.ext,
        "Interior Color 1": bo.int,
        Item: cellToString(bo.item),
        "Grade (VC)": cellToString(bo.grade),
        ...stockCols,
        "Quantity Status": quantityStatus(boCount, stockCount),
      });
    });

    return out;
  }

  function runFullControl(boRows, rtlRows, centralRows) {
    const getBo = buildFieldGetter(boRows[0] || {});
    const getCen = buildFieldGetter(centralRows[0] || {});
    const getRtl = buildFieldGetter(rtlRows[0] || {});

    const bos = boRows.map((r, idx) => {
      const product = upperTrim(getBo(r, "product"));
      const suffix = upperTrim(getBo(r, "suffix"));
      const year = String(getBo(r, "year") ?? "");
      const extCode = upperTrim(getBo(r, "extBo"));
      const intCode = upperTrim(getBo(r, "intBo"));
      return {
        idx,
        product,
        suffix,
        year,
        extCode,
        intCode,
        key: [product, year, suffix, extCode, intCode].join("|"),
        salesman: getBo(r, "salesman"),
        boNumber: getBo(r, "boNumber"),
        orderDate: getBo(r, "orderDate"),
        confirm: getBo(r, "confirm"),
        custGroup: getBo(r, "custGroup"),
        dpr: getBo(r, "dpr"),
        paid: getBo(r, "paid"),
        grade: getBo(r, "grade"),
      };
    });

    const boByKey = new Map();
    bos.forEach((b) => {
      if (!boByKey.has(b.key)) boByKey.set(b.key, []);
      boByKey.get(b.key).push(b);
    });

    const retailVins = new Set(
      rtlRows.map((r) => cellToString(getRtl(r, "vin")).trim()).filter(Boolean)
    );

    const seenVin = new Set();
    const out = [];

    centralRows.forEach((r) => {
      const vin = cellToString(getCen(r, "vin")).trim();
      if (!vin || seenVin.has(vin)) return;
      seenVin.add(vin);

      const product = upperTrim(getCen(r, "product"));
      const suffix = upperTrim(getCen(r, "suffix"));
      const year = String(getCen(r, "modelYearStock") ?? "");
      const extName = cellToString(getCen(r, "extStock"));
      const intName = cellToString(getCen(r, "intStock"));
      const extCode = upperTrim(lastToken(extName));
      const intCode = upperTrim(lastToken(intName));
      const key = [product, year, suffix, extCode, intCode].join("|");
      const boHit = (boByKey.get(key) || [])[0] || null;
      const matched = !!boHit;

      out.push({
        VIN: vin,
        Product: product,
        "Alj Suffix": suffix,
        "Model Year": year,
        "Exterior Color": upperTrim(extName),
        "Interior Color": upperTrim(intName),
        "Exterior Color Code": extCode,
        "Interior Color Code": intCode,
        "Current Location": cellToString(getCen(r, "currentLocation")),
        "Secondary Status": cellToString(getCen(r, "secondaryStatus")),
        "Storage Location": cellToString(getCen(r, "storageLocation")),
        "Sharing Level": cellToString(getCen(r, "sharing")),
        "Salesman Name": matched ? cellToString(boHit.salesman) : "",
        "Back Order Number": matched ? cellToString(boHit.boNumber) : "",
        "Order Date": matched ? cellToString(boHit.orderDate) : "",
        "Confirm Flag": matched ? cellToString(boHit.confirm) : "",
        "Cust Group": matched ? cellToString(boHit.custGroup) : "",
        DPR: matched ? cellToString(boHit.dpr) : "",
        "المبلغ المدفوع": matched ? cellToString(boHit.paid) : "",
        "Grade (VC)": matched ? cellToString(boHit.grade) : "",
        "BO Match": matched ? "Matched" : "No BO",
        "RTL Stock matched": retailVins.has(vin) ? "In Stock" : "Not in RTL Stock",
      });
    });

    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────────

  function renderUploadSlots() {
    const grid = $("#upload-grid");
    grid.innerHTML = SLOT_DEFS.map(({ id, n, title, blurb, kicker }) => {
      const slot = slots[id];
      const has = !!slot.file;
      return `
        <article class="upload-card${has ? " has-file" : ""}" data-slot="${id}" tabindex="0">
          <span class="slot-label">File ${n} · ${escapeHtml(kicker)}</span>
          <h3>${escapeHtml(title)}</h3>
          <p class="hint">${escapeHtml(blurb)}. Drop a file here or choose one.</p>
          ${
            has
              ? `<p class="file-name">${escapeHtml(slot.name)} · ${formatBytes(slot.file.size)} · ${detectFileType(slot.file).toUpperCase()}</p>`
              : `<p class="file-name">No file selected</p>`
          }
          <div class="upload-actions">
            <button type="button" class="btn btn-primary" data-choose="${id}">Choose file</button>
            <button type="button" class="btn" data-clear-slot="${id}" ${has ? "" : "disabled"}>Remove</button>
          </div>
          <input type="file" id="file-input-${id}" accept="${ACCEPT}" aria-label="Upload ${escapeHtml(title)}" />
        </article>`;
    }).join("");
  }

  function updateActionButtons() {
    const ready = SLOT_DEFS.every((d) => slots[d.id].file);
    $("#analyze-btn").disabled = !ready;
    $("#clear-btn").disabled = !SLOT_DEFS.some((d) => slots[d.id].file);
    if (ready) setStatus("Ready to match", "ready");
    else if (SLOT_DEFS.some((d) => slots[d.id].file)) setStatus("Waiting for all 3 files");
    else setStatus("Waiting for files");
  }

  function assignFile(id, file) {
    const err = validateFile(file);
    if (err) {
      showError(err);
      return;
    }
    showError("");
    slots[id] = { file, rows: [], name: file.name };
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
  }

  function clearSlot(id) {
    slots[id] = emptySlot();
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
  }

  function bindUploadCardEvents() {
    $$(".upload-card").forEach((card) => {
      const id = card.dataset.slot;
      const input = $(`#file-input-${id}`);

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("is-drag");
      });
      card.addEventListener("dragleave", () => card.classList.remove("is-drag"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("is-drag");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) assignFile(id, file);
      });

      card.querySelector(`[data-choose="${id}"]`).addEventListener("click", () => input.click());
      card.querySelector(`[data-clear-slot="${id}"]`).addEventListener("click", () => clearSlot(id));
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (file) assignFile(id, file);
        input.value = "";
      });
    });
  }

  function statusPill(status) {
    const s = String(status || "");
    let cls = "status-chip";
    if (s === "NO STOCK" || s === "No BO") cls += " is-muted";
    else if (s === "BO > STOCK") cls += " is-warn";
    else if (s === "STOCK > BO") cls += " is-info";
    else if (s === "BALANCED" || s === "Matched" || s === "In Stock") cls += " is-ok";
    else if (s === "Not in RTL Stock") cls += " is-warn";
    return `<span class="${cls}">${escapeHtml(s)}</span>`;
  }

  function getSectionRows(sectionNum) {
    if (sectionNum === 1) return results.allStock;
    if (sectionNum === 2) return results.daily;
    return results.fullControl;
  }

  function getFilteredRows(sectionNum) {
    const state = ui[sectionNum];
    let rows = getSectionRows(sectionNum).slice();
    const q = (state.search || "").trim().toLowerCase();

    if (sectionNum === 2 && state.filter) {
      rows = rows.filter((r) => r["Quantity Status"] === state.filter);
    }
    if (sectionNum === 3) {
      if (state.boFilter) rows = rows.filter((r) => r["BO Match"] === state.boFilter);
      if (state.rtlFilter) rows = rows.filter((r) => r["RTL Stock matched"] === state.rtlFilter);
    }
    if (q) {
      rows = rows.filter((row) =>
        Object.values(row).some((v) => cellToString(v).toLowerCase().includes(q))
      );
    }
    if (state.sortCol) {
      const col = state.sortCol;
      const dir = state.sortDir;
      rows.sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        const an = Number(av);
        const bn = Number(bv);
        if (
          !Number.isNaN(an) &&
          !Number.isNaN(bn) &&
          String(av).trim() !== "" &&
          String(bv).trim() !== ""
        ) {
          return (an - bn) * dir;
        }
        return (
          cellToString(av).localeCompare(cellToString(bv), undefined, {
            sensitivity: "base",
            numeric: true,
          }) * dir
        );
      });
    }
    return rows;
  }

  function renderTable(sectionNum) {
    const wrap = $(`#s${sectionNum}-table-wrap`);
    const foot = $(`#s${sectionNum}-table-foot`);
    const filtered = getFilteredRows(sectionNum);
    const shown = filtered.slice(0, MAX_TABLE_RENDER);
    const state = ui[sectionNum];
    const all = getSectionRows(sectionNum);
    const special =
      sectionNum === 2
        ? ["Quantity Status"]
        : sectionNum === 3
          ? ["BO Match", "RTL Stock matched"]
          : [];

    if (!all.length) {
      wrap.innerHTML = `<div class="empty-state">No rows for this section.</div>`;
      foot.textContent = "";
      return;
    }

    const headers = Object.keys(all[0]);
    const head = headers
      .map((h) => {
        const ind = state.sortCol === h ? (state.sortDir === 1 ? "▲" : "▼") : "";
        return `<th scope="col" tabindex="0" data-sort="${escapeHtml(h)}">${escapeHtml(h)}<span class="sort-ind">${ind}</span></th>`;
      })
      .join("");

    const body = shown
      .map((row) => {
        const cells = headers
          .map((h) => {
            const text = cellToString(row[h]);
            if (special.includes(h)) return `<td>${statusPill(text)}</td>`;
            return `<td class="${text ? "" : "empty-cell"}" title="${escapeHtml(text)}">${text ? escapeHtml(text) : "—"}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    wrap.innerHTML = `
      <table class="data-table" aria-label="Section ${sectionNum} data">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${headers.length}">No rows match the current filters.</td></tr>`}</tbody>
      </table>`;

    foot.textContent =
      filtered.length > MAX_TABLE_RENDER
        ? `Showing ${formatNumber(MAX_TABLE_RENDER)} of ${formatNumber(filtered.length)} filtered rows (${formatNumber(all.length)} total).`
        : `Showing ${formatNumber(filtered.length)} of ${formatNumber(all.length)} rows.`;

    $$("th[data-sort]", wrap).forEach((th) => {
      const activate = () => {
        const col = th.getAttribute("data-sort");
        if (state.sortCol === col) state.sortDir *= -1;
        else {
          state.sortCol = col;
          state.sortDir = 1;
        }
        renderTable(sectionNum);
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });
  }

  function renderKpis(containerId, items) {
    $(containerId).innerHTML = items
      .map(
        (k) => `
      <article class="kpi">
        <p class="label">${escapeHtml(k.label)}</p>
        <p class="value">${escapeHtml(k.value)}</p>
        <p class="sub">${escapeHtml(k.sub || "")}</p>
      </article>`
      )
      .join("");
  }

  function renderSummary() {
    const section = $("#summary");
    section.hidden = false;
    $("#summary-meta").textContent = `${slots.backorder.name} · ${slots.rtl.name} · ${slots.central.name}`;

    const qs = { "NO STOCK": 0, "BO > STOCK": 0, "STOCK > BO": 0, BALANCED: 0 };
    results.daily.forEach((r) => {
      const s = r["Quantity Status"];
      if (s in qs) qs[s] += 1;
    });
    const matched = results.fullControl.filter((r) => r["BO Match"] === "Matched").length;
    const rtlIn = results.fullControl.filter((r) => r["RTL Stock matched"] === "In Stock").length;

    renderKpis("#summary-kpis", [
      { label: "Backorders", value: formatNumber(slots.backorder.rows.length), sub: "first sheet rows" },
      { label: "RTL stock", value: formatNumber(slots.rtl.rows.length), sub: "first sheet rows" },
      { label: "Central stock", value: formatNumber(slots.central.rows.length), sub: "first sheet rows" },
      { label: "All stock matched", value: formatNumber(results.allStock.length), sub: "FIFO VIN links" },
      { label: "Daily balanced", value: formatNumber(qs.BALANCED), sub: "quantity status" },
      { label: "Full control BO", value: `${formatNumber(matched)} / ${formatNumber(results.fullControl.length)}`, sub: "matched VINs" },
      { label: "RTL In Stock", value: formatNumber(rtlIn), sub: "central VINs in retail" },
      {
        label: "Color dictionaries",
        value: `${formatNumber(exteriorMaster.length)} / ${formatNumber(interiorMaster.length)}`,
        sub: "exterior / interior codes",
      },
    ]);
  }

  function renderSection(sectionNum) {
    const section = $(`#section-${sectionNum}`);
    const rows = getSectionRows(sectionNum);
    section.hidden = false;

    if (sectionNum === 1) {
      renderKpis("#s1-kpis", [
        { label: "Matched rows", value: formatNumber(rows.length), sub: "Stock.VIN present" },
        { label: "Unique products", value: formatNumber(new Set(rows.map((r) => r.Product)).size), sub: "in matches" },
        { label: "Unique VINs", value: formatNumber(new Set(rows.map((r) => r["Stock.VIN"])).size), sub: "allocated" },
        { label: "BO source", value: formatNumber(slots.backorder.rows.length), sub: "orders considered" },
      ]);
    } else if (sectionNum === 2) {
      const qs = { "NO STOCK": 0, "BO > STOCK": 0, "STOCK > BO": 0, BALANCED: 0 };
      rows.forEach((r) => {
        const s = r["Quantity Status"];
        if (s in qs) qs[s] += 1;
      });
      renderKpis("#s2-kpis", [
        { label: "BO rows", value: formatNumber(rows.length), sub: "daily output" },
        { label: "BALANCED", value: formatNumber(qs.BALANCED), sub: "equal counts" },
        { label: "BO > STOCK", value: formatNumber(qs["BO > STOCK"]), sub: "shortage" },
        { label: "NO STOCK", value: formatNumber(qs["NO STOCK"]), sub: "no retail match pool" },
      ]);
    } else {
      const matched = rows.filter((r) => r["BO Match"] === "Matched").length;
      const rtl = rows.filter((r) => r["RTL Stock matched"] === "In Stock").length;
      renderKpis("#s3-kpis", [
        { label: "Unique VINs", value: formatNumber(rows.length), sub: "central stock" },
        { label: "BO Matched", value: formatNumber(matched), sub: "spec join hit" },
        { label: "No BO", value: formatNumber(rows.length - matched), sub: "unmatched" },
        { label: "In RTL Stock", value: formatNumber(rtl), sub: "VIN present in retail" },
      ]);
    }

    renderTable(sectionNum);
  }

  function downloadCsv(rows, filename) {
    if (!rows.length || typeof XLSX === "undefined") return;
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function analyzeAll() {
    if (typeof XLSX === "undefined") {
      showError("SheetJS failed to load. Check your network connection and reload.");
      return;
    }
    if (typeof MasterExcel === "undefined") {
      showError("master-excel.js failed to load. Open via HTTP (not file://) from the project root.");
      return;
    }

    showError("");
    setLoading(true, "Loading color dictionaries…");
    $("#analyze-btn").disabled = true;

    try {
      colors = new MasterExcel.MasterExcelColors();
      buildMastersFromColors();

      for (const d of SLOT_DEFS) {
        setLoading(true, `Reading ${d.title}: ${slots[d.id].name}…`);
        await new Promise((r) => setTimeout(r, 15));
        const wb = await readFileToWorkbook(slots[d.id].file);
        const rows = firstSheetRows(wb);
        if (!rows.length) throw new Error(`${d.title} (“${slots[d.id].name}”) first sheet has no data rows.`);
        slots[d.id].rows = rows;
      }

      setLoading(true, "Running All stock matched…");
      await new Promise((r) => setTimeout(r, 10));
      results.allStock = runAllStockMatched(slots.backorder.rows, slots.central.rows);

      setLoading(true, "Running Daily stock matched…");
      await new Promise((r) => setTimeout(r, 10));
      results.daily = runDailyStockMatched(slots.backorder.rows, slots.rtl.rows);

      setLoading(true, "Running Full control…");
      await new Promise((r) => setTimeout(r, 10));
      results.fullControl = runFullControl(slots.backorder.rows, slots.rtl.rows, slots.central.rows);

      [1, 2, 3].forEach((n) => {
        ui[n].search = "";
        ui[n].sortCol = null;
        ui[n].sortDir = 1;
        $(`#s${n}-search`).value = "";
      });
      ui[2].filter = "";
      ui[3].boFilter = "";
      ui[3].rtlFilter = "";
      $("#s2-filter").value = "";
      $("#s3-bo-filter").value = "";
      $("#s3-rtl-filter").value = "";

      renderSummary();
      renderSection(1);
      renderSection(2);
      renderSection(3);

      setStatus("Matching complete", "ready");
      $("#page-sub").textContent = `${slots.backorder.name} · ${slots.rtl.name} · ${slots.central.name}`;
      document.getElementById("section-1").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error(err);
      showError(err.message || String(err));
      setStatus("Error", "error");
    } finally {
      setLoading(false);
      updateActionButtons();
    }
  }

  function clearAll() {
    SLOT_DEFS.forEach((d) => {
      slots[d.id] = emptySlot();
    });
    results.allStock = [];
    results.daily = [];
    results.fullControl = [];
    $("#summary").hidden = true;
    $("#section-1").hidden = true;
    $("#section-2").hidden = true;
    $("#section-3").hidden = true;
    $("#page-sub").textContent =
      "Upload Backorder, RTL Stock, and Central Stock to run the three match processes";
    showError("");
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
    setStatus("Waiting for files");
  }

  function bindGlobal() {
    $("#analyze-btn").addEventListener("click", analyzeAll);
    $("#clear-btn").addEventListener("click", clearAll);

    const debounce = (fn, ms) => {
      let t;
      return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
      };
    };

    $("#s1-search").addEventListener(
      "input",
      debounce((e) => {
        ui[1].search = e.target.value;
        renderTable(1);
      }, 150)
    );
    $("#s2-search").addEventListener(
      "input",
      debounce((e) => {
        ui[2].search = e.target.value;
        renderTable(2);
      }, 150)
    );
    $("#s2-filter").addEventListener("change", (e) => {
      ui[2].filter = e.target.value;
      renderTable(2);
    });
    $("#s3-search").addEventListener(
      "input",
      debounce((e) => {
        ui[3].search = e.target.value;
        renderTable(3);
      }, 150)
    );
    $("#s3-bo-filter").addEventListener("change", (e) => {
      ui[3].boFilter = e.target.value;
      renderTable(3);
    });
    $("#s3-rtl-filter").addEventListener("change", (e) => {
      ui[3].rtlFilter = e.target.value;
      renderTable(3);
    });

    $("#s1-download").addEventListener("click", () =>
      downloadCsv(getFilteredRows(1), "all_stock_matched.csv")
    );
    $("#s2-download").addEventListener("click", () =>
      downloadCsv(getFilteredRows(2), "daily_stock_matched.csv")
    );
    $("#s3-download").addEventListener("click", () =>
      downloadCsv(getFilteredRows(3), "full_control.csv")
    );

    const links = $$(".nav-link");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = entry.target.id;
          links.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === `#${id}`));
        });
      },
      { rootMargin: "-40% 0px -50% 0px", threshold: 0.01 }
    );
    ["upload", "section-1", "section-2", "section-3"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    const menuBtn = $("#menu-btn");
    const overlay = $("#overlay");
    menuBtn.addEventListener("click", () => {
      const open = document.body.classList.toggle("nav-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      overlay.hidden = !open;
    });
    overlay.addEventListener("click", () => {
      document.body.classList.remove("nav-open");
      menuBtn.setAttribute("aria-expanded", "false");
      overlay.hidden = true;
    });
    links.forEach((l) =>
      l.addEventListener("click", () => {
        document.body.classList.remove("nav-open");
        menuBtn.setAttribute("aria-expanded", "false");
        overlay.hidden = true;
      })
    );
  }

  function init() {
    if (typeof XLSX === "undefined") {
      showError("SheetJS library did not load. Open this page over HTTPS/HTTP (not file://) or check CDN access.");
    }
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
    bindGlobal();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
