/**
 * Report Sheet login — three fixed users.
 * Khayri = admin (all dashboards + full Admin Push).
 * Mohammed Alghamdi & Ziyad Al Ghamdi = viewers (dashboards Khayri assigns).
 */
(function (global) {
  const SESSION_KEY = "report_sheet_session_v1";
  const ACCESS_KEY = "report_sheet_viewer_access_v1";
  const API_ACCESS = "/api/report-sheet/viewer-access";

  const DASHBOARDS = [
    { id: "summary", label: "Summary · Del vs Prof" },
    { id: "salesreport", label: "Sales Dashboard" },
    { id: "ytdsales", label: "YTD Sales" },
    { id: "gec", label: "GEC Dashboard" },
    { id: "contact", label: "Contact Performance" },
    { id: "delivery", label: "Delivery" },
    { id: "lexus", label: "Lexus Tracker" },
    { id: "b2c", label: "B2C Tracker" },
    { id: "bodashboard", label: "BO Dashboard" },
    { id: "boerrors", label: "BO Errors" },
    { id: "boallocstock", label: "Allocation" },
    { id: "plantracker", label: "Plan Tracker" },
    { id: "reservedvehicles", label: "Reserved Vehicles Tracker" },
  ];

  const USERS = [
    {
      id: "khayri",
      username: "khayri",
      password: "khayri",
      name: "Khayri",
      role: "admin",
      title: "Admin · Full access",
      initial: "K",
    },
    {
      id: "mohammed",
      username: "mohammed",
      password: "mohammed",
      name: "Mohammed Alghamdi",
      role: "viewer",
      title: "Viewer",
      initial: "M",
    },
    {
      id: "ziyad",
      username: "ziyad",
      password: "ziyad",
      name: "Ziyad Al Ghamdi",
      role: "viewer",
      title: "Viewer",
      initial: "Z",
    },
  ];

  const VIEWER_IDS = USERS.filter((u) => u.role === "viewer").map((u) => u.id);

  function publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      title: user.title,
      initial: user.initial,
    };
  }

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeSession(user, remember) {
    const payload = JSON.stringify({ userId: user.id, at: Date.now() });
    sessionStorage.setItem(SESSION_KEY, payload);
    if (remember) localStorage.setItem(SESSION_KEY, payload);
    else localStorage.removeItem(SESSION_KEY);
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
  }

  function findUser(username) {
    const key = String(username || "").trim().toLowerCase();
    return USERS.find((u) => u.username === key || u.id === key) || null;
  }

  function current() {
    const session = readSession();
    if (!session || !session.userId) return null;
    const user = USERS.find((u) => u.id === session.userId);
    return publicUser(user);
  }

  function login(username, password, remember) {
    const user = findUser(username);
    if (!user || String(password || "") !== user.password) {
      throw new Error("Username or password is incorrect.");
    }
    writeSession(user, !!remember);
    return publicUser(user);
  }

  function logout() {
    clearSession();
    location.replace("login.html");
  }

  function homeFor(user) {
    if (!user) return "login.html";
    return user.role === "admin" ? "admin.html" : "index.html";
  }

  function requireLogin(opts) {
    const options = opts || {};
    const user = current();
    if (!user) {
      location.replace("login.html");
      return null;
    }
    if (options.adminOnly && user.role !== "admin") {
      location.replace("index.html");
      return null;
    }
    return user;
  }

  function emptyAccess() {
    const out = {};
    VIEWER_IDS.forEach((id) => { out[id] = []; });
    return out;
  }

  function sanitizeAccess(input) {
    const out = emptyAccess();
    const src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const allowed = new Set(DASHBOARDS.map((d) => d.id));
    VIEWER_IDS.forEach((id) => {
      const list = Array.isArray(src[id]) ? src[id] : [];
      const seen = new Set();
      out[id] = list
        .map((x) => String(x || "").trim())
        .filter((x) => allowed.has(x) && !seen.has(x) && (seen.add(x) || true));
    });
    return out;
  }

  function readAccess() {
    try {
      return sanitizeAccess(JSON.parse(localStorage.getItem(ACCESS_KEY) || "null"));
    } catch {
      return emptyAccess();
    }
  }

  function writeAccess(access) {
    const next = sanitizeAccess(access);
    localStorage.setItem(ACCESS_KEY, JSON.stringify(next));
    return next;
  }

  function applyAccessFromMeta(meta) {
    if (!meta || meta.viewerAccess == null) return readAccess();
    return writeAccess(meta.viewerAccess);
  }

  async function fetchAccess() {
    try {
      const res = await fetch(API_ACCESS, { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load access");
      const data = await res.json();
      return writeAccess(data && data.viewerAccess);
    } catch {
      return readAccess();
    }
  }

  async function saveAccess(access) {
    const payload = sanitizeAccess(access);
    const res = await fetch(API_ACCESS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ viewerAccess: payload }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Could not save dashboard access");
    }
    return writeAccess(payload);
  }

  function panelsFor(user) {
    const who = user || current();
    if (!who) return [];
    if (who.role === "admin") return DASHBOARDS.map((d) => d.id);
    return readAccess()[who.id] || [];
  }

  function canViewPanel(panelId, user) {
    const who = user || current();
    if (!who) return false;
    if (who.role === "admin") return true;
    return panelsFor(who).includes(panelId);
  }

  function isAdmin(user) {
    return (user || current() || {}).role === "admin";
  }

  function paintUserCard(root, user) {
    const who = user || current();
    if (!root || !who) return;
    const avatar = root.querySelector(".sidebar-user-avatar");
    const meta = root.querySelector(".sidebar-user-meta");
    if (avatar) avatar.textContent = who.initial || who.name.slice(0, 1);
    if (meta) {
      meta.innerHTML = `<strong></strong><span></span>`;
      meta.querySelector("strong").textContent = who.name;
      meta.querySelector("span").textContent = who.title;
    }
  }

  global.ReportSheetAuth = {
    SESSION_KEY,
    ACCESS_KEY,
    DASHBOARDS,
    USERS: USERS.map(publicUser),
    VIEWER_IDS,
    current,
    login,
    logout,
    homeFor,
    requireLogin,
    isAdmin,
    canViewPanel,
    panelsFor,
    readAccess,
    writeAccess,
    sanitizeAccess,
    applyAccessFromMeta,
    fetchAccess,
    saveAccess,
    paintUserCard,
    emptyAccess,
  };
})(window);
