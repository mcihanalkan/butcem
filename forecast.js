'use strict';

/* =====================================================================
   Ay sonu bakiye tahmini
   - Banka hesabı ve nakit varsa: bugünkü bakiyeleri + bu ay bekleyen gelir/giderler,
     kart son ödemeleri, borç vadeleri ve günlük harcama ortalaması → gün gün bakiye.
   - Hiç banka/nakit hesabı yoksa: bu ayın kalanı (gelir − gider) üzerinden tahmin.
   ===================================================================== */

ui.fcVar = true; // günlük harcama tahmini dahil mi

const LIQUID = (a) => a && a.kind !== 'credit';

function forecast(withVar = ui.fcVar) {
  const today = todayISO();
  const per = budgetPeriod(today);
  const liquid = db.accounts.filter(LIQUID);
  const mode = liquid.length ? 'balance' : 'net';
  const cm = catMap();
  // Bir hesap hareketinin tahmine etkisi: banka/nakit ya da hesapsız kayıt sayılır, kredi kartı sayılmaz
  const hits = (accId) => mode === 'net' || !accId || LIQUID(accById(accId));
  const events = [];
  const add = (date, amount, title, kind, icon) => { if (amount) events.push({ date: date < today ? today : date, orig: date, amount, title, kind, icon }); };

  const start = mode === 'balance' ? liquid.reduce((s, a) => s + accBalance(a), 0) : totals(txIn({ start: per.start, end: today })).net;

  // 1) Onay bekleyen ve ileri tarihli kayıtlar
  const plannedToCard = {}, plannedRepay = {};
  for (const t of db.transactions) {
    if (!isPlanned(t) || t.date > per.end) continue;
    if (t.date < per.start && (mode === 'net' || !t.awaiting)) continue;
    if (t.type === 'income' || t.type === 'expense') {
      if (!hits(t.accountId)) continue;
      const c = cm[t.categoryId] || MISSING_CAT;
      add(t.date, t.type === 'income' ? t.amount : -t.amount, t.note || c.name, t.type, c.icon);
    } else if (mode === 'balance' && t.type === 'transfer') {
      const from = LIQUID(accById(t.fromId)), to = LIQUID(accById(t.toId));
      if (accById(t.toId)?.kind === 'credit') plannedToCard[t.toId] = (plannedToCard[t.toId] || 0) + t.amount;
      if (from !== to) add(t.date, to ? t.amount : -t.amount, accById(t.toId)?.kind === 'credit' ? `${accById(t.toId).name} ödemesi` : 'Transfer', 'transfer', 'lc:arrow-left-right');
    } else if (mode === 'balance' && t.type === 'debt' && hits(t.accountId)) {
      if (t.role === 'repay') plannedRepay[t.debtId] = (plannedRepay[t.debtId] || 0) + t.amount;
      add(t.date, t.flow === 'in' ? t.amount : -t.amount, debtTxTitle(t), 'debt', 'lc:hand-coins');
    } else if (mode === 'balance' && t.type === 'goal' && hits(t.accountId)) {
      add(t.date, t.role === 'withdraw' ? t.amount : -t.amount, goalTxTitle(t), 'goal', 'lc:flag');
    }
  }

  // 2) Henüz kaydı oluşmamış düzenli gelir/giderler (gecikmişler bugüne alınır)
  for (const it of recItems(per)) {
    if (!['late', 'today', 'upcoming'].includes(it.state) || !hits(it.rec.accountId) || (mode === 'net' && it.carried)) continue;
    const inc = it.rec.type === 'income';
    add(it.due, inc ? it.rec.amount : -it.rec.amount, recName(it.rec), inc ? 'income' : 'expense', (cm[it.rec.categoryId] || MISSING_CAT).icon);
  }

  if (mode === 'balance') {
    // 3) Kredi kartı son ödemeleri (zaten planlanmış ödeme varsa düşülür)
    for (const a of db.accounts.filter((x) => x.kind === 'credit')) {
      const s = cardStatus(a);
      const left = s.remaining - (plannedToCard[a.id] || 0);
      if (left > 0 && s.due <= per.end) add(s.due, -left, `${a.name} son ödeme`, 'card', 'lc:credit-card');
    }
    // 4) Vadesi bu ay dolan borçlar
    for (const d of db.debts) {
      if (!isBorrowed(d) || !d.dueDate || d.dueDate > per.end) continue;
      const s = debtStatus(d);
      const left = s.remaining - (plannedRepay[d.id] || 0);
      if (!s.closed && left > 0) add(d.dueDate, -left, `Borç · ${d.person}`, 'debt', 'lc:hand-coins');
    }
  }

  // 5) Günlük harcama ortalaması (son 90 gün, düzenli ve sabit giderler hariç)
  const from = toISO(addDays(fromISO(today), -90));
  const first = db.transactions.reduce((m, t) => (t.date < m ? t.date : m), today);
  const spanStart = first > from ? first : from;
  const span = dayDiff(fromISO(spanStart), fromISO(today));
  let varSum = 0;
  for (const t of db.transactions) {
    if (t.type !== 'expense' || isPlanned(t) || t.recId || t.feeOf || t.date < spanStart || t.date >= today) continue;
    if (FIXED_CATS.has(t.categoryId) || !hits(t.accountId)) continue;
    varSum += t.amount;
  }
  const daily = span >= 14 ? Math.round(varSum / span) : 0;
  const daysLeft = dayDiff(fromISO(today), fromISO(per.end)); // yarından ay sonuna
  const useVar = withVar && daily > 0;

  // Gün gün seri
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.amount - b.amount));
  const series = [];
  let bal = start, i = 0, low = null;
  for (let d = fromISO(today), k = 0; toISO(d) <= per.end; d = addDays(d, 1), k++) {
    const iso = toISO(d);
    if (k > 0 && useVar) bal -= daily;
    while (i < events.length && events[i].date === iso) bal += events[i++].amount;
    series.push({ date: iso, value: bal });
    if (!low || bal < low.value) low = { date: iso, value: bal };
  }
  for (const e of events) e.after = series.find((s) => s.date === e.date)?.value;
  const end = series.at(-1)?.value ?? start;
  return { mode, per, start, end, events, series, low, daily, daysLeft, varTotal: useVar ? daily * daysLeft : 0, canVar: daily > 0, liquid };
}

