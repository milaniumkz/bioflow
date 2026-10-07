#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
backup_dir=${BACKUP_DIR:-backups}
umask 077
mkdir -p "$backup_dir"
output="$backup_dir/bioflow-$(date -u +%Y%m%dT%H%M%SZ).dump"
# libpq does not accept Prisma's schema query parameter.
connection=${DATABASE_URL%%\?*}
pg_dump --dbname="$connection" --format=custom --no-owner --no-acl --file="$output.tmp"
pg_restore --list "$output.tmp" >/dev/null
mv "$output.tmp" "$output"
sha256sum "$output" > "$output.sha256"
printf '%s\n' "$output"
