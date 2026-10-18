// Тестовая ссылка: вход без логина и пароля на срок, который выставляет администратор.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TEST_ORIGIN } from './test-helpers.js';
import { hashToken } from './tokens.js';
import { dailyCleanup, JOURNAL_KEEP_MS } from './cleanup.js';

const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 18, 9, 0);
const GONE_TEXT = 'Тестовая ссылка больше не действует — срок истёк или доступ отключён.';

const post = (cookie, body) => ({ method: 'POST', headers: cookie ? { Cookie: cookie } : {}, body: JSON.stringify(body) });
const get = (cookie) => ({ headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
const tokenOf = (link) => link.split('/').pop();

async function setup() {
  const clock = { now: START };
  const s = await startTestServer({ now: () => clock.now });
  await s.addUser({ email: 'boss@x.ru', name: 'Босс', password: 'пароль-босса', isAdmin: true });
  await s.addUser({ email: 'lena@x.ru', name: 'Лена', password: 'пароль-лены', tools: ['merge'] });
  const adminCookie = await s.login('boss@x.ru', 'пароль-босса');
  const lenaCookie = await s.login('lena@x.ru', 'пароль-лены');
  async function createGuest(body = {}) {
    const r = await s.fetch('/api/admin/guests', post(adminCookie, { name: 'Тест для ООО Ромашка', tools: ['merge'], ...body }));
    assert.equal(r.status, 201);
    return r.json();
  }
  /** Открывает ссылку без cookie; возвращает ответ и cookie новой сессии (если есть). */
  async function open(link) {
    const r = await fetch(link.replace(TEST_ORIGIN, s.url), { redirect: 'manual' });
    const setCookie = r.headers.get('set-cookie');
    return { r, cookie: setCookie ? setCookie.split(';')[0] : null, text: await r.text() };
  }
  return { s, clock, adminCookie, lenaCookie, createGuest, open };
}

test('POST /api/admin/guests: только администратору', async () => {
  const { s, lenaCookie } = await setup();
  try {
    assert.equal((await s.fetch('/api/admin/guests', post(null, { name: 'Т' }))).status, 401);
    assert.equal((await s.fetch('/api/admin/guests', post(lenaCookie, { name: 'Т' }))).status, 403);
    assert.equal(s.db.listUsers().length, 2);
  } finally { await s.close(); }
});

test('POST /api/admin/guests: тестовый человек на 24 часа по умолчанию, ссылка и служебная почта', async () => {
  const { s, createGuest } = await setup();
  try {
    const { user, link } = await createGuest();
    assert.equal(user.name, 'Тест для ООО Ромашка');
    assert.equal(user.guest, true);
    assert.equal(user.status, 'active');
    assert.equal(user.isAdmin, false);
    assert.equal(user.showLocked, false);
    assert.equal(user.expiresAt, START + 24 * HOUR);
    assert.deepEqual(user.tools, ['merge']);
    assert.match(user.email, /^guest-[0-9a-f]{24}@guest\.invalid$/);
    assert.match(link, new RegExp(`^${TEST_ORIGIN}/guest/[\\w-]{43}$`));
    assert.equal(s.db.getPasswordHash(user.id), null);
    // в базе хеш ссылки и сам токен (R23 — чтобы скопировать ссылку снова), срок ссылки = срок человека
    const rows = s.db.raw.prepare("SELECT token_hash, raw, expires_at FROM tokens WHERE kind = 'guest'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, hashToken(tokenOf(link)));
    assert.equal(rows[0].raw, tokenOf(link));
    assert.equal(rows[0].expires_at, START + 24 * HOUR);
    // две ссылки — две разные служебные почты
    const second = await createGuest({ name: 'Второй', showLocked: true, hours: 1 });
    assert.notEqual(second.user.email, user.email);
    assert.equal(second.user.showLocked, true);
    assert.equal(second.user.expiresAt, START + HOUR);
  } finally { await s.close(); }
});

test('POST /api/admin/guests: срок 1–720 целых часов, название обязательно, кривое — 400 и ничего не создаётся', async () => {
  const { s, adminCookie, createGuest } = await setup();
  try {
    assert.equal((await createGuest({ hours: 720 })).user.expiresAt, START + 720 * HOUR);
    const bad = [
      { name: 'Т', hours: 0 }, { name: 'Т', hours: 721 }, { name: 'Т', hours: 1.5 }, { name: 'Т', hours: '24' },
      { name: 'Т', hours: -1 }, { name: 'Т', hours: null }, { name: '   ' }, {}, { name: 5 }, { name: 'x'.repeat(201) },
      { name: 'Т', tools: ['нет-такого'] }, { name: 'Т', tools: 'merge' }, { name: 'Т', showLocked: 'да' },
    ];
    for (const body of bad) {
      const r = await s.fetch('/api/admin/guests', post(adminCookie, body));
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const r = await s.fetch('/api/admin/guests', post(adminCookie, { name: 'Т', hours: 0 }));
    assert.deepEqual(await r.json(), { error: 'Срок — целое число часов от 1 до 720' });
    assert.equal(s.db.listUsers().length, 3);
  } finally { await s.close(); }
});

test('GET /guest/<токен>: сессия и переход на главную; ссылка многоразовая; видны только выданные инструменты', async () => {
  const { s, clock, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest();
    clock.now += HOUR;
    const first = await open(link);
    assert.equal(first.r.status, 302);
    assert.equal(first.r.headers.get('location'), '/');
    assert.ok(first.r.headers.get('set-cookie').includes('HttpOnly'));
    assert.ok(first.cookie.startsWith('lt_session='));
    const me = await (await s.fetch('/api/me', get(first.cookie))).json();
    assert.equal(me.user.id, user.id);
    assert.equal(me.user.guest, true);
    assert.equal(me.user.expiresAt, START + 24 * HOUR);
    assert.deepEqual([...new Set(me.tools.map((t) => t.key))], ['merge']);
    assert.equal(s.db.getUserById(user.id).lastLoginAt, START + HOUR);
    // закрытый инструмент — 404, как у любого без show_locked
    assert.equal((await s.fetch('/dg-check/index.html', get(first.cookie))).status, 404);
    assert.equal((await s.fetch('/merge/index.html', get(first.cookie))).status, 200);

    // второе открытие (другое устройство) — своя сессия, первая жива
    const second = await open(link);
    assert.equal(second.r.status, 302);
    assert.notEqual(second.cookie, first.cookie);
    assert.equal((await s.fetch('/api/me', get(first.cookie))).status, 200);
    assert.equal((await s.fetch('/api/me', get(second.cookie))).status, 200);

    // журнал пишется от его имени
    const j = await s.fetch('/api/journal', post(first.cookie, { tool: 'merge', kind: 'result', files: ['a.xlsx'], summary: 'ок' }));
    assert.equal(j.status, 204);
    assert.equal(s.db.listJournal({})[0].userName, 'Тест для ООО Ромашка');
  } finally { await s.close(); }
});

test('после срока: ссылка — 410 с текстом, старая сессия — 401, статус «отключён»', async () => {
  const { s, clock, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest({ hours: 2 });
    const { cookie } = await open(link);
    clock.now = START + 2 * HOUR - 1;
    assert.equal((await s.fetch('/api/me', get(cookie))).status, 200);
    clock.now = START + 2 * HOUR; // ровно в срок уже нельзя
    const me = await s.fetch('/api/me', get(cookie));
    assert.equal(me.status, 401);
    assert.equal(me.headers.get('set-cookie'), null);
    assert.equal(s.db.getUserById(user.id).status, 'disabled');
    assert.equal(s.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 0);
    // страницы ведут на вход
    const page = await s.fetch('/merge/index.html', get(cookie));
    assert.equal(page.status, 302);
    const gone = await open(link);
    assert.equal(gone.r.status, 410);
    assert.match(gone.r.headers.get('content-type'), /^text\/html/);
    assert.ok(gone.text.includes(GONE_TEXT));
    assert.equal(gone.cookie, null);
  } finally { await s.close(); }
});

test('после срока ссылка не действует и без запросов сессии; список людей показывает «отключён»', async () => {
  const { s, clock, adminCookie, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest({ hours: 1 });
    clock.now = START + HOUR;
    assert.equal((await open(link)).r.status, 410);
    clock.now = START; // даже если часы «вернулись», отключение уже записано
    assert.equal((await open(link)).r.status, 410);

    const other = await createGuest({ hours: 1, name: 'Другой' });
    clock.now = START + 5 * HOUR;
    const list = await (await s.fetch('/api/admin/users', get(adminCookie))).json();
    const row = list.find((u) => u.id === other.user.id);
    assert.equal(row.status, 'disabled');
    assert.equal(row.guest, true);
    assert.equal(row.expiresAt, START + HOUR);
    assert.equal(list.find((u) => u.id === user.id).status, 'disabled');
  } finally { await s.close(); }
});

test('«Продлить» до срока: срок от текущего момента, старая ссылка продолжает работать', async () => {
  const { s, clock, adminCookie, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest({ hours: 2 });
    clock.now = START + HOUR;
    const r = await s.fetch(`/api/admin/users/${user.id}/extend`, post(adminCookie, { hours: 48 }));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.user.expiresAt, START + HOUR + 48 * HOUR);
    assert.equal(data.user.status, 'active');
    assert.equal(data.link, undefined); // старая ссылка жива — новая не нужна
    clock.now = START + 10 * HOUR; // старый срок прошёл, новый — нет
    assert.equal((await open(link)).r.status, 302);
  } finally { await s.close(); }
});

test('«Продлить» после срока оживляет: статус «активен», новая ссылка в ответе (старую погасило истечение)', async () => {
  const { s, clock, adminCookie, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest({ hours: 1 });
    clock.now = START + 3 * HOUR;
    assert.equal((await open(link)).r.status, 410);
    const r = await s.fetch(`/api/admin/users/${user.id}/extend`, post(adminCookie, { hours: 5 }));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.user.status, 'active');
    assert.equal(data.user.expiresAt, START + 8 * HOUR);
    assert.match(data.link, new RegExp(`^${TEST_ORIGIN}/guest/[\\w-]{43}$`));
    assert.equal((await open(link)).r.status, 410);
    const fresh = await open(data.link);
    assert.equal(fresh.r.status, 302);
    assert.equal((await s.fetch('/api/me', get(fresh.cookie))).status, 200);
  } finally { await s.close(); }
});

test('«Продлить»: только тестовому, часы 1–720, по умолчанию 24', async () => {
  const { s, adminCookie, createGuest } = await setup();
  try {
    const { user } = await createGuest();
    const lena = s.db.getUserByEmail('lena@x.ru');
    assert.equal((await s.fetch(`/api/admin/users/${lena.id}/extend`, post(adminCookie, { hours: 5 }))).status, 400);
    assert.equal(s.db.getUserById(lena.id).expiresAt, null);
    for (const hours of [0, 721, 2.5, '3', null]) {
      assert.equal((await s.fetch(`/api/admin/users/${user.id}/extend`, post(adminCookie, { hours }))).status, 400, String(hours));
    }
    const r = await s.fetch(`/api/admin/users/${user.id}/extend`, post(adminCookie, {}));
    assert.equal((await r.json()).user.expiresAt, START + 24 * HOUR);
    assert.equal((await s.fetch('/api/admin/users/99999/extend', post(adminCookie, { hours: 1 }))).status, 404);
  } finally { await s.close(); }
});

test('«Новая ссылка» тестовому: guest-ссылка на текущий срок, старая отозвана, вошедшие по ней вышли', async () => {
  const { s, clock, adminCookie, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest({ hours: 10 });
    const { cookie: oldSession } = await open(link); // кто-то уже вошёл по прежней ссылке
    assert.equal((await s.fetch('/api/me', get(oldSession))).status, 200);
    clock.now = START + HOUR;
    const r = await s.fetch(`/api/admin/users/${user.id}/link`, post(adminCookie, {}));
    assert.equal(r.status, 200);
    const { link: next } = await r.json();
    assert.match(next, new RegExp(`^${TEST_ORIGIN}/guest/[\\w-]{43}$`));
    assert.equal((await open(link)).r.status, 410);
    // ссылку перевыпускают, когда прежняя утекла: все, кто вошёл по ней, выходят
    assert.equal((await s.fetch('/api/me', get(oldSession))).status, 401);
    assert.equal(s.db.getUserById(user.id).status, 'active');
    assert.equal((await open(next)).r.status, 302);
    assert.equal(s.db.getUserById(user.id).expiresAt, START + 10 * HOUR);
    const row = s.db.raw.prepare('SELECT expires_at FROM tokens WHERE token_hash = ?').get(hashToken(tokenOf(next)));
    assert.equal(row.expires_at, START + 10 * HOUR);
  } finally { await s.close(); }
});

test('«Отключить» тестового гасит сразу; «Включить» у тестового нет — 409', async () => {
  const { s, adminCookie, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest();
    const { cookie } = await open(link);
    assert.equal((await s.fetch(`/api/admin/users/${user.id}/disable`, post(adminCookie, {}))).status, 200);
    assert.equal((await s.fetch('/api/me', get(cookie))).status, 401);
    const gone = await open(link);
    assert.equal(gone.r.status, 410);
    assert.ok(gone.text.includes(GONE_TEXT));
    const enable = await s.fetch(`/api/admin/users/${user.id}/enable`, post(adminCookie, {}));
    assert.equal(enable.status, 409);
    assert.equal(s.db.getUserById(user.id).status, 'disabled');
    // новую ссылку отключённому не выдать — сначала «Продлить»
    assert.equal((await s.fetch(`/api/admin/users/${user.id}/link`, post(adminCookie, {}))).status, 409);
  } finally { await s.close(); }
});

test('служебная почта тестового не пускает через /api/login и «Забыли пароль?»', async () => {
  const { s, createGuest } = await setup();
  try {
    const { user } = await createGuest();
    for (const password of ['', 'пароль-123', 'x'.repeat(10)]) {
      const r = await s.fetch('/api/login', post(null, { email: user.email, password }));
      assert.equal(r.status, 401);
    }
    const forgot = await s.fetch('/api/forgot', post(null, { email: user.email }));
    assert.equal(forgot.status, 200);
    await s.idle();
    assert.equal(s.db.listRequests().length, 0);
  } finally { await s.close(); }
});

test('POST /api/password для тестового — 403; запросы доступа без show_locked — 403', async () => {
  const { s, createGuest, open } = await setup();
  try {
    const { link } = await createGuest();
    const { cookie } = await open(link);
    const r = await s.fetch('/api/password', post(cookie, { current: '', password: 'новый-пароль-1' }));
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'У тестового доступа нет пароля' });
    assert.equal((await s.fetch('/api/requests', post(cookie, { tool: 'dg-check' }))).status, 403);
    assert.equal((await s.fetch('/api/logout', post(cookie, {}))).status, 200);
    assert.equal((await s.fetch('/api/me', get(cookie))).status, 401);
  } finally { await s.close(); }
});

