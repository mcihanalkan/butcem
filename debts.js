'use strict';

/* =====================================================================
   Borç ve alacak takibi.
   - Borç aldım: biri bana para verdi, ben geri ödeyeceğim.
   - Borç verdim: ben birine verdim, o bana geri ödeyecek.
   Para hareketleri "debt" türünde kayıttır; gelir/gider sayılmaz ama seçilen
   hesabın bakiyesini değiştirir:
     role: 'principal' (borcun kendisi), 'repay' (geri ödeme / tahsilat)
     flow: 'in' (hesaba giren), 'out' (hesaptan çıkan)
   Eski bir borçsa hesap seçilmez; sadece takip edilir.
   ===================================================================== */

ui.walletTab = ui.walletTab || 'cards';
ui.showClosedDebts = false;

const debtById = (id) => db.debts.find((d) => d.id === id);
const debtTxs = (d) => db.transactions.filter((t) => t.type === 'debt' && t.debtId === d.id);
const isBorrowed = (d) => d.dir === 'borrowed';

function debtStatus(d) {
  const today = todayISO();
  const pays = debtTxs(d).filter((t) => t.role === 'repay');
  const paid = pays.filter((t) => !t.awaiting).reduce((a, t) => a + t.amount, 0);
  const remaining = Math.max(0, d.amount - paid);
  const closed = remaining === 0 || !!d.closed;
  const daysToDue = d.dueDate ? dayDiff(fromISO(today), fromISO(d.dueDate)) : null;
  const level = closed ? 'closed' : d.dueDate && daysToDue < 0 ? 'late' : d.dueDate && daysToDue <= 3 ? 'soon' : 'ok';
  return { d, paid, remaining, closed, pct: d.amount ? paid / d.amount : 0, daysToDue, level, pays };
}

function debtTotals() {
  let owe = 0, owed = 0;
  for (const d of db.debts) {
    const s = debtStatus(d);
    if (s.closed) continue;
    if (isBorrowed(d)) owe += s.remaining; else owed += s.remaining;
  }
  return { owe, owed, net: owed - owe };
}

function debtAttention() {
  return db.debts.map(debtStatus).filter((s) => !s.closed && (s.level === 'late' || s.level === 'soon'));
}

function dueLabel(s) {
  if (!s.d.dueDate) return 'Vade yok';
  if (s.closed) return `Vade ${fullDay(s.d.dueDate)}`;
  if (s.daysToDue < 0) return `Vadesi ${-s.daysToDue} gün geçti`;
  if (s.daysToDue === 0) return 'Vadesi bugün';
  return `Vadeye ${s.daysToDue} gün · ${shortDay(s.d.dueDate)}`;
}

