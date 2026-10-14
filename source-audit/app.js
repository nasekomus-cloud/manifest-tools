// Состояние страницы «Проверить исходный файл линии»: один .xlsx (у него —
// число строк с контейнером), вызов core.js, сводка по правилам, таблица
// находок и скачивание того же файла с пометками. Вся логика проверки — в
// core.js (auditSourceFile); панель, шаги и полоса действия — общий каркас
// assets/shell.js (window.Shell). Разметка списка файлов, плиток и зоны — по
// образцу source-check/app.js, таблица находок — как в template-check/app.js.
//
// Шаг 1 — пока нет файла, 2 — пока нет результата, 3 — результат показан;
// смена файла прячет устаревший результат.

import { auditSourceFile, countSourceRows, RULES } from './core.js?v=202610142200';

const Shell = window.Shell;

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

const sourceInput = document.getElementById('source-input');
const sourcePickBtn = document.getElementById('source-pick-btn');
const sourceDropzone = document.getElementById('source-dropzone');
const sourceFileList = document.getElementById('source-file-list');

const checkBtn = document.getElementById('check-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const voyageLine = document.getElementById('voyage-line');
const categoriesBox = document.getElementById('categories-box');
const findingsBox = document.getElementById('findings-box');

// rows: undefined — ещё считается; number — строк с контейнером; null — файл не читается.
const state = {
  /** @type {{file: File, rows: number|null|undefined}|null} */
  source: null,
  resultWorkbook: null,
  voyage: null,
};
let busy = false;
let setVersion = 0; // растёт при каждой смене файла — результат старого файла не показываем

function actionInfoText() {
  if (!state.source) return 'Файл не выбран';
  if (state.source.rows === undefined) return `${state.source.file.name} · считаю строки…`;
  if (state.source.rows === null) return state.source.file.name;
  return `${state.source.file.name} · ${rowsLabel(state.source.rows)}`;
}

function updateUi() {
  checkBtn.disabled = !state.source || busy;
  Shell.setAction({ info: actionInfoText(), hint: state.source ? null : 'Добавьте исходный файл' });
  Shell.setStep(state.resultWorkbook ? 3 : state.source ? 2 : 1);
}

function fileMeta(entry) {
  if (entry.rows === undefined) return { text: 'считаю строки…', error: false };
  if (entry.rows === null) {
    return { text: 'не похоже на исходный файл — нет заголовков «номер коносамента»/«номер контейнера»', error: true };
  }
  return { text: rowsLabel(entry.rows), error: false };
}

function fileRow(fileName, { text, error }, onRemove) {
  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'file-list__name';
  name.textContent = fileName;

  const meta = document.createElement('span');
  meta.className = error ? 'file-list__meta file-list__meta--error' : 'file-list__meta';
  meta.textContent = text;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-list__remove';
  removeBtn.textContent = '✕';
  removeBtn.setAttribute('aria-label', `Убрать файл ${fileName}`);
  removeBtn.addEventListener('click', onRemove);

  li.appendChild(name);
  li.appendChild(meta);
  li.appendChild(removeBtn);
  return li;
}

function renderFileList() {
  sourceFileList.innerHTML = '';
  if (state.source) {
    sourceFileList.appendChild(fileRow(state.source.file.name, fileMeta(state.source), () => setFile(null)));
  }
}

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
    rows = countSourceRows(workbook);
  } catch {
    rows = null; // не .xlsx или повреждён — скажем в списке, запуск не блокируем
  }
  if (state.source !== entry) return; // файл уже убрали или заменили
  entry.rows = rows;
  renderFileList();
  updateUi();
}

function setFile(file) {
  state.source = file ? { file, rows: undefined } : null;
  setChanged();
  if (state.source) countRows(state.source);
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
  voyageLine.hidden = true;
  voyageLine.textContent = '';
  categoriesBox.innerHTML = '';
  findingsBox.innerHTML = '';
  state.resultWorkbook = null;
  Shell.setResultShown(false);
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

sourceDropzone.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  sourceDropzone.classList.add('dropzone--active');
});
sourceDropzone.addEventListener('dragleave', () => {
  sourceDropzone.classList.remove('dropzone--active');
});
sourceDropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  sourceDropzone.classList.remove('dropzone--active');
  const files = event.dataTransfer && event.dataTransfer.files;
  if (files && files.length) setFile(files[0]);
});

