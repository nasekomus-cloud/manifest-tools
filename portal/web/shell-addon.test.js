// Добавка к каркасу: текст итога для журнала и правило «журнал не двоится».
// shell-addon.js — обычный скрипт для браузера; здесь он выполняется в node:vm
// с минимальной поддельной страницей (без панели и описания — только журнал).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(fileURLToPath(new URL('./shell-addon.js', import.meta.url)), 'utf8');

function textNode(text) {
  return { textContent: text };
}

function stat(value, label) {
  return {
    querySelector: (selector) => (selector === '.stat__value' ? textNode(value) : selector === '.stat__label' ? textNode(label) : null),
  };
}

function fileName(name, inResults = false) {
  return { textContent: name, closest: (selector) => (inResults && selector === '.file-list--results' ? {} : null) };
}

// Поддельная страница: page.files / page.stats можно менять между вызовами
function loadAddon(pathname = '/merge/') {
  const page = { files: [], stats: [] };
  const sent = [];
  const listeners = {};
  const shellCalls = [];
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === '.file-list__name') return page.files;
      if (selector === '.result__head .stat') return page.stats;
      return [];
    },
    addEventListener(type, handler) {
      (listeners[type] ??= []).push(handler);
    },
    createElement: () => {
      throw new Error('без панели элементы не нужны');
    },
  };
  const window = {
    document,
    location: { pathname },
    Shell: {
      setResultShown(shown) {
        shellCalls.push(shown);
      },
    },
    fetch(path, options) {
      sent.push({ path, options, body: JSON.parse(options.body) });
      return Promise.resolve({ ok: true, status: 204 });
    },
  };
  vm.runInNewContext(SOURCE, { window });
  const click = (target) => (listeners.click ?? []).forEach((handler) => handler({ target }));
  return { window, page, sent, shellCalls, click };
}

test('journalSummary: «значение подпись строчными» через « · »', () => {
  const { journalSummary } = loadAddon().window.PortalAddon;
  assert.equal(
    journalSummary([
      { value: ' 3 ', label: 'Файла' },
      { value: '455', label: 'Строк всего' },
      { value: '', label: '' },
      { value: '12 400,000', label: '' },
    ]),
    '3 файла · 455 строк всего · 12 400,000',
  );
  assert.equal(journalSummary([]), '');
});

test('journalFiles: пустые убраны, больше 50 — хвост одной строкой', () => {
  const { journalFiles } = loadAddon().window.PortalAddon;
  assert.deepEqual(journalFiles([' a.xlsx ', '', 'b.zip']), ['a.xlsx', 'b.zip']);
  const many = Array.from({ length: 60 }, (_, i) => `f${i}.xlsx`);
  const result = journalFiles(many);
  assert.equal(result.length, 50);
  assert.equal(result[48], 'f48.xlsx');
  assert.equal(result[49], '… и ещё 11');
});

test('журнал: повторный показ без скрытия и тот же результат после перезапуска — одна запись', () => {
  const { window, page, sent, shellCalls } = loadAddon('/merge/index.html');
  page.files = [fileName('a.xlsx'), fileName('b.xlsx')];
  page.stats = [stat('2', 'Файла'), stat('455', 'Строк')];

  window.Shell.setResultShown(true);
  window.Shell.setResultShown(true); // страница позвала ещё раз без скрытия
  window.Shell.setResultShown(false); // «Объединить» ещё раз без смены файлов
  window.Shell.setResultShown(true);
  assert.deepEqual(shellCalls, [true, true, false, true], 'старый setResultShown вызывается всегда');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, '/api/journal');
  assert.equal(sent[0].options.method, 'POST');
  assert.equal(sent[0].options.headers['Content-Type'], 'application/json');
  assert.equal(sent[0].options.keepalive, true);
  assert.deepEqual(sent[0].body, { tool: 'merge', kind: 'result', files: ['a.xlsx', 'b.xlsx'], summary: '2 файла · 455 строк' });

  // Сменили файл и запустили — новая запись
  window.Shell.setResultShown(false);
  page.files = [fileName('a.xlsx')];
  page.stats = [stat('1', 'Файл'), stat('200', 'Строк')];
  window.Shell.setResultShown(true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].body.files, ['a.xlsx']);
  assert.equal(sent[1].body.summary, '1 файл · 200 строк');
});

test('журнал: ключ — первый сегмент адреса, готовые файлы списка результатов не в счёт', () => {
  const { window, page, sent } = loadAddon('/grand-total-import/');
  page.files = [fileName('source.xlsx'), fileName('for ARM uploading X.xlsx', true)];
  window.Shell.setResultShown(true);
  assert.equal(sent[0].body.tool, 'grand-total-import');
  assert.deepEqual(sent[0].body.files, ['source.xlsx']);
});

// Цель щелчка: closest отвечает только на «свой» селектор
function clickTarget(selector, node = {}) {
  return { closest: (s) => (s === selector ? node : null) };
}
const DOWNLOAD_BUTTON = '.result__actions .btn';
const SAVED_FILE = 'a[download]';

test('журнал: кнопка в .result__actions и отданный файл — запись о скачивании с текстом кнопки', () => {
  const { page, sent, click } = loadAddon('/dashboard/');
  page.files = [fileName('m.xlsx')];
  click(clickTarget(DOWNLOAD_BUTTON, { textContent: ' Скачать в Excel ' }));
  assert.equal(sent.length, 0, 'по самому щелчку — ещё ничего');
  click(clickTarget(SAVED_FILE));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { tool: 'dashboard', kind: 'download', files: ['m.xlsx'], summary: 'Скачать в Excel' });
  click(clickTarget(SAVED_FILE)); // второй файл без нового нажатия кнопки не пишется
  assert.equal(sent.length, 1);
});

test('журнал: кнопка отказала (файла нет) — записи нет; щелчок по другой кнопке отменяет ожидание', () => {
  const { sent, click } = loadAddon('/grand-total/');
  click(clickTarget(DOWNLOAD_BUTTON, { textContent: 'Скачать PDF' })); // показала ошибку, файла нет
  click(clickTarget('button, a')); // потом — кнопка «Скачать» у файла в списке результатов
  click(clickTarget(SAVED_FILE));
  click({ closest: () => null }); // щелчок по тексту страницы
  assert.equal(sent.length, 0);

  click(clickTarget(DOWNLOAD_BUTTON, { textContent: 'Скачать PDF' }));
  click({ closest: () => null }); // щелчок по тексту, пока собирается PDF, ожидание не отменяет
  click(clickTarget(SAVED_FILE));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.summary, 'Скачать PDF');
});

test('журнал: ошибка сети человеку не показывается', async () => {
  const { window, page } = loadAddon();
  page.stats = [stat('1', 'Файл')];
  let rejected = 0;
  window.fetch = () => {
    rejected += 1;
    return Promise.reject(new Error('нет связи'));
  };
  assert.doesNotThrow(() => window.Shell.setResultShown(true));
  await new Promise((resolve) => setImmediate(resolve)); // необработанный отказ уронил бы тест
  assert.equal(rejected, 1);
});
