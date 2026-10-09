'use strict';

/* =====================================================================
   Uygulama kilidi (PIN) — yalnızca bu cihaz için.
   - Uygulama 5 dakikadan uzun kapalı / arka planda kalınca açılışta PIN sorulur.
   - PIN düz saklanmaz; PBKDF2 ile türetilmiş özeti tutulur.
   - PIN unutulursa Google hesabıyla doğrulayıp kilit kaldırılır.
   ===================================================================== */

const LOCK_KEY = 'butce.lock';
const LOCK_SEEN = 'butce.lockSeen';
const LOCK_AFTER = 5 * 60 * 1000;
const LOCK_TRIES = 5;

let lockCfg = (() => { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch { return null; } })();
const lockOn = () => !!lockCfg?.hash;
let lk = null; // açık kilit ekranı: { mode: 'unlock' | 'set1' | 'set2' | 'off' | 'change', pin, first, err, busy }

function saveLockCfg() {
  try { lockCfg ? localStorage.setItem(LOCK_KEY, JSON.stringify(lockCfg)) : localStorage.removeItem(LOCK_KEY); } catch {}
}
function touchSeen() { try { localStorage.setItem(LOCK_SEEN, String(Date.now())); } catch {} }
const lastSeen = () => { try { return Number(localStorage.getItem(LOCK_SEEN) || 0); } catch { return 0; } };

