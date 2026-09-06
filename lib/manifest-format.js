// Подтверждённый формат манифеста: лист "Manifest", шапка рейса — строки 3-5,
// заголовки колонок — строка 5, данные — с 6-й строки, диапазон колонок C:Y (23 поля).
// Эти детали намеренно не выставлены наружу — наружу выходит только validateStructure().

export const SHEET_NAME = 'Manifest';
export const HEADER_FIRST_ROW = 3;
export const COLUMN_HEADER_ROW = 5;
export const DATA_START_ROW = 6;
export const FIRST_COLUMN = 3; // C
export const LAST_COLUMN = 25; // Y

function columnLetter(index) {
  let letter = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

function getManifestSheet(workbook) {
  return workbook.getWorksheet(SHEET_NAME) || null;
}

function readColumnHeaders(sheet) {
  const row = sheet.getRow(COLUMN_HEADER_ROW);
  const headers = [];
  for (let col = FIRST_COLUMN; col <= LAST_COLUMN; col++) {
    const cell = row.getCell(col);
    const text = cell.text !== undefined && cell.text !== null ? String(cell.text) : '';
    headers.push(text.trim());
  }
  return headers;
}

/**
 * Проверяет, что у всех переданных книг один и тот же лист "Manifest" и
 * совпадающий текст заголовков C5:Y5.
 *
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} workbooks
 * @returns {{ok: true} | {ok: false, error: string}}
 */
// Обёрнуто в try/catch по тому же поводу, что и cellText() в dg-check/core.js:
// чтение .text у объединённой ячейки с пустым мастером бросает исключение
// внутри ExcelJS — здесь оно означало бы «не нашли», а не падение инструмента.
function safeCellText(cell) {
  try {
    const value = cell.text;
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function findInHeaderRow(sheet, marker) {
  const row = sheet.getRow(HEADER_FIRST_ROW);
  const cellCount = row.cellCount || LAST_COLUMN;
  for (let col = 1; col <= cellCount; col++) {
    const text = safeCellText(row.getCell(col));
    const index = text.indexOf(marker);
    if (index === -1) continue;
    return text.slice(index + marker.length).trim().replace(/^№\s*/, '') || null;
  }
  return null;
}

/**
 * Читает название судна и номер рейса из строки HEADER_FIRST_ROW листа
 * "Manifest" — не из фиксированных колонок (в примере пользователя это C и
 * J, но это не проверено ни на одном втором файле), а по ключевым словам
 * «т/х» и «Рейс», как и весь остальной поиск колонок на этом сайте. Не
 * найдено — `null` в соответствующем поле, а не ошибка: этот заголовок не
 * обязателен для остальной работы инструментов.
 *
 * @param {import('exceljs').Workbook} workbook
 * @returns {{vessel: string|null, voyage: string|null}}
 */
export function readVoyageHeader(workbook) {
  const sheet = getManifestSheet(workbook);
  if (!sheet) return { vessel: null, voyage: null };

  return {
    vessel: findInHeaderRow(sheet, 'т/х'),
    voyage: findInHeaderRow(sheet, 'Рейс'),
  };
}

export function validateStructure(workbooks) {
  if (!Array.isArray(workbooks) || workbooks.length === 0) {
    return { ok: true };
  }

  let referenceHeaders = null;
  let referenceFileName = null;

  for (const entry of workbooks) {
    const { fileName, workbook } = entry;
    const sheet = getManifestSheet(workbook);

    if (!sheet) {
      return {
        ok: false,
        error: `Не удалось прочитать файл «${fileName}»: нет листа "${SHEET_NAME}"`,
      };
    }

    const headers = readColumnHeaders(sheet);

    if (referenceHeaders === null) {
      referenceHeaders = headers;
      referenceFileName = fileName;
      continue;
    }

    for (let i = 0; i < headers.length; i++) {
      if (headers[i] !== referenceHeaders[i]) {
        const cellAddress = `${columnLetter(FIRST_COLUMN + i)}${COLUMN_HEADER_ROW}`;
        return {
          ok: false,
          error:
            `Файл «${fileName}»: ячейка ${cellAddress} («${headers[i]}») не совпадает ` +
            `с файлом «${referenceFileName}» («${referenceHeaders[i]}»)`,
        };
      }
    }
  }

  return { ok: true };
}
