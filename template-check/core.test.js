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
  A: 'НОМЕР КОНОСАМЕНТА', B: 'НОМЕР ПОРУЧЕНИЯ', C: 'ДАТА КОНОСАМЕНТА', D: 'НОМЕР КОНТЕЙНЕРА', E: 'ISO КОД',
  F: 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', G: 'НАИМЕНОВАНИЕ ГРУЗА АНГЛ.', H: 'НАИМЕНОВАНИЕ ГРУЗА РУС.', I: 'НОМЕРА ПЛОМБ',
  J: 'ТИП УПАКОВКИ', K: 'КОЛИЧЕСТВО МЕСТ', L: 'ВЕС ГРУЗА', M: 'ВЕС ТАРЫ', N: 'ОБЪЕМ', O: 'ВГМ', P: 'SHIPPER',
  Q: 'SHIPPER_ADDRESS', R: 'CONSIGNEE', S: 'CONSIGNEE_ADDRESS', T: 'NOTIFY', U: 'NOTIFY_ADDRESS', V: 'ТЕМПЕРАТУРА',
  W: 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', X: 'ПОРОЖНИЙ', Y: 'ИНН ЭКСПЕДИТОРА', Z: 'LOC_SOC',
};
const LETTERS = Object.keys(STANDARD_HEADERS);
const HEAD = {
  D1: 'СУДНО', E1: 'TEST VESSEL', D2: 'РЕЙС', E2: '0001E', D3: 'ДАТА ПРИХОДА', E3: '09.09.2026',
  D4: 'ДАТА ВЫХОДА', E4: '11.09.2026', D5: 'ТЕРМИНАЛ ПОГРУЗКИ', E5: 'Timber Port',
  D6: 'ТЕРМИНАЛ ВЫГРУЗКИ', E6: 'Port Said Terminal', // содержит «Port Said» — как в order.dischargePort (L7)
  G3: 'Таблицу заполнять строго в соответствии с п/поручением и ДТ!',
};
// Номер коносамента с неразрывным пробелом в конце — так он записан в образце 1.
// ВГМ = вес груза + вес тары (без поддонов), как у трёх контейнеров образца 1.
const ROW1 = {
  A: 'BL0001 ', B: ORDER_NUMBER, C: '09.09.2026', D: 'TEST1234567', E: '40HC', F: 'Port Said',
  G: 'PAPER', H: 'Бумага', I: 123456, J: 'PX', K: 20, L: 28120, M: 3700, N: 30, O: 31820,
  P: 'ROMASHKA LLC', Q: 'MOSCOW, RUSSIA', R: 'VASILEK LLP', S: 'ALMATY, KAZAKHSTAN', T: 'the same', U: 'the same',
};
const ROW2 = {
  ...ROW1, D: 'TEST7654321', E: '22G1', G: 'SPARE PARTS', H: 'запчасти', I: 'AB0012', K: 12, L: 6000, M: 2200, N: 20, O: 8200,
};

// rows: объект на строку (ключи — буквы эталонных колонок, extra — значения
// лишних колонок), null — пустая строка. columns — какие эталонные колонки и в
// каком порядке стоят на листе, headers — заголовки вместо эталонных.
function buildTemplate({ sheetName = 'EXPORT_MANIFEST', head = {}, headerRow = 8, rows = [ROW1, ROW2],
  columns = LETTERS, headers = {}, extra = [], sheets = [], merges = [] } = {}) {
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
  const misplaced = check(buildTemplate({ head: { D3: null, E3: null, B3: 'ДАТА ПРИХОДА', C3: '09.09.2026' } }));
  assert.deepEqual(pick(only(misplaced, () => true)), formError('auto', 'B3', 'ДАТА ПРИХОДА'));
  const inexact = check(buildTemplate({ head: { D5: 'Терминал погрузки:' } }));
  assert.deepEqual(pick(only(inexact, () => true)), formError('auto', 'D5', 'ТЕРМИНАЛ ПОГРУЗКИ'));
});

test('форма: строки шапки нет — СУДНО и ТЕРМИНАЛ ВЫГРУЗКИ «исправлю сам» из поручения, дата «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ head: { D1: null, E1: null, D3: null, E3: null, D6: null, E6: null } }));
  assert.deepEqual(brief(only(result, (f) => f.field === 'СУДНО')), [null, 'СУДНО', 'error', 'auto']);
  assert.deepEqual(brief(only(result, (f) => f.field === 'ДАТА ПРИХОДА')), [null, 'ДАТА ПРИХОДА', 'error', 'customer']);
  const terminal = only(result, (f) => f.field === 'ТЕРМИНАЛ ВЫГРУЗКИ');
  assert.deepEqual(brief(terminal), [null, 'ТЕРМИНАЛ ВЫГРУЗКИ', 'error', 'auto']);
  assert.match(terminal.correction, /Port Said\(EGPSD\)/);
});

