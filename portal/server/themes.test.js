// Темы оформления: личная настройка каждого человека (users.theme), по умолчанию «Глубина».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THEMES, DEFAULT_THEME, isTheme, withTheme } from './themes.js';
import { openDb } from './db.js';
import { startTestServer, REPO_ROOT } from './test-helpers.js';

const HOUR = 60 * 60 * 1000;
const get = (cookie) => ({ headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' });
const put = (cookie, body, headers = {}) => ({
  method: 'PUT',
  headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
  body: JSON.stringify(body),
});

// ── Список тем ───────────────────────────────────────────────────────────────

test('THEMES: десять тем, у каждой id, русское название и тип; по умолчанию — «Глубина»', () => {
  assert.equal(THEMES.length, 10);
  assert.deepEqual(THEMES.map((t) => t.id), [
    'depth', 'emerald', 'day', 'mint', 'graphite', 'chart', 'sunset', 'arctic', 'bordeaux', 'steel',
  ]);
  for (const t of THEMES) {
    assert.match(t.id, /^[a-z]+$/);
    assert.ok(t.name.length > 0);
    assert.ok(t.kind === 'light' || t.kind === 'dark', t.id);
  }
  assert.equal(DEFAULT_THEME, 'depth');
  assert.equal(THEMES[0].name, 'Глубина');
  assert.deepEqual(THEMES.filter((t) => t.kind === 'light').map((t) => t.id), ['day', 'mint', 'chart', 'arctic']);
});

test('isTheme: только id из списка', () => {
  assert.equal(isTheme('emerald'), true);
  assert.equal(isTheme('Emerald'), false);
  assert.equal(isTheme(''), false);
  assert.equal(isTheme('toString'), false);
  assert.equal(isTheme(undefined), false);
  assert.equal(isTheme(['depth']), false);
});

test('withTheme: атрибут в первый тег <html>, остальное как есть', () => {
  assert.equal(withTheme('<!doctype html>\n<html lang="ru"><head></head></html>', 'mint'),
    '<!doctype html>\n<html data-theme="mint" lang="ru"><head></head></html>');
  assert.equal(withTheme('<html>x</html>', 'day'), '<html data-theme="day">x</html>');
  assert.equal(withTheme('<HTML lang="ru">', 'day'), '<HTML data-theme="day" lang="ru">');
  // только первый: строка «<html» дальше в тексте страницы не трогается
  assert.equal(withTheme('<html lang="ru"><p>&lt;html</p><html>', 'day'), '<html data-theme="day" lang="ru"><p>&lt;html</p><html>');
  // <htmlx> — не тег html
  assert.equal(withTheme('<htmlx><html>', 'day'), '<htmlx><html data-theme="day">');
  // тега нет — как есть
  assert.equal(withTheme('<p>фрагмент</p>', 'day'), '<p>фрагмент</p>');
  // неизвестная тема (например, удалённая из списка) — тема по умолчанию
  assert.equal(withTheme('<html>', 'nope'), '<html data-theme="depth">');
});

// ── База ─────────────────────────────────────────────────────────────────────

// Схема рабочей базы перед темами (2026-10-18): show_locked, guest, expires_at уже есть, theme — нет
const PREV_SCHEMA = `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER,
  show_locked   INTEGER NOT NULL DEFAULT 0,
  guest         INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER
);
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite', 'reset', 'guest')),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
`;

test('миграция: база без колонки theme получает её, у всех — «Глубина», данные на месте', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'portal-theme-'));
  try {
    const path = join(dir, 'portal.db');
    const old = new DatabaseSync(path);
    old.exec(PREV_SCHEMA);
    old.prepare("INSERT INTO users (email, name, password_hash, is_admin, status, created_at, show_locked) VALUES ('boss@x.ru', 'Босс', 'h', 1, 'active', 5, 1)").run();
    old.close();

    const db = openDb(path);
    const cols = db.raw.prepare('PRAGMA table_info(users)').all();
    const theme = cols.find((c) => c.name === 'theme');
    assert.ok(theme, 'колонка theme');
    assert.equal(theme.notnull, 1);
    const boss = db.getUserByEmail('boss@x.ru');
    assert.equal(boss.theme, 'depth');
    assert.equal(boss.showLocked, true);
    assert.equal(db.getPasswordHash(boss.id), 'h');
    db.setTheme(boss.id, 'steel');
    db.close();

    // повторное открытие: колонка не добавляется второй раз, выбранная тема на месте
    const again = openDb(path);
    assert.equal(again.getUserByEmail('boss@x.ru').theme, 'steel');
    assert.equal(again.raw.prepare('PRAGMA table_info(users)').all().filter((c) => c.name === 'theme').length, 1);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createUser — тема «Глубина»; setTheme меняет только своего человека', () => {
  const db = openDb(':memory:');
  const a = db.createUser({ email: 'a@x.ru', name: 'А', isAdmin: false });
  const b = db.createUser({ email: 'b@x.ru', name: 'Б', isAdmin: false });
  assert.equal(a.theme, 'depth');
  db.setTheme(a.id, 'mint');
  assert.equal(db.getUserById(a.id).theme, 'mint');
  assert.equal(db.getUserById(b.id).theme, 'depth');
  const session = db.createSession(a.id, 1);
  db.setPassword(a.id, 'h');
  assert.equal(db.getSessionUser(session).theme, 'mint');
  db.close();
});

