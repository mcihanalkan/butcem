'use strict';

/* =====================================================================
   Fiş / fatura tarama
   Fotoğraf (ya da PDF) Gemini'ye gönderilir; toplam, tarih, mağaza, kategori ve
   varsa kartın son 4 hanesi okunur. İşlem formu dolu açılır; kaydetmeden önce
   kullanıcı kontrol eder. Fotoğraf hiçbir yerde saklanmaz.
   Belge bir faturaysa ve Düzenli'de buna uyan bekleyen bir ödeme varsa,
   o ödemeyi bu tutarla onaylamak önerilir.
   ===================================================================== */

const SCAN_SYSTEM = `Sen Türkçe fiş, fatura ve dekontları okuyan dikkatli bir belge okuyucususun.
- Sadece belgede gördüğünü yaz; tahmin gerekiyorsa en olası değeri ver, hiç yoksa null döndür.
- Toplam tutar, ödenen GENEL TOPLAM'dır (KDV dahil). "TOPLAM", "GENEL TOPLAM", "ÖDENECEK TUTAR", "TUTAR" satırlarına bak; ara toplam, KDV veya para üstünü toplam sanma.
- Türkçe sayı biçiminde nokta binlik, virgül ondalık ayırıcıdır (1.234,56 = 1234.56).`;

const BILL_CATS = {
  elektrik: 'Elektrik', su: 'Su', dogalgaz: 'Doğalgaz', internet: 'İnternet', telefon: 'Telefon faturası', aidat: 'Aidat', kira: 'Kira',
};
const BILL_WORDS = {
  elektrik: ['elektrik', 'enerji'], su: ['su ', 'su faturası', 'iski', 'aski', 'izsu'], dogalgaz: ['doğalgaz', 'dogalgaz', 'gaz'],
  internet: ['internet', 'fiber'], telefon: ['telefon', 'gsm', 'mobil', 'hat'], aidat: ['aidat'], kira: ['kira'],
};

let scanState = null;
const SCAN_FAST = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const SCAN_DEEP = ['gemini-3.8-flash', 'gemini-3.5-flash'];

const SCAN_PROMPT = () => `Bu belgeyi oku ve SADECE şu yapıda geçerli bir JSON döndür:
{
  "belgeTuru": "fis" | "fatura" | "dekont" | "diger",
  "magaza": "işletme / kurum adı (kısa, ör. A101, BİM, Shell, Enerjisa) ya da null",
  "tarih": "YYYY-MM-DD (fiş/işlem tarihi) ya da null",
  "toplam": ödenen toplam tutar, sayı olarak TL (ör. 1234.56) ya da null,
  "tur": "gider" | "gelir",
  "kategori": "aşağıdaki listeden birebir aynı ad",
  "kartSon4": "kartın son 4 hanesi (ör. **** 1234 yazıyorsa 1234) ya da null",
  "faturaTuru": "elektrik" | "su" | "dogalgaz" | "internet" | "telefon" | "aidat" | "kira" | null,
  "sonOdemeTarihi": "faturaysa son ödeme tarihi YYYY-MM-DD ya da null",
  "guven": 0 ile 1 arası, toplam tutardan ne kadar eminsin
}
Gider kategorileri: ${db.categories.filter((c) => c.type === 'expense').map((c) => c.name).join(', ')}
Gelir kategorileri: ${db.categories.filter((c) => c.type === 'income').map((c) => c.name).join(', ')}
Bugünün tarihi: ${todayISO()}`;

/* ------------------------------ dosya → veri ------------------------------ */

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

// Fotoğraf: en uzun kenar 1600 px, JPEG — hem hızlı gider hem okunaklı kalır. PDF olduğu gibi gönderilir.
async function fileToPart(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 15 * 1024 * 1024) throw new Error('Dosya çok büyük (en fazla 15 MB).');
    return { inlineData: { mimeType: 'application/pdf', data: await blobToBase64(file) } };
  }
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return { inlineData: { mimeType: 'image/jpeg', data: await blobToBase64(blob) } };
}

