// HTTP-приложение портала: вход, сессии и отдача файлов сайта по правам.
//
// Любой ответ несёт Cache-Control: no-store (в том числе ошибки и перенаправления),
// любой запрос не GET/HEAD обязан прийти с Origin, равным PUBLIC_ORIGIN.
// Что кому отдаётся — таблица в handlePage(); всё, чего в таблице нет, — 404.

import { join } from 'node:path';
import { loadCatalog, allowedKeys, classifyPath, renderToolsJs } from './catalog.js';
import { normalizeEmail } from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createLimiter } from './ratelimit.js';
import { parsePath, isTestFile, createFileServer } from './static.js';
import { createAuthRoutes } from './routes-auth.js';
import { createAdminRoutes } from './routes-admin.js';
import { createJournalRoutes } from './routes-journal.js';
import {
  HttpError, readJson, send, sendJson, sendText, redirect, parseCookies, sessionCookie, SESSION_COOKIE,
} from './http-utils.js';

const RATE_LIMIT_MESSAGE = 'Слишком много попыток. Попробуйте через 15 минут.';
const NEED_LOGIN = { error: 'Нужно войти' };

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Страница «Нет доступа». Если дан инструмент — с кнопкой «Запросить доступ». */
function noAccessPage(tool) {
  const request = tool
    ? `<p>У вас пока нет доступа к инструменту «${escapeHtml(tool.title)}».</p>
  <button type="button" id="request-access" data-tool="${escapeHtml(tool.key)}">Запросить доступ</button>
  <p id="request-status" role="status"></p>`
    : '<p>У вас нет доступа к этой странице.</p>';
  const script = tool
    ? `<script>
(function () {
  var button = document.getElementById('request-access');
  var status = document.getElementById('request-status');
  button.addEventListener('click', function () {
    button.disabled = true;
    fetch('/api/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: button.getAttribute('data-tool') }),
    }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      status.textContent = 'Запрос отправлен. Администратор увидит его и откроет доступ.';
    }).catch(function () {
      button.disabled = false;
      status.textContent = 'Не удалось отправить запрос. Попробуйте ещё раз.';
    });
  });
})();
</script>`
    : '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Нет доступа</title>
<link rel="stylesheet" href="/portal/theme.css">
</head>
<body>
<main>
  <h1>Нет доступа</h1>
  ${request}
  <p><a href="/">На главную</a></p>
</main>
${script}
</body>
</html>
`;
}

export function createApp({ db, siteRoot, publicOrigin, mailer = null, now = Date.now, cookieSecure = true }) {
  const origin = publicOrigin.replace(/\/+$/, '');
  const catalog = loadCatalog(siteRoot);
  const files = createFileServer();
  const webDir = join(siteRoot, 'portal', 'web');
  const limiter = createLimiter({ max: 10, windowMs: 15 * 60 * 1000, now });

  // Ложная сверка пароля для неизвестной почты — чтобы по времени ответа
  // нельзя было отличить «нет такого человека» от «неверный пароль».
  let dummyHash = null;
  const getDummyHash = () => (dummyHash ??= hashPassword('нет-такого-человека'));

  const cookieOptions = { secure: cookieSecure };

  function clientIp(req) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim() && real.length <= 64) return real.trim();
    return req.socket.remoteAddress ?? 'unknown';
  }

  // Приглашения, сброс и смена пароля, «Забыли пароль?»
  const auth = createAuthRoutes({ db, now, mailer, cookieOptions, clientIp });

  // Люди, права и запросы доступа (только администраторам)
  const admin = createAdminRoutes({ db, catalog, now, publicOrigin: origin });
  // Журнал работы и запрос доступа к инструменту (любому вошедшему)
  const journal = createJournalRoutes({ db, catalog, now });

  // --- API ---------------------------------------------------------------

  async function handleLogin(req, res) {
    const body = await readJson(req);
    const { email, password } = body;
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new HttpError(400, 'Введите почту и пароль');
    }
    if (email.length > 254 || password.length > 1024) throw new HttpError(400, 'Слишком длинное значение');

    const emailKey = `email:${normalizeEmail(email)}`;
    const ipKey = `ip:${clientIp(req)}`;
    if (limiter.blocked(emailKey) || limiter.blocked(ipKey)) {
      sendJson(res, 429, { error: RATE_LIMIT_MESSAGE });
      return;
    }
    // Попытка записывается до проверки пароля: иначе сто одновременных запросов
    // успели бы пройти до того, как первый из них засчитается. Удачный вход снимает запись.
    limiter.hit(emailKey);
    limiter.hit(ipKey);

    const user = db.getUserByEmail(email);
    const hash = user && user.status === 'active' ? db.getPasswordHash(user.id) : null;
    const passwordOk = await verifyPassword(password, hash ?? (await getDummyHash()));
    if (!user || !hash || !passwordOk) {
      sendJson(res, 401, { error: 'Неверная почта или пароль' });
      return;
    }

    limiter.reset(emailKey);
    limiter.forgive(ipKey);
    db.touchLogin(user.id, now());
    const token = db.createSession(user.id, now());
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, cookieOptions) });
  }

  function handleLogout(req, res, token) {
    if (token) db.deleteSession(token);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { ...cookieOptions, maxAge: 0 }) });
  }

  function handleMe(res, user) {
    if (!user) return sendJson(res, 401, NEED_LOGIN);
    const allowed = allowedKeys(user, db.getTools(user.id), catalog);
    sendJson(res, 200, {
      user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
      tools: catalog.tools.map((tool) => ({ ...tool, allowed: allowed.has(tool.key) })),
      openRequests: user.isAdmin ? db.countOpenRequests() : 0,
    });
  }

  const API = {
    '/api/login': { POST: (req, res) => handleLogin(req, res) },
    '/api/logout': { POST: (req, res, ctx) => handleLogout(req, res, ctx.token) },
    '/api/me': { GET: (req, res, ctx) => handleMe(res, ctx.user) },
  };

  async function handleApi(req, res, pathname, ctx) {
    const route = API[pathname] ?? auth.matchApi(pathname) ?? admin.matchApi(pathname) ?? journal.matchApi(pathname);
    if (!route) return sendJson(res, 404, { error: 'Не найдено' });
    const handler = route[req.method];
    if (!handler) return sendJson(res, 405, { error: 'Метод не поддерживается' }, { Allow: Object.keys(route).join(', ') });
    return handler(req, res, ctx);
  }

  // Не-HTML файл: у последнего сегмента есть расширение, кроме .html/.htm
  // (каталог и адрес без расширения отдали бы index.html — это страница).
  function isAsset(segments, trailingSlash) {
    if (trailingSlash) return false;
    const last = segments[segments.length - 1] ?? '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0) return false;
    return !['.html', '.htm'].includes(last.slice(dot).toLowerCase());
  }

  // Скрипты и стили инструмента `key` нужны тем, у кого есть инструмент, подключающий их из своей страницы
  function dependsOnAllowed(key, allowed) {
    for (const owner of allowed) {
      if (catalog.deps.get(owner)?.has(key)) return true;
    }
    return false;
  }

  // --- Страницы и файлы ----------------------------------------------------

  const notFound = (res) => sendText(res, 404, 'Не найдено');
  const toLogin = (res, path) => redirect(res, `/login?next=${encodeURIComponent(path)}`);

  async function sendFile(res, baseDir, segments, trailingSlash, path) {
    const found = await files.serve(baseDir, segments, trailingSlash);
    if (!found) return notFound(res);
    if (found.redirectSlash) return redirect(res, `${path}/`);
    return send(res, 200, found.type, found.body);
  }

  async function sendConcat(res, type, ...parts) {
    const chunks = [];
    for (const [dir, segments] of parts) {
      const found = await files.serve(dir, segments);
      if (!found || found.redirectSlash) return notFound(res);
      chunks.push(found.body.toString('utf8'));
    }
    return send(res, 200, type, chunks.join('\n'));
  }

  // Закрытые страницы портала: без входа — на вход, с входом — файл из portal/web
  const PORTAL_PAGES = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/journal': 'journal.html',
    '/account': 'account.html',
  };
  const ADMIN_PAGES = {
    '/admin/users': 'admin-users.html',
    '/admin/requests': 'admin-requests.html',
  };

  async function handlePage(req, res, parsed, user) {
    const { segments, trailingSlash, path } = parsed;
    if (isTestFile(segments)) return notFound(res);

    const first = segments[0] ?? '';
    const bare = '/' + segments.join('/'); // путь без завершающего «/»
    const plain = !trailingSlash || segments.length === 0; // страницы с точным адресом

    // Открытое всем
    if (plain && bare === '/login') return sendFile(res, webDir, ['login.html'], false, path);
    if (first === 'invite' || first === 'reset') {
      if (segments.length !== 2 || trailingSlash) return notFound(res);
      // Одна страница на оба вида ссылок; режим она берёт из адреса. Недействующая ссылка — 410 с объяснением
      if (auth.isLinkLive(first, segments[1])) return sendFile(res, webDir, ['invite.html'], false, path);
      const gone = await files.serve(webDir, ['link-gone.html']);
      if (!gone || gone.redirectSlash) return notFound(res);
      return send(res, 410, gone.type, gone.body);
    }
    if (first === 'portal' && segments.length >= 2) return sendFile(res, webDir, segments.slice(1), trailingSlash, path);
    if (plain && bare === '/assets/fonts.css') return sendFile(res, siteRoot, segments, false, path);

    // Страницы портала
    if (plain && PORTAL_PAGES[bare]) {
      if (!user) return redirect(res, bare === '/' || bare === '/index.html' ? '/login' : `/login?next=${encodeURIComponent(bare)}`);
      return sendFile(res, webDir, [PORTAL_PAGES[bare]], false, path);
    }
    if (plain && ADMIN_PAGES[bare]) {
      if (!user) return toLogin(res, bare);
      if (!user.isAdmin) return send(res, 403, 'text/html; charset=utf-8', noAccessPage(null));
      return sendFile(res, webDir, [ADMIN_PAGES[bare]], false, path);
    }
    if (first === 'help') {
      if (!user) return toLogin(res, path);
      return notFound(res); // справка — задача 9
    }

    // Собранные сервером файлы
    if (plain && bare === '/tools.js') {
      if (!user) return sendJson(res, 401, NEED_LOGIN);
      const allowed = allowedKeys(user, db.getTools(user.id), catalog);
      return send(res, 200, 'text/javascript; charset=utf-8', renderToolsJs(catalog, allowed));
    }
    if (plain && bare === '/assets/style.css') {
      if (!user) return sendJson(res, 401, NEED_LOGIN);
      return sendConcat(res, 'text/css; charset=utf-8', [siteRoot, ['assets', 'style.css']], [webDir, ['theme.css']]);
    }
    if (plain && bare === '/assets/shell.js') {
      if (!user) return sendJson(res, 401, NEED_LOGIN);
      return sendConcat(res, 'text/javascript; charset=utf-8', [siteRoot, ['assets', 'shell.js']], [webDir, ['shell-addon.js']]);
    }

    // Общий код и инструменты
    const kind = classifyPath(catalog, path);
    if (kind.kind === 'lib') {
      if (!user) return sendJson(res, 401, NEED_LOGIN);
      return sendFile(res, siteRoot, segments, trailingSlash, path);
    }
    if (kind.kind === 'tool') {
      if (!user) return toLogin(res, path);
      const allowed = allowedKeys(user, db.getTools(user.id), catalog);
      if (!allowed.has(kind.key) && !(isAsset(segments, trailingSlash) && dependsOnAllowed(kind.key, allowed))) {
        const tool = catalog.tools.find((t) => t.key === kind.key);
        return send(res, 403, 'text/html; charset=utf-8', noAccessPage(tool));
      }
      return sendFile(res, siteRoot, segments, trailingSlash, path);
    }
    return notFound(res);
  }

  // --- Вход в приложение -----------------------------------------------------

  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // В адресах приглашений есть токены — наружу они в Referer уходить не должны
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');

    const method = req.method ?? 'GET';
    const readOnly = method === 'GET' || method === 'HEAD';
    if (!readOnly && req.headers.origin !== origin) {
      return sendJson(res, 403, { error: 'Запрос отклонён' });
    }

    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = token && token.length <= 128 ? db.getSessionUser(token) : null;
    if (user) res.setHeader('Set-Cookie', sessionCookie(token, cookieOptions)); // перевыпуск на 400 дней

    const rawPath = (req.url ?? '').split(/[?#]/, 1)[0];
    if (rawPath.startsWith('/api/')) return handleApi(req, res, rawPath, { user, token });

    if (!readOnly) return sendJson(res, 405, { error: 'Метод не поддерживается' }, { Allow: 'GET, HEAD' });
    const parsed = parsePath(rawPath);
    if (!parsed) return notFound(res);
    return handlePage(req, res, parsed, user);
  }

  return (req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof HttpError) {
        // Тело слишком большого запроса дочитывать незачем — закрываем соединение
        if (err.status === 413) res.setHeader('Connection', 'close');
        if (!res.headersSent) sendJson(res, err.status, { error: err.message });
        return;
      }
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'Ошибка сервера' });
      else res.destroy();
    });
  };
}
