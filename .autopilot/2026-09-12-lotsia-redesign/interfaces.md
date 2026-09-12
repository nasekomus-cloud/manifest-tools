# Интерфейсы прогона «Лоция»

## Правила проекта, которые не вывести из кода

- Стек: статический сайт, чистые HTML/CSS/JS, **без сборки и без npm в проде**. Сторонние библиотеки в браузере — только `<script>`-теги с CDN (ExcelJS 4.4.0, pdf-lib 1.17.1, pdf.js 3.11.174, JSZip 3.10.1, @pdf-lib/fontkit 1.1.1) — их версии не менять.
- `index.html` (корневой), `tools.js`, `assets/shell.js` — **обычные скрипты без import/export**: главная открывается двойным кликом (`file://`). `app.js` страниц инструментов — `<script type="module">`.
- Тесты: `npm test` (`node --test`, сейчас 191 тест). `npm install` уже выполнен — `node_modules` на месте. Отсутствующая зависимость — `BLOCKED`, а не установка.
- Локальный запуск: дев-сервер `manifest-tools` из `.claude/launch.json` (`python3 -m http.server 8000` из корня) → `http://localhost:8000`.
- Кэш: каждый изменённый `.js`/`.css` получает новый `?v=<YYYYMMDDHHMM>` во всех ссылках на него, по цепочке `lib/*.js` → `core.js` → `app.js` → `index.html` страницы (CLAUDE.md, «Подводные камни»).
- `core.js` инструментов (логика обработки) **не меняются** — единственное исключение: `merge/core.js` импортирует `rowHasData` из `lib/manifest-format.js` вместо своей копии (таск 01).
- Не трогать: `.autopilot/`, `CLAUDE.md`, `deploy.sh`, `package*.json`, `.claude/`, `.agents/`, `skills-lock.json`.
- Не коммитить — коммиты делает оркестратор.
- Эталон внешнего вида — `.autopilot/2026-09-12-lotsia-redesign--wip/reference/design-options.html`, секция `id="b"` (уменьшенная картинка; размеры — по §6 спецификации).

## Границы, решённые в спецификации

| Модуль | Владеет | Выставляет | Прячет |
|---|---|---|---|
| `tools.js` | список инструментов, их порядок, вкладки, короткие имена, форматы | `window.TOOLS: Array<{title, navTitle?, description, href, category: 'export'\|'import', output?: 'xlsx'\|'pdf'\|'zip'}>` | — |
| `assets/shell.js` (обычный скрипт) | панель, переключатель вкладок, мобильное меню, крошки, шаги, полоса действия | `window.Shell.plural(n, one, few, many) -> string` · `window.Shell.setStep(n: 1\|2\|3)` · `window.Shell.setAction({info: string, hint: string\|null})` · `window.Shell.setResultShown(shown: boolean)` · `window.Shell.formatSize(bytes) -> string` | вычисление корня сайта от своего `src`, определение текущего инструмента по адресу, хранение вкладки, разметку панели |
| `lib/manifest-format.js` | формат манифеста | + `rowHasData(sheet, rowNumber) -> boolean` · + `countDataRows(workbook) -> number \| null` | — |
| `assets/style.css` | весь внешний вид | классы: `.app`, `.app__side`, `.app__main`, `.steps`, `.dropzone` (+`__hint`), `.file-list` (+ `__meta`, `__remove`), `.action-bar` (+`__info`, `__hint`), `.btn`, `.btn--secondary`, `.result__head`, `.stat`, `.data-table`, `.error-message`, `.warning-message` | — |
| `assets/fonts.css` | шрифты | `font-family: "Onest"`, `"JetBrains Mono"` | base64 |
| `<tool>/app.js` | состояние своей страницы | — (вызывает `Shell.*`, `countDataRows`) | — |

Контракт разметки страницы инструмента (то, что читает `shell.js`):
`<body class="app">`, пустой `<aside class="app__side" id="app-side"></aside>` первым
ребёнком `body`, `<main class="app__main">`, внутри — `<ol class="steps" id="steps">`
с тремя `<li>` (подписи из §4), `<div class="action-bar" id="action-bar">` c
`<p class="action-bar__info" id="action-info">`, `<span class="action-bar__hint"
id="action-hint">` и главной кнопкой инструмента (её `id` прежний). Главная страница —
тот же каркас без шагов и полосы. Скрипты: `tools.js`, затем `assets/shell.js`, затем
библиотеки и `app.js` страницы.

`Shell.setResultShown(true)` делает главной **первую** кнопку внутри `.result__head`
(остальные там — `.btn--secondary`) и переводит кнопку запуска в полосе в
`.btn--secondary`; `false` — обратно. Пурпурная кнопка на экране всегда одна.
Какую кнопку считать кнопкой запуска — главная кнопка в `#action-bar`.

