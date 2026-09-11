window.STATE =
{
  "slug": "merge-weights-blsplit-export",
  "dir": "2026-09-11-merge-weights-blsplit-export",
  "title": "Вес в отчёте склейки + «Разделение коносаментов» во вкладке «Экспорт»",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T0",
  "briefFile": "2026-09-11-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-11T09:39:49+03:00",
  "updatedAt": "2026-09-11T10:03:42+03:00",
  "finishedAt": "2026-09-11T10:03:42+03:00",
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
      "status": "done",
      "startedAt": "2026-09-11T09:49:20+03:00",
      "finishedAt": "2026-09-11T09:59:27+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-09-11T09:58:00+03:00",
      "finishedAt": "2026-09-11T09:59:27+03:00",
      "note": "T0 — все три оси сам, инлайн; один некритичный concern (см. concerns)"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-09-11T09:59:27+03:00",
      "finishedAt": "2026-09-11T10:03:42+03:00"
    }
  ],
  "requirements": {
    "total": 3,
    "done": 3,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [],
  "singlePass": {
    "files": [
      "merge/core.js",
      "merge/app.js",
      "merge/core.test.js",
      "merge/index.html",
      "tools.js",
      "index.html"
    ],
    "tests": "npm test → 177 passed, 0 failed (было 175, +2 новых теста на вес)",
    "commit": "fe5664d",
    "startedAt": "2026-09-11T09:49:20+03:00",
    "finishedAt": "2026-09-11T09:59:27+03:00"
  },
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
  "concerns": [
    {
      "axis": "craft",
      "file": "merge/app.js:13",
      "note": "formatWeight скопирован из grand-total/app.js — та же осознанная развязка DOM-слоя, что уже принята для dashboard/dashboard-departure (см. spec.md, Решения). Триаж в Phase 8: drop — это не дефект, а уже принятая на сайте конвенция"
    }
  ],
  "reviewers": {
    "manifestSpec": null,
    "craft": null
  },
  "blind": {
    "drift": [],
    "note": "Независимая проверка (бриф + запущенный репозиторий, без .autopilot/) прогнала оба сценария напрямую — mergeManifests на сгенерированных книгах ExcelJS (с весовыми колонками и без) и обе вкладки главной страницы через http.server — и подтвердила оба требования как «реализовано», расхождений с манифестом не найдено"
  }
}