// ── API и страницы ───────────────────────────────────────────────────────────

let s;
let lena; // коллега, право на merge
let boss;
let guest;

before(async () => {
  s = await startTestServer();
  await s.addUser({ email: 'lena@x.ru', name: 'Лена', password: 'пароль-лены', tools: ['merge'] });
  await s.addUser({ email: 'boss@x.ru', name: 'Босс', password: 'пароль-босса', isAdmin: true });
  lena = await s.login('lena@x.ru', 'пароль-лены');
  boss = await s.login('boss@x.ru', 'пароль-босса');
  const g = s.db.createUser({
    email: 'guest-t@guest.invalid', name: 'Тест', isAdmin: false, guest: true, status: 'active', expiresAt: Date.now() + 24 * HOUR,
  });
  s.db.setTools(g.id, ['merge']);
  guest = `lt_session=${s.db.createSession(g.id, Date.now())}`;
});
after(() => s.close());

test('/api/me: тема человека и список тем', async () => {
  const me = await (await s.fetch('/api/me', get(lena))).json();
  assert.equal(me.user.theme, 'depth');
  assert.deepEqual(me.themes, THEMES);
});

test('PUT /api/account/theme: сохраняет и отдаёт тему; /api/me видит новую', async () => {
  const r = await s.fetch('/api/account/theme', put(lena, { theme: 'emerald' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { theme: 'emerald' });
  const me = await (await s.fetch('/api/me', get(lena))).json();
  assert.equal(me.user.theme, 'emerald');
  // у другого человека тема прежняя
  const other = await (await s.fetch('/api/me', get(boss))).json();
  assert.equal(other.user.theme, 'depth');
});

test('PUT /api/account/theme: неизвестная тема и не строка — 400, тема не меняется', async () => {
  await s.fetch('/api/account/theme', put(boss, { theme: 'day' }));
  for (const body of [{ theme: 'neon' }, { theme: '' }, { theme: 5 }, { theme: ['day'] }, {}, { theme: 'Day' }]) {
    const r = await s.fetch('/api/account/theme', put(boss, body));
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok((await r.json()).error);
  }
  assert.equal((await (await s.fetch('/api/me', get(boss))).json()).user.theme, 'day');
});

test('PUT /api/account/theme: без входа — 401, без Origin — 403, другой метод — 405', async () => {
  assert.equal((await s.fetch('/api/account/theme', put(null, { theme: 'day' }))).status, 401);
  const noOrigin = await fetch(`${s.url}/api/account/theme`, { method: 'PUT', headers: { Cookie: lena }, body: JSON.stringify({ theme: 'day' }) });
  assert.equal(noOrigin.status, 403);
  const foreign = await s.fetch('/api/account/theme', put(lena, { theme: 'day' }, { Origin: 'https://evil.test' }));
  assert.equal(foreign.status, 403);
  assert.equal((await s.fetch('/api/account/theme', { method: 'POST', headers: { Cookie: lena }, body: '{}' })).status, 405);
  assert.equal((await (await s.fetch('/api/me', get(lena))).json()).user.theme, 'emerald');
});

test('PUT /api/account/theme: работает и у тестового (вход по ссылке)', async () => {
  const r = await s.fetch('/api/account/theme', put(guest, { theme: 'sunset' }));
  assert.equal(r.status, 200);
  const me = await (await s.fetch('/api/me', get(guest))).json();
  assert.equal(me.user.guest, true);
  assert.equal(me.user.theme, 'sunset');
});

const htmlTag = (text) => text.match(/<html[^>]*>/i)?.[0];

test('HTML для человека с темой: data-theme в <html> страниц инструментов и портала', async () => {
  await s.fetch('/api/account/theme', put(lena, { theme: 'graphite' }));
  for (const path of ['/merge/index.html', '/merge/', '/', '/journal', '/account', '/help/merge', '/login']) {
    const r = await s.fetch(path, get(lena));
    assert.equal(r.status, 200, path);
    const text = await r.text();
    assert.equal(htmlTag(text), '<html data-theme="graphite" lang="ru">', path);
    assert.equal(Number(r.headers.get('content-length')), Buffer.byteLength(text), path);
  }
  // 403 «Нет доступа» (страница администратора)
  const denied = await s.fetch('/admin/users', get(lena));
  assert.equal(denied.status, 403);
  assert.equal(htmlTag(await denied.text()), '<html data-theme="graphite" lang="ru">');
  // администратору — его тема
  const admin = await s.fetch('/admin/users', get(boss));
  assert.equal(htmlTag(await admin.text()), '<html data-theme="day" lang="ru">');
  // тема по умолчанию тоже пишется явно
  const plain = await s.addUser({ email: 'new@x.ru', name: 'Новый', password: 'пароль-новый', tools: ['merge'] });
  assert.equal(plain.theme, 'depth');
  const cookie = await s.login('new@x.ru', 'пароль-новый');
  assert.equal(htmlTag(await (await s.fetch('/merge/index.html', get(cookie))).text()), '<html data-theme="depth" lang="ru">');
});

test('403 «Нет доступа» к инструменту — с темой (человек видит закрытые)', async () => {
  const u = await s.addUser({ email: 'open@x.ru', name: 'Открытая', password: 'пароль-123', tools: ['merge'], showLocked: true });
  s.db.setTheme(u.id, 'bordeaux');
  const cookie = await s.login('open@x.ru', 'пароль-123');
  const r = await s.fetch('/dg-check/index.html', get(cookie));
  assert.equal(r.status, 403);
  assert.equal(htmlTag(await r.text()), '<html data-theme="bordeaux" lang="ru">');
});

test('без входа HTML отдаётся без data-theme', async () => {
  for (const path of ['/login']) {
    const r = await s.fetch(path, get(null));
    assert.equal(r.status, 200);
    assert.equal(htmlTag(await r.text()), '<html lang="ru">', path);
  }
  const gone = await s.fetch('/invite/нет-такой', get(null));
  assert.equal(gone.status, 410);
  assert.equal(htmlTag(await gone.text()), '<html lang="ru">');
});

test('JS, CSS и прочие файлы не меняются от темы', async () => {
  const read = (...parts) => readFileSync(join(REPO_ROOT, ...parts), 'utf8');
  const css = await (await s.fetch('/assets/style.css', get(lena))).text();
  assert.equal(css, [read('assets', 'style.css'), read('portal', 'web', 'theme.css')].join('\n'));
  const app = await (await s.fetch('/merge/app.js', get(lena))).text();
  assert.equal(app, read('merge', 'app.js'));
  const portalJs = await (await s.fetch('/portal/portal.js', get(lena))).text();
  assert.equal(portalJs, read('portal', 'web', 'portal.js'));
  const shell = await (await s.fetch('/assets/shell.js', get(lena))).text();
  assert.ok(!shell.includes('data-theme="graphite"'));
});
