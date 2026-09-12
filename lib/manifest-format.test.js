import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { validateStructure, readVoyageHeader, countDataRows } from './manifest-format.js';

const SAMPLE_HEADERS = Array.from({ length: 23 }, (_, i) => `Колонка ${i + 1}`);

function buildWorkbook(headers, { sheetName = 'Manifest' } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getRow(3).getCell(3).value = 'Рейс №1';
  sheet.getRow(4).getCell(3).value = 'Судно';
  const headerRow = sheet.getRow(5);
  headers.forEach((value, index) => {
    headerRow.getCell(3 + index).value = value;
  });
  return workbook;
}

test('validateStructure: ok true когда C5:Y5 совпадает во всех книгах', () => {
  const workbooks = [
    { fileName: 'port1.xlsx', workbook: buildWorkbook(SAMPLE_HEADERS) },
    { fileName: 'port2.xlsx', workbook: buildWorkbook(SAMPLE_HEADERS) },
  ];

  assert.deepEqual(validateStructure(workbooks), { ok: true });
});

test('validateStructure: указывает файл и адрес ячейки при расхождении заголовка', () => {
  const mismatched = [...SAMPLE_HEADERS];
  mismatched[5] = 'Другой заголовок'; // колонка C(3) + 5 = H(8)

  const workbooks = [
    { fileName: 'port1.xlsx', workbook: buildWorkbook(SAMPLE_HEADERS) },
    { fileName: 'port2.xlsx', workbook: buildWorkbook(mismatched) },
  ];

  const result = validateStructure(workbooks);
  assert.equal(result.ok, false);
  assert.match(result.error, /port2\.xlsx/);
  assert.match(result.error, /H5/);
});

test('readVoyageHeader: находит судно после «т/х» и рейс после «Рейс №», в любой колонке строки 3', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Manifest');
  sheet.getRow(3).getCell(3).value = 'Список на погрузку т/х GUANG QI DE ER TA';
  sheet.getRow(3).getCell(10).value = 'Рейс №2601W';

  assert.deepEqual(readVoyageHeader(workbook), { vessel: 'GUANG QI DE ER TA', voyage: '2601W' });
});

test('readVoyageHeader: судно и рейс — в разных, необязательно фиксированных колонках', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Manifest');
  sheet.getRow(3).getCell(4).value = 'т/х NORD STAR';
  sheet.getRow(3).getCell(20).value = 'Рейс № 12A';

  assert.deepEqual(readVoyageHeader(workbook), { vessel: 'NORD STAR', voyage: '12A' });
});

test('readVoyageHeader: не нашли «т/х» или «Рейс» — null в соответствующем поле, а не ошибка', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Manifest');
  sheet.getRow(3).getCell(3).value = 'Список на погрузку т/х ODYSSEY';

  assert.deepEqual(readVoyageHeader(workbook), { vessel: 'ODYSSEY', voyage: null });
});

test('readVoyageHeader: нет листа Manifest — оба поля null, а не падение', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Другой лист');

  assert.deepEqual(readVoyageHeader(workbook), { vessel: null, voyage: null });
});

test('validateStructure: сообщает об отсутствующем листе Manifest', () => {
  const workbooks = [
    { fileName: 'port1.xlsx', workbook: buildWorkbook(SAMPLE_HEADERS) },
    { fileName: 'port2.xlsx', workbook: buildWorkbook(SAMPLE_HEADERS, { sheetName: 'Data' }) },
  ];

  const result = validateStructure(workbooks);
  assert.equal(result.ok, false);
  assert.match(result.error, /port2\.xlsx/);
  assert.match(result.error, /Manifest/);
});

// Строки данных листа Manifest (с 6-й): номер п/п в C, контейнер в D, вес в E.
function buildDataWorkbook(rows) {
  const workbook = buildWorkbook(SAMPLE_HEADERS);
  const sheet = workbook.getWorksheet('Manifest');
  rows.forEach((values, index) => {
    if (!values) return; // пустая строка-разделитель
    const row = sheet.getRow(6 + index);
    values.forEach((value, col) => {
      row.getCell(3 + col).value = value;
    });
  });
  return workbook;
}

test('countDataRows: обычный лист — число строк данных с 6-й строки', () => {
  const workbook = buildDataWorkbook([
    [1, 'MSKU8627414', 1200],
    [2, 'TGHU1234567', 800],
    [3, 'CAIU7654321', 950],
  ]);

  assert.equal(countDataRows(workbook), 3);
});

test('countDataRows: строка-довесок с СУММ() без контейнера считается — как «Строк» в склейке', () => {
  const workbook = buildDataWorkbook([
    [1, 'MSKU8627414', 1200],
    [2, 'TGHU1234567', 800],
    [null, null, { formula: 'SUM(E6:E7)', result: 2000 }],
  ]);

  assert.equal(countDataRows(workbook), 3);
});

test('countDataRows: пустые строки между данными и после них не считаются', () => {
  const workbook = buildDataWorkbook([
    [1, 'MSKU8627414', 1200],
    null,
    [2, 'TGHU1234567', 800],
    null,
    null,
  ]);
  // строка, у которой есть только стиль/пустая строка в ячейке, — тоже не данные
  workbook.getWorksheet('Manifest').getRow(12).getCell(5).value = '';

  assert.equal(countDataRows(workbook), 2);
});

test('countDataRows: нет листа Manifest — null, а не 0', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Data').getRow(6).getCell(3).value = 'что-то';

  assert.equal(countDataRows(workbook), null);
});

test('countDataRows: строка с данными только в колонке A или только в B — тоже строка данных', () => {
  const workbook = buildDataWorkbook([[1, 'MSKU8627414', 1200]]);
  const sheet = workbook.getWorksheet('Manifest');
  sheet.getRow(7).getCell(1).value = 'только A';
  sheet.getRow(8).getCell(2).value = 'только B';

  assert.equal(countDataRows(workbook), 3);
});
