'use strict';

/* =====================================================================
   Bütçem — gelir/gider takibi (1. etap: cihazda yerel kayıt)
   Tutarlar kuruş cinsinden tam sayı olarak saklanır (kayan nokta hatası olmasın).
   Tarihler 'YYYY-MM-DD' metni olarak saklanır.
   ===================================================================== */

const STORE_KEY = 'butce.data.v1';
const UI_KEY = 'butce.ui.v1';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const DAYS_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

// Eski sürümlerde kaydedilen renkler yeni palete eşlenir (col)
const OLD_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#a16207', '#78716c', '#64748b',
];

const PALETTE = [
  '#E5484D', '#E8663C', '#D9922E', '#B7A13A', '#7FA33A', '#30A46C', '#12A594', '#0E8F86', '#0B8EA8', '#3E8EDE',
  '#3E63DD', '#5B5BD6', '#6E56CF', '#8E4EC6', '#AB4ABA', '#D6409F', '#E54666', '#A1775B', '#7C7C74', '#5F6B7A',
];
const col = (c) => { const i = OLD_PALETTE.indexOf(c); return i >= 0 ? PALETTE[i] : c || '#5F6B7A'; };

const EMOJIS = [
  '🛒', '🍽️', '☕', '🍔', '🍕', '🥗', '🥖', '🍰', '🍺', '🚌', '🚇', '⛽', '🚕', '🚗', '🏍️', '🚲', '✈️', '🏨', '🏠', '🏢',
  '💡', '🚿', '🔥', '🌐', '📱', '📺', '🎵', '👕', '👟', '👜', '💇', '💄', '🏥', '💊', '🦷', '👓', '🏋️', '⚽', '📚', '📖',
  '✏️', '🎓', '🎉', '🎬', '🎮', '🎨', '🎁', '🤲', '🐾', '🧸', '👶', '🛋️', '🧹', '💻', '🔧', '🛡️', '🧾', '💳', '🏦', '🚬',
  '💼', '🧑‍💻', '👛', '🏆', '🏘️', '📈', '🏷️', '🔄', '💰', '💵', '🪙', '➕', '📦', '❤️', '⭐', '🕌', '🎂', '💍', '🌱', '🧳',
];

const DEFAULT_CATEGORIES = {
  expense: [
    ['Market', '🛒'], ['Restoran', '🍽️'], ['Kafe / Kahve', '☕'], ['Fast food', '🍔'], ['Fırın / Atıştırmalık', '🥖'],
    ['Toplu taşıma', '🚌'], ['Akaryakıt', '⛽'], ['Taksi', '🚕'], ['Araba bakım', '🚗'],
    ['Kira', '🏠'], ['Aidat', '🏢'], ['Elektrik', '💡'], ['Su', '🚿'], ['Doğalgaz', '🔥'], ['İnternet', '🌐'], ['Telefon faturası', '📱'],
    ['Abonelikler', '📺'], ['Giyim', '👕'], ['Ayakkabı', '👟'], ['Kişisel bakım', '💇'], ['Kozmetik', '💄'],
    ['Sağlık', '🏥'], ['İlaç', '💊'], ['Spor', '🏋️'], ['Eğitim / Kurs', '🎓'], ['Kitap', '📖'], ['Kırtasiye', '✏️'],
    ['Eğlence', '🎉'], ['Sinema / Konser', '🎬'], ['Oyun', '🎮'], ['Hobi', '🎨'], ['Seyahat', '✈️'], ['Konaklama', '🏨'],
    ['Hediye', '🎁'], ['Bağış', '🤲'], ['Evcil hayvan', '🐾'], ['Ev eşyası', '🛋️'], ['Temizlik', '🧹'], ['Elektronik', '💻'],
    ['Tamir / Bakım', '🔧'], ['Sigorta', '🛡️'], ['Vergi / Harç', '🧾'], ['Kredi kartı ödemesi', '💳'], ['Kredi / Borç', '🏦'], ['Banka masrafı', '🏧'],
    ['Sigara', '🚬'], ['Çocuk', '🧸'], ['Diğer', '📦'],
  ],
  income: [
    ['Maaş', '💼'], ['Ek iş / Freelance', '🧑‍💻'], ['Burs', '🎓'], ['Harçlık', '👛'], ['Prim / İkramiye', '🏆'],
    ['Kira geliri', '🏘️'], ['Yatırım geliri', '📈'], ['Faiz', '🏦'], ['Satış', '🏷️'], ['Hediye', '🎁'], ['İade', '🔄'], ['Diğer gelir', '➕'],
  ],
};

/* ------------------------------ veri ------------------------------ */

// Varsayılan kategoriler her cihazda aynı kimliği alır; senkronda ikiye katlanmasınlar.
function defCatId(type, name) {
  const tr = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
  const slug = name.toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => tr[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `d-${type === 'income' ? 'i' : 'e'}-${slug}`;
}

function freshData() {
  const now = Date.now();
  const cats = [];
  for (const type of ['expense', 'income']) {
    DEFAULT_CATEGORIES[type].forEach(([name, icon], i) => {
      // Zaman 0: hiç dokunulmamış varsayılan kategori, herhangi bir cihazdaki düzenlemeye yenilir.
      cats.push({ id: defCatId(type, name), type, name, icon, color: PALETTE[(i * 7 + (type === 'income' ? 5 : 0)) % PALETTE.length], createdAt: 0, updatedAt: 0 });
    });
  }
  return {
    version: 1,
    settings: { currency: '₺', monthStartDay: 1, weekStartDay: 1, theme: 'auto' },
    categories: cats,
    transactions: [],
    debts: [], // borç/alacak: [{ id, dir: 'borrowed' | 'lent', person, amount, date, dueDate, accountId, note, closed }]
    accounts: [], // kartlar ve hesaplar: [{ id, kind: 'credit' | 'bank' | 'cash', name, bank, limit, opening, statementDay, dueDay, minPct }]
    recurring: [], // düzenli gelir/gider tanımları: [{ id, type, name, amount, categoryId, day, startDate, endDate, variable, paused, skipped: [] }]
    budgets: [], // aylık limitler: [{ id, scope: 'total' | 'cat', categoryId, amount, alertAt, rollover }]
    deleted: [], // silinen kayıtların izi: [{ id, kind: 'tx' | 'cat' | 'bud', at, data }]
    pending: {}, // buluta gönderilmeyi bekleyen değişiklikler: { 'tx:<id>': zaman }
    sync: null, // { uid, lastSrv }
  };
}

function normalize(d) {
  const base = freshData();
  if (!d || typeof d !== 'object') return base;
  const out = {
    version: 1,
    settings: { ...base.settings, ...(d.settings || {}) },
    categories: Array.isArray(d.categories) ? d.categories : base.categories,
    transactions: (Array.isArray(d.transactions) ? d.transactions : []).map((t) => (t.awaiting === undefined && t.date > todayISO() && !t.recId ? { ...t, awaiting: true } : t)),
    deleted: (Array.isArray(d.deleted) ? d.deleted : []).map((x) => ({ kind: 'tx', ...x })),
    recurring: Array.isArray(d.recurring) ? d.recurring : [],
    accounts: Array.isArray(d.accounts) ? d.accounts : [],
    debts: Array.isArray(d.debts) ? d.debts : [],
    budgets: Array.isArray(d.budgets) ? d.budgets : [],
    pending: d.pending && typeof d.pending === 'object' ? d.pending : {},
    sync: d.sync || null,
  };
  // Eski sürümde varsayılan kategoriler rastgele kimlik almıştı: ortak kimliğe taşı.
  const ids = new Set(out.categories.map((c) => c.id));
  const remap = {};
  for (const c of out.categories) {
    const def = DEFAULT_CATEGORIES[c.type]?.some(([n]) => n === c.name) ? defCatId(c.type, c.name) : null;
    if (def && c.id !== def && !ids.has(def)) { remap[c.id] = def; ids.add(def); c.id = def; }
  }
  if (Object.keys(remap).length) for (const t of out.transactions) if (remap[t.categoryId]) t.categoryId = remap[t.categoryId];
  for (const c of out.categories) if (c.id.startsWith('d-') && c.updatedAt === c.createdAt) c.createdAt = c.updatedAt = 0;
  return out;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { console.error(e); }
  return freshData();
}

let db = loadData();

function saveLocal() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); }
  catch (e) { toast('Kaydedilemedi! Depolama dolu olabilir.'); console.error(e); }
}
function save() {
  saveLocal();
  schedulePush();
}
// Bir kaydın değiştiğini işaretler; senkron açıksa buluta gönderilir.
function touch(kind, id) { db.pending[`${kind}:${id}`] = Date.now(); }
function setSetting(key, value) {
  db.settings[key] = value;
  db.settings.updatedAt = Date.now();
  touch('set', 'main');
  save();
}
// Yedekten geri yükleme: hiçbir şeyi silmez. Yedekte olup burada olmayan (ya da burada silinmiş)
// kayıtları geri ekler; burada zaten olanlara dokunmaz. Kaç kayıt eklendiğini döndürür.
function mergeBackup(backup) {
  const now = Date.now();
  let added = 0;
  for (const [kind, list, arr] of [['cat', backup.categories, db.categories], ['tx', backup.transactions, db.transactions], ['bud', backup.budgets, db.budgets], ['rec', backup.recurring, db.recurring], ['acc', backup.accounts, db.accounts], ['debt', backup.debts, db.debts]]) {
    const have = new Set(arr.map((x) => x.id));
    for (const item of list) {
      if (!item || !item.id || have.has(item.id)) continue;
      arr.push({ ...item, updatedAt: now });
      db.deleted = db.deleted.filter((d) => d.id !== item.id);
      touch(kind, item.id);
      added++;
    }
  }
  save();
  return added;
}

