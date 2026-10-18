# tools.nasekomuspro.ru — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отдельный сайт `tools.nasekomuspro.ru` с входом по паролю, приглашениями по ссылке, выдачей инструментов поштучно, журналом и запросами доступа. Он отдаёт те же инструменты, что старый сайт, в оформлении «Глубина».

**Architecture:** Небольшой сервер на Node.js 22 (`node:http` + `node:sqlite`) за nginx на `vps1`. Сервер проверяет сессию и право на каждый запрос и отдаёт файлы инструментов **прямо из этого репозитория**, без копий. Подменяются только общие файлы: `/tools.js` собирается под человека, а `/assets/style.css` и `/assets/shell.js` отдаются как «старый файл + добавка портала». Обработка файлов остаётся в браузере. Журнал пишется добавкой к `Shell.setResultShown`, `app.js` инструментов не меняются.

**Tech Stack:** Node.js 22.22 (есть локально и в apt на сервере), `node:sqlite` (`DatabaseSync`), `node:crypto` (`scrypt`, `randomBytes`), `node:test`; единственная новая npm-зависимость — `nodemailer` (только для необязательной почты); nginx + certbot на сервере; systemd.

**Spec:** `docs/superpowers/specs/2026-10-18-tools-portal-design.md`

**Уточнение к спеке (решение планировщика).** В спеке сказано: «свой `portal/web/style.css`» и «свой `portal/web/shell.js`, выставляющий тот же `window.Shell`». В плане вместо полной замены — **склейка**. `/assets/style.css` = `assets/style.css` + `portal/web/theme.css`, `/assets/shell.js` = `assets/shell.js` + `portal/web/shell-addon.js`. Так `window.Shell` остаётся тем же кодом, новые классы старого CSS сразу работают и на новом сайте, а печать остаётся светлой сама: вся тема обёрнута в `@media screen`, а старое правило `@media print` не тронуто. Цель спеки (одна логика, два оформления) этим выполняется с меньшим кодом.

## Global Constraints

- Node.js ≥ 22.13 (нужен `node:sqlite` без флага). На сервере — `nodejs` 22.22 из apt.
- Новые npm-зависимости: только `nodemailer` в `dependencies`. `exceljs` остаётся в `devDependencies`.
- Файлы манифестов никогда не отправляются на сервер. Сервер получает только журнал: ключ инструмента, имена файлов и текст итога.
- Старый сайт (em.nasekomuspro.ru, GitHub Pages) ведёт себя как раньше. Из его файлов меняется только `deploy-em.sh` (исключения rsync). `assets/style.css`, `assets/shell.js`, `tools.js`, `app.js`, `core.js` и `lib/` ради портала **не правятся**.
- Весь текст интерфейса — по-русски.
- Сроки: приглашение — **7 дней**; ссылка сброса — **24 часа**; сессия **бессрочная** на сервере, cookie перевыпускается при каждом запросе с `Max-Age=34560000` (400 дней); пароль — **не короче 8 символов**; журнал хранится **365 дней**; резервные копии базы — **7 штук**, раз в сутки.
- Ограничение попыток входа: **10 неудачных за 15 минут** отдельно на почту и на IP.
- Cookie сессии: имя `lt_session`, `HttpOnly; Secure; SameSite=Lax; Path=/`. `Secure` отключается только переменной `COOKIE_SECURE=0`, для локальной разработки.
- Каждый ответ сервера — с `Cache-Control: no-store`.
- Изменяющие запросы (не GET/HEAD) без заголовка `Origin`, равного `PUBLIC_ORIGIN`, — `403`.
- Почта нормализуется `trim().toLowerCase()` везде: при приглашении, входе и «Забыли пароль?».
- Ключ права — каталог из `href` в `tools.js` (`'bl-split/index.html'` → `'bl-split'`). У администраторов все ключи.
- Палитра «Глубина»: фон `radial-gradient(120% 90% at 0% 0%, #1f5f86 0%, #0b2236 55%, #071624 100%)`; карточки `rgba(255,255,255,.09)` с рамкой `rgba(255,255,255,.16)` и скруглением 12px; главная кнопка — пилюля `linear-gradient(90deg, #7fe3f0, #4fb6e8)` с текстом `#072033`; «внимание» `#ffd28a`; основной текст `#eef5fa`, второстепенный `#a9c3d3`; акцент ссылок `#7fe3f0`. Макеты: `.superpowers/brainstorm/41798-1792325312/content/g-export-import.html` (вариант G1) и `g-results.html`.
- Переменные окружения сервера: `PORT`, `DB_PATH`, `SITE_ROOT` (корень репозитория), `PUBLIC_ORIGIN` (`https://tools.nasekomuspro.ru`), `COOKIE_SECURE`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
- Тесты — `*.test.js` рядом с кодом. Их подхватывает существующий `npm test` (`node --test`).

## Review Focus

1. **Почта с другим регистром или пробелами.** Приглашён `" Ivan@Mail.ru "`, а входит человек как `ivan@mail.ru`: вход должен пройти, второе приглашение на тот же адрес — `409`. Тесты в задачах 1 и 3.
2. **Ночная перезагрузка сервера.** Сервис поднимается заново, люди остаются внутри: сессии хранятся в базе, а не в памяти. Тест в задаче 3: второй экземпляр приложения на том же файле базы принимает старую cookie.
3. **Старая или уже использованная ссылка.** Человек открывает приглашение второй раз или через 8 дней и видит понятное «Ссылка уже использована или устарела — попросите новую у администратора», а не пустую страницу или ошибку. Тест в задаче 4.
4. **Журнал не двоится.** Страница зовёт `setResultShown(true)` повторно без скрытия: запись одна. После смены файлов (`false` → `true`) — новая запись. Проверка в браузере в задаче 7.
5. **Печать в тёмной теме.** Печать дашборда и любой страницы с результатом — светлая, как на старом сайте. Проверка печатного предпросмотра в задаче 7.

