'use strict';

/* =====================================================================
   Ay sonu hikayesi
   - Biten ayın kaydırmalı özeti: toplamlar, en çok harcananlar, günler, yerler, birikim.
   - Yeni ayın ilk haftasında Özet'te "… hikayen hazır" kartı çıkar (izlenince kaybolur).
   - Dokun: ileri · sol kenara dokun: geri · kapat: ✕ ya da geri tuşu.
   ===================================================================== */

const STORY_SEEN = 'butce.storySeen';
let story = null; // { slides, i, timer }

function storyData(anchor) {
  const per = getPeriod({ mode: 'month', anchor });
  const prev = getPeriod(shiftedPeriod(-1, { mode: 'month', anchor: per.start }));
  const list = txIn(per).filter((t) => !isPlanned(t));
  const t = totals(list);
  const pt = totals(txIn(prev));
  const cats = byCategory(list, 'expense');
  const prevCats = Object.fromEntries(byCategory(txIn(prev), 'expense').map((r) => [r.id, r.sum]));
  const days = {};
  const places = new Map();
  let nExp = 0;
  for (const x of list) {
    if (x.type !== 'expense') continue;
    nExp++;
    days[x.date] = (days[x.date] || 0) + x.amount;
    if (x.note && learnKey(x.note) && !x.feeOf) {
      const k = learnKey(x.note);
      if (!places.has(k)) places.set(k, { name: x.note.trim(), n: 0, sum: 0 });
      const p = places.get(k);
      p.n++; p.sum += x.amount;
    }
  }
  const topDay = Object.entries(days).sort((a, b) => b[1] - a[1])[0];
  const S = spendDays();
  let free = 0, run = 0, best = 0;
  for (let d = fromISO(per.start); toISO(d) <= per.end && toISO(d) <= todayISO(); d = addDays(d, 1)) {
    const iso = toISO(d);
    if (iso < S.first) continue;
    if (S.set.has(iso)) run = 0; else { free++; run++; best = Math.max(best, run); }
  }
  const pl = [...places.values()];
  const visited = pl.sort((a, b) => b.n - a.n)[0];
  const costly = [...pl].sort((a, b) => b.sum - a.sum)[0];
  const goalSaved = list.filter((x) => x.type === 'goal').reduce((s, x) => s + (x.role === 'withdraw' ? -x.amount : x.amount), 0);
  const changes = cats.map((r) => ({ ...r, diff: r.sum - (prevCats[r.id] || 0) })).filter((r) => prevCats[r.id]);
  const up = [...changes].sort((a, b) => b.diff - a.diff)[0];
  const down = [...changes].sort((a, b) => a.diff - b.diff)[0];
  return { per, prev, t, pt, cats, nExp, topDay, free, best, visited, costly, goalSaved, up, down };
}

function storySlides(D) {
  const name = MONTHS[fromISO(D.per.start).getMonth()];
  const diffPct = D.pt.exp ? Math.round(((D.t.exp - D.pt.exp) / D.pt.exp) * 100) : null;
  const s = [];
  s.push({ bg: 'g1', html: `<small>${esc(D.per.label)}</small><h1>${esc(name)} hikayen</h1><p>Bir ayı ${D.nExp} harcamayla geride bıraktın. Bakalım neler oldu.</p>` });
  s.push({ bg: 'g2', html: `<small>Bu ay harcadığın</small><div class="st-big">${money(D.t.exp)}</div>
    <p>${diffPct == null ? '' : diffPct > 0 ? `Geçen aydan <b>%${diffPct} fazla</b>.` : diffPct < 0 ? `Geçen aydan <b>%${-diffPct} az</b>. Güzel!` : 'Geçen ayla neredeyse aynı.'} Günde ortalama ${money(Math.round(D.t.exp / D.per.days))}.</p>` });
  if (D.cats.length) {
    const top = D.cats.slice(0, 4);
    s.push({ bg: 'g3', html: `<small>Paran en çok buraya gitti</small><h2>${esc(top[0].cat.name)}</h2>
      <div class="st-bars">${top.map((r) => `<div><span>${esc(r.cat.name)}</span><i style="width:${Math.max(6, (r.sum / top[0].sum) * 100).toFixed(0)}%"></i><b>${money(r.sum)}</b></div>`).join('')}</div>
      <p>Harcamalarının %${Math.round((top[0].sum / D.t.exp) * 100)} kadarı tek başına ${esc(top[0].cat.name)}.</p>` });
  }
  s.push({ bg: 'g4', html: `<small>Günler</small>
    ${D.topDay ? `<h2>En yoğun gün: ${esc(fullDay(D.topDay[0]))}</h2><p>O gün ${money(D.topDay[1])} harcadın.</p>` : ''}
    <div class="st-stat"><b>${D.free}</b><span>harcamasız gün</span></div>
    ${D.best >= 2 ? `<p>En uzun serin <b>${D.best} gün</b> sürdü.</p>` : ''}` });
  if (D.visited && D.visited.n >= 2) {
    s.push({ bg: 'g5', html: `<small>En sık gittiğin yer</small><h2>${esc(D.visited.name)}</h2><p>${D.visited.n} kez · toplam ${money(D.visited.sum)}</p>
      ${D.costly && D.costly.name !== D.visited.name ? `<p class="st-sub">En çok para bıraktığın yer: <b>${esc(D.costly.name)}</b> · ${money(D.costly.sum)}</p>` : ''}` });
  }
  const net = D.t.inc - D.t.exp;
  s.push({ bg: net >= 0 ? 'g6' : 'g7', html: `<small>Ay sonu</small>
    ${D.t.inc ? `<h2>${net >= 0 ? 'Kendine bıraktığın' : 'Gelirini aşan'}</h2><div class="st-big">${money(Math.abs(net))}</div><p>Gelir ${money(D.t.inc)} · gider ${money(D.t.exp)}${D.t.inc && net > 0 ? ` · gelirinin %${Math.round((net / D.t.inc) * 100)} kadarı sende kaldı` : ''}.</p>` : '<h2>Bu ay gelir kaydı yok</h2>'}
    ${D.goalSaved > 0 ? `<p class="st-sub">Hedeflerine ${money(D.goalSaved)} ekledin.</p>` : ''}` });
  const tips = [];
  if (D.down && D.down.diff < 0) tips.push(`${esc(D.down.cat.name)} harcamanı geçen aya göre ${money(-D.down.diff)} azalttın.`);
  if (D.up && D.up.diff > 0) tips.push(`${esc(D.up.cat.name)} ${money(D.up.diff)} arttı; yeni ayda buna bir göz at.`);
  s.push({ bg: 'g1', html: `<small>Yeni aya</small><h2>${tips.length ? 'Aklında olsun' : 'Yeni ay, yeni sayfa'}</h2>${tips.map((x) => `<p>${x}</p>`).join('')}
    <button class="st-btn" data-st="close">Kapat</button>` });
  return s;
}

