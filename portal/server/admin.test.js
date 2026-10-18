import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, TEST_ORIGIN } from './test-helpers.js';

const json = (cookie, body) => ({
  method: 'POST',
  headers: { Cookie: cookie },
  body: JSON.stringify(body),
});
const put = (cookie, body) => ({ method: 'PUT', headers: { Cookie: cookie }, body: JSON.stringify(body) });
const get = (cookie) => ({ headers: { Cookie: cookie } });

/** Сервер с администратором и коллегой; возвращает cookie обоих. */
async function setup(opts = {}) {
  const s = await startTestServer(opts);
  const admin = await s.addUser({ email: 'boss@x.ru', name: 'Босс', password: 'пароль-босса', isAdmin: true });
  const lena = await s.addUser({ email: 'lena@x.ru', name: 'Лена', password: 'пароль-лены', tools: ['merge'] });
  const adminCookie = await s.login('boss@x.ru', 'пароль-босса');
  const lenaCookie = await s.login('lena@x.ru', 'пароль-лены');
  return { s, admin, lena, adminCookie, lenaCookie };
}

test('/api/admin/*: без входа — 401, коллеге — 403', async () => {
  const { s, lena, lenaCookie } = await setup();
  try {
    const paths = [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users'],
      ['PUT', `/api/admin/users/${lena.id}/tools`],
      ['POST', `/api/admin/users/${lena.id}/link`],
      ['POST', `/api/admin/users/${lena.id}/disable`],
      ['POST', `/api/admin/users/${lena.id}/enable`],
      ['GET', '/api/admin/requests'],
      ['POST', '/api/admin/requests/1/grant'],
      ['POST', '/api/admin/requests/1/reject'],
    ];
    for (const [method, path] of paths) {
      const body = method === 'GET' ? undefined : '{}';
      const anon = await s.fetch(path, { method, body });
      assert.equal(anon.status, 401, `${method} ${path} без входа`);
      const colleague = await s.fetch(path, { method, headers: { Cookie: lenaCookie }, body });
      assert.equal(colleague.status, 403, `${method} ${path} коллеге`);
    }
    // Коллега не смог ничего изменить
    assert.deepEqual(s.db.getTools(lena.id), ['merge']);
  } finally { await s.close(); }
});

test('GET /api/admin/users отдаёт всех с правами', async () => {
  const { s, admin, lena, adminCookie } = await setup();
  try {
    const r = await s.fetch('/api/admin/users', get(adminCookie));
    assert.equal(r.status, 200);
    const list = await r.json();
    assert.deepEqual(list.map((u) => u.id), [admin.id, lena.id]);
    assert.deepEqual(list[1].tools, ['merge']);
    assert.equal(JSON.stringify(list).includes('hash'), false);
  } finally { await s.close(); }
});

test('POST /api/admin/users: создаёт приглашённого, возвращает ссылку, почта нормализуется', async () => {
  const { s, adminCookie } = await setup();
  try {
    const r = await s.fetch('/api/admin/users', json(adminCookie, { email: ' Ivan@Mail.ru ', name: ' Иван ', tools: ['dg-check', 'merge'] }));
    assert.equal(r.status, 201);
    const { user, link } = await r.json();
    assert.equal(user.email, 'ivan@mail.ru');
    assert.equal(user.name, 'Иван');
    assert.equal(user.status, 'invited');
    assert.equal(user.isAdmin, false);
    assert.deepEqual(user.tools, ['dg-check', 'merge']);
    assert.match(link, new RegExp(`^${TEST_ORIGIN}/invite/[\\w-]{43}$`));
    // Ссылка рабочая
    const info = await s.fetch(`/api/invite/${link.split('/').pop()}`);
    assert.equal(info.status, 200);
    assert.deepEqual(s.db.getTools(user.id), ['dg-check', 'merge']);
  } finally { await s.close(); }
});

test('POST /api/admin/users: tools можно не указывать', async () => {
  const { s, adminCookie } = await setup();
  try {
    const r = await s.fetch('/api/admin/users', json(adminCookie, { email: 'n@x.ru', name: 'Н' }));
    assert.equal(r.status, 201);
    assert.deepEqual((await r.json()).user.tools, []);
  } finally { await s.close(); }
});

test('POST /api/admin/users: занятая почта (в любом регистре) — 409, а не падение', async () => {
  const { s, adminCookie } = await setup();
  try {
    for (const email of ['lena@x.ru', '  LENA@x.RU ']) {
      const r = await s.fetch('/api/admin/users', json(adminCookie, { email, name: 'Другая', tools: [] }));
      assert.equal(r.status, 409);
      assert.deepEqual(await r.json(), { error: 'Такой адрес уже есть' });
    }
    assert.equal(s.db.listUsers().length, 2);
  } finally { await s.close(); }
});

