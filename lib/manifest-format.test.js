import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { validateStructure } from './manifest-format.js';

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
