'use strict';

/* =====================================================================
   Özel günler ve hediyeler
   - Doğum günleri, yıldönümleri ve özel günler (Anneler Günü gibi değişken tarihler dahil).
   - Yaklaşınca Özet'te ve sabah bildiriminde hatırlatılır; hediye bütçesi ay sonu tahminine girer.
   - "Hediye aldım" → normal harcama formu açılır (kategori Hediye); kaydedince hediye geçmişine eklenir.
   ===================================================================== */

const EVENT_KINDS = {
  birthday: { label: 'Doğum günü', icon: 'cake' },
  anniversary: { label: 'Yıldönümü', icon: 'heart' },
  special: { label: 'Özel gün', icon: 'gift' },
  other: { label: 'Diğer', icon: 'calendar' },
};
// Tarihi her yıl değişen günler
const EVENT_RULES = {
  mothers: { title: 'Anneler Günü', calc: (y) => nthSunday(y, 4, 2) },
  fathers: { title: 'Babalar Günü', calc: (y) => nthSunday(y, 5, 3) },
};
const EVENT_PRESETS = [
  { title: 'Anneler Günü', rule: 'mothers' },
  { title: 'Babalar Günü', rule: 'fathers' },
  { title: 'Sevgililer Günü', month: 2, day: 14 },
  { title: 'Öğretmenler Günü', month: 11, day: 24 },
  { title: 'Yılbaşı', month: 1, day: 1 },
];
const GIFT_CAT = defCatId('expense', 'Hediye');
let eventForm = null;

function nthSunday(y, m, n) {
  const d = new Date(y, m, 1);
  const first = (7 - d.getDay()) % 7 + 1;
  return toISO(new Date(y, m, first + (n - 1) * 7));
}

function eventDateIn(e, y) {
  if (e.rule && EVENT_RULES[e.rule]) return EVENT_RULES[e.rule].calc(y);
  const last = new Date(y, e.month, 0).getDate(); // 29 Şubat → 28
  return toISO(new Date(y, e.month - 1, Math.min(e.day, last)));
}

function nextEventDate(e) {
  const today = todayISO();
  const y = fromISO(today).getFullYear();
  const d = eventDateIn(e, y);
  return d >= today ? d : eventDateIn(e, y + 1);
}

const eventTitle = (e) => e.title || (e.kind === 'birthday' ? `${e.person} doğum günü` : e.kind === 'anniversary' ? `${e.person} yıldönümü` : e.person || 'Özel gün');
const eventYearNo = (e, date) => (e.year ? fromISO(date).getFullYear() - e.year : null);

