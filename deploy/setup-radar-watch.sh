#!/usr/bin/env bash
#
# Один раз с Mac: ставит на сервер nowater.tech наблюдателя AI-радара (deploy/radar_watch.py).
# После этого согласование выпуска идет через GitHub, без Евы:
#   ветка radar-issue/ПЕРИОД с выпуском   -> страница на nowater.tech и контрольная копия Виктории
#   слияние этой ветки в main ("ок")      -> письмо адресатам, один раз
#
#   deploy/setup-radar-watch.sh           - поставить или обновить
#   deploy/setup-radar-watch.sh --off     - остановить наблюдателя (шлюз и Ева работают как раньше)
#
# Шлюз, пароль почты и список адресатов этот скрипт не трогает: их ставит deploy/setup-radar.sh.
# Наблюдатель работает от пользователя radar и запускает только шлюз.
#
# Если прямой маршрут до сервера не работает: BV_JUMP=root@206.189.181.64 deploy/setup-radar-watch.sh

set -Eeuo pipefail
cd "$(dirname "$0")/.."

SERVER="${BV_SERVER:-root@5.129.198.180}"
[[ "$SERVER" =~ ^[a-zA-Z0-9_.@-]+$ ]] || { echo 'Странный адрес сервера' >&2; exit 2; }
SSH=(ssh -o BatchMode=yes)
SCP=(scp -q -o BatchMode=yes)
if [[ -n "${BV_JUMP:-}" ]]; then
  [[ "$BV_JUMP" =~ ^[a-zA-Z0-9_.@:-]+$ ]] || exit 2
  SSH+=(-J "$BV_JUMP"); SCP+=(-J "$BV_JUMP")
fi

if [[ "${1:-}" == --off ]]; then
  "${SSH[@]}" "$SERVER" 'systemctl disable --now nowater-radar-watch.timer && echo "Наблюдатель остановлен."'
  exit 0
fi

echo '==> [1/3] Проверяю ветку'
branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != main ]]; then
  echo "Сейчас ветка $branch. На сервер ставим только то, что влито в main: git checkout main && git pull" >&2
  exit 1
fi
if ! git diff --quiet HEAD -- deploy/radar_watch.py deploy/setup-radar-watch.sh; then
  echo 'В наблюдателе есть незакоммиченные правки. Сначала коммит и влить в main.' >&2
  exit 1
fi

echo '==> [2/3] Ставлю наблюдателя на сервер nowater.tech'
local_stage=$(mktemp -d)
trap 'rm -rf "$local_stage"' EXIT
cp deploy/radar_watch.py "$local_stage/"
cat > "$local_stage/apply-watch.sh" <<'REMOTE'
#!/usr/bin/env bash
set -Eeuo pipefail
cd /
stage=${1:?}
[[ "$stage" =~ ^/var/tmp/nowater-radar-watch\.[a-zA-Z0-9]+$ ]] || exit 2

[[ -x /usr/local/sbin/nowater-radar ]] || { echo 'На сервере нет шлюза. Сначала deploy/setup-radar.sh' >&2; exit 1; }
id radar >/dev/null 2>&1 || { echo 'На сервере нет пользователя radar. Сначала deploy/setup-radar.sh' >&2; exit 1; }
for name in mail.json recipients.txt; do
  [[ -f /etc/nowater-radar/$name ]] || { echo "Нет /etc/nowater-radar/$name. Сначала deploy/setup-radar.sh" >&2; exit 1; }
done
command -v git >/dev/null || { echo 'На сервере нет git: apt-get install -y git' >&2; exit 1; }

install -o root -g root -m 755 "$stage/radar_watch.py" /usr/local/sbin/nowater-radar-watch.next
mv -Tf /usr/local/sbin/nowater-radar-watch.next /usr/local/sbin/nowater-radar-watch
install -d -o radar -g radar -m 700 /var/lib/nowater-radar/repo

cat > /etc/systemd/system/nowater-radar-watch.service <<'UNIT'
[Unit]
Description=AI-радар NOWATER: наблюдатель согласования выпуска через GitHub
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=radar
Group=radar
ExecStart=/usr/local/sbin/nowater-radar-watch
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/nowater-radar/repo /var/lib/nowater-radar/state /var/www/nowater-reports/radar
PrivateTmp=true
UNIT
cat > /etc/systemd/system/nowater-radar-watch.timer <<'UNIT'
[Unit]
Description=AI-радар NOWATER: проверять репозиторий раз в 5 минут

[Timer]
OnCalendar=*:0/5
RandomizedDelaySec=30
Persistent=false

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now nowater-radar-watch.timer >/dev/null

# Первый запуск сразу: видно, достает ли сервер до GitHub и может ли наблюдатель вызвать шлюз.
if systemctl start nowater-radar-watch.service; then
  echo 'первый запуск: без ошибок'
else
  echo 'первый запуск завершился с ошибкой:' >&2
  journalctl -u nowater-radar-watch.service -n 15 --no-pager >&2
  exit 1
fi
systemctl list-timers nowater-radar-watch.timer --no-pager | sed -n '1,2p'
tail -n 5 /var/lib/nowater-radar/state/watch.log 2>/dev/null || echo 'журнал наблюдателя пока пуст: свежих выпусков в репозитории нет'
rm -rf "$stage"
REMOTE

stage=$("${SSH[@]}" "$SERVER" 'mktemp -d /var/tmp/nowater-radar-watch.XXXXXXXX')
[[ "$stage" =~ ^/var/tmp/nowater-radar-watch\.[a-zA-Z0-9]+$ ]] || exit 2
"${SCP[@]}" "$local_stage/radar_watch.py" "$local_stage/apply-watch.sh" "$SERVER:$stage/"
"${SSH[@]}" "$SERVER" bash "$stage/apply-watch.sh" "$stage"

echo '==> [3/3] Готово'
echo 'Наблюдатель смотрит в репозиторий раз в 5 минут. Журнал на сервере: /var/lib/nowater-radar/state/watch.log'
echo 'Порядок согласования выпуска - radar/README.md, раздел "Согласование через GitHub".'
