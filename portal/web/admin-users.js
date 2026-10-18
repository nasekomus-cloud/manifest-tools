// Пользователи (только администраторам): список, «Пригласить», «Тестовая ссылка», права,
// галочка «Показывать недоступные инструменты…», «Новая ссылка для входа», «Отключить» / «Включить».
// У тестового (вход по ссылке без пароля, на срок) почты не показываем, вместо «Включить» —
// «Продлить», в имени — пометка «тест до ДД.ММ ЧЧ:ММ» / «тест истёк».
//
// Галочки прав — по одной на ключ инструмента, двумя группами «Экспорт» / «Импорт»;
// «Разделить коносаменты» (две записи в tools.js, один ключ bl-split) — одна
// галочка в группе, где запись встретилась первой («Импорт»), см. checkboxGroups.
// У администраторов вместо галочек — «Все инструменты».
import {
  api, el, formatDateTime, formatUntil, statusLabel, checkboxGroups, toolNumber, linkBlock,
  showMessage, setRequestCount, guestLabel, guestLinkHint,
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
  showLocked: document.getElementById('invite-show-locked'),
  submit: document.getElementById('invite-submit'),
  cancel: document.getElementById('invite-cancel'),
  msg: document.getElementById('invite-msg'),
  result: document.getElementById('invite-result'),
  done: document.getElementById('invite-done'),
  link: document.getElementById('invite-link'),
  again: document.getElementById('invite-again'),
};

const guest = {
  open: document.getElementById('guest-open'),
  panel: document.getElementById('guest-panel'),
  form: document.getElementById('guest-form'),
  name: document.getElementById('guest-name'),
  hours: document.getElementById('guest-hours'),
  tools: document.getElementById('guest-tools'),
  showLocked: document.getElementById('guest-show-locked'),
  submit: document.getElementById('guest-submit'),
  cancel: document.getElementById('guest-cancel'),
  msg: document.getElementById('guest-msg'),
  result: document.getElementById('guest-result'),
  done: document.getElementById('guest-done'),
  link: document.getElementById('guest-link'),
  again: document.getElementById('guest-again'),
};

const GUEST_DEFAULT_HOURS = 24;
const GUEST_MAX_HOURS = 720;

let me = null;
let users = [];
let groups = [];
// Что раскрыто под строкой: {id, kind: 'tools' | 'extend' | 'link' | 'message', link?, hint?, text?, ok?}
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

/** Целое число часов 1–720 из поля; иначе null. */
function readHours(input) {
  const text = input.value.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const hours = Number(text);
  return hours >= 1 && hours <= GUEST_MAX_HOURS ? hours : null;
}

function hoursInput(id) {
  const input = el('input');
  input.type = 'number';
  input.id = id;
  input.min = '1';
  input.max = String(GUEST_MAX_HOURS);
  input.step = '1';
  input.inputMode = 'numeric';
  input.value = String(GUEST_DEFAULT_HOURS);
  return input;
}

// «Продлить»: новый срок от текущего момента. Если прежние ссылки погашены (срок истёк или
// доступ отключали), сервер выдаёт новую — её и показываем
function extendPanel(user) {
  const box = el('div');
  const form = el('form', 'portal-form extend-form');
  form.noValidate = true;
  const label = el('label', 'field', 'Срок, часов (от текущего момента)');
  const input = hoursInput(`extend-${user.id}`);
  label.append(input);
  const actions = el('div', 'portal-form__actions');
  const save = el('button', 'btn btn--small', 'Продлить');
  save.type = 'submit';
  actions.append(save);
  const msg = el('p', 'portal-msg');
  msg.setAttribute('role', 'alert');
  msg.hidden = true;
  form.append(label, actions, msg);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const hours = readHours(input);
    if (hours === null) return showMessage(msg, `Срок — целое число часов от 1 до ${GUEST_MAX_HOURS}`);
    save.disabled = true;
    showMessage(msg, '');
    try {
      const data = await api(`/api/admin/users/${user.id}/extend`, { method: 'POST', body: { hours } });
      replaceUser(data.user);
      panel = data.link
        ? { id: user.id, kind: 'link', link: data.link, hint: `Прежняя ссылка больше не действует — передайте эту. ${guestLinkHint(data.user.expiresAt)}` }
        : { id: user.id, kind: 'message', ok: true, text: `Продлено до ${formatUntil(data.user.expiresAt)}. Прежняя ссылка продолжает работать.` };
      render();
    } catch (err) {
      showMessage(msg, err.message);
      save.disabled = false;
    }
  });
  box.append(form);
  return box;
}

function panelContent(user) {
  if (panel.kind === 'tools') return toolsPanel(user);
  if (panel.kind === 'extend') return extendPanel(user);
  if (panel.kind === 'link') return linkBlock(panel.link, panel.hint);
  const msg = el('p', `portal-msg ${panel.ok ? 'portal-msg--ok' : 'portal-msg--error'}`, panel.text);
  msg.setAttribute('role', panel.ok ? 'status' : 'alert');
  return msg;
}

