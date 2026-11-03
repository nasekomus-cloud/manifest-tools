import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { compareVersions, versionDate } from './core.js';

const OLD_DATE = new Date('2026-10-30T11:48:01Z');
const NEW_DATE = new Date('2026-11-03T06:08:28Z');

function book(modified, build) {
  const workbook = new ExcelJS.Workbook();
  workbook.modified = modified;
  build?.(workbook);
  return workbook;
}

function entry(fileName, workbook, lastModified) {
  return { fileName, workbook, lastModified };
}

function pair(buildOld, buildNew) {
  return [
    entry('old.xlsx', book(OLD_DATE, buildOld)),
    entry('new.xlsx', book(NEW_DATE, buildNew)),
  ];
}

test('новая версия выбирается по дате внутри Excel, изменения красятся и получают примечание', () => {
  const [older, newer] = pair(
    (wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'SHANGHAI';
      sheet.getCell('B1').value = 'без изменений';
    },
    (wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = 'EGSOK';
      sheet.getCell('B1').value = 'без изменений';
      const sharedStyle = { font: { color: { argb: 'FF000000' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFADD8E6' } } };
      sheet.getCell('A1').style = sharedStyle;
      sheet.getCell('B1').style = sharedStyle;
    },
  );

  const result = compareVersions(older, newer);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.resultWorkbook, newer.workbook);
  assert.equal(result.summary.newerFile, 'new.xlsx');
  assert.equal(result.summary.changedCells, 1);
  assert.deepEqual(result.changes, [{ sheet: 'Sheet1', cell: 'A1', before: 'SHANGHAI', after: 'EGSOK' }]);
  const sheet = result.resultWorkbook.getWorksheet('Sheet1');
  assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FFFFFF00');
  assert.equal(sheet.getCell('B1').fill.fgColor.argb, 'FFADD8E6', 'общий стиль не должен перекрасить соседнюю ячейку');
  assert.equal(sheet.getCell('A1').note, 'Сравнение с «old.xlsx»:\nБыло: SHANGHAI\nСтало: EGSOK');
  assert.equal(sheet.getCell('B1').note, undefined);
});

test('если даты внутри книг нет, используется lastModified; порядок загрузки не важен', () => {
  const first = entry('first.xlsx', book(null, (wb) => wb.addWorksheet('Sheet1').getCell('A1').value = 'new'), NEW_DATE.getTime());
  const second = entry('second.xlsx', book(null, (wb) => wb.addWorksheet('Sheet1').getCell('A1').value = 'old'), OLD_DATE.getTime());
  assert.equal(versionDate(first).getTime(), NEW_DATE.getTime());
  const result = compareVersions(first, second);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.summary.newerFile, 'first.xlsx');
  assert.equal(result.changes[0].before, 'old');
  assert.equal(result.changes[0].after, 'new');
});

test('одинаковые или отсутствующие даты не позволяют молча выбрать версию', () => {
  const same = pair((wb) => wb.addWorksheet('Sheet1'), (wb) => wb.addWorksheet('Sheet1'));
  same[1].workbook.modified = OLD_DATE;
  assert.match(compareVersions(...same).error, /одинаковая дата/);
  const missing = pair((wb) => wb.addWorksheet('Sheet1'), (wb) => wb.addWorksheet('Sheet1'));
  missing[0].workbook.modified = null;
  assert.match(compareVersions(...missing).error, /Не удалось определить даты/);
});

test('очищенные ячейки, новые и удалённые листы учитываются', () => {
  const [older, newer] = pair(
    (wb) => {
      wb.addWorksheet('Sheet1').getCell('A1').value = 'удалено';
      wb.addWorksheet('Old only').getCell('A1').value = 'старый лист';
    },
    (wb) => {
      wb.addWorksheet('Sheet1');
      wb.addWorksheet('New only').getCell('B2').value = 42;
    },
  );
  const result = compareVersions(older, newer);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.summary.changedCells, 2);
  assert.deepEqual(result.summary.addedSheets, ['New only']);
  assert.deepEqual(result.summary.removedSheets, ['Old only']);
  assert.deepEqual(result.changes[0], { sheet: 'Sheet1', cell: 'A1', before: 'удалено', after: '(пусто)' });
  assert.equal(result.resultWorkbook.getWorksheet('New only').getCell('B2').fill.fgColor.argb, 'FFFFFF00');
});

test('формулы, даты и rich text сравниваются по содержимому, число не равно тексту', () => {
  const date = new Date('2026-10-01T00:00:00Z');
  const [older, newer] = pair(
    (wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = { formula: '1+1', result: 2 };
      sheet.getCell('B1').value = date;
      sheet.getCell('C1').value = { richText: [{ text: 'один', font: { bold: true } }, { text: ' текст' }] };
      sheet.getCell('D1').value = 1;
    },
    (wb) => {
      const sheet = wb.addWorksheet('Sheet1');
      sheet.getCell('A1').value = { formula: '1+1', result: 2 };
      sheet.getCell('B1').value = new Date(date);
      sheet.getCell('C1').value = { richText: [{ text: 'один' }, { text: ' текст', font: { italic: true } }] };
      sheet.getCell('D1').value = '1';
    },
  );
  const result = compareVersions(older, newer);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.changes.map((change) => change.cell), ['D1']);
});

test('существующее примечание сохраняется, а результат переживает запись и чтение xlsx', async () => {
  const [older, newer] = pair(
    (wb) => wb.addWorksheet('Sheet1').getCell('A1').value = 'before',
    (wb) => {
      const cell = wb.addWorksheet('Sheet1').getCell('A1');
      cell.value = 'after';
      cell.note = 'Старое примечание';
    },
  );
  const result = compareVersions(older, newer);
  const buffer = await result.resultWorkbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  const cell = loaded.getWorksheet('Sheet1').getCell('A1');
  assert.match(cell.note, /^Старое примечание\n\nСравнение/);
  assert.match(cell.note, /Было: before\nСтало: after/);
  assert.equal(cell.fill.fgColor.argb, 'FFFFFF00');
});
