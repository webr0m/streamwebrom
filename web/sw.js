// Offline-capable app shell. Live media and signalling are never cached.
const ASSET_PREFIX = "__SWR_ASSET_PREFIX__";
const CACHE = "swr-v13-" + ASSET_PREFIX;
const SHELL = ["/", "/studio", "/guest", "/view", "/diagnostics", "/vdo", "/js/diagnostics.js", "/css/app.css", "/js/rtc.js", "/js/compositor.js", "/js/index.js",
  "/js/appearance.js", "/js/workspace.js", "/js/telemetry.js", "/js/immersive.js", "/js/output-quality.js", "/js/effect-budget.js", "/js/segmentation-client.js", "/js/segment-worker.js", "/js/studio.js", "/js/guest.js", "/js/network.js", "/js/call-grid.js", "/js/connection-health.js", "/js/room-audio.js", "/js/view.js", "/js/bandwidth.js", "/js/relay-status.js", "/js/vdo.js", "/js/vdo-room.js", "/js/pwa.js", "/js/devices.js", "/js/screen-share.js", "/js/native-audio.js", "/js/native-audio-worklet.js", "/js/effects.js", "/js/ticker.js", "/js/remote.js", "/js/chat.js", "/js/stickers.js",
  "/js/i18n.js", "/js/i18n/en.js", "/js/i18n/en/common.js", "/js/i18n/en/devices.js",
  "/js/i18n/en/diagnostics.js", "/js/i18n/en/effects.js", "/js/i18n/en/guest.js", "/js/i18n/en/home.js",
  "/js/i18n/en/misc.js", "/js/i18n/en/pages.js", "/js/i18n/en/studio.js", "/js/i18n/en/studiojs.js",
  "/js/i18n/es.js", "/js/i18n/es/common.js", "/js/i18n/es/devices.js", "/js/i18n/es/diagnostics.js",
  "/js/i18n/es/effects.js", "/js/i18n/es/guest.js", "/js/i18n/es/home.js", "/js/i18n/es/misc.js",
  "/js/i18n/es/pages.js", "/js/i18n/es/studio.js", "/js/i18n/es/studiojs.js", "/js/i18n/ru.js",
  "/js/i18n/ru/common.js", "/js/i18n/ru/devices.js", "/js/i18n/ru/diagnostics.js", "/js/i18n/ru/effects.js",
  "/js/i18n/ru/guest.js", "/js/i18n/ru/home.js", "/js/i18n/ru/misc.js", "/js/i18n/ru/pages.js",
  "/js/i18n/ru/studio.js", "/js/i18n/ru/studiojs.js",
  "/img/logo.svg", "/manifest.webmanifest"].map(p => /^\/(js|css)\//.test(p) ? ASSET_PREFIX + p : p);
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
