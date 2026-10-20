/* Executive present mode — Matched Vehicles (Allocation) page only.
   Adds a Present button to the page header. Present fills the whole screen
   (app sidebar + top bar hidden by executive-skin.css). Esc exits. */
(function () {
  function addButton() {
    var actions = document.querySelector("#panel-boallocstock .act-header-actions");
    if (!actions || document.getElementById("exec-present-btn")) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.id = "exec-present-btn";
    btn.textContent = "Present";
    btn.setAttribute("aria-pressed", "false");
    btn.title = "Fill the whole screen (Esc to exit)";
    btn.addEventListener("click", function () {
      var on = document.body.classList.toggle("exec-present");
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = on ? "Exit" : "Present";
      window.dispatchEvent(new Event("resize"));
    });
    actions.appendChild(btn);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!document.body.classList.contains("exec-present")) return;
    // Esc first leaves a full-screen section; only exit Present when back on the overview.
    if (document.body.classList.contains("act-section-wide") || document.body.classList.contains("act-match-wide")) return;
    document.body.classList.remove("exec-present");
    var btn = document.getElementById("exec-present-btn");
    if (btn) {
      btn.classList.remove("is-on");
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = "Present";
    }
    window.dispatchEvent(new Event("resize"));
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton);
  else addButton();
})();
