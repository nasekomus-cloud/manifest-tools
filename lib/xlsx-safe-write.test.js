import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { ensureWorkbookTheme } from './xlsx-safe-write.js';

test('при экспорте книги без темы добавляется стандартная theme1.xml', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1').getCell('A1').value = 'POL';
  workbook._themes = {};

  ensureWorkbookTheme(workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buffer);

  assert.ok(zip.file('xl/theme/theme1.xml'), 'файл темы соответствует ссылке в workbook.xml.rels');

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  assert.equal(reopened.getWorksheet('Sheet1').getCell('A1').value, 'POL');
});

test('существующая тема книги при подготовке к экспорту сохраняется', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('Sheet1');
  const theme = '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Custom"/>';
  workbook._themes = { theme1: theme };

  ensureWorkbookTheme(workbook);
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());

  assert.equal(await zip.file('xl/theme/theme1.xml').async('string'), theme);
});
