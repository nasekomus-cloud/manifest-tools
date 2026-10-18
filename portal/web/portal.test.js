// Помощники страниц портала: приветствие, даты, счётчики вкладок, галочки прав, подписи.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  greeting, formatWhen, formatDateTime, tabCounts, checkboxGroups, linkHint, LINK_HINTS,
  statusLabel, requestText, journalLine, toolNumber, loginUrl,
  formatUntil, guestLabel, guestLinkHint, tabCountText, contactText,
  themeKindLabel, themeStepIndex, THEME_KEY,
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

test('formatUntil: «ДД.ММ ЧЧ:ММ»', () => {
  assert.equal(formatUntil(new Date(2026, 9, 19, 9, 5).getTime()), '19.10 09:05');
  assert.equal(formatUntil(new Date(2027, 0, 2, 23, 0).getTime()), '02.01 23:00');
});

test('guestLabel: «тест до …» и «тест истёк» (в момент срока — уже истёк)', () => {
  const until = new Date(2026, 9, 19, 14, 30).getTime();
  assert.equal(guestLabel({ guest: true, expiresAt: until }, until - 1), 'тест до 19.10 14:30');
  assert.equal(guestLabel({ guest: true, expiresAt: until }, until), 'тест истёк');
  assert.equal(guestLabel({ guest: false, expiresAt: null }, until), '');
});

test('guestLinkHint: до какого времени ссылка открывает портал', () => {
  const until = new Date(2026, 9, 19, 14, 30).getTime();
  assert.equal(guestLinkHint(until), 'Ссылка открывает портал без пароля до 19.10 14:30. Передайте её только тому, кому нужно.');
});

test('tabCountText: «N из M» с недоступными, просто «N» без них', () => {
  assert.deepEqual(tabCountText({ allowed: 3, total: 7 }, true), { text: '3 из 7', label: 'доступно 3 из 7' });
  assert.deepEqual(tabCountText({ allowed: 3, total: 3 }, false), { text: '3', label: 'доступно 3' });
});

test('contactText: у тестового вместо служебной почты — «тестовая ссылка»', () => {
  assert.equal(contactText({ email: 'ira@x.ru', guest: false }), 'ira@x.ru');
  assert.equal(contactText({ email: 'guest-ab@guest.invalid', guest: true }), 'тестовая ссылка');
});

test('themeKindLabel: светлая / тёмная', () => {
  assert.equal(themeKindLabel('light'), 'светлая');
  assert.equal(themeKindLabel('dark'), 'тёмная');
  assert.equal(themeKindLabel('other'), '');
});

test('themeStepIndex: стрелки по кругу, Home/End, остальные клавиши — null', () => {
  assert.equal(themeStepIndex(0, 'ArrowRight', 10), 1);
  assert.equal(themeStepIndex(0, 'ArrowDown', 10), 1);
  assert.equal(themeStepIndex(9, 'ArrowRight', 10), 0);
  assert.equal(themeStepIndex(0, 'ArrowLeft', 10), 9);
  assert.equal(themeStepIndex(5, 'ArrowUp', 10), 4);
  assert.equal(themeStepIndex(5, 'Home', 10), 0);
  assert.equal(themeStepIndex(5, 'End', 10), 9);
  assert.equal(themeStepIndex(5, 'Enter', 10), null);
  assert.equal(themeStepIndex(5, 'a', 10), null);
});

test('THEME_KEY — тот же ключ, что у страниц без входа и shell-addon.js', () => {
  assert.equal(THEME_KEY, 'manifest-tools:theme');
});
