'use strict';

/* =====================================================================
   Kartlar ve hesaplar: kredi kartı, banka hesabı / kartı, nakit.
   - Harcama/gelir kaydında "accountId" ile hangi karttan/hesaptan yapıldığı tutulur.
   - Kart ödemesi ve hesaplar arası para aktarımı "transfer" türünde kayıttır
     (gelir/gider sayılmaz; harcama zaten kartla yapıldığı an gider olarak sayıldı).
   - Açılışta girilen borç/bakiye "opening"; sonrasında girilen kayıtlar üstüne eklenir.
   ===================================================================== */

const ACC_KINDS = {
  credit: { label: 'Kredi kartı', icon: 'credit-card' },
  bank: { label: 'Banka hesabı / kartı', icon: 'landmark' },
  cash: { label: 'Nakit', icon: 'wallet' },
};
const CARD_COLORS = ['#1f2937', '#4c1d95', '#991b1b', '#115e59', '#1e3a8a', '#9a3412', '#9d174d', '#166534', '#854d0e', '#475569'];

const accById = (id) => db.accounts.find((a) => a.id === id);
const accIcon = (a, size = 18) => icon(ACC_KINDS[a.kind]?.icon || 'credit-card', size);
const accLabel = (a) => `${a.name}${a.last4 ? ` •${a.last4}` : ''}`;
// Hesap açıldıktan sonra girilen kayıtlar bakiyeye eklenir (öncekiler açılış tutarının içinde).
const accCounts = (a, t) => (t.createdAt || 0) >= (a.createdAt || 0);

