/**
 * GEC Control Center · one-screen executive dashboard.
 * Renders a GecData dataset into a fixed 100vh layout (no page scroll); all detail lives in modals.
 * Usage: GecDashboard.render(hostEl, dataset, { lastUpdated, onRefresh, onExit })
 */
(function (global) {
  const Data = () => global.GecData;

  const state = {
    host: null,
    root: null,
    dataset: null,
    ctx: {},
    sig: "",
    filters: { from: "", to: "", promoter: "", model: "", source: "", status: "" },
    metrics: null,
    chart: null,
    resizeObserver: null,
    resizeTimer: null,
    modal: { rows: [], columns: [], search: "", allCols: false, onRow: null, kind: "records" },
  };

  const fmtInt = new Intl.NumberFormat("en-US");
  const n = (v) => fmtInt.format(Math.round(Number(v) || 0));
  const pct = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function hoursHtml(h) {
    if (h == null) return "—";
    if (h < 1) return `${Math.round(h * 60)}<small>min</small>`;
    if (h < 48) return `${h.toFixed(1)}<small>h</small>`;
    return `${(h / 24).toFixed(1)}<small>d</small>`;
  }
  function hoursText(h) {
    if (h == null) return "";
    if (h < 1) return `${Math.round(h * 60)} min`;
    if (h < 48) return `${h.toFixed(1)} h`;
    return `${(h / 24).toFixed(1)} d`;
  }
  function fmtDay(key, withYear) {
    const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "—";
    return `${+m[3]} ${MONTHS[+m[2] - 1]}${withYear ? ` ${m[1]}` : ""}`;
  }
  function fmtDate(d, withTime) {
    if (!(d instanceof Date) || isNaN(d)) return "";
    const base = `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    if (!withTime || (d.getHours() === 0 && d.getMinutes() === 0)) return base;
    return `${base} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function daysBetween(from, to) {
    const a = from ? new Date(`${from}T00:00:00`) : null;
    const b = to ? new Date(`${to}T00:00:00`) : null;
    if (!a || !b || isNaN(a) || isNaN(b)) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const slaHours = () => (state.dataset && state.dataset.slaHours) || Data().config.slaHours;

  const KPIS = [
    { key: "total", label: "Total Leads", color: "var(--gec-leads)" },
    { key: "assigned", label: "Assigned", color: "var(--gec-assigned)" },
    { key: "salesOrders", label: "Sales Orders", color: "var(--gec-so)" },
    { key: "converted", label: "Converted", color: "var(--gec-conv)" },
    { key: "conversionRate", label: "Conversion Rate", color: "var(--gec-conv)" },
    { key: "avgResponseHours", label: "Avg Response Time", color: "var(--gec-resp)" },
    { key: "unassigned", label: "Unassigned", color: "var(--gec-warn)", alert: true },
    { key: "overSla", label: "Over SLA", color: "var(--gec-bad)", alert: true },
  ];
  const STAGE_COLORS = {
    leads: "var(--gec-leads)", assigned: "var(--gec-assigned)", responded: "var(--gec-resp)",
    salesOrders: "var(--gec-so)", converted: "var(--gec-conv)",
  };
  const ALERTS = [
    { key: "unassigned", label: "Unassigned", color: "var(--gec-warn)" },
    { key: "overSla", label: "Over SLA", color: "var(--gec-bad)" },
    { key: "noResponse", label: "No Response", color: "var(--gec-so)" },
    { key: "failed", label: "Failed / Rejected", color: "var(--gec-bad)" },
  ];
  const DRILL_TITLES = {
    total: "All leads", leads: "All leads", assigned: "Assigned leads", responded: "Leads with a sales response",
    salesOrders: "Leads with a sales order", converted: "Converted leads", conversionRate: "Converted leads",
    avgResponseHours: "Leads with a measured response time", unassigned: "Unassigned leads",
    overSla: "Leads over SLA", noResponse: "Assigned leads with no sales response", failed: "Failed / rejected leads",
  };

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
              <button type="button" class="gec-btn" data-act="info" title="Detected sheet, columns and KPI rules">Data</button>
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
            <label class="gec-filter" data-fwrap="model"><span>Model</span><select data-f="model"></select></label>
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
              <h2>Performance Trend <span data-el="trend-unit">by lead date</span></h2>
              <div class="gec-legend">
                <span><i style="background:rgba(90,169,255,.55)"></i>Leads</span>
                <span><i style="background:var(--gec-so)"></i>Sales Orders</span>
                <span><i style="background:var(--gec-conv)"></i>Converted</span>
              </div>
            </div>
            <div class="gec-chart"><canvas data-el="chart" aria-label="Leads, sales orders and converted over time"></canvas></div>
          </article>
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Conversion Journey</h2>
              <span class="gec-legend"><span>% of leads</span></span>
            </div>
            <div class="gec-funnel" data-el="funnel"></div>
          </article>
        </section>

        <section class="gec-lower">
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Promoter Performance</h2>
              <button type="button" class="gec-link" data-drill="rank-all" data-kind="promoter" data-el="promoter-all"></button>
            </div>
            <div class="gec-rank" data-el="promoter"></div>
          </article>
          <article class="gec-panel gec-surface">
            <div class="gec-panel-head">
              <h2>Model Performance</h2>
              <button type="button" class="gec-link" data-drill="rank-all" data-kind="model" data-el="model-all"></button>
            </div>
            <div class="gec-rank" data-el="model"></div>
          </article>
        </section>

        <footer class="gec-alerts gec-surface" data-el="alerts"></footer>

        <div class="gec-empty gec-surface" data-el="empty" hidden></div>

        <div class="gec-modal" data-el="modal" hidden>
          <div class="gec-modal-card" role="dialog" aria-modal="true" aria-labelledby="gec-modal-title">
            <div class="gec-modal-head">
              <div><h3 id="gec-modal-title" data-el="m-title"></h3><p data-el="m-sub"></p></div>
              <div class="gec-modal-tools">
                <input type="search" data-el="m-search" placeholder="Search records…" aria-label="Search records" />
                <label data-el="m-allcols-wrap"><input type="checkbox" data-el="m-allcols" /> All Excel columns</label>
                <button type="button" class="gec-btn" data-act="modal-close">Close</button>
              </div>
            </div>
            <div class="gec-modal-stats" data-el="m-stats"></div>
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
      if (act) { onAction(act.dataset.act); return; }
      const drill = e.target.closest("[data-drill]");
      if (drill) { onDrill(drill); return; }
      const row = e.target.closest("tr[data-row]");
      if (row && state.modal.onRow) { state.modal.onRow(Number(row.dataset.row)); return; }
      if (e.target === el("modal")) closeModal();
    });
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !el("modal").hidden) { e.stopPropagation(); closeModal(); return; }
      if ((e.key === "Enter" || e.key === " ") && e.target.matches("tr[data-row]") && state.modal.onRow) {
        e.preventDefault();
        state.modal.onRow(Number(e.target.dataset.row));
      }
    });
    root.addEventListener("change", (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (f) {
        state.filters[f] = e.target.value || "";
        if (f === "from" && state.filters.to && state.filters.from > state.filters.to) state.filters.to = state.filters.from;
        if (f === "to" && state.filters.from && state.filters.to < state.filters.from) state.filters.from = state.filters.to;
        renderAll();
        return;
      }
      if (e.target === el("m-allcols")) { state.modal.allCols = e.target.checked; renderModalTable(); }
    });
    el("m-search").addEventListener("input", (e) => { state.modal.search = e.target.value; renderModalTable(); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && state.root && !el("modal").hidden) closeModal();
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
          renderRank("promoter");
          renderRank("model");
        }, 80);
      });
      state.resizeObserver.observe(root);
    }
  }

  function onAction(act) {
    if (act === "refresh" && typeof state.ctx.onRefresh === "function") state.ctx.onRefresh();
    else if (act === "exit") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (typeof state.ctx.onExit === "function") state.ctx.onExit();
    } else if (act === "fullscreen") {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => {});
    } else if (act === "reset") {
      resetFilters();
      renderAll();
    } else if (act === "info") openInfo();
    else if (act === "modal-close") closeModal();
  }

  function onDrill(node) {
    const kind = node.dataset.drill;
    if (kind === "kpi") openPredicate(node.dataset.key);
    else if (kind === "promoter" || kind === "model") openEntity(kind, node.dataset.name);
    else if (kind === "rank-all") openRankAll(node.dataset.kind);
  }

  // ---------- Filters ----------

  function datasetSig(ds) {
    if (!ds) return "";
    return [ds.fileName, ds.sheetName, ds.records.length, ds.range.from, ds.range.to].join("|");
  }

  function resetFilters() {
    const r = (state.dataset && state.dataset.range) || { from: "", to: "" };
    state.filters = { from: r.from, to: r.to, promoter: "", model: "", source: "", status: "" };
  }

  function renderFilterControls() {
    const ds = state.dataset;
    const opts = ds ? Data().filterOptions(ds) : { promoters: [], models: [], sources: [], statuses: [] };
    const fill = (key, list, allLabel) => {
      const sel = state.root.querySelector(`[data-f="${key}"]`);
      const cur = state.filters[key];
      sel.innerHTML = `<option value="">${allLabel}</option>` + list.map((v) =>
        `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
      sel.disabled = !list.length;
      state.root.querySelector(`[data-fwrap="${key}"]`).classList.toggle("is-active", !!cur);
    };
    fill("promoter", opts.promoters, "All promoters");
    fill("model", opts.models, "All models");
    fill("source", opts.sources, "All sources");
    fill("status", opts.statuses, "All statuses");
    const from = state.root.querySelector('[data-f="from"]');
    const to = state.root.querySelector('[data-f="to"]');
    const r = (ds && ds.range) || {};
    [from, to].forEach((inp) => {
      inp.min = r.from || "";
      inp.max = r.to || "";
      inp.disabled = !r.from;
    });
    from.value = state.filters.from || "";
    to.value = state.filters.to || "";
    const dateActive = !!r.from && (state.filters.from !== r.from || state.filters.to !== r.to);
    state.root.querySelector('[data-fwrap="date"]').classList.toggle("is-active", dateActive);
  }

  // ---------- Render ----------

  function renderAll() {
    const ds = state.dataset;
    state.metrics = Data().compute(ds, state.filters);
    renderFilterControls();
    renderHeader();
    renderKpis();
    renderTrend();
    renderFunnel();
    requestAnimationFrame(() => {
      renderRank("promoter");
      renderRank("model");
    });
    renderAlerts();
    renderEmpty();
  }

  function renderHeader() {
    const ds = state.dataset;
    const m = state.metrics;
    const { from, to } = m.range;
    el("range").textContent = from ? `${fmtDay(from, true)}  —  ${fmtDay(to, true)}` : "No dates";
    const days = daysBetween(from, to);
    el("range-sub").textContent = ds && ds.ok
      ? `Reporting period${days ? ` · ${days} days` : ""} · ${ds.fileName || ds.sheetName}`
      : "Waiting for GEC File";
    const live = el("live");
    live.classList.toggle("is-off", !(ds && ds.ok));
    live.lastChild.textContent = ds && ds.ok ? "LIVE" : "NO DATA";
    const at = Number(state.ctx.lastUpdated) || 0;
    el("updated").textContent = at ? new Date(at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    const filtered = m.rows.length !== m.totalAll;
    el("filter-note").textContent = ds && ds.ok ? `${n(m.rows.length)} of ${n(m.totalAll)} leads${filtered ? " · filtered" : ""}` : "";
  }

  function renderKpis() {
    const k = state.metrics.kpis;
    const total = k.total || 0;
    const share = (v) => (total ? v / total : 0);
    const days = Math.max(1, daysBetween(state.metrics.range.from, state.metrics.range.to));
    const sla = slaHours();
    const cfg = {
      total: { val: n(total), sub: `<b>${(total / days).toFixed(1)}</b> leads / day`, p: 1 },
      assigned: { val: n(k.assigned), sub: `<b>${pct(share(k.assigned))}</b> of leads`, p: share(k.assigned) },
      salesOrders: { val: n(k.salesOrders), sub: `<b>${pct(share(k.salesOrders))}</b> of leads`, p: share(k.salesOrders) },
      converted: { val: n(k.converted), sub: `<b>${pct(k.salesOrders ? k.converted / k.salesOrders : 0)}</b> of sales orders`, p: share(k.converted) },
      conversionRate: { val: pct(k.conversionRate), sub: "Leads → converted", p: k.conversionRate },
      avgResponseHours: {
        val: hoursHtml(k.avgResponseHours),
        sub: k.timedCount ? `<b>${n(k.timedCount)}</b> timed · SLA ${sla}h` : "No response times in file",
        p: k.avgResponseHours == null ? 0 : Math.min(1, k.avgResponseHours / sla),
      },
      unassigned: { val: n(k.unassigned), sub: `<b>${pct(share(k.unassigned))}</b> of leads waiting`, p: share(k.unassigned) },
      overSla: { val: n(k.overSla), sub: `<b>${pct(share(k.overSla))}</b> of leads · SLA ${sla}h`, p: share(k.overSla) },
    };
    el("kpis").innerHTML = KPIS.map((d) => {
      const c = cfg[d.key];
      const hot = d.alert && (k[d.key] || 0) > 0;
      return `<button type="button" class="gec-kpi gec-surface${hot ? " is-alert" : ""}" style="--k:${d.color}" data-drill="kpi" data-key="${d.key}" title="Open ${esc(DRILL_TITLES[d.key])}">
        <span class="gec-kpi-lab">${esc(d.label)}</span>
        <span class="gec-kpi-val gec-num">${c.val}</span>
        <span class="gec-kpi-sub">${c.sub}</span>
        <span class="gec-kpi-meter"><i style="--p:${(Math.max(0, Math.min(1, c.p || 0)) * 100).toFixed(1)}%"></i></span>
      </button>`;
    }).join("");
  }

  function trendLabel(b, unit) {
    return unit === "week" ? `Wk ${fmtDay(b.key)}` : fmtDay(b.key);
  }

  function renderTrend() {
    const canvas = el("chart");
    const { unit, buckets } = state.metrics.trend;
    el("trend-unit").textContent = unit === "week" ? "weekly · by lead date" : "daily · by lead date";
    if (typeof global.Chart === "undefined") return;
    const labels = buckets.map((b) => trendLabel(b, unit));
    const data = {
      labels,
      datasets: [
        {
          type: "bar", label: "Leads", data: buckets.map((b) => b.leads), order: 3,
          backgroundColor: "rgba(90,169,255,0.32)", hoverBackgroundColor: "rgba(90,169,255,0.55)",
          borderColor: "rgba(90,169,255,0.7)", borderWidth: { top: 1.5, right: 0, bottom: 0, left: 0 },
          borderRadius: 3, barPercentage: 0.78, categoryPercentage: 0.9,
        },
        {
          type: "line", label: "Sales Orders", data: buckets.map((b) => b.salesOrders), order: 2,
          borderColor: "#f2b24c", backgroundColor: "#f2b24c", borderWidth: 2, cubicInterpolationMode: "monotone",
          pointRadius: buckets.length > 40 ? 0 : 2.5, pointHoverRadius: 5,
        },
        {
          type: "line", label: "Converted", data: buckets.map((b) => b.converted), order: 1,
          borderColor: "#34d399", backgroundColor: "rgba(52,211,153,0.12)", borderWidth: 2.2, cubicInterpolationMode: "monotone", fill: true,
          pointRadius: buckets.length > 40 ? 0 : 2.5, pointHoverRadius: 5,
        },
      ],
    };
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
                return state.metrics.trend.unit === "week"
                  ? `Week of ${fmtDay(b.key, true)}`
                  : fmtDay(b.key, true);
              },
              footer: (items) => {
                const b = state.metrics.trend.buckets[items[0].dataIndex];
                return b && b.leads ? `Conversion ${pct(b.converted / b.leads)} · click for records` : "";
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: "rgba(148,163,184,0.18)" },
            ticks: { color: "#8d9bb0", font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 16 },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(148,163,184,0.08)" },
            border: { display: false },
            ticks: { color: "#6f7d92", font: { size: 11 }, precision: 0, maxTicksLimit: 5 },
          },
        },
        onClick: (evt, _els, chart) => {
          const pts = chart.getElementsAtEventForMode(evt, "index", { intersect: false }, true);
          if (!pts.length) return;
          const b = state.metrics.trend.buckets[pts[0].index];
          if (b) openBucket(b);
        },
        onHover: (evt, els) => {
          const t = evt.native && evt.native.target;
          if (t) t.style.cursor = els.length ? "pointer" : "default";
        },
      },
    });
  }

  function renderFunnel() {
    const stages = state.metrics.funnel;
    const max = Math.max(1, stages[0].count);
    el("funnel").innerHTML = stages.map((s, i) => {
      const w = Math.max(14, (s.count / max) * 100);
      const step = i === 0 ? "Entry" : `<b>${pct(s.pctOfPrev)}</b> of ${esc(stages[i - 1].label.toLowerCase())}`;
      return `<button type="button" class="gec-stage" style="--c:${STAGE_COLORS[s.key]}" data-drill="kpi" data-key="${s.key}" title="Open ${esc(DRILL_TITLES[s.key])}">
        <span class="gec-stage-lab"><strong>${esc(s.label)}</strong><span>${step}</span></span>
        <span class="gec-stage-track"><span class="gec-stage-bar gec-num" style="--w:${w.toFixed(1)}%">${n(s.count)}</span></span>
        <span class="gec-stage-pct gec-num">${pct(s.pctOfLeads)}<small>of leads</small></span>
      </button>`;
    }).join("");
  }

  const ROW_MIN_PX = 24;

  function renderRank(kind) {
    const box = el(kind);
    if (!box || !state.metrics) return;
    const list = kind === "promoter" ? state.metrics.promoters : state.metrics.models;
    const allBtn = el(`${kind}-all`);
    allBtn.textContent = list.length ? `View all ${n(list.length)} →` : "";
    if (!list.length) {
      box.innerHTML = `<div class="gec-rank-more">No ${kind === "promoter" ? "promoter" : "model"} data for this selection.</div>`;
      return;
    }
    box.innerHTML = `
      <div class="gec-rank-grid gec-rank-colhead"><span>#</span><span>${kind === "promoter" ? "Promoter" : "Model"}</span><span>Leads · converted</span><span class="r">Leads</span><span class="r">Conv.</span><span class="r">Rate</span></div>
      <div class="gec-rank-body" data-rank-body></div>`;
    const body = box.querySelector("[data-rank-body]");
    const fit = Math.max(1, Math.floor((body.clientHeight || ROW_MIN_PX * 4) / ROW_MIN_PX));
    const shown = list.slice(0, fit);
    const maxLeads = Math.max(1, ...shown.map((x) => x.leads));
    const avgRate = state.metrics.kpis.conversionRate;
    body.innerHTML = shown.map((x, i) => `
      <button type="button" class="gec-rank-row gec-rank-grid" data-drill="${kind}" data-name="${esc(x.name)}" title="${esc(x.name)} · ${n(x.leads)} leads · ${n(x.converted)} converted · ${pct(x.rate)}">
        <span class="n gec-num">${i + 1}</span>
        <span class="name">${esc(x.name)}</span>
        <span class="gec-rank-bar"><i class="lead" style="width:${((x.leads / maxLeads) * 100).toFixed(1)}%"></i><i class="conv" style="width:${((x.converted / maxLeads) * 100).toFixed(1)}%"></i></span>
        <span class="r gec-num">${n(x.leads)}</span>
        <span class="r gec-num">${n(x.converted)}</span>
        <span class="r rate gec-num${x.rate < avgRate ? " is-low" : ""}">${pct(x.rate)}</span>
      </button>`).join("");
  }

  function renderAlerts() {
    const k = state.metrics.kpis;
    const ds = state.dataset;
    el("alerts").innerHTML = `<span class="gec-alerts-title">Alerts</span>` + ALERTS.map((a) => {
      const v = k[a.key] || 0;
      return `<button type="button" class="gec-alert${v > 0 ? " is-hot" : ""}" style="--a:${a.color}" data-drill="kpi" data-key="${a.key}" title="Open ${esc(DRILL_TITLES[a.key])}">
        <i></i>${esc(a.label)}<b class="gec-num">${n(v)}</b></button>`;
    }).join("") + `<span class="gec-foot-meta">${ds && ds.ok
      ? `Sheet <b>${esc(ds.sheetName)}</b> · header row ${ds.headerRow} · SLA ${slaHours()}h${ds.warnings.length ? ` · <b>${ds.warnings.length} data note${ds.warnings.length > 1 ? "s" : ""}</b> (Data)` : ""}`
      : "Upload the GEC File in Admin Push"}</span>`;
  }

  function renderEmpty() {
    const box = el("empty");
    const ds = state.dataset;
    if (ds && ds.ok) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = ds
      ? `<div><strong>GEC File could not be read</strong>${esc(ds.warnings[0] || "No lead rows found.")}<br/>Click <b>Data</b> to see which sheets and columns were detected.</div>`
      : `<div><strong>No GEC File pushed yet</strong>Open <b>Admin Push</b>, upload the <b>GEC File</b> (September, October …) and click <b>Push to live</b>.</div>`;
  }

  // ---------- Modals ----------

  function baseColumns(rows) {
    const cols = [
      { h: "Lead date", v: (r) => fmtDate(r.date, true), sort: (r) => (r.date ? r.date.getTime() : 0) },
      { h: "Lead ID", v: (r) => r.id },
      { h: "Customer", v: (r) => r.customer },
      { h: "Promoter", v: (r) => (r.promoter === "Unspecified" ? "" : r.promoter) },
      { h: "Model", v: (r) => (r.model === "Unspecified" ? "" : r.model) },
      { h: "Source", v: (r) => (r.source === "Unspecified" ? "" : r.source) },
      { h: "Status", v: (r) => r.status },
      { h: "Assigned to", v: (r) => r.assignedTo },
      { h: "Response", v: (r) => hoursText(r.responseHours), num: true },
      { h: "Sales order", v: (r) => r.salesOrder || (r.salesOrderAt ? fmtDate(r.salesOrderAt) : "") },
      { h: "Stage", v: (r) => r.stage, html: (r) => `<span class="gec-pill s-${slug(r.stage)}">${esc(r.stage)}</span>` },
      { h: "SLA", v: (r) => (r.overSla ? "Over" : ""), html: (r) => (r.overSla ? `<span class="gec-flag">Over</span>` : "") },
    ];
    return cols.filter((c) => c.h === "Stage" || rows.some((r) => String(c.v(r) || "").trim() !== ""));
  }

  function rawColumns() {
    const headers = (state.dataset && state.dataset.headers) || [];
    return [
      { h: "Stage", v: (r) => r.stage, html: (r) => `<span class="gec-pill s-${slug(r.stage)}">${esc(r.stage)}</span>` },
      ...headers.map((h) => ({
        h,
        v: (r) => {
          const val = r.raw[h];
          return val instanceof Date ? fmtDate(val, true) : String(val ?? "");
        },
      })),
    ];
  }

  function openModal({ title, sub, rows, columns, stats, onRow, kind }) {
    const m = state.modal;
    m.rows = rows;
    m.columns = columns || null;
    m.search = "";
    m.allCols = false;
    m.onRow = onRow || null;
    m.kind = kind || "records";
    el("m-title").textContent = title;
    el("m-sub").textContent = sub || "";
    el("m-search").value = "";
    el("m-allcols").checked = false;
    el("m-allcols-wrap").hidden = m.kind !== "records";
    el("m-search").hidden = m.kind === "info";
    el("m-stats").innerHTML = (stats || []).map((s) => `<div class="gec-mstat">${esc(s.label)}<b class="gec-num">${s.value}</b></div>`).join("");
    el("modal").hidden = false;
    if (m.kind === "info") return;
    renderModalTable();
    setTimeout(() => el("m-search").focus(), 30);
  }

  function closeModal() {
    el("modal").hidden = true;
    state.modal.rows = [];
    el("m-body").innerHTML = "";
  }

  const MODAL_MAX_ROWS = 2000;

  function renderModalTable() {
    const m = state.modal;
    const cols = m.columns || (m.allCols ? rawColumns() : baseColumns(m.rows));
    const q = m.search.trim().toLowerCase();
    const idx = m.rows.map((r, i) => i).filter((i) => !q || cols.some((c) => String(c.v(m.rows[i]) || "").toLowerCase().includes(q)));
    const shown = idx.slice(0, MODAL_MAX_ROWS);
    el("m-body").innerHTML = `<table class="gec-table"><thead><tr>${cols.map((c) => `<th class="${c.num ? "num" : ""}">${esc(c.h)}</th>`).join("")}</tr></thead>
      <tbody>${shown.map((i) => {
        const r = m.rows[i];
        return `<tr${m.onRow ? ` class="is-click" data-row="${i}" tabindex="0"` : ""}>${cols.map((c) => {
          const text = String(c.v(r) ?? "");
          return `<td class="${c.num ? "num" : ""}" title="${esc(text)}">${c.html ? c.html(r) : esc(text)}</td>`;
        }).join("")}</tr>`;
      }).join("")}</tbody></table>`;
    el("m-foot").textContent = idx.length > MODAL_MAX_ROWS
      ? `Showing first ${n(MODAL_MAX_ROWS)} of ${n(idx.length)} — refine with search`
      : `${n(idx.length)} record${idx.length === 1 ? "" : "s"}${q ? ` matching “${m.search}”` : ""}`;
  }

  function summaryStats(rows) {
    const c = (p) => rows.reduce((s, r) => s + (p(r) ? 1 : 0), 0);
    const timed = rows.filter((r) => r.responseHours != null);
    const avg = timed.length ? timed.reduce((s, r) => s + r.responseHours, 0) / timed.length : null;
    const conv = c((r) => r.converted);
    return [
      { label: "Leads", value: n(rows.length) },
      { label: "Assigned", value: n(c((r) => r.assigned)) },
      { label: "Sales orders", value: n(c((r) => r.hasSalesOrder)) },
      { label: "Converted", value: n(conv) },
      { label: "Conversion", value: pct(rows.length ? conv / rows.length : 0) },
      { label: "Avg response", value: hoursText(avg) || "—" },
      { label: "Over SLA", value: n(c((r) => r.overSla)) },
    ];
  }

  function filterSubtitle() {
    const f = state.filters;
    const parts = [];
    if (f.from) parts.push(`${fmtDay(f.from, true)} – ${fmtDay(f.to, true)}`);
    ["promoter", "model", "source", "status"].forEach((k) => { if (f[k]) parts.push(f[k]); });
    return parts.join(" · ");
  }

  function openPredicate(key) {
    const pred = Data().PREDICATES[key];
    if (!pred) return;
    let rows = state.metrics.rows.filter(pred);
    if (key === "avgResponseHours") rows = rows.slice().sort((a, b) => b.responseHours - a.responseHours);
    openModal({ title: DRILL_TITLES[key] || "Leads", sub: filterSubtitle(), rows, stats: summaryStats(rows) });
  }

  function openBucket(b) {
    const set = new Set(b.days);
    const rows = state.metrics.rows.filter((r) => set.has(r.day));
    const title = state.metrics.trend.unit === "week" ? `Leads · week of ${fmtDay(b.key, true)}` : `Leads · ${fmtDay(b.key, true)}`;
    openModal({ title, sub: filterSubtitle(), rows, stats: summaryStats(rows) });
  }

  function topOf(rows, key, count) {
    const map = new Map();
    rows.forEach((r) => map.set(r[key], (map.get(r[key]) || 0) + 1));
    return [...map.entries()].filter(([k]) => k && k !== "Unspecified").sort((a, b) => b[1] - a[1]).slice(0, count);
  }

  function openEntity(kind, name) {
    const rows = state.metrics.rows.filter((r) => r[kind] === name);
    const other = kind === "promoter" ? "model" : "promoter";
    const top = topOf(rows, other, 3).map(([k, v]) => `${k} (${v})`).join(", ");
    const stats = summaryStats(rows);
    if (top) stats.push({ label: kind === "promoter" ? "Top models" : "Top promoters", value: esc(top) });
    openModal({
      title: `${kind === "promoter" ? "Promoter" : "Model"} · ${name}`,
      sub: filterSubtitle(),
      rows,
      stats,
    });
  }

  function openRankAll(kind) {
    const list = kind === "promoter" ? state.metrics.promoters : state.metrics.models;
    openModal({
      title: kind === "promoter" ? "All promoters" : "All models",
      sub: `${filterSubtitle()} · click a row for its leads`,
      rows: list,
      kind: "rank",
      columns: [
        { h: "#", v: (x) => String(list.indexOf(x) + 1), num: true },
        { h: kind === "promoter" ? "Promoter" : "Model", v: (x) => x.name },
        { h: "Leads", v: (x) => n(x.leads), num: true },
        { h: "Assigned", v: (x) => n(x.assigned), num: true },
        { h: "Sales orders", v: (x) => n(x.salesOrders), num: true },
        { h: "Converted", v: (x) => n(x.converted), num: true },
        { h: "Conversion", v: (x) => pct(x.rate), num: true },
      ],
      onRow: (i) => openEntity(kind, list[i].name),
    });
  }

  function openInfo() {
    const ds = state.dataset;
    const sla = slaHours();
    const col = (key) => {
      const m = ds && ds.mapping.find((x) => x.key === key);
      return m && m.column ? `“${esc(m.column)}”` : "";
    };
    const mapping = ds ? ds.mapping.map((m) => `<div class="gec-map-item${m.column ? "" : " is-missing"}"><span>${esc(m.label)}</span><b>${m.column ? `${esc(m.column)} · ${m.letter}` : "not found"}</b></div>`).join("") : "";
    const rules = `
      <h4>How each number is calculated</h4>
      <ul>
        <li><b>Total leads</b> — every data row under the header row${col("leadDate") ? `, dated by ${col("leadDate")}` : ""}.</li>
        <li><b>Assigned</b> — ${col("assignedTo") || col("assignedDate") || "status"} is filled (or the lead progressed further).</li>
        <li><b>Sales response</b> — ${[col("responseDate"), col("responseTime"), col("salesResponse")].filter(Boolean).join(" / ") || "status"} is filled (or the lead reached a sales order).</li>
        <li><b>Sales order</b> — ${[col("salesOrder"), col("salesOrderDate")].filter(Boolean).join(" / ") || "status"} is filled, or status mentions sales order / booking / proforma.</li>
        <li><b>Converted</b> — ${[col("converted"), col("convertedDate")].filter(Boolean).join(" / ") || "status"} says yes / has a value, or status says converted / invoiced / delivered / sold.</li>
        <li><b>Conversion rate</b> — converted ÷ total leads.</li>
        <li><b>Avg response time</b> — ${col("responseTime") ? `${col("responseTime")}` : `response date − ${col("assignedDate") ? "assigned date" : "lead date"}`}, averaged over leads that have one.</li>
        <li><b>Over SLA</b> — ${col("sla") ? `${col("sla")} says over / breached; otherwise ` : ""}response time above ${sla}h, or assigned with no response for more than ${sla}h.</li>
        <li><b>Unassigned</b> — not assigned and not failed. <b>No response</b> — assigned, no sales response, not failed. <b>Failed / rejected</b> — status says lost / rejected / cancelled / not interested / invalid.</li>
        <li>Stages are cumulative: a converted lead also counts as sales order, responded and assigned.</li>
      </ul>
      ${ds && ds.warnings.length ? `<h4>Data notes</h4><ul>${ds.warnings.map((w) => `<li class="gec-warn-line">${esc(w)}</li>`).join("")}</ul>` : ""}
      ${ds ? `<h4>Sheets in file</h4><ul>${ds.sheets.map((s) => `<li>${esc(s.name)} — ${n(s.rows)} rows, ${s.fields} recognised columns${s.name === ds.sheetName ? " <b>(used)</b>" : ""}</li>`).join("")}</ul>` : ""}`;
    openModal({
      title: "Data source & KPI rules",
      sub: ds ? `${ds.fileName || "GEC File"} · sheet “${ds.sheetName}” · header row ${ds.headerRow} · ${n(ds.records.length)} leads` : "No GEC File loaded",
      rows: [],
      kind: "info",
    });
    el("m-body").innerHTML = `<div class="gec-map-grid">${mapping}</div><div class="gec-rules">${rules}</div>`;
    el("m-foot").textContent = "Columns are detected automatically from the header row, so next month's file works without changes.";
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
    const sig = datasetSig(state.dataset);
    if (sig !== state.sig) {
      state.sig = sig;
      resetFilters();
      if (!el("modal").hidden) closeModal();
    }
    renderAll();
  }

  global.GecDashboard = { render, state };
})(typeof window !== "undefined" ? window : globalThis);
