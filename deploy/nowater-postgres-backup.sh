#!/usr/bin/env bash
set -euo pipefail
umask 077
out=/opt/bezvody-front-backups
mkdir -p "$out"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
runuser -u postgres -- pg_dump -Fc nowater > "$out/nowater-$stamp.dump.tmp"
mv "$out/nowater-$stamp.dump.tmp" "$out/nowater-$stamp.dump"
# Private API settings and uploaded binaries are not in PostgreSQL.
tar -czf "$out/nowater-files-$stamp.tar.gz" -C /opt bezvody-front-data
echo "NOWATER database and private files backed up: $stamp"
