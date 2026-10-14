import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { crossCheckSource, readSourceManifest } from './core.js';
import { SHEET_NAME, COLUMN_HEADER_ROW, DATA_START_ROW, LAST_COLUMN } from '../lib/manifest-format.js';

// Исходный файл линии — та же раскладка, что в реальном файле пользователя:
// шапка рейса сверху, заголовки в 10-й строке, колонки A..Z.
const SOURCE_HEADERS = [
  'номер коносамента', 'номер контейнера', 'Тип контейнера ', 'POL', 'TOL', 'CARGONAME_ENG',
  'CARGONAME_RUS', 'SEAL', 'PLACES', 'Тип упаковки', 'Наименование упаковки ', 'CARGOWEIGHT',
  'MEASUREMEN', 'PlaceOfReceipt', 'PlaceOfDelivery', 'SHIPPER', 'SHIPPER_ADDRESS', 'CONSIGNEE',
  'CONSIGNEE_ADDRESS', 'NOTIFY', 'NOTIFY_ADDRESS', 'Температура', 'IMO CLASS', 'UNNO', 'TAREWEIGHT', 'ISEMPTY',
];
const SOURCE_HEADER_ROW = 10;

// Манифест системы — формат lib/manifest-format.js, колонки C..Y как в реальном файле.
const SYSTEM_HEADERS = [
  '№п/п', '№ контейнера', 'Футность', 'Порт отправления', 'Порт назначения', 'Веc груза', 'Веc тары',
  'Общий Веc', 'Опасные грузы', 'Темп-ра(для RF)', 'Негабаритные грузы(см)', '№ букинга', '№ коносамента',
  'Пломбы', 'Груз', 'Груз (перевод)', 'Количество мест', 'Тип мест', 'Экспедитор', 'Отправитель',
  'Получатель', 'Вет.контроль', 'Порт погрузки',
];
const NEW_COL = LAST_COLUMN + 1;

function sourceRow(overrides = {}) {
  return {
    bl: 'OVPB26S000813', container: 'TRHU2061616', type: '20GP', cargo: 'CAR CENTRAL DOOR LOCK ACTUATOR \n',
    seal: 'OVP68332', places: 720, pack: 'CARTONS', cargoWeight: '6009.35', receipt: 'CNNSA', delivery: 'RUPLP',
    shipper: 'SHENZHEN YWS', shipperAddress: 'LUOHU DISTRICT,\nSHENZHEN', consignee: 'AUTOKIT LTD',
    consigneeAddress: '192102 ST PETERSBURG', temperature: '', imo: '', un: '', tare: 2180,
    ...overrides,
  };
}

function systemRow(overrides = {}) {
  return {
    container: 'TRHU2061616', type: '20DC', departure: 'CNNSA', destination: 'St.Petersburg, Timber Port (RUPLP)',
    cargoWeight: 6009.35, tare: 2180, total: 8189.35, dangerous: '', temperature: '', bl: 'OVPB26S000813',
    seals: 'OVP68332', cargo: 'CAR CENTRAL DOOR LOCK ACTUATOR', places: 720, pack: 'CARTONS',
    shipper: 'SHENZHEN YWS LUOHU DISTRICT, SHENZHEN', consignee: 'AUTOKIT LTD 192102 ST PETERSBURG',
    ...overrides,
  };
}

function buildSource(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.getCell('D1').value = 'Судно';
  SOURCE_HEADERS.forEach((h, i) => { sheet.getRow(SOURCE_HEADER_ROW).getCell(i + 1).value = h; });
  rows.forEach((r, i) => {
    const values = [r.bl, r.container, r.type, '', '', r.cargo, '', r.seal, r.places, '', r.pack, r.cargoWeight,
      '27.47', r.receipt, r.delivery, r.shipper, r.shipperAddress, r.consignee, r.consigneeAddress, '', '',
      r.temperature, r.imo, r.un, r.tare, ''];
    values.forEach((v, c) => { if (v !== '') sheet.getRow(SOURCE_HEADER_ROW + 1 + i).getCell(c + 1).value = v; });
  });
  return wb;
}

