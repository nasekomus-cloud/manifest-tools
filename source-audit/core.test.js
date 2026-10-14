import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { auditSourceFile, containerCheckDigitOk, countSourceRows, parseContainerType } from './core.js';

// Раскладка — как в реальном файле линии: шапка рейса сверху, заголовки в
// 10-й строке, колонки A..Z.
const HEADERS = [
  'номер коносамента', 'номер контейнера', 'Тип контейнера ', 'POL', 'TOL', 'CARGONAME_ENG',
  'CARGONAME_RUS', 'SEAL', 'PLACES', 'Тип упаковки', 'Наименование упаковки ', 'CARGOWEIGHT',
  'MEASUREMEN', 'PlaceOfReceipt', 'PlaceOfDelivery', 'SHIPPER', 'SHIPPER_ADDRESS', 'CONSIGNEE',
  'CONSIGNEE_ADDRESS', 'NOTIFY', 'NOTIFY_ADDRESS', 'Температура', 'IMO CLASS', 'UNNO', 'TAREWEIGHT', 'ISEMPTY',
];
const KEYS = [
  'bl', 'container', 'type', 'pol', 'tol', 'cargo', 'cargoRus', 'seal', 'places', 'packType', 'pack', 'cargoWeight',
  'measurement', 'receipt', 'delivery', 'shipper', 'shipperAddress', 'consignee', 'consigneeAddress', 'notify',
  'notifyAddress', 'temperature', 'imo', 'un', 'tare', 'isEmpty',
];
const HEADER_ROW = 10;

// Номера контейнеров с верной контрольной цифрой — из реального файла.
const GOOD = ['TRHU2061616', 'FOUU4503750', 'WXLU8949471', 'FOUU4503597', 'TCKU2123509'];

function row(overrides = {}) {
  return {
    bl: 'OVPB26S000813', container: GOOD[0], type: '20GP', pol: 'NANSHA', tol: 'RUPLP', cargo: 'DISPENSING PUMP \n',
    seal: 'OVP68332', places: 720, pack: 'CARTONS', cargoWeight: 6009.35, measurement: 27.47, receipt: 'CNNSA',
    delivery: 'RUPLP', shipper: 'SHENZHEN YWS', shipperAddress: 'LUOHU DISTRICT,\nSHENZHEN', consignee: 'AUTOKIT LTD',
    consigneeAddress: '192102 ST PETERSBURG', notify: 'LLC FORWARD-TRANS', notifyAddress: 'MOSCOW', tare: 2180,
    ...overrides,
  };
}

function build(rows, { header = true } = {}) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  if (header) {
    sheet.getCell('D1').value = 'Судно';
    sheet.getCell('E1').value = 'OVP ZENITH';
    sheet.getCell('D2').value = 'Рейс';
    sheet.getCell('E2').value = '2602W';
    sheet.getCell('D7').value = 'Терминал выгрузки';
    sheet.getCell('E7').value = 'RUPLP';
  }
  HEADERS.forEach((h, i) => { sheet.getRow(HEADER_ROW).getCell(i + 1).value = h; });
  rows.forEach((r, i) => {
    KEYS.forEach((key, c) => {
      if (r[key] !== undefined && r[key] !== '') sheet.getRow(HEADER_ROW + 1 + i).getCell(c + 1).value = r[key];
    });
  });
  return wb;
}

function rules(result, level) {
  return result.findings.filter((f) => !level || f.level === level).map((f) => f.rule);
}

test('контрольная цифра ISO 6346', () => {
  for (const n of GOOD) assert.equal(containerCheckDigitOk(n), true, n);
  assert.equal(containerCheckDigitOk('TRHU2061617'), false);
  assert.equal(containerCheckDigitOk('TRHU206161'), false);
});

test('тип контейнера: обиходный и ISO-код', () => {
  assert.deepEqual(parseContainerType('40HC'), { length: 40, height: 'HC', group: 'G' });
  assert.deepEqual(parseContainerType('45R1'), { length: 40, height: 'HC', group: 'R' });
  assert.equal(parseContainerType('40XX'), null);
});

test('чистый файл — ни одной находки', () => {
  const result = auditSourceFile(build([row(), row({ container: GOOD[1], seal: 'OVP675094' })]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.rows, 2);
  assert.equal(result.summary.billsOfLading, 1);
});

test('не исходный файл — понятная ошибка', () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('x').getCell('A1').value = 'что-то';
  const result = auditSourceFile(wb);
  assert.equal(result.ok, false);
  assert.match(result.error, /заголовков/);
  assert.equal(countSourceRows(wb), null);
});

test('вес в тоннах вместо кг (реальный случай: 23,854)', () => {
  const result = auditSourceFile(build([row({ cargoWeight: 23.854 })]));
  assert.deepEqual(rules(result), ['tonnes']);
  assert.match(result.findings[0].message, /23854 кг/);
  assert.equal(result.findings[0].column, 'L');
});

test('объём больше вместимости 20-футового (реальный случай: 52,9 м³)', () => {
  const result = auditSourceFile(build([row({ measurement: 52.9 })]));
  assert.deepEqual(rules(result, 'warning'), ['volume']);
});

