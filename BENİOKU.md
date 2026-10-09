# Bütçem — 1. etap

## PC'de açmak
`baslat.bat` dosyasına çift tıkla → tarayıcıda http://localhost:5173 açılır.
(Node.js yüklü olmalı; bu bilgisayarda yüklü.)

## Telefonda denemek (şimdilik, aynı Wi-Fi)
1. PC'de `baslat.bat` çalışırken siyah pencerede yazan **"Telefonda (aynı Wi-Fi): http://192.168.x.x:5173"** adresini telefonda Chrome'a yaz.
2. Windows "erişime izin ver" diye sorarsa **Özel ağ**'a izin ver.

Not: Bu yöntem deneme içindir. Kalıcı kullanım için (2. etap) uygulamayı ücretsiz bir HTTPS adresine koyacağız.
Sonra telefonda Chrome → ⋮ → **Ana ekrana ekle / Uygulamayı yükle** dersin, normal uygulama gibi açılır ve internetsiz de çalışır.

## Dosyalar
- `index.html`, `styles.css`, `app.js` — uygulamanın kendisi
- `manifest.webmanifest`, `sw.js`, `icons/` — telefona uygulama olarak kurulabilmesi ve internetsiz çalışması için
- `serve.js`, `baslat.bat` — yerel sunucu
- `tools/make-icons.ps1` — ikonları yeniden üretir
- `tools/bump-version.py` — yayın öncesi sürümü artırır ve `index.html`, `sw.js`, `app.js` sürümlerini birlikte doğrular

## Yayın öncesi sürüm artırma
Kod değiştirip yayınlamadan önce şu komutu çalıştır:

`python tools/bump-version.py`

Sadece sürüm tutarlılığını kontrol etmek için:

`python tools/bump-version.py --check`

## Veriler nerede?
Şimdilik her cihazın kendi tarayıcısında saklanıyor (telefondaki ve PC'dekiler ayrı).
Ayarlar → **Yedek al** ile .json yedeği alabilir, diğer cihazda **Yedekten geri yükle** ile taşıyabilirsin.
Otomatik senkron 2. etapta gelecek.
