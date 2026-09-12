// Логика сводного реестра поручений и коносаментов. Чистая функция от книг
// ExcelJS и примитивов — без DOM и без собственного импорта библиотеки
// ExcelJS (книги приходят уже созданными вызывающим кодом: в браузере через
// глобальный ExcelJS, в тестах — через import('exceljs')), как и остальные
// core.js на сайте.
//
// Прячет: поиск колонок по ключевому слову, алгоритм разбора составных
// номеров поручения, форму ключа дедупликации.
// Выставляет: buildOrdersRegistry(workbooks) -> {ok, rows, uniqueOrders, uniqueBillsOfLading}.

import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
  validateStructure,
} from '../lib/manifest-format.js?v=202609121930';

function cellText(cell) {
  if (!cell) return '';
  // Объединённая ячейка с пустым мастером бросает исключение при чтении .text
  // (см. dg-check/core.js) — здесь оно означало бы «пусто», а не падение инструмента.
  try {
    const value = cell.text;
    if (value === undefined || value === null) return '';
    return String(value).trim();
  } catch {
    return '';
  }
}

// Позиция колонок "№ контейнера"/"№ коносамента"/"№ поручения" не
// зафиксирована (как и везде на сайте) — ищем по тексту заголовка. Раз
// validateStructure уже подтвердила одинаковую шапку C5:Y5 у всех загруженных
// файлов, найденный по шапке первого файла индекс верен для всех остальных
// без повторного поиска (тот же приём, что в merge/core.js).
function findColumnByKeyword(row, colStart, colEnd, keyword) {
  const needle = keyword.toLowerCase();
  for (let col = colStart; col <= colEnd; col++) {
    if (cellText(row.getCell(col)).toLowerCase().includes(needle)) return col;
  }
  return null;
}

function findColumns(sheet) {
  const row = sheet.getRow(COLUMN_HEADER_ROW);
  const columns = {
    container: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'контейнера'),
    bl: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'коносамента'),
    order: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'поручения'),
  };
  const labels = {
    container: '«№ контейнера»',
    bl: '«№ коносамента»',
    order: '«№ поручения»',
  };
  const missing = Object.keys(columns).filter((key) => !columns[key]).map((key) => labels[key]);
  if (missing.length) {
    return { ok: false, error: `не найден заголовок ${missing.join(', ')}` };
  }
  return { ok: true, columns };
}

// Убирает ВСЕ пробельные символы, а не схлопывает их в один пробел — в
// реальных данных перенос строки внутри номера поручения ("...00447\n/1")
// в желаемом результате пропадает без следа, а не заменяется пробелом
// (см. reference.md; проверено побайтово на приложенном пользователем файле).
function stripWhitespace(text) {
  return text.replace(/\s+/g, '');
}

// Ячейка "№ поручения" иногда несёт несколько номеров через "; " — похоже на
// групповую отправку от одного экспедитора несколькими поручениями на один
// коносамент. Короткий фрагмент после первого — не самостоятельный номер, а
// обрезанный хвост: недостающий префикс достраивается из первого номера пары
// подстановкой по длине. Проверено вычислительно на обоих реальных случаях
// из приложенного файла (см. reference.md) — совпадает символ в символ.
function splitOrderNumbers(rawText) {
  const parts = rawText.split(';').map(stripWhitespace);
  if (parts.length <= 1) return [parts[0] || ''];

  const base = parts[0];
  return parts.map((part, i) => {
    if (i === 0) return part;
    if (part.length > 0 && part.length < base.length) {
      return base.slice(0, base.length - part.length) + part;
    }
    return part;
  });
}

/**
 * Строит сводный реестр уникальных пар «номер поручения — номер коносамента»
 * из одного или нескольких файлов манифеста.
 *
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @returns {{ok: true, rows: Array<{order: string, bl: string}>,
 *            uniqueOrders: number, uniqueBillsOfLading: number}
 *          | {ok: false, error: string}}
 */
export function buildOrdersRegistry(workbooks) {
  if (!Array.isArray(workbooks) || workbooks.length === 0) {
    return { ok: false, error: 'Не выбрано ни одного файла манифеста' };
  }

  const structureCheck = validateStructure(workbooks);
  if (!structureCheck.ok) return structureCheck;

  let columns = null;
  const pairs = new Map(); // key -> {order, bl}
  let anyDataRow = false;

  for (const { fileName, workbook } of workbooks) {
    const sheet = workbook.getWorksheet(SHEET_NAME);
    if (!sheet) return { ok: false, error: `Файл «${fileName}»: не найден лист "${SHEET_NAME}"` };

    if (!columns) {
      const found = findColumns(sheet);
      if (!found.ok) return { ok: false, error: `Файл «${fileName}»: ${found.error}` };
      columns = found.columns;
    }

    for (let r = DATA_START_ROW; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const container = cellText(row.getCell(columns.container));
      if (!container) continue; // не данные — строка-довесок с формулами и т.п.
      anyDataRow = true;

      const bl = stripWhitespace(cellText(row.getCell(columns.bl)));
      const rawOrder = cellText(row.getCell(columns.order));

      for (const order of splitOrderNumbers(rawOrder)) {
        if (!order && !bl) continue; // пара без единого значения — не несёт информации
        const key = `${order} ${bl}`;
        if (!pairs.has(key)) pairs.set(key, { order, bl });
      }
    }
  }

  if (!anyDataRow) {
    return { ok: false, error: 'Не найдено ни одной строки с контейнером' };
  }

  // Порядок строк эталона восстановить нельзя (исходного документа, из
  // которого он взят, нет — см. reference.md); сортировка по номеру
  // коносамента, обычным строковым сравнением — предсказуемо и стабильно
  // от запуска к запуску, без сюрпризов кириллицы/латиницы, которые дал бы
  // localeCompare в разных браузерах.
  const rows = [...pairs.values()].sort((a, b) => (a.bl < b.bl ? -1 : a.bl > b.bl ? 1 : 0));

  return {
    ok: true,
    rows,
    uniqueOrders: new Set(rows.map((r) => r.order)).size,
    uniqueBillsOfLading: new Set(rows.map((r) => r.bl)).size,
  };
}
