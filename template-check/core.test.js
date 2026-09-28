import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { detectFileKind, checkTemplate } from './core.js';

// Синтетические книги по устройству настоящих (reference.md: «Форма шаблона»,
// «Поручение»). Все значения выдуманные — данных заказчиков в репозитории нет.

const ORDER_NUMBER = '7700000000-P26-00001';
const ORDER_COLUMNS = [
  'Номер контейнера', 'Владелец, SOC / LOC/-', 'Код ИСО', 'Номер пломбы', 'Наименование груза, род упаковки',
  'Число мест', 'Класс опасности', 'Код опасности', 'Нетто груза', 'Брутто груза', 'Вес контейнера',
  'Брутто груза с весом контейнера',
];
// Первый контейнер — один товар и строка «поддоны» (как в образце 1), второй —
// два товара без поддонов (как в образце 2). «Брутто груза с весом контейнера» —
// брутто всех строк + вес контейнера: 28120 + 440 + 3700 = 32260, 5000 + 1000 + 2200 = 8200.
const ORDER_CONTAINERS = [
  { number: 'TEST1234567', owner: '-', iso: '45G1', seal: '123456', tare: 3700,
    goods: [{ name: 'Бумага', places: 20, gross: 28120 }, { name: 'поддоны', places: 0, gross: 440 }] },
  { number: 'TEST7654321', owner: '-', iso: '22G1', seal: 'AB0012', tare: 2200,
    goods: [{ name: 'Запчасти', places: 10, gross: 5000 }, { name: 'Двигатель', places: 2, gross: 1000 }] },
];
// Те же два контейнера поручения ещё раз под другими номерами — для тестов A07/G03
// с 3+ строками одного коносамента, где нужно больше двух разных контейнеров.
const ORDER_CONTAINERS_4 = [
  ORDER_CONTAINERS[0], ORDER_CONTAINERS[1],
  { ...ORDER_CONTAINERS[0], number: 'TEST1111111' },
  { ...ORDER_CONTAINERS[1], number: 'TEST2222222' },
];

function buildOrder({ number = ORDER_NUMBER, date = '07.09.2026', vessel = 'TEST VESSEL', voyage = '0001E',
  dischargePort = 'Port Said(EGPSD)', containers = ORDER_CONTAINERS } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`№ ${number}`);
  const head = {
    A1: 'Номер поручения', B1: number, C1: 'Дата', D1: date, G1: 'ИНН', H1: '7700000000',
    A2: 'Отправитель', B2: 'ООО РОМАШКА, МОСКВА', C2: 'Отправитель (англ)', D2: 'ROMASHKA LLC, MOSCOW',
    A3: 'Грузополучатель', B3: 'ТОО ВАСИЛЁК, АЛМАТЫ', C3: 'Грузополучатель (англ)', D3: 'VASILEK LLP, ALMATY',
    A4: 'Извещение', B4: 'VASILEK LLP, ALMATY',
    E7: 'Судно', F7: vessel, G7: 'Рейс', H7: voyage, I7: 'Порт погрузки', J7: 'Санкт-Петербург',
    K7: 'Порт выгрузки', L7: dischargePort,
  };
  for (const [address, value] of Object.entries(head)) sheet.getCell(address).value = value;
  ORDER_COLUMNS.forEach((title, i) => { sheet.getRow(8).getCell(i + 1).value = title; });
  let r = 9;
  for (const c of containers) {
    const total = c.total ?? c.goods.reduce((sum, g) => sum + g.gross, 0) + c.tare;
    c.goods.forEach((g, i) => {
      const values = i === 0
        ? [c.number, c.owner ?? '-', c.iso, c.seal, g.name, g.places, g.cls, g.un, null, g.gross, c.tare, total]
        : [null, null, null, null, g.name, g.places, g.cls, g.un, null, g.gross, null, null];
      values.forEach((v, col) => { if (v !== undefined && v !== null) sheet.getRow(r).getCell(col + 1).value = v; });
      r++;
    });
  }
  sheet.getRow(r).getCell(1).value = 'Дополнительные сведения';
  return workbook;
}

const STANDARD_HEADERS = {
  A: 'НОМЕР КОНОСАМЕНТА', B: 'НОМЕР ПОРУЧЕНИЯ', C: 'ДАТА КОНОСАМЕНТА', D: 'МЕСТО ИЗДАНИЯ', E: 'НОМЕР КОНТЕЙНЕРА',
  F: 'ISO КОД', G: 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', H: 'НАИМЕНОВАНИЕ ГРУЗА АНГЛ.', I: 'НАИМЕНОВАНИЕ ГРУЗА РУС.',
  J: 'PRE-CARRIAGE BY', K: 'PLACE OF RECEIPT', L: 'PLACE OF DELIVERY', M: 'УСЛОВИЯ ПОСТАВКИ', N: 'TYPE OF MOVERMENT',
  O: 'НОМЕРА ПЛОМБ', P: 'ТИП УПАКОВКИ', Q: 'КОЛИЧЕСТВО МЕСТ', R: 'ВЕС ГРУЗА', S: 'ВЕС ТАРЫ', T: 'ОБЪЕМ', U: 'ВГМ',
  V: 'SHIPPER', W: 'SHIPPER_ADDRESS', X: 'CONSIGNEE', Y: 'CONSIGNEE_ADDRESS', Z: 'NOTIFY', AA: 'NOTIFY_ADDRESS',
  AB: 'ТЕМПЕРАТУРА', AC: 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', AD: 'ПОРОЖНИЙ', AE: 'НАИМЕНОВАНИЕ или ИНН ЭКСПЕДИТОРА',
  AF: 'LOC_SOC',
};
const LETTERS = Object.keys(STANDARD_HEADERS);
const HEAD = {
  E1: 'ЛИНИЯ', F1: 'TEST LINE', E2: 'СУДНО', F2: 'TEST VESSEL', E3: 'РЕЙС', F3: '0001E',
  E4: 'ДАТА ПРИХОДА', F4: '09.09.2026', E5: 'ДАТА ВЫХОДА', F5: '11.09.2026', E6: 'ТЕРМИНАЛ ПОГРУЗКИ', F6: 'Timber Port',
  E7: 'ТЕРМИНАЛ ВЫГРУЗКИ', F7: 'Port Said Terminal', // содержит «Port Said» — как в order.dischargePort (L7)
  H3: 'Таблицу заполнять строго в соответствии с п/поручением,',
  H4: ' ДТ и товаро-сопроводительными документами!!',
  H6: 'Графы, выделенные жёлтым цветом, обязательны к заполнению! ',
};
// Номер коносамента с неразрывным пробелом в конце — так он записан в образце 1.
// ВГМ = вес груза + вес тары (без поддонов), как у трёх контейнеров образца 1.
// Заполнено всё, кроме необязательной D; AB/AC — «ничего нет» так, как пишет
// заказчик в реальной заявке («-», «NOT IMO»).
const ROW1 = {
  A: 'BL0001 ', B: ORDER_NUMBER, C: '09.09.2026', D: 'ST. PETERSBURG', E: 'TEST1234567', F: '40HC',
  G: 'Port Said', H: 'PAPER', I: 'Бумага', J: 'Truck', K: 'MOSCOW REGION', L: 'Port Said', M: 'CY/CY', N: 'FCL/FCL',
  O: 123456, P: 'PX', Q: 20, R: 28120, S: 3700, T: 30, U: 31820,
  V: 'ROMASHKA LLC', W: 'MOSCOW, RUSSIA', X: 'VASILEK LLP', Y: 'ALMATY, KAZAKHSTAN', Z: 'the same', AA: 'the same',
  AB: '-', AC: 'NOT IMO', AD: 'NO', AE: 'ИНН 7700000000', AF: 'LOC',
};
const ROW2 = {
  ...ROW1, E: 'TEST7654321', F: '22G1', H: 'SPARE PARTS', I: 'запчасти', O: 'AB0012', Q: 12, R: 6000, S: 2200, T: 20, U: 8200,
};

