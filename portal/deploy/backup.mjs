// Резервная копия базы портала: VACUUM INTO в portal-YYYY-MM-DD.db, хранится 7 последних.
// Запускает systemd-таймер (manifest-portal-backup.timer) раз в сутки.
//
//   DB_PATH      файл базы SQLite (обязательно)
//   BACKUP_DIR   каталог копий; по умолчанию «backup» рядом с базой
//   BACKUP_KEEP  сколько копий хранить, по умолчанию 7

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_KEEP = 7;
const NAME_RE = /^portal-\d{4}-\d{2}-\d{2}\.db$/;

// Имя копии по местной дате сервера: portal-2026-10-18.db
export function backupName(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `portal-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.db`;
}

// Какие файлы каталога удалить, чтобы осталось `keep` самых новых копий.
// Трогает только файлы с именем portal-YYYY-MM-DD.db (чужое и временное не удаляет);
// «новее» — по дате в имени, она сортируется как строка.
export function selectForPruning(fileNames, keep = DEFAULT_KEEP) {
  const copies = fileNames.filter((name) => NAME_RE.test(name)).sort().reverse();
  return copies.slice(Math.max(0, keep));
}

// Тонкая часть с вводом-выводом: копия во временный файл, потом переименование —
// оборванная копия не займёт место настоящей. Возвращает путь копии и удалённые файлы.
export async function runBackup({ dbPath, backupDir, keep = DEFAULT_KEEP, now = new Date() }) {
  // Нет базы — не копировать: sqlite молча создал бы пустой файл, и в каталоге копий
  // появилась бы «копия» без данных (а при ротации она вытеснила бы настоящую)
  if (!existsSync(dbPath)) throw new Error(`Файл базы не найден: ${dbPath}`);
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, backupName(now));
  const temp = `${target}.tmp`;
  rmSync(temp, { force: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000'); // сервис пишет в ту же базу: подождать, а не падать на «database is locked»
    db.exec(`VACUUM INTO '${temp.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
  renameSync(temp, target);
  const removed = selectForPruning(readdirSync(backupDir), keep);
  for (const name of removed) rmSync(join(backupDir, name), { force: true });
  return { target, removed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
    console.warn(warning.stack ?? String(warning));
  });
  const dbPath = process.env.DB_PATH;
  if (!dbPath) {
    console.error('Не задан DB_PATH.');
    process.exit(1);
  }
  const backupDir = process.env.BACKUP_DIR || join(dirname(resolve(dbPath)), 'backup');
  const keep = Number(process.env.BACKUP_KEEP || DEFAULT_KEEP);
  let result;
  try {
    result = await runBackup({ dbPath, backupDir, keep });
  } catch (err) {
    console.error(err?.message ?? err);
    process.exit(1);
  }
  const { target, removed } = result;
  console.log(`Копия базы: ${basename(target)}${removed.length ? `, удалено старых: ${removed.length}` : ''}`);
}
