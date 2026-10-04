/**
 * Toyota Digital Retail · Call Agent CRM
 * Central data layer. Every page reads and writes through these functions.
 * localStorage is the prototype store. Replace the load/save body with API
 * calls later and keep the function names — the UI should not need a rewrite.
 *
 * Prototype only. This is not production storage or production security.
 */
(function (global) {
  const KEY = "tdr_crm_store_v2";
  const listeners = new Set();
  let memory = null;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });

  const ROLE_LABEL = {
    admin: "Admin",
    "call-agent": "Call Agent",
    "sales-advisor": "Sales Advisor",
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function uid(prefix) {
    return `${prefix}${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function formatWhen(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString("en-GB", {
      timeZone: "Asia/Riyadh",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDay(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async function sha256(text) {
    if (!global.crypto || !global.crypto.subtle) {
      throw new Error("This browser cannot hash passwords. Open the app over http://localhost.");
    }
    const buf = await global.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function randomSalt() {
    const bytes = new Uint8Array(16);
    global.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashPassword(password, salt) {
    const s = salt || randomSalt();
    const passwordHash = await sha256(`${s}:${password}`);
    return { salt: s, passwordHash };
  }

  function load() {
    if (memory) return memory;
    try {
      const raw = localStorage.getItem(KEY);
      memory = raw ? JSON.parse(raw) : null;
    } catch {
      memory = null;
    }
    return memory;
  }

  function save(state) {
    memory = state;
    localStorage.setItem(KEY, JSON.stringify(state));
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error(err); }
    });
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function publicUser(user) {
    if (!user) return null;
    const copy = { ...user };
    delete copy.passwordHash;
    delete copy.salt;
    copy.roleLabel = ROLE_LABEL[copy.role] || copy.role;
    return copy;
  }

  function requireState() {
    const state = load();
    if (!state) throw new Error("CRM data is not ready yet.");
    return state;
  }

  function nextLeadNumber(leads) {
    const year = new Date().getFullYear();
    const max = (leads || []).reduce((m, lead) => {
      const match = String(lead.leadNumber || "").match(/(\d+)$/);
      return Math.max(m, match ? Number(match[1]) : 0);
    }, 100);
    return `CRM-${year}-${String(max + 1).padStart(6, "0")}`;
  }

  function statusByName(state, name) {
    return state.statuses.find((s) => s.name.toLowerCase() === String(name || "").toLowerCase());
  }

  function carByName(state, name) {
    return state.cars.find((c) => c.name.toLowerCase() === String(name || "").toLowerCase());
  }

  function userById(state, id) {
    return state.users.find((u) => u.id === id) || null;
  }

  function stampLead(lead, patch, actor) {
    const next = { ...lead, ...patch, updatedAt: nowIso() };
    next.history = Array.isArray(lead.history) ? lead.history.slice() : [];
    return next;
  }

  function pushActivity(state, entry) {
    state.activity.unshift({
      id: uid("ACT"),
      at: nowIso(),
      userId: entry.userId || "",
      userName: entry.userName || "System",
      role: entry.role || "",
      action: entry.action,
      target: entry.target || "",
      details: entry.details || "",
    });
    state.activity = state.activity.slice(0, 400);
  }

  function actorFrom(sessionUser) {
    if (!sessionUser) return { userId: "", userName: "System", role: "" };
    return { userId: sessionUser.id, userName: sessionUser.name, role: ROLE_LABEL[sessionUser.role] || sessionUser.role };
  }

  async function seed() {
    const people = async (row) => {
      const secret = await hashPassword(row.password);
      return {
        id: row.id,
        name: row.name,
        employeeId: row.employeeId,
        role: row.role,
        username: row.username,
        email: row.email || "",
        phone: row.phone || "",
        branch: row.branch || "",
        team: row.team || "",
        status: "active",
        lastLogin: "",
        createdAt: nowIso(),
        salt: secret.salt,
        passwordHash: secret.passwordHash,
      };
    };

    const roster = [
      ["CA48448", "Aljawharah Saad Alsuhaim", "48448", "call-agent"],
      ["CA49157", "Muhannad Hamid AL Youbi", "49157", "call-agent"],
      ["CA50724", "Raghdah Khalid Shalabi", "50724", "call-agent"],
      ["CA49786", "Ziyad Faisal Kabli", "49786", "call-agent"],
      ["CA49601", "Haneen Talal Aqeel Al Madani", "49601", "call-agent"],
      ["CA49638", "Abdullah Saleh Althagafi", "49638", "call-agent"],
      ["CA32834", "Tawdod Atiah Al Sharef", "32834", "call-agent"],
      ["SA46659", "Ghina Assad Salem Alameer", "46659", "sales-advisor"],
      ["SA48714", "Maryam Salah Altabakh", "48714", "sales-advisor"],
      ["SA31629", "Moath Khalel Mohmmad Al Hjoouj", "31629", "sales-advisor"],
      ["SA48461", "Mohsen Zuhair Alattas", "48461", "sales-advisor"],
      ["SA45646", "Essa Meraizeeq Saadi Almutairy", "45646", "sales-advisor"],
      ["SA45615", "Fatmah Mohammed Alasseri", "45615", "sales-advisor"],
      ["SA46662", "Khulood Abdulmajeed Ghulam Albaloushi", "46662", "sales-advisor"],
      ["SA24870", "Mohammed Al Khateeb", "24870", "sales-advisor"],
      ["SA46643", "Raom Fahad Abbas Samkari", "46643", "sales-advisor"],
      ["SA46661", "Magbol Omar Magbol Ashor", "46661", "sales-advisor"],
      ["SA49602", "Alawiyyah Rafi Saad Al Shehri", "49602", "sales-advisor"],
      ["SA13251", "Mohammed Abker Najeri", "13251", "sales-advisor"],
      ["SA49597", "Amjad Ahmed Alwafi", "49597", "sales-advisor"],
      ["SA50863", "Muhannad Abdullah Minyaw", "50863", "sales-advisor"],
    ];
    const users = await Promise.all([
      people({ id: "USR001", name: "Layla Alharbi", employeeId: "ADM-1001", role: "admin", username: "admin", password: "admin123", team: "Digital Retail" }),
      ...roster.map(([id, name, number, role]) => people({
        id,
        name,
        employeeId: number,
        role,
        username: number,
        password: number,
        team: role === "call-agent" ? "Call Center" : "",
        branch: role === "sales-advisor" ? "Showroom" : "",
      })),
    ]);

    const carSeed = [
      ["Camry", "2026", "Sedan", 115000],
      ["Corolla", "2026", "Sedan", 82000],
      ["Yaris", "2026", "Hatchback", 68000],
      ["RAV4", "2026", "SUV", 135000],
      ["Fortuner", "2026", "SUV", 155000],
      ["Hilux", "2026", "Pickup", 125000],
      ["Land Cruiser", "2026", "SUV", 310000],
      ["Land Cruiser Prado", "2026", "SUV", 230000],
      ["Innova", "2026", "MPV", 140000],
      ["Raize", "2026", "SUV", 72000],
      ["Veloz", "2026", "MPV", 98000],
      ["Crown", "2026", "Sedan", 195000],
      ["bZ4X", "2026", "EV", 175000],
    ];
    const cars = carSeed.map((row, i) => ({
      id: `CAR${String(i + 1).padStart(3, "0")}`,
      name: row[0],
      year: row[1],
      category: row[2],
      price: row[3],
      image: "",
      status: "active",
    }));

    const statusSeed = [
      ["New", "#5c6570"],
      ["Contacted", "#1d4f91"],
      ["Interested", "#0f6e56"],
      ["No Answer", "#8a5a12"],
      ["Follow Up", "#8a4b08"],
      ["Confirmed", "#0b7a43"],
      ["Other Car", "#7a1f3d"],
      ["Not Interested", "#6b625c"],
      ["Completed", "#143d2c"],
      ["Cancelled", "#9b1c1c"],
    ];
    const statuses = statusSeed.map((row, i) => ({
      id: `ST${String(i + 1).padStart(3, "0")}`,
      name: row[0],
      color: row[1],
      order: i + 1,
      active: true,
    }));

    const agentIds = roster.filter((row) => row[3] === "call-agent").map((row) => row[0]);
    const advisorIds = roster.filter((row) => row[3] === "sales-advisor").map((row) => row[0]);
    const connections = agentIds.flatMap((callAgentId, index) => [0, 1].map((offset) => ({
      id: `CN${String(index * 2 + offset + 1).padStart(3, "0")}`,
      callAgentId,
      salesAdvisorId: advisorIds[(index * 2 + offset) % advisorIds.length],
      connectedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString(),
      status: "active",
    })));

    const first = ["Omar", "Hassan", "Layla", "Nora", "Yousef", "Salem", "Huda", "Tariq", "Maha", "Bandar", "Reem", "Sami", "Lina", "Fahad", "Amal", "Waleed", "Dina", "Rakan", "Mona", "Adel", "Hanan", "Saud"];
    const last = ["Alqahtani", "Alshehri", "Aldossari", "Almutairi", "Alghamdi", "Alzahrani", "Alharbi", "Alotaibi"];
    const pairs = connections.map((row) => [row.callAgentId, row.salesAdvisorId]);
    const leads = [];
    for (let n = 0; n < 22; n += 1) {
      const num = 101 + n;
      const car = cars[n % cars.length];
      const status = statuses[n % statuses.length];
      const pair = n < 16 ? pairs[n % pairs.length] : ["", ""];
      const agent = users.find((u) => u.id === pair[0]);
      const advisor = users.find((u) => u.id === pair[1]);
      const created = new Date(Date.now() - 1000 * 60 * 60 * (18 * (22 - n) + 5));
      const assigned = agent ? new Date(created.getTime() + 1000 * 60 * 40) : null;
      const decision = status.name === "Other Car" ? "Choose Other Car" : (status.name === "Confirmed" || status.name === "Completed" ? "Confirmed Requested Car" : "");
      const selected = decision === "Choose Other Car" ? cars[(n + 3) % cars.length].name : car.name;
      leads.push({
        id: `LEAD${String(num).padStart(3, "0")}`,
        leadNumber: `CRM-2026-${String(num).padStart(6, "0")}`,
        customerName: `${first[n]} ${last[n % last.length]}`,
        phone: `05${String(50000000 + num * 17).slice(0, 8)}`,
        requestedCar: car.name,
        selectedCar: selected,
        callAgentId: agent ? agent.id : "",
        callAgentName: agent ? agent.name : "",
        salesAdvisorId: advisor ? advisor.id : "",
        salesAdvisorName: advisor ? advisor.name : "",
        statusId: status.id,
        statusName: status.name,
        vehicleDecision: decision,
        financeType: n % 3 === 0 ? "Lease" : (n % 3 === 1 ? "Cash" : ""),
        createdAt: created.toISOString(),
        assignedAt: assigned ? assigned.toISOString() : "",
        updatedAt: (assigned || created).toISOString(),
        history: agent ? [{
          at: assigned.toISOString(),
          userId: agent.id,
          userName: agent.name,
          action: "Lead Assignment",
          details: `Assigned to ${advisor.name}`,
        }] : [],
      });
    }

    leads.push({
      id: "LEAD123",
      leadNumber: "CRM-2026-000123",
      customerName: "Ahmed Mohammed",
      phone: "0501234567",
      requestedCar: "Camry",
      selectedCar: "Camry",
      callAgentId: "",
      callAgentName: "",
      salesAdvisorId: "",
      salesAdvisorName: "",
      statusId: statuses[0].id,
      statusName: "New",
      vehicleDecision: "",
      financeType: "",
      createdAt: nowIso(),
      assignedAt: "",
      updatedAt: nowIso(),
      history: [],
    });

    const activity = [{
      id: "ACTSEED",
      at: nowIso(),
      userId: "USR001",
      userName: "Layla Alharbi",
      role: "Admin",
      action: "User Login",
      target: "admin",
      details: "Demo workspace prepared",
    }];
    leads.filter((l) => l.salesAdvisorId).slice(0, 8).forEach((lead) => {
      activity.unshift({
        id: uid("ACT"),
        at: lead.assignedAt,
        userId: lead.callAgentId,
        userName: lead.callAgentName,
        role: "Call Agent",
        action: "Lead Assignment",
        target: lead.leadNumber,
        details: `${lead.callAgentName} assigned ${lead.leadNumber} to ${lead.salesAdvisorName}`,
      });
    });

    return {
      version: 1,
      users,
      cars,
      statuses,
      connections,
      leads,
      activity,
      settings: {
        companyName: "Abdul Latif Jameel Motors",
        systemName: "Toyota Digital Retail · Call Agent CRM",
        defaultStatusId: statuses[0].id,
        defaultCarId: cars[0].id,
        sessionMinutes: 480,
        notifications: true,
      },
    };
  }

  async function init() {
    const existing = load();
    if (!existing || !existing.users || !existing.leads) {
      memory = null;
      save(await seed());
    }
    readyResolve();
  }

  global.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    memory = null;
    const state = load();
    listeners.forEach((fn) => {
      try { fn(state); } catch (err) { console.error(err); }
    });
  });

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function users(role) {
    const state = requireState();
    return state.users
      .filter((u) => !role || u.role === role)
      .map(publicUser)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function cars(activeOnly) {
    const state = requireState();
    return clone(state.cars)
      .filter((c) => !activeOnly || c.status === "active")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function statuses(activeOnly) {
    const state = requireState();
    return clone(state.statuses)
      .filter((s) => !activeOnly || s.active)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  function leads() {
    return clone(requireState().leads).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  function connections() {
    const state = requireState();
    return clone(state.connections).map((row) => {
      const agent = userById(state, row.callAgentId);
      const advisor = userById(state, row.salesAdvisorId);
      return {
        ...row,
        callAgentName: agent ? agent.name : "Removed user",
        salesAdvisorName: advisor ? advisor.name : "Removed user",
      };
    });
  }

  function activeLinks(callAgentId, salesAdvisorId) {
    return connections().filter((row) => row.status === "active"
      && (!callAgentId || row.callAgentId === callAgentId)
      && (!salesAdvisorId || row.salesAdvisorId === salesAdvisorId));
  }

  function advisorsForAgent(callAgentId) {
    const ids = new Set(activeLinks(callAgentId).map((row) => row.salesAdvisorId));
    return users("sales-advisor").filter((u) => ids.has(u.id) && u.status === "active");
  }

  function agentsForAdvisor(salesAdvisorId) {
    const state = requireState();
    return activeLinks(null, salesAdvisorId).map((row) => {
      const agent = publicUser(userById(state, row.callAgentId));
      const count = state.leads.filter((lead) => lead.callAgentId === row.callAgentId && lead.salesAdvisorId === salesAdvisorId).length;
      return { ...agent, leadCount: count };
    }).filter((row) => row.id);
  }

  function findUserByUsername(username) {
    const state = requireState();
    const key = String(username || "").trim().toLowerCase();
    return state.users.find((u) => u.username.toLowerCase() === key) || null;
  }

  function suggestUsername(name) {
    const base = String(name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(".");
    if (!base) return "";
    const state = requireState();
    let candidate = base;
    let n = 2;
    while (state.users.some((u) => u.username.toLowerCase() === candidate)) {
      candidate = `${base}${n}`;
      n += 1;
    }
    return candidate;
  }

  async function createUser(input, actor) {
    const state = requireState();
    const name = String(input.name || "").trim();
    const username = String(input.username || "").trim().toLowerCase();
    const employeeId = String(input.employeeId || "").trim();
    const role = input.role;
    if (!name || !username || !employeeId || !ROLE_LABEL[role]) throw new Error("Name, employee ID, username, and role are required.");
    if (state.users.some((u) => u.username.toLowerCase() === username)) throw new Error("That username is already in use.");
    if (state.users.some((u) => u.employeeId.toLowerCase() === employeeId.toLowerCase())) throw new Error("That employee ID is already in use.");
    const password = String(input.password || "");
    if (password.length < 5) throw new Error("Password must be at least 5 characters.");
    if (input.confirm != null && password !== input.confirm) throw new Error("Passwords do not match.");
    const secret = await hashPassword(password);
    const user = {
      id: uid("USR"),
      name,
      employeeId,
      role,
      username,
      email: String(input.email || "").trim(),
      phone: String(input.phone || "").trim(),
      branch: String(input.branch || "").trim(),
      team: String(input.team || "").trim(),
      status: input.status === "disabled" ? "disabled" : "active",
      lastLogin: "",
      createdAt: nowIso(),
      salt: secret.salt,
      passwordHash: secret.passwordHash,
    };
    state.users.push(user);
    pushActivity(state, { ...actorFrom(actor), action: "User Created", target: user.username, details: `${user.name} · ${ROLE_LABEL[user.role]}` });
    save(state);
    return publicUser(user);
  }

  async function updateUser(id, input, actor) {
    const state = requireState();
    const user = userById(state, id);
    if (!user) throw new Error("User not found.");
    const name = String(input.name ?? user.name).trim();
    const username = String(input.username ?? user.username).trim().toLowerCase();
    const employeeId = String(input.employeeId ?? user.employeeId).trim();
    if (!name || !username || !employeeId) throw new Error("Name, employee ID, and username are required.");
    if (state.users.some((u) => u.id !== id && u.username.toLowerCase() === username)) throw new Error("That username is already in use.");
    if (state.users.some((u) => u.id !== id && u.employeeId.toLowerCase() === employeeId.toLowerCase())) throw new Error("That employee ID is already in use.");
    user.name = name;
    user.username = username;
    user.employeeId = employeeId;
    if (input.role && ROLE_LABEL[input.role]) user.role = input.role;
    if (input.email != null) user.email = String(input.email).trim();
    if (input.phone != null) user.phone = String(input.phone).trim();
    if (input.branch != null) user.branch = String(input.branch).trim();
    if (input.team != null) user.team = String(input.team).trim();
    if (input.status) user.status = input.status === "disabled" ? "disabled" : "active";
    if (input.password) {
      if (String(input.password).length < 5) throw new Error("Password must be at least 5 characters.");
      if (input.confirm != null && input.password !== input.confirm) throw new Error("Passwords do not match.");
      const secret = await hashPassword(input.password);
      user.salt = secret.salt;
      user.passwordHash = secret.passwordHash;
      pushActivity(state, { ...actorFrom(actor), action: "Password Reset", target: user.username, details: user.name });
    }
    state.leads.forEach((lead) => {
      if (lead.callAgentId === user.id) lead.callAgentName = user.name;
      if (lead.salesAdvisorId === user.id) lead.salesAdvisorName = user.name;
    });
    save(state);
    return publicUser(user);
  }

  function setUserStatus(id, status, actor) {
    const state = requireState();
    const user = userById(state, id);
    if (!user) throw new Error("User not found.");
    user.status = status === "disabled" ? "disabled" : "active";
    pushActivity(state, {
      ...actorFrom(actor),
      action: user.status === "disabled" ? "User Disabled" : "User Enabled",
      target: user.username,
      details: user.name,
    });
    save(state);
    return publicUser(user);
  }

  function deleteUser(id, actor) {
    const state = requireState();
    const user = userById(state, id);
    if (!user) throw new Error("User not found.");
    if (actor && actor.id === id) throw new Error("You cannot delete the account you are using.");
    state.users = state.users.filter((u) => u.id !== id);
    state.connections.forEach((row) => {
      if (row.callAgentId === id || row.salesAdvisorId === id) row.status = "disconnected";
    });
    pushActivity(state, { ...actorFrom(actor), action: "User Deleted", target: user.username, details: `${user.name} · leads were kept` });
    save(state);
  }

  function touchLogin(id) {
    const state = requireState();
    const user = userById(state, id);
    if (!user) return;
    user.lastLogin = nowIso();
    pushActivity(state, { userId: user.id, userName: user.name, role: ROLE_LABEL[user.role], action: "User Login", target: user.username, details: "Signed in" });
    save(state);
  }

  function setConnections(callAgentId, advisorIds, actor) {
    const state = requireState();
    const agent = userById(state, callAgentId);
    if (!agent || agent.role !== "call-agent") throw new Error("Choose a call agent.");
    const wanted = new Set(advisorIds || []);
    const stamp = nowIso();
    wanted.forEach((advisorId) => {
      const advisor = userById(state, advisorId);
      if (!advisor || advisor.role !== "sales-advisor") return;
      let row = state.connections.find((c) => c.callAgentId === callAgentId && c.salesAdvisorId === advisorId);
      if (!row) {
        row = { id: uid("CN"), callAgentId, salesAdvisorId: advisorId, connectedAt: stamp, status: "active" };
        state.connections.push(row);
        pushActivity(state, { ...actorFrom(actor), action: "Call Agent Connected", target: agent.name, details: advisor.name });
      } else if (row.status !== "active") {
        row.status = "active";
        row.connectedAt = stamp;
        pushActivity(state, { ...actorFrom(actor), action: "Call Agent Connected", target: agent.name, details: advisor.name });
      }
    });
    state.connections.forEach((row) => {
      if (row.callAgentId !== callAgentId || row.status !== "active") return;
      if (wanted.has(row.salesAdvisorId)) return;
      row.status = "disconnected";
      const advisor = userById(state, row.salesAdvisorId);
      pushActivity(state, { ...actorFrom(actor), action: "Call Agent Disconnected", target: agent.name, details: advisor ? advisor.name : row.salesAdvisorId });
    });
    save(state);
  }

  function setConnectionStatus(id, status, actor) {
    const state = requireState();
    const row = state.connections.find((c) => c.id === id);
    if (!row) throw new Error("Connection not found.");
    row.status = status === "active" ? "active" : "disconnected";
    if (row.status === "active") row.connectedAt = nowIso();
    const agent = userById(state, row.callAgentId);
    const advisor = userById(state, row.salesAdvisorId);
    pushActivity(state, {
      ...actorFrom(actor),
      action: row.status === "active" ? "Call Agent Connected" : "Call Agent Disconnected",
      target: agent ? agent.name : row.callAgentId,
      details: advisor ? advisor.name : row.salesAdvisorId,
    });
    save(state);
  }

  function saveCar(input, actor) {
    const state = requireState();
    const name = String(input.name || "").trim();
    if (!name) throw new Error("Model name is required.");
    const price = Number(String(input.price || "").replace(/,/g, ""));
    if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid starting price.");
    const payload = {
      name,
      year: String(input.year || new Date().getFullYear()).trim(),
      category: String(input.category || "SUV").trim(),
      price,
      image: String(input.image || "").trim(),
      status: input.status === "inactive" ? "inactive" : "active",
    };
    if (input.id) {
      const car = state.cars.find((c) => c.id === input.id);
      if (!car) throw new Error("Vehicle not found.");
      Object.assign(car, payload);
    } else {
      if (state.cars.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error("That model already exists.");
      state.cars.push({ id: uid("CAR"), ...payload });
    }
    pushActivity(state, { ...actorFrom(actor), action: input.id ? "Vehicle Updated" : "Vehicle Created", target: name, details: payload.status });
    save(state);
  }

  function deleteCar(id, actor) {
    const state = requireState();
    const car = state.cars.find((c) => c.id === id);
    if (!car) throw new Error("Vehicle not found.");
    state.cars = state.cars.filter((c) => c.id !== id);
    if (state.settings.defaultCarId === id) state.settings.defaultCarId = state.cars[0] ? state.cars[0].id : "";
    pushActivity(state, { ...actorFrom(actor), action: "Vehicle Deleted", target: car.name, details: "Removed from the active list" });
    save(state);
  }

  function saveStatus(input, actor) {
    const state = requireState();
    const name = String(input.name || "").trim();
    if (!name) throw new Error("Status name is required.");
    if (input.id) {
      const row = state.statuses.find((s) => s.id === input.id);
      if (!row) throw new Error("Status not found.");
      const previous = row.name;
      row.name = name;
      row.color = input.color || row.color;
      row.active = input.active !== false;
      state.leads.forEach((lead) => {
        if (lead.statusId === row.id) lead.statusName = row.name;
      });
      pushActivity(state, { ...actorFrom(actor), action: "Status Updated", target: name, details: previous === name ? "" : `Renamed from ${previous}` });
    } else {
      if (state.statuses.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error("That status already exists.");
      const order = state.statuses.reduce((m, s) => Math.max(m, s.order), 0) + 1;
      state.statuses.push({ id: uid("ST"), name, color: input.color || "#5c6570", order, active: true });
      pushActivity(state, { ...actorFrom(actor), action: "Status Created", target: name, details: "" });
    }
    save(state);
  }

  function moveStatus(id, dir) {
    const state = requireState();
    const list = state.statuses.slice().sort((a, b) => a.order - b.order);
    const index = list.findIndex((s) => s.id === id);
    const swap = index + dir;
    if (index < 0 || swap < 0 || swap >= list.length) return;
    const order = list[index].order;
    list[index].order = list[swap].order;
    list[swap].order = order;
    save(state);
  }

  function deleteStatus(id, actor) {
    const state = requireState();
    const row = state.statuses.find((s) => s.id === id);
    if (!row) throw new Error("Status not found.");
    if (state.leads.some((lead) => lead.statusId === id)) throw new Error("This status is used by leads. Deactivate it instead of deleting it.");
    state.statuses = state.statuses.filter((s) => s.id !== id);
    if (state.settings.defaultStatusId === id) state.settings.defaultStatusId = state.statuses[0] ? state.statuses[0].id : "";
    pushActivity(state, { ...actorFrom(actor), action: "Status Deleted", target: row.name, details: "" });
    save(state);
  }

  function applyStatus(state, lead, statusId) {
    const status = state.statuses.find((s) => s.id === statusId && s.active);
    if (!status) throw new Error("Choose an active status.");
    const previous = lead.statusName;
    lead.statusId = status.id;
    lead.statusName = status.name;
    return previous;
  }

  function applyCar(state, name) {
    const car = carByName(state, name);
    if (!car || car.status !== "active") throw new Error("Choose an active vehicle.");
    return car.name;
  }

  function createLead(input, actor) {
    const state = requireState();
    const customerName = String(input.customerName || "").trim();
    const phone = String(input.phone || "").trim();
    if (!customerName || !phone) throw new Error("Customer name and phone are required.");
    const requestedCar = applyCar(state, input.requestedCar || (carByName(state, "Camry") || state.cars.find((c) => c.status === "active") || {}).name);
    const status = state.statuses.find((s) => s.id === (input.statusId || state.settings.defaultStatusId) && s.active) || state.statuses.find((s) => s.active);
    const lead = {
      id: uid("LEAD"),
      leadNumber: nextLeadNumber(state.leads),
      customerName,
      phone,
      requestedCar,
      selectedCar: requestedCar,
      callAgentId: "",
      callAgentName: "",
      salesAdvisorId: "",
      salesAdvisorName: "",
      statusId: status ? status.id : "",
      statusName: status ? status.name : "",
      vehicleDecision: "",
      financeType: "",
      createdAt: nowIso(),
      assignedAt: "",
      updatedAt: nowIso(),
      history: [],
    };
    state.leads.unshift(lead);
    pushActivity(state, { ...actorFrom(actor), action: "Lead Created", target: lead.leadNumber, details: customerName });
    save(state);
    return clone(lead);
  }

  function updateLead(id, patch, actor) {
    const state = requireState();
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead not found.");
    const who = actorFrom(actor);
    if (patch.customerName != null) lead.customerName = String(patch.customerName).trim();
    if (patch.phone != null) lead.phone = String(patch.phone).trim();
    if (patch.requestedCar) lead.requestedCar = applyCar(state, patch.requestedCar);
    if (patch.statusId && patch.statusId !== lead.statusId) {
      const previous = applyStatus(state, lead, patch.statusId);
      pushActivity(state, { ...who, action: "Lead Status Change", target: lead.leadNumber, details: `${previous} → ${lead.statusName}` });
      lead.history.push({ at: nowIso(), userId: who.userId, userName: who.userName, action: "Lead Status Change", details: `${previous} → ${lead.statusName}` });
    }
    if (patch.callAgentId != null) {
      const agent = patch.callAgentId ? userById(state, patch.callAgentId) : null;
      lead.callAgentId = agent ? agent.id : "";
      lead.callAgentName = agent ? agent.name : "";
    }
    if (patch.salesAdvisorId != null) {
      const advisor = patch.salesAdvisorId ? userById(state, patch.salesAdvisorId) : null;
      lead.salesAdvisorId = advisor ? advisor.id : "";
      lead.salesAdvisorName = advisor ? advisor.name : "";
      if (advisor && !lead.assignedAt) lead.assignedAt = nowIso();
    }
    lead.updatedAt = nowIso();
    save(state);
    return clone(lead);
  }

  function assignLead(leadId, input, actor) {
    const state = requireState();
    const lead = state.leads.find((l) => l.id === leadId || l.leadNumber.toLowerCase() === String(leadId).toLowerCase());
    if (!lead) throw new Error("CRM lead was not found.");
    const agent = userById(state, input.callAgentId);
    const advisor = userById(state, input.salesAdvisorId);
    if (!agent || agent.role !== "call-agent") throw new Error("Call agent is missing.");
    if (!advisor || advisor.role !== "sales-advisor" || advisor.status !== "active") throw new Error("Choose an active sales advisor.");
    const linked = state.connections.some((row) => row.status === "active" && row.callAgentId === agent.id && row.salesAdvisorId === advisor.id);
    if (!linked) throw new Error(`${advisor.name} is not connected to ${agent.name}.`);
    const carName = applyCar(state, input.car || lead.requestedCar);
    const previousStatus = lead.statusName;
    if (input.statusId) applyStatus(state, lead, input.statusId);
    lead.requestedCar = carName;
    lead.selectedCar = carName;
    lead.callAgentId = agent.id;
    lead.callAgentName = agent.name;
    lead.salesAdvisorId = advisor.id;
    lead.salesAdvisorName = advisor.name;
    lead.assignedAt = nowIso();
    lead.updatedAt = lead.assignedAt;
    const details = `${agent.name} assigned ${lead.leadNumber} to ${advisor.name} · ${carName} · ${lead.statusName}`;
    lead.history.push({ at: lead.assignedAt, userId: agent.id, userName: agent.name, action: "Lead Assignment", details });
    if (previousStatus !== lead.statusName) {
      pushActivity(state, { ...actorFrom(actor), action: "Lead Status Change", target: lead.leadNumber, details: `${previousStatus} → ${lead.statusName}` });
    }
    pushActivity(state, { ...actorFrom(actor), action: "Lead Assignment", target: lead.leadNumber, details });
    save(state);
    return clone(lead);
  }

  function advisorUpdate(leadId, input, actor) {
    const state = requireState();
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) throw new Error("Lead not found.");
    if (!actor || lead.salesAdvisorId !== actor.id) throw new Error("This lead is not assigned to you.");
    const decision = input.vehicleDecision;
    if (decision !== "Confirmed Requested Car" && decision !== "Choose Other Car") throw new Error("Choose a vehicle decision.");
    const finance = input.financeType;
    if (finance !== "Cash" && finance !== "Lease") throw new Error("Choose Cash or Lease.");
    const who = actorFrom(actor);
    if (input.statusId && input.statusId !== lead.statusId) {
      const previous = applyStatus(state, lead, input.statusId);
      pushActivity(state, { ...who, action: "Lead Status Change", target: lead.leadNumber, details: `${previous} → ${lead.statusName}` });
    }
    let selected = lead.requestedCar;
    if (decision === "Choose Other Car") {
      selected = applyCar(state, input.selectedCar);
      if (selected === lead.requestedCar) throw new Error("Choose a different vehicle, or confirm the requested car.");
    }
    if (selected !== lead.selectedCar || decision !== lead.vehicleDecision) {
      pushActivity(state, { ...who, action: "Car Change", target: lead.leadNumber, details: `${lead.requestedCar} → ${selected} · ${decision}` });
    }
    if (finance !== lead.financeType) {
      pushActivity(state, { ...who, action: "Finance Type Change", target: lead.leadNumber, details: `${lead.financeType || "—"} → ${finance}` });
    }
    lead.vehicleDecision = decision;
    lead.selectedCar = selected;
    lead.financeType = finance;
    lead.updatedAt = nowIso();
    lead.history.push({
      at: lead.updatedAt,
      userId: who.userId,
      userName: who.userName,
      action: "Advisor Update",
      details: `${decision} · ${selected} · ${finance} · ${lead.statusName}`,
    });
    save(state);
    return clone(lead);
  }

  function deleteLead(id, actor) {
    const state = requireState();
    const lead = state.leads.find((l) => l.id === id);
    if (!lead) throw new Error("Lead not found.");
    state.leads = state.leads.filter((l) => l.id !== id);
    pushActivity(state, { ...actorFrom(actor), action: "Lead Deleted", target: lead.leadNumber, details: lead.customerName });
    save(state);
  }

  function saveSettings(patch, actor) {
    const state = requireState();
    state.settings = {
      ...state.settings,
      companyName: String(patch.companyName || state.settings.companyName).trim(),
      systemName: String(patch.systemName || state.settings.systemName).trim(),
      defaultStatusId: patch.defaultStatusId || state.settings.defaultStatusId,
      defaultCarId: patch.defaultCarId || state.settings.defaultCarId,
      sessionMinutes: Math.max(15, Number(patch.sessionMinutes) || state.settings.sessionMinutes),
      notifications: !!patch.notifications,
    };
    pushActivity(state, { ...actorFrom(actor), action: "Settings Updated", target: "Settings", details: state.settings.systemName });
    save(state);
    return clone(state.settings);
  }

  function kpis(list) {
    const rows = list || requireState().leads;
    const count = (pred) => rows.filter(pred).length;
    return {
      total: rows.length,
      fresh: count((l) => l.statusName === "New"),
      assigned: count((l) => !!l.salesAdvisorId),
      progress: count((l) => ["Contacted", "Interested", "Follow Up", "No Answer"].includes(l.statusName)),
      confirmed: count((l) => l.statusName === "Confirmed"),
      otherCar: count((l) => l.vehicleDecision === "Choose Other Car" || l.statusName === "Other Car"),
      completed: count((l) => l.statusName === "Completed"),
      unassigned: count((l) => !l.salesAdvisorId),
      contacted: count((l) => l.statusName === "Contacted"),
      followUp: count((l) => l.statusName === "Follow Up"),
    };
  }

  function showToast(message, kind) {
    const root = document.getElementById("toast-root");
    if (!root) return;
    const el = document.createElement("div");
    el.className = `toast is-${kind || "ok"}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add("is-out");
      setTimeout(() => el.remove(), 220);
    }, 4200);
  }

  function openModal({ title, html, wide }) {
    const root = document.getElementById("modal-root");
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-back" data-close-modal="1">
        <section class="modal-card${wide ? " is-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <header class="modal-head">
            <h3>${esc(title)}</h3>
            <button type="button" class="icon-btn" data-close-modal="1" aria-label="Close">×</button>
          </header>
          <div class="modal-body">${html}</div>
        </section>
      </div>`;
    const card = root.querySelector(".modal-card");
    card.addEventListener("click", (event) => event.stopPropagation());
    root.querySelectorAll("[data-close-modal]").forEach((node) => {
      if (node === card) return;
      node.addEventListener("click", closeModal);
    });
    const first = root.querySelector("input, select, textarea, button");
    if (first) first.focus();
  }

  function closeModal() {
    const root = document.getElementById("modal-root");
    if (!root) return;
    root.hidden = true;
    root.innerHTML = "";
  }

  function confirmDialog({ title, message, confirmLabel, danger }) {
    const root = document.getElementById("dialog-root");
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-back">
        <section class="modal-card is-confirm" role="dialog" aria-modal="true" aria-label="${esc(title)}">
          <header class="modal-head"><h3>${esc(title)}</h3></header>
          <div class="modal-body"><p>${esc(message)}</p>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" data-confirm="0">Cancel</button>
              <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm="1">${esc(confirmLabel || "Confirm")}</button>
            </div>
          </div>
        </section>
      </div>`;
    return new Promise((resolve) => {
      root.querySelectorAll("[data-confirm]").forEach((btn) => {
        btn.addEventListener("click", () => {
          root.hidden = true;
          root.innerHTML = "";
          resolve(btn.getAttribute("data-confirm") === "1");
        });
      });
    });
  }

  function passwordStrength(password) {
    const value = String(password || "");
    let score = 0;
    if (value.length >= 6) score += 1;
    if (value.length >= 10) score += 1;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
    if (/\d/.test(value)) score += 1;
    if (/[^A-Za-z0-9]/.test(value)) score += 1;
    const label = ["Too short", "Weak", "Fair", "Good", "Strong", "Strong"][Math.min(score, 5)];
    return { score, label };
  }

  function generatePassword() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@$%";
    const bytes = new Uint8Array(12);
    global.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  }

  global.TDR = {
    ready,
    ROLE_LABEL,
    esc,
    formatWhen,
    formatDay,
    subscribe,
    hashPassword,
    users,
    cars,
    statuses,
    leads,
    connections,
    activeLinks,
    advisorsForAgent,
    agentsForAdvisor,
    findUserByUsername,
    suggestUsername,
    createUser,
    updateUser,
    setUserStatus,
    deleteUser,
    touchLogin,
    setConnections,
    setConnectionStatus,
    saveCar,
    deleteCar,
    saveStatus,
    moveStatus,
    deleteStatus,
    createLead,
    updateLead,
    assignLead,
    advisorUpdate,
    deleteLead,
    saveSettings,
    settings: () => clone(requireState().settings),
    activity: () => clone(requireState().activity),
    kpis,
    showToast,
    openModal,
    closeModal,
    confirmDialog,
    passwordStrength,
    generatePassword,
    publicUser,
    async restoreDemo() {
      memory = null;
      localStorage.removeItem(KEY);
      save(await seed());
    },
  };

  init().catch((err) => {
    console.error(err);
    readyResolve();
  });
})(window);
