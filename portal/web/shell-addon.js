// Дополнение к assets/shell.js для портала (tallyman.nasekomuspro.ru).
//
// Сервер отдаёт /assets/shell.js как assets/shell.js + этот файл, так что код
// выполняется сразу после того, как старый каркас нарисовал панель и выставил
// window.Shell, и до app.js страницы. Старые файлы сайта не правятся, страницы
// ничего о портале не знают.
//
// Что делает:
//   1. Бренд панели — логотип Tallyman, подпись под ним убирается; тема страницы
//      запоминается в localStorage для страниц без входа.
//   2. Полоса сверху: «Журнал», для администраторов «Пользователи» со счётчиком
//      открытых запросов, плашка с именем (ведёт в профиль) и «Выйти».
//      Переключатель вкладок и список инструментов собираются в выпадающую
//      панель .portal-menu под кнопкой «Инструменты» (вид — portal/web/theme.css).
//   3. Под описанием страницы — ссылка «Как это работает и пример файла».
//   4. Журнал: показанный результат и скачивание по кнопке результата уходят
//      в POST /api/journal — только ключ инструмента, имена файлов и текст
//      итога. Сами файлы на сервер не отправляются никогда.
//
// Свои элементы создаются с атрибутом hidden: старое правило
// [hidden]{display:none!important} прячет их на печати, а theme.css (весь
// внутри @media screen) показывает на экране — печать остаётся как на старом сайте.
//
// Обычный скрипт без import/export, как и сам shell.js.
(function () {
  'use strict';

  var MAX_FILES = 50; // столько имён принимает сервер (routes-journal.js)

  // ── Чистые помощники журнала (проверяются в shell-addon.test.js) ─────────

  // «<значение> <подпись строчными>» по каждой плитке через « · »:
  // [{value:'3', label:'Файлов'}, {value:'455', label:'Строк'}] → «3 файлов · 455 строк»
  function journalSummary(tiles) {
    return tiles
      .map(function (tile) {
        var value = String(tile.value || '').trim();
        var label = String(tile.label || '').trim().toLowerCase();
        return [value, label].filter(Boolean).join(' ');
      })
      .filter(Boolean)
      .join(' · ');
  }

  // Имена без пустых; больше MAX_FILES — первые MAX_FILES-1 и «… и ещё N».
  function journalFiles(names) {
    var list = names
      .map(function (name) {
        return String(name || '').trim();
      })
      .filter(Boolean);
    if (list.length <= MAX_FILES) return list;
    var shown = list.slice(0, MAX_FILES - 1);
    shown.push('… и ещё ' + (list.length - shown.length));
    return shown;
  }

  // Журнал результатов одной открытой страницы.
  // Запись — только при переходе «скрыт → показан»: повторный показ без
  // скрытия ничего не пишет. И не повторяется, если результат тот же, что
  // уже записан (те же файлы и тот же итог): каждая страница перед запуском
  // сама прячет прошлый результат, так что «нажать запуск ещё раз без смены
  // файлов» — тоже «скрыт → показан», и без этой проверки журнал двоился бы.
  //   send({kind, files, summary}) — отправить запись
  //   read() -> {files, summary}    — что сейчас на странице
  function createJournal(send, read) {
    var shown = false;
    var lastLogged = null;

    function resultShown(isShown) {
      var wasShown = shown;
      shown = Boolean(isShown);
      if (!shown || wasShown) return;
      var now = read();
      var signature = JSON.stringify([now.files, now.summary]);
      if (signature === lastLogged) return;
      lastLogged = signature;
      send({ kind: 'result', files: now.files, summary: now.summary });
    }

    // Скачивание пишется не по самому щелчку по кнопке, а когда страница
    // действительно отдала файл (щёлкнула по ссылке <a download>): кнопка может
    // и отказать — «Скачать PDF» без позывного и даты в Итоговом отчёте
    // показывает ошибку, и запись «скачал» была бы неправдой. Подпись записи —
    // текст нажатой кнопки. Щелчок по другой кнопке или ссылке до появления
    // файла отменяет ожидание: тот файл уже не от этой кнопки.
    var pendingLabel = null;

    function downloadRequested(label) {
      pendingLabel = String(label || '').trim();
    }

    function otherClick() {
      pendingLabel = null;
    }

    function fileSaved() {
      if (pendingLabel === null) return;
      var label = pendingLabel;
      pendingLabel = null;
      send({ kind: 'download', files: read().files, summary: label });
    }

    return {
      resultShown: resultShown,
      downloadRequested: downloadRequested,
      otherClick: otherClick,
      fileSaved: fileSaved,
    };
  }

  window.PortalAddon = {
    journalSummary: journalSummary,
    journalFiles: journalFiles,
    createJournal: createJournal,
  };

  // ── Страница ────────────────────────────────────────────────────────────

  var doc = window.document;
  var shell = window.Shell;

  // Тему ставит сервер (<html data-theme>); запоминаем её в браузере — страницы без
  // входа (вход, приглашение) покажут ту же тему, хотя сервер там человека не знает
  try {
    var theme = doc.documentElement.getAttribute('data-theme');
    if (theme) window.localStorage.setItem('manifest-tools:theme', theme);
  } catch (e) {
    // без хранилища (приватный режим) — просто без памяти
  }

  // Ключ инструмента — первый сегмент адреса: /grand-total-import/ → grand-total-import
  var toolKey = String(window.location.pathname || '').split('/').filter(Boolean)[0] || '';
  if (/\.html?$/i.test(toolKey)) toolKey = '';

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function postJson(path, body) {
    return window.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      keepalive: true,
    });
  }

  // 1–2. Полоса сверху
  var side = doc.getElementById('app-side');
  if (side) {
    var brand = side.querySelector('.side__brand');
    if (brand) {
      brand.textContent = '';
      brand.setAttribute('aria-label', 'Tallyman — на главную');
      // Кран вместо T рисует CSS (маска logo-t.svg цветами темы) — см. .tm-logo__t в theme.css
      var logo = el('span', 'tm-logo');
      logo.appendChild(el('span', 'tm-logo__t'));
      logo.appendChild(el('span', 'tm-logo__rest', 'allyman'));
      brand.appendChild(logo);
    }

    // Значок вкладки: на страницах инструментов своего нет — ставим портальный
    if (!doc.querySelector('link[rel~="icon"]')) {
      var icon = doc.createElement('link');
      icon.rel = 'icon';
      icon.type = 'image/svg+xml';
      icon.href = '/portal/favicon.svg';
      doc.head.appendChild(icon);
    }

    var menuBtn = side.querySelector('.side__menu-btn');
    var tabs = side.querySelector('.side__tabs');
    var nav = side.querySelector('.side__nav');
    if (menuBtn && (tabs || nav)) {
      var menu = el('div', 'portal-menu');
      menu.id = 'portal-menu';
      menu.hidden = true;
      if (tabs) menu.appendChild(tabs);
      if (nav) menu.appendChild(nav);
      menuBtn.setAttribute('aria-controls', menu.id);
      menuBtn.parentNode.insertBefore(menu, menuBtn.nextSibling);

      // Щелчок мимо панели закрывает её (Escape закрывает сам shell.js) — так
      // же, как setMenuOpen(false) в shell.js; не через menuBtn.click(), чтобы
      // лишний щелчок не сбил ожидание скачивания в журнале (см. ниже)
      doc.addEventListener('click', function (event) {
        if (!side.classList.contains('is-open') || side.contains(event.target)) return;
        side.classList.remove('is-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    }

    var bar = el('nav', 'portal-bar');
    bar.hidden = true;
    bar.setAttribute('aria-label', 'Портал');
    var journalLink = el('a', 'portal-bar__link', 'Журнал');
    journalLink.href = '/journal';
    var logout = el('button', 'portal-bar__link', 'Выйти');
    logout.type = 'button';
    logout.addEventListener('click', function () {
      logout.disabled = true;
      postJson('/api/logout', {})
        .catch(function () {})
        .then(function () {
          window.location.href = '/login';
        });
    });
    bar.appendChild(journalLink);
    bar.appendChild(logout);
    side.appendChild(bar);

    window
      .fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (me) {
        if (!me || !me.user) return;
        if (me.user.isAdmin) {
          var users = el('a', 'portal-bar__link', 'Пользователи');
          users.href = '/admin/users';
          var open = Number(me.openRequests) || 0;
          if (open > 0) {
            var count = el('span', 'portal-bar__count', String(open));
            count.setAttribute('aria-hidden', 'true');
            users.appendChild(count);
            users.setAttribute('aria-label', 'Пользователи, открытых запросов: ' + open);
          }
          bar.insertBefore(users, logout);
        }
        var person = el('a', 'portal-bar__user', me.user.name || me.user.email || 'Профиль');
        person.href = '/account';
        person.title = 'Мой профиль';
        bar.insertBefore(person, logout);
      })
      .catch(function () {});
  }

  // 3. Ссылка на справку
  var subtitle = doc.querySelector('.page__subtitle');
  if (subtitle && toolKey) {
    var help = el('p', 'portal-help');
    help.hidden = true;
    var helpLink = el('a', null, 'Как это работает и пример файла');
    helpLink.href = '/help/' + encodeURIComponent(toolKey);
    help.appendChild(helpLink);
    subtitle.parentNode.insertBefore(help, subtitle.nextSibling);
  }

  // 4. Журнал
  if (!shell || typeof shell.setResultShown !== 'function' || !toolKey) return;

  function textOf(root, selector) {
    var node = root.querySelector(selector);
    return node ? node.textContent : '';
  }

  function readPage() {
    // Список готовых файлов (file-list--results в «Файлах для АРМ») — это
    // результат, а не загруженные файлы
    var names = Array.prototype.map.call(
      doc.querySelectorAll('.file-list__name'),
      function (node) {
        return node.closest && node.closest('.file-list--results') ? '' : node.textContent;
      }
    );
    var tiles = Array.prototype.map.call(doc.querySelectorAll('.result__head .stat'), function (stat) {
      return { value: textOf(stat, '.stat__value'), label: textOf(stat, '.stat__label') };
    });
    return { files: journalFiles(names), summary: journalSummary(tiles) };
  }

  var journal = createJournal(function (entry) {
    postJson('/api/journal', {
      tool: toolKey,
      kind: entry.kind,
      files: entry.files,
      summary: entry.summary,
    }).catch(function () {});
  }, readPage);

  var originalSetResultShown = shell.setResultShown;
  shell.setResultShown = function (shownNow) {
    var result = originalSetResultShown.apply(this, arguments);
    try {
      journal.resultShown(shownNow);
    } catch (e) {
      // журнал — не повод ломать страницу
    }
    return result;
  };

  // Перехват на погружении, до обработчика самой кнопки: «Скачать PDF» в
  // Итоговом отчёте сразу выключается и пишет «Собираю PDF…» — на всплытии
  // подпись была бы уже не та. Ссылку <a download> все страницы перед щелчком
  // кладут в document.body, так что её щелчок тоже доходит сюда.
  doc.addEventListener(
    'click',
    function (event) {
      var target = event.target;
      if (!target || !target.closest) return;
      try {
        var button = target.closest('.result__actions .btn');
        if (button) journal.downloadRequested(button.textContent);
        else if (target.closest('a[download]')) journal.fileSaved();
        else if (target.closest('button, a')) journal.otherClick();
      } catch (e) {
        // журнал — не повод ломать страницу
      }
    },
    true
  );
})();
