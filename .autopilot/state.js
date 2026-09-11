window.STATE =
{
  "slug": "merge-weights-blsplit-export",
  "dir": "2026-09-11-merge-weights-blsplit-export--wip",
  "title": "Вес в отчёте склейки + «Разделение коносаментов» во вкладке «Экспорт»",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-11-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-11T09:39:49+03:00",
  "updatedAt": "2026-09-11T09:49:20+03:00",
  "finishedAt": null,
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-09-11T09:39:49+03:00",
      "finishedAt": "2026-09-11T09:40:51+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-09-11T09:40:51+03:00",
      "finishedAt": "2026-09-11T09:44:25+03:00"
    },
    {
      "id": "briefing",
      "status": "skipped",
      "note": "вопросов не потребовалось — оба пункта брифа решены самостоятельно (переиспользование готовых весовых полей из lib/port-breakdown.js + вторая карточка bl-split без дублирования кода)"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-09-11T09:44:25+03:00",
      "finishedAt": "2026-09-11T09:49:20+03:00"
    },
    {
      "id": "plan",
      "status": "skipped",
      "note": "ярус T0 — без разбивки на таски"
    },
    {
      "id": "build",
      "status": "active",
      "startedAt": "2026-09-11T09:49:20+03:00"
    },
    {
      "id": "review",
      "status": "pending"
    },
    {
      "id": "final",
      "status": "pending"
    }
  ],
  "requirements": {
    "total": 0,
    "done": 0,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [],
  "singlePass": null,
  "tests": null,
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [],
  "coverage": {
    "findings": 1,
    "acted": "Независимая проверка (бриф + спецификация, без манифеста) не нашла пропущенного и половинчатого. Один пункт «сверх брифа» — R01.1 (graceful-деградация отчёта, если весовых колонок нет) — законное углубление R01 (депс-проход по измерению «неверный ввод/сбой»), а не отдельное изобретение без родителя; оставлено как есть"
  },
  "concerns": [],
  "reviewers": {
    "manifestSpec": null,
    "craft": null
  },
  "blind": null
}
