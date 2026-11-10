// Страница «Корректировка POL»: два файла, замена POL в первом по номеру
// контейнера из второго, скачивание исправленной книги.
// Вся логика — в core.js (correctPol); панель, шаги и полоса действия —
// общий каркас assets/shell.js. Разметка списка файлов, плиток и зон —
// по образцу dg-check/app.js.
//
// Шаг 1 — пока нет файла 1, 2 — пока нет результата, 3 — результат показан.
// Любое изменение файлов прячет устаревший результат.

import { correctPol, inspectPolFile } from './core.js?v=202611101000';
import { ensureWorkbookTheme } from '../lib/xlsx-safe-write.js?v=202611101000';

const Shell = window.Shell;

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

const targetInput = document.getElementById('target-input');
const sourceInput = document.getElementById('source-input');
const targetPickBtn = document.getElementById('target-pick-btn');
const sourcePickBtn = document.getElementById('source-pick-btn');
const targetDropzone = document.getElementById('target-dropzone');
const sourceDropzone = document.getElementById('source-dropzone');
const targetFileList = document.getElementById('target-file-list');
const sourceFileList = document.getElementById('source-file-list');
const correctBtn = document.getElementById('correct-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const tablesBox = document.getElementById('tables-box');
const warningsBox = document.getElementById('warnings-box');
const changesBox = document.getElementById('changes-box');

/**
 * entry: {file, status: 'probing'|'ready'|'error', sheets, rows, error}
 * @type {{target: object|null, source: object|null, resultWorkbook: any, resultFileName: string}}
 */
const state = { target: null, source: null, resultWorkbook: null, resultFileName: '' };
let busy = false;
let setVersion = 0; // растёт при каждом изменении файлов — результат старого набора не показываем

function entryLabel(entry) {
  if (!entry) return 'не выбран';
  if (entry.status === 'probing') return entry.file.name;
  if (entry.status === 'error') return entry.file.name;
  return rowsLabel(entry.rows);
}

function actionHintText(ready) {
  if (!state.target) return 'Добавьте файл 1';
  if (!state.source) return 'Добавьте файл 2';
  const failed = [state.target, state.source].find((entry) => entry.status === 'error');
  if (failed) return 'В файле не нашлась таблица — замените его';
  return ready ? null : 'Проверяю файлы…';
}

function updateUi() {
  const ready = Boolean(
    state.target && state.source
    && state.target.status === 'ready' && state.source.status === 'ready',
  );
  correctBtn.disabled = !ready || busy;
  Shell.setAction({
    info: state.target || state.source
      ? `Файл 1: ${entryLabel(state.target)} · Файл 2: ${entryLabel(state.source)}`
      : 'Файлы не выбраны',
    hint: actionHintText(ready),
  });
  Shell.setStep(state.resultWorkbook ? 3 : state.target ? 2 : 1);
}

function errorText(entry) {
  return entry.error || `Не удалось прочитать «${entry.file.name}» как .xlsx.`;
}

// Коротко о найденном в файле: имя листа, колонки, число строк.
function sheetsMeta(sheets) {
  if (sheets.length === 1) {
    const sheet = sheets[0];
    return `${sheet.name} · POL — ${sheet.polColumn} · контейнер — ${sheet.containerColumn} · ${rowsLabel(sheet.rows)}`;
  }
  const rows = sheets.reduce((sum, sheet) => sum + sheet.rows, 0);
  return `${sheets.length} ${Shell.plural(sheets.length, 'лист', 'листа', 'листов')} · POL — `
    + `${sheets.map((sheet) => sheet.polColumn).join(', ')} · ${rowsLabel(rows)}`;
}

// Подробно — уже в результате: по листу, строка заголовков и колонки.
function sheetsSummary(sheets) {
  return sheets
    .map((sheet) => `лист «${sheet.name}»: POL — столбец ${sheet.polColumn}, номер контейнера — столбец `
      + `${sheet.containerColumn}, данные с ${sheet.headerRow + 1}-й строки`)
    .join('; ');
}

function fileMeta(entry) {
  if (entry.status === 'probing') return { text: 'разбираю таблицу…', error: false };
  if (entry.status === 'error') return { text: errorText(entry), error: true };
  return { text: sheetsMeta(entry.sheets), error: false };
}

function renderFileRow(listEl, entry, onRemove) {
  listEl.innerHTML = '';
  if (!entry) return;

  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'file-list__name';
  name.textContent = entry.file.name;

  const meta = document.createElement('span');
  const { text, error } = fileMeta(entry);
  meta.className = error ? 'file-list__meta file-list__meta--error' : 'file-list__meta';
  meta.textContent = text;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-list__remove';
  removeBtn.textContent = '✕';
  removeBtn.setAttribute('aria-label', `Убрать файл ${entry.file.name}`);
  removeBtn.addEventListener('click', onRemove);

  li.append(name, meta, removeBtn);
  listEl.appendChild(li);
}

function renderFileLists() {
  renderFileRow(targetFileList, state.target, () => setTargetFile(null));
  renderFileRow(sourceFileList, state.source, () => setSourceFile(null));
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

async function loadWorkbook(file) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch (err) {
    throw new Error(`Не удалось прочитать файл «${file.name}»: ${err.message}`);
  }
  return workbook;
}

async function probe(entry) {
  try {
    const workbook = await loadWorkbook(entry.file);
    const info = inspectPolFile(workbook, entry.file.name);
    if (state.target !== entry && state.source !== entry) return; // файл уже убрали или заменили
    if (!info.ok) {
      entry.status = 'error';
      entry.error = info.error;
    } else {
      entry.status = 'ready';
      entry.sheets = info.sheets;
      entry.rows = info.sheets.reduce((sum, sheet) => sum + sheet.rows, 0);
    }
  } catch (err) {
    if (state.target !== entry && state.source !== entry) return;
    entry.status = 'error';
    entry.error = err.message;
  }
  renderFileLists();
  updateUi();
}

function setTargetFile(file) {
  state.target = file ? { file, status: 'probing' } : null;
  setChanged();
  if (state.target) probe(state.target);
}

function setSourceFile(file) {
  state.source = file ? { file, status: 'probing' } : null;
  setChanged();
  if (state.source) probe(state.source);
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
  tablesBox.innerHTML = '';
  warningsBox.hidden = true;
  warningsBox.innerHTML = '';
  changesBox.innerHTML = '';
  state.resultWorkbook = null;
  state.resultFileName = '';
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
  stat.append(valueEl, labelEl);
  resultStats.appendChild(stat);
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

setupDropzone(targetDropzone, targetInput, targetPickBtn, setTargetFile);
setupDropzone(sourceDropzone, sourceInput, sourcePickBtn, setSourceFile);

function appendCell(row, text, header = false) {
  const cell = document.createElement(header ? 'th' : 'td');
  cell.textContent = text;
  row.appendChild(cell);
}

function renderWarnings(warnings) {
  warningsBox.innerHTML = '';
  if (!warnings.length) {
    warningsBox.hidden = true;
    return;
  }
  for (const text of warnings) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    warningsBox.appendChild(paragraph);
  }
  warningsBox.hidden = false;
}

function renderChanges(changes, sheetCount) {
  changesBox.innerHTML = '';
  if (!changes.length) {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Заменять нечего: POL в файле 1 уже совпадают с файлом 2.';
    changesBox.appendChild(paragraph);
    return;
  }

  const heading = document.createElement('h3');
  heading.textContent = 'Заменённые POL';
  changesBox.appendChild(heading);

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  const headers = sheetCount > 1
    ? ['Лист', 'Строка', 'Контейнер', 'Было', 'Стало']
    : ['Строка', 'Контейнер', 'Было', 'Стало'];
  headers.forEach((text) => appendCell(headRow, text, true));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  const visible = changes.slice(0, 100);
  for (const change of visible) {
    const row = document.createElement('tr');
    const cells = sheetCount > 1
      ? [change.sheet, String(change.row), change.container, change.before || '—', change.after]
      : [String(change.row), change.container, change.before || '—', change.after];
    cells.forEach((text) => appendCell(row, text));
    body.appendChild(row);
  }
  table.appendChild(body);
  scroll.appendChild(table);
  changesBox.appendChild(scroll);

  if (changes.length > visible.length) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = `Показаны первые ${visible.length} замен из ${changes.length}. Все они есть в скачанном файле.`;
    changesBox.appendChild(note);
  }
}