test('шапка: пустое значение — РЕЙС «исправлю сам», ТЕРМИНАЛ ПОГРУЗКИ «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ head: { E2: null, E5: null } }));
  assert.deepEqual(brief(only(result, (f) => f.field === 'РЕЙС')), ['E2', 'РЕЙС', 'error', 'auto']);
  assert.deepEqual(brief(only(result, (f) => f.field === 'ТЕРМИНАЛ ПОГРУЗКИ')), ['E5', 'ТЕРМИНАЛ ПОГРУЗКИ', 'error', 'customer']);
});

test('форма: строка заголовков не 8-я — «исправлю сам», ячейка — самая левая узнанная', () => {
  const result = check(buildTemplate({ headerRow: 9 }));
  assert.deepEqual(pick(only(result, () => true)), formError('auto', 'A9', 'Строка заголовков'));
});

test('форма: заголовок записан неточно — «исправлю сам», ячейка заголовка', () => {
  const result = check(buildTemplate({ headers: { L: 'Веc груза' } }));
  const f = only(result, () => true);
  assert.deepEqual(pick(f), formError('auto', 'L8', 'ВЕС ГРУЗА'));
  assert.match(f.message, /Веc груза/);
});

test('форма: колонка не на своём месте — «исправлю сам» у каждого заголовка, значения читаются по заголовку', () => {
  const columns = [...LETTERS];
  [columns[3], columns[4]] = [columns[4], columns[3]];
  const result = check(buildTemplate({ columns }));
  assert.deepEqual(result.findings.map(pick), [formError('auto', 'D8', 'ISO КОД'), formError('auto', 'E8', 'НОМЕР КОНТЕЙНЕРА')]);
});

test('форма: нет колонки — «исправлю сам»; у обязательной пустые значения — отдельные находки', () => {
  const noZ = check(buildTemplate({ columns: LETTERS.filter((l) => l !== 'Z') }));
  assert.deepEqual(noZ.findings.map(pick), [formError('auto', null, 'LOC_SOC')]);
  const noK = check(buildTemplate({ columns: LETTERS.filter((l) => l !== 'K') }));
  assert.deepEqual(pick(only(noK, (f) => f.field === 'КОЛИЧЕСТВО МЕСТ' && f.container === null)), formError('auto', null, 'КОЛИЧЕСТВО МЕСТ'));
  const values = noK.findings.filter((f) => f.field === 'КОЛИЧЕСТВО МЕСТ' && f.container !== null);
  assert.deepEqual(values.map((f) => [f.cell, f.level, f.fix, f.container]),
    [[null, 'error', 'customer', 'TEST1234567'], [null, 'error', 'customer', 'TEST7654321']]);
});

test('форма: один заголовок в двух колонках — «уточнить у заказчика» у обеих ячеек', () => {
  const result = check(buildTemplate({ extra: ['ВЕС ГРУЗА'] }));
  assert.deepEqual(result.findings.map(pick), [formError('customer', 'L8', 'ВЕС ГРУЗА'), formError('customer', 'AA8', 'ВЕС ГРУЗА')]);
});

test('форма: лишняя колонка — «исправлю сам»; если под ней данные — сказано, что они не попадут', () => {
  const empty = only(check(buildTemplate({ extra: ['ПРИМЕЧАНИЕ'] })), () => true);
  assert.deepEqual(pick(empty), formError('auto', 'AA8', 'ПРИМЕЧАНИЕ'));
  assert.doesNotMatch(empty.message, /не попадут/);
  const filled = only(check(buildTemplate({ extra: ['ПРИМЕЧАНИЕ'], rows: [{ ...ROW1, extra: ['срочно'] }, ROW2] })), () => true);
  assert.match(filled.message, /данные этой колонки в исправленный шаблон не попадут/);
});

test('форма: пустая строка внутри таблицы — «исправлю сам», ячейка A этой строки', () => {
  const result = check(buildTemplate({ rows: [ROW1, null, ROW2] }));
  assert.deepEqual(pick(only(result, () => true)), formError('auto', 'A10', 'Строка'));
});

test('форма: строка «итого» — «исправлю сам», ячейка — первая непустая', () => {
  const total = { K: 32, L: 34120, M: 5900, N: 50, O: 40020 };
  const result = check(buildTemplate({ rows: [ROW1, ROW2, total] }));
  assert.deepEqual(pick(only(result, () => true)), formError('auto', 'K11', 'Строка'));
});

test('форма: строка без контейнера, но с данными — «уточнить у заказчика», ячейка D', () => {
  const result = check(buildTemplate({ rows: [ROW1, ROW2, { A: 'BL0001', H: 'ещё груз' }] }));
  assert.deepEqual(pick(only(result, () => true)), formError('customer', 'D11', 'НОМЕР КОНТЕЙНЕРА'));
});