// Borç hareketinin adı (işlem listelerinde)
function debtTxTitle(t) {
  const d = debtById(t.debtId);
  const borrowed = d ? isBorrowed(d) : t.flow === 'in';
  const label = t.role === 'principal' ? (borrowed ? 'Borç alındı' : 'Borç verildi') : borrowed ? 'Borç ödemesi' : 'Tahsilat';
  return `${label} · ${d ? d.person : '?'}`;
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('tr');

/* ------------------------------ görünüm ------------------------------ */

// Cüzdan sekmesinin başlığı: Kartlar & hesaplar | Borç & alacak
function walletHead() {
  const tab = ui.walletTab;
  const n = debtAttention().length;
  const right = tab === 'debts'
    ? `<button class="btn small" data-action="debt-new">+ Ekle</button>`
    : `<button class="btn small" data-action="acc-new">+ Ekle</button>`;
  return `${viewHead('Cüzdan', right)}
    <div class="seg tabs">
      <button data-action="wallet-tab" data-val="cards" class="${tab === 'cards' ? 'on' : ''}">Kartlar ve hesaplar</button>
      <button data-action="wallet-tab" data-val="debts" class="${tab === 'debts' ? 'on' : ''}">Borç ve alacak${n ? ` <i class="dot-count">${n}</i>` : ''}</button>
    </div>`;
}

function debtRow(s) {
  const d = s.d;
  const sub = s.closed ? `Kapandı · toplam ${money(d.amount)}` : `${dueLabel(s)}${d.note ? ` · ${d.note}` : ''}`;
  return `<button class="tx debt-row ${s.level}" data-action="debt-open" data-id="${d.id}">
    <span class="avatar ${isBorrowed(d) ? 'owe' : 'owed'}">${esc(initials(d.person))}</span>
    <span class="tx-main">
      <b>${esc(d.person)}</b>
      <small class="due">${esc(sub)}</small>
      ${s.closed ? '' : `<span class="thin"><i style="width:${(s.pct * 100).toFixed(1)}%"></i></span>`}
    </span>
    <span class="debt-amt"><b class="${s.closed ? 'muted' : isBorrowed(d) ? 'exp' : 'inc'}">${money(s.closed ? d.amount : s.remaining)}</b>${!s.closed && s.paid ? `<small>/ ${money(d.amount)}</small>` : ''}</span>
  </button>`;
}

function viewDebts() {
  if (!db.debts.length) {
    return `<div class="card empty-card">
      <span class="empty-ico">${icon('hand-coins', 26)}</span>
      <b>Borç ve alacaklar</b>
      <p>Birinden borç aldıysan ya da birine borç verdiysen buraya ekle; kalan tutarı, vadeyi ve ödemeleri takip et.</p>
      <div class="btn-stack">
        <button class="btn primary" data-action="debt-new" data-dir="borrowed">Borç aldım</button>
        <button class="btn" data-action="debt-new" data-dir="lent">Borç verdim</button>
      </div>
    </div>`;
  }
  const all = db.debts.map(debtStatus);
  const open = all.filter((s) => !s.closed);
  const order = (a, b) => ({ late: 0, soon: 1, ok: 2 }[a.level] - { late: 0, soon: 1, ok: 2 }[b.level]) || (a.d.dueDate || '9999').localeCompare(b.d.dueDate || '9999');
  const owe = open.filter((s) => isBorrowed(s.d)).sort(order);
  const owed = open.filter((s) => !isBorrowed(s.d)).sort(order);
  const closed = all.filter((s) => s.closed);
  const t = debtTotals();
  return `
    <div class="card sum-list">
      <div><span>Toplam borcum</span><b class="exp">${money(t.owe)}</b></div>
      <div><span>Toplam alacağım</span><b class="inc">${money(t.owed)}</b></div>
      <div><span>Net durum</span><b class="${t.net >= 0 ? 'inc' : 'exp'}">${t.net >= 0 ? '+' : '−'}${money(Math.abs(t.net))}</b></div>
    </div>
    <h2 class="sec">Borçlarım</h2>
    ${owe.length ? `<div class="list">${owe.map(debtRow).join('')}</div>` : '<p class="muted small" style="margin:0 4px">Açık borcun yok.</p>'}
    <h2 class="sec">Alacaklarım</h2>
    ${owed.length ? `<div class="list">${owed.map(debtRow).join('')}</div>` : '<p class="muted small" style="margin:0 4px">Açık alacağın yok.</p>'}
    ${closed.length ? `<button class="free-line" style="margin-top:18px" data-action="debt-closed">${ui.showClosedDebts ? 'Kapananları gizle' : `Kapanan kayıtlar (${closed.length})`}<span class="chev">${icon(ui.showClosedDebts ? 'chevron-down' : 'chevron-right', 18)}</span></button>
      ${ui.showClosedDebts ? `<div class="list" style="margin-top:8px">${closed.map(debtRow).join('')}</div>` : ''}` : ''}
  `;
}

/* ------------------------------ detay ------------------------------ */

function openDebt(id) {
  const d = debtById(id);
  if (!d) return;
  const s = debtStatus(d);
  const borrowed = isBorrowed(d);
  const hist = [...debtTxs(d)].sort((a, b) => (a.date < b.date ? 1 : -1));
  const acc = accById(d.accountId);
  openSheet(`
    <div class="sheet-head"><h2>${esc(d.person)}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="debt-hero ${borrowed ? 'owe' : 'owed'}">
      <small>${s.closed ? 'Kapandı' : borrowed ? 'Kalan borcun' : 'Kalan alacağın'}</small>
      <b>${money(s.closed ? 0 : s.remaining)}</b>
      <div class="bbar ${s.closed ? 'ok' : ''}"><i style="width:${(s.pct * 100).toFixed(1)}%"></i></div>
      <div class="between small"><span>${borrowed ? 'Ödenen' : 'Tahsil edilen'} ${money(s.paid)}</span><span>Toplam ${money(d.amount)}</span></div>
    </div>
    <div class="sum-list card" style="margin-top:12px">
      <div><span>${borrowed ? 'Borç alınan tarih' : 'Borç verilen tarih'}</span><b>${fullDay(d.date)}</b></div>
      <div><span>Vade</span><b class="${s.level === 'late' ? 'exp' : s.level === 'soon' ? 'warn-t' : ''}">${d.dueDate ? `${fullDay(d.dueDate)}` : 'Yok'}</b></div>
      <div><span>${borrowed ? 'Paranın geldiği hesap' : 'Paranın çıktığı hesap'}</span><b>${acc ? esc(accLabel(acc)) : 'Hesaba yansıtılmadı'}</b></div>
      ${d.note ? `<div><span>Not</span><b>${esc(d.note)}</b></div>` : ''}
    </div>
    <div class="row" style="margin:6px 0 4px">
      ${s.closed ? '' : `<button class="btn primary" data-action="debt-pay" data-id="${d.id}">${borrowed ? 'Ödeme yap' : 'Tahsilat ekle'}</button>`}
      <button class="btn" data-action="debt-edit" data-id="${d.id}">Düzenle</button>
    </div>
    ${hist.filter((t) => t.awaiting).map((t) => `<div class="await-box"><b>${esc(debtTxTitle(t))} · ${money(t.amount)}</b><small>${fullDay(t.date)} · onay bekliyor; onaylanana kadar bakiyeye yansımaz.</small><button class="btn primary block" data-action="debt-confirm" data-id="${t.id}">${icon('check', 18)} Onayla</button></div>`).join('')}
    <h4>Hareketler</h4>
    ${hist.length ? `<div class="list" style="border:0">${hist.map((t) => txRow(t, catMap(), true)).join('')}</div>` : `<p class="muted small">${borrowed ? 'Henüz ödeme yapılmadı.' : 'Henüz tahsilat yok.'}</p>`}
  `);
}

/* ------------------------------ borç formu ------------------------------ */

let debtForm = null;

function openDebtForm(init = {}) {
  debtForm = { id: null, dir: 'borrowed', person: '', amountText: '', date: todayISO(), dueDate: '', accountId: '', note: '', ...init };
  renderDebtForm();
}

function syncDebtForm() {
  if (!debtForm || !$('#d-person')) return;
  Object.assign(debtForm, { person: $('#d-person').value, amountText: $('#d-amount').value, date: $('#d-date').value, dueDate: $('#d-due').value, note: $('#d-note').value });
}

function renderDebtForm() {
  const f = debtForm;
  const borrowed = f.dir === 'borrowed';
  const people = [...new Set(db.debts.map((d) => d.person))].sort((a, b) => a.localeCompare(b, 'tr'));
  const plus = (days) => toISO(addDays(fromISO(f.date || todayISO()), days));
  openSheet(`
    <div class="sheet-head"><h2>${f.id ? 'Kaydı düzenle' : 'Yeni borç / alacak'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="seg field">
      <button data-action="df-dir" data-val="borrowed" class="${borrowed ? 'on' : ''}">Borç aldım</button>
      <button data-action="df-dir" data-val="lent" class="${!borrowed ? 'on' : ''}">Borç verdim</button>
    </div>
    <div class="field"><label>${borrowed ? 'Kimden?' : 'Kime?'}</label>
      <input id="d-person" list="d-people" value="${esc(f.person)}" maxlength="40" placeholder="ör. Ahmet, Annem, Banka">
      <datalist id="d-people">${people.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    </div>
    <div class="field"><label>Tutar</label>
      <div class="amount-field"><input id="d-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.amountText)}"><span>${esc(db.settings.currency)}</span></div>
    </div>
    ${accountPicker(f.accountId, borrowed ? 'income' : 'expense', 'df-acc').replace(borrowed ? 'Nereye geldi?' : 'Nereden ödendi?', borrowed ? 'Para hangi hesaba girdi?' : 'Para hangi hesaptan çıktı?').replace('>Hiçbiri<', '>Hesaba yansıtma (eski borç)<')}
    <div class="row field">
      <div><label class="lbl">Tarih</label><input type="date" id="d-date" value="${f.date}"></div>
      <div><label class="lbl">Vade (son gün)</label><input type="date" id="d-due" value="${f.dueDate || ''}"></div>
    </div>
    <div class="chips" style="margin:-6px 0 14px;flex-wrap:wrap">
      <button class="chip" data-action="df-due" data-val="${plus(7)}">1 hafta</button>
      <button class="chip" data-action="df-due" data-val="${plus(30)}">1 ay</button>
      <button class="chip" data-action="df-due" data-val="${plus(90)}">3 ay</button>
      <button class="chip ghost" data-action="df-due" data-val="">Vade yok</button>
    </div>
    <div class="field"><label>Not</label><input id="d-note" value="${esc(f.note)}" maxlength="80" placeholder="İsteğe bağlı (ör. araba tamiri için)"></div>
    <div class="actions">
      ${f.id ? `<button class="btn danger" data-action="df-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="df-save">Kaydet</button>
    </div>
  `);
  if (!f.id) setTimeout(() => $('#d-person')?.focus(), 60);
}

function saveDebt() {
  syncDebtForm();
  const f = debtForm;
  const amount = parseAmount(f.amountText);
  if (!f.person.trim()) { toast(f.dir === 'borrowed' ? 'Kimden aldığını yaz' : 'Kime verdiğini yaz'); $('#d-person').focus(); return; }
  if (!(amount > 0)) { $('#d-amount').classList.add('invalid'); toast('Geçerli bir tutar gir'); return; }
  if (f.dueDate && f.dueDate < f.date) { toast('Vade, tarihten önce olamaz'); return; }
  const now = Date.now();
  const data = { dir: f.dir, person: f.person.trim(), amount, date: f.date || todayISO(), dueDate: f.dueDate || null, accountId: f.accountId || null, note: f.note.trim(), updatedAt: now };
  let id = f.id;
  if (id) Object.assign(debtById(id), data);
  else { id = uid(); db.debts.push({ id, closed: false, createdAt: now, ...data }); }
  touch('debt', id);

  // Borcun kendisi: hesap seçildiyse o hesaba giren/çıkan para
  const principal = db.transactions.find((t) => t.type === 'debt' && t.debtId === id && t.role === 'principal');
  if (data.accountId) {
    const pd = { type: 'debt', debtId: id, role: 'principal', flow: data.dir === 'borrowed' ? 'in' : 'out', amount, accountId: data.accountId, date: data.date, note: data.person, categoryId: null, awaiting: data.date > todayISO(), updatedAt: now };
    if (principal) { Object.assign(principal, pd); touch('tx', principal.id); }
    else { const tid = uid(); db.transactions.push({ id: tid, createdAt: now, ...pd }); touch('tx', tid); }
  } else if (principal) {
    db.transactions = db.transactions.filter((t) => t.id !== principal.id);
    db.deleted.push({ id: principal.id, kind: 'tx', at: now, data: principal });
    touch('tx', principal.id);
  }
  save();
  closeSheet();
  ui.view = 'cards';
  ui.walletTab = 'debts';
  render();
  toast(f.id ? 'Güncellendi' : data.dir === 'borrowed' ? 'Borç eklendi' : 'Alacak eklendi');
}

function deleteDebt() {
  const d = debtById(debtForm.id);
  if (!d || !confirm(`${d.person} ile ilgili kayıt ve tüm hareketleri silinsin mi?`)) return;
  const now = Date.now();
  for (const t of debtTxs(d)) { db.deleted.push({ id: t.id, kind: 'tx', at: now, data: t }); touch('tx', t.id); }
  db.transactions = db.transactions.filter((t) => !(t.type === 'debt' && t.debtId === d.id));
  db.debts = db.debts.filter((x) => x.id !== d.id);
  db.deleted.push({ id: d.id, kind: 'debt', at: now, data: d });
  touch('debt', d.id);
  save();
  closeSheet();
  render();
  toast('Silindi');
}

/* --------------------------- ödeme / tahsilat --------------------------- */

let payForm = null;

function openPay(debtId, txId = null) {
  const d = debtById(debtId);
  if (!d) return;
  const t = txId ? db.transactions.find((x) => x.id === txId) : null;
  payForm = {
    debtId, id: t?.id || null,
    amountText: t ? amountToInput(t.amount) : '', date: t?.date || todayISO(), note: t?.note || '',
    accountId: t ? t.accountId || '' : accById(d.accountId) ? d.accountId : lastAccountId(),
  };
  renderPay();
}

function renderPay() {
  const f = payForm;
  const d = debtById(f.debtId);
  const s = debtStatus(d);
  const borrowed = isBorrowed(d);
  const editing = !!f.id;
  const left = editing ? s.remaining + (db.transactions.find((x) => x.id === f.id)?.amount || 0) : s.remaining;
  openSheet(`
    <div class="sheet-head"><h2>${borrowed ? 'Borç ödemesi' : 'Tahsilat'} · ${esc(d.person)}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <p class="muted small" style="margin-top:-6px">Kalan: <b class="${borrowed ? 'exp' : 'inc'}">${money(left)}</b></p>
    <div class="field">
      <div class="amount-field"><input id="p-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.amountText)}"><span>${esc(db.settings.currency)}</span></div>
      <div class="chips" style="flex-wrap:wrap">
        <button class="chip" data-action="p-amt" data-val="${left}">Tamamı · ${money(left)}</button>
        ${left >= 200 ? `<button class="chip" data-action="p-amt" data-val="${Math.round(left / 2)}">Yarısı</button>` : ''}
      </div>
    </div>
    ${accountPicker(f.accountId, borrowed ? 'expense' : 'income', 'p-acc').replace(/Nereye geldi\?|Nereden ödendi\?/, borrowed ? 'Hangi hesaptan ödedin?' : 'Para hangi hesaba girdi?')}
    <div class="row field">
      <div><label class="lbl">Tarih</label><input type="date" id="p-date" value="${f.date}"></div>
      <div><label class="lbl">Not</label><input id="p-note" value="${esc(f.note)}" maxlength="80" placeholder="İsteğe bağlı"></div>
    </div>
    ${editing && db.transactions.find((x) => x.id === f.id)?.awaiting ? `<div class="await-box"><b>Onay bekliyor</b><small>${borrowed ? 'Ödediğinde' : 'Para geldiğinde'} onayla; o zamana kadar bakiyeye ve kalan tutara yansımaz.</small><button class="btn primary block" data-action="p-save" data-confirm="1">${icon('check', 18)} ${borrowed ? 'Ödendi' : 'Geldi'}, onayla</button></div>` : ''}
    <div class="actions">
      ${editing ? `<button class="btn danger" data-action="p-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="p-save">${editing ? 'Kaydet' : borrowed ? 'Ödemeyi kaydet' : 'Tahsilatı kaydet'}</button>
    </div>
  `);
  if (!editing) setTimeout(() => $('#p-amount')?.focus(), 60);
}

function savePay(confirmNow = false) {
  const f = payForm;
  const d = debtById(f.debtId);
  const amount = parseAmount($('#p-amount').value);
  let date = $('#p-date').value || todayISO();
  if (confirmNow && date > todayISO()) date = todayISO();
  if (!(amount > 0)) { $('#p-amount').classList.add('invalid'); toast('Geçerli bir tutar gir'); return; }
  const s = debtStatus(d);
  const prev = f.id ? db.transactions.find((x) => x.id === f.id)?.amount || 0 : 0;
  if (amount > s.remaining + prev) { toast(`Kalan tutardan fazla olamaz (${money(s.remaining + prev)})`); return; }
  const now = Date.now();
  const data = { type: 'debt', debtId: d.id, role: 'repay', flow: isBorrowed(d) ? 'out' : 'in', amount, accountId: f.accountId || null, date, note: $('#p-note').value.trim(), categoryId: null, awaiting: !confirmNow && date > todayISO(), updatedAt: now };
  let id = f.id;
  if (id) Object.assign(db.transactions.find((x) => x.id === id), data);
  else { id = uid(); db.transactions.push({ id, createdAt: now, ...data }); }
  touch('tx', id);
  save();
  render();
  const after = debtStatus(d);
  openDebt(d.id);
  toast(data.awaiting ? `Planlandı · ${fullDay(date)} günü onayın istenecek` : after.closed ? `${d.person} ile hesap kapandı` : `Kaydedildi · kalan ${money(after.remaining)}`);
}

function deletePay() {
  const f = payForm;
  if (!f.id || !confirm('Bu hareket silinsin mi?')) return;
  const t = db.transactions.find((x) => x.id === f.id);
  db.transactions = db.transactions.filter((x) => x.id !== f.id);
  db.deleted.push({ id: f.id, kind: 'tx', at: Date.now(), data: t });
  touch('tx', f.id);
  save();
  render();
  openDebt(f.debtId);
  toast('Silindi');
}

/* ------------------------------ olaylar ------------------------------ */

VIEWS.cards = () => (ui.walletTab === 'debts' ? walletHead() + viewDebts() : viewCards());

Object.assign(actions, {
  'wallet-tab': (el) => { ui.walletTab = el.dataset.val; render(); },
  'debt-new': (el) => openDebtForm({ dir: el.dataset.dir || 'borrowed', accountId: '' }),
  'debt-open': (el) => openDebt(el.dataset.id),
  'debt-edit': (el) => {
    const d = debtById(el.dataset.id);
    if (d) openDebtForm({ id: d.id, dir: d.dir, person: d.person, amountText: amountToInput(d.amount), date: d.date, dueDate: d.dueDate || '', accountId: d.accountId || '', note: d.note || '' });
  },
  'debt-pay': (el) => openPay(el.dataset.id),
  'debt-closed': () => { ui.showClosedDebts = !ui.showClosedDebts; render(); },
  'df-dir': (el) => { syncDebtForm(); debtForm.dir = el.dataset.val; renderDebtForm(); },
  'df-acc': (el) => { debtForm.accountId = pickAccount(el); },
  'df-due': (el) => { $('#d-due').value = el.dataset.val; },
  'df-save': () => saveDebt(),
  'df-delete': () => deleteDebt(),
  'p-amt': (el) => { $('#p-amount').value = amountToInput(Number(el.dataset.val)); },
  'p-acc': (el) => { payForm.accountId = pickAccount(el); },
  'p-save': (el) => savePay(!!el.dataset.confirm),
  'debt-confirm': (el) => {
    const t = db.transactions.find((x) => x.id === el.dataset.id);
    if (!t) return;
    Object.assign(t, { awaiting: false, date: t.date > todayISO() ? todayISO() : t.date, updatedAt: Date.now() });
    touch('tx', t.id);
    save();
    render();
    openDebt(t.debtId);
    toast('Onaylandı');
  },
  'p-delete': () => deletePay(),
});
