#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Фронтенд платформы «Без Воды» — деплой на Timeweb VDS (РФ, контур 152-ФЗ).
# Запуск с локальной машины:  ./deploy.sh
#
# Сборка локальная. Экспорт Lovable — это TanStack Start, то есть серверный
# рендер, а не статика: nitro собирает самодостаточный node-бандл, и на сервер
# уезжает только .output/ (зависимости уже внутри, npm install там не нужен).
# По умолчанию nitro целится в Cloudflare — поэтому пресет задаём явно.
#
# На сервере:
#   /opt/bezvody-front/server  — бандл SSR (systemd bezvody-front, 127.0.0.1:5050)
#   /opt/bezvody-front/public  — статика (отдаёт nginx, порт 8093)
# Первичная установка (юнит, nginx, пользователь) — см. deploy/SETUP.md.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
# Маршрут до Timeweb иногда ложится целиком, при этом сервер жив и отвечает
# из другой сети. Тогда идём через дроплет:
#   BV_JUMP=root@206.189.181.64 ./deploy.sh
JUMP="${BV_JUMP:-}"
SSH_OPTS=""
[ -n "$JUMP" ] && SSH_OPTS="-J $JUMP"
HOST_ONLY="${SERVER_HOST:-5.129.198.180}"

echo "==> [1/4] Проверка типов"
npx tsc --noEmit

echo "==> [2/4] Сборка (nitro, пресет node-server)"
NITRO_PRESET=node-server npm run build

# Подстраховка: если пресет вдруг не подхватился, на сервер уедет бандл для
# Cloudflare и сервис не поднимется. Лучше упасть здесь.
grep -q '"preset": "node-server"' .output/nitro.json \
  || { echo "❌ .output собран не под node-server, деплой остановлен"; exit 1; }

echo "==> [3/4] Заливка .output/ на $SERVER:/opt/bezvody-front"
rsync -az --delete ${SSH_OPTS:+-e "ssh $SSH_OPTS"} .output/ "$SERVER:/opt/bezvody-front/"

echo "==> [4/4] Рестарт сервиса и проверка"
ssh $SSH_OPTS "$SERVER" 'chown -R bezvody:bezvody /opt/bezvody-front && systemctl restart bezvody-front && sleep 2 && systemctl is-active bezvody-front'
# Когда идём через прыжок, снаружи сервер нам недоступен — спрашиваем его
# самого, а не свой канал до него.
if [ -n "$JUMP" ]; then
  ssh $SSH_OPTS "$SERVER" 'curl -sS -o /dev/null -w "прямо в node: HTTP %{http_code}\n" http://127.0.0.1:8093/'
else
  curl -sS -o /dev/null -w "прямо в node: HTTP %{http_code}\n" "http://$HOST_ONLY:8093/"
fi

echo "✅ Готово: http://$HOST_ONLY:8093/"
