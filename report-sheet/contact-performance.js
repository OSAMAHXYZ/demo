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
      <div class="cp-banner wait" id="cp-warnings" hidden></div>
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
      <section class="cp-card cp-advisors">
        <div class="cp-section-head">
          <h3>Advisor Contact Achievement</h3>
          <span class="cp-count" id="cp-advisor-count">No leads</span>
        </div>
        <div class="cp-chart-box" id="cp-advisor-box"><div class="cp-empty">Waiting for the latest Admin Push.</div></div>
      </section>
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

    function missingMessage() {
      const diagnostic = state.diagnostic || (state.summary && state.summary.diagnostic) || null;
      return (diagnostic && diagnostic.message)
        || "No contact file and CRM export are stored. On Admin, drop both files under CRM & Contact, then click Push to live.";
    }

    function showStale(message) {
      const stale = host.querySelector("#cp-stale");
      if (!stale) return;
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
      const refresh = host.querySelector("#cp-refresh");
      if (refresh) refresh.disabled = true;
      const previous = state.summary && !state.summary.empty ? state.summary : null;
      try {
        const meta = await loadMeta();
        const summary = await getJson(`/api/contact-performance/summary?${query()}`);
        const recon = summary.reconciliation || {};
        console.info("[contact-performance]", {
          published: Boolean(meta.activeId),
          publications: meta.diagnostic ? meta.diagnostic.publications : 0,
          contactFile: meta.diagnostic ? Boolean(meta.diagnostic.contactFile) : Boolean(meta.contactFile),
          crmFile: meta.diagnostic ? Boolean(meta.diagnostic.crmFile) : Boolean(meta.crmFile),
          summaryEmpty: Boolean(summary.empty),
          contactRows: recon.contactRows || 0,
          crmRows: recon.crmRows || 0,
          totalCrm: summary.kpis ? summary.kpis.totalCrm : 0,
          advisors: Array.isArray(summary.advisors) ? summary.advisors.length : 0,
        });
        if (summary.empty && previous) {
          showStale("Refresh did not return the published dataset. The numbers on screen are unchanged.");
          return;
        }
        state.summary = summary;
        if (summary.diagnostic) state.diagnostic = summary.diagnostic;
        if (summary.publicationId) state.publication = summary.publicationId;
        render();
        if (!summary.empty) await loadLeads();
        const stale = host.querySelector("#cp-stale");
        if (stale) stale.hidden = true;
      } catch (err) {
        if (previous) {
          showStale(err.message || "Refresh failed. The published numbers on screen are unchanged.");
        } else {
          host.querySelector("#cp-sub").textContent = err.message || "The dashboard could not be loaded.";
          showStale(err.message || "The dashboard could not be loaded.");
        }
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
        const lastError = state.lastError || (state.diagnostic && state.diagnostic.lastError);
        sub.textContent = lastError ? `Last import failed ${stamp(lastError.at)}: ${lastError.message}` : missingMessage();
        fresh.className = "cp-pill";
        fresh.innerHTML = "<i></i><span>Not published</span>";
      } else {
        const historical = summary.publicationId && state.activeId && summary.publicationId !== state.activeId;
        const counts = summary.counts || {};
        const countText = counts.crmUnique != null
          ? ` · ${fmt(counts.crmUnique)} CRM leads · ${fmt(counts.contactUnique)} contact records · ${fmt(counts.matched)} matched`
          : "";
        sub.textContent = `${periodLabel(summary.period)} · ${summary.contactFile || "Contact file"} + ${summary.crmFile || "CRM file"} · Last push ${stamp(summary.publishedAt)}${countText}`;
        fresh.className = historical ? "cp-pill is-historical" : "cp-pill";
        fresh.innerHTML = `<i></i><span>${historical ? "Historical snapshot" : "Published"} · ${esc(stamp(summary.publishedAt))}</span>`;
      }
      const warnBox = host.querySelector("#cp-warnings");
      if (warnBox) {
        const warnings = summary.warnings || [];
        warnBox.hidden = !warnings.length;
        warnBox.textContent = warnings.length ? `Import warnings: ${warnings.join(" ")}` : "";
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
      if (summary.empty) {
        host.querySelector("#cp-lead-wrap").innerHTML = `<div class="cp-empty">${esc(missingMessage())}</div>`;
      }
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
      if (!state.summary || state.summary.empty) {
        host.querySelector("#cp-kpis").innerHTML = `<div class="cp-empty">${esc(missingMessage())}</div>`;
        return;
      }
      const kpis = state.summary.kpis || {};
      const cards = [
        ["", "Total CRM Leads", fmt(kpis.totalCrm), "Unique transactions", ""],
        ["matched", "Matched Leads", fmt(kpis.matched), "Same lead identifier in both files", "info"],
        ["contacted", "Contacted Leads", fmt(kpis.exportContacted), `${pct(kpis.contactedOfCrm)} of CRM total`, "ok"],
        ["not_contacted", "Not Contacted Leads", fmt(kpis.exportNotContacted), `${pct(kpis.notContactedOfCrm)} of CRM total`, "bad"],
        ["in_progress", "In Progress Leads", fmt(kpis.inProgress), "Matched, in progress", "wait"],
        ["contacted", "Contact Rate", pct(kpis.contactRate), "Contacted ÷ matched", ""],
      ];
      const unknownItem = (state.summary.distribution || []).find((item) => item.key === "unknown");
      if (unknownItem) cards.push(["unknown", "Unknown / Missing Status", fmt(unknownItem.count), `${Number(unknownItem.pct || 0).toFixed(1)}% · status not recognised`, "unknown"]);
      host.querySelector("#cp-kpis").innerHTML = cards.map((card, index) => {
        const on = (index < 5 || card[0] === "unknown") && state.filters.contact === card[0] && card[0] !== "";
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
      if (summary.empty) {
        legend.innerHTML = `<li class="cp-empty">${esc(missingMessage())}</li>`;
        renderAdvisors();
        return;
      }
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
      renderAdvisors();
    }

    function renderAdvisors() {
      const rows = ((state.summary && state.summary.advisors) || []).slice();
      const count = host.querySelector("#cp-advisor-count");
      const leadTotal = rows.reduce((sum, row) => sum + (Number(row.total) || 0), 0);
      if (count) count.textContent = rows.length ? `${fmt(rows.length)} advisors · ${fmt(leadTotal)} valid leads` : "No leads";
      const box = host.querySelector("#cp-advisor-box");
      if (!box) return;
      box.style.height = "";
      if (!rows.length) {
        box.innerHTML = `<div class="cp-empty">${state.summary && !state.summary.empty ? "No advisor leads for the current filters." : esc(missingMessage())}</div>`;
        return;
      }
      const achLabel = (row) => (row.ach == null || !Number.isFinite(Number(row.ach)) ? "N/A" : `${Number(row.ach).toFixed(1)}%`);
      const share = (value) => (value == null || !Number.isFinite(Number(value)) ? "N/A" : `${Number(value).toFixed(1)}%`);
      box.innerHTML = `<ul class="cp-ach-legend">
        <li><i style="background:${COLORS.contacted}"></i>Contacted</li>
        <li><i style="background:${COLORS.not_contacted}"></i>Not Contacted</li>
        <li><i style="background:${COLORS.in_progress}"></i>In Progress</li>
        <li><i style="background:${COLORS.unknown}"></i>Unknown</li>
      </ul>
      <ul class="cp-ach-list">${rows.map((row) => {
        const part = (count, color) => (count > 0 && row.total > 0 ? `<i style="width:${(count / row.total) * 100}%;background:${color}"></i>` : "");
        return `<li>
          <span class="cp-ach-name" title="${esc(row.name)}">${esc(row.name)}</span>
          <span class="cp-ach-bar" title="Contacted ${fmt(row.contacted)} · Not Contacted ${fmt(row.notContacted)} (${share(row.notContactedPct)}) · In Progress ${fmt(row.inProgress)} (${share(row.inProgressPct)}) · Unknown ${fmt(row.unknown)}">${part(row.contacted, COLORS.contacted)}${part(row.notContacted, COLORS.not_contacted)}${part(row.inProgress, COLORS.in_progress)}${part(row.unknown, COLORS.unknown)}</span>
          <span class="cp-ach-total">${fmt(row.total)}</span>
          <b class="cp-ach-pct">${achLabel(row)}</b>
        </li>`;
      }).join("")}</ul>`;
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
      </tr>`).join("") : `<tr><td colspan="10"><div class="cp-empty">${state.summary && state.summary.empty ? esc(missingMessage()) : (all.length ? "No employees match that search." : "No employees for the current filters.")}</div></td></tr>`;
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
        <td>${badge(row.bucket, row.contactStatus)}${row.contactStatusRaw && row.contactStatusRaw !== row.contactStatus ? `<span class="cp-raw" title="Value in the file: ${esc(row.contactStatusRaw)}">File: ${esc(row.contactStatusRaw)}</span>` : ""}</td>
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
    host.innerHTML = `<section class="grid-5">
      <label class="slot" id="cp-slot-contact">
        <input id="cp-file-contact" type="file" accept=".xlsx,.xls,.csv,.txt" />
        <div class="n">C</div>
        <h3>Contact file</h3>
        <p class="ar">Lead Number worksheet</p>
        <span class="meta" id="cp-meta-contact">Drop or click · .xlsx / .xls / .csv</span>
      </label>
      <label class="slot" id="cp-slot-crm">
        <input id="cp-file-crm" type="file" accept=".xlsx,.xls,.csv,.txt" />
        <div class="n">R</div>
        <h3>CRM export</h3>
        <p class="ar">CRM export file</p>
        <span class="meta" id="cp-meta-crm">Drop or click · .xlsx / .xls / .csv</span>
      </label>
    </section>
    <p class="hint" id="cp-result"></p>`;

    const files = { contact: null, crm: null };

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
      if (event.target.id === "cp-file-contact" && event.target.files[0]) setChosen("contact", event.target.files[0]);
      if (event.target.id === "cp-file-crm" && event.target.files[0]) setChosen("crm", event.target.files[0]);
    });
    async function publishDraft() {
      const note = host.querySelector("#cp-result");
      if (!files.contact && !files.crm) return null;
      if (!files.contact || !files.crm) {
        const message = "Add both the contact file and the CRM export, then Push to live.";
        note.textContent = message;
        return { ok: false, message };
      }
      const now = new Date();
      const period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      const contactFile = await readFile(files.contact);
      const crmFile = await readFile(files.crm);
      const preview = await getJson("/api/contact-performance/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, publishedBy: "Administrator", contactFile, crmFile }),
      });
      if (preview.duplicate) {
        host.querySelectorAll(".slot-draft").forEach((el) => el.remove());
        note.textContent = "";
        return { ok: true, message: "Same contact file and CRM export are already live for " + periodLabel(period) + " — no duplicate snapshot created." };
      }
      await getJson("/api/contact-performance/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: preview.draftId }),
      });
      host.querySelectorAll(".slot-draft").forEach((el) => el.remove());
      note.textContent = "";
      return { ok: true, message: "Contact file and CRM export are live for " + periodLabel(period) + "." };
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