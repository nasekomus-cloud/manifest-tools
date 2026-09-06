import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildPortDashboard } from './core.js';
import { SHEET_NAME, COLUMN_HEADER_ROW, DATA_START_ROW, FIRST_COLUMN, LAST_COLUMN } from '../lib/manifest-format.js';

// Заголовки — как в реальном примере пользователя: "Веc груза"/"Веc тары"/
// "Общий Веc" написаны с латинской "c" (код 0x63), а не кириллической
// (0x441) — воспроизводим опечатку буква в букву, а не текстом "Вес".
const LATIN_C = 'c';
const HEADERS = [
  '№п/п', // C
  '№ контейнера', // D
  'Футность', // E
  'Порт отправления', // F
  'Порт назначения', // G
  `Ве${LATIN_C} груза`, // H
  `Ве${LATIN_C} тары`, // I
  `Общий Ве${LATIN_C}`, // J
];
const CONTAINER_COL = FIRST_COLUMN + 1; // D
const TYPE_COL = FIRST_COLUMN + 2; // E
const PORT_COL = FIRST_COLUMN + 4; // G
const CARGO_COL = FIRST_COLUMN + 5; // H
const TARE_COL = FIRST_COLUMN + 6; // I
const TOTAL_COL = FIRST_COLUMN + 7; // J

// По умолчанию каждой строке присваивается свой, гарантированно уникальный
// на весь файл теста номер контейнера (общий счётчик, а не индекс внутри
// одного вызова — иначе два разных buildWorkbook() в одном тесте случайно
// выдали бы одинаковые номера и склеились бы дедупликацией по контейнеру).
// Тесты, которым важно отсутствие номера (пустая строка, итоговая строка
// с формулой) или конкретное совпадение номеров, передают container явно.
let nextAutoContainer = 1;

function buildWorkbook(rows, { headers = HEADERS } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.getRow(3).getCell(FIRST_COLUMN).value = 'Рейс №1';
  const headerRow = sheet.getRow(COLUMN_HEADER_ROW);
  headers.forEach((value, i) => {
    headerRow.getCell(FIRST_COLUMN + i).value = value;
  });
  rows.forEach((row, i) => {
    const r = sheet.getRow(DATA_START_ROW + i);
    const container = row.container !== undefined ? row.container : `CONT${nextAutoContainer++}`;
    if (container !== '') r.getCell(CONTAINER_COL).value = container;
    if (row.port !== undefined) r.getCell(PORT_COL).value = row.port;
    if (row.type !== undefined) r.getCell(TYPE_COL).value = row.type;
    if (row.cargo !== undefined) r.getCell(CARGO_COL).value = row.cargo;
    if (row.tare !== undefined) r.getCell(TARE_COL).value = row.tare;
    if (row.total !== undefined) r.getCell(TOTAL_COL).value = row.total;
  });
  return workbook;
}

test('buildPortDashboard: считает количество контейнеров и вес по группе «порт × тип»', () => {
  const wb = buildWorkbook([
    { port: 'KALININGRAD', type: '40HC', cargo: 100, tare: 10, total: 110 },
    { port: 'KALININGRAD', type: '40HC', cargo: 200, tare: 20, total: 220 },
    { port: 'KALININGRAD', type: '20DC', cargo: 50, tare: 5, total: 55 },
  ]);

  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);

  const [port] = result.combined.ports;
  assert.equal(port.port, 'KALININGRAD');
  assert.deepEqual(port.totals, { count: 3, cargoWeight: 350, tareWeight: 35, totalWeight: 385 });

  const type40hc = port.types.find((t) => t.type === '40HC');
  assert.deepEqual(type40hc, { type: '40HC', count: 2, cargoWeight: 300, tareWeight: 30, totalWeight: 330 });
});

test('buildPortDashboard: один контейнер с несколькими строками груза — считается один раз, вес складывается', () => {
  // Реальные манифесты: один физический контейнер везёт несколько видов
  // груза, каждый на своей строке с одним и тем же номером контейнера
  // (проверено на реальном файле пользователя — контейнер MSKU8627414
  // занял три строки). «Кол-во» должно остаться 1, а не 3.
  const wb = buildWorkbook([
    { container: 'MSKU8627414', port: 'X', type: '40HC', cargo: 10, tare: 3, total: 13 },
    { container: 'MSKU8627414', port: 'X', type: '40HC', cargo: 5, tare: 0, total: 5 },
    { container: 'MSKU8627414', port: 'X', type: '40HC', cargo: 7, tare: 0, total: 7 },
  ]);

  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.combined.grandTotal.count, 1);
  assert.equal(result.combined.grandTotal.cargoWeight, 22);
  assert.equal(result.combined.grandTotal.tareWeight, 3);
  assert.equal(result.combined.grandTotal.totalWeight, 25);
});

test('buildPortDashboard: строка без номера контейнера не считается данными (итоговая СУММ-строка внизу листа)', () => {
  // Реальные файлы: под последней строкой данных встречается строка с
  // формулами СУММ() по весу — без номера контейнера, без порта, без типа.
  // Раньше такая строка проходила фильтр «есть хоть один вес» и удваивала
  // итоговый вес всего файла.
  const wb = buildWorkbook([
    { container: 'CONT1', port: 'X', type: '40HC', cargo: 100, tare: 10, total: 110 },
    { container: '', port: '', type: '', cargo: 100, tare: 10, total: 110 }, // строка-«итого»
  ]);

  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.combined.grandTotal.count, 1);
  assert.equal(result.combined.grandTotal.totalWeight, 110);
});