test('POST /api/admin/users: неизвестный ключ в tools — 400, человек не создаётся', async () => {
  const { s, adminCookie } = await setup();
  try {
    const r = await s.fetch('/api/admin/users', json(adminCookie, { email: 'n@x.ru', name: 'Н', tools: ['merge', 'нет-такого'] }));
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /нет-такого/);
    assert.equal(s.db.getUserByEmail('n@x.ru'), null);
  } finally { await s.close(); }
});

test('POST /api/admin/users: кривое тело — 400', async () => {
  const { s, adminCookie } = await setup();
  try {
    const bad = [
      { name: 'Н' },
      { email: 'n@x.ru' },
      { email: 'n@x.ru', name: '   ' },
      { email: 5, name: 'Н' },
      { email: 'n@x.ru', name: 7 },
      { email: 'без-собаки', name: 'Н' },
      { email: 'с пробелом@x.ru', name: 'Н' },
      { email: 'n@x.ru', name: 'Н', tools: 'merge' },
      { email: 'n@x.ru', name: 'Н', tools: [1] },
      { email: 'n@x.ru', name: 'Н', tools: [null] },
    ];
    for (const body of bad) {
      const r = await s.fetch('/api/admin/users', json(adminCookie, body));
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(s.db.listUsers().length, 2);
  } finally { await s.close(); }
});

test('PUT /api/admin/users/<id>/tools: заменяет права', async () => {
  const { s, lena, adminCookie, lenaCookie } = await setup();
  try {
    assert.equal((await s.fetch('/dg-check/index.html', get(lenaCookie))).status, 403);
    const r = await s.fetch(`/api/admin/users/${lena.id}/tools`, put(adminCookie, { tools: ['dg-check'] }));
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).user.tools, ['dg-check']);
    assert.deepEqual(s.db.getTools(lena.id), ['dg-check']);
    assert.equal((await s.fetch('/dg-check/index.html', get(lenaCookie))).status, 200);
    assert.equal((await s.fetch('/merge/index.html', get(lenaCookie))).status, 403);
  } finally { await s.close(); }
});

test('PUT tools: администратору — 400, неизвестный ключ — 400, кривое тело — 400, нет человека — 404', async () => {
  const { s, admin, lena, adminCookie } = await setup();
  try {
    let r = await s.fetch(`/api/admin/users/${admin.id}/tools`, put(adminCookie, { tools: ['merge'] }));
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'У администратора все инструменты' });
    assert.deepEqual(s.db.getTools(admin.id), []);

    r = await s.fetch(`/api/admin/users/${lena.id}/tools`, put(adminCookie, { tools: ['нет-такого'] }));
    assert.equal(r.status, 400);
    for (const body of [{}, { tools: 'merge' }, { tools: [2] }]) {
      r = await s.fetch(`/api/admin/users/${lena.id}/tools`, put(adminCookie, body));
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.deepEqual(s.db.getTools(lena.id), ['merge']); // ничего не испортилось

    r = await s.fetch('/api/admin/users/9999/tools', put(adminCookie, { tools: [] }));
    assert.equal(r.status, 404);
    r = await s.fetch('/api/admin/users/abc/tools', put(adminCookie, { tools: [] }));
    assert.equal(r.status, 404);
  } finally { await s.close(); }
});

test('POST link: приглашённому — приглашение, активному — сброс, старая ссылка гаснет', async () => {
  const { s, lena, adminCookie } = await setup();
  try {
    const invited = s.db.createUser({ email: 'new@x.ru', name: 'Новый' });
    let r = await s.fetch(`/api/admin/users/${invited.id}/link`, json(adminCookie, {}));
    assert.equal(r.status, 200);
    const first = (await r.json()).link;
    assert.match(first, /\/invite\/[\w-]{43}$/);
    r = await s.fetch(`/api/admin/users/${invited.id}/link`, json(adminCookie, {}));
    const second = (await r.json()).link;
    assert.notEqual(first, second);
    assert.equal((await s.fetch(`/api/invite/${first.split('/').pop()}`)).status, 410);
    assert.equal((await s.fetch(`/api/invite/${second.split('/').pop()}`)).status, 200);

    r = await s.fetch(`/api/admin/users/${lena.id}/link`, json(adminCookie, {}));
    assert.match((await r.json()).link, /\/reset\/[\w-]{43}$/);
  } finally { await s.close(); }
});

