// Состояние страницы «Проверить шаблон эл. поручения»: одна зона принимает и
// шаблон, и поручения (отдельными .xlsx или архивом .zip, как их отдаёт Gmail),
// каждый файл распознаётся при добавлении (detectFileKind). Вся логика проверки
// формы и сверки с поручением — в core.js (checkTemplate); панель, шаги и полоса
// действия — общий каркас assets/shell.js (window.Shell). Разметка списка
// файлов, плиток и зоны — по образцу order-check/app.js и merge/app.js.
//
// Шаг 1 — файлов нет, 2 — файлы есть, но результата ещё нет, 3 — результат
// показан; любое изменение набора файлов прячет устаревший результат. Для
// самой проверки файлы читаются заново из исходных байтов (spec §6) — объект,
// прочитанный при распознавании, для этого не переиспользуется.

import { detectFileKind, checkTemplate } from './core.js?v=202609130751';

const Shell = window.Shell;

const MACOS_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$)/i;

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const pickFilesBtn = document.getElementById('pick-files-btn');
const fileListEl = document.getElementById('file-list');

const checkBtn = document.getElementById('check-btn');
const errorBox = document.getElementById('error-box');

const summaryBox = document.getElementById('summary-box');
const resultStats = document.getElementById('result-stats');
const correctedCaption = document.getElementById('corrected-caption');
const warningsBox = document.getElementById('warnings-box');
const findingsBox = document.getElementById('findings-box');
const downloadCorrectedBtn = document.getElementById('download-corrected-btn');
const downloadMarkedBtn = document.getElementById('download-marked-btn');
const downloadReportBtn = document.getElementById('download-report-btn');

/**
 * entry: {
 *   id: number, name: string, size: number|null, getBuffer: () => Promise<ArrayBuffer>,
 *   status: 'reading' | 'xls' | 'error' | 'unknown' | 'template' | 'order',
 *   orderNumber?: string, containers?: number,
 * }
 */
const state = {
  entries: /** @type {Array<object>} */ ([]),
  result: null,
};
let nextId = 1;
let busy = false;
let setVersion = 0; // растёт при каждом изменении файлов — старый результат не показываем

function containersText(n) {
  return `${n} ${Shell.plural(n, 'контейнер', 'контейнера', 'контейнеров')}`;
}

function templates() {
  return state.entries.filter((e) => e.status === 'template');
}

function orders() {
  return state.entries.filter((e) => e.status === 'order');
}

function actionInfoText() {
  if (!state.entries.length) return 'Файлы не выбраны';
  const tpl = templates();
  const templateText = tpl.length === 0 ? 'не выбран' : (tpl.length === 1 ? tpl[0].name : `выбрано ${tpl.length}`);
  return `Шаблон: ${templateText} · Поручения: ${orders().length}`;
}

function actionHintText() {
  if (state.entries.some((e) => e.status === 'reading')) return 'Распознаю файлы…';
  const tplCount = templates().length;
  if (tplCount === 0) return 'Добавьте шаблон';
  if (tplCount > 1) return 'Оставьте один шаблон';
  if (!orders().length) return 'Добавьте поручение';
  return null;
}

function updateUi() {
  const recognizing = state.entries.some((e) => e.status === 'reading');
  checkBtn.disabled = recognizing || templates().length !== 1 || !orders().length || busy;
  Shell.setAction({ info: actionInfoText(), hint: actionHintText() });
  Shell.setStep(state.result ? 3 : state.entries.length ? 2 : 1);
}

function entryMeta(entry) {
  switch (entry.status) {
    case 'reading': return { text: 'распознаю…', error: false };
    case 'xls': return { text: 'формат .xls не читается — пересохраните в .xlsx', error: true };
    case 'error': return { text: 'не читается как .xlsx', error: true };
    case 'unknown': return { text: 'не шаблон и не поручение', error: true };
    case 'template': return { text: `шаблон · ${containersText(entry.containers)}`, error: false };
    case 'order': return { text: `поручение № ${entry.orderNumber} · ${containersText(entry.containers)}`, error: false };
    default: return { text: '', error: false };
  }
}

function fileRow(name, meta, onRemove) {
  const li = document.createElement('li');

  const nameEl = document.createElement('span');
  nameEl.className = 'file-list__name';
  nameEl.textContent = name;

  const metaEl = document.createElement('span');
  metaEl.className = meta.error ? 'file-list__meta file-list__meta--error' : 'file-list__meta';
  metaEl.textContent = meta.text;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'file-list__remove';
  removeBtn.textContent = '✕';
  removeBtn.setAttribute('aria-label', `Убрать файл ${name}`);
  removeBtn.addEventListener('click', onRemove);

  li.appendChild(nameEl);
  li.appendChild(metaEl);
  li.appendChild(removeBtn);
  return li;
}

