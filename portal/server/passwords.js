// Хеширование паролей портала: scrypt из node:crypto, без внешних пакетов.
// Формат записи в базе: scrypt$<соль, 16 байт, hex>$<ключ, 64 байта, hex>.
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    // normalize('NFC') — один и тот же пароль с «й»/«ё», набранный с разных
    // клавиатур, не должен давать разные байты
    scrypt(password.normalize('NFC'), salt, KEY_BYTES, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** @returns {Promise<string>} */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Сверка пароля с записью из базы; чужой формат записи — просто false. */
export async function verifyPassword(password, stored) {
  const match = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored ?? '');
  if (!match) return false;
  const expected = Buffer.from(match[2], 'hex');
  const actual = await deriveKey(password, Buffer.from(match[1], 'hex'));
  return timingSafeEqual(actual, expected);
}
