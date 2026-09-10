window.STATE =
{
  "slug": "order-check",
  "dir": "2026-09-10-order-check--wip",
  "title": "Сверка манифеста с поручениями на погрузку",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-10-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-10T13:43:54+03:00",
  "updatedAt": "2026-09-10T13:57:07+03:00",
  "finishedAt": null,
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-10T13:43:54+03:00", "finishedAt": "2026-09-10T13:44:18+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-10T13:44:18+03:00", "finishedAt": "2026-09-10T13:46:23+03:00" },
    { "id": "briefing",  "status": "done", "startedAt": "2026-09-10T13:46:23+03:00", "finishedAt": "2026-09-10T13:48:07+03:00", "note": "один вопрос — приём файлов (архив/отдельные файлы)" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-10T13:48:07+03:00", "finishedAt": "2026-09-10T13:55:20+03:00" },
    { "id": "plan",      "status": "skipped", "note": "ярус T0 — без разбивки на таски" },
    { "id": "build",     "status": "active", "startedAt": "2026-09-10T13:57:07+03:00" },
    { "id": "review",    "status": "pending" },
    { "id": "final",     "status": "pending" }
  ],
  "requirements": {
    "total": 14, "done": 0, "inTicket": 0, "inSpec": 13,
    "placeholder": 0, "deferred": 1, "dropped": 0
  },
  "tickets": [],
  "singlePass": null,
  "tests": null,
  "debt": { "placeholders": [], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": { "findings": 4, "acted": "1 реальный пробел исправлен — правило исключения веса поддонов не учитывало слово «палеты», названное в брифе наравне с «поддонами»; добавлен точный (не по подстроке) список обоих терминов. Остальные 3 находки — законные R##.n-детализации уже покрытых требований (допуск сравнения веса, нормализация «грязного» номера поручения, сценарий «поручение указано неверно») плюс отнесение R07 («и так далее») к «Вне рамок» с обоснованием — не пробелы" },
  "concerns": [],
  "reviewers": { "manifestSpec": null, "craft": null },
  "blind": null
}