---

### Task 1: Хранилище — база, пароли, токены

**Files:**
- Create: `portal/server/db.js`, `portal/server/passwords.js`, `portal/server/tokens.js`
- Test: `portal/server/db.test.js`, `portal/server/passwords.test.js`

**Interfaces:**
- Produces:
  - `hashPassword(password: string) -> Promise<string>`: строка вида `scrypt$<saltHex>$<hashHex>`, соль 16 байт, ключ 64 байта. `verifyPassword(password: string, stored: string) -> Promise<boolean>`: сравнение через `timingSafeEqual`.
  - `newToken() -> string` (`randomBytes(32).toString('base64url')`), `hashToken(raw: string) -> string` (sha256 hex). В базе хранятся только хеши токенов.
  - `openDb(path: string) -> Db` (`':memory:'` для тестов): создаёт схему, если её нет. Время везде — миллисекунды (`number`), передаётся аргументом `now`/`at`.
  - Методы `Db`:
    - `createUser({email, name, isAdmin}) -> User`; `getUserByEmail(email) -> User|null`; `getUserById(id) -> User|null`. Здесь `User = {id, email, name, isAdmin: boolean, status: 'invited'|'active'|'disabled', createdAt, lastLoginAt: number|null}`.
    - `listUsers() -> Array<User & {tools: string[]}>`; `setPassword(userId, hash)` (ставит `status='active'`, если был `invited`); `getPasswordHash(userId) -> string|null`; `setStatus(userId, status)`; `touchLogin(userId, at)`.
    - `getTools(userId) -> string[]`; `setTools(userId, keys: string[])`: заменяет набор целиком.
    - `createToken({userId, kind: 'invite'|'reset', expiresAt}) -> string` (сырой токен); `peekToken(raw, kind, now) -> number|null` (userId); `consumeToken(raw, kind, now) -> number|null` (помечает использованным). Использованный или просроченный → `null`.
    - `createSession(userId, at) -> string`; `getSessionUser(raw) -> User|null` (только `status === 'active'`); `deleteSession(raw)`; `deleteUserSessions(userId)`.
    - `addJournal({userId, tool, kind: 'result'|'download', files: string[], summary: string, at})`; `listJournal({userId?, tool?, limit = 100}) -> Array<{id, userId, userName, tool, kind, files, summary, at}>` от новых к старым; `pruneJournal(before: number) -> number`.
    - `addRequest({userId, tool: string|null, at}) -> {id, created: boolean}` (`tool === null` — «не может войти»; открытый запрос того же человека на тот же инструмент не дублируется); `listRequests({status = 'open'}) -> Array<{id, userId, userName, email, tool, status, at}>`; `resolveRequest(id, status: 'granted'|'rejected', byUserId, at) -> {userId, tool}|null`; `countOpenRequests() -> number`.
  - Схема: `users(id, email UNIQUE, name, password_hash, is_admin, status, created_at, last_login_at)`, `permissions(user_id, tool, PRIMARY KEY(user_id, tool))`, `tokens(token_hash PK, user_id, kind, expires_at, used_at)`, `sessions(token_hash PK, user_id, created_at)`, `journal(id, user_id, tool, kind, files_json, summary, created_at)`, `requests(id, user_id, tool, status, created_at, resolved_at, resolved_by)`. Почта в базу пишется уже нормализованной.

- [ ] **Step 1: Write the failing tests**

```js
// passwords.test.js
test('hashPassword/verifyPassword', async () => {
  const h = await hashPassword('секрет123');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('секрет123', h), true);
  assert.equal(await verifyPassword('секрет124', h), false);
  assert.notEqual(await hashPassword('секрет123'), h); // соль разная
});

// db.test.js
test('почта хранится нормализованной и ищется без учёта регистра', () => {
  const db = openDb(':memory:');
  db.createUser({ email: ' Ivan@Mail.ru ', name: 'Иван', isAdmin: false });
  assert.equal(db.getUserByEmail('ivan@mail.ru').email, 'ivan@mail.ru');
  assert.throws(() => db.createUser({ email: 'IVAN@mail.ru', name: 'X', isAdmin: false }));
});
test('токен: одноразовый и со сроком', () => {
  // createToken expiresAt=1000 → peek(…, 999) === id, consume → id, consume ещё раз → null;
  // второй токен: peek(…, 1001) === null; kind 'reset' не принимается как 'invite'
});
test('сессия только у активного', () => {
  // invited → getSessionUser null; setPassword → active → user; setStatus disabled → null
});
test('setTools заменяет набор; listUsers отдаёт tools', () => { /* ['merge','dg-check'] → ['merge'] */ });
test('журнал: фильтр по человеку и инструменту, порядок от новых, pruneJournal', () => {});
test('запрос доступа не дублируется, пока открыт', () => {
  // addRequest дважды → created true, затем false с тем же id; resolveRequest → затем addRequest снова created true
});
```

- [ ] **Step 2: Run** `node --test portal/server/` — Expected: FAIL (модулей нет).
- [ ] **Step 3: Implement** `passwords.js`, `tokens.js`, `db.js` по интерфейсам выше. Нормализация почты — внутри `db.js` (`normalizeEmail`, экспортировать для задачи 3).
- [ ] **Step 4: Run** `node --test portal/server/` — Expected: PASS. Затем `npm test` — все прежние тесты тоже PASS.
- [ ] **Step 5: Commit** — `git add portal/server && git commit -m "Портал: хранилище — пользователи, права, токены, сессии, журнал, запросы"`

### Task 2: Каталог инструментов и права

