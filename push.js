'use strict';

/* =====================================================================
   Telefona bildirim (Firebase Cloud Messaging)
   - Ayarlar'dan "Bildirimleri aç" → izin istenir → bu cihazın bildirim adresi
     (token) users/{uid}/push/{id} altına kaydedilir.
   - Bildirimleri GitHub'da zamanlanmış bir görev (tools/notify) sabah ve akşam
     gönderir; uygulama kapalıyken de gelir. Gösterme işini sw.js yapar.
   ===================================================================== */

const PUSH_KEY = 'butce.push';
const pushSupported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
let pushState = (() => { try { return JSON.parse(localStorage.getItem(PUSH_KEY) || 'null'); } catch { return null; } })();
let pushBusy = false;

async function enablePush() {
  if (pushBusy) return;
  if (!pushSupported()) { toast('Bu tarayıcı bildirimleri desteklemiyor'); return; }
  if (!window.FCM_VAPID_KEY) { toast('Bildirim kurulumu henüz tamamlanmadı'); return; }
  if (!sync.user) { toast('Önce Google ile giriş yap'); return; }
  pushBusy = true;
  render();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Bildirim izni verilmedi. Telefon ayarlarından açabilirsin.'); return; }
    const reg = await navigator.serviceWorker.ready;
    const m = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-messaging.js`);
    if (!(await m.isSupported())) { toast('Bu cihazda bildirim desteklenmiyor'); return; }
    const messaging = m.getMessaging(sync.app);
    const token = await m.getToken(messaging, { vapidKey: window.FCM_VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('token');
    // Aynı cihaz tekrar açarsa aynı belgeyi günceller
    const id = pushState?.id || uid();
    const ua = navigator.userAgent;
    const device = /android/i.test(ua) ? 'Android telefon' : /iphone|ipad/i.test(ua) ? 'iPhone' : /windows/i.test(ua) ? 'Windows bilgisayar' : 'Bu cihaz';
    const { fs } = sync.fb;
    await fs.setDoc(fs.doc(sync.fs, 'users', sync.user.uid, 'push', id), { token, device, tz: 'Europe/Istanbul', createdAt: pushState?.createdAt || Date.now(), updatedAt: Date.now() });
    pushState = { id, device, on: true, createdAt: pushState?.createdAt || Date.now() };
    try { localStorage.setItem(PUSH_KEY, JSON.stringify(pushState)); } catch {}
    toast('Bildirimler açıldı');
    reg.showNotification('Bütçem', { body: 'Bildirimler açık. Son ödeme günleri ve onay bekleyenler için haber vereceğim.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'butcem-test' });
  } catch (e) {
    console.warn('Bildirim', e);
    toast(`Bildirim açılamadı: ${String(e?.message || e).slice(0, 80)}`);
  } finally {
    pushBusy = false;
    render();
  }
}

async function disablePush() {
  if (!pushState?.id) return;
  try {
    const { fs } = sync.fb;
    // Veritabanı kuralı silmeye izin vermez; kayıt kapalı olarak işaretlenir
    if (sync.user) await fs.setDoc(fs.doc(sync.fs, 'users', sync.user.uid, 'push', pushState.id), { token: null, disabled: true, updatedAt: Date.now() });
    const m = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-messaging.js`);
    await m.deleteToken(m.getMessaging(sync.app)).catch(() => {});
  } catch (e) { console.warn(e); }
  pushState = null;
  try { localStorage.removeItem(PUSH_KEY); } catch {}
  render();
  toast('Bu cihazda bildirimler kapatıldı');
}

function pushCard() {
  if (!syncConfigured()) return '';
  const perm = pushSupported() ? Notification.permission : 'unsupported';
  const on = pushState?.on && perm === 'granted';
  return `<div class="card">
    <h3>Bildirimler</h3>
    <p class="muted small" style="margin-top:-6px">Kart son ödemesi, borç vadesi ve düzenli ödemeler için 3 gün önce ve o gün sabah 09:00'da; onaylamadığın bir şey kalırsa akşam 20:00'de haber verilir. Uygulama kapalıyken de gelir.</p>
    ${perm === 'unsupported' ? '<p class="muted small">Bu tarayıcı bildirimleri desteklemiyor. Telefonda uygulamayı ana ekrandan açarak dene.</p>'
      : perm === 'denied' ? '<p class="exp small">Bildirim izni kapalı. Telefonun Ayarlar → Uygulamalar → Chrome (ya da Bütçem) → Bildirimler bölümünden izin ver, sonra tekrar dene.</p>'
      : on ? `<div class="setting"><div><b>Bu cihazda açık</b><p>${esc(pushState.device || '')}</p></div><button class="btn small" data-action="push-off">Kapat</button></div>`
      : `<button class="btn primary block" data-action="push-on" ${pushBusy ? 'disabled' : ''}>${icon('bell', 18)} ${pushBusy ? 'Açılıyor…' : 'Bu cihazda bildirimleri aç'}</button>`}
  </div>`;
}

Object.assign(actions, {
  'push-on': () => enablePush(),
  'push-off': () => disablePush(),
});
