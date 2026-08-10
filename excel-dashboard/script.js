/**
 * Excel Dashboard — client-side analyzer for exactly three uploaded workbooks.
 * Uses only data from the user's files (no mock/sample rows).
 */
(function () {
  "use strict";

  const ACCEPT = ".xlsx,.xls,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
  const MAX_CHART_CATEGORIES = 12;
  const MAX_TABLE_RENDER = 5000;

  /** @type {Record<number, { file: File|null, workbook: object|null, name: string, sheets: Record<string, SheetData> }>} */
  const slots = {
    1: emptySlot(),
    2: emptySlot(),
    3: emptySlot(),
  };

  /** Active sheet + UI state per section */
  const ui = {
    1: { sheet: null, search: "", filterCol: "", filterVal: "", sortCol: null, sortDir: 1, chartCat: null, chartNum: null },
    2: { sheet: null, search: "", sortCol: null, sortDir: 1, chart: null },
    3: { sheet: null, search: "", sortCol: null, sortDir: 1, chart: null },
  };

  /**
   * @typedef {{ headers: string[], rows: Record<string, unknown>[], numeric: string[], categorical: string[], rowCount: number }} SheetData
   */

  function emptySlot() {
    return { file: null, workbook: null, name: "", sheets: {} };
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
    if (on) setStatus("Analyzing…", "busy");
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
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }

  function isNumericValue(v) {
    if (typeof v === "number" && Number.isFinite(v)) return true;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v.replace(/,/g, "")))) return true;
    return false;
  }

  function toNumber(v) {
    if (typeof v === "number") return v;
    return Number(String(v).replace(/,/g, ""));
  }

  /** Detect file kind from name / MIME */
  function detectFileType(file) {
    const name = (file.name || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (name.endsWith(".csv") || type.includes("csv") || type === "text/plain") return "csv";
    if (name.endsWith(".xls") && !name.endsWith(".xlsx")) return "xls";
    if (name.endsWith(".xlsx") || type.includes("spreadsheet") || type.includes("excel")) return "xlsx";
    return "unknown";
  }

  function validateFile(file) {
    const kind = detectFileType(file);
    if (kind === "unknown") {
      return `Unsupported file “${file.name}”. Use .xlsx, .xls, or .csv.`;
    }
    return null;
  }

  /**
   * Parse workbook → sheet map with typed column analysis.
   * @returns {Record<string, SheetData>}
   */
  function workbookToSheets(workbook) {
    const out = {};
    workbook.SheetNames.forEach((sheetName) => {
      const ws = workbook.Sheets[sheetName];
      const matrix = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        defval: "",
        blankrows: false,
        raw: true,
      });
      if (!matrix.length) {
        out[sheetName] = { headers: [], rows: [], numeric: [], categorical: [], rowCount: 0 };
        return;
      }

      // First non-empty row as headers
      let headerIdx = 0;
      while (headerIdx < matrix.length && matrix[headerIdx].every((c) => cellToString(c).trim() === "")) {
        headerIdx += 1;
      }
      const headerRow = matrix[headerIdx] || [];
      const headers = headerRow.map((h, i) => {
        const label = cellToString(h).trim();
        return label || `Column ${i + 1}`;
      });

      // Deduplicate header names
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
        const obj = {};
        uniqueHeaders.forEach((h, i) => {
          obj[h] = line[i] != null ? line[i] : "";
        });
        rows.push(obj);
      }

      const numeric = [];
      const categorical = [];
      uniqueHeaders.forEach((h) => {
        let numCount = 0;
        let nonEmpty = 0;
        const sample = new Set();
        rows.forEach((row) => {
          const v = row[h];
          if (cellToString(v).trim() === "") return;
          nonEmpty += 1;
          if (isNumericValue(v)) numCount += 1;
          if (sample.size < 40) sample.add(cellToString(v));
        });
        if (nonEmpty > 0 && numCount / nonEmpty >= 0.7) numeric.push(h);
        else if (nonEmpty > 0) categorical.push(h);
      });

      out[sheetName] = {
        headers: uniqueHeaders,
        rows,
        numeric,
        categorical,
        rowCount: rows.length,
      };
    });
    return out;
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

  function renderUploadSlots() {
    const grid = $("#upload-grid");
    const labels = [
      { n: 1, title: "Main Dashboard source", blurb: "KPIs, dual charts, searchable table" },
      { n: 2, title: "Second Section source", blurb: "Summary metrics, chart, and table" },
      { n: 3, title: "Third Section source", blurb: "Summary metrics, chart, and table" },
    ];
    grid.innerHTML = labels
      .map(({ n, title, blurb }) => {
        const slot = slots[n];
        const has = !!slot.file;
        return `
        <article class="upload-card${has ? " has-file" : ""}" data-slot="${n}" tabindex="0">
          <span class="slot-label">File ${n}</span>
          <h3>${escapeHtml(title)}</h3>
          <p class="hint">${escapeHtml(blurb)}. Drop a file here or choose one.</p>
          ${
            has
              ? `<p class="file-name">${escapeHtml(slot.name)} · ${formatBytes(slot.file.size)} · ${detectFileType(slot.file).toUpperCase()}</p>`
              : `<p class="file-name">No file selected</p>`
          }
          <div class="upload-actions">
            <button type="button" class="btn btn-primary" data-choose="${n}">Choose file</button>
            <button type="button" class="btn" data-clear-slot="${n}" ${has ? "" : "disabled"}>Remove</button>
          </div>
          <input type="file" id="file-input-${n}" accept="${ACCEPT}" aria-label="Upload file ${n}" />
        </article>`;
      })
      .join("");
  }

  function updateActionButtons() {
    const ready = [1, 2, 3].every((n) => slots[n].file);
    $("#analyze-btn").disabled = !ready;
    $("#clear-btn").disabled = ![1, 2, 3].some((n) => slots[n].file);
    if (ready) setStatus("Ready to analyze", "ready");
    else if ([1, 2, 3].some((n) => slots[n].file)) setStatus("Waiting for all 3 files");
    else setStatus("Waiting for files");
  }

  function assignFile(slotNum, file) {
    const err = validateFile(file);
    if (err) {
      showError(err);
      return;
    }
    showError("");
    slots[slotNum] = { file, workbook: null, name: file.name, sheets: {} };
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
  }

  function clearSlot(slotNum) {
    slots[slotNum] = emptySlot();
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
  }

  function bindUploadCardEvents() {
    $$(".upload-card").forEach((card) => {
      const n = Number(card.dataset.slot);
      const input = $(`#file-input-${n}`);

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("is-drag");
      });
      card.addEventListener("dragleave", () => card.classList.remove("is-drag"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("is-drag");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) assignFile(n, file);
      });

      card.querySelector(`[data-choose="${n}"]`).addEventListener("click", () => input.click());
      card.querySelector(`[data-clear-slot="${n}"]`).addEventListener("click", () => clearSlot(n));
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (file) assignFile(n, file);
        input.value = "";
      });
    });
  }

  function computeKpis(sheet) {
    const kpis = [
      { label: "Rows", value: formatNumber(sheet.rowCount), sub: "data rows" },
      { label: "Columns", value: formatNumber(sheet.headers.length), sub: "fields" },
    ];
    sheet.numeric.slice(0, 2).forEach((col) => {
      let sum = 0;
      let count = 0;
      sheet.rows.forEach((row) => {
        if (!isNumericValue(row[col])) return;
        sum += toNumber(row[col]);
        count += 1;
      });
      kpis.push({
        label: col,
        value: formatNumber(sum),
        sub: count ? `sum · avg ${formatNumber(sum / count)}` : "no values",
      });
    });
    while (kpis.length < 4) {
      const cat = sheet.categorical[kpis.length - 2];
      if (!cat) {
        kpis.push({ label: "—", value: "—", sub: "no extra metric" });
        break;
      }
      const uniq = new Set(sheet.rows.map((r) => cellToString(r[cat])).filter(Boolean));
      kpis.push({ label: cat, value: formatNumber(uniq.size), sub: "unique values" });
    }
    return kpis.slice(0, 4);
  }

  function renderKpis(containerId, sheet) {
    const el = $(containerId);
    el.innerHTML = computeKpis(sheet)
      .map(
        (k) => `
      <article class="kpi">
        <p class="label">${escapeHtml(k.label)}</p>
        <p class="value">${escapeHtml(k.value)}</p>
        <p class="sub">${escapeHtml(k.sub)}</p>
      </article>`
      )
      .join("");
  }

  function topCategories(sheet, col, limit = MAX_CHART_CATEGORIES) {
    const counts = new Map();
    sheet.rows.forEach((row) => {
      const key = cellToString(row[col]).trim() || "(blank)";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  function destroyChart(ref) {
    if (ref && typeof ref.destroy === "function") ref.destroy();
  }

  function makeBarChart(canvas, labels, values, label) {
    if (!canvas || typeof Chart === "undefined") return null;
    return new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label,
            data: values,
            backgroundColor: "rgba(15, 76, 129, 0.75)",
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: { ticks: { maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
          y: { beginAtZero: true },
        },
      },
    });
  }

  function makeDoughnut(canvas, labels, values, label) {
    if (!canvas || typeof Chart === "undefined") return null;
    const palette = ["#0f4c81", "#c45c26", "#0f766e", "#7c3aed", "#b45309", "#0369a1", "#be123c", "#15803d", "#334155", "#0891b2", "#a16207", "#4f46e5"];
    return new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            label,
            data: values,
            backgroundColor: labels.map((_, i) => palette[i % palette.length]),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } },
        },
      },
    });
  }

  function renderSectionCharts(sectionNum, sheet) {
    if (sectionNum === 1) {
      destroyChart(ui[1].chartCat);
      destroyChart(ui[1].chartNum);
      ui[1].chartCat = null;
      ui[1].chartNum = null;

      const catCol = sheet.categorical[0];
      if (catCol) {
        const pairs = topCategories(sheet, catCol);
        ui[1].chartCat = makeDoughnut(
          resetChartWrap("s1-chart-cat"),
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
          catCol
        );
      } else {
        clearCanvasMessage("s1-chart-cat", "No categorical column to chart");
      }

      const numCol = sheet.numeric[0];
      const groupCol = sheet.categorical[0] || sheet.headers[0];
      if (numCol && groupCol) {
        const sums = new Map();
        sheet.rows.forEach((row) => {
          const g = cellToString(row[groupCol]).trim() || "(blank)";
          if (!isNumericValue(row[numCol])) return;
          sums.set(g, (sums.get(g) || 0) + toNumber(row[numCol]));
        });
        const pairs = Array.from(sums.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, MAX_CHART_CATEGORIES);
        ui[1].chartNum = makeBarChart(
          resetChartWrap("s1-chart-num"),
          pairs.map((p) => p[0]),
          pairs.map((p) => p[1]),
          `${numCol} by ${groupCol}`
        );
      } else if (numCol) {
        const vals = sheet.rows
          .map((r) => (isNumericValue(r[numCol]) ? toNumber(r[numCol]) : null))
          .filter((v) => v != null)
          .slice(0, 40);
        ui[1].chartNum = makeBarChart(
          resetChartWrap("s1-chart-num"),
          vals.map((_, i) => String(i + 1)),
          vals,
          numCol
        );
      } else {
        clearCanvasMessage("s1-chart-num", "No numeric column to chart");
      }
      return;
    }

    const key = sectionNum;
    destroyChart(ui[key].chart);
    ui[key].chart = null;
    const catCol = sheet.categorical[0];
    const numCol = sheet.numeric[0];
    if (catCol) {
      const pairs = topCategories(sheet, catCol);
      ui[key].chart = makeBarChart(
        resetChartWrap(`s${key}-chart`),
        pairs.map((p) => p[0]),
        pairs.map((p) => p[1]),
        catCol
      );
    } else if (numCol) {
      const vals = sheet.rows
        .map((r) => (isNumericValue(r[numCol]) ? toNumber(r[numCol]) : null))
        .filter((v) => v != null)
        .slice(0, 40);
      ui[key].chart = makeBarChart(
        resetChartWrap(`s${key}-chart`),
        vals.map((_, i) => String(i + 1)),
        vals,
        numCol
      );
    } else {
      clearCanvasMessage(`s${key}-chart`, "No chartable columns detected");
    }
  }

  function resetChartWrap(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const parent = canvas.parentElement;
    if (!parent) return null;
    parent.innerHTML = `<canvas id="${canvasId}" aria-label="Chart"></canvas>`;
    return document.getElementById(canvasId);
  }

  function clearCanvasMessage(canvasId, message) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const parent = canvas.parentElement;
    parent.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div><canvas id="${escapeHtml(canvasId)}" hidden></canvas>`;
  }

  function getFilteredRows(sectionNum, sheet) {
    const state = ui[sectionNum];
    let rows = sheet.rows.slice();
    const q = (state.search || "").trim().toLowerCase();
    if (q) {
      rows = rows.filter((row) =>
        sheet.headers.some((h) => cellToString(row[h]).toLowerCase().includes(q))
      );
    }
    if (sectionNum === 1 && state.filterCol && state.filterVal.trim()) {
      const fv = state.filterVal.trim().toLowerCase();
      rows = rows.filter((row) => cellToString(row[state.filterCol]).toLowerCase().includes(fv));
    }
    if (state.sortCol) {
      const col = state.sortCol;
      const dir = state.sortDir;
      rows.sort((a, b) => {
        const av = a[col];
        const bv = b[col];
        if (isNumericValue(av) && isNumericValue(bv)) return (toNumber(av) - toNumber(bv)) * dir;
        return cellToString(av).localeCompare(cellToString(bv), undefined, { sensitivity: "base", numeric: true }) * dir;
      });
    }
    return rows;
  }

  function renderTable(sectionNum, sheet) {
    const wrap = $(`#s${sectionNum}-table-wrap`);
    const foot = $(`#s${sectionNum}-table-foot`);
    const filtered = getFilteredRows(sectionNum, sheet);
    const shown = filtered.slice(0, MAX_TABLE_RENDER);
    const state = ui[sectionNum];

    if (!sheet.headers.length) {
      wrap.innerHTML = `<div class="empty-state">This sheet has no columns.</div>`;
      foot.textContent = "";
      return;
    }

    const head = sheet.headers
      .map((h) => {
        const ind = state.sortCol === h ? (state.sortDir === 1 ? "▲" : "▼") : "";
        return `<th scope="col" tabindex="0" data-sort="${escapeHtml(h)}">${escapeHtml(h)}<span class="sort-ind">${ind}</span></th>`;
      })
      .join("");

    const body = shown
      .map((row) => {
        const cells = sheet.headers
          .map((h) => {
            const text = cellToString(row[h]);
            return `<td class="${text ? "" : "empty-cell"}" title="${escapeHtml(text)}">${text ? escapeHtml(text) : "—"}</td>`;
          })
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");

    wrap.innerHTML = `
      <table class="data-table" aria-label="File ${sectionNum} data">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${sheet.headers.length}">No rows match the current filters.</td></tr>`}</tbody>
      </table>`;

    foot.textContent =
      filtered.length > MAX_TABLE_RENDER
        ? `Showing ${formatNumber(MAX_TABLE_RENDER)} of ${formatNumber(filtered.length)} filtered rows (${formatNumber(sheet.rowCount)} total).`
        : `Showing ${formatNumber(filtered.length)} of ${formatNumber(sheet.rowCount)} rows.`;

    $$("th[data-sort]", wrap).forEach((th) => {
      const activate = () => {
        const col = th.getAttribute("data-sort");
        if (state.sortCol === col) state.sortDir *= -1;
        else {
          state.sortCol = col;
          state.sortDir = 1;
        }
        renderTable(sectionNum, sheet);
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

  function populateSheetSelect(sectionNum) {
    const select = $(`#s${sectionNum}-sheet`);
    const names = Object.keys(slots[sectionNum].sheets);
    select.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    ui[sectionNum].sheet = names[0] || null;
    if (ui[sectionNum].sheet) select.value = ui[sectionNum].sheet;
  }

  function activeSheet(sectionNum) {
    const name = ui[sectionNum].sheet;
    return name ? slots[sectionNum].sheets[name] : null;
  }

  function renderSection(sectionNum) {
    const sheet = activeSheet(sectionNum);
    const section = $(`#section-${sectionNum}`);
    if (!sheet) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const file = slots[sectionNum];
    $(`#s${sectionNum}-heading`).textContent =
      sectionNum === 1 ? file.name || "Main Dashboard" : file.name || `Section ${sectionNum}`;
    $(`#s${sectionNum}-meta`).textContent = `${detectFileType(file.file).toUpperCase()} · ${formatBytes(file.file.size)} · sheet “${ui[sectionNum].sheet}” · ${formatNumber(sheet.rowCount)} rows × ${formatNumber(sheet.headers.length)} cols`;

    renderKpis(`#s${sectionNum}-kpis`, sheet);
    renderSectionCharts(sectionNum, sheet);

    if (sectionNum === 1) {
      const filterCol = $("#s1-filter-col");
      filterCol.innerHTML =
        `<option value="">All columns</option>` +
        sheet.headers.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join("");
      filterCol.value = ui[1].filterCol || "";
    }

    renderTable(sectionNum, sheet);
  }

  function analyzeRelationships() {
    const body = $("#relations-body");
    const section = $("#relations");
    const loaded = [1, 2, 3].filter((n) => Object.keys(slots[n].sheets).length);
    if (loaded.length < 2) {
      section.hidden = true;
      return;
    }
    section.hidden = false;

    const headerSets = loaded.map((n) => {
      const sheetName = Object.keys(slots[n].sheets)[0];
      const sheet = slots[n].sheets[sheetName];
      return { n, sheetName, headers: new Set(sheet.headers.map((h) => h.toLowerCase())), raw: sheet.headers, sheet };
    });

    const cards = [];

    // Shared column names
    const sharedAll = [...headerSets[0].headers].filter((h) => headerSets.every((s) => s.headers.has(h)));
    cards.push(`
      <article class="rel-card">
        <h3>Shared column names</h3>
        <p>${
          sharedAll.length
            ? `Found ${sharedAll.length} column name(s) present across compared sheets.`
            : "No identical column names across all loaded files."
        }</p>
        <div class="chip-row">${
          sharedAll.length
            ? sharedAll.map((h) => `<span class="chip shared">${escapeHtml(h)}</span>`).join("")
            : `<span class="chip">none</span>`
        }</div>
      </article>`);

    // Pairwise overlaps
    for (let i = 0; i < headerSets.length; i += 1) {
      for (let j = i + 1; j < headerSets.length; j += 1) {
        const a = headerSets[i];
        const b = headerSets[j];
        const shared = [...a.headers].filter((h) => b.headers.has(h));
        let overlapNote = "No overlapping values checked (no shared columns).";
        if (shared.length) {
          const colA = a.raw.find((h) => h.toLowerCase() === shared[0]);
          const colB = b.raw.find((h) => h.toLowerCase() === shared[0]);
          const setA = new Set(a.sheet.rows.map((r) => cellToString(r[colA]).trim()).filter(Boolean));
          const setB = new Set(b.sheet.rows.map((r) => cellToString(r[colB]).trim()).filter(Boolean));
          let hit = 0;
          setA.forEach((v) => {
            if (setB.has(v)) hit += 1;
          });
          overlapNote = `On “${colA}”: ${formatNumber(hit)} overlapping value(s) between File ${a.n} (${formatNumber(setA.size)} unique) and File ${b.n} (${formatNumber(setB.size)} unique).`;
        }
        cards.push(`
          <article class="rel-card">
            <h3>File ${a.n} ↔ File ${b.n}</h3>
            <p>Compared first sheets “${escapeHtml(a.sheetName)}” and “${escapeHtml(b.sheetName)}”.</p>
            <ul>
              <li>Shared headers: ${shared.length ? shared.map((h) => escapeHtml(h)).join(", ") : "none"}</li>
              <li>${escapeHtml(overlapNote)}</li>
            </ul>
          </article>`);
      }
    }

    // Per-file inventory
    loaded.forEach((n) => {
      const sheetNames = Object.keys(slots[n].sheets);
      cards.push(`
        <article class="rel-card">
          <h3>File ${n} inventory — ${escapeHtml(slots[n].name)}</h3>
          <ul>
            ${sheetNames
              .map((sn) => {
                const s = slots[n].sheets[sn];
                return `<li>Sheet “${escapeHtml(sn)}”: ${formatNumber(s.rowCount)} rows, ${formatNumber(s.headers.length)} columns (${formatNumber(s.numeric.length)} numeric, ${formatNumber(s.categorical.length)} text)</li>`;
              })
              .join("")}
          </ul>
        </article>`);
    });

    body.innerHTML = cards.join("");
  }

  async function analyzeAll() {
    if (typeof XLSX === "undefined") {
      showError("SheetJS failed to load. Check your network connection and reload.");
      return;
    }
    showError("");
    setLoading(true, "Reading and analyzing workbooks…");
    $("#analyze-btn").disabled = true;

    try {
      for (const n of [1, 2, 3]) {
        setLoading(true, `Parsing File ${n}: ${slots[n].name}…`);
        // Yield so the loading UI can paint
        await new Promise((r) => setTimeout(r, 20));
        const wb = await readFileToWorkbook(slots[n].file);
        slots[n].workbook = wb;
        slots[n].sheets = workbookToSheets(wb);
        if (!Object.keys(slots[n].sheets).length) {
          throw new Error(`File ${n} (“${slots[n].name}”) has no readable sheets.`);
        }
      }

      [1, 2, 3].forEach((n) => {
        ui[n].search = "";
        ui[n].sortCol = null;
        ui[n].sortDir = 1;
        if (n === 1) {
          ui[1].filterCol = "";
          ui[1].filterVal = "";
          $("#s1-search").value = "";
          $("#s1-filter-val").value = "";
        } else {
          $(`#s${n}-search`).value = "";
        }
        populateSheetSelect(n);
        renderSection(n);
      });

      analyzeRelationships();
      setStatus("Dashboard ready", "ready");
      $("#page-sub").textContent = `${slots[1].name} · ${slots[2].name} · ${slots[3].name}`;
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
    [1, 2, 3].forEach((n) => {
      destroyChart(ui[n].chart);
      destroyChart(ui[n].chartCat);
      destroyChart(ui[n].chartNum);
      slots[n] = emptySlot();
      $(`#section-${n}`).hidden = true;
    });
    $("#relations").hidden = true;
    $("#page-sub").textContent = "Upload three Excel files to populate KPIs, charts, and tables";
    showError("");
    renderUploadSlots();
    updateActionButtons();
    bindUploadCardEvents();
    setStatus("Waiting for files");
  }

  function bindGlobal() {
    $("#analyze-btn").addEventListener("click", analyzeAll);
    $("#clear-btn").addEventListener("click", clearAll);

    $("#s1-sheet").addEventListener("change", (e) => {
      ui[1].sheet = e.target.value;
      renderSection(1);
    });
    $("#s2-sheet").addEventListener("change", (e) => {
      ui[2].sheet = e.target.value;
      renderSection(2);
    });
    $("#s3-sheet").addEventListener("change", (e) => {
      ui[3].sheet = e.target.value;
      renderSection(3);
    });

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
        const sheet = activeSheet(1);
        if (sheet) renderTable(1, sheet);
      }, 150)
    );
    $("#s1-filter-col").addEventListener("change", (e) => {
      ui[1].filterCol = e.target.value;
      const sheet = activeSheet(1);
      if (sheet) renderTable(1, sheet);
    });
    $("#s1-filter-val").addEventListener(
      "input",
      debounce((e) => {
        ui[1].filterVal = e.target.value;
        const sheet = activeSheet(1);
        if (sheet) renderTable(1, sheet);
      }, 150)
    );
    $("#s2-search").addEventListener(
      "input",
      debounce((e) => {
        ui[2].search = e.target.value;
        const sheet = activeSheet(2);
        if (sheet) renderTable(2, sheet);
      }, 150)
    );
    $("#s3-search").addEventListener(
      "input",
      debounce((e) => {
        ui[3].search = e.target.value;
        const sheet = activeSheet(3);
        if (sheet) renderTable(3, sheet);
      }, 150)
    );

    // Nav active state
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
    ["upload", "section-1", "section-2", "section-3", "relations"].forEach((id) => {
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
