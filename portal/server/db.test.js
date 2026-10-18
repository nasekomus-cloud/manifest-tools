import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, normalizeEmail } from './db.js';
import { newToken, hashToken } from './tokens.js';

const mkUser = (db, email = 'ivan@mail.ru', extra = {}) =>
  db.createUser({ email, name: 'Иван', isAdmin: false, ...extra });

test('normalizeEmail: пробелы и регистр', () => {
  assert.equal(normalizeEmail('  Ivan@Mail.RU '), 'ivan@mail.ru');
});

test('newToken/hashToken: токен случайный, хеш — sha256 hex', () => {
  const a = newToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, newToken());
  assert.match(hashToken(a), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(a), hashToken(a));
});

test('почта хранится нормализованной и ищется без учёта регистра', () => {
  const db = openDb(':memory:');
  db.createUser({ email: ' Ivan@Mail.ru ', name: 'Иван', isAdmin: false });
  assert.equal(db.getUserByEmail('ivan@mail.ru').email, 'ivan@mail.ru');
  assert.equal(db.getUserByEmail('  IVAN@mail.RU ').email, 'ivan@mail.ru');
  assert.throws(() => db.createUser({ email: 'IVAN@mail.ru', name: 'X', isAdmin: false }));
});

test('createUser: форма User, getUserById, несуществующие — null', () => {
  const db = openDb(':memory:');
  const u = db.createUser({ email: 'a@b.ru', name: 'Анна', isAdmin: true });
  assert.equal(typeof u.id, 'number');
  assert.equal(u.isAdmin, true);
  assert.equal(u.status, 'invited');
  assert.equal(u.lastLoginAt, null);
  assert.equal(typeof u.createdAt, 'number');
  assert.deepEqual(db.getUserById(u.id), u);
  assert.equal(db.getUserById(999), null);
  assert.equal(db.getUserByEmail('нет@нет.ru'), null);
  assert.equal(mkUser(db).isAdmin, false);
});

test('пароль: setPassword активирует приглашённого, но не воскрешает отключённого', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  assert.equal(db.getPasswordHash(u.id), null);
  db.setPassword(u.id, 'scrypt$aa$bb');
  assert.equal(db.getPasswordHash(u.id), 'scrypt$aa$bb');
  assert.equal(db.getUserById(u.id).status, 'active');
  db.setStatus(u.id, 'disabled');
  db.setPassword(u.id, 'scrypt$cc$dd');
  assert.equal(db.getUserById(u.id).status, 'disabled');
  assert.equal(db.getPasswordHash(999), null);
});

test('touchLogin записывает время входа', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  db.touchLogin(u.id, 12345);
  assert.equal(db.getUserById(u.id).lastLoginAt, 12345);
});

test('токен: одноразовый и со сроком', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);

  const raw = db.createToken({ userId: u.id, kind: 'invite', expiresAt: 1000 });
  assert.equal(db.peekToken(raw, 'invite', 999), u.id);
  assert.equal(db.peekToken(raw, 'invite', 999), u.id); // peek не расходует
  assert.equal(db.consumeToken(raw, 'invite', 999), u.id);
  assert.equal(db.consumeToken(raw, 'invite', 999), null);
  assert.equal(db.peekToken(raw, 'invite', 999), null);

  const late = db.createToken({ userId: u.id, kind: 'invite', expiresAt: 1000 });
  assert.equal(db.peekToken(late, 'invite', 1001), null);
  assert.equal(db.consumeToken(late, 'invite', 1001), null);

  const reset = db.createToken({ userId: u.id, kind: 'reset', expiresAt: 1000 });
  assert.equal(db.peekToken(reset, 'invite', 10), null);
  assert.equal(db.consumeToken(reset, 'invite', 10), null);
  assert.equal(db.consumeToken(reset, 'reset', 10), u.id);

  assert.equal(db.peekToken('чужой', 'invite', 10), null);
});

test('revokeUserTokens гасит неиспользованные ссылки только этого человека', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  const other = db.createUser({ email: 'other@x.ru', name: 'Другой' });
  const a = db.createToken({ userId: u.id, kind: 'invite', expiresAt: 1000 });
  const b = db.createToken({ userId: u.id, kind: 'reset', expiresAt: 1000 });
  const spent = db.createToken({ userId: u.id, kind: 'reset', expiresAt: 1000 });
  db.consumeToken(spent, 'reset', 10);
  const foreign = db.createToken({ userId: other.id, kind: 'invite', expiresAt: 1000 });

  assert.equal(db.revokeUserTokens(u.id, 20), 2);
  assert.equal(db.peekToken(a, 'invite', 20), null);
  assert.equal(db.peekToken(b, 'reset', 20), null);
  assert.equal(db.peekToken(foreign, 'invite', 20), other.id);
  assert.equal(db.revokeUserTokens(u.id, 21), 0);
});

