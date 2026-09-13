// «Проверить шаблон эл. поручения»: проверка формы шаблона (template-form.js),
// сверка каждой строки с поручением (lib/loading-order.js) и три результата —
// книга заказчика с жёлтыми ячейками и примечаниями, исправленный шаблон по
// эталонной форме и текст отчёта. Чистый модуль: ExcelJS не импортирует (книги
// приходят снаружи, новую пустую даёт options.createWorkbook) и DOM не трогает.
//
// Правила — .autopilot/2026-09-12-order-template-check--wip/spec.md, §3–§7.
// Наружу выходят только detectFileKind и checkTemplate.

import {
  SHEET_NAME, HEADER_FIELDS, HEADER_LABEL_COLUMN, HEADER_VALUE_COLUMN, NOTE_CELL, NOTE_TEXT,
  COLUMN_HEADER_ROW, DATA_START_ROW, COLUMNS, HEADER_ROW_HEIGHT, DATA_ROW_HEIGHT, TEXT_FORMAT, FONTS,
  normalizeHeader,
} from './template-form.js?v=202609131200';
import { parseLoadingOrder } from '../lib/loading-order.js?v=202609130013';
import { dropUnwritableConditionalFormatting } from '../lib/xlsx-safe-write.js?v=202609130013';

const YELLOW_ARGB = 'FFFFFF00';
const BLUE_ARGB = 'FFADD8E6'; // предупреждение — светло-голубой, отличим от жёлтого ошибок
const TOLERANCE = 0.01; // допуск при сравнении весов и чисел
const HEADER_SEARCH_ROWS = 30;
const MIN_RECOGNIZED_HEADERS = 5; // столько заголовков делают строку строкой заголовков
const EARLY_DAYS = 30; // раньше самой ранней даты поручения — подозрительно
const LATE_DAYS = 90; // позже самой поздней — тоже

const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));
const COLUMN_BY_NORM = new Map(COLUMNS.map((c) => [normalizeHeader(c.header), c]));
const FIELD_BY_NORM = new Map(HEADER_FIELDS.map((f) => [normalizeHeader(f.label), f]));
const HEADER_FIELD_BY_KEY = new Map(HEADER_FIELDS.map((f) => [f.key, f]));
// Колонки, числа в которых образуют строку «итого» (K–O).
const SUM_KEYS = ['places', 'cargoWeight', 'tareWeight', 'volume', 'vgm'];
// Ячейки, которые исправленный шаблон переносит ровно такими, как их записал
// заказчик: A, C, G, J, K, N (spec §4, «Что исправленный шаблон не меняет
// никогда»). Список — страховка на будущее: исправление для этих колонок не
// регистрируется, даже если новое правило попробует его завести. Даты шапки
// E3 и E4 в том же перечне — для них исправлений нет ни в одном правиле §5.1.
const KEEP_AS_IS_KEYS = new Set(['billOfLading', 'billDate', 'cargoNameEn', 'packageType', 'places', 'volume',
  'arrivalDate', 'departureDate']);

/* ——— мелкие помощники ——— */

function columnLetter(index) {
  let letter = '';
  let n = index;
  while (n > 0) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

const addressOf = (col, row) => `${columnLetter(col)}${row}`;

function plural(n, one, few, many) {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return String(value);
  return String(Math.round(value * 1000) / 1000).replace('.', ',');
}

const formatDate = (parts) => (parts
  ? `${String(parts.d).padStart(2, '0')}.${String(parts.m).padStart(2, '0')}.${parts.y}`
  : '');

// Значение ячейки так, как его увидит система: формула — по результату,
// форматированный текст — склеенным, ссылка — своим текстом. У ячейки внутри
// объединения ExcelJS отдаёт значение главной ячейки.
function effectiveValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw;
  if (typeof raw === 'object') {
    if ('formula' in raw || 'sharedFormula' in raw) return effectiveValue(raw.result === undefined ? null : raw.result);
    if (Array.isArray(raw.richText)) return raw.richText.map((part) => part.text ?? '').join('');
    if ('error' in raw) return String(raw.error);
    if ('text' in raw) return effectiveValue(raw.text);
    return null;
  }
  return raw;
}

function textOf(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(partsFromDate(value));
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
}

const trimmedOf = (value) => textOf(value).trim();
const isBlankValue = (value) => value === null || value === undefined
  || (typeof value === 'string' && value.trim() === '');

// Чтение ячейки: .text у объединённой ячейки с пустым мастером бросает
// исключение внутри ExcelJS (CLAUDE.md) — поэтому только .value, и тоже под try.
function readCellInfo(sheet, row, col) {
  const cell = sheet.getRow(row).getCell(col);
  let raw = null;
  let numFmt = null;
  try {
    raw = cell.value;
    numFmt = cell.numFmt || null;
  } catch {
    raw = null;
  }
  const isFormula = !!(raw && typeof raw === 'object' && ('formula' in raw || 'sharedFormula' in raw));
  return { address: addressOf(col, row), col, row, value: effectiveValue(raw), numFmt, isFormula };
}

/* ——— числа и даты (spec §4.5) ——— */

// Текст, который читается как число: пробелы и NBSP убираются, запятая = точка;
// с двумя разными разделителями — не число.
function readNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { ok: true, number: value, asText: false, empty: false };
  if (typeof value === 'string') {
    const compact = value.replace(/\s/g, '');
    if (!compact) return { ok: false, number: null, asText: false, empty: true };
    const commas = (compact.match(/,/g) || []).length;
    const dots = (compact.match(/\./g) || []).length;
    if (commas > 1 || dots > 1 || (commas > 0 && dots > 0)) return { ok: false, number: null, asText: false, empty: false };
    const normalized = compact.replace(',', '.');
    if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return { ok: false, number: null, asText: false, empty: false };
    return { ok: true, number: Number(normalized), asText: true, empty: false };
  }
  return { ok: false, number: null, asText: false, empty: isBlankValue(value) };
}

const partsFromDate = (date) => ({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });

function validParts(parts) {
  if (!parts || parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.y < 1900 || parts.y > 2999) return false;
  const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  return date.getUTCMonth() + 1 === parts.m && date.getUTCDate() === parts.d;
}

