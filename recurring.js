'use strict';

/* =====================================================================
   Düzenli gelir ve giderler: maaş, kira, faturalar, abonelikler, taksitler…
   Sıklık: her hafta, 2 haftada bir, her ay, 3 ayda bir, 6 ayda bir, her yıl.
   Bitiş: süresiz, belirli bir tarihe kadar ya da belirli sayıda (taksit gibi).
   Günü gelince "geldi mi / ödendi mi?" diye sorulur; onaylanınca gerçek tutar ve
   tarihle normal bir işlem kaydı oluşur (recId + recDate; o işlem silinirse tekrar "bekliyor").
   ===================================================================== */

ui.recAnchor = todayISO();

const FREQS = {
  weekly: { label: 'Her hafta', unit: 'w', n: 1 },
  biweekly: { label: '2 haftada bir', unit: 'w', n: 2 },
  monthly: { label: 'Her ay', unit: 'm', n: 1 },
  quarterly: { label: '3 ayda bir', unit: 'm', n: 3 },
  semiannual: { label: '6 ayda bir', unit: 'm', n: 6 },
  yearly: { label: 'Her yıl', unit: 'm', n: 12 },
};
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0]; // Pzt … Paz

const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();
const dueIn = (y, m, day) => toISO(new Date(y, m, Math.min(day, lastDayOf(y, m))));
const recName = (r) => r.name || (catMap()[r.categoryId] || MISSING_CAT).name;
const recCat = (r) => catMap()[r.categoryId] || MISSING_CAT;
const recFreq = (r) => (FREQS[r.freq] ? r.freq : 'monthly');
const fullDay = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`; };

// Türkçe sıra eki: 1'i, 2'si, 3'ü, 4'ü, 5'i, 6'sı, 7'si, 8'i, 9'u, 10'u, 20'si, 30'u …
function dayLabel(n) {
  if (n >= 31) return 'Ayın son günü';
  const tens = { 10: 'u', 20: 'si', 30: 'u' };
  const ones = { 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u' };
  return `Her ayın ${n}'${n % 10 === 0 ? tens[n] : ones[n % 10]}`;
}

function freqText(r) {
  const f = recFreq(r), F = FREQS[f];
  const s = r.startDate ? fromISO(r.startDate) : new Date();
  if (F.unit === 'w') return `${F.label} ${DAYS[s.getDay()]}`;
  if (f === 'monthly') return dayLabel(r.day);
  if (f === 'yearly') return `Her yıl ${s.getDate()} ${MONTHS[s.getMonth()]}`;
  return `${F.label}, ayın ${r.day >= 31 ? 'son günü' : `${r.day}. günü`}`;
}

function endText(r) {
  if (!r.endDate) return 'süresiz';
  return r.count ? `${r.count} kez · son ${fullDay(r.endDate)}` : `bitiş ${fullDay(r.endDate)}`;
}

/* Verilen aralıkta düşen vade tarihleri */
function occurrences(rec, from, to) {
  const out = [];
  const F = FREQS[recFreq(rec)];
  const start = rec.startDate || from;
  const lo = from > start ? from : start;
  const hi = rec.endDate && rec.endDate < to ? rec.endDate : to;
  if (lo > hi) return out;
  const s = fromISO(start);
  if (F.unit === 'w') {
    const step = 7 * F.n;
    const k = Math.max(0, Math.ceil(dayDiff(s, fromISO(lo)) / step));
    for (let d = addDays(s, k * step), i = 0; toISO(d) <= hi && i < 400; d = addDays(d, step), i++) out.push(toISO(d));
  } else {
    const day = rec.day || s.getDate();
    const l = fromISO(lo);
    let k = Math.max(0, Math.floor(((l.getFullYear() - s.getFullYear()) * 12 + l.getMonth() - s.getMonth()) / F.n) - 1);
    for (let i = 0; i < 400; i++, k++) {
      const due = dueIn(s.getFullYear(), s.getMonth() + k * F.n, day);
      if (due > hi) break;
      if (due >= lo) out.push(due);
    }
  }
  return out;
}

const nextOccurrence = (rec, from = todayISO()) => occurrences(rec, from, toISO(addDays(fromISO(from), 800)))[0] || null;

function occStatus(rec, due) {
  const tx = db.transactions.find((t) => t.recId === rec.id && t.recDate === due);
  if (tx) return { state: 'done', tx };
  if ((rec.skipped || []).includes(due)) return { state: 'skipped' };
  const today = todayISO();
  if (due < today) return { state: 'late', days: dayDiff(fromISO(due), fromISO(today)) };
  if (due === today) return { state: 'today', days: 0 };
  return { state: 'upcoming', days: dayDiff(fromISO(today), fromISO(due)) };
}

