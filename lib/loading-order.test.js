import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseLoadingOrder, PALLET_CARGO_NAMES } from './loading-order.js';

// Синтетическое поручение по устройству настоящего (reference.md, «Поручение»):
// подписи шапки в строках 1–7, значение — в соседней ячейке справа; заголовки
// таблицы в строке 8, данные ниже, конец — строка «Дополнительные сведения».
// Все значения выдуманные — данных заказчика в репозитории нет.
const HEADER = {
  A1: 'Номер поручения', B1: '7700000000-P26-00001',
  C1: 'Дата', D1: '07.09.2026',
  E1: 'Клиент', F1: 'РОМАШКА ООО',
  G1: 'ИНН', H1: '7700000000',
  A2: 'Отправитель', B2: 'ООО РОМАШКА, МОСКВА', C2: 'Отправитель (англ)', D2: 'ROMASHKA LLC, MOSCOW',
  A3: 'Грузополучатель', B3: 'ВАСИЛЁК ТОО, АЛМАТЫ', C3: 'Грузополучатель (англ)', D3: 'VASILEK LLP, ALMATY',
  F3: 'Номер таможенного документа',
  A4: 'Извещение', B4: 'VASILEK LLP NOTIFY',
  // Похожая, но другая подпись — точное совпадение не должно её спутать с номером поручения.
  A5: 'Номер поручения (Э)', B5: 'ЭКСП - 1',
  A7: 'Линейный оператор', B7: 'ОПЕРАТОР', E7: 'Судно', F7: 'TEST VESSEL', G7: 'Рейс', H7: '0001E',
  I7: 'Порт погрузки', J7: 'Санкт-Петербург', K7: 'Порт выгрузки', L7: 'Port Said(EGPSD)',
};

const TABLE_COLUMNS = [
  ['container', 'Номер контейнера'],
  ['owner', 'Владелец, SOC / LOC/-'],
  ['iso', 'Код ИСО'],
  ['seal', 'Номер пломбы'],
  ['name', 'Наименование груза, род упаковки'],
  ['places', 'Число мест'],
  ['hazardClass', 'Класс опасности'],
  ['hazardCode', 'Код опасности'],
  ['net', 'Нетто груза'],
  ['gross', 'Брутто груза'],
  ['tare', 'Вес контейнера'],
  ['total', 'Брутто груза с весом контейнера'],
];
const HEADER_ROW = 8;

function writeRow(sheet, rowNumber, row, columns) {
  const line = sheet.getRow(rowNumber);
  columns.forEach(([key], i) => {
    if (row[key] !== undefined) line.getCell(i + 1).value = row[key];
  });
}

function buildOrder({ header = HEADER, columns = TABLE_COLUMNS, rows = [], afterFooter = [] } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('№ 7700000000-P26-00001');
  for (const [address, value] of Object.entries(header)) sheet.getCell(address).value = value;
  columns.forEach(([, title], i) => { sheet.getRow(HEADER_ROW).getCell(i + 1).value = title; });
  let r = HEADER_ROW + 1;
  for (const row of rows) writeRow(sheet, r++, row, columns);
  sheet.getRow(r++).getCell(1).value = 'Дополнительные сведения';
  for (const row of afterFooter) writeRow(sheet, r++, row, columns);
  return workbook;
}

function parseOk(workbook) {
  const result = parseLoadingOrder(workbook);
  assert.equal(result.ok, true, result.error);
  return result.order;
}

test('parseLoadingOrder: поля шапки — значение из соседней справа ячейки у подписи', () => {
  const order = parseOk(buildOrder());
  assert.deepEqual(
    {
      orderNumber: order.orderNumber, date: order.date, client: order.client, inn: order.inn,
      shipper: order.shipper, shipperEn: order.shipperEn, consignee: order.consignee,
      consigneeEn: order.consigneeEn, notify: order.notify, vessel: order.vessel,
      voyage: order.voyage, loadingPort: order.loadingPort, dischargePort: order.dischargePort,
    },
    {
      orderNumber: '7700000000-P26-00001', date: '07.09.2026', client: 'РОМАШКА ООО', inn: '7700000000',
      shipper: 'ООО РОМАШКА, МОСКВА', shipperEn: 'ROMASHKA LLC, MOSCOW', consignee: 'ВАСИЛЁК ТОО, АЛМАТЫ',
      consigneeEn: 'VASILEK LLP, ALMATY', notify: 'VASILEK LLP NOTIFY', vessel: 'TEST VESSEL',
      voyage: '0001E', loadingPort: 'Санкт-Петербург', dischargePort: 'Port Said(EGPSD)',
    },
  );
});

test('parseLoadingOrder: нет подписи или пустое значение — поле шапки пустой строкой, лишних полей нет', () => {
  const order = parseOk(buildOrder({ header: { A1: 'Номер поручения', B1: 'ПОР-1', E7: 'Судно' } }));
  assert.deepEqual(order, {
    orderNumber: 'ПОР-1', date: '', client: '', inn: '',
    shipper: '', shipperEn: '', consignee: '', consigneeEn: '', notify: '',
    vessel: '', voyage: '', loadingPort: '', dischargePort: '',
    containers: [],
  });
});

