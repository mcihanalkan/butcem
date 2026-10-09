'use strict';

/* =====================================================================
   Google Drive yedeği
   - Haftada bir tüm verinin kopyası Drive'daki "Bütçem yedekleri" klasörüne kaydedilir.
   - Uygulama sadece kendi oluşturduğu dosyaları görebilir (drive.file izni).
   - Google her yedekte onay ister: zamanı gelince Özet'te "Yedekle" çıkar, tek dokunuş yeter.
     Aynı oturumda onay hâlâ geçerliyse (≈1 saat) sormadan yedekler.
   ===================================================================== */

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER = 'Bütçem yedekleri';
const DRIVE_EVERY = 7 * 864e5;
const DRIVE_TOK = 'butce.driveTok';
let driveBusy = false;
let driveSetup = false; // Google Drive bağlantısı projede kapalıysa

const driveDue = () => !!(db.settings.driveOn && sync.user && Date.now() - (db.settings.driveLast || 0) > DRIVE_EVERY);
const daysAgo = (ms) => Math.floor((Date.now() - ms) / 864e5);

function driveToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(DRIVE_TOK) || 'null');
    return t && t.uid === sync.user?.uid && t.exp > Date.now() + 60000 ? t.token : null;
  } catch { return null; }
}

async function driveAuth() {
  const { auth } = sync.fb;
  const provider = new auth.GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  provider.setCustomParameters({ login_hint: sync.user.email || '' });
  const res = await auth.reauthenticateWithPopup(sync.user, provider);
  const cred = auth.GoogleAuthProvider.credentialFromResult(res);
  if (!cred?.accessToken) throw new Error('Google erişim izni alınamadı');
  try { sessionStorage.setItem(DRIVE_TOK, JSON.stringify({ token: cred.accessToken, uid: sync.user.uid, exp: Date.now() + 50 * 60000 })); } catch {}
  return cred.accessToken;
}

async function driveFetch(token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    const e = new Error(`Drive ${r.status}`);
    e.status = r.status;
    e.body = body;
    throw e;
  }
  return r.json();
}

