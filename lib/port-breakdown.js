// Общая логика подсчёта разбивки манифеста по колонке-порту (отправления или
// назначения — параметризовано) и типам контейнеров. Вынесено сюда, а не
// продублировано в каждом инструменте с дашбордом, потому что вся эта логика
// уже один раз ловила реальный баг на реальном файле пользователя (итоговая
// СУММ-строка задваивала вес, «Кол-во» считало строки, а не контейнеры —
// см. .autopilot/2026-09-06-port-dashboard/spec.md, раздел D01): держать её
// в одном месте значит чинить один раз, а не дважды в местах, которые могут
// разойтись.

import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
  validateStructure,
} from './manifest-format.js?v=202609062100';

const UNSPECIFIED = '(не указан)';

function cellText(cell) {
  if (!cell) return '';
  try {
    const value = cell.text;
    if (value === undefined || value === null) return '';
    return String(value).trim();
  } catch {
    return '';
  }
}

function cellNumber(cell) {
  if (!cell) return 0;
  const value = cell.value;
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && typeof value.result === 'number') return value.result;
  return 0;
}

function findColumnByKeyword(row, colStart, colEnd, keyword) {
  const needle = keyword.toLowerCase();
  for (let col = colStart; col <= colEnd; col++) {
    if (cellText(row.getCell(col)).toLowerCase().includes(needle)) return col;
  }
  return null;
}

// Ключевые слова веса нарочно не включают слово «вес» целиком: в реальных
// файлах заголовки «Веc груза» / «Веc тары» / «Общий Веc» написаны с
// латинской "c" вместо кириллической (проверено побайтово на примере
// пользователя) — «вес» в них не встречается ни разу. «груза»/«тары»/«общий»
// не задеты опечаткой и однозначно указывают на нужную колонку.
//
// Колонка «№ контейнера» нужна не для отображения, а как признак «это
// настоящая строка с контейнером»: в реальных файлах после последней строки
// данных встречается строка с формулами СУММ() по весу (без номера
// контейнера, без порта, без типа) — лист в Excel заканчивается видимым
// «Итого». Без проверки на номер контейнера такая строка проходит фильтр
// «есть хоть один вес» и удваивает итоговый вес всего файла.
//
// portKeyword/portLabel — что именно ищем в шапке: «назначения»/«Порт
// назначения» либо «отправления»/«Порт отправления». Ключевые слова не
// пересекаются («Порт отправления» и «Порт назначения» — разные колонки),
// поэтому один и тот же поиск по ключевому слову безопасен в обе стороны.
function buildColumnSpecs(portKeyword, portLabel) {
  return [
    { key: 'container', keyword: 'контейнера', label: '«№ контейнера»' },
    { key: 'port', keyword: portKeyword, label: portLabel },
    { key: 'type', keyword: 'футность', label: '«Футность»' },
    { key: 'cargoWeight', keyword: 'груза', label: '«Вес груза»' },
    { key: 'tareWeight', keyword: 'тары', label: '«Вес тары»' },
    { key: 'totalWeight', keyword: 'общий', label: '«Общий вес»' },
  ];
}

function findColumns(sheet, specs) {
  const row = sheet.getRow(COLUMN_HEADER_ROW);
  const columns = {};
  const missing = [];
  for (const spec of specs) {
    const col = findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, spec.keyword);
    if (col) columns[spec.key] = col;
    else missing.push(spec.label);
  }
  if (missing.length) {
    return { ok: false, error: `не найден заголовок ${missing.join(', ')}` };
  }
  return { ok: true, columns };
}

