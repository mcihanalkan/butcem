'use strict';

/* =====================================================================
   Bütçe: aylık limitler, takip, ay sonu tahmini, uyarılar ve öneriler.
   Bütçe ayı "ay başlangıç günü" ayarına uyar (ör. 9 Eki – 8 Kas).
   app.js'teki ortak yardımcıları (db, ui, getPeriod, money …) kullanır.
   ===================================================================== */

ui.budgetAnchor = todayISO();

const ALERT_LEVELS = [50, 70, 80, 90];
const LEVEL_META = {
  over: { label: 'Aşıldı', order: 0 },
  warn: { label: 'Sınıra yakın', order: 1 },
  pace: { label: 'Hızlı gidiyor', order: 2 },
  ok: { label: 'Yolunda', order: 3 },
};

const budgetPeriod = (anchor = ui.budgetAnchor) => getPeriod({ mode: 'month', anchor });
const budgetName = (b) => (b.scope === 'total' ? 'Toplam harcama' : (catMap()[b.categoryId] || MISSING_CAT).name);
const budgetIcon = (b) => (b.scope === 'total' ? 'lc:target' : (catMap()[b.categoryId] || MISSING_CAT).icon);
const budgetColor = (b) => (b.scope === 'total' ? 'var(--accent)' : (catMap()[b.categoryId] || MISSING_CAT).color);
const shortDay = (iso) => { const d = fromISO(iso); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };
const pctText = (p) => `%${Math.round(p * 100)}`;

// Ayda bir ödenen sabit giderler: ay sonu tahmininde "her gün tekrar ediyormuş" gibi hesaplanmaz.
const FIXED_CATS = new Set(['Kira', 'Aidat', 'Elektrik', 'Su', 'Doğalgaz', 'İnternet', 'Telefon faturası', 'Abonelikler', 'Sigorta', 'Vergi / Harç', 'Kredi kartı ödemesi', 'Kredi / Borç', 'Eğitim / Kurs'].map((n) => defCatId('expense', n)));

function spentSplit(per, b) {
  let fixed = 0, variable = 0, future = 0;
  for (const t of db.transactions) {
    if (t.type !== 'expense' || t.date < per.start || t.date > per.end) continue;
    if (b.scope !== 'total' && t.categoryId !== b.categoryId) continue;
    if (isPlanned(t)) { future += t.amount; continue; } // ileri tarihli: tahmine eklenir, harcanana değil
    if (FIXED_CATS.has(t.categoryId)) fixed += t.amount;
    else variable += t.amount;
  }
  return { fixed, variable, future, total: fixed + variable };
}
const spentIn = (per, b) => spentSplit(per, b).total;