test('parseLoadingOrder: контейнер с одним товаром и с несколькими — места суммируются, товары перечислены', () => {
  const order = parseOk(buildOrder({
    rows: [
      // «Число мест» в настоящем файле — текст вида «11.0000».
      { container: ' AAAU1111111 ', owner: 'SOC', iso: '45G1', seal: '111', name: 'ДВИГАТЕЛИ', places: '11.0000', net: 13000, gross: 14000, tare: 3900, total: 17900 },
      { container: 'BBBU2222222', iso: '22G1', seal: '222', name: 'ФИЛЬТРЫ', places: '1.0000', net: 150, gross: 196.5, tare: 2200, total: 3000 },
      { name: 'РАДИАТОРЫ', places: '3.0000', net: 250, gross: 300.25 },
      { name: 'НАСОСЫ', places: '2.0000', net: 280, gross: 303.25 },
    ],
  }));
  assert.deepEqual(order.containers, [
    {
      containerNumber: 'AAAU1111111', row: 9, owner: 'SOC', isoCode: '45G1', sealNumber: '111',
      places: 11, goodsCount: 1, goodsNames: ['ДВИГАТЕЛИ'],
      cargoWeight: 14000, palletWeight: 0, tareWeight: 3900, totalWeight: 17900, dangerousGoods: new Set(),
    },
    {
      containerNumber: 'BBBU2222222', row: 10, owner: '', isoCode: '22G1', sealNumber: '222',
      places: 6, goodsCount: 3, goodsNames: ['ФИЛЬТРЫ', 'РАДИАТОРЫ', 'НАСОСЫ'],
      cargoWeight: 800, palletWeight: 0, tareWeight: 2200, totalWeight: 3000, dangerousGoods: new Set(),
    },
  ]);
});

test('parseLoadingOrder: строка поддонов — вес в palletWeight, не в весе груза, не в местах и не товар', () => {
  // Слова — из спецификации (§2): наименование ровно одно из них, регистр и
  // пробелы по краям не важны.
  const names = ['поддоны', 'поддон', 'палеты', 'палета', 'паллеты', 'паллета'];
  assert.deepEqual(PALLET_CARGO_NAMES, new Set(names));

  const rows = [];
  names.forEach((name, i) => {
    rows.push({ container: `CCCU000000${i}`, iso: '45G1', name: 'ГРУЗ', places: '40.0000', gross: 28120, tare: 3700, total: 32560 });
    rows.push({ name: i === 0 ? ' Поддоны ' : name, places: '2.0000', gross: 440 });
  });
  const order = parseOk(buildOrder({ rows }));
  assert.equal(order.containers.length, names.length);
  for (const c of order.containers) {
    assert.deepEqual(
      { places: c.places, goodsCount: c.goodsCount, goodsNames: c.goodsNames, cargoWeight: c.cargoWeight, palletWeight: c.palletWeight },
      { places: 40, goodsCount: 1, goodsNames: ['ГРУЗ'], cargoWeight: 28120, palletWeight: 440 },
      c.containerNumber,
    );
  }
});

test('parseLoadingOrder: «поддон анализатора ситового» — товар, а не поддоны (точное совпадение)', () => {
  const order = parseOk(buildOrder({
    rows: [
      { container: 'DDDU0000001', iso: '45G1', name: 'ГРУЗ', places: '1.0000', gross: 25000, tare: 3800, total: 29100 },
      { name: 'поддон анализатора ситового', places: '1.0000', gross: 300 },
    ],
  }));
  const [c] = order.containers;
  assert.deepEqual(
    { places: c.places, goodsCount: c.goodsCount, goodsNames: c.goodsNames, cargoWeight: c.cargoWeight, palletWeight: c.palletWeight },
    { places: 2, goodsCount: 2, goodsNames: ['ГРУЗ', 'поддон анализатора ситового'], cargoWeight: 25300, palletWeight: 0 },
  );
});

test('parseLoadingOrder: вес контейнера и «Брутто груза с весом контейнера» — из первой строки группы', () => {
  const order = parseOk(buildOrder({
    rows: [
      { container: 'EEEU0000001', iso: '45G1', name: 'ГРУЗ А', places: '1.0000', gross: 1000, tare: 3800, total: 5000 },
      // Числа в тех же колонках ниже по группе — не вес контейнера и не итог по нему.
      { name: 'ГРУЗ Б', places: '1.0000', gross: 200, tare: 9999, total: 99999 },
      { container: 'EEEU0000002', iso: '45G1', name: 'ГРУЗ В', places: '1.0000', gross: 1000 },
      { name: 'ГРУЗ Г', places: '1.0000', gross: 200, tare: 3700, total: 4900 },
    ],
  }));
  assert.deepEqual(
    order.containers.map((c) => [c.containerNumber, c.tareWeight, c.totalWeight]),
    [['EEEU0000001', 3800, 5000], ['EEEU0000002', null, null]],
  );
});

