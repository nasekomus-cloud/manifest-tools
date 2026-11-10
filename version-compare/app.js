import { compareVersions, versionDate } from './core.js?v=202611101000';
import { ensureWorkbookTheme } from '../lib/xlsx-safe-write.js?v=202611101000';

const Shell = window.Shell;
const input = document.getElementById('file-input');
const pickBtn = document.getElementById('pick-files-btn');
const dropzone = document.getElementById('dropzone');
const fileList = document.getElementById('file-list');
const compareBtn = document.getElementById('compare-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const warningsBox = document.getElementById('warnings-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const versionsBox = document.getElementById('versions-box');
const changesBox = document.getElementById('changes-box');

const state = { files: [], resultWorkbook: null, resultFileName: '' };
let busy = false;
let setVersion = 0;

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

function formatDate(date) {
  return date ? dateFormatter.format(date) : 'дата неизвестна';
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideSummary() {
  summaryBox.hidden = true;
  resultStats.innerHTML = '';
  versionsBox.innerHTML = '';
  changesBox.innerHTML = '';
  warningsBox.hidden = true;
  warningsBox.innerHTML = '';
  state.resultWorkbook = null;
  state.resultFileName = '';
  Shell.setResultShown(false);
}

function updateUi() {
  const ready = state.files.length === 2 && state.files.every((entry) => entry.status === 'ready');
  compareBtn.disabled = !ready || busy;
  Shell.setAction({
    info: state.files.length ? `Выбрано файлов: ${state.files.length} из 2` : 'Файлы не выбраны',
    hint: state.files.length < 2 ? 'Добавьте две версии одного файла' : null,
  });
  Shell.setStep(state.resultWorkbook ? 3 : state.files.length === 2 ? 2 : 1);
}

function fileRow(entry) {
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.className = 'file-list__name';
  name.textContent = entry.file.name;
  const meta = document.createElement('span');
  meta.className = entry.status === 'error' ? 'file-list__meta file-list__meta--error' : 'file-list__meta';
  meta.textContent = entry.status === 'loading'
    ? 'читаю дату изменения…'
    : entry.status === 'error' ? 'не удалось прочитать .xlsx' : `изменён: ${formatDate(entry.date)}`;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-list__remove';
  removeBtn.textContent = '✕';
  removeBtn.setAttribute('aria-label', `Убрать файл ${entry.file.name}`);
  removeBtn.addEventListener('click', () => {
    state.files = state.files.filter((item) => item !== entry);
    setChanged();
  });
  li.append(name, meta, removeBtn);
  return li;
}

function renderFileList() {
  fileList.innerHTML = '';
  for (const entry of state.files) fileList.appendChild(fileRow(entry));
}

function setChanged() {
  setVersion++;
  clearError();
  hideSummary();
  renderFileList();
  updateUi();
}

async function loadWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook;
}

async function readDate(entry) {
  try {
    const workbook = await loadWorkbook(entry.file);
    entry.date = versionDate({ workbook, lastModified: entry.file.lastModified });
    entry.status = 'ready';
  } catch {
    entry.status = 'error';
  }
  if (!state.files.includes(entry)) return;
  renderFileList();
  updateUi();
}

function addFiles(files) {
  const available = 2 - state.files.length;
  if (available <= 0) {
    showError('Уже выбраны два файла. Уберите один из них, чтобы добавить другой.');
    return;
  }
  const additions = Array.from(files).slice(0, available);
  for (const file of additions) {
    const entry = { file, status: 'loading', date: null };
    state.files.push(entry);
    readDate(entry);
  }
  setChanged();
  if (files.length > available) showError('Инструмент сравнивает ровно два файла. Лишние файлы не добавлены.');
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

dropzone.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dropzone.classList.add('dropzone--active');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dropzone--active'));
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('dropzone--active');
  if (event.dataTransfer?.files?.length) addFiles(event.dataTransfer.files);
});
pickBtn.addEventListener('click', () => input.click());
input.addEventListener('change', () => {
  if (input.files.length) addFiles(input.files);
  input.value = '';
});

