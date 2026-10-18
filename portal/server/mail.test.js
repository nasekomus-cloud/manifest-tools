import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer } from './mail.js';
import { startTestServer, TEST_ORIGIN } from './test-helpers.js';

/** Поддельная почта: складывает письма в sent; с failWith — бросает исключение. */
function fakeMailer({ failWith = null } = {}) {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      if (failWith) throw failWith;
    },
  };
}

const post = (body, cookie) => ({
  method: 'POST',
  headers: cookie ? { Cookie: cookie } : {},
  body: JSON.stringify(body),
});

/** Прячет console.error на время fn: ожидаемая ошибка отправки не должна шуметь в выводе тестов. */
async function quietErrors(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    return await fn(logged);
  } finally {
    console.error = original;
  }
}

/** Ждёт, пока в фоне (письмо без ожидания) выполнится всё, что уже стоит в очереди. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function setup(mailer) {
  const s = await startTestServer({ mailer });
  const admin = await s.addUser({ email: 'boss@x.ru', name: 'Босс', password: 'пароль-босса', isAdmin: true });
  const lena = await s.addUser({ email: 'lena@x.ru', name: 'Лена', password: 'пароль-лены', tools: ['merge'] });
  return { s, admin, lena, adminCookie: await s.login('boss@x.ru', 'пароль-босса') };
}

// --- createMailer --------------------------------------------------------

test('createMailer: без SMTP_HOST почты нет', () => {
  assert.equal(createMailer({}), null);
  assert.equal(createMailer({ SMTP_HOST: '', SMTP_FROM: 'a@b.ru' }), null);
});

test('createMailer: с SMTP_HOST отдаёт send и собирает транспорт из переменных окружения', async () => {
  const calls = { options: null, mail: null };
  const createTransport = (options) => {
    calls.options = options;
    return { sendMail: async (mail) => { calls.mail = mail; } };
  };
  const mailer = createMailer(
    { SMTP_HOST: 'smtp.x.ru', SMTP_PORT: '465', SMTP_USER: 'u', SMTP_PASS: 'p', SMTP_FROM: 'Лоция <no-reply@x.ru>' },
    { createTransport },
  );
  assert.equal(typeof mailer.send, 'function');
  assert.deepEqual(calls.options, { host: 'smtp.x.ru', port: 465, secure: true, auth: { user: 'u', pass: 'p' } });
  await mailer.send({ to: 'a@b.ru', subject: 'Тема', text: 'Текст' });
  assert.deepEqual(calls.mail, { from: 'Лоция <no-reply@x.ru>', to: 'a@b.ru', subject: 'Тема', text: 'Текст' });
});

test('createMailer: порт по умолчанию 587 без TLS-обёртки; без SMTP_USER — без авторизации', () => {
  let options;
  createMailer({ SMTP_HOST: 'smtp.x.ru', SMTP_FROM: 'a@b.ru' }, { createTransport: (o) => { options = o; return {}; } });
  assert.deepEqual(options, { host: 'smtp.x.ru', port: 587, secure: false });
});

// --- приглашение ---------------------------------------------------------

test('приглашение: письмо приглашённому со ссылкой, ссылка остаётся и в ответе', async () => {
  const mailer = fakeMailer();
  const { s, adminCookie } = await setup(mailer);
  try {
    const r = await s.fetch('/api/admin/users', post({ email: 'New@X.ru', name: 'Новая', tools: ['merge'] }, adminCookie));
    assert.equal(r.status, 201);
    const { link } = await r.json();
    assert.match(link, new RegExp(`^${TEST_ORIGIN}/invite/`));
    await settle();
    assert.equal(mailer.sent.length, 1);
    const [mail] = mailer.sent;
    assert.equal(mail.to, 'new@x.ru');
    assert.equal(mail.subject, 'Приглашение в Лоцию');
    assert.ok(mail.text.includes(link), 'в письме та же ссылка');
    assert.ok(mail.text.includes('Новая'), 'в письме имя');
  } finally { await s.close(); }
});

test('приглашение без почты работает как раньше', async () => {
  const { s, adminCookie } = await setup(null);
  try {
    const r = await s.fetch('/api/admin/users', post({ email: 'new@x.ru', name: 'Новая' }, adminCookie));
    assert.equal(r.status, 201);
    assert.ok((await r.json()).link.includes('/invite/'));
  } finally { await s.close(); }
});

test('приглашение: сбой отправки не меняет ответ и пишется в console.error', async () => {
  const mailer = fakeMailer({ failWith: new Error('smtp недоступен') });
  const { s, adminCookie } = await setup(mailer);
  try {
    await quietErrors(async (logged) => {
      const r = await s.fetch('/api/admin/users', post({ email: 'new@x.ru', name: 'Новая' }, adminCookie));
      assert.equal(r.status, 201);
      assert.ok((await r.json()).link.includes('/invite/'));
      await settle();
      assert.equal(logged.length, 1);
    });
  } finally { await s.close(); }
});

// --- «Забыли пароль?» ----------------------------------------------------

test('«Забыли пароль?» с почтой: письмо со ссылкой сброса вместо запроса администратору', async () => {
  const mailer = fakeMailer();
  const { s, lena } = await setup(mailer);
  try {
    const r = await s.fetch('/api/forgot', post({ email: 'lena@x.ru' }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { message: 'Если такой адрес есть, мы передали запрос администратору.' });
    assert.equal(mailer.sent.length, 1);
    const [mail] = mailer.sent;
    assert.equal(mail.to, 'lena@x.ru');
    assert.equal(mail.subject, 'Сброс пароля в Лоции');
    const token = new RegExp(`${TEST_ORIGIN}/reset/(\\S+)`).exec(mail.text)?.[1];
    assert.ok(token, 'в письме ссылка сброса');
    assert.equal(s.db.peekToken(token, 'reset', Date.now()), lena.id);
    assert.equal(s.db.listRequests().length, 0, 'администратору запрос не уходит');
  } finally { await s.close(); }
});

test('«Забыли пароль?»: неизвестная и неактивная почта — письма нет, ответ тот же', async () => {
  const mailer = fakeMailer();
  const { s } = await setup(mailer);
  try {
    s.db.createUser({ email: 'inv@x.ru', name: 'Приглашённый' });
    const message = { message: 'Если такой адрес есть, мы передали запрос администратору.' };
    for (const email of ['nobody@x.ru', 'inv@x.ru']) {
      const r = await s.fetch('/api/forgot', post({ email }));
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), message);
    }
    assert.equal(mailer.sent.length, 0);
  } finally { await s.close(); }
});

test('«Забыли пароль?»: send бросает исключение → 200, тот же текст и запрос администратору', async () => {
  const mailer = fakeMailer({ failWith: new Error('smtp недоступен') });
  const { s, lena } = await setup(mailer);
  try {
    await quietErrors(async (logged) => {
      const r = await s.fetch('/api/forgot', post({ email: 'lena@x.ru' }));
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { message: 'Если такой адрес есть, мы передали запрос администратору.' });
      const requests = s.db.listRequests();
      assert.equal(requests.length, 1);
      assert.equal(requests[0].tool, null);
      assert.equal(requests[0].userId, lena.id);
      assert.equal(logged.length, 1);
    });
  } finally { await s.close(); }
});

// --- запрос доступа ------------------------------------------------------

test('запрос доступа: письмо каждому активному администратору, отключённому и коллегам — нет', async () => {
  const mailer = fakeMailer();
  const { s } = await setup(mailer);
  try {
    await s.addUser({ email: 'boss2@x.ru', name: 'Второй', password: 'пароль-второго', isAdmin: true });
    const off = await s.addUser({ email: 'off@x.ru', name: 'Выключен', password: 'пароль-выкл', isAdmin: true });
    s.db.setStatus(off.id, 'disabled');
    const cookie = await s.login('lena@x.ru', 'пароль-лены');

    const r = await s.fetch('/api/requests', post({ tool: 'dg-check' }, cookie));
    assert.equal(r.status, 201);
    await settle();
    assert.deepEqual(mailer.sent.map((m) => m.to).sort(), ['boss2@x.ru', 'boss@x.ru']);
    const title = s.catalog.tools.find((t) => t.key === 'dg-check').title;
    for (const mail of mailer.sent) {
      assert.equal(mail.subject, 'Запрос доступа в Лоции');
      assert.ok(mail.text.includes('Лена'), 'имя человека');
      assert.ok(mail.text.includes(title), 'название инструмента');
    }

    // Повторный запрос не создаёт нового — и письма не шлёт
    await s.fetch('/api/requests', post({ tool: 'dg-check' }, cookie));
    await settle();
    assert.equal(mailer.sent.length, 2);
  } finally { await s.close(); }
});

test('запрос доступа: сбой отправки не меняет ответ', async () => {
  const mailer = fakeMailer({ failWith: new Error('smtp недоступен') });
  const { s } = await setup(mailer);
  try {
    const cookie = await s.login('lena@x.ru', 'пароль-лены');
    await quietErrors(async (logged) => {
      const r = await s.fetch('/api/requests', post({ tool: 'dg-check' }, cookie));
      assert.equal(r.status, 201);
      assert.equal(s.db.listRequests().length, 1);
      await settle();
      assert.equal(logged.length, 1);
    });
  } finally { await s.close(); }
});

test('запрос доступа без почты работает как раньше', async () => {
  const { s } = await setup(null);
  try {
    const cookie = await s.login('lena@x.ru', 'пароль-лены');
    assert.equal((await s.fetch('/api/requests', post({ tool: 'dg-check' }, cookie))).status, 201);
  } finally { await s.close(); }
});

// --- отключение гасит ссылки ----------------------------------------------

test('отключение гасит выданные ссылки: после включения старая ссылка не оживает', async () => {
  const { s, adminCookie } = await setup(null);
  try {
    const created = await (await s.fetch('/api/admin/users', post({ email: 'new@x.ru', name: 'Новая' }, adminCookie))).json();
    const token = created.link.split('/').pop();
    assert.equal(s.db.peekToken(token, 'invite', Date.now()), created.user.id);

    assert.equal((await s.fetch(`/api/admin/users/${created.user.id}/disable`, post({}, adminCookie))).status, 200);
    assert.equal((await s.fetch(`/api/admin/users/${created.user.id}/enable`, post({}, adminCookie))).status, 200);
    assert.equal(s.db.peekToken(token, 'invite', Date.now()), null);
    const r = await s.fetch(`/api/invite/${token}`);
    assert.equal(r.status, 410);
  } finally { await s.close(); }
});
