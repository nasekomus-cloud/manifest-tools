// Синтетические примеры входных файлов для справки портала (/help/<ключ>).
//
//   node portal/help/make-samples.js   — перезаписывает portal/help/samples/*.xlsx
//
// Всё выдумано: суда BALTIC HERON и AURORA BAY, рейсы, грузоотправители,
// пломбы и веса. Номера контейнеров — с верной контрольной цифрой ISO 6346
// (кроме одного нарочно испорченного, см. IMPORT_ROWS). Реальные файлы
// заказчиков сюда не попадают никогда.
//
// Содержимое детерминировано: ни случайных чисел, ни текущего времени — повторный
// запуск даёт те же значения ячеек (тест сверяет закоммиченные файлы со скриптом).
//
// Раскладки — те, что разбирают инструменты: манифест — lib/manifest-format.js
// (лист "Manifest", шапка рейса в 3-й строке, заголовки в 5-й, данные с 6-й,
// колонки C:Y), поручение — lib/loading-order.js, шаблон эл. поручения —
// template-check/template-form.js, исходный файл линии — source-check/core.js и
// source-audit/core.js (шапка рейса сверху, заголовки в 10-й строке, A:Z).
//
// Нарочно заложенные находки, чтобы результат был не пустым:
//   - «Сверить с поручениями»: у одного контейнера в своде пломба с переставленными цифрами;
//   - «Проверить шаблон»: русские буквы в пломбе и старый заголовок «TYPE OF MOVEMENT» — исправит сам;
//   - «Проверить исходный файл»: вес в тоннах и опечатка в контрольной цифре номера контейнера;
//   - «Сверить манифест с исходным»: у одного контейнера в системе другой вес груза;
//   - «Сверить опасные грузы»: в DG-манифесте у одного контейнера другой номер UN.

import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { containerCheckDigitOk } from '../../source-audit/core.js';

const SAMPLES_DIR = fileURLToPath(new URL('./samples/', import.meta.url));
// Дата в свойствах книги — постоянная, чтобы в файле не было времени запуска
const FIXED_DATE = new Date(Date.UTC(2026, 9, 18, 9, 0, 0));

/* ——— Помощники ——— */

// Номер контейнера: префикс владельца (4 буквы) + 6 цифр + контрольная цифра.
// Цифра подбирается проверкой из «Проверить исходный файл» — одно правило на сайте.
function container(owner, serial) {
  const base = `${owner}${String(serial).padStart(6, '0')}`;
  for (let digit = 0; digit <= 9; digit++) {
    if (containerCheckDigitOk(`${base}${digit}`)) return `${base}${digit}`;
  }
  throw new Error(`нет контрольной цифры для ${base}`);
}

// Тот же номер с заведомо неверной контрольной цифрой
function withWrongDigit(number) {
  const digit = (Number(number[10]) + 1) % 10;
  return `${number.slice(0, 10)}${digit}`;
}

function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Лоция — пример';
  wb.created = FIXED_DATE;
  wb.modified = FIXED_DATE;
  return wb;
}

function setRow(sheet, rowNumber, firstCol, values) {
  const row = sheet.getRow(rowNumber);
  values.forEach((value, i) => {
    if (value !== null && value !== undefined && value !== '') row.getCell(firstCol + i).value = value;
  });
}

