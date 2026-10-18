// «Показывать недоступные инструменты» — настройка на каждого человека (по умолчанию выключена).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './test-helpers.js';

let s;
let closed; // коллега без show_locked, право только на merge
let open; // коллега с show_locked, право только на merge
let adminCookie;
let closedUser;
let openUser;
let admin;

const get = (cookie) => ({ headers: { Cookie: cookie }, redirect: 'manual' });
const post = (cookie, body) => ({ method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(body) });
const put = (cookie, body) => ({ method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify(body) });

before(async () => {
  s = await startTestServer();
  closedUser = await s.addUser({ email: 'closed@x.ru', name: 'Закрытая', password: 'пароль-123', tools: ['merge'] });
  openUser = await s.addUser({ email: 'open@x.ru', name: 'Открытая', password: 'пароль-123', tools: ['merge'], showLocked: true });
  admin = await s.addUser({ email: 'boss@x.ru', name: 'Босс', password: 'пароль-босса', isAdmin: true });
  closed = await s.login('closed@x.ru', 'пароль-123');
  open = await s.login('open@x.ru', 'пароль-123');
  adminCookie = await s.login('boss@x.ru', 'пароль-босса');
});
after(() => s.close());

test('/api/me без show_locked: только доступные инструменты и showLocked: false', async () => {
  const me = await (await s.fetch('/api/me', get(closed))).json();
  assert.equal(me.user.showLocked, false);
  assert.equal(me.user.guest, false);
  assert.equal(me.user.expiresAt, null);
  assert.ok(me.tools.length > 0);
  assert.ok(me.tools.every((t) => t.allowed === true));
  assert.deepEqual([...new Set(me.tools.map((t) => t.key))], ['merge']);
});

test('/api/me с show_locked: весь каталог с признаком allowed', async () => {
  const me = await (await s.fetch('/api/me', get(open))).json();
  assert.equal(me.user.showLocked, true);
  assert.equal(me.tools.length, s.catalog.tools.length);
  assert.ok(me.tools.some((t) => !t.allowed));
});

test('администратору настройка ни на что не влияет', async () => {
  const me = await (await s.fetch('/api/me', get(adminCookie))).json();
  assert.equal(me.user.showLocked, false);
  assert.equal(me.tools.length, s.catalog.tools.length);
  assert.ok(me.tools.every((t) => t.allowed));
  assert.equal((await s.fetch('/dg-check/index.html', get(adminCookie))).status, 200);
  assert.equal((await s.fetch('/help/dg-check', get(adminCookie))).status, 200);
});

test('закрытый инструмент без show_locked — 404 «не найдено», с show_locked — 403 с кнопкой', async () => {
  for (const path of ['/dg-check/index.html', '/dg-check/', '/dg-check', '/dg-check/app.js', '/grand-total/app.js']) {
    const r = await s.fetch(path, get(closed));
    assert.equal(r.status, 404, path);
    const text = await r.text();
    assert.equal(text, 'Не найдено', path);
  }
  const r = await s.fetch('/dg-check/index.html', get(open));
  assert.equal(r.status, 403);
  assert.ok((await r.text()).includes('Запросить доступ'));
  // свой инструмент открывается как раньше
  assert.equal((await s.fetch('/merge/index.html', get(closed))).status, 200);
});

test('справка закрытого инструмента без show_locked — 404, своя — 200', async () => {
  const r = await s.fetch('/help/dg-check', get(closed));
  assert.equal(r.status, 404);
  assert.equal(await r.text(), 'Не найдено');
  assert.equal((await s.fetch('/help/merge', get(closed))).status, 200);
  const withButton = await s.fetch('/help/dg-check', get(open));
  assert.equal(withButton.status, 200);
  assert.ok((await withButton.text()).includes('Запросить доступ'));
});

