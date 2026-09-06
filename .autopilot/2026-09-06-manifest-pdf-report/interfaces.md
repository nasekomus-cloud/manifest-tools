# Границы — от спецификации к коду

Ярус **T0** — один инструмент, без внешних сервисов, собирается в один проход,
без разбивки на таски. Этот файл существует и на T0: следующая сессия (и Phase 9)
читает именно его, а не восстанавливает границы заново.

## Проектные правила

- Стек — тот же, что и везде на сайте: ES-модули без сборки, ExcelJS с CDN (`4.4.0`) в браузере / из `devDependencies` в тестах, `pdf-lib` с CDN (`1.17.1`, та же версия, что уже используется в `bl-split/index.html`) — новую версию не заводить.
- Тесты — `node --test` (команда `npm test`), `core.js`/`lib/*.js` не импортируют ни ExcelJS, ни pdf-lib сами — принимают готовые объекты снаружи.
- Кэш GitHub Pages — 10 минут на `.js`: при каждой правке `core.js`/`app.js`/`lib/manifest-format.js`/`lib/port-breakdown.js`/`tools.js` обновить `?v=<YYYYMMDDHHMM>` во всех местах, где встречается ссылка на файл (см. CLAUDE.md, раздел «Подводные камни», последний пункт).
- Отсутствующая зависимость — это `BLOCKED`, а не повод её ставить/апгрейдить самому.
- Не трогать: `merge/`, `dg-check/`, `dashboard/`, `dashboard-departure/`, `bl-split/` — существующие инструменты и их тесты. Расширения `lib/manifest-format.js` и `lib/port-breakdown.js` обязаны не менять поведение уже экспортированных оттуда функций (проверяется существующими `manifest-format.test.js` и `port-breakdown.test.js` — они должны остаться зелёными).

## Границы, решённые в спецификации

| Модуль | Владеет | Выставляет | Прячет |
|---|---|---|---|
| `lib/manifest-format.js` | формат шапки манифеста (строки 3–5) | + `readVoyageHeader(workbook) -> {vessel, voyage}` (оба — `string \| null`) | поиск по ключевому слову внутри строки шапки |
| `lib/port-breakdown.js` | подсчёт весов и дедупликацию контейнеров | + `buildManifestTotals(workbooks) -> {ok, byType, grandTotal, billsOfLading} \| {ok:false, error}` | группировку по типу, поиск колонки коносамента, все уже существующие приватные помощники |
| `grand-total/core.js` | сборку модели данных отчёта из книг | `buildGrandTotalData(workbooks) -> {ok, vessel, voyage, byType, grandTotal, billsOfLading} \| {ok:false, error}` | вызов `buildManifestTotals`/`readVoyageHeader` |
| `grand-total/app.js` | DOM, три поля ручного ввода, сборку и скачивание PDF и Excel | — (конечная точка) | вёрстку PDF через `pdf-lib`, сборку книги через `ExcelJS`, форматирование чисел и типов |

Формы возвращаемых значений — см. «Решения по реализации» в `spec.md`, раздел
целиком скопирован оттуда дословно.

## Швы для тестов

- `buildGrandTotalData` (`grand-total/core.test.js`) — основной шов этого инструмента.
- `buildManifestTotals` (`lib/port-breakdown.test.js`, дополняется) — группировка по типу, `billsOfLading`.
- `readVoyageHeader` (`lib/manifest-format.test.js`, дополняется) — разбор шапки.

## Построено (T0, один проход)

- `lib/manifest-format.js` — `readVoyageHeader(workbook)`, `lib/port-breakdown.js` — `buildManifestTotals(workbooks)`, `grand-total/core.js` — `buildGrandTotalData(workbooks)`. Формы — как в спецификации, без изменений.
- `grand-total/app.js` — дропзона/поля/сборка PDF. **D01**: шрифт для PDF — не `PDFLib.StandardFonts`, а статический `.ttf` Roboto с `fonts.gstatic.com/s/roboto/v51/...` (постоянный версионированный URL, не динамический `/l/font?kit=...`), встроенный через `@pdf-lib/fontkit` (CDN `cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1`) с `embedFont(bytes, { subset: true })`. Подробности и отвергнутые варианты — манифест, строка D01, и `spec.md`.
- `assets/style.css` — добавлен раздел «Инструмент «Итоговый PDF-отчёт по манифесту»» (`.field-grid`, `.field`, стили `#results-box`), существующие классы не тронуты.
- `tools.js` — новая карточка, `index.html` — версия `tools.js?v=` обновлена.
- Кэш-бастинг: все места, импортирующие/подключающие `lib/manifest-format.js`, `lib/port-breakdown.js`, `tools.js`, обновлены на версию `202609062100` (список — в CLAUDE.md, актуализировать вместе).
- **Дополнение по ходу (G02/G03):** линии таблицы в PDF — только под шапкой колонок и вокруг `TOTAL:` (одна перед, одна под), не под каждой строкой данных; ширины колонок PDF и Excel — по самому широкому содержимому (`computeColumnWidths`/`computeExcelColumnWidths`), не константами. Вторая кнопка «Скачать Excel» — `buildExcelWorkbook` в `grand-total/app.js`, лист «Grand Total», тот же состав строк, что в PDF. **D02**: веса в Excel — числа с `numFmt` (`#,##0.000" KGS"`), не готовый текст из `buildTableRows` (тот только для PDF/предпросмотра) — для этого заведена отдельная `buildExcelRows`, дающая сырые числа.

## Что уже есть и не переизобретаем

- Дедупликация контейнеров, пропуск строк без номера контейнера, суммирование
  веса по строкам — уже в `lib/port-breakdown.js`, только вызвать.
- Поиск колонки по ключевому слову — `findColumnByKeyword`, уже в `lib/port-breakdown.js`
  (используется и в `dg-check/core.js`, и в `merge/core.js` — не третья копия).
- Подсчёт уникальных коносаментов — тот же приём, что `uniqueBillsOfLading` в
  `merge/core.js` (ключевое слово «коносамент», `null`, если колонка не нашлась).
- Дропзона / список файлов / сообщение об ошибке — классы `.dropzone`, `.btn`,
  `.file-list`, `.error-message` из `assets/style.css`.
