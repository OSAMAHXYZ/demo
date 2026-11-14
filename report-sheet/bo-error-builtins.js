/** Built-in BO Errors dashboard checks — listed in Admin so they can be reviewed and edited. */
(function (global) {
  const DEFAULTS = [
    {
      id: "dup_col_f",
      name: "Duplicate Back Order Number",
      how: "The same Back Order Number (column F) appears more than once. Employee sales type is skipped.",
      severity: "critical",
      kind: "dup_col_f",
      fields: ["severity"],
    },
    {
      id: "missing_col_j",
      name: "Paid amount missing on CAMRY, LC300, LC70, RAV4, HILUX DC, or HILUX SC",
      how: "Column J is blank or 0 for these products. ALJUF and Bank are skipped.",
      severity: "critical",
      kind: "missing_col_j",
      products: ["CAMRY", "LC300", "LC70", "RAV4", "RAV 4", "HILUX DC", "HILUX SC"],
      fields: ["severity", "products"],
    },
    {
      id: "paid_other_product",
      name: "Paid amount filled on another product",
      how: "Column J has a paid amount on a product that is not CAMRY / LC300 / LC70 / RAV4 / HILUX DC / HILUX SC. ALJUF and Bank are skipped.",
      severity: "critical",
      kind: "paid_other_product",
      products: ["CAMRY", "LC300", "LC70", "RAV4", "RAV 4", "HILUX DC", "HILUX SC"],
      fields: ["severity", "products"],
    },
    {
      id: "sales_type_not_confirmed",
      name: "ALJUF or Bank is not Confirmed",
      how: "Confirm Flag (column H) is not Confirmed when Sales Type is ALJUF or Bank.",
      severity: "critical",
      kind: "confirm",
      fields: ["severity"],
    },
    {
      id: "rav4_nop_040",
      name: "RAV4 exterior color is 040",
      how: "RAV4 Exterior Color 1–3 (columns N/O/P) is 040.",
      severity: "critical",
      kind: "color",
      products: ["RAV4", "RAV 4"],
      values: ["040"],
      colorGroup: "nop",
      fields: ["severity", "products", "values"],
    },
    {
      id: "rav4_sh_forbidden_color",
      name: "RAV4 SH forbidden exterior color",
      how: "RAV4 suffix SH with a forbidden exterior color. Suggested correction is written to column AC.",
      severity: "critical",
      kind: "color_sfx",
      products: ["RAV4", "RAV 4"],
      suffixes: ["SH"],
      values: ["089", "1L6", "1M6", "4V8", "8X8", "6X7", "3T3"],
      corrections: { "089": "2VP", "1L6": "M22", "4V8": "2SQ", "8X8": "M40" },
      colorGroup: "nop",
      fields: ["severity", "values"],
    },
    {
      id: "rav4_other_sfx_qrs_20",
      name: "RAV4 interior color is 20",
      how: "RAV4 that is not SH or VH, Interior Color 1–3 (columns Q/R/S) is 20.",
      severity: "critical",
      kind: "color_exclude_sfx",
      products: ["RAV4", "RAV 4"],
      excludeSuffixes: ["SH", "VH"],
      values: ["20"],
      colorGroup: "qrs",
      fields: ["severity", "values"],
    },
    {
      id: "dup_ship_to",
      name: "Duplicate Ship to Party",
      how: "The same Ship to Party appears more than once. Employee sales type is skipped.",
      severity: "critical",
      kind: "dup_ship_to",
      fields: ["severity"],
    },
    {
      id: "col_ab_aljre_or_blank",
      name: "Column AB blank or ALJRe",
      how: "CRM Lead Source (column AB) is blank or ALJRe. Rows where column A is EB2C are skipped. Applies to every sales type, including Employee.",
      severity: "critical",
      kind: "blank_or_value",
      values: ["ALJRe"],
      exceptColA: ["EB2C"],
      includeEmployee: true,
      fields: ["severity", "values"],
    },
    {
      id: "camry_nop_00_20",
      name: "CAMRY exterior color is 00 or 20",
      how: "CAMRY Exterior Color 1–3 (columns N/O/P) is 00 or 20.",
      severity: "critical",
      kind: "color",
      products: ["CAMRY"],
      values: ["00", "20"],
      colorGroup: "nop",
      fields: ["severity", "products", "values"],
    },
    {
      id: "lc300_nop_00_20",
      name: "LC300 exterior color is 00 or 20",
      how: "LC300 Exterior Color 1–3 (columns N/O/P) is 00 or 20.",
      severity: "critical",
      kind: "color",
      products: ["LC300"],
      values: ["00", "20"],
      colorGroup: "nop",
      fields: ["severity", "products", "values"],
    },
    {
      id: "veloz_nop_s28",
      name: "VELOZ exterior color is S28 or 3Q3",
      how: "VELOZ Exterior Color 1–3 (columns N/O/P) is S28 or 3Q3.",
      severity: "critical",
      kind: "color",
      products: ["VELOZ"],
      values: ["S28", "3Q3"],
      colorGroup: "nop",
      fields: ["severity", "products", "values"],
    },
    {
      id: "crown_qrs_20",
      name: "CROWN interior color is 20",
      how: "CROWN Interior Color 1–3 (columns Q/R/S) is 20.",
      severity: "critical",
      kind: "color",
      products: ["CROWN"],
      values: ["20"],
      colorGroup: "qrs",
      fields: ["severity", "products", "values"],
    },
    {
      id: "yaris_qrs_20",
      name: "YARIS interior color is 20",
      how: "YARIS Interior Color 1–3 (columns Q/R/S) is 20.",
      severity: "critical",
      kind: "color",
      products: ["YARIS", "YARIS SD"],
      values: ["20"],
      colorGroup: "qrs",
      fields: ["severity", "products", "values"],
    },
    {
      id: "bad_model_year",
      name: "Model Year is 2027 (LC / FJ / URBAN / HILUX DC / HILUX SC)",
      how: "Model Year is 2027 only for LC, FJ, URBAN CRUISER, HILUX DC, and HILUX SC.",
      severity: "warn",
      kind: "year",
      products: ["LC", "FJ", "LC FJ", "URBAN CRUISER", "URBAN", "HILUX DC", "HILUX SC"],
      values: ["2027"],
      fields: ["severity", "products", "values"],
    },
    {
      id: "phone_empty",
      name: "Phone is empty",
      how: "The phone column is blank. Applies to every sales type, including Employee. The number is never shown.",
      severity: "warn",
      kind: "phone",
      includeEmployee: true,
      fields: ["severity"],
    },
  ];

  function cell(value) {
    return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  }

  function splitList(raw) {
    if (Array.isArray(raw)) return raw.map(cell).filter(Boolean);
    return cell(raw).split(/[\n,;|]/).map(cell).filter(Boolean);
  }

  function cleanSeverity(value) {
    return value === "warn" || value === "info" ? value : "critical";
  }

  function mergeOne(base, over) {
    const src = over && typeof over === "object" ? over : {};
    const next = {
      id: base.id,
      name: cell(src.name) || base.name,
      how: base.how,
      kind: base.kind,
      colorGroup: base.colorGroup || "",
      includeEmployee: !!base.includeEmployee,
      fields: (base.fields || []).slice(),
      active: src.active !== false,
      severity: cleanSeverity(src.severity != null ? src.severity : base.severity),
      products: splitList(src.products != null ? src.products : base.products).slice(0, 30),
      values: splitList(src.values != null ? src.values : base.values).slice(0, 40),
      suffixes: splitList(src.suffixes != null ? src.suffixes : base.suffixes).slice(0, 12),
      excludeSuffixes: splitList(src.excludeSuffixes != null ? src.excludeSuffixes : base.excludeSuffixes).slice(0, 12),
      exceptColA: splitList(src.exceptColA != null ? src.exceptColA : base.exceptColA).slice(0, 12),
      corrections: base.corrections ? Object.assign({}, base.corrections) : {},
    };
    return next;
  }

  function sanitize(input) {
    const list = Array.isArray(input) ? input : (input && Array.isArray(input.rules) ? input.rules : []);
    const map = {};
    list.forEach((item) => {
      if (item && item.id) map[item.id] = item;
    });
    return DEFAULTS.map((base) => mergeOne(base, map[base.id]));
  }

  function live(input) {
    return sanitize(input);
  }

  function byId(input) {
    const map = {};
    live(input).forEach((rule) => { map[rule.id] = rule; });
    return map;
  }

  function on(input, id) {
    const rule = byId(input)[id];
    return !!(rule && rule.active !== false);
  }

  function defaults() {
    return DEFAULTS.map((item) => mergeOne(item, null));
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function readSaved() {
    const Store = global.ReportSheetStore;
    if (Store && typeof Store.readBoeBuiltins === "function") return Store.readBoeBuiltins();
    return null;
  }

  function mountAdmin(host) {
    if (!host || host.dataset.ready === "1") return;
    host.dataset.ready = "1";
    let draft = live(readSaved());
    let notice = "";
    let busy = false;

    function fieldHtml(rule, key, label, placeholder) {
      if ((rule.fields || []).indexOf(key) < 0) return "";
      const value = key === "severity" ? rule.severity : (rule[key] || []).join(", ");
      if (key === "severity") {
        return `<label><span>${esc(label)}</span><select data-boe-field="${esc(rule.id)}" data-key="severity">
          <option value="critical"${rule.severity === "critical" ? " selected" : ""}>Critical</option>
          <option value="warn"${rule.severity === "warn" ? " selected" : ""}>Warning</option>
          <option value="info"${rule.severity === "info" ? " selected" : ""}>Info</option>
        </select></label>`;
      }
      return `<label><span>${esc(label)}</span><input data-boe-field="${esc(rule.id)}" data-key="${esc(key)}" value="${esc(value)}" placeholder="${esc(placeholder || "")}" /></label>`;
    }

    function render() {
      const onCount = draft.filter((rule) => rule.active !== false).length;
      host.innerHTML = `<div class="boe-built">
        <div class="boe-built-bar">
          <p>${onCount} of ${draft.length} checks are on. These are the BO Errors dashboard rules from the code. Turn one off or change its products and values, then save.</p>
          <div class="boe-built-actions">
            <button type="button" class="btn" id="boe-built-reset">Reset to code</button>
            <button type="button" class="btn-primary" id="boe-built-save">Save checks</button>
          </div>
        </div>
        <p class="boe-built-note" id="boe-built-note">${esc(notice)}</p>
        <div class="boe-built-list">${draft.map((rule) => `<article class="boe-built-row${rule.active === false ? " is-off" : ""}" data-id="${esc(rule.id)}">
          <label class="boe-built-on"><input type="checkbox" data-boe-on="${esc(rule.id)}"${rule.active === false ? "" : " checked"} /> On</label>
          <div class="boe-built-main">
            <b>${esc(rule.name)}</b>
            <span>${esc(rule.how)}</span>
            <div class="boe-built-fields">
              ${fieldHtml(rule, "products", "Cars", "CAMRY, LC300")}
              ${fieldHtml(rule, "values", "Values to flag", "00, 20")}
              ${fieldHtml(rule, "severity", "Severity", "")}
            </div>
          </div>
        </article>`).join("")}</div>
      </div>`;
      bind();
    }

    function readForm() {
      draft = draft.map((rule) => {
        const onBox = host.querySelector(`[data-boe-on="${rule.id}"]`);
        const next = Object.assign({}, rule, { active: !!(onBox && onBox.checked) });
        host.querySelectorAll(`[data-boe-field="${rule.id}"]`).forEach((input) => {
          const key = input.getAttribute("data-key");
          if (key === "severity") next.severity = cleanSeverity(input.value);
          else if (key === "products" || key === "values") next[key] = splitList(input.value);
        });
        return next;
      });
    }

    function bind() {
      host.querySelectorAll("[data-boe-on]").forEach((box) => {
        box.addEventListener("change", () => {
          const row = box.closest(".boe-built-row");
          if (row) row.classList.toggle("is-off", !box.checked);
        });
      });
      const reset = host.querySelector("#boe-built-reset");
      if (reset) reset.addEventListener("click", () => {
        draft = defaults();
        notice = "Showing the original code checks. Save to apply.";
        render();
      });
      const save = host.querySelector("#boe-built-save");
      if (save) save.addEventListener("click", () => saveNow());
    }

    async function saveNow() {
      if (busy) return;
      readForm();
      const Store = global.ReportSheetStore;
      const note = host.querySelector("#boe-built-note");
      busy = true;
      if (note) note.textContent = "Saving…";
      try {
        draft = live(draft);
        if (Store && typeof Store.saveBoeBuiltinsToServer === "function") {
          await Store.saveBoeBuiltinsToServer(draft);
        } else if (Store && typeof Store.writeBoeBuiltins === "function") {
          Store.writeBoeBuiltins(draft);
        }
        notice = "Saved. The BO Errors dashboard now uses these checks.";
        if (Store && typeof Store.notifyBoeBuiltins === "function") Store.notifyBoeBuiltins();
      } catch (err) {
        notice = err.message || "Could not save.";
      }
      busy = false;
      render();
    }

    render();
  }

  global.BoeBuiltins = {
    DEFAULTS,
    defaults,
    live,
    byId,
    on,
    sanitize,
    mountAdmin,
  };
})(typeof window !== "undefined" ? window : globalThis);
