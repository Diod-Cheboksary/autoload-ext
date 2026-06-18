// MV3 service worker. Content scripts run in the supplier page's origin, so
// their fetches to e133.tech are cross-site and drop the Authentik session
// cookie. The service worker runs in the extension's own context: a fetch to
// a host listed in host_permissions is treated as first-party, so
// credentials:"include" sends the e133.tech session cookie. Every backend
// call from a content script is routed here.
"use strict";

async function apiFetch({ method, url, body }) {
  const init = { method: method || "GET", credentials: "include" };
  if (body !== undefined && body !== null) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const resp = await fetch(url, init);
  const text = await resp.text();
  return { status: resp.status, text };
}

if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "apiFetch") {
      apiFetch(msg)
        .then(sendResponse)
        .catch((e) => sendResponse({ status: 0, text: "", error: String((e && e.message) || e) }));
      return true; // keep the channel open for the async response
    }
    if (msg.type === "openLogin") {
      chrome.tabs.create({ url: msg.url });
      return false;
    }
    return false;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { apiFetch };
}