// rows: объект на строку (ключи — буквы эталонных колонок, extra — значения
// лишних колонок), null — пустая строка. columns — какие эталонные колонки и в
// каком порядке стоят на листе, headers — заголовки вместо эталонных.
function buildTemplate({ sheetName = 'EXPORT_MANIFEST', head = {}, headerRow = 9, rows = [ROW1, ROW2],
  columns = LETTERS, headers = {}, extra = [], sheets = [], merges = [], reference = true } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const [address, value] of Object.entries({ ...HEAD, ...head })) sheet.getCell(address).value = value;
  const cols = [
    ...columns.map((letter) => ({ letter, title: headers[letter] ?? STANDARD_HEADERS[letter] })),
    ...extra.map((title, i) => ({ extra: i, title })),
  ];
  cols.forEach((c, i) => { sheet.getRow(headerRow).getCell(i + 1).value = c.title; });
  rows.forEach((row, i) => {
    if (!row) return;
    cols.forEach((c, col) => {
      const value = c.letter ? row[c.letter] : row.extra?.[c.extra];
      if (value !== undefined && value !== null) sheet.getRow(headerRow + 1 + i).getCell(col + 1).value = value;
    });
  });
  for (const range of merges) sheet.mergeCells(range);
  if (reference) {
    const list = workbook.addWorksheet('Reference');
    ['FCL/FCL', 'FCL/LCL', 'LCL/LCL', 'LCL/FCL'].forEach((v, i) => { list.getCell(`A${i + 1}`).value = v; });
    ['CY/CY', 'CY/DOOR', 'DOOR/DOOR', 'DOOR/CY', 'GATE/GATE'].forEach((v, i) => { list.getCell(`B${i + 1}`).value = v; });
  }
  for (const name of sheets) workbook.addWorksheet(name);
  return workbook;
}

const OPTIONS = {
  createWorkbook: () => new ExcelJS.Workbook(),
  templateFileName: 'шаблон.xlsx',
  checkedAt: new Date(2026, 8, 12, 23, 40),
};
const orders = (...workbooks) => workbooks.map((workbook, i) => ({ fileName: `order${i + 1}.xlsx`, workbook }));

function check(template, orderEntries = orders(buildOrder())) {
  const result = checkTemplate(template, orderEntries, OPTIONS);
  assert.equal(result.ok, true, result.error);
  return result;
}

// Ровно одна находка под условие — иначе тест покажет все находки.
function only(result, predicate) {
  const found = result.findings.filter(predicate);
  assert.equal(found.length, 1, `находок под условие: ${found.length}\n${JSON.stringify(result.findings, null, 1)}`);
  return found[0];
}

const pick = ({ level, fix, section, sheet, cell, field, container }) => ({ level, fix, section, sheet, cell, field, container });
const brief = (f) => [f.cell, f.field, f.level, f.fix];
const formError = (fix, cell, field, sheet = 'EXPORT_MANIFEST') => (
  { level: 'error', fix, section: 'form', sheet, cell, field, container: null });

test('checkTemplate: эталонный шаблон с верным поручением — ни одной находки, исправленного шаблона нет', () => {
  // Заодно: NBSP в конце номера коносамента, 40HC при 45G1 в поручении и ВГМ,
  // равный весу груза + таре (без поддонов), — не находки.
  const result = check(buildTemplate());
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.topWarnings, []);
  assert.deepEqual(result.summary, { containers: 2, errors: 0, autoFixable: 0, needsCustomer: 0, warnings: 0 });
  assert.equal(result.correctedWorkbook, null);
});

test('detectFileKind: поручение, шаблон, шаблон на «Лист1», посторонняя книга', () => {
  assert.deepEqual(detectFileKind(buildOrder()), { kind: 'order', orderNumber: ORDER_NUMBER, containers: 2 });
  assert.deepEqual(detectFileKind(buildTemplate()), { kind: 'template', containers: 2 });
  assert.deepEqual(detectFileKind(buildTemplate({ sheetName: 'Лист1', rows: [ROW1] })), { kind: 'template', containers: 1 });
  const bare = new ExcelJS.Workbook();
  bare.addWorksheet('Export_Manifest');
  assert.deepEqual(detectFileKind(bare), { kind: 'template', containers: 0 });
  const foreign = new ExcelJS.Workbook();
  const sheet = foreign.addWorksheet('Данные');
  sheet.getCell('A1').value = 'Номер';
  sheet.getCell('B1').value = 'Сумма';
  sheet.getCell('A2').value = 1;
  assert.deepEqual(detectFileKind(foreign), { kind: 'unknown' });
});

test('detectFileKind: поручение проверяется первым', () => {
  const workbook = buildOrder();
  workbook.addWorksheet('EXPORT_MANIFEST');
  assert.equal(detectFileKind(workbook).kind, 'order');
});

test('форма: лист называется не EXPORT_MANIFEST — ошибка «исправлю сам» без ячейки', () => {
  for (const name of ['Лист1', 'export_manifest', 'EXPORT_MANIFEST ']) {
    const f = only(check(buildTemplate({ sheetName: name })), () => true);
    assert.deepEqual(pick(f), formError('auto', null, 'Лист', name));
    assert.match(f.message, /EXPORT_MANIFEST/);
  }
});

test('форма: лишний лист, в том числе скрытый — ошибка «исправлю сам» на каждом', () => {
  const workbook = buildTemplate({ sheets: ['Лист2', 'Скрытый'] });
  workbook.getWorksheet('Скрытый').state = 'hidden';
  const result = check(workbook);
  assert.deepEqual(result.findings.map(pick), [formError('auto', null, 'Лист', 'Лист2'), formError('auto', null, 'Лист', 'Скрытый')]);
});

test('форма: подпись шапки не на месте или неточная — «исправлю сам», ячейка — найденная подпись', () => {
  const misplaced = check(buildTemplate({ head: { E4: null, F4: null, B4: 'ДАТА ПРИХОДА', C4: '09.09.2026' } }));
  assert.deepEqual(pick(only(misplaced, () => true)), formError('auto', 'B4', 'ДАТА ПРИХОДА'));
  const inexact = check(buildTemplate({ head: { E6: 'Терминал погрузки:' } }));
  assert.deepEqual(pick(only(inexact, () => true)), formError('auto', 'E6', 'ТЕРМИНАЛ ПОГРУЗКИ'));
});

test('форма: строки шапки нет — СУДНО и ТЕРМИНАЛ ВЫГРУЗКИ из поручения, необязательные ЛИНИЯ и дата — «исправлю сам», ТЕРМИНАЛ ПОГРУЗКИ — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ head: {
    E1: null, F1: null, E2: null, F2: null, E4: null, F4: null, E6: null, F6: null, E7: null, F7: null,
  } }));
  assert.deepEqual(brief(only(result, (f) => f.field === 'СУДНО')), [null, 'СУДНО', 'error', 'auto']);
  assert.deepEqual(brief(only(result, (f) => f.field === 'ЛИНИЯ')), [null, 'ЛИНИЯ', 'error', 'auto']);
  assert.deepEqual(brief(only(result, (f) => f.field === 'ДАТА ПРИХОДА')), [null, 'ДАТА ПРИХОДА', 'error', 'auto']);
  assert.deepEqual(brief(only(result, (f) => f.field === 'ТЕРМИНАЛ ПОГРУЗКИ')), [null, 'ТЕРМИНАЛ ПОГРУЗКИ', 'error', 'customer']);
  const terminal = only(result, (f) => f.field === 'ТЕРМИНАЛ ВЫГРУЗКИ');
  assert.deepEqual(brief(terminal), [null, 'ТЕРМИНАЛ ВЫГРУЗКИ', 'error', 'auto']);
  assert.match(terminal.correction, /Port Said\(EGPSD\)/);
});

