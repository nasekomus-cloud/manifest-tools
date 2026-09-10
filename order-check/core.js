// Логика сверки сводного манифеста с поручениями на погрузку. Чистые функции
// от книг ExcelJS и примитивов — без DOM и без сети (см. interfaces.md / spec.md,
// границы и швы).
//
// Сводный файл всегда соответствует формату из lib/manifest-format.js (лист
// "Manifest", заголовки в строке COLUMN_HEADER_ROW, данные с DATA_START_ROW,
// колонки FIRST_COLUMN..LAST_COLUMN). Поручение — отдельный документ, который
// генерирует система клиента: раскладка колонок в нём стабильна между файлами,
// но их точную позицию всё равно не фиксируем — ищем по заголовку, как и везде
// на сайте.

import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
} from '../lib/manifest-format.js?v=202609101357';

const NEW_COLUMN_HEADER = 'Несовпадения';
const YELLOW_ARGB = 'FFFFFF00';
const WEIGHT_EPSILON = 0.01;

// ExcelJS 4.4.0 умеет ЧИТАТЬ условное форматирование любого типа, но при
// записи поддерживает только эти — остальные (например, «duplicateValues»,
// которое реально встретилось в файле пользователя, подсветка повторов в
// колонке «Футность») молча пишутся как пустой <conditionalFormatting/> без
// правила внутри: это невалидно по схеме OOXML, и Excel показывает диалог
// «восстановить или удалить нечитаемое содержимое». Баг воспроизводится даже
// на чистой загрузке-сохранении без единой нашей правки (проверено). Раз
// библиотека не может записать такое правило корректно, безопаснее вообще
// убрать его из результата, чем отдать пользователю файл, который Excel
// считает повреждённым — сама подсветка дублей это лишь оформление, не данные.
const WRITABLE_CF_TYPES = new Set([
  'expression', 'cellIs', 'top10', 'aboveAverage',
  'dataBar', 'colorScale', 'iconSet', 'containsText', 'timePeriod',
]);

function dropUnwritableConditionalFormatting(sheet) {
  const kept = sheet.conditionalFormattings
    .map((cf) => ({ ...cf, rules: cf.rules.filter((rule) => WRITABLE_CF_TYPES.has(rule.type)) }))
    .filter((cf) => cf.rules.length > 0);
  sheet.conditionalFormattings = kept;
}

// Слова, которыми в поручении помечают строку с весом упаковочных поддонов/палет,
// а не самого груза (см. spec «Решения по реализации» §7 — в брифе названы оба
// слова, «поддоны» и «палеты», в данных пользователя встретилось только первое).
// Сравнение точное (после trim/toLowerCase), не по вхождению подстроки — иначе
// под исключение случайно попала бы настоящая позиция груза вроде «поддон
// анализатора ситового» (реальный случай).
const PALLET_CARGO_NAMES = new Set([
  'поддоны', 'поддон', 'палеты', 'палета', 'паллеты', 'паллета',
]);

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

