// Offline-capable app shell. Live media and signalling are never cached.
const ASSET_PREFIX = "__SWR_ASSET_PREFIX__";
const CACHE = "swr-v11-" + ASSET_PREFIX;
const SHELL = ["/", "/studio", "/guest", "/view", "/diagnostics", "/vdo", "/js/diagnostics.js", "/css/app.css", "/js/rtc.js", "/js/compositor.js", "/js/index.js",
  "/js/appearance.js", "/js/workspace.js", "/js/telemetry.js", "/js/immersive.js", "/js/output-quality.js", "/js/effect-budget.js", "/js/segmentation-client.js", "/js/segment-worker.js", "/js/studio.js", "/js/guest.js", "/js/network.js", "/js/call-grid.js", "/js/connection-health.js", "/js/view.js", "/js/bandwidth.js", "/js/relay-status.js", "/js/vdo.js", "/js/vdo-room.js", "/js/pwa.js", "/js/devices.js", "/js/effects.js", "/js/ticker.js", "/js/remote.js", "/js/chat.js", "/js/stickers.js", "/img/logo.svg", "/manifest.webmanifest"].map(p => /^\/(js|css)\//.test(p) ? ASSET_PREFIX + p : p);
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("swr-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || /^\/(api|ws|whip|whep|recordings|metrics)/.test(u.pathname)) return;
  // Cache only the known shell. Room names, passwords and arbitrary queries
  // must never create persistent entries or fill the origin's storage.
  if (!SHELL.includes(u.pathname)) return;
  const key = u.pathname;
  // network first so updates land immediately; cache as offline fallback
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {})); }
    return r;
  }).catch(async () => (await caches.open(CACHE)).match(key).then((r) => r || new Response("Sin conexión. Revisa tu red y vuelve a intentar.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))));
});