**Files:**
- Create: `portal/server/catalog.js`
- Test: `portal/server/catalog.test.js`

**Interfaces:**
- Consumes: корневой `tools.js` (обычный скрипт, `window.TOOLS = [...]`).
- Produces:
  - `loadCatalog(siteRoot: string) -> {tools: Array<Tool & {key: string}>, keys: string[]}`. Исполняет `tools.js` в `node:vm` с `{window: {}}`. Порядок записей сохраняется, `keys` — уникальные ключи в порядке первого появления.
  - `toolKey(href: string) -> string` — первый сегмент пути.
  - `allowedKeys(user: User, userTools: string[], catalog) -> Set<string>` — у администратора все `catalog.keys`, иначе пересечение `userTools` с `catalog.keys`.
  - `classifyPath(catalog, pathname: string) -> {kind: 'tool', key} | {kind: 'lib'} | {kind: 'none'}`: первый сегмент — ключ каталога → `tool`, `lib` → `lib`, иначе `none`. Страницы портала и подменённые файлы разбирает задача 3, не эта функция.
  - `renderToolsJs(catalog, allowed: Set<string>) -> string` — текст `window.TOOLS = <JSON>;` только с разрешёнными записями, без поля `key`.

- [ ] **Step 1: Write the failing tests**

```js
const catalog = loadCatalog(repoRoot);
test('ключи каталога', () => {
  assert.deepEqual([...catalog.keys].sort(), ['arm-upload','bl-registry','bl-split','dashboard','dashboard-departure',
    'dg-check','grand-total','grand-total-import','merge','order-check','source-audit','source-check','template-check']);
});
test('одно право на обе записи «Разделить коносаменты»', () => {
  const src = renderToolsJs(catalog, new Set(['bl-split']));
  const window = {}; vm.runInNewContext(src, { window });
  assert.equal(window.TOOLS.length, 2);
  assert.ok(window.TOOLS.every((t) => t.href === 'bl-split/index.html' && !('key' in t)));
});
test('classifyPath', () => {
  assert.deepEqual(classifyPath(catalog, '/merge/app.js'), { kind: 'tool', key: 'merge' });
  assert.deepEqual(classifyPath(catalog, '/lib/manifest-format.js'), { kind: 'lib' });
  assert.deepEqual(classifyPath(catalog, '/portal/server/db.js'), { kind: 'none' });
});
test('allowedKeys: администратору всё, коллеге — только известные ключи', () => {});
```

- [ ] **Step 2: Run** `node --test portal/server/catalog.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `catalog.js`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `"Портал: каталог инструментов и права по каталогу href"`

### Task 3: HTTP-сервер — сессии, вход, отдача файлов с проверкой прав

**Files:**
- Create: `portal/server/app.js`, `portal/server/http-utils.js`, `portal/server/static.js`, `portal/server/ratelimit.js`, `portal/server/main.js`, `portal/server/test-helpers.js`, `portal/web/theme.css` (пока одна строка-заглушка `/* Глубина */`), `portal/web/shell-addon.js` (пока заглушка), `portal/web/login.html` (простая форма — оформление в задаче 8)
- Modify: `.claude/launch.json` — добавить конфигурацию `tools-portal`: `node portal/server/main.js`, порт 8010, env `PORT=8010 DB_PATH=.portal-dev/portal.db SITE_ROOT=. PUBLIC_ORIGIN=http://localhost:8010 COOKIE_SECURE=0`; `.gitignore` — добавить `.portal-dev/`
- Test: `portal/server/app.test.js`

**Interfaces:**
- Consumes: задачи 1 и 2.
- Produces:
  - `createApp({db, siteRoot, publicOrigin, mailer = null, now = Date.now, cookieSecure = true}) -> (req, res) => void`. IP клиента — заголовок `X-Real-IP` (его ставит nginx), иначе `req.socket.remoteAddress`.
  - `createLimiter({max: 10, windowMs: 15 * 60 * 1000, now}) -> {hit(key) -> void, blocked(key) -> boolean, reset(key) -> void}`.
  - `startTestServer({now?, mailer?}) -> Promise<{url, db, catalog, close(), addUser({email, name, password, isAdmin?, tools?}) -> Promise<User>, login(email, password) -> Promise<string /* cookie header */>, fetch(path, init?) /* с Origin */}>`. Поднимает `http.createServer(createApp(...))` на порту 0 с `':memory:'` (или с переданным путём к файлу базы — для теста перезапуска).
  - `main.js` читает переменные окружения, раз в сутки вызывает `db.pruneJournal(now - 365 дней)` (и сразу при старте), слушает `127.0.0.1:PORT`.
  - Маршруты этой задачи:
    - `POST /api/login {email, password}` → `200 {ok: true}` + `Set-Cookie`; неверно → `401 {error: 'Неверная почта или пароль'}`; блокировка → `429 {error: 'Слишком много попыток. Попробуйте через 15 минут.'}`. Удачный вход сбрасывает счётчик почты и вызывает `touchLogin`.
    - `POST /api/logout` → удаляет сессию, cookie с `Max-Age=0`.
    - `GET /api/me` → `{user: {id, email, name, isAdmin}, tools: Array<Tool & {key, allowed}>, openRequests: number /* только администраторам, иначе 0 */}`; без сессии — `401`.
    - Любой запрос с действующей сессией перевыпускает cookie с тем же токеном и `Max-Age=34560000`.
  - Правила отдачи файлов (`static.js`). Путь декодируется и нормализуется. Всё, что после нормализации выходит за корень или содержит сегмент, начинающийся с `.`, — `404`. Файлы `*.test.js` — всегда `404`.

    | Путь | Без сессии | С сессией |
    |---|---|---|
    | `/login`, `/invite/*`, `/reset/*`, `/portal/*` (статика `portal/web/`), `/assets/fonts.css` | отдаётся | отдаётся |
    | `/`, `/index.html` | `302 /login` | `portal/web/index.html` |
    | `/journal`, `/account` | `302 /login?next=…` | `portal/web/journal.html`, `account.html` |
    | `/admin/users`, `/admin/requests` | `302 /login?next=…` | администратору — страница, иначе `403` |
    | `/help/<key>`, `/help/samples/<file>` | `302 /login?next=…` | задача 9 |
    | `/tools.js` | `401` | `renderToolsJs` по правам |
    | `/assets/style.css` | `401` | `assets/style.css` + `\n` + `portal/web/theme.css`, `text/css` |
    | `/assets/shell.js` | `401` | `assets/shell.js` + `\n` + `portal/web/shell-addon.js` |
    | `/lib/*` | `401` | файл из `lib/` |
    | `/<key>/…` (каталог инструмента) | `302 /login?next=<путь>` | есть право — файл; нет — `403` HTML-страница «Нет доступа» с названием инструмента и кнопкой «Запросить доступ» (`POST /api/requests`, задача 5) |
    | всё остальное | `404` | `404` |

    Query (`?v=…`) при разборе пути игнорируется. Типы: `.html` `text/html; charset=utf-8`, `.js` `text/javascript; charset=utf-8`, `.css`, `.xlsx`, `.pdf`, `.zip`, `.png`, `.svg`. Каталог без файла (`/merge/`) → `index.html`.

