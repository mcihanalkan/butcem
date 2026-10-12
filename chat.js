'use strict';

/* =====================================================================
   Bütçe asistanı (sohbet)
   - Verilere bakarak soruları cevaplar: aylık özet, kategoriler, mağazalar,
     alışkanlıklar, ay sonu tahmini, borçlar, hedefler.
   - Sohbet bu cihazda saklanır (son 40 mesaj).
   ===================================================================== */

const CHAT_KEY = 'butce.chat.v1';
const chat = { msgs: [], busy: false, error: '' };
try { chat.msgs = JSON.parse(localStorage.getItem(CHAT_KEY) || '[]'); } catch {}
function saveChat() { try { localStorage.setItem(CHAT_KEY, JSON.stringify(chat.msgs.slice(-40))); } catch {} }

const CHAT_SUGGEST = [
  'Bu ay nerede fazla harcadım?',
  'Ay sonuna kadar param yeter mi?',
  'Hangi aboneliklerden vazgeçebilirim?',
  'Ayda ne kadar biriktirebilirim?',
  'Geçen aya göre ne değişti?',
  'Kart borcumu nasıl kapatırım?',
];

// Sohbet için ek bağlam: mağazalar, alışkanlıklar, tahmin
function chatContext() {
  const ctx = aiContext();
  const today = todayISO();
  const months = pastMonths(3, today);
  const shops = new Map();
  for (const t of db.transactions) {
    if (t.type !== 'expense' || isPlanned(t) || t.feeOf || !t.note) continue;
    const i = months.findIndex((p) => t.date >= p.start && t.date <= p.end);
    if (i < 0) continue;
    const k = learnKey(t.note);
    if (!k) continue;
    if (!shops.has(k)) shops.set(k, { ad: t.note.trim(), aylar: months.map(() => 0), islem: 0 });
    const s = shops.get(k);
    s.aylar[i] += t.amount;
    s.islem++;
  }
  ctx.aylar = months.map((p) => p.label);
  ctx.magazalar = [...shops.values()].sort((a, b) => b.aylar.reduce((x, y) => x + y, 0) - a.aylar.reduce((x, y) => x + y, 0))
    .slice(0, 30).map((s) => ({ ad: s.ad, aylikTutar: s.aylar.map(tl), islem: s.islem }));
  try { ctx.aliskanliklar = habits().map(habitText); } catch {}
  try {
    const f = forecast();
    ctx.aySonuTahmini = { tur: f.mode === 'balance' ? 'banka+nakit bakiyesi' : 'ayın kalanı', bugun: tl(f.start), aySonu: tl(f.end), enDusuk: f.low ? { tarih: f.low.date, tutar: tl(f.low.value) } : null, gunlukHarcamaOrt: tl(f.daily) };
  } catch {}
  try {
    const d = planDebts();
    if (d.length) ctx.borcPlani = d.map((x) => ({ ad: x.name, kalan: tl(x.balance), aylikFaizYuzde: x.rate || null }));
  } catch {}
  return ctx;
}

async function sendChat(text) {
  text = String(text || '').trim();
  if (!text || chat.busy) return;
  if (!sync.user) { toast('Asistan için önce Ayarlar\'dan Google ile giriş yap'); return; }
  chat.busy = true;
  chat.error = '';
  chat.msgs.push({ role: 'user', text, at: Date.now() });
  saveChat();
  renderChat(true);
  try {
    const history = chat.msgs.slice(-11, -1).map((m) => `${m.role === 'user' ? 'Kullanıcı' : 'Sen'}: ${m.text}`).join('\n');
    const prompt = `Kullanıcının finansal verileri (JSON, tutarlar TL):\n${JSON.stringify(chatContext())}\n\n${history ? `Önceki konuşma:\n${history}\n\n` : ''}Kullanıcı: ${text}\n\nVerilere dayanarak cevap ver. Kısa ve net ol (genelde 3-8 satır), rakam ver, gerekirse madde işareti kullan. Veride olmayan bir şey sorulursa bunu açıkça söyle. Uygulamada yapılabilecek bir adım varsa (limit koymak, borç planına bakmak gibi) kısaca öner.`;
    const answer = (await aiGenerate(prompt, false)).trim();
    chat.msgs.push({ role: 'ai', text: answer, at: Date.now() });
    saveChat();
  } catch (e) {
    chat.error = aiErrorText(e);
  } finally {
    chat.busy = false;
    renderChat(true);
  }
}

function chatMsgs() {
  if (!chat.msgs.length) {
    return `<div class="chat-empty">
      <span class="empty-ico">${icon('message-circle', 26)}</span>
      <b>Bütçen hakkında ne merak ediyorsun?</b>
      <p>Harcamalarına, kartlarına, borçlarına ve hedeflerine bakarak cevaplarım.</p>
      <div class="chat-suggest">${CHAT_SUGGEST.map((s) => `<button class="chip" data-action="chat-ask" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    </div>`;
  }
  return chat.msgs.map((m) => `<div class="msg ${m.role}">${m.role === 'ai' ? aiText(m.text) : esc(m.text)}</div>`).join('')
    + (chat.busy ? '<div class="msg ai typing"><i></i><i></i><i></i></div>' : '')
    + (chat.error ? `<div class="msg err">${esc(chat.error)}</div>` : '')
    + (!chat.busy ? `<div class="chat-suggest more">${CHAT_SUGGEST.filter((s) => !chat.msgs.some((m) => m.text === s)).slice(0, 3).map((s) => `<button class="chip" data-action="chat-ask" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '');
}

function viewChat() {
  const back = `<button class="back" data-action="nav" data-view="home">${icon('chevron-left', 18)} Özet</button>`;
  const right = chat.msgs.length ? `<button class="btn small" data-action="chat-clear">Yeni sohbet</button>` : '';
  return `${back}
    ${viewHead('Asistan', right)}
    <div class="chat" id="chat-box">${chatMsgs()}</div>
    <form class="chat-in" data-chat>
      <input id="chat-q" placeholder="Bir şey sor…" maxlength="400" autocomplete="off" enterkeyhint="send" ${chat.busy ? 'disabled' : ''}>
      <button class="btn primary" aria-label="Gönder" ${chat.busy ? 'disabled' : ''}>${icon('send', 18)}</button>
    </form>
    <p class="muted chat-note">Cevaplar için özet rakamlar ve mağaza adları kullanılır. Öneriler bilgilendirme amaçlıdır.</p>`;
}

function renderChat(scroll) {
  if (ui.view !== 'chat') return;
  const box = $('#chat-box');
  if (!box) return render();
  box.innerHTML = chatMsgs();
  const inp = $('#chat-q'), btn = $('.chat-in button');
  if (inp) inp.disabled = chat.busy;
  if (btn) btn.disabled = chat.busy;
  if (scroll) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  if (!chat.busy) inp?.focus();
}

VIEWS.chat = viewChat;
SUB_PAGES.push('chat');

Object.assign(actions, {
  'chat-ask': (el) => sendChat(el.dataset.q),
  'chat-clear': () => { chat.msgs = []; chat.error = ''; saveChat(); render(); },
  'chat-open': () => { goTo('chat'); setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 50); },
});

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-chat]')) return;
  e.preventDefault();
  const inp = $('#chat-q');
  const v = inp.value;
  inp.value = '';
  sendChat(v);
});
