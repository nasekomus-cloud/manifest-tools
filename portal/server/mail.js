// Необязательная почта портала. Без SMTP_HOST портал работает целиком: ссылки администратор
// копирует сам, запросы лежат в его списке. Когда SMTP настроен, письма начинают уходить
// без правок кода.
//
//   SMTP_HOST  сервер исходящей почты (без него почты нет)
//   SMTP_PORT  порт, по умолчанию 587; 465 — TLS сразу при подключении
//   SMTP_USER, SMTP_PASS  логин и пароль (без SMTP_USER — без авторизации)
//   SMTP_FROM  адрес отправителя, например «Лоция <no-reply@example.ru>»

// nodemailer подгружается только когда SMTP_HOST задан (динамический import внутри
// createMailer): без почты пакет не нужен и на сервере его может не быть вовсе.

const SMTP_TIMEOUT_MS = 10_000;

/**
 * @param {Record<string, string|undefined>} env
 * @param {{createTransport?: Function}} [transports]  подмена nodemailer — для тестов без сети
 * @returns {Promise<{send: (message: {to: string, subject: string, text: string}) => Promise<void>} | null>}
 */
export async function createMailer(env, { createTransport } = {}) {
  if (!env.SMTP_HOST) return null;
  if (!createTransport) {
    const nodemailer = (await import('nodemailer')).default;
    createTransport = nodemailer.createTransport.bind(nodemailer);
  }
  const port = Number(env.SMTP_PORT || 587);
  // Зависший SMTP не должен держать ничего дольше 10 секунд на каждом этапе (у nodemailer по умолчанию — минуты)
  const options = {
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  };
  if (env.SMTP_USER) options.auth = { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' };
  const transport = createTransport(options);
  const from = env.SMTP_FROM;
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
  };
}

/**
 * Отправляет письмо и никогда не бросает исключение: сбой почты пишется в console.error
 * и не должен менять ответ на HTTP-запрос. Без почты ничего не делает.
 * Вызов send происходит сразу (до первого await), ожидать результат не обязательно.
 */
export async function sendSafely(mailer, message) {
  if (!mailer) return false;
  try {
    await mailer.send(message);
    return true;
  } catch (err) {
    console.error(`Почта: не удалось отправить письмо (${message.subject}): ${err?.message ?? err}`);
    return false;
  }
}

// --- тексты писем ------------------------------------------------------------

export function inviteMail({ name, link }) {
  return {
    subject: 'Приглашение в Лоцию',
    text: [
      `Здравствуйте, ${name}!`,
      '',
      'Вас пригласили в Лоцию — набор инструментов для судовых манифестов.',
      'Чтобы задать пароль и войти, откройте ссылку (она действует 7 дней):',
      link,
    ].join('\n'),
  };
}

export function resetMail({ name, link }) {
  return {
    subject: 'Сброс пароля в Лоции',
    text: [
      `Здравствуйте, ${name}!`,
      '',
      'Для вашей почты запросили сброс пароля в Лоции.',
      'Чтобы задать новый пароль, откройте ссылку (она действует 24 часа):',
      link,
      '',
      'Если вы ничего не запрашивали, просто проигнорируйте письмо.',
    ].join('\n'),
  };
}

export function accessRequestMail({ userName, userEmail, toolTitle, adminUrl }) {
  return {
    subject: 'Запрос доступа в Лоции',
    text: [
      `${userName} (${userEmail}) просит доступ к инструменту «${toolTitle}».`,
      '',
      `Решить: ${adminUrl}`,
    ].join('\n'),
  };
}
