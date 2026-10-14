// Состояние страницы «Сверить манифест с исходным файлом»: исходный файл линии
// и манифест из системы (по одному .xlsx, у каждого — число строк), вызов
// core.js, скачивание манифеста системы со столбцом расхождений. Вся логика
// сверки — в core.js (crossCheckSource); панель, шаги и полоса действия —
// общий каркас assets/shell.js (window.Shell). Разметка списка файлов, плиток
// и зон — по образцу order-check/app.js.
//
// Шаг 1 — пока нет исходного файла, 2 — пока нет результата, 3 — результат
// показан; любое изменение файлов прячет устаревший результат.

import { crossCheckSource, readSourceManifest, FIELD_LABELS } from './core.js?v=202610141930';
import { countDataRows, readVoyageHeader } from '../lib/manifest-format.js?v=202609121930';

const Shell = window.Shell;

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

const sourceInput = document.getElementById('source-input');
const sourcePickBtn = document.getElementById('source-pick-btn');
const sourceDropzone = document.getElementById('source-dropzone');
const sourceFileList = document.getElementById('source-file-list');

const systemInput = document.getElementById('system-input');
const systemPickBtn = document.getElementById('system-pick-btn');
const systemDropzone = document.getElementById('system-dropzone');
const systemFileList = document.getElementById('system-file-list');

