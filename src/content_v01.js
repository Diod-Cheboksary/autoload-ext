// Content script for v01.ru (МПартс).
//
// 1) On https://v01.ru/personal/orders/ the LK renders each order line as
//    <tr rel="order-12345969"> — multiple rows can share the same order_id
//    (one row per position/basket-id).
// 2) Next to the order number cell we inject a 📋 button.
// 3) Click → GET https://e133.tech/barcode/api/lookup/mparts/<order_number>
//    Renders the parts table in a floating panel anchored next to the button.
// 4) v01.ru re-renders the table on filter/page switch. A MutationObserver
//    re-decorates new rows as they appear.
//
// Shares look-and-feel with PartKom's content.js but injects on a different
// DOM and calls the /mparts/ backend route. Behaviour of the queue +
// "Принять все в 1С" buttons is identical to PartKom's panel.

(() => {
  "use strict";

  const API_LOOKUP_BASE = "https://e133.tech/barcode/api/lookup/mparts";
  const API_QUEUE_ADD = "https://e133.tech/barcode/api/receipts/queue";
  const API_QUEUE_GET = "https://e133.tech/barcode/api/receipts/queue";
  const API_QUEUE_ACCEPT = "https://e133.tech/barcode/api/receipts/queue/accept";
  // Order rows look like <tr rel="order-12345969">. Capture the digits.
  const ORDER_REL_RE = /^order-(\d{6,10})$/;
  // УПД invoice format on v01.ru paper documents: МПр-YYMMDD-NNNNN. The
  // extension scrapes it from the data-original-title of the document link
  // inside each row so the bookkeeper sees the same Вх. номер in 1С as on
  // the УПД paper (instead of the API's order_number).
  const INVOICE_RE = /МПр-\d{4,8}-\d{3,8}/;
  const MARKER_CLASS = "autoload-ext-marker";
  const BUTTON_CLASS = "autoload-ext-btn";
  const PANEL_CLASS = "autoload-ext-panel";

  // ---- DOM utilities ----------------------------------------------------

  /** Find all order rows that haven't been decorated yet.
   *  Returns an array of {row, orderNumber, anchorCell}. */
  function findUndecoratedOrderRows(root) {
    const out = [];
    const rows = root.querySelectorAll('tr[rel^="order-"]:not(.' + MARKER_CLASS + ')');
    for (const row of rows) {
      const rel = row.getAttribute("rel") || "";
      const m = ORDER_REL_RE.exec(rel);
      if (!m) continue;
      // Place button inside the order_id cell so it's visually associated
      // with the number; fallback to the row itself if the cell isn't there.
      const cell = row.querySelector("td.order_id") || row.querySelector("td") || row;
      out.push({ row, orderNumber: m[1], anchorCell: cell });
    }
    return out;
  }

  function injectButton({ row, orderNumber, anchorCell }) {
    row.classList.add(MARKER_CLASS);

    const btn = document.createElement("button");
    btn.className = BUTTON_CLASS;
    btn.type = "button";
    btn.title = `Autoload: открыть заказ МПр${orderNumber}`;
    btn.textContent = "📋";
    btn.dataset.order = orderNumber;
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handleClick(btn, orderNumber, row);
    });
    anchorCell.appendChild(btn);
  }

  /** Pull the invoice number (МПр-YYMMDD-NNNNN) out of the row.
   *  v01.ru places the УПД link in <td class="order_action">; the tooltip
   *  text (data-original-title or title) carries the human-readable file
   *  name including the invoice number. Returns null when the row has no
   *  UPD yet (e.g. order still in transit). */
  function extractInvoiceFromRow(row) {
    const anchors = row.querySelectorAll('a[href*="/personal/documents/"]');
    for (const a of anchors) {
      const candidates = [
        a.getAttribute("data-original-title") || "",
        a.getAttribute("title") || "",
      ];
      for (const c of candidates) {
        // The string is URL-encoded (%20, %28 …). Match on the raw value —
        // МПр and digits stay intact through encoding so regex works
        // without a full decodeURIComponent.
        const m = INVOICE_RE.exec(c);
        if (m) return m[0];
      }
    }
    return null;
  }

  function decoratePage(root = document.body) {
    for (const item of findUndecoratedOrderRows(root)) {
      injectButton(item);
    }
  }

  // ---- Panel rendering (mirrors PartKom's content.js) -------------------

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

  function renderLoading(panel, orderNumber) {
    panel.innerHTML = "";
    const h = document.createElement("div");
    h.className = "autoload-ext-header";
    h.textContent = `МПр${orderNumber} — загружаю…`;
    panel.appendChild(h);
  }

  function renderError(panel, orderNumber, message) {
    panel.innerHTML = "";
    const h = document.createElement("div");
    h.className = "autoload-ext-header autoload-ext-error";
    h.textContent = `МПр${orderNumber} — ошибка`;
    const b = document.createElement("div");
    b.className = "autoload-ext-body";
    b.textContent = message;
    panel.append(h, b);
  }

  function renderTable(panel, orderNumber, body, invoiceNumber) {
    panel.innerHTML = "";
    const header = document.createElement("div");
    header.className = "autoload-ext-header";
    const itemCount = (body.items || []).length;
    const invoiceTag = invoiceNumber ? ` (УПД ${invoiceNumber})` : "";
    header.textContent =
      `Заказ МПр${orderNumber}${invoiceTag} — ${itemCount} ${pluralRus(itemCount, ["позиция","позиции","позиций"])} | итого ${body.total_price} ₽`;
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

    const queueRow = document.createElement("div");
    queueRow.className = "autoload-ext-queue-row";

    // MParts queue identifier is the raw order_number (no prefix).
    const mpartsId = String(body.realization || orderNumber);

    const add = document.createElement("button");
    add.className = "autoload-ext-add";
    add.type = "button";
    add.textContent = "Добавить в очередь";
    add.addEventListener("click", async () => {
      add.disabled = true;
      add.textContent = "Добавляем…";
      const status = document.createElement("div");
      status.className = "autoload-ext-queue-status";
      queueRow.appendChild(status);
      try {
        const reqBody = { supplier: "mparts", identifier: mpartsId };
        if (invoiceNumber) reqBody.incoming_number = invoiceNumber;
        const r = await fetch(API_QUEUE_ADD, {
          method: "POST",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });
        const ok = r.status === 200;
        const data = await r.json().catch(() => ({}));
        if (ok) {
          status.textContent = data.added
            ? "✅ Добавлено в очередь"
            : "⚠ Уже в очереди";
          status.classList.add(data.added
            ? "autoload-ext-queue-ok"
            : "autoload-ext-queue-warn");
          add.remove();
          refreshQueueBadge(panel);
        } else {
          status.textContent =
            `❌ ${data.detail || "ошибка"} (HTTP ${r.status})`;
          status.classList.add("autoload-ext-queue-err");
          add.disabled = false;
          add.textContent = "Добавить в очередь";
        }
      } catch (e) {
        status.textContent = `❌ нет связи: ${e instanceof Error ? e.message : e}`;
        status.classList.add("autoload-ext-queue-err");
        add.disabled = false;
        add.textContent = "Добавить в очередь";
      }
    });

    const submitAll = document.createElement("button");
    submitAll.className = "autoload-ext-submit-all";
    submitAll.type = "button";
    submitAll.textContent = "Принять все в 1С";
    submitAll.addEventListener("click", async () => {
      submitAll.disabled = true;
      submitAll.textContent = "Принимаем…";
      const results = document.createElement("div");
      results.className = "autoload-ext-batch-results";
      queueRow.appendChild(results);
      try {
        const r = await fetch(API_QUEUE_ACCEPT, {
          method: "POST", credentials: "omit",
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 200 && data.results) {
          results.innerHTML =
            `<div><strong>Результаты:</strong> успешно ${data.succeeded}, ошибок ${data.failed}, осталось ${data.remaining}</div>`;
          const list = document.createElement("ul");
          for (const item of data.results) {
            const li = document.createElement("li");
            if (item.ok) {
              li.textContent = `✅ ${item.identifier} → ${item.document_id}`;
              li.classList.add("autoload-ext-batch-ok");
            } else {
              li.textContent = `❌ ${item.identifier}: ${item.error_kind} — ${item.error_detail}`;
              li.classList.add("autoload-ext-batch-err");
            }
            list.appendChild(li);
          }
          results.appendChild(list);
          refreshQueueBadge(panel);
        } else {
          results.textContent = `❌ HTTP ${r.status}: ${data.detail || "ошибка"}`;
          results.classList.add("autoload-ext-queue-err");
        }
      } catch (e) {
        results.textContent = `❌ нет связи: ${e instanceof Error ? e.message : e}`;
        results.classList.add("autoload-ext-queue-err");
      } finally {
        submitAll.disabled = false;
        submitAll.textContent = "Принять все в 1С";
      }
    });

    queueRow.appendChild(add);
    queueRow.appendChild(submitAll);
    panel.appendChild(queueRow);
    refreshQueueBadge(panel);

    const close = document.createElement("button");
    close.className = "autoload-ext-close";
    close.type = "button";
    close.textContent = "✕";
    close.title = "Закрыть";
    close.addEventListener("click", closePanel);
    panel.appendChild(close);
  }

  async function refreshQueueBadge(panel) {
    try {
      const r = await fetch(API_QUEUE_GET, { credentials: "omit" });
      if (!r.ok) return;
      const data = await r.json();
      const header = panel.querySelector(".autoload-ext-header");
      if (!header) return;
      let badge = header.querySelector(".autoload-ext-queue-badge");
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "autoload-ext-queue-badge";
        header.appendChild(badge);
      }
      badge.textContent = ` | в очереди: ${data.count}`;
    } catch { /* silent — UI degrades gracefully */ }
  }

  function pluralRus(n, forms) {
    const abs = Math.abs(n) % 100;
    const rem = abs % 10;
    if (abs > 10 && abs < 20) return forms[2];
    if (rem > 1 && rem < 5)   return forms[1];
    if (rem === 1)            return forms[0];
    return forms[2];
  }

  async function handleClick(btn, orderNumber, row) {
    closePanel();
    const panel = buildPanel();
    anchorPanel(panel, btn);
    document.body.appendChild(panel);
    renderLoading(panel, orderNumber);

    // Extract invoice number from the same row's УПД link if present.
    // Null is fine — backend falls back to the order_number as Вх. номер.
    const invoiceNumber = row ? extractInvoiceFromRow(row) : null;

    const url = `${API_LOOKUP_BASE}/${encodeURIComponent(orderNumber)}`;

    try {
      const resp = await fetch(url, { credentials: "omit" });
      const text = await resp.text();
      let body;
      try { body = JSON.parse(text); } catch { body = null; }

      if (resp.status === 200 && body) {
        renderTable(panel, orderNumber, body, invoiceNumber);
        return;
      }
      if (resp.status === 404 && body) {
        renderError(panel, orderNumber,
          body.detail || "не найдено");
        return;
      }
      if (resp.status === 502 && body) {
        renderError(panel, orderNumber,
          body.detail || "сбой API МПартс");
        return;
      }
      if (resp.status === 422 && body) {
        renderError(panel, orderNumber,
          body.detail || "неверный формат");
        return;
      }
      renderError(panel, orderNumber, `HTTP ${resp.status}`);
    } catch (e) {
      renderError(panel, orderNumber,
        e instanceof Error ? e.message : String(e));
    }
  }

  // ---- Bootstrap + observer --------------------------------------------

  decoratePage();

  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t instanceof Element &&
        !t.closest(`.${PANEL_CLASS}`) &&
        !t.classList.contains(BUTTON_CLASS)) {
      closePanel();
    }
  });

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
