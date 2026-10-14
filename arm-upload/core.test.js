import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readSource, buildArmFiles, validateOptions, SHEET_NAME } from './core.js';

// Исходный файл — раскладка реального файла линии: шапка сверху, заголовки в 10-й строке.
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

function row(overrides = {}) {
  return {
    bl: 'OVPB26S000813', container: 'TRHU2061616', type: '20GP', pol: 'NANSHA', tol: 'RUPLP', cargo: 'PUMP \n',
    seal: 'OVP68332', places: 720, pack: 'CARTONS', cargoWeight: 6009.35, measurement: 27.47, receipt: 'CNNSA',
    delivery: 'RUPLP', shipper: 'SHENZHEN YWS', shipperAddress: 'SHENZHEN', consignee: 'AUTOKIT LTD',
    consigneeAddress: 'ST PETERSBURG', notify: 'LLC FORWARD', notifyAddress: 'MOSCOW', tare: 2180,
    ...overrides,
  };
}

function buildSource(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.getCell('D1').value = 'Судно';
  sheet.getCell('E1').value = 'OVP ZENITH';
  sheet.getCell('D2').value = 'Рейс';
  sheet.getCell('E2').value = '2601W';
  sheet.getCell('D3').value = 'Рейс';
  sheet.getCell('E3').value = '2602W';
  HEADERS.forEach((h, i) => { sheet.getRow(10).getCell(i + 1).value = h; });
  rows.forEach((r, i) => {
    KEYS.forEach((key, c) => {
      if (r[key] !== undefined && r[key] !== '') sheet.getRow(11 + i).getCell(c + 1).value = r[key];
    });
  });
  return wb;
}

function options(source, overrides = {}) {
  const ports = Object.fromEntries(source.loadingPorts.map((p) => [p.code, {
    pol: p.pol, terminal: p.terminal || 'Some Terminal', fileCode: p.fileCode, billDate: '2026-08-22',
  }]));
  return {
    vessel: source.vessel, voyage: source.voyage, arrivalDate: '2026-10-24', dischargeTerminal: 'Timber Port',
    dischargeCode: 'RUPLP', ports, createWorkbook: () => new ExcelJS.Workbook(), ...overrides,
  };
}

test('шапка исходного: судно и последний рейс', () => {
  const source = readSource(buildSource([row()]));
  assert.equal(source.ok, true);
  assert.equal(source.vessel, 'OVP ZENITH');
  assert.equal(source.voyage, '2602W');
  assert.deepEqual(source.voyages, ['2601W', '2602W']);
});

test('не исходный файл — понятная ошибка', () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('x').getCell('A1').value = 'что-то';
  assert.equal(readSource(wb).ok, false);
});

test('файл на каждый порт погрузки, порядок строк исходного, имя как в образце', () => {
  const source = readSource(buildSource([
    row(),
    row({ container: 'AAMU2606490', receipt: 'EGEDK', pol: 'EL DEKHEILA' }),
    row({ container: 'FOUU4503750' }),
    row({ container: 'CBHU5839519', receipt: 'TRIST', pol: 'ISTANBUL' }),
  ]));
  assert.deepEqual(source.loadingPorts.map((p) => [p.code, p.rows]), [['CNNSA', 2], ['EGEDK', 1], ['TRIST', 1]]);
  const files = buildArmFiles(source, options(source));
  assert.deepEqual(files.map((f) => f.fileName), [
    'for ARM uploading OVP ZENITH 2602W_RUPLP_CNNSHA.xlsx',
    'for ARM uploading OVP ZENITH 2602W_RUPLP_EGEDK.xlsx',
    'for ARM uploading OVP ZENITH 2602W_RUPLP_TRIST.xlsx',
  ]);
  const sheet = files[0].workbook.getWorksheet(SHEET_NAME);
  assert.equal(sheet.getCell('B8').value, 'TRHU2061616');
  assert.equal(sheet.getCell('B9').value, 'FOUU4503750');
  assert.equal(sheet.getCell('B10').value, null);
});

