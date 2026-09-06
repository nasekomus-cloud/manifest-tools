// Логика склейки нескольких манифестов в один. Чистая функция от книг ExcelJS
// и примитивов — без DOM, без сети и без собственного импорта библиотеки
// ExcelJS (книги приходят уже созданными вызывающим кодом: в браузере через
// глобальный ExcelJS, в тестах — через import('exceljs')).
//
// Прячет: построчное копирование стилей, пересчёт нумерации.
// Выставляет: mergeManifests(workbooks, {renumber}) -> {resultWorkbook, summary}.

import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
  validateStructure,
} from '../lib/manifest-format.js?v=202609061336';

const FIRST_COPY_COLUMN = 1; // A — включает колонку "№п/п", не участвующую в проверке структуры
const NUMBER_COLUMN = 1; // A — колонка "№п/п" (История 8 спецификации)

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

// Позиция колонок "№ контейнера"/"№ коносамента" в формате манифеста не
// зафиксирована (как и в dg-check/core.js) — ищем по тексту заголовка.
// Раз validateStructure уже подтвердила одинаковую шапку C5:Y5 у всех
// склеиваемых файлов, найденный по шапке первого файла индекс верен для
// всех остальных без повторного поиска.
function findColumnByKeyword(row, colStart, colEnd, keyword) {
  const needle = keyword.toLowerCase();
  for (let col = colStart; col <= colEnd; col++) {
    if (cellText(row.getCell(col)).toLowerCase().includes(needle)) return col;
  }
  return null;
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : style;
}

function copyRow(sourceSheet, targetSheet, sourceRowNumber, targetRowNumber) {
  const sourceRow = sourceSheet.getRow(sourceRowNumber);
  const targetRow = targetSheet.getRow(targetRowNumber);

  for (let col = FIRST_COPY_COLUMN; col <= LAST_COLUMN; col++) {
    const sourceCell = sourceRow.getCell(col);
    const targetCell = targetRow.getCell(col);
    targetCell.value = sourceCell.value;
    targetCell.style = cloneStyle(sourceCell.style);
  }

  if (sourceRow.height) {
    targetRow.height = sourceRow.height;
  }
}

function rowHasData(sheet, rowNumber) {
  const row = sheet.getRow(rowNumber);
  for (let col = FIRST_COPY_COLUMN; col <= LAST_COLUMN; col++) {
    const value = row.getCell(col).value;
    if (value !== null && value !== undefined && value !== '') {
      return true;
    }
  }
  return false;
}

function copyColumnWidths(sourceSheet, targetSheet) {
  const columnCount = Math.max(sourceSheet.columnCount || 0, LAST_COLUMN);
  for (let col = FIRST_COPY_COLUMN; col <= columnCount; col++) {
    const sourceColumn = sourceSheet.getColumn(col);
    if (sourceColumn.width !== undefined) {
      targetSheet.getColumn(col).width = sourceColumn.width;
    }
  }
}

function normalizeValue(text) {
  return text.trim().toUpperCase();
}

function copyHeaderMerges(sourceSheet, targetSheet) {
  const merges = (sourceSheet.model && sourceSheet.model.merges) || [];
  merges.forEach((range) => {
    const endRef = String(range).split(':')[1];
    const rowMatch = endRef && endRef.match(/\d+/);
    const endRow = rowMatch ? parseInt(rowMatch[0], 10) : 0;
    if (endRow > 0 && endRow <= COLUMN_HEADER_ROW) {
      try {
        targetSheet.mergeCells(range);
      } catch {
        // диапазон некорректен для целевого листа — пропускаем, не критично для данных
      }
    }
  });
}

/**
 * Склеивает несколько манифестов в один. Значения и полный стиль ячейки
 * копируются построчно из исходников, шапка (строки 1..COLUMN_HEADER_ROW),
 * ширины колонок и объединения в шапке берутся из первого файла списка.
 *
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 *        Файлы в желаемом порядке склейки.
 * @param {{renumber?: boolean}} [options]
 *        renumber — пересчитать колонку A (№п/п) от 1 до N по всему своду;
 *        по умолчанию false — нумерация остаётся как в исходниках.
 * @returns {{resultWorkbook: import('exceljs').Workbook, summary: {files: Array<{fileName: string, rows: number}>, totalRows: number, uniqueContainers: number|null, uniqueBillsOfLading: number|null}}}
 * @throws {Error} если структура файлов не совпадает (см. validateStructure) —
 *         сообщение уже содержит имя файла и адрес несовпавшей ячейки.
 */
export function mergeManifests(workbooks, { renumber = false } = {}) {
  if (!Array.isArray(workbooks) || workbooks.length === 0) {
    throw new Error('Нужен хотя бы один файл для объединения');
  }

  const validation = validateStructure(workbooks);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const WorkbookCtor = workbooks[0].workbook.constructor;
  const resultWorkbook = new WorkbookCtor();
  const resultSheet = resultWorkbook.addWorksheet(SHEET_NAME);

  const firstSheet = workbooks[0].workbook.getWorksheet(SHEET_NAME);

  for (let row = 1; row <= COLUMN_HEADER_ROW; row++) {
    copyRow(firstSheet, resultSheet, row, row);
  }
  copyColumnWidths(firstSheet, resultSheet);
  copyHeaderMerges(firstSheet, resultSheet);

  const headerRow = resultSheet.getRow(COLUMN_HEADER_ROW);
  const containerCol = findColumnByKeyword(headerRow, FIRST_COLUMN, LAST_COLUMN, 'контейнер');
  const billCol = findColumnByKeyword(headerRow, FIRST_COLUMN, LAST_COLUMN, 'коносамент');

  const files = [];
  const uniqueContainers = new Set();
  const uniqueBillsOfLading = new Set();
  let targetRow = DATA_START_ROW;
  let runningNumber = 1;

  for (const { fileName, workbook } of workbooks) {
    const sheet = workbook.getWorksheet(SHEET_NAME);
    const lastRow = sheet.rowCount;
    let rows = 0;

    for (let sourceRow = DATA_START_ROW; sourceRow <= lastRow; sourceRow++) {
      if (!rowHasData(sheet, sourceRow)) {
        continue;
      }

      copyRow(sheet, resultSheet, sourceRow, targetRow);

      if (renumber) {
        resultSheet.getRow(targetRow).getCell(NUMBER_COLUMN).value = runningNumber;
        runningNumber++;
      }

      const resultRow = resultSheet.getRow(targetRow);
      if (containerCol) {
        const text = cellText(resultRow.getCell(containerCol));
        if (text) uniqueContainers.add(normalizeValue(text));
      }
      if (billCol) {
        const text = cellText(resultRow.getCell(billCol));
        if (text) uniqueBillsOfLading.add(normalizeValue(text));
      }

      targetRow++;
      rows++;
    }

    files.push({ fileName, rows });
  }

  const totalRows = files.reduce((sum, file) => sum + file.rows, 0);

  return {
    resultWorkbook,
    summary: {
      files,
      totalRows,
      uniqueContainers: containerCol ? uniqueContainers.size : null,
      uniqueBillsOfLading: billCol ? uniqueBillsOfLading.size : null,
    },
  };
}
