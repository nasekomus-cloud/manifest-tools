// Файлы для загрузки в АРМ из исходного файла линии (вкладка «Импорт»).
//
// Принцип восстановлен по образцам пользователя («for ARM uploading OVP ZENITH
// 2602W_RUPLP_CNNSHA/EGEDK/TRIST.xlsx», 2026-10-14, все 455 строк исходного
// сошлись с образцами по значениям):
//   — исходный файл делится на файлы по порту погрузки (PlaceOfReceipt), строки
//     внутри файла — в порядке исходного;
//   — лист IMPORT_MANIFEST, шапка рейса D1:E5 (Судно, Рейс, Дата прихода,
//     Терминал погрузки, Терминал выгрузки), заголовки в 7-й строке, данные с 8-й;
//   — колонки те же A:Z, что у исходного, кроме:
//       D POL           — название порта погрузки по справочнику (NANSHA,CHINA (CNNSA)),
//       E TOL           — терминал погрузки (как в шапке), а не код порта выгрузки,
//       H SEAL          — пломбы через «, », а не «/»,
//       J/K             — «Наименование упаковки» исходного идёт в J «Тип упаковки», K пустая,
//       O PlaceOfDelivery — полное название (St.Petersburg, Timber Port (RUPLP)),
//       V Температура   — числом («005» → 5),
//       W IMO           — класс и UN одной графой « 8 UN:2586» вместо двух граф,
//       X TAREWEIGHT    — 0 во второй и следующих строках того же контейнера
//                         (контейнер под несколькими коносаментами — тара один раз),
//       Y ISEMPTY       — как есть,
//       Z дата коносамента — вводится вручную, одна на порт погрузки (в исходном её нет).
//
// Чистый модуль: ExcelJS не импортирует — книгу для результата даёт вызывающий
// (options.createWorkbook), как в template-check/core.js.

/* ——— Справочники ——— */

// Порт погрузки (код PlaceOfReceipt) → название для POL, терминал погрузки и
// код в имени файла. Значения — из образцов пользователя. Неизвестный код
// не ошибка: поля на странице заполняются вручную.
export const LOADING_PORTS = {
  CNNSA: { pol: 'NANSHA,CHINA (CNNSA)', terminal: 'NICT (Guangzhou Nansha Container Terminal)', fileCode: 'CNNSHA' },
  EGEDK: { pol: 'Alexandria', terminal: 'El Dekheila Alexandria Int. Container Terminal', fileCode: 'EGEDK' },
  TRIST: { pol: 'ISTANBUL', terminal: 'Kumport Terminal (ISTANBUL)', fileCode: 'TRIST' },
};

// Порт назначения (код PlaceOfDelivery) → полное название, как в системе
// (то же, что PORT_NAMES в source-check/core.js).
export const DISCHARGE_PORTS = {
  RUPLP: 'St.Petersburg, Timber Port (RUPLP)',
  RUKGD: 'KALININGRAD (RUKGD)',
};

export const DEFAULT_DISCHARGE_TERMINAL = 'Timber Port';
export const DEFAULT_DISCHARGE_CODE = 'RUPLP';

/* ——— Форма результата ——— */

export const SHEET_NAME = 'IMPORT_MANIFEST';
const HEADER_ROW = 7;
const DATA_START_ROW = 8;

// Заголовки и ширины колонок A:Z — как в образце.
const OUTPUT_COLUMNS = [
  ['номер коносамента', 26.71],
  ['номер контейнера', 20.14],
  ['Тип контейнера', 12.71],
  ['POL', 38.14],
  ['TOL', 47.29],
  ['CARGONAME_ENG', 57.14],
  ['CARGONAME_RUS', 17.86],
  ['SEAL', 46.43],
  ['PLACES', 17.86],
  ['Тип упаковки', 13.71],
  ['Наименование упаковки', 25.71],
  ['CARGOWEIGHT', 16.14],
  ['MEASUREMENT', 14.86],
  ['PlaceOfReceipt', 22.71],
  ['PlaceOfDelivery', 49.86],
  ['SHIPPER', 47.29],
  ['SHIPPER_ADDRESS', 59.14],
  ['CONSIGNEE', 60.71],
  ['CONSIGNEE_ADDRESS', 67.71],
  ['NOTIFY', 33.71],
  ['NOTIFY_ADDRESS', 70.14],
  ['Температура', 14.86],
  ['IMO', 76.29],
  ['TAREWEIGHT', 14.86],
  ['ISEMPTY', 11.86],
  ['дата коносамента', 18.43],
];

