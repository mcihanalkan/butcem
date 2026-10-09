'use strict';

/* =====================================================================
   Abonelik denetimi
   - Düzenli giderlerden abonelik olanları (Abonelikler kategorisi ya da bilinen
     servis adları) toplar: aylık ve yıllık maliyet.
   - Zam tespiti: onaylanan son tutar bir öncekinden yüksekse işaretler.
   - Gizli tekrarlar: geçmişte her ay benzer tutarla tekrar eden ama Düzenli'ye
     eklenmemiş ödemeleri bulur ve eklemeyi önerir.
   ===================================================================== */

const SUB_WORDS = ['netflix', 'spotify', 'youtube', 'disney', 'prime', 'amazon', 'exxen', 'blutv', 'blu tv', 'gain', 'tabii', 'mubi', 'apple', 'icloud',
  'google one', 'google', 'xbox', 'playstation', 'ps plus', 'steam', 'chatgpt', 'openai', 'claude', 'canva', 'adobe', 'microsoft', 'office', 'dropbox',
  'tod', 'bein', 'digiturk', 'dsmart', 'tivibu', 'spor salonu', 'gym', 'macfit', 'abonelik', 'üyelik', 'storytel', 'audible', 'duolingo'];

const isSubName = (name) => { const n = String(name || '').toLocaleLowerCase('tr'); return SUB_WORDS.some((w) => n.includes(w)); };
const SUB_CAT = defCatId('expense', 'Abonelikler');
const FREQ_PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, yearly: 1 / 12 };

function subscriptions() {
  return db.recurring
    .filter((r) => r.type === 'expense' && (r.categoryId === SUB_CAT || isSubName(recName(r))))
    .map((r) => {
      const paid = db.transactions.filter((t) => t.recId === r.id && !t.awaiting).sort((a, b) => (a.recDate || a.date).localeCompare(b.recDate || b.date));
      const last = paid.at(-1), prev = paid.at(-2);
      const raise = last && prev && last.amount > prev.amount * 1.02 ? { from: prev.amount, to: last.amount } : null;
      const amount = last?.amount || r.amount;
      const monthly = Math.round(amount * (FREQ_PER_MONTH[recFreq(r)] || 1));
      return { r, amount, monthly, yearly: monthly * 12, raise, paused: !!r.paused };
    })
    .sort((a, b) => b.monthly - a.monthly);
}

