// Логика подсчёта разбивки по портам назначения и типам контейнеров.
// Чистые функции от книг ExcelJS и примитивов — без DOM (см. interfaces.md /
// spec.md, границы и швы). Комбинированный/исходный файл всегда соответствует
// формату из lib/manifest-format.js — эти константы переиспользуются, а не
// дублируются.

import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
  validateStructure,
} from '../lib/manifest-format.js?v=202609061822';

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

// Ключевые слова ниже нарочно не включают слово «вес» целиком: в реальных
// файлах заголовки «Веc груза» / «Веc тары» / «Общий Веc» написаны с
// латинской "c" вместо кириллической (проверено побайтово на примере
// пользователя) — «вес» в них не встречается ни разу. «груза»/«тары»/«общий»
// не задеты опечаткой и однозначно указывают на нужную колонку.
const COLUMN_SPECS = [
  { key: 'port', keyword: 'назначения', label: '«Порт назначения»' },
  { key: 'type', keyword: 'футность', label: '«Футность»' },
  { key: 'cargoWeight', keyword: 'груза', label: '«Вес груза»' },
  { key: 'tareWeight', keyword: 'тары', label: '«Вес тары»' },
  { key: 'totalWeight', keyword: 'общий', label: '«Общий вес»' },
];

function findColumns(sheet) {
  const row = sheet.getRow(COLUMN_HEADER_ROW);
  const columns = {};
  const missing = [];
  for (const spec of COLUMN_SPECS) {
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

function emptyTotals() {
  return { count: 0, cargoWeight: 0, tareWeight: 0, totalWeight: 0 };
}

function addTotals(target, cargoWeight, tareWeight, totalWeight) {
  target.count += 1;
  target.cargoWeight += cargoWeight;
  target.tareWeight += tareWeight;
  target.totalWeight += totalWeight;
}

// Строит разбивку по портам назначения (и внутри каждого — по типам
// контейнеров) из уже извлечённых строк. Порты и типы сортируются по
// алфавиту — список не «прыгает» местами между одинаковыми по весу группами.
function buildBreakdown(rows) {
  const portMap = new Map();
  const grandTotal = emptyTotals();

  for (const row of rows) {
    if (!portMap.has(row.port)) {
      portMap.set(row.port, { totals: emptyTotals(), types: new Map() });
    }
    const portEntry = portMap.get(row.port);
    if (!portEntry.types.has(row.type)) {
      portEntry.types.set(row.type, emptyTotals());
    }
    const typeEntry = portEntry.types.get(row.type);

    addTotals(portEntry.totals, row.cargoWeight, row.tareWeight, row.totalWeight);
    addTotals(typeEntry, row.cargoWeight, row.tareWeight, row.totalWeight);
    addTotals(grandTotal, row.cargoWeight, row.tareWeight, row.totalWeight);
  }

  const ports = Array.from(portMap.entries())
    .sort(([a], [b]) => a.localeCompare(b, 'ru'))
    .map(([port, entry]) => ({
      port,
      totals: entry.totals,
      types: Array.from(entry.types.entries())
        .sort(([a], [b]) => a.localeCompare(b, 'ru'))
        .map(([type, totals]) => ({ type, ...totals })),
    }));

  return { ports, grandTotal };
}

function extractRows(workbook, fileName) {
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) {
    return { ok: false, error: `Не удалось прочитать файл «${fileName}»: нет листа "${SHEET_NAME}"` };
  }

  const found = findColumns(sheet);
  if (!found.ok) {
    return { ok: false, error: `Файл «${fileName}»: ${found.error}` };
  }

  const { port: portCol, type: typeCol, cargoWeight: cargoCol, tareWeight: tareCol, totalWeight: totalCol } =
    found.columns;

  const rows = [];
  const lastRow = sheet.rowCount;
  for (let r = DATA_START_ROW; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    const portText = cellText(row.getCell(portCol));
    const typeText = cellText(row.getCell(typeCol));
    const cargoWeight = cellNumber(row.getCell(cargoCol));
    const tareWeight = cellNumber(row.getCell(tareCol));
    const totalWeight = cellNumber(row.getCell(totalCol));

    // Строка, пустая целиком (не только порт/тип), пропускается — иначе
    // хвост пустых строк в конце листа превращается в фиктивную группу
    // "(не указан)" с нулевым весом.
    if (!portText && !typeText && !cargoWeight && !tareWeight && !totalWeight) continue;

    rows.push({
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
 * Строит дашборд по портам назначения: разбивку по каждому загруженному
 * файлу отдельно (`perFile`) и общую сводную разбивку по всем файлам вместе
 * (`combined`), посчитанную тем же проходом, а не суммированием уже готовых
 * `perFile` — так группировка и округления не могут разойтись в двух местах.
 *
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @returns {{ok: true, perFile: Array<{fileName: string, breakdown: object}>, combined: object}
 *          | {ok: false, error: string}}
 */
export function buildPortDashboard(workbooks) {
  if (!Array.isArray(workbooks) || workbooks.length === 0) {
    return { ok: false, error: 'Нужен хотя бы один файл манифеста' };
  }

  const validation = validateStructure(workbooks);
  if (!validation.ok) return validation;

  const perFile = [];
  const allRows = [];

  for (const { fileName, workbook } of workbooks) {
    const extracted = extractRows(workbook, fileName);
    if (!extracted.ok) return extracted;

    perFile.push({ fileName, breakdown: buildBreakdown(extracted.rows) });
    allRows.push(...extracted.rows);
  }

  return { ok: true, perFile, combined: buildBreakdown(allRows) };
}
