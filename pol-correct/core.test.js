import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { correctPol, inspectPolFile, containerKey, normalizeHeader } from './core.js';

const TARGET_HEADERS = ['номер коносамента', 'номер контейнера', 'Тип контейнера ', 'POL', 'TOL'];
const SOURCE_HEADERS = ['PrevCell', 'Cell', 'Cntr No', 'OPR', 'POL', 'POL-Voyage', 'POD'];
const CHANGED_FILL = 'FFFFFF00';

/**
 * Лист с шапкой на headerRow и данными сразу под ней.
 * rows — массив строк: ячейки идут с первой колонки.
 */
function sheetWithRows(workbook, { name = 'Sheet1', headerRow = 1, headers, rows }) {
  const sheet = workbook.addWorksheet(name);
  headers.forEach((header, i) => {
    sheet.getCell(headerRow, i + 1).value = header;
    sheet.getCell(headerRow, i + 1).font = { bold: true };
  });
  rows.forEach((values, r) => {
    values.forEach((value, c) => {
      if (value !== null && value !== undefined) sheet.getCell(headerRow + 1 + r, c + 1).value = value;
    });
  });
  return sheet;
}

function workbookOf(...builders) {
  const workbook = new ExcelJS.Workbook();
  for (const build of builders) build(workbook);
  return workbook;
}

function targetBook(rows, { headerRow = 1, name = 'Sheet1' } = {}) {
  return workbookOf(((wb) => sheetWithRows(wb, { name, headerRow, headers: TARGET_HEADERS, rows })));
}

function sourceBook(rows, { headerRow = 1, name = 'Stowage Edit' } = {}) {
  return workbookOf(((wb) => sheetWithRows(wb, { name, headerRow, headers: SOURCE_HEADERS, rows })));
}

function run(targetWb, sourceWb) {
  return correctPol(
    { fileName: 'manifest.xlsx', workbook: targetWb },
    { fileName: 'stowage.xlsx', workbook: sourceWb },
  );
}

/* ——— Поиск колонок ——— */

test('нормализация заголовков: регистр, пробелы, ё, знаки', () => {
  assert.equal(normalizeHeader('№ контейнера'), 'контейнера');
  assert.equal(normalizeHeader('Номер контейнера'), 'номерконтейнера');
  assert.equal(normalizeHeader('Cntr No'), 'cntrno');
  assert.equal(normalizeHeader('POL '), 'pol');
});

test('ключ контейнера не зависит от регистра, пробелов и русских двойников', () => {
  assert.equal(containerKey(' fcju 500488 4 '), 'FCJU5004884');
  assert.equal(containerKey('АТLU0024703'), 'ATLU0024703');
  assert.equal(containerKey('«FCIU5004884»'), 'FCIU5004884');
});

/* ——— Основная замена ——— */

test('POL заменяется по номеру контейнера, заменённые ячейки становятся жёлтыми', () => {
  const target = targetBook([
    ['OVPB26902018', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP'],
    ['OVPB26902018', 'CBHU4113692', '20GP', 'SHANGHAI,CHINA', 'RUPLP'],
    ['OVPB26902020', 'OVPU2009528', '20GP', 'TAICANG', 'RUPLP'],
  ], { headerRow: 14 });
  for (let row = 1; row < 14; row++) target.getWorksheet('Sheet1').getCell(row, 4).value = 'шапка';
  const source = sourceBook([
    [null, '200108', 'FCIU5004884', 'OVP', 'CNTAG', '2606W', 'RUPLP'],
    [null, '200110', 'CBHU4113692', 'OVP', 'EGEDK', '2606W', 'RUPLP'],
    [null, '200111', 'OVPU2009528', 'OVP', 'CNTAG', '2606W', 'RUPLP'],
  ]);

  const result = run(target, source);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.resultWorkbook, target, 'книга меняется на месте');

  const sheet = target.getWorksheet('Sheet1');
  assert.deepEqual(result.summary.sheets, [{
    name: 'Sheet1', headerRow: 14, polColumn: 'D', containerColumn: 'B', dataRows: 3, changed: 3,
  }]);
  assert.equal(result.summary.dataRows, 3);
  assert.equal(result.summary.changed, 3);
  assert.equal(result.summary.unchanged, 0);
  assert.deepEqual(result.summary.notFound, []);
  assert.deepEqual(result.changes[0], {
    sheet: 'Sheet1', row: 15, cell: 'D15', container: 'FCIU5004884', before: 'TAICANG', after: 'CNTAG',
  });
  assert.equal(sheet.getCell('D15').value, 'CNTAG');
  assert.equal(sheet.getCell('D15').fill.fgColor.argb, CHANGED_FILL);
  assert.equal(sheet.getCell('D16').value, 'EGEDK', 'старое значение с запятой заменено целиком');
  assert.equal(sheet.getCell('D17').value, 'CNTAG');
  // Ячейку заголовка не трогали — заливки «изменено» у неё нет
  assert.equal(sheet.getCell('D14').value, 'POL');
  assert.notEqual(sheet.getCell('D14').fill?.fgColor?.argb, CHANGED_FILL);
});

