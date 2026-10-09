'use strict';

/* =====================================================================
   Düzenli gelir ve giderler: maaş, kira, faturalar, abonelikler, taksitler…
   Her ay belirlenen günde "geldi mi / ödendi mi?" diye sorulur.
   Onaylanınca gerçek tutar ve tarihle normal bir işlem kaydı oluşur
   (işlemde recId + recDate tutulur; o işlem silinirse kayıt tekrar "bekliyor"a döner).
   ===================================================================== */

ui.recAnchor = todayISO();

const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();
const dueIn = (y, m, day) => toISO(new Date(y, m, Math.min(day, lastDayOf(y, m))));
const recName = (r) => r.name || (catMap()[r.categoryId] || MISSING_CAT).name;
const recCat = (r) => catMap()[r.categoryId] || MISSING_CAT;

// Türkçe sıra eki: 1'i, 2'si, 3'ü, 4'ü, 5'i, 6'sı, 7'si, 8'i, 9'u, 10'u, 20'si, 30'u …
function dayLabel(n) {
  if (n >= 31) return 'Ayın son günü';
  const tens = { 10: 'u', 20: 'si', 30: 'u' };
  const ones = { 1: 'i', 2: 'si', 3: 'ü', 4: 'ü', 5: 'i', 6: 'sı', 7: 'si', 8: 'i', 9: 'u' };
  return `Her ayın ${n}'${n % 10 === 0 ? tens[n] : ones[n % 10]}`;
}

/* Verilen aralıkta düşen vade tarihleri */
function occurrences(rec, from, to) {
  const out = [];
  const a = fromISO(from), b = fromISO(to);
  for (let y = a.getFullYear(), m = a.getMonth(); y < b.getFullYear() || (y === b.getFullYear() && m <= b.getMonth()); m === 11 ? (y++, m = 0) : m++) {
    const due = dueIn(y, m, rec.day);
    if (due < from || due > to) continue;
    if (rec.startDate && due < rec.startDate) continue;
    if (rec.endDate && due > rec.endDate) continue;
    out.push(due);
  }
  return out;
}

function occStatus(rec, due) {
  const tx = db.transactions.find((t) => t.recId === rec.id && t.recDate === due);
  if (tx) return { state: 'done', tx };
  if ((rec.skipped || []).includes(due)) return { state: 'skipped' };
  const today = todayISO();
  if (due < today) return { state: 'late', days: dayDiff(fromISO(due), fromISO(today)) };
  if (due === today) return { state: 'today', days: 0 };
  return { state: 'upcoming', days: dayDiff(fromISO(today), fromISO(due)) };
}

const isPendingState = (s) => s === 'late' || s === 'today' || s === 'upcoming';

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

/* ------------------------------ görünüm ------------------------------ */