/* Dönemdeki tüm vadeler; içinde bulunulan dönemse önceki 2 aydan kalan gecikmişler de eklenir. */
function recItems(per) {
  const today = todayISO();
  const current = today >= per.start && today <= per.end;
  const lookback = toISO(addDays(fromISO(per.start), -62));
  const before = toISO(addDays(fromISO(per.start), -1));
  const items = [];
  for (const rec of db.recurring) {
    for (const due of occurrences(rec, per.start, per.end)) {
      const st = occStatus(rec, due);
      if (rec.paused && st.state !== 'done') continue;
      items.push({ rec, due, ...st });
    }
    if (current && !rec.paused) {
      for (const due of occurrences(rec, lookback, before)) {
        const st = occStatus(rec, due);
        if (st.state === 'late') items.push({ rec, due, ...st, carried: true });
      }
    }
  }
  return items.sort((x, y) => (x.due < y.due ? -1 : x.due > y.due ? 1 : 0));
}

function recSummary(items) {
  const s = { inc: { exp: 0, done: 0, wait: 0 }, exp: { exp: 0, done: 0, wait: 0 } };
  for (const it of items) {
    if (it.carried || it.state === 'skipped') continue;
    const k = it.rec.type === 'income' ? 'inc' : 'exp';
    if (it.state === 'done') { s[k].done += it.tx.amount; s[k].exp += it.tx.amount; }
    else { s[k].wait += it.rec.amount; s[k].exp += it.rec.amount; }
  }
  return s;
}

// Bütçe tahmini için: dönemde henüz ödenmemiş düzenli giderler (bugün ve sonrası)
function plannedPending(per, b) {
  let sum = 0;
  for (const it of recItems(per)) {
    if (it.carried || it.rec.type !== 'expense' || !(it.state === 'today' || it.state === 'upcoming')) continue;
    if (b && b.scope === 'cat' && it.rec.categoryId !== b.categoryId) continue;
    sum += it.rec.amount;
  }
  return sum;
}

function attentionItems() {
  return recItems(budgetPeriod(todayISO())).filter((it) => it.state === 'late' || it.state === 'today');
}

// Aynı kaydın iki kez eklenip eklenmediğini anlamak için
const dupKey = (r) => `${r.type}|${recName(r).toLocaleLowerCase('tr').trim()}|${r.amount}|${recFreq(r)}`;

/* ------------------------------ görünüm ------------------------------ */

function stateText(it) {
  const inc = it.rec.type === 'income';
  switch (it.state) {
    case 'done': return `${inc ? 'Geldi' : 'Ödendi'} · ${shortDay(it.tx.date)}`;
    case 'skipped': return 'Atlandı';
    case 'late': return `${it.days} gün gecikti`;
    case 'today': return 'Bugün';
    default: return it.days === 1 ? 'Yarın' : `${it.days} gün sonra`;
  }
}

function occRow(it) {
  const inc = it.rec.type === 'income';
  const c = recCat(it.rec);
  const pending = it.state === 'late' || it.state === 'today';
  const amount = it.state === 'done' ? it.tx.amount : it.rec.amount;
  return `<div class="occ ${it.state}">
    <button class="occ-tap" data-action="rec-occ" data-id="${it.rec.id}" data-due="${it.due}">
      <span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span>
      <span class="occ-main"><b>${esc(recName(it.rec))}</b><small>${shortDay(it.due)} · <span class="st">${esc(stateText(it))}</span></small></span>
      ${pending ? '' : `<span class="amt ${it.state === 'done' ? (inc ? 'inc' : 'exp') : 'muted'}">${inc ? '+' : '−'}${money(amount)}</span>`}
    </button>
    ${pending ? `<button class="btn small ok" data-action="rec-confirm" data-id="${it.rec.id}" data-due="${it.due}">${inc ? 'Geldi' : 'Ödendi'} · ${money(amount)}</button>` : ''}
  </div>`;
}

function recDefRow(r, dups) {
  const c = recCat(r);
  const next = r.paused ? null : nextOccurrence(r);
  const sub = [freqText(r), r.paused ? 'duraklatıldı' : next ? `sıradaki ${fullDay(next)}` : 'bitti', endText(r)].join(' · ');
  return `<button class="tx" data-action="rec-edit" data-id="${r.id}">
    <span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span>
    <span class="tx-main"><b>${esc(recName(r))}${dups.has(dupKey(r)) ? ' <span class="lchip warn">2 kez eklenmiş</span>' : ''}</b><small>${esc(sub)}</small></span>
    <span class="amt ${r.type === 'income' ? 'inc' : 'exp'}">${r.type === 'income' ? '+' : '−'}${money(r.amount)}</span>
  </button>`;
}

