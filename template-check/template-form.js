// Эталонная форма шаблона эл. поручения — описана в одном месте, как
// lib/manifest-format.js для манифеста: если система поменяет шаблон, правится
// только этот файл. Всё взято из двух образцов, присланных пользователем («оба
// заполнены корректно»), устройство — .autopilot/2026-09-12-order-template-check--wip/reference.md.
// Обычный модуль без зависимостей: ни ExcelJS, ни DOM.

// Единственный лист книги; с другим именем (или регистром) система файл не примет.
export const SHEET_NAME = 'EXPORT_MANIFEST';

// Шапка рейса: подпись в колонке D, значение — справа, в E, каждая на своей строке.
export const HEADER_LABEL_COLUMN = 'D';
export const HEADER_VALUE_COLUMN = 'E';
export const HEADER_FIELDS = [
  { key: 'vessel', label: 'СУДНО', row: 1, kind: 'text' },
  { key: 'voyage', label: 'РЕЙС', row: 2, kind: 'text' },
  { key: 'arrivalDate', label: 'ДАТА ПРИХОДА', row: 3, kind: 'date' },
  { key: 'departureDate', label: 'ДАТА ВЫХОДА', row: 4, kind: 'date' },
  { key: 'loadingTerminal', label: 'ТЕРМИНАЛ ПОГРУЗКИ', row: 5, kind: 'text' },
  { key: 'dischargeTerminal', label: 'ТЕРМИНАЛ ВЫГРУЗКИ', row: 6, kind: 'text' },
];

// Памятка — оформление, не данные: её отсутствие не ошибка, в исправленном шаблоне она есть всегда.
export const NOTE_CELL = 'G3';
export const NOTE_TEXT = 'Таблицу заполнять строго в соответствии с п/поручением и ДТ!';

// Строка 7 пустая, заголовки — строка 8, данные — с 9-й, одна строка на контейнер.
export const COLUMN_HEADER_ROW = 8;
export const DATA_START_ROW = 9;

