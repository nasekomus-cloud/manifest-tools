import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startTestServer, TEST_ORIGIN } from './test-helpers.js';
import { issueLink, INVITE_TTL_MS, RESET_TTL_MS } from './routes-auth.js';
import { openDb } from './db.js';

const run = promisify(execFile);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const GONE_TEXT = 'Ссылка уже использована или устарела';

const post = (s, path, body, headers = {}) => s.fetch(path, { method: 'POST', body: JSON.stringify(body), headers });
const tokenOf = (link) => link.split('/').pop();

/** Сервер с управляемыми часами. */
async function clockServer() {
  const clock = { t: 1_800_000_000_000 };
  const s = await startTestServer({ now: () => clock.t });
  return { s, clock };
}

test('сроки: приглашение 7 дней, сброс 24 часа', () => {
  assert.equal(INVITE_TTL_MS, 7 * DAY);
  assert.equal(RESET_TTL_MS, 24 * HOUR);
});

test('issueLink: приглашённому — invite, остальным — reset', async () => {
  const { s, clock } = await clockServer();
  try {
    const invited = s.db.createUser({ email: 'a@x.ru', name: 'А' });
    const link = issueLink(s.db, invited, { now: clock.t, publicOrigin: 'https://t.test/' });
    assert.match(link, /^https:\/\/t\.test\/invite\/[\w-]{43}$/);
    assert.equal(s.db.peekToken(tokenOf(link), 'invite', clock.t), invited.id);

    const active = await s.addUser({ email: 'b@x.ru', name: 'Б', password: 'пароль-123' });
    const reset = issueLink(s.db, active, { now: clock.t, publicOrigin: 'https://t.test' });
    assert.match(reset, /^https:\/\/t\.test\/reset\/[\w-]{43}$/);
    assert.equal(s.db.peekToken(tokenOf(reset), 'reset', clock.t), active.id);
  } finally { await s.close(); }
});

test('приглашение действует 7 дней и одноразовое', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = s.db.createUser({ email: 'ivan@x.ru', name: 'Иван' });
    const t0 = clock.t;
    const token = tokenOf(issueLink(s.db, user, { now: t0, publicOrigin: TEST_ORIGIN }));

    clock.t = t0 + 6 * DAY;
    const info = await s.fetch(`/api/invite/${token}`);
    assert.equal(info.status, 200);
    assert.deepEqual(await info.json(), { email: 'ivan@x.ru', name: 'Иван' });
    assert.equal((await s.fetch(`/invite/${token}`)).status, 200);

    const ok = await post(s, `/api/invite/${token}`, { password: 'пароль-123' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    const cookie = ok.headers.get('set-cookie');
    assert.match(cookie, /^lt_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.equal(s.db.getUserByEmail('ivan@x.ru').status, 'active');
    // вход по ссылке — тоже вход: в «Пользователях» не «ещё не входил»
    assert.equal(s.db.getUserByEmail('ivan@x.ru').lastLoginAt, clock.t);
    // сессия рабочая
    assert.equal((await s.fetch('/api/me', { headers: { Cookie: cookie.split(';')[0] } })).status, 200);
    // и с этим паролем можно войти заново
    await s.login('ivan@x.ru', 'пароль-123');

    // повторно — 410
    assert.equal((await post(s, `/api/invite/${token}`, { password: 'другой-пароль' })).status, 410);
    assert.equal((await s.fetch(`/api/invite/${token}`)).status, 410);
    const page = await s.fetch(`/invite/${token}`);
    assert.equal(page.status, 410);
    assert.ok((await page.text()).includes(GONE_TEXT));
  } finally { await s.close(); }
});

test('приглашение через 8 дней — 410 и страница «ссылка устарела»', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = s.db.createUser({ email: 'old@x.ru', name: 'Старый' });
    const token = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    clock.t += 8 * DAY;
    assert.equal((await s.fetch(`/api/invite/${token}`)).status, 410);
    assert.equal((await post(s, `/api/invite/${token}`, { password: 'пароль-123' })).status, 410);
    const page = await s.fetch(`/invite/${token}`);
    assert.equal(page.status, 410);
    assert.ok((await page.text()).includes('Ссылка уже использована или устарела — попросите новую у администратора.'));
    assert.equal(s.db.getUserByEmail('old@x.ru').status, 'invited');
  } finally { await s.close(); }
});

