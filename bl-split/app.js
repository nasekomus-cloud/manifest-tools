// Состояние страницы «Разделить коносаменты»: выбор файла, извлечение текста
// страниц (pdf.js), нарезка PDF по группам (pdf-lib), сборка zip-архива
// (JSZip) и скачивание. Логика разбиения на группы — дело core.js
// (extractBillGroups), которая ничего не знает ни про одну из трёх
// библиотек (см. interfaces.md).

import { extractBillGroups } from './core.js?v=202609062010';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFileBtn = document.getElementById('pick-file-btn');
const fileListEl = document.getElementById('file-list');
const splitBtn = document.getElementById('split-btn');
const errorBox = document.getElementById('error-box');
const warningsBox = document.getElementById('warnings-box');
const summaryBox = document.getElementById('summary-box');
const downloadBtn = document.getElementById('download-btn');

let selectedFile = null;
/** @type {Blob | null} */
let zipBlob = null;

function setFile(file) {
  selectedFile = file;
  fileListEl.innerHTML = '';
  if (file) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = file.name;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn';
    removeBtn.textContent = 'Убрать';
    removeBtn.addEventListener('click', () => setFile(null));
    li.appendChild(name);
    li.appendChild(removeBtn);
    fileListEl.appendChild(li);
  }
  splitBtn.disabled = !file;
  clearError();
  clearResults();
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
  summaryBox.innerHTML = '';
  summaryBox.hidden = true;
  downloadBtn.hidden = true;
  zipBlob = null;
}

function showWarnings(warnings) {
  warningsBox.innerHTML = '';
  if (!warnings.length) {
    warningsBox.hidden = true;
    return;
  }
  const list = document.createElement('ul');
  warnings.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  warningsBox.appendChild(list);
  warningsBox.hidden = false;
}

function showSummary(groups) {
  summaryBox.innerHTML = '';

  const heading = document.createElement('p');
  heading.textContent = `Коносаментов: ${groups.length}`;
  summaryBox.appendChild(heading);

  const table = document.createElement('table');
  const headerRow = document.createElement('tr');
  ['Файл', 'Страницы'].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  table.appendChild(headerRow);

  groups.forEach((g) => {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.textContent = g.fileName;
    const pagesCell = document.createElement('td');
    pagesCell.textContent = g.startPage === g.endPage ? `${g.startPage}` : `${g.startPage}–${g.endPage}`;
    row.appendChild(nameCell);
    row.appendChild(pagesCell);
    table.appendChild(row);
  });

  summaryBox.appendChild(table);
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
  splitBtn.disabled = true;
  splitBtn.textContent = 'Обрабатываю…';

  try {
    const pageTexts = await extractPageTexts(selectedFile);
    const result = extractBillGroups(pageTexts);

    if (!result.ok) {
      showError(result.error);
      return;
    }

    showWarnings(result.warnings);
    showSummary(result.groups);

    zipBlob = await buildZip(selectedFile, result.groups);
    downloadBtn.hidden = false;
  } catch (err) {
    showError(`Не удалось обработать файл «${selectedFile.name}»: ${err.message}`);
  } finally {
    splitBtn.disabled = !selectedFile;
    splitBtn.textContent = 'Разделить';
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

pickFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    setFile(fileInput.files[0]);
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
  const file = event.dataTransfer && event.dataTransfer.files[0];
  if (file) setFile(file);
});

splitBtn.addEventListener('click', handleSplitClick);
downloadBtn.addEventListener('click', handleDownloadClick);