test('шапка: пустое значение — РЕЙС «исправлю сам», ТЕРМИНАЛ ПОГРУЗКИ «уточнить у заказчика»; ЛИНИЯ и даты не обязательны', () => {
  const result = check(buildTemplate({ head: { F1: null, F3: null, F4: null, F5: null, F6: null } }));
  assert.deepEqual(result.findings.map(brief), [
    ['F3', 'РЕЙС', 'error', 'auto'], ['F6', 'ТЕРМИНАЛ ПОГРУЗКИ', 'error', 'customer'],
  ]);
});

test('форма: строка заголовков не 9-я — «исправлю сам», ячейка — самая левая узнанная', () => {
  const result = check(buildTemplate({ headerRow: 10 }));
  assert.deepEqual(pick(only(result, () => true)), formError('auto', 'A10', 'Строка заголовков'));
});

test('форма: заголовок записан неточно — «исправлю сам», ячейка заголовка', () => {
  const result = check(buildTemplate({ headers: { R: 'Веc груза' } }));
  const f = only(result, () => true);
  assert.deepEqual(pick(f), formError('auto', 'R9', 'ВЕС ГРУЗА'));
  assert.match(f.message, /Веc груза/);
});

test('форма: колонка не на своём месте — «исправлю сам» у каждого заголовка, значения читаются по заголовку', () => {
  const columns = [...LETTERS];
  [columns[4], columns[5]] = [columns[5], columns[4]];
  const result = check(buildTemplate({ columns }));
  assert.deepEqual(result.findings.map(pick), [formError('auto', 'E9', 'ISO КОД'), formError('auto', 'F9', 'НОМЕР КОНТЕЙНЕРА')]);
});

test('форма: нет колонки — «исправлю сам»; у обязательной пустые значения — отдельные находки', () => {
  const noAF = check(buildTemplate({ columns: LETTERS.filter((l) => l !== 'AF') }));
  assert.deepEqual(pick(only(noAF, (f) => f.container === null)), formError('auto', null, 'LOC_SOC'));
  const noK = check(buildTemplate({ columns: LETTERS.filter((l) => l !== 'Q') }));
  assert.deepEqual(pick(only(noK, (f) => f.field === 'КОЛИЧЕСТВО МЕСТ' && f.container === null)), formError('auto', null, 'КОЛИЧЕСТВО МЕСТ'));
  const values = noK.findings.filter((f) => f.field === 'КОЛИЧЕСТВО МЕСТ' && f.container !== null);
  assert.deepEqual(values.map((f) => [f.cell, f.level, f.fix, f.container]),
    [[null, 'error', 'customer', 'TEST1234567'], [null, 'error', 'customer', 'TEST7654321']]);
});

test('форма: один заголовок в двух колонках — «уточнить у заказчика» у обеих ячеек', () => {
  const result = check(buildTemplate({ extra: ['ВЕС ГРУЗА'] }));
  assert.deepEqual(result.findings.map(pick), [formError('customer', 'R9', 'ВЕС ГРУЗА'), formError('customer', 'AG9', 'ВЕС ГРУЗА')]);
});

test('форма: лишняя колонка — «исправлю сам»; если под ней данные — сказано, что они не попадут', () => {
  const empty = only(check(buildTemplate({ extra: ['ПРИМЕЧАНИЕ'] })), () => true);
  assert.deepEqual(pick(empty), formError('auto', 'AG9', 'ПРИМЕЧАНИЕ'));
  assert.doesNotMatch(empty.message, /не попадут/);
  const filled = only(check(buildTemplate({ extra: ['ПРИМЕЧАНИЕ'], rows: [{ ...ROW1, extra: ['срочно'] }, ROW2] })), () => true);
  assert.match(filled.message, /данные этой колонки в исправленный шаблон не попадут/);
});

test('форма: пустая строка внутри таблицы — «исправлю сам», ячейка A этой строки', () => {
  const result = check(buildTemplate({ rows: [ROW1, null, ROW2] }));
  assert.deepEqual(pick(only(result, () => true)), formError('auto', 'A11', 'Строка'));
});

test('форма: строка «итого» — «исправлю сам», ячейка — первая непустая', () => {
  const total = { Q: 32, R: 34120, S: 5900, T: 50, U: 40020 };
  const result = check(buildTemplate({ rows: [ROW1, ROW2, total] }));
  assert.deepEqual(pick(only(result, () => true)), formError('auto', 'Q12', 'Строка'));
});

test('форма: строка без контейнера, но с данными — «уточнить у заказчика», ячейка D', () => {
  const result = check(buildTemplate({ rows: [ROW1, ROW2, { A: 'BL0001', I: 'ещё груз' }] }));
  assert.deepEqual(pick(only(result, () => true)), formError('customer', 'E12', 'НОМЕР КОНТЕЙНЕРА'));
});

test('форма: строка без контейнера с меткой «Итого» вне K–O и числами в K–O — «уточнить у заказчика», не auto-удаление', () => {
  // Метка вне K–O — это уже не «заполнены только K–O» (spec §4.4 дословно):
  // строка не считается итоговой и не удаляется молча в исправленном шаблоне.
  const result = check(buildTemplate({ rows: [ROW1, ROW2, { A: 'Итого', Q: 32, R: 34120, S: 5900, T: 50, U: 40020 }] }));
  assert.deepEqual(pick(only(result, () => true)), formError('customer', 'E12', 'НОМЕР КОНТЕЙНЕРА'));
});

test('форма: ни одной строки с контейнером — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ rows: [] }));
  assert.deepEqual(pick(only(result, (f) => f.section === 'form')), formError('customer', null, 'НОМЕР КОНТЕЙНЕРА'));
});

test('форма: объединённые ячейки — «исправлю сам», ячейка — главная, в тексте — диапазон', () => {
  const result = check(buildTemplate({ merges: ['A10:A11'] }));
  const f = only(result, () => true);
  assert.deepEqual(pick(f), formError('auto', 'A10', 'НОМЕР КОНОСАМЕНТА'));
  assert.match(f.message, /A10:A11/);
});

test('форма: L/M/O текстом — «исправлю сам»; K/N текстом — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, Q: '20', R: '28 120', T: '30', U: '31820,0' }, ROW2] }));
  assert.deepEqual(result.findings.map(brief), [
    ['Q10', 'КОЛИЧЕСТВО МЕСТ', 'error', 'customer'], ['R10', 'ВЕС ГРУЗА', 'error', 'auto'],
    ['T10', 'ОБЪЕМ', 'error', 'customer'], ['U10', 'ВГМ', 'error', 'auto'],
  ]);
  assert.match(result.findings[0].message, /текстом/);
  assert.match(result.findings[0].message, /исправьте вручную или уточните у заказчика/);
  assert.match(result.findings[1].message, /текстом/);
});

