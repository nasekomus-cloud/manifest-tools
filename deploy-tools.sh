#!/usr/bin/env bash
# Обновить портал tools.nasekomuspro.ru на VPS: код в /opt/manifest-portal,
# сервис manifest-portal (systemd) за nginx.
# Доступ по SSH-ключу (~/.ssh/id_ed25519) — пароль не спрашивается.
# Разовая установка сервера (пользователь, юниты, nginx, certbot) — один раз руками,
# см. раздел «Портал» в CLAUDE.md; этот скрипт только обновляет код и перезапускает сервис.
#
# Использование: ./deploy-tools.sh

set -euo pipefail

HOST="root@130.49.213.189"
TARGET_DIR="/opt/manifest-portal"
URL="https://tools.nasekomuspro.ru/login"

cd "$(dirname "$0")"

# На сервер едет то, что лежит в рабочей папке, а не то, что закоммичено: чужой файл
# (например, настоящий манифест заказчика, брошенный в папку инструмента) уехал бы на
# сервер вместе с кодом. Поэтому с незафиксированными изменениями и неотслеживаемыми файлами не работаем.
if [ -n "$(git status --porcelain)" ]; then
  echo "Ошибка: в рабочей папке есть незакоммиченные или неотслеживаемые файлы — на сервер они не поедут." >&2
  echo "Закоммить нужное и убери лишнее, затем запусти скрипт снова. Сейчас:" >&2
  git status --short >&2
  exit 1
fi

# nodemailer ставится не на сервере (там нет npm), а копируется отсюда:
# пакет на чистом JS, без зависимостей.
if [ ! -f node_modules/nodemailer/package.json ]; then
  echo "Ошибка: нет node_modules/nodemailer — выполни npm install в корне репозитория." >&2
  exit 1
fi

echo "Заливаю на $HOST ..."

# package.json нужен серверу ("type": "module"), package-lock.json едет за компанию;
# portal/help/make-samples.js уезжает вместе с папкой — он мал и безвреден.
# Из node_modules едет только nodemailer: правила include стоят раньше exclude (первое совпадение выигрывает).
rsync -avz --delete \
  --include '/node_modules/' \
  --include '/node_modules/nodemailer/***' \
  --exclude '/node_modules/*' \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.autopilot' \
  --exclude '.claude' \
  --exclude '.agents' \
  --exclude '.superpowers' \
  --exclude '.portal-dev' \
  --exclude 'docs' \
  --exclude '*.test.js' \
  --exclude 'CLAUDE.md' \
  --exclude '.gitignore' \
  --exclude '.DS_Store' \
  --exclude 'skills-lock.json' \
  --exclude 'deploy-*.sh' \
  ./ "$HOST:$TARGET_DIR/"

echo "Перезапускаю сервис ..."
ssh "$HOST" "chown -R manifest-portal: $TARGET_DIR && systemctl restart manifest-portal"

# Сервису нужно время на запуск: до 10 попыток с паузой в секунду
CODE=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
  [ "$CODE" = "200" ] && break
  sleep 1
done
if [ "$CODE" != "200" ]; then
  echo "Ошибка: $URL ответил $CODE вместо 200. Смотри: ssh $HOST journalctl -u manifest-portal -n 50" >&2
  exit 1
fi

echo "Готово — https://tools.nasekomuspro.ru обновлён."
