// Справка к инструментам: файлы инструкций, примеры файлов и маршруты /help.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { loadCatalog } from '../server/catalog.js';
import { startTestServer, REPO_ROOT } from '../server/test-helpers.js';
import { buildSamples, toXlsxBuffer } from './make-samples.js';

import { validateStructure, countDataRows } from '../../lib/manifest-format.js';
import { parseLoadingOrder } from '../../lib/loading-order.js';
import { mergeManifests } from '../../merge/core.js';
import { crossCheckDangerousGoods } from '../../dg-check/core.js';
import { crossCheckOrders } from '../../order-check/core.js';
import { buildOrdersRegistry } from '../../bl-registry/core.js';
import { buildPortDashboard as buildDestinationDashboard } from '../../dashboard/core.js';
import { buildPortDashboard as buildDepartureDashboard } from '../../dashboard-departure/core.js';
import { buildGrandTotalData } from '../../grand-total/core.js';
import { detectFileKind, checkTemplate } from '../../template-check/core.js';
import { readSourceManifest, crossCheckSource } from '../../source-check/core.js';
import { auditSourceFile, containerCheckDigitOk } from '../../source-audit/core.js';
import { readSource, validateOptions, buildArmFiles } from '../../arm-upload/core.js';

const HELP_DIR = join(REPO_ROOT, 'portal', 'help');
const SAMPLES_DIR = join(HELP_DIR, 'samples');
const catalog = loadCatalog(REPO_ROOT);

// Книги читаются из закоммиченных файлов — проверяется ровно то, что скачает человек.
const books = new Map();
async function sample(name) {
  if (!books.has(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(SAMPLES_DIR, name));
    books.set(name, wb);
  }
  return books.get(name);
}
// Каждый инструмент меняет книгу на месте — сверкам нужна свежая копия
async function fresh(name) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(SAMPLES_DIR, name));
  return wb;
}

function sampleLinks(html) {
  return [...html.matchAll(/href="\/help\/samples\/([^"]+)"/g)].map((m) => m[1]);
}

/* ——— Инструкции ——— */

test('у каждого инструмента есть инструкция из трёх разделов', () => {
  for (const key of catalog.keys) {
    const file = join(HELP_DIR, `${key}.html`);
    assert.ok(fs.existsSync(file), key);
    const html = fs.readFileSync(file, 'utf8');
    for (const heading of ['Что загрузить', 'Что получится', 'На что обратить внимание']) {
      assert.ok(html.includes(`<h2>${heading}</h2>`), `${key}: нет раздела «${heading}»`);
    }
  }
});

test('каждый пример файла, на который ссылается инструкция, существует', () => {
  let total = 0;
  for (const key of catalog.keys) {
    const html = fs.readFileSync(join(HELP_DIR, `${key}.html`), 'utf8');
    const links = sampleLinks(html);
    if (key !== 'bl-split') assert.ok(links.length > 0, `${key}: нет ни одного примера`);
    for (const name of links) {
      assert.ok(fs.existsSync(join(SAMPLES_DIR, name)), `${key}: нет файла ${name}`);
      assert.match(html, new RegExp(`href="/help/samples/${name.replace(/\./g, '\\.')}" download`), `${key}: ${name} без download`);
      total++;
    }
  }
  assert.ok(total > 0);
});

test('каждый сгенерированный пример где-то упомянут, а закоммиченные файлы совпадают со скриптом', async () => {
  const generated = buildSamples();
  const onDisk = fs.readdirSync(SAMPLES_DIR).filter((n) => !n.startsWith('.')).sort();
  assert.deepEqual(onDisk, [...generated.keys()].sort(), 'запустите node portal/help/make-samples.js');

  const linked = new Set(catalog.keys.flatMap((key) => sampleLinks(fs.readFileSync(join(HELP_DIR, `${key}.html`), 'utf8'))));
  for (const name of generated.keys()) assert.ok(linked.has(name), `${name} ни в одной инструкции`);

  // Значения ячеек закоммиченных файлов — те же, что даёт скрипт сейчас
  for (const [name, wb] of generated) {
    const disk = await sample(name);
    assert.deepEqual(disk.worksheets.map((s) => s.name), wb.worksheets.map((s) => s.name), name);
    for (const sheet of wb.worksheets) {
      const other = disk.getWorksheet(sheet.name);
      sheet.eachRow({ includeEmpty: false }, (row, r) => {
        row.eachCell({ includeEmpty: false }, (cell, c) => {
          assert.deepEqual(other.getRow(r).getCell(c).value, cell.value, `${name} ${sheet.name}!${cell.address}`);
        });
      });
      assert.equal(other.actualRowCount, sheet.actualRowCount, `${name} ${sheet.name}: число строк`);
    }
  }
});

