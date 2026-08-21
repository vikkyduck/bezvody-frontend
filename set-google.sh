#!/usr/bin/env bash
#
# Подключить Google Диск платформе.
#
# Нужны две вещи, обе делаются в Google один раз:
#   1) ключ служебного аккаунта — файл .json, который Google даёт при его
#      создании (Google Cloud → IAM → сервисные аккаунты → ключи → JSON);
#   2) папка на Диске, куда складывать. Откройте её в браузере и возьмите id
#      из адреса: drive.google.com/drive/folders/ВОТ_ЭТО. Папкой нужно
#      поделиться с почтой служебного аккаунта (она есть в том же .json,
#      поле client_email) — правами редактора.
#
#   ./set-google.sh ~/Downloads/bezvody-xxxx.json 1AbCdEfGhIjKlMnOp
#   ./set-google.sh --убрать          — отключить Диск от платформы
#
# Ключ уходит на сервер потоком ввода: в историю команд и в список процессов
# он не попадает. Лежит там же, где ключи моделей, — файл с правами 600.
#
# Если прямой маршрут до сервера не работает, идём через дроплет:
#   BV_JUMP=root@206.189.181.64 ./set-google.sh ключ.json id_папки

set -euo pipefail

SERVER="${BV_SERVER:-root@5.129.198.180}"
SECRETS="/opt/bezvody-front-data/secrets.json"
JUMP="${BV_JUMP:-}"

KEY_FILE="${1:-}"
FOLDER="${2:-}"

if [ "$KEY_FILE" = "--убрать" ]; then
  PAYLOAD="убрать"
elif [ -z "$KEY_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  echo "Нужен файл ключа служебного аккаунта:"
  echo "  ./set-google.sh ~/Downloads/ключ.json id_папки_на_диске"
  exit 1
else
  # Проверяем, что это правда ключ, до того как везти его на сервер.
  if ! grep -q '"private_key"' "$KEY_FILE" || ! grep -q '"client_email"' "$KEY_FILE"; then
    echo "Это не похоже на ключ служебного аккаунта: внутри нет private_key и client_email."
    exit 1
  fi
  echo "Аккаунт: $(grep -o '"client_email"[^,]*' "$KEY_FILE" | cut -d'"' -f4)"
  [ -n "$FOLDER" ] && echo "Папка на Диске: $FOLDER" || echo "Папка не указана — файлы лягут в корень служебного аккаунта."
  PAYLOAD="$(base64 < "$KEY_FILE" | tr -d '\n')"
fi

PROG=$(base64 <<'PY' | tr -d '\n'
import base64, json, os, sys

raw = sys.stdin.readline().strip()
folder = os.environ.get("FOLDER", "").strip()
path = os.environ["SECRETS"]

try:
    with open(path) as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}

if raw == "убрать":
    data.pop("googleAccount", None)
    data.pop("googleFolderId", None)
    print("Google Диск отключён")
else:
    key = json.loads(base64.b64decode(raw))
    data["googleAccount"] = {
        "client_email": key["client_email"],
        "private_key": key["private_key"],
    }
    if folder:
        data["googleFolderId"] = folder
    print("аккаунт:", key["client_email"])
    print("папка:", data.get("googleFolderId") or "корень служебного аккаунта")

with open(path, "w") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
os.chmod(path, 0o600)

import shutil
shutil.chown(path, "bezvody", "bezvody")
PY
)

printf '%s\n' "$PAYLOAD" | ssh ${JUMP:+-J "$JUMP"} "$SERVER" \
  "FOLDER='$FOLDER' SECRETS='$SECRETS' python3 -c 'import base64;exec(base64.b64decode(\"$PROG\"))'"

echo "Готово. Перезапускать ничего не надо."
