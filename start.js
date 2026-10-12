'use strict';
// Tüm dosyalar yüklendikten sonra uygulamayı başlatır.

// Menü ve buton ikonlarını yerleştir
$$('[data-i]').forEach((el) => { el.innerHTML = icon(el.dataset.i, el.closest('.fab') ? 26 : 22); });

if (SUB_PAGES.includes(ui.view)) ui.view = 'home';
history.replaceState({ view: ui.view }, '');
render();
initSync();

// Bildirimden gelinen ekran (?open=add → yeni kayıt, ?open=chat …)
function openFromNotification(what) {
  if (what === 'add') openTxForm();
  else if (what === 'report') goTo('report');
}
const openParam = new URLSearchParams(location.search).get('open');
if (openParam) { history.replaceState({ view: ui.view }, '', location.pathname); setTimeout(() => openFromNotification(openParam), 300); }
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') openFromNotification(e.data.open); });

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
