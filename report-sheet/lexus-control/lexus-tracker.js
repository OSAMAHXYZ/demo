/**
 * Admin · Lexus Tracker dashboard (GEC Control Center look).
 * Usage: LexusTracker.mount(hostEl) once, then LexusTracker.show() whenever the panel opens.
 */
(function (global) {
  const Core = () => global.LexusCore;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtN = new Intl.NumberFormat("en-US");
  const n = (v) => fmtN.format(Math.round(Number(v) || 0));
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
  const w100 = (a, b) => `${b ? Math.min(100, (a / b) * 100).toFixed(1) : 0}%`;

  const CAT_COLOR = { delivered: "#059669", cancelled: "#e11d48", progress: "#2563eb" };
  const TRACK_ORDER = ["queue", "proforma", "delivered", "salesNoDate", "notFound", "noData"];
  const TRACK_TONE = { queue: "t-amber", proforma: "t-indigo", delivered: "t-green", salesNoDate: "t-violet", notFound: "t-slate", noData: "t-slate" };
  const TRACK_RULE = {
    queue: "Order number found in the Back Order file · position by bo-order-lookup rules",
    proforma: "Not in Back Order · Sales Raw Col P filled and Col V blank",
    delivered: "Not in Back Order · Sales Raw Col V has a date",
    salesNoDate: "Not in Back Order · in Sales Raw but Col P and Col V are blank",
    notFound: "In neither the Back Order file nor Sales Raw",
    noData: "Push Back Order / Sales Raw Data to track these orders",
  };
  const TABS = [
    { id: "all", label: "All" },
    { id: "progress", label: "In progress" },
    { id: "due", label: "Follow-up due" },
    { id: "delivered", label: "Delivered" },
    { id: "cancelled", label: "Cancelled" },
  ];

  const state = {
    host: null,
    root: null,
    data: null,
    tracker: { orders: {} },
    model: null,
    cols: {},
    tab: "all",
    search: "",
    drill: null,
    modalKey: "",
    started: false,
    loading: false,
    serverOk: false,
  };

  const ICON = {
    car: '<path d="M5 17H3v-4.5a2 2 0 0 1 .6-1.4L6 9l1.6-3.2A2 2 0 0 1 9.4 5h5.2a2 2 0 0 1 1.8 1.1L18 9l2.4 2.1a2 2 0 0 1 .6 1.4V17h-2"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>',
    pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  };
  const icon = (name) => `<svg class="lxd-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ""}</svg>`;

  // ---------- Skeleton ----------

  function build() {
    state.host.innerHTML = `
      <div class="lxd">
        <header class="lxd-header">
          <div class="lxd-brand"><span class="lxd-logo">L</span><div><strong>LEXUS TRACKER</strong><span>B2C ORDERS · FOLLOW-UP</span></div></div>
          <div class="lxd-source" data-el="source">Loading…</div>
          <div class="lxd-actions">
            <span class="lxd-live is-off" data-el="live"><i></i><b>LIVE</b></span>
            <span class="lxd-updated"><small>Last push</small><b data-el="updated">—</b></span>
            <a class="lxd-btn" href="lexus-control/lexus-controller.html" target="_blank" rel="noopener">Open Lexus Controller ↗</a>
            <button type="button" class="lxd-btn is-primary" data-act="refresh">${icon("refresh")}<span>Refresh</span></button>
          </div>
        </header>
        <section class="lxd-kpis" data-el="kpis"></section>
        <section class="lxd-row is-3">
          <article class="lxd-card"><div class="lxd-card-head"><h2><span class="lxd-h-ic t-blue">${icon("pie")}</span>Order Status <small>Details sheet · Status</small></h2></div><div class="lxd-body" data-el="donut"></div></article>
          <article class="lxd-card"><div class="lxd-card-head"><h2><span class="lxd-h-ic t-amber">${icon("route")}</span>In-Progress Tracking <small>Back Order → Sales Raw</small></h2></div><div class="lxd-bars" data-el="track"></div></article>
          <article class="lxd-card"><div class="lxd-card-head"><h2><span class="lxd-h-ic t-rose">${icon("bell")}</span>Follow-up · 24 h <small>in-progress orders</small></h2></div><div class="lxd-body" data-el="follow"></div></article>
        </section>
        <section class="lxd-row is-3">
          <article class="lxd-card"><div class="lxd-card-head"><h2><span class="lxd-h-ic t-green">${icon("list")}</span>Details Statuses</h2><span class="lxd-note" data-el="status-note"></span></div><div class="lxd-bars" data-el="statuses"></div></article>
          <article class="lxd-card"><div class="lxd-card-head"><h2><span class="lxd-h-ic t-indigo">${icon("car")}</span><span data-el="model-title">By Model</span></h2><span class="lxd-note">delivered · cancelled · in progress</span></div><div class="lxd-bars" data-el="models"></div></article>
          <article class="lxd-card"><div class="lxd-card-head"><h2><span class="lxd-h-ic t-violet">${icon("users")}</span><span data-el="person-title">By Consultant</span></h2><span class="lxd-note">in progress · follow-up due</span></div><div class="lxd-bars" data-el="people"></div></article>
        </section>
        <section class="lxd-card lxd-orders">
          <div class="lxd-card-head">
            <h2><span class="lxd-h-ic t-slate">${icon("db")}</span>All Orders <small data-el="orders-sub"></small></h2>
            <div class="lxd-tools">
              <div class="lxd-tabs" data-el="tabs"></div>
              <input type="search" data-el="search" placeholder="Search orders…" aria-label="Search orders" />
            </div>
          </div>
          <div class="lxd-drill" data-el="drill" hidden></div>
          <div class="lxd-table-wrap"><table class="lxd-table" data-el="table"></table></div>
        </section>
        <div class="lxd-empty" data-el="empty" hidden></div>
        <div class="lxd-modal" data-el="modal" hidden>
          <div class="lxd-modal-card" role="dialog" aria-modal="true">
            <div class="lxd-modal-head"><div><h3 data-el="m-title"></h3><p data-el="m-sub"></p></div><button type="button" class="lxd-icon-btn" data-act="close" aria-label="Close">${icon("close")}</button></div>
            <div class="lxd-modal-body" data-el="m-body"></div>
          </div>
        </div>
      </div>`;
    state.root = state.host.querySelector(".lxd");
    bind();
  }

  const el = (name) => state.root.querySelector(`[data-el="${name}"]`);

  function bind() {
    state.root.addEventListener("click", (e) => {
      const act = e.target.closest("[data-act]");
      if (act) {
        const a = act.dataset.act;
        if (a === "refresh") load(true);
        else if (a === "close") closeModal();
        else if (a === "clear-drill") { state.drill = null; renderOrders(); }
        return;
      }
      const tab = e.target.closest("[data-tab]");
      if (tab) { state.tab = tab.dataset.tab; state.drill = null; renderOrders(); return; }
      const drill = e.target.closest("[data-drill]");
      if (drill) { setDrill(drill.dataset.drill, drill.dataset.value, drill.dataset.label); return; }
      const row = e.target.closest("tr[data-key]");
      if (row) { openModal(row.dataset.key); return; }
      if (e.target === el("modal")) closeModal();
    });
    el("search").addEventListener("input", (e) => { state.search = e.target.value; renderOrders(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.root && !el("modal").hidden) closeModal(); });
  }

  function setDrill(kind, value, label) {
    state.drill = { kind, value, label };
    state.tab = "all";
    renderOrders();
    const box = state.root.querySelector(".lxd-orders");
    if (box) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Columns worth showing ----------

  function detectCols(headers, b2c) {
    const norms = headers.map((h) => String(h).toLowerCase());
    const find = (re, not) => norms.findIndex((h, i) => i !== b2c.orderCol && i !== b2c.statusCol && re.test(h) && !(not && not.test(h)));
    return {
      customer: find(/customer|client|buyer|company|account/, /id$|number|no\b|phone|mobile|email/),
      model: find(/model|vehicle|car\b|product|variant|grade|katashiki/, /year|code|date/),
      person: find(/sales\s*(man|person|consultant|advisor|executive|rep)|consultant|advisor|owner|assigned|employee|agent|salesman/),
      date: find(/order\s*date|created|date/),
      branch: find(/branch|showroom|location|city|region/),
    };
  }

  // ---------- Load ----------

  async function load(force) {
    if (state.loading || !Core()) return;
    state.loading = true;
    try {
      state.data = await Core().loadPushedData({ force: !!force });
    } catch (err) {
      state.data = { error: err.message || String(err) };
    }
    try {
      state.tracker = await Core().fetchState();
      state.serverOk = true;
    } catch {
      state.serverOk = false;
    }
    state.loading = false;
    rebuild();
    render();
  }

  async function refreshState() {
    try {
      state.tracker = await Core().fetchState();
      state.serverOk = true;
    } catch {
      state.serverOk = false;
    }
    rebuild();
    render();
  }

  function rebuild() {
    const d = state.data;
    state.model = d && d.b2c && d.b2c.ok
      ? Core().buildModel({ b2c: d.b2c, bo: d.bo, sales: d.sales, state: state.tracker, now: Date.now() })
      : null;
    state.cols = state.model ? detectCols(state.model.headers, d.b2c) : {};
  }

  // ---------- Render ----------

  function render() {
    if (!state.root) return;
    const d = state.data;
    const live = el("live");
    live.classList.toggle("is-off", !state.serverOk);
    el("updated").textContent = d && d.at ? Core().fmtAt(d.at) : "—";
    const empty = el("empty");
    if (!state.model || !state.model.ready) {
      empty.hidden = false;
      const err = d && (d.error || (d.b2c && d.b2c.error));
      empty.innerHTML = `<div class="lxd-empty-card">${icon("db")}<strong>${err ? "Could not read the Lexus B2C file" : "No Lexus B2C file pushed yet"}</strong>
        <p>${err ? esc(err) : "Open <b>Excel Uploads</b>, add the <b>Lexus B2C</b> workbook (slot 9 · sheet <b>Details</b> with <b>Order No</b> and <b>Status</b>), then click <b>Push to live</b>."}</p></div>`;
      el("source").textContent = d && d.at ? "Push the Lexus B2C file to start tracking" : "Waiting for the Admin Push…";
      ["kpis", "donut", "track", "follow", "statuses", "models", "people", "table", "tabs"].forEach((k) => { el(k).innerHTML = ""; });
      return;
    }
    empty.hidden = true;
    const f = d.files || {};
    el("source").innerHTML = [
      `<b>${esc((f.lexusB2c && f.lexusB2c.name) || "Lexus B2C")}</b>`,
      `sheet ${esc(d.b2c.sheetName)}`,
      `Back Order ${state.model.hasBo ? "✓" : "—"}`,
      `Sales Raw ${state.model.hasSales ? "✓" : "—"}`,
    ].join(" · ");
    renderKpis();
    renderDonut();
    renderTrack();
    renderFollow();
    renderStatuses();
    renderGroup("models", "model", "model-title", "By Model");
    renderGroup("people", "person", "person-title", "By Consultant");
    renderOrders();
    if (state.modalKey && !el("modal").hidden) openModal(state.modalKey);
  }

  function renderKpis() {
    const s = state.model.summary;
    const t = s.track;
    const k = (label, value, sub, tone, drill, of, alert) => `
      <button type="button" class="lxd-kpi ${tone}${alert ? " is-alert" : ""}" data-drill="${drill}" data-value="" data-label="${esc(label)}">
        <span class="lxd-kpi-lab">${esc(label)}</span>
        <span class="lxd-kpi-val lxd-num">${n(value)}</span>
        <span class="lxd-kpi-sub">${sub}</span>
        <span class="lxd-kpi-meter"><i style="width:${w100(value, of)}"></i></span>
      </button>`;
    el("kpis").innerHTML = [
      k("Total Orders", s.total, `${n(s.edited)} edited by users`, "t-slate", "all", s.total),
      k("Delivered", s.delivered, `<b>${pct(s.delivered, s.total)}</b> of orders`, "t-green", "cat:delivered", s.total),
      k("Cancelled", s.cancelled, `<b>${pct(s.cancelled, s.total)}</b> of orders`, "t-rose", "cat:cancelled", s.total),
      k("In Progress", s.progress, `<b>${pct(s.progress, s.total)}</b> of orders`, "t-blue", "cat:progress", s.total),
      k("Follow-up Due", s.due, s.due ? `<b>${pct(s.due, s.progress)}</b> of in progress` : "all followed up", "t-red", "due", s.progress, s.due > 0),
      k("In BO Queue", t.queue, state.model.hasBo ? "in progress · Back Order" : "Back Order not pushed", "t-amber", "track:queue", s.progress),
      k("Pro-Forma", t.proforma, state.model.hasSales ? "Sales Raw · Col P, V blank" : "Sales Raw not pushed", "t-indigo", "track:proforma", s.progress),
    ].join("");
  }

  function renderDonut() {
    const s = state.model.summary;
    const parts = [["delivered", s.delivered], ["cancelled", s.cancelled], ["progress", s.progress]];
    let acc = 0;
    const stops = parts.map(([key, v]) => {
      const from = acc;
      acc += s.total ? (v / s.total) * 360 : 0;
      return `${CAT_COLOR[key]} ${from}deg ${acc}deg`;
    }).join(", ");
    el("donut").innerHTML = `<div class="lxd-donut-wrap">
      <div class="lxd-donut" style="background:${s.total ? `conic-gradient(${stops})` : "#eef2f7"}"><div><b class="lxd-num">${n(s.total)}</b><small>orders</small></div></div>
      <div class="lxd-legend">${parts.map(([key, v]) => `
        <button type="button" class="lxd-leg" data-drill="cat:${key}" data-label="${esc(Core().CATEGORY_LABEL[key])}">
          <i style="background:${CAT_COLOR[key]}"></i><span>${esc(Core().CATEGORY_LABEL[key])}</span><b class="lxd-num">${n(v)}</b><em class="lxd-num">${pct(v, s.total)}</em>
        </button>`).join("")}</div></div>`;
  }

  function bar(label, value, max, tone, drill, extra, title) {
    return `<button type="button" class="lxd-bar ${tone}${value ? "" : " is-zero"}" data-drill="${esc(drill)}" data-label="${esc(label)}" title="${esc(title || label)}">
      <span class="lxd-bar-lab" dir="auto"><i></i>${esc(label)}</span>
      <span class="lxd-bar-val lxd-num">${n(value)}</span>
      <span class="lxd-bar-pct lxd-num">${extra != null ? extra : ""}</span>
      <span class="lxd-bar-track"><i style="width:${w100(value, max)}"></i></span>
    </button>`;
  }

  function renderTrack() {
    const s = state.model.summary;
    const kinds = TRACK_ORDER.filter((k) => s.track[k] || (k !== "noData" && (k !== "notFound" || state.model.hasBo || state.model.hasSales)));
    el("track").innerHTML = s.progress
      ? kinds.map((k) => bar(Core().TRACK_LABEL[k], s.track[k] || 0, s.progress, TRACK_TONE[k], `track:${k}`, pct(s.track[k] || 0, s.progress), TRACK_RULE[k])).join("")
      : `<div class="lxd-empty-note">No orders in progress</div>`;
  }

  function renderFollow() {
    const s = state.model.summary;
    const progress = state.model.orders.filter((o) => o.category === "progress");
    const overdue = progress.filter((o) => o.due).sort((a, b) => b.sinceMs - a.sinceMs).slice(0, 4);
    const compliance = s.progress ? (s.onTime / s.progress) * 100 : 100;
    el("follow").innerHTML = `
      <div class="lxd-follow-top">
        <div class="lxd-ring" style="--p:${compliance.toFixed(1)}"><div><b class="lxd-num">${s.progress ? `${compliance.toFixed(0)}%` : "—"}</b><small>on time</small></div></div>
        <div class="lxd-follow-stats">
          <button type="button" class="lxd-fstat is-ok" data-drill="ontime" data-label="Followed up in the last 24 h"><small>On time</small><b class="lxd-num">${n(s.onTime)}</b></button>
          <button type="button" class="lxd-fstat is-bad" data-drill="due" data-label="Follow-up due"><small>Due now</small><b class="lxd-num">${n(s.due)}</b></button>
          <button type="button" class="lxd-fstat" data-drill="never" data-label="Never followed up"><small>Never followed up</small><b class="lxd-num">${n(s.neverFollowed)}</b></button>
          <div class="lxd-fstat is-static"><small>Follow-ups logged</small><b class="lxd-num">${n(s.followUps)}</b></div>
        </div>
      </div>
      <div class="lxd-overdue">${overdue.length
        ? overdue.map((o) => `<button type="button" class="lxd-od" data-key-open="${esc(o.key)}"><b>${esc(o.orderNo)}</b><span>${esc(state.cols.customer >= 0 ? o.cells[state.cols.customer] : o.statusText)}</span><em>${esc(Core().hoursText(o.sinceMs))}</em></button>`).join("")
        : `<div class="lxd-empty-note is-good">No overdue follow-ups</div>`}</div>`;
    el("follow").querySelectorAll("[data-key-open]").forEach((b) => b.addEventListener("click", () => openModal(b.dataset.keyOpen)));
  }

  function renderStatuses() {
    const s = state.model.summary;
    const max = s.statuses.reduce((m, x) => Math.max(m, x.count), 0);
    const tone = { delivered: "t-green", cancelled: "t-rose", progress: "t-blue" };
    el("status-note").innerHTML = `<i class="t-green"></i>Delivered<i class="t-rose"></i>Cancelled<i class="t-blue"></i>In progress`;
    el("statuses").innerHTML = s.statuses.slice(0, 9).map((x) => bar(x.label, x.count, max, tone[x.category], `status:${x.label.toLowerCase()}`, pct(x.count, s.total), `${x.label} → ${Core().CATEGORY_LABEL[x.category]}`)).join("")
      || `<div class="lxd-empty-note">No statuses</div>`;
  }

  function renderGroup(target, colKey, titleEl, fallback) {
    const idx = state.cols[colKey];
    const box = el(target);
    if (idx == null || idx < 0) {
      el(titleEl).textContent = fallback;
      box.innerHTML = `<div class="lxd-empty-note">No ${colKey === "model" ? "model / vehicle" : "consultant / sales person"} column in the Details sheet</div>`;
      return;
    }
    const header = state.model.headers[idx];
    el(titleEl).textContent = `By ${header}`;
    const groups = new Map();
    state.model.orders.forEach((o) => {
      const name = o.cells[idx] || "(blank)";
      const g = groups.get(name) || { name, total: 0, delivered: 0, cancelled: 0, progress: 0, due: 0 };
      g.total += 1;
      g[o.category] += 1;
      if (o.due) g.due += 1;
      groups.set(name, g);
    });
    const list = [...groups.values()].sort((a, b) => (colKey === "person" ? b.progress - a.progress || b.total - a.total : b.total - a.total)).slice(0, 8);
    const max = list.reduce((m, g) => Math.max(m, g.total), 0);
    box.innerHTML = list.map((g) => `
      <button type="button" class="lxd-bar lxd-split" data-drill="col:${idx}" data-value="${esc(g.name)}" data-label="${esc(`${header}: ${g.name}`)}" title="${esc(`${g.name} · ${g.delivered} delivered · ${g.cancelled} cancelled · ${g.progress} in progress · ${g.due} follow-up due`)}">
        <span class="lxd-bar-lab" dir="auto">${esc(g.name)}</span>
        <span class="lxd-split-meta">${colKey === "person"
          ? `<b class="c-progress">${n(g.progress)}</b> in progress${g.due ? ` · <b class="c-due">${n(g.due)} due</b>` : ""}`
          : `<b class="c-delivered">${n(g.delivered)}</b> · <b class="c-cancelled">${n(g.cancelled)}</b> · <b class="c-progress">${n(g.progress)}</b>`}</span>
        <span class="lxd-bar-val lxd-num">${n(g.total)}</span>
        <span class="lxd-split-track"><span style="width:${w100(g.total, max)}">
          <i style="flex:${g.delivered};background:${CAT_COLOR.delivered}"></i><i style="flex:${g.cancelled};background:${CAT_COLOR.cancelled}"></i><i style="flex:${g.progress};background:${CAT_COLOR.progress}"></i>
        </span></span>
      </button>`).join("");
  }

  // ---------- Orders table ----------

  function drillFn(dr) {
    if (!dr) return () => true;
    const [kind, arg] = dr.kind.split(":");
    if (kind === "all") return () => true;
    if (kind === "cat") return (o) => o.category === arg;
    if (kind === "due") return (o) => o.due;
    if (kind === "ontime") return (o) => o.category === "progress" && !o.due;
    if (kind === "never") return (o) => o.category === "progress" && !o.followUps.length;
    if (kind === "track") return (o) => o.category === "progress" && o.track.kind === arg;
    if (kind === "status") return (o) => (o.statusText || "(blank)").toLowerCase() === dr.kind.slice(7);
    if (kind === "col") return (o) => (o.cells[Number(arg)] || "(blank)") === dr.value;
    return () => true;
  }

  const TAB_FN = {
    all: () => true,
    progress: (o) => o.category === "progress",
    due: (o) => o.due,
    delivered: (o) => o.category === "delivered",
    cancelled: (o) => o.category === "cancelled",
  };

  function followCell(o) {
    if (!o.needsFollowUp) return `<span class="lxd-muted">Not needed</span>`;
    if (!o.firstSeenAt) return `<span class="lxd-muted">Starting…</span>`;
    if (o.due) return `<span class="lxd-pill st-due">● ${esc(Core().hoursText(o.sinceMs))} without follow-up</span>`;
    return `<span class="lxd-pill st-ok">✓ next in ${esc(Core().hoursText(o.dueAt - Date.now()))}</span>`;
  }

  function renderOrders() {
    if (!state.model || !state.model.ready) return;
    const s = state.model.summary;
    const counts = { all: s.total, progress: s.progress, due: s.due, delivered: s.delivered, cancelled: s.cancelled };
    el("tabs").innerHTML = TABS.map((t) => `<button type="button" class="${state.tab === t.id && !state.drill ? "is-on" : ""}${t.id === "due" ? " is-due" : ""}" data-tab="${t.id}">${esc(t.label)}<b class="lxd-num">${n(counts[t.id])}</b></button>`).join("");
    const drillBox = el("drill");
    drillBox.hidden = !state.drill;
    if (state.drill) drillBox.innerHTML = `Filtered: <b>${esc(state.drill.label || state.drill.kind)}</b> <button type="button" class="lxd-link" data-act="clear-drill">Clear ✕</button>`;

    const q = state.search.trim().toLowerCase();
    const fn = state.drill ? drillFn(state.drill) : TAB_FN[state.tab];
    const rows = state.model.orders.filter((o) => fn(o) && (!q || (o.cells.join(" ") + " " + o.note + " " + Core().trackText(o.track)).toLowerCase().includes(q)));
    rows.sort((a, b) => (b.due - a.due) || (b.sinceMs * (b.due ? 1 : 0) - a.sinceMs * (a.due ? 1 : 0)) || a.sheetRow - b.sheetRow);
    const H = state.model.headers;
    const extra = ["customer", "model", "person", "branch"].map((k) => state.cols[k]).filter((i) => i != null && i >= 0);
    el("orders-sub").textContent = `${n(rows.length)} of ${n(s.total)} · click a row for all columns and follow-up history`;
    const limit = 400;
    el("table").innerHTML = `<thead><tr><th>Order No</th>${extra.map((i) => `<th>${esc(H[i])}</th>`).join("")}<th>Status</th><th>Category</th><th>BO Queue / Sales Raw</th><th>Follow-up</th><th>Last follow-up</th><th>Notes</th><th class="num">Edits</th></tr></thead>
      <tbody>${rows.slice(0, limit).map((o) => `<tr data-key="${esc(o.key)}" class="${o.due ? "is-due" : ""}">
        <td><b>${esc(o.orderNo)}</b></td>
        ${extra.map((i) => `<td dir="auto">${esc(o.cells[i])}</td>`).join("")}
        <td dir="auto">${esc(o.statusText)}</td>
        <td><span class="lxd-pill c-${o.category}">${esc(Core().CATEGORY_LABEL[o.category])}</span></td>
        <td><span class="lxd-trk k-${o.track.kind}">${esc(Core().trackText(o.track))}</span></td>
        <td>${followCell(o)}</td>
        <td>${o.lastFollowUpAt ? `${esc(Core().fmtAt(o.lastFollowUpAt))}${o.lastFollowUpBy ? ` · ${esc(o.lastFollowUpBy)}` : ""}` : `<span class="lxd-muted">—</span>`}</td>
        <td class="lxd-note-cell" dir="auto" title="${esc(o.note)}">${esc(o.note)}</td>
        <td class="num">${o.editCount ? n(o.editCount) : ""}</td>
      </tr>`).join("") || `<tr><td colspan="${8 + extra.length}" class="lxd-muted" style="padding:18px">No orders match.</td></tr>`}
      ${rows.length > limit ? `<tr><td colspan="${8 + extra.length}" class="lxd-muted" style="padding:12px">Showing the first ${limit} of ${n(rows.length)} · search to narrow down</td></tr>` : ""}</tbody>`;
  }

  // ---------- Modal ----------

  function openModal(key) {
    const o = state.model && state.model.orders.find((x) => x.key === key);
    if (!o) return;
    state.modalKey = key;
    el("m-title").textContent = `Order ${o.orderNo}`;
    el("m-sub").innerHTML = `<span class="lxd-pill c-${o.category}">${esc(Core().CATEGORY_LABEL[o.category])}</span> · ${esc(Core().trackText(o.track))} · Details sheet row ${o.sheetRow}`;
    const H = state.model.headers;
    const fields = H.map((h, i) => {
      const edited = Object.prototype.hasOwnProperty.call(o.edits, h);
      return `<div class="lxd-field${edited ? " is-edited" : ""}"><span>${esc(h)}</span><b dir="auto">${esc(o.cells[i]) || '<em class="lxd-muted">blank</em>'}</b>${edited ? `<small>File: ${esc(o.fileCells[i] || "(blank)")}</small>` : ""}</div>`;
    }).join("");
    const t = o.track;
    const trackRows = t.kind === "queue"
      ? `<div class="lxd-field"><span>Queue position</span><b>${t.position != null ? `${n(t.position)} of ${n(t.total)}` : "No queue match"}</b></div>
         <div class="lxd-field"><span>Orders ahead</span><b>${t.ahead != null ? n(t.ahead) : "—"}</b></div>
         <div class="lxd-field"><span>Product · Suffix</span><b>${esc(`${t.product} ${t.suffix}`.trim() || "—")}</b></div>
         <div class="lxd-field"><span>Reservation date</span><b>${esc(t.reservationDate || "—")}</b></div>`
      : t.kind === "delivered" || t.kind === "proforma" || t.kind === "salesNoDate"
        ? `<div class="lxd-field"><span>Sales Raw row</span><b>${n(t.sheetRow)} (order no in Col ${esc(t.column)})</b></div>
           <div class="lxd-field"><span>Col P · Pro-Forma</span><b>${esc(t.proforma || "blank")}</b></div>
           <div class="lxd-field"><span>Col V · Delivery</span><b>${esc(t.delivery || "blank")}</b></div>`
        : `<div class="lxd-field"><span>Tracking</span><b>${esc(TRACK_RULE[t.kind] || "")}</b></div>`;
    const history = o.followUps.slice().reverse().map((f) => `<li><b>${esc(Core().fmtAt(f.at))}</b>${f.by ? ` · ${esc(f.by)}` : ""}</li>`).join("");
    el("m-body").innerHTML = `
      <section><h4>Tracking</h4><div class="lxd-fields">${trackRows}</div></section>
      <section><h4>Follow-up</h4><div class="lxd-fields">
        <div class="lxd-field"><span>Status</span><b>${followCell(o)}</b></div>
        <div class="lxd-field"><span>First seen</span><b>${esc(Core().fmtAt(o.firstSeenAt) || "—")}</b></div>
        <div class="lxd-field"><span>Last user update</span><b>${esc(o.updatedAt ? `${Core().fmtAt(o.updatedAt)}${o.updatedBy ? ` · ${o.updatedBy}` : ""}` : "—")}</b></div>
        <div class="lxd-field is-wide"><span>Notes</span><b dir="auto">${esc(o.note) || '<em class="lxd-muted">No notes</em>'}</b></div>
      </div>${history ? `<ol class="lxd-history">${history}</ol>` : `<p class="lxd-muted">No follow-ups recorded yet.</p>`}</section>
      <section><h4>All columns · Details sheet${o.editCount ? ` · <span class="lxd-edited-tag">${n(o.editCount)} edited by users</span>` : ""}</h4><div class="lxd-fields">${fields}</div></section>`;
    el("modal").hidden = false;
  }

  function closeModal() {
    state.modalKey = "";
    el("modal").hidden = true;
  }

  // ---------- Public ----------

  function mount(host) {
    if (!host || state.host === host) return;
    state.host = host;
    build();
  }

  function show() {
    if (!state.root) return;
    if (!state.started) {
      state.started = true;
      load(false);
      if (global.ReportSheetStore) global.ReportSheetStore.startLiveSync(() => load(true), { pollMs: 10000 });
      Core().startStateSync(() => { if (!state.loading) refreshState(); }, 30000);
      setInterval(() => { if (state.data && state.root.getClientRects().length) { rebuild(); render(); } }, 60000);
    } else {
      load(false);
    }
  }

  global.LexusTracker = { mount, show, reload: () => load(true) };
})(typeof window !== "undefined" ? window : globalThis);
