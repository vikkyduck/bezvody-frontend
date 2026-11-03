#!/usr/bin/env bash
# Stage every publication file before changing the running site.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
mode="${1:-publish}"
[[ "$mode" == publish || "$mode" == --stage-only ]] || { echo 'Usage: publish-reports.sh [--stage-only]' >&2; exit 2; }
node scripts/brand-publications.mjs --write >&2
node scripts/check-branding.mjs >&2

SERVER="${SERVER_USER:-root}@${SERVER_HOST:-5.129.198.180}"
[[ "$SERVER" =~ ^[a-zA-Z0-9_.@:-]+$ ]] || exit 2
SSH=(ssh -o BatchMode=yes)
SCP=(scp -q -o BatchMode=yes)
RSYNC_SSH="ssh -o BatchMode=yes"
if [[ -n "${BV_JUMP:-}" ]]; then
  [[ "$BV_JUMP" =~ ^[a-zA-Z0-9_.@:-]+$ ]] || exit 2
  SSH+=(-J "$BV_JUMP")
  SCP+=(-J "$BV_JUMP")
  RSYNC_SSH+=" -J $BV_JUMP"
fi
local_stage=$(mktemp -d)
trap 'rm -rf "$local_stage"' EXIT
node --input-type=module > "$local_stage/publications.tsv" <<'JS'
import fs from 'node:fs';
const { reports } = JSON.parse(fs.readFileSync('deploy/ai-radar-publications.json', 'utf8'));
const destinations = new Set();
for (const report of reports) {
  if (!/^reports\/[a-zA-Z0-9_./-]+\.html$/.test(report.source) || report.source.includes('..') || !/^\/var\/www\/nowater-reports\/[a-zA-Z0-9_.-]+\.html$/.test(report.remote_file) || destinations.has(report.remote_file)) throw new Error('Invalid or duplicate publication path');
  destinations.add(report.remote_file);
  console.log(`${report.source}\t${report.remote_file}`);
}
JS
cat > "$local_stage/apply.sh" <<'REMOTE'
#!/usr/bin/env bash
set -Eeuo pipefail
stage=${1:?Stage required}
[[ "$stage" =~ ^/var/tmp/nowater-brand\.[a-zA-Z0-9]+$ ]] || exit 2
# A parent deployment passes the same open lock descriptor to this child.
if ! [[ /proc/self/fd/9 -ef /var/lock/nowater-branding-maintenance.lock ]]; then
  exec 9>/var/lock/nowater-branding-maintenance.lock
fi
flock -n 9 || { echo 'Another NOWATER deployment is running' >&2; exit 1; }
cd "$stage"
sha256sum --quiet -c files.sha256
backup=$(mktemp -d /var/backups/nowater-branding-XXXXXXXX)
chmod 700 "$backup"
mkdir "$backup/stable" "$backup/reports" "$backup/snippets"
cp publications.tsv "$backup/publications.tsv"
for name in favicon.ico favicon.svg apple-touch-icon.png site.webmanifest; do
  path="/opt/bezvody-front/public/$name"
  if [[ -e "$path" || -L "$path" ]]; then cp -a "$path" "$backup/stable/$name"; else touch "$backup/stable/$name.absent"; fi
done
for name in nowater-branding.conf nowater-ai-radar.conf; do
  path="/etc/nginx/snippets/$name"
  if [[ -e "$path" || -L "$path" ]]; then cp -a "$path" "$backup/snippets/$name"; else touch "$backup/snippets/$name.absent"; fi
done
while IFS=$'\t' read -r source remote_file; do
  name=$(basename "$remote_file")
  if [[ -e "$remote_file" || -L "$remote_file" ]]; then cp -a "$remote_file" "$backup/reports/$name"; else touch "$backup/reports/$name.absent"; fi
done < publications.tsv
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
  for name in favicon.ico favicon.svg apple-touch-icon.png site.webmanifest; do
    restore_file "$backup/stable/$name" "/opt/bezvody-front/public/$name" || failed=1
  done
  for name in nowater-branding.conf nowater-ai-radar.conf; do
    restore_file "$backup/snippets/$name" "/etc/nginx/snippets/$name" || failed=1
  done
  while IFS=$'\t' read -r source remote_file; do
    restore_file "$backup/reports/$(basename "$remote_file")" "$remote_file" || failed=1
  done < "$backup/publications.tsv"
  nginx -t && systemctl reload nginx || failed=1
  if (( failed )); then echo "Publication rollback needs attention. Backup: $backup" >&2; else echo "Previous publication restored. Backup: $backup" >&2; fi
  (( status != 0 )) || status=1
  exit "$status"
}
trap 'rollback "$?"' ERR
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM
# Everything below can alter production and is covered by the snapshots above.
mkdir -p /opt/bezvody-front/public/brand /var/www/nowater-reports
rsync -a public/brand/ /opt/bezvody-front/public/brand/
chown -R bezvody:bezvody /opt/bezvody-front/public/brand
for name in favicon.ico favicon.svg apple-touch-icon.png site.webmanifest; do
  target="/opt/bezvody-front/public/$name"
  install -m 644 -o bezvody -g bezvody "public/$name" "$target.brand-next"
  mv -Tf "$target.brand-next" "$target"
done
while IFS=$'\t' read -r source remote_file; do
  install -m 644 "reports/$(basename "$remote_file")" "$remote_file.brand-next"
  mv -Tf "$remote_file.brand-next" "$remote_file"
done < publications.tsv
for name in nowater-branding.conf nowater-ai-radar.conf; do
  target="/etc/nginx/snippets/$name"
  install -m 644 "$name" "$target.brand-next"
  mv -Tf "$target.brand-next" "$target"
done
nginx -t
systemctl reload nginx
trap - ERR HUP INT TERM
printf 'Branding and reports published. Backup: %s\n' "$backup"
REMOTE
mkdir -p "$local_stage/public/brand" "$local_stage/reports"
cp -a public/brand/. "$local_stage/public/brand/"
cp public/favicon.ico public/favicon.svg public/apple-touch-icon.png public/site.webmanifest "$local_stage/public/"
cp deploy/nginx-nowater-branding.conf deploy/nginx-nowater-ai-radar.conf "$local_stage/"
while IFS=$'\t' read -r source remote_file; do
  cp "$source" "$local_stage/reports/$(basename "$remote_file")"
done < "$local_stage/publications.tsv"
node --input-type=module - "$local_stage" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = process.argv[2];
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(full);
    else throw new Error('Publication stage must contain only regular files');
  }
}
walk(root);
fs.writeFileSync(path.join(root, 'files.sha256'), files.sort().map(file => `${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}  ${path.relative(root, file)}`).join('\n') + '\n');
JS
stage=$("${SSH[@]}" "$SERVER" 'mktemp -d /var/tmp/nowater-brand.XXXXXXXX')
[[ "$stage" =~ ^/var/tmp/nowater-brand\.[a-zA-Z0-9]+$ ]] || exit 2
rsync -az -e "$RSYNC_SSH" "$local_stage/" "$SERVER:$stage/"
"${SSH[@]}" "$SERVER" "cd '$stage' && sha256sum --quiet -c files.sha256"
if [[ "$mode" == --stage-only ]]; then
  printf '%s\n' "$stage"
else
  "${SSH[@]}" "$SERVER" bash "$stage/apply.sh" "$stage"
  "${SSH[@]}" "$SERVER" "rm -rf '$stage'"
fi