function stateText(it) {
  const inc = it.rec.type === 'income';
  switch (it.state) {
    case 'done': return `${inc ? 'Geldi' : 'Ödendi'} · ${shortDay(it.tx.date)}`;
    case 'skipped': return 'Bu ay atlandı';
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
      <span class="ico" style="--c:${c.color}">${esc(c.icon)}</span>
      <span class="occ-main"><b>${esc(recName(it.rec))}</b><small>${shortDay(it.due)} · <span class="st">${esc(stateText(it))}</span></small></span>
      ${pending ? '' : `<span class="amt ${it.state === 'done' ? (inc ? 'inc' : 'exp') : 'muted'}">${inc ? '+' : '−'}${moneyRound(amount)}</span>`}
    </button>
    ${pending ? `<button class="btn small ok" data-action="rec-confirm" data-id="${it.rec.id}" data-due="${it.due}">${inc ? 'Geldi' : 'Ödendi'} · ${moneyRound(amount)}</button>` : ''}
  </div>`;
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
];

const templateGrid = () => `<div class="tpl-grid">${REC_TEMPLATES.map((t, i) => `<button class="cat-tile" data-action="rec-tpl" data-i="${i}"><span>${t.icon}</span><em>${esc(t.name)}</em></button>`).join('')}</div>`;

function viewRecurring() {
  const per = getPeriod({ mode: 'month', anchor: ui.recAnchor });
  const nav = monthNav(per, 'rec');

  if (!db.recurring.length) {
    return `${nav}
      <div class="card empty-card">
        <span class="big">📅</span>
        <b>Düzenli gelir ve giderler</b>
        <p>Maaş, kira, fatura, abonelik… Günü gelince "geldi mi / ödendi mi?" diye sorayım.</p>
      </div>
      <div class="card"><h3>Hızlı ekle</h3>${templateGrid()}
        <button class="btn block" style="margin-top:12px" data-action="rec-new">+ Başka bir şey ekle</button>
      </div>`;
  }

  const items = recItems(per);
  const s = recSummary(items);
  const att = items.filter((it) => it.state === 'late' || it.state === 'today');
  const rest = items.filter((it) => !(it.state === 'late' || it.state === 'today'));
  const sumBox = (k, label, doneLabel) => `<div>
    <small>${label}</small>
    <b class="${k === 'inc' ? 'inc' : 'exp'}">${moneyRound(s[k].exp)}</b>
    <span>${doneLabel} ${moneyRound(s[k].done)}${s[k].wait ? ` · bekleyen ${moneyRound(s[k].wait)}` : ''}</span>
  </div>`;

  return `${nav}
    <div class="sum-strip two">
      ${sumBox('inc', 'Düzenli gelir', 'Gelen')}
      ${sumBox('exp', 'Düzenli gider', 'Ödenen')}
    </div>
    ${att.length ? `<h2 class="sec">Onay bekleyenler</h2><div class="list occ-list">${att.map(occRow).join('')}</div>` : ''}
    <h2 class="sec">Bu ay</h2>
    ${rest.length ? `<div class="list occ-list">${rest.map(occRow).join('')}</div>` : '<p class="muted small">Bu ay için başka kayıt yok.</p>'}
  `;
}

// Tüm düzenli kayıtları yönetme penceresi
function openRecManage() {
  const list = [...db.recurring].sort((a, b) => (a.type === b.type ? a.day - b.day : a.type === 'income' ? -1 : 1));
  openSheet(`
    <div class="sheet-head"><h2>Düzenli kayıtlar</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
    ${list.length ? `<div class="list" style="box-shadow:none">${list.map((r) => {
      const c = recCat(r);
      return `<button class="tx" data-action="rec-edit" data-id="${r.id}">
        <span class="ico" style="--c:${c.color}">${esc(c.icon)}</span>
        <span class="tx-main"><b>${esc(recName(r))}</b><small>${dayLabel(r.day)}${r.variable ? ' · değişken' : ''}${r.endDate ? ` · ${shortDay(r.endDate)} ${fromISO(r.endDate).getFullYear()}'e kadar` : ''}${r.paused ? ' · duraklatıldı' : ''}</small></span>
        <span class="amt ${r.type === 'income' ? 'inc' : 'exp'}">${moneyRound(r.amount)}</span>
      </button>`;
    }).join('')}</div>` : ''}
    <h3 style="margin-top:16px">Ekle</h3>
    ${templateGrid()}
    <button class="btn block" style="margin-top:10px" data-action="rec-new">+ Başka bir şey ekle</button>
  `);
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
  const c = recCat(rec);

  if (st.state === 'done') {
    openSheet(`
      <div class="sheet-head"><h2>${esc(recName(rec))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
      <div class="preview"><span class="ico" style="--c:${c.color}">${esc(c.icon)}</span><span><b>✅ ${inc ? 'Geldi' : 'Ödendi'}: ${money(st.tx.amount)}</b><small class="muted" style="display:block">${longDate(st.tx.date)} · beklenen ${shortDay(due)}, ${money(rec.amount)}</small></span></div>
      <div class="btn-stack">
        <button class="btn" data-action="edit-tx" data-id="${st.tx.id}">✏️ Kaydı düzenle</button>
        <button class="btn danger" data-action="rec-undo" data-tx="${st.tx.id}">↩️ Onayı geri al (kaydı sil)</button>
        <button class="btn" data-action="rec-edit" data-id="${rec.id}">⚙️ Düzenli kaydın ayarları</button>
      </div>`);
    return;
  }
  if (st.state === 'skipped') {
    openSheet(`
      <div class="sheet-head"><h2>${esc(recName(rec))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
      <p>${shortDay(due)} tarihli ${inc ? 'gelir' : 'ödeme'} bu ay için <b>atlandı</b> olarak işaretli.</p>
      <div class="btn-stack"><button class="btn primary" data-action="rec-unskip">Atlamayı geri al</button></div>`);
    return;
  }
  const defDate = due <= today ? due : today;
  openSheet(`
    <div class="sheet-head"><h2>${esc(recName(rec))} ${inc ? 'geldi mi?' : 'ödendi mi?'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
    <div class="preview"><span class="ico" style="--c:${c.color}">${esc(c.icon)}</span><span><b>Beklenen: ${money(rec.amount)}</b><small class="muted" style="display:block">${longDate(due)}${st.state === 'late' ? ` · <span class="exp">${st.days} gün gecikti</span>` : ''}</small></span></div>
    <div class="field"><label>${inc ? 'Gelen' : 'Ödenen'} tutar${rec.variable ? ' (bu ayki gerçek tutarı yaz)' : ''}</label>
      <div class="amount-field"><input id="rc-amount" inputmode="decimal" autocomplete="off" value="${amountToInput(rec.amount)}"><span>${esc(db.settings.currency)}</span></div>
    </div>
    <div class="field"><label>Tarih</label>
      <input type="date" id="rc-date" value="${defDate}">
      <div class="chips"><button class="chip" data-action="rc-date" data-val="${due}">Vade günü</button><button class="chip" data-action="rc-date" data-val="${today}">Bugün</button></div>
    </div>
    ${accountPicker(recConfirm.accountId, rec.type, 'rc-acc')}
    <label class="check"><input type="checkbox" id="rc-update"><span><b>Sonraki aylar için de bu tutarı kullan</b><small>Maaşın arttıysa ya da abonelik ücreti değiştiyse işaretle.</small></span></label>
    <div class="actions">
      <button class="btn" data-action="rec-skip">⏭️ Bu ay atla</button>
      <button class="btn primary" data-action="rec-do-confirm">${inc ? '✓ Geldi' : '✓ Ödendi'}</button>
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
  const now = Date.now();
  const before = budgetSnapshot(date);
  const accountId = recConfirm.accountId || null;
  const tx = { id: uid(), type: rec.type, amount, categoryId: rec.categoryId, date, note: recName(rec), accountId, recId: rec.id, recDate: recConfirm.due, createdAt: now, updatedAt: now };
  // Seçilen hesabı bir sonraki ay için hatırla
  if ((rec.accountId || null) !== accountId) { rec.accountId = accountId; rec.updatedAt = now; touch('rec', rec.id); }
  db.transactions.push(tx);
  touch('tx', tx.id);
  if ($('#rc-update').checked && amount !== rec.amount) { rec.amount = amount; rec.updatedAt = now; touch('rec', rec.id); }
  save();
  closeSheet();
  render();
  const warnings = tx.type === 'expense' ? budgetWarningsAfterSave(before, tx) : [];
  if (warnings.length) alertToast(warnings);
  else toast(`${recName(rec)}: ${rec.type === 'income' ? 'geldi' : 'ödendi'} olarak kaydedildi ✓`);
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
  toast(skip ? 'Bu ay için atlandı' : 'Tekrar bekleniyor');
}

/* ---------------------------- tanım formu ---------------------------- */

let recForm = null;

function nextDue(day, from = todayISO()) {
  const d = fromISO(from);
  const thisMonth = dueIn(d.getFullYear(), d.getMonth(), day);
  return thisMonth >= from ? thisMonth : dueIn(d.getFullYear(), d.getMonth() + 1, day);
}

function openRecForm(init = {}) {
  const day = init.day || fromISO(todayISO()).getDate();
  recForm = { id: null, type: 'expense', name: '', amountText: '', categoryId: null, day, startDate: null, months: '', variable: false, paused: false, ...init };
  if (!recForm.startDate) recForm.startDate = nextDue(recForm.day);
  renderRecForm();
}

function syncRecForm() {
  if (!recForm || !$('#r-name')) return;
  recForm.name = $('#r-name').value;
  recForm.amountText = $('#r-amount').value;
  recForm.startDate = $('#r-start').value || recForm.startDate;
  recForm.months = $('#r-months').value;
  recForm.variable = $('#r-var').checked;
  const p = $('#r-paused');
  if (p) recForm.paused = p.checked;
}

function renderRecForm() {
  const f = recForm;
  const usage = usageCounts();
  const cats = db.categories.filter((c) => c.type === f.type).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  const editing = !!f.id;
  const thisDue = dueIn(fromISO(todayISO()).getFullYear(), fromISO(todayISO()).getMonth(), f.day);
  openSheet(`
    <div class="sheet-head"><h2>${editing ? 'Düzenli kaydı düzenle' : 'Yeni düzenli kayıt'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">✕</button></div>
    <div class="seg type field">
      <button data-action="rf-type" data-val="expense" class="${f.type === 'expense' ? 'on' : ''}">− Gider</button>
      <button data-action="rf-type" data-val="income" class="${f.type === 'income' ? 'on' : ''}">+ Gelir</button>
    </div>
    <div class="field"><label>Ad</label><input id="r-name" value="${esc(f.name)}" maxlength="40" placeholder="${f.type === 'income' ? 'ör. Maaş, Burs, Kira geliri' : 'ör. Kira, Netflix, Elektrik'}"></div>
    <div class="field"><label>${f.variable ? 'Tahmini tutar' : 'Tutar'}</label>
      <div class="amount-field"><input id="r-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amountText)}"><span>${esc(db.settings.currency)}</span></div>
    </div>
    <label class="check"><input type="checkbox" id="r-var" ${f.variable ? 'checked' : ''}><span><b>Tutar her ay değişebilir</b><small>Fatura gibi. Onaylarken o ayki gerçek tutarı girersin.</small></span></label>
    <div class="field"><label>Kategori</label>
      <div class="cat-grid">${cats.map((c) => `<button class="cat-tile ${f.categoryId === c.id ? 'on' : ''}" style="--c:${c.color}" data-action="rf-cat" data-id="${c.id}"><span>${esc(c.icon)}</span><em>${esc(c.name)}</em></button>`).join('')}</div>
    </div>
    <div class="field"><label>Ayın kaçında?</label>
      <select id="r-day" data-change="rf-day">${Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}" ${f.day === n ? 'selected' : ''}>${n >= 31 ? '31 / ayın son günü' : n}</option>`).join('')}</select>
    </div>
    <div class="field"><label>İlk tarih</label>
      <input type="date" id="r-start" value="${f.startDate}">
      ${!editing && thisDue < todayISO() ? `<div class="chips"><button class="chip" data-action="rf-start" data-val="${thisDue}">Bu ayınkini de ekle (${shortDay(thisDue)})</button><button class="chip" data-action="rf-start" data-val="${nextDue(f.day)}">Gelecek aydan başla</button></div>` : ''}
    </div>
    <div class="field"><label>Kaç ay sürecek? <span class="muted">(taksit gibi; boş bırakırsan süresiz)</span></label>
      <input id="r-months" inputmode="numeric" placeholder="Süresiz" value="${esc(f.months)}">
    </div>
    ${editing ? `<label class="check"><input type="checkbox" id="r-paused" ${f.paused ? 'checked' : ''}><span><b>Duraklat</b><small>Bir süreliğine sorma (geçmiş kayıtlar kalır).</small></span></label>` : ''}
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
  const months = parseInt(f.months, 10);
  let endDate = null;
  if (months > 0) {
    const s = fromISO(f.startDate);
    endDate = dueIn(s.getFullYear(), s.getMonth() + months - 1, f.day);
  }
  const now = Date.now();
  const data = { type: f.type, name: f.name.trim() || (catMap()[f.categoryId] || MISSING_CAT).name, amount, categoryId: f.categoryId, day: f.day, startDate: f.startDate, endDate, months: months > 0 ? months : null, variable: !!f.variable, paused: !!f.paused, updatedAt: now };
  let id = f.id;
  if (id) Object.assign(db.recurring.find((r) => r.id === id), data);
  else { id = uid(); db.recurring.push({ id, skipped: [], createdAt: now, ...data }); }
  touch('rec', id);
  save();
  closeSheet();
  render();
  toast('Düzenli kayıt kaydedildi ✓');
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

/* ------------------------------ olaylar ------------------------------ */

Object.assign(actions, {
  'rec-new': () => openRecForm(),
  'rec-manage': () => openRecManage(),
  'rec-tpl': (el) => {
    const t = REC_TEMPLATES[Number(el.dataset.i)];
    const cat = db.categories.find((c) => c.type === t.type && c.name === t.cat);
    const day = t.type === 'income' && t.cat === 'Maaş' ? db.settings.monthStartDay : t.day || fromISO(todayISO()).getDate();
    openRecForm({ type: t.type, name: t.name, categoryId: cat?.id || null, day, variable: !!t.variable });
  },
  'rec-edit': (el) => {
    const r = db.recurring.find((x) => x.id === el.dataset.id);
    if (r) openRecForm({ id: r.id, type: r.type, name: r.name, amountText: amountToInput(r.amount), categoryId: r.categoryId, day: r.day, startDate: r.startDate, months: r.months ? String(r.months) : '', variable: !!r.variable, paused: !!r.paused });
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
  'rf-cat': (el) => {
    syncRecForm();
    recForm.categoryId = el.dataset.id;
    if (!recForm.name) recForm.name = (catMap()[el.dataset.id] || MISSING_CAT).name;
    renderRecForm();
  },
  'rf-start': (el) => { $('#r-start').value = el.dataset.val; },
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
});
