/* =====================================================================
   welcome-screen.js  ·  full-screen welcome (#welcome-screen)
   Load with:  <script src="welcome-screen.js"></script>
   (just before </body>, AFTER scroll-transition.js)

   - Shown once when the page first opens, and again after IDLE_MS (10 min) without activity.
   - Activity = click, pointerdown, touchstart, keydown, wheel.  Mouse movement alone does NOT count.
   - Click, tap or any key closes it with the same red-then-dark curtain wipe as scroll-transition.js
     and shows the dashboard the user was on. Nothing is reloaded or reset: data loading and
     live sync keep running behind it. Presentation mode / full screen are never touched.
   - While it is open: body.dx-welcome-open (scroll-transition.js hides its hint + dot rail and
     ignores wheel / touch switching, the corner menu is hidden).
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
      /* enter */
      "#welcome-screen.ws-enter{animation:ws-in .45s ease both}",
      "@keyframes ws-in{from{opacity:0}to{opacity:1}}",
      /* leaving: dark layer first, red 0.1s later (same as scroll-transition.js) */
      "#welcome-screen.ws-out{pointer-events:auto}",
      "#welcome-screen.ws-out .ws-red,#welcome-screen.ws-out .ws-ink{clip-path:inset(0 0 100% 0)}",
      "#welcome-screen.ws-out .ws-red{transition-delay:.1s}",
      "#welcome-screen.ws-out .ws-mid,#welcome-screen.ws-out .ws-top,#welcome-screen.ws-out .ws-bottom{opacity:0;transform:translateY(-14px);transition:opacity .3s ease,transform .45s ease}",
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

  function show() {
    if (open || !document.body) return;
    injectCss();
    open = true;
    closing = false;

    var name = userName();
    root = document.createElement("div");
    root.id = "welcome-screen";
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Welcome");
    root.className = reduced() ? "" : "ws-enter";
    root.innerHTML =
      '<div class="ws-layer ws-red"></div>' +
      '<div class="ws-layer ws-ink">' +
        '<div class="ws-top">' +
          '<div class="ws-brand"><img src="../images/logo/toyota.png" alt="" onerror="this.style.display=\'none\'"><span>TOYOTA \u00b7 ALJ Report Sheet</span></div>' +
          '<span class="ws-live"><i></i>LIVE</span>' +
        "</div>" +
        '<div class="ws-mid">' +
          '<span class="ws-greet">Welcome</span>' +
          '<span class="ws-title">' + esc(greetingText()) + "</span>" +
          (name ? '<span class="ws-name">' + esc(name) + "</span>" : '<span class="ws-name">&nbsp;</span>') +
          '<span class="ws-clock" id="ws-clock">' + esc(clockText()) + "</span>" +
          '<span class="ws-date" id="ws-date">' + esc(dateText()) + "</span>" +
          '<div class="ws-line"></div>' +
        "</div>" +
        '<div class="ws-bottom">' +
          '<span class="ws-updated" id="ws-updated">' + esc(lastUpdatedText()) + "</span>" +
          '<span class="ws-cue">Click anywhere to continue</span>' +
        "</div>" +
      "</div>";
    document.body.appendChild(root);
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
    if (reduced()) {
      root.classList.add("ws-fade");
      setTimeout(remove, 380);
      return;
    }
    root.classList.remove("ws-enter");
    root.classList.add("ws-out");
    setTimeout(remove, EXIT_MS);
  }

  /* ---------- activity ---------- */
  function isModifierOnly(e) {
    var k = e.key;
    return k === "Shift" || k === "Control" || k === "Alt" || k === "Meta" || k === "AltGraph" || k === "CapsLock" || k === "OS";
  }
  function onActivity(e) {
    if (open) {
      // the welcome page owns every input while it is showing
      if (e.type === "wheel") { e.stopPropagation(); return; }   // (scrolling is blocked by onWheelBlock)
      if (e.type === "keydown") {
        if (isModifierOnly(e)) return;
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
