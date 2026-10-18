// Командная строка портала.
//
//   node portal/server/cli.js add-admin <почта> <имя>
//
// Создаёт администратора (статус «приглашён», пароля нет) и печатает на stdout
// только ссылку-приглашение. Для почты, которая уже есть, выпускает новую ссылку
// (приглашение или сброс — по статусу человека).
//
//   DB_PATH        файл базы SQLite (обязательно)
//   PUBLIC_ORIGIN  https://tallyman.nasekomuspro.ru (обязательно)

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// node:sqlite в Node 22 печатает ExperimentalWarning — как и main.js, прячем именно его.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.warn(warning.stack ?? String(warning));
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const USAGE = 'Использование: node portal/server/cli.js add-admin <почта> <имя>';
const [command, emailArg, ...nameParts] = process.argv.slice(2);
if (command !== 'add-admin') fail(USAGE);
const name = nameParts.join(' ').trim();
if (!emailArg || !emailArg.trim() || !name) fail(USAGE);

const { DB_PATH: dbPath, PUBLIC_ORIGIN: publicOrigin } = process.env;
if (!dbPath || !publicOrigin) fail('Не заданы DB_PATH и/или PUBLIC_ORIGIN.');

const { openDb } = await import('./db.js');
const { issueLink } = await import('./routes-auth.js');

if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const db = openDb(dbPath);
try {
  const now = Date.now();
  let user = db.getUserByEmail(emailArg);
  if (!user) {
    user = db.createUser({ email: emailArg, name, isAdmin: true, at: now });
  } else if (!user.isAdmin) {
    fail(`Адрес ${user.email} уже есть, но это не администратор — права здесь не меняются.`);
  } else if (user.status === 'disabled') {
    fail(`Адрес ${user.email} отключён — сначала включите его в списке людей.`);
  }
  console.log(issueLink(db, user, { now, publicOrigin }));
} finally {
  db.close();
}
