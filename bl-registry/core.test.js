import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildOrdersRegistry } from './core.js';
import { SHEET_NAME, COLUMN_HEADER_ROW, DATA_START_ROW, FIRST_COLUMN, LAST_COLUMN } from '../lib/manifest-format.js';

const HEADERS = [
  '№п/п',          // C
  '№ контейнера',  // D
  '№ коносамента', // E
  '№ поручения',   // F
];
const COL = {
  container: FIRST_COLUMN + 1,
  bl: FIRST_COLUMN + 2,
  order: FIRST_COLUMN + 3,
};

let nextAutoContainer = 1;

function buildWorkbook(rows, { headers = HEADERS } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  const headerRow = sheet.getRow(COLUMN_HEADER_ROW);
  const filled = [
    ...headers,
    ...Array.from({ length: LAST_COLUMN - FIRST_COLUMN + 1 - headers.length }, (_, i) => `Колонка ${i + headers.length + 1}`),
  ];
  filled.forEach((value, i) => headerRow.getCell(FIRST_COLUMN + i).value = value);

  rows.forEach((row, i) => {
    const r = sheet.getRow(DATA_START_ROW + i);
    const container = row.container !== undefined ? row.container : `CONT${nextAutoContainer++}`;
    if (container !== '') r.getCell(COL.container).value = container;
    if (row.bl !== undefined) r.getCell(COL.bl).value = row.bl;
    if (row.order !== undefined) r.getCell(COL.order).value = row.order;
  });
  return workbook;
}

test('buildOrdersRegistry: несколько строк с одним и тем же поручением/коносаментом — одна строка реестра', () => {
  const wb = buildWorkbook([
    { container: 'A1', bl: 'BL001', order: 'ORD-1' },
    { container: 'A2', bl: 'BL001', order: 'ORD-1' },
    { container: 'A3', bl: 'BL001', order: 'ORD-1' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], { order: 'ORD-1', bl: 'BL001' });
  assert.equal(result.uniqueOrders, 1);
  assert.equal(result.uniqueBillsOfLading, 1);
});

test('buildOrdersRegistry: составной номер поручения через "; " — короткий фрагмент достраивается префиксом первого', () => {
  const wb = buildWorkbook([
    { container: 'A1', bl: 'BL004', order: '7838133940-P26-00081; 00082' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  const orders = result.rows.map((r) => r.order).sort();
  assert.deepEqual(orders, ['7838133940-P26-00081', '7838133940-P26-00082']);
  assert.ok(result.rows.every((r) => r.bl === 'BL004'));
  assert.equal(result.uniqueBillsOfLading, 1);
  assert.equal(result.uniqueOrders, 2);
});

test('buildOrdersRegistry: перенос строки и пробелы внутри номера поручения убираются целиком', () => {
  const wb = buildWorkbook([
    { container: 'A1', bl: ' BL005 ', order: '7839474406-P26-00447\n/1' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [{ order: '7839474406-P26-00447/1', bl: 'BL005' }]);
});

test('buildOrdersRegistry: сортировка — по номеру коносамента, по возрастанию', () => {
  const wb = buildWorkbook([
    { container: 'A1', bl: 'BL003', order: 'ORD-3' },
    { container: 'A2', bl: 'BL001', order: 'ORD-1' },
    { container: 'A3', bl: 'BL002', order: 'ORD-2' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.rows.map((r) => r.bl), ['BL001', 'BL002', 'BL003']);
});

test('buildOrdersRegistry: уникальные поручения и коносаменты считаются раздельно', () => {
  // Один коносамент под двумя разными поручениями (составной номер) — как
  // в реальном файле пользователя: 2 строки реестра, но 1 уникальный коносамент.
  const wb = buildWorkbook([
    { container: 'A1', bl: 'BL010', order: 'ORD-10; 11' },
    { container: 'A2', bl: 'BL020', order: 'ORD-20' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 3);
  assert.equal(result.uniqueBillsOfLading, 2);
  assert.equal(result.uniqueOrders, 3);
});

test('buildOrdersRegistry: строка без номера контейнера — не данные (строка-довесок с формулами)', () => {
  const wb = buildWorkbook([
    { container: 'A1', bl: 'BL001', order: 'ORD-1' },
    { container: '', bl: 'BL999', order: 'ORD-999' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], { order: 'ORD-1', bl: 'BL001' });
});

test('buildOrdersRegistry: пропущено одно из двух полей — строка всё равно попадает в реестр', () => {
  const wb = buildWorkbook([
    { container: 'A1', bl: 'BL001', order: '' },
    { container: 'A2', bl: '', order: 'ORD-2' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.some((r) => r.order === '' && r.bl === 'BL001'));
  assert.ok(result.rows.some((r) => r.order === 'ORD-2' && r.bl === ''));
});

test('buildOrdersRegistry: оба поля пустые — строка не несёт информации, отбрасывается', () => {
  const wb = buildWorkbook([
    { container: 'A1', bl: '', order: '' },
  ]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 0);
  assert.equal(result.uniqueOrders, 0);
  assert.equal(result.uniqueBillsOfLading, 0);
});

test('buildOrdersRegistry: не найдено ни одной строки с контейнером — ошибка', () => {
  const wb = buildWorkbook([{ container: '', bl: 'BL001', order: 'ORD-1' }]);

  const result = buildOrdersRegistry([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /не найдено ни одной строки с контейнером/i);
});

test('buildOrdersRegistry: пустой список файлов — ошибка', () => {
  const result = buildOrdersRegistry([]);
  assert.equal(result.ok, false);
});

test('buildOrdersRegistry: не найден нужный заголовок — ошибка называет, какой именно', () => {
  const wb = buildWorkbook([{ container: 'A1', bl: 'BL001', order: 'ORD-1' }], {
    headers: ['№п/п', '№ контейнера', 'Что-то другое', '№ поручения'],
  });

  const result = buildOrdersRegistry([{ fileName: 'файл.xlsx', workbook: wb }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /коносамента/i);
});

test('buildOrdersRegistry: несколько файлов — общий реестр по всем, без повторов между файлами', () => {
  const wbA = buildWorkbook([{ container: 'A1', bl: 'BL001', order: 'ORD-1' }]);
  const wbB = buildWorkbook([
    { container: 'B1', bl: 'BL001', order: 'ORD-1' },
    { container: 'B2', bl: 'BL002', order: 'ORD-2' },
  ]);

  const result = buildOrdersRegistry([
    { fileName: 'a.xlsx', workbook: wbA },
    { fileName: 'b.xlsx', workbook: wbB },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
});

test('buildOrdersRegistry: разные заголовки в разных файлах — ошибка от validateStructure', () => {
  const wbA = buildWorkbook([{ container: 'A1', bl: 'BL001', order: 'ORD-1' }]);
  const wbB = buildWorkbook([{ container: 'B1', bl: 'BL002', order: 'ORD-2' }], {
    headers: ['№п/п', '№ контейнера', 'Другой заголовок', '№ поручения'],
  });

  const result = buildOrdersRegistry([
    { fileName: 'a.xlsx', workbook: wbA },
    { fileName: 'b.xlsx', workbook: wbB },
  ]);
  assert.equal(result.ok, false);
});