test('преобразования колонок — как в образцах', () => {
  const source = readSource(buildSource([
    row({ seal: '1919/1920/1921', temperature: '005', imo: '8', un: '2586', delivery: 'RUKGD' }),
  ]));
  const [file] = buildArmFiles(source, options(source));
  const sheet = file.workbook.getWorksheet(SHEET_NAME);
  assert.equal(sheet.getCell('E1').value, 'OVP ZENITH');
  assert.equal(sheet.getCell('E2').value, '2602W');
  assert.equal(sheet.getCell('E3').value.toISOString(), '2026-10-24T00:00:00.000Z');
  assert.equal(sheet.getCell('E4').value, 'NICT (Guangzhou Nansha Container Terminal)');
  assert.equal(sheet.getCell('E5').value, 'Timber Port');
  assert.equal(sheet.getCell('M7').value, 'MEASUREMENT');
  assert.equal(sheet.getCell('W7').value, 'IMO');
  assert.equal(sheet.getCell('D8').value, 'NANSHA,CHINA (CNNSA)');
  assert.equal(sheet.getCell('E8').value, 'NICT (Guangzhou Nansha Container Terminal)');
  assert.equal(sheet.getCell('H8').value, '1919, 1920, 1921');
  assert.equal(sheet.getCell('J8').value, 'CARTONS'); // «Наименование упаковки» → «Тип упаковки»
  assert.equal(sheet.getCell('K8').value, null);
  assert.equal(sheet.getCell('L8').value, 6009.35);
  assert.equal(sheet.getCell('O8').value, 'KALININGRAD (RUKGD)');
  assert.equal(sheet.getCell('V8').value, 5);
  assert.equal(sheet.getCell('W8').value, ' 8 UN:2586');
  assert.equal(sheet.getCell('X8').value, 2180);
  assert.equal(sheet.getCell('Z8').value.toISOString(), '2026-08-22T00:00:00.000Z');
  assert.equal(sheet.getCell('Z8').numFmt, 'mm-dd-yy');
});

test('контейнер под двумя коносаментами — тара только в первой строке', () => {
  const source = readSource(buildSource([
    row({ bl: 'OVPGISTKGD000017A', container: 'XYLU1228460', receipt: 'TRIST', tare: 2000 }),
    row({ bl: 'OVPGISTKGD000017B', container: 'XYLU1228460', receipt: 'TRIST', tare: 2000 }),
  ]));
  const [file] = buildArmFiles(source, options(source));
  const sheet = file.workbook.getWorksheet(SHEET_NAME);
  assert.equal(sheet.getCell('X8').value, 2000);
  assert.equal(sheet.getCell('X9').value, 0);
  assert.equal(file.containers, 1);
});

test('неизвестный порт погрузки: POL из исходного с кодом, терминал — вручную', () => {
  const source = readSource(buildSource([row({ receipt: 'CNSHA', pol: 'SHANGHAI' })]));
  const [port] = source.loadingPorts;
  assert.equal(port.known, false);
  assert.equal(port.pol, 'SHANGHAI (CNSHA)');
  assert.equal(port.terminal, '');
  const problems = validateOptions(source, options(source, {
    arrivalDate: '', ports: { CNSHA: { pol: port.pol, terminal: '', billDate: '' } },
  }));
  assert.deepEqual(problems, ['дата прихода', 'дата коносамента (CNSHA)', 'терминал погрузки (CNSHA)']);
});

test('результат записывается и читается обратно', async () => {
  const source = readSource(buildSource([row()]));
  const [file] = buildArmFiles(source, options(source));
  const buffer = await file.workbook.xlsx.writeBuffer();
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(buffer);
  const sheet = back.getWorksheet(SHEET_NAME);
  assert.equal(sheet.getCell('A8').value, 'OVPB26S000813');
  assert.equal(sheet.views[0].state, 'frozen');
});
