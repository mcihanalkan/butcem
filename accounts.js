'use strict';

/* =====================================================================
   Kartlar ve hesaplar: kredi kartı, banka hesabı / kartı, nakit.
   - Harcama/gelir kaydında "accountId" ile hangi karttan/hesaptan yapıldığı tutulur.
   - Kart ödemesi ve hesaplar arası para aktarımı "transfer" türünde kayıttır
     (gelir/gider sayılmaz; harcama zaten kartla yapıldığı an gider olarak sayıldı).
   - Açılışta girilen borç/bakiye "opening"; sonrasında girilen kayıtlar üstüne eklenir.
   ===================================================================== */

const ACC_KINDS = {
  credit: { label: 'Kredi kartı', icon: '💳' },
  bank: { label: 'Banka hesabı / kartı', icon: '🏦' },
  cash: { label: 'Nakit', icon: '💵' },
};
const CARD_COLORS = ['#1f2937', '#4c1d95', '#991b1b', '#115e59', '#1e3a8a', '#9a3412', '#9d174d', '#166534', '#854d0e', '#475569'];

const accById = (id) => db.accounts.find((a) => a.id === id);
const accIcon = (a) => ACC_KINDS[a.kind]?.icon || '💳';
const accLabel = (a) => `${a.name}${a.last4 ? ` •${a.last4}` : ''}`;
// Hesap açıldıktan sonra girilen kayıtlar bakiyeye eklenir (öncekiler açılış tutarının içinde).
const accCounts = (a, t) => (t.createdAt || 0) >= (a.createdAt || 0);

/* Kredi kartında: borç (pozitif = borç). Banka/nakitte: bakiye. */
function accBalance(a, until = '9999-12-31') {
  let v = a.opening || 0;
  const credit = a.kind === 'credit';
  for (const t of db.transactions) {
    if (t.date > until || !accCounts(a, t)) continue;
    if (t.type === 'transfer') {
      if (t.toId === a.id) v += credit ? -t.amount : t.amount;
      if (t.fromId === a.id) v += credit ? t.amount : -t.amount;
    } else if (t.accountId === a.id) {
      const out = t.type === 'expense';
      v += credit ? (out ? t.amount : -t.amount) : out ? -t.amount : t.amount;
    }
  }
  return v;
}

function lastStatement(a, today = todayISO()) {
  const d = fromISO(today);
  const s = dueIn(d.getFullYear(), d.getMonth(), a.statementDay);
  return s <= today ? s : dueIn(d.getFullYear(), d.getMonth() - 1, a.statementDay);
}
function dueAfter(a, stmt) {
  const d = fromISO(stmt);
  const c = dueIn(d.getFullYear(), d.getMonth(), a.dueDay);
  return c > stmt ? c : dueIn(d.getFullYear(), d.getMonth() + 1, a.dueDay);
}

function cardStatus(a) {
  const today = todayISO();
  const debt = accBalance(a);
  const stmt = lastStatement(a);
  const due = dueAfter(a, stmt);
  const stmtDebt = Math.max(0, a.stmtOpeningDate === stmt && a.stmtOpening != null ? a.stmtOpening : accBalance(a, stmt));
  let paid = 0;
  for (const t of db.transactions) if (t.type === 'transfer' && t.toId === a.id && t.date > stmt && accCounts(a, t)) paid += t.amount;
  const remaining = Math.max(0, stmtDebt - paid);
  const minDue = Math.max(0, Math.round((stmtDebt * (a.minPct || 20)) / 100) - paid);
  const limit = a.limit || 0;
  const usage = limit ? debt / limit : 0;
  const daysToDue = dayDiff(fromISO(today), fromISO(due));
  let level = 'ok';
  if (remaining > 0 && daysToDue < 0) level = 'late';
  else if (remaining > 0 && daysToDue <= 5) level = 'soon';
  return { a, debt, stmt, due, stmtDebt, paid, remaining, minDue, limit, available: limit - debt, usage, daysToDue, level };
}

function cardAttention() {
  return db.accounts.filter((a) => a.kind === 'credit').map(cardStatus).filter((s) => s.level !== 'ok');
}

