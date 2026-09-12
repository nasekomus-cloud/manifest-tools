// Общий каркас «Лоции»: боковая панель, переключатель «Экспорт / Импорт»,
// мобильное меню, крошки, шаги 1-2-3 и полоса действия.
//
// Обычный скрипт (без import/export), как tools.js: главная должна открываться
// двойным кликом (file://). Подключается после tools.js и до app.js страницы,
// в конце <body> — к этому моменту разметка страницы уже есть.
//
// Разметка, которую читает скрипт:
//   <body class="app">
//     <aside class="app__side" id="app-side"></aside>   — пустой, панель рисуется здесь
//     <main class="app__main">                            — сюда в начало ставятся крошки
//       <ol class="steps" id="steps"><li>Файлы</li>…</ol>  — только на страницах инструментов
//       <div class="action-bar" id="action-bar">
//         <p class="action-bar__info" id="action-info"></p>
//         <span class="action-bar__hint" id="action-hint"></span>
//         <button class="btn" id="…">…</button>            — кнопка запуска инструмента
//       </div>
//   На главной ещё — блоки с атрибутом data-tab-panel="export|import": их прячет
//   и показывает переключатель вкладок.
//
// Выставляет window.Shell:
//   plural(n, one, few, many) -> string   — только слово: plural(3, 'строка', 'строки', 'строк') === 'строки'
//   setStep(n: 1|2|3)
//   setAction({info: string, hint: string|null})
//   setResultShown(shown: boolean)
//   formatSize(bytes) -> string            — «840 Б», «84 КБ», «12,4 МБ»
(function () {
  'use strict';

  var TAB_KEY = 'manifest-tools:tab';
  var CATEGORIES = ['export', 'import'];
  var TAB_LABELS = { export: 'Экспорт', import: 'Импорт' };
  var NARROW_QUERY = '(max-width: 899.98px)';
  var NBSP = '\u00A0';

  var tools = window.TOOLS || [];

  // ── Где лежит сайт и какая это страница ─────────────────────────────────
  // Корень сайта — папка над assets/, вычисленная от собственного src скрипта:
  // так одинаково работает и https://…/manifest-tools/, и корень домена, и file://.

  var ownScript = document.currentScript;
  var rootUrl = ownScript && ownScript.src
    ? new URL('../', ownScript.src)
    : new URL('./', window.location.href);

  // «/merge/» и «/merge/index.html» — одна и та же страница.
  function pagePath(url) {
    var path = url.pathname.replace(/index\.html$/, '');
    if (path.charAt(path.length - 1) !== '/') path += '/';
    try {
      path = decodeURIComponent(path);
    } catch (e) {
      // оставляем как есть — сравнение всё равно идёт по одинаково закодированным путям
    }
    return path;
  }

  function toolUrl(tool) {
    return new URL(tool.href, rootUrl).href;
  }

  var homeUrl = new URL('index.html', rootUrl).href;
  var herePath = pagePath(new URL(window.location.href));
  var isHome = herePath === pagePath(rootUrl);

  var currentTools = tools.filter(function (tool) {
    return pagePath(new URL(tool.href, rootUrl)) === herePath;
  });
  var currentTool = currentTools[0] || null;

  // ── Вкладка ─────────────────────────────────────────────────────────────

  function readStoredTab() {
    try {
      var value = window.localStorage.getItem(TAB_KEY);
      return CATEGORIES.indexOf(value) !== -1 ? value : null;
    } catch (e) {
      return null;
    }
  }

  function storeTab(tab) {
    try {
      window.localStorage.setItem(TAB_KEY, tab);
    } catch (e) {
      // хранилище недоступно (приватный режим, запрет сайта) — просто не помним
    }
  }

  function toolCategories() {
    return currentTools.map(function (tool) {
      return tool.category;
    });
  }

  // На странице инструмента — вкладка, где этот инструмент есть; если он есть
  // в обеих («Разделить коносаменты») — запомненная.
  function resolveInitialTab() {
    var stored = readStoredTab();
    if (currentTools.length) {
      var categories = toolCategories();
      return stored && categories.indexOf(stored) !== -1 ? stored : categories[0];
    }
    return stored || 'export';
  }

  var activeTab = resolveInitialTab();
  if (currentTools.length) storeTab(activeTab);

  // ── Мелкие помощники ────────────────────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function plural(n, one, few, many) {
    var abs = Math.abs(Math.trunc(Number(n) || 0));
    var lastTwo = abs % 100;
    var last = abs % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function formatSize(bytes) {
    var size = Number(bytes) || 0;
    if (size < 1024) return size + NBSP + 'Б';
    var kb = size / 1024;
    if (kb < 1024) return Math.round(kb) + NBSP + 'КБ';
    var mb = kb / 1024;
    return mb.toFixed(1).replace('.', ',') + NBSP + 'МБ';
  }

  // ── Панель ──────────────────────────────────────────────────────────────

  var side = document.getElementById('app-side');
  var main = document.querySelector('.app__main');
  var tabButtons = {};
  var navList = null;
  var navPanel = null;
  var menuBtn = null;
  var crumbCategory = null;

  function renderNav() {
    navList.textContent = '';
    tools
      .filter(function (tool) {
        return tool.category === activeTab;
      })
      .forEach(function (tool) {
        var item = el('li');
        var link = el('a', 'side__link');
        link.href = toolUrl(tool);
        if (currentTool && tool.href === currentTool.href) {
          link.setAttribute('aria-current', 'page');
        }
        link.appendChild(el('span', 'side__name', tool.navTitle || tool.title));
        if (tool.output) link.appendChild(el('span', 'side__fmt', tool.output));
        item.appendChild(link);
        navList.appendChild(item);
      });
    navPanel.setAttribute('aria-labelledby', tabButtons[activeTab].id);
  }

  function setMenuOpen(open) {
    if (!menuBtn) return;
    side.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  }

  function selectTab(tab, options) {
    activeTab = tab;
    CATEGORIES.forEach(function (key) {
      var selected = key === tab;
      tabButtons[key].setAttribute('aria-selected', String(selected));
      tabButtons[key].tabIndex = selected ? 0 : -1;
    });
    renderNav();

    // Главная: переключатель ведёт и маршрут с карточками справа.
    var panels = document.querySelectorAll('[data-tab-panel]');
    Array.prototype.forEach.call(panels, function (panel) {
      panel.hidden = panel.getAttribute('data-tab-panel') !== tab;
    });

    // Крошка вкладки меняется, только если текущий инструмент есть в новой вкладке.
    if (crumbCategory && (isHome || toolCategories().indexOf(tab) !== -1)) {
      crumbCategory.textContent = TAB_LABELS[tab];
    }

    if (options && options.store) storeTab(tab);
  }

  function renderSide() {
    var brand = el('a', 'side__brand', 'Судовые манифесты');
    brand.href = homeUrl;
    brand.appendChild(el('span', 'side__brand-sub', 'набор инструментов'));

    menuBtn = el('button', 'side__menu-btn', 'Инструменты');
    menuBtn.type = 'button';
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-controls', 'side-nav');

    var safe = el('p', 'side__safe', 'Файлы обрабатываются на этом компьютере и никуда не отправляются');

    var tablist = el('div', 'side__tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Вкладки инструментов');
    CATEGORIES.forEach(function (key) {
      var button = el('button', 'side__tab', TAB_LABELS[key]);
      button.type = 'button';
      button.id = 'side-tab-' + key;
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'side-panel');
      button.addEventListener('click', function () {
        selectTab(key, { store: true });
        if (!isHome && window.matchMedia(NARROW_QUERY).matches) setMenuOpen(true);
      });
      tabButtons[key] = button;
      tablist.appendChild(button);
    });

    // Стрелки влево/вправо, Home/End — как у обычных вкладок.
    tablist.addEventListener('keydown', function (event) {
      var index = CATEGORIES.indexOf(activeTab);
      var next = null;
      if (event.key === 'ArrowRight') next = CATEGORIES[(index + 1) % CATEGORIES.length];
      else if (event.key === 'ArrowLeft') next = CATEGORIES[(index - 1 + CATEGORIES.length) % CATEGORIES.length];
      else if (event.key === 'Home') next = CATEGORIES[0];
      else if (event.key === 'End') next = CATEGORIES[CATEGORIES.length - 1];
      if (!next) return;
      event.preventDefault();
      selectTab(next, { store: true });
      tabButtons[next].focus();
    });

    var nav = el('nav', 'side__nav');
    nav.id = 'side-nav';
    nav.setAttribute('aria-label', 'Инструменты');
    navPanel = el('div', 'side__panel');
    navPanel.id = 'side-panel';
    navPanel.setAttribute('role', 'tabpanel');
    navList = el('ul', 'side__list');
    navPanel.appendChild(navList);
    nav.appendChild(navPanel);

    menuBtn.addEventListener('click', function () {
      setMenuOpen(!side.classList.contains('is-open'));
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && side.classList.contains('is-open')) {
        setMenuOpen(false);
        menuBtn.focus();
      }
    });

    side.textContent = '';
    side.appendChild(brand);
    side.appendChild(menuBtn);
    side.appendChild(safe);
    side.appendChild(tablist);
    side.appendChild(nav);
  }

  // ── Крошки ──────────────────────────────────────────────────────────────

  function renderCrumbs() {
    var crumbs = el('nav', 'crumbs');
    crumbs.setAttribute('aria-label', 'Вы здесь');

    if (isHome || !currentTool) {
      crumbCategory = el('span', null, TAB_LABELS[activeTab]);
      crumbs.appendChild(crumbCategory);
    } else {
      crumbCategory = el('a', null, TAB_LABELS[activeTab]);
      crumbCategory.href = homeUrl;
      crumbs.appendChild(crumbCategory);
      var separator = el('span', null, '/');
      separator.setAttribute('aria-hidden', 'true');
      crumbs.appendChild(separator);
      var current = el('span', null, currentTool.title);
      current.setAttribute('aria-current', 'page');
      crumbs.appendChild(current);
    }

    main.insertBefore(crumbs, main.firstChild);
  }

  // ── Шаги ────────────────────────────────────────────────────────────────

  var stepsEl = document.getElementById('steps');
  var stepItems = [];

  function prepareSteps() {
    stepItems = Array.prototype.slice.call(stepsEl.children).map(function (li, index) {
      var label = li.textContent.trim();
      li.textContent = '';
      var num = el('span', 'steps__num', String(index + 1));
      num.setAttribute('aria-hidden', 'true');
      var state = el('span', 'visually-hidden');
      li.appendChild(num);
      li.appendChild(el('span', 'steps__label', label));
      li.appendChild(state);
      return { li: li, num: num, state: state };
    });
  }

  function setStep(n) {
    var current = Math.min(Math.max(Number(n) || 1, 1), stepItems.length || 1);
    stepItems.forEach(function (item, index) {
      var done = index < current - 1;
      var isCurrent = index === current - 1;
      item.li.classList.toggle('is-done', done);
      item.li.classList.toggle('is-current', isCurrent);
      item.num.textContent = done ? '✓' : String(index + 1);
      item.state.textContent = done ? ' — пройден' : isCurrent ? ' — текущий шаг' : '';
      if (isCurrent) item.li.setAttribute('aria-current', 'step');
      else item.li.removeAttribute('aria-current');
    });
  }

  // ── Полоса действия и одна главная кнопка ───────────────────────────────

  var actionBar = document.getElementById('action-bar');
  var actionInfo = document.getElementById('action-info');
  var actionHint = document.getElementById('action-hint');
  var runButton = actionBar ? actionBar.querySelector('.btn') : null;

  if (actionInfo) actionInfo.setAttribute('aria-live', 'polite');

  function setAction(state) {
    var info = state && state.info ? state.info : '';
    var hint = state && state.hint ? state.hint : '';
    if (actionInfo) actionInfo.textContent = info;
    if (actionHint) {
      actionHint.textContent = hint;
      actionHint.hidden = !hint;
    }
  }

  // Пурпурная кнопка на экране всегда одна: до результата — запуск в полосе,
  // после — первая кнопка в .result__head (остальные там второстепенные).
  function setResultShown(shown) {
    var heads = document.querySelectorAll('.result__head');
    Array.prototype.forEach.call(heads, function (head) {
      var buttons = head.querySelectorAll('.btn');
      Array.prototype.forEach.call(buttons, function (button, index) {
        button.classList.toggle('btn--secondary', !(shown && index === 0));
      });
    });
    if (runButton) runButton.classList.toggle('btn--secondary', Boolean(shown));
  }

  // ── Файл, брошенный мимо зоны ───────────────────────────────────────────
  // Без этого браузер открывает (или скачивает) файл, отпущенный в любом месте
  // страницы вне .dropzone, и страница с уже загруженными файлами пропадает.
  // Зоны .dropzone обрабатывают свой drop сами (в app.js страницы) — их не трогаем;
  // перетаскивание строк списка (не файлов) тоже не трогаем.

  function isFileDrag(event) {
    var types = event.dataTransfer ? event.dataTransfer.types : null;
    return Boolean(types) && Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  function isInsideDropzone(event) {
    var target = event.target;
    return Boolean(target && target.closest && target.closest('.dropzone'));
  }

  window.addEventListener('dragover', function (event) {
    if (!isFileDrag(event) || isInsideDropzone(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'none';
  });

  window.addEventListener('drop', function (event) {
    if (!isFileDrag(event) || isInsideDropzone(event)) return;
    event.preventDefault();
  });

  // ── Запуск ──────────────────────────────────────────────────────────────

  if (side) {
    renderSide();
    selectTab(activeTab);
  }
  if (main) {
    renderCrumbs();
  }
  if (stepsEl) {
    prepareSteps();
    setStep(1);
  }
  if (actionBar) {
    setResultShown(false);
  }

  window.Shell = {
    plural: plural,
    setStep: setStep,
    setAction: setAction,
    setResultShown: setResultShown,
    formatSize: formatSize,
  };
})();