test('форма: строка без контейнера с меткой «Итого» вне K–O и числами в K–O — «уточнить у заказчика», не auto-удаление', () => {
  // Метка вне K–O — это уже не «заполнены только K–O» (spec §4.4 дословно):
  // строка не считается итоговой и не удаляется молча в исправленном шаблоне.
  const result = check(buildTemplate({ rows: [ROW1, ROW2, { A: 'Итого', K: 32, L: 34120, M: 5900, N: 50, O: 40020 }] }));
  assert.deepEqual(pick(only(result, () => true)), formError('customer', 'D11', 'НОМЕР КОНТЕЙНЕРА'));
});

test('форма: ни одной строки с контейнером — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ rows: [] }));
  assert.deepEqual(pick(only(result, (f) => f.section === 'form')), formError('customer', null, 'НОМЕР КОНТЕЙНЕРА'));
});

test('форма: объединённые ячейки — «исправлю сам», ячейка — главная, в тексте — диапазон', () => {
  const result = check(buildTemplate({ merges: ['A9:A10'] }));
  const f = only(result, () => true);
  assert.deepEqual(pick(f), formError('auto', 'A9', 'НОМЕР КОНОСАМЕНТА'));
  assert.match(f.message, /A9:A10/);
});

test('форма: L/M/O текстом — «исправлю сам»; K/N текстом — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, K: '20', L: '28 120', N: '30', O: '31820,0' }, ROW2] }));
  assert.deepEqual(result.findings.map(brief), [
    ['K9', 'КОЛИЧЕСТВО МЕСТ', 'error', 'customer'], ['L9', 'ВЕС ГРУЗА', 'error', 'auto'],
    ['N9', 'ОБЪЕМ', 'error', 'customer'], ['O9', 'ВГМ', 'error', 'auto'],
  ]);
  assert.match(result.findings[0].message, /текстом/);
  assert.match(result.findings[0].message, /исправьте вручную или уточните у заказчика/);
  assert.match(result.findings[1].message, /текстом/);
});

test('форма: дата датой Excel, в другом виде или не дата — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({
    head: { E3: new Date(Date.UTC(2026, 8, 9)), E4: '11.9.2026' },
    rows: [{ ...ROW1, C: '2026-09-09' }, { ...ROW2, A: 'BL0002', C: 'скоро' }],
  }));
  assert.deepEqual(result.findings.map(brief), [
    ['E3', 'ДАТА ПРИХОДА', 'error', 'customer'], ['E4', 'ДАТА ВЫХОДА', 'error', 'customer'],
    ['C9', 'ДАТА КОНОСАМЕНТА', 'error', 'customer'], ['C10', 'ДАТА КОНОСАМЕНТА', 'error', 'customer'],
  ]);
  assert.match(result.findings[0].message, /ДД\.ММ\.ГГГГ/);
});

/* ——— §5: сверка строк с поручением ——— */

const ORDER2_NUMBER = '7700000000-P26-00002';

test('B: контейнер из другого загруженного поручения — «исправлю сам», номер из того поручения', () => {
  const first = buildOrder({ containers: [ORDER_CONTAINERS[0]] });
  const second = buildOrder({ number: ORDER2_NUMBER, containers: [ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate(), orders(first, second)), () => true);
  assert.deepEqual(brief(f), ['B10', 'НОМЕР ПОРУЧЕНИЯ', 'error', 'auto']);
  assert.equal(f.correction, ORDER2_NUMBER);
  assert.equal(f.container, 'TEST7654321');
});

test('B: контейнер в двух поручениях, а в B ни одно из них — «уточнить у заказчика»', () => {
  const first = buildOrder({ containers: [ORDER_CONTAINERS[0]] });
  const second = buildOrder({ number: ORDER2_NUMBER, containers: [ORDER_CONTAINERS[0]] });
  const result = check(buildTemplate({ rows: [{ ...ROW1, B: '7700000000-P26-00009' }] }), orders(first, second));
  assert.deepEqual(brief(only(result, () => true)), ['B9', 'НОМЕР ПОРУЧЕНИЯ', 'error', 'customer']);
});

test('B с незагруженным поручением — предупреждение вверху, строка не сверена', () => {
  const result = check(buildTemplate({ rows: [ROW1, { ...ROW2, D: 'TEST0000009', B: 'OTHER-1' }] }));
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
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, D: 'test 1234-567' }, ROW2] })), () => true);
  assert.deepEqual(brief(f), ['D9', 'НОМЕР КОНТЕЙНЕРА', 'error', 'auto']);
  assert.equal(f.correction, 'TEST1234567');
  const repeated = check(buildTemplate({ rows: [ROW1, { ...ROW2, D: 'TEST1234567' }] }));
  assert.deepEqual(repeated.findings.filter((x) => x.field === 'НОМЕР КОНТЕЙНЕРА' && x.cell).map(brief),
    [['D9', 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer'], ['D10', 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer']]);
});

test('D: контейнера нет ни в одном поручении — «уточнить у заказчика»', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, D: 'TEST0000009' }, ROW2] }));
  assert.deepEqual(brief(only(result, (f) => f.cell === 'D9')), ['D9', 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer']);
});