test('опечатка в номере контейнера и русская буква', () => {
  const result = auditSourceFile(build([
    row({ container: 'TRHU2061617' }),
    row({ container: 'FOUU450375', seal: 'OVP2' }),
    row({ container: 'TСKU2123509', seal: 'OVP3' }), // русская С
  ]));
  const errs = rules(result, 'error');
  assert.equal(errs.filter((r) => r === 'containerNumber').length, 2);
  assert.ok(errs.includes('cyrillic'));
});

test('рефконтейнер без температуры, опасный груз без UN, UN в описании', () => {
  const result = auditSourceFile(build([
    row({ type: '40RH', tare: 4450, cargoWeight: 20000, measurement: 60 }),
    row({ container: GOOD[1], seal: 'S2', imo: '8' }),
    row({ container: GOOD[2], seal: 'S3', cargo: 'BATTERIES UN 2794 CLASS 8' }),
  ]));
  assert.ok(rules(result, 'error').includes('reefer'));
  assert.ok(rules(result, 'error').includes('dg'));
  assert.ok(rules(result, 'warning').includes('dgHidden'));
});

test('перегруз брутто и тара не по типу', () => {
  const result = auditSourceFile(build([row({ cargoWeight: 31000, tare: 2200 }), row({ container: GOOD[1], seal: 'S2', tare: 3900 })]));
  assert.ok(rules(result, 'error').includes('overweight'));
  assert.ok(rules(result, 'warning').includes('tareRange'));
});

test('повтор строки, одна пломба на двух контейнерах, разные данные внутри коносамента', () => {
  const result = auditSourceFile(build([
    row(),
    row(), // тот же контейнер и коносамент
    row({ container: GOOD[1] }), // та же пломба OVP68332
    row({ container: GOOD[2], seal: 'S3', consignee: 'OTHER LTD' }),
  ]));
  const errs = rules(result, 'error');
  assert.ok(errs.includes('duplicate'));
  assert.ok(errs.includes('sealDuplicate'));
  assert.ok(errs.includes('blConflict'));
});

test('контейнер под двумя коносаментами — не ошибка, если данные одинаковые', () => {
  const result = auditSourceFile(build([
    row({ bl: 'OVPGISTKGD000017A' }),
    row({ bl: 'OVPGISTKGD000017B' }),
  ]));
  assert.deepEqual(result.findings, []);
  const conflict = auditSourceFile(build([row({ bl: 'A1' }), row({ bl: 'B1', tare: 2300 })]));
  assert.deepEqual(rules(conflict), ['containerConflict']);
});

test('обязательные поля, заглушки, TOL против PlaceOfDelivery, код порта', () => {
  const result = auditSourceFile(build([
    row({ consignee: '', seal: '-', tol: 'RUKGD', receipt: 'NANSHA' }),
  ]));
  const errs = rules(result, 'error');
  assert.ok(errs.includes('required'));
  assert.ok(errs.includes('placeholder'));
  assert.ok(errs.includes('tolMismatch'));
  assert.ok(errs.includes('portCode'));
});

test('текст вместо числа и строка без контейнера', () => {
  const result = auditSourceFile(build([
    row({ cargoWeight: '6 009,35' }),
    row({ container: GOOD[1], seal: 'S2', places: 'много' }),
    { cargoWeight: 12000, tare: 4000 }, // итог без контейнера
  ]));
  assert.ok(rules(result, 'warning').includes('textNumber'));
  assert.ok(rules(result, 'error').includes('notNumber'));
  assert.ok(rules(result, 'error').includes('noContainer'));
  assert.equal(result.summary.rows, 2);
});

test('шапка: порт назначения не из шапки', () => {
  const result = auditSourceFile(build([row({ tol: 'RUKGD', delivery: 'RUKGD' })]));
  // RUKGD нет в шапке, а RUPLP из шапки ни у одного контейнера.
  assert.deepEqual(rules(result, 'warning'), ['header', 'header']);
  assert.match(result.findings[0].message, /RUKGD нет среди/);
  assert.match(result.findings[1].message, /указан RUPLP/);
});

test('пометки в книге: столбец справа, заливка ячейки, стиль не общий с соседями', async () => {
  const wb = build([row({ cargoWeight: 23.854 }), row({ container: GOOD[1], seal: 'S2' })]);
  const result = auditSourceFile(wb);
  const sheet = result.resultWorkbook.worksheets[0];
  assert.equal(sheet.getCell('AA10').value, 'Ошибки проверки');
  assert.match(String(sheet.getCell('AA11').value), /^Ошибка: вес груза/);
  assert.equal(sheet.getCell('L11').fill.fgColor.argb, 'FFFF9900');
  assert.equal(sheet.getCell('L12').fill, undefined);
  assert.equal(sheet.getCell('AA12').value, null);
  // Книга записывается и читается обратно.
  const buffer = await result.resultWorkbook.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  assert.equal(countSourceRows(back), 2);
});
