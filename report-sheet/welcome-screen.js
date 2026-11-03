/* =====================================================================
   welcome-screen.js  ·  first view of index.html for every signed-in user
   Load right after the <body> tag:  <script src="welcome-screen.js"></script>

   A full-screen welcome (name, role, date) is shown first. One scroll down
   (wheel, swipe up, arrow/space/enter key or the button) wipes it away and
   reveals the user's own dashboard. Same red/ink look as scroll-transition.js.
   prefers-reduced-motion: no animation, it just closes.
   ===================================================================== */
(function () {
  "use strict";
  if (window.__dxWelcome) return;
  window.__dxWelcome = true;

  var RED = "#eb0a1e";
  var INK = "#070d18";
  var INPUT_DELAY_MS = 600;   // ignore stray scroll right after the page opens
  var EXIT_MS = 1100;         // wipe-out length (0.7s + 0.1s stagger + margin)

  var Auth = window.ReportSheetAuth;
  var user = null;
  try { user = Auth && Auth.current && Auth.current(); } catch (e) { user = null; }
  if (!user) return;          // not signed in: auth.js sends the visitor to login.html

  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var css = [
    ".wl-root{position:fixed;inset:0;z-index:2147482500;font-family:Manrope,Outfit,'Segoe UI',system-ui,sans-serif;color:#fff;overflow:hidden}",
    ".wl-layer{position:absolute;inset:0;clip-path:inset(0);transition:clip-path .7s cubic-bezier(.76,0,.24,1)}",
    ".wl-red{background:" + RED + "}",
    ".wl-ink{background:radial-gradient(60% 55% at 10% 95%,rgba(235,10,30,.28),transparent 70%),radial-gradient(55% 55% at 92% 6%,rgba(46,112,255,.22),transparent 70%)," + INK + ";display:flex;flex-direction:column;justify-content:space-between;padding:clamp(18px,3.2vw,40px) 7vw clamp(22px,4vw,48px);box-sizing:border-box}",
    ".wl-ink::before{content:'';position:absolute;width:60vmax;height:60vmax;left:-20vmax;bottom:-35vmax;border-radius:50%;background:radial-gradient(circle,rgba(235,10,30,.16),transparent 65%);animation:wl-float 9s ease-in-out infinite alternate;pointer-events:none}",
    "@keyframes wl-float{from{transform:translate(0,0)}to{transform:translate(8vw,-6vh)}}",
    ".wl-top{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px}",
    ".wl-brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:13px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.75)}",
    ".wl-brand img{width:34px;height:34px;object-fit:contain;background:#fff;border-radius:9px;padding:3px}",
    ".wl-date{font-weight:600;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.55);text-align:right}",
    ".wl-mid{position:relative}",
    ".wl-mask{display:block;overflow:hidden}",
    ".wl-t{display:block;transform:translateY(110%);transition:transform .9s cubic-bezier(.16,1,.3,1)}",
    ".wl-greet .wl-t{color:" + RED + ";font-weight:800;font-size:clamp(14px,1.5vw,20px);letter-spacing:.22em;text-transform:uppercase;padding:.2em 0 .9em}",
    ".wl-name .wl-t{font-weight:800;font-size:clamp(46px,9vw,150px);letter-spacing:-.045em;line-height:1;padding:.06em 0 .12em;overflow-wrap:anywhere}",
    ".wl-role .wl-t{font-weight:600;font-size:clamp(14px,1.5vw,21px);letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.62);padding:.9em 0 1.2em}",
    ".wl-line{height:3px;width:min(260px,40vw);background:" + RED + ";transform:scaleX(0);transform-origin:left center;transition:transform 1s cubic-bezier(.16,1,.3,1) .6s}",
    ".wl-in .wl-greet .wl-t{transform:none;transition-delay:.15s}",
    ".wl-in .wl-name .wl-t{transform:none;transition-delay:.28s}",
    ".wl-in .wl-role .wl-t{transform:none;transition-delay:.44s}",
    ".wl-in .wl-line{transform:scaleX(1)}",
    ".wl-cue{position:relative;align-self:center;display:flex;flex-direction:column;align-items:center;gap:14px;opacity:0;transform:translateY(14px);transition:opacity .8s ease 1.1s,transform .9s cubic-bezier(.16,1,.3,1) 1.1s}",
    ".wl-in .wl-cue{opacity:1;transform:none}",
    ".wl-btn{display:flex;align-items:center;gap:14px;padding:12px 22px 12px 14px;border:0;border-radius:999px;cursor:pointer;color:#fff;background:rgba(255,255,255,.07);box-shadow:0 0 0 1px rgba(255,255,255,.14);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font:700 14px/1 Manrope,Outfit,'Segoe UI',system-ui,sans-serif;transition:background .2s ease,box-shadow .2s ease}",
    ".wl-btn:hover,.wl-btn:focus-visible{background:rgba(235,10,30,.22);box-shadow:0 0 0 1px " + RED + ";outline:none}",
    ".wl-mouse{width:24px;height:38px;border-radius:14px;border:2px solid rgba(255,255,255,.85);position:relative;flex:0 0 auto}",
    ".wl-mouse::after{content:'';position:absolute;left:50%;top:7px;width:4px;height:8px;margin-left:-2px;border-radius:3px;background:" + RED + ";animation:wl-wheel 1.5s cubic-bezier(.6,0,.3,1) infinite}",
    "@keyframes wl-wheel{0%{opacity:0;transform:translateY(0)}25%{opacity:1}80%{opacity:0;transform:translateY(12px)}100%{opacity:0}}",
    ".wl-btn-text{display:flex;flex-direction:column;align-items:flex-start;gap:5px;text-align:left}",
    ".wl-btn-text small{font-weight:600;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.55)}",
    ".wl-btn-text b{font-weight:800;font-size:15px}",
    ".wl-btn-text b em{font-style:normal;color:" + RED + "}",
    ".wl-arrows{display:flex;flex-direction:column;align-items:center;gap:0;color:rgba(255,255,255,.7);font-size:15px;line-height:.8}",
    ".wl-arrows i{font-style:normal;animation:wl-bob 1.6s ease-in-out infinite}",
    ".wl-arrows i:nth-child(2){animation-delay:.2s}",
    "@keyframes wl-bob{0%,100%{opacity:.2;transform:translateY(-3px)}50%{opacity:1;transform:translateY(3px)}}",
    /* leaving: ink first, red 0.1s later, type exits upward */
    ".wl-out .wl-red,.wl-out .wl-ink{clip-path:inset(0 0 100% 0)}",
    ".wl-out .wl-red{transition-delay:.1s}",
    ".wl-out .wl-t{transform:translateY(-110%);transition:transform .55s cubic-bezier(.76,0,.24,1)}",
    ".wl-out .wl-line{transform:scaleX(0);transform-origin:right center;transition:transform .45s cubic-bezier(.76,0,.24,1);transition-delay:0s}",
    ".wl-out .wl-cue{opacity:0;transform:translateY(-12px);transition:opacity .3s ease,transform .4s ease;transition-delay:0s}",
    "@media (prefers-reduced-motion:reduce){.wl-layer,.wl-t,.wl-line,.wl-cue{transition:none !important}.wl-ink::before,.wl-mouse::after,.wl-arrows i{animation:none !important}.wl-t{transform:none}.wl-line{transform:none}.wl-cue{opacity:1;transform:none}}",
    "@media (max-width:640px){.wl-date{display:none}.wl-brand{font-size:11px}}"
  ].join("\n");

  var style = document.createElement("style");
  style.id = "dx-welcome-css";
  style.textContent = css;
  document.head.appendChild(style);

  var h = new Date().getHours();
  var greeting = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  var dateText = "";
  try {
    dateText = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  } catch (e) { dateText = ""; }
  var roleText = user.title || (user.role === "admin" ? "Administrator" : "Report Sheet");

  var root = document.createElement("div");
  root.className = "wl-root";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Welcome");
  root.innerHTML =
    '<div class="wl-layer wl-red"></div>' +
    '<div class="wl-layer wl-ink">' +
      '<div class="wl-top">' +
        '<div class="wl-brand"><img src="../images/logo/toyota.png" alt="" onerror="this.style.display=\'none\'"><span>Toyota \u00b7 ALJ Report Sheet</span></div>' +
        '<div class="wl-date">' + esc(dateText) + "</div>" +
      "</div>" +
      '<div class="wl-mid">' +
        '<span class="wl-mask wl-greet"><span class="wl-t">' + esc(greeting) + ", welcome</span></span>" +
        '<span class="wl-mask wl-name"><span class="wl-t">' + esc(user.name) + "</span></span>" +
        '<span class="wl-mask wl-role"><span class="wl-t">' + esc(roleText) + "</span></span>" +
        '<div class="wl-line"></div>' +
      "</div>" +
      '<div class="wl-cue">' +
        '<button type="button" class="wl-btn" id="wl-enter">' +
          '<span class="wl-mouse" aria-hidden="true"></span>' +
          '<span class="wl-btn-text"><small>Scroll to see your dashboard</small><b id="wl-target">Open <em>your dashboard</em></b></span>' +
        "</button>" +
        '<span class="wl-arrows" aria-hidden="true"><i>\u2304</i><i>\u2304</i></span>' +
      "</div>" +
    "</div>";
  document.body.insertBefore(root, document.body.firstChild);
  document.body.classList.add("dx-welcome-open");

  var openedAt = Date.now();
  var closing = false;
  var targetEl = root.querySelector("#wl-target");
  var enterBtn = root.querySelector("#wl-enter");

  // the first dashboard this user is allowed to see (filled in by the page once access is loaded)
  function paintTarget() {
    if (!targetEl) return;
    var lab = document.querySelector("#panel-tabs .tab.active .side-nav-label, #panel-tabs .tab .side-nav-label");
    var text = lab ? lab.textContent.replace(/\s+/g, " ").trim() : "";
    var html = text ? 'Open <em>' + esc(text) + "</em>" : 'Open <em>your dashboard</em>';
    if (targetEl.innerHTML !== html) targetEl.innerHTML = html;
  }
  paintTarget();
  var poll = setInterval(paintTarget, 300);

  function close() {
    if (closing) return;
    closing = true;
    window.__dxNoPullUntil = Date.now() + EXIT_MS + 500;   // scroll-transition.js: no dashboard change from this scroll's momentum
    clearInterval(poll);
    window.removeEventListener("wheel", onWheel, wheelOpts);
    window.removeEventListener("touchstart", onTouchStart, true);
    window.removeEventListener("touchmove", onTouchMove, true);
    window.removeEventListener("keydown", onKey, true);
    var done = function () {
      if (root.parentNode) root.parentNode.removeChild(root);
      document.body.classList.remove("dx-welcome-open");
      try { window.dispatchEvent(new Event("resize")); } catch (e) { /* ignore */ }
    };
    if (reduce) { done(); return; }
    root.classList.add("wl-out");
    setTimeout(done, EXIT_MS);
  }

  function ready() { return Date.now() - openedAt > INPUT_DELAY_MS; }

  var wheelOpts = { passive: false, capture: true };
  function onWheel(e) {
    // the welcome screen owns the wheel: nothing underneath (or scroll-transition.js) may react
    e.preventDefault();
    e.stopPropagation();
    if (closing || !ready()) return;
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.deltaY > 0) close();
  }
  var tStart = null;
  function onTouchStart(e) {
    tStart = e.touches && e.touches.length === 1 ? { y: e.touches[0].clientY, x: e.touches[0].clientX } : null;
  }
  function onTouchMove(e) {
    e.stopPropagation();
    if (!tStart || closing || !ready() || !e.touches || !e.touches.length) return;
    var dy = tStart.y - e.touches[0].clientY;
    var dx = Math.abs(tStart.x - e.touches[0].clientX);
    if (dy > 40 && dy > dx) close();            // swipe up
  }
  function onKey(e) {
    if (closing) return;
    var k = e.key;
    if (k === "ArrowDown" || k === "PageDown" || k === " " || k === "Spacebar" || k === "Enter" || k === "End") {
      e.preventDefault();
      e.stopPropagation();
      if (ready()) close();
    }
  }

  window.addEventListener("wheel", onWheel, wheelOpts);
  window.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
  window.addEventListener("keydown", onKey, true);
  enterBtn.addEventListener("click", close);

  // type slides in on the next frames
  if (reduce) root.classList.add("wl-in");
  else requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add("wl-in"); }); });
  setTimeout(function () { try { enterBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 50);
})();
