// Эталонная форма шаблона эл. поручения — описана в одном месте, как
// lib/manifest-format.js для манифеста: если система поменяет шаблон, правится
// только этот файл. Форма — по шаблону первой реальной заявки (2026-09-28,
// «Шаблон эл. поручения серпентинит.xlsx»); прежняя форма (26 колонок A:Z,
// шапка в D/E) — .autopilot/2026-09-12-order-template-check--wip/reference.md.
// Обычный модуль без зависимостей: ни ExcelJS, ни DOM.

// Лист данных; с другим именем (или регистром) система файл не примет.
export const SHEET_NAME = 'EXPORT_MANIFEST';

// Второй лист формы — справочник значений для «УСЛОВИЯ ПОСТАВКИ» и «TYPE OF
// MOVERMENT» (колонки A и B). Проверки данных (выпадающих списков) в образце
// нет — это подсказка заказчику, поэтому отсутствие листа не ошибка, но в
// исправленном шаблоне он есть всегда.
export const REFERENCE_SHEET_NAME = 'Reference';
export const MOVEMENT_TYPES = ['FCL/FCL', 'FCL/LCL', 'LCL/LCL', 'LCL/FCL'];
export const DELIVERY_TERMS = ['CY/CY', 'CY/DOOR', 'DOOR/DOOR', 'DOOR/CY', 'GATE/GATE'];

// Шапка рейса: подпись в колонке E, значение — справа, в F, каждая на своей
// строке. required — ячейка значения залита жёлтым в образце («Графы,
// выделенные жёлтым цветом, обязательны к заполнению»): ЛИНИЯ и даты — нет.
export const HEADER_LABEL_COLUMN = 'E';
export const HEADER_VALUE_COLUMN = 'F';
export const HEADER_FIELDS = [
  { key: 'line', label: 'ЛИНИЯ', row: 1, kind: 'text', required: false },
  { key: 'vessel', label: 'СУДНО', row: 2, kind: 'text', required: true },
  { key: 'voyage', label: 'РЕЙС', row: 3, kind: 'text', required: true },
  { key: 'arrivalDate', label: 'ДАТА ПРИХОДА', row: 4, kind: 'date', required: false },
  { key: 'departureDate', label: 'ДАТА ВЫХОДА', row: 5, kind: 'date', required: false },
  { key: 'loadingTerminal', label: 'ТЕРМИНАЛ ПОГРУЗКИ', row: 6, kind: 'text', required: true },
  { key: 'dischargeTerminal', label: 'ТЕРМИНАЛ ВЫГРУЗКИ', row: 7, kind: 'text', required: true },
];

// Памятки — оформление, не данные: их отсутствие не ошибка, в исправленном
// шаблоне они есть всегда. Текст — как в образце, с его пробелами.
export const NOTES = [
  { cell: 'H3', text: 'Таблицу заполнять строго в соответствии с п/поручением,', font: 'note' },
  { cell: 'H4', text: ' ДТ и товаро-сопроводительными документами!!', font: 'note' },
  { cell: 'H6', text: 'Графы, выделенные жёлтым цветом, обязательны к заполнению! ', font: 'noteRequired', fill: true },
];

// Строка 8 пустая, заголовки — строка 9, данные — с 10-й, одна строка на контейнер.
export const COLUMN_HEADER_ROW = 9;
export const DATA_START_ROW = 10;