function buildSystem(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(SHEET_NAME);
  sheet.getCell('C3').value = 'Список на выгрузку т/х OVP ZENITH';
  SYSTEM_HEADERS.forEach((h, i) => { sheet.getRow(COLUMN_HEADER_ROW).getCell(3 + i).value = h; });
  rows.forEach((r, i) => {
    const values = [i + 1, r.container, r.type, r.departure, r.destination, r.cargoWeight, r.tare, r.total,
      r.dangerous, r.temperature, '', '', r.bl, r.seals, r.cargo, '', r.places, r.pack, 'Неноминированный',
      r.shipper, r.consignee, '', 'NANSHA'];
    values.forEach((v, c) => { if (v !== '') sheet.getRow(DATA_START_ROW + i).getCell(3 + c).value = v; });
  });
  return wb;
}

function check(sourceRows, systemRows) {
  const result = crossCheckSource(buildSource(sourceRows), buildSystem(systemRows));
  assert.equal(result.ok, true, result.error);
  const sheet = result.resultWorkbook.getWorksheet(SHEET_NAME);
  const note = (i) => sheet.getRow(DATA_START_ROW + i).getCell(NEW_COL).value;
  const fill = (i, col) => sheet.getRow(DATA_START_ROW + i).getCell(col).fill?.fgColor?.argb;
  return { ...result, sheet, note, fill };
}

test('совпадающие строки: нет расхождений, 20GP ≡ 20DC, переносы строк и имя+адрес не мешают', () => {
  const { summary, note, sheet } = check([sourceRow()], [systemRow()]);
  assert.equal(summary.totalRows, 1);
  assert.equal(summary.mismatchRows, 0);
  assert.equal(note(0), null);
  assert.equal(sheet.getRow(COLUMN_HEADER_ROW).getCell(NEW_COL).value, 'Расхождения с исходным файлом');
});

test('порт назначения: RUPLP/RUKGD сравниваются по коду в скобках', () => {
  const ok = check([sourceRow({ delivery: 'RUKGD' })], [systemRow({ destination: 'KALININGRAD (RUKGD)' })]);
  assert.equal(ok.summary.mismatchRows, 0);

  const bad = check([sourceRow({ delivery: 'RUKGD' })], [systemRow()]);
  assert.equal(bad.summary.byField.destination, 1);
  assert.match(bad.note(0), /порт назначения: .*ожидается «KALININGRAD \(RUKGD\)»/);
  assert.equal(bad.fill(0, 7), 'FFFF9900'); // G — порт назначения, оранжевым
  assert.equal(bad.fill(0, 3), 'FFFFFF00'); // остальная строка — жёлтым
});

test('порт отправления сверяется с PlaceOfReceipt', () => {
  const { summary, note } = check([sourceRow({ receipt: 'TRIST' })], [systemRow()]);
  assert.equal(summary.byField.departure, 1);
  assert.match(note(0), /порт отправления: в системе «CNNSA», в исходном \(PlaceOfReceipt\) «TRIST»/);
});

test('веса, места, пломбы, груз, тип мест, коносамент, отправитель/получатель — каждое расхождение своей строкой', () => {
  const { summary, note } = check([sourceRow()], [systemRow({
    cargoWeight: 6000, tare: 2200, total: 1, places: 72, seals: 'OVP1', cargo: 'DOOR LOCK',
    pack: 'PALLETS', bl: 'OVPB26S000814', shipper: 'OTHER', consignee: 'OTHER',
  })]);
  assert.equal(summary.mismatchRows, 1);
  for (const key of ['cargoWeight', 'tareWeight', 'totalWeight', 'places', 'seals', 'cargoName', 'packageType', 'billOfLading', 'shipper', 'consignee']) {
    assert.equal(summary.byField[key], 1, key);
  }
  assert.equal(note(0).split('\n').length, 10);
  assert.match(note(0), /общий вес: в системе 1, ожидается 8189\.35/);
});

test('тип контейнера: 40RH ≡ 40RF, 40HC ≢ 20DC', () => {
  assert.equal(check([sourceRow({ type: '40RH' })], [systemRow({ type: '40RF' })]).summary.mismatchRows, 0);
  const bad = check([sourceRow({ type: '40HC' })], [systemRow({ type: '20DC' })]);
  assert.equal(bad.summary.byField.type, 1);
});

