window.STATE =
{
  "slug": "orders-bl-registry",
  "dir": "2026-09-12-orders-bl-registry",
  "title": "Сводный реестр поручений и коносаментов",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-12-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-12T11:18:37+03:00",
  "updatedAt": "2026-09-12T13:05:00+03:00",
  "finishedAt": "2026-09-12T13:05:00+03:00",
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-12T11:18:37+03:00", "finishedAt": "2026-09-12T11:20:00+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-12T11:20:00+03:00", "finishedAt": "2026-09-12T11:24:00+03:00" },
    { "id": "briefing",  "status": "done", "startedAt": "2026-09-12T11:24:00+03:00", "finishedAt": "2026-09-12T11:30:00+03:00" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-12T11:30:00+03:00", "finishedAt": "2026-09-12T11:55:00+03:00" },
    { "id": "plan",      "status": "skipped", "note": "ярус T0 — без разбивки на таски" },
    { "id": "build",     "status": "done", "startedAt": "2026-09-12T11:56:00+03:00", "finishedAt": "2026-09-12T12:40:00+03:00" },
    { "id": "review",    "status": "done", "startedAt": "2026-09-12T12:35:00+03:00", "finishedAt": "2026-09-12T12:40:00+03:00", "note": "T0 — все три оси сам, инлайн; блокирующих находок нет" },
    { "id": "final",     "status": "done", "startedAt": "2026-09-12T12:40:00+03:00", "finishedAt": "2026-09-12T13:05:00+03:00" }
  ],
  "requirements": {
    "total": 9, "done": 9, "inTicket": 0, "inSpec": 0,
    "placeholder": 0, "deferred": 0, "dropped": 0
  },
  "tickets": [],
  "singlePass": {
    "files": [
      "bl-registry/core.js",
      "bl-registry/app.js",
      "bl-registry/core.test.js",
      "bl-registry/index.html",
      "tools.js",
      "index.html"
    ],
    "tests": "npm test → 191 passed, 0 failed (было 178, +13 новых теста)",
    "commit": "9aebd50",
    "startedAt": "2026-09-12T11:56:00+03:00",
    "finishedAt": "2026-09-12T12:40:00+03:00"
  },
  "tests": null,
  "debt": { "placeholders": [], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": {
    "findings": 2,
    "acted": "Независимая проверка (бриф + спецификация, без манифеста) нашла 2 реальных пробела в описании выходного файла: (1) в эталоне перед итоговыми строками две пустые строки, спецификация называла одну — исправлено; (2) в эталоне таблица обведена рамкой (medium по периметру, thin внутри), спецификация об оформлении не говорила вообще — добавлен пункт §10 с точным описанием рамки, проверенным побайтово. Остальные находки (имя файла на скачивание, две depth-истории про ошибки, поведение при разных заголовках в нескольких файлах, обоснование сортировки без localeCompare) — законные добавления спецификации сверх брифа (глубина normal + техническая часть), не пробелы; оставлены как есть."
  },
  "concerns": [],
  "reviewers": { "manifestSpec": null, "craft": null },
  "blind": {
    "verdict": "все 9 требований — «реализовано», расхождений с манифестом нет",
    "note": "единственное отличие от эталонного файла — опечатка в самом эталоне (кириллическая «С» вместо латинской в одном номере коносамента), не в манифесте и не в инструменте",
    "commands": "npm test → 191 passed; node --test bl-registry/core.test.js → 13 passed; python3 -m http.server + сквозной прогон в браузере с реальным файлом — 131 строка, 131/129 уникальных, скачанный .xlsx проверен повторным разбором ExcelJS"
  }
}
