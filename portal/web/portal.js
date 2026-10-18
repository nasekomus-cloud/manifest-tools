// Общие помощники страниц портала (ES-модуль, /portal/portal.js).
//
// Верхнюю полосу и меню «Инструменты» здесь не рисуем: закрытые страницы
// портала собраны на том же каркасе, что и страницы инструментов
// (tools.js → assets/shell.js с добавкой shell-addon.js), — второй копии полосы нет.
// Здесь только то, что нужно нескольким страницам: запросы к API, даты,
// подписи и блок со ссылкой входа.
//
// Всё, что пришло от людей (имена, почта, имена файлов, итоги), выводится только
// через textContent — никакого innerHTML с данными.
//
// Чистые функции (без document) проверяются в portal.test.js.

const NBSP = ' ';

export const TAB_KEY = 'manifest-tools:tab'; // тот же ключ, что у старого каркаса
export const CATEGORIES = ['export', 'import'];
export const TAB_LABELS = { export: 'Экспорт', import: 'Импорт' };

export const LINK_HINTS = {
  invite: 'Отправьте ссылку человеку в мессенджер. Ссылка действует 7 дней.',
  reset: 'Отправьте ссылку человеку в мессенджер. Ссылка действует 24 часа.',
};

// ── Запросы ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Запрос к API портала с JSON. Ответ — разобранный JSON (null у пустого ответа).
 * Ошибка — ApiError с текстом сервера ({error: '…'}), его и показываем человеку.
 * 401 на закрытой странице — сессии больше нет (вышел, отключён): уходим на вход
 * и потом возвращаемся сюда же; loginOn401: false — для страниц, где 401 — ответ
 * по существу (вход с неверным паролем).
 * Origin браузер ставит сам на любой не-GET запрос — сервер его и проверяет.
 */
export async function api(path, { method = 'GET', body, loginOn401 = true } = {}) {
  const options = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  let data = null;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (response.status === 401 && loginOn401) {
    window.location.href = loginUrl(window.location.pathname + window.location.search);
    throw new ApiError(401, (data && data.error) || 'Нужно войти');
  }
  if (!response.ok) {
    throw new ApiError(response.status, (data && data.error) || `Ошибка сервера (${response.status})`);
  }
  return data;
}

