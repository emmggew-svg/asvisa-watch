/* Randevu sayfasında çalışır: uygun randevu var mı, yok mu, yoksa sayfa bloklu/girişsiz mi?
   Sayfayı kendisi yenilemez — o iş arka plandaki zamanlayıcının. */

const RE_BLOCKED = /Attention Required|you have been blocked|Just a moment|Verify you are human/i;
const RE_WIZARD = /RANDEVU SİSTEMİ/i;
const RE_NO_SLOT = /Uygun Randevu Bulunmamaktadır/i;
const RE_OFFICE_STEP = /Başvuru Merkezini Seçin/i;
const RE_LOGIN = /Giriş Yap|Şifre|Parola/i;

/* Görünür metin. innerText varsa o (render edilmiş); yoksa script/style ayıklanmış textContent.
   Ham textContent kullanmak script içindeki dizgeleri de sayacağı için yanlış pozitif üretirdi. */
function pageText() {
  const b = document.body;
  if (!b) return "";
  if (typeof b.innerText === "string" && b.innerText.trim()) return b.innerText;
  const clone = b.cloneNode(true);
  clone.querySelectorAll("script,style,noscript,template").forEach((n) => n.remove());
  return clone.textContent || "";
}

const TXT = pageText;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitReady(timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const t = TXT();
    if (RE_BLOCKED.test(t) || RE_WIZARD.test(t) || RE_LOGIN.test(t)) return t;
    await sleep(400);
  }
  return TXT();
}

/* Ofis adımında kartlar tıklanabilir buton olarak render edilir; metinlerini topla. */
function officeCandidates() {
  const out = [];
  const nodes = document.querySelectorAll("button, [role='button']");
  for (const el of nodes) {
    const t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 60) continue;
    if (/Geri|Devam|İleri|Seç|Randevu Al|Çıkış|Panel/i.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

async function inspect() {
  const text = await waitReady();

  if (RE_BLOCKED.test(text)) {
    return { status: "blocked", detail: "Cloudflare sayfayı engelledi. Tarayıcıda sayfayı elle açıp doğrulamayı geçmen gerekebilir." };
  }
  if (!RE_WIZARD.test(text)) {
    const login = RE_LOGIN.test(text);
    return {
      status: login ? "login" : "unknown",
      detail: login
        ? "Oturum kapalı görünüyor: as-visa.com'da giriş yapılmamış."
        : "Randevu sihirbazı bulunamadı; sayfa henüz yüklenmemiş olabilir.",
    };
  }

  const onOfficeStep = RE_OFFICE_STEP.test(text);
  const noSlot = RE_NO_SLOT.test(text);

  if (onOfficeStep && !noSlot) {
    return { status: "available", detail: "Ofis adımında uygun merkez listeleniyor.", offices: officeCandidates() };
  }
  if (onOfficeStep && noSlot) {
    return { status: "none", detail: "Ofis adımı: uygun randevu yok." };
  }
  return {
    status: "unknown",
    detail: noSlot
      ? "Randevu yok metni var ama ofis adımında değiliz."
      : "Sihirbaz açık ama ofis adımı tespit edilemedi.",
    offices: officeCandidates(),
  };
}

if (!window.__asvisaWatchLoaded) {
  window.__asvisaWatchLoaded = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "ping") { sendResponse({ ok: true }); return false; }
    if (msg && msg.type === "check") {
      inspect().then(sendResponse).catch((e) => sendResponse({ status: "unknown", detail: String(e) }));
      return true;
    }
    return false;
  });

  /* API teşhis kayıtlarını arka plana ilet */
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__asvisa !== true) return;
    try { chrome.runtime.sendMessage({ type: "diag", url: d.url, body: d.body }); } catch { /* yok say */ }
  });
}
