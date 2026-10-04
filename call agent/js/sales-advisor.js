(function () {
  let me = null;
  const ui = { q: "", openId: "" };

  function mine() {
    const q = ui.q.trim().toLowerCase();
    return TDR.leads().filter((lead) => lead.salesAdvisorId === me.id && (!q || `${lead.leadNumber} ${lead.customerName} ${lead.phone}`.toLowerCase().includes(q)));
  }

  function paint() {
    const active = document.activeElement;
    const focusId = active && active.id;
    const caret = active && active.selectionStart;
    const rows = mine();
    const stats = TDR.kpis(rows);
    const agents = TDR.agentsForAdvisor(me.id);
    document.getElementById("hello").textContent = `Welcome, ${me.name}`;
    document.getElementById("content").innerHTML = `
      <section class="kpi-grid">
        ${[["Assigned", stats.assigned], ["Contacted", stats.contacted], ["Confirmed", stats.confirmed], ["Other car", stats.otherCar], ["Follow up", stats.followUp], ["Completed", stats.completed]].map(([l, n]) => `<article class="kpi"><span>${l}</span><b>${n}</b></article>`).join("")}
      </section>
      <section class="card">
        <div class="card-head"><h2>My assigned leads</h2></div>
        <div class="field" style="max-width:320px"><span class="lbl">Search</span><input id="adv-q" value="${TDR.esc(ui.q)}" placeholder="CRM, customer, phone" /></div>
        <div class="table-wrap"><table><thead><tr><th>CRM lead</th><th>Customer</th><th>Phone</th><th>Requested car</th><th>Current status</th><th>Finance</th><th>Assigned</th><th>Updated</th><th></th></tr></thead>
          <tbody>${rows.map((lead) => `<tr>
            <td><b>${TDR.esc(lead.leadNumber)}</b></td>
            <td>${TDR.esc(lead.customerName)}</td><td>${TDR.esc(lead.phone)}</td>
            <td>${TDR.esc(lead.requestedCar)}</td><td>${TDR.esc(lead.statusName)}</td>
            <td>${TDR.esc(lead.financeType || "—")}</td>
            <td>${TDR.formatWhen(lead.assignedAt)}</td><td>${TDR.formatWhen(lead.updatedAt)}</td>
            <td><button type="button" class="btn btn-primary" data-open="${TDR.esc(lead.id)}">Open</button></td>
          </tr>`).join("") || `<tr><td colspan="9"><div class="empty"><strong>No leads assigned yet</strong>When a connected call agent assigns a lead, it appears here.</div></td></tr>`}</tbody></table></div>
      </section>
      <section class="card"><div class="card-head"><h2>My call agents</h2><p>Read only. An administrator manages connections.</p></div>
        <div class="team-grid">${agents.map((agent) => `<article class="team-card"><b>${TDR.esc(agent.name)}</b><div class="muted">${agent.leadCount} lead(s) with you</div></article>`).join("") || `<div class="empty">No call agents are connected to you.</div>`}</div>
      </section>`;
    if (focusId) {
      const next = document.getElementById(focusId);
      if (next) {
        next.focus();
        if (typeof caret === "number" && next.setSelectionRange) next.setSelectionRange(caret, caret);
      }
    }
  }

  function openLead(id) {
    const lead = TDR.leads().find((row) => row.id === id && row.salesAdvisorId === me.id);
    if (!lead) return;
    const cars = TDR.cars(true).filter((car) => car.name !== lead.requestedCar);
    const statuses = TDR.statuses(true);
    const decision = lead.vehicleDecision || "Confirmed Requested Car";
    TDR.openModal({
      title: lead.leadNumber,
      wide: true,
      html: `<div class="detail-grid">
          <span>Customer</span><b>${TDR.esc(lead.customerName)}</b>
          <span>Phone</span><b>${TDR.esc(lead.phone)}</b>
          <span>Requested vehicle</span><b>${TDR.esc(lead.requestedCar)}</b>
          <span>Call agent</span><b>${TDR.esc(lead.callAgentName || "—")}</b>
          <span>Assigned</span><b>${TDR.formatWhen(lead.assignedAt)}</b>
          <span>Current status</span><b>${TDR.esc(lead.statusName)}</b>
        </div>
        <form id="adv-form" class="form-grid">
          <div class="field full"><span class="lbl">Vehicle decision</span>
            <div class="seg">
              <label><input type="radio" name="vehicleDecision" value="Confirmed Requested Car" ${decision !== "Choose Other Car" ? "checked" : ""}/> Confirmed requested car</label>
              <label><input type="radio" name="vehicleDecision" value="Choose Other Car" ${decision === "Choose Other Car" ? "checked" : ""}/> Choose other car</label>
            </div>
          </div>
          <div class="field full" id="other-car" ${decision === "Choose Other Car" ? "" : "hidden"}><span class="lbl">Select other Toyota vehicle</span>
            <select name="selectedCar">${cars.map((car) => `<option ${lead.selectedCar === car.name ? "selected" : ""}>${TDR.esc(car.name)}</option>`).join("")}</select>
          </div>
          <div class="field full"><span class="lbl">Finance type</span>
            <div class="seg">
              <label><input type="radio" name="financeType" value="Cash" ${lead.financeType !== "Lease" ? "checked" : ""}/> Cash</label>
              <label><input type="radio" name="financeType" value="Lease" ${lead.financeType === "Lease" ? "checked" : ""}/> Lease</label>
            </div>
          </div>
          <div class="field"><span class="lbl">Status</span><select name="statusId">${statuses.map((row) => `<option value="${TDR.esc(row.id)}" ${row.id === lead.statusId ? "selected" : ""}>${TDR.esc(row.name)}</option>`).join("")}</select></div>
          <div class="form-actions full"><button class="btn btn-primary" type="submit">Save update</button></div>
        </form>`,
    });
    const form = document.getElementById("adv-form");
    form.querySelectorAll("[name=vehicleDecision]").forEach((input) => {
      input.onchange = () => {
        document.getElementById("other-car").hidden = input.value !== "Choose Other Car" || !input.checked && form.vehicleDecision.value !== "Choose Other Car";
        document.getElementById("other-car").hidden = form.vehicleDecision.value !== "Choose Other Car";
      };
    });
    form.onsubmit = (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        TDR.advisorUpdate(lead.id, data, me);
        TDR.closeModal();
        TDR.showToast("✓ Lead successfully updated", "ok");
      } catch (err) { TDR.showToast(err.message, "err"); }
    };
  }

  document.body.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-open]");
    if (btn) openLead(btn.dataset.open);
  });
  document.body.addEventListener("input", (event) => {
    if (event.target.id === "adv-q") { ui.q = event.target.value; paint(); }
  });
  document.getElementById("logout").onclick = () => Auth.logout();
  document.getElementById("menu-btn").onclick = () => document.getElementById("sidebar").classList.toggle("is-open");

  TDR.ready.then(async () => {
    me = await Auth.requireRole("sales-advisor");
    if (!me) return;
    document.getElementById("side-user").innerHTML = `<b>${TDR.esc(me.name)}</b><span>Sales Advisor</span>`;
    const key = `tdr_seen_${me.id}`;
    const seen = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
    const fresh = mine().filter((lead) => !seen.has(lead.id));
    if (fresh[0] && TDR.settings().notifications) {
      TDR.showToast(`🔔 New lead assigned to you\n${fresh[0].leadNumber}\nToyota ${fresh[0].requestedCar}`, "ok");
    }
    localStorage.setItem(key, JSON.stringify(mine().map((lead) => lead.id)));
    TDR.subscribe(() => {
      const now = mine();
      const known = new Set(JSON.parse(localStorage.getItem(key) || "[]"));
      const added = now.filter((lead) => !known.has(lead.id));
      if (added[0]) TDR.showToast(`🔔 New lead assigned to you\n${added[0].leadNumber}\nToyota ${added[0].requestedCar}`, "ok");
      localStorage.setItem(key, JSON.stringify(now.map((lead) => lead.id)));
      if (document.getElementById("modal-root").hidden) paint();
    });
    paint();
  });
})();
