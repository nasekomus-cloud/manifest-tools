// Состояние страницы «Сверить с поручениями на погрузку»: сводный файл (с числом
// строк), приём поручений (архивом .zip или отдельными .xlsx, вперемешку), вызов
// core.js, скачивание результата. Вся логика сверки — в core.js
// (crossCheckOrders); панель, шаги и полоса действия — общий каркас
// assets/shell.js (window.Shell). Разметка списка файлов, плиток и зон — по
// образцу merge/app.js.
//
// Шаг 1 — пока нет сводного файла, 2 — пока нет результата, 3 — результат
// показан; любое изменение файлов прячет устаревший результат.

import { crossCheckOrders } from './core.js?v=202609122000';
import { countDataRows } from '../lib/manifest-format.js?v=202609121930';

const Shell = window.Shell;

function rowsLabel(n) {
  return `${n} ${Shell.plural(n, 'строка', 'строки', 'строк')}`;
}

const combinedInput = document.getElementById('combined-input');
const combinedPickBtn = document.getElementById('combined-pick-btn');
const combinedDropzone = document.getElementById('combined-dropzone');
const combinedFileList = document.getElementById('combined-file-list');

const ordersInput = document.getElementById('orders-input');
const ordersPickBtn = document.getElementById('orders-pick-btn');
const ordersDropzone = document.getElementById('orders-dropzone');
const ordersFileList = document.getElementById('orders-file-list');

const checkBtn = document.getElementById('check-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const warningsBox = document.getElementById('warnings-box');
const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const categoriesBox = document.getElementById('categories-box');

const state = {
  /** rows: undefined — ещё считается; number — строк данных; null — файл не читается как манифест. */
  combined: /** @type {{file: File, rows: number|null|undefined}|null} */ (null),
  /** @type {Array<{id:number, name:string, size:number|null, getBuffer: () => Promise<ArrayBuffer>}>} */
  orderSources: [],
  resultWorkbook: null,
};
let nextOrderId = 1;
let busy = false;
let setVersion = 0; // растёт при каждом изменении файлов — результат старого набора не показываем

const MACOS_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$)/i;

function combinedInfo() {
  if (!state.combined) return 'не выбран';
  const { rows } = state.combined;
  if (rows === undefined) return 'считаю строки…';
  if (rows === null) return state.combined.file.name;
  return rowsLabel(rows);
}

function actionInfoText() {
  if (!state.combined && !state.orderSources.length) return 'Файлы не выбраны';
  const n = state.orderSources.length;
  const orders = n ? `${n} ${Shell.plural(n, 'файл', 'файла', 'файлов')}` : 'не выбраны';
  return `Сводный: ${combinedInfo()} · Поручения: ${orders}`;
}

function actionHintText() {
  if (!state.combined) return 'Добавьте сводный файл';
  if (!state.orderSources.length) return 'Добавьте поручения';
  return null;
}

function updateUi() {
  checkBtn.disabled = !(state.combined && state.orderSources.length) || busy;
  Shell.setAction({ info: actionInfoText(), hint: actionHintText() });
  Shell.setStep(state.resultWorkbook ? 3 : state.combined ? 2 : 1);
}