test('POST link: отключённому — 409, нет человека — 404', async () => {
  const { s, lena, adminCookie } = await setup();
  try {
    s.db.setStatus(lena.id, 'disabled');
    let r = await s.fetch(`/api/admin/users/${lena.id}/link`, json(adminCookie, {}));
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: 'Человек отключён — сначала включите доступ' });
    r = await s.fetch('/api/admin/users/9999/link', json(adminCookie, {}));
    assert.equal(r.status, 404);
  } finally { await s.close(); }
});

test('отключение гасит сессии, enable не воскрешает их, вход после enable работает', async () => {
  const { s, lena, adminCookie, lenaCookie } = await setup();
  try {
    assert.equal((await s.fetch('/api/me', get(lenaCookie))).status, 200);
    let r = await s.fetch(`/api/admin/users/${lena.id}/disable`, json(adminCookie, {}));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).user.status, 'disabled');
    assert.equal((await s.fetch('/api/me', get(lenaCookie))).status, 401);

    r = await s.fetch(`/api/admin/users/${lena.id}/enable`, json(adminCookie, {}));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).user.status, 'active');
    // Старая cookie после включения не оживает
    assert.equal((await s.fetch('/api/me', get(lenaCookie))).status, 401);
    // А новый вход — работает
    await s.login('lena@x.ru', 'пароль-лены');
  } finally { await s.close(); }
});

test('enable человеку без пароля возвращает invited', async () => {
  const { s, adminCookie } = await setup();
  try {
    const invited = s.db.createUser({ email: 'new@x.ru', name: 'Новый' });
    await s.fetch(`/api/admin/users/${invited.id}/disable`, json(adminCookie, {}));
    assert.equal(s.db.getUserById(invited.id).status, 'disabled');
    const r = await s.fetch(`/api/admin/users/${invited.id}/enable`, json(adminCookie, {}));
    assert.equal((await r.json()).user.status, 'invited');
  } finally { await s.close(); }
});

test('disable себя — 409; disable/enable несуществующего — 404', async () => {
  const { s, admin, adminCookie } = await setup();
  try {
    let r = await s.fetch(`/api/admin/users/${admin.id}/disable`, json(adminCookie, {}));
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), { error: 'Нельзя отключить самого себя' });
    assert.equal(s.db.getUserById(admin.id).status, 'active');
    for (const action of ['disable', 'enable']) {
      r = await s.fetch(`/api/admin/users/9999/${action}`, json(adminCookie, {}));
      assert.equal(r.status, 404);
    }
  } finally { await s.close(); }
});

test('другого администратора отключить можно', async () => {
  const { s, adminCookie } = await setup();
  try {
    const second = await s.addUser({ email: 'boss2@x.ru', name: 'Босс 2', password: 'пароль-босса-2', isAdmin: true });
    const r = await s.fetch(`/api/admin/users/${second.id}/disable`, json(adminCookie, {}));
    assert.equal(r.status, 200);
  } finally { await s.close(); }
});

