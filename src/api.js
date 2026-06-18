// Shared backend client for content scripts. Content scripts cannot send the
// e133.tech session cookie cross-site, so every backend call is delegated to
// the service worker (background.js) over chrome.runtime messaging. Loaded as
// a content script BEFORE content.js / content_v01.js (see manifest), so it
// publishes AutoloadApi on the shared isolated-world globalThis.
"use strict";
(() => {
  const API_BASE = "https://e133.tech/barcode/api";
  const API_WHOAMI = `${API_BASE}/whoami`;
  const LOGIN_URL = "https://e133.tech/barcode/";

  async function apiRequest(method, url, body) {
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: "apiFetch", method, url, body });
    } catch (e) {
      return { status: 0, body: null, error: String((e && e.message) || e) };
    }
    if (!resp) return { status: 0, body: null, error: "no response from service worker" };
    if (resp.error && !resp.status) return { status: 0, body: null, error: resp.error };
    let parsed = null;
    try { parsed = JSON.parse(resp.text); } catch { parsed = null; }
    return { status: resp.status, body: parsed };
  }

  async function whoami() {
    const { status, body } = await apiRequest("GET", API_WHOAMI);
    return { ok: status === 200 && !!body && body.authenticated === true, status, user: body && body.user };
  }

  function openLogin() {
    try { chrome.runtime.sendMessage({ type: "openLogin", url: LOGIN_URL }); } catch { /* SW asleep */ }
  }

  /** Floating bottom-right button: checks /barcode/ login and, if signed out,
   *  opens the login tab. DOM-agnostic, shared by both supplier pages. */
  function injectLoginButton() {
    if (typeof document === "undefined") return;
    if (document.querySelector(".autoload-ext-login")) return;
    const btn = document.createElement("button");
    btn.className = "autoload-ext-login";
    btn.type = "button";
    btn.textContent = "Autoload: проверить вход";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Проверяю…";
      const { ok, status, user } = await whoami();
      btn.disabled = false;
      if (ok) {
        btn.textContent = `Autoload: вход ОК (${user || "—"})`;
      } else {
        btn.textContent = "Autoload: войдите в /barcode/";
        if (status === 401 || status === 0) openLogin();
      }
    });
    document.body.appendChild(btn);
  }

  if (typeof globalThis !== "undefined") {
    globalThis.AutoloadApi = { apiRequest, whoami, openLogin, injectLoginButton };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { apiRequest, whoami, openLogin, injectLoginButton };
  }
})();