/* Bir limitin verilen bütçe ayındaki durumunu hesaplar. */
function budgetStatus(b, per = budgetPeriod()) {
  const split = spentSplit(per, b);
  const spent = split.total;
  let carry = 0;
  if (b.rollover) {
    const prev = getPeriod(shiftedPeriod(-1, { mode: 'month', anchor: per.start }));
    const existed = (b.createdAt || 0) <= fromISO(prev.end).getTime() + 864e5;
    if (existed) carry = Math.max(0, b.amount - spentIn(prev, b));
  }
  const limit = b.amount + carry;
  const today = todayISO();
  const isCurrent = today >= per.start && today <= per.end;
  const isPast = today > per.end;
  const elapsed = isPast ? per.days : isCurrent ? dayDiff(fromISO(per.start), fromISO(today)) + 1 : 0;
  const daysLeft = isCurrent ? per.days - elapsed + 1 : 0; // bugün dahil
  const pct = limit > 0 ? spent / limit : spent > 0 ? 1 : 0;
  const expectedPct = per.days ? elapsed / per.days : 0;
  // Tahmin: sabit giderler olduğu gibi + değişken giderlerin günlük ortalaması × ayın gün sayısı
  // + bu ay henüz ödenmemiş düzenli giderler (kira, fatura…)
  const planned = isCurrent ? plannedPending(per, b) : 0;
  const projected = isPast ? spent : isCurrent && elapsed >= 3 ? split.fixed + split.future + planned + Math.round((split.variable / elapsed) * per.days) : null;
  const remaining = limit - spent;
  const daily = isCurrent && remaining > 0 ? Math.floor(remaining / daysLeft) : 0;
  let fullDate = null; // bu hızla limitin dolacağı gün
  if (isCurrent && split.variable > 0 && remaining > 0 && elapsed >= 3) {
    const d = addDays(fromISO(today), Math.ceil(remaining / (split.variable / elapsed)));
    if (toISO(d) <= per.end) fullDate = toISO(d);
  }
  const alertAt = (b.alertAt || 80) / 100;
  // Sabit gider kategorisi (kira, fatura…) tek seferde ödenir: sadece aşım uyarısı anlamlı.
  const fixedOnly = b.scope === 'cat' && FIXED_CATS.has(b.categoryId);
  let level = 'ok';
  if (pct >= 1 && !(fixedOnly && spent === limit)) level = 'over';
  else if (fixedOnly) level = 'ok';
  else if (pct >= alertAt) level = 'warn';
  else if (isCurrent && elapsed >= 5 && projected > limit * 1.05) level = 'pace';
  return { b, per, spent, limit, carry, pct, expectedPct, projected, remaining, daily, daysLeft, elapsed, isCurrent, isPast, fullDate, level, fixedOnly };
}

function statusMessage(s) {
  switch (s.level) {
    case 'over':
      return s.remaining === 0 ? 'Limit tam doldu.' : `Limit ${money(-s.remaining)} aşıldı.`;
    case 'warn':
      return `Limitin ${pctText(s.pct)} kadarı kullanıldı. Kalan ${money(s.remaining)}${s.isCurrent ? `, günde ${money(s.daily)}` : ''}.`;
    case 'pace':
      return `Bu hızla ay sonunda ${money(s.projected)} olacak (${money(s.projected - s.limit)} fazla)${s.fullDate ? `, limit ${shortDay(s.fullDate)} civarı dolar` : ''}.`;
    default:
      if (s.fixedOnly && s.spent > 0) return `${money(s.spent)} ödendi (limit ${money(s.limit)}).`;
      if (s.isPast) return `${money(s.remaining)} tasarruf edildi.`;
      if (!s.isCurrent) return `Limit ${money(s.limit)}.`;
      return `Kalan ${money(s.remaining)} · günde ${money(s.daily)} harcayabilirsin.`;
  }
}

const sortStatuses = (list) => [...list].sort((a, b) => LEVEL_META[a.level].order - LEVEL_META[b.level].order || b.pct - a.pct);

/* ------------------------------ geçmiş ------------------------------ */

function pastMonths(n, anchor = ui.budgetAnchor) {
  const out = [];
  let p = { mode: 'month', anchor };
  for (let i = 0; i < n; i++) { p = shiftedPeriod(-1, p); out.push(getPeriod(p)); }
  return out;
}

// Son 3 bütçe ayındaki ortalama harcama (uygulama kullanılmaya başlanmadan önceki aylar sayılmaz).
function historyAvg(match, anchor = ui.budgetAnchor) {
  const first = db.transactions.reduce((m, t) => (t.date < m ? t.date : m), '9999');
  const months = pastMonths(3, anchor).filter((p) => p.end >= first);
  if (!months.length) return null;
  let sum = 0;
  for (const p of months) for (const t of txIn(p)) if (t.type === 'expense' && match(t)) sum += t.amount;
  return Math.round(sum / months.length);
}

function roundNice(k) {
  const v = k / 100;
  const step = v < 1000 ? 50 : v < 10000 ? 100 : 500;
  return Math.ceil(v / step) * step * 100;
}

function suggestFor(scope, categoryId) {
  const avg = historyAvg((t) => scope === 'total' || t.categoryId === categoryId);
  return avg ? { avg, amount: roundNice(avg * 1.05) } : null;
}

