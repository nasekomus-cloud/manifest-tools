// Отдача файлов: разбор пути запроса и безопасное чтение с диска.
//
// Принцип: путь разбирается строго, а всё сомнительное — 404 без объяснений.
// Что именно можно отдать, решает app.js (таблица прав); здесь только то,
// что делает чтение файлов безопасным вне зависимости от таблицы.

import { readFile, realpath, stat } from 'node:fs/promises';
import { join, sep, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function mimeFor(file) {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Разбирает путь из адреса запроса (без query и #). Возвращает null, если путь
 * надо отвергнуть, иначе { segments, trailingSlash, path }:
 * segments — сегменты без пустых, path — нормализованный путь (со слэшем в конце,
 * если он был). Отвергается всё, что:
 *  - не декодируется или содержит управляющие символы, NUL, обратный слэш;
 *  - содержит пустой сегмент в середине («//»);
 *  - содержит сегмент, начинающийся с точки («.», «..», «.git», «.env»).
 * Декодирование одно: «%252e» остаётся буквальным «%2e» и никакого файла не найдёт.
 */
export function parsePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  const parts = decoded.slice(1).split('/');
  const trailingSlash = parts[parts.length - 1] === '';
  if (trailingSlash) parts.pop();
  for (const part of parts) {
    if (part === '' || part.startsWith('.')) return null;
  }
  const path = '/' + parts.join('/') + (trailingSlash && parts.length > 0 ? '/' : '');
  return { segments: parts, trailingSlash, path };
}

/** Тесты лежат рядом с кодом в репозитории и наружу не отдаются никогда. */
export function isTestFile(segments) {
  const last = segments[segments.length - 1] ?? '';
  return last.toLowerCase().endsWith('.test.js');
}

/**
 * Читатель файлов под одним корнем сайта.
 * serve(baseDir, segments, trailingSlash):
 *   { body, type }       — файл (у каталога берётся index.html);
 *   { redirectSlash }    — каталог без «/» в конце, надо добавить;
 *   null                 — нет такого файла или он вне baseDir.
 * baseDir — абсолютный путь внутри корня; путь после realpath обязан остаться
 * внутри baseDir (символьные ссылки наружу не работают).
 */
export function createFileServer() {
  async function serve(baseDir, segments, trailingSlash = false) {
    let base;
    let full;
    try {
      base = await realpath(baseDir);
      full = await realpath(join(base, ...segments));
    } catch {
      return null;
    }
    if (full !== base && !full.startsWith(base + sep)) return null;
    let info;
    try {
      info = await stat(full);
    } catch {
      return null;
    }
    if (info.isDirectory()) {
      if (!trailingSlash && segments.length > 0) return { redirectSlash: true };
      return readOne(join(full, 'index.html'), base);
    }
    if (!info.isFile()) return null;
    return readOne(full, base);
  }

  async function readOne(file, base) {
    try {
      const real = await realpath(file);
      if (!real.startsWith(base + sep)) return null;
      return { body: await readFile(real), type: mimeFor(real) };
    } catch {
      return null;
    }
  }

  return { serve };
}