/* ------------------------------ Özet satırı ------------------------------ */

function forecastLine() {
  if (!db.transactions.length && !db.accounts.length) return '';
  let f;
  try { f = forecast(); } catch (e) { console.error(e); return ''; }
  if (!f.events.length && !f.daily) return '';
  const tight = f.low && f.low.value < 0 && f.low.date !== f.per.end ? f.low : f.low && f.low.value < f.end && f.low.value < f.start * 0.25 ? f.low : null;
  return `<button class="fc-line" data-action="nav" data-view="forecast">
    <span class="fc-ico ${f.end < 0 ? 'neg' : ''}">${icon('chart-line', 18)}</span>
    <span class="fc-main"><small>Ay sonunda tahmini ${f.mode === 'balance' ? 'bakiye' : 'kalan'}</small>
      <b class="${f.end < 0 ? 'exp' : ''}">${money(f.end)}</b>
      ${tight ? `<small class="${tight.value < 0 ? 'exp' : 'warn-t'}">${tight.value < 0 ? 'Eksiye düşebilir' : 'En sıkışık gün'}: ${shortDay(tight.date)} · ${money(tight.value)}</small>` : ''}</span>
    <span class="chev">${icon('chevron-right', 18)}</span>
  </button>`;
}

/* ------------------------------ detay ekranı ------------------------------ */