// Harcaması olduğu halde limiti olmayan kategoriler (bu ay)
function unbudgeted(per) {
  const has = new Set(db.budgets.filter((b) => b.scope === 'cat').map((b) => b.categoryId));
  // Kira, fatura gibi sabit giderler hariç: onlar Düzenli bölümünde takip ediliyor
  return byCategory(txIn(per), 'expense').filter((r) => !has.has(r.id) && !FIXED_CATS.has(r.id));
}

// Kategorideki tipik tutarın kaç katı (en az 6 örnek, en az 500 ₺ fark)
function unusualFactor(t) {
  const same = db.transactions.filter((x) => x.type === 'expense' && x.categoryId === t.categoryId).map((x) => x.amount).sort((a, b) => a - b);
  if (same.length < 6) return 0;
  const med = same[Math.floor(same.length / 2)];
  return med > 0 && t.amount >= med * 3 && t.amount - med >= 50000 ? Math.round(t.amount / med) : 0;
}

/* ------------------------- kayıt anı uyarıları ------------------------- */

function budgetSnapshot(date) {
  const per = budgetPeriod(date);
  return { per, map: Object.fromEntries(db.budgets.map((b) => [b.id, budgetStatus(b, per)])) };
}

function budgetWarningsAfterSave(before, data) {
  const per = budgetPeriod(data.date);
  const lines = [];
  for (const b of db.budgets) {
    if (b.scope === 'cat' && b.categoryId !== data.categoryId) continue;
    const s = budgetStatus(b, per);
    const prev = before.per.start === per.start ? before.map[b.id] : null;
    const prevPct = prev ? prev.pct : 0;
    const name = budgetName(b);
    const at = (b.alertAt || 80) / 100;
    if (s.level === 'over') {
      lines.push({ level: 'over', text: prevPct < 1 ? `${name} limitini aştın! ${money(s.spent)} / ${money(s.limit)}` : `${name} limiti zaten aşılmış: toplam aşım ${money(-s.remaining)}` });
    } else if (s.level === 'warn') {
      lines.push({ level: 'warn', text: prevPct < at ? `${name} limitinde ${pctText(s.pct)} seviyesine ulaştın. Kalan ${money(s.remaining)}${s.isCurrent ? `, günde ${money(s.daily)}` : ''}` : `${name}: kalan ${money(s.remaining)} (${pctText(s.pct)} kullanıldı)` });
    } else if (s.level === 'pace') {
      lines.push({ level: 'pace', text: `${name}: bu hızla ay sonunda limiti ${money(s.projected - s.limit)} aşacaksın` });
    }
  }
  const factor = unusualFactor(data);
  if (factor) lines.push({ level: 'info', text: `Bu ${(catMap()[data.categoryId] || MISSING_CAT).name} harcaması normalin yaklaşık ${factor} katı.` });
  return lines.sort((a, b) => ['over', 'warn', 'pace', 'info'].indexOf(a.level) - ['over', 'warn', 'pace', 'info'].indexOf(b.level));
}

let alertTimer;
function alertToast(lines) {
  const root = $('#toast-root');
  const top = lines[0].level;
  root.innerHTML = `<div class="toast alert ${top}" data-action="alert-close">
    <div class="alert-lines">${lines.map((l) => `<div>${esc(l.text)}</div>`).join('')}</div>
    <button data-action="alert-budget">Bütçe ›</button>
  </div>`;
  clearTimeout(alertTimer);
  clearTimeout(toastTimer);
  alertTimer = setTimeout(() => (root.innerHTML = ''), 8000);
}

/* ------------------------------ parçalar ------------------------------ */

function budgetBar(s) {
  const w = Math.min(s.pct, 1) * 100;
  return `<div class="bbar ${s.level}"><i style="width:${w.toFixed(1)}%"></i>${s.isCurrent ? `<em style="left:${(s.expectedPct * 100).toFixed(1)}%" title="Bugün itibarıyla olması gereken"></em>` : ''}</div>`;
}