test('токен другого вида и неизвестный токен — 410; страницы — 410 с текстом', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = s.db.createUser({ email: 'k@x.ru', name: 'К' });
    const invite = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    // приглашение по адресу сброса не работает
    assert.equal((await s.fetch(`/api/reset/${invite}`)).status, 410);
    const page = await s.fetch(`/reset/${invite}`);
    assert.equal(page.status, 410);
    assert.ok((await page.text()).includes(GONE_TEXT));
    for (const path of ['/invite/нет-такого', '/reset/xxx']) {
      const r = await s.fetch(path);
      assert.equal(r.status, 410, path);
      assert.ok((await r.text()).includes(GONE_TEXT));
    }
    assert.equal((await s.fetch('/api/invite/'.padEnd(300, 'x'))).status, 410);
    // действующая страница — это invite.html, а не заглушка
    const ok = await s.fetch(`/invite/${invite}`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get('content-type'), /text\/html/);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.match(await ok.text(), /type="password"/);
  } finally { await s.close(); }
});

test('короткий пароль — 400 с понятным текстом, токен не тратится', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = s.db.createUser({ email: 'sh@x.ru', name: 'Ш' });
    const token = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    const r = await post(s, `/api/invite/${token}`, { password: '1234567' });
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'Пароль — не короче 8 символов' });
    assert.equal(r.headers.get('set-cookie'), null);
    for (const body of [{}, { password: 12345678 }, { password: null }, { password: ['пароль-123'] }]) {
      assert.equal((await post(s, `/api/invite/${token}`, body)).status, 400, JSON.stringify(body));
    }
    // ровно 8 символов проходит
    assert.equal((await post(s, `/api/invite/${token}`, { password: '12345678' })).status, 200);
  } finally { await s.close(); }
});

test('сброс действует 24 часа и выкидывает старые сессии', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = await s.addUser({ email: 'r@x.ru', name: 'Р', password: 'старый-пароль' });
    const oldCookie = await s.login('r@x.ru', 'старый-пароль');
    const otherCookie = await s.login('r@x.ru', 'старый-пароль');
    const t0 = clock.t;

    // просроченный
    const stale = tokenOf(issueLink(s.db, user, { now: t0, publicOrigin: TEST_ORIGIN }));
    clock.t = t0 + 25 * HOUR;
    assert.equal((await s.fetch(`/api/reset/${stale}`)).status, 410);
    assert.equal((await s.fetch(`/reset/${stale}`)).status, 410);

    // действующий
    clock.t = t0 + 30 * HOUR;
    const fresh = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    clock.t += 23 * HOUR;
    const info = await s.fetch(`/api/reset/${fresh}`);
    assert.equal(info.status, 200);
    assert.deepEqual(await info.json(), { email: 'r@x.ru', name: 'Р' });
    assert.equal((await s.fetch(`/reset/${fresh}`)).status, 200);

    const r = await post(s, `/api/reset/${fresh}`, { password: 'новый-пароль' });
    assert.equal(r.status, 200);
    const newCookie = r.headers.get('set-cookie').split(';')[0];
    assert.notEqual(newCookie, oldCookie);
    for (const old of [oldCookie, otherCookie]) {
      assert.equal((await s.fetch('/api/me', { headers: { Cookie: old } })).status, 401);
    }
    assert.equal((await s.fetch('/api/me', { headers: { Cookie: newCookie } })).status, 200);
    await s.login('r@x.ru', 'новый-пароль');
    await assert.rejects(s.login('r@x.ru', 'старый-пароль'));
    assert.equal((await post(s, `/api/reset/${fresh}`, { password: 'ещё-пароль-1' })).status, 410);
  } finally { await s.close(); }
});

