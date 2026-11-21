(function () {
  if (window.__dtMotion) return;
  window.__dtMotion = true;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('dt-wait');
  var el = document.createElement('div');
  el.id = 'dt-loader';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="dt-truck"><div class="dt-move"><svg viewBox="0 0 120 64" xmlns="http://www.w3.org/2000/svg"><rect class="dt-body" x="8" y="16" width="62" height="28" rx="4"/><path class="dt-cab" d="M70 22h22l12 14v8H70z"/><rect class="dt-win" x="76" y="24" width="16" height="10" rx="2"/><circle class="dt-wheel dt-roll" cx="28" cy="48" r="8"/><circle class="dt-wheel dt-roll" cx="92" cy="48" r="8"/></svg></div><p>Delivery Transformation</p></div>';
  function mount() {
    if (document.body) document.body.insertBefore(el, document.body.firstChild);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  function done() {
    document.documentElement.classList.remove('dt-wait');
    document.documentElement.classList.add('dt-in');
    el.classList.add('is-out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, reduce ? 0 : 420);
  }
  var wait = reduce ? 0 : 720;
  if (document.readyState === 'complete') setTimeout(done, wait);
  else window.addEventListener('load', function () { setTimeout(done, wait); });
  setTimeout(done, reduce ? 200 : 2200);
})();