function cellNumber(cell) {
  if (!cell) return null;
  let value = cell.value;
  if (value && typeof value === 'object' && 'result' in value) value = value.result;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function findColumnByKeyword(row, colStart, colEnd, keyword) {
  const needle = keyword.toLowerCase();
  for (let col = colStart; col <= colEnd; col++) {
    if (cellText(row.getCell(col)).toLowerCase().includes(needle)) return col;
  }
  return null;
}

// ExcelJS отдаёт один и тот же объект стиля многим ячейкам сразу, если в
// исходном файле у них совпадал индекс стиля — присвоение cell.fill = ...
// напрямую покрасило бы жёлтым все ячейки, случайно делящие тот же стиль
// (см. CLAUDE.md, «Подводные камни» — тот же приём уже в dg-check/merge).
function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function normalizeText(text) {
  return text.trim().toUpperCase();
}

// Номер поручения в столбце свода иногда несёт лишние пробелы/переносы строк
// (похоже на артефакт копирования) — сопоставление всё равно должно сработать.
function normalizeOrderNumber(text) {
  return text.replace(/[\r\n]+/g, '').replace(/\s+/g, ' ').trim();
}

function parseValueSet(text) {
  if (!text) return [];
  return text
    .split(/[,;]/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function sameValueSet(a, b) {
  const setA = new Set(parseValueSet(a));
  const setB = new Set(parseValueSet(b));
  if (setA.size !== setB.size) return false;
  for (const value of setA) if (!setB.has(value)) return false;
  return true;
}

// Тот же приём разбора «класс|UN», что в dg-check/core.js — переиспользовать
// оттуда нечего (ничего не экспортируется), поэтому логика продублирована
// здесь сознательно, как и остальные core.js на сайте самодостаточны.
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

function sameDangerousGoods(summarySet, orderSet) {
  if (summarySet.size !== orderSet.size) return false;
  for (const entry of summarySet) if (!orderSet.has(entry)) return false;
  return true;
}

function findSummaryColumns(sheet) {
  const row = sheet.getRow(COLUMN_HEADER_ROW);
  const columns = {
    container: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'контейнера'),
    futnost: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'футность'),
    cargoWeight: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'груза'),
    tareWeight: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'тары'),
    totalWeight: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'общий'),
    seals: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'пломбы'),
    dangerous: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'опасн'),
    orderNumber: findColumnByKeyword(row, FIRST_COLUMN, LAST_COLUMN, 'поручения'),
  };

  const labels = {
    container: '«№ контейнера»',
    futnost: '«Футность»',
    cargoWeight: '«Веc груза»',
    tareWeight: '«Веc тары»',
    totalWeight: '«Общий Веc»',
    seals: '«Пломбы»',
    dangerous: '«Опасные грузы»',
    orderNumber: '«№ поручения»',
  };
  const missing = Object.keys(columns).filter((key) => !columns[key]).map((key) => labels[key]);
  if (missing.length) {
    return { ok: false, error: `В сводном файле не найден заголовок ${missing.join(', ')}` };
  }
  return { ok: true, columns };
}

// Заголовки поручения ищутся точным совпадением текста (после trim), а не
// вхождением подстроки: «Брутто груза» — подстрока заголовка «Брутто груза
// с весом контейнера», нестрогий поиск задел бы не ту колонку.
const ORDER_HEADERS = {
  container: 'номер контейнера',
  iso: 'код исо',
  seal: 'номер пломбы',
  cargoName: 'наименование груза, род упаковки',
  hazardClass: 'класс опасности',
  hazardCode: 'код опасности',
  grossWeight: 'брутто груза',
  tareWeight: 'вес контейнера',
};
const ORDER_FOOTER_MARKER = 'дополнительные сведения';

function findOrderHeaderRow(sheet) {
  const maxRow = Math.min(sheet.rowCount, 20);
  for (let r = 1; r <= maxRow; r++) {
    if (cellText(sheet.getRow(r).getCell(1)).toLowerCase() === ORDER_HEADERS.container) return r;
  }
  return null;
}

function findOrderColumns(sheet, headerRow) {
  const row = sheet.getRow(headerRow);
  const maxCol = row.cellCount || 20;
  const columns = {};
  for (const [key, label] of Object.entries(ORDER_HEADERS)) {
    for (let col = 1; col <= maxCol; col++) {
      if (cellText(row.getCell(col)).toLowerCase() === label) {
        columns[key] = col;
        break;
      }
    }
  }
  return columns;
}

function findOrderNumber(sheet) {
  for (let r = 1; r <= Math.min(sheet.rowCount, 5); r++) {
    for (let c = 1; c <= (sheet.getRow(r).cellCount || 10); c++) {
      if (cellText(sheet.getRow(r).getCell(c)).toLowerCase() === 'номер поручения') {
        return cellText(sheet.getRow(r).getCell(c + 1));
      }
    }
  }
  return null;
}

