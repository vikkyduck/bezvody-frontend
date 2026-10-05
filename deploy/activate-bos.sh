#!/usr/bin/env bash
# Run on Timeweb after testing /opt/bezvody-front-bos-release.
set -euo pipefail
umask 077
release=/opt/bezvody-front-bos-release
live=/opt/bezvody-front
stamp=$(date -u +%Y%m%dT%H%M%SZ)
previous="/opt/bezvody-front-before-bos-$stamp"
backup="/opt/bezvody-front-backups/before-bos-$stamp.tar.gz"
dropin=/etc/systemd/system/bezvody-front.service.d/database.conf
test -f "$release/server/index.mjs"
test -f /etc/nowater/database.env
test ! -e "$dropin"
mkdir -p /opt/bezvody-front-backups
swapped=0
rollback() {
  echo "Activation failed; restoring previous service"
  systemctl stop bezvody-front || true
  if [ "$swapped" = 1 ]; then
    mv "$live" "/opt/bezvody-front-failed-bos-$stamp"
    mv "$previous" "$live"
  fi
  rm -f "$dropin"
  systemctl daemon-reload
  systemctl start bezvody-front
}
systemctl stop bezvody-front
trap rollback ERR
tar -czf "$backup" -C /opt bezvody-front bezvody-front-data
cd /opt/nowater-bos-ops
node --env-file=/etc/nowater/database.env scripts/migrate-postgres.mjs import
node --env-file=/etc/nowater/database.env scripts/migrate-postgres.mjs verify
node --env-file=/etc/nowater/database.env scripts/install-bos.mjs
chown -R bezvody:bezvody "$release"
mv "$live" "$previous"
mv "$release" "$live"
swapped=1
mkdir -p "$(dirname "$dropin")"
printf '[Service]\nEnvironmentFile=/etc/nowater/database.env\n' > "$dropin"
chmod 644 "$dropin"
systemctl daemon-reload
systemctl start bezvody-front
curl --fail --silent --show-error --retry 8 --retry-connrefused --retry-delay 1 http://127.0.0.1:5050/ > /dev/null
systemctl is-active --quiet bezvody-front
trap - ERR
printf 'Activated. Previous bundle: %s\nBackup: %s\n' "$previous" "$backup"