// Дата Excel числом: серийный номер считаем от 30.12.1899, как это делает Excel.
const partsFromSerial = (serial) => partsFromDate(new Date(Math.round((serial - 25569) * 86400000)));
const isDateFormat = (numFmt) => !!numFmt && /[dmy]/i.test(String(numFmt).replace(/"[^"]*"/g, ''));

/**
 * Как записана дата: 'ok' — текст ДД.ММ.ГГГГ (эталон), 'excel' — дата Excel,
 * 'other' — текст в другом виде (Д.М.ГГГГ, ДД.ММ.ГГ, ГГГГ-ММ-ДД), 'invalid' —
 * датой не читается, 'empty' — пусто. parts — разобранная дата, если получилось.
 */
function readDate(value, numFmt) {
  if (isBlankValue(value)) return { status: 'empty', parts: null };
  if (value instanceof Date) return { status: 'excel', parts: partsFromDate(value) };
  if (typeof value === 'number') {
    if (isDateFormat(numFmt)) {
      const parts = partsFromSerial(value);
      return { status: 'excel', parts: validParts(parts) ? parts : null };
    }
    return { status: 'invalid', parts: null };
  }
  const text = String(value).trim();
  const patterns = [
    [/^(\d{2})\.(\d{2})\.(\d{4})$/, 'ok', (m) => ({ d: +m[1], m: +m[2], y: +m[3] })],
    [/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, 'other', (m) => ({ d: +m[1], m: +m[2], y: +m[3] })],
    [/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, 'other', (m) => ({ d: +m[1], m: +m[2], y: 2000 + +m[3] })],
    [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, 'other', (m) => ({ y: +m[1], m: +m[2], d: +m[3] })],
  ];
  for (const [pattern, status, build] of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const parts = build(match);
    return validParts(parts) ? { status, parts } : { status: 'invalid', parts: null };
  }
  return { status: 'invalid', parts: null };
}

const dayNumber = (parts) => Date.UTC(parts.y, parts.m - 1, parts.d) / 86400000;

/* ——— ISO-код: один тип или нет (spec §5.4) ——— */

const ISO_LENGTH = { 1: 10, 2: 20, 3: 30, 4: 40, L: 45 };
const ISO_HEIGHT = { 0: 'STD', 1: 'STD', 2: 'STD', 3: 'STD', 4: 'STD', 5: 'HC', 6: 'HC', 8: 'LOW', 9: 'LOW' };
const ISO_OLD_GROUPS = [[0, 19, 'G'], [30, 39, 'R'], [50, 59, 'U'], [60, 69, 'P'], [70, 79, 'T']];
// Обиходные обозначения; null в высоте — высота не известна и совпадает с любой.
const ISO_COMMON = new Map(Object.entries({
  '20DV': [20, 'STD', 'G'], '20DC': [20, 'STD', 'G'], '20GP': [20, 'STD', 'G'], '20ST': [20, 'STD', 'G'], '20SD': [20, 'STD', 'G'],
  '40DV': [40, 'STD', 'G'], '40DC': [40, 'STD', 'G'], '40GP': [40, 'STD', 'G'], '40ST': [40, 'STD', 'G'], '40SD': [40, 'STD', 'G'],
  '40HC': [40, 'HC', 'G'], '40HQ': [40, 'HC', 'G'], '45HC': [45, 'HC', 'G'], '45HQ': [45, 'HC', 'G'],
  '20RF': [20, null, 'R'], '20RE': [20, null, 'R'], '40RF': [40, null, 'R'], '40RE': [40, null, 'R'],
  '40RH': [40, 'HC', 'R'], '40HR': [40, 'HC', 'R'], '40RQ': [40, 'HC', 'R'],
  '20OT': [20, null, 'U'], '40OT': [40, null, 'U'],
  '20FR': [20, null, 'P'], '20PL': [20, null, 'P'], '40FR': [40, null, 'P'], '40PL': [40, null, 'P'],
  '20TK': [20, null, 'T'], '20TN': [20, null, 'T'],
}));

function parseIso(code) {
  const text = String(code ?? '').toUpperCase().replace(/\s/g, '');
  if (!text) return null;
  const common = ISO_COMMON.get(text);
  if (common) return { length: common[0], height: common[1], group: common[2] };
  if (/^[1-9L][0-9][A-Z][0-9]$/.test(text)) {
    const length = ISO_LENGTH[text[0]];
    const height = ISO_HEIGHT[text[1]];
    return length && height ? { length, height, group: text[2] } : null;
  }
  if (/^\d{4}$/.test(text)) {
    const length = ISO_LENGTH[text[0]];
    const height = ISO_HEIGHT[text[1]];
    const tail = Number(text.slice(2));
    const group = ISO_OLD_GROUPS.find(([from, to]) => tail >= from && tail <= to);
    return length && height && group ? { length, height, group: group[2] } : null;
  }
  return null;
}

// Один тип: равны длина и группа, высота равна там, где она известна у обоих.
// Если хоть один код не разобрался — сравниваются строки без учёта регистра.
function sameIsoType(a, b) {
  const first = parseIso(a);
  const second = parseIso(b);
  if (!first || !second) {
    return String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
  }
  if (first.length !== second.length || first.group !== second.group) return false;
  return !(first.height && second.height && first.height !== second.height);
}

const isReefer = (code) => parseIso(code)?.group === 'R';

/* ——— нормализация значений при сравнении ——— */

const normalizeContainer = (text) => String(text ?? '').toUpperCase().replace(/[\s-]/g, '');
const normalizeOrderNumber = (text) => String(text ?? '').toUpperCase().replace(/\s/g, '');
const normalizeLoose = (text) => String(text ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
// Имя стороны коносамента: только буквы и цифры, латиница-двойник → кириллица.
const normalizeName = (text) => normalizeHeader(text);

const sealSet = (text) => new Set(String(text ?? '')
  .split(/[,;]/)
  .map((part) => part.replace(/\s/g, '').toUpperCase())
  .filter(Boolean));

// ExcelJS отдаёт ОДИН объект стиля сотням ячеек с одинаковым оформлением —
// перед покраской стиль клонируется, иначе жёлтыми станут все они (CLAUDE.md).
const cloneStyle = (style) => (style ? JSON.parse(JSON.stringify(style)) : {});

/* ——— модель шаблона: шапка, карта колонок, строки с адресами ——— */

// Строка заголовков — первая из первых 30 строк, где по нормализации нашлись
// хотя бы 5 из 26 заголовков. Номер строки не фиксируем: «не 8-я» — это ошибка
// формы, а не причина не узнать шаблон.
function findHeaderRow(sheet) {
  const maxRow = Math.min(sheet.rowCount || 0, HEADER_SEARCH_ROWS);
  for (let r = 1; r <= maxRow; r++) {
    const row = sheet.getRow(r);
    const found = new Set();
    for (let col = 1; col <= (row.cellCount || 0); col++) {
      const def = COLUMN_BY_NORM.get(normalizeHeader(textOf(readCellInfo(sheet, r, col).value)));
      if (def) found.add(def.key);
    }
    if (found.size >= MIN_RECOGNIZED_HEADERS) return r;
  }
  return null;
}

// Лист шаблона: EXPORT_MANIFEST, если на нём есть строка заголовков; иначе
// первый лист, на котором она есть.
function findTemplateSheet(workbook) {
  const named = workbook.worksheets.find((sheet) => sheet.name === SHEET_NAME);
  if (named) {
    const headerRow = findHeaderRow(named);
    if (headerRow) return { sheet: named, headerRow };
  }
  for (const sheet of workbook.worksheets) {
    const headerRow = findHeaderRow(sheet);
    if (headerRow) return { sheet, headerRow };
  }
  return null;
}

function parseRange(range) {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!match) return null;
  const toCol = (letters) => [...letters].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
  return { range, left: toCol(match[1]), top: +match[2], right: toCol(match[3]), bottom: +match[4], address: `${match[1]}${match[2]}` };
}

function readModel(sheet, headerRow) {
  const maxCol = Math.max(sheet.columnCount || 0, COLUMNS.length);
  const columns = new Map();
  const duplicateKeys = new Set();
  const headerEntries = [];
  for (let col = 1; col <= maxCol; col++) {
    const info = readCellInfo(sheet, headerRow, col);
    const text = trimmedOf(info.value);
    if (!text) continue;
    const def = COLUMN_BY_NORM.get(normalizeHeader(text));
    if (!def) {
      headerEntries.push({ kind: 'extra', col, address: info.address, text });
      continue;
    }
    // Точность текста — сравнением как есть, без нормализации; пробелы по краям
    // не считаются: они невидимы, а система заголовок всё равно обрезает.
    if (columns.has(def.key)) {
      duplicateKeys.add(def.key);
      headerEntries.push({ kind: 'duplicate', col, address: info.address, text, key: def.key });
      continue;
    }
    columns.set(def.key, { key: def.key, col, address: info.address, text, exact: text === def.header, def });
    headerEntries.push({ kind: 'standard', col, address: info.address, text, key: def.key, exact: text === def.header });
  }

  const rowIsEmpty = (r) => {
    for (let col = 1; col <= maxCol; col++) if (!isBlankValue(readCellInfo(sheet, r, col).value)) return false;
    return true;
  };
  let lastRow = headerRow;
  for (let r = headerRow + 1; r <= (sheet.rowCount || 0); r++) if (!rowIsEmpty(r)) lastRow = r;

  const containerCol = columns.get('container')?.col ?? null;
  const sumCols = new Set(SUM_KEYS.map((key) => columns.get(key)?.col).filter(Boolean));
  const rows = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const byCol = new Map();
    const nonEmpty = [];
    for (let col = 1; col <= maxCol; col++) {
      const info = readCellInfo(sheet, r, col);
      byCol.set(col, info);
      if (!isBlankValue(info.value)) nonEmpty.push(info);
    }
    const cells = {};
    for (const [key, column] of columns) cells[key] = byCol.get(column.col);
    const container = containerCol ? trimmedOf(byCol.get(containerCol).value) : '';
    let kind = 'data';
    if (nonEmpty.length === 0) kind = 'blank';
    else if (!container) kind = isTotalRow(nonEmpty, sumCols) ? 'total' : 'noContainer';
    rows.push({ row: r, kind, container, cells, byCol, nonEmpty });
  }

  // Колонка с данными, но без заголовка: её данные в исправленный шаблон не
  // попадут, поэтому о ней тоже нужно сказать.
  const known = new Set(headerEntries.map((entry) => entry.col));
  for (let col = 1; col <= maxCol; col++) {
    if (known.has(col)) continue;
    const hasData = rows.some((row) => row.kind !== 'blank' && !isBlankValue(row.byCol.get(col).value));
    if (hasData) headerEntries.push({ kind: 'extra', col, address: addressOf(col, headerRow), text: '' });
  }
  headerEntries.sort((a, b) => a.col - b.col);
  for (const entry of headerEntries) {
    if (entry.kind === 'standard') continue;
    entry.hasData = rows.some((row) => row.kind !== 'blank' && !isBlankValue(row.byCol.get(entry.col).value));
  }

  // Подписи шапки — в любой колонке строк выше строки заголовков; значение справа.
  const labels = new Map();
  for (let r = 1; r < headerRow; r++) {
    for (let col = 1; col <= maxCol; col++) {
      const info = readCellInfo(sheet, r, col);
      const text = trimmedOf(info.value);
      if (!text) continue;
      const field = FIELD_BY_NORM.get(normalizeHeader(text));
      if (!field || labels.has(field.key)) continue;
      labels.set(field.key, { field, row: r, col, address: info.address, text, value: readCellInfo(sheet, r, col + 1) });
    }
  }

  const labelCells = new Set([...labels.values()].flatMap((label) => [label.address, label.value.address]));
  const merges = ((sheet.model && sheet.model.merges) || [])
    .map(parseRange)
    .filter((merge) => merge && (merge.bottom >= headerRow || labelCells.has(merge.address)))
    .sort((a, b) => (a.top - b.top) || (a.left - b.left));

  return {
    sheet, sheetName: sheet.name, headerRow, maxCol, lastRow, columns, duplicateKeys, headerEntries, rows, labels, merges,
  };
}

