'use strict';

/* =====================================================================
   Bakiye eşitleme
   - "Ziraat'te gerçekte ne kadar var?" → uygulamadaki bakiyeyle farkı gösterir.
   - Fark; kayıtsız harcama/gelir olarak (toplamlara girer) ya da yalnızca
     bakiye düzeltmesi olarak (type 'adjust', gelir/gider sayılmaz) kaydedilir.
   - Bir hesap 30 günden uzun kontrol edilmediyse Özet'te hatırlatılır.
   ===================================================================== */

const RECON_EVERY = 30 * 864e5;
const OTHER_EXP = defCatId('expense', 'Diğer');
const OTHER_INC = defCatId('income', 'Diğer gelir');
let recon = null;

const reconDue = (a) => {
  const since = a.reconAt || a.createdAt || 0;
  return Date.now() - (a.createdAt || 0) > 14 * 864e5 && Date.now() - since > RECON_EVERY;
};

function openRecon(accId) {
  const a = accById(accId);
  if (!a) return;
  recon = { accId, text: '' };
  renderRecon();
}

function reconCalc() {
  const a = accById(recon.accId);
  const app = accBalance(a);
  const real = parseAmount(recon.text);
  if (!Number.isFinite(real)) return { a, app, real: null, diff: 0 };
  // Bankada: gerçek − uygulama (artı = fazla para). Kartta: borç farkı (artı = borç fazla).
  return { a, app, real, diff: real - app };
}

function renderRecon() {
  const c = reconCalc();
  const credit = c.a.kind === 'credit';
  const lessMoney = credit ? c.diff > 0 : c.diff < 0; // paran uygulamadakinden az (ya da borcun fazla)
  const d = Math.abs(c.diff);
  openSheet(`
    <div class="sheet-head"><h2>Bakiyeyi eşitle</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <p class="muted small" style="margin-top:-6px">${esc(c.a.name)} için bankanın uygulamasında ya da cüzdanında gördüğün ${credit ? 'toplam borcu' : 'tutarı'} yaz.</p>
    <div class="recon-now"><span>Uygulamada</span><b>${money(c.app)}</b></div>
    <div class="field"><label>${credit ? 'Gerçekte toplam borç' : 'Gerçekte olan'}</label>
      <div class="amount-field"><input id="rc-real" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(recon.text)}" data-input="recon"><span>${esc(db.settings.currency)}</span></div>
    </div>
    <div id="recon-out">${reconOut(c, lessMoney, d)}</div>
  `);
  setTimeout(() => $('#rc-real')?.focus(), 60);
}

function reconOut(c, lessMoney, d) {
  if (c.real == null) return '';
  if (!c.diff) return `<div class="recon-ok">${icon('circle-check', 20)} Tutuyor, fark yok.</div>
    <button class="btn primary block" data-action="recon-ok">Tamam, kontrol edildi</button>`;
  const credit = c.a.kind === 'credit';
  return `<div class="recon-diff ${lessMoney ? 'exp' : 'inc'}">
      <small>${lessMoney ? (credit ? 'Borç uygulamadakinden fazla' : 'Uygulamadakinden az') : (credit ? 'Borç uygulamadakinden az' : 'Uygulamadakinden fazla')}</small>
      <b>${lessMoney ? '−' : '+'}${money(d)}</b>
    </div>
    <p class="muted small">${lessMoney ? 'Muhtemelen girmeyi unuttuğun harcamalar var.' : 'Muhtemelen girmeyi unuttuğun bir gelir ya da iade var.'} Bunu nasıl kaydedelim?</p>
    <div class="btn-stack">
      <button class="btn primary" data-action="recon-save" data-mode="tx">${lessMoney ? 'Kayıtsız harcama olarak ekle' : 'Kayıtsız gelir olarak ekle'}<small>${lessMoney ? 'Gider sayılır, bütçeye girer' : 'Gelir sayılır'}</small></button>
      <button class="btn" data-action="recon-save" data-mode="adjust">Sadece bakiyeyi düzelt<small>Gelir/gider sayılmaz</small></button>
    </div>`;
}

function refreshRecon() {
  recon.text = $('#rc-real')?.value || '';
  const c = reconCalc();
  const credit = c.a.kind === 'credit';
  const box = $('#recon-out');
  if (box) box.innerHTML = reconOut(c, credit ? c.diff > 0 : c.diff < 0, Math.abs(c.diff));
}