test('скрипт детерминирован: два запуска — одни и те же значения', () => {
  const dump = (samples) => JSON.stringify([...samples].map(([name, wb]) => [
    name,
    wb.worksheets.map((s) => s.getSheetValues()),
  ]));
  assert.equal(dump(buildSamples()), dump(buildSamples()));
});

test('скрипт детерминирован и по байтам: повторный запуск не меняет файлы', async () => {
  const [first, second] = [buildSamples(), buildSamples()];
  for (const name of first.keys()) {
    const a = await toXlsxBuffer(first.get(name));
    const b = await toXlsxBuffer(second.get(name));
    assert.ok(a.equals(b), name);
  }
});

test('номера контейнеров в примерах — с верной контрольной цифрой ISO 6346', async () => {
  const numbers = new Set();
  for (const name of fs.readdirSync(SAMPLES_DIR)) {
    const wb = await sample(name);
    for (const sheet of wb.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        const text = String(cell.text ?? '').trim();
        if (/^[A-Z]{4}\d{7}$/.test(text)) numbers.add(text);
      }));
    }
  }
  assert.ok(numbers.size >= 10, `контейнеров найдено ${numbers.size}`);
  // Одна ошибка в контрольной цифре — нарочно, для «Проверить исходный файл»
  const bad = [...numbers].filter((n) => !containerCheckDigitOk(n));
  assert.equal(bad.length, 1, `с неверной цифрой: ${bad.join(', ')}`);
});

/* ——— Примеры проходят разбор своих инструментов ——— */

test('манифесты: формат «Manifest» и склейка двух частей', async () => {
  const parts = ['manifest-eksport-chast-1.xlsx', 'manifest-eksport-chast-2.xlsx'];
  const all = [...parts, 'manifest-eksport-svod.xlsx', 'manifest-import.xlsx'];
  for (const name of all) {
    assert.deepEqual(validateStructure([{ fileName: name, workbook: await sample(name) }]), { ok: true }, name);
  }
  const entries = await Promise.all(parts.map(async (fileName) => ({ fileName, workbook: await fresh(fileName) })));
  assert.deepEqual(validateStructure(entries), { ok: true });
  const merged = mergeManifests(entries, { renumber: true });
  assert.equal(merged.summary.uniqueContainers, countDataRows(await sample('manifest-eksport-svod.xlsx')));
  assert.deepEqual(merged.summary.duplicateContainers, []);
});

test('сверка опасных грузов: одно расхождение', async () => {
  const result = crossCheckDangerousGoods(await fresh('manifest-import.xlsx'), await fresh('dg-manifest.xlsx'));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.summary.mismatchCount, 1);
  assert.equal(result.summary.notFoundInSummaryCount, 0);
});

test('поручения: разбираются и сверка со сводом даёт одно расхождение (пломба)', async () => {
  const names = ['poruchenie-1.xlsx', 'poruchenie-2.xlsx'];
  for (const name of names) {
    const parsed = parseLoadingOrder(await sample(name));
    assert.equal(parsed.ok, true, `${name}: ${parsed.error}`);
    assert.ok(parsed.order.containers.length > 0);
    assert.equal(detectFileKind(await sample(name)).kind, 'order', name);
  }
  const orders = await Promise.all(names.map(async (fileName) => ({ fileName, workbook: await fresh(fileName) })));
  const result = crossCheckOrders(await fresh('manifest-eksport-svod.xlsx'), orders);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.summary.mismatchRows, 1);
  assert.equal(result.summary.seals, 1);
  assert.equal(result.summary.notFound, 0);
  assert.equal(result.summary.missingFromSummary, 0);
});