/* ------------------------------ eşleştirme ------------------------------ */

const findCat = (name, type) => {
  const n = String(name || '').toLocaleLowerCase('tr').trim();
  return n ? db.categories.find((c) => c.type === type && c.name.toLocaleLowerCase('tr') === n) : null;
};

function validISO(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromISO(s).getTime()) ? s : null;
}

// Faturaya uyan, henüz ödenmemiş Düzenli ödeme
function matchRecurring(r, catId, refDate) {
  const words = BILL_WORDS[r.faturaTuru] || [];
  const cands = db.recurring.filter((x) => x.type === 'expense' && !x.paused && (
    (catId && x.categoryId === catId) || words.some((w) => recName(x).toLocaleLowerCase('tr').includes(w.trim()))
  ));
  const from = toISO(addDays(fromISO(refDate), -45)), to = toISO(addDays(fromISO(refDate), 45));
  let best = null;
  for (const rec of cands) {
    for (const due of occurrences(rec, from, to)) {
      const st = occStatus(rec, due);
      if (st.state === 'done' || st.state === 'skipped') continue;
      const dist = Math.abs(dayDiff(fromISO(refDate), fromISO(due)));
      if (!best || dist < best.dist) best = { rec, due, dist };
    }
  }
  return best;
}

/* ------------------------------ akış ------------------------------ */

function startScan() {
  if (!navigator.onLine) { toast('Fiş okumak için internet gerekiyor'); return; }
  if (form) syncForm();
  scanState = { keep: form ? { ...form } : null };
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,application/pdf';
  input.onchange = () => { if (input.files[0]) readDocument(input.files[0]); };
  input.click();
}

function scanLoading() {
  openSheet(`
    <div class="sheet-head"><h2>Belge okunuyor</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="scan-loading">
      <span class="scan-ico">${icon('scan-search', 30)}</span>
      <b>Tutar, tarih ve mağaza okunuyor…</b>
      <small>Birkaç saniye sürebilir. Fotoğraf okunduktan sonra saklanmaz.</small>
    </div>`);
}

async function readDocument(file) {
  scanLoading();
  try {
    const part = await fileToPart(file);
    const ask = (models) => aiGenerate([{ text: SCAN_PROMPT() }, part], true, SCAN_SYSTEM, models).then(parseJson);
    // Önce hızlı model (~2 sn); emin değilse ya da tutarı bulamazsa güçlü modelle tekrar oku
    let out = await ask(SCAN_FAST);
    if (!(Number(out?.toplam) > 0) || Number(out?.guven) < 0.7) {
      const loading = $('#sheet-root .scan-loading b');
      if (loading) loading.textContent = 'Daha dikkatli okunuyor…';
      try { const deep = await ask(SCAN_DEEP); if (Number(deep?.toplam) > 0) out = deep; } catch (e) { console.warn('Derin okuma', e); }
    }
    if (!$('#sheet-root .scan-loading')) return; // kullanıcı beklerken kapattı
    handleScan(out);
  } catch (e) {
    console.warn('Tarama', e);
    const msg = e?.message?.startsWith('Dosya') ? e.message : aiErrorText(e);
    scanFailed(msg);
  }
}

function scanFailed(msg) {
  openSheet(`
    <div class="sheet-head"><h2>Okunamadı</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="scan-loading">
      <span class="scan-ico warn">${icon('triangle-alert', 28)}</span>
      <b>${esc(msg || 'Belge okunamadı.')}</b>
      <small>Fişi düz bir zemine koyup, gölge ve parlama olmadan, yazılar net görünecek şekilde tekrar çek.</small>
    </div>
    <div class="actions">
      <button class="btn" data-action="scan-manual">Elle gir</button>
      <button class="btn primary" data-action="scan-start">${icon('camera', 18)} Tekrar dene</button>
    </div>`);
}

