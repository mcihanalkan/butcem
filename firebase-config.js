// Firebase proje ayarları (Firebase konsolu → Proje ayarları → Web uygulaması).
// Bu bilgiler gizli değildir; verileri Firestore güvenlik kuralları korur.
window.FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBbJOW2ttLv70nXrdwr6Z5OoOF7GYnwTmg',
  authDomain: 'butcem-a5e3e.firebaseapp.com',
  projectId: 'butcem-a5e3e',
  storageBucket: 'butcem-a5e3e.firebasestorage.app',
  messagingSenderId: '4420229552',
  appId: '1:4420229552:web:4e317fd9af3627d4fb9e75',
};

// İsteğe bağlı: Firebase App Check için reCAPTCHA v3 site anahtarı. Tanımlanırsa analiz istekleri doğrulanır.
// Klasik reCAPTCHA v3 Firebase'e kaydedilemediği için kapalı (Firebase artık Fraud Defense istiyor).
// window.APP_CHECK_SITE_KEY = '6LdZM-ctAAAAAGAQe4YnUyp6s8h1b8whtwd-Djqu';

// Bildirimler için Firebase Cloud Messaging "Web Push sertifikası" (genel anahtar; gizli değil).
window.FCM_VAPID_KEY = 'BJNI-n_65cmPXPnGOrZY50dvdhFnYJuRqoJa7GmNwFKNz0UymxaP78GZRXhuIMxJqHH_m504KR4PGLQF9uZC2sI';