const REC_TEMPLATES = [
  { type: 'income', name: 'Maaş', cat: 'Maaş', icon: '💼' },
  { type: 'expense', name: 'Kira', cat: 'Kira', icon: '🏠', day: 1 },
  { type: 'expense', name: 'Elektrik', cat: 'Elektrik', icon: '💡', variable: true },
  { type: 'expense', name: 'Doğalgaz', cat: 'Doğalgaz', icon: '🔥', variable: true },
  { type: 'expense', name: 'Su', cat: 'Su', icon: '🚿', variable: true },
  { type: 'expense', name: 'İnternet', cat: 'İnternet', icon: '🌐' },
  { type: 'expense', name: 'Telefon', cat: 'Telefon faturası', icon: '📱' },
  { type: 'expense', name: 'Aidat', cat: 'Aidat', icon: '🏢' },
  { type: 'expense', name: 'Abonelik', cat: 'Abonelikler', icon: '📺' },
  { type: 'expense', name: 'Kredi taksiti', cat: 'Kredi / Borç', icon: '🏦' },
  { type: 'income', name: 'Harçlık', cat: 'Harçlık', icon: '👛', freq: 'weekly' },
  { type: 'expense', name: 'Sigorta', cat: 'Sigorta', icon: '🛡️', freq: 'yearly' },
];

function viewRecurring() {
  const per = getPeriod({ mode: 'month', anchor: ui.recAnchor });
  const nav = monthNav(per, 'rec');

  if (!db.recurring.length) {
    return `${nav}
      <div class="card empty-card">
        <span class="empty-ico">${icon('repeat', 26)}</span>
        <b>Düzenli gelir ve giderler</b>
        <p>Maaş, kira, fatura, abonelik, taksit… Günü gelince "geldi mi / ödendi mi?" diye sorayım.</p>
      </div>
      <div class="card"><h3>Hızlı ekle</h3>
        <div class="tpl-grid">${REC_TEMPLATES.map((t, i) => `<button class="cat-tile" data-action="rec-tpl" data-i="${i}"><span>${glyph(t.icon, 22)}</span><em>${esc(t.name)}</em></button>`).join('')}</div>
        <button class="btn block" style="margin-top:12px" data-action="rec-new">+ Başka bir şey ekle</button>
      </div>`;
  }

  const items = recItems(per);
  const s = recSummary(items);
  const att = items.filter((it) => it.state === 'late' || it.state === 'today');
  const rest = items.filter((it) => !(it.state === 'late' || it.state === 'today'));
  const sumBox = (k, label, doneLabel) => `<div>
    <small>${label}</small>
    <b class="${k === 'inc' ? 'inc' : 'exp'}">${money(s[k].exp)}</b>
    <span>${doneLabel} ${money(s[k].done)}</span>
  </div>`;

  const counts = {};
  for (const r of db.recurring) counts[dupKey(r)] = (counts[dupKey(r)] || 0) + 1;
  const dups = new Set(Object.keys(counts).filter((k) => counts[k] > 1));
  const defs = [...db.recurring].sort((a, b) => (a.type !== b.type ? (a.type === 'income' ? -1 : 1) : (nextOccurrence(a) || '9999') < (nextOccurrence(b) || '9999') ? -1 : 1));

  return `${nav}
    ${subsCard()}
    <div class="sum-strip two">
      ${sumBox('inc', 'Bu ay düzenli gelir', 'Gelen')}
      ${sumBox('exp', 'Bu ay düzenli gider', 'Ödenen')}
    </div>
    ${att.length ? `<h2 class="sec">Onay bekleyenler</h2><div class="list occ-list">${att.map(occRow).join('')}</div>` : ''}
    <h2 class="sec">Bu ay</h2>
    ${rest.length ? `<div class="list occ-list">${rest.map(occRow).join('')}</div>` : '<p class="muted small" style="margin:0 4px">Bu ay için başka gelir/gider yok.</p>'}
    <div class="sec-head"><h2 class="sec">Düzenli kayıtların (${db.recurring.length})</h2><button class="link" data-action="rec-new">+ Ekle</button></div>
    ${dups.size ? `<p class="dup-note">Bazı kayıtlar iki kez eklenmiş görünüyor. Fazla olana dokunup silebilirsin.</p>` : ''}
    <div class="list">${defs.map((r) => recDefRow(r, dups)).join('')}</div>
  `;
}

