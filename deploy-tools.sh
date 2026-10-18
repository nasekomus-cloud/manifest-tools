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

echo "Заливаю на $HOST ..."

# package.json и package-lock.json нужны (на сервере npm ci --omit=dev ради nodemailer);
# portal/help/make-samples.js уезжает вместе с папкой — он мал и безвреден.
rsync -avz --delete \
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

echo "Ставлю зависимости и перезапускаю сервис ..."
ssh "$HOST" "cd $TARGET_DIR && npm ci --omit=dev && chown -R manifest-portal: $TARGET_DIR && systemctl restart manifest-portal"

# Сервису нужна пара секунд на запуск
sleep 3
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)"
if [ "$CODE" != "200" ]; then
  echo "Ошибка: $URL ответил $CODE вместо 200. Смотри: ssh $HOST journalctl -u manifest-portal -n 50" >&2
  exit 1
fi

echo "Готово — https://tools.nasekomuspro.ru обновлён."
