import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crossCheckOrders } from './core.js';
import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
} from '../lib/manifest-format.js';

// Раскладка колонок сводного файла для тестов: C..I несут реальные заголовки,
// остальные до LAST_COLUMN — заполнитель без совпадений по ключевым словам.
const SUMMARY_HEADERS = [
  '№ контейнера',   // C
  'Футность',       // D
  'Веc груза',      // E
  'Веc тары',       // F
  'Общий Веc',      // G
  'Пломбы',         // H
  'Опасные грузы',  // I
  '№ поручения',    // J
];
const COL = {
  container: FIRST_COLUMN,
  futnost: FIRST_COLUMN + 1,
  cargoWeight: FIRST_COLUMN + 2,
  tareWeight: FIRST_COLUMN + 3,
  totalWeight: FIRST_COLUMN + 4,
  seals: FIRST_COLUMN + 5,
  dangerous: FIRST_COLUMN + 6,
  orderNumber: FIRST_COLUMN + 7,
};

function buildCombinedWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.getRow(3).getCell(FIRST_COLUMN).value = 'Рейс №1';
  const headerRow = sheet.getRow(COLUMN_HEADER_ROW);
  const filled = [
    ...SUMMARY_HEADERS,
    ...Array.from({ length: LAST_COLUMN - FIRST_COLUMN + 1 - SUMMARY_HEADERS.length }, (_, i) => `Колонка ${i + 8}`),
  ];
  filled.forEach((value, i) => headerRow.getCell(FIRST_COLUMN + i).value = value);

  rows.forEach((row, i) => {
    const r = sheet.getRow(DATA_START_ROW + i);
    r.getCell(COL.container).value = row.container;
    r.getCell(COL.futnost).value = row.futnost ?? null;
    r.getCell(COL.cargoWeight).value = row.cargoWeight ?? null;
    r.getCell(COL.tareWeight).value = row.tareWeight ?? null;
    // По умолчанию — сумма веса груза и тары этой же строки свода, чтобы
    // существующие фикстуры (без явного totalWeight) не превращались в
    // расхождение общего веса задним числом. Тесты на сам общий вес задают
    // его явно.
    const defaultTotal = (row.cargoWeight ?? 0) + (row.tareWeight ?? 0);
    r.getCell(COL.totalWeight).value = row.totalWeight ?? (row.cargoWeight === undefined && row.tareWeight === undefined ? null : defaultTotal);
    r.getCell(COL.seals).value = row.seals ?? null;
    r.getCell(COL.dangerous).value = row.dangerous ?? null;
    r.getCell(COL.orderNumber).value = row.orderNumber ?? null;
  });
  return workbook;
}

// Заголовки поручения на строке 8 — как в реальных файлах (шапка + строка 8),
// но core.js ищет строку заголовков по содержимому, а не по номеру 8 как таковому.
const ORDER_COL = {
  container: 1, iso: 2, seal: 3, cargoName: 4, hazardClass: 5, hazardCode: 6, grossWeight: 7, tareWeight: 8,
};

function buildOrderWorkbook(orderNumber, rows) {
  const workbook = new ExcelJS.Workbook();
  // Имя листа не может содержать "/" (как и в реальных файлах — там сам номер
  // поручения может нести "/", а имя листа его заменяет на "_").
  const sheet = workbook.addWorksheet(`№ ${orderNumber.replace(/\//g, '_')}`);
  sheet.getRow(1).getCell(1).value = 'Номер поручения';
  sheet.getRow(1).getCell(2).value = orderNumber;

  const header = sheet.getRow(8);
  header.getCell(ORDER_COL.container).value = 'Номер контейнера';
  header.getCell(ORDER_COL.iso).value = 'Код ИСО';
  header.getCell(ORDER_COL.seal).value = 'Номер пломбы';
  header.getCell(ORDER_COL.cargoName).value = 'Наименование груза, род упаковки';
  header.getCell(ORDER_COL.hazardClass).value = 'Класс опасности';
  header.getCell(ORDER_COL.hazardCode).value = 'Код опасности';
  header.getCell(ORDER_COL.grossWeight).value = 'Брутто груза';
  header.getCell(ORDER_COL.tareWeight).value = 'Вес контейнера';

  let r = 9;
  for (const row of rows) {
    const line = sheet.getRow(r++);
    line.getCell(ORDER_COL.container).value = row.container ?? null;
    line.getCell(ORDER_COL.iso).value = row.iso ?? null;
    line.getCell(ORDER_COL.seal).value = row.seal ?? null;
    line.getCell(ORDER_COL.cargoName).value = row.cargoName ?? null;
    line.getCell(ORDER_COL.hazardClass).value = row.hazardClass ?? null;
    line.getCell(ORDER_COL.hazardCode).value = row.hazardCode ?? null;
    line.getCell(ORDER_COL.grossWeight).value = row.grossWeight ?? null;
    line.getCell(ORDER_COL.tareWeight).value = row.tareWeight ?? null;
  }
  sheet.getRow(r).getCell(1).value = 'Дополнительные сведения';
  return workbook;
}

