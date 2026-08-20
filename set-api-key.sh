#!/usr/bin/env bash
set -eu

BASE_URL="${BASE_URL:-https://id.withoutwater.ru}"

# Краски
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}┌─ Сохранить ключ API провайдера ─────────────────────┐${NC}"
echo

# 1. Код администратора
read -s -p "Код администратора платформы: " ADMIN_CODE
echo
if [ -z "$ADMIN_CODE" ]; then
  echo -e "${RED}Ошибка: нужен код администратора${NC}"
  exit 1
fi

echo
echo "Провайдеры:"
echo "  1. claude     (Anthropic Claude)"
echo "  2. openai     (OpenAI GPT)"
echo "  3. gemini     (Google Gemini)"
echo
read -p "Выбор (1/2/3): " PROVIDER_NUM

case "$PROVIDER_NUM" in
  1) PROVIDER="anthropic" ;;
  2) PROVIDER="openai" ;;
  3) PROVIDER="gemini" ;;
  *)
    echo -e "${RED}Ошибка: выбор 1, 2 или 3${NC}"
    exit 1
    ;;
esac

echo
echo "Передавать ключ:"
echo "  1. Глобально (для всех агентов)"
echo "  2. Конкретному агенту (architect, neurocouncil, stakeholders, accountant)"
echo
read -p "Выбор (1/2): " SCOPE

AGENT_ID=""
if [ "$SCOPE" = "2" ]; then
  read -p "ID агента: " AGENT_ID
  if [ -z "$AGENT_ID" ]; then
    echo -e "${RED}Ошибка: нужен ID агента${NC}"
    exit 1
  fi
fi

echo
read -s -p "API-ключ: " API_KEY
echo
if [ -z "$API_KEY" ]; then
  echo -e "${RED}Ошибка: ключ не может быть пустым${NC}"
  exit 1
fi

# Отправляем запрос
PAYLOAD=$(cat <<PAYLOAD_EOF
{
  "code": "$ADMIN_CODE",
  "provider": "$PROVIDER",
  $([ -n "$AGENT_ID" ] && echo "\"agentId\": \"$AGENT_ID\"," || echo "")
  "key": "$API_KEY"
}
PAYLOAD_EOF
)

echo
echo -e "${YELLOW}Сохраняю...${NC}"

RESPONSE=$(curl -s -X POST "$BASE_URL/api/save-api-key" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

# Проверяем ошибку
if echo "$RESPONSE" | grep -q '"ok":false' 2>/dev/null || echo "$RESPONSE" | grep -q 'error' 2>/dev/null; then
  echo -e "${RED}Ошибка:${NC} $RESPONSE"
  exit 1
fi

if [ -n "$AGENT_ID" ]; then
  echo -e "${GREEN}✓ Ключ сохранён для агента $AGENT_ID${NC}"
else
  echo -e "${GREEN}✓ Ключ сохранён глобально для всех агентов${NC}"
fi
echo "   Провайдер: $PROVIDER"
echo "   Последние знаки: $(echo "$API_KEY" | tail -c 5)"
