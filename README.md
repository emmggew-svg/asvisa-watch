# AS Visa Randevu Nöbetçisi

`as-visa.com/appointment` sayfasını **15 dakikada bir** kontrol eden, uygun randevu göründüğünde masaüstü bildirimi ve (opsiyonel) Telegram mesajı gönderen Chrome eklentisi (Manifest V3).

- **Yapar:** Senin tarayıcında, senin oturumunla sayfayı açar; ofis adımında uygun merkez listelenmiş mi diye bakar; 72 saat sonra kendini durdurur.
- **Yapmaz:** Cloudflare/Turnstile doğrulamasını çözmez, formu otomatik göndermez, kimlik bilgilerini dışarıya göndermez.

## Kurulum

1. `chrome://extensions` → **Developer mode** aç
2. **Load unpacked** → bu klasörü seç
3. Eklenti ikonu → **3 günlük nöbeti başlat**

Telegram (opsiyonel): @BotFather → `/newbot` → token; bota mesaj at → `getUpdates` → `chat_id`; ikisini eklentiye gir → **Test mesajı**.

## Teknik detaylar

Mimari, tespit kuralları, doğrulama sonuçları, bilinen sınırlar ve geliştirme önerileri: **[HANDOFF.md](HANDOFF.md)**

## Dosyalar

| Dosya | Görev |
|---|---|
| `manifest.json` | MV3 bildirimi, izinler, content script tanımları |
| `background.js` | 15 dk alarm, 3 günlük pencere, sekme yönetimi, bildirimler |
| `content.js` | Sayfa durumu sınıflandırması (`none` / `available` / `blocked` / `login` / `unknown`) |
| `hook.js` | Sayfanın `fetch`/XHR çağrılarını izleyip yerel teşhis kaydı üretir |
| `popup.html`, `popup.js` | Durum paneli, başlat/durdur, Telegram ayarları |

## Not

Kişisel kullanım için yazılmış, dağıtım/paketleme içermeyen bir yardımcı araçtır. Hedef sitenin kullanım kurallarına uyum kullanıcının sorumluluğundadır.
