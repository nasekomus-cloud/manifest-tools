window.STATE =
{
  "slug": "export-import-tabs",
  "dir": "2026-09-10-export-import-tabs",
  "title": "Вкладки «Экспорт»/«Импорт» на главной",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": null,
  "briefFile": "2026-09-10-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-10T21:42:57+03:00",
  "updatedAt": "2026-09-10T22:20:00+03:00",
  "finishedAt": "2026-09-10T22:20:00+03:00",
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-10T21:42:57+03:00", "finishedAt": "2026-09-10T21:44:00+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-10T21:44:00+03:00", "finishedAt": "2026-09-10T21:46:00+03:00" },
    { "id": "briefing",  "status": "skipped", "note": "вопросов не потребовалось — оба открытых пункта решены самостоятельно (факт + краft-решение)" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-10T21:46:00+03:00", "finishedAt": "2026-09-10T21:52:00+03:00" },
    { "id": "plan",      "status": "skipped", "note": "ярус T0 — без разбивки на таски" },
    { "id": "build",     "status": "done", "startedAt": "2026-09-10T21:52:00+03:00", "finishedAt": "2026-09-10T22:10:00+03:00" },
    { "id": "review",    "status": "done", "startedAt": "2026-09-10T22:05:00+03:00", "finishedAt": "2026-09-10T22:10:00+03:00", "note": "T0 — все три оси сам, инлайн, без замечаний" },
    { "id": "final",     "status": "done", "startedAt": "2026-09-10T22:10:00+03:00", "finishedAt": "2026-09-10T22:20:00+03:00" }
  ],
  "requirements": {
    "total": 8, "done": 8, "inTicket": 0, "inSpec": 0,
    "placeholder": 0, "deferred": 0, "dropped": 0
  },
  "tickets": [],
  "singlePass": {
    "files": ["tools.js", "index.html", "assets/style.css"],
    "tests": "npm test → 175 passed, 0 failed (без изменений — правка не трогает протестированные модули)",
    "commit": "1aae143",
    "startedAt": "2026-09-10T21:52:00+03:00",
    "finishedAt": "2026-09-10T22:10:00+03:00"
  },
  "tests": null,
  "debt": { "placeholders": [], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": { "findings": 0, "acted": "Независимая проверка (бриф + спецификация, без манифеста) расхождений не нашла: все три предложения брифа покрыты буквально, ничего не пропущено, ничего не покрыто наполовину. Три пункта «сверх брифа» — законное углубление R05 (пустая вкладка, R05.1) и craft-решения по реализации (поле category, два грида, независимый счётчик номеров), не самостоятельные требования" },
  "concerns": [],
  "reviewers": { "manifestSpec": null, "craft": null },
  "blind": {
    "drift": [],
    "note": "Независимая проверка (бриф + запущенный сайт, без .autopilot/) прошла сценарий заказчика через живой http-сервер: обе вкладки, «Экспорт» открыта по умолчанию с двумя нужными карточками, «Импорт» — с остальными пятью. Все пункты брифа отмечены «реализовано», расхождений с манифестом (drift) не найдено."
  }
}