test('E: ISO — 2200 ≡ 22G1, 4532 ≡ 40RH, 40DV ≢ 45G1, неразобранные коды сравниваются строками', () => {
  const wrong = only(check(buildTemplate({ rows: [{ ...ROW1, E: '40DV' }, ROW2] })), () => true);
  assert.deepEqual(brief(wrong), ['E9', 'ISO КОД', 'error', 'auto']);
  assert.equal(wrong.correction, '45G1');
  const old = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: '2200' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, E: '22G1' }, ROW2] }), orders(old)).findings, []);
  const reefer = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: '40RH' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, E: '4532', V: '-18' }, ROW2] }), orders(reefer)).findings, []);
  const odd = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: 'XYZ1' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, E: 'xyz1' }, ROW2] }), orders(odd)).findings, []);
  assert.equal(only(check(buildTemplate({ rows: [{ ...ROW1, E: 'XYZ2' }, ROW2] }), orders(odd)), () => true).cell, 'E9');
});

test('I: пломбы — набор в любом порядке; расхождение «исправлю сам»; в поручении пломбы нет — «уточнить у заказчика»', () => {
  const multi = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], seal: 'AB0012, CD0034' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, I: 'CD0034; ab0012' }, ROW2] }), orders(multi)).findings, []);
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, I: 999 }, ROW2] })), () => true);
  assert.deepEqual(brief(f), ['I9', 'НОМЕРА ПЛОМБ', 'error', 'auto']);
  assert.equal(f.correction, '123456');
  const noSeal = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], seal: '' }, ORDER_CONTAINERS[1]] });
  assert.deepEqual(brief(only(check(buildTemplate(), orders(noSeal)), () => true)), ['I9', 'НОМЕРА ПЛОМБ', 'error', 'customer']);
});

test('обязательные текстовые поля пустые — «уточнить у заказчика»; G кириллицей — тоже', () => {
  const row = { ...ROW1, A: null, F: null, G: 'БУМАГА', H: null, J: null, P: null, Q: null, R: null, S: null, T: null, U: null };
  const result = check(buildTemplate({ rows: [row, ROW2] }));
  assert.deepEqual(result.findings.map(brief),
    ['A9', 'F9', 'G9', 'H9', 'J9', 'P9', 'Q9', 'R9', 'S9', 'T9', 'U9'].map((cell) => [cell, STANDARD_HEADERS[cell[0]], 'error', 'customer']));
});

test('J: код упаковки не из двух знаков — предупреждение (A04)', () => {
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, J: 'PALLETS' }, { ...ROW2, J: 'PALLETS' }] })), (x) => x.cell === 'J9');
  assert.deepEqual(brief(f), ['J9', 'ТИП УПАКОВКИ', 'warning', null]);
});

test('K: мест не столько — у одного товара ошибка «уточнить у заказчика», у нескольких предупреждение (G01)', () => {
  const single = only(check(buildTemplate({ rows: [{ ...ROW1, K: 18 }, ROW2] })), () => true);
  assert.deepEqual(brief(single), ['K9', 'КОЛИЧЕСТВО МЕСТ', 'error', 'customer']);
  assert.match(single.message, /в шаблоне 18, по поручению 20/);
  const many = only(check(buildTemplate({ rows: [ROW1, { ...ROW2, K: 10 }] })), () => true);
  assert.deepEqual(brief(many), ['K10', 'КОЛИЧЕСТВО МЕСТ', 'warning', null]);
  assert.match(many.message, /по 2 товарам 12 мест, в шаблоне 10/);
});

test('L, M: вес груза и тары — «исправлю сам» из поручения', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, L: 28000, M: 3600 }, ROW2] }));
  assert.deepEqual(result.findings.map(brief), [['L9', 'ВЕС ГРУЗА', 'error', 'auto'], ['M9', 'ВЕС ТАРЫ', 'error', 'auto']]);
  assert.deepEqual(result.findings.map((f) => f.correction), ['28120', '3700']);
});

test('N: объём должен быть числом больше нуля', () => {
  assert.deepEqual(brief(only(check(buildTemplate({ rows: [{ ...ROW1, N: 0 }, ROW2] })), () => true)),
    ['N9', 'ОБЪЕМ', 'error', 'customer']);
});

test('O: ВГМ меньше суммы — «исправлю сам»; по поручению тоже меньше — «уточнить у заказчика» (G02)', () => {
  const less = only(check(buildTemplate({ rows: [{ ...ROW1, O: 31000 }, ROW2] })), () => true);
  assert.deepEqual(brief(less), ['O9', 'ВГМ', 'error', 'auto']);
  assert.equal(less.correction, '32260');
  const badOrder = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], total: 31000 }, ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, O: 30000 }, ROW2] }), orders(badOrder)), () => true);
  assert.deepEqual(brief(f), ['O9', 'ВГМ', 'error', 'customer']);
});

