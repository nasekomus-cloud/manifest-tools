// Состояние страницы «Файлы для загрузки в АРМ»: исходный файл линии, поля
// рейса и по полю на каждый порт погрузки (POL, терминал, дата коносамента,
// код в имени файла), сборка файлов через core.js и скачивание — по одному или
// архивом (JSZip, как в order-check). Вся логика — в core.js; панель, шаги и
// полоса действия — общий каркас assets/shell.js (window.Shell). Разметка
// списка файлов и зоны — по образцу source-check/app.js.
//
// Шаг 1 — пока нет файла, 2 — пока нет результата, 3 — файлы собраны; смена
// файла или любого поля прячет собранные файлы, чтобы не скачать устаревшие.

import { readSource, buildArmFiles, validateOptions } from './core.js?v=202610142330';

const Shell = window.Shell;

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

const sourceInput = document.getElementById('source-input');
const sourcePickBtn = document.getElementById('source-pick-btn');
const sourceDropzone = document.getElementById('source-dropzone');
const sourceFileList = document.getElementById('source-file-list');

const vesselInput = document.getElementById('vessel-input');
const voyageInput = document.getElementById('voyage-input');
const arrivalInput = document.getElementById('arrival-input');
const dischargeTerminalInput = document.getElementById('discharge-terminal-input');
const dischargeCodeInput = document.getElementById('discharge-code-input');
const portsSection = document.getElementById('ports-section');
const portsBox = document.getElementById('ports-box');

const buildBtn = document.getElementById('build-btn');
const downloadZipBtn = document.getElementById('download-zip-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const resultFileList = document.getElementById('result-file-list');

const state = {
  /** @type {File|null} */
  file: null,
  /** результат readSource: undefined — читается, null — не читается */
  source: null,
  /** @type {{code: string, inputs: Object<string, HTMLInputElement>}[]} */
  portInputs: [],
  /** @type {Array<{portCode, fileName, rows, containers, workbook}>|null} */
  files: null,
};
let busy = false;
let setVersion = 0; // растёт при каждой смене файла — результат старого файла не показываем

function currentOptions() {
  const ports = {};
  for (const { code, inputs } of state.portInputs) {
    ports[code] = {
      pol: inputs.pol.value.trim(),
      terminal: inputs.terminal.value.trim(),
      fileCode: inputs.fileCode.value.trim(),
      billDate: inputs.billDate.value,
    };
  }
  return {
    vessel: vesselInput.value.trim(),
    voyage: voyageInput.value.trim(),
    arrivalDate: arrivalInput.value,
    dischargeTerminal: dischargeTerminalInput.value.trim(),
    dischargeCode: dischargeCodeInput.value.trim(),
    ports,
  };
}

function missingFields() {
  if (!state.source || !state.source.ok) return [];
  return validateOptions(state.source, currentOptions());
}

function actionInfoText() {
  if (!state.file) return 'Файл не выбран';
  if (state.source === undefined) return `${state.file.name} · читаю…`;
  if (!state.source || !state.source.ok) return state.file.name;
  const ports = state.source.loadingPorts.length;
  return `${state.file.name} · ${rowsLabel(state.source.rows.length)} · ${ports} ${Shell.plural(ports, 'порт', 'порта', 'портов')} погрузки`;
}

function actionHintText() {
  if (!state.file) return 'Добавьте исходный файл';
  if (!state.source || !state.source.ok) return null;
  const missing = missingFields();
  return missing.length ? `Заполните: ${missing.join(', ')}` : null;
}

function updateUi() {
  const ready = Boolean(state.source && state.source.ok) && missingFields().length === 0;
  buildBtn.disabled = !ready || busy;
  Shell.setAction({ info: actionInfoText(), hint: actionHintText() });
  Shell.setStep(state.files ? 3 : state.file ? 2 : 1);
}

function fileRow(fileName, { text, error }, onRemove) {
  const li = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'file-list__name';
  name.textContent = fileName;

  const meta = document.createElement('span');
  meta.className = error ? 'file-list__meta file-list__meta--error' : 'file-list__meta';
  meta.textContent = text;

  li.appendChild(name);
  li.appendChild(meta);

  if (onRemove) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-list__remove';
    removeBtn.textContent = '✕';
    removeBtn.setAttribute('aria-label', `Убрать файл ${fileName}`);
    removeBtn.addEventListener('click', onRemove);
    li.appendChild(removeBtn);
  }
  return li;
}

function renderFileList() {
  sourceFileList.innerHTML = '';
  if (!state.file) return;
  let meta;
  if (state.source === undefined) meta = { text: 'читаю…', error: false };
  else if (!state.source || !state.source.ok) {
    meta = { text: state.source ? state.source.error : 'не удалось прочитать — это точно .xlsx?', error: true };
  } else meta = { text: rowsLabel(state.source.rows.length), error: false };
  sourceFileList.appendChild(fileRow(state.file.name, meta, () => setFile(null)));
}

function field(label, input) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(input);
  return wrap;
}