function levelChip(level) {
  return `<span class="lchip ${level}"><i></i>${LEVEL_META[level].label}</span>`;
}

function budgetRow(s) {
  const b = s.b;
  const right = s.level === 'over' ? `<b class="exp">${moneyRound(-s.remaining)} aşıldı</b>` : `<span class="muted">${moneyRound(s.remaining)} kaldı</span>`;
  return `<button class="brow" data-action="bud-edit" data-id="${b.id}">
    <span class="ico" style="--c:${col(budgetColor(b))}">${glyph(budgetIcon(b))}</span>
    <span class="brow-main">
      <span class="between"><b>${esc(budgetName(b))}</b><span class="brow-nums"><b>${moneyRound(s.spent)}</b> / ${moneyRound(s.limit)}</span></span>
      ${budgetBar(s)}
      <span class="between brow-nums"><span>${s.level === 'pace' ? 'Hızlı gidiyor' : s.level === 'warn' ? 'Sınıra yakın' : s.carry ? `+${moneyRound(s.carry)} devreden` : ''}</span>${right}</span>
    </span>
  </button>`;
}

// Toplam limit yoksa kategori limitlerinin toplamı gösterilir
function overallStatus(per) {
  const total = db.budgets.find((b) => b.scope === 'total');
  if (total) return { s: budgetStatus(total, per), label: 'Toplam bütçe' };
  const cats = db.budgets.filter((b) => b.scope === 'cat');
  if (!cats.length) return null;
  // Sadece limitli kategorilerin toplamı
  const parts = cats.map((b) => budgetStatus(b, per));
  const s = { ...parts[0], b: { scope: 'total', amount: 0 }, carry: 0, fullDate: null };
  s.spent = parts.reduce((a, p) => a + p.spent, 0);
  s.limit = parts.reduce((a, p) => a + p.limit, 0);
  s.projected = parts.every((p) => p.projected != null) ? parts.reduce((a, p) => a + p.projected, 0) : null;
  s.pct = s.limit > 0 ? s.spent / s.limit : 0;
  s.remaining = s.limit - s.spent;
  s.daily = s.isCurrent && s.remaining > 0 ? Math.floor(s.remaining / s.daysLeft) : 0;
  s.level = s.pct >= 1 ? 'over' : s.pct >= 0.8 ? 'warn' : s.isCurrent && s.elapsed >= 5 && s.projected > s.limit * 1.05 ? 'pace' : 'ok';
  return { s, label: 'Limitli kategoriler toplamı' };
}

/* ------------------------------ ortak parçalar ------------------------------ */

// Ay seçici: ‹ 9 Eki – 8 Kas ›  (prefix-shift / prefix-today eylemleri)
function monthNav(per, prefix) {
  return `<div class="month-nav">
    <button class="arrow" data-action="${prefix}-shift" data-dir="-1" aria-label="Önceki ay">${icon('chevron-left', 20)}</button>
    <button class="label" data-action="${prefix}-today" title="Bu aya dön">${esc(per.label)}</button>
    <button class="arrow" data-action="${prefix}-shift" data-dir="1" aria-label="Sonraki ay">${icon('chevron-right', 20)}</button>
  </div>`;
}

// Özet ekranındaki küçük bütçe çubuğu
function budgetMini() {
  if (!db.budgets.length) return '';
  const o = overallStatus(budgetPeriod(todayISO()));
  if (!o) return '';
  const s = o.s;
  const right = s.remaining < 0 ? `${moneyRound(-s.remaining)} aşıldı` : s.isCurrent ? `Günde ${moneyRound(s.daily)}` : '';
  return `<button class="hero-budget" data-action="nav" data-view="budget">
    <span class="between"><span>Bütçe ${pctText(s.pct)}</span><span>${right}</span></span>
    ${budgetBar(s)}
  </button>`;
}

// Özet ekranındaki "yapılacaklar" için: aşılan ve sınıra yaklaşan limitler
function budgetAttention() {
  const per = budgetPeriod(todayISO());
  return sortStatuses(db.budgets.map((b) => budgetStatus(b, per))).filter((s) => s.level === 'over' || s.level === 'warn');
}

