import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './test-helpers.js';

const post = (cookie, body) => ({ method: 'POST', headers: { Cookie: cookie }, body: JSON.stringify(body) });
const get = (cookie) => ({ headers: { Cookie: cookie } });

async function setup() {
  const clock = { t: 1_800_000_000_000 };
  const s = await startTestServer({ now: () => clock.t });
  const admin = await s.addUser({ email: 'boss@x.ru', name: 'Босс', password: 'пароль-босса', isAdmin: true });
  const lena = await s.addUser({ email: 'lena@x.ru', name: 'Лена', password: 'пароль-лены', tools: ['merge', 'dg-check'] });
  const olga = await s.addUser({ email: 'olga@x.ru', name: 'Ольга', password: 'пароль-ольги', tools: ['merge'] });
  return {
    s, clock, admin, lena, olga,
    adminCookie: await s.login('boss@x.ru', 'пароль-босса'),
    lenaCookie: await s.login('lena@x.ru', 'пароль-лены'),
    olgaCookie: await s.login('olga@x.ru', 'пароль-ольги'),
  };
}

const entry = (tool = 'merge', extra = {}) => ({ tool, kind: 'result', files: ['a.xlsx'], summary: '10 строк', ...extra });

test('журнал: без входа — 401', async () => {
  const { s } = await setup();
  try {
    assert.equal((await s.fetch('/api/journal')).status, 401);
    assert.equal((await s.fetch('/api/journal', { method: 'POST', body: JSON.stringify(entry()) })).status, 401);
  } finally { await s.close(); }
});

test('POST /api/journal: пишет запись → 204, время — серверное', async () => {
  const { s, clock, lena, lenaCookie } = await setup();
  try {
    const r = await s.fetch('/api/journal', post(lenaCookie, entry('merge', { files: ['1.xlsx', '2.xlsx'], summary: '2 файла · 30 строк', at: 5 })));
    assert.equal(r.status, 204);
    assert.equal(await r.text(), '');
    const [rec] = s.db.listJournal({ userId: lena.id });
    assert.deepEqual(
      { tool: rec.tool, kind: rec.kind, files: rec.files, summary: rec.summary, at: rec.at },
      { tool: 'merge', kind: 'result', files: ['1.xlsx', '2.xlsx'], summary: '2 файла · 30 строк', at: clock.t },
    );
  } finally { await s.close(); }
});

test('журнал принимает скачивание и пустой список файлов', async () => {
  const { s, lenaCookie } = await setup();
  try {
    const r = await s.fetch('/api/journal', post(lenaCookie, entry('merge', { kind: 'download', files: [], summary: 'Скачать результат' })));
    assert.equal(r.status, 204);
  } finally { await s.close(); }
});

test('журнал не принимает чужой инструмент и лишние файлы', async () => {
  const { s, lena, olgaCookie, lenaCookie } = await setup();
  try {
    // у Ольги нет dg-check
    let r = await s.fetch('/api/journal', post(olgaCookie, entry('dg-check')));
    assert.equal(r.status, 400);
    // неизвестный ключ
    r = await s.fetch('/api/journal', post(lenaCookie, entry('нет-такого')));
    assert.equal(r.status, 400);
    // 51 файл
    r = await s.fetch('/api/journal', post(lenaCookie, entry('merge', { files: Array.from({ length: 51 }, (_, i) => `f${i}.xlsx`) })));
    assert.equal(r.status, 400);
    assert.equal(s.db.listJournal({ userId: lena.id }).length, 0);
    // ровно 50 — можно
    r = await s.fetch('/api/journal', post(lenaCookie, entry('merge', { files: Array.from({ length: 50 }, (_, i) => `f${i}.xlsx`) })));
    assert.equal(r.status, 204);
  } finally { await s.close(); }
});

