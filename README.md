# Autoload — supplier quick lookup (PartKom + MParts)

Chrome (and Edge) MV3 extension that decorates supplier order pages with `📋`
buttons next to each order number and pulls the order's parts from our backend
at `https://e133.tech/barcode/api/…`, showing them in an inline floating panel.
It also drives the **collect-then-batch** receipt flow shared with the
`/barcode/` web UI: «Добавить в очередь», «Принять все в 1С», and «Принять
накладную (N заказов)» (all orders of one delivery run → one приходная in 1С).

Two suppliers:

* **PartKom** — `b2b.part-kom.ru` (`№ УАК…` order numbers on «История заказов» /
  `motion.php`).
* **MParts** — `v01.ru/personal/orders…`.

This sidesteps the problem that the printed waybill barcodes don't correspond to
any API-visible identifier — when the user is already in the LK, the order number
is right there on screen.

## Вход через Authentik (с v0.6.0)

Бэкенд `/barcode/` за Authentik forward-auth. Чтобы расширение работало:

1. Войдите в <https://e133.tech/barcode/> под Authentik-аккаунтом из группы
   `autoload-users`. Без входа API отдаёт 401.
2. Запросы к API идут не из страницы поставщика (это был бы cross-site без куки),
   а из **service worker** расширения (`src/background.js`) с `credentials:"include"` —
   он переиспользует ту же сессионную куку `e133.tech` как first-party, поэтому
   отдельные токены/OAuth и CORS-послабления не нужны. Доступ к хосту даёт
   `host_permissions` (с v0.6.2 сужен до `https://e133.tech/barcode/api/*`).
3. Внизу справа на странице поставщика есть кнопка **«Autoload: проверить вход»** —
   показывает статус и при необходимости открывает вкладку логина.

## Install (unpacked, for internal use)

Текущая версия — **v0.6.2** (`manifest.json`).

1. Возьмите код — клонированием или ZIP:
   ```bash
   git clone https://github.com/Diod-Cheboksary/autoload-ext.git
   ```
   либо скачайте ZIP:
   <https://github.com/Diod-Cheboksary/autoload-ext/archive/refs/heads/master.zip>
   и распакуйте.
2. Откройте `chrome://extensions` (или `edge://extensions`).
3. Включите **«Режим разработчика»** / "Developer mode" (top-right).
4. **«Загрузить распакованное расширение»** / "Load unpacked".
5. Выберите папку `autoload-ext`.
6. Откройте <https://b2b.part-kom.ru/parts/motion.php> (или
   `v01.ru/personal/orders`). У каждого номера заказа появится `📋`.

После обновления расширения (новый ZIP/коммит) нажмите **reload** на карточке
расширения в `chrome://extensions`.

## What it does

* Контент-скрипты сканируют страницу поставщика и вставляют `📋` у номеров
  заказов: `src/content.js` на `b2b.part-kom.ru/*`, `src/content_v01.js` на
  `v01.ru/personal/orders*`.
* Клик по `📋` → service worker (`src/background.js`) делает
  `GET https://e133.tech/barcode/api/lookup/<supplier>/<id>` с first-party кукой
  и рендерит таблицу позиций (название, артикул, бренд, кол-во, цена, сумма) во
  всплывающей панели.
* **Collect-then-batch**: «Добавить в очередь» копит позиции, «Принять все в 1С»
  проводит очередь. Для ПартКома `src/partkom_groups.js` парсит `motion.php`,
  группирует заказы одной накладной по GUID трекинга Яндекс-Доставки и даёт
  «Принять накладную (N заказов)» → одна приходная из нескольких заказов.
* `MutationObserver` пере-сканирует DOM после рендеров портала (скролл,
  переключение страниц, фильтры).

## What it does NOT do (yet)

* Дистрибуцию через Chrome Web Store — рассчитано на side-load парой человек.
  Для стора: bump `version` в манифесте, zip папки, разовый $5 Google.

## Backend dependency

Расширение зовёт `https://e133.tech/barcode/api/…` (lookup'ы, очередь,
проведение). Эндпоинты — в репо **autoload** (backend). Доступ к API даёт
first-party кука `e133.tech` (вход через Authentik) + `host_permissions` на
`e133.tech/barcode/api/*`; фетчи идут из service worker'а, поэтому
CORS-разрешение для `chrome-extension://` НЕ нужно (и убрано на бэкенде). Если
не вошли или бэкенд недоступен — панель скажет про ошибку / 401.

## File layout

```
autoload-ext/
├── manifest.json            # MV3 (host_permissions, content_scripts, SW)
├── src/
│   ├── content.js           # ПартКом (b2b.part-kom.ru): 📋 + панель + очередь/батч
│   ├── content_v01.js       # МПартс (v01.ru)
│   ├── partkom_groups.js    # парс motion.php → группировка заказов по GUID рейса
│   ├── api.js               # построение API-запросов + кнопка «проверить вход»
│   ├── background.js        # service worker: credentialed fetch к бэкенду
│   ├── content.css          # стили инжектируемых узлов
│   └── *.test.js            # vitest (api / background / partkom_groups)
├── icons/                   # 16/48/128
└── README.md
```

Тесты: `npm test` (vitest).
