import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sandbox = { window: {}, URL };
vm.runInNewContext(readFileSync(fileURLToPath(new URL('./safe-next.js', import.meta.url)), 'utf8'), sandbox);
const safeNext = sandbox.window.safeNext;
const ORIGIN = 'https://tallyman.nasekomuspro.ru';

test('safeNext: чужие и подозрительные адреса — на главную', () => {
  for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '//evil.com', '/\\evil.com', '/\\/evil.com',
    'https://evil.com', 'http://evil.com/x', 'evil.com', 'javascript:alert(1)', '', null, undefined, 42, '/a\u0000b', '/a\u007fb', '/ /evil.com\t']) {
    assert.equal(safeNext(bad, ORIGIN), '/', JSON.stringify(bad));
  }
});

test('safeNext: параметр next после декодирования (/%09/evil.com)', () => {
  const decoded = new URLSearchParams('?next=/%09/evil.com').get('next');
  assert.equal(decoded, '/\t/evil.com');
  assert.equal(safeNext(decoded, ORIGIN), '/');
});

test('safeNext: путь внутри сайта проходит как есть', () => {
  for (const ok of ['/', '/merge/index.html', '/merge/index.html?x=1', '/journal', '/admin/users', '/merge/index.html#a']) {
    assert.equal(safeNext(ok, ORIGIN), ok);
  }
});
