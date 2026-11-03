import { dropUnwritableConditionalFormatting } from '../lib/xlsx-safe-write.js?v=202609130013';

const CHANGED_FILL = 'FFFFFF00';
const MAX_COMMENT_VALUE_LENGTH = 2000;

export function versionDate(entry) {
  const modified = entry.workbook?.modified;
  if (modified) {
    const date = modified instanceof Date ? modified : new Date(modified);
    if (Number.isFinite(date.getTime())) return date;
  }
  const timestamp = Number(entry.lastModified);
  return Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp) : null;
}

function normalizeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return { date: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value.richText)) {
    return { text: value.richText.map((part) => part.text ?? '').join('') };
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) result[key] = normalizeValue(value[key]);
  }
  return result;
}

function sameValue(first, second) {
  return JSON.stringify(normalizeValue(first)) === JSON.stringify(normalizeValue(second));
}

function truncated(text) {
  return text.length > MAX_COMMENT_VALUE_LENGTH
    ? `${text.slice(0, MAX_COMMENT_VALUE_LENGTH)}…`
    : text;
}

function displayValue(value) {
  if (value === null || value === undefined || value === '') return '(пусто)';
  if (value instanceof Date) return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  if (typeof value !== 'object') return truncated(String(value));
  if (Array.isArray(value.richText)) return truncated(value.richText.map((part) => part.text ?? '').join(''));
  if (value.formula || value.sharedFormula) return truncated(`=${value.formula ?? value.sharedFormula}`);
  if (value.text !== undefined) return truncated(String(value.text));
  if (value.error) return String(value.error);
  return truncated(JSON.stringify(normalizeValue(value)));
}

function noteTextOf(cell) {
  try {
    const note = cell.note;
    if (!note) return '';
    if (typeof note === 'string') return note;
    if (Array.isArray(note.texts)) return note.texts.map((part) => part.text ?? '').join('');
    return '';
  } catch {
    return '';
  }
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function markChanged(cell, olderFileName, before, after) {
  const style = cloneStyle(cell.style);
  style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CHANGED_FILL } };
  cell.style = style;
  const comparison = `Сравнение с «${olderFileName}»:\nБыло: ${before}\nСтало: ${after}`;
  const previous = noteTextOf(cell);
  cell.note = previous ? `${previous}\n\n${comparison}` : comparison;
}

/**
 * Сравнивает значения ячеек на одноимённых листах и помечает изменения в более
 * поздней книге. Записи: {fileName, workbook, lastModified}.
 */
export function compareVersions(first, second) {
  const firstDate = versionDate(first);
  const secondDate = versionDate(second);
  if (!firstDate || !secondDate) {
    return { ok: false, error: 'Не удалось определить даты изменения обоих файлов. Откройте и сохраните их в Excel, затем попробуйте снова.' };
  }
  if (firstDate.getTime() === secondDate.getTime()) {
    return { ok: false, error: 'У файлов одинаковая дата изменения, поэтому нельзя определить новую версию. Откройте и сохраните более новый файл в Excel, затем попробуйте снова.' };
  }

  const newerIsSecond = secondDate > firstDate;
  const older = newerIsSecond ? first : second;
  const newer = newerIsSecond ? second : first;
  const changes = [];
  const changedSheets = new Set();
  const addedSheets = [];
  const removedSheets = [];

  for (const sheet of newer.workbook.worksheets) {
    dropUnwritableConditionalFormatting(sheet);
    const oldSheet = older.workbook.getWorksheet(sheet.name);
    if (!oldSheet) addedSheets.push(sheet.name);
    const rowCount = Math.max(sheet.rowCount, oldSheet?.rowCount ?? 0);
    const columnCount = Math.max(sheet.columnCount, oldSheet?.columnCount ?? 0);

    for (let row = 1; row <= rowCount; row++) {
      for (let column = 1; column <= columnCount; column++) {
        const oldCell = oldSheet?.getCell(row, column);
        const newCell = sheet.getCell(row, column);
        if (sameValue(oldCell?.value, newCell.value)) continue;
        const before = displayValue(oldCell?.value);
        const after = displayValue(newCell.value);
        markChanged(newCell, older.fileName, before, after);
        changedSheets.add(sheet.name);
        changes.push({ sheet: sheet.name, cell: newCell.address, before, after });
      }
    }
  }

  for (const sheet of older.workbook.worksheets) {
    if (!newer.workbook.getWorksheet(sheet.name)) removedSheets.push(sheet.name);
  }

  return {
    ok: true,
    resultWorkbook: newer.workbook,
    changes,
    summary: {
      changedCells: changes.length,
      changedSheets: changedSheets.size,
      olderFile: older.fileName,
      newerFile: newer.fileName,
      olderDate: older === first ? firstDate : secondDate,
      newerDate: older === first ? secondDate : firstDate,
      addedSheets,
      removedSheets,
    },
  };
}