function renderFileList() {
  fileListEl.innerHTML = '';
  state.entries.forEach((entry) => {
    fileListEl.appendChild(fileRow(entry.name, entryMeta(entry), () => removeEntry(entry.id)));
  });
}

function removeEntry(id) {
  state.entries = state.entries.filter((e) => e.id !== id);
  setChanged();
}

// Любое изменение файлов делает показанный результат устаревшим — прячем его,
// чтобы нельзя было скачать не то.
function setChanged() {
  setVersion++;
  clearError();
  hideSummary();
  renderFileList();
  updateUi();
}

function showError(messages) {
  errorBox.innerHTML = '';
  [].concat(messages).forEach((text) => {
    const line = document.createElement('p');
    line.textContent = text;
    errorBox.appendChild(line);
  });
  errorBox.hidden = false;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

function hideSummary() {
  summaryBox.hidden = true;
  resultStats.innerHTML = '';
  findingsBox.innerHTML = '';
  warningsBox.hidden = true;
  warningsBox.innerHTML = '';
  correctedCaption.hidden = true;
  correctedCaption.textContent = '';
  downloadCorrectedBtn.hidden = true;
  downloadMarkedBtn.hidden = true;
  state.result = null;
  Shell.setResultShown(false);
}

// Распознаёт файл, читая его один раз (spec §6); объект книги, прочитанный
// здесь, для самой проверки не переиспользуется — она читает байты заново.
async function recognizeEntry(entry) {
  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await entry.getBuffer());
  } catch {
    if (!state.entries.includes(entry)) return; // убрали, пока читали
    entry.status = 'error';
    renderFileList();
    updateUi();
    return;
  }
  if (!state.entries.includes(entry)) return; // убрали, пока читали
  const kind = detectFileKind(workbook);
  if (kind.kind === 'order') {
    entry.status = 'order';
    entry.orderNumber = kind.orderNumber;
    entry.containers = kind.containers;
  } else if (kind.kind === 'template') {
    entry.status = 'template';
    entry.containers = kind.containers;
  } else {
    entry.status = 'unknown';
  }
  renderFileList();
  updateUi();
}

// Размер записи архива до распаковки: JSZip держит его в _data.uncompressedSize
// (внутреннее поле 3.x). Нет поля — размер просто не показываем, это только подпись.
function zipEntrySize(entry) {
  const size = entry._data && entry._data.uncompressedSize;
  return typeof size === 'number' ? size : null;
}

function makeEntry(name, size, getBuffer) {
  const isXls = name.toLowerCase().endsWith('.xls');
  return { id: nextId++, name, size, getBuffer, status: isXls ? 'xls' : 'reading' };
}

// Разворачивает .zip в браузере (JSZip) и добавляет все .xlsx/.xls-записи;
// отдельно выбранные файлы добавляются как есть. Служебные записи архива
// (__MACOSX/, .DS_Store, каталоги) и записи другого формата молча пропускаются.
async function addFiles(fileList) {
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
      for (const [entryName, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) continue;
        if (MACOS_JUNK.test(entryName)) continue;
        const shortName = entryName.split('/').pop();
        const lower = shortName.toLowerCase();
        if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) continue;
        added.push(makeEntry(shortName, zipEntrySize(zipEntry), () => zipEntry.async('arraybuffer')));
      }
    } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      added.push(makeEntry(file.name, file.size, () => file.arrayBuffer()));
    }
    // остальные типы файлов (перетащенные по ошибке) молча пропускаются
  }
  if (!added.length && !errors.length) return; // ничего подходящего — набор не изменился
  state.entries.push(...added);
  setChanged();
  if (errors.length) showError(errors);
  added.filter((entry) => entry.status === 'reading').forEach(recognizeEntry);
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');
}

function setupDropzone(zone, onFiles) {
  zone.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    zone.classList.add('dropzone--active');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dropzone--active');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dropzone--active');
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
}

setupDropzone(dropzone, (files) => addFiles(files));
pickFilesBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) addFiles(fileInput.files);
  fileInput.value = '';
});

/* ——— результат ——— */

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

