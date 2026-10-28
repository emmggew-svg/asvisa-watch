# AS Visa Randevu Nöbetçisi — Teknik Devir Notu

> Amaç: başka bir modelden (Claude) "ne eksik, ne düzeltilebilir, ne geliştirilebilir" geri bildirimi almak.
> Bu dosya yalnızca **AS Visa eklentisi** işini anlatır; oturumun sonundaki kısa notta başka bir iş de var.

---

## 1. Kullanıcı isteği ve gerçek hedef

- İstek (kelimesi kelimesine niyet): `as-visa.com/appointment` sayfasını **3 gün boyunca, her 15 dakikada bir** kontrol eden, bilgisayar açık kaldıkça çalışan **yerel** bir otomasyon.
- Israr edilen ikinci istek: "otomatik olarak bakıp **randevuyu alsın**", çünkü kullanıcı her zaman evde değil. Hatta "Gemini API anahtarı bağlayıp formu AI doldursun" önerisi geldi.
- Benim çizdiğim sınır: **Cloudflare/anti-bot korumasını aşan kod yazılmadı**, **Turnstile (CAPTCHA) otomatik çözülmedi**, **otomatik form gönderimi yapılmadı**. Bunun yerine "tespit et → haber ver → sayfayı aç" yapan bir Chrome eklentisi yazıldı. Sebep: (a) anti-bot atlatma, (b) gerçek pasaport verisiyle onaysız başvuru riski, (c) formu görmeden yazılacak otomasyonun yanlış slot seçmesi.

**Tartışmaya açık nokta:** Kullanıcının asıl ihtiyacı "evde yokken randevu kaçırmamak". Bu sürüm yalnızca *haber veriyor*; kullanıcı telefondan girip almak zorunda. Yani istek tam karşılanmış değil — bilinçli bir sınır.

---

## 2. Erişim/kısıt bulguları (kanıtlı)

| Bulgu | Kanıt |
|---|---|
| Site Cloudflare arkasında | `curl` → **HTTP 403**, gövde "Attention Required! \| Cloudflare" |
| Otomasyon tarayıcısı bloklu | Qoder'in gömülü tarayıcısı (`UA: ... Qoder/0.4.11 ... Electron/43.1.1`) sayfada **"Sorry, you have been blocked"** gördü; `robots.txt` bile JS challenge döndürdü |
| Randevu akışı 8 adımlı sihirbaz | Adımlar: Kişiler → … → **4/8 Ofis** → Tarih → Saat → Onay → Doğrulama |
| Şu anki durum | Ofis adımında **"Uygun Randevu Bulunmamaktadır."** |
| Son adım CAPTCHA'lı | Sayfadaki `window.__SETTINGS__` içinde **`TURNSTILE_SITE_KEY`** var |
| Panel girişli | Kaydedilen DOM'da kullanıcı e-postası ve "Çıkış Yap" var → oturum açık |
| Backend | `https://web-api-eu.tursys.info/` (sayfa `dns-prefetch` ile işaret ediyor) |
| Frontend | Nuxt/Vue benzeri SPA; `assets/chunks/*.js`, `entry-client`, `onBeforeRenderClient` |
| Kaydedilen sayfa | `C:\dev\randevu\Panel — as-visa.com.html` + `..._files\` (Ctrl+S, "Webpage, Complete") — **render edilmiş DOM** kaydedilmiş, bu yüzden "randevu yok" bloğunun gerçek HTML'i elimizde |

**"Randevu yok" durumunun gerçek DOM'u** (tespit buna dayanıyor):

```html
<div class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed ... col-span-full">
  <div class="... bg-gray-100"><svg class="lucide lucide-inbox ...">…</svg></div>
  <p class="text-sm font-medium text-gray-500">Uygun Randevu Bulunmamaktadır.</p>
