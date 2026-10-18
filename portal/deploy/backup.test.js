import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupName, selectForPruning, runBackup } from './backup.mjs';

test('backupName: дата с нулями в имени', () => {
  assert.equal(backupName(new Date(2026, 0, 5, 3, 30)), 'portal-2026-01-05.db');
  assert.equal(backupName(new Date(2026, 9, 18, 23, 59)), 'portal-2026-10-18.db');
});

test('selectForPruning: оставляет 7 новейших, удаляет остальные', () => {
  const names = [];
  for (let day = 1; day <= 10; day += 1) names.push(`portal-2026-10-${String(day).padStart(2, '0')}.db`);
  const shuffled = [...names].reverse();
  assert.deepEqual(selectForPruning(shuffled, 7).sort(), names.slice(0, 3));
});

test('selectForPruning: меньше семи — ничего не удаляет; чужие файлы не трогает', () => {
  assert.deepEqual(selectForPruning(['portal-2026-10-01.db', 'portal-2026-10-02.db'], 7), []);
  const names = ['notes.txt', 'portal-2026-10-01.db.tmp', 'portal-2026-10-01.db', 'portal-2026-10-02.db'];
  assert.deepEqual(selectForPruning(names, 1), ['portal-2026-10-01.db']);
});

test('runBackup: пишет копию, повторный запуск в тот же день заменяет её, старые удаляет', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'portal-backup-'));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = join(dir, 'portal.db');
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('один')");
    db.close();
    const backupDir = join(dir, 'backup');
    for (let day = 1; day <= 9; day += 1) {
      await runBackup({ dbPath, backupDir, keep: 7, now: new Date(2026, 9, day, 3, 30) });
    }
    await runBackup({ dbPath, backupDir, keep: 7, now: new Date(2026, 9, 9, 15, 0) });
    const files = readdirSync(backupDir).sort();
    assert.equal(files.length, 7);
    assert.equal(files[0], 'portal-2026-10-03.db');
    assert.equal(files.at(-1), 'portal-2026-10-09.db');
    const copy = new DatabaseSync(join(backupDir, files.at(-1)));
    assert.equal(copy.prepare('SELECT v FROM t').get().v, 'один');
    copy.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
