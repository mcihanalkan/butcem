// Uygulama dosyalarını önbelleğe alır: internet yokken de açılır.
// Kendi dosyalarımız: önce ağdan dener (güncel sürüm gelsin), olmazsa önbellekten verir.
// Firebase kütüphaneleri (gstatic, sürüm numaralı): önbellekte varsa oradan verir.
const CACHE = 'butce-v35';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=35',
  './icons.js?v=35',
  './app.js?v=35',
  './budget.js?v=35',
  './recurring.js?v=35',
  './debts.js?v=35',
  './accounts.js?v=35',
  './fees.js?v=35',
  './ai.js?v=35',
  './scan.js?v=35',
  './smart.js?v=35',
  './goals.js?v=35',
  './subs.js?v=35',
  './reports.js?v=35',
  './push.js?v=35',
  './forecast.js?v=35',
  './lock.js?v=35',
  './drive.js?v=35',
  './recon.js?v=35',
  './debtplan.js?v=35',
  './trial.js?v=35',
  './habits.js?v=35',
  './chat.js?v=35',
  './insight.js?v=35',
  './story.js?v=35',
  './vault.js?v=35',
  './events.js?v=35',
  './more.js?v=35',
  './home.js?v=35',
  './start.js?v=35',
  './firebase-config.js?v=35',
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
  const open = new URL(url).searchParams.get('open') || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { if (open) c.postMessage({ type: 'open', open }); return c.focus(); }
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