/* ------------------------------ Bütçe ekranı ------------------------------ */

function viewBudget() {
  const per = budgetPeriod();
  const nav = monthNav(per, 'bud');

  if (!db.budgets.length) {
    const plan = autoPlan();
    return `${nav}
      <div class="card empty-card">
        <span class="empty-ico">${icon('target', 26)}</span>
        <b>Henüz limit yok</b>
        <p>Kategorilere aylık limit koy; yaklaşınca, aşınca ve hızlı harcadığında uyarayım.</p>
        <div class="btn-stack">
          ${plan.length ? `<button class="btn primary" data-action="bud-auto">Geçmişime göre öner</button>` : ''}
          <button class="btn ${plan.length ? '' : 'primary'}" data-action="bud-new">+ Limit ekle</button>
        </div>
      </div>
      ${aiCard()}`;
  }

  const statuses = sortStatuses(db.budgets.filter((b) => b.scope === 'cat').map((b) => budgetStatus(b, per)));
  const o = overallStatus(per);
  const s = o.s;
  const free = unbudgeted(per);
  const freeSum = free.reduce((a, r) => a + r.sum, 0);
  const alerts = budgetAlertList(per, statuses, free);
  const shown = ui.budAllAlerts ? alerts : alerts.slice(0, 3);

  return `${nav}
    <div class="card">
      <div class="between"><span class="muted small">${o.label}</span>${levelChip(s.level)}</div>
      <div class="big-num">${money(s.spent)}<span> / ${moneyRound(s.limit)}</span></div>
      ${budgetBar(s)}
      <div class="kpi-row">
        <div><small>Kalan</small><b class="${s.remaining >= 0 ? 'inc' : 'exp'}">${moneyRound(s.remaining)}</b></div>
        ${s.isCurrent ? `<div><small>Günlük</small><b>${moneyRound(s.daily)}</b></div>` : ''}
        ${s.projected != null ? `<div><small>${s.isPast ? 'Ay sonu' : 'Ay sonu tahmini'}</small><b class="${s.projected > s.limit ? 'exp' : ''}">${moneyRound(s.projected)}</b></div>` : ''}
      </div>
    </div>
    ${alerts.length ? `<div class="card">
      <h3>Dikkat</h3>
      <ul class="alerts">${shown.join('')}</ul>
      ${alerts.length > 3 ? `<button class="link" style="margin-top:8px" data-action="bud-all-alerts">${ui.budAllAlerts ? 'Daha az göster' : `Tümünü göster (${alerts.length})`}</button>` : ''}
    </div>` : ''}
    <div class="card">
      <div class="between" style="margin-bottom:2px"><h3 style="margin:0">Kategori limitleri</h3><button class="link" data-action="bud-new">+ Ekle</button></div>
      ${statuses.length ? statuses.map(budgetRow).join('') : '<p class="muted small">Henüz kategori limiti yok.</p>'}
      ${free.length ? `<button class="free-line" data-action="bud-free">${free.length} kategoride limit yok · ${moneyRound(freeSum)} harcandı <span>›</span></button>` : ''}
    </div>
    ${aiCard()}`;
}

function budgetAlertList(per, statuses, free) {
  const items = [];
  const li = (level, html) => items.push(`<li class="${level}">${html}</li>`);
  const total = db.budgets.find((b) => b.scope === 'total');
  if (total) {
    const ts = budgetStatus(total, per);
    if (ts.level !== 'ok') li(ts.level, `<b>Toplam:</b> ${esc(statusMessage(ts))}`);
  }
  for (const st of statuses) if (st.level !== 'ok') li(st.level, `<b>${esc(budgetName(st.b))}:</b> ${esc(statusMessage(st))}`);
  for (const t of txIn(per).filter((x) => x.type === 'expense' && unusualFactor(x)).slice(0, 2)) {
    li('info', `${shortDay(t.date)} ${esc((catMap()[t.categoryId] || MISSING_CAT).name)} harcaması (${moneyRound(t.amount)}) normalin ~${unusualFactor(t)} katı.`);
  }
  if (total) {
    const catSum = db.budgets.filter((b) => b.scope === 'cat').reduce((a, b) => a + b.amount, 0);
    if (catSum > total.amount) li('pace', `Kategori limitlerinin toplamı (${moneyRound(catSum)}) toplam bütçeyi aşıyor.`);
    const inc = totals(txIn(per)).inc;
    if (inc > 0 && total.amount > inc) li('pace', `Toplam bütçe bu ayki gelirinden (${moneyRound(inc)}) yüksek.`);
  }
  return items;
}