test('форма: дата датой Excel, в другом виде или не дата — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({
    head: { F4: new Date(Date.UTC(2026, 8, 9)), F5: '11.9.2026' },
    rows: [{ ...ROW1, C: '2026-09-09' }, { ...ROW2, A: 'BL0002', C: 'скоро' }],
  }));
  assert.deepEqual(result.findings.map(brief), [
    ['F4', 'ДАТА ПРИХОДА', 'error', 'customer'], ['F5', 'ДАТА ВЫХОДА', 'error', 'customer'],
    ['C10', 'ДАТА КОНОСАМЕНТА', 'error', 'customer'], ['C11', 'ДАТА КОНОСАМЕНТА', 'error', 'customer'],
  ]);
  assert.match(result.findings[0].message, /ДД\.ММ\.ГГГГ/);
});

/* ——— §5: сверка строк с поручением ——— */

const ORDER2_NUMBER = '7700000000-P26-00002';

test('B: контейнер из другого загруженного поручения — «исправлю сам», номер из того поручения', () => {
  const first = buildOrder({ containers: [ORDER_CONTAINERS[0]] });
  const second = buildOrder({ number: ORDER2_NUMBER, containers: [ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate(), orders(first, second)), () => true);
  assert.deepEqual(brief(f), ['B11', 'НОМЕР ПОРУЧЕНИЯ', 'error', 'auto']);
  assert.equal(f.correction, ORDER2_NUMBER);
  assert.equal(f.container, 'TEST7654321');
});

test('B: контейнер в двух поручениях, а в B ни одно из них — «уточнить у заказчика»', () => {
  const first = buildOrder({ containers: [ORDER_CONTAINERS[0]] });
  const second = buildOrder({ number: ORDER2_NUMBER, containers: [ORDER_CONTAINERS[0]] });
  const result = check(buildTemplate({ rows: [{ ...ROW1, B: '7700000000-P26-00009' }] }), orders(first, second));
  assert.deepEqual(brief(only(result, () => true)), ['B10', 'НОМЕР ПОРУЧЕНИЯ', 'error', 'customer']);
});

test('B с незагруженным поручением — предупреждение вверху, строка не сверена', () => {
  const result = check(buildTemplate({ rows: [ROW1, { ...ROW2, E: 'TEST0000009', B: 'OTHER-1' }] }));
  assert.deepEqual(result.topWarnings, ['Поручение OTHER-1 не загружено — 1 строка шаблона не сверена с поручением']);
  assert.deepEqual(result.findings.map(brief), [[null, 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer']]);
  assert.equal(result.findings[0].container, 'TEST7654321');
  assert.equal(result.summary.warnings, 1);
});

test('ни один контейнер шаблона не найден — вверху «похоже, загружено не то поручение»', () => {
  const other = buildOrder({ containers: [
    { ...ORDER_CONTAINERS[0], number: 'OTHR1234567' }, { ...ORDER_CONTAINERS[1], number: 'OTHR7654321' },
  ] });
  assert.deepEqual(check(buildTemplate(), orders(other)).topWarnings,
    ['Похоже, загружено не то поручение: ни один контейнер шаблона не найден в загруженных поручениях']);
});

test('разные судно и рейс у поручений — предупреждения вверху', () => {
  const first = buildOrder({ containers: [ORDER_CONTAINERS[0]] });
  const second = buildOrder({ number: ORDER2_NUMBER, vessel: 'OTHER VESSEL', voyage: '0002E', containers: [ORDER_CONTAINERS[1]] });
  const result = check(buildTemplate({ rows: [ROW1, { ...ROW2, B: ORDER2_NUMBER }] }), orders(first, second));
  assert.deepEqual(result.topWarnings, [
    'У загруженных поручений разные суда: «TEST VESSEL», «OTHER VESSEL»',
    'У загруженных поручений разные рейсы: «0001E», «0002E»',
  ]);
  assert.deepEqual(result.findings, []);
});

test('D: номер отличается регистром и пробелами — «исправлю сам»; повтор контейнера — у каждой строки', () => {
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, E: 'test 1234-567' }, ROW2] })), () => true);
  assert.deepEqual(brief(f), ['E10', 'НОМЕР КОНТЕЙНЕРА', 'error', 'auto']);
  assert.equal(f.correction, 'TEST1234567');
  const repeated = check(buildTemplate({ rows: [ROW1, { ...ROW2, E: 'TEST1234567' }] }));
  assert.deepEqual(repeated.findings.filter((x) => x.field === 'НОМЕР КОНТЕЙНЕРА' && x.cell).map(brief),
    [['E10', 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer'], ['E11', 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer']]);
});

test('D: контейнера нет ни в одном поручении — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, E: 'TEST0000009' }, ROW2] }));
  assert.deepEqual(brief(only(result, (f) => f.cell === 'E10')), ['E10', 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer']);
});

test('E: ISO — 2200 ≡ 22G1, 4532 ≡ 40RH, 40DV ≢ 45G1, неразобранные коды сравниваются строками', () => {
  const wrong = only(check(buildTemplate({ rows: [{ ...ROW1, F: '40DV' }, ROW2] })), () => true);
  assert.deepEqual(brief(wrong), ['F10', 'ISO КОД', 'error', 'auto']);
  assert.equal(wrong.correction, '45G1');
  const old = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: '2200' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, F: '22G1' }, ROW2] }), orders(old)).findings, []);
  const reefer = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: '40RH' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, F: '4532', AB: '-18' }, ROW2] }), orders(reefer)).findings, []);
  const odd = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: 'XYZ1' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, F: 'xyz1' }, ROW2] }), orders(odd)).findings, []);
  assert.equal(only(check(buildTemplate({ rows: [{ ...ROW1, F: 'XYZ2' }, ROW2] }), orders(odd)), () => true).cell, 'F10');
});

test('I: пломбы — набор в любом порядке; расхождение «исправлю сам»; в поручении пломбы нет — «уточнить у заказчика»', () => {
  const multi = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], seal: 'AB0012, CD0034' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, O: 'CD0034; ab0012' }, ROW2] }), orders(multi)).findings, []);
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, O: 999 }, ROW2] })), () => true);
  assert.deepEqual(brief(f), ['O10', 'НОМЕРА ПЛОМБ', 'error', 'auto']);
  assert.equal(f.correction, '123456');
  const noSeal = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], seal: '' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(brief(only(check(buildTemplate(), orders(noSeal)), () => true)), ['O10', 'НОМЕРА ПЛОМБ', 'error', 'customer']);
});

test('обязательные текстовые поля пустые — «уточнить у заказчика»; H кириллицей — тоже', () => {
  const cells = ['A', 'G', 'H', 'I', 'L', 'M', 'N', 'P', 'V', 'W', 'X', 'Y', 'Z', 'AA'];
  const row = { ...ROW1, H: 'БУМАГА' };
  for (const letter of cells) if (letter !== 'H') row[letter] = null;
  const result = check(buildTemplate({ rows: [row, ROW2] }));
  assert.deepEqual(result.findings.map(brief),
    cells.map((letter) => [`${letter}10`, STANDARD_HEADERS[letter], 'error', 'customer']));
});

test('необязательные D, J, K, T, AB–AF пустые — находок нет (так их приняла система)', () => {
  const optional = ['D', 'J', 'K', 'T', 'AB', 'AC', 'AD', 'AE', 'AF'];
  const clear = (row) => Object.fromEntries(Object.entries(row).filter(([letter]) => !optional.includes(letter)));
  assert.deepEqual(check(buildTemplate({ rows: [clear(ROW1), clear(ROW2)] })).findings, []);
});