// Колонки исходного файла — точным совпадением заголовка (как в
// source-check/core.js: SHIPPER — часть SHIPPER_ADDRESS).
const SOURCE_COLUMNS = [
  { key: 'billOfLading', headers: ['номер коносамента'], label: 'номер коносамента' },
  { key: 'container', headers: ['номер контейнера'], label: 'номер контейнера' },
  { key: 'type', headers: ['тип контейнера'], label: 'Тип контейнера' },
  { key: 'pol', headers: ['pol'], label: 'POL' },
  { key: 'cargoName', headers: ['cargoname_eng'], label: 'CARGONAME_ENG' },
  { key: 'cargoNameRus', headers: ['cargoname_rus'], label: 'CARGONAME_RUS', optional: true },
  { key: 'seal', headers: ['seal'], label: 'SEAL' },
  { key: 'places', headers: ['places'], label: 'PLACES' },
  { key: 'packageType', headers: ['тип упаковки'], label: 'Тип упаковки', optional: true },
  { key: 'packageName', headers: ['наименование упаковки'], label: 'Наименование упаковки' },
  { key: 'cargoWeight', headers: ['cargoweight'], label: 'CARGOWEIGHT' },
  { key: 'measurement', headers: ['measurement', 'measuremen'], label: 'MEASUREMENT', optional: true },
  { key: 'placeOfReceipt', headers: ['placeofreceipt'], label: 'PlaceOfReceipt' },
  { key: 'placeOfDelivery', headers: ['placeofdelivery'], label: 'PlaceOfDelivery' },
  { key: 'shipper', headers: ['shipper'], label: 'SHIPPER' },
  { key: 'shipperAddress', headers: ['shipper_address'], label: 'SHIPPER_ADDRESS' },
  { key: 'consignee', headers: ['consignee'], label: 'CONSIGNEE' },
  { key: 'consigneeAddress', headers: ['consignee_address'], label: 'CONSIGNEE_ADDRESS' },
  { key: 'notify', headers: ['notify'], label: 'NOTIFY', optional: true },
  { key: 'notifyAddress', headers: ['notify_address'], label: 'NOTIFY_ADDRESS', optional: true },
  { key: 'temperature', headers: ['температура'], label: 'Температура', optional: true },
  { key: 'imoClass', headers: ['imo class'], label: 'IMO CLASS', optional: true },
  { key: 'unNumber', headers: ['unno'], label: 'UNNO', optional: true },
  { key: 'tareWeight', headers: ['tareweight'], label: 'TAREWEIGHT' },
  { key: 'isEmpty', headers: ['isempty'], label: 'ISEMPTY', optional: true },
];

/* ——— Чтение исходного ——— */

function cellText(cell) {
  if (!cell) return '';
  // Объединённая ячейка с пустым мастером бросает исключение при чтении .text
  // (см. dg-check/core.js).
  try {
    const value = cell.text;
    return value === undefined || value === null ? '' : String(value);
  } catch {
    return '';
  }
}

