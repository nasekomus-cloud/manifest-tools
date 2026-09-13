# Что уже построено

Читается до начала работы. Не изобретай заново то, что здесь есть.

## Границы, решённые в спецификации

- `lib/port-breakdown.js` — владеет подсчётом разбивки по порту/типу/признаку
  «порожний». Выставляет `buildPortBreakdownDashboard(workbooks, {portKeyword,
  portLabel, splitEmpty?})` — сигнатура расширяется необязательным
  параметром `splitEmpty` (по умолчанию `false`, сохраняет текущее
  поведение). Прячет группировку, поиск колонок, нормализацию.
- `dashboard/core.js` — тонкая обёртка, как и сейчас. Выставляет
  `buildPortDashboard(workbooks)` — сигнатура не меняется, внутри зовёт
  `buildPortBreakdownDashboard` с `splitEmpty: true`.
- `dashboard/app.js` — владеет рендером страницы, сборкой и печатным
  форматированием Excel-отчёта. Наружу ничего не выставляет — конечный
  скрипт страницы.
- `tools.js` — владеет реестром инструментов, их порядком и вкладкой.
  Выставляет `window.TOOLS`.

Шов для тестов — существующий: `buildPortBreakdownDashboard`
(`lib/port-breakdown.test.js`) и `buildPortDashboard`
(`dashboard/core.test.js`). Второго шва не заводим.

## Общие правила проекта

- Тесты: `npm test` (`node --test`), один файл — `node --test <путь>`.
- Дев-сервер для ручной проверки: `python3 -m http.server 8000` из корня,
  либо дев-сервер `manifest-tools` в `.claude/launch.json`.
- ExcelJS в браузере — CDN-тег `4.4.0` (уже подключён на странице
  `dashboard/index.html`); в тестах — npm-пакет `exceljs` из
  `devDependencies`. Не менять версию ни там, ни там.
- `dashboard-departure/` (тот же общий модуль `lib/port-breakdown.js`) —
  поведение и вывод не меняются: параметр `splitEmpty` туда не передаётся.
  Файлы `dashboard-departure/core.js`, `dashboard-departure/app.js`,
  `dashboard-departure/index.html` трогать только ради обязательного
  каскада `?v=` (см. ниже) — без единой правки логики или текста.
- Кэш-бастинг сайта (см. CLAUDE.md, «Подводные камни») — при правке
  `lib/port-breakdown.js`, `tools.js`, `assets/style.css` обновляется
  число `?v=` **везде**, где файл упомянут прямо или косвенно (через
  цепочку импортов), одним и тем же новым значением на весь прогон:
  `202609131530`.
  - `lib/port-breakdown.js` → строка импорта меняется в `dashboard/core.js`
    и в `dashboard-departure/core.js` (второе — только цифра, без правки
    логики).
  - `dashboard/core.js` изменился → строка импорта в `dashboard/app.js`.
    `dashboard-departure/core.js` изменился (только цифра) → строка
    импорта в `dashboard-departure/app.js`.
  - `dashboard/app.js` изменился → `<script type="module" src="app.js?v=…">`
    в `dashboard/index.html`. То же для `dashboard-departure/app.js` →
    `dashboard-departure/index.html` (только цифра).
  - `tools.js` изменился → `<script src="…tools.js?v=…">` на всех десяти
    страницах: `index.html` (корень), `merge/`, `dg-check/`, `dashboard/`,
    `dashboard-departure/`, `bl-split/`, `grand-total/`, `order-check/`,
    `bl-registry/`, `template-check/`.
  - `assets/style.css` изменился → `<link rel="stylesheet"
    href="…assets/style.css?v=…">` на тех же десяти страницах.
  - Не забыть `lib/manifest-format.js?v=…` — не трогается, версия не
    меняется нигде.
- Ничего не удалять из `assets/fonts.css` и не трогать её — не
  затрагивается этой задачей.
- Если чего-то не хватает (зависимости, решения) — вернуть `BLOCKED`, не
  устанавливать самовольно.

## Что построено (T0, один проход)

- `lib/port-breakdown.js`: `buildBreakdown(rows, {splitEmpty=false})` и
  `buildPortBreakdownDashboard(workbooks, {portKeyword, portLabel,
  splitEmpty=false})` — при `splitEmpty: true` группа «порт × тип»
  дополнительно делится по `isEmpty` (`cargoWeight === 0`); каждая запись
  `types[]` тогда несёт поле `isEmpty: boolean`. По умолчанию (`false`)
  поведение и форма возврата не меняются — `isEmpty` в записи не появляется
  вовсе (не `undefined`-поле, а действительно отсутствует в объекте).
- `dashboard/core.js`: `buildPortDashboard(workbooks)` без изменений
  сигнатуры, внутри зовёт с `splitEmpty: true`.
- `dashboard-departure/core.js`: без изменений поведения — параметр не
  передаёт, `isEmpty` в его выводе по-прежнему нет.
- `dashboard/app.js`: `typeLabel(type)` — подпись `<тип> — порожние` для
  `isEmpty`; `formatSheetForPrint(sheet, {dataRows, emptyRowNumbers,
  totalRowNumbers})` — пост-обработка уже записанного листа (ширины колонок,
  рамка, заливка порожних `FFEAF1F2`, `numFmt: '#,##0'` на весах, жирный
  шрифт на итоговых строках, `pageSetup` печати); `writeBreakdownToSheet`
  теперь возвращает эти три поля вместо `void`.
- Тесты: `lib/port-breakdown.test.js` (+3 — без `splitEmpty`, с ним, и
  порт только с порожними), `dashboard/core.test.js` (+1 — обёртка
  действительно передаёт `splitEmpty: true`). 275 тестов, все зелёные.
- Готовый Excel проверен не только тестами, но и вручную — загружен через
  дев-сервер, скачан, разобран как zip: `pageSetup`
  (`orientation=landscape, fitToWidth=1, fitToHeight=0`),
  `_xlnm.Print_Area`/`_xlnm.Print_Titles` на обоих листах, заливка и границы
  — все на месте.