sourcePickBtn.addEventListener('click', () => sourceInput.click());
sourceInput.addEventListener('change', () => {
  if (sourceInput.files.length) setFile(sourceInput.files[0]);
  sourceInput.value = '';
});

function addStat(value, label) {
  const stat = document.createElement('div');
  stat.className = 'stat';
  const valueEl = document.createElement('span');
  valueEl.className = 'stat__value';
  valueEl.textContent = String(value);
  const labelEl = document.createElement('span');
  labelEl.className = 'stat__label';
  labelEl.textContent = label;
  stat.appendChild(valueEl);
  stat.appendChild(labelEl);
  resultStats.appendChild(stat);
}

function appendRow(table, cells, { header = false } = {}) {
  const row = document.createElement('tr');
  cells.forEach((text) => {
    const cell = document.createElement(header ? 'th' : 'td');
    cell.textContent = text;
    row.appendChild(cell);
  });
  table.appendChild(row);
}

function renderResult(result) {
  const { summary, findings, header } = result;

  resultStats.innerHTML = '';
  addStat(summary.rows, 'Строк');
  addStat(summary.containers, 'Контейнеров');
  addStat(summary.billsOfLading, 'Коносаментов');
  addStat(summary.errors, 'Ошибок');
  addStat(summary.warnings, 'Проверить');

  const voyage = [
    header.vessel.length ? `Судно: ${header.vessel.join(', ')}` : '',
    header.voyage.length ? `рейс: ${header.voyage.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  voyageLine.textContent = voyage;
  voyageLine.hidden = !voyage;

  categoriesBox.innerHTML = '';
  const categories = RULES.filter(([key]) => summary.byRule[key]);
  if (categories.length) {
    const heading = document.createElement('h3');
    heading.textContent = 'Что найдено';
    categoriesBox.appendChild(heading);
    const list = document.createElement('ul');
    categories.forEach(([key, label]) => {
      const { errors, warnings } = summary.byRule[key];
      const parts = [];
      if (errors) parts.push(`ошибок ${errors}`);
      if (warnings) parts.push(`проверить ${warnings}`);
      const li = document.createElement('li');
      li.textContent = `${label}: ${parts.join(', ')}`;
      list.appendChild(li);
    });
    categoriesBox.appendChild(list);
  } else {
    const ok = document.createElement('p');
    ok.textContent = 'Ошибок не найдено — по файлу можно работать.';
    categoriesBox.appendChild(ok);
  }

  findingsBox.innerHTML = '';
  if (!findings.length) return;
  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';
  appendRow(table, ['Строка', 'Колонка', 'Контейнер', 'Что не так', 'Важность'], { header: true });
  findings.forEach((f) => {
    appendRow(table, [
      f.row ? String(f.row) : '—',
      f.column || '—',
      f.container || '—',
      f.message,
      f.level === 'error' ? 'ошибка' : 'проверить',
    ]);
  });
  scroll.appendChild(table);
  findingsBox.appendChild(scroll);
}

checkBtn.addEventListener('click', async () => {
  if (!state.source) return;
  clearError();
  hideSummary();

  const version = setVersion;
  const checkLabel = checkBtn.textContent;
  busy = true;
  checkBtn.textContent = 'Проверяю…';
  updateUi();
  try {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(await state.source.file.arrayBuffer());
    } catch (err) {
      throw new Error(`Не удалось прочитать «${state.source.file.name}»: ${err.message}`);
    }
    if (version !== setVersion) return; // пока читали, файл поменяли

    const result = auditSourceFile(workbook);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    state.resultWorkbook = result.resultWorkbook;
    state.voyage = result.header.voyage[result.header.voyage.length - 1] || null;
    renderResult(result);
    summaryBox.hidden = false;
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
  link.download = state.voyage ? `проверка-исходного_${state.voyage}.xlsx` : 'проверка-исходного.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

renderFileList();
updateUi();