test('в базе лежит только хеш токена', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  const raw = db.createToken({ userId: u.id, kind: 'invite', expiresAt: 1000 });
  const sess = db.createSession(u.id, 1);
  const hashes = [
    ...db.raw.prepare('SELECT token_hash AS h FROM tokens').all(),
    ...db.raw.prepare('SELECT token_hash AS h FROM sessions').all(),
  ].map((r) => r.h);
  assert.ok(hashes.includes(hashToken(raw)));
  assert.ok(hashes.includes(hashToken(sess)));
  assert.ok(!hashes.includes(raw) && !hashes.includes(sess));
});

test('сессия только у активного', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  const raw = db.createSession(u.id, 1);
  assert.equal(db.getSessionUser(raw), null); // invited
  db.setPassword(u.id, 'h');
  assert.equal(db.getSessionUser(raw).id, u.id);
  db.setStatus(u.id, 'disabled');
  assert.equal(db.getSessionUser(raw), null);
  db.setStatus(u.id, 'active');
  assert.equal(db.getSessionUser(raw).id, u.id);
  assert.equal(db.getSessionUser('чужая'), null);
});

test('сессии: deleteSession и deleteUserSessions', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  const v = mkUser(db, 'v@b.ru');
  db.setPassword(u.id, 'h');
  db.setPassword(v.id, 'h');
  const a = db.createSession(u.id, 1);
  const b = db.createSession(u.id, 2);
  const c = db.createSession(v.id, 3);
  db.deleteSession(a);
  assert.equal(db.getSessionUser(a), null);
  assert.ok(db.getSessionUser(b));
  db.deleteUserSessions(u.id);
  assert.equal(db.getSessionUser(b), null);
  assert.ok(db.getSessionUser(c)); // чужая сессия не тронута
});

test('сессии переживают переоткрытие базы (перезагрузка сервера)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-db-'));
  try {
    const path = join(dir, 'portal.db');
    const first = openDb(path);
    const u = mkUser(first);
    first.setPassword(u.id, 'h');
    const raw = first.createSession(u.id, 1);
    first.close();
    const second = openDb(path);
    assert.equal(second.getSessionUser(raw).email, 'ivan@mail.ru');
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setTools заменяет набор; listUsers отдаёт tools', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  const v = mkUser(db, 'v@b.ru');
  assert.deepEqual(db.getTools(u.id), []);
  db.setTools(u.id, ['merge', 'dg-check']);
  assert.deepEqual(db.getTools(u.id), ['dg-check', 'merge']);
  db.setTools(u.id, ['merge']);
  assert.deepEqual(db.getTools(u.id), ['merge']);
  db.setTools(u.id, ['merge', 'merge']); // повтор ключа не ломает PRIMARY KEY
  assert.deepEqual(db.getTools(u.id), ['merge']);
  const list = db.listUsers();
  assert.equal(list.length, 2);
  assert.deepEqual(list.find((x) => x.id === u.id).tools, ['merge']);
  assert.deepEqual(list.find((x) => x.id === v.id).tools, []);
  assert.equal(list.find((x) => x.id === u.id).email, 'ivan@mail.ru');
});

test('журнал: фильтр по человеку и инструменту, порядок от новых, pruneJournal', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  const v = mkUser(db, 'v@b.ru', { name: 'Вера' });
  db.addJournal({ userId: u.id, tool: 'merge', kind: 'result', files: ['a.xlsx', 'б.xlsx'], summary: 'Склеено 2', at: 100 });
  db.addJournal({ userId: v.id, tool: 'merge', kind: 'download', files: [], summary: '', at: 300 });
  db.addJournal({ userId: u.id, tool: 'dg-check', kind: 'result', files: ['c.xlsx'], summary: 'ок', at: 200 });

  const all = db.listJournal({});
  assert.deepEqual(all.map((r) => r.at), [300, 200, 100]);
  assert.deepEqual(all[2], {
    id: all[2].id, userId: u.id, userName: 'Иван', tool: 'merge', kind: 'result',
    files: ['a.xlsx', 'б.xlsx'], summary: 'Склеено 2', at: 100,
  });
  assert.deepEqual(db.listJournal({ userId: u.id }).map((r) => r.at), [200, 100]);
  assert.deepEqual(db.listJournal({ tool: 'merge' }).map((r) => r.at), [300, 100]);
  assert.deepEqual(db.listJournal({ userId: u.id, tool: 'merge' }).map((r) => r.at), [100]);
  assert.equal(db.listJournal({ limit: 2 }).length, 2);

  assert.equal(db.pruneJournal(200), 1); // строго старше границы
  assert.deepEqual(db.listJournal({}).map((r) => r.at), [300, 200]);
  assert.equal(db.pruneJournal(200), 0);
});

