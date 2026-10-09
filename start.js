'use strict';
// Tüm dosyalar yüklendikten sonra uygulamayı başlatır.

if (SUB_PAGES.includes(ui.view)) ui.view = 'home';
history.replaceState({ view: ui.view }, '');
render();
initSync();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  // Yeni sürüm devreye girince sayfayı bir kez yenile (eski ekranlar kalmasın)
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch((e) => console.warn('SW kaydı başarısız', e));
}
