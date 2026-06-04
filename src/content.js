// Content script. Runs on every b2b.part-kom.ru page.
//
// 1) Walks the page and finds every text node matching /№\s*УАК\d{6,12}/.
//    These are PartKom order numbers shown in the "История заказов" table.
// 2) Next to each match, injects a small button "📋 Открыть".
// 3) Clicking the button calls our backend
//      GET https://e133.tech/barcode/api/lookup/partkom/<digits>
//    and renders the resulting table in a floating panel anchored next to
//    the button.
// 4) The PartKom UI rerenders rows on scroll/filter/page switch — we observe
//    the DOM with a MutationObserver and reapply.

(() => {
  "use strict";

  const API_LOOKUP_BASE = "https://e133.tech/barcode/api/lookup/partkom";
  const API_ACCEPT_URL = "https://e133.tech/barcode/api/receipts/accept";
  // Match "№ УАК55409720" or just "УАК55409720"; capture the digits.
  const UAK_RE = /(?:№\s*)?УАК(\d{6,12})/;
  const MARKER_CLASS = "autoload-ext-marker";
  const BUTTON_CLASS = "autoload-ext-btn";
  const PANEL_CLASS = "autoload-ext-panel";

  // ---- DOM utilities ----------------------------------------------------

  /** Walks `root` looking for text nodes whose value contains a UAK number,
   *  and whose parent hasn't been decorated yet. */
  function* findUAKTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !UAK_RE.test(n.nodeValue)) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = n.parentElement;
        if (!parent || parent.classList.contains(MARKER_CLASS)) {
          return NodeFilter.FILTER_REJECT;
        }
        // Don't double-decorate text we already put on the page.
        if (parent.closest(`.${BUTTON_CLASS}, .${PANEL_CLASS}`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) yield node;
  }

  function injectButton(textNode) {
    const match = UAK_RE.exec(textNode.nodeValue);
    if (!match) return;
    const digits = match[1];

    const parent = textNode.parentElement;
    parent.classList.add(MARKER_CLASS);

    const btn = document.createElement("button");
    btn.className = BUTTON_CLASS;
    btn.type = "button";
    btn.title = `Autoload: открыть содержимое заказа УАК${digits}`;
    btn.textContent = "📋";
    btn.dataset.uak = digits;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handleClick(btn, digits);
    });

    // Insert button right after the text node so it sits inline with the
    // number. PartKom uses a table layout, putting it after works fine.
    if (textNode.nextSibling) {
      parent.insertBefore(btn, textNode.nextSibling);
    } else {
      parent.appendChild(btn);
    }
  }

  function decoratePage(root = document.body) {
    for (const node of findUAKTextNodes(root)) {
      injectButton(node);
    }
  }

  // ---- Click handler / panel rendering ---------------------------------

  /** Close any open panel. */
  function closePanel() {
    const open = document.querySelector(`.${PANEL_CLASS}`);
    if (open) open.remove();
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.className = PANEL_CLASS;
    return panel;
  }

  function anchorPanel(panel, btn) {
    const rect = btn.getBoundingClientRect();
    panel.style.position = "absolute";
    panel.style.top  = `${rect.bottom + window.scrollY + 4}px`;
    panel.style.left = `${rect.left + window.scrollX}px`;
    panel.style.zIndex = "999999";
  }

  function renderLoading(panel, digits) {
    panel.innerHTML = "";
    const h = document.createElement("div");
    h.className = "autoload-ext-header";
    h.textContent = `УАК${digits} — загружаю…`;
    panel.appendChild(h);
  }

  function renderError(panel, digits, message) {
    panel.innerHTML = "";
    const h = document.createElement("div");
    h.className = "autoload-ext-header autoload-ext-error";
    h.textContent = `УАК${digits} — ошибка`;
    const b = document.createElement("div");
    b.className = "autoload-ext-body";
    b.textContent = message;
    panel.append(h, b);
  }

  function renderTable(panel, digits, body) {
    panel.innerHTML = "";
    const header = document.createElement("div");
    header.className = "autoload-ext-header";
    const itemCount = (body.items || []).length;
    header.textContent =
      `Заказ УАК${digits} — ${itemCount} ${pluralRus(itemCount, ["позиция","позиции","позиций"])} | итого ${body.total_price} ₽`;
    panel.appendChild(header);

    const table = document.createElement("table");
    table.className = "autoload-ext-table";
    table.innerHTML =
      "<thead><tr>" +
      "<th>Название</th><th>Артикул</th><th>Бренд</th>" +
      "<th>Кол-во</th><th>Цена</th><th>Сумма</th>" +
      "</tr></thead>";
    const tbody = document.createElement("tbody");
    for (const it of body.items || []) {
      const tr = document.createElement("tr");
      for (const cell of [it.name, it.partnumber, it.brand, it.count, `${it.price} ₽`, `${it.total} ₽`]) {
        const td = document.createElement("td");
        td.textContent = String(cell);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    panel.appendChild(table);

    const acceptRow = document.createElement("div");
    acceptRow.className = "autoload-ext-accept-row";
    const accept = document.createElement("button");
    accept.className = "autoload-ext-accept";
    accept.type = "button";
    accept.textContent = "Принять в 1С";
    accept.addEventListener("click", async () => {
      accept.disabled = true;
      accept.textContent = "Создаём…";
      const status = document.createElement("div");
      status.className = "autoload-ext-accept-status";
      acceptRow.appendChild(status);
      try {
        const r = await fetch(API_ACCEPT_URL, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplier: "partkom",
            // body.realization is what the lookup returned (УАК-prefixed
            // raw orderNumber from PartKom); the backend re-validates.
            identifier: String(body.realization || "").replace(/^УАК/, "") || digits,
          }),
        });
        const ok = r.status === 200;
        const data = await r.json().catch(() => ({}));
        if (ok) {
          status.textContent =
            `✅ ${data.document_id} → ${data.supplier_name}` +
            (data.replayed ? " (из кэша)" : "");
          status.classList.add("autoload-ext-accept-ok");
          accept.remove();
        } else {
          status.textContent =
            `❌ ${data.detail || "ошибка"} (HTTP ${r.status})`;
          status.classList.add("autoload-ext-accept-err");
          accept.disabled = false;
          accept.textContent = "Принять в 1С";
        }
      } catch (e) {
        status.textContent = `❌ нет связи: ${e instanceof Error ? e.message : e}`;
        status.classList.add("autoload-ext-accept-err");
        accept.disabled = false;
        accept.textContent = "Принять в 1С";
      }
    });
    acceptRow.appendChild(accept);
    panel.appendChild(acceptRow);

    const close = document.createElement("button");
    close.className = "autoload-ext-close";
    close.type = "button";
    close.textContent = "✕";
    close.title = "Закрыть";
    close.addEventListener("click", closePanel);
    panel.appendChild(close);
  }

  function pluralRus(n, forms) {
    const abs = Math.abs(n) % 100;
    const rem = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (rem > 1 && rem < 5)   return forms[1];
    if (rem === 1)            return forms[0];
    return forms[2];
  }

  async function handleClick(btn, digits) {
    closePanel();
    const panel = buildPanel();
    anchorPanel(panel, btn);
    document.body.appendChild(panel);
    renderLoading(panel, digits);

    // PartKom UI uses 10 digits sometimes (with a 2-digit year prefix). Our
    // backend strips it down to the last 8 anyway, but we send what we see.
    const url = `${API_LOOKUP_BASE}/${encodeURIComponent(digits)}`;

    try {
      const resp = await fetch(url, { credentials: "omit" });
      const text = await resp.text();
      let body;
      try { body = JSON.parse(text); } catch { body = null; }

      if (resp.status === 200 && body) {
        renderTable(panel, digits, body);
        return;
      }
      if (resp.status === 404 && body) {
        renderError(panel, digits,
          body.detail || "не найдено");
        return;
      }
      if (resp.status === 502 && body) {
        renderError(panel, digits,
          body.detail || "сбой API ПартКом");
        return;
      }
      if (resp.status === 422 && body) {
        renderError(panel, digits,
          body.detail || "неверный формат");
        return;
      }
      renderError(panel, digits, `HTTP ${resp.status}`);
    } catch (e) {
      renderError(panel, digits,
        e instanceof Error ? e.message : String(e));
    }
  }

  // ---- Bootstrap + observer --------------------------------------------

  decoratePage();

  // Close panel when clicking outside.
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t instanceof Element &&
        !t.closest(`.${PANEL_CLASS}`) &&
        !t.classList.contains(BUTTON_CLASS)) {
      closePanel();
    }
  });

  // PartKom renders rows lazily (scroll, page switch, search). Watch for
  // additions and re-decorate.
  const observer = new MutationObserver((muts) => {
    let needsScan = false;
    for (const m of muts) {
      if (m.type === "childList" && m.addedNodes.length > 0) {
        needsScan = true;
        break;
      }
    }
    if (needsScan) decoratePage();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