// Один и тот же порт в реальных файлах встречается то с пробелом перед
// скобкой с кодом порта, то без него («…Port (RUPLP)» и «…Port(RUPLP)») —
// это не «лишний» пробел, который можно просто схлопнуть (схлопывание не
// уравняет "один пробел" и "ноль пробелов"), а сам пробел то есть, то нет.
// Поэтому пробел перед "(" убирается отдельно, до общего схлопывания —
// регистр и содержимое при этом не трогаются, порт остаётся читаемым.
function normalizePort(text) {
  const trimmed = text.replace(/\s+\(/g, '(').replace(/\s+/g, ' ').trim();
  return trimmed || UNSPECIFIED;
}

function normalizeType(text) {
  const trimmed = text.trim().toUpperCase();
  return trimmed || UNSPECIFIED;
}

function normalizeContainer(text) {
  return text.trim().toUpperCase();
}

function emptyGroup() {
  return { containers: new Set(), cargoWeight: 0, tareWeight: 0, totalWeight: 0 };
}

// «Кол-во» — число РАЗНЫХ контейнеров, а не число строк: один физический
// контейнер с несколькими видами груза в реальных манифестах занимает
// несколько строк с одним и тем же номером контейнера (проверено на реальном
// файле пользователя — три строки на один контейнер с разным весом каждая).
// Вес при этом складывается по каждой строке — это разные части одного и
// того же груза, а не дублирование.
function addToGroup(group, container, cargoWeight, tareWeight, totalWeight) {
  group.containers.add(container);
  group.cargoWeight += cargoWeight;
  group.tareWeight += tareWeight;
  group.totalWeight += totalWeight;
}

function finalizeGroup(group) {
  return {
    count: group.containers.size,
    cargoWeight: group.cargoWeight,
    tareWeight: group.tareWeight,
    totalWeight: group.totalWeight,
  };
}

// Строит разбивку по порту (и внутри каждого — по типам контейнеров) из уже
// извлечённых строк. Порты и типы сортируются по алфавиту — список не
// «прыгает» местами между одинаковыми по весу группами.
function buildBreakdown(rows) {
  const portMap = new Map();
  const grandGroup = emptyGroup();

  for (const row of rows) {
    if (!portMap.has(row.port)) {
      portMap.set(row.port, { group: emptyGroup(), types: new Map() });
    }
    const portEntry = portMap.get(row.port);
    if (!portEntry.types.has(row.type)) {
      portEntry.types.set(row.type, emptyGroup());
    }
    const typeGroup = portEntry.types.get(row.type);

    addToGroup(portEntry.group, row.container, row.cargoWeight, row.tareWeight, row.totalWeight);
    addToGroup(typeGroup, row.container, row.cargoWeight, row.tareWeight, row.totalWeight);
    addToGroup(grandGroup, row.container, row.cargoWeight, row.tareWeight, row.totalWeight);
  }

  const ports = Array.from(portMap.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([port, entry]) => ({
      port,
      totals: finalizeGroup(entry.group),
      types: Array.from(entry.types.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'ru'))
        .map(([type, group]) => ({ type, ...finalizeGroup(group) })),
    }));

  return { ports, grandTotal: finalizeGroup(grandGroup) };
}

function extractRows(workbook, fileName, specs) {
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    return { ok: false, error: `Не удалось прочитать файл «${fileName}»: нет листа "${SHEET_NAME}"` };
  }

  const found = findColumns(sheet, specs);
  if (!found.ok) {
    return { ok: false, error: `Файл «${fileName}»: ${found.error}` };
  }

  const {
    container: containerCol,
    port: portCol,
    type: typeCol,
    cargoWeight: cargoCol,
    tareWeight: tareCol,
    totalWeight: totalCol,
  } = found.columns;

  const rows = [];
  const lastRow = sheet.rowCount;
  for (let r = DATA_START_ROW; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const containerText = cellText(row.getCell(containerCol));

    // Строка без номера контейнера — не строка с грузом: это либо пустая
    // строка-разделитель, либо (встречается в реальных файлах) итоговая
    // строка с формулами СУММ() по весу внизу листа. У обеих нет номера
    // контейнера, а вес может быть — включать такую строку в подсчёт
    // означало бы посчитать общий итог файла ещё раз как «ещё один вес».
    if (!containerText) continue;

    const portText = cellText(row.getCell(portCol));
    const typeText = cellText(row.getCell(typeCol));
    const cargoWeight = cellNumber(row.getCell(cargoCol));
    const tareWeight = cellNumber(row.getCell(tareCol));
    const totalWeight = cellNumber(row.getCell(totalCol));

    rows.push({
      container: normalizeContainer(containerText),
      port: normalizePort(portText),
      type: normalizeType(typeText),
      cargoWeight,
      tareWeight,
      totalWeight,
    });
  }

  return { ok: true, rows };
}