function addStat(value, label) {
  const stat = document.createElement('div');
  stat.className = 'stat';
  const valueEl = document.createElement('span');
  valueEl.className = 'stat__value';
  valueEl.textContent = value;
  const labelEl = document.createElement('span');
  labelEl.className = 'stat__label';
  labelEl.textContent = label;
  stat.append(valueEl, labelEl);
  resultStats.appendChild(stat);
}

function appendVersion(label, fileName, date) {
  const paragraph = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}: `;
  paragraph.appendChild(strong);
  paragraph.appendChild(document.createTextNode(`${fileName} — ${formatDate(date)}`));
  versionsBox.appendChild(paragraph);
}

function appendCell(row, text, header = false) {
  const cell = document.createElement(header ? 'th' : 'td');
  cell.textContent = text;
  row.appendChild(cell);
}

function renderChanges(changes) {
  if (!changes.length) {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Изменений значений ячеек не найдено.';
    changesBox.appendChild(paragraph);
    return;
  }
  const heading = document.createElement('h3');
  heading.textContent = 'Изменённые ячейки';
  changesBox.appendChild(heading);
  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  ['Лист', 'Ячейка', 'Было', 'Стало'].forEach((text) => appendCell(headRow, text, true));
  head.appendChild(headRow);
  table.appendChild(head);
  const body = document.createElement('tbody');
  const visible = changes.slice(0, 100);
  for (const change of visible) {
    const row = document.createElement('tr');
    [change.sheet, change.cell, change.before, change.after].forEach((text) => appendCell(row, text));
    body.appendChild(row);
  }
  table.appendChild(body);
  scroll.appendChild(table);
  changesBox.appendChild(scroll);
  if (changes.length > visible.length) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Показаны первые ${visible.length} изменений из ${changes.length}. Все они отмечены в скачанном файле.`;
    changesBox.appendChild(note);
  }
}

function renderSummary(result) {
  const { summary } = result;
  addStat(String(summary.changedCells), Shell.plural(summary.changedCells, 'Изменённая ячейка', 'Изменённые ячейки', 'Изменённых ячеек'));
  addStat(String(summary.changedSheets), Shell.plural(summary.changedSheets, 'Лист с изменениями', 'Листа с изменениями', 'Листов с изменениями'));
  appendVersion('Новая версия', summary.newerFile, summary.newerDate);
  appendVersion('Старая версия', summary.olderFile, summary.olderDate);
  renderChanges(result.changes);

  const messages = [];
  if (summary.addedSheets.length) messages.push(`Листы, которых не было в старой версии: ${summary.addedSheets.join(', ')}. Их заполненные ячейки отмечены как новые.`);
  if (summary.removedSheets.length) messages.push(`Листы, удалённые из новой версии: ${summary.removedSheets.join(', ')}. В скачанном файле их нет.`);
  if (messages.length) {
    warningsBox.textContent = messages.join(' ');
    warningsBox.hidden = false;
  }
  summaryBox.hidden = false;
}

compareBtn.addEventListener('click', async () => {
  if (state.files.length !== 2 || busy) return;
  clearError();
  hideSummary();
  const version = setVersion;
  const label = compareBtn.textContent;
  busy = true;
  compareBtn.textContent = 'Сравниваю…';
  updateUi();
  try {
    const entries = await Promise.all(state.files.map(async (entry) => ({
      fileName: entry.file.name,
      lastModified: entry.file.lastModified,
      workbook: await loadWorkbook(entry.file),
    })));
    if (version !== setVersion) return;
    const result = compareVersions(entries[0], entries[1]);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    state.resultWorkbook = result.resultWorkbook;
    state.resultFileName = `изменения_${summaryName(result.summary.newerFile)}`;
    renderSummary(result);
    Shell.setResultShown(true);
  } catch (error) {
    if (version === setVersion) showError(`Не удалось сравнить файлы: ${error.message}`);
  } finally {
    busy = false;
    compareBtn.textContent = label;
    updateUi();
  }
});

function summaryName(fileName) {
  return /\.xlsx$/i.test(fileName) ? fileName : `${fileName}.xlsx`;
}

downloadBtn.addEventListener('click', async () => {
  if (!state.resultWorkbook) return;
  clearError();
  try {
    ensureWorkbookTheme(state.resultWorkbook);
    const buffer = await state.resultWorkbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.resultFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    showError(`Не удалось сохранить результат: ${error.message}`);
  }
});

renderFileList();
updateUi();