Швы для тестов: `countDataRows` / `rowHasData` в `lib/manifest-format.test.js`
(Node, как все остальные тесты). Поведение страниц — ручная проверка в браузере
(дев-сервер `manifest-tools` из `.claude/launch.json`): в репозитории нет DOM-тестов, и
заводить их ради редизайна — новый шов, который потом нельзя сдвинуть.


## Что построили таски

(дописывается по мере сдачи тасков)

### Из таска 01 — каркас и образец (страница `merge/`)

- `window.Shell.plural(n, one, few, many) -> string` — **только слово, без числа**: `plural(3,'строка','строки','строк')` → `'строки'`.
- `window.Shell.setStep(1|2|3)`, `window.Shell.setAction({info, hint|null})`, `window.Shell.setResultShown(bool)`, `window.Shell.formatSize(bytes) -> '84 КБ' | '12,4 МБ'` (неразрывный пробел перед единицей).
- `lib/manifest-format.js`: `rowHasData(sheet, row)` (колонки A:Y, как склейка), `countDataRows(workbook) -> number|null`.
- Разметка: шаги — `<li>` с голым текстом (номер и ✓ дорисовывает shell). Крошки shell вставляет в начало `.app__main` сам. На главной блоки `data-tab-panel="export|import"` прячет/показывает shell.
- Классы сверх «Границ» (пользоваться ими, не заводить свои): `.result__stats`, `.result__actions` (внутри `.result__head`), `.stat__value`, `.stat__label`, `.page__title`, `.page__subtitle`, `.hint`, `.options`, `.switch` (+`__input`, `__track`), `.table-scroll`; в `.data-table` — `.num`, `.mono`, `tr.is-total`; в `.file-list` — `__name`, `__meta--error`; `.dropzone__text`, `.mono`, `.fmt`. Глобально `[hidden]{display:none!important}`.
- Порядок подключения: `<link>` на `assets/fonts.css` перед `assets/style.css`; скрипты `tools.js` → `assets/shell.js` → библиотеки → `app.js`. Текущий `?v=` у новых/изменённых общих файлов — `202609121900`.
- Поведение-образец: смена параметра (тумблер нумерации) тоже прячет готовый результат; вкладка, в которой открыт инструмент, записывается в localStorage.
- После дозапроса: `lib/manifest-format.js` выставляет ещё `ROW_FIRST_COLUMN = 1` (колонка A); `rowHasData` проверяет от неё до Y.
- Shell сам не даёт браузеру открыть файл, брошенный вне `.dropzone` — ничего для этого на странице делать не нужно.
- `.dashboard-block`, `.dashboard-row--*`, `.port-bar`, `.field-grid`, `.field` — **общие стили**, пользоваться ими (не «старые»); правила `.dashboard-block table/th/td` действуют только внутри `.page` и не перебивают `.data-table` на страницах `.app`.
- **На странице ровно один `.result__head`** — `setResultShown` делает пурпурной первую `.btn` в нём.
- Плитки `.stat`, строки `.file-list` (имя, число строк/размер, «✕»), перетаскивание в зону — строятся в `app.js` страницы: **копируй соответствующие фрагменты из `merge/app.js` дословно**, меняя только то, что отличается у инструмента (принятое в проекте дублирование DOM-слоя, как `dashboard-departure/app.js`).
- Текущий `?v=`: `assets/style.css`, `assets/shell.js` — `202609121930`; `assets/fonts.css`, `tools.js` — `202609121900`; `lib/manifest-format.js` — смотри строку импорта в `merge/core.js`.
- Цепочка `?v=` для `lib/manifest-format.js` в `dg-check/core.js`, `grand-total/core.js`, `order-check/core.js`, `bl-registry/core.js`, `bl-registry/app.js` ещё старая: таски 02/03 обновляют её у своих страниц — **правка строки импорта в `core.js` не считается изменением логики и разрешена**, всё остальное в `core.js` — нет.

### Из таска 03 — сверки и «Разделить коносаменты»

- Новых общих интерфейсов нет. Размер файла внутри .zip — из внутреннего поля JSZip `_data.uncompressedSize` (нет поля — размер не показывается).

### Из таска 02 — Итоговый отчёт, дашборды, реестр

- Новых общих интерфейсов нет. `?v=` страниц — 202609122000; импорт `lib/manifest-format.js` в grand-total/core.js, bl-registry/core.js и четырёх app.js — 202609121930; core.js дашбордов не менялись (202609111500).
