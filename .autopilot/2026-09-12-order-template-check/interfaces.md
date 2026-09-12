# Интерфейсы

Файл читает каждый исполнитель **до** того, как напишет строку кода. Верхняя часть — решено в спецификации и не пересматривается тасками; нижняя растёт по мере того, как таски сдаются.

## Правила проекта

- **Стек.** Статический сайт без сборки, ES-модули.
  - В браузере: ExcelJS **4.4.0** и JSZip **3.10.1** — CDN-тегами с cdnjs (как в `order-check/index.html`).
  - В тестах: npm-пакет `exceljs` из `devDependencies`, `node --test`.
  - Никаких новых зависимостей. Нужна библиотека, которой нет, — вернуть таск со статусом `BLOCKED`, а не ставить её.
- **Команды.**
  - `npm test` — весь набор, сейчас 197 тестов, все зелёные.
  - Дев-сервер — `manifest-tools` в `.claude/launch.json` (`python3 -m http.server 8000` из корня). Страницы инструментов открываются только по http.
- **Чистые модули.** `core.js` и модули `lib/` не импортируют ExcelJS и не трогают DOM: книги приходят снаружи готовыми `ExcelJS.Workbook`. Новую пустую книгу модулю даёт вызывающий (`options.createWorkbook`).
- **Версии `?v=<YYYYMMDDHHMM>`** — правило CLAUDE.md, «Подводные камни». Правка `core.js`/`app.js`/`lib/*.js`/`tools.js`/`assets/shell.js`/`assets/*.css` обновляет число везде, где на файл ссылаются, **со всем каскадом**: `lib` → `core.js` → `app.js` → `index.html`.
- **Жёлтая заливка** — только через клон стиля (`cloneStyle`, как в `order-check/core.js`): ExcelJS отдаёт один объект стиля многим ячейкам.
- **Файлы заказчика в репозиторий не попадают никогда** — ни в коммит, ни во временную папку внутри репозитория. `deploy.sh` делает `rsync --delete` всего корня, и неотслеживаемый файл уехал бы на сервер. Настоящие образцы лежат во временной папке сессии и доступны только на чтение:
  - пара 1: `/private/tmp/claude-501/-Users-nasekomus--------------------------------------/284088bc-146b-44ed-a093-1b0317a487d5/scratchpad/in/re1/` — `НОВЫЙ шаблон эл_поручения export.xlsx`, `7826145796-P26-00002.xlsx`;
  - пара 2: `/private/tmp/claude-501/-Users-nasekomus--------------------------------------/284088bc-146b-44ed-a093-1b0317a487d5/scratchpad/in/gmail7/` — `НОВЫЙ шаблон эл_поручения export 605.xlsx`, `7805474140-P26-00005.xlsx`.

  Скрипты проверки на них — тоже только во временной папке. В тестах репозитория — только синтетические книги, собранные программно по устройству из `reference.md`.
- **Не трогать.**
  - Поведение и публичные функции остальных инструментов.
  - Файл `order-check/core.test.js` — он страж того, что «Сверить с поручениями» не изменилась, и должен остаться зелёным без правок.
  - Правило «одна пурпурная кнопка» и контракт разметки страницы (CLAUDE.md).
  - Тексты сообщений «Сверить с поручениями».
- **Коммиты** — по-русски, как в истории репозитория: «Таск NN «Проверка шаблона»: …». Строка соавторства — из инструкции оркестратора.
- **Язык.** Интерфейс, тексты находок, отчёт и комментарии в коде — по-русски, как везде на сайте.

## Границы, решённые в спецификации

Копия раздела «Границы и швы» из `spec.md`. Если что-то здесь не сходится с кодом — это `BLOCKED` с объяснением, а не молчаливое отступление.

