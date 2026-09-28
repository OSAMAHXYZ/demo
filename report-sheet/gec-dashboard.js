/**
 * GEC Control Center · one-screen executive dashboard (presentation only — rules live in gec-data.js).
 * Fixed 100vh layout, no page scroll; detail lives in modals (the only scrolling surface).
 * Usage: GecDashboard.render(hostEl, leadDataset, { visitors, lastUpdated, slaMinutes, onRefresh, onExit })
 */
(function (global) {
  const Data = () => global.GecData;
  const cfg = () => Data().config;

  const EMPTY_FILTERS = { from: "", to: "", promoter: "", model: "", source: "", status: "", consultant: "" };

  const state = {
    host: null,
    root: null,
    dataset: null,
    visitors: null,
    ctx: {},
    sig: "",
    filters: { ...EMPTY_FILTERS },
    metrics: null,
    promoterMetrics: null,
    consultantMetrics: null,
    view: { promoter: "period", consultant: "period", promoterMetric: "leads", consultantMetric: "leads" },
    chart: null,
    resizeObserver: null,
    resizeTimer: null,
    debug: /[?&]gecdebug=1\b/.test(global.location ? global.location.search : ""),
    modal: { views: [], active: 0, search: "", allCols: false, filterAction: null },
  };

  const fmtInt = new Intl.NumberFormat("en-US");
  const n = (v) => fmtInt.format(Math.round(Number(v) || 0));
  const nOrDash = (v) => (v == null ? "—" : n(v));
  const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ratio = (a, b) => (b ? a / b : null);

  function fmtDay(key, withYear) {
    const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "—";
    return `${m[3]} ${MONTHS[+m[2] - 1]}${withYear ? ` ${m[1]}` : ""}`;
  }
  function fmtDate(d, withTime) {
    if (!(d instanceof Date) || isNaN(d)) return "";
    const base = `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (!withTime || (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0)) return base;
    return `${base} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function minutesText(m) {
    if (m == null || !Number.isFinite(m)) return "";
    if (m < 60) return `${m.toFixed(m < 10 ? 1 : 0)} min`;
    if (m < 2880) return `${(m / 60).toFixed(1)} h`;
    return `${(m / 1440).toFixed(1)} d`;
  }
  function daysBetween(from, to) {
    const a = from ? new Date(`${from}T00:00:00`) : null;
    const b = to ? new Date(`${to}T00:00:00`) : null;
    if (!a || !b || isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  const COLORS = {
    visitors: "var(--gec-visit)", total: "var(--gec-leads)", responded: "var(--gec-resp)",
    salesOrders: "var(--gec-so)", converted: "var(--gec-conv)",
  };

  /** Main KPI order (management priority). Timing KPIs stay defined but hidden until config.SHOW_TIMING. */
  const KPIS = [
    { key: "visitors", label: "Total Visitors", color: "var(--gec-visit)" },
    { key: "total", label: "Total Leads", color: "var(--gec-leads)" },
    { key: "visitorToLead", label: "Visitor → Lead", color: "var(--gec-visit)" },
    { key: "responded", label: "Sales Response", color: "var(--gec-resp)" },
    { key: "salesOrders", label: "Sales Orders", color: "var(--gec-so)" },
    { key: "converted", label: "Converted", color: "var(--gec-conv)" },
    { key: "conversionRate", label: "Conversion Rate", color: "var(--gec-conv)" },
    { key: "unknownPromoter", label: "Unknown Promoter Leads", color: "var(--gec-warn)", alert: true },
    { key: "avgResponse", label: "Avg Response Time", color: "var(--gec-resp)", timing: true },
    { key: "overSla", label: "Over SLA", color: "var(--gec-bad)", timing: true, alert: true },
  ];
  const ALERTS = [
    { key: "unassigned", label: "Unassigned", color: "var(--gec-warn)" },
    { key: "noResponse", label: "No Response", color: "var(--gec-resp)" },
    { key: "noOrder", label: "NO ORDER", color: "var(--gec-so)" },
    { key: "unknownPromoter", label: "Unknown Promoter", color: "var(--gec-warn)" },
  ];
  const DRILL_TITLES = {
    total: "All leads (unique Transaction No.)",
    knownPromoter: "Leads with a known promoter",
    unknownPromoter: "Unknown Promoter leads",
    responded: "Leads with a Sales Response",
    responseRate: "Leads with a Sales Response",
    salesOrders: "Leads with an actual Sales Order",
    salesOrderRate: "Leads with an actual Sales Order",
    noOrder: "“NO ORDER” leads (not counted as Sales Orders)",
    converted: "Converted leads (approved statuses)",
    conversionRate: "Converted leads (approved statuses)",
    unassigned: "Leads without a consultant",
    noResponse: "Leads without a Sales Response",
  };
  const METRIC_LABEL = { visitors: "Visitors", leads: "Leads", responded: "Sales Response", salesOrders: "Sales Orders", converted: "Converted" };
  const METRIC_PRED = { leads: "total", responded: "responded", salesOrders: "salesOrders", converted: "converted" };

  // ---------- Skeleton ----------

  function build(host) {
    host.innerHTML = `
      <div class="gec-root" role="application" aria-label="GEC Control Center">
        <header class="gec-header gec-surface">
          <div class="gec-h-row">
            <div class="gec-brand">
              <span class="gec-brand-mark" aria-hidden="true"></span>
              <div><strong>GEC CONTROL CENTER</strong><span>Guest Experience Center</span></div>
            </div>
            <div class="gec-range" title="Reporting period">
              <strong class="gec-num" data-el="range">—</strong>
              <span class="gec-range-sub" data-el="range-sub"></span>
            </div>
            <div class="gec-actions">
              <span class="gec-live is-off" data-el="live"><i></i>LIVE</span>
              <span class="gec-updated">Updated <b data-el="updated">—</b></span>
              <button type="button" class="gec-btn is-debug" data-act="validate" data-el="debug-btn" title="Developer validation (Ctrl+Shift+D)" hidden>Validation</button>
              <button type="button" class="gec-btn" data-act="info" title="Detected columns, business rules and data quality">Data</button>
              <button type="button" class="gec-btn" data-act="refresh" title="Reload the latest Admin Push">↻ Refresh</button>
              <button type="button" class="gec-btn is-icon" data-act="fullscreen" title="Fullscreen" aria-label="Fullscreen">⛶</button>
              <button type="button" class="gec-btn is-icon is-exit" data-act="exit" title="Back to report" aria-label="Back to report">✕</button>
            </div>
          </div>
          <div class="gec-filters">
            <label class="gec-filter" data-fwrap="date"><span>Date</span>
              <input type="date" data-f="from" aria-label="From date" /><em class="gec-to">→</em><input type="date" data-f="to" aria-label="To date" />
            </label>
            <label class="gec-filter" data-fwrap="promoter"><span>Promoter</span><select data-f="promoter"></select></label>
            <label class="gec-filter" data-fwrap="consultant"><span>Consultant</span><select data-f="consultant" dir="auto"></select></label>
            <label class="gec-filter" data-fwrap="model"><span>Model</span><select data-f="model" dir="auto"></select></label>
            <label class="gec-filter" data-fwrap="source"><span>Source</span><select data-f="source"></select></label>
            <label class="gec-filter" data-fwrap="status"><span>Status</span><select data-f="status"></select></label>
            <button type="button" class="gec-btn" data-act="reset">Reset</button>
            <span class="gec-filter-note" data-el="filter-note"></span>
          </div>
        </header>

        <section class="gec-kpis" data-el="kpis"></section>

        <section class="gec-main">
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Daily Trend <span data-el="trend-unit">by date · click a day for records</span></h2>
              <div class="gec-legend" data-el="legend"></div>
            </div>
            <div class="gec-chart"><canvas data-el="chart" aria-label="Daily visitors, leads, sales response, sales orders and converted"></canvas></div>
          </article>
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Visitor → Conversion Funnel</h2>
              <span class="gec-legend"><span>click a stage for records</span></span>
            </div>
            <div class="gec-funnel" data-el="funnel"></div>
          </article>
        </section>

        <section class="gec-lower">
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Promoter Performance <span>visitors → leads → converted</span></h2>
              <div class="gec-head-tools" data-el="promoter-tools"></div>
            </div>
            <div class="gec-perf" data-el="promoter"></div>
          </article>
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Consultant Performance <span>leads received</span></h2>
              <div class="gec-head-tools" data-el="consultant-tools"></div>
            </div>
            <div class="gec-perf" data-el="consultant"></div>
          </article>
        </section>

        <footer class="gec-alerts gec-surface" data-el="alerts"></footer>

        <div class="gec-empty gec-surface" data-el="empty" hidden></div>

        <div class="gec-modal" data-el="modal" hidden>
          <div class="gec-modal-card" role="dialog" aria-modal="true" aria-labelledby="gec-modal-title">
            <div class="gec-modal-head">
              <div><h3 id="gec-modal-title" data-el="m-title"></h3><p data-el="m-sub"></p></div>
              <div class="gec-modal-tools">
                <button type="button" class="gec-btn" data-act="modal-filter" data-el="m-filter" hidden></button>
                <input type="search" data-el="m-search" placeholder="Search records…" aria-label="Search records" />
                <label data-el="m-allcols-wrap"><input type="checkbox" data-el="m-allcols" /> All Excel columns</label>
                <button type="button" class="gec-btn" data-act="modal-close">Close</button>
              </div>
            </div>
            <div class="gec-modal-stats" data-el="m-stats"></div>
            <div class="gec-modal-tabs" data-el="m-tabs"></div>
            <div class="gec-modal-body" data-el="m-body"></div>
            <div class="gec-modal-foot" data-el="m-foot"></div>
          </div>
        </div>
      </div>`;
    state.host = host;
    state.root = host.querySelector(".gec-root");
    bindEvents();
  }

  const el = (name) => state.root.querySelector(`[data-el="${name}"]`);

  function bindEvents() {
    const root = state.root;
    root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) { onAction(act); return; }
      const drill = e.target.closest("[data-drill]");
      if (drill) { onDrill(drill); return; }
      const row = e.target.closest("tr[data-row]");
      if (row) { onModalRow(Number(row.dataset.row)); return; }
      if (e.target === el("modal")) closeModal();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el("modal").hidden) { e.stopPropagation(); closeModal(); return; }
      if (e.key !== "Enter" && e.key !== " ") return;
      const drill = e.target.closest && e.target.closest("[data-drill]");
      if (drill && !/^(BUTTON|SELECT|INPUT)$/.test(e.target.tagName)) { e.preventDefault(); onDrill(drill); return; }
      if (e.target.matches("tr[data-row]")) { e.preventDefault(); onModalRow(Number(e.target.dataset.row)); }
    });
    root.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset && t.dataset.f) { setFilter(t.dataset.f, t.value || ""); return; }
      if (t.dataset && t.dataset.metric) { state.view[`${t.dataset.metric}Metric`] = t.value; renderPerf(t.dataset.metric); return; }
      if (t === el("m-allcols")) { state.modal.allCols = t.checked; renderModalTable(); }
    });
    el("m-search").addEventListener("input", (e) => { state.modal.search = e.target.value; renderModalTable(); });
    document.addEventListener("keydown", (e) => {
      if (!state.root || !state.root.getClientRects().length) return;
      if (e.key === "Escape" && !el("modal").hidden) closeModal();
      if (e.ctrlKey && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        state.debug = !state.debug;
        el("debug-btn").hidden = !state.debug;
        if (state.debug) openValidation();
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const btn = root.querySelector('[data-act="fullscreen"]');
      if (btn) btn.title = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    });
    if ("ResizeObserver" in global) {
      state.resizeObserver = new ResizeObserver(() => {
        clearTimeout(state.resizeTimer);
        state.resizeTimer = setTimeout(() => {
          if (!state.metrics || !state.root.getClientRects().length) return;
          renderPerf("promoter");
          renderPerf("consultant");
        }, 80);
      });
      state.resizeObserver.observe(root);
    }
  }

  function onAction(node) {
    const act = node.dataset.act;
    if (act === "refresh" && typeof state.ctx.onRefresh === "function") state.ctx.onRefresh();
    else if (act === "exit") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (typeof state.ctx.onExit === "function") state.ctx.onExit();
    } else if (act === "fullscreen") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (act === "reset") {
      state.filters = { ...EMPTY_FILTERS };
      renderAll();
    } else if (act === "view") {
      state.view[node.dataset.panel] = node.dataset.mode;
      renderPerf(node.dataset.panel);
    } else if (act === "info") openInfo();
    else if (act === "validate") openValidation();
    else if (act === "models") openModels();
    else if (act === "modal-close") closeModal();
    else if (act === "modal-tab") { state.modal.active = Number(node.dataset.tab) || 0; state.modal.search = ""; el("m-search").value = ""; renderModalTable(); }
    else if (act === "modal-filter" && state.modal.filterAction) {
      const { key, value } = state.modal.filterAction;
      closeModal();
      setFilter(key, state.filters[key] === value ? "" : value);
    }
  }

  function onDrill(node) {
    const d = node.dataset;
    const kind = d.drill;
    if (kind === "kpi") openKpi(d.key);
    else if (kind === "promoter") openPromoter(d.name);
    else if (kind === "consultant") openConsultant(d.name);
    else if (kind === "cell") openCell(d.kind, d.name, d.metric, d.day ? d.day.split(",") : null);
    else if (kind === "rank-all") openRankAll(d.kind);
    else if (kind === "quality") openInfo();
  }

  // ---------- Filters ----------

  function datasetSig(ds, vs) {
    if (!ds) return "";
    return [ds.fileName, ds.sheetName, ds.records.length, ds.range.from, ds.range.to, vs ? vs.total : ""].join("|");
  }

  function setFilter(key, value) {
    const f = state.filters;
    const r = (state.dataset && state.dataset.range) || {};
    if (key === "from" || key === "to") {
      f[key] = value;
      if (f.from && f.to && f.from > f.to) { if (key === "from") f.to = f.from; else f.from = f.to; }
      // Full range selected = no date filter (keeps undated transactions in the totals).
      if ((!f.from || f.from <= r.from) && (!f.to || f.to >= r.to)) { f.from = ""; f.to = ""; }
    } else f[key] = value;
    renderAll();
  }

  function renderFilterControls() {
    const ds = state.dataset;
    const opts = ds ? Data().filterOptions(ds) : { promoters: [], models: [], sources: [], statuses: [], consultants: [] };
    const fill = (key, list, allLabel) => {
      const sel = state.root.querySelector(`[data-f="${key}"]`);
      const cur = state.filters[key];
      sel.innerHTML = `<option value="">${allLabel}</option>` + list.map((v) =>
        `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
      sel.disabled = !list.length;
      state.root.querySelector(`[data-fwrap="${key}"]`).classList.toggle("is-active", !!cur);
    };
    fill("promoter", opts.promoters, "All promoters");
    fill("consultant", opts.consultants, ds && !ds.hasConsultant ? "No consultant column" : "All consultants");
    fill("model", opts.models, "All models");
    fill("source", opts.sources, "All sources");
    fill("status", opts.statuses, "All statuses");
    const from = state.root.querySelector('[data-f="from"]');
    const to = state.root.querySelector('[data-f="to"]');
    const r = (ds && ds.range) || {};
    [from, to].forEach((inp) => { inp.min = r.from || ""; inp.max = r.to || ""; inp.disabled = !r.from; });
    from.value = state.filters.from || r.from || "";
    to.value = state.filters.to || r.to || "";
    state.root.querySelector('[data-fwrap="date"]').classList.toggle("is-active", !!(state.filters.from || state.filters.to));
  }

  const filteredAny = () => Object.values(state.filters).some(Boolean);

  function filterSubtitle(extra) {
    const f = state.filters;
    const parts = [];
    if (f.from || f.to) parts.push(`${fmtDay(f.from || state.metrics.range.from, true)} – ${fmtDay(f.to || state.metrics.range.to, true)}`);
    ["promoter", "consultant", "model", "source", "status"].forEach((k) => { if (f[k] && k !== extra) parts.push(f[k]); });
    return parts.length ? parts.join(" · ") : "Selected period · no filters";
  }

  // ---------- Render ----------

  function computeWith(filters) {
    return Data().compute(state.dataset, filters, { visitors: state.visitors, slaMinutes: state.ctx.slaMinutes });
  }

  function renderAll() {
    const f = state.filters;
    state.metrics = computeWith(f);
    // Performance panels keep every promoter / consultant visible (selected one highlighted).
    state.promoterMetrics = f.promoter ? computeWith({ ...f, promoter: "" }) : state.metrics;
    state.consultantMetrics = f.consultant ? computeWith({ ...f, consultant: "" }) : state.metrics;
    renderFilterControls();
    renderHeader();
    renderKpis();
    renderTrend();
    renderFunnel();
    requestAnimationFrame(() => { renderPerf("promoter"); renderPerf("consultant"); });
    renderAlerts();
    renderEmpty();
    el("debug-btn").hidden = !state.debug;
  }

  function renderHeader() {
    const ds = state.dataset;
    const m = state.metrics;
    const { from, to } = m.range;
    el("range").textContent = from ? `${fmtDay(from, true)}  —  ${fmtDay(to, true)}` : "No dates";
    const days = daysBetween(from, to);
    const vs = state.visitors;
    el("range-sub").textContent = ds && ds.ok
      ? `Selected period${days ? ` · ${days} days` : ""} · ${ds.fileName || ds.sheetName}${vs && vs.ok ? ` · visitors: ${vs.sheetName}` : " · no visitor data"}`
      : "Waiting for GEC File";
    const live = el("live");
    live.classList.toggle("is-off", !(ds && ds.ok));
    live.lastChild.textContent = ds && ds.ok ? "LIVE" : "NO DATA";
    const at = Number(state.ctx.lastUpdated) || 0;
    el("updated").textContent = at ? new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    el("filter-note").textContent = ds && ds.ok ? `${n(m.rows.length)} of ${n(m.totalAll)} leads${filteredAny() ? " · filtered" : ""}` : "";
  }

  const link = (key, text, title) => `<span class="gec-sublink" role="button" tabindex="0" data-drill="kpi" data-key="${key}" title="${esc(title || DRILL_TITLES[key] || "")}">${text}</span>`;

  function renderKpis() {
    const m = state.metrics;
    const k = m.kpis;
    const t = m.timing;
    const total = k.total || 0;
    const days = Math.max(1, daysBetween(m.range.from, m.range.to));
    const noVis = !m.hasVisitors;
    const c = {
      visitors: noVis
        ? { val: "—", sub: "No visitor data uploaded", p: 0 }
        : { val: n(k.visitors), sub: `<b>${(k.visitors / days).toFixed(1)}</b> visitors / day`, p: 1 },
      total: { val: n(total), sub: `Known ${link("knownPromoter", `<b>${n(k.knownPromoter)}</b>`)} · Unknown ${link("unknownPromoter", `<b>${n(k.unknownPromoter)}</b>`)}`, p: 1 },
      visitorToLead: noVis
        ? { val: "—", sub: "Needs visitor data", p: 0 }
        : m.leadOnlyFilter
          ? { val: "—", sub: "n/a with model/source/status/consultant filter", p: 0 }
          : { val: pct(k.visitorToLead), sub: `<b>${n(total)}</b> leads ÷ ${n(k.visitors)} visitors`, p: k.visitorToLead },
      responded: { val: n(k.responded), sub: `<b>${pct(k.responseRate)}</b> response rate`, p: k.responseRate },
      salesOrders: { val: n(k.salesOrders), sub: `<b>${pct(k.salesOrderRate)}</b> · ${link("noOrder", `${n(k.noOrder)} NO ORDER`)} excluded`, p: k.salesOrderRate },
      converted: { val: n(k.converted), sub: `Approved statuses · <b>${pct(k.conversionRate)}</b>`, p: k.conversionRate },
      conversionRate: { val: pct(k.conversionRate), sub: `<b>${n(k.converted)}</b> ÷ ${n(total)} leads`, p: k.conversionRate },
      unknownPromoter: { val: n(k.unknownPromoter), sub: `<b>${pct(ratio(k.unknownPromoter, total))}</b> of leads · not ranked`, p: ratio(k.unknownPromoter, total) },
      avgResponse: { val: minutesText(t.avgResponseMinutes) || "—", sub: `${n(t.timedCount)} timed`, p: 0 },
      overSla: { val: n(t.overSla), sub: `SLA <b>${t.slaMinutes} min</b>`, p: ratio(t.overSla, t.timedCount) },
    };
    const defs = KPIS.filter((d) => !d.timing || cfg().SHOW_TIMING);
    el("kpis").style.setProperty("--kpi-count", defs.length);
    el("kpis").innerHTML = defs.map((d) => {
      const x = c[d.key];
      const v = d.key === "overSla" ? t.overSla : k[d.key];
      const hot = d.alert && (v || 0) > 0;
      const disabled = x.val === "—" && (d.key === "visitors" || d.key === "visitorToLead");
      return `<div class="gec-kpi gec-surface${hot ? " is-alert" : ""}${disabled ? " is-na" : ""}" style="--k:${d.color}" role="button" tabindex="0" data-drill="kpi" data-key="${d.key}" title="${esc(kpiTitle(d.key))}">
        <span class="gec-kpi-lab">${esc(d.label)}</span>
        <span class="gec-kpi-val gec-num">${x.val}</span>
        <span class="gec-kpi-sub">${x.sub}</span>
        <span class="gec-kpi-meter"><i style="--p:${(Math.max(0, Math.min(1, x.p || 0)) * 100).toFixed(1)}%"></i></span>
      </div>`;
    }).join("");
  }

  function kpiTitle(key) {
    if (key === "visitors") return "Open visitor records";
    if (key === "visitorToLead") return "Open Visitor → Lead by promoter";
    return `Open ${DRILL_TITLES[key] || "records"}`;
  }

  function renderTrend() {
    const canvas = el("chart");
    const m = state.metrics;
    const { unit, buckets, undated } = m.trend;
    el("trend-unit").textContent = `${unit === "week" ? "weekly" : "daily"} · click a day for records${undated ? ` · ${n(undated)} undated not plotted` : ""}`;
    const series = [
      m.hasVisitors ? { key: "visitors", label: "Visitors", color: "#a78bfa" } : null,
      { key: "leads", label: "Leads", color: "#5aa9ff" },
      { key: "responded", label: "Sales Response", color: "#22c3d6" },
      { key: "salesOrders", label: "Sales Orders", color: "#f2b24c" },
      { key: "converted", label: "Converted", color: "#34d399" },
    ].filter(Boolean);
    el("legend").innerHTML = series.map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join("");
    if (typeof global.Chart === "undefined") return;
    const labels = buckets.map((b) => (unit === "week" ? `Wk ${fmtDay(b.key)}` : fmtDay(b.key)));
    const dense = buckets.length > 40;
    const datasets = series.map((s) => {
      if (s.key === "leads") {
        return {
          type: "bar", label: s.label, data: buckets.map((b) => b.leads), order: 5,
          backgroundColor: "rgba(90,169,255,0.30)", hoverBackgroundColor: "rgba(90,169,255,0.55)",
          borderColor: "rgba(90,169,255,0.7)", borderWidth: { top: 1.5, right: 0, bottom: 0, left: 0 },
          borderRadius: 3, barPercentage: 0.8, categoryPercentage: 0.9,
        };
      }
      return {
        type: "line", label: s.label, data: buckets.map((b) => b[s.key]), borderColor: s.color, backgroundColor: s.color,
        borderWidth: s.key === "converted" ? 2.4 : 2, cubicInterpolationMode: "monotone", pointRadius: dense ? 0 : 2.2, pointHoverRadius: 5,
        order: { visitors: 4, responded: 3, salesOrders: 2, converted: 1 }[s.key],
        borderDash: s.key === "visitors" ? [5, 4] : s.key === "responded" ? [3, 3] : undefined,
        fill: s.key === "converted", ...(s.key === "converted" ? { backgroundColor: "rgba(52,211,153,0.12)" } : {}),
      };
    });
    const data = { labels, datasets };
    if (state.chart && state.chart.canvas === canvas) {
      state.chart.data = data;
      state.chart.update();
      return;
    }
    if (state.chart) state.chart.destroy();
    state.chart = new global.Chart(canvas.getContext("2d"), {
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        interaction: { mode: "index", intersect: false },
        layout: { padding: { top: 4, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(10,16,27,0.96)", borderColor: "rgba(148,163,184,0.25)", borderWidth: 1,
            titleColor: "#e7edf6", bodyColor: "#c9d3e1", padding: 10, boxPadding: 4, usePointStyle: true,
            callbacks: {
              title: (items) => {
                const b = state.metrics.trend.buckets[items[0].dataIndex];
                if (!b) return "";
                return state.metrics.trend.unit === "week" ? `Week of ${fmtDay(b.key, true)}` : fmtDay(b.key, true);
              },
              footer: (items) => {
                const b = state.metrics.trend.buckets[items[0].dataIndex];
                return b && b.leads ? `Conversion ${pct(b.converted / b.leads)} · click for records` : "";
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: "rgba(148,163,184,0.18)" },
            ticks: { color: "#8d9bb0", font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
          y: { beginAtZero: true, grid: { color: "rgba(148,163,184,0.08)" }, border: { display: false },
            ticks: { color: "#6f7d92", font: { size: 11 }, precision: 0, maxTicksLimit: 5 } },
        },
        onClick: (evt, _els, chart) => {
          const pts = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
          if (!pts.length) return;
          const b = state.metrics.trend.buckets[pts[0].index];
          if (b) openDay(b);
        },
        onHover: (evt, els) => {
          const t = evt.native && evt.native.target;
          if (t) t.style.cursor = els.length ? "pointer" : "default";
        },
      },
    });
  }

  function renderFunnel() {
    const m = state.metrics;
    const k = m.kpis;
    const stages = [
      m.hasVisitors ? { key: "visitors", label: "Visitors", count: k.visitors, note: "Everyone entering", pct: null } : null,
      { key: "total", label: "Leads", count: k.total, note: m.hasVisitors ? "Registered" : "Unique transactions",
        pct: m.hasVisitors && !m.leadOnlyFilter ? k.visitorToLead : null, pctLab: "of visitors" },
      { key: "responded", label: "Sales Response", count: k.responded, note: `${n(k.noResponse)} without`, pct: k.responseRate, pctLab: "of leads" },
      { key: "salesOrders", label: "Sales Orders", count: k.salesOrders, note: `${n(k.noOrder)} NO ORDER excluded`, pct: k.salesOrderRate, pctLab: "of leads" },
      { key: "converted", label: "Converted", count: k.converted, note: "Approved statuses", pct: k.conversionRate, pctLab: "of leads" },
    ].filter(Boolean);
    const max = Math.max(1, ...stages.map((s) => s.count || 0));
    el("funnel").innerHTML = stages.map((s) => {
      const w = Math.max(14, ((s.count || 0) / max) * 100);
      return `<button type="button" class="gec-stage" style="--c:${COLORS[s.key]}" data-drill="kpi" data-key="${s.key}" title="${esc(kpiTitle(s.key))}">
        <span class="gec-stage-lab"><strong>${esc(s.label)}</strong><span>${esc(s.note)}</span></span>
        <span class="gec-stage-track"><span class="gec-stage-bar gec-num" style="--w:${w.toFixed(1)}%">${n(s.count)}</span></span>
        <span class="gec-stage-pct gec-num">${s.pct == null ? "" : `${pct(s.pct)}<small>${s.pctLab}</small>`}</span>
      </button>`;
    }).join("");
  }

  // ---------- Promoter / consultant performance ----------

  const ROW_MIN_PX = 22;

  function perfTools(kind) {
    const mode = state.view[kind];
    const metrics = kind === "promoter"
      ? ["leads", "visitors", "converted", "responded", "salesOrders"].filter((x) => x !== "visitors" || state.metrics.hasVisitors)
      : ["leads", "responded", "salesOrders", "converted"];
    const cur = state.view[`${kind}Metric`];
    const sel = mode === "daily"
      ? `<label class="gec-mini-select"><select data-metric="${kind}" aria-label="Daily metric">${metrics.map((x) => `<option value="${x}"${x === cur ? " selected" : ""}>${METRIC_LABEL[x]}</option>`).join("")}</select></label>`
      : "";
    const all = kind === "consultant" && mode === "period" ? `<button type="button" class="gec-link" data-drill="rank-all" data-kind="consultant" data-el="consultant-all"></button>` : "";
    return `${all}${sel}<div class="gec-seg" role="group" aria-label="View">
      <button type="button" class="${mode === "period" ? "is-on" : ""}" data-act="view" data-panel="${kind}" data-mode="period">Period</button>
      <button type="button" class="${mode === "daily" ? "is-on" : ""}" data-act="view" data-panel="${kind}" data-mode="daily">Daily</button></div>`;
  }

  function renderPerf(kind) {
    const box = el(kind);
    if (!box || !state.metrics) return;
    if (state.view[`${kind}Metric`] === "visitors" && !state.metrics.hasVisitors) state.view[`${kind}Metric`] = "leads";
    el(`${kind}-tools`).innerHTML = perfTools(kind);
    if (kind === "consultant" && !state.metrics.hasConsultant) {
      box.innerHTML = `<div class="gec-perf-empty">No consultant column in the GEC File (e.g. “Assigned To”).</div>`;
      return;
    }
    if (state.view[kind] === "daily") renderDaily(kind, box);
    else if (kind === "promoter") renderPromoterPeriod(box);
    else renderConsultantPeriod(box);
  }

  const cellBtn = (kind, name, metric, text, cls, day) =>
    `<span class="r gec-num gec-cell${cls ? ` ${cls}` : ""}" role="button" tabindex="0" data-drill="cell" data-kind="${kind}" data-name="${esc(name)}" data-metric="${metric}"${day ? ` data-day="${esc(day)}"` : ""} title="${esc(`${name} · ${METRIC_LABEL[metric] || metric}`)}">${text}</span>`;

  function renderPromoterPeriod(box) {
    const m = state.promoterMetrics;
    const list = m.promoters;
    const sel = state.filters.promoter;
    const hasV = m.hasVisitors;
    const maxBar = Math.max(1, ...list.map((p) => Math.max(p.visitors || 0, p.leads)));
    const tot = list.reduce((s, p) => ({ visitors: s.visitors + (p.visitors || 0), leads: s.leads + p.leads, converted: s.converted + p.converted }), { visitors: 0, leads: 0, converted: 0 });
    const unknown = m.kpis.unknownPromoter;
    const rowHtml = (p, i) => `<div class="gec-perf-row gec-pgrid${sel === p.name ? " is-selected" : ""}${sel && sel !== p.name ? " is-dim" : ""}" role="button" tabindex="0" data-drill="promoter" data-name="${esc(p.name)}" title="Open ${esc(p.name)} — visitors, leads and conversions">
        <span class="n gec-num">${i + 1}</span>
        <span class="name">${esc(p.name)}</span>
        <span class="gec-rank-bar">${hasV ? `<i class="vis" style="width:${(((p.visitors || 0) / maxBar) * 100).toFixed(1)}%"></i>` : ""}<i class="lead" style="width:${((p.leads / maxBar) * 100).toFixed(1)}%"></i><i class="conv" style="width:${((p.converted / maxBar) * 100).toFixed(1)}%"></i></span>
        ${hasV ? cellBtn("promoter", p.name, "visitors", n(p.visitors), "muted") : `<span class="r muted">—</span>`}
        ${cellBtn("promoter", p.name, "leads", n(p.leads))}
        ${cellBtn("promoter", p.name, "converted", n(p.converted))}
        <span class="r gec-num rate-v">${pct(p.visitorToLead)}</span>
        <span class="r gec-num rate${p.leadToConversion != null && p.leadToConversion < (m.kpis.conversionRate || 0) ? " is-low" : ""}">${pct(p.leadToConversion)}</span>
      </div>`;
    box.innerHTML = `
      <div class="gec-pgrid gec-perf-head"><span>#</span><span>Promoter</span><span>${hasV ? "Visitors · leads · converted" : "Leads · converted"}</span><span class="r">Visitors</span><span class="r">Leads</span><span class="r">Conv.</span><span class="r" title="Leads ÷ visitors">V→L</span><span class="r" title="Converted ÷ leads">L→C</span></div>
      <div class="gec-perf-body">${list.map(rowHtml).join("")}</div>
      <div class="gec-pgrid gec-perf-foot">
        <span></span><span class="name">5 promoters</span>
        <span class="gec-unknown-note">${link("unknownPromoter", `+ ${n(unknown)} Unknown Promoter leads ↗`, "Open Unknown Promoter leads (not ranked)")}</span>
        <span class="r gec-num">${hasV ? n(tot.visitors) : "—"}</span><span class="r gec-num">${n(tot.leads)}</span><span class="r gec-num">${n(tot.converted)}</span>
        <span class="r gec-num">${hasV && !m.leadOnlyFilter ? pct(ratio(tot.leads, tot.visitors)) : "—"}</span><span class="r gec-num">${pct(ratio(tot.converted, tot.leads))}</span>
      </div>`;
  }

  function renderConsultantPeriod(box) {
    const m = state.consultantMetrics;
    const list = m.consultants;
    const sel = state.filters.consultant;
    const allBtn = el("consultant-all");
    if (allBtn) allBtn.textContent = list.length ? `View all ${n(list.length)} →` : "";
    if (!list.length) { box.innerHTML = `<div class="gec-perf-empty">No consultant leads for this selection.</div>`; return; }
    box.innerHTML = `
      <div class="gec-cgrid gec-perf-head"><span>#</span><span>Consultant</span><span class="r">Leads</span><span class="r">Resp.</span><span class="r">Resp %</span><span class="r">SO</span><span class="r">Conv.</span><span class="r">Conv %</span></div>
      <div class="gec-perf-body" data-perf-body></div>
      <div class="gec-perf-more" data-el="consultant-more"></div>`;
    const body = box.querySelector("[data-perf-body]");
    const fit = Math.max(1, Math.floor((body.clientHeight || ROW_MIN_PX * 5) / ROW_MIN_PX));
    let shown = list.slice(0, fit);
    if (sel && !shown.some((x) => x.name === sel)) {
      const s = list.find((x) => x.name === sel);
      if (s) shown = [...shown.slice(0, fit - 1), s];
    }
    const avg = m.kpis.conversionRate || 0;
    body.innerHTML = shown.map((c) => `<div class="gec-perf-row gec-cgrid${sel === c.name ? " is-selected" : ""}${sel && sel !== c.name ? " is-dim" : ""}" role="button" tabindex="0" data-drill="consultant" data-name="${esc(c.name)}" title="Open ${esc(c.name)} — received, responded and converted leads">
        <span class="n gec-num">${list.indexOf(c) + 1}</span>
        <span class="name" dir="auto">${esc(c.name)}</span>
        ${cellBtn("consultant", c.name, "leads", n(c.leads))}
        ${cellBtn("consultant", c.name, "responded", n(c.responded), "muted")}
        <span class="r gec-num muted">${pct(c.responseRate)}</span>
        ${cellBtn("consultant", c.name, "salesOrders", n(c.salesOrders), "muted")}
        ${cellBtn("consultant", c.name, "converted", n(c.converted))}
        <span class="r gec-num rate${c.conversionRate < avg ? " is-low" : ""}">${pct(c.conversionRate)}</span>
      </div>`).join("");
    const hidden = list.length - shown.length;
    const un = m.kpis.unassigned;
    box.querySelector('[data-el="consultant-more"]').innerHTML = [
      hidden > 0 ? `<button type="button" class="gec-link" data-drill="rank-all" data-kind="consultant">+ ${n(hidden)} more consultants</button>` : "",
      un ? link("unassigned", `${n(un)} unassigned leads ↗`) : "",
    ].filter(Boolean).join(" · ");
  }

  function renderDaily(kind, box) {
    const metric = state.view[`${kind}Metric`];
    const source = kind === "promoter" ? state.promoterMetrics : state.consultantMetrics;
    const dm = Data().dailyMatrix(source, kind, metric);
    if (!dm.buckets.length) { box.innerHTML = `<div class="gec-perf-empty">No dated records in this period.</div>`; return; }
    const sel = state.filters[kind];
    box.innerHTML = `<div class="gec-daily" style="--days:${dm.buckets.length}">
      <div class="gec-drow gec-dhead"><span class="name">${kind === "promoter" ? "Promoter" : "Consultant"}</span>${dm.buckets.map((b) =>
        `<span title="${esc(dm.unit === "week" ? `Week of ${fmtDay(b.key, true)}` : fmtDay(b.key, true))}">${dm.unit === "week" ? fmtDay(b.key).split(" ")[0] : b.key.slice(8)}</span>`).join("")}<span class="tot">Total</span></div>
      <div class="gec-dbody" data-perf-body></div>
      <div class="gec-daily-foot">${esc(METRIC_LABEL[metric])} per ${dm.unit === "week" ? "week" : "day"} · ${fmtDay(source.range.from)} – ${fmtDay(source.range.to)} · click any number</div>
    </div>`;
    const body = box.querySelector("[data-perf-body]");
    const fit = Math.max(1, Math.floor((body.clientHeight || ROW_MIN_PX * 5) / ROW_MIN_PX));
    const rows = kind === "promoter" ? dm.rows : dm.rows.slice(0, fit);
    const max = Math.max(1, ...rows.flatMap((r) => r.values));
    body.innerHTML = rows.map((r) => `<div class="gec-drow${sel === r.name ? " is-selected" : ""}">
        <span class="name" role="button" tabindex="0" data-drill="${kind}" data-name="${esc(r.name)}" title="Open ${esc(r.name)}" dir="auto">${esc(r.name)}</span>
        ${r.values.map((v, i) => (v
          ? `<span class="gec-dcell gec-num" style="--h:${(0.12 + (v / max) * 0.6).toFixed(2)}" role="button" tabindex="0" data-drill="cell" data-kind="${kind}" data-name="${esc(r.name)}" data-metric="${metric}" data-day="${esc(dm.buckets[i].days.join(","))}" title="${esc(`${r.name} · ${fmtDay(dm.buckets[i].key, true)} · ${v} ${METRIC_LABEL[metric]}`)}">${v}</span>`
          : `<span class="gec-dcell is-zero">·</span>`)).join("")}
        ${r.total ? cellBtn(kind, r.name, metric, n(r.total), "tot") : `<span class="r tot muted">0</span>`}
      </div>`).join("");
  }

  function renderAlerts() {
    const k = state.metrics.kpis;
    const ds = state.dataset;
    const q = ds && ds.quality;
    const alerts = ALERTS.map((a) => {
      const v = k[a.key];
      if (v == null) return `<span class="gec-alert is-na" title="No consultant column in the file"><i></i>${esc(a.label)}<b class="gec-num">—</b></span>`;
      return `<button type="button" class="gec-alert${v > 0 ? " is-hot" : ""}" style="--a:${a.color}" data-drill="kpi" data-key="${a.key}" title="Open ${esc(DRILL_TITLES[a.key])}">
        <i></i>${esc(a.label)}<b class="gec-num">${n(v)}</b></button>`;
    }).join("");
    const models = ds && ds.ok ? `<button type="button" class="gec-btn is-slim" data-act="models" title="Leads and conversions by model">Models</button>` : "";
    const dq = q && ds.ok ? `
      <button type="button" class="gec-dq" data-drill="quality" title="Data quality — click for details">
        <span class="gec-dq-title">Data quality</span>
        <span>Rows <b>${n(q.sourceRows)}</b></span>
        <span>Unique <b>${n(q.uniqueTransactions)}</b></span>
        <span class="${q.duplicateRows ? "warn" : ""}">Duplicates <b>${n(q.duplicateRows)}</b></span>
        <span class="${q.missingTxn ? "warn" : ""}">No Txn <b>${n(q.missingTxn)}</b></span>
        <span class="${q.unknownPromoter ? "warn" : ""}">Unknown promoter <b>${n(q.unknownPromoter)}</b></span>
        <span>Visitors <b>${state.visitors && state.visitors.ok ? n(state.visitors.total) : "—"}</b></span>
      </button>` : `<span class="gec-foot-meta">Upload the GEC File in Admin Push</span>`;
    el("alerts").innerHTML = `<span class="gec-alerts-title">Alerts</span>${alerts}${models}${dq}`;
  }

  function renderEmpty() {
    const box = el("empty");
    const ds = state.dataset;
    if (ds && ds.ok) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = ds
      ? `<div><strong>GEC File could not be read</strong>${esc(ds.warnings[0] || "No lead rows found.")}<br/>Click <b>Data</b> to see which sheets and columns were detected.</div>`
      : `<div><strong>No GEC File pushed yet</strong>Open <b>Admin Push</b>, upload the <b>GEC File</b> (Lead Data sheet) and click <b>Push to live</b>.</div>`;
  }

  // ---------- Modal engine (tabs · search · the only scrolling surface) ----------

  function leadColumns(rows) {
    const cols = [
      { h: "Transaction No.", v: (r) => r.id },
      { h: "Lead date", v: (r) => fmtDate(r.leadDate, true), sort: (r) => (r.leadDate ? r.leadDate.getTime() : 0) },
      { h: "Promoter", v: (r) => r.promoter },
      { h: "Emp. No. (R)", v: (r) => r.employeeNumber, num: true },
      { h: "Consultant", v: (r) => r.consultant, dir: true },
      { h: "Model", v: (r) => r.modelGroup, dir: true },
      { h: "Source", v: (r) => (r.source === "(blank)" ? "" : r.source) },
      { h: "Status", v: (r) => r.status },
      { h: "Converted", v: (r) => (r.converted ? "Yes" : ""), html: (r) => (r.converted ? `<span class="gec-pill s-converted">Converted</span>` : "") },
      { h: "Sales Response", v: (r) => r.salesResponse, dir: true, html: (r) => (r.responded ? esc(r.salesResponse) : (r.salesResponse ? `<span class="gec-muted-val">${esc(r.salesResponse)}</span>` : "")) },
      { h: "Sales Order", v: (r) => r.salesOrder,
        html: (r) => (r.salesOrderState === "order" ? `<span class="gec-pill s-sales-order">${esc(r.salesOrder)}</span>` : r.salesOrder ? `<span class="gec-muted-val">${esc(r.salesOrder)}</span>` : "") },
      cfg().SHOW_TIMING ? { h: "Response", v: (r) => minutesText(r.responseMinutes), num: true } : null,
      { h: "Customer", v: (r) => r.customer, dir: true },
      { h: "Rows", v: (r) => (r.rowCount > 1 ? String(r.rowCount) : ""), num: true },
    ].filter(Boolean);
    return cols.filter((c) => c.h === "Transaction No." || rows.some((r) => String(c.v(r) || "").trim() !== ""));
  }

  function rawColumns() {
    const headers = (state.dataset && state.dataset.headers) || [];
    return [
      { h: "Converted", v: (r) => (r.converted ? "Yes" : ""), html: (r) => (r.converted ? `<span class="gec-pill s-converted">Converted</span>` : "") },
      { h: "Excel row", v: (r) => String(r.rowNo), num: true },
      ...headers.map((h) => ({ h, v: (r) => String(r.raw[h] ?? ""), dir: true })),
    ];
  }

  const VISITOR_COLUMNS = [
    { h: "Date", v: (v) => fmtDay(v.day, true) },
    { h: "Promoter", v: (v) => v.promoter },
    { h: "Visit Purpose", v: (v) => v.purpose, dir: true },
    { h: "Visitors", v: (v) => String(v.count), num: true },
    { h: "Excel row", v: (v) => String(v.rowNo), num: true },
  ];

  const leadView = (label, rows) => ({ label, rows, type: "leads" });
  const visitorView = (label, rows) => ({ label, rows, type: "visitors", columns: VISITOR_COLUMNS, countOf: (list) => list.reduce((s, v) => s + v.count, 0), unit: "visitors" });

  /**
   * @param o { title, sub, stats, views:[{label, rows, type:"leads"|"visitors"|"table", columns, onRow}], html, filterAction }
   */
  function openModal(o) {
    const m = state.modal;
    m.views = o.views || [];
    m.active = 0;
    m.search = "";
    m.allCols = false;
    m.filterAction = o.filterAction || null;
    el("m-title").textContent = o.title;
    el("m-sub").textContent = o.sub || "";
    el("m-search").value = "";
    el("m-allcols").checked = false;
    const fb = el("m-filter");
    fb.hidden = !m.filterAction;
    if (m.filterAction) fb.textContent = state.filters[m.filterAction.key] === m.filterAction.value ? "Clear dashboard filter" : "Filter dashboard";
    el("m-stats").innerHTML = (o.stats || []).map((s) => `<div class="gec-mstat${s.cls ? ` ${s.cls}` : ""}">${esc(s.label)}<b class="gec-num">${s.value}</b></div>`).join("");
    el("modal").hidden = false;
    if (o.html != null) {
      el("m-tabs").innerHTML = "";
      el("m-search").hidden = true;
      el("m-allcols-wrap").hidden = true;
      el("m-body").innerHTML = o.html;
      el("m-foot").textContent = o.foot || "";
      return;
    }
    el("m-search").hidden = false;
    renderModalTable();
    setTimeout(() => el("m-search").focus(), 30);
  }

  function closeModal() {
    el("modal").hidden = true;
    state.modal.views = [];
    el("m-body").innerHTML = "";
  }

  const MODAL_MAX_ROWS = 2000;

  function renderModalTable() {
    const m = state.modal;
    const view = m.views[m.active];
    el("m-tabs").innerHTML = m.views.length > 1 ? m.views.map((v, i) => {
      const count = v.countOf ? v.countOf(v.rows) : v.rows.length;
      return `<button type="button" class="${i === m.active ? "is-on" : ""}" data-act="modal-tab" data-tab="${i}">${esc(v.label)} <b class="gec-num">${n(count)}</b></button>`;
    }).join("") : "";
    if (!view) { el("m-body").innerHTML = ""; el("m-foot").textContent = ""; return; }
    el("m-allcols-wrap").hidden = view.type !== "leads";
    const cols = view.columns || (m.allCols ? rawColumns() : leadColumns(view.rows));
    const q = m.search.trim().toLowerCase();
    const idx = view.rows.map((r, i) => i).filter((i) => !q || cols.some((c) => String(c.v(view.rows[i]) || "").toLowerCase().includes(q)));
    const shown = idx.slice(0, MODAL_MAX_ROWS);
    const clickable = !!view.onRow;
    el("m-body").innerHTML = view.rows.length ? `<table class="gec-table"><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.h)}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((i) => {
        const r = view.rows[i];
        return `<tr${clickable ? ` class="is-click" data-row="${i}" tabindex="0"` : ""}>${cols.map((c) => {
          const text = String(c.v(r) ?? "");
          return `<td class="${c.num ? "num" : ""}"${c.dir ? ' dir="auto"' : ""} title="${esc(text)}">${c.html ? c.html(r) : esc(text)}</td>`;
        }).join("")}</tr>`;
      }).join("")}</tbody></table>` : `<div class="gec-modal-empty">No records.</div>`;
    const unit = view.type === "visitors" ? "visitor rows" : view.type === "table" ? "rows" : "leads";
    el("m-foot").textContent = idx.length > MODAL_MAX_ROWS
      ? `Showing first ${n(MODAL_MAX_ROWS)} of ${n(idx.length)} — refine with search`
      : `${n(idx.length)} ${unit}${view.countOf ? ` · ${n(view.countOf(idx.map((i) => view.rows[i])))} visitors` : ""}${q ? ` matching “${m.search}”` : ""}`;
  }

  function onModalRow(i) {
    const view = state.modal.views[state.modal.active];
    if (view && view.onRow) view.onRow(view.rows[i]);
  }

  function leadStats(rows) {
    const c = (p) => rows.reduce((s, r) => s + (p(r) ? 1 : 0), 0);
    const resp = c((r) => r.responded);
    const so = c((r) => r.hasSalesOrder);
    const conv = c((r) => r.converted);
    return [
      { label: "Leads", value: n(rows.length) },
      { label: "Sales Response", value: `${n(resp)} · ${pct(ratio(resp, rows.length))}` },
      { label: "Sales Orders", value: `${n(so)} · ${pct(ratio(so, rows.length))}` },
      { label: "NO ORDER", value: n(c((r) => r.salesOrderState === "noOrder")) },
      { label: "Converted", value: n(conv) },
      { label: "Conversion", value: pct(ratio(conv, rows.length)) },
    ];
  }

  // ---------- Drill-downs ----------

  function predicateRows(key, rows) {
    const pred = Data().PREDICATES[key];
    return pred ? rows.filter(pred) : rows;
  }

  function openKpi(key) {
    const m = state.metrics;
    if (key === "visitors") { openVisitors(); return; }
    if (key === "visitorToLead") { openRankAll("promoter"); return; }
    if (key === "avgResponse" || key === "overSla") {
      const s = m.timing.slaMinutes;
      const rows = m.rows.filter((r) => r.responseMinutes != null && (key === "avgResponse" || r.responseMinutes > s)).sort((a, b) => b.responseMinutes - a.responseMinutes);
      openModal({ title: key === "overSla" ? `Over SLA (${s} min)` : "Timed responses", sub: filterSubtitle(), stats: leadStats(rows), views: [leadView("Leads", rows)] });
      return;
    }
    const rows = predicateRows(key, m.rows);
    const views = [leadView("Leads", rows)];
    if (key === "total") {
      views.push(leadView("Known promoter", predicateRows("knownPromoter", rows)), leadView("Unknown Promoter", predicateRows("unknownPromoter", rows)),
        leadView("Responded", predicateRows("responded", rows)), leadView("Sales Orders", predicateRows("salesOrders", rows)), leadView("Converted", predicateRows("converted", rows)));
    }
    if (key === "unknownPromoter") views.push(employeeBreakdownView(rows));
    if (key === "salesOrders" || key === "salesOrderRate") views.push(leadView("NO ORDER (excluded)", predicateRows("noOrder", m.rows)));
    if (key === "converted" || key === "conversionRate") views.push(statusView(m.rows));
    openModal({ title: DRILL_TITLES[key] || "Leads", sub: filterSubtitle(), stats: leadStats(rows), views });
  }

  function employeeBreakdownView(rows) {
    const map = new Map();
    rows.forEach((r) => { const k = r.employeeNumber || "(blank)"; map.set(k, (map.get(k) || 0) + 1); });
    const list = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    return {
      label: "By Employee Number", type: "table", rows: list,
      columns: [{ h: "Employee Number (column R)", v: (x) => x.value }, { h: "Leads", v: (x) => n(x.count), num: true }],
      onRow: (x) => openModal({ title: `Unknown Promoter · Employee Number ${x.value}`, sub: filterSubtitle(), views: [leadView("Leads", rows.filter((r) => (r.employeeNumber || "(blank)") === x.value))] }),
    };
  }

  function statusView(rows) {
    const map = new Map();
    rows.forEach((r) => { map.set(r.statusLabel, (map.get(r.statusLabel) || 0) + 1); });
    const list = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count, conv: Data().isConverted(value) }));
    return {
      label: "Status breakdown", type: "table", rows: list,
      columns: [
        { h: "Status", v: (x) => x.value },
        { h: "Leads", v: (x) => n(x.count), num: true },
        { h: "Counts as converted", v: (x) => (x.conv ? "Yes" : "No"), html: (x) => (x.conv ? `<span class="gec-pill s-converted">Yes</span>` : `<span class="gec-muted-val">No</span>`) },
      ],
      onRow: (x) => openModal({ title: `Status · ${x.value}`, sub: filterSubtitle(), views: [leadView("Leads", rows.filter((r) => r.statusLabel === x.value))] }),
    };
  }

  function openVisitors(visitorRows, title) {
    const m = state.metrics;
    if (!m.hasVisitors) {
      openModal({ title: "Visitors", sub: "No visitor data", html: `<div class="gec-rules"><h4>No visitor data uploaded</h4>
        <p>Visitors are tracked separately from leads — everyone who enters the GEC (exploration, inquiry, those who never become a lead and those who do).</p>
        <p>Add a sheet named <b>Visitors</b> to the GEC File, or upload a <b>GEC Visitors</b> file in Admin Push, with the columns <b>Date · Promoter · Visit Purpose</b> (optional <b>Count</b>). No personal information is needed. Promoter can be the employee number or the name.</p></div>` });
      return;
    }
    const rows = visitorRows || m.visitorRows;
    const total = rows.reduce((s, v) => s + v.count, 0);
    const purposes = new Map();
    rows.forEach((v) => purposes.set(v.purpose, (purposes.get(v.purpose) || 0) + v.count));
    const byPurpose = [...purposes.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    openModal({
      title: title || "Visitors",
      sub: `${filterSubtitle()}${m.leadOnlyFilter ? " · visitors follow date & promoter filters only" : ""}`,
      stats: [
        { label: "Visitors", value: n(total) },
        { label: "Registered leads", value: n(m.kpis.total) },
        { label: "Visitor → Lead", value: pct(m.kpis.visitorToLead) },
        ...byPurpose.slice(0, 4).map((p) => ({ label: p.value, value: n(p.count) })),
      ],
      views: [
        visitorView("Visitor records", rows),
        { label: "By purpose", type: "table", rows: byPurpose,
          columns: [{ h: "Visit Purpose", v: (x) => x.value, dir: true }, { h: "Visitors", v: (x) => n(x.count), num: true }, { h: "Share", v: (x) => pct(ratio(x.count, total)), num: true }],
          onRow: (x) => openVisitors(rows.filter((v) => v.purpose === x.value), `Visitors · ${x.value}`) },
      ],
    });
  }

  function dailyTableView(leads, visitors, withVisitors) {
    const days = new Map();
    const get = (d) => { if (!days.has(d)) days.set(d, { day: d, visitors: 0, leads: 0, responded: 0, salesOrders: 0, converted: 0 }); return days.get(d); };
    leads.forEach((r) => { if (!r.day) return; const x = get(r.day); x.leads += 1; x.responded += r.responded; x.salesOrders += r.hasSalesOrder; x.converted += r.converted; });
    if (withVisitors) visitors.forEach((v) => { if (v.day) get(v.day).visitors += v.count; });
    const rows = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    return {
      label: "Daily", type: "table", rows,
      columns: [
        { h: "Day", v: (x) => fmtDay(x.day, true) },
        withVisitors ? { h: "Visitors", v: (x) => n(x.visitors), num: true } : null,
        { h: "Leads", v: (x) => n(x.leads), num: true },
        withVisitors ? { h: "Visitor → Lead", v: (x) => pct(ratio(x.leads, x.visitors)), num: true } : null,
        { h: "Sales Response", v: (x) => n(x.responded), num: true },
        { h: "Sales Orders", v: (x) => n(x.salesOrders), num: true },
        { h: "Converted", v: (x) => n(x.converted), num: true },
        { h: "Conversion", v: (x) => pct(ratio(x.converted, x.leads)), num: true },
      ].filter(Boolean),
      onRow: (x) => openDay({ key: x.day, days: [x.day] }, { leads, visitors }),
    };
  }

  function openPromoter(name) {
    const pm = state.promoterMetrics;
    const leads = pm.rows.filter((r) => r.promoter === name);
    const visitors = pm.visitorRows.filter((v) => v.promoter === name);
    const p = pm.promoters.find((x) => x.name === name) || { visitors: null, leads: leads.length, converted: 0, visitorToLead: null, leadToConversion: null };
    const views = [leadView("Leads registered", leads), leadView("Converted", predicateRows("converted", leads))];
    if (pm.hasVisitors) views.push(visitorView("Visitors", visitors));
    views.push(dailyTableView(leads, visitors, pm.hasVisitors));
    const stats = [
      { label: "Visitors", value: nOrDash(p.visitors) },
      { label: "Leads registered", value: n(p.leads) },
      { label: "Converted", value: n(p.converted) },
      { label: "Visitor → Lead", value: pct(p.visitorToLead) },
      { label: "Lead → Conversion", value: pct(p.leadToConversion) },
    ];
    const emp = Object.entries(Data().PROMOTER_MAP).find(([, v]) => v === name);
    openModal({ title: `Promoter · ${name}${emp ? ` (${emp[0]})` : ""}`, sub: filterSubtitle("promoter"), stats, views, filterAction: { key: "promoter", value: name } });
  }

  function openConsultant(name) {
    const cm = state.consultantMetrics;
    const leads = cm.rows.filter((r) => r.consultant === name);
    const c = cm.consultants.find((x) => x.name === name) || { leads: 0, responded: 0, salesOrders: 0, converted: 0, responseRate: null, conversionRate: null };
    openModal({
      title: `Consultant · ${name}`,
      sub: filterSubtitle("consultant"),
      stats: [
        { label: "Leads received", value: n(c.leads) },
        { label: "Sales Response", value: n(c.responded) },
        { label: "Response rate", value: pct(c.responseRate) },
        { label: "Sales Orders", value: n(c.salesOrders) },
        { label: "Converted", value: n(c.converted) },
        { label: "Conversion rate", value: pct(c.conversionRate) },
      ],
      views: [
        leadView("Received", leads),
        leadView("Responded", predicateRows("responded", leads)),
        leadView("Sales Orders", predicateRows("salesOrders", leads)),
        leadView("Converted", predicateRows("converted", leads)),
        dailyTableView(leads, [], false),
      ],
      filterAction: { key: "consultant", value: name },
    });
  }

  function openCell(kind, name, metric, days) {
    const src = kind === "promoter" ? state.promoterMetrics : state.consultantMetrics;
    const daySet = days ? new Set(days) : null;
    const when = days ? (days.length > 1 ? ` · week of ${fmtDay(days[0], true)}` : ` · ${fmtDay(days[0], true)}`) : "";
    if (metric === "visitors") {
      const rows = src.visitorRows.filter((v) => v.promoter === name && (!daySet || daySet.has(v.day)));
      openVisitors(rows, `${name} · visitors${when}`);
      return;
    }
    const key = kind === "promoter" ? "promoter" : "consultant";
    const base = src.rows.filter((r) => r[key] === name && (!daySet || daySet.has(r.day)));
    const rows = predicateRows(METRIC_PRED[metric] || "total", base);
    openModal({ title: `${name} · ${METRIC_LABEL[metric] || metric}${when}`, sub: filterSubtitle(key), stats: leadStats(base), views: [leadView(METRIC_LABEL[metric] || "Leads", rows), ...(rows.length !== base.length ? [leadView("All leads", base)] : [])] });
  }

  function openDay(b, scope) {
    const set = new Set(b.days);
    const m = state.metrics;
    const leads = (scope ? scope.leads : m.rows).filter((r) => set.has(r.day));
    const visitors = (scope ? scope.visitors : m.visitorRows).filter((v) => set.has(v.day));
    const title = b.days.length > 1 ? `Week of ${fmtDay(b.key, true)}` : fmtDay(b.key, true);
    const views = [leadView("Leads", leads), leadView("Responded", predicateRows("responded", leads)), leadView("Sales Orders", predicateRows("salesOrders", leads)), leadView("Converted", predicateRows("converted", leads))];
    if (m.hasVisitors) views.splice(1, 0, visitorView("Visitors", visitors));
    const stats = leadStats(leads);
    if (m.hasVisitors) stats.unshift({ label: "Visitors", value: n(visitors.reduce((s, v) => s + v.count, 0)) });
    openModal({ title, sub: filterSubtitle(), stats, views });
  }

  function openRankAll(kind) {
    if (kind === "promoter") {
      const list = state.promoterMetrics.promoters;
      openModal({
        title: "Promoter performance · Visitor → Lead → Conversion",
        sub: `${filterSubtitle("promoter")} · Unknown Promoter excluded from ranking · click a row`,
        views: [{
          label: "Promoters", type: "table", rows: list,
          columns: [
            { h: "#", v: (x) => String(list.indexOf(x) + 1), num: true },
            { h: "Promoter", v: (x) => x.name },
            { h: "Visitors", v: (x) => nOrDash(x.visitors), num: true },
            { h: "Leads registered", v: (x) => n(x.leads), num: true },
            { h: "Sales Response", v: (x) => n(x.responded), num: true },
            { h: "Sales Orders", v: (x) => n(x.salesOrders), num: true },
            { h: "Converted", v: (x) => n(x.converted), num: true },
            { h: "Visitor → Lead", v: (x) => pct(x.visitorToLead), num: true },
            { h: "Lead → Conversion", v: (x) => pct(x.leadToConversion), num: true },
          ],
          onRow: (x) => openPromoter(x.name),
        }],
      });
      return;
    }
    const list = state.consultantMetrics.consultants;
    openModal({
      title: "Consultant performance",
      sub: `${filterSubtitle("consultant")} · click a row for the consultant's leads`,
      views: [{
        label: "Consultants", type: "table", rows: list,
        columns: [
          { h: "#", v: (x) => String(list.indexOf(x) + 1), num: true },
          { h: "Consultant", v: (x) => x.name, dir: true },
          { h: "Leads received", v: (x) => n(x.leads), num: true },
          { h: "Sales Response", v: (x) => n(x.responded), num: true },
          { h: "Response rate", v: (x) => pct(x.responseRate), num: true },
          { h: "Sales Orders", v: (x) => n(x.salesOrders), num: true },
          { h: "Converted", v: (x) => n(x.converted), num: true },
          { h: "Conversion rate", v: (x) => pct(x.conversionRate), num: true },
        ],
        onRow: (x) => openConsultant(x.name),
      }],
    });
  }

  function openModels() {
    const m = state.metrics;
    const list = m.models;
    openModal({
      title: "Model performance",
      sub: `${filterSubtitle()} · click a row for the model's leads`,
      views: [{
        label: "Models", type: "table", rows: list,
        columns: [
          { h: "#", v: (x) => String(list.indexOf(x) + 1), num: true },
          { h: "Model", v: (x) => x.name, dir: true },
          { h: "Leads", v: (x) => n(x.leads), num: true },
          { h: "Sales Response", v: (x) => n(x.responded), num: true },
          { h: "Sales Orders", v: (x) => n(x.salesOrders), num: true },
          { h: "Converted", v: (x) => n(x.converted), num: true },
          { h: "Conversion rate", v: (x) => pct(x.conversionRate), num: true },
        ],
        onRow: (x) => {
          const rows = m.rows.filter((r) => r.modelGroup === x.name);
          openModal({ title: `Model · ${x.name}`, sub: filterSubtitle(), stats: leadStats(rows), views: [leadView("Leads", rows), leadView("Converted", predicateRows("converted", rows))], filterAction: { key: "model", value: x.name } });
        },
      }],
    });
  }

  // ---------- Data & rules / validation ----------

  function openInfo() {
    const ds = state.dataset;
    const c = cfg();
    const col = (key) => {
      const m = ds && ds.mapping.find((x) => x.key === key);
      return m && m.column ? `“${esc(m.column)}” (${m.letter})` : `<i>missing</i>`;
    };
    const mapping = ds ? ds.mapping.map((m) => `<div class="gec-map-item${m.column ? "" : " is-missing"}${!m.column && m.required ? " is-required" : ""}"><span>${esc(m.label)}</span><b>${m.column ? `${esc(m.column)} · ${m.letter}` : (m.required ? "NOT FOUND" : "not in file")}</b></div>`).join("") : "";
    const q = ds && ds.quality;
    const vs = state.visitors;
    const quality = q ? `
      <h4>Data quality</h4>
      <div class="gec-dq-grid">
        <div><span>Source rows</span><b>${n(q.sourceRows)}</b></div>
        <div><span>Unique transactions</span><b>${n(q.uniqueTransactions)}</b></div>
        <div class="${q.duplicateRows ? "warn" : ""}"><span>Duplicate rows</span><b>${n(q.duplicateRows)}</b><em>${n(q.duplicateTransactions)} transactions repeated · latest row kept</em></div>
        <div class="${q.missingTxn ? "warn" : ""}"><span>Missing Transaction No.</span><b>${n(q.missingTxn)}</b><em>rows ignored</em></div>
        <div class="${q.unknownPromoter ? "warn" : ""}"><span>${esc(c.UNKNOWN_PROMOTER)}</span><b>${n(q.unknownPromoter)}</b><em>${n(q.blankEmployee)} blank · ${n(q.unmappedEmployee)} not in the official list</em></div>
        <div><span>NO ORDER</span><b>${n(q.noOrder)}</b><em>${n(q.orderPlaceholders)} other placeholders · ${n(q.actualOrders)} actual orders</em></div>
        <div class="${q.undated ? "warn" : ""}"><span>No readable Created Date</span><b>${n(q.undated)}</b></div>
        <div><span>Visitors</span><b>${vs && vs.ok ? n(vs.total) : "—"}</b><em>${vs && vs.ok ? `${esc(vs.fileName || "")} · sheet “${esc(vs.sheetName)}”` : "no visitor data"}</em></div>
      </div>` : "";
    const promoters = Object.entries(c.PROMOTER_MAP).map(([k, v]) => `<span class="gec-chip">${esc(k)} → ${esc(v)}</span>`).join("");
    const rules = `
      <h4>Business rules</h4>
      <ul>
        <li><b>Lead</b> — one unique ${col("txn")}. Rows without it are ignored; repeated numbers count once (latest row${ds && ds.colMap.modifiedDate != null ? ` by ${col("modifiedDate")}` : " in the sheet"}).</li>
        <li><b>Promoter</b> — ${col("employeeNumber")} looked up in the official list below. Blank or not in the list → <b>${esc(c.UNKNOWN_PROMOTER)}</b> (shown, not ranked).</li>
        <li><b>Sales Response</b> — ${col("salesResponse")} has a real value (not ${c.NO_RESPONSE_VALUES.slice(0, 3).map((x) => `“${esc(x)}”`).join(", ")}…). Sales Order is never used for response.</li>
        <li><b>Sales Order</b> — ${col("salesOrder")} is an actual order number. <b>“NO ORDER”</b> and placeholders (${c.NO_ORDER_VALUES.slice(1, 6).map((x) => `“${esc(x)}”`).join(", ")}…) never count.</li>
        <li><b>Converted</b> — <code>isConverted(${col("status")})</code>: ${c.CONVERSION_STATUSES.map((s) => `<b>${esc(s)}</b>`).join(", ")}. “Won” alone is <b>not</b> converted.</li>
        <li><b>Conversion rate</b> = converted ÷ total leads. <b>Response rate</b> = responded ÷ total leads.</li>
        <li><b>Visitors</b> — separate dataset (Date · Promoter · Visit Purpose). Visitor → Lead = leads ÷ visitors (date & promoter filters only).</li>
        <li><b>Consultant</b> — ${col("consultant")}; performance is measured on the leads each consultant received.</li>
        <li><b>Response time / SLA</b> — calculated but not shown until validated (<code>SHOW_TIMING</code>).</li>
      </ul>
      <h4>Official promoter list</h4><div class="gec-chips">${promoters}</div>`;
    const sheets = ds ? `<h4>Sheets in file</h4><ul>${ds.sheets.map((s) => `<li>${esc(s.name)} — ${n(s.rows)} rows, ${s.fields} recognised columns${s.name === ds.sheetName ? " <b>(leads)</b>" : ""}${vs && vs.ok && s.name === vs.sheetName ? " <b>(visitors)</b>" : ""}</li>`).join("")}</ul>` : "";
    const warnList = [...((ds && ds.warnings) || []), ...((vs && vs.warnings) || [])];
    const warn = warnList.length ? `<h4>Notes</h4><ul>${warnList.map((w) => `<li class="gec-warn-line">${esc(w)}</li>`).join("")}</ul>` : "";
    openModal({
      title: "Data source, rules & quality",
      sub: ds ? `${ds.fileName || "GEC File"} · sheet “${ds.sheetName}” · header row ${ds.headerRow}` : "No GEC File loaded",
      html: `<div class="gec-map-grid">${mapping}</div><div class="gec-rules">${quality}${rules}${warn}${sheets}
        ${state.debug ? `<p class="gec-debug-hint"><button type="button" class="gec-btn" data-act="validate">Open validation</button> Management targets, promoter mapping check and raw-cell reconciliation.</p>` : ""}</div>`,
      foot: "Columns are detected from the header row (Employee Number = column R), so next month's file works without changes.",
    });
  }

  const passPill = (ok, fail) => (ok ? '<span class="gec-pill s-converted">PASS</span>' : `<span class="gec-flag">${fail || "MISMATCH"}</span>`);
  const tbl = (head, rows) => `<table class="gec-table"><thead><tr>${head.map((h) => `<th class="${h.num ? "num" : ""}">${esc(h.h || h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;

  function openValidation() {
    const ds = state.dataset;
    const res = Data().validate(ds, state.filters, { visitors: state.visitors, slaMinutes: state.ctx.slaMinutes });
    if (!res.totals) { openModal({ title: "Validation", sub: "No dataset loaded", html: `<div class="gec-rules"><p>No GEC File loaded.</p></div>` }); return; }
    const tg = res.targets;
    const passed = res.checks.filter((c) => c.pass).length;
    const tgHtml = tg.rows.length
      ? tbl(["Management KPI", { h: "Approved", num: true }, { h: "Calculated", num: true }, "Result"], tg.rows.map((r) =>
        `<tr class="${r.pass ? "" : "is-bad"}"><td>${esc(r.label)}</td><td class="num">${esc(r.expected)}</td><td class="num">${esc(r.actual)}</td><td>${passPill(r.pass)}</td></tr>`))
      : `<p class="gec-pad">${esc(tg.label)}.</p>`;
    const pc = res.promoterCheck;
    const pcHtml = tbl(["Promoter", { h: "Leads", num: true }], [
      ...pc.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${n(r.count)}</td></tr>`),
      `<tr class="is-total"><td>TOTAL</td><td class="num">${n(pc.total)}</td></tr>`,
    ]) + `<p class="gec-pad ${pc.ok && (pc.expectedTotal == null || pc.total === pc.expectedTotal) ? "" : "gec-warn-line"}">${
      !pc.ok ? `⚠ Promoter total ${n(pc.total)} ≠ leads ${n(pc.leads)}`
        : pc.expectedTotal != null && pc.total !== pc.expectedTotal ? `⚠ Total ${n(pc.total)} ≠ approved ${n(pc.expectedTotal)}`
          : `Known + Unknown = ${n(pc.total)} ✓`} · Employee Number column ${esc(pc.column)}</p>`;
    const b = res.breakdowns;
    const statusHtml = tbl(["Status", { h: "Leads", num: true }, "isConverted"], b.status.map((s) =>
      `<tr><td>${esc(s.value)}</td><td class="num">${n(s.count)}</td><td>${s.converted ? '<span class="gec-pill s-converted">Yes</span>' : "No"}</td></tr>`));
    const soHtml = tbl(["Sales Order class", { h: "Leads", num: true }], b.salesOrder.map((s) =>
      `<tr><td>${esc({ order: "Actual order (counted)", noOrder: "NO ORDER (excluded)", placeholder: "Placeholder (excluded)", blank: "Blank" }[s.value] || s.value)}</td><td class="num">${n(s.count)}</td></tr>`))
      + (b.salesOrderPlaceholders.length ? tbl(["Excluded value", { h: "Leads", num: true }], b.salesOrderPlaceholders.map((s) => `<tr><td>“${esc(s.value)}”</td><td class="num">${n(s.count)}</td></tr>`)) : "");
    const respHtml = tbl(["Sales Response", { h: "Leads", num: true }], b.responseValues.map((s) => `<tr><td>${esc(s.value)}</td><td class="num">${n(s.count)}</td></tr>`));
    const empHtml = b.employees.length ? tbl(["Unknown Employee Number", { h: "Leads", num: true }], b.employees.map((s) => `<tr><td>${esc(s.value)}</td><td class="num">${n(s.count)}</td></tr>`)) : `<p class="gec-pad">All employee numbers are official promoters.</p>`;
    const t = res.totals;
    const kRows = [["Total Visitors", "visitors"], ["Total Leads", "total"], ["Visitor → Lead", "visitorToLead", true], ["Known Promoter", "knownPromoter"], ["Unknown Promoter", "unknownPromoter"],
      ["Sales Response", "responded"], ["Response rate", "responseRate", true], ["Actual Sales Orders", "salesOrders"], ["Sales Order rate", "salesOrderRate", true], ["NO ORDER", "noOrder"],
      ["Converted", "converted"], ["Conversion rate", "conversionRate", true], ["Unassigned", "unassigned"]];
    const fmtK = (v, p) => (p ? pct(v, 2) : nOrDash(v));
    const kpiHtml = tbl(["KPI", { h: "Filtered", num: true }, { h: "Whole file", num: true }], kRows.map(([l, k, p]) => `<tr><td>${l}</td><td class="num">${fmtK(t.filtered[k], p)}</td><td class="num">${fmtK(t.all[k], p)}</td></tr>`));
    const checksHtml = tbl(["Reconciliation check", { h: "Raw cells / expected", num: true }, { h: "Dashboard", num: true }, "Result", "Note"], res.checks.map((c) =>
      `<tr class="${c.pass ? "" : "is-bad"}"><td>${esc(c.name)}</td><td class="num">${esc(c.expected)}</td><td class="num">${esc(c.actual)}</td><td>${passPill(c.pass, "FAIL")}</td><td>${esc(c.detail)}</td></tr>`));
    const daysHtml = tbl(["Day", { h: "Visitors", num: true }, { h: "Leads", num: true }, { h: "Resp.", num: true }, { h: "SO", num: true }, { h: "Conv.", num: true }], t.days.map((d) =>
      `<tr><td>${fmtDay(d.key, true)}</td><td class="num">${nOrDash(d.visitors)}</td><td class="num">${n(d.leads)}</td><td class="num">${n(d.responded)}</td><td class="num">${n(d.salesOrders)}</td><td class="num">${n(d.converted)}</td></tr>`));
    const allTargets = tg.rows.length && tg.passed === tg.rows.length;
    openModal({
      title: "Developer validation",
      sub: `${tg.rows.length ? `Management targets ${tg.passed}/${tg.rows.length}` : "No management targets for this period"} · reconciliation ${passed}/${res.checks.length} · filters: ${filterSubtitle()}`,
      stats: [
        { label: "Management targets", value: tg.rows.length ? `${tg.passed} / ${tg.rows.length}` : "—", cls: tg.rows.length ? (allTargets ? "is-ok" : "is-bad") : "" },
        { label: "Reconciliation", value: `${passed} / ${res.checks.length}`, cls: passed === res.checks.length ? "is-ok" : "is-bad" },
        { label: "Promoter mapping", value: `${n(pc.total)} / ${n(pc.leads)}`, cls: pc.ok ? "is-ok" : "is-bad" },
      ],
      html: `<div class="gec-valid">
        <section><h4>Management targets · ${esc(tg.label)}</h4>${tgHtml}<p class="gec-pad gec-dim">Whole file, no filters. Calculated values come only from the Excel rows — targets are never displayed on the dashboard.</p></section>
        <section><h4>Promoter Mapping Check</h4>${pcHtml}</section>
        <section><h4>KPI totals</h4>${kpiHtml}</section>
        <section><h4>Status → isConverted()</h4>${statusHtml}</section>
        <section><h4>Sales Order values</h4>${soHtml}</section>
        <section><h4>Sales Response values</h4>${respHtml}</section>
        <section><h4>Unknown Promoter · employee numbers</h4>${empHtml}</section>
        <section><h4>Daily totals (filtered)</h4>${daysHtml}</section>
        <section class="span2"><h4>Reconciliation · independent pass over raw sheet cells</h4>${checksHtml}</section>
      </div>`,
      foot: "Developer only. A MISMATCH means the file or a rule differs from the approved numbers — fix the rule or the data, never the display.",
    });
  }

  // ---------- Public API ----------

  function render(host, dataset, ctx) {
    if (!host || !Data()) return;
    if (!state.root || state.host !== host || !host.contains(state.root)) {
      if (state.chart) { state.chart.destroy(); state.chart = null; }
      if (state.resizeObserver) state.resizeObserver.disconnect();
      build(host);
    }
    state.dataset = dataset && dataset.records ? dataset : null;
    state.ctx = ctx || {};
    const extVisitors = state.ctx.visitors && state.ctx.visitors.ok ? state.ctx.visitors : null;
    state.visitors = extVisitors || (state.dataset && state.dataset.visitors) || null;
    const sig = datasetSig(state.dataset, state.visitors);
    if (sig !== state.sig) {
      state.sig = sig;
      state.filters = { ...EMPTY_FILTERS };
      if (!el("modal").hidden) closeModal();
    }
    renderAll();
  }

  global.GecDashboard = { render, state };
})(typeof window !== "undefined" ? window : globalThis);