function viewForecast() {
  const f = forecast();
  const back = `<button class="back" data-action="nav" data-view="home">${icon('chevron-left', 18)} Özet</button>`;
  const labels = f.series.map((s) => shortDay(s.date));
  const ins = f.events.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0);
  const outs = f.events.filter((e) => e.amount < 0).reduce((a, e) => a - e.amount, 0);
  const rows = [
    [f.mode === 'balance' ? 'Bugünkü bakiye' : 'Bu ay şu ana kadar kalan', f.start, ''],
    ['Gelecek gelirler', ins, 'inc'],
    ['Bekleyen ödemeler', -outs, 'exp'],
    ...(f.varTotal ? [[`Günlük harcama (${money(f.daily)} × ${f.daysLeft} gün)`, -f.varTotal, 'exp']] : []),
  ];
  return `${back}
    ${viewHead('Ay sonu tahmini')}
    <div class="hero fc-hero">
      <small>${shortDay(f.per.end)} itibarıyla tahmini ${f.mode === 'balance' ? 'bakiye' : 'kalan'}</small>
      <div class="hero-num">${money(f.end)}</div>
      ${f.low && f.low.value < 0 ? `<p class="fc-warn">${icon('triangle-alert', 16)} ${shortDay(f.low.date)} günü ${money(f.low.value)} ile eksiye düşebilirsin.</p>`
        : f.low && f.low.date !== f.per.end && f.low.value < f.end ? `<p class="fc-note">En düşük nokta ${shortDay(f.low.date)}: ${money(f.low.value)}</p>` : ''}
    </div>
    ${f.series.length > 1 ? `<div class="card">${lineChart(labels, [{ name: f.mode === 'balance' ? 'Banka ve nakit toplamı' : 'Ayın kalanı', color: 'var(--accent)', values: f.series.map((s) => s.value) }])}</div>` : ''}
    <div class="card">
      <div class="sum-list" style="padding:0">${rows.map(([k, v, c]) => `<div><span>${esc(k)}</span><b class="${c}">${v > 0 && c ? '+' : ''}${money(v)}</b></div>`).join('')}
        <div class="total"><span>Ay sonu</span><b>${money(f.end)}</b></div></div>
      ${f.canVar ? `<label class="check fc-toggle"><input type="checkbox" data-change="fc-var" ${ui.fcVar ? 'checked' : ''}> Günlük harcama ortalamamı da hesaba kat</label>` : ''}
    </div>
    <h2 class="sec">Bu ay beklenenler</h2>
    ${f.events.length ? `<div class="list">${f.events.map((e) => `<div class="tx fc-ev">
      <span class="ico" style="--c:#5F6B7A">${glyph(e.icon, 18)}</span>
      <span class="tx-main"><b>${esc(e.title)}</b><small>${e.orig < e.date ? `${shortDay(e.orig)} · gecikmiş` : e.date === todayISO() ? 'Bugün' : shortDay(e.date)} · sonrası ${money(e.after)}</small></span>
      <span class="amt ${e.amount > 0 ? 'inc' : 'exp'}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</span>
    </div>`).join('')}</div>` : '<p class="muted small">Bu ay için bekleyen bir gelir ya da ödeme yok.</p>'}
    <p class="muted small fc-foot">${f.mode === 'balance'
      ? `Banka hesapları ve nakit (${f.liquid.map((a) => esc(a.name)).join(', ')}) üzerinden hesaplanır. Kredi kartı harcamaları son ödeme gününde düşülür.`
      : 'Henüz banka ya da nakit hesabı eklemedin; tahmin bu ayın gelir ve giderleri üzerinden yapılır. Cüzdan\'dan hesap eklersen gerçek bakiyen üzerinden hesaplanır.'}</p>`;
}

VIEWS.forecast = viewForecast;
SUB_PAGES.push('forecast');
Object.assign(changes, { 'fc-var': (el) => { ui.fcVar = el.checked; render(); } });
