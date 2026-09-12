# Интерфейсы

Ярус T0 — один контекст, без волн. Здесь только границы из спецификации
и проектные правила, которые нельзя вывести из репозитория самостоятельно.

## Границы, решённые в спецификации

| Модуль | Владеет | Выставляет | Прячет |
|---|---|---|---|
| `bl-registry/core.js` | разбор составных номеров, нормализацию, дедупликацию пар, сортировку, сборку итоговой книги | `buildOrdersRegistry(workbooks) -> {ok:true, rows: Array<{order:string, bl:string}>, uniqueOrders:number, uniqueBillsOfLading:number} \| {ok:false, error:string}` | поиск колонок по ключевому слову, алгоритм разбора `"; "`-номеров, форму ключа дедупликации |

Шов для тестов — сама `buildOrdersRegistry`, вызванная напрямую с книгами
ExcelJS, собранными в тесте (тот же приём, что в `core.test.js` у всех
остальных инструментов сайта).

`bl-registry/core.js` использует `SHEET_NAME`, `COLUMN_HEADER_ROW`,
`DATA_START_ROW`, `FIRST_COLUMN`, `LAST_COLUMN`, `validateStructure`,
`readVoyageHeader` из `lib/manifest-format.js` — ничего в этом файле не
меняется.

## Проектные правила

- Стек: статический сайт, без сборки, ES-модули только там, где `app.js`/`core.js` явно `<script type="module">`; `index.html`/`tools.js` — обычные скрипты (см. `CLAUDE.md`).
- ExcelJS в браузере — CDN-тег `4.4.0` (как во всех остальных Excel-инструментах); в тестах — npm-пакет `exceljs` из `devDependencies`.
- Кэш GitHub Pages — 10 минут: у нового `bl-registry/index.html` (`<script src="app.js?v=...">`, `<link ... assets/style.css?v=...">`) и у `bl-registry/app.js` (`import ... from './core.js?v=...'`) — метка `?v=<YYYYMMDDHHMM>` на момент коммита; если правится `lib/manifest-format.js`, обновить `?v=` там же и во всех файлах, что его импортируют.
- Тесты: `npm test` (`node --test`), сравнить количество тестов до/после в отчёте.
- Не трогать: `lib/manifest-format.js`, `lib/port-breakdown.js` и любые существующие инструменты — эта сборка добавляет новую страницу, ничего не меняя в остальных.
- Отсутствующая зависимость — `BLOCKED`, не устанавливать новых пакетов (репозиторий и так использует только `exceljs` из dev-зависимостей и CDN-теги в браузере).

## Построено (единственный проход, ярус T0)

- `bl-registry/core.js` — `buildOrdersRegistry(workbooks) -> {ok:true, rows:[{order,bl}], uniqueOrders, uniqueBillsOfLading} | {ok:false, error}`, ровно как решено в спецификации.
- `bl-registry/app.js` — DOM-слой; рамка выходной книги (`applyTableBorder`) и подбор ширины колонок (`computeColumnWidths`) — краевая логика этой страницы, наружу не выставляется.
- `tools.js` — новая карточка, `category: 'export'`.
- Тесты: `bl-registry/core.test.js`, 13 тестов, `npm test` → 191 passed (было 178).