test('M, N: значение из списка Reference; другой регистр/пробелы — «исправлю сам», чужое — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, M: 'cy / cy', N: 'FCL-FCL' }, ROW2] }));
  assert.deepEqual(result.findings.map(brief), [
    ['M10', 'УСЛОВИЯ ПОСТАВКИ', 'error', 'auto'], ['N10', 'TYPE OF MOVERMENT', 'error', 'customer'],
    // строки одного коносамента теперь расходятся — это тоже находки (A07/G03)
    ['M11', 'УСЛОВИЯ ПОСТАВКИ', 'error', 'customer'], ['N11', 'TYPE OF MOVERMENT', 'error', 'customer'],
  ]);
  assert.equal(result.findings[0].correction, 'CY/CY');
  assert.match(result.findings[1].message, /FCL\/FCL, FCL\/LCL, LCL\/LCL, LCL\/FCL/);
});

test('лист Reference — часть формы: не «лишний»; без него тоже нет находки, в исправленном шаблоне он есть', async () => {
  assert.deepEqual(check(buildTemplate()).findings, []);
  assert.deepEqual(check(buildTemplate({ reference: false })).findings, []);
  const result = check(buildTemplate({ reference: false, rows: [{ ...ROW1, R: 28000 }, ROW2] }));
  const corrected = await roundTrip(result.correctedWorkbook);
  assert.deepEqual(corrected.worksheets.map((sheet) => sheet.name), ['EXPORT_MANIFEST', 'Reference']);
  const reference = corrected.getWorksheet('Reference');
  assert.deepEqual([1, 2, 3, 4].map((r) => reference.getCell(`A${r}`).value), ['FCL/FCL', 'FCL/LCL', 'LCL/LCL', 'LCL/FCL']);
  assert.deepEqual([1, 2, 3, 4, 5].map((r) => reference.getCell(`B${r}`).value),
    ['CY/CY', 'CY/DOOR', 'DOOR/DOOR', 'DOOR/CY', 'GATE/GATE']);
});

test('старые заголовки «ИНН ЭКСПЕДИТОРА» и «TYPE OF MOVEMENT» узнаются — «исправлю сам» на заголовок формы', () => {
  const result = check(buildTemplate({ headers: { AE: 'ИНН ЭКСПЕДИТОРА', N: 'TYPE OF MOVEMENT' } }));
  assert.deepEqual(result.findings.map(brief), [
    ['N9', 'TYPE OF MOVERMENT', 'error', 'auto'], ['AE9', 'НАИМЕНОВАНИЕ или ИНН ЭКСПЕДИТОРА', 'error', 'auto'],
  ]);
});

test('кириллическая буква в пломбе и номере контейнера — «исправлю сам», в сообщении сказано про кириллицу', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, E: 'ТЕST1234567' }, { ...ROW2, O: 'АВ0012' }] }));
  assert.deepEqual(result.findings.map(brief), [
    ['E10', 'НОМЕР КОНТЕЙНЕРА', 'error', 'auto'], ['O11', 'НОМЕРА ПЛОМБ', 'error', 'auto'],
  ]);
  assert.deepEqual(result.findings.map((f) => f.correction), ['TEST1234567', 'AB0012']);
  assert.ok(result.findings.every((f) => /кириллические буквы вместо латинских/.test(f.message)));
});

test('AE: ИНН экспедитора не совпадает с ИНН поручения — предупреждение; наименование без ИНН — не сверяется', () => {
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, AE: 'ИНН 7800000000' }, ROW2] })), () => true);
  assert.deepEqual(brief(f), ['AE10', 'НАИМЕНОВАНИЕ или ИНН ЭКСПЕДИТОРА', 'warning', null]);
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, AE: 'ООО ЭКСПЕДИТОР' }, ROW2] })).findings, []);
});

test('P: код упаковки не из двух знаков — предупреждение (A04)', () => {
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, P: 'PALLETS' }, { ...ROW2, P: 'PALLETS' }] })), (x) => x.cell === 'P10');
  assert.deepEqual(brief(f), ['P10', 'ТИП УПАКОВКИ', 'warning', null]);
});

test('Q: мест не столько — у одного товара ошибка «уточнить у заказчика», у нескольких предупреждение (G01)', () => {
  const single = only(check(buildTemplate({ rows: [{ ...ROW1, Q: 18 }, ROW2] })), () => true);
  assert.deepEqual(brief(single), ['Q10', 'КОЛИЧЕСТВО МЕСТ', 'error', 'customer']);
  assert.match(single.message, /в шаблоне 18, по поручению 20/);
  const many = only(check(buildTemplate({ rows: [ROW1, { ...ROW2, Q: 10 }] })), () => true);
  assert.deepEqual(brief(many), ['Q11', 'КОЛИЧЕСТВО МЕСТ', 'warning', null]);
  assert.match(many.message, /по 2 товарам 12 мест, в шаблоне 10/);
});

test('R, S: вес груза и тары — «исправлю сам» из поручения', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, R: 28000, S: 3600 }, ROW2] }));
  assert.deepEqual(result.findings.map(brief), [['R10', 'ВЕС ГРУЗА', 'error', 'auto'], ['S10', 'ВЕС ТАРЫ', 'error', 'auto']]);
  assert.deepEqual(result.findings.map((f) => f.correction), ['28120', '3700']);
});

test('T: объём должен быть числом больше нуля', () => {
  assert.deepEqual(brief(only(check(buildTemplate({ rows: [{ ...ROW1, T: 0 }, ROW2] })), () => true)),
    ['T10', 'ОБЪЕМ', 'error', 'customer']);
});

test('U: ВГМ меньше суммы — «исправлю сам»; по поручению тоже меньше — «уточнить у заказчика» (G02)', () => {
  const less = only(check(buildTemplate({ rows: [{ ...ROW1, U: 31000 }, ROW2] })), () => true);
  assert.deepEqual(brief(less), ['U10', 'ВГМ', 'error', 'auto']);
  assert.equal(less.correction, '32260');
  const badOrder = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], total: 31000 }, ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, U: 30000 }, ROW2] }), orders(badOrder)), () => true);
  assert.deepEqual(brief(f), ['U10', 'ВГМ', 'error', 'customer']);
});

test('V: имя, которого нет в поручении — предупреждение (A03); NOTIFY «the same» и равный CONSIGNEE — верно', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, V: 'ANOTHER COMPANY' }, { ...ROW2, V: 'ANOTHER COMPANY' }] }));
  assert.deepEqual(result.findings.map(brief),
    [['V10', 'SHIPPER', 'warning', null], ['V11', 'SHIPPER', 'warning', null]]);
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, Z: 'VASILEK LLP' }, { ...ROW2, Z: 'VASILEK LLP' }] })).findings, []);
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, Z: 'same as consignee' }, { ...ROW2, Z: 'same as consignee' }] })).findings, []);
});

test('AB: у рефконтейнера температура «-» или пустая — предупреждение (A05)', () => {
  const reefer = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: '45R1' }, ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, F: '45R1' }, ROW2] }), orders(reefer)), () => true);
  assert.deepEqual(brief(f), ['AB10', 'ТЕМПЕРАТУРА', 'warning', null]);
  const empty = only(check(buildTemplate({ rows: [{ ...ROW1, F: '45R1', AB: null }, ROW2] }), orders(reefer)), () => true);
  assert.deepEqual(brief(empty), ['AB10', 'ТЕМПЕРАТУРА', 'warning', null]);
});