function dueText(s) {
  if (s.remaining <= 0) return s.stmtDebt > 0 ? 'Dönem borcu ödendi ✓' : 'Ödenecek dönem borcu yok';
  if (s.daysToDue < 0) return `Son ödeme ${-s.daysToDue} gün geçti!`;
  if (s.daysToDue === 0) return 'Son ödeme bugün!';
  return `Son ödemeye ${s.daysToDue} gün`;
}

/* ------------------------------ görünüm ------------------------------ */

function cardTile(s) {
  const a = s.a;
  const pct = Math.min(1, Math.max(0, s.usage)) * 100;
  return `<button class="ccard" style="--cc:${a.color || CARD_COLORS[0]}" data-action="acc-open" data-id="${a.id}">
    <span class="cc-top"><span>${esc(a.bank || 'Kredi kartı')}</span><span>${a.last4 ? `•••• ${esc(a.last4)}` : '💳'}</span></span>
    <span class="cc-name">${esc(a.name)}</span>
    <span class="cc-debt"><small>Borç</small><b>${money(s.debt)}</b></span>
    <span class="cc-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
    <span class="cc-foot"><span>Kullanılabilir ${moneyRound(s.available)}</span><span>Limit ${moneyRound(s.limit)}</span></span>
  </button>
  <div class="cc-due ${s.level}">
    <span>📅 ${shortDay(s.due)} · ${esc(dueText(s))}</span>
    ${s.remaining > 0 ? `<span>Dönem <b>${moneyRound(s.remaining)}</b> · ${s.minDue ? `Asgari <b>${moneyRound(s.minDue)}</b>` : 'Asgari ödendi ✓'}</span>` : ''}
  </div>`;
}

function viewCards() {
  const credits = db.accounts.filter((a) => a.kind === 'credit');
  const others = db.accounts.filter((a) => a.kind !== 'credit');
  if (!db.accounts.length) {
    return `${viewHead('Kartlar')}
      <div class="card empty-card">
        <span class="big">💳</span>
        <b>Kartlarını ve hesaplarını ekle</b>
        <p>Kredi kartı borcunu, limitini, son ödeme gününü takip et; harcamayı hangi kartla yaptığını seç.</p>
        <div class="btn-stack">
          <button class="btn primary" data-action="acc-new" data-kind="credit">💳 Kredi kartı ekle</button>
          <button class="btn" data-action="acc-new" data-kind="bank">🏦 Banka hesabı / kartı ekle</button>
          <button class="btn" data-action="acc-new" data-kind="cash">💵 Nakit cüzdan ekle</button>
        </div>
      </div>`;
  }
  const cs = credits.map(cardStatus);
  const totalDebt = cs.reduce((x, s) => x + Math.max(0, s.debt), 0);
  const totalAvail = cs.reduce((x, s) => x + Math.max(0, s.available), 0);
  const cashSum = others.reduce((x, a) => x + accBalance(a), 0);
  return `${viewHead('Kartlar', `<button class="btn small" data-action="acc-new">+ Ekle</button>`)}
    <div class="sum-strip">
      <div><small>Kart borcu</small><b class="exp">${moneyRound(totalDebt)}</b></div>
      <div><small>Kullanılabilir limit</small><b>${moneyRound(totalAvail)}</b></div>
      <div><small>Hesaplardaki para</small><b class="inc">${moneyRound(cashSum)}</b></div>
    </div>
    ${cs.length ? `<h2 class="sec">Kredi kartları</h2><div class="ccards">${cs.map(cardTile).join('')}</div>` : ''}
    ${others.length ? `<h2 class="sec">Hesaplar</h2><div class="list">${others.map((a) => `<button class="tx" data-action="acc-open" data-id="${a.id}">
        <span class="ico" style="--c:${a.color || '#64748b'}">${accIcon(a)}</span>
        <span class="tx-main"><b>${esc(accLabel(a))}</b><small>${esc(a.bank || ACC_KINDS[a.kind].label)}</small></span>
        <span class="amt ${accBalance(a) >= 0 ? '' : 'exp'}">${money(accBalance(a))}</span>
      </button>`).join('')}</div>` : ''}
    <button class="btn block" style="margin-top:14px" data-action="xfer-new">↔️ Kart ödemesi / para transferi</button>
  `;
}