/* -------------------------- onay penceresi -------------------------- */

let recConfirm = null;

function openConfirm(recId, due) {
  const rec = db.recurring.find((r) => r.id === recId);
  if (!rec) return;
  const st = occStatus(rec, due);
  const inc = rec.type === 'income';
  const today = todayISO();
  recConfirm = { recId, due, accountId: accById(rec.accountId) ? rec.accountId : lastAccountId() };
  feeReset();
  const c = recCat(rec);

  if (st.state === 'done') {
    openSheet(`
      <div class="sheet-head"><h2>${esc(recName(rec))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
      <div class="preview"><span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span><span><b>${inc ? 'Geldi' : 'Ödendi'}: ${money(st.tx.amount)}</b><small class="muted" style="display:block">${longDate(st.tx.date)} · beklenen ${shortDay(due)}, ${money(rec.amount)}</small></span></div>
      <div class="btn-stack">
        <button class="btn" data-action="edit-tx" data-id="${st.tx.id}">Kaydı düzenle</button>
        <button class="btn danger" data-action="rec-undo" data-tx="${st.tx.id}">Onayı geri al</button>
        <button class="btn" data-action="rec-edit" data-id="${rec.id}">Düzenli kaydın ayarları</button>
      </div>`);
    return;
  }
  if (st.state === 'skipped') {
    openSheet(`
      <div class="sheet-head"><h2>${esc(recName(rec))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
      <p>${fullDay(due)} tarihli ${inc ? 'gelir' : 'ödeme'} <b>atlandı</b> olarak işaretli.</p>
      <div class="btn-stack"><button class="btn primary" data-action="rec-unskip">Atlamayı geri al</button></div>`);
    return;
  }
  const defDate = due <= today ? due : today;
  openSheet(`
    <div class="sheet-head"><h2>${esc(recName(rec))} ${inc ? 'geldi mi?' : 'ödendi mi?'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="preview"><span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span><span><b>Beklenen: ${money(rec.amount)}</b><small class="muted" style="display:block">${longDate(due)}${st.state === 'late' ? ` · <span class="exp">${st.days} gün gecikti</span>` : ''}</small></span></div>
    <div class="field"><label>${inc ? 'Gelen' : 'Ödenen'} tutar${rec.variable ? ' (bu seferki gerçek tutarı yaz)' : ''}</label>
      <div class="amount-field"><input id="rc-amount" inputmode="decimal" autocomplete="off" value="${amountToInput(rec.amount)}"><span>${esc(db.settings.currency)}</span></div>
    </div>
    ${accountPicker(recConfirm.accountId, rec.type, 'rc-acc')}
    ${feeSlot()}
    <div class="field"><label>Tarih</label>
      <input type="date" id="rc-date" value="${defDate}">
      <div class="chips"><button class="chip" data-action="rc-date" data-val="${due}">Vade günü</button><button class="chip" data-action="rc-date" data-val="${today}">Bugün</button></div>
    </div>
    <label class="check"><input type="checkbox" id="rc-update"><span><b>Sonrakiler için de bu tutarı kullan</b><small>Maaşın arttıysa ya da ücret değiştiyse işaretle.</small></span></label>
    <div class="actions">
      <button class="btn" data-action="rec-skip">Bu sefer atla</button>
      <button class="btn primary" data-action="rec-do-confirm">${inc ? 'Geldi' : 'Ödendi'}</button>
    </div>`);
  if (rec.variable) setTimeout(() => { const a = $('#rc-amount'); a?.focus(); a?.select(); }, 60);
}

function confirmOccurrence() {
  const rec = db.recurring.find((r) => r.id === recConfirm?.recId);
  if (!rec) return;
  const amount = parseAmount($('#rc-amount').value);
  const date = $('#rc-date').value;
  if (!(amount > 0)) { $('#rc-amount').classList.add('invalid'); toast('Geçerli bir tutar gir'); return; }
  if (!date) { toast('Tarih seç'); return; }
  const fv = feeValue();
  if (!fv.ok) { feeAsk(fv); return; }
  const now = Date.now();
  const before = budgetSnapshot(date);
  const accountId = recConfirm.accountId || null;
  const tx = { id: uid(), type: rec.type, amount, categoryId: rec.categoryId, date, note: recName(rec), accountId, recId: rec.id, recDate: recConfirm.due, createdAt: now, updatedAt: now };
  // Seçilen hesabı bir sonraki sefer için hatırla
  if ((rec.accountId || null) !== accountId) { rec.accountId = accountId; rec.updatedAt = now; touch('rec', rec.id); }
  db.transactions.push(tx);
  touch('tx', tx.id);
  applyFee(tx.id, fv, `Masraf · ${recName(rec)}`);
  if ($('#rc-update').checked && amount !== rec.amount) { rec.amount = amount; rec.updatedAt = now; touch('rec', rec.id); }
  save();
  closeSheet();
  render();
  const warnings = tx.type === 'expense' ? budgetWarningsAfterSave(before, tx) : [];
  if (warnings.length) alertToast(warnings);
  else toast(`${recName(rec)}: ${rec.type === 'income' ? 'geldi' : 'ödendi'} olarak kaydedildi`);
}

