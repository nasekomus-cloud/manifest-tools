import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './passwords.js';

test('hashPassword/verifyPassword', async () => {
  const h = await hashPassword('секрет123');
  assert.match(h, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(await verifyPassword('секрет123', h), true);
  assert.equal(await verifyPassword('секрет124', h), false);
  assert.notEqual(await hashPassword('секрет123'), h); // соль разная
});

test('verifyPassword: мусор вместо хеша — false, а не исключение', async () => {
  assert.equal(await verifyPassword('x', ''), false);
  assert.equal(await verifyPassword('x', 'bcrypt$aa$bb'), false);
  assert.equal(await verifyPassword('x', 'scrypt$zz$yy'), false);
});
