// HTTP-приложение портала: вход, сессии и отдача файлов сайта по правам.
//
// Любой ответ несёт Cache-Control: no-store (в том числе ошибки и перенаправления),
// при https-адресе портала — ещё и Strict-Transport-Security,
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

// Пределы неудачных входов за 15 минут. По почте строго: это защита одного пароля.
// По IP шире: за одним адресом (общий офис, NAT) сидит несколько человек, и опечатки
// одного не должны запирать вход всем остальным.
const LOGIN_MAX_PER_EMAIL = 10;
const LOGIN_MAX_PER_IP = 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const HSTS = 'max-age=31536000';
const RATE_LIMIT_MESSAGE = 'Слишком много попыток. Попробуйте через 15 минут.';
const NEED_LOGIN = { error: 'Нужно войти' };

/**
 * Видит ли человек закрытые для него инструменты (карточки «Нет доступа», 403 с кнопкой
 * «Запросить доступ», справку). Настройка show_locked по умолчанию выключена: тогда о
 * закрытых инструментах человек не узнаёт вовсе — их адреса отвечают 404. Администратору
 * закрытого нет, настройка на него не влияет.
 */
export function seesLocked(user) {
  return user.isAdmin || user.showLocked;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Кнопка «Запросить доступ» (#request-access с data-tool) и строка #request-status:
 * POST /api/requests {tool}, после ответа — «Запрос отправлен». Общая для «Нет доступа» и справки.
 */
const REQUEST_ACCESS_SCRIPT = `<script>
(function () {
  var button = document.getElementById('request-access');
  var status = document.getElementById('request-status');
  function show(text, ok) {
    status.textContent = text;
    status.className = 'portal-msg ' + (ok ? 'portal-msg--ok' : 'portal-msg--error');
    status.hidden = false;
  }
  button.addEventListener('click', function () {
    button.disabled = true;
    status.hidden = true;
    fetch('/api/requests', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ tool: button.getAttribute('data-tool') }),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) { return { ok: r.ok, status: r.status, data: data }; });
    }, function () {
      throw new Error('Нет связи с сервером. Попробуйте ещё раз.');
    }).then(function (r) {
      if (r.status === 401) { window.location.href = '/login?next=' + encodeURIComponent(window.location.pathname); return; }
      if (!r.ok) throw new Error(r.data.error || 'Не удалось отправить запрос. Попробуйте ещё раз.');
      if (r.data.already) { window.location.reload(); return; } // доступ уже выдали
      button.textContent = 'Запрос отправлен';
      show('Администратор увидит запрос и откроет доступ.', true);
    }).catch(function (err) {
      button.disabled = false;
      show(err.message, false);
    });
  });
})();
</script>
`;

/**
 * Страница «Нет доступа» (403). Её видит только вошедший человек, поэтому она собрана
 * на том же каркасе, что и страницы инструментов (tools.js → assets/shell.js с
 * добавкой портала): та же полоса сверху и меню «Инструменты».
 * Дан инструмент — «Инструмент «…» вам пока не выдан» и кнопка «Запросить доступ»
 * (POST /api/requests); без инструмента (страницы администратора) — без кнопки.
 * Слова «страница» в тексте нет намеренно: тест проверяет, что содержимое
 * закрытой страницы администратора сюда не попало.
 */
function noAccessPage(tool) {
  const request = tool
    ? `<p class="no-access__text">Инструмент «${escapeHtml(tool.title)}» вам пока не выдан.</p>
    <div class="portal-actions">
      <button class="btn btn--warn" type="button" id="request-access" data-tool="${escapeHtml(tool.key)}">Запросить доступ</button>
      <a class="btn btn--secondary" href="/">На главную</a>
    </div>
    <p class="portal-msg" id="request-status" role="status" hidden></p>`
    : `<p class="no-access__text">Этот раздел — только для администратора.</p>
    <div class="portal-actions">
      <a class="btn btn--secondary" href="/">На главную</a>
    </div>`;
  const script = tool ? REQUEST_ACCESS_SCRIPT : '';
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/portal/favicon.svg">
<title>Нет доступа — Tallyman</title>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/style.css">
<link rel="stylesheet" href="/portal/portal.css">
</head>
<body class="app portal-page">
<aside class="app__side" id="app-side"></aside>
<main class="app__main">
  <section class="no-access">
    <h1 class="page__title">Нет доступа</h1>
    ${request}
  </section>
</main>
<script src="/tools.js"></script>
<script src="/assets/shell.js"></script>
${script}</body>
</html>
`;
}

const TAB_NAMES = { export: 'Экспорт', import: 'Импорт' };

/**
 * Справка к инструменту (/help/<ключ>): тот же каркас, что у «Нет доступа».
 * fragment — portal/help/<ключ>.html из репозитория (свой, доверенный текст),
 * вставляется как есть; заголовок и описание — из каталога, с экранированием.
 * Справку видит любой вошедший — даже без права на инструмент, чтобы понять, о
 * чём просить: с правом — «Открыть инструмент», без — «Запросить доступ».
 */
function helpPage(catalog, key, fragment, allowed) {
  const entries = catalog.tools.filter((t) => t.key === key);
  const tool = entries[0];
  // «Разделить коносаменты» стоит в обеих вкладках
  const tabs = [...new Set(entries.map((t) => TAB_NAMES[t.category]).filter(Boolean))].join(' и ');
  const action = allowed
    ? `<div class="portal-actions">
      <a class="btn" href="/${escapeHtml(tool.href)}">Открыть инструмент</a>
      <a class="btn btn--secondary" href="/">На главную</a>
    </div>`
    : `<p class="help-page__note">Инструмент вам пока не выдан — администратор откроет доступ по запросу.</p>
    <div class="portal-actions">
      <button class="btn btn--warn" type="button" id="request-access" data-tool="${escapeHtml(tool.key)}">Запросить доступ</button>
      <a class="btn btn--secondary" href="/">На главную</a>
    </div>
    <p class="portal-msg" id="request-status" role="status" hidden></p>`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/portal/favicon.svg">
<title>${escapeHtml(tool.title)} — как это работает — Tallyman</title>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/style.css">
<link rel="stylesheet" href="/portal/portal.css">
</head>
<body class="app portal-page help-page">
<aside class="app__side" id="app-side"></aside>
<main class="app__main">
  <p class="help-page__kicker">Как это работает${tabs ? ` · ${escapeHtml(tabs)}` : ''}</p>
  <h1 class="page__title">${escapeHtml(tool.title)}</h1>
  <p class="portal-lead">${escapeHtml(tool.description)}</p>
  <article class="help">
${fragment.trim()}
  </article>
  <section class="help-page__actions">
    ${action}
  </section>
</main>
<script src="/tools.js"></script>
<script src="/assets/shell.js"></script>
${allowed ? '' : REQUEST_ACCESS_SCRIPT}</body>
</html>
`;
}

// Имя файла в Content-Disposition: ASCII-запас в filename и точное имя в filename*
function attachment(name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function createApp({ db, siteRoot, publicOrigin, mailer = null, now = Date.now, cookieSecure = true }) {
  const origin = publicOrigin.replace(/\/+$/, '');
  const catalog = loadCatalog(siteRoot);
  const files = createFileServer();
  const webDir = join(siteRoot, 'portal', 'web');
  const helpDir = join(siteRoot, 'portal', 'help');
  const samplesDir = join(helpDir, 'samples');
  const emailLimiter = createLimiter({ max: LOGIN_MAX_PER_EMAIL, windowMs: LOGIN_WINDOW_MS, now });
  const ipLimiter = createLimiter({ max: LOGIN_MAX_PER_IP, windowMs: LOGIN_WINDOW_MS, now });
  const hsts = origin.startsWith('https://');

  // Ложная сверка пароля для неизвестной почты — чтобы по времени ответа
  // нельзя было отличить «нет такого человека» от «неверный пароль». Хеш считается
  // один раз при создании приложения, а не при первой неизвестной почте: иначе
  // именно этот первый запрос был бы заметно дольше остальных.
  const dummyHash = hashPassword('нет-такого-человека');

  const cookieOptions = { secure: cookieSecure };

  function clientIp(req) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim() && real.length <= 64) return real.trim();
    return req.socket.remoteAddress ?? 'unknown';
  }

  // Приглашения, сброс и смена пароля, «Забыли пароль?»
  const auth = createAuthRoutes({ db, now, mailer, publicOrigin: origin, cookieOptions, clientIp });

  // Люди, права и запросы доступа (только администраторам)
  const admin = createAdminRoutes({ db, catalog, now, publicOrigin: origin, mailer });
  // Журнал работы и запрос доступа к инструменту (любому вошедшему)
  const journal = createJournalRoutes({ db, catalog, now, mailer, publicOrigin: origin });

  // --- API ---------------------------------------------------------------

  async function handleLogin(req, res) {
    const body = await readJson(req);
    const { email, password } = body;
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new HttpError(400, 'Введите почту и пароль');
    }
    if (email.length > 254 || password.length > 1024) throw new HttpError(400, 'Слишком длинное значение');

    const emailKey = normalizeEmail(email);
    const ipKey = clientIp(req);
    if (emailLimiter.blocked(emailKey) || ipLimiter.blocked(ipKey)) {
      sendJson(res, 429, { error: RATE_LIMIT_MESSAGE });
      return;
    }
    // Попытка записывается до проверки пароля: иначе сто одновременных запросов
    // успели бы пройти до того, как первый из них засчитается. Удачный вход снимает запись.
    emailLimiter.hit(emailKey);
    ipLimiter.hit(ipKey);

    const user = db.getUserByEmail(email);
    const hash = user && user.status === 'active' ? db.getPasswordHash(user.id) : null;
    const passwordOk = await verifyPassword(password, hash ?? (await dummyHash));
    if (!user || !hash || !passwordOk) {
      sendJson(res, 401, { error: 'Неверная почта или пароль' });
      return;
    }

    emailLimiter.reset(emailKey);
    ipLimiter.forgive(ipKey);
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
    // Без show_locked закрытых записей в ответе нет вовсе
    const tools = catalog.tools
      .map((tool) => ({ ...tool, allowed: allowed.has(tool.key) }))
      .filter((tool) => tool.allowed || seesLocked(user));
    sendJson(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin,
        showLocked: user.showLocked,
        guest: user.guest,
        expiresAt: user.expiresAt,
      },
      tools,
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
    // Общие стили, скрипты, картинки и шрифты портала. HTML-страниц отсюда не отдаём:
    // они открываются только по своим адресам (/, /journal, /admin/users …) и после входа
    if (first === 'portal' && segments.length >= 2) {
      if (!isAsset(segments, trailingSlash)) return notFound(res);
      return sendFile(res, webDir, segments.slice(1), trailingSlash, path);
    }
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
      if (trailingSlash) return notFound(res);
      // /help/<ключ> — инструкция; ключ только из каталога, файл — portal/help/<ключ>.html
      if (segments.length === 2 && catalog.keys.includes(segments[1])) {
        const key = segments[1];
        const fragment = await files.serve(helpDir, [`${key}.html`]);
        if (!fragment || fragment.redirectSlash) return notFound(res);
        const allowed = allowedKeys(user, db.getTools(user.id), catalog).has(key);
        if (!allowed && !seesLocked(user)) return notFound(res); // о закрытом инструменте не рассказываем
        return send(res, 200, 'text/html; charset=utf-8', helpPage(catalog, key, fragment.body.toString('utf8'), allowed));
      }
      // /help/samples/<файл> — пример файла, только прямо из portal/help/samples (без подкаталогов)
      if (segments.length === 3 && segments[1] === 'samples') {
        const found = await files.serve(samplesDir, [segments[2]]);
        if (!found || found.redirectSlash) return notFound(res);
        return send(res, 200, found.type, found.body, { 'Content-Disposition': attachment(segments[2]) });
      }
      return notFound(res);
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
        if (!seesLocked(user)) return notFound(res); // как будто такого инструмента нет
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
    if (hsts) res.setHeader('Strict-Transport-Security', HSTS);

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

  const handler = (req, res) => {
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
  // Для тестов: дождаться писем, которые уходят в фоне
  handler.idle = auth.idle;
  return handler;
}
