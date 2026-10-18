// Каталог инструментов сайта и права пользователей.
//
// Источник каталога — корневой tools.js (обычный скрипт, window.TOOLS = [...]).
// Право на инструмент — ключ каталога: первый сегмент href
// ('bl-split/index.html' → 'bl-split'). Запись «Разделить коносаменты» стоит
// в tools.js дважды, но ключ один — одно право открывает обе записи.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

// Первый сегмент пути без ведущего слэша: 'bl-split/index.html' → 'bl-split'.
export function toolKey(href) {
  return href.split('/')[0];
}

// Исполняет tools.js в песочнице и возвращает записи с ключом.
// Порядок записей сохраняется; keys — уникальные ключи в порядке первого появления.
export function loadCatalog(siteRoot) {
  const src = readFileSync(join(siteRoot, 'tools.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  // JSON-копия: записи создаются в песочнице, а тесты и вызывающий код
  // работают с массивами и объектами основного контекста.
  const raw = JSON.parse(JSON.stringify(sandbox.window.TOOLS));
  const tools = raw.map((tool) => ({ ...tool, key: toolKey(tool.href) }));
  const keys = [...new Set(tools.map((tool) => tool.key))];
  return { tools, keys, deps: loadDeps(siteRoot, keys) };
}

// Зависимости между инструментами: страница <key>/index.html подключает скрипт
// или стиль из каталога другого инструмента (`<script src="../grand-total/app.js">`) —
// значит, владельцу <key> нужны не-HTML файлы того каталога. Считаются только
// теги script/link; обычные ссылки <a href> — переход на другую страницу, а не зависимость.
// deps: Map<ключ, Set<ключи, от которых он зависит>>, без самого себя.
function loadDeps(siteRoot, keys) {
  const deps = new Map();
  const known = new Set(keys);
  for (const key of keys) {
    const page = join(siteRoot, key, 'index.html');
    const found = new Set();
    if (existsSync(page)) {
      const html = readFileSync(page, 'utf8');
      for (const [, tag, attrs] of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
        const attr = tag.toLowerCase() === 'script' ? 'src' : 'href';
        const ref = new RegExp(`\\b${attr}\\s*=\\s*["']\\.\\./([^/"'?#]+)/`, 'i').exec(attrs);
        if (ref && known.has(ref[1]) && ref[1] !== key) found.add(ref[1]);
      }
    }
    deps.set(key, found);
  }
  return deps;
}

// Администратору — все ключи каталога; остальным — пересечение их прав с каталогом
// (неизвестные ключи в правах молча отбрасываются).
export function allowedKeys(user, userTools, catalog) {
  if (user.isAdmin) return new Set(catalog.keys);
  const known = new Set(catalog.keys);
  return new Set(userTools.filter((key) => known.has(key)));
}

// К какой части сайта относится путь:
// ключ каталога → инструмент, 'lib' → общий код, иначе — ничего из каталога.
// Страницы самого портала и подменённые файлы разбирает маршрутизатор портала.
export function classifyPath(catalog, pathname) {
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  if (first === 'lib') return { kind: 'lib' };
  if (catalog.keys.includes(first)) return { kind: 'tool', key: first };
  return { kind: 'none' };
}

// Текст tools.js только с разрешёнными записями (без служебного поля key).
export function renderToolsJs(catalog, allowed) {
  const entries = catalog.tools
    .filter((tool) => allowed.has(tool.key))
    .map(({ key, ...entry }) => entry);
  return `window.TOOLS = ${JSON.stringify(entries, null, 2)};\n`;
}
