// Токены приглашений, сброса пароля и сессий. Сырой токен уходит человеку
// (в ссылке или cookie), в базе лежит только его sha256 — утечка базы
// не даёт войти.
import { createHash, randomBytes } from 'node:crypto';

/** Новый случайный токен, 43 символа base64url. */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

/** sha256 сырого токена, hex — то, что хранится в базе. */
export function hashToken(raw) {
  return createHash('sha256').update(String(raw)).digest('hex');
}
