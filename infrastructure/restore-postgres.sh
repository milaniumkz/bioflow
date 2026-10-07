#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL must point to an empty isolated restore database}"
: "${1:?Usage: restore-postgres.sh backups/file.dump}"
connection=${DATABASE_URL%%\?*}
count=$(psql "$connection" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
[ "$count" = 0 ] || { printf '%s\n' 'Restore target is not empty. Refusing to overwrite data.' >&2; exit 1; }
pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname="$connection" "$1"