/**
 * Строит дашборд по колонке-порту: разбивку по каждому загруженному файлу
 * отдельно (`perFile`) и общую сводную разбивку по всем файлам вместе
 * (`combined`), посчитанную тем же проходом, а не суммированием уже готовых
 * `perFile` — так группировка и округления не могут разойтись в двух местах.
 *
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @param {{portKeyword: string, portLabel: string}} portColumn — какую колонку
 *        порта искать («назначения»/«Порт назначения» или «отправления»/«Порт отправления»)
 * @returns {{ok: true, perFile: Array<{fileName: string, breakdown: object}>, combined: object}
 *          | {ok: false, error: string}}
 */
// Специфика для buildManifestTotals: группировка только по типу контейнера
// (без колонки порта вовсе) плюс подсчёт уникальных коносаментов — тем же
// проходом по строкам, тем же приёмом findColumnByKeyword, что уже принят в
// dg-check/core.js и merge/core.js («коносамент» — не пересекается ни с одним
// другим ключевым словом на этом листе).
const TOTALS_SPECS = [
  { key: 'container', keyword: 'контейнера', label: '«№ контейнера»' },
  { key: 'type', keyword: 'футность', label: '«Футность»' },
  { key: 'cargoWeight', keyword: 'груза', label: '«Вес груза»' },
  { key: 'tareWeight', keyword: 'тары', label: '«Вес тары»' },
  { key: 'totalWeight', keyword: 'общий', label: '«Общий вес»' },
];

// Порожний контейнер (вес груза 0) — отдельная строка от гружёного того же
// типа, а не одна группа с усреднённым по смыслу весом: в реальных данных
// «40HC» гружёный и «40HC» порожний — разные по сути партии (проверено на
// примере пользователя, где часть контейнеров одного типа идёт с грузом,
// часть — порожняком обратным рейсом). Признак — тот же, что уже проверен на
// реальных данных для «Груз»/«Груз (перевод)» (см. .autopilot-заметки к
// grand-total): вес груза 0 всегда и только у строк с меткой «Empty»/
// «Порожний», так что достаточно смотреть на cargoWeight, не заводя
// отдельного поиска колонки «Груз».
//
// Порядок типов — по первому появлению в данных, не по алфавиту: единственная
// таблица сводного PDF-отчёта не должна «прыгать» местами между перезапусками
// одного и того же файла, но и не обязана подражать сортировке дашбордов —
// там сортировка нужна из-за множества портов, здесь типов всегда мало.
function buildTypeBreakdown(rows) {
  const typeMap = new Map();
  const grandGroup = emptyGroup();

  for (const row of rows) {
    const isEmpty = row.cargoWeight === 0;
    const key = `${row.type} ${isEmpty ? '1' : '0'}`;
    if (!typeMap.has(key)) {
      typeMap.set(key, { type: row.type, isEmpty, group: emptyGroup() });
    }
    addToGroup(typeMap.get(key).group, row.container, row.cargoWeight, row.tareWeight, row.totalWeight);
    addToGroup(grandGroup, row.container, row.cargoWeight, row.tareWeight, row.totalWeight);
  }

  const byType = Array.from(typeMap.values()).map(({ type, isEmpty, group }) => ({
    type,
    isEmpty,
    ...finalizeGroup(group),
  }));
  return { byType, grandTotal: finalizeGroup(grandGroup) };
}

