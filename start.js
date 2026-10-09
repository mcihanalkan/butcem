'use strict';
// Tüm dosyalar yüklendikten sonra uygulamayı başlatır.

if (SUB_PAGES.includes(ui.view)) ui.view = 'home';
history.replaceState({ view: ui.view }, '');
render();
initSync();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW kaydı başarısız', e));
}
