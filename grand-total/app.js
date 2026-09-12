// Состояние страницы «Итоговый PDF-отчёт по манифесту»: выбор файлов, три
// поля ручного ввода (позывной, дата прибытия, терминал — в манифесте их нет
// ни в каком виде), предпросмотр на странице и сборка/скачивание PDF через
// pdf-lib. Подсчёт разбивки и судно/рейс — дело core.js (buildGrandTotalData),
// сюда импортируется как обычный модуль (см. interfaces.md). Панель, шаги и
// полоса действия — общий каркас assets/shell.js (window.Shell); список файлов,
// плитки и полоса повторяют образец merge/app.js.

import { buildGrandTotalData } from './core.js?v=202609122000';
import { countDataRows } from '../lib/manifest-format.js?v=202609121930';

const Shell = window.Shell;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');
const callSignInput = document.getElementById('call-sign-input');
const arrivalDateInput = document.getElementById('arrival-date-input');
const terminalInput = document.getElementById('terminal-input');
const buildBtn = document.getElementById('build-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const resultsBox = document.getElementById('results-box');
const downloadBtn = document.getElementById('download-btn');
const downloadExcelBtn = document.getElementById('download-excel-btn');

const TABLE_COLUMNS = [
  'TOTAL CONTAINER NUMBER',
  'TOTAL GROSS CARGO WEIGHT',
  'TOTAL TARE WEIGHT',
  'TOTAL ALL (TARE + CARGO)',
];

/**
 * rows: undefined — ещё считается; number — строк данных; null — файл не читается как манифест.
 * @type {Array<{id: number, file: File, rows: number|null|undefined}>}
 */
let entries = [];
let nextId = 1;
/** @type {{vessel: string|null, voyage: string|null, byType: Array<object>, grandTotal: object, billsOfLading: number|null} | null} */
let lastReport = null;
let busy = false;
let setVersion = 0; // растёт при каждом изменении набора — результат старого набора не показываем

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

// Вручную, а не toLocaleString('ru-RU'): у него группирующий пробел — Unicode
// U+00A0, а здесь нужна ровно та строка, что показывает эталон
// (reference.md), независимо от рантайма браузера, который откроет PDF.
function formatWeight(n) {
  const [intPart, fracPart] = Math.abs(n).toFixed(3).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${grouped},${fracPart} KGS`;
}

// «20DC» → «20'DC» — как в эталоне. Тип без ведущих цифр (например,
// заглушка «(не указан)») возвращается как есть, не ломая отчёт.
function formatContainerType(type) {
  const match = /^(\d+)(.*)$/.exec(type);
  return match ? `${match[1]}'${match[2]}` : type;
}

// Порожние контейнеры того же типа — отдельной строкой таблицы (buildManifestTotals
// уже разбил их по entry.isEmpty), суффикс " empty" строчными буквами, не через
// normalizeType (тот в верхнем регистре) — как показывает вес груза 0 у таких строк.
function formatTypeCount(entry) {
  const suffix = entry.isEmpty ? ' empty' : '';
  return `${entry.count}x${formatContainerType(entry.type)}${suffix}`;
}

// Общие для PDF и Excel строки таблицы — один источник состава и порядка,
// а не два места, которые могут разойтись.
function buildTableRows(report) {
  const dataRows = report.byType.map((entry) => [
    formatTypeCount(entry),
    formatWeight(entry.cargoWeight),
    formatWeight(entry.tareWeight),
    formatWeight(entry.totalWeight),
  ]);
  const totalRow = [
    'TOTAL:',
    formatWeight(report.grandTotal.cargoWeight),
    formatWeight(report.grandTotal.tareWeight),
    formatWeight(report.grandTotal.totalWeight),
  ];
  return { header: TABLE_COLUMNS, dataRows, totalRow };
}

function actionInfoText() {
  if (entries.length === 0) return 'Файлы не выбраны';
  const n = entries.length;
  const files = `${n} ${Shell.plural(n, 'файл', 'файла', 'файлов')}`;
  if (entries.some((e) => e.rows === undefined)) return `${files} · считаю строки…`;
  const total = entries.reduce((sum, e) => sum + (typeof e.rows === 'number' ? e.rows : 0), 0);
  return `${files} · ${rowsLabel(total)}`;
}

function updateUi() {
  buildBtn.disabled = entries.length === 0 || busy;
  Shell.setAction({
    info: actionInfoText(),
    hint: entries.length === 0 ? 'Сначала добавьте файлы' : null,
  });
  Shell.setStep(lastReport ? 3 : entries.length ? 2 : 1);
}

function metaFor(entry) {
  if (entry.rows === undefined) return { text: 'считаю строки…', error: false };
  if (entry.rows === null) return { text: 'не удалось прочитать — это точно .xlsx манифеста?', error: true };
  return { text: rowsLabel(entry.rows), error: false };
}

function renderFileList() {
  fileListEl.innerHTML = '';

  entries.forEach((entry) => {
    const li = document.createElement('li');

    const name = document.createElement('span');
    name.className = 'file-list__name';
    name.textContent = entry.file.name;

    const meta = document.createElement('span');
    const { text, error } = metaFor(entry);
    meta.className = error ? 'file-list__meta file-list__meta--error' : 'file-list__meta';
    meta.textContent = text;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-list__remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Убрать файл ${entry.file.name}`);
    removeBtn.addEventListener('click', () => {
      entries = entries.filter((e) => e.id !== entry.id);
      setChanged();
    });

    li.appendChild(name);
    li.appendChild(meta);
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);
  });
}

// Любое изменение набора файлов делает показанный результат устаревшим —
// прячем его, чтобы нельзя было скачать не то. Три поля ручного ввода сюда не
// относятся: они читаются в момент скачивания, а не при построении отчёта.
function setChanged() {
  setVersion++;
  clearError();
  hideSummary();
  renderFileList();
  updateUi();
}

async function countRows(entry) {
  let rows = null;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await entry.file.arrayBuffer());
    rows = countDataRows(workbook);
  } catch {
    rows = null; // не .xlsx или повреждён — скажем в списке, запуск не блокируем
  }
  if (!entries.includes(entry)) return; // файл уже убрали из списка
  entry.rows = rows;
  renderFileList();
  updateUi();
}

function addFiles(fileList) {
  const added = Array.from(fileList).map((file) => ({ id: nextId++, file, rows: undefined }));
  entries.push(...added);
  setChanged();
  added.forEach((entry) => {
    countRows(entry);
  });
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function hideSummary() {
  summaryBox.hidden = true;
  resultStats.innerHTML = '';
  resultsBox.innerHTML = '';
  lastReport = null;
  Shell.setResultShown(false);
}

async function loadWorkbook(file) {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new Error(`Не удалось прочитать файл «${file.name}»: файл повреждён или не является .xlsx`);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error(`Не удалось прочитать файл «${file.name}»: файл повреждён или не является .xlsx`);
  }

  return { fileName: file.name, workbook };
}

function addStat(value, label) {
  const stat = document.createElement('div');
  stat.className = 'stat';
  const valueEl = document.createElement('span');
  valueEl.className = 'stat__value';
  valueEl.textContent = value;
  const labelEl = document.createElement('span');
  labelEl.className = 'stat__label';
  labelEl.textContent = label;
  stat.appendChild(valueEl);
  stat.appendChild(labelEl);
  resultStats.appendChild(stat);
}

// Плитки — только из того, что уже вернул buildGrandTotalData: контейнеры —
// сумма «Кол-во» по строкам таблицы (гружёные и порожние вместе), общий вес —
// итог TOTAL ALL, коносаменты — если колонка найдена.
function renderStats(report) {
  resultStats.innerHTML = '';
  const containers = report.byType.reduce((sum, entry) => sum + entry.count, 0);
  addStat(String(containers), Shell.plural(containers, 'контейнер', 'контейнера', 'контейнеров'));
  addStat(formatWeight(report.grandTotal.totalWeight), 'общий вес');
  if (report.billsOfLading !== null) {
    addStat(String(report.billsOfLading), Shell.plural(report.billsOfLading, 'коносамент', 'коносамента', 'коносаментов'));
  }
}

function renderResults(report) {
  resultsBox.innerHTML = '';

  const { header, dataRows, totalRow: totalCells } = buildTableRows(report);

  const table = document.createElement('table');
  table.className = 'data-table';
  const headerRow = document.createElement('tr');
  header.forEach((text, i) => {
    const th = document.createElement('th');
    th.textContent = text;
    if (i > 0) th.className = 'num';
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  dataRows.forEach((cells) => {
    const row = document.createElement('tr');
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      td.className = i > 0 ? 'num' : 'mono';
      row.appendChild(td);
    });
    table.appendChild(row);
  });

  const totalRow = document.createElement('tr');
  totalRow.className = 'is-total';
  totalCells.forEach((text, i) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (i > 0) td.className = 'num';
    totalRow.appendChild(td);
  });
  table.appendChild(totalRow);

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  scroll.appendChild(table);
  resultsBox.appendChild(scroll);

  if (report.billsOfLading !== null) {
    const bills = document.createElement('p');
    bills.textContent = `Feeder Bill of Lading - ${report.billsOfLading} sets`;
    resultsBox.appendChild(bills);
  }

  renderStats(report);
  summaryBox.hidden = false;
}

async function handleBuildClick() {
  clearError();
  hideSummary();

  const version = setVersion;
  const buildLabel = buildBtn.textContent;
  busy = true;
  buildBtn.textContent = 'Строю отчёт…';
  updateUi();
  try {
    const workbooks = [];
    for (const entry of entries) {
      workbooks.push(await loadWorkbook(entry.file));
    }

    const result = buildGrandTotalData(workbooks);
    if (version !== setVersion) return; // пока считали, набор файлов поменяли — результат уже не тот
    if (!result.ok) {
      showError(result.error);
      return;
    }

    lastReport = result;
    renderResults(result);
    Shell.setResultShown(true);
  } catch (err) {
    if (version === setVersion) showError(err.message);
  } finally {
    busy = false;
    buildBtn.textContent = buildLabel;
    updateUi();
  }
}

// Позывной, дата прибытия и терминал — не в манифесте: пустое поле здесь
// означает пустое место в шапке готового PDF, а не просто пропуск в
// предпросмотре. Молча скачивать такой файл — то же самое, что делает
// содержательным всё требование о ручном вводе.
function validateManualFields() {
  if (!callSignInput.value.trim()) return 'Впишите позывной судна.';
  if (!arrivalDateInput.value.trim()) return 'Впишите дату прибытия.';
  if (!terminalInput.value.trim()) return 'Впишите терминал выгрузки.';
  return null;
}

const PAGE_WIDTH = 842; // A4 альбомная, пункты
const PAGE_HEIGHT = 595;
const MARGIN = 40;
const ROW_HEIGHT = 20;
const FONT_SIZE = 10;
const COLUMN_PADDING = 28; // отступ по бокам внутри колонки, с каждой стороны — половина

function centeredX(text, font, size, columnX, columnWidth) {
  const width = font.widthOfTextAtSize(text, size);
  return columnX + (columnWidth - width) / 2;
}

// Ширина колонки — по самому широкому содержимому (заголовок или любая
// строка данных), а не подобранными на глаз числами: как в эталоне, где
// колонка «TOTAL TARE WEIGHT» у'же «TOTAL ALL (TARE + CARGO)» ровно настолько,
// насколько короче их текст.
function computeColumnWidths(font, bold, header, dataRows, totalRow) {
  return header.map((headText, i) => {
    let width = bold.widthOfTextAtSize(headText, FONT_SIZE);
    dataRows.forEach((row) => {
      width = Math.max(width, font.widthOfTextAtSize(row[i], FONT_SIZE));
    });
    width = Math.max(width, bold.widthOfTextAtSize(totalRow[i], FONT_SIZE));
    return width + COLUMN_PADDING;
  });
}

// Стандартные 14 шрифтов PDF (Helvetica и подобные) — WinAnsi-кодировка,
// в ней нет кириллицы вовсе: попытка нарисовать «ВЫГРУЗКА» (как в эталоне)
// или кириллический терминал бросает исключение прямо внутри pdf-lib
// (обнаружено на реальном файле при проверке — не отдельная гипотеза).
// Поэтому здесь шрифт не берётся из PDFLib.StandardFonts, а грузится с
// Google Fonts (статические версионированные URL — Google не меняет и не
// удаляет их задним числом, в отличие от динамических /l/font?kit=...) и
// встраивается через fontkit (pdf-lib этого без него не умеет), с
// subset:true — pdf-lib сам обрезает встроенный шрифт до реально
// использованных на странице символов.
//
// Не через Google Fonts CSS API с text=<нужные символы> (что отдало бы уже
// урезанный на сервере файл): тот woff2 с этой же парой pdf-lib 1.17.1 +
// fontkit 1.1.1 либо зависает на doc.save() без ошибки и без таймаута, либо
// (при subset:false, в обход зависания) даёт неверную раскладку глифов —
// текст в PDF читается как случайный набор символов. Оба обнаружены при
// проверке в браузере на реальном файле. Обычный статический .ttf с тем же
// шрифтом обеих проблем не имеет.
const ROBOTO_REGULAR_URL =
  'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWubEbWmT.ttf';
const ROBOTO_BOLD_URL =
  'https://fonts.gstatic.com/s/roboto/v51/KFOMCnqEu92Fr1ME7kSn66aGLdTylUAMQXC89YmC2DPNWuYjammT.ttf';

async function loadFont(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Не удалось загрузить шрифт для PDF');
  return resp.arrayBuffer();
}

async function buildPdf(report, manualFields) {
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);

  const [regularBytes, boldBytes] = await Promise.all([loadFont(ROBOTO_REGULAR_URL), loadFont(ROBOTO_BOLD_URL)]);
  const font = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function drawHeaderField(x, label, value) {
    page.drawText(label, { x, y, size: FONT_SIZE, font: bold });
    const labelWidth = bold.widthOfTextAtSize(label, FONT_SIZE);
    page.drawText(value, { x: x + labelWidth + 4, y, size: FONT_SIZE, font });
    return x + labelWidth + 4 + font.widthOfTextAtSize(value, FONT_SIZE) + 24;
  }

  let x = MARGIN;
  x = drawHeaderField(x, 'VESSEL: ', report.vessel || '');
  x = drawHeaderField(x, 'VOYAGE: ', report.voyage || '');
  x = drawHeaderField(x, 'ARRIVAL DATE: ', manualFields.arrivalDate);
  x = drawHeaderField(x, 'CALL SIGN: ', manualFields.callSign);
  drawHeaderField(x, 'TERMINAL: ', manualFields.terminal);

  y -= 36;
  page.drawText('GRAND TOTAL:', { x: MARGIN, y, size: 16, font: bold });
  y -= 30;

  const { header, dataRows, totalRow } = buildTableRows(report);
  const columnWidths = computeColumnWidths(font, bold, header, dataRows, totalRow);

  const tableLeft = MARGIN;
  const tableWidth = columnWidths.reduce((a, b) => a + b, 0);
  const columnX = [tableLeft];
  for (let i = 1; i < columnWidths.length; i++) columnX.push(columnX[i - 1] + columnWidths[i - 1]);

  function drawLine(atY) {
    page.drawLine({
      start: { x: tableLeft, y: atY },
      end: { x: tableLeft + tableWidth, y: atY },
      thickness: 0.75,
      color: PDFLib.rgb(0.4, 0.4, 0.4),
    });
  }

  // Линия — только под шапкой колонок и вокруг строки TOTAL (одна перед ней,
  // одна под ней), как в эталоне. Между самими строками данных линий нет.
  function drawRow(cells, { rowFont = font } = {}) {
    cells.forEach((text, i) => {
      page.drawText(text, { x: centeredX(text, rowFont, FONT_SIZE, columnX[i], columnWidths[i]), y, size: FONT_SIZE, font: rowFont });
    });
    y -= ROW_HEIGHT;
  }

  function ensureSpace() {
    if (y > MARGIN + ROW_HEIGHT * 2) return;
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawRow(header, { rowFont: bold });
    drawLine(y + ROW_HEIGHT - 6);
  }

  drawRow(header, { rowFont: bold });
  drawLine(y + ROW_HEIGHT - 6);

  dataRows.forEach((cells) => {
    ensureSpace();
    drawRow(cells);
  });

  ensureSpace();
  drawLine(y + ROW_HEIGHT - 6);
  drawRow(totalRow, { rowFont: bold });
  drawLine(y + ROW_HEIGHT - 6);

  y -= 16;
  if (report.billsOfLading !== null) {
    page.drawText(`Feeder Bill of Lading - ${report.billsOfLading} sets`, { x: MARGIN, y, size: FONT_SIZE, font });
    y -= 24;
  }
  page.drawText(`ВЫГРУЗКА ${manualFields.arrivalDate}`, { x: MARGIN, y, size: 12, font: bold });

  return doc.save();
}

function sanitizeFileNamePart(text) {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildFileNameBase(report) {
  const voyagePart = report.voyage ? sanitizeFileNamePart(report.voyage) : '';
  return voyagePart ? `grand-total-${voyagePart}` : 'grand-total-report';
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Позывной, дата прибытия и терминал нужны обеим выгрузкам (PDF и Excel
// показывают их в одной и той же шапке) — единая проверка на оба случая.
function getValidatedManualFields() {
  const missing = validateManualFields();
  if (missing) {
    showError(missing);
    return null;
  }
  clearError();
  return {
    callSign: callSignInput.value.trim(),
    arrivalDate: arrivalDateInput.value.trim(),
    terminal: terminalInput.value.trim(),
  };
}

async function handleDownloadClick() {
  if (!lastReport) return;
  const manualFields = getValidatedManualFields();
  if (!manualFields) return;

  // Сборка PDF грузит шрифт с Google Fonts (сеть) — не мгновенно, как
  // остальные скачивания на сайте; без индикации повторный клик выглядел бы
  // как «ничего не произошло».
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Собираю PDF…';

  let bytes;
  try {
    bytes = await buildPdf(lastReport, manualFields);
  } catch (err) {
    showError(`Не удалось собрать PDF: ${err.message}`);
    return;
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = 'Скачать PDF';
  }

  downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${buildFileNameBase(lastReport)}.pdf`);
}

// Ширина колонки Excel-листа — в символах (единица ExcelJS), не в пунктах:
// тот же приём, что и в PDF (computeColumnWidths) — по самому широкому
// содержимому колонки, включая заголовок и строку TOTAL.
function computeExcelColumnWidths(header, dataRows, totalRow) {
  return header.map((headText, i) => {
    let width = headText.length;
    dataRows.forEach((row) => {
      width = Math.max(width, row[i].length);
    });
    width = Math.max(width, totalRow[i].length);
    return width + 4;
  });
}

const WEIGHT_NUMFMT = '#,##0.000" KGS"';

// В отличие от buildTableRows (общей для PDF и предпросмотра, где веса —
// уже готовый текст «8 692 506,220 KGS»), здесь колонки веса — настоящие
// числа: только тогда лист остаётся таблицей, с которой можно считать,
// а не картинкой из текста с цифрами. Вид того же текста в ячейке даёт
// numFmt (WEIGHT_NUMFMT), а не forматирование строки заранее.
function buildExcelRows(report) {
  const dataRows = report.byType.map((entry) => [
    formatTypeCount(entry),
    entry.cargoWeight,
    entry.tareWeight,
    entry.totalWeight,
  ]);
  const totalRow = ['TOTAL:', report.grandTotal.cargoWeight, report.grandTotal.tareWeight, report.grandTotal.totalWeight];
  return { header: TABLE_COLUMNS, dataRows, totalRow };
}

// Пять полей шапки — в один ряд (label, value, label, value, ...), как в
// PDF (VESSEL/VOYAGE/ARRIVAL DATE/CALL SIGN/TERMINAL на одной строке), а не
// пятью отдельными строками друг под другом: расхождение с формой PDF и
// эталона (reference.md) — реальная жалоба пользователя на прошлую версию.
function buildHeaderFields(report, manualFields) {
  return [
    ['VESSEL:', report.vessel || ''],
    ['VOYAGE:', report.voyage || ''],
    ['ARRIVAL DATE:', manualFields.arrivalDate],
    ['CALL SIGN:', manualFields.callSign],
    ['TERMINAL:', manualFields.terminal],
  ];
}

// Отступ после значения поля — не самостоятельная колонка-разделитель (она
// осталась бы пустой и путала бы навигацию по листу), а запас в ширине
// самой колонки со значением, как визуальный зазор перед следующим label —
// того же смысла, что +24pt между полями в drawHeaderField() PDF-версии.
const HEADER_FIELD_GAP = 3;

async function buildExcelWorkbook(report, manualFields) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Grand Total');

  const headerFields = buildHeaderFields(report, manualFields);
  const { header, dataRows, totalRow } = buildExcelRows(report);
  // Ширины колонок — по тексту, который реально будет виден (число через
  // тот же WEIGHT_NUMFMT, что применён к самой ячейке), а не по длине числа
  // как такового — иначе колонка веса окажется у'же, чем нужно для « KGS».
  const asDisplayedRows = dataRows.map((row) => [row[0], formatWeight(row[1]), formatWeight(row[2]), formatWeight(row[3])]);
  const asDisplayedTotal = [totalRow[0], formatWeight(totalRow[1]), formatWeight(totalRow[2]), formatWeight(totalRow[3])];
  const tableWidths = computeExcelColumnWidths(header, asDisplayedRows, asDisplayedTotal);
  // Строка шапки шире таблицы (10 колонок против 4) — итоговая ширина
  // колонки берётся по большему из двух требований, колонка за колонкой,
  // а не как два независимых листа ширин.
  const headerWidths = headerFields.flatMap(([label, value]) => [label.length + 2, value.length + HEADER_FIELD_GAP]);
  const columnCount = Math.max(tableWidths.length, headerWidths.length);
  const columns = [];
  for (let i = 0; i < columnCount; i++) {
    columns.push({ width: Math.max(tableWidths[i] || 0, headerWidths[i] || 0) });
  }
  sheet.columns = columns;

  const headerRow = sheet.addRow([]);
  headerFields.forEach(([label, value], i) => {
    const labelCell = headerRow.getCell(i * 2 + 1);
    labelCell.value = label;
    labelCell.font = { bold: true };
    headerRow.getCell(i * 2 + 2).value = value;
  });
  sheet.addRow([]);

  const titleRow = sheet.addRow(['GRAND TOTAL:']);
  titleRow.getCell(1).font = { bold: true, size: 16 };
  sheet.addRow([]);

  sheet.addRow(header);
  sheet.lastRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
    cell.border = { bottom: { style: 'thin' } };
  });

  // Без принудительного center: строки данных и итог — как в исходном файле
  // пользователя (GQDE 2601E_total PLP.xlsx, лист Total) — там выравнивание
  // ячеек нигде не выставлено явно, обычное поведение Excel по умолчанию
  // (текст слева, числа справа). Явный center оставлен только у шапки
  // колонок (`header`) чуть ниже — она подписи, а не данные.
  dataRows.forEach((cells) => {
    sheet.addRow(cells);
    sheet.lastRow.eachCell((cell, colNumber) => {
      if (colNumber > 1) cell.numFmt = WEIGHT_NUMFMT;
    });
  });

  sheet.addRow(totalRow);
  sheet.lastRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' } };
    if (colNumber > 1) cell.numFmt = WEIGHT_NUMFMT;
  });

  if (report.billsOfLading !== null) {
    sheet.addRow([`Feeder Bill of Lading - ${report.billsOfLading} sets`]);
  }
  sheet.addRow([]);

  const dischargeRow = sheet.addRow([`ВЫГРУЗКА ${manualFields.arrivalDate}`]);
  dischargeRow.getCell(1).font = { bold: true, size: 12 };

  return workbook.xlsx.writeBuffer();
}

async function handleDownloadExcelClick() {
  if (!lastReport) return;
  const manualFields = getValidatedManualFields();
  if (!manualFields) return;

  const buffer = await buildExcelWorkbook(lastReport, manualFields);
  downloadBlob(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${buildFileNameBase(lastReport)}.xlsx`,
  );
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

pickFilesBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    addFiles(fileInput.files);
  }
  fileInput.value = '';
});

dropzone.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dropzone.classList.add('dropzone--active');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('dropzone--active');
});

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dropzone--active');
  if (event.dataTransfer && event.dataTransfer.files.length) {
    addFiles(event.dataTransfer.files);
  }
});

buildBtn.addEventListener('click', handleBuildClick);
downloadBtn.addEventListener('click', handleDownloadClick);
downloadExcelBtn.addEventListener('click', handleDownloadExcelClick);

renderFileList();
updateUi();