test('запрос доступа не дублируется, пока открыт', () => {
  const db = openDb(':memory:');
  const u = mkUser(db);
  const admin = db.createUser({ email: 'adm@b.ru', name: 'Админ', isAdmin: true });

  const first = db.addRequest({ userId: u.id, tool: 'merge', at: 10 });
  assert.equal(first.created, true);
  const again = db.addRequest({ userId: u.id, tool: 'merge', at: 20 });
  assert.deepEqual(again, { id: first.id, created: false });
  assert.equal(db.countOpenRequests(), 1);

  // другой инструмент и «не может войти» (tool = null) — отдельные запросы
  assert.equal(db.addRequest({ userId: u.id, tool: 'dg-check', at: 30 }).created, true);
  assert.equal(db.addRequest({ userId: u.id, tool: null, at: 40 }).created, true);
  assert.equal(db.addRequest({ userId: u.id, tool: null, at: 50 }).created, false);
  assert.equal(db.countOpenRequests(), 3);

  const open = db.listRequests({});
  assert.equal(open.length, 3);
  assert.deepEqual(open.find((r) => r.id === first.id), {
    id: first.id, userId: u.id, userName: 'Иван', email: 'ivan@mail.ru', guest: false, tool: 'merge', status: 'open', at: 10,
  });

  assert.deepEqual(db.resolveRequest(first.id, 'granted', admin.id, 60), { userId: u.id, tool: 'merge' });
  assert.equal(db.resolveRequest(first.id, 'rejected', admin.id, 61), null); // уже закрыт
  assert.equal(db.resolveRequest(999, 'granted', admin.id, 61), null);
  assert.equal(db.countOpenRequests(), 2);
  assert.equal(db.listRequests({ status: 'granted' }).length, 1);

  const next = db.addRequest({ userId: u.id, tool: 'merge', at: 70 });
  assert.equal(next.created, true);
  assert.notEqual(next.id, first.id);
});

// ── Доработки: «показывать недоступные» и тестовый доступ ────────────────────

// Схема рабочей базы до доработок (2026-10-18): без show_locked/guest/expires_at,
// у tokens вид только 'invite' | 'reset'
const OLD_SCHEMA = `
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool    TEXT NOT NULL,
  PRIMARY KEY (user_id, tool)
);
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
`;

test('миграция: старая база получает новые колонки и вид токена guest, данные на месте', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'portal-db-'));
  try {
    const path = join(dir, 'portal.db');
    const old = new DatabaseSync(path);
    old.exec(OLD_SCHEMA);
    old.prepare("INSERT INTO users (email, name, password_hash, is_admin, status, created_at) VALUES ('boss@x.ru', 'Босс', 'h', 1, 'active', 5)").run();
    old.prepare("INSERT INTO permissions (user_id, tool) VALUES (1, 'merge')").run();
    const invite = newToken();
    old.prepare("INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, 1, 'reset', 1000)").run(hashToken(invite));
    const session = newToken();
    old.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, 1, 7)').run(hashToken(session));
    // вид guest старая схема не принимает
    assert.throws(() => old.prepare("INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES ('x', 1, 'guest', 1)").run());
    old.close();

    const db = openDb(path);
    const cols = db.raw.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
    for (const name of ['show_locked', 'guest', 'expires_at']) assert.ok(cols.includes(name), name);
    const boss = db.getUserByEmail('boss@x.ru');
    assert.equal(boss.name, 'Босс');
    assert.equal(boss.status, 'active');
    assert.equal(boss.isAdmin, true);
    assert.equal(boss.showLocked, false);
    assert.equal(boss.guest, false);
    assert.equal(boss.expiresAt, null);
    assert.equal(db.getPasswordHash(boss.id), 'h');
    assert.deepEqual(db.getTools(boss.id), ['merge']);
    assert.equal(db.getSessionUser(session).id, boss.id);
    assert.equal(db.peekToken(invite, 'reset', 10), boss.id); // старая ссылка жива
    // новый вид токена принимается
    const g = db.createToken({ userId: boss.id, kind: 'guest', expiresAt: 2000 });
    assert.equal(db.peekToken(g, 'guest', 10), boss.id);
    // неизвестный вид — по-прежнему нет
    assert.throws(() => db.createToken({ userId: boss.id, kind: 'other', expiresAt: 1 }));
    db.close();

    // повторное открытие ничего не ломает
    const again = openDb(path);
    assert.equal(again.getUserByEmail('boss@x.ru').name, 'Босс');
    assert.equal(again.peekToken(g, 'guest', 10), boss.id);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('createUser: showLocked, guest, expiresAt и статус; setShowLocked, setExpiry', () => {
  const db = openDb(':memory:');
  const plain = mkUser(db);
  assert.equal(plain.showLocked, false);
  assert.equal(plain.guest, false);
  assert.equal(plain.expiresAt, null);
  const g = db.createUser({ email: 'guest-1@guest.invalid', name: 'Тест', isAdmin: false, showLocked: true, guest: true, expiresAt: 500, status: 'active' });
  assert.equal(g.showLocked, true);
  assert.equal(g.guest, true);
  assert.equal(g.expiresAt, 500);
  assert.equal(g.status, 'active');
  db.setShowLocked(plain.id, true);
  assert.equal(db.getUserById(plain.id).showLocked, true);
  db.setShowLocked(plain.id, false);
  assert.equal(db.getUserById(plain.id).showLocked, false);
  db.setExpiry(g.id, 900);
  assert.equal(db.getUserById(g.id).expiresAt, 900);
  const listed = db.listUsers().find((u) => u.id === g.id);
  assert.equal(listed.guest, true);
  assert.equal(listed.expiresAt, 900);
});

