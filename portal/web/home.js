// Главная портала (вариант G1): приветствие, переключатель «Экспорт / Импорт»
// с «N из M», карточки инструментов и три последние записи журнала.
//
// Вкладку ведёт каркас (assets/shell.js): он помнит её в localStorage
// (manifest-tools:tab) и прячет/показывает блоки [data-tab-panel]. Пилюля
// на странице не держит своего состояния — она нажимает вкладку каркаса
// (#side-tab-<вкладка>, та же, что в меню «Инструменты») и смотрит, какой
// блок сейчас виден. Так меню и пилюля всегда показывают одно и то же.
import {
  api, el, greeting, tabCounts, journalLine, toolNumber, showMessage,
  CATEGORIES, TAB_LABELS, TAB_KEY,
} from './portal.js';

const switcher = document.getElementById('home-switch');
const errorBox = document.getElementById('home-error');
const panels = Object.fromEntries(CATEGORIES.map((key) => [key, document.getElementById(`home-panel-${key}`)]));
const grids = Object.fromEntries(CATEGORIES.map((key) => [key, document.getElementById(`home-grid-${key}`)]));
const tabButtons = {};

// ── Переключатель ─────────────────────────────────────────────────────────

function currentTab() {
  return CATEGORIES.find((key) => !panels[key].hidden) ?? CATEGORIES[0];
}

function syncSwitcher() {
  const active = currentTab();
  for (const key of CATEGORIES) {
    const selected = key === active;
    tabButtons[key].setAttribute('aria-selected', String(selected));
    tabButtons[key].tabIndex = selected ? 0 : -1;
  }
}

function selectTab(key) {
  const shellTab = document.getElementById(`side-tab-${key}`);
  if (shellTab) {
    shellTab.click(); // каркас сам переключит блоки и запомнит вкладку
  } else {
    // Каркас не загрузился — переключаем сами, тем же ключом хранилища
    for (const k of CATEGORIES) panels[k].hidden = k !== key;
    try {
      window.localStorage.setItem(TAB_KEY, key);
    } catch {
      // хранилище недоступно — просто не помним
    }
  }
  syncSwitcher();
}

function buildSwitcher(counts) {
  switcher.textContent = '';
  for (const key of CATEGORIES) {
    const button = el('button', 'home-switch__tab');
    button.type = 'button';
    button.id = `home-tab-${key}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', panels[key].id);
    button.append(TAB_LABELS[key]);
    const c = counts[key];
    const count = el('span', 'home-switch__count', `${c.allowed} из ${c.total}`);
    button.append(count);
    button.setAttribute('aria-label', `${TAB_LABELS[key]}: доступно ${c.allowed} из ${c.total}`);
    button.addEventListener('click', () => selectTab(key));
    tabButtons[key] = button;
    switcher.append(button);
    panels[key].setAttribute('aria-labelledby', button.id);
    panels[key].removeAttribute('aria-label');
  }
  switcher.addEventListener('keydown', (event) => {
    const index = CATEGORIES.indexOf(currentTab());
    let next = null;
    if (event.key === 'ArrowRight') next = CATEGORIES[(index + 1) % CATEGORIES.length];
    else if (event.key === 'ArrowLeft') next = CATEGORIES[(index - 1 + CATEGORIES.length) % CATEGORIES.length];
    else if (event.key === 'Home') next = CATEGORIES[0];
    else if (event.key === 'End') next = CATEGORIES[CATEGORIES.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
    tabButtons[next].focus();
  });
  // Вкладку переключили в меню «Инструменты» — пилюля следом
  const observer = new MutationObserver(syncSwitcher);
  for (const key of CATEGORIES) observer.observe(panels[key], { attributes: true, attributeFilter: ['hidden'] });
  syncSwitcher();
}

// ── Карточки ─────────────────────────────────────────────────────────────

async function requestAccess(key) {
  const buttons = document.querySelectorAll(`.home-card__request[data-tool="${CSS.escape(key)}"]`);
  const statuses = document.querySelectorAll(`.home-card__status[data-tool="${CSS.escape(key)}"]`);
  buttons.forEach((b) => { b.disabled = true; });
  statuses.forEach((s) => showMessage(s, ''));
  try {
    const result = await api('/api/requests', { method: 'POST', body: { tool: key } });
    if (result && result.already) {
      window.location.reload(); // доступ уже выдали — карточка откроется
      return;
    }
    buttons.forEach((b) => { b.textContent = 'Запрос отправлен'; });
  } catch (err) {
    buttons.forEach((b) => { b.disabled = false; });
    statuses.forEach((s) => showMessage(s, err.message));
  }
}

function card(tool) {
  const item = el('li', 'home-card');
  const top = el('div', 'home-card__top');
  top.append(el('span', 'home-card__num', toolNumber(tool)));
  if (tool.output) top.append(el('span', 'home-card__fmt', tool.output));
  item.append(top, el('h2', 'home-card__title', tool.title));

  const action = el('div', 'home-card__action');
  if (tool.allowed) {
    item.append(el('p', 'home-card__desc', tool.description || ''));
    const open = el('a', 'btn btn--small', 'Открыть');
    open.href = `/${tool.href}`;
    open.setAttribute('aria-label', `Открыть: ${tool.title}`);
    action.append(open);
  } else {
    item.classList.add('is-locked');
    item.append(el('p', 'home-card__desc', 'Нет доступа'));
    const request = el('button', 'btn btn--small btn--warn home-card__request', 'Запросить доступ');
    request.type = 'button';
    request.dataset.tool = tool.key;
    request.addEventListener('click', () => requestAccess(tool.key));
    const status = el('p', 'home-card__status portal-msg');
    status.dataset.tool = tool.key;
    status.setAttribute('role', 'status');
    status.hidden = true;
    action.append(request, status);
  }
  item.append(action);
  return item;
}

function renderCards(tools) {
  for (const key of CATEGORIES) {
    const grid = grids[key];
    grid.textContent = '';
    const inTab = tools.filter((tool) => tool.category === key); // порядок — как в /api/me
    if (inTab.length === 0) {
      grid.replaceWith(el('p', 'home-empty', 'В этой вкладке пока нет инструментов.'));
      continue;
    }
    for (const tool of inTab) grid.append(card(tool));
  }
}

// ── Журнал ───────────────────────────────────────────────────────────────

async function renderLog(me) {
  const params = new URLSearchParams({ limit: '3' });
  if (me.user.isAdmin) params.set('user', String(me.user.id)); // администратору — тоже только свои
  let records;
  try {
    records = await api(`/api/journal?${params}`);
  } catch {
    return; // журнал на главной — не главное, без него страница работает
  }
  if (!Array.isArray(records) || records.length === 0) return;
  const list = document.getElementById('home-log-list');
  const now = Date.now();
  for (const record of records) list.append(el('li', null, journalLine(record, now)));
  document.getElementById('home-log').hidden = false;
}

// ── Запуск ───────────────────────────────────────────────────────────────

async function start() {
  let me;
  try {
    me = await api('/api/me');
  } catch (err) {
    showMessage(errorBox, err.message);
    return;
  }
  const name = (me.user.name || '').trim();
  const hello = greeting(new Date().getHours());
  document.getElementById('greeting').textContent = name ? `${hello}, ${name}` : hello;

  const tools = Array.isArray(me.tools) ? me.tools : [];
  buildSwitcher(tabCounts(tools));
  renderCards(tools);
  renderLog(me);
}

start();
