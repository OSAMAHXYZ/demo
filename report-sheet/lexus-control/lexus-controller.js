/**
 * Lexus Controller · Excel-style sheet of every Lexus B2C order (Details sheet) with
 * user edits, notes and 24 h follow-ups. File values refresh on every Admin Push; user data never does.
 */
(function () {
  const Core = window.LexusCore;
  const Store = window.ReportSheetStore;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const fmtN = new Intl.NumberFormat("en-US");
  const n = (v) => fmtN.format(Number(v) || 0);

  const SYS_COLS = [
    { id: "category", header: "Category" },
    { id: "track", header: "BO Queue / Sales Raw" },
    { id: "followup", header: "Follow-up (every 24 h)" },
    { id: "last", header: "Last follow-up" },
    { id: "note", header: "Notes", editable: true },
  ];

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "progress", label: "In progress" },
    { id: "due", label: "Follow-up due", due: true },
    { id: "delivered", label: "Delivered" },
    { id: "cancelled", label: "Cancelled" },
  ];

  const state = {
    data: null,
    tracker: { at: 0, orders: {} },
    model: null,
    cols: [],
    rows: [],
    sel: { key: "", c: 0 },
    editing: null,
    fuDialog: null,
    filter: "all",
    search: "",
    editedOnly: false,
    pendingRender: false,
    serverOk: false,
    notifiedDue: 0,
    loading: false,
  };

  // ---------- Filters ----------

  const FILTER_FN = {
    all: () => true,
    progress: (o) => o.category === "progress",
    due: (o) => o.due,
    delivered: (o) => o.category === "delivered",
    cancelled: (o) => o.category === "cancelled",
    queue: (o) => o.category === "progress" && o.track.kind === "queue",
    proforma: (o) => o.category === "progress" && o.track.kind === "proforma",
    srDelivered: (o) => o.category === "progress" && o.track.kind === "delivered",
  };

  function visibleOrders() {
    if (!state.model || !state.model.ready) return [];
    const q = state.search.trim().toLowerCase();
    const fn = FILTER_FN[state.filter] || FILTER_FN.all;
    return state.model.orders.filter((o) => {
      if (!fn(o)) return false;
      if (state.editedOnly && !o.editCount && !o.note) return false;
      if (!q) return true;
      return (o.cells.join(" ") + " " + o.note + " " + Core.trackText(o.track)).toLowerCase().includes(q);
    });
  }

  // ---------- Model ----------

  function rebuild() {
    const d = state.data;
    state.model = d && d.b2c && d.b2c.ok
      ? Core.buildModel({ b2c: d.b2c, bo: d.bo, sales: d.sales, state: state.tracker, now: Date.now() })
      : null;
    const headers = state.model ? state.model.headers : [];
    state.cols = headers.map((h, i) => ({ kind: "file", idx: i, header: h, letter: Core.colLetter(i), editable: true }))
      .concat(SYS_COLS.map((s, i) => ({ kind: "sys", id: s.id, header: s.header, letter: Core.colLetter(headers.length + i), editable: !!s.editable })));
  }

  // ---------- Render ----------

  function render() {
    if (state.editing) { state.pendingRender = true; return; }
    state.pendingRender = false;
    renderSource();
    renderKpis();
    renderFilters();
    renderAlert();
    renderGrid();
    $("lxc-export").disabled = !(state.model && state.model.ready);
  }

  function renderSource() {
    const d = state.data;
    const el = $("lxc-source");
    if (!d) { el.textContent = "Loading the latest Admin Push…"; return; }
    const f = d.files || {};
    const pushed = d.at ? Core.fmtAt(d.at) : "—";
    if (!d.b2c) { el.innerHTML = `No <b>Lexus B2C</b> file in the Admin Push · last push ${esc(pushed)}`; return; }
    const parts = [
      `<b>${esc((f.lexusB2c && f.lexusB2c.name) || "Lexus B2C")}</b>`,
      `sheet ${esc(d.b2c.sheetName || "—")}`,
      `${n(d.b2c.rows ? d.b2c.rows.length : 0)} orders`,
      `pushed ${esc(pushed)}`,
      `Back Order ${d.bo && d.bo.rows.length ? "✓" : "—"}`,
      `Sales Raw ${d.sales && d.sales.matrix.length ? "✓" : "—"}`,
    ];
    el.innerHTML = parts.join(" · ");
  }

  function kpi(label, value, sub, tone, filter, alert) {
    const on = state.filter === filter ? " is-on" : "";
    return `<button type="button" class="lxc-kpi ${tone}${on}${alert ? " is-alert" : ""}" data-filter="${filter}">
      <small>${esc(label)}</small><b class="num">${n(value)}</b><em>${sub}</em></button>`;
  }

  function renderKpis() {
    const s = state.model && state.model.ready ? state.model.summary : null;
    const box = $("lxc-kpis");
    if (!s) { box.innerHTML = ""; return; }
    const pct = (v) => (s.total ? `${((v / s.total) * 100).toFixed(1)}%` : "—");
    const t = s.track;
    const hasBo = state.model.hasBo;
    const hasSales = state.model.hasSales;
    box.innerHTML = [
      kpi("Total orders", s.total, `${n(s.edited)} edited by users`, "t-slate", "all"),
      kpi("Delivered", s.delivered, `${pct(s.delivered)} of orders`, "t-green", "delivered"),
      kpi("Cancelled", s.cancelled, `${pct(s.cancelled)} of orders`, "t-rose", "cancelled"),
      kpi("In progress", s.progress, `${pct(s.progress)} of orders`, "t-blue", "progress"),
      kpi("Follow-up due", s.due, s.due ? "no follow-up in 24 h" : "all followed up", "t-red", "due", s.due > 0),
      kpi("In BO queue", t.queue, hasBo ? "in progress · Back Order" : "Back Order not pushed", "t-amber", "queue"),
      kpi("Pro-Forma", t.proforma, hasSales ? "Sales Raw Col P · V blank" : "Sales Raw not pushed", "t-indigo", "proforma"),
      kpi("Delivered · Sales Raw", t.delivered, hasSales ? "Sales Raw Col V has a date" : "Sales Raw not pushed", "t-teal", "srDelivered"),
    ].join("");
  }

  function renderFilters() {
    const s = state.model && state.model.ready ? state.model.summary : null;
    const counts = s ? { all: s.total, progress: s.progress, due: s.due, delivered: s.delivered, cancelled: s.cancelled } : {};
    const extra = FILTERS.some((f) => f.id === state.filter) ? "" : state.filter;
    $("lxc-filter").innerHTML = FILTERS.map((f) => `<button type="button" role="tab" class="${state.filter === f.id ? "is-on" : ""}${f.due ? " is-due" : ""}" data-filter="${f.id}">${esc(f.label)}<b class="num">${s ? n(counts[f.id]) : ""}</b></button>`).join("")
      + (extra ? `<button type="button" class="is-on" data-filter="all" title="Clear filter">${esc(kpiLabel(extra))} ✕</button>` : "");
  }

  const kpiLabel = (id) => ({ queue: "In BO queue", proforma: "Pro-Forma", srDelivered: "Delivered · Sales Raw" }[id] || id);

  function renderAlert() {
    const el = $("lxc-alert");
    const due = state.model && state.model.ready ? state.model.summary.due : 0;
    document.title = `${due ? `(${due}) ` : ""}Lexus Controller · B2C Orders`;
    if (!due) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<span>⚠</span><span><b class="num">${n(due)}</b> order${due === 1 ? "" : "s"} need${due === 1 ? "s" : ""} a follow-up — no follow-up recorded in the last 24 hours.
      After you contact the customer, click <b>Yes</b> in the Follow-up column and update the notes.</span>
      <button type="button" data-filter="due">Show only these</button>`;
  }

  function cellValue(o, col) {
    if (col.kind === "file") return o.cells[col.idx];
    if (col.id === "category") return Core.CATEGORY_LABEL[o.category];
    if (col.id === "track") return Core.trackText(o.track);
    if (col.id === "followup") return followUpText(o);
    if (col.id === "last") return lastText(o);
    if (col.id === "note") return o.note;
    return "";
  }

  function followUpText(o) {
    if (!o.needsFollowUp) return "Not needed";
    if (!o.firstSeenAt) return "Starting…";
    if (o.due) return `Due · ${Core.hoursText(o.sinceMs)} without follow-up`;
    return `Next in ${Core.hoursText(o.dueAt - Date.now())}`;
  }

  function lastText(o) {
    if (!o.lastFollowUpAt) return "—";
    return `${Core.fmtAt(o.lastFollowUpAt)}${o.lastFollowUpBy ? ` · ${o.lastFollowUpBy}` : ""}${o.followUps.length > 1 ? ` (${o.followUps.length}×)` : ""}`;
  }

  function followUpHtml(o) {
    if (!o.needsFollowUp) return `<span class="lxc-fu lxc-fu-na">Not needed · ${esc(Core.CATEGORY_LABEL[o.category])}</span>`;
    if (!o.firstSeenAt) return `<span class="lxc-fu lxc-fu-na">Starting…</span>`;
    if (o.due) {
      return `<span class="lxc-fu"><span class="lxc-fu-due">● ${esc(Core.hoursText(o.sinceMs))} without follow-up</span>Sent follow-up? <button type="button" data-fu="${esc(o.key)}">Yes</button></span>`;
    }
    return `<span class="lxc-fu"><span class="lxc-fu-ok">✓ Next in ${esc(Core.hoursText(o.dueAt - Date.now()))}</span><button type="button" class="is-ghost" data-fu="${esc(o.key)}" title="Record a follow-up now">Log now</button></span>`;
  }

  function trackHtml(o) {
    const t = o.track;
    let extra = "";
    if (t.kind === "queue" && t.position != null) extra = `<small>${n(t.ahead)} ahead${t.product ? ` · ${esc(t.product)} ${esc(t.suffix)}` : ""}</small>`;
    if ((t.kind === "delivered" || t.kind === "proforma" || t.kind === "salesNoDate") && t.sheetRow) extra = `<small>Sales Raw row ${t.sheetRow}</small>`;
    if (o.category !== "progress" && (t.kind === "notFound" || t.kind === "noData")) return `<span class="lxc-trk k-notFound">—</span>`;
    return `<span class="lxc-trk k-${t.kind}">${esc(Core.trackText(t))}${extra}</span>`;
  }

  function cellHtml(o, col, r, c) {
    const attrs = `data-r="${r}" data-c="${c}"`;
    if (col.kind === "file") {
      const v = o.cells[col.idx];
      const edited = Object.prototype.hasOwnProperty.call(o.edits, col.header);
      const cls = [edited ? "is-edited" : "", /^-?[\d,]+(\.\d+)?$/.test(v) ? "is-num" : ""].filter(Boolean).join(" ");
      const title = edited
        ? `File value: ${o.fileCells[col.idx] || "(blank)"} · edited${o.updatedBy ? ` by ${o.updatedBy}` : ""} · right-click to revert`
        : v;
      return `<td ${attrs} class="${cls}" title="${esc(title)}">${esc(v)}</td>`;
    }
    if (col.id === "note") {
      return `<td ${attrs} class="is-note${o.note ? " is-edited" : ""}" title="${esc(o.note || "Double-click to add a note")}">${esc(o.note)}</td>`;
    }
    let inner = "";
    if (col.id === "category") inner = `<span class="lxc-cat c-${o.category}">${esc(Core.CATEGORY_LABEL[o.category])}</span>`;
    else if (col.id === "track") inner = trackHtml(o);
    else if (col.id === "followup") inner = followUpHtml(o);
    else if (col.id === "last") inner = esc(lastText(o));
    return `<td ${attrs} class="is-sys">${inner}</td>`;
  }

  function renderGrid() {
    const empty = $("lxc-empty");
    const d = state.data;
    if (!state.model || !state.model.ready) {
      $("lxc-grid").innerHTML = "";
      empty.hidden = false;
      const err = d && d.b2c && d.b2c.error;
      empty.innerHTML = `<div class="lxc-empty-card">${!d
        ? "<strong>Loading…</strong><p>Reading the latest Admin Push.</p>"
        : err
          ? `<strong>Could not read the Lexus B2C file</strong><p>${esc(err)}</p>`
          : "<strong>No Lexus B2C file pushed yet</strong><p>Admin: open <b>Admin Push</b>, upload the <b>Lexus B2C</b> workbook (slot 9 · sheet <b>Details</b> with <b>Order No</b> and <b>Status</b>), then click <b>Push to live</b>. This page updates by itself.</p>"}</div>`;
      $("lxc-status-right").textContent = "";
      return;
    }
    empty.hidden = true;
    state.rows = visibleOrders();
    const cols = state.cols;
    const head1 = `<tr class="lxc-letters"><th class="lxc-corner"></th>${cols.map((c, i) => `<th class="${c.kind === "sys" ? "is-sys" : ""}" data-col="${i}">${c.letter}</th>`).join("")}</tr>`;
    const head2 = `<tr class="lxc-heads"><th class="lxc-corner">#</th>${cols.map((c) => `<th class="${c.kind === "sys" ? "is-sys" : ""}" title="${esc(c.header)}">${esc(c.header)}</th>`).join("")}</tr>`;
    const body = state.rows.map((o, r) => `<tr class="${o.due ? "is-due" : ""}${o.category === "cancelled" ? " is-cancelled" : ""}"><td class="lxc-rn" title="Details sheet row ${o.sheetRow}">${o.sheetRow}</td>${cols.map((col, c) => cellHtml(o, col, r, c)).join("")}</tr>`).join("");
    const scroll = $("lxc-scroll");
    const top = scroll.scrollTop;
    const left = scroll.scrollLeft;
    $("lxc-grid").innerHTML = `<thead>${head1}${head2}</thead><tbody>${body || `<tr><td class="lxc-rn"></td><td colspan="${cols.length}" style="color:#94a3b8;padding:14px 10px">No orders match this filter.</td></tr>`}</tbody>`;
    scroll.scrollTop = top;
    scroll.scrollLeft = left;
    const s = state.model.summary;
    const editedCells = state.model.orders.reduce((a, o) => a + o.editCount, 0);
    $("lxc-status-right").textContent = `${n(state.rows.length)} of ${n(s.total)} orders shown · ${n(editedCells)} edited cells · ${n(s.followUps)} follow-ups logged`;
    applySelection(false);
  }

  // ---------- Selection & keyboard ----------

  function selRowIndex() {
    const i = state.rows.findIndex((o) => o.key === state.sel.key);
    return i >= 0 ? i : (state.rows.length ? 0 : -1);
  }

  function cellEl(r, c) {
    return $("lxc-grid").querySelector(`td[data-r="${r}"][data-c="${c}"]`);
  }

  function applySelection(scroll) {
    const grid = $("lxc-grid");
    grid.querySelectorAll(".is-sel, .is-colsel, .is-rowsel").forEach((el) => el.classList.remove("is-sel", "is-colsel", "is-rowsel"));
    const r = selRowIndex();
    if (r < 0) { $("lxc-namebox").textContent = ""; $("lxc-fxval").textContent = ""; return; }
    const c = Math.max(0, Math.min(state.cols.length - 1, state.sel.c));
    state.sel = { key: state.rows[r].key, c };
    const td = cellEl(r, c);
    if (td) {
      td.classList.add("is-sel");
      const rn = td.parentElement.querySelector(".lxc-rn");
      if (rn) rn.classList.add("is-rowsel");
      if (scroll) td.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    const th = grid.querySelector(`th[data-col="${c}"]`);
    if (th) th.classList.add("is-colsel");
    const o = state.rows[r];
    const col = state.cols[c];
    $("lxc-namebox").textContent = `${col.letter}${o.sheetRow}`;
    const v = cellValue(o, col);
    const fileNote = col.kind === "file" && Object.prototype.hasOwnProperty.call(o.edits, col.header) ? `   ·   file value: ${o.fileCells[col.idx] || "(blank)"}` : "";
    $("lxc-fxval").textContent = `${v}${fileNote}`;
  }

  function moveSel(dr, dc) {
    if (!state.rows.length) return;
    const r = Math.max(0, Math.min(state.rows.length - 1, selRowIndex() + dr));
    const c = Math.max(0, Math.min(state.cols.length - 1, state.sel.c + dc));
    state.sel = { key: state.rows[r].key, c };
    applySelection(true);
  }

  function startEdit(initial) {
    const r = selRowIndex();
    if (r < 0) return;
    const col = state.cols[state.sel.c];
    if (!col || !col.editable) {
      toast(col && col.id === "followup" ? "Use the Yes button to record a follow-up" : "This column is calculated by the system");
      return;
    }
    const o = state.rows[r];
    const td = cellEl(r, state.sel.c);
    if (!td) return;
    const current = col.kind === "file" ? o.cells[col.idx] : o.note;
    td.classList.add("is-editing");
    td.innerHTML = `<input type="text" />`;
    const input = td.querySelector("input");
    input.value = initial != null ? initial : current;
    state.editing = { key: o.key, c: state.sel.c, input, current };
    input.focus();
    if (initial == null) input.select();
    input.addEventListener("keydown", onEditKey);
    input.addEventListener("blur", () => { if (state.editing && state.editing.input === input) commitEdit(0, 0); });
  }

  function onEditKey(e) {
    if (e.key === "Enter") { e.preventDefault(); commitEdit(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit(0, e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
  }

  function endEdit() {
    state.editing = null;
    render();
    $("lxc-scroll").focus({ preventScroll: true });
  }

  function cancelEdit() {
    if (!state.editing) return;
    endEdit();
  }

  function commitEdit(dr, dc) {
    const ed = state.editing;
    if (!ed) return;
    const value = ed.input.value;
    state.editing = null;
    const o = state.model.orders.find((x) => x.key === ed.key);
    const col = state.cols[ed.c];
    if (o && col && value !== ed.current) {
      if (col.kind === "file") {
        const fileVal = o.fileCells[col.idx];
        saveEdit(o.key, { edits: { [col.header]: value === fileVal ? null : value } });
      } else {
        saveEdit(o.key, { note: value });
      }
    }
    render();
    if (dr || dc) moveSel(dr, dc);
    $("lxc-scroll").focus({ preventScroll: true });
  }

  // ---------- Saving (optimistic, then server) ----------

  function ensureUser() {
    let name = Core.getUser();
    if (!name) {
      name = (window.prompt("Your name (saved with your edits and follow-ups):") || "").trim();
      if (name) {
        Core.setUser(name);
        $("lxc-user").value = name;
      }
    }
    $("lxc-user").closest(".lxc-user").classList.toggle("is-missing", !name);
    return name;
  }

  function applyLocal(key, patch) {
    const orders = state.tracker.orders || (state.tracker.orders = {});
    const entry = orders[key] || (orders[key] = {});
    const at = Date.now();
    if (!entry.firstSeenAt) entry.firstSeenAt = at;
    if (patch.edits) {
      entry.edits = { ...(entry.edits || {}) };
      Object.entries(patch.edits).forEach(([h, v]) => { if (v === null) delete entry.edits[h]; else entry.edits[h] = v; });
    }
    if (patch.note !== undefined) entry.note = patch.note;
    if (patch.followUp) entry.followUps = (entry.followUps || []).concat([{ at, by: Core.getUser(), note: entry.note || "" }]);
    entry.updatedAt = at;
    entry.updatedBy = Core.getUser();
  }

  async function saveEdit(key, patch) {
    ensureUser();
    applyLocal(key, patch);
    rebuild();
    render();
    try {
      await Core.saveOrder(key, patch);
      setStatus(patch.followUp ? "Follow-up saved" : "Saved");
    } catch (err) {
      toast(`Not saved: ${err.message || err}`, true);
      refreshState();
    }
  }

  // A follow-up is only recorded together with an updated note.
  function followUp(key) {
    const o = state.model && state.model.orders.find((x) => x.key === key);
    if (!o) return;
    if (state.editing) commitEdit(0, 0);
    $("lxc-menu").hidden = true;
    const prev = o.note || "";
    const note = $("lxc-fu-note");
    note.value = prev;
    $("lxc-fu-sub").textContent = `Order ${o.orderNo} · ${followUpText(o)}`;
    state.fuDialog = { key, prev: prev.trim() };
    syncFollowUpDialog();
    $("lxc-fu-dialog").hidden = false;
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
  }

  function syncFollowUpDialog() {
    const d = state.fuDialog;
    if (!d) return;
    const v = $("lxc-fu-note").value.trim();
    const ok = !!v && v !== d.prev;
    $("lxc-fu-save").disabled = !ok;
    const hint = $("lxc-fu-hint");
    hint.textContent = !v ? "Write a note about this follow-up to continue."
      : v === d.prev ? "Update the notes — they must change with every follow-up."
      : "Ctrl + Enter to save";
    hint.classList.toggle("is-warn", !ok);
  }

  function closeFollowUpDialog() {
    state.fuDialog = null;
    $("lxc-fu-dialog").hidden = true;
    $("lxc-scroll").focus({ preventScroll: true });
  }

  function submitFollowUp() {
    const d = state.fuDialog;
    if (!d) return;
    const note = $("lxc-fu-note").value.trim();
    if (!note || note === d.prev) { syncFollowUpDialog(); $("lxc-fu-note").focus(); return; }
    const o = state.model && state.model.orders.find((x) => x.key === d.key);
    closeFollowUpDialog();
    saveEdit(d.key, { followUp: true, note });
    if (o) toast(`Follow-up and notes saved for order ${o.orderNo} · next one due in 24 h`);
  }

  // ---------- Loading ----------

  async function refreshState() {
    try {
      state.tracker = await Core.fetchState();
      state.serverOk = true;
    } catch {
      state.serverOk = false;
    }
    setLive();
    rebuild();
    render();
  }

  async function loadAll(force) {
    if (state.loading) return;
    state.loading = true;
    setStatus(force ? "Admin Push received · reloading…" : "Loading the latest Admin Push…");
    try {
      state.data = await Core.loadPushedData({ force: !!force });
    } catch (err) {
      toast(`Could not load the Admin Push: ${err.message || err}`, true);
    }
    state.loading = false;
    await refreshState();
    setStatus(state.data && state.data.b2c && state.data.b2c.ok ? "Ready" : "Waiting for the Lexus B2C file");
    const warnings = state.data && state.data.b2c && state.data.b2c.warnings;
    if (warnings && warnings.length) setStatus(`Ready · ${warnings.join(" · ")}`);
    if (state.model && state.model.ready && state.serverOk) {
      const unseen = state.model.orders.filter((o) => !o.firstSeenAt).map((o) => o.key);
      if (unseen.length) {
        try { await Core.markSeen(unseen); await refreshState(); } catch { /* next load retries */ }
      }
    }
    checkNotify();
  }

  function setLive() {
    const el = $("lxc-live");
    el.classList.toggle("is-off", !state.serverOk);
    el.title = state.serverOk ? "Connected · updates on every Admin Push and every user change" : "Server not reachable · changes cannot be saved";
  }

  function setStatus(text) {
    $("lxc-status").textContent = text;
  }

  let toastTimer = null;
  function toast(text, isErr) {
    const el = $("lxc-toast");
    el.textContent = text;
    el.classList.toggle("is-err", !!isErr);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isErr ? 5000 : 2600);
  }

  // ---------- Notifications ----------

  function setupNotifyButton() {
    const btn = $("lxc-notify");
    btn.hidden = !("Notification" in window) || Notification.permission !== "default";
    btn.onclick = () => Notification.requestPermission().then(() => { setupNotifyButton(); checkNotify(); });
  }

  function checkNotify() {
    const due = state.model && state.model.ready ? state.model.summary.due : 0;
    if (due < state.notifiedDue) state.notifiedDue = due;
    if (!due || due === state.notifiedDue) return;
    state.notifiedDue = due;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const note = new Notification("Lexus Controller · follow-up needed", {
        body: `${due} order${due === 1 ? "" : "s"} without a follow-up in the last 24 hours.`,
        tag: "lexus-follow-up",
      });
      note.onclick = () => { window.focus(); state.filter = "due"; render(); };
    } catch { /* ignore */ }
  }

  // ---------- Export ----------

  function exportExcel() {
    if (!state.model || !state.model.ready || !window.XLSX) return;
    const X = window.XLSX;
    const headers = state.cols.map((c) => c.header);
    const orders = visibleOrders();
    const aoa = [headers].concat(orders.map((o) => state.cols.map((c) => cellValue(o, c))));
    const ws = X.utils.aoa_to_sheet(aoa);
    const headStyle = { font: { bold: true }, fill: { fgColor: { rgb: "E9EFE9" } }, border: { bottom: { style: "thin", color: { rgb: "9FB8A6" } } } };
    headers.forEach((_, c) => { const a = X.utils.encode_cell({ r: 0, c }); if (ws[a]) ws[a].s = headStyle; });
    orders.forEach((o, r) => {
      state.cols.forEach((col, c) => {
        const a = X.utils.encode_cell({ r: r + 1, c });
        if (!ws[a]) return;
        if (col.kind === "file" && Object.prototype.hasOwnProperty.call(o.edits, col.header)) ws[a].s = { fill: { fgColor: { rgb: "FFF7D1" } } };
        if (col.id === "followup" && o.due) ws[a].s = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "DC2626" } } };
      });
    });
    ws["!cols"] = headers.map((h, c) => ({ wch: Math.min(40, Math.max(10, h.length + 2, ...aoa.slice(1, 200).map((row) => String(row[c] || "").length + 1))) }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Details");
    const d = new Date();
    X.writeFile(wb, `Lexus-B2C-Controller-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`);
  }

  // ---------- Context menu ----------

  function openMenu(x, y, o, col) {
    const menu = $("lxc-menu");
    const items = [];
    const v = cellValue(o, col);
    items.push(`<button type="button" data-menu="copy">Copy cell</button>`);
    if (col.editable) items.push(`<button type="button" data-menu="edit">Edit cell</button>`);
    if (col.kind === "file" && Object.prototype.hasOwnProperty.call(o.edits, col.header)) {
      items.push(`<button type="button" data-menu="revert">Revert to file value</button><p>File value: ${esc(o.fileCells[col.idx] || "(blank)")}</p>`);
    }
    if (col.id === "note" && o.note) items.push(`<button type="button" data-menu="clear-note">Clear note</button>`);
    if (o.needsFollowUp) items.push(`<button type="button" data-menu="followup">Record follow-up now</button>`);
    menu.innerHTML = items.join("");
    menu.hidden = false;
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.min(x, window.innerWidth - w - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - h - 8)}px`;
    menu.onclick = (e) => {
      const b = e.target.closest("[data-menu]");
      if (!b) return;
      menu.hidden = true;
      const act = b.dataset.menu;
      if (act === "copy") navigator.clipboard && navigator.clipboard.writeText(v).then(() => toast("Copied"), () => {});
      else if (act === "edit") startEdit();
      else if (act === "revert") saveEdit(o.key, { edits: { [col.header]: null } });
      else if (act === "clear-note") saveEdit(o.key, { note: "" });
      else if (act === "followup") followUp(o.key);
    };
  }

  // ---------- Events ----------

  function bind() {
    const user = $("lxc-user");
    user.value = Core.getUser();
    user.addEventListener("change", () => {
      Core.setUser(user.value);
      user.closest(".lxc-user").classList.toggle("is-missing", !user.value.trim());
    });

    document.addEventListener("click", (e) => {
      const menu = $("lxc-menu");
      if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
      const f = e.target.closest("[data-filter]");
      if (f) {
        state.filter = state.filter === f.dataset.filter && f.classList.contains("lxc-kpi") ? "all" : f.dataset.filter;
        render();
      }
    });

    const q = new URLSearchParams(location.search).get("q");
    if (q) { state.search = q; $("lxc-search").value = q; }
    $("lxc-search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
    $("lxc-edited").addEventListener("change", (e) => { state.editedOnly = e.target.checked; render(); });
    $("lxc-refresh").addEventListener("click", () => loadAll(true));
    $("lxc-export").addEventListener("click", exportExcel);

    const grid = $("lxc-grid");
    grid.addEventListener("click", (e) => {
      const fu = e.target.closest("[data-fu]");
      if (fu) { followUp(fu.dataset.fu); return; }
      const td = e.target.closest("td[data-r]");
      if (!td || td.classList.contains("is-editing")) return;
      const o = state.rows[Number(td.dataset.r)];
      if (!o) return;
      state.sel = { key: o.key, c: Number(td.dataset.c) };
      applySelection(false);
      $("lxc-scroll").focus({ preventScroll: true });
    });
    grid.addEventListener("dblclick", (e) => {
      const td = e.target.closest("td[data-r]");
      if (!td || e.target.closest("button") || td.classList.contains("is-editing")) return;
      startEdit();
    });
    grid.addEventListener("contextmenu", (e) => {
      const td = e.target.closest("td[data-r]");
      if (!td) return;
      const o = state.rows[Number(td.dataset.r)];
      if (!o) return;
      e.preventDefault();
      state.sel = { key: o.key, c: Number(td.dataset.c) };
      applySelection(false);
      openMenu(e.clientX, e.clientY, o, state.cols[state.sel.c]);
    });

    $("lxc-scroll").addEventListener("keydown", (e) => {
      if (state.editing || e.target !== $("lxc-scroll")) return;
      const k = e.key;
      if (k === "ArrowDown") { e.preventDefault(); moveSel(1, 0); }
      else if (k === "ArrowUp") { e.preventDefault(); moveSel(-1, 0); }
      else if (k === "ArrowRight") { e.preventDefault(); moveSel(0, 1); }
      else if (k === "ArrowLeft") { e.preventDefault(); moveSel(0, -1); }
      else if (k === "Tab") { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); }
      else if (k === "PageDown") { e.preventDefault(); moveSel(20, 0); }
      else if (k === "PageUp") { e.preventDefault(); moveSel(-20, 0); }
      else if (k === "Enter" || k === "F2") { e.preventDefault(); startEdit(); }
      else if (k === "Delete" || k === "Backspace") {
        const col = state.cols[state.sel.c];
        const r = selRowIndex();
        if (r >= 0 && col && col.editable) {
          e.preventDefault();
          const o = state.rows[r];
          if (col.kind === "file") saveEdit(o.key, { edits: { [col.header]: o.fileCells[col.idx] === "" ? null : "" } });
          else saveEdit(o.key, { note: "" });
        }
      } else if ((e.ctrlKey || e.metaKey) && (k === "c" || k === "C")) {
        const r = selRowIndex();
        if (r >= 0 && navigator.clipboard) navigator.clipboard.writeText(cellValue(state.rows[r], state.cols[state.sel.c])).catch(() => {});
      } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const col = state.cols[state.sel.c];
        if (col && col.editable) { e.preventDefault(); startEdit(k); }
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("lxc-menu").hidden = true; });

    const fuNote = $("lxc-fu-note");
    fuNote.addEventListener("input", syncFollowUpDialog);
    fuNote.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitFollowUp(); }
    });
    $("lxc-fu-form").addEventListener("submit", (e) => { e.preventDefault(); submitFollowUp(); });
    $("lxc-fu-cancel").addEventListener("click", closeFollowUpDialog);
    $("lxc-fu-dialog").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); closeFollowUpDialog(); } });
    $("lxc-fu-dialog").addEventListener("mousedown", (e) => { if (e.target === e.currentTarget) closeFollowUpDialog(); });
  }

  // ---------- Start ----------

  bind();
  setupNotifyButton();
  render();
  loadAll(false).then(() => {
    Store.startLiveSync(() => loadAll(true), { initialAt: state.data ? state.data.at : 0 });
  });
  Core.startStateSync(() => { if (!state.loading) refreshState(); }, 30000);
  setInterval(() => {
    if (!state.data) return;
    rebuild();
    render();
    checkNotify();
  }, 60000);
})();