const checkBtn = document.getElementById('check-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const warningsBox = document.getElementById('warnings-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const categoriesBox = document.getElementById('categories-box');

// rows: undefined — ещё считается; number — строк данных; null — файл не читается.
const state = {
  /** @type {{file: File, rows: number|null|undefined}|null} */
  source: null,
  /** @type {{file: File, rows: number|null|undefined}|null} */
  system: null,
  resultWorkbook: null,
  voyage: null,
};
let busy = false;
let setVersion = 0; // растёт при каждом изменении файлов — результат старого набора не показываем

function fileInfo(entry) {
  if (!entry) return 'не выбран';
  if (entry.rows === undefined) return 'считаю строки…';
  if (entry.rows === null) return entry.file.name;
  return rowsLabel(entry.rows);
}

function actionInfoText() {
  if (!state.source && !state.system) return 'Файлы не выбраны';
  return `Исходный: ${fileInfo(state.source)} · Система: ${fileInfo(state.system)}`;
}

function actionHintText() {
  if (!state.source) return 'Добавьте исходный файл';
  if (!state.system) return 'Добавьте манифест из системы';
  return null;
}

function updateUi() {
  checkBtn.disabled = !(state.source && state.system) || busy;
  Shell.setAction({ info: actionInfoText(), hint: actionHintText() });
  Shell.setStep(state.resultWorkbook ? 3 : state.source ? 2 : 1);
}

function fileMeta(entry, errorText) {
  if (entry.rows === undefined) return { text: 'считаю строки…', error: false };
  if (entry.rows === null) return { text: errorText, error: true };
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

function renderFileLists() {
  sourceFileList.innerHTML = '';
  if (state.source) {
    sourceFileList.appendChild(
      fileRow(
        state.source.file.name,
        fileMeta(state.source, 'не похоже на исходный файл — нет заголовков «номер коносамента»/«номер контейнера»'),
        () => setFile('source', null),
      ),
    );
  }
  systemFileList.innerHTML = '';
  if (state.system) {
    systemFileList.appendChild(
      fileRow(
        state.system.file.name,
        fileMeta(state.system, 'не удалось прочитать — это точно .xlsx манифеста?'),
        () => setFile('system', null),
      ),
    );
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

// Число строк рядом с файлом: у манифеста системы — countDataRows (как на
// остальных страницах), у исходного — строки с номером контейнера.
async function countRows(kind, entry) {
  let rows = null;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await entry.file.arrayBuffer());
    if (kind === 'system') {
      rows = countDataRows(workbook);
    } else {
      const parsed = readSourceManifest(workbook);
      rows = parsed.ok ? parsed.rows.length : null;
    }
  } catch {
    rows = null; // не .xlsx или повреждён — скажем в списке, запуск не блокируем
  }
  if (state[kind] !== entry) return; // файл уже убрали или заменили
  entry.rows = rows;
  renderFileLists();
  updateUi();
}

function setFile(kind, file) {
  state[kind] = file ? { file, rows: undefined } : null;
  setChanged();
  if (state[kind]) countRows(kind, state[kind]);
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
  categoriesBox.innerHTML = '';
  warningsBox.hidden = true;
  warningsBox.innerHTML = '';
  state.resultWorkbook = null;
  Shell.setResultShown(false);
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

function setupDropzone(dropzone, onFiles) {
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
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
}

setupDropzone(sourceDropzone, (files) => setFile('source', files[0]));
setupDropzone(systemDropzone, (files) => setFile('system', files[0]));

sourcePickBtn.addEventListener('click', () => sourceInput.click());
systemPickBtn.addEventListener('click', () => systemInput.click());

sourceInput.addEventListener('change', () => {
  if (sourceInput.files.length) setFile('source', sourceInput.files[0]);
  sourceInput.value = '';
});

systemInput.addEventListener('change', () => {
  if (systemInput.files.length) setFile('system', systemInput.files[0]);
  systemInput.value = '';
});

async function loadWorkbook(file, label) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch (err) {
    throw new Error(`Не удалось прочитать ${label} «${file.name}»: ${err.message}`);
  }
  return workbook;
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

function renderSummary(summary) {
  resultStats.innerHTML = '';
  addStat(String(summary.totalRows), 'Строк проверено');
  addStat(String(summary.mismatchRows), 'С расхождениями');
  if (summary.notInSource) addStat(String(summary.notInSource), 'Нет в исходном');
  if (summary.missingInSystem.length) addStat(String(summary.missingInSystem.length), 'Нет в системе');

  categoriesBox.innerHTML = '';
  const categories = FIELD_LABELS.filter(([key]) => summary.byField[key]);
  if (summary.notInSource) categories.push(['notInSource', 'контейнера нет в исходном файле']);
  if (categories.length) {
    const heading = document.createElement('h3');
    heading.textContent = 'Расхождения по категориям';
    categoriesBox.appendChild(heading);

    const list = document.createElement('ul');
    categories.forEach(([key, label]) => {
      const li = document.createElement('li');
      li.textContent = `${label}: ${summary.byField[key] ?? summary[key]}`;
      list.appendChild(li);
    });
    categoriesBox.appendChild(list);
  } else if (!summary.missingInSystem.length) {
    const ok = document.createElement('p');
    ok.textContent = 'Расхождений не найдено — данные в системе совпадают с исходным файлом.';
    categoriesBox.appendChild(ok);
  }

  // Контейнеры исходного файла, которых нет в манифесте системы: строки под них
  // в манифесте нет — показываем списком здесь.
  warningsBox.innerHTML = '';
  if (summary.missingInSystem.length) {
    const heading = document.createElement('p');
    heading.textContent = 'Есть в исходном файле, но нет в манифесте системы:';
    warningsBox.appendChild(heading);
    const list = document.createElement('ul');
    summary.missingInSystem.forEach(({ container, billOfLading, row }) => {
      const li = document.createElement('li');
      li.textContent = `${container} — коносамент ${billOfLading || '—'} (строка ${row} исходного файла)`;
      list.appendChild(li);
    });
    warningsBox.appendChild(list);
    warningsBox.hidden = false;
  }

  summaryBox.hidden = false;
}

checkBtn.addEventListener('click', async () => {
  if (!state.source || !state.system) return;
  clearError();
  hideSummary();

  const version = setVersion;
  const checkLabel = checkBtn.textContent;
  busy = true;
  checkBtn.textContent = 'Сверяю…';
  updateUi();
  try {
    const sourceWb = await loadWorkbook(state.source.file, 'исходный файл');
    const systemWb = await loadWorkbook(state.system.file, 'манифест системы');
    if (version !== setVersion) return; // пока читали, файлы поменяли — результат уже не тот

    const result = crossCheckSource(sourceWb, systemWb);
    if (!result.ok) {
      showError(result.error);
      return;
    }

    state.resultWorkbook = result.resultWorkbook;
    state.voyage = readVoyageHeader(systemWb).voyage;
    renderSummary(result.summary);
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
  link.download = state.voyage ? `сверка-с-исходным_${state.voyage}.xlsx` : 'сверка-с-исходным.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

renderFileLists();
updateUi();
