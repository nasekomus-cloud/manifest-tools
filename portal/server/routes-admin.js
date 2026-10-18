// API администратора: люди, права, ссылки входа и запросы доступа.
//
// Все адреса /api/admin/* — только администраторам: без входа 401, коллеге 403.
// Проверка стоит до чтения тела запроса, чтобы коллега не мог ничего «пощупать».

import { randomBytes } from 'node:crypto';
import { normalizeEmail } from './db.js';
import { issueLink } from './routes-auth.js';
import { HttpError, readJson, sendJson } from './http-utils.js';
import { sendSafely, inviteMail } from './mail.js';

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 200;
const HOUR_MS = 60 * 60 * 1000;
export const GUEST_DEFAULT_HOURS = 24;
export const GUEST_MAX_HOURS = 720;
// Служебный домен почты тестовых: .invalid по RFC 2606 не существует, письмо туда не уйдёт
export const GUEST_EMAIL_DOMAIN = '@guest.invalid';
const BAD_HOURS = 'Срок — целое число часов от 1 до 720';

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
 * @param {object|null} [deps.mailer]  почта; null — ссылки только возвращаются в ответе
 */
export function createAdminRoutes({ db, catalog, now, publicOrigin, mailer = null }) {
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

  /** Необязательный признак show_locked: нет — false, не булево — 400. */
  function parseShowLocked(value) {
    if (value === undefined) return false;
    if (typeof value !== 'boolean') throw new HttpError(400, 'Настройка указана неверно');
    return value;
  }

  /** Срок в часах: нет — 24, иначе целое 1–720. */
  function parseHours(value) {
    if (value === undefined) return GUEST_DEFAULT_HOURS;
    if (!Number.isInteger(value) || value < 1 || value > GUEST_MAX_HOURS) throw new HttpError(400, BAD_HOURS);
    return value;
  }

  function parseName(value, emptyMessage) {
    if (typeof value !== 'string') throw new HttpError(400, emptyMessage);
    const clean = value.trim();
    if (clean.length === 0) throw new HttpError(400, emptyMessage);
    if (clean.length > MAX_NAME_LENGTH) throw new HttpError(400, 'Слишком длинное имя');
    return clean;
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
    db.disableExpired(now()); // у кого срок вышел — в списке сразу «отключён»
    sendJson(res, 200, db.listUsers());
  }

  // --- тестовый доступ ---------------------------------------------------------

  async function handleCreateGuest(req, res) {
    const body = await readJson(req);
    const name = parseName(body.name, 'Укажите название');
    const tools = body.tools === undefined ? [] : parseTools(body.tools);
    const showLocked = parseShowLocked(body.showLocked);
    const hours = parseHours(body.hours);
    const at = now();
    const created = db.createUser({
      email: `guest-${randomBytes(12).toString('hex')}${GUEST_EMAIL_DOMAIN}`,
      name,
      isAdmin: false,
      at,
      showLocked,
      guest: true,
      expiresAt: at + hours * HOUR_MS, // срок — от момента выдачи ссылки
      status: 'active',
    });
    db.setTools(created.id, tools);
    const guestLink = link(db.getUserById(created.id));
    sendJson(res, 201, { user: userWithTools(created.id), link: guestLink });
  }

  // «Продлить»: новый срок от текущего момента, статус «активен». Живые ссылки продлеваются;
  // если их нет (срок уже истёк или доступ отключали — ссылки погашены), в ответе новая ссылка
  async function handleExtend(req, res, id) {
    const body = await readJson(req);
    const user = requireUser(id);
    if (!user.guest) throw new HttpError(400, 'Продлить можно только тестовый доступ');
    const hours = parseHours(body.hours);
    const expiresAt = now() + hours * HOUR_MS;
    db.setExpiry(user.id, expiresAt);
    db.setStatus(user.id, 'active');
    const extended = db.extendGuestTokens(user.id, expiresAt);
    const result = { user: userWithTools(user.id) };
    if (extended === 0) result.link = link(db.getUserById(user.id));
    sendJson(res, 200, result);
  }

  async function handleCreateUser(req, res) {
    const body = await readJson(req);
    const { email, name } = body;
    if (typeof email !== 'string' || typeof name !== 'string') throw new HttpError(400, 'Укажите имя и почту');
    const cleanEmail = normalizeEmail(email);
    const cleanName = name.trim();
    if (cleanName.length === 0) throw new HttpError(400, 'Укажите имя');
    if (cleanName.length > MAX_NAME_LENGTH) throw new HttpError(400, 'Слишком длинное имя');
    if (!cleanEmail.includes('@') || /\s/.test(cleanEmail) || cleanEmail.length > MAX_EMAIL_LENGTH || cleanEmail.endsWith(GUEST_EMAIL_DOMAIN)) {
      throw new HttpError(400, 'Почта указана неверно');
    }
    const tools = body.tools === undefined ? [] : parseTools(body.tools);
    const showLocked = parseShowLocked(body.showLocked);
    // Занятая почта — понятный ответ, а не ошибка SQLite
    if (db.getUserByEmail(cleanEmail)) throw new HttpError(409, 'Такой адрес уже есть');

    const created = db.createUser({ email: cleanEmail, name: cleanName, isAdmin: false, at: now(), showLocked });
    db.setTools(created.id, tools);
    const inviteLink = link(created);
    // Письмо уходит в фоне и не влияет на ответ; ссылка остаётся и в ответе — её можно скопировать
    void sendSafely(mailer, { to: cleanEmail, ...inviteMail({ name: cleanName, link: inviteLink }) });
    sendJson(res, 201, { user: userWithTools(created.id), link: inviteLink });
  }

  async function handleSetTools(req, res, id) {
    const body = await readJson(req);
    const user = requireUser(id);
    if (user.isAdmin) throw new HttpError(400, 'У администратора все инструменты');
    db.setTools(user.id, parseTools(body.tools));
    sendJson(res, 200, { user: userWithTools(user.id) });
  }

  async function handleSettings(req, res, id) {
    const body = await readJson(req);
    const user = requireUser(id);
    if (user.isAdmin) throw new HttpError(400, 'У администратора открыто всё');
    if (typeof body.showLocked !== 'boolean') throw new HttpError(400, 'Настройка указана неверно');
    db.setShowLocked(user.id, body.showLocked);
    sendJson(res, 200, { user: userWithTools(user.id) });
  }

  function handleLink(req, res, id) {
    db.disableExpired(now());
    const user = requireUser(id);
    if (user.status === 'disabled' && user.guest) throw new HttpError(409, 'Тестовый доступ отключён — сначала продлите его');
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
    db.revokeUserTokens(user.id, now()); // и выданная ранее ссылка приглашения/сброса
    sendJson(res, 200, { user: userWithTools(user.id) });
  }

  function handleEnable(req, res, id) {
    const user = requireUser(id);
    if (user.guest) throw new HttpError(409, 'Тестовый доступ не включают, а продлевают');
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
    [/^\/api\/admin\/users\/([^/]+)\/settings$/, { PUT: handleSettings }],
    [/^\/api\/admin\/users\/([^/]+)\/link$/, { POST: handleLink }],
    [/^\/api\/admin\/users\/([^/]+)\/disable$/, { POST: handleDisable }],
    [/^\/api\/admin\/users\/([^/]+)\/enable$/, { POST: handleEnable }],
    [/^\/api\/admin\/users\/([^/]+)\/extend$/, { POST: handleExtend }],
    [/^\/api\/admin\/guests$/, { POST: handleCreateGuest }],
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