function boldRow(sheet, rowNumber) {
  sheet.getRow(rowNumber).eachCell((cell) => { cell.font = { bold: true }; });
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/* ——— Экспорт: рейс BALTIC HERON 2611E, Санкт-Петербург → Port Said / Mersin ——— */

const EXPORT = { vessel: 'BALTIC HERON', voyage: '2611E' };
const LOADING_PORT = 'St.Petersburg, Timber Port (RUPLP)';

// Два поручения на погрузку. Вес груза в поручении — по товарам; строка
// «поддоны» — вес поддонов, в вес груза свода и шаблона не входит, в ВГМ входит.
const ORDERS = [
  {
    file: 'poruchenie-1.xlsx',
    number: '7801234567-P26-00041',
    date: '28.10.2026',
    client: 'ООО «СЕВЕРНЫЙ ЛЕС»',
    inn: '7801234567',
    shipper: 'ООО «СЕВЕРНЫЙ ЛЕС», 197022, САНКТ-ПЕТЕРБУРГ, УЛ. ЛЕСНАЯ, Д. 7',
    shipperEn: 'NORTHERN TIMBER LLC, 197022, SAINT PETERSBURG, LESNAYA STR. 7',
    consignee: 'NILE WOOD TRADING CO., PORT SAID, EGYPT',
    consigneeEn: 'NILE WOOD TRADING CO., PORT SAID, EGYPT',
    notify: 'NILE WOOD TRADING CO., PORT SAID, EGYPT',
    dischargePort: 'Port Said(EGPSD)',
    destination: 'Port Said(EGPSD)',
    containers: [
      { owner: 'NTRU', serial: 410273, iso: '45G1', type: '40HC', seal: 'BH0451201', tare: 3850, bl: 'BHRN2611E0001',
        goods: [{ name: 'Пиломатериалы хвойных пород, пакеты', en: 'SAWN SOFTWOOD TIMBER', places: 18, gross: 21450 }], volume: 62 },
      { owner: 'NTRU', serial: 410289, iso: '45G1', type: '40HC', seal: 'BH0451202', tare: 3880, bl: 'BHRN2611E0001',
        goods: [{ name: 'Пиломатериалы хвойных пород, пакеты', en: 'SAWN SOFTWOOD TIMBER', places: 19, gross: 22300 }], volume: 64 },
      { owner: 'NTRU', serial: 410295, iso: '45G1', type: '40HC', seal: 'BH0451203', tare: 3900, bl: 'BHRN2611E0001',
        goods: [{ name: 'Пиломатериалы хвойных пород, пакеты', en: 'SAWN SOFTWOOD TIMBER', places: 18, gross: 21780 }], volume: 63 },
      { owner: 'NTRU', serial: 410306, iso: '45G1', type: '40HC', seal: 'BH0451204', tare: 3820, bl: 'BHRN2611E0002',
        goods: [
          { name: 'Фанера березовая, пачки', en: 'BIRCH PLYWOOD', places: 24, gross: 19600 },
          { name: 'поддоны', places: 0, gross: 480 },
        ], volume: 48 },
      { owner: 'NTRU', serial: 410312, iso: '45G1', type: '40HC', seal: 'BH0451270', tare: 3850, bl: 'BHRN2611E0002',
        goods: [
          { name: 'Фанера березовая, пачки', en: 'BIRCH PLYWOOD', places: 24, gross: 19850 },
          { name: 'поддоны', places: 0, gross: 480 },
        ], volume: 48, svodSeal: 'BH0451207' }, // в своде цифры переставлены — найдёт «Сверить с поручениями»
      { owner: 'NTRU', serial: 410328, iso: '45G1', type: '40HC', seal: 'BH0451206', tare: 3870, bl: 'BHRN2611E0002',
        goods: [
          { name: 'Фанера березовая, пачки', en: 'BIRCH PLYWOOD', places: 22, gross: 18900 },
          { name: 'поддоны', places: 0, gross: 440 },
        ], volume: 46 },
    ],
  },
  {
    file: 'poruchenie-2.xlsx',
    number: '7809876543-P26-00042',
    date: '29.10.2026',
    client: 'ООО «ХИМПРОМ-ЭКСПОРТ»',
    inn: '7809876543',
    shipper: 'ООО «ХИМПРОМ-ЭКСПОРТ», 198095, САНКТ-ПЕТЕРБУРГ, ПР. ЗАВОДСКОЙ, Д. 12',
    shipperEn: 'KHIMPROM-EXPORT LLC, 198095, SAINT PETERSBURG, ZAVODSKOY AVE. 12',
    consignee: 'ANATOLIA BOYA SANAYI A.S., MERSIN, TURKIYE',
    consigneeEn: 'ANATOLIA BOYA SANAYI A.S., MERSIN, TURKIYE',
    notify: 'ANATOLIA BOYA SANAYI A.S., MERSIN, TURKIYE',
    dischargePort: 'Mersin(TRMER)',
    destination: 'Mersin(TRMER)',
    containers: [
      { owner: 'KHPU', serial: 205114, iso: '22G1', type: '20DC', seal: 'BH0452311', tare: 2210, bl: 'BHRN2611E0003',
        goods: [{ name: 'Краска лакокрасочная, бочки', en: 'PAINT', places: 80, gross: 17600, cls: '3', un: '1263' }] },
      { owner: 'KHPU', serial: 205120, iso: '22G1', type: '20DC', seal: 'BH0452312', tare: 2230, bl: 'BHRN2611E0003',
        goods: [{ name: 'Краска лакокрасочная, бочки', en: 'PAINT', places: 76, gross: 16800, cls: '3', un: '1263' }] },
      { owner: 'KHPU', serial: 205136, iso: '22G1', type: '20DC', seal: 'BH0452313', tare: 2200, bl: 'BHRN2611E0004',
        goods: [{ name: 'Удобрения минеральные, мешки', en: 'MINERAL FERTILIZER', places: 24, gross: 24000 }] },
      { owner: 'KHPU', serial: 205142, iso: '22G1', type: '20DC', seal: 'BH0452314', tare: 2240, bl: 'BHRN2611E0004',
        goods: [{ name: 'Средство моющее щелочное, канистры', en: 'CLEANING COMPOUND, ALKALINE', places: 600, gross: 12500, cls: '8', un: '1719' }] },
    ],
  },
];
for (const order of ORDERS) {
  for (const c of order.containers) c.number = container(c.owner, c.serial);
}

const cargoWeightOf = (c) => c.goods.filter((g) => g.name !== 'поддоны').reduce((s, g) => s + g.gross, 0);
const grossOf = (c) => c.goods.reduce((s, g) => s + g.gross, 0);
const placesOf = (c) => c.goods.reduce((s, g) => s + g.places, 0);
const dgText = (c) => c.goods.filter((g) => g.cls).map((g) => `IMO ${g.cls} UN ${g.un};`).join('');

/* ——— Манифест (формат lib/manifest-format.js) ——— */

// 23 заголовка C:Y — как в реальном манифесте системы. «Веc» — с латинской «c»,
// как в реальных файлах (CLAUDE.md, «Подводные камни»): инструменты ищут колонки
// по «груза»/«тары»/«общий», а не по слову «вес».
const MANIFEST_HEADERS_EXPORT = [
  '№п/п', '№ контейнера', 'Футность', 'Порт отправления', 'Порт назначения', 'Веc груза', 'Веc тары',
  'Общий Веc', 'Опасные грузы', 'Темп-ра(для RF)', 'Негабаритные грузы(см)', '№ поручения', '№ коносамента',
  'Пломбы', 'Груз', 'Груз (перевод)', 'Количество мест', 'Тип мест', 'Экспедитор', 'Отправитель',
  'Получатель', 'Вет.контроль', 'Порт погрузки',
];
const MANIFEST_HEADERS_IMPORT = MANIFEST_HEADERS_EXPORT.map((h) => (h === '№ поручения' ? '№ букинга' : h));

function buildManifest({ title, voyage, headers, rows }) {
  const wb = newWorkbook();
  const sheet = wb.addWorksheet('Manifest');
  sheet.getCell('C3').value = title;
  sheet.getCell('J3').value = `Рейс № ${voyage}`;
  boldRow(sheet, 3);
  setRow(sheet, 5, 3, headers);
  boldRow(sheet, 5);
  rows.forEach((values, i) => {
    setRow(sheet, 6 + i, 3, [i + 1, ...values]);
    for (const col of [8, 9, 10]) sheet.getRow(6 + i).getCell(col).numFmt = '#,##0.000';
  });
  const widths = { C: 6, D: 15, E: 9, F: 30, G: 22, H: 12, I: 12, J: 12, K: 18, N: 22, O: 17, P: 13, Q: 30, R: 30, U: 18, V: 40, W: 40 };
  for (const [letter, width] of Object.entries(widths)) sheet.getColumn(letter).width = width;
  return wb;
}

// Строка экспортного манифеста — значения колонок D:Y (C — №п/п — ставит buildManifest)
function exportRow(order, c) {
  const cargo = cargoWeightOf(c);
  const goods = c.goods.filter((g) => g.name !== 'поддоны');
  const [nameRu, pack] = goods[0].name.split(', ');
  return [
    c.number, c.type, LOADING_PORT, order.destination, cargo, c.tare, cargo + c.tare, dgText(c), '', '',
    order.number, c.bl, c.svodSeal ?? c.seal, goods[0].en, nameRu, placesOf(c), pack, 'Неноминированный',
    order.shipper, order.consignee, '', 'Санкт-Петербург',
  ];
}

const exportTitle = `Список на погрузку т/х ${EXPORT.vessel}`;
const exportRows = (orders) => orders.flatMap((order) => order.containers.map((c) => exportRow(order, c)));

/* ——— Поручение (формат lib/loading-order.js) ——— */

const ORDER_COLUMNS = [
  'Номер контейнера', 'Владелец, SOC / LOC/-', 'Код ИСО', 'Номер пломбы', 'Наименование груза, род упаковки',
  'Число мест', 'Класс опасности', 'Код опасности', 'Нетто груза', 'Брутто груза', 'Вес контейнера',
  'Брутто груза с весом контейнера',
];

function buildOrder(order) {
  const wb = newWorkbook();
  const sheet = wb.addWorksheet(`№ ${order.number}`);
  const head = {
    A1: 'Номер поручения', B1: order.number, C1: 'Дата', D1: order.date, E1: 'Клиент', F1: order.client,
    G1: 'ИНН', H1: order.inn,
    A2: 'Отправитель', B2: order.shipper, C2: 'Отправитель (англ)', D2: order.shipperEn,
    A3: 'Грузополучатель', B3: order.consignee, C3: 'Грузополучатель (англ)', D3: order.consigneeEn,
    A4: 'Извещение', B4: order.notify,
    A7: 'Линейный оператор', B7: 'NORDIC FEEDER LINE', E7: 'Судно', F7: EXPORT.vessel, G7: 'Рейс', H7: EXPORT.voyage,
    I7: 'Порт погрузки', J7: 'Санкт-Петербург', K7: 'Порт выгрузки', L7: order.dischargePort,
  };
  for (const [address, value] of Object.entries(head)) sheet.getCell(address).value = value;
  setRow(sheet, 8, 1, ORDER_COLUMNS);
  boldRow(sheet, 8);
  let r = 9;
  for (const c of order.containers) {
    c.goods.forEach((g, i) => {
      const net = g.name === 'поддоны' ? null : round3(g.gross * 0.98);
      setRow(sheet, r++, 1, i === 0
        ? [c.number, '-', c.iso, c.seal, g.name, g.places, g.cls, g.un, net, g.gross, c.tare, grossOf(c) + c.tare]
        : [null, null, null, null, g.name, g.places, g.cls, g.un, net, g.gross, null, null]);
    });
  }
  sheet.getRow(r).getCell(1).value = 'Дополнительные сведения';
  sheet.getRow(r + 1).getCell(1).value = 'Поручение сформировано для примера, данные выдуманы.';
  for (const [letter, width] of Object.entries({ A: 18, B: 16, C: 10, D: 14, E: 38, F: 10, G: 10, H: 10, I: 12, J: 12, K: 12, L: 16 })) {
    sheet.getColumn(letter).width = width;
  }
  return wb;
}

/* ——— Шаблон эл. поручения (форма template-check/template-form.js) ——— */

const TEMPLATE_HEADERS = [
  'НОМЕР КОНОСАМЕНТА', 'НОМЕР ПОРУЧЕНИЯ', 'ДАТА КОНОСАМЕНТА', 'МЕСТО ИЗДАНИЯ', 'НОМЕР КОНТЕЙНЕРА', 'ISO КОД',
  'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', 'НАИМЕНОВАНИЕ ГРУЗА АНГЛ.', 'НАИМЕНОВАНИЕ ГРУЗА РУС.', 'PRE-CARRIAGE BY',
  'PLACE OF RECEIPT', 'PLACE OF DELIVERY', 'УСЛОВИЯ ПОСТАВКИ',
  'TYPE OF MOVEMENT', // старый заголовок — «исправлю сам» на эталонный «TYPE OF MOVERMENT»
  'НОМЕРА ПЛОМБ', 'ТИП УПАКОВКИ', 'КОЛИЧЕСТВО МЕСТ', 'ВЕС ГРУЗА', 'ВЕС ТАРЫ', 'ОБЪЕМ', 'ВГМ',
  'SHIPPER', 'SHIPPER_ADDRESS', 'CONSIGNEE', 'CONSIGNEE_ADDRESS', 'NOTIFY', 'NOTIFY_ADDRESS', 'ТЕМПЕРАТУРА',
  'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', 'ПОРОЖНИЙ', 'НАИМЕНОВАНИЕ или ИНН ЭКСПЕДИТОРА', 'LOC_SOC',
];
const toCyrillic = (text) => text.replace(/B/g, 'В').replace(/H/g, 'Н');

function buildTemplate(order) {
  const wb = newWorkbook();
  const sheet = wb.addWorksheet('EXPORT_MANIFEST');
  const head = {
    E1: 'ЛИНИЯ', F1: 'NORDIC FEEDER LINE', E2: 'СУДНО', F2: EXPORT.vessel, E3: 'РЕЙС', F3: EXPORT.voyage,
    E4: 'ДАТА ПРИХОДА', F4: '03.11.2026', E5: 'ДАТА ВЫХОДА', F5: '05.11.2026',
    E6: 'ТЕРМИНАЛ ПОГРУЗКИ', F6: 'Timber Port', E7: 'ТЕРМИНАЛ ВЫГРУЗКИ', F7: 'Port Said Container Terminal',
    H3: 'Таблицу заполнять строго в соответствии с п/поручением,',
    H4: ' ДТ и товаро-сопроводительными документами!!',
    H6: 'Графы, выделенные жёлтым цветом, обязательны к заполнению! ',
  };
  for (const [address, value] of Object.entries(head)) sheet.getCell(address).value = value;
  setRow(sheet, 9, 1, TEMPLATE_HEADERS);
  boldRow(sheet, 9);
  order.containers.forEach((c, i) => {
    const goods = c.goods.filter((g) => g.name !== 'поддоны');
    const [nameRu] = goods[0].name.split(', ');
    // У третьего контейнера пломба набрана русскими «В» и «Н» — на вид не отличить
    const seal = i === 2 ? toCyrillic(c.seal) : c.seal;
    setRow(sheet, 10 + i, 1, [
      c.bl, order.number, '05.11.2026', 'SAINT PETERSBURG', c.number, c.type, 'Port Said', goods[0].en, nameRu,
      'TRUCK', 'SAINT PETERSBURG', 'Port Said', 'CY/CY', 'FCL/FCL', seal, 'PK', placesOf(c),
      cargoWeightOf(c), c.tare, c.volume, grossOf(c) + c.tare,
      'NORTHERN TIMBER LLC', '197022, SAINT PETERSBURG, LESNAYA STR. 7', 'NILE WOOD TRADING CO.', 'PORT SAID, EGYPT',
      'the same', 'the same', '-', 'NOT IMO', 'NO', `ИНН ${order.inn}`, 'LOC',
    ]);
  });
  sheet.getColumn('A').width = 18;
  sheet.getColumn('E').width = 15;
  const reference = wb.addWorksheet('Reference');
  ['FCL/FCL', 'FCL/LCL', 'LCL/LCL', 'LCL/FCL'].forEach((v, i) => { reference.getCell(`A${i + 1}`).value = v; });
  ['CY/CY', 'CY/DOOR', 'DOOR/DOOR', 'DOOR/CY', 'GATE/GATE'].forEach((v, i) => { reference.getCell(`B${i + 1}`).value = v; });
  return wb;
}

/* ——— Импорт: рейс AURORA BAY 2604W, Nansha / Istanbul → Санкт-Петербург ——— */

const IMPORT = { vessel: 'AURORA BAY', voyage: '2604W' };
const DELIVERY = 'RUPLP';
const LOAD_PORTS = {
  CNNSA: { pol: 'NANSHA', system: 'NANSHA,CHINA (CNNSA)' },
  TRIST: { pol: 'ISTANBUL', system: 'ISTANBUL (TRIST)' },
};
const PARTIES = {
  furniture: {
    shipper: 'GUANGZHOU HOMELINE FURNITURE CO., LTD', shipperAddress: 'PANYU DISTRICT, GUANGZHOU, CHINA',
    consignee: 'LLC "DOM I UYUT"', consigneeAddress: '196084, ST. PETERSBURG, MOSKOVSKY PR. 101',
  },
  parts: {
    shipper: 'FOSHAN AUTOLINK PARTS CO., LTD', shipperAddress: 'NANHAI DISTRICT, FOSHAN, CHINA',
    consignee: 'LLC "AVTODETAL-SEVER"', consigneeAddress: '192019, ST. PETERSBURG, OBUKHOVSKOY OBORONY PR. 70',
  },
  cherries: {
    shipper: 'EGE FROZEN FOODS A.S.', shipperAddress: 'TUZLA, ISTANBUL, TURKIYE',
    consignee: 'LLC "SEVERNYE YAGODY"', consigneeAddress: '188640, LENINGRAD REGION, VSEVOLOZHSK, ZAVODSKAYA STR. 3',
  },
  chemicals: {
    shipper: 'MARMARA KIMYA SANAYI A.S.', shipperAddress: 'GEBZE, KOCAELI, TURKIYE',
    consignee: 'LLC "TEKHNOKHIM"', consigneeAddress: '195027, ST. PETERSBURG, SVERDLOVSKAYA NAB. 44',
  },
};

// Строки исходного файла линии. cargoWeight — как в файле линии (у одной строки
// нарочно тонны), systemCargo — как внесено в систему, если отличается.
const IMPORT_ROWS = [
  { bl: 'ABAY2604W0001', owner: 'HMLU', serial: 802113, type: '40HC', port: 'CNNSA', parties: 'furniture',
    cargo: 'FURNITURE (SOFAS AND CHAIRS)', cargoRus: 'МЕБЕЛЬ', seal: 'AB2604101', places: 312, pack: 'CARTONS',
    cargoWeight: 9850, measurement: 68.5, tare: 3880 },
  { bl: 'ABAY2604W0001', owner: 'HMLU', serial: 802129, type: '40HC', port: 'CNNSA', parties: 'furniture',
    cargo: 'FURNITURE (SOFAS AND CHAIRS)', cargoRus: 'МЕБЕЛЬ', seal: 'AB2604102', places: 298, pack: 'CARTONS',
    cargoWeight: 10240, measurement: 67.2, tare: 3900, systemCargo: 10420 }, // в системе цифры переставлены
  { bl: 'ABAY2604W0001', owner: 'HMLU', serial: 802135, type: '40HC', port: 'CNNSA', parties: 'furniture',
    cargo: 'FURNITURE (SOFAS AND CHAIRS)', cargoRus: 'МЕБЕЛЬ', seal: 'AB2604103', places: 305, pack: 'CARTONS',
    cargoWeight: 9610, measurement: 66.8, tare: 3850, wrongDigit: true }, // опечатка в контрольной цифре
  { bl: 'ABAY2604W0002', owner: 'FALU', serial: 315046, type: '20GP', port: 'CNNSA', parties: 'parts',
    cargo: 'AUTO SPARE PARTS', cargoRus: 'АВТОЗАПЧАСТИ', seal: 'AB2604104', places: 540, pack: 'CARTONS',
    cargoWeight: 18.42, measurement: 27.9, tare: 2190 }, // вес в тоннах вместо 18 420 кг
  { bl: 'ABAY2604W0002', owner: 'FALU', serial: 315052, type: '20GP', port: 'CNNSA', parties: 'parts',
    cargo: 'AUTO SPARE PARTS', cargoRus: 'АВТОЗАПЧАСТИ', seal: 'AB2604105', places: 515, pack: 'CARTONS',
    cargoWeight: 17960, measurement: 27.1, tare: 2210 },
  { bl: 'ABAY2604W0003', owner: 'EGFU', serial: 550318, type: '40RH', port: 'TRIST', parties: 'cherries',
    cargo: 'FROZEN SOUR CHERRIES', cargoRus: 'ВИШНЯ ЗАМОРОЖЕННАЯ', seal: 'AB2604106', places: 20, pack: 'PALLETS',
    cargoWeight: 24600, measurement: 58.4, tare: 4650, temperature: -18 },
  { bl: 'ABAY2604W0003', owner: 'EGFU', serial: 550324, type: '40RH', port: 'TRIST', parties: 'cherries',
    cargo: 'FROZEN SOUR CHERRIES', cargoRus: 'ВИШНЯ ЗАМОРОЖЕННАЯ', seal: 'AB2604107', places: 20, pack: 'PALLETS',
    cargoWeight: 24350, measurement: 57.9, tare: 4680, temperature: -18 },
  { bl: 'ABAY2604W0004', owner: 'MKSU', serial: 117640, type: '20GP', port: 'TRIST', parties: 'chemicals',
    cargo: 'BATTERY FLUID, ACID', cargoRus: 'ЖИДКОСТЬ АККУМУЛЯТОРНАЯ КИСЛОТНАЯ', seal: 'AB2604108', places: 80, pack: 'DRUMS',
    cargoWeight: 16800, measurement: 22.4, tare: 2230, imo: '8', un: '2796', dgUn: '2797' }, // в DG-манифесте UN 2797
  { bl: 'ABAY2604W0004', owner: 'MKSU', serial: 117656, type: '20GP', port: 'TRIST', parties: 'chemicals',
    cargo: 'PAINT', cargoRus: 'КРАСКА', seal: 'AB2604109', places: 72, pack: 'DRUMS',
    cargoWeight: 15400, measurement: 21.8, tare: 2200, imo: '3', un: '1263' },
];
for (const r of IMPORT_ROWS) {
  const good = container(r.owner, r.serial);
  r.container = r.wrongDigit ? withWrongDigit(good) : good;
}

const SOURCE_HEADERS = [
  'номер коносамента', 'номер контейнера', 'Тип контейнера ', 'POL', 'TOL', 'CARGONAME_ENG',
  'CARGONAME_RUS', 'SEAL', 'PLACES', 'Тип упаковки', 'Наименование упаковки ', 'CARGOWEIGHT',
  'MEASUREMEN', 'PlaceOfReceipt', 'PlaceOfDelivery', 'SHIPPER', 'SHIPPER_ADDRESS', 'CONSIGNEE',
  'CONSIGNEE_ADDRESS', 'NOTIFY', 'NOTIFY_ADDRESS', 'Температура', 'IMO CLASS', 'UNNO', 'TAREWEIGHT', 'ISEMPTY',
];
const SOURCE_HEADER_ROW = 10;

function buildSourceFile() {
  const wb = newWorkbook();
  const sheet = wb.addWorksheet('Sheet1');
  const head = {
    D1: 'Судно', E1: IMPORT.vessel, D2: 'Рейс', E2: IMPORT.voyage, D3: 'Линия', E3: 'NORDIC FEEDER LINE',
    D7: 'Терминал выгрузки', E7: DELIVERY,
  };
  for (const [address, value] of Object.entries(head)) sheet.getCell(address).value = value;
  setRow(sheet, SOURCE_HEADER_ROW, 1, SOURCE_HEADERS);
  boldRow(sheet, SOURCE_HEADER_ROW);
  IMPORT_ROWS.forEach((r, i) => {
    const p = PARTIES[r.parties];
    setRow(sheet, SOURCE_HEADER_ROW + 1 + i, 1, [
      r.bl, r.container, r.type, LOAD_PORTS[r.port].pol, DELIVERY, r.cargo, r.cargoRus, r.seal, r.places, '', r.pack,
      r.cargoWeight, r.measurement, r.port, DELIVERY, p.shipper, p.shipperAddress, p.consignee, p.consigneeAddress,
      p.consignee, p.consigneeAddress, r.temperature, r.imo, r.un, r.tare, 'N',
    ]);
  });
  for (const [letter, width] of Object.entries({ A: 17, B: 15, F: 30, G: 30, P: 36, Q: 34, R: 26, S: 44, T: 26, U: 44 })) {
    sheet.getColumn(letter).width = width;
  }
  return wb;
}

const SYSTEM_TYPE = { '40HC': '40HC', '20GP': '20DC', '40RH': '40RF' };

function importManifestRow(r) {
  const p = PARTIES[r.parties];
  const cargo = r.systemCargo ?? r.cargoWeight;
  return [
    r.container, SYSTEM_TYPE[r.type], LOAD_PORTS[r.port].system, 'St.Petersburg, Timber Port (RUPLP)',
    cargo, r.tare, round3(cargo + r.tare), r.imo ? `IMO ${r.imo} UN ${r.un};` : '', r.temperature, '', '', r.bl,
    r.seal, r.cargo, r.cargoRus, r.places, r.pack, 'Неноминированный', `${p.shipper} ${p.shipperAddress}`,
    `${p.consignee} ${p.consigneeAddress}`, '', LOAD_PORTS[r.port].pol,
  ];
}

/* ——— DG-манифест: официальный документ, заголовки по-английски ——— */

function buildDgManifest() {
  const wb = newWorkbook();
  const sheet = wb.addWorksheet('DG Manifest');
  sheet.getCell('A1').value = 'DANGEROUS GOODS MANIFEST';
  sheet.getCell('A2').value = `Vessel: ${IMPORT.vessel}    Voyage: ${IMPORT.voyage}    Port of discharge: St. Petersburg (RUPLP)`;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  const headers = ['No.', 'B/L No.', 'CNTR No.', 'Seal No.', 'UN No.', 'CLS(Sub)', 'Proper Shipping Name', 'PG', 'Gross Weight (kg)'];
  setRow(sheet, 4, 1, headers);
  boldRow(sheet, 4);
  const dg = IMPORT_ROWS.filter((r) => r.imo);
  const names = { 2796: 'BATTERY FLUID, ACID', 2797: 'BATTERY FLUID, ALKALI', 1263: 'PAINT' };
  dg.forEach((r, i) => {
    const un = r.dgUn ?? r.un;
    setRow(sheet, 5 + i, 1, [i + 1, r.bl, r.container, r.seal, un, r.imo, names[un], r.imo === '8' ? 'II' : 'III', r.cargoWeight]);
  });
  for (const [letter, width] of Object.entries({ A: 5, B: 16, C: 15, D: 12, E: 8, F: 9, G: 28, H: 5, I: 16 })) sheet.getColumn(letter).width = width;
  return wb;
}

/* ——— Сборка ——— */

/**
 * Все примеры: имя файла → книга ExcelJS.
 * @returns {Map<string, import('exceljs').Workbook>}
 */
export function buildSamples() {
  const samples = new Map();
  samples.set('manifest-eksport-chast-1.xlsx', buildManifest({
    title: exportTitle, voyage: EXPORT.voyage, headers: MANIFEST_HEADERS_EXPORT, rows: exportRows([ORDERS[0]]),
  }));
  samples.set('manifest-eksport-chast-2.xlsx', buildManifest({
    title: exportTitle, voyage: EXPORT.voyage, headers: MANIFEST_HEADERS_EXPORT, rows: exportRows([ORDERS[1]]),
  }));
  samples.set('manifest-eksport-svod.xlsx', buildManifest({
    title: exportTitle, voyage: EXPORT.voyage, headers: MANIFEST_HEADERS_EXPORT, rows: exportRows(ORDERS),
  }));
  for (const order of ORDERS) samples.set(order.file, buildOrder(order));
  samples.set('shablon-poruchenija.xlsx', buildTemplate(ORDERS[0]));
  samples.set('ishodnyj-fajl-linii.xlsx', buildSourceFile());
  samples.set('manifest-import.xlsx', buildManifest({
    title: `Список на выгрузку т/х ${IMPORT.vessel}`, voyage: IMPORT.voyage, headers: MANIFEST_HEADERS_IMPORT,
    rows: IMPORT_ROWS.map(importManifestRow),
  }));
  samples.set('dg-manifest.xlsx', buildDgManifest());
  return samples;
}

/**
 * Байты .xlsx. ExcelJS ставит каждой записи архива время записи — без
 * перепаковки с постоянной датой повторный запуск менял бы все файлы в git.
 * JSZip — тот же, на котором пишет сам ExcelJS (его зависимость).
 * @returns {Promise<Buffer>}
 */
export async function toXlsxBuffer(wb) {
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  zip.forEach((path, entry) => { entry.date = FIXED_DATE; });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

async function main() {
  mkdirSync(SAMPLES_DIR, { recursive: true });
  const samples = buildSamples();
  // Старые примеры, которых скрипт больше не делает, убираются
  for (const name of readdirSync(SAMPLES_DIR)) {
    if (name.endsWith('.xlsx') && !samples.has(name)) unlinkSync(join(SAMPLES_DIR, name));
  }
  for (const [name, wb] of samples) {
    writeFileSync(join(SAMPLES_DIR, name), await toXlsxBuffer(wb));
    console.log(`  ${name}`);
  }
  console.log(`Готово: ${samples.size} файлов в ${SAMPLES_DIR}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