// Строка «итого» — без номера контейнера, где заполнены только K–O числами
// (spec §4.4, дословно). Любая непустая ячейка вне K–O — в том числе с меткой
// «Итого»/«Всего»/«Total» — уже не «только K–O»: такая строка не итоговая и не
// удаляется молча, а идёт в правило «без контейнера, но с другими данными»
// (уточнить у заказчика) — иначе строка с реальными, не итоговыми данными
// потерялась бы без вопроса при авто-исправлении.
function isTotalRow(nonEmpty, sumCols) {
  let numbers = 0;
  for (const info of nonEmpty) {
    if (!sumCols.has(info.col)) return false;
    if (!readNumber(info.value).ok) return false;
    numbers += 1;
  }
  return numbers > 0;
}

/* ——— находки ——— */

function finding({ level, fix = null, section, sheet, cell = null, field, container = null, message, correction = null }) {
  return { level, fix: level === 'warning' ? null : fix, section, sheet, cell, field, container, message, correction };
}

// Чей это столбец или подпись — для поля находки, у которой своего поля нет
// (объединённые ячейки).
function fieldForCell(model, col, row) {
  if (row >= model.headerRow) {
    const entry = model.headerEntries.find((e) => e.col === col);
    if (entry) return entry.kind === 'standard' ? COLUMN_BY_KEY.get(entry.key).header : (entry.text || `Колонка ${columnLetter(col)}`);
    return 'Строка';
  }
  for (const label of model.labels.values()) {
    if (label.address === addressOf(col, row) || label.value.address === addressOf(col, row)) return label.field.label;
  }
  return 'Шапка';
}

/* ——— §4.1 лист, §4.2 подписи шапки, §4.3 заголовки, §4.4 строки ——— */

function checkSheets(workbook, model, ctx) {
  if (model.sheetName !== SHEET_NAME) {
    ctx.form.push(finding({
      level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, field: 'Лист',
      message: `лист называется «${model.sheetName}», а система принимает только «${SHEET_NAME}»`,
      correction: `переименован в «${SHEET_NAME}»`,
    }));
    ctx.yellowTabs.add(model.sheet);
  }
  for (const sheet of workbook.worksheets) {
    if (sheet === model.sheet) continue;
    ctx.form.push(finding({
      level: 'error', fix: 'auto', section: 'form', sheet: sheet.name, field: 'Лист',
      message: `лишний лист «${sheet.name}» — в книге должен остаться только «${SHEET_NAME}»`,
      correction: 'удалён',
    }));
    ctx.yellowTabs.add(sheet);
  }
}

function checkHeaderLabels(model, ctx) {
  for (const field of HEADER_FIELDS) {
    const expected = `${HEADER_LABEL_COLUMN}${field.row}`;
    const found = model.labels.get(field.key);
    if (!found) {
      const auto = ctx.headerAutoValue(field.key);
      ctx.form.push(finding({
        level: 'error', fix: auto === null ? 'customer' : 'auto', section: 'form', sheet: model.sheetName,
        field: field.label, message: `в шапке нет строки «${field.label}»`,
        correction: auto === null ? null : `строка «${field.label}» в ${expected}, значение «${auto}» из поручения`,
      }));
      if (auto !== null) ctx.fixes.set(`head:${field.key}`, auto);
      continue;
    }
    const problems = [];
    if (found.address !== expected) problems.push(`стоит в ${found.address}, а должна в ${expected}`);
    if (found.text !== field.label) problems.push(`записана как «${found.text}», а должна «${field.label}»`);
    if (problems.length === 0) continue;
    ctx.form.push(finding({
      level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, cell: found.address,
      field: field.label, message: `подпись шапки ${problems.join(', ')}`,
      correction: `подпись «${field.label}» в ${expected}`,
    }));
  }
}

function checkColumnHeaders(model, ctx) {
  if (model.headerRow !== COLUMN_HEADER_ROW) {
    const leftmost = model.headerEntries.find((entry) => entry.kind === 'standard');
    ctx.form.push(finding({
      level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, cell: leftmost ? leftmost.address : null,
      field: 'Строка заголовков',
      message: `заголовки колонок стоят в строке ${model.headerRow}, а должны в строке ${COLUMN_HEADER_ROW}`,
      correction: `заголовки в строке ${COLUMN_HEADER_ROW}, данные с ${DATA_START_ROW}-й`,
    }));
  }
  const dataLost = (entry) => (entry.hasData ? ' — данные этой колонки в исправленный шаблон не попадут' : '');
  for (const entry of model.headerEntries) {
    if (entry.kind === 'extra') {
      const name = entry.text || `колонка ${columnLetter(entry.col)}`;
      ctx.form.push(finding({
        level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, cell: entry.address,
        field: entry.text || `Колонка ${columnLetter(entry.col)}`,
        message: `лишняя колонка «${name}» — такого заголовка в форме нет${dataLost(entry)}`,
        correction: 'колонка убрана',
      }));
      continue;
    }
    const def = COLUMN_BY_KEY.get(entry.key);
    if (model.duplicateKeys.has(entry.key)) {
      const cells = model.headerEntries.filter((e) => e.key === entry.key).map((e) => columnLetter(e.col));
      ctx.form.push(finding({
        level: 'error', fix: 'customer', section: 'form', sheet: model.sheetName, cell: entry.address, field: def.header,
        message: `заголовок «${def.header}» стоит в двух колонках (${cells.join(', ')}) — оставьте одну${entry.kind === 'duplicate' ? dataLost(entry) : ''}`,
      }));
      continue;
    }
    const problems = [];
    if (entry.col !== COLUMNS.indexOf(def) + 1) problems.push(`колонка стоит в ${columnLetter(entry.col)}, а должна в ${def.letter}`);
    if (!entry.exact) problems.push(`заголовок записан как «${entry.text}», а должен «${def.header}»`);
    if (problems.length === 0) continue;
    ctx.form.push(finding({
      level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, cell: entry.address, field: def.header,
      message: problems.join(', '), correction: `колонка ${def.letter} «${def.header}»`,
    }));
  }
  for (const def of COLUMNS) {
    if (model.columns.has(def.key)) continue;
    ctx.form.push(finding({
      level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, field: def.header,
      message: `в таблице нет колонки «${def.header}» (${def.letter})`, correction: `колонка ${def.letter} добавлена`,
    }));
  }
}

