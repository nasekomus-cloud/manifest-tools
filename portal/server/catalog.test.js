import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadCatalog, toolKey, allowedKeys, classifyPath, renderToolsJs } from './catalog.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const catalog = loadCatalog(repoRoot);

const ALL_KEYS = [
  'arm-upload', 'bl-registry', 'bl-split', 'dashboard', 'dashboard-departure',
  'dg-check', 'grand-total', 'grand-total-import', 'merge', 'order-check',
  'source-audit', 'source-check', 'template-check',
];

test('loadCatalog: 14 записей, 13 уникальных ключей', () => {
  assert.equal(catalog.tools.length, 14);
  assert.equal(catalog.keys.length, 13);
  assert.deepEqual([...catalog.keys].sort(), ALL_KEYS);
});

test('loadCatalog: у каждой записи есть key, производный от href', () => {
  for (const tool of catalog.tools) {
    assert.equal(tool.key, toolKey(tool.href));
  }
});

test('loadCatalog: порядок записей сохраняется, keys — в порядке первого появления', () => {
  assert.equal(catalog.tools[0].href, 'template-check/index.html');
  assert.equal(catalog.tools[catalog.tools.length - 1].href, 'dashboard/index.html');
  assert.equal(catalog.keys[0], 'template-check');
  assert.equal(new Set(catalog.keys).size, catalog.keys.length);
});

test('toolKey: первый сегмент пути', () => {
  assert.equal(toolKey('bl-split/index.html'), 'bl-split');
  assert.equal(toolKey('grand-total-import/index.html'), 'grand-total-import');
  assert.equal(toolKey('merge/index.html'), 'merge');
});

test('одно право на обе записи «Разделить коносаменты»', () => {
  const src = renderToolsJs(catalog, new Set(['bl-split']));
  const window = {};
  vm.runInNewContext(src, { window });
  assert.equal(window.TOOLS.length, 2);
  assert.ok(window.TOOLS.every((t) => t.href === 'bl-split/index.html' && !('key' in t)));
});

test('classifyPath', () => {
  assert.deepEqual(classifyPath(catalog, '/merge/app.js'), { kind: 'tool', key: 'merge' });
  assert.deepEqual(classifyPath(catalog, '/lib/manifest-format.js'), { kind: 'lib' });
  assert.deepEqual(classifyPath(catalog, '/portal/server/db.js'), { kind: 'none' });
  assert.deepEqual(classifyPath(catalog, '/'), { kind: 'none' });
  assert.deepEqual(classifyPath(catalog, '/tools.js'), { kind: 'none' });
});

test('allowedKeys: администратору все ключи каталога, права из списка не нужны', () => {
  const admin = { isAdmin: true };
  const allowed = allowedKeys(admin, [], catalog);
  assert.ok(allowed instanceof Set);
  assert.equal(allowed.size, 13);
  assert.deepEqual([...allowed].sort(), ALL_KEYS);
});

test('allowedKeys: коллеге — только известные ключи из его списка', () => {
  const user = { isAdmin: false };
  const allowed = allowedKeys(user, ['merge', 'unknown-key'], catalog);
  assert.ok(allowed instanceof Set);
  assert.deepEqual([...allowed], ['merge']);
});

test('allowedKeys: коллеге без прав — пустой набор', () => {
  const allowed = allowedKeys({ isAdmin: false }, [], catalog);
  assert.equal(allowed.size, 0);
});

test('renderToolsJs: только разрешённые записи, без поля key, в исходном порядке', () => {
  const src = renderToolsJs(catalog, new Set(['merge', 'dashboard']));
  assert.match(src, /^window\.TOOLS = \[/);
  assert.match(src, /;\s*$/);
  const window = {};
  vm.runInNewContext(src, { window });
  // Массив из песочницы другого realm: копируем в основной, иначе deepStrictEqual сравнит прототипы.
  assert.deepEqual([...window.TOOLS].map((t) => t.href), ['merge/index.html', 'dashboard/index.html']);
  assert.ok(window.TOOLS.every((t) => !('key' in t)));
  assert.equal(window.TOOLS[0].num, 2);
});

test('deps: grand-total-import тянет скрипт из grand-total, больше ни у кого зависимостей нет', () => {
  assert.deepEqual([...catalog.deps.get('grand-total-import')], ['grand-total']);
  for (const key of catalog.keys) {
    assert.ok(catalog.deps.has(key), key);
    assert.ok(!catalog.deps.get(key).has(key), `${key} не зависит от себя`);
    if (key !== 'grand-total-import') assert.equal(catalog.deps.get(key).size, 0, key);
  }
});

test('deps: обычная ссылка <a href="../source-audit/…"> зависимостью не считается', () => {
  assert.equal(catalog.deps.get('arm-upload').has('source-audit'), false);
});
