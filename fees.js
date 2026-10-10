'use strict';

/* =====================================================================
   Masraf / komisyon (EFT, havale, kart ödemesi ücretleri)
   - Bankadan / karttan para çıkan her kayıtta "Masraf kesildi mi?" sorulur ve
     cevap verilmeden kaydedilmez (Masraf yok · tahmini tutar · başka tutar).
   - Masraf, ayrı bir "Banka masrafı" gideri olarak tutulur (feeOf = ana kayıt);
     ana kayıtta feeAmt (0 = masraf yok) saklanır.
   - Tahmin: aynı hesaptan daha önce hangi tutarda ne kesildiğine bakar; ücret
     aralıklarını (ör. 2 bin altı / 10 bin üstü) kendisi çıkarır.
   ===================================================================== */

let feeSel = { choice: null, amt: 0, text: '' }; // choice: null | 'none' | 'amt' | 'other'

// Açık penceredeki kaydın bilgisi: hangi hesaptan, ne kadar, ne tür
function feeContext() {
  if (!$('#sheet-root .sheet')) return null;
  if ($('#x-amount') && xfer) return { accId: xfer.fromId, amount: parseAmount($('#x-amount').value), kind: 'move', xfer: true };
  if ($('#f-amount') && form) return { accId: form.accountId, amount: parseAmount($('#f-amount').value), kind: form.type === 'expense' && form.categoryId !== FEE_CAT_ID ? 'expense' : null };
  if ($('#rc-amount') && recConfirm) {
    const rec = db.recurring.find((r) => r.id === recConfirm.recId);
    return { accId: recConfirm.accountId, amount: parseAmount($('#rc-amount').value), kind: rec?.type === 'expense' ? 'expense' : null };
  }
  if ($('#p-amount') && payForm) { const d = debtById(payForm.debtId); return { accId: payForm.accountId, amount: parseAmount($('#p-amount').value), kind: d && isBorrowed(d) ? 'move' : null }; }
  if ($('#d-amount') && debtForm) return { accId: debtForm.accountId, amount: parseAmount($('#d-amount').value), kind: debtForm.dir === 'lent' ? 'move' : null };
  if ($('#gp-amount') && goalPay) return { accId: goalPay.accountId, amount: parseAmount($('#gp-amount').value), kind: goalPay.role === 'save' ? 'move' : null };
  return null;
}

// Giderlerde banka hesabı; transfer, borç, birikimde nakit dışındaki her hesap
function feeNeeded(ctx) {
  const a = ctx && ctx.kind ? accById(ctx.accId) : null;
  if (!a) return false;
  return ctx.kind === 'expense' ? a.kind === 'bank' : a.kind !== 'cash';
}

function feeReset(parentId = null) {
  feeSel = { choice: null, amt: 0, text: '' };
  if (!parentId) return;
  const p = db.transactions.find((t) => t.id === parentId);
  const c = db.transactions.find((t) => t.feeOf === parentId);
  if (c) feeSel = { choice: 'amt', amt: c.amount, text: '' };
  else if (p) feeSel.choice = 'none'; // eski kayıtlar: masraf yok kabul edilir
}

function feeValue(ctx = feeContext()) {
  const accId = ctx?.accId || null;
  if (!feeNeeded(ctx)) return { ok: true, asked: false, fee: 0, accId };
  if (feeSel.choice === 'none') return { ok: true, asked: true, fee: 0, accId };
  if (feeSel.choice === 'amt') return { ok: true, asked: true, fee: feeSel.amt, accId };
  if (feeSel.choice === 'other') {
    const v = parseAmount(feeSel.text);
    return v > 0 ? { ok: true, asked: true, fee: v, accId } : { ok: false, accId, why: 'amount' };
  }
  return { ok: false, accId };
}