function checkRowStructure(model, ctx) {
  model.rows.forEach((row, index) => {
    if (row.kind === 'blank') {
      if (!model.rows.slice(index + 1).some((next) => next.kind !== 'blank')) return;
      ctx.form.push(finding({
        level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, cell: addressOf(1, row.row),
        field: 'Строка', message: 'пустая строка внутри таблицы', correction: 'строка убрана',
      }));
      return;
    }
    if (row.kind === 'total') {
      ctx.form.push(finding({
        level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, cell: row.nonEmpty[0].address,
        field: 'Строка', message: 'строка без номера контейнера с одними суммами — похоже на «итого»',
        correction: 'строка убрана',
      }));
      return;
    }
    if (row.kind === 'noContainer') {
      ctx.form.push(finding({
        level: 'error', fix: 'customer', section: 'form', sheet: model.sheetName,
        cell: model.columns.has('container') ? addressOf(model.columns.get('container').col, row.row) : null,
        field: COLUMN_BY_KEY.get('container').header,
        message: 'в строке нет номера контейнера, но есть другие данные',
      }));
    }
  });
  if (!model.rows.some((row) => row.kind === 'data')) {
    ctx.form.push(finding({
      level: 'error', fix: 'customer', section: 'form', sheet: model.sheetName, field: COLUMN_BY_KEY.get('container').header,
      message: 'в таблице нет ни одной строки с номером контейнера',
    }));
  }
}

function checkMerges(model, ctx) {
  for (const merge of model.merges) {
    ctx.form.push(finding({
      level: 'error', fix: 'auto', section: 'form', sheet: model.sheetName, cell: merge.address,
      field: fieldForCell(model, merge.left, merge.top),
      message: `объединённые ячейки ${merge.range} — система читает таблицу по строкам`,
      correction: 'объединение снято, значение стоит в каждой ячейке',
    }));
  }
}

/* ——— наружу ——— */

/**
 * Что это за файл: поручение на погрузку, шаблон эл. поручения или ни то ни другое.
 * Поручение проверяется первым — это более узкий признак.
 *
 * @param {import('exceljs').Workbook} workbook
 * @returns {{kind:'order', orderNumber:string, containers:number} | {kind:'template', containers:number} | {kind:'unknown'}}
 */
export function detectFileKind(workbook) {
  const order = parseLoadingOrder(workbook);
  if (order.ok) {
    return { kind: 'order', orderNumber: order.order.orderNumber, containers: order.order.containers.length };
  }
  const found = findTemplateSheet(workbook);
  if (found) {
    const model = readModel(found.sheet, found.headerRow);
    return { kind: 'template', containers: model.rows.filter((row) => row.kind === 'data').length };
  }
  // Лист с эталонным именем — шаблон и без строки заголовков: пустую форму
  // тоже нужно узнать, чтобы сказать о ней по-человечески.
  const named = workbook.worksheets.some((sheet) => normalizeHeader(sheet.name) === normalizeHeader(SHEET_NAME));
  return named ? { kind: 'template', containers: 0 } : { kind: 'unknown' };
}

/**
 * Проверяет шаблон по форме (§4) и сверяет его строки с поручениями (§5).
 *
 * @param {import('exceljs').Workbook} templateWb — книга шаблона; будет изменена на месте (пометки)
 * @param {Array<{fileName:string, workbook:import('exceljs').Workbook}>} orderEntries
 * @param {{createWorkbook:Function, templateFileName?:string, checkedAt?:Date}} options
 * @returns {object} — форма результата в interfaces.md
 */
export function checkTemplate(templateWb, orderEntries, options = {}) {
  const { createWorkbook, templateFileName = 'шаблон.xlsx', checkedAt = new Date() } = options;
  if (!Array.isArray(orderEntries) || orderEntries.length === 0) {
    return { ok: false, error: 'не загружено ни одного поручения' };
  }
  const parsed = [];
  for (const entry of orderEntries) {
    const result = parseLoadingOrder(entry.workbook);
    if (!result.ok) return { ok: false, error: `${entry.fileName}: ${result.error}` };
    parsed.push({ fileName: entry.fileName, order: result.order });
  }
  const found = findTemplateSheet(templateWb);
  if (!found) return { ok: false, error: 'в книге нет строки заголовков шаблона — это не шаблон эл. поручения' };

  const model = readModel(found.sheet, found.headerRow);
  const orderInfo = buildOrderInfo(parsed);
  const ctx = {
    form: [], data: [], missing: [], warnings: [], topWarnings: [],
    fixes: new Map(), yellowTabs: new Set(), orderInfo, model,
    headerAutoValue: (key) => orderInfo.headerValue(key),
  };

  checkSheets(templateWb, model, ctx);
  checkHeaderLabels(model, ctx);
  checkColumnHeaders(model, ctx);
  checkRowStructure(model, ctx);
  checkMerges(model, ctx);
  checkHeaderValues(model, ctx);
  checkDataRows(model, ctx);
  checkMissingContainers(model, ctx);

  const findings = [...ctx.form, ...ctx.data, ...ctx.missing, ...ctx.warnings];
  const errors = findings.filter((f) => f.level === 'error');
  const autoFixable = errors.filter((f) => f.fix === 'auto').length;
  const summary = {
    containers: model.rows.filter((row) => row.kind === 'data').length,
    errors: errors.length,
    autoFixable,
    needsCustomer: errors.filter((f) => f.fix === 'customer').length,
    warnings: ctx.warnings.length + ctx.topWarnings.length,
  };
  const base = templateFileName.replace(/\.xlsx$/i, '');
  const fileNames = {
    marked: `${base} (пометки).xlsx`,
    corrected: `${base} (исправлен).xlsx`,
    report: `${base} (отчёт).txt`,
  };
  const markedWorkbook = buildMarkedWorkbook(templateWb, model, findings, ctx);
  const correctedWorkbook = autoFixable > 0 ? buildCorrectedWorkbook(model, ctx, createWorkbook) : null;
  const reportText = buildReportText({ model, ctx, findings, summary, fileNames, templateFileName, checkedAt, parsed });
  return {
    ok: true,
    findings,
    summary,
    topWarnings: ctx.topWarnings,
    markedWorkbook,
    correctedWorkbook,
    reportText,
    fileNames,
  };
}

/* ——— сверка с поручением (spec §5) ——— */

// Всё, что нужно знать о загруженных поручениях: где какой контейнер, какие
// суда, рейсы и даты. Один контейнер может стоять в нескольких поручениях
// (сборный груз), поэтому индекс — на список.
function buildOrderInfo(parsed) {
  const byContainer = new Map();
  const byNumber = new Map();
  const vessels = new Map();
  const voyages = new Map();
  const dates = [];
  for (const entry of parsed) {
    const { order } = entry;
    byNumber.set(normalizeOrderNumber(order.orderNumber), entry);
    if (order.vessel) vessels.set(normalizeLoose(order.vessel), order.vessel.trim());
    if (order.voyage) voyages.set(normalizeLoose(order.voyage), order.voyage.trim());
    const date = readDate(order.date, null);
    if (date.parts) dates.push({ parts: date.parts, day: dayNumber(date.parts) });
    for (const container of order.containers) {
      const key = normalizeContainer(container.containerNumber);
      if (!byContainer.has(key)) byContainer.set(key, []);
      byContainer.get(key).push({ entry, container });
    }
  }
  const single = (map) => (map.size === 1 ? [...map.values()][0] : null);
  return {
    parsed, byContainer, byNumber, vessels, voyages,
    earliest: dates.length ? dates.reduce((a, b) => (a.day <= b.day ? a : b)) : null,
    latest: dates.length ? dates.reduce((a, b) => (a.day >= b.day ? a : b)) : null,
    headerValue: (key) => (key === 'vessel' ? single(vessels) : (key === 'voyage' ? single(voyages) : null)),
  };
}