| Модуль | Владеет | Выставляет | Прячет |
|---|---|---|---|
| `lib/loading-order.js` | формат поручения на погрузку | `parseLoadingOrder(workbook) -> {ok:true, order} \| {ok:false, error}` и `PALLET_CARGO_NAMES` | поиск подписей и колонок, границы групп контейнеров, исключение поддонов, разбор мест и опасных грузов |
| `lib/xlsx-safe-write.js` | обход бага записи условного форматирования ExcelJS 4.4.0 | `dropUnwritableConditionalFormatting(worksheet)` | белый список типов правил |
| `template-check/template-form.js` | эталонная форма шаблона | `SHEET_NAME`, `HEADER_FIELDS`, `NOTE_CELL`, `NOTE_TEXT`, `COLUMN_HEADER_ROW`, `DATA_START_ROW`, `COLUMNS`, `normalizeHeader(text)` | — (описание формы, как `lib/manifest-format.js`) |
| `template-check/core.js` | проверка шаблона и три результата | `detectFileKind(workbook)`, `checkTemplate(templateWb, orderEntries, options)` | чтение шаблона в модель с адресами исходных ячеек, все правила §4–§5, эквивалентность ISO, заливку и примечания, сборку исправленного шаблона, текст отчёта |
| `template-check/app.js` | страница | — | распознавание при добавлении, зону, список, плитки, таблицу, скачивание |
| `order-check/core.js` | сверка сводного файла с поручениями | `crossCheckOrders` — **без изменений** | теперь берёт разбор поручения и обход бага CF из `lib/` |
| `assets/shell.js` | каркас «Лоции» | `setResultShown` — главной становится первая **видимая** `.btn` в `.result__head` | — |

```js
// lib/loading-order.js
order = {
  orderNumber: string, date: string /* как в файле, 'ДД.ММ.ГГГГ' */, client: string, inn: string,
  shipper: string, shipperEn: string, consignee: string, consigneeEn: string, notify: string,
  vessel: string, voyage: string, loadingPort: string, dischargePort: string,   // '' если нет
  containers: Array<{
    containerNumber: string,      // как в файле, после trim()
    row: number,                  // строка поручения, где начинается группа
    owner: string, isoCode: string, sealNumber: string,
    places: number, goodsCount: number, goodsNames: string[],
    cargoWeight: number,          // брутто товаров без поддонов
    palletWeight: number,
    tareWeight: number | null, totalWeight: number | null,
    dangerousGoods: Set<string>,  // 'класс|UN'
  }>,
}
// ошибки — без префикса файла: 'нет ни одного листа', 'не найден номер поручения',
// 'не найден заголовок «Номер контейнера»', 'не найдены обязательные колонки таблицы контейнеров'

// template-check/core.js
detectFileKind(workbook) ->
  | { kind: 'order', orderNumber: string, containers: number }
  | { kind: 'template', containers: number }
  | { kind: 'unknown' }

checkTemplate(templateWb, orderEntries /* Array<{fileName, workbook}> */, {
  createWorkbook,      // () => новый пустой ExcelJS.Workbook — модуль ExcelJS не импортирует
  templateFileName,    // для отчёта и имён файлов
  checkedAt,           // Date — для строки «Проверено:», тесты подставляют фиксированную
}) ->
  | { ok: false, error: string }
  | {
      ok: true,
      findings: Finding[],            // сначала форма, потом строки по порядку, потом «нет в шаблоне», предупреждения — последними
      summary: { containers, errors, autoFixable, needsCustomer, warnings },
      topWarnings: string[],          // spec §8 «вверху»
      markedWorkbook,                 // тот же templateWb, изменённый на месте
      correctedWorkbook,              // Workbook | null — null, если autoFixable === 0
      reportText: string,             // spec §7, '\r\n', без BOM
      fileNames: { marked, corrected, report },
    }

Finding = {
  level: 'error' | 'warning',
  fix: 'auto' | 'customer' | null,   // null у предупреждений
  section: 'form' | 'data',
  sheet: string,                     // имя листа в исходном файле
  cell: string | null,               // 'K10' — адрес в исходном файле; null — ячейки нет
  field: string,                     // заголовок колонки или подпись шапки, 'Лист' для листовых
  container: string | null,
  message: string,                   // «в шаблоне 29, по поручению 32 (11 товаров)»
}
```

**Швы для тестов — два**, оба публичные:
- `parseLoadingOrder` — модуль поручения; «Сверить с поручениями» проверяется своими неизменными тестами;
- `detectFileKind` + `checkTemplate` — всё остальное. Правила, заливка, примечания, исправленный шаблон и отчёт проверяются через результат `checkTemplate`. Исправленный шаблон проверяется повторным `checkTemplate` на нём же.

## Что построили сданные таски

### Из таска 02 — проверка шаблона: форма, сверка, три результата