function extractTotalsRows(workbook, fileName) {
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    return { ok: false, error: `Не удалось прочитать файл «${fileName}»: нет листа "${SHEET_NAME}"` };
  }

  const found = findColumns(sheet, TOTALS_SPECS);
  if (!found.ok) {
    return { ok: false, error: `Файл «${fileName}»: ${found.error}` };
  }

  const headerRow = sheet.getRow(COLUMN_HEADER_ROW);
  const billCol = findColumnByKeyword(headerRow, FIRST_COLUMN, LAST_COLUMN, 'коносамент');

  const { container: containerCol, type: typeCol, cargoWeight: cargoCol, tareWeight: tareCol, totalWeight: totalCol } =
    found.columns;

  const rows = [];
  const billsOfLading = new Set();
  const lastRow = sheet.rowCount;
  for (let r = DATA_START_ROW; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const containerText = cellText(row.getCell(containerCol));
    if (!containerText) continue; // см. buildBreakdown выше — строка-«Итого» без номера контейнера

    rows.push({
      container: normalizeContainer(containerText),
      type: normalizeType(cellText(row.getCell(typeCol))),
      cargoWeight: cellNumber(row.getCell(cargoCol)),
      tareWeight: cellNumber(row.getCell(tareCol)),
      totalWeight: cellNumber(row.getCell(totalCol)),
    });

    if (billCol) {
      const billText = cellText(row.getCell(billCol));
      if (billText) billsOfLading.add(billText.trim().toUpperCase());
    }
  }

  return { ok: true, rows, billsOfLading: billCol ? billsOfLading : null };
}

/**
 * Строит сводный итог по всем загруженным файлам сразу («один общий рейс»,
 * без разбивки по файлам, в отличие от buildPortBreakdownDashboard) — для
 * инструмента «Итоговый PDF-отчёт»: группировка только по типу контейнера,
 * без порта вовсе, плюс число уникальных коносаментов (`billsOfLading`,
 * `null`, если колонка не нашлась — тот же смысл, что и в merge/core.js).
 *
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @returns {{ok: true, byType: Array<{type: string, isEmpty: boolean, count: number, cargoWeight: number, tareWeight: number, totalWeight: number}>,
 *            grandTotal: {count: number, cargoWeight: number, tareWeight: number, totalWeight: number},
 *            billsOfLading: number|null}
 *          | {ok: false, error: string}}
 */
export function buildManifestTotals(workbooks) {
  if (!Array.isArray(workbooks) || workbooks.length === 0) {
    return { ok: false, error: 'Нужен хотя бы один файл манифеста' };
  }

  const validation = validateStructure(workbooks);
  if (!validation.ok) return validation;

  const allRows = [];
  let billCounts = null; // null, пока не встретили файл с найденной колонкой коносамента
  const allBills = new Set();

  for (const { fileName, workbook } of workbooks) {
    const extracted = extractTotalsRows(workbook, fileName);
    if (!extracted.ok) return extracted;

    allRows.push(...extracted.rows);
    if (extracted.billsOfLading) {
      billCounts = allBills;
      for (const bill of extracted.billsOfLading) allBills.add(bill);
    }
  }

  // Файл может пройти все проверки колонок и всё же не содержать ни одной
  // строки данных — только пустые строки-разделители и/или СУММ()-строка
  // внизу листа (обе без номера контейнера). Без этой проверки отчёт молча
  // показал бы нулевой итог, как будто в манифесте нет груза вовсе.
  if (allRows.length === 0) {
    return { ok: false, error: 'Не найдено ни одной строки с контейнером' };
  }

  const { byType, grandTotal } = buildTypeBreakdown(allRows);
  return { ok: true, byType, grandTotal, billsOfLading: billCounts ? billCounts.size : null };
}

export function buildPortBreakdownDashboard(workbooks, { portKeyword, portLabel }) {
  if (!Array.isArray(workbooks) || workbooks.length === 0) {
    return { ok: false, error: 'Нужен хотя бы один файл манифеста' };
  }

  const validation = validateStructure(workbooks);
  if (!validation.ok) return validation;

  const specs = buildColumnSpecs(portKeyword, portLabel);
  const perFile = [];
  const allRows = [];

  for (const { fileName, workbook } of workbooks) {
    const extracted = extractRows(workbook, fileName, specs);
    if (!extracted.ok) return extracted;

    perFile.push({ fileName, breakdown: buildBreakdown(extracted.rows) });
    allRows.push(...extracted.rows);
  }

  return { ok: true, perFile, combined: buildBreakdown(allRows) };
}
