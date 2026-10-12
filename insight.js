'use strict';

/* =====================================================================
   Kişisel enflasyon ve harcamasız gün serisi
   - Enflasyon: aynı yerden aynı tutarla tekrar tekrar aldığın şeyler (simit, kahve, otopark…)
     ve sabit tutarlı düzenli ödemeler (abonelik, kira) son 12 ayda nasıl değişti?
   - Harcamasız gün: değişken harcama (sabit gider, düzenli ödeme, masraf hariç) olmayan gün.
   ===================================================================== */

/* ------------------------------ fiyatlar ------------------------------ */

function modeOf(list) {
  const c = new Map();
  for (const v of list) c.set(v, (c.get(v) || 0) + 1);
  let best = null, n = 0;
  for (const [v, k] of c) if (k > n || (k === n && v > best)) { best = v; n = k; }
  return { v: best, n };
}

function priceItems() {
  const today = todayISO();
  const since = toISO(addDays(fromISO(today), -365));
  const cm = catMap();
  const groups = new Map();
  for (const t of db.transactions) {
    if (t.type !== 'expense' || isPlanned(t) || t.feeOf || t.date < since) continue;
    const rec = t.recId ? db.recurring.find((r) => r.id === t.recId) : null;
    let key, label, fixed = false;
    if (rec && !rec.variable) { key = `r:${rec.id}`; label = recName(rec); fixed = true; }
    else if (t.note && learnKey(t.note)) { key = `m:${t.categoryId}|${learnKey(t.note)}`; label = t.note.trim(); }
    else continue;
    if (!groups.has(key)) groups.set(key, { key, label, fixed, catId: t.categoryId, list: [] });
    const g = groups.get(key);
    g.list.push({ date: t.date, amount: t.amount });
    if (t.note && !fixed) g.label = t.note.trim();
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.list.length < (g.fixed ? 2 : 4)) continue;
    g.list.sort((a, b) => (a.date < b.date ? -1 : 1));
    const first = g.list[0].date, last = g.list.at(-1).date;
    const span = dayDiff(fromISO(first), fromISO(last));
    if (span < 75) continue;
    const early = g.list.filter((x) => dayDiff(fromISO(first), fromISO(x.date)) <= 60).map((x) => x.amount);
    const late = g.list.filter((x) => dayDiff(fromISO(x.date), fromISO(last)) <= 60).map((x) => x.amount);
    const a = modeOf(early), b = modeOf(late);
    // Aynı şeyi aldığını anlamak için: her iki dönemde de aynı tutar en az 2 kez (düzenli ödemede 1 yeter)
    if (!a.v || !b.v || (!g.fixed && (a.n < 2 || b.n < 2))) continue;
    // Tutar 3 katından fazla değiştiyse muhtemelen farklı bir alışveriş
    const change = b.v / a.v - 1;
    if (change > 2 || change < -0.6) continue;
    const months = Math.max(1, Math.round(span / 30));
    const yearly = Math.pow(1 + change, 12 / months) - 1;
    const weight = g.list.filter((x) => dayDiff(fromISO(x.date), fromISO(today)) <= 90).reduce((s, x) => s + x.amount, 0) || b.v;
    out.push({ ...g, old: a.v, now: b.v, change, months, yearly, weight, since: first, cat: cm[g.catId] || MISSING_CAT });
  }
  return out.sort((x, y) => y.change - x.change);
}

function personalInflation(items = priceItems()) {
  if (items.length < 2) return null;
  const w = items.reduce((s, x) => s + x.weight, 0);
  const yearly = items.reduce((s, x) => s + x.yearly * x.weight, 0) / w;
  const raw = items.reduce((s, x) => s + x.change * x.weight, 0) / w;
  return { yearly, raw, n: items.length, up: items.filter((x) => x.change > 0.005).length, same: items.filter((x) => Math.abs(x.change) <= 0.005).length };
}

const pct1 = (x) => `%${(Math.round(x * 1000) / 10).toLocaleString('tr-TR')}`;

