(function () {
  const ui = { q: "", query: "", found: null, statusId: "", car: "", advisorId: "", sort: "updatedAt", dir: "desc", page: 1, tableQ: "" };
  let me = null;

  function myLeads() {
    const q = ui.tableQ.trim().toLowerCase();
    const rows = TDR.leads().filter((lead) => lead.callAgentId === me.id && (!q || `${lead.leadNumber} ${lead.requestedCar} ${lead.statusName} ${lead.salesAdvisorName}`.toLowerCase().includes(q)));
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
    const body = slice.map((lead) => `<tr>
      <td><b>${TDR.esc(lead.leadNumber)}</b></td>
      <td>${TDR.esc(lead.requestedCar)}</td>
      <td>${TDR.esc(lead.statusName)}</td>
      <td>${TDR.esc(lead.salesAdvisorName || "—")}</td>
      <td>${lead.advisorConfirmed ? "Sent" : "Assigned"}</td>
      <td>${TDR.formatWhen(lead.updatedAt)}</td>
    </tr>`).join("") || `<tr><td colspan="6"><div class="empty"><strong>No leads on your desk yet</strong>Enter a lead number and assign it.</div></td></tr>`;
    document.getElementById("content").innerHTML = `
      <section class="kpi-grid">
        ${[["My leads", rows.length], ["New", stats.fresh], ["Contacted", stats.contacted], ["Assigned", stats.assigned], ["Follow up", stats.followUp], ["Completed", stats.completed]].map(([l, n]) => `<article class="kpi"><span>${l}</span><b>${n}</b></article>`).join("")}
      </section>
      <section class="card assign-box">
        <div class="card-head"><h2>New lead</h2></div>
        <div class="form-grid">
          <div class="field"><span class="lbl">Lead number</span><input id="lead-number" value="${TDR.esc(ui.query)}" placeholder="CRM-2026-000123" /></div>
          <div class="field"><span class="lbl">Product</span><select id="as-car">${cars.map((car) => `<option ${ui.car === car.name ? "selected" : ""}>${TDR.esc(car.name)}</option>`).join("")}</select></div>
          <div class="field"><span class="lbl">Status</span><select id="as-status">${statuses.map((row) => `<option value="${TDR.esc(row.id)}"${ui.statusId === row.id ? " selected" : ""}>${TDR.esc(row.name)}</option>`).join("")}</select></div>
          <div class="field"><span class="lbl">Sales advisor</span><select id="as-advisor"><option value="">Select a connected advisor</option>${advisors.map((advisor) => `<option value="${TDR.esc(advisor.id)}"${ui.advisorId === advisor.id ? " selected" : ""}>${TDR.esc(advisor.name)}</option>`).join("")}</select></div>
        </div>
        ${advisors.length ? "" : `<p class="muted">No sales advisor is connected to you yet. Ask an administrator.</p>`}
        <button type="button" class="btn btn-primary" id="assign-btn">Assign to sales advisor</button>
        <p class="error-text" id="assign-error"></p>
      </section>
      <section class="card">
        <div class="card-head"><h2>My connected advisors</h2></div>
        <div class="stat-pills">${advisors.map((advisor) => `<span class="badge">${TDR.esc(advisor.name)}</span>`).join("") || `<span class="muted">None connected</span>`}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>My lead sheet</h2><button type="button" class="btn btn-ghost" id="export-btn">Export Excel</button></div>
        <div class="field" style="max-width:320px"><span class="lbl">Search my leads</span><input id="table-q" value="${TDR.esc(ui.tableQ)}" placeholder="Lead number or product" /></div>
        <div class="table-wrap"><table class="excel"><thead><tr>
          ${["leadNumber", "requestedCar", "statusName", "salesAdvisorName", "assignment", "updatedAt"].map((key, i) => `<th data-sort="${key}" style="position:relative">${["Lead number", "Product", "Status", "Sales advisor", "Assignment", "Last updated"][i]}<i class="col-resizer"></i></th>`).join("")}
        </tr></thead><tbody>${body}</tbody></table></div>
        <div class="pager"><span>${rows.length} row(s)</span><span><button type="button" class="btn btn-ghost" data-page="-1">Prev</button> ${ui.page} / ${pages} <button type="button" class="btn btn-ghost" data-page="1">Next</button></span></div>
      </section>`;
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
    ui.query = document.getElementById("lead-number").value.trim();
    ui.car = document.getElementById("as-car").value;
    ui.statusId = document.getElementById("as-status").value;
    ui.advisorId = document.getElementById("as-advisor").value;
    if (!ui.query || !ui.car || !ui.statusId || !ui.advisorId) {
      error.textContent = "Enter a lead number, product, status, and sales advisor.";
      return;
    }
    try {
      const lead = TDR.assignNewLead({
        leadNumber: ui.query,
        car: ui.car,
        statusId: ui.statusId,
        salesAdvisorId: ui.advisorId,
        callAgentId: me.id,
      }, me);
      const advisor = TDR.users().find((user) => user.id === ui.advisorId);
      ui.query = "";
      TDR.showToast(`✓ ${lead.leadNumber} successfully assigned to ${advisor ? advisor.name : "the advisor"}`, "ok");
      paint();
    } catch (err) {
      error.textContent = err.message;
    }
  }

  function exportExcel() {
    if (!window.XLSX) { TDR.showToast("Excel export is unavailable.", "err"); return; }
    const data = myLeads().map((lead) => ({
      "Lead Number": lead.leadNumber,
      Product: lead.requestedCar,
      Status: lead.statusName,
      "Sales Advisor": lead.salesAdvisorName,
      Note: lead.note || "",
      "Last Updated": TDR.formatWhen(lead.updatedAt),
    }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(data.length ? data : [{ Note: "No rows" }]), "My Leads");
    XLSX.writeFile(book, "toyota-call-agent-leads.xlsx");
  }

  document.body.addEventListener("click", (event) => {
    const page = event.target.closest("[data-page]");
    if (page) { ui.page += Number(page.dataset.page); paint(); }
    const sort = event.target.closest("[data-sort]");
    if (sort && !event.target.classList.contains("col-resizer")) {
      ui.dir = ui.sort === sort.dataset.sort && ui.dir === "asc" ? "desc" : "asc";
      ui.sort = sort.dataset.sort;
      paint();
    }
  });
  document.body.addEventListener("input", (event) => {
    if (event.target.id === "lead-number") ui.query = event.target.value;
    if (event.target.id === "table-q") { ui.tableQ = event.target.value; ui.page = 1; paint(); }
  });
  document.body.addEventListener("change", (event) => {
    if (event.target.id === "as-car") ui.car = event.target.value;
    if (event.target.id === "as-status") ui.statusId = event.target.value;
    if (event.target.id === "as-advisor") ui.advisorId = event.target.value;
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
    document.getElementById("hello").textContent = `Hi, ${me.name}`;
    document.getElementById("side-user").innerHTML = `<b>${TDR.esc(me.name)}</b><span>Call Agent</span>`;
    TDR.subscribe(() => paint());
    paint();
  });
})();