test('buildPortDashboard: находит вес по «груза»/«тары»/«общий», хотя «Веc» написано с латинской c', () => {
  const wb = buildWorkbook([{ port: 'X', type: '20DC', cargo: 100, tare: 10, total: 110 }]);
  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.combined.grandTotal.cargoWeight, 100);
  assert.equal(result.combined.grandTotal.tareWeight, 10);
  assert.equal(result.combined.grandTotal.totalWeight, 110);
});

test('buildPortDashboard: одинаковый порт с разным числом пробелов — одна группа', () => {
  const wb = buildWorkbook([
    { port: 'St.Petersburg, Timber Port (RUPLP)', type: '40HC', cargo: 10, tare: 1, total: 11 },
    { port: 'St.Petersburg, Timber Port(RUPLP)', type: '40HC', cargo: 20, tare: 2, total: 22 },
  ]);
  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.combined.ports.length, 1);
  assert.equal(result.combined.ports[0].totals.count, 2);
});

test('buildPortDashboard: пустой порт или тип попадает в группу «(не указан)», а не пропадает', () => {
  const wb = buildWorkbook([
    { port: '', type: '40HC', cargo: 10, tare: 1, total: 11 },
    { port: 'X', type: '', cargo: 20, tare: 2, total: 22 },
  ]);
  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.combined.grandTotal.totalWeight, 33);

  const unspecifiedPort = result.combined.ports.find((p) => p.port === '(не указан)');
  assert.ok(unspecifiedPort);
  assert.equal(unspecifiedPort.totals.count, 1);

  const portX = result.combined.ports.find((p) => p.port === 'X');
  const unspecifiedType = portX.types.find((t) => t.type === '(не указан)');
  assert.ok(unspecifiedType);
});

test('buildPortDashboard: полностью пустые строки в конце листа не считаются', () => {
  const wb = buildWorkbook([{ port: 'X', type: '40HC', cargo: 10, tare: 1, total: 11 }]);
  wb.getWorksheet(SHEET_NAME).getRow(DATA_START_ROW + 5); // строка существует, но пуста
  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.combined.grandTotal.count, 1);
});

test('buildPortDashboard: порты и типы отсортированы по алфавиту', () => {
  const wb = buildWorkbook([
    { port: 'Я-порт', type: '40HC', cargo: 1, tare: 0, total: 1 },
    { port: 'А-порт', type: '20DC', cargo: 1, tare: 0, total: 1 },
    { port: 'А-порт', type: '40HC', cargo: 1, tare: 0, total: 1 },
  ]);
  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.combined.ports.map((p) => p.port),
    ['А-порт', 'Я-порт'],
  );
  assert.deepEqual(
    result.combined.ports[0].types.map((t) => t.type),
    ['20DC', '40HC'],
  );
});

test('buildPortDashboard: несколько файлов — своя разбивка по каждому плюс общая по всем вместе', () => {
  const wbA = buildWorkbook([{ port: 'X', type: '40HC', cargo: 100, tare: 10, total: 110 }]);
  const wbB = buildWorkbook([{ port: 'X', type: '40HC', cargo: 200, tare: 20, total: 220 }]);

  const result = buildPortDashboard([
    { fileName: 'a.xlsx', workbook: wbA },
    { fileName: 'b.xlsx', workbook: wbB },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.perFile.length, 2);
  assert.equal(result.perFile[0].fileName, 'a.xlsx');
  assert.equal(result.perFile[0].breakdown.grandTotal.totalWeight, 110);
  assert.equal(result.perFile[1].breakdown.grandTotal.totalWeight, 220);
  assert.equal(result.combined.grandTotal.totalWeight, 330);
  assert.equal(result.combined.grandTotal.count, 2);
});

test('buildPortDashboard: не найдена нужная колонка — ошибка называет и колонку, и файл', () => {
  const wb = buildWorkbook([{ port: 'X', type: '40HC', cargo: 1, tare: 1, total: 1 }], {
    headers: ['№п/п', '№ контейнера', 'Футность', 'Порт отправления', 'Порт назначения'],
  });
  const result = buildPortDashboard([{ fileName: 'сломанный.xlsx', workbook: wb }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /сломанный\.xlsx/);
  assert.match(result.error, /Вес груза/);
});

test('buildPortDashboard: нет колонки «№ контейнера» — понятная ошибка', () => {
  const wb = buildWorkbook([{ port: 'X', type: '40HC', cargo: 1, tare: 1, total: 1 }], {
    headers: ['№п/п', 'Футность', 'Порт отправления', 'Порт назначения', `Ве${LATIN_C} груза`, `Ве${LATIN_C} тары`, `Общий Ве${LATIN_C}`],
  });
  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /№ контейнера/);
});

test('buildPortDashboard: нет листа Manifest — понятная ошибка с именем файла', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Другой лист');
  const result = buildPortDashboard([{ fileName: 'плохой.xlsx', workbook }]);
  assert.equal(result.ok, false);
  assert.match(result.error, /плохой\.xlsx/);
  assert.match(result.error, /Manifest/);
});

test('buildPortDashboard: несовпадающая шапка между файлами — та же ошибка, что и у validateStructure', () => {
  const wbA = buildWorkbook([{ port: 'X', type: '40HC', cargo: 1, tare: 1, total: 1 }]);
  const wbB = buildWorkbook([{ port: 'X', type: '40HC', cargo: 1, tare: 1, total: 1 }], {
    headers: [...HEADERS.slice(0, -1), 'Другой заголовок'],
  });
  const result = buildPortDashboard([
    { fileName: 'a.xlsx', workbook: wbA },
    { fileName: 'b.xlsx', workbook: wbB },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /b\.xlsx/);
});

test('buildPortDashboard: без файлов — понятная ошибка, а не падение', () => {
  const result = buildPortDashboard([]);
  assert.equal(result.ok, false);
  assert.match(result.error, /хотя бы один файл/);
});
