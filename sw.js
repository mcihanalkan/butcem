// Uygulama dosyalarını önbelleğe alır: internet yokken de açılır.
// Kendi dosyalarımız: önce ağdan dener (güncel sürüm gelsin), olmazsa önbellekten verir.
// Firebase kütüphaneleri (gstatic, sürüm numaralı): önbellekte varsa oradan verir.
const CACHE = 'butce-v32';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=32',
  './icons.js?v=32',
  './app.js?v=32',
  './budget.js?v=32',
  './recurring.js?v=32',
  './debts.js?v=32',
  './accounts.js?v=32',
  './ai.js?v=32',
  './scan.js?v=32',
  './smart.js?v=32',
  './goals.js?v=32',
  './subs.js?v=32',
  './reports.js?v=32',
  './push.js?v=32',
  './forecast.js?v=32',
  './lock.js?v=32',
  './drive.js?v=32',
  './home.js?v=32',
  './start.js?v=32',
  './firebase-config.js?v=32',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' → tarayıcının HTTP önbelleğindeki eski kopyayı değil, sunucudakini al
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Bildirim geldiğinde göster (sunucu sadece veri gönderir: title, body, tag, url)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { data: { body: e.data ? e.data.text() : '' } }; }
  const data = d.data || {};
  const n = d.notification || {};
  e.waitUntil(self.registration.showNotification(data.title || n.title || 'Bütçem', {
    body: data.body || n.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'butcem',
    renotify: true,
    data: { url: data.url || './' },
  }));
});

// Bildirime dokununca uygulamayı aç (açıksa öne getir)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) return c.focus();
    return self.clients.openWindow(url);
  }));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Firebase kütüphaneleri ve yazı tipleri (sürüm/sabit adresli): önbellekte varsa oradan
  const isFont = url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com';
  if (isFont || (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: GitHub Pages 10 dk önbellek süresi veriyor; her seferinde sunucuya sor (değişmediyse hızlı 304 döner)
    fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }))
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
