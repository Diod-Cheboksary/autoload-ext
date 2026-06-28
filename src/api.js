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

  // Бэк на 403 от резолва филиала (tg-auth-0kx) шлёт structured detail
  // {code, detail, branches}. Нормализуем detail в СТРОКУ, чтобы все места показа
  // (status_el.textContent = data.detail || "ошибка") отрисовали понятный текст,
  // а не [object Object]. branch_selection_required = мультифилиал без выбора.
  function normalizeBranchError(status, parsed) {
    if (status !== 403 || !parsed || typeof parsed.detail !== "object" || !parsed.detail) {
      return parsed;
    }
    const code = parsed.detail.code;
    let msg = parsed.detail.detail || "доступ запрещён";
    if (code === "branch_selection_required") msg = "выберите филиал в /barcode/";
    else if (code === "no_branch") msg = "нет доступа к филиалу";
    return Object.assign({}, parsed, { detail: msg });
  }

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
    return { status: resp.status, body: normalizeBranchError(resp.status, parsed) };
  }

  async function whoami() {
    const { status, body } = await apiRequest("GET", API_WHOAMI);
    return {
      ok: status === 200 && !!body && body.authenticated === true,
      status,
      user: body && body.user,
      // Активный филиал (мультифилиал → запомненный текущий) — показать оператору,
      // куда уйдёт приходная. branch_name приоритетнее слага.
      branch: body && (body.branch_name || body.branch),
    };
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
      const { ok, status, user, branch } = await whoami();
      btn.disabled = false;
      if (ok) {
        btn.textContent = branch
          ? `Autoload: вход ОК (${user || "—"} · ${branch})`
          : `Autoload: вход ОК (${user || "—"})`;
      } else {
        btn.textContent = "Autoload: войдите в /barcode/";
        if (status === 401 || status === 0) openLogin();
      }
    });
    document.body.appendChild(btn);
  }

  /** Coerce an untrusted value (e.g. a count from the backend JSON) to a
   *  finite number, or 0. Lets batch-result counts be rendered via textContent
   *  instead of innerHTML — a compromised/MITM'd backend can't inject HTML. */
  function safeInt(v) {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  if (typeof globalThis !== "undefined") {
    globalThis.AutoloadApi = { apiRequest, whoami, openLogin, injectLoginButton, safeInt };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { apiRequest, whoami, openLogin, injectLoginButton, safeInt };
  }
})();
