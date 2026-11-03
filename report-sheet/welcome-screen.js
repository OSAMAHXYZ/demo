/* =====================================================================
   welcome-screen.js  ·  full-screen welcome (#welcome-screen)
   Load with:  <script src="welcome-screen.js"></script>
   (just before </body>, AFTER scroll-transition.js)

   - Shown once right after login (the page first opens), when the user presses Exit on a
     dashboard (window.dxWelcome.show), and again after IDLE_MS (10 min) without activity.
   - Activity = click, pointerdown, touchstart, keydown, wheel.  Mouse movement alone does NOT count.
   - Sign out (everyone) and Admin Push / Data Uploader (admins only, same rule as the sidebar links)
     are buttons on the page. Clicking anywhere else, or any key, closes it with the curtain wipe
     and opens the FIRST dashboard of the list (Summary). Nothing is reloaded or reset: data
     loading and live sync keep running behind it.
   - While it is open: body.dx-welcome-open (scroll-transition.js hides its hint, drawer and dock
     and ignores wheel / touch switching).
   - prefers-reduced-motion: a plain fade instead of the wipe.
   - Not shown on the view-only wall screens (?view=gec, ?view=lexus): a kiosk must never be covered.
   ===================================================================== */
(function () {
  "use strict";
  if (window.__dxWelcome) return;
  window.__dxWelcome = true;

  /* ---------- settings ---------- */
  var IDLE_MS = 600000;            // 10 minutes without activity -> welcome page again
  var CHECK_MS = 1000;             // how often the idle time is checked
  var TZ = "Asia/Riyadh";
  var EXIT_MS = 1100;              // wipe-out (0.7s + 0.1s stagger + margin)
  var RED = "#eb0a1e";
  var INK = "#070d18";
  var ACTIVITY_EVENTS = ["click", "pointerdown", "touchstart", "keydown", "wheel"];   // no mousemove, on purpose

  var view = "";
  try { view = new URLSearchParams(location.search).get("view") || ""; } catch (e) { view = ""; }
  if (view === "gec" || view === "lexus") return;

  var reducedQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(reducedQuery && reducedQuery.matches); }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function reflow(el) { return el.offsetWidth; }
  function fmt(opts, date) {
    try { return new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: TZ }, opts)).format(date || new Date()); }
    catch (e) { return ""; }
  }
  function riyadhHour(date) {
    var h = parseInt(fmt({ hour: "numeric", hourCycle: "h23" }, date), 10);
    return isNaN(h) ? new Date().getHours() : h;
  }
  function greetingText() {
    var h = riyadhHour();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }
  function clockText() { return fmt({ hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); }
  function dateText() { return fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  function userName() {
    try {
      var A = window.ReportSheetAuth;
      var u = A && A.current && A.current();
      return u && u.name ? String(u.name) : "";
    } catch (e) { return ""; }
  }
  function lastUpdatedText() {
    try {
      var S = window.ReportSheetStore;
      var at = Number(S && S.readDataPushStamp && S.readDataPushStamp().at) || 0;
      if (!at) return "Last updated: waiting for Admin Push";
      var d = new Date(at);
      return "Last updated: " + fmt({ day: "2-digit", month: "short", year: "numeric" }, d) + " \u00b7 " +
        fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }, d) + " (Riyadh)";
    } catch (e) { return "Last updated: \u2014"; }
  }

  /* ---------- CSS ---------- */
  function injectCss() {
    if (document.getElementById("dx-welcome-css")) return;
    var css = [
      "#welcome-screen{position:fixed;inset:0;z-index:2147482600;font-family:Manrope,Outfit,'Segoe UI',system-ui,sans-serif;color:#fff;overflow:hidden;cursor:pointer;-webkit-tap-highlight-color:transparent;outline:none}",
      "#welcome-screen *{box-sizing:border-box}",
      ".ws-layer{position:absolute;inset:0;clip-path:inset(0);transition:clip-path .7s cubic-bezier(.76,0,.24,1)}",
      ".ws-red{background:" + RED + "}",
      ".ws-ink{background:radial-gradient(60% 55% at 10% 95%,rgba(235,10,30,.30),transparent 70%),radial-gradient(55% 55% at 92% 6%,rgba(46,112,255,.24),transparent 70%)," + INK + ";display:flex;flex-direction:column;justify-content:space-between;padding:clamp(18px,3.2vw,40px) 7vw clamp(22px,4vw,48px)}",
      ".ws-ink::before{content:'';position:absolute;width:60vmax;height:60vmax;left:-20vmax;bottom:-35vmax;border-radius:50%;background:radial-gradient(circle,rgba(235,10,30,.16),transparent 65%);animation:ws-float 9s ease-in-out infinite alternate;pointer-events:none}",
      "@keyframes ws-float{from{transform:translate(0,0)}to{transform:translate(8vw,-6vh)}}",
      ".ws-top{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px}",
      ".ws-brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.78)}",
      ".ws-brand img{width:36px;height:36px;object-fit:contain;background:#fff;border-radius:10px;padding:3px}",
      ".ws-live{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:rgba(255,255,255,.06);box-shadow:0 0 0 1px rgba(255,255,255,.1);font-weight:700;font-size:12px;letter-spacing:.04em;color:rgba(255,255,255,.78)}",
      ".ws-live i{width:8px;height:8px;border-radius:50%;background:#19c37d;box-shadow:0 0 10px rgba(25,195,125,.9)}",
      ".ws-mid{position:relative}",
      ".ws-greet{display:block;color:" + RED + ";font-weight:800;font-size:clamp(14px,1.5vw,20px);letter-spacing:.22em;text-transform:uppercase;padding-bottom:.7em}",
      ".ws-title{display:block;font-weight:800;font-size:clamp(40px,8vw,132px);letter-spacing:-.045em;line-height:1.02;overflow-wrap:anywhere}",
      ".ws-name{display:block;font-weight:600;font-size:clamp(16px,1.8vw,26px);letter-spacing:.04em;color:rgba(255,255,255,.7);padding:.7em 0 1em}",
      ".ws-clock{display:block;font-family:'Space Grotesk',Manrope,Outfit,system-ui,sans-serif;font-weight:700;font-size:clamp(44px,7.5vw,118px);letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums;color:#fff}",
      ".ws-date{display:block;font-weight:600;font-size:clamp(13px,1.4vw,19px);letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.6);padding-top:.8em}",
      ".ws-line{height:3px;width:min(260px,40vw);margin-top:22px;background:" + RED + ";transform-origin:left center}",
      ".ws-bottom{position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center}",
      ".ws-updated{font-weight:600;font-size:13px;letter-spacing:.06em;color:rgba(255,255,255,.55)}",
      ".ws-cue{font-weight:800;font-size:clamp(14px,1.4vw,18px);letter-spacing:.2em;text-transform:uppercase;color:#fff;animation:ws-pulse 2.2s ease-in-out infinite}",
      "@keyframes ws-pulse{0%,100%{opacity:.35;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}",
      /* sign out + quick access */
      ".ws-top-right{display:flex;align-items:center;gap:10px}",
      ".ws-btn{display:inline-flex;align-items:center;gap:9px;height:40px;padding:0 18px;border:0;border-radius:999px;font:800 12.5px/1 Manrope,Outfit,'Segoe UI',system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;cursor:pointer;color:#fff;transition:background .18s ease,transform .18s ease,box-shadow .18s ease}",
      ".ws-btn:focus-visible{outline:2px solid #fff;outline-offset:3px}",
      ".ws-signout{background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}",
      ".ws-signout:hover{background:rgba(235,10,30,.22);box-shadow:inset 0 0 0 1px rgba(235,10,30,.7)}",
      ".ws-body{position:relative;display:flex;align-items:flex-end;justify-content:space-between;gap:5vw}",
      ".ws-quick{flex:0 0 auto;width:min(330px,34vw);padding:18px;border-radius:22px;background:linear-gradient(160deg,rgba(255,255,255,.08),rgba(255,255,255,.025));box-shadow:inset 0 0 0 1px rgba(255,255,255,.1),0 30px 80px rgba(0,0,0,.35);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);cursor:default}",
      ".ws-quick-h{display:block;padding:0 4px 12px;font-weight:800;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.5)}",
      ".ws-quick a{display:flex;align-items:center;gap:14px;padding:14px;border-radius:14px;color:#fff;text-decoration:none;transition:background .18s ease,transform .18s ease}",
      ".ws-quick a + a{margin-top:6px}",
      ".ws-quick a:hover,.ws-quick a:focus-visible{background:rgba(255,255,255,.08);transform:translateX(4px);outline:none}",
      ".ws-quick a i{flex:0 0 auto;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-style:normal;font-size:19px;background:" + RED + ";box-shadow:0 10px 24px -10px rgba(235,10,30,.95)}",
      ".ws-quick a + a i{background:#1f3b78;box-shadow:0 10px 24px -10px rgba(46,112,255,.9)}",
      ".ws-quick a b{display:block;font-weight:800;font-size:15px;color:#fff}",
      ".ws-quick a small{display:block;padding-top:3px;font-weight:600;font-size:12px;color:rgba(255,255,255,.55)}",
      ".ws-quick a em{margin-left:auto;font-style:normal;font-weight:800;color:rgba(255,255,255,.4)}",
      "@media (max-width:820px){.ws-body{flex-direction:column;align-items:stretch}.ws-quick{width:auto}}",
      "@media (max-height:620px){.ws-clock{font-size:clamp(34px,6vw,70px)}.ws-title{font-size:clamp(34px,6vw,90px)}}",
      /* enter: first open fades in, returning from a dashboard (Exit) wipes in */
      "#welcome-screen.ws-enter{animation:ws-in .45s ease both}",
      "@keyframes ws-in{from{opacity:0}to{opacity:1}}",
      "#welcome-screen.ws-pre .ws-red,#welcome-screen.ws-pre .ws-ink{clip-path:inset(100% 0 0 0);transition:none}",
      "#welcome-screen.ws-wipe .ws-ink{transition-delay:.1s}",
      "#welcome-screen.ws-pre .ws-top,#welcome-screen.ws-pre .ws-body,#welcome-screen.ws-pre .ws-bottom{opacity:0;transform:translateY(24px)}",
      "#welcome-screen.ws-wipe .ws-top,#welcome-screen.ws-wipe .ws-body,#welcome-screen.ws-wipe .ws-bottom{transition:opacity .5s ease .45s,transform .7s cubic-bezier(.16,1,.3,1) .45s}",
      /* leaving: dark layer first, red 0.1s later (same as scroll-transition.js) */
      "#welcome-screen.ws-out{pointer-events:auto}",
      "#welcome-screen.ws-out .ws-red,#welcome-screen.ws-out .ws-ink{clip-path:inset(0 0 100% 0)}",
      "#welcome-screen.ws-out .ws-red{transition-delay:.1s}",
      "#welcome-screen.ws-out .ws-body,#welcome-screen.ws-out .ws-top,#welcome-screen.ws-out .ws-bottom{opacity:0;transform:translateY(-14px);transition:opacity .3s ease,transform .45s ease}",
      "#welcome-screen.ws-fade{transition:opacity .35s ease;opacity:0}",
      "@media (prefers-reduced-motion:reduce){.ws-ink::before,.ws-cue{animation:none !important}.ws-layer{transition:none !important}}",
      "@media (max-width:640px){.ws-brand{font-size:11px}.ws-live{font-size:11px}}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "dx-welcome-css";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- state ---------- */
  var root = null;
  var open = false;
  var closing = false;
  var lastActivity = Date.now();
  var clockTimer = 0;
  var clockEl = null;
  var dateEl = null;

  function tick() {
    if (clockEl) clockEl.textContent = clockText();
    if (dateEl) dateEl.textContent = dateText();
  }

  function isAdminUser() {
    try {
      var A = window.ReportSheetAuth;
      return !!(A && A.isAdmin && A.isAdmin(A.current && A.current()));   // same rule as #nav-admin-push
    } catch (e) { return false; }
  }
  function firstTab() {
    return document.querySelector("#panel-tabs [data-panel]");
  }
  function cueText() {
    var b = firstTab();
    var lab = b && b.querySelector(".side-nav-label");
    var text = b ? ((lab ? lab.textContent : b.getAttribute("title") || b.textContent) || "").replace(/\s+/g, " ").trim() : "";
    return text ? "Click anywhere to open " + text : "Click anywhere to continue";
  }
  /* behind the closing welcome page: always start again from the first dashboard (Summary) */
  function openFirstDashboard() {
    var b = firstTab();
    if (!b || typeof window.switchReportPanel !== "function") return;
    if (!b.classList.contains("active")) {
      try { window.switchReportPanel(b.getAttribute("data-panel")); } catch (e) { /* ignore */ }
    }
    var els = document.querySelectorAll(".app-content, .app-main, #dashboard, #panel-" + b.getAttribute("data-panel"));
    for (var i = 0; i < els.length; i++) { try { els[i].scrollTop = 0; } catch (e2) { /* ignore */ } }
    try { (document.scrollingElement || document.documentElement).scrollTop = 0; } catch (e3) { /* ignore */ }
  }
  function signOut() {
    try {
      var A = window.ReportSheetAuth;
      if (A && typeof A.logout === "function") { A.logout(); return; }
    } catch (e) { /* ignore */ }
    var btn = document.getElementById("logout-btn");
    if (btn) btn.click();
  }

  var shownBefore = false;
  function show() {
    if (open || !document.body) return;
    injectCss();
    open = true;
    closing = false;

    var name = userName();
    var wipe = shownBefore && !reduced();
    shownBefore = true;
    root = document.createElement("div");
    root.id = "welcome-screen";
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Welcome");
    root.className = reduced() ? "" : wipe ? "ws-pre" : "ws-enter";
    var quick = isAdminUser()
      ? '<div class="ws-quick" data-ws-act="panel">' +
          '<span class="ws-quick-h">Quick access</span>' +
          '<a href="admin.html" data-ws-act="link"><i aria-hidden="true">\u2699</i><span><b>Admin Push</b><small>Push the latest files to everyone</small></span><em aria-hidden="true">\u2192</em></a>' +
          '<a href="data-uploader.html" data-ws-act="link"><i aria-hidden="true">\u21EA</i><span><b>Data Uploader</b><small>Upload and check data files</small></span><em aria-hidden="true">\u2192</em></a>' +
        "</div>"
      : "";
    root.innerHTML =
      '<div class="ws-layer ws-red"></div>' +
      '<div class="ws-layer ws-ink">' +
        '<div class="ws-top">' +
          '<div class="ws-brand"><img src="../images/logo/toyota.png" alt="" onerror="this.style.display=\'none\'"><span>TOYOTA \u00b7 ALJ Report Sheet</span></div>' +
          '<div class="ws-top-right">' +
            '<span class="ws-live"><i></i>LIVE</span>' +
            '<button type="button" class="ws-btn ws-signout" data-ws-act="signout"><span aria-hidden="true">\u21aa</span>Sign out</button>' +
          "</div>" +
        "</div>" +
        '<div class="ws-body">' +
          '<div class="ws-mid">' +
            '<span class="ws-greet">Welcome</span>' +
            '<span class="ws-title">' + esc(greetingText()) + "</span>" +
            (name ? '<span class="ws-name">' + esc(name) + "</span>" : '<span class="ws-name">&nbsp;</span>') +
            '<span class="ws-clock" id="ws-clock">' + esc(clockText()) + "</span>" +
            '<span class="ws-date" id="ws-date">' + esc(dateText()) + "</span>" +
            '<div class="ws-line"></div>' +
          "</div>" +
          quick +
        "</div>" +
        '<div class="ws-bottom">' +
          '<span class="ws-updated" id="ws-updated">' + esc(lastUpdatedText()) + "</span>" +
          '<span class="ws-cue" id="ws-cue">' + esc(cueText()) + "</span>" +
        "</div>" +
      "</div>";
    document.body.appendChild(root);
    if (wipe) {
      reflow(root);
      root.classList.add("ws-wipe");
      root.classList.remove("ws-pre");
    }
    document.body.classList.add("dx-welcome-open");
    window.addEventListener("wheel", onWheelBlock, { capture: true, passive: false });
    window.addEventListener("touchmove", onTouchMoveBlock, { capture: true, passive: false });
    clockEl = root.querySelector("#ws-clock");
    dateEl = root.querySelector("#ws-date");
    clearInterval(clockTimer);
    clockTimer = setInterval(function () {
      tick();
      var up = root && root.querySelector("#ws-updated");
      if (up) { var t = lastUpdatedText(); if (up.textContent !== t) up.textContent = t; }
      var cue = root && root.querySelector("#ws-cue");
      if (cue) { var c = cueText(); if (cue.textContent !== c) cue.textContent = c; }
    }, 1000);

    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* ignore */ }
    try { root.focus({ preventScroll: true }); } catch (e2) { /* ignore */ }
  }

  function remove() {
    clearInterval(clockTimer);
    window.removeEventListener("wheel", onWheelBlock, { capture: true });
    window.removeEventListener("touchmove", onTouchMoveBlock, { capture: true });
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    clockEl = dateEl = null;
    open = false;
    closing = false;
    document.body.classList.remove("dx-welcome-open");
    lastActivity = Date.now();
    // charts / layouts underneath re-measure; nothing is reloaded or reset
    try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
  }

  function close() {
    if (!open || closing || !root) return;
    closing = true;
    // scroll-transition.js: the momentum of this scroll / click must not change dashboard
    window.__dxNoPullUntil = Date.now() + (reduced() ? 700 : EXIT_MS + 500);
    openFirstDashboard();
    if (reduced()) {
      root.classList.add("ws-fade");
      setTimeout(remove, 380);
      return;
    }
    root.classList.remove("ws-enter", "ws-wipe", "ws-pre");
    root.classList.add("ws-out");
    setTimeout(remove, EXIT_MS);
  }

  /* ---------- activity ---------- */
  function isModifierOnly(e) {
    var k = e.key;
    return k === "Shift" || k === "Control" || k === "Alt" || k === "Meta" || k === "AltGraph" || k === "CapsLock" || k === "OS";
  }
  function actionTarget(e) {
    var t = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement) || null;
    return t && t.closest && root && root.contains(t) ? t.closest("[data-ws-act]") : null;
  }
  function onActivity(e) {
    if (open) {
      // the welcome page owns every input while it is showing
      if (e.type === "wheel") { e.stopPropagation(); return; }   // (scrolling is blocked by onWheelBlock)
      var act = closing ? null : actionTarget(e);
      if (act) {
        // Sign out / Admin Push / Data Uploader (and the card around them) never close the page
        if (e.type === "click") {
          var kind = act.getAttribute("data-ws-act");
          if (kind === "signout") { e.preventDefault(); e.stopPropagation(); signOut(); }
          else if (kind === "link") e.stopPropagation();       // the link navigates normally
          else { e.preventDefault(); e.stopPropagation(); }
        }
        return;
      }
      if (e.type === "keydown") {
        if (isModifierOnly(e)) return;
        if (e.key === "Tab") return;                          // move between Sign out / quick links
        if (e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key || "")) return;   // reload, devtools, shortcuts keep working
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (e.type === "click" || e.type === "pointerdown" || e.type === "touchstart") {
        if (e.type === "click") { e.preventDefault(); e.stopPropagation(); }
        close();
      }
      return;
    }
    lastActivity = Date.now();
  }

  /* non-passive wheel/touch-move blocker, attached only while the welcome page is open */
  function onWheelBlock(e) { e.preventDefault(); e.stopPropagation(); }
  function onTouchMoveBlock(e) { e.preventDefault(); }

  function idleCheck() {
    if (open) return;
    if (Date.now() - lastActivity >= IDLE_MS) show();
  }

  function init() {
    ACTIVITY_EVENTS.forEach(function (name) {
      window.addEventListener(name, onActivity, { capture: true, passive: true });
    });
    setInterval(idleCheck, CHECK_MS);
    show();     // once when the page first opens
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.dxWelcome = { show: show, close: close };
})();
