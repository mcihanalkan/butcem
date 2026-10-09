// Bütçem bildirim mantığı (Firebase'den bağımsız; test edilebilir).
// TODAY ve MODE ortam değişkenleriyle değiştirilebilir (test için).
export const MODE = process.env.MODE === 'evening' ? 'evening' : 'morning';
const TZ = 'Europe/Istanbul';
export const TODAY = process.env.TODAY || new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()); // YYYY-MM-DD

/* ------------------------------ tarih ------------------------------ */
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayDiff = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();
const dueIn = (y, m, day) => toISO(new Date(y, m, Math.min(day, lastDayOf(y, m))));
const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const shortDay = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
const nf = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (k) => `${nf.format(k / 100)} ₺`;
const plus = (n) => toISO(addDays(fromISO(TODAY), n));

/* --------------------- uygulamadaki hesapların aynısı --------------------- */
const FREQS = { weekly: ['w', 1], biweekly: ['w', 2], monthly: ['m', 1], quarterly: ['m', 3], semiannual: ['m', 6], yearly: ['m', 12] };

function occurrences(rec, from, to) {
  const out = [];
  const [unit, n] = FREQS[rec.freq] || FREQS.monthly;
  const start = rec.startDate || from;
  const lo = from > start ? from : start;
  const hi = rec.endDate && rec.endDate < to ? rec.endDate : to;
  if (lo > hi) return out;
  const s = fromISO(start);
  if (unit === 'w') {
    const step = 7 * n;
    const k = Math.max(0, Math.ceil(dayDiff(s, fromISO(lo)) / step));
    for (let d = addDays(s, k * step), i = 0; toISO(d) <= hi && i < 400; d = addDays(d, step), i++) out.push(toISO(d));
  } else {
    const day = rec.day || s.getDate();
    const l = fromISO(lo);
    let k = Math.max(0, Math.floor(((l.getFullYear() - s.getFullYear()) * 12 + l.getMonth() - s.getMonth()) / n) - 1);
    for (let i = 0; i < 400; i++, k++) {
      const due = dueIn(s.getFullYear(), s.getMonth() + k * n, day);
      if (due > hi) break;
      if (due >= lo) out.push(due);
    }
  }
  return out;
}

