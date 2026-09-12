// Состояние страницы «Дашборд по портам отправления»: выбранные файлы,
// рендер таблиц на странице и сборка/скачивание Excel-отчёта. Подсчёт
// разбивки — дело core.js (buildPortDashboard), сюда импортируется как
// обычный модуль (см. interfaces.md). Идентично dashboard/app.js — тот же
// инструмент, другая колонка-порт (см. lib/port-breakdown.js). Панель, шаги
// и полоса действия — общий
// каркас assets/shell.js (window.Shell); список файлов, плитки и полоса
// повторяют образец merge/app.js.

import { buildPortDashboard } from './core.js?v=202609111500';
import { countDataRows } from '../lib/manifest-format.js?v=202609121930';

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

const TABLE_COLUMNS = ['Порт отправления', 'Тип контейнера', 'Кол-во', 'Вес груза', 'Вес тары', 'Общий вес'];
const FIRST_NUMERIC_COLUMN = 2; // «Кол-во» и веса — справа, моноширинным

/**
 * rows: undefined — ещё считается; number — строк данных; null — файл не читается как манифест.
 * @type {Array<{id: number, file: File, rows: number|null|undefined}>}
 */
let entries = [];
let nextId = 1;
/** @type {{perFile: Array<{fileName: string, breakdown: object}>, combined: object} | null} */
let lastDashboard = null;
let busy = false;
let setVersion = 0; // растёт при каждом изменении набора — результат старого набора не показываем

function fmt(n) {
  return Math.round(n).toLocaleString('ru-RU');
}

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

// numFrom — индекс ячейки (в cells), с которой начинаются числа.
function addRow(table, cells, { className, labelColspan, numFrom } = {}) {
  const row = document.createElement('tr');
  if (className) row.className = className;

  cells.forEach((cell, i) => {
    const td = document.createElement('td');
    if (i === 0 && labelColspan) td.colSpan = labelColspan;
    if (numFrom !== undefined && i >= numFrom) td.className = 'num';
    if (cell instanceof Node) td.appendChild(cell);
    else td.textContent = String(cell);
    row.appendChild(td);
  });

  table.appendChild(row);
  return row;
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
  Shell.setStep(lastDashboard ? 3 : entries.length ? 2 : 1);
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
  lastDashboard = null;
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

// Плитки — по итогу всех файлов (combined), только из того, что уже вернул core.js.
function renderStats(combined) {
  resultStats.innerHTML = '';
  const ports = combined.ports.length;
  addStat(String(ports), Shell.plural(ports, 'порт', 'порта', 'портов'));
  const containers = combined.grandTotal.count;
  addStat(String(containers), Shell.plural(containers, 'контейнер', 'контейнера', 'контейнеров'));
  addStat(fmt(combined.grandTotal.totalWeight), 'общий вес, кг');
}

function renderBreakdownTable(breakdown) {
  const table = document.createElement('table');
  table.className = 'data-table';

  const headerRow = document.createElement('tr');
  TABLE_COLUMNS.forEach((text, i) => {
    const th = document.createElement('th');
    th.textContent = text;
    if (i >= FIRST_NUMERIC_COLUMN) th.className = 'num';
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  const maxPortWeight = breakdown.ports.reduce((max, p) => Math.max(max, p.totals.totalWeight), 0) || 1;

  breakdown.ports.forEach((port) => {
    port.types.forEach((type) => {
      addRow(
        table,
        [port.port, type.type, type.count, fmt(type.cargoWeight), fmt(type.tareWeight), fmt(type.totalWeight)],
        { numFrom: FIRST_NUMERIC_COLUMN },
      );
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
      { className: 'dashboard-row--port-total', labelColspan: 2, numFrom: 1 },
    );
  });

  addRow(
    table,
    ['Итого', breakdown.grandTotal.count, fmt(breakdown.grandTotal.cargoWeight), fmt(breakdown.grandTotal.tareWeight), fmt(breakdown.grandTotal.totalWeight)],
    { className: 'dashboard-row--grand-total', labelColspan: 2, numFrom: 1 },
  );

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  scroll.appendChild(table);
  return scroll;
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

  renderStats(dashboard.combined);
  summaryBox.hidden = false;
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
  hideSummary();

  const version = setVersion;
  const buildLabel = buildBtn.textContent;
  busy = true;
  buildBtn.textContent = 'Строю дашборд…';
  updateUi();
  try {
    const workbooks = [];
    for (const entry of entries) {
      workbooks.push(await loadWorkbook(entry.file));
    }

    const result = buildPortDashboard(workbooks);
    if (version !== setVersion) return; // пока считали, набор файлов поменяли — результат уже не тот
    if (!result.ok) {
      showError(result.error);
      return;
    }

    lastDashboard = result;
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
  link.download = 'дашборд-по-портам-отправления.xlsx';
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
