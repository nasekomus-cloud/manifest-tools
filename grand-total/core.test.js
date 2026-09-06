import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildGrandTotalData } from './core.js';
import { SHEET_NAME, COLUMN_HEADER_ROW, DATA_START_ROW, FIRST_COLUMN } from '../lib/manifest-format.js';

// Вся общая логика подсчёта (дедупликация, пропуск СУММ-строки, поиск колонок,
// коносаменты) протестирована один раз в lib/port-breakdown.test.js —
// buildGrandTotalData здесь лишь добавляет судно/рейс из шапки. Эти тесты
// проверяют только то, что добавляет обёртка, а не переизобретают общий алгоритм.
const HEADERS = [
  '№п/п', // C
  '№ контейнера', // D
  'Футность', // E
  'Порт отправления', // F
  'Порт назначения', // G
  'Вес груза', // H
  'Вес тары', // I
  'Общий вес', // J
];
const CONTAINER_COL = FIRST_COLUMN + 1;
const TYPE_COL = FIRST_COLUMN + 2;
const CARGO_COL = FIRST_COLUMN + 5;
const TARE_COL = FIRST_COLUMN + 6;
const TOTAL_COL = FIRST_COLUMN + 7;

function buildWorkbook(rows, { header3 } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  if (header3) {
    header3.forEach(([col, value]) => {
      sheet.getRow(3).getCell(col).value = value;
    });
  }
  const headerRow = sheet.getRow(COLUMN_HEADER_ROW);
  HEADERS.forEach((value, i) => {
    headerRow.getCell(FIRST_COLUMN + i).value = value;
  });
  rows.forEach((row, i) => {
    const r = sheet.getRow(DATA_START_ROW + i);
    r.getCell(CONTAINER_COL).value = row.container ?? `CONT${i + 1}`;
    r.getCell(TYPE_COL).value = row.type;
    r.getCell(CARGO_COL).value = row.cargo;
    r.getCell(TARE_COL).value = row.tare;
    r.getCell(TOTAL_COL).value = row.total;
  });
  return workbook;
}

test('buildGrandTotalData: подставляет судно и рейс из шапки первого файла', () => {
  const wb = buildWorkbook([{ type: '40HC', cargo: 100, tare: 10, total: 110 }], {
    header3: [
      [3, 'Список на погрузку т/х GUANG QI DE ER TA'],
      [10, 'Рейс №2601W'],
    ],
  });

  const result = buildGrandTotalData([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.vessel, 'GUANG QI DE ER TA');
  assert.equal(result.voyage, '2601W');
  assert.equal(result.grandTotal.totalWeight, 110);
});

test('buildGrandTotalData: шапка не распознана — vessel/voyage null, отчёт всё равно строится', () => {
  const wb = buildWorkbook([{ type: '40HC', cargo: 1, tare: 0, total: 1 }]);

  const result = buildGrandTotalData([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.equal(result.vessel, null);
  assert.equal(result.voyage, null);
});

test('buildGrandTotalData: несколько файлов — судно/рейс берутся из первого', () => {
  const wbA = buildWorkbook([{ type: '40HC', cargo: 1, tare: 0, total: 1 }], {
    header3: [[3, 'Список на погрузку т/х FIRST VESSEL']],
  });
  const wbB = buildWorkbook([{ type: '40HC', cargo: 1, tare: 0, total: 1 }], {
    header3: [[3, 'Список на погрузку т/х SECOND VESSEL']],
  });

  const result = buildGrandTotalData([
    { fileName: 'a.xlsx', workbook: wbA },
    { fileName: 'b.xlsx', workbook: wbB },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.vessel, 'FIRST VESSEL');
});

test('buildGrandTotalData: пробрасывает ошибку buildManifestTotals как есть', () => {
  const result = buildGrandTotalData([]);
  assert.equal(result.ok, false);
  assert.match(result.error, /хотя бы один файл/);
});
