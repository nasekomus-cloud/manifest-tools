// Сверка импортного манифеста, внесённого в систему (формат lib/manifest-format.js,
// лист "Manifest"), с исходным файлом линии (один лист, строка заголовков с
// «номер коносамента»/«номер контейнера»/CARGOWEIGHT/PlaceOfReceipt/… — не
// фиксированная, ищется по заголовкам). Чистые функции от книг ExcelJS — без
// DOM и без сети; ExcelJS снаружи, как у остальных core.js.
//
// Строки сопоставляются по номеру контейнера; у контейнера под несколькими
// коносаментами (одна строка на коносамент в обоих файлах) — по паре
// «контейнер + коносамент», и только если пары нет — по порядку строк.
// Найденные расхождения пишутся в столбец LAST_COLUMN+1 манифеста системы,
// строка C:Z заливается жёлтым (как в dg-check/order-check), сама расходящаяся
// ячейка — оранжевым, чтобы в строке на 23 колонки было видно, где именно.

import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
} from '../lib/manifest-format.js?v=202609121930';
import { dropUnwritableConditionalFormatting } from '../lib/xlsx-safe-write.js?v=202609130013';

const NEW_COLUMN_HEADER = 'Расхождения с исходным файлом';
const YELLOW_ARGB = 'FFFFFF00';
const ORANGE_ARGB = 'FFFF9900';
const NUMBER_EPSILON = 0.01;

// Полные названия портов назначения в системе для кода из исходного файла
// (PlaceOfDelivery) — только для текста сообщения; сравнивается сам код
// в скобках, см. portCode.
const PORT_NAMES = {
  RUPLP: 'St.Petersburg, Timber Port (RUPLP)',
  RUKGD: 'KALININGRAD (RUKGD)',
};

function cellText(cell) {
  if (!cell) return '';
  // Объединённая ячейка с пустым мастером бросает исключение при чтении .text
  // (см. dg-check/core.js) — здесь это «пусто», а не падение инструмента.
  try {
    const value = cell.text;
    if (value === undefined || value === null) return '';
    return String(value).trim();
  } catch {
    return '';
  }
}

