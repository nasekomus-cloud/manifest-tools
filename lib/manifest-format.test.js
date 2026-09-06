import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { validateStructure, readVoyageHeader } from './manifest-format.js';

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
