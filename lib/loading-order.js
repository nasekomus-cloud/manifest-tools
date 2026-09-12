// Формат поручения на погрузку — один и тот же файл читают «Сверить с
// поручениями» (order-check) и «Проверить шаблон» (template-check), поэтому
// разбор живёт здесь, в одном месте, как lib/port-breakdown.js. Чистая функция
// от книги ExcelJS: модуль ExcelJS не импортирует и DOM не трогает.
//
// Поручение генерирует система клиента: один лист, шапка из пар «подпись —
// значение справа» над таблицей, таблица контейнеров под строкой заголовков
// (раскладка — .autopilot/2026-09-12-order-template-check--wip/reference.md,
// раздел «Поручение»). Позиции ячеек не фиксируем — ищем по тексту подписи и
// заголовка, как и везде на сайте.

// Наименования, которыми в поручении помечают строку с весом упаковочных
// поддонов/палет, а не самого груза. Сравнение точное (после trim/toLowerCase),
// не по вхождению подстроки — иначе под исключение попала бы настоящая позиция
// груза вроде «поддон анализатора ситового» (реальный случай, CLAUDE.md).
export const PALLET_CARGO_NAMES = new Set([
  'поддоны', 'поддон', 'палеты', 'палета', 'паллеты', 'паллета',
]);

// Подписи шапки — точным совпадением текста ячейки (после trim/toLowerCase):
// рядом с «Номер поручения» в настоящем файле стоит «Номер поручения (Э)» с
// другим номером, «Отправитель» соседствует с «Отправитель (англ)».
const HEADER_LABELS = {
  orderNumber: 'номер поручения',
  date: 'дата',
  client: 'клиент',
  inn: 'инн',
  shipper: 'отправитель',
  shipperEn: 'отправитель (англ)',
  consignee: 'грузополучатель',
  consigneeEn: 'грузополучатель (англ)',
  notify: 'извещение',
  vessel: 'судно',
  voyage: 'рейс',
  loadingPort: 'порт погрузки',
  dischargePort: 'порт выгрузки',
};
const FIELD_BY_LABEL = new Map(Object.entries(HEADER_LABELS).map(([field, label]) => [label, field]));

// Заголовки таблицы — тоже точным совпадением, не вхождением подстроки:
// «Брутто груза» — подстрока заголовка «Брутто груза с весом контейнера»,
// нестрогий поиск задел бы не ту колонку (CLAUDE.md, «Подводные камни»).
// «Нетто груза» не читается: в форме order его нет, потребителей у него нет.
const TABLE_HEADERS = {
  container: 'номер контейнера',
  owner: 'владелец, soc / loc/-',
  iso: 'код исо',
  seal: 'номер пломбы',
  cargoName: 'наименование груза, род упаковки',
  places: 'число мест',
  hazardClass: 'класс опасности',
  hazardCode: 'код опасности',
  grossWeight: 'брутто груза',
  tareWeight: 'вес контейнера',
  totalWeight: 'брутто груза с весом контейнера',
};
const FOOTER_MARKER = 'дополнительные сведения';
// Строку заголовков таблицы ищем в первых строках листа, не по номеру 8 как таковому.
const HEADER_SEARCH_ROWS = 20;

function cellText(cell) {
  if (!cell) return '';
  // Объединённая ячейка с пустым мастером бросает исключение при чтении .text
  // (см. dg-check/core.js) — здесь оно означает «пусто», а не падение разбора.
  try {
    const value = cell.text;
    if (value === undefined || value === null) return '';
    return String(value).trim();
  } catch {
    return '';
  }
}