// Число из ячейки: в исходном файле веса и места бывают и числом, и текстом
// («6009.35», «005» у температуры, иногда с запятой).
function cellNumber(cell) {
  if (!cell) return null;
  let value = cell.value;
  if (value && typeof value === 'object' && 'result' in value) value = value.result;
  if (typeof value === 'number') return value;
  const match = /[-+]?\d+(?:[.,]\d+)?/.exec(cellText(cell).replace(/\s/g, ''));
  return match ? Number(match[0].replace(',', '.')) : null;
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function normalizeHeader(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Текстовые поля сравниваются без учёта регистра и пробелов вообще: в исходном
// файле наименование груза и адреса разбиты переносами строк, у отправителя/
// получателя имя и адрес — две графы, а система склеивает их в одну через
// пробел (или без него: «"AVTOTOR TERMINAL"LTD») — разница в пробелах не
// расхождение данных. Апостроф в начале — след текстового префикса Excel в
// выгрузке линии («'LLC "KOMTRANS"…» в реальном файле), система его не пишет.
function compact(text) {
  return String(text ?? '').toUpperCase().replace(/\s+/g, '').replace(/^'/, '');
}

// Для показа в сообщении — переносы строк в одну строку.
function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// Код порта: из «St.Petersburg, Timber Port (RUPLP)» — RUPLP, иначе весь текст.
function portCode(text) {
  const match = /\(([A-Z]{5})\)\s*$/i.exec(text.trim());
  return (match ? match[1] : text).trim().toUpperCase();
}

function valueSet(text) {
  return new Set(
    String(text ?? '')
      .split(/[,;/\n]+/)
      .map((part) => compact(part))
      .filter(Boolean),
  );
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function sameNumber(a, b) {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= NUMBER_EPSILON;
}

/* ——— Тип контейнера: один тип или нет ———
   Тот же приём, что parseIso/sameIsoType в template-check/core.js (там не
   экспортируется): линия и система пишут один тип по-разному — 20GP/20DC,
   40RH/40RF. Сравниваются длина, группа и высота (там, где известна у обоих). */

const ISO_LENGTH = { 1: 10, 2: 20, 3: 30, 4: 40, L: 45 };
const ISO_HEIGHT = { 0: 'STD', 1: 'STD', 2: 'STD', 3: 'STD', 4: 'STD', 5: 'HC', 6: 'HC', 8: 'LOW', 9: 'LOW' };
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
  const text = compact(code);
  if (!text) return null;
  const common = ISO_COMMON.get(text);
  if (common) return { length: common[0], height: common[1], group: common[2] };
  if (/^[1-9L][0-9][A-Z][0-9]$/.test(text)) {
    const length = ISO_LENGTH[text[0]];
    const height = ISO_HEIGHT[text[1]];
    return length && height ? { length, height, group: text[2] } : null;
  }
  return null;
}

function sameContainerType(a, b) {
  const first = parseIso(a);
  const second = parseIso(b);
  if (!first || !second) return compact(a) === compact(b);
  if (first.length !== second.length || first.group !== second.group) return false;
  return !(first.height && second.height && first.height !== second.height);
}

/* ——— Опасный груз ——— */

// «IMO 8 UN 2586;» → {"8|2586"} — тот же разбор, что в dg-check/order-check:
// разделители и группировка («IMO 9 UN 3077,3082») не важны, сравниваются пары.
function parseDangerousGoods(text) {
  const entries = new Set();
  const re = /IMO\s*([\d.]+)\s*UN\s*(\d+(?:\s*,\s*\d+)*)/gi;
  let match;
  while ((match = re.exec(text || ''))) {
    for (const un of match[2].split(',')) entries.add(`${match[1].trim()}|${un.trim()}`);
  }
  return entries;
}

// В исходном файле класс и UN — две графы; несколько значений — через запятую
// или перенос строки, попарно.
function sourceDangerousGoods(classText, unText) {
  const classes = classText.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const numbers = unText.split(/[,;\n]+/).map((s) => s.trim().replace(/^UN\s*/i, '')).filter(Boolean);
  const entries = new Set();
  numbers.forEach((un, i) => entries.add(`${classes[i] ?? classes[0] ?? ''}|${un}`));
  if (!numbers.length) classes.forEach((cls) => entries.add(`${cls}|`));
  return entries;
}

function formatDangerousGoods(entries) {
  return [...entries].map((pair) => `IMO ${pair.replace('|', ' UN ')}`.trim()).join(', ');
}

/* ——— Исходный файл ——— */

// Заголовки исходного файла сравниваются точно (после normalizeHeader), не
// вхождением: SHIPPER — часть SHIPPER_ADDRESS, CONSIGNEE — CONSIGNEE_ADDRESS.
const SOURCE_COLUMNS = [
  { key: 'billOfLading', headers: ['номер коносамента'], label: '«номер коносамента»' },
  { key: 'container', headers: ['номер контейнера'], label: '«номер контейнера»' },
  { key: 'type', headers: ['тип контейнера'], label: '«Тип контейнера»' },
  { key: 'cargoName', headers: ['cargoname_eng'], label: 'CARGONAME_ENG' },
  { key: 'seal', headers: ['seal'], label: 'SEAL' },
  { key: 'places', headers: ['places'], label: 'PLACES' },
  { key: 'packageName', headers: ['наименование упаковки'], label: '«Наименование упаковки»' },
  { key: 'cargoWeight', headers: ['cargoweight'], label: 'CARGOWEIGHT' },
  { key: 'placeOfReceipt', headers: ['placeofreceipt'], label: 'PlaceOfReceipt' },
  { key: 'placeOfDelivery', headers: ['placeofdelivery'], label: 'PlaceOfDelivery' },
  { key: 'shipper', headers: ['shipper'], label: 'SHIPPER' },
  { key: 'shipperAddress', headers: ['shipper_address'], label: 'SHIPPER_ADDRESS' },
  { key: 'consignee', headers: ['consignee'], label: 'CONSIGNEE' },
  { key: 'consigneeAddress', headers: ['consignee_address'], label: 'CONSIGNEE_ADDRESS' },
  { key: 'temperature', headers: ['температура'], label: '«Температура»' },
  { key: 'imoClass', headers: ['imo class'], label: 'IMO CLASS' },
  { key: 'unNumber', headers: ['unno'], label: 'UNNO' },
  { key: 'tareWeight', headers: ['tareweight'], label: 'TAREWEIGHT' },
];

function findSourceHeader(sheet) {
  for (let r = 1; r <= Math.min(sheet.rowCount, 50); r++) {
    const row = sheet.getRow(r);
    const columns = {};
    for (let c = 1; c <= row.cellCount; c++) {
      const text = normalizeHeader(cellText(row.getCell(c)));
      const spec = SOURCE_COLUMNS.find((s) => s.headers.includes(text));
      if (spec && !columns[spec.key]) columns[spec.key] = c;
    }
    if (columns.container && columns.billOfLading) return { headerRow: r, columns };
  }
  return null;
}

/**
 * Разбирает исходный файл линии в строки по контейнеру.
 * @returns {{ok:true, rows: object[]} | {ok:false, error:string}}
 */
export function readSourceManifest(workbook) {
  for (const sheet of workbook.worksheets) {
    const header = findSourceHeader(sheet);
    if (!header) continue;
    const missing = SOURCE_COLUMNS.filter((s) => !header.columns[s.key]).map((s) => s.label);
    if (missing.length) {
      return { ok: false, error: `В исходном файле не найден заголовок ${missing.join(', ')}` };
    }
    const rows = [];
    for (let r = header.headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const get = (key) => row.getCell(header.columns[key]);
      const container = compact(cellText(get('container')));
      if (!container) continue;
      rows.push({
        row: r,
        container,
        billOfLading: cellText(get('billOfLading')),
        type: cellText(get('type')),
        cargoName: cellText(get('cargoName')),
        seal: cellText(get('seal')),
        places: cellNumber(get('places')),
        packageName: cellText(get('packageName')),
        cargoWeight: cellNumber(get('cargoWeight')),
        placeOfReceipt: cellText(get('placeOfReceipt')),
        placeOfDelivery: cellText(get('placeOfDelivery')),
        shipper: `${cellText(get('shipper'))} ${cellText(get('shipperAddress'))}`.trim(),
        consignee: `${cellText(get('consignee'))} ${cellText(get('consigneeAddress'))}`.trim(),
        temperature: cellNumber(get('temperature')),
        dangerousGoods: sourceDangerousGoods(cellText(get('imoClass')), cellText(get('unNumber'))),
        tareWeight: cellNumber(get('tareWeight')),
      });
    }
    if (!rows.length) return { ok: false, error: 'В исходном файле не найдено ни одной строки с номером контейнера' };
    return { ok: true, rows };
  }
  return {
    ok: false,
    error: 'В исходном файле не найдена строка заголовков («номер коносамента», «номер контейнера»)',
  };
}

/* ——— Манифест системы ——— */

// Колонки манифеста ищутся по заголовку строки COLUMN_HEADER_ROW, как везде на
// сайте. «Груз» — точным совпадением: «груз» входит в «Веc груза» и «Груз (перевод)».
const SYSTEM_COLUMNS = [
  { key: 'container', match: (h) => h.includes('контейнер'), label: '«№ контейнера»' },
  { key: 'type', match: (h) => h.includes('футность'), label: '«Футность»' },
  { key: 'departure', match: (h) => h.includes('отправления'), label: '«Порт отправления»' },
  { key: 'destination', match: (h) => h.includes('назначения'), label: '«Порт назначения»' },
  { key: 'cargoWeight', match: (h) => h.includes('груза'), label: '«Веc груза»' },
  { key: 'tareWeight', match: (h) => h.includes('тары'), label: '«Веc тары»' },
  { key: 'totalWeight', match: (h) => h.includes('общий'), label: '«Общий Веc»' },
  { key: 'dangerous', match: (h) => h.includes('опасн'), label: '«Опасные грузы»' },
  { key: 'temperature', match: (h) => h.includes('темп'), label: '«Темп-ра»' },
  { key: 'billOfLading', match: (h) => h.includes('коносамент'), label: '«№ коносамента»' },
  { key: 'seals', match: (h) => h.includes('пломб'), label: '«Пломбы»' },
  { key: 'cargoName', match: (h) => h === 'груз', label: '«Груз»' },
  { key: 'places', match: (h) => h.includes('количество мест'), label: '«Количество мест»' },
  { key: 'packageType', match: (h) => h.includes('тип мест'), label: '«Тип мест»' },
  { key: 'shipper', match: (h) => h.includes('отправитель'), label: '«Отправитель»' },
  { key: 'consignee', match: (h) => h.includes('получатель'), label: '«Получатель»' },
];

function findSystemColumns(sheet) {
  const row = sheet.getRow(COLUMN_HEADER_ROW);
  const columns = {};
  for (let c = FIRST_COLUMN; c <= LAST_COLUMN; c++) {
    const text = normalizeHeader(cellText(row.getCell(c)));
    if (!text) continue;
    const spec = SYSTEM_COLUMNS.find((s) => !columns[s.key] && s.match(text));
    if (spec) columns[spec.key] = c;
  }
  const missing = SYSTEM_COLUMNS.filter((s) => !columns[s.key]).map((s) => s.label);
  if (missing.length) {
    return { ok: false, error: `В манифесте системы не найден заголовок ${missing.join(', ')}` };
  }
  return { ok: true, columns };
}

/* ——— Сверка ——— */

// Подписи категорий — те же ключи, что в summary.byField (порядок = порядок
// в сводке на странице).
export const FIELD_LABELS = [
  ['billOfLading', 'номер коносамента'],
  ['type', 'тип контейнера'],
  ['departure', 'порт отправления'],
  ['destination', 'порт назначения'],
  ['cargoWeight', 'вес груза'],
  ['tareWeight', 'вес тары'],
  ['totalWeight', 'общий вес'],
  ['dangerous', 'опасный груз'],
  ['temperature', 'температура'],
  ['seals', 'пломбы'],
  ['cargoName', 'наименование груза'],
  ['places', 'количество мест'],
  ['packageType', 'тип мест'],
  ['shipper', 'отправитель'],
  ['consignee', 'получатель'],
];

const show = (value) => (value === null || value === '' ? '—' : value);

// repeat — контейнер уже встречался выше в манифесте системы (тот же контейнер
// под вторым коносаментом): система пишет вес тары только в одной из его
// строк, в остальных 0 — иначе в итогах по манифесту тара посчиталась бы
// дважды (в реальном файле — XYLU1228460, в исходном 2000 на обеих строках).
function compareRow(source, row, cols, repeat) {
  const issues = []; // {key, text}
  const text = (key) => cellText(row.getCell(cols[key]));
  const number = (key) => cellNumber(row.getCell(cols[key]));
  const add = (key, message) => issues.push({ key, text: message });

  if (compact(text('billOfLading')) !== compact(source.billOfLading)) {
    add('billOfLading', `коносамент: в системе «${show(text('billOfLading'))}», в исходном «${show(source.billOfLading)}»`);
  }
  if (!sameContainerType(text('type'), source.type)) {
    add('type', `тип контейнера: в системе «${show(text('type'))}», в исходном «${show(source.type)}»`);
  }
  if (portCode(text('departure')) !== portCode(source.placeOfReceipt)) {
    add('departure', `порт отправления: в системе «${show(text('departure'))}», в исходном (PlaceOfReceipt) «${show(source.placeOfReceipt)}»`);
  }
  if (portCode(text('destination')) !== portCode(source.placeOfDelivery)) {
    const code = source.placeOfDelivery.toUpperCase();
    const expected = PORT_NAMES[code] ? `${PORT_NAMES[code]}` : source.placeOfDelivery;
    add('destination', `порт назначения: в системе «${show(text('destination'))}», ожидается «${show(expected)}» (PlaceOfDelivery ${show(source.placeOfDelivery)})`);
  }

  const cargoWeight = number('cargoWeight');
  if (!sameNumber(cargoWeight, source.cargoWeight)) {
    add('cargoWeight', `вес груза: в системе ${show(cargoWeight)}, в исходном ${show(source.cargoWeight)}`);
  }
  const tareWeight = number('tareWeight');
  const tareOnOtherRow = repeat && tareWeight === 0;
  if (!tareOnOtherRow && !sameNumber(tareWeight, source.tareWeight)) {
    add('tareWeight', `вес тары: в системе ${show(tareWeight)}, в исходном ${show(source.tareWeight)}`);
  }
  // Общий вес — по весам исходного файла, не по соседним графам системы:
  // ошибка в самом «Общем весе» при верных весе груза и тары тоже ловится.
  if (source.cargoWeight !== null && source.tareWeight !== null) {
    const tare = tareOnOtherRow ? 0 : source.tareWeight;
    const expectedTotal = Math.round((source.cargoWeight + tare) * 1000) / 1000;
    const totalWeight = number('totalWeight');
    if (!sameNumber(totalWeight, expectedTotal)) {
      add('totalWeight', `общий вес: в системе ${show(totalWeight)}, ожидается ${expectedTotal} (вес груза + вес тары по исходному)`);
    }
  }

  const systemDg = parseDangerousGoods(text('dangerous'));
  if (!sameSet(systemDg, source.dangerousGoods)) {
    add('dangerous', `опасный груз: в системе «${show(text('dangerous').replace(/;\s*$/, ''))}», в исходном «${show(formatDangerousGoods(source.dangerousGoods))}»`);
  }
  const temperature = number('temperature');
  if (!sameNumber(temperature, source.temperature)) {
    add('temperature', `температура: в системе ${show(temperature)}, в исходном ${show(source.temperature)}`);
  }
  if (!sameSet(valueSet(text('seals')), valueSet(source.seal))) {
    add('seals', `пломбы: в системе «${show(text('seals'))}», в исходном «${show(oneLine(source.seal))}»`);
  }
  if (compact(text('cargoName')) !== compact(source.cargoName)) {
    add('cargoName', `наименование груза: в системе «${show(oneLine(text('cargoName')))}», в исходном «${show(oneLine(source.cargoName))}»`);
  }
  const places = number('places');
  if (!sameNumber(places, source.places)) {
    add('places', `количество мест: в системе ${show(places)}, в исходном ${show(source.places)}`);
  }
  if (compact(text('packageType')) !== compact(source.packageName)) {
    add('packageType', `тип мест: в системе «${show(text('packageType'))}», в исходном «${show(source.packageName)}»`);
  }
  if (compact(text('shipper')) !== compact(source.shipper)) {
    add('shipper', `отправитель: в системе «${show(oneLine(text('shipper')))}», в исходном «${show(oneLine(source.shipper))}»`);
  }
  if (compact(text('consignee')) !== compact(source.consignee)) {
    add('consignee', `получатель: в системе «${show(oneLine(text('consignee')))}», в исходном «${show(oneLine(source.consignee))}»`);
  }
  return issues;
}

function paint(cell, argb) {
  const style = cloneStyle(cell.style);
  style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  cell.style = style;
}

/**
 * Сверяет манифест системы с исходным файлом линии по номеру контейнера и
 * дописывает в манифест столбец с расхождениями (мутирует и возвращает тот же
 * systemWb, как crossCheckOrders/crossCheckDangerousGoods).
 *
 * @param {import('exceljs').Workbook} sourceWb — исходный файл линии
 * @param {import('exceljs').Workbook} systemWb — манифест из системы (лист "Manifest")
 * @returns {{ok:true, resultWorkbook, summary:{totalRows, mismatchRows, notInSource, byField, missingInSystem: Array<{container, billOfLading, row}>}} | {ok:false, error:string}}
 */
export function crossCheckSource(sourceWb, systemWb) {
  const source = readSourceManifest(sourceWb);
  if (!source.ok) return source;

  const sheet = systemWb.getWorksheet(SHEET_NAME);
  if (!sheet) return { ok: false, error: `В манифесте системы не найден лист "${SHEET_NAME}"` };
  const found = findSystemColumns(sheet);
  if (!found.ok) return found;
  const cols = found.columns;

  const byContainer = new Map(); // контейнер -> строки исходного файла
  for (const entry of source.rows) {
    if (!byContainer.has(entry.container)) byContainer.set(entry.container, []);
    byContainer.get(entry.container).push(entry);
  }
  const used = new Set();
  const seenInSystem = new Set();

  const newCol = LAST_COLUMN + 1;
  const headerCell = sheet.getRow(COLUMN_HEADER_ROW).getCell(newCol);
  headerCell.value = NEW_COLUMN_HEADER;
  headerCell.style = cloneStyle(sheet.getRow(COLUMN_HEADER_ROW).getCell(LAST_COLUMN).style);
  sheet.getColumn(newCol).width = 80;

  const summary = {
    totalRows: 0,
    mismatchRows: 0,
    notInSource: 0,
    byField: Object.fromEntries(FIELD_LABELS.map(([key]) => [key, 0])),
    missingInSystem: [],
  };

  for (let r = DATA_START_ROW; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const container = compact(cellText(row.getCell(cols.container)));
    if (!container) continue; // пустые строки и строка-довесок с СУММ() — не данные
    summary.totalRows += 1;

    const candidates = byContainer.get(container) || [];
    const bl = compact(cellText(row.getCell(cols.billOfLading)));
    const entry =
      candidates.find((c) => !used.has(c) && compact(c.billOfLading) === bl) ||
      candidates.find((c) => !used.has(c)) ||
      candidates[0];

    let messages;
    const badCells = [];
    if (!entry) {
      messages = ['контейнера нет в исходном файле'];
      summary.notInSource += 1;
    } else {
      used.add(entry);
      const issues = compareRow(entry, row, cols, seenInSystem.has(container));
      messages = issues.map((i) => i.text);
      for (const { key } of issues) {
        summary.byField[key] += 1;
        badCells.push(cols[key]);
      }
    }

    seenInSystem.add(container);

    if (messages.length) {
      summary.mismatchRows += 1;
      const cell = row.getCell(newCol);
      cell.value = messages.join('\n');
      for (let c = FIRST_COLUMN; c <= newCol; c++) paint(row.getCell(c), YELLOW_ARGB);
      for (const c of badCells) paint(row.getCell(c), ORANGE_ARGB);
      const style = cloneStyle(cell.style);
      style.alignment = { ...(style.alignment || {}), wrapText: true, vertical: 'top' };
      cell.style = style;
    } else {
      row.getCell(newCol).value = null;
    }
  }

  summary.missingInSystem = source.rows
    .filter((entry) => !used.has(entry))
    .map((entry) => ({ container: entry.container, billOfLading: entry.billOfLading, row: entry.row }));

  dropUnwritableConditionalFormatting(sheet);
  return { ok: true, resultWorkbook: systemWb, summary };
}