function actionLabel(f) {
  if (f.level === 'warning') return 'Проверьте';
  return f.fix === 'auto' ? 'Исправлено автоматически' : 'Уточнить у заказчика';
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

function renderFindings(findings, summary) {
  findingsBox.innerHTML = '';
  if (summary.errors === 0) {
    const p = document.createElement('p');
    p.textContent = 'Ошибок нет — шаблон соответствует форме и поручению.';
    findingsBox.appendChild(p);
  }
  if (!findings.length) return;

  const scroll = document.createElement('div');
  scroll.className = 'table-scroll';
  const table = document.createElement('table');
  table.className = 'data-table';
  appendRow(table, ['Ячейка', 'Поле', 'Контейнер', 'Что не так', 'Как поступить'], { header: true });
  findings.forEach((f) => {
    appendRow(table, [f.cell || '—', f.field, f.container || '—', f.message, actionLabel(f)]);
  });
  scroll.appendChild(table);
  findingsBox.appendChild(scroll);
}

function renderTopWarnings(topWarnings) {
  warningsBox.innerHTML = '';
  if (!topWarnings.length) {
    warningsBox.hidden = true;
    return;
  }
  const heading = document.createElement('p');
  heading.textContent = 'Предупреждения:';
  warningsBox.appendChild(heading);
  const list = document.createElement('ul');
  topWarnings.forEach((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  warningsBox.appendChild(list);
  warningsBox.hidden = false;
}

// История 22: сколько исправлено само, сколько осталось уточнить у заказчика.
function correctedCaptionText(summary) {
  if (summary.needsCustomer === 0) {
    return `Исправлено ${summary.autoFixable} из ${summary.errors} ошибок — шаблон готов к загрузке`;
  }
  return `Исправлено ${summary.autoFixable} из ${summary.errors} ошибок; ещё ${summary.needsCustomer} — уточнить у заказчика`;
}

function renderActions(result) {
  const { summary } = result;
  const hasCorrected = Boolean(result.correctedWorkbook);
  downloadCorrectedBtn.hidden = !hasCorrected;
  correctedCaption.hidden = !hasCorrected;
  if (hasCorrected) correctedCaption.textContent = correctedCaptionText(summary);
  downloadMarkedBtn.hidden = !(summary.errors > 0 || summary.warnings > 0);
}

function renderResult(result) {
  resultStats.innerHTML = '';
  addStat(result.summary.containers, 'Контейнеров');
  addStat(result.summary.errors, 'Ошибок');
  addStat(result.summary.autoFixable, 'Исправлено автоматически');
  addStat(result.summary.needsCustomer, 'Уточнить у заказчика');
  addStat(result.summary.warnings, 'Предупреждений');

  renderTopWarnings(result.topWarnings);
  renderFindings(result.findings, result.summary);
  renderActions(result);
  summaryBox.hidden = false;
}

checkBtn.addEventListener('click', async () => {
  const tpl = templates();
  const ord = orders();
  if (tpl.length !== 1 || !ord.length) return;
  clearError();
  hideSummary();

  const version = setVersion;
  const checkLabel = checkBtn.textContent;
  busy = true;
  checkBtn.textContent = 'Проверяю…';
  updateUi();
  try {
    const templateEntry = tpl[0];
    const templateWb = new ExcelJS.Workbook();
    await templateWb.xlsx.load(await templateEntry.getBuffer());

    const orderEntries = [];
    for (const entry of ord) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await entry.getBuffer());
      orderEntries.push({ fileName: entry.name, workbook });
    }
    if (version !== setVersion) return; // пока читали, файлы поменяли — результат уже не тот

    const result = checkTemplate(templateWb, orderEntries, {
      createWorkbook: () => new ExcelJS.Workbook(),
      templateFileName: templateEntry.name,
      checkedAt: new Date(),
    });
    if (!result.ok) {
      showError(result.error);
      return;
    }

    state.result = result;
    renderResult(result);
    Shell.setResultShown(true);
  } catch (err) {
    if (version === setVersion) showError(err.message);
  } finally {
    busy = false;
    checkBtn.textContent = checkLabel;
    updateUi();
  }
});

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function downloadWorkbook(workbook, fileName) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, fileName);
}

downloadCorrectedBtn.addEventListener('click', () => {
  if (!state.result || !state.result.correctedWorkbook) return;
  downloadWorkbook(state.result.correctedWorkbook, state.result.fileNames.corrected);
});

downloadMarkedBtn.addEventListener('click', () => {
  if (!state.result) return;
  downloadWorkbook(state.result.markedWorkbook, state.result.fileNames.marked);
});

downloadReportBtn.addEventListener('click', () => {
  if (!state.result) return;
  // BOM добавляет страница (spec §7) — модуль отдаёт текст без него.
  const blob = new Blob([`﻿${state.result.reportText}`], { type: 'text/plain;charset=utf-8' });
  triggerDownload(blob, state.result.fileNames.report);
});

renderFileList();
updateUi();