function setSkip(skip) {
  const rec = db.recurring.find((r) => r.id === recConfirm?.recId);
  if (!rec) return;
  const due = recConfirm.due;
  rec.skipped = (rec.skipped || []).filter((d) => d !== due);
  if (skip) rec.skipped.push(due);
  rec.updatedAt = Date.now();
  touch('rec', rec.id);
  save();
  closeSheet();
  render();
  toast(skip ? 'Bu sefer atlandı' : 'Tekrar bekleniyor');
}

/* ---------------------------- tanım formu ---------------------------- */

let recForm = null;

// Ayın "day" günü: bu ay geçmediyse bu ay, geçtiyse gelecek ay
function nextDue(day, from = todayISO()) {
  const d = fromISO(from);
  const thisMonth = dueIn(d.getFullYear(), d.getMonth(), day);
  return thisMonth >= from ? thisMonth : dueIn(d.getFullYear(), d.getMonth() + 1, day);
}
// Haftanın "wd" günü (0 = Pazar): from ve sonrasındaki ilk gün
function nextWeekday(wd, from = todayISO()) {
  const d = fromISO(from);
  return toISO(addDays(d, (wd - d.getDay() + 7) % 7));
}

function defaultStart(f, from = todayISO()) {
  const F = FREQS[f.freq];
  if (F.unit === 'w') return nextWeekday(f.weekday, from);
  if (f.freq === 'yearly') return f.startDate || from;
  return nextDue(f.day, from);
}

function openRecForm(init = {}) {
  const today = fromISO(todayISO());
  recForm = {
    id: null, type: 'expense', name: '', amountText: '', categoryId: null,
    freq: 'monthly', day: today.getDate(), weekday: today.getDay(), startDate: null,
    endMode: 'none', endDate: '', countText: '', variable: false, paused: false, accountId: lastAccountId(),
    ...init,
  };
  if (!recForm.startDate) recForm.startDate = defaultStart(recForm);
  renderRecForm();
}

function syncRecForm() {
  if (!recForm || !$('#r-name')) return;
  const v = (id) => $(id)?.value;
  recForm.name = v('#r-name');
  recForm.amountText = v('#r-amount');
  recForm.startDate = v('#r-start') || recForm.startDate;
  if ($('#r-end')) recForm.endDate = v('#r-end');
  if ($('#r-count')) recForm.countText = v('#r-count');
  recForm.variable = $('#r-var').checked;
  if ($('#r-paused')) recForm.paused = $('#r-paused').checked;
}

// Formdaki ayarlardan geçici bir kayıt (önizleme ve kaydetme için)
function recFromForm(f) {
  const r = { freq: f.freq, day: f.day, startDate: f.startDate, endDate: null, count: null };
  if (FREQS[f.freq].unit === 'w') r.startDate = nextWeekday(f.weekday, f.startDate);
  if (f.freq === 'yearly') r.day = fromISO(r.startDate).getDate();
  if (f.endMode === 'date' && f.endDate) r.endDate = f.endDate;
  if (f.endMode === 'count') {
    const n = parseInt(f.countText, 10);
    if (n > 0) {
      const list = occurrences(r, r.startDate, toISO(addDays(fromISO(r.startDate), Math.min(n, 400) * 7 * FREQS[f.freq].n * (FREQS[f.freq].unit === 'w' ? 1 : 4.5) + 31)));
      r.count = n;
      r.endDate = list[Math.min(n, list.length) - 1] || null;
    }
  }
  return r;
}

function recPreview() {
  const f = recForm;
  const r = recFromForm(f);
  const next = occurrences(r, r.startDate, toISO(addDays(fromISO(r.startDate), 800))).slice(0, 3);
  if (!next.length) return '<span class="exp">Bu ayarlarla hiç tarih oluşmuyor; bitiş tarihini kontrol et.</span>';
  return `<b>${esc(freqText(r))}</b> · ${esc(endText(r))}<br>Sıradaki: ${next.map(fullDay).join(', ')}${next.length === 3 ? '…' : ''}`;
}

