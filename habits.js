'use strict';

/* =====================================================================
   Alışkanlık uyarıları ve tek dokunuş kısayollar
   - Alışkanlık: bu ayın ilk N günü, önceki ayların aynı N günüyle karşılaştırılır
     (mağaza ve kategori bazında adet ve tutar). Belirgin artış varsa Özet'te gösterilir.
   - Kısayol: aynı harcamayı (yer + tutar + hesap) sık yapıyorsan Özet'te hazır durur;
     bir dokunuşla bugünün tarihiyle kaydedilir. Basılı tutunca gizlenir.
   ===================================================================== */

const HABIT_HIDE = 'butce.habitHide';
const habitHidden = () => { try { return JSON.parse(localStorage.getItem(HABIT_HIDE) || '{}'); } catch { return {}; } };

const habitTx = (t) => t.type === 'expense' && !isPlanned(t) && !t.feeOf && !t.recId && !FIXED_CATS.has(t.categoryId);

function habits() {
  const today = todayISO();
  const per = budgetPeriod(today);
  const elapsed = dayDiff(fromISO(per.start), fromISO(today)) + 1;
  if (elapsed < 5) return [];
  const prevs = [1, 2, 3].map((k) => {
    const p = getPeriod(shiftedPeriod(-k, { mode: 'month', anchor: per.start }));
    return { start: p.start, end: toISO(addDays(fromISO(p.start), elapsed - 1)) };
  });
  const first = db.transactions.reduce((m, t) => (t.date < m ? t.date : m), '9999');
  const used = prevs.filter((p) => p.start >= first || p.end >= first);
  if (!used.length) return [];
  const cm = catMap();
  // anahtar → { label, catId, cur: {n, sum}, prev: {n, sum} }
  const map = new Map();
  const bump = (key, label, catId, slot, t) => {
    if (!map.has(key)) map.set(key, { key, label, catId, cur: { n: 0, sum: 0 }, prev: { n: 0, sum: 0 } });
    const x = map.get(key);
    x[slot].n++;
    x[slot].sum += t.amount;
  };
  for (const t of db.transactions) {
    if (!habitTx(t)) continue;
    const slot = t.date >= per.start && t.date <= today ? 'cur' : used.some((p) => t.date >= p.start && t.date <= p.end) ? 'prev' : null;
    if (!slot) continue;
    const c = cm[t.categoryId] || MISSING_CAT;
    bump(`c:${t.categoryId}`, c.name, t.categoryId, slot, t);
    const k = t.note ? learnKey(t.note) : '';
    if (k) bump(`m:${k}`, t.note.trim(), t.categoryId, slot, t);
  }
  const hide = habitHidden();
  const out = [];
  for (const x of map.values()) {
    const pn = x.prev.n / used.length, ps = x.prev.sum / used.length;
    const { n, sum } = x.cur;
    if (n < 4 || hide[`${per.start}|${x.key}`]) continue;
    const grow = ps ? sum / ps - 1 : null;
    const extra = sum - ps;
    if (grow == null ? n >= 5 && sum >= 50000 : grow >= 0.3 && extra >= 20000 && n >= pn) {
      out.push({ ...x, pn, ps, grow, extra, projected: Math.round((sum / elapsed) * per.days), elapsed, per });
    }
  }
  // Aynı kategorinin hem kendisi hem mağazası çıkarsa mağazayı tut
  const mKeys = new Set(out.filter((x) => x.key.startsWith('m:')).map((x) => x.catId));
  return out.filter((x) => !(x.key.startsWith('c:') && mKeys.has(x.catId))).sort((a, b) => b.extra - a.extra);
}

function habitText(h) {
  const base = `Bu ay ${h.elapsed} günde ${h.cur.n} kez ${h.label} · ${money(h.cur.sum)}.`;
  if (h.grow == null) return `${base} Önceki aylarda bu dönemde yoktu.`;
  return `${base} Önceki ayların aynı döneminde ortalama ${Math.round(h.pn * 10) / 10} kez, ${money(h.ps)}.`;
}

function habitsCard() {
  let list;
  try { list = habits().slice(0, 2); } catch (e) { console.error(e); return ''; }
  if (!list.length) return '';
  return `<h2 class="sec">Dikkat çeken alışkanlıklar</h2>
    <div class="list">${list.map((h) => {
      const c = catMap()[h.catId] || MISSING_CAT;
      return `<div class="habit">
        <span class="ico" style="--c:${col(c.color)}">${glyph(c.icon, 18)}</span>
        <button class="habit-main" data-action="habit-open" data-key="${esc(h.key)}" data-label="${esc(h.label)}" data-cat="${h.catId}">
          <b>${esc(h.label)} ${h.grow != null ? `<span class="exp">+%${Math.round(h.grow * 100)}</span>` : '<span class="warn-t">yeni</span>'}</b>
          <small>${esc(habitText(h))} Böyle giderse ay sonunda ≈ ${money(h.projected)}.</small>
        </button>
        <button class="habit-x" data-action="habit-hide" data-key="${esc(h.key)}" aria-label="Bu ay gösterme">${icon('x', 16)}</button>
      </div>`;
    }).join('')}</div>`;
}

