/* MAIN dünyasında çalışır: sayfanın kendi API çağrılarını (fetch/XHR) izler.
   Amaç teşhis — randevu verisinin hangi uçtan geldiğini görmek.
   Sadece tursys API'sine ait URL'ler ve kısaltılmış gövde raporlanır. */
(() => {
  const API_HOST = "web-api-eu.tursys.info";
  const MAX_BODY = 2000;

  const report = (url, body) => {
    try {
      window.postMessage({ __asvisa: true, url: String(url), body: String(body).slice(0, MAX_BODY) }, "*");
    } catch { /* yok say */ }
  };

  const isApi = (u) => typeof u === "string" && u.includes(API_HOST);

  try {
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function (...args) {
        const p = origFetch.apply(this, args);
        try {
          const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
          if (isApi(url)) {
            p.then((res) => {
              try { res.clone().text().then((t) => report(url, t)).catch(() => {}); } catch { /* yok say */ }
            }).catch(() => {});
          }
        } catch { /* yok say */ }
        return p;
      };
    }
  } catch { /* yok say */ }

  try {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__asvisaUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", () => {
        try {
          if (isApi(this.__asvisaUrl)) report(this.__asvisaUrl, this.responseText);
        } catch { /* yok say */ }
      });
      return origSend.apply(this, args);
    };
  } catch { /* yok say */ }
})();
