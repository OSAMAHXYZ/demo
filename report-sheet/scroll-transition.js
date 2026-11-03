/* =====================================================================
   scroll-transition.js  ·  WEAREBRAND-style scroll transition between dashboards
   Load with:  <script src="scroll-transition.js"></script>  (just before </body>)

   - Keep scrolling past the end of a dashboard -> red/ink curtain wipe -> next / previous dashboard
   - Pull hint pill, curtain with big type, card reveal, dot rail on the right edge
   - Order of the dashboards = the order of #panel-tabs [data-panel] (PANEL_DEFS in index.html).
   - window.dxGoToPanel(id): plays the same curtain and opens dashboard `id` (used by the corner menu).
   - Top-left corner menu: hover the 24x24 corner (or tap the corner tab on touch) -> dashboards list;
     Admin Push / Data Uploader are listed for admins only.
   - Touches no existing logic: it only calls window.switchReportPanel(id) and reads the DOM.
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
  var COOLDOWN_MS = 700;       // pause after each transition
  var COVER_MS = 820;          // curtain fully covers the screen
  var HOLD_MS = 380;           // let the big type be read before the wipe out
  var EXIT_MS = 900;           // wipe-out (0.7s + 0.1s stagger + margin)
  var ENTER_MS = 1000;         // new panel entrance
  var RED = "#eb0a1e";
  var INK = "#070d18";

  var HOSTS = {
    gec: "#gec-host",
    lexus: "#lexus-tracker-host",
    b2c: "#toyota-b2c-tracker-host",
    summary: "#sales-host"
  };
  var REVEAL_SEL = ".card, .sr-mock-card, .sr-kpi-card, .sr-emp-rail, .bo-kpi, .boe-kpi, .boe-breakdown, .pt-card, .ytd-card, .ytd-kpi, .ytd-trend, .rv-board-card, .rv-audit, .act-header, .kpi";
  var WIDE_BODY = ["pbi-wide-open", "act-section-wide", "act-match-wide"];
  var OPEN_SEL = ".pbi-wide-backdrop.show, .emp-drawer.open, .bo-modal:not([hidden]), .pt-modal:not([hidden]), .pt-drawer:not([hidden])";
  var BLOCK_TARGET = "select, input, textarea, .app-sidebar, .app-topbar, .dx-menu";

  var reducedQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(reducedQuery && reducedQuery.matches); }

  /* ---------- helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function reflow(el) { return el.offsetWidth; }

  function getTabs() {
    var out = [];
    var buttons = document.querySelectorAll("#panel-tabs [data-panel]");
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var lab = b.querySelector(".side-nav-label");
      out.push({
        id: b.getAttribute("data-panel"),
        label: ((lab ? lab.textContent : b.getAttribute("title") || b.textContent) || "").replace(/\s+/g, " ").trim(),
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
    var css = [
      /* curtain */
      ".dx-curtain{position:fixed;inset:0;z-index:2147483000;pointer-events:none;visibility:hidden;overflow:hidden}",
      ".dx-curtain.dx-on{visibility:visible;pointer-events:auto}",
      ".dx-curtain.dx-notrans *{transition:none !important}",
      ".dx-layer{position:absolute;inset:0;clip-path:inset(100% 0 0 0);transition:clip-path .7s cubic-bezier(.76,0,.24,1);will-change:clip-path}",
      ".dx-red{background:" + RED + "}",
      ".dx-ink{background:radial-gradient(60% 55% at 12% 92%,rgba(235,10,30,.26),transparent 70%),radial-gradient(55% 55% at 92% 8%,rgba(46,112,255,.2),transparent 70%)," + INK + ";display:flex;align-items:center}",
      ".dx-inner{padding:0 7vw;width:100%;box-sizing:border-box;font-family:Manrope,Outfit,'Segoe UI',system-ui,sans-serif;color:#fff}",
      ".dx-mask{overflow:hidden;display:block}",
      ".dx-t{display:block;transform:translateY(110%);transition:transform .8s cubic-bezier(.16,1,.3,1)}",
      ".dx-count .dx-t{color:" + RED + ";font-weight:800;font-size:clamp(13px,1.4vw,18px);letter-spacing:.2em;padding:.2em 0 .9em;font-variant-numeric:tabular-nums}",
      ".dx-name .dx-t{font-size:clamp(46px,9vw,150px);font-weight:800;letter-spacing:-.045em;line-height:1;padding:.06em 0 .12em}",
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
      /* panel leave / enter (never on .app-main) */
      ".dx-leave{transform-origin:50% 40% !important;transform:translateY(-6vh) scale(.94) !important;opacity:.25 !important;transition:transform .8s cubic-bezier(.76,0,.24,1),opacity .8s cubic-bezier(.76,0,.24,1) !important;will-change:transform,opacity}",
      ".dx-pre{opacity:0 !important;transform:translateY(9vh) scale(.98) !important}",
      ".dx-enter{animation:dx-enter 1s cubic-bezier(.22,1,.36,1) both !important}",
      "@keyframes dx-enter{from{opacity:0;transform:translateY(9vh) scale(.98)}to{opacity:1;transform:none}}",
      /* pull hint */
      ".dx-hint{position:fixed;left:50%;bottom:26px;z-index:2147482000;display:flex;align-items:center;gap:12px;padding:10px 18px 10px 10px;border-radius:999px;background:rgba(8,14,26,.82);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#fff;font:600 13px/1 Manrope,Outfit,'Segoe UI',system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.4),0 0 0 1px rgba(255,255,255,.08);opacity:0;transform:translate(-50%,16px);pointer-events:none;transition:opacity .25s ease,transform .3s cubic-bezier(.22,1,.36,1);overflow:hidden}",
      ".dx-hint.dx-up{bottom:auto;top:22px;transform:translate(-50%,-16px)}",
      ".dx-hint.dx-show{opacity:1;transform:translate(-50%,0)}",
      ".dx-hint-arrow{flex:0 0 auto;width:28px;height:28px;border-radius:50%;background:" + RED + ";display:grid;place-items:center;font-size:15px;font-weight:800;box-shadow:0 0 14px rgba(235,10,30,.55)}",
      ".dx-hint.dx-up .dx-hint-arrow{transform:rotate(180deg)}",
      ".dx-hint-text{color:rgba(255,255,255,.7);font-weight:600;letter-spacing:.02em}",
      ".dx-hint-label{font-weight:800;letter-spacing:.01em}",
      ".dx-hint-bar{position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.08)}",
      ".dx-hint-bar u{display:block;height:100%;width:0;background:" + RED + ";text-decoration:none;box-shadow:0 0 10px rgba(235,10,30,.8)}",
      /* dot rail */
      ".dx-rail{position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:2147400000;display:flex;flex-direction:column;align-items:flex-end;gap:11px;padding:10px 7px;border-radius:999px;background:rgba(8,14,26,.28);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:opacity .25s ease}",
      ".dx-rail.dx-hide{opacity:0;pointer-events:none;visibility:hidden}",
      ".dx-dot{position:relative;display:block;width:8px;height:8px;padding:0;border:0;border-radius:99px;background:rgba(140,152,175,.55);cursor:pointer;transition:height .35s cubic-bezier(.22,1,.36,1),background .25s ease,box-shadow .25s ease}",
      ".dx-dot:hover{background:rgba(255,255,255,.9)}",
      ".dx-dot.dx-active{height:26px;background:" + RED + ";box-shadow:0 0 12px rgba(235,10,30,.75)}",
      ".dx-dot::after{content:attr(data-label);position:absolute;right:20px;top:50%;transform:translate(6px,-50%);padding:6px 11px;border-radius:8px;background:rgba(8,14,26,.94);color:#fff;font:700 12px/1 Manrope,Outfit,'Segoe UI',system-ui,sans-serif;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .22s ease;box-shadow:0 8px 24px rgba(0,0,0,.35)}",
      ".dx-dot:hover::after,.dx-dot:focus-visible::after{opacity:1;transform:translate(0,-50%)}",
      ".dx-dot:focus-visible{outline:2px solid " + RED + ";outline-offset:3px}",
      "@media (max-width:899px){.dx-rail{display:none}}",
      "body.dx-welcome-open .dx-hint,body.dx-welcome-open .dx-rail,body.dx-welcome-open .dx-corner-zone,body.dx-welcome-open .dx-corner-tab,body.dx-welcome-open .dx-menu{display:none !important}",
      /* top-left corner menu (hover on desktop, corner tab on touch) */
      ".dx-corner-zone{position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147482800;background:transparent}",
      ".dx-corner-tab{display:none;position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147482800;padding:0;border:0;border-radius:0 0 12px 0;background:rgba(8,14,26,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;font:800 13px/1 Manrope,Outfit,'Segoe UI',system-ui,sans-serif;box-shadow:0 0 0 1px rgba(255,255,255,.1);cursor:pointer}",
      "@media (hover:none),(pointer:coarse){.dx-corner-zone{display:none}.dx-corner-tab{display:block}}",
      ".dx-menu{position:fixed;left:12px;top:12px;z-index:2147482900;width:min(300px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;padding:12px;border-radius:16px;background:rgba(9,15,28,.88);-webkit-backdrop-filter:blur(18px) saturate(1.2);backdrop-filter:blur(18px) saturate(1.2);box-shadow:0 24px 70px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.09);font-family:Manrope,Outfit,'Segoe UI',system-ui,sans-serif;color:#eef3fa;transform:translateX(-112%);opacity:0;visibility:hidden;transition:transform .38s cubic-bezier(.22,1,.36,1),opacity .25s ease,visibility 0s linear .38s}",
      ".dx-menu.dx-open{transform:none;opacity:1;visibility:visible;transition:transform .38s cubic-bezier(.22,1,.36,1),opacity .25s ease,visibility 0s}",
      ".dx-menu-head{display:flex;align-items:center;gap:10px;padding:2px 6px 12px;font-weight:800;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.62)}",
      ".dx-menu-head i{width:8px;height:8px;border-radius:50%;background:" + RED + ";box-shadow:0 0 12px rgba(235,10,30,.8)}",
      ".dx-menu-list{display:flex;flex-direction:column;gap:3px}",
      ".dx-menu-item{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:0;border-radius:10px;background:transparent;color:#d6dfec;font:700 13.5px/1.2 Manrope,Outfit,'Segoe UI',system-ui,sans-serif;text-align:left;text-decoration:none;cursor:pointer;transition:background .15s ease,color .15s ease}",
      ".dx-menu-item:hover,.dx-menu-item:focus-visible{background:rgba(255,255,255,.08);color:#fff;outline:none}",
      ".dx-menu-item.dx-current{background:" + RED + ";color:#fff;box-shadow:0 8px 22px -10px rgba(235,10,30,.9)}",
      ".dx-menu-ico{flex:0 0 auto;width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:rgba(255,255,255,.07);font-size:13px;font-weight:800}",
      ".dx-menu-item.dx-current .dx-menu-ico{background:rgba(255,255,255,.2)}",
      ".dx-menu-sep{height:1px;margin:8px 4px;background:rgba(255,255,255,.1)}",
      "@media (prefers-reduced-motion:reduce){.dx-menu{transition:none}}",
      /* card reveal: individual `translate` property so hover lifts (transform) keep working */
      ".dx-rv.dx-rv{opacity:0;translate:0 38px}",
      ".dx-rv.dx-rv-in{animation:dx-rv .8s cubic-bezier(.22,1,.36,1) var(--dx-d,0ms) both}",
      "@keyframes dx-rv{from{opacity:0;translate:0 38px}to{opacity:1;translate:0 0}}",
      "@media (prefers-reduced-motion:reduce){.dx-curtain,.dx-hint{display:none !important}.dx-rv.dx-rv{opacity:1;translate:none}.dx-dot,.dx-dot::after{transition:none}}"
    ].join("\n");
    var st = document.createElement("style");
    st.id = "dx-scroll-transition-css";
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---------- DOM ---------- */
  var curtain, red, ink, cCount, cName, hint, hintArrow, hintText, hintLabel, hintBar, rail;

  function buildDom() {
    curtain = document.createElement("div");
    curtain.className = "dx-curtain";
    curtain.setAttribute("aria-hidden", "true");
    curtain.innerHTML =
      '<div class="dx-layer dx-red"></div>' +
      '<div class="dx-layer dx-ink"><div class="dx-inner">' +
      '<span class="dx-mask dx-count"><span class="dx-t">01 / 01</span></span>' +
      '<span class="dx-mask dx-name"><span class="dx-t">Dashboard</span></span>' +
      '<span class="dx-mask dx-kicker"><span class="dx-t">Toyota \u00b7 ALJ Report Sheet</span></span>' +
      '<div class="dx-line"></div>' +
      "</div></div>";
    document.body.appendChild(curtain);
    red = $(".dx-red", curtain);
    ink = $(".dx-ink", curtain);
    cCount = $(".dx-count .dx-t", curtain);
    cName = $(".dx-name .dx-t", curtain);

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

    rail = document.createElement("nav");
    rail.className = "dx-rail dx-hide";
    rail.setAttribute("aria-label", "Dashboards");
    document.body.appendChild(rail);
    rail.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".dx-dot") : null;
      if (!b) return;
      var tabs = getTabs();
      var to = parseInt(b.getAttribute("data-i"), 10);
      var from = activeIndex(tabs);
      if (busy || isNaN(to) || to === from || !tabs[to]) return;
      goTo(to, to > from ? 1 : -1);
    });
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
    if (document.body.classList.contains("dx-welcome-open")) return true;
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

    if (reduced()) {
      busy = true;
      try { window.switchReportPanel(to.id); } catch (e) { /* ignore */ }
      resetScrolls(to.id);
      fireResize();
      cooldownUntil = now() + COOLDOWN_MS;
      busy = false;
      setTimeout(function () { syncRail(); }, 50);
      return Promise.resolve();
    }

    busy = true;
    resetPull();
    var leaving = targetsFor(fromId);
    var down = dir > 0;
    var initial = down ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
    var exit = down ? "inset(0 0 100% 0)" : "inset(100% 0 0 0)";

    cCount.textContent = pad2(index + 1) + " / " + pad2(tabs.length);
    cName.textContent = to.label;

    curtain.classList.remove("dx-text-in", "dx-text-out");
    setLayers(initial, "0s", "0s", false);
    curtain.classList.add("dx-on");
    reflow(curtain);

    // curtain wipes in (red first, ink 0.1s later) while the old panel shrinks away
    leaving.forEach(function (el) { el.classList.add("dx-leave"); });
    setLayers("inset(0)", "0s", ".1s", true);
    curtain.classList.add("dx-text-in");

    var entering = [];
    return wait(COVER_MS).then(function () {
      try { window.switchReportPanel(to.id); } catch (e) { /* ignore */ }
      clearClasses(leaving, ["dx-leave"]);
      entering = targetsFor(to.id);
      entering.forEach(function (el) { el.classList.add("dx-pre"); });
      resetScrolls(to.id);
      fireResize();
      return wait(HOLD_MS);
    }).then(function () {
      // wipe out, continuing in the same direction; the type exits upward
      entering = targetsFor(to.id);
      entering.forEach(function (el) { el.classList.remove("dx-pre"); el.classList.add("dx-enter"); });
      curtain.classList.remove("dx-text-in");
      curtain.classList.add("dx-text-out");
      setLayers(exit, ".1s", "0s", true);
      exiting = true;
      scheduleScans();
      return wait(EXIT_MS);
    }).then(function () {
      curtain.classList.remove("dx-on", "dx-text-out");
      setLayers(initial, "0s", "0s", false);
      return wait(Math.max(0, ENTER_MS - EXIT_MS + 120));
    }).catch(function () { /* never leave the screen covered */ }).then(function () {
      clearClasses(leaving, ["dx-leave"]);
      clearClasses(entering, ["dx-pre", "dx-enter"]);
      curtain.classList.remove("dx-on", "dx-text-in", "dx-text-out");
      fireResize();
      cooldownUntil = now() + COOLDOWN_MS;
      busy = false;
      exiting = false;
      resetPull();
      syncRail();
      scheduleScans();
    });
  }

  /* Public entry for other scripts (corner menu): play the curtain and open dashboard `id`.
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
        if (el.hasAttribute("data-dx-seen") || el.classList.contains("dx-rv")) continue;
        el.classList.add("dx-rv");
        io.observe(el);
      }
    });
  }
  function scheduleScans() {
    scanTimers.forEach(clearTimeout);
    scanTimers = [60, 400, 1300].map(function (ms) { return setTimeout(scan, ms); });
  }

  /* ---------- dot rail ---------- */
  var railKey = "";
  function syncRail() {
    if (!rail) return;
    var tabs = getTabs();
    var key = tabs.map(function (t) { return t.id + "|" + t.label + "|" + (t.active ? 1 : 0); }).join(";");
    if (key !== railKey) {
      railKey = key;
      rail.innerHTML = tabs.map(function (t, i) {
        var lab = t.label.replace(/"/g, "&quot;").replace(/</g, "&lt;");
        return '<button type="button" class="dx-dot' + (t.active ? " dx-active" : "") + '" data-i="' + i + '" data-label="' + lab + '" aria-label="' + lab + '"' + (t.active ? ' aria-current="true"' : "") + "></button>";
      }).join("");
    }
    var visible = tabs.length > 1 && dashboardShown() && window.innerWidth >= 900 && !wideOpen() &&
      !document.body.classList.contains("dx-welcome-open");
    rail.classList.toggle("dx-hide", !visible);
  }

  /* ---------- top-left corner menu ---------- */
  var menu, menuZone, menuTab, menuCloseTimer = 0, menuOpen = false;

  function isAdminUser() {
    try {
      var A = window.ReportSheetAuth;
      return !!(A && A.isAdmin && A.isAdmin(A.current && A.current()));   // same rule as #nav-admin-push
    } catch (e) { return false; }
  }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function paintMenu() {
    var buttons = document.querySelectorAll("#panel-tabs [data-panel]");
    var html = "";
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var lab = b.querySelector(".side-nav-label");
      var ico = b.querySelector(".side-nav-icon");
      var text = ((lab ? lab.textContent : b.getAttribute("title") || b.textContent) || "").replace(/\s+/g, " ").trim();
      var cur = b.classList.contains("active");
      html += '<button type="button" class="dx-menu-item' + (cur ? " dx-current" : "") + '" data-go="' + escHtml(b.getAttribute("data-panel")) + '"' + (cur ? ' aria-current="page"' : "") + ">" +
        '<span class="dx-menu-ico" aria-hidden="true">' + escHtml(ico ? ico.textContent : "\u2022") + "</span><span>" + escHtml(text) + "</span></button>";
    }
    if (isAdminUser()) {      // viewers never get these two links
      html += '<div class="dx-menu-sep"></div>' +
        '<a class="dx-menu-item" href="admin.html"><span class="dx-menu-ico" aria-hidden="true">\u2699</span><span>Admin Push</span></a>' +
        '<a class="dx-menu-item" href="data-uploader.html"><span class="dx-menu-ico" aria-hidden="true">\u21EA</span><span>Data Uploader</span></a>';
    }
    menuList.innerHTML = html;
  }
  var menuList;
  function openMenu() {
    if (document.body.classList.contains("dx-welcome-open")) return;
    clearTimeout(menuCloseTimer);
    if (menuOpen) return;
    paintMenu();
    menuOpen = true;
    menu.classList.add("dx-open");
    menu.setAttribute("aria-hidden", "false");
  }
  function closeMenu() {
    clearTimeout(menuCloseTimer);
    if (!menuOpen) return;
    menuOpen = false;
    menu.classList.remove("dx-open");
    menu.setAttribute("aria-hidden", "true");
  }
  function closeMenuSoon() {
    clearTimeout(menuCloseTimer);
    menuCloseTimer = setTimeout(closeMenu, 300);       // 300 ms grace period
  }
  function buildMenu() {
    menuZone = document.createElement("div");
    menuZone.className = "dx-corner-zone";
    menuZone.setAttribute("aria-hidden", "true");
    document.body.appendChild(menuZone);

    menuTab = document.createElement("button");
    menuTab.type = "button";
    menuTab.className = "dx-corner-tab";
    menuTab.setAttribute("aria-label", "Open dashboard menu");
    menuTab.textContent = "\u00bb";
    document.body.appendChild(menuTab);

    menu = document.createElement("nav");
    menu.className = "dx-menu";
    menu.setAttribute("aria-label", "Dashboards");
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML = '<div class="dx-menu-head"><i></i><span>Toyota \u00b7 ALJ Report Sheet</span></div><div class="dx-menu-list"></div>';
    menuList = menu.querySelector(".dx-menu-list");
    document.body.appendChild(menu);

    menuZone.addEventListener("mouseenter", openMenu);
    menuZone.addEventListener("mouseleave", function () { if (menuOpen) closeMenuSoon(); });
    // the invisible zone must never swallow a click meant for what is underneath (e.g. a narrow-window menu button)
    menuZone.addEventListener("click", function (e) {
      menuZone.style.pointerEvents = "none";
      var under = document.elementFromPoint(e.clientX, e.clientY);
      menuZone.style.pointerEvents = "";
      if (under && under !== menuZone && under.click) under.click();
    });
    menu.addEventListener("mouseenter", function () { clearTimeout(menuCloseTimer); });
    menu.addEventListener("mouseleave", closeMenuSoon);
    menuTab.addEventListener("click", function () { if (menuOpen) closeMenu(); else openMenu(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && menuOpen) closeMenu(); });
    document.addEventListener("pointerdown", function (e) {      // tap outside closes it on touch screens
      if (menuOpen && e.pointerType === "touch" && !menu.contains(e.target) && e.target !== menuTab) closeMenu();
    }, true);
    menu.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-go]") : null;
      if (b) {
        var id = b.getAttribute("data-go");
        closeMenu();
        if (typeof window.dxGoToPanel === "function") window.dxGoToPanel(id);
        return;
      }
      if (e.target.closest && e.target.closest("a")) closeMenu();
    });
  }

  /* ---------- init ---------- */
  function init() {
    injectCss();
    buildDom();
    buildMenu();

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("resize", syncRail);

    var tabsEl = document.getElementById("panel-tabs");
    if (tabsEl && window.MutationObserver) {
      new MutationObserver(function () {
        syncRail();
        scheduleScans();
      }).observe(tabsEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
    setInterval(syncRail, 400);   // dashboard shown / modal open state changes without a tab change
    syncRail();
    scheduleScans();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
