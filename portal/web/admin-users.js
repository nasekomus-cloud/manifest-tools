// Пользователи (только администраторам): список, «Пригласить», права,
// «Новая ссылка для входа», «Отключить» / «Включить».
//
// Галочки прав — по одной на ключ инструмента, двумя группами «Экспорт» / «Импорт»;
// «Разделить коносаменты» (две записи в tools.js, один ключ bl-split) — одна
// галочка в группе, где запись встретилась первой («Импорт»), см. checkboxGroups.
// У администраторов вместо галочек — «Все инструменты».
import {
  api, el, formatDateTime, statusLabel, checkboxGroups, toolNumber, linkBlock,
  showMessage, setRequestCount,
} from './portal.js';

const rowsBox = document.getElementById('users-rows');
const errorBox = document.getElementById('users-error');

const invite = {
  open: document.getElementById('invite-open'),
  panel: document.getElementById('invite-panel'),
  form: document.getElementById('invite-form'),
  email: document.getElementById('invite-email'),
  name: document.getElementById('invite-name'),
  tools: document.getElementById('invite-tools'),
  submit: document.getElementById('invite-submit'),
  cancel: document.getElementById('invite-cancel'),
  msg: document.getElementById('invite-msg'),
  result: document.getElementById('invite-result'),
  done: document.getElementById('invite-done'),
  link: document.getElementById('invite-link'),
  again: document.getElementById('invite-again'),
};

let me = null;
let users = [];
let groups = [];
// Что раскрыто под строкой: {id, kind: 'tools' | 'link' | 'message', link?, text?}
let panel = null;

// ── Галочки ──────────────────────────────────────────────────────────────

function toolChecks(selected, idPrefix) {
  const box = el('div', 'tool-checks');
  for (const group of groups) {
    const fieldset = el('fieldset', 'tool-checks__group');
    fieldset.append(el('legend', null, group.label));
    for (const tool of group.tools) {
      const label = el('label', 'tool-check');
      const input = el('input');
      input.type = 'checkbox';
      input.value = tool.key;
      input.id = `${idPrefix}-${tool.key}`;
      input.checked = selected.has(tool.key);
      const text = el('span');
      text.append(el('span', 'tool-check__num', toolNumber(tool)), ` ${tool.title}`);
      label.append(input, text);
      fieldset.append(label);
    }
    box.append(fieldset);
  }
  return box;
}

function checkedKeys(root) {
  return Array.from(root.querySelectorAll('input[type="checkbox"]:checked'), (input) => input.value);
}

// ── Таблица ──────────────────────────────────────────────────────────────

function cell(label, content, className) {
  const td = el('td', className);
  if (label) td.dataset.label = label;
  if (typeof content === 'string') td.textContent = content;
  else if (content) td.append(content);
  return td;
}

function actionButton(text, onClick, extra = {}) {
  const button = el('button', 'btn btn--secondary btn--small', text);
  button.type = 'button';
  for (const [name, value] of Object.entries(extra)) button.setAttribute(name, value);
  button.addEventListener('click', onClick);
  return button;
}

function replaceUser(updated) {
  users = users.map((u) => (u.id === updated.id ? updated : u));
}

async function userAction(user, path, after) {
  try {
    const data = await api(`/api/admin/users/${user.id}/${path}`, { method: 'POST', body: {} });
    after(data);
  } catch (err) {
    panel = { id: user.id, kind: 'message', text: err.message };
  }
  render();
}

function toolsPanel(user) {
  const box = el('div');
  if (user.isAdmin) {
    box.append(el('p', null, 'Все инструменты'));
    box.append(el('p', 'portal-muted', 'У администратора доступ ко всем инструментам, отдельно их не выдают.'));
    return box;
  }
  const checks = toolChecks(new Set(user.tools || []), `user-${user.id}`);
  const actions = el('div', 'portal-actions');
  const save = el('button', 'btn btn--small', 'Сохранить');
  save.type = 'button';
  const msg = el('p', 'portal-msg');
  msg.setAttribute('role', 'status');
  msg.hidden = true;
  save.addEventListener('click', async () => {
    save.disabled = true;
    showMessage(msg, '');
    try {
      const data = await api(`/api/admin/users/${user.id}/tools`, { method: 'PUT', body: { tools: checkedKeys(checks) } });
      replaceUser(data.user);
      showMessage(msg, 'Сохранено', 'ok');
    } catch (err) {
      showMessage(msg, err.message);
    } finally {
      save.disabled = false;
    }
  });
  actions.append(save);
  box.append(checks, actions, msg);
  return box;
}