test('отключённому человеку ссылки не помогают', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = await s.addUser({ email: 'd@x.ru', name: 'Д', password: 'пароль-123' });
    const token = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    s.db.setStatus(user.id, 'disabled');
    assert.equal((await s.fetch(`/api/reset/${token}`)).status, 410);
    assert.equal((await post(s, `/api/reset/${token}`, { password: 'новый-пароль' })).status, 410);
    assert.equal((await s.fetch(`/reset/${token}`)).status, 410);
  } finally { await s.close(); }
});

test('POST по ссылке с чужим Origin отклоняется', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = s.db.createUser({ email: 'o@x.ru', name: 'О' });
    const token = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    const r = await post(s, `/api/invite/${token}`, { password: 'пароль-123' }, { Origin: 'https://evil.test' });
    assert.equal(r.status, 403);
    assert.equal(s.db.getUserByEmail('o@x.ru').status, 'invited');
  } finally { await s.close(); }
});

test('смена пароля проверяет текущий', async () => {
  const { s } = await clockServer();
  try {
    await s.addUser({ email: 'p@x.ru', name: 'П', password: 'старый-пароль' });
    const cookie = await s.login('p@x.ru', 'старый-пароль');
    const other = await s.login('p@x.ru', 'старый-пароль');
    const withCookie = { Cookie: cookie };

    assert.equal((await post(s, '/api/password', { current: 'старый-пароль', password: 'новый-пароль' })).status, 401);

    const wrong = await post(s, '/api/password', { current: 'не тот', password: 'новый-пароль' }, withCookie);
    assert.equal(wrong.status, 400);
    assert.deepEqual(await wrong.json(), { error: 'Текущий пароль указан неверно' });

    const short = await post(s, '/api/password', { current: 'старый-пароль', password: 'коротко' }, withCookie);
    assert.equal(short.status, 400);
    assert.deepEqual(await short.json(), { error: 'Пароль — не короче 8 символов' });
    for (const body of [{}, { current: 1, password: 'новый-пароль' }, { current: 'старый-пароль' }]) {
      assert.equal((await post(s, '/api/password', body, withCookie)).status, 400, JSON.stringify(body));
    }
    // старая сессия после неудач жива
    assert.equal((await s.fetch('/api/me', { headers: withCookie })).status, 200);

    const ok = await post(s, '/api/password', { current: 'старый-пароль', password: 'новый-пароль' }, withCookie);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true });
    const fresh = ok.headers.get('set-cookie').split(';')[0];
    assert.equal((await s.fetch('/api/me', { headers: withCookie })).status, 401);
    assert.equal((await s.fetch('/api/me', { headers: { Cookie: other } })).status, 401);
    assert.equal((await s.fetch('/api/me', { headers: { Cookie: fresh } })).status, 200);
    await s.login('p@x.ru', 'новый-пароль');
  } finally { await s.close(); }
});

