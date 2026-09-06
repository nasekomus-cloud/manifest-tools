// Состояние страницы, работа с <input type=file>/drag-and-drop и скачивание
// результата. Вся логика сверки — в core.js; здесь только DOM (см. interfaces.md).
import { crossCheckDangerousGoods } from './core.js?v=202609061336';

const combinedInput = document.getElementById('combined-input');
const dgInput = document.getElementById('dg-input');
const combinedDropzone = document.getElementById('combined-dropzone');
const dgDropzone = document.getElementById('dg-dropzone');
const combinedFileList = document.getElementById('combined-file-list');
const dgFileList = document.getElementById('dg-file-list');
const checkBtn = document.getElementById('check-btn');
const downloadBtn = document.getElementById('download-btn');
const errorBox = document.getElementById('error-box');
const summaryBox = document.getElementById('summary-box');

const state = {
  combinedFile: null,
  dgFile: null,
  resultWorkbook: null,
};

function renderFileList(listEl, file) {
  listEl.innerHTML = '';
  if (!file) return;
  const li = document.createElement('li');
  const name = document.createElement('span');
  name.textContent = file.name;
  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn';
  removeBtn.textContent = 'Убрать';
  removeBtn.addEventListener('click', () => {
    if (listEl === combinedFileList) setCombinedFile(null);
    else setDgFile(null);
  });
  li.appendChild(name);
  li.appendChild(removeBtn);
  listEl.appendChild(li);
}

function updateCheckButton() {
  checkBtn.disabled = !(state.combinedFile && state.dgFile);
}

function resetResults() {
  errorBox.innerHTML = '';
  summaryBox.innerHTML = '';
  downloadBtn.hidden = true;
  state.resultWorkbook = null;
}

function setCombinedFile(file) {
  state.combinedFile = file;
  renderFileList(combinedFileList, file);
  updateCheckButton();
  resetResults();
}

function setDgFile(file) {
  state.dgFile = file;
  renderFileList(dgFileList, file);
  updateCheckButton();
  resetResults();
}

function showError(message) {
  errorBox.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'error-message';
  box.textContent = message;
  errorBox.appendChild(box);
}

function showSummary(summary) {
  summaryBox.innerHTML = '';
  const list = document.createElement('ul');

  const mismatchItem = document.createElement('li');
  mismatchItem.textContent = `Расхождений: ${summary.mismatchCount}`;
  list.appendChild(mismatchItem);

  const notFoundItem = document.createElement('li');
  notFoundItem.textContent =
    `В DG-манифесте, но не найдено в сводном файле: ${summary.notFoundInSummaryCount} контейнеров`;
  list.appendChild(notFoundItem);

  summaryBox.appendChild(list);
}

function setupDropzone(dropzone, input, onFile) {
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
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) onFile(file);
  });
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (file) onFile(file);
    input.value = '';
  });
}

setupDropzone(combinedDropzone, combinedInput, setCombinedFile);
setupDropzone(dgDropzone, dgInput, setDgFile);

async function loadWorkbook(file, label) {
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
  resetResults();
  checkBtn.disabled = true;
  try {
    const [combinedWb, dgWb] = await Promise.all([
      loadWorkbook(state.combinedFile, 'сводный файл'),
      loadWorkbook(state.dgFile, 'DG-манифест'),
    ]);

    const result = crossCheckDangerousGoods(combinedWb, dgWb);
    if (!result.ok) {
      showError(result.error);
      return;
    }

    state.resultWorkbook = result.resultWorkbook;
    showSummary(result.summary);
    downloadBtn.hidden = false;
  } catch (err) {
    showError(err.message);
  } finally {
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
  link.download = 'сверка-опасные-грузы.xlsx';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});
