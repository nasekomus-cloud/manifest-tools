// Проверка исходного файла линии сам по себе — до того, как по нему делать
// файлы для загрузки в систему: «глупые» технические ошибки, которые видны без
// второго файла (опечатка в номере контейнера, вес в тоннах вместо кг, объём
// больше вместимости контейнера, рефконтейнер без температуры, разные
// отправители в строках одного коносамента и т.п.).
//
// Формат файла — тот же, что читает source-check/core.js (один лист, шапка
// рейса сверху, строка заголовков с «номер коносамента»/«номер контейнера» —
// в реальном файле 10-я, колонки A:Z), но свой разбор: здесь нужны все
// колонки и «сырые» ячейки (текст с пробелами, число или текст, ошибка Excel),
// а readSourceManifest отдаёт уже нормализованные значения только для сверки.
//
// Чистая функция от книги ExcelJS — без DOM и без сети; ExcelJS снаружи, как
// у остальных core.js. Результат — та же книга (мутируется, как в
// source-check/order-check) со столбцом «Ошибки проверки» справа от таблицы:
// ячейка с ошибкой — оранжевым, с предупреждением — голубым (как в
// template-check: жёлтый там уже занят).

import { dropUnwritableConditionalFormatting } from '../lib/xlsx-safe-write.js?v=202609130013';

const NOTE_HEADER = 'Ошибки проверки';
const ERROR_ARGB = 'FFFF9900';
const WARNING_ARGB = 'FFADD8E6';

/* ——— Правила ———
   Ключ — summary.byRule и колонка «Что проверялось» на странице; порядок —
   порядок в сводке. */
export const RULES = [
  ['structure', 'нет нужной колонки'],
  ['header', 'шапка рейса'],
  ['noContainer', 'строка с данными без номера контейнера'],
  ['excelError', 'ошибка Excel в ячейке (#N/A, #REF! …)'],
  ['required', 'не заполнено обязательное поле'],
  ['placeholder', 'заглушка вместо значения («-», «N/A», «TBA» …)'],
  ['spaces', 'лишние пробелы в номере/коде'],
  ['cyrillic', 'русские буквы вместо латинских'],
  ['containerNumber', 'номер контейнера: формат или контрольная цифра'],
  ['containerType', 'неизвестный тип контейнера'],
  ['portCode', 'код порта не в формате UN/LOCODE'],
  ['tolMismatch', 'TOL не совпадает с PlaceOfDelivery'],
  ['notNumber', 'текст вместо числа'],
  ['textNumber', 'число записано текстом'],
  ['places', 'количество мест'],
  ['tonnes', 'вес похож на тонны, а не кг'],
  ['tareRange', 'вес тары необычный для этого типа'],
  ['overweight', 'вес брутто больше допустимого'],
  ['volume', 'объём больше вместимости контейнера'],
  ['reefer', 'температура и рефконтейнер'],
  ['dg', 'опасный груз: класс/UN'],
  ['dgHidden', 'опасный груз в описании, но не в графах'],
  ['emptyFlag', 'порожний контейнер / ISEMPTY'],
  ['duplicate', 'повтор строки (тот же контейнер и коносамент)'],
  ['containerConflict', 'один контейнер — разные данные в строках'],
  ['sealDuplicate', 'одна пломба на нескольких контейнерах'],
  ['blConflict', 'в строках одного коносамента разные данные'],
];

/* ——— Колонки ———
   Заголовки — точным совпадением после normalizeHeader (не вхождением:
   SHIPPER — часть SHIPPER_ADDRESS, как в source-check/core.js). required —
   без колонки или без значения в строке это ошибка. */
const COLUMNS = [
  { key: 'billOfLading', headers: ['номер коносамента'], label: 'номер коносамента', required: true },
  { key: 'container', headers: ['номер контейнера'], label: 'номер контейнера', required: true },
  { key: 'type', headers: ['тип контейнера'], label: 'Тип контейнера', required: true },
  { key: 'pol', headers: ['pol'], label: 'POL' },
  { key: 'tol', headers: ['tol'], label: 'TOL' },
  { key: 'cargoName', headers: ['cargoname_eng'], label: 'CARGONAME_ENG', required: true },
  { key: 'seal', headers: ['seal'], label: 'SEAL', required: true },
  { key: 'places', headers: ['places'], label: 'PLACES', required: true },
  { key: 'packageName', headers: ['наименование упаковки'], label: 'Наименование упаковки', required: true },
  { key: 'cargoWeight', headers: ['cargoweight'], label: 'CARGOWEIGHT', required: true },
  { key: 'measurement', headers: ['measurement', 'measuremen'], label: 'MEASUREMENT' },
  { key: 'placeOfReceipt', headers: ['placeofreceipt'], label: 'PlaceOfReceipt', required: true },
  { key: 'placeOfDelivery', headers: ['placeofdelivery'], label: 'PlaceOfDelivery', required: true },
  { key: 'shipper', headers: ['shipper'], label: 'SHIPPER', required: true },
  { key: 'shipperAddress', headers: ['shipper_address'], label: 'SHIPPER_ADDRESS' },
  { key: 'consignee', headers: ['consignee'], label: 'CONSIGNEE', required: true },
  { key: 'consigneeAddress', headers: ['consignee_address'], label: 'CONSIGNEE_ADDRESS' },
  { key: 'notify', headers: ['notify'], label: 'NOTIFY' },
  { key: 'notifyAddress', headers: ['notify_address'], label: 'NOTIFY_ADDRESS' },
  { key: 'temperature', headers: ['температура'], label: 'Температура' },
  { key: 'imoClass', headers: ['imo class'], label: 'IMO CLASS' },
  { key: 'unNumber', headers: ['unno'], label: 'UNNO' },
  { key: 'tareWeight', headers: ['tareweight'], label: 'TAREWEIGHT', required: true },
  { key: 'isEmpty', headers: ['isempty'], label: 'ISEMPTY' },
];
const COLUMN_BY_KEY = Object.fromEntries(COLUMNS.map((c) => [c.key, c]));