/**
 * Разбирает один поручение в набор контейнеров с агрегированными по группе
 * строк данными (см. spec «Решения по реализации» §6, §7, §8).
 *
 * @returns {{ok:true, orderNumber:string, containers:Map<string,object>} | {ok:false, error:string}}
 */
function parseOrderWorkbook(workbook, fileName) {
  const sheet = workbook.worksheets[0];
  if (!sheet) return { ok: false, error: `Файл «${fileName}»: нет ни одного листа` };

  const orderNumber = findOrderNumber(sheet);
  if (!orderNumber) {
    return { ok: false, error: `Файл «${fileName}»: не найден номер поручения` };
  }

  const headerRow = findOrderHeaderRow(sheet);
  if (!headerRow) {
    return { ok: false, error: `Файл «${fileName}»: не найден заголовок «Номер контейнера»` };
  }
  const cols = findOrderColumns(sheet, headerRow);
  if (!cols.container || !cols.grossWeight || !cols.tareWeight) {
    return { ok: false, error: `Файл «${fileName}»: не найдены обязательные колонки таблицы контейнеров` };
  }

  const containers = new Map();
  let current = null;

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const containerNum = cellText(row.getCell(cols.container));
    const cargoName = cols.cargoName ? cellText(row.getCell(cols.cargoName)) : '';

    if (containerNum.toLowerCase() === ORDER_FOOTER_MARKER) {
      current = null;
      continue;
    }

    if (containerNum) {
      current = {
        containerNum,
        isoCode: cols.iso ? cellText(row.getCell(cols.iso)) : '',
        sealNumber: cols.seal ? cellText(row.getCell(cols.seal)) : '',
        tareWeight: cellNumber(row.getCell(cols.tareWeight)),
        cargoWeight: 0,
        dangerousGoods: new Set(),
      };
      containers.set(containerNum, current);
    }
    if (!current) continue;

    const isPallet = PALLET_CARGO_NAMES.has(cargoName.trim().toLowerCase());
    const brutto = cellNumber(row.getCell(cols.grossWeight)) || 0;
    if (!isPallet) current.cargoWeight += brutto;

    if (cols.hazardClass && cols.hazardCode) {
      const cls = cellText(row.getCell(cols.hazardClass));
      const codeText = cellText(row.getCell(cols.hazardCode));
      if (cls && codeText) {
        for (const un of codeText.split(',').map((n) => n.trim()).filter(Boolean)) {
          current.dangerousGoods.add(`${cls}|${un}`);
        }
      }
    }
  }

  return { ok: true, orderNumber, containers };
}

/**
 * Сверяет сводный файл манифеста с поручениями на погрузку по номеру
 * контейнера и дописывает столбец с расхождениями.
 *
 * @param {import('exceljs').Workbook} combinedWb — сводный файл (формат Manifest)
 * @param {Array<{fileName: string, workbook: import('exceljs').Workbook}>} orderEntries — поручения
 * @returns {{ok:true, resultWorkbook: import('exceljs').Workbook, summary: object, warnings: string[]} | {ok:false, error:string}}
 */