// Вид значения: 'text' — текст; 'number' — числовая ячейка; 'date' — текст
// ДД.ММ.ГГГГ; 'seal' — число, если это одни цифры без ведущего нуля, иначе текст
// («0012345» числом потерял бы нули); 'list' — одно из значений values (лист
// Reference). required — заполнено в шаблоне, который система приняла
// (2026-09-28, решение пользователя: «всё, что заполнено»); пустыми система
// приняла D, J, K, T, AB–AF — они необязательны, но заполненные проверяются
// (объём > 0, SOC/LOC по поручению, класс при опасном грузе). aliases — прежние написания заголовка, по которым колонка
// ещё узнаётся (и заголовок исправляется на эталонный). width — ширина как в
// образце; wrap — перенос текста в ячейках данных.
export const COLUMNS = [
  { letter: 'A', key: 'billOfLading', header: 'НОМЕР КОНОСАМЕНТА', kind: 'text', required: true, width: 18.55, wrap: false },
  { letter: 'B', key: 'orderNumber', header: 'НОМЕР ПОРУЧЕНИЯ', kind: 'text', required: true, width: 15.66, wrap: false },
  { letter: 'C', key: 'billDate', header: 'ДАТА КОНОСАМЕНТА', kind: 'date', required: true, width: 14.66, wrap: false },
  { letter: 'D', key: 'placeOfIssue', header: 'МЕСТО ИЗДАНИЯ', kind: 'text', required: false, width: 24.33, wrap: false },
  { letter: 'E', key: 'container', header: 'НОМЕР КОНТЕЙНЕРА', kind: 'text', required: true, width: 14.89, wrap: false },
  { letter: 'F', key: 'iso', header: 'ISO КОД', kind: 'text', required: true, width: 12.55, wrap: false },
  { letter: 'G', key: 'dischargeTerminal', header: 'ТЕРМИНАЛ ВЫГРУЗКИ (коносамент)', kind: 'text', required: true, width: 21.55, wrap: false },
  { letter: 'H', key: 'cargoNameEn', header: 'НАИМЕНОВАНИЕ ГРУЗА АНГЛ.', kind: 'text', required: true, width: 20.55, wrap: true },
  { letter: 'I', key: 'cargoNameRu', header: 'НАИМЕНОВАНИЕ ГРУЗА РУС.', kind: 'text', required: true, width: 19.55, wrap: true },
  { letter: 'J', key: 'preCarriage', header: 'PRE-CARRIAGE BY', kind: 'text', required: false, width: 16.66, wrap: false },
  { letter: 'K', key: 'placeOfReceipt', header: 'PLACE OF RECEIPT', kind: 'text', required: false, width: 16.66, wrap: true },
  { letter: 'L', key: 'placeOfDelivery', header: 'PLACE OF DELIVERY', kind: 'text', required: true, width: 16.66, wrap: false },
  { letter: 'M', key: 'deliveryTerms', header: 'УСЛОВИЯ ПОСТАВКИ', kind: 'list', values: DELIVERY_TERMS, required: true, width: 11, wrap: false },
  // «MOVERMENT» — опечатка самой системы; заголовок должен совпадать с её формой.
  { letter: 'N', key: 'movementType', header: 'TYPE OF MOVERMENT', aliases: ['TYPE OF MOVEMENT'], kind: 'list', values: MOVEMENT_TYPES, required: true, width: 11, wrap: false },
  { letter: 'O', key: 'seals', header: 'НОМЕРА ПЛОМБ', kind: 'seal', required: true, width: 15.11, wrap: false },
  { letter: 'P', key: 'packageType', header: 'ТИП УПАКОВКИ', kind: 'text', required: true, width: 13.33, wrap: false },
  { letter: 'Q', key: 'places', header: 'КОЛИЧЕСТВО МЕСТ', kind: 'number', required: true, width: 14.55, wrap: false },
  { letter: 'R', key: 'cargoWeight', header: 'ВЕС ГРУЗА', kind: 'number', required: true, width: 12, wrap: false },
  { letter: 'S', key: 'tareWeight', header: 'ВЕС ТАРЫ', kind: 'number', required: true, width: 12, wrap: false },
  { letter: 'T', key: 'volume', header: 'ОБЪЕМ', kind: 'number', required: false, width: 12, wrap: false },
  { letter: 'U', key: 'vgm', header: 'ВГМ', kind: 'number', required: true, width: 12.43, wrap: false },
  { letter: 'V', key: 'shipper', header: 'SHIPPER', kind: 'text', required: true, width: 11.66, wrap: true },
  { letter: 'W', key: 'shipperAddress', header: 'SHIPPER_ADDRESS', kind: 'text', required: true, width: 15.11, wrap: true },
  { letter: 'X', key: 'consignee', header: 'CONSIGNEE', kind: 'text', required: true, width: 13.44, wrap: true },
  { letter: 'Y', key: 'consigneeAddress', header: 'CONSIGNEE_ADDRESS', kind: 'text', required: true, width: 16.11, wrap: true },
  { letter: 'Z', key: 'notify', header: 'NOTIFY', kind: 'text', required: true, width: 13.44, wrap: true },
  { letter: 'AA', key: 'notifyAddress', header: 'NOTIFY_ADDRESS', kind: 'text', required: true, width: 16.55, wrap: true },
  { letter: 'AB', key: 'temperature', header: 'ТЕМПЕРАТУРА', kind: 'text', required: false, width: 15, wrap: false },
  { letter: 'AC', key: 'dangerClasses', header: 'ОПИСАНИЕ КЛАССОВ ОПАСНОСТИ', kind: 'text', required: false, width: 17.11, wrap: false },
  { letter: 'AD', key: 'empty', header: 'ПОРОЖНИЙ', kind: 'text', required: false, width: 12.66, wrap: false },
  { letter: 'AE', key: 'forwarder', header: 'НАИМЕНОВАНИЕ или ИНН ЭКСПЕДИТОРА', aliases: ['ИНН ЭКСПЕДИТОРА'], kind: 'text', required: false, width: 16, wrap: true },
  { letter: 'AF', key: 'locSoc', header: 'LOC_SOC', kind: 'text', required: false, width: 12.66, wrap: false },
];

// Оформление исправленного шаблона — как в образце.
export const HEADER_ROW_HEIGHT = 22.8; // строки шапки 1–7
export const COLUMN_HEADER_ROW_HEIGHT = 30.6;
export const DATA_ROW_HEIGHT = 30;
export const TEXT_FORMAT = '@'; // формат ячеек текстовых колонок и дат
export const REQUIRED_FILL_ARGB = 'FFFFFF00'; // жёлтая заливка обязательных граф
export const COLUMN_HEADER_FILL_ARGB = 'FF92D050'; // зелёная заливка заголовков колонок
export const FONTS = {
  headerLabel: { name: 'Arial Cyr', size: 10, bold: true },
  headerValue: { name: 'Arial Cyr', size: 10, bold: true },
  note: { name: 'Arial Cyr', size: 18, bold: true, color: { argb: 'FFFF0000' } },
  noteRequired: { name: 'Arial Cyr', size: 14, bold: true },
  columnHeader: { name: 'Arial Cyr', size: 8, bold: true },
  data: { name: 'Calibri', size: 10 },
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
