#!/usr/bin/env bash
#
# Ключ провайдера — в хранилище платформы, минуя браузер.
#
# Ключ вводится вслепую и уходит на сервер через ssh потоком ввода: он не
# попадает ни в историю команд, ни в список процессов на сервере, ни в журналы.
# Файл secrets.json остаётся с правами 600 и владельцем bezvody.
#
# Перезапускать сервис не нужно: ключ читается с диска на каждый запрос.
#
#   ./set-api-key.sh anthropic              — общий ключ Claude для всех агентов
#   ./set-api-key.sh anthropic architect    — отдельный ключ Архитектору
#   ./set-api-key.sh openai neurocouncil    — отдельный ключ Совету
#   ./set-api-key.sh anthropic architect --убрать   — убрать свой ключ агента
#
# Свой ключ агента старше общего: есть он — работают по нему, нет — по общему.

set -euo pipefail

SERVER="${BV_SERVER:-root@5.129.198.180}"
SECRETS="/opt/bezvody-front-data/secrets.json"

PROVIDER="${1:-}"
AGENT="${2:-}"
MODE="${3:-}"

case "$PROVIDER" in
  anthropic | openai | gemini) ;;
  *)
    echo "Кому ключ: anthropic, openai или gemini."
    echo
    echo "  ./set-api-key.sh anthropic              общий ключ Claude"
    echo "  ./set-api-key.sh anthropic architect    ключ только Архитектору"
    echo "  ./set-api-key.sh openai neurocouncil    ключ только Совету"
    exit 1
    ;;
esac

if [ "$MODE" = "--убрать" ]; then
  if [ -n "$AGENT" ]; then
    echo "Убираю свой ключ $PROVIDER у агента «$AGENT» — дальше он будет работать по общему."
  else
    echo "Убираю общий ключ $PROVIDER."
  fi
elif [ -n "$AGENT" ]; then
  echo "Ключ $PROVIDER для агента «$AGENT» — только он им и пользуется."
else
  echo "Общий ключ $PROVIDER — для всех агентов, у кого нет своего."
fi

KEY=""
if [ "$MODE" != "--убрать" ]; then
  printf 'Вставьте ключ (не отображается): '
  read -rs KEY
  echo
  if [ -z "$KEY" ]; then
    echo "Пусто — ничего не меняю."
    exit 1
  fi
  echo "Принял ключ, оканчивается на ${KEY: -4}."
fi

# Сама программа уезжает на сервер закодированной в аргументе команды, а
# поток ввода остаётся свободным — по нему идёт ключ. Наоборот не выходит:
# если программу подать потоком, python съест его целиком и ключу места не
# останется (на этом скрипт один раз уже молча записал пустоту).
PROG=$(base64 <<'PY' | tr -d '\n'
import json, os, sys

key = sys.stdin.readline().strip()
provider = os.environ["PROVIDER"]
agent = os.environ["AGENT"]
path = os.environ["SECRETS"]

try:
    with open(path) as f:
        data = json.load(f)
except FileNotFoundError:
    data = {}

field = {"anthropic": "anthropicKey", "openai": "openaiKey", "gemini": "geminiKey"}[provider]

if agent:
    keys = data.setdefault("agentProviderKeys", {})
    slot = keys.setdefault(agent, {})
    if key:
        slot[provider] = key
    else:
        slot.pop(provider, None)
    if not slot:
        keys.pop(agent, None)
    if not keys:
        data.pop("agentProviderKeys", None)
else:
    if key:
        data[field] = key
    else:
        data.pop(field, None)

with open(path, "w") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
os.chmod(path, 0o600)

import shutil
shutil.chown(path, "bezvody", "bezvody")

# Показываем, что теперь лежит, — хвостами, сами ключи наружу не выносим.
общие = {p: v[-4:] for p, v in ((p, data.get(f, "")) for p, f in
        (("anthropic", "anthropicKey"), ("openai", "openaiKey"), ("gemini", "geminiKey"))) if v}
print("общие ключи:", ", ".join(f"{p} ••••{t}" for p, t in общие.items()) or "нет")
for a, slots in data.get("agentProviderKeys", {}).items():
    print(f"свой ключ у «{a}»:", ", ".join(f"{p} ••••{v[-4:]}" for p, v in slots.items()))
PY
)

printf '%s\n' "$KEY" | ssh "$SERVER" \
  "PROVIDER='$PROVIDER' AGENT='$AGENT' SECRETS='$SECRETS' python3 -c 'import base64;exec(base64.b64decode(\"$PROG\"))'"

echo "Готово. Перезапускать ничего не надо — ключ подхватится со следующего вопроса агенту."
