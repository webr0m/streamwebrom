// Installable web app (PWA). Skipped inside OBS/vMix (no service workers needed there).
if ("serviceWorker" in navigator && !/OBS|vMix/i.test(navigator.userAgent) && location.pathname !== "/view") {
  const build = new URL(import.meta.url).pathname.match(/^\/assets\/([^/]+)\//)?.[1] || "dev";
  navigator.serviceWorker.register(`/sw.js?build=${encodeURIComponent(build)}`, { scope: "/", updateViaCache: "none" }).catch(() => {});
}
let deferred;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  const b = document.getElementById("install");
  if (b) { b.classList.remove("hidden"); b.onclick = () => { deferred.prompt(); b.classList.add("hidden"); }; }
});
