window.STATE =
{
  "slug": "order-check",
  "dir": "2026-09-10-order-check",
  "title": "Сверка манифеста с поручениями на погрузку",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-10-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-10T13:43:54+03:00",
  "updatedAt": "2026-09-10T14:18:30+03:00",
  "finishedAt": "2026-09-10T14:18:30+03:00",
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-10T13:43:54+03:00", "finishedAt": "2026-09-10T13:44:18+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-10T13:44:18+03:00", "finishedAt": "2026-09-10T13:46:23+03:00" },
    { "id": "briefing",  "status": "done", "startedAt": "2026-09-10T13:46:23+03:00", "finishedAt": "2026-09-10T13:48:07+03:00", "note": "один вопрос — приём файлов (архив/отдельные файлы)" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-10T13:48:07+03:00", "finishedAt": "2026-09-10T13:55:20+03:00" },
    { "id": "plan",      "status": "skipped", "note": "ярус T0 — без разбивки на таски" },
    { "id": "build",     "status": "done", "startedAt": "2026-09-10T13:57:07+03:00", "finishedAt": "2026-09-10T14:10:33+03:00" },
    { "id": "review",    "status": "done", "startedAt": "2026-09-10T14:08:00+03:00", "finishedAt": "2026-09-10T14:10:33+03:00", "note": "T0 — все три оси сам, инлайн" },
    { "id": "final",     "status": "done", "startedAt": "2026-09-10T14:10:33+03:00", "finishedAt": "2026-09-10T14:18:30+03:00" }
  ],
  "requirements": {
    "total": 14, "done": 13, "inTicket": 0, "inSpec": 0,
    "placeholder": 0, "deferred": 1, "dropped": 0
  },
  "tickets": [],
  "singlePass": {
    "files": [
      "order-check/core.js", "order-check/core.test.js", "order-check/app.js", "order-check/index.html",
      "tools.js", "index.html"
    ],
    "tests": "npm test → 82 passed, 0 failed (было 64)",
    "commit": "6513f9c",
    "startedAt": "2026-09-10T13:57:07+03:00",
    "finishedAt": "2026-09-10T14:10:33+03:00"
  },
  "tests": null,
  "debt": { "placeholders": [], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": { "findings": 4, "acted": "1 реальный пробел исправлен — правило исключения веса поддонов не учитывало слово «палеты», названное в брифе наравне с «поддонами»; добавлен точный (не по подстроке) список обоих терминов. Остальные 3 находки — законные R##.n-детализации уже покрытых требований (допуск сравнения веса, нормализация «грязного» номера поручения, сценарий «поручение указано неверно») плюс отнесение R07 («и так далее») к «Вне рамок» с обоснованием — не пробелы" },
  "concerns": [],
  "reviewers": { "manifestSpec": null, "craft": null },
  "blind": {
    "drift": [],
    "note": "Независимая проверка (без доступа к spec.md/manifest.md) прогнала npm test (82/82) и подняла сайт (python3 -m http.server), прошла сценарий инструмента в браузере на синтетических файлах через живой <input type=file>: сводка расхождений совпала с заложенными в фикстуру (вес груза/тары, пломба, тип, ненайденный контейнер, «поддоны» корректно не дают расхождения) точь-в-точь; отдельно прочитала результирующую книгу ExcelJS напрямую — столбец «Несовпадения» и жёлтая заливка (FFFFFF00) на расходящихся строках подтверждены на уровне объектов стиля. Все требования брифа отмечены «реализовано», расхождений с манифестом (drift) не найдено."
  }
}
