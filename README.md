# Autoload — PartKom quick lookup

Chrome (and Edge) extension that decorates PartKom's "История заказов" page
with `📋` buttons next to each order number (`№ УАК…`). Clicking the button
fetches the order's parts from our backend at
`https://e133.tech/barcode/api/lookup/partkom/<digits>` and shows them in
an inline floating panel.

This sidesteps the problem that PartKom's printed waybill barcodes don't
correspond to any API-visible identifier — when the user is already
looking at the LK, the order number is right there on the screen.

## Install (unpacked, for internal use)

1. Clone this repo:
   ```bash
   git clone https://github.com/ChebDiod/autoload-ext.git
   ```
2. Open `chrome://extensions` (or `edge://extensions`).
3. Toggle **"Режим разработчика"** / "Developer mode" on (top-right).
4. Click **"Загрузить распакованное расширение"** / "Load unpacked".
5. Pick the `autoload-ext` folder.
6. Open <https://b2b.part-kom.ru/parts/motion.php>. Each `№ УАК…` row in the
   orders table now has a `📋` button next to it.

## What it does

* `src/content.js` runs on every `https://b2b.part-kom.ru/*` page.
* It scans text nodes for the pattern `№ УАК<6-12 digits>` and inserts a
  small button immediately after the number.
* The button click fires `GET https://e133.tech/barcode/api/lookup/partkom/<digits>`.
* A floating panel renders the parts table (name, partnumber, brand, count,
  price, sum) right under the button.
* A `MutationObserver` re-scans the DOM after PartKom rerenders (scroll,
  page switch, filter).

## What it does NOT do (yet)

* Auto-create the 1С waybill (Поступление товаров) — that's the next epic,
  see `project2-c7p` in the autoload repo's `bd` tracker.
* Support Chrome Web Store distribution — meant for side-load by a couple
  of people. If you want store distribution, bump the manifest `version`,
  zip the folder, and pay Google the one-time $5 fee.

## Backend dependency

The extension calls `https://e133.tech/barcode/api/lookup/partkom/<n>`. That
endpoint lives in the **autoload** backend repo and has CORS configured to
accept this extension's origin (`chrome-extension://*`) plus
`https://b2b.part-kom.ru`. If the backend isn't running or CORS isn't set
up, the panel will say "Failed to fetch".

## File layout

```
autoload-ext/
├── manifest.json          # MV3
├── src/
│   ├── content.js         # all the logic
│   └── content.css        # scoped styles for our injected nodes
├── icons/                 # 16/48/128 placeholders (orange squares)
└── README.md
```
