'use strict';

/* =====================================================================
   Akıllı giriş
   1) Kişisel öğrenme: aynı açıklamayı/mağazayı hangi kategori ve kartla
      girdiğini hatırlar; yazınca kendiliğinden önerir.
   2) Hızlı giriş: "markete 250, kahveye 80 bonusla" gibi bir cümleden
      bir ya da birden çok işlem çıkarır (çevrimiçiyken Gemini, değilse cihazda).
   3) Sesle giriş: telefonun konuşma tanıma özelliğiyle aynı cümleyi söyletir.
   ===================================================================== */

/* ------------------------------ öğrenme ------------------------------ */

// "A101 Kadıköy 18:42" → "a101 kadıköy" (noktalama ve tek başına sayılar atılır, ilk iki kelime; A101 gibi adlar korunur)
const learnKey = (s) => String(s || '').toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !/^\d+$/.test(w)).slice(0, 2).join(' ');

let learnCache = { sig: '', map: new Map() };

function learnIndex() {
  const sig = `${db.transactions.length}:${db.transactions.reduce((m, t) => Math.max(m, t.updatedAt || 0), 0)}`;
  if (learnCache.sig === sig) return learnCache.map;
  const map = new Map();
  for (const t of db.transactions) {
    if ((t.type !== 'expense' && t.type !== 'income') || !t.note) continue;
    for (const key of new Set([learnKey(t.note), learnKey(t.note).split(' ')[0]])) {
      if (!key || key.length < 2) continue;
      const e = map.get(key) || { n: 0, type: {}, cats: {}, accs: {} };
      e.n++;
      e.type[t.type] = (e.type[t.type] || 0) + 1;
      e.cats[t.categoryId] = (e.cats[t.categoryId] || 0) + 1;
      if (t.accountId) e.accs[t.accountId] = (e.accs[t.accountId] || 0) + 1;
      map.set(key, e);
    }
  }
  learnCache = { sig, map };
  return map;
}

const topOf = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])[0] || [null, 0];

// En az 2 kez aynı şekilde girilmişse ve %60'tan fazlası aynı kategorideyse önerir
function learnedFor(note) {
  const map = learnIndex();
  const k = learnKey(note);
  const e = map.get(k) || map.get(k.split(' ')[0]);
  if (!e || e.n < 2) return null;
  const [cat, cn] = topOf(e.cats);
  const [acc, an] = topOf(e.accs);
  const [type] = topOf(e.type);
  if (!cat || cn / e.n < 0.6 || !catMap()[cat]) return null;
  return { categoryId: cat, accountId: acc && an / e.n >= 0.6 && accById(acc) ? acc : null, type, n: e.n };
}

// İşlem formunda açıklama yazılırken
function applyLearning(note) {
  const hint = $('#f-learn');
  if (!form || form.id) { if (hint) hint.textContent = ''; return; }
  const s = learnedFor(note);
  if (!s) { if (hint) hint.textContent = ''; return; }
  const c = catMap()[s.categoryId];
  if (c.type !== form.type) { if (hint) hint.textContent = ''; return; }
  const parts = [];
  if (!form.catTouched && form.categoryId !== s.categoryId) {
    form.categoryId = s.categoryId;
    $$('.cat-tile').forEach((b) => b.classList.toggle('on', b.dataset.id === form.categoryId));
    parts.push(c.name);
  }
  if (s.accountId && !form.accTouched && form.accountId !== s.accountId) {
    const chip = $(`[data-action="form-acc"][data-id="${s.accountId}"]`);
    if (chip) { form.accountId = pickAccount(chip); parts.push(accById(s.accountId).name); }
  }
  if (hint) hint.textContent = parts.length ? `Daha önceki ${s.n} kaydına göre seçildi: ${parts.join(' · ')}` : '';
}

document.addEventListener('input', (e) => {
  if (e.target.dataset?.input === 'f-note') applyLearning(e.target.value);
});

/* ------------------------------ hızlı giriş ------------------------------ */

const QUICK_SYSTEM = `Sen Türkçe yazılmış ya da söylenmiş kısa harcama/gelir notlarını işlemlere çeviren dikkatli bir asistansın.
- Sadece metinde geçenleri çıkar; uydurma. Tutar yoksa o işlemi ekleme.
- "250", "250 lira", "250 TL", "iki yüz elli", "1.250,50" gibi tutarları sayıya çevir (TL).
- "dün", "evvelsi gün", "cuma", "geçen pazartesi" gibi ifadeleri bugünün tarihine göre YYYY-MM-DD'ye çevir; tarih yoksa bugün.`;

