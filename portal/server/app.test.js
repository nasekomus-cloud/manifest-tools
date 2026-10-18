import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, REPO_ROOT, TEST_ORIGIN } from './test-helpers.js';
import { createLimiter } from './ratelimit.js';

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

let s;
let cookie; // сессия коллеги с правом только на «merge»
let adminCookie;

before(async () => {
  s = await startTestServer();
  await s.addUser({ email: 'ira@x.ru', name: 'Ирина', password: 'пароль-123', tools: ['merge'] });
  await s.addUser({ email: 'boss@x.ru', name: 'Главный', password: 'админ-пароль', isAdmin: true });
  cookie = await s.login('ira@x.ru', 'пароль-123');
  adminCookie = await s.login('boss@x.ru', 'админ-пароль');
});
after(() => s.close());

// Запрос с «сырым» путём: fetch нормализует «..» ещё до отправки, а нам нужно именно то, что пришло бы по сети
function raw(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const { port } = new URL(s.url);
    // объект параметров, а не URL-строка: так путь уходит в сеть как есть, без нормализации
    const req = http.request({ host: '127.0.0.1', port, path, headers: { Origin: TEST_ORIGIN, ...headers } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('без входа инструмент уводит на вход', async () => {
  const r = await s.fetch('/merge/index.html', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?next=%2Fmerge%2Findex.html');
});

test('вход: cookie с нужными атрибутами', async () => {
  const r = await s.fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: ' IRA@x.ru', password: 'пароль-123' }) });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const c = r.headers.get('set-cookie');
  for (const part of ['lt_session=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=34560000', 'Path=/']) assert.ok(c.includes(part), part);
  assert.ok(s.db.getUserByEmail('ira@x.ru').lastLoginAt, 'touchLogin вызван');
});

test('вход: неверный пароль и неизвестная почта — одинаковый 401', async () => {
  for (const body of [
    { email: 'ira@x.ru', password: 'не тот' },
    { email: 'nobody@x.ru', password: 'пароль-123' },
  ]) {
    const r = await s.fetch('/api/login', { method: 'POST', body: JSON.stringify(body) });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'Неверная почта или пароль' });
    assert.equal(r.headers.get('set-cookie'), null);
  }
});

test('вход: не строки в теле и кривой JSON — 400, а не падение', async () => {
  for (const body of ['{"email":1,"password":2}', '{"email":["a"],"password":{"x":1}}', '{}', 'не json', '[]', 'null']) {
    const r = await s.fetch('/api/login', { method: 'POST', body });
    assert.equal(r.status, 400, body);
  }
  const big = await s.fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: 'a', password: 'x'.repeat(70 * 1024) }) });
  assert.equal(big.status, 413);
});

test('вход: пароль без пароля у приглашённого и отключённый не проходят', async () => {
  s.db.createUser({ email: 'invited@x.ru', name: 'Без пароля' });
  const r = await s.fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: 'invited@x.ru', password: '' }) });
  assert.equal(r.status, 401);
});