export function loginUrl(next) {
  return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

// ── Тексты ──────────────────────────────────────────────────────────────

/** Приветствие по часу: до 12:00 — утро, с 18:00 — вечер, между — день. */
export function greeting(hour) {
  if (hour < 12) return 'Доброе утро';
  if (hour >= 18) return 'Добрый вечер';
  return 'Добрый день';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Короткое «когда»: «10:42», «вчера, 10:42», «16.10, 10:42», «16.10.2025, 10:42». */
export function formatWhen(at, now = Date.now()) {
  const date = new Date(at);
  const today = new Date(now);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDay(date, today)) return time;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (sameDay(date, yesterday)) return `вчера, ${time}`;
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
  return date.getFullYear() === today.getFullYear() ? `${day}, ${time}` : `${day}.${date.getFullYear()}, ${time}`;
}

/** Полная дата и время: «18.10.2026, 10:42». */
export function formatDateTime(at) {
  const date = new Date(at);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** «№ 5» — как Shell.toolNumber (неразрывный пробел). */
export function toolNumber(tool) {
  return tool && tool.num ? `№${NBSP}${tool.num}` : '';
}

/** Сколько доступно в каждой вкладке: {export: {allowed, total}, import: {…}}. Каждая запись считается. */
export function tabCounts(tools) {
  const counts = {};
  for (const key of CATEGORIES) counts[key] = { allowed: 0, total: 0 };
  for (const tool of tools) {
    const c = counts[tool.category];
    if (!c) continue;
    c.total += 1;
    if (tool.allowed) c.allowed += 1;
  }
  return counts;
}

/**
 * Галочки прав по вкладкам: одна галочка на ключ. Ключ, который стоит в обеих
 * вкладках («Разделить коносаменты»), — в той, где встретился первым в tools.js.
 * → [{category, label, tools: [{key, num, title}]}]
 */
export function checkboxGroups(tools) {
  const seen = new Set();
  const groups = CATEGORIES.map((category) => ({ category, label: TAB_LABELS[category], tools: [] }));
  for (const tool of tools) {
    if (seen.has(tool.key)) continue;
    const group = groups.find((g) => g.category === tool.category);
    if (!group) continue;
    seen.add(tool.key);
    group.tools.push({ key: tool.key, num: tool.num, title: tool.title });
  }
  return groups.filter((g) => g.tools.length > 0);
}

/** Подсказка под ссылкой входа: приглашение — 7 дней, сброс — 24 часа. */
export function linkHint(link) {
  let path = '';
  try {
    path = new URL(link).pathname;
  } catch {
    path = String(link);
  }
  return path.startsWith('/invite/') ? LINK_HINTS.invite : LINK_HINTS.reset;
}

export function statusLabel(status) {
  return { invited: 'приглашён', active: 'активен', disabled: 'отключён' }[status] ?? status;
}

/** Текст запроса: «Ира просит доступ к «…»» или «Ира не может войти». */
export function requestText(request) {
  const name = request.userName || request.email || 'Без имени';
  if (request.tool === null || request.tool === undefined) return `${name} не может войти`;
  return `${name} просит доступ к «${request.toolTitle || request.tool}»`;
}

/** Строка журнала на главной: «<время> — <инструмент>, <итог>». */
export function journalLine(record, now = Date.now()) {
  const head = `${formatWhen(record.at, now)} — ${record.toolTitle || record.tool}`;
  return record.summary ? `${head}, ${record.summary}` : head;
}

// ── Разметка ────────────────────────────────────────────────────────────

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

/** Текст в буфер обмена: Clipboard API, а без него — выделение поля и execCommand. */
export async function copyText(text, input) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ниже — запасной путь
  }
  if (!input) return false;
  input.focus();
  input.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

/** Блок «ссылка + Скопировать + подсказка» — после приглашения, новой ссылки и «Дать новую ссылку». */
export function linkBlock(link) {
  const block = el('div', 'link-block');
  const row = el('div', 'link-block__row');
  const input = el('input', 'link-block__url');
  input.type = 'text';
  input.readOnly = true;
  input.value = link;
  input.setAttribute('aria-label', 'Ссылка для входа');
  input.addEventListener('focus', () => input.select());
  const copy = el('button', 'btn btn--secondary link-block__copy', 'Скопировать');
  copy.type = 'button';
  let timer = null;
  copy.addEventListener('click', async () => {
    const ok = await copyText(link, input);
    copy.textContent = ok ? 'Скопировано' : 'Выделите и скопируйте вручную';
    clearTimeout(timer);
    timer = setTimeout(() => {
      copy.textContent = 'Скопировать';
    }, 2500);
  });
  row.append(input, copy);
  block.append(row, el('p', 'link-block__hint', linkHint(link)));
  return block;
}

/**
 * Число открытых запросов на страницах администратора: в ссылке «Запросы»
 * (#subnav-requests) и в счётчике полосы у «Пользователи» (его рисует shell-addon.js).
 */
export function setRequestCount(count) {
  const n = Math.max(0, Number(count) || 0);
  const link = document.getElementById('subnav-requests');
  if (link) {
    link.querySelector('.portal-count')?.remove();
    if (n > 0) {
      const badge = el('span', 'portal-count', String(n));
      badge.setAttribute('aria-label', `открытых: ${n}`);
      link.append(badge);
    }
  }
  const bar = document.querySelector('.portal-bar__count');
  if (bar) {
    if (n > 0) {
      bar.textContent = String(n);
      bar.parentElement?.setAttribute('aria-label', `Пользователи, открытых запросов: ${n}`);
    } else {
      bar.parentElement?.removeAttribute('aria-label');
      bar.remove();
    }
  }
}

/** Сообщение под формой: ошибка или «готово». null/'' — спрятать. */
export function showMessage(node, text, kind = 'error') {
  node.textContent = text || '';
  node.hidden = !text;
  node.classList.toggle('portal-msg--error', kind === 'error');
  node.classList.toggle('portal-msg--ok', kind === 'ok');
}