function feeAsk(fv) {
  const box = $('#fee-slot .fee-box');
  if (box) { box.classList.remove('attn'); void box.offsetWidth; box.classList.add('attn'); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  if (fv?.why === 'amount') { $('#fee-amt')?.classList.add('invalid'); toast('Masraf tutarını yaz'); }
  else toast('Masraf kesildi mi? Tutarı seç ya da "Masraf yok" de');
}

/* ------------------------------ öğrenme ------------------------------ */

function feeHistory() {
  const comp = new Map();
  for (const t of db.transactions) if (t.feeOf) comp.set(t.feeOf, t);
  const out = [];
  for (const t of db.transactions) {
    if (t.feeOf) continue;
    const acc = t.type === 'transfer' ? t.fromId : t.accountId;
    if (!acc) continue;
    const c = comp.get(t.id);
    if (c) out.push({ acc, amount: t.type === 'transfer' && t.feeMode === 'deduct' ? t.amount + c.amount : t.amount, fee: c.amount, at: t.createdAt || 0 });
    else if (t.feeAmt === 0) out.push({ acc, amount: t.amount, fee: 0, at: t.createdAt || 0 });
  }
  return out;
}

function suggestFee(accId, amount) {
  const all = feeHistory();
  let H = all.filter((h) => h.acc === accId);
  const a = accById(accId);
  if (!H.length && a?.bank) H = all.filter((h) => accById(h.acc)?.bank === a.bank);
  const recent = [...H].sort((x, y) => y.at - x.at);
  const others = [...new Set(recent.map((h) => h.fee).filter((f) => f > 0))];
  if (!H.length || !(amount > 0)) return { fee: null, others };
  const below = H.filter((h) => h.amount <= amount).sort((x, y) => y.amount - x.amount || y.at - x.at)[0];
  const above = H.filter((h) => h.amount >= amount).sort((x, y) => x.amount - y.amount || y.at - x.at)[0];
  const said = (f) => (f ? `${money(f)} kesildi` : 'masraf kesilmedi');
  if (below && above && below.fee === above.fee) {
    const why = below.amount === above.amount ? `Bu tutarda daha önce ${said(below.fee)}`
      : `${money(below.amount)} ile ${money(above.amount)} arasındaki gönderimlerde ${said(below.fee)}`;
    return { fee: below.fee, why, sure: true, others };
  }
  const near = [below, above].filter(Boolean).sort((x, y) => Math.abs(Math.log(x.amount / amount)) - Math.abs(Math.log(y.amount / amount)))[0];
  const edge = below && above ? ' · bu tutar iki ücret aralığının arasında, kontrol et' : '';
  return { fee: near.fee, why: `En yakın tutarda (${money(near.amount)}) ${said(near.fee)}${edge}`, sure: false, others };
}

/* ------------------------------ görünüm ------------------------------ */

function feeBox() {
  const ctx = feeContext();
  if (!feeNeeded(ctx)) return '';
  const s = suggestFee(ctx.accId, ctx.amount);
  const chips = [];
  const on = (c, v) => feeSel.choice === c && (v == null || feeSel.amt === v);
  chips.push(`<button class="chip ${on('none') ? 'on' : ''}" data-action="fee-pick" data-val="none">Masraf yok${s.fee === 0 ? ' <small>tahmin</small>' : ''}</button>`);
  const amts = [...(s.fee > 0 ? [s.fee] : []), ...s.others.filter((f) => f !== s.fee)].slice(0, 3);
  if (feeSel.choice === 'amt' && feeSel.amt > 0 && !amts.includes(feeSel.amt)) amts.unshift(feeSel.amt);
  for (const v of amts) chips.push(`<button class="chip ${on('amt', v) ? 'on' : ''}" data-action="fee-pick" data-val="${v}">${money(v)}${v === s.fee ? ' <small>tahmin</small>' : ''}</button>`);
  chips.push(`<button class="chip ${on('other') ? 'on' : ''}" data-action="fee-pick" data-val="other">Başka tutar</button>`);
  const fv = feeValue(ctx);
  return `<div class="fee-box ${feeSel.choice ? 'done' : ''}">
    <div class="between"><b>Masraf / komisyon kesildi mi?</b>${feeSel.choice ? icon('circle-check', 18) : '<small class="fee-req">Gerekli</small>'}</div>
    <div class="fee-chips">${chips.join('')}</div>
    ${feeSel.choice === 'other' ? `<div class="xfee-in fee-in"><input id="fee-amt" inputmode="decimal" autocomplete="off" placeholder="ör. 8,63" value="${esc(feeSel.text)}" data-input="fee-amt"><span>${esc(db.settings.currency)}</span></div>` : ''}
    ${ctx.xfer && fv.ok && fv.fee > 0 ? `<div class="seg fee-mode">
      <button data-action="x-mode" data-val="extra" class="${xfer.feeMode === 'extra' ? 'on' : ''}">Ayrıca kesildi</button>
      <button data-action="x-mode" data-val="deduct" class="${xfer.feeMode === 'deduct' ? 'on' : ''}">Tutardan düştü</button>
    </div>` : ''}
    <small class="acc-info">${esc(s.why || (s.others.length ? 'Bu hesaptan daha önce kesilen tutarlar' : 'EFT, havale ya da kart ödemesinde banka ücret kestiyse tutarı gir. Zamanla tutara göre kendisi tahmin eder.'))}</small>
  </div>`;
}

const feeSlot = () => '<div id="fee-slot"></div>';

function refreshFee() {
  const slot = $('#fee-slot');
  if (!slot) return;
  const focus = document.activeElement?.id === 'fee-amt';
  slot.innerHTML = feeBox();
  if (focus) { const i = $('#fee-amt'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}

/* ------------------------------ kayıt ------------------------------ */

// Ana kaydın masraf gideri: oluştur / güncelle / kaldır
function applyFee(parentId, fv, label) {
  const p = db.transactions.find((t) => t.id === parentId);
  if (!p) return;
  const now = Date.now();
  const comp = db.transactions.find((t) => t.feeOf === parentId);
  if (fv.asked) p.feeAmt = fv.fee;
  else delete p.feeAmt;
  if (fv.asked && fv.fee > 0) {
    ensureFeeCategory();
    const fd = { type: 'expense', amount: fv.fee, categoryId: FEE_CAT_ID, accountId: fv.accId, date: p.date, note: label, feeOf: parentId, awaiting: !!p.awaiting, updatedAt: now };
    if (comp) { Object.assign(comp, fd); touch('tx', comp.id); }
    else { const id = uid(); db.transactions.push({ id, createdAt: now, ...fd }); touch('tx', id); }
  } else if (comp) {
    db.transactions = db.transactions.filter((t) => t.id !== comp.id);
    db.deleted.push({ id: comp.id, kind: 'tx', at: now, data: comp });
    touch('tx', comp.id);
  }
  touch('tx', parentId);
}

// Ana kayıt silinince masrafı da silinsin
function dropFees(parentIds) {
  const ids = new Set(parentIds);
  const gone = db.transactions.filter((t) => t.feeOf && ids.has(t.feeOf));
  if (!gone.length) return;
  const now = Date.now();
  db.transactions = db.transactions.filter((t) => !gone.includes(t));
  for (const t of gone) { db.deleted.push({ id: t.id, kind: 'tx', at: now, data: t }); touch('tx', t.id); }
}

/* ------------------------------ olaylar ------------------------------ */

Object.assign(actions, {
  'fee-pick': (el) => {
    const v = el.dataset.val;
    if (v === 'none') feeSel = { ...feeSel, choice: 'none' };
    else if (v === 'other') feeSel = { ...feeSel, choice: 'other' };
    else feeSel = { ...feeSel, choice: 'amt', amt: Number(v) };
    refreshFee();
    if (v === 'other') setTimeout(() => $('#fee-amt')?.focus(), 30);
    if ($('#x-amount') && xfer) refreshTransfer();
  },
});

// Hesap, tutar ya da kategori değişince soru ve tahmin güncellensin
const FEE_ACTIONS = new Set(['form-acc', 'form-cat', 'p-acc', 'df-acc', 'gp-acc', 'rc-acc']);
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el && FEE_ACTIONS.has(el.dataset.action)) setTimeout(refreshFee, 0);
});
const FEE_AMOUNTS = new Set(['f-amount', 'p-amount', 'd-amount', 'gp-amount', 'rc-amount', 'x-amount']);
let feeTimer;
document.addEventListener('input', (e) => {
  if (e.target.id === 'fee-amt') {
    feeSel.text = e.target.value;
    e.target.classList.remove('invalid');
    if ($('#x-amount') && xfer) refreshTransfer();
    return;
  }
  if (FEE_AMOUNTS.has(e.target.id)) { clearTimeout(feeTimer); feeTimer = setTimeout(refreshFee, 300); }
});
