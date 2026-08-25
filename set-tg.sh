#!/usr/bin/env bash
#
# Подключить телеграм-бота платформе.
#
# Что бот умеет: принимает документы в личке и кладёт их в задачу кабинета,
# а готовый разбор возвращает туда же файлом. Только личные чаты — в группах
# он молчит.
#
# Что нужно приготовить, всё в самом телеграме, один раз:
#   1) бота у @BotFather: /newbot → он выдаст токен вида 1234567890:AA...
#      Там же полезно выключить приватность (/setprivacy → Enable) — на личку
#      она не влияет, но убирает лишние вопросы;
#   2) адрес прокси к API, если сервер стоит в России. С адреса Timeweb
#      api.telegram.org недоступен: между нами и Телеграмом должен стоять
#      прокси (у нас это воркер Cloudflare), и он обязан повторять оба пути —
#      и /bot<токен>/<метод>, и /file/bot<токен>/<путь>, иначе документы будут
#      приходить, но не скачиваться.
#
#   ./set-tg.sh              — задать токен, имя бота и адрес API
#   ./set-tg.sh --убрать     — отключить бота и снять вебхук
#
# Токен вводится вслепую и уходит на сервер потоком ввода: он не попадает ни в
# историю команд, ни в список процессов на сервере, ни в вывод скрипта, ни в
# журналы — наружу показываются только последние четыре знака. Лежит там же,
# где ключи моделей: secrets.json с правами 600 и владельцем bezvody.
#
# Перезапускать сервис не нужно: настройки читаются с диска на каждый запрос.
#
# Если прямой маршрут до сервера не работает, идём через дроплет:
#   BV_JUMP=root@206.189.181.64 ./set-tg.sh

set -euo pipefail

SERVER="${BV_SERVER:-root@5.129.198.180}"
JUMP="${BV_JUMP:-}"
SECRETS="/opt/bezvody-front-data/secrets.json"
HOOK_URL="${BV_HOOK_URL:-https://nowater.tech/tg/hook}"

MODE=""
TOKEN=""
BOT_NAME=""
API_BASE=""

if [ "${1:-}" = "--убрать" ]; then
  MODE="убрать"
  echo "Отключаю бота: вебхук снимется, токен сотрётся."
else
  echo "Подключение телеграм-бота платформы «Без Воды»."
  echo

  printf 'Токен бота от @BotFather (не отображается): '
  read -rs TOKEN
  echo
  if [ -z "$TOKEN" ]; then
    echo "Пусто — ничего не меняю."
    exit 1
  fi
  # Проверяем форму токена до того, как везти его на сервер: опечатка здесь
  # стоит дешевле, чем молчащий бот через неделю.
  if ! printf '%s' "$TOKEN" | grep -Eq '^[0-9]+:[A-Za-z0-9_-]{30,}$'; then
    echo "Это не похоже на токен бота: ожидается «цифры:буквы», как 1234567890:AA…"
    exit 1
  fi
  echo "Принял токен, оканчивается на ${TOKEN: -4}."
  echo

  printf 'Имя бота без собаки, для ссылки t.me (пусто — спрошу у телеграма): '
  read -r BOT_NAME
  BOT_NAME="${BOT_NAME#@}"
  echo

  echo "Базовый адрес API. Прямой api.telegram.org с сервера в России не работает —"
  echo "здесь нужен адрес прокси, например https://ваш-воркер.workers.dev"
  printf 'Адрес (пусто — https://api.telegram.org): '
  read -r API_BASE
  API_BASE="${API_BASE:-https://api.telegram.org}"
  echo
  echo "Адрес API: $API_BASE"
  echo "Вебхук:    $HOOK_URL"
  echo
fi

# Программа уезжает на сервер закодированной в аргументе команды, а поток ввода
# остаётся свободным — по нему идёт токен. Наоборот не выходит: подашь программу
# потоком, и python съест его целиком, а токену места не останется.
PROG=$(base64 <<'PY' | tr -d '\n'
import json, os, secrets as rnd, shutil, sys, urllib.request

token = sys.stdin.readline().strip()
path = os.environ["SECRETS"]
mode = os.environ.get("MODE", "")
base = (os.environ.get("API_BASE", "") or "https://api.telegram.org").rstrip("/")
name = os.environ.get("BOT_NAME", "").lstrip("@").strip()
hook = os.environ.get("HOOK_URL", "")


def save(data):
    with open(path, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.chmod(path, 0o600)
    shutil.chown(path, "bezvody", "bezvody")


def call(method, payload, tok):
    """Токен уходит в адресе, а не в аргументах команды: в ps его не видно."""
    req = urllib.request.Request(
        f"{base}/bot{tok}/{method}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except Exception as e:
        return {"ok": False, "description": str(e).replace(tok, "···")}


try:
    with open(path) as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}

tg = dict(data.get("telegram") or {})

if mode == "убрать":
    old = tg.get("botToken", "")
    if old:
        res = call("deleteWebhook", {"drop_pending_updates": True}, old)
        print("вебхук:", "снят" if res.get("ok") else f"снять не вышло — {res.get('description')}")
    data.pop("telegram", None)
    save(data)
    print("бот отключён, токен стёрт")
    raise SystemExit(0)

tg["botToken"] = token
tg["apiBase"] = base
# Секрет вебхука бережём между запусками: он и так меняется только вместе с
# вебхуком, а лишняя смена означала бы окно, в котором Телеграм стучится
# старым секретом и получает 404.
if not tg.get("hookSecret"):
    tg["hookSecret"] = rnd.token_hex(24)

me = call("getMe", {}, token)
if me.get("ok"):
    real = (me.get("result") or {}).get("username", "")
    if name and real and name.lower() != real.lower():
        print(f"в настройке было «{name}», а бот на самом деле @{real} — записываю @{real}")
    name = real or name
else:
    print("телеграм не ответил на getMe:", me.get("description"))
    print("токен и адрес сохраню, но вебхук поставить не смогу — проверьте адрес прокси")

tg["botName"] = name
data["telegram"] = tg
save(data)

print("бот:      ", ("@" + name) if name else "имя неизвестно")
print("адрес API:", base)
print("токен:     ••••" + token[-4:])

if me.get("ok"):
    res = call(
        "setWebhook",
        {
            "url": hook,
            "secret_token": tg["hookSecret"],
            # Больше ничего от Телеграма не нужно: остальные обновления мы всё
            # равно выбрасываем, а так они и не приедут.
            "allowed_updates": ["message", "callback_query"],
            "drop_pending_updates": True,
        },
        token,
    )
    print("вебхук:   ", hook, "—", "поставлен" if res.get("ok") else f"не поставлен: {res.get('description')}")
    info = call("getWebhookInfo", {}, token)
    if info.get("ok"):
        r = info.get("result") or {}
        print("телеграм видит:", r.get("url") or "ничего")
        if r.get("last_error_message"):
            print("последняя ошибка на стороне телеграма:", r["last_error_message"])
PY
)

printf '%s\n' "$TOKEN" | ssh ${JUMP:+-J "$JUMP"} "$SERVER" \
  "MODE='$MODE' BOT_NAME='$BOT_NAME' API_BASE='$API_BASE' HOOK_URL='$HOOK_URL' SECRETS='$SECRETS' python3 -c 'import base64;exec(base64.b64decode(\"$PROG\"))'"

echo
if [ "$MODE" = "убрать" ]; then
  echo "Готово. Перезапускать ничего не надо."
else
  echo "Готово. Перезапускать ничего не надо — настройки читаются на каждый запрос."
  echo "Дальше: в кабинете нажать «Связать телеграм» и открыть выданную ссылку."
fi
