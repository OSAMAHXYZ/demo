/* =====================================================================
   scroll-transition.js  ·  full-screen dashboards + gear-shift transition between them
   Load with:  <script src="scroll-transition.js"></script>  (just before </body>)

   - Full screen: body.dx-fs hides the sidebar + top bar, every dashboard fills the viewport.
   - Keep scrolling past the end of a dashboard -> gear-shift curtain -> next / previous dashboard.
     The curtain shows an H-pattern gearbox: the knob goes through neutral into the gear of the
     dashboard being opened (gear number = position in the list).
   - Right edge: move the mouse to the right edge of the screen -> drawer with every dashboard,
     Refresh / theme, Admin Push + Data Uploader (admins only) and Exit.
   - Bottom-left dock: Exit (back to the welcome page) + Dashboards (opens the drawer, for touch).
   - Order of the dashboards = the order of #panel-tabs [data-panel] (PANEL_DEFS in index.html).
   - window.dxGoToPanel(id): plays the same curtain and opens dashboard `id`.
   - Touches no existing logic: it only calls window.switchReportPanel(id), clicks the existing
     top-bar buttons (#run-btn, #theme-toggle) and reads the DOM.
   - Wall screens (?view=gec, ?view=lexus) keep their own layout: no full screen, drawer or dock.
   - prefers-reduced-motion: switches instantly, no animation.
   ===================================================================== */