test('/guest/ не входит за обычного человека: чужие виды токенов и guest-токен у не-тестового — 410', async () => {
  const { s, clock, open } = await setup();
  try {
    const lena = s.db.getUserByEmail('lena@x.ru');
    const forged = s.db.createToken({ userId: lena.id, kind: 'guest', expiresAt: clock.now + HOUR });
    const reset = s.db.createToken({ userId: lena.id, kind: 'reset', expiresAt: clock.now + HOUR });
    const invited = s.db.createUser({ email: 'new@x.ru', name: 'Новый' });
    const invite = s.db.createToken({ userId: invited.id, kind: 'invite', expiresAt: clock.now + HOUR });
    for (const t of [forged, reset, invite, 'нет-такого', 'x'.repeat(200)]) {
      const r = await open(`${TEST_ORIGIN}/guest/${encodeURIComponent(t)}`);
      assert.equal(r.r.status, 410, t.slice(0, 10));
      assert.equal(r.cookie, null);
    }
    for (const p of ['/guest', '/guest/', `/guest/${forged}/x`, `/guest/${forged}/`]) {
      const r = await s.fetch(p, get());
      assert.equal(r.status, 404, p);
    }
    // гостевые адреса — только GET/HEAD
    assert.equal((await s.fetch(`/guest/${forged}`, { method: 'POST' })).status, 405);
  } finally { await s.close(); }
});

