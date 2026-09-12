// Состояние страницы «Объединить манифесты»: выбранные файлы, их порядок,
// число строк у каждого, тумблер сквозной нумерации. Работа с <input type=file>,
// drag-and-drop и скачиванием блоба — вся DOM-логика живёт здесь. Считать книги
// и склеивать их — дело core.js (mergeManifests); панель, шаги и полоса
// действия — общий каркас assets/shell.js (window.Shell).
//
// Образец для остальных страниц инструментов: шаг 1 — файлы, 2 — файлы есть,
// 3 — показан результат; любое изменение набора файлов или параметра прячет
// устаревший результат.

import { mergeManifests } from './core.js?v=202609121930';
import { countDataRows } from '../lib/manifest-format.js?v=202609121930';

const Shell = window.Shell;
const SUMMARY_COLUMNS = 5; // Файл, Строк, Вес груза, Вес тары, Общий вес
const NOT_FOUND = 'колонка не найдена';

// Вручную, а не toLocaleString: тот же приём и тот же формат, что уже принят
// в grand-total/app.js для веса на этом сайте — сгруппированные по тысячам
// цифры, три знака после запятой, суффикс « KGS».
function formatWeight(n) {
  const [intPart, fracPart] = Math.abs(n).toFixed(3).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n < 0 ? '-' : ''}${grouped},${fracPart} KGS`;
}

function weightCells(weight) {
  if (!weight) return [NOT_FOUND, NOT_FOUND, NOT_FOUND];
  return [formatWeight(weight.cargoWeight), formatWeight(weight.tareWeight), formatWeight(weight.totalWeight)];
}

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');
const orderHint = document.getElementById('order-hint');
const renumberCheckbox = document.getElementById('renumber-checkbox');
const mergeBtn = document.getElementById('merge-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const summaryTable = document.getElementById('summary-table');
const duplicatesBox = document.getElementById('duplicates-box');
const downloadBtn = document.getElementById('download-btn');

/**
 * rows: undefined — ещё считается; number — строк данных; null — файл не читается как манифест.
 * @type {Array<{id: number, file: File, rows: number|null|undefined}>}
 */
let entries = [];
let nextId = 1;
let resultWorkbook = null;
let dragEntryId = null;
let busy = false;
let setVersion = 0; // растёт при каждом изменении набора — результат старого набора не показываем

function actionInfoText() {
  if (entries.length === 0) return 'Файлы не выбраны';
  const n = entries.length;
  const files = `${n} ${Shell.plural(n, 'файл', 'файла', 'файлов')}`;
  if (entries.some((e) => e.rows === undefined)) return `${files} · считаю строки…`;
  const total = entries.reduce((sum, e) => sum + (typeof e.rows === 'number' ? e.rows : 0), 0);
  return `${files} · ${rowsLabel(total)}`;
}

function updateUi() {
  mergeBtn.disabled = entries.length === 0 || busy;
  orderHint.hidden = entries.length < 2;
  Shell.setAction({
    info: actionInfoText(),
    hint: entries.length === 0 ? 'Сначала добавьте файлы' : null,
  });
  Shell.setStep(resultWorkbook ? 3 : entries.length ? 2 : 1);
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
    li.draggable = true;
    li.dataset.id = String(entry.id);

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

    li.addEventListener('dragstart', (event) => {
      dragEntryId = entry.id;
      li.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', entry.file.name); // без данных Firefox не начинает перетаскивание
      }
    });

    li.addEventListener('dragend', () => {
      dragEntryId = null;
      li.classList.remove('is-dragging');
    });

    li.addEventListener('dragover', (event) => {
      if (dragEntryId === null) return;
      event.preventDefault();
      li.classList.toggle('is-drop-target', dragEntryId !== entry.id);
    });

    li.addEventListener('dragleave', () => {
      li.classList.remove('is-drop-target');
    });

    li.addEventListener('drop', (event) => {
      event.preventDefault();
      li.classList.remove('is-drop-target');
      if (dragEntryId === null || dragEntryId === entry.id) return;

      const fromIndex = entries.findIndex((e) => e.id === dragEntryId);
      const toIndex = entries.findIndex((e) => e.id === entry.id);
      if (fromIndex === -1 || toIndex === -1) return;

      const [moved] = entries.splice(fromIndex, 1);
      entries.splice(toIndex, 0, moved);
      dragEntryId = null;
      setChanged();
    });
  });
}

// Любое изменение набора файлов или параметра делает показанный результат
// устаревшим — прячем его, чтобы нельзя было скачать не то.
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
  summaryTable.innerHTML = '';
  duplicatesBox.innerHTML = '';
  resultWorkbook = null;
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

function renderStats(summary) {
  resultStats.innerHTML = '';
  addStat(String(summary.totalRows), Shell.plural(summary.totalRows, 'строка', 'строки', 'строк'));
  if (summary.uniqueContainers !== null) {
    addStat(String(summary.uniqueContainers), 'уникальных контейнеров');
  }
  if (summary.weightTotals) {
    addStat(formatWeight(summary.weightTotals.cargoWeight), 'вес груза');
  }
}

// cells: Array<{text: string, className?: string, colSpan?: number}>
function appendRow(table, cells, { header = false, className = '' } = {}) {
  const row = document.createElement('tr');
  if (className) row.className = className;
  cells.forEach(({ text, className: cellClass, colSpan }) => {
    const cell = document.createElement(header ? 'th' : 'td');
    cell.textContent = text;
    if (cellClass) cell.className = cellClass;
    if (colSpan) cell.colSpan = colSpan;
    row.appendChild(cell);
  });
  table.appendChild(row);
}

function renderSummary(summary) {
  summaryTable.innerHTML = '';

  appendRow(
    summaryTable,
    [
      { text: 'Файл' },
      { text: 'Строк', className: 'num' },
      { text: 'Вес груза', className: 'num' },
      { text: 'Вес тары', className: 'num' },
      { text: 'Общий вес', className: 'num' },
    ],
    { header: true },
  );

  summary.files.forEach((file) => {
    appendRow(summaryTable, [
      { text: String(file.fileName) },
      { text: String(file.rows), className: 'num' },
      ...weightCells(file.weight).map((text) => ({ text, className: 'num' })),
    ]);
  });

  appendRow(
    summaryTable,
    [
      { text: 'Итого' },
      { text: String(summary.totalRows), className: 'num' },
      ...weightCells(summary.weightTotals).map((text) => ({ text, className: 'num' })),
    ],
    { className: 'is-total' },
  );

  addStatRow('Уникальных контейнеров', summary.uniqueContainers);
  addStatRow('Уникальных коносаментов', summary.uniqueBillsOfLading);

  renderStats(summary);
  renderDuplicateContainers(summary.duplicateContainers);

  summaryBox.hidden = false;
}

function addStatRow(label, value) {
  appendRow(summaryTable, [
    { text: label, colSpan: SUMMARY_COLUMNS - 1 },
    { text: value === null ? NOT_FOUND : String(value), className: 'num' },
  ]);
}

function renderDuplicateContainers(duplicateContainers) {
  duplicatesBox.innerHTML = '';
  if (duplicateContainers === null) return; // колонка «№ контейнера» не найдена — нечего показывать

  const heading = document.createElement('h3');
  heading.textContent = 'Неуникальные контейнеры';
  duplicatesBox.appendChild(heading);

  if (duplicateContainers.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'Повторов не найдено — все номера контейнеров уникальны.';
    duplicatesBox.appendChild(p);
    return;
  }

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';
  appendRow(table, [{ text: 'Контейнер' }, { text: 'Строки' }], { header: true });
  duplicateContainers.forEach(({ container, rows }) => {
    appendRow(table, [
      { text: container, className: 'mono' },
      { text: rows.join(', '), className: 'mono' },
    ]);
  });
  scroll.appendChild(table);
  duplicatesBox.appendChild(scroll);
}

async function handleMergeClick() {
  clearError();
  hideSummary();

  const version = setVersion;
  const mergeLabel = mergeBtn.textContent;
  busy = true;
  mergeBtn.textContent = 'Объединяю…';
  updateUi();
  try {
    const workbooks = [];
    for (const entry of entries) {
      workbooks.push(await loadWorkbook(entry.file));
    }

    const result = mergeManifests(workbooks, { renumber: renumberCheckbox.checked });
    if (version !== setVersion) return; // пока склеивали, набор файлов поменяли — результат уже не тот
    resultWorkbook = result.resultWorkbook;
    renderSummary(result.summary);
    Shell.setResultShown(true);
  } catch (err) {
    if (version === setVersion) showError(err.message);
  } finally {
    busy = false;
    mergeBtn.textContent = mergeLabel;
    updateUi();
  }
}

async function handleDownloadClick() {
  if (!resultWorkbook) return;

  const buffer = await resultWorkbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'merged-manifest.xlsx';
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
  if (!isFileDrag(event)) return; // перетаскивание строки списка — не сюда
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

renumberCheckbox.addEventListener('change', () => {
  // параметр поменялся — показанный результат собран с другим
  if (resultWorkbook) setChanged();
});

mergeBtn.addEventListener('click', handleMergeClick);
downloadBtn.addEventListener('click', handleDownloadClick);

renderFileList();
updateUi();