// A01: дата далеко от дат поручений — сверить её не с чем, но опечатка в годе видна.
function suspiciousDate(ctx, model, parts, cell, field, container) {
  const { earliest, latest } = ctx.orderInfo;
  if (!earliest || !latest) return;
  const day = dayNumber(parts);
  const warn = (diff, direction, reference) => ctx.warnings.push(finding({
    level: 'warning', section: 'data', sheet: model.sheetName, cell, field, container,
    message: `${formatDate(parts)} — на ${diff} ${plural(diff, 'день', 'дня', 'дней')} ${direction} даты поручения ${formatDate(reference)}, проверьте год`,
  }));
  if (day < earliest.day - EARLY_DAYS) warn(earliest.day - day, 'раньше', earliest.parts);
  else if (day > latest.day + LATE_DAYS) warn(day - latest.day, 'позже', latest.parts);
}

function dateKindFinding(model, info, field, date, container) {
  const shown = `«${trimmedOf(info.value)}»`;
  const tail = '— исправьте вручную или уточните у заказчика';
  const message = date.status === 'excel'
    ? `дата записана датой Excel (${formatDate(date.parts) || 'значение не разобрать'}), а нужна текстом ДД.ММ.ГГГГ ${tail}`
    : (date.status === 'other'
      ? `дата записана как ${shown}, а нужна текстом ДД.ММ.ГГГГ ${tail}`
      : `${shown} не читается как дата ДД.ММ.ГГГГ ${tail}`);
  return finding({
    level: 'error', fix: 'customer', section: 'form', sheet: model.sheetName, cell: info.address, field, container, message,
  });
}

function checkHeaderValues(model, ctx) {
  const { orderInfo } = ctx;
  const push = (props) => ctx.data.push(finding({ section: 'data', sheet: model.sheetName, ...props }));
  const dates = {};
  for (const field of HEADER_FIELDS) {
    const label = model.labels.get(field.key);
    if (!label) continue; // о том, что строки нет, уже сказано в §4.2
    const info = label.value;
    const text = trimmedOf(info.value);
    if (field.key === 'vessel' || field.key === 'voyage') {
      const known = field.key === 'vessel' ? orderInfo.vessels : orderInfo.voyages;
      const list = [...known.values()];
      if (list.length === 0) {
        if (!text) push({ level: 'error', fix: 'customer', cell: info.address, field: field.label, message: 'не заполнено, а в поручении этого поля нет' });
      } else if (!known.has(normalizeLoose(text))) {
        if (list.length === 1) {
          push({
            level: 'error', fix: 'auto', cell: info.address, field: field.label, correction: list[0],
            message: text ? `в шаблоне «${text}», по поручению «${list[0]}»` : `не заполнено, по поручению «${list[0]}»`,
          });
          ctx.fixes.set(`head:${field.key}`, list[0]);
        } else {
          push({
            level: 'error', fix: 'customer', cell: info.address, field: field.label,
            message: `в шаблоне «${text}», а у загруженных поручений ${field.key === 'vessel' ? 'разные суда' : 'разные рейсы'}: ${list.map((v) => `«${v}»`).join(', ')}`,
          });
        }
      }
      continue;
    }
    if (field.kind === 'date') {
      const date = readDate(info.value, info.numFmt);
      dates[field.key] = date.parts;
      if (date.status === 'empty') push({ level: 'error', fix: 'customer', cell: info.address, field: field.label, message: 'не заполнено' });
      else if (date.status !== 'ok') ctx.form.push(dateKindFinding(model, info, field.label, date, null));
      continue;
    }
    if (!text) push({ level: 'error', fix: 'customer', cell: info.address, field: field.label, message: 'не заполнено' });
  }
  ctx.headerDates = dates;
  if (dates.arrivalDate && dates.departureDate && dayNumber(dates.arrivalDate) > dayNumber(dates.departureDate)) {
    for (const key of ['arrivalDate', 'departureDate']) {
      push({
        level: 'error', fix: 'customer', cell: model.labels.get(key).value.address, field: HEADER_FIELD_BY_KEY.get(key).label,
        message: `дата прихода ${formatDate(dates.arrivalDate)} позже даты выхода ${formatDate(dates.departureDate)}`,
      });
    }
  }
  for (const key of ['arrivalDate', 'departureDate']) {
    if (dates[key]) suspiciousDate(ctx, model, dates[key], model.labels.get(key).value.address, HEADER_FIELD_BY_KEY.get(key).label, null);
  }
}

// Строка шаблона находит своё поручение по контейнеру; номер в B — только
// подсказка, по которой выбирают между поручениями (§5).
function matchRow(row, ctx, notLoaded) {
  const candidates = ctx.orderInfo.byContainer.get(normalizeContainer(row.container)) || [];
  const orderText = trimmedOf(row.cells.orderNumber ? row.cells.orderNumber.value : null);
  const orderKey = normalizeOrderNumber(orderText);
  if (candidates.length === 1) return { entry: candidates[0].entry, container: candidates[0].container };
  if (candidates.length > 1) {
    const exact = candidates.find((c) => normalizeOrderNumber(c.entry.order.orderNumber) === orderKey);
    if (exact) return { entry: exact.entry, container: exact.container };
    return { ambiguous: candidates.map((c) => c.entry.order.orderNumber) };
  }
  if (orderKey && !ctx.orderInfo.byNumber.has(orderKey)) {
    notLoaded.set(orderText, (notLoaded.get(orderText) || 0) + 1);
    return { skip: true };
  }
  return {};
}

const CYRILLIC = /[А-Яа-яЁё]/;
const NOTIFY_SAME = /^(the\s+same|same\s+as\s+consignee)$/i;

function checkDataRows(model, ctx) {
  const { orderInfo } = ctx;
  const dataRows = model.rows.filter((row) => row.kind === 'data');
  const rowsByContainer = new Map();
  for (const row of dataRows) {
    const key = normalizeContainer(row.container);
    if (!rowsByContainer.has(key)) rowsByContainer.set(key, []);
    rowsByContainer.get(key).push(row);
  }
  ctx.matchedContainers = new Set([...rowsByContainer.keys()]);
  const notLoaded = new Map();
  let matched = 0;

  for (const row of dataRows) {
    const match = matchRow(row, ctx, notLoaded);
    if (match.container) matched += 1;
    checkRow(model, ctx, row, match, rowsByContainer);
  }

  for (const [number, count] of notLoaded) {
    ctx.topWarnings.push(`Поручение ${number} не загружено — ${count} ${plural(count, 'строка', 'строки', 'строк')} шаблона не ${plural(count, 'сверена', 'сверены', 'сверены')} с поручением`);
  }
  if (dataRows.length > 0 && matched === 0) {
    ctx.topWarnings.push('Похоже, загружено не то поручение: ни один контейнер шаблона не найден в загруженных поручениях');
  }
  if (orderInfo.vessels.size > 1) {
    ctx.topWarnings.push(`У загруженных поручений разные суда: ${[...orderInfo.vessels.values()].map((v) => `«${v}»`).join(', ')}`);
  }
  if (orderInfo.voyages.size > 1) {
    ctx.topWarnings.push(`У загруженных поручений разные рейсы: ${[...orderInfo.voyages.values()].map((v) => `«${v}»`).join(', ')}`);
  }
  checkBillGroups(model, ctx, dataRows);
}

