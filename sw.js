const CACHE = 'juanmo-times-v11';
const STATIC = ['/', '/index.html', '/styles.css', '/app.js', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // news.json: network first, fallback to cache
  // Only cache responses that are actually JSON — prevents cache poisoning
  // if an intermediary (captive portal, error page, phishing) returns 200 HTML.
  if (url.pathname.endsWith('/news.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const ct = res.headers.get('content-type') || '';
          if (res.ok && ct.includes('application/json')) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Static assets: cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
