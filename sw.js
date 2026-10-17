// Vault service worker. Version comes from the registration URL (sw.js?v=STAMP), which
// index.html bumps together with the CSS/JS cache-buster, so each deploy installs a new SW.
const V = new URL(self.location).searchParams.get('v') || 'dev';
const SHELL = 'vault-shell-' + V, DATA = 'vault-data', MEDIA = 'vault-media', MEDIA_MAX = 250;
const SHELL_URLS = ['./', 'assets/style.css?v=' + V, 'assets/app.js?v=' + V, 'assets/logo.svg', 'manifest.webmanifest',
  'assets/icons/icon-192.png', 'assets/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_URLS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('vault-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const networkFirst = async (req, cacheName, key) => {
  const c = await caches.open(cacheName);
  try {
    const r = await fetch(req);
    if (r.ok) c.put(key || req, r.clone());
    return r;
  } catch (err) {
    const hit = await c.match(key || req, { ignoreSearch: true }) || await caches.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
};
const trim = async () => {
  const c = await caches.open(MEDIA), ks = await c.keys();
  for (let i = 0; i < ks.length - MEDIA_MAX; i++) await c.delete(ks[i]);
};
const cacheFirstMedia = async req => {
  const c = await caches.open(MEDIA), hit = await c.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') { c.put(req, r.clone()).then(trim); }
  return r;
};

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  // Never touch media: video/audio (incl. WebKit's first non-range probe) and anything cross-origin that isn't an image.
  const d = req.destination;
  if (d === 'video' || d === 'audio' || d === 'track') return;
  const url = new URL(req.url), scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin && d !== 'image') return;
  if (/\.(mp4|m4v|mov|webm|m3u8|ts)(\?|$)/i.test(url.pathname)) return;
  const local = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  if (local && url.pathname.startsWith(scope.pathname + 'api/')) return; // owner API: always network, never cached
  if (req.mode === 'navigate' && local) return e.respondWith(networkFirst(req, SHELL, new URL('./', scope).href));
  if (local && url.pathname.endsWith('/data/items.json')) return e.respondWith(networkFirst(req, DATA, new URL('data/items.json', scope).href));
  if (local) return e.respondWith(caches.match(req).then(h => h || fetch(req)));
  if (req.destination === 'image') return e.respondWith(cacheFirstMedia(req));
});