function openFreeList() {
  const free = unbudgeted(budgetPeriod());
  openSheet(`
    <div class="sheet-head"><h2>Limitsiz harcamalar</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <p class="muted small" style="margin-top:0">Bu ay harcama yaptığın ama limit koymadığın kategoriler.</p>
    ${free.map((r) => {
      const sug = suggestFor('cat', r.id);
      return `<div class="free-row"><span class="ico" style="--c:${col(r.cat.color)}">${glyph(r.cat.icon)}</span>
        <span style="flex:1;min-width:0"><b>${esc(r.cat.name)}</b><small class="muted" style="display:block">${moneyRound(r.sum)} harcandı${sug ? ` · öneri ${moneyRound(sug.amount)}` : ''}</small></span>
        <button class="btn small" data-action="bud-quick" data-id="${r.id}">Limit koy</button></div>`;
    }).join('')}
  `);
}

/* ------------------------------ limit formu ------------------------------ */

let budForm = null;

function openBudgetForm(init = {}) {
  const hasTotal = db.budgets.some((b) => b.scope === 'total');
  budForm = { id: null, scope: 'cat', categoryId: null, amountText: '', alertAt: 80, rollover: false, ...init };
  if (!budForm.id && budForm.scope === 'total' && hasTotal) budForm.scope = 'cat';
  renderBudgetForm();
}

function syncBudForm() {
  const a = $('#b-amount');
  if (a && budForm) budForm.amountText = a.value;
  const r = $('#b-roll');
  if (r && budForm) budForm.rollover = r.checked;
}

