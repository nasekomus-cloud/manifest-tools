window.STATE =
{
  "slug": "order-template-check",
  "dir": "2026-09-12-order-template-check",
  "title": "Проверка шаблона эл. поручения по поручению",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T1",
  "briefFile": "2026-09-12-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-12T22:39:57+03:00",
  "updatedAt": "2026-09-13T02:25:38+03:00",
  "finishedAt": "2026-09-13T02:25:38+03:00",
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-09-12T22:39:57+03:00",
      "finishedAt": "2026-09-12T22:40:57+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-09-12T22:40:57+03:00",
      "finishedAt": "2026-09-12T22:49:05+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-09-12T22:49:05+03:00",
      "finishedAt": "2026-09-12T23:16:33+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-09-12T23:16:33+03:00",
      "finishedAt": "2026-09-12T23:50:14+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-09-12T23:50:14+03:00",
      "note": "3 таска, ярус T1",
      "finishedAt": "2026-09-12T23:56:00+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-09-12T23:56:00+03:00",
      "note": "3 из 3 тасков готовы",
      "finishedAt": "2026-09-13T02:05:30+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-09-13T00:16:21+03:00",
      "note": "проверено 3 из 3",
      "finishedAt": "2026-09-13T02:25:38+03:00"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-09-13T02:05:30+03:00",
      "note": "слепая приёмка: всё реализовано, расхождений нет",
      "finishedAt": "2026-09-13T02:25:38+03:00"
    }
  ],
  "requirements": {
    "total": 21,
    "done": 21,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Общий разбор поручения, «Сверить с поручениями» на нём",
      "requirements": [
        "R18i",
        "R04"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "lib/",
        "order-check/"
      ],
      "status": "done",
      "startedAt": "2026-09-12T23:56:00+03:00",
      "finishedAt": "2026-09-13T00:25:44+03:00",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "files": ["lib/loading-order.js", "lib/loading-order.test.js", "lib/xlsx-safe-write.js", "order-check/core.js", "order-check/app.js", "order-check/index.html"],
      "tests": { "passed": 208, "failed": 0 },
      "commit": "2761073",
      "concerns": ["D01: поведение «Сверить с поручениями» на нестандартных файлах изменилось (исправление)"]
    },
    {
      "id": "02",
      "title": "Проверка шаблона: форма, сверка с поручением и три результата",
      "requirements": [
        "R04",
        "R05",
        "R06",
        "R07",
        "R08",
        "R09",
        "R11",
        "R12",
        "R13",
        "R14",
        "R15i",
        "R16i",
        "G01",
        "G02",
        "A01",
        "A02",
        "A03",
        "A04",
        "A05",
        "A06",
        "A07"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "template-check/core.js",
        "template-check/template-form.js",
        "template-check/*.test.js"
      ],
      "status": "done",
      "startedAt": "2026-09-13T00:25:44+03:00",
      "finishedAt": "2026-09-13T01:27:53+03:00",
      "retries": 0,
      "repairs": 1,
      "repairFindings": ["spec: правило «строка «итого»» шире §4.4 — auto-удаляет строку с меткой Итого/Всего/Total вне K–O вместо «уточнить у заказчика»"],
      "handoffs": 0,
      "files": ["template-check/core.js", "template-check/core.test.js", "template-check/template-form.js", "template-check/template-form.test.js"],
      "tests": { "passed": 265, "failed": 0 },
      "commit": "123b5a6",
      "concerns": [
        "trim() перед сравнением подписи/заголовка на точность — не ловит пробелы по краям (Wrong, не блокирует)",
        "KEEP_AS_IS_KEYS: arrivalDate/departureDate недостижимы кодом",
        "core.js — 1253 строки одним файлом, заметка на будущее"
      ]
    },
    {
      "id": "03",
      "title": "Страница «Проверить шаблон», первая во вкладке «Экспорт»",
      "requirements": [
        "R01",
        "R02",
        "R03",
        "R10",
        "R11",
        "R12",
        "R14",
        "R15i",
        "R17i",
        "R09"
      ],
      "blockedBy": [
        "02"
      ],
      "wave": 3,
      "zone": [
        "template-check/index.html",
        "template-check/app.js",
        "tools.js",
        "assets/shell.js",
        "*/index.html (?v=)"
      ],
      "status": "done",
      "startedAt": "2026-09-13T01:27:53+03:00",
      "finishedAt": "2026-09-13T02:05:30+03:00",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "files": ["template-check/index.html", "template-check/app.js", "tools.js", "assets/shell.js", "index.html", "merge/index.html", "dg-check/index.html", "dashboard/index.html", "dashboard-departure/index.html", "bl-split/index.html", "grand-total/index.html", "order-check/index.html", "bl-registry/index.html"],
      "tests": { "passed": 265, "failed": 0 },
      "commit": "3aba5d6",
      "concerns": []
    }
  ],
  "singlePass": null,
  "tests": { "passed": 265, "failed": 0 },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [
    "A01 → R04: предупреждения о подозрительных датах (согласовано на брифинге)",
    "A02 → R11: примечания Excel в отмеченных ячейках",
    "A03 → R04: предупреждение, если имя стороны коносамента не нашлось в поручении",
    "A04 → R05: предупреждение о не двухсимвольном коде упаковки",
    "A05 → R05: предупреждение о рефконтейнере без температуры",
    "A06 → R04: предупреждение о заполненной W без опасного груза в поручении",
    "A07 → R05: предупреждение о разных общих полях у строк одного коносамента"
  ],
  "coverage": {
    "findings": 6,
    "missing": 4,
    "half": 2,
    "notInBrief": "~17 пунктов",
    "actions": [
      "места: ячейка K больше не меняется в исправленном шаблоне ни значением, ни видом; расхождение у контейнера с несколькими товарами — предупреждение (образец 2 верен)",
      "даты: C/E3/E4 не меняются в исправленном шаблоне; любая находка по датам — «уточнить у заказчика»",
      "несравниваемые с поручением поля (H, E5/E6/F, Q/S/U, X, Y) — оставлены во «Вне рамок» с причиной; R04 помечен как частично отложенный",
      "имена сторон и W без опасности в поручении — оставлены предупреждениями, причина дописана в spec",
      "дописана таблица «ячейка находки» (§5.5) и таблица вида значений по колонкам (§4.5)",
      "сверх брифа: добавления помечены A01–A07; H больше не подставляется из поручения; пробелы по краям в исправленном шаблоне не трогаются"
    ]
  },
  "concerns": [
    "lib/loading-order.js:130 — остановка на «Дополнительные сведения» меняет результат «Сверить с поручениями» на нестандартных файлах; принято как исправление (D01), в CLAUDE.md записать как поведение",
    "lib/loading-order.test.js:20 — приманка «Номер поручения (Э)» стоит после настоящей подписи и защиту от неточного совпадения не проверяет; поставить её раньше в порядке обхода",
    "lib/loading-order.js:8,197-198 — форма order описана ссылкой на .autopilot/…--wip/, которая сломается при закрытии прогона; описать поля в JSDoc модуля или CLAUDE.md",
    "CLAUDE.md — «Структура» и «Подводные камни» ещё говорят, что разбор поручения и dropUnwritableConditionalFormatting живут в order-check/core.js, тестов 197; обновить в Phase 8",
    "template-check/core.js — сравнение подписи шапки/заголовка на точность идёт после trim(): пробелы по краям («СУДНО » и т.п.) не ловятся как «неточный заголовок», хотя spec §3 требует сравнения как есть (Wrong, не блокирует — в присланных парах не встречается; нет и теста на этот случай)",
    "template-check/core.js:36-37 KEEP_AS_IS_KEYS — 'arrivalDate'/'departureDate' недостижимы кодом (checkRow не читает HEADER_FIELDS); убрать или подключить, если появится реальный путь",
    "template-check/core.js — 1253 строки одним файлом, кандидат на Divergent change при дальнейшем росте (заметка на будущее)"
  ],
  "reviewers": {
    "manifestSpec": "af89a538ced0b31ce",
    "craft": "ad254f5c887029d8c"
  },
  "blind": {
    "checkedAt": "2026-09-13T02:25:07+03:00",
    "agreed": true,
    "drift": [],
    "ranScenario": true,
    "notes": "все пункты брифа и все 4 «Дополнения» подтверждены живым прогоном на обеих настоящих парах и на 5 намеренно испорченных копиях (Chromium, дев-сервер 8000); расхождений с manifest.md не найдено",
    "commands": [
      "npm install",
      "npm test → 265 passed, 0 failed",
      "python3 -m http.server 8000 (launch.json: manifest-tools)"
    ]
  }
}