- [ ] **Step 1: Write the failing tests** (`app.test.js`, через `startTestServer`)

```js
test('без входа инструмент уводит на вход', async () => {
  const r = await s.fetch('/merge/index.html', { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?next=%2Fmerge%2Findex.html');
});
test('вход: cookie с нужными атрибутами', async () => {
  await s.addUser({ email: 'ira@x.ru', name: 'Ирина', password: 'пароль-123', tools: ['merge'] });
  const r = await s.fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: ' IRA@x.ru', password: 'пароль-123' }) });
  assert.equal(r.status, 200);
  const c = r.headers.get('set-cookie');
  for (const part of ['lt_session=', 'HttpOnly', 'Secure', 'SameSite=Lax', 'Max-Age=34560000', 'Path=/']) assert.ok(c.includes(part), part);
});
test('право есть — файл; права нет — 403 «Нет доступа»', async () => {
  // /merge/index.html → 200, тело совпадает с файлом; /dg-check/index.html → 403, тело содержит «Нет доступа»
});
test('/tools.js только с разрешёнными', async () => { /* у коллеги с ['merge'] — 1 запись */ });
test('/assets/style.css и /assets/shell.js — склейка старого файла и добавки', async () => {
  // тело начинается с содержимого assets/style.css и заканчивается содержимым portal/web/theme.css
});
test('закрытые файлы репозитория не отдаются', async () => {
  for (const p of ['/CLAUDE.md', '/package.json', '/portal/server/db.js', '/merge/core.test.js',
                   '/.git/config', '/merge/../CLAUDE.md', '/%2e%2e/%2e%2e/etc/passwd', '/node_modules/exceljs/package.json'])
    assert.equal((await s.fetch(p, { headers: { cookie } })).status, 404, p);
});
test('POST без правильного Origin — 403', async () => {});
test('10 неудачных попыток — 429, через 15 минут снова можно', async () => { /* now подменяется */ });
test('отключённый человек выпадает', async () => { /* setStatus disabled → /api/me 401 */ });
test('после перезапуска сервера человек остаётся внутри', async () => {
  // база во временном файле; первый сервер — вход; close(); второй startTestServer на том же файле — /api/me с той же cookie → 200
});
test('Cache-Control: no-store на любом ответе', async () => {});
```

