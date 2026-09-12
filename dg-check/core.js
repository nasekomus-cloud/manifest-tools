// Логика сверки опасных грузов. Чистые функции от книг ExcelJS и примитивов —
// без DOM и без сети (см. interfaces.md / spec.md, границы и швы).
//
// Комбинированный (сводный) файл всегда соответствует формату из
// lib/manifest-format.js (лист "Manifest", заголовки в строке COLUMN_HEADER_ROW,
// данные с DATA_START_ROW, колонки FIRST_COLUMN..LAST_COLUMN) — эти константы
// переиспользуются, а не дублируются. DG-манифест — отдельный официальный
// документ произвольной раскладки, поэтому его строка заголовков и границы
// колонок определяются поиском по тексту заголовка, без фиксированной позиции.

import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
} from '../lib/manifest-format.js?v=202609121930';

const NEW_COLUMN_HEADER = 'Опасные грузы (сверка с DG-манифестом)';
const YELLOW_ARGB = 'FFFFFF00';

function cellText(cell) {
  if (!cell) return '';
  // Объединённая ячейка с пустым мастером бросает исключение при чтении .text
  // (ExcelJS MergeValue.toString зовёт value.toString() на null) — это
  // случается в реальных файлах с шапками из объединённых ячеек.
  try {
    const value = cell.text;
    if (value === undefined || value === null) return '';
    return String(value).trim();
  } catch {
    return '';
  }
}

function findColumnByKeyword(row, colStart, colEnd, keywords) {
  const needles = (Array.isArray(keywords) ? keywords : [keywords]).map((k) => k.toLowerCase());
  for (let col = colStart; col <= colEnd; col++) {
    const text = cellText(row.getCell(col)).toLowerCase();
    if (needles.some((needle) => text.includes(needle))) {
      return col;
    }
  }
  return null;
}

function findCombinedColumns(sheet) {
  const row = sheet.getRow(COLUMN_HEADER_ROW);
  const containerCol = findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'контейнер');
  const dangerousCol = findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'опасн');

  const missing = [];
  if (!containerCol) missing.push('«Номер контейнера»');
  if (!dangerousCol) missing.push('«Опасные грузы»');
  if (missing.length) {
    return {
      ok: false,
      error: `В сводном файле не найден заголовок ${missing.join(', ')}`,
    };
  }
  return { ok: true, containerCol, dangerousCol };
}

const DG_SPECS = [
  // DG-манифест — официальный международный документ, заголовки обычно
  // на английском (например, «CNTR No.», «UN No.», «CLS(Sub)»), но встречаются
  // и русские варианты — проверяем оба.
  { key: 'container', keyword: ['контейнер', 'cntr', 'container'], label: '«Номер контейнера»' },
  { key: 'un', keyword: ['un'], label: '«UN»' },
  { key: 'class', keyword: ['класс', 'cls', 'class'], label: '«Класс»' },
];

function findDgColumns(sheet) {
  const maxRow = sheet.rowCount;

  for (let r = 1; r <= maxRow; r++) {
    const row = sheet.getRow(r);
    const maxCol = row.cellCount;
    if (!maxCol) continue;

    const columns = {};
    for (const spec of DG_SPECS) {
      const col = findColumnByKeyword(row, 1, maxCol, spec.keyword);
      if (col) columns[spec.key] = col;
    }
    if (Object.keys(columns).length === DG_SPECS.length) {
      return { ok: true, headerRow: r, columns };
    }
  }

  // Ни одна строка не содержит все заголовки сразу — сообщаем, какого не хватает вообще.
  for (const spec of DG_SPECS) {
    let foundAnywhere = false;
    for (let r = 1; r <= maxRow && !foundAnywhere; r++) {
      const row = sheet.getRow(r);
      const maxCol = row.cellCount;
      if (!maxCol) continue;
      if (findColumnByKeyword(row, 1, maxCol, spec.keyword)) foundAnywhere = true;
    }
    if (!foundAnywhere) {
      return { ok: false, error: `В DG-манифесте не найден заголовок ${spec.label}` };
    }
  }
  return { ok: false, error: 'В DG-манифесте не удалось найти строку заголовков' };
}

// ExcelJS отдаёт одну и ту же ссылку на объект стиля многим ячейкам сразу,
// если в исходном файле у них совпадал индекс стиля (обычная ситуация для
// файлов из Excel — сотни ячеек с одинаковым оформлением реально делят один
// объект). Присвоение `cell.fill = ...` меняет этот общий объект на месте —
// и заливка «утекает» на все остальные ячейки, которые случайно делили тот
// же стиль, даже в других, не расходящихся строках. Поэтому перед покраской
// стиль клонируется в новый независимый объект.
function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function normalizeContainer(text) {
  return text.trim().toUpperCase();
}

