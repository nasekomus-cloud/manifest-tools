window.STATE =
{
  "slug": "manifest-tools",
  "dir": "2026-09-06-manifest-tools",
  "title": "Инструменты для судовых манифестов",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T1",
  "briefFile": "2026-09-06-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-06T11:39:54+03:00",
  "updatedAt": "2026-09-06T12:37:22+03:00",
  "finishedAt": "2026-09-06T12:37:22+03:00",
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-06T11:39:54+03:00", "finishedAt": "2026-09-06T11:41:00+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-06T11:41:00+03:00", "finishedAt": "2026-09-06T11:44:00+03:00" },
    { "id": "briefing",  "status": "done", "startedAt": "2026-09-06T11:44:00+03:00", "finishedAt": "2026-09-06T11:48:34+03:00" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-06T11:48:34+03:00", "finishedAt": "2026-09-06T11:57:06+03:00" },
    { "id": "plan",      "status": "done", "startedAt": "2026-09-06T11:57:06+03:00", "finishedAt": "2026-09-06T11:59:46+03:00" },
    { "id": "build",     "status": "done", "startedAt": "2026-09-06T11:59:46+03:00", "finishedAt": "2026-09-06T12:24:37+03:00" },
    { "id": "review",    "status": "done", "startedAt": "2026-09-06T12:00:24+03:00", "finishedAt": "2026-09-06T12:24:37+03:00" },
    { "id": "final",     "status": "done", "startedAt": "2026-09-06T12:24:37+03:00", "finishedAt": "2026-09-06T12:33:09+03:00" }
  ],
  "requirements": {
    "total": 18, "done": 18, "inTicket": 0, "inSpec": 0,
    "placeholder": 0, "deferred": 0, "dropped": 0
  },
  "tickets": [
    { "id": "01", "title": "Каркас сайта, главная страница и формат манифеста", "requirements": ["R01","R02","R04","A01","R07","R18i"],
      "blockedBy": [], "wave": 1, "zone": ["index.html","tools.js","assets/","lib/","package.json"], "status": "done",
      "startedAt": "2026-09-06T12:00:24+03:00", "finishedAt": "2026-09-06T12:10:16+03:00",
      "tests": "npm test → 3 passed, 0 failed", "commit": "f744f96",
      "retries": 0, "repairs": 0, "handoffs": 0 },
    { "id": "02", "title": "Инструмент «Объединить манифесты»", "requirements": ["R05","R06","R07","R07.1","R08","R09","R10","R11","R16i","R16i.1","R17i"],
      "blockedBy": ["01"], "wave": 2, "zone": ["merge/"], "status": "done",
      "startedAt": "2026-09-06T12:10:16+03:00", "finishedAt": "2026-09-06T12:23:10+03:00",
      "tests": "npm test → 11 passed, 0 failed", "commit": "ebb4d83",
      "retries": 0, "repairs": 0, "handoffs": 0 },
    { "id": "03", "title": "Инструмент «Сверить опасные грузы»", "requirements": ["R12","R12.1","R12.2","R13","R14","R15i","R16i","R16i.1","R17i"],
      "blockedBy": ["01"], "wave": 2, "zone": ["dg-check/"], "status": "done",
      "startedAt": "2026-09-06T12:10:16+03:00", "finishedAt": "2026-09-06T12:24:37+03:00",
      "tests": "npm test → 11 passed, 0 failed", "commit": "7b9c25c",
      "retries": 0, "repairs": 0, "handoffs": 0 }
  ],
  "singlePass": null,
  "tests": null,
  "debt": { "placeholders": [], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": { "findings": 2, "acted": "уточнил формат ячейки при 3+ опасных позициях (История 13); исправил номера строк шапки манифеста с ошибочных 1-4 на верные 3-5 из брифа" },
  "concerns": [
    { "ticket": "01", "axis": "craft+spec", "file": "lib/manifest-format.js:1-3", "finding": "комментарий в шапке файла утверждает, что константы формата «намеренно не выставлены наружу», хотя они экспортированы. Спецификацию поправил сразу (границы модуля теперь официально включают эти константы, interfaces.md уже так и описывал) — остался только сам вводящий в заблуждение комментарий в коде, некритично, можно поправить попутно в тикете 02/03 или на доводке" },
    { "ticket": "02", "axis": "craft", "file": "merge/app.js, dg-check/app.js", "finding": "дублирование обёртки loadWorkbook и логики скачивания blob между двумя app.js; в merge/core.js две константы (FIRST_COPY_COLUMN, NUMBER_COLUMN) на одно значение — некритично" },
    { "ticket": "03", "axis": "craft", "file": "dg-check/core.test.js; dg-check/app.js:119", "finding": "нет теста на отсутствие заголовка «Номер контейнера»/«Опасные грузы» в самом сводном файле (только для DG-манифеста); ошибка чтения файла в dg-check/app.js пробрасывает исходный (не русский) текст ExcelJS, а не готовое русское сообщение как в merge/app.js" }
  ],
  "reviewers": { "manifestSpec": "a0af61a895b01f002", "craft": "a482bcd4d26fe49d7" },
  "blind": { "drift": [], "note": "все требования брифа подтверждены живым прогоном (слияние, сверка, ошибки структуры/заголовков); R18i — опубликовано на GitHub Pages с разрешения пользователя: https://nasekomus-cloud.github.io/manifest-tools/" }
}
