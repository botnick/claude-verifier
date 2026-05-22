/* Shared light/dark theme toggle.
   - Reads stored preference from localStorage (key: "cv_theme")
   - Falls back to the OS preference (prefers-color-scheme: light)
   - Toggles the `.light` class on <html> so the FOUC is minimized
   - Updates the toggle button's glyph (☾ / ☀) and aria-label
*/
(function () {
  const KEY = "cv_theme";
  const html = document.documentElement;

  function apply(mode) {
    const light = mode === "light";
    html.classList.toggle("light", light);
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.textContent = light ? "☀" : "☾";
      btn.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
    }
  }

  const stored = localStorage.getItem(KEY);
  const osLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  apply(stored === "light" || (stored !== "dark" && osLight) ? "light" : "dark");

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;
    apply(html.classList.contains("light") ? "light" : "dark");
    btn.addEventListener("click", () => {
      const next = html.classList.contains("light") ? "dark" : "light";
      localStorage.setItem(KEY, next);
      apply(next);
    });
  });
})();
