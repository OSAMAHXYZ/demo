(function () {
  const ui = {
    view: "dashboard",
    q: "", status: "", agent: "", advisor: "", car: "", finance: "", from: "", to: "",
    sort: "updatedAt", dir: "desc", page: 1,
    userQ: "",
    actUser: "", actRole: "", actAction: "", actDate: "",
    connAgent: "",
    focusId: "",
    focusKind: "",
  };
  let me = null;
  let charts = [];
  const titles = {
    dashboard: ["Dashboard", "Live picture of leads, teams, and demand"],
    leads: ["CRM Leads", "Every guest enquiry in one register"],
    users: ["User Accounts", "Create logins and control who can enter"],
    agents: ["Call Agents", "People who search CRM leads and assign them"],
    advisors: ["Sales Advisors", "Showroom advisors who receive assigned leads"],
    connections: ["Team Connections", "Choose which advisors each call agent can assign to"],
    cars: ["Car Models", "The vehicle list used by every desk"],
    statuses: ["Status Management", "The only status list in the CRM"],
    monitor: ["Assignment Monitor", "Newest assignments first"],
    activity: ["Activity Log", "Sign-ins, assignments, and changes"],
    settings: ["Settings", "Names and defaults for this workspace"],
  };

  const esc = (v) => TDR.esc(v);
  const when = (v) => TDR.formatWhen(v);

  function paintNav() {
    document.querySelectorAll("#side-nav [data-view]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.dataset.view === ui.view);
    });
    const pair = titles[ui.view] || titles.dashboard;
    document.getElementById("page-title").textContent = pair[0];
    document.getElementById("page-sub").textContent = pair[1];
  }

  function options(list, value, labelFn, placeholder) {
    const rows = [`<option value="">${esc(placeholder || "All")}</option>`]
      .concat(list.map((item) => {
        const id = item.id || item;
        const label = labelFn ? labelFn(item) : item;
        return `<option value="${esc(id)}"${id === value ? " selected" : ""}>${esc(label)}</option>`;
      }));
    return rows.join("");
  }

  function badge(text, off) {
    return `<span class="badge${off ? " is-off" : ""}">${esc(text)}</span>`;
  }

  function sortRows(rows) {
    const dir = ui.dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => String(a[ui.sort] ?? "").localeCompare(String(b[ui.sort] ?? ""), undefined, { numeric: true }) * dir);
  }

  function filteredLeads() {
    const q = ui.q.trim().toLowerCase();
    return sortRows(TDR.leads().filter((lead) => {
      if (ui.focusKind === "agent" && ui.focusId && lead.callAgentId !== ui.focusId) return false;
      if (ui.focusKind === "advisor" && ui.focusId && lead.salesAdvisorId !== ui.focusId) return false;
      if (q && !`${lead.leadNumber} ${lead.customerName} ${lead.phone}`.toLowerCase().includes(q)) return false;
      if (ui.kpi === "new" && lead.statusName !== "New") return false;
      if (ui.kpi === "assigned" && !lead.salesAdvisorId) return false;
      if (ui.kpi === "progress" && !["Contacted", "Interested", "Follow Up", "No Answer"].includes(lead.statusName)) return false;
      if (ui.kpi === "confirmed" && lead.statusName !== "Confirmed") return false;
      if (ui.kpi === "other" && lead.vehicleDecision !== "Choose Other Car" && lead.statusName !== "Other Car") return false;
      if (ui.kpi === "completed" && lead.statusName !== "Completed") return false;
      if (ui.kpi === "unassigned" && lead.salesAdvisorId) return false;
      if (ui.status && lead.statusId !== ui.status) return false;
      if (ui.agent && lead.callAgentId !== ui.agent) return false;
      if (ui.advisor && lead.salesAdvisorId !== ui.advisor) return false;
      if (ui.car && lead.selectedCar !== ui.car && lead.requestedCar !== ui.car) return false;
      if (ui.finance && lead.financeType !== ui.finance) return false;
      const day = TDR.formatDay(lead.createdAt);
      if (ui.from && day < ui.from) return false;
      if (ui.to && day > ui.to) return false;
      return true;
    }));
  }

  function kpisHtml(stats) {
    const items = [
      ["Total Leads", stats.total, ""],
      ["New Leads", stats.fresh, "new"],
      ["Assigned Leads", stats.assigned, "assigned"],
      ["In Progress", stats.progress, "progress"],
      ["Confirmed", stats.confirmed, "confirmed"],
      ["Other Car", stats.otherCar, "other"],
      ["Completed", stats.completed, "completed"],
      ["Unassigned", stats.unassigned, "unassigned"],
    ];
    return `<div class="kpi-grid">${items.map(([label, value, key]) =>
      `<button type="button" class="kpi" data-act="kpi" data-kpi="${key}"><span>${label}</span><b>${value}</b></button>`
    ).join("")}</div>`;
  }

  function dashboard() {
    const stats = TDR.kpis();
    const feed = TDR.activity().slice(0, 6).map((row) =>
      `<article><div class="dot"></div><div><b>${esc(row.action)}</b><div class="muted">${esc(row.userName)} · ${esc(row.target)} · ${when(row.at)}</div><div>${esc(row.details)}</div></div></article>`
    ).join("") || `<div class="empty">No activity yet.</div>`;
    return `${kpisHtml(stats)}
      <section class="chart-grid">
        <article class="card"><div class="card-head"><h2>Lead status distribution</h2></div><div class="chart-box"><canvas id="chart-status"></canvas></div></article>
        <article class="card"><div class="card-head"><h2>Daily assignments</h2></div><div class="chart-box"><canvas id="chart-daily"></canvas></div></article>
        <article class="card"><div class="card-head"><h2>Leads by call agent</h2></div><div class="chart-box"><canvas id="chart-agents"></canvas></div></article>
        <article class="card"><div class="card-head"><h2>Leads by sales advisor</h2></div><div class="chart-box"><canvas id="chart-advisors"></canvas></div></article>
      </section>
      <section class="chart-grid">
        <article class="card"><div class="card-head"><h2>Vehicle demand</h2></div><div class="chart-box"><canvas id="chart-cars"></canvas></div></article>
        <article class="card"><div class="card-head"><h2>Recent activity</h2></div><div class="timeline">${feed}</div></article>
      </section>`;
  }

  function countBy(rows, key) {
    const map = new Map();
    rows.forEach((row) => {
      const name = row[key] || "Unassigned";
      map.set(name, (map.get(name) || 0) + 1);
    });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  function drawCharts() {
    if (!window.Chart) return;
    const rows = TDR.leads();
    const palette = ["#eb0a1e", "#1d4f91", "#0f7a45", "#9a6412", "#262321", "#7a1f3d", "#5c6570", "#143d2c", "#c10518", "#6e675f"];
    const status = countBy(rows, "statusName");
    const agents = countBy(rows.filter((r) => r.callAgentName), "callAgentName").slice(0, 8);
    const advisors = countBy(rows.filter((r) => r.salesAdvisorName), "salesAdvisorName").slice(0, 8);
    const cars = countBy(rows, "selectedCar").slice(0, 8);
    const days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return TDR.formatDay(d.toISOString());
    });
    const daily = days.map((day) => rows.filter((lead) => TDR.formatDay(lead.assignedAt) === day).length);
    const make = (id, type, labels, data, extra) => {
      const node = document.getElementById(id);
      if (!node) return;
      charts.push(new Chart(node, {
        type,
        data: { labels, datasets: [{ data, backgroundColor: palette, borderColor: "#eb0a1e", tension: 0.35, borderWidth: type === "line" ? 2 : 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type === "doughnut" } }, scales: type === "doughnut" ? {} : { y: { beginAtZero: true, ticks: { precision: 0 } } }, ...extra },
      }));
    };
    make("chart-status", "doughnut", status.map((r) => r[0]), status.map((r) => r[1]));
    make("chart-daily", "line", days.map((d) => d.slice(5)), daily);
    make("chart-agents", "bar", agents.map((r) => r[0]), agents.map((r) => r[1]));
    make("chart-advisors", "bar", advisors.map((r) => r[0]), advisors.map((r) => r[1]));
    make("chart-cars", "bar", cars.map((r) => r[0]), cars.map((r) => r[1]));
  }

  function leadTable() {
    const rows = filteredLeads();
    const size = 8;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    ui.page = Math.min(ui.page, pages);
    const slice = rows.slice((ui.page - 1) * size, ui.page * size);
    const head = ["leadNumber", "customerName", "phone", "requestedCar", "selectedCar", "callAgentName", "salesAdvisorName", "statusName", "financeType", "createdAt", "assignedAt", "updatedAt"];
    const labels = ["CRM Lead", "Customer", "Phone", "Requested", "Selected", "Call Agent", "Sales Advisor", "Status", "Finance", "Created", "Assigned", "Updated"];
    const body = slice.map((lead) => `<tr>
      <td><b>${esc(lead.leadNumber)}</b></td>
      <td>${esc(lead.customerName)}</td><td>${esc(lead.phone)}</td>
      <td>${esc(lead.requestedCar)}</td><td>${esc(lead.selectedCar)}</td>
      <td>${esc(lead.callAgentName || "—")}</td><td>${esc(lead.salesAdvisorName || "—")}</td>
      <td>${badge(lead.statusName)}</td><td>${esc(lead.financeType || "—")}</td>
      <td>${when(lead.createdAt)}</td><td>${when(lead.assignedAt)}</td><td>${when(lead.updatedAt)}</td>
      <td class="row-actions">
        <button type="button" data-act="view-lead" data-id="${esc(lead.id)}">View</button>
        <button type="button" data-act="edit-lead" data-id="${esc(lead.id)}">Edit</button>
        <button type="button" data-act="reassign-lead" data-id="${esc(lead.id)}">Reassign</button>
        <button type="button" data-act="delete-lead" data-id="${esc(lead.id)}">Delete</button>
      </td></tr>`).join("") || `<tr><td colspan="13"><div class="empty"><strong>No leads match</strong>Adjust the filters or create a lead.</div></td></tr>`;
    return `<section class="card"><div class="card-head"><h2>Register</h2><button type="button" class="btn btn-primary" data-act="edit-lead">+ Create lead</button></div>
      <div class="toolbar">
        <div class="field grow"><span class="lbl">Search</span><input id="lead-q" value="${esc(ui.q)}" placeholder="CRM lead, customer, or phone" /></div>
        <div class="field"><span class="lbl">Status</span><select id="f-status">${options(TDR.statuses(), ui.status, (s) => s.name, "All statuses")}</select></div>
        <div class="field"><span class="lbl">Call agent</span><select id="f-agent">${options(TDR.users("call-agent"), ui.agent, (u) => `${u.name} · ${u.username}`, "All agents")}</select></div>
        <div class="field"><span class="lbl">Sales advisor</span><select id="f-advisor">${options(TDR.users("sales-advisor"), ui.advisor, (u) => `${u.name} · ${u.username}`, "All advisors")}</select></div>
        <div class="field"><span class="lbl">Car</span><select id="f-car">${options(TDR.cars().map((c) => c.name), ui.car, (n) => n, "All cars")}</select></div>
        <div class="field"><span class="lbl">Finance</span><select id="f-finance">${options(["Cash", "Lease"], ui.finance, (n) => n, "All finance")}</select></div>
        <div class="field"><span class="lbl">From</span><input id="f-from" type="date" value="${esc(ui.from)}" /></div>
        <div class="field"><span class="lbl">To</span><input id="f-to" type="date" value="${esc(ui.to)}" /></div>
      </div>
      <div class="table-wrap"><table><thead><tr>${head.map((key, i) => `<th data-sort="${key}">${labels[i]}</th>`).join("")}<th>Actions</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="pager"><span>${rows.length} lead(s)</span><span><button type="button" class="btn btn-ghost" data-act="page" data-dir="-1">Prev</button> ${ui.page} / ${pages} <button type="button" class="btn btn-ghost" data-act="page" data-dir="1">Next</button></span></div>
    </section>`;
  }

  function userRows(role) {
    const q = ui.userQ.trim().toLowerCase();
    return TDR.users(role).filter((user) => !q || `${user.name} ${user.username} ${user.employeeId}`.toLowerCase().includes(q));
  }

  function usersView() {
    const body = userRows().map((user) => `<tr>
      <td><b>${esc(user.name)}</b></td><td>${esc(user.employeeId)}</td><td>${esc(user.roleLabel)}</td>
      <td>${esc(user.username)}</td><td>${esc(user.team || user.branch || "—")}</td>
      <td>${badge(user.status, user.status !== "active")}</td><td>${when(user.lastLogin)}</td>
      <td class="row-actions">
        <button type="button" data-act="edit-user" data-id="${esc(user.id)}">Edit</button>
        <button type="button" data-act="reset-pass" data-id="${esc(user.id)}">Reset password</button>
        ${user.status === "active"
          ? `<button type="button" data-act="disable-user" data-id="${esc(user.id)}">Disable</button>`
          : `<button type="button" data-act="enable-user" data-id="${esc(user.id)}">Enable</button>`}
        <button type="button" data-act="delete-user" data-id="${esc(user.id)}">Delete</button>
        <button type="button" data-act="user-activity" data-id="${esc(user.id)}">View activity</button>
      </td></tr>`).join("") || `<tr><td colspan="8"><div class="empty"><strong>No accounts</strong></div></td></tr>`;
    return `<section class="card"><div class="card-head"><h2>Accounts</h2><button type="button" class="btn btn-primary" data-act="edit-user">+ Create account</button></div>
      <div class="field" style="max-width:320px"><span class="lbl">Search</span><input id="user-q" value="${esc(ui.userQ)}" placeholder="Name, ID, username" /></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Employee ID</th><th>Role</th><th>Username</th><th>Team</th><th>Status</th><th>Last login</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table></div>
      <p class="muted">Passwords are never listed. This prototype hashes them in the browser; a future server must hash them again.</p></section>`;
  }

  function staffTable(role) {
    const leads = TDR.leads();
    const links = TDR.connections().filter((row) => row.status === "active");
    const rows = userRows(role);
    const body = rows.map((user) => {
      const mine = leads.filter((lead) => (role === "call-agent" ? lead.callAgentId : lead.salesAdvisorId) === user.id);
      const confirmed = mine.filter((lead) => lead.statusName === "Confirmed").length;
      const linked = links.filter((row) => (role === "call-agent" ? row.callAgentId : row.salesAdvisorId) === user.id).length;
      return `<tr>
        <td><b>${esc(user.name)}</b></td><td>${esc(user.employeeId)}</td>
        ${role === "sales-advisor" ? `<td>${esc(user.branch || "—")}</td>` : `<td>${esc(user.email || "—")}</td><td>${esc(user.phone || "—")}</td>`}
        <td>${badge(user.status, user.status !== "active")}</td>
        <td>${mine.length}</td>
        ${role === "sales-advisor" ? `<td>${confirmed}</td>` : ""}
        <td>${linked}</td>
        <td class="row-actions">
          <button type="button" data-act="edit-staff" data-role="${role}" data-id="${esc(user.id)}">Edit</button>
          <button type="button" data-act="${user.status === "active" ? "disable-user" : "enable-user"}" data-id="${esc(user.id)}">${user.status === "active" ? "Disable" : "Enable"}</button>
          <button type="button" data-act="delete-user" data-id="${esc(user.id)}">Delete</button>
          <button type="button" data-act="staff-leads" data-role="${role}" data-id="${esc(user.id)}">View leads</button>
          <button type="button" data-act="manage-conn" data-id="${esc(user.id)}" data-role="${role}">Manage connections</button>
        </td></tr>`;
    }).join("") || `<tr><td colspan="8"><div class="empty"><strong>None yet</strong></div></td></tr>`;
    const heads = role === "sales-advisor"
      ? "<th>Advisor</th><th>Employee ID</th><th>Branch</th><th>Status</th><th>Assigned leads</th><th>Confirmed</th><th>Connected call agents</th><th>Actions</th>"
      : "<th>Name</th><th>Employee ID</th><th>Email</th><th>Phone</th><th>Status</th><th>Assigned leads</th><th>Connected advisors</th><th>Actions</th>";
    return `<section class="card"><div class="card-head"><h2>${role === "call-agent" ? "Call agents" : "Sales advisors"}</h2>
      <button type="button" class="btn btn-primary" data-act="edit-staff" data-role="${role}">+ Add</button></div>
      <div class="field" style="max-width:320px"><span class="lbl">Search</span><input id="user-q" value="${esc(ui.userQ)}" placeholder="Name or employee ID" /></div>
      <div class="table-wrap"><table><thead><tr>${heads}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function connectionsView() {
    const agents = TDR.users("call-agent");
    const advisors = TDR.users("sales-advisor");
    if (!ui.connAgent && agents[0]) ui.connAgent = agents[0].id;
    const selected = new Set(TDR.activeLinks(ui.connAgent).map((row) => row.salesAdvisorId));
    const checks = advisors.map((advisor) => `<label><input type="checkbox" data-advisor="${esc(advisor.id)}"${selected.has(advisor.id) ? " checked" : ""}/> ${esc(advisor.name)} <span class="muted">${esc(advisor.username)}</span></label>`).join("");
    const table = TDR.connections().map((row) => `<tr>
      <td>${esc(row.callAgentName)}</td><td>${esc(row.salesAdvisorName)}</td><td>${when(row.connectedAt)}</td><td>${badge(row.status, row.status !== "active")}</td>
      <td class="row-actions">${row.status === "active"
        ? `<button type="button" data-act="disconnect" data-id="${esc(row.id)}">Disconnect</button>`
        : `<button type="button" data-act="reconnect" data-id="${esc(row.id)}">Connect</button>`}</td></tr>`).join("");
    const tree = agents.map((agent) => {
      const kids = TDR.activeLinks(agent.id);
      const mine = TDR.leads().filter((lead) => lead.callAgentId === agent.id);
      return `<article class="team-card"><button type="button" data-act="focus-agent" data-id="${esc(agent.id)}"><div class="team-agent">${esc(agent.name)}</div><div class="muted">Call agent · ${mine.length} leads</div></button>
        <div class="team-branch">${kids.map((row) => `<button type="button" data-act="focus-advisor" data-id="${esc(row.salesAdvisorId)}">${esc(row.salesAdvisorName)}<div class="muted">Sales advisor</div></button>`).join("") || `<span class="muted">No advisors connected</span>`}</div></article>`;
    }).join("");
    const focus = focusCard();
    return `<section class="card"><div class="card-head"><h2>Connect a call agent</h2></div>
      <div class="field" style="max-width:360px"><span class="lbl">Call agent</span><select id="conn-agent">${options(agents, ui.connAgent, (u) => `${u.name} · ${u.username}`, "Select")}</select></div>
      <div class="check-grid" id="conn-checks">${checks || `<div class="empty">Add a sales advisor first.</div>`}</div>
      <div class="form-actions"><button type="button" class="btn btn-primary" data-act="save-conn">Save connections</button></div></section>
      <section class="card"><div class="card-head"><h2>Team structure</h2></div><div class="team-grid">${tree}</div>${focus}</section>
      <section class="card"><div class="card-head"><h2>Connection register</h2></div>
        <div class="table-wrap"><table><thead><tr><th>Call agent</th><th>Sales advisor</th><th>Connected date</th><th>Status</th><th>Actions</th></tr></thead><tbody>${table}</tbody></table></div>
        <p class="muted">Disconnecting keeps every existing lead and its history.</p></section>`;
  }

  function focusCard() {
    if (!ui.focusId) return "";
    const leads = TDR.leads().filter((lead) => ui.focusKind === "agent" ? lead.callAgentId === ui.focusId : lead.salesAdvisorId === ui.focusId);
    const person = TDR.users().find((u) => u.id === ui.focusId);
    if (!person) return "";
    const stats = TDR.kpis(leads);
    const links = ui.focusKind === "agent"
      ? TDR.activeLinks(person.id).map((row) => row.salesAdvisorName)
      : TDR.agentsForAdvisor(person.id).map((row) => row.name);
    return `<div class="card" style="margin-top:12px"><h2 style="margin:0 0 8px">${esc(person.name)}</h2>
      <p class="muted">${ui.focusKind === "agent" ? "Connected advisors" : "Connected call agents"}: ${esc(links.join(", ") || "None")}</p>
      <div class="stat-pills">${badge(`Total ${stats.total}`)}${badge(`Confirmed ${stats.confirmed}`)}${badge(`Other car ${stats.otherCar}`)}${badge(`Completed ${stats.completed}`)}</div></div>`;
  }

  function carsView() {
    const body = TDR.cars().map((car) => `<tr>
      <td><b>${esc(car.name)}</b></td><td>${esc(car.year)}</td><td>${esc(car.category)}</td>
      <td>${Number(car.price).toLocaleString("en-US")} SAR</td><td>${badge(car.status, car.status !== "active")}</td>
      <td class="row-actions">
        <button type="button" data-act="edit-car" data-id="${esc(car.id)}">Edit</button>
        <button type="button" data-act="toggle-car" data-id="${esc(car.id)}">${car.status === "active" ? "Deactivate" : "Activate"}</button>
        <button type="button" data-act="delete-car" data-id="${esc(car.id)}">Delete</button>
      </td></tr>`).join("");
    return `<section class="card"><div class="card-head"><h2>Vehicles</h2><button type="button" class="btn btn-primary" data-act="edit-car">+ Add model</button></div>
      <div class="table-wrap"><table><thead><tr><th>Model</th><th>Year</th><th>Category</th><th>Starting price</th><th>Status</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function statusView() {
    const body = TDR.statuses().map((row) => `<tr>
      <td>${badge(row.name)}</td><td>${row.order}</td><td>${badge(row.active ? "active" : "inactive", !row.active)}</td>
      <td class="row-actions">
        <button type="button" data-act="move-status" data-id="${esc(row.id)}" data-dir="-1">Up</button>
        <button type="button" data-act="move-status" data-id="${esc(row.id)}" data-dir="1">Down</button>
        <button type="button" data-act="edit-status" data-id="${esc(row.id)}">Edit</button>
        <button type="button" data-act="toggle-status" data-id="${esc(row.id)}">${row.active ? "Deactivate" : "Activate"}</button>
        <button type="button" data-act="delete-status" data-id="${esc(row.id)}">Delete</button>
      </td></tr>`).join("");
    return `<section class="card"><div class="card-head"><h2>Statuses</h2><button type="button" class="btn btn-primary" data-act="edit-status">+ Add status</button></div>
      <div class="table-wrap"><table><thead><tr><th>Status</th><th>Order</th><th>State</th><th>Actions</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function monitorView() {
    const rows = TDR.leads().filter((lead) => lead.assignedAt).sort((a, b) => String(b.assignedAt).localeCompare(String(a.assignedAt)));
    const feed = rows.slice(0, 20).map((lead) => `<article><div class="muted">${when(lead.assignedAt)}</div><div><b>${esc(lead.callAgentName || "—")} → ${esc(lead.salesAdvisorName || "—")}</b><div>${esc(lead.leadNumber)} · ${esc(lead.selectedCar)} · ${esc(lead.statusName)}</div></div></article>`).join("") || `<div class="empty"><strong>No assignments yet</strong></div>`;
    return `<div class="feed">${feed}</div>`;
  }

  function activityView() {
    const rows = TDR.activity().filter((row) => {
      if (ui.actUser && row.userId !== ui.actUser) return false;
      if (ui.actRole && row.role !== ui.actRole) return false;
      if (ui.actAction && row.action !== ui.actAction) return false;
      if (ui.actDate && TDR.formatDay(row.at) !== ui.actDate) return false;
      return true;
    });
    const actions = [...new Set(TDR.activity().map((row) => row.action))];
    const body = rows.slice(0, 80).map((row) => `<tr><td>${when(row.at)}</td><td>${esc(row.userName)}</td><td>${esc(row.role)}</td><td>${esc(row.action)}</td><td>${esc(row.target)}</td><td>${esc(row.details)}</td></tr>`).join("")
      || `<tr><td colspan="6"><div class="empty">No matching activity.</div></td></tr>`;
    return `<section class="card"><div class="toolbar">
        <div class="field"><span class="lbl">User</span><select id="act-user">${options(TDR.users(), ui.actUser, (u) => u.name, "All users")}</select></div>
        <div class="field"><span class="lbl">Role</span><select id="act-role">${options(["Admin", "Call Agent", "Sales Advisor"], ui.actRole, (n) => n, "All roles")}</select></div>
        <div class="field"><span class="lbl">Action</span><select id="act-action">${options(actions, ui.actAction, (n) => n, "All actions")}</select></div>
        <div class="field"><span class="lbl">Date</span><input id="act-date" type="date" value="${esc(ui.actDate)}" /></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Date/time</th><th>User</th><th>Role</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
  }

  function settingsView() {
    const settings = TDR.settings();
    return `<section class="card"><form id="settings-form" class="form-grid">
      <div class="field"><span class="lbl">Company name</span><input name="companyName" value="${esc(settings.companyName)}" /></div>
      <div class="field"><span class="lbl">System name</span><input name="systemName" value="${esc(settings.systemName)}" /></div>
      <div class="field"><span class="lbl">Default status</span><select name="defaultStatusId">${options(TDR.statuses(true), settings.defaultStatusId, (s) => s.name, "Select")}</select></div>
      <div class="field"><span class="lbl">Default vehicle</span><select name="defaultCarId">${options(TDR.cars(true), settings.defaultCarId, (c) => c.name, "Select")}</select></div>
      <div class="field"><span class="lbl">Session minutes</span><input name="sessionMinutes" type="number" min="15" value="${esc(settings.sessionMinutes)}" /></div>
      <label class="field" style="text-transform:none;letter-spacing:0"><span class="lbl">Notifications</span><input name="notifications" type="checkbox" style="width:auto" ${settings.notifications ? "checked" : ""}/> Show assignment alerts</label>
      <div class="form-actions full"><button class="btn btn-primary" type="submit">Save settings</button><button type="button" class="btn btn-ghost" data-act="restore-demo">Restore demo data</button></div>
    </form></section>`;
  }

  function paint() {
    charts.splice(0).forEach((chart) => chart.destroy());
    const active = document.activeElement;
    const focusId = active && active.id;
    const caret = active && active.selectionStart;
    const views = { dashboard, leads: leadTable, users: usersView, agents: () => staffTable("call-agent"), advisors: () => staffTable("sales-advisor"), connections: connectionsView, cars: carsView, statuses: statusView, monitor: monitorView, activity: activityView, settings: settingsView };
    document.getElementById("content").innerHTML = (views[ui.view] || dashboard)();
    paintNav();
    if (ui.view === "dashboard") drawCharts();
    if (focusId) {
      const next = document.getElementById(focusId);
      if (next) {
        next.focus();
        if (typeof caret === "number" && next.setSelectionRange) next.setSelectionRange(caret, caret);
      }
    }
  }

  function passFields() {
    return `<div class="field"><span class="lbl">Password</span><div class="pass-row"><input id="pw" type="password" autocomplete="new-password" /><button type="button" class="btn btn-ghost" data-act="toggle-pass">Show</button><button type="button" class="btn btn-ghost" data-act="gen-pass">Generate</button></div><div class="strength" id="pw-bar"><i></i></div><span class="muted" id="pw-label"></span></div>
      <div class="field"><span class="lbl">Confirm password</span><input id="pw2" type="password" autocomplete="new-password" /></div>`;
  }

  function bindPassword() {
    const input = document.getElementById("pw");
    if (!input) return;
    input.addEventListener("input", () => {
      const strength = TDR.passwordStrength(input.value);
      const bar = document.getElementById("pw-bar");
      bar.className = `strength is-${strength.score}`;
      document.getElementById("pw-label").textContent = input.value ? strength.label : "";
    });
  }

  function userForm(user, role) {
    const fixed = role || (user && user.role) || "";
    TDR.openModal({
      title: user ? "Edit account" : "Create account",
      html: `<form id="user-form" class="form-grid">
        <div class="field"><span class="lbl">Full name</span><input name="name" value="${esc(user ? user.name : "")}" required /></div>
        <div class="field"><span class="lbl">Employee ID</span><input name="employeeId" value="${esc(user ? user.employeeId : "")}" required /></div>
        <div class="field"><span class="lbl">Role</span><select name="role" ${fixed && user ? "" : ""}>${["admin", "call-agent", "sales-advisor"].map((key) => `<option value="${key}"${(fixed || (user && user.role) || "call-agent") === key ? " selected" : ""}>${TDR.ROLE_LABEL[key]}</option>`).join("")}</select></div>
        <div class="field"><span class="lbl">Username</span><input name="username" id="username-field" value="${esc(user ? user.username : "")}" required /></div>
        <div class="field"><span class="lbl">Email</span><input name="email" value="${esc(user ? user.email : "")}" /></div>
        <div class="field"><span class="lbl">Phone</span><input name="phone" value="${esc(user ? user.phone : "")}" /></div>
        <div class="field"><span class="lbl">Branch</span><input name="branch" value="${esc(user ? user.branch : "")}" /></div>
        <div class="field"><span class="lbl">Team</span><input name="team" value="${esc(user ? user.team : "")}" /></div>
        <div class="field"><span class="lbl">Status</span><select name="status"><option value="active">Active</option><option value="disabled"${user && user.status === "disabled" ? " selected" : ""}>Disabled</option></select></div>
        <div class="full">${user ? `<p class="muted">Leave the password blank to keep the current one.</p>` : ""}${passFields()}</div>
        <div class="form-actions full"><button class="btn btn-primary" type="submit">${user ? "Save" : "Create account"}</button></div>
      </form>`,
      wide: true,
    });
    bindPassword();
    const name = document.querySelector("[name=name]");
    if (!user && name) {
      name.addEventListener("input", () => {
        const field = document.getElementById("username-field");
        if (!field.dataset.touched) field.value = TDR.suggestUsername(name.value);
      });
      document.getElementById("username-field").addEventListener("input", (event) => { event.target.dataset.touched = "1"; });
    }
    document.getElementById("user-form").onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      data.password = document.getElementById("pw").value;
      data.confirm = document.getElementById("pw2").value;
      try {
        if (!user && !data.password) throw new Error("Password is required.");
        if (user && !data.password) delete data.password;
        if (user) await TDR.updateUser(user.id, data, me);
        else await TDR.createUser(data, me);
        TDR.closeModal();
        TDR.showToast(user ? "Account updated" : "Account created", "ok");
      } catch (err) {
        TDR.showToast(err.message, "err");
      }
    };
  }

  function carForm(car) {
    TDR.openModal({
      title: car ? "Edit vehicle" : "Add vehicle",
      html: `<form id="car-form" class="form-grid">
        <div class="field"><span class="lbl">Model name</span><input name="name" value="${esc(car ? car.name : "")}" required /></div>
        <div class="field"><span class="lbl">Model year</span><input name="year" value="${esc(car ? car.year : "2026")}" /></div>
        <div class="field"><span class="lbl">Category</span><select name="category">${["Sedan", "SUV", "Hatchback", "Pickup", "MPV", "EV"].map((c) => `<option ${car && car.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></div>
        <div class="field"><span class="lbl">Starting price</span><input name="price" value="${esc(car ? car.price : "")}" /></div>
        <div class="field full"><span class="lbl">Image note</span><input name="image" value="${esc(car ? car.image : "")}" placeholder="Optional label. No external logo is downloaded." /></div>
        <div class="form-actions full"><button class="btn btn-primary" type="submit">Save vehicle</button></div>
      </form>`,
    });
    document.getElementById("car-form").onsubmit = (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      try {
        TDR.saveCar({ ...data, id: car && car.id, status: car ? car.status : "active" }, me);
        TDR.closeModal();
        TDR.showToast("Vehicle saved", "ok");
      } catch (err) { TDR.showToast(err.message, "err"); }
    };
  }

  function statusForm(row) {
    TDR.openModal({
      title: row ? "Edit status" : "Add status",
      html: `<form id="st-form" class="form-grid">
        <div class="field"><span class="lbl">Name</span><input name="name" value="${esc(row ? row.name : "")}" required /></div>
        <div class="field"><span class="lbl">Color</span><input name="color" type="color" value="${esc(row ? row.color : "#eb0a1e")}" /></div>
        <div class="form-actions full"><button class="btn btn-primary" type="submit">Save status</button></div>
      </form>`,
    });
    document.getElementById("st-form").onsubmit = (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      try {
        TDR.saveStatus({ ...data, id: row && row.id, active: row ? row.active : true }, me);
        TDR.closeModal();
        TDR.showToast("Status saved", "ok");
      } catch (err) { TDR.showToast(err.message, "err"); }
    };
  }

  function leadForm(lead) {
    const cars = TDR.cars(true);
    const statuses = TDR.statuses(true);
    TDR.openModal({
      title: lead ? "Edit lead" : "Create lead",
      html: `<form id="lead-form" class="form-grid">
        <div class="field"><span class="lbl">Customer</span><input name="customerName" value="${esc(lead ? lead.customerName : "")}" required /></div>
        <div class="field"><span class="lbl">Phone</span><input name="phone" value="${esc(lead ? lead.phone : "")}" required /></div>
        <div class="field"><span class="lbl">Requested car</span><select name="requestedCar">${cars.map((car) => `<option ${lead && lead.requestedCar === car.name ? "selected" : ""}>${esc(car.name)}</option>`).join("")}</select></div>
        <div class="field"><span class="lbl">Status</span><select name="statusId">${statuses.map((row) => `<option value="${esc(row.id)}"${lead && lead.statusId === row.id ? " selected" : ""}>${esc(row.name)}</option>`).join("")}</select></div>
        <div class="form-actions full"><button class="btn btn-primary" type="submit">Save lead</button></div>
      </form>`,
    });
    document.getElementById("lead-form").onsubmit = (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      try {
        if (lead) TDR.updateLead(lead.id, data, me);
        else TDR.createLead(data, me);
        TDR.closeModal();
        TDR.showToast("Lead saved", "ok");
      } catch (err) { TDR.showToast(err.message, "err"); }
    };
  }

  function viewLead(lead) {
    const history = (lead.history || []).map((row) => `<article><b>${esc(row.action)}</b> · ${esc(row.userName)}<div class="muted">${when(row.at)} · ${esc(row.details)}</div></article>`).join("") || `<p class="muted">No history yet.</p>`;
    TDR.openModal({
      title: lead.leadNumber,
      html: `<div class="detail-grid">
        <span>Customer</span><b>${esc(lead.customerName)}</b>
        <span>Phone</span><b>${esc(lead.phone)}</b>
        <span>Requested</span><b>${esc(lead.requestedCar)}</b>
        <span>Selected</span><b>${esc(lead.selectedCar)}</b>
        <span>Decision</span><b>${esc(lead.vehicleDecision || "—")}</b>
        <span>Finance</span><b>${esc(lead.financeType || "—")}</b>
        <span>Call agent</span><b>${esc(lead.callAgentName || "—")}</b>
        <span>Sales advisor</span><b>${esc(lead.salesAdvisorName || "—")}</b>
        <span>Status</span><b>${esc(lead.statusName)}</b>
      </div><h3>History</h3><div class="timeline">${history}</div>`,
      wide: true,
    });
  }

  function reassign(lead) {
    TDR.openModal({
      title: `Reassign ${lead.leadNumber}`,
      html: `<form id="re-form" class="form-grid">
        <div class="field"><span class="lbl">Call agent</span><select name="callAgentId">${options(TDR.users("call-agent"), lead.callAgentId, (u) => `${u.name} · ${u.username}`, "None")}</select></div>
        <div class="field"><span class="lbl">Sales advisor</span><select name="salesAdvisorId">${options(TDR.users("sales-advisor"), lead.salesAdvisorId, (u) => `${u.name} · ${u.username}`, "None")}</select></div>
        <div class="form-actions full"><button class="btn btn-primary" type="submit">Save assignment</button></div>
      </form>`,
    });
    document.getElementById("re-form").onsubmit = (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target).entries());
      try {
        TDR.updateLead(lead.id, data, me);
        TDR.closeModal();
        TDR.showToast("Lead reassigned", "ok");
      } catch (err) { TDR.showToast(err.message, "err"); }
    };
  }

  async function onClick(event) {
    const btn = event.target.closest("[data-act], [data-view], [data-sort]");
    if (!btn) return;
    if (btn.dataset.view) {
      ui.view = btn.dataset.view;
      ui.page = 1;
      if (ui.view === "leads") { ui.focusId = ""; ui.focusKind = ""; ui.kpi = ""; }
      document.getElementById("sidebar").classList.remove("is-open");
      paint();
      return;
    }
    if (btn.dataset.sort) {
      ui.dir = ui.sort === btn.dataset.sort && ui.dir === "asc" ? "desc" : "asc";
      ui.sort = btn.dataset.sort;
      paint();
      return;
    }
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const lead = () => TDR.leads().find((row) => row.id === id);
    const user = () => TDR.users().find((row) => row.id === id);
    try {
      if (act === "kpi") {
        ui.view = "leads";
        ui.status = ""; ui.agent = ""; ui.advisor = ""; ui.focusId = ""; ui.focusKind = "";
        ui.kpi = btn.dataset.kpi || "";
        paint();
      } else if (act === "page") {
        ui.page += Number(btn.dataset.dir);
        paint();
      } else if (act === "edit-user") userForm(id ? user() : null);
      else if (act === "edit-staff") userForm(id ? user() : null, btn.dataset.role);
      else if (act === "reset-pass") {
        userForm(user());
        TDR.showToast("Enter a new password and save.", "ok");
      } else if (act === "disable-user" || act === "enable-user") {
        TDR.setUserStatus(id, act === "disable-user" ? "disabled" : "active", me);
        TDR.showToast(act === "disable-user" ? "Account disabled" : "Account enabled", "ok");
      } else if (act === "delete-user") {
        const person = user();
        if (await TDR.confirmDialog({ title: "Delete account", message: `Delete ${person.name}? Existing leads stay on the register.`, confirmLabel: "Delete", danger: true })) {
          TDR.deleteUser(id, me);
          TDR.showToast("Account deleted", "ok");
        }
      } else if (act === "user-activity") {
        ui.view = "activity"; ui.actUser = id; paint();
      } else if (act === "staff-leads") {
        ui.view = "leads"; ui.focusKind = btn.dataset.role === "call-agent" ? "agent" : "advisor"; ui.focusId = id; paint();
      } else if (act === "manage-conn") {
        ui.view = "connections";
        ui.connAgent = btn.dataset.role === "sales-advisor" ? (TDR.activeLinks(null, id)[0] || {}).callAgentId || ui.connAgent : id;
        paint();
      } else if (act === "edit-car") carForm(id ? TDR.cars().find((c) => c.id === id) : null);
      else if (act === "toggle-car") {
        const car = TDR.cars().find((c) => c.id === id);
        TDR.saveCar({ ...car, status: car.status === "active" ? "inactive" : "active" }, me);
      } else if (act === "delete-car") {
        if (await TDR.confirmDialog({ title: "Delete vehicle", message: "Remove this model from the list?", confirmLabel: "Delete", danger: true })) TDR.deleteCar(id, me);
      } else if (act === "edit-status") statusForm(id ? TDR.statuses().find((s) => s.id === id) : null);
      else if (act === "toggle-status") {
        const row = TDR.statuses().find((s) => s.id === id);
        TDR.saveStatus({ ...row, active: !row.active }, me);
      } else if (act === "move-status") TDR.moveStatus(id, Number(btn.dataset.dir));
      else if (act === "delete-status") {
        if (await TDR.confirmDialog({ title: "Delete status", message: "Delete this status?", danger: true, confirmLabel: "Delete" })) TDR.deleteStatus(id, me);
      } else if (act === "edit-lead") leadForm(id ? lead() : null);
      else if (act === "view-lead") viewLead(lead());
      else if (act === "reassign-lead") reassign(lead());
      else if (act === "delete-lead") {
        if (await TDR.confirmDialog({ title: "Delete lead", message: "Delete this CRM lead?", danger: true, confirmLabel: "Delete" })) TDR.deleteLead(id, me);
      } else if (act === "save-conn") {
        const ids = [...document.querySelectorAll("[data-advisor]:checked")].map((node) => node.dataset.advisor);
        TDR.setConnections(ui.connAgent, ids, me);
        TDR.showToast("Connections saved", "ok");
      } else if (act === "disconnect") TDR.setConnectionStatus(id, "disconnected", me);
      else if (act === "reconnect") TDR.setConnectionStatus(id, "active", me);
      else if (act === "focus-agent" || act === "focus-advisor") {
        ui.focusKind = act === "focus-agent" ? "agent" : "advisor";
        ui.focusId = id;
        paint();
      } else if (act === "toggle-pass") {
        const input = document.getElementById("pw");
        input.type = input.type === "password" ? "text" : "password";
      } else if (act === "gen-pass") {
        const password = TDR.generatePassword();
        document.getElementById("pw").value = password;
        document.getElementById("pw2").value = password;
        document.getElementById("pw").dispatchEvent(new Event("input"));
        TDR.showToast(`Generated password: ${password}`, "ok");
      } else if (act === "restore-demo") {
        if (await TDR.confirmDialog({ title: "Restore demo", message: "Replace the current workspace with demo data?", confirmLabel: "Restore", danger: true })) {
          await TDR.restoreDemo();
          TDR.showToast("Demo data restored", "ok");
        }
      }
    } catch (err) {
      TDR.showToast(err.message || "Something went wrong", "err");
    }
  }

  function onChange(event) {
    const map = { "f-status": "status", "f-agent": "agent", "f-advisor": "advisor", "f-car": "car", "f-finance": "finance", "act-user": "actUser", "act-role": "actRole", "act-action": "actAction", "conn-agent": "connAgent" };
    if (map[event.target.id]) {
      ui[map[event.target.id]] = event.target.value;
      ui.kpi = "";
      ui.page = 1;
      paint();
    }
    if (event.target.id === "f-from" || event.target.id === "f-to" || event.target.id === "act-date") {
      ui[event.target.id === "f-from" ? "from" : event.target.id === "f-to" ? "to" : "actDate"] = event.target.value;
      paint();
    }
  }

  function onInput(event) {
    if (event.target.id === "lead-q") { ui.q = event.target.value; ui.page = 1; paint(); }
    if (event.target.id === "user-q") { ui.userQ = event.target.value; paint(); }
  }

  document.getElementById("content").addEventListener("submit", (event) => {
    if (event.target.id !== "settings-form") return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    data.notifications = event.target.notifications.checked;
    TDR.saveSettings(data, me);
    TDR.showToast("Settings saved", "ok");
  });
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("change", onChange);
  document.body.addEventListener("input", onInput);
  document.getElementById("logout").onclick = () => Auth.logout();
  document.getElementById("menu-btn").onclick = () => document.getElementById("sidebar").classList.toggle("is-open");

  TDR.ready.then(async () => {
    me = await Auth.requireRole("admin");
    if (!me) return;
    document.getElementById("side-user").innerHTML = `<b>${esc(me.name)}</b><span>${esc(me.roleLabel)}</span>`;
    let last = (TDR.activity()[0] || {}).id;
    TDR.subscribe(() => {
      const top = TDR.activity()[0];
      if (top && top.id !== last && top.action === "Lead Assignment" && top.userId !== me.id && TDR.settings().notifications) {
        TDR.showToast(top.details, "ok");
      }
      last = top && top.id;
      if (document.getElementById("modal-root").hidden) paint();
    });
    paint();
  });
})();
