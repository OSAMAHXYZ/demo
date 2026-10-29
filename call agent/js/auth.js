/**
 * Prototype authentication gate.
 * Passwords are salted and hashed before they are stored, and they are never
 * shown in tables. This is NOT production security: there is no server session,
 * no httpOnly cookie, and the hash runs in the browser.
 * Later, replace login() with POST /api/auth/login and keep requireRole().
 */
(function (global) {
  const SESSION = "tdr_crm_session";
  const REMEMBER = "tdr_crm_remember";
  const HOME = {
    admin: "admin.html",
    "call-agent": "call-agent.html",
    "sales-advisor": "sales-advisor.html",
  };

  function readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION) || localStorage.getItem(REMEMBER);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function current() {
    const session = readSession();
    if (!session || !session.userId || !global.TDR) return null;
    const user = TDR.users().find((row) => row.id === session.userId);
    if (!user || user.status !== "active") return null;
    const settings = TDR.settings();
    const max = Math.max(15, Number(settings.sessionMinutes) || 480) * 60 * 1000;
    if (session.at && Date.now() - session.at > max) {
      clear();
      return null;
    }
    return user;
  }

  function clear() {
    sessionStorage.removeItem(SESSION);
    localStorage.removeItem(REMEMBER);
  }

  async function login(username, password, remember) {
    await TDR.ready;
    const record = TDR.findUserByUsername(username);
    if (!record || record.status !== "active") {
      throw new Error("Username or password is incorrect, or the account is disabled.");
    }
    const hashed = await TDR.hashPassword(password, record.salt);
    if (hashed.passwordHash !== record.passwordHash) {
      throw new Error("Username or password is incorrect, or the account is disabled.");
    }
    const session = { userId: record.id, at: Date.now() };
    sessionStorage.setItem(SESSION, JSON.stringify(session));
    if (remember) localStorage.setItem(REMEMBER, JSON.stringify(session));
    else localStorage.removeItem(REMEMBER);
    TDR.touchLogin(record.id);
    return TDR.publicUser(record);
  }

  function homeFor(user) {
    return HOME[user.role] || "login.html";
  }

  async function requireRole(role) {
    await TDR.ready;
    const user = current();
    if (!user) {
      location.replace("login.html");
      return null;
    }
    if (role && user.role !== role) {
      location.replace(homeFor(user));
      return null;
    }
    return user;
  }

  function logout() {
    clear();
    location.replace("login.html");
  }

  global.Auth = { login, logout, current, requireRole, homeFor, clear };
})(window);