test('P: имя, которого нет в поручении — предупреждение (A03); NOTIFY «the same» и равный CONSIGNEE — верно', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, P: 'ANOTHER COMPANY' }, { ...ROW2, P: 'ANOTHER COMPANY' }] }));
  assert.deepEqual(result.findings.map(brief),
    [['P9', 'SHIPPER', 'warning', null], ['P10', 'SHIPPER', 'warning', null]]);
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, T: 'VASILEK LLP' }, { ...ROW2, T: 'VASILEK LLP' }] })).findings, []);
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, T: 'same as consignee' }, { ...ROW2, T: 'same as consignee' }] })).findings, []);
});

test('V: у рефконтейнера нет температуры — предупреждение (A05)', () => {
  const reefer = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], iso: '45R1' }, ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate({ rows: [{ ...ROW1, E: '45R1' }, ROW2] }), orders(reefer)), () => true);
  assert.deepEqual(brief(f), ['V9', 'ТЕМПЕРАТУРА', 'warning', null]);
});

test('W: опасный груз в поручении — колонка обязательна; текст без опасного груза — предупреждение (A06)', () => {
  const dg = buildOrder({ containers: [
    { ...ORDER_CONTAINERS[0], goods: [{ name: 'Краска', places: 20, gross: 28120, cls: '3', un: '1263' }, { name: 'поддоны', places: 0, gross: 440 }] },
    ORDER_CONTAINERS[1],
  ] });
  const missing = only(check(buildTemplate(), orders(dg)), () => true);
  assert.deepEqual(brief(missing), ['W9', 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', 'error', 'customer']);
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, W: 'IMO 3 UN 1263' }, ROW2] }), orders(dg)).findings, []);
  const extra = only(check(buildTemplate({ rows: [{ ...ROW1, W: 'NON DG' }, ROW2] })), () => true);
  assert.deepEqual(brief(extra), ['W9', 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', 'warning', null]);
});

test('Z: SOC/LOC из поручения — «исправлю сам»', () => {
  const soc = buildOrder({ containers: [{ ...ORDER_CONTAINERS[0], owner: 'SOC' }, ORDER_CONTAINERS[1]] });
  const f = only(check(buildTemplate(), orders(soc)), () => true);
  assert.deepEqual(brief(f), ['Z9', 'LOC_SOC', 'error', 'auto']);
  assert.equal(f.correction, 'SOC');
  assert.deepEqual(check(buildTemplate({ rows: [{ ...ROW1, Z: 'SOC' }, ROW2] }), orders(soc)).findings, []);
});

test('контейнер поручения, которого нет в шаблоне — «уточнить у заказчика» без ячейки', () => {
  const f = only(check(buildTemplate({ rows: [ROW1] })), () => true);
  assert.deepEqual(brief(f), [null, 'НОМЕР КОНТЕЙНЕРА', 'error', 'customer']);
  assert.equal(f.container, 'TEST7654321');
});

