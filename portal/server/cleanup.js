// Ежедневная уборка базы: при старте сервиса и раз в сутки (main.js).
//  - журнал хранится 365 дней;
//  - у кого вышел срок доступа (тестовая ссылка), тот отключается вместе с сессиями и
//    ссылками — чтобы в «Пользователях» статус был верным, даже если человек больше не заходил.
//    Сам вход сервер не пропускает и без этого: срок проверяется на каждом запросе (app.js).

const DAY_MS = 24 * 60 * 60 * 1000;
export const JOURNAL_KEEP_MS = 365 * DAY_MS;

/** → {journalRemoved, usersDisabled} */
export function dailyCleanup(db, now) {
  return {
    journalRemoved: db.pruneJournal(now - JOURNAL_KEEP_MS),
    usersDisabled: db.disableExpired(now),
  };
}