export function crossCheckOrders(combinedWb, orderEntries) {
  const combinedSheet = combinedWb.getWorksheet(SHEET_NAME);
  if (!combinedSheet) {
    return { ok: false, error: `В сводном файле не найден лист "${SHEET_NAME}"` };
  }
  const summaryCols = findSummaryColumns(combinedSheet);
  if (!summaryCols.ok) return summaryCols;
  const cols = summaryCols.columns;

  if (!Array.isArray(orderEntries) || orderEntries.length === 0) {
    return { ok: false, error: 'Не выбрано ни одного поручения на погрузку' };
  }

  // key = `${номер поручения}::${номер контейнера}` -> запись контейнера
  const index = new Map();
  const containerToOrders = new Map(); // номер контейнера -> [номер поручения,...]
  const warnings = [];

  for (const { fileName, workbook } of orderEntries) {
    const parsed = parseOrderWorkbook(workbook, fileName);
    if (!parsed.ok) {
      warnings.push(parsed.error);
      continue;
    }
    for (const [containerNum, entry] of parsed.containers) {
      const key = `${parsed.orderNumber}::${containerNum}`;
      index.set(key, entry);
      if (!containerToOrders.has(containerNum)) containerToOrders.set(containerNum, []);
      containerToOrders.get(containerNum).push(parsed.orderNumber);
    }
  }

  // Соответствие «код ISO → футность» — по большинству среди совпавших по
  // ключу (поручение, контейнер) строк текущей загрузки, не зашито заранее.
  const isoFrequency = new Map(); // isoCode -> Map<футность, count>
  for (let r = DATA_START_ROW; r <= combinedSheet.rowCount; r++) {
    const row = combinedSheet.getRow(r);
    const containerNum = cellText(row.getCell(cols.container));
    if (!containerNum) continue;
    const orderNumber = normalizeOrderNumber(cellText(row.getCell(cols.orderNumber)));
    const entry = index.get(`${orderNumber}::${containerNum}`);
    if (!entry || !entry.isoCode) continue;
    if (!isoFrequency.has(entry.isoCode)) isoFrequency.set(entry.isoCode, new Map());
    const freq = isoFrequency.get(entry.isoCode);
    const futnost = cellText(row.getCell(cols.futnost));
    freq.set(futnost, (freq.get(futnost) || 0) + 1);
  }
  const isoToFutnost = new Map();
  for (const [iso, freq] of isoFrequency) {
    const [topFutnost] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    isoToFutnost.set(iso, topFutnost);
  }

  const newCol = LAST_COLUMN + 1;
  combinedSheet.getRow(COLUMN_HEADER_ROW).getCell(newCol).value = NEW_COLUMN_HEADER;
  // Ширина остальных колонок (C..Y) сохраняется сама — ExcelJS хранит её в
  // модели листа отдельно от значений ячеек, запись .value/.style её не
  // трогает (проверено на реальном файле). Новая колонка Z в модели листа
  // не существовала вовсе — без явной ширины она открывалась бы дефолтной,
  // слишком узкой для текста расхождений.
  combinedSheet.getColumn(newCol).width = 60;

  const matchedContainers = new Set();
  const summary = {
    totalRows: 0,
    mismatchRows: 0,
    cargoWeight: 0,
    tareWeight: 0,
    totalWeight: 0,
    seals: 0,
    futnost: 0,
    orderWrong: 0,
    orderFormat: 0,
    dangerous: 0,
    notFound: 0,
    missingFromSummary: 0,
  };

  for (let r = DATA_START_ROW; r <= combinedSheet.rowCount; r++) {
    const row = combinedSheet.getRow(r);
    const containerNum = cellText(row.getCell(cols.container));
    if (!containerNum) continue;
    summary.totalRows += 1;

    const rawOrderNumber = cellText(row.getCell(cols.orderNumber));
    const orderNumber = normalizeOrderNumber(rawOrderNumber);
    const issues = [];

    let entry = index.get(`${orderNumber}::${containerNum}`);
    if (entry) {
      matchedContainers.add(`${orderNumber}::${containerNum}`);
      if (rawOrderNumber !== orderNumber) {
        issues.push(`в номере поручения лишние пробелы/перенос строки: «${JSON.stringify(rawOrderNumber)}»`);
        summary.orderFormat += 1;
      }
    } else {
      const candidates = containerToOrders.get(containerNum);
      if (candidates && candidates.length) {
        const actualOrder = candidates[0];
        entry = index.get(`${actualOrder}::${containerNum}`);
        matchedContainers.add(`${actualOrder}::${containerNum}`);
        issues.push(`поручение указано неверно: в своде «${rawOrderNumber}», контейнер найден в поручении «${actualOrder}»`);
        summary.orderWrong += 1;
      } else {
        issues.push('контейнер не найден ни в одном поручении');
        summary.notFound += 1;
      }
    }

    if (entry) {
      const futnost = cellText(row.getCell(cols.futnost));
      const expectedFutnost = entry.isoCode ? isoToFutnost.get(entry.isoCode) : null;
      if (expectedFutnost && futnost !== expectedFutnost) {
        issues.push(`тип контейнера: свод «${futnost}», по поручению (ISO ${entry.isoCode}) ожидается «${expectedFutnost}»`);
        summary.futnost += 1;
      }

      const cargoWeight = cellNumber(row.getCell(cols.cargoWeight));
      if (cargoWeight === null || Math.abs(cargoWeight - entry.cargoWeight) > WEIGHT_EPSILON) {
        issues.push(`вес груза: свод ${cargoWeight ?? '—'}, по поручению ${entry.cargoWeight} кг (без поддонов/палет)`);
        summary.cargoWeight += 1;
      }

      const tareWeight = cellNumber(row.getCell(cols.tareWeight));
      if (tareWeight === null || entry.tareWeight === null || Math.abs(tareWeight - entry.tareWeight) > WEIGHT_EPSILON) {
        issues.push(`вес тары: свод ${tareWeight ?? '—'}, по поручению ${entry.tareWeight ?? '—'} кг`);
        summary.tareWeight += 1;
      }

      // Общий вес — как сумма веса груза и веса тары, взятых из поручения
      // (тех же значений, что сверяются выше как R01/R02), а не как сумма
      // столбцов свода: если у самого свода вес груза/тары в этой строке
      // разъехался с общим весом (например, при перепутанных при сборке
      // соседних строках), это отдельная, самостоятельная поломка — итог
      // не обязан совпадать с суммой двух уже неверных чисел.
      const totalWeight = cellNumber(row.getCell(cols.totalWeight));
      if (entry.tareWeight !== null) {
        const expectedTotal = entry.cargoWeight + entry.tareWeight;
        if (totalWeight === null || Math.abs(totalWeight - expectedTotal) > WEIGHT_EPSILON) {
          issues.push(`общий вес: свод ${totalWeight ?? '—'}, ожидается ${expectedTotal} кг (вес груза + вес тары по поручению)`);
          summary.totalWeight += 1;
        }
      }

      const seals = cellText(row.getCell(cols.seals));
      if (!sameValueSet(seals, entry.sealNumber)) {
        issues.push(`номер пломбы: свод «${seals}», по поручению «${entry.sealNumber}»`);
        summary.seals += 1;
      }

      const dangerousText = cellText(row.getCell(cols.dangerous));
      const summarySet = new Set(parseDangerousGoodsEntries(dangerousText));
      if (summarySet.size || entry.dangerousGoods.size) {
        if (!sameDangerousGoods(summarySet, entry.dangerousGoods)) {
          const orderText = [...entry.dangerousGoods].map((p) => `IMO ${p.replace('|', ' UN ')}`).join(' / ');
          issues.push(`опасные грузы: свод «${dangerousText || '—'}», по поручению «${orderText || '—'}»`);
          summary.dangerous += 1;
        }
      }
    }

    if (issues.length) {
      row.getCell(newCol).value = issues.join('; ');
      summary.mismatchRows += 1;
      for (let c = FIRST_COLUMN; c <= newCol; c++) {
        const cell = row.getCell(c);
        const style = cloneStyle(cell.style);
        style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW_ARGB } };
        cell.style = style;
      }
    } else {
      row.getCell(newCol).value = null;
    }
  }

  summary.missingFromSummary = [...index.keys()].filter((key) => !matchedContainers.has(key)).length;

  dropUnwritableConditionalFormatting(combinedSheet);

  return { ok: true, resultWorkbook: combinedWb, summary, warnings };
}
