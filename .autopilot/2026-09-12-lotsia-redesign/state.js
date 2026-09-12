window.STATE =
{
  "slug": "lotsia-redesign",
  "dir": "2026-09-12-lotsia-redesign",
  "title": "Редизайн сайта: вариант Б «Лоция»",
  "mode": "semi",
  "depth": "normal",
  "polish": null,
  "tier": "T1",
  "briefFile": "2026-09-12-brief.md",
  "memoryFile": "CLAUDE.md",
  "skillDir": "/Users/nasekomus/.claude/skills/autopilot",
  "startedAt": "2026-09-12T14:15:52+03:00",
  "updatedAt": "2026-09-12T15:31:22+03:00",
  "finishedAt": "2026-09-12T15:31:22+03:00",
  "stages": [
    {
      "id": "preflight",
      "status": "done",
      "startedAt": "2026-09-12T14:15:52+03:00",
      "finishedAt": "2026-09-12T14:18:05+03:00"
    },
    {
      "id": "manifest",
      "status": "done",
      "startedAt": "2026-09-12T14:18:05+03:00",
      "finishedAt": "2026-09-12T14:18:34+03:00"
    },
    {
      "id": "briefing",
      "status": "done",
      "startedAt": "2026-09-12T14:18:34+03:00",
      "finishedAt": "2026-09-12T14:25:14+03:00"
    },
    {
      "id": "spec",
      "status": "done",
      "startedAt": "2026-09-12T14:25:14+03:00",
      "finishedAt": "2026-09-12T14:37:39+03:00"
    },
    {
      "id": "plan",
      "status": "done",
      "startedAt": "2026-09-12T14:37:39+03:00",
      "note": "3 таска, ярус T1",
      "finishedAt": "2026-09-12T14:41:15+03:00"
    },
    {
      "id": "build",
      "status": "done",
      "startedAt": "2026-09-12T14:41:15+03:00",
      "note": "3 из 3 тасков готовы",
      "finishedAt": "2026-09-12T15:19:54+03:00"
    },
    {
      "id": "review",
      "status": "done",
      "startedAt": "2026-09-12T14:55:53+03:00",
      "note": "проверено 3 из 3",
      "finishedAt": "2026-09-12T15:19:54+03:00"
    },
    {
      "id": "final",
      "status": "done",
      "startedAt": "2026-09-12T15:19:54+03:00",
      "note": "слепая приёмка: всё реализовано",
      "finishedAt": "2026-09-12T15:31:22+03:00"
    }
  ],
  "requirements": {
    "total": 35,
    "done": 35,
    "inTicket": 0,
    "inSpec": 0,
    "placeholder": 0,
    "deferred": 0,
    "dropped": 0
  },
  "tickets": [
    {
      "id": "01",
      "title": "Каркас «Лоции»: шрифты, стили, панель, главная, образцовая страница склейки",
      "requirements": [
        "G01",
        "R01",
        "R02",
        "R03",
        "R04",
        "R05",
        "R06",
        "R06.1",
        "R07",
        "R08",
        "R09",
        "R10",
        "R11",
        "R12",
        "R13",
        "R14",
        "R16",
        "R17",
        "R18",
        "R19",
        "R20",
        "R21",
        "R22",
        "R23",
        "R24",
        "R25",
        "R26",
        "R27",
        "R28",
        "R29i",
        "R30i",
        "R31i",
        "R32i",
        "R33i"
      ],
      "blockedBy": [],
      "wave": 1,
      "zone": [
        "assets/",
        "tools.js",
        "index.html",
        "lib/",
        "merge/"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 1,
      "handoffs": 0,
      "startedAt": "2026-09-12T14:41:15+03:00",
      "repairFindings": [
        "файл, брошенный мимо зоны, открывается браузером; тесты countDataRows на колонки A/B и на совпадение со «Строк» склейки; одна граница колонок; общие стили дашбордов/полей не помечены удаляемыми и не перебивают .data-table; шрифт 16→17 px у вкладок/меню/описаний; строка про файлы сразу под полосой на узком экране"
      ],
      "finishedAt": "2026-09-12T15:06:26+03:00",
      "tests": {
        "passed": 197,
        "failed": 0
      },
      "commit": "8f342c0",
      "files": [
        "assets/fonts/",
        "assets/fonts.css",
        "assets/style.css",
        "assets/shell.js",
        "tools.js",
        "index.html",
        "lib/manifest-format.js",
        "lib/manifest-format.test.js",
        "merge/"
      ]
    },
    {
      "id": "02",
      "title": "Итоговый отчёт, два дашборда, реестр — на новом каркасе",
      "requirements": [
        "R01",
        "R02",
        "R07",
        "R08",
        "R09",
        "R15",
        "R16",
        "R21",
        "R22",
        "R23",
        "R24",
        "R25",
        "R26",
        "R29i",
        "R30i",
        "R33i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "grand-total/",
        "dashboard/",
        "dashboard-departure/",
        "bl-registry/"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "startedAt": "2026-09-12T15:06:26+03:00",
      "finishedAt": "2026-09-12T15:19:06+03:00",
      "tests": {
        "passed": 197,
        "failed": 0
      },
      "commit": "610f128",
      "files": [
        "grand-total/",
        "dashboard/",
        "dashboard-departure/",
        "bl-registry/"
      ]
    },
    {
      "id": "03",
      "title": "Две сверки и «Разделить коносаменты» — на новом каркасе",
      "requirements": [
        "R01",
        "R02",
        "R07",
        "R08",
        "R09",
        "R15",
        "R16",
        "R21",
        "R22",
        "R23",
        "R24",
        "R25",
        "R26",
        "R29i",
        "R30i",
        "R33i"
      ],
      "blockedBy": [
        "01"
      ],
      "wave": 2,
      "zone": [
        "dg-check/",
        "order-check/",
        "bl-split/"
      ],
      "status": "done",
      "retries": 0,
      "repairs": 0,
      "handoffs": 0,
      "startedAt": "2026-09-12T15:06:26+03:00",
      "finishedAt": "2026-09-12T15:17:30+03:00",
      "tests": {
        "passed": 197,
        "failed": 0
      },
      "commit": "c84a669",
      "files": [
        "dg-check/",
        "order-check/",
        "bl-split/"
      ]
    },
    {
      "id": "04",
      "title": "Мелочи после ревью: отступы в предупреждениях, пустая ячейка размера и ошибки архивов в сверке с поручениями, лишние правила CSS",
      "requirements": [
        "R16",
        "R23",
        "R26"
      ],
      "blockedBy": [
        "01",
        "02",
        "03"
      ],
      "wave": 3,
      "zone": [
        "assets/style.css",
        "order-check/",
        "grand-total/app.js"
      ],
      "status": "done",
      "startedAt": "2026-09-12T15:19:54+03:00",
      "retries": 0,
      "repairs": 1,
      "handoffs": 0,
      "finishedAt": "2026-09-12T15:27:06+03:00",
      "tests": {
        "passed": 197,
        "failed": 0
      },
      "commit": "020c1a1",
      "repairFindings": [
        "удалить мёртвый раздел стилей старых страниц"
      ],
      "files": [
        "assets/style.css",
        "order-check/app.js",
        "grand-total/app.js",
        "*/index.html (?v=)"
      ]
    }
  ],
  "singlePass": null,
  "tests": {
    "passed": 197,
    "failed": 0
  },
  "debt": {
    "placeholders": [],
    "assumptions": [],
    "emptyEnv": []
  },
  "additions": [
    "Подсказка под списком файлов склейки: «Порядок файлов — порядок строк в общем файле. Перетащите строку…» — ради R08 (иначе перестановка файлов не видна)"
  ],
  "coverage": {
    "findings": 10,
    "missing": 4,
    "half": 6,
    "notInBrief": 17,
    "resolved": "4 пропуска: строка «файлы не покидают компьютер» перенесена в шапку панели; файлы шрифта лежат в assets/fonts/ + встроены в fonts.css; шаг 2 называется «Параметры» везде, где параметры есть, отступление для 4 инструментов без параметров записано; «все инструменты» — все инструменты вкладки, объяснено. 6 недоописанных: плитки обеих сверок по полям summary, счёт страниц (9, не 10), тексты полосы для не-манифестов, одна главная кнопка после результата, JetBrains Mono для номеров и кодов. 17 «нет в брифе» — детали макета Б и углубления R##.n, привязаны"
  },
  "concerns": [
    "[report] T01 spec · dg-check/core.js:17, grand-total/core.js:8, order-check/core.js:18, bl-registry/core.js:18, bl-registry/app.js:7 — импорт lib/manifest-format.js со старым ?v= (§8); поднять в тасках 02/03",
    "[report] T01 spec · merge/index.html:25 — лишняя подсказка #order-hint про перетаскивание (нет в спеке и на макете) — назвать в отчёте или убрать",
    "[report — повторяется в 3 тасках, но это решение спецификации: переиспользовать прочитанную книгу опасно, сверки меняют её на месте] T01 craft · merge/app.js — каждая книга разбирается ExcelJS дважды (подсчёт строк и запуск); по спеке запуск читает файлы заново — принято, не исправляется",
    "[report] T01 craft · merge/app.js — плитки, строки списка и перетаскивание строятся в app.js, 7 страниц копируют фрагмент (как принятое в проекте дублирование DOM-слоя)",
    "[report] T01 craft · index.html:43-48 / assets/shell.js:31,113-118 — главная повторяет помощник el, список вкладок и отбор по вкладке",
    "[report] T01 craft · assets/shell.js:33 / assets/style.css:277 — граница узкого окна записана в двух местах",
    "[fixed → таск 04, 020c1a1] T01 craft · assets/style.css:844,808 — дубли глобальных [hidden] и .mono",
    "[fixed → таск 04, 020c1a1] T03 · assets/style.css — у <p>/<ul> внутри .warning-message на страницах .app стандартные отступы браузера (правило #warnings-box ul действует только на .page) — нужно общее правило",
    "[report] T03 · order-check/app.js — размер поручения из архива берётся из внутреннего поля JSZip _data.uncompressedSize; нет поля — размер не показывается",
    "[report] T03 · bl-split/app.js — таблица результата показывается только после сборки архива (раньше — до); при сбое сборки — только ошибка",
    "[report] T02 · grand-total/app.js — плитка «Контейнеров» — сумма «Кол-во» по типам (как в §5); может отличаться от числа уникальных, если контейнер попал в две группы",
    "[report] T02 · grand-total/app.js — правка полей «Данные судна» не прячет готовый результат (читаются при скачивании, как раньше)",
    "[fixed → таск 04, 020c1a1] T03 craft · order-check/app.js:118 — при неизвестном размере записи из архива остаётся пустой .file-list__meta",
    "[fixed → таск 04, 020c1a1] T03 craft · order-check/app.js:206 — ошибки нескольких архивов склеены через \\n и в .error-message схлопываются в одну строку",
    "[report] T03 craft · dg-check/app.js:77-115, order-check/app.js:84-126 — строка списка файлов в двух сверках построена разными функциями (renderFileRow/fileRow), очистка списка продублирована",
    "[report] T03 craft · dg-check/app.js:195-216, order-check/app.js:233-264 — setupDropzone с двумя разными сигнатурами",
    "[report] T03 spec · bl-split — при сбое сборки zip таблица коносаментов и предупреждения больше не показываются вместе с ошибкой; новые подписи «Расхождения по категориям», «Предупреждения:»",
    "[report] T02 craft · dashboard/app.js:258, grand-total/app.js:241, merge/app.js:251 — плитка веса в трёх форматах (целые кг «общий вес, кг» на дашбордах vs «… KGS» с тремя знаками) — должен быть один формат",
    "[fixed → таск 04, 020c1a1] T02 craft · grand-total/app.js:289-292 — «Коносаментов» и плиткой, и строкой «Feeder Bill of Lading - N sets» (предпросмотр строки PDF) — отметить комментарием",
    "[fixed → CLAUDE.md] T02 craft · interfaces/образец — правило «смена параметра прячет результат» не относится к полям, которые читаются при скачивании (Данные судна) — записать в память проекта",
    "[report — повторяется в 3 тасках, но это решение спецификации: переиспользовать прочитанную книгу опасно, сверки меняют её на месте] Все 8 страниц: каждая книга разбирается ExcelJS дважды (подсчёт строк при добавлении и запуск) — цена образца, принято спецификацией",
    "[report] T04 craft · order-check/app.js — showError теперь принимает массив и отличается от остальных 8 страниц"
  ],
  "reviewers": {
    "manifestSpec": "afccb79705a6c62ef",
    "craft": "a1fcaf789dc0e9c23"
  },
  "blind": {
    "verdict": "все требования брифа реализованы, расхождений с манифестом нет",
    "ran": "дев-сервер manifest-tools; npm test 197/197; главная по file:// в headless Chrome; сценарии: склейка, Итоговый отчёт (PDF+Excel, строка «40'HC empty»), дашборд — до скачивания",
    "drift": [],
    "notes": [
      "на узком экране под заголовком главной остаётся «Слева все инструменты вкладки», хотя панель там сверху"
    ]
  }
}