function textInput(value, placeholder = '') {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.addEventListener('input', onFieldChange);
  return input;
}

// Поля портов погрузки строятся по файлу заново; уже введённые даты и терминалы
// того же порта сохраняются (тот же исходный файл, загруженный повторно).
function renderPorts() {
  const previous = new Map(state.portInputs.map(({ code, inputs }) => [code, inputs]));
  portsBox.innerHTML = '';
  state.portInputs = [];
  if (!state.source || !state.source.ok) {
    portsSection.hidden = true;
    return;
  }
  for (const port of state.source.loadingPorts) {
    const old = previous.get(port.code);
    const heading = document.createElement('h3');
    const containers = `${port.containers} ${Shell.plural(port.containers, 'контейнер', 'контейнера', 'контейнеров')}`;
    heading.textContent = `${port.code || 'без кода'} — ${rowsLabel(port.rows)}, ${containers}${port.known ? '' : ' (порта нет в справочнике — впишите POL и терминал)'}`;
    portsBox.appendChild(heading);

    const billDate = document.createElement('input');
    billDate.type = 'date';
    billDate.value = old ? old.billDate.value : '';
    billDate.addEventListener('input', onFieldChange);
    const inputs = {
      billDate,
      terminal: textInput(old ? old.terminal.value : port.terminal, 'Терминал погрузки'),
      pol: textInput(old ? old.pol.value : port.pol),
      fileCode: textInput(old ? old.fileCode.value : port.fileCode),
    };
    const grid = document.createElement('div');
    grid.className = 'field-grid';
    grid.appendChild(field('Дата коносамента', inputs.billDate));
    grid.appendChild(field('Терминал погрузки', inputs.terminal));
    grid.appendChild(field('POL', inputs.pol));
    grid.appendChild(field('Код в имени файла', inputs.fileCode));
    portsBox.appendChild(grid);
    state.portInputs.push({ code: port.code, inputs });
  }
  portsSection.hidden = false;
}

function onFieldChange() {
  hideSummary();
  updateUi();
}

[vesselInput, voyageInput, arrivalInput, dischargeTerminalInput, dischargeCodeInput].forEach((input) => {
  input.addEventListener('input', onFieldChange);
});

async function readFile(file, version) {
  let source = null;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    source = readSource(workbook);
  } catch {
    source = null; // не .xlsx или повреждён — скажем в списке
  }
  if (version !== setVersion) return; // файл уже убрали или заменили
  state.source = source;
  if (source && source.ok) {
    if (source.vessel) vesselInput.value = source.vessel;
    if (source.voyage) voyageInput.value = source.voyage;
  }
  renderFileList();
  renderPorts();
  updateUi();
}

function setFile(file) {
  setVersion++;
  state.file = file;
  state.source = file ? undefined : null;
  clearError();
  hideSummary();
  renderFileList();
  renderPorts();
  updateUi();
  if (file) readFile(file, setVersion);
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
  resultFileList.innerHTML = '';
  state.files = null;
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

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function downloadFile(file) {
  const buffer = await file.workbook.xlsx.writeBuffer();
  saveBlob(new Blob([buffer], { type: XLSX_TYPE }), file.fileName);
}

function renderResult(files) {
  resultStats.innerHTML = '';
  addStat(files.length, Shell.plural(files.length, 'Файл', 'Файла', 'Файлов'));
  addStat(files.reduce((sum, f) => sum + f.rows, 0), 'Строк');
  addStat(files.reduce((sum, f) => sum + f.containers, 0), 'Контейнеров');

  resultFileList.innerHTML = '';
  for (const file of files) {
    const li = fileRow(file.fileName, {
      text: `${rowsLabel(file.rows)}`,
      error: false,
    });
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--secondary';
    btn.textContent = 'Скачать';
    btn.setAttribute('aria-label', `Скачать ${file.fileName}`);
    btn.addEventListener('click', () => downloadFile(file));
    li.appendChild(btn);
    resultFileList.appendChild(li);
  }
}

buildBtn.addEventListener('click', () => {
  if (!state.source || !state.source.ok) return;
  clearError();
  hideSummary();
  const missing = missingFields();
  if (missing.length) {
    showError(`Заполните: ${missing.join(', ')}`);
    return;
  }
  busy = true;
  updateUi();
  try {
    state.files = buildArmFiles(state.source, {
      ...currentOptions(),
      createWorkbook: () => new ExcelJS.Workbook(),
    });
    renderResult(state.files);
    summaryBox.hidden = false;
    Shell.setResultShown(true);
  } catch (err) {
    showError(err.message);
  } finally {
    busy = false;
    updateUi();
  }
});

downloadZipBtn.addEventListener('click', async () => {
  if (!state.files) return;
  const zip = new JSZip();
  for (const file of state.files) {
    zip.file(file.fileName, await file.workbook.xlsx.writeBuffer());
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const { vessel, voyage } = currentOptions();
  saveBlob(blob, `for ARM uploading ${vessel} ${voyage}.zip`.replace(/[\\/:*?"<>|]+/g, '_'));
});

renderFileList();
updateUi();
