'use strict';

/* =====================================================================
   Bütçe analizi
   1) Hızlı değerlendirme: tamamen cihazda, verilerden hesaplanır (her zaman çalışır).
   2) Detaylı analiz ve soru-cevap: Google Gemini (Firebase AI Logic üzerinden).
      API anahtarı uygulamada tutulmaz; çağrılar Firebase projesi üzerinden gider.
   Gizlilik: modele kategori toplamları, limitler ve özet rakamlar gönderilir; notlar gönderilmez.
   ===================================================================== */

// İlki yoksa ya da kapatılmışsa sıradakine geçilir.
const AI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const AI_KEY = 'butce.ai.v2';

const AI_SYSTEM = `Sen Türkçe konuşan, deneyimli ve net bir kişisel finans danışmanısın.
- Yalnızca sana verilen verilere dayan; rakam uydurma. Tutarlar Türk lirasıdır ve tam sayıya yuvarlanmıştır.
- Her tespiti somut rakamla destekle (ör. "Market'e 3 aylık ortalamandan 1.240 TL fazla harcadın").
- Hisse, kripto, döviz, fon gibi yatırım tavsiyesi verme; harcama, bütçe, borç yönetimi ve tasarruf alışkanlıklarına odaklan.
- Kısa, uygulanabilir ve saygılı ol; suçlama, motive et. Gereksiz giriş cümlesi kurma.
- Ay, kullanıcının "ay başlangıç günü"ne göre hesaplanır; "donem" alanı bu aralığı gösterir.
- Ayın başındaysan ve veri azsa bunu belirt; aşırı genelleme yapma.`;

const aiState = { loading: false, error: '', unavailable: false, result: null, asking: false, chat: [] };
try {
  const saved = JSON.parse(localStorage.getItem(AI_KEY) || 'null');
  if (saved) { aiState.result = saved.result || null; aiState.chat = saved.chat || []; }
} catch {}
function saveAi() {
  try { localStorage.setItem(AI_KEY, JSON.stringify({ result: aiState.result, chat: aiState.chat.slice(-8) })); } catch {}
}

/* ------------------------- hızlı değerlendirme ------------------------- */

const pctStr = (x) => `%${Math.round(x * 100)}`;

