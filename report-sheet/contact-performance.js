(function (global) {
  "use strict";

  const COLORS = {
    contacted: "#34d399",
    not_contacted: "#fb4b5c",
    in_progress: "#fbbf24",
    unknown: "#64748b",
  };
  const ICONS = {
    total: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    contacted: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    not_contacted: '<path d="M6 6l12 12M18 6L6 18"/>',
    in_progress: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
    rate: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
    rank: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
  };
  const RATE_HI = 85;
  const RATE_MID = 75;
  const TOP_MIN_LEADS = 100;
  const CONTACT_OPTIONS = [
    ["", "All statuses"],
    ["contacted", "Contacted"],
    ["not_contacted", "Not contacted"],
    ["in_progress", "In progress"],
    ["unknown", "Unknown"],
  ];

  function icon(name, size) {
    const px = size || 18;
    return `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.total}</svg>`;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(value) {
    return Number(value || 0).toLocaleString("en-GB");
  }

  function pct(value, digits) {
    return value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(digits == null ? 1 : digits)}%`;
  }

  function share(part, total) {
    return total > 0 ? (part / total) * 100 : 0;
  }

  function rateTone(value) {
    if (value == null) return "none";
    if (value >= RATE_HI) return "hi";
    if (value >= RATE_MID) return "mid";
    return "lo";
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function hue(name) {
    let h = 0;
    String(name || "").split("").forEach((ch) => { h = (h * 31 + ch.charCodeAt(0)) % 360; });
    return h;
  }

  function avatar(name) {
    return `<span class="cp-av" style="--h:${hue(name)}">${esc(initials(name))}</span>`;
  }

  function stamp(ms) {
    if (!ms) return "—";
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function periodLabel(period) {
    const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "No published period";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return date.toLocaleString("en-GB", { month: "long", year: "numeric" });
  }

  function dayLabel(iso, long) {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return iso || "";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return long
      ? date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })
      : String(date.getDate());
  }

  function badge(bucket, label) {
    const key = bucket || "unknown";
    return `<span class="cp-badge ${esc(key)}">${esc(label || "Unknown")}</span>`;
  }

  function niceMax(value) {
    if (value <= 5) return 5;
    const exp = Math.pow(10, Math.floor(Math.log10(value)));
    const unit = [1, 2, 2.5, 5, 10].find((step) => step * exp >= value) || 10;
    return unit * exp;
  }

  function reduceMotion() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  async function getJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Request failed");
      error.payload = data;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function mount(host) {
    if (!host) return;
    if (host.dataset.cpMounted === "1") {
      host.__cpReload && host.__cpReload();
      return;
    }
    host.dataset.cpMounted = "1";
    host.innerHTML = `<div class="cp-app" id="cp-app">
      <header class="cp-header">
        <div class="cp-hero">
          <div class="cp-logo" aria-hidden="true"><img src="../images/logo/toyota.png" alt="" width="26" height="26" decoding="async" onerror="this.style.display='none'" /></div>
          <div class="cp-hero-text">
            <p class="cp-eyebrow">ALJ Digital Retail · CRM follow-up</p>
            <h2>Contact Performance</h2>
            <p class="cp-sub" id="cp-sub">Loading the latest Admin push…</p>
          </div>
        </div>
        <div class="cp-header-side">
          <button type="button" class="cp-focus" id="cp-focus" hidden><span>Viewing:</span> <b id="cp-focus-name"></b><i aria-hidden="true">✕</i><span class="cp-sr">Clear advisor focus</span></button>
          <label class="cp-control"><span class="cp-sr">Reporting period</span><select id="cp-period" aria-label="Reporting period"></select></label>
          <label class="cp-control cp-find">${icon("search", 15)}<input id="cp-search" type="search" placeholder="Find advisor" aria-label="Find advisor" autocomplete="off" /></label>
          <span class="cp-pill is-stale" id="cp-fresh"><i></i><span>Not published</span></span>
          <button type="button" class="cp-btn" id="cp-view-leads" title="View leads" aria-label="View leads">${icon("list", 15)}<span>View leads</span></button>
          <button type="button" class="cp-btn primary" id="cp-refresh" title="Refresh" aria-label="Refresh">${icon("refresh", 15)}<span>Refresh</span></button>
        </div>
      </header>
      <div class="cp-kpis" id="cp-kpis"></div>
      <div class="cp-main" id="cp-main">
        <section class="cp-card cp-board">
          <div class="cp-card-head">
            <h3>Advisor leaderboard</h3>
            <span class="cp-count" id="cp-board-count"></span>
            <ul class="cp-key">
              <li><i style="background:${COLORS.contacted}"></i>Contacted</li>
              <li><i style="background:${COLORS.not_contacted}"></i>Not contacted</li>
              <li><i style="background:${COLORS.in_progress}"></i>In progress</li>
              <li><i class="tick"></i>Team avg</li>
            </ul>
          </div>
          <div class="cp-table-wrap" id="cp-board-wrap"></div>
        </section>
        <div class="cp-side">
          <section class="cp-card cp-donut-card">
            <div class="cp-card-head"><h3>Contact status</h3><span class="cp-count" id="cp-donut-note"></span></div>
            <div class="cp-donut-body">
              <div class="cp-donut" id="cp-donut"></div>
              <ul class="cp-dlegend" id="cp-dlegend"></ul>
            </div>
          </section>
          <section class="cp-card cp-daily-card">
            <div class="cp-card-head"><h3>Daily lead flow</h3><span class="cp-count" id="cp-daily-note"></span></div>
            <div class="cp-daily" id="cp-daily"></div>
          </section>
          <section class="cp-card cp-src-card">
            <div class="cp-card-head"><h3>Lead source</h3><span class="cp-count">Top 8 · leads · rate</span></div>
            <div class="cp-src" id="cp-src"></div>
          </section>
        </div>
      </div>
      <section class="cp-card cp-leads" id="cp-leads" hidden>
        <div class="cp-card-head">
          <button type="button" class="cp-btn ghost" id="cp-leads-back">${icon("back", 15)}<span>Dashboard</span></button>
          <h3>Lead detail</h3>
          <span class="cp-count" id="cp-leads-scope"></span>
          <div class="cp-leads-tools" id="cp-leads-tools"></div>
        </div>
        <div class="cp-table-wrap" id="cp-lead-wrap"></div>
        <div class="cp-pager" id="cp-pager"></div>
      </section>
      <div class="cp-empty-state" id="cp-empty" hidden></div>
      <div class="cp-banner" id="cp-stale" role="status" hidden></div>
      <div class="cp-tip" id="cp-tip" role="tooltip" hidden></div>
      <dialog class="cp-detail" id="cp-detail"><form method="dialog" id="cp-detail-body"></form></dialog>
    </div>`;

    const $ = (selector) => host.querySelector(selector);
    const app = $("#cp-app");
    const state = {
      publication: "",
      periods: [],
      activeId: "",
      diagnostic: null,
      lastError: null,
      summary: null,
      teamCache: null,
      focus: "",
      search: "",
      sort: "rank",
      dir: 1,
      view: "board",
      leads: { contact: "", source: "", q: "", sort: "createdSort", dir: "desc", page: 1 },
      shown: {},
    };

    function summaryOk() {
      return !!(state.summary && !state.summary.empty);
    }

    function employees() {
      return (state.summary && state.summary.employees) || [];
    }

    function focused() {
      return state.focus ? employees().find((row) => row.key === state.focus) || null : null;
    }

    function sumArrays(rows, field, length) {
      const out = Array.from({ length }, () => [0, 0, 0]);
      rows.forEach((row) => {
        (row[field] || []).forEach((cell, index) => {
          if (!out[index]) return;
          out[index][0] += cell[0] || 0;
          out[index][1] += cell[1] || 0;
          out[index][2] += cell[2] || 0;
        });
      });
      return out;
    }

    function teamView() {
      if (state.teamCache) return state.teamCache;
      const s = state.summary;
      const k = s.kpis || {};
      state.teamCache = {
        total: k.total || 0,
        contacted: k.contacted || 0,
        notContacted: k.notContacted || 0,
        inProgress: k.inProgress || 0,
        unknown: k.unknown || 0,
        rate: k.contactRate,
        daily: sumArrays(employees(), "daily", (s.days || []).length),
        sources: sumArrays(employees(), "sources", (s.sources || []).length),
      };
      return state.teamCache;
    }

    function currentView() {
      const emp = focused();
      if (!emp) return teamView();
      return {
        total: emp.total,
        contacted: emp.contacted,
        notContacted: emp.notContacted,
        inProgress: emp.inProgress,
        unknown: emp.unknown,
        rate: emp.contactRate,
        daily: emp.daily || [],
        sources: emp.sources || [],
      };
    }

    function teamRate() {
      const team = state.summary && state.summary.team;
      return team && team.contactRate != null ? team.contactRate : null;
    }

    /* ---------- tooltip ---------- */
    const tip = $("#cp-tip");
    function moveTip(event) {
      const pad = 14;
      const rect = tip.getBoundingClientRect();
      let x = event.clientX + pad;
      let y = event.clientY + pad;
      if (x + rect.width > global.innerWidth - 8) x = event.clientX - rect.width - pad;
      if (y + rect.height > global.innerHeight - 8) y = event.clientY - rect.height - pad;
      tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
    }
    app.addEventListener("mousemove", (event) => {
      const target = event.target.closest("[data-tip]");
      if (!target || !app.contains(target)) {
        tip.hidden = true;
        return;
      }
      const html = target.getAttribute("data-tip");
      if (tip.__html !== html) {
        tip.innerHTML = html;
        tip.__html = html;
      }
      tip.hidden = false;
      moveTip(event);
    });
    app.addEventListener("mouseleave", () => { tip.hidden = true; });

    /* ---------- number tween ---------- */
    function tween(el, to, render) {
      const key = el.getAttribute("data-k");
      const from = Object.prototype.hasOwnProperty.call(state.shown, key) ? state.shown[key] : 0;
      state.shown[key] = to;
      if (reduceMotion() || from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
        el.textContent = render(to);
        return;
      }
      const start = performance.now();
      const span = 520;
      let done = false;
      function step(now) {
        if (done) return;
        const t = Math.min(1, (now - start) / span);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = render(from + (to - from) * eased);
        if (t < 1 && el.isConnected) requestAnimationFrame(step);
        else done = true;
      }
      requestAnimationFrame(step);
      setTimeout(() => {
        done = true;
        el.textContent = render(to);
      }, span + 80);
    }

    /* ---------- loading ---------- */
    function query(extra) {
      const params = new URLSearchParams();
      if (state.publication) params.set("publication", state.publication);
      if (extra) Object.keys(extra).forEach((key) => { if (extra[key] !== "" && extra[key] != null) params.set(key, extra[key]); });
      return params.toString();
    }

    function showStale(message) {
      const stale = $("#cp-stale");
      stale.hidden = false;
      stale.textContent = message;
    }

    async function loadMeta() {
      const meta = await getJson("/api/contact-performance/meta");
      state.periods = meta.periods || [];
      state.activeId = meta.activeId || "";
      state.diagnostic = meta.diagnostic || null;
      state.lastError = meta.lastError || null;
      return meta;
    }

    async function loadAll() {
      const refresh = $("#cp-refresh");
      refresh.disabled = true;
      app.classList.add("is-loading");
      const previous = summaryOk() ? state.summary : null;
      try {
        await loadMeta();
        if (state.publication && !state.periods.some((item) => item.id === state.publication)) state.publication = "";
        const summary = await getJson(`/api/contact-performance/summary?${query()}`);
        if (summary.empty && previous) {
          showStale("Refresh did not return the published dataset. The numbers on screen are unchanged.");
          return;
        }
        state.summary = summary;
        state.teamCache = null;
        if (summary.publicationId) state.publication = summary.publicationId;
        if (state.focus && !focused()) state.focus = "";
        $("#cp-stale").hidden = true;
        render();
        if (state.view === "leads" && summaryOk()) loadLeads();
      } catch (err) {
        if (previous) showStale(err.message || "Refresh failed. The published numbers on screen are unchanged.");
        else {
          state.summary = { empty: true, loadError: err.message || "The dashboard could not be loaded." };
          render();
        }
      } finally {
        refresh.disabled = false;
        app.classList.remove("is-loading");
      }
    }

    /* ---------- render ---------- */
    function render() {
      const ok = summaryOk();
      app.classList.toggle("is-empty", !ok);
      $("#cp-empty").hidden = ok;
      renderHeader();
      if (!ok) {
        renderEmpty();
        return;
      }
      renderFocusParts();
    }

    function renderFocusParts() {
      renderFocusChip();
      renderKpis();
      renderBoard();
      renderDonut();
      renderDaily();
      renderSources();
    }

    function renderEmpty() {
      const s = state.summary || {};
      const lastError = state.lastError;
      const message = s.loadError
        || (state.diagnostic && state.diagnostic.message)
        || (s.diagnostic && s.diagnostic.message)
        || "Nothing is published yet. On the Admin page, drop the contact file under Contact Performance, then click Push to live.";
      $("#cp-empty").innerHTML = `<div class="cp-empty-card">
        <span class="cp-empty-ico">${icon("list", 26)}</span>
        <h3>${s.loadError ? "The dashboard could not be loaded" : "No Contact Performance data is published"}</h3>
        <p>${esc(message)}</p>
        ${lastError ? `<p class="cp-empty-err">Last import failed ${esc(stamp(lastError.at))}: ${esc(lastError.message)}</p>` : ""}
      </div>`;
      $("#cp-focus").hidden = true;
    }

    function renderHeader() {
      const s = state.summary || {};
      const ok = summaryOk();
      const fresh = $("#cp-fresh");
      const sub = $("#cp-sub");
      const select = $("#cp-period");
      const periods = state.periods || [];
      select.innerHTML = periods.length
        ? periods.slice().reverse().map((item) => `<option value="${esc(item.id)}"${item.id === state.publication ? " selected" : ""}>${esc(periodLabel(item.period))}${item.id === state.activeId ? " · live" : ""}</option>`).join("")
        : `<option value="">No period</option>`;
      select.disabled = periods.length < 2;
      $("#cp-search").disabled = !ok;
      $("#cp-view-leads").disabled = !ok;
      if (!ok) {
        fresh.className = "cp-pill is-stale";
        fresh.innerHTML = "<i></i><span>Not published</span>";
        fresh.title = "";
        sub.textContent = "Waiting for the contact file · source: latest Admin push";
        return;
      }
      const historical = !!(s.publicationId && state.activeId && s.publicationId !== state.activeId);
      const team = s.team || {};
      sub.textContent = `${periodLabel(s.period)} · ${fmt(team.total)} leads · ${fmt(team.advisors)} advisors · ${historical ? `historical Admin push of ${stamp(s.publishedAt)}` : "source: latest Admin push"}`;
      fresh.className = historical ? "cp-pill is-historical" : "cp-pill";
      fresh.innerHTML = `<i></i><span>${historical ? "Historical" : "Published"} · ${esc(stamp(s.publishedAt))}</span>`;
      const warnings = s.warnings || [];
      fresh.title = [s.fileName ? `File: ${s.fileName}` : "", s.contactFile && s.contactFile !== s.fileName ? `Contact file: ${s.contactFile}` : "", ...warnings].filter(Boolean).join("\n");
    }

    function renderFocusChip() {
      const emp = focused();
      const chip = $("#cp-focus");
      chip.hidden = !emp;
      $("#cp-focus-name").textContent = emp ? emp.name : "";
      app.classList.toggle("is-focused", !!emp);
    }

    function topAdvisor() {
      const rows = employees().filter((row) => row.total > 0);
      const eligible = rows.filter((row) => row.total >= TOP_MIN_LEADS);
      const pool = eligible.length ? eligible : rows;
      return pool.slice().sort((a, b) => (b.contacted / b.total) - (a.contacted / a.total) || b.total - a.total)[0] || null;
    }

    function renderKpis() {
      const view = currentView();
      const emp = focused();
      const team = state.summary.team || {};
      const tiles = [];
      const total = view.total || 0;
      tiles.push({
        tone: "total", ico: "total", label: "Total leads", value: total, kind: "int",
        sub: emp ? `${pct(share(total, team.total))} of team volume` : `${fmt(team.advisors)} advisors · ${fmt((state.summary.days || []).length)} days`,
        bar: emp ? share(total, team.total) : 100,
      });
      tiles.push({ tone: "ok", ico: "contacted", label: "Contacted", value: view.contacted, kind: "int", sub: `${pct(share(view.contacted, total))} of leads`, bar: share(view.contacted, total) });
      tiles.push({ tone: "bad", ico: "not_contacted", label: "Not contacted", value: view.notContacted, kind: "int", sub: `${pct(share(view.notContacted, total))} of leads`, bar: share(view.notContacted, total) });
      tiles.push({ tone: "wait", ico: "in_progress", label: "In progress", value: view.inProgress, kind: "int", sub: `${pct(share(view.inProgress, total))} of leads`, bar: share(view.inProgress, total) });
      let rateSub = view.unknown ? `${fmt(view.unknown)} unknown status not counted` : "Contacted ÷ total leads";
      if (emp && teamRate() != null && view.rate != null) {
        const diff = Math.round((view.rate - teamRate()) * 10) / 10;
        const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "■";
        rateSub = `Team avg ${pct(teamRate())} · <b class="${diff >= 0 ? "up" : "down"}">${arrow} ${Math.abs(diff).toFixed(1)} pts</b>`;
      }
      tiles.push({ tone: "rate", ico: "rate", label: "Contact rate", value: view.rate, kind: "pct", subHtml: rateSub, bar: view.rate || 0 });
      if (emp) {
        const count = employees().length;
        tiles.push({
          tone: "gold", ico: "rank", label: "Rank", valueHtml: `#${emp.rank}<small> / ${count}</small>`,
          sub: "By contact rate, then volume", bar: count > 1 ? share(count - emp.rank, count - 1) : 100,
        });
      } else {
        const top = topAdvisor();
        tiles.push({
          tone: "gold", ico: "star", label: "Top advisor", valueHtml: top ? `<span class="name" title="${esc(top.name)}">${esc(top.name)}</span>` : "—",
          sub: top ? `${pct(top.contactRate)} · ${fmt(top.contacted)} / ${fmt(top.total)} leads` : `No advisor with ${TOP_MIN_LEADS}+ leads`,
          bar: top ? top.contactRate || 0 : 0,
          tip: top ? `<b>${esc(top.name)}</b><br>Best contact rate among advisors with ${TOP_MIN_LEADS}+ leads` : "",
        });
      }
      $("#cp-kpis").innerHTML = tiles.map((tile, index) => `<div class="cp-kpi ${tile.tone}"${tile.tip ? ` data-tip="${esc(tile.tip)}"` : ""}>
          <span class="top"><span class="ico">${icon(tile.ico, 16)}</span><span class="lab">${esc(tile.label)}</span></span>
          <span class="val"${tile.valueHtml ? "" : ` data-k="kpi${index}"`}>${tile.valueHtml || ""}</span>
          <span class="sub">${tile.subHtml || esc(tile.sub)}</span>
          <span class="bar"><i style="width:${Math.max(0, Math.min(100, tile.bar || 0)).toFixed(1)}%"></i></span>
        </div>`).join("");
      host.querySelectorAll("#cp-kpis .val[data-k]").forEach((el, i) => {
        const tile = tiles.filter((item) => !item.valueHtml)[i];
        if (tile.value == null) {
          el.textContent = "—";
          return;
        }
        tween(el, Number(tile.value), tile.kind === "pct" ? (v) => `${v.toFixed(1)}%` : (v) => fmt(Math.round(v)));
      });
    }

    function sortedBoard() {
      const q = state.search.trim().toLowerCase();
      const rows = employees().filter((row) => !q || row.name.toLowerCase().includes(q));
      const key = state.sort;
      const dir = state.dir;
      const value = (row) => (key === "contactRate" ? (row.total ? row.contacted / row.total : -1) : key === "mix" ? row.total : row[key]);
      return rows.sort((a, b) => {
        const av = value(a);
        const bv = value(b);
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir || a.rank - b.rank;
        return String(av || "").localeCompare(String(bv || "")) * dir;
      });
    }

    function renderBoard() {
      const all = employees();
      const rows = sortedBoard();
      const maxTotal = Math.max(1, ...all.map((row) => row.total));
      const avg = teamRate();
      $("#cp-board-count").textContent = rows.length === all.length ? `${fmt(all.length)} advisors` : `${fmt(rows.length)} of ${fmt(all.length)} advisors`;
      const head = (key, label, cls) => {
        const on = state.sort === key;
        const arrow = on ? (state.dir === 1 ? "↑" : "↓") : "";
        return `<th class="${cls || ""}${on ? " is-sorted" : ""}" aria-sort="${on ? (state.dir === 1 ? "ascending" : "descending") : "none"}"><button type="button" data-sort="${key}">${esc(label)}<i>${arrow}</i></button></th>`;
      };
      const body = rows.length ? rows.map((row) => {
        const isFocus = state.focus === row.key;
        const dim = state.focus && !isFocus;
        const seg = (count, color, label) => (count > 0 ? `<i style="width:${share(count, row.total).toFixed(2)}%;background:${color}" aria-label="${label}"></i>` : "");
        const mixTip = `<b>${esc(row.name)}</b><br>Contacted ${fmt(row.contacted)} (${pct(share(row.contacted, row.total))})<br>Not contacted ${fmt(row.notContacted)} (${pct(share(row.notContacted, row.total))})<br>In progress ${fmt(row.inProgress)} (${pct(share(row.inProgress, row.total))})${row.unknown ? `<br>Unknown ${fmt(row.unknown)}` : ""}${avg != null ? `<br>Team avg ${pct(avg)}` : ""}`;
        return `<tr class="${isFocus ? "is-focus" : ""}${dim ? " is-dim" : ""}" data-advisor="${esc(row.key)}" tabindex="0" aria-selected="${isFocus}">
          <td class="rk"><span class="cp-rank r${row.rank <= 3 ? row.rank : 0}">${row.rank}</span></td>
          <td class="who"><span class="cp-emp">${avatar(row.name)}<span title="${esc(row.name)}">${esc(row.name)}</span></span></td>
          <td class="num">${fmt(row.total)}</td>
          <td class="num ok">${fmt(row.contacted)}</td>
          <td class="num bad">${fmt(row.notContacted)}</td>
          <td class="num wait">${fmt(row.inProgress)}</td>
          <td class="mix" data-tip="${esc(mixTip)}"><span class="cp-mix"><span class="cp-mix-bar" style="width:${share(row.total, maxTotal).toFixed(2)}%">${seg(row.contacted, COLORS.contacted, "Contacted")}${seg(row.notContacted, COLORS.not_contacted, "Not contacted")}${seg(row.inProgress, COLORS.in_progress, "In progress")}${avg != null ? `<b class="tick" style="left:${avg}%"></b>` : ""}</span></span></td>
          <td class="rate"><span class="cp-rate ${rateTone(row.contactRate)}">${pct(row.contactRate)}</span></td>
        </tr>`;
      }).join("") : `<tr><td colspan="8"><div class="cp-empty">No advisor matches “${esc(state.search)}”.</div></td></tr>`;
      $("#cp-board-wrap").innerHTML = `<table class="cp-table cp-board-table">
        <colgroup><col class="c-rk"><col class="c-who"><col class="c-leads"><col class="c-c"><col class="c-n"><col class="c-p"><col class="c-mix"><col class="c-rate"></colgroup>
        <thead><tr>${head("rank", "#", "rk")}${head("name", "Advisor", "who")}${head("total", "Leads", "num")}${head("contacted", "Contacted", "num")}${head("notContacted", "Not cont.", "num")}${head("inProgress", "In prog.", "num")}${head("mix", "Contact mix", "mix")}${head("contactRate", "Rate", "rate")}</tr></thead>
        <tbody>${body}</tbody></table>`;
    }

    function renderDonut() {
      const view = currentView();
      const total = view.total || 0;
      const parts = [
        ["contacted", "Contacted", view.contacted],
        ["not_contacted", "Not contacted", view.notContacted],
        ["in_progress", "In progress", view.inProgress],
      ];
      if (view.unknown) parts.push(["unknown", "Unknown", view.unknown]);
      const r = 46;
      const c = 2 * Math.PI * r;
      const live = parts.filter((part) => part[2] > 0);
      const gap = live.length > 1 ? 1.6 : 0;
      let offset = 0;
      const arcs = live.map(([key, label, count]) => {
        const len = (count / total) * c;
        const draw = Math.max(0.5, len - gap);
        const html = `<circle class="arc" cx="60" cy="60" r="${r}" stroke="${COLORS[key]}" stroke-dasharray="${draw.toFixed(2)} ${(c - draw).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" data-tip="${esc(`<b>${label}</b><br>${fmt(count)} leads · ${pct(share(count, total))}`)}"></circle>`;
        offset += len;
        return html;
      }).join("");
      $("#cp-donut").innerHTML = `<svg viewBox="0 0 120 120" role="img" aria-label="Contact status: ${pct(share(view.contacted, total))} contacted">
          <circle cx="60" cy="60" r="${r}" class="track"></circle>
          <g transform="rotate(-90 60 60)">${arcs}</g>
          <text x="60" y="63" text-anchor="middle" class="big">${pct(share(view.contacted, total))}</text>
          <text x="60" y="77" text-anchor="middle" class="cap">CONTACTED</text>
        </svg>`;
      $("#cp-dlegend").innerHTML = parts.map(([key, label, count]) => `<li data-tip="${esc(`<b>${label}</b><br>${fmt(count)} of ${fmt(total)} leads`)}">
          <i style="background:${COLORS[key]}"></i><span>${esc(label)}</span><b>${fmt(count)}</b><em>${pct(share(count, total))}</em>
        </li>`).join("");
      const emp = focused();
      $("#cp-donut-note").textContent = emp ? emp.name : `${fmt(total)} leads`;
    }

    function renderDaily() {
      const box = $("#cp-daily");
      if (!summaryOk()) return;
      const days = state.summary.days || [];
      const daily = currentView().daily || [];
      const totals = daily.map((d) => d[0] + d[1] + d[2]);
      const busiest = totals.length ? Math.max(...totals) : 0;
      const active = totals.filter((t) => t > 0).length;
      $("#cp-daily-note").textContent = days.length ? `${fmt(active)} days · peak ${fmt(busiest)}` : "";
      if (!days.length) {
        box.innerHTML = `<div class="cp-empty">No Created Dates in the published file.</div>`;
        return;
      }
      const w = Math.max(220, Math.floor(box.clientWidth));
      const h = Math.max(80, Math.floor(box.clientHeight));
      const padL = 30;
      const padR = 4;
      const padT = 6;
      const padB = 17;
      const cw = w - padL - padR;
      const ch = h - padT - padB;
      const max = niceMax(Math.max(1, busiest));
      const step = cw / days.length;
      const bw = Math.max(2, Math.min(24, step * 0.66));
      const y = (v) => padT + ch - (v / max) * ch;
      const grid = [0, 0.5, 1].map((f) => {
        const gy = y(max * f);
        return `<line x1="${padL}" x2="${w - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="grid"></line><text x="${padL - 6}" y="${(gy + 3.5).toFixed(1)}" class="ax" text-anchor="end">${fmt(max * f)}</text>`;
      }).join("");
      const every = Math.max(1, Math.ceil(24 / step));
      const bars = days.map((day, i) => {
        const [cN, nN, pN] = daily[i] || [0, 0, 0];
        const x = padL + i * step + (step - bw) / 2;
        let base = padT + ch;
        const rect = (count, cls) => {
          if (!count) return "";
          const hh = (count / max) * ch;
          base -= hh;
          return `<rect x="${x.toFixed(1)}" y="${base.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.6, hh).toFixed(1)}" class="${cls}"></rect>`;
        };
        const sum = cN + nN + pN;
        const tipHtml = `<b>${esc(dayLabel(day, true))}</b><br>${fmt(sum)} leads${sum ? ` · rate ${pct(share(cN, sum))}` : ""}<br><span class="k ok"></span>Contacted ${fmt(cN)}<br><span class="k wait"></span>In progress ${fmt(pN)}<br><span class="k bad"></span>Not contacted ${fmt(nN)}`;
        const label = i % every === 0 ? `<text x="${(padL + i * step + step / 2).toFixed(1)}" y="${h - 4}" class="ax" text-anchor="middle">${esc(dayLabel(day))}</text>` : "";
        return `<g class="day" data-tip="${esc(tipHtml)}"><rect class="hit" x="${(padL + i * step).toFixed(1)}" y="${padT}" width="${step.toFixed(1)}" height="${ch}"></rect>${rect(cN, "c")}${rect(pN, "p")}${rect(nN, "n")}${label}</g>`;
      }).join("");
      box.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily leads by contact status">${grid}${bars}</svg>`;
    }

    function renderSources() {
      const names = state.summary.sources || [];
      const rows = (currentView().sources || [])
        .map((cell, index) => ({ name: names[index], c: cell[0], n: cell[1], p: cell[2], total: cell[0] + cell[1] + cell[2] }))
        .filter((row) => row.total > 0)
        .sort((a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name)))
        .slice(0, 8);
      if (!rows.length) {
        $("#cp-src").innerHTML = `<div class="cp-empty">No lead sources in the published file.</div>`;
        return;
      }
      const max = Math.max(1, ...rows.map((row) => row.total));
      $("#cp-src").innerHTML = rows.map((row) => {
        const rate = share(row.c, row.total);
        const tipHtml = `<b>${esc(row.name)}</b><br>${fmt(row.total)} leads · rate ${pct(rate)}<br><span class="k ok"></span>Contacted ${fmt(row.c)}<br><span class="k bad"></span>Not contacted ${fmt(row.n)}<br><span class="k wait"></span>In progress ${fmt(row.p)}`;
        const seg = (count, color) => (count ? `<i style="width:${share(count, row.total).toFixed(2)}%;background:${color}"></i>` : "");
        return `<div class="cp-src-row" data-tip="${esc(tipHtml)}">
          <span class="nm" title="${esc(row.name)}">${esc(row.name)}</span>
          <span class="track"><span class="fill" style="width:${share(row.total, max).toFixed(2)}%">${seg(row.c, COLORS.contacted)}${seg(row.n, COLORS.not_contacted)}${seg(row.p, COLORS.in_progress)}</span></span>
          <b class="vol">${fmt(row.total)}</b>
          <span class="cp-rate sm ${rateTone(rate)}">${pct(rate)}</span>
        </div>`;
      }).join("");
    }

    /* ---------- focus ---------- */
    function setFocus(key) {
      state.focus = state.focus === key || !key ? "" : key;
      if (!summaryOk()) return;
      renderFocusParts();
      if (state.view === "leads") {
        state.leads.page = 1;
        loadLeads();
      }
    }

    /* ---------- lead detail view ---------- */
    function setView(view) {
      state.view = view;
      const leads = view === "leads";
      app.classList.toggle("is-leads", leads);
      $("#cp-leads").hidden = !leads;
      const toggle = $("#cp-view-leads");
      const label = leads ? "Back to dashboard" : "View leads";
      toggle.querySelector("span").textContent = leads ? "Dashboard" : "View leads";
      toggle.title = label;
      toggle.setAttribute("aria-label", label);
      tip.hidden = true;
      if (leads) {
        state.leads.page = 1;
        renderLeadTools();
        loadLeads();
      } else {
        renderDaily();
      }
    }

    function renderLeadTools() {
      const options = (state.summary && state.summary.options) || {};
      const sel = (key, list, current) => `<select data-lead-filter="${key}" aria-label="${key}">${list.map(([value, label]) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
      const sources = [["", "All sources"]].concat((options.sources || []).map((item) => [item, item]));
      $("#cp-leads-tools").innerHTML = `${sel("contact", CONTACT_OPTIONS, state.leads.contact)}${sel("source", sources, state.leads.source)}
        <label class="cp-control cp-find">${icon("search", 15)}<input type="search" data-lead-search="1" placeholder="Lead number or advisor" value="${esc(state.leads.q)}" /></label>`;
    }

    async function loadLeads() {
      const wrap = $("#cp-lead-wrap");
      const emp = focused();
      $("#cp-leads-scope").textContent = emp ? `Advisor: ${emp.name}` : "All advisors";
      try {
        const data = await getJson(`/api/contact-performance/leads?${query({
          advisor: state.focus,
          contact: state.leads.contact,
          source: state.leads.source,
          q: state.leads.q,
          page: state.leads.page,
          pageSize: 50,
          sort: state.leads.sort,
          dir: state.leads.dir,
        })}`);
        renderLeads(data);
      } catch (err) {
        wrap.innerHTML = `<div class="cp-empty">${esc(err.message || "Leads could not be loaded.")}</div>`;
      }
    }

    function renderLeads(data) {
      const columns = [
        ["leadNumber", "Lead Number"],
        ["employeeName", "Advisor"],
        ["createdSort", "Created"],
        ["leadSource", "Source"],
        ["leadType", "Lead type"],
        ["centre", "Centre"],
        ["bucket", "Contact status"],
        ["crmStatus", "CRM status"],
      ];
      const rows = data.rows || [];
      const body = rows.length ? rows.map((row) => `<tr class="is-pick" data-lead="${esc(row.id)}" tabindex="0">
        <td class="mono">${esc(row.leadNumber || "—")}</td>
        <td title="${esc(row.employeeName)}">${esc(row.employeeName || "—")}</td>
        <td>${esc(row.createdDate || "—")}</td>
        <td title="${esc(row.leadSource)}">${esc(row.leadSource || "—")}</td>
        <td>${esc(row.leadType || "—")}</td>
        <td title="${esc(row.centre)}">${esc(row.centre || "—")}</td>
        <td>${badge(row.bucket, row.contactStatus)}</td>
        <td title="${esc(row.crmStatus)}">${esc(row.crmStatus || "—")}</td>
      </tr>`).join("") : `<tr><td colspan="${columns.length}"><div class="cp-empty">No leads match these filters.</div></td></tr>`;
      $("#cp-lead-wrap").innerHTML = `<table class="cp-table cp-lead-table"><thead><tr>${
        columns.map(([key, label]) => {
          const on = state.leads.sort === key;
          return `<th class="${on ? "is-sorted" : ""}"><button type="button" data-lead-sort="${esc(key)}">${esc(label)}<i>${on ? (state.leads.dir === "asc" ? "↑" : "↓") : ""}</i></button></th>`;
        }).join("")
      }</tr></thead><tbody>${body}</tbody></table>`;
      const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 50)));
      $("#cp-pager").innerHTML = `<span>${fmt(data.total)} leads · page ${data.page} of ${pages}</span>
        <span>
          <button type="button" class="cp-btn" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>Previous</button>
          <button type="button" class="cp-btn" data-page="${data.page + 1}" ${data.page >= pages ? "disabled" : ""}>Next</button>
        </span>`;
    }

    async function openLead(id) {
      const dialog = $("#cp-detail");
      const body = $("#cp-detail-body");
      body.innerHTML = `<p>Loading…</p>`;
      if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
      try {
        const row = await getJson(`/api/contact-performance/leads/${encodeURIComponent(id)}?publication=${encodeURIComponent(state.publication)}`);
        const extras = Object.keys(row.fields || {}).map((key) => `<dt>${esc(key)}</dt><dd>${esc(row.fields[key])}</dd>`).join("");
        const optional = (label, value) => (value ? `<dt>${label}</dt><dd>${esc(value)}</dd>` : "");
        body.innerHTML = `<h3>Lead ${esc(row.leadNumber || row.transactionNo || "")}</h3>
          <dl>
            <dt>Lead Number</dt><dd>${esc(row.leadNumber || "—")}</dd>
            <dt>Advisor</dt><dd>${esc(row.employeeName || "—")}</dd>
            <dt>Contact status</dt><dd>${badge(row.bucket, row.contactStatus)}${row.contactStatusRaw && row.contactStatusRaw !== row.contactStatus ? ` <span class="cp-raw">File: ${esc(row.contactStatusRaw)}</span>` : ""}</dd>
            <dt>Initial contact</dt><dd>${esc(row.initialContact || "—")}</dd>
            <dt>CRM status</dt><dd>${esc(row.crmStatus || "—")}</dd>
            <dt>Created</dt><dd>${esc(row.createdDate || "—")}</dd>
            <dt>Source</dt><dd>${esc(row.leadSource || "—")}</dd>
            <dt>Lead type</dt><dd>${esc(row.leadType || "—")}</dd>
            <dt>Centre</dt><dd>${esc(row.centre || "—")}</dd>
            ${optional("Transaction No.", row.transactionNo)}${optional("Prospect", row.prospect)}${optional("Model", row.model)}${optional("Telephone", row.telephone)}
            ${extras}
          </dl>
          <div class="cp-dialog-actions"><button class="cp-btn" value="cancel">Close</button></div>`;
      } catch (err) {
        body.innerHTML = `<p>${esc(err.message || "Could not open this lead.")}</p><div class="cp-dialog-actions"><button class="cp-btn" value="cancel">Close</button></div>`;
      }
    }

    /* ---------- events ---------- */
    host.addEventListener("change", (event) => {
      if (event.target.id === "cp-period") {
        state.publication = event.target.value;
        state.leads.page = 1;
        loadAll();
        return;
      }
      const filter = event.target.getAttribute("data-lead-filter");
      if (filter) {
        state.leads[filter] = event.target.value;
        state.leads.page = 1;
        loadLeads();
      }
    });

    let leadSearchTimer = null;
    host.addEventListener("input", (event) => {
      if (event.target.id === "cp-search") {
        state.search = event.target.value;
        renderBoard();
        return;
      }
      if (event.target.getAttribute("data-lead-search")) {
        state.leads.q = event.target.value.trim();
        state.leads.page = 1;
        clearTimeout(leadSearchTimer);
        leadSearchTimer = setTimeout(loadLeads, 250);
      }
    });

    host.addEventListener("keydown", (event) => {
      if (event.target.id === "cp-search" && event.key === "Enter") {
        const first = sortedBoard()[0];
        if (first) setFocus(first.key);
        return;
      }
      if (event.key === "Escape" && state.focus && !event.target.closest("dialog")) {
        setFocus("");
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      const row = event.target.closest("tr[data-advisor], tr[data-lead]");
      if (!row || event.target !== row) return;
      event.preventDefault();
      row.click();
    });

    host.addEventListener("click", (event) => {
      if (event.target.closest("#cp-refresh")) { loadAll(); return; }
      if (event.target.closest("#cp-focus")) { setFocus(""); return; }
      if (event.target.closest("#cp-view-leads")) { setView(state.view === "leads" ? "board" : "leads"); return; }
      if (event.target.closest("#cp-leads-back")) { setView("board"); return; }
      const sort = event.target.closest("[data-sort]");
      if (sort) {
        const key = sort.getAttribute("data-sort");
        if (state.sort === key) state.dir = -state.dir;
        else {
          state.sort = key;
          state.dir = key === "rank" || key === "name" ? 1 : -1;
        }
        renderBoard();
        return;
      }
      const advisor = event.target.closest("tr[data-advisor]");
      if (advisor) { setFocus(advisor.getAttribute("data-advisor")); return; }
      const leadSort = event.target.closest("[data-lead-sort]");
      if (leadSort) {
        const key = leadSort.getAttribute("data-lead-sort");
        state.leads.dir = state.leads.sort === key && state.leads.dir === "desc" ? "asc" : "desc";
        state.leads.sort = key;
        state.leads.page = 1;
        loadLeads();
        return;
      }
      const pageBtn = event.target.closest("[data-page]");
      if (pageBtn && !pageBtn.disabled) {
        state.leads.page = Number(pageBtn.getAttribute("data-page")) || 1;
        loadLeads();
        return;
      }
      const lead = event.target.closest("tr[data-lead]");
      if (lead) openLead(lead.getAttribute("data-lead"));
    });

    if (typeof global.ResizeObserver === "function") {
      let frame = 0;
      new global.ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (summaryOk() && state.view === "board") renderDaily();
        });
      }).observe($("#cp-daily"));
    }

    host.__cpReload = loadAll;
    loadAll();
    const poll = setInterval(() => {
      if (!host.isConnected) { clearInterval(poll); return; }
      loadMeta().then((meta) => {
        if (!meta.activeId || meta.activeId === state.activeId) return;
        const viewingActive = !state.publication || state.publication === state.activeId;
        state.activeId = meta.activeId;
        if (viewingActive) {
          state.publication = meta.activeId;
          loadAll();
        } else {
          showStale("A newer dataset was published. Choose the latest reporting period or click Refresh.");
          renderHeader();
        }
      }).catch(() => {});
    }, 45000);
    global.addEventListener("contact-performance-updated", () => {
      if (!host.isConnected) return;
      const viewingActive = !state.publication || state.publication === state.activeId;
      if (viewingActive) state.publication = "";
      loadAll();
    });
  }

  function mountAdmin(host) {
    if (!host || host.dataset.cpAdmin === "1") return;
    host.dataset.cpAdmin = "1";
    host.innerHTML = `<section class="grid-5">
      <label class="slot" id="cp-slot-crm">
        <input id="cp-file-crm" type="file" accept=".xlsx,.xls,.csv,.txt" />
        <div class="n">C</div>
        <h3>Contact file</h3>
        <p class="ar">Sheet "Export"</p>
        <span class="meta" id="cp-meta-crm">Drop or click · .xlsx / .xls / .csv</span>
      </label>
    </section>
    <p class="hint" id="cp-result"></p>`;

    const files = { crm: null };

    function paint(kind) {
      const file = files[kind];
      const slot = host.querySelector(`#cp-slot-${kind}`);
      const meta = host.querySelector(`#cp-meta-${kind}`);
      slot.classList.toggle("loaded", !!file);
      meta.innerHTML = file
        ? `<b>${esc(file.name)}</b><br>${(file.size / 1024).toFixed(1)} KB <span class="pill slot-draft">Draft · not live</span>`
        : "Drop or click · .xlsx / .xls / .csv";
    }
    function readFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const text = String(reader.result || "");
          const base64 = text.includes(",") ? text.split(",")[1] : "";
          resolve({ name: file.name, base64 });
        };
        reader.onerror = () => reject(new Error("Could not read the file."));
        reader.readAsDataURL(file);
      });
    }
    function setChosen(kind, file) {
      files[kind] = file || null;
      paint(kind);
      host.querySelector("#cp-result").textContent = "";
    }
    host.addEventListener("change", (event) => {
      if (event.target.id === "cp-file-crm" && event.target.files[0]) setChosen("crm", event.target.files[0]);
    });
    async function publishDraft() {
      const note = host.querySelector("#cp-result");
      if (!files.crm) return null;
      const now = new Date();
      const period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      const crmFile = await readFile(files.crm);
      const preview = await getJson("/api/contact-performance/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, publishedBy: "Administrator", crmFile, contactFile: null }),
      });
      const counts = preview.counts || {};
      const summary = counts.leads ? ` · ${fmt(counts.leads)} leads · ${fmt(counts.advisors)} advisors` : "";
      if (preview.duplicate) {
        host.querySelectorAll(".slot-draft").forEach((el) => el.remove());
        note.textContent = "";
        return { ok: true, message: `Same contact file is already live for ${periodLabel(preview.period)} — no duplicate snapshot created.` };
      }
      await getJson("/api/contact-performance/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: preview.draftId }),
      });
      host.querySelectorAll(".slot-draft").forEach((el) => el.remove());
      note.textContent = (preview.warnings || []).length ? `Notes: ${preview.warnings.join(" ")}` : "";
      return { ok: true, message: `Contact Performance is live for ${periodLabel(preview.period)}${summary}.` };
    }

    host.__cpPublish = publishDraft;
  }

  function publishDraft() {
    const host = document.getElementById("contact-admin-host");
    if (!host || typeof host.__cpPublish !== "function") return null;
    return host.__cpPublish();
  }

  global.ContactPerformance = { mount, mountAdmin, publishDraft };
})(window);
