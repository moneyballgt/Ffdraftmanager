/* Draft Room service worker.
   The point of this is a draft hall with bad wifi: the app shell must open
   and run from cache, while live draft picks must NEVER be served stale.
   So Sleeper requests are deliberately not intercepted at all — they pass
   straight through to the network and fail loudly if offline, rather than
   silently resolving to an old pick list.

   Cross-origin was once enough to express that, because live data only ever
   came from Sleeper. It is not enough any more: the Yahoo proxy serves picks
   from /api/ on THIS origin, so an origin check alone would hand the draft a
   cached pick list — the precise failure this file exists to prevent. Live
   data is now identified by path, not by origin. */
const CACHE = 'draftroom-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;   // Sleeper etc: untouched, always live
  if (url.pathname.startsWith('/api/')) return;      // Yahoo proxy: same-origin but LIVE
  if (url.pathname === '/auth' || url.pathname === '/callback') return;   // OAuth, never cached

  // App shell: serve instantly from cache, refresh in the background.
  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
