// Состояние страницы «Сверить с поручениями на погрузку»: выбор сводного
// файла, приём поручений (архивом .zip или отдельными .xlsx, вперемешку),
// вызов core.js, скачивание результата. Вся логика сверки — в core.js.

import { crossCheckOrders } from './core.js?v=202609101845';

const combinedInput = document.getElementById('combined-input');
const combinedDropzone = document.getElementById('combined-dropzone');
const combinedFileList = document.getElementById('combined-file-list');

const ordersInput = document.getElementById('orders-input');
const ordersDropzone = document.getElementById('orders-dropzone');
const ordersCount = document.getElementById('orders-count');
const ordersFileList = document.getElementById('orders-file-list');

const checkBtn = document.getElementById('check-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const warningsBox = document.getElementById('warnings-box');
const summaryBox = document.getElementById('summary-box');

const state = {
  combinedFile: null,
  /** @type {Array<{id:number, name:string, getBuffer: () => Promise<ArrayBuffer>}>} */
  orderSources: [],
  resultWorkbook: null,
};
let nextOrderId = 1;

const MACOS_JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$)/i;

function resetResults() {
  errorBox.hidden = true;
  errorBox.textContent = '';
  warningsBox.hidden = true;
  warningsBox.innerHTML = '';
  summaryBox.hidden = true;
  summaryBox.innerHTML = '';
  downloadBtn.hidden = true;
  state.resultWorkbook = null;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function updateCheckButton() {
  checkBtn.disabled = !(state.combinedFile && state.orderSources.length);
}

function renderCombinedFile() {
  combinedFileList.innerHTML = '';
  if (!state.combinedFile) return;
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = state.combinedFile.name;
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn';
  removeBtn.textContent = 'Убрать';
  removeBtn.addEventListener('click', () => setCombinedFile(null));
  li.appendChild(name);
  li.appendChild(removeBtn);
  combinedFileList.appendChild(li);
}

function setCombinedFile(file) {
  state.combinedFile = file;
  renderCombinedFile();
  updateCheckButton();
  resetResults();
}

function renderOrderSources() {
  ordersCount.textContent = state.orderSources.length
    ? `Поручений загружено: ${state.orderSources.length}`
    : '';
  ordersFileList.innerHTML = '';
  state.orderSources.forEach((entry) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = entry.name;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn';
    removeBtn.textContent = 'Убрать';
    removeBtn.addEventListener('click', () => {
      state.orderSources = state.orderSources.filter((e) => e.id !== entry.id);
      renderOrderSources();
      updateCheckButton();
      resetResults();
    });
    li.appendChild(name);
    li.appendChild(removeBtn);
    ordersFileList.appendChild(li);
  });
  updateCheckButton();
}

// Разворачивает .zip в браузере (JSZip) и добавляет к нему все .xlsx-записи;
// отдельно выбранный .xlsx добавляется как есть. Служебные записи архива
// (__MACOSX/, .DS_Store, каталоги) молча пропускаются — не ошибка.
async function addOrderFiles(fileList) {
  for (const file of Array.from(fileList)) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.zip')) {
      let zip;
      try {
        zip = await JSZip.loadAsync(await file.arrayBuffer());
      } catch (err) {
        showError(`Не удалось прочитать архив «${file.name}»: ${err.message}`);
        continue;
      }
      for (const [entryName, entry] of Object.entries(zip.files)) {
        if (entry.dir) continue;
        if (MACOS_JUNK.test(entryName)) continue;
        if (!entryName.toLowerCase().endsWith('.xlsx')) continue;
        state.orderSources.push({
          id: nextOrderId++,
          name: entryName.split('/').pop(),
          getBuffer: () => entry.async('arraybuffer'),
        });
      }
    } else if (lowerName.endsWith('.xlsx')) {
      state.orderSources.push({
        id: nextOrderId++,
        name: file.name,
        getBuffer: () => file.arrayBuffer(),
      });
    }
    // остальные типы файлов (перетащенные по ошибке) молча пропускаются
  }
  renderOrderSources();
  resetResults();
}

function setupDropzone(dropzone, onFiles) {
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
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) onFiles(files);
  });
}

setupDropzone(combinedDropzone, (files) => setCombinedFile(files[0]));
setupDropzone(ordersDropzone, (files) => addOrderFiles(files));

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

function renderSummary(summary) {
  summaryBox.innerHTML = '';

  const list = document.createElement('ul');
  const total = document.createElement('li');
  total.textContent = `Всего строк: ${summary.totalRows}, с расхождениями: ${summary.mismatchRows}`;
  list.appendChild(total);

  CATEGORY_LABELS.forEach(([key, label]) => {
    if (!summary[key]) return;
    const li = document.createElement('li');
    li.textContent = `${label}: ${summary[key]}`;
    list.appendChild(li);
  });

  if (summary.missingFromSummary) {
    const li = document.createElement('li');
    li.textContent = `Контейнеров из поручений, не найденных в своде: ${summary.missingFromSummary}`;
    list.appendChild(li);
  }

  summaryBox.appendChild(list);
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
  resetResults();
  checkBtn.disabled = true;
  checkBtn.textContent = 'Сверяю…';
  try {
    const combinedWb = await loadCombinedWorkbook(state.combinedFile);
    const { entries, loadWarnings } = await loadOrderWorkbooks(state.orderSources);

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
    downloadBtn.hidden = false;
  } catch (err) {
    showError(err.message);
  } finally {
    checkBtn.disabled = false;
    checkBtn.textContent = 'Сверить';
    updateCheckButton();
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

renderCombinedFile();
renderOrderSources();
