import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildPortDashboard } from './core.js';
import { SHEET_NAME, COLUMN_HEADER_ROW, DATA_START_ROW, FIRST_COLUMN } from '../lib/manifest-format.js';

// Вся общая логика (дедупликация контейнеров, пропуск СУММ-строки, поиск
// колонок, нормализация, сортировка, ошибки) протестирована один раз в
// lib/port-breakdown.test.js — buildPortDashboard здесь лишь вызывает её
// с фиксированной колонкой «Порт погрузки» (колонка Y реального манифеста). Эти тесты проверяют только,
// что обёртка передаёт правильный столбец, а не переизобретают общий алгоритм.
const HEADERS = [
  '№п/п', // C
  '№ контейнера', // D
  'Футность', // E
  'Порт отправления', // F
  'Порт назначения', // G
  'Вес груза', // H
  'Вес тары', // I
  'Общий вес', // J
  'Порт погрузки', // K (в реальном манифесте — Y)
];
const CONTAINER_COL = FIRST_COLUMN + 1;
const TYPE_COL = FIRST_COLUMN + 2;
const DEPARTURE_COL = FIRST_COLUMN + 3;
const DESTINATION_COL = FIRST_COLUMN + 4;
const CARGO_COL = FIRST_COLUMN + 5;
const LOADING_COL = FIRST_COLUMN + 8;

function buildWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.getRow(3).getCell(FIRST_COLUMN).value = 'Рейс №1';
  const headerRow = sheet.getRow(COLUMN_HEADER_ROW);
  HEADERS.forEach((value, i) => {
    headerRow.getCell(FIRST_COLUMN + i).value = value;
  });
  rows.forEach((row, i) => {
    const r = sheet.getRow(DATA_START_ROW + i);
    r.getCell(CONTAINER_COL).value = row.container ?? `CONT${i + 1}`;
    r.getCell(TYPE_COL).value = row.type;
    r.getCell(DEPARTURE_COL).value = row.departurePort;
    r.getCell(DESTINATION_COL).value = row.destinationPort;
    r.getCell(CARGO_COL).value = row.cargo;
    r.getCell(LOADING_COL).value = row.loadingPort;
  });
  return workbook;
}

test('buildPortDashboard: группирует по «Порт погрузки», не по «Порт отправления» и не по «Порт назначения»', () => {
  const wb = buildWorkbook([
    { loadingPort: 'NANSHA', departurePort: 'CNNSA', destinationPort: 'KALININGRAD', type: '40HC', cargo: 10 },
    { loadingPort: 'NANSHA', departurePort: 'CNTAO', destinationPort: 'St.Petersburg', type: '40HC', cargo: 20 },
    { loadingPort: 'QINGDAO', departurePort: 'CNNSA', destinationPort: 'St.Petersburg', type: '20DC', cargo: 5 },
  ]);

  const result = buildPortDashboard([{ fileName: 'a.xlsx', workbook: wb }]);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.combined.ports.map((p) => p.port).sort(),
    ['NANSHA', 'QINGDAO'],
  );
  const nansha = result.combined.ports.find((p) => p.port === 'NANSHA');
  assert.equal(nansha.totals.count, 2);
  assert.equal(nansha.totals.cargoWeight, 30);
});

test('buildPortDashboard: без файлов — понятная ошибка, а не падение', () => {
  const result = buildPortDashboard([]);
  assert.equal(result.ok, false);
  assert.match(result.error, /хотя бы один файл/);
});