function renderBudgetForm() {
  const f = budForm;
  const hasTotal = db.budgets.some((b) => b.scope === 'total' && b.id !== f.id);
  const taken = new Set(db.budgets.filter((b) => b.scope === 'cat' && b.id !== f.id).map((b) => b.categoryId));
  const usage = usageCounts();
  const cats = db.categories.filter((c) => c.type === 'expense' && !taken.has(c.id)).sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0));
  const sug = f.scope === 'total' || f.categoryId ? suggestFor(f.scope, f.categoryId) : null;
  const per = budgetPeriod(todayISO());
  const nowSpent = f.scope === 'total' || f.categoryId ? spentIn(per, { scope: f.scope, categoryId: f.categoryId }) : 0;
  const editing = !!f.id;
  openSheet(`
    <div class="sheet-head"><h2>${editing ? 'Limiti düzenle' : 'Yeni limit'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    ${editing ? '' : `<div class="seg field">
      <button data-action="bud-scope" data-val="cat" class="${f.scope === 'cat' ? 'on' : ''}">Kategori limiti</button>
      <button data-action="bud-scope" data-val="total" class="${f.scope === 'total' ? 'on' : ''}" ${hasTotal ? 'disabled title="Zaten bir toplam limit var"' : ''}>Toplam aylık limit</button>
    </div>`}
    ${f.scope === 'cat' ? `<div class="field"><label>Kategori</label>
      ${editing ? `<div class="preview" style="margin:0"><span class="ico" style="--c:${col(budgetColor(f))}">${glyph(budgetIcon(f))}</span><b>${esc(budgetName(f))}</b></div>`
        : `<div class="cat-grid">${cats.map((c) => `<button class="cat-tile ${f.categoryId === c.id ? 'on' : ''}" style="--c:${col(c.color)}" data-action="bud-cat" data-id="${c.id}"><span>${glyph(c.icon)}</span><em>${esc(c.name)}</em></button>`).join('')}</div>`}
    </div>` : `<p class="muted" style="font-size:13px;margin-top:0">Ay içindeki tüm giderlerin toplamı için üst sınır.</p>`}
    <div class="field"><label>Aylık limit</label>
      <div class="amount-field"><input id="b-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amountText)}"><span>${esc(db.settings.currency)}</span></div>
      <div class="chips" style="flex-wrap:wrap">
        ${sug ? `<button class="chip" data-action="bud-suggest" data-val="${sug.amount}">Öneri: ${moneyRound(sug.amount)}</button><span class="chip ghost">Son 3 ay ort.: ${moneyRound(sug.avg)}</span>` : ''}
        ${nowSpent ? `<span class="chip ghost">Bu ay şu ana kadar: ${moneyRound(nowSpent)}</span>` : ''}
      </div>
    </div>
    <div class="field"><label>Uyarı eşiği: limitin yüzde kaçında uyarayım?</label>
      <div class="seg">${ALERT_LEVELS.map((v) => `<button data-action="bud-alert" data-val="${v}" class="${f.alertAt === v ? 'on' : ''}">%${v}</button>`).join('')}</div>
    </div>
    <label class="check"><input type="checkbox" id="b-roll" ${f.rollover ? 'checked' : ''}><span><b>Artan devretsin</b><small>Bir ay limitin altında kalırsan, kalan para sonraki ayın limitine eklenir.</small></span></label>
    <div class="actions">
      ${editing ? `<button class="btn danger" data-action="bud-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="bud-save">Kaydet</button>
    </div>
  `);
}

function upsertBudget({ id, scope, categoryId, amount, alertAt = 80, rollover = false }) {
  const now = Date.now();
  let b = id ? db.budgets.find((x) => x.id === id) : scope === 'cat' ? db.budgets.find((x) => x.scope === 'cat' && x.categoryId === categoryId) : db.budgets.find((x) => x.scope === 'total');
  if (b) Object.assign(b, { amount, alertAt, rollover, updatedAt: now });
  else {
    b = { id: uid(), scope, categoryId: scope === 'cat' ? categoryId : null, amount, alertAt, rollover, createdAt: now, updatedAt: now };
    db.budgets.push(b);
    db.deleted = db.deleted.filter((d) => d.id !== b.id);
  }
  touch('bud', b.id);
  return b;
}

function saveBudget() {
  syncBudForm();
  const f = budForm;
  const amount = parseAmount(f.amountText);
  if (f.scope === 'cat' && !f.categoryId) { toast('Bir kategori seç'); return; }
  if (!(amount > 0)) { $('#b-amount')?.classList.add('invalid'); toast('Geçerli bir limit gir'); return; }
  upsertBudget({ ...f, amount });
  save();
  closeSheet();
  render();
  toast('Limit kaydedildi');
}

function deleteBudget() {
  const b = db.budgets.find((x) => x.id === budForm.id);
  if (!b || !confirm(`"${budgetName(b)}" limiti silinsin mi? (Harcamaların silinmez.)`)) return;
  db.budgets = db.budgets.filter((x) => x.id !== b.id);
  db.deleted.push({ id: b.id, kind: 'bud', at: Date.now(), data: b });
  touch('bud', b.id);
  save();
  closeSheet();
  render();
  toast('Limit silindi');
}

/* --------------------------- otomatik bütçe --------------------------- */

function autoPlan() {
  const anchor = todayISO();
  const rows = db.categories.filter((c) => c.type === 'expense').map((c) => {
    const avg = historyAvg((t) => t.categoryId === c.id, anchor);
    return avg ? { scope: 'cat', categoryId: c.id, avg, amount: roundNice(avg * 1.05) } : null;
  }).filter(Boolean).sort((a, b) => b.avg - a.avg).slice(0, 15);
  if (!rows.length) return [];
  const totalAvg = historyAvg(() => true, anchor);
  // Toplam limit, kategori limitlerinin toplamından düşük olmasın
  const catSum = rows.reduce((a, r) => a + r.amount, 0);
  if (totalAvg) rows.unshift({ scope: 'total', categoryId: null, avg: totalAvg, amount: Math.max(roundNice(totalAvg * 1.05), catSum) });
  return rows;
}

function openAutoPlan() {
  const plan = autoPlan();
  if (!plan.length) { toast('Öneri için yeterli geçmiş harcama yok'); return; }
  openSheet(`
    <div class="sheet-head"><h2>Önerilen bütçe</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <p class="muted" style="font-size:13px;margin-top:0">Son 3 aydaki ortalama harcamana göre hazırlandı (kategori limitlerine %5 pay eklendi). İstemediklerinin işaretini kaldır, tutarları sonra da değiştirebilirsin.</p>
    <div class="plan">${plan.map((p, i) => `<label class="check">
      <input type="checkbox" data-plan="${i}" checked>
      <span class="ico" style="--c:${col(budgetColor(p))}">${glyph(budgetIcon(p))}</span>
      <span style="flex:1"><b>${esc(budgetName(p))}</b><small>Ortalama ${moneyRound(p.avg)}</small></span>
      <b>${moneyRound(p.amount)}</b>
    </label>`).join('')}</div>
    <div class="actions"><button class="btn primary" data-action="bud-auto-apply">Seçilenleri uygula</button></div>
  `);
}

function applyAutoPlan() {
  const plan = autoPlan();
  let n = 0;
  $$('[data-plan]').forEach((el) => { if (el.checked && plan[el.dataset.plan]) { upsertBudget(plan[el.dataset.plan]); n++; } });
  save();
  closeSheet();
  render();
  toast(`${n} limit eklendi`);
}

/* ------------------------------ olaylar ------------------------------ */

Object.assign(actions, {
  'bud-new': () => openBudgetForm(),
  'bud-edit': (el) => {
    const b = db.budgets.find((x) => x.id === el.dataset.id);
    if (b) openBudgetForm({ id: b.id, scope: b.scope, categoryId: b.categoryId, amountText: amountToInput(b.amount), alertAt: b.alertAt || 80, rollover: !!b.rollover });
  },
  'bud-quick': (el) => {
    const sug = suggestFor('cat', el.dataset.id);
    openBudgetForm({ categoryId: el.dataset.id, amountText: sug ? amountToInput(sug.amount) : '' });
  },
  'bud-scope': (el) => { syncBudForm(); budForm.scope = el.dataset.val; budForm.categoryId = null; renderBudgetForm(); },
  'bud-cat': (el) => { syncBudForm(); budForm.categoryId = el.dataset.id; renderBudgetForm(); },
  'bud-alert': (el) => { budForm.alertAt = Number(el.dataset.val); $$('[data-action="bud-alert"]').forEach((b) => b.classList.toggle('on', b === el)); },
  'bud-suggest': (el) => { $('#b-amount').value = amountToInput(Number(el.dataset.val)); },
  'bud-save': () => saveBudget(),
  'bud-delete': () => deleteBudget(),
  'bud-shift': (el) => { ui.budgetAnchor = shiftedPeriod(Number(el.dataset.dir), { mode: 'month', anchor: ui.budgetAnchor }).anchor; render(); },
  'bud-today': () => { ui.budgetAnchor = todayISO(); render(); },
  'bud-auto': () => openAutoPlan(),
  'bud-free': () => openFreeList(),
  'bud-all-alerts': () => { ui.budAllAlerts = !ui.budAllAlerts; render(); },
  'bud-auto-apply': () => applyAutoPlan(),
  'alert-close': () => { $('#toast-root').innerHTML = ''; },
  'alert-budget': () => { $('#toast-root').innerHTML = ''; ui.view = 'budget'; ui.budgetAnchor = todayISO(); render(); window.scrollTo(0, 0); },
});