- `template-check/template-form.js` — эталонная форма: `SHEET_NAME`, `HEADER_FIELDS[{key,label,row,kind}]`, `HEADER_LABEL_COLUMN='D'`, `HEADER_VALUE_COLUMN='E'`, `NOTE_CELL`, `NOTE_TEXT`, `COLUMN_HEADER_ROW`, `DATA_START_ROW`, `COLUMNS[{letter,key,header,kind,required,width,wrap}]`, `HEADER_ROW_HEIGHT`, `DATA_ROW_HEIGHT`, `TEXT_FORMAT`, `FONTS`, `normalizeHeader(text)`.
- `template-check/core.js` — `detectFileKind(workbook)`, `checkTemplate(templateWb, orderEntries, {createWorkbook, templateFileName, checkedAt})`, форма результата как в разделе «Границы, решённые в спецификации» выше, с одним уточнением: `Finding.correction: string | null` — готовый текст исправления (для отчёта и колонки «Как поступить»).
- `field` у находок без адреса ячейки: `'Лист'` (листовые), `'Строка'` (пустая строка / «итого»), `'Строка заголовков'`.
- Строка «итого» (spec §4.4) — строго «без номера контейнера, заполнены только K–O числами»; строка с любой другой меткой (в т. ч. «Итого»/«Всего»/«Total» вне K–O) идёт в «без контейнера, но с данными» (уточнить у заказчика), не удаляется.
- Сравнение подписи шапки/заголовка колонки на точность идёт после `trim()` — пробелы по краям сейчас не ловятся как «неточный заголовок» (известный некритичный зазор, см. `concerns` в `state.js`).
- Тесты: один файл — `node --test template-check/core.test.js` и `node --test template-check/template-form.test.js`; весь набор — 265 зелёных.
- Версии: `template-form.js?v=202609131200`; `lib/*` не менялся, остался на `?v=202609130013`.

### Из таска 03 — страница, первая запись в tools.js, правка каркаса

- `tools.js` — первая запись массива: `{title:'Проверить шаблон эл. поручения', navTitle:'Проверить шаблон', href:'template-check/index.html', category:'export', output:'xlsx'}`.
- `template-check/index.html`, `template-check/app.js` — по контракту «Лоции», DOM-слой скопирован с `order-check/app.js`; юнит-тестов нет (как у остальных `app.js` сайта), логика проверена в браузере на настоящих парах.
- `assets/shell.js`, `Shell.setResultShown(shown)` — главной становится первая **видимая** (без `hidden`) `.btn` в `.result__head`; на страницах без скрытых кнопок в результате (проверено на `grand-total/`, `merge/`) поведение не изменилось.
- Каскад `?v=` обновлён на всех десяти страницах (`tools.js`/`assets/shell.js` изменились).
- Три кнопки результата: «Скачать исправленный шаблон» (только если есть что исправить без заказчика) → «Скачать шаблон с пометками» → «Скачать отчёт (.txt)»; первая видимая — пурпурная.

Сборка тасков окончена — этот раздел больше не растёт в рамках прогона `2026-09-12-order-template-check`.

### Из таска 01 — общий разбор поручения

- `lib/loading-order.js`:
  - `parseLoadingOrder(workbook) -> {ok:true, order} | {ok:false, error}` — форма `order` ровно как выше: 13 полей шапки (`''`, если подписи нет) и `containers[]` из 13 полей;
  - `PALLET_CARGO_NAMES: Set<string>` — 6 слов, сравнение точное после `trim().toLowerCase()`;
  - своей копии этой логики больше нигде не заводить.
- Поведение (spec §2 и D01):
  - таблица **кончается** на «Дополнительные сведения» — разбор останавливается;
  - подписи шапки ищутся во всех строках выше строки заголовков таблицы;
  - эти два пункта — **изменение поведения «Сверить с поручениями» на нестандартных файлах** (D01): текст ниже «Дополнительные сведения» больше не создаёт ложный контейнер, номер поручения в строках 6–7 теперь находится; на правильных файлах результат прежний;
  - пустая строка (или строка из пробелов) внутри группы — не товар: не входит в `goodsCount`/`goodsNames`, на вес и опасные грузы не влияет;
  - «Нетто груза» не читается.
- `lib/xlsx-safe-write.js`: `dropUnwritableConditionalFormatting(worksheet) -> void` — меняет лист на месте, логика прежняя.
- `order-check/core.js` берёт оба модуля. Его `cellText`/`cellNumber` остались для чтения свода — это не общий API, не импортировать.
- Тесты: один файл — `node --test lib/loading-order.test.js`; весь набор — 208 зелёных.
- Версии: `order-check` сейчас на `?v=202609130013` (core → app → index.html).
