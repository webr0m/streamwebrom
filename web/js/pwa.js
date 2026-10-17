// Installable web app (PWA). Skipped inside OBS/vMix (no service workers needed there).
if ("serviceWorker" in navigator && !/OBS|vMix/i.test(navigator.userAgent) && location.pathname !== "/view") {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}
let deferred;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  const b = document.getElementById("install");
  if (b) { b.classList.remove("hidden"); b.onclick = () => { deferred.prompt(); b.classList.add("hidden"); }; }
});