test('ночная чистка: отключает просроченных и чистит журнал', async () => {
  const { s, clock, createGuest, open } = await setup();
  try {
    const short = await createGuest({ hours: 1 });
    const long = await createGuest({ hours: 100, name: 'Долгий' });
    const { cookie } = await open(short.link);
    s.db.addJournal({ userId: short.user.id, tool: 'merge', kind: 'result', files: [], summary: '', at: START - JOURNAL_KEEP_MS - 1 });
    clock.now = START + 2 * HOUR;
    const result = dailyCleanup(s.db, clock.now);
    assert.deepEqual(result, { journalRemoved: 1, usersDisabled: 1 });
    assert.equal(s.db.getUserById(short.user.id).status, 'disabled');
    assert.equal(s.db.getUserById(long.user.id).status, 'active');
    assert.equal(s.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(short.user.id).n, 0);
    assert.equal((await open(short.link)).r.status, 410);
    assert.equal((await s.fetch('/api/me', get(cookie))).status, 401);
  } finally { await s.close(); }
});

test('приглашение не может занять служебный адрес тестовых', async () => {
  const { s, adminCookie } = await setup();
  try {
    const r = await s.fetch('/api/admin/users', post(adminCookie, { email: 'guest-1@guest.invalid', name: 'Н' }));
    assert.equal(r.status, 400);
  } finally { await s.close(); }
});