test('реестр, дашборды и итоговый отчёт строятся по манифестам', async () => {
  const exportWb = [{ fileName: 'manifest-eksport-svod.xlsx', workbook: await sample('manifest-eksport-svod.xlsx') }];
  const importWb = [{ fileName: 'manifest-import.xlsx', workbook: await sample('manifest-import.xlsx') }];

  const registry = buildOrdersRegistry(exportWb);
  assert.equal(registry.ok, true, registry.error);
  assert.equal(registry.uniqueOrders, 2);

  const destination = buildDestinationDashboard(exportWb);
  assert.equal(destination.ok, true, destination.error);
  assert.ok(destination.combined.ports.length >= 2);

  const departure = buildDepartureDashboard(importWb);
  assert.equal(departure.ok, true, departure.error);
  assert.ok(departure.combined.ports.length >= 2);

  for (const entries of [exportWb, importWb]) {
    const total = buildGrandTotalData(entries);
    assert.equal(total.ok, true, total.error);
    assert.ok(total.vessel && total.voyage, entries[0].fileName);
    assert.ok(total.grandTotal.count > 0);
  }
});

test('шаблон эл. поручения: узнаётся и проверяется, есть что исправить автоматически', async () => {
  assert.equal(detectFileKind(await sample('shablon-poruchenija.xlsx')).kind, 'template');
  const result = checkTemplate(
    await fresh('shablon-poruchenija.xlsx'),
    [{ fileName: 'poruchenie-1.xlsx', workbook: await fresh('poruchenie-1.xlsx') }],
    { createWorkbook: () => new ExcelJS.Workbook(), templateFileName: 'shablon-poruchenija.xlsx', checkedAt: new Date(2026, 10, 5, 10, 0) },
  );
  assert.equal(result.ok, true, result.error);
  const auto = result.findings.filter((f) => f.fix === 'auto');
  const customer = result.findings.filter((f) => f.fix !== 'auto' && f.level === 'error');
  assert.ok(auto.length >= 1, JSON.stringify(result.findings, null, 1));
  assert.deepEqual(customer, [], JSON.stringify(customer, null, 1));
});

test('исходный файл линии: разбор, проверка, файлы для АРМ и сверка с манифестом системы', async () => {
  const source = await sample('ishodnyj-fajl-linii.xlsx');

  const parsed = readSourceManifest(source);
  assert.equal(parsed.ok, true, parsed.error);

  // Нарочно две ошибки: вес в тоннах и опечатка в контрольной цифре номера контейнера
  const audit = auditSourceFile(await fresh('ishodnyj-fajl-linii.xlsx'));
  assert.equal(audit.ok, true, audit.error);
  assert.deepEqual([...new Set(audit.findings.map((f) => f.rule))].sort(), ['containerNumber', 'tonnes'],
    JSON.stringify(audit.findings, null, 1));

  const arm = readSource(source);
  assert.equal(arm.ok, true, arm.error);
  assert.ok(arm.loadingPorts.length >= 2);
  assert.ok(arm.loadingPorts.every((p) => p.known), 'все порты погрузки — из справочника');
  const options = {
    vessel: arm.vessel,
    voyage: arm.voyage,
    arrivalDate: '2026-11-20',
    dischargeTerminal: 'Timber Port',
    dischargeCode: 'RUPLP',
    ports: Object.fromEntries(arm.loadingPorts.map((p) => [p.code, { pol: p.pol, terminal: p.terminal, fileCode: p.fileCode, billDate: '2026-10-25' }])),
    createWorkbook: () => new ExcelJS.Workbook(),
  };
  assert.deepEqual(validateOptions(arm, options), []);
  assert.equal(buildArmFiles(arm, options).length, arm.loadingPorts.length);

  const check = crossCheckSource(await fresh('ishodnyj-fajl-linii.xlsx'), await fresh('manifest-import.xlsx'));
  assert.equal(check.ok, true, check.error);
  assert.equal(check.summary.mismatchRows, 1);
  assert.equal(check.summary.notInSource, 0);
  assert.deepEqual(check.summary.missingInSystem, []);
});