function orderEntry(fileName, orderNumber, rows) {
  return { fileName, workbook: buildOrderWorkbook(orderNumber, rows) };
}

function resultRow(result, index) {
  const sheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  return sheet.getRow(DATA_START_ROW + index);
}

function discrepancyText(result, index) {
  return resultRow(result, index).getCell(LAST_COLUMN + 1).text || '';
}

function isHighlighted(result, index) {
  const fill = resultRow(result, index).getCell(FIRST_COLUMN).fill;
  return !!(fill && fill.fgColor && fill.fgColor.argb === 'FFFFFF00');
}

test('crossCheckOrders: ширина существующих колонок сохраняется, у новой колонки задаётся своя', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const sheet = combinedWb.getWorksheet(SHEET_NAME);
  sheet.getColumn(COL.container).width = 12.5;
  sheet.getColumn(COL.dangerous).width = 40;

  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  const resultSheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  assert.equal(resultSheet.getColumn(COL.container).width, 12.5);
  assert.equal(resultSheet.getColumn(COL.dangerous).width, 40);
  assert.equal(resultSheet.getColumn(LAST_COLUMN + 1).width, 60);
});

test('crossCheckOrders: всё совпадает — без расхождений и без заливки', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.ok, true);
  assert.equal(discrepancyText(result, 0), '');
  assert.equal(isHighlighted(result, 0), false);
  assert.equal(result.summary.mismatchRows, 0);
  assert.equal(result.summary.totalRows, 1);

  const headerText = combinedWb.getWorksheet(SHEET_NAME).getRow(COLUMN_HEADER_ROW).getCell(LAST_COLUMN + 1).text;
  assert.equal(headerText, 'Несовпадения');
});

test('crossCheckOrders: расхождение веса груза — строка помечена и залита', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 26000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.mismatchRows, 1);
  assert.equal(result.summary.cargoWeight, 1);
  assert.match(discrepancyText(result, 0), /вес груза/);
  assert.equal(isHighlighted(result, 0), true);
});

test('crossCheckOrders: расхождение веса тары', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3900, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.tareWeight, 1);
  assert.match(discrepancyText(result, 0), /вес тары/);
});

test('crossCheckOrders: расхождение общего веса при верных весе груза и тары по отдельности', () => {
  // Вес груза и тары в своде сами по себе совпадают с поручением, но их
  // сумма записана в «Общий Веc» неверно (например, перепутана с соседней
  // строкой при сборке свода) — это самостоятельная поломка, не сводимая
  // к уже пойманным R01/R02.
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, totalWeight: 19841, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.cargoWeight, 0);
  assert.equal(result.summary.tareWeight, 0);
  assert.equal(result.summary.totalWeight, 1);
  assert.match(discrepancyText(result, 0), /общий вес: свод 19841, ожидается 28800/);
});

test('crossCheckOrders: общий вес — сумма груза и тары из поручения, без расхождений', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, totalWeight: 28800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.totalWeight, 0);
  assert.equal(result.summary.mismatchRows, 0);
});

test('crossCheckOrders: строка «поддоны» не входит в вес груза', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
    { cargoName: 'поддоны', grossWeight: 500 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.mismatchRows, 0, 'вес поддонов не должен попасть в вес груза');
});

test('crossCheckOrders: строка «палеты» тоже не входит в вес груза', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
    { cargoName: 'Палеты', grossWeight: 300 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.mismatchRows, 0);
});

test('crossCheckOrders: настоящая позиция груза с похожим названием не исключается', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25300, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
    { cargoName: 'поддон анализатора ситового', grossWeight: 300 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.mismatchRows, 0, 'позиция груза с похожим, но не точным названием должна учитываться в весе');
});

test('crossCheckOrders: пломбы в разном порядке — не расхождение', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '222, 111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111, 222', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.seals, 0);
});

test('crossCheckOrders: настоящее расхождение пломбы', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '999', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.seals, 1);
  assert.match(discrepancyText(result, 0), /номер пломбы/);
});

test('crossCheckOrders: контейнер найден под другим поручением', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-WRONG' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.orderWrong, 1);
  assert.match(discrepancyText(result, 0), /поручение указано неверно/);
  // остальные поля всё равно сверены по найденному поручению и совпали
  assert.equal(result.summary.cargoWeight, 0);
});