test('«Продлить» после срока, когда уборка ещё не прошла: старая ссылка и сессии не оживают, в ответе новая ссылка', async () => {
  const { s, clock, adminCookie, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest({ hours: 1 });
    const { cookie } = await open(link);
    clock.now = START + 2 * HOUR; // срок вышел, но ни одного запроса тестового и ни одной уборки
    assert.equal(s.db.getUserById(user.id).status, 'active');
    const r = await s.fetch(`/api/admin/users/${user.id}/extend`, post(adminCookie, { hours: 5 }));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.user.status, 'active');
    assert.equal(data.user.expiresAt, START + 7 * HOUR);
    assert.match(data.link, new RegExp(`^${TEST_ORIGIN}/guest/[\\w-]{43}$`));
    assert.equal((await open(link)).r.status, 410);
    assert.equal((await s.fetch('/api/me', get(cookie))).status, 401);
    assert.equal((await open(data.link)).r.status, 302);
  } finally { await s.close(); }
});

test('HEAD /guest/<токен> не создаёт сессию (предзагрузка ссылок)', async () => {
  const { s, createGuest } = await setup();
  try {
    const { user, link } = await createGuest();
    const r = await fetch(link.replace(TEST_ORIGIN, s.url), { method: 'HEAD', redirect: 'manual' });
    assert.ok([200, 302].includes(r.status), String(r.status));
    assert.equal(r.headers.get('set-cookie'), null);
    assert.equal(s.db.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 0);
    assert.equal(s.db.getUserById(user.id).lastLoginAt, null);
    const bad = await fetch(`${s.url}/guest/нет-такого`, { method: 'HEAD', redirect: 'manual' });
    assert.equal(bad.status, 410);
  } finally { await s.close(); }
});