function checkRow(model, ctx, row, match, rowsByContainer) {
  const container = match.container ? match.container.containerNumber : (row.container || null);
  const order = match.entry ? match.entry.order : null;
  const info = (key) => row.cells[key] || null;
  const valueOf = (key) => (row.cells[key] ? row.cells[key].value : null);
  const textOfKey = (key) => trimmedOf(valueOf(key));
  const push = (key, props) => ctx.data.push(finding({
    section: 'data', sheet: model.sheetName, cell: info(key) ? info(key).address : null,
    field: COLUMN_BY_KEY.get(key).header, container, ...props,
  }));
  const error = (key, fix, message, correction = null) => push(key, { level: 'error', fix, message, correction });
  const warn = (key, message) => ctx.warnings.push(finding({
    level: 'warning', section: 'data', sheet: model.sheetName, cell: info(key) ? info(key).address : null,
    field: COLUMN_BY_KEY.get(key).header, container, message,
  }));
  const requireFilled = (key) => { if (!textOfKey(key)) error(key, 'customer', 'не заполнено'); };
  // Числовая ячейка: 'auto' — вид правится сам (L, M, O), 'customer' — нет (K, N).
  const kindError = (key, fix, num) => ctx.form.push(finding({
    level: 'error', fix, section: 'form', sheet: model.sheetName, cell: info(key).address,
    field: COLUMN_BY_KEY.get(key).header, container,
    message: fix === 'auto'
      ? `число записано текстом («${textOfKey(key)}»)`
      : `число записано текстом («${textOfKey(key)}») — исправьте вручную или уточните у заказчика`,
    correction: fix === 'auto' ? formatNumber(num.number) : null,
  }));
  const setFix = (key, value) => { if (!KEEP_AS_IS_KEYS.has(key)) ctx.fixes.set(`row:${row.row}:${key}`, value); };
  const asText = (num) => (num.asText ? ', и записано текстом' : '');
  const weightCheck = (key, expected) => {
    const num = readNumber(valueOf(key));
    if (expected !== null && expected !== undefined) {
      if (!num.ok || Math.abs(num.number - expected) > TOLERANCE) {
        const shown = num.ok ? `в шаблоне ${formatNumber(num.number)}` : (num.empty ? 'не заполнено' : `«${textOfKey(key)}» не читается как число`);
        error(key, 'auto', `${shown}, по поручению ${formatNumber(expected)}${num.ok ? asText(num) : ''}`, formatNumber(expected));
        setFix(key, expected);
        return;
      }
      if (num.asText) { kindError(key, 'auto', num); setFix(key, num.number); }
      return;
    }
    if (!num.ok) error(key, 'customer', num.empty ? 'не заполнено' : `«${textOfKey(key)}» не читается как число`);
    else if (num.asText) { kindError(key, 'auto', num); setFix(key, num.number); }
  };

  for (const def of COLUMNS) {
    switch (def.key) {
      case 'orderNumber': {
        const text = textOfKey('orderNumber');
        if (match.ambiguous) {
          error('orderNumber', 'customer', `контейнер есть в поручениях ${match.ambiguous.map((n) => `№ ${n}`).join(', ')}, а в шаблоне указано «${text}» — уточните, к какому поручению относится строка`);
        } else if (order) {
          if (normalizeOrderNumber(text) !== normalizeOrderNumber(order.orderNumber)) {
            error('orderNumber', 'auto', text ? `в шаблоне «${text}», а контейнер стоит в поручении № ${order.orderNumber}` : `не заполнено, контейнер стоит в поручении № ${order.orderNumber}`, order.orderNumber);
            setFix('orderNumber', order.orderNumber);
          }
        } else requireFilled('orderNumber');
        break;
      }
      case 'billDate': {
        const cell = info('billDate');
        if (!cell) { error('billDate', 'customer', 'не заполнено'); break; }
        const date = readDate(cell.value, cell.numFmt);
        if (date.status === 'empty') error('billDate', 'customer', 'не заполнено');
        else if (date.status !== 'ok') ctx.form.push(dateKindFinding(model, cell, def.header, date, container));
        if (date.parts) {
          suspiciousDate(ctx, model, date.parts, cell.address, def.header, container);
          const arrival = ctx.headerDates ? ctx.headerDates.arrivalDate : null;
          if (arrival && dayNumber(date.parts) < dayNumber(arrival)) {
            warn('billDate', `дата коносамента ${formatDate(date.parts)} раньше даты прихода ${formatDate(arrival)}, проверьте`);
          }
        }
        break;
      }
      case 'container': {
        if (match.container) {
          if (row.container !== match.container.containerNumber) {
            error('container', 'auto', `номер записан как «${row.container}», в поручении — «${match.container.containerNumber}»`, match.container.containerNumber);
            setFix('container', match.container.containerNumber);
          }
        } else if (!match.skip && !match.ambiguous) {
          error('container', 'customer', 'контейнера нет ни в одном загруженном поручении');
        }
        const repeats = rowsByContainer.get(normalizeContainer(row.container)) || [];
        if (repeats.length > 1) {
          error('container', 'customer', `контейнер записан в шаблоне ${repeats.length} ${plural(repeats.length, 'раз', 'раза', 'раз')} (${plural(repeats.length, 'строка', 'строки', 'строки')} ${repeats.map((r) => r.row).join(', ')})`);
        }
        break;
      }
      case 'iso': {
        const text = textOfKey('iso');
        const expected = match.container ? match.container.isoCode : '';
        if (expected) {
          if (!sameIsoType(text, expected)) {
            error('iso', 'auto', text ? `в шаблоне «${text}», по поручению «${expected}» — это разные типы контейнера` : `не заполнено, по поручению «${expected}»`, expected);
            setFix('iso', expected);
          }
        } else requireFilled('iso');
        break;
      }
      case 'cargoNameEn': {
        const text = textOfKey('cargoNameEn');
        if (!text) error('cargoNameEn', 'customer', 'не заполнено');
        else if (CYRILLIC.test(text)) error('cargoNameEn', 'customer', `записано кириллицей («${text}») — нужно наименование по-английски`);
        break;
      }
      case 'seals': {
        const text = textOfKey('seals');
        const template = sealSet(text);
        if (match.container) {
          const expected = sealSet(match.container.sealNumber);
          if (expected.size === 0) {
            error('seals', 'customer', text ? `в шаблоне «${text}», а в поручении пломбы нет` : 'не заполнено, в поручении пломбы тоже нет');
          } else if (template.size !== expected.size || [...expected].some((seal) => !template.has(seal))) {
            error('seals', 'auto', text ? `в шаблоне «${text}», по поручению «${match.container.sealNumber}»` : `не заполнено, по поручению «${match.container.sealNumber}»`, match.container.sealNumber);
            setFix('seals', sealValue(match.container.sealNumber));
          }
        } else requireFilled('seals');
        break;
      }
      case 'packageType': {
        const text = textOfKey('packageType');
        if (!text) error('packageType', 'customer', 'не заполнено');
        else if (!/^[A-Z0-9]{2}$/.test(text)) warn('packageType', `«${text}» не похоже на код упаковки из двух знаков (PX, CS…), проверьте`);
        break;
      }
      case 'places': {
        const num = readNumber(valueOf('places'));
        const expected = match.container ? match.container.places : null;
        const goods = match.container ? match.container.goodsCount : 0;
        if (!num.ok) {
          error('places', 'customer', num.empty ? 'не заполнено' : `«${textOfKey('places')}» не читается как число`);
        } else if (expected !== null && Math.abs(num.number - expected) > TOLERANCE) {
          if (goods > 1) {
            warn('places', `в поручении по ${goods} ${plural(goods, 'товару', 'товарам', 'товарам')} ${formatNumber(expected)} ${plural(expected, 'место', 'места', 'мест')}, в шаблоне ${formatNumber(num.number)} — несколько товаров могли лежать в одном месте, проверьте${asText(num)}`);
          } else {
            error('places', 'customer', `в шаблоне ${formatNumber(num.number)}, по поручению ${formatNumber(expected)}${asText(num)}`);
          }
        } else if (num.asText) kindError('places', 'customer', num);
        break;
      }
      case 'cargoWeight': weightCheck('cargoWeight', match.container ? match.container.cargoWeight : null); break;
      case 'tareWeight': weightCheck('tareWeight', match.container ? match.container.tareWeight : null); break;
      case 'volume': {
        const num = readNumber(valueOf('volume'));
        if (!num.ok) error('volume', 'customer', num.empty ? 'не заполнено' : `«${textOfKey('volume')}» не читается как число`);
        else if (num.number <= 0) error('volume', 'customer', `объём ${formatNumber(num.number)} — должен быть больше нуля`);
        else if (num.asText) kindError('volume', 'customer', num);
        break;
      }
      case 'vgm': {
        const num = readNumber(valueOf('vgm'));
        const cargo = match.container ? match.container.cargoWeight : readNumber(valueOf('cargoWeight')).number;
        const tareRaw = match.container && match.container.tareWeight !== null
          ? match.container.tareWeight : readNumber(valueOf('tareWeight')).number;
        const sum = (cargo !== null && cargo !== undefined && tareRaw !== null && tareRaw !== undefined) ? cargo + tareRaw : null;
        const total = match.container ? match.container.totalWeight : null;
        const fixable = total !== null && total !== undefined && sum !== null && total >= sum - TOLERANCE;
        const tooSmall = num.ok && sum !== null && num.number < sum - TOLERANCE;
        if (!num.ok || tooSmall) {
          const shown = num.ok
            ? `в шаблоне ${formatNumber(num.number)}, а вес груза с тарой — ${formatNumber(sum)}`
            : (num.empty ? 'не заполнено' : `«${textOfKey('vgm')}» не читается как число`);
          if (fixable) {
            error('vgm', 'auto', `${shown}, по поручению ${formatNumber(total)}${num.ok ? asText(num) : ''}`, formatNumber(total));
            setFix('vgm', total);
          } else {
            error('vgm', 'customer', sum !== null ? `${shown} (ВГМ не может быть меньше веса груза с весом контейнера)` : shown);
          }
        } else if (num.asText) { kindError('vgm', 'auto', num); setFix('vgm', num.number); }
        break;
      }
      case 'shipper': case 'consignee': case 'notify': {
        const text = textOfKey(def.key);
        if (!text) { error(def.key, 'customer', 'не заполнено'); break; }
        if (!order) break;
        const sources = def.key === 'shipper' ? [order.shipper, order.shipperEn]
          : (def.key === 'consignee' ? [order.consignee, order.consigneeEn] : [order.notify]);
        const known = sources.filter(Boolean).map(normalizeName);
        if (known.length === 0) break;
        if (def.key === 'notify' && (NOTIFY_SAME.test(text) || normalizeName(text) === normalizeName(textOfKey('consignee')))) break;
        const name = normalizeName(text);
        if (name && !known.some((source) => source.includes(name))) {
          warn(def.key, `«${text}» не нашлось в поручении — проверьте, то же ли это лицо (в поручении оно может быть записано на другом языке)`);
        }
        break;
      }
      case 'temperature': {
        const iso = textOfKey('iso') || (match.container ? match.container.isoCode : '');
        if (!textOfKey('temperature') && isReefer(iso)) warn('temperature', `контейнер рефрижераторный («${iso}»), а температура не указана`);
        break;
      }
      case 'dangerClasses': {
        const text = textOfKey('dangerClasses');
        const dangerous = match.container ? [...match.container.dangerousGoods] : [];
        if (dangerous.length === 0) {
          if (text && match.container) warn('dangerClasses', `в поручении опасных грузов нет, а здесь написано «${text}» — проверьте`);
          break;
        }
        if (!text) { error('dangerClasses', 'customer', `в поручении есть опасный груз (${dangerous.join(', ')}), а колонка не заполнена`); break; }
        const numbers = new Set((text.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(',', '.')));
        const missing = dangerous.filter((pair) => pair.split('|').some((part) => !numbers.has(part.trim())));
        if (missing.length) {
          error('dangerClasses', 'customer', `в шаблоне «${text}», а по поручению должны быть класс и номер UN: ${missing.join(', ')}`);
        }
        break;
      }
      case 'locSoc': {
        const owner = match.container ? trimmedOf(match.container.owner).toUpperCase() : '';
        if (owner !== 'SOC' && owner !== 'LOC') break;
        const text = textOfKey('locSoc').toUpperCase();
        if (text !== owner) {
          error('locSoc', 'auto', text ? `в шаблоне «${textOfKey('locSoc')}», по поручению «${owner}»` : `не заполнено, по поручению «${owner}»`, owner);
          setFix('locSoc', owner);
        }
        break;
      }
      // A, F, H, Q, S, U: с поручением не сравниваются (spec «Вне рамок») —
      // проверяется только, что поле заполнено. X, Y не проверяются вообще.
      default:
        if (def.required) requireFilled(def.key);
        break;
    }
  }
}