- [ ] **Step 2: Run** `node --test portal/server/app.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `http-utils.js` (`readJson(req, limitBytes = 64 * 1024)`, `sendJson`, `parseCookies`, `sessionCookie(token, {secure, maxAge})`), `ratelimit.js`, `static.js`, `app.js`, `main.js`, `test-helpers.js`, заглушки `theme.css`, `shell-addon.js`, `login.html`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Проверка вручную:** `preview_start tools-portal`, войти администратором, созданным командой из задачи 4 (если задача 4 ещё не сделана — через `node -e` с `openDb`/`hashPassword`), и открыть `/merge/index.html`. Склейка работает, страница в старом оформлении.
- [ ] **Step 6: Commit** — `"Портал: HTTP-сервер — вход, сессии, отдача инструментов по правам"`

### Task 4: Приглашения, сброс пароля, смена пароля, первый администратор

**Files:**
- Create: `portal/server/routes-auth.js` (подключается из `app.js`), `portal/server/cli.js`, `portal/web/invite.html` (одна страница на приглашение и сброс, режим по пути), `portal/web/link-gone.html`
- Modify: `portal/server/app.js`
- Test: `portal/server/auth.test.js`

**Interfaces:**
- Consumes: задачи 1–3.
- Produces:
  - `GET /invite/<token>` и `GET /reset/<token>`: действующий токен → `invite.html`; иначе `410` и `link-gone.html` с текстом **«Ссылка уже использована или устарела — попросите новую у администратора.»**
  - `GET /api/invite/<token>` → `{email, name}` или `410`. `POST /api/invite/<token> {password}` → задаёт пароль, гасит токен, создаёт сессию (`Set-Cookie`), `200 {ok: true}`. Повторно → `410`.
  - `GET /api/reset/<token>`, `POST /api/reset/<token> {password}` — то же для `kind: 'reset'`. Сброс гасит **все** прежние сессии человека и выдаёт новую.
  - Пароль короче 8 символов → `400 {error: 'Пароль — не короче 8 символов'}`.
  - `POST /api/password {current, password}` (с сессией): неверный текущий → `400 {error: 'Текущий пароль указан неверно'}`; успех — все сессии гасятся, выдаётся новая.
  - `POST /api/forgot {email}` → всегда `200 {message: 'Если такой адрес есть, мы передали запрос администратору.'}`. Для известного активного человека без `mailer` создаётся `addRequest({tool: null})`; с `mailer` — письмо (задача 6).
  - `issueLink(db, user, {now, publicOrigin}) -> string`. Для `invited` — новый `invite`-токен на 7 дней (`${publicOrigin}/invite/<raw>`), для остальных — `reset` на 24 часа (`/reset/<raw>`). Нужна и задаче 5.
  - `node portal/server/cli.js add-admin <email> <имя>` (читает `DB_PATH`, `PUBLIC_ORIGIN`) → создаёт администратора `invited` и печатает ссылку-приглашение. Для существующего адреса — новая ссылка через `issueLink`.

- [ ] **Step 1: Write the failing tests**

```js
test('приглашение действует 7 дней и одноразовое', async () => {
  // now = T; issueLink; GET /api/invite/<t> при T+6д → 200 {email,name}; при T+8д → 410
  // POST /api/invite/<t> {password:'пароль-123'} → 200 + set-cookie; повторный POST → 410; GET /invite/<t> → 410, тело содержит «Ссылка уже использована или устарела»
});
test('короткий пароль — 400 с понятным текстом', async () => {});
test('сброс действует 24 часа и выкидывает старые сессии', async () => {});
test('смена пароля проверяет текущий', async () => {});
test('«Забыли пароль?» без почты: одинаковый ответ, запрос администратору только для известного', async () => {
  // известный → listRequests() содержит {tool:null}; неизвестный → тот же текст, запросов не прибавилось
});
test('cli add-admin печатает ссылку', async () => { /* execFile с env DB_PATH=tmp, PUBLIC_ORIGIN=https://t.test → stdout ~ /^https:\/\/t\.test\/invite\// */ });
```

- [ ] **Step 2: Run** `node --test portal/server/auth.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** маршруты, `issueLink`, `cli.js`, страницы-заглушки (оформление в задаче 8).
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `"Портал: приглашения и сброс по ссылке, смена пароля, команда add-admin"`

### Task 5: API администратора, журнал, запросы доступа

**Files:**
- Create: `portal/server/routes-admin.js`, `portal/server/routes-journal.js`
- Modify: `portal/server/app.js`
- Test: `portal/server/admin.test.js`, `portal/server/journal.test.js`

**Interfaces:**
- Consumes: задачи 1–4 (`issueLink`).
- Produces (все `/api/admin/*` — только администраторам, иначе `403`):
  - `GET /api/admin/users` → `listUsers()`.
  - `POST /api/admin/users {email, name, tools: string[]}` → `201 {user, link}`. Занятая почта → `409 {error: 'Такой адрес уже есть'}`. Неизвестный ключ в `tools` → `400`.
  - `PUT /api/admin/users/<id>/tools {tools}` → `200`. Для администратора → `400 {error: 'У администратора все инструменты'}`.
  - `POST /api/admin/users/<id>/link` → `{link}` (через `issueLink`).
  - `POST /api/admin/users/<id>/disable` → гасит сессии. Себя → `409 {error: 'Нельзя отключить самого себя'}`. Последнего активного администратора → `409`. `POST /api/admin/users/<id>/enable` → `active` (если пароль задан, иначе `invited`).
  - `GET /api/admin/requests` → открытые запросы. `POST /api/admin/requests/<id>/grant` → добавляет ключ к правам человека, статус `granted`. Для запроса «не может войти» (`tool: null`) `grant` отвечает `{link}` — новой ссылкой входа. `POST /api/admin/requests/<id>/reject`.
  - `POST /api/requests {tool}` (любой вошедший) → `201 {created: true}` / `200 {created: false}`. Инструмент уже доступен → `200 {already: true}`. Неизвестный ключ → `400`.
  - `POST /api/journal {tool, kind, files, summary}` → `204`. Проверки: `tool` — ключ каталога и разрешён этому человеку; `kind ∈ {'result','download'}`; `files` — массив строк, не больше 50, каждая обрезается до 255 символов; `summary` обрезается до 500. Нарушение → `400`.
  - `GET /api/journal?user=<id>&tool=<key>&limit=<n ≤ 500>` → коллеге только свои записи (параметр `user` игнорируется), администратору — все с фильтрами. В записи — `toolTitle` из каталога.

- [ ] **Step 1: Write the failing tests** — по одному тесту на каждую строку `409/400/403` выше, плюс:

```js
test('grant выдаёт право, и инструмент открывается', async () => {
  // коллега: POST /api/requests {tool:'dg-check'} → 201; админ: grant → коллега GET /dg-check/index.html → 200
});
test('журнал: коллега видит только своё, администратор — всех', async () => {});
test('журнал не принимает чужой инструмент и лишние файлы', async () => { /* tool без права → 400; 51 файл → 400 */ });
test('отключение гасит сессии', async () => {});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` — Expected: PASS.
- [ ] **Step 5: Commit** — `"Портал: админка, журнал и запросы доступа (API)"`

### Task 6: Необязательная почта

**Files:**
- Create: `portal/server/mail.js`
- Modify: `package.json` (`"dependencies": {"nodemailer": "^6.9.0"}` — точную версию взять последнюю 6.x и зафиксировать в lock-файле), `portal/server/main.js`, `routes-auth.js`, `routes-admin.js`
- Test: `portal/server/mail.test.js`

