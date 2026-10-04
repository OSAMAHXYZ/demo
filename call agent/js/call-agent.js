(function () {
  const ui = { q: "", query: "", found: null, statusId: "", car: "", advisorId: "", sort: "updatedAt", dir: "desc", page: 1, tableQ: "" };
  let me = null;

  function myLeads() {
    const q = ui.tableQ.trim().toLowerCase();
    const rows = TDR.leads().filter((lead) => lead.callAgentId === me.id && (!q || `${lead.leadNumber} ${lead.customerName} ${lead.phone}`.toLowerCase().includes(q)));
    const dir = ui.dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => String(a[ui.sort] ?? "").localeCompare(String(b[ui.sort] ?? ""), undefined, { numeric: true }) * dir);
  }

  function paint() {
    const active = document.activeElement;
    const focusId = active && active.id;
    const caret = active && active.selectionStart;
    const rows = myLeads();
    const stats = TDR.kpis(rows);
    const size = 8;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    ui.page = Math.min(ui.page, pages);
    const slice = rows.slice((ui.page - 1) * size, ui.page * size);
    const advisors = TDR.advisorsForAgent(me.id);
    const cars = TDR.cars(true);
    const statuses = TDR.statuses(true);
    const found = ui.found;
    const result = found ? `<div class="detail-grid">
        <span>CRM lead</span><b>${TDR.esc(found.leadNumber)}</b>
        <span>Customer</span><b>${TDR.esc(found.customerName)}</b>
        <span>Phone</span><b>${TDR.esc(found.phone)}</b>
        <span>Requested vehicle</span><b>${TDR.esc(found.requestedCar)}</b>
        <span>Current status</span><b>${TDR.esc(found.statusName)}</b>
        <span>Call agent</span><b>${TDR.esc(found.callAgentName || me.name)}</b>
      </div>` : `<div class="empty"><strong>Search a CRM lead number</strong>The guest record will open here.</div>`;
    const body = slice.map((lead) => `<tr>
      <td><b>${TDR.esc(lead.leadNumber)}</b></td>
      <td>${TDR.esc(lead.customerName)}</td>
      <td>${TDR.esc(lead.phone)}</td>
      <td>${TDR.esc(lead.requestedCar)}</td>
      <td><select data-inline="status" data-id="${TDR.esc(lead.id)}">${statuses.map((row) => `<option value="${TDR.esc(row.id)}"${row.id === lead.statusId ? " selected" : ""}>${TDR.esc(row.name)}</option>`).join("")}</select></td>
      <td>${TDR.esc(lead.salesAdvisorName || "—")}</td>
      <td>${lead.salesAdvisorId ? "Assigned" : "Open"}</td>
      <td>${TDR.formatWhen(lead.updatedAt)}</td>
      <td><button type="button" class="btn btn-ghost" data-act="open" data-number="${TDR.esc(lead.leadNumber)}">Open</button></td>
    </tr>`).join("") || `<tr><td colspan="9"><div class="empty"><strong>No leads on your desk yet</strong>Search a CRM number and assign it.</div></td></tr>`;
    document.getElementById("content").innerHTML = `
      <section class="kpi-grid">
        ${[["My leads", rows.length], ["New", stats.fresh], ["Contacted", stats.contacted], ["Assigned", stats.assigned], ["Follow up", stats.followUp], ["Completed", stats.completed]].map(([l, n]) => `<article class="kpi"><span>${l}</span><b>${n}</b></article>`).join("")}
      </section>
      <section class="lead-hero">
        <article class="card">
          <div class="card-head"><h2>CRM lead search</h2></div>
          <form id="search-form" class="search-hero">
            <div class="field"><span class="lbl">Enter CRM lead number</span><input id="crm-q" value="${TDR.esc(ui.query)}" placeholder="CRM-2026-000123" /></div>
            <button class="btn btn-dark" type="submit">Search</button>
          </form>
          <div id="search-result">${result}</div>
        </article>
        <article class="card assign-box">
          <div class="card-head"><h2>Update and assign</h2></div>
          <div class="field"><span class="lbl">Status</span><select id="as-status" ${found ? "" : "disabled"}>${statuses.map((row) => `<option value="${TDR.esc(row.id)}"${found && found.statusId === row.id ? " selected" : ""}>${TDR.esc(row.name)}</option>`).join("")}</select></div>
          <div class="field"><span class="lbl">Vehicle</span><select id="as-car" ${found ? "" : "disabled"}>${cars.map((car) => `<option ${found && found.requestedCar === car.name ? "selected" : ""}>${TDR.esc(car.name)}</option>`).join("")}</select></div>
          <div class="field"><span class="lbl">Sales advisor</span><select id="as-advisor" ${found ? "" : "disabled"}><option value="">Select a connected advisor</option>${advisors.map((advisor) => `<option value="${TDR.esc(advisor.id)}">${TDR.esc(advisor.name)}</option>`).join("")}</select></div>
          ${advisors.length ? "" : `<p class="muted">No sales advisor is connected to you yet. Ask an administrator.</p>`}
          <button type="button" class="btn btn-primary" id="assign-btn" ${found ? "" : "disabled"}>Assign to sales advisor</button>
          <p class="error-text" id="assign-error"></p>
        </article>
      </section>
      <section class="card">
        <div class="card-head"><h2>My connected advisors</h2></div>
        <div class="stat-pills">${advisors.map((advisor) => `<span class="badge">${TDR.esc(advisor.name)}</span>`).join("") || `<span class="muted">None connected</span>`}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>My lead sheet</h2><button type="button" class="btn btn-ghost" id="export-btn">Export Excel</button></div>
        <div class="field" style="max-width:320px"><span class="lbl">Search my leads</span><input id="table-q" value="${TDR.esc(ui.tableQ)}" placeholder="Name, phone, CRM" /></div>
        <div class="table-wrap"><table class="excel"><thead><tr>
          ${["leadNumber", "customerName", "phone", "requestedCar", "statusName", "salesAdvisorName", "assignment", "updatedAt"].map((key, i) => `<th data-sort="${key}" style="position:relative">${["CRM lead", "Customer", "Phone", "Requested car", "Status", "Sales advisor", "Assignment", "Last updated"][i]}<i class="col-resizer"></i></th>`).join("")}
          <th>Actions</th></tr></thead><tbody>${body}</tbody></table></div>
        <div class="pager"><span>${rows.length} row(s)</span><span><button type="button" class="btn btn-ghost" data-page="-1">Prev</button> ${ui.page} / ${pages} <button type="button" class="btn btn-ghost" data-page="1">Next</button></span></div>
      </section>`;
    document.getElementById("search-form").onsubmit = (event) => {
      event.preventDefault();
      ui.query = document.getElementById("crm-q").value.trim();
      ui.found = TDR.leads().find((lead) => lead.leadNumber.toLowerCase() === ui.query.toLowerCase()) || null;
      if (!ui.found) TDR.showToast("No CRM lead matches that number.", "err");
      paint();
    };
    document.getElementById("assign-btn").onclick = assign;
    document.getElementById("export-btn").onclick = exportExcel;
    if (focusId) {
      const next = document.getElementById(focusId);
      if (next) {
        next.focus();
        if (typeof caret === "number" && next.setSelectionRange) next.setSelectionRange(caret, caret);
      }
    }
  }

  async function assign() {
    const error = document.getElementById("assign-error");
    error.textContent = "";
    if (!ui.found) { error.textContent = "Search a CRM lead first."; return; }
    const advisorId = document.getElementById("as-advisor").value;
    const car = document.getElementById("as-car").value;
    const statusId = document.getElementById("as-status").value;
    if (!advisorId || !car || !statusId) { error.textContent = "Choose a vehicle, status, and connected advisor."; return; }
    if (ui.found.callAgentId && ui.found.callAgentId !== me.id) {
      const ok = await TDR.confirmDialog({ title: "Move this lead?", message: `This lead is currently with ${ui.found.callAgentName}. Assigning it will move it to you.`, confirmLabel: "Assign" });
      if (!ok) return;
    }
    try {
      const lead = TDR.assignLead(ui.found.id, { callAgentId: me.id, salesAdvisorId: advisorId, car, statusId }, me);
      ui.found = lead;
      const advisor = TDR.users().find((user) => user.id === advisorId);
      TDR.showToast(`✓ ${lead.leadNumber} successfully assigned to ${advisor ? advisor.name : "the advisor"}`, "ok");
      paint();
    } catch (err) {
      error.textContent = err.message;
    }
  }

  function exportExcel() {
    if (!window.XLSX) { TDR.showToast("Excel export is unavailable.", "err"); return; }
    const data = myLeads().map((lead) => ({
      "CRM Lead Number": lead.leadNumber,
      Customer: lead.customerName,
      Phone: lead.phone,
      "Requested Car": lead.requestedCar,
      Status: lead.statusName,
      "Sales Advisor": lead.salesAdvisorName,
      "Last Updated": TDR.formatWhen(lead.updatedAt),
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.length ? data : [{ Note: "No rows" }]), "My Leads");
    XLSX.writeFile(book, "toyota-call-agent-leads.xlsx");
  }

  document.body.addEventListener("click", (event) => {
    const open = event.target.closest("[data-act=open]");
    if (open) {
      ui.query = open.dataset.number;
      ui.found = TDR.leads().find((lead) => lead.leadNumber === ui.query) || null;
      paint();
    }
    const page = event.target.closest("[data-page]");
    if (page) { ui.page += Number(page.dataset.page); paint(); }
    const sort = event.target.closest("[data-sort]");
    if (sort && !event.target.classList.contains("col-resizer")) {
      ui.dir = ui.sort === sort.dataset.sort && ui.dir === "asc" ? "desc" : "asc";
      ui.sort = sort.dataset.sort;
      paint();
    }
  });
  document.body.addEventListener("change", (event) => {
    if (event.target.dataset.inline === "status") {
      try {
        TDR.updateLead(event.target.dataset.id, { statusId: event.target.value }, me);
        TDR.showToast("Status updated", "ok");
      } catch (err) { TDR.showToast(err.message, "err"); }
    }
  });
  document.body.addEventListener("input", (event) => {
    if (event.target.id === "table-q") { ui.tableQ = event.target.value; ui.page = 1; paint(); }
  });

  let drag = null;
  document.addEventListener("mousedown", (event) => {
    if (!event.target.classList.contains("col-resizer")) return;
    drag = { th: event.target.parentElement, x: event.clientX, w: event.target.parentElement.offsetWidth };
  });
  document.addEventListener("mousemove", (event) => {
    if (!drag) return;
    drag.th.style.width = `${Math.max(90, drag.w + event.clientX - drag.x)}px`;
  });
  document.addEventListener("mouseup", () => { drag = null; });

  document.getElementById("logout").onclick = () => Auth.logout();
  document.getElementById("menu-btn").onclick = () => document.getElementById("sidebar").classList.toggle("is-open");

  TDR.ready.then(async () => {
    me = await Auth.requireRole("call-agent");
    if (!me) return;
    document.getElementById("side-user").innerHTML = `<b>${TDR.esc(me.name)}</b><span>Call Agent</span>`;
    TDR.subscribe(() => { if (ui.found) ui.found = TDR.leads().find((lead) => lead.id === ui.found.id) || ui.found; paint(); });
    paint();
  });
})();