/* ------------------------------ kart detayı ------------------------------ */

function openAccount(id) {
  const a = accById(id);
  if (!a) return;
  const cm = catMap();
  const txs = sortTx(db.transactions.filter((t) => t.accountId === a.id || t.fromId === a.id || t.toId === a.id)).slice(0, 12);
  const credit = a.kind === 'credit';
  const s = credit ? cardStatus(a) : null;
  openSheet(`
    <div class="sheet-head"><h2>${accIcon(a)} ${esc(accLabel(a))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
    ${credit ? `
      <div class="kpis">
        <div><small>Toplam borç</small><b class="exp">${money(s.debt)}</b></div>
        <div><small>Kullanılabilir</small><b>${money(s.available)}</b></div>
        <div><small>Dönem borcu (${shortDay(s.stmt)} kesim)</small><b>${money(s.stmtDebt)}</b></div>
        <div><small>Kalan dönem borcu</small><b class="${s.remaining ? 'exp' : 'inc'}">${money(s.remaining)}</b></div>
        <div><small>Asgari ödeme</small><b>${money(s.minDue)}</b></div>
        <div><small>Son ödeme</small><b>${shortDay(s.due)}</b></div>
      </div>
      <p class="cc-due ${s.level}" style="margin:10px 0 0">${esc(dueText(s))}</p>`
    : `<div class="kpis"><div><small>Bakiye</small><b>${money(accBalance(a))}</b></div></div>`}
    <div class="row" style="margin:14px 0">
      ${credit ? `<button class="btn primary" data-action="xfer-new" data-to="${a.id}">Ödeme yap</button>` : `<button class="btn primary" data-action="xfer-new" data-from="${a.id}">Transfer</button>`}
      <button class="btn" data-action="acc-add-tx" data-id="${a.id}">+ ${credit ? 'Harcama' : 'İşlem'}</button>
      <button class="btn" data-action="acc-edit" data-id="${a.id}">Düzenle</button>
    </div>
    <h3>Son hareketler</h3>
    ${txs.length ? `<div class="list" style="box-shadow:none">${txs.map((t) => txRow(t, cm, true)).join('')}</div>` : '<p class="muted" style="font-size:13px">Bu karta/hesaba bağlı kayıt yok. İşlem eklerken bu kartı seçebilirsin.</p>'}
  `);
}

/* ------------------------------ kart formu ------------------------------ */

let accForm = null;

function openAccForm(init = {}) {
  accForm = { id: null, kind: 'credit', name: '', bank: '', last4: '', color: CARD_COLORS[0], limitText: '', balanceText: '', stmtText: '', statementDay: 1, dueDay: 11, minPct: 20, ...init };
  renderAccForm();
}

function syncAccForm() {
  if (!accForm || !$('#a-name')) return;
  const v = (id) => $(id)?.value ?? '';
  Object.assign(accForm, { name: v('#a-name'), bank: v('#a-bank'), last4: v('#a-last4'), limitText: v('#a-limit'), balanceText: v('#a-balance'), stmtText: v('#a-stmt') });
  if ($('#a-sday')) accForm.statementDay = Number(v('#a-sday'));
  if ($('#a-dday')) accForm.dueDay = Number(v('#a-dday'));
}

