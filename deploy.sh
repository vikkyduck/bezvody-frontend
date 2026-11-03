#!/usr/bin/env bash
# Publish the SSR application and registered reports with one protected rollback.
set -Eeuo pipefail
cd "$(dirname "$0")"
SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
[[ "$SERVER" =~ ^[a-zA-Z0-9_.@:-]+$ ]] || exit 2
SSH=(ssh -o BatchMode=yes)
RSYNC_SSH="ssh -o BatchMode=yes"
if [[ -n "${BV_JUMP:-}" ]]; then
  [[ "$BV_JUMP" =~ ^[a-zA-Z0-9_.@:-]+$ ]] || exit 2
  SSH+=(-J "$BV_JUMP")
  RSYNC_SSH+=" -J $BV_JUMP"
fi

echo '==> [1/4] Checking types'
npx tsc --noEmit
echo '==> [2/4] Building the node-server release'
rm -rf .output dist
NITRO_PRESET=node-server npm run build
OUT=""
for directory in .output dist; do
  if [[ -f "$directory/nitro.json" ]]; then OUT=$directory; break; fi
done
[[ -n "$OUT" ]] || { echo 'Nitro build not found' >&2; exit 1; }
grep -q '"preset": *"node-server"' "$OUT/nitro.json" || { echo 'Wrong Nitro preset' >&2; exit 1; }
[[ -d "$OUT/public" ]] || { [[ -d "$OUT/client" ]] && mv "$OUT/client" "$OUT/public"; }

echo '==> [3/4] Staging every release file'
app_stage=$("${SSH[@]}" "$SERVER" 'mktemp -d /var/tmp/nowater-app.XXXXXXXX')
[[ "$app_stage" =~ ^/var/tmp/nowater-app\.[a-zA-Z0-9]+$ ]] || exit 2
rsync -az -e "$RSYNC_SSH" "$OUT/" "$SERVER:$app_stage/"
publication_stage=$(bash deploy/publish-reports.sh --stage-only)
[[ "$publication_stage" =~ ^/var/tmp/nowater-brand\.[a-zA-Z0-9]+$ ]] || exit 2

echo '==> [4/4] Backing up, switching and checking the release'
"${SSH[@]}" "$SERVER" bash -s -- "$app_stage" "$publication_stage" <<'REMOTE'
set -Eeuo pipefail
app_stage=$1
publication_stage=$2
[[ "$app_stage" =~ ^/var/tmp/nowater-app\.[a-zA-Z0-9]+$ && "$publication_stage" =~ ^/var/tmp/nowater-brand\.[a-zA-Z0-9]+$ ]] || exit 2
exec 9>/var/lock/nowater-branding-maintenance.lock
flock -n 9 || { echo 'Another NOWATER deployment is running' >&2; exit 1; }
[[ -d /opt/bezvody-front && ! -L /opt/bezvody-front && -f "$app_stage/server/index.mjs" ]]
cd "$publication_stage"
sha256sum --quiet -c files.sha256
backup=$(mktemp -d /var/backups/nowater-release-XXXXXXXX)
chmod 700 "$backup"
mkdir "$backup/reports" "$backup/snippets"
cp -a /opt/bezvody-front "$backup/app"
cp publications.tsv "$backup/publications.tsv"
for name in nowater-branding.conf nowater-ai-radar.conf; do
  target="/etc/nginx/snippets/$name"
  if [[ -e "$target" || -L "$target" ]]; then cp -a "$target" "$backup/snippets/$name"; else touch "$backup/snippets/$name.absent"; fi
done
while IFS=$'\t' read -r source remote_file; do
  name=$(basename "$remote_file")
  if [[ -e "$remote_file" || -L "$remote_file" ]]; then cp -a "$remote_file" "$backup/reports/$name"; else touch "$backup/reports/$name.absent"; fi
done < publications.tsv
was_active=0
if systemctl is-active --quiet bezvody-front; then was_active=1; fi
printf 'Full release backup: %s\n' "$backup"
restore_file() {
  saved=$1
  target=$2
  if [[ -f "$saved.absent" ]]; then
    rm -f "$target" "$target.brand-next"
  else
    cp -a "$saved" "$target.brand-rollback" && mv -Tf "$target.brand-rollback" "$target" && rm -f "$target.brand-next"
  fi
}
rollback() {
  status=$1
  trap - ERR HUP INT TERM
  set +e
  failed=0
  systemctl stop bezvody-front || failed=1
  rsync -a --delete "$backup/app/" /opt/bezvody-front/ || failed=1
  for name in nowater-branding.conf nowater-ai-radar.conf; do
    restore_file "$backup/snippets/$name" "/etc/nginx/snippets/$name" || failed=1
  done
  while IFS=$'\t' read -r source remote_file; do
    restore_file "$backup/reports/$(basename "$remote_file")" "$remote_file" || failed=1
  done < "$backup/publications.tsv"
  nginx -t && systemctl reload nginx || failed=1
  if (( was_active )); then systemctl start bezvody-front || failed=1; fi
  if (( failed )); then echo "Release rollback needs attention. Backup: $backup" >&2; else echo "Previous release restored. Backup: $backup" >&2; fi
  (( status != 0 )) || status=1
  exit "$status"
}
trap 'rollback "$?"' ERR
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM
# Publish static files while the old SSR process is still serving requests.
bash "$publication_stage/apply.sh" "$publication_stage"
systemctl stop bezvody-front
rsync -a --delete "$app_stage/" /opt/bezvody-front/
chown -R bezvody:bezvody /opt/bezvody-front
systemctl start bezvody-front
healthy=0
for attempt in $(seq 1 20); do
  if systemctl is-active --quiet bezvody-front && curl -fsS --connect-timeout 3 --max-time 10 -o /dev/null http://127.0.0.1:5050/; then healthy=1; break; fi
  sleep 1
done
(( healthy )) || { echo 'New SSR release did not become healthy' >&2; false; }
nginx -t
curl -fsS --connect-timeout 3 --max-time 10 --resolve nowater.tech:443:127.0.0.1 -o /dev/null https://nowater.tech/
trap - ERR HUP INT TERM
printf 'NOWATER release active. Rollback backup: %s\n' "$backup"
rm -rf "$app_stage" "$publication_stage"
REMOTE

echo 'Published: https://nowater.tech/'