test('«Забыли пароль?» без почты: одинаковый ответ, запрос администратору для активного и приглашённого, не для отключённого', async () => {
  const { s } = await clockServer();
  try {
    const user = await s.addUser({ email: 'f@x.ru', name: 'Ф', password: 'пароль-123' });
    const invited = s.db.createUser({ email: 'inv@x.ru', name: 'Приглашённый' });
    const dis = await s.addUser({ email: 'dis@x.ru', name: 'Выключен', password: 'пароль-123' });
    s.db.setStatus(dis.id, 'disabled');
    const message = { message: 'Если такой адрес есть, мы передали запрос администратору.' };

    const known = await post(s, '/api/forgot', { email: ' F@X.ru ' });
    assert.equal(known.status, 200);
    assert.deepEqual(await known.json(), message);
    const requests = s.db.listRequests();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].tool, null);
    assert.equal(requests[0].userId, user.id);

    for (const email of ['nobody@x.ru', 'inv@x.ru', 'dis@x.ru']) {
      const r = await post(s, '/api/forgot', { email });
      assert.equal(r.status, 200, email);
      assert.deepEqual(await r.json(), message, email);
    }
    // приглашённый (например, с истёкшим приглашением) тоже доходит до администратора;
    // неизвестная и отключённая почта — нет
    const after = s.db.listRequests();
    assert.equal(after.length, 2);
    assert.deepEqual(after.map((r) => r.userId).sort(), [user.id, invited.id].sort());
    assert.ok(after.every((r) => r.tool === null));

    // повторный запрос не множит открытые
    await post(s, '/api/forgot', { email: 'f@x.ru' });
    await post(s, '/api/forgot', { email: 'inv@x.ru' });
    assert.equal(s.db.listRequests().length, 2);

    assert.equal((await post(s, '/api/forgot', {})).status, 400);
    assert.equal((await post(s, '/api/forgot', { email: 5 })).status, 400);
  } finally { await s.close(); }
});

test('«Забыли пароль?»: не больше 10 запросов за 15 минут с одного адреса', async () => {
  const { s, clock } = await clockServer();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await post(s, '/api/forgot', { email: `u${i}@x.ru` })).status, 200);
    assert.equal((await post(s, '/api/forgot', { email: 'u11@x.ru' })).status, 429);
    clock.t += 16 * 60 * 1000;
    assert.equal((await post(s, '/api/forgot', { email: 'u11@x.ru' })).status, 200);
  } finally { await s.close(); }
});

test('cli add-admin печатает ссылку и работает повторно', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-cli-'));
  const dbPath = join(dir, 'portal.db');
  const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
  const env = { ...process.env, DB_PATH: dbPath, PUBLIC_ORIGIN: 'https://t.test' };
  try {
    const first = await run(process.execPath, [cli, 'add-admin', ' Boss@X.ru ', 'Главный админ'], { env });
    assert.match(first.stdout, /^https:\/\/t\.test\/invite\/[\w-]{43}\n$/);

    const db = openDb(dbPath);
    const user = db.getUserByEmail('boss@x.ru');
    assert.equal(user.isAdmin, true);
    assert.equal(user.status, 'invited');
    assert.equal(user.name, 'Главный админ');
    assert.equal(db.peekToken(tokenOf(first.stdout.trim()), 'invite', Date.now()), user.id);
    db.close();

    // для существующего адреса — новая ссылка, второго человека нет
    const second = await run(process.execPath, [cli, 'add-admin', 'boss@x.ru', 'Главный админ'], { env });
    assert.match(second.stdout, /^https:\/\/t\.test\/invite\//);
    assert.notEqual(second.stdout, first.stdout);
    const db2 = openDb(dbPath);
    assert.equal(db2.listUsers().length, 1);
    db2.close();

    // без аргументов — ошибка, не ссылка
    await assert.rejects(run(process.execPath, [cli, 'add-admin'], { env }), (e) => e.code === 1 && e.stdout === '');
    await assert.rejects(run(process.execPath, [cli, 'add-admin', 'a@x.ru', 'А'], { env: { ...env, DB_PATH: '' } }), (e) => e.code === 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const expectGone = async (s, token, kind) => {
  assert.equal((await s.fetch(`/api/${kind}/${token}`)).status, 410, `GET api ${kind}`);
  assert.equal((await post(s, `/api/${kind}/${token}`, { password: 'захват-аккаунта' })).status, 410, `POST api ${kind}`);
  const page = await s.fetch(`/${kind}/${token}`);
  assert.equal(page.status, 410, `страница ${kind}`);
  assert.ok((await page.text()).includes('Ссылка уже использована или устарела — попросите новую у администратора.'));
};

test('два приглашения: после принятия одного второе не действует', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = s.db.createUser({ email: 'two@x.ru', name: 'Два' });
    const first = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    // выпуск новой ссылки сразу гасит прежнюю
    const second = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    await expectGone(s, first, 'invite');
    assert.equal((await post(s, `/api/invite/${second}`, { password: 'пароль-123' })).status, 200);
    await expectGone(s, second, 'invite');
    await s.login('two@x.ru', 'пароль-123'); // пароль не перезаписан
  } finally { await s.close(); }
});

test('неиспользованные приглашения умирают при принятии другого (токены выданы в обход issueLink)', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = s.db.createUser({ email: 'ib@x.ru', name: 'И' });
    const a = s.db.createToken({ userId: user.id, kind: 'invite', expiresAt: clock.t + DAY });
    const b = s.db.createToken({ userId: user.id, kind: 'invite', expiresAt: clock.t + DAY });
    assert.equal((await post(s, `/api/invite/${b}`, { password: 'пароль-123' })).status, 200);
    await expectGone(s, a, 'invite');
    await s.login('ib@x.ru', 'пароль-123');
  } finally { await s.close(); }
});