test('AC: опасный груз в поручении, а в колонке «NOT IMO» — ошибка; текст без опасного груза — предупреждение (A06)', () => {
  const dg = buildOrder({ containers: [
    { ...ORDER_CONTAINERS[0], goods: [{ name: 'Краска', places: 20, gross: 28120, cls: '3', un: '1263' }, { name: 'поддоны', places: 0, gross: 440 }] },
    ORDER_CONTAINERS[1],
  ] });
  const missing = only(check(buildTemplate(), orders(dg)), () => true);
  assert.deepEqual(brief(missing), ['AC10', 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', 'error', 'customer']);
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, AC: 'IMO 3 UN 1263' }, ROW2] }), orders(dg)).findings, []);
  // «NOT IMO», «NON DG», «-» — это «опасного груза нет», не находка.
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, AC: 'NON DG' }, { ...ROW2, AC: '-' }] })).findings, []);
  const extra = only(check(buildTemplate({ rows: [{ ...ROW1, AC: 'IMO 3' }, ROW2] })), () => true);
  assert.deepEqual(brief(extra), ['AC10', 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', 'warning', null]);
});

test('AF: SOC/LOC из поручения — «исправлю сам»', () => {
  const soc = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], owner: 'SOC' }, ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate(), orders(soc)), () => true);
  assert.deepEqual(brief(f), ['AF10', 'LOC_SOC', 'error', 'auto']);
  assert.equal(f.correction, 'SOC');
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, AF: 'SOC' }, ROW2] }), orders(soc)).findings, []);
});

test('контейнер поручения, которого нет в шаблоне — «уточнить у заказчика» без ячейки', () => {
  const f = only(check(buildTemplate({ rows: [ROW1] })), () => true);
  assert.deepEqual(brief(f), [null, 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer']);
  assert.equal(f.container, 'TEST7654321');
});

test('A07/G03: расхождение общих полей одного коносамента — ошибка «уточнить у заказчика» на каждом из 14 полей', () => {
  const cases = [
    ['C', 'ДАТА КОНОСАМЕНТА', '10.09.2026'],
    ['D', 'МЕСТО ИЗДАНИЯ', 'MOSCOW'],
    ['G', 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', 'Alexandria'],
    ['J', 'PRE-CARRIAGE BY', 'Rail'],
    ['K', 'PLACE OF RECEIPT', 'TVER'],
    ['L', 'PLACE OF DELIVERY', 'Alexandria'],
    ['M', 'УСЛОВИЯ ПОСТАВКИ', 'CY/DOOR'],
    ['N', 'TYPE OF MOVERMENT', 'FCL/LCL'],
    ['V', 'SHIPPER', 'ROMASHKA LLC, MOSCOW'], // известное поручению значение — не задеть A03
    ['W', 'SHIPPER_ADDRESS', 'ANOTHER CITY, RUSSIA'],
    ['X', 'CONSIGNEE', 'VASILEK LLP, ALMATY'], // так же — не задеть A03
    ['Y', 'CONSIGNEE_ADDRESS', 'ANOTHER CITY, KAZAKHSTAN'],
    ['Z', 'NOTIFY', 'VASILEK LLP, ALMATY'], // так же — не задеть A03
    ['AA', 'NOTIFY_ADDRESS', 'ANOTHER CITY'],
  ];
  for (const [letter, field, value] of cases) {
    const f = only(check(buildTemplate({ rows: [ROW1, { ...ROW2, [letter]: value }] })), () => true);
    assert.deepEqual(brief(f), [`${letter}11`, field, 'error', 'customer'], letter);
  }
});

test('A07/G03: коносамент из 3+ строк — красится только расходящаяся строка, не первая (эталон)', async () => {
  const order = buildOrder({ containers: ORDER_CONTAINERS_4.slice(0, 3) });
  const result = check(buildTemplate({
    rows: [ROW1, ROW2, { ...ROW1, E: 'TEST1111111', V: 'ROMASHKA LLC, MOSCOW' }],
  }), orders(order));
  const f = only(result, () => true);
  assert.deepEqual(brief(f), ['V12', 'SHIPPER', 'error', 'customer']);
  assert.equal(f.container, 'TEST1111111');
  assert.deepEqual(result.summary, { containers: 3, errors: 1, autoFixable: 0, needsCustomer: 1, warnings: 0 });
  assert.match(result.reportText, /УТОЧНИТЬ У ЗАКАЗЧИКА — 1/);
  assert.doesNotMatch(result.reportText, /ПРЕДУПРЕЖДЕНИЯ/);
  const marked = await roundTrip(result.markedWorkbook);
  const sheet = marked.getWorksheet('EXPORT_MANIFEST');
  const fillOf = (address) => sheet.getCell(address).fill?.fgColor?.argb ?? null;
  assert.equal(fillOf('V12'), 'FFFF9900');
  assert.equal(fillOf('V10'), null); // первая строка коносамента — эталон, не красится
});

test('A07/G03: коносамент из 4 строк, расхождение в строках 2 и 4 (3-я совпадает) — две находки, не одна', () => {
  const order = buildOrder({ containers: ORDER_CONTAINERS_4 });
  const result = check(buildTemplate({
    rows: [
      ROW1,
      { ...ROW2, X: 'VASILEK LLP, ALMATY' },
      { ...ROW1, E: 'TEST1111111' },
      { ...ROW2, E: 'TEST2222222', X: 'VASILEK LLP, ALMATY' },
    ],
  }), orders(order));
  const found = result.findings.filter((f) => f.field === 'CONSIGNEE');
  assert.deepEqual(found.map((f) => f.cell), ['X11', 'X13']);
  assert.ok(found.every((f) => f.level === 'error' && f.fix === 'customer'));
});

test('A07/G03: два разных коносамента в одном файле — сравнение только внутри своего, между ними не сверяется', () => {
  const order = buildOrder({ containers: ORDER_CONTAINERS_4 });
  const result = check(buildTemplate({
    rows: [
      ROW1, ROW2,
      { ...ROW1, A: 'BL0002', E: 'TEST1111111', G: 'Alexandria' },
      { ...ROW2, A: 'BL0002', E: 'TEST2222222', G: 'Alexandria' },
    ],
  }), orders(order));
  assert.deepEqual(result.findings, []);
});

test('A01: даты далеко от даты поручения и дата коносамента раньше прихода — предупреждения', () => {
  const result = check(buildTemplate({
    head: { F4: '05.09.2027', F5: '07.09.2027' },
    rows: [{ ...ROW1, C: '01.07.2026' }, { ...ROW2, A: 'BL0002', C: '05.09.2027' }],
  }));
  assert.deepEqual(result.findings.map(brief), [
    ['F4', 'ДАТА ПРИХОДА', 'warning', null], ['F5', 'ДАТА ВЫХОДА', 'warning', null],
    ['C10', 'ДАТА КОНОСАМЕНТА', 'warning', null], ['C10', 'ДАТА КОНОСАМЕНТА', 'warning', null],
    ['C11', 'ДАТА КОНОСАМЕНТА', 'warning', null],
  ]);
  assert.equal(result.findings[0].message, '05.09.2027 — на 363 дня позже даты поручения 07.09.2026, проверьте год');
  assert.equal(result.findings[1].message, '07.09.2027 — на 365 дней позже даты поручения 07.09.2026, проверьте год');
  assert.match(result.findings[2].message, /на 68 дней раньше даты поручения 07\.09\.2026/);
  assert.match(result.findings[3].message, /раньше даты прихода 05\.09\.2027/);
});

test('F4 позже F5 — ошибка «уточнить у заказчика» у обеих ячеек', () => {
  const result = check(buildTemplate({ head: { F4: '12.09.2026', F5: '11.09.2026' } }));
  assert.deepEqual(result.findings.filter((f) => f.level === 'error').map(brief),
    [['F4', 'ДАТА ПРИХОДА', 'error', 'customer'], ['F5', 'ДАТА ВЫХОДА', 'error', 'customer']]);
});

test('F2 СУДНО не то — «исправлю сам» из поручения', () => {
  const f = only(check(buildTemplate({ head: { F2: 'OTHER VESSEL' } })), () => true);
  assert.deepEqual(brief(f), ['F2', 'СУДНО', 'error', 'auto']);
  assert.equal(f.correction, 'TEST VESSEL');
});

test('F7 ТЕРМИНАЛ ВЫГРУЗКИ не связан с портом выгрузки поручения — «исправлю сам» из поручения', () => {
  const f = only(check(buildTemplate({ head: { F7: 'Совсем другой терминал' } })), () => true);
  assert.deepEqual(brief(f), ['F7', 'ТЕРМИНАЛ ВЫГРУЗКИ', 'error', 'auto']);
  assert.equal(f.correction, 'Port Said(EGPSD)');
});

// Реальный случай пользователя: в шапке — полное описательное название терминала,
// в поручении — город и код порта в скобках; сверяем не текст целиком, а название
// порта без скобочного кода, вхождением, поэтому находки быть не должно.
test('F7 ТЕРМИНАЛ ВЫГРУЗКИ — название порта без скобочного кода совпадает вхождением, находки нет', () => {
  const result = check(buildTemplate({ head: { F7: 'El Dekheila Alexandria Int. Container Terminal' } }),
    orders(buildOrder({ dischargePort: 'El Dekheila(EGEDK)' })));
  assert.deepEqual(result.findings, []);
});

test('F7 ТЕРМИНАЛ ВЫГРУЗКИ — у поручений разные порты выгрузки — «уточнить у заказчика»', () => {
  const first = buildOrder({ dischargePort: 'El Dekheila(EGEDK)', containers: [ORDER_CONTAINERS[0]] });
  const second = buildOrder({ number: ORDER2_NUMBER, dischargePort: 'Alexandria(EGALY)', containers: [ORDER_CONTAINERS[1]] });
  const result = check(buildTemplate({ head: { F7: 'Что-то ещё' }, rows: [ROW1, { ...ROW2, B: ORDER2_NUMBER }] }),
    orders(first, second));
  const f = only(result, (x) => x.field === 'ТЕРМИНАЛ ВЫГРУЗКИ');
  assert.equal(f.fix, 'customer');
  assert.match(f.message, /разные терминалы выгрузки/);
});

/* ——— три результата (spec §5.5, §7) ——— */

// Через запись и чтение: ExcelJS при чтении файла отдаёт ОДИН объект стиля
// многим ячейкам — только так проверяется, что заливка не задела соседей.
async function roundTrip(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(buffer);
  return loaded;
}

function noteText(cell) {
  const note = cell.note;
  if (!note) return '';
  if (typeof note === 'string') return note;
  if (Array.isArray(note.texts)) return note.texts.map((part) => part.text).join('');
  return String(note);
}

test('шаблон с пометками: ошибки жёлтые, предупреждения голубые, примечания у обоих, ярлыки жёлтые', async () => {
  const template = await roundTrip(buildTemplate({
    sheetName: 'Лист1', sheets: ['Лист2'], rows: [{ ...ROW1, R: 28000, P: 'PALLETS' }, { ...ROW2, P: 'PALLETS' }],
  }));
  const result = check(template);
  const marked = await roundTrip(result.markedWorkbook);
  const sheet = marked.getWorksheet('Лист1');
  const fillOf = (address) => sheet.getCell(address).fill?.fgColor?.argb ?? null;
  assert.equal(fillOf('R10'), 'FFFF9900');
  assert.equal(fillOf('R11'), null); // соседняя ячейка с тем же исходным стилем
  assert.equal(fillOf('P10'), 'FFADD8E6'); // предупреждение (A04 — код упаковки) — голубым
  assert.match(noteText(sheet.getCell('R10')), /28120/);
  assert.match(noteText(sheet.getCell('R10')), /→ 28120\. Может быть заменено автоматически\.$/);
  assert.ok(noteText(sheet.getCell('P10')));
  assert.equal(sheet.properties.tabColor?.argb, 'FFFF9900');
  assert.equal(marked.getWorksheet('Лист2').properties.tabColor?.argb, 'FFFF9900');
  // Остальное содержимое и оформление не тронуты.
  assert.equal(sheet.getCell('A10').value, ROW1.A);
  assert.equal(sheet.getCell('H4').value, HEAD.H4);
  assert.equal(sheet.getCell('S10').value, 3700);
});

test('шаблон с пометками: несколько находок на одной ячейке — одно примечание строками', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, E: 'TEST0000009' }, { ...ROW2, E: 'TEST0000009' }] }));
  const note = noteText(result.markedWorkbook.getWorksheet('EXPORT_MANIFEST').getCell('E10'));
  assert.equal(note.split('\n').length, 2, note);
});