**Interfaces:**
- Produces:
  - `createMailer(env) -> Mailer|null`. Без `SMTP_HOST` → `null`. Иначе `{send({to, subject, text}) -> Promise<void>}` через `nodemailer` (`secure: SMTP_PORT == 465`).
  - Где отправляет. Админ пригласил — письмо приглашённому со ссылкой (ссылка всё равно возвращается в ответе). «Забыли пароль?» от известного активного — письмо со ссылкой сброса **вместо** запроса администратору. Новый запрос доступа — письмо каждому активному администратору.
  - Ошибка отправки не роняет запрос: пишется в `console.error`. При «Забыли пароль?» тогда создаётся запрос администратору, как без почты.
  - Тексты писем — простой текст по-русски. Тема приглашения: «Приглашение в Лоцию».

- [ ] **Step 1: Write the failing tests** — `startTestServer({mailer: fake})`, где `fake.sent` — массив. Проверить три сценария отправки и сценарий «`send` бросает исключение → ответ 200 и есть запрос `tool: null`».
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** — `"Портал: письма через SMTP, если настроены"`

### Task 7: Оформление «Глубина» поверх страниц инструментов

**Files:**
- Modify: `portal/web/theme.css`, `portal/web/shell-addon.js`

**Interfaces:**
- Consumes: DOM, который рисует `assets/shell.js` (`.app__side` с `.side__brand`, `.side__menu-btn`, `.side__safe`, `.side__tabs`, `.side__nav`; `.crumbs`), контракт разметки страниц (`CLAUDE.md`) и `GET /api/me`, `POST /api/journal`.
- Produces:
  - `theme.css` — **целиком внутри `@media screen { … }`**. Переопределяет токены `:root` из `assets/style.css` под палитру «Глубина» (`--water`, `--surface`, `--ink`, `--muted`, `--line`, `--accent`, `--accent-h`, `--accent-t`, `--tint`, `--depth`, `--sea`, `--warn`, `--warn-bg`, `--error`, `--error-bg`, `--drop-line` и т. д.). Задаёт фон `body`, стеклянные `.stat`, `.dashboard-block`, `.file-list`, `.dropzone`, `.data-table`, кнопки-пилюли `.btn` и контурные `.btn--secondary`, поля `.field`, `.switch`. **Раскладка:** `.app` — колонка; `.app__side` — верхняя полоса во всю ширину (бренд слева, справа ссылки добавки); на любой ширине список инструментов открывается кнопкой `.side__menu-btn` («Инструменты») как выпадающая панель — то же поведение, что сейчас у узкого экрана; `.side__safe` скрыт.
  - `shell-addon.js` — обычный скрипт, IIFE, работает после `window.Shell`:
    1. Текст `.side__brand` → «Лоция.» (точка цветом `#7fe3f0`). Подпись `.side__brand-sub` убирается.
    2. Через `GET /api/me` в полосу добавляются ссылки «Журнал» (`/journal`), для администраторов — «Пользователи» (`/admin/users`) со счётчиком `openRequests`, если он больше 0, плашка с именем (ведёт на `/account`) и «Выйти» (`POST /api/logout` → `/login`).
    3. На странице инструмента после `.page__subtitle` — ссылка «Как это работает и пример файла» на `/help/<key>`, где `key` — первый сегмент `location.pathname`.
    4. Журнал: обёртка над `window.Shell.setResultShown`. При переходе `false → true` уходит `POST /api/journal` с `{tool: key, kind: 'result', files: [...document.querySelectorAll('.file-list__name')].map(n => n.textContent.trim()), summary}`, где `summary` — плитки `.result__head .stat`, склеенные `«<.stat__value> <.stat__label в нижнем регистре>»` через `' · '`. Повторный `true` без `false` между ними ничего не пишет. Клик по `.btn` внутри `.result__actions` → `kind: 'download'`, `summary` = текст кнопки. `fetch(…, {keepalive: true})` с `.catch(() => {})`: ошибки человеку не показываются.
- Порядок подключения не меняется: сервер склеивает файлы, страницы ничего не знают.

- [ ] **Step 1: Сделать тему и добавку.**
- [ ] **Step 2: Проверка в браузере** (`preview_start tools-portal`, администратор). Каждая из 13 страниц инструментов открывается без ошибок в консоли: полоса сверху, меню «Инструменты» раскрывается, путь «Экспорт / № N · …», номер у заголовка, ссылка «Как это работает». На страницах со скрытыми кнопками результата (`template-check`) главной (бирюзовой) остаётся одна — первая видимая.
- [ ] **Step 3: Проверка результата на реальных файлах.** Для `merge`, `order-check`, `dashboard`, `grand-total`, `template-check` загрузить файлы (синтетические из задачи 9 или реальные у пользователя — **на сервер они не уходят**) и убедиться, что результат на экране полный, а скачивание работает. В `read_network_requests` нет запросов с телом файла, есть только `/api/journal`.
- [ ] **Step 4: Проверка Review Focus 4.** Показать результат, затем ещё раз нажать запуск без смены файлов — в журнале (`GET /api/journal`) одна запись; сменить файл и запустить — две.
- [ ] **Step 5: Проверка Review Focus 5.** Печатный предпросмотр (`window.print` в `@media print`-эмуляции или `matchMedia('print')` через DevTools) страницы дашборда — светлый фон, тёмный текст, таблица целиком.
- [ ] **Step 6: Проверка ширины 375px** (`resize_window mobile`): полоса и меню работают, горизонтальной прокрутки страницы нет.
- [ ] **Step 7: Commit** — `"Портал: оформление «Глубина» и добавка к общему каркасу (журнал, меню, справка)"`

### Task 8: Страницы портала

