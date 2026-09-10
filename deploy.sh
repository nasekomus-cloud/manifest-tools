#!/usr/bin/env bash
# Обновить сайт на VPS (nginx отдаёт статику из /var/www/manifest-tools).
# Пароль root@VPS спрашивается один раз (ssh-мастер-соединение), вводите
# сами — этот скрипт его нигде не хранит и не запрашивает программно.
#
# Использование: ./deploy.sh

set -euo pipefail

HOST="root@130.49.213.189"
TARGET_DIR="/var/www/manifest-tools"
CONTROL_PATH="/tmp/manifest-tools-deploy-ssh-%r@%h:%p"

cd "$(dirname "$0")"

echo "Подключаюсь к $HOST — пароль спросит один раз."
ssh -M -S "$CONTROL_PATH" -fnN "$HOST"
trap 'ssh -S "$CONTROL_PATH" -O exit "$HOST" 2>/dev/null || true' EXIT

rsync -avz --delete \
  -e "ssh -S $CONTROL_PATH" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.autopilot' \
  --exclude '.claude' \
  --exclude '.agents' \
  --exclude 'package.json' \
  --exclude 'package-lock.json' \
  --exclude 'CLAUDE.md' \
  --exclude '.gitignore' \
  --exclude '*.test.js' \
  --exclude '.DS_Store' \
  --exclude 'skills-lock.json' \
  --exclude 'deploy.sh' \
  ./ "$HOST:$TARGET_DIR/"

echo "Готово — https://manifest.nasekomuspro.ru обновлён."