/* --------------------------- arayüz durumu --------------------------- */

const ui = {
  view: 'home',
  period: { mode: 'month', anchor: todayISO(), from: todayISO(), to: todayISO() },
  homeDonut: 'expense',
  reportCat: 'expense',
  txFilter: { q: '', type: 'all', cat: '', acc: '' },
  catTab: 'expense',
};
try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  if (saved.view) ui.view = saved.view;
  if (saved.period) Object.assign(ui.period, saved.period, { anchor: todayISO() });
} catch {}
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, period: { mode: ui.period.mode, from: ui.period.from, to: ui.period.to } })); } catch {}
}

/* ---------------------------- biçimlendirme ---------------------------- */

const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
const money = (k) => `${nf.format(k / 100)} ${db.settings.currency}`;
const num = (k) => nf.format(k / 100);
// Tutarlar her yerde kuruşuyla tam gösterilir (yuvarlama yok)
const moneyRound = (k) => money(k);
const signed = (k, type) => `${type === 'income' ? '+' : '−'}${money(k)}`;
// Grafik eksenleri için kısa yazım: 12,5 bin / 1,2 Mn
function compact(k) {
  const v = k / 100, a = Math.abs(v);
  if (a >= 1e6) return `${nf1.format(v / 1e6)} Mn`;
  if (a >= 1e3) return `${nf1.format(v / 1e3)} bin`;
  return nf0.format(v);
}

function parseAmount(str) {
  let s = String(str ?? '').replace(/\s|₺|tl/gi, '');
  if (!s) return NaN;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    const dec = lc > ld ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lc >= 0) {
    if ((s.match(/,/g) || []).length > 1) return NaN;
    s = s.replace(',', '.');
  } else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, ''); // 1.250 → bin iki yüz elli
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return NaN;
  return Math.round(parseFloat(s) * 100);
}
const amountToInput = (k) => (k / 100).toFixed(2).replace(/\.00$/, '').replace('.', ',');

/* ------------------------------- tarih ------------------------------- */

function pad(n) { return String(n).padStart(2, '0'); }
function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fromISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayISO() { return toISO(new Date()); }
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayDiff = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);

function rangeLabel(a, b) {
  if (toISO(a) === toISO(b)) return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()}`;
  if (a.getFullYear() === b.getFullYear()) {
    const left = a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]}`;
    return `${left} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}
const longDate = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${DAYS[d.getDay()]}`; };

/* Seçili dönemin başlangıç/bitiş tarihlerini hesaplar.
   Ay modunda "ay başlangıç günü" ayarı kullanılır: 9 ise 9 Eki – 8 Kas gibi. */
function getPeriod(p = ui.period) {
  const s = db.settings;
  let start, end, label;
  const a = fromISO(p.anchor);
  switch (p.mode) {
    case 'week': {
      start = addDays(a, -((a.getDay() - s.weekStartDay + 7) % 7));
      end = addDays(start, 6);
      label = rangeLabel(start, end);
      break;
    }
    case 'month': {
      const S = s.monthStartDay;
      let m = a.getMonth();
      if (a.getDate() < S) m -= 1;
      start = new Date(a.getFullYear(), m, S);
      end = addDays(new Date(start.getFullYear(), start.getMonth() + 1, S), -1);
      label = S === 1 ? `${MONTHS[start.getMonth()]} ${start.getFullYear()}` : rangeLabel(start, end);
      break;
    }
    case 'year': {
      start = new Date(a.getFullYear(), 0, 1);
      end = new Date(a.getFullYear(), 11, 31);
      label = String(a.getFullYear());
      break;
    }
    case 'custom': {
      start = fromISO(p.from); end = fromISO(p.to);
      if (end < start) [start, end] = [end, start];
      label = rangeLabel(start, end);
      break;
    }
    default: { // all
      const dates = db.transactions.map((t) => t.date).sort();
      start = fromISO(dates[0] || todayISO());
      end = fromISO(dates[dates.length - 1] || todayISO());
      label = 'Tüm zamanlar';
    }
  }
  return { mode: p.mode, start: toISO(start), end: toISO(end), label, days: dayDiff(start, end) + 1 };
}

function shiftedPeriod(dir, p = ui.period) {
  const per = getPeriod(p);
  const st = fromISO(per.start);
  switch (p.mode) {
    case 'week': return { ...p, anchor: toISO(addDays(st, 7 * dir)) };
    case 'month': return { ...p, anchor: toISO(new Date(st.getFullYear(), st.getMonth() + dir, st.getDate())) };
    case 'year': return { ...p, anchor: toISO(new Date(st.getFullYear() + dir, 0, 1)) };
    case 'custom': return { ...p, from: toISO(addDays(st, per.days * dir)), to: toISO(addDays(fromISO(per.end), per.days * dir)) };
    default: return null;
  }
}

/* ------------------------------ hesaplar ------------------------------ */

const catMap = () => Object.fromEntries(db.categories.map((c) => [c.id, c]));
const MISSING_CAT = { name: 'Kategorisiz', icon: 'lc:circle-help', color: '#5F6B7A' };

// İleri tarihli kayıt: tarihi gelene kadar bakiyeye, toplamlara ve bütçeye girmez
// Onay bekleyen kayıt: ileri tarihle eklenmiş ve henüz "geldi/ödendi" denmemiş.
// Tarihi gelse bile sen onaylayana kadar bakiyeye, toplamlara ve bütçeye girmez.
const isPlanned = (t) => !!t.awaiting || t.date > todayISO();
const awaitingDue = () => db.transactions.filter((t) => t.awaiting && !t.feeOf && t.date <= todayISO()).sort((a, b) => (a.date < b.date ? -1 : 1));

function txIn(per) {
  return db.transactions.filter((t) => t.date >= per.start && t.date <= per.end);
}
function totals(list) {
  let inc = 0, exp = 0;
  for (const t of list) {
    if (isPlanned(t)) continue;
    if (t.type === 'income') inc += t.amount;
    else if (t.type === 'expense') exp += t.amount;
  }
  return { inc, exp, net: inc - exp };
}
function byCategory(list, type) {
  const map = {};
  for (const t of list) {
    if (t.type !== type || isPlanned(t)) continue;
    (map[t.categoryId] ||= { id: t.categoryId, sum: 0, count: 0 });
    map[t.categoryId].sum += t.amount;
    map[t.categoryId].count++;
  }
  const cm = catMap();
  return Object.values(map)
    .map((r) => ({ ...r, cat: cm[r.id] || MISSING_CAT }))
    .sort((a, b) => b.sum - a.sum);
}
function usageCounts() {
  const m = {};
  for (const t of db.transactions) m[t.categoryId] = (m[t.categoryId] || 0) + 1;
  return m;
}
const sortTx = (list) => [...list].sort((a, b) => (b.date === a.date ? (b.createdAt || 0) - (a.createdAt || 0) : b.date < a.date ? -1 : 1));

/* Rapor grafiği için dönemi parçalara böler (gün / ay / yıl). */
function buckets(per) {
  const start = fromISO(per.start), end = fromISO(per.end);
  const unit = per.mode === 'year' ? 'month' : per.days <= 62 ? 'day' : per.days <= 800 ? 'month' : 'year';
  const list = [];
  if (unit === 'day') {
    for (let d = start; d <= end; d = addDays(d, 1)) {
      list.push({ key: toISO(d), label: per.days <= 7 ? DAYS_SHORT[d.getDay()] : String(d.getDate()), long: longDate(toISO(d)), inc: 0, exp: 0 });
    }
  } else if (unit === 'month') {
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      list.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: MONTHS_SHORT[d.getMonth()], long: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, inc: 0, exp: 0 });
    }
  } else {
    for (let y = start.getFullYear(); y <= end.getFullYear(); y++) list.push({ key: String(y), label: String(y), long: String(y), inc: 0, exp: 0 });
  }
  const keyLen = unit === 'day' ? 10 : unit === 'month' ? 7 : 4;
  const idx = Object.fromEntries(list.map((b, i) => [b.key, i]));
  for (const t of txIn(per)) {
    if (isPlanned(t)) continue;
    const b = list[idx[t.date.slice(0, keyLen)]];
    if (b && t.type === 'income') b.inc += t.amount;
    else if (b && t.type === 'expense') b.exp += t.amount;
  }
  return { unit, list };
}

/* ------------------------------ grafikler ------------------------------ */

