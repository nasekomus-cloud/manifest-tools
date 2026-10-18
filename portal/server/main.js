// Точка входа сервиса портала: читает переменные окружения и слушает 127.0.0.1:PORT
// (наружу сервис смотрит через nginx).
//
//   PORT           порт, по умолчанию 8010
//   DB_PATH        файл базы SQLite (обязательно)
//   SITE_ROOT      корень репозитория; по умолчанию — два уровня выше этого файла
//   PUBLIC_ORIGIN  https://tools.nasekomuspro.ru (обязательно; по нему проверяется Origin)
//   COOKIE_SECURE  0 — выключить флаг Secure у cookie (только локальная разработка)
//   SMTP_*         настройки почты — подключаются в задаче 4

import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// node:sqlite в Node 22 печатает предупреждение «ExperimentalWarning: SQLite is an
// experimental feature». Прячем именно его, остальные предупреждения остаются.
// Обработчик ставится до загрузки модулей, которые тянут node:sqlite (динамический import ниже).
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
  console.warn(warning.stack ?? String(warning));
});

const DAY_MS = 24 * 60 * 60 * 1000;
const JOURNAL_KEEP_MS = 365 * DAY_MS;

const env = process.env;
const dbPath = env.DB_PATH;
const publicOrigin = env.PUBLIC_ORIGIN;
if (!dbPath || !publicOrigin) {
  console.error('Не заданы DB_PATH и/или PUBLIC_ORIGIN.');
  process.exit(1);
}
const port = Number(env.PORT || 8010);
const siteRoot = resolve(env.SITE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
const cookieSecure = env.COOKIE_SECURE !== '0';

const { openDb } = await import('./db.js');
const { createApp } = await import('./app.js');

if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const db = openDb(dbPath);

// Журнал хранится 365 дней: чистим при старте и раз в сутки
function pruneJournal() {
  const removed = db.pruneJournal(Date.now() - JOURNAL_KEEP_MS);
  if (removed > 0) console.log(`Журнал: удалено старых записей — ${removed}`);
}
pruneJournal();
setInterval(pruneJournal, DAY_MS).unref();

const server = http.createServer(createApp({ db, siteRoot, publicOrigin, mailer: null, now: Date.now, cookieSecure }));
server.listen(port, '127.0.0.1', () => {
  console.log(`Портал слушает 127.0.0.1:${port}, сайт: ${siteRoot}, адрес: ${publicOrigin}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