test('журнал: кривые поля — 400', async () => {
  const { s, lena, lenaCookie } = await setup();
  try {
    const bad = [
      entry('merge', { kind: 'other' }),
      entry('merge', { kind: undefined }),
      entry('merge', { files: 'a.xlsx' }),
      entry('merge', { files: undefined }),
      entry('merge', { files: ['ok', 5] }),
      entry('merge', { files: [null] }),
      entry('merge', { summary: 5 }),
      entry('merge', { summary: undefined }),
      entry(5),
      { kind: 'result', files: [], summary: '' }, // без tool
    ];
    for (const body of bad) {
      const r = await s.fetch('/api/journal', post(lenaCookie, body));
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(s.db.listJournal({ userId: lena.id }).length, 0);
  } finally { await s.close(); }
});

test('журнал: имя файла режется до 255 символов, итог — до 500', async () => {
  const { s, lena, lenaCookie } = await setup();
  try {
    const r = await s.fetch('/api/journal', post(lenaCookie, entry('merge', { files: ['я'.repeat(300), 'короткое.xlsx'], summary: 'ы'.repeat(700) })));
    assert.equal(r.status, 204);
    const [rec] = s.db.listJournal({ userId: lena.id });
    assert.equal(rec.files[0].length, 255);
    assert.equal(rec.files[1], 'короткое.xlsx');
    assert.equal(rec.summary.length, 500);
  } finally { await s.close(); }
});

test('администратор пишет в журнал по любому ключу каталога', async () => {
  const { s, admin, adminCookie } = await setup();
  try {
    const r = await s.fetch('/api/journal', post(adminCookie, entry('bl-split')));
    assert.equal(r.status, 204);
    assert.equal(s.db.listJournal({ userId: admin.id }).length, 1);
  } finally { await s.close(); }
});

test('журнал: коллега видит только своё, администратор — всех', async () => {
  const { s, clock, lena, olga, lenaCookie, olgaCookie, adminCookie } = await setup();
  try {
    await s.fetch('/api/journal', post(lenaCookie, entry('merge', { summary: 'лена-1' })));
    clock.t += 1000;
    await s.fetch('/api/journal', post(lenaCookie, entry('dg-check', { summary: 'лена-2' })));
    clock.t += 1000;
    await s.fetch('/api/journal', post(olgaCookie, entry('merge', { summary: 'ольга-1' })));

    // Коллега: параметр user игнорируется
    const r = await s.fetch(`/api/journal?user=${olga.id}`, get(lenaCookie));
    assert.equal(r.status, 200);
    let list = await r.json();
    assert.deepEqual(list.map((x) => x.summary), ['лена-2', 'лена-1']);
    assert.ok(list.every((x) => x.userId === lena.id));

    // Фильтр по инструменту у коллеги работает только по своим
    list = await (await s.fetch('/api/journal?tool=merge', get(lenaCookie))).json();
    assert.deepEqual(list.map((x) => x.summary), ['лена-1']);

    // Администратор: все, свежие сверху
    list = await (await s.fetch('/api/journal', get(adminCookie))).json();
    assert.deepEqual(list.map((x) => x.summary), ['ольга-1', 'лена-2', 'лена-1']);
    assert.equal(list[0].userName, 'Ольга');
    // фильтры
    list = await (await s.fetch(`/api/journal?user=${lena.id}`, get(adminCookie))).json();
    assert.deepEqual(list.map((x) => x.summary), ['лена-2', 'лена-1']);
    list = await (await s.fetch('/api/journal?tool=merge', get(adminCookie))).json();
    assert.deepEqual(list.map((x) => x.summary), ['ольга-1', 'лена-1']);
    list = await (await s.fetch(`/api/journal?user=${lena.id}&tool=dg-check`, get(adminCookie))).json();
    assert.deepEqual(list.map((x) => x.summary), ['лена-2']);
  } finally { await s.close(); }
});

test('записи журнала несут toolTitle из каталога', async () => {
  const { s, lenaCookie } = await setup();
  try {
    await s.fetch('/api/journal', post(lenaCookie, entry('merge')));
    const [rec] = await (await s.fetch('/api/journal', get(lenaCookie))).json();
    assert.equal(rec.toolTitle, s.catalog.tools.find((t) => t.key === 'merge').title);
    assert.equal(rec.tool, 'merge');
    assert.deepEqual(rec.files, ['a.xlsx']);
  } finally { await s.close(); }
});

test('GET /api/journal: limit ограничивает; кривые параметры — 400', async () => {
  const { s, lenaCookie, adminCookie } = await setup();
  try {
    for (let i = 0; i < 5; i++) await s.fetch('/api/journal', post(lenaCookie, entry('merge', { summary: `s${i}` })));
    let list = await (await s.fetch('/api/journal?limit=2', get(lenaCookie))).json();
    assert.equal(list.length, 2);
    list = await (await s.fetch('/api/journal?limit=100000', get(lenaCookie))).json();
    assert.equal(list.length, 5);
    for (const q of ['limit=0', 'limit=-1', 'limit=abc', 'limit=1.5']) {
      assert.equal((await s.fetch(`/api/journal?${q}`, get(lenaCookie))).status, 400, q);
    }
    assert.equal((await s.fetch('/api/journal?user=abc', get(adminCookie))).status, 400);
  } finally { await s.close(); }
});

test('GET /api/journal: потолок limit — 500', async () => {
  const { s, adminCookie } = await setup();
  try {
    const original = s.db.listJournal;
    let seen;
    s.db.listJournal = (args) => { seen = args; return original(args); };
    await s.fetch('/api/journal?limit=100000', get(adminCookie));
    assert.equal(seen.limit, 500);
  } finally { await s.close(); }
});

test('отключённый человек не может писать в журнал (сессия погашена)', async () => {
  const { s, lena, lenaCookie, adminCookie } = await setup();
  try {
    await s.fetch(`/api/admin/users/${lena.id}/disable`, post(adminCookie, {}));
    assert.equal((await s.fetch('/api/journal', post(lenaCookie, entry()))).status, 401);
  } finally { await s.close(); }
});
