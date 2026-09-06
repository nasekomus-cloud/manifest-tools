// Состояние страницы «Дашборд по портам назначения»: выбранные файлы,
// рендер таблиц на странице и сборка/скачивание Excel-отчёта. Подсчёт
// разбивки — дело core.js (buildPortDashboard), сюда импортируется как
// обычный модуль (см. interfaces.md).

import { buildPortDashboard } from './core.js?v=202609061822';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');
const buildBtn = document.getElementById('build-btn');
const errorBox = document.getElementById('error-box');
const resultsBox = document.getElementById('results-box');
const downloadBtn = document.getElementById('download-btn');

const TABLE_COLUMNS = ['Порт назначения', 'Тип контейнера', 'Кол-во', 'Вес груза', 'Вес тары', 'Общий вес'];

/** @type {Array<{id: number, file: File}>} */
let entries = [];
let nextId = 1;
/** @type {{perFile: Array<{fileName: string, breakdown: object}>, combined: object} | null} */
let lastDashboard = null;

function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU');
}

function addRow(table, cells, { className, labelColspan } = {}) {
  const row = document.createElement('tr');
  if (className) row.className = className;

  cells.forEach((cell, i) => {
    const td = document.createElement('td');
    if (i === 0 && labelColspan) td.colSpan = labelColspan;
    if (cell instanceof Node) td.appendChild(cell);
    else td.textContent = String(cell);
    row.appendChild(td);
  });

  table.appendChild(row);
  return row;
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
  lastDashboard = null;
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

function renderBreakdownTable(breakdown) {
  const table = document.createElement('table');

  const headerRow = document.createElement('tr');
  TABLE_COLUMNS.forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  const maxPortWeight = breakdown.ports.reduce((max, p) => Math.max(max, p.totals.totalWeight), 0) || 1;

  breakdown.ports.forEach((port) => {
    port.types.forEach((type) => {
      addRow(table, [port.port, type.type, type.count, fmt(type.cargoWeight), fmt(type.tareWeight), fmt(type.totalWeight)]);
    });

    const barWrap = document.createElement('div');
    barWrap.className = 'port-bar';
    const barFill = document.createElement('div');
    barFill.className = 'port-bar__fill';
    barFill.style.width = `${Math.round((port.totals.totalWeight / maxPortWeight) * 100)}%`;
    barWrap.appendChild(barFill);

    const label = document.createElement('span');
    label.textContent = `Итого по порту «${port.port}»`;
    const labelCell = document.createElement('div');
    labelCell.appendChild(label);
    labelCell.appendChild(barWrap);

    addRow(
      table,
      [labelCell, port.totals.count, fmt(port.totals.cargoWeight), fmt(port.totals.tareWeight), fmt(port.totals.totalWeight)],
      { className: 'dashboard-row--port-total', labelColspan: 2 },
    );
  });

  addRow(
    table,
    ['Итого', breakdown.grandTotal.count, fmt(breakdown.grandTotal.cargoWeight), fmt(breakdown.grandTotal.tareWeight), fmt(breakdown.grandTotal.totalWeight)],
    { className: 'dashboard-row--grand-total', labelColspan: 2 },
  );

  return table;
}

function renderResults(dashboard) {
  resultsBox.innerHTML = '';

  dashboard.perFile.forEach(({ fileName, breakdown }) => {
    const section = document.createElement('section');
    section.className = 'dashboard-block';
    const heading = document.createElement('h2');
    heading.textContent = fileName;
    section.appendChild(heading);
    section.appendChild(renderBreakdownTable(breakdown));
    resultsBox.appendChild(section);
  });

  const totalSection = document.createElement('section');
  totalSection.className = 'dashboard-block';
  const totalHeading = document.createElement('h2');
  totalHeading.textContent = 'Итого по всем файлам';
  totalSection.appendChild(totalHeading);
  totalSection.appendChild(renderBreakdownTable(dashboard.combined));
  resultsBox.appendChild(totalSection);

  resultsBox.hidden = false;
}

function sanitizeSheetName(name, used) {
  let base = name.replace(/\.[^/.]+$/, '').replace(/[:\\/?*[\]]/g, '_').trim() || 'Лист';
  base = base.slice(0, 31);

  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(candidate);
  return candidate;
}

function writeBreakdownToSheet(sheet, breakdown) {
  sheet.addRow(TABLE_COLUMNS);
  breakdown.ports.forEach((port) => {
    port.types.forEach((type) => {
      sheet.addRow([port.port, type.type, type.count, type.cargoWeight, type.tareWeight, type.totalWeight]);
    });
    sheet.addRow([
      `Итого по порту «${port.port}»`,
      '',
      port.totals.count,
      port.totals.cargoWeight,
      port.totals.tareWeight,
      port.totals.totalWeight,
    ]);
  });
  sheet.addRow([
    'Итого',
    '',
    breakdown.grandTotal.count,
    breakdown.grandTotal.cargoWeight,
    breakdown.grandTotal.tareWeight,
    breakdown.grandTotal.totalWeight,
  ]);
}

function buildReportWorkbook(dashboard) {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set();

  dashboard.perFile.forEach(({ fileName, breakdown }) => {
    const sheet = workbook.addWorksheet(sanitizeSheetName(fileName, usedNames));
    writeBreakdownToSheet(sheet, breakdown);
  });

  const totalSheet = workbook.addWorksheet(sanitizeSheetName('Итого', usedNames));
  writeBreakdownToSheet(totalSheet, dashboard.combined);

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

    const result = buildPortDashboard(workbooks);
    if (!result.ok) {
      showError(result.error);
      return;
    }

    lastDashboard = result;
    renderResults(result);
    downloadBtn.hidden = false;
  } catch (err) {
    showError(err.message);
  } finally {
    buildBtn.disabled = entries.length === 0;
  }
}

async function handleDownloadClick() {
  if (!lastDashboard) return;

  const workbook = buildReportWorkbook(lastDashboard);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'дашборд-по-портам.xlsx';
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
