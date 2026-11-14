/* Chart defaults: shared palette from --cx-muted / --ex-blue / --ex-green / --ex-amber / --ex-red. Bar fill is blue, not red.
   Loaded with `defer` right after chart.js so it runs before any dashboard script builds a chart. */
window.__exChartPalette = ["#8d9bb0", "#2563eb", "#0f9d76", "#d97706", "#eb0a1e"];
if (window.Chart && Chart.defaults) {
  Chart.defaults.color = "#8d9bb0";
  Chart.defaults.borderColor = "rgba(148,163,184,.10)";
  Chart.defaults.font.family = "Manrope, 'IBM Plex Sans Arabic', 'Segoe UI', system-ui, sans-serif";
  if (Chart.defaults.datasets && Chart.defaults.datasets.bar) {
    Chart.defaults.datasets.bar.backgroundColor = "#2563eb";
  }
}