async function pinHash(pin, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 150000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

/* ------------------------------ ekran ------------------------------ */

const LOCK_TEXT = {
  unlock: ['Bütçem kilitli', 'PIN\'ini gir'],
  set1: ['Yeni PIN', '4–6 haneli bir PIN belirle'],
  set2: ['PIN\'i tekrar gir', 'Doğrulamak için aynı PIN\'i gir'],
  off: ['Kilidi kapat', 'Mevcut PIN\'ini gir'],
  change: ['PIN\'i değiştir', 'Önce mevcut PIN\'ini gir'],
};

function lockTarget() {
  if (!lk) return 0;
  if (lk.mode === 'set1') return 6;
  if (lk.mode === 'set2') return lk.first.length;
  return lockCfg?.len || 4;
}

function drawLock() {
  let root = document.getElementById('lock-root');
  if (!lk) { if (root) root.remove(); document.documentElement.classList.remove('locked'); return; }
  if (!root) {
    root = document.createElement('div');
    root.id = 'lock-root';
    root.className = 'lock-screen';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    document.body.appendChild(root);
  }
  document.documentElement.classList.add('locked');
  const [title, sub] = LOCK_TEXT[lk.mode];
  const n = lockTarget();
  const wait = !['set1', 'set2'].includes(lk.mode) && lockCfg?.until && lockCfg.until > Date.now() ? Math.ceil((lockCfg.until - Date.now()) / 1000) : 0;
  const dots = Array.from({ length: lk.mode === 'set1' ? Math.max(4, lk.pin.length) : n }, (_, i) => `<i class="${i < lk.pin.length ? 'on' : ''}"></i>`).join('');
  const setting = lk.mode !== 'unlock';
  const left = setting ? `<button data-lk="cancel" class="lk-txt">Vazgeç</button>`
    : `<button data-lk="forgot" class="lk-txt">Unuttum</button>`;
  root.innerHTML = `<div class="lk-box">
    <span class="lk-ico">${icon('lock', 26)}</span>
    <h2>${esc(title)}</h2>
    <p class="lk-sub">${esc(wait ? `Çok fazla hatalı deneme. ${wait} saniye sonra tekrar dene.` : lk.err || sub)}</p>
    <div class="lk-dots ${lk.err ? 'shake' : ''}">${dots}</div>
    <div class="lk-pad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-lk="d" data-d="${d}" ${wait || lk.busy ? 'disabled' : ''}>${d}</button>`).join('')}
      ${left}
      <button data-lk="d" data-d="0" ${wait || lk.busy ? 'disabled' : ''}>0</button>
      <button data-lk="back" class="lk-txt" aria-label="Sil">${icon('delete', 24)}</button>
    </div>
    ${lk.mode === 'set1' && lk.pin.length >= 4 && lk.pin.length < 6 ? `<button class="btn primary block" data-lk="next">Devam</button>` : '<div class="lk-gap"></div>'}
  </div>`;
  if (wait) setTimeout(() => lk && drawLock(), 1000);
}

/* ----------------------------- işleyiş ----------------------------- */

async function lockSubmit() {
  const pin = lk.pin;
  if (lk.mode === 'set1') { lk = { mode: 'set2', pin: '', first: pin, err: '' }; return drawLock(); }
  if (lk.mode === 'set2') {
    if (pin !== lk.first) { lk = { mode: 'set1', pin: '', first: '', err: 'PIN\'ler eşleşmedi, baştan dene' }; return drawLock(); }
    lk.busy = true; drawLock();
    const salt = uid() + uid();
    lockCfg = { hash: await pinHash(pin, salt), salt, len: pin.length, fails: 0, until: 0 };
    saveLockCfg();
    lk = null; drawLock(); touchSeen(); render();
    return toast('Kilit açıldı. Uygulama 5 dakikadan uzun kapalı kalınca PIN sorulacak.');
  }
  // unlock / off / change: mevcut PIN'i doğrula
  lk.busy = true; drawLock();
  const ok = (await pinHash(pin, lockCfg.salt)) === lockCfg.hash;
  lk.busy = false;
  if (!ok) {
    lockCfg.fails = (lockCfg.fails || 0) + 1;
    if (lockCfg.fails >= LOCK_TRIES) lockCfg.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (lockCfg.fails - LOCK_TRIES)) * 1000;
    saveLockCfg();
    lk.pin = '';
    lk.err = `Yanlış PIN${lockCfg.fails >= 3 && lockCfg.fails < LOCK_TRIES ? ` · ${LOCK_TRIES - lockCfg.fails} deneme hakkın kaldı` : ''}`;
    return drawLock();
  }
  lockCfg.fails = 0; lockCfg.until = 0; saveLockCfg();
  if (lk.mode === 'change') { lk = { mode: 'set1', pin: '', first: '', err: '' }; return drawLock(); }
  if (lk.mode === 'off') {
    lockCfg = null; saveLockCfg();
    lk = null; drawLock(); render();
    return toast('Kilit kapatıldı');
  }
  lk = null; drawLock(); touchSeen();
}

async function lockForgot() {
  if (!sync.fb || !sync.ready) { lk.err = 'Bağlanıyor, birkaç saniye sonra tekrar dene'; return drawLock(); }
  if (!sync.user) { lk.err = 'Bu cihazda Google girişi yok; PIN gerekiyor'; return drawLock(); }
  const { auth } = sync.fb;
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ login_hint: sync.user.email || '', prompt: 'select_account' });
  try {
    await auth.reauthenticateWithPopup(sync.user, provider);
    lockCfg = null; saveLockCfg();
    lk = null; drawLock(); touchSeen(); render();
    toast('Kilit kaldırıldı. Ayarlar\'dan yeni PIN belirleyebilirsin.');
  } catch (e) {
    lk.err = e.code === 'auth/user-mismatch' ? 'Farklı bir Google hesabı seçildi' : e.code === 'auth/popup-closed-by-user' ? 'Doğrulama yarıda kaldı' : 'Google doğrulaması yapılamadı';
    drawLock();
  }
}

function lockKey(d) {
  if (!lk || lk.busy || (lockCfg?.until && lockCfg.until > Date.now() && !['set1', 'set2'].includes(lk.mode))) return;
  if (lk.pin.length >= 6) return;
  lk.pin += d;
  lk.err = '';
  if (lk.pin.length === lockTarget()) { drawLock(); setTimeout(lockSubmit, 90); } else drawLock();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-lk]');
  if (!b || !lk || b.disabled) return;
  e.preventDefault();
  const k = b.dataset.lk;
  if (k === 'd') lockKey(b.dataset.d);
  else if (k === 'back') { lk.pin = lk.pin.slice(0, -1); drawLock(); }
  else if (k === 'next') lockSubmit();
  else if (k === 'cancel') { lk = null; drawLock(); }
  else if (k === 'forgot') lockForgot();
});

// Bilgisayarda klavyeyle de girilebilsin
document.addEventListener('keydown', (e) => {
  if (!lk) return;
  e.stopImmediatePropagation();
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); lockKey(e.key); }
  else if (e.key === 'Backspace') { e.preventDefault(); lk.pin = lk.pin.slice(0, -1); drawLock(); }
  else if (e.key === 'Enter' && lk.mode === 'set1' && lk.pin.length >= 4) { e.preventDefault(); lockSubmit(); }
  else if (e.key === 'Escape' && lk.mode !== 'unlock') { lk = null; drawLock(); }
}, true);

function lockNow() {
  if (!lockOn() || lk?.mode === 'unlock') return;
  lk = { mode: 'unlock', pin: '', first: '', err: '' };
  drawLock();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (!lk) touchSeen(); return; }
  if (lockOn() && !lk && Date.now() - lastSeen() > LOCK_AFTER) lockNow();
});
setInterval(() => { if (!document.hidden && !lk) touchSeen(); }, 30000);
window.addEventListener('pagehide', () => { if (!lk) touchSeen(); });

// Açılışta: son kullanımdan bu yana 5 dakikadan fazla geçtiyse kilitle
if (lockOn() && Date.now() - lastSeen() > LOCK_AFTER) lockNow();
else touchSeen();

/* ------------------------------ Ayarlar ------------------------------ */

function lockCard() {
  const on = lockOn();
  return `<div class="card">
    <h3>Uygulama kilidi</h3>
    ${on
      ? `<div class="setting"><div><b>Açık · ${lockCfg.len} haneli PIN</b><p>Uygulama 5 dakikadan uzun kapalı kalınca sorulur. Sadece bu cihaz için.</p></div></div>
        <div class="row"><button class="btn" data-action="lock-change">PIN'i değiştir</button><button class="btn" data-action="lock-off">Kilidi kapat</button></div>`
      : `<p class="muted small" style="margin-top:-6px">Uygulama 5 dakikadan uzun kapalı kalınca açılışta PIN sorulur. Sadece bu cihaz için geçerlidir.</p>
        ${syncConfigured() && !sync.user ? '<p class="muted small">Önce Google ile giriş yap; PIN\'i unutursan Google hesabınla açabilirsin.</p>' : ''}
        <button class="btn primary block" data-action="lock-set" ${syncConfigured() && !sync.user ? 'disabled' : ''}>${icon('lock', 18)} PIN belirle</button>`}
  </div>`;
}

Object.assign(actions, {
  'lock-set': () => { lk = { mode: 'set1', pin: '', first: '', err: '' }; drawLock(); },
  'lock-change': () => { lk = { mode: 'change', pin: '', first: '', err: '' }; drawLock(); },
  'lock-off': () => { lk = { mode: 'off', pin: '', first: '', err: '' }; drawLock(); },
});