test('A07/G03: расхождение общих полей одного коносамента — ошибка «уточнить у заказчика» на каждом из восьми полей', () => {
  const cases = [
    ['C', 'ДАТА КОНОСАМЕНТА', '10.09.2026'],
    ['F', 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', 'Alexandria'],
    ['P', 'SHIPPER', 'ROMASHKA LLC, MOSCOW'], // известное поручению значение — не задеть A03
    ['Q', 'SHIPPER_ADDRESS', 'ANOTHER CITY, RUSSIA'],
    ['R', 'CONSIGNEE', 'VASILEK LLP, ALMATY'], // так же — не задеть A03
    ['S', 'CONSIGNEE_ADDRESS', 'ANOTHER CITY, KAZAKHSTAN'],
    ['T', 'NOTIFY', 'VASILEK LLP, ALMATY'], // так же — не задеть A03
    ['U', 'NOTIFY_ADDRESS', 'ANOTHER CITY'],
  ];
  for (const [letter, field, value] of cases) {
    const f = only(check(buildTemplate({ rows: [ROW1, { ...ROW2, [letter]: value }] })), () => true);
    assert.deepEqual(brief(f), [`${letter}10`, field, 'error', 'customer'], letter);
  }
});

test('A07/G03: коносамент из 3+ строк — красится только расходящаяся строка, не первая (эталон)', async () => {
  const order = buildOrder({ containers: ORDER_CONTAINERS_4.slice(0, 3) });
  const result = check(buildTemplate({
    rows: [ROW1, ROW2, { ...ROW1, D: 'TEST1111111', P: 'ROMASHKA LLC, MOSCOW' }],
  }), orders(order));
  const f = only(result, () => true);
  assert.deepEqual(brief(f), ['P11', 'SHIPPER', 'error', 'customer']);
  assert.equal(f.container, 'TEST1111111');
  assert.deepEqual(result.summary, { containers: 3, errors: 1, autoFixable: 0, needsCustomer: 1, warnings: 0 });
  assert.match(result.reportText, /УТОЧНИТЬ У ЗАКАЗЧИКА — 1/);
  assert.doesNotMatch(result.reportText, /ПРЕДУПРЕЖДЕНИЯ/);
  const marked = await roundTrip(result.markedWorkbook);
  const sheet = marked.getWorksheet('EXPORT_MANIFEST');
  const fillOf = (address) => sheet.getCell(address).fill?.fgColor?.argb ?? null;
  assert.equal(fillOf('P11'), 'FFFFFF00');
  assert.equal(fillOf('P9'), null); // первая строка коносамента — эталон, не красится
});

test('A07/G03: коносамент из 4 строк, расхождение в строках 2 и 4 (3-я совпадает) — две находки, не одна', () => {
  const order = buildOrder({ containers: ORDER_CONTAINERS_4 });
  const result = check(buildTemplate({
    rows: [
      ROW1,
      { ...ROW2, R: 'VASILEK LLP, ALMATY' },
      { ...ROW1, D: 'TEST1111111' },
      { ...ROW2, D: 'TEST2222222', R: 'VASILEK LLP, ALMATY' },
    ],
  }), orders(order));
  const found = result.findings.filter((f) => f.field === 'CONSIGNEE');
  assert.deepEqual(found.map((f) => f.cell), ['R10', 'R12']);
  assert.ok(found.every((f) => f.level === 'error' && f.fix === 'customer'));
});

test('A07/G03: два разных коносамента в одном файле — сравнение только внутри своего, между ними не сверяется', () => {
  const order = buildOrder({ containers: ORDER_CONTAINERS_4 });
  const result = check(buildTemplate({
    rows: [
      ROW1, ROW2,
      { ...ROW1, A: 'BL0002', D: 'TEST1111111', F: 'Alexandria' },
      { ...ROW2, A: 'BL0002', D: 'TEST2222222', F: 'Alexandria' },
    ],
  }), orders(order));
  assert.deepEqual(result.findings, []);
});

test('A01: даты далеко от даты поручения и дата коносамента раньше прихода — предупреждения', () => {
  const result = check(buildTemplate({
    head: { E3: '05.09.2027', E4: '07.09.2027' },
    rows: [{ ...ROW1, C: '01.07.2026' }, { ...ROW2, A: 'BL0002', C: '05.09.2027' }],
  }));
  assert.deepEqual(result.findings.map(brief), [
    ['E3', 'ДАТА ПРИХОДА', 'warning', null], ['E4', 'ДАТА ВЫХОДА', 'warning', null],
    ['C9', 'ДАТА КОНОСАМЕНТА', 'warning', null], ['C9', 'ДАТА КОНОСАМЕНТА', 'warning', null],
    ['C10', 'ДАТА КОНОСАМЕНТА', 'warning', null],
  ]);
  assert.equal(result.findings[0].message, '05.09.2027 — на 363 дня позже даты поручения 07.09.2026, проверьте год');
  assert.equal(result.findings[1].message, '07.09.2027 — на 365 дней позже даты поручения 07.09.2026, проверьте год');
  assert.match(result.findings[2].message, /на 68 дней раньше даты поручения 07\.09\.2026/);
  assert.match(result.findings[3].message, /раньше даты прихода 05\.09\.2027/);
});

test('E3 позже E4 — ошибка «уточнить у заказчика» у обеих ячеек', () => {
  const result = check(buildTemplate({ head: { E3: '12.09.2026', E4: '11.09.2026' } }));
  assert.deepEqual(result.findings.filter((f) => f.level === 'error').map(brief),
    [['E3', 'ДАТА ПРИХОДА', 'error', 'customer'], ['E4', 'ДАТА ВЫХОДА', 'error', 'customer']]);
});

test('E1 СУДНО не то — «исправлю сам» из поручения', () => {
  const f = only(check(buildTemplate({ head: { E1: 'OTHER VESSEL' } })), () => true);
  assert.deepEqual(brief(f), ['E1', 'СУДНО', 'error', 'auto']);
  assert.equal(f.correction, 'TEST VESSEL');
});

test('E6 ТЕРМИНАЛ ВЫГРУЗКИ не связан с портом выгрузки поручения — «исправлю сам» из поручения', () => {
  const f = only(check(buildTemplate({ head: { E6: 'Совсем другой терминал' } })), () => true);
  assert.deepEqual(brief(f), ['E6', 'ТЕРМИНАЛ ВЫГРУЗКИ', 'error', 'auto']);
  assert.equal(f.correction, 'Port Said(EGPSD)');
});

// Реальный случай пользователя: в шапке — полное описательное название терминала,
// в поручении — город и код порта в скобках; сверяем не текст целиком, а название
// порта без скобочного кода, вхождением, поэтому находки быть не должно.
test('E6 ТЕРМИНАЛ ВЫГРУЗКИ — название порта без скобочного кода совпадает вхождением, находки нет', () => {
  const result = check(buildTemplate({ head: { E6: 'El Dekheila Alexandria Int. Container Terminal' } }),
    orders(buildOrder({ dischargePort: 'El Dekheila(EGEDK)' })));
  assert.deepEqual(result.findings, []);
});

test('E6 ТЕРМИНАЛ ВЫГРУЗКИ — у поручений разные порты выгрузки — «уточнить у заказчика»', () => {
  const first = buildOrder({ dischargePort: 'El Dekheila(EGEDK)', containers: [ORDER_CONTAINERS[0]] });
  const second = buildOrder({ number: ORDER2_NUMBER, dischargePort: 'Alexandria(EGALY)', containers: [ORDER_CONTAINERS[1]] });
  const result = check(buildTemplate({ head: { E6: 'Что-то ещё' }, rows: [ROW1, { ...ROW2, B: ORDER2_NUMBER }] }),
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
    sheetName: 'Лист1', sheets: ['Лист2'], rows: [{ ...ROW1, L: 28000, J: 'PALLETS' }, { ...ROW2, J: 'PALLETS' }],
  }));
  const result = check(template);
  const marked = await roundTrip(result.markedWorkbook);
  const sheet = marked.getWorksheet('Лист1');
  const fillOf = (address) => sheet.getCell(address).fill?.fgColor?.argb ?? null;
  assert.equal(fillOf('L9'), 'FFFFFF00');
  assert.equal(fillOf('L10'), null); // соседняя ячейка с тем же исходным стилем
  assert.equal(fillOf('J9'), 'FFADD8E6'); // предупреждение (A04 — код упаковки) — голубым
  assert.match(noteText(sheet.getCell('L9')), /28120/);
  assert.ok(noteText(sheet.getCell('J9')));
  assert.equal(sheet.properties.tabColor?.argb, 'FFFFFF00');
  assert.equal(marked.getWorksheet('Лист2').properties.tabColor?.argb, 'FFFFFF00');
  // Остальное содержимое и оформление не тронуты.
  assert.equal(sheet.getCell('A9').value, ROW1.A);
  assert.equal(sheet.getCell('G3').value, HEAD.G3);
  assert.equal(sheet.getCell('M9').value, 3700);
});

