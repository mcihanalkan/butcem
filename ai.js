'use strict';

/* =====================================================================
   AI Bütçe Koçu — Google Gemini (Firebase AI Logic üzerinden).
   API anahtarı uygulamada tutulmaz; çağrılar Firebase projesi üzerinden gider.
   Gizlilik: AI'a sadece kategori toplamları ve limitler gönderilir; notlar gönderilmez.
   ===================================================================== */

// İlki yoksa ya da kapatılmışsa sıradakine geçilir.
const AI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const AI_KEY = 'butce.ai.v1';

const AI_SYSTEM = `Sen Türkçe konuşan, samimi ama net bir kişisel bütçe koçusun.
- Sadece sana verilen verilere dayan; rakam uydurma. Tutarlar ${'Türk lirası'} cinsindendir ve tam sayıya yuvarlanmıştır.
- Hisse, kripto, döviz, fon gibi yatırım tavsiyesi verme; sadece harcama, bütçe ve tasarruf alışkanlıkları hakkında konuş.
- Kısa, somut ve uygulanabilir ol. Suçlayıcı olma, motive et.
- Ay, kullanıcının "ay başlangıç günü"ne göre hesaplanır; "donem" alanı bu aralığı gösterir.`;

const aiState = { loading: false, error: '', result: null, asking: false, chat: [] };
try {
  const saved = JSON.parse(localStorage.getItem(AI_KEY) || 'null');
  if (saved) { aiState.result = saved.result || null; aiState.chat = saved.chat || []; }
} catch {}
function saveAi() {
  try { localStorage.setItem(AI_KEY, JSON.stringify({ result: aiState.result, chat: aiState.chat.slice(-6) })); } catch {}
}