test('исправленный шаблон: эталонная форма, исправления внесены, ячейки заказчика — как были', async () => {
  const result = check(buildTemplate({
    sheetName: 'Лист1', sheets: ['Лист2'], headerRow: 10, headers: { R: 'Веc груза' }, extra: ['ПРИМЕЧАНИЕ'],
    columns: LETTERS.filter((letter) => letter !== 'AF'), reference: false, // недостающие колонка и лист должны появиться
    rows: [{ ...ROW1, Q: '20', C: new Date(Date.UTC(2026, 8, 9)), R: '28 000', extra: ['срочно'] }, null,
      { ...ROW2, H: 'детали', P: 'PALLETS' }, { Q: 32, R: 34120 }],
  }));
  // У второй строки данных — своя ошибка (H кириллицей, «уточнить у заказчика») и
  // своё предупреждение (P не похож на код упаковки); в исходнике (headerRow: 10,
  // а перед этой строкой ещё пустая) её адрес — строка 13, а в исправленном
  // шаблоне пустая строка убрана — та же строка данных должна оказаться на 11-й
  // и там же покраситься, не на исходном адресе.
  assert.ok(result.findings.some((f) => f.cell === 'H13' && f.fix === 'customer'));
  assert.ok(result.findings.some((f) => f.cell === 'P13' && f.level === 'warning'));
  const corrected = await roundTrip(result.correctedWorkbook);
  assert.deepEqual(corrected.worksheets.map((s) => s.name), ['EXPORT_MANIFEST', 'Reference']);
  const sheet = corrected.getWorksheet('EXPORT_MANIFEST');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((r) => sheet.getCell(`E${r}`).value),
    ['ЛИНИЯ', 'СУДНО', 'РЕЙС', 'ДАТА ПРИХОДА', 'ДАТА ВЫХОДА', 'ТЕРМИНАЛ ПОГРУЗКИ', 'ТЕРМИНАЛ ВЫГРУЗКИ']);
  assert.equal(sheet.getCell('F1').value, 'TEST LINE');
  assert.equal(sheet.getCell('F2').value, 'TEST VESSEL');
  assert.equal(sheet.getCell('F6').value, 'Timber Port');
  assert.deepEqual(['H3', 'H4', 'H6'].map((a) => sheet.getCell(a).value), [HEAD.H3, HEAD.H4, HEAD.H6]);
  assert.deepEqual(LETTERS.map((l) => sheet.getCell(`${l}9`).value), LETTERS.map((l) => STANDARD_HEADERS[l]));
  // Оформление формы: обязательные графы жёлтые (F1 ЛИНИЯ, D, AF — нет), заголовки зелёные.
  const fill = (a) => sheet.getCell(a).fill?.fgColor?.argb ?? null;
  assert.deepEqual(['F1', 'F2', 'F4', 'F7', 'A9', 'A10', 'D10', 'AF10'].map(fill),
    [null, 'FFFFFF00', null, 'FFFFFF00', 'FF92D050', 'FFFFFF00', null, null]);
  assert.equal(sheet.getCell('AG9').value, null); // лишняя колонка убрана
  assert.equal(sheet.getCell('R10').value, 28120); // «исправлю сам»: число из поручения
  assert.equal(sheet.getCell('Q10').value, '20'); // места — ровно как у заказчика, текстом
  assert.deepEqual(sheet.getCell('C10').value, new Date(Date.UTC(2026, 8, 9))); // дата Excel сохранена
  assert.equal(sheet.getCell('A10').value, ROW1.A); // NBSP сохранён
  assert.equal(sheet.getCell('E11').value, 'TEST7654321'); // пустая строка убрана, строка сдвинулась
  assert.equal(sheet.getCell('E12').value, null); // строка «итого» убрана
  assert.equal(sheet.getColumn('H').width, 20.55);
  assert.equal(sheet.getRow(1).height, 22.8);
  assert.equal(sheet.getRow(9).height, 30.6);
  assert.equal(sheet.getRow(10).height, 30);
  // Оставшаяся ошибка и предупреждение видны и здесь — на НОВОМ (сдвинутом) адресе,
  // не на исходном H13/P13, которого в исправленном шаблоне уже нет.
  assert.equal(sheet.getCell('H11').fill?.fgColor?.argb, 'FFFF9900');
  assert.ok(noteText(sheet.getCell('H11')));
  assert.equal(sheet.getCell('P11').fill?.fgColor?.argb, 'FFADD8E6');
  assert.ok(noteText(sheet.getCell('P11')));
  assert.equal(sheet.getCell('H13').fill?.fgColor?.argb ?? null, null); // старого адреса нет вовсе
});