const QUICK_PROMPT = (text) => `Metin: """${text}"""

Bugün: ${todayISO()} (${DAYS[new Date().getDay()]})
Gider kategorileri: ${db.categories.filter((c) => c.type === 'expense').map((c) => c.name).join(', ')}
Gelir kategorileri: ${db.categories.filter((c) => c.type === 'income').map((c) => c.name).join(', ')}
Kart ve hesaplar: ${db.accounts.map((a) => `${a.name}${a.bank ? ` (${a.bank})` : ''}${a.last4 ? ` son4 ${a.last4}` : ''}`).join(', ') || 'yok'}

SADECE şu JSON'u döndür:
{"islemler": [{"tur": "gider" | "gelir", "tutar": sayı, "kategori": "listeden birebir ad", "aciklama": "kısa (mağaza ya da ne olduğu, ör. A101, kahve, maaş)", "hesap": "listedeki kart/hesap adı ya da null", "tarih": "YYYY-MM-DD"}]}`;

// Çevrimdışı yedek: tek işlem, basit kurallar
function localParse(text) {
  const t = String(text).toLocaleLowerCase('tr');
  const m = t.match(/(\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(?:tl|lira|₺)?/);
  if (!m) return [];
  const amount = parseAmount(m[1].replace(/\s/g, ''));
  if (!(amount > 0)) return [];
  const type = /maaş|maas|gelir|geldi|yattı|harçlık|burs|iade|prim|kira geliri/.test(t) ? 'income' : 'expense';
  const acc = db.accounts.find((a) => t.includes(a.name.toLocaleLowerCase('tr')) || (a.bank && t.includes(a.bank.toLocaleLowerCase('tr'))));
  const today = new Date();
  const date = /evvelsi/.test(t) ? toISO(addDays(today, -2)) : /\bdün\b|dun\b/.test(t) ? toISO(addDays(today, -1)) : todayISO();
  const words = t.replace(m[0], ' ').replace(/\b(tl|lira|bugün|dün|evvelsi|gün|ile|ve|için|da|de|ta|te|ya|ye|a|e)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const desc = words.split(' ').filter((w) => w.length > 1 && !(acc && acc.name.toLocaleLowerCase('tr').includes(w))).slice(0, 3).join(' ');
  const learned = learnedFor(desc);
  const byName = db.categories.find((c) => c.type === type && desc && (desc.includes(c.name.toLocaleLowerCase('tr').split(' ')[0])));
  return [{ type, amount, categoryId: learned?.categoryId || byName?.id || null, note: desc ? desc[0].toLocaleUpperCase('tr') + desc.slice(1) : '', accountId: acc?.id || learned?.accountId || '', date }];
}

function fromAi(list) {
  const today = todayISO();
  return (Array.isArray(list) ? list : []).map((x) => {
    const type = x.tur === 'gelir' ? 'income' : 'expense';
    const amount = Math.round(Number(x.tutar) * 100);
    if (!(amount > 0)) return null;
    const note = String(x.aciklama || '').slice(0, 60);
    const learned = learnedFor(note);
    const cat = (learned && catMap()[learned.categoryId]?.type === type ? catMap()[learned.categoryId] : null) || findCat(x.kategori, type) || findCat(type === 'income' ? 'Diğer gelir' : 'Diğer', type);
    const accName = String(x.hesap || '').toLocaleLowerCase('tr');
    const acc = accName ? db.accounts.find((a) => a.name.toLocaleLowerCase('tr') === accName || accName.includes(a.name.toLocaleLowerCase('tr'))) : null;
    const date = validISO(x.tarih) || today;
    return { type, amount, categoryId: cat?.id || null, note: note ? note[0].toLocaleUpperCase('tr') + note.slice(1) : '', accountId: acc?.id || learned?.accountId || lastAccountId(), date };
  }).filter(Boolean);
}

let quickItems = [];

async function quickEntry(text) {
  text = String(text || '').trim();
  if (!text) return;
  const input = $('#quick-in');
  if (input) input.blur();
  let items = [];
  if (navigator.onLine) {
    openSheet(`<div class="scan-loading"><span class="scan-ico">${icon('message-circle', 28)}</span><b>Anlaşılıyor…</b><small>${esc(text)}</small></div>`);
    try {
      const out = parseJson(await aiGenerate(QUICK_PROMPT(text), true, QUICK_SYSTEM, SCAN_FAST));
      items = fromAi(out.islemler);
    } catch (e) { console.warn('Hızlı giriş', e); }
  }
  if (!items.length) items = localParse(text);
  if (!items.length) {
    if (sheetOpen) closeSheet();
    toast('Tutar anlaşılamadı. Ör. "markete 250" ya da "maaş 45.000"');
    return;
  }
  if (input) input.value = '';
  if (items.length === 1) {
    const it = items[0];
    openTxForm({ type: it.type, amountText: amountToInput(it.amount), categoryId: it.categoryId, note: it.note, accountId: it.accountId, date: it.date });
    toast('Kontrol edip kaydet');
    return;
  }
  quickItems = items;
  renderQuickList();
}

function renderQuickList() {
  const cm = catMap();
  const total = quickItems.reduce((a, x) => a + (x.type === 'income' ? x.amount : -x.amount), 0);
  openSheet(`
    <div class="sheet-head"><h2>${quickItems.length} işlem bulundu</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="list" style="border:0">
      ${quickItems.map((x, i) => {
        const c = cm[x.categoryId] || MISSING_CAT;
        const acc = accById(x.accountId);
        return `<div class="tx quick-row">
          <span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span>
          <button class="tx-main" data-action="quick-edit" data-i="${i}"><b>${esc(x.note || c.name)}</b><small>${esc([c.name, acc?.name, x.date !== todayISO() ? fullDay(x.date) : ''].filter(Boolean).join(' · '))}</small></button>
          <span class="amt ${x.type === 'income' ? 'inc' : 'exp'}">${x.type === 'income' ? '+' : '−'}${money(x.amount)}</span>
          <button class="close" data-action="quick-drop" data-i="${i}" aria-label="Çıkar">${icon('x', 16)}</button>
        </div>`;
      }).join('')}
    </div>
    <p class="muted small" style="margin:10px 2px 0">Toplam etki: <b class="${total >= 0 ? 'inc' : 'exp'}">${total >= 0 ? '+' : '−'}${money(Math.abs(total))}</b> · Düzeltmek için satıra dokun.</p>
    <div class="actions"><button class="btn primary" data-action="quick-save-all">${icon('check', 18)} Hepsini kaydet</button></div>
  `);
}

function saveQuickAll() {
  const now = Date.now();
  const today = todayISO();
  for (const x of quickItems) {
    const id = uid();
    db.transactions.push({ id, type: x.type, amount: x.amount, categoryId: x.categoryId, date: x.date, note: x.note, accountId: x.accountId || null, awaiting: x.date > today, createdAt: now, updatedAt: now });
    touch('tx', id);
  }
  const n = quickItems.length;
  quickItems = [];
  save();
  closeSheet();
  render();
  toast(`${n} işlem kaydedildi`);
}

// Listeden biri düzeltilip kaydedilince kalanlara geri dön
function afterTxSaved() {
  if (quickItems.length) setTimeout(renderQuickList, 350);
}

/* ------------------------------ sesle giriş ------------------------------ */

const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;

function startVoice() {
  if (!SpeechRec) { toast('Bu tarayıcı sesle girişi desteklemiyor'); return; }
  if (recog) { recog.stop(); return; }
  const input = $('#quick-in');
  const btn = $('[data-action="quick-voice"]');
  recog = new SpeechRec();
  recog.lang = 'tr-TR';
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  let finalText = '';
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    if (input) input.value = (finalText + interim).trim();
  };
  recog.onerror = (e) => { if (e.error === 'not-allowed') toast('Mikrofon izni verilmedi'); else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Ses anlaşılamadı, tekrar dene'); };
  recog.onend = () => {
    btn?.classList.remove('listening');
    recog = null;
    const text = (finalText || input?.value || '').trim();
    if (text) quickEntry(text);
  };
  btn?.classList.add('listening');
  if (input) { input.value = ''; input.placeholder = 'Dinliyorum… ör. markete 250 bonusla'; }
  recog.start();
}

// Özet ekranının üstündeki hızlı giriş çubuğu
function quickBar() {
  return `<form class="quick-bar" data-quick>
    <span class="qb-ico">${icon('message-circle', 18)}</span>
    <input id="quick-in" placeholder="Ne harcadın? ör. markete 250 bonusla" autocomplete="off" enterkeyhint="send">
    ${SpeechRec ? `<button type="button" class="qb-btn" data-action="quick-voice" aria-label="Sesle söyle">${icon('mic', 18)}</button>` : ''}
    <button type="button" class="qb-btn" data-action="scan-start" aria-label="Fiş tara">${icon('camera', 18)}</button>
  </form>`;
}

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-quick]')) return;
  e.preventDefault();
  quickEntry($('#quick-in').value);
});

Object.assign(actions, {
  'quick-voice': () => startVoice(),
  'quick-drop': (el) => { quickItems.splice(Number(el.dataset.i), 1); if (quickItems.length) renderQuickList(); else closeSheet(); },
  'quick-edit': (el) => {
    const i = Number(el.dataset.i);
    const x = quickItems.splice(i, 1)[0];
    openTxForm({ type: x.type, amountText: amountToInput(x.amount), categoryId: x.categoryId, note: x.note, accountId: x.accountId, date: x.date });
  },
  'quick-save-all': () => saveQuickAll(),
});