// Her ay benzer tutarla tekrar eden, Düzenli'de olmayan giderler
function hiddenRecurring() {
  const since = toISO(addDays(fromISO(todayISO()), -200));
  const groups = new Map();
  for (const t of db.transactions) {
    if (t.type !== 'expense' || t.recId || isPlanned(t) || t.date < since || !t.note) continue;
    const k = learnKey(t.note);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const known = new Set(db.recurring.map((r) => learnKey(recName(r))));
  // Doğası gereği değişken harcamalar düzenli ödeme önerisine girmez
  const variable = new Set(['Market', 'Restoran', 'Kafe / Kahve', 'Fast food', 'Fırın / Atıştırmalık', 'Akaryakıt', 'Taksi', 'Toplu taşıma', 'Giyim'].map((n) => defCatId('expense', n)));
  const out = [];
  for (const [k, list] of groups) {
    if (known.has(k) || list.length < 2 || variable.has(list[0].categoryId)) continue;
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < 2 || months.size < list.length * 0.8) continue; // ayda bir civarı
    const amounts = list.map((t) => t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    if (amounts.some((a) => Math.abs(a - avg) > avg * 0.15)) continue; // tutarlar benzer olmalı
    const last = list.sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    out.push({ key: k, name: last.note, amount: last.amount, categoryId: last.categoryId, accountId: last.accountId, day: fromISO(last.date).getDate(), count: list.length, sub: isSubName(last.note) || last.categoryId === SUB_CAT });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 6);
}

/* ------------------------------ görünüm ------------------------------ */

// Düzenli ekranının üstündeki özet kartı
function subsCard() {
  const subs = subscriptions().filter((s) => !s.paused);
  const hidden = hiddenRecurring();
  if (!subs.length && !hidden.length) return '';
  const monthly = subs.reduce((a, s) => a + s.monthly, 0);
  const raises = subs.filter((s) => s.raise).length;
  return `<button class="card subs-card" data-action="subs-open">
    <span class="ico" style="--c:${col('#8b5cf6')}">${icon('tv', 19)}</span>
    <span class="tx-main">
      <b>Abonelikler${subs.length ? ` · ${subs.length} adet` : ''}</b>
      <small>${subs.length ? `Ayda ${money(monthly)} · yılda ${money(monthly * 12)}` : 'Henüz abonelik eklenmedi'}${raises ? ` · ${raises} zam` : ''}${hidden.length ? ` · ${hidden.length} öneri` : ''}</small>
    </span>
    <span class="chev">${icon('chevron-right', 18)}</span>
  </button>`;
}

function openSubs() {
  const subs = subscriptions();
  const active = subs.filter((s) => !s.paused);
  const hidden = hiddenRecurring();
  const monthly = active.reduce((a, s) => a + s.monthly, 0);
  const cm = catMap();
  openSheet(`
    <div class="sheet-head"><h2>Abonelikler</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    ${subs.length ? `
      <div class="card sum-list">
        <div><span>Aylık toplam</span><b class="exp">${money(monthly)}</b></div>
        <div><span>Yıllık toplam</span><b>${money(monthly * 12)}</b></div>
        ${active[0] ? `<div><span>En pahalısı</span><b>${esc(recName(active[0].r))} · ${money(active[0].monthly)}/ay</b></div>` : ''}
      </div>
      <div class="list" style="border:0">
        ${subs.map((s) => {
          const c = recCat(s.r);
          return `<button class="tx" data-action="rec-edit" data-id="${s.r.id}">
            <span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span>
            <span class="tx-main"><b>${esc(recName(s.r))}${s.raise ? ' <span class="lchip warn"><i></i>Zamlandı</span>' : ''}${s.paused ? ' <span class="lchip"><i></i>Duraklatıldı</span>' : ''}</b>
              <small>${esc(freqText(s.r))}${s.raise ? ` · ${money(s.raise.from)} → ${money(s.raise.to)}` : ''} · yılda ${money(s.yearly)}</small></span>
            <span class="amt">${money(s.amount)}</span>
          </button>`;
        }).join('')}
      </div>
      <p class="muted small" style="margin:10px 2px 0">Kullanmadığın bir aboneliği iptal ettiysen dokunup <b>Duraklat</b> ya da <b>Sil</b>; tasarrufun yıllık toplamda hemen görünür.</p>`
    : '<p class="muted small">Düzenli giderlerinde abonelik görünmüyor. Netflix, Spotify, spor salonu gibi ödemeleri Düzenli\'ye "Abonelikler" kategorisiyle eklersen burada toplanır.</p>'}
    ${hidden.length ? `<h4>Düzenli olabilir</h4>
      <p class="muted small" style="margin-top:-4px">Bunlar son aylarda her ay benzer tutarla tekrar ediyor ama Düzenli'de yok.</p>
      ${hidden.map((h, i) => {
        const c = cm[h.categoryId] || MISSING_CAT;
        return `<div class="free-row"><span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span>
          <span style="flex:1;min-width:0"><b>${esc(h.name)}</b><small class="muted" style="display:block">${h.count} kez · son tutar ${money(h.amount)} · ayın ${h.day}'i civarı</small></span>
          <button class="btn small" data-action="subs-add" data-i="${i}">Ekle</button></div>`;
      }).join('')}` : ''}
  `);
}

Object.assign(actions, {
  'subs-open': () => openSubs(),
  'subs-add': (el) => {
    const h = hiddenRecurring()[Number(el.dataset.i)];
    if (!h) return;
    const day = h.day;
    openRecForm({ type: 'expense', name: h.name, amountText: amountToInput(h.amount), categoryId: h.categoryId, freq: 'monthly', day, startDate: nextDue(day), accountId: h.accountId || '' });
  },
});
