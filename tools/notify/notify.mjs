// Bütçem bildirim görevi — GitHub Actions tarafından sabah 09:00 ve akşam 20:00 (Türkiye) çalıştırılır.
// Firestore'daki verilere bakar, gerekiyorsa kayıtlı cihazlara bildirim gönderir.
// DİKKAT: Bu deponun Actions çıktıları herkese açıktır; buraya isim, tutar gibi kişisel bilgi YAZDIRMA.
import admin from 'firebase-admin';
import { MODE, TODAY, remindersFor, compose } from './logic.mjs';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
if (!sa.project_id) { console.log('Bildirim kurulumu henüz tamamlanmadı (FIREBASE_SERVICE_ACCOUNT yok); atlanıyor.'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const fdb = admin.firestore();
const fcm = admin.messaging();

/* ------------------------------ çalıştır ------------------------------ */
const live = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.deleted);
let users = 0, sent = 0, failed = 0, removed = 0;

for (const userRef of await fdb.collection('users').listDocuments()) {
  const pushSnap = await userRef.collection('push').get();
  const devices = pushSnap.docs.filter((d) => d.data().token && !d.data().disabled);
  if (!devices.length) continue;
  users++;
  const [tx, rec, acc, debt, cats] = await Promise.all(['tx', 'rec', 'acc', 'debt', 'cat'].map((c) => userRef.collection(c).get().then(live)));
  const items = remindersFor({ tx, rec, acc, debt, cats });
  if (!items.length) continue;
  const msg = compose(items);
  const res = await fcm.sendEachForMulticast({
    tokens: devices.map((d) => d.data().token),
    data: { title: msg.title, body: msg.body, tag: `butcem-${MODE}-${TODAY}`, url: './' },
    webpush: { headers: { Urgency: 'high', TTL: String(12 * 3600) } },
  });
  res.responses.forEach((r, i) => {
    if (r.success) { sent++; return; }
    failed++;
    if (/registration-token-not-registered|invalid-argument|invalid-registration-token/.test(r.error?.code || '')) {
      removed++;
      devices[i].ref.set({ token: null, disabled: true, updatedAt: Date.now() }, { merge: true });
    }
  });
}

// Sadece sayılar (kişisel bilgi yok)
console.log(`Mod: ${MODE} · tarih: ${TODAY} · bildirim açık kullanıcı: ${users} · gönderilen: ${sent} · başarısız: ${failed} · geçersiz cihaz: ${removed}`);
