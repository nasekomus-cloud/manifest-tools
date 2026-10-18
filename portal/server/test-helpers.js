// Общие помощники тестов портала: поднимает настоящий HTTP-сервер на свободном
// порту с базой в памяти (или во временном файле). Сеть наружу не нужна.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';
import { loadCatalog } from './catalog.js';
import { hashPassword } from './passwords.js';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const TEST_ORIGIN = 'https://tools.test';

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now]
 * @param {object|null} [opts.mailer]
 * @param {string} [opts.dbPath]       путь к файлу базы; по умолчанию ':memory:'
 * @param {string} [opts.siteRoot]     корень сайта; по умолчанию репозиторий
 * @param {boolean} [opts.cookieSecure]
 */
export async function startTestServer({
  now = Date.now,
  mailer = null,
  dbPath = ':memory:',
  siteRoot = REPO_ROOT,
  cookieSecure = true,
} = {}) {
  const db = openDb(dbPath);
  const catalog = loadCatalog(siteRoot);
  const app = createApp({ db, siteRoot, publicOrigin: TEST_ORIGIN, mailer, now, cookieSecure });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;

  /** fetch к тестовому серверу; Origin по умолчанию правильный, переопределяется в headers. */
  function request(path, init = {}) {
    const headers = { Origin: TEST_ORIGIN, ...init.headers };
    return fetch(url + path, { ...init, headers });
  }

  return {
    url,
    db,
    catalog,
    fetch: request,
    /** Дожидается писем, уходящих в фоне после ответа. */
    idle: () => app.idle(),
    async close() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      db.close();
    },
    /** Создаёт активного человека с паролем и правами. */
    async addUser({ email, name, password, isAdmin = false, tools = [] }) {
      const user = db.createUser({ email, name, isAdmin });
      db.setPassword(user.id, await hashPassword(password));
      db.setTools(user.id, tools);
      return db.getUserById(user.id);
    },
    /** Входит и возвращает значение для заголовка Cookie ('lt_session=…'). */
    async login(email, password) {
      const r = await request('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      if (r.status !== 200) throw new Error(`вход не удался: ${r.status}`);
      return r.headers.get('set-cookie').split(';')[0];
    },
  };
}