// Поля, которые у всех строк одного коносамента должны совпадать: разные
// значения — след протягивания/копирования строк в Excel.
const BL_SAME_FIELDS = [
  'shipper', 'shipperAddress', 'consignee', 'consigneeAddress', 'notify', 'notifyAddress',
  'pol', 'tol', 'placeOfReceipt', 'placeOfDelivery',
];

// Поля, которые у одного физического контейнера в разных строках (контейнер
// под несколькими коносаментами) должны совпадать.
const CONTAINER_SAME_FIELDS = ['type', 'tareWeight', 'seal', 'placeOfDelivery', 'temperature'];

/* ——— Чтение ячеек ——— */

function rawText(cell) {
  if (!cell) return '';
  // Объединённая ячейка с пустым мастером бросает исключение при чтении .text
  // (см. dg-check/core.js) — здесь это «пусто», а не падение инструмента.
  try {
    const value = cell.text;
    return value === undefined || value === null ? '' : String(value);
  } catch {
    return '';
  }
}

function excelError(cell) {
  const value = cell && cell.value;
  if (!value || typeof value !== 'object') return null;
  if (typeof value.error === 'string') return value.error;
  if (value.result && typeof value.result === 'object' && typeof value.result.error === 'string') {
    return value.result.error;
  }
  return null;
}