function openStory(anchor) {
  const D = storyData(anchor);
  if (!D.nExp) { toast('Bu ay için hikaye çıkaracak kadar kayıt yok'); return; }
  try { const seen = JSON.parse(localStorage.getItem(STORY_SEEN) || '{}'); seen[D.per.start] = 1; localStorage.setItem(STORY_SEEN, JSON.stringify(seen)); } catch {}
  story = { slides: storySlides(D), i: 0 };
  let root = document.getElementById('story-root');
  if (!root) { root = document.createElement('div'); root.id = 'story-root'; document.body.appendChild(root); }
  document.documentElement.classList.add('locked');
  history.pushState({ story: true }, '');
  drawStory();
}

function drawStory() {
  const root = document.getElementById('story-root');
  if (!story) { root?.remove(); document.documentElement.classList.remove('locked'); return; }
  clearTimeout(story.timer);
  const sl = story.slides[story.i];
  root.className = `story ${sl.bg}`;
  root.innerHTML = `<div class="st-bars-top">${story.slides.map((_, k) => `<i class="${k < story.i ? 'done' : k === story.i ? 'now' : ''}"></i>`).join('')}</div>
    <button class="st-x" data-st="close" aria-label="Kapat">${icon('x', 22)}</button>
    <div class="st-body">${sl.html}</div>
    <button class="st-nav prev" data-st="prev" aria-label="Geri"></button><button class="st-nav next" data-st="next" aria-label="İleri"></button>`;
  if (story.i < story.slides.length - 1) story.timer = setTimeout(() => { if (story) { story.i++; drawStory(); } }, 7000);
}

function closeStory(fromPop) {
  if (!story) return;
  clearTimeout(story.timer);
  story = null;
  drawStory();
  if (!fromPop) history.back();
  render();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-st]');
  if (!b || !story) return;
  const k = b.dataset.st;
  if (k === 'close') closeStory();
  else if (k === 'prev') { story.i = Math.max(0, story.i - 1); drawStory(); }
  else if (k === 'next') { if (story.i < story.slides.length - 1) { story.i++; drawStory(); } else closeStory(); }
});
window.addEventListener('popstate', () => { if (story) closeStory(true); });
document.addEventListener('keydown', (e) => {
  if (!story) return;
  if (e.key === 'ArrowRight') { story.i = Math.min(story.slides.length - 1, story.i + 1); drawStory(); }
  if (e.key === 'ArrowLeft') { story.i = Math.max(0, story.i - 1); drawStory(); }
  if (e.key === 'Escape') closeStory();
});

// Özet kartı: yeni ayın ilk 7 günü, geçen ayın hikayesi izlenmediyse
function storyCard() {
  const per = budgetPeriod(todayISO());
  if (dayDiff(fromISO(per.start), fromISO(todayISO())) > 6) return '';
  const prev = getPeriod(shiftedPeriod(-1, { mode: 'month', anchor: per.start }));
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(STORY_SEEN) || '{}'); } catch {}
  if (seen[prev.start] || !txIn(prev).some((t) => t.type === 'expense' && !isPlanned(t))) return '';
  return `<button class="story-card" data-action="story-open" data-anchor="${prev.start}">
    <span class="story-ring">${icon('play', 18)}</span>
    <span><b>${esc(MONTHS[fromISO(prev.start).getMonth()])} hikayen hazır</b><small>Geçen ayın kısa özeti · 1 dakika</small></span>
  </button>`;
}

function openStoryPicker() {
  const months = lastMonths(7).reverse().slice(1);
  openSheet(`
    <div class="sheet-head"><h2>Ay hikayeleri</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="btn-stack">${months.map((p) => `<button class="btn" data-action="story-open" data-anchor="${p.start}">${esc(p.label)}</button>`).join('')}</div>`);
}

Object.assign(actions, {
  'story-open': (el) => { if (sheetOpen) { closeSheet(); setTimeout(() => openStory(el.dataset.anchor), 80); } else openStory(el.dataset.anchor); },
  'story-pick': () => openStoryPicker(),
});
