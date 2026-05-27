const CACHE = 'dexter-v1';
const ASSETS = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API çağrılarını cache'leme — her zaman ağ
  if (url.pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
      if (res.ok && event.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(event.request, clone));
      }
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
