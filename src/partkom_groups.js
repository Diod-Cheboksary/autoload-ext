// Maps PartKom orders to their delivery-route GUID by parsing the RAW
// server HTML of /parts/motion.php (fetched separately — the live DOM is
// useless: Vue 2 compiles away the <opt-tracking link="…"> tags on mount).
//
// Raw-HTML row structure (reversed from a saved page, 2026-06-12):
//   - each order spans N <tr> rows (one per position);
//   - the FIRST row carries "№ УАК…" text via rowspan cells;
//   - every position row may carry <opt-tracking link="…"> while the
//     delivery route is active; the link contains the route UUID shared
//     by all orders of one физическая накладная.
(function () {
  "use strict";

  const UAK_RE = /(?:№\s*)?УАК(\d{6,12})/;
  const UUID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  function extractGuid(link) {
    const m = UUID_RE.exec(link || "");
    return m ? m[1].toLowerCase() : null;
  }

  /**
   * @param {string} html raw windows-1251-decoded HTML of motion.php
   * @returns {{orderToGuid: Object<string,string>, guidToOrders: Object<string,string[]>}}
   *   orderToGuid keys are bare digits (no УАК prefix), matching the
   *   identifiers the backend lookup expects.
   */
  function parsePartkomGroups(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const orderToGuid = {};
    // Explicit insertion-order list because Object.entries sorts numeric-looking
    // string keys numerically (ECMAScript spec), which would break the test
    // expectation that guidToOrders arrays reflect document order.
    const insertionOrder = [];
    let currentOrder = null;
    for (const tr of doc.querySelectorAll("tr")) {
      // Order-header rows (and only they) contain "№ УАК…" as text.
      const m = UAK_RE.exec(tr.textContent || "");
      if (m) currentOrder = m[1];
      if (!currentOrder) continue;
      const t = tr.querySelector("opt-tracking");
      if (!t) continue;
      // Static attr in PHP-rendered HTML; ':link' guard for a Vue-bound
      // variant ("'url'" — UUID extraction strips the inner quotes).
      // ?? not ||: an explicit link="" must not silently fall through to :link.
      const guid = extractGuid(t.getAttribute("link") ?? t.getAttribute(":link"));
      if (guid && !(currentOrder in orderToGuid)) {
        orderToGuid[currentOrder] = guid;
        insertionOrder.push(currentOrder);
      }
    }
    const guidToOrders = {};
    for (const order of insertionOrder) {
      const guid = orderToGuid[order];
      (guidToOrders[guid] = guidToOrders[guid] || []).push(order);
    }
    return { orderToGuid, guidToOrders };
  }

  const api = { parsePartkomGroups };
  globalThis.AutoloadPartkomGroups = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api; // vitest (CJS interop)
  }
})();
