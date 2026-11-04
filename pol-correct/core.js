// Ядро инструмента «Корректировка POL».
//
// В файле 1 (манифест, исходный файл линии, любой .xlsx с таблицей) в колонке POL
// значения заменяются на POL из файла 2 (выгрузка Stowage Edit от линии).
// Идентификация строки — по номеру контейнера; больше ничего не сравнивается.
//
// Колонки не фиксированы: в каждом файле ищется строка заголовков, где есть
// ячейка «POL» (точно, не «POL-Voyage») и ячейка номера контейнера («номер
// контейнера», «Cntr No», «Container No»…), — поэтому подходят оба файла
// пользователя, где таблицы начинаются с 2-й и с 14-й строки.
//
// Правила, которые важнее удобства (и проверены тестами):
//   - пустой POL во втором файле не затирает значение в первом;
//   - если у одного контейнера во втором файле разные POL, строка не трогается
//     (угадывать нельзя), контейнер попадает в предупреждения;
//   - контейнер, которого нет во втором файле, остаётся как был и попадает в сводку;
//   - строки без номера контейнера (итоги, пустые) пропускаются.
//
// ExcelJS сюда не импортируется: готовые книги приходят снаружи (в браузере —
// глобальный ExcelJS, в тестах — import('exceljs')), поэтому модуль тестируется
// в Node без браузера.

import { dropUnwritableConditionalFormatting } from '../lib/xlsx-safe-write.js?v=202611042245';

// Заменённые ячейки — жёлтым, как изменённые ячейки в «Сравнить версии».
const CHANGED_FILL = 'FFFFFF00';
// Строка заголовков — в первых 60 строках: в файле линии она 10-я/14-я, в
// выгрузке Stowage Edit — 2-я, а выше идут шапки рейса и памятки.
const HEADER_SEARCH_LIMIT = 60;
const LIST_LIMIT = 10;

// Заголовок POL — только точное совпадение после нормализации: иначе
// «POL-Voyage» рядом с POL тоже сошёл бы за колонку порта погрузки.
const POL_HEADERS = new Set(['pol', 'портпогрузки', 'portofloading']);
// Номер контейнера: «номер контейнера», «№ контейнера», «Cntr No», «Container No»…
// Заголовок «Тип контейнера» сюда не попадает — сравнение по целой строке.
const CONTAINER_HEADERS = new Set([
  'номерконтейнера', 'контейнера', 'номерконтейнер', 'контейнер',
  'containernumber', 'containerno', 'container', 'containers',
  'cntrno', 'cntrnumber', 'cntr',
]);

// Латинские двойники кириллицы: номер контейнера, набранный русскими буквами,
// всё равно должен найти свою строку (в исходных файлах такое бывает).
const HOMOGLYPHS = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P',
  Т: 'T', У: 'Y', Х: 'X', І: 'I', Ѕ: 'S', Ј: 'J', Ԛ: 'Q', Ԝ: 'W', Ү: 'Y',
};
const HOMOGLYPH_PATTERN = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'g');

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

/** Заголовок без регистра, «ё», пробелов и знаков: «№ контейнера» → «контейнера». */
export function normalizeHeader(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Ключ для сопоставления контейнеров: без пробелов, апострофов и регистра,
 * русские буквы-двойники — как латинские. Для записи в файл не используется.
 */
export function containerKey(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(HOMOGLYPH_PATTERN, (char) => HOMOGLYPHS[char] ?? char);
}

// Текст ячейки: строка, число, результат формулы, rich text, гиперссылка, дата.
function valueText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('').trim();
    }
    if (value.formula !== undefined || value.sharedFormula !== undefined) {
      return valueText(value.result);
    }
    if (value.error !== undefined) return String(value.error).trim();
    if (value.text !== undefined) return String(value.text).trim();
  }
  return String(value).trim();
}

function cellText(cell) {
  return cell ? valueText(cell.value) : '';
}

/**
 * Ищет на листе строку заголовков с колонками POL и номера контейнера.
 * @returns {{row: number, polColumn: number, containerColumn: number}|null}
 */
