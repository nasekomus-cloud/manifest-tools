// Темы оформления портала — личная настройка каждого человека (users.theme).
//
// Единственный список допустимых тем: его проверяет PUT /api/account/theme и отдаёт
// /api/me (страница профиля рисует по нему плитки). Сами цвета — в portal/web/theme.css,
// по блоку на тему (themes.test.js сверяет, что блок есть у каждой темы списка).
// Порядок — порядок плиток в «Моём профиле».

export const THEMES = [
  { id: 'depth', name: 'Глубина', kind: 'dark' },
  { id: 'emerald', name: 'Изумруд', kind: 'dark' },
  { id: 'day', name: 'Ясный день', kind: 'light' },
  { id: 'mint', name: 'Мята', kind: 'light' },
  { id: 'graphite', name: 'Графит', kind: 'dark' },
  { id: 'chart', name: 'Лоцманская карта', kind: 'light' },
  { id: 'sunset', name: 'Закат над портом', kind: 'dark' },
  { id: 'arctic', name: 'Арктика', kind: 'light' },
  { id: 'bordeaux', name: 'Бордо', kind: 'dark' },
  { id: 'steel', name: 'Сталь', kind: 'dark' },
];

export const DEFAULT_THEME = 'depth';

const IDS = new Set(THEMES.map((t) => t.id));

export function isTheme(id) {
  return typeof id === 'string' && IDS.has(id);
}

/**
 * HTML-страница с темой человека: data-theme="<id>" в первый тег <html> — тема на экране
 * с первого кадра, без мигания. Тега нет — страница как есть. Неизвестный id (тему
 * убрали из списка) — тема по умолчанию; в атрибут попадает только id из списка.
 */
export function withTheme(html, id) {
  const theme = isTheme(id) ? id : DEFAULT_THEME;
  return html.replace(/<html(?=[\s>])/i, (tag) => `${tag} data-theme="${theme}"`);
}