test('приглашение не действует для уже активного человека', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = await s.addUser({ email: 'act@x.ru', name: 'А', password: 'пароль-123' });
    const token = s.db.createToken({ userId: user.id, kind: 'invite', expiresAt: clock.t + DAY });
    await expectGone(s, token, 'invite');
  } finally { await s.close(); }
});

test('два сброса: после использования второго первый не действует', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = await s.addUser({ email: 'rr@x.ru', name: 'Р', password: 'старый-пароль' });
    const first = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    const second = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    await expectGone(s, first, 'reset');
    assert.equal((await post(s, `/api/reset/${second}`, { password: 'новый-пароль' })).status, 200);
    await expectGone(s, second, 'reset');
    await s.login('rr@x.ru', 'новый-пароль');
  } finally { await s.close(); }
});

test('неиспользованный сброс умирает при использовании другого (токены выданы в обход issueLink)', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = await s.addUser({ email: 'rb@x.ru', name: 'Р', password: 'старый-пароль' });
    const a = s.db.createToken({ userId: user.id, kind: 'reset', expiresAt: clock.t + HOUR });
    const b = s.db.createToken({ userId: user.id, kind: 'reset', expiresAt: clock.t + HOUR });
    assert.equal((await post(s, `/api/reset/${b}`, { password: 'новый-пароль' })).status, 200);
    await expectGone(s, a, 'reset');
  } finally { await s.close(); }
});

test('ссылка сброса, выданная до смены пароля, после неё не действует', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = await s.addUser({ email: 'pc@x.ru', name: 'П', password: 'старый-пароль' });
    const cookie = await s.login('pc@x.ru', 'старый-пароль');
    const reset = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    const ok = await post(s, '/api/password', { current: 'старый-пароль', password: 'новый-пароль' }, { Cookie: cookie });
    assert.equal(ok.status, 200);
    await expectGone(s, reset, 'reset');
    await s.login('pc@x.ru', 'новый-пароль');
  } finally { await s.close(); }
});

test('issueLink дважды: первая ссылка гаснет сразу, вторая работает', async () => {
  const { s, clock } = await clockServer();
  try {
    const user = await s.addUser({ email: 'il@x.ru', name: 'И', password: 'пароль-123' });
    const first = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    const second = tokenOf(issueLink(s.db, user, { now: clock.t, publicOrigin: TEST_ORIGIN }));
    await expectGone(s, first, 'reset');
    assert.equal((await s.fetch(`/api/reset/${second}`)).status, 200);
    assert.equal((await s.fetch(`/reset/${second}`)).status, 200);
  } finally { await s.close(); }
});