// ── «Скопировать ссылку» и «Удалить» (R22, R23) ─────────────────────────────

const del = (cookie, headers = {}) => ({ method: 'DELETE', headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });

test('GET /api/admin/users: тестовому — действующая ссылка (link), остальным — нет', async () => {
  const { s, adminCookie, createGuest } = await setup();
  try {
    const { user, link } = await createGuest();
    const list = async () => (await s.fetch('/api/admin/users', get(adminCookie))).json();
    let users = await list();
    assert.equal(users.find((u) => u.id === user.id).link, link);
    for (const u of users.filter((x) => !x.guest)) assert.ok(!('link' in u), u.name);
    // в базе — и хеш, и сам токен; у приглашения и сброса сам токен не хранится
    assert.equal(s.db.raw.prepare("SELECT COUNT(*) AS n FROM tokens WHERE raw IS NOT NULL AND kind != 'guest'").get().n, 0);
    const invited = await s.fetch('/api/admin/users', post(adminCookie, { email: 'new@x.ru', name: 'Новенький' }));
    assert.equal(invited.status, 201);
    assert.ok(!('link' in (await invited.json()).user));
    users = await list();
    assert.ok(!('link' in users.find((u) => u.email === 'new@x.ru')));

    // «Новая ссылка» — в списке уже она
    const next = (await (await s.fetch(`/api/admin/users/${user.id}/link`, post(adminCookie, {}))).json()).link;
    assert.notEqual(next, link);
    assert.equal((await list()).find((u) => u.id === user.id).link, next);
    // ответы на действия со строкой тоже несут ссылку — страница не теряет кнопку
    const tools = await (await s.fetch(`/api/admin/users/${user.id}/tools`, { method: 'PUT', headers: { Cookie: adminCookie }, body: JSON.stringify({ tools: [] }) })).json();
    assert.equal(tools.user.link, next);
    // отключили — ссылки нет
    await s.fetch(`/api/admin/users/${user.id}/disable`, post(adminCookie, {}));
    assert.ok(!('link' in (await list()).find((u) => u.id === user.id)));
  } finally { await s.close(); }
});

