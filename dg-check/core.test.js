import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crossCheckDangerousGoods } from './core.js';
import {
  SHEET_NAME,
  COLUMN_HEADER_ROW,
  DATA_START_ROW,
  FIRST_COLUMN,
  LAST_COLUMN,
} from '../lib/manifest-format.js';

const COMBINED_HEADERS = [
  '№п/п', // C
  'Отправитель', // D
  'Получатель', // E
  'Наименование груза', // F
  'Номер контейнера', // G
  'Вес', // H
  'Опасные грузы', // I
  ...Array.from({ length: LAST_COLUMN - FIRST_COLUMN + 1 - 7 }, (_, i) => `Колонка ${i + 8}`),
];
const CONTAINER_COL = FIRST_COLUMN + 4; // G
const DANGEROUS_COL = FIRST_COLUMN + 6; // I

function buildCombinedWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.getRow(3).getCell(FIRST_COLUMN).value = 'Рейс №1';
  const headerRow = sheet.getRow(COLUMN_HEADER_ROW);
  COMBINED_HEADERS.forEach((value, i) => {
    headerRow.getCell(FIRST_COLUMN + i).value = value;
  });
  rows.forEach((row, i) => {
    const r = sheet.getRow(DATA_START_ROW + i);
    r.getCell(CONTAINER_COL).value = row.container;
    r.getCell(DANGEROUS_COL).value = row.dangerous || null;
  });
  return workbook;
}

function buildDgWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('DG');
  const headerRow = sheet.getRow(1);
  headerRow.getCell(1).value = 'Номер контейнера';
  headerRow.getCell(2).value = 'UN номер';
  headerRow.getCell(3).value = 'Класс опасности';
  rows.forEach((row, i) => {
    const r = sheet.getRow(2 + i);
    r.getCell(1).value = row.container;
    r.getCell(2).value = row.un;
    r.getCell(3).value = row.cls;
  });
  return workbook;
}

test('crossCheckDangerousGoods: совпадение старого и нового столбца — без заливки', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', dangerous: 'IMO 9 UN 3267' },
  ]);
  const dgWb = buildDgWorkbook([{ container: 'CONT001', un: '3267', cls: '9' }]);

  const result = crossCheckDangerousGoods(combinedWb, dgWb);
  assert.equal(result.ok, true);

  const sheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  const newCol = LAST_COLUMN + 1;
  const headerText = sheet.getRow(COLUMN_HEADER_ROW).getCell(newCol).text;
  assert.equal(headerText, 'Опасные грузы (сверка с DG-манифестом)');

  const dataRow = sheet.getRow(DATA_START_ROW);
  assert.equal(dataRow.getCell(newCol).text, 'IMO 9 UN 3267');
  assert.equal(dataRow.getCell(FIRST_COLUMN).fill, undefined);

  assert.equal(result.summary.mismatchCount, 0);
  assert.equal(result.summary.notFoundInSummaryCount, 0);
});

test('crossCheckDangerousGoods: расхождение — строка целиком закрашена жёлтым', () => {
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT002', dangerous: 'старое значение' },
  ]);
  const dgWb = buildDgWorkbook([{ container: 'CONT002', un: '3077', cls: '8' }]);

  const result = crossCheckDangerousGoods(combinedWb, dgWb);
  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatchCount, 1);

  const sheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  const newCol = LAST_COLUMN + 1;
  const dataRow = sheet.getRow(DATA_START_ROW);
  assert.equal(dataRow.getCell(newCol).text, 'IMO 8 UN 3077');
  for (let c = FIRST_COLUMN; c <= newCol; c++) {
    assert.equal(dataRow.getCell(c).fill.fgColor.argb, 'FFFFFF00');
  }
});

test('crossCheckDangerousGoods: заливка не утекает на другую строку, делящую тот же объект стиля', () => {
  // Реальные файлы из Excel часто хранят один и тот же объект стиля сразу
  // у сотен ячеек с одинаковым оформлением (проверено на файлах пользователя:
  // 8 уникальных стилей на 2185 ячеек) — ExcelJS отдаёт им общую ссылку.
  // Раньше `cell.fill = ...` мутировал этот общий объект, и вся строка,
  // делящая стиль с расходящейся, тоже красилась жёлтым.
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT_BAD', dangerous: 'старое значение' }, // расходится — красится
    { container: 'CONT_OK', dangerous: '' }, // не расходится — красить нельзя
  ]);
  const sheet = combinedWb.getWorksheet(SHEET_NAME);
  const rowBad = sheet.getRow(DATA_START_ROW);
  const rowOk = sheet.getRow(DATA_START_ROW + 1);
  for (let c = FIRST_COLUMN; c <= LAST_COLUMN; c++) {
    rowOk.getCell(c).style = rowBad.getCell(c).style; // намеренно один и тот же объект
  }

  const dgWb = buildDgWorkbook([{ container: 'CONT_BAD', un: '3077', cls: '8' }]);

  const result = crossCheckDangerousGoods(combinedWb, dgWb);
  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatchCount, 1);

  const resultSheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  const okRow = resultSheet.getRow(DATA_START_ROW + 1);
  for (let c = FIRST_COLUMN; c <= LAST_COLUMN; c++) {
    assert.equal(okRow.getCell(c).fill, undefined, `колонка ${c} не должна быть закрашена`);
  }
});

