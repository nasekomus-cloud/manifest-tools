// Состояние страницы «Сверить опасные грузы»: сводный файл (с числом строк),
// DG-манифест, работа с <input type=file>/drag-and-drop и скачивание результата.
// Вся логика сверки — в core.js (crossCheckDangerousGoods); панель, шаги и
// полоса действия — общий каркас assets/shell.js (window.Shell). Разметка
// списка файлов, плиток и зон — по образцу merge/app.js.
//
// Шаг 1 — пока нет сводного файла, 2 — пока нет результата, 3 — результат
// показан; любое изменение файлов прячет устаревший результат.

import { crossCheckDangerousGoods } from './core.js?v=202609122000';
import { countDataRows } from '../lib/manifest-format.js?v=202609121930';

const Shell = window.Shell;

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

const combinedInput = document.getElementById('combined-input');
const dgInput = document.getElementById('dg-input');
const combinedPickBtn = document.getElementById('combined-pick-btn');
const dgPickBtn = document.getElementById('dg-pick-btn');
const combinedDropzone = document.getElementById('combined-dropzone');
const dgDropzone = document.getElementById('dg-dropzone');
const combinedFileList = document.getElementById('combined-file-list');
const dgFileList = document.getElementById('dg-file-list');
const checkBtn = document.getElementById('check-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');

/**
 * combined.rows: undefined — ещё считается; number — строк данных; null — файл не читается как манифест.
 * @type {{combined: {file: File, rows: number|null|undefined}|null, dgFile: File|null, resultWorkbook: any}}
 */
const state = {
  combined: null,
  dgFile: null,
  resultWorkbook: null,
};
let busy = false;
let setVersion = 0; // растёт при каждом изменении файлов — результат старого набора не показываем

function combinedInfo() {
  if (!state.combined) return 'не выбран';
  const { rows } = state.combined;
  if (rows === undefined) return 'считаю строки…';
  if (rows === null) return state.combined.file.name;
  return rowsLabel(rows);
}

function actionInfoText() {
  if (!state.combined && !state.dgFile) return 'Файлы не выбраны';
  const dg = state.dgFile ? state.dgFile.name : 'не выбран';
  return `Сводный: ${combinedInfo()} · DG-манифест: ${dg}`;
}

function actionHintText() {
  if (!state.combined) return 'Добавьте сводный файл';
  if (!state.dgFile) return 'Добавьте DG-манифест';
  return null;
}

function updateUi() {
  checkBtn.disabled = !(state.combined && state.dgFile) || busy;
  Shell.setAction({ info: actionInfoText(), hint: actionHintText() });
  Shell.setStep(state.resultWorkbook ? 3 : state.combined ? 2 : 1);
}

function combinedMeta(entry) {
  if (entry.rows === undefined) return { text: 'считаю строки…', error: false };
  if (entry.rows === null) return { text: 'не удалось прочитать — это точно .xlsx манифеста?', error: true };
  return { text: rowsLabel(entry.rows), error: false };
}

function renderFileRow(listEl, file, { text, error }, onRemove) {
  listEl.innerHTML = '';
  if (!file) return;

  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'file-list__name';
  name.textContent = file.name;

  const meta = document.createElement('span');
  meta.className = error ? 'file-list__meta file-list__meta--error' : 'file-list__meta';
  meta.textContent = text;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-list__remove';
  removeBtn.textContent = '✕';
  removeBtn.setAttribute('aria-label', `Убрать файл ${file.name}`);
  removeBtn.addEventListener('click', onRemove);

  li.appendChild(name);
  li.appendChild(meta);
  li.appendChild(removeBtn);
  listEl.appendChild(li);
}

function renderFileLists() {
  if (state.combined) {
    renderFileRow(combinedFileList, state.combined.file, combinedMeta(state.combined), () => setCombinedFile(null));
  } else {
    combinedFileList.innerHTML = '';
  }
  if (state.dgFile) {
    renderFileRow(dgFileList, state.dgFile, { text: Shell.formatSize(state.dgFile.size), error: false }, () => setDgFile(null));
  } else {
    dgFileList.innerHTML = '';
  }
}

// Любое изменение файлов делает показанный результат устаревшим — прячем его,
// чтобы нельзя было скачать не то.
function setChanged() {
  setVersion++;
  clearError();
  hideSummary();
  renderFileLists();
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
  if (state.combined !== entry) return; // файл уже убрали или заменили
  entry.rows = rows;
  renderFileLists();
  updateUi();
}

function setCombinedFile(file) {
  state.combined = file ? { file, rows: undefined } : null;
  setChanged();
  if (state.combined) countRows(state.combined);
}

function setDgFile(file) {
  state.dgFile = file;
  setChanged();
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
  state.resultWorkbook = null;
  Shell.setResultShown(false);
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

function showSummary(summary) {
  resultStats.innerHTML = '';
  addStat(String(summary.mismatchCount), 'Строк с расхождениями');
  addStat(String(summary.notFoundInSummaryCount), 'Нет в сводном файле');
  summaryBox.hidden = false;
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

function setupDropzone(dropzone, input, pickBtn, onFile) {
  pickBtn.addEventListener('click', () => input.click());
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
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) onFile(file);
  });
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (file) onFile(file);
    input.value = '';
  });
}

setupDropzone(combinedDropzone, combinedInput, combinedPickBtn, setCombinedFile);
setupDropzone(dgDropzone, dgInput, dgPickBtn, setDgFile);

async function loadWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new Error(`Не удалось прочитать файл «${file.name}»: ${err.message}`);
  }
  return workbook;
}

checkBtn.addEventListener('click', async () => {
  if (!state.combined || !state.dgFile) return;
  clearError();
  hideSummary();

  const version = setVersion;
  const checkLabel = checkBtn.textContent;
  busy = true;
  checkBtn.textContent = 'Сверяю…';
  updateUi();
  try {
    const [combinedWb, dgWb] = await Promise.all([
      loadWorkbook(state.combined.file),
      loadWorkbook(state.dgFile),
    ]);

    const result = crossCheckDangerousGoods(combinedWb, dgWb);
    if (version !== setVersion) return; // пока сверяли, файлы поменяли — результат уже не тот
    if (!result.ok) {
      showError(result.error);
      return;
    }

    state.resultWorkbook = result.resultWorkbook;
    showSummary(result.summary);
    Shell.setResultShown(true);
  } catch (err) {
    if (version === setVersion) showError(err.message);
  } finally {
    busy = false;
    checkBtn.textContent = checkLabel;
    updateUi();
  }
});

downloadBtn.addEventListener('click', async () => {
  if (!state.resultWorkbook) return;
  const buffer = await state.resultWorkbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'сверка-опасные-грузы.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

renderFileLists();
updateUi();
