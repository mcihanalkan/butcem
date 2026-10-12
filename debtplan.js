'use strict';

/* =====================================================================
   Borç kapatma planı
   - Kredi kartı borçları ve kişilere olan borçlar; aylık faiz oranı girilebilir.
   - Her ay: faiz eklenir → asgari ödemeler yapılır → kalan para sıradaki borca gider.
   - İki yöntem yan yana: "Faizi yüksek önce" (en az faiz) ve "Küçük borç önce" (hızlı kapanır).
   ===================================================================== */

ui.planMethod = ui.planMethod || 'rate';

function planDebts() {
  const out = [];
  for (const a of db.accounts) {
    if (a.kind !== 'credit') continue;
    const bal = accBalance(a);
    if (bal > 0) out.push({ key: `a:${a.id}`, kind: 'card', ref: a, name: a.name, balance: bal, rate: a.rate || 0, minPct: a.minPct || 20 });
  }
  for (const d of db.debts) {
    if (!isBorrowed(d)) continue;
    const s = debtStatus(d);
    if (s.closed || s.remaining <= 0) continue;
    // Vadesi varsa kalan aylara bölünmüş tutar asgari sayılır
    const months = d.dueDate ? Math.max(1, Math.ceil(dayDiff(fromISO(todayISO()), fromISO(d.dueDate)) / 30)) : 0;
    out.push({ key: `d:${d.id}`, kind: 'person', ref: d, name: d.person, balance: s.remaining, rate: d.rate || 0, minFixed: months ? Math.ceil(s.remaining / months) : 0 });
  }
  return out;
}

const minPay = (x) => Math.min(x.bal, x.kind === 'card' ? Math.max(Math.round((x.bal * x.minPct) / 100), Math.min(x.bal, 10000)) : x.minFixed || 0);

// Aylık simülasyon (en fazla 30 yıl)
function simulate(debts, budget, method) {
  const list = debts.map((d) => ({ ...d, bal: d.balance, interest: 0, paidOff: null, first: [] }));
  const order = () => list.filter((x) => x.bal > 0).sort(method === 'rate'
    ? (a, b) => b.rate - a.rate || a.bal - b.bal
    : (a, b) => a.bal - b.bal || b.rate - a.rate);
  let month = 0, totalInterest = 0;
  const firstMonth = [];
  while (list.some((x) => x.bal > 0) && month < 360) {
    month++;
    for (const x of list) if (x.bal > 0 && x.rate) { const i = Math.round((x.bal * x.rate) / 100); x.bal += i; x.interest += i; totalInterest += i; }
    let left = budget;
    const pay = new Map();
    for (const x of list) if (x.bal > 0) { const m = Math.min(minPay(x), left); x.bal -= m; left -= m; pay.set(x, m); }
    for (const x of order()) { if (left <= 0) break; const m = Math.min(x.bal, left); x.bal -= m; left -= m; pay.set(x, (pay.get(x) || 0) + m); }
    if (month === 1) for (const [x, m] of pay) if (m > 0) firstMonth.push({ d: x, amount: m });
    for (const x of list) if (x.bal <= 0 && !x.paidOff) x.paidOff = month;
    // Bütçe faizi bile karşılamıyorsa dur
    if (month === 12 && list.reduce((s, x) => s + x.bal, 0) >= debts.reduce((s, x) => s + x.balance, 0)) return { stuck: true, months: null, totalInterest, list, firstMonth };
  }
  return { stuck: month >= 360, months: month, totalInterest, list, firstMonth };
}