// Вид значения: 'text' — текст; 'number' — числовая ячейка; 'date' — текст
// ДД.ММ.ГГГГ; 'seal' — число, если это одни цифры без ведущего нуля, иначе текст
// («0012345» числом потерял бы нули). required — заполнено у каждого контейнера
// в обоих образцах (A–U); V–Z в образцах пустые. width — ширина как в образце 1;
// wrap — перенос текста в ячейках данных.
export const COLUMNS = [
  { letter: 'A', key: 'billOfLading', header: 'НОМЕР КОНОСАМЕНТА', kind: 'text', required: true, width: 18.57, wrap: false },
  { letter: 'B', key: 'orderNumber', header: 'НОМЕР ПОРУЧЕНИЯ', kind: 'text', required: true, width: 18.57, wrap: false },
  { letter: 'C', key: 'billDate', header: 'ДАТА КОНОСАМЕНТА', kind: 'date', required: true, width: 14.71, wrap: false },
  { letter: 'D', key: 'container', header: 'НОМЕР КОНТЕЙНЕРА', kind: 'text', required: true, width: 22.43, wrap: false },
  { letter: 'E', key: 'iso', header: 'ISO КОД', kind: 'text', required: true, width: 12, wrap: false },
  { letter: 'F', key: 'dischargeTerminal', header: 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', kind: 'text', required: true, width: 16.71, wrap: false },
  { letter: 'G', key: 'cargoNameEn', header: 'НАИМЕНОВАНИЕ ГРУЗА АНГЛ.', kind: 'text', required: true, width: 26.14, wrap: true },
  { letter: 'H', key: 'cargoNameRu', header: 'НАИМЕНОВАНИЕ ГРУЗА РУС.', kind: 'text', required: true, width: 22.43, wrap: true },
  { letter: 'I', key: 'seals', header: 'НОМЕРА ПЛОМБ', kind: 'seal', required: true, width: 15.14, wrap: false },
  { letter: 'J', key: 'packageType', header: 'ТИП УПАКОВКИ', kind: 'text', required: true, width: 13.29, wrap: false },
  { letter: 'K', key: 'places', header: 'КОЛИЧЕСТВО МЕСТ', kind: 'number', required: true, width: 14.57, wrap: false },
  { letter: 'L', key: 'cargoWeight', header: 'ВЕС ГРУЗА', kind: 'number', required: true, width: 12, wrap: false },
  { letter: 'M', key: 'tareWeight', header: 'ВЕС ТАРЫ', kind: 'number', required: true, width: 12, wrap: false },
  { letter: 'N', key: 'volume', header: 'ОБЪЕМ', kind: 'number', required: true, width: 12, wrap: false },
  { letter: 'O', key: 'vgm', header: 'ВГМ', kind: 'number', required: true, width: 12.43, wrap: false },
  { letter: 'P', key: 'shipper', header: 'SHIPPER', kind: 'text', required: true, width: 20, wrap: true },
  { letter: 'Q', key: 'shipperAddress', header: 'SHIPPER_ADDRESS', kind: 'text', required: true, width: 27.71, wrap: true },
  { letter: 'R', key: 'consignee', header: 'CONSIGNEE', kind: 'text', required: true, width: 13.43, wrap: true },
  { letter: 'S', key: 'consigneeAddress', header: 'CONSIGNEE_ADDRESS', kind: 'text', required: true, width: 13.43, wrap: true },
  { letter: 'T', key: 'notify', header: 'NOTIFY', kind: 'text', required: true, width: 13.43, wrap: true },
  { letter: 'U', key: 'notifyAddress', header: 'NOTIFY_ADDRESS', kind: 'text', required: true, width: 16.57, wrap: true },
  { letter: 'V', key: 'temperature', header: 'ТЕМПЕРАТУРА', kind: 'text', required: false, width: 15, wrap: false },
  { letter: 'W', key: 'dangerClasses', header: 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', kind: 'text', required: false, width: 17.14, wrap: false },
  { letter: 'X', key: 'empty', header: 'ПОРОЖНИЙ', kind: 'text', required: false, width: 12.71, wrap: false },
  { letter: 'Y', key: 'forwarderInn', header: 'ИНН ЭКСПЕДИТОРА', kind: 'text', required: false, width: 16, wrap: false },
  { letter: 'Z', key: 'locSoc', header: 'LOC_SOC', kind: 'text', required: false, width: 12.71, wrap: false },
];

// Оформление исправленного шаблона — как в образце 1.
export const HEADER_ROW_HEIGHT = 23.25; // строки шапки 1–6
export const DATA_ROW_HEIGHT = 30;
export const TEXT_FORMAT = '@'; // формат ячеек текстовых колонок и дат
export const FONTS = {
  headerLabel: { name: 'Arial Cyr', size: 10, bold: true },
  headerValue: { name: 'Arial Cyr', size: 10, bold: true },
  note: { name: 'Arial Cyr', size: 16, bold: true, color: { argb: 'FFFF0000' } },
  columnHeader: { name: 'Arial Cyr', size: 8, bold: true },
  data: { name: 'Arial', size: 8 },
};

// Латинские буквы, которые на вид не отличить от кириллических: в заголовке,
// набранном вручную, они встречаются (на сайте уже была латинская «c» в «Веc груза»).
const LATIN_LOOKALIKES = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
};

/**
 * Нормализация заголовка (и подписи шапки) для поиска: верхний регистр,
 * латиница-двойник → кириллица, остаются только буквы и цифры. По ней
 * «ВЕС  ГРУЗА», «вес груза» и «НАИМЕНОВАНИЕ ГРУЗА (АНГЛ)» находят свою колонку;
 * точность текста проверяется отдельно, сравнением как есть.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function normalizeHeader(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[ABCEHKMOPTXY]/g, (ch) => LATIN_LOOKALIKES[ch])
    .replace(/[^\p{L}\p{N}]/gu, '');
}