function findTable(sheet) {
  const lastSearchRow = Math.min(sheet.rowCount || 0, HEADER_SEARCH_LIMIT);
  const columnCount = sheet.columnCount || 0;
  for (let row = 1; row <= lastSearchRow; row++) {
    let polColumn = null;
    let containerColumn = null;
    for (let column = 1; column <= columnCount; column++) {
      const header = normalizeHeader(cellText(sheet.getCell(row, column)));
      if (!header) continue;
      if (polColumn === null && POL_HEADERS.has(header)) polColumn = column;
      else if (containerColumn === null && CONTAINER_HEADERS.has(header)) containerColumn = column;
    }
    if (polColumn !== null && containerColumn !== null) {
      return { row, polColumn, containerColumn };
    }
  }
  return null;
}

/**
 * Все листы книги, где нашлась таблица с POL и номером контейнера.
 * @returns {Array<{sheet: any, table: {row: number, polColumn: number, containerColumn: number}}>}
 */
function findTables(workbook) {
  const tables = [];
  for (const sheet of workbook.worksheets) {
    const table = findTable(sheet);
    if (table) tables.push({ sheet, table });
  }
  return tables;
}

/**
 * Строки таблицы с номером контейнера и текущим POL.
 * Строки без единой цифры в номере (итоги, «Всего», пустые) — не данные.
 * @returns {Array<{row: number, container: string, key: string, pol: string}>}
 */
function readTableRows(sheet, table) {
  const rows = [];
  for (let row = table.row + 1; row <= sheet.rowCount; row++) {
    const container = cellText(sheet.getCell(row, table.containerColumn));
    const key = containerKey(container);
    if (!key || !/\d/.test(key)) continue;
    rows.push({ row, container, key, pol: cellText(sheet.getCell(row, table.polColumn)) });
  }
  return rows;
}

function columnLetter(sheet, column) {
  return sheet.getColumn(column).letter;
}

function limitedList(items) {
  if (items.length <= LIST_LIMIT) return items.join(', ');
  return `${items.slice(0, LIST_LIMIT).join(', ')} и ещё ${items.length - LIST_LIMIT}`;
}

/**
 * Что инструмент видит в книге: листы, строку заголовков, колонки, число строк.
 * Нужно странице, чтобы показать разбор файла сразу после выбора.
 * @returns {{ok: true, sheets: Array<object>}|{ok: false, error: string}}
 */
export function inspectPolFile(workbook, fileName = '') {
  const where = fileName ? `В файле «${fileName}»` : 'В файле';
  if (!workbook) return { ok: false, error: `Файл «${fileName}» не прочитан.` };
  const tables = findTables(workbook);
  if (!tables.length) {
    return {
      ok: false,
      error: `${where} не нашлась таблица с колонками «POL» и «номер контейнера» («Cntr No»).`,
    };
  }
  return {
    ok: true,
    sheets: tables.map(({ sheet, table }) => {
      const rows = readTableRows(sheet, table);
      return {
        name: sheet.name,
        headerRow: table.row,
        polColumn: columnLetter(sheet, table.polColumn),
        containerColumn: columnLetter(sheet, table.containerColumn),
        rows: rows.length,
        containers: new Set(rows.map((row) => row.key)).size,
      };
    }),
  };
}

/**
 * Заменяет POL в целевой книге по номеру контейнера. Книга меняется на месте
 * (стили, объединения и ширины сохраняются), заменённые ячейки — жёлтые.
 *
 * @param {{fileName: string, workbook: any}} target — файл 1, где меняем POL
 * @param {{fileName: string, workbook: any}} source — файл 2, откуда берём POL
 * @returns {{ok: true, resultWorkbook: any, changes: Array<object>, summary: object, warnings: string[]}
 *   | {ok: false, error: string}}
 */