**Files:**
- Create: `portal/web/index.html`, `portal/web/home.js`, `portal/web/portal.js` (общие помощники: `api(path, {method, body})` с JSON и `Origin`, `renderTopBar()` — та же полоса, что делает добавка, для страниц без `shell.js`), `portal/web/journal.html`, `portal/web/journal.js`, `portal/web/account.html`, `portal/web/admin-users.html`, `portal/web/admin-users.js`, `portal/web/admin-requests.html`, `portal/web/admin-requests.js`, `portal/web/portal.css` (страницы портала; подключает те же токены «Глубины»)
- Modify: `portal/web/login.html`, `portal/web/invite.html`, `portal/web/link-gone.html`, 403-страница «Нет доступа» (шаблон в `static.js` из задачи 3)

**Interfaces:**
- Consumes: API задач 3–5.
- Produces — тексты и поведение:
  - **Главная (G1).** «Добрый день, <имя>» (до 12:00 — «Доброе утро», после 18:00 — «Добрый вечер»), строка «Файлы обрабатываются на вашем компьютере и никуда не отправляются». Переключатель-пилюля «Экспорт / Импорт» с подписью «N из M» (доступно из всего во вкладке; у администраторов N = M), выбор хранится в `localStorage` под ключом `manifest-tools:tab` с try/catch — тем же, что у старого каркаса. Сетка в две колонки (одна уже 700px): «№ N», метка формата, название (`title`), описание (`description`), кнопка «Открыть». Закрытые — пунктир, «Нет доступа», контурная жёлтая «Запросить доступ» → `POST /api/requests`, после ответа — «Запрос отправлен». Внизу три последние записи журнала: «<время> — <инструмент>, <summary>». Порядок карточек — порядок `tools` из `/api/me` внутри вкладки.
  - **Вход.** Почта, пароль, «Войти», ссылка «Забыли пароль?» (раскрывает поле почты и кнопку «Отправить» → текст ответа `/api/forgot`). После входа — переход на `next`, если он начинается с `/` и не с `//`, иначе на `/`.
  - **Приглашение и сброс.** Заголовок «Добро пожаловать, <имя>» или «Новый пароль», почта показана текстом, два поля пароля («Пароль», «Ещё раз»), проверка совпадения на странице, кнопка «Сохранить и войти».
  - **«Нет доступа».** «Инструмент «<title>» вам пока не выдан», кнопка «Запросить доступ», ссылка «На главную».
  - **Журнал.** Таблица «Когда / Кто (только администраторам) / Инструмент / Файлы / Итог». Администраторам — фильтры по человеку и инструменту.
  - **Мой профиль (`/account`).** Имя, почта, смена пароля (текущий, новый, ещё раз).
  - **Пользователи.** Таблица: имя, почта, состояние («приглашён» / «активен» / «отключён»), последний вход. Кнопка «Пригласить» открывает форму: почта, имя, галочки инструментов двумя группами «Экспорт» / «Импорт» (у `bl-split` одна галочка, хотя записи две). После приглашения — блок со ссылкой и кнопкой «Скопировать» и подсказка «Отправьте ссылку человеку в мессенджер. Ссылка действует 7 дней.» У строки: «Инструменты» (те же галочки, «Сохранить»), «Новая ссылка для входа» (тот же блок со ссылкой, для сброса подпись «…действует 24 часа»), «Отключить» / «Включить». У администраторов вместо галочек — «Все инструменты».
  - **Запросы.** «<имя> просит доступ к «<инструмент>»» — «Выдать» / «Отклонить». «<имя> не может войти» — «Дать новую ссылку» (показывает блок со ссылкой) / «Отклонить».
- [ ] **Step 1: Сделать страницы.**
- [ ] **Step 2: Проверка в браузере полным сценарием.** Администратор приглашает коллегу с двумя инструментами, ссылку открыть в чистой вкладке (`tabs_create`, без cookie), задать пароль и войти. На главной 2 открытых и остальные закрытые; запросить доступ; администратор видит счётчик, выдаёт; коллега открывает инструмент. Затем «Забыли пароль?» → запрос «не может войти» → «Дать новую ссылку» → вход по новой ссылке. Отключить коллегу → его вкладка при следующем переходе уходит на вход.
- [ ] **Step 3: Проверка ширины 375px** для главной, входа и «Пользователей».
- [ ] **Step 4: Commit** — `"Портал: главная, вход, приглашение, журнал, профиль, пользователи, запросы"`

### Task 9: Инструкции к инструментам и примеры файлов

**Files:**
- Create: `portal/help/<key>.html` — 13 фрагментов, по одному на ключ каталога; `portal/help/make-samples.js`; `portal/help/samples/*.xlsx` (результат скрипта, коммитится)
- Modify: `portal/server/static.js` (маршруты `/help/<key>` и `/help/samples/<file>`)
- Test: `portal/help/help.test.js`

**Interfaces:**
- Produces:
  - `/help/<key>` — для любого вошедшего, даже без права на инструмент: человек должен понять, о чём просить. Фрагмент вставляется в общий шаблон страницы портала с заголовком `title` из каталога и кнопкой «Открыть инструмент» (если есть право) или «Запросить доступ». Неизвестный ключ → `404`.
  - Фрагмент — три коротких раздела: «Что загрузить», «Что получится», «На что обратить внимание», плюс ссылки на примеры. Источник содержания — описание инструмента в `CLAUDE.md` и подписи на его странице. Писать по-простому, без внутренних имён функций.
  - `node portal/help/make-samples.js` (через `exceljs` из devDependencies) пишет синтетические входные файлы для всех Excel-инструментов. Суда, рейсы, контейнеры (с верной контрольной цифрой ISO 6346), пломбы, грузоотправители и веса **выдуманы**. Формат — тот, что разбирают `lib/manifest-format.js`, `lib/loading-order.js`, `template-check/template-form.js`, разбор исходного файла линии в `source-check/core.js`/`source-audit/core.js`. Для `bl-split` (PDF) примера нет, только описание.