function handleScan(r) {
  const amount = Number(r?.toplam) > 0 ? Math.round(Number(r.toplam) * 100) : 0;
  if (!amount) { scanFailed('Belgede toplam tutar bulunamadı.'); return; }
  const type = r.tur === 'gelir' ? 'income' : 'expense';
  let cat = findCat(r.kategori, type) || (r.faturaTuru && findCat(BILL_CATS[r.faturaTuru], 'expense'));
  if (!cat) cat = findCat(type === 'income' ? 'Diğer gelir' : 'Diğer', type);
  const today = todayISO();
  let date = validISO(r.tarih) || today;
  if (date > today) date = today; // fişin tarihi gelecekte olamaz; yanlış okumaya karşı
  const acc = r.kartSon4 ? db.accounts.find((a) => a.last4 && a.last4 === String(r.kartSon4).replace(/\D/g, '').slice(-4)) : null;
  const keep = scanState?.keep || {};
  const prefill = {
    type, amountText: amountToInput(amount), categoryId: cat?.id || null, date,
    note: r.magaza ? String(r.magaza).slice(0, 60) : keep.note || '',
    accountId: acc ? acc.id : keep.accountId || lastAccountId(),
  };
  scanState = { ...scanState, r, prefill, amount, lowConfidence: Number(r.guven) > 0 && Number(r.guven) < 0.6 };

  // Fatura → Düzenli ödemeyle eşleştir
  const match = type === 'expense' && (r.belgeTuru === 'fatura' || r.faturaTuru) ? matchRecurring(r, cat?.id, validISO(r.sonOdemeTarihi) || date) : null;
  if (match) { scanState.match = match; renderBillMatch(); return; }
  openScannedForm();
}

function openScannedForm() {
  openTxForm(scanState.prefill);
  toast(scanState.lowConfidence ? 'Okundu ama emin değilim; tutarı kontrol et' : 'Belge okundu · kontrol edip kaydet');
}

function renderBillMatch() {
  const { r, match, amount } = scanState;
  const c = recCat(match.rec);
  openSheet(`
    <div class="sheet-head"><h2>Fatura okundu</h2><button class="close" data-action="close-sheet" aria-label="Kapat">${icon('x', 18)}</button></div>
    <div class="preview"><span class="ico" style="--c:${col(c.color)}">${glyph(c.icon)}</span><span><b>${esc(r.magaza || recName(match.rec))} · ${money(amount)}</b><small class="muted" style="display:block">${validISO(r.sonOdemeTarihi) ? `Son ödeme ${fullDay(r.sonOdemeTarihi)}` : validISO(r.tarih) ? `Fatura tarihi ${fullDay(r.tarih)}` : ''}</small></span></div>
    <p class="small" style="margin:0 0 16px">Bu fatura, Düzenli'deki <b>${esc(recName(match.rec))}</b> ödemene (${fullDay(match.due)}) uyuyor. Onu bu tutarla ödendi olarak işaretleyebilirsin.</p>
    <div class="btn-stack">
      <button class="btn primary" data-action="scan-use-rec">${icon('check', 18)} ${esc(recName(match.rec))} ödemesini onayla</button>
      <button class="btn" data-action="scan-use-new">Yeni işlem olarak ekle</button>
    </div>`);
}

function useRecurringMatch() {
  const { match, amount, prefill } = scanState;
  openConfirm(match.rec.id, match.due);
  const a = $('#rc-amount');
  if (a) a.value = amountToInput(amount);
  if (prefill.accountId && $(`[data-action="rc-acc"][data-id="${prefill.accountId}"]`)) $(`[data-action="rc-acc"][data-id="${prefill.accountId}"]`).click();
  toast('Tutar faturadan alındı · kontrol edip onayla');
}

Object.assign(actions, {
  'scan-start': () => startScan(),
  'scan-manual': () => openTxForm(scanState?.keep ? { ...scanState.keep } : {}),
  'scan-use-rec': () => useRecurringMatch(),
  'scan-use-new': () => openScannedForm(),
});