test('crossCheckOrders: перенос строки в номере поручения — сопоставление срабатывает, но помечается', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1\r\n/1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1/1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.orderFormat, 1);
  assert.equal(result.summary.orderWrong, 0);
  assert.match(discrepancyText(result, 0), /лишние пробелы/);
});

test('crossCheckOrders: контейнер не найден ни в одном поручении', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONTGHOST', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '111', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '111', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.notFound, 1);
  assert.match(discrepancyText(result, 0), /не найден ни в одном поручении/);
});

test('crossCheckOrders: расхождение типа контейнера относительно большинства', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '1', orderNumber: 'ORD-1' },
    { container: 'CONT002', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '2', orderNumber: 'ORD-1' },
    { container: 'CONT003', futnost: '20DC', cargoWeight: 25000, tareWeight: 3800, seals: '3', orderNumber: 'ORD-1' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '1', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
    { container: 'CONT002', iso: '45G1', seal: '2', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
    { container: 'CONT003', iso: '45G1', seal: '3', cargoName: 'Груз', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.futnost, 1);
  assert.match(discrepancyText(result, 2), /тип контейнера/);
  assert.equal(discrepancyText(result, 0), '');
});

test('crossCheckOrders: класс опасности — совпадение при перестановке и группировке UN', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '1', orderNumber: 'ORD-1', dangerous: 'IMO 3 UN 1866; IMO 3 UN 1263' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '1', cargoName: 'Груз А', hazardClass: '3', hazardCode: '1263', grossWeight: 100, tareWeight: 3800 },
    { cargoName: 'Груз Б', hazardClass: '3', hazardCode: '1866', grossWeight: 24900 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.dangerous, 0);
});

test('crossCheckOrders: класс опасности — в своде не хватает одного UN из нескольких в одной ячейке', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 25000, tareWeight: 3800, seals: '1', orderNumber: 'ORD-1', dangerous: 'IMO 3 UN 1263' },
  ]);
  const orderEntries = [orderEntry('ord1.xlsx', 'ORD-1', [
    { container: 'CONT001', iso: '45G1', seal: '1', cargoName: 'Груз', hazardClass: '3', hazardCode: '1263, 1866, 1993', grossWeight: 25000, tareWeight: 3800 },
  ])];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.dangerous, 1);
  assert.match(discrepancyText(result, 0), /опасные грузы/);
});

test('crossCheckOrders: несколько файлов поручений — берётся правильный по номеру', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 10000, tareWeight: 3800, seals: '1', orderNumber: 'ORD-1' },
    { container: 'CONT002', futnost: '40HC', cargoWeight: 20000, tareWeight: 3800, seals: '2', orderNumber: 'ORD-2' },
  ]);
  const orderEntries = [
    orderEntry('ord1.xlsx', 'ORD-1', [
      { container: 'CONT001', iso: '45G1', seal: '1', cargoName: 'Груз', grossWeight: 10000, tareWeight: 3800 },
    ]),
    orderEntry('ord2.xlsx', 'ORD-2', [
      { container: 'CONT002', iso: '45G1', seal: '2', cargoName: 'Груз', grossWeight: 20000, tareWeight: 3800 },
    ]),
  ];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.summary.mismatchRows, 0);
});

test('crossCheckOrders: битый файл поручения — предупреждение, остальные всё равно сверяются', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', futnost: '40HC', cargoWeight: 10000, tareWeight: 3800, seals: '1', orderNumber: 'ORD-1' },
  ]);
  const brokenWb = new ExcelJS.Workbook();
  brokenWb.addWorksheet('пусто');

  const orderEntries = [
    { fileName: 'broken.xlsx', workbook: brokenWb },
    orderEntry('ord1.xlsx', 'ORD-1', [
      { container: 'CONT001', iso: '45G1', seal: '1', cargoName: 'Груз', grossWeight: 10000, tareWeight: 3800 },
    ]),
  ];

  const result = crossCheckOrders(combinedWb, orderEntries);
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.summary.mismatchRows, 0);
});

test('crossCheckOrders: нет листа "Manifest" — явная ошибка', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Другой лист');
  const result = crossCheckOrders(workbook, [orderEntry('ord1.xlsx', 'ORD-1', [])]);
  assert.equal(result.ok, false);
  assert.match(result.error, /Manifest/);
});

test('crossCheckOrders: не выбрано ни одного поручения — явная ошибка', () => {
  const combinedWb = buildCombinedWorkbook([]);
  const result = crossCheckOrders(combinedWb, []);
  assert.equal(result.ok, false);
});