// Пломба в эталонной форме: число, если это одни цифры без ведущего нуля (§3).
const sealValue = (text) => (/^[1-9]\d*$/.test(String(text ?? '').trim()) ? Number(String(text).trim()) : String(text ?? '').trim());

// A07/G03: у строк одного коносамента общие поля должны совпадать — расхождение
// не исправляется автоматически (нельзя знать, какая из строк верна, а какая
// испорчена, например протянута в Excel формулой или копированием строки).
// Находка — на каждой расходящейся строке, не только на первой встреченной.
function checkBillGroups(model, ctx, dataRows) {
  const keys = ['billDate', 'dischargeTerminal', 'shipper', 'shipperAddress', 'consignee', 'consigneeAddress', 'notify', 'notifyAddress'];
  const firstByBill = new Map();
  for (const row of dataRows) {
    const bill = normalizeLoose(trimmedOf(row.cells.billOfLading ? row.cells.billOfLading.value : null));
    if (!bill) continue;
    const first = firstByBill.get(bill);
    if (!first) { firstByBill.set(bill, row); continue; }
    for (const key of keys) {
      if (!row.cells[key]) continue;
      const here = normalizeLoose(trimmedOf(row.cells[key].value));
      const there = normalizeLoose(trimmedOf(first.cells[key].value));
      if (here === there) continue;
      ctx.data.push(finding({
        level: 'error', fix: 'customer', section: 'data', sheet: model.sheetName, cell: row.cells[key].address,
        field: COLUMN_BY_KEY.get(key).header, container: row.container || null,
        message: `у коносамента ${trimmedOf(row.cells.billOfLading.value)} в строке ${first.row} здесь «${trimmedOf(first.cells[key].value)}», а в этой строке «${trimmedOf(row.cells[key].value)}» — общие поля коносамента должны совпадать`,
      }));
    }
  }
}

function checkMissingContainers(model, ctx) {
  const reported = new Set();
  for (const entry of ctx.orderInfo.parsed) {
    for (const container of entry.order.containers) {
      const key = normalizeContainer(container.containerNumber);
      if ((ctx.matchedContainers && ctx.matchedContainers.has(key)) || reported.has(key)) continue;
      reported.add(key);
      ctx.missing.push(finding({
        level: 'error', fix: 'customer', section: 'data', sheet: model.sheetName,
        field: COLUMN_BY_KEY.get('container').header, container: container.containerNumber,
        message: `контейнер есть в поручении № ${entry.order.orderNumber}, но в шаблоне его нет`,
      }));
    }
  }
}
/* ——— результат 1: книга заказчика с пометками (spec §5.5) ——— */

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

function noteLine(f) {
  if (f.level === 'warning') return `Проверьте: ${f.message}`;
  if (f.fix === 'auto') return `Ошибка: ${f.message}${f.correction ? ` → ${f.correction}` : ''}. Исправлю сам.`;
  return `Ошибка: ${f.message}. Уточнить у заказчика.`;
}

