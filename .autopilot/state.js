window.STATE =
{
  "slug": "port-dashboard",
  "dir": "2026-09-06-port-dashboard",
  "title": "Дашборд по портам назначения",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-06-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-06T18:08:29+03:00",
  "updatedAt": "2026-09-06T19:20:00+03:00",
  "finishedAt": "2026-09-06T19:20:00+03:00",
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-09-06T18:08:29+03:00",
      "finishedAt": "2026-09-06T18:12:00+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-09-06T18:12:00+03:00",
      "finishedAt": "2026-09-06T18:20:00+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-09-06T18:14:00+03:00",
      "finishedAt": "2026-09-06T18:20:00+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-09-06T18:20:00+03:00",
      "finishedAt": "2026-09-06T18:35:00+03:00"
    },
    {
      "id": "plan",
      "status": "skipped",
      "note": "ярус T0 — без разбивки на таски"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-09-06T18:35:00+03:00",
      "finishedAt": "2026-09-06T19:05:00+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-09-06T19:00:00+03:00",
      "finishedAt": "2026-09-06T19:05:00+03:00"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-09-06T19:05:00+03:00",
      "finishedAt": "2026-09-06T19:20:00+03:00"
    }
  ],
  "requirements": {
    "total": 12,
    "done": 12,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [],
  "singlePass": {
    "files": ["dashboard/core.js", "dashboard/core.test.js", "dashboard/app.js", "dashboard/index.html", "tools.js", "index.html", "assets/style.css"],
    "tests": "npm test → 30 passed, 0 failed (было 19)",
    "commit": "7c3b842",
    "startedAt": "2026-09-06T18:35:00+03:00",
    "finishedAt": "2026-09-06T19:05:00+03:00"
  },
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": { "findings": 0, "acted": "независимая проверка не нашла пропусков и половинчатых требований; всё найденное «в спецификации, но не в брифе» — обычные R##.n-истории (пустой файл, ошибки, нормализация), у каждой есть родитель в манифесте" },
  "concerns": [],
  "reviewers": {
    "manifestSpec": null,
    "craft": null
  },
  "blind": {
    "drift": [],
    "note": "все требования брифа (основной текст + оба пункта «Дополнения») подтверждены живым запуском на реальном файле пользователя: разбивка по портам/типам/весу, показ на странице, скачивание в Excel с тем же составом данных, несколько файлов со сводом по каждому плюс общий свод, понятная ошибка на несовместимом файле. Расхождений с манифестом не найдено."
  }
}