test('опасный груз и температура: класс+UN из двух граф против «IMO 8 UN 2586;», «005» = 5', () => {
  const ok = check(
    [sourceRow({ imo: '8', un: '2586', temperature: '005' })],
    [systemRow({ dangerous: 'IMO 8 UN 2586;\n', temperature: 5 })],
  );
  assert.equal(ok.summary.mismatchRows, 0);

  const bad = check([sourceRow({ imo: '8', un: '2586' })], [systemRow({ dangerous: 'IMO 8 UN 2794;', temperature: 15 })]);
  assert.equal(bad.summary.byField.dangerous, 1);
  assert.equal(bad.summary.byField.temperature, 1);
});

test('пломбы — набором, порядок и пробелы не важны; апостроф в начале исходного текста не расхождение', () => {
  const { summary } = check(
    [sourceRow({ seal: '1921,1919, 1920', consignee: "'AUTOKIT LTD" })],
    [systemRow({ seals: '1919, 1920, 1921' })],
  );
  assert.equal(summary.mismatchRows, 0);
});

test('контейнер под двумя коносаментами: строки по паре контейнер+коносамент, тара 0 во второй строке системы — не расхождение', () => {
  const { summary } = check(
    [sourceRow({ bl: 'BL-A', tare: 2000, cargoWeight: 10400 }), sourceRow({ bl: 'BL-B', tare: 2000, cargoWeight: 10400 })],
    [systemRow({ bl: 'BL-B', tare: 2000, cargoWeight: 10400, total: 12400 }),
      systemRow({ bl: 'BL-A', tare: 0, cargoWeight: 10400, total: 10400 })],
  );
  assert.equal(summary.mismatchRows, 0);
});

test('тара 0 у единственной строки контейнера — расхождение', () => {
  const { summary } = check([sourceRow()], [systemRow({ tare: 0, total: 6009.35 })]);
  assert.equal(summary.byField.tareWeight, 1);
  assert.equal(summary.byField.totalWeight, 1);
});

test('контейнера нет в исходном, контейнера нет в системе; строка-довесок без контейнера не данные', () => {
  const { summary, note } = check(
    [sourceRow(), sourceRow({ container: 'MSKU0000001', bl: 'BL-X' })],
    [systemRow({ container: 'ABCD1234567' }), { ...systemRow(), container: '', bl: '', cargoWeight: 99 }],
  );
  assert.equal(summary.totalRows, 1);
  assert.equal(summary.notInSource, 1);
  assert.equal(note(0), 'контейнера нет в исходном файле');
  assert.deepEqual(summary.missingInSystem.map((m) => m.container), ['TRHU2061616', 'MSKU0000001']);
});

test('ошибки формата: нет заголовков исходного, нет листа Manifest, нет колонки в системе', () => {
  const empty = new ExcelJS.Workbook();
  empty.addWorksheet('Sheet1').getCell('A1').value = 'что-то';
  assert.match(crossCheckSource(empty, buildSystem([systemRow()])).error, /не найдена строка заголовков/);

  const noSheet = new ExcelJS.Workbook();
  noSheet.addWorksheet('Лист1');
  assert.match(crossCheckSource(buildSource([sourceRow()]), noSheet).error, /не найден лист "Manifest"/);

  const system = buildSystem([systemRow()]);
  system.getWorksheet(SHEET_NAME).getRow(COLUMN_HEADER_ROW).getCell(17).value = 'Что-то';
  assert.match(crossCheckSource(buildSource([sourceRow()]), system).error, /«Груз»/);
});

test('readSourceManifest: SHIPPER и SHIPPER_ADDRESS — разные колонки, имя+адрес склеиваются', () => {
  const parsed = readSourceManifest(buildSource([sourceRow()]));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows[0].shipper, 'SHENZHEN YWS LUOHU DISTRICT,\nSHENZHEN');
  assert.equal(parsed.rows[0].cargoWeight, 6009.35);
});
