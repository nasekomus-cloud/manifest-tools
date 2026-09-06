window.STATE =
{
  "slug": "manifest-pdf-report",
  "dir": "2026-09-06-manifest-pdf-report",
  "title": "Итоговый PDF-отчёт по манифесту",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-06-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-06T20:35:37+03:00",
  "updatedAt": "2026-09-06T22:35:00+03:00",
  "finishedAt": "2026-09-06T22:35:00+03:00",
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-06T20:35:37+03:00", "finishedAt": "2026-09-06T20:37:00+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-06T20:37:00+03:00", "finishedAt": "2026-09-06T20:38:00+03:00" },
    { "id": "briefing",  "status": "done", "startedAt": "2026-09-06T20:38:00+03:00", "finishedAt": "2026-09-06T20:44:56+03:00" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-06T20:44:56+03:00", "finishedAt": "2026-09-06T20:52:18+03:00" },
    { "id": "plan",      "status": "skipped", "note": "ярус T0 — без разбивки на таски" },
    { "id": "build",     "status": "done", "startedAt": "2026-09-06T20:52:18+03:00", "finishedAt": "2026-09-06T22:17:58+03:00" },
    { "id": "review",    "status": "done", "startedAt": "2026-09-06T22:00:00+03:00", "finishedAt": "2026-09-06T22:17:58+03:00" },
    { "id": "final",     "status": "done", "startedAt": "2026-09-06T22:17:58+03:00", "finishedAt": "2026-09-06T22:35:00+03:00" }
  ],
  "requirements": {
    "total": 11, "done": 11, "inTicket": 0, "inSpec": 0,
    "placeholder": 0, "deferred": 0, "dropped": 0
  },
  "tickets": [],
  "singlePass": {
    "files": [
      "lib/manifest-format.js", "lib/manifest-format.test.js",
      "lib/port-breakdown.js", "lib/port-breakdown.test.js",
      "grand-total/core.js", "grand-total/core.test.js", "grand-total/app.js", "grand-total/index.html",
      "assets/style.css", "tools.js", "index.html",
      "merge/core.js", "merge/app.js", "merge/index.html",
      "dg-check/core.js", "dg-check/app.js", "dg-check/index.html",
      "dashboard/core.js", "dashboard/app.js", "dashboard/index.html",
      "dashboard-departure/core.js", "dashboard-departure/app.js", "dashboard-departure/index.html"
    ],
    "tests": "npm test → 64 passed, 0 failed (было 46)",
    "commit": "dda6163",
    "startedAt": "2026-09-06T20:52:18+03:00",
    "finishedAt": "2026-09-06T22:17:58+03:00"
  },
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": { "findings": 0, "acted": "независимая проверка не нашла пропусков и половинчатых требований; всё найденное «в спецификации, но не в брифе» — обычные R##.n/R##i.n-истории (несколько файлов, обработка ошибок, автоопределение судна/рейса, строка коносаментов, вёрстка PDF), у каждой есть родитель в манифесте" },
  "concerns": [
    { "axis": "craft", "file": "lib/port-breakdown.js", "finding": "extractTotalsRows (для buildManifestTotals) структурно почти дублирует extractRows (для buildPortBreakdownDashboard) — обе читают лист, ищут колонки, идут по строкам, пропускают строки без контейнера. Различаются составом полей (порт vs коносамент). Не объединено сейчас, чтобы не городить параметризацию ради двух вызовов — не блокирует, можно объединить при следующей правке этого файла" }
  ],
  "reviewers": { "manifestSpec": null, "craft": null },
  "blind": {
    "drift": [],
    "note": "все требования брифа (основной текст + пункт «Дополнения» про терминал) подтверждены живым запуском на реальном файле пользователя: загрузка манифеста → отчёт на странице с разбивкой по 5 типам контейнеров и итогом → скачанный PDF с той же шапкой (VESSEL/VOYAGE — автоматически, CALL SIGN/ARRIVAL DATE/TERMINAL — вручную) и таблицей. Расхождений с манифестом не найдено."
  }
}
