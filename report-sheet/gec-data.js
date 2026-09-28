/**
 * GEC data layer · Guest Experience Center leads.
 * Auto-detects the lead sheet, header row and columns of any month's GEC workbook,
 * normalises every row into a lead record and computes all dashboard metrics.
 * No KPI is hard-coded — replace the Excel (Sep → Oct → Nov) and everything recalculates.
 */
(function (global) {
  const config = {
    /** Hours allowed from assignment (or lead date) to first sales response. */
    slaHours: 24,
    headerScanRows: 30,
    /** Trend switches from daily to weekly buckets above this many days. */
    maxDailyBuckets: 62,
  };

  /**
   * Column dictionary · order = claim priority (specific fields before generic ones).
   * exact: whole-header matches · contains: substring matches · not: substrings that disqualify.
   */
  const FIELDS = [
    {
      key: "leadId", label: "Lead ID",
      exact: ["lead id", "lead no", "lead number", "lead #", "lead ref", "enquiry id", "enquiry no", "inquiry id", "inquiry no", "ticket id", "ticket no", "request id", "request no", "reference", "reference no", "ref no", "ref", "id", "رقم الطلب"],
      contains: ["lead id", "lead no", "lead number", "enquiry no", "inquiry no", "ticket"],
      not: ["date", "time"],
    },
    {
      key: "salesOrderDate", label: "Sales order date",
      exact: ["sales order date", "so date", "so creation date", "order date", "proforma date", "booking date"],
      contains: ["sales order date", "so date", "order date", "proforma date", "booking date"],
    },
    {
      key: "convertedDate", label: "Converted / invoice date",
      exact: ["invoice date", "delivery date", "conversion date", "converted date", "retail date", "sold date"],
      contains: ["invoice date", "delivery date", "conversion date", "converted date", "retail date"],
    },
    {
      key: "assignedDate", label: "Assigned date",
      exact: ["assigned date", "assignment date", "assigned on", "assigned at", "assigned time", "assign date", "date assigned", "assigned date time"],
      contains: ["assigned date", "assignment date", "assign date", "assigned on", "assigned at", "assigned time", "assignment time"],
    },
    {
      key: "responseTime", label: "Response time",
      exact: ["response time", "time to respond", "response hours", "response hrs", "response mins", "response minutes", "tat", "response tat", "first response time", "hours to respond", "response duration"],
      contains: ["response time", "response hour", "response hr", "response min", "time to respond", "response duration", "response tat"],
    },
    {
      key: "responseDate", label: "Sales response date",
      exact: ["response date", "first response date", "first response", "responded on", "responded at", "contact date", "contacted date", "contacted on", "first contact", "first contact date", "sales response date", "follow up date", "first follow up", "call date"],
      contains: ["response date", "responded on", "responded at", "contacted", "contact date", "first contact", "follow up date"],
      not: ["hour", "min", "sla", "tat"],
    },
    {
      key: "sla", label: "SLA",
      exact: ["sla", "sla status", "sla breach", "over sla", "within sla", "sla met", "sla result"],
      contains: ["sla"],
    },
    {
      key: "salesOrder", label: "Sales order",
      exact: ["sales order", "sales order no", "sales order number", "so", "so no", "so number", "so #", "order no", "order number", "proforma", "proforma no", "proforma number", "booking no", "رقم أمر البيع"],
      contains: ["sales order", "so number", "so no", "proforma", "order no", "order number", "booking no"],
      not: ["date", "status"],
    },
    {
      key: "converted", label: "Converted",
      exact: ["converted", "conversion", "is converted", "converted?", "invoice", "invoiced", "invoice no", "invoice number", "delivered", "retail", "sold", "won"],
      contains: ["convert", "invoice no", "invoice number", "invoiced"],
      not: ["date", "rate", "%", "ratio"],
    },
    {
      key: "salesResponse", label: "Sales response",
      exact: ["sales response", "sales feedback", "sales remarks", "sales remark", "sales comment", "sales comments", "response", "feedback", "follow up status", "follow up"],
      contains: ["sales response", "sales feedback", "sales remark", "sales comment", "follow up status"],
      not: ["date", "time"],
    },
    {
      key: "leadDate", label: "Lead date",
      exact: ["lead date", "lead created date", "lead creation date", "created date", "creation date", "created on", "created at", "create date", "enquiry date", "inquiry date", "request date", "submission date", "submitted on", "visit date", "registration date", "date", "التاريخ", "تاريخ الطلب"],
      contains: ["lead date", "created", "creation", "enquiry date", "inquiry date", "visit date", "request date", "submission date"],
      not: ["assigned", "response", "order", "invoice", "delivery", "so date", "updated", "modified", " by"],
    },
    {
      key: "promoter", label: "Promoter",
      exact: ["promoter", "promoter name", "promoters", "gec promoter", "gec agent", "agent", "agent name", "gec employee", "gec staff", "host", "hostess", "created by", "lead owner", "المروج", "اسم المروج"],
      contains: ["promoter", "gec agent", "hostess", "host name", "created by"],
    },
    {
      key: "assignedTo", label: "Assigned to (sales)",
      exact: ["assigned to", "assigned salesman", "assigned sales", "assigned consultant", "sales consultant", "sales employee", "salesman", "salesman name", "sales advisor", "sales executive", "consultant", "sc", "sc name", "sales person", "salesperson", "owner", "advisor", "البائع", "مستشار المبيعات"],
      contains: ["assigned to", "sales consultant", "salesman", "sales employee", "sales advisor", "sales executive", "salesperson", "sales person", "consultant"],
      not: ["date", "time", "code", " id"],
    },
    {
      key: "model", label: "Model",
      exact: ["model", "car model", "vehicle model", "interested model", "model of interest", "vehicle", "car", "model name", "interested vehicle", "vehicle of interest", "الموديل", "السيارة"],
      contains: ["model", "vehicle", "car"],
      not: ["year", "code", "date", "status", "vin", "care", "card", "carrier", "location", "number"],
    },
    {
      key: "source", label: "Source",
      exact: ["source", "lead source", "channel", "lead channel", "campaign", "source channel", "enquiry source", "inquiry source", "media", "المصدر"],
      contains: ["source", "channel", "campaign"],
    },
    {
      key: "status", label: "Lead status",
      exact: ["status", "lead status", "stage", "lead stage", "current status", "final status", "outcome", "result", "الحالة"],
      contains: ["status", "stage", "outcome"],
      not: ["sla"],
    },
    {
      key: "customer", label: "Customer",
      exact: ["customer", "customer name", "client", "client name", "guest", "guest name", "name", "full name", "اسم العميل"],
      contains: ["customer", "client", "guest name"],
      not: [" id", "phone", "mobile", "type", "number", " no"],
    },
    {
      key: "phone", label: "Mobile",
      exact: ["mobile", "mobile no", "mobile number", "phone", "phone no", "phone number", "contact", "contact no", "contact number", "الجوال", "رقم الجوال"],
      contains: ["mobile", "phone", "contact no", "contact number"],
    },
  ];

  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
  const SCORE_WEIGHT = { leadDate: 3, status: 2, promoter: 3, model: 2, assignedTo: 2, salesOrder: 2, source: 1, converted: 2 };

  const BLANKISH = new Set(["", "-", "--", "—", "n/a", "na", "none", "null", "nil", "0", "no data", "tbd"]);
  const UNASSIGNED_VALUES = /^(not\s*assigned|unassigned|pending|pending\s*assignment|none|no\s*one|غير\s*مسند)$/i;

  const RE = {
    notConverted: /not\s*conver|non[-\s]*conver|un[-\s]*conver|لم\s*يتم\s*البيع/i,
    converted: /conver|invoic|deliver|\bwon\b|closed\s*won|\bsold\b|purchas|\bretail/i,
    convertedAr: /تم\s*البيع|تم\s*التسليم|مباع/,
    salesOrder: /sales\s*order|\bs\.?o\b|proforma|order\s*(created|placed)|booked|booking|reserv|deposit|down\s*payment|حجز|أمر\s*بيع/i,
    noResponse: /no\s*(response|answer|reply)|not\s*(contacted|reachable|responding|answered|responded)|unreachable|لم\s*يتم\s*التواصل|لا\s*يرد/i,
    responded: /contact|respond|follow|called|\bcall\b|visit|test\s*drive|negotiat|quot|offer|in\s*progress|interested|\bhot\b|\bwarm\b|تواصل|متابعة/i,
    assigned: /assign|allocat|distribut|تم\s*التوزيع|مسند/i,
    failed: /\blost\b|reject|fail|cancel|not\s*interested|no\s*interest|invalid|duplicate|junk|spam|wrong\s*number|closed\s*lost|\bdead\b|\bdrop|رفض|ملغ|غير\s*مهتم/i,
    yes: /^(y|yes|true|1|done|✓|✔|converted|invoiced|delivered|sold|won|نعم)$/i,
    no: /^(n|no|false|0|pending|not\s*converted|x|✗|لا)$/i,
    slaOver: /over|breach|exceed|late|violat|\bout\b|missed|خارج|متأخر/i,
    slaOk: /within|\bmet\b|\bok\b|on\s*time|\bin\b|achiev|داخل/i,
    total: /^(grand\s*)?total$|^المجموع$|^الإجمالي$/i,
  };

  function normHeader(h) {
    return String(h ?? "")
      .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
      .toLowerCase()
      .replace(/[_\-./\\|:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function str(v) {
    if (v == null) return "";
    if (v instanceof Date) return isNaN(v) ? "" : v.toISOString();
    return String(v).replace(/[\u200e\u200f]/g, "").trim();
  }

  function isBlankish(v) {
    if (v == null) return true;
    if (typeof v === "number") return v === 0 || !Number.isFinite(v);
    if (v instanceof Date) return isNaN(v);
    return BLANKISH.has(str(v).toLowerCase());
  }

  // ---------- Dates & durations ----------

  function excelSerialToDate(n) {
    const d = new Date(Math.round((n - 25569) * 86400000));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

  function parseAnyDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v) || v.getFullYear() < 1990 ? null : v;
    if (typeof v === "number") return v > 30000 && v < 80000 ? excelSerialToDate(v) : null;
    const s = str(v);
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
    if (m) return buildDate(+m[1], +m[2] - 1, +m[3], m[4], m[5], m[6], m[7]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
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

  function buildDate(y, mo, d, hh, mi, ss, ap) {
    let h = hh != null ? +hh : 0;
    if (ap) {
      const pm = /pm/i.test(ap);
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    const dt = new Date(y, mo, d, h, mi != null ? +mi : 0, ss != null ? +ss : 0);
    return isNaN(dt) || dt.getFullYear() < 1990 ? null : dt;
  }

  /** Duration cell → hours. Header text decides units for plain numbers. */
  function parseDurationHours(v, headerNorm) {
    if (v == null || v === "") return null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      const base = new Date(1899, 11, 30).getTime();
      const h = (v.getTime() - base) / 3600000;
      return h >= 0 && h < 24 * 400 ? h : null;
    }
    const unit = /min/.test(headerNorm) ? "m" : /day/.test(headerNorm) ? "d" : /sec/.test(headerNorm) ? "s" : /hour|hr/.test(headerNorm) ? "h" : "";
    if (typeof v === "number") {
      if (!Number.isFinite(v) || v < 0) return null;
      if (unit === "m") return v / 60;
      if (unit === "d") return v * 24;
      if (unit === "s") return v / 3600;
      if (unit === "h") return v;
      return v < 1 && !Number.isInteger(v) ? v * 24 : v;
    }
    const s = str(v).toLowerCase();
    if (!s) return null;
    let m = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (m) return +m[1] + +m[2] / 60 + (m[3] ? +m[3] / 3600 : 0);
    let total = 0;
    let hit = false;
    const re = /(\d+(?:\.\d+)?)\s*(d|day|days|h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|يوم|ساعة|دقيقة)/g;
    while ((m = re.exec(s))) {
      hit = true;
      const n = +m[1];
      const u = m[2];
      if (/^d|يوم/.test(u)) total += n * 24;
      else if (/^h|ساعة/.test(u)) total += n;
      else if (/^m|دقيقة/.test(u)) total += n / 60;
      else total += n / 3600;
    }
    if (hit) return total;
    const n = parseFloat(s.replace(/,/g, ""));
    return Number.isFinite(n) ? parseDurationHours(n, headerNorm) : null;
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

  // ---------- Header detection ----------

  function matchScore(field, hn) {
    if (!hn) return 0;
    if ((field.not || []).some((x) => hn.includes(x) && !(field.exact || []).includes(hn))) return 0;
    if ((field.exact || []).includes(hn)) return 100;
    const hit = (field.contains || []).find((c) => hn.includes(c));
    return hit ? 40 + Math.min(hit.length, 30) : 0;
  }

  /** @returns {{ map: Record<string, number>, score: number, count: number }} */
  function mapHeaders(headers) {
    const norms = headers.map(normHeader);
    const claimed = new Set();
    const map = {};
    FIELDS.forEach((f) => {
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
    const score = keys.reduce((s, k) => s + (SCORE_WEIGHT[k] || 1), 0);
    return { map, score, count: keys.length };
  }

  function sheetMatrix(ws) {
    const opts = { header: 1, defval: "", blankrows: false, raw: true };
    try {
      const range = global.XLSX.utils.decode_range(ws["!ref"] || "A1");
      range.s.c = 0;
      opts.range = range;
    } catch { /* keep sheet range */ }
    return global.XLSX.utils.sheet_to_json(ws, opts);
  }

  function analyseSheet(name, ws) {
    const matrix = sheetMatrix(ws);
    let best = { headerIdx: -1, map: {}, score: 0, count: 0 };
    const limit = Math.min(matrix.length, config.headerScanRows);
    for (let i = 0; i < limit; i += 1) {
      const row = matrix[i] || [];
      if (row.filter((c) => str(c)).length < 3) continue;
      const res = mapHeaders(row);
      if (res.score > best.score) best = { headerIdx: i, ...res };
    }
    let score = best.score + Math.min(5, Math.floor((matrix.length - best.headerIdx - 1) / 20));
    if (/lead|raw|data|gec|guest|enquir|inquir/i.test(name)) score += 2;
    if (/dashboard|summary|pivot|chart|report|kpi/i.test(name)) score -= 4;
    return { name, matrix, ...best, sheetScore: score };
  }

  /** Fallback: first unclaimed column where most values parse as dates. */
  function detectDateColumn(matrix, headerIdx, claimed) {
    const rows = matrix.slice(headerIdx + 1, headerIdx + 201);
    if (!rows.length) return -1;
    const width = Math.max(...rows.map((r) => r.length), 0);
    for (let c = 0; c < width; c += 1) {
      if (claimed.has(c)) continue;
      let filled = 0;
      let dates = 0;
      rows.forEach((r) => {
        const v = r[c];
        if (v === "" || v == null) return;
        filled += 1;
        if (parseAnyDate(v)) dates += 1;
      });
      if (filled >= 5 && dates / filled >= 0.8) return c;
    }
    return -1;
  }

  // ---------- Record normalisation ----------

  function classifyConvertedCell(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return !isNaN(v);
    if (typeof v === "number") return v > 0;
    const s = str(v);
    if (!s) return null;
    if (RE.notConverted.test(s) || RE.no.test(s)) return false;
    if (RE.yes.test(s)) return true;
    if (parseAnyDate(s)) return true;
    if (/\d{4,}/.test(s)) return true;
    return RE.converted.test(s) || RE.convertedAr.test(s);
  }

  function classifySla(v, headerNorm) {
    if (v == null || v === "") return null;
    if (typeof v === "boolean") v = v ? "yes" : "no";
    const s = str(v);
    if (!s) return null;
    const yes = RE.yes.test(s);
    const no = RE.no.test(s);
    if (yes || no) {
      if (/over|breach|exceed|late|missed/.test(headerNorm)) return yes;
      if (/within|met|achiev|on time/.test(headerNorm)) return no;
    }
    if (RE.slaOver.test(s)) return true;
    if (RE.slaOk.test(s)) return false;
    return null;
  }

  function stageLabel(r) {
    if (r.converted) return "Converted";
    if (r.failed) return "Failed / Rejected";
    if (r.hasSalesOrder) return "Sales Order";
    if (r.responded) return "Responded";
    if (r.assigned) return "Assigned";
    return "Unassigned";
  }

  function buildRecord(line, idx, colMap, headers, headerNorms, now) {
    const get = (k) => (colMap[k] != null ? line[colMap[k]] : "");
    const getS = (k) => str(get(k));

    const date = parseAnyDate(get("leadDate"));
    const assignedAt = parseAnyDate(get("assignedDate"));
    const respondedAt = parseAnyDate(get("responseDate"));
    const salesOrderAt = parseAnyDate(get("salesOrderDate"));
    const convertedAt = parseAnyDate(get("convertedDate"));
    const status = getS("status");
    const salesResponse = getS("salesResponse");
    const assignedToRaw = getS("assignedTo");
    const assignedTo = isBlankish(assignedToRaw) || UNASSIGNED_VALUES.test(assignedToRaw) ? "" : assignedToRaw;
    const salesOrderRaw = get("salesOrder");
    const salesOrder = isBlankish(salesOrderRaw) || RE.no.test(str(salesOrderRaw)) ? "" : str(salesOrderRaw);

    let responseHours = colMap.responseTime != null
      ? parseDurationHours(get("responseTime"), headerNorms[colMap.responseTime])
      : null;
    if (responseHours == null && respondedAt) {
      const start = assignedAt || date;
      if (start) {
        const h = (respondedAt - start) / 3600000;
        if (h >= 0) responseHours = h;
      }
    }

    const convertedCell = colMap.converted != null ? classifyConvertedCell(get("converted")) : null;
    const statusConverted = !!status && !RE.notConverted.test(status) && (RE.converted.test(status) || RE.convertedAr.test(status));
    const converted = convertedCell === true || !!convertedAt || (convertedCell !== false && statusConverted);
    const failed = !converted && !!status && RE.failed.test(status);
    const hasSalesOrder = converted || !!salesOrder || !!salesOrderAt || (!!status && RE.salesOrder.test(status));
    const statusNoResponse = !!status && RE.noResponse.test(status);
    const responded = hasSalesOrder
      || !!respondedAt
      || responseHours != null
      || (!!salesResponse && !isBlankish(salesResponse) && !RE.noResponse.test(salesResponse))
      || (!!status && RE.responded.test(status) && !statusNoResponse);
    const assigned = responded || !!assignedTo || !!assignedAt || (!!status && RE.assigned.test(status) && !/unassign|not\s*assign/i.test(status));

    const slaCell = colMap.sla != null ? classifySla(get("sla"), headerNorms[colMap.sla]) : null;
    let overSla;
    if (slaCell != null) overSla = slaCell;
    else if (responseHours != null) overSla = responseHours > config.slaHours;
    else if (assigned && !responded && !failed) {
      const start = assignedAt || date;
      overSla = !!start && (now - start) / 3600000 > config.slaHours;
    } else overSla = false;

    const raw = {};
    headers.forEach((h, i) => {
      const v = line[i];
      if (v === "" || v == null) return;
      raw[h] = v;
    });

    const rec = {
      _i: idx,
      id: getS("leadId"),
      date,
      day: dayKey(date),
      customer: getS("customer"),
      phone: getS("phone"),
      promoter: getS("promoter") || "Unspecified",
      model: getS("model") || "Unspecified",
      source: getS("source") || "Unspecified",
      status,
      salesResponse,
      assignedTo,
      assignedAt,
      respondedAt,
      responseHours,
      salesOrder,
      salesOrderAt,
      convertedAt,
      assigned,
      responded,
      hasSalesOrder,
      converted,
      failed,
      unassigned: !assigned && !failed,
      noResponse: assigned && !responded && !failed,
      overSla: !!overSla,
      raw,
    };
    rec.stage = stageLabel(rec);
    rec.statusLabel = status || rec.stage;
    return rec;
  }

  /**
   * Parse a GEC workbook (SheetJS) into a reusable dataset.
   * @returns {{ ok: boolean, fileName: string, sheetName: string, headerRow: number, headers: string[],
   *   mapping: Array<{ key: string, label: string, column: string|null, letter: string|null }>,
   *   records: object[], sheets: object[], warnings: string[], range: { from: string, to: string } }}
   */
  function parseWorkbook(workbook, opts) {
    const options = opts || {};
    const now = options.now instanceof Date ? options.now : new Date();
    const names = (workbook && workbook.SheetNames) || [];
    const analysed = names
      .filter((n) => workbook.Sheets[n])
      .map((n) => analyseSheet(n, workbook.Sheets[n]));
    const best = analysed.slice().sort((a, b) => b.sheetScore - a.sheetScore)[0];
    const empty = {
      ok: false, fileName: options.fileName || "", sheetName: "", headerRow: 0, headers: [],
      mapping: FIELDS.map((f) => ({ key: f.key, label: f.label, column: null, letter: null })),
      records: [], warnings: [], range: { from: "", to: "" },
      sheets: analysed.map((a) => ({ name: a.name, rows: a.matrix.length, fields: a.count })),
    };
    if (!best || best.headerIdx < 0 || best.count < 2) {
      empty.warnings.push("No lead table found — expected a header row with columns such as Date, Promoter, Model, Status.");
      return empty;
    }

    const headerLine = best.matrix[best.headerIdx] || [];
    const width = Math.max(headerLine.length, ...best.matrix.slice(best.headerIdx + 1, best.headerIdx + 50).map((r) => r.length));
    const headers = [];
    const seen = {};
    for (let i = 0; i < width; i += 1) {
      let h = str(headerLine[i]) || `Column ${colLetter(i)}`;
      if (seen[h]) { seen[h] += 1; h = `${h} (${seen[h]})`; } else seen[h] = 1;
      headers.push(h);
    }
    const headerNorms = headers.map(normHeader);
    const colMap = { ...best.map };
    const warnings = [];
    if (colMap.leadDate == null) {
      const claimed = new Set(Object.values(colMap));
      const c = detectDateColumn(best.matrix, best.headerIdx, claimed);
      if (c >= 0) {
        colMap.leadDate = c;
        warnings.push(`Lead date taken from “${headers[c]}” (detected by values).`);
      } else warnings.push("No lead date column found — trend chart and date filter are disabled.");
    }
    ["promoter", "model", "status"].forEach((k) => {
      if (colMap[k] == null) warnings.push(`No ${FIELD_BY_KEY[k].label.toLowerCase()} column found.`);
    });
    if (colMap.responseTime == null && colMap.responseDate == null) {
      warnings.push("No response time / response date column — Avg response time and SLA use status only.");
    }

    const records = [];
    for (let r = best.headerIdx + 1; r < best.matrix.length; r += 1) {
      const line = best.matrix[r] || [];
      const mappedCells = Object.values(colMap).map((c) => line[c]);
      if (!mappedCells.some((v) => v !== "" && v != null)) continue;
      if (RE.total.test(str(line.find((v) => str(v)) || ""))) continue;
      records.push(buildRecord(line, records.length, colMap, headers, headerNorms, now));
    }

    const days = records.map((x) => x.day).filter(Boolean).sort();
    return {
      ok: records.length > 0,
      fileName: options.fileName || "",
      sheetName: best.name,
      headerRow: best.headerIdx + 1,
      headers,
      colMap,
      mapping: FIELDS.map((f) => ({
        key: f.key,
        label: f.label,
        column: colMap[f.key] != null ? headers[colMap[f.key]] : null,
        letter: colMap[f.key] != null ? colLetter(colMap[f.key]) : null,
      })),
      records,
      warnings,
      range: { from: days[0] || "", to: days[days.length - 1] || "" },
      sheets: analysed.map((a) => ({ name: a.name, rows: a.matrix.length, fields: a.count })),
      slaHours: config.slaHours,
    };
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

  // ---------- Metrics ----------

  function applyFilters(records, f) {
    const filters = f || {};
    return records.filter((r) => {
      if (filters.from && (!r.day || r.day < filters.from)) return false;
      if (filters.to && (!r.day || r.day > filters.to)) return false;
      if (filters.promoter && r.promoter !== filters.promoter) return false;
      if (filters.model && r.model !== filters.model) return false;
      if (filters.source && r.source !== filters.source) return false;
      if (filters.status && r.statusLabel !== filters.status) return false;
      return true;
    });
  }

  function rankBy(records, key) {
    const map = new Map();
    records.forEach((r) => {
      const k = r[key] || "Unspecified";
      const e = map.get(k) || { name: k, leads: 0, assigned: 0, salesOrders: 0, converted: 0 };
      e.leads += 1;
      if (r.assigned) e.assigned += 1;
      if (r.hasSalesOrder) e.salesOrders += 1;
      if (r.converted) e.converted += 1;
      map.set(k, e);
    });
    return [...map.values()]
      .map((e) => ({ ...e, rate: e.leads ? e.converted / e.leads : 0 }))
      .sort((a, b) => b.leads - a.leads || b.converted - a.converted || a.name.localeCompare(b.name));
  }

  function optionList(records, key) {
    const counts = new Map();
    records.forEach((r) => {
      const v = r[key];
      if (!v) return;
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v]) => v);
  }

  function buildTrend(records, from, to) {
    const start = parseDayKey(from);
    const end = parseDayKey(to);
    if (!start || !end || end < start) return { unit: "day", buckets: [] };
    const spanDays = Math.round((end - start) / 86400000) + 1;
    const unit = spanDays > config.maxDailyBuckets ? "week" : "day";
    const buckets = [];
    const index = new Map();
    const cur = new Date(start);
    if (unit === "week") cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
    while (cur <= end) {
      const key = dayKey(cur);
      const b = { key, date: new Date(cur), leads: 0, salesOrders: 0, converted: 0, days: [] };
      buckets.push(b);
      const step = unit === "week" ? 7 : 1;
      for (let i = 0; i < step; i += 1) {
        const d = new Date(cur);
        d.setDate(d.getDate() + i);
        index.set(dayKey(d), b);
        b.days.push(dayKey(d));
      }
      cur.setDate(cur.getDate() + step);
    }
    records.forEach((r) => {
      const b = index.get(r.day);
      if (!b) return;
      b.leads += 1;
      if (r.hasSalesOrder) b.salesOrders += 1;
      if (r.converted) b.converted += 1;
    });
    return { unit, buckets };
  }

  /**
   * @param {object} dataset result of parseWorkbook
   * @param {{ from?: string, to?: string, promoter?: string, model?: string, source?: string, status?: string }} filters
   */
  function compute(dataset, filters) {
    const all = (dataset && dataset.records) || [];
    const f = filters || {};
    const rows = applyFilters(all, f);
    const count = (pred) => rows.reduce((s, r) => s + (pred(r) ? 1 : 0), 0);
    const total = rows.length;
    const assigned = count((r) => r.assigned);
    const responded = count((r) => r.responded);
    const salesOrders = count((r) => r.hasSalesOrder);
    const converted = count((r) => r.converted);
    const timed = rows.filter((r) => r.responseHours != null);
    const avgResponseHours = timed.length ? timed.reduce((s, r) => s + r.responseHours, 0) / timed.length : null;
    const pct = (a, b) => (b ? a / b : 0);

    const from = f.from || (dataset && dataset.range.from) || "";
    const to = f.to || (dataset && dataset.range.to) || "";

    return {
      rows,
      totalAll: all.length,
      kpis: {
        total,
        assigned,
        responded,
        salesOrders,
        converted,
        conversionRate: pct(converted, total),
        avgResponseHours,
        timedCount: timed.length,
        unassigned: count((r) => r.unassigned),
        overSla: count((r) => r.overSla),
        noResponse: count((r) => r.noResponse),
        failed: count((r) => r.failed),
      },
      funnel: [
        { key: "leads", label: "Leads", count: total },
        { key: "assigned", label: "Assigned", count: assigned },
        { key: "responded", label: "Sales Response", count: responded },
        { key: "salesOrders", label: "Sales Order", count: salesOrders },
        { key: "converted", label: "Converted", count: converted },
      ].map((s, i, arr) => ({
        ...s,
        pctOfLeads: pct(s.count, total),
        pctOfPrev: i === 0 ? 1 : pct(s.count, arr[i - 1].count),
      })),
      trend: buildTrend(rows, from, to),
      promoters: rankBy(rows, "promoter"),
      models: rankBy(rows, "model"),
      range: { from, to },
    };
  }

  function filterOptions(dataset) {
    const all = (dataset && dataset.records) || [];
    return {
      promoters: optionList(all, "promoter"),
      models: optionList(all, "model"),
      sources: optionList(all, "source"),
      statuses: optionList(all, "statusLabel"),
    };
  }

  /** Record predicates used by KPI / funnel / alert drill-downs. */
  const PREDICATES = {
    total: () => true,
    leads: () => true,
    assigned: (r) => r.assigned,
    responded: (r) => r.responded,
    salesOrders: (r) => r.hasSalesOrder,
    converted: (r) => r.converted,
    conversionRate: (r) => r.converted,
    avgResponseHours: (r) => r.responseHours != null,
    unassigned: (r) => r.unassigned,
    overSla: (r) => r.overSla,
    noResponse: (r) => r.noResponse,
    failed: (r) => r.failed,
  };

  global.GecData = {
    config,
    FIELDS,
    parseWorkbook,
    compute,
    filterOptions,
    applyFilters,
    PREDICATES,
    parseAnyDate,
    parseDurationHours,
    dayKey,
  };
})(typeof window !== "undefined" ? window : globalThis);