function localInsights() {
  const today = todayISO();
  const per = budgetPeriod(today);
  const list = txIn(per);
  const t = totals(list);
  const elapsed = Math.max(1, dayDiff(fromISO(per.start), fromISO(today)) + 1);
  const months = pastMonths(3, today);
  const first = db.transactions.reduce((m, x) => (x.date < m ? x.date : m), '9999');
  const used = months.filter((p) => p.end >= first);
  const hist = used.map((p) => totals(txIn(p)));
  const avgInc = hist.length ? hist.reduce((a, x) => a + x.inc, 0) / hist.length : 0;
  const avgExp = hist.length ? hist.reduce((a, x) => a + x.exp, 0) / hist.length : 0;

  // Ay sonu tahmini (toplam limit varsa onun tahmini, yoksa basit hız tahmini + bekleyen düzenli giderler)
  const total = db.budgets.find((b) => b.scope === 'total');
  const projectedExp = total ? budgetStatus(total, per).projected ?? t.exp
    : elapsed >= 3 ? Math.round((t.exp / elapsed) * per.days) + plannedPending(per) : t.exp + plannedPending(per);
  const income = Math.max(t.inc, avgInc);
  const expectedInc = t.inc + recItems(per).filter((it) => it.rec.type === 'income' && (it.state === 'upcoming' || it.state === 'today' || it.state === 'late')).reduce((a, it) => a + it.rec.amount, 0);
  const incBase = Math.max(expectedInc, income);
  const savingsRate = incBase > 0 ? (incBase - projectedExp) / incBase : null;

  const statuses = db.budgets.map((b) => budgetStatus(b, per));
  const over = statuses.filter((s) => s.level === 'over');
  const warn = statuses.filter((s) => s.level === 'warn' || s.level === 'pace');

  const cards = db.accounts.filter((a) => a.kind === 'credit').map(cardStatus);
  const cardDebt = cards.reduce((a, s) => a + Math.max(0, s.debt), 0);
  const cardLimit = cards.reduce((a, s) => a + (s.limit || 0), 0);
  const util = cardLimit ? cardDebt / cardLimit : null;
  const cardsLate = cards.filter((s) => s.level === 'late');
  const cardsSoon = cards.filter((s) => s.level === 'soon');

  const dt = debtTotals();
  const debtsLate = db.debts.map(debtStatus).filter((s) => s.level === 'late');
  const recLate = recItems(per).filter((it) => it.state === 'late');
  const fixedMonthly = db.recurring.filter((r) => r.type === 'expense' && !r.paused).reduce((a, r) => {
    const f = recFreq(r);
    const k = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, yearly: 1 / 12 }[f] || 1;
    return a + r.amount * k;
  }, 0);

  // Ortalamanın belirgin üstünde giden kategoriler (bu ayın hızına göre)
  const avgByCat = {};
  for (const p of used) for (const r of byCategory(txIn(p), 'expense')) avgByCat[r.id] = (avgByCat[r.id] || 0) + r.sum / used.length;
  const spikes = byCategory(list, 'expense').map((r) => {
    const avg = avgByCat[r.id] || 0;
    // Gerçekçi tahmin: şu ana kadar harcanan + ayın kalanı için her zamanki günlük hızın
    const proj = FIXED_CATS.has(r.id) ? r.sum : Math.round(r.sum + (avg / per.days) * Math.max(0, per.days - elapsed));
    return { r, proj, avg, diff: proj - avg };
  }).filter((x) => x.avg > 0 && x.proj > x.avg * 1.25 && x.diff >= 30000 && elapsed >= 7).sort((a, b) => b.diff - a.diff).slice(0, 3);

  // ---- puan ----
  let score = 70;
  if (savingsRate != null) score += savingsRate >= 0.2 ? 15 : savingsRate >= 0.1 ? 8 : savingsRate >= 0 ? 0 : -20;
  score -= Math.min(24, over.length * 8) + Math.min(9, warn.length * 3);
  if (util != null) score += util > 0.8 ? -15 : util > 0.5 ? -7 : util < 0.3 ? 5 : 0;
  score -= Math.min(24, (cardsLate.length + debtsLate.length + recLate.length) * 8);
  if (dt.owe > 0 && incBase > 0 && dt.owe > incBase * 3) score -= 10;
  const hasData = db.transactions.some((x) => !isPlanned(x));
  score = Math.max(5, Math.min(98, Math.round(score)));
  const label = !hasData ? 'Veri bekleniyor' : score >= 80 ? 'Çok iyi' : score >= 65 ? 'İyi' : score >= 45 ? 'Dikkat' : 'Riskli';

  // ---- tespitler ----
  const findings = [];
  const add = (level, text) => findings.push({ level, text });
  if (savingsRate != null && hasData) {
    if (savingsRate < 0) add('over', `Bu hızla ay sonunda giderin (${money(projectedExp)}) gelirini (${money(incBase)}) ${money(projectedExp - incBase)} aşacak.`);
    else add(savingsRate >= 0.2 ? 'ok' : 'warn', `Ay sonu tahmini: gelirinin ${pctStr(savingsRate)} kadarı (${money(incBase - projectedExp)}) artacak.`);
  }
  for (const s of over) add('over', `${budgetName(s.b)} limiti ${money(-s.remaining)} aşıldı.`);
  for (const s of warn.slice(0, 2)) add('warn', `${budgetName(s.b)}: ${statusMessage(s)}`);
  for (const x of spikes) add('warn', `${x.r.cat.name} bu ay ${money(x.proj)} olacak gibi; 3 aylık ortalaman ${money(Math.round(x.avg))}.`);
  if (util != null && util > 0.5) add(util > 0.8 ? 'over' : 'warn', `Kredi kartı kullanım oranın ${pctStr(util)} (${money(cardDebt)} / ${money(cardLimit)}).`);
  for (const s of cardsLate) add('over', `${s.a.name} son ödeme tarihi geçti; kalan dönem borcu ${money(s.remaining)}.`);
  for (const s of cardsSoon) add('warn', `${s.a.name} son ödemesine ${s.daysToDue} gün var; dönem borcu ${money(s.remaining)}, asgari ${money(s.minDue)}.`);
  for (const s of debtsLate) add('over', `${s.d.person} ${isBorrowed(s.d) ? 'borcunun' : 'alacağının'} vadesi geçti; kalan ${money(s.remaining)}.`);
  if (recLate.length) add('warn', `${recLate.length} düzenli ödeme/gelir onay bekliyor.`);
  if (incBase > 0 && fixedMonthly > incBase * 0.5) add('warn', `Sabit giderlerin (${money(Math.round(fixedMonthly))}/ay) gelirinin ${pctStr(fixedMonthly / incBase)} kadarı.`);

  // ---- öneriler ----
  const tips = [];
  if (spikes[0]) {
    const x = spikes[0];
    const avg = Math.round(x.avg);
    const leftDays = Math.max(1, per.days - elapsed + 1);
    const room = avg - x.r.sum;
    tips.push(room > 0
      ? { title: `${x.r.cat.name} harcamasını ortalamada tut`, text: `Ayın kalan ${leftDays} gününde ${x.r.cat.name} için günde en fazla ${money(Math.round(room / leftDays))} harcarsan ayı ${money(avg)} ortalamasında kapatırsın.`, save: x.diff }
      : { title: `${x.r.cat.name} için ayın kalanında fren`, text: `${x.r.cat.name} harcaman 3 aylık ortalamanı (${money(avg)}) şimdiden ${money(-room)} aştı. Ayın kalanında sadece gerekli alışverişe odaklanırsan ek ${money(Math.round((avg / per.days) * leftDays))} harcamanın önüne geçersin.`, save: Math.round((avg / per.days) * leftDays) });
  }
  if (util != null && util > 0.3 && cardDebt > 0) {
    const target = Math.round(cardLimit * 0.3);
    tips.push({ title: 'Kart kullanım oranını düşür', text: `Toplam kart borcunu ${money(target)} altına indirmek için ${money(cardDebt - target)} ödeme yapman yeterli. Bu, faiz riskini ve limit baskısını azaltır.`, save: null });
  }
  for (const s of cardsSoon.concat(cardsLate).slice(0, 1)) {
    tips.push({ title: `${s.a.name} için dönem borcunun tamamını öde`, text: `Sadece asgariyi (${money(s.minDue)}) ödersen kalan ${money(Math.max(0, s.remaining - s.minDue))} faize girer. Mümkünse ${money(s.remaining)} ödemenin tamamını yap.`, save: null });
  }
  if (savingsRate != null && savingsRate < 0.1 && incBase > 0 && hasData) {
    const top = byCategory(list, 'expense').filter((r) => !FIXED_CATS.has(r.id))[0];
    if (top) tips.push({ title: 'Tasarruf oranını %10\'a çıkar', text: `${top.cat.name} gibi değişken bir kalemde %15 kesinti ayda yaklaşık ${money(Math.round(top.sum * 0.15 * per.days / elapsed))} kazandırır.`, save: Math.round(top.sum * 0.15 * per.days / elapsed) });
  }
  if (!db.budgets.length && hasData) tips.push({ title: 'Aylık limit koy', text: 'Plan → Bütçe bölümünden geçmişine göre önerilen limitleri tek dokunuşla ekleyebilirsin.', save: null });
  if (dt.owe > 0) {
    const next = db.debts.map(debtStatus).filter((s) => !s.closed && isBorrowed(s.d)).sort((a, b) => (a.d.dueDate || '9999').localeCompare(b.d.dueDate || '9999'))[0];
    if (next) tips.push({ title: 'Borç ödeme planı', text: `Toplam borcun ${money(dt.owe)}. Önce vadesi en yakın olanı (${next.d.person}, ${money(next.remaining)}${next.d.dueDate ? `, ${fullDay(next.d.dueDate)}` : ''}) kapat.`, save: null });
  }

  const summary = !hasData ? 'Birkaç gelir ve gider girdikten sonra durumunu burada özetleyeceğim.'
    : `${per.label} döneminde şu ana kadar ${money(t.inc)} gelir, ${money(t.exp)} gider var. ${savingsRate != null ? (savingsRate >= 0 ? `Bu gidişle ayı ${money(incBase - projectedExp)} artıyla kapatırsın.` : `Bu gidişle ayı ${money(projectedExp - incBase)} ekside kapatırsın.`) : ''}`;

  return { score, label, summary, findings: findings.slice(0, 6), tips: tips.slice(0, 4), hasData,
    metrics: { incBase, projectedExp, savingsRate, util, cardDebt, cardLimit, fixedMonthly, avgInc, avgExp, elapsed, days: per.days } };
}

