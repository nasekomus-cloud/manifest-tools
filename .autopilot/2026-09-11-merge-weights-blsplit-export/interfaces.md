# Границы — ярус T0, один контекст, одна волна

## Правила проекта (не выводятся из кода — читать перед началом)

- Стек: без сборки, обычные `<script>`/ES-модули. `merge/index.html`,
  `merge/app.js`, `merge/core.js` — модульная тройка (`app.js`/`core.js` —
  `type="module"`, требуют http, не `file://`). ExcelJS — CDN `4.4.0` в
  браузере, npm `exceljs` в тестах.
- Тесты: `npm test` (`node --test`) из корня репозитория. Новый код без
  теста, покрывающего его через существующий шов, не считается готовым.
- Отсутствующая зависимость — это `BLOCKED`, не повод её ставить/обновлять.
- Не трогать: `lib/port-breakdown.js` (переиспользуется как есть, без
  правок — `buildManifestTotals` уже делает всё нужное), формат манифеста в
  `lib/manifest-format.js`, весь код `bl-split/` (переиспользуется через
  вторую карточку в `tools.js`, не копируется).
- Версионирование `?v=<YYYYMMDDHHMM>` — см. «Подводные камни» в CLAUDE.md.
  Любая правка `merge/core.js`/`merge/app.js`/`tools.js` тянет за собой
  обновление числа во всех местах цепочки импортов и в `<script src=...>`
  соответствующих `index.html`, одним и тем же числом.

## Границы, решённые в спецификации

| Модуль | Владеет | Выставляет | Прячет |
|---|---|---|---|
| `lib/port-breakdown.js` | подсчётом веса по типу контейнера из книг манифеста | `buildManifestTotals(workbooks) -> {ok, byType, grandTotal, billsOfLading}` (уже существует, не меняется) | поиск весовых колонок по ключевым словам, фильтрацию строк без номера контейнера |
| `merge/core.js` | склейкой файлов и сводкой по результату | `mergeManifests(workbooks, {renumber}) -> {resultWorkbook, summary}`, где `summary.files[i].weight` и `summary.weightTotals` — новые поля (`{cargoWeight, tareWeight, totalWeight} \| null`) | то, что вес считается из исходных книг, а не из результата |
| `merge/app.js` | DOM-слоем страницы склейки | — (страница) | форматирование чисел (`formatWeight`), разметку пяти колонок таблицы |
| `tools.js` | списком карточек главной страницы | массив `window.TOOLS` | — |

## Что построено (после единственного прохода, ярус T0)

Ровно по плану, без отклонений:

- `merge/core.js`: новый импорт `buildManifestTotals` из `lib/port-breakdown.js`
  (без изменений в самом `lib/`); `mergeManifests(...).summary` получил
  `weightTotals: {cargoWeight, tareWeight, totalWeight} | null` и
  `files[i].weight` той же формы. Вес считается из исходных `workbooks`, не
  из `resultWorkbook` (см. Решения в spec.md).
- `merge/app.js`: своя копия `formatWeight` (как в `grand-total/app.js`),
  таблица «Результат» — 5 колонок, строки-довески («Уникальных
  контейнеров»/«Уникальных коносаментов») — с `colspan` на все колонки,
  кроме последней.
- `tools.js`: второй элемент с `href: 'bl-split/index.html'`,
  `category: 'export'` — код `bl-split/` не тронут.
- Тесты: `merge/core.test.js` — 2 новых теста (подсчёт веса по файлу/своду,
  СУММ-строка без контейнера не задваивает вес) + обновлённая точная сверка
  формы `summary` в первом тесте. `npm test`: 175 → 177, всё зелёное.

## Шов для тестов

`mergeManifests(workbooks, options) -> {resultWorkbook, summary}` —
существующий шов `merge/core.test.js`. Новые поля `summary.weightTotals` и
`summary.files[i].weight` проверяются через него же.
