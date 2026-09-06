import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBillGroups } from './core.js';

const TITLE = 'INTERNATIONAL BILL OF LADING (NON NEGOTIABLE)\nFOR OCEAN TRANSPORT';

function titlePage(number) {
  return `${TITLE}\nSHIPPER(Name and Full Address)\nBILL OF LADING NUMBER\n${number}\nCONSIGNEE...`;
}

function attachmentPage(text = 'PACKING LIST') {
  return text;
}

test('extractBillGroups: один коносамент, титул + одно приложение', () => {
  const pages = [titlePage('OVPB26Q000717'), attachmentPage()];
  const result = extractBillGroups(pages);
  assert.equal(result.ok, true);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0], {
    number: 'OVPB26Q000717',
    startPage: 1,
    endPage: 2,
    fileName: 'OVPB26Q000717.pdf',
  });
  assert.equal(result.leadingPages, 0);
  assert.deepEqual(result.warnings, []);
});

test('extractBillGroups: несколько коносаментов с разным числом приложений', () => {
  const pages = [
    titlePage('OVPB26Q000717'),
    attachmentPage(),
    titlePage('OVPB26Q000719'),
    attachmentPage(),
    attachmentPage(),
    attachmentPage(),
    titlePage('OVPB26Q000753'),
    attachmentPage(),
  ];
  const result = extractBillGroups(pages);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.groups.map((g) => [g.number, g.startPage, g.endPage]),
    [
      ['OVPB26Q000717', 1, 2],
      ['OVPB26Q000719', 3, 6],
      ['OVPB26Q000753', 7, 8],
    ],
  );
});

test('extractBillGroups: номер с подчёркиванием и буквенным суффиксом («OVPGISKKGD000022B_F»)', () => {
  const pages = [titlePage('OVPGISKKGD000022B_F'), attachmentPage()];
  const result = extractBillGroups(pages);
  assert.equal(result.ok, true);
  assert.equal(result.groups[0].number, 'OVPGISKKGD000022B_F');
  assert.equal(result.groups[0].fileName, 'OVPGISKKGD000022B_F.pdf');
});

test('extractBillGroups: номер не найден на титульном листе — файл не пропадает, а получает заметное имя и предупреждение', () => {
  const pages = [`${TITLE}\nSHIPPER(Name and Full Address)\nBOOKING NUMBER\n\nCONSIGNEE...`, attachmentPage()];
  const result = extractBillGroups(pages);
  assert.equal(result.ok, true);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].number, null);
  assert.match(result.groups[0].fileName, /без_номера/);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /стр\. 1/);
});

test('extractBillGroups: короткий «OVP...»-код на странице приложения не путается с номером коносамента', () => {
  // Реальные приложения содержат свои, более короткие OVP-коды (другое поле) —
  // они не должны попадать в номер коносамента, который ищется только на
  // титульном листе.
  const pages = [titlePage('OVPB26Q000717'), attachmentPage('SO REF: OVP643504')];
  const result = extractBillGroups(pages);
  assert.equal(result.ok, true);
  assert.equal(result.groups[0].number, 'OVPB26Q000717');
});

test('extractBillGroups: повторяющийся номер на двух титульных листах — файлы различаются суффиксом, не перезаписывают друг друга', () => {
  const pages = [titlePage('OVPB26Q000717'), attachmentPage(), titlePage('OVPB26Q000717'), attachmentPage()];
  const result = extractBillGroups(pages);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.groups.map((g) => g.fileName),
    ['OVPB26Q000717 (1).pdf', 'OVPB26Q000717 (2).pdf'],
  );
  assert.ok(result.warnings.some((w) => w.includes('OVPB26Q000717')));
});

test('extractBillGroups: страницы перед первым титульным листом — предупреждение, а не падение', () => {
  const pages = ['ОБЛОЖКА / СОПРОВОДИТЕЛЬНОЕ ПИСЬМО', titlePage('OVPB26Q000717'), attachmentPage()];
  const result = extractBillGroups(pages);
  assert.equal(result.ok, true);
  assert.equal(result.leadingPages, 1);
  assert.equal(result.groups[0].startPage, 2);
  assert.ok(result.warnings.some((w) => w.includes('до первого титульного листа')));
});

test('extractBillGroups: нет ни одного титульного листа — понятная ошибка', () => {
  const result = extractBillGroups(['СЛУЧАЙНЫЙ ДОКУМЕНТ', 'ЕЩЁ ОДНА СТРАНИЦА']);
  assert.equal(result.ok, false);
  assert.match(result.error, /титульного листа/);
});

test('extractBillGroups: пустой файл — понятная ошибка, а не падение', () => {
  const result = extractBillGroups([]);
  assert.equal(result.ok, false);
  assert.match(result.error, /ни одной страницы/);
});
