// Запросы (только администраторам): доступ к инструменту — «Выдать» / «Отклонить»;
// «не может войти» (из «Забыли пароль?») — «Дать новую ссылку» / «Отклонить».
// Разобранный запрос остаётся на странице с итогом до перезагрузки, чтобы
// ссылку можно было скопировать.
import {
  api, el, formatDateTime, requestText, linkBlock, showMessage, setRequestCount, contactText,
} from './portal.js';

const list = document.getElementById('requests-list');
const empty = document.getElementById('requests-empty');
const errorBox = document.getElementById('requests-error');

let openCount = 0;

function finish(item, text, link) {
  item.classList.add('is-done');
  const actions = item.querySelector('.portal-actions');
  actions.replaceWith(el('p', 'portal-msg portal-msg--ok', text));
  if (link) item.append(linkBlock(link));
  openCount -= 1;
  setRequestCount(openCount);
}

function requestItem(request) {
  const item = el('li', 'request-item');
  item.append(el('p', 'request-item__text', requestText(request)));
  item.append(el('p', 'request-item__meta', `${contactText(request)} · ${formatDateTime(request.at)}`));

  const loginHelp = request.tool === null;
  const actions = el('div', 'portal-actions');
  const grant = el('button', 'btn btn--small', loginHelp ? 'Дать новую ссылку' : 'Выдать');
  grant.type = 'button';
  const reject = el('button', 'btn btn--secondary btn--small', 'Отклонить');
  reject.type = 'button';
  const msg = el('p', 'portal-msg');
  msg.setAttribute('role', 'alert');
  msg.hidden = true;
  actions.append(grant, reject);
  item.append(actions, msg);

  async function act(path, done) {
    grant.disabled = true;
    reject.disabled = true;
    showMessage(msg, '');
    try {
      const data = await api(`/api/admin/requests/${request.id}/${path}`, { method: 'POST', body: {} });
      done(data);
    } catch (err) {
      grant.disabled = false;
      reject.disabled = false;
      showMessage(msg, err.message);
    }
  }

  grant.addEventListener('click', () => act('grant', (data) => {
    if (loginHelp) finish(item, 'Ссылка готова', data && data.link);
    else finish(item, `Доступ выдан: «${request.toolTitle || request.tool}»`);
  }));
  reject.addEventListener('click', () => act('reject', () => finish(item, 'Отклонено')));
  return item;
}

async function start() {
  let requests;
  try {
    requests = await api('/api/admin/requests');
  } catch (err) {
    showMessage(errorBox, err.message);
    return;
  }
  openCount = requests.length;
  setRequestCount(openCount);
  empty.hidden = requests.length > 0;
  for (const request of requests) list.append(requestItem(request));
}

start();