test('шаблон с пометками: несколько находок на одной ячейке — одно примечание строками', () => {
  const result = check(buildTemplate({ rows: [{ ...ROW1, D: 'TEST0000009' }, { ...ROW2, D: 'TEST0000009' }] }));
  const note = noteText(result.markedWorkbook.getWorksheet('EXPORT_MANIFEST').getCell('D9'));
  assert.equal(note.split('\n').length, 2, note);
});

test('исправленный шаблон: эталонная форма, исправления внесены, ячейки заказчика — как были', async () => {
  const result = check(buildTemplate({
    sheetName: 'Лист1', sheets: ['Лист2'], headerRow: 9, headers: { L: 'Веc груза' }, extra: ['ПРИМЕЧАНИЕ'],
    columns: LETTERS.filter((letter) => letter !== 'Z'), // недостающая колонка должна появиться
    rows: [{ ...ROW1, K: '20', C: new Date(Date.UTC(2026, 8, 9)), L: '28 000', extra: ['срочно'] }, null,
      { ...ROW2, G: 'детали', J: 'PALLETS' }, { K: 32, L: 34120 }],
  }));
  // У второй строки данных — своя ошибка (G кириллицей, «уточнить у заказчика») и
  // своё предупреждение (J не похож на код упаковки); в исходнике (headerRow: 9,
  // а перед этой строкой ещё пустая) её адрес — строка 12, а в исправленном
  // шаблоне пустая строка убрана — та же строка данных должна оказаться на 10-й
  // и там же покраситься, не на исходном адресе.
  assert.ok(result.findings.some((f) => f.cell === 'G12' && f.fix === 'customer'));
  assert.ok(result.findings.some((f) => f.cell === 'J12' && f.level === 'warning'));
  const corrected = await roundTrip(result.correctedWorkbook);
  assert.deepEqual(corrected.worksheets.map((s) => s.name), ['EXPORT_MANIFEST']);
  const sheet = corrected.getWorksheet('EXPORT_MANIFEST');
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((r) => sheet.getCell(`D${r}`).value),
    ['СУДНО', 'РЕЙС', 'ДАТА ПРИХОДА', 'ДАТА ВЫХОДА', 'ТЕРМИНАЛ ПОГРУЗКИ', 'ТЕРМИНАЛ ВЫГРУЗКИ']);
  assert.equal(sheet.getCell('E1').value, 'TEST VESSEL');
  assert.equal(sheet.getCell('E5').value, 'Timber Port');
  assert.equal(sheet.getCell('G3').value, HEAD.G3);
  assert.deepEqual(LETTERS.map((l) => sheet.getCell(`${l}8`).value), LETTERS.map((l) => STANDARD_HEADERS[l]));
  assert.equal(sheet.getCell('AA8').value, null); // лишняя колонка убрана
  assert.equal(sheet.getCell('L9').value, 28120); // «исправлю сам»: число из поручения
  assert.equal(sheet.getCell('K9').value, '20'); // места — ровно как у заказчика, текстом
  assert.deepEqual(sheet.getCell('C9').value, new Date(Date.UTC(2026, 8, 9))); // дата Excel сохранена
  assert.equal(sheet.getCell('A9').value, ROW1.A); // NBSP сохранён
  assert.equal(sheet.getCell('D10').value, 'TEST7654321'); // пустая строка убрана, строка сдвинулась
  assert.equal(sheet.getCell('D11').value, null); // строка «итого» убрана
  assert.equal(sheet.getColumn('G').width, 26.14);
  assert.equal(sheet.getRow(1).height, 23.25);
  assert.equal(sheet.getRow(9).height, 30);
  // Оставшаяся ошибка и предупреждение видны и здесь — на НОВОМ (сдвинутом) адресе,
  // не на исходном G12/J12, которого в исправленном шаблоне уже нет.
  assert.equal(sheet.getCell('G10').fill?.fgColor?.argb, 'FFFFFF00');
  assert.ok(noteText(sheet.getCell('G10')));
  assert.equal(sheet.getCell('J10').fill?.fgColor?.argb, 'FFADD8E6');
  assert.ok(noteText(sheet.getCell('J10')));
  assert.equal(sheet.getCell('G12').fill?.fgColor?.argb ?? null, null); // старого адреса нет вовсе
});