function buildMarkedWorkbook(workbook, model, findings, ctx) {
  const notes = new Map();
  const painted = new Set();
  const warned = new Set();
  for (const f of findings) {
    if (!f.cell) continue;
    if (!notes.has(f.cell)) notes.set(f.cell, []);
    notes.get(f.cell).push(noteLine(f));
    if (f.level === 'error') painted.add(f.cell);
    else if (f.level === 'warning') warned.add(f.cell);
  }
  for (const [address, lines] of notes) {
    const cell = model.sheet.getCell(address);
    const previous = noteTextOf(cell);
    cell.note = previous ? `${previous}\n${lines.join('\n')}` : lines.join('\n');
  }
  const paint = (address, argb) => {
    const cell = model.sheet.getCell(address);
    const style = cloneStyle(cell.style);
    style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    cell.style = style;
  };
  for (const address of painted) paint(address, YELLOW_ARGB);
  // Предупреждение — голубым; ошибка на той же ячейке (по другому правилу) важнее
  // и уже покрашена жёлтым выше — не перекрашиваем её обратно.
  for (const address of warned) if (!painted.has(address)) paint(address, BLUE_ARGB);
  for (const sheet of ctx.yellowTabs) sheet.properties.tabColor = { argb: YELLOW_ARGB };
  // ExcelJS 4.4.0 не умеет записать часть правил условного форматирования и
  // делает файл нечитаемым для Excel (CLAUDE.md) — убираем такие правила.
  for (const sheet of workbook.worksheets) dropUnwritableConditionalFormatting(sheet);
  return workbook;
}

/* ——— результат 2: исправленный шаблон по эталонной форме (spec §3, §4) ——— */

const thinBorder = () => ({
  top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' },
});

function buildCorrectedWorkbook(model, ctx, createWorkbook) {
  const workbook = createWorkbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  COLUMNS.forEach((def, index) => { sheet.getColumn(index + 1).width = def.width; });

  for (const field of HEADER_FIELDS) {
    sheet.getRow(field.row).height = HEADER_ROW_HEIGHT;
    const labelCell = sheet.getCell(`${HEADER_LABEL_COLUMN}${field.row}`);
    labelCell.value = field.label;
    labelCell.font = { ...FONTS.headerLabel };
    labelCell.alignment = { horizontal: 'right', vertical: 'middle' };
    const valueCell = sheet.getCell(`${HEADER_VALUE_COLUMN}${field.row}`);
    const fixed = ctx.fixes.get(`head:${field.key}`);
    const source = model.labels.get(field.key);
    if (fixed !== undefined) valueCell.value = fixed;
    else if (source && source.value.value !== null) valueCell.value = source.value.value;
    valueCell.font = { ...FONTS.headerValue };
    valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
    applyFormat(valueCell, field.kind === 'date', source ? source.value.numFmt : null);
  }
  const noteCell = sheet.getCell(NOTE_CELL);
  noteCell.value = NOTE_TEXT;
  noteCell.font = { ...FONTS.note };

  COLUMNS.forEach((def, index) => {
    const cell = sheet.getRow(COLUMN_HEADER_ROW).getCell(index + 1);
    cell.value = def.header;
    cell.font = { ...FONTS.columnHeader };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder();
  });

  let target = DATA_START_ROW;
  for (const row of model.rows) {
    if (row.kind === 'blank' || row.kind === 'total') continue; // пустые строки и «итого» не переносятся
    const line = sheet.getRow(target);
    line.height = DATA_ROW_HEIGHT;
    COLUMNS.forEach((def, index) => {
      const cell = line.getCell(index + 1);
      const fixed = ctx.fixes.get(`row:${row.row}:${def.key}`);
      const source = row.cells[def.key] || null;
      // Формула уходит своим значением, ячейка объединения — значением главной
      // (его и отдаёт ExcelJS), всё прочее — ровно как у заказчика.
      if (fixed !== undefined) cell.value = fixed;
      else if (source && source.value !== null) cell.value = source.value;
      cell.font = { ...FONTS.data };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: def.wrap };
      cell.border = thinBorder();
      applyFormat(cell, def.kind === 'text' || def.kind === 'date', source ? source.numFmt : null);
    });
    target += 1;
  }
  return workbook;
}

// Формат: у даты Excel — тот, что был у заказчика (иначе она показалась бы
// числом), у текстовых колонок — «@», у чисел — общий.
function applyFormat(cell, isTextual, sourceFormat) {
  if (cell.value instanceof Date) cell.numFmt = sourceFormat || 'dd.mm.yyyy';
  else if (isTextual && typeof cell.value !== 'number') cell.numFmt = TEXT_FORMAT;
}

/* ——— результат 3: текст отчёта (spec §7) ——— */

function formatDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const containersText = (n) => `${n} ${plural(n, 'контейнер', 'контейнера', 'контейнеров')}`;
const sentence = (text) => (/[.!?]$/.test(text) ? text : `${text}.`);

function reportLine(f) {
  if (f.field === 'Лист') return `Лист «${f.sheet}»${f.correction ? ` → ${f.correction}` : `: ${f.message}`}`;
  const head = [f.cell, f.field, f.container ? `контейнер ${f.container}` : null].filter(Boolean).join(', ');
  const body = `${f.message}${f.correction ? ` → ${f.correction}` : ''}`;
  return head ? `${head}: ${body}` : body;
}

function buildReportText({ model, ctx, findings, summary, fileNames, templateFileName, checkedAt, parsed }) {
  const headerValue = (key) => {
    const label = model.labels.get(key);
    return label ? trimmedOf(label.value.value) : '';
  };
  const firstOf = (map) => (map.size ? [...map.values()][0] : '');
  const lines = [
    'ПРОВЕРКА ШАБЛОНА ЭЛ. ПОРУЧЕНИЯ',
    `Проверено: ${formatDateTime(checkedAt)}`,
    `Шаблон: ${templateFileName} (лист «${model.sheetName}», ${containersText(summary.containers)})`,
    ...parsed.map((entry) => `Поручение: ${entry.fileName} — № ${entry.order.orderNumber}`
      + `${entry.order.date ? ` от ${entry.order.date}` : ''}, ${containersText(entry.order.containers.length)}`),
    `Судно / рейс: ${headerValue('vessel') || firstOf(ctx.orderInfo.vessels) || '—'}`
      + ` / ${headerValue('voyage') || firstOf(ctx.orderInfo.voyages) || '—'}`,
    '',
  ];
  if (summary.errors === 0 && summary.warnings === 0) {
    lines.push('Ошибок и предупреждений нет — шаблон соответствует форме и поручению.', '');
    return lines.join('\r\n');
  }
  lines.push(`ИТОГ: ошибок — ${summary.errors} (исправлено автоматически — ${summary.autoFixable},`
    + ` уточнить у заказчика — ${summary.needsCustomer}), предупреждений — ${summary.warnings}.`);
  const section = (title, items) => {
    if (items.length === 0) return;
    lines.push('', title, ...items.map((text, index) => `${index + 1}. ${sentence(text)}`));
  };
  const errorsWith = (fix) => findings.filter((f) => f.level === 'error' && f.fix === fix).map(reportLine);
  section(`УТОЧНИТЬ У ЗАКАЗЧИКА — ${summary.needsCustomer}`, errorsWith('customer'));
  section(`ИСПРАВЛЕНО АВТОМАТИЧЕСКИ — ${summary.autoFixable} (уже внесено в «${fileNames.corrected}»)`, errorsWith('auto'));
  // Предупреждения «вверху» — первыми: они про весь файл, а не про ячейку.
  section(`ПРЕДУПРЕЖДЕНИЯ — ПРОВЕРЬТЕ САМИ — ${summary.warnings}`,
    [...ctx.topWarnings, ...findings.filter((f) => f.level === 'warning').map(reportLine)]);
  lines.push('');
  return lines.join('\r\n');
}