const dpMonth = (n) => { const d = new Date(); d.setMonth(d.getMonth() + n - 1); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const dpMonths = (n) => (n >= 12 ? `${Math.floor(n / 12)} yıl${n % 12 ? ` ${n % 12} ay` : ''}` : `${n} ay`);

function viewDebtPlan() {
  const back = `<button class="back" data-action="nav" data-view="cards">${icon('chevron-left', 18)} Cüzdan</button>`;
  const debts = planDebts();
  if (!debts.length) return `${back}${viewHead('Borç kapatma planı')}<div class="card empty-card"><span class="empty-ico">${icon('circle-check', 26)}</span><b>Kapatılacak borç yok</b><p>Kredi kartı borcun ya da birine borcun olduğunda plan burada çıkar.</p></div>`;
  const total = debts.reduce((s, x) => s + x.balance, 0);
  const minSum = debts.reduce((s, x) => s + minPay({ ...x, bal: x.balance }), 0);
  const budget = db.settings.debtBudget || Math.ceil((minSum * 1.2) / 10000) * 10000;
  const enough = budget >= minSum;
  const A = simulate(debts, budget, 'rate');
  const B = simulate(debts, budget, 'small');
  const cur = ui.planMethod === 'small' ? B : A;
  const card = (m, r, title, sub) => `<button class="dp-opt ${ui.planMethod === m ? 'on' : ''}" data-action="dp-method" data-val="${m}">
    <small>${title}</small>
    <b>${r.stuck ? 'Bitmiyor' : dpMonths(r.months)}</b>
    <span>${r.stuck ? 'Bu tutar faizi karşılamıyor' : `${dpMonth(r.months)} · faiz ${money(r.totalInterest)}`}</span>
    <em>${sub}</em>
  </button>`;
  const diffInt = B.totalInterest - A.totalInterest;
  const firstA = Math.min(...A.list.map((x) => x.paidOff || 999)), firstB = Math.min(...B.list.map((x) => x.paidOff || 999));
  const noRate = debts.some((x) => x.kind === 'card' && !x.rate);
  return `${back}
    ${viewHead('Borç kapatma planı')}
    <div class="hero dp-hero">
      <small>Toplam borç</small>
      <div class="hero-num">${money(total)}</div>
      <label class="dp-budget"><span>Borçlara ayda ayırabileceğin</span>
        <span class="dp-in"><input id="dp-budget" inputmode="decimal" value="${amountToInput(budget)}" data-change="dp-budget"><i>${esc(db.settings.currency)}</i></span></label>
      <p class="fc-note">${enough ? `En az ${money(minSum)} gerekiyor (asgari ödemeler)` : `<span class="fc-warn">${icon('triangle-alert', 15)} Asgari ödemeler için en az ${money(minSum)} gerekiyor</span>`}</p>
    </div>
    ${noRate ? `<p class="muted small dp-hint">${icon('info', 14)} Kartların aylık faiz oranını aşağıya girersen hesap gerçeğe yaklaşır (ekstrende "akdi faiz" olarak yazar).</p>` : ''}
    <div class="dp-opts">
      ${card('rate', A, 'Faizi yüksek önce', diffInt > 0 ? `${money(diffInt)} daha az faiz` : 'En az faiz')}
      ${card('small', B, 'Küçük borç önce', firstB < firstA ? `İlk borç ${firstA - firstB} ay daha erken kapanır` : 'Hızlı kapanış')}
    </div>
    ${!cur.stuck && cur.firstMonth.length ? `<h2 class="sec">Bu ay ödemen gerekenler</h2>
      <div class="list">${cur.firstMonth.sort((x, y) => y.amount - x.amount).map(({ d, amount }) => `<div class="tx">
        <span class="ico" style="--c:#5F6B7A">${icon(d.kind === 'card' ? 'credit-card' : 'hand-coins', 18)}</span>
        <span class="tx-main"><b>${esc(d.name)}</b><small>${money(amount)}</small></span>
        <button class="btn small" ${d.kind === 'card' ? `data-action="xfer-new" data-to="${d.ref.id}"` : `data-action="debt-pay" data-id="${d.ref.id}"`}>Öde</button>
      </div>`).join('')}</div>` : ''}
    <h2 class="sec">Kapanış sırası</h2>
    <div class="list">${[...cur.list].sort((x, y) => (x.paidOff || 999) - (y.paidOff || 999)).map((x, i) => `<div class="tx dp-row">
      <span class="dp-n">${i + 1}</span>
      <span class="tx-main"><b>${esc(x.name)} · ${money(x.balance)}</b><small>${x.paidOff ? `${dpMonth(x.paidOff)} kapanır` : 'Kapanmıyor'}${x.interest ? ` · faiz ${money(x.interest)}` : ''}</small></span>
      <label class="dp-rate"><input inputmode="decimal" value="${x.rate ? String(x.rate).replace('.', ',') : ''}" placeholder="0" data-change="dp-rate" data-key="${x.key}"><i>% ay</i></label>
    </div>`).join('')}</div>
    <p class="muted small fc-foot">Hesap her ay faiz ekleyip önce asgari ödemeleri yapar, kalan parayı seçtiğin yönteme göre sıradaki borca verir; bir borç kapanınca onun parası sıradakine geçer. Kişilere olan borçlarda vade varsa kalan aylara bölünür.</p>`;
}

VIEWS.debtplan = viewDebtPlan;
SUB_PAGES.push('debtplan');

Object.assign(actions, {
  'dp-method': (el) => { ui.planMethod = el.dataset.val; render(); },
});
Object.assign(changes, {
  'dp-budget': (el) => { const v = parseAmount(el.value); if (v > 0) { setSetting('debtBudget', v); render(); } },
  'dp-rate': (el) => {
    const v = Number(String(el.value).replace(',', '.')) || 0;
    if (v < 0 || v > 20) { toast('Aylık faiz 0 ile 20 arasında olmalı'); return; }
    const [k, id] = el.dataset.key.split(':');
    const obj = k === 'a' ? accById(id) : debtById(id);
    if (!obj) return;
    obj.rate = v;
    obj.updatedAt = Date.now();
    touch(k === 'a' ? 'acc' : 'debt', id);
    save();
    render();
  },
});

function debtPlanLink() {
  if (!planDebts().length) return '';
  return `<button class="fc-line" data-action="nav" data-view="debtplan" style="margin:0 0 14px">
    <span class="fc-ico">${icon('target', 18)}</span>
    <span class="fc-main"><small>Hangi borcu önce kapatmalısın?</small><b style="font-size:16px">Borç kapatma planı</b></span>
    <span class="chev">${icon('chevron-right', 18)}</span>
  </button>`;
}
