// Состояние страницы «Разделить коносаменты»: выбор файла, извлечение текста
// страниц (pdf.js), нарезка PDF по группам (pdf-lib), сборка zip-архива
// (JSZip) и скачивание. Логика разбиения на группы — дело core.js
// (extractBillGroups), которая ничего не знает ни про одну из трёх
// библиотек (см. interfaces.md). Панель, шаги и полоса действия — общий
// каркас assets/shell.js (window.Shell); разметка списка файлов и плиток — по
// образцу merge/app.js.
//
// Шаг 1 — файла нет, 2 — файл есть, 3 — показан результат; замена или
// удаление файла прячет устаревший результат.

import { extractBillGroups } from './core.js?v=202609062010';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const Shell = window.Shell;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFileBtn = document.getElementById('pick-file-btn');
const fileListEl = document.getElementById('file-list');
const splitBtn = document.getElementById('split-btn');
const errorBox = document.getElementById('error-box');
const warningsBox = document.getElementById('warnings-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const groupsTable = document.getElementById('groups-table');
const downloadBtn = document.getElementById('download-btn');

let selectedFile = null;
/** @type {Blob | null} */
let zipBlob = null;
let busy = false;
let setVersion = 0; // растёт при каждой смене файла — результат старого файла не показываем

function updateUi() {
  splitBtn.disabled = !selectedFile || busy;
  Shell.setAction({
    info: selectedFile ? `${selectedFile.name} · ${Shell.formatSize(selectedFile.size)}` : 'Файл не выбран',
    hint: selectedFile ? null : 'Сначала добавьте файл',
  });
  Shell.setStep(zipBlob ? 3 : selectedFile ? 2 : 1);
}

function renderFileList() {
  fileListEl.innerHTML = '';
  if (!selectedFile) return;

  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'file-list__name';
  name.textContent = selectedFile.name;

  const meta = document.createElement('span');
  meta.className = 'file-list__meta';
  meta.textContent = Shell.formatSize(selectedFile.size);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-list__remove';
  removeBtn.textContent = '✕';
  removeBtn.setAttribute('aria-label', `Убрать файл ${selectedFile.name}`);
  removeBtn.addEventListener('click', () => setFile(null));

  li.appendChild(name);
  li.appendChild(meta);
  li.appendChild(removeBtn);
  fileListEl.appendChild(li);
}

// Смена файла делает показанный результат устаревшим — прячем его, чтобы
// нельзя было скачать архив от другого файла.
function setFile(file) {
  selectedFile = file;
  setVersion++;
  clearError();
  clearResults();
  renderFileList();
  updateUi();
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
  warningsBox.innerHTML = '';
  warningsBox.hidden = true;
  resultStats.innerHTML = '';
  groupsTable.innerHTML = '';
  summaryBox.hidden = true;
  zipBlob = null;
  Shell.setResultShown(false);
}

function showWarnings(warnings) {
  warningsBox.innerHTML = '';
  if (!warnings.length) {
    warningsBox.hidden = true;
    return;
  }
  const heading = document.createElement('p');
  heading.textContent = 'Предупреждения:';
  warningsBox.appendChild(heading);
  const list = document.createElement('ul');
  warnings.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  warningsBox.appendChild(list);
  warningsBox.hidden = false;
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

// cells: Array<{text: string, className?: string}>
function appendRow(table, cells, { header = false } = {}) {
  const row = document.createElement('tr');
  cells.forEach(({ text, className }) => {
    const cell = document.createElement(header ? 'th' : 'td');
    cell.textContent = text;
    if (className) cell.className = className;
    row.appendChild(cell);
  });
  table.appendChild(row);
}

function showSummary(groups, warnings) {
  resultStats.innerHTML = '';
  addStat(String(groups.length), 'Коносаментов');
  if (warnings.length) {
    addStat(String(warnings.length), 'Предупреждений');
  }

  showWarnings(warnings);

  groupsTable.innerHTML = '';
  appendRow(groupsTable, [{ text: 'Файл' }, { text: 'Страницы', className: 'num' }], { header: true });
  groups.forEach((g) => {
    appendRow(groupsTable, [
      { text: g.fileName, className: 'mono' },
      { text: g.startPage === g.endPage ? `${g.startPage}` : `${g.startPage}–${g.endPage}`, className: 'num' },
    ]);
  });

  summaryBox.hidden = false;
}

async function extractPageTexts(file) {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    texts.push(content.items.map((item) => item.str).join(' '));
  }
  return texts;
}

async function buildZip(file, groups) {
  // Свежий ArrayBuffer, а не переиспользование того, что читал pdf.js: часть
  // сборок pdf.js передаёт буфер во внутренний воркер с переносом владения
  // (transferable) и он становится непригоден для повторного чтения.
  const buffer = await file.arrayBuffer();
  const sourceDoc = await PDFLib.PDFDocument.load(buffer);

  const zip = new JSZip();
  for (const group of groups) {
    const indices = [];
    for (let p = group.startPage - 1; p <= group.endPage - 1; p++) indices.push(p);

    const newDoc = await PDFLib.PDFDocument.create();
    const copiedPages = await newDoc.copyPages(sourceDoc, indices);
    copiedPages.forEach((page) => newDoc.addPage(page));

    const bytes = await newDoc.save();
    zip.file(group.fileName, bytes);
  }

  return zip.generateAsync({ type: 'blob' });
}

async function handleSplitClick() {
  if (!selectedFile) return;

  clearError();
  clearResults();

  const file = selectedFile;
  const version = setVersion;
  const splitLabel = splitBtn.textContent;
  busy = true;
  splitBtn.textContent = 'Обрабатываю…';
  updateUi();

  try {
    const pageTexts = await extractPageTexts(file);
    const result = extractBillGroups(pageTexts);

    if (!result.ok) {
      if (version === setVersion) showError(result.error);
      return;
    }

    const blob = await buildZip(file, result.groups);
    if (version !== setVersion) return; // пока резали, файл поменяли — архив уже не тот

    zipBlob = blob;
    showSummary(result.groups, result.warnings);
    Shell.setResultShown(true);
  } catch (err) {
    if (version === setVersion) showError(`Не удалось обработать файл «${file.name}»: ${err.message}`);
  } finally {
    busy = false;
    splitBtn.textContent = splitLabel;
    updateUi();
  }
}

function handleDownloadClick() {
  if (!zipBlob || !selectedFile) return;

  const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName}-коносаменты.zip`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

pickFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    setFile(fileInput.files[0]);
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
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) setFile(file);
});

splitBtn.addEventListener('click', handleSplitClick);
downloadBtn.addEventListener('click', handleDownloadClick);

renderFileList();
updateUi();
