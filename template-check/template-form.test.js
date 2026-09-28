import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHEET_NAME, REFERENCE_SHEET_NAME, MOVEMENT_TYPES, DELIVERY_TERMS, HEADER_FIELDS, NOTES, COLUMN_HEADER_ROW,
  DATA_START_ROW, COLUMNS, normalizeHeader,
} from './template-form.js';

// Ожидаемые значения переписаны вручную из шаблона первой реальной заявки
// («Шаблон эл. поручения серпентинит.xlsx», 2026-09-28) — не из модуля под тестом.

test('template-form: листы, шапка рейса (E/F, строки 1–7), памятки и строки таблицы', () => {
  assert.equal(SHEET_NAME, 'EXPORT_MANIFEST');
  assert.equal(REFERENCE_SHEET_NAME, 'Reference');
  assert.deepEqual(MOVEMENT_TYPES, ['FCL/FCL', 'FCL/LCL', 'LCL/LCL', 'LCL/FCL']);
  assert.deepEqual(DELIVERY_TERMS, ['CY/CY', 'CY/DOOR', 'DOOR/DOOR', 'DOOR/CY', 'GATE/GATE']);
  assert.deepEqual(
    HEADER_FIELDS.map((f) => [f.label, f.row, f.required]),
    [['ЛИНИЯ', 1, false], ['СУДНО', 2, true], ['РЕЙС', 3, true], ['ДАТА ПРИХОДА', 4, false],
      ['ДАТА ВЫХОДА', 5, false], ['ТЕРМИНАЛ ПОГРУЗКИ', 6, true], ['ТЕРМИНАЛ ВЫГРУЗКИ', 7, true]],
  );
  assert.deepEqual(NOTES.map((n) => n.cell), ['H3', 'H4', 'H6']);
  assert.equal(COLUMN_HEADER_ROW, 9);
  assert.equal(DATA_START_ROW, 10);
});

test('template-form: 32 колонки — буква, заголовок, вид, обязательность (необязательны D, J, K, T, AB–AF)', () => {
  const expected = [
    ['A', 'НОМЕР КОНОСАМЕНТА', 'text', true],
    ['B', 'НОМЕР ПОРУЧЕНИЯ', 'text', true],
    ['C', 'ДАТА КОНОСАМЕНТА', 'date', true],
    ['D', 'МЕСТО ИЗДАНИЯ', 'text', false],
    ['E', 'НОМЕР КОНТЕЙНЕРА', 'text', true],
    ['F', 'ISO КОД', 'text', true],
    ['G', 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', 'text', true],
    ['H', 'НАИМЕНОВАНИЕ ГРУЗА АНГЛ.', 'text', true],
    ['I', 'НАИМЕНОВАНИЕ ГРУЗА РУС.', 'text', true],
    ['J', 'PRE-CARRIAGE BY', 'text', false],
    ['K', 'PLACE OF RECEIPT', 'text', false],
    ['L', 'PLACE OF DELIVERY', 'text', true],
    ['M', 'УСЛОВИЯ ПОСТАВКИ', 'list', true],
    ['N', 'TYPE OF MOVERMENT', 'list', true],
    ['O', 'НОМЕРА ПЛОМБ', 'seal', true],
    ['P', 'ТИП УПАКОВКИ', 'text', true],
    ['Q', 'КОЛИЧЕСТВО МЕСТ', 'number', true],
    ['R', 'ВЕС ГРУЗА', 'number', true],
    ['S', 'ВЕС ТАРЫ', 'number', true],
    ['T', 'ОБЪЕМ', 'number', false],
    ['U', 'ВГМ', 'number', true],
    ['V', 'SHIPPER', 'text', true],
    ['W', 'SHIPPER_ADDRESS', 'text', true],
    ['X', 'CONSIGNEE', 'text', true],
    ['Y', 'CONSIGNEE_ADDRESS', 'text', true],
    ['Z', 'NOTIFY', 'text', true],
    ['AA', 'NOTIFY_ADDRESS', 'text', true],
    ['AB', 'ТЕМПЕРАТУРА', 'text', false],
    ['AC', 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', 'text', false],
    ['AD', 'ПОРОЖНИЙ', 'text', false],
    ['AE', 'НАИМЕНОВАНИЕ или ИНН ЭКСПЕДИТОРА', 'text', false],
    ['AF', 'LOC_SOC', 'text', false],
  ];
  assert.deepEqual(COLUMNS.map((c) => [c.letter, c.header, c.kind, c.required]), expected);
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
