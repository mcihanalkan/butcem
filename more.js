'use strict';

/* =====================================================================
   "Diğer" sayfası: ana menüye sığmayan bölümlerin kısayolları.
   Tutarları gizle: göz simgesi (yalnızca bu cihazda).
   ===================================================================== */

function viewMore() {
  const tiles = [];
  const add = (action, ic, title, sub, extra = '') => tiles.push(`<button class="hub-tile" data-action="${action}" ${extra}>
    <span class="hub-ico">${icon(ic, 22)}</span><b>${esc(title)}</b><small>${esc(sub)}</small></button>`);
  const ev = db.events.map(eventLine).sort((a, b) => a.d - b.d)[0];
  const vs = db.vault.filter((x) => { const d = vaultLeft(x); return d != null && d >= 0; }).sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
  const P = (() => { try { return personalInflation(); } catch { return null; } })();
  const s = (() => { try { return noSpendStats(); } catch { return null; } })();
  add('nav" data-view="events', 'cake', 'Özel günler', ev ? `${eventTitle(ev.e)} · ${ev.d === 0 ? 'bugün' : `${ev.d} gün`}` : 'Doğum günleri, hediyeler');
  add('nav" data-view="vault', 'shield-check', 'Belgeler ve garantiler', vs ? `${vs.title} · ${leftText(vaultLeft(vs)).toLocaleLowerCase('tr')}` : 'Garanti, pasaport, sözleşme');
  add('chat-open', 'message-circle', 'Asistan', 'Bütçen hakkında sor');
  add('report-prices', 'trending-up', 'Kişisel enflasyonun', P ? `Yıllık ≈ ${pct1(P.yearly)}` : 'Fiyatların nasıl değişti');
  add('story-pick', 'sparkles', 'Ay hikayeleri', 'Geçen ayların özeti');
  add('report-cal', 'flame', 'Harcamasız günler', s ? `Seri ${s.streak} gün · rekor ${s.best}` : 'Takvimde gör');
  add('nav" data-view="forecast', 'chart-line', 'Ay sonu tahmini', 'Gün gün bakiye');
  if (planDebts().length) add('nav" data-view="debtplan', 'target', 'Borç kapatma planı', 'Hangisi önce?');
  add('nav" data-view="settings', 'settings', 'Ayarlar', 'Senkron, bildirim, kilit');
  return `<button class="back" data-action="nav" data-view="home">${icon('chevron-left', 18)} Özet</button>${viewHead('Diğer')}<div class="hub">${tiles.join('')}</div>`;
}

VIEWS.more = viewMore;
SUB_PAGES.push('more');

function eyeButton() {
  return `<button class="eye-btn" data-action="toggle-hide" aria-label="${HIDE.on ? 'Tutarları göster' : 'Tutarları gizle'}">${icon(HIDE.on ? 'eye-off' : 'eye', 16)}</button>`;
}

Object.assign(actions, {
  'toggle-hide': () => {
    HIDE.on = !HIDE.on;
    try { localStorage.setItem('butce.hide', HIDE.on ? '1' : '0'); } catch {}
    render();
    toast(HIDE.on ? 'Tutarlar gizlendi' : 'Tutarlar görünüyor');
  },
});