test('право есть — файл; права нет — 403 «Нет доступа»', async () => {
  const ok = await s.fetch('/merge/index.html', { headers: { cookie } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.equal(await ok.text(), read('merge/index.html'));

  const no = await s.fetch('/dg-check/index.html', { headers: { cookie } });
  assert.equal(no.status, 403);
  assert.match(no.headers.get('content-type'), /^text\/html/);
  const html = await no.text();
  assert.ok(html.includes('Нет доступа'));
  assert.ok(html.includes('Запросить доступ'));
  const title = s.catalog.tools.find((t) => t.key === 'dg-check').title;
  assert.ok(html.includes(title), 'название инструмента');
  assert.ok(html.includes(`Инструмент «${title}» вам пока не выдан`));
  assert.ok(html.includes('data-tool="dg-check"'));
  assert.ok(html.includes('href="/">На главную'));
  // тот же каркас, что у инструментов: полоса сверху и меню рисует shell.js
  assert.ok(html.includes('<aside class="app__side" id="app-side"></aside>'));
  assert.ok(html.indexOf('src="/tools.js"') < html.indexOf('src="/assets/shell.js"'));
});

test('каталог инструмента: каталог без слэша и без файла, query, JS и вложенные страницы', async () => {
  const dir = await s.fetch('/merge', { headers: { cookie }, redirect: 'manual' });
  assert.equal(dir.status, 302);
  assert.equal(dir.headers.get('location'), '/merge/');

  const idx = await s.fetch('/merge/', { headers: { cookie } });
  assert.equal(idx.status, 200);
  assert.equal(await idx.text(), read('merge/index.html'));

  const js = await s.fetch('/merge/app.js?v=202610181200', { headers: { cookie } });
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /^text\/javascript; charset=utf-8/);
  assert.equal(await js.text(), read('merge/app.js'));

  const missing = await s.fetch('/merge/nope.js', { headers: { cookie } });
  assert.equal(missing.status, 404);
});

test('/lib/* только со входом', async () => {
  const anon = await s.fetch('/lib/manifest-format.js');
  assert.equal(anon.status, 401);
  const r = await s.fetch('/lib/manifest-format.js', { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), read('lib/manifest-format.js'));
});

test('/tools.js только с разрешёнными', async () => {
  assert.equal((await s.fetch('/tools.js')).status, 401);

  const mine = await (await s.fetch('/tools.js', { headers: { cookie } })).text();
  const sandbox = { window: {} };
  new Function('window', mine)(sandbox.window);
  assert.equal(sandbox.window.TOOLS.length, 1);
  assert.equal(sandbox.window.TOOLS[0].href, 'merge/index.html');

  const all = await (await s.fetch('/tools.js', { headers: { cookie: adminCookie } })).text();
  const w2 = {};
  new Function('window', all)(w2);
  assert.equal(w2.TOOLS.length, s.catalog.tools.length);
});

test('/assets/style.css и /assets/shell.js — склейка старого файла и добавки', async () => {
  for (const [path, base, addon, type] of [
    ['/assets/style.css', 'assets/style.css', 'portal/web/theme.css', /^text\/css/],
    ['/assets/shell.js', 'assets/shell.js', 'portal/web/shell-addon.js', /^text\/javascript/],
  ]) {
    assert.equal((await s.fetch(path)).status, 401, path);
    const r = await s.fetch(`${path}?v=1`, { headers: { cookie } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), type);
    const body = await r.text();
    assert.ok(body.startsWith(read(base)), `${path} начинается со старого файла`);
    assert.ok(body.endsWith(read(addon)), `${path} заканчивается добавкой`);
    assert.equal(body, `${read(base)}\n${read(addon)}`);
  }
});

test('публичное без входа: /login, /portal/*, /assets/fonts.css', async () => {
  const login = await s.fetch('/login');
  assert.equal(login.status, 200);
  assert.match(login.headers.get('content-type'), /^text\/html/);
  assert.equal(await login.text(), read('portal/web/login.html'));

  const theme = await s.fetch('/portal/theme.css');
  assert.equal(theme.status, 200);
  assert.match(theme.headers.get('content-type'), /^text\/css/);

  const fonts = await s.fetch('/assets/fonts.css');
  assert.equal(fonts.status, 200);
  assert.equal(await fonts.text(), read('assets/fonts.css'));

  // другие файлы assets/ и шрифты отдельными файлами — не отдаются
  assert.equal((await s.fetch('/assets/fonts/', { headers: { cookie } })).status, 404);
});

test('/portal/*: отдаются только не-HTML файлы, страницы портала по этому адресу — 404 всем (R13)', async () => {
  for (const name of ['admin-users.html', 'admin-requests.html', 'index.html', 'journal.html', 'account.html', 'login.html', 'invite.html', 'link-gone.html']) {
    assert.equal((await s.fetch(`/portal/${name}`)).status, 404, `без входа /portal/${name}`);
    assert.equal((await s.fetch(`/portal/${name}`, { headers: { cookie } })).status, 404, `со входом /portal/${name}`);
  }
  assert.equal((await s.fetch('/portal/HOME.HTML')).status, 404);
  assert.equal((await s.fetch('/portal/')).status, 404);
  // картинки, стили и скрипты остаются
  assert.equal((await s.fetch('/portal/portal.css')).status, 200);
  assert.equal((await s.fetch('/portal/portal.js')).status, 200);
  // а сами страницы — по своим адресам
  assert.equal((await s.fetch('/login')).status, 200);
});

test('главная и страницы портала: без входа — на вход, остальное — 404, пока страниц нет', async () => {
  const home = await s.fetch('/', { redirect: 'manual' });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), '/login');
  const idx = await s.fetch('/index.html', { redirect: 'manual' });
  assert.equal(idx.headers.get('location'), '/login');

  for (const p of ['/journal', '/account', '/admin/users', '/admin/requests', '/help/merge', '/help/samples/a.xlsx']) {
    const r = await s.fetch(p, { redirect: 'manual' });
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.get('location'), `/login?next=${encodeURIComponent(p)}`, p);
  }
});

