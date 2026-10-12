'use strict';

/* =====================================================================
   Ücretsiz deneme hatırlatıcı
   - Düzenli giderde "Ücretsiz deneme süresinde" işaretlenirse deneme bitişi (trialEnd)
     saklanır; ilk ödeme o gün başlar.
   - Bitişe 2 gün kala ve o gün Özet'te (ve sabah bildiriminde) hatırlatılır:
     "İptal ettim" → ödeme hiç başlamaz · "Devam ediyorum" → hatırlatma kapanır.
   ===================================================================== */

function trialLeft(r) {
  if (!r.trialEnd || r.trialAck || r.paused) return null;
  const d = dayDiff(fromISO(todayISO()), fromISO(r.trialEnd));
  return d;
}

function trialTodos() {
  return db.recurring.filter((r) => { const d = trialLeft(r); return d != null && d <= 2 && d >= -3; }).map((r) => {
    const d = trialLeft(r);
    return `<div class="todo wrap">
      <span class="todo-ico ${d <= 0 ? 'late' : 'soon'}">${icon('clock', 18)}</span>
      <span class="todo-main"><b>${esc(recName(r))} denemesi ${d < 0 ? 'bitti' : d === 0 ? 'bugün bitiyor' : `${d} gün sonra bitiyor`}</b><small>Devam etmeyeceksen iptal et · sonra ${money(r.amount)} ${esc(freqText(r).toLocaleLowerCase('tr'))}</small></span>
      <span class="todo-btns"><button class="btn small" data-action="trial-cancel" data-id="${r.id}">İptal ettim</button><button class="btn small ok" data-action="trial-keep" data-id="${r.id}">Devam</button></span>
    </div>`;
  });
}

const trialBadge = (r) => {
  const d = trialLeft(r);
  return d == null || d < 0 ? '' : ` <span class="lchip"><i></i>Deneme · ${d === 0 ? 'bugün bitiyor' : `${d} gün`}</span>`;
};

Object.assign(actions, {
  'trial-cancel': (el) => {
    const r = db.recurring.find((x) => x.id === el.dataset.id);
    if (!r) return;
    // Ödeme hiç başlamasın: bitiş, deneme bitişinden bir gün önce
    r.endDate = toISO(addDays(fromISO(r.trialEnd), -1));
    r.count = null;
    r.trialAck = true;
    r.updatedAt = Date.now();
    touch('rec', r.id);
    save();
    render();
    toast(`${recName(r)} iptal edildi; ödeme beklenmeyecek`);
  },
  'trial-keep': (el) => {
    const r = db.recurring.find((x) => x.id === el.dataset.id);
    if (!r) return;
    r.trialAck = true;
    r.updatedAt = Date.now();
    touch('rec', r.id);
    save();
    render();
    toast(`${recName(r)} devam ediyor · ilk ödeme ${fullDay(r.trialEnd)}`);
  },
  'rf-trial': () => {
    syncRecForm();
    recForm.trial = !recForm.trial;
    if (recForm.trial && !recForm.trialEnd) recForm.trialEnd = toISO(addDays(fromISO(todayISO()), 30));
    renderRecForm();
  },
});
