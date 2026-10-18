// Хранилище портала: SQLite (встроенный node:sqlite), одна база-файл.
// Сессии и токены живут здесь же, а не в памяти, — ночная перезагрузка
// сервера не выкидывает людей. Время везде — миллисекунды, передаётся
// аргументом (now/at), чтобы тесты не зависели от часов.
import { DatabaseSync } from 'node:sqlite';
import { newToken, hashToken } from './tokens.js';

/** Почта везде приводится к одному виду: без пробелов по краям и в нижнем регистре. */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool    TEXT NOT NULL,
  PRIMARY KEY (user_id, tool)
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite', 'reset')),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS journal (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('result', 'download')),
  files_json TEXT NOT NULL,
  summary    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_created ON journal(created_at);
CREATE TABLE IF NOT EXISTS requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool        TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'granted', 'rejected')),
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by INTEGER
);
`;

function toUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.is_admin === 1,
    status: row.status,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

/**
 * Открывает (и при первом запуске создаёт) базу. ':memory:' — для тестов.
 * Возвращает объект с методами хранилища; `raw` — сама база, нужна только тестам.
 */
export function openDb(path) {
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys = ON');
  // Резервная копия читает базу параллельно с сервером: ждём освободившуюся блокировку, а не падаем
  raw.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') raw.exec('PRAGMA journal_mode = WAL');
  raw.exec(SCHEMA);

  const q = (sql) => raw.prepare(sql);
  const userSelect = 'SELECT id, email, name, is_admin, status, created_at, last_login_at FROM users';

  function getUserById(id) {
    return toUser(q(`${userSelect} WHERE id = ?`).get(id));
  }

  function getTools(userId) {
    return q('SELECT tool FROM permissions WHERE user_id = ? ORDER BY tool')
      .all(userId)
      .map((r) => r.tool);
  }

  // Токен одного вида, не использованный и не просроченный (срок включительно)
  function liveTokenRow(rawToken, kind, now) {
    return q(
      'SELECT user_id FROM tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at >= ?',
    ).get(hashToken(rawToken), kind, now);
  }

  return {
    raw,
    close: () => raw.close(),

    // --- пользователи ---
    createUser({ email, name, isAdmin, at = Date.now() }) {
      const info = q('INSERT INTO users (email, name, is_admin, created_at) VALUES (?, ?, ?, ?)').run(
        normalizeEmail(email),
        name,
        isAdmin ? 1 : 0,
        at,
      );
      return getUserById(Number(info.lastInsertRowid));
    },
    getUserByEmail(email) {
      return toUser(q(`${userSelect} WHERE email = ?`).get(normalizeEmail(email)));
    },
    getUserById,
    listUsers() {
      const byUser = new Map();
      for (const { user_id: id, tool } of q('SELECT user_id, tool FROM permissions ORDER BY tool').all()) {
        if (!byUser.has(id)) byUser.set(id, []);
        byUser.get(id).push(tool);
      }
      return q(`${userSelect} ORDER BY id`)
        .all()
        .map((row) => ({ ...toUser(row), tools: byUser.get(row.id) ?? [] }));
    },
    // Первый пароль приглашённого делает его активным; отключённого не воскрешает
    setPassword(userId, hash) {
      q("UPDATE users SET password_hash = ?, status = CASE WHEN status = 'invited' THEN 'active' ELSE status END WHERE id = ?")
        .run(hash, userId);
    },
    getPasswordHash(userId) {
      return q('SELECT password_hash FROM users WHERE id = ?').get(userId)?.password_hash ?? null;
    },
    setStatus(userId, status) {
      q('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
    },
    touchLogin(userId, at) {
      q('UPDATE users SET last_login_at = ? WHERE id = ?').run(at, userId);
    },

    // --- права на инструменты ---
    getTools,
    setTools(userId, keys) {
      raw.exec('BEGIN');
      try {
        q('DELETE FROM permissions WHERE user_id = ?').run(userId);
        const insert = q('INSERT OR IGNORE INTO permissions (user_id, tool) VALUES (?, ?)');
        for (const key of keys) insert.run(userId, key);
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },

    // --- токены приглашения и сброса пароля ---
    createToken({ userId, kind, expiresAt }) {
      const token = newToken();
      q('INSERT INTO tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)')
        .run(hashToken(token), userId, kind, expiresAt);
      return token;
    },
    peekToken(token, kind, now) {
      return liveTokenRow(token, kind, now)?.user_id ?? null;
    },
    // Одним UPDATE: два одновременных запроса не потратят токен дважды
    consumeToken(token, kind, now) {
      const row = q(
        'UPDATE tokens SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at >= ? RETURNING user_id',
      ).get(now, hashToken(token), kind, now);
      return row?.user_id ?? null;
    },

    // --- сессии (бессрочные на сервере) ---
    createSession(userId, at) {
      const token = newToken();
      q('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(hashToken(token), userId, at);
      return token;
    },
    getSessionUser(token) {
      const row = q(
        `SELECT u.id, u.email, u.name, u.is_admin, u.status, u.created_at, u.last_login_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND u.status = 'active'`,
      ).get(hashToken(token));
      return toUser(row);
    },
    deleteSession(token) {
      q('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    },
    deleteUserSessions(userId) {
      q('DELETE FROM sessions WHERE user_id = ?').run(userId);
    },

    // --- журнал: только ключ инструмента, имена файлов и текст итога ---
    addJournal({ userId, tool, kind, files, summary, at }) {
      q('INSERT INTO journal (user_id, tool, kind, files_json, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(userId, tool, kind, JSON.stringify(files), summary, at);
    },
    listJournal({ userId, tool, limit = 100 } = {}) {
      const where = [];
      const args = [];
      if (userId !== undefined) { where.push('j.user_id = ?'); args.push(userId); }
      if (tool !== undefined) { where.push('j.tool = ?'); args.push(tool); }
      const rows = q(
        `SELECT j.id, j.user_id, u.name, j.tool, j.kind, j.files_json, j.summary, j.created_at
         FROM journal j JOIN users u ON u.id = j.user_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY j.created_at DESC, j.id DESC LIMIT ?`,
      ).all(...args, limit);
      return rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.name,
        tool: r.tool,
        kind: r.kind,
        files: JSON.parse(r.files_json),
        summary: r.summary,
        at: r.created_at,
      }));
    },
    // Удаляет записи строго старше границы, возвращает сколько удалено
    pruneJournal(before) {
      return Number(q('DELETE FROM journal WHERE created_at < ?').run(before).changes);
    },

    // --- запросы доступа (tool = null — «не может войти») ---
    addRequest({ userId, tool, at }) {
      // «IS ?» сравнивает и с NULL
      const open = q("SELECT id FROM requests WHERE user_id = ? AND tool IS ? AND status = 'open'").get(userId, tool);
      if (open) return { id: open.id, created: false };
      const info = q('INSERT INTO requests (user_id, tool, created_at) VALUES (?, ?, ?)').run(userId, tool, at);
      return { id: Number(info.lastInsertRowid), created: true };
    },
    listRequests({ status = 'open' } = {}) {
      return q(
        `SELECT r.id, r.user_id, u.name, u.email, r.tool, r.status, r.created_at
         FROM requests r JOIN users u ON u.id = r.user_id
         WHERE r.status = ? ORDER BY r.created_at, r.id`,
      ).all(status).map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.name,
        email: r.email,
        tool: r.tool,
        status: r.status,
        at: r.created_at,
      }));
    },
    // Закрывает только открытый запрос; уже закрытый или несуществующий — null
    resolveRequest(id, status, byUserId, at) {
      const row = q(
        "UPDATE requests SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'open' RETURNING user_id, tool",
      ).get(status, byUserId, at, id);
      return row ? { userId: row.user_id, tool: row.tool } : null;
    },
    countOpenRequests() {
      return q("SELECT COUNT(*) AS n FROM requests WHERE status = 'open'").get().n;
    },
  };
}