test('закрытые файлы репозитория не отдаются', async () => {
  for (const p of ['/CLAUDE.md', '/package.json', '/package-lock.json', '/portal/server/db.js', '/merge/core.test.js',
    '/.git/config', '/merge/../CLAUDE.md', '/%2e%2e/%2e%2e/etc/passwd', '/node_modules/exceljs/package.json']) {
    for (const headers of [{ cookie }, { cookie: adminCookie }, {}]) {
      const r = await raw(p, headers);
      assert.equal(r.status, 404, `${p} ${Object.keys(headers).length ? 'со входом' : 'без входа'}`);
    }
  }
  // и обычным fetch (он сам нормализует путь)
  for (const p of ['/CLAUDE.md', '/package.json', '/portal/server/db.js', '/merge/core.test.js', '/lib/loading-order.test.js']) {
    assert.equal((await s.fetch(p, { headers: { cookie: adminCookie } })).status, 404, p);
  }
});

test('обход пути: кодированные точки, обратные слэши, NUL, двойные слэши, точечные сегменты', async () => {
  const bad = [
    '/merge/%2e%2e/CLAUDE.md', '/merge/%2E%2E/%2E%2E/etc/passwd', '/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
    '/merge/..%2fCLAUDE.md', '/merge/%2e%2e%2fCLAUDE.md', '/merge/..%5cCLAUDE.md', '/merge%5c..%5cCLAUDE.md',
    '/merge/..\\CLAUDE.md', '/merge/index.html%00.png', '/merge/%00', '/merge//index.html', '//merge/index.html',
    '/merge/./index.html', '/merge/.hidden', '/.git/HEAD', '/%2egit/config', '/portal/.env', '/merge/%2e', '/merge/%',
    '/merge/%zz', '/merge/index.html%0a', '/lib/%2e%2e/CLAUDE.md', '/portal/%2e%2e/server/db.js', '/portal/../server/db.js',
    '/portal/%2e%2e%2fserver/db.js', '/portal/server/db.js', '/portal/web/../server/db.js',
    '/merge/index.html/../../CLAUDE.md', '/assets/%2e%2e/CLAUDE.md', '/login/..%2f..%2fCLAUDE.md',
    '/%252e%252e/CLAUDE.md', '/merge/%252e%252e/CLAUDE.md',
  ];
  for (const p of bad) {
    const r = await raw(p, { cookie: adminCookie });
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes('scrypt'), p);
  }
});