/* ——— Маршруты ——— */

let s;
let plainCookie; // без прав на инструменты
let mergeCookie; // с правом на «Объединить манифесты»

before(async () => {
  s = await startTestServer();
  await s.addUser({ email: 'plain@test.ru', name: 'Без прав', password: 'пароль-без-прав' });
  await s.addUser({ email: 'merge@test.ru', name: 'Склейка', password: 'пароль-склейки', tools: ['merge'] });
  plainCookie = await s.login('plain@test.ru', 'пароль-без-прав');
  mergeCookie = await s.login('merge@test.ru', 'пароль-склейки');
});
after(() => s.close());

test('/help/<ключ> без входа — на вход с возвратом', async () => {
  const r = await s.fetch('/help/merge', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/login?next=${encodeURIComponent('/help/merge')}`);
});

test('/help/<ключ> без права — инструкция и «Запросить доступ»', async () => {
  const r = await s.fetch('/help/merge', { headers: { cookie: plainCookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const html = await r.text();
  assert.match(html, /<h1 class="page__title">Объединить манифесты<\/h1>/);
  assert.match(html, /<h2>Что загрузить<\/h2>/);
  assert.match(html, /Запросить доступ/);
  assert.match(html, /data-tool="merge"/);
  assert.doesNotMatch(html, /Открыть инструмент/);
  assert.match(html, /<script src="\/tools\.js"><\/script>/);
});

test('/help/<ключ> с правом — «Открыть инструмент» на страницу инструмента', async () => {
  const html = await (await s.fetch('/help/merge', { headers: { cookie: mergeCookie } })).text();
  assert.match(html, /<a class="btn" href="\/merge\/index\.html">Открыть инструмент<\/a>/);
  assert.doesNotMatch(html, /Запросить доступ/);
});

test('/help для каждого ключа каталога открывается', async () => {
  for (const key of catalog.keys) {
    const r = await s.fetch(`/help/${key}`, { headers: { cookie: plainCookie } });
    assert.equal(r.status, 200, key);
    const tool = catalog.tools.find((t) => t.key === key);
    const title = tool.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    assert.ok((await r.text()).includes(`<h1 class="page__title">${title}</h1>`), key);
  }
});

test('/help: неизвестный ключ и лишние сегменты — 404', async () => {
  for (const p of ['/help/nope', '/help/', '/help', '/help/merge/', '/help/merge/x', '/help/make-samples.js', '/help/help.test.js',
    '/help/samples', '/help/samples/']) {
    const r = await s.fetch(p, { headers: { cookie: plainCookie }, redirect: 'manual' });
    assert.equal(r.status, 404, p);
  }
});

test('/help/samples/<файл>: вошедшему — файл вложением', async () => {
  const r = await s.fetch('/help/samples/manifest-eksport-svod.xlsx', { headers: { cookie: plainCookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="manifest-eksport-svod\.xlsx"/);
  const body = Buffer.from(await r.arrayBuffer());
  assert.deepEqual(body, fs.readFileSync(join(SAMPLES_DIR, 'manifest-eksport-svod.xlsx')));
});

test('/help/samples: без входа — на вход, чужие пути и несуществующие файлы — 404', async () => {
  const anon = await s.fetch('/help/samples/manifest-eksport-svod.xlsx', { redirect: 'manual' });
  assert.equal(anon.status, 302);
  for (const p of ['/help/samples/nope.xlsx', '/help/samples/../merge.html', '/help/samples/%2e%2e/merge.html',
    '/help/samples/..%2fmerge.html', '/help/samples/%2e%2e%2f%2e%2e%2fCLAUDE.md', '/help/samples/x/y.xlsx',
    '/help/samples/.gitkeep']) {
    // fetch нормализует «..» в адресе сам — шлём как есть через http
    const r = await rawGet(p, { cookie: plainCookie });
    assert.equal(r.status, 404, p);
  }
});

// Запрос без нормализации пути (fetch схлопывает «/../»)
async function rawGet(path, headers) {
  const http = await import('node:http');
  const { hostname, port } = new URL(s.url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
}
