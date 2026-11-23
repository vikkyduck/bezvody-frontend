#!/usr/bin/env bash
#
# Один раз с Mac: Ева сама публикует еженедельный AI-радар на nowater.tech и отправляет
# письмо после согласования Виктории. Ставит на сервер nowater.tech шлюз
# deploy/radar_gateway.py (пользователь radar, команды только publish/test/send/status),
# адрес /AI-radar/Avito/Goods/<период> по шаблону и подключает к шлюзу ключ Евы.
#
#   deploy/setup-radar.sh     - поставить или обновить; повторный запуск меняет почту и адресатов
#
# Пароль почты и список адресатов остаются на сервере nowater.tech: Ева их не видит и
# отправить письмо на другой адрес не может. Пароль вводится вслепую и идет потоком ввода,
# как в set-mail.sh: его нет ни в истории команд, ни в списке процессов.
#
# Что нужно заранее:
#   - ветка main, в которую влиты этот файл и шлюз (на сервер ставим только влитое);
#   - ключ Евы: она создает его сама командой
#       ssh-keygen -t ed25519 -f ~/.ssh/nowater_radar -N '' -C eva-radar
#   - пароль приложения почтового ящика. У Яндекса: Яндекс ID - Безопасность -
#     Пароли приложений - Почта. Обычный пароль ящика почта программе не примет.
#
# Если прямой маршрут до сервера nowater.tech не работает: BV_JUMP=root@206.189.181.64 deploy/setup-radar.sh

set -Eeuo pipefail
cd "$(dirname "$0")/.."

SERVER="${BV_SERVER:-root@5.129.198.180}"
EVA="${EVA_HOST:-eva}"
EVA_HOME=/home/agent/eva-home
[[ "$SERVER" =~ ^[a-zA-Z0-9_.@-]+$ && "$EVA" =~ ^[a-zA-Z0-9_.@-]+$ ]] || { echo 'Странный адрес сервера' >&2; exit 2; }
HOST="${SERVER#*@}"
SSH=(ssh -o BatchMode=yes)
SCP=(scp -q -o BatchMode=yes)
if [[ -n "${BV_JUMP:-}" ]]; then
  [[ "$BV_JUMP" =~ ^[a-zA-Z0-9_.@:-]+$ ]] || exit 2
  SSH+=(-J "$BV_JUMP"); SCP+=(-J "$BV_JUMP")
fi

echo '==> [1/5] Проверяю ветку'
branch=$(git rev-parse --abbrev-ref HEAD)
if [[ "$branch" != main ]]; then
  echo "Сейчас ветка $branch. На сервер ставим только то, что влито в main: git checkout main && git pull" >&2
  exit 1
fi
if ! git diff --quiet HEAD -- deploy/radar_gateway.py deploy/nginx-nowater-ai-radar.conf deploy/setup-radar.sh; then
  echo 'В шлюзе или настройке nginx есть незакоммиченные правки. Сначала коммит и влить в main.' >&2
  exit 1
fi

echo '==> [2/5] Беру ключ Евы'
key=$(ssh -o BatchMode=yes "$EVA" "runuser -u agent -- cat $EVA_HOME/.ssh/nowater_radar.pub" 2>/dev/null || true)
if ! [[ "$key" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9._@-]+)?$ ]]; then
  echo "У Евы нет ключа $EVA_HOME/.ssh/nowater_radar.pub. Попросите ее выполнить:" >&2
  echo "  ssh-keygen -t ed25519 -f ~/.ssh/nowater_radar -N '' -C eva-radar" >&2
  exit 1
fi
echo "    ключ: ${key:0:40}..."

echo '==> [3/5] Почта и адресаты'
echo 'Пустой пароль - оставить прежние настройки почты (при повторном запуске).'
read -rp 'Сервер почты [smtp.yandex.ru]: ' mail_host; mail_host=${mail_host:-smtp.yandex.ru}
read -rp 'Порт [465]: ' mail_port; mail_port=${mail_port:-465}
[[ "$mail_port" =~ ^[0-9]+$ ]] || { echo 'Порт - это число, обычно 465' >&2; exit 1; }
read -rp 'Имя пользователя (обычно полный адрес ящика): ' mail_user
read -rp "Адрес отправителя [$mail_user]: " mail_from; mail_from=${mail_from:-$mail_user}
read -rp 'Имя отправителя [Виктория Уткина]: ' mail_name; mail_name=${mail_name:-Виктория Уткина}
printf 'Пароль приложения (не отображается): '; read -rs mail_pass; echo
echo 'Адресаты рассылки, по одному на строку. Пустая строка - конец списка.'
echo 'Сразу пустая строка - оставить прежний список.'
recipients=()
while IFS= read -r line && [[ -n "$line" ]]; do recipients+=("$line"); done