test('заголовки ищутся в первых 60 строках, «POL-Voyage» не принимается за POL', () => {
  const target = targetBook([['BL1', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP']], { headerRow: 3 });
  const source = workbookOf(((wb) => {
    const sheet = wb.addWorksheet('Stowage Edit');
    sheet.getCell('A1').value = 'Stowage Edit';
    SOURCE_HEADERS.forEach((header, i) => { sheet.getCell(2, i + 1).value = header; });
    sheet.getCell('B3').value = '200108';
    sheet.getCell('C3').value = 'FCIU5004884';
    sheet.getCell('D3').value = 'OVP';
    sheet.getCell('E3').value = 'CNTAG';
    sheet.getCell('F3').value = '2606W';
    sheet.getCell('G3').value = 'RUPLP';
  }));

  const result = run(target, source);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(
    result.summary.sheets.map((sheet) => [sheet.headerRow, sheet.polColumn, sheet.containerColumn]),
    [[3, 'D', 'B']],
  );
  assert.equal(target.getWorksheet('Sheet1').getCell('D4').value, 'CNTAG');
});

test('контейнер под двумя коносаментами обновляется во всех строках, итоги пропускаются', () => {
  const target = targetBook([
    ['BL1', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP'],
    ['BL2', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP'],
    ['', 'Итого', '', 'TAICANG', ''],
  ]);
  const source = sourceBook([[null, '200108', 'FCIU5004884', 'OVP', 'CNTAG', '2606W', 'RUPLP']]);

  const result = run(target, source);
  assert.equal(result.ok, true, result.error);
  const sheet = target.getWorksheet('Sheet1');
  assert.equal(result.summary.changed, 2);
  assert.equal(result.summary.dataRows, 2);
  assert.deepEqual(result.summary.notFound, []);
  assert.equal(sheet.getCell('D2').value, 'CNTAG');
  assert.equal(sheet.getCell('D3').value, 'CNTAG');
  assert.equal(sheet.getCell('D4').value, 'TAICANG', 'строка «Итого» не считается данными');
});

test('совпадающий POL не перекрашивается и считается отдельно', () => {
  const target = targetBook([['BL1', 'FCIU5004884', '20GP', 'CNTAG', 'RUPLP']]);
  const source = sourceBook([[null, '200108', 'FCIU5004884', 'OVP', 'CNTAG', '2606W', 'RUPLP']]);

  const result = run(target, source);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.summary.changed, 0);
  assert.equal(result.summary.unchanged, 1);
  assert.deepEqual(result.changes, []);
  assert.equal(target.getWorksheet('Sheet1').getCell('D2').fill?.fgColor?.argb, undefined);
});

/* ——— Сводка: чего не хватило и что лишнее ——— */

test('контейнеры без пары и лишние в файле 2 попадают в сводку и предупреждения', () => {
  const target = targetBook([
    ['BL1', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP'],
    ['BL2', 'CBHU4113692', '20GP', 'SHANGHAI', 'RUPLP'],
  ]);
  const source = sourceBook([
    [null, '200108', 'CBHU4113692', 'OVP', 'CNTAG', '2606W', 'RUPLP'],
    [null, '200109', 'APHU6248710', 'OVP', 'EGPSD', '2606W', 'RUPLP'],
  ]);

  const result = run(target, source);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.summary.changed, 1);
  assert.deepEqual(result.summary.notFound, [{ row: 2, container: 'FCIU5004884' }]);
  assert.deepEqual(result.summary.unused, ['APHU6248710']);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /не нашлось 1 контейнеров из файла 1/);
  assert.match(result.warnings[0], /FCIU5004884/);
  assert.match(result.warnings[1], /APHU6248710/);
  assert.equal(target.getWorksheet('Sheet1').getCell('D2').value, 'TAICANG', 'POL без пары не тронут');
});

test('пустой POL во втором файле не затирает данные, разные POL — повод не угадывать', () => {
  const target = targetBook([
    ['BL1', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP'],
    ['BL2', 'CBHU4113692', '20GP', 'SHANGHAI', 'RUPLP'],
    ['BL3', 'OVPU2009528', '20GP', '', 'RUPLP'],
  ]);
  const source = sourceBook([
    [null, '200108', 'FCIU5004884', 'OVP', '', '2606W', 'RUPLP'],
    [null, '200109', 'CBHU4113692', 'OVP', 'CNTAG', '2606W', 'RUPLP'],
    [null, '200110', 'CBHU4113692', 'OVP', 'CNTAO', '2606W', 'RUPLP'],
    [null, '200111', 'OVPU2009528', 'OVP', 'EGEDK', '2606W', 'RUPLP'],
  ]);

  const result = run(target, source);
  assert.equal(result.ok, true, result.error);
  const sheet = target.getWorksheet('Sheet1');
  assert.equal(sheet.getCell('D2').value, 'TAICANG', 'пустой POL из файла 2 ничего не стёр');
  assert.equal(sheet.getCell('D3').value, 'SHANGHAI', 'у контейнера с разными POL строка не тронута');
  assert.equal(sheet.getCell('D4').value, 'EGEDK', 'пустой POL в файле 1 заполняется');
  assert.equal(result.summary.changed, 1);
  assert.deepEqual(result.summary.ambiguous, ['CBHU4113692']);
  assert.deepEqual(result.summary.withoutPol, ['FCIU5004884']);
  assert.ok(result.warnings.some((text) => /разные POL/.test(text)));
  assert.ok(result.warnings.some((text) => /пустой POL/.test(text)));
});

test('лист без таблицы не мешает: данные правятся на всех листах с POL', () => {
  const target = workbookOf(
    ((wb) => wb.addWorksheet('Титул').getCell('A1').value = 'Список на выгрузку'),
    ((wb) => sheetWithRows(wb, {
      name: 'Часть 1', headers: TARGET_HEADERS, rows: [['BL1', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP']],
    })),
    ((wb) => sheetWithRows(wb, {
      name: 'Часть 2', headers: TARGET_HEADERS, rows: [['BL2', 'CBHU4113692', '20GP', 'SHANGHAI', 'RUPLP']],
    })),
  );
  const source = sourceBook([
    [null, '200108', 'FCIU5004884', 'OVP', 'CNTAG', '2606W', 'RUPLP'],
    [null, '200109', 'CBHU4113692', 'OVP', 'EGEDK', '2606W', 'RUPLP'],
  ]);

  const result = run(target, source);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(
    result.summary.sheets.map((sheet) => [sheet.name, sheet.changed]),
    [['Часть 1', 1], ['Часть 2', 1]],
  );
  assert.equal(result.summary.changed, 2);
  assert.equal(target.getWorksheet('Часть 1').getCell('D2').value, 'CNTAG');
  assert.equal(target.getWorksheet('Часть 2').getCell('D2').value, 'EGEDK');
});

/* ——— Ошибки ——— */

test('без колонки POL или без колонки контейнера — понятная ошибка, книга не меняется', () => {
  const noPol = workbookOf(((wb) => {
    const sheet = wb.addWorksheet('Sheet1');
    sheet.getCell('A1').value = 'номер контейнера';
    sheet.getCell('B1').value = 'TAICANG';
  }));
  const source = sourceBook([[null, '200108', 'FCIU5004884', 'OVP', 'CNTAG', '2606W', 'RUPLP']]);

  const first = run(noPol, source);
  assert.equal(first.ok, false);
  assert.match(first.error, /В файле 1 .*не нашлась таблица/);
  assert.equal(noPol.getWorksheet('Sheet1').getCell('B1').value, 'TAICANG');

  const target = targetBook([['BL1', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP']]);
  const noContainer = workbookOf(((wb) => {
    const sheet = wb.addWorksheet('Stowage Edit');
    sheet.getCell('A1').value = 'POL';
    sheet.getCell('B1').value = 'CNTAG';
  }));
  const second = run(target, noContainer);
  assert.equal(second.ok, false);
  assert.match(second.error, /В файле 2 .*не нашлась таблица/);
});

test('inspectPolFile показывает колонки и число строк, а без таблицы — ошибку', () => {
  const target = targetBook([
    ['BL1', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP'],
    ['BL2', 'FCIU5004884', '20GP', 'TAICANG', 'RUPLP'],
    ['BL3', 'CBHU4113692', '20GP', 'SHANGHAI', 'RUPLP'],
  ]);
  const info = inspectPolFile(target, 'manifest.xlsx');
  assert.equal(info.ok, true, info.error);
  assert.deepEqual(info.sheets, [{
    name: 'Sheet1', headerRow: 1, polColumn: 'D', containerColumn: 'B', rows: 3, containers: 2,
  }]);

  const empty = workbookOf(((wb) => wb.addWorksheet('Sheet1')));
  const failed = inspectPolFile(empty, 'empty.xlsx');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /empty\.xlsx/);
});