function renderRecForm() {
  const f = recForm;
  const F = FREQS[f.freq];
  const usage = usageCounts();
  const cats = db.categories.filter((c) => c.type === f.type).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  const editing = !!f.id;
  const thisDue = dueIn(fromISO(todayISO()).getFullYear(), fromISO(todayISO()).getMonth(), f.day);
  openSheet(`
    <div class="sheet-head"><h2>${editing ? 'Düzenli kaydı düzenle' : 'Yeni düzenli kayıt'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="seg type field">
      <button data-action="rf-type" data-val="expense" class="${f.type === 'expense' ? 'on' : ''}">− Gider</button>
      <button data-action="rf-type" data-val="income" class="${f.type === 'income' ? 'on' : ''}">+ Gelir</button>
    </div>
    ${editing ? '' : `<div class="tpl-chips">${REC_TEMPLATES.filter((t) => t.type === f.type).map((t) => `<button class="chip" data-action="rf-tpl" data-i="${REC_TEMPLATES.indexOf(t)}">${esc(t.name)}</button>`).join('')}</div>`}
    <div class="field"><label>Ad</label><input id="r-name" value="${esc(f.name)}" maxlength="40" placeholder="${f.type === 'income' ? 'ör. Maaş, Burs, Kira geliri' : 'ör. Kira, Netflix, Elektrik'}"></div>
    <div class="field"><label>${f.variable ? 'Tahmini tutar' : 'Tutar'}</label>
      <div class="amount-field"><input id="r-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.amountText)}"><span>${esc(db.settings.currency)}</span></div>
    </div>
    <label class="check"><input type="checkbox" id="r-var" ${f.variable ? 'checked' : ''}><span><b>Tutar her seferinde değişebilir</b><small>Fatura gibi. Onaylarken gerçek tutarı girersin.</small></span></label>
    <div class="field"><label>Kategori</label>
      <div class="cat-grid">${cats.map((c) => `<button class="cat-tile ${f.categoryId === c.id ? 'on' : ''}" style="--c:${col(c.color)}" data-action="rf-cat" data-id="${c.id}"><span>${glyph(c.icon)}</span><em>${esc(c.name)}</em></button>`).join('')}</div>
    </div>

    <div class="field"><label>Ne sıklıkla?</label>
      <div class="opt-grid">${Object.entries(FREQS).map(([k, v]) => `<button class="${f.freq === k ? 'on' : ''}" data-action="rf-freq" data-val="${k}">${v.label}</button>`).join('')}</div>
    </div>
    ${F.unit === 'w' ? `<div class="field"><label>Hangi gün?</label>
      <div class="wd-row">${WEEKDAYS.map((d) => `<button class="${f.weekday === d ? 'on' : ''}" data-action="rf-wd" data-val="${d}">${DAYS_SHORT[d]}</button>`).join('')}</div>
    </div>` : f.freq === 'yearly' ? '' : `<div class="field"><label>Ayın kaçında?</label>
      <select id="r-day" data-change="rf-day">${Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${f.day === n ? 'selected' : ''}>${n >= 31 ? '31 / ayın son günü' : n}</option>`).join('')}</select>
    </div>`}
    <div class="field"><label>${f.freq === 'yearly' ? 'Tarih (her yıl bu gün)' : 'İlk tarih'}</label>
      <input type="date" id="r-start" value="${f.startDate}" data-change="rf-start">
      ${!editing && f.freq === 'monthly' && thisDue < todayISO() ? `<div class="chips"><button class="chip" data-action="rf-start" data-val="${thisDue}">Bu ayınkini de ekle (${shortDay(thisDue)})</button></div>` : ''}
    </div>
    <div class="field"><label>Ne zamana kadar?</label>
      <div class="seg">
        <button data-action="rf-end" data-val="none" class="${f.endMode === 'none' ? 'on' : ''}">Süresiz</button>
        <button data-action="rf-end" data-val="date" class="${f.endMode === 'date' ? 'on' : ''}">Tarihe kadar</button>
        <button data-action="rf-end" data-val="count" class="${f.endMode === 'count' ? 'on' : ''}">Kaç kez</button>
      </div>
      ${f.endMode === 'date' ? `<input type="date" id="r-end" value="${f.endDate || ''}" min="${f.startDate}" data-change="rf-refresh" style="margin-top:8px">` : ''}
      ${f.endMode === 'count' ? `<input id="r-count" inputmode="numeric" value="${esc(f.countText)}" placeholder="ör. 12 (taksit sayısı)" data-input="rf-refresh" style="margin-top:8px">` : ''}
    </div>
    ${accountPicker(f.accountId, f.type, 'rf-acc')}
    ${editing ? `<label class="check"><input type="checkbox" id="r-paused" ${f.paused ? 'checked' : ''}><span><b>Duraklat</b><small>Bir süreliğine sorma (geçmiş kayıtlar kalır).</small></span></label>` : ''}
    <div class="rec-preview" id="r-preview">${recPreview()}</div>
    <div class="actions">
      ${editing ? `<button class="btn danger" data-action="rf-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="rf-save">Kaydet</button>
    </div>
  `);
}

function saveRec() {
  syncRecForm();
  const f = recForm;
  const amount = parseAmount(f.amountText);
  if (!(amount > 0)) { $('#r-amount').classList.add('invalid'); toast('Geçerli bir tutar gir'); return; }
  if (!f.categoryId) { toast('Bir kategori seç'); return; }
  if (!f.startDate) { toast('İlk tarihi seç'); return; }
  if (f.endMode === 'date' && !f.endDate) { toast('Bitiş tarihini seç'); return; }
  if (f.endMode === 'count' && !(parseInt(f.countText, 10) > 0)) { toast('Kaç kez olacağını yaz'); return; }
  const r = recFromForm(f);
  if (f.endMode === 'date' && r.endDate < r.startDate) { toast('Bitiş tarihi ilk tarihten önce olamaz'); return; }
  const now = Date.now();
  const name = f.name.trim() || (catMap()[f.categoryId] || MISSING_CAT).name;
  const data = {
    type: f.type, name, amount, categoryId: f.categoryId,
    freq: f.freq, day: r.day, startDate: r.startDate, endDate: r.endDate, count: r.count,
    variable: !!f.variable, paused: !!f.paused, accountId: f.accountId || null, updatedAt: now,
  };
  if (!f.id) {
    const twin = db.recurring.find((x) => dupKey(x) === dupKey(data));
    if (twin && !confirm(`"${recName(twin)}" zaten var (${freqText(twin)}, ${money(twin.amount)}).\nYine de ikinci kez eklensin mi?`)) return;
  }
  let id = f.id;
  if (id) Object.assign(db.recurring.find((x) => x.id === id), data);
  else { id = uid(); db.recurring.push({ id, skipped: [], createdAt: now, ...data }); }
  touch('rec', id);
  // Bir işlemden çevrildiyse: tarihi geldiyse ilk sefer olarak bağla, ileri tarihliyse işlemi kaldır (günü gelince sorulacak)
  const src = f.fromTx && db.transactions.find((t) => t.id === f.fromTx);
  if (src) {
    if (src.date > todayISO()) {
      db.transactions = db.transactions.filter((t) => t.id !== src.id);
      db.deleted.push({ id: src.id, kind: 'tx', at: now, data: src });
    } else Object.assign(src, { recId: id, recDate: src.date, updatedAt: now });
    touch('tx', src.id);
  }
  save();
  closeSheet();
  render();
  const next = nextOccurrence(data);
  toast(`Kaydedildi${next ? ` Sıradaki: ${fullDay(next)}` : ''}`);
}

function deleteRec() {
  const r = db.recurring.find((x) => x.id === recForm.id);
  if (!r || !confirm(`"${recName(r)}" düzenli kaydı silinsin mi?\nDaha önce onayladığın gelir/giderler silinmez.`)) return;
  db.recurring = db.recurring.filter((x) => x.id !== r.id);
  db.deleted.push({ id: r.id, kind: 'rec', at: Date.now(), data: r });
  touch('rec', r.id);
  save();
  closeSheet();
  render();
  toast('Düzenli kayıt silindi');
}

function refreshRecPreview() {
  syncRecForm();
  const p = $('#r-preview');
  if (p) p.innerHTML = recPreview();
}

function applyTemplate(t) {
  const cat = db.categories.find((c) => c.type === t.type && c.name === t.cat);
  const freq = t.freq || 'monthly';
  const day = t.type === 'income' && t.cat === 'Maaş' ? db.settings.monthStartDay : t.day || fromISO(todayISO()).getDate();
  Object.assign(recForm, { type: t.type, name: t.name, categoryId: cat?.id || recForm.categoryId, freq, day, variable: !!t.variable });
  recForm.startDate = defaultStart(recForm);
}

/* ------------------------------ olaylar ------------------------------ */

Object.assign(actions, {
  'rec-new': () => openRecForm(),
  'tx-to-rec': (el) => {
    const t = db.transactions.find((x) => x.id === el.dataset.id);
    if (!t) return;
    const d = fromISO(t.date);
    openRecForm({
      type: t.type, name: t.note || (catMap()[t.categoryId] || MISSING_CAT).name, amountText: amountToInput(t.amount),
      categoryId: t.categoryId, freq: 'monthly', day: d.getDate(), weekday: d.getDay(), startDate: t.date, accountId: t.accountId || '', fromTx: t.id,
    });
  },
  'rec-tpl': (el) => { openRecForm(); applyTemplate(REC_TEMPLATES[Number(el.dataset.i)]); renderRecForm(); },
  'rec-edit': (el) => {
    const r = db.recurring.find((x) => x.id === el.dataset.id);
    if (!r) return;
    const start = r.startDate || todayISO();
    openRecForm({
      id: r.id, type: r.type, name: r.name, amountText: amountToInput(r.amount), categoryId: r.categoryId,
      freq: recFreq(r), day: r.day || fromISO(start).getDate(), weekday: fromISO(start).getDay(), startDate: start,
      endMode: r.count ? 'count' : r.endDate ? 'date' : 'none', endDate: r.endDate || '', countText: r.count ? String(r.count) : '',
      variable: !!r.variable, paused: !!r.paused, accountId: r.accountId || '',
    });
  },
  'rec-occ': (el) => openConfirm(el.dataset.id, el.dataset.due),
  'rec-confirm': (el) => openConfirm(el.dataset.id, el.dataset.due),
  'rec-do-confirm': () => confirmOccurrence(),
  'rec-skip': () => setSkip(true),
  'rec-unskip': () => setSkip(false),
  'rec-undo': (el) => { if (confirm('Onay geri alınsın mı? Oluşan kayıt silinir, tekrar "bekliyor" olur.')) deleteTx(el.dataset.tx); },
  'rc-date': (el) => { $('#rc-date').value = el.dataset.val; },
  'rc-acc': (el) => { recConfirm.accountId = pickAccount(el); },
  'rec-shift': (el) => { ui.recAnchor = shiftedPeriod(Number(el.dataset.dir), { mode: 'month', anchor: ui.recAnchor }).anchor; render(); },
  'rec-today': () => { ui.recAnchor = todayISO(); render(); },
  'rf-type': (el) => { syncRecForm(); if (recForm.type !== el.dataset.val) { recForm.type = el.dataset.val; recForm.categoryId = null; } renderRecForm(); },
  'rf-tpl': (el) => { syncRecForm(); applyTemplate(REC_TEMPLATES[Number(el.dataset.i)]); renderRecForm(); },
  'rf-cat': (el) => {
    syncRecForm();
    recForm.categoryId = el.dataset.id;
    if (!recForm.name) recForm.name = (catMap()[el.dataset.id] || MISSING_CAT).name;
    renderRecForm();
  },
  'rf-freq': (el) => {
    syncRecForm();
    recForm.freq = el.dataset.val;
    if (FREQS[recForm.freq].unit === 'w') recForm.weekday = fromISO(recForm.startDate || todayISO()).getDay();
    if (!recForm.id) recForm.startDate = defaultStart(recForm);
    renderRecForm();
  },
  'rf-wd': (el) => {
    syncRecForm();
    recForm.weekday = Number(el.dataset.val);
    recForm.startDate = nextWeekday(recForm.weekday, recForm.id ? recForm.startDate : todayISO());
    renderRecForm();
  },
  'rf-start': (el) => { $('#r-start').value = el.dataset.val; refreshRecPreview(); },
  'rf-end': (el) => { syncRecForm(); recForm.endMode = el.dataset.val; renderRecForm(); },
  'rf-acc': (el) => { recForm.accountId = pickAccount(el); },
  'rf-save': () => saveRec(),
  'rf-delete': () => deleteRec(),
});

Object.assign(changes, {
  'rf-day': (el) => {
    syncRecForm();
    recForm.day = Number(el.value);
    if (!recForm.id) recForm.startDate = nextDue(recForm.day);
    renderRecForm();
  },
  'rf-start': (el) => {
    syncRecForm();
    const d = fromISO(el.value || todayISO());
    if (FREQS[recForm.freq].unit === 'w') recForm.weekday = d.getDay();
    else if (recForm.freq !== 'yearly') recForm.day = d.getDate();
    renderRecForm();
  },
  'rf-refresh': () => refreshRecPreview(),
});

document.addEventListener('input', (e) => {
  if (e.target.dataset?.input === 'rf-refresh' && recForm) refreshRecPreview();
});
