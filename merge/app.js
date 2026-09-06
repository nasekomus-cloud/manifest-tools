// Состояние страницы «Объединить манифесты»: выбранные файлы, их порядок,
// чекбокс сквозной нумерации. Работа с <input type=file>, drag-and-drop и
// скачиванием блоба — вся DOM-логика живёт здесь. Считать книги и склеивать
// их — дело core.js (mergeManifests), сюда импортируется как обычный модуль.

import { mergeManifests } from './core.js?v=202609061336';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');
const renumberCheckbox = document.getElementById('renumber-checkbox');
const mergeBtn = document.getElementById('merge-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const summaryTable = document.getElementById('summary-table');
const downloadBtn = document.getElementById('download-btn');

/** @type {Array<{id: number, file: File}>} */
let entries = [];
let nextId = 1;
let resultWorkbook = null;
let dragEntryId = null;

function renderFileList() {
  fileListEl.innerHTML = '';

  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.id = String(entry.id);

    const name = document.createElement('span');
    name.textContent = entry.file.name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn';
    removeBtn.textContent = 'Убрать';
    removeBtn.addEventListener('click', () => {
      entries = entries.filter((e) => e.id !== entry.id);
      renderFileList();
    });

    li.appendChild(name);
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);

    li.addEventListener('dragstart', () => {
      dragEntryId = entry.id;
    });

    li.addEventListener('dragover', (event) => {
      event.preventDefault();
    });

    li.addEventListener('drop', (event) => {
      event.preventDefault();
      if (dragEntryId === null || dragEntryId === entry.id) return;

      const fromIndex = entries.findIndex((e) => e.id === dragEntryId);
      const toIndex = entries.findIndex((e) => e.id === entry.id);
      if (fromIndex === -1 || toIndex === -1) return;

      const [moved] = entries.splice(fromIndex, 1);
      entries.splice(toIndex, 0, moved);
      dragEntryId = null;
      renderFileList();
    });
  });

  mergeBtn.disabled = entries.length === 0;
}

function addFiles(fileList) {
  Array.from(fileList).forEach((file) => {
    entries.push({ id: nextId++, file });
  });
  renderFileList();
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
  summaryTable.innerHTML = '';
  resultWorkbook = null;
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

function renderSummary(summary) {
  summaryTable.innerHTML = '';

  const headerRow = document.createElement('tr');
  ['Файл', 'Строк'].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  summaryTable.appendChild(headerRow);

  summary.files.forEach((file) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = file.fileName;
    const rowsCell = document.createElement('td');
    rowsCell.textContent = String(file.rows);
    row.appendChild(nameCell);
    row.appendChild(rowsCell);
    summaryTable.appendChild(row);
  });

  const totalRow = document.createElement('tr');
  const totalLabel = document.createElement('td');
  totalLabel.textContent = 'Итого';
  const totalValue = document.createElement('td');
  totalValue.textContent = String(summary.totalRows);
  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalValue);
  summaryTable.appendChild(totalRow);

  summaryBox.hidden = false;
}

async function handleMergeClick() {
  clearError();
  hideSummary();

  mergeBtn.disabled = true;
  try {
    const workbooks = [];
    for (const entry of entries) {
      workbooks.push(await loadWorkbook(entry.file));
    }

    const result = mergeManifests(workbooks, { renumber: renumberCheckbox.checked });
    resultWorkbook = result.resultWorkbook;
    renderSummary(result.summary);
  } catch (err) {
    showError(err.message);
  } finally {
    mergeBtn.disabled = entries.length === 0;
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

mergeBtn.addEventListener('click', handleMergeClick);
downloadBtn.addEventListener('click', handleDownloadClick);

renderFileList();
