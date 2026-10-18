// Точка входа сервиса портала: читает переменные окружения и слушает 127.0.0.1:PORT
// (наружу сервис смотрит через nginx).
//
//   PORT           порт, по умолчанию 8010
//   DB_PATH        файл базы SQLite (обязательно)
//   SITE_ROOT      корень репозитория; по умолчанию — два уровня выше этого файла
//   PUBLIC_ORIGIN  https://tallyman.nasekomuspro.ru (обязательно; по нему проверяется Origin)
//   COOKIE_SECURE  0 — выключить флаг Secure у cookie (только локальная разработка)
//   SMTP_*         необязательная почта: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//                  (без SMTP_HOST писем нет, портал работает полностью и пакет nodemailer
//                  не загружается — см. mail.js)

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
const { createMailer } = await import('./mail.js');
const { dailyCleanup } = await import('./cleanup.js');

if (dbPath !== ':memory:') mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const db = openDb(dbPath);

// При старте и раз в сутки: журнал старше 365 дней удаляется, у кого вышел срок
// доступа (тестовая ссылка) — отключается (см. cleanup.js)
function cleanup() {
  const { journalRemoved, usersDisabled } = dailyCleanup(db, Date.now());
  if (journalRemoved > 0) console.log(`Журнал: удалено старых записей — ${journalRemoved}`);
  if (usersDisabled > 0) console.log(`Отключено с истёкшим сроком — ${usersDisabled}`);
}
cleanup();
setInterval(cleanup, DAY_MS).unref();

const mailer = await createMailer(env);
console.log(mailer ? `Почта: SMTP ${env.SMTP_HOST}` : 'Почта не настроена (SMTP_HOST не задан) — ссылки выдаёт администратор');

const server = http.createServer(createApp({ db, siteRoot, publicOrigin, mailer, now: Date.now, cookieSecure }));
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
