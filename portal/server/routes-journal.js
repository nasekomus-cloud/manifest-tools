// Журнал работы и запрос доступа к инструменту — для любого вошедшего.
//
// В журнал попадают только ключ инструмента, имена файлов и текст итога: сами файлы
// манифестов на сервер не отправляются никогда.

import { allowedKeys } from './catalog.js';
import { HttpError, readJson, sendJson } from './http-utils.js';
import { sendSafely, accessRequestMail } from './mail.js';
import { createLimiter } from './ratelimit.js';

export const MAX_FILES = 50;
export const MAX_FILE_NAME = 255;
export const MAX_SUMMARY = 500;
export const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
// Не больше стольких записей от одного человека за окно: журнал не должен
// разрастаться от зациклившейся страницы или чужого скрипта в открытой сессии.
export const JOURNAL_MAX_PER_USER = 60;
export const JOURNAL_WINDOW_MS = 10 * 60 * 1000;
const JOURNAL_RATE_MESSAGE = 'Слишком много записей в журнал. Подождите несколько минут.';

const NEED_LOGIN = { error: 'Нужно войти' };

// Обрезка по символам, а не по кодовым единицам: пару-суррогат (эмодзи в имени файла) не рвём
function truncate(text, max) {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

/**
 * @param {object} deps
 * @param {object} deps.db
 * @param {{keys: string[], tools: object[]}} deps.catalog
 * @param {() => number} deps.now
 * @param {object|null} [deps.mailer]
 * @param {string} [deps.publicOrigin]
 */
export function createJournalRoutes({ db, catalog, now, mailer = null, publicOrigin = '' }) {
  const knownKeys = new Set(catalog.keys);
  // Счётчик в памяти, по человеку; при перезапуске обнуляется
  const journalLimiter = createLimiter({ max: JOURNAL_MAX_PER_USER, windowMs: JOURNAL_WINDOW_MS, now });
  const toolTitle = (key) => catalog.tools.find((t) => t.key === key)?.title ?? key;

  function allowedFor(user) {
    return allowedKeys(user, db.getTools(user.id), catalog);
  }

  async function handleAddJournal(req, res, ctx) {
    if (!ctx.user) return sendJson(res, 401, NEED_LOGIN);
    const body = await readJson(req);
    const { tool, kind, files, summary } = body;
    if (typeof tool !== 'string' || !knownKeys.has(tool) || !allowedFor(ctx.user).has(tool)) {
      throw new HttpError(400, 'Неизвестный инструмент');
    }
    if (kind !== 'result' && kind !== 'download') throw new HttpError(400, 'Неизвестный вид записи');
    if (!Array.isArray(files) || files.length > MAX_FILES || files.some((name) => typeof name !== 'string')) {
      throw new HttpError(400, `Список файлов — до ${MAX_FILES} имён`);
    }
    if (typeof summary !== 'string') throw new HttpError(400, 'Нет текста итога');

    const limitKey = String(ctx.user.id);
    if (journalLimiter.blocked(limitKey)) return sendJson(res, 429, { error: JOURNAL_RATE_MESSAGE });
    journalLimiter.hit(limitKey);

    db.addJournal({
      userId: ctx.user.id,
      tool,
      kind,
      files: files.map((name) => truncate(name, MAX_FILE_NAME)),
      summary: truncate(summary, MAX_SUMMARY),
      at: now(),
    });
    res.writeHead(204);
    res.end();
  }

  function parseCount(text, what) {
    if (!/^\d{1,15}$/.test(text)) throw new HttpError(400, what);
    return Number(text);
  }

  function handleListJournal(req, res, ctx) {
    if (!ctx.user) return sendJson(res, 401, NEED_LOGIN);
    const params = new URL(req.url, 'http://portal.local').searchParams;

    const filter = {};
    if (ctx.user.isAdmin) {
      if (params.has('user')) filter.userId = parseCount(params.get('user'), 'Человек указан неверно');
    } else {
      filter.userId = ctx.user.id; // параметр user коллегам не нужен — только свои записи
    }
    if (params.has('tool')) filter.tool = params.get('tool');
    filter.limit = DEFAULT_LIMIT;
    if (params.has('limit')) {
      const limit = parseCount(params.get('limit'), 'Предел указан неверно');
      if (limit < 1) throw new HttpError(400, 'Предел указан неверно');
      filter.limit = Math.min(limit, MAX_LIMIT);
    }
    sendJson(res, 200, db.listJournal(filter).map((rec) => ({ ...rec, toolTitle: toolTitle(rec.tool) })));
  }

  async function handleRequestAccess(req, res, ctx) {
    if (!ctx.user) return sendJson(res, 401, NEED_LOGIN);
    // Без show_locked человек закрытых инструментов не видит — и просить о них не может
    if (!ctx.user.isAdmin && !ctx.user.showLocked) return sendJson(res, 403, { error: 'Запросы доступа отключены' });
    const body = await readJson(req);
    const { tool } = body;
    if (typeof tool !== 'string' || !knownKeys.has(tool)) throw new HttpError(400, 'Неизвестный инструмент');
    if (allowedFor(ctx.user).has(tool)) return sendJson(res, 200, { already: true });
    const { created } = db.addRequest({ userId: ctx.user.id, tool, at: now() });
    if (created && mailer) {
      // Новый запрос — письмо каждому активному администратору (в фоне, на ответ не влияет)
      const mail = accessRequestMail({
        userName: ctx.user.name,
        userEmail: ctx.user.guest ? 'тестовая ссылка' : ctx.user.email, // служебный адрес тестового не показываем
        toolTitle: toolTitle(tool),
        adminUrl: `${publicOrigin}/admin/requests`,
      });
      for (const admin of db.listUsers()) {
        if (admin.isAdmin && admin.status === 'active') void sendSafely(mailer, { to: admin.email, ...mail });
      }
    }
    return sendJson(res, created ? 201 : 200, { created });
  }

  const api = {
    '/api/journal': { GET: handleListJournal, POST: handleAddJournal },
    '/api/requests': { POST: handleRequestAccess },
  };

  return {
    /** Маршрут API по пути: объект «метод → обработчик» или null. */
    matchApi: (pathname) => api[pathname] ?? null,
  };
}