// Число или null; формула — по её результату. «Число мест» в настоящем файле —
// текст «40.0000», Number() читает его как 40.
function cellNumber(cell) {
  if (!cell) return null;
  let value = cell.value;
  if (value && typeof value === 'object' && 'result' in value) value = value.result;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function isBlankRow(row) {
  for (let c = 1; c <= row.cellCount; c++) {
    if (cellText(row.getCell(c))) return false;
  }
  return true;
}

function findTableHeaderRow(sheet) {
  const maxRow = Math.min(sheet.rowCount, HEADER_SEARCH_ROWS);
  for (let r = 1; r <= maxRow; r++) {
    if (cellText(sheet.getRow(r).getCell(1)).toLowerCase() === TABLE_HEADERS.container) return r;
  }
  return null;
}

function findTableColumns(sheet, headerRow) {
  const row = sheet.getRow(headerRow);
  const maxCol = row.cellCount || 20;
  const columns = {};
  for (const [key, label] of Object.entries(TABLE_HEADERS)) {
    for (let col = 1; col <= maxCol; col++) {
      if (cellText(row.getCell(col)).toLowerCase() === label) {
        columns[key] = col;
        break;
      }
    }
  }
  return columns;
}

// Строка с номером контейнера открывает группу, строки ниже без номера — ещё
// товары того же контейнера. Вес контейнера и «Брутто груза с весом
// контейнера» стоят в первой строке группы. Контейнеры — списком в порядке
// файла: индекс по номеру каждый потребитель строит сам.
function readContainers(sheet, headerRow, cols) {
  const text = (row, key) => (cols[key] ? cellText(row.getCell(cols[key])) : '');
  const number = (row, key) => (cols[key] ? cellNumber(row.getCell(cols[key])) : null);

  const containers = [];
  let current = null;
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const containerNumber = text(row, 'container');
    // Таблица кончается строкой «Дополнительные сведения»: ниже — уже не
    // контейнеры, текст в колонке номера там не должен открыть новую группу.
    if (containerNumber.toLowerCase() === FOOTER_MARKER) break;
    if (containerNumber) {
      current = {
        containerNumber,
        row: r,
        owner: text(row, 'owner'),
        isoCode: text(row, 'iso'),
        sealNumber: text(row, 'seal'),
        places: 0,
        goodsCount: 0,
        goodsNames: [],
        cargoWeight: 0,
        palletWeight: 0,
        tareWeight: number(row, 'tareWeight'),
        totalWeight: number(row, 'totalWeight'),
        dangerousGoods: new Set(),
      };
      containers.push(current);
    }
    // Пустая строка (или одни пробелы) внутри таблицы — не товар.
    if (!current || isBlankRow(row)) continue;

    const cargoName = text(row, 'cargoName');
    const gross = number(row, 'grossWeight') || 0;
    if (PALLET_CARGO_NAMES.has(cargoName.toLowerCase())) {
      // Вес поддонов — не товар: ни в вес груза, ни в места, ни в число товаров.
      current.palletWeight += gross;
    } else {
      current.cargoWeight += gross;
      current.places += number(row, 'places') || 0;
      current.goodsCount += 1;
      current.goodsNames.push(cargoName);
    }

    // «Код опасности» может нести несколько номеров UN через запятую.
    const hazardClass = text(row, 'hazardClass');
    const hazardCodes = text(row, 'hazardCode');
    if (hazardClass && hazardCodes) {
      for (const un of hazardCodes.split(',').map((n) => n.trim()).filter(Boolean)) {
        current.dangerousGoods.add(`${hazardClass}|${un}`);
      }
    }
  }
  return containers;
}

// Шапка — строки 1..lastRow; у повторившейся подписи берётся первая сверху
// (слева направо в строке). Нет подписи — поле остаётся пустой строкой.
function readHeaderFields(sheet, lastRow) {
  const fields = Object.fromEntries(Object.keys(HEADER_LABELS).map((field) => [field, '']));
  const found = new Set();
  for (let r = 1; r <= lastRow; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      const field = FIELD_BY_LABEL.get(cellText(row.getCell(c)).toLowerCase());
      if (!field || found.has(field)) continue;
      found.add(field);
      fields[field] = cellText(row.getCell(c + 1));
    }
  }
  return fields;
}

/**
 * Разбирает поручение на погрузку.
 *
 * @param {import('exceljs').Workbook} workbook
 * @returns {{ok:true, order:object} | {ok:false, error:string}} — форма order в
 *   .autopilot/2026-09-12-order-template-check--wip/interfaces.md
 */
export function parseLoadingOrder(workbook) {
  const sheet = workbook.worksheets[0];
  if (!sheet) return { ok: false, error: 'нет ни одного листа' };

  // Шапка — строки выше заголовка таблицы. Нет заголовка — подписи ищутся в тех
  // же первых строках, где искали его: без номера поручения файл поручением не
  // считается, и эта ошибка идёт раньше ошибки про таблицу (порядок проверок —
  // как был в order-check/core.js).
  const headerRow = findTableHeaderRow(sheet);
  const lastHeaderFieldRow = headerRow ? headerRow - 1 : Math.min(sheet.rowCount, HEADER_SEARCH_ROWS);
  const fields = readHeaderFields(sheet, lastHeaderFieldRow);
  if (!fields.orderNumber) return { ok: false, error: 'не найден номер поручения' };
  if (!headerRow) return { ok: false, error: 'не найден заголовок «Номер контейнера»' };

  const cols = findTableColumns(sheet, headerRow);
  if (!cols.container || !cols.grossWeight || !cols.tareWeight) {
    return { ok: false, error: 'не найдены обязательные колонки таблицы контейнеров' };
  }
  return { ok: true, order: { ...fields, containers: readContainers(sheet, headerRow, cols) } };
}