// Галочка «Показывать недоступные…» в строке: сохраняется сразу; не вышло — возвращается назад
function showLockedCheck(user) {
  const label = el('label', 'tool-check users-setting');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = Boolean(user.showLocked);
  input.id = `show-locked-${user.id}`;
  label.append(input, el('span', null, 'Показывать недоступные инструменты и разрешить запрашивать доступ'));
  input.addEventListener('change', async () => {
    const wanted = input.checked;
    input.disabled = true;
    try {
      const data = await api(`/api/admin/users/${user.id}/settings`, { method: 'PUT', body: { showLocked: wanted } });
      replaceUser(data.user);
      user.showLocked = data.user.showLocked;
    } catch (err) {
      input.checked = !wanted;
      panel = { id: user.id, kind: 'message', text: err.message };
      render();
      return;
    } finally {
      input.disabled = false;
    }
  });
  return label;
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
  if (user.guest) {
    const label = guestLabel(user);
    nameCell.append(el('span', `users-badge${label === 'тест истёк' ? ' users-badge--muted' : ''}`, label));
  }
  if (isSelf) nameCell.append(el('span', 'portal-muted', ' (это вы)'));
  if (!user.isAdmin) nameCell.append(showLockedCheck(user));
  tr.append(nameCell);
  // Почта тестового — служебная, её не показываем
  tr.append(cell('Почта', user.guest ? '—' : user.email, 'users-table__email'));
  tr.append(cell('Состояние', el('span', `users-state--${user.status}`, statusLabel(user.status))));
  tr.append(cell('Последний вход', user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'ещё не входил'));

  const actions = el('div', 'portal-actions');
  const open = panel && panel.id === user.id ? panel.kind : null;
  actions.append(actionButton('Инструменты', () => togglePanel(user, 'tools'), { 'aria-expanded': String(open === 'tools') }));
  if (user.guest) {
    actions.append(actionButton('Продлить', () => togglePanel(user, 'extend'), { 'aria-expanded': String(open === 'extend') }));
  }
  if (user.status !== 'disabled') {
    actions.append(actionButton(user.guest ? 'Новая ссылка' : 'Новая ссылка для входа', (event) => {
      event.currentTarget.disabled = true;
      userAction(user, 'link', (data) => {
        panel = {
          id: user.id,
          kind: 'link',
          link: data.link,
          hint: user.guest ? `Прежняя ссылка больше не действует, все, кто открыл её, вышли. ${guestLinkHint(user.expiresAt)}` : undefined,
        };
      });
    }));
  }
  if (user.guest) {
    // У тестового «Включить» нет — его продлевают
    if (user.status !== 'disabled') {
      actions.append(actionButton('Отключить', (event) => {
        event.currentTarget.disabled = true;
        userAction(user, 'disable', (data) => {
          replaceUser(data.user);
          panel = null;
        });
      }));
    }
  } else if (user.status === 'disabled') {
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
    setGuestOpen(false);
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
    const data = await api('/api/admin/users', {
      method: 'POST',
      body: { email, name, tools: checkedKeys(invite.tools), showLocked: invite.showLocked.checked },
    });
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

// ── Тестовая ссылка ──────────────────────────────────────────────────────

function resetGuestForm() {
  guest.form.reset();
  guest.hours.value = String(GUEST_DEFAULT_HOURS);
  guest.tools.textContent = '';
  guest.tools.append(toolChecks(new Set(), 'guest'));
  showMessage(guest.msg, '');
  guest.form.hidden = false;
  guest.result.hidden = true;
}

function setGuestOpen(open) {
  guest.panel.hidden = !open;
  guest.open.setAttribute('aria-expanded', String(open));
  if (open) {
    setInviteOpen(false);
    resetGuestForm();
    guest.name.focus();
  }
}

guest.open.addEventListener('click', () => setGuestOpen(guest.panel.hidden));
guest.cancel.addEventListener('click', () => setGuestOpen(false));
guest.again.addEventListener('click', () => {
  resetGuestForm();
  guest.name.focus();
});

guest.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = guest.name.value.trim();
  if (!name) return showMessage(guest.msg, 'Укажите название');
  const hours = readHours(guest.hours);
  if (hours === null) return showMessage(guest.msg, `Срок — целое число часов от 1 до ${GUEST_MAX_HOURS}`);
  showMessage(guest.msg, '');
  guest.submit.disabled = true;
  try {
    const data = await api('/api/admin/guests', {
      method: 'POST',
      body: { name, tools: checkedKeys(guest.tools), showLocked: guest.showLocked.checked, hours },
    });
    users.push(data.user);
    render();
    guest.form.hidden = true;
    guest.done.textContent = `Тестовая ссылка «${data.user.name}» готова.`;
    guest.link.textContent = '';
    guest.link.append(linkBlock(data.link, guestLinkHint(data.user.expiresAt)));
    guest.result.hidden = false;
  } catch (err) {
    showMessage(guest.msg, err.message);
  } finally {
    guest.submit.disabled = false;
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