async function driveFolder(token) {
  const q = encodeURIComponent(`name='${DRIVE_FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await driveFetch(token, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  if (found.files?.length) return found.files[0].id;
  const made = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return made.id;
}

async function driveUpload(token) {
  const folder = await driveFolder(token);
  const d = new Date();
  const name = `butcem-yedek-${todayISO()}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  const boundary = `butcem${Math.random().toString(36).slice(2)}`;
  const meta = { name, parents: [folder], mimeType: 'application/json', description: 'Bütçem otomatik yedeği. Geri yüklemek için: Ayarlar → Yedekten geri yükle.' };
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`
    + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${backupJson()}\r\n--${boundary}--`;
  const res = await driveFetch(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return { ...res, folder };
}

function driveErrText(e) {
  const c = e?.code || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return 'Yedekleme yarıda kaldı';
  if (c === 'auth/user-mismatch') return 'Farklı bir Google hesabı seçildi; uygulamaya girdiğin hesabı seç';
  if (c === 'auth/popup-blocked') return 'Google penceresi engellendi; tekrar dene';
  if (e?.status === 403 && /accessNotConfigured|has not been used|SERVICE_DISABLED|disabled/i.test(e.body || '')) {
    driveSetup = true;
    return 'Google Drive bağlantısı henüz açılmamış (Ayarlar\'a bak)';
  }
  if (e?.status === 403 && /insufficient|scope/i.test(e.body || '')) return 'Drive izni verilmedi; tekrar dene ve izin kutusunu işaretle';
  if (!navigator.onLine) return 'İnternet yok';
  return `Drive yedeği alınamadı (${e?.status || c || e?.message || 'hata'})`;
}

async function backupToDrive({ silent = false } = {}) {
  if (driveBusy) return;
  if (!sync.user || !sync.fb) { if (!silent) toast('Önce Google ile giriş yap'); return; }
  let token = driveToken();
  if (!token && silent) return;
  driveBusy = true;
  if (!silent) render();
  try {
    if (!token) token = await driveAuth();
    let res;
    try { res = await driveUpload(token); }
    catch (e) {
      if (e.status !== 401 || silent) throw e;
      try { sessionStorage.removeItem(DRIVE_TOK); } catch {}
      token = await driveAuth();
      res = await driveUpload(token);
    }
    driveSetup = false;
    db.settings.driveOn = true;
    db.settings.driveFolder = res.folder;
    setSetting('driveLast', Date.now());
    if (!silent) toast('Yedek Google Drive\'a kaydedildi');
  } catch (e) {
    console.warn('Drive yedeği', e);
    if (!silent) toast(driveErrText(e));
  } finally {
    driveBusy = false;
    render();
  }
}

// Onay hâlâ geçerliyse (aynı oturum) sormadan yedekle
function driveAutoTry() { if (driveDue() && driveToken()) backupToDrive({ silent: true }); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(driveAutoTry, 3000); });
setTimeout(driveAutoTry, 8000);

/* ------------------------------ görünüm ------------------------------ */

function driveTodo() {
  if (!driveDue()) return '';
  const last = db.settings.driveLast;
  return `<div class="todo">
    <span class="todo-ico soon">${icon('cloud-upload', 18)}</span>
    <span class="todo-main"><b>Haftalık Drive yedeği</b><small>${last ? `Son yedek ${daysAgo(last)} gün önce` : 'Henüz yedek yok'}</small></span>
    <button class="btn small ok" data-action="drive-backup" ${driveBusy ? 'disabled' : ''}>${driveBusy ? 'Yedekleniyor…' : 'Yedekle'}</button>
  </div>`;
}

function driveCard() {
  if (!syncConfigured()) return '';
  const s = db.settings;
  const setup = driveSetup ? `<p class="exp small">Google Drive bağlantısı bu projede henüz açık değil. <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${esc(window.FIREBASE_CONFIG.projectId)}" target="_blank" rel="noopener">Buradan "Etkinleştir"</a> de, birkaç dakika sonra tekrar dene.</p>` : '';
  if (!sync.user) return '';
  if (!s.driveOn) {
    return `<div class="card">
      <h3>Google Drive yedeği</h3>
      <p class="muted small" style="margin-top:-6px">Her hafta tüm kayıtlarının bir kopyası Drive'ındaki "${DRIVE_FOLDER}" klasörüne kaydedilir. Dosyaları sadece sen görürsün; uygulama Drive'ındaki başka hiçbir dosyayı göremez.</p>
      ${setup}
      <button class="btn primary block" data-action="drive-backup" ${driveBusy ? 'disabled' : ''}>${icon('cloud-upload', 18)} ${driveBusy ? 'Yedekleniyor…' : 'İlk yedeği al ve başlat'}</button>
    </div>`;
  }
  const last = s.driveLast || 0;
  const next = last + DRIVE_EVERY;
  return `<div class="card">
    <h3>Google Drive yedeği</h3>
    <div class="sync-detail">
      <div><span>Son yedek</span><b>${last ? `${syncTime(last)} · ${daysAgo(last) ? `${daysAgo(last)} gün önce` : 'bugün'}` : 'Yok'}</b></div>
      <div><span>Sıradaki</span><b>${next <= Date.now() ? 'Şimdi (Özet\'te "Yedekle")' : syncTime(next).replace(/\s\d\d:\d\d$/, '')}</b></div>
    </div>
    <p class="muted small">Google güvenlik gereği her yedekte onay ister; zamanı gelince Özet'te tek dokunuşla alırsın. Geri yüklemek için dosyayı Drive'dan indirip "Yedekten geri yükle"yi kullan.</p>
    ${setup}
    <div class="row">
      <button class="btn" data-action="drive-backup" ${driveBusy ? 'disabled' : ''}>${driveBusy ? 'Yedekleniyor…' : 'Şimdi yedekle'}</button>
      ${s.driveFolder ? `<a class="btn" href="https://drive.google.com/drive/folders/${esc(s.driveFolder)}" target="_blank" rel="noopener">Klasörü aç</a>` : ''}
    </div>
    <button class="link" style="margin-top:10px" data-action="drive-stop">Haftalık yedeği durdur</button>
  </div>`;
}

Object.assign(actions, {
  'drive-backup': () => backupToDrive(),
  'drive-stop': () => { if (confirm('Haftalık Drive yedeği durdurulsun mu? Drive\'daki eski yedekler kalır.')) { setSetting('driveOn', false); render(); toast('Drive yedeği durduruldu'); } },
});
