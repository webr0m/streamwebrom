// Run before CSS: avoid a bright flash when the user prefers night mode.
// No video filters or broadcast settings are changed by the interface theme.
(() => {
  const key = "swr.appearance";
  const root = document.documentElement;
  const system = window.matchMedia?.("(prefers-color-scheme: dark)");
  const valid = value => ["light", "dark", "auto"].includes(value) ? value : "auto";
  let preference = "auto";
  try { preference = valid(localStorage.getItem(key)); } catch {}
  function apply() {
    const theme = preference === "auto" ? (system?.matches ? "dark" : "light") : preference;
    root.dataset.theme = theme;
    root.dataset.appearance = preference;
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.content = theme === "dark" ? "#11151c" : "#f5f7fb";
    for (const picker of document.querySelectorAll("[data-theme-picker]")) picker.value = preference;
  }
  apply();
  document.addEventListener("DOMContentLoaded", apply, { once: true });
  document.addEventListener("change", event => {
    if (!event.target.matches?.("[data-theme-picker]")) return;
    preference = valid(event.target.value);
    try { localStorage.setItem(key, preference); } catch {}
    apply();
  });
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue);
    apply();
  });
  system?.addEventListener?.("change", () => { if (preference === "auto") apply(); });
})();