test('crossCheckDangerousGoods: контейнер с 3+ позициями объединяется через " / " в порядке DG-манифеста', () => {
  const combinedWb = buildCombinedWorkbook([{ container: 'CONT003', dangerous: '' }]);
  const dgWb = buildDgWorkbook([
    { container: 'CONT003', un: '1111', cls: '3' },
    { container: 'CONT003', un: '2222', cls: '4.1' },
    { container: 'CONT003', un: '3333', cls: '9' },
  ]);

  const result = crossCheckDangerousGoods(combinedWb, dgWb);
  assert.equal(result.ok, true);

  const sheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  const newCol = LAST_COLUMN + 1;
  assert.equal(
    sheet.getRow(DATA_START_ROW).getCell(newCol).text,
    'IMO 3 UN 1111 / IMO 4.1 UN 2222 / IMO 9 UN 3333',
  );
});

test('crossCheckDangerousGoods: отсутствующий заголовок в DG-манифесте даёт понятную ошибку', () => {
  const combinedWb = buildCombinedWorkbook([{ container: 'CONT001', dangerous: '' }]);

  const dgWorkbook = new ExcelJS.Workbook();
  const dgSheet = dgWorkbook.addWorksheet('DG');
  const headerRow = dgSheet.getRow(1);
  headerRow.getCell(1).value = 'Номер контейнера';
  headerRow.getCell(2).value = 'UN номер';
  // заголовок класса отсутствует намеренно
  dgSheet.getRow(2).getCell(1).value = 'CONT001';
  dgSheet.getRow(2).getCell(2).value = '3267';

  const result = crossCheckDangerousGoods(combinedWb, dgWorkbook);
  assert.equal(result.ok, false);
  assert.match(result.error, /DG-манифесте/);
  assert.match(result.error, /Класс/);
});

test('crossCheckDangerousGoods: находит колонки DG-манифеста по английским заголовкам («CNTR No.», «UN No.», «CLS(Sub)»)', () => {
  const combinedWb = buildCombinedWorkbook([{ container: 'CONT001', dangerous: '' }]);

  const dgWorkbook = new ExcelJS.Workbook();
  const dgSheet = dgWorkbook.addWorksheet('DG');
  const headerRow = dgSheet.getRow(7); // реальные DG-манифесты часто начинают шапку не с первой строки
  headerRow.getCell(1).value = 'SEQ';
  headerRow.getCell(5).value = 'CNTR No.';
  headerRow.getCell(10).value = 'UN No.';
  headerRow.getCell(13).value = 'CLS(Sub)';
  dgSheet.getRow(8).getCell(5).value = 'CONT001';
  dgSheet.getRow(8).getCell(10).value = '3267';
  dgSheet.getRow(8).getCell(13).value = '9';

  const result = crossCheckDangerousGoods(combinedWb, dgWorkbook);
  assert.equal(result.ok, true);
  const sheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  const newCol = LAST_COLUMN + 1;
  assert.equal(sheet.getRow(DATA_START_ROW).getCell(newCol).text, 'IMO 9 UN 3267');
});

test('crossCheckDangerousGoods: не падает на объединённой ячейке с пустым мастером в шапке', () => {
  const combinedWb = buildCombinedWorkbook([{ container: 'CONT001', dangerous: '' }]);

  const dgWorkbook = new ExcelJS.Workbook();
  const dgSheet = dgWorkbook.addWorksheet('DG');
  // Объединяем пустые ячейки A1:D1 (как заголовок-«шапка» реального DG-манифеста
  // с пустой первой ячейкой) — раньше чтение .text такой ячейки бросало исключение.
  dgSheet.mergeCells('A1:D1');
  const headerRow = dgSheet.getRow(2);
  headerRow.getCell(1).value = 'Номер контейнера';
  headerRow.getCell(2).value = 'UN номер';
  headerRow.getCell(3).value = 'Класс опасности';
  dgSheet.getRow(3).getCell(1).value = 'CONT001';
  dgSheet.getRow(3).getCell(2).value = '3267';
  dgSheet.getRow(3).getCell(3).value = '9';

  const result = crossCheckDangerousGoods(combinedWb, dgWorkbook);
  assert.equal(result.ok, true);
  const sheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  const newCol = LAST_COLUMN + 1;
  assert.equal(sheet.getRow(DATA_START_ROW).getCell(newCol).text, 'IMO 9 UN 3267');
});

test('crossCheckDangerousGoods: разные текстовые форматы одних и тех же данных — не расхождение', () => {
  // Реальная колонка «Опасные грузы» пишется не нашим инструментом и использует
  // свой формат: разделитель ";\r" вместо " / ", и несколько UN-номеров одного
  // класса записаны через запятую в одной фразе, а не по одному DG-строкой.
  const combinedWb = buildCombinedWorkbook([
    { container: 'CONT001', dangerous: 'IMO 9 UN 3077,3082;\r' },
    { container: 'CONT002', dangerous: 'IMO 9 UN 3082;\rIMO 3 UN 1263;\r' },
  ]);
  const dgWb = buildDgWorkbook([
    { container: 'CONT001', un: '3077', cls: '9' },
    { container: 'CONT001', un: '3082', cls: '9' },
    { container: 'CONT002', un: '1263', cls: '3' },
    { container: 'CONT002', un: '3082', cls: '9' },
  ]);

  const result = crossCheckDangerousGoods(combinedWb, dgWb);
  assert.equal(result.ok, true);
  assert.equal(result.summary.mismatchCount, 0);
});

test('crossCheckDangerousGoods: контейнер есть в DG-манифесте, но не найден в сводном файле', () => {
  const combinedWb = buildCombinedWorkbook([{ container: 'CONT001', dangerous: '' }]);
  const dgWb = buildDgWorkbook([
    { container: 'CONT001', un: '3267', cls: '9' },
    { container: 'CONT999', un: '3077', cls: '8' },
  ]);

  const result = crossCheckDangerousGoods(combinedWb, dgWb);
  assert.equal(result.ok, true);
  assert.equal(result.summary.notFoundInSummaryCount, 1);
});