test('POST без правильного Origin — 403', async () => {
  const body = JSON.stringify({ email: 'ira@x.ru', password: 'пароль-123' });
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Origin: `${TEST_ORIGIN}.evil.example` }, { Origin: `${TEST_ORIGIN}/` }]) {
    const r = await s.fetch('/api/login', { method: 'POST', body, headers });
    assert.equal(r.status, 403, headers.Origin);
    assert.equal(r.headers.get('set-cookie'), null);
  }
  // совсем без Origin: собственный http-запрос без заголовка
  const noOrigin = await new Promise((resolve, reject) => {
    const req = http.request(`${s.url}/api/logout`, { method: 'POST' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(noOrigin, 403);
  // выход с чужого Origin сессию не трогает
  const me = await s.fetch('/api/me', { headers: { cookie } });
  assert.equal(me.status, 200);
  const evil = await s.fetch('/api/logout', { method: 'POST', headers: { cookie, Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal((await s.fetch('/api/me', { headers: { cookie } })).status, 200);
  // GET Origin не требует
  assert.equal((await s.fetch('/login', { headers: { Origin: 'https://evil.example' } })).status, 200);
});

test('HSTS: при https-адресе портала на каждом ответе, при http (разработка) — нет', async () => {
  const https = await s.fetch('/login');
  assert.equal(https.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await s.fetch('/nope')).headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await s.fetch('/api/me')).headers.get('strict-transport-security'), 'max-age=31536000');

  const { createApp } = await import('./app.js');
  const { openDb } = await import('./db.js');
  const http = await import('node:http');
  const db = openDb(':memory:');
  const server = http.createServer(createApp({ db, siteRoot: REPO_ROOT, publicOrigin: 'http://localhost:8010', cookieSecure: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/login`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('strict-transport-security'), null);
  } finally {
    await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    db.close();
  }
});

test('10 неудачных попыток — 429, через 15 минут снова можно', async () => {
  let t = 1_700_000_000_000;
  const srv = await startTestServer({ now: () => t });
  try {
    await srv.addUser({ email: 'lim@x.ru', name: 'Лимит', password: 'правильный-пароль' });
    await srv.addUser({ email: 'other@x.ru', name: 'Другой', password: 'другой-пароль' });
    const attempt = (email, password, headers = {}) =>
      srv.fetch('/api/login', { method: 'POST', body: JSON.stringify({ email, password }), headers });

    for (let i = 1; i <= 10; i++) assert.equal((await attempt('lim@x.ru', 'неверно')).status, 401, `попытка ${i}`);
    const blocked = await attempt('lim@x.ru', 'неверно');
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: 'Слишком много попыток. Попробуйте через 15 минут.' });
    // даже верный пароль на заблокированной почте не пускает
    assert.equal((await attempt('LIM@x.ru ', 'правильный-пароль')).status, 429);
    // другая почта с другого IP не затронута
    assert.equal((await attempt('other@x.ru', 'другой-пароль', { 'X-Real-IP': '10.0.0.9' })).status, 200);

    t += 15 * 60 * 1000 + 1;
    assert.equal((await attempt('lim@x.ru', 'правильный-пароль')).status, 200);
  } finally {
    await srv.close();
  }
});

test('удачный вход сбрасывает счётчик почты', async () => {
  const srv = await startTestServer();
  try {
    await srv.addUser({ email: 'reset@x.ru', name: 'Сброс', password: 'правильный-пароль' });
    const attempt = (password, ip) => srv.fetch('/api/login', {
      method: 'POST', body: JSON.stringify({ email: 'reset@x.ru', password }), headers: { 'X-Real-IP': ip },
    });
    for (let i = 0; i < 9; i++) assert.equal((await attempt('нет', `10.1.0.${i}`)).status, 401);
    assert.equal((await attempt('правильный-пароль', '10.1.1.1')).status, 200);
    for (let i = 0; i < 9; i++) assert.equal((await attempt('нет', `10.1.2.${i}`)).status, 401);
    assert.equal((await attempt('правильный-пароль', '10.1.3.1')).status, 200);
  } finally {
    await srv.close();
  }
});

test('счётчик по IP: 30 неудач с одного адреса блокируют любую почту, 31-я попытка — 429', async () => {
  const srv = await startTestServer();
  try {
    await srv.addUser({ email: 'ip@x.ru', name: 'Ай-пи', password: 'правильный-пароль' });
    const attempt = (email, password, ip) => srv.fetch('/api/login', {
      method: 'POST', body: JSON.stringify({ email, password }), headers: { 'X-Real-IP': ip },
    });
    for (let i = 0; i < 30; i++) assert.equal((await attempt(`guess${i}@x.ru`, 'нет', '203.0.113.7')).status, 401, `попытка ${i + 1}`);
    assert.equal((await attempt('ip@x.ru', 'правильный-пароль', '203.0.113.7')).status, 429);
    assert.equal((await attempt('ip@x.ru', 'правильный-пароль', '203.0.113.8')).status, 200);
  } finally {
    await srv.close();
  }
});

test('счётчик по IP шире счётчика по почте: 10 неудач с адреса почту не запирают, а 10 на одну почту — да', async () => {
  const srv = await startTestServer();
  try {
    await srv.addUser({ email: 'office@x.ru', name: 'Офис', password: 'правильный-пароль' });
    const attempt = (email, password, ip) => srv.fetch('/api/login', {
      method: 'POST', body: JSON.stringify({ email, password }), headers: { 'X-Real-IP': ip },
    });
    for (let i = 0; i < 10; i++) assert.equal((await attempt(`typo${i}@x.ru`, 'нет', '198.51.100.1')).status, 401);
    assert.equal((await attempt('office@x.ru', 'правильный-пароль', '198.51.100.1')).status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await attempt('office@x.ru', 'нет', `198.51.100.${10 + i}`)).status, 401);
    assert.equal((await attempt('office@x.ru', 'правильный-пароль', '198.51.100.99')).status, 429);
  } finally {
    await srv.close();
  }
});

test('createLimiter: окно скользит, reset обнуляет', () => {
  let t = 0;
  const lim = createLimiter({ max: 3, windowMs: 1000, now: () => t });
  lim.hit('k'); lim.hit('k');
  assert.equal(lim.blocked('k'), false);
  lim.hit('k');
  assert.equal(lim.blocked('k'), true);
  assert.equal(lim.blocked('other'), false);
  t = 1001;
  assert.equal(lim.blocked('k'), false);
  lim.hit('k'); lim.hit('k'); lim.hit('k');
  assert.equal(lim.blocked('k'), true);
  lim.reset('k');
  assert.equal(lim.blocked('k'), false);
});

test('отключённый человек выпадает', async () => {
  const srv = await startTestServer();
  try {
    const u = await srv.addUser({ email: 'gone@x.ru', name: 'Уходящий', password: 'пароль-123', tools: ['merge'] });
    const c = await srv.login('gone@x.ru', 'пароль-123');
    assert.equal((await srv.fetch('/api/me', { headers: { cookie: c } })).status, 200);
    assert.equal((await srv.fetch('/merge/index.html', { headers: { cookie: c } })).status, 200);

    srv.db.setStatus(u.id, 'disabled');
    assert.equal((await srv.fetch('/api/me', { headers: { cookie: c } })).status, 401);
    const page = await srv.fetch('/merge/index.html', { headers: { cookie: c }, redirect: 'manual' });
    assert.equal(page.status, 302);
    // и войти заново нельзя
    const r = await srv.fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: 'gone@x.ru', password: 'пароль-123' }) });
    assert.equal(r.status, 401);
  } finally {
    await srv.close();
  }
});

test('после перезапуска сервера человек остаётся внутри', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-test-'));
  const dbPath = join(dir, 'portal.db');
  try {
    const first = await startTestServer({ dbPath });
    await first.addUser({ email: 'stay@x.ru', name: 'Остаюсь', password: 'пароль-123', tools: ['merge'] });
    const c = await first.login('stay@x.ru', 'пароль-123');
    assert.equal((await first.fetch('/api/me', { headers: { cookie: c } })).status, 200);
    await first.close();

    const second = await startTestServer({ dbPath });
    try {
      const me = await second.fetch('/api/me', { headers: { cookie: c } });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).user.email, 'stay@x.ru');
    } finally {
      await second.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Cache-Control: no-store на любом ответе', async () => {
  const cases = [
    ['/login', {}], ['/login', { method: 'HEAD' }], ['/portal/theme.css', {}], ['/assets/fonts.css', {}],
    ['/', { redirect: 'manual' }], ['/merge/index.html', { redirect: 'manual' }], ['/merge', { headers: { cookie }, redirect: 'manual' }],
    ['/merge/index.html', { headers: { cookie } }], ['/dg-check/index.html', { headers: { cookie } }],
    ['/tools.js', {}], ['/tools.js', { headers: { cookie } }], ['/assets/style.css', { headers: { cookie } }],
    ['/CLAUDE.md', { headers: { cookie } }], ['/nope', {}], ['/api/me', {}], ['/api/me', { headers: { cookie } }],
    ['/api/nope', {}], ['/api/login', { method: 'POST', body: 'не json' }], ['/api/login', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } }],
    ['/api/logout', { method: 'POST' }], ['/login', { method: 'DELETE' }], ['/admin/users', { headers: { cookie } }],
  ];
  for (const [path, init] of cases) {
    const r = await s.fetch(path, init);
    assert.equal(r.headers.get('cache-control'), 'no-store', `${init.method ?? 'GET'} ${path} → ${r.status}`);
    await r.arrayBuffer();
  }
  const rawNotFound = await raw('/%2e%2e/etc/passwd');
  assert.equal(rawNotFound.headers['cache-control'], 'no-store');
  const rawCr = await raw('/', {});
  assert.equal(rawCr.headers['cache-control'], 'no-store');
});

test('/api/me: пользователь и инструменты с признаком allowed', async () => {
  assert.equal((await s.fetch('/api/me')).status, 401);
  const me = await (await s.fetch('/api/me', { headers: { cookie } })).json();
  assert.deepEqual(me.user, { id: me.user.id, email: 'ira@x.ru', name: 'Ирина', isAdmin: false });
  assert.equal(me.tools.length, s.catalog.tools.length);
  assert.ok(me.tools.every((t) => typeof t.key === 'string' && typeof t.allowed === 'boolean' && t.href && t.title));
  assert.deepEqual([...new Set(me.tools.filter((t) => t.allowed).map((t) => t.key))], ['merge']);
  assert.equal(me.openRequests, 0);

  const admin = await (await s.fetch('/api/me', { headers: { cookie: adminCookie } })).json();
  assert.equal(admin.user.isAdmin, true);
  assert.ok(admin.tools.every((t) => t.allowed));
  assert.equal(admin.openRequests, 0);

  const someone = s.db.getUserByEmail('ira@x.ru');
  s.db.addRequest({ userId: someone.id, tool: 'dg-check', at: 1 });
  assert.equal((await (await s.fetch('/api/me', { headers: { cookie: adminCookie } })).json()).openRequests, 1);
  assert.equal((await (await s.fetch('/api/me', { headers: { cookie } })).json()).openRequests, 0);
});

test('запрос с сессией перевыпускает cookie с тем же токеном', async () => {
  const token = cookie.split('=')[1];
  for (const path of ['/api/me', '/merge/index.html', '/login']) {
    const r = await s.fetch(path, { headers: { cookie } });
    const c = r.headers.get('set-cookie');
    assert.ok(c, path);
    assert.ok(c.startsWith(`lt_session=${token};`), path);
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=34560000', 'Path=/']) assert.ok(c.includes(part), `${path} ${part}`);
    await r.arrayBuffer();
  }
  // без сессии или с чужим токеном cookie не выдаётся
  assert.equal((await s.fetch('/login')).headers.get('set-cookie'), null);
  assert.equal((await s.fetch('/login', { headers: { cookie: 'lt_session=forged-token' } })).headers.get('set-cookie'), null);
});

test('выход: сессия удалена, cookie с Max-Age=0', async () => {
  const c = await s.login('ira@x.ru', 'пароль-123');
  const out = await s.fetch('/api/logout', { method: 'POST', headers: { cookie: c } });
  assert.equal(out.status, 200);
  const setCookie = out.headers.get('set-cookie');
  assert.ok(setCookie.includes('Max-Age=0'));
  assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('Path=/'));
  assert.equal((await s.fetch('/api/me', { headers: { cookie: c } })).status, 401);
  // повторный выход без сессии — тоже спокойно
  assert.equal((await s.fetch('/api/logout', { method: 'POST' })).status, 200);
});

test('вход: без COOKIE_SECURE=0 нет Secure только когда сервер так запущен', async () => {
  const srv = await startTestServer({ cookieSecure: false });
  try {
    await srv.addUser({ email: 'dev@x.ru', name: 'Разработчик', password: 'пароль-123' });
    const r = await srv.fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: 'dev@x.ru', password: 'пароль-123' }) });
    const c = r.headers.get('set-cookie');
    assert.ok(!c.includes('Secure'));
    assert.ok(c.includes('HttpOnly') && c.includes('SameSite=Lax'));
  } finally {
    await srv.close();
  }
});

test('HEAD и неподходящие методы', async () => {
  const head = await s.fetch('/merge/index.html', { method: 'HEAD', headers: { cookie } });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(read('merge/index.html')));
  assert.equal(await head.text(), '');
  assert.equal((await s.fetch('/merge/index.html', { method: 'POST', headers: { cookie } })).status, 405);
  assert.equal((await s.fetch('/api/me', { method: 'POST', headers: { cookie } })).status, 405);
});

test('403-страница экранирует название инструмента', async () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-site-'));
  try {
    mkdirSync(join(root, 'evil'));
    writeFileSync(join(root, 'tools.js'), `window.TOOLS = [{ title: '<img src=x onerror=alert(1)> "&', href: 'evil/index.html', category: 'export' }];`);
    const srv = await startTestServer({ siteRoot: root });
    try {
      await srv.addUser({ email: 'u@x.ru', name: 'Обычный', password: 'пароль-123' });
      const c = await srv.login('u@x.ru', 'пароль-123');
      const html = await (await srv.fetch('/evil/index.html', { headers: { cookie: c } })).text();
      assert.ok(!html.includes('<img'), 'разметка из названия не проходит');
      assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt; &quot;&amp;'));
    } finally {
      await srv.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('страницы портала и администратора (на временном корне сайта)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'portal-site-'));
  try {
    for (const dir of ['assets', 'merge', 'portal/web']) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(join(REPO_ROOT, 'tools.js'), join(root, 'tools.js'));
    writeFileSync(join(root, 'assets/style.css'), 'body{}');
    writeFileSync(join(root, 'merge/index.html'), '<p>merge</p>');
    for (const f of ['index', 'journal', 'account', 'admin-users', 'admin-requests']) {
      writeFileSync(join(root, `portal/web/${f}.html`), `<p>страница ${f}</p>`);
    }
    const srv = await startTestServer({ siteRoot: root });
    try {
      await srv.addUser({ email: 'a@x.ru', name: 'Админ', password: 'пароль-123', isAdmin: true });
      await srv.addUser({ email: 'u@x.ru', name: 'Обычный', password: 'пароль-123' });
      const admin = await srv.login('a@x.ru', 'пароль-123');
      const user = await srv.login('u@x.ru', 'пароль-123');
      const get = async (p, c) => {
        const r = await srv.fetch(p, { headers: c ? { cookie: c } : {}, redirect: 'manual' });
        return { status: r.status, text: await r.text(), location: r.headers.get('location') };
      };
      for (const [path, name] of [['/', 'index'], ['/index.html', 'index'], ['/journal', 'journal'], ['/account', 'account']]) {
        assert.equal((await get(path, user)).text, `<p>страница ${name}</p>`, path);
        assert.equal((await get(path)).status, 302, path);
      }
      assert.equal((await get('/admin/users')).location, '/login?next=%2Fadmin%2Fusers');
      for (const [path, name] of [['/admin/users', 'admin-users'], ['/admin/requests', 'admin-requests']]) {
        const forUser = await get(path, user);
        assert.equal(forUser.status, 403, path);
        assert.ok(forUser.text.includes('Нет доступа'));
        assert.ok(!forUser.text.includes('страница'), 'содержимое админ-страницы обычному не отдаётся');
        const forAdmin = await get(path, admin);
        assert.equal(forAdmin.status, 200);
        assert.equal(forAdmin.text, `<p>страница ${name}</p>`);
      }
      // у обычного без права на инструмент — 403, у администратора — файл
      assert.equal((await get('/merge/index.html', user)).status, 403);
      assert.equal((await get('/merge/index.html', admin)).text, '<p>merge</p>');
    } finally {
      await srv.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('скрипты соседнего инструмента, подключённые страницей, доступны владельцу этой страницы', async () => {
  await s.addUser({ email: 'gti@x.ru', name: 'Импорт', password: 'пароль-123', tools: ['grand-total-import'] });
  const c = await s.login('gti@x.ru', 'пароль-123');
  const get = (p) => s.fetch(p, { headers: { cookie: c } });

  assert.equal((await get('/grand-total-import/index.html')).status, 200);
  const app = await get('/grand-total/app.js?v=1');
  assert.equal(app.status, 200);
  assert.equal(await app.text(), read('grand-total/app.js'));
  assert.equal((await get('/grand-total/core.js')).status, 200);
  // а страницы самого grand-total — только с его правом
  for (const p of ['/grand-total/index.html', '/grand-total/', '/grand-total', '/grand-total/index.HTML']) {
    assert.equal((await get(p)).status, 403, p);
  }
  // каталоги, на которые зависимости нет
  assert.equal((await get('/merge/app.js')).status, 403);
  assert.equal((await get('/source-audit/app.js')).status, 403);
  // у владельца только merge grand-total/app.js закрыт
  assert.equal((await s.fetch('/grand-total/app.js', { headers: { cookie } })).status, 403);
});
