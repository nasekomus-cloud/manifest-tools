// Состояние страницы «Итоговый PDF-отчёт по манифесту»: выбор файлов, три
// поля ручного ввода (позывной, дата прибытия, терминал — в манифесте их нет
// ни в каком виде), предпросмотр на странице и сборка/скачивание PDF через
// pdf-lib. Подсчёт разбивки и судно/рейс — дело core.js (buildGrandTotalData),
// сюда импортируется как обычный модуль (см. interfaces.md).

import { buildGrandTotalData } from './core.js?v=202609062231';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');
const callSignInput = document.getElementById('call-sign-input');
const arrivalDateInput = document.getElementById('arrival-date-input');
const terminalInput = document.getElementById('terminal-input');
const buildBtn = document.getElementById('build-btn');
const errorBox = document.getElementById('error-box');
const resultsBox = document.getElementById('results-box');
const downloadBtn = document.getElementById('download-btn');

const TABLE_COLUMNS = [
  'TOTAL CONTAINER NUMBER',
  'TOTAL GROSS CARGO WEIGHT',
  'TOTAL TARE WEIGHT',
  'TOTAL ALL (TARE + CARGO)',
];

/** @type {Array<{id: number, file: File}>} */
let entries = [];
let nextId = 1;
/** @type {{vessel: string|null, voyage: string|null, byType: Array<object>, grandTotal: object, billsOfLading: number|null} | null} */
let lastReport = null;

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

function formatTypeCount(entry) {
  return `${entry.count}x${formatContainerType(entry.type)}`;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function clearResults() {
  resultsBox.innerHTML = '';
  resultsBox.hidden = true;
  downloadBtn.hidden = true;
  lastReport = null;
}

function renderFileList() {
  fileListEl.innerHTML = '';

  entries.forEach((entry) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = entry.file.name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn';
    removeBtn.textContent = 'Убрать';
    removeBtn.addEventListener('click', () => {
      entries = entries.filter((e) => e.id !== entry.id);
      onEntriesChanged();
    });

    li.appendChild(name);
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);
  });

  buildBtn.disabled = entries.length === 0;
}

function onEntriesChanged() {
  renderFileList();
  clearError();
  clearResults();
}

function addFiles(fileList) {
  Array.from(fileList).forEach((file) => {
    entries.push({ id: nextId++, file });
  });
  onEntriesChanged();
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

function renderResults(report) {
  resultsBox.innerHTML = '';

  const table = document.createElement('table');
  const headerRow = document.createElement('tr');
  TABLE_COLUMNS.forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  report.byType.forEach((entry) => {
    const row = document.createElement('tr');
    [formatTypeCount(entry), formatWeight(entry.cargoWeight), formatWeight(entry.tareWeight), formatWeight(entry.totalWeight)].forEach(
      (text) => {
        const td = document.createElement('td');
        td.textContent = text;
        row.appendChild(td);
      },
    );
    table.appendChild(row);
  });

  const totalRow = document.createElement('tr');
  totalRow.className = 'grand-total-row';
  ['TOTAL:', formatWeight(report.grandTotal.cargoWeight), formatWeight(report.grandTotal.tareWeight), formatWeight(report.grandTotal.totalWeight)].forEach(
    (text) => {
      const td = document.createElement('td');
      td.textContent = text;
      totalRow.appendChild(td);
    },
  );
  table.appendChild(totalRow);

  resultsBox.appendChild(table);

  if (report.billsOfLading !== null) {
    const bills = document.createElement('p');
    bills.textContent = `Feeder Bill of Lading - ${report.billsOfLading} sets`;
    resultsBox.appendChild(bills);
  }

  resultsBox.hidden = false;
}

async function handleBuildClick() {
  clearError();
  clearResults();

  buildBtn.disabled = true;
  try {
    const workbooks = [];
    for (const entry of entries) {
      workbooks.push(await loadWorkbook(entry.file));
    }

    const result = buildGrandTotalData(workbooks);
    if (!result.ok) {
      showError(result.error);
      return;
    }

    lastReport = result;
    renderResults(result);
    downloadBtn.hidden = false;
  } catch (err) {
    showError(err.message);
  } finally {
    buildBtn.disabled = entries.length === 0;
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
const COLUMN_WIDTHS = [200, 190, 190, 210];
const FONT_SIZE = 10;

function centeredX(text, font, size, columnX, columnWidth) {
  const width = font.widthOfTextAtSize(text, size);
  return columnX + (columnWidth - width) / 2;
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

  y -= 32;
  page.drawText('GRAND TOTAL:', { x: MARGIN, y, size: 14, font: bold });
  y -= 28;

  const tableLeft = MARGIN;
  const tableWidth = COLUMN_WIDTHS.reduce((a, b) => a + b, 0);
  const columnX = [tableLeft];
  for (let i = 1; i < COLUMN_WIDTHS.length; i++) columnX.push(columnX[i - 1] + COLUMN_WIDTHS[i - 1]);

  function drawRow(cells, { rowFont = font, drawLineBelow = true } = {}) {
    cells.forEach((text, i) => {
      page.drawText(text, { x: centeredX(text, rowFont, FONT_SIZE, columnX[i], COLUMN_WIDTHS[i]), y, size: FONT_SIZE, font: rowFont });
    });
    if (drawLineBelow) {
      page.drawLine({
        start: { x: tableLeft, y: y - 6 },
        end: { x: tableLeft + tableWidth, y: y - 6 },
        thickness: 0.75,
        color: PDFLib.rgb(0.6, 0.6, 0.6),
      });
    }
    y -= ROW_HEIGHT;
  }

  function ensureSpace() {
    if (y > MARGIN + ROW_HEIGHT * 2) return;
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    drawRow(TABLE_COLUMNS, { rowFont: bold });
  }

  drawRow(TABLE_COLUMNS, { rowFont: bold });
  report.byType.forEach((entry) => {
    ensureSpace();
    drawRow([formatTypeCount(entry), formatWeight(entry.cargoWeight), formatWeight(entry.tareWeight), formatWeight(entry.totalWeight)]);
  });

  ensureSpace();
  drawRow(
    ['TOTAL:', formatWeight(report.grandTotal.cargoWeight), formatWeight(report.grandTotal.tareWeight), formatWeight(report.grandTotal.totalWeight)],
    { rowFont: bold, drawLineBelow: true },
  );

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

async function handleDownloadClick() {
  if (!lastReport) return;

  const missing = validateManualFields();
  if (missing) {
    showError(missing);
    return;
  }
  clearError();

  const manualFields = {
    callSign: callSignInput.value.trim(),
    arrivalDate: arrivalDateInput.value.trim(),
    terminal: terminalInput.value.trim(),
  };

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

  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const voyagePart = lastReport.voyage ? sanitizeFileNamePart(lastReport.voyage) : '';
  const link = document.createElement('a');
  link.href = url;
  link.download = voyagePart ? `grand-total-${voyagePart}.pdf` : 'grand-total-report.pdf';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

pickFilesBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    addFiles(fileInput.files);
  }
  fileInput.value = '';
});

dropzone.addEventListener('dragover', (event) => {
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

renderFileList();