test('исправленный шаблон: формула заменена значением, объединение — значением в каждой ячейке', async () => {
  const result = check(buildTemplate({
    rows: [ROW1, { ...ROW2, L: { formula: 'SUM(3000,3000)', result: 6000 } }], merges: ['A9:A10'],
  }));
  const sheet = (await roundTrip(result.correctedWorkbook)).getWorksheet('EXPORT_MANIFEST');
  assert.equal(sheet.getCell('L10').value, 6000);
  assert.equal(sheet.getCell('A9').value, ROW1.A);
  assert.equal(sheet.getCell('A10').value, ROW1.A);
  assert.deepEqual(sheet.model.merges ?? [], []);
});

test('R16i: исправленный шаблон проходит повторную проверку, остальные находки — те же', async () => {
  const variants = [
    { sheetName: 'Лист1', rows: [{ ...ROW1, L: 28000, K: '20' }, ROW2] },
    { headerRow: 9, headers: { L: 'Веc груза' }, rows: [{ ...ROW1, E: '40DV', I: 999, O: 31000 }, null, ROW2] },
    { head: { E1: 'OTHER VESSEL', E2: null }, rows: [{ ...ROW1, D: 'test 1234567', B: 'X-1' }, { ...ROW2, C: new Date(Date.UTC(2026, 8, 9)) }] },
    { merges: ['A9:A10'], extra: ['ПРИМЕЧАНИЕ'], rows: [{ ...ROW1, L: '28 120' }, { ...ROW2, M: 2000 }] },
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
  const result = check(buildTemplate({ sheetName: 'Лист1', rows: [{ ...ROW1, L: 28000, K: 18 }, ROW2] }));
  assert.equal(result.reportText, [
    'ПРОВЕРКА ШАБЛОНА ЭЛ. ПОРУЧЕНИЯ',
    'Проверено: 12.09.2026 23:40',
    'Шаблон: шаблон.xlsx (лист «Лист1», 2 контейнера)',
    'Поручение: order1.xlsx — № 7700000000-P26-00001 от 07.09.2026, 2 контейнера',
    'Судно / рейс: TEST VESSEL / 0001E',
    '',
    'ИТОГ: ошибок — 3 (исправлено автоматически — 2, уточнить у заказчика — 1), предупреждений — 0.',
    '',
    'УТОЧНИТЬ У ЗАКАЗЧИКА — 1',
    '1. K9, КОЛИЧЕСТВО МЕСТ, контейнер TEST1234567: в шаблоне 18, по поручению 20.',
    '',
    'ИСПРАВЛЕНО АВТОМАТИЧЕСКИ — 2 (уже внесено в «шаблон (исправлен).xlsx»)',
    '1. Лист «Лист1» → переименован в «EXPORT_MANIFEST».',
    '2. L9, ВЕС ГРУЗА, контейнер TEST1234567: в шаблоне 28000, по поручению 28120 → 28120.',
    '',
  ].join('\r\n'));
});

test('отчёт: без находок — строка «Ошибок и предупреждений нет», разделов нет, CRLF без BOM', () => {
  const result = check(buildTemplate());
  assert.match(result.reportText, /Ошибок и предупреждений нет — шаблон соответствует форме и поручению\./);
  assert.doesNotMatch(result.reportText, /УТОЧНИТЬ У ЗАКАЗЧИКА|ИСПРАВЛЕНО АВТОМАТИЧЕСКИ|ПРЕДУПРЕЖДЕНИЯ/);
  assert.equal(/[^\r]\n/.test(result.reportText), false);
  assert.notEqual(result.reportText.charCodeAt(0), 0xFEFF);
});

test('отчёт: предупреждение «вверху» — первым в разделе предупреждений; имена файлов — от имени шаблона', () => {
  const result = checkTemplate(
    buildTemplate({ rows: [ROW1, { ...ROW2, D: 'TEST0000009', B: 'OTHER-1' }] }),
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
