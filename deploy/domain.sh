#!/usr/bin/env bash
# Привязка платформы к домену. Запуск: ./deploy/domain.sh id.withoutwater.ru
#
# Единственное, что нужно сделать руками до этого, — A-запись поддомена
# на 5.129.198.180 в панели timeweb.cloud (DNS домена живёт там, ns1-ns4.timeweb).
# Скрипт сам проверит, что запись доехала, поставит сайт nginx и выпустит
# сертификат. Повторный запуск безопасен.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${1:-id.withoutwater.ru}"
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
IP="${SERVER_HOST:-5.129.198.180}"

echo "==> [1/4] Проверяю, что $DOMAIN показывает на $IP"
resolved="$(ssh "$SERVER" "dig +short A $DOMAIN | tail -1")"
if [ "$resolved" != "$IP" ]; then
  echo "❌ $DOMAIN сейчас показывает на «${resolved:-ничего}»."
  echo "   Добавьте в timeweb.cloud A-запись: $DOMAIN → $IP, и запустите снова."
  echo "   DNS обновляется до получаса."
  exit 1
fi

echo "==> [2/4] Ставлю сайт nginx"
sed "s/id\.withoutwater\.ru/$DOMAIN/g" deploy/nginx-bezvody-domain.conf \
  | ssh "$SERVER" "cat > /etc/nginx/sites-available/bezvody-domain"
ssh "$SERVER" "ln -sf /etc/nginx/sites-available/bezvody-domain /etc/nginx/sites-enabled/bezvody-domain && nginx -t && systemctl reload nginx"

echo "==> [3/4] Выпускаю сертификат"
# --keep-until-expiring: повторный запуск не дёргает Let's Encrypt зря.
ssh "$SERVER" "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --redirect --keep-until-expiring -m hello@vi-utkina.ru"

echo "==> [4/4] Проверка"
curl -sS -o /dev/null -w "https://$DOMAIN — HTTP %{http_code}\n" "https://$DOMAIN/"
echo "✅ Готово: https://$DOMAIN/"
