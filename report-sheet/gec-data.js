/**
 * GEC data layer · Guest Experience Center.
 * Two independent datasets:
 *   • Leads    — one lead = one unique Transaction No. (Lead Data sheet)
 *   • Visitors — every person entering the center (Date · Promoter · Visit Purpose), lead or not
 * Business rules live in this file only; the dashboard is presentation.
 */
(function (global) {
  // ==================== Official configuration (edit here) ====================

  /** Official GEC promoters · Employee Number (Lead Data column R) → promoter name. No other promoter exists. */
  const PROMOTER_MAP = {
    "50648": "Omar Mahlawi",
    "50649": "Shuruq Alansari",
    "50650": "Fahad Alshahrani",
    "50651": "Haifa Alhasani",
    "50652": "Shahad Almutairi",
  };
  const UNKNOWN_PROMOTER = "Unknown Promoter";

  /** Approved GEC conversion statuses. “Won” is deliberately NOT here. Compared case-insensitively. */
  const CONVERSION_STATUSES = ["Order Created", "Vehicle Assigned", "Pro-Forma", "Delivered", "Sales Order"];

  /** Sales Order values that are NOT an order (e.g. 264 × “NO ORDER” in Sep 2026). */
  const NO_ORDER_VALUES = ["no order", "no orders", "no so", "no sales order", "not ordered", "without order",
    "none", "n/a", "na", "null", "nil", "0", "-", "--", "—"];

  /** Sales Response values that are NOT a response. */
  const NO_RESPONSE_VALUES = ["no response", "n/a", "na", "null", "nil", "-", "--", "—"];

  /**
   * Management-approved figures per period (YYYY-MM). Used ONLY by the developer validation panel to flag
   * calculation differences — the dashboard never displays these numbers.
   */
  const VALIDATION_TARGETS = {
    "2026-09": {
      label: "Management-approved · September 2026",
      total: 738,
      knownPromoter: 690,
      unknownPromoter: 48,
      responded: 401,
      noOrder: 264,
      salesOrders: 144,
      converted: 112,
      conversionRate: 0.152,
    },
  };

  const config = {
    PROMOTER_MAP,
    UNKNOWN_PROMOTER,
    CONVERSION_STATUSES,
    NO_ORDER_VALUES,
    NO_RESPONSE_VALUES,
    VALIDATION_TARGETS,
    /** Lead Data column holding the Employee Number. */
    EMPLOYEE_NUMBER_COLUMN: "R",
    LEAD_SHEET_NAME: "Lead Data",
    modelBlank: "غير محددة",
    unassignedLabel: "(Unassigned)",
    /**
     * Response time / SLA — computed but NOT shown until the timing data is validated.
     * Set SHOW_TIMING = true to surface Avg Response Time and Over SLA again.
     */
    SHOW_TIMING: false,
    SLA_MINUTES: 5,
    headerScanRows: 30,
    maxDailyBuckets: 62,
  };

  // ==================== Central business rules ====================

  const norm = (s) => str(s).toLowerCase().replace(/\s+/g, " ");
  let conversionSet = null;
  let noOrderSet = null;
  let noResponseSet = null;
  function resetRuleCaches() { conversionSet = null; noOrderSet = null; noResponseSet = null; }

  /** THE conversion rule: Status is one of CONVERSION_STATUSES. */
  function isConverted(status) {
    if (!conversionSet) conversionSet = new Set(config.CONVERSION_STATUSES.map(norm));
    return conversionSet.has(norm(status));
  }

  /** Sales Order cell → "order" | "noOrder" (NO ORDER) | "placeholder" | "blank". Only "order" counts. */
  function salesOrderState(v) {
    if (v == null || v === "") return "blank";
    if (typeof v === "number") return Number.isFinite(v) && v !== 0 ? "order" : "placeholder";
    const s = norm(v);
    if (!s) return "blank";
    if (s === "no order") return "noOrder";
    if (!noOrderSet) noOrderSet = new Set(config.NO_ORDER_VALUES.map(norm));
    return noOrderSet.has(s) ? "placeholder" : "order";
  }
  const isActualSalesOrder = (v) => salesOrderState(v) === "order";

  /** Sales Response has a real value. */
  function hasSalesResponse(v) {
    if (v == null) return false;
    if (typeof v === "number") return Number.isFinite(v);
    const s = norm(v);
    if (!s) return false;
    if (!noResponseSet) noResponseSet = new Set(config.NO_RESPONSE_VALUES.map(norm));
    return !noResponseSet.has(s);
  }

  /** Employee Number cell → normalised string key ("" when blank). */
  function employeeKey(v) {
    if (v == null) return "";
    if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v)) : "";
    return str(v).replace(/^'/, "").replace(/\.0+$/, "").replace(/\s+/g, "");
  }

  function promoterFromEmployee(v) {
    const key = employeeKey(v);
    const name = key ? config.PROMOTER_MAP[key] : "";
    return { key, name: name || UNKNOWN_PROMOTER, known: !!name };
  }

  /** Visitor sheet promoter cell (employee number or name) → official promoter. */
  function promoterFromAny(v) {
    const byNumber = promoterFromEmployee(v);
    if (byNumber.known) return byNumber;
    const s = norm(v);
    if (!s) return { key: "", name: UNKNOWN_PROMOTER, known: false };
    const entries = Object.entries(config.PROMOTER_MAP);
    const exact = entries.find(([, name]) => norm(name) === s);
    if (exact) return { key: exact[0], name: exact[1], known: true };
    const first = entries.filter(([, name]) => norm(name).split(" ")[0] === s.split(" ")[0]);
    if (first.length === 1) return { key: first[0][0], name: first[0][1], known: true };
    return { key: "", name: UNKNOWN_PROMOTER, known: false };
  }

  const officialPromoters = () => Object.values(config.PROMOTER_MAP);

  // ==================== Text / date helpers ====================

  function str(v) {
    if (v == null) return "";
    if (v instanceof Date) return isNaN(v) ? "" : v.toISOString();
    return String(v).replace(/[\u200e\u200f]/g, "").trim();
  }

  function normHeader(h) {
    return String(h ?? "")
      .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
      .toLowerCase()
      .replace(/[_\-./\\|:()]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  let date1904 = false;
  const isSerial = (v) => typeof v === "number" && v > 30000 && v < 80000;

  /** Excel serial → local Date with the same wall-clock time as Excel shows (no timezone drift). */
  function serialToDate(n) {
    const serial = date1904 ? n + 1462 : n;
    const u = new Date(Math.round((serial - 25569) * 86400000));
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds(), u.getUTCMilliseconds());
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

  function buildDate(y, mo, d, hh, mi, ss, ap) {
    let h = hh != null ? +hh : 0;
    if (ap) {
      const pm = /pm|م/i.test(ap);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    const dt = new Date(y, mo, d, h, mi != null ? +mi : 0, ss != null ? +ss : 0);
    return isNaN(dt) || dt.getFullYear() < 1990 || dt.getMonth() !== mo ? null : dt;
  }

  function parseAnyDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) || v.getFullYear() < 1990 ? null : v;
    if (typeof v === "number") return isSerial(v) ? serialToDate(v) : null;
    const s = str(v);
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(am|pm|ص|م)?)?/i);
    if (m) return buildDate(+m[1], +m[2] - 1, +m[3], m[4], m[5], m[6], m[7]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?)?/i);
    if (m) {
      const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      let day = +m[1];
      let mon = +m[2];
      if (mon > 12 && day <= 12) [day, mon] = [mon, day];
      return buildDate(y, mon - 1, day, m[4], m[5], m[6], m[7]);
    }
    m = s.match(/^(\d{1,2})[-\s/]([a-z]{3,4})[a-z]*[-\s/,]+(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
    if (m && MONTHS[m[2].toLowerCase()] != null) {
      const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
      return buildDate(y, MONTHS[m[2].toLowerCase()], +m[1], m[4], m[5], m[6], m[7]);
    }
    if (/^\d+(\.\d+)?$/.test(s)) return parseAnyDate(Number(s));
    const t = Date.parse(s);
    return Number.isFinite(t) && new Date(t).getFullYear() >= 1990 ? new Date(t) : null;
  }

  function parseTimeOfDay(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) ? null : ((v.getHours() * 60 + v.getMinutes()) * 60 + v.getSeconds()) * 1000;
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? Math.round((v % 1) * 86400) * 1000 : null;
    const m = str(v).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|ص|م)?/i);
    if (!m) return null;
    let h = +m[1];
    if (m[4]) {
      const pm = /pm|م/i.test(m[4]);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return ((h * 60 + +m[2]) * 60 + (m[3] ? +m[3] : 0)) * 1000;
  }

  const hasTime = (d) => d && (d.getHours() || d.getMinutes() || d.getSeconds());
  const atMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function leadDateOf(createdCell, timeCell) {
    const d = parseAnyDate(createdCell);
    if (!d) return null;
    if (!hasTime(d) && timeCell != null && timeCell !== "") {
      const t = parseTimeOfDay(timeCell);
      if (t != null) return new Date(atMidnight(d).getTime() + t);
    }
    return d;
  }

  function leadSerialOf(createdCell, timeCell) {
    if (!isSerial(createdCell)) return null;
    if (createdCell % 1 === 0 && typeof timeCell === "number" && Number.isFinite(timeCell)) return createdCell + (timeCell % 1);
    return createdCell;
  }

  /** Minutes lead → sales response (timing layer; hidden until validated). */
  function responseMinutesOf(lead, leadSerial, responseCell) {
    if (!lead || responseCell == null || responseCell === "") return null;
    if (leadSerial != null && typeof responseCell === "number" && (isSerial(responseCell) || (responseCell >= 0 && responseCell < 1))) {
      const respSerial = responseCell < 1 ? Math.floor(leadSerial) + responseCell : responseCell;
      const m = (respSerial - leadSerial) * 1440;
      return m >= 0 ? m : null;
    }
    const at = parseAnyDate(responseCell);
    if (!at) return null;
    const m = (at - lead) / 60000;
    return m >= 0 ? m : null;
  }

  function dayKey(d) {
    if (!d) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function parseDayKey(k) {
    const m = String(k || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function colLetter(i) {
    let s = "";
    let n = i + 1;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function colIndex(letter) {
    return String(letter || "").toUpperCase().split("").reduce((s, c) => s * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  }

  // ==================== Header detection ====================

  const LEAD_FIELDS = [
    { key: "txn", label: "Transaction No.", required: true,
      exact: ["transaction no", "transaction number", "transaction #", "transaction id", "transaction", "trx no", "txn no", "trans no"],
      contains: ["transaction no", "transaction number", "transaction id"], not: ["date", "type", "status"] },
    { key: "createdDate", label: "Created Date", required: true,
      exact: ["created date", "creation date", "created on", "create date", "created date time", "created datetime"],
      contains: ["created date", "creation date"] },
    { key: "createdTime", label: "Created Time",
      exact: ["created time", "creation time", "create time"], contains: ["created time", "creation time"] },
    { key: "employeeNumber", label: "Employee Number (promoter)", required: true,
      exact: ["employee number", "employee no", "employee id", "employee code", "emp no", "emp number", "emp id"],
      contains: ["employee number", "employee no", "employee id", "employee code"] },
    { key: "salesOrder", label: "Sales Order", required: true,
      exact: ["sales order", "sales order no", "sales order number", "sales order #", "so no", "so number"],
      contains: ["sales order"], not: ["date", "status", "type", "time"] },
    { key: "salesResponse", label: "Sales Response", required: true,
      exact: ["sales response"], contains: ["sales response"], not: ["rate", "time"] },
    { key: "modifiedDate", label: "Last modified",
      exact: ["modified date", "last modified", "last modified date", "modified on", "updated date", "last updated", "updated on", "last update"],
      contains: ["modified", "last update"] },
    { key: "status", label: "Status", required: true,
      exact: ["status", "lead status", "transaction status"], contains: ["status"], not: ["sla", "order status"] },
    { key: "model", label: "Model",
      exact: ["model", "car model", "vehicle model", "model name"], contains: ["model"], not: ["year", "code", "date"] },
    { key: "source", label: "Source",
      exact: ["source", "lead source", "channel", "source channel", "enquiry source", "inquiry source"], contains: ["source", "channel"] },
    { key: "consultant", label: "Consultant (assigned)",
      exact: ["assigned to", "assigned employee", "assignee", "sales consultant", "sales employee", "salesman", "salesman name",
        "sales person", "salesperson", "sales advisor", "consultant", "consultant name", "owner", "responsible", "responsible employee", "employee name", "employee"],
      contains: ["assigned", "consultant", "salesman", "sales person", "salesperson", "responsible", "owner", "employee name"],
      not: ["date", "time", " number", " no", " id", " code"] },
    { key: "customer", label: "Customer",
      exact: ["customer", "customer name", "client", "client name", "guest name", "name", "full name"],
      contains: ["customer", "client"], not: [" id", "phone", "mobile", "type", "number", " no"] },
    { key: "phone", label: "Mobile",
      exact: ["mobile", "mobile no", "mobile number", "phone", "phone no", "phone number", "contact number"],
      contains: ["mobile", "phone"] },
  ];

  const VISITOR_FIELDS = [
    { key: "date", label: "Date", required: true,
      exact: ["date", "visit date", "day", "visit day", "created date", "التاريخ"], contains: ["visit date", "date"] },
    { key: "promoter", label: "Promoter", required: true,
      exact: ["promoter", "promoter name", "employee number", "employee no", "employee", "host", "hostess", "المروج"],
      contains: ["promoter", "employee"] },
    { key: "purpose", label: "Visit Purpose", required: true,
      exact: ["visit purpose", "purpose", "purpose of visit", "visit type", "visit reason", "reason", "type", "الغرض"],
      contains: ["purpose", "visit type", "reason"] },
    { key: "count", label: "Visitors (count)",
      exact: ["count", "visitors", "visitor count", "number of visitors", "no of visitors", "qty", "quantity", "visits", "total"],
      contains: ["visitor count", "number of visitors"] },
  ];

  const SCORE_WEIGHT = { txn: 6, createdDate: 3, employeeNumber: 3, status: 3, salesResponse: 2, model: 2, salesOrder: 2 };
  const TOTAL_ROW = /^(grand\s*)?total$|^المجموع$|^الإجمالي$/i;

  function matchScore(field, hn) {
    if (!hn) return 0;
    if ((field.exact || []).includes(hn)) return 100;
    const padded = ` ${hn} `;
    // Leading-space tokens (" no", " id") only match whole words.
    if ((field.not || []).some((x) => (x.startsWith(" ") ? padded.includes(`${x} `) : hn.includes(x)))) return 0;
    const hit = (field.contains || []).find((c) => hn.includes(c));
    return hit ? 40 + Math.min(hit.length, 30) : 0;
  }

  function mapHeaders(headers, fields) {
    const norms = headers.map(normHeader);
    const claimed = new Set();
    const map = {};
    fields.forEach((f) => {
      let best = -1;
      let bestScore = 0;
      norms.forEach((hn, i) => {
        if (claimed.has(i)) return;
        const s = matchScore(f, hn);
        if (s > bestScore) { bestScore = s; best = i; }
      });
      if (best >= 0) { map[f.key] = best; claimed.add(best); }
    });
    const keys = Object.keys(map);
    return { map, score: keys.reduce((s, k) => s + (SCORE_WEIGHT[k] || 1), 0), count: keys.length };
  }

  function sheetMatrix(ws, raw) {
    const opts = { header: 1, defval: "", blankrows: true, raw };
    try {
      const range = global.XLSX.utils.decode_range(ws["!ref"] || "A1");
      range.s.c = 0;
      range.s.r = 0;
      opts.range = range;
    } catch { /* keep sheet range */ }
    return global.XLSX.utils.sheet_to_json(ws, opts);
  }

  function findHeader(matrix, fields) {
    let best = { headerIdx: -1, map: {}, score: 0, count: 0 };
    const limit = Math.min(matrix.length, config.headerScanRows);
    for (let i = 0; i < limit; i += 1) {
      const row = matrix[i] || [];
      if (row.filter((c) => str(c)).length < 2) continue;
      const res = mapHeaders(row, fields);
      if (res.score > best.score) best = { headerIdx: i, ...res };
    }
    return best;
  }

  function buildHeaders(matrix, headerIdx) {
    const headerLine = matrix[headerIdx] || [];
    const width = Math.max(headerLine.length, ...matrix.slice(headerIdx + 1, headerIdx + 50).map((r) => r.length));
    const headers = [];
    const seen = {};
    for (let i = 0; i < width; i += 1) {
      let h = str(headerLine[i]) || `Column ${colLetter(i)}`;
      if (seen[h]) { seen[h] += 1; h = `${h} (${seen[h]})`; } else seen[h] = 1;
      headers.push(h);
    }
    return headers;
  }

  // ==================== Parse ====================

  function readWorkbook(buffer, fileName) {
    if (/\.csv$/i.test(String(fileName || ""))) {
      return global.XLSX.read(new TextDecoder("utf-8").decode(buffer), { type: "string", cellDates: false });
    }
    return global.XLSX.read(buffer, { type: "array", cellDates: false });
  }

  /** GEC File (ArrayBuffer) → lead dataset (+ visitors when the workbook has a visitor sheet). */
  function parseBuffer(buffer, opts) {
    return parseWorkbook(readWorkbook(buffer, opts && opts.fileName), opts);
  }

  /** Separate visitor file (ArrayBuffer) → visitor dataset. */
  function parseVisitorsBuffer(buffer, opts) {
    return parseVisitorsWorkbook(readWorkbook(buffer, opts && opts.fileName), opts);
  }

  function emptyQuality() {
    return { sourceRows: 0, uniqueTransactions: 0, duplicateRows: 0, duplicateTransactions: 0, missingTxn: 0,
      knownPromoter: 0, unknownPromoter: 0, blankEmployee: 0, unmappedEmployee: 0, unknownModels: 0, undated: 0,
      noOrder: 0, orderPlaceholders: 0, actualOrders: 0 };
  }

  function emptyDataset(options, sheets, warning) {
    return {
      ok: false, fileName: options.fileName || "", sheetName: "", headerRow: 0, headers: [], colMap: {},
      mapping: LEAD_FIELDS.map((f) => ({ key: f.key, label: f.label, required: !!f.required, column: null, letter: null })),
      records: [], warnings: warning ? [warning] : [], range: { from: "", to: "" }, sheets: sheets || [],
      quality: emptyQuality(), hasConsultant: false, visitors: null,
    };
  }

  function pickLeadSheet(workbook) {
    const names = (workbook && workbook.SheetNames) || [];
    const analysed = names.filter((n) => workbook.Sheets[n]).map((name) => {
      const ws = workbook.Sheets[name];
      const matrix = sheetMatrix(ws, true);
      const best = findHeader(matrix, LEAD_FIELDS);
      let score = best.score;
      if (best.map.txn == null) score -= 10;
      if (normHeader(name) === normHeader(config.LEAD_SHEET_NAME)) score += 8;
      else if (/lead|raw|data|transaction/i.test(name)) score += 2;
      if (/dashboard|summary|pivot|chart|report|kpi|visit/i.test(name)) score -= 4;
      return { name, ws, matrix, ...best, sheetScore: score };
    });
    return { analysed, best: analysed.slice().sort((a, b) => b.sheetScore - a.sheetScore)[0] };
  }

  /** Employee Number = column R when its header (or content) is the employee number; header match otherwise. */
  function resolveEmployeeColumn(colMap, headers, matrix, headerIdx, warnings) {
    const r = colIndex(config.EMPLOYEE_NUMBER_COLUMN);
    const field = LEAD_FIELDS.find((f) => f.key === "employeeNumber");
    const rHeaderOk = r < headers.length && matchScore(field, normHeader(headers[r])) > 0;
    const rHasNumbers = matrix.slice(headerIdx + 1, headerIdx + 200)
      .some((line) => config.PROMOTER_MAP[employeeKey(line[r])]);
    if (rHeaderOk || rHasNumbers) {
      if (colMap.employeeNumber !== r) {
        Object.keys(colMap).forEach((k) => { if (colMap[k] === r) delete colMap[k]; });
        colMap.employeeNumber = r;
      }
      if (!rHeaderOk) warnings.push(`Column ${config.EMPLOYEE_NUMBER_COLUMN} header is “${headers[r]}” — used as Employee Number because it contains promoter employee numbers.`);
    } else if (colMap.employeeNumber != null) {
      warnings.push(`Employee Number found in column ${colLetter(colMap.employeeNumber)} (“${headers[colMap.employeeNumber]}”), not column ${config.EMPLOYEE_NUMBER_COLUMN}.`);
    } else if (r < headers.length) {
      colMap.employeeNumber = r;
      warnings.push(`No “Employee Number” header — using column ${config.EMPLOYEE_NUMBER_COLUMN} (“${headers[r]}”).`);
    }
  }

  /**
   * Workbook → lead dataset. One record per unique Transaction No. (latest row = current information).
   */
  function parseWorkbook(workbook, opts) {
    const options = opts || {};
    date1904 = !!(workbook && workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904);
    resetRuleCaches();
    const { analysed, best } = pickLeadSheet(workbook);
    const sheets = analysed.map((a) => ({ name: a.name, rows: a.matrix.length, fields: a.count }));
    const visitors = findVisitorSheet(workbook, best && best.name, options);
    if (!best || best.headerIdx < 0 || best.map.txn == null) {
      const ds = emptyDataset(options, sheets,
        "No lead table found — expected a “Lead Data” sheet with “Transaction No.”, “Created Date”, “Status”, “Sales Response”, “Sales Order” and Employee Number in column R.");
      ds.visitors = visitors;
      return ds;
    }

    const matrix = best.matrix;
    const text = sheetMatrix(best.ws, false);
    const headers = buildHeaders(matrix, best.headerIdx);
    const colMap = { ...best.map };
    const warnings = [];
    resolveEmployeeColumn(colMap, headers, matrix, best.headerIdx, warnings);
    LEAD_FIELDS.filter((f) => f.required && colMap[f.key] == null)
      .forEach((f) => warnings.push(`Column “${f.label}” not found — related KPIs will read as zero.`));
    if (colMap.consultant == null) warnings.push("No consultant column found (e.g. “Assigned To”) — Consultant Performance and Unassigned are unavailable.");

    const cell = (line, key) => (colMap[key] != null ? line[colMap[key]] : "");
    const quality = emptyQuality();
    const groups = new Map();

    for (let r = best.headerIdx + 1; r < matrix.length; r += 1) {
      const line = matrix[r] || [];
      if (!line.some((v) => str(v) !== "")) continue;
      if (TOTAL_ROW.test(str(line.find((v) => str(v)) || ""))) continue;
      quality.sourceRows += 1;
      const txnRaw = cell(line, "txn");
      const key = typeof txnRaw === "number" ? (Number.isFinite(txnRaw) ? String(txnRaw) : "") : str(txnRaw).replace(/^'/, "");
      if (!key) { quality.missingTxn += 1; continue; }
      const modified = colMap.modifiedDate != null ? parseAnyDate(cell(line, "modifiedDate")) : null;
      const entry = { r, line, modified };
      const g = groups.get(key);
      if (!g) groups.set(key, { key, rows: [entry] });
      else g.rows.push(entry);
    }

    const records = [];
    groups.forEach((g) => {
      let latest = g.rows[g.rows.length - 1];
      if (colMap.modifiedDate != null) {
        g.rows.forEach((e) => { if (e.modified && (!latest.modified || e.modified >= latest.modified)) latest = e; });
      }
      const line = latest.line;
      let leadDate = leadDateOf(cell(line, "createdDate"), cell(line, "createdTime"));
      if (!leadDate) {
        const dated = g.rows.map((e) => leadDateOf(cell(e.line, "createdDate"), cell(e.line, "createdTime"))).filter(Boolean);
        leadDate = dated.length ? dated.sort((a, b) => a - b)[0] : null;
      }
      const textLine = text[latest.r] || [];
      const shown = (key) => {
        const rawV = cell(line, key);
        const t = str(colMap[key] != null && textLine[colMap[key]] !== "" && textLine[colMap[key]] != null ? textLine[colMap[key]] : rawV);
        if (isSerial(rawV) && /^\d+(\.\d+)?$/.test(t)) {
          const d = serialToDate(rawV);
          const p = (x) => String(x).padStart(2, "0");
          return `${dayKey(d)}${hasTime(d) ? ` ${p(d.getHours())}:${p(d.getMinutes())}` : ""}`;
        }
        return t;
      };
      const promoter = promoterFromEmployee(cell(line, "employeeNumber"));
      const status = str(cell(line, "status"));
      const soCell = cell(line, "salesOrder");
      const soState = salesOrderState(soCell);
      const respCell = cell(line, "salesResponse");
      const consultant = str(cell(line, "consultant"));
      const raw = {};
      headers.forEach((h, i) => {
        const t = textLine[i] != null && textLine[i] !== "" ? textLine[i] : line[i];
        if (t === "" || t == null) return;
        raw[h] = t;
      });
      records.push({
        id: g.key,
        rowNo: latest.r + 1,
        rowCount: g.rows.length,
        leadDate,
        day: dayKey(leadDate),
        employeeNumber: promoter.key,
        promoter: promoter.name,
        promoterKnown: promoter.known,
        status,
        statusLabel: status || "(blank)",
        converted: isConverted(status) ? 1 : 0,
        salesResponse: shown("salesResponse"),
        responded: hasSalesResponse(respCell) ? 1 : 0,
        salesOrder: shown("salesOrder"),
        salesOrderState: soState,
        hasSalesOrder: soState === "order" ? 1 : 0,
        model: str(cell(line, "model")),
        modelGroup: str(cell(line, "model")) || config.modelBlank,
        source: str(cell(line, "source")) || "(blank)",
        consultant,
        consultantLabel: consultant || config.unassignedLabel,
        unassigned: colMap.consultant != null && !consultant,
        customer: shown("customer"),
        phone: shown("phone"),
        responseMinutes: responseMinutesOf(leadDate, leadSerialOf(cell(line, "createdDate"), cell(line, "createdTime")), respCell),
        raw,
      });
    });

    const dupGroups = [...groups.values()].filter((g) => g.rows.length > 1);
    quality.uniqueTransactions = records.length;
    quality.duplicateRows = dupGroups.reduce((s, g) => s + g.rows.length - 1, 0);
    quality.duplicateTransactions = dupGroups.length;
    records.forEach((x) => {
      if (x.promoterKnown) quality.knownPromoter += 1;
      else {
        quality.unknownPromoter += 1;
        if (x.employeeNumber) quality.unmappedEmployee += 1; else quality.blankEmployee += 1;
      }
      if (!x.model) quality.unknownModels += 1;
      if (!x.leadDate) quality.undated += 1;
      if (x.salesOrderState === "noOrder") quality.noOrder += 1;
      else if (x.salesOrderState === "placeholder") quality.orderPlaceholders += 1;
      else if (x.salesOrderState === "order") quality.actualOrders += 1;
    });
    if (quality.knownPromoter + quality.unknownPromoter !== records.length) warnings.push("Promoter mapping does not add up to total leads.");
    if (quality.undated) warnings.push(`${quality.undated} transaction(s) have no readable Created Date — counted in totals, not in daily views.`);

    const days = records.map((x) => x.day).filter(Boolean).sort();
    return {
      ok: records.length > 0,
      fileName: options.fileName || "",
      sheetName: best.name,
      headerRow: best.headerIdx + 1,
      headers,
      colMap,
      mapping: LEAD_FIELDS.map((f) => ({
        key: f.key, label: f.label, required: !!f.required,
        column: colMap[f.key] != null ? headers[colMap[f.key]] : null,
        letter: colMap[f.key] != null ? colLetter(colMap[f.key]) : null,
      })),
      records,
      quality,
      warnings,
      hasConsultant: colMap.consultant != null,
      range: { from: days[0] || "", to: days[days.length - 1] || "" },
      sheets,
      visitors,
      _source: { matrix, headerIdx: best.headerIdx, colMap },
    };
  }

  // ==================== Visitors (independent dataset) ====================

  function parseVisitorSheet(name, ws, options) {
    const matrix = sheetMatrix(ws, true);
    const best = findHeader(matrix, VISITOR_FIELDS);
    if (best.headerIdx < 0 || best.map.date == null || (best.map.promoter == null && best.map.purpose == null)) return null;
    const headers = buildHeaders(matrix, best.headerIdx);
    const colMap = best.map;
    const records = [];
    const warnings = [];
    let undated = 0;
    for (let r = best.headerIdx + 1; r < matrix.length; r += 1) {
      const line = matrix[r] || [];
      if (!line.some((v) => str(v) !== "")) continue;
      if (TOTAL_ROW.test(str(line.find((v) => str(v)) || ""))) continue;
      const date = parseAnyDate(line[colMap.date]);
      if (!date) undated += 1;
      const p = promoterFromAny(colMap.promoter != null ? line[colMap.promoter] : "");
      let count = 1;
      if (colMap.count != null) {
        const c = Number(line[colMap.count]);
        count = Number.isFinite(c) && c >= 0 ? c : 0;
      }
      if (!count) continue;
      records.push({
        rowNo: r + 1,
        date,
        day: dayKey(date),
        promoter: p.name,
        promoterKnown: p.known,
        purpose: str(colMap.purpose != null ? line[colMap.purpose] : "") || "(blank)",
        count,
      });
    }
    if (undated) warnings.push(`${undated} visitor row(s) without a readable date.`);
    return {
      ok: records.length > 0,
      fileName: options.fileName || "",
      sheetName: name,
      headerRow: best.headerIdx + 1,
      mapping: VISITOR_FIELDS.map((f) => ({ key: f.key, label: f.label, column: colMap[f.key] != null ? headers[colMap[f.key]] : null, letter: colMap[f.key] != null ? colLetter(colMap[f.key]) : null })),
      records,
      total: records.reduce((s, v) => s + v.count, 0),
      warnings,
    };
  }

  /** Visitor sheet inside the GEC workbook (name mentions visit/visitor/footfall). */
  function findVisitorSheet(workbook, leadSheet, options) {
    const names = ((workbook && workbook.SheetNames) || []).filter((n) => n !== leadSheet && /visit|footfall|traffic|زوار|زيارة/i.test(n));
    for (const n of names) {
      const v = parseVisitorSheet(n, workbook.Sheets[n], options || {});
      if (v && v.ok) return v;
    }
    return null;
  }

  function parseVisitorsWorkbook(workbook, opts) {
    const options = opts || {};
    date1904 = !!(workbook && workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904);
    const names = (workbook && workbook.SheetNames) || [];
    const ordered = names.slice().sort((a, b) => (/visit/i.test(b) ? 1 : 0) - (/visit/i.test(a) ? 1 : 0));
    for (const n of ordered) {
      const v = parseVisitorSheet(n, workbook.Sheets[n], options);
      if (v && v.ok) return v;
    }
    return { ok: false, fileName: options.fileName || "", records: [], total: 0,
      warnings: ["No visitor table found — expected columns Date, Promoter, Visit Purpose (optional Count)."] };
  }

  // ==================== Metrics ====================

  function applyFilters(records, f) {
    const filters = f || {};
    return records.filter((r) => {
      if (filters.from && (!r.day || r.day < filters.from)) return false;
      if (filters.to && (!r.day || r.day > filters.to)) return false;
      if (filters.promoter && r.promoter !== filters.promoter) return false;
      if (filters.model && r.modelGroup !== filters.model) return false;
      if (filters.source && r.source !== filters.source) return false;
      if (filters.status && r.statusLabel !== filters.status) return false;
      if (filters.consultant && r.consultantLabel !== filters.consultant) return false;
      return true;
    });
  }

  /** Visitors only carry date + promoter, so only those filters apply. */
  function applyVisitorFilters(visitors, f) {
    const filters = f || {};
    return visitors.filter((v) => {
      if (filters.from && (!v.day || v.day < filters.from)) return false;
      if (filters.to && (!v.day || v.day > filters.to)) return false;
      if (filters.promoter && v.promoter !== filters.promoter) return false;
      return true;
    });
  }

  const ratio = (a, b) => (b ? a / b : null);
  const sumBy = (list, fn) => list.reduce((s, x) => s + fn(x), 0);

  function promoterTable(rows, visitorRows, hasVisitors) {
    return officialPromoters().map((name) => {
      const leads = rows.filter((r) => r.promoter === name);
      const visitors = hasVisitors ? sumBy(visitorRows.filter((v) => v.promoter === name), (v) => v.count) : null;
      const converted = sumBy(leads, (r) => r.converted);
      return {
        name,
        visitors,
        leads: leads.length,
        responded: sumBy(leads, (r) => r.responded),
        salesOrders: sumBy(leads, (r) => r.hasSalesOrder),
        converted,
        visitorToLead: hasVisitors ? ratio(leads.length, visitors) : null,
        leadToConversion: ratio(converted, leads.length),
      };
    }).sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  }

  function consultantTable(rows) {
    const map = new Map();
    rows.forEach((r) => {
      if (!r.consultant) return;
      const e = map.get(r.consultant) || { name: r.consultant, leads: 0, responded: 0, salesOrders: 0, converted: 0 };
      e.leads += 1;
      e.responded += r.responded;
      e.salesOrders += r.hasSalesOrder;
      e.converted += r.converted;
      map.set(r.consultant, e);
    });
    return [...map.values()]
      .map((e) => ({ ...e, responseRate: ratio(e.responded, e.leads), conversionRate: ratio(e.converted, e.leads) }))
      .sort((a, b) => b.leads - a.leads || b.converted - a.converted || a.name.localeCompare(b.name));
  }

  function groupModels(rows) {
    const map = new Map();
    rows.forEach((r) => {
      const e = map.get(r.modelGroup) || { name: r.modelGroup, leads: 0, responded: 0, salesOrders: 0, converted: 0 };
      e.leads += 1;
      e.responded += r.responded;
      e.salesOrders += r.hasSalesOrder;
      e.converted += r.converted;
      map.set(r.modelGroup, e);
    });
    return [...map.values()].map((e) => ({ ...e, conversionRate: ratio(e.converted, e.leads) }))
      .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  }

  /** Day (or week) buckets between from..to. */
  function buckets(from, to) {
    const start = parseDayKey(from);
    const end = parseDayKey(to);
    if (!start || !end || end < start) return { unit: "day", list: [], index: new Map() };
    const spanDays = Math.round((end - start) / 86400000) + 1;
    const unit = spanDays > config.maxDailyBuckets ? "week" : "day";
    const list = [];
    const index = new Map();
    const cur = new Date(start);
    if (unit === "week") cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
    while (cur <= end) {
      const b = { key: dayKey(cur), days: [] };
      list.push(b);
      const step = unit === "week" ? 7 : 1;
      for (let i = 0; i < step; i += 1) {
        const d = new Date(cur);
        d.setDate(d.getDate() + i);
        index.set(dayKey(d), b);
        b.days.push(dayKey(d));
      }
      cur.setDate(cur.getDate() + step);
    }
    return { unit, list, index };
  }

  function buildTrend(rows, visitorRows, hasVisitors, from, to) {
    const bk = buckets(from, to);
    const list = bk.list.map((b) => ({ ...b, visitors: hasVisitors ? 0 : null, leads: 0, responded: 0, salesOrders: 0, converted: 0 }));
    const byKey = new Map(list.map((b) => [b.key, b]));
    const find = (day) => { const b = bk.index.get(day); return b ? byKey.get(b.key) : null; };
    rows.forEach((r) => {
      const b = find(r.day);
      if (!b) return;
      b.leads += 1;
      b.responded += r.responded;
      b.salesOrders += r.hasSalesOrder;
      b.converted += r.converted;
    });
    if (hasVisitors) visitorRows.forEach((v) => { const b = find(v.day); if (b) b.visitors += v.count; });
    return { unit: bk.unit, buckets: list, undated: rows.filter((r) => !r.day).length };
  }

  /**
   * Daily matrix for promoter / consultant performance.
   * @param kind "promoter" | "consultant"; metric: visitors | leads | responded | salesOrders | converted
   */
  function dailyMatrix(metrics, kind, metric) {
    const bk = buckets(metrics.range.from, metrics.range.to);
    const names = kind === "promoter" ? metrics.promoters.map((p) => p.name) : metrics.consultants.map((c) => c.name);
    const key = kind === "promoter" ? "promoter" : "consultant";
    const cells = new Map(names.map((nm) => [nm, bk.list.map(() => 0)]));
    const pos = new Map(bk.list.map((b, i) => [b.key, i]));
    const slot = (day) => { const b = bk.index.get(day); return b ? pos.get(b.key) : undefined; };
    if (metric === "visitors") {
      if (kind === "promoter" && metrics.hasVisitors) {
        metrics.visitorRows.forEach((v) => { const i = slot(v.day); const row = cells.get(v.promoter); if (row && i != null) row[i] += v.count; });
      }
    } else {
      metrics.rows.forEach((r) => {
        const row = cells.get(r[key]);
        const i = slot(r.day);
        if (!row || i == null) return;
        row[i] += metric === "leads" ? 1 : r[metric];
      });
    }
    return { unit: bk.unit, buckets: bk.list, rows: names.map((nm) => ({ name: nm, values: cells.get(nm), total: cells.get(nm).reduce((s, x) => s + x, 0) })) };
  }

  /**
   * @param dataset lead dataset (parseWorkbook); visitors come from opts.visitors or dataset.visitors
   * @param filters { from, to, promoter, model, source, status, consultant }
   * @param opts { visitors, slaMinutes }
   */
  function compute(dataset, filters, opts) {
    const options = opts || {};
    const all = (dataset && dataset.records) || [];
    const f = filters || {};
    const vds = options.visitors !== undefined ? options.visitors : (dataset && dataset.visitors) || null;
    const hasVisitors = !!(vds && vds.ok);
    /** Visitors have no model/source/status/consultant — a Visitor→Lead rate under those filters would compare different populations. */
    const leadOnlyFilter = !!(f.model || f.source || f.status || f.consultant);
    const rows = applyFilters(all, f);
    const visitorRows = hasVisitors ? applyVisitorFilters(vds.records, f) : [];
    const total = rows.length;
    const converted = sumBy(rows, (r) => r.converted);
    const responded = sumBy(rows, (r) => r.responded);
    const salesOrders = sumBy(rows, (r) => r.hasSalesOrder);
    const knownPromoter = sumBy(rows, (r) => (r.promoterKnown ? 1 : 0));
    const visitors = hasVisitors ? sumBy(visitorRows, (v) => v.count) : null;
    const sla = Number(options.slaMinutes) > 0 ? Number(options.slaMinutes) : config.SLA_MINUTES;
    const timed = rows.filter((r) => r.responseMinutes != null);
    const from = f.from || (dataset && dataset.range.from) || "";
    const to = f.to || (dataset && dataset.range.to) || "";
    const promoters = promoterTable(rows, visitorRows, hasVisitors);
    if (leadOnlyFilter) promoters.forEach((p) => { p.visitorToLead = null; });
    return {
      rows,
      visitorRows,
      hasVisitors,
      leadOnlyFilter,
      hasConsultant: !!(dataset && dataset.hasConsultant),
      totalAll: all.length,
      kpis: {
        visitors,
        total,
        visitorToLead: hasVisitors && !leadOnlyFilter ? ratio(total, visitors) : null,
        responded,
        responseRate: ratio(responded, total),
        salesOrders,
        salesOrderRate: ratio(salesOrders, total),
        noOrder: sumBy(rows, (r) => (r.salesOrderState === "noOrder" ? 1 : 0)),
        converted,
        conversionRate: ratio(converted, total),
        knownPromoter,
        unknownPromoter: total - knownPromoter,
        unassigned: dataset && dataset.hasConsultant ? sumBy(rows, (r) => (r.unassigned ? 1 : 0)) : null,
        noResponse: total - responded,
      },
      /** Timing layer — not displayed while config.SHOW_TIMING is false. */
      timing: {
        slaMinutes: sla,
        timedCount: timed.length,
        avgResponseMinutes: timed.length ? sumBy(timed, (r) => r.responseMinutes) / timed.length : null,
        overSla: timed.filter((r) => r.responseMinutes > sla).length,
      },
      funnel: [
        { key: "total", label: "Total Leads", count: total },
        { key: "responded", label: "Sales Response", count: responded },
        { key: "salesOrders", label: "Sales Orders", count: salesOrders },
        { key: "converted", label: "Converted", count: converted },
      ].map((s) => ({ ...s, pctOfLeads: ratio(s.count, total) })),
      trend: buildTrend(rows, visitorRows, hasVisitors, from, to),
      promoters,
      consultants: consultantTable(rows),
      models: groupModels(rows),
      range: { from, to },
    };
  }

  function optionList(records, key) {
    const counts = new Map();
    records.forEach((r) => { const v = r[key]; if (v) counts.set(v, (counts.get(v) || 0) + 1); });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([v]) => v);
  }

  function filterOptions(dataset) {
    const all = (dataset && dataset.records) || [];
    const hasUnknown = all.some((r) => !r.promoterKnown);
    return {
      promoters: [...officialPromoters(), ...(hasUnknown ? [UNKNOWN_PROMOTER] : [])],
      models: optionList(all, "modelGroup"),
      sources: optionList(all, "source"),
      statuses: optionList(all, "statusLabel"),
      consultants: dataset && dataset.hasConsultant ? optionList(all, "consultantLabel") : [],
    };
  }

  /** Drill-down predicates (lead records). */
  const PREDICATES = {
    total: () => true,
    responded: (r) => r.responded === 1,
    responseRate: (r) => r.responded === 1,
    salesOrders: (r) => r.hasSalesOrder === 1,
    salesOrderRate: (r) => r.hasSalesOrder === 1,
    noOrder: (r) => r.salesOrderState === "noOrder",
    converted: (r) => r.converted === 1,
    conversionRate: (r) => r.converted === 1,
    knownPromoter: (r) => r.promoterKnown,
    unknownPromoter: (r) => !r.promoterKnown,
    unassigned: (r) => r.unassigned,
    noResponse: (r) => r.responded === 0,
  };

  // ==================== Validation (developer) ====================

  function signature(records) {
    let h = 0;
    records.forEach((r) => {
      const s = `${r.id}|${r.converted}|${r.responded}|${r.hasSalesOrder}|${r.promoter}|${r.modelGroup}|${r.day}`;
      for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
    });
    return `${records.length}:${h}`;
  }

  function countValues(records, fn) {
    const map = new Map();
    records.forEach((r) => { const k = fn(r); map.set(k, (map.get(k) || 0) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  /**
   * Developer validation: management targets, promoter mapping check, value breakdowns and
   * reconciliation of every total against an independent pass over the raw sheet cells.
   */
  function validate(dataset, filters, opts) {
    const out = { targets: null, promoterCheck: null, breakdowns: null, checks: [], totals: null };
    if (!dataset || !dataset.ok || !dataset._source) return out;
    const add = (name, expected, actual, detail) => out.checks.push({ name, pass: expected === actual, expected, actual, detail: detail || "" });

    const sigBefore = signature(dataset.records);
    const full = compute(dataset, {}, opts);
    const m = compute(dataset, filters, opts);
    const sigAfter = signature(dataset.records);
    const k = full.kpis;

    // 1 · Management targets (whole file, no filters)
    const period = (dataset.range.from || "").slice(0, 7);
    const t = config.VALIDATION_TARGETS[period];
    const rate1 = (v) => (v == null ? null : Math.round(v * 1000) / 10);
    if (t) {
      const rows = [
        ["Total Leads", t.total, k.total],
        ["Known Promoter", t.knownPromoter, k.knownPromoter],
        ["Unknown Promoter", t.unknownPromoter, k.unknownPromoter],
        ["Sales Response", t.responded, k.responded],
        ["NO ORDER", t.noOrder, k.noOrder],
        ["Actual Orders", t.salesOrders, k.salesOrders],
        ["Converted", t.converted, k.converted],
        ["Conversion Rate %", rate1(t.conversionRate), rate1(k.conversionRate)],
      ].map(([label, expected, actual]) => ({ label, expected, actual, pass: expected === actual }));
      out.targets = { period, label: t.label, rows, passed: rows.filter((x) => x.pass).length };
    } else out.targets = { period, label: `No approved targets configured for ${period || "this file"}`, rows: [], passed: 0 };

    // 2 · Promoter mapping check (calculated, never hard-coded)
    const pc = officialPromoters().map((name) => ({ name, count: dataset.records.filter((r) => r.promoter === name).length }));
    pc.push({ name: UNKNOWN_PROMOTER, count: dataset.records.filter((r) => !r.promoterKnown).length });
    const pcTotal = pc.reduce((s, x) => s + x.count, 0);
    out.promoterCheck = { rows: pc, total: pcTotal, leads: dataset.records.length, ok: pcTotal === dataset.records.length,
      expectedTotal: t ? t.total : null, column: dataset.colMap.employeeNumber != null ? colLetter(dataset.colMap.employeeNumber) : "—" };

    // 3 · Value breakdowns (what the rules saw)
    out.breakdowns = {
      status: countValues(dataset.records, (r) => r.statusLabel).map(([v, c]) => ({ value: v, count: c, converted: isConverted(v) })),
      salesOrder: countValues(dataset.records, (r) => r.salesOrderState).map(([v, c]) => ({ value: v, count: c })),
      salesOrderPlaceholders: countValues(dataset.records.filter((r) => r.salesOrderState === "placeholder" || r.salesOrderState === "noOrder"), (r) => r.salesOrder).map(([v, c]) => ({ value: v, count: c })),
      responseValues: countValues(dataset.records, (r) => (r.responded ? "(has response)" : (r.salesResponse ? `“${r.salesResponse}” → not a response` : "(blank)"))).map(([v, c]) => ({ value: v, count: c })),
      employees: countValues(dataset.records.filter((r) => !r.promoterKnown), (r) => r.employeeNumber || "(blank)").map(([v, c]) => ({ value: v, count: c })),
    };

    // 4 · Independent recomputation from raw cells
    const { matrix, headerIdx, colMap } = dataset._source;
    const at = (line, key) => (colMap[key] != null ? line[colMap[key]] : "");
    const latest = new Map();
    let rows = 0;
    let missing = 0;
    for (let r = headerIdx + 1; r < matrix.length; r += 1) {
      const line = matrix[r] || [];
      if (!line.some((v) => String(v ?? "").trim() !== "")) continue;
      if (TOTAL_ROW.test(String(line.find((v) => String(v ?? "").trim()) ?? "").trim())) continue;
      rows += 1;
      const raw = at(line, "txn");
      const key = typeof raw === "number" ? String(raw) : String(raw ?? "").trim().replace(/^'/, "");
      if (!key) { missing += 1; continue; }
      if (colMap.modifiedDate == null) latest.set(key, line);
      else {
        const prev = latest.get(key);
        const dm = parseAnyDate(at(line, "modifiedDate"));
        const dp = prev ? parseAnyDate(at(prev, "modifiedDate")) : null;
        if (!prev || (dm && (!dp || dm >= dp))) latest.set(key, line);
      }
    }
    let conv = 0; let resp = 0; let orders = 0; let noOrd = 0; let known = 0;
    latest.forEach((line) => {
      if (isConverted(at(line, "status"))) conv += 1;
      if (hasSalesResponse(at(line, "salesResponse"))) resp += 1;
      const so = salesOrderState(at(line, "salesOrder"));
      if (so === "order") orders += 1;
      if (so === "noOrder") noOrd += 1;
      if (config.PROMOTER_MAP[employeeKey(at(line, "employeeNumber"))]) known += 1;
    });
    add("Source rows read", rows, dataset.quality.sourceRows);
    add("Total leads = unique Transaction No.", latest.size, k.total, "No filters");
    add("Known + Unknown promoter = Total leads", k.total, k.knownPromoter + k.unknownPromoter);
    add("Known promoter leads (column " + out.promoterCheck.column + ")", known, k.knownPromoter);
    add("Sales Response (field not empty)", resp, k.responded);
    add("Actual Sales Orders (NO ORDER excluded)", orders, k.salesOrders);
    add("NO ORDER rows (unique)", noOrd, k.noOrder);
    add("Converted = isConverted(Status)", conv, k.converted, config.CONVERSION_STATUSES.join(" · "));
    add("Missing Transaction No. rows", missing, dataset.quality.missingTxn);
    add("Duplicate rows = rows − unique − missing", rows - latest.size - missing, dataset.quality.duplicateRows);
    add("No transaction counted twice", dataset.records.length, new Set(dataset.records.map((r) => r.id)).size);
    const tr = m.trend;
    const undatedRows = m.rows.filter((r) => !r.day);
    const sumB = (key) => tr.buckets.reduce((s, b) => s + b[key], 0) + sumBy(undatedRows, (r) => (key === "leads" ? 1 : r[key]));
    add("Daily leads reconcile (filtered)", m.kpis.total, sumB("leads"));
    add("Daily responses reconcile", m.kpis.responded, sumB("responded"));
    add("Daily sales orders reconcile", m.kpis.salesOrders, sumB("salesOrders"));
    add("Daily converted reconciles", m.kpis.converted, sumB("converted"));
    add("Promoter leads + unknown = filtered leads", m.kpis.total, sumBy(m.promoters, (p) => p.leads) + m.kpis.unknownPromoter);
    add("Promoter converted + unknown = converted", m.kpis.converted, sumBy(m.promoters, (p) => p.converted) + sumBy(m.rows.filter((r) => !r.promoterKnown), (r) => r.converted));
    if (m.hasConsultant) add("Consultant leads + unassigned = filtered leads", m.kpis.total, sumBy(m.consultants, (c) => c.leads) + (m.kpis.unassigned || 0));
    add("Model leads = filtered leads", m.kpis.total, sumBy(m.models, (x) => x.leads));
    if (m.hasVisitors) add("Promoter visitors + unknown = total visitors", m.kpis.visitors, sumBy(m.promoters, (p) => p.visitors || 0) + sumBy(m.visitorRows.filter((v) => !v.promoterKnown), (v) => v.count));
    add("Filters do not change the underlying data", sigBefore, sigAfter);

    out.totals = { filtered: m.kpis, all: k, quality: dataset.quality, promoters: m.promoters, consultants: m.consultants,
      days: tr.buckets.filter((b) => b.leads || b.visitors), undated: tr.undated, hasVisitors: m.hasVisitors };
    return out;
  }

  global.GecData = {
    config,
    PROMOTER_MAP,
    UNKNOWN_PROMOTER,
    CONVERSION_STATUSES,
    isConverted,
    salesOrderState,
    isActualSalesOrder,
    hasSalesResponse,
    promoterFromEmployee,
    officialPromoters,
    parseBuffer,
    parseWorkbook,
    parseVisitorsBuffer,
    parseVisitorsWorkbook,
    compute,
    dailyMatrix,
    filterOptions,
    applyFilters,
    applyVisitorFilters,
    PREDICATES,
    validate,
    parseAnyDate,
    dayKey,
  };
})(typeof window !== "undefined" ? window : globalThis);
