'use strict';
// Tüm dosyalar (app.js, budget.js, ai.js) yüklendikten sonra uygulamayı başlatır.

render();
initSync();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW kaydı başarısız', e));
}