- [ ] **Step 1: Write the failing test**

```js
test('у каждого инструмента есть инструкция', () => {
  for (const key of loadCatalog(repoRoot).keys) assert.ok(fs.existsSync(`portal/help/${key}.html`), key);
});
test('каждый пример файла, на который ссылается инструкция, существует', () => { /* href="/help/samples/…" */ });
test('примеры проходят разбор своих инструментов', async () => {
  // например: validateStructure([wb манифеста]) ок; parseLoadingOrder(wb поручения).ok; readSourceManifest(wb исходного).ok; detectFileKind(wb шаблона) === 'template'
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3:** Написать фрагменты, скрипт, сгенерировать примеры, добавить маршруты. **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Проверка в браузере:** с каждого примера инструмент на портале даёт результат без ошибки.
- [ ] **Step 6: Commit** — `"Портал: инструкции к инструментам и синтетические примеры файлов"`

### Task 10: Деплой на vps1 и документация

**Files:**
- Create: `deploy-tools.sh`, `portal/deploy/manifest-portal.service`, `portal/deploy/manifest-portal-backup.service`, `portal/deploy/manifest-portal-backup.timer`, `portal/deploy/nginx-tools.nasekomuspro.ru.conf`
- Modify: `deploy-em.sh` (добавить `--exclude 'portal'`, `--exclude 'docs'`, `--exclude '.superpowers'`, `--exclude '.portal-dev'`, `--exclude 'deploy-tools.sh'`), `CLAUDE.md` (раздел о портале: адрес, устройство склейки, «правка `assets/shell.js`/`assets/style.css` — проверить и портал», команда `deploy-tools.sh`, `add-admin`, где база и копии)

**Interfaces:**
- Produces:
  - `manifest-portal.service`: `User=manifest-portal`, `WorkingDirectory=/opt/manifest-portal`, `EnvironmentFile=/etc/manifest-portal.env`, `ExecStart=/usr/bin/node portal/server/main.js`, `Restart=always`, `WantedBy=multi-user.target`.
  - Резервная копия: таймер раз в сутки (`OnCalendar=*-*-* 03:30`, после ночной перезагрузки в 01:00). Служба делает `sqlite3`-совместимую копию через `node -e` с `VACUUM INTO` в `/var/lib/manifest-portal/backup/portal-<YYYY-MM-DD>.db` и оставляет 7 последних.
  - nginx: `server_name tools.nasekomuspro.ru`, `proxy_pass http://127.0.0.1:<PORT>`, `proxy_set_header X-Real-IP $remote_addr`, `Host`, `X-Forwarded-Proto`; `client_max_body_size 1m` (файлы на сервер не идут). TLS — через `certbot --nginx -d tools.nasekomuspro.ru`.
  - `deploy-tools.sh`: `rsync -avz --delete` корня в `root@130.49.213.189:/opt/manifest-portal/` без `.git`, `node_modules`, `.autopilot`, `.claude`, `.agents`, `.superpowers`, `.portal-dev`, `docs`, `*.test.js`, `CLAUDE.md`, `.DS_Store`. Затем на сервере `cd /opt/manifest-portal && npm ci --omit=dev && chown -R manifest-portal: /opt/manifest-portal && systemctl restart manifest-portal`, в конце `curl -sI https://tools.nasekomuspro.ru/login` с ожиданием `200`.
- [ ] **Step 1:** Написать файлы деплоя, правку `deploy-em.sh`, раздел `CLAUDE.md`. Commit — `"Портал: деплой на vps1, резервные копии, документация"`.
- [ ] **Step 2: Спросить пользователя, прежде чем трогать сервер.** Дальнейшие шаги меняют рабочий сервер, где живут em, NetBird и другие сайты. Нужно явное «да» в чате и почта жены для второго администратора.
- [ ] **Step 3: Разовая установка на `vps1`.** `df -h /` (нужно не меньше 300 МБ свободно); `apt-get install -y nodejs npm`; `useradd --system --home /opt/manifest-portal manifest-portal`; каталоги `/opt/manifest-portal`, `/var/lib/manifest-portal/backup` (владелец `manifest-portal`); свободный порт по `ss -ltn` → `/etc/manifest-portal.env` (`PORT`, `DB_PATH=/var/lib/manifest-portal/portal.db`, `SITE_ROOT=/opt/manifest-portal`, `PUBLIC_ORIGIN=https://tools.nasekomuspro.ru`), права `600`; юниты в `/etc/systemd/system/`, `systemctl enable --now manifest-portal manifest-portal-backup.timer`; vhost в `sites-available` + ссылка в `sites-enabled`, `nginx -t`, `systemctl reload nginx`, `certbot --nginx -d tools.nasekomuspro.ru`.
- [ ] **Step 4: Проверить, что `default_server` не перехвачен:** `curl -sk --resolve unknown.test:443:130.49.213.189 https://unknown.test/` отвечает так же, как до установки (сохранить ответ до шага 3). em, disp, line, md, netbird открываются.
- [ ] **Step 5:** `./deploy-tools.sh`; `node portal/server/cli.js add-admin` для пользователя (`nasekomus@gmail.com`) и для жены — ссылки передать пользователю.
- [ ] **Step 6: Проверка Review Focus 2 вживую:** войти, `systemctl restart manifest-portal`, обновить страницу — человек внутри.
- [ ] **Step 7:** `./deploy-em.sh` — em работает как раньше, `portal/` на em не попал (`curl -sI https://em.nasekomuspro.ru/portal/server/app.js` → `404`).