function markRecon(a) {
  a.reconAt = Date.now();
  a.updatedAt = Date.now();
  touch('acc', a.id);
}

function saveRecon(mode) {
  const c = reconCalc();
  if (c.real == null) { $('#rc-real')?.classList.add('invalid'); toast('Tutarı yaz'); return; }
  const a = c.a;
  const credit = a.kind === 'credit';
  const lessMoney = credit ? c.diff > 0 : c.diff < 0;
  const amount = Math.abs(c.diff);
  const now = Date.now();
  const id = uid();
  if (amount) {
    if (mode === 'tx') {
      const catId = lessMoney ? OTHER_EXP : OTHER_INC;
      const cat = catMap()[catId] ? catId : db.categories.find((x) => x.type === (lessMoney ? 'expense' : 'income'))?.id;
      db.transactions.push({ id, type: lessMoney ? 'expense' : 'income', amount, categoryId: cat, accountId: a.id, date: todayISO(), note: lessMoney ? 'Kayıtsız harcama (bakiye eşitleme)' : 'Kayıtsız gelir (bakiye eşitleme)', feeAmt: 0, awaiting: false, createdAt: now, updatedAt: now });
    } else {
      db.transactions.push({ id, type: 'adjust', amount, flow: lessMoney ? 'out' : 'in', accountId: a.id, date: todayISO(), note: 'Bakiye düzeltme', categoryId: null, awaiting: false, createdAt: now, updatedAt: now });
    }
    touch('tx', id);
  }
  markRecon(a);
  save();
  closeSheet();
  render();
  toast(amount ? `${a.name} eşitlendi · ${money(accBalance(a))}` : `${a.name} kontrol edildi`);
}

// Liste satırında bakiye düzeltmesi
function adjustRow(t, showDate) {
  const a = accById(t.accountId);
  const credit = a?.kind === 'credit';
  const up = credit ? t.flow === 'out' : t.flow === 'in';
  const sub = [a ? a.name : '', showDate ? shortDay(t.date) : ''].filter(Boolean).join(' · ');
  return `<button class="tx" data-action="edit-tx" data-id="${t.id}">
    <span class="ico" style="--c:#5F6B7A">${icon('refresh-cw', 18)}</span>
    <span class="tx-main"><b>Bakiye düzeltme</b><small>${esc(sub)}</small></span>
    <span class="amt muted">${t.flow === 'in' ? '+' : '−'}${money(t.amount)}</span>
  </button>`;
}

function openAdjust(t) {
  const a = accById(t.accountId);
  openSheet(`
    <div class="sheet-head"><h2>Bakiye düzeltme</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <p>${esc(a?.name || 'Hesap')} · ${longDate(t.date)}</p>
    <p class="muted small">${t.flow === 'in' ? 'Bakiyeye eklendi' : 'Bakiyeden düşüldü'}: <b>${money(t.amount)}</b>. Gelir ya da gider sayılmaz.</p>
    <div class="actions"><button class="btn danger" data-action="delete-tx" data-id="${t.id}">Sil</button><button class="btn" data-action="close-sheet">Kapat</button></div>`);
}

// Özet'teki hatırlatma: en uzun süredir kontrol edilmeyen tek hesap
function reconTodo() {
  const a = db.accounts.filter(reconDue).sort((x, y) => (x.reconAt || x.createdAt || 0) - (y.reconAt || y.createdAt || 0))[0];
  if (!a) return '';
  const days = Math.floor((Date.now() - (a.reconAt || a.createdAt || 0)) / 864e5);
  return `<div class="todo">
    <span class="todo-ico soon">${icon('refresh-cw', 18)}</span>
    <span class="todo-main"><b>${esc(a.name)} ${a.kind === 'credit' ? 'borcu' : 'bakiyesi'} tutuyor mu?</b><small>${a.reconAt ? `Son kontrol ${days} gün önce` : 'Hiç kontrol edilmedi'} · uygulamada ${money(accBalance(a))}</small></span>
    <button class="btn small" data-action="recon-open" data-id="${a.id}">Kontrol et</button>
  </div>`;
}

Object.assign(actions, {
  'recon-open': (el) => openRecon(el.dataset.id),
  'recon-save': (el) => saveRecon(el.dataset.mode),
  'recon-ok': () => saveRecon('adjust'),
});

document.addEventListener('input', (e) => { if (e.target.dataset?.input === 'recon' && recon) { e.target.classList.remove('invalid'); refreshRecon(); } });
