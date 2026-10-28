const $ = (id) => document.getElementById(id);

const STATUS_LABEL = {
  available: ["RANDEVU VAR", "ok"],
  none: ["Randevu yok", ""],
  blocked: ["Sayfa bloklu", "warn"],
  login: ["Giriş gerekli", "warn"],
  unknown: ["Bilinmiyor", "warn"],
  inactive: ["Nöbet kapalı", ""],
  expired: ["Süre doldu", "warn"],
};

function fmt(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function left(ms) {
  if (ms <= 0) return "—";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} sa ${m} dk` : `${m} dk`;
}

async function send(action) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "popup", action }, (res) => resolve(res || {}));
  });
}

async function loadConfig() {
  const { config = {} } = await chrome.storage.local.get("config");
  $("tok").value = config.telegramToken || "";
  $("chat").value = config.telegramChat || "";
}

async function render() {
  const st = await send("state");
  const active = !!st.active && Date.now() < (st.endAt || 0);

  $("dot").className = "dot" + (active ? " on" : "");
  $("status").textContent = active ? "Nöbette (15 dk)" : "Kapalı";

  const [label, cls] = STATUS_LABEL[st.lastStatus] || ["—", ""];
  $("last").className = "v " + cls;
  $("last").textContent = st.lastCheck ? `${fmt(st.lastCheck)} · ${label}` : "—";

  $("step").textContent = st.lastStep || "—";
  $("step").title = st.lastStep || "";

  $("detail").textContent = st.lastDetail || "—";
  $("detail").title = st.lastDetail || "";

  const alarm = await chrome.alarms.get("asvisa-check");
  $("next").textContent = alarm ? fmt(alarm.scheduledTime) : "—";
  $("left").textContent = active ? left(st.endAt - Date.now()) : "—";

  $("start").disabled = active;
  $("stop").disabled = !active;
}

async function loadDiag() {
  const { diag = [] } = await chrome.storage.local.get("diag");
  const last = diag[diag.length - 1];
  $("diag").textContent = last ? `${new Date(last.ts).toLocaleTimeString("tr-TR")}\n${last.url}\n${last.body}` : "Kayıt yok.";
}

/* ---- teşhis maskeleme: dışarı çıkmadan önce kişisel veriyi temizle ---- */

const SENSITIVE_KEY = /^(name|surname|firstName|lastName|passport.*|phone|email|birth.*)$/i;

function maskValue(v) {
  return String(v)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\d{6,}/g, "[num]");
}

function maskNode(node) {
  if (Array.isArray(node)) return node.map(maskNode);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[gizli]" : maskNode(v);
    }
    return out;
  }
  return typeof node === "string" ? maskValue(node) : node;
}

/* JSON metni alır, maskelenmiş JSON metni döndürür; çözümlenemezse düz metin maskeler. */
function maskDiag(text) {
  const raw = String(text ?? "");
  try {
    return JSON.stringify(maskNode(JSON.parse(raw)), null, 2);
  } catch {
    return maskValue(raw);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

$("copy").addEventListener("click", async () => {
  const { diag = [] } = await chrome.storage.local.get("diag");
  // ts ve url maskelenmez: uç noktayı bulmak için gerekli
  const safe = diag.map((d) => ({ ts: d.ts, url: d.url, body: maskDiag(d.body) }));
  const ok = await copyText(JSON.stringify(safe, null, 2));
  $("copy").textContent = ok ? `Kopyalandı (${safe.length})` : "Kopyalanamadı";
  setTimeout(() => { $("copy").textContent = "Teşhisi kopyala"; }, 1800);
});

$("start").addEventListener("click", async () => {
  $("start").disabled = true;
  await send("start");
  await render();
});

$("stop").addEventListener("click", async () => {
  await send("stop");
  await render();
});

$("check").addEventListener("click", async () => {
  $("check").disabled = true;
  await send("check");
  $("check").disabled = false;
  await render();
  await loadDiag();
});

$("open").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.as-visa.com/appointment", active: true });
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    config: { telegramToken: $("tok").value.trim(), telegramChat: $("chat").value.trim() },
  });
  $("save").textContent = "Kaydedildi";
  setTimeout(() => { $("save").textContent = "Kaydet"; }, 1200);
});

$("test").addEventListener("click", async () => {
  const token = $("tok").value.trim();
  const chat = $("chat").value.trim();
  if (!token || !chat) { $("test").textContent = "Token/chat yok"; setTimeout(() => { $("test").textContent = "Test mesajı"; }, 1500); return; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: "AS Visa Nöbetçi testi ✅" }),
    });
    $("test").textContent = res.ok ? "Gönderildi" : "Hata " + res.status;
  } catch {
    $("test").textContent = "Ağ hatası";
  }
  setTimeout(() => { $("test").textContent = "Test mesajı"; }, 1800);
});

void loadConfig();
void render();
void loadDiag();
setInterval(render, 5000);
