// Bütçem bildirim görevi — GitHub Actions tarafından sabah 09:00 ve akşam 20:00 (Türkiye) çalıştırılır.
// Firestore'daki verilere bakar, gerekiyorsa kayıtlı cihazlara bildirim gönderir.
// DİKKAT: Bu deponun Actions çıktıları herkese açıktır; buraya isim, tutar gibi kişisel bilgi YAZDIRMA.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { MODE, TODAY, remindersFor, compose, weeklySummary, dayClose } from './logic.mjs';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.log('Bildirim kurulumu henüz tamamlanmadı (FIREBASE_SERVICE_ACCOUNT yok); atlanıyor.'); process.exit(0); }
initializeApp({ credential: cert(sa) });
const fdb = getFirestore();
const fcm = getMessaging();

/* ------------------------------ çalıştır ------------------------------ */
const live = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.deleted);
let users = 0, sent = 0, failed = 0, removed = 0;

for (const userRef of await fdb.collection('users').listDocuments()) {
  const pushSnap = await userRef.collection('push').get();
  const devices = pushSnap.docs.filter((d) => d.data().token && !d.data().disabled);
  if (!devices.length) continue;
  users++;
  const [tx, rec, acc, debt, cats] = await Promise.all(['tx', 'rec', 'acc', 'debt', 'cat'].map((c) => userRef.collection(c).get().then(live)));
  const settings = (await userRef.collection('meta').doc('settings').get()).data() || {};
  const data = { tx, rec, acc, debt, cats };
  const msgs = [];
  const items = remindersFor(data);
  if (items.length) msgs.push({ ...compose(items), tag: `butcem-${MODE}-${TODAY}`, url: './' });
  const week = weeklySummary(data, settings);
  if (week) msgs.push(week);
  const close = dayClose(data, settings);
  if (close) msgs.push(close);
  for (const msg of msgs) {
    const alive = devices.filter((d) => !d.dead);
    if (!alive.length) break;
    const res = await fcm.sendEachForMulticast({
      tokens: alive.map((d) => d.data().token),
      data: { title: msg.title, body: msg.body, tag: msg.tag, url: msg.url },
      webpush: { headers: { Urgency: 'high', TTL: String(12 * 3600) } },
    });
    res.responses.forEach((r, i) => {
      if (r.success) { sent++; return; }
      failed++;
      if (/registration-token-not-registered|invalid-argument|invalid-registration-token/.test(r.error?.code || '')) {
        removed++;
        alive[i].dead = true;
        alive[i].ref.set({ token: null, disabled: true, updatedAt: Date.now() }, { merge: true });
      }
    });
  }
}

// Sadece sayılar (kişisel bilgi yok)
console.log(`Mod: ${MODE} · tarih: ${TODAY} · bildirim açık kullanıcı: ${users} · gönderilen: ${sent} · başarısız: ${failed} · geçersiz cihaz: ${removed}`);
