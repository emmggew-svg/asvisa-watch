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