// Значение ячейки как есть (число остаётся числом, текст — текстом), формула —
// её результат, пусто — null.
function cellValue(cell) {
  let value = cell ? cell.value : null;
  if (value && typeof value === 'object') {
    if ('result' in value) value = value.result;
    else if (value instanceof Date) return value;
    else if (Array.isArray(value.richText)) value = value.richText.map((part) => part.text).join('');
    else if ('text' in value) value = value.text;
    else if ('error' in value) return null;
  }
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function normalizeHeader(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findHeader(sheet) {
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

// Шапка рейса над таблицей: подпись в одной ячейке, значение — первая
// непустая правее. «Рейс» в реальном файле — три строки (2601W, 25, 2602W).
function readVoyageHeader(sheet, headerRow) {
  const header = { vessel: [], voyage: [] };
  const labels = { судно: 'vessel', рейс: 'voyage' };
  for (let r = 1; r < headerRow; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      const key = labels[normalizeHeader(cellText(row.getCell(c)))];
      if (!key) continue;
      for (let v = c + 1; v <= row.cellCount; v++) {
        const value = cellText(row.getCell(v)).trim();
        if (value) {
          if (!header[key].includes(value)) header[key].push(value);
          break;
        }
      }
      break;
    }
  }
  return header;
}

function code(text) {
  return String(text ?? '').toUpperCase().replace(/\s+/g, '');
}

/**
 * Разбирает исходный файл линии.
 * @returns {{ok:true, rows: object[], vessel: string, voyage: string, voyages: string[],
 *   loadingPorts: Array<{code, rows, containers, known, pol, terminal, fileCode}>,
 *   unknownDischarge: string[]} | {ok:false, error:string}}
 */
export function readSource(workbook) {
  for (const sheet of workbook.worksheets) {
    const found = findHeader(sheet);
    if (!found) continue;
    const { headerRow, columns } = found;
    const missing = SOURCE_COLUMNS.filter((s) => !s.optional && !columns[s.key]).map((s) => `«${s.label}»`);
    if (missing.length) return { ok: false, error: `В исходном файле нет колонки ${missing.join(', ')}` };

    const rows = [];
    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      if (!cellText(row.getCell(columns.container)).trim()) continue;
      const data = { row: r };
      for (const spec of SOURCE_COLUMNS) data[spec.key] = columns[spec.key] ? cellValue(row.getCell(columns[spec.key])) : null;
      data.portCode = code(data.placeOfReceipt);
      rows.push(data);
    }
    if (!rows.length) return { ok: false, error: 'В исходном файле не найдено ни одной строки с номером контейнера' };

    const ports = new Map();
    for (const data of rows) {
      if (!ports.has(data.portCode)) ports.set(data.portCode, { rows: [], pols: new Map() });
      const port = ports.get(data.portCode);
      port.rows.push(data);
      const pol = String(data.pol ?? '').trim();
      if (pol) port.pols.set(pol, (port.pols.get(pol) || 0) + 1);
    }
    const loadingPorts = [...ports].map(([portCode, port]) => {
      const known = LOADING_PORTS[portCode];
      // Неизвестный порт: POL — самое частое название из исходного с кодом в
      // скобках (как «NANSHA,CHINA (CNNSA)»), терминал — вписать вручную.
      const commonPol = [...port.pols].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      return {
        code: portCode,
        rows: port.rows.length,
        containers: new Set(port.rows.map((d) => code(d.container))).size,
        known: Boolean(known),
        pol: known ? known.pol : commonPol && portCode ? `${commonPol} (${portCode})` : commonPol,
        terminal: known ? known.terminal : '',
        fileCode: known ? known.fileCode : portCode,
      };
    });

    const unknownDischarge = [...new Set(rows.map((d) => code(d.placeOfDelivery)))].filter(
      (c) => c && !DISCHARGE_PORTS[c] && !/\([A-Z]{5}\)\s*$/.test(c),
    );
    const header = readVoyageHeader(sheet, headerRow);
    return {
      ok: true,
      rows,
      vessel: header.vessel[0] ?? '',
      // По умолчанию — последний «Рейс» шапки: в реальном файле 2601W, 25,
      // 2602W, а файлы для АРМ — 2602W.
      voyage: header.voyage[header.voyage.length - 1] ?? '',
      voyages: header.voyage,
      loadingPorts,
      unknownDischarge,
    };
  }
  return {
    ok: false,
    error: 'Не найдена строка заголовков («номер коносамента», «номер контейнера») — это точно исходный файл линии?',
  };
}

/* ——— Преобразования колонок ——— */

function sealList(value) {
  if (value === null) return null;
  const parts = String(value).split(/\s*[/,;\n]\s*/).map((s) => s.trim()).filter(Boolean);
  return parts.join(', ') || null;
}

function temperatureValue(value) {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  const text = String(value).trim().replace(',', '.');
  return /^[-+]?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

// Класс и UN из двух граф исходного — одной графой, как в образце: « 8 UN:2586».
// Несколько значений (через запятую/перенос) — попарно, через «, ».
function imoValue(classValue, unValue) {
  const split = (v) => String(v ?? '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const classes = split(classValue).map((s) => s.replace(/^(IMO|CLASS)\s*/i, ''));
  const numbers = split(unValue).map((s) => s.replace(/^UN\s*/i, ''));
  if (!classes.length && !numbers.length) return null;
  if (!numbers.length) return classes.map((cls) => ` ${cls}`).join(',');
  return numbers.map((un, i) => ` ${classes[i] ?? classes[0] ?? ''} UN:${un}`).join(',');
}

function deliveryName(value) {
  const text = String(value ?? '').trim();
  return DISCHARGE_PORTS[code(text)] ?? (text || null);
}

/* ——— Сборка книги ——— */

const FONT = { name: 'Calibri', family: 2, charset: 204, scheme: 'minor', size: 11, color: { argb: 'FF000000' } };
const THIN = { style: 'thin' };
const MEDIUM = { style: 'medium' };
const DATE_NUMFMT = 'mm-dd-yy'; // встроенный формат 14 — короткая дата по настройкам Excel

function utcDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate ?? ''));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

function buildWorkbook(workbook, rows, { vessel, voyage, arrivalDate, loadingTerminal, dischargeTerminal, pol, billDate }) {
  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: 'frozen', xSplit: 0, ySplit: HEADER_ROW, topLeftCell: `A${DATA_START_ROW}` }],
    properties: { defaultRowHeight: 15, defaultColWidth: 10 },
  });
  Object.assign(sheet.pageSetup, {
    paperSize: 9,
    orientation: 'landscape',
    margins: { left: 0.196, right: 0.196, top: 0.196, bottom: 0.196, header: 0, footer: 0 },
  });
  OUTPUT_COLUMNS.forEach(([, width], i) => { sheet.getColumn(i + 1).width = width; });

  // Шапка рейса D1:E5.
  const headerFields = [
    ['Судно', vessel],
    ['Рейс', voyage],
    ['Дата прихода', utcDate(arrivalDate)],
    ['Терминал погрузки', loadingTerminal],
    ['Терминал выгрузки', dischargeTerminal],
  ];
  headerFields.forEach(([label, value], i) => {
    const r = i + 1;
    const labelCell = sheet.getCell(`D${r}`);
    labelCell.value = label;
    labelCell.font = { ...FONT, bold: true };
    labelCell.alignment = { vertical: 'middle', wrapText: true };
    const valueCell = sheet.getCell(`E${r}`);
    valueCell.value = value || null;
    valueCell.font = { ...FONT };
    valueCell.alignment = { vertical: 'middle', wrapText: true };
    if (value instanceof Date) {
      valueCell.numFmt = DATE_NUMFMT;
      valueCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    }
  });
  for (let r = 1; r <= 6; r++) sheet.getRow(r).height = 16.35;

  // Заголовки колонок: жирный 10, рамка medium снаружи, thin между колонками.
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 33.75;
  OUTPUT_COLUMNS.forEach(([title], i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = title;
    cell.font = { ...FONT, size: 10, bold: true, color: { theme: 1 } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = {
      left: i === 0 ? MEDIUM : THIN,
      right: i === OUTPUT_COLUMNS.length - 1 ? MEDIUM : THIN,
      top: MEDIUM,
      bottom: MEDIUM,
    };
  });

  const date = utcDate(billDate);
  const seenContainers = new Set();
  rows.forEach((data, i) => {
    const container = code(data.container);
    const repeat = seenContainers.has(container);
    seenContainers.add(container);
    const values = [
      data.billOfLading,
      data.container,
      data.type,
      pol || data.pol,
      loadingTerminal || null,
      data.cargoName,
      data.cargoNameRus,
      sealList(data.seal),
      data.places,
      data.packageName,
      data.packageType,
      data.cargoWeight,
      data.measurement,
      data.placeOfReceipt,
      deliveryName(data.placeOfDelivery),
      data.shipper,
      data.shipperAddress,
      data.consignee,
      data.consigneeAddress,
      data.notify,
      data.notifyAddress,
      temperatureValue(data.temperature),
      imoValue(data.imoClass, data.unNumber),
      repeat ? 0 : data.tareWeight,
      data.isEmpty,
      date,
    ];
    const row = sheet.getRow(DATA_START_ROW + i);
    values.forEach((value, c) => {
      const cell = row.getCell(c + 1);
      cell.value = value ?? null;
      cell.font = { ...FONT };
      cell.alignment = { vertical: 'middle' };
      cell.border = { left: THIN, right: THIN, top: THIN, bottom: THIN };
      if (value instanceof Date) cell.numFmt = DATE_NUMFMT;
    });
  });

  const lastRow = DATA_START_ROW + rows.length - 1;
  sheet.autoFilter = `A${HEADER_ROW}:Z${lastRow}`;
  return sheet;
}

