// Палитры тем в portal/web/theme.css сверяются со списком тем сервера (portal/server/themes.js):
// у каждой темы есть свой блок, тип светлая/тёмная совпадает, RGB-тройки равны HEX.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, DEFAULT_THEME } from '../server/themes.js';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');

test('theme.css: блок палитры на каждую тему, тип светлая/тёмная совпадает со списком, RGB = HEX', () => {
  const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255].join(', ');
  };
  for (const theme of THEMES) {
    // Блок палитры: «/* palette:<id> */ … { … }»
    const match = css.match(new RegExp(`/\\* palette:${theme.id} \\*/[^{]*\\{([^}]*)\\}`));
    assert.ok(match, `нет палитры ${theme.id}`);
    const block = match[1];
    const value = (name) => block.match(new RegExp(`--tm-${name}:\\s*([^;]+);`))?.[1].trim();
    for (const name of ['bg', 'surface', 'line', 'ink', 'muted', 'accent', 'primary', 'on-primary', 'warn', 'warn-bg', 'error', 'error-bg']) {
      assert.ok(value(name), `${theme.id}: нет --tm-${name}`);
    }
    for (const name of ['ink', 'muted', 'accent', 'warn', 'error']) {
      const hex = value(name);
      if (/^#[0-9a-f]{6}$/i.test(hex)) assert.equal(value(`${name}-rgb`), hexToRgb(hex), `${theme.id}: --tm-${name}-rgb`);
      else assert.ok(value(`${name}-rgb`), `${theme.id}: нет --tm-${name}-rgb`);
    }
    assert.match(block, new RegExp(`color-scheme:\\s*${theme.kind}`), `${theme.id}: color-scheme`);
  }
  // Общие производные цвета: тёмные темы (кроме «Глубины» — она на :root) и светлые — своими списками
  for (const kind of ['dark', 'light']) {
    const match = css.match(new RegExp(`/\\* derived:${kind} \\*/([^{]*)\\{`));
    assert.ok(match, `нет общих цветов ${kind}`);
    const ids = [...match[1].matchAll(/:root\[data-theme="([a-z]+)"\]/g)].map((m) => m[1]);
    const expected = THEMES.filter((t) => t.kind === kind && t.id !== DEFAULT_THEME).map((t) => t.id);
    assert.deepEqual(ids, expected, kind);
  }
});
