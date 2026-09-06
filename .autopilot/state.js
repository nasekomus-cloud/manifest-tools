window.STATE =
{
  "slug": "manifest-tools",
  "dir": "2026-09-06-manifest-tools--wip",
  "title": "Инструменты для судовых манифестов",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T1",
  "briefFile": "2026-09-06-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-06T11:39:54+03:00",
  "updatedAt": "2026-09-06T11:59:46+03:00",
  "finishedAt": null,
  "stages": [
    { "id": "preflight", "status": "done", "startedAt": "2026-09-06T11:39:54+03:00", "finishedAt": "2026-09-06T11:41:00+03:00" },
    { "id": "manifest",  "status": "done", "startedAt": "2026-09-06T11:41:00+03:00", "finishedAt": "2026-09-06T11:44:00+03:00" },
    { "id": "briefing",  "status": "done", "startedAt": "2026-09-06T11:44:00+03:00", "finishedAt": "2026-09-06T11:48:34+03:00" },
    { "id": "spec",      "status": "done", "startedAt": "2026-09-06T11:48:34+03:00", "finishedAt": "2026-09-06T11:57:06+03:00" },
    { "id": "plan",      "status": "done", "startedAt": "2026-09-06T11:57:06+03:00", "finishedAt": "2026-09-06T11:59:46+03:00" },
    { "id": "build",     "status": "active", "startedAt": "2026-09-06T11:59:46+03:00" },
    { "id": "review",    "status": "pending" },
    { "id": "final",     "status": "pending" }
  ],
  "requirements": {
    "total": 18, "done": 0, "inTicket": 18, "inSpec": 0,
    "placeholder": 0, "deferred": 0, "dropped": 0
  },
  "tickets": [
    { "id": "01", "title": "Каркас сайта, главная страница и формат манифеста", "requirements": ["R01","R02","R04","A01","R07","R18i"],
      "blockedBy": [], "wave": 1, "zone": ["index.html","tools.js","assets/","lib/","package.json"], "status": "review",
      "startedAt": "2026-09-06T12:00:24+03:00", "retries": 0, "repairs": 0, "handoffs": 0 },
    { "id": "02", "title": "Инструмент «Объединить манифесты»", "requirements": ["R05","R06","R07","R07.1","R08","R09","R10","R11","R16i","R16i.1","R17i"],
      "blockedBy": ["01"], "wave": 2, "zone": ["merge/"], "status": "pending",
      "retries": 0, "repairs": 0, "handoffs": 0 },
    { "id": "03", "title": "Инструмент «Сверить опасные грузы»", "requirements": ["R12","R12.1","R12.2","R13","R14","R15i","R16i","R16i.1","R17i"],
      "blockedBy": ["01"], "wave": 2, "zone": ["dg-check/"], "status": "pending",
      "retries": 0, "repairs": 0, "handoffs": 0 }
  ],
  "singlePass": null,
  "tests": null,
  "debt": { "placeholders": [], "assumptions": [], "emptyEnv": [] },
  "additions": [],
  "coverage": { "findings": 2, "acted": "уточнил формат ячейки при 3+ опасных позициях (История 13); исправил номера строк шапки манифеста с ошибочных 1-4 на верные 3-5 из брифа" },
  "concerns": [
    { "ticket": "01", "axis": "craft+spec", "file": "lib/manifest-format.js:1-3", "finding": "комментарий в шапке файла утверждает, что константы формата «намеренно не выставлены наружу», хотя они экспортированы. Спецификацию поправил сразу (границы модуля теперь официально включают эти константы, interfaces.md уже так и описывал) — остался только сам вводящий в заблуждение комментарий в коде, некритично, можно поправить попутно в тикете 02/03 или на доводке" }
  ],
  "reviewers": { "manifestSpec": "a42b7b67d46878444", "craft": "a76ab6a2911db3bd2" },
  "blind": null
}