test('исправленный шаблон: формула заменена значением, объединение — значением в каждой ячейке', async () => {
  const result = check(buildTemplate({
    rows: [ROW1, { ...ROW2, R: { formula: 'SUM(3000,3000)', result: 6000 } }], merges: ['A10:A11'],
  }));
  const sheet = (await roundTrip(result.correctedWorkbook)).getWorksheet('EXPORT_MANIFEST');
  assert.equal(sheet.getCell('R11').value, 6000);
  assert.equal(sheet.getCell('A10').value, ROW1.A);
  assert.equal(sheet.getCell('A11').value, ROW1.A);
  assert.deepEqual(sheet.model.merges ?? [], []);
});

test('R16i: исправленный шаблон проходит повторную проверку, остальные находки — те же', async () => {
  const variants = [
    { sheetName: 'Лист1', rows: [{ ...ROW1, R: 28000, Q: '20' }, ROW2] },
    { headerRow: 10, headers: { R: 'Веc груза' }, rows: [{ ...ROW1, F: '40DV', O: 999, U: 31000 }, null, ROW2] },
    { rows: [{ ...ROW1, M: 'cy/cy', O: 'Р123456', E: 'TEST 1234567' }, ROW2], reference: false },
    { head: { F2: 'OTHER VESSEL', F3: null }, rows: [{ ...ROW1, E: 'test 1234567', B: 'X-1' }, { ...ROW2, C: new Date(Date.UTC(2026, 8, 9)) }] },
    { merges: ['A10:A11'], extra: ['ПРИМЕЧАНИЕ'], rows: [{ ...ROW1, R: '28 120' }, { ...ROW2, S: 2000 }] },
  ];
  const keep = (result) => result.findings.filter((f) => f.fix !== 'auto')
    .map((f) => `${f.level}|${f.fix}|${f.field}|${f.container}`).sort();
  for (const variant of variants) {
    const first = check(buildTemplate(variant));
    assert.ok(first.summary.autoFixable > 0, JSON.stringify(variant));
    const again = check(await roundTrip(first.correctedWorkbook));
    assert.deepEqual(again.findings.filter((f) => f.fix === 'auto'), [], JSON.stringify(variant));
    assert.deepEqual(keep(again), keep(first), JSON.stringify(variant));
  }
});

test('отчёт: шапка, итог и разделы «уточнить / исправлено» по §7', () => {
  const result = check(buildTemplate({ sheetName: 'Лист1', rows: [{ ...ROW1, R: 28000, Q: 18 }, ROW2] }));
  assert.equal(result.reportText, [
    'ПРОВЕРКА ШАБЛОНА ЭЛ. ПОРУЧЕНИЯ',
    'Проверено: 12.09.2026 23:40',
    'Шаблон: шаблон.xlsx (лист «Лист1», 2 контейнера)',
    'Поручение: order1.xlsx — № 7700000000-P26-00001 от 07.09.2026, 2 контейнера',
    'Судно / рейс: TEST VESSEL / 0001E',
    '',
    'ИТОГ: ошибок — 3 (может быть заменено автоматически — 2, уточнить у заказчика — 1), предупреждений — 0.',
    '',
    'УТОЧНИТЬ У ЗАКАЗЧИКА — 1',
    '1. Q10, КОЛИЧЕСТВО МЕСТ, контейнер TEST1234567: в шаблоне 18, по поручению 20.',
    '',
    'МОЖЕТ БЫТЬ ЗАМЕНЕНО АВТОМАТИЧЕСКИ — 2 (уже внесено в «шаблон (исправлен).xlsx»)',
    '1. Лист «Лист1» → переименован в «EXPORT_MANIFEST».',
    '2. R10, ВЕС ГРУЗА, контейнер TEST1234567: в шаблоне 28000, по поручению 28120 → 28120.',
    '',
  ].join('\r\n'));
});

test('отчёт: без находок — строка «Ошибок и предупреждений нет», разделов нет, CRLF без BOM', () => {
  const result = check(buildTemplate());
  assert.match(result.reportText, /Ошибок и предупреждений нет — шаблон соответствует форме и поручению\./);
  assert.doesNotMatch(result.reportText, /УТОЧНИТЬ У ЗАКАЗЧИКА|МОЖЕТ БЫТЬ ЗАМЕНЕНО АВТОМАТИЧЕСКИ|ПРЕДУПРЕЖДЕНИЯ/);
  assert.equal(/[^\r]\n/.test(result.reportText), false);
  assert.notEqual(result.reportText.charCodeAt(0), 0xFEFF);
});

test('отчёт: предупреждение «вверху» — первым в разделе предупреждений; имена файлов — от имени шаблона', () => {
  const result = checkTemplate(
    buildTemplate({ rows: [ROW1, { ...ROW2, E: 'TEST0000009', B: 'OTHER-1' }] }),
    orders(buildOrder()),
    { ...OPTIONS, templateFileName: 'НОВЫЙ шаблон эл_поручения export.xlsx' },
  );
  const lines = result.reportText.split('\r\n');
  const start = lines.findIndex((line) => line.startsWith('ПРЕДУПРЕЖДЕНИЯ'));
  assert.equal(lines[start], 'ПРЕДУПРЕЖДЕНИЯ — ПРОВЕРЬТЕ САМИ — 1');
  assert.equal(lines[start + 1], '1. Поручение OTHER-1 не загружено — 1 строка шаблона не сверена с поручением.');
  assert.deepEqual(result.fileNames, {
    marked: 'НОВЫЙ шаблон эл_поручения export (пометки).xlsx',
    corrected: 'НОВЫЙ шаблон эл_поручения export (исправлен).xlsx',
    report: 'НОВЫЙ шаблон эл_поручения export (отчёт).txt',
  });
});