async function aiGenerate(prompt, json) {
  if (!sync.app) await initSync();
  if (!sync.app) throw new Error('offline');
  const mod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-ai.js`);
  const ai = mod.getAI(sync.app, { backend: new mod.GoogleAIBackend() });
  let lastErr;
  for (const name of AI_MODELS) {
    try {
      const model = mod.getGenerativeModel(ai, {
        model: name,
        systemInstruction: AI_SYSTEM,
        generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.4 } : { temperature: 0.6 },
      });
      const res = await model.generateContent(prompt);
      return res.response.text();
    } catch (e) {
      lastErr = e;
      console.warn('AI', name, e);
      // Model bulunamadıysa sıradakini dene; başka hatalarda dur.
      if (!/not.?found|404|not supported|unsupported|deprecated|no longer available/i.test(String(e?.message))) break;
    }
  }
  throw lastErr;
}

function aiErrorText(e) {
  const m = String(e?.message || e);
  if (m === 'offline' || /network|failed to fetch/i.test(m)) return 'İnternet bağlantısı yok gibi görünüyor.';
  if (/api.?not.?enabled|firebasevertexai|firebaseml|ai logic|has not been used|PERMISSION_DENIED|403/i.test(m)) return 'AI özelliği Firebase projesinde henüz açılmamış (Firebase konsolu → AI Logic → Get started).';
  if (/quota|429|RESOURCE_EXHAUSTED|rate/i.test(m)) return 'Ücretsiz AI kullanım sınırına ulaşıldı. Biraz sonra tekrar dene.';
  return `AI yanıt veremedi: ${m.slice(0, 160)}`;
}

/* ------------------------------ bağlam ------------------------------ */

const tl = (k) => Math.round(k / 100);

function aiContext() {
  const today = todayISO();
  const per = budgetPeriod(today);
  const list = txIn(per);
  const t = totals(list);
  const months = pastMonths(3, today);
  const first = db.transactions.reduce((m, x) => (x.date < m ? x.date : m), '9999');
  const usedMonths = months.filter((p) => p.end >= first);
  const avgByCat = {};
  for (const p of usedMonths) for (const r of byCategory(txIn(p), 'expense')) avgByCat[r.cat.name] = (avgByCat[r.cat.name] || 0) + r.sum / usedMonths.length;
  const elapsed = dayDiff(fromISO(per.start), fromISO(today)) + 1;
  return {
    bugun: today,
    donem: `${per.start} – ${per.end} (${per.label})`,
    gecenGun: elapsed,
    toplamGun: per.days,
    buAy: { gelir: tl(t.inc), gider: tl(t.exp), islemSayisi: list.length },
    buAyKategoriler: byCategory(list, 'expense').map((r) => ({ kategori: r.cat.name, tutar: tl(r.sum), islem: r.count })),
    buAyGelirler: byCategory(list, 'income').map((r) => ({ kategori: r.cat.name, tutar: tl(r.sum) })),
    limitler: db.budgets.map((b) => {
      const s = budgetStatus(b, per);
      return { ad: budgetName(b), limit: tl(s.limit), harcanan: tl(s.spent), ayninSonuTahmini: s.projected != null ? tl(s.projected) : null, durum: LEVEL_META[s.level].label };
    }),
    son3Ay: usedMonths.map((p) => { const x = totals(txIn(p)); return { donem: p.label, gelir: tl(x.inc), gider: tl(x.exp) }; }),
    son3AyKategoriOrtalamasi: Object.entries(avgByCat).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => ({ kategori: k, ortalama: tl(v) })),
    giderKategorileri: db.categories.filter((c) => c.type === 'expense').map((c) => c.name),
  };
}

const ANALYSIS_PROMPT = (ctx) => `Kullanıcının bütçe verileri (JSON):
${JSON.stringify(ctx)}

Bu verileri analiz et ve SADECE şu yapıda geçerli bir JSON döndür:
{
  "puan": 0-100 arası tam sayı (finansal sağlık; gelir-gider dengesi, limitlere uyum, tasarruf oranı),
  "puanAciklama": "puanın tek cümlelik gerekçesi",
  "ozet": "durumun 2-3 cümlelik özeti",
  "uyarilar": ["dikkat edilmesi gereken somut noktalar, en fazla 4"],
  "oneriler": [{"baslik": "kısa başlık", "aciklama": "somut ne yapmalı", "aylikTasarruf": tahmini aylık TL tasarruf (tam sayı) ya da null}],
  "limitOnerileri": [{"kategori": "giderKategorileri listesindeki adla birebir aynı", "limit": aylık TL tam sayı, "gerekce": "kısa"}]
}
Kurallar: öneriler en fazla 5, limitOnerileri en fazla 8 olsun. Ayın başındaysa ve veri azsa bunu belirt, abartılı sonuç çıkarma.
Veri çok azsa puanı null yerine 50 ver ve puanAciklama'da yetersiz veri olduğunu söyle.`;

function parseJson(text) {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  return JSON.parse(clean);
}

async function runAnalysis() {
  if (aiState.loading) return;
  aiState.loading = true;
  aiState.error = '';
  render();
  try {
    const out = parseJson(await aiGenerate(ANALYSIS_PROMPT(aiContext()), true));
    aiState.result = { ...out, at: Date.now() };
    saveAi();
  } catch (e) {
    aiState.error = aiErrorText(e);
  } finally {
    aiState.loading = false;
    if (ui.view === 'budget') render();
  }
}

async function askAi(question) {
  question = question.trim();
  if (!question || aiState.asking) return;
  aiState.asking = true;
  aiState.error = '';
  aiState.chat.push({ q: question, a: null });
  render();
  try {
    const history = aiState.chat.slice(-4, -1).map((c) => `Kullanıcı: ${c.q}\nKoç: ${c.a}`).join('\n\n');
    const prompt = `Kullanıcının bütçe verileri (JSON):\n${JSON.stringify(aiContext())}\n\n${history ? `Önceki konuşma:\n${history}\n\n` : ''}Kullanıcının sorusu: ${question}\n\nKısa ve net cevap ver (en fazla 8 satır). Gerekirse madde işareti kullan.`;
    aiState.chat[aiState.chat.length - 1].a = (await aiGenerate(prompt, false)).trim();
    saveAi();
  } catch (e) {
    aiState.chat.pop();
    aiState.error = aiErrorText(e);
  } finally {
    aiState.asking = false;
    if (ui.view === 'budget') render();
  }
}

/* ------------------------------ görünüm ------------------------------ */

// Basit biçim: **kalın**, satır başı "- " → madde
function aiText(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n').map((l) => l.replace(/^\s*[-*•]\s+/, '• ')).join('<br>');
}

function findExpenseCat(name) {
  const n = String(name || '').toLocaleLowerCase('tr').trim();
  return db.categories.find((c) => c.type === 'expense' && c.name.toLocaleLowerCase('tr') === n);
}

function aiCard() {
  if (!syncConfigured()) return '';
  const r = aiState.result;
  const head = `<div class="between" style="margin-bottom:6px"><h3 style="margin:0">🤖 AI Bütçe Koçu</h3>${r?.at ? `<small class="muted">${new Date(r.at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>` : ''}</div>`;
  if (!sync.user) {
    return `<div class="card ai-card">${head}<p class="muted" style="font-size:13px">AI koçu kullanmak için önce <b>Ayarlar → Google ile giriş yap</b>.</p></div>`;
  }
  const score = Number.isFinite(r?.puan) ? Math.max(0, Math.min(100, r.puan)) : null;
  const scoreColor = score == null ? 'var(--muted)' : score >= 70 ? 'var(--inc)' : score >= 45 ? '#f59e0b' : 'var(--exp)';
  const limits = (r?.limitOnerileri || []).map((x) => ({ ...x, cat: findExpenseCat(x.kategori) })).filter((x) => x.cat && x.limit > 0);

  return `<div class="card ai-card">${head}
    ${r ? `
      <div class="ai-top">
        ${score != null ? `<div class="score" style="--p:${score};--c:${scoreColor}"><b>${score}</b><small>/100</small></div>` : ''}
        <div style="flex:1;min-width:0">${r.puanAciklama ? `<b style="font-size:14px">${esc(r.puanAciklama)}</b>` : ''}<p style="margin:4px 0 0;font-size:14px">${aiText(r.ozet || '')}</p></div>
      </div>
      ${r.uyarilar?.length ? `<ul class="alerts" style="margin-top:12px">${r.uyarilar.map((u) => `<li class="warn">⚠️ ${esc(u)}</li>`).join('')}</ul>` : ''}
      ${r.oneriler?.length ? `<h4>Öneriler</h4><div class="tips">${r.oneriler.map((o) => `<div class="tip"><b>💡 ${esc(o.baslik)}</b>${o.aylikTasarruf ? `<span class="inc">≈ ${moneyRound(o.aylikTasarruf * 100)}/ay</span>` : ''}<p>${esc(o.aciklama)}</p></div>`).join('')}</div>` : ''}
      ${limits.length ? `<h4>Önerilen limitler</h4>
        ${limits.map((x, i) => {
          const cur = db.budgets.find((b) => b.scope === 'cat' && b.categoryId === x.cat.id);
          return `<div class="free-row"><span class="ico" style="--c:${x.cat.color}">${esc(x.cat.icon)}</span>
            <span style="flex:1;min-width:0"><b>${esc(x.cat.name)}: ${moneyRound(x.limit * 100)}</b><small class="muted" style="display:block">${esc(x.gerekce || '')}${cur ? ` · şu an ${moneyRound(cur.amount)}` : ''}</small></span>
            <button class="btn small" data-action="ai-apply" data-i="${i}">${cur ? 'Güncelle' : 'Uygula'}</button></div>`;
        }).join('')}
        <button class="btn block" style="margin-top:8px" data-action="ai-apply-all">Tüm önerilen limitleri uygula</button>` : ''}
    ` : `<p class="muted" style="font-size:13px;margin-top:0">Harcamalarını ve limitlerini inceleyip sana finansal sağlık puanı, uyarılar, tasarruf önerileri ve kategori limitleri önerir.</p>`}
    <button class="btn primary block" style="margin-top:12px" data-action="ai-analyze" ${aiState.loading ? 'disabled' : ''}>${aiState.loading ? '⏳ Analiz ediliyor…' : r ? '🔄 Yeniden analiz et' : '✨ Bütçemi analiz et'}</button>
    ${aiState.error ? `<p class="exp" style="font-size:13px">${esc(aiState.error)}</p>` : ''}
    <div class="ai-chat">
      ${aiState.chat.slice(-3).map((c) => `<div class="q">🙋 ${esc(c.q)}</div><div class="a">${c.a == null ? '⏳ Düşünüyor…' : aiText(c.a)}</div>`).join('')}
      <form class="ai-ask" data-ai-ask>
        <input id="ai-q" placeholder="Koça sor: ör. Market harcamamı nasıl azaltırım?" maxlength="300" autocomplete="off">
        <button class="btn primary" ${aiState.asking ? 'disabled' : ''}>Sor</button>
      </form>
    </div>
    <p class="muted" style="font-size:11px;margin:10px 0 0">AI'a sadece kategori toplamları ve limitlerin gönderilir; notların gönderilmez. AI hata yapabilir, önemli kararlarda kendi değerlendirmeni yap.</p>
  </div>`;
}

function applyAiLimit(x) {
  const cur = db.budgets.find((b) => b.scope === 'cat' && b.categoryId === x.cat.id);
  upsertBudget({ id: cur?.id, scope: 'cat', categoryId: x.cat.id, amount: Math.round(x.limit) * 100, alertAt: cur?.alertAt || 80, rollover: !!cur?.rollover });
}

function aiLimits() {
  return (aiState.result?.limitOnerileri || []).map((x) => ({ ...x, cat: findExpenseCat(x.kategori) })).filter((x) => x.cat && x.limit > 0);
}

Object.assign(actions, {
  'ai-analyze': () => runAnalysis(),
  'ai-apply': (el) => {
    const x = aiLimits()[Number(el.dataset.i)];
    if (!x) return;
    applyAiLimit(x);
    save();
    render();
    toast(`${x.cat.name} limiti ${moneyRound(x.limit * 100)} oldu ✓`);
  },
  'ai-apply-all': () => {
    const list = aiLimits();
    if (!list.length || !confirm(`${list.length} limit uygulansın mı?`)) return;
    list.forEach(applyAiLimit);
    save();
    render();
    toast(`${list.length} limit uygulandı ✓`);
  },
});

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-ai-ask]')) return;
  e.preventDefault();
  const q = $('#ai-q').value;
  askAi(q);
});
