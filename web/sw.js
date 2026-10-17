// Offline-capable app shell. Live media and signalling are never cached.
const CACHE = "swr-v4";
const SHELL = ["/", "/studio", "/guest", "/view", "/css/app.css", "/js/rtc.js", "/js/compositor.js", "/js/index.js",
  "/js/studio.js", "/js/guest.js", "/js/view.js", "/js/pwa.js", "/js/devices.js", "/js/effects.js", "/js/ticker.js", "/js/remote.js", "/img/logo.svg", "/manifest.webmanifest"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || /^\/(api|ws|whip|whep|recordings|metrics)/.test(u.pathname)) return;
  // network first so updates land immediately; cache as offline fallback
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
