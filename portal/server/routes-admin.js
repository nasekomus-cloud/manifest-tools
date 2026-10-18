// API администратора: люди, права, ссылки входа и запросы доступа.
//
// Все адреса /api/admin/* — только администраторам: без входа 401, коллеге 403.
// Проверка стоит до чтения тела запроса, чтобы коллега не мог ничего «пощупать».

import { normalizeEmail } from './db.js';
import { issueLink } from './routes-auth.js';
import { HttpError, readJson, sendJson } from './http-utils.js';

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;

const NEED_LOGIN = { error: 'Нужно войти' };
const NOT_ADMIN = { error: 'Только для администратора' };

function parseId(text) {
  return /^\d{1,15}$/.test(text) ? Number(text) : null;
}

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {{keys: string[], tools: object[]}} deps.catalog
 * @param {() => number} deps.now
 * @param {string} deps.publicOrigin
 */
export function createAdminRoutes({ db, catalog, now, publicOrigin }) {
  const knownKeys = new Set(catalog.keys);

  /** Список ключей из тела: массив строк из каталога. Иначе 400. */
  function parseTools(value) {
    if (!Array.isArray(value) || value.some((key) => typeof key !== 'string')) {
      throw new HttpError(400, 'Список инструментов указан неверно');
    }
    const unknown = value.find((key) => !knownKeys.has(key));
    if (unknown !== undefined) throw new HttpError(400, `Неизвестный инструмент: ${unknown.slice(0, 80)}`);
    return [...new Set(value)];
  }

  function userWithTools(id) {
    return { ...db.getUserById(id), tools: db.getTools(id) };
  }

  function requireUser(id) {
    const user = id === null ? null : db.getUserById(id);
    if (!user) throw new HttpError(404, 'Человек не найден');
    return user;
  }

  const link = (user) => issueLink(db, user, { now: now(), publicOrigin });

  // --- люди ----------------------------------------------------------------

  function handleListUsers(req, res) {
    sendJson(res, 200, db.listUsers());
  }

  async function handleCreateUser(req, res) {
    const body = await readJson(req);
    const { email, name } = body;
    if (typeof email !== 'string' || typeof name !== 'string') throw new HttpError(400, 'Укажите имя и почту');
    const cleanEmail = normalizeEmail(email);
    const cleanName = name.trim();
    if (cleanName.length === 0) throw new HttpError(400, 'Укажите имя');
    if (cleanName.length > MAX_NAME_LENGTH) throw new HttpError(400, 'Слишком длинное имя');
    if (!cleanEmail.includes('@') || /\s/.test(cleanEmail) || cleanEmail.length > MAX_EMAIL_LENGTH) {
      throw new HttpError(400, 'Почта указана неверно');
    }
    const tools = body.tools === undefined ? [] : parseTools(body.tools);
    // Занятая почта — понятный ответ, а не ошибка SQLite
    if (db.getUserByEmail(cleanEmail)) throw new HttpError(409, 'Такой адрес уже есть');

    const created = db.createUser({ email: cleanEmail, name: cleanName, isAdmin: false, at: now() });
    db.setTools(created.id, tools);
    sendJson(res, 201, { user: userWithTools(created.id), link: link(created) });
  }

  async function handleSetTools(req, res, id) {
    const body = await readJson(req);
    const user = requireUser(id);
    if (user.isAdmin) throw new HttpError(400, 'У администратора все инструменты');
    db.setTools(user.id, parseTools(body.tools));
    sendJson(res, 200, { user: userWithTools(user.id) });
  }

  function handleLink(req, res, id) {
    const user = requireUser(id);
    if (user.status === 'disabled') throw new HttpError(409, 'Человек отключён — сначала включите доступ');
    sendJson(res, 200, { link: link(user) });
  }

  function handleDisable(req, res, id, ctx) {
    const user = requireUser(id);
    if (user.id === ctx.user.id) throw new HttpError(409, 'Нельзя отключить самого себя');
    // Подстраховка: войти и вызвать это может только активный администратор, но если
    // базу правили руками — без администраторов портал стал бы недоступен.
    if (user.isAdmin && user.status === 'active') {
      const activeAdmins = db.listUsers().filter((u) => u.isAdmin && u.status === 'active').length;
      if (activeAdmins <= 1) throw new HttpError(409, 'Нельзя отключить последнего администратора');
    }
    db.setStatus(user.id, 'disabled');
    db.deleteUserSessions(user.id); // иначе после включения старая cookie ожила бы
    sendJson(res, 200, { user: userWithTools(user.id) });
  }

  function handleEnable(req, res, id) {
    const user = requireUser(id);
    // Без пароля человек так и не принял приглашение — ему по-прежнему нужна ссылка
    db.setStatus(user.id, db.getPasswordHash(user.id) ? 'active' : 'invited');
    sendJson(res, 200, { user: userWithTools(user.id) });
  }

  // --- запросы доступа -------------------------------------------------------

  const toolTitle = (key) => (key === null ? null : catalog.tools.find((t) => t.key === key)?.title ?? null);

  function handleListRequests(req, res) {
    sendJson(res, 200, db.listRequests().map((r) => ({ ...r, toolTitle: toolTitle(r.tool) })));
  }

  function openRequest(id) {
    const request = id === null ? undefined : db.listRequests().find((r) => r.id === id);
    if (!request) throw new HttpError(404, 'Запрос не найден или уже обработан');
    return request;
  }

  function handleGrant(req, res, id, ctx) {
    const request = openRequest(id);
    const user = requireUser(request.userId);
    // Запрос «не может войти» закрывается новой ссылкой; у отключённого её выдать нельзя
    if (request.tool === null && user.status === 'disabled') {
      throw new HttpError(409, 'Человек отключён — сначала включите доступ');
    }
    if (!db.resolveRequest(request.id, 'granted', ctx.user.id, now())) {
      throw new HttpError(404, 'Запрос не найден или уже обработан');
    }
    if (request.tool === null) return sendJson(res, 200, { ok: true, link: link(user) });
    if (!user.isAdmin && knownKeys.has(request.tool)) {
      db.setTools(user.id, [...new Set([...db.getTools(user.id), request.tool])]);
    }
    return sendJson(res, 200, { ok: true });
  }

  function handleReject(req, res, id, ctx) {
    const request = openRequest(id);
    if (!db.resolveRequest(request.id, 'rejected', ctx.user.id, now())) {
      throw new HttpError(404, 'Запрос не найден или уже обработан');
    }
    sendJson(res, 200, { ok: true });
  }

  // --- маршруты --------------------------------------------------------------

  const ROUTES = [
    [/^\/api\/admin\/users$/, { GET: handleListUsers, POST: handleCreateUser }],
    [/^\/api\/admin\/users\/([^/]+)\/tools$/, { PUT: handleSetTools }],
    [/^\/api\/admin\/users\/([^/]+)\/link$/, { POST: handleLink }],
    [/^\/api\/admin\/users\/([^/]+)\/disable$/, { POST: handleDisable }],
    [/^\/api\/admin\/users\/([^/]+)\/enable$/, { POST: handleEnable }],
    [/^\/api\/admin\/requests$/, { GET: handleListRequests }],
    [/^\/api\/admin\/requests\/([^/]+)\/grant$/, { POST: handleGrant }],
    [/^\/api\/admin\/requests\/([^/]+)\/reject$/, { POST: handleReject }],
  ];

  return {
    /** Маршрут API по пути: объект «метод → обработчик» или null. */
    matchApi(pathname) {
      for (const [pattern, handlers] of ROUTES) {
        const m = pattern.exec(pathname);
        if (!m) continue;
        const idText = m[1];
        const route = {};
        for (const [method, handler] of Object.entries(handlers)) {
          route[method] = (req, res, ctx) => {
            if (!ctx.user) return sendJson(res, 401, NEED_LOGIN);
            if (!ctx.user.isAdmin) return sendJson(res, 403, NOT_ADMIN);
            return handler(req, res, idText === undefined ? undefined : parseId(idText), ctx);
          };
        }
        return route;
      }
      return null;
    },
  };
}
