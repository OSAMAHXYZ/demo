(function () {
  let me = null;
  const ui = { q: "", openId: "" };

  function mine() {
    const q = ui.q.trim().toLowerCase();
    return TDR.leads().filter((lead) => lead.salesAdvisorId === me.id && (!q || `${lead.leadNumber} ${lead.requestedCar} ${lead.statusName} ${lead.note || ""}`.toLowerCase().includes(q)));
  }

  function paint() {
    const active = document.activeElement;
    const focusId = active && active.id;
    const caret = active && active.selectionStart;
    const rows = mine();
    const stats = TDR.kpis(rows);
    const agents = TDR.agentsForAdvisor(me.id);
    document.getElementById("hello").textContent = `Hi, ${me.name}`;
    document.getElementById("content").innerHTML = `
      <section class="kpi-grid">
        ${[["Assigned", stats.assigned], ["Contacted", stats.contacted], ["Confirmed", stats.confirmed], ["Other car", stats.otherCar], ["Follow up", stats.followUp], ["Completed", stats.completed]].map(([l, n]) => `<article class="kpi"><span>${l}</span><b>${n}</b></article>`).join("")}
      </section>
      <section class="card">
        <div class="card-head"><h2>My assigned leads</h2></div>
        <div class="field" style="max-width:320px"><span class="lbl">Search</span><input id="adv-q" value="${TDR.esc(ui.q)}" placeholder="Lead number or product" /></div>
        <div class="table-wrap"><table><thead><tr><th>Lead number</th><th>Product</th><th>Status</th><th>Call agent</th><th>Note</th><th>Assigned</th><th></th></tr></thead>
          <tbody>${rows.map((lead) => `<tr>
            <td><b>${TDR.esc(lead.leadNumber)}</b></td>
            <td>${TDR.esc(lead.requestedCar)}</td>
            <td>${TDR.esc(lead.statusName)}</td>
            <td>${TDR.esc(lead.callAgentName || "—")}</td>
            <td>${TDR.esc(lead.note || "—")}</td>
            <td>${TDR.formatWhen(lead.assignedAt)}</td>
            <td><button type="button" class="btn btn-primary" data-open="${TDR.esc(lead.id)}">Open</button></td>
          </tr>`).join("") || `<tr><td colspan="7"><div class="empty"><strong>No leads assigned yet</strong>When a connected call agent assigns a lead, it appears here.</div></td></tr>`}</tbody></table></div>
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
    const statuses = TDR.statuses(true);
    TDR.openModal({
      title: lead.leadNumber,
      html: `<div class="detail-grid">
          <span>Lead number</span><b>${TDR.esc(lead.leadNumber)}</b>
          <span>Product</span><b>${TDR.esc(lead.requestedCar)}</b>
          <span>Call agent</span><b>${TDR.esc(lead.callAgentName || "—")}</b>
          <span>Assigned</span><b>${TDR.formatWhen(lead.assignedAt)}</b>
          <span>Current status</span><b>${TDR.esc(lead.statusName)}</b>
        </div>
        <form id="adv-form" class="form-grid">
          <label class="field full" style="text-transform:none;letter-spacing:0;font-size:1rem;font-weight:700"><input id="confirm-product" name="confirmed" type="checkbox" style="width:auto" ${lead.advisorConfirmed ? "checked" : ""}/> Confirm this product</label>
          <div class="field"><span class="lbl">Status</span><select name="statusId">${statuses.map((row) => `<option value="${TDR.esc(row.id)}" ${row.id === lead.statusId ? "selected" : ""}>${TDR.esc(row.name)}</option>`).join("")}</select></div>
          <div class="field full"><span class="lbl">Note</span><textarea name="note" placeholder="Add a note">${TDR.esc(lead.note || "")}</textarea></div>
          <p class="error-text full" id="send-error"></p>
          <div class="form-actions full"><button class="btn btn-primary" type="submit">Send</button></div>
        </form>`,
    });
    const form = document.getElementById("adv-form");
    form.onsubmit = (event) => {
      event.preventDefault();
      const error = document.getElementById("send-error");
      error.textContent = "";
      if (!document.getElementById("confirm-product").checked) {
        error.textContent = "Confirm the product before sending.";
        return;
      }
      const data = Object.fromEntries(new FormData(form).entries());
      data.confirmed = true;
      try {
        TDR.advisorUpdate(lead.id, data, me);
        TDR.closeModal();
        TDR.showToast("✓ Lead sent", "ok");
      } catch (err) { error.textContent = err.message; }
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
