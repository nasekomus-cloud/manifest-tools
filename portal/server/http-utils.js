// Мелкие помощники HTTP: тело запроса, ответы, cookie.

/** Ошибка с кодом ответа; её сообщение уходит человеку как есть, поэтому по-русски. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Читает тело как JSON-объект. Больше limitBytes — 413 (чтение прекращается сразу,
 * чтобы нельзя было прислать гигабайт), не объект или кривой JSON — 400.
 */
export function readJson(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limitBytes) {
        failed = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Слишком большой запрос'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
        resolve(value);
      } catch {
        reject(new HttpError(400, 'Некорректный запрос'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}

/** Отдаёт готовое тело. Cache-Control и nosniff ставит app.js на каждый ответ заранее. */
export function send(res, status, contentType, body, extraHeaders = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    ...extraHeaders,
  });
  // HEAD: заголовки те же, тела нет
  res.end(res.req?.method === 'HEAD' ? undefined : buf);
}

export function sendJson(res, status, value, extraHeaders = {}) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value), extraHeaders);
}

export function sendText(res, status, text) {
  send(res, status, 'text/plain; charset=utf-8', text);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Content-Length': 0 });
  res.end();
}

/** Разбор заголовка Cookie в объект имя → значение. Битые пары пропускаются. */
export function parseCookies(header) {
  const cookies = Object.create(null);
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || name in cookies) continue;
    cookies[name] = part.slice(eq + 1).trim();
  }
  return cookies;
}

export const SESSION_COOKIE = 'lt_session';
export const SESSION_MAX_AGE = 34560000; // 400 дней, секунд

/** Значение Set-Cookie для сессии; maxAge: 0 — удалить cookie. */
export function sessionCookie(token, { secure = true, maxAge = SESSION_MAX_AGE } = {}) {
  return [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    secure ? 'Secure' : null,
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    'Path=/',
  ].filter(Boolean).join('; ');
}
