/*
  Tespit testleri (jsdom). Kalıcı bağımlılık yok — jsdom'u geçici kur:

    npm i --prefix "%TEMP%\asvisa-test" jsdom
    set ASVISA_JSDOM=%TEMP%\asvisa-test\node_modules\jsdom
    node tests/classify.test.js

  Windows cmd yerine bash:  export ASVISA_JSDOM="$TEMP/asvisa-test/node_modules/jsdom"
*/

const fs = require("fs");
const path = require("path");

function loadJsdom() {
  const candidates = ["jsdom", process.env.ASVISA_JSDOM].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* sıradaki */ }
  }
  console.error(
    "jsdom bulunamadı.\n" +
    '  npm i --prefix "%TEMP%\\asvisa-test" jsdom\n' +
    "  set ASVISA_JSDOM=%TEMP%\\asvisa-test\\node_modules\\jsdom"
  );
  process.exit(1);
}

const { JSDOM } = loadJsdom();

const ROOT = path.resolve(__dirname, "..");
const CONTENT = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
const FIX = (n) => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

let pass = 0;
const failures = [];

function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return; }
  failures.push(`${name}\n    gelen: ${JSON.stringify(got)}\n    beklenen: ${JSON.stringify(want)}`);
}

function truthy(name, cond, info = "") {
  if (cond) { pass++; return; }
  failures.push(`${name}${info ? "\n    " + info : ""}`);
}

function openPage(html) {
  const dom = new JSDOM(html, { url: "https://www.as-visa.com/appointment", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const listeners = [];
  window.chrome = {
    runtime: {
      onMessage: { addListener: (f) => listeners.push(f) },
      sendMessage: () => {},
    },
  };
  window.eval(CONTENT);
  return { window, dom, listener: listeners[0] };
}

function runInspect(page) {
  return new Promise((resolve, reject) => {
    if (!page.listener) return reject(new Error("content.js mesaj dinleyicisi kaydetmedi"));
    const ret = page.listener({ type: "check" }, null, resolve);
    if (ret !== true) reject(new Error("dinleyici async yanıt döndürmedi"));
  });
}

const MSG = {
  blocked: "Attention Required! | Cloudflare\nSorry, you have been blocked",
  login: "Giriş Yap\nŞifre",
  wizardOffice: "RANDEVU SİSTEMİ\n4 / 8\nBaşvuru Merkezini Seçin\nOfis",
  wizardOfficeNoSlot: "RANDEVU SİSTEMİ\n4 / 8\nBaşvuru Merkezini Seçin\nUygun Randevu Bulunmamaktadır.",
  unrelated: "başka bir sayfa",
};

(async () => {
  /* ---- 1) saf karar fonksiyonu ---- */
  const base = openPage("<html><body></body></html>");
  const classify = base.window.classify;
  truthy("classify() global olarak erişilebilir", typeof classify === "function");

  if (typeof classify === "function") {
    eq("boş ofis + randevu yok metni → none", classify(MSG.wizardOfficeNoSlot, []).status, "none");
    eq("ofis adımı, metin yok, kart yok → unknown (yanlış pozitif önleme)", classify(MSG.wizardOffice, []).status, "unknown");
    eq("ofis adımı, kart var → available", classify(MSG.wizardOffice, ["Beylikdüzü"]).status, "available");
    eq("cloudflare → blocked", classify(MSG.blocked, []).status, "blocked");
    eq("girişsiz → login", classify(MSG.login, []).status, "login");
    eq("alakasız → unknown", classify(MSG.unrelated, []).status, "unknown");
    truthy("available sonucu ofis listesini taşır", JSON.stringify(classify(MSG.wizardOffice, ["A", "B"]).offices) === '["A","B"]');
  }
  base.dom.window.close();

  /* ---- 2) gerçek kaydedilmiş sayfa (randevu yok) ---- */
  const p1 = openPage(FIX("no-slot.html"));
  const r1 = await runInspect(p1);
  eq("gerçek DOM: durum none", r1.status, "none");
  truthy("gerçek DOM: adım bilgisi dolu", typeof r1.step === "string" && r1.step.includes("Başvuru Merkezini Seçin"), `step=${JSON.stringify(r1.step)}`);
  truthy("gerçek DOM: adım göstergesi 4/8", typeof r1.step === "string" && r1.step.includes("4/8"), `step=${JSON.stringify(r1.step)}`);
  p1.dom.window.close();

  /* ---- 3) ofis kartları olan (tahmini fixture) ---- */
  const p2 = openPage(FIX("available.html"));
  const r2 = await runInspect(p2);
  eq("tahmini fixture: durum available", r2.status, "available");
  eq("tahmini fixture: 3 ofis okundu", (r2.offices || []).length, 3);
  p2.dom.window.close();

  /* ---- 4) metin yok + kart yok → unknown (2 sn bekleme sonrası) ---- */
  const p3 = openPage(`<html><body><h1>RANDEVU SİSTEMİ</h1><span>4 / 8</span><h2>Başvuru Merkezini Seçin</h2></body></html>`);
  const r3 = await runInspect(p3);
  eq("metin yok + kart yok → unknown", r3.status, "unknown");
  truthy("unknown detayı 'liste yüklenmedi' der", /yüklenmedi/i.test(r3.detail || ""), `detail=${JSON.stringify(r3.detail)}`);
  p3.dom.window.close();

  /* ---- 5) blok / girişsiz / alakasız sayfalar ---- */
  const p4 = openPage(MSG.blocked.replace(/\n/g, "<br>"));
  const r4 = await runInspect(p4);
  eq("sahte cloudflare → blocked", r4.status, "blocked");
  p4.dom.window.close();

  const p5 = openPage("<html><body><h2>Giriş Yap</h2><input type='password' placeholder='Şifre'></body></html>");
  const r5 = await runInspect(p5);
  eq("sahte giriş → login", r5.status, "login");
  p5.dom.window.close();

  const p6 = openPage("<html><body><p>alakasız</p></body></html>");
  const r6 = await runInspect(p6);
  eq("alakasız → unknown", r6.status, "unknown");
  p6.dom.window.close();

  /* ---- sonuç ---- */
  console.log(`${pass} geçti, ${failures.length} başarısız`);
  if (failures.length) {
    for (const f of failures) console.log("FAIL " + f);
    process.exit(1);
  }
})();
