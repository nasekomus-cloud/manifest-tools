// Журнал: «Когда / Кто (только администраторам) / Инструмент / Файлы / Итог».
// Коллеге сервер отдаёт только его записи; администратору — всех, с фильтрами
// по человеку и инструменту.
import { api, el, formatDateTime, toolNumber, showMessage } from './portal.js';

const LIMIT = 500; // столько сервер отдаёт за раз (MAX_LIMIT в routes-journal.js)

const errorBox = document.getElementById('journal-error');
const wrap = document.getElementById('journal-wrap');
const rows = document.getElementById('journal-rows');
const empty = document.getElementById('journal-empty');
const more = document.getElementById('journal-more');
const userSelect = document.getElementById('filter-user');
const toolSelect = document.getElementById('filter-tool');

let isAdmin = false;
let loadId = 0;

function option(value, text) {
  const node = el('option', null, text);
  node.value = value;
  return node;
}

function cell(label, text, className) {
  const td = el('td', className, text);
  td.dataset.label = label;
  return td;
}

function render(records) {
  rows.textContent = '';
  for (const record of records) {
    const tr = el('tr');
    tr.append(cell('Когда', formatDateTime(record.at), 'journal-table__when'));
    if (isAdmin) tr.append(cell('Кто', record.userName || '—'));
    tr.append(cell('Инструмент', record.toolTitle || record.tool));
    const files = Array.isArray(record.files) ? record.files : [];
    tr.append(cell('Файлы', files.length ? files.join('\n') : '—', 'journal-table__files'));
    const summary = cell('Итог', '');
    if (record.kind === 'download') summary.append(el('span', 'journal-kind', 'скачано'));
    summary.append(record.summary || '—');
    tr.append(summary);
    rows.append(tr);
  }
  wrap.hidden = records.length === 0;
  empty.hidden = records.length !== 0;
  more.textContent = `Показаны последние ${LIMIT} записей.`;
  more.hidden = records.length < LIMIT;
}

async function load() {
  const id = ++loadId;
  const params = new URLSearchParams({ limit: String(LIMIT) });
  if (isAdmin && userSelect.value) params.set('user', userSelect.value);
  if (isAdmin && toolSelect.value) params.set('tool', toolSelect.value);
  showMessage(errorBox, '');
  try {
    const records = await api(`/api/journal?${params}`);
    if (id !== loadId) return; // пока ждали, фильтр поменяли ещё раз
    render(Array.isArray(records) ? records : []);
  } catch (err) {
    if (id !== loadId) return;
    showMessage(errorBox, err.message);
  }
}

async function setupFilters(me) {
  // Инструменты — по одному на ключ («Разделить коносаменты» стоит в tools.js дважды)
  const seen = new Set();
  for (const tool of me.tools || []) {
    if (seen.has(tool.key)) continue;
    seen.add(tool.key);
    toolSelect.append(option(tool.key, `${toolNumber(tool)} · ${tool.title}`));
  }
  try {
    const users = await api('/api/admin/users');
    for (const user of users) userSelect.append(option(String(user.id), `${user.name} (${user.email})`));
  } catch (err) {
    showMessage(errorBox, err.message);
  }
  userSelect.addEventListener('change', load);
  toolSelect.addEventListener('change', load);
  document.getElementById('journal-filters').hidden = false;
}

async function start() {
  let me;
  try {
    me = await api('/api/me');
  } catch (err) {
    showMessage(errorBox, err.message);
    return;
  }
  isAdmin = Boolean(me.user.isAdmin);
  if (isAdmin) {
    document.querySelectorAll('[data-admin]').forEach((node) => { node.hidden = false; });
    document.getElementById('journal-lead').textContent =
      'Что и когда сделано в инструментах — всеми. Сами файлы на сервер не отправляются — здесь только их имена и итог.';
    await setupFilters(me);
  }
  await load();
}

start();