</div>
```

Adım başlığı: `<h2 class="text-xl font-semibold text-gray-800">Başvuru Merkezini Seçin</h2>`

---

## 3. Kurulan yapı

Klasör: `C:\dev\asvisa-watch` (Manifest V3, build adımı yok, bağımlılık yok)

| Dosya | Görev |
|---|---|
| `manifest.json` | MV3; izinler: `alarms, notifications, storage, tabs, scripting`; host: `as-visa.com/*`, `api.telegram.org/*`. İki content script: `hook.js` (MAIN world, `document_start`), `content.js` (ISOLATED, `document_idle`) |
| `background.js` | Service worker: 15 dk alarm, 72 saatlik pencere, sekme bul/oluştur, içerik betiğine sor, masaüstü + Telegram bildirimi, teşhis kaydı |
| `content.js` | Sayfa durumunu sınıflandırır: `none / available / blocked / login / unknown` |
| `hook.js` | Sayfanın kendi `fetch`/`XHR` çağrılarını sarar; yalnızca `web-api-eu.tursys.info` URL'lerini, gövdenin ilk 2000 karakteriyle `postMessage` ile iletir |
| `popup.html` / `popup.js` | Durum, kalan süre, başlat/durdur, "şimdi kontrol et", Telegram token/chat, son API teşhisi |
| `icon128.png` | Elle üretilmiş 128×128 PNG (turuncu daire) |

### Akış

```
chrome.alarms (15 dk)
  → background.checkNow()
     → endAt geçtiyse durdur + bitiş bildirimi
     → as-visa sekmesi var mı? yoksa pasif sekme aç
     → sekme /appointment değilse tabs.update(APP_URL), 3 sn bekle
     → content script yoksa chrome.scripting.executeScript ile enjekte et
     → tabs.sendMessage({type:"check"})  (25 sn timeout)
        → content.inspect(): 20 sn'ye kadar sayfanın oturmasını bekle (400 ms poll)
        → sınıflandır, dön
     → state'i yaz; available → masaüstü + Telegram
     → blocked → saatte en fazla 1 kez uyarı
```

### Tespit kuralları (`content.js`)

```js
RE_BLOCKED     = /Attention Required|you have been blocked|Just a moment|Verify you are human/i
RE_WIZARD      = /RANDEVU SİSTEMİ/i
RE_NO_SLOT     = /Uygun Randevu Bulunmamaktadır/i
RE_OFFICE_STEP = /Başvuru Merkezini Seçin/i
RE_LOGIN       = /Giriş Yap|Şifre|Parola/i
```

Karar:
- `RE_WIZARD` yok + `blocked` → `blocked`; `login` → `login`; ikisi de yok → `unknown`
- `RE_OFFICE_STEP` var + `RE_NO_SLOT` **yok** → `available`
- `RE_OFFICE_STEP` var + `RE_NO_SLOT` var → `none`

Metin okuma: `body.innerText`; yoksa `script/style/noscript/template` ayıklanmış `textContent`. (Ham `textContent` script içindeki dizgeleri sayıp yanlış pozitif üretiyordu.)

### Durum modeli (`chrome.storage.local`)

- `state`: `{active, startedAt, endAt, lastCheck, lastStatus, lastDetail, lastOffices, lastBlockedNotify, lastNotified}`
- `config`: `{telegramToken, telegramChat}`
- `diag`: son 20 API yanıtı `{ts, url, body}` (en fazla 300 + 2000 karakter)

### Süre/limit

- `PERIOD_MIN = 15`, `WATCH_MS = 3 gün`, blok uyarısı aralığı `1 saat`
- Süre bitince `stopWatch(true)` → alarm silinir, tek seferlik "nöbet bitti" bildirimi

---

## 4. Doğrulama (yapılan)

- `node --check` → 4 JS dosyası sözdizimi temiz, `manifest.json` geçerli.
- **jsdom ile 5 senaryo**, biri gerçek kaydedilmiş sayfa. Test dosyası:
  `C:\Users\emmgg\Documents\Qoder\2026-10-27\6c36d581\exttest.js`
  (jsdom geçici olarak `%TEMP%\extest` içine kuruldu; kalıcı bağımlılık yok.)

| Senaryo | Beklenen | Sonuç |
|---|---|---|
| Kaydedilmiş gerçek sayfa | `none` | ✅ |
| Aynı sayfa, "randevu yok" metni silinmiş | `available` | ✅ (3 kart) |
| Sahte Cloudflare bloğu | `blocked` | ✅ |
| Sahte giriş sayfası | `login` | ✅ |
| Alakasız sayfa | `unknown` | ✅ |

**Yapılamayan doğrulama:** Gerçek Chrome'da, oturum açıkken, **randevu varken** sayfanın DOM'u. Elimizde yalnızca "randevu yok" durumu var; "ofis listelenmiş" hâli **tahmin**. En kırılgan nokta burası.

---

## 5. Bilinen sınırlar / riskler

1. **"Uygun randevu var" tespiti heuristik.** Ofis kartlarının markup'ı hiç görülmedi; "metin yoksa randevu vardır" varsayımına dayanıyor. Sihirbaz farklı bir adımda "Başvuru Merkezini Seçin" başlığını korursa yanlış pozitif olur.
2. **Turnstile** son onayda; eklenti oraya hiç dokunmuyor. Yani uçtan uca otomatik alma yok — bilinçli.
3. **Chrome açık olmalı.** Bilgisayar uyursa alarm gecikir (uyanınca tetiklenir). Chrome'un kendisi "kaldığın yerden devam et" kapalıysa sekme geri gelmez.
4. **Sekme yeniden kullanımı** kullanıcının açık sekmesini sömürebilir: `/appointment` dışında bir as-visa sayfasındaysa `tabs.update` ile yönlendiriliyor (kullanıcı akışını bozabilir).
5. **Navigasyon sonrası sabit 3 sn** beklemek var; yavaş bağlantıda içerik betiği 20 sn daha beklediği için toplam ~25 sn'ye sıkışıyor, timeout 25 sn → **sınırda**. Yükseltilmeli.
6. **SPA rotası:** Nuxt istemci tarafı yönlendirme yaparsa sekme URL'i değişmeden içerik değişebilir; "check" mesajı eski bağlamda çalışabilir.
7. **Telegram token'ı** `chrome.storage.local` içinde düz metin. Eklentiye erişen biri okuyabilir. Alternatif: token'ı hiç saklamamak / kullanıcıya seçim sunmak.
8. **Teşhis kaydı** API yanıtlarının ilk 2000 karakterini saklıyor; KVKK açısından kişisel veri içerebilir (kullanıcının kendi tarayıcısında, dışarı çıkmıyor, 20 kayıtla sınırlı). Yine de varsayılan kapalı olması tartışılır.
9. **`web_accessible_resources` yok**, `minimum_chrome_version` yok, ikon seti tek boyut (16/32/48 yok → mağaza dışı kullanımda sorun değil).
10. **i18n yok**; metinler Türkçe gömülü.
11. **`notifications` requireInteraction** bazı Windows ayarlarında sessiz kalabilir; ses garantisi yok.
12. **Alarm minimumu:** MV3'te 15 dk sorun değil; ama tarayıcı kapalıyken hiç çalışmaz — "7/24" isteği aslında "PC açıkken 7/24".

---

## 6. Geliştirme fikirleri (öncelik sırasıyla)

1. **Tespiti DOM metnine değil API'ye bağlamak.** `hook.js` zaten `tursys` yanıtlarını yakalıyor. Doğru uç bulunup (ofis/müsaitlik listesi) JSON şeması çıkarılırsa tespit metin eşleştirmesinden kurtulur; dil/tasarım değişimine dayanıklı olur. Bunun için kullanıcıdan "randevu varken" alınmış bir teşhis dökümü gerekir.
2. **"Randevu var" hâlinin DOM'unu bir kez görmek.** Bir gün randevu açıldığında otomatik olarak sayfanın `outerHTML`'inin küçük bir dilimini teşhis kaydına eklemek (kişisel veri ayıklanarak) sonraki sürümü sağlamlaştırır.
3. **Otomatik form ön-doldurma (submit yok).** Kullanıcı verilerini (ad, pasaport, telefon) yerel olarak saklayıp ofis/tarih/saat seçimlerini yapmak, son onayı kullanıcıya bırakmak. Turnstile'a dokunmadan mümkün.
4. **Telefon bildirimi güvenilirliği.** Telegram yerine/yanında `ntfy.sh` gibi anahtarsız push; veya Telegram token'ını `chrome.storage.session`'da tutmak.
5. **Merkezi "watch" ayarları:** hangi ofis(ler), hangi tarih aralığı, hangi vize türü — bildirimi filtrelemek için. Şu an her ofis listesi "randevu var" sayılıyor.
6. **Sekme politikası:** kullanıcıya "ayrı bir pencere kullan" seçeneği; mevcut sekmeye dokunmama.
7. **Yeniden deneme/backoff:** art arda `unknown`/`blocked` gelirse aralığı uzatmak (15 dk → 30 dk), böylece siteyi gereksiz yormamak ve blok riskini azaltmak.
8. **Test kapsamı:** jsdom senaryolarını repoya almak; `content.js`'i saf fonksiyonlara ayırıp (`classify(text)`) doğrudan birim testi yazmak.
9. **`chrome.alarms` yerine `chrome.idle`** ile ekran kilitliyken kontrolü atlamak (site yükü ve blok riski azalır).
10. **Kullanıcıya görünür "son 24 saat" zaman çizelgesi** (kaç kontrol, kaç blok, kaç boş) — güven verir.

---

## 7. Kurulum (kullanıcıya verilen adımlar)

1. `chrome://extensions` → **Developer mode** aç
2. **Load unpacked** → `C:\dev\asvisa-watch`
3. Eklenti ikonu → **3 günlük nöbeti başlat**
4. (Opsiyonel) Telegram: @BotFather → `/newbot` → token; bota mesaj at → `getUpdates` → `chat_id`; ikisini gir → **Test mesajı**

Beklenen ilk kontrol sonucu (randevu yokken): **"Randevu yok"**.

---

## 8. Aynı oturumdaki diğer iş (karışmasın)

DSRodeo adlı Tauri/Next.js masaüstü uygulamasında ayrı bir refactor yapıldı: `app/page.tsx` 1426 → 72 satır, mantık `hooks/` (useAppState, useModels, useAgents, useChat, useBoot) ve sunum `components/` altına bölündü; `lib/permissions.ts` içinde 5 gerçek açık kapatıldı (boş komut `allow` sızıntısı, glob `|` kaçışı, Windows yıkıcı komut desenleri, gizli dosya listesi, salt-okunur kontrolü). Bu dosyanın konusu **değil**.
