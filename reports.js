'use strict';

/* =====================================================================
   Raporlar: Genel · Karşılaştır · Takvim · Yıl özeti + aylık PDF rapor
   (Genel = app.js'teki viewReport; buradaki sekmeler onun üstüne gelir.)
   ===================================================================== */

ui.reportTab = ui.reportTab || 'general';
ui.calAnchor = todayISO();
ui.yearSel = new Date().getFullYear();

const monthShort = (per) => { const d = fromISO(per.start); return db.settings.monthStartDay === 1 ? MONTHS_SHORT[d.getMonth()] : `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };

// Son n bütçe ayı (en eski → en yeni), içinde bulunulan ay dahil
function lastMonths(n) {
  const out = [];
  let p = { mode: 'month', anchor: todayISO() };
  out.unshift(getPeriod(p));
  for (let i = 1; i < n; i++) { p = shiftedPeriod(-1, p); out.unshift(getPeriod(p)); }
  return out;
}

/* ------------------------------ küçük grafikler ------------------------------ */

function sparkBars(values, color) {
  const max = Math.max(...values, 1);
  const w = 8, gap = 4, h = 28;
  return `<svg class="spark" viewBox="0 0 ${values.length * (w + gap) - gap} ${h}" aria-hidden="true">${values.map((v, i) => {
    const bh = Math.max(v > 0 ? 2 : 0, (v / max) * h);
    return `<rect x="${i * (w + gap)}" y="${h - bh}" width="${w}" height="${bh}" rx="2" fill="${i === values.length - 1 ? color : 'var(--surface-3)'}"/>`;
  }).join('')}</svg>`;
}

function lineChart(labels, series) {
  const W = 600, H = 230, padL = 58, padR = 8, padT = 12, padB = 30;
  const all = series.flatMap((s) => s.values);
  const minV = Math.min(0, ...all), maxV = niceMax(Math.max(...all, 1));
  const pw = W - padL - padR, ph = H - padT - padB;
  const x = (i) => padL + (labels.length === 1 ? pw / 2 : (i / (labels.length - 1)) * pw);
  const y = (v) => padT + ph - ((v - minV) / (maxV - minV || 1)) * ph;
  let s = '';
  for (const k of [0, 0.5, 1]) {
    const v = minV + (maxV - minV) * k;
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${padL - 8}" y="${y(v) + 5}" text-anchor="end">${esc(compact(v))}</text>`;
  }
  if (minV < 0) s += `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)" stroke-dasharray="4 4"/>`;
  const step = Math.ceil(labels.length / 7);
  labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) s += `<text class="axis" x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
  for (const se of series) {
    const pts = se.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    s += `<polyline points="${pts}" fill="none" stroke="${se.color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" ${se.dash ? 'stroke-dasharray="6 6"' : ''}/>`;
    se.values.forEach((v, i) => { s += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === se.values.length - 1 ? 5 : 3.5}" fill="${se.color}"><title>${esc(labels[i])}: ${esc(money(v))}</title></circle>`; });
  }
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>
    <div class="chart-legend">${series.map((se) => `<span><i style="background:${se.color}"></i>${esc(se.name)}</span>`).join('')}</div></div>`;
}

/* ------------------------------ Karşılaştır ------------------------------ */

function viewCompare() {
  const months = lastMonths(12);
  const first = db.transactions.reduce((m, t) => (t.date < m ? t.date : m), '9999');
  const used = months.filter((p) => p.end >= first);
  if (used.length < 2) return `<div class="card empty-card"><span class="empty-ico">${icon('chart-line', 26)}</span><b>Karşılaştırma için biraz daha veri lazım</b><p>En az iki aylık kayıt olunca kategorilerin aydan aya değişimini burada göreceksin.</p></div>`;
  const tots = used.map((p) => totals(txIn(p)));
  const cur = used.at(-1);
  const last6 = used.slice(-6);
  // Kategori trendleri (son 6 ay)
  const catSums = new Map();
  last6.forEach((p, i) => {
    for (const r of byCategory(txIn(p), 'expense')) {
      if (!catSums.has(r.id)) catSums.set(r.id, { cat: r.cat, vals: Array(last6.length).fill(0) });
      catSums.get(r.id).vals[i] = r.sum;
    }
  });
  // Ay devam ediyorsa önceki ayların AYNI gün sayısıyla karşılaştır (ör. ilk 10 gün vs ilk 10 gün)
  const today = todayISO();
  const ongoing = today >= cur.start && today <= cur.end;
  const elapsed = ongoing ? dayDiff(fromISO(cur.start), fromISO(today)) + 1 : null;
  const prevMonths = last6.slice(0, -1);
  const partialSum = (p, catId) => {
    const until = elapsed ? toISO(addDays(fromISO(p.start), elapsed - 1)) : p.end;
    return db.transactions.reduce((a, t) => a + (t.type === 'expense' && t.categoryId === catId && !isPlanned(t) && t.date >= p.start && t.date <= until ? t.amount : 0), 0);
  };
  const rows = [...catSums.values()].map((x) => {
    const now = x.vals.at(-1);
    const prev = prevMonths.map((p) => partialSum(p, x.cat.id)).filter((v) => v > 0);
    const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
    return { ...x, now, avg, change: avg ? (now - avg) / avg : null, total: x.vals.reduce((a, b) => a + b, 0) };
  }).sort((a, b) => b.total - a.total).slice(0, 10);

  // Geçen yılın aynı ayı
  const ly = getPeriod({ mode: 'month', anchor: toISO(new Date(fromISO(cur.start).getFullYear() - 1, fromISO(cur.start).getMonth(), fromISO(cur.start).getDate())) });
  const lyT = totals(txIn(ly)), curT = tots.at(-1);
  const hasLy = ly.end >= first && (lyT.inc || lyT.exp);

  return `
    <div class="card">
      <h3>Gelir, gider ve kalan · son ${used.length} ay</h3>
      ${ongoing ? `<p class="muted small" style="margin:-6px 0 6px">${esc(cur.label)} henüz bitmedi; son nokta ayın ilk ${elapsed} günü.</p>` : ''}
      ${lineChart(used.map(monthShort), [
        { name: 'Gelir', color: 'var(--inc)', values: tots.map((t) => t.inc) },
        { name: 'Gider', color: 'var(--exp)', values: tots.map((t) => t.exp) },
        { name: 'Kalan', color: 'var(--text)', values: tots.map((t) => t.net), dash: true },
      ])}
    </div>
    <div class="card">
      <h3>Kategoriler · son ${last6.length} ay</h3>
      <p class="muted small" style="margin:-6px 0 6px">${ongoing ? `Yüzde: bu ayın ilk ${elapsed} günü, önceki ayların ilk ${elapsed} gününün ortalamasıyla kıyaslanır.` : 'Yüzde: bu ay, önceki ayların ortalamasına göre değişim.'}</p>
      ${rows.map((x) => `<button class="cmp-row" data-action="filter-cat" data-id="${catSums.has(x.cat.id) ? x.cat.id : ''}">
        <span class="ico sm" style="--c:${col(x.cat.color)}">${glyph(x.cat.icon)}</span>
        <span class="cmp-main"><b>${esc(x.cat.name)}</b><small>${money(x.now)} bu ay · ${ongoing ? `aynı dönem ort.` : 'ort.'} ${money(Math.round(x.avg))}</small></span>
        ${sparkBars(x.vals, col(x.cat.color))}
        <span class="cmp-chg ${x.change == null ? '' : x.change > 0.05 ? 'up' : x.change < -0.05 ? 'down' : ''}">${x.change == null ? 'yeni' : `${x.change > 0 ? '+' : ''}${Math.round(x.change * 100)}%`}</span>
      </button>`).join('')}
    </div>
    ${hasLy ? `<div class="card">
      <h3>Geçen yılın aynı ayı</h3>
      <div class="sum-list" style="padding:0">
        <div><span>Gelir · ${esc(ly.label)} → ${esc(cur.label)}</span><b>${money(lyT.inc)} → ${money(curT.inc)}</b></div>
        <div><span>Gider</span><b class="${curT.exp > lyT.exp ? 'exp' : 'inc'}">${money(lyT.exp)} → ${money(curT.exp)}</b></div>
        <div><span>Kalan</span><b>${money(lyT.net)} → ${money(curT.net)}</b></div>
      </div>
    </div>` : ''}`;
}

/* ------------------------------ Takvim ------------------------------ */

function viewCalendar() {
  const per = getPeriod({ mode: 'month', anchor: ui.calAnchor });
  const start = fromISO(per.start), end = fromISO(per.end);
  const today = todayISO();
  const byDay = {};
  for (const t of txIn(per)) {
    if (isPlanned(t) || (t.type !== 'expense' && t.type !== 'income')) continue;
    const d = (byDay[t.date] ||= { exp: 0, inc: 0, n: 0 });
    d[t.type === 'income' ? 'inc' : 'exp'] += t.amount;
    d.n++;
  }
  const exps = Object.values(byDay).map((d) => d.exp).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => exps[Math.min(exps.length - 1, Math.floor(p * exps.length))] || 0;
  const level = (v) => (!v ? 0 : v <= q(0.25) ? 1 : v <= q(0.5) ? 2 : v <= q(0.8) ? 3 : 4);
  const wsd = db.settings.weekStartDay;
  const lead = (start.getDay() - wsd + 7) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="cal-cell empty"></span>');
  let noSpend = 0, maxDay = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const iso = toISO(d);
    const x = byDay[iso];
    if (iso <= today && !x?.exp) noSpend++;
    if (x?.exp && (!maxDay || x.exp > byDay[maxDay].exp)) maxDay = iso;
    cells.push(`<button class="cal-cell l${level(x?.exp)}${iso === today ? ' today' : ''}${iso > today ? ' future' : ''}" data-action="cal-day" data-date="${iso}">
      <span class="cal-d">${d.getDate()}</span>${x?.exp ? `<span class="cal-v">${esc(compact(x.exp))}</span>` : ''}${x?.inc ? '<i class="cal-inc"></i>' : ''}</button>`);
  }
  const heads = Array.from({ length: 7 }, (_, i) => DAYS_SHORT[(wsd + i) % 7]);
  const t = totals(txIn(per));
  const daysSoFar = Math.max(1, Math.min(per.days, dayDiff(start, fromISO(today)) + 1));
  return `
    ${monthNav(per, 'cal')}
    <div class="card cal-card">
      <div class="cal-grid">${heads.map((h) => `<span class="cal-h">${h}</span>`).join('')}${cells.join('')}</div>
      <div class="cal-legend"><span>Az</span>${[1, 2, 3, 4].map((l) => `<i class="l${l}"></i>`).join('')}<span>Çok</span><span class="cal-inc-l"><i class="cal-inc"></i> gelir günü</span></div>
    </div>
    <div class="card sum-list">
      <div><span>Günlük ortalama gider</span><b>${money(Math.round(t.exp / daysSoFar))}</b></div>
      <div><span>En çok harcanan gün</span><b>${maxDay ? `${fullDay(maxDay)} · ${money(byDay[maxDay].exp)}` : '—'}</b></div>
      <div><span>Harcamasız gün</span><b class="inc">${noSpend} gün</b></div>
    </div>`;
}

function openDay(iso) {
  const list = sortTx(db.transactions.filter((t) => t.date === iso));
  const t = totals(list);
  openSheet(`
    <div class="sheet-head"><h2>${esc(longDate(iso))}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    ${list.length ? `<p class="muted small" style="margin-top:-8px">Gider ${money(t.exp)}${t.inc ? ` · gelir ${money(t.inc)}` : ''}</p>
      <div class="list" style="border:0">${list.map((x) => txRow(x, catMap())).join('')}</div>`
    : '<p class="muted">Bu gün kayıt yok.</p>'}
    <button class="btn block" style="margin-top:12px" data-action="cal-add" data-date="${iso}">+ Bu güne işlem ekle</button>
  `);
}

/* ------------------------------ Yıl özeti ------------------------------ */

function yearData(y) {
  const per = { mode: 'custom', start: `${y}-01-01`, end: `${y}-12-31`, days: 365 };
  const list = db.transactions.filter((t) => t.date >= per.start && t.date <= per.end && !isPlanned(t));
  const t = totals(list);
  const months = Array.from({ length: 12 }, (_, m) => {
    const a = `${y}-${pad(m + 1)}`;
    const ml = list.filter((x) => x.date.startsWith(a));
    return { m, ...totals(ml) };
  });
  const active = months.filter((x) => x.inc || x.exp);
  const cats = byCategory(list, 'expense');
  const merchants = new Map();
  for (const x of list) if (x.type === 'expense' && x.note) {
    const k = learnKey(x.note);
    if (!k) continue;
    const e = merchants.get(k) || { name: x.note, sum: 0, n: 0 };
    e.sum += x.amount; e.n++;
    merchants.set(k, e);
  }
  const biggest = list.filter((x) => x.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
  const today = todayISO();
  const lastDay = `${y}-12-31` < today ? `${y}-12-31` : today;
  const spendDays = new Set(list.filter((x) => x.type === 'expense').map((x) => x.date));
  const firstDay = list.reduce((m, x) => (x.date < m ? x.date : m), lastDay);
  const daysCount = Math.max(0, dayDiff(fromISO(firstDay), fromISO(lastDay)) + 1);
  return {
    y, t, months, active, cats, biggest,
    merchants: [...merchants.values()].sort((a, b) => b.sum - a.sum).slice(0, 5),
    maxMonth: active.slice().sort((a, b) => b.exp - a.exp)[0],
    // Bitmemiş ay "en tasarruflu" sayılmasın
    minMonth: active.filter((x) => new Date(y, x.m + 1, 0) < fromISO(todayISO())).sort((a, b) => a.exp - b.exp)[0],
    noSpend: Math.max(0, daysCount - spendDays.size),
    saveRate: t.inc ? t.net / t.inc : null,
    subsYear: subscriptions().filter((s) => !s.paused).reduce((a, s) => a + s.yearly, 0),
  };
}

function viewYear() {
  const years = [...new Set(db.transactions.map((t) => Number(t.date.slice(0, 4))))].sort();
  if (!years.includes(ui.yearSel)) years.push(ui.yearSel);
  const Y = yearData(ui.yearSel);
  const nav = `<div class="month-nav">
    <button class="arrow" data-action="year-shift" data-dir="-1" aria-label="Önceki yıl">${icon('chevron-left', 20)}</button>
    <span class="label">${Y.y} yılı</span>
    <button class="arrow" data-action="year-shift" data-dir="1" aria-label="Sonraki yıl">${icon('chevron-right', 20)}</button>
  </div>`;
  if (!Y.active.length) return `${nav}<div class="card empty-card"><span class="empty-ico">${icon('party-popper', 26)}</span><b>${Y.y} için kayıt yok</b><p>Yıl boyunca girdiğin kayıtlar burada özetlenecek.</p></div>`;
  const bars = Y.months.map((x) => ({ label: MONTHS_SHORT[x.m], long: `${MONTHS[x.m]} ${Y.y}`, inc: x.inc, exp: x.exp }));
  return `${nav}
    <div class="hero year-hero">
      <small>${Y.y} yılında kalan</small>
      <div class="hero-num">${money(Y.t.net)}</div>
      <div class="hero-row">
        <span><i>${icon('arrow-down-left', 15)}</i><span><small>Gelir</small><b>${money(Y.t.inc)}</b></span></span>
        <span><i>${icon('arrow-up-right', 15)}</i><span><small>Gider</small><b>${money(Y.t.exp)}</b></span></span>
      </div>
      ${Y.saveRate != null ? `<div class="hero-budget"><span class="between"><span>Tasarruf oranı</span><span>%${Math.round(Y.saveRate * 100)}</span></span></div>` : ''}
    </div>
    <div class="card"><h3>Aylara göre</h3>${barChart(bars)}</div>
    <div class="card sum-list">
      ${Y.maxMonth ? `<div><span>En pahalı ay</span><b class="exp">${MONTHS[Y.maxMonth.m]} · ${money(Y.maxMonth.exp)}</b></div>` : ''}
      ${Y.minMonth && Y.active.length > 1 ? `<div><span>En tasarruflu ay</span><b class="inc">${MONTHS[Y.minMonth.m]} · ${money(Y.minMonth.exp)}</b></div>` : ''}
      ${Y.biggest ? `<div><span>En büyük tek harcama</span><b>${esc(Y.biggest.note || (catMap()[Y.biggest.categoryId] || MISSING_CAT).name)} · ${money(Y.biggest.amount)}</b></div>` : ''}
      <div><span>Harcamasız gün</span><b class="inc">${Y.noSpend} gün</b></div>
      ${Y.subsYear ? `<div><span>Aboneliklerin yıllık maliyeti</span><b>${money(Y.subsYear)}</b></div>` : ''}
    </div>
    <div class="card">
      <h3>En çok harcadığın kategoriler</h3>
      ${Y.cats.slice(0, 5).map((r, i) => `<div class="rank-row"><span class="rank">${i + 1}</span><span class="ico sm" style="--c:${col(r.cat.color)}">${glyph(r.cat.icon)}</span><span class="tx-main"><b>${esc(r.cat.name)}</b><small>%${Math.round((r.sum / Y.t.exp) * 100)} · ${r.count} işlem</small></span><b>${money(r.sum)}</b></div>`).join('')}
    </div>
    ${Y.merchants.length ? `<div class="card">
      <h3>En çok harcadığın yerler</h3>
      ${Y.merchants.map((m, i) => `<div class="rank-row"><span class="rank">${i + 1}</span><span class="tx-main"><b>${esc(m.name)}</b><small>${m.n} kez</small></span><b>${money(m.sum)}</b></div>`).join('')}
    </div>` : ''}`;
}

/* ------------------------------ Rapor ekranı ------------------------------ */

function viewReports() {
  const tab = ui.reportTab;
  const tabs = [['general', 'Genel'], ['compare', 'Karşılaştır'], ['calendar', 'Takvim'], ['year', 'Yıl']];
  return `${viewHead('Rapor', `<button class="btn small" data-action="pdf-open">${icon('file-text', 16)} PDF</button>`)}
    <div class="seg tabs">${tabs.map(([k, l]) => `<button data-action="report-tab" data-val="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${tab === 'compare' ? viewCompare() : tab === 'calendar' ? viewCalendar() : tab === 'year' ? viewYear() : viewReport()}`;
}

/* ------------------------------ PDF rapor ------------------------------ */

function openPdfDialog() {
  const months = lastMonths(6).reverse();
  openSheet(`
    <div class="sheet-head"><h2>Aylık PDF rapor</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <p class="muted small" style="margin-top:-6px">Ay seç; rapor hazırlanınca yazdırma ekranı açılır. Oradan <b>"PDF olarak kaydet"</b>i seç.</p>
    <div class="btn-stack">${months.map((p, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-action="pdf-make" data-anchor="${p.start}">${esc(p.label)}${i === 0 ? ' (bu ay)' : ''}</button>`).join('')}</div>
  `);
}

function pdfReport(anchor) {
  const per = getPeriod({ mode: 'month', anchor });
  const list = txIn(per).filter((t) => !isPlanned(t));
  const t = totals(list);
  const cats = byCategory(list, 'expense');
  const incs = byCategory(list, 'income');
  const { list: bks } = buckets({ ...per, mode: 'month' });
  const prevP = getPeriod(shiftedPeriod(-1, { mode: 'month', anchor }));
  const prevT = totals(txIn(prevP).filter((x) => !isPlanned(x)));
  const delta = (a, b) => (b ? `${a >= b ? '+' : '−'}%${Math.abs(Math.round(((a - b) / b) * 100))}` : '—');
  const L = localInsights();
  const top = list.filter((x) => x.type === 'expense').sort((a, b) => b.amount - a.amount).slice(0, 10);
  const cm = catMap();
  const budgets = db.budgets.map((b) => budgetStatus(b, per));
  const cards = db.accounts.filter((a) => a.kind === 'credit').map(cardStatus);
  const accs = db.accounts.filter((a) => a.kind !== 'credit');
  const debts = db.debts.map(debtStatus).filter((s) => !s.closed);
  const goals = db.goals.map(goalStatus);
  const recs = recItems(per).filter((it) => !it.carried);
  const bar = (v, max, c) => `<span class="p-bar"><i style="width:${max ? Math.min(100, (v / max) * 100).toFixed(1) : 0}%;background:${c}"></i></span>`;
  const isCurrent = todayISO() >= per.start && todayISO() <= per.end;

  return `<div class="p-doc">
    <header class="p-head">
      <div><div class="p-brand"><span class="brand-mark"></span> Bütçem</div><h1>${esc(per.label)} raporu</h1></div>
      <div class="p-meta">${esc(fullDay(per.start))} – ${esc(fullDay(per.end))}<br>Hazırlanma: ${esc(new Date().toLocaleString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}${isCurrent ? '<br><b>Ay henüz bitmedi</b>' : ''}</div>
    </header>

    <section class="p-kpis">
      <div><small>Gelir</small><b class="inc">${money(t.inc)}</b><span>Önceki ay ${delta(t.inc, prevT.inc)}</span></div>
      <div><small>Gider</small><b class="exp">${money(t.exp)}</b><span>Önceki ay ${delta(t.exp, prevT.exp)}</span></div>
      <div><small>Kalan</small><b>${money(t.net)}</b><span>${t.inc ? `Tasarruf oranı %${Math.round((t.net / t.inc) * 100)}` : '&nbsp;'}</span></div>
      <div><small>İşlem</small><b>${list.length}</b><span>Günlük ort. gider ${money(Math.round(t.exp / per.days))}</span></div>
    </section>

    <section><h2>Günlere göre gelir ve gider</h2>${barChart(bks)}</section>

    <section class="p-two">
      <div><h2>Giderler · kategoriler</h2>
        <table>${cats.map((r) => `<tr><td>${esc(r.cat.name)}</td><td class="p-w">${bar(r.sum, cats[0]?.sum, col(r.cat.color))}</td><td>%${t.exp ? Math.round((r.sum / t.exp) * 100) : 0}</td><td>${money(r.sum)}</td></tr>`).join('') || '<tr><td>Gider yok</td></tr>'}</table>
      </div>
      <div><h2>Gelirler</h2>
        <table>${incs.map((r) => `<tr><td>${esc(r.cat.name)}</td><td>${money(r.sum)}</td></tr>`).join('') || '<tr><td>Gelir yok</td></tr>'}</table>
        ${budgets.length ? `<h2 style="margin-top:18px">Bütçe limitleri</h2>
          <table>${budgets.map((s) => `<tr><td>${esc(budgetName(s.b))}</td><td>${money(s.spent)} / ${money(s.limit)}</td><td class="${s.level === 'over' ? 'exp' : ''}">%${Math.round(s.pct * 100)}</td></tr>`).join('')}</table>` : ''}
      </div>
    </section>

    <section><h2>En büyük 10 harcama</h2>
      <table class="p-list">${top.map((x) => `<tr><td>${esc(fullDay(x.date))}</td><td>${esc(x.note || (cm[x.categoryId] || MISSING_CAT).name)}</td><td>${esc((cm[x.categoryId] || MISSING_CAT).name)}</td><td>${esc(accById(x.accountId)?.name || '')}</td><td>${money(x.amount)}</td></tr>`).join('') || '<tr><td>Kayıt yok</td></tr>'}</table>
    </section>

    ${cards.length || accs.length || debts.length ? `<section class="p-two">
      <div><h2>Kartlar ve hesaplar (bugün)</h2>
        <table>${cards.map((s) => `<tr><td>${esc(s.a.name)} (kredi)</td><td>Borç ${money(s.debt)}</td><td>Limit ${money(s.limit)}</td></tr>`).join('')}${accs.map((a) => `<tr><td>${esc(a.name)}</td><td colspan="2">Bakiye ${money(accBalance(a))}</td></tr>`).join('')}</table>
      </div>
      <div><h2>Borç ve alacak</h2>
        <table>${debts.map((s) => `<tr><td>${esc(s.d.person)}</td><td>${isBorrowed(s.d) ? 'Borcum' : 'Alacağım'}</td><td>${money(s.remaining)}</td><td>${s.d.dueDate ? esc(fullDay(s.d.dueDate)) : ''}</td></tr>`).join('') || '<tr><td>Açık kayıt yok</td></tr>'}</table>
      </div>
    </section>` : ''}

    ${goals.length || recs.length ? `<section class="p-two">
      <div><h2>Birikim hedefleri</h2>
        <table>${goals.map((s) => `<tr><td>${esc(s.g.name)}</td><td class="p-w">${bar(s.saved, s.g.target, 'var(--inc)')}</td><td>${money(s.saved)} / ${money(s.g.target)}</td></tr>`).join('') || '<tr><td>Hedef yok</td></tr>'}</table>
      </div>
      <div><h2>Düzenli gelir ve giderler</h2>
        <table>${recs.map((it) => `<tr><td>${esc(recName(it.rec))}</td><td>${esc(fullDay(it.due))}</td><td>${it.state === 'done' ? (it.rec.type === 'income' ? 'Geldi' : 'Ödendi') : it.state === 'skipped' ? 'Atlandı' : 'Bekliyor'}</td><td>${money(it.state === 'done' ? it.tx.amount : it.rec.amount)}</td></tr>`).join('') || '<tr><td>Kayıt yok</td></tr>'}</table>
      </div>
    </section>` : ''}

    ${isCurrent && L.hasData ? `<section><h2>Değerlendirme · ${L.score}/100 (${esc(L.label)})</h2>
      <p>${esc(L.summary)}</p>
      <ul>${L.findings.map((f) => `<li>${esc(f.text)}</li>`).join('')}</ul>
      ${L.tips.length ? `<h3>Öneriler</h3><ul>${L.tips.map((o) => `<li><b>${esc(o.title)}:</b> ${esc(o.text)}</li>`).join('')}</ul>` : ''}
    </section>` : ''}
    <footer class="p-foot">Bütçem · ${esc(per.label)} · Tutarlar ${esc(db.settings.currency)}</footer>
  </div>`;
}

function makePdf(anchor) {
  let root = $('#print-root');
  if (!root) { root = document.createElement('div'); root.id = 'print-root'; document.body.appendChild(root); }
  root.innerHTML = pdfReport(anchor);
  closeSheet();
  const title = document.title;
  document.title = `Butcem-rapor-${getPeriod({ mode: 'month', anchor }).start.slice(0, 7)}`;
  setTimeout(() => {
    window.print();
    setTimeout(() => { document.title = title; root.innerHTML = ''; }, 500);
  }, 350);
}

/* ------------------------------ olaylar ------------------------------ */

VIEWS.report = viewReports;

Object.assign(actions, {
  'report-tab': (el) => { ui.reportTab = el.dataset.val; render(); },
  'cal-shift': (el) => { ui.calAnchor = shiftedPeriod(Number(el.dataset.dir), { mode: 'month', anchor: ui.calAnchor }).anchor; render(); },
  'cal-today': () => { ui.calAnchor = todayISO(); render(); },
  'cal-day': (el) => openDay(el.dataset.date),
  'cal-add': (el) => openTxForm({ date: el.dataset.date }),
  'year-shift': (el) => { ui.yearSel += Number(el.dataset.dir); render(); },
  'pdf-open': () => openPdfDialog(),
  'pdf-make': (el) => makePdf(el.dataset.anchor),
});
