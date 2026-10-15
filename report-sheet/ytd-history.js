/**
 * YTD Sales · historical Sales Report import and invoice reconciliation.
 * Report actuals and Sales Raw actuals stay separate. A missing figure stays missing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.YtdHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  const MONTH_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  function str(v) {
    return v == null ? "" : String(v).trim();
  }

  function norm(v) {
    return str(v).toLowerCase().replace(/[_./]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function looseName(v) {
    return norm(v).replace(/[^a-z0-9\u0600-\u06ff\s]/gi, " ").replace(/\b(al|el)\s+/g, "al").replace(/\s+/g, " ").trim();
  }

  function employeeId(v) {
    const s = str(v).replace(/\.0$/, "").replace(/\s+/g, "");
    return /^\d+$/.test(s) ? s.replace(/^0+/, "") || "0" : "";
  }

  function cleanVin(v) {
    return str(v).replace(/\s+/g, "").toUpperCase();
  }

  function numOrNull(v) {
    if (v == null || str(v) === "" || str(v) === "-" || str(v) === "—") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const n = Number(str(v).replace(/,/g, "").replace(/%$/, ""));
    return Number.isFinite(n) ? n : null;
  }

  function monthIndex(text) {
    const n = norm(text);
    let i = MONTHS.findIndex((m) => n === m || n.startsWith(m + " ") || n.endsWith(" " + m) || n.includes(" " + m + " "));
    if (i >= 0) return i;
    i = MONTH_SHORT.findIndex((m) => n === m || n.startsWith(m + " ") || n.endsWith(" " + m));
    return i;
  }

  function metricOf(text) {
    const n = norm(text);
    if (!n) return "";
    if (n === "ach" || n === "ach %" || n.includes("ach")) return "ach";
    if (n === "target" || n.includes("target")) return "target";
    if (n === "sales" || n === "actual" || n.includes("monthly sales") || n === "sale") return "sales";
    return "";
  }

  function parseAsOf(matrix) {
    const limit = Math.min(matrix.length, 12);
    for (let r = 0; r < limit; r += 1) {
      const line = matrix[r] || [];
      for (let c = 0; c < line.length; c += 1) {
        const cell = line[c];
        if (cell instanceof Date && !Number.isNaN(cell.getTime())) return new Date(cell.getFullYear(), cell.getMonth(), cell.getDate());
        const s = str(cell);
        let m = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
        if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
        m = s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
        if (m) {
          const mi = monthIndex(m[2]);
          if (mi >= 0) return new Date(+m[3], mi, +m[1]);
        }
        m = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/);
        if (m) {
          const mi = monthIndex(m[1]);
          if (mi >= 0) return new Date(+m[3], mi, +m[2]);
        }
      }
    }
    return null;
  }

  function findHeader(matrix) {
    let best = { idx: 0, score: -1 };
    const limit = Math.min(matrix.length, 30);
    for (let i = 0; i < limit; i += 1) {
      const cells = (matrix[i] || []).map(norm);
      const score = cells.filter((c) => /salesman|employee|plant|region|center|target|sales/.test(c)).length;
      if (score > best.score) best = { idx: i, score };
    }
    return best.idx;
  }

  /**
   * Salesman Performance sheet → monthly employee rows.
   * Blank sales or target stays null. Zero stays zero.
   */
  function parsePerformance(matrix, opts) {
    const warnings = [];
    const rows = Array.isArray(matrix) ? matrix : [];
    if (!rows.length) return { ok: false, error: "The sheet is empty", warnings, months: {} };
    const headerIdx = findHeader(rows);
    const header = rows[headerIdx] || [];
    const parent = headerIdx > 0 ? rows[headerIdx - 1] || [] : [];
    const cols = [];
    header.forEach((cell, i) => {
      const own = norm(cell);
      const above = norm(parent[i]);
      const combined = `${above} ${own}`.trim();
      const month = monthIndex(combined);
      const metric = metricOf(own) || metricOf(combined);
      if (month >= 0 && metric) cols.push({ i, month, metric });
    });
    if (!cols.length) {
      return { ok: false, error: "No monthly Sales, Target, and Ach% headers were found on Salesman Performance", warnings, months: {} };
    }
    const findCol = (re) => header.findIndex((h) => re.test(norm(h)));
    const idCol = findCol(/employee\s*(no|number|id)|emp\s*(no|id)|staff\s*id|salesman\s*(no|id|code)/);
    const nameCol = findCol(/salesman\s*name|^salesman$|employee\s*name|^name$/);
    const regionCol = findCol(/region/);
    const plantCol = findCol(/plant/);
    const centerCol = findCol(/center|centre|showroom/);
    if (nameCol < 0 && idCol < 0) {
      return { ok: false, error: "Salesman Performance needs an employee name or employee number column", warnings, months: {} };
    }
    const asOf = (opts && opts.asOf instanceof Date && !Number.isNaN(opts.asOf.getTime())) ? opts.asOf : parseAsOf(rows);
    const months = {};
    const seen = {};
    for (let r = headerIdx + 1; r < rows.length; r += 1) {
      const line = rows[r] || [];
      if (line.every((c) => str(c) === "")) continue;
      const name = nameCol >= 0 ? str(line[nameCol]) : "";
      const id = idCol >= 0 ? employeeId(line[idCol]) : "";
      if (!name && !id) continue;
      if (/^total\b/i.test(name)) continue;
      const base = { id, name, region: regionCol >= 0 ? str(line[regionCol]) : "", plant: plantCol >= 0 ? str(line[plantCol]) : "", center: centerCol >= 0 ? str(line[centerCol]) : "" };
      const byMonth = {};
      cols.forEach((col) => {
        if (!byMonth[col.month]) byMonth[col.month] = { sales: null, target: null, ach: null };
        byMonth[col.month][col.metric] = numOrNull(line[col.i]);
      });
      Object.keys(byMonth).forEach((m) => {
        const month = Number(m);
        const year = asOf ? asOf.getFullYear() : (opts && opts.year) || new Date().getFullYear();
        const key = `${year}-${String(month + 1).padStart(2, "0")}`;
        if (!months[key]) months[key] = { key, employees: [] };
        const figures = byMonth[month];
        if (figures.sales == null) warnings.push(`${name || id} · ${key} sales is blank`);
        if (figures.target == null) warnings.push(`${name || id} · ${key} target is blank`);
        const ident = id || looseName(name);
        const dupKey = `${key}|${ident}`;
        seen[dupKey] = (seen[dupKey] || 0) + 1;
        months[key].employees.push({
          ...base,
          sales: figures.sales,
          target: figures.target,
          ach: figures.ach,
          salesMissing: figures.sales == null,
          targetMissing: figures.target == null,
          duplicate: false,
        });
      });
    }
    Object.keys(months).forEach((key) => {
      months[key].employees.forEach((emp) => {
        const ident = emp.id || looseName(emp.name);
        if (seen[`${key}|${ident}`] > 1) emp.duplicate = true;
      });
    });
    const partialMonths = [];
    if (asOf) {
      const key = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}`;
      const last = new Date(asOf.getFullYear(), asOf.getMonth() + 1, 0).getDate();
      if (asOf.getDate() < last && months[key]) partialMonths.push(key);
    }
    const dupWarnings = Object.keys(seen).filter((k) => seen[k] > 1);
    dupWarnings.forEach((k) => warnings.push(`Duplicate employee in ${k.replace("|", " ")}`));
    return {
      ok: Object.keys(months).length > 0,
      error: Object.keys(months).length ? "" : "No employee rows under the monthly headers",
      warnings: warnings.slice(0, 80),
      asOf: asOf ? `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, "0")}-${String(asOf.getDate()).padStart(2, "0")}` : "",
      partialMonths,
      months,
      sheet: (opts && opts.sheet) || "Salesman Performance",
    };
  }

  function achievement(actual, target) {
    if (actual == null || target == null || !Number.isFinite(target) || target <= 0 || !Number.isFinite(actual)) return null;
    const pct = (actual / target) * 100;
    return Number.isFinite(pct) ? pct : null;
  }

  function isUnassigned(name) {
    const n = looseName(name);
    return n === "not assigned" || n === "unassigned" || n === "notassigned";
  }

  /**
   * Invoice rows already parsed. Same VIN in a month counts once.
   * Conflicting duplicates are excluded and flagged.
   */
  function aggregateInvoices(rows, year) {
    const months = {};
    const groups = new Map();
    (rows || []).forEach((row, index) => {
      if (!(row.invoice instanceof Date) || row.invoice.getFullYear() !== year) return;
      if (row.reason || row.qty == null) return;
      const key = `${year}-${String(row.invoice.getMonth() + 1).padStart(2, "0")}`;
      const vin = cleanVin(row.vin) || `blank:${index}`;
      const gkey = `${key}|${vin}`;
      if (!groups.has(gkey)) groups.set(gkey, []);
      groups.get(gkey).push({ ...row, month: key, vin });
    });
    groups.forEach((list) => {
      const month = list[0].month;
      if (!months[month]) months[month] = { raw: 0, unassigned: 0, flagged: 0, employees: new Map(), vins: [] };
      const bucket = months[month];
      const ids = new Set(list.map((r) => employeeId(r.id) || looseName(r.name)));
      const qtys = new Set(list.map((r) => r.qty));
      if (list.length > 1 && (ids.size > 1 || qtys.size > 1)) {
        bucket.flagged += 1;
        bucket.vins.push({ vin: list[0].vin, status: "conflict", rows: list.length });
        return;
      }
      const row = list[0];
      const qty = row.qty;
      const unassigned = isUnassigned(row.name);
      if (unassigned) bucket.unassigned += qty;
      else bucket.raw += qty;
      const id = employeeId(row.id);
      const key = id || looseName(row.name) || `row:${row.name}`;
      if (!bucket.employees.has(key)) bucket.employees.set(key, { key, id, name: row.name || "", actual: 0, unassigned, vins: [] });
      const emp = bucket.employees.get(key);
      emp.actual += qty;
      if (row.vin && !String(row.vin).startsWith("blank:")) emp.vins.push(row.vin);
      bucket.vins.push({ vin: row.vin, status: list.length > 1 ? "duplicate" : "kept", qty });
    });
    return months;
  }

  function reconcileMonth(reportEmployees, rawEmployees, partial) {
    const reports = reportEmployees || [];
    const raws = rawEmployees || [];
    const byId = new Map();
    const byName = new Map();
    reports.forEach((emp) => {
      if (emp.id) {
        const list = byId.get(emp.id) || [];
        list.push(emp);
        byId.set(emp.id, list);
      }
      const name = looseName(emp.name);
      if (name) {
        const list = byName.get(name) || [];
        list.push(emp);
        byName.set(name, list);
      }
    });
    const used = new Set();
    const rows = [];
    raws.forEach((raw) => {
      if (raw.unassigned || isUnassigned(raw.name)) {
        rows.push({ id: raw.id || "", name: raw.name || "Not assigned", plant: "", report: null, raw: raw.actual, target: null, status: "Unassigned", vins: raw.vins || [], ambiguous: false });
        return;
      }
      let match = null;
      let ambiguous = false;
      if (raw.id && byId.has(raw.id)) {
        const hits = byId.get(raw.id);
        if (hits.length === 1) match = hits[0];
        else ambiguous = true;
      } else {
        const hits = byName.get(looseName(raw.name)) || [];
        if (hits.length === 1) match = hits[0];
        else if (hits.length > 1) ambiguous = true;
      }
      if (ambiguous) {
        rows.push({ id: raw.id || "", name: raw.name, plant: "", report: null, raw: raw.actual, target: null, status: "Duplicate requiring review", vins: raw.vins || [], ambiguous: true });
        return;
      }
      if (!match) {
        rows.push({ id: raw.id || "", name: raw.name, plant: "", report: null, raw: raw.actual, target: null, status: "Raw only", vins: raw.vins || [], ambiguous: false });
        return;
      }
      used.add(match);
      const report = match.sales;
      const diff = report == null || raw.actual == null ? null : raw.actual - report;
      rows.push({
        id: match.id || raw.id || "",
        name: match.name || raw.name,
        plant: match.plant || match.center || "",
        report,
        raw: raw.actual,
        target: match.target,
        ach: achievement(raw.actual, match.target),
        status: partial ? "Pending / incomplete source" : diff == null ? "Pending / incomplete source" : Math.abs(diff) < 0.001 ? "Match" : "Mismatch",
        vins: raw.vins || [],
        ambiguous: false,
      });
    });
    reports.forEach((emp) => {
      if (used.has(emp)) return;
      rows.push({
        id: emp.id || "",
        name: emp.name || "—",
        plant: emp.plant || emp.center || "",
        report: emp.sales,
        raw: null,
        target: emp.target,
        ach: achievement(emp.sales, emp.target),
        status: emp.duplicate ? "Duplicate requiring review" : partial ? "Pending / incomplete source" : "Report only",
        vins: [],
        ambiguous: !!emp.duplicate,
      });
    });
    return rows;
  }

  function monthStatus(rows, partial) {
    if (partial) return "Pending / incomplete source";
    if (!rows.length) return "Pending / incomplete source";
    if (rows.some((r) => r.status === "Duplicate requiring review")) return "Duplicate requiring review";
    if (rows.some((r) => r.status === "Mismatch")) return "Mismatch";
    if (rows.some((r) => r.status === "Raw only" || r.status === "Report only" || r.status === "Unassigned")) return "Mismatch";
    if (rows.every((r) => r.status === "Match")) return "Match";
    return "Pending / incomplete source";
  }

  return {
    parsePerformance,
    aggregateInvoices,
    reconcileMonth,
    monthStatus,
    achievement,
    employeeId,
    looseName,
    cleanVin,
    numOrNull,
  };
});
