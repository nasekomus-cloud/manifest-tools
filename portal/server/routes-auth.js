// Приглашения, сброс пароля, смена пароля и «Забыли пароль?».
//
// Ссылки живут в таблице tokens (kind 'invite' | 'reset'): приглашение — 7 дней,
// сброс — 24 часа, оба одноразовые. Удачное задание пароля по ссылке гасит токен,
// гасит все прежние сессии человека и сразу входит им — cookie выдаётся так же, как при входе.
//
// Тестовая ссылка (kind 'guest') — другое: она многоразовая до срока тестового человека
// (users.guest = 1, без пароля и с expires_at) и сразу открывает портал без пароля.

import { normalizeEmail } from './db.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createLimiter } from './ratelimit.js';
import { HttpError, readJson, sendJson, sessionCookie } from './http-utils.js';
import { sendSafely, resetMail, inviteMail } from './mail.js';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_TOKEN_LENGTH = 128;

const GONE = { error: 'Ссылка уже использована или устарела — попросите новую у администратора.' };
const SHORT_PASSWORD = 'Пароль — не короче 8 символов';
const FORGOT_MESSAGE = 'Если такой адрес есть, мы передали запрос администратору.';
const RATE_LIMIT_MESSAGE = 'Слишком много попыток. Попробуйте через 15 минут.';

/**
 * Выпускает ссылку для человека: приглашённому, который ещё не задавал пароль, — приглашение
 * на 7 дней, тестовому — тестовая ссылка до конца его срока, остальным — сброс пароля
 * на 24 часа. Возвращает полный адрес ссылки.
 * Прежние неиспользованные ссылки этого человека перестают действовать.
 */
export function issueLink(db, user, { now, publicOrigin }) {
  // Работает только самая новая ссылка: прежние неиспользованные гасим
  db.revokeUserTokens(user.id, now);
  const origin = publicOrigin.replace(/\/+$/, '');
  if (user.guest) {
    // Тестовому — снова тестовая ссылка, на его текущий срок
    const token = db.createToken({ userId: user.id, kind: 'guest', expiresAt: user.expiresAt });
    return `${origin}/guest/${token}`;
  }
  if (user.status === 'invited') {
    const token = db.createToken({ userId: user.id, kind: 'invite', expiresAt: now + INVITE_TTL_MS });
    return `${origin}/invite/${token}`;
  }
  const token = db.createToken({ userId: user.id, kind: 'reset', expiresAt: now + RESET_TTL_MS });
  return `${origin}/reset/${token}`;
}

function checkPassword(password) {
  if (typeof password !== 'string') throw new HttpError(400, SHORT_PASSWORD);
  if (password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, SHORT_PASSWORD);
  if (password.length > MAX_PASSWORD_LENGTH) throw new HttpError(400, 'Слишком длинное значение');
}

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {() => number} deps.now
 * @param {object|null} deps.mailer      почта (null — без почты, запрос уходит администратору)
 * @param {object} deps.cookieOptions
 * @param {(req) => string} deps.clientIp
 */