function combinedMeta(entry) {
  if (entry.rows === undefined) return { text: 'считаю строки…', error: false };
  if (entry.rows === null) return { text: 'не удалось прочитать — это точно .xlsx манифеста?', error: true };
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
  combinedFileList.innerHTML = '';
  if (state.combined) {
    combinedFileList.appendChild(
      fileRow(state.combined.file.name, combinedMeta(state.combined), () => setCombinedFile(null)),
    );
  }

  ordersFileList.innerHTML = '';
  state.orderSources.forEach((entry) => {
    const meta = { text: entry.size === null ? '' : Shell.formatSize(entry.size), error: false };
    ordersFileList.appendChild(
      fileRow(entry.name, meta, () => {
        state.orderSources = state.orderSources.filter((e) => e.id !== entry.id);
        setChanged();
      }),
    );
  });
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

// Размер записи архива до распаковки: JSZip держит его в _data.uncompressedSize
// (внутреннее поле 3.x). Нет поля — размер просто не показываем, это только подпись.
function zipEntrySize(entry) {
  const size = entry._data && entry._data.uncompressedSize;
  return typeof size === 'number' ? size : null;
}

// Разворачивает .zip в браузере (JSZip) и добавляет к нему все .xlsx-записи;
// отдельно выбранный .xlsx добавляется как есть. Служебные записи архива
// (__MACOSX/, .DS_Store, каталоги) молча пропускаются — не ошибка.
async function addOrderFiles(fileList) {
  const errors = [];
  const added = [];
  for (const file of Array.from(fileList)) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.zip')) {
      let zip;
      try {
        zip = await JSZip.loadAsync(await file.arrayBuffer());
      } catch (err) {
        errors.push(`Не удалось прочитать архив «${file.name}»: ${err.message}`);
        continue;
      }
      for (const [entryName, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (MACOS_JUNK.test(entryName)) continue;
        if (!entryName.toLowerCase().endsWith('.xlsx')) continue;
        added.push({
          id: nextOrderId++,
          name: entryName.split('/').pop(),
          size: zipEntrySize(entry),
          getBuffer: () => entry.async('arraybuffer'),
        });
      }
    } else if (lowerName.endsWith('.xlsx')) {
      added.push({
        id: nextOrderId++,
        name: file.name,
        size: file.size,
        getBuffer: () => file.arrayBuffer(),
      });
    }
    // остальные типы файлов (перетащенные по ошибке) молча пропускаются
  }
  if (!added.length && !errors.length) return; // ничего подходящего — набор не изменился
  state.orderSources.push(...added);
  setChanged();
  if (errors.length) showError(errors.join('\n'));
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

setupDropzone(combinedDropzone, (files) => setCombinedFile(files[0]));
setupDropzone(ordersDropzone, (files) => addOrderFiles(files));

combinedPickBtn.addEventListener('click', () => combinedInput.click());
ordersPickBtn.addEventListener('click', () => ordersInput.click());

combinedInput.addEventListener('change', () => {
  if (combinedInput.files.length) setCombinedFile(combinedInput.files[0]);
  combinedInput.value = '';
});

ordersInput.addEventListener('change', () => {
  if (ordersInput.files.length) addOrderFiles(ordersInput.files);
  ordersInput.value = '';
});

async function loadCombinedWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new Error(`Не удалось прочитать сводный файл «${file.name}»: ${err.message}`);
  }
  return workbook;
}

// Загружает все поручения; файл, который не читается, не останавливает
// проверку — попадает в предупреждения, остальные обрабатываются как обычно.
async function loadOrderWorkbooks(sources) {
  const entries = [];
  const loadWarnings = [];
  for (const source of sources) {
    try {
      const buffer = await source.getBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      entries.push({ fileName: source.name, workbook });
    } catch (err) {
      loadWarnings.push(`Файл «${source.name}» не читается как .xlsx: ${err.message}`);
    }
  }
  return { entries, loadWarnings };
}

const CATEGORY_LABELS = [
  ['cargoWeight', 'вес груза'],
  ['tareWeight', 'вес тары'],
  ['totalWeight', 'общий вес'],
  ['seals', 'номер пломбы'],
  ['futnost', 'тип контейнера'],
  ['dangerous', 'класс опасности'],
  ['orderWrong', 'поручение указано неверно'],
  ['orderFormat', 'номер поручения записан неточно'],
  ['notFound', 'контейнер не найден ни в одном поручении'],
];

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
  if (summary.missingFromSummary) {
    addStat(String(summary.missingFromSummary), 'Нет в своде');
  }

  categoriesBox.innerHTML = '';
  const categories = CATEGORY_LABELS.filter(([key]) => summary[key]);
  if (categories.length) {
    const heading = document.createElement('h3');
    heading.textContent = 'Расхождения по категориям';
    categoriesBox.appendChild(heading);

    const list = document.createElement('ul');
    categories.forEach(([key, label]) => {
      const li = document.createElement('li');
      li.textContent = `${label}: ${summary[key]}`;
      list.appendChild(li);
    });
    categoriesBox.appendChild(list);
  }

  summaryBox.hidden = false;
}

function renderWarnings(warnings) {
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

checkBtn.addEventListener('click', async () => {
  if (!state.combined || !state.orderSources.length) return;
  clearError();
  hideSummary();

  const version = setVersion;
  const checkLabel = checkBtn.textContent;
  busy = true;
  checkBtn.textContent = 'Сверяю…';
  updateUi();
  try {
    const combinedWb = await loadCombinedWorkbook(state.combined.file);
    const { entries, loadWarnings } = await loadOrderWorkbooks(state.orderSources);
    if (version !== setVersion) return; // пока читали, файлы поменяли — результат уже не тот

    if (!entries.length) {
      showError('Ни одно поручение не удалось прочитать');
      return;
    }

    const result = crossCheckOrders(combinedWb, entries);
    if (!result.ok) {
      showError(result.error);
      return;
    }

    state.resultWorkbook = result.resultWorkbook;
    renderSummary(result.summary);
    renderWarnings([...loadWarnings, ...result.warnings]);
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
  link.download = 'сверка-поручений.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

renderFileLists();
updateUi();
