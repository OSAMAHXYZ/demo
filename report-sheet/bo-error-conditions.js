(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BoeConditions = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const OPERATORS = ["equals", "not_equals", "contains", "not_contains", "empty", "not_empty", "gt", "lt", "in_list", "not_in_list"];
  const NEEDS_VALUE = { equals: 1, not_equals: 1, contains: 1, not_contains: 1, gt: 1, lt: 1, in_list: 1, not_in_list: 1 };
  const OPERATOR_TEXT = {
    equals: "equals",
    not_equals: "does not equal",
    contains: "contains",
    not_contains: "does not contain",
    empty: "is empty",
    not_empty: "is not empty",
    gt: "is greater than",
    lt: "is less than",
    in_list: "is one of",
    not_in_list: "is not one of",
  };

  function cellString(value) {
    if (value == null) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const dd = String(value.getDate()).padStart(2, "0");
      const mm = String(value.getMonth() + 1).padStart(2, "0");
      return `${dd}.${mm}.${value.getFullYear()}`;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return String(value).replace(/\u00a0/g, " ").trim();
  }

  function fold(value) {
    return cellString(value).replace(/\s+/g, " ").trim().toLowerCase();
  }

  function colLetter(idx) {
    let n = Number(idx) + 1;
    let s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function findHeader(headers, aliases) {
    const list = headers || [];
    const wanted = (aliases || []).map(fold).filter(Boolean);
    const exact = list.find((header) => wanted.includes(fold(header)));
    if (exact) return exact;
    return list.find((header) => wanted.some((name) => name && fold(header).includes(name))) || "";
  }

  function splitValues(raw) {
    if (Array.isArray(raw)) return raw.map(cellString).filter((item) => item !== "");
    return cellString(raw).split(/[\n,;|]/).map((item) => item.trim()).filter(Boolean);
  }

  function compareRank(left, right) {
    const leftNum = Number(String(left).replace(/,/g, ""));
    const rightNum = Number(String(right).replace(/,/g, ""));
    if (String(left).trim() !== "" && Number.isFinite(leftNum) && Number.isFinite(rightNum)) return leftNum - rightNum;
    return fold(left).localeCompare(fold(right));
  }

  function conditionMatches(operator, cell, expected) {
    const text = cellString(cell);
    const folded = fold(text);
    const list = expected || [];
    if (operator === "empty") return folded === "";
    if (operator === "not_empty") return folded !== "";
    if (operator === "equals" || operator === "in_list") return list.some((item) => fold(text) === fold(item));
    if (operator === "not_equals" || operator === "not_in_list") {
      if (!list.length) return false;
      if (operator === "not_in_list" && folded === "") return false;
      return list.every((item) => fold(text) !== fold(item));
    }
    if (operator === "contains") return list.some((item) => fold(item) && folded.includes(fold(item)));
    if (operator === "not_contains") return list.length ? list.every((item) => !fold(item) || !folded.includes(fold(item))) : false;
    if (operator === "gt" || operator === "lt") {
      if (!text) return false;
      return list.some((item) => {
        const gap = compareRank(text, item);
        return operator === "gt" ? gap > 0 : gap < 0;
      });
    }
    return false;
  }

  function ruleConditions(rule) {
    const list = Array.isArray(rule && rule.conditions) ? rule.conditions : [];
    return list.map((item) => {
      const operator = OPERATORS.includes(item && item.operator) ? item.operator : "equals";
      return {
        column: cellString(item && item.column),
        operator,
        values: NEEDS_VALUE[operator] ? splitValues(item && (item.values != null ? item.values : item.value)) : [],
      };
    }).filter((item) => item.column);
  }

  function describeCondition(cond) {
    const column = cellString(cond && cond.column) || "column";
    const operator = OPERATOR_TEXT[cond && cond.operator] || "equals";
    if (cond && (cond.operator === "empty" || cond.operator === "not_empty")) return `${column} ${operator}`;
    const values = splitValues(cond && cond.values).join(", ") || "blank";
    return `${column} ${operator} ${values}`;
  }

  function describeRule(rule) {
    const list = ruleConditions(rule);
    if (!list.length) return "no condition is set";
    const mode = rule && rule.matchMode === "any" ? " or " : " and ";
    return list.map(describeCondition).join(mode);
  }

  function headersOf(row) {
    if (row && Array.isArray(row.__headers) && row.__headers.length) return row.__headers;
    return Object.keys(row || {}).filter((key) => !String(key).startsWith("__"));
  }

  function rowValue(row, header) {
    if (!row || !header) return "";
    if (Object.prototype.hasOwnProperty.call(row, header)) return row[header];
    const hit = headersOf(row).find((name) => fold(name) === fold(header));
    return hit ? row[hit] : "";
  }

  function letterFor(row, header) {
    const headers = headersOf(row);
    const idx = headers.findIndex((name) => name === header || fold(name) === fold(header));
    return idx >= 0 ? colLetter(idx) : "";
  }

  function productHeader(headers) {
    return findHeader(headers, [
      "Product", "Car", "Vehicle", "Model", "Product Name", "Product Desc", "Product Description",
      "Model Name", "Vehicle Name", "Series", "Line", "المنتج", "السيارة", "الموديل"
    ]) || (headers && headers[1]) || "";
  }

  function orderHeader(headers) {
    return findHeader(headers, ["Back Order Number", "BO Number", "Order Number", "Order No"]) || (headers && headers[5]) || "";
  }

  function salesmanHeader(headers) {
    return findHeader(headers, ["Salesman Name", "Salesman", "Employee Name", "Employee"]) || "";
  }

  function carMatches(product, rule) {
    const wanted = (Array.isArray(rule && rule.products) ? rule.products : []).map(fold).filter(Boolean);
    if (!wanted.length) return true;
    const folded = fold(product);
    return wanted.some((name) => folded === name || folded.includes(name) || name.includes(folded));
  }

  function rowMatches(row, rule, product) {
    const headers = headersOf(row);
    const conditions = ruleConditions(rule).map((item) => ({ ...item, header: findHeader(headers, [item.column]) }));
    const prod = product != null ? product : rowValue(row, productHeader(headers));
    if (!carMatches(prod, rule)) {
      return { pass: false, hits: [], letters: [], reason: `Car is ${cellString(prod) || "blank"}` };
    }
    if (!conditions.length) return { pass: false, hits: [], letters: [], reason: "No condition is set" };
    const checks = conditions.map((item) => {
      if (!item.header) {
        return { pass: false, header: "", value: "", letter: "", reason: `Column ${item.column} is not in the BO file` };
      }
      const value = cellString(rowValue(row, item.header));
      const pass = conditionMatches(item.operator, rowValue(row, item.header), item.values);
      return {
        pass,
        header: item.header,
        value,
        letter: letterFor(row, item.header),
        reason: pass ? "" : `${item.column} is ${value || "blank"}; needed ${describeCondition(item)}`,
      };
    });
    const mode = rule && rule.matchMode === "any" ? "any" : "all";
    const pass = mode === "any" ? checks.some((item) => item.pass) : checks.every((item) => item.pass);
    const hits = checks.filter((item) => item.pass && item.header);
    const letters = [];
    hits.forEach((item) => { if (item.letter && !letters.includes(item.letter)) letters.push(item.letter); });
    const failed = checks.find((item) => !item.pass);
    const reason = pass ? "" : (mode === "any"
      ? `None of the conditions matched. ${checks.map((item) => item.reason).filter(Boolean).join(" ")}`
      : ((failed && failed.reason) || "Condition did not match"));
    return { pass, hits, letters, reason };
  }

  function parseMatrix(matrix) {
    const lines = (matrix || []).filter((line) => (line || []).some((cell) => cellString(cell) !== ""));
    if (!lines.length) return { headers: [], rows: [] };
    let headerIdx = 0;
    let best = -1;
    const limit = Math.min(lines.length, 20);
    for (let i = 0; i < limit; i += 1) {
      const filled = (lines[i] || []).filter((cell) => cellString(cell) !== "").length;
      if (filled > best) {
        best = filled;
        headerIdx = i;
      }
    }
    const seen = {};
    const headers = (lines[headerIdx] || []).map((cell, idx) => {
      const base = cellString(cell) || `Column ${colLetter(idx)}`;
      if (!seen[base]) {
        seen[base] = 1;
        return base;
      }
      seen[base] += 1;
      return `${base} (${seen[base]})`;
    });
    const rows = [];
    for (let i = headerIdx + 1; i < lines.length; i += 1) {
      const line = lines[i] || [];
      if (line.every((cell) => cellString(cell) === "")) continue;
      const obj = { __headers: headers, __cells: line };
      headers.forEach((header, idx) => { obj[header] = line[idx] != null ? line[idx] : ""; });
      rows.push(obj);
    }
    return { headers, rows };
  }

  function productsFrom(headers, rows) {
    const header = productHeader(headers);
    const seen = new Set();
    const list = [];
    (rows || []).forEach((row) => {
      const name = cellString(rowValue(row, header));
      const key = fold(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push(name);
    });
    list.sort((a, b) => a.localeCompare(b));
    return list;
  }

  function testTable(table, rule) {
    const headers = (table && table.headers) || [];
    const rows = (table && table.rows) || [];
    const conditions = ruleConditions(rule);
    const missing = conditions.filter((item) => !findHeader(headers, [item.column])).map((item) => item.column);
    const orderHead = orderHeader(headers);
    const salesHead = salesmanHeader(headers);
    const prodHead = productHeader(headers);
    const matchedSample = [];
    const excludedSample = [];
    let orderCount = 0;
    let excludedCount = 0;
    rows.forEach((row) => {
      const product = cellString(rowValue(row, prodHead));
      const hit = rowMatches(row, rule, product);
      const boNumber = cellString(rowValue(row, orderHead)) || "Order number unavailable";
      const salesmanName = cellString(rowValue(row, salesHead)) || "Unassigned";
      if (!hit.pass) {
        excludedCount += 1;
        if (excludedSample.length < 8) {
          excludedSample.push({ boNumber, product, salesmanName, reason: hit.reason || "Condition did not match" });
        }
        return;
      }
      orderCount += 1;
      if (matchedSample.length < 8) {
        matchedSample.push({
          boNumber,
          product,
          salesmanName,
          values: (hit.hits || []).map((item) => `${item.header}: ${item.value || "blank"}`).join("; "),
        });
      }
    });
    return {
      ok: !!conditions.length && missing.length < conditions.length,
      columnMissing: !conditions.length || missing.length === conditions.length,
      missingColumns: missing,
      orderCount,
      excludedCount,
      totalRows: rows.length,
      headers,
      products: productsFrom(headers, rows),
      matchedSample,
      excludedSample,
      conditionText: describeRule(rule),
    };
  }

  function cleanId(value, fallback) {
    const text = cellString(value).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    return text || fallback;
  }

  function sanitizeRules(input) {
    const list = Array.isArray(input) ? input : [];
    const seen = new Set();
    const out = [];
    list.forEach((raw, index) => {
      if (!raw || typeof raw !== "object") return;
      const id = cleanId(raw.id, `c${index + 1}`);
      if (seen.has(id)) return;
      seen.add(id);
      const conditions = ruleConditions(raw).slice(0, 12).map((item) => ({
        column: item.column.slice(0, 80),
        operator: item.operator,
        values: item.values.slice(0, 30).map((value) => value.slice(0, 80)),
      }));
      const products = (Array.isArray(raw.products) ? raw.products : [])
        .map((name) => cellString(name).slice(0, 60))
        .filter(Boolean)
        .slice(0, 40);
      const severity = raw.severity === "warn" || raw.severity === "info" ? raw.severity : "critical";
      out.push({
        id,
        name: (cellString(raw.name) || "BO error condition").slice(0, 80),
        severity,
        matchMode: raw.matchMode === "any" ? "any" : "all",
        products,
        conditions,
        active: raw.active !== false,
        submitted: raw.submitted === true,
        testedAt: Number(raw.testedAt) || 0,
        testCount: Math.max(0, Number(raw.testCount) || 0),
        fileName: cellString(raw.fileName).slice(0, 120),
      });
    });
    return out.slice(0, 40);
  }

  function activeRules(input) {
    return sanitizeRules(input).filter((rule) => rule.submitted && rule.active !== false && rule.conditions.length);
  }

  return {
    OPERATORS,
    OPERATOR_TEXT,
    describeRule,
    parseMatrix,
    productsFrom,
    testTable,
    rowMatches,
    sanitizeRules,
    activeRules,
    productHeader,
  };
});