function panelContent(user) {
  if (panel.kind === 'tools') return toolsPanel(user);
  if (panel.kind === 'link') return linkBlock(panel.link);
  const msg = el('p', 'portal-msg portal-msg--error', panel.text);
  msg.setAttribute('role', 'alert');
  return msg;
}

function togglePanel(user, kind) {
  panel = panel && panel.id === user.id && panel.kind === kind ? null : { id: user.id, kind };
  render();
}

function userRow(user) {
  const isSelf = me && user.id === me.user.id;
  const tr = el('tr');
  if (user.status === 'disabled') tr.classList.add('is-disabled');

  const name = el('span', 'users-table__name', user.name || '—');
  const nameCell = cell('Имя', name);
  if (user.isAdmin) nameCell.append(el('span', 'users-badge', 'администратор'));
  if (isSelf) nameCell.append(el('span', 'portal-muted', ' (это вы)'));
  tr.append(nameCell);
  tr.append(cell('Почта', user.email, 'users-table__email'));
  tr.append(cell('Состояние', el('span', `users-state--${user.status}`, statusLabel(user.status))));
  tr.append(cell('Последний вход', user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'ещё не входил'));

  const actions = el('div', 'portal-actions');
  const open = panel && panel.id === user.id ? panel.kind : null;
  actions.append(actionButton('Инструменты', () => togglePanel(user, 'tools'), { 'aria-expanded': String(open === 'tools') }));
  if (user.status !== 'disabled') {
    actions.append(actionButton('Новая ссылка для входа', (event) => {
      event.currentTarget.disabled = true;
      userAction(user, 'link', (data) => {
        panel = { id: user.id, kind: 'link', link: data.link };
      });
    }));
  }
  if (user.status === 'disabled') {
    actions.append(actionButton('Включить', (event) => {
      event.currentTarget.disabled = true;
      userAction(user, 'enable', (data) => {
        replaceUser(data.user);
        panel = null;
      });
    }));
  } else if (!isSelf) {
    actions.append(actionButton('Отключить', (event) => {
      event.currentTarget.disabled = true;
      userAction(user, 'disable', (data) => {
        replaceUser(data.user);
        panel = null;
      });
    }));
  }
  tr.append(cell(null, actions));

  const rows = [tr];
  if (open) {
    tr.classList.add('has-panel');
    const panelRow = el('tr', 'users-table__panel-row');
    const td = cell(null, panelContent(user), 'users-table__panel');
    td.colSpan = 5;
    panelRow.append(td);
    rows.push(panelRow);
  }
  return rows;
}

function render() {
  rowsBox.textContent = '';
  for (const user of users) rowsBox.append(...userRow(user));
}

async function loadUsers() {
  try {
    users = await api('/api/admin/users');
    showMessage(errorBox, '');
  } catch (err) {
    showMessage(errorBox, err.message);
    users = [];
  }
  render();
}

// ── Приглашение ──────────────────────────────────────────────────────────

function resetInviteForm() {
  invite.form.reset();
  invite.tools.textContent = '';
  invite.tools.append(toolChecks(new Set(), 'invite'));
  showMessage(invite.msg, '');
  invite.form.hidden = false;
  invite.result.hidden = true;
}

function setInviteOpen(open) {
  invite.panel.hidden = !open;
  invite.open.setAttribute('aria-expanded', String(open));
  if (open) {
    resetInviteForm();
    invite.email.focus();
  }
}

invite.open.addEventListener('click', () => setInviteOpen(invite.panel.hidden));
invite.cancel.addEventListener('click', () => setInviteOpen(false));
invite.again.addEventListener('click', () => {
  resetInviteForm();
  invite.email.focus();
});

invite.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = invite.email.value.trim();
  const name = invite.name.value.trim();
  if (!email) return showMessage(invite.msg, 'Укажите почту');
  if (!name) return showMessage(invite.msg, 'Укажите имя');
  showMessage(invite.msg, '');
  invite.submit.disabled = true;
  try {
    const data = await api('/api/admin/users', { method: 'POST', body: { email, name, tools: checkedKeys(invite.tools) } });
    users.push(data.user);
    render();
    invite.form.hidden = true;
    invite.done.textContent = `Приглашение для «${data.user.name}» (${data.user.email}) готово.`;
    invite.link.textContent = '';
    invite.link.append(linkBlock(data.link));
    invite.result.hidden = false;
  } catch (err) {
    showMessage(invite.msg, err.message);
  } finally {
    invite.submit.disabled = false;
  }
});

// ── Запуск ───────────────────────────────────────────────────────────────

async function start() {
  try {
    me = await api('/api/me');
  } catch (err) {
    showMessage(errorBox, err.message);
    return;
  }
  groups = checkboxGroups(me.tools || []);
  setRequestCount(me.openRequests);
  await loadUsers();
}

start();
