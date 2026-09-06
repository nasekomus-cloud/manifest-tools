import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { mergeManifests } from './core.js';

const SAMPLE_HEADERS = Array.from({ length: 23 }, (_, i) => `Колонка ${i + 1}`);

// Строит книгу-манифест: шапка строк 3-5 (5 — заголовки C:Y), данные с 6-й строки.
// dataRows — массив массивов значений колонок C..Y (23 штуки), номер "№п/п"
// в колонке A проставляется отдельно (numbers), по умолчанию 1..N.
function buildManifestWorkbook({
  headers = SAMPLE_HEADERS,
  dataRows = [],
  numbers = null,
  columnCWidth = null,
} = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Manifest');
  sheet.getRow(3).getCell(3).value = 'Рейс №1';
  sheet.getRow(4).getCell(3).value = 'Судно "Тест"';
  const headerRow = sheet.getRow(5);
  headers.forEach((value, index) => {
    headerRow.getCell(3 + index).value = value;
  });

  if (columnCWidth !== null) {
    sheet.getColumn(3).width = columnCWidth;
  }

  dataRows.forEach((rowValues, rowIndex) => {
    const row = sheet.getRow(6 + rowIndex);
    const numberValue = numbers ? numbers[rowIndex] : rowIndex + 1;
    row.getCell(1).value = numberValue;
    rowValues.forEach((value, colIndex) => {
      row.getCell(3 + colIndex).value = value;
    });
  });

  return workbook;
}

function emptyRowData() {
  return SAMPLE_HEADERS.map(() => '');
}

test('mergeManifests: склеивает файлы по порядку, сохраняет исходную нумерацию и даёт сводку', () => {
  const rowsA = [
    ['a1', ...emptyRowData().slice(1)],
    ['a2', ...emptyRowData().slice(1)],
  ];
  const rowsB = [['b1', ...emptyRowData().slice(1)]];

  const wbA = buildManifestWorkbook({ dataRows: rowsA, columnCWidth: 12.5 });
  const wbB = buildManifestWorkbook({ dataRows: rowsB, columnCWidth: 40 });

  // стиль на первой ячейке первой строки файла A — должен сохраниться построчно
  const styledCell = wbA.getWorksheet('Manifest').getRow(6).getCell(3);
  styledCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

  const { resultWorkbook, summary } = mergeManifests(
    [
      { fileName: 'a.xlsx', workbook: wbA },
      { fileName: 'b.xlsx', workbook: wbB },
    ],
    { renumber: false }
  );

  const resultSheet = resultWorkbook.getWorksheet('Manifest');

  // данные трёх строк на местах 6,7,8 в порядке файлов
  assert.equal(resultSheet.getRow(6).getCell(3).value, 'a1');
  assert.equal(resultSheet.getRow(7).getCell(3).value, 'a2');
  assert.equal(resultSheet.getRow(8).getCell(3).value, 'b1');

  // нумерация не пересчитана — как в исходниках (1,2,1)
  assert.equal(resultSheet.getRow(6).getCell(1).value, 1);
  assert.equal(resultSheet.getRow(7).getCell(1).value, 2);
  assert.equal(resultSheet.getRow(8).getCell(1).value, 1);

  // шапка и ширина колонки C взяты из первого файла (A)
  assert.equal(resultSheet.getRow(5).getCell(3).value, SAMPLE_HEADERS[0]);
  assert.equal(resultSheet.getColumn(3).width, 12.5);

  // стиль ячейки скопирован построчно
  assert.deepEqual(resultSheet.getRow(6).getCell(3).style.fill, {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFF00' },
  });

  // сводка: файл → строк, и итог; в этом тесте заголовки — плейсхолдеры без
  // «контейнер»/«коносамент», поэтому статистика по ним — null
  assert.deepEqual(summary, {
    files: [
      { fileName: 'a.xlsx', rows: 2 },
      { fileName: 'b.xlsx', rows: 1 },
    ],
    totalRows: 3,
    uniqueContainers: null,
    uniqueBillsOfLading: null,
  });
});

test('mergeManifests: renumber true пересчитывает колонку A от 1 до N по всему своду', () => {
  const rowsA = [emptyRowData(), emptyRowData()];
  const rowsB = [emptyRowData()];

  const wbA = buildManifestWorkbook({ dataRows: rowsA, numbers: [5, 6] });
  const wbB = buildManifestWorkbook({ dataRows: rowsB, numbers: [1] });

  const { resultWorkbook } = mergeManifests(
    [
      { fileName: 'a.xlsx', workbook: wbA },
      { fileName: 'b.xlsx', workbook: wbB },
    ],
    { renumber: true }
  );

  const resultSheet = resultWorkbook.getWorksheet('Manifest');
  assert.equal(resultSheet.getRow(6).getCell(1).value, 1);
  assert.equal(resultSheet.getRow(7).getCell(1).value, 2);
  assert.equal(resultSheet.getRow(8).getCell(1).value, 3);
});

test('mergeManifests: считает уникальные контейнеры и коносаменты по всем файлам, без учёта повторов и регистра', () => {
  const headers = [...SAMPLE_HEADERS];
  const containerIdx = 1; // колонка D
  const billIdx = 12; // колонка O
  headers[containerIdx] = '№ контейнера';
  headers[billIdx] = '№ коносамент';

  function rowWith(container, bill) {
    const row = emptyRowData();
    row[containerIdx] = container;
    row[billIdx] = bill;
    return row;
  }

  const wbA = buildManifestWorkbook({
    headers,
    dataRows: [rowWith('CICU1828260', 'BL001'), rowWith('cicu1828260', 'BL002')], // повтор контейнера в другом регистре
  });
  const wbB = buildManifestWorkbook({
    headers,
    dataRows: [rowWith('SAXU2026718', 'BL002'), rowWith('', '')], // пустая строка не считается
  });

  const { summary } = mergeManifests([
    { fileName: 'a.xlsx', workbook: wbA },
    { fileName: 'b.xlsx', workbook: wbB },
  ]);

  assert.equal(summary.totalRows, 4);
  assert.equal(summary.uniqueContainers, 2); // CICU1828260, SAXU2026718
  assert.equal(summary.uniqueBillsOfLading, 2); // BL001, BL002
});

test('mergeManifests: если в шапке нет колонок «контейнер»/«коносамент», статистика — null', () => {
  const wbA = buildManifestWorkbook({ dataRows: [emptyRowData()] });

  const { summary } = mergeManifests([{ fileName: 'a.xlsx', workbook: wbA }]);

  assert.equal(summary.uniqueContainers, null);
  assert.equal(summary.uniqueBillsOfLading, null);
});

test('mergeManifests: отказывает при несовпадающей структуре, называя файл и ячейку', () => {
  const headersB = [...SAMPLE_HEADERS];
  headersB[5] = 'Другой заголовок'; // C(3)+5 = H(8)

  const wbA = buildManifestWorkbook({ dataRows: [emptyRowData()] });
  const wbB = buildManifestWorkbook({ headers: headersB, dataRows: [emptyRowData()] });

  assert.throws(
    () =>
      mergeManifests([
        { fileName: 'a.xlsx', workbook: wbA },
        { fileName: 'b.xlsx', workbook: wbB },
      ]),
    (err) => {
      assert.match(err.message, /b\.xlsx/);
      assert.match(err.message, /H5/);
      return true;
    }
  );
});