test('запрос доступа: коллега просит, повтор не плодит, уже доступное — already, неизвестное — 400', async () => {
  const { s, lena, lenaCookie, adminCookie } = await setup();
  try {
    let r = await s.fetch('/api/requests', json(lenaCookie, { tool: 'dg-check' }));
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { created: true });
    r = await s.fetch('/api/requests', json(lenaCookie, { tool: 'dg-check' }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { created: false });
    r = await s.fetch('/api/requests', json(lenaCookie, { tool: 'merge' }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { already: true });
    for (const body of [{ tool: 'нет-такого' }, {}, { tool: 5 }, { tool: null }]) {
      r = await s.fetch('/api/requests', json(lenaCookie, body));
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    r = await s.fetch('/api/requests', { method: 'POST', body: JSON.stringify({ tool: 'dg-check' }) });
    assert.equal(r.status, 401);

    const list = await (await s.fetch('/api/admin/requests', get(adminCookie))).json();
    assert.equal(list.length, 1);
    assert.equal(list[0].userId, lena.id);
    assert.equal(list[0].tool, 'dg-check');
    assert.equal(list[0].toolTitle, s.catalog.tools.find((t) => t.key === 'dg-check').title);
    assert.equal(list[0].userName, 'Лена');
  } finally { await s.close(); }
});

test('grant выдаёт право, и инструмент открывается; счётчик openRequests уменьшается', async () => {
  const { s, lena, lenaCookie, adminCookie } = await setup();
  try {
    assert.equal((await s.fetch('/dg-check/index.html', get(lenaCookie))).status, 403);
    assert.equal((await s.fetch('/api/requests', json(lenaCookie, { tool: 'dg-check' }))).status, 201);
    assert.equal((await (await s.fetch('/api/me', get(adminCookie))).json()).openRequests, 1);

    const [req] = await (await s.fetch('/api/admin/requests', get(adminCookie))).json();
    const r = await s.fetch(`/api/admin/requests/${req.id}/grant`, json(adminCookie, {}));
    assert.equal(r.status, 200);
    assert.deepEqual(s.db.getTools(lena.id), ['dg-check', 'merge']);
    assert.equal((await s.fetch('/dg-check/index.html', get(lenaCookie))).status, 200);
    assert.equal((await (await s.fetch('/api/me', get(adminCookie))).json()).openRequests, 0);
    assert.deepEqual(await (await s.fetch('/api/admin/requests', get(adminCookie))).json(), []);

    // Повторно закрыть уже закрытый нельзя
    assert.equal((await s.fetch(`/api/admin/requests/${req.id}/grant`, json(adminCookie, {}))).status, 404);
    assert.equal((await s.fetch(`/api/admin/requests/${req.id}/reject`, json(adminCookie, {}))).status, 404);
    // Просить то, что уже выдано, не нужно
    assert.deepEqual(await (await s.fetch('/api/requests', json(lenaCookie, { tool: 'dg-check' }))).json(), { already: true });
  } finally { await s.close(); }
});

test('reject не выдаёт право и снимает запрос со счётчика; потом можно попросить снова', async () => {
  const { s, lena, lenaCookie, adminCookie } = await setup();
  try {
    await s.fetch('/api/requests', json(lenaCookie, { tool: 'dg-check' }));
    const [req] = await (await s.fetch('/api/admin/requests', get(adminCookie))).json();
    const r = await s.fetch(`/api/admin/requests/${req.id}/reject`, json(adminCookie, {}));
    assert.equal(r.status, 200);
    assert.deepEqual(s.db.getTools(lena.id), ['merge']);
    assert.equal((await s.fetch('/dg-check/index.html', get(lenaCookie))).status, 403);
    assert.equal((await (await s.fetch('/api/me', get(adminCookie))).json()).openRequests, 0);
    assert.equal((await s.fetch('/api/requests', json(lenaCookie, { tool: 'dg-check' }))).status, 201);
  } finally { await s.close(); }
});

test('grant/reject: нет такого запроса — 404', async () => {
  const { s, adminCookie } = await setup();
  try {
    for (const action of ['grant', 'reject']) {
      for (const id of ['9999', 'abc']) {
        const r = await s.fetch(`/api/admin/requests/${id}/${action}`, json(adminCookie, {}));
        assert.equal(r.status, 404, `${action} ${id}`);
      }
    }
  } finally { await s.close(); }
});

test('запрос «не может войти»: grant отвечает новой ссылкой входа, права не меняются', async () => {
  const { s, lena, adminCookie } = await setup();
  try {
    s.db.addRequest({ userId: lena.id, tool: null, at: Date.now() });
    const [req] = await (await s.fetch('/api/admin/requests', get(adminCookie))).json();
    assert.equal(req.tool, null);
    assert.equal(req.toolTitle, null);
    const r = await s.fetch(`/api/admin/requests/${req.id}/grant`, json(adminCookie, {}));
    assert.equal(r.status, 200);
    const { link } = await r.json();
    assert.match(link, /\/reset\/[\w-]{43}$/);
    assert.equal((await s.fetch(`/api/reset/${link.split('/').pop()}`)).status, 200);
    assert.deepEqual(s.db.getTools(lena.id), ['merge']);
    assert.equal(s.db.countOpenRequests(), 0);
  } finally { await s.close(); }
});

test('запрос «не может войти» от отключённого: grant — 409, запрос остаётся открытым', async () => {
  const { s, lena, adminCookie } = await setup();
  try {
    s.db.addRequest({ userId: lena.id, tool: null, at: Date.now() });
    s.db.setStatus(lena.id, 'disabled');
    const [req] = await (await s.fetch('/api/admin/requests', get(adminCookie))).json();
    const r = await s.fetch(`/api/admin/requests/${req.id}/grant`, json(adminCookie, {}));
    assert.equal(r.status, 409);
    assert.equal(s.db.countOpenRequests(), 1);
  } finally { await s.close(); }
});