export function correctPol(target, source) {
  if (!target?.workbook) return { ok: false, error: 'Файл 1 не прочитан — загрузите его ещё раз.' };
  if (!source?.workbook) return { ok: false, error: 'Файл 2 не прочитан — загрузите его ещё раз.' };

  const sourceTables = findTables(source.workbook);
  if (!sourceTables.length) {
    return {
      ok: false,
      error: `В файле 2 «${source.fileName}» не нашлась таблица с колонками «POL» и «номер контейнера» («Cntr No»).`,
    };
  }
  const targetTables = findTables(target.workbook);
  if (!targetTables.length) {
    return {
      ok: false,
      error: `В файле 1 «${target.fileName}» не нашлась таблица с колонками «POL» и «номер контейнера» («Cntr No»).`,
    };
  }

  // Порт погрузки по контейнеру. Один контейнер может встретиться дважды
  // (несколько коносаментов) — одинаковый POL не мешает, разный — не угадываем.
  const sourcePol = new Map();
  const conflicts = new Set();
  const withoutPol = new Map();
  for (const { sheet, table } of sourceTables) {
    for (const row of readTableRows(sheet, table)) {
      if (!row.pol) {
        withoutPol.set(row.key, row.container);
        continue;
      }
      const known = sourcePol.get(row.key);
      if (!known) sourcePol.set(row.key, { pol: row.pol, container: row.container });
      else if (known.pol !== row.pol) conflicts.add(row.key);
    }
  }

  const changes = [];
  const notFound = [];
  const ambiguous = [];
  const sheets = [];
  const usedKeys = new Set();
  let dataRows = 0;
  let changed = 0;
  let unchanged = 0;

  for (const { sheet, table } of targetTables) {
    dropUnwritableConditionalFormatting(sheet);
    const rows = readTableRows(sheet, table);
    let sheetChanged = 0;
    for (const row of rows) {
      dataRows++;
      usedKeys.add(row.key);
      if (conflicts.has(row.key)) {
        ambiguous.push(row.container);
        continue;
      }
      const entry = sourcePol.get(row.key);
      if (!entry) {
        notFound.push({ row: row.row, container: row.container });
        continue;
      }
      if (entry.pol === row.pol) {
        unchanged++;
        continue;
      }
      const cell = sheet.getCell(row.row, table.polColumn);
      const style = cloneStyle(cell.style);
      style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CHANGED_FILL } };
      cell.style = style;
      cell.value = entry.pol;
      changed++;
      sheetChanged++;
      changes.push({
        sheet: sheet.name,
        row: row.row,
        cell: cell.address,
        container: row.container,
        before: row.pol,
        after: entry.pol,
      });
    }
    sheets.push({
      name: sheet.name,
      headerRow: table.row,
      polColumn: columnLetter(sheet, table.polColumn),
      containerColumn: columnLetter(sheet, table.containerColumn),
      dataRows: rows.length,
      changed: sheetChanged,
    });
  }

  // Контейнеры файла 2, которых нет в файле 1. Конфликтные ключи уже посчитаны
  // отдельно, иначе один контейнер попадал бы в две сводки.
  const unused = [];
  for (const [key, entry] of sourcePol) {
    if (!usedKeys.has(key)) unused.push(entry.container);
  }

  const warnings = [];
  if (notFound.length) {
    warnings.push(
      `В файле 2 не нашлось ${notFound.length} контейнеров из файла 1 — их POL не изменён: `
      + `${limitedList(notFound.map((item) => item.container))}.`,
    );
  }
  if (unused.length) {
    warnings.push(
      `В файле 2 есть ${unused.length} контейнеров, которых нет в файле 1, — их POL не использован: `
      + `${limitedList(unused)}.`,
    );
  }
  if (conflicts.size) {
    warnings.push(
      `У ${conflicts.size} контейнеров в файле 2 разные POL — строки не тронуты, разберитесь вручную: `
      + `${limitedList([...conflicts].map((key) => sourcePol.get(key)?.container ?? key))}.`,
    );
  }
  if (withoutPol.size) {
    warnings.push(
      `В файле 2 у ${withoutPol.size} строк пустой POL — прежние значения в файле 1 сохранены: `
      + `${limitedList([...withoutPol.values()])}.`,
    );
  }

  return {
    ok: true,
    resultWorkbook: target.workbook,
    changes,
    summary: {
      sheets,
      dataRows,
      changed,
      unchanged,
      notFound,
      unused,
      ambiguous,
      withoutPol: [...withoutPol.values()],
    },
    warnings,
  };
}
