import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHEET_NAME, HEADER_FIELDS, NOTE_CELL, NOTE_TEXT, COLUMN_HEADER_ROW, DATA_START_ROW, COLUMNS, normalizeHeader,
} from './template-form.js';

// Ожидаемые значения переписаны вручную из spec.md §3 и reference.md
// («Форма шаблона») — не из модуля под тестом.

test('template-form: лист, шапка рейса, памятка G3 и строки таблицы', () => {
  assert.equal(SHEET_NAME, 'EXPORT_MANIFEST');
  assert.deepEqual(
    HEADER_FIELDS.map((f) => [f.label, f.row]),
    [['СУДНО', 1], ['РЕЙС', 2], ['ДАТА ПРИХОДА', 3], ['ДАТА ВЫХОДА', 4], ['ТЕРМИНАЛ ПОГРУЗКИ', 5], ['ТЕРМИНАЛ ВЫГРУЗКИ', 6]],
  );
  assert.equal(NOTE_CELL, 'G3');
  assert.equal(NOTE_TEXT, 'Таблицу заполнять строго в соответствии с п/поручением и ДТ!');
  assert.equal(COLUMN_HEADER_ROW, 8);
  assert.equal(DATA_START_ROW, 9);
});

test('template-form: 26 колонок — буква, заголовок, вид, обязательность, ширина', () => {
  const expected = [
    ['A', 'НОМЕР КОНОСАМЕНТА', 'text', true, 18.57],
    ['B', 'НОМЕР ПОРУЧЕНИЯ', 'text', true, 18.57],
    ['C', 'ДАТА КОНОСАМЕНТА', 'date', true, 14.71],
    ['D', 'НОМЕР КОНТЕЙНЕРА', 'text', true, 22.43],
    ['E', 'ISO КОД', 'text', true, 12],
    ['F', 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', 'text', true, 16.71],
    ['G', 'НАИМЕНОВАНИЕ ГРУЗА АНГЛ.', 'text', true, 26.14],
    ['H', 'НАИМЕНОВАНИЕ ГРУЗА РУС.', 'text', true, 22.43],
    ['I', 'НОМЕРА ПЛОМБ', 'seal', true, 15.14],
    ['J', 'ТИП УПАКОВКИ', 'text', true, 13.29],
    ['K', 'КОЛИЧЕСТВО МЕСТ', 'number', true, 14.57],
    ['L', 'ВЕС ГРУЗА', 'number', true, 12],
    ['M', 'ВЕС ТАРЫ', 'number', true, 12],
    ['N', 'ОБЪЕМ', 'number', true, 12],
    ['O', 'ВГМ', 'number', true, 12.43],
    ['P', 'SHIPPER', 'text', true, 20],
    ['Q', 'SHIPPER_ADDRESS', 'text', true, 27.71],
    ['R', 'CONSIGNEE', 'text', true, 13.43],
    ['S', 'CONSIGNEE_ADDRESS', 'text', true, 13.43],
    ['T', 'NOTIFY', 'text', true, 13.43],
    ['U', 'NOTIFY_ADDRESS', 'text', true, 16.57],
    ['V', 'ТЕМПЕРАТУРА', 'text', false, 15],
    ['W', 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', 'text', false, 17.14],
    ['X', 'ПОРОЖНИЙ', 'text', false, 12.71],
    ['Y', 'ИНН ЭКСПЕДИТОРА', 'text', false, 16],
    ['Z', 'LOC_SOC', 'text', false, 12.71],
  ];
  assert.deepEqual(COLUMNS.map((c) => [c.letter, c.header, c.kind, c.required, c.width]), expected);
});

test('normalizeHeader: регистр, латиница-двойник → кириллица, только буквы и цифры', () => {
  assert.equal(normalizeHeader('ВЕС  ГРУЗА'), 'ВЕСГРУЗА');
  assert.equal(normalizeHeader('вес груза'), 'ВЕСГРУЗА');
  // «Веc» с латинской c — так уже встречалось на сайте (CLAUDE.md).
  assert.equal(normalizeHeader('Веc груза'), 'ВЕСГРУЗА');
  assert.equal(normalizeHeader('НАИМЕНОВАНИЕ ГРУЗА (АНГЛ)'), normalizeHeader('НАИМЕНОВАНИЕ ГРУЗА АНГЛ.'));
  // Латинские A B C E H K M O P T X Y становятся кириллическими, остальные остаются.
  assert.equal(normalizeHeader('ISO код'), 'ISОКОД');
  assert.equal(normalizeHeader('LOC_SOC'), 'LОСSОС');
  assert.notEqual(normalizeHeader('SHIPPER'), normalizeHeader('SHIPPER_ADDRESS'));
});