// Число из ячейки: {value, kind}, kind — 'empty' | 'number' | 'text-number' | 'text'.
function readNumber(cell) {
  let value = cell ? cell.value : null;
  if (value && typeof value === 'object' && 'result' in value) value = value.result;
  if (typeof value === 'number') return { value, kind: 'number' };
  const text = rawText(cell).trim();
  if (!text) return { value: null, kind: 'empty' };
  const cleaned = text.replace(/[\s ]/g, '').replace(',', '.');
  if (/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return { value: Number(cleaned), kind: 'text-number' };
  return { value: null, kind: 'text' };
}

function normalizeHeader(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Сравнение текстов «по сути»: без регистра и пробелов вообще (переносы
// строк в адресах — не расхождение), без ведущего апострофа Excel.
function compact(text) {
  return String(text ?? '').toUpperCase().replace(/\s+/g, '').replace(/^'/, '');
}

function oneLine(text, max = 60) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function formatNumber(n) {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

function columnLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ——— Номер контейнера (ISO 6346) ——— */

// Буквам — значения 10..38 без кратных 11 (11, 22, 33): A=10, B=12 … Z=38.
const LETTER_VALUES = (() => {
  const map = {};
  let value = 10;
  for (let i = 0; i < 26; i++) {
    if (value % 11 === 0) value++;
    map[String.fromCharCode(65 + i)] = value++;
  }
  return map;
})();

export function containerCheckDigitOk(number) {
  if (!/^[A-Z]{4}\d{7}$/.test(number)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = number[i];
    sum += (/\d/.test(ch) ? Number(ch) : LETTER_VALUES[ch]) * 2 ** i;
  }
  return (sum % 11) % 10 === Number(number[10]);
}

/* ——— Русские буквы-двойники ——— */

const CYR_TO_LAT = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X',
  а: 'a', е: 'e', к: 'k', м: 'm', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
};
const CYRILLIC = /[А-Яа-яЁё]/;

function toLatin(text) {
  return text.replace(/[А-Яа-яЁё]/g, (ch) => CYR_TO_LAT[ch] ?? ch);
}

/* ——— Тип контейнера ———
   Тот же разбор, что parseIso в source-check/core.js и template-check/core.js
   (там не экспортируется): обиходное обозначение (20GP, 40HC, 40RH) или
   4-значный ISO-код (22G1, 45R1) → {length, height, group}. */

const ISO_LENGTH = { 1: 10, 2: 20, 3: 30, 4: 40, L: 45 };
const ISO_HEIGHT = { 0: 'STD', 1: 'STD', 2: 'STD', 3: 'STD', 4: 'STD', 5: 'HC', 6: 'HC', 8: 'LOW', 9: 'LOW' };
const ISO_COMMON = new Map(Object.entries({
  '20DV': [20, 'STD', 'G'], '20DC': [20, 'STD', 'G'], '20GP': [20, 'STD', 'G'], '20ST': [20, 'STD', 'G'], '20SD': [20, 'STD', 'G'],
  '40DV': [40, 'STD', 'G'], '40DC': [40, 'STD', 'G'], '40GP': [40, 'STD', 'G'], '40ST': [40, 'STD', 'G'], '40SD': [40, 'STD', 'G'],
  '40HC': [40, 'HC', 'G'], '40HQ': [40, 'HC', 'G'], '45HC': [45, 'HC', 'G'], '45HQ': [45, 'HC', 'G'],
  '20RF': [20, 'STD', 'R'], '20RE': [20, 'STD', 'R'], '40RF': [40, 'STD', 'R'], '40RE': [40, 'STD', 'R'],
  '40RH': [40, 'HC', 'R'], '40HR': [40, 'HC', 'R'], '40RQ': [40, 'HC', 'R'],
  '20OT': [20, null, 'U'], '40OT': [40, null, 'U'],
  '20FR': [20, null, 'P'], '20PL': [20, null, 'P'], '40FR': [40, null, 'P'], '40PL': [40, null, 'P'],
  '20TK': [20, null, 'T'], '20TN': [20, null, 'T'],
}));

export function parseContainerType(code) {
  const text = compact(code);
  if (!text) return null;
  const common = ISO_COMMON.get(text);
  if (common) return { length: common[0], height: common[1], group: common[2] };
  if (/^[1-4L][0-9][A-Z][0-9]$/.test(text)) {
    const length = ISO_LENGTH[text[0]];
    const height = ISO_HEIGHT[text[1]];
    return length && height ? { length, height, group: text[2] } : null;
  }
  return null;
}

/* ——— Пределы по типу контейнера ———
   Обычные значения у контейнеров в эксплуатации, с запасом: вне диапазона —
   не «невозможно», а «проверьте» (кроме брутто и тонн — там ошибка). */

// Вес тары, кг: [min, max]. Ключ — «группа/длина/высота».
const TARE_RANGE = {
  'G/20/STD': [1700, 2700],
  'G/40/STD': [3300, 4300],
  'G/40/HC': [3500, 4500],
  'G/45/HC': [4400, 5300],
  'R/20/STD': [2600, 3500],
  'R/40/STD': [3900, 5200],
  'R/40/HC': [3900, 5200],
  'T/20/': [2800, 4600],
};

// Вместимость, м³ (внутренний объём с небольшим запасом). Танки, открытые и
// платформы не проверяются: у танка объём бывает разный, у открытых груз
// бывает негабаритным.
const VOLUME_LIMIT = {
  'G/20/STD': 34,
  'G/40/STD': 68.5,
  'G/40/HC': 77,
  'G/45/HC': 87,
  'R/20/STD': 29,
  'R/40/STD': 61,
  'R/40/HC': 70,
};

// Брутто (груз + тара), кг: больше error — ошибка; у 20-футового больше
// 30 480 — предупреждение (большинство 20' рассчитаны на 30 480, новые — на 32 500).
const GROSS_ERROR = { 20: 32500, 40: 32500, 45: 32500, T: 36000 };
const GROSS_WARNING_20 = 30480;

function typeKey(type) {
  return `${type.group}/${type.length}/${type.group === 'T' ? '' : type.height ?? ''}`;
}

/* ——— Опасный груз ——— */

const IMO_CLASS = /^(1(\.[1-6][A-L]?)?|2(\.[1-3])?|3|4(\.[1-3])?|5(\.[12])?|6(\.[12])?|7|8|9)$/;
const DG_NEGATIVE = /\bNON[\s-]*(DG|IMO|IMDG|HAZ\w*|DANGER\w*)|\bNOT\s+(DG|IMO|IMDG|HAZ\w*|DANGER\w*|RESTRICTED)|\bNO\s+DG\b/;
const DG_POSITIVE = /\bIMO\b|\bIMDG\b|\bDANGEROUS\b|\bHAZARDOUS\b|\bCLASS\s*:?\s*\d/;
const UN_IN_TEXT = /\bUN\s*-?\s*(?:NO\.?\s*)?(\d{4})\b/g;

function splitList(text) {
  return text.split(/[,;\n/]+/).map((s) => s.trim()).filter(Boolean);
}

/* ——— Прочее ——— */

const PLACEHOLDER = /^(?:[-–—.,_/\\*?#0\s]+|N\/?A|TBA|TBC|TBD|XXX+|NONE|NIL|NULL|НЕТ)$/i;
const EMPTY_FLAG = /^(Y|YES|1|TRUE|E|EMPTY|ДА|ПОРОЖНИЙ|ПОРОЖНЯЯ)$/i;
const NOT_EMPTY_FLAG = /^(N|NO|0|FALSE|F|НЕТ|ГРУЖ.*)?$/i;
const PORT_CODE = /^[A-Z]{5}$/;

/* ——— Шапка и заголовки ——— */

function findHeaderRow(sheet) {
  for (let r = 1; r <= Math.min(sheet.rowCount, 50); r++) {
    const row = sheet.getRow(r);
    const columns = {};
    const lastCol = Math.max(row.cellCount, 1);
    for (let c = 1; c <= lastCol; c++) {
      const text = normalizeHeader(rawText(row.getCell(c)));
      const spec = COLUMNS.find((s) => s.headers.includes(text));
      if (spec && !columns[spec.key]) columns[spec.key] = c;
    }
    if (columns.container && columns.billOfLading) {
      let lastHeaderCol = 0;
      for (let c = 1; c <= lastCol; c++) if (rawText(row.getCell(c)).trim()) lastHeaderCol = c;
      return { headerRow: r, columns, lastHeaderCol };
    }
  }
  return null;
}

// Шапка рейса над таблицей: подпись («Судно», «Рейс», «Терминал выгрузки»…) и
// значение правее неё. Подписи повторяются (в реальном файле «Рейс» — три
// строки, «Терминал выгрузки» — три), поэтому значения собираются списком.
const HEADER_LABELS = [
  ['vessel', 'судно'],
  ['voyage', 'рейс'],
  ['arrivalDate', 'дата прихода'],
  ['loadingTerminal', 'терминал погрузки'],
  ['dischargeTerminals', 'терминал выгрузки'],
];

function readVoyageHeader(sheet, headerRow) {
  const header = { vessel: [], voyage: [], arrivalDate: [], loadingTerminal: [], dischargeTerminals: [] };
  const where = {};
  for (let r = 1; r < headerRow; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      const label = normalizeHeader(rawText(row.getCell(c)));
      const entry = HEADER_LABELS.find(([, text]) => text === label);
      if (!entry) continue;
      const [key] = entry;
      where[key] ??= { row: r, col: c };
      for (let v = c + 1; v <= Math.max(row.cellCount, c + 1); v++) {
        const value = rawText(row.getCell(v)).trim();
        if (value) {
          if (!header[key].includes(value)) header[key].push(value);
          break;
        }
      }
      break;
    }
  }
  return { header, where };
}

/**
 * Число строк с номером контейнера — для списка файлов на странице.
 * @returns {number|null} null — не похоже на исходный файл линии
 */
export function countSourceRows(workbook) {
  for (const sheet of workbook.worksheets) {
    const found = findHeaderRow(sheet);
    if (!found) continue;
    let n = 0;
    for (let r = found.headerRow + 1; r <= sheet.rowCount; r++) {
      if (rawText(sheet.getRow(r).getCell(found.columns.container)).trim()) n++;
    }
    return n;
  }
  return null;
}

/* ——— Проверка ——— */

/**
 * Проверяет исходный файл линии и дописывает пометки в ту же книгу.
 *
 * @param {import('exceljs').Workbook} workbook
 * @returns {{ok:true, resultWorkbook, findings: Array<{level:'error'|'warning', rule:string, row:number|null, column:string|null, container:string, message:string}>,
 *   summary:{rows, containers, billsOfLading, errors, warnings, errorRows, warningRows, byRule:Object<string,{errors:number, warnings:number}>},
 *   header:{vessel:string[], voyage:string[], dischargeTerminals:string[]}} | {ok:false, error:string}}
 */
export function auditSourceFile(workbook) {
  let sheet = null;
  let found = null;
  for (const candidate of workbook.worksheets) {
    found = findHeaderRow(candidate);
    if (found) {
      sheet = candidate;
      break;
    }
  }
  if (!sheet) {
    return {
      ok: false,
      error: 'Не найдена строка заголовков («номер коносамента», «номер контейнера») — это точно исходный файл линии?',
    };
  }
  const { headerRow, columns } = found;

  const findings = [];
  // marks: адрес ячейки → уровень (error важнее warning) — для заливки.
  const marks = new Map();
  const add = (level, rule, { row = null, key = null, col = null, container = '', message }) => {
    const colNumber = col ?? (key ? columns[key] : null) ?? null;
    const column = colNumber ? columnLetter(colNumber) : null;
    findings.push({ level, rule, row, column, container, message });
    if (row && colNumber) {
      const address = `${column}${row}`;
      if (marks.get(address) !== 'error') marks.set(address, level);
    }
  };

  /* Колонки */
  for (const spec of COLUMNS) {
    if (columns[spec.key]) continue;
    add(spec.required ? 'error' : 'warning', 'structure', {
      row: headerRow,
      message: `нет колонки «${spec.label}» — ${spec.required ? 'обязательное поле не проверить' : 'её проверки пропущены'}`,
    });
  }

  /* Строки */
  const rows = [];
  const lastCol = Math.max(found.lastHeaderCol, ...Object.values(columns));
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cell = (key) => (columns[key] ? row.getCell(columns[key]) : null);
    const text = (key) => rawText(cell(key));

    let hasData = false;
    for (let c = 1; c <= lastCol; c++) {
      const cellRef = row.getCell(c);
      const error = excelError(cellRef);
      if (error) {
        add('error', 'excelError', { row: r, col: c, message: `в ячейке ${columnLetter(c)}${r} ошибка Excel ${error}` });
      }
      if (error || rawText(cellRef).trim()) hasData = true;
    }
    if (!hasData) continue;

    const container = text('container').trim();
    if (!container) {
      add('error', 'noContainer', {
        row: r,
        key: 'container',
        message: 'в строке есть данные, но нет номера контейнера — строка не попадёт в систему (или это итог/примечание)',
      });
      continue;
    }

    const data = { row: r, container: compact(toLatin(container)) };
    for (const spec of COLUMNS) data[spec.key] = columns[spec.key] ? text(spec.key) : '';
    rows.push(data);
    const at = (key) => ({ row: r, key, container: data.container });

    /* Обязательные и заглушки */
    for (const spec of COLUMNS) {
      if (!columns[spec.key]) continue;
      const value = data[spec.key].trim();
      if (spec.required && !value) {
        add('error', 'required', { ...at(spec.key), message: `не заполнено «${spec.label}»` });
      } else if (value && PLACEHOLDER.test(value) && !['places', 'cargoWeight', 'tareWeight', 'measurement', 'temperature', 'isEmpty', 'imoClass', 'unNumber', 'notifyAddress'].includes(spec.key)) {
        add(spec.required ? 'error' : 'warning', 'placeholder', { ...at(spec.key), message: `в «${spec.label}» заглушка «${value}» вместо значения` });
      }
    }
    for (const key of ['shipperAddress', 'consigneeAddress']) {
      if (columns[key] && !data[key].trim()) {
        add('warning', 'required', { ...at(key), message: `не заполнено «${COLUMN_BY_KEY[key].label}»` });
      }
    }

    /* Номера и коды: пробелы, русские буквы */
    for (const key of ['billOfLading', 'container', 'type', 'seal', 'placeOfReceipt', 'placeOfDelivery', 'tol']) {
      const raw = data[key];
      if (!raw.trim()) continue;
      const label = COLUMN_BY_KEY[key].label;
      if (CYRILLIC.test(raw)) {
        add('error', 'cyrillic', { ...at(key), message: `в «${label}» русские буквы вместо латинских: «${raw.trim()}» (на вид не отличить)` });
      }
      if (/ /.test(raw) || raw !== raw.trim()) {
        add('warning', 'spaces', { ...at(key), message: `в «${label}» лишние пробелы по краям: «${raw}»` });
      } else if (key !== 'seal' && /\s/.test(raw.trim())) {
        add('error', 'spaces', { ...at(key), message: `в «${label}» пробел внутри: «${raw.trim()}»` });
      }
    }

    /* Номер контейнера */
    const containerLatin = toLatin(container).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z]{4}\d{7}$/.test(containerLatin)) {
      add('error', 'containerNumber', {
        ...at('container'),
        message: `номер контейнера «${container}» не по форме: 4 латинские буквы + 7 цифр`,
      });
    } else if (!containerCheckDigitOk(containerLatin)) {
      add('error', 'containerNumber', {
        ...at('container'),
        message: `у номера «${containerLatin}» не сходится контрольная цифра — вероятно, опечатка в номере`,
      });
    }

    /* Тип контейнера */
    const type = parseContainerType(toLatin(data.type));
    data.parsedType = type;
    if (data.type.trim() && !type) {
      add('error', 'containerType', { ...at('type'), message: `неизвестный тип контейнера «${data.type.trim()}»` });
    }

    /* Коды портов */
    for (const key of ['placeOfReceipt', 'placeOfDelivery', 'tol']) {
      const value = toLatin(data[key].trim()).toUpperCase();
      if (value && !PORT_CODE.test(value)) {
        add('error', 'portCode', { ...at(key), message: `«${COLUMN_BY_KEY[key].label}» = «${data[key].trim()}» — ожидается код из 5 латинских букв (RUPLP)` });
      }
    }
    if (columns.tol && data.tol.trim() && data.placeOfDelivery.trim() && compact(data.tol) !== compact(data.placeOfDelivery)) {
      add('error', 'tolMismatch', {
        ...at('tol'),
        message: `TOL «${data.tol.trim()}», а PlaceOfDelivery «${data.placeOfDelivery.trim()}» — куда идёт контейнер?`,
      });
    }

    /* Числа */
    const numbers = {};
    for (const key of ['places', 'cargoWeight', 'tareWeight', 'measurement']) {
      if (!columns[key]) continue;
      const parsed = readNumber(cell(key));
      numbers[key] = parsed.value;
      const label = COLUMN_BY_KEY[key].label;
      if (parsed.kind === 'text') {
        add('error', 'notNumber', { ...at(key), message: `в «${label}» текст «${oneLine(data[key])}» вместо числа` });
      } else if (parsed.kind === 'text-number') {
        add('warning', 'textNumber', { ...at(key), message: `в «${label}» число «${data[key].trim()}» записано как текст` });
      }
      if (parsed.value !== null && parsed.value < 0) {
        add('error', 'notNumber', { ...at(key), message: `в «${label}» отрицательное число ${formatNumber(parsed.value)}` });
      }
    }
    data.numbers = numbers;

    const { places, cargoWeight, tareWeight, measurement } = numbers;
    if (places !== null && places !== undefined) {
      if (!Number.isInteger(places)) {
        add('error', 'places', { ...at('places'), message: `количество мест ${formatNumber(places)} — не целое число` });
      } else if (places === 0 && cargoWeight > 0) {
        add('error', 'places', { ...at('places'), message: 'количество мест 0 при ненулевом весе груза' });
      }
    }

    // Вес в тоннах: у гружёного контейнера вес груза меньше 100 кг почти
    // невероятен, а «23,854» рядом с соседями «23 854» — тонны (реальный случай:
    // 11 контейнеров коносамента OVPGISTPLP000012).
    if (cargoWeight > 0 && cargoWeight < 100) {
      add('error', 'tonnes', {
        ...at('cargoWeight'),
        message: `вес груза ${formatNumber(cargoWeight)} кг — похоже, указан в тоннах (${formatNumber(cargoWeight * 1000)} кг?)`,
      });
    }
    if (tareWeight > 0 && tareWeight < 100) {
      add('error', 'tonnes', {
        ...at('tareWeight'),
        message: `вес тары ${formatNumber(tareWeight)} кг — похоже, указан в тоннах (${formatNumber(tareWeight * 1000)} кг?)`,
      });
    } else if (tareWeight === 0) {
      add('error', 'required', { ...at('tareWeight'), message: 'вес тары 0' });
    } else if (type && tareWeight > 0) {
      const range = TARE_RANGE[typeKey(type)];
      if (range && (tareWeight < range[0] || tareWeight > range[1])) {
        add('warning', 'tareRange', {
          ...at('tareWeight'),
          message: `вес тары ${formatNumber(tareWeight)} кг необычен для ${data.type.trim()} (обычно ${range[0]}–${range[1]} кг)`,
        });
      }
    }
    if (type && cargoWeight >= 100 && tareWeight >= 100) {
      const gross = cargoWeight + tareWeight;
      const limit = type.group === 'T' ? GROSS_ERROR.T : GROSS_ERROR[type.length];
      if (limit && gross > limit) {
        add('error', 'overweight', {
          ...at('cargoWeight'),
          message: `груз + тара = ${formatNumber(gross)} кг — больше предельной массы брутто ${data.type.trim()} (${limit} кг); лишняя цифра?`,
        });
      } else if (type.length === 20 && type.group !== 'T' && gross > GROSS_WARNING_20) {
        add('warning', 'overweight', {
          ...at('cargoWeight'),
          message: `груз + тара = ${formatNumber(gross)} кг — больше 30 480 кг, обычного предела 20-футового контейнера`,
        });
      }
    }
    if (type && measurement > 0) {
      const limit = VOLUME_LIMIT[typeKey(type)];
      if (limit && measurement > limit) {
        add('warning', 'volume', {
          ...at('measurement'),
          message: `объём ${formatNumber(measurement)} м³ больше вместимости ${data.type.trim()} (около ${limit} м³)`,
        });
      }
    }

    /* Порожний */
    if (columns.isEmpty) {
      const flag = data.isEmpty.trim();
      if (EMPTY_FLAG.test(flag) && cargoWeight > 0) {
        add('error', 'emptyFlag', { ...at('isEmpty'), message: `ISEMPTY = «${flag}», но вес груза ${formatNumber(cargoWeight)} кг` });
      } else if (flag && !EMPTY_FLAG.test(flag) && !NOT_EMPTY_FLAG.test(flag)) {
        add('warning', 'emptyFlag', { ...at('isEmpty'), message: `непонятное значение ISEMPTY «${flag}»` });
      } else if (cargoWeight === 0 && !EMPTY_FLAG.test(flag)) {
        add('warning', 'emptyFlag', { ...at('cargoWeight'), message: 'вес груза 0, но контейнер не отмечен порожним (ISEMPTY)' });
      }
    }

    /* Температура */
    const isReefer = type && type.group === 'R';
    const tempText = data.temperature.trim();
    if (columns.temperature) {
      if (isReefer && !tempText && !(cargoWeight === 0)) {
        add('error', 'reefer', { ...at('temperature'), message: `рефконтейнер ${data.type.trim()} без температуры` });
      } else if (tempText && type && !isReefer && !PLACEHOLDER.test(tempText)) {
        add('warning', 'reefer', { ...at('temperature'), message: `температура «${tempText}» у нерефрижераторного ${data.type.trim()}` });
      }
      if (tempText && !PLACEHOLDER.test(tempText)) {
        const t = readNumber(cell('temperature'));
        if (t.kind === 'text') {
          add('error', 'reefer', { ...at('temperature'), message: `температура «${tempText}» — не число` });
        } else if (t.value !== null && (t.value < -40 || t.value > 30)) {
          add('warning', 'reefer', { ...at('temperature'), message: `температура ${formatNumber(t.value)} °C — необычно (знак? лишняя цифра?)` });
        }
      }
    }

    /* Опасный груз */
    const classes = splitList(data.imoClass).map((s) => s.replace(/^(IMO|CLASS)\s*/i, '').replace(/\(.*\)$/, '').trim());
    const unNumbers = splitList(data.unNumber).map((s) => s.replace(/^UN\s*/i, '').trim());
    if (columns.imoClass && columns.unNumber) {
      if (classes.length && !unNumbers.length) {
        add('error', 'dg', { ...at('unNumber'), message: `класс опасности ${data.imoClass.trim()} указан, а номер UN — нет` });
      } else if (unNumbers.length && !classes.length) {
        add('error', 'dg', { ...at('imoClass'), message: `номер UN ${data.unNumber.trim()} указан, а класс опасности — нет` });
      }
      for (const cls of classes) {
        if (!IMO_CLASS.test(cls)) add('error', 'dg', { ...at('imoClass'), message: `класс опасности «${cls}» — такого нет (1–9, например 3, 6.1, 2.2)` });
      }
      for (const un of unNumbers) {
        if (!/^\d{4}$/.test(un)) add('error', 'dg', { ...at('unNumber'), message: `номер UN «${un}» — должно быть 4 цифры` });
      }
    }
    const cargoUpper = data.cargoName.toUpperCase();
    if (!DG_NEGATIVE.test(cargoUpper)) {
      const textUn = [...cargoUpper.matchAll(UN_IN_TEXT)].map((m) => m[1]);
      if ((textUn.length || DG_POSITIVE.test(cargoUpper)) && !classes.length && !unNumbers.length) {
        add('warning', 'dgHidden', {
          ...at('imoClass'),
          message: `в описании груза есть признак опасного груза («${oneLine(data.cargoName, 50)}»), а IMO CLASS/UNNO пустые`,
        });
      } else if (textUn.length && unNumbers.length) {
        const missing = textUn.filter((un) => !unNumbers.includes(un));
        if (missing.length) {
          add('warning', 'dgHidden', {
            ...at('unNumber'),
            message: `в описании груза UN ${missing.join(', ')}, а в графе UNNO — ${unNumbers.join(', ')}`,
          });
        }
      }
    }
  }

  if (!rows.length) return { ok: false, error: 'Не найдено ни одной строки с номером контейнера' };

  /* Группы: контейнер, пломба, коносамент */
  const byContainer = new Map();
  const byBl = new Map();
  const sealOwners = new Map(); // пломба → Set контейнеров
  for (const data of rows) {
    if (!byContainer.has(data.container)) byContainer.set(data.container, []);
    byContainer.get(data.container).push(data);
    const bl = compact(data.billOfLading);
    if (bl) {
      if (!byBl.has(bl)) byBl.set(bl, []);
      byBl.get(bl).push(data);
    }
    for (const seal of data.seal.split(/[\s,;/]+/).map((s) => compact(toLatin(s))).filter((s) => s.length >= 3)) {
      if (!sealOwners.has(seal)) sealOwners.set(seal, new Map());
      const owners = sealOwners.get(seal);
      if (!owners.has(data.container)) owners.set(data.container, data);
      if (seal === data.container) {
        add('error', 'sealDuplicate', { row: data.row, key: 'seal', container: data.container, message: 'в графе пломбы — номер контейнера' });
      }
    }
  }

  for (const [container, list] of byContainer) {
    if (list.length < 2) continue;
    const seenBl = new Map();
    for (const data of list) {
      const bl = compact(data.billOfLading);
      if (seenBl.has(bl)) {
        add('error', 'duplicate', {
          row: data.row,
          key: 'container',
          container,
          message: `повтор: контейнер ${container} с коносаментом ${data.billOfLading.trim() || '—'} уже есть в строке ${seenBl.get(bl).row}`,
        });
      } else {
        seenBl.set(bl, data);
      }
    }
    const first = list[0];
    for (const data of list.slice(1)) {
      for (const key of CONTAINER_SAME_FIELDS) {
        if (!columns[key]) continue;
        if (compact(data[key]) === compact(first[key])) continue;
        add('error', 'containerConflict', {
          row: data.row,
          key,
          container,
          message: `${COLUMN_BY_KEY[key].label}: «${oneLine(data[key]) || '—'}», а в строке ${first.row} у того же контейнера — «${oneLine(first[key]) || '—'}»`,
        });
      }
    }
  }

  for (const [seal, owners] of sealOwners) {
    if (owners.size < 2) continue;
    const list = [...owners.values()];
    for (const data of list) {
      const others = list.filter((o) => o !== data).map((o) => `${o.container} (строка ${o.row})`);
      add('error', 'sealDuplicate', {
        row: data.row,
        key: 'seal',
        container: data.container,
        message: `пломба ${seal} стоит и на ${others.join(', ')}`,
      });
    }
  }

  for (const [, list] of byBl) {
    if (list.length < 2) continue;
    const first = list[0];
    for (const data of list.slice(1)) {
      for (const key of BL_SAME_FIELDS) {
        if (!columns[key]) continue;
        if (compact(data[key]) === compact(first[key])) continue;
        add('error', 'blConflict', {
          row: data.row,
          key,
          container: data.container,
          message: `${COLUMN_BY_KEY[key].label} отличается от строки ${first.row} того же коносамента: «${oneLine(data[key]) || '—'}» против «${oneLine(first[key]) || '—'}»`,
        });
      }
    }
  }

  /* Шапка рейса */
  const { header, where } = readVoyageHeader(sheet, headerRow);
  const headerAt = (key) => (where[key] ? { row: where[key].row, col: where[key].col + 1 } : { row: headerRow });
  if (!header.vessel.length) add('warning', 'header', { ...headerAt('vessel'), message: 'в шапке не указано судно' });
  if (!header.voyage.length) add('warning', 'header', { ...headerAt('voyage'), message: 'в шапке не указан рейс' });
  if (header.vessel.length > 1) {
    add('warning', 'header', { ...headerAt('vessel'), message: `в шапке несколько судов: ${header.vessel.join(', ')}` });
  }
  if (header.dischargeTerminals.length) {
    const listed = new Set(header.dischargeTerminals.map((t) => compact(t)));
    const used = new Set(rows.map((d) => compact(d.placeOfDelivery)).filter(Boolean));
    const notListed = [...used].filter((code) => !listed.has(code));
    const unused = header.dischargeTerminals.filter((t) => !used.has(compact(t)));
    if (notListed.length) {
      add('warning', 'header', {
        ...headerAt('dischargeTerminals'),
        message: `PlaceOfDelivery ${notListed.join(', ')} нет среди «Терминал выгрузки» в шапке`,
      });
    }
    if (unused.length) {
      add('warning', 'header', {
        ...headerAt('dischargeTerminals'),
        message: `в шапке терминалом выгрузки указан ${unused.join(', ')}, но ни один контейнер туда не идёт (PlaceOfDelivery)`,
      });
    }
  }

  /* Пометки в книге */
  const noteCol = lastCol + 1;
  const notesByRow = new Map();
  for (const f of findings) {
    if (!f.row) continue;
    if (!notesByRow.has(f.row)) notesByRow.set(f.row, []);
    notesByRow.get(f.row).push(f);
  }
  const headerCell = sheet.getRow(headerRow).getCell(noteCol);
  headerCell.style = cloneStyle(sheet.getRow(headerRow).getCell(lastCol).style);
  headerCell.value = NOTE_HEADER;
  sheet.getColumn(noteCol).width = 80;
  for (const [rowNumber, list] of notesByRow) {
    const cell = sheet.getRow(rowNumber).getCell(noteCol);
    const style = cloneStyle(rowNumber === headerRow ? headerCell.style : cell.style);
    style.alignment = { ...(style.alignment || {}), wrapText: true, vertical: 'top' };
    const worst = list.some((f) => f.level === 'error') ? ERROR_ARGB : WARNING_ARGB;
    style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: worst } };
    cell.style = style;
    const lines = list.map((f) => `${f.level === 'error' ? 'Ошибка' : 'Проверить'}: ${f.message}`);
    cell.value = rowNumber === headerRow ? `${NOTE_HEADER}\n${lines.join('\n')}` : lines.join('\n');
  }
  for (const [address, level] of marks) {
    const cell = sheet.getCell(address);
    const style = cloneStyle(cell.style);
    style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: level === 'error' ? ERROR_ARGB : WARNING_ARGB } };
    cell.style = style;
  }
  dropUnwritableConditionalFormatting(sheet);

  /* Сводка */
  const byRule = {};
  for (const f of findings) {
    byRule[f.rule] ??= { errors: 0, warnings: 0 };
    byRule[f.rule][f.level === 'error' ? 'errors' : 'warnings']++;
  }
  const errorRows = new Set(findings.filter((f) => f.level === 'error' && f.row > headerRow).map((f) => f.row));
  const warningRows = new Set(findings.filter((f) => f.level === 'warning' && f.row > headerRow).map((f) => f.row));
  findings.sort((a, b) => (a.row ?? 0) - (b.row ?? 0));

  return {
    ok: true,
    resultWorkbook: workbook,
    findings,
    header: { vessel: header.vessel, voyage: header.voyage, dischargeTerminals: header.dischargeTerminals },
    summary: {
      rows: rows.length,
      containers: byContainer.size,
      billsOfLading: byBl.size,
      errors: findings.filter((f) => f.level === 'error').length,
      warnings: findings.filter((f) => f.level === 'warning').length,
      errorRows: errorRows.size,
      warningRows: warningRows.size,
      byRule,
    },
  };
}

// ExcelJS при чтении отдаёт один объект стиля многим ячейкам — перед заливкой
// стиль клонируется (как в merge/dg-check/order-check), иначе зальётся всё,
// что делит тот же стиль.
function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}
