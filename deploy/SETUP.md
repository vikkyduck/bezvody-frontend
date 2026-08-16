# Первичная установка фронтенда на Timeweb VDS

Разово, с локальной машины. Дальше — только `./deploy.sh`.

Сервер: `5.129.198.180` (Timeweb, РФ — контур 152-ФЗ). Там же живут kotu (8091),
leader-navigator (8090), vi-utkina (8092), withoutwater, lunario.

## Что где

| Что | Где |
|---|---|
| Бандл SSR | `/opt/bezvody-front/server/index.mjs` |
| Статика | `/opt/bezvody-front/public/` |
| Сервис | systemd `bezvody-front`, слушает `127.0.0.1:5050` |
| Вход снаружи | nginx, порт **8093** → http://5.129.198.180:8093/ |
| Пользователь | системный `bezvody` (без логина и домашней папки) |

Домена пока нет: вход по порту, как у leader-navigator. Когда появится —
добавить `server_name`, порт 443 и certbot.

## Шаги

```bash
# 1. Пользователь и папка
ssh root@5.129.198.180 'useradd --system --home-dir /opt/bezvody-front --shell /usr/sbin/nologin bezvody; mkdir -p /opt/bezvody-front'

# 2. Юнит systemd
rsync -az deploy/bezvody-front.service root@5.129.198.180:/etc/systemd/system/
ssh root@5.129.198.180 'systemctl daemon-reload && systemctl enable bezvody-front'

# 3. Сайт nginx
rsync -az deploy/nginx-bezvody-front.conf root@5.129.198.180:/etc/nginx/sites-available/bezvody-front
ssh root@5.129.198.180 'ln -sf /etc/nginx/sites-available/bezvody-front /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx'

# 4. Порт в firewall (если ещё закрыт)
ssh root@5.129.198.180 'ufw allow 8093/tcp'

# 5. Первый деплой
./deploy.sh
```

`nginx -t` только проверяет конфиг — без `systemctl reload nginx` порт не
откроется, и снаружи будет пустой ответ вместо страницы. Наступали 16.08.2026.

## Проверить и починить

```bash
ssh root@5.129.198.180 'systemctl status bezvody-front --no-pager'
ssh root@5.129.198.180 'journalctl -u bezvody-front -n 50 --no-pager'
ssh root@5.129.198.180 'curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5050/'   # сам node
curl -sS -o /dev/null -w "%{http_code}\n" http://5.129.198.180:8093/                        # через nginx
```