function donut(items, total) {
  const R = 60, C = 2 * Math.PI * R;
  let off = 0;
  const gap = items.length > 1 ? 2 : 0;
  const segs = items.map((it) => {
    const len = (it.value / total) * C;
    const seg = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${it.color}" stroke-width="24"
      stroke-dasharray="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"/>`;
    off += len;
    return seg;
  }).join('');
  return `<svg viewBox="0 0 160 160" aria-hidden="true">
    <circle r="${R}" cx="80" cy="80" fill="none" stroke="var(--surface-2)" stroke-width="24"/>${segs}
    <text x="80" y="76" text-anchor="middle" font-size="11" fill="var(--muted)">Toplam</text>
    <text x="80" y="95" text-anchor="middle" font-size="${moneyRound(total).length > 11 ? 13 : 16}" font-weight="700" fill="var(--text)">${esc(moneyRound(total))}</text>
  </svg>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function barChart(list) {
  const W = 600, H = 250, padL = 58, padR = 6, padT = 12, padB = 30;
  const max = niceMax(Math.max(...list.map((b) => Math.max(b.inc, b.exp)), 0));
  const pw = W - padL - padR, ph = H - padT - padB;
  const bw = pw / list.length;
  const step = Math.ceil(list.length / 10);
  let s = '';
  for (const k of [0, 0.5, 1]) {
    const y = padT + ph - ph * k;
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    s += `<text class="axis" x="${padL - 8}" y="${y + 5}" text-anchor="end">${esc(compact(max * k))}</text>`;
  }
  list.forEach((b, i) => {
    const x = padL + i * bw;
    const w = Math.max(bw * 0.36, 1);
    const hi = (b.inc / max) * ph, he = (b.exp / max) * ph;
    if (hi > 0) s += `<rect class="b-inc" x="${x + bw * 0.12}" y="${padT + ph - hi}" width="${w}" height="${hi}" rx="2"><title>${esc(b.long)} gelir: ${esc(money(b.inc))}</title></rect>`;
    if (he > 0) s += `<rect class="b-exp" x="${x + bw * 0.52}" y="${padT + ph - he}" width="${w}" height="${he}" rx="2"><title>${esc(b.long)} gider: ${esc(money(b.exp))}</title></rect>`;
    if (i % step === 0) s += `<text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gelir gider grafiği">${s}</svg>
    <div class="chart-legend"><span><i style="background:var(--inc)"></i>Gelir</span><span><i style="background:var(--exp)"></i>Gider</span></div></div>`;
}

/* ------------------------------ parçalar ------------------------------ */

function periodBar() {
  const p = ui.period;
  const per = getPeriod();
  const modes = [['week', 'Hafta'], ['month', 'Ay'], ['year', 'Yıl'], ['custom', 'Özel'], ['all', 'Tümü']];
  return `<div class="period">
    <div class="seg">${modes.map(([m, l]) => `<button data-action="period-mode" data-val="${m}" class="${p.mode === m ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${p.mode === 'custom'
      ? `<div class="period-custom">
          <input type="date" data-change="period-from" value="${per.start}" aria-label="Başlangıç">
          <span class="muted">→</span>
          <input type="date" data-change="period-to" value="${per.end}" aria-label="Bitiş">
        </div>`
      : ''}
    <div class="period-nav">
      <button class="arrow" data-action="period-shift" data-dir="-1" ${p.mode === 'all' ? 'disabled' : ''} aria-label="Önceki">${icon('chevron-left', 20)}</button>
      <button class="label" data-action="period-today" title="Bugüne dön">${esc(per.label)}</button>
      <button class="arrow" data-action="period-shift" data-dir="1" ${p.mode === 'all' ? 'disabled' : ''} aria-label="Sonraki">${icon('chevron-right', 20)}</button>
    </div>
  </div>`;
}

function txRow(t, cm, showDate = false) {
  if (t.type === 'debt') {
    const acc = accById(t.accountId);
    const planned = isPlanned(t);
    const sub = [planned ? (t.date > todayISO() ? 'Planlı' : 'Onay bekliyor') : '', acc ? acc.name : 'hesaba yansımadı', showDate ? `${fromISO(t.date).getDate()} ${MONTHS_SHORT[fromISO(t.date).getMonth()]}` : '', t.note && t.role === 'repay' ? t.note : ''].filter(Boolean).join(' · ');
    return `<button class="tx${planned ? ' planned' : ''}" data-action="edit-tx" data-id="${t.id}">
      <span class="ico" style="--c:#5F6B7A">${icon('hand-coins', 19)}</span>
      <span class="tx-main"><b>${esc(debtTxTitle(t))}</b><small>${esc(sub)}</small></span>
      <span class="amt ${t.flow === 'in' ? 'inc' : 'exp'}">${t.flow === 'in' ? '+' : '−'}${money(t.amount)}</span>
    </button>`;
  }
  if (t.type === 'transfer') {
    const from = accById(t.fromId), to = accById(t.toId);
    const title = to?.kind === 'credit' ? `${to.name} ödemesi` : 'Transfer';
    const sub = [showDate ? `${fromISO(t.date).getDate()} ${MONTHS_SHORT[fromISO(t.date).getMonth()]}` : '', `${from ? from.name : 'Hesap dışı'} → ${to ? to.name : '?'}`, t.note].filter(Boolean).join(' · ');
    return `<button class="tx" data-action="edit-tx" data-id="${t.id}">
      <span class="ico" style="--c:#5F6B7A">${icon('arrow-left-right', 18)}</span>
      <span class="tx-main"><b>${esc(title)}</b><small>${esc(sub)}</small></span>
      <span class="amt muted">${money(t.amount)}</span>
    </button>`;
  }
  const c = cm[t.categoryId] || MISSING_CAT;
  const acc = t.accountId ? accById(t.accountId) : null;
  const planned = isPlanned(t);
  const sub = [planned ? (t.date > todayISO() ? 'Planlı' : 'Onay bekliyor') : '', acc ? acc.name : '', t.recId ? 'düzenli' : '', showDate ? `${fromISO(t.date).getDate()} ${MONTHS_SHORT[fromISO(t.date).getMonth()]}` : '', t.note].filter(Boolean).join(' · ');
  return `<button class="tx${planned ? ' planned' : ''}" data-action="edit-tx" data-id="${t.id}">
    <span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span>
    <span class="tx-main"><b>${esc(c.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
    <span class="amt ${t.type === 'income' ? 'inc' : 'exp'}">${signed(t.amount, t.type)}</span>
  </button>`;
}

function viewHead(title, right = '') {
  return `<div class="vhead"><h1>${title}</h1><div class="vhead-r">${right}</div></div>`;
}

function emptyState(text) {
  return `<div class="empty">${text}</div>`;
}

/* ------------------------------- ekranlar ------------------------------- */

function viewTx() {
  const per = getPeriod();
  const f = ui.txFilter;
  const cm = catMap();
  const q = f.q.trim().toLocaleLowerCase('tr');
  const list = sortTx(txIn(per).filter((t) => {
    if (f.type !== 'all' && t.type !== f.type) return false;
    if (f.cat && t.categoryId !== f.cat) return false;
    if (f.acc && t.accountId !== f.acc && t.fromId !== f.acc && t.toId !== f.acc) return false;
    if (q) {
      const c = cm[t.categoryId] || MISSING_CAT;
      const hay = `${c.name} ${t.note || ''} ${amountToInput(t.amount)}`.toLocaleLowerCase('tr');
      if (!hay.includes(q)) return false;
    }
    return true;
  }));
  const t = totals(list);

  const groups = [];
  for (const x of list) {
    if (!groups.length || groups[groups.length - 1].date !== x.date) groups.push({ date: x.date, items: [] });
    groups[groups.length - 1].items.push(x);
  }
  const catOpts = (type, label) => `<optgroup label="${label}">${db.categories.filter((c) => c.type === type).sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map((c) => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;

  return `
    ${viewHead('İşlemler')}
    ${periodBar()}
    <div class="filters">
      <input type="search" placeholder="Ara: kategori, not, tutar" value="${esc(f.q)}" data-input="tx-q">
      <div class="row">
        <div class="seg" style="flex:1.2">
          ${[['all', 'Tümü'], ['expense', 'Gider'], ['income', 'Gelir']].map(([v, l]) => `<button data-action="tx-type" data-val="${v}" class="${f.type === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <select data-change="tx-cat" aria-label="Kategori filtresi">
          <option value="">Tüm kategoriler</option>
          ${catOpts('expense', 'Gider')}${catOpts('income', 'Gelir')}
        </select>
      </div>
      ${db.accounts.length ? `<select data-change="tx-acc" aria-label="Kart / hesap filtresi">
        <option value="">Tüm kartlar ve hesaplar</option>
        ${db.accounts.map((a) => `<option value="${a.id}" ${f.acc === a.id ? 'selected' : ''}>${esc(accLabel(a))}</option>`).join('')}
      </select>` : ''}
    </div>
    <div class="mini-stats" style="margin:4px 4px 0">
      <span>${list.length} işlem</span>
      <span>Gelir <b class="inc">${money(t.inc)}</b></span>
      <span>Gider <b class="exp">${money(t.exp)}</b></span>
    </div>
    ${groups.length
      ? groups.map((g) => {
          const gt = totals(g.items);
          return `<div class="day-head"><span>${longDate(g.date)}</span><span class="${gt.net >= 0 ? 'inc' : 'exp'}">${gt.net >= 0 ? '+' : '−'}${money(Math.abs(gt.net))}</span></div>
            <div class="list">${g.items.map((x) => txRow(x, cm)).join('')}</div>`;
        }).join('')
      : `<div class="card" style="margin-top:14px">${emptyState('Bu filtrelere uyan işlem yok.')}</div>`}
  `;
}

function viewReport() {
  const per = getPeriod();
  const list = txIn(per);
  const t = totals(list);
  const { unit, list: bks } = buckets(per);
  const unitName = { day: 'Gün', month: 'Ay', year: 'Yıl' }[unit];
  const active = bks.filter((b) => b.inc || b.exp);
  const rows = byCategory(list, ui.reportCat);
  const catTotal = ui.reportCat === 'income' ? t.inc : t.exp;

  return `
    ${viewHead('Rapor')}
    ${periodBar()}
    <div class="stats">
      <div class="stat"><small>Gelir</small><b class="inc">${money(t.inc)}</b></div>
      <div class="stat"><small>Gider</small><b class="exp">${money(t.exp)}</b></div>
      <div class="stat"><small>Kalan</small><b class="${t.net >= 0 ? 'inc' : 'exp'}">${money(t.net)}</b></div>
    </div>
    <div class="card">
      <h3>${unitName} bazında gelir & gider</h3>
      ${list.length ? barChart(bks) : emptyState('Bu dönemde işlem yok.')}
    </div>
    ${active.length ? `<div class="card">
      <h3>${unitName} bazında tablo</h3>
      <div class="table-scroll"><table>
        <thead><tr><th>${unitName}</th><th>Gelir</th><th>Gider</th><th>Fark (${esc(db.settings.currency)})</th></tr></thead>
        <tbody>${active.map((b) => `<tr><td>${esc(unit === 'day' ? `${fromISO(b.key).getDate()} ${MONTHS_SHORT[fromISO(b.key).getMonth()]}` : b.long)}</td>
          <td class="inc">${num(b.inc)}</td><td class="exp">${num(b.exp)}</td><td class="${b.inc - b.exp >= 0 ? 'inc' : 'exp'}">${num(b.inc - b.exp)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>Toplam</td><td class="inc">${num(t.inc)}</td><td class="exp">${num(t.exp)}</td><td class="${t.net >= 0 ? 'inc' : 'exp'}">${num(t.net)}</td></tr></tfoot>
      </table></div>
    </div>` : ''}
    <div class="card">
      <div class="between" style="margin-bottom:6px">
        <h3 style="margin:0">Kategorilere göre</h3>
        <div class="seg" style="width:150px">
          <button data-action="report-cat" data-val="expense" class="${ui.reportCat === 'expense' ? 'on' : ''}">Gider</button>
          <button data-action="report-cat" data-val="income" class="${ui.reportCat === 'income' ? 'on' : ''}">Gelir</button>
        </div>
      </div>
      ${rows.length
        ? rows.map((r) => {
            const pct = (r.sum / catTotal) * 100;
            return `<button class="cat-row" data-action="filter-cat" data-id="${r.id}">
              <span class="ico" style="--c:${col(r.cat.color)}">${glyph(r.cat.icon)}</span>
              <span style="flex:1;min-width:0"><b>${esc(r.cat.name)}</b>
                <div class="bar" style="--c:${col(r.cat.color)}"><i style="width:${pct.toFixed(1)}%"></i></div></span>
              <span class="right"><b>${money(r.sum)}</b><small>%${pct.toFixed(1).replace('.', ',')} · ${r.count} işlem</small></span>
            </button>`;
          }).join('')
        : emptyState('Bu dönemde kayıt yok.')}
    </div>
  `;
}

function viewCats() {
  const usage = usageCounts();
  const sums = {};
  for (const t of db.transactions) sums[t.categoryId] = (sums[t.categoryId] || 0) + t.amount;
  const cats = db.categories.filter((c) => c.type === ui.catTab)
    .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  return `
    <button class="back" data-action="nav" data-view="settings">${icon('chevron-left', 18)} Ayarlar</button>
    ${viewHead('Kategoriler')}
    <div class="seg type" style="margin-bottom:14px">
      <button data-action="cat-tab" data-val="expense" class="${ui.catTab === 'expense' ? 'on' : ''}">Gider (${db.categories.filter((c) => c.type === 'expense').length})</button>
      <button data-action="cat-tab" data-val="income" class="${ui.catTab === 'income' ? 'on' : ''}">Gelir (${db.categories.filter((c) => c.type === 'income').length})</button>
    </div>
    <button class="btn primary block" data-action="new-cat" style="margin-bottom:14px">+ Yeni ${ui.catTab === 'income' ? 'gelir' : 'gider'} kategorisi</button>
    <div class="list">
      ${cats.map((c) => `<button class="tx" data-action="edit-cat" data-id="${c.id}">
        <span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span>
        <span class="tx-main"><b>${esc(c.name)}</b><small>${usage[c.id] ? `${usage[c.id]} işlem · ${money(sums[c.id])}` : 'Henüz kullanılmadı'}</small></span>
        <span class="chev">${icon('chevron-right', 18)}</span>
      </button>`).join('') || emptyState('Kategori yok.')}
    </div>
  `;
}

function viewSettings() {
  const s = db.settings;
  return `
    ${viewHead('Ayarlar')}
    ${syncCard()}
    <div class="card">
      <button class="between" style="width:100%" data-action="nav" data-view="cats"><span><b>Kategoriler</b><small class="muted" style="display:block;font-size:12px;text-align:left">${db.categories.length} kategori · ekle, düzenle, sil</small></span><span class="chev">${icon('chevron-right', 18)}</span></button>
    </div>
    <div class="card">
      <div class="setting">
        <div><b>Ay başlangıç günü</b><p>Maaş günün 9 ise 9 seç: "Ay" görünümü 9'undan sonraki ayın 8'ine kadar sayar.</p></div>
        <select data-change="set-monthStart">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}" ${s.monthStartDay === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select>
      </div>
      <div class="setting">
        <div><b>Hafta başlangıcı</b></div>
        <select data-change="set-weekStart">
          <option value="1" ${s.weekStartDay === 1 ? 'selected' : ''}>Pazartesi</option>
          <option value="0" ${s.weekStartDay === 0 ? 'selected' : ''}>Pazar</option>
        </select>
      </div>
      <div class="setting">
        <div><b>Para birimi simgesi</b></div>
        <input data-change="set-currency" value="${esc(s.currency)}" maxlength="4" style="min-width:80px;width:80px;text-align:center">
      </div>
      <div class="setting">
        <div><b>Tema</b></div>
        <select data-change="set-theme">
          <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Sistem</option>
          <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Açık</option>
          <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Koyu</option>
        </select>
      </div>
    </div>
    <div class="card">
      <h3>Yedek & dışa aktarma</h3>
      <p class="muted" style="margin-top:-4px;font-size:13px">Veriler bu cihazda saklanır${syncConfigured() ? ', senkron açıksa bulutta da durur' : ''}. Yine de ara ara yedek almanı öneririm.</p>
      <div class="btn-stack">
        <button class="btn" data-action="export-json">Yedek al (.json)</button>
        <button class="btn" data-action="import-json">Yedekten geri yükle</button>
        <button class="btn" data-action="export-csv">Excel için dışa aktar (.csv)</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
    </div>
    <p class="muted" style="text-align:center;font-size:12px">${db.transactions.length} işlem · ${db.categories.length} kategori · sürüm ${APP_VERSION}</p>
    <button class="btn block" data-action="hard-reload">Uygulamayı yenile</button>
  `;
}

const VIEWS = { tx: viewTx, report: viewReport, cats: viewCats, settings: viewSettings };

const APP_VERSION = 16;

function errorCard(e) {
  return `<div class="card empty-card">
    <span class="empty-ico warn">${icon('triangle-alert', 26)}</span>
    <b>Bu ekran açılırken bir sorun oldu</b>
    <p>Sayfayı yenilemeyi dene. Düzelmezse aşağıdaki yazıyı bana gönder.</p>
    <pre class="err">${esc([`${e?.name || 'Hata'}: ${e?.message || e}`, ...String(e?.stack || '').split('\n').slice(1, 4), `Sürüm ${APP_VERSION} · ${ui.view}`].join('\n'))}</pre>
    <div class="btn-stack"><button class="btn primary" data-action="hard-reload">Yenile</button><button class="btn" data-action="nav" data-view="home">Özet'e dön</button></div>
  </div>`;
}

function render() {
  if (ui.view === 'budget' || ui.view === 'recurring') { ui.planTab = ui.view; ui.view = 'plan'; }
  if (!VIEWS[ui.view]) ui.view = 'home';
  const main = $('#main');
  const scroll = window.scrollY;
  try {
    main.innerHTML = VIEWS[ui.view]();
  } catch (e) {
    // Bir ekran hata verirse boş kalmasın: hatayı göster, yenileme seçeneği sun
    console.error(e);
    main.innerHTML = errorCard(e);
  }
  window.scrollTo(0, scroll);
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
  try { if (typeof updateNavBadges === 'function') updateNavBadges(); } catch (e) { console.error(e); }
  applyTheme();
  saveUi();
}

function applyTheme() {
  const t = db.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/* -------------------------- alt pencere (sheet) -------------------------- */
// Android'in geri tuşu pencereyi kapatsın diye tarih geçmişine bir adım eklenir.
let sheetOpen = false;
function openSheet(html) {
  const root = $('#sheet-root');
  root.innerHTML = `<div class="overlay" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  root.classList.add('open');
  document.body.style.overflow = 'hidden';
  if (!sheetOpen) { history.pushState({ sheet: true }, ''); sheetOpen = true; }
  return $('.sheet', root);
}
function hideSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  root.innerHTML = '';
  document.body.style.overflow = '';
  form = null;
  catForm = null;
}
function closeSheet() { if (sheetOpen) history.back(); else hideSheet(); }
// Geri tuşu: önce açık pencereyi kapatır; alt sayfadaysa (Ayarlar, Kategoriler) önceki ekrana döner.
window.addEventListener('popstate', (e) => {
  if (sheetOpen) { sheetOpen = false; hideSheet(); return; }
  if (e.state?.view && e.state.view !== ui.view) { ui.view = e.state.view; render(); window.scrollTo(0, 0); }
});
const SUB_PAGES = ['settings', 'cats'];
function goTo(view) {
  if (view === ui.view) return;
  ui.view = view;
  if (SUB_PAGES.includes(view)) history.pushState({ view }, '');
  else history.replaceState({ view }, '');
  render();
  window.scrollTo(0, 0);
}

/* ---------------------------- işlem formu ---------------------------- */

let form = null;

function openTxForm(init = {}) {
  form = { id: null, type: 'expense', amountText: '', categoryId: null, date: todayISO(), note: '', accountId: init.id ? '' : lastAccountId(), ...init };
  renderTxForm(!form.id);
}

function syncForm() {
  const s = $('#sheet-root .sheet');
  if (!s || !form) return;
  const a = $('#f-amount', s), d = $('#f-date', s), n = $('#f-note', s);
  if (a) form.amountText = a.value;
  if (d) form.date = d.value;
  if (n) form.note = n.value;
  const r = $('#f-repeat', s);
  if (r) form.repeat = r.checked;
}

function renderTxForm(focusAmount = false) {
  const usage = usageCounts();
  const cats = db.categories.filter((c) => c.type === form.type)
    .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  const t = todayISO(), y = toISO(addDays(new Date(), -1));
  const sheet = openSheet(`
    <div class="sheet-head"><h2>${form.id ? 'İşlemi düzenle' : 'Yeni işlem'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="seg type field">
      <button data-action="form-type" data-val="expense" class="${form.type === 'expense' ? 'on' : ''}">− Gider</button>
      <button data-action="form-type" data-val="income" class="${form.type === 'income' ? 'on' : ''}">+ Gelir</button>
    </div>
    <div class="field amount-field">
      <input id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(form.amountText)}" aria-label="Tutar">
      <span>${esc(db.settings.currency)}</span>
    </div>
    ${accountPicker(form.accountId, form.type)}
    <div class="field">
      <label>Kategori</label>
      <div class="cat-grid">
        ${cats.map((c) => `<button class="cat-tile ${form.categoryId === c.id ? 'on' : ''}" style="--c:${col(c.color)}" data-action="form-cat" data-id="${c.id}"><span>${glyph(c.icon)}</span><em>${esc(c.name)}</em></button>`).join('')}
        <button class="cat-tile add" data-action="form-new-cat"><span>＋</span><em>Yeni kategori</em></button>
      </div>
    </div>
    <div class="field">
      <label>Tarih</label>
      <input type="date" id="f-date" value="${form.date}" data-change="f-date">
      <small class="acc-info" id="f-date-hint">${form.date > todayISO() ? 'İleri tarihli: bu tarih gelene kadar bakiyeye ve toplamlara eklenmez.' : ''}</small>
      <div class="chips">
        <button class="chip" data-action="form-date" data-val="${t}">Bugün</button>
        <button class="chip" data-action="form-date" data-val="${y}">Dün</button>
      </div>
    </div>
    <div class="field">
      <label>Not</label>
      <input id="f-note" placeholder="İsteğe bağlı (ör. A101, Ali'ye borç…)" value="${esc(form.note)}" maxlength="200">
    </div>
    ${form.awaiting ? `<div class="await-box">
        <b>${form.date > todayISO() ? `Planlı · ${fullDay(form.date)}` : 'Onay bekliyor'}</b>
        <small>${form.type === 'income' ? 'Geldiğinde' : 'Ödendiğinde'} onayla; o zamana kadar bakiyeye eklenmez. Tutar ya da hesap farklıysa önce düzelt.</small>
        <button class="btn primary block" data-action="save-tx" data-confirm="1">${icon('check', 18)} ${form.type === 'income' ? 'Geldi' : 'Ödendi'}, onayla</button>
      </div>` : ''}
    ${form.id ? (!form.recId && form.type !== 'transfer' ? `<button class="xfee-add" data-action="tx-to-rec" data-id="${form.id}">${icon('repeat', 18)}&nbsp; Düzenli kayda çevir (her ay tekrarlansın)</button>` : '')
      : `<label class="check"><input type="checkbox" id="f-repeat" ${form.repeat ? 'checked' : ''}><span><b>Her ay tekrarla</b><small>Düzenli ${form.type === 'income' ? 'gelir' : 'gider'} olarak kaydedilir; her ay bu gün "${form.type === 'income' ? 'geldi mi' : 'ödendi mi'}?" diye sorulur.</small></span></label>`}
    <div class="actions">
      ${form.id ? `<button class="btn danger" data-action="delete-tx" data-id="${form.id}">Sil</button>` : `<button class="btn" data-action="save-tx" data-again="1">Kaydet + yeni</button>`}
      <button class="btn primary" data-action="save-tx">Kaydet</button>
    </div>
  `);
  if (focusAmount) setTimeout(() => $('#f-amount', sheet)?.focus(), 50);
}

// "Her ay tekrarla": düzenli kayıt oluşturur. Tarih bugün ya da geçmişteyse ilk sefer "geldi/ödendi" olarak da kaydedilir.
function saveAsRecurring(data) {
  const now = Date.now();
  const id = uid();
  const rec = {
    id, type: data.type, name: data.note || (catMap()[data.categoryId] || MISSING_CAT).name, amount: data.amount, categoryId: data.categoryId,
    freq: 'monthly', day: fromISO(data.date).getDate(), startDate: data.date, endDate: null, count: null,
    variable: false, paused: false, accountId: data.accountId, skipped: [], createdAt: now, updatedAt: now,
  };
  db.recurring.push(rec);
  touch('rec', id);
  if (data.date <= todayISO()) {
    const txId = uid();
    db.transactions.push({ id: txId, createdAt: now, ...data, recId: id, recDate: data.date });
    touch('tx', txId);
  }
  save();
  closeSheet();
  render();
  const next = nextOccurrence(rec, toISO(addDays(fromISO(todayISO()), data.date <= todayISO() ? 1 : 0)));
  toast(`Düzenli kayıt eklendi${next ? ` · sıradaki ${fullDay(next)}` : ''}`);
}

function saveTx(again, confirmNow = false) {
  syncForm();
  const amount = parseAmount(form.amountText);
  if (!(amount > 0)) { $('#f-amount')?.classList.add('invalid'); $('#f-amount')?.focus(); toast('Geçerli bir tutar gir'); return; }
  if (!form.categoryId) { toast('Bir kategori seç'); return; }
  if (!form.date) { toast('Tarih seç'); return; }
  const now = Date.now();
  const today = todayISO();
  // Onaylanıyorsa ve tarih ileriyse, bugünün tarihiyle kaydedilir
  if (confirmNow && form.date > today) form.date = today;
  const awaiting = !confirmNow && (form.date > today || !!form.awaiting);
  const data = { type: form.type, amount, categoryId: form.categoryId, date: form.date, note: form.note.trim(), accountId: form.accountId || null, awaiting, updatedAt: now };
  if (!form.id) rememberAccount(form.accountId);
  if (!form.id && $('#f-repeat')?.checked) { saveAsRecurring(data); return; }
  const budgetBefore = budgetSnapshot(form.date);
  if (form.id) {
    const tx = db.transactions.find((x) => x.id === form.id);
    if (tx) Object.assign(tx, data);
    touch('tx', form.id);
  } else {
    const id = uid();
    db.transactions.push({ id, createdAt: now, ...data });
    touch('tx', id);
  }
  save();
  render();
  const wasEdit = !!form.id;
  const warnings = data.type === 'expense' ? budgetWarningsAfterSave(budgetBefore, data) : [];
  if (again) {
    form = { id: null, type: form.type, amountText: '', categoryId: null, date: form.date, note: '' };
    renderTxForm(true);
  } else {
    closeSheet();
  }
  if (warnings.length && !awaiting) alertToast(warnings);
  else if (confirmNow) toast(`${data.type === 'income' ? 'Geldi' : 'Ödendi'} olarak onaylandı`);
  else if (awaiting) toast(`Planlandı · ${fullDay(data.date)} günü onayın istenecek`);
  else toast(wasEdit ? 'Güncellendi' : 'Kaydedildi');
}

function deleteTx(id) {
  // Transferle birlikte ona bağlı komisyon kaydı da silinir
  const ids = new Set([id, ...db.transactions.filter((x) => x.feeOf === id).map((x) => x.id)]);
  const removed = db.transactions.filter((x) => ids.has(x.id));
  if (!removed.length) return;
  db.transactions = db.transactions.filter((x) => !ids.has(x.id));
  const now = Date.now();
  for (const tx of removed) { db.deleted.push({ id: tx.id, kind: 'tx', at: now, data: tx }); touch('tx', tx.id); }
  save();
  closeSheet();
  render();
  toast('İşlem silindi', 'Geri al', () => {
    for (const tx of removed) {
      tx.updatedAt = Date.now();
      db.transactions.push(tx);
      touch('tx', tx.id);
    }
    db.deleted = db.deleted.filter((d) => !ids.has(d.id));
    save();
    render();
  });
}

/* --------------------------- kategori formu --------------------------- */

let catForm = null;

function openCatForm(init, onDone) {
  catForm = { id: null, type: ui.catTab, name: '', icon: 'lc:package', color: PALETTE[Math.floor(Math.random() * PALETTE.length)], onDone, ...init };
  renderCatForm();
}

function renderCatForm() {
  const f = catForm;
  const used = f.id ? db.transactions.filter((t) => t.categoryId === f.id).length : 0;
  const others = db.categories.filter((c) => c.type === f.type && c.id !== f.id).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const sheet = openSheet(`
    <div class="sheet-head"><h2>${f.id ? 'Kategoriyi düzenle' : 'Yeni kategori'}</h2><button class="close" data-action="cat-cancel" aria-label="Kapat">${icon('x', 18)}</button></div>
    ${f.id ? '' : `<div class="seg type field">
      <button data-action="catform-type" data-val="expense" class="${f.type === 'expense' ? 'on' : ''}">Gider</button>
      <button data-action="catform-type" data-val="income" class="${f.type === 'income' ? 'on' : ''}">Gelir</button>
    </div>`}
    <div class="preview"><span class="ico" id="c-prev-ico" style="--c:${col(f.color)}">${glyph(f.icon)}</span><b id="c-prev-name">${esc(f.name) || 'Kategori adı'}</b></div>
    <div class="field"><label>Ad</label><input id="c-name" value="${esc(f.name)}" maxlength="40" placeholder="ör. Okul servisi" data-input="catform-name"></div>
    <div class="field">
      <label>Simge</label>
      <div class="icon-grid">${ICON_PICKER.map((n) => `<button data-action="catform-icon" data-val="lc:${n}" class="${f.icon === `lc:${n}` || EMOJI_ICON[f.icon] === n ? 'on' : ''}" aria-label="${n}">${icon(n, 20)}</button>`).join('')}</div>
    </div>
    <div class="field">
      <label>Renk</label>
      <div class="swatches">${PALETTE.map((c) => `<button data-action="catform-color" data-val="${c}" class="${col(f.color) === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
    </div>
    <div class="actions"><button class="btn" data-action="cat-cancel">Vazgeç</button><button class="btn primary" data-action="cat-save">Kaydet</button></div>
    ${f.id ? `<div class="card" style="margin:20px 0 0;background:var(--surface-2);box-shadow:none">
      <h3>Kategoriyi sil</h3>
      ${used ? `<p class="muted" style="font-size:13px;margin-top:-4px">Bu kategoride ${used} işlem var. Silmeden önce bunlar hangi kategoriye taşınsın?</p>
        <select id="c-move" style="margin-bottom:10px">${others.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>` : ''}
      <button class="btn danger block" data-action="cat-delete" ${used && !others.length ? 'disabled' : ''}>Sil</button>
    </div>` : ''}
  `);
  if (!f.id) setTimeout(() => $('#c-name', sheet)?.focus(), 50);
}

function updateCatPreview() {
  $('#c-prev-ico').innerHTML = glyph(catForm.icon || 'lc:circle-help');
  $('#c-prev-ico').style.setProperty('--c', catForm.color);
  $('#c-prev-name').textContent = catForm.name || 'Kategori adı';
}

function saveCat() {
  const f = catForm;
  f.name = $('#c-name').value.trim();
  f.icon = f.icon || 'lc:package';
  if (!f.name) { toast('Kategoriye bir ad ver'); $('#c-name').focus(); return; }
  const dup = db.categories.find((c) => c.type === f.type && c.id !== f.id && c.name.toLocaleLowerCase('tr') === f.name.toLocaleLowerCase('tr'));
  if (dup) { toast('Bu adla bir kategori zaten var'); return; }
  const now = Date.now();
  let id = f.id;
  if (id) {
    Object.assign(db.categories.find((c) => c.id === id), { name: f.name, icon: f.icon, color: f.color, updatedAt: now });
  } else {
    id = uid();
    db.categories.push({ id, type: f.type, name: f.name, icon: f.icon, color: f.color, createdAt: now, updatedAt: now });
  }
  touch('cat', id);
  save();
  render();
  const done = f.onDone;
  catForm = null;
  if (done) done(id);
  else { closeSheet(); toast('Kategori kaydedildi'); }
}

function cancelCat() {
  const done = catForm?.onDone;
  catForm = null;
  if (done) done(null);
  else closeSheet();
}

function deleteCat() {
  const f = catForm;
  const used = db.transactions.filter((t) => t.categoryId === f.id);
  const now = Date.now();
  if (used.length) {
    const target = $('#c-move')?.value;
    if (!target) return;
    const tName = db.categories.find((c) => c.id === target)?.name;
    if (!confirm(`${used.length} işlem "${tName}" kategorisine taşınacak ve "${f.name}" silinecek. Emin misin?`)) return;
    used.forEach((t) => { t.categoryId = target; t.updatedAt = now; touch('tx', t.id); });
  } else if (!confirm(`"${f.name}" kategorisi silinsin mi?`)) return;
  db.categories = db.categories.filter((c) => c.id !== f.id);
  db.deleted.push({ id: f.id, kind: 'cat', at: now, data: db.categories.find((c) => c.id === f.id) });
  touch('cat', f.id);
  if (ui.txFilter.cat === f.id) ui.txFilter.cat = '';
  save();
  catForm = null;
  closeSheet();
  render();
  toast('Kategori silindi');
}

/* ------------------------------ toast ------------------------------ */

let toastTimer;
function toast(msg, actionLabel, actionFn) {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}</div>`;
  if (actionLabel) $('button', root).onclick = () => { root.innerHTML = ''; actionFn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (root.innerHTML = ''), actionLabel ? 5000 : 2200);
}

/* ------------------------- yedek / dışa aktarma ------------------------- */

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportJson() {
  download(`butcem-yedek-${todayISO()}.json`, JSON.stringify({ app: 'butcem', exportedAt: new Date().toISOString(), ...db }, null, 2), 'application/json');
}

function exportCsv() {
  const cm = catMap();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['Tarih', 'Tür', 'Kategori', 'Tutar', 'Not'].map(cell).join(';')];
  for (const t of sortTx(db.transactions).reverse()) {
    const d = fromISO(t.date);
    lines.push([
      `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
      t.type === 'income' ? 'Gelir' : t.type === 'transfer' ? 'Transfer' : 'Gider',
      (cm[t.categoryId] || MISSING_CAT).name,
      (t.type === 'income' ? '' : '-') + (t.amount / 100).toFixed(2).replace('.', ','),
      t.note,
    ].map(cell).join(';'));
  }
  download(`butcem-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

function importJson(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!Array.isArray(d.transactions) || !Array.isArray(d.categories)) throw new Error('format');
      if (!confirm(`Yedekte ${d.transactions.length} işlem ve ${d.categories.length} kategori var.\nBurada olmayanlar eklenecek, mevcut kayıtların silinmeyecek. Devam edilsin mi?`)) return;
      const added = mergeBackup(normalize(d));
      render();
      toast(added ? `${added} kayıt geri yüklendi` : 'Yedekteki her şey zaten mevcut');
    } catch {
      toast('Bu dosya geçerli bir Bütçem yedeği değil');
    }
  };
  r.readAsText(file);
}

/* ------------------------------ olaylar ------------------------------ */

const actions = {
  'nav': (el) => goTo(el.dataset.view),
  'add-tx': () => openTxForm({ type: ui.view === 'cats' ? ui.catTab : 'expense' }),
  'edit-tx': (el) => {
    const t = db.transactions.find((x) => x.id === el.dataset.id);
    if (t?.feeOf) { const p = db.transactions.find((x) => x.id === t.feeOf); if (p) { el = { dataset: { id: p.id } }; return actions['edit-tx'](el); } }
    if (t?.type === 'debt') return t.role === 'repay' ? openPay(t.debtId, t.id) : openDebt(t.debtId);
    if (t?.type === 'transfer') openTransfer({ id: t.id });
    else if (t) openTxForm({ id: t.id, type: t.type, amountText: amountToInput(t.amount), categoryId: t.categoryId, date: t.date, note: t.note || '', accountId: t.accountId || '', recId: t.recId || null, awaiting: !!t.awaiting });
  },
  'close-sheet': () => closeSheet(),

  'period-mode': (el) => {
    const m = el.dataset.val;
    if (m === 'custom' && ui.period.mode !== 'custom') {
      const per = getPeriod();
      ui.period.from = per.start; ui.period.to = per.end;
    }
    ui.period.mode = m;
    render();
  },
  'period-shift': (el) => { const p = shiftedPeriod(Number(el.dataset.dir)); if (p) { ui.period = p; render(); } },
  'period-today': () => { ui.period.anchor = todayISO(); render(); },

  'home-donut': (el) => { ui.homeDonut = el.dataset.val; render(); },
  'report-cat': (el) => { ui.reportCat = el.dataset.val; render(); },
  'filter-cat': (el) => { ui.txFilter = { q: '', type: 'all', cat: el.dataset.id }; ui.view = 'tx'; render(); window.scrollTo(0, 0); },
  'tx-type': (el) => { ui.txFilter.type = el.dataset.val; render(); },
  'cat-tab': (el) => { ui.catTab = el.dataset.val; render(); },

  'form-type': (el) => {
    syncForm();
    if (form.type !== el.dataset.val) { form.type = el.dataset.val; form.categoryId = null; }
    renderTxForm();
  },
  'form-cat': (el) => {
    form.categoryId = el.dataset.id;
    $$('.cat-tile').forEach((b) => b.classList.toggle('on', b.dataset.id === form.categoryId));
  },
  'form-date': (el) => { $('#f-date').value = el.dataset.val; },
  'form-new-cat': () => {
    syncForm();
    const saved = form;
    openCatForm({ type: saved.type }, (newId) => {
      form = saved;
      if (newId) form.categoryId = newId;
      renderTxForm();
    });
  },
  'save-tx': (el) => saveTx(!!el.dataset.again, !!el.dataset.confirm),
  'delete-tx': (el) => deleteTx(el.dataset.id),

  'new-cat': () => openCatForm({ type: ui.catTab }),
  'edit-cat': (el) => {
    const c = db.categories.find((x) => x.id === el.dataset.id);
    if (c) openCatForm({ id: c.id, type: c.type, name: c.name, icon: c.icon, color: c.color });
  },
  'catform-type': (el) => { catForm.name = $('#c-name').value; catForm.type = el.dataset.val; renderCatForm(); },
  'catform-icon': (el) => {
    catForm.icon = el.dataset.val;
    $$('.icon-grid button').forEach((b) => b.classList.toggle('on', b.dataset.val === catForm.icon));
    updateCatPreview();
  },
  'catform-color': (el) => {
    catForm.color = el.dataset.val;
    $$('.swatches button').forEach((b) => b.classList.toggle('on', b.dataset.val === catForm.color));
    updateCatPreview();
  },
  'cat-save': () => saveCat(),
  'cat-cancel': () => cancelCat(),
  'cat-delete': () => deleteCat(),

  'sync-login': () => signIn(),
  'sync-logout': () => signOutSync(),
  'sync-now': () => { if (sync.user) startListening(); },
  // Önbelleği (sadece uygulama dosyaları; verilere dokunmaz) temizleyip yeniden yükle
  'hard-reload': async () => {
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      await (await navigator.serviceWorker?.getRegistration())?.update();
    } catch {}
    location.reload();
  },
  'export-json': () => exportJson(),
  'export-csv': () => exportCsv(),
  'import-json': () => $('#import-file').click(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  try { fn(el, e); } catch (err) { console.error(err); toast(`Hata: ${err.message}`); }
});

const changes = {
  'period-from': (el) => { if (el.value) { ui.period.from = el.value; render(); } },
  'period-to': (el) => { if (el.value) { ui.period.to = el.value; render(); } },
  'tx-cat': (el) => { ui.txFilter.cat = el.value; render(); },
  'f-date': (el) => { const h = $('#f-date-hint'); if (h) h.textContent = el.value > todayISO() ? 'İleri tarihli: bu tarih gelene kadar bakiyeye ve toplamlara eklenmez.' : ''; },
  'tx-acc': (el) => { ui.txFilter.acc = el.value; render(); },
  'set-monthStart': (el) => { setSetting('monthStartDay', Number(el.value)); render(); toast('Kaydedildi'); },
  'set-weekStart': (el) => { setSetting('weekStartDay', Number(el.value)); render(); toast('Kaydedildi'); },
  'set-currency': (el) => { setSetting('currency', el.value.trim() || '₺'); render(); toast('Kaydedildi'); },
  'set-theme': (el) => { setSetting('theme', el.value); render(); },
};
document.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) { importJson(e.target.files[0]); e.target.value = ''; return; }
  const fn = changes[e.target.dataset?.change];
  if (fn) fn(e.target);
});

let searchTimer;
document.addEventListener('input', (e) => {
  const key = e.target.dataset?.input;
  if (e.target.id === 'f-amount') e.target.classList.remove('invalid');
  if (key === 'tx-q') {
    clearTimeout(searchTimer);
    const pos = e.target.selectionStart;
    searchTimer = setTimeout(() => {
      ui.txFilter.q = e.target.value;
      render();
      const inp = $('[data-input="tx-q"]');
      if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
    }, 250);
  } else if (key === 'catform-name') { catForm.name = e.target.value; updateCatPreview(); }
  else if (key === 'catform-icon') {
    catForm.icon = e.target.value.trim();
    $$('.icon-grid button').forEach((b) => b.classList.toggle('on', b.dataset.val === catForm.icon));
    updateCatPreview();
  }
});

document.addEventListener('keydown', (e) => {
  if (!sheetOpen) return;
  if (e.key === 'Escape') { catForm ? cancelCat() : closeSheet(); }
  if (e.key === 'Enter' && form && !catForm && ['f-amount', 'f-note'].includes(e.target.id)) { e.preventDefault(); saveTx(false); }
});


/* ------------------------------ senkron ------------------------------ */
// Firebase (Google) ile telefon ↔ bilgisayar eşitleme.
// Kayıtlar users/{uid}/tx, /cat, /bud ve users/{uid}/meta/settings altında durur.
// Aynı kayıt iki cihazda değiştiyse en son değiştirilen (updatedAt) kazanır.
// Her yazıma sunucu zamanı (srv) eklenir; açılışta sadece son eşitlemeden sonra değişenler indirilir.

const FB_VER = '13.0.0';
var sync = { app: null, fb: null, auth: null, fs: null, user: null, ready: false, state: 'off', error: '', unsubs: [], pushing: false, timer: null };

function syncConfigured() { return !!(window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey); }

function setSyncState(state, error = '') {
  sync.state = state;
  sync.error = error;
  if (ui.view === 'home' || ui.view === 'settings') scheduleRender();
}

let renderTimer;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    // Ayarlarda bir alana yazılırken ekranı yenileme
    if (ui.view === 'settings' && document.activeElement?.matches('input')) return;
    render();
  }, 150);
}

async function initSync() {
  if (!syncConfigured() || sync.auth) return;
  try {
    const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
    const [app, auth, fs] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map((f) => import(base + f)));
    sync.fb = { auth, fs };
    const fbApp = app.initializeApp(window.FIREBASE_CONFIG);
    sync.app = fbApp;
    sync.auth = auth.getAuth(fbApp);
    sync.fs = fs.getFirestore(fbApp);
    auth.getRedirectResult(sync.auth).catch((e) => console.warn(e));
    auth.onAuthStateChanged(sync.auth, (user) => {
      sync.user = user;
      sync.ready = true;
      if (user) startListening();
      else { stopListening(); setSyncState('off'); }
    });
  } catch (e) {
    console.warn('Senkron yüklenemedi', e);
    setSyncState('offline');
  }
}

const arrFor = (kind) => ({ tx: db.transactions, cat: db.categories, bud: db.budgets, rec: db.recurring, acc: db.accounts, debt: db.debts })[kind];
const userCol = (name) => sync.fb.fs.collection(sync.fs, 'users', sync.user.uid, name);
const userDoc = (kind, id) => kind === 'set'
  ? sync.fb.fs.doc(sync.fs, 'users', sync.user.uid, 'meta', 'settings')
  : sync.fb.fs.doc(sync.fs, 'users', sync.user.uid, kind, id);

function stopListening() {
  sync.unsubs.forEach((u) => u());
  sync.unsubs = [];
}

function startListening() {
  stopListening();
  const { fs } = sync.fb;
  const uid = sync.user.uid;
  const firstTime = !db.sync || db.sync.uid !== uid;
  if (firstTime) db.sync = { uid, lastSrv: 0 };
  const since = fs.Timestamp.fromMillis(db.sync.lastSrv || 0);
  const remoteTimes = {};
  let waiting = 7;
  setSyncState('syncing');

  for (const [name, kind] of [['tx', 'tx'], ['cat', 'cat'], ['bud', 'bud'], ['rec', 'rec'], ['acc', 'acc'], ['debt', 'debt'], ['meta', 'set']]) {
    let first = true;
    const q = fs.query(userCol(name), fs.where('srv', '>', since));
    const unsub = fs.onSnapshot(q, (snap) => {
      let changed = false;
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        const data = ch.doc.data();
        const id = kind === 'set' ? 'main' : ch.doc.id;
        remoteTimes[`${kind}:${id}`] = data.updatedAt || 0;
        if (data.srv && !ch.doc.metadata.hasPendingWrites) db.sync.lastSrv = Math.max(db.sync.lastSrv || 0, data.srv.toMillis());
        if (applyRemote(kind, id, data)) changed = true;
      }
      if (first) {
        first = false;
        // Bu cihazda ilk kez giriş yapıldıysa: buluttakinden yeni olan yerel kayıtları gönder.
        if (--waiting === 0 && firstTime) reconcileLocal(remoteTimes);
      }
      saveLocal();
      if (changed) scheduleRender();
      if (waiting === 0) pushPending();
    }, (err) => {
      console.warn(err);
      setSyncState('error', err.code === 'permission-denied' ? 'Bulut erişim izni yok (Firestore kuralları)' : err.code || err.message);
    });
    sync.unsubs.push(unsub);
  }
}

function applyRemote(kind, id, data) {
  const item = { ...data };
  delete item.srv;
  delete item.deleted;
  if (kind === 'set') {
    if ((data.updatedAt || 0) <= (db.settings.updatedAt || 0)) return false;
    db.settings = { ...db.settings, ...item };
    return true;
  }
  const arr = arrFor(kind);
  const i = arr.findIndex((x) => x.id === id);
  const tomb = db.deleted.find((d) => d.id === id);
  const localTime = i >= 0 ? arr[i].updatedAt || 0 : tomb ? tomb.at : -1;
  if ((data.updatedAt || 0) <= localTime) return false;
  if (data.deleted) {
    if (i >= 0) arr.splice(i, 1);
    if (tomb) tomb.at = data.updatedAt;
    else db.deleted.push({ id, kind, at: data.updatedAt });
  } else {
    item.id = id;
    if (i >= 0) arr[i] = item;
    else arr.push(item);
    if (tomb) db.deleted = db.deleted.filter((d) => d.id !== id);
  }
  return true;
}

function reconcileLocal(remoteTimes) {
  const rt = (k) => remoteTimes[k] ?? -1;
  for (const t of db.transactions) if ((t.updatedAt || 0) > rt(`tx:${t.id}`)) touch('tx', t.id);
  for (const c of db.categories) if ((c.updatedAt || 0) > rt(`cat:${c.id}`)) touch('cat', c.id);
  for (const b of db.budgets) if ((b.updatedAt || 0) > rt(`bud:${b.id}`)) touch('bud', b.id);
  for (const r of db.recurring) if ((r.updatedAt || 0) > rt(`rec:${r.id}`)) touch('rec', r.id);
  for (const a of db.accounts) if ((a.updatedAt || 0) > rt(`acc:${a.id}`)) touch('acc', a.id);
  for (const x of db.debts) if ((x.updatedAt || 0) > rt(`debt:${x.id}`)) touch('debt', x.id);
  for (const d of db.deleted) if (d.at > rt(`${d.kind}:${d.id}`)) touch(d.kind, d.id);
  if ((db.settings.updatedAt || 0) > rt('set:main')) touch('set', 'main');
}

function payloadFor(kind, id) {
  if (kind === 'set') return { ...db.settings, updatedAt: db.settings.updatedAt || 0 };
  const arr = arrFor(kind);
  const it = arr.find((x) => x.id === id);
  if (it) return JSON.parse(JSON.stringify(it));
  const tomb = db.deleted.find((d) => d.id === id);
  // Silinen kayıt bulutta içeriğiyle birlikte "silindi" işaretli kalır; gerekirse geri getirilebilir.
  return tomb ? { ...JSON.parse(JSON.stringify(tomb.data || {})), deleted: true, updatedAt: tomb.at } : null;
}

function schedulePush() {
  if (!sync.user) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(pushPending, 600);
}

async function pushPending() {
  if (!sync.user || sync.pushing) return;
  const entries = Object.entries(db.pending);
  if (!entries.length) {
    if (sync.state !== 'error') setSyncState(navigator.onLine ? 'ok' : 'offline');
    return;
  }
  const { fs } = sync.fb;
  sync.pushing = true;
  setSyncState(navigator.onLine ? 'syncing' : 'offline');
  try {
    for (let i = 0; i < entries.length; i += 400) {
      const chunk = entries.slice(i, i + 400);
      const batch = fs.writeBatch(sync.fs);
      for (const [key] of chunk) {
        const cut = key.indexOf(':');
        const kind = key.slice(0, cut), id = key.slice(cut + 1);
        const data = payloadFor(kind, id);
        if (data) batch.set(userDoc(kind, id), { ...data, srv: fs.serverTimestamp() });
      }
      await batch.commit(); // internet yoksa bağlantı gelene kadar bekler
      for (const [key, stamp] of chunk) if (db.pending[key] === stamp) delete db.pending[key];
      saveLocal();
    }
    setSyncState('ok');
  } catch (e) {
    console.warn(e);
    setSyncState('error', e.code === 'permission-denied' ? 'Bulut erişim izni yok (Firestore kuralları)' : e.code || e.message);
  } finally {
    sync.pushing = false;
    if (Object.keys(db.pending).length && sync.state === 'ok') schedulePush();
  }
}

async function signIn() {
  if (!sync.auth) { toast('Senkron yüklenemedi. İnternet bağlantını kontrol et.'); initSync(); return; }
  const { auth } = sync.fb;
  const provider = new auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await auth.signInWithPopup(sync.auth, provider);
    toast('Giriş yapıldı, eşitleniyor…');
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
      return auth.signInWithRedirect(sync.auth, provider);
    }
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast(`Giriş yapılamadı: ${e.code || e.message}`);
  }
}

async function signOutSync() {
  if (!confirm('Çıkış yapılsın mı? Bu cihazdaki veriler kalır, ama tekrar giriş yapana kadar eşitlenmez.')) return;
  await sync.fb.auth.signOut(sync.auth);
  toast('Çıkış yapıldı');
}

const SYNC_TEXT = {
  ok: ['', 'Eşitlendi', 'Eşitlendi'],
  syncing: ['⟳', 'Eşitleniyor…', 'Eşitleniyor'],
  offline: ['', 'İnternet yok, bağlanınca eşitlenecek', 'Çevrimdışı'],
  error: ['', 'Eşitleme hatası', 'Hata'],
  off: ['', 'Senkron kapalı', 'Giriş yap'],
};

function syncBadge() {
  if (!syncConfigured()) return '';
  const st = sync.user ? sync.state : 'off';
  const [icon, long, short] = SYNC_TEXT[st];
  return `<button class="sync-badge ${st}" data-action="nav" data-view="settings" title="${long}">${icon} ${short}</button>`;
}

function syncCard() {
  const title = '<h3>Senkronizasyon</h3>';
  if (!syncConfigured()) {
    return `<div class="card">${title}<p class="muted" style="margin:0;font-size:13px">Henüz kurulmadı.</p></div>`;
  }
  if (!sync.user) {
    const label = sync.ready ? 'Google ile giriş yap' : sync.state === 'offline' ? 'Tekrar dene' : 'Yükleniyor…';
    return `<div class="card">${title}
      <p class="muted" style="margin-top:-4px;font-size:13px">Telefonda ve bilgisayarda aynı Google hesabıyla giriş yap, kayıtların iki tarafta da görünsün. İnternet yokken girdiklerin, bağlanınca gönderilir.</p>
      <button class="btn primary block" data-action="sync-login" ${sync.ready || sync.state === 'offline' ? '' : 'disabled'}>${label}</button>
    </div>`;
  }
  const pend = Object.keys(db.pending).length;
  const [icon, text] = SYNC_TEXT[sync.state] || SYNC_TEXT.ok;
  return `<div class="card">${title}
    <div class="setting"><div><b>${esc(sync.user.email || sync.user.displayName || 'Hesap')}</b>
      <p class="sync-text ${sync.state}">${icon} ${text}${sync.error ? `: ${esc(sync.error)}` : ''}${pend && sync.state !== 'ok' ? ` · ${pend} bekleyen değişiklik` : ''}</p></div></div>
    <div class="row" style="margin-top:6px">
      <button class="btn" data-action="sync-now">⟳ Şimdi eşitle</button>
      <button class="btn" data-action="sync-logout">Çıkış yap</button>
    </div>
  </div>`;
}

window.addEventListener('online', () => { if (!sync.auth) initSync(); else if (sync.user) { setSyncState('syncing'); schedulePush(); } });
window.addEventListener('offline', () => { if (sync.user) setSyncState('offline'); });
