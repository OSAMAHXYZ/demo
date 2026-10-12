(function (global) {
  "use strict";

  const COLORS = {
    contacted: "#16A34A",
    not_contacted: "#DC2626",
    in_progress: "#F59E0B",
    unknown: "#98A2B3",
    unmatched: "#7C3AED",
  };
  const CONTACT_OPTIONS = [
    ["", "All CRM leads"],
    ["matched", "Matched"],
    ["contacted", "Contacted"],
    ["not_contacted", "Not Contacted"],
    ["in_progress", "In Progress"],
    ["unknown", "Unknown/Missing Status"],
    ["unmatched", "Unmatched — No Contact Record"],
    ["contact_only", "Contact tracking only"],
  ];

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

  function pct(value) {
    return value == null ? "N/A" : `${Number(value).toFixed(1)}%`;
  }

  function stamp(ms) {
    if (!ms) return "—";
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function periodLabel(period) {
    const match = String(period || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return "No published period";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return date.toLocaleString("en-GB", { month: "long", year: "numeric" });
  }

  function badge(bucket, label) {
    const key = bucket || "unknown";
    return `<span class="cp-badge ${esc(key)}">${esc(label || "Unknown")}</span>`;
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
    host.innerHTML = `<div class="cp-app">
      <header class="cp-header">
        <div>
          <h2>Toyota Contact Performance Dashboard</h2>
          <p id="cp-sub">Waiting for a published dataset</p>
        </div>
        <div class="cp-header-side">
          <span class="cp-pill" id="cp-fresh"><i></i><span>No dataset</span></span>
          <span class="cp-user" id="cp-user"></span>
          <button type="button" class="cp-btn primary" id="cp-refresh">Refresh</button>
        </div>
      </header>
      <div class="cp-banner" id="cp-stale" hidden></div>
      <div class="cp-filters" id="cp-filters"></div>
      <div class="cp-chips" id="cp-chips"></div>
      <div class="cp-kpis" id="cp-kpis"></div>
      <p class="cp-note" id="cp-equation"></p>
      <div class="cp-charts">
        <section class="cp-card">
          <h3>Contact Status Distribution</h3>
          <div class="cp-chart-row">
            <div class="cp-chart-box"><canvas id="cp-donut"></canvas></div>
            <ul class="cp-legend" id="cp-donut-legend"></ul>
          </div>
        </section>
        <section class="cp-card">
          <h3>CRM Status Breakdown</h3>
          <div class="cp-chart-box" id="cp-bar-box"><canvas id="cp-bars"></canvas></div>
        </section>
      </div>
      <section class="cp-card cp-employees">
        <div class="cp-section-head">
          <h3>Employee performance</h3>
          <span class="cp-count" id="cp-emp-count">0 employees</span>
          <input id="cp-emp-search" type="search" placeholder="Search name or employee number" aria-label="Search employees" />
          <button type="button" class="cp-btn" id="cp-emp-all">All employees</button>
          <button type="button" class="cp-btn" id="cp-emp-expand">View all employees</button>
        </div>
        <div class="cp-table-wrap" id="cp-emp-wrap"></div>
      </section>
      <section class="cp-card cp-leads">
        <h3>Lead detail</h3>
        <div class="cp-table-wrap" id="cp-lead-wrap"></div>
        <div class="cp-pager" id="cp-pager"></div>
      </section>
      <dialog class="cp-detail" id="cp-detail"><form method="dialog" id="cp-detail-body"></form></dialog>
    </div>`;

    const state = {
      publication: "",
      filters: { employee: "", centre: "", source: "", leadType: "", contact: "", crm: "", q: "" },
      sort: "createdSort",
      dir: "desc",
      page: 1,
      summary: null,
      periods: [],
      activeId: "",
      empSort: "rank",
      empDir: "asc",
      empQuery: "",
      charts: [],
    };
    const userCard = document.querySelector(".sidebar-user-meta strong");
    const userRole = document.querySelector(".sidebar-user-meta span");
    const userEl = host.querySelector("#cp-user");
    if (userEl) {
      userEl.innerHTML = `<b>${esc(userCard ? userCard.textContent : "Dashboard user")}</b> · ${esc(userRole ? userRole.textContent : "Report sheet")}`;
    }

    function query(extra) {
      const params = new URLSearchParams();
      if (state.publication) params.set("publication", state.publication);
      Object.keys(state.filters).forEach((key) => {
        if (state.filters[key]) params.set(key, state.filters[key]);
      });
      if (extra) Object.keys(extra).forEach((key) => params.set(key, extra[key]));
      return params.toString();
    }

    function destroyCharts() {
      state.charts.forEach((chart) => { try { chart.destroy(); } catch (err) { /* ignore */ } });
      state.charts = [];
    }

    async function loadMeta() {
      const meta = await getJson("/api/contact-performance/meta");
      state.periods = meta.periods || [];
      state.activeId = meta.activeId || "";
      return meta;
    }

    async function loadAll() {
      const refresh = host.querySelector("#cp-refresh");
      if (refresh) refresh.disabled = true;
      try {
        await loadMeta();
        const summary = await getJson(`/api/contact-performance/summary?${query()}`);
        state.summary = summary;
        if (summary.publicationId) state.publication = summary.publicationId;
        render();
        await loadLeads();
        const stale = host.querySelector("#cp-stale");
        if (stale) stale.hidden = true;
      } catch (err) {
        host.querySelector("#cp-sub").textContent = err.message || "The dashboard could not be loaded.";
      } finally {
        if (refresh) refresh.disabled = false;
      }
    }

    async function loadLeads() {
      const wrap = host.querySelector("#cp-lead-wrap");
      try {
        const data = await getJson(`/api/contact-performance/leads?${query({
          page: state.page,
          pageSize: 25,
          sort: state.sort,
          dir: state.dir,
        })}`);
        renderLeads(data);
      } catch (err) {
        wrap.innerHTML = `<div class="cp-empty">${esc(err.message || "Leads could not be loaded.")}</div>`;
      }
    }

    function render() {
      const summary = state.summary || { empty: true };
      const sub = host.querySelector("#cp-sub");
      const fresh = host.querySelector("#cp-fresh");
      if (summary.empty) {
        sub.textContent = "An administrator publishes the contact-tracking file and the CRM export from Admin → Data Management.";
        fresh.className = "cp-pill";
        fresh.innerHTML = "<i></i><span>Not published</span>";
      } else {
        const historical = summary.publicationId && state.activeId && summary.publicationId !== state.activeId;
        sub.textContent = `${periodLabel(summary.period)} · ${summary.contactFile || "Contact file"} + ${summary.crmFile || "CRM file"} · Last updated ${stamp(summary.publishedAt)}`;
        fresh.className = historical ? "cp-pill is-historical" : "cp-pill";
        fresh.innerHTML = `<i></i><span>${historical ? "Historical snapshot" : "Published"} · ${esc(stamp(summary.publishedAt))}</span>`;
      }
      renderFilters();
      renderChips();
      renderKpis();
      renderCharts();
      renderEmployees();
      const equation = host.querySelector("#cp-equation");
      const recon = summary.reconciliation;
      equation.textContent = recon
        ? `${recon.equation}. Contact-tracking-only records: ${fmt(recon.contactOnly)}. Unknown contact status is not counted as Not Contacted. ACH% is N/A until an approved contact target exists.`
        : "";
    }

    function fieldSelect(key, label, options, current) {
      const hasAll = options.some((item) => (typeof item === "string" ? item : item.key) === "");
      const opts = (hasAll ? [] : [`<option value="">All</option>`]).concat(options.map((item) => {
        const value = typeof item === "string" ? item : item.key;
        const text = typeof item === "string" ? item : item.label;
        return `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(text)}</option>`;
      }));
      return `<label class="cp-field"><span>${esc(label)}</span><select data-filter="${esc(key)}">${opts.join("")}</select></label>`;
    }

    function renderFilters() {
      const summary = state.summary || {};
      const options = summary.options || {};
      const columns = summary.columns || {};
      const periods = state.periods || [];
      const parts = [];
      parts.push(`<label class="cp-field"><span>Reporting period</span><select data-period="1">${
        periods.map((item) => `<option value="${esc(item.id)}"${item.id === state.publication ? " selected" : ""}>${esc(periodLabel(item.period))}</option>`).join("")
        || `<option value="">No period</option>`
      }</select></label>`);
      if ((options.employees || []).length) {
        parts.push(fieldSelect("employee", "Employee", [{ key: "", label: "All employees" }].concat(options.employees), state.filters.employee));
      }
      if (columns.centre && (options.centres || []).length) parts.push(fieldSelect("centre", "Centre", options.centres, state.filters.centre));
      if (columns.source && (options.sources || []).length) parts.push(fieldSelect("source", "Lead source", options.sources, state.filters.source));
      if (columns.leadType && (options.leadTypes || []).length) parts.push(fieldSelect("leadType", "Lead type", options.leadTypes, state.filters.leadType));
      parts.push(fieldSelect("contact", "Contact status", CONTACT_OPTIONS.map(([key, label]) => ({ key, label })), state.filters.contact));
      if (columns.crmStatus && (options.crmStatuses || []).length) parts.push(fieldSelect("crm", "CRM status", options.crmStatuses, state.filters.crm));
      parts.push(`<label class="cp-field search"><span>Search</span><input data-search="1" type="search" placeholder="Lead, transaction, prospect, telephone" value="${esc(state.filters.q)}" /></label>`);
      parts.push(`<button type="button" class="cp-btn" id="cp-reset">Reset filters</button>`);
      host.querySelector("#cp-filters").innerHTML = parts.join("");
    }

    function renderChips() {
      const labels = {
        employee: "Employee",
        centre: "Centre",
        source: "Source",
        leadType: "Lead type",
        contact: "Contact",
        crm: "CRM",
        q: "Search",
      };
      const chips = Object.keys(state.filters).filter((key) => state.filters[key]).map((key) => {
        const raw = state.filters[key];
        const text = key === "contact" ? (CONTACT_OPTIONS.find((item) => item[0] === raw) || ["", raw])[1] : raw;
        return `<button type="button" class="cp-chip" data-clear="${esc(key)}">${esc(labels[key])}: ${esc(text)} ×</button>`;
      });
      host.querySelector("#cp-chips").innerHTML = chips.join("");
    }

    function renderKpis() {
      const kpis = (state.summary && state.summary.kpis) || {};
      const cards = [
        ["", "Total CRM Leads", fmt(kpis.totalCrm), "Unique transactions", ""],
        ["matched", "Matched Leads", fmt(kpis.matched), "Column C in both files", "info"],
        ["contacted", "Contacted Leads", fmt(kpis.exportContacted), `${pct(kpis.contactedOfCrm)} of CRM total`, "ok"],
        ["not_contacted", "Not Contacted Leads", fmt(kpis.exportNotContacted), `${pct(kpis.notContactedOfCrm)} of CRM total`, "bad"],
        ["in_progress", "In Progress Leads", fmt(kpis.inProgress), "Matched, in progress", "wait"],
        ["contacted", "Contact Rate", pct(kpis.contactRate), "Contacted ÷ matched", ""],
      ];
      host.querySelector("#cp-kpis").innerHTML = cards.map((card, index) => {
        const on = index < 5 && state.filters.contact === card[0] && card[0] !== "";
        return `<button type="button" class="cp-kpi ${card[4]}${on ? " is-on" : ""}" data-kpi="${esc(card[0])}" data-kpi-index="${index}">
          <span class="lab">${esc(card[1])}</span>
          <span class="val">${esc(card[2])}</span>
          <span class="sub">${esc(card[3])}</span>
        </button>`;
      }).join("");
    }

    function renderCharts() {
      destroyCharts();
      const summary = state.summary || {};
      const distribution = summary.distribution || [];
      const legend = host.querySelector("#cp-donut-legend");
      legend.innerHTML = distribution.map((item) => {
        const share = item.key === "contacted" || item.key === "not_contacted"
          ? `${Number(item.pct || 0).toFixed(1)}% of CRM`
          : `${Number(item.pct || 0).toFixed(1)}%`;
        return `<li><button type="button" data-contact="${esc(item.key)}">
        <i class="sw" style="background:${COLORS[item.key] || "#98A2B3"}"></i>
        <span>${esc(item.label)}</span>
        <b>${fmt(item.count)}</b>
        <span class="muted">${esc(share)}</span>
      </button></li>`;
      }).join("") || `<li class="cp-empty">No records</li>`;
      if (global.Chart) {
        const donut = host.querySelector("#cp-donut");
        state.charts.push(new global.Chart(donut, {
          type: "doughnut",
          data: {
            labels: distribution.map((item) => item.label),
            datasets: [{
              data: distribution.map((item) => item.count),
              backgroundColor: distribution.map((item) => COLORS[item.key] || "#98A2B3"),
              borderWidth: 0,
            }],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            onClick: (_evt, elements) => {
              if (!elements.length) return;
              setContact(distribution[elements[0].index].key);
            },
          },
        }));
        const bars = summary.crmBars || [];
        const box = host.querySelector("#cp-bar-box");
        box.style.height = `${Math.max(160, bars.length * 26)}px`;
        state.charts.push(new global.Chart(host.querySelector("#cp-bars"), {
          type: "bar",
          data: {
            labels: bars.map((item) => item.label),
            datasets: [{ data: bars.map((item) => item.count), backgroundColor: "#3563E9", borderRadius: 4, maxBarThickness: 16 }],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { ticks: { precision: 0, color: "#8d9bb0" }, grid: { color: "rgba(148, 163, 184, 0.16)" } },
              y: { ticks: { color: "#e8eef7", font: { size: 11 }, autoSkip: false }, grid: { display: false } },
            },
            onClick: (_evt, elements) => {
              if (!elements.length) return;
              state.filters.crm = bars[elements[0].index].label === "(blank)" ? "" : bars[elements[0].index].label;
              state.page = 1;
              loadAll();
            },
          },
        }));
      }
    }

    function renderEmployees() {
      const all = ((state.summary && state.summary.employees) || []).slice();
      const q = String(state.empQuery || "").trim().toLowerCase();
      const rows = (q ? all.filter((row) => `${row.name} ${row.number || ""}`.toLowerCase().includes(q)) : all).slice();
      const dir = state.empDir === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        const key = state.empSort;
        const av = key === "contactRate" && a.contactRate == null ? -1 : a[key];
        const bv = key === "contactRate" && b.contactRate == null ? -1 : b[key];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av || "").localeCompare(String(bv || "")) * dir;
      });
      const count = host.querySelector("#cp-emp-count");
      if (count) count.textContent = `Showing ${fmt(rows.length)} of ${fmt(all.length)} employees`;
      const head = (key, label) => `<th><button type="button" data-emp-sort="${esc(key)}">${esc(label)}</button></th>`;
      const body = rows.length ? rows.map((row) => `<tr class="is-pick${state.filters.employee === row.key ? " is-on" : ""}" data-employee="${esc(row.key)}">
        <td class="num">${row.rank}</td>
        <td title="${esc(row.name)}">${esc(row.name)}</td>
        <td>${esc(row.number || "—")}</td>
        <td class="num">${fmt(row.matched)}</td>
        <td class="num">${fmt(row.contacted)}</td>
        <td class="num">${fmt(row.notContacted)}</td>
        <td class="num">${fmt(row.inProgress)}</td>
        <td class="num">${esc(pct(row.contactRate))}</td>
        <td>N/A</td>
        <td><span class="cp-meter" title="Contact rate from matched leads"><span style="width:${Math.max(0, Math.min(100, row.contactRate || 0))}%"></span></span>${esc(pct(row.contactRate))} <span class="cp-vol">${fmt(row.matched)} leads</span></td>
      </tr>`).join("") : `<tr><td colspan="10"><div class="cp-empty">${all.length ? "No employees match that search." : "No employees for the current filters."}</div></td></tr>`;
      host.querySelector("#cp-emp-wrap").innerHTML = `<table class="cp-table">
        <thead><tr>
          ${head("rank", "Rank")}${head("name", "Employee")}${head("number", "Employee no.")}
          ${head("matched", "Matched")}${head("contacted", "Contacted")}${head("notContacted", "Not contacted")}
          ${head("inProgress", "In progress")}${head("contactRate", "Contact rate")}<th>ACH%</th><th>Indicator</th>
        </tr></thead><tbody>${body}</tbody></table>`;
    }

    function renderLeads(data) {
      const columns = [
        ["leadNumber", "Lead Number"],
        ["transactionNo", "Transaction No."],
        ["prospect", "Prospect"],
        ["model", "Model"],
        ["employeeName", "Employee"],
        ["centre", "Centre"],
        ["leadSource", "Source"],
        ["leadType", "Lead type"],
        ["initialContact", "Initial contact"],
        ["bucket", "Contact status"],
        ["crmStatus", "CRM status"],
        ["createdSort", "Created"],
      ];
      const rows = data.rows || [];
      const body = rows.length ? rows.map((row) => `<tr class="is-pick" data-lead="${esc(row.id)}">
        <td title="${esc(row.leadNumber)}">${esc(row.leadNumber || "—")}</td>
        <td title="${esc(row.transactionNo)}">${esc(row.transactionNo || "—")}</td>
        <td title="${esc(row.prospect)}">${esc(row.prospect || "—")}</td>
        <td title="${esc(row.model)}">${esc(row.model || "—")}</td>
        <td title="${esc(row.employeeName)}">${esc(row.employeeName || "—")}</td>
        <td title="${esc(row.centre)}">${esc(row.centre || "—")}</td>
        <td title="${esc(row.leadSource)}">${esc(row.leadSource || "—")}</td>
        <td title="${esc(row.leadType)}">${esc(row.leadType || "—")}</td>
        <td title="${esc(row.initialContact)}">${esc(row.initialContact || "—")}</td>
        <td>${badge(row.bucket, row.contactStatus)}</td>
        <td title="${esc(row.crmStatus)}">${esc(row.crmStatus || "—")}</td>
        <td>${esc(row.createdDate || "—")}</td>
      </tr>`).join("") : `<tr><td colspan="12"><div class="cp-empty">No leads match these filters.</div></td></tr>`;
      host.querySelector("#cp-lead-wrap").innerHTML = `<table class="cp-table"><thead><tr>${
        columns.map(([key, label]) => `<th><button type="button" data-sort="${esc(key)}">${esc(label)}</button></th>`).join("")
      }</tr></thead><tbody>${body}</tbody></table>`;
      const pages = Math.max(1, Math.ceil((data.total || 0) / (data.pageSize || 25)));
      host.querySelector("#cp-pager").innerHTML = `<span>${fmt(data.total)} records · page ${data.page} of ${pages}</span>
        <span>
          <button type="button" class="cp-btn" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>Previous</button>
          <button type="button" class="cp-btn" data-page="${data.page + 1}" ${data.page >= pages ? "disabled" : ""}>Next</button>
        </span>`;
    }

    function setContact(key) {
      state.filters.contact = state.filters.contact === key ? "" : key;
      state.page = 1;
      renderFilters();
      renderChips();
      renderKpis();
      loadLeads();
    }

    host.addEventListener("change", (event) => {
      const filter = event.target.getAttribute("data-filter");
      if (filter) {
        state.filters[filter] = event.target.value;
        state.page = 1;
        if (filter === "contact") {
          renderChips();
          renderKpis();
          loadLeads();
        } else loadAll();
        return;
      }
      if (event.target.getAttribute("data-period") != null) {
        state.publication = event.target.value;
        state.page = 1;
        loadAll();
      }
    });
    let searchTimer = null;
    host.addEventListener("input", (event) => {
      if (!event.target.getAttribute("data-search")) return;
      state.filters.q = event.target.value.trim();
      state.page = 1;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadAll(), 250);
    });
    host.addEventListener("click", (event) => {
      const clear = event.target.closest("[data-clear]");
      if (clear) {
        state.filters[clear.getAttribute("data-clear")] = "";
        state.page = 1;
        loadAll();
        return;
      }
      if (event.target.closest("#cp-reset")) {
        state.filters = { employee: "", centre: "", source: "", leadType: "", contact: "", crm: "", q: "" };
        state.empQuery = "";
        const search = host.querySelector("#cp-emp-search");
        if (search) search.value = "";
        state.page = 1;
        loadAll();
        return;
      }
      if (event.target.closest("#cp-refresh")) {
        loadAll();
        return;
      }
      if (event.target.closest("#cp-emp-all")) {
        state.filters.employee = "";
        state.empQuery = "";
        const search = host.querySelector("#cp-emp-search");
        if (search) search.value = "";
        state.page = 1;
        loadAll();
        return;
      }
      if (event.target.closest("#cp-emp-expand")) {
        const app = host.querySelector(".cp-app");
        const open = app.classList.toggle("is-roster");
        event.target.closest("#cp-emp-expand").textContent = open ? "Back to dashboard" : "View all employees";
        return;
      }
      const kpi = event.target.closest("[data-kpi]");
      if (kpi) {
        const index = kpi.getAttribute("data-kpi-index");
        if (index === "0") state.filters.contact = "";
        else setContact(kpi.getAttribute("data-kpi"));
        if (index === "0") { state.page = 1; renderFilters(); renderChips(); renderKpis(); loadLeads(); }
        return;
      }
      const contact = event.target.closest("[data-contact]");
      if (contact) { setContact(contact.getAttribute("data-contact")); return; }
      const empSort = event.target.closest("[data-emp-sort]");
      if (empSort) {
        const key = empSort.getAttribute("data-emp-sort");
        state.empDir = state.empSort === key && state.empDir === "asc" ? "desc" : "asc";
        state.empSort = key;
        renderEmployees();
        return;
      }
      const employee = event.target.closest("[data-employee]");
      if (employee && !event.target.closest("[data-emp-sort]")) {
        state.filters.employee = employee.getAttribute("data-employee");
        state.page = 1;
        loadAll();
        return;
      }
      const sort = event.target.closest("[data-sort]");
      if (sort) {
        const key = sort.getAttribute("data-sort");
        state.dir = state.sort === key && state.dir === "desc" ? "asc" : "desc";
        state.sort = key;
        state.page = 1;
        loadLeads();
        return;
      }
      const pageBtn = event.target.closest("[data-page]");
      if (pageBtn && !pageBtn.disabled) {
        state.page = Number(pageBtn.getAttribute("data-page")) || 1;
        loadLeads();
        return;
      }
      const lead = event.target.closest("[data-lead]");
      if (lead) openLead(lead.getAttribute("data-lead"));
    });

    host.querySelector("#cp-emp-search").addEventListener("input", (event) => {
      state.empQuery = event.target.value;
      renderEmployees();
    });

    async function openLead(id) {
      const dialog = host.querySelector("#cp-detail");
      const body = host.querySelector("#cp-detail-body");
      body.innerHTML = `<p>Loading…</p>`;
      if (typeof dialog.showModal === "function") dialog.showModal();
      try {
        const row = await getJson(`/api/contact-performance/leads/${encodeURIComponent(id)}?publication=${encodeURIComponent(state.publication)}`);
        const extras = Object.keys(row.fields || {}).map((key) => `<dt>${esc(key)}</dt><dd>${esc(row.fields[key])}</dd>`).join("");
        body.innerHTML = `<h3>${esc(row.prospect || row.transactionNo || row.leadNumber || "Lead")}</h3>
          <dl>
            <dt>Lead Number</dt><dd>${esc(row.leadNumber || "—")}</dd>
            <dt>Transaction No.</dt><dd>${esc(row.transactionNo || "—")}</dd>
            <dt>Prospect</dt><dd>${esc(row.prospect || "—")}</dd>
            <dt>Model</dt><dd>${esc(row.model || "—")}</dd>
            <dt>Employee</dt><dd>${esc(row.employeeName || "—")} ${row.employeeNumber ? "· " + esc(row.employeeNumber) : ""}</dd>
            <dt>Centre</dt><dd>${esc(row.centre || "—")}</dd>
            <dt>Source</dt><dd>${esc(row.leadSource || "—")}</dd>
            <dt>Lead type</dt><dd>${esc(row.leadType || "—")}</dd>
            <dt>Initial contact</dt><dd>${esc(row.initialContact || "—")}</dd>
            <dt>Contact status</dt><dd>${badge(row.bucket, row.contactStatus)} ${row.contactStatusRaw ? `<span class="cp-note">Source: ${esc(row.contactStatusRaw)}</span>` : ""}</dd>
            <dt>CRM status</dt><dd>${esc(row.crmStatus || "—")}</dd>
            <dt>Created</dt><dd>${esc(row.createdDate || "—")}</dd>
            <dt>Telephone</dt><dd>${esc(row.telephone || "—")}</dd>
            ${extras}
          </dl>
          <div class="cp-actions" style="margin-top:12px"><button class="cp-btn" value="cancel">Close</button></div>`;
      } catch (err) {
        body.innerHTML = `<p>${esc(err.message || "Could not open this lead.")}</p><button class="cp-btn" value="cancel">Close</button>`;
      }
    }

    host.__cpReload = loadAll;
    loadAll();
    const poll = setInterval(() => {
      if (!host.isConnected) { clearInterval(poll); return; }
      loadMeta().then((meta) => {
        if (!meta.activeId || meta.activeId === state.activeId) return;
        const viewingActive = !state.publication || state.publication === state.activeId;
        state.activeId = meta.activeId;
        const stale = host.querySelector("#cp-stale");
        if (viewingActive) {
          state.publication = meta.activeId;
          loadAll();
        } else if (stale) {
          stale.hidden = false;
          stale.textContent = "A newer dataset was published. Choose the latest reporting period or click Refresh.";
        }
      }).catch(() => {});
    }, 45000);
    global.addEventListener("contact-performance-updated", () => {
      if (host.isConnected) loadAll();
    });
  }

  function mountAdmin(host) {
    if (!host || host.dataset.cpAdmin === "1") return;
    host.dataset.cpAdmin = "1";
    host.innerHTML = `<div class="cp-admin">
      <section class="cp-card">
        <h3>Data Management</h3>
        <p class="cp-note">Upload the contact-tracking workbook and the CRM export, validate them, then publish. Choosing a file does not replace the live dataset.</p>
        <div class="cp-filters" style="border:0;padding:8px 0 0">
          <label class="cp-field"><span>Reporting period</span><input id="cp-period" type="month" /></label>
          <label class="cp-field"><span>Published by</span><input id="cp-by" type="text" maxlength="80" placeholder="Administrator" /></label>
          <label class="cp-field"><span>Admin password</span><input id="cp-pass" type="password" autocomplete="current-password" /></label>
        </div>
      </section>
      <div class="cp-admin-grid">
        <section class="cp-card" id="cp-card-contact">
          <h3>Contact Tracking File</h3>
          <div class="cp-drop" data-drop="contact">
            <b>Drop the Export workbook</b>
            <p>.xlsx with an Export worksheet</p>
            <button type="button" class="cp-btn" data-browse="contact">Browse files</button>
            <input id="cp-file-contact" type="file" accept=".xlsx,.xls,.csv,.txt" hidden />
          </div>
          <div class="cp-filemeta" id="cp-meta-contact">No file selected.</div>
        </section>
        <section class="cp-card" id="cp-card-crm">
          <h3>CRM Export File</h3>
          <div class="cp-drop" data-drop="crm">
            <b>Drop the CRM export</b>
            <p>.xlsx, .csv, or .txt</p>
            <button type="button" class="cp-btn" data-browse="crm">Browse files</button>
            <input id="cp-file-crm" type="file" accept=".xlsx,.xls,.csv,.txt" hidden />
          </div>
          <div class="cp-filemeta" id="cp-meta-crm">No file selected.</div>
        </section>
      </div>
      <div class="cp-actions">
        <button type="button" class="cp-btn" id="cp-validate">Validate files</button>
        <button type="button" class="cp-btn primary" id="cp-publish" disabled>Publish dataset</button>
        <button type="button" class="cp-btn ghost" id="cp-cancel" disabled>Cancel</button>
      </div>
      <div id="cp-result"></div>
      <section class="cp-card">
        <h3>Publication history</h3>
        <div class="cp-history" id="cp-history"><div class="cp-empty">Enter the admin password and the history will load.</div></div>
      </section>
      <dialog class="cp-detail" id="cp-pub-dialog"><form method="dialog" id="cp-pub-body"></form></dialog>
    </div>`;

    const files = { contact: null, crm: null };
    let draftId = "";
    const now = new Date();
    host.querySelector("#cp-period").value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    function password() {
      return host.querySelector("#cp-pass").value;
    }
    function headers() {
      return { "Content-Type": "application/json", "X-Admin-Password": password() };
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
      files[kind] = file;
      host.querySelector(`#cp-meta-${kind}`).textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(0)} KB · not published` : "No file selected.";
    }
    host.addEventListener("click", (event) => {
      const browse = event.target.closest("[data-browse]");
      if (browse) host.querySelector(`#cp-file-${browse.getAttribute("data-browse")}`).click();
    });
    host.addEventListener("change", (event) => {
      if (event.target.id === "cp-file-contact" && event.target.files[0]) setChosen("contact", event.target.files[0]);
      if (event.target.id === "cp-file-crm" && event.target.files[0]) setChosen("crm", event.target.files[0]);
      if (event.target.id === "cp-pass") loadHistory();
    });
    host.querySelectorAll("[data-drop]").forEach((zone) => {
      ["dragover", "dragleave", "drop"].forEach((name) => zone.addEventListener(name, (event) => {
        event.preventDefault();
        zone.classList.toggle("is-over", name === "dragover");
        if (name === "drop" && event.dataTransfer.files[0]) setChosen(zone.getAttribute("data-drop"), event.dataTransfer.files[0]);
      }));
    });

    function showResult(html) {
      host.querySelector("#cp-result").innerHTML = html;
    }

    host.querySelector("#cp-validate").addEventListener("click", async () => {
      const button = host.querySelector("#cp-validate");
      if (!files.contact || !files.crm) {
        showResult(`<div class="cp-banner bad">Select both the contact-tracking file and the CRM export.</div>`);
        return;
      }
      if (!password()) {
        showResult(`<div class="cp-banner bad">Enter the admin password. Employees cannot publish this dataset.</div>`);
        return;
      }
      button.disabled = true;
      button.textContent = "Validating…";
      host.querySelector("#cp-publish").disabled = true;
      try {
        const contactFile = await readFile(files.contact);
        const crmFile = await readFile(files.crm);
        const result = await getJson("/api/contact-performance/preview", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            period: host.querySelector("#cp-period").value,
            publishedBy: host.querySelector("#cp-by").value,
            contactFile,
            crmFile,
          }),
        });
        draftId = result.draftId;
        const rec = result.reconciliation || {};
        const warnings = (result.warnings || []).map((item) => `<li>${esc(item)}</li>`).join("");
        showResult(`<section class="cp-card">
          <h3>Validation passed — not published yet</h3>
          <p class="cp-note">Contact worksheet ${esc(result.contactSheet || "—")} · ${fmt(result.contactRows)} rows. CRM worksheet ${esc(result.crmSheet || "—")} · ${fmt(result.crmRows)} rows.</p>
          <p class="cp-note">${esc(rec.equation || "")}. Contact-tracking only: ${fmt(rec.contactOnly)}. Duplicate keys left unmatched: ${fmt((rec.contactUnresolved || 0) + (rec.crmUnresolved || 0))}. Missing identifiers: ${fmt((rec.contactMissingId || 0) + (rec.crmMissingId || 0))}. Unknown contact status: ${fmt(rec.unknownStatus)}. Employee name mismatches: ${fmt(rec.employeeIssueCount)}.</p>
          ${warnings ? `<div class="cp-banner wait"><b>Warnings</b><ul>${warnings}</ul></div>` : ""}
        </section>`);
        host.querySelector("#cp-publish").disabled = false;
        host.querySelector("#cp-cancel").disabled = false;
      } catch (err) {
        draftId = "";
        const errors = (err.payload && err.payload.errors) || [err.message];
        showResult(`<div class="cp-banner bad"><b>Publication blocked.</b> The current dataset was not changed.<ul>${errors.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`);
      } finally {
        button.disabled = false;
        button.textContent = "Validate files";
      }
    });

    host.querySelector("#cp-publish").addEventListener("click", async () => {
      if (!draftId) return;
      const period = host.querySelector("#cp-period").value;
      if (!global.confirm(`Publish the validated dataset for ${periodLabel(period)}? The previous dataset for that period stays in history.`)) return;
      const button = host.querySelector("#cp-publish");
      button.disabled = true;
      button.textContent = "Publishing…";
      try {
        const result = await getJson("/api/contact-performance/publish", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ draftId }),
        });
        draftId = "";
        files.contact = null;
        files.crm = null;
        host.querySelector("#cp-file-contact").value = "";
        host.querySelector("#cp-file-crm").value = "";
        setChosen("contact", null);
        setChosen("crm", null);
        showResult(`<div class="cp-banner">Published ${esc(periodLabel(result.period))} at ${esc(stamp(result.at))}.</div>`);
        host.querySelector("#cp-cancel").disabled = true;
        await loadHistory();
      } catch (err) {
        showResult(`<div class="cp-banner bad">${esc(err.message || "Publish failed. The previous dataset is still active.")}</div>`);
        button.disabled = false;
      } finally {
        button.textContent = "Publish dataset";
      }
    });

    host.querySelector("#cp-cancel").addEventListener("click", async () => {
      if (!draftId) return;
      if (!global.confirm("Cancel this preview? The published dataset will stay as it is.")) return;
      try {
        await getJson("/api/contact-performance/cancel", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ draftId }),
        });
      } catch (err) { /* preview already gone */ }
      draftId = "";
      host.querySelector("#cp-publish").disabled = true;
      host.querySelector("#cp-cancel").disabled = true;
      showResult(`<div class="cp-banner">Preview cancelled. The live dataset was not changed.</div>`);
    });

    async function loadHistory() {
      const box = host.querySelector("#cp-history");
      if (!password()) {
        box.innerHTML = `<div class="cp-empty">Enter the admin password to load publication history.</div>`;
        return;
      }
      try {
        const data = await getJson("/api/contact-performance/history", { headers: headers() });
        const rows = data.publications || [];
        if (!rows.length) {
          box.innerHTML = `<div class="cp-empty">No dataset has been published yet.</div>`;
          return;
        }
        box.innerHTML = `<table class="cp-table"><thead><tr>
          <th>Period</th><th>Contact file</th><th>CRM file</th><th>Published</th><th>By</th>
          <th>Matched</th><th>Unmatched</th><th>Duplicates</th><th>Status</th><th></th>
        </tr></thead><tbody>${rows.map((row) => `<tr>
          <td>${esc(periodLabel(row.period))}</td>
          <td title="${esc(row.contactFile)}">${esc(row.contactFile)}</td>
          <td title="${esc(row.crmFile)}">${esc(row.crmFile)}</td>
          <td>${esc(stamp(row.at))}</td>
          <td>${esc(row.by || "Administrator")}</td>
          <td class="num">${fmt(row.counts && row.counts.matched)}</td>
          <td class="num">${fmt(row.counts && row.counts.crmOnly)}</td>
          <td class="num">${fmt(row.counts && row.counts.duplicates)}</td>
          <td>${row.active ? "Active" : esc(row.status || "Published")}</td>
          <td>
            <button type="button" class="cp-btn" data-view="${esc(row.id)}">Details</button>
            <button type="button" class="cp-btn" data-rollback="${esc(row.id)}" ${row.active ? "disabled" : ""}>Use this dataset</button>
          </td>
        </tr>`).join("")}</tbody></table>
        <h3 style="margin:14px 0 6px;font-size:15px">Audit log</h3>
        <table class="cp-table"><thead><tr><th>When</th><th>Event</th><th>Detail</th></tr></thead><tbody>${
          (data.audit || []).slice(0, 40).map((item) => `<tr><td>${esc(stamp(item.at))}</td><td>${esc(item.event)}</td><td>${esc(item.message)}</td></tr>`).join("")
        }</tbody></table>`;
      } catch (err) {
        box.innerHTML = `<div class="cp-banner bad">${esc(err.message || "History could not be loaded.")}</div>`;
      }
    }

    host.querySelector("#cp-history").addEventListener("click", async (event) => {
      const view = event.target.closest("[data-view]");
      const rollback = event.target.closest("[data-rollback]");
      if (view) {
        try {
          const item = await getJson(`/api/contact-performance/publication/${encodeURIComponent(view.getAttribute("data-view"))}`, { headers: headers() });
          const rec = item.reconciliation || {};
          const body = host.querySelector("#cp-pub-body");
          body.innerHTML = `<h3>${esc(periodLabel(item.period))}</h3>
            <dl>
              <dt>Contact file</dt><dd>${esc(item.contactFile)}</dd>
              <dt>CRM file</dt><dd>${esc(item.crmFile)}</dd>
              <dt>Worksheet</dt><dd>${esc(item.contactSheet || "—")}</dd>
              <dt>Published</dt><dd>${esc(stamp(item.at))} · ${esc(item.by || "Administrator")}</dd>
              <dt>Reconciliation</dt><dd>${esc(rec.equation || "—")}</dd>
              <dt>Contact only</dt><dd>${fmt(rec.contactOnly)}</dd>
              <dt>Missing identifiers</dt><dd>${fmt((rec.contactMissingId || 0) + (rec.crmMissingId || 0))}</dd>
              <dt>Unresolved duplicates</dt><dd>${fmt((rec.contactUnresolved || 0) + (rec.crmUnresolved || 0))}</dd>
              <dt>Unknown status</dt><dd>${fmt(rec.unknownStatus)}</dd>
            </dl>
            ${(item.warnings || []).length ? `<div class="cp-banner wait">${item.warnings.map((line) => `<div>${esc(line)}</div>`).join("")}</div>` : ""}
            <div class="cp-actions" style="margin-top:12px">
              <button type="button" class="cp-btn" data-download="${esc(item.id)}:contact">Download contact file</button>
              <button type="button" class="cp-btn" data-download="${esc(item.id)}:crm">Download CRM file</button>
              <button class="cp-btn" value="cancel">Close</button>
            </div>`;
          host.querySelector("#cp-pub-dialog").showModal();
        } catch (err) {
          showResult(`<div class="cp-banner bad">${esc(err.message)}</div>`);
        }
      }
      if (rollback) {
        const id = rollback.getAttribute("data-rollback");
        if (!global.confirm("Make this published dataset the active one? Current figures stay in history.")) return;
        try {
          await getJson("/api/contact-performance/rollback", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ publicationId: id }),
          });
          await loadHistory();
          showResult(`<div class="cp-banner">The selected dataset is now active.</div>`);
        } catch (err) {
          showResult(`<div class="cp-banner bad">${esc(err.message)}</div>`);
        }
      }
    });

    host.querySelector("#cp-pub-body").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-download]");
      if (!button) return;
      const [id, which] = button.getAttribute("data-download").split(":");
      const response = await fetch(`/api/contact-performance/source/${encodeURIComponent(id)}/${which}`, { headers: { "X-Admin-Password": password() } });
      if (!response.ok) {
        showResult(`<div class="cp-banner bad">The source file could not be downloaded.</div>`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = which === "crm" ? "crm-export" : "contact-tracking";
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  global.ContactPerformance = { mount, mountAdmin };
})(window);
