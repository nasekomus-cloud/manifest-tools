#!/usr/bin/env bash
# Обновить сайт на VPS (nginx отдаёт статику из /var/www/manifest-tools,
# домен em.nasekomuspro.ru).
# Доступ по SSH-ключу (~/.ssh/id_ed25519) — пароль не спрашивается.
#
# Использование: ./deploy-em.sh

set -euo pipefail

HOST="root@130.49.213.189"
TARGET_DIR="/var/www/manifest-tools"

cd "$(dirname "$0")"

echo "Заливаю на $HOST ..."

rsync -avz --delete \
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
  --exclude 'deploy-em.sh' \
  --exclude 'deploy-manifest.sh' \
  ./ "$HOST:$TARGET_DIR/"

ssh "$HOST" "chown -R www-data:www-data $TARGET_DIR"

echo "Готово — https://em.nasekomuspro.ru обновлён."
