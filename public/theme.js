// Codex: keep theme initialization compatible with the dashboard CSP.
try {
  document.documentElement.dataset.theme = localStorage.getItem("tds-theme") || "light";
} catch {
  document.documentElement.dataset.theme = "light";
}