/**
 * Собирает по файлу для АРМ на каждый порт погрузки.
 *
 * @param {object} source — результат readSource (ok:true)
 * @param {{vessel, voyage, arrivalDate: 'YYYY-MM-DD', dischargeTerminal, dischargeCode,
 *   ports: Object<string, {pol, terminal, fileCode, billDate: 'YYYY-MM-DD'}>,
 *   createWorkbook: () => import('exceljs').Workbook}} options
 * @returns {Array<{portCode, fileName, rows, containers, workbook}>}
 */
export function buildArmFiles(source, options) {
  const { vessel, voyage, arrivalDate, dischargeTerminal, dischargeCode, ports, createWorkbook } = options;
  return source.loadingPorts.map((port) => {
    const settings = ports[port.code] ?? {};
    const rows = source.rows.filter((d) => d.portCode === port.code);
    const workbook = createWorkbook();
    buildWorkbook(workbook, rows, {
      vessel,
      voyage,
      arrivalDate,
      loadingTerminal: settings.terminal ?? port.terminal,
      dischargeTerminal,
      pol: settings.pol ?? port.pol,
      billDate: settings.billDate,
    });
    const fileCode = (settings.fileCode ?? port.fileCode) || port.code || 'PORT';
    return {
      portCode: port.code,
      fileName: safeFileName(`for ARM uploading ${vessel} ${voyage}_${dischargeCode}_${fileCode}.xlsx`),
      rows: rows.length,
      containers: port.containers,
      workbook,
    };
  });
}

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
}

/**
 * Что не заполнено на странице — список текстов; пустой — можно собирать.
 */
export function validateOptions(source, options) {
  const problems = [];
  if (!String(options.vessel ?? '').trim()) problems.push('судно');
  if (!String(options.voyage ?? '').trim()) problems.push('рейс');
  if (!utcDate(options.arrivalDate)) problems.push('дата прихода');
  if (!String(options.dischargeTerminal ?? '').trim()) problems.push('терминал выгрузки');
  if (!String(options.dischargeCode ?? '').trim()) problems.push('код порта выгрузки для имени файла');
  for (const port of source.loadingPorts) {
    const settings = options.ports[port.code] ?? {};
    const name = port.code || 'без кода';
    if (!utcDate(settings.billDate)) problems.push(`дата коносамента (${name})`);
    if (!String(settings.terminal ?? '').trim()) problems.push(`терминал погрузки (${name})`);
    if (!String(settings.pol ?? '').trim()) problems.push(`POL (${name})`);
  }
  return problems;
}
