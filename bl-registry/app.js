// Состояние страницы «Сводный реестр поручений и коносаментов»: выбранные
// файлы, рендер таблицы-предпросмотра и сборка/скачивание Excel-реестра.
// Подсчёт пар — дело core.js (buildOrdersRegistry), сюда импортируется как
// обычный модуль (см. interfaces.md).

import { buildOrdersRegistry } from './core.js?v=202609121301';
import { readVoyageHeader } from '../lib/manifest-format.js?v=202609121301';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');
const buildBtn = document.getElementById('build-btn');
const errorBox = document.getElementById('error-box');
const resultsBox = document.getElementById('results-box');
const downloadBtn = document.getElementById('download-btn');

const TABLE_COLUMNS = ['№№', '№ Поручения', '№ Коносамента'];

/** @type {Array<{id: number, file: File}>} */
let entries = [];
let nextId = 1;
/** @type {{rows: Array<{order:string, bl:string}>, uniqueOrders: number, uniqueBillsOfLading: number, voyage: string|null} | null} */
let lastRegistry = null;

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
  lastRegistry = null;
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

function renderResults(registry) {
  resultsBox.innerHTML = '';

  const table = document.createElement('table');
  const headerRow = document.createElement('tr');
  TABLE_COLUMNS.forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  registry.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    [String(i + 1), row.order, row.bl].forEach((text) => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  resultsBox.appendChild(table);

  const summary = document.createElement('p');
  summary.textContent = `${registry.uniqueOrders} поручение, ${registry.uniqueBillsOfLading} коносаментов`;
  resultsBox.appendChild(summary);

  resultsBox.hidden = false;
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
  clearResults();

  buildBtn.disabled = true;
  try {
    const workbooks = [];
    for (const entry of entries) {
      workbooks.push(await loadWorkbook(entry.file));
    }

    const result = buildOrdersRegistry(workbooks);
    if (!result.ok) {
      showError(result.error);
      return;
    }

    const voyage = workbooks.length ? readVoyageHeader(workbooks[0].workbook).voyage : null;
    lastRegistry = { ...result, voyage };
    renderResults(lastRegistry);
    downloadBtn.hidden = false;
  } catch (err) {
    showError(err.message);
  } finally {
    buildBtn.disabled = entries.length === 0;
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