test('expireUser и disableExpired: отключают просроченных, гасят сессии и ссылки', () => {
  const db = openDb(':memory:');
  const early = db.createUser({ email: 'g1@guest.invalid', name: 'Ранний', guest: true, expiresAt: 100, status: 'active' });
  const late = db.createUser({ email: 'g2@guest.invalid', name: 'Поздний', guest: true, expiresAt: 300, status: 'active' });
  const plain = mkUser(db);
  db.setPassword(plain.id, 'h');
  const s1 = db.createSession(early.id, 1);
  const t1 = db.createToken({ userId: early.id, kind: 'guest', expiresAt: 100 });
  const s2 = db.createSession(late.id, 1);
  const s3 = db.createSession(plain.id, 1);

  assert.equal(db.disableExpired(99), 0);
  assert.equal(db.disableExpired(100), 1); // срок включительно: в момент expires_at уже нельзя
  assert.equal(db.getUserById(early.id).status, 'disabled');
  assert.equal(db.getSessionUser(s1), null);
  assert.equal(db.peekToken(t1, 'guest', 50), null);
  assert.equal(db.getSessionUser(s2).id, late.id);
  assert.equal(db.getSessionUser(s3).id, plain.id);
  assert.equal(db.disableExpired(100), 0); // уже отключённых не трогает повторно

  db.expireUser(late.id, 150);
  assert.equal(db.getUserById(late.id).status, 'disabled');
  assert.equal(db.getSessionUser(s2), null);
});

test('extendGuestTokens продлевает живые guest-ссылки человека', () => {
  const db = openDb(':memory:');
  const g = db.createUser({ email: 'g@guest.invalid', name: 'Тест', guest: true, expiresAt: 100, status: 'active' });
  const live = db.createToken({ userId: g.id, kind: 'guest', expiresAt: 100 });
  assert.equal(db.extendGuestTokens(g.id, 500), 1);
  assert.equal(db.peekToken(live, 'guest', 400), g.id);
  db.revokeUserTokens(g.id, 1);
  assert.equal(db.extendGuestTokens(g.id, 900), 0);
});

test('миграция: ссылка без человека (осиротевшая строка) и недоделанная tokens_new не роняют запуск', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'portal-db-'));
  try {
    const path = join(dir, 'portal.db');
    const old = new DatabaseSync(path);
    old.exec(OLD_SCHEMA);
    old.prepare("INSERT INTO users (email, name, status, created_at) VALUES ('u@x.ru', 'У', 'active', 1)").run();
    const live = newToken();
    old.prepare("INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, 1, 'reset', 1000)").run(hashToken(live));
    // строка, чей человек удалён в обход внешних ключей (так бывает в базе, которую правили руками)
    old.exec('PRAGMA foreign_keys = OFF');
    old.prepare("INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES ('orphan', 999, 'invite', 1000)").run();
    // остаток прерванной миграции
    old.exec('CREATE TABLE tokens_new (x INTEGER)');
    old.close();

    const db = openDb(path);
    const hashes = db.raw.prepare('SELECT token_hash FROM tokens').all().map((r) => r.token_hash);
    assert.deepEqual(hashes, [hashToken(live)]);
    assert.equal(db.peekToken(live, 'reset', 10), 1);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'tokens_new'").get().n, 0);
    const g = db.createToken({ userId: 1, kind: 'guest', expiresAt: 2000 });
    assert.equal(db.peekToken(g, 'guest', 10), 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
