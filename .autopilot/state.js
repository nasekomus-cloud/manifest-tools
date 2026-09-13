window.STATE =
{
  "slug": "dashboard-destination-rework",
  "dir": "2026-09-13-dashboard-destination-rework",
  "title": "Дашборд по портам назначения — переименование, перенос в Экспорт, порожние, печать",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-13-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-13T15:14:14+03:00",
  "updatedAt": "2026-09-13T15:46:50+03:00",
  "finishedAt": "2026-09-13T15:46:50+03:00",
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-13T15:14:14+03:00", "finishedAt": "2026-09-13T15:15:00+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-13T15:15:00+03:00", "finishedAt": "2026-09-13T15:19:00+03:00" },
    { "id": "briefing",  "status": "skipped", "note": "вопросов не потребовалось — бриф однозначен", "startedAt": "2026-09-13T15:19:00+03:00", "finishedAt": "2026-09-13T15:19:25+03:00" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-13T15:19:25+03:00", "finishedAt": "2026-09-13T15:25:06+03:00" },
    { "id": "plan",      "status": "skipped", "note": "ярус T0 — без разбивки на таски", "startedAt": "2026-09-13T15:25:06+03:00", "finishedAt": "2026-09-13T15:26:02+03:00" },
    { "id": "build",     "status": "done", "startedAt": "2026-09-13T15:26:02+03:00", "note": "T0 — один проход", "finishedAt": "2026-09-13T15:39:41+03:00" },
    { "id": "review",    "status": "done", "startedAt": "2026-09-13T15:39:41+03:00", "note": "все три оси — сам, T0", "finishedAt": "2026-09-13T15:39:41+03:00" },
    { "id": "final",     "status": "done", "startedAt": "2026-09-13T15:39:41+03:00", "note": "слепая приёмка: расхождений нет", "finishedAt": "2026-09-13T15:46:50+03:00" }
  ],
  "requirements": {
    "total": 6, "done": 6, "inTicket": 0, "inSpec": 0,
    "placeholder": 0, "deferred": 0, "dropped": 0
  },
  "tickets": [],
  "singlePass": {
    "startedAt": "2026-09-13T15:26:02+03:00",
    "finishedAt": "2026-09-13T15:39:41+03:00",
    "files": [
      "lib/port-breakdown.js", "lib/port-breakdown.test.js",
      "dashboard/core.js", "dashboard/core.test.js", "dashboard/app.js", "dashboard/index.html",
      "dashboard-departure/core.js", "dashboard-departure/app.js", "dashboard-departure/index.html",
      "tools.js", "assets/style.css",
      "index.html", "merge/index.html", "dg-check/index.html", "bl-split/index.html",
      "grand-total/index.html", "order-check/index.html", "bl-registry/index.html", "template-check/index.html"
    ],
    "tests": { "passed": 275, "failed": 0 },
    "commit": "bdb7e6f"
  },
  "tests": { "passed": 275, "failed": 0 },
  "debt": { "placeholders": [], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": {
    "checkedAt": "2026-09-13T15:25:06+03:00",
    "missing": 0,
    "halfCovered": 0,
    "extraVsBrief": 6,
    "notes": "независимый ревьюер (брифи+спек, без манифеста): не покрыто — пусто; покрыто наполовину — пусто; 6 пунктов «есть в спеке, не было в брифе» — все опознаны как проработка (R03.2, детали R03/R05) с явным родителем, не голое A##"
  },
  "concerns": [
    "dashboard/app.js — computeColumnWidths/applyTableBorder/MEDIUM_BORDER/THIN_BORDER дублируют bl-registry/app.js (и грубее — grand-total/app.js): осознанное дублирование, тот же приём, что уже принят на сайте для DOM-слоя каждого инструмента (см. CLAUDE.md); не выносил в lib/, т.к. это первый повтор именно печатной вёрстки, а не логики подсчёта"
  ],
  "reviewers": { "manifestSpec": null, "craft": null },
  "blind": {
    "checkedAt": "2026-09-13T15:46:50+03:00",
    "agreed": true,
    "drift": [],
    "ranScenario": true,
    "notes": "все 5 пунктов брифа независимо подтверждены живым запуском (дев-сервер, синтетический манифест, скачанный Excel разобран через exceljs) — переименование везде, перенос в Экспорт, порожние подсвечены и на странице, и в Excel (заливка FFEAF1F2), последняя позиция в Экспорте, печатная разметка (landscape, fitToWidth/fitToHeight, printArea/printTitlesRow, рамка, ширины колонок). Расхождений с манифестом нет",
    "commands": [
      "npm install",
      "npm test → 275 passed, 0 failed",
      "python3 -m http.server 8000"
    ]
  }
}