/* Kredi kartında: borç (pozitif = borç). Banka/nakitte: bakiye. */
// Varsayılan: bugüne kadarki durum (ileri tarihli kayıtlar tarihi gelince yansır)
function accBalance(a, until = todayISO()) {
  let v = a.opening || 0;
  const credit = a.kind === 'credit';
  for (const t of db.transactions) {
    if (t.date > until || t.awaiting || !accCounts(a, t)) continue;
    if (t.type === 'debt') {
      // Borç hareketi: giren para hesapta bakiyeyi artırır (kartta borcu azaltır), çıkan tersi
      if (t.accountId === a.id) v += (t.flow === 'in' ? 1 : -1) * (credit ? -t.amount : t.amount);
      continue;
    }
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
  for (const t of db.transactions) if (t.type === 'transfer' && t.toId === a.id && t.date > stmt && !isPlanned(t) && accCounts(a, t)) paid += t.amount;
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
  if (s.remaining <= 0) return s.stmtDebt > 0 ? 'Dönem borcu ödendi' : 'Ödenecek dönem borcu yok';
  if (s.daysToDue < 0) return `Son ödeme ${-s.daysToDue} gün geçti!`;
  if (s.daysToDue === 0) return 'Son ödeme bugün!';
  return `Son ödemeye ${s.daysToDue} gün`;
}

/* ------------------------------ görünüm ------------------------------ */

function cardTile(s) {
  const a = s.a;
  const pct = Math.min(1, Math.max(0, s.usage)) * 100;
  return `<button class="ccard" style="--cc:${a.color || CARD_COLORS[0]}" data-action="acc-open" data-id="${a.id}">
    <span class="cc-top"><span>${esc(a.bank || 'Kredi kartı')}</span><span>${a.last4 ? `•••• ${esc(a.last4)}` : icon('credit-card', 18)}</span></span>
    <span class="cc-name">${esc(a.name)}</span>
    <span class="cc-debt"><small>Borç</small><b>${money(s.debt)}</b></span>
    <span class="cc-bar"><i style="width:${pct.toFixed(1)}%"></i></span>
    <span class="cc-foot"><span>Kullanılabilir ${moneyRound(s.available)}</span><span>Limit ${moneyRound(s.limit)}</span></span>
  </button>
  <div class="cc-due ${s.level}">
    <span>Son ödeme ${shortDay(s.due)} · ${esc(dueText(s))}</span>
    ${s.remaining > 0 ? `<span>Dönem <b>${moneyRound(s.remaining)}</b> · ${s.minDue ? `Asgari <b>${moneyRound(s.minDue)}</b>` : 'Asgari ödendi'}</span>` : ''}
  </div>`;
}

function viewCards() {
  const head = walletHead();
  const credits = db.accounts.filter((a) => a.kind === 'credit');
  const others = db.accounts.filter((a) => a.kind !== 'credit');
  if (!db.accounts.length) {
    return `${head}
      <div class="card empty-card">
        <span class="empty-ico">${icon('credit-card', 26)}</span>
        <b>Kartlarını ve hesaplarını ekle</b>
        <p>Kredi kartı borcunu, limitini, son ödeme gününü takip et; harcamayı hangi kartla yaptığını seç.</p>
        <div class="btn-stack">
          <button class="btn primary" data-action="acc-new" data-kind="credit">Kredi kartı ekle</button>
          <button class="btn" data-action="acc-new" data-kind="bank">Banka hesabı / kartı ekle</button>
          <button class="btn" data-action="acc-new" data-kind="cash">Nakit cüzdan ekle</button>
        </div>
      </div>`;
  }
  const cs = credits.map(cardStatus);
  const totalDebt = cs.reduce((x, s) => x + Math.max(0, s.debt), 0);
  const totalAvail = cs.reduce((x, s) => x + Math.max(0, s.available), 0);
  const cashSum = others.reduce((x, a) => x + accBalance(a), 0);
  return `${head}
    <div class="card sum-list">
      <div><span>Toplam kart borcu</span><b class="exp">${money(totalDebt)}</b></div>
      <div><span>Kullanılabilir limit</span><b>${money(totalAvail)}</b></div>
      <div><span>Hesaplardaki para</span><b class="inc">${money(cashSum)}</b></div>
    </div>
    ${cs.length ? `<h2 class="sec">Kredi kartları</h2><div class="ccards">${cs.map(cardTile).join('')}</div>` : ''}
    ${others.length ? `<h2 class="sec">Hesaplar</h2><div class="list">${others.map((a) => `<button class="tx" data-action="acc-open" data-id="${a.id}">
        <span class="ico" style="--c:${col(a.color)}">${accIcon(a)}</span>
        <span class="tx-main"><b>${esc(accLabel(a))}</b><small>${esc(a.bank || ACC_KINDS[a.kind].label)}</small></span>
        <span class="amt ${accBalance(a) >= 0 ? '' : 'exp'}">${money(accBalance(a))}</span>
      </button>`).join('')}</div>` : ''}
    <button class="btn block" style="margin-top:14px" data-action="xfer-new">${icon('arrow-left-right', 18)} Kart ödemesi / para transferi</button>
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
    <div class="sheet-head"><h2>${esc(accLabel(a))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
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
    <div class="sheet-head"><h2>${editing ? 'Düzenle' : 'Yeni kart / hesap'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    ${editing ? '' : `<div class="seg field">${Object.entries(ACC_KINDS).map(([k, v]) => `<button data-action="af-kind" data-val="${k}" class="${f.kind === k ? 'on' : ''}">${k === 'bank' ? 'Banka' : v.label}</button>`).join('')}</div>`}
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
  toast('Kaydedildi');
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
// Transfer kaydı: amount = karşı hesaba GEÇEN tutar. Komisyon varsa ayrı bir gider kaydı
// (feeOf = transfer id, kategori "Banka masrafı", çıkan hesaptan) olarak tutulur; böylece
// raporlarda ve bütçede gider olarak görünür, kaynak hesaptan da düşer.

const FEE_CAT_ID = defCatId('expense', 'Banka masrafı');

function ensureFeeCategory() {
  if (db.categories.some((c) => c.id === FEE_CAT_ID)) return;
  db.categories.push({ id: FEE_CAT_ID, type: 'expense', name: 'Banka masrafı', icon: 'lc:banknote', color: '#5F6B7A', createdAt: 0, updatedAt: 0 });
  touch('cat', FEE_CAT_ID);
}

let xfer = null;

function openTransfer(init = {}) {
  xfer = { id: null, fromId: '', toId: '', sentText: '', feeText: '', feeMode: 'extra', date: todayISO(), note: '', awaiting: false, ...init };
  if (init.id) {
    const t = db.transactions.find((x) => x.id === init.id);
    const fee = db.transactions.find((x) => x.feeOf === init.id);
    if (t) {
      const feeAmt = fee ? fee.amount : 0;
      const mode = t.feeMode === 'deduct' ? 'deduct' : 'extra';
      Object.assign(xfer, {
        awaiting: !!t.awaiting,
        fromId: t.fromId || '', toId: t.toId || '', date: t.date, note: t.note || '', feeMode: mode,
        sentText: amountToInput(mode === 'deduct' ? t.amount + feeAmt : t.amount),
        feeText: feeAmt ? amountToInput(feeAmt) : '',
      });
    }
  }
  if (!xfer.toId) xfer.picking = 'to';
  renderTransfer();
}

// Girilen değerlerden: karşıya geçen, komisyon, kaynaktan toplam çıkan
function xferCalc() {
  const sent = parseAmount(xfer.sentText);
  const fee = xfer.feeText.trim() ? parseAmount(xfer.feeText) : 0;
  const ok = sent > 0 && fee >= 0 && !(xfer.feeMode === 'deduct' && fee >= sent);
  const received = xfer.feeMode === 'deduct' ? sent - fee : sent;
  const out = xfer.feeMode === 'deduct' ? sent : sent + fee;
  return { ok, sent, fee: fee || 0, received, out };
}

// Hesabın şu anki durumu ve işlemden sonraki hali (kredi kartında borç, diğerlerinde bakiye)
// Hesabın kısa durumu (kartlarda borç, diğerlerinde bakiye)
function accState(a) {
  if (!a) return 'Başka bir yerden';
  const v = accBalance(a);
  return a.kind === 'credit' ? `Borç ${money(v)}` : `Bakiye ${money(v)}`;
}

// İşlemden sonra hesabın durumu: kredi kartında borç, diğerlerinde bakiye
function accAfterRow(a, delta) {
  const now = accBalance(a);
  const next = now + delta;
  const good = a.kind === 'credit' ? delta < 0 : delta > 0;
  return `<div class="xr-after"><span>${accIcon(a)} ${esc(a.name)}</span><span>${money(now)} <i>→</i> <b class="${good ? 'inc' : 'exp'}">${money(next)}</b></span></div>`;
}

function transferPreview() {
  const c = xferCalc();
  const from = accById(xfer.fromId), to = accById(xfer.toId);
  if (!c.ok || !to) return '';
  const credit = (a) => a.kind === 'credit';
  return `<div class="receipt">
    <div class="xr-line"><span>Gönderilen</span><b>${money(c.sent)}</b></div>
    ${c.fee ? `<div class="xr-line muted"><span>Komisyon ${xfer.feeMode === 'deduct' ? '(tutardan düştü)' : '(ayrıca)'}</span><span>${xfer.feeMode === 'deduct' ? '−' : '+'}${money(c.fee)}</span></div>` : ''}
    <div class="xr-sep"></div>
    <div class="xr-line"><span>Çıkan <small class="muted">· ${from ? esc(from.name) : 'hesap dışı'}</small></span><b class="exp">${money(c.out)}</b></div>
    <div class="xr-line big"><span>Geçen <small class="muted">· ${esc(to.name)}</small></span><b class="inc">${money(c.received)}</b></div>
    ${xfer.id ? '' : `<div class="xr-sep"></div>
      ${from ? accAfterRow(from, credit(from) ? c.out : -c.out) : ''}
      ${accAfterRow(to, credit(to) ? -c.received : c.received)}`}
  </div>`;
}

function xferButtonLabel() {
  const c = xferCalc();
  const to = accById(xfer.toId);
  const verb = to?.kind === 'credit' ? 'öde' : 'gönder';
  return c.ok ? `${money(c.out)} ${verb}` : (to?.kind === 'credit' ? 'Ödemeyi kaydet' : 'Transferi kaydet');
}

function refreshTransfer() {
  syncTransfer();
  const p = $('#x-preview');
  if (p) p.innerHTML = transferPreview();
  const b = $('#x-save');
  if (b) b.textContent = xferButtonLabel();
}

function xferAccCard(role) {
  const id = role === 'from' ? xfer.fromId : xfer.toId;
  const a = accById(id);
  const empty = role === 'to' && !a;
  return `<button class="xacc ${xfer.picking === role ? 'open' : ''}" data-action="x-pick" data-role="${role}">
    <span class="xacc-ico" style="--c:${col(a?.color)}">${a ? accIcon(a, 22) : icon(role === 'from' ? 'arrow-down-left' : 'plus', 22)}</span>
    <span class="xacc-main">
      <small>${role === 'from' ? 'Gönderen' : 'Alıcı'}</small>
      <b>${empty ? 'Hesap seç' : a ? esc(accLabel(a)) : 'Hesap dışı'}</b>
      <span>${empty ? 'Paranın gideceği yer' : accState(a)}</span>
    </span>
    <span class="xacc-chev">${icon('chevron-down', 18)}</span>
  </button>`;
}

function xferPickList(role) {
  if (xfer.picking !== role) return '';
  const cur = role === 'from' ? xfer.fromId : xfer.toId;
  const other = role === 'from' ? xfer.toId : xfer.fromId;
  return `<div class="xpick">
    ${db.accounts.filter((a) => a.id !== other).map((a) => `<button class="${cur === a.id ? 'on' : ''}" data-action="x-choose" data-role="${role}" data-id="${a.id}">
      <span>${accIcon(a)}</span><b>${esc(a.name)}</b><small>${accState(a)}</small></button>`).join('')}
    ${role === 'from' ? `<button class="${!cur ? 'on' : ''}" data-action="x-choose" data-role="from" data-id=""><span>${icon('arrow-down-left', 18)}</span><b>Hesap dışı</b><small>Başka bir yerden</small></button>` : ''}
  </div>`;
}

function renderTransfer() {
  const f = xfer;
  const to = accById(f.toId);
  const s = to?.kind === 'credit' ? cardStatus(to) : null;
  const feeOpen = f.showFee || !!f.feeText.trim();
  openSheet(`
    <div class="sheet-head"><h2>${s ? 'Kart ödemesi' : 'Para gönder'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>

    <div class="xpair">
      ${xferAccCard('from')}
      ${xferPickList('from')}
      <button class="xswap" data-action="x-swap" aria-label="Yer değiştir" ${f.fromId && f.toId ? '' : 'disabled'}>${icon('arrow-up-down', 18)}</button>
      ${xferAccCard('to')}
      ${xferPickList('to')}
    </div>

    <div class="xamount">
      <input id="x-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.sentText)}" data-input="x-calc" aria-label="Tutar">
      <span>${esc(db.settings.currency)}</span>
    </div>
    ${s && s.debt > 0 ? `<div class="xchips">
      ${s.minDue ? `<button data-action="x-amt" data-val="${s.minDue}"><small>Asgari</small>${money(s.minDue)}</button>` : ''}
      ${s.remaining ? `<button data-action="x-amt" data-val="${s.remaining}"><small>Dönem borcu</small>${money(s.remaining)}</button>` : ''}
      <button data-action="x-amt" data-val="${s.debt}"><small>Tüm borç</small>${money(s.debt)}</button>
    </div>` : ''}

    ${feeOpen ? `<div class="xfee">
      <div class="between"><span class="lbl" style="margin:0">Komisyon / masraf</span><button class="link small" data-action="x-fee-off">Kaldır</button></div>
      <div class="row" style="align-items:center;margin-top:6px">
        <div class="xfee-in"><input id="x-fee" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.feeText)}" data-input="x-calc"><span>${esc(db.settings.currency)}</span></div>
        <div class="seg" style="flex:1.5">
          <button data-action="x-mode" data-val="extra" class="${f.feeMode === 'extra' ? 'on' : ''}">Ayrıca</button>
          <button data-action="x-mode" data-val="deduct" class="${f.feeMode === 'deduct' ? 'on' : ''}">Tutardan</button>
        </div>
      </div>
    </div>` : `<button class="xfee-add" data-action="x-fee-on">＋ Komisyon / masraf ekle</button>`}

    <div id="x-preview">${transferPreview()}</div>

    <div class="row" style="margin-top:12px">
      <input type="date" id="x-date" value="${f.date}" aria-label="Tarih">
      <input id="x-note" value="${esc(f.note)}" maxlength="80" placeholder="Not (isteğe bağlı)" aria-label="Not">
    </div>

    <div class="actions">
      ${f.id ? `<button class="btn danger" data-action="delete-tx" data-id="${f.id}" style="flex:.5">Sil</button>` : ''}
      ${f.awaiting ? `<button class="btn" data-action="x-confirm">${icon('check', 18)} Gönderildi, onayla</button>` : ''}
      <button class="btn primary xsend" id="x-save" data-action="x-save">${xferButtonLabel()}</button>
    </div>
  `);
}

function syncTransfer() {
  if (!xfer || !$('#x-amount')) return;
  xfer.sentText = $('#x-amount').value;
  xfer.feeText = $('#x-fee') ? $('#x-fee').value : xfer.feeText;
  xfer.date = $('#x-date').value;
  xfer.note = $('#x-note').value;
}

function saveTransfer(confirmNow = false) {
  syncTransfer();
  const f = xfer;
  const c = xferCalc();
  if (!f.toId) { toast('Paranın gideceği hesabı seç'); return; }
  if (f.fromId === f.toId) { toast('Aynı hesaba transfer olmaz'); return; }
  if (!(c.sent > 0)) { $('#x-amount').classList.add('invalid'); toast('Geçerli bir tutar gir'); return; }
  if (!c.ok) { $('#x-fee').classList.add('invalid'); toast('Komisyon tutarını kontrol et'); return; }
  const now = Date.now();
  const today = todayISO();
  let date = f.date || today;
  if (confirmNow && date > today) date = today;
  const awaiting = !confirmNow && (date > today || !!f.awaiting);
  const data = { type: 'transfer', amount: c.received, fromId: f.fromId || null, toId: f.toId, date, note: f.note.trim(), feeMode: f.feeMode, categoryId: null, awaiting, updatedAt: now };
  let id = f.id;
  if (id) Object.assign(db.transactions.find((t) => t.id === id), data);
  else { id = uid(); db.transactions.push({ id, createdAt: now, ...data }); }
  touch('tx', id);

  // Komisyon kaydı: oluştur / güncelle / kaldır
  const feeTx = db.transactions.find((t) => t.feeOf === id);
  if (c.fee > 0) {
    ensureFeeCategory();
    const fd = { type: 'expense', amount: c.fee, categoryId: FEE_CAT_ID, accountId: f.fromId || null, date, note: `Transfer komisyonu → ${accById(f.toId)?.name || ''}`, feeOf: id, awaiting, updatedAt: now };
    if (feeTx) { Object.assign(feeTx, fd); touch('tx', feeTx.id); }
    else { const fid = uid(); db.transactions.push({ id: fid, createdAt: now, ...fd }); touch('tx', fid); }
  } else if (feeTx) {
    db.transactions = db.transactions.filter((t) => t.id !== feeTx.id);
    db.deleted.push({ id: feeTx.id, kind: 'tx', at: now, data: feeTx });
    touch('tx', feeTx.id);
  }

  save();
  closeSheet();
  render();
  const to = accById(f.toId);
  if (awaiting) toast(`Planlandı · ${fullDay(date)} günü onayın istenecek`);
  else toast(`${to?.kind === 'credit' ? `${to.name} ödemesi` : 'Transfer'} kaydedildi: ${moneyRound(c.received)} geçti${c.fee ? `, ${moneyRound(c.fee)} komisyon` : ''}`);
}

/* ----------------- işlem formunda kart/hesap seçimi ----------------- */

const LAST_ACC_KEY = 'butce.lastAcc';
function lastAccountId() { try { const id = localStorage.getItem(LAST_ACC_KEY); return accById(id) ? id : ''; } catch { return ''; } }
function rememberAccount(id) { try { localStorage.setItem(LAST_ACC_KEY, id || ''); } catch {} }

// Seçili kartın/hesabın durumu: kredi kartında kullanılabilir limit, diğerlerinde bakiye
function accInfo(a, type) {
  if (!a) return 'Hangi karttan/hesaptan olduğunu seçersen bakiyeler kendiliğinden güncellenir.';
  if (a.kind === 'credit') {
    const s = cardStatus(a);
    return type === 'income'
      ? `İade/ödeme olarak ${esc(a.name)} borcundan düşer · borç ${moneyRound(s.debt)}`
      : `Kullanılabilir limit <b>${moneyRound(s.available)}</b> · borç ${moneyRound(s.debt)}`;
  }
  const bal = accBalance(a);
  return `${type === 'income' ? 'Bu hesaba eklenir' : 'Bu hesaptan düşer'} · bakiye <b class="${bal < 0 ? 'exp' : ''}">${moneyRound(bal)}</b>`;
}

function accountPicker(selected, type, action = 'form-acc') {
  if (!db.accounts.length) return '';
  return `<div class="field"><label>${type === 'income' ? 'Nereye geldi?' : 'Nereden ödendi?'}</label>
    <div class="acc-chips" data-type="${type}">
      ${db.accounts.map((a) => `<button class="chip ${selected === a.id ? 'on' : ''}" data-action="${action}" data-id="${a.id}">${accIcon(a)} ${esc(accLabel(a))}</button>`).join('')}
      <button class="chip ghost ${!selected ? 'on' : ''}" data-action="${action}" data-id="">Hiçbiri</button>
    </div>
    <small class="acc-info">${accInfo(accById(selected), type)}</small>
  </div>`;
}

function pickAccount(el) {
  const box = el.closest('.acc-chips');
  box.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b === el));
  const info = box.parentElement.querySelector('.acc-info');
  if (info) info.innerHTML = accInfo(accById(el.dataset.id), box.dataset.type);
  return el.dataset.id;
}

/* ------------------------------ olaylar ------------------------------ */


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
  'x-amt': (el) => { $('#x-amount').value = amountToInput(Number(el.dataset.val)); refreshTransfer(); },
  'x-mode': (el) => { xfer.feeMode = el.dataset.val; $$('[data-action="x-mode"]').forEach((b) => b.classList.toggle('on', b === el)); refreshTransfer(); },
  'x-pick': (el) => { syncTransfer(); xfer.picking = xfer.picking === el.dataset.role ? null : el.dataset.role; renderTransfer(); },
  'x-choose': (el) => {
    syncTransfer();
    if (el.dataset.role === 'from') xfer.fromId = el.dataset.id; else xfer.toId = el.dataset.id;
    xfer.picking = !xfer.toId ? 'to' : null;
    renderTransfer();
  },
  'x-swap': () => { syncTransfer(); [xfer.fromId, xfer.toId] = [xfer.toId, xfer.fromId]; xfer.picking = null; renderTransfer(); },
  'x-fee-on': () => { syncTransfer(); xfer.showFee = true; renderTransfer(); setTimeout(() => $('#x-fee')?.focus(), 50); },
  'x-fee-off': () => { syncTransfer(); xfer.showFee = false; xfer.feeText = ''; renderTransfer(); },
  'x-save': () => saveTransfer(),
  'x-confirm': () => saveTransfer(true),
  'form-acc': (el) => { form.accountId = pickAccount(el); },
});

document.addEventListener('input', (e) => {
  if (e.target.dataset?.input !== 'x-calc' || !xfer) return;
  e.target.classList.remove('invalid');
  refreshTransfer();
});
