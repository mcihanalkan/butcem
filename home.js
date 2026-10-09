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
  for (const it of attentionItems()) {
    const inc = it.rec.type === 'income';
    out.push(`<div class="todo">
      <span class="todo-ico">${it.state === 'late' ? '🔴' : '🟠'}</span>
      <span class="todo-main"><b>${esc(recName(it.rec))}</b><small>${inc ? 'Geldi mi?' : 'Ödendi mi?'} · ${esc(stateText(it))}</small></span>
      <button class="btn small ok" data-action="rec-confirm" data-id="${it.rec.id}" data-due="${it.due}">${inc ? 'Geldi' : 'Ödendi'}</button>
    </div>`);
  }
  for (const s of cardAttention()) {
    out.push(`<div class="todo">
      <span class="todo-ico">${s.level === 'late' ? '🔴' : '💳'}</span>
      <span class="todo-main"><b>${esc(s.a.name)} · ${moneyRound(s.remaining)}</b><small>${esc(dueText(s))} · ${s.minDue ? `asgari ${moneyRound(s.minDue)}` : 'asgari ödendi'}</small></span>
      <button class="btn small" data-action="xfer-new" data-to="${s.a.id}">Öde</button>
    </div>`);
  }
  for (const s of budgetAttention().slice(0, 2)) {
    out.push(`<button class="todo" data-action="nav" data-view="budget">
      <span class="todo-ico">${LEVEL_META[s.level].icon}</span>
      <span class="todo-main"><b>${esc(budgetName(s.b))} limiti</b><small>${esc(statusMessage(s))}</small></span>
      <span class="muted">›</span>
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
  const head = viewHead(`<small class="greet">${greeting()}</small>Özet`, `${syncDot()}<button class="icon-btn" data-action="nav" data-view="settings" aria-label="Ayarlar">⚙️</button>`);

  if (!db.transactions.length) {
    return `${head}
      <div class="card empty-card">
        <span class="big">👋</span>
        <b>Hoş geldin!</b>
        <p>Başlamak için birkaç adım:</p>
        <div class="steps">
          <button data-action="add-tx"><span>➕</span>İlk harcamanı ya da gelirini ekle</button>
          <button data-action="nav" data-view="recurring"><span>📅</span>Maaş, kira, faturaları ekle</button>
          <button data-action="nav" data-view="cards"><span>💳</span>Kartlarını ve borcunu ekle</button>
          <button data-action="nav" data-view="budget"><span>🎯</span>Aylık bütçe limiti koy</button>
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
        <span><i>↓</i> Gelir <b>${moneyRound(t.inc)}</b></span>
        <span><i>↑</i> Gider <b>${moneyRound(t.exp)}</b></span>
      </div>
      ${isCurrent ? budgetMini() : ''}
    </div>
    ${todos.length ? `<h2 class="sec">Yapılacaklar <span class="count">${todos.length}</span></h2><div class="list todos">${todos.join('')}</div>` : ''}
    ${top.length ? `<div class="sec-head"><h2 class="sec">Nereye harcadın?</h2><button class="link" data-action="nav" data-view="report">Rapor ›</button></div>
      <div class="card spend">
        ${top.map((r) => `<button class="spend-row" data-action="filter-cat" data-id="${r.id}">
          <span class="ico sm" style="--c:${r.cat.color}">${esc(r.cat.icon)}</span>
          <span class="spend-main"><span class="between"><b>${esc(r.cat.name)}</b><b>${moneyRound(r.sum)}</b></span>
            <span class="thin"><i style="width:${((r.sum / top[0].sum) * 100).toFixed(1)}%;background:${r.cat.color}"></i></span></span>
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
      <button data-action="plan-tab" data-val="budget" class="${tab === 'budget' ? 'on' : ''}">🎯 Bütçe</button>
      <button data-action="plan-tab" data-val="recurring" class="${tab === 'recurring' ? 'on' : ''}">📅 Düzenli${att ? ` <i class="dot-count">${att}</i>` : ''}</button>
    </div>
    ${tab === 'budget' ? viewBudget() : viewRecurring()}`;
}

/* --------------------------- menü rozetleri --------------------------- */

function updateNavBadges() {
  const set = (id, n) => { const el = $(id); if (el) { el.hidden = !n; el.textContent = n > 9 ? '9+' : String(n); } };
  set('#badge-plan', attentionItems().length);
  set('#badge-cards', cardAttention().length);
}

VIEWS.home = viewHome;
VIEWS.plan = viewPlan;

Object.assign(actions, {
  'plan-tab': (el) => { ui.planTab = el.dataset.val; render(); },
  'home-shift': (el) => { ui.homeAnchor = shiftedPeriod(Number(el.dataset.dir), { mode: 'month', anchor: ui.homeAnchor }).anchor; render(); },
  'home-today': () => { ui.homeAnchor = todayISO(); render(); },
});
