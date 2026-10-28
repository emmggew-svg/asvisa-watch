const APP_URL = "https://www.as-visa.com/appointment";
const ALARM = "asvisa-check";
const PERIOD_MIN = 15;
const WATCH_MS = 3 * 24 * 60 * 60 * 1000; // 3 gün
const BLOCKED_NOTIFY_GAP_MS = 60 * 60 * 1000; // blok uyarısını saatte bir tekrarla

const DEFAULT_STATE = {
  active: false,
  startedAt: 0,
  endAt: 0,
  lastCheck: 0,
  lastStatus: "",
  lastDetail: "",
  lastOffices: [],
  lastBlockedNotify: 0,
  lastNotified: 0,
};

async function getState() {
  const s = await chrome.storage.local.get("state");
  return { ...DEFAULT_STATE, ...(s.state || {}) };
}

async function setState(patch) {
  const next = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ state: next });
  return next;
}

async function getConfig() {
  const c = await chrome.storage.local.get("config");
  return { telegramToken: "", telegramChat: "", ...(c.config || {}) };
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM);
  if (!existing) chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  const s = await getState();
  if (s.active && Date.now() < s.endAt) await ensureAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  const s = await getState();
  if (s.active && Date.now() < s.endAt) await ensureAlarm();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void checkNow();
});

chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith("asvisa")) return;
  const tab = await findTab(true);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  chrome.notifications.clear(id);
});

chrome.notifications.onButtonClicked.addListener(async (id, btn) => {
  if (!id.startsWith("asvisa") || btn !== 0) return;
  const tab = await findTab(true);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  }
  chrome.notifications.clear(id);
});

async function findTab(createIfMissing = false) {
  const tabs = await chrome.tabs.query({ url: "https://www.as-visa.com/*" });
  const appt = tabs.find((t) => (t.url || "").startsWith(APP_URL));
  if (appt) return appt;
  if (!createIfMissing) return null;
  return chrome.tabs.create({ url: APP_URL, active: false });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ping" });
    return;
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }
}

async function runCheckOnce() {
  const tab = await findTab(true);
  if (!tab || tab.id == null) return { status: "unknown", detail: "Sekme açılamadı." };

  if (!(tab.url || "").startsWith(APP_URL)) {
    await chrome.tabs.update(tab.id, { url: APP_URL });
    await new Promise((r) => setTimeout(r, 3000));
  }

  await ensureContentScript(tab.id);

  const result = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      chrome.tabs.sendMessage(tab.id, { type: "check" }, (res) => {
        if (chrome.runtime.lastError || !res) finish({ status: "unknown", detail: "Sayfa yanıt vermedi." });
        else finish(res);
      });
    } catch (e) {
      finish({ status: "unknown", detail: String(e) });
    }
    setTimeout(() => finish({ status: "unknown", detail: "Zaman aşımı." }), 25000);
  });

  return result;
}

async function notifyDesktop(id, title, message) {
  try {
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icon128.png",
      title,
      message,
      priority: 2,
      requireInteraction: true,
      buttons: [{ title: "Randevu sayfasını aç" }],
    });
  } catch { /* bildirim hatası akışı durdurmasın */ }
}

async function notifyTelegram(text) {
  const cfg = await getConfig();
  if (!cfg.telegramToken || !cfg.telegramChat) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cfg.telegramChat,
        text,
        disable_web_page_preview: false,
      }),
    });
  } catch { /* ağ hatası sonraki turda denenir */ }
}

async function checkNow() {
  const st = await getState();
  if (!st.active) return { status: "inactive" };
  if (Date.now() > st.endAt) {
    await stopWatch(true);
    return { status: "expired" };
  }

  const res = await runCheckOnce();
  const now = Date.now();
  const patch = { lastCheck: now, lastStatus: res.status || "unknown", lastDetail: res.detail || "", lastOffices: res.offices || [] };

  if (res.status === "available") {
    patch.lastNotified = now;
    await setState(patch);
    await notifyDesktop(`asvisa-available-${now}`, "Randevu açıldı!", (res.offices && res.offices.length ? res.offices.slice(0, 6).join(", ") : res.detail) + " — as-visa.com/appointment");
    await notifyTelegram(`🎯 AS Visa: randevu açılmış olabilir.\n${res.detail}${res.offices && res.offices.length ? "\n" + res.offices.slice(0, 8).join(", ") : ""}\n${APP_URL}`);
    return res;
  }

  if (res.status === "blocked" && now - st.lastBlockedNotify > BLOCKED_NOTIFY_GAP_MS) {
    patch.lastBlockedNotify = now;
    await setState(patch);
    await notifyDesktop(`asvisa-blocked-${now}`, "AS Visa: sayfa bloklu", "Cloudflare sayfayı engelliyor. Tarayıcıda sayfayı elle açıp doğrulamayı geçmen gerekebilir.");
    await notifyTelegram(`⚠️ AS Visa: Cloudflare sayfayı bloklu gösteriyor, kontrol yapılamıyor.\n${APP_URL}`);
    return res;
  }

  await setState(patch);
  return res;
}

async function startWatch() {
  const now = Date.now();
  await setState({ active: true, startedAt: now, endAt: now + WATCH_MS, lastStatus: "", lastDetail: "", lastBlockedNotify: 0 });
  chrome.alarms.create(ALARM, { periodInMinutes: PERIOD_MIN, delayInMinutes: 0.2 });
  return checkNow();
}

async function stopWatch(finished = false) {
  await setState({ active: false });
  await chrome.alarms.clear(ALARM);
  if (finished) {
    await notifyDesktop(`asvisa-end-${Date.now()}`, "AS Visa nöbeti bitti", "3 günlük kontrol süresi doldu.");
    await notifyTelegram("⏹️ AS Visa: 3 günlük randevu nöbeti sona erdi.");
  }
}

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg && msg.type === "diag") {
    void saveDiag(msg.url, msg.body);
    return false;
  }
  if (msg && msg.type === "popup") {
    (async () => {
      if (msg.action === "start") sendResponse(await startWatch());
      else if (msg.action === "stop") { await stopWatch(false); sendResponse({ status: "stopped" }); }
      else if (msg.action === "check") sendResponse(await checkNow());
      else if (msg.action === "state") sendResponse(await getState());
      else sendResponse({ status: "unknown" });
    })();
    return true;
  }
  return false;
});

async function saveDiag(url, body) {
  const { diag = [] } = await chrome.storage.local.get("diag");
  diag.push({ ts: Date.now(), url: String(url).slice(0, 300), body: String(body).slice(0, 2000) });
  await chrome.storage.local.set({ diag: diag.slice(-20) });
}
