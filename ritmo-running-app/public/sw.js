const CACHE = 'paceup-shell-v8';
async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch('/',{cache:'no-store'});
  if (!response.ok) throw new Error('No se pudo guardar PaceUp para usarlo sin conexión');
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match=>new URL(match[1],self.location.origin))
    .filter(url=>url.origin === self.location.origin && url.pathname.startsWith('/assets/') && /\.(?:js|css)$/.test(url.pathname));
  await cache.put('/',response);
  await cache.addAll(['/manifest.webmanifest','/paceup-icon-v2-192.png','/paceup-icon-v2-512.png','/paceup-maskable-v2-512.png',...new Set(assets.map(url=>url.href))]);
  await self.skipWaiting();
}
self.addEventListener('install', event => { event.waitUntil(precacheShell()); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('paceup-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  // Dynamic sync must reach the network; IndexedDB is the explicit offline fallback.
  if (new URL(event.request.url).pathname.startsWith('/.netlify/functions/') || event.request.cache === 'no-store') return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('/') : Response.error())));
});