payload=$(KEY="$key" HOST_="$mail_host" PORT_="$mail_port" USER_="$mail_user" FROM_="$mail_from" NAME_="$mail_name" \
  python3 -c '
import json, os, re, sys
password = sys.stdin.readline().rstrip("\n").rstrip("\r")
recipients = [line.strip() for line in sys.stdin.read().splitlines() if line.strip()]
email = re.compile(r"[^@\s<>\"\x27,]+@[^@\s<>\"\x27,]+\.[a-zA-Z]{2,}")
bad = [r for r in recipients if not email.fullmatch(r)]
if bad:
    sys.exit("Не похоже на адрес почты: " + ", ".join(bad))
mail = None
if password:
    if not email.fullmatch(os.environ["FROM_"]) or not os.environ["USER_"]:
        sys.exit("Нужны имя пользователя и адрес отправителя")
    mail = {"host": os.environ["HOST_"], "port": int(os.environ["PORT_"]), "user": os.environ["USER_"],
            "password": password, "from": os.environ["FROM_"], "name": os.environ["NAME_"]}
print(json.dumps({"key": os.environ["KEY"], "mail": mail, "recipients": recipients or None}, ensure_ascii=False))
' < <(printf '%s\n' "$mail_pass"; printf '%s\n' "${recipients[@]+"${recipients[@]}"}"))
unset mail_pass

echo '==> [4/5] Ставлю шлюз на сервер nowater.tech'
local_stage=$(mktemp -d)
trap 'rm -rf "$local_stage"' EXIT
cp deploy/radar_gateway.py deploy/nginx-nowater-ai-radar.conf "$local_stage/"
cat > "$local_stage/apply.sh" <<'REMOTE'
#!/usr/bin/env bash
set -Eeuo pipefail
cd /
stage=${1:?}
[[ "$stage" =~ ^/var/tmp/nowater-radar\.[a-zA-Z0-9]+$ ]] || exit 2
exec 9>/var/lock/nowater-branding-maintenance.lock
flock -n 9 || { echo 'Идет другая выкладка NOWATER, повторите позже' >&2; exit 1; }

id radar >/dev/null 2>&1 || useradd --system --home-dir /var/lib/nowater-radar --no-create-home --shell /bin/sh radar
usermod -p '*' -s /bin/sh radar
install -d -o root -g root -m 755 /var/lib/nowater-radar /var/lib/nowater-radar/.ssh
install -d -o radar -g radar -m 700 /var/lib/nowater-radar/state
mkdir -p /var/www/nowater-reports
install -d -o radar -g radar -m 755 /var/www/nowater-reports/radar
install -d -o root -g radar -m 750 /etc/nowater-radar
install -o root -g root -m 755 "$stage/radar_gateway.py" /usr/local/sbin/nowater-radar.next
mv -Tf /usr/local/sbin/nowater-radar.next /usr/local/sbin/nowater-radar

# Ключ Евы, почта и адресаты - из потока ввода. Файлы принадлежат root: шлюз их только читает.
python3 -I -c '
import grp, json, os, sys
data = json.load(sys.stdin)
gid = grp.getgrnam("radar").gr_gid
def write(path, text, mode, group=0):
    temporary = path + ".next"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(text)
    os.chown(temporary, 0, group)
    os.chmod(temporary, mode)
    os.replace(temporary, path)
write("/var/lib/nowater-radar/.ssh/authorized_keys",
      "restrict,command=\"/usr/local/sbin/nowater-radar\" " + data["key"].strip() + "\n", 0o644)
if data["mail"]:
    write("/etc/nowater-radar/mail.json", json.dumps(data["mail"], ensure_ascii=False, indent=1) + "\n", 0o640, gid)
    print("почта: " + data["mail"]["from"] + " через " + data["mail"]["host"])
if data["recipients"]:
    write("/etc/nowater-radar/recipients.txt", "\n".join(data["recipients"]) + "\n", 0o640, gid)
    print("адресатов: %d" % len(data["recipients"]))
for name in ("mail.json", "recipients.txt"):
    if not os.path.exists("/etc/nowater-radar/" + name):
        sys.exit("нет /etc/nowater-radar/" + name + ": в первый раз нужно задать почту и адресатов")
'

# Вход по ключу для radar: если sshd пускает только перечисленных пользователей, сами его не правим.
if sshd -T -C user=radar,host=eva,addr=127.0.0.1 2>/dev/null | grep -qiE '^(allowusers|allowgroups) '; then
  if ! sshd -T -C user=radar,host=eva,addr=127.0.0.1 | grep -iE '^allowusers ' | grep -qw radar; then
    echo 'sshd пускает только перечисленных пользователей (AllowUsers). Добавьте radar и повторите.' >&2
    exit 1
  fi
fi

# Адрес по шаблону. При ошибке nginx или если адрес не открылся - прежняя настройка.
snippet=/etc/nginx/snippets/nowater-ai-radar.conf
backup=$(mktemp -d /var/backups/nowater-radar-XXXXXXXX)
chmod 700 "$backup"
cp -a "$snippet" "$backup/" 2>/dev/null || touch "$backup/absent"
probe=/var/www/nowater-reports/radar/avito-goods-00.00-00.00.00.html
restore() {
  rm -f "$probe"
  if [[ -f "$backup/absent" ]]; then rm -f "$snippet"; else cp -a "$backup/nowater-ai-radar.conf" "$snippet"; fi
  nginx -t && systemctl reload nginx
  echo "Настройка nginx возвращена. Копия: $backup" >&2
  exit 1
}
install -m 644 "$stage/nginx-nowater-ai-radar.conf" "$snippet.next"
mv -Tf "$snippet.next" "$snippet"
nginx -t || restore
systemctl reload nginx
printf 'radar-probe\n' > "$probe" && chown radar:radar "$probe" && chmod 644 "$probe"
sleep 1
answer=$(curl -sS -D - --resolve nowater.tech:443:127.0.0.1 https://nowater.tech/AI-radar/Avito/Goods/00.00-00.00.00 || true)
rm -f "$probe"
if ! grep -q 'radar-probe' <<<"$answer" || ! grep -qi '^x-robots-tag: noindex' <<<"$answer"; then
  echo 'Адрес по шаблону не открылся: похоже, в настройке nowater.tech есть правило, которое его перехватывает.' >&2
  restore
fi
echo "адрес по шаблону работает, копия прежней настройки nginx: $backup"
cat /etc/ssh/ssh_host_ed25519_key.pub
rm -rf "$stage"
REMOTE

stage=$("${SSH[@]}" "$SERVER" 'mktemp -d /var/tmp/nowater-radar.XXXXXXXX')
[[ "$stage" =~ ^/var/tmp/nowater-radar\.[a-zA-Z0-9]+$ ]] || exit 2
"${SCP[@]}" "$local_stage/radar_gateway.py" "$local_stage/nginx-nowater-ai-radar.conf" "$local_stage/apply.sh" "$SERVER:$stage/"
result=$(printf '%s\n' "$payload" | "${SSH[@]}" "$SERVER" bash "$stage/apply.sh" "$stage")
unset payload
printf '%s\n' "$result" | grep -v '^ssh-ed25519 '
host_key=$(printf '%s\n' "$result" | grep -m1 '^ssh-ed25519 ' | cut -d' ' -f1-2)
[[ -n "$host_key" ]] || { echo 'Сервер не прислал свой ключ, Еву не подключаю' >&2; exit 1; }

echo '==> [5/5] Подключаю Еву и проверяю вход'
# Файлы Евы меняем только командами от ее имени. Ключ сервера берем через root-доступ,
# поэтому Ева не доверяет первому встречному ответу на этом адресе.
ssh -o BatchMode=yes "$EVA" "runuser -u agent -- env -i HOME=$EVA_HOME PATH=/usr/bin:/bin LANG=C.UTF-8 sh -s" <<EVA_SIDE
set -e
cd $EVA_HOME/.ssh
# ssh берет домашнюю папку из passwd, а не из HOME, поэтому все пути - полные.
printf '%s\n' "$HOST $host_key" > nowater-radar.known_hosts
printf 'Host nowater-radar\n  HostName %s\n  User radar\n  IdentityFile %s\n  IdentitiesOnly yes\n  BatchMode yes\n  StrictHostKeyChecking yes\n  UserKnownHostsFile %s\n' \
  "$HOST" "$EVA_HOME/.ssh/nowater_radar" "$EVA_HOME/.ssh/nowater-radar.known_hosts" > nowater-radar.conf
chmod 600 nowater-radar.conf nowater-radar.known_hosts
ssh -F $EVA_HOME/.ssh/nowater-radar.conf nowater-radar status 00.00-00.00.00
EVA_SIDE
echo
echo 'Готово. Ева публикует и отправляет командами из radar/README.md.'
