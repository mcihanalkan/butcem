'use strict';

/* =====================================================================
   Belge ve garanti kasası
   - Garantiler, kimlik/belgeler (pasaport, ehliyet), sözleşme/taahhütler, sigortalar.
   - Bitiş tarihinden "remind" gün önce Özet'te ve sabah bildiriminde hatırlatılır.
   - Fotoğraf saklanmaz; belge numarası gibi bilgiler nota yazılabilir.
   ===================================================================== */

const VAULT_KINDS = {
  warranty: { label: 'Garanti', icon: 'shield-check', ph: 'ör. Bulaşık makinesi, iPhone 16' },
  id: { label: 'Kimlik / belge', icon: 'id-card', ph: 'ör. Pasaport, Ehliyet, Kimlik kartı' },
  contract: { label: 'Sözleşme / taahhüt', icon: 'file-text', ph: 'ör. İnternet taahhüdü, Kira sözleşmesi' },
  insurance: { label: 'Sigorta / poliçe', icon: 'shield', ph: 'ör. DASK, Konut sigortası, Kasko' },
  other: { label: 'Diğer', icon: 'tag', ph: 'ör. Spor salonu üyeliği' },
};
ui.vaultTab = ui.vaultTab || 'all';
let vaultForm = null;

const vaultLeft = (x) => (x.expiry ? dayDiff(fromISO(todayISO()), fromISO(x.expiry)) : null);

function leftText(d) {
  if (d == null) return 'Bitiş tarihi yok';
  if (d < 0) return `${-d} gün önce bitti`;
  if (d === 0) return 'Bugün bitiyor';
  if (d < 60) return `${d} gün kaldı`;
  const m = Math.round(d / 30.4);
  return m < 12 ? `${m} ay kaldı` : `${Math.floor(m / 12)} yıl${m % 12 ? ` ${m % 12} ay` : ''} kaldı`;
}

function vaultRow(x) {
  const K = VAULT_KINDS[x.kind] || VAULT_KINDS.other;
  const d = vaultLeft(x);
  const lvl = d == null ? '' : d < 0 ? 'gone' : d <= (x.remind || 30) ? 'soon' : '';
  return `<button class="tx vault-row ${lvl}" data-action="vault-edit" data-id="${x.id}">
    <span class="ico" style="--c:#5F6B7A">${icon(K.icon, 18)}</span>
    <span class="tx-main"><b>${esc(x.title)}</b><small>${[K.label, x.place, x.expiry ? `bitiş ${fullDay(x.expiry)}` : ''].filter(Boolean).map(esc).join(' · ')}</small></span>
    <span class="vault-left ${lvl}">${esc(leftText(d))}</span>
  </button>`;
}