test('parseLoadingOrder: номер контейнера повторился в одном поручении — две записи в списке', () => {
  const order = parseOk(buildOrder({
    rows: [
      { container: 'FFFU0000001', iso: '45G1', seal: '1', name: 'ГРУЗ А', places: '1.0000', gross: 1000, tare: 3800, total: 4800 },
      { container: 'FFFU0000001', iso: '45G1', seal: '2', name: 'ГРУЗ Б', places: '2.0000', gross: 2000, tare: 3800, total: 5800 },
    ],
  }));
  assert.deepEqual(
    order.containers.map((c) => [c.containerNumber, c.row, c.sealNumber, c.cargoWeight, c.goodsNames]),
    [['FFFU0000001', 9, '1', 1000, ['ГРУЗ А']], ['FFFU0000001', 10, '2', 2000, ['ГРУЗ Б']]],
  );
});

test('parseLoadingOrder: опасные грузы — набор «класс|UN» по всем строкам группы', () => {
  const order = parseOk(buildOrder({
    rows: [
      { container: 'GGGU0000001', iso: '45G1', name: 'ГРУЗ А', places: '1.0000', hazardClass: '3', hazardCode: '1263, 1866', gross: 100, tare: 3800, total: 4000 },
      { name: 'ГРУЗ Б', places: '1.0000', hazardClass: '9', hazardCode: '3077', gross: 100 },
      { name: 'ГРУЗ В', places: '1.0000', hazardClass: '3', hazardCode: '1263', gross: 0 },
      { container: 'GGGU0000002', iso: '45G1', name: 'ГРУЗ Г', places: '1.0000', gross: 100, tare: 3800, total: 3900 },
      // Класс без кода — пары «класс|UN» нет.
      { name: 'ГРУЗ Д', places: '1.0000', hazardClass: '8', gross: 100 },
    ],
  }));
  assert.deepEqual(
    order.containers.map((c) => c.dangerousGoods),
    [new Set(['3|1263', '3|1866', '9|3077']), new Set()],
  );
});

test('parseLoadingOrder: таблица кончается строкой «Дополнительные сведения» — ниже ничего не читается', () => {
  const order = parseOk(buildOrder({
    rows: [
      { container: 'HHHU0000001', iso: '45G1', name: 'ГРУЗ', places: '1.0000', gross: 1000, tare: 3800, total: 4800 },
    ],
    afterFooter: [
      { name: 'Примечание к поручению', places: '5.0000', gross: 500 },
      { container: 'Подпись экспедитора', gross: 1 },
    ],
  }));
  assert.deepEqual(
    order.containers.map((c) => [c.containerNumber, c.goodsCount, c.places, c.cargoWeight]),
    [['HHHU0000001', 1, 1, 1000]],
  );
});

test('parseLoadingOrder: четыре ошибки — текстом без префикса файла', () => {
  const noSheets = new ExcelJS.Workbook();
  const emptySheet = new ExcelJS.Workbook();
  emptySheet.addWorksheet('пусто');
  const noTable = new ExcelJS.Workbook();
  const noTableSheet = noTable.addWorksheet('№ ПОР-1');
  noTableSheet.getCell('A1').value = 'Номер поручения';
  noTableSheet.getCell('B1').value = 'ПОР-1';
  const without = (title) => TABLE_COLUMNS.filter(([, t]) => t !== title);

  assert.deepEqual(
    [
      parseLoadingOrder(noSheets),
      parseLoadingOrder(emptySheet),
      parseLoadingOrder(buildOrder({ header: { C1: 'Дата', D1: '07.09.2026' } })),
      parseLoadingOrder(buildOrder({ header: { A1: 'Номер поручения' } })),
      parseLoadingOrder(noTable),
      parseLoadingOrder(buildOrder({ columns: without('Брутто груза') })),
      parseLoadingOrder(buildOrder({ columns: without('Вес контейнера') })),
    ],
    [
      { ok: false, error: 'нет ни одного листа' },
      { ok: false, error: 'не найден номер поручения' },
      { ok: false, error: 'не найден номер поручения' },
      { ok: false, error: 'не найден номер поручения' },
      { ok: false, error: 'не найден заголовок «Номер контейнера»' },
      { ok: false, error: 'не найдены обязательные колонки таблицы контейнеров' },
      { ok: false, error: 'не найдены обязательные колонки таблицы контейнеров' },
    ],
  );
});

test('parseLoadingOrder: пустая строка внутри таблицы — не товар', () => {
  const order = parseOk(buildOrder({
    rows: [
      { container: 'JJJU0000001', iso: '45G1', name: 'ГРУЗ А', places: '2.0000', gross: 1000, tare: 3800, total: 4800 },
      {},
      { name: 'ГРУЗ Б', places: '1.0000', gross: 500 },
      // Одни пробелы — тоже пусто (в настоящем файле пробелом «заполнены» ячейки строк поддонов).
      { name: '   ', seal: ' ' },
    ],
  }));
  assert.deepEqual(
    order.containers.map((c) => [c.goodsCount, c.goodsNames, c.places, c.cargoWeight]),
    [[2, ['ГРУЗ А', 'ГРУЗ Б'], 3, 1500]],
  );
});
