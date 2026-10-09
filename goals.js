'use strict';

/* =====================================================================
   Birikim hedefleri
   Hedef: { id, name, icon, color, target, deadline, initial, note }
   Katkılar "goal" türünde kayıttır: role 'save' (hedefe para koy) / 'withdraw' (hedeften çek).
   Bir hesap seçilirse o hesabın bakiyesi değişir (koyunca azalır, çekince artar);
   gelir/gider sayılmaz. Hesap seçilmezse sadece hedefin içinde takip edilir.
   ===================================================================== */

const goalById = (id) => db.goals.find((g) => g.id === id);
const goalTxs = (g) => db.transactions.filter((t) => t.type === 'goal' && t.goalId === g.id);
const monthsBetween = (a, b) => dayDiff(fromISO(a), fromISO(b)) / 30.44;
const monthLabel = (iso) => { const d = fromISO(iso); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

function goalStatus(g) {
  const today = todayISO();
  const txs = goalTxs(g).filter((t) => !t.awaiting);
  const sum = (role, since = '0000') => txs.filter((t) => t.role === role && t.date >= since).reduce((a, t) => a + t.amount, 0);
  const saved = (g.initial || 0) + sum('save') - sum('withdraw');
  const remaining = Math.max(0, g.target - saved);
  const done = saved >= g.target;
  const since = toISO(addDays(fromISO(today), -90));
  const firstDate = txs.reduce((m, t) => (t.date < m ? t.date : m), today);
  const spanMonths = Math.max(1, Math.min(3, monthsBetween(firstDate > since ? firstDate : since, today)));
  const monthlyRate = (sum('save', since) - sum('withdraw', since)) / spanMonths;
  const monthsLeft = g.deadline ? monthsBetween(today, g.deadline) : null;
  const perMonth = g.deadline && remaining > 0 ? Math.ceil(remaining / Math.max(1, monthsLeft)) : null;
  const eta = !done && monthlyRate > 0 ? toISO(addDays(fromISO(today), Math.ceil((remaining / monthlyRate) * 30.44))) : null;
  const late = g.deadline && !done && g.deadline < today;
  const onTrack = g.deadline ? (done || (eta && eta <= g.deadline)) : null;
  const thisMonth = budgetPeriod(today);
  const monthSaved = txs.filter((t) => t.date >= thisMonth.start && t.date <= thisMonth.end).reduce((a, t) => a + (t.role === 'save' ? t.amount : -t.amount), 0);
  return { g, saved, remaining, done, pct: g.target ? Math.max(0, Math.min(1, saved / g.target)) : 0, monthlyRate, monthsLeft, perMonth, eta, late, onTrack, monthSaved, txs };
}

function goalLine(s) {
  if (s.done) return 'Hedefe ulaşıldı';
  const parts = [];
  if (s.g.deadline) {
    if (s.late) parts.push(`Süre ${fullDay(s.g.deadline)} tarihinde doldu`);
    else parts.push(`${monthLabel(s.g.deadline)} için ayda ${money(s.perMonth)} ayırmalısın`);
  }
  if (s.eta) parts.push(`bu hızla ${monthLabel(s.eta)}'da tamamlanır`);
  else if (!s.g.deadline) parts.push('henüz düzenli birikim yok');
  return parts.join(' · ');
}

/* ------------------------------ ekran ------------------------------ */

function emergencyFund() {
  const months = pastMonths(3, todayISO());
  const exps = months.map((p) => totals(txIn(p)).exp).filter((x) => x > 0);
  const avg = exps.length ? exps.reduce((a, b) => a + b, 0) / exps.length : 0;
  return avg ? roundNice(avg * 3) : 0;
}

const GOAL_TEMPLATES = [
  { name: 'Acil durum fonu', icon: 'lc:shield', color: '#30A46C', emergency: true },
  { name: 'Tatil', icon: 'lc:plane', color: '#0B8EA8' },
  { name: 'Telefon / bilgisayar', icon: 'lc:laptop', color: '#5B5BD6' },
  { name: 'Araba', icon: 'lc:car', color: '#E8663C' },
  { name: 'Ev peşinatı', icon: 'lc:house', color: '#A1775B' },
  { name: 'Düğün / nişan', icon: 'lc:gem', color: '#D6409F' },
];

function goalCard(s) {
  const g = s.g;
  const tone = s.done ? 'ok' : s.late || s.onTrack === false ? 'warn' : 'ok';
  return `<button class="card goal-card" data-action="goal-open" data-id="${g.id}">
    <span class="between">
      <span class="goal-name"><span class="ico sm" style="--c:${col(g.color)}">${glyph(g.icon)}</span><b>${esc(g.name)}</b></span>
      <span class="lchip ${s.done ? 'ok' : tone}"><i></i>${s.done ? 'Tamamlandı' : `%${Math.round(s.pct * 100)}`}</span>
    </span>
    <span class="big-num">${money(s.saved)}<span> / ${money(g.target)}</span></span>
    <span class="bbar ${s.done ? 'ok' : tone === 'warn' ? 'pace' : 'ok'}"><i style="width:${(s.pct * 100).toFixed(1)}%"></i></span>
    <small class="goal-line">${esc(goalLine(s))}</small>
  </button>`;
}

function viewGoals() {
  if (!db.goals.length) {
    const ef = emergencyFund();
    return `<div class="card empty-card">
        <span class="empty-ico">${icon('flag', 26)}</span>
        <b>Birikim hedefleri</b>
        <p>Tatil, acil durum fonu, yeni telefon… Hedef koy; ayda ne kadar ayırman gerektiğini ve ne zaman ulaşacağını göstereyim.</p>
      </div>
      <div class="card"><h3>Hızlı başla</h3>
        <div class="tpl-grid">${GOAL_TEMPLATES.map((t, i) => `<button class="cat-tile" style="--c:${t.color}" data-action="goal-tpl" data-i="${i}"><span>${glyph(t.icon, 22)}</span><em>${esc(t.name)}</em></button>`).join('')}</div>
        ${ef ? `<p class="muted small" style="margin:12px 2px 0">Son 3 ayın giderine göre önerilen acil durum fonu: <b>${money(ef)}</b> (3 aylık gider).</p>` : ''}
        <button class="btn block" style="margin-top:12px" data-action="goal-new">+ Kendi hedefimi ekleyeyim</button>
      </div>`;
  }
  const all = db.goals.map(goalStatus);
  const open = all.filter((s) => !s.done).sort((a, b) => (a.g.deadline || '9999').localeCompare(b.g.deadline || '9999'));
  const done = all.filter((s) => s.done);
  const savedTotal = all.reduce((a, s) => a + Math.max(0, s.saved), 0);
  const targetTotal = all.reduce((a, s) => a + s.g.target, 0);
  const month = all.reduce((a, s) => a + s.monthSaved, 0);
  return `
    <div class="card sum-list">
      <div><span>Toplam biriken</span><b class="inc">${money(savedTotal)}</b></div>
      <div><span>Hedeflerin toplamı</span><b>${money(targetTotal)}</b></div>
      <div><span>Bu ay ayrılan</span><b class="${month >= 0 ? '' : 'exp'}">${month >= 0 ? '' : '−'}${money(Math.abs(month))}</b></div>
    </div>
    ${open.map(goalCard).join('')}
    ${done.length ? `<h2 class="sec">Tamamlananlar</h2>${done.map(goalCard).join('')}` : ''}
  `;
}

/* ------------------------------ detay ------------------------------ */

function openGoal(id) {
  const g = goalById(id);
  if (!g) return;
  const s = goalStatus(g);
  const hist = [...goalTxs(g)].sort((a, b) => (a.date < b.date ? 1 : -1));
  openSheet(`
    <div class="sheet-head"><h2>${esc(g.name)}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="debt-hero">
      <small>${s.done ? 'Hedefe ulaşıldı' : 'Biriken'}</small>
      <b class="${s.done ? 'inc' : ''}">${money(s.saved)}</b>
      <div class="bbar ok"><i style="width:${(s.pct * 100).toFixed(1)}%"></i></div>
      <div class="between small"><span>%${Math.round(s.pct * 100)}</span><span>Hedef ${money(g.target)}</span></div>
    </div>
    <div class="card sum-list" style="margin-top:12px">
      <div><span>Kalan</span><b>${money(s.remaining)}</b></div>
      ${g.deadline ? `<div><span>Hedef tarihi</span><b class="${s.late ? 'exp' : ''}">${fullDay(g.deadline)}</b></div>` : ''}
      ${s.perMonth ? `<div><span>Ayda ayırman gereken</span><b>${money(s.perMonth)}</b></div>` : ''}
      <div><span>Son 3 ay ortalaman</span><b>${money(Math.max(0, Math.round(s.monthlyRate)))} / ay</b></div>
      ${s.eta ? `<div><span>Bu hızla tamamlanma</span><b class="${s.onTrack === false ? 'warn-t' : 'inc'}">${monthLabel(s.eta)}</b></div>` : ''}
    </div>
    <div class="row" style="margin:6px 0 4px">
      <button class="btn primary" data-action="goal-add" data-id="${g.id}" data-role="save">${icon('plus', 18)} Para ekle</button>
      <button class="btn" data-action="goal-add" data-id="${g.id}" data-role="withdraw">${icon('minus', 18)} Para çek</button>
      <button class="btn" data-action="goal-edit" data-id="${g.id}" aria-label="Düzenle">${icon('pencil', 18)}</button>
    </div>
    <h4>Hareketler</h4>
    ${hist.length ? `<div class="list" style="border:0">${hist.map((t) => txRow(t, catMap(), true)).join('')}</div>` : `<p class="muted small">Henüz para eklenmedi.${g.initial ? ` Başlangıçta ${money(g.initial)} birikmişti.` : ''}</p>`}
  `);
}

/* ------------------------------ hedef formu ------------------------------ */

let goalForm = null;

function openGoalForm(init = {}) {
  goalForm = { id: null, name: '', icon: 'lc:flag', color: '#30A46C', targetText: '', deadline: '', initialText: '', ...init };
  renderGoalForm();
}

function syncGoalForm() {
  if (!goalForm || !$('#g-name')) return;
  Object.assign(goalForm, { name: $('#g-name').value, targetText: $('#g-target').value, deadline: $('#g-deadline').value, initialText: $('#g-initial').value });
}

function renderGoalForm() {
  const f = goalForm;
  const plus = (m) => toISO(new Date(new Date().getFullYear(), new Date().getMonth() + m, new Date().getDate()));
  const icons = ['flag', 'shield', 'plane', 'laptop', 'smartphone', 'car', 'house', 'gem', 'graduation-cap', 'gift', 'piggy-bank', 'heart', 'bike', 'camera', 'sofa', 'baby'];
  openSheet(`
    <div class="sheet-head"><h2>${f.id ? 'Hedefi düzenle' : 'Yeni hedef'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="field"><label>Hedef adı</label><input id="g-name" value="${esc(f.name)}" maxlength="40" placeholder="ör. Yaz tatili"></div>
    <div class="field"><label>Hedef tutar</label>
      <div class="amount-field"><input id="g-target" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.targetText)}"><span>${esc(db.settings.currency)}</span></div>
      ${f.emergency && emergencyFund() ? `<div class="chips"><button class="chip" data-action="g-target" data-val="${emergencyFund()}">3 aylık gider · ${money(emergencyFund())}</button></div>` : ''}
    </div>
    <div class="field"><label>Hedef tarihi <span class="muted">(isteğe bağlı)</span></label>
      <input type="date" id="g-deadline" value="${f.deadline || ''}" min="${todayISO()}">
      <div class="chips" style="flex-wrap:wrap">
        ${[3, 6, 12, 24].map((m) => `<button class="chip" data-action="g-deadline" data-val="${plus(m)}">${m < 12 ? `${m} ay` : `${m / 12} yıl`}</button>`).join('')}
        <button class="chip ghost" data-action="g-deadline" data-val="">Tarih yok</button>
      </div>
    </div>
    <div class="field"><label>Şu an biriken <span class="muted">(varsa)</span></label><input id="g-initial" inputmode="decimal" value="${esc(f.initialText)}" placeholder="0,00"></div>
    <div class="field"><label>Simge</label>
      <div class="icon-grid">${icons.map((n) => `<button data-action="g-icon" data-val="lc:${n}" class="${f.icon === `lc:${n}` ? 'on' : ''}" aria-label="${n}">${icon(n, 20)}</button>`).join('')}</div>
    </div>
    <div class="field"><label>Renk</label><div class="swatches">${PALETTE.map((c) => `<button data-action="g-color" data-val="${c}" class="${f.color === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>
    <div class="actions">
      ${f.id ? `<button class="btn danger" data-action="g-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="g-save">Kaydet</button>
    </div>
  `);
  if (!f.id && !f.name) setTimeout(() => $('#g-name')?.focus(), 60);
}

function saveGoal() {
  syncGoalForm();
  const f = goalForm;
  const target = parseAmount(f.targetText);
  const initial = f.initialText.trim() ? parseAmount(f.initialText) : 0;
  if (!f.name.trim()) { toast('Hedefe bir ad ver'); $('#g-name').focus(); return; }
  if (!(target > 0)) { $('#g-target').classList.add('invalid'); toast('Hedef tutarı gir'); return; }
  if (Number.isNaN(initial) || initial < 0) { toast('Biriken tutarı kontrol et'); return; }
  const now = Date.now();
  const data = { name: f.name.trim(), icon: f.icon, color: f.color, target, deadline: f.deadline || null, initial, updatedAt: now };
  let id = f.id;
  if (id) Object.assign(goalById(id), data);
  else { id = uid(); db.goals.push({ id, createdAt: now, ...data }); }
  touch('goal', id);
  save();
  closeSheet();
  ui.view = 'plan';
  ui.planTab = 'goals';
  render();
  toast(f.id ? 'Hedef güncellendi' : 'Hedef eklendi');
}

function deleteGoal() {
  const g = goalById(goalForm.id);
  if (!g || !confirm(`"${g.name}" hedefi ve hareketleri silinsin mi?\nBir hesaptan aktardığın paralar o hesaba geri dönmüş sayılır.`)) return;
  const now = Date.now();
  for (const t of goalTxs(g)) { db.deleted.push({ id: t.id, kind: 'tx', at: now, data: t }); touch('tx', t.id); }
  db.transactions = db.transactions.filter((t) => !(t.type === 'goal' && t.goalId === g.id));
  db.goals = db.goals.filter((x) => x.id !== g.id);
  db.deleted.push({ id: g.id, kind: 'goal', at: now, data: g });
  touch('goal', g.id);
  save();
  closeSheet();
  render();
  toast('Hedef silindi');
}

/* --------------------------- para ekle / çek --------------------------- */

let goalPay = null;

function openGoalPay(goalId, role, txId = null) {
  const t = txId ? db.transactions.find((x) => x.id === txId) : null;
  goalPay = { goalId, role: t?.role || role, id: t?.id || null, amountText: t ? amountToInput(t.amount) : '', date: t?.date || todayISO(), note: t?.note || '', accountId: t ? t.accountId || '' : lastAccountId() };
  renderGoalPay();
}

function renderGoalPay() {
  const f = goalPay;
  const g = goalById(f.goalId);
  const s = goalStatus(g);
  const save = f.role === 'save';
  openSheet(`
    <div class="sheet-head"><h2>${save ? 'Para ekle' : 'Para çek'} · ${esc(g.name)}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <p class="muted small" style="margin-top:-6px">Biriken ${money(s.saved)} · kalan ${money(s.remaining)}</p>
    <div class="field">
      <div class="amount-field"><input id="gp-amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${esc(f.amountText)}"><span>${esc(db.settings.currency)}</span></div>
      <div class="chips" style="flex-wrap:wrap">
        ${save && s.perMonth ? `<button class="chip" data-action="gp-amt" data-val="${s.perMonth}">Aylık hedef · ${money(s.perMonth)}</button>` : ''}
        ${save && s.remaining ? `<button class="chip" data-action="gp-amt" data-val="${s.remaining}">Kalanın tamamı</button>` : ''}
        ${!save && s.saved > 0 ? `<button class="chip" data-action="gp-amt" data-val="${s.saved}">Hepsi · ${money(s.saved)}</button>` : ''}
      </div>
    </div>
    ${accountPicker(f.accountId, save ? 'expense' : 'income', 'gp-acc').replace(/Nereye geldi\?|Nereden ödendi\?/, save ? 'Hangi hesaptan ayırdın?' : 'Hangi hesaba aktardın?').replace('>Hiçbiri<', '>Hesaba yansıtma<')}
    <div class="row field">
      <div><label class="lbl">Tarih</label><input type="date" id="gp-date" value="${f.date}"></div>
      <div><label class="lbl">Not</label><input id="gp-note" value="${esc(f.note)}" maxlength="80" placeholder="İsteğe bağlı"></div>
    </div>
    ${f.id && db.transactions.find((x) => x.id === f.id)?.awaiting ? `<div class="await-box"><b>Onay bekliyor</b><small>Para gerçekten ayrıldığında onayla; o zamana kadar bakiyeye ve hedefe yansımaz.</small><button class="btn primary block" data-action="gp-save" data-confirm="1">${icon('check', 18)} Onayla</button></div>` : ''}
    <div class="actions">
      ${f.id ? `<button class="btn danger" data-action="gp-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="gp-save">${save ? 'Hedefe ekle' : 'Hedeften çek'}</button>
    </div>
  `);
  if (!f.id) setTimeout(() => $('#gp-amount')?.focus(), 60);
}

function saveGoalPay(confirmNow = false) {
  const f = goalPay;
  const g = goalById(f.goalId);
  const amount = parseAmount($('#gp-amount').value);
  if (!(amount > 0)) { $('#gp-amount').classList.add('invalid'); toast('Geçerli bir tutar gir'); return; }
  const before = goalStatus(g);
  let date = $('#gp-date').value || todayISO();
  if (confirmNow && date > todayISO()) date = todayISO();
  const now = Date.now();
  const data = { type: 'goal', goalId: g.id, role: f.role, amount, accountId: f.accountId || null, date, note: $('#gp-note').value.trim(), categoryId: null, awaiting: !confirmNow && date > todayISO(), updatedAt: now };
  let id = f.id;
  if (id) Object.assign(db.transactions.find((x) => x.id === id), data);
  else { id = uid(); db.transactions.push({ id, createdAt: now, ...data }); }
  touch('tx', id);
  save();
  render();
  const after = goalStatus(g);
  openGoal(g.id);
  toast(!before.done && after.done ? `Tebrikler! ${g.name} hedefine ulaştın` : data.awaiting ? `Planlandı · ${fullDay(date)} günü onayın istenecek` : f.role === 'save' ? `Eklendi · %${Math.round(after.pct * 100)} tamamlandı` : 'Çekildi');
}

function deleteGoalPay() {
  const f = goalPay;
  if (!f.id || !confirm('Bu hareket silinsin mi?')) return;
  const t = db.transactions.find((x) => x.id === f.id);
  db.transactions = db.transactions.filter((x) => x.id !== f.id);
  db.deleted.push({ id: f.id, kind: 'tx', at: Date.now(), data: t });
  touch('tx', f.id);
  save();
  render();
  openGoal(f.goalId);
}

// İşlem listelerinde hedef hareketinin adı
function goalTxTitle(t) {
  const g = goalById(t.goalId);
  return `${t.role === 'withdraw' ? 'Hedeften çekildi' : 'Hedefe eklendi'} · ${g ? g.name : '?'}`;
}

Object.assign(actions, {
  'goal-new': () => openGoalForm(),
  'goal-tpl': (el) => { const t = GOAL_TEMPLATES[Number(el.dataset.i)]; openGoalForm({ name: t.name, icon: t.icon, color: t.color, emergency: !!t.emergency, targetText: t.emergency && emergencyFund() ? amountToInput(emergencyFund()) : '' }); },
  'goal-open': (el) => openGoal(el.dataset.id),
  'goal-edit': (el) => { const g = goalById(el.dataset.id); if (g) openGoalForm({ id: g.id, name: g.name, icon: g.icon, color: g.color, targetText: amountToInput(g.target), deadline: g.deadline || '', initialText: g.initial ? amountToInput(g.initial) : '' }); },
  'goal-add': (el) => openGoalPay(el.dataset.id, el.dataset.role),
  'g-target': (el) => { $('#g-target').value = amountToInput(Number(el.dataset.val)); },
  'g-deadline': (el) => { $('#g-deadline').value = el.dataset.val; },
  'g-icon': (el) => { goalForm.icon = el.dataset.val; $$('.icon-grid button').forEach((b) => b.classList.toggle('on', b === el)); },
  'g-color': (el) => { goalForm.color = el.dataset.val; $$('.swatches button').forEach((b) => b.classList.toggle('on', b === el)); },
  'g-save': () => saveGoal(),
  'g-delete': () => deleteGoal(),
  'gp-amt': (el) => { $('#gp-amount').value = amountToInput(Number(el.dataset.val)); },
  'gp-acc': (el) => { goalPay.accountId = pickAccount(el); },
  'gp-save': (el) => saveGoalPay(!!el.dataset.confirm),
  'gp-delete': () => deleteGoalPay(),
});