function viewVault() {
  const back = `<button class="back" data-action="nav" data-view="more">${icon('chevron-left', 18)} Diğer</button>`;
  const head = viewHead('Belgeler ve garantiler', `<button class="btn small" data-action="vault-new">+ Ekle</button>`);
  if (!db.vault.length) {
    return `${back}${head}<div class="card empty-card"><span class="empty-ico">${icon('shield-check', 26)}</span><b>Garantilerini ve belgelerini ekle</b>
      <p>Garantinin, pasaportunun, internet taahhüdünün ya da sigortanın bitişini unutma; zamanı gelince hatırlatayım.</p>
      <div class="btn-stack">${Object.entries(VAULT_KINDS).slice(0, 4).map(([k, v]) => `<button class="btn" data-action="vault-new" data-kind="${k}">${icon(v.icon, 18)} ${v.label}</button>`).join('')}</div></div>`;
  }
  const tab = ui.vaultTab;
  const list = db.vault.filter((x) => tab === 'all' || x.kind === tab)
    .sort((a, b) => (a.expiry || '9999').localeCompare(b.expiry || '9999'));
  const soon = list.filter((x) => { const d = vaultLeft(x); return d != null && d >= -30 && d <= Math.max(60, x.remind || 30); });
  const rest = list.filter((x) => !soon.includes(x));
  const active = rest.filter((x) => vaultLeft(x) == null || vaultLeft(x) >= 0);
  const gone = rest.filter((x) => vaultLeft(x) != null && vaultLeft(x) < 0);
  const kinds = [['all', 'Tümü'], ...Object.entries(VAULT_KINDS).filter(([k]) => db.vault.some((x) => x.kind === k)).map(([k, v]) => [k, v.label])];
  return `${back}${head}
    ${kinds.length > 2 ? `<div class="chips wrap" style="margin-bottom:12px">${kinds.map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-action="vault-tab" data-val="${k}">${esc(l)}</button>`).join('')}</div>` : ''}
    ${soon.length ? `<h2 class="sec">Yaklaşanlar</h2><div class="list">${soon.map(vaultRow).join('')}</div>` : ''}
    ${active.length ? `<h2 class="sec">${soon.length ? 'Diğerleri' : 'Kayıtlar'}</h2><div class="list">${active.map(vaultRow).join('')}</div>` : ''}
    ${gone.length ? `<h2 class="sec">Süresi bitenler</h2><div class="list faded">${gone.map(vaultRow).join('')}</div>` : ''}`;
}

/* ------------------------------ form ------------------------------ */

function openVaultForm(init = {}) {
  vaultForm = { id: null, kind: 'warranty', title: '', place: '', amountText: '', start: todayISO(), expiry: '', remind: 30, note: '', txId: null, ...init };
  if (!vaultForm.expiry && vaultForm.kind === 'warranty' && !vaultForm.id) vaultForm.expiry = toISO(new Date(fromISO(vaultForm.start).getFullYear() + 2, fromISO(vaultForm.start).getMonth(), fromISO(vaultForm.start).getDate()));
  renderVaultForm();
}

function syncVaultForm() {
  if (!vaultForm || !$('#v-title')) return;
  const v = (id) => $(id)?.value ?? '';
  Object.assign(vaultForm, { title: v('#v-title'), place: v('#v-place'), amountText: v('#v-amount'), start: v('#v-start'), expiry: v('#v-expiry'), note: v('#v-note') });
}

function renderVaultForm() {
  const f = vaultForm;
  const K = VAULT_KINDS[f.kind];
  const w = f.kind === 'warranty';
  const years = (n) => { const s = fromISO(f.start || todayISO()); return toISO(new Date(s.getFullYear() + n, s.getMonth(), s.getDate())); };
  openSheet(`
    <div class="sheet-head"><h2>${f.id ? 'Kaydı düzenle' : 'Yeni kayıt'}</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="opt-grid field vault-kinds">${Object.entries(VAULT_KINDS).map(([k, v]) => `<button class="${f.kind === k ? 'on' : ''}" data-action="vf-kind" data-val="${k}">${icon(v.icon, 16)} ${v.label}</button>`).join('')}</div>
    <div class="field"><label>Ad</label><input id="v-title" value="${esc(f.title)}" maxlength="60" placeholder="${esc(K.ph)}"></div>
    ${w || f.kind === 'contract' || f.kind === 'insurance' ? `<div class="row field">
      <div><label class="lbl">${w ? 'Nereden alındı' : 'Firma'}</label><input id="v-place" value="${esc(f.place)}" maxlength="40" placeholder="${w ? 'ör. Teknosa' : 'ör. Türk Telekom'}"></div>
      <div><label class="lbl">${w ? 'Fiyatı' : 'Tutar'}</label><input id="v-amount" inputmode="decimal" value="${esc(f.amountText)}" placeholder="İsteğe bağlı"></div>
    </div>` : ''}
    <div class="row field">
      <div><label class="lbl">${w ? 'Alış tarihi' : f.kind === 'id' ? 'Veriliş tarihi' : 'Başlangıç'}</label><input type="date" id="v-start" value="${f.start || ''}"></div>
      <div><label class="lbl">${f.kind === 'id' ? 'Geçerlilik sonu' : 'Bitiş tarihi'}</label><input type="date" id="v-expiry" value="${f.expiry || ''}"></div>
    </div>
    <div class="chips wrap" style="margin:-6px 0 14px">
      ${(w ? [1, 2, 3] : f.kind === 'id' ? [5, 10] : [1, 2]).map((n) => `<button class="chip" data-action="vf-years" data-val="${years(n)}">${n} yıl</button>`).join('')}
    </div>
    <div class="field"><label>Ne zaman hatırlatayım?</label>
      <div class="seg">${[[7, '1 hafta önce'], [30, '1 ay önce'], [60, '2 ay önce']].map(([n, l]) => `<button data-action="vf-remind" data-val="${n}" class="${f.remind === n ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="field"><label>Not</label><input id="v-note" value="${esc(f.note)}" maxlength="120" placeholder="${f.kind === 'id' ? 'ör. belge no, nereden yenilenir' : 'ör. seri no, fatura nerede'}"></div>
    <div class="actions">
      ${f.id ? `<button class="btn danger" data-action="vf-delete">Sil</button>` : ''}
      <button class="btn primary" data-action="vf-save">Kaydet</button>
    </div>`);
  if (!f.id && !f.title) setTimeout(() => $('#v-title')?.focus(), 60);
}

function saveVault() {
  syncVaultForm();
  const f = vaultForm;
  if (!f.title.trim()) { $('#v-title').classList.add('invalid'); toast('Bir ad yaz'); return; }
  if (f.expiry && f.start && f.expiry < f.start) { toast('Bitiş, başlangıçtan önce olamaz'); return; }
  const amount = f.amountText.trim() ? parseAmount(f.amountText) : null;
  const now = Date.now();
  const data = { kind: f.kind, title: f.title.trim(), place: f.place.trim(), amount: Number.isFinite(amount) ? amount : null, start: f.start || null, expiry: f.expiry || null, remind: f.remind, note: f.note.trim(), txId: f.txId || null, updatedAt: now };
  let id = f.id;
  const cur = id && db.vault.find((x) => x.id === id);
  if (cur) { if (cur.expiry !== data.expiry) data.ackFor = null; Object.assign(cur, data); }
  else { id = uid(); db.vault.push({ id, createdAt: now, ...data }); }
  touch('vault', id);
  save();
  closeSheet();
  if (ui.view !== 'vault') goTo('vault'); else render();
  toast(data.expiry ? `Kaydedildi · ${leftText(dayDiff(fromISO(todayISO()), fromISO(data.expiry))).toLocaleLowerCase('tr')}` : 'Kaydedildi');
}

function deleteVault() {
  const x = db.vault.find((v) => v.id === vaultForm.id);
  if (!x || !confirm(`"${x.title}" silinsin mi?`)) return;
  db.vault = db.vault.filter((v) => v.id !== x.id);
  db.deleted.push({ id: x.id, kind: 'vault', at: Date.now(), data: x });
  touch('vault', x.id);
  save();
  closeSheet();
  render();
  toast('Silindi');
}

// Özet'te: hatırlatma zamanı gelmiş ve "tamam" denmemiş kayıtlar
function vaultTodos() {
  return db.vault.filter((x) => { const d = vaultLeft(x); return d != null && d <= (x.remind || 30) && d >= -7 && x.ackFor !== x.expiry; })
    .sort((a, b) => a.expiry.localeCompare(b.expiry)).map((x) => {
      const d = vaultLeft(x);
      const K = VAULT_KINDS[x.kind] || VAULT_KINDS.other;
      return `<div class="todo wrap">
        <span class="todo-ico ${d <= 7 ? 'late' : 'soon'}">${icon(K.icon, 18)}</span>
        <span class="todo-main"><b>${esc(x.title)} · ${esc(leftText(d).toLocaleLowerCase('tr'))}</b><small>${K.label} · bitiş ${fullDay(x.expiry)}${x.place ? ` · ${esc(x.place)}` : ''}</small></span>
        <span class="todo-btns"><button class="btn small" data-action="vault-edit" data-id="${x.id}">${x.kind === 'warranty' ? 'Aç' : 'Yeniledim'}</button><button class="btn small ok" data-action="vault-ack" data-id="${x.id}">Tamam</button></span>
      </div>`;
    });
}

Object.assign(actions, {
  'vault-new': (el) => openVaultForm({ kind: el.dataset.kind || 'warranty' }),
  'vault-edit': (el) => {
    const x = db.vault.find((v) => v.id === el.dataset.id);
    if (x) openVaultForm({ ...x, amountText: x.amount != null ? amountToInput(x.amount) : '', remind: x.remind || 30 });
  },
  'vault-tab': (el) => { ui.vaultTab = el.dataset.val; render(); },
  'vault-ack': (el) => {
    const x = db.vault.find((v) => v.id === el.dataset.id);
    if (!x) return;
    x.ackFor = x.expiry; x.updatedAt = Date.now(); touch('vault', x.id); save(); render();
  },
  'vf-kind': (el) => { syncVaultForm(); vaultForm.kind = el.dataset.val; renderVaultForm(); },
  'vf-years': (el) => { syncVaultForm(); vaultForm.expiry = el.dataset.val; renderVaultForm(); },
  'vf-remind': (el) => { syncVaultForm(); vaultForm.remind = Number(el.dataset.val); $$('[data-action="vf-remind"]').forEach((b) => b.classList.toggle('on', b === el)); },
  'vf-save': () => saveVault(),
  'vf-delete': () => deleteVault(),
  // İşlem formundan: bu harcamayı garantiye ekle
  'tx-warranty': (el) => {
    const t = db.transactions.find((x) => x.id === el.dataset.id);
    if (!t) return;
    closeSheet();
    setTimeout(() => openVaultForm({ kind: 'warranty', title: t.note || (catMap()[t.categoryId] || MISSING_CAT).name, place: '', amountText: amountToInput(t.amount), start: t.date, txId: t.id }), 80);
  },
});

VIEWS.vault = viewVault;
SUB_PAGES.push('vault');
