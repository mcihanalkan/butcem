'use strict';

/* =====================================================================
   Özet ve Plan ekranları + alt menü rozetleri.
   Özet: bu ayın kalanı, yapılacaklar, en çok harcanan kategoriler, son işlemler.
   Plan: Bütçe ve Düzenli sekmeleri.
   ===================================================================== */

ui.homeAnchor = todayISO();
ui.planTab = ui.planTab || 'budget';

const SYNC_DOT = { ok: ['ok', 'Eşitlendi'], syncing: ['busy', 'Eşitleniyor'], offline: ['busy', 'Çevrimdışı, sonra eşitlenecek'], error: ['err', 'Eşitleme hatası'], off: ['off', 'Senkron kapalı'] };

function syncDot() {
  if (!syncConfigured()) return '';
  const [cls, title] = SYNC_DOT[sync.user ? sync.state : 'off'] || SYNC_DOT.off;
  return `<button class="sync-dot ${cls}" data-action="nav" data-view="settings" title="${title}" aria-label="${title}"></button>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 6 ? 'İyi geceler' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

/* --------------------------- yapılacaklar --------------------------- */

function todoItems() {
  const out = [];
  // Tarihi gelmiş, onay bekleyen ileri tarihli kayıtlar
  for (const t of awaitingDue()) {
    const tr = t.type === 'transfer';
    const c = catMap()[t.categoryId] || MISSING_CAT;
    const title = t.type === 'debt' ? debtTxTitle(t) : tr ? (accById(t.toId)?.kind === 'credit' ? `${accById(t.toId).name} ödemesi` : 'Transfer') : (t.note || c.name);
    const ask = tr ? 'Gönderildi mi?' : t.type === 'debt' ? (t.flow === 'in' ? 'Geldi mi?' : 'Ödendi mi?') : t.type === 'income' ? 'Geldi mi?' : 'Ödendi mi?';
    const late = t.date < todayISO();
    out.push(`<div class="todo">
      <span class="todo-ico ${late ? 'late' : 'soon'}">${tr ? icon('arrow-left-right', 18) : t.type === 'debt' ? icon('hand-coins', 18) : glyph(c.icon, 18)}</span>
      <span class="todo-main"><b>${esc(title)} · ${money(t.amount)}</b><small>${ask} · ${shortDay(t.date)}</small></span>
      <button class="btn small ok" data-action="edit-tx" data-id="${t.id}">Onayla</button>
    </div>`);
  }
  for (const it of attentionItems()) {
    const inc = it.rec.type === 'income';
    out.push(`<div class="todo">
      <span class="todo-ico ${it.state === 'late' ? 'late' : 'soon'}">${icon(inc ? 'arrow-down-left' : 'calendar', 18)}</span>
      <span class="todo-main"><b>${esc(recName(it.rec))}</b><small>${inc ? 'Geldi mi?' : 'Ödendi mi?'} · ${esc(stateText(it))}</small></span>
      <button class="btn small ok" data-action="rec-confirm" data-id="${it.rec.id}" data-due="${it.due}">${inc ? 'Geldi' : 'Ödendi'}</button>
    </div>`);
  }
  for (const s of cardAttention()) {
    out.push(`<div class="todo">
      <span class="todo-ico ${s.level === 'late' ? 'late' : 'soon'}">${icon('credit-card', 18)}</span>
      <span class="todo-main"><b>${esc(s.a.name)} · ${moneyRound(s.remaining)}</b><small>${esc(dueText(s))} · ${s.minDue ? `asgari ${moneyRound(s.minDue)}` : 'asgari ödendi'}</small></span>
      <button class="btn small" data-action="xfer-new" data-to="${s.a.id}">Öde</button>
    </div>`);
  }
  for (const s of debtAttention()) {
    const borrowed = isBorrowed(s.d);
    out.push(`<div class="todo">
      <span class="todo-ico ${s.level === 'late' ? 'late' : 'soon'}">${icon('hand-coins', 18)}</span>
      <span class="todo-main"><b>${borrowed ? 'Borç' : 'Alacak'} · ${esc(s.d.person)} · ${money(s.remaining)}</b><small>${esc(dueLabel(s))}</small></span>
      <button class="btn small" data-action="debt-pay" data-id="${s.d.id}">${borrowed ? 'Öde' : 'Tahsil et'}</button>
    </div>`);
  }
  for (const s of budgetAttention().slice(0, 2)) {
    out.push(`<button class="todo" data-action="nav" data-view="budget">
      <span class="todo-ico ${s.level === 'over' ? 'late' : 'soon'}">${icon('gauge', 18)}</span>
      <span class="todo-main"><b>${esc(budgetName(s.b))} limiti</b><small>${esc(statusMessage(s))}</small></span>
      <span class="chev">${icon('chevron-right', 18)}</span>
    </button>`);
  }
  return out;
}

/* ------------------------------ Özet ------------------------------ */

function viewHome() {
  const per = getPeriod({ mode: 'month', anchor: ui.homeAnchor });
  const today = todayISO();
  const isCurrent = today >= per.start && today <= per.end;
  const list = txIn(per);
  const t = totals(list);
  const cm = catMap();
  const head = viewHead(`<small class="greet">${greeting()}</small>Özet`, `${syncDot()}<button class="icon-btn" data-action="nav" data-view="settings" aria-label="Ayarlar">${icon('settings', 20)}</button>`);

  if (!db.transactions.length) {
    return `${head}
      <div class="card empty-card">
        <span class="empty-ico">${icon('wallet', 26)}</span>
        <b>Hoş geldin!</b>
        <p>Başlamak için birkaç adım:</p>
        <div class="steps">
          <button data-action="add-tx"><span>${icon('plus', 18)}</span>İlk harcamanı ya da gelirini ekle</button>
          <button data-action="nav" data-view="recurring"><span>${icon('repeat', 18)}</span>Maaş, kira, faturaları ekle</button>
          <button data-action="nav" data-view="cards"><span>${icon('credit-card', 18)}</span>Kartlarını, borç ve alacaklarını ekle</button>
          <button data-action="nav" data-view="budget"><span>${icon('target', 18)}</span>Aylık bütçe limiti koy</button>
        </div>
      </div>`;
  }

  const todos = isCurrent ? todoItems() : [];
  const cats = byCategory(list, 'expense');
  const top = cats.slice(0, 5);
  const recent = sortTx(list).slice(0, 5);

  return `${head}
    ${monthNav(per, 'home')}
    <div class="hero">
      <small>${isCurrent ? 'Bu ay kalan' : 'Ay sonu kalan'}</small>
      <div class="hero-num">${money(t.net)}</div>
      <div class="hero-row">
        <span><i>${icon('arrow-down-left', 15)}</i><span><small>Gelir</small><b>${money(t.inc)}</b></span></span>
        <span><i>${icon('arrow-up-right', 15)}</i><span><small>Gider</small><b>${money(t.exp)}</b></span></span>
      </div>
      ${isCurrent ? budgetMini() : ''}
    </div>
    ${todos.length ? `<h2 class="sec">Yapılacaklar <span class="count">${todos.length}</span></h2><div class="list todos">${todos.join('')}</div>` : ''}
    ${isCurrent && db.transactions.some((x) => !isPlanned(x)) ? `<div style="margin-top:12px">${aiCard()}</div>` : ''}
    ${top.length ? `<div class="sec-head"><h2 class="sec">Nereye harcadın?</h2><button class="link" data-action="nav" data-view="report">Rapor ›</button></div>
      <div class="card spend">
        ${top.map((r) => `<button class="spend-row" data-action="filter-cat" data-id="${r.id}">
          <span class="ico sm" style="--c:${col(r.cat.color)}">${glyph(r.cat.icon)}</span>
          <span class="spend-main"><span class="between"><b>${esc(r.cat.name)}</b><b>${moneyRound(r.sum)}</b></span>
            <span class="thin"><i style="width:${((r.sum / top[0].sum) * 100).toFixed(1)}%;background:${col(r.cat.color)}"></i></span></span>
        </button>`).join('')}
        ${cats.length > 5 ? `<small class="muted">+${cats.length - 5} kategori daha</small>` : ''}
      </div>` : ''}
    <div class="sec-head"><h2 class="sec">Son işlemler</h2>${list.length > 5 ? `<button class="link" data-action="nav" data-view="tx">Tümü ›</button>` : ''}</div>
    ${recent.length ? `<div class="list">${recent.map((x) => txRow(x, cm, true)).join('')}</div>` : '<p class="muted small">Bu ay henüz kayıt yok.</p>'}
  `;
}

/* ------------------------------ Plan ------------------------------ */

function viewPlan() {
  const tab = ui.planTab === 'recurring' ? 'recurring' : 'budget';
  const att = attentionItems().length;
  const right = tab === 'budget'
    ? `<button class="btn small" data-action="bud-new">+ Limit</button>`
    : `<button class="btn small" data-action="rec-new">+ Ekle</button>`;
  return `${viewHead('Plan', right)}
    <div class="seg tabs">
      <button data-action="plan-tab" data-val="budget" class="${tab === 'budget' ? 'on' : ''}">Bütçe</button>
      <button data-action="plan-tab" data-val="recurring" class="${tab === 'recurring' ? 'on' : ''}">Düzenli${att ? ` <i class="dot-count">${att}</i>` : ''}</button>
    </div>
    ${tab === 'budget' ? viewBudget() : viewRecurring()}`;
}

/* --------------------------- menü rozetleri --------------------------- */

function updateNavBadges() {
  const set = (id, n) => { const el = $(id); if (el) { el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n); } };
  set('#badge-plan', attentionItems().length);
  set('#badge-tx', awaitingDue().length);
  set('#badge-cards', cardAttention().length + debtAttention().length);
}

VIEWS.home = viewHome;
VIEWS.plan = viewPlan;

Object.assign(actions, {
  'plan-tab': (el) => { ui.planTab = el.dataset.val; render(); },
  'home-shift': (el) => { ui.homeAnchor = shiftedPeriod(Number(el.dataset.dir), { mode: 'month', anchor: ui.homeAnchor }).anchor; render(); },
  'home-today': () => { ui.homeAnchor = todayISO(); render(); },
});
