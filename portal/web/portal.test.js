// Помощники страниц портала: приветствие, даты, счётчики вкладок, галочки прав, подписи.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  greeting, formatWhen, formatDateTime, tabCounts, checkboxGroups, linkHint, LINK_HINTS,
  statusLabel, requestText, journalLine, toolNumber, loginUrl,
} from './portal.js';

test('greeting: до 12 — утро, с 18 — вечер, между — день', () => {
  assert.equal(greeting(0), 'Доброе утро');
  assert.equal(greeting(11), 'Доброе утро');
  assert.equal(greeting(12), 'Добрый день');
  assert.equal(greeting(17), 'Добрый день');
  assert.equal(greeting(18), 'Добрый вечер');
  assert.equal(greeting(23), 'Добрый вечер');
});

test('formatWhen: сегодня — время, вчера — «вчера», раньше — дата', () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  assert.equal(formatWhen(new Date(2026, 9, 18, 9, 5).getTime(), now), '09:05');
  assert.equal(formatWhen(new Date(2026, 9, 17, 23, 59).getTime(), now), 'вчера, 23:59');
  assert.equal(formatWhen(new Date(2026, 9, 2, 10, 42).getTime(), now), '02.10, 10:42');
  assert.equal(formatWhen(new Date(2025, 11, 31, 10, 42).getTime(), now), '31.12.2025, 10:42');
  // первое число месяца: «вчера» — последнее число прошлого
  assert.equal(formatWhen(new Date(2026, 8, 30, 8, 0).getTime(), new Date(2026, 9, 1, 8, 0).getTime()), 'вчера, 08:00');
});

test('formatDateTime: полная дата', () => {
  assert.equal(formatDateTime(new Date(2026, 9, 18, 7, 3).getTime()), '18.10.2026, 07:03');
});

const TOOLS = [
  { key: 'template-check', num: 1, title: 'Шаблон', category: 'export', allowed: true },
  { key: 'merge', num: 2, title: 'Склейка', category: 'export', allowed: false },
  { key: 'source-audit', num: 8, title: 'Исходный', category: 'import', allowed: false },
  { key: 'bl-split', num: 6, title: 'Коносаменты', category: 'import', allowed: true },
  { key: 'bl-split', num: 6, title: 'Коносаменты', category: 'export', allowed: true },
];

test('tabCounts: «N из M» по каждой записи вкладки', () => {
  assert.deepEqual(tabCounts(TOOLS), { export: { allowed: 2, total: 3 }, import: { allowed: 1, total: 2 } });
  assert.deepEqual(tabCounts([]), { export: { allowed: 0, total: 0 }, import: { allowed: 0, total: 0 } });
});

test('checkboxGroups: одна галочка на ключ, bl-split — в вкладке первого появления', () => {
  const groups = checkboxGroups(TOOLS);
  assert.deepEqual(groups.map((g) => [g.label, g.tools.map((t) => t.key)]), [
    ['Экспорт', ['template-check', 'merge']],
    ['Импорт', ['source-audit', 'bl-split']],
  ]);
});

test('linkHint: приглашение — 7 дней, сброс — 24 часа', () => {
  assert.equal(linkHint('http://localhost:8010/invite/abc'), LINK_HINTS.invite);
  assert.match(LINK_HINTS.invite, /7 дней\.$/);
  assert.equal(linkHint('https://tallyman.nasekomuspro.ru/reset/abc'), LINK_HINTS.reset);
  assert.match(LINK_HINTS.reset, /24 часа\.$/);
});

test('statusLabel и requestText', () => {
  assert.equal(statusLabel('invited'), 'приглашён');
  assert.equal(statusLabel('active'), 'активен');
  assert.equal(statusLabel('disabled'), 'отключён');
  assert.equal(requestText({ userName: 'Ира', tool: 'merge', toolTitle: 'Объединить манифесты' }), 'Ира просит доступ к «Объединить манифесты»');
  assert.equal(requestText({ userName: 'Ира', tool: null, toolTitle: null }), 'Ира не может войти');
});

test('journalLine: «<время> — <инструмент>, <итог>»', () => {
  const now = new Date(2026, 9, 18, 15, 0).getTime();
  const at = new Date(2026, 9, 18, 10, 42).getTime();
  assert.equal(journalLine({ at, toolTitle: 'Склейка', summary: '3 файлов · 455 строк' }, now), '10:42 — Склейка, 3 файлов · 455 строк');
  assert.equal(journalLine({ at, tool: 'merge', toolTitle: null, summary: '' }, now), '10:42 — merge');
});

test('toolNumber и loginUrl', () => {
  assert.equal(toolNumber({ num: 5 }), '№ 5');
  assert.equal(toolNumber({}), '');
  assert.equal(loginUrl('/'), '/login');
  assert.equal(loginUrl('/admin/users'), '/login?next=%2Fadmin%2Fusers');
});
