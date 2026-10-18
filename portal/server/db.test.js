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
    id: first.id, userId: u.id, userName: 'Иван', email: 'ivan@mail.ru', tool: 'merge', status: 'open', at: 10,
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