test('зависимости (R5) работают и без show_locked', async () => {
  const u = await s.addUser({ email: 'gti@x.ru', name: 'Импорт', password: 'пароль-123', tools: ['grand-total-import'] });
  assert.equal(u.showLocked, false);
  const c = await s.login('gti@x.ru', 'пароль-123');
  assert.equal((await s.fetch('/grand-total/app.js', get(c))).status, 200);
  assert.equal((await s.fetch('/grand-total/index.html', get(c))).status, 404);
});

test('POST /api/requests без show_locked — 403, запрос не создаётся', async () => {
  const r = await s.fetch('/api/requests', post(closed, { tool: 'dg-check' }));
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'Запросы доступа отключены' });
  assert.equal(s.db.listRequests().filter((x) => x.userId === closedUser.id).length, 0);
  // с show_locked — как раньше
  const ok = await s.fetch('/api/requests', post(open, { tool: 'dg-check' }));
  assert.equal(ok.status, 201);
  assert.equal(s.db.listRequests().filter((x) => x.userId === openUser.id).length, 1);
});

test('PUT /api/admin/users/<id>/settings: сохраняет showLocked, только администратору, не администраторам', async () => {
  const path = `/api/admin/users/${closedUser.id}/settings`;
  assert.equal((await s.fetch(path, { method: 'PUT', body: JSON.stringify({ showLocked: true }) })).status, 401);
  assert.equal((await s.fetch(path, put(closed, { showLocked: true }))).status, 403);
  assert.equal(s.db.getUserById(closedUser.id).showLocked, false);

  for (const body of [{}, { showLocked: 'да' }, { showLocked: 1 }, { showLocked: null }]) {
    assert.equal((await s.fetch(path, put(adminCookie, body))).status, 400, JSON.stringify(body));
  }
  assert.equal((await s.fetch(`/api/admin/users/99999/settings`, put(adminCookie, { showLocked: true }))).status, 404);
  assert.equal((await s.fetch(`/api/admin/users/${admin.id}/settings`, put(adminCookie, { showLocked: true }))).status, 400);

  const r = await s.fetch(path, put(adminCookie, { showLocked: true }));
  assert.equal(r.status, 200);
  const { user } = await r.json();
  assert.equal(user.id, closedUser.id);
  assert.equal(user.showLocked, true);
  assert.deepEqual(user.tools, ['merge']);
  // сразу действует: та же сессия видит весь каталог
  const me = await (await s.fetch('/api/me', get(closed))).json();
  assert.equal(me.tools.length, s.catalog.tools.length);

  const back = await s.fetch(path, put(adminCookie, { showLocked: false }));
  assert.equal((await back.json()).user.showLocked, false);
  assert.equal((await s.fetch('/dg-check/index.html', get(closed))).status, 404);
});

test('POST /api/admin/users: showLocked необязателен (по умолчанию false), не булево — 400', async () => {
  const a = await (await s.fetch('/api/admin/users', post(adminCookie, { email: 'n1@x.ru', name: 'Н1' }))).json();
  assert.equal(a.user.showLocked, false);
  const b = await (await s.fetch('/api/admin/users', post(adminCookie, { email: 'n2@x.ru', name: 'Н2', showLocked: true }))).json();
  assert.equal(b.user.showLocked, true);
  assert.equal(s.db.getUserById(b.user.id).showLocked, true);
  const bad = await s.fetch('/api/admin/users', post(adminCookie, { email: 'n3@x.ru', name: 'Н3', showLocked: 'yes' }));
  assert.equal(bad.status, 400);
  assert.equal(s.db.getUserByEmail('n3@x.ru'), null);
});

test('GET /api/admin/users отдаёт showLocked, guest и expiresAt', async () => {
  const list = await (await s.fetch('/api/admin/users', get(adminCookie))).json();
  const o = list.find((u) => u.id === openUser.id);
  assert.equal(o.showLocked, true);
  assert.equal(o.guest, false);
  assert.equal(o.expiresAt, null);
});
