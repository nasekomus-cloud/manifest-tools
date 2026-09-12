// Состояние страницы «Сводный реестр поручений и коносаментов»: выбранные
// файлы, рендер таблицы-предпросмотра и сборка/скачивание Excel-реестра.
// Подсчёт пар — дело core.js (buildOrdersRegistry), сюда импортируется как
// обычный модуль (см. interfaces.md). Панель, шаги и полоса действия — общий
// каркас assets/shell.js (window.Shell); список файлов, плитки и полоса
// повторяют образец merge/app.js.

import { buildOrdersRegistry } from './core.js?v=202609122000';
import { readVoyageHeader, countDataRows } from '../lib/manifest-format.js?v=202609121930';

const Shell = window.Shell;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');
const buildBtn = document.getElementById('build-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const resultsBox = document.getElementById('results-box');
const downloadBtn = document.getElementById('download-btn');

const TABLE_COLUMNS = ['№№', '№ Поручения', '№ Коносамента'];

/**
 * rows: undefined — ещё считается; number — строк данных; null — файл не читается как манифест.
 * @type {Array<{id: number, file: File, rows: number|null|undefined}>}
 */
let entries = [];
let nextId = 1;
/** @type {{rows: Array<{order:string, bl:string}>, uniqueOrders: number, uniqueBillsOfLading: number, voyage: string|null} | null} */
let lastRegistry = null;
let busy = false;
let setVersion = 0; // растёт при каждом изменении набора — результат старого набора не показываем

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
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
  Shell.setStep(lastRegistry ? 3 : entries.length ? 2 : 1);
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
// прячем его, чтобы нельзя было скачать не то.
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
  lastRegistry = null;
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

// Плитки — только из того, что уже вернул buildOrdersRegistry.
function renderStats(registry) {
  resultStats.innerHTML = '';
  const pairs = registry.rows.length;
  addStat(String(pairs), Shell.plural(pairs, 'пара', 'пары', 'пар'));
  addStat(String(registry.uniqueOrders), 'уникальных поручений');
  addStat(String(registry.uniqueBillsOfLading), 'уникальных коносаментов');
}

function renderResults(registry) {
  resultsBox.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'data-table';
  const headerRow = document.createElement('tr');
  TABLE_COLUMNS.forEach((text, i) => {
    const th = document.createElement('th');
    th.textContent = text;
    if (i === 0) th.className = 'num';
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  registry.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    [String(i + 1), row.order, row.bl].forEach((text, col) => {
      const td = document.createElement('td');
      td.textContent = text;
      td.className = col === 0 ? 'num' : 'mono';
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  scroll.appendChild(table);
  resultsBox.appendChild(scroll);

  const summary = document.createElement('p');
  summary.textContent = `${registry.uniqueOrders} поручение, ${registry.uniqueBillsOfLading} коносаментов`;
  resultsBox.appendChild(summary);

  renderStats(registry);
  summaryBox.hidden = false;
}

// Ширина колонок — по самому широкому содержимому, включая итоговые строки
// («131 поручение» в колонке B часто длиннее любого номера поручения) —
// тот же приём, что и в grand-total/dashboard (computeExcelColumnWidths).
function computeColumnWidths(header, dataRows, footerRows) {
  return header.map((headText, i) => {
    let width = headText.length;
    dataRows.forEach((row) => {
      width = Math.max(width, String(row[i] ?? '').length);
    });
    footerRows.forEach((row) => {
      width = Math.max(width, String(row[i] ?? '').length);
    });
    return width + 4;
  });
}

const MEDIUM_BORDER = { style: 'medium' };
const THIN_BORDER = { style: 'thin' };

// Рамка вокруг шапки и данных — как в приложенном пользователем образце
// (проверено побайтово, см. reference.md): medium по внешнему периметру,
// thin между остальными ячейками внутри диапазона. Пустые и итоговые строки
// после таблицы — без рамки вовсе.
function applyTableBorder(sheet, firstRow, lastRow, firstCol, lastCol) {
  for (let r = firstRow; r <= lastRow; r++) {
    for (let c = firstCol; c <= lastCol; c++) {
      const cell = sheet.getRow(r).getCell(c);
      cell.border = {
        top: r === firstRow ? MEDIUM_BORDER : THIN_BORDER,
        bottom: r === lastRow ? MEDIUM_BORDER : THIN_BORDER,
        left: c === firstCol ? MEDIUM_BORDER : THIN_BORDER,
        right: c === lastCol ? MEDIUM_BORDER : THIN_BORDER,
      };
    }
  }
}

function buildRegistryWorkbook(registry) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Лист1');

  const dataRows = registry.rows.map((row, i) => [i + 1, row.order, row.bl]);
  const footerRows = [
    ['', `${registry.uniqueOrders} поручение`, ''],
    ['', `${registry.uniqueBillsOfLading} коносаментов`, ''],
  ];
  sheet.columns = computeColumnWidths(TABLE_COLUMNS, dataRows, footerRows).map((width) => ({ width }));

  sheet.addRow(TABLE_COLUMNS);
  dataRows.forEach((cells) => sheet.addRow(cells));

  const lastDataRow = 1 + dataRows.length;
  applyTableBorder(sheet, 1, lastDataRow, 1, TABLE_COLUMNS.length);

  sheet.addRow([]);
  sheet.addRow([]);
  footerRows.forEach((cells) => sheet.addRow(cells));

  return workbook;
}

async function handleBuildClick() {
  clearError();
  hideSummary();

  const version = setVersion;
  const buildLabel = buildBtn.textContent;
  busy = true;
  buildBtn.textContent = 'Строю реестр…';
  updateUi();
  try {
    const workbooks = [];
    for (const entry of entries) {
      workbooks.push(await loadWorkbook(entry.file));
    }

    const result = buildOrdersRegistry(workbooks);
    if (version !== setVersion) return; // пока считали, набор файлов поменяли — результат уже не тот
    if (!result.ok) {
      showError(result.error);
      return;
    }

    const voyage = workbooks.length ? readVoyageHeader(workbooks[0].workbook).voyage : null;
    lastRegistry = { ...result, voyage };
    renderResults(lastRegistry);
    Shell.setResultShown(true);
  } catch (err) {
    if (version === setVersion) showError(err.message);
  } finally {
    busy = false;
    buildBtn.textContent = buildLabel;
    updateUi();
  }
}

async function handleDownloadClick() {
  if (!lastRegistry) return;

  const workbook = buildRegistryWorkbook(lastRegistry);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = lastRegistry.voyage
    ? `реестр-поручений-и-коносаментов_${lastRegistry.voyage}.xlsx`
    : 'реестр-поручений-и-коносаментов.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
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

renderFileList();
updateUi();