export function createAuthRoutes({ db, now, mailer, publicOrigin, cookieOptions, clientIp }) {
  // Отдельный счётчик от входа: запросы «Забыли пароль?» не должны ни блокировать вход, ни зависеть от него
  const forgotLimiter = createLimiter({ max: 10, windowMs: 15 * 60 * 1000, now });

  /**
   * Человек, которому принадлежит действующая ссылка этого вида, иначе null.
   * Приглашение годится только тому, кто ещё не задавал пароль; сброс — только активному.
   */
  function linkUser(kind, token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const userId = db.peekToken(token, kind, now());
    if (userId === null) return null;
    const user = db.getUserById(userId);
    const wanted = kind === 'invite' ? 'invited' : 'active';
    return user && user.status === wanted ? user : null;
  }

  /** Новая сессия вместо всех прежних; ответ с cookie. */
  function startFreshSession(res, userId) {
    db.deleteUserSessions(userId);
    const session = db.createSession(userId, now());
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(session, cookieOptions) });
  }

  function handleLinkInfo(res, kind, token) {
    const user = linkUser(kind, token);
    if (!user) return sendJson(res, 410, GONE);
    return sendJson(res, 200, { email: user.email, name: user.name });
  }

  async function handleLinkSubmit(req, res, kind, token) {
    const body = await readJson(req);
    if (!linkUser(kind, token)) return sendJson(res, 410, GONE);
    checkPassword(body.password);
    const hash = await hashPassword(body.password);
    // Токен тратится одним запросом: из двух одновременных отправок пароль зададит только одна
    const userId = db.consumeToken(token, kind, now());
    if (userId === null) return sendJson(res, 410, GONE);
    db.setPassword(userId, hash);
    db.revokeUserTokens(userId, now()); // остальные ссылки этого человека больше не нужны
    // Вход по ссылке — тоже вход: иначе в «Пользователях» у принявшего приглашение
    // стояло бы «ещё не входил», пока он не войдёт паролем
    db.touchLogin(userId, now());
    return startFreshSession(res, userId);
  }

  async function handlePassword(req, res, ctx) {
    const body = await readJson(req);
    if (!ctx.user) return sendJson(res, 401, { error: 'Нужно войти' });
    if (ctx.user.guest) return sendJson(res, 403, { error: 'У тестового доступа нет пароля' });
    const { current, password } = body;
    if (typeof current !== 'string' || current.length > MAX_PASSWORD_LENGTH) {
      throw new HttpError(400, 'Текущий пароль указан неверно');
    }
    const hash = db.getPasswordHash(ctx.user.id);
    if (!hash || !(await verifyPassword(current, hash))) {
      throw new HttpError(400, 'Текущий пароль указан неверно');
    }
    checkPassword(password);
    db.setPassword(ctx.user.id, await hashPassword(password));
    db.revokeUserTokens(ctx.user.id, now()); // выданная ранее ссылка сброса после смены пароля не действует
    return startFreshSession(res, ctx.user.id);
  }

  // Письма, которые ещё уходят в фоне: на них ждут тесты (idle) и они же не дают потерять ошибку
  const pending = new Set();
  function track(promise) {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  }

  /**
   * Новая ссылка письмом: активному — сброс пароля, приглашённому (кто так и не задал пароль,
   * например, истёк срок приглашения) — свежее приглашение. Письмо не ушло — запрос
   * администратору, как без почты. Не бросает.
   */
  async function mailLink(user) {
    try {
      const link = issueLink(db, user, { now: now(), publicOrigin });
      const mail = user.status === 'invited' ? inviteMail({ name: user.name, link }) : resetMail({ name: user.name, link });
      if (await sendSafely(mailer, { to: user.email, ...mail })) return;
      db.addRequest({ userId: user.id, tool: null, at: now() });
    } catch (err) {
      console.error(`Сброс пароля: ${err?.message ?? err}`);
    }
  }

  async function handleForgot(req, res) {
    const body = await readJson(req);
    if (typeof body.email !== 'string' || body.email.length === 0) throw new HttpError(400, 'Введите почту');
    if (body.email.length > 254) throw new HttpError(400, 'Слишком длинное значение');

    // Каждый запрос — попытка: иначе можно было бы забить администратору список запросов
    const ipKey = `ip:${clientIp(req)}`;
    if (forgotLimiter.blocked(ipKey)) return sendJson(res, 429, { error: RATE_LIMIT_MESSAGE });
    forgotLimiter.hit(ipKey);

    const user = db.getUserByEmail(normalizeEmail(body.email));
    // Всем, кроме отключённых: приглашённый с истёкшей ссылкой тоже должен дойти до администратора.
    // Тестовые (служебная почта, пароля нет) — как неизвестная почта
    if (user && user.status !== 'disabled' && !user.guest) {
      if (mailer) {
        // Ответ не ждёт SMTP: иначе зависшая почта давала бы 504, а время ответа выдавало бы, что адрес известен
        track(mailLink(user));
      } else {
        db.addRequest({ userId: user.id, tool: null, at: now() });
      }
    }
    // Ответ один и тот же для известной и неизвестной почты
    return sendJson(res, 200, { message: FORGOT_MESSAGE });
  }

  const api = {
    '/api/forgot': { POST: handleForgot },
    '/api/password': { POST: handlePassword },
  };

  /** Адреса со ссылкой-токеном: /api/invite/<token>, /api/reset/<token>. */
  function matchLinkApi(pathname) {
    const m = /^\/api\/(invite|reset)\/([^/]+)$/.exec(pathname);
    if (!m) return null;
    let token;
    try {
      token = decodeURIComponent(m[2]);
    } catch {
      token = '';
    }
    const kind = m[1];
    return {
      GET: (req, res) => handleLinkInfo(res, kind, token),
      POST: (req, res) => handleLinkSubmit(req, res, kind, token),
    };
  }

  /**
   * Открывает тестовую ссылку: действующий guest-токен тестового человека, активного и с
   * неистёкшим сроком, → новая сессия (сырой токен для cookie). Иначе null. Других людей
   * по этой ссылке не впустить: нужен и вид токена 'guest', и признак guest у человека.
   * Прежние сессии не гасятся — ссылку можно открыть на нескольких устройствах.
   */
  function openGuestLink(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const at = now();
    db.disableExpired(at); // истёкший срок записывается сразу, а не при ночной уборке
    const userId = db.peekGuestToken(token, at);
    if (userId === null) return null;
    const user = db.getUserById(userId);
    if (!user || !user.guest || user.status !== 'active' || user.expiresAt === null || at >= user.expiresAt) return null;
    db.touchLogin(user.id, at);
    return db.createSession(user.id, at);
  }

  return {
    /** Маршрут API по пути: объект «метод → обработчик» или null. */
    matchApi: (pathname) => api[pathname] ?? matchLinkApi(pathname),
    openGuestLink,
    /** Действует ли ссылка вида kind ('invite' | 'reset') — для страницы по ссылке. */
    isLinkLive: (kind, token) => linkUser(kind, token) !== null,
    /** Ждёт, пока завершатся письма, отправляемые в фоне (для тестов). */
    idle: async () => { while (pending.size > 0) await Promise.allSettled([...pending]); },
  };
}