function viewPrices() {
  const items = priceItems();
  const P = personalInflation(items);
  if (!items.length) {
    return `<div class="card empty-card"><span class="empty-ico">${icon('trending-up', 26)}</span><b>Kişisel enflasyonun için biraz veri lazım</b>
      <p>Sık aldığın şeyleri (simit, kahve, otopark, abonelik…) açıklamasıyla girdikçe, aynı şeyin fiyatının aylar içinde nasıl değiştiğini burada görürsün. En az 2–3 aylık kayıt gerekir.</p></div>`;
  }
  return `
    ${P ? `<div class="hero infl-hero">
      <small>Senin kişisel enflasyonun</small>
      <div class="hero-num">${P.yearly >= 0 ? '' : '−'}${pct1(Math.abs(P.yearly))} <span class="infl-unit">yıllık</span></div>
      <p class="fc-note">${P.n} kalemde ortalama ${pct1(P.raw)} artış · ${P.up} kalem zamlandı${P.same ? `, ${P.same} kalem aynı kaldı` : ''}</p>
    </div>` : ''}
    <h2 class="sec">Ne kadar zamlandı?</h2>
    <div class="list">${items.map((x) => `<div class="tx infl-row">
      <span class="ico" style="--c:${col(x.cat.color)}">${glyph(x.cat.icon, 18)}</span>
      <span class="tx-main"><b>${esc(x.label)}</b><small>${money(x.old)} → ${money(x.now)} · ${x.months} ayda${x.fixed ? ' · düzenli ödeme' : ''}</small></span>
      <span class="amt ${x.change > 0.005 ? 'exp' : x.change < -0.005 ? 'inc' : 'muted'}">${x.change > 0.005 ? '+' : x.change < -0.005 ? '−' : ''}${pct1(Math.abs(x.change))}</span>
    </div>`).join('')}</div>
    <p class="muted small fc-foot">Aynı yerden aynı tutarla tekrar tekrar aldığın şeylerin ilk ve son fiyatı karşılaştırılır; yıllık oran, her kalemin süresine göre yıla çevrilip harcama payına göre ağırlıklandırılır. Resmi enflasyon değildir, senin alışverişlerini yansıtır.</p>`;
}

/* ------------------------------ harcamasız gün ------------------------------ */

function spendDays() {
  const set = new Set();
  let first = '9999';
  for (const t of db.transactions) {
    if (t.date < first) first = t.date;
    if (t.type !== 'expense' || isPlanned(t) || t.feeOf || t.recId || FIXED_CATS.has(t.categoryId)) continue;
    set.add(t.date);
  }
  return { set, first };
}

const isNoSpendDay = (iso, S = spendDays()) => iso >= S.first && iso <= todayISO() && !S.set.has(iso);

function noSpendStats() {
  const S = spendDays();
  const today = todayISO();
  if (S.first === '9999') return null;
  // Bugün henüz harcama yoksa seri bugünle devam ediyor sayılır
  let streak = 0;
  for (let d = fromISO(today); toISO(d) >= S.first; d = addDays(d, -1)) {
    if (S.set.has(toISO(d))) break;
    streak++;
  }
  const per = budgetPeriod(today);
  let month = 0;
  for (let d = fromISO(per.start > S.first ? per.start : S.first); toISO(d) <= today; d = addDays(d, 1)) if (!S.set.has(toISO(d))) month++;
  let best = 0, run = 0;
  for (let d = fromISO(S.first); toISO(d) <= today; d = addDays(d, 1)) {
    if (S.set.has(toISO(d))) run = 0; else { run++; if (run > best) best = run; }
  }
  return { streak, month, best, todayFree: !S.set.has(today) };
}

function streakLine() {
  const s = noSpendStats();
  if (!s || (!s.streak && !s.month)) return '';
  const msg = s.streak >= 2 ? `${s.streak} gündür harcamasız${s.streak >= s.best && s.best >= 3 ? ' · rekor!' : ''}` : s.todayFree ? 'Bugün henüz harcama yok' : 'Bugün harcama yaptın';
  return `<button class="streak" data-action="report-cal">
    <span class="streak-ico ${s.streak >= 2 ? 'hot' : ''}">${icon('flame', 16)}</span>
    <b>${msg}</b>
    <small>Bu ay ${s.month} gün · rekor ${s.best}</small>
  </button>`;
}

Object.assign(actions, {
  'report-cal': () => { ui.reportTab = 'calendar'; ui.calAnchor = todayISO(); if (ui.view === 'report') render(); else goTo('report'); },
  'report-prices': () => { ui.reportTab = 'prices'; if (ui.view === 'report') render(); else goTo('report'); },
});