/* ------------------------------ model ------------------------------ */

async function aiGenerate(prompt, json) {
  if (!sync.app) await initSync();
  if (!sync.app) throw new Error('offline');
  await sync.appCheckReady; // güvenlik doğrulaması hazır olmadan istek gönderme
  const mod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-ai.js`);
  const ai = mod.getAI(sync.app, { backend: new mod.GoogleAIBackend() });
  let lastErr;
  // En son çalışan model önce denenir; bir model hata verirse sıradakine geçilir
  let good = '';
  try { good = localStorage.getItem('butce.aiModel') || ''; } catch {}
  const order = good && AI_MODELS.includes(good) ? [good, ...AI_MODELS.filter((m) => m !== good)] : AI_MODELS;
  for (const name of order) {
    try {
      const model = mod.getGenerativeModel(ai, {
        model: name,
        systemInstruction: AI_SYSTEM,
        generationConfig: json ? { responseMimeType: 'application/json', temperature: 0.3 } : { temperature: 0.5 },
      });
      const res = await model.generateContent(prompt);
      aiState.unavailable = false;
      try { localStorage.setItem('butce.aiModel', name); } catch {}
      return res.response.text();
    } catch (e) {
      lastErr = e;
      console.warn('Analiz', name, e);
      // İnternet yoksa diğer modelleri denemenin anlamı yok
      if (/network|failed to fetch|app ?check/i.test(String(e?.message))) break;
    }
  }
  throw lastErr;
}

function aiErrorText(e) {
  const m = String(e?.message || e);
  if (m === 'offline' || /network|failed to fetch/i.test(m)) return 'İnternet bağlantısı yok gibi görünüyor.';
  // App Check zorunluyken uygulama doğrulama anahtarı göndermediği için istek reddedilir
  if (/app ?check/i.test(m)) {
    aiState.unavailable = 'appcheck';
    return 'Analiz servisinde App Check güvenlik kilidi zorunlu.';
  }
  if (/requires the Firebase AI API|api.?not.?enabled|has not been used|SERVICE_DISABLED/i.test(m)) {
    aiState.unavailable = 'disabled';
    return 'Detaylı analiz servisi henüz açılmamış.';
  }
  if (/quota|429|RESOURCE_EXHAUSTED|rate/i.test(m)) return 'Günlük analiz sınırına ulaşıldı. Biraz sonra tekrar dene.';
  return `Analiz şu an yapılamadı: ${m.slice(0, 160)}`;
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
  const L = localInsights();
  return {
    bugun: today,
    donem: `${per.start} – ${per.end} (${per.label})`,
    gecenGun: L.metrics.elapsed,
    toplamGun: per.days,
    buAy: { gelir: tl(t.inc), gider: tl(t.exp), beklenenGelir: tl(L.metrics.incBase), aySonuGiderTahmini: tl(L.metrics.projectedExp), islemSayisi: list.length },
    buAyKategoriler: byCategory(list, 'expense').map((r) => ({ kategori: r.cat.name, tutar: tl(r.sum), islem: r.count, son3AyOrtalama: tl(avgByCat[r.cat.name] || 0) })),
    buAyGelirler: byCategory(list, 'income').map((r) => ({ kategori: r.cat.name, tutar: tl(r.sum) })),
    limitler: db.budgets.map((b) => {
      const s = budgetStatus(b, per);
      return { ad: budgetName(b), limit: tl(s.limit), harcanan: tl(s.spent), aySonuTahmini: s.projected != null ? tl(s.projected) : null, durum: LEVEL_META[s.level].label };
    }),
    son3Ay: usedMonths.map((p) => { const x = totals(txIn(p)); return { donem: p.label, gelir: tl(x.inc), gider: tl(x.exp) }; }),
    krediKartlari: db.accounts.filter((a) => a.kind === 'credit').map((a) => { const s = cardStatus(a); return { ad: a.name, limit: tl(s.limit), borc: tl(s.debt), donemBorcu: tl(s.remaining), asgari: tl(s.minDue), sonOdemeyeGun: s.daysToDue }; }),
    hesaplar: db.accounts.filter((a) => a.kind !== 'credit').map((a) => ({ ad: a.name, tur: a.kind === 'cash' ? 'nakit' : 'banka', bakiye: tl(accBalance(a)) })),
    borclar: db.debts.map(debtStatus).filter((s) => !s.closed).map((s) => ({ kisi: s.d.person, yon: isBorrowed(s.d) ? 'benim borcum' : 'bana borçlu', kalan: tl(s.remaining), vade: s.d.dueDate, gecikti: s.level === 'late' })),
    duzenliOdemeler: db.recurring.filter((r) => !r.paused).map((r) => ({ ad: recName(r), tur: r.type === 'income' ? 'gelir' : 'gider', tutar: tl(r.amount), siklik: freqText(r) })),
    hizliDegerlendirme: { puan: L.score, tespitler: L.findings.map((f) => f.text) },
    giderKategorileri: db.categories.filter((c) => c.type === 'expense').map((c) => c.name),
  };
}

const ANALYSIS_PROMPT = (ctx) => `Kullanıcının finansal verileri (JSON):
${JSON.stringify(ctx)}

Bu verileri bütüncül değerlendir (gelir-gider dengesi, kategori trendleri, limitler, kredi kartları, borçlar, düzenli ödemeler) ve SADECE şu yapıda geçerli bir JSON döndür:
{
  "puan": 0-100 arası tam sayı (finansal sağlık),
  "puanAciklama": "puanın tek cümlelik gerekçesi",
  "ozet": "durumun 2-3 cümlelik, rakamlı özeti",
  "uyarilar": ["somut ve rakamlı dikkat noktaları, en fazla 4"],
  "oneriler": [{"baslik": "kısa başlık", "aciklama": "ne yapmalı, rakamla", "aylikTasarruf": tahmini aylık TL tasarruf (tam sayı) ya da null}],
  "limitOnerileri": [{"kategori": "giderKategorileri listesindeki adla birebir aynı", "limit": aylık TL tam sayı, "gerekce": "kısa"}]
}
Kurallar: öneriler en fazla 5, limitOnerileri en fazla 6 olsun. Kredi kartı ve borç varsa ödeme önceliği öner. "hizliDegerlendirme" cihazın kendi hesabıdır; onunla çelişme ama daha derin yorumla.
Veri çok azsa puanı 50 ver ve bunu puanAciklama'da belirt.`;

function parseJson(text) {
  const s = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
}

async function runAnalysis() {
  if (aiState.loading) return;
  aiState.loading = true;
  aiState.error = '';
  aiRefresh();
  try {
    const out = parseJson(await aiGenerate(ANALYSIS_PROMPT(aiContext()), true));
    aiState.result = { ...out, at: Date.now() };
    saveAi();
  } catch (e) {
    aiState.error = aiErrorText(e);
  } finally {
    aiState.loading = false;
    aiRefresh();
  }
}

async function askAi(question) {
  question = question.trim();
  if (!question || aiState.asking) return;
  aiState.asking = true;
  aiState.error = '';
  aiState.chat.push({ q: question, a: null });
  renderAiSheet();
  try {
    const history = aiState.chat.slice(-5, -1).map((c) => `Kullanıcı: ${c.q}\nSen: ${c.a}`).join('\n\n');
    const prompt = `Kullanıcının finansal verileri (JSON):\n${JSON.stringify(aiContext())}\n\n${history ? `Önceki konuşma:\n${history}\n\n` : ''}Kullanıcının sorusu: ${question}\n\nVerilere dayanarak kısa, net ve rakamlı cevap ver (en fazla 8 satır). Gerekirse madde işareti kullan.`;
    aiState.chat[aiState.chat.length - 1].a = (await aiGenerate(prompt, false)).trim();
    saveAi();
  } catch (e) {
    aiState.chat.pop();
    aiState.error = aiErrorText(e);
  } finally {
    aiState.asking = false;
    aiRefresh();
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

function aiLimits() {
  return (aiState.result?.limitOnerileri || []).map((x) => ({ ...x, cat: findExpenseCat(x.kategori) })).filter((x) => x.cat && x.limit > 0);
}

function aiRefresh() {
  if ($('#sheet-root #ai-sheet')) renderAiSheet();
  else if (ui.view === 'plan') render();
}

function scoreRing(score, label = '') {
  const color = score >= 70 ? 'var(--inc)' : score >= 45 ? 'var(--warn)' : 'var(--exp)';
  return `<div class="score" style="--p:${score};--c:${color}"><b>${score}</b><small>${label ? esc(label) : '/100'}</small></div>`;
}

// Bütçe ekranındaki küçük kart (her zaman yerel değerlendirmeyi gösterir)
function aiCard() {
  const L = localInsights();
  return `<button class="card ai-mini" data-action="ai-open">
    ${L.hasData ? scoreRing(L.score) : `<span class="ai-ico">${icon('chart-no-axes-combined', 22)}</span>`}
    <span class="ai-mini-main"><b>Bütçe analizi${L.hasData ? ` · ${esc(L.label)}` : ''}</b><small>${esc(L.findings[0]?.text || L.summary)}</small></span>
    <span class="chev">${icon('chevron-right', 18)}</span>
  </button>`;
}

function openAiSheet() {
  renderAiSheet();
}

function renderAiSheet() {
  const L = localInsights();
  const r = aiState.result;
  const score = Number.isFinite(r?.puan) ? Math.max(0, Math.min(100, r.puan)) : null;
  const limits = aiLimits();
  const q = $('#ai-q')?.value || '';
  const canAi = syncConfigured() && sync.user;
  openSheet(`
    <div id="ai-sheet"></div>
    <div class="sheet-head"><h2>Bütçe analizi</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>

    <div class="ai-top">
      ${L.hasData ? scoreRing(L.score) : ''}
      <div style="flex:1;min-width:0"><b>${esc(L.label)}</b><p class="small" style="margin:4px 0 0">${esc(L.summary)}</p></div>
    </div>
    ${L.findings.length ? `<ul class="alerts" style="margin-top:14px">${L.findings.map((f) => `<li class="${f.level === 'ok' ? 'info' : f.level}">${esc(f.text)}</li>`).join('')}</ul>` : ''}
    ${L.tips.length ? `<h4>Ne yapabilirsin?</h4><div class="tips">${L.tips.map((o) => `<div class="tip"><div class="between"><b>${esc(o.title)}</b>${o.save ? `<span class="inc">≈ ${money(o.save)}/ay</span>` : ''}</div><p>${esc(o.text)}</p></div>`).join('')}</div>` : ''}

    <div class="ai-deep">
      <div class="between"><h4 style="margin:0">Detaylı analiz</h4>${r?.at ? `<small class="muted">${new Date(r.at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small>` : ''}</div>
      ${!canAi ? `<p class="muted small">Detaylı analiz ve soru-cevap için Ayarlar'dan Google ile giriş yap.</p>`
      : aiState.unavailable === 'appcheck' ? `<div class="setup-note"><b>Güvenlik kilidi (App Check) analizi engelliyor</b><small>Firebase konsolu → <b>App Check → APIs</b> bölümünde <b>Firebase AI Logic</b> satırını <b>Unenforce</b> yap; birkaç dakika sonra burası çalışır. Yukarıdaki değerlendirme bundan bağımsız olarak her zaman güncel.</small><button class="btn small" data-action="ai-analyze">Tekrar dene</button></div>`
      : aiState.unavailable ? `<div class="setup-note"><b>Detaylı analiz servisi kapalı</b><small>Firebase konsolunda <b>AI Logic → Get started → Gemini Developer API</b> adımını tamamlayınca burası çalışır. Yukarıdaki değerlendirme bundan bağımsız olarak her zaman güncel.</small><button class="btn small" data-action="ai-analyze">Tekrar dene</button></div>`
      : `
        ${aiState.loading && !r ? '<div class="empty">Harcamaların inceleniyor…</div>' : ''}
        ${r ? `
          <div class="ai-top" style="margin-top:10px">
            ${score != null ? scoreRing(score) : ''}
            <div style="flex:1;min-width:0">${r.puanAciklama ? `<b>${esc(r.puanAciklama)}</b>` : ''}<p class="small" style="margin:4px 0 0">${aiText(r.ozet || '')}</p></div>
          </div>
          ${r.uyarilar?.length ? `<ul class="alerts" style="margin-top:12px">${r.uyarilar.map((u) => `<li class="warn">${esc(u)}</li>`).join('')}</ul>` : ''}
          ${r.oneriler?.length ? `<div class="tips" style="margin-top:12px">${r.oneriler.map((o) => `<div class="tip"><div class="between"><b>${esc(o.baslik)}</b>${o.aylikTasarruf ? `<span class="inc">≈ ${money(o.aylikTasarruf * 100)}/ay</span>` : ''}</div><p>${esc(o.aciklama)}</p></div>`).join('')}</div>` : ''}
          ${limits.length ? `<h4>Önerilen limitler</h4>
            ${limits.map((x, i) => {
              const cur = db.budgets.find((b) => b.scope === 'cat' && b.categoryId === x.cat.id);
              return `<div class="free-row"><span class="ico" style="--c:${col(x.cat.color)}">${glyph(x.cat.icon)}</span>
                <span style="flex:1;min-width:0"><b>${esc(x.cat.name)} · ${money(x.limit * 100)}</b><small class="muted" style="display:block">${esc(x.gerekce || '')}${cur ? ` (şu an ${money(cur.amount)})` : ''}</small></span>
                <button class="btn small" data-action="ai-apply" data-i="${i}">${cur ? 'Güncelle' : 'Uygula'}</button></div>`;
            }).join('')}
            <button class="btn block" style="margin-top:8px" data-action="ai-apply-all">Hepsini uygula</button>` : ''}
        ` : ''}
        <button class="btn ${r ? '' : 'primary'} block" style="margin-top:12px" data-action="ai-analyze" ${aiState.loading ? 'disabled' : ''}>${aiState.loading ? 'Analiz ediliyor…' : r ? 'Yeniden analiz et' : 'Detaylı analiz yap'}</button>
        ${aiState.error && !aiState.unavailable ? `<p class="exp small">${esc(aiState.error)}</p>` : ''}
        <h4>Soru sor</h4>
        <div class="ai-chat">
          ${aiState.chat.slice(-4).map((c) => `<div class="q">${esc(c.q)}</div><div class="a">${c.a == null ? 'Düşünüyor…' : aiText(c.a)}</div>`).join('')}
          ${aiState.chat.length ? '' : `<div class="ai-suggest">${['Bu ay nerede fazla harcadım?', 'Kart borcumu nasıl kapatırım?', 'Ayda ne kadar biriktirebilirim?'].map((s) => `<button class="chip" data-action="ai-ask-quick" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>`}
          <form class="ai-ask" data-ai-ask>
            <input id="ai-q" placeholder="ör. Market harcamamı nasıl azaltırım?" maxlength="300" autocomplete="off" value="${esc(q)}">
            <button class="btn primary" ${aiState.asking ? 'disabled' : ''}>Sor</button>
          </form>
        </div>`}
    </div>
    <p class="muted" style="font-size:11px;margin:14px 0 0">Analizde yalnızca özet rakamlar kullanılır; notların paylaşılmaz. Öneriler bilgilendirme amaçlıdır.</p>
  `);
}

function applyAiLimit(x) {
  const cur = db.budgets.find((b) => b.scope === 'cat' && b.categoryId === x.cat.id);
  upsertBudget({ id: cur?.id, scope: 'cat', categoryId: x.cat.id, amount: Math.round(x.limit) * 100, alertAt: cur?.alertAt || 80, rollover: !!cur?.rollover });
}

Object.assign(actions, {
  'ai-open': () => openAiSheet(),
  'ai-analyze': () => runAnalysis(),
  'ai-ask-quick': (el) => askAi(el.dataset.q),
  'ai-apply': (el) => {
    const x = aiLimits()[Number(el.dataset.i)];
    if (!x) return;
    applyAiLimit(x);
    save();
    render();
    aiRefresh();
    toast(`${x.cat.name} limiti ${money(x.limit * 100)} oldu`);
  },
  'ai-apply-all': () => {
    const list = aiLimits();
    if (!list.length || !confirm(`${list.length} limit uygulansın mı?`)) return;
    list.forEach(applyAiLimit);
    save();
    render();
    aiRefresh();
    toast(`${list.length} limit uygulandı`);
  },
});

document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-ai-ask]')) return;
  e.preventDefault();
  askAi($('#ai-q').value);
});