function renderSummary(result) {
  const { summary } = result;
  resultStats.innerHTML = '';
  addStat(String(summary.changed), 'Заменено POL');
  addStat(String(summary.unchanged), 'Уже совпадали');
  addStat(String(summary.notFound.length), 'Не нашлось в файле 2');

  const line = document.createElement('p');
  line.className = 'hint';
  line.textContent = `${sheetsSummary(summary.sheets)}.`;
  tablesBox.innerHTML = '';
  tablesBox.appendChild(line);

  renderWarnings(result.warnings);
  renderChanges(result.changes, summary.sheets.length);
  summaryBox.hidden = false;
}

function resultFileName(fileName) {
  const base = /\.xlsx$/i.test(fileName) ? fileName.slice(0, -5) : fileName;
  return `POL_${base}.xlsx`;
}

correctBtn.addEventListener('click', async () => {
  if (!state.target || !state.source || busy) return;
  clearError();
  hideSummary();

  const version = setVersion;
  const label = correctBtn.textContent;
  busy = true;
  correctBtn.textContent = 'Заменяю…';
  updateUi();
  try {
    const [targetWb, sourceWb] = await Promise.all([
      loadWorkbook(state.target.file),
      loadWorkbook(state.source.file),
    ]);
    if (version !== setVersion) return; // пока читали, файлы поменяли — результат уже не тот

    const result = correctPol(
      { fileName: state.target.file.name, workbook: targetWb },
      { fileName: state.source.file.name, workbook: sourceWb },
    );
    if (!result.ok) {
      showError(result.error);
      return;
    }

    state.resultWorkbook = result.resultWorkbook;
    state.resultFileName = resultFileName(state.target.file.name);
    renderSummary(result);
    Shell.setResultShown(true);
  } catch (err) {
    if (version === setVersion) showError(err.message);
  } finally {
    busy = false;
    correctBtn.textContent = label;
    updateUi();
  }
});

downloadBtn.addEventListener('click', async () => {
  if (!state.resultWorkbook) return;
  clearError();
  try {
    ensureWorkbookTheme(state.resultWorkbook);
    const buffer = await state.resultWorkbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = state.resultFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(`Не удалось сохранить результат: ${err.message}`);
  }
});

renderFileLists();
updateUi();