// Существующая колонка «Опасные грузы» пишется людьми/другими скриптами и
// не придерживается одного текстового формата: разделители между записями —
// то «;\r», то « / »; несколько UN-номеров одного класса на один контейнер
// иногда объединяют через запятую в одной записи («IMO 9 UN 3077,3082»)
// вместо повтора «IMO 9 UN ...» на каждый номер. Сравнивать тексты дословно
// нельзя — это даёт расхождение почти на каждой строке при полностью
// одинаковых данных. Поэтому обе стороны разбираются в набор пар «класс|UN»
// и сравниваются как множества, без учёта порядка, разделителей и группировки.
function parseDangerousGoodsEntries(text) {
  if (!text) return [];
  const entries = [];
  const re = /IMO\s*([\d.]+)\s*UN\s*(\d+(?:\s*,\s*\d+)*)/gi;
  let match;
  while ((match = re.exec(text))) {
    const cls = match[1].trim();
    const numbers = match[2].split(',').map((n) => n.trim()).filter(Boolean);
    for (const un of numbers) entries.push(`${cls}|${un}`);
  }
  return entries;
}

function sameDangerousGoods(oldText, newText) {
  const a = new Set(parseDangerousGoodsEntries(oldText));
  const b = new Set(parseDangerousGoodsEntries(newText));
  if (a.size !== b.size) return false;
  for (const entry of a) {
    if (!b.has(entry)) return false;
  }
  return true;
}

/**
 * Сверяет данные об опасных грузах сводного файла с официальным DG-манифестом
 * по номеру контейнера и дописывает в сводный файл столбец с итогом сверки.
 *
 * @param {import('exceljs').Workbook} combinedWb — сводный файл (формат Manifest)
 * @param {import('exceljs').Workbook} dgWb — DG-манифест (произвольная раскладка)
 * @returns {{ok: true, resultWorkbook: import('exceljs').Workbook, summary: {mismatchCount: number, notFoundInSummaryCount: number}} | {ok: false, error: string}}
 */
export function crossCheckDangerousGoods(combinedWb, dgWb) {
  const combinedSheet = combinedWb.getWorksheet(SHEET_NAME);
  if (!combinedSheet) {
    return { ok: false, error: `В сводном файле не найден лист "${SHEET_NAME}"` };
  }

  const dgSheet = dgWb.worksheets[0];
  if (!dgSheet) {
    return { ok: false, error: 'В DG-манифесте нет ни одного листа' };
  }

  const combinedCols = findCombinedColumns(combinedSheet);
  if (!combinedCols.ok) return combinedCols;

  const dgInfo = findDgColumns(dgSheet);
  if (!dgInfo.ok) return dgInfo;

  // Группируем позиции DG-манифеста по контейнеру, в порядке появления строк.
  const dgMap = new Map(); // normalizedContainer -> string[]
  const dgOrder = [];
  for (let r = dgInfo.headerRow + 1; r <= dgSheet.rowCount; r++) {
    const row = dgSheet.getRow(r);
    const containerText = cellText(row.getCell(dgInfo.columns.container));
    if (!containerText) continue;

    const key = normalizeContainer(containerText);
    const cls = cellText(row.getCell(dgInfo.columns.class));
    const un = cellText(row.getCell(dgInfo.columns.un));

    if (!dgMap.has(key)) {
      dgMap.set(key, []);
      dgOrder.push(key);
    }
    dgMap.get(key).push(`IMO ${cls} UN ${un}`);
  }

  const newCol = LAST_COLUMN + 1;
  combinedSheet.getRow(COLUMN_HEADER_ROW).getCell(newCol).value = NEW_COLUMN_HEADER;

  const foundContainers = new Set();
  let mismatchCount = 0;

  for (let r = DATA_START_ROW; r <= combinedSheet.rowCount; r++) {
    const row = combinedSheet.getRow(r);
    const containerText = cellText(row.getCell(combinedCols.containerCol));
    const key = containerText ? normalizeContainer(containerText) : null;

    let newValue = '';
    if (key && dgMap.has(key)) {
      foundContainers.add(key);
      newValue = dgMap.get(key).join(' / ');
    }

    const oldValue = cellText(row.getCell(combinedCols.dangerousCol));
    row.getCell(newCol).value = newValue || null;

    if (!sameDangerousGoods(oldValue, newValue)) {
      mismatchCount += 1;
      for (let c = FIRST_COLUMN; c <= newCol; c++) {
        const cell = row.getCell(c);
        const style = cloneStyle(cell.style);
        style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_ARGB } };
        cell.style = style;
      }
    }
  }

  const notFoundInSummaryCount = dgOrder.filter((key) => !foundContainers.has(key)).length;

  return {
    ok: true,
    resultWorkbook: combinedWb,
    summary: { mismatchCount, notFoundInSummaryCount },
  };
}