function eventLine(e) {
  const date = nextEventDate(e);
  const d = dayDiff(fromISO(todayISO()), fromISO(date));
  const n = eventYearNo(e, date);
  const K = EVENT_KINDS[e.kind] || EVENT_KINDS.other;
  const last = (e.gifts || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return { e, date, d, n, K, last, gotThisYear: (e.gifts || []).some((g) => g.forDate === date) };
}

function eventRow(x) {
  const sub = [fullDay(x.date), x.n ? `${x.n}. ${x.e.kind === 'birthday' ? 'yaş' : 'yıl'}` : '', x.e.budget ? `bütçe ${money(x.e.budget)}` : '', x.last ? `son hediye: ${x.last.item || 'hediye'}` : ''].filter(Boolean);
  return `<button class="tx ev-row" data-action="event-open" data-id="${x.e.id}">
    <span class="ico" style="--c:${col(x.e.color || '#e11d48')}">${icon(x.K.icon, 18)}</span>
    <span class="tx-main"><b>${esc(eventTitle(x.e))}</b><small>${esc(sub.join(' · '))}</small></span>
    <span class="ev-left ${x.d <= 7 ? 'soon' : ''}">${x.d === 0 ? 'Bugün' : x.d === 1 ? 'Yarın' : `${x.d} gün`}${x.gotThisYear ? `<small>${icon('check', 12)} hediye</small>` : ''}</span>
  </button>`;
}

function viewEvents() {
  const back = `<button class="back" data-action="nav" data-view="more">${icon('chevron-left', 18)} Diğer</button>`;
  const head = viewHead('Özel günler', `<button class="btn small" data-action="event-new">+ Ekle</button>`);
  if (!db.events.length) {
    return `${back}${head}<div class="card empty-card"><span class="empty-ico">${icon('cake', 26)}</span><b>Doğum günlerini ve özel günleri ekle</b>
      <p>Yaklaşınca hatırlatayım, hediye bütçeni ay sonu tahminine katayım; kime ne aldığını da unutma.</p>
      <div class="btn-stack"><button class="btn primary" data-action="event-new" data-kind="birthday">${icon('cake', 18)} Doğum günü ekle</button>
      <button class="btn" data-action="event-new" data-kind="anniversary">${icon('heart', 18)} Yıldönümü ekle</button>
      <button class="btn" data-action="event-new" data-kind="special">${icon('gift', 18)} Özel gün ekle</button></div></div>`;
  }
  const list = db.events.map(eventLine).sort((a, b) => a.d - b.d);
  const soon = list.filter((x) => x.d <= 30);
  const rest = list.filter((x) => x.d > 30);
  const budget60 = list.filter((x) => x.d <= 60 && !x.gotThisYear).reduce((s, x) => s + (x.e.budget || 0), 0);
  const yearGifts = db.events.flatMap((e) => (e.gifts || []).filter((g) => g.date >= `${fromISO(todayISO()).getFullYear()}-01-01`));
  return `${back}${head}
    ${budget60 || yearGifts.length ? `<div class="card sum-list">
      ${budget60 ? `<div><span>Önümüzdeki 60 gün hediye bütçesi</span><b>${money(budget60)}</b></div>` : ''}
      ${yearGifts.length ? `<div><span>Bu yıl hediyelere</span><b>${money(yearGifts.reduce((s, g) => s + (g.amount || 0), 0))} · ${yearGifts.length} hediye</b></div>` : ''}
    </div>` : ''}
    ${soon.length ? `<h2 class="sec">Yaklaşanlar</h2><div class="list">${soon.map(eventRow).join('')}</div>` : ''}
    ${rest.length ? `<h2 class="sec">${soon.length ? 'Daha sonra' : 'Tüm günler'}</h2><div class="list">${rest.map(eventRow).join('')}</div>` : ''}`;
}

/* ------------------------------ detay ------------------------------ */

function openEvent(id) {
  const e = db.events.find((x) => x.id === id);
  if (!e) return;
  const x = eventLine(e);
  const gifts = (e.gifts || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  openSheet(`
    <div class="sheet-head"><h2>${esc(eventTitle(e))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="ev-hero"><b>${x.d === 0 ? 'Bugün' : x.d === 1 ? 'Yarın' : `${x.d} gün sonra`}</b><span>${longDate(x.date)}${x.n ? ` · ${x.n}. ${e.kind === 'birthday' ? 'yaşı' : 'yıl'}` : ''}</span>
      ${e.budget ? `<small>Hediye bütçesi ${money(e.budget)}</small>` : ''}</div>
    <div class="row" style="margin:14px 0">
      <button class="btn primary" data-action="gift-add" data-id="${e.id}">${icon('gift', 18)} Hediye aldım</button>
      <button class="btn" data-action="event-edit" data-id="${e.id}">Düzenle</button>
    </div>
    <h3>Hediye geçmişi</h3>
    ${gifts.length ? `<div class="list" style="box-shadow:none">${gifts.map((g) => `<div class="tx"><span class="ico" style="--c:#e11d48">${icon('gift', 18)}</span>
      <span class="tx-main"><b>${esc(g.item || 'Hediye')}</b><small>${fullDay(g.date)}</small></span><span class="amt">${g.amount ? money(g.amount) : ''}</span></div>`).join('')}</div>`
      : '<p class="muted small">Henüz hediye kaydı yok. "Hediye aldım" deyince harcama olarak kaydedilir ve burada listelenir.</p>'}`);
}

/* ------------------------------ form ------------------------------ */

function openEventForm(init = {}) {
  const t = fromISO(todayISO());
  eventForm = { id: null, kind: 'birthday', person: '', title: '', month: t.getMonth() + 1, day: t.getDate(), yearText: '', rule: null, budgetText: '', remind: 7, ...init };
  renderEventForm();
}

function syncEventForm() {
  if (!eventForm || !$('#e-person')) return;
  eventForm.person = $('#e-person').value;
  if ($('#e-title')) eventForm.title = $('#e-title').value;
  if ($('#e-month')) { eventForm.month = Number($('#e-month').value); eventForm.day = Number($('#e-day').value); }
  if ($('#e-year')) eventForm.yearText = $('#e-year').value;
  eventForm.budgetText = $('#e-budget').value;
}

function renderEventForm() {
  const f = eventForm;
  const special = f.kind === 'special' || f.kind === 'other';
  const people = [...new Set(db.events.map((e) => e.person).filter(Boolean))];
  openSheet(`
    <div class="sheet-head"><h2>${f.id ? 'Özel günü düzenle' : 'Yeni özel gün'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="seg field">${Object.entries(EVENT_KINDS).slice(0, 3).map(([k, v]) => `<button data-action="ef-kind" data-val="${k}" class="${f.kind === k ? 'on' : ''}">${v.label}</button>`).join('')}</div>
    ${special && !f.id ? `<div class="chips wrap" style="margin:-4px 0 12px">${EVENT_PRESETS.map((p, i) => `<button class="chip ${f.title === p.title ? 'on' : ''}" data-action="ef-preset" data-i="${i}">${esc(p.title)}</button>`).join('')}</div>` : ''}
    ${special ? `<div class="field"><label>Gün</label><input id="e-title" value="${esc(f.title)}" maxlength="40" placeholder="ör. Anneler Günü"></div>` : ''}
    <div class="field"><label>${special ? 'Kim için? (isteğe bağlı)' : 'Kim?'}</label><input id="e-person" list="e-people" value="${esc(f.person)}" maxlength="40" placeholder="ör. Annem, Ayşe">
      <datalist id="e-people">${people.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></div>
    ${f.rule ? `<p class="muted small">${esc(EVENT_RULES[f.rule].title)} her yıl tarihi kendiliğinden hesaplanır (bu yıl ${fullDay(nextEventDate(f))}).</p>` : `<div class="row field">
      <div><label class="lbl">Gün</label><select id="e-day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}" ${f.day === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
      <div><label class="lbl">Ay</label><select id="e-month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${f.month === i + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
      ${special ? '' : `<div><label class="lbl">${f.kind === 'birthday' ? 'Doğum yılı' : 'Yıl'}</label><input id="e-year" inputmode="numeric" maxlength="4" value="${esc(f.yearText)}" placeholder="İsteğe bağlı"></div>`}
    </div>`}
    <div class="field"><label>Hediye bütçesi</label>
      <div class="amount-field"><input id="e-budget" inputmode="decimal" autocomplete="off" placeholder="İsteğe bağlı" value="${esc(f.budgetText)}"><span>${esc(db.settings.currency)}</span></div>
      <small class="acc-info">Girersen o günün tutarı ay sonu tahmininde ayrılır.</small>
    </div>
    <div class="field"><label>Ne zaman hatırlatayım?</label>
      <div class="seg">${[[1, '1 gün önce'], [3, '3 gün önce'], [7, '1 hafta önce'], [14, '2 hafta önce']].map(([n, l]) => `<button data-action="ef-remind" data-val="${n}" class="${f.remind === n ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="actions">
      ${f.id ? `<button class="btn danger" data-action="ef-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="ef-save">Kaydet</button>
    </div>`);
}

function saveEvent() {
  syncEventForm();
  const f = eventForm;
  const special = f.kind === 'special' || f.kind === 'other';
  if (!special && !f.person.trim()) { $('#e-person').classList.add('invalid'); toast('Kimin olduğunu yaz'); return; }
  if (special && !f.title.trim()) { $('#e-title')?.classList.add('invalid'); toast('Günün adını yaz'); return; }
  const year = parseInt(f.yearText, 10);
  if (f.yearText && !(year > 1900 && year <= fromISO(todayISO()).getFullYear())) { toast('Yılı kontrol et'); return; }
  const budget = f.budgetText.trim() ? parseAmount(f.budgetText) : 0;
  if (!Number.isFinite(budget) || budget < 0) { toast('Bütçeyi kontrol et'); return; }
  const now = Date.now();
  const data = { kind: f.kind, person: f.person.trim(), title: special ? f.title.trim() : '', month: f.month, day: f.day, year: year || null, rule: f.rule || null, budget, remind: f.remind, updatedAt: now };
  let id = f.id;
  const cur = id && db.events.find((x) => x.id === id);
  if (cur) Object.assign(cur, data);
  else { id = uid(); db.events.push({ id, gifts: [], createdAt: now, ...data }); }
  touch('event', id);
  save();
  closeSheet();
  if (ui.view !== 'events') goTo('events'); else render();
  const n = eventLine(db.events.find((x) => x.id === id));
  toast(`Kaydedildi · ${n.d === 0 ? 'bugün' : `${n.d} gün sonra`}`);
}

function deleteEvent() {
  const x = db.events.find((v) => v.id === eventForm.id);
  if (!x || !confirm(`"${eventTitle(x)}" silinsin mi? Hediye harcamaları silinmez.`)) return;
  db.events = db.events.filter((v) => v.id !== x.id);
  db.deleted.push({ id: x.id, kind: 'event', at: Date.now(), data: x });
  touch('event', x.id);
  save();
  closeSheet();
  render();
  toast('Silindi');
}

/* ------------------------------ hediye ------------------------------ */

function addGift(id) {
  const e = db.events.find((x) => x.id === id);
  if (!e) return;
  const date = nextEventDate(e);
  closeSheet();
  setTimeout(() => openTxForm({ type: 'expense', categoryId: catMap()[GIFT_CAT] ? GIFT_CAT : null, amountText: e.budget ? amountToInput(e.budget) : '', note: `${e.person || eventTitle(e)} · hediye`, giftFor: { id, date } }), 80);
}

// İşlem kaydedilince hediye geçmişine bağla
TX_HOOKS.push((txId, f, data) => {
  if (!f?.giftFor) return;
  const e = db.events.find((x) => x.id === f.giftFor.id);
  if (!e) return;
  const item = (data.note || '').replace(/^.*·\s*hediye:?\s*/i, '').trim();
  e.gifts = [...(e.gifts || []), { id: uid(), txId, item: item && item.toLocaleLowerCase('tr') !== 'hediye' ? item : '', amount: data.amount, date: data.date, forDate: f.giftFor.date }];
  e.updatedAt = Date.now();
  touch('event', e.id);
  if (e.budget && data.amount > e.budget) setTimeout(() => toast(`Hediye bütçeyi ${money(data.amount - e.budget)} aştı`), 1600);
});

// Özet'te yaklaşan günler
function eventTodos() {
  return db.events.map(eventLine).filter((x) => x.d <= (x.e.remind || 7) && x.e.ackFor !== x.date && !x.gotThisYear).sort((a, b) => a.d - b.d).map((x) => `<div class="todo wrap">
    <span class="todo-ico ${x.d <= 1 ? 'late' : 'soon'}">${icon(x.K.icon, 18)}</span>
    <span class="todo-main"><b>${esc(eventTitle(x.e))} ${x.d === 0 ? 'bugün' : x.d === 1 ? 'yarın' : `${x.d} gün sonra`}</b><small>${fullDay(x.date)}${x.n ? ` · ${x.n}. ${x.e.kind === 'birthday' ? 'yaş' : 'yıl'}` : ''}${x.e.budget ? ` · bütçe ${money(x.e.budget)}` : ''}${x.last ? ` · geçen sefer: ${esc(x.last.item || money(x.last.amount))}` : ''}</small></span>
    <span class="todo-btns"><button class="btn small" data-action="gift-add" data-id="${x.e.id}">Hediye aldım</button><button class="btn small ok" data-action="event-ack" data-id="${x.e.id}">Tamam</button></span>
  </div>`);
}

// Ay sonu tahmini için: bu dönemdeki hediye bütçeleri
function eventForecast(perEnd) {
  return db.events.map(eventLine).filter((x) => x.e.budget && x.date <= perEnd && !x.gotThisYear).map((x) => ({ date: x.date, amount: x.e.budget, title: `${eventTitle(x.e)} hediyesi` }));
}

Object.assign(actions, {
  'event-new': (el) => openEventForm({ kind: el.dataset.kind || 'birthday' }),
  'event-open': (el) => openEvent(el.dataset.id),
  'event-edit': (el) => {
    const e = db.events.find((x) => x.id === el.dataset.id);
    if (e) openEventForm({ ...e, yearText: e.year ? String(e.year) : '', budgetText: e.budget ? amountToInput(e.budget) : '', remind: e.remind || 7 });
  },
  'event-ack': (el) => {
    const e = db.events.find((x) => x.id === el.dataset.id);
    if (!e) return;
    e.ackFor = nextEventDate(e); e.updatedAt = Date.now(); touch('event', e.id); save(); render();
  },
  'gift-add': (el) => addGift(el.dataset.id),
  'ef-kind': (el) => { syncEventForm(); eventForm.kind = el.dataset.val; if (eventForm.kind !== 'special') { eventForm.rule = null; } renderEventForm(); },
  'ef-preset': (el) => {
    syncEventForm();
    const p = EVENT_PRESETS[Number(el.dataset.i)];
    Object.assign(eventForm, { title: p.title, rule: p.rule || null, month: p.month || eventForm.month, day: p.day || eventForm.day });
    renderEventForm();
  },
  'ef-remind': (el) => { syncEventForm(); eventForm.remind = Number(el.dataset.val); $$('[data-action="ef-remind"]').forEach((b) => b.classList.toggle('on', b === el)); },
  'ef-save': () => saveEvent(),
  'ef-delete': () => deleteEvent(),
});

VIEWS.events = viewEvents;
SUB_PAGES.push('events');
