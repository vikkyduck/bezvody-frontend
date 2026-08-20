#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Резервная копия данных платформы «Без Воды» (фронт).
#
# Копируем то, что человек не повторит: справочник участников, настройки
# агентов и переписку окон. Загруженные файлы НЕ копируем — они тяжёлые
# (до 100 МБ каждый) и восстановимы: клиент пришлёт заново. Разговор он
# заново не проведёт.
#
# Ставится таймером раз в час, хранятся последние 48 копий (двое суток).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DATA=/opt/bezvody-front-data
DEST=/opt/bezvody-front-backups
KEEP=48

[ -d "$DATA" ] || { echo "нет папки данных $DATA"; exit 1; }
mkdir -p "$DEST"
chmod 700 "$DEST"

stamp=$(date -u +%Y%m%d-%H%M)
tar czf "$DEST/data-$stamp.tgz" -C "$DATA" --exclude=./files --exclude=./backups .
chmod 600 "$DEST/data-$stamp.tgz"

# Оставляем последние KEEP копий, остальное удаляем.
ls -1t "$DEST"/data-*.tgz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "копия готова: $DEST/data-$stamp.tgz ($(du -h "$DEST/data-$stamp.tgz" | cut -f1))"