(function () {
  "use strict";
  if (window.__dxScrollTransition) return;
  window.__dxScrollTransition = true;

  /* ---------- settings ---------- */
  var WHEEL_PULL = 1;          // ONE wheel scroll past the end changes dashboard
  var GESTURE_GAP_MS = 150;    // the scroll must start after this much wheel silence (not a fling still running)
  var TOUCH_PULL = 200;        // finger drag needed (px)
  var WHEEL_CAP = 120;         // max delta counted per wheel event
  var END_IGNORE_MS = 0;       // no wait after reaching the end
  var IDLE_RESET_MS = 450;     // reset the pull after this long without input
  /* SPEED scales every transition time (the JS waits below and the injected CSS).
     1 = the original 3.2 s gear shift; 0.5 = about 1.6 s, same look, quicker switching. */
  var SPEED = 0.5;
  var COOLDOWN_MS = Math.round(700 * SPEED);   // pause after each transition
  var COVER_MS = Math.round(820 * SPEED);      // curtain fully covers the screen
  var HOLD_MS = Math.round(480 * SPEED);       // gear engages + the big type is read before the wipe out
  var EXIT_MS = Math.round(900 * SPEED);       // wipe-out (0.7s + 0.1s stagger + margin)
  var ENTER_MS = Math.round(1000 * SPEED);     // new panel entrance
  function scaleCssTimes(text) {
    return String(text).replace(/(^|[^A-Za-z0-9_.-])(\d*\.\d+|\d+)(ms|s)\b/g, function (m, pre, num, unit) {
      return pre + Math.round(parseFloat(num) * SPEED * 1000) / 1000 + unit;
    });
  }
  var EDGE_PX = 4;             // mouse this close to the right edge opens the drawer
  var EDGE_DWELL_MS = 90;      // ...after staying there this long
  var DOCK_PEEK_W = 280;       // mouse inside this bottom-left corner shows the Exit / Dashboards dock
  var DOCK_PEEK_H = 110;
  var dockPeek = false;
  var RED = "#eb0a1e";
  var INK = "#070d18";

  var KIOSK = false;
  try { var v = new URLSearchParams(location.search).get("view") || ""; KIOSK = v === "gec" || v === "lexus"; } catch (e) { KIOSK = false; }

  var HOSTS = {
    gec: "#gec-host",
    lexus: "#lexus-tracker-host",
    b2c: "#toyota-b2c-tracker-host",
    summary: "#sales-host"
  };
  var REVEAL_SEL = ".card, .sr-mock-card, .sr-kpi-card, .sr-emp-rail, .bo-kpi, .boe-kpi, .boe-breakdown, .pt-card, .ytd-card, .ytd-kpi, .ytd-trend, .rv-board-card, .rv-audit, .act-header, .kpi, " +
    ".act-filter-bar, .mv-wide-bar, .mv-tabs-bar, .bas-alloc-toolbar, .mv-table-col, .mv-detail";
  /* cards whose pieces reveal one by one instead of the whole card at once */
  var REVEAL_SKIP = ".bas-section-card";
  /* KPI numbers that count up from 0 when their card is revealed */
  var COUNT_SEL = ".bo-kpi .val, .sr-kpi-val, .boe-kpi-val, .ytd-kpi .val";
  var COUNT_MS = 900;
  var COUNT_RE = /^\s*\d[\d,]*(?:\s*\/\s*\d[\d,]*)*\s*$/;
  var WIDE_BODY = ["pbi-wide-open", "act-section-wide", "act-match-wide"];
  var OPEN_SEL = ".pbi-wide-backdrop.show, .emp-drawer.open, .bo-modal:not([hidden]), .pt-modal:not([hidden]), .pt-drawer:not([hidden])";
  var BLOCK_TARGET = "select, input, textarea, .app-sidebar, .app-topbar, .dx-menu, .dx-dock";

  var reducedQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(reducedQuery && reducedQuery.matches); }

  /* ---------- helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function reflow(el) { return el.offsetWidth; }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function welcomeOpen() { return document.body.classList.contains("dx-welcome-open"); }

  function getTabs() {
    var out = [];
    var buttons = document.querySelectorAll("#panel-tabs [data-panel]");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var lab = b.querySelector(".side-nav-label");
      var ico = b.querySelector(".side-nav-icon");
      out.push({
        id: b.getAttribute("data-panel"),
        label: ((lab ? lab.textContent : b.getAttribute("title") || b.textContent) || "").replace(/\s+/g, " ").trim(),
        icon: ico ? ico.textContent : "",
        active: b.classList.contains("active")
      });
    }
    return out;
  }
  function activeIndex(tabs) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].active) return i;
    return -1;
  }

  /* panel element + its overlay host. A host that lives INSIDE the panel is animated alone:
     a transform on its parent would turn that parent into the containing block of the
     position:fixed host and break the layout. */
  function targetsFor(id) {
    var panel = document.getElementById("panel-" + id);
    var host = HOSTS[id] ? $(HOSTS[id]) : null;
    var list = [];
    if (host && panel && panel.contains(host)) list.push(host);
    else {
      if (panel) list.push(panel);
      if (host) list.push(host);
    }
    return list;
  }

  function dashboardShown() {
    var d = document.getElementById("dashboard");
    return !!(d && d.classList.contains("show"));
  }
  function wideOpen() {
    for (var i = 0; i < WIDE_BODY.length; i++) if (document.body.classList.contains(WIDE_BODY[i])) return true;
    return !!$(OPEN_SEL);
  }
  function srSheetOpen() {
    var p = document.getElementById("panel-salesreport");
    return !!(p && p.hasAttribute("data-sr-sheet") && p.getAttribute("data-sr-sheet") !== "");
  }

  /* can any scrollable ancestor (or the page) still scroll in this direction? */
  function canScrollFurther(target, dir) {
    var el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    var root = document.scrollingElement || document.documentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      var cs = window.getComputedStyle(el);
      var oy = cs.overflowY;
      if ((oy === "auto" || oy === "scroll" || oy === "overlay") && el.scrollHeight > el.clientHeight + 1) {
        if (dir > 0 ? (el.scrollTop + el.clientHeight < el.scrollHeight - 2) : (el.scrollTop > 1)) return true;
      }
      el = el.parentElement;
    }
    // body used as the scroller (html is overflow:hidden)
    var bcs = window.getComputedStyle(document.body);
    var hcs = window.getComputedStyle(document.documentElement);
    if ((bcs.overflowY === "auto" || bcs.overflowY === "scroll") && hcs.overflowY === "hidden" &&
        document.body.scrollHeight > document.body.clientHeight + 1) {
      if (dir > 0 ? (document.body.scrollTop + document.body.clientHeight < document.body.scrollHeight - 2) : (document.body.scrollTop > 1)) return true;
    }
    // the page itself
    // (a viewport with overflow:hidden cannot be wheel-scrolled, so it never counts as "can still scroll")
    var vo = hcs.overflowY !== "visible" ? hcs.overflowY : bcs.overflowY;
    var top = root.scrollTop || window.pageYOffset || 0;
    var max = root.scrollHeight - window.innerHeight;
    if (max > 2 && vo !== "hidden" && vo !== "clip") {
      if (dir > 0 ? top < max - 2 : top > 1) return true;
    }
    return false;
  }

  /* ---------- CSS ---------- */
  function injectCss() {
    var F = "Manrope,Outfit,'Segoe UI',system-ui,sans-serif";
    var css = [
      /* full screen: sidebar + top bar hidden, every offset that used them collapses to 0 */
      "html body.dx-fs.live-app aside.app-sidebar#app-sidebar,html body.dx-fs .sidebar-backdrop,html body.dx-fs.live-app header.app-topbar{display:none !important}",
      "html body.dx-fs,html body.dx-fs *{--sidebar-w:0px !important;--sidebar-w-collapsed:0px !important;--eu-sidebar-w:0px !important;--topbar-h:0px !important}",
      "html body.dx-fs.live-app .app-main{margin-left:0 !important;width:100% !important;max-width:none !important}",

      /* curtain */
      ".dx-curtain{position:fixed;inset:0;z-index:2147483000;pointer-events:none;visibility:hidden;overflow:hidden}",
      ".dx-curtain.dx-on{visibility:visible;pointer-events:auto}",
      ".dx-curtain.dx-notrans *{transition:none !important}",
      ".dx-layer{position:absolute;inset:0;clip-path:inset(0 0 0 100%);transition:clip-path .7s cubic-bezier(.76,0,.24,1);will-change:clip-path}",
      ".dx-red{background:linear-gradient(100deg," + RED + " 0%,#b80716 100%)}",
      ".dx-ink{background:radial-gradient(60% 55% at 12% 92%,rgba(235,10,30,.26),transparent 70%),radial-gradient(55% 55% at 92% 8%,rgba(46,112,255,.2),transparent 70%)," + INK + ";display:flex;align-items:center;justify-content:space-between;gap:4vw;padding:0 7vw;box-sizing:border-box;overflow:hidden}",
      ".dx-inner{position:relative;z-index:1;min-width:0;font-family:" + F + ";color:#fff}",
      ".dx-mask{overflow:hidden;display:block}",
      ".dx-t{display:block;transform:translateY(110%);transition:transform .8s cubic-bezier(.16,1,.3,1)}",
      ".dx-count .dx-t{color:" + RED + ";font-weight:800;font-size:clamp(13px,1.4vw,18px);letter-spacing:.2em;padding:.2em 0 .9em;font-variant-numeric:tabular-nums}",
      ".dx-name .dx-t{font-size:clamp(42px,8vw,140px);font-weight:800;letter-spacing:-.045em;line-height:1;padding:.06em 0 .12em}",
      ".dx-kicker .dx-t{font-weight:600;font-size:clamp(12px,1.25vw,17px);letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.62);padding:.8em 0 1.1em}",
      ".dx-line{height:3px;width:min(260px,40vw);background:" + RED + ";transform:scaleX(0);transform-origin:left center;transition:transform .9s cubic-bezier(.16,1,.3,1)}",
      ".dx-text-in .dx-count .dx-t{transform:none;transition-delay:.12s}",
      ".dx-text-in .dx-name .dx-t{transform:none;transition-delay:.22s}",
      ".dx-text-in .dx-kicker .dx-t{transform:none;transition-delay:.36s}",
      ".dx-text-in .dx-line{transform:scaleX(1);transition-delay:.44s}",
      ".dx-text-out .dx-t{transform:translateY(-110%);transition:transform .55s cubic-bezier(.76,0,.24,1)}",
      ".dx-text-out .dx-name .dx-t{transition-delay:.05s}",
      ".dx-text-out .dx-kicker .dx-t{transition-delay:.1s}",
      ".dx-text-out .dx-line{transform:scaleX(0);transform-origin:right center;transition:transform .45s cubic-bezier(.76,0,.24,1)}",

      /* speed streaks behind the type */
      ".dx-speed{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .3s ease}",
      ".dx-on .dx-speed{opacity:1}",
      ".dx-rev .dx-speed{transform:scaleX(-1)}",
      ".dx-speed i{position:absolute;left:0;height:2px;width:22vw;border-radius:2px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);transform:translateX(110vw);animation:dx-streak .9s linear infinite}",
      ".dx-speed i:nth-child(3n){background:linear-gradient(90deg,transparent,rgba(235,10,30,.85),transparent);height:3px}",
      "@keyframes dx-streak{from{transform:translateX(110vw)}to{transform:translateX(-30vw)}}",

      /* H-pattern gearbox */
      ".dx-gearbox{position:relative;z-index:1;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:14px;font-family:" + F + ";color:#fff;opacity:0;transform:translateY(18px) scale(.96);transition:opacity .45s ease .15s,transform .6s cubic-bezier(.16,1,.3,1) .15s}",
      ".dx-text-in .dx-gearbox{opacity:1;transform:none}",
      ".dx-text-out .dx-gearbox{opacity:0;transform:translateY(-14px);transition:opacity .35s ease,transform .45s ease}",
      ".dx-gate{position:relative;border-radius:22px;background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.02)),#0b1222;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1),0 30px 80px rgba(0,0,0,.45)}",
      ".dx-slot{position:absolute;background:rgba(0,0,0,.55);box-shadow:inset 0 1px 3px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.06);border-radius:6px}",
      ".dx-gn{position:absolute;width:30px;margin-left:-15px;text-align:center;font-weight:800;font-size:12px;letter-spacing:.04em;color:rgba(255,255,255,.42);font-variant-numeric:tabular-nums;transition:color .2s ease,transform .25s ease}",
      ".dx-gn.dx-on-gear{color:" + RED + ";transform:scale(1.25);text-shadow:0 0 14px rgba(235,10,30,.8)}",
      ".dx-knob{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ff5a66,#eb0a1e 45%,#7a0410 100%);box-shadow:0 0 0 3px rgba(255,255,255,.12),0 0 22px rgba(235,10,30,.75),0 8px 18px rgba(0,0,0,.6);transition:left .22s cubic-bezier(.5,0,.2,1),top .2s cubic-bezier(.5,0,.2,1)}",
      ".dx-knob.dx-clunk{animation:dx-clunk .28s ease-out}",
      "@keyframes dx-clunk{0%{box-shadow:0 0 0 3px rgba(255,255,255,.12),0 0 22px rgba(235,10,30,.75),0 8px 18px rgba(0,0,0,.6)}40%{box-shadow:0 0 0 9px rgba(235,10,30,.25),0 0 40px rgba(235,10,30,1),0 8px 18px rgba(0,0,0,.6)}100%{box-shadow:0 0 0 3px rgba(255,255,255,.12),0 0 22px rgba(235,10,30,.75),0 8px 18px rgba(0,0,0,.6)}}",
      ".dx-gear-read{display:flex;align-items:baseline;gap:10px;font-weight:700;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,255,255,.55)}",
      ".dx-gear-read b{font-family:'Space Grotesk'," + F + ";font-size:34px;letter-spacing:-.02em;color:#fff;font-variant-numeric:tabular-nums}",
      "@media (max-width:820px){.dx-gearbox{display:none}}",

      /* panel leave / enter (never on .app-main) */
      ".dx-leave{transform-origin:50% 50% !important;transform:translateX(-8vw) scale(.94) !important;opacity:.2 !important;filter:blur(3px);transition:transform .8s cubic-bezier(.76,0,.24,1),opacity .8s cubic-bezier(.76,0,.24,1),filter .8s ease !important;will-change:transform,opacity}",
      ".dx-leave.dx-back{transform:translateX(8vw) scale(.94) !important}",
      ".dx-pre{opacity:0 !important;transform:translateX(10vw) scale(.98) !important}",
      ".dx-pre.dx-back{transform:translateX(-10vw) scale(.98) !important}",
      ".dx-enter{animation:dx-enter 1s cubic-bezier(.22,1,.36,1) both !important}",
      ".dx-enter.dx-back{animation-name:dx-enter-back !important}",
      "@keyframes dx-enter{from{opacity:0;transform:translateX(10vw) scale(.98)}to{opacity:1;transform:none}}",
      "@keyframes dx-enter-back{from{opacity:0;transform:translateX(-10vw) scale(.98)}to{opacity:1;transform:none}}",

      /* pull hint */
      ".dx-hint{position:fixed;left:50%;bottom:26px;z-index:2147482000;display:flex;align-items:center;gap:12px;padding:10px 18px 10px 10px;border-radius:999px;background:rgba(8,14,26,.82);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#fff;font:600 13px/1 " + F + ";box-shadow:0 14px 40px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.08);opacity:0;transform:translate(-50%,16px);pointer-events:none;transition:opacity .25s ease,transform .3s cubic-bezier(.22,1,.36,1);overflow:hidden}",
      ".dx-hint.dx-up{bottom:auto;top:22px;transform:translate(-50%,-16px)}",
      ".dx-hint.dx-show{opacity:1;transform:translate(-50%,0)}",
      ".dx-hint-arrow{flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:" + RED + ";display:grid;place-items:center;font-size:15px;font-weight:800;box-shadow:0 0 14px rgba(235,10,30,.55)}",
      ".dx-hint.dx-up .dx-hint-arrow{transform:rotate(180deg)}",
      ".dx-hint-text{color:rgba(255,255,255,.7);font-weight:600;letter-spacing:.02em}",
      ".dx-hint-label{font-weight:800;letter-spacing:.01em}",
      ".dx-hint-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.08)}",
      ".dx-hint-bar u{display:block;height:100%;width:0;background:" + RED + ";text-decoration:none;box-shadow:0 0 10px rgba(235,10,30,.8)}",

      /* hidden while the welcome page is open */
      "body.dx-welcome-open .dx-hint,body.dx-welcome-open .dx-menu,body.dx-welcome-open .dx-dock,body.dx-welcome-open .dx-edge-glow{display:none !important}",

      /* right-edge glow (shows the drawer is there) */
      ".dx-edge-glow{position:fixed;right:0;top:50%;width:4px;height:120px;margin-top:-60px;z-index:2147482700;border-radius:4px 0 0 4px;background:linear-gradient(180deg,transparent," + RED + ",transparent);opacity:.35;pointer-events:none;transition:opacity .25s ease,width .25s ease}",
      ".dx-edge-glow.dx-hot{opacity:1;width:7px}",
      "@media (hover:none),(pointer:coarse){.dx-edge-glow{display:none}}",

      /* right drawer */
      ".dx-menu{position:fixed;right:0;top:0;bottom:0;z-index:2147482900;width:min(340px,calc(100vw - 32px));display:flex;flex-direction:column;box-sizing:border-box;padding:18px 14px 14px;border-radius:22px 0 0 22px;background:rgba(9,15,28,.9);-webkit-backdrop-filter:blur(20px) saturate(1.25);backdrop-filter:blur(20px) saturate(1.25);box-shadow:-30px 0 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);font-family:" + F + ";color:#eef3fa;transform:translateX(105%);visibility:hidden;transition:transform .42s cubic-bezier(.22,1,.36,1),visibility 0s linear .42s}",
      ".dx-menu.dx-open{transform:none;visibility:visible;transition:transform .42s cubic-bezier(.22,1,.36,1),visibility 0s}",
      ".dx-menu-head{display:flex;align-items:center;gap:10px;padding:0 6px 4px;font-weight:800;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.62)}",
      ".dx-menu-head i{width:8px;height:8px;border-radius:50%;background:" + RED + ";box-shadow:0 0 12px rgba(235,10,30,.8)}",
      ".dx-menu-user{padding:0 6px 14px;font-weight:600;font-size:12.5px;color:rgba(255,255,255,.5)}",
      ".dx-menu-label{padding:8px 8px 6px;font-weight:800;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.4)}",
      ".dx-menu-list{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:3px;scrollbar-width:thin;scrollbar-color:rgba(148,163,184,.3) transparent}",
      ".dx-menu-item{display:flex;align-items:center;gap:12px;width:100%;padding:9px 10px;border:0;border-radius:11px;background:transparent;color:#d6dfec;font:700 13.5px/1.2 " + F + ";text-align:left;text-decoration:none;cursor:pointer;opacity:0;transform:translateX(18px);transition:background .15s ease,color .15s ease,opacity .3s ease,transform .4s cubic-bezier(.22,1,.36,1);box-sizing:border-box}",
      ".dx-menu.dx-open .dx-menu-item{opacity:1;transform:none;transition-delay:0s,0s,calc(var(--i,0) * 22ms),calc(var(--i,0) * 22ms)}",
      ".dx-menu-item:hover,.dx-menu-item:focus-visible{background:rgba(255,255,255,.08);color:#fff;outline:none}",
      ".dx-menu-item.dx-current{background:" + RED + ";color:#fff;box-shadow:0 8px 22px -10px rgba(235,10,30,.9)}",
      ".dx-menu-item[disabled]{opacity:.4 !important;cursor:default}",
      ".dx-menu-ico{flex:0 0 auto;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.07);font-size:13px;font-weight:800}",
      ".dx-menu-gear{flex:0 0 auto;margin-left:auto;font-weight:800;font-size:11px;letter-spacing:.06em;color:rgba(255,255,255,.35);font-variant-numeric:tabular-nums}",
      ".dx-menu-item.dx-current .dx-menu-ico{background:rgba(255,255,255,.2)}",
      ".dx-menu-item.dx-current .dx-menu-gear{color:rgba(255,255,255,.85)}",
      ".dx-menu-foot{flex:0 0 auto;display:flex;flex-direction:column;gap:3px;padding-top:10px;margin-top:8px;border-top:1px solid rgba(255,255,255,.1)}",
      ".dx-menu-row{display:grid;grid-template-columns:1fr 1fr;gap:6px}",
      ".dx-menu-row .dx-menu-item{justify-content:center;background:rgba(255,255,255,.05)}",
      ".dx-menu-exit{justify-content:center;margin-top:6px;background:rgba(235,10,30,.14) !important;color:#fff;box-shadow:inset 0 0 0 1px rgba(235,10,30,.5)}",
      ".dx-menu-exit:hover{background:" + RED + " !important}",
      ".dx-menu-status{padding:8px 6px 0;font-weight:600;font-size:11.5px;color:rgba(255,255,255,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",

      /* bottom-left dock */
      ".dx-dock{position:fixed;left:14px;bottom:14px;z-index:2147482500;display:flex;gap:6px;padding:5px;border-radius:999px;background:rgba(8,14,26,.72);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);box-shadow:0 12px 34px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.09);opacity:.55;transition:opacity .2s ease,transform .3s cubic-bezier(.22,1,.36,1)}",
      ".dx-dock:hover,.dx-dock:focus-within{opacity:1}",
      ".dx-dock.dx-hide{opacity:0;pointer-events:none;transform:translateY(20px)}",
      "@media (hover:hover) and (pointer:fine){.dx-dock:not(.dx-hide){opacity:0;pointer-events:none;transform:translateY(14px)}body.dx-dock-peek .dx-dock:not(.dx-hide),.dx-dock:not(.dx-hide):focus-within{opacity:1;pointer-events:auto;transform:none}}",
      ".dx-dock button{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 13px;border:0;border-radius:999px;background:transparent;color:#fff;font:800 12px/1 " + F + ";letter-spacing:.06em;text-transform:uppercase;cursor:pointer;transition:background .15s ease}",
      ".dx-dock button:hover,.dx-dock button:focus-visible{background:rgba(255,255,255,.1);outline:none}",
      ".dx-dock .dx-dock-exit{background:" + RED + ";box-shadow:0 6px 16px -6px rgba(235,10,30,.9)}",
      ".dx-dock .dx-dock-exit:hover{background:#ff2235}",
      "@media print{.dx-dock,.dx-menu,.dx-edge-glow,.dx-hint,.dx-curtain{display:none !important}}",

      "@media (prefers-reduced-motion:reduce){.dx-menu,.dx-menu-item,.dx-dock{transition:none !important}}",
      /* card reveal: individual `translate` property so hover lifts (transform) keep working */
      ".dx-rv.dx-rv{opacity:0;translate:0 38px}",
      ".dx-rv.dx-rv-in{animation:dx-rv .8s cubic-bezier(.22,1,.36,1) var(--dx-d,0ms) both}",
      "@keyframes dx-rv{from{opacity:0;translate:0 38px}to{opacity:1;translate:0 0}}",
      "@media (prefers-reduced-motion:reduce){.dx-curtain,.dx-hint{display:none !important}.dx-rv.dx-rv{opacity:1;translate:none}}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "dx-scroll-transition-css";
    st.textContent = scaleCssTimes(css);
    document.head.appendChild(st);
  }

  /* ---------- DOM ---------- */
  var curtain, red, ink, cCount, cName, hint, hintText, hintLabel, hintBar;
  var gate, knob, gearRead;

  function buildDom() {
    var streaks = "";
    for (var s = 0; s < 9; s++) {
      streaks += '<i style="top:' + (8 + s * 10.5).toFixed(1) + "%;animation-delay:-" + (s * 0.29 % 0.9).toFixed(2) + "s;width:" + (14 + (s * 7) % 18) + 'vw"></i>';
    }
    curtain = document.createElement("div");
    curtain.className = "dx-curtain";
    curtain.setAttribute("aria-hidden", "true");
    curtain.innerHTML =
      '<div class="dx-layer dx-red"></div>' +
      '<div class="dx-layer dx-ink">' +
        '<div class="dx-speed">' + streaks + "</div>" +
        '<div class="dx-inner">' +
          '<span class="dx-mask dx-count"><span class="dx-t">GEAR 01 \u00b7 OF 01</span></span>' +
          '<span class="dx-mask dx-name"><span class="dx-t">Dashboard</span></span>' +
          '<span class="dx-mask dx-kicker"><span class="dx-t">Shifting \u00b7 Toyota ALJ Report Sheet</span></span>' +
          '<div class="dx-line"></div>' +
        "</div>" +
        '<div class="dx-gearbox"><div class="dx-gate"></div><div class="dx-gear-read">Gear <b>1</b></div></div>' +
      "</div>";
    document.body.appendChild(curtain);
    red = $(".dx-red", curtain);
    ink = $(".dx-ink", curtain);
    cCount = $(".dx-count .dx-t", curtain);
    cName = $(".dx-name .dx-t", curtain);
    gate = $(".dx-gate", curtain);
    gearRead = $(".dx-gear-read b", curtain);

    hint = document.createElement("div");
    hint.className = "dx-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.innerHTML =
      '<span class="dx-hint-arrow">\u2193</span>' +
      '<span class="dx-hint-text">Keep scrolling \u00b7 next</span>' +
      '<span class="dx-hint-label"></span>' +
      '<i class="dx-hint-bar"><u></u></i>';
    document.body.appendChild(hint);
    hintText = $(".dx-hint-text", hint);
    hintLabel = $(".dx-hint-label", hint);
    hintBar = $(".dx-hint-bar u", hint);
  }

  /* ---------- gearbox ---------- */
  var GATE_COL = 58, GATE_PAD = 34, GATE_TOP = 30, GATE_MID = 92, GATE_BOT = 154, GATE_H = 184;
  var gateKey = "";
  var gateTimers = [];
  function gearPos(i) {
    return { x: GATE_PAD + Math.floor(i / 2) * GATE_COL, y: i % 2 ? GATE_BOT : GATE_TOP };
  }
  function paintGate(count) {
    var cols = Math.max(2, Math.ceil(count / 2));
    var key = String(count);
    if (key === gateKey) return;
    gateKey = key;
    var w = GATE_PAD * 2 + (cols - 1) * GATE_COL;
    gate.style.width = w + "px";
    gate.style.height = GATE_H + "px";
    var html = '<span class="dx-slot" style="left:' + (GATE_PAD - 4) + "px;top:" + (GATE_MID - 4) + "px;width:" + ((cols - 1) * GATE_COL + 8) + 'px;height:8px"></span>';
    for (var c = 0; c < cols; c++) {
      var x = GATE_PAD + c * GATE_COL;
      var hasTop = c * 2 < count, hasBot = c * 2 + 1 < count;
      var y1 = hasTop ? GATE_TOP : GATE_MID, y2 = hasBot ? GATE_BOT : GATE_MID;
      html += '<span class="dx-slot" style="left:' + (x - 4) + "px;top:" + (y1 - 4) + "px;width:8px;height:" + (y2 - y1 + 8) + 'px"></span>';
      if (hasTop) html += '<span class="dx-gn" data-g="' + (c * 2) + '" style="left:' + x + 'px;top:4px">' + (c * 2 + 1) + "</span>";
      if (hasBot) html += '<span class="dx-gn" data-g="' + (c * 2 + 1) + '" style="left:' + x + "px;top:" + (GATE_BOT + 14) + 'px">' + (c * 2 + 2) + "</span>";
    }
    html += '<span class="dx-knob"></span>';
    gate.innerHTML = html;
    knob = $(".dx-knob", gate);
  }
  function placeKnob(x, y, animate) {
    if (!animate) knob.style.transition = "none";
    knob.style.left = x + "px";
    knob.style.top = y + "px";
    if (!animate) { reflow(knob); knob.style.transition = ""; }
  }
  function markGear(i) {
    var nums = gate.querySelectorAll(".dx-gn");
    for (var n = 0; n < nums.length; n++) nums[n].classList.toggle("dx-on-gear", Number(nums[n].getAttribute("data-g")) === i);
  }
  /* knob: current gear -> neutral -> across the neutral line -> into the new gear */
  function shiftGears(from, to, count) {
    gateTimers.forEach(clearTimeout);
    gateTimers = [];
    paintGate(count);
    var a = gearPos(from), b = gearPos(to);
    placeKnob(a.x, a.y, false);
    markGear(from);
    gearRead.textContent = String(from + 1);
    knob.classList.remove("dx-clunk");
    gateTimers.push(setTimeout(function () { placeKnob(a.x, GATE_MID, true); markGear(-1); gearRead.textContent = "N"; }, 300 * SPEED));
    gateTimers.push(setTimeout(function () { placeKnob(b.x, GATE_MID, true); }, 520 * SPEED));
    gateTimers.push(setTimeout(function () { placeKnob(b.x, b.y, true); }, (a.x === b.x ? 560 : 780) * SPEED));
    gateTimers.push(setTimeout(function () {
      markGear(to);
      gearRead.textContent = String(to + 1);
      reflow(knob);
      knob.classList.add("dx-clunk");
    }, (a.x === b.x ? 760 : 980) * SPEED));
  }

  /* ---------- state ---------- */
  var busy = false;
  var exiting = false;
  var cooldownUntil = 0;
  var pull = 0;
  var pullDir = 0;
  var staleGesture = false;
  var lastWheelAt = 0;
  var wheelGap = 9999;
  var endSince = 0;
  var idleTimer = 0;
  var hintVisible = false;

  function resetPull() {
    pull = 0;
    pullDir = 0;
    endSince = 0;
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0; }
    hideHint();
  }
  function hideHint() {
    if (!hint) return;
    hintVisible = false;
    hint.classList.remove("dx-show");
    hintBar.style.width = "0";
  }
  function showHint(dir, label, ratio) {
    hint.classList.toggle("dx-up", dir < 0);
    hintText.textContent = "Keep scrolling \u00b7 " + (dir > 0 ? "next" : "previous");
    if (hintLabel.textContent !== label) hintLabel.textContent = label;
    hintBar.style.width = Math.max(0, Math.min(100, ratio * 100)).toFixed(1) + "%";
    if (!hintVisible) { hintVisible = true; hint.classList.add("dx-show"); }
  }

  /* ---------- input handling ---------- */
  function blocked(target, ev) {
    if (busy) return true;
    // welcome-screen.js owns the wheel while it is open and for a moment after it closes
    if (welcomeOpen()) return true;
    if (window.__dxNoPullUntil && Date.now() < window.__dxNoPullUntil) return true;
    if (!dashboardShown()) return true;
    for (var i = 0; i < WIDE_BODY.length; i++) if (document.body.classList.contains(WIDE_BODY[i])) return true;
    if ($(OPEN_SEL)) return true;
    if (srSheetOpen()) return true;
    var el = target && target.nodeType === 1 ? target : (target && target.parentElement) || null;
    if (el && el.closest && el.closest(BLOCK_TARGET)) return true;
    if (ev && ev.ctrlKey) return true;
    return false;
  }

  /* delta: positive = scrolling down. weight: delta already converted to "wheel pixels". */
  function onPullInput(delta, target, ev, opts) {
    var t = now();
    if (blocked(target, ev)) { if (pull || hintVisible || endSince) resetPull(); return; }
    var dir = delta > 0 ? 1 : -1;
    if (canScrollFurther(target, dir)) { if (pull || hintVisible || endSince) resetPull(); return; }

    var tabs = getTabs();
    var idx = activeIndex(tabs);
    var next = tabs[idx + dir];
    if (idx < 0 || !next) { if (pull || hintVisible || endSince) resetPull(); return; }

    // new pull: first time at the end, direction change, or a pause
    if (!endSince || dir !== pullDir) {
      pull = 0;
      pullDir = dir;
      endSince = t;
      // a wheel burst that was still scrolling when it hit the end (fast spin / trackpad fling)
      // is not a new intent: only a fresh scroll after a short pause changes dashboard
      staleGesture = !opts.touch && wheelGap < GESTURE_GAP_MS;
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(resetPull, IDLE_RESET_MS);

    if (staleGesture) return;
    if (t - endSince < END_IGNORE_MS) return;
    if (t < cooldownUntil) return;

    pull += Math.abs(delta);
    var need = opts.need;
    if (!reduced() && need > 1) showHint(dir, next.label, pull / need);
    if (pull >= need) {
      resetPull();
      goTo(idx + dir, dir);
    }
  }

  function onWheel(e) {
    if (e.defaultPrevented) return;
    var dx = e.deltaX, dy = e.deltaY;
    if (!dy || Math.abs(dx) > Math.abs(dy)) return;           // mostly horizontal
    var mult = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? window.innerHeight : 1);
    var d = dy * mult;
    d = Math.sign(d) * Math.min(WHEEL_CAP, Math.abs(d));
    var t = now();
    wheelGap = t - lastWheelAt;
    lastWheelAt = t;
    onPullInput(d, e.target, e, { need: WHEEL_PULL, touch: false });
  }

  var touch = null;
  function onTouchStart(e) {
    if (!e.touches || e.touches.length !== 1) { touch = null; return; }
    var p = e.touches[0];
    touch = { x: p.clientX, y: p.clientY, lastY: p.clientY, target: e.target };
  }
  function onTouchMove(e) {
    if (!touch || !e.touches || e.touches.length !== 1) return;
    var p = e.touches[0];
    var totalX = Math.abs(p.clientX - touch.x);
    var totalY = Math.abs(p.clientY - touch.y);
    var step = touch.lastY - p.clientY;                       // finger up = scroll down
    touch.lastY = p.clientY;
    if (totalX > totalY || !step) return;                     // mostly horizontal
    onPullInput(step, touch.target, e, { need: TOUCH_PULL, touch: true });
  }
  function onTouchEnd() {
    touch = null;
    if (pull || hintVisible) resetPull();
  }

  /* ---------- the transition ---------- */
  function setLayers(clip, redDelay, inkDelay, animate) {
    if (!animate) curtain.classList.add("dx-notrans");
    red.style.transitionDelay = redDelay;
    ink.style.transitionDelay = inkDelay;
    red.style.clipPath = clip;
    ink.style.clipPath = clip;
    if (!animate) { reflow(curtain); curtain.classList.remove("dx-notrans"); }
  }
  function resetScrolls(id) {
    var els = [].slice.call(document.querySelectorAll(".app-content, .app-main, #dashboard"));
    targetsFor(id).forEach(function (el) { els.push(el); });
    var panel = document.getElementById("panel-" + id);
    if (panel) els.push(panel);
    els.forEach(function (el) { try { el.scrollTop = 0; } catch (e) { /* ignore */ } });
    try { (document.scrollingElement || document.documentElement).scrollTop = 0; } catch (e2) { /* ignore */ }
  }
  function fireResize() {
    try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
  }
  function clearClasses(list, names) {
    list.forEach(function (el) { names.forEach(function (n) { el.classList.remove(n); }); });
  }

  function goTo(index, dir) {
    if (busy) return Promise.resolve();
    var tabs = getTabs();
    var from = activeIndex(tabs);
    var to = tabs[index];
    if (!to || from < 0 || index === from) return Promise.resolve();
    var fromId = tabs[from].id;
    closeMenu();

    if (reduced()) {
      busy = true;
      try { window.switchReportPanel(to.id); } catch (e) { /* ignore */ }
      resetScrolls(to.id);
      fireResize();
      cooldownUntil = now() + COOLDOWN_MS;
      busy = false;
      return Promise.resolve();
    }

    busy = true;
    resetPull();
    syncChrome();
    var leaving = targetsFor(fromId);
    var fwd = dir > 0;
    // forward: the curtain drives in from the right and leaves to the left (backward: mirrored)
    var initial = fwd ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";
    var exit = fwd ? "inset(0 100% 0 0)" : "inset(0 0 0 100%)";

    cCount.textContent = "GEAR " + pad2(index + 1) + " \u00b7 OF " + pad2(tabs.length);
    cName.textContent = to.label;
    curtain.classList.toggle("dx-rev", !fwd);

    curtain.classList.remove("dx-text-in", "dx-text-out");
    setLayers(initial, "0s", "0s", false);
    curtain.classList.add("dx-on");
    reflow(curtain);
    shiftGears(from, index, tabs.length);

    // curtain wipes in (red first, ink 0.1s later) while the old panel slides away
    leaving.forEach(function (el) { el.classList.toggle("dx-back", !fwd); el.classList.add("dx-leave"); });
    setLayers("inset(0)", "0s", scaleCssTimes(".1s"), true);
    curtain.classList.add("dx-text-in");

    var entering = [];
    return wait(COVER_MS).then(function () {
      try { window.switchReportPanel(to.id); } catch (e) { /* ignore */ }
      clearClasses(leaving, ["dx-leave", "dx-back"]);
      entering = targetsFor(to.id);
      entering.forEach(function (el) { el.classList.toggle("dx-back", !fwd); el.classList.add("dx-pre"); });
      resetScrolls(to.id);
      fireResize();
      return wait(HOLD_MS);
    }).then(function () {
      // wipe out, continuing in the same direction; the type exits upward
      entering = targetsFor(to.id);
      entering.forEach(function (el) { el.classList.remove("dx-pre"); el.classList.toggle("dx-back", !fwd); el.classList.add("dx-enter"); });
      curtain.classList.remove("dx-text-in");
      curtain.classList.add("dx-text-out");
      setLayers(exit, scaleCssTimes(".1s"), "0s", true);
      exiting = true;
      scheduleScans();
      return wait(EXIT_MS);
    }).then(function () {
      curtain.classList.remove("dx-on", "dx-text-out");
      setLayers(initial, "0s", "0s", false);
      return wait(Math.max(0, ENTER_MS - EXIT_MS + 120));
    }).catch(function () { /* never leave the screen covered */ }).then(function () {
      clearClasses(leaving, ["dx-leave", "dx-back"]);
      clearClasses(entering, ["dx-pre", "dx-enter", "dx-back"]);
      curtain.classList.remove("dx-on", "dx-text-in", "dx-text-out");
      fireResize();
      cooldownUntil = now() + COOLDOWN_MS;
      busy = false;
      exiting = false;
      resetPull();
      syncChrome();
      scheduleScans();
    });
  }

  /* Public entry for other scripts (drawer, welcome page): play the curtain and open dashboard `id`.
     Same path as scrolling past the end, so the order always follows #panel-tabs [data-panel]. */
  window.dxGoToPanel = function (id) {
    var tabs = getTabs();
    var to = -1;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) { to = i; break; }
    var from = activeIndex(tabs);
    if (to < 0 || to === from) return Promise.resolve();
    if (from < 0) {                                   // nothing active yet: plain switch
      try { window.switchReportPanel(id); } catch (e) { /* ignore */ }
      return Promise.resolve();
    }
    return goTo(to, to > from ? 1 : -1);
  };
  window.dxCurtainBusy = function () { return busy; };

  /* ---------- card reveal ---------- */
  var io = null;
  var scanTimers = [];
  function revealRoots() {
    var tabs = getTabs();
    var i = activeIndex(tabs);
    if (i < 0) return [];
    var id = tabs[i].id;
    var roots = [];
    var p = document.getElementById("panel-" + id);
    if (p) roots.push(p);
    if (HOSTS[id]) { var h = $(HOSTS[id]); if (h && roots.indexOf(h) < 0) roots.push(h); }
    return roots;
  }
  function onIntersect(entries) {
    var step = 0;
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      var el = en.target;
      io.unobserve(el);
      if (el.hasAttribute("data-dx-seen")) return;
      el.setAttribute("data-dx-seen", "1");
      el.style.setProperty("--dx-d", Math.min(step, 7) * 70 + "ms");
      step++;
      el.classList.add("dx-rv-in");
      countUpIn(el);
      setTimeout(function () {
        el.classList.remove("dx-rv", "dx-rv-in");
        el.style.removeProperty("--dx-d");
      }, 1700);
    });
  }
  function scan() {
    if (reduced() || !("IntersectionObserver" in window)) return;
    if (busy && !exiting) return;   // the new panel is still behind the curtain: reveal once it opens
    if (!io) io = new IntersectionObserver(onIntersect, { threshold: 0.06, rootMargin: "0px 0px -4% 0px" });
    revealRoots().forEach(function (root) {
      var els = root.querySelectorAll(REVEAL_SEL);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.matches(REVEAL_SKIP)) continue;
        if (el.hasAttribute("data-dx-seen") || el.classList.contains("dx-rv")) continue;
        el.classList.add("dx-rv");
        io.observe(el);
      }
    });
  }

  /* ---------- KPI count-up ---------- */
  /* Only plain numbers ("1,284", "842 / 442") count; %, dates and words stay as they are.
     The exact original text is put back at the end. Stops if the page rewrites the number meanwhile. */
  function countUp(el) {
    if (reduced() || !el || el.children.length || el.hasAttribute("data-dx-counting")) return;
    var original = el.textContent;
    if (!COUNT_RE.test(original)) return;
    var parts = original.split(/(\d[\d,]*)/);
    var nums = [];
    for (var i = 1; i < parts.length; i += 2) {
      nums.push({ at: i, n: Number(parts[i].replace(/,/g, "")), comma: parts[i].indexOf(",") >= 0 });
    }
    var any = false;
    for (var k = 0; k < nums.length; k++) if (nums[k].n > 0) any = true;
    if (!any) return;
    el.setAttribute("data-dx-counting", "1");
    var start = now();
    var written = null;
    function frame() {
      if (written !== null && el.textContent !== written) { el.removeAttribute("data-dx-counting"); return; }
      var p = Math.min(1, (now() - start) / COUNT_MS);
      if (p >= 1) {
        el.textContent = original;
        el.removeAttribute("data-dx-counting");
        return;
      }
      var e = 1 - Math.pow(1 - p, 3);
      var out = parts.slice();
      for (var j = 0; j < nums.length; j++) {
        var v = Math.round(nums[j].n * e);
        out[nums[j].at] = nums[j].comma ? v.toLocaleString("en-US") : String(v);
      }
      written = out.join("");
      el.textContent = written;
      requestAnimationFrame(frame);
    }
    frame();
  }
  function countUpIn(el) {
    if (reduced()) return;
    if (el.matches(COUNT_SEL)) countUp(el);
    var inner = el.querySelectorAll(COUNT_SEL);
    for (var i = 0; i < inner.length; i++) countUp(inner[i]);
  }

  function scheduleScans() {
    scanTimers.forEach(clearTimeout);
    scanTimers = [60, 400, 1300].map(function (ms) { return setTimeout(scan, ms); });
  }

  /* ---------- right drawer ---------- */
  var menu, menuList, menuFoot, menuUser, menuStatus, edgeGlow, dock;
  var menuOpen = false, menuCloseTimer = 0, edgeTimer = 0;

  function currentUser() {
    try { var A = window.ReportSheetAuth; return (A && A.current && A.current()) || null; } catch (e) { return null; }
  }
  function isAdminUser() {
    try {
      var A = window.ReportSheetAuth;
      return !!(A && A.isAdmin && A.isAdmin(currentUser()));   // same rule as #nav-admin-push
    } catch (e) { return false; }
  }
  function topbarButton(id) {
    var b = document.getElementById(id);
    if (!b || b.hidden || b.style.display === "none") return null;
    return b;
  }
  function exitToWelcome() {
    closeMenu();
    if (window.dxWelcome && typeof window.dxWelcome.show === "function") window.dxWelcome.show();
  }

  function paintMenu() {
    var tabs = getTabs();
    var html = "";
    tabs.forEach(function (t, i) {
      html += '<button type="button" class="dx-menu-item' + (t.active ? " dx-current" : "") + '" style="--i:' + i + '" data-go="' + escHtml(t.id) + '"' + (t.active ? ' aria-current="page"' : "") + ">" +
        '<span class="dx-menu-ico" aria-hidden="true">' + escHtml(t.icon || "\u2022") + "</span><span>" + escHtml(t.label) + "</span>" +
        '<span class="dx-menu-gear">' + pad2(i + 1) + "</span></button>";
    });
    if (!tabs.length) html = '<div class="dx-menu-status" style="white-space:normal">No dashboards available yet.</div>';
    menuList.innerHTML = html;

    var n = tabs.length;
    var foot = "";
    var run = topbarButton("run-btn"), theme = topbarButton("theme-toggle");
    if (run || theme) {
      foot += '<div class="dx-menu-row">' +
        (run ? '<button type="button" class="dx-menu-item" style="--i:' + (n++) + '" data-act="refresh"' + (run.disabled ? " disabled" : "") + '><span class="dx-menu-ico" aria-hidden="true">\u21bb</span><span>Refresh</span></button>' : "") +
        (theme ? '<button type="button" class="dx-menu-item" style="--i:' + (n++) + '" data-act="theme"><span class="dx-menu-ico" aria-hidden="true">\u25d0</span><span>' + escHtml((theme.textContent || "Theme").trim()) + "</span></button>" : "") +
        "</div>";
    }
    if (isAdminUser()) {      // viewers never get these two links
      foot += '<div class="dx-menu-row">' +
        '<a class="dx-menu-item" style="--i:' + (n++) + '" href="admin.html"><span class="dx-menu-ico" aria-hidden="true">\u2699</span><span>Admin Push</span></a>' +
        '<a class="dx-menu-item" style="--i:' + (n++) + '" href="data-uploader.html"><span class="dx-menu-ico" aria-hidden="true">\u21EA</span><span>Data Uploader</span></a>' +
        "</div>";
    }
    foot += '<button type="button" class="dx-menu-item dx-menu-exit" style="--i:' + (n++) + '" data-act="exit"><span class="dx-menu-ico" aria-hidden="true">\u23cf</span><span>Exit to welcome</span></button>';
    menuFoot.innerHTML = foot;

    var u = currentUser();
    menuUser.textContent = u && u.name ? "Signed in as " + u.name : "";
    var st = document.getElementById("status");
    menuStatus.textContent = st ? (st.textContent || "").replace(/\s+/g, " ").trim() : "";
  }
  function openMenu() {
    if (welcomeOpen() || busy) return;
    clearTimeout(menuCloseTimer);
    menuCloseTimer = 0;
    if (menuOpen) return;
    paintMenu();
    menuOpen = true;
    menu.classList.add("dx-open");
    menu.setAttribute("aria-hidden", "false");
    edgeGlow.classList.add("dx-hot");
  }
  function closeMenu() {
    clearTimeout(menuCloseTimer);
    menuCloseTimer = 0;
    if (!menuOpen) return;
    menuOpen = false;
    menu.classList.remove("dx-open");
    menu.setAttribute("aria-hidden", "true");
    edgeGlow.classList.remove("dx-hot");
  }
  function closeMenuSoon() {
    clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(closeMenu, 320);       // grace period
  }

  function onMouseMove(e) {
    if (e.pointerType && e.pointerType !== "mouse") return;
    // Mouse users: the Exit / Dashboards dock only shows near the bottom-left corner,
    // so it no longer sits on top of footers and lists (touch screens keep it visible).
    var vh = document.documentElement.clientHeight || window.innerHeight;
    var nearDock = e.clientX <= DOCK_PEEK_W && e.clientY >= vh - DOCK_PEEK_H;
    if (nearDock !== dockPeek) {
      dockPeek = nearDock;
      document.body.classList.toggle("dx-dock-peek", nearDock);
    }
    var edge = (document.documentElement.clientWidth || window.innerWidth) - EDGE_PX;
    var atEdge = e.clientX >= edge && !e.buttons;        // never while dragging (scrollbars, selections)
    if (menuOpen) {
      if (menu.contains(e.target) || atEdge) { clearTimeout(menuCloseTimer); menuCloseTimer = 0; }
      else if (!menuCloseTimer) closeMenuSoon();
      return;
    }
    if (atEdge) {
      if (!edgeTimer) edgeTimer = setTimeout(function () { edgeTimer = 0; openMenu(); }, EDGE_DWELL_MS);
    } else if (edgeTimer) {
      clearTimeout(edgeTimer);
      edgeTimer = 0;
    }
  }

  function buildMenu() {
    edgeGlow = document.createElement("div");
    edgeGlow.className = "dx-edge-glow";
    edgeGlow.setAttribute("aria-hidden", "true");
    document.body.appendChild(edgeGlow);

    menu = document.createElement("nav");
    menu.className = "dx-menu";
    menu.setAttribute("aria-label", "Dashboards");
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML =
      '<div class="dx-menu-head"><i></i><span>Toyota \u00b7 ALJ Report Sheet</span></div>' +
      '<div class="dx-menu-user"></div>' +
      '<div class="dx-menu-label">Dashboards</div>' +
      '<div class="dx-menu-list"></div>' +
      '<div class="dx-menu-foot"></div>' +
      '<div class="dx-menu-status"></div>';
    menuList = menu.querySelector(".dx-menu-list");
    menuFoot = menu.querySelector(".dx-menu-foot");
    menuUser = menu.querySelector(".dx-menu-user");
    menuStatus = menu.querySelector(".dx-menu-status");
    document.body.appendChild(menu);

    dock = document.createElement("div");
    dock.className = "dx-dock";
    dock.innerHTML =
      '<button type="button" class="dx-dock-exit" data-act="exit" title="Back to the welcome page">\u23cf Exit</button>' +
      '<button type="button" data-act="menu" title="All dashboards (or move the mouse to the right edge)">\u2630 Dashboards</button>';
    document.body.appendChild(dock);

    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", function (e) {
      // leaving the window through the right edge also opens the drawer
      if (!menuOpen && e.clientX >= window.innerWidth - 2 && !e.buttons) openMenu();
    });
    menu.addEventListener("mouseenter", function () { clearTimeout(menuCloseTimer); menuCloseTimer = 0; });
    menu.addEventListener("mouseleave", closeMenuSoon);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menuOpen) closeMenu(); });
    document.addEventListener("pointerdown", function (e) {      // click / tap outside closes it
      if (menuOpen && !menu.contains(e.target) && !dock.contains(e.target)) closeMenu();
    }, true);

    function onAction(act, el) {
      if (act === "exit") { exitToWelcome(); return; }
      if (act === "menu") { if (menuOpen) closeMenu(); else openMenu(); return; }
      if (act === "refresh") { var r = topbarButton("run-btn"); if (r && !r.disabled) r.click(); closeMenu(); return; }
      if (act === "theme") {
        var t = topbarButton("theme-toggle");
        if (t) t.click();
        var lab = el && el.querySelector("span:last-child");
        if (lab && t) lab.textContent = (t.textContent || "Theme").trim();
      }
    }
    dock.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-act]") : null;
      if (b) onAction(b.getAttribute("data-act"), b);
    });
    menu.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-go]") : null;
      if (b) {
        var id = b.getAttribute("data-go");
        closeMenu();
        if (typeof window.dxGoToPanel === "function") window.dxGoToPanel(id);
        return;
      }
      var a = e.target.closest ? e.target.closest("[data-act]") : null;
      if (a) { if (!a.disabled) onAction(a.getAttribute("data-act"), a); return; }
      if (e.target.closest && e.target.closest("a")) closeMenu();
    });
  }

  /* dock hidden while the curtain runs or a full-screen modal / sheet is open */
  function syncChrome() {
    if (!dock) return;
    dock.classList.toggle("dx-hide", busy || wideOpen() || srSheetOpen());
    if (menuOpen) {
      var cur = menuList.querySelector(".dx-current");
      var tabs = getTabs();
      var i = activeIndex(tabs);
      if (!cur || (tabs[i] && cur.getAttribute("data-go") !== tabs[i].id)) paintMenu();
    }
  }

  /* ---------- init ---------- */
  function init() {
    injectCss();
    buildDom();
    if (!KIOSK) {
      document.body.classList.add("dx-fs");
      buildMenu();
    }

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });

    var tabsEl = document.getElementById("panel-tabs");
    if (tabsEl && window.MutationObserver) {
      new MutationObserver(function () {
        syncChrome();
        scheduleScans();
      }).observe(tabsEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
    setInterval(syncChrome, 400);   // modal / sheet open state changes without a tab change
    syncChrome();
    scheduleScans();
    fireResize();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
