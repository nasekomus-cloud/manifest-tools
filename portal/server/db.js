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
  last_login_at INTEGER,
  show_locked   INTEGER NOT NULL DEFAULT 0,
  guest         INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER
);
CREATE TABLE IF NOT EXISTS permissions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool    TEXT NOT NULL,
  PRIMARY KEY (user_id, tool)
);
CREATE TABLE IF NOT EXISTS tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite', 'reset', 'guest')),
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
    showLocked: row.show_locked === 1,
    guest: row.guest === 1,
    expiresAt: row.expires_at ?? null,
  };
}

// Таблица tokens в том виде, в каком её создаёт SCHEMA (для переделки старой базы)
const TOKENS_TABLE = `CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('invite', 'reset', 'guest')),
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
)`;

/**
 * Доводит базу, созданную прежней версией портала, до текущей схемы.
 * CREATE TABLE IF NOT EXISTS существующую таблицу не меняет, поэтому:
 *  - недостающие колонки users добавляются ALTER TABLE … ADD COLUMN (только если их нет);
 *  - у tokens ограничение CHECK на вид нельзя поменять ALTER TABLE — таблица пересоздаётся
 *    с тем же содержимым одной транзакцией (на неё никто не ссылается, строки копируются как есть).
 * Повторный вызов ничего не делает.
 */
function migrate(raw) {
  const columns = new Set(raw.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  const added = [
    ['show_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['guest', 'INTEGER NOT NULL DEFAULT 0'],
    ['expires_at', 'INTEGER'],
  ];
  for (const [name, type] of added) {
    if (!columns.has(name)) raw.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }

  const tokensSql = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tokens'").get()?.sql ?? '';
  if (!tokensSql.includes("'guest'")) {
    raw.exec('BEGIN');
    try {
      raw.exec(TOKENS_TABLE.replace('CREATE TABLE tokens', 'CREATE TABLE tokens_new'));
      raw.exec('INSERT INTO tokens_new (token_hash, user_id, kind, expires_at, used_at) SELECT token_hash, user_id, kind, expires_at, used_at FROM tokens');
      raw.exec('DROP TABLE tokens');
      raw.exec('ALTER TABLE tokens_new RENAME TO tokens');
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }
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
  migrate(raw);

  const q = (sql) => raw.prepare(sql);
  const USER_COLUMNS = 'id, email, name, is_admin, status, created_at, last_login_at, show_locked, guest, expires_at';
  const userSelect = `SELECT ${USER_COLUMNS} FROM users`;

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

  // Срок вышел: отключить, выкинуть из всех сессий, погасить ссылки
  function expireUser(userId, at) {
    q("UPDATE users SET status = 'disabled' WHERE id = ?").run(userId);
    q('DELETE FROM sessions WHERE user_id = ?').run(userId);
    q('UPDATE tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(at, userId);
  }

  return {
    raw,
    close: () => raw.close(),

    // --- пользователи ---
    // guest/expiresAt — тестовый доступ по ссылке; status по умолчанию 'invited'
    createUser({ email, name, isAdmin, at = Date.now(), showLocked = false, guest = false, expiresAt = null, status = 'invited' }) {
      const info = q(
        'INSERT INTO users (email, name, is_admin, created_at, show_locked, guest, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        normalizeEmail(email),
        name,
        isAdmin ? 1 : 0,
        at,
        showLocked ? 1 : 0,
        guest ? 1 : 0,
        expiresAt,
        status,
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
    setShowLocked(userId, value) {
      q('UPDATE users SET show_locked = ? WHERE id = ?').run(value ? 1 : 0, userId);
    },
    setExpiry(userId, at) {
      q('UPDATE users SET expires_at = ? WHERE id = ?').run(at, userId);
    },
    expireUser,
    // Всех, у кого срок вышел (now >= expires_at), а статус ещё не «отключён»; возвращает сколько
    disableExpired(now) {
      const ids = q("SELECT id FROM users WHERE expires_at IS NOT NULL AND expires_at <= ? AND status != 'disabled'")
        .all(now)
        .map((r) => r.id);
      for (const id of ids) expireUser(id, now);
      return ids.length;
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

    // Тестовая ссылка многоразовая: действует, пока не отозвана и не истекла (срок не включительно —
    // как у самого человека: в момент expires_at уже нельзя)
    peekGuestToken(token, now) {
      return q("SELECT user_id FROM tokens WHERE token_hash = ? AND kind = 'guest' AND used_at IS NULL AND expires_at > ?")
        .get(hashToken(token), now)?.user_id ?? null;
    },
    // Новый срок живым тестовым ссылкам человека («Продлить»); возвращает сколько продлено
    extendGuestTokens(userId, expiresAt) {
      return Number(q("UPDATE tokens SET expires_at = ? WHERE user_id = ? AND kind = 'guest' AND used_at IS NULL")
        .run(expiresAt, userId).changes);
    },

    // Гасит все ещё не использованные ссылки человека (после смены пароля и перед выпуском новой)
    revokeUserTokens(userId, at) {
      return Number(q('UPDATE tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(at, userId).changes);
    },

    // --- сессии (бессрочные на сервере) ---
    createSession(userId, at) {
      const token = newToken();
      q('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(hashToken(token), userId, at);
      return token;
    },
    getSessionUser(token) {
      const row = q(
        `SELECT ${USER_COLUMNS.split(', ').map((c) => `u.${c}`).join(', ')}
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
        `SELECT r.id, r.user_id, u.name, u.email, u.guest, r.tool, r.status, r.created_at
         FROM requests r JOIN users u ON u.id = r.user_id
         WHERE r.status = ? ORDER BY r.created_at, r.id`,
      ).all(status).map((r) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.name,
        email: r.email,
        guest: r.guest === 1,
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