/* ------------------------- tek dokunuş kısayollar ------------------------- */

function shortcuts() {
  const since = toISO(addDays(fromISO(todayISO()), -120));
  const recent = toISO(addDays(fromISO(todayISO()), -45));
  const hidden = new Set(db.settings.hiddenShortcuts || []);
  const map = new Map();
  for (const t of db.transactions) {
    if (t.type !== 'expense' || isPlanned(t) || t.feeOf || t.recId || t.date < since) continue;
    const label = (t.note || '').trim();
    const key = `${t.categoryId}|${label ? learnKey(label) : ''}|${t.amount}|${t.accountId || ''}`;
    if (hidden.has(key)) continue;
    if (!map.has(key)) map.set(key, { key, n: 0, last: '', label, t, fees: new Set() });
    const x = map.get(key);
    x.n++;
    if (t.date >= x.last) { x.last = t.date; x.label = label; x.t = t; }
    x.fees.add(t.feeAmt == null ? 'x' : t.feeAmt);
  }
  return [...map.values()].filter((x) => x.n >= 3 && x.last >= recent)
    .sort((a, b) => b.n - a.n || (b.last > a.last ? 1 : -1)).slice(0, 4);
}

function shortcutBar() {
  let list;
  try { list = shortcuts(); } catch (e) { console.error(e); return ''; }
  if (!list.length) return '';
  const cm = catMap();
  return `<div class="shortcuts">${list.map((s) => {
    const c = cm[s.t.categoryId] || MISSING_CAT;
    return `<button class="sc" data-action="sc-use" data-key="${esc(s.key)}" title="Basılı tutarak gizle">
      <span class="ico sm" style="--c:${col(c.color)}">${glyph(c.icon, 16)}</span>
      <span><b>${esc(s.label || c.name)}</b><small>${money(s.t.amount)}${s.t.accountId && accById(s.t.accountId) ? ` · ${esc(accById(s.t.accountId).name)}` : ''}</small></span>
    </button>`;
  }).join('')}</div>`;
}

function useShortcut(key) {
  const s = shortcuts().find((x) => x.key === key);
  if (!s) return;
  const t = s.t;
  const acc = accById(t.accountId);
  // Banka hesabında masraf belirsizse formu doldurup aç
  const feeKnown = s.fees.size === 1 && !s.fees.has('x');
  const needFee = acc && acc.kind === 'bank';
  if (needFee && !feeKnown) {
    openTxForm({ type: 'expense', amountText: amountToInput(t.amount), categoryId: t.categoryId, note: t.note || '', accountId: t.accountId || '' });
    return;
  }
  const now = Date.now();
  const data = { type: 'expense', amount: t.amount, categoryId: t.categoryId, date: todayISO(), note: t.note || '', accountId: acc ? t.accountId : null, awaiting: false, updatedAt: now };
  const before = budgetSnapshot(data.date);
  const id = uid();
  db.transactions.push({ id, createdAt: now, ...data });
  touch('tx', id);
  if (needFee) applyFee(id, { ok: true, asked: true, fee: [...s.fees][0], accId: t.accountId }, `Masraf · ${t.note || (catMap()[t.categoryId] || MISSING_CAT).name}`);
  save();
  render();
  const warnings = budgetWarningsAfterSave(before, data);
  if (warnings.length) alertToast(warnings);
  else toast(`Kaydedildi · ${s.label || (catMap()[t.categoryId] || MISSING_CAT).name} ${money(t.amount)}`, 'Geri al', () => deleteTx(id));
}

Object.assign(actions, {
  'sc-use': (el) => useShortcut(el.dataset.key),
  'habit-hide': (el) => {
    const h = habitHidden();
    h[`${budgetPeriod(todayISO()).start}|${el.dataset.key}`] = 1;
    try { localStorage.setItem(HABIT_HIDE, JSON.stringify(h)); } catch {}
    render();
  },
  'habit-open': (el) => {
    const isM = el.dataset.key.startsWith('m:');
    ui.txFilter = { ...TX_FILTER0, q: isM ? el.dataset.label : '', cat: isM ? '' : el.dataset.cat };
    ui.period = { ...ui.period, mode: 'month', anchor: todayISO() };
    goTo('tx');
  },
});

// Basılı tut (telefonda) / sağ tık (bilgisayarda): kısayolu gizle
document.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-action="sc-use"]');
  if (!el) return;
  e.preventDefault();
  if (!confirm('Bu kısayol gizlensin mi?')) return;
  setSetting('hiddenShortcuts', [...(db.settings.hiddenShortcuts || []), el.dataset.key].slice(-50));
  render();
});