test('GET /api/admin/users: старая тестовая ссылка без raw — link нет; истёкшая — нет', async () => {
  const { s, clock, adminCookie, createGuest } = await setup();
  try {
    const old = (await createGuest({ name: 'Старый' })).user;
    s.db.raw.prepare('UPDATE tokens SET raw = NULL WHERE user_id = ?').run(old.id); // выдана до R23
    const short = (await createGuest({ name: 'Короткий', hours: 1 })).user;
    clock.now += HOUR;
    const users = await (await s.fetch('/api/admin/users', get(adminCookie))).json();
    assert.ok(!('link' in users.find((u) => u.id === old.id)));
    assert.ok(!('link' in users.find((u) => u.id === short.id)));
  } finally { await s.close(); }
});

test('DELETE /api/admin/users/<id>: тестовый удаляется целиком, сессия — 401, ссылка — 410, журнал с именем остаётся', async () => {
  const { s, adminCookie, createGuest, open } = await setup();
  try {
    const { user, link } = await createGuest({ showLocked: true });
    const { cookie } = await open(link);
    assert.equal((await s.fetch('/api/journal', post(cookie, { tool: 'merge', kind: 'result', files: ['a.xlsx'], summary: 'ок' }))).status, 204);
    assert.equal((await s.fetch('/api/requests', post(cookie, { tool: 'dg-check' }))).status, 201);

    const r = await s.fetch(`/api/admin/users/${user.id}`, del(adminCookie));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(s.db.getUserById(user.id), null);
    assert.equal((await s.fetch('/api/me', get(cookie))).status, 401);
    const gone = await open(link);
    assert.equal(gone.r.status, 410);
    assert.ok(gone.text.includes(GONE_TEXT));
    const users = await (await s.fetch('/api/admin/users', get(adminCookie))).json();
    assert.ok(!users.some((u) => u.id === user.id));
    assert.equal(s.db.listRequests().length, 0);
    const journal = await (await s.fetch('/api/journal', get(adminCookie))).json();
    assert.equal(journal.length, 1);
    assert.equal(journal[0].userName, 'Тест для ООО Ромашка');
    assert.deepEqual(journal[0].files, ['a.xlsx']);
    // второй раз — такого уже нет
    assert.equal((await s.fetch(`/api/admin/users/${user.id}`, del(adminCookie))).status, 404);
  } finally { await s.close(); }
});

test('DELETE /api/admin/users/<id>: обычного человека и администратора — 400, коллеге — 403, без входа — 401, без Origin — 403', async () => {
  const { s, adminCookie, lenaCookie, createGuest } = await setup();
  try {
    const { user } = await createGuest();
    const lena = s.db.getUserByEmail('lena@x.ru');
    const boss = s.db.getUserByEmail('boss@x.ru');
    for (const target of [lena, boss]) {
      const r = await s.fetch(`/api/admin/users/${target.id}`, del(adminCookie));
      assert.equal(r.status, 400);
      assert.deepEqual(await r.json(), { error: 'Удалять можно только тестовые доступы' });
      assert.ok(s.db.getUserById(target.id));
    }
    assert.equal((await s.fetch(`/api/admin/users/${user.id}`, del(lenaCookie))).status, 403);
    assert.equal((await s.fetch(`/api/admin/users/${user.id}`, del(null))).status, 401);
    assert.equal((await s.fetch(`/api/admin/users/${user.id}`, del(adminCookie, { Origin: 'https://evil.example' }))).status, 403);
    assert.equal((await s.fetch('/api/admin/users/abc', del(adminCookie))).status, 404);
    assert.equal((await s.fetch('/api/admin/users/9999', del(adminCookie))).status, 404);
    assert.ok(s.db.getUserById(user.id));
    // GET по адресу человека не поддерживается
    assert.equal((await s.fetch(`/api/admin/users/${user.id}`, get(adminCookie))).status, 405);
  } finally { await s.close(); }
});