function accBalance(a, txs, until = TODAY) {
  let v = a.opening || 0;
  const credit = a.kind === 'credit';
  for (const t of txs) {
    if (t.date > until || t.awaiting || (t.createdAt || 0) < (a.createdAt || 0)) continue;
    if (t.type === 'goal') { if (t.accountId === a.id) v += (t.role === 'withdraw' ? 1 : -1) * (credit ? -t.amount : t.amount); continue; }
    if (t.type === 'debt') { if (t.accountId === a.id) v += (t.flow === 'in' ? 1 : -1) * (credit ? -t.amount : t.amount); continue; }
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

function cardStatus(a, txs) {
  const d = fromISO(TODAY);
  let stmt = dueIn(d.getFullYear(), d.getMonth(), a.statementDay || 1);
  if (stmt > TODAY) stmt = dueIn(d.getFullYear(), d.getMonth() - 1, a.statementDay || 1);
  const sd = fromISO(stmt);
  let due = dueIn(sd.getFullYear(), sd.getMonth(), a.dueDay || 1);
  if (due <= stmt) due = dueIn(sd.getFullYear(), sd.getMonth() + 1, a.dueDay || 1);
  const stmtDebt = Math.max(0, a.stmtOpeningDate === stmt && a.stmtOpening != null ? a.stmtOpening : accBalance(a, txs, stmt));
  const paid = txs.filter((t) => t.type === 'transfer' && t.toId === a.id && t.date > stmt && t.date <= TODAY && !t.awaiting && (t.createdAt || 0) >= (a.createdAt || 0)).reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, stmtDebt - paid);
  const minDue = Math.max(0, Math.round((stmtDebt * (a.minPct || 20)) / 100) - paid);
  return { due, remaining, minDue };
}

/* ------------------------------ hatırlatmalar ------------------------------ */
export function remindersFor(data) {
  const { tx, rec, acc, debt, cats } = data;
  const items = [];
  const catName = (id) => cats.find((c) => c.id === id)?.name || '';
  const isMorning = MODE === 'morning';

  // Düzenli gelir/giderler
  for (const r of rec) {
    if (r.paused) continue;
    const name = r.name || catName(r.categoryId) || 'Düzenli ödeme';
    const inc = r.type === 'income';
    for (const due of occurrences(r, plus(-1), plus(3))) {
      const done = tx.some((t) => t.recId === r.id && t.recDate === due);
      if (done || (r.skipped || []).includes(due)) continue;
      if (due === TODAY) items.push({ pri: 1, title: `${name} bugün`, body: `${money(r.amount)} · ${inc ? 'geldi mi?' : 'ödendi mi?'} Onaylamak için dokun.` });
      else if (isMorning && due === plus(-1)) items.push({ pri: 0, title: `${name} onay bekliyor`, body: `Dün (${shortDay(due)}) ${inc ? 'gelmesi' : 'ödenmesi'} gerekiyordu · ${money(r.amount)}` });
      else if (isMorning && !inc && due === plus(3)) items.push({ pri: 2, title: `${name} 3 gün sonra`, body: `${shortDay(due)} · ${money(r.amount)}` });
    }
  }
  // İleri tarihli (planlı) kayıtlar
  for (const t of tx) {
    if (!t.awaiting || t.feeOf || t.date !== TODAY) continue;
    const name = t.note || catName(t.categoryId) || 'Planlı işlem';
    const ask = t.type === 'income' || (t.type === 'debt' && t.flow === 'in') ? 'geldi mi?' : t.type === 'transfer' ? 'gönderildi mi?' : 'ödendi mi?';
    items.push({ pri: 1, title: `${name} bugün`, body: `${money(t.amount)} · ${ask}` });
  }
  // Kredi kartı son ödeme
  for (const a of acc) {
    if (a.kind !== 'credit') continue;
    const s = cardStatus(a, tx);
    if (s.remaining <= 0) continue;
    const left = dayDiff(fromISO(TODAY), fromISO(s.due));
    if (left === 0) items.push({ pri: 0, title: `${a.name} son ödeme günü bugün`, body: `Dönem borcu ${money(s.remaining)} · asgari ${money(s.minDue)}` });
    else if (isMorning && left === 3) items.push({ pri: 2, title: `${a.name} son ödemeye 3 gün`, body: `${shortDay(s.due)} · dönem borcu ${money(s.remaining)} · asgari ${money(s.minDue)}` });
  }
  // Borç / alacak vadesi
  for (const d of debt) {
    if (d.closed || !d.dueDate) continue;
    const paid = tx.filter((t) => t.type === 'debt' && t.debtId === d.id && t.role === 'repay' && !t.awaiting).reduce((s, t) => s + t.amount, 0);
    const remaining = Math.max(0, d.amount - paid);
    if (!remaining) continue;
    const kind = d.dir === 'borrowed' ? 'Borç' : 'Alacak';
    if (d.dueDate === TODAY) items.push({ pri: 0, title: `${kind} vadesi bugün · ${d.person}`, body: `Kalan ${money(remaining)}` });
    else if (isMorning && d.dueDate === plus(3)) items.push({ pri: 2, title: `${kind} vadesine 3 gün · ${d.person}`, body: `${shortDay(d.dueDate)} · kalan ${money(remaining)}` });
  }
  return items.sort((a, b) => a.pri - b.pri);
}

export function compose(items) {
  if (items.length === 1) return { title: items[0].title, body: items[0].body };
  return {
    title: MODE === 'evening' ? `Onay bekleyen ${items.length} işlem` : `Bugün ${items.length} hatırlatma`,
    body: items.slice(0, 5).map((i) => `• ${i.title}`).join('\n') + (items.length > 5 ? `\n+${items.length - 5} daha` : ''),
  };
}