function renderAccForm() {
  const f = accForm;
  const editing = !!f.id;
  const credit = f.kind === 'credit';
  const days = (sel) => Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${sel === n ? 'selected' : ''}>${n}</option>`).join('');
  openSheet(`
    <div class="sheet-head"><h2>${editing ? 'Düzenle' : 'Yeni kart / hesap'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
    ${editing ? '' : `<div class="seg field">${Object.entries(ACC_KINDS).map(([k, v]) => `<button data-action="af-kind" data-val="${k}" class="${f.kind === k ? 'on' : ''}">${v.icon} ${k === 'bank' ? 'Banka' : v.label}</button>`).join('')}</div>`}
    <div class="row field">
      <div><label class="lbl">Ad</label><input id="a-name" value="${esc(f.name)}" maxlength="30" placeholder="${credit ? 'ör. Bonus, Axess' : f.kind === 'cash' ? 'Cüzdan' : 'ör. Maaş hesabı'}"></div>
      ${f.kind === 'cash' ? '' : `<div><label class="lbl">Banka</label><input id="a-bank" value="${esc(f.bank)}" maxlength="30" placeholder="ör. Garanti"></div>`}
    </div>
    ${f.kind === 'cash' ? '' : `<div class="field"><label class="lbl">Son 4 hane <span class="muted">(isteğe bağlı, kartları ayırt etmek için)</span></label><input id="a-last4" value="${esc(f.last4)}" inputmode="numeric" maxlength="4" placeholder="1234"></div>`}
    ${credit ? `
      <div class="row field">
        <div><label class="lbl">Kart limiti</label><input id="a-limit" inputmode="decimal" value="${esc(f.limitText)}" placeholder="0"></div>
        <div><label class="lbl">${editing ? 'Şu anki toplam borç' : 'Güncel toplam borç'}</label><input id="a-balance" inputmode="decimal" value="${esc(f.balanceText)}" placeholder="0"></div>
      </div>
      ${editing ? '' : `<div class="field"><label class="lbl">Son ekstre (dönem) borcu <span class="muted">(biliyorsan; boşsa toplam borç kabul edilir)</span></label><input id="a-stmt" inputmode="decimal" value="${esc(f.stmtText)}" placeholder="İsteğe bağlı"></div>`}
      <div class="row field">
        <div><label class="lbl">Hesap kesim günü</label><select id="a-sday">${days(f.statementDay)}</select></div>
        <div><label class="lbl">Son ödeme günü</label><select id="a-dday">${days(f.dueDay)}</select></div>
      </div>
      <div class="field"><label class="lbl">Asgari ödeme oranı</label>
        <div class="seg">${[20, 25, 30, 40].map((p) => `<button data-action="af-min" data-val="${p}" class="${f.minPct === p ? 'on' : ''}">%${p}</button>`).join('')}</div>
      </div>`
    : `<div class="field"><label class="lbl">${editing ? 'Şu anki bakiye' : 'Güncel bakiye'}</label><input id="a-balance" inputmode="decimal" value="${esc(f.balanceText)}" placeholder="0"></div>`}
    ${f.kind === 'cash' ? '' : `<div class="field"><label class="lbl">Renk</label><div class="swatches">${CARD_COLORS.map((c) => `<button data-action="af-color" data-val="${c}" class="${f.color === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>`}
    <div class="actions">
      ${editing ? `<button class="btn danger" data-action="af-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="af-save">Kaydet</button>
    </div>
  `);
}

function saveAcc() {
  syncAccForm();
  const f = accForm;
  if (!f.name.trim()) { toast('Bir ad ver'); $('#a-name').focus(); return; }
  const bal = f.balanceText.trim() ? parseAmount(f.balanceText) : 0;
  if (Number.isNaN(bal)) { toast('Borç/bakiye tutarını kontrol et'); return; }
  const limit = f.kind === 'credit' ? parseAmount(f.limitText) : 0;
  if (f.kind === 'credit' && !(limit > 0)) { toast('Kart limitini gir'); return; }
  const now = Date.now();
  const data = { kind: f.kind, name: f.name.trim(), bank: f.bank.trim(), last4: f.last4.replace(/\D/g, '').slice(-4), color: f.kind === 'cash' ? '#15803d' : f.color, limit, statementDay: f.statementDay, dueDay: f.dueDay, minPct: f.minPct, updatedAt: now };
  let id = f.id;
  if (id) {
    const a = accById(id);
    // Bakiye elle düzeltildiyse farkı açılış tutarına yansıt
    const cur = accBalance(a);
    Object.assign(a, data);
    if (bal !== cur) a.opening = (a.opening || 0) + (bal - cur);
  } else {
    id = uid();
    const acc = { id, ...data, opening: bal, createdAt: now };
    if (f.kind === 'credit' && f.stmtText.trim()) {
      const sd = parseAmount(f.stmtText);
      if (sd >= 0) { acc.stmtOpening = sd; acc.stmtOpeningDate = lastStatement(acc); }
    }
    db.accounts.push(acc);
  }
  touch('acc', id);
  save();
  closeSheet();
  render();
  toast('Kaydedildi ✓');
}

function deleteAcc() {
  const a = accById(accForm.id);
  if (!a || !confirm(`"${a.name}" silinsin mi?\nBu karta bağlı harcamaların silinmez, sadece kart bilgisi kalkar.`)) return;
  db.accounts = db.accounts.filter((x) => x.id !== a.id);
  db.deleted.push({ id: a.id, kind: 'acc', at: Date.now(), data: a });
  touch('acc', a.id);
  save();
  closeSheet();
  render();
  toast('Silindi');
}

/* ---------------------- kart ödemesi / transfer ---------------------- */

let xfer = null;

function openTransfer(init = {}) {
  xfer = { id: null, fromId: '', toId: '', amountText: '', date: todayISO(), note: '', ...init };
  renderTransfer();
}

function renderTransfer() {
  const f = xfer;
  const to = accById(f.toId);
  const s = to?.kind === 'credit' ? cardStatus(to) : null;
  const opt = (sel, list, empty) => `<option value="">${empty}</option>${list.map((a) => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${accIcon(a)} ${esc(accLabel(a))}</option>`).join('')}`;
  openSheet(`
    <div class="sheet-head"><h2>${s ? 'Kart ödemesi' : 'Transfer'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
    <div class="row field">
      <div><label class="lbl">Nereden</label><select id="x-from" data-change="x-acc">${opt(f.fromId, db.accounts.filter((a) => a.kind !== 'credit' || a.id === f.fromId), 'Hesap dışı / belirtme')}</select></div>
      <div><label class="lbl">Nereye</label><select id="x-to" data-change="x-acc">${opt(f.toId, db.accounts, 'Seç')}</select></div>
    </div>
    <div class="field"><label class="lbl">Tutar</label>
      <div class="amount-field"><input id="x-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amountText)}"><span>${esc(db.settings.currency)}</span></div>
      ${s ? `<div class="chips" style="flex-wrap:wrap">
        ${s.minDue ? `<button class="chip" data-action="x-amt" data-val="${s.minDue}">Asgari ${moneyRound(s.minDue)}</button>` : ''}
        ${s.remaining ? `<button class="chip" data-action="x-amt" data-val="${s.remaining}">Dönem borcu ${moneyRound(s.remaining)}</button>` : ''}
        ${s.debt > 0 ? `<button class="chip" data-action="x-amt" data-val="${s.debt}">Tüm borç ${moneyRound(s.debt)}</button>` : ''}
      </div>` : ''}
    </div>
    <div class="row field">
      <div><label class="lbl">Tarih</label><input type="date" id="x-date" value="${f.date}"></div>
      <div><label class="lbl">Not</label><input id="x-note" value="${esc(f.note)}" maxlength="80" placeholder="İsteğe bağlı"></div>
    </div>
    <p class="muted" style="font-size:12px;margin:0">Transfer gelir ya da gider sayılmaz; kart harcamaları zaten harcandığı gün gider olarak sayıldı.</p>
    <div class="actions">
      ${f.id ? `<button class="btn danger" data-action="delete-tx" data-id="${f.id}">Sil</button>` : ''}
      <button class="btn primary" data-action="x-save">Kaydet</button>
    </div>
  `);
}

function syncTransfer() {
  if (!xfer || !$('#x-amount')) return;
  Object.assign(xfer, { fromId: $('#x-from').value, toId: $('#x-to').value, amountText: $('#x-amount').value, date: $('#x-date').value, note: $('#x-note').value });
}

function saveTransfer() {
  syncTransfer();
  const f = xfer;
  const amount = parseAmount(f.amountText);
  if (!f.toId) { toast('Nereye gideceğini seç'); return; }
  if (f.fromId === f.toId) { toast('Aynı hesaba transfer olmaz'); return; }
  if (!(amount > 0)) { $('#x-amount').classList.add('invalid'); toast('Geçerli bir tutar gir'); return; }
  const now = Date.now();
  const data = { type: 'transfer', amount, fromId: f.fromId || null, toId: f.toId, date: f.date || todayISO(), note: f.note.trim(), categoryId: null, updatedAt: now };
  let id = f.id;
  if (id) Object.assign(db.transactions.find((t) => t.id === id), data);
  else { id = uid(); db.transactions.push({ id, createdAt: now, ...data }); }
  touch('tx', id);
  save();
  closeSheet();
  render();
  const to = accById(f.toId);
  toast(to?.kind === 'credit' ? `${to.name} ödemesi kaydedildi ✓` : 'Transfer kaydedildi ✓');
}

/* ----------------- işlem formunda kart/hesap seçimi ----------------- */

const LAST_ACC_KEY = 'butce.lastAcc';
function lastAccountId() { try { const id = localStorage.getItem(LAST_ACC_KEY); return accById(id) ? id : ''; } catch { return ''; } }
function rememberAccount(id) { try { localStorage.setItem(LAST_ACC_KEY, id || ''); } catch {} }

function accountPicker(selected, type, action = 'form-acc') {
  if (!db.accounts.length) return '';
  const list = type === 'income' ? db.accounts.filter((a) => a.kind !== 'credit') : db.accounts;
  return `<div class="field"><label>${type === 'income' ? 'Hangi hesaba?' : 'Nasıl ödendi?'}</label>
    <div class="acc-chips">
      <button class="chip ${!selected ? 'on' : ''}" data-action="${action}" data-id="">Belirtme</button>
      ${list.map((a) => `<button class="chip ${selected === a.id ? 'on' : ''}" data-action="${action}" data-id="${a.id}">${accIcon(a)} ${esc(accLabel(a))}</button>`).join('')}
    </div></div>`;
}

/* ------------------------------ olaylar ------------------------------ */

VIEWS.cards = viewCards;

Object.assign(actions, {
  'acc-new': (el) => openAccForm({ kind: el.dataset.kind || 'credit' }),
  'acc-open': (el) => openAccount(el.dataset.id),
  'acc-edit': (el) => {
    const a = accById(el.dataset.id);
    if (a) openAccForm({ id: a.id, kind: a.kind, name: a.name, bank: a.bank || '', last4: a.last4 || '', color: a.color || CARD_COLORS[0], limitText: a.limit ? amountToInput(a.limit) : '', balanceText: amountToInput(accBalance(a)), statementDay: a.statementDay || 1, dueDay: a.dueDay || 11, minPct: a.minPct || 20 });
  },
  'acc-add-tx': (el) => { const a = accById(el.dataset.id); openTxForm({ type: 'expense', accountId: a?.id || '' }); },
  'af-kind': (el) => { syncAccForm(); accForm.kind = el.dataset.val; renderAccForm(); },
  'af-color': (el) => { accForm.color = el.dataset.val; $$('.swatches button').forEach((b) => b.classList.toggle('on', b === el)); },
  'af-min': (el) => { accForm.minPct = Number(el.dataset.val); $$('[data-action="af-min"]').forEach((b) => b.classList.toggle('on', b === el)); },
  'af-save': () => saveAcc(),
  'af-delete': () => deleteAcc(),
  'xfer-new': (el) => openTransfer({ toId: el.dataset.to || '', fromId: el.dataset.from || '' }),
  'x-amt': (el) => { $('#x-amount').value = amountToInput(Number(el.dataset.val)); },
  'x-save': () => saveTransfer(),
  'form-acc': (el) => { form.accountId = el.dataset.id; $$('[data-action="form-acc"]').forEach((b) => b.classList.toggle('on', b === el)); },
});

Object.assign(changes, {
  'x-acc': () => { syncTransfer(); renderTransfer(); },
});
